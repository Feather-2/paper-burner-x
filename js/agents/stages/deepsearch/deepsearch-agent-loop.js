/**
 * DeepSearch Agent Loop - V2 架构
 *
 * 核心变更：
 * 1. Agent Loop 自己决定下一步，而非预定义 Pipeline
 * 2. Agent Loop 即 Supervisor，自己审查、自己决策
 * 3. 小文档：单 Agent Loop；大文档：Lead Agent + SubAgent 分治
 */

import { BaseAgentLoop, checkCancelled } from "../../runtime/agent-loop.js";
import { StagePausedError } from "../../runtime/stage-errors.js";
import { getRuntimeState } from "../../runtime/loop-runtime-state.js";
import { DeepSearchState } from "./state.js";
import { createLogger } from "./logger.js";
import { shouldUseDirectMode, runDirectAnalysis } from "./direct-analysis.js";
import { CONCURRENCY_CONFIG, SMALL_DOC_TOKEN_THRESHOLD, AgentLoopStatus, agentLoopMachine } from "./constants.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/value-utils.js";
import { createStageApi } from "../../shared/stage-api.js";
import { buildContentPackage } from "../textprep/build-content-package.js";
import { ShadowAgent, createShadowAgent } from "./shadow-agent.js";
import { ReviewRules } from "../../runtime/review-rules.js";
import { Archive, MapAdapter } from "../../shared/archive.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/checkpoint-schema.js";
import { SharedContext } from "./shared-context.js";
import { mapConcurrent } from "../../shared/concurrency.js";

/**
 * Agent 可用能力定义
 */
export const AgentCapabilities = Object.freeze({
  // 检索能力
  RETRIEVE_LOCAL: "retrieve_local",      // 本地检索（BM25 + 关键词）
  RETRIEVE_EXTERNAL: "retrieve_external", // 外部搜索

  // 提取能力
  EXTRACT_CLAIMS: "extract_claims",       // 提取论点
  EXTRACT_EVIDENCE: "extract_evidence",   // 提取证据

  // 验证能力
  VALIDATE_SHADOW: "validate_shadow",     // ShadowAgent 验证
  VALIDATE_RULES: "validate_rules",       // 规则检查

  // 输出能力
  GENERATE_REPORT: "generate_report",     // 生成报告

  // 记忆能力
  COMPRESS_MEMORY: "compress_memory",     // 金蝉脱壳压缩
  ARCHIVE_STATE: "archive_state",         // 蝉蜕存档

  // 分治能力（大文档）
  FORK_SUBAGENT: "fork_subagent",         // 分叉 SubAgent
  MERGE_RESULTS: "merge_results",         // 合并结果
});

/**
 * Agent 决策类型
 */
export const AgentDecision = Object.freeze({
  CONTINUE: "continue",     // 继续当前动作
  RETRY: "retry",           // 重试当前动作
  BACKTRACK: "backtrack",   // 回溯到之前状态
  REPLAN: "replan",         // 重新规划
  COMPLETE: "complete",     // 完成
  ABORT: "abort",           // 中止
});

/**
 * 思考模式
 */
export const ThinkingMode = Object.freeze({
  RULES: "rules",     // 纯规则决策（快速，无 LLM 调用）
  LLM: "llm",         // LLM 驱动（深度思考，每步调用 LLM）
  HYBRID: "hybrid",   // 混合模式（规则优先，复杂情况用 LLM）
});

/**
 * ReAct 思考 Prompt
 */
const REACT_THINK_PROMPT = `你是一个文档分析 Agent，正在执行深度搜索任务。

## 当前状态
- 任务目标: {taskGoal}
- 已完成迭代: {iteration}/{maxIterations}
- 来源文档数: {sourceCount}
- 已提取论点: {claimCount}
- 已收集证据: {evidenceCount}
- 开放缺口数: {openGapCount}
- 已填充缺口: {filledGapCount}
- 是否有报告: {hasReport}
- 是否大文档: {isLargeDoc}
- 是否子代理: {isSubAgent}

## 可用动作
1. scan_and_identify_gaps - 扫描文档，识别知识缺口
2. retrieve_and_extract - 检索相关内容，提取论点和证据
3. generate_report - 生成最终报告
4. fork_subagents - 分叉子代理处理大文档
5. complete - 完成任务
6. abort - 中止任务

## 请以 ReAct 格式思考并决策

Thought: <分析当前状态，思考下一步应该做什么>
Action: <选择一个动作>
Reason: <解释为什么选择这个动作>

输出严格 JSON 格式:
{
  "thought": "...",
  "action": "scan_and_identify_gaps|retrieve_and_extract|generate_report|fork_subagents|complete|abort",
  "reason": "..."
}`;

/**
 * 流式思考配置
 */
export const StreamingThinkConfig = Object.freeze({
  // 默认分段大小（字符数）
  DEFAULT_CHUNK_SIZE: 20,
  // 默认分段延迟（毫秒）
  DEFAULT_CHUNK_DELAY: 50,
  // 事件名称
  THOUGHT_DELTA_EVENT: "deepsearch.agent.thought.delta",
  THOUGHT_COMPLETE_EVENT: "deepsearch.agent.thought.complete",
});

function collapseWhitespace(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function contentHash(value) {
  return `h_${simpleHash(String(value || ""))}`;
}

function claimContentKey(claim) {
  const text = collapseWhitespace(claim?.text);
  return text ? text.toLowerCase() : "";
}

function evidenceContentKey(evidence) {
  const sourceId = toNonEmptyString(evidence?.sourceId) || "";
  const charStart = safeInt(evidence?.locator?.charStart);
  const charEnd = safeInt(evidence?.locator?.charEnd);
  if (charStart !== null && charEnd !== null) {
    return `${sourceId}::${charStart}-${charEnd}`;
  }
  const quote = collapseWhitespace(evidence?.quote);
  return `${sourceId}::${quote}`;
}

/**
 * Agent 观察结果
 */
function observe(state) {
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const report = state?.L1?.report;

  const openGaps = gaps.filter(g => g?.status === "open" || !g?.status);
  const filledGaps = gaps.filter(g => g?.status === "filled");

  // 计算文档总 token 数
  const totalChars = sources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
  const estimatedTokens = Math.ceil(totalChars / 2);

  return {
    // 文档状态
    sourceCount: sources.length,
    totalChars,
    estimatedTokens,
    isLargeDoc: estimatedTokens > SMALL_DOC_TOKEN_THRESHOLD,

    // 缺口状态
    totalGaps: gaps.length,
    openGapCount: openGaps.length,
    filledGapCount: filledGaps.length,
    openGaps,

    // 内容状态
    claimCount: claims.length,
    evidenceCount: evidenceLedger.length,
    hasReport: !!report,

    // 迭代状态
    iteration: state?.iteration || 0,
    maxIterations: state?.maxIterations || 5,

    // 原始引用
    sources,
    gaps,
    claims,
    evidenceLedger,
    report,
  };
}

function decorateEventRecord(record, meta) {
  if (!record || typeof record !== "object") return record;
  const base = { ...record };
  const existingMeta = isPlainObject(base.meta) ? base.meta : {};
  const nextMeta = isPlainObject(meta) ? meta : null;
  if (nextMeta) {
    base.meta = { ...existingMeta, ...nextMeta };
  }
  return base;
}

function wrapEventBus(eventBus, meta) {
  if (!eventBus || typeof eventBus.emit !== "function") return eventBus;
  return {
    emit: (name, record) => eventBus.emit(name, decorateEventRecord(record, meta)),
    subscribe: typeof eventBus.subscribe === "function" ? eventBus.subscribe.bind(eventBus) : undefined,
    once: typeof eventBus.once === "function" ? eventBus.once.bind(eventBus) : undefined,
    on: typeof eventBus.on === "function" ? eventBus.on.bind(eventBus) : undefined,
    off: typeof eventBus.off === "function" ? eventBus.off.bind(eventBus) : undefined,
  };
}

function wrapEmit(emit, meta) {
  if (typeof emit !== "function") return emit;
  return (name, record) => emit(name, decorateEventRecord(record, meta));
}

function resolveSubAgentConcurrency(state) {
  const subagentConfig = isPlainObject(state?.userConfig?.subagents) ? state.userConfig.subagents : {};
  const requested =
    safeInt(subagentConfig?.concurrency) ??
    safeInt(state?.userConfig?.subagentConcurrency);
  const fallback = Number.isFinite(CONCURRENCY_CONFIG?.DEFAULT_PARALLEL)
    ? CONCURRENCY_CONFIG.DEFAULT_PARALLEL
    : 5;
  return Math.max(1, requested ?? fallback);
}

function buildSubAgentSummaryKey(parentRunId, subIndex) {
  const parent = toNonEmptyString(parentRunId) || "run";
  const indexLabel = Number.isFinite(subIndex) ? String(subIndex) : "x";
  return `deepsearch_sub_${parent}_${indexLabel}`;
}

/**
 * Agent 思考：决定下一步动作
 */
function think(observation, context = {}) {
  const { openGapCount, hasReport, iteration, maxIterations, isLargeDoc, claimCount, evidenceCount } = observation;
  const { budgetExhausted, aborted } = context;
  const subagentsForked = Boolean(context?.subagentsForked);

  // 中止条件
  if (aborted) {
    return { action: "abort", reason: "user_aborted" };
  }
  if (budgetExhausted) {
    return { action: "complete", reason: "budget_exhausted", forceOutput: true };
  }

  // 大文档：需要分治
  if (isLargeDoc && iteration === 0 && !context.isSubAgent && !subagentsForked) {
    return { action: "fork_subagents", reason: "large_document" };
  }

  // 已有报告且无开放缺口：完成
  if (hasReport && openGapCount === 0) {
    return { action: "complete", reason: "all_gaps_filled" };
  }

  // 达到最大迭代次数
  if (iteration >= maxIterations) {
    return { action: "complete", reason: "max_iterations", forceOutput: true };
  }

  // 有开放缺口：检索 + 提取
  if (openGapCount > 0) {
    return { action: "retrieve_and_extract", reason: "open_gaps_exist", gapCount: openGapCount };
  }

  // 有内容但无报告：生成报告
  if (claimCount > 0 && evidenceCount > 0 && !hasReport) {
    return { action: "generate_report", reason: "content_ready" };
  }

  // 初始状态：扫描识别缺口
  if (observation.totalGaps === 0) {
    return { action: "scan_and_identify_gaps", reason: "initial_state" };
  }

  // 默认：完成
  return { action: "complete", reason: "no_action_needed" };
}

/**
 * DeepSearch Agent Loop
 */
export class DeepSearchAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
    super({
      actor: "deepsearch",
      stageName: "deepsearch",
      eventBus: options.eventBus,
      tools: options.tools,
    });

    this.capabilities = options.capabilities || {};
    // Archive: 使用传入的或创建默认内存存储
    this.archive = options.archive || new Archive(new MapAdapter());
    this.budgetManager = options.budgetManager || null;
    this.isSubAgent = options.isSubAgent || false;
    this.parentAgentId = options.parentAgentId || null;
    this.subAgentIndex = Number.isFinite(options.subAgentIndex) ? options.subAgentIndex : null;

    // ReviewRules: 规则引擎
    this.reviewRules = options.reviewRules || new ReviewRules(options.customRules);

    // ShadowAgent: 延迟初始化（需要 stageApi）
    this._shadowAgent = null;
    this._shadowConfig = options.shadowConfig || {};

    // SharedContext: 分层记忆（SubAgent 分治时共享）
    this.sharedContext = options.sharedContext || null;

    // 春秋蝉: 回溯次数限制（最多3次）
    this.maxBacktracks = safeInt(options.maxBacktracks) ?? 3;
    this._backtrackCount = 0;

    // 交错思考: 思考模式配置
    this.thinkingMode = options.thinkingMode || ThinkingMode.RULES;
    this._thinkingHistory = []; // 记录思考历史（用于调试和回溯）

    // 流式思考配置
    this.streamingThink = options.streamingThink ?? false;
    this.onThoughtDelta = typeof options.onThoughtDelta === "function" ? options.onThoughtDelta : null;

    // Agent Loop 执行状态机
    this._loopStatus = AgentLoopStatus.IDLE;
    this._statusHistory = []; // 状态变更历史

    // Pause 支持（本地标志；运行中在安全边界触发 StagePausedError）
    this._pauseRequested = false;
    this._pauseReason = null;

    // 当前运行状态（用于 checkpoint 序列化）
    this._currentState = null;
  }

  /**
   * 请求暂停：在下一个安全边界（EXECUTING 前）触发
   */
  pause(reason = "user_requested") {
    this._pauseRequested = true;
    this._pauseReason = reason;
  }

  get isPaused() {
    return this._pauseRequested;
  }

  _applyTransition(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return; // 无变化

    // 状态机验证
    if (!agentLoopMachine.canTransition(oldStatus, newStatus)) {
      const err = new Error(`Invalid AgentLoop state transition: ${oldStatus} → ${newStatus}`);
      err.code = "INVALID_STATE_TRANSITION";
      throw err;
    }

    // 记录历史
    const timestamp = Date.now();
    this._statusHistory.push({
      from: oldStatus,
      to: newStatus,
      timestamp,
      ...metadata,
    });

    // 更新状态
    this._loopStatus = newStatus;

    // 发射状态变更事件
    this._emit("deepsearch.agent.status.changed", {
      runId: metadata.runId,
      from: oldStatus,
      to: newStatus,
      timestamp,
      iteration: metadata.iteration,
      checkpointId: metadata.checkpointId,
    });
  }

  /**
   * 状态机转换（带验证和事件发射）
   * @param {string} newStatus - 目标状态
   * @param {object} metadata - 额外元数据
   */
  async _transitionTo(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null; // 无变化

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { state, stageApi, decision, checkpointMetadata, ...historyMeta } = meta;

    if (state) this._currentState = state;

    // 先验证常规转换合法性，避免非法状态时误创建 checkpoint
    if (!agentLoopMachine.canTransition(oldStatus, newStatus)) {
      const err = new Error(`Invalid AgentLoop state transition: ${oldStatus} → ${newStatus}`);
      err.code = "INVALID_STATE_TRANSITION";
      throw err;
    }

    const runId = historyMeta.runId || state?.runId;
    const iteration = historyMeta.iteration ?? state?.iteration;
    const runtimeState = stageApi?.signal ? getRuntimeState(stageApi.signal) : null;
    const runtimePauseRequested = runtimeState?.status === "paused";

    let checkpointId = null;

    // EXECUTING 前创建 pre-action checkpoint；并在此安全边界检查 pause。
    if (newStatus === AgentLoopStatus.EXECUTING) {
      if (this.archive) {
        checkpointId = await this._savePreActionCheckpoint({
          ...historyMeta,
          runId,
          iteration,
          ...(checkpointMetadata && typeof checkpointMetadata === "object" ? checkpointMetadata : {}),
        });
      }

      if (runtimeState && checkpointId) runtimeState.lastCheckpointId = checkpointId;

      const shouldPause = this._pauseRequested || runtimePauseRequested;
      if (shouldPause) {
        const reason = runtimeState?.pausedReason || this._pauseReason || null;
        const pauseCheckpointId = await this._saveCheckpoint({
          ...historyMeta,
          runId,
          iteration,
          type: CheckpointType.PAUSE,
          reason,
          ...(checkpointMetadata && typeof checkpointMetadata === "object" ? checkpointMetadata : {}),
        });
        const resolvedCheckpointId = pauseCheckpointId || checkpointId;
        if (runtimeState && resolvedCheckpointId) runtimeState.lastCheckpointId = resolvedCheckpointId;

        if (agentLoopMachine.canTransition(oldStatus, AgentLoopStatus.PAUSED)) {
          this._applyTransition(AgentLoopStatus.PAUSED, {
            ...historyMeta,
            runId,
            iteration,
            ...(resolvedCheckpointId ? { checkpointId: resolvedCheckpointId } : {}),
            decisionAction: decision?.action || null,
            decisionReason: decision?.reason || null,
            pausedReason: reason,
          });
        }

        throw new StagePausedError("Run paused", {
          checkpointId: resolvedCheckpointId,
          reason,
          timestamp: Date.now(),
          runId,
        });
      }
    }

    this._applyTransition(newStatus, {
      ...historyMeta,
      runId,
      iteration,
      ...(checkpointId ? { checkpointId } : {}),
      ...(decision ? { decisionAction: decision.action, decisionReason: decision.reason } : {}),
    });
    return checkpointId;
  }

  async _savePreActionCheckpoint(metadata) {
    if (!this.archive) return null;
    const state = this._currentState;
    if (!state) return null;

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const runId = meta.runId || state.runId;
    const snapshot = state.toJSON ? state.toJSON() : state;
    const checkpoint = createCheckpoint(snapshot, { ...meta, type: CheckpointType.PRE_ACTION });
    const checkpointId = await this.archive.save(runId, checkpoint);

    if (typeof state?.saveCheckpoint === "function") {
      try {
        state.saveCheckpoint({ checkpointId, timestamp: String(checkpoint.timestamp) });
      } catch {
        // ignore checkpoint record errors (archive is source of truth)
      }
    }

    return checkpointId;
  }

  async _saveCheckpoint(stateOrMetadata, { runId, iteration, kind, decision, metadata } = {}) {
    // Overload: _saveCheckpoint(metadata) uses this._currentState
    if (arguments.length === 1) {
      if (!this.archive) return null;
      const state = this._currentState;
      if (!state) return null;
      const meta = stateOrMetadata && typeof stateOrMetadata === "object" ? stateOrMetadata : {};
      const effectiveRunId = meta.runId || state.runId;
      const snapshot = state.toJSON ? state.toJSON() : state;
      const checkpoint = createCheckpoint(snapshot, meta);
      const checkpointId = await this.archive.save(effectiveRunId, checkpoint);

      if (typeof state?.saveCheckpoint === "function") {
        try {
          state.saveCheckpoint({ checkpointId, timestamp: String(checkpoint.timestamp) });
        } catch {
          // ignore checkpoint record errors (archive is source of truth)
        }
      }

      return checkpointId;
    }

    const state = stateOrMetadata;
    if (!this.archive) return null;
    if (!state) return null;

    const extraMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
    if (extraMetadata.type === undefined) delete extraMetadata.type;
    const defaultType = kind === "memory_compress" ? CheckpointType.COMPRESS : CheckpointType.ARCHIVE;
    const checkpointMetadata = {
      type: defaultType,
      runId: runId || state.runId,
      kind: kind || null,
      decision: decision?.action || null,
      decisionReason: decision?.reason || null,
      iteration: iteration ?? state.iteration,
      isSubAgent: this.isSubAgent,
      parentAgentId: this.parentAgentId,
      ...extraMetadata,
    };
    const snapshot = state?.toJSON ? state.toJSON() : state;
    const checkpoint = createCheckpoint(snapshot, checkpointMetadata);
    const checkpointId = await this.archive.save(runId || state.runId, checkpoint);

    // 在 state 中记录 checkpoint（可序列化）
    if (typeof state?.saveCheckpoint === "function") {
      try {
        state.saveCheckpoint({ checkpointId, timestamp: String(checkpoint.timestamp) });
      } catch {
        // ignore checkpoint record errors (archive is source of truth)
      }
    }

    return checkpointId;
  }

  /**
   * 获取当前状态
   */
  get loopStatus() {
    return this._loopStatus;
  }

  /**
   * 获取状态历史
   */
  get statusHistory() {
    return [...this._statusHistory];
  }

  /**
   * 主执行循环
   */
  async run(input, context = {}) {
    const runContext = context.runContext || {};
    const stageApi = createStageApi({
      signal: context.signal,
      eventBus: context.eventBus || this.eventBus,
      ...context,
    });
    this.eventBus = stageApi.eventBus || this.eventBus;
    this.emit = typeof stageApi.emit === "function" ? stageApi.emit : this.emit;

    // 初始化状态
    const state = this._ensureState(runContext, input);
    if (runContext?.runId) state.runId = String(runContext.runId);

    const logger = createLogger({
      emit: stageApi?.emit,
      getContext: () => ({
        runId: state.runId,
        iteration: state.iteration,
        stage: "deepsearch-agent-loop",
      }),
    });

    logger.info("DeepSearch Agent Loop started", {
      stage: "deepsearch-agent-loop",
      data: { runId: state.runId, isSubAgent: this.isSubAgent },
    });

    this._emit("deepsearch.agent.started", { runId: state.runId, isSubAgent: this.isSubAgent });

    try {
      await this._transitionTo(AgentLoopStatus.RUNNING, { runId: state.runId });

      // 小文档直通模式检测
      const directModeCheck = shouldUseDirectMode(state);
      if (directModeCheck.shouldUse && !this.isSubAgent) {
        logger.info("Using direct analysis mode", { stage: "deepsearch-agent-loop", data: directModeCheck });
        const pkg = await runDirectAnalysis(runContext, { state }, stageApi);
        await this._transitionTo(AgentLoopStatus.COMPLETED, {
          runId: state.runId,
          iteration: state.iteration,
          state,
          stageApi,
          mode: "direct",
        });
        this._emit("deepsearch.agent.completed", { runId: state.runId, mode: "direct" });
        return pkg;
      }

      // Agent Loop 主循环
      let loopCount = 0;
      const maxLoops = (state.maxIterations || 5) * 3; // 安全上限

      while (loopCount < maxLoops) {
        loopCount++;
        checkCancelled(stageApi?.signal);

        await this._transitionTo(AgentLoopStatus.OBSERVING, {
          runId: state.runId,
          iteration: loopCount,
        });

        // 1. 观察
        const observation = observe(state);

        await this._transitionTo(AgentLoopStatus.THINKING, {
          runId: state.runId,
          iteration: loopCount,
        });

        // 2. 思考（支持交错思考）
        const decision = await this._think(observation, state, stageApi, {
          budgetExhausted: this.budgetManager?.stopped,
          aborted: stageApi?.signal?.aborted,
          isSubAgent: this.isSubAgent,
          subagentsForked: Boolean(state?.L2?.subagentsForked),
          logger,
        });

        logger.info(`Agent decision: ${decision.action}`, {
          stage: "deepsearch-agent-loop",
          data: {
            action: decision.action,
            reason: decision.reason,
            iteration: state.iteration,
            thought: decision.thought?.slice(0, 100), // 截断思考内容
            mode: this.thinkingMode,
          },
        });

        // 3. 执行
        await this._transitionTo(AgentLoopStatus.EXECUTING, {
          runId: state.runId,
          iteration: loopCount,
          state,
          stageApi,
          decision,
        });
        const result = await this._execute(decision, state, stageApi, { logger, runContext });

        // 4. 评估 + 自审查
        await this._transitionTo(AgentLoopStatus.REVIEWING, {
          runId: state.runId,
          iteration: loopCount,
        });
        const review = await this._review(decision, result, state, stageApi);

        // 5. 决策
        if (review.decision === AgentDecision.COMPLETE) {
          await this._transitionTo(AgentLoopStatus.COMPLETED, { runId: state.runId });
          break;
        }
        if (review.decision === AgentDecision.ABORT) {
          throw new Error(review.reason || "Agent aborted");
        }
        if (review.decision === AgentDecision.BACKTRACK && this.archive) {
          // 春秋蝉: 检查回溯次数限制
          if (this._backtrackCount >= this.maxBacktracks) {
            logger.warn("春秋蝉: Backtrack limit reached, forcing completion", {
              stage: "deepsearch-agent-loop",
              data: { backtrackCount: this._backtrackCount, maxBacktracks: this.maxBacktracks },
            });
            this._emit("deepsearch.agent.backtrack_limit", {
              runId: state.runId,
              backtrackCount: this._backtrackCount,
              maxBacktracks: this.maxBacktracks,
            });
            // 强制完成，不再回溯
            break;
          }

          // 执行回溯
          try {
            const checkpoints = Array.isArray(state?.checkpoints) ? state.checkpoints : [];
            const fallbackCheckpointId =
              checkpoints.length >= 2 ? checkpoints[checkpoints.length - 2]?.checkpointId : null;
            const checkpointId = review.checkpointId || fallbackCheckpointId;
            if (checkpointId) {
              const restored = migrateCheckpoint(await this.archive.restore(checkpointId));
              if (restored?.nodeStates) {
                const restoredState = DeepSearchState.fromJSON(restored.nodeStates);
                Object.assign(state, restoredState);
                this._backtrackCount++;
                logger.info("春秋蝉: State restored from checkpoint", {
                  stage: "deepsearch-agent-loop",
                  data: {
                    checkpointId,
                    backtrackCount: this._backtrackCount,
                    remaining: this.maxBacktracks - this._backtrackCount,
                  },
                });
              }
            }
          } catch (err) {
            logger.warn("春秋蝉: Backtrack failed", {
              stage: "deepsearch-agent-loop",
              data: { error: err?.message },
            });
          }
        }

        // 压缩记忆（金蝉脱壳）
        if (loopCount % 3 === 0) {
          await this._compressMemory(state, stageApi);
        }
      }

      if (this._loopStatus !== AgentLoopStatus.COMPLETED && this._loopStatus !== AgentLoopStatus.ABORTED) {
        await this._transitionTo(AgentLoopStatus.COMPLETED, {
          runId: state.runId,
          iteration: state.iteration,
          state,
          stageApi,
          loopCount,
          reason: "loop_exit",
        });
      }

      // 构建输出
      const pkg = this._buildOutput(state, runContext);

      logger.info("DeepSearch Agent Loop completed", {
        stage: "deepsearch-agent-loop",
        data: { runId: state.runId, iterations: state.iteration, loopCount },
      });

      this._emit("deepsearch.agent.completed", { runId: state.runId, iterations: state.iteration });

      return pkg;
    } catch (err) {
      if (err instanceof StagePausedError) {
        this._emit("deepsearch.agent.paused", {
          runId: state.runId,
          checkpointId: err.checkpointId,
          reason: err.reason,
          timestamp: err.timestamp,
        });
        throw err;
      }

      try {
        await this._transitionTo(AgentLoopStatus.ABORTED, {
          runId: state.runId,
          error: err?.message,
        });
      } catch {
        // ignore secondary transition failures
      }

      logger.error("DeepSearch Agent Loop failed", {
        stage: "deepsearch-agent-loop",
        data: { runId: state.runId, error: err.message },
      });
      this._emit("deepsearch.agent.failed", { runId: state.runId, error: err.message });
      throw err;
    }
  }

  /**
   * 思考 - 根据模式选择规则或 LLM
   * @param {object} observation - 观察结果
   * @param {object} state - 当前状态
   * @param {object} stageApi - Stage API
   * @param {object} context - 上下文
   */
  async _think(observation, state, stageApi, context = {}) {
    const { budgetExhausted, aborted, isSubAgent, logger } = context;

    // 规则模式：使用纯规则决策
    if (this.thinkingMode === ThinkingMode.RULES) {
      return think(observation, { budgetExhausted, aborted, isSubAgent });
    }

    // LLM 模式：完全使用 LLM 思考
    if (this.thinkingMode === ThinkingMode.LLM) {
      return this._thinkWithLLM(observation, state, stageApi, context);
    }

    // 混合模式：规则优先，复杂/不确定情况用 LLM
    const rulesDecision = think(observation, { budgetExhausted, aborted, isSubAgent });

    // 触发 LLM 思考的条件
    const shouldUseLLM =
      // 情况不明确（多个可能动作）
      (observation.openGapCount > 0 && observation.claimCount > 0 && !observation.hasReport) ||
      // 迭代次数过半仍有缺口
      (observation.iteration > observation.maxIterations / 2 && observation.openGapCount > 0) ||
      // 回溯后需要重新评估
      (this._backtrackCount > 0);

    if (shouldUseLLM) {
      try {
        const llmDecision = await this._thinkWithLLM(observation, state, stageApi, context);
        // 记录两种决策��差异
        if (llmDecision.action !== rulesDecision.action) {
          logger?.info("交错思考: LLM 决策与规则不同", {
            stage: "deepsearch-agent-loop",
            data: {
              rulesAction: rulesDecision.action,
              llmAction: llmDecision.action,
              llmThought: llmDecision.thought?.slice(0, 100),
            },
          });
        }
        return llmDecision;
      } catch (err) {
        // LLM 失败时回退到规则
        logger?.warn("交错思考: LLM 思考失败，回退规则", {
          stage: "deepsearch-agent-loop",
          data: { error: err?.message },
        });
        return rulesDecision;
      }
    }

    return rulesDecision;
  }

  /**
   * LLM 驱动的思考（ReAct 模式，支持流式输出）
   */
  async _thinkWithLLM(observation, state, stageApi, context = {}) {
    const { logger } = context;
    const { extractJsonCandidate } = await import("./state.js");
    const { getModelCaller } = await import("./model.js");

    const callModel = getModelCaller(stageApi, { usage: "think", state });
    if (!callModel) {
      // 无模型时回退规则
      return think(observation, context);
    }

    // 构建 ReAct prompt
    const prompt = REACT_THINK_PROMPT
      .replace("{taskGoal}", state.taskGoal || "分析文档")
      .replace("{iteration}", String(observation.iteration))
      .replace("{maxIterations}", String(observation.maxIterations))
      .replace("{sourceCount}", String(observation.sourceCount))
      .replace("{claimCount}", String(observation.claimCount))
      .replace("{evidenceCount}", String(observation.evidenceCount))
      .replace("{openGapCount}", String(observation.openGapCount))
      .replace("{filledGapCount}", String(observation.filledGapCount))
      .replace("{hasReport}", String(observation.hasReport))
      .replace("{isLargeDoc}", String(observation.isLargeDoc))
      .replace("{isSubAgent}", String(this.isSubAgent));

    try {
      const result = await callModel(
        [{ role: "user", content: prompt }],
        { temperature: 0.3, maxTokens: 500 }
      );

      const candidate = extractJsonCandidate(result?.content);
      if (!candidate) {
        throw new Error("Failed to parse LLM thinking response");
      }

      const parsed = JSON.parse(candidate);
      const validActions = [
        "scan_and_identify_gaps",
        "retrieve_and_extract",
        "generate_report",
        "fork_subagents",
        "complete",
        "abort",
      ];

      const action = validActions.includes(parsed?.action) ? parsed.action : "complete";
      const thought = parsed?.thought || "";
      const reason = parsed?.reason || "LLM decision";

      // 流式输出思考内容
      if (this.streamingThink && thought) {
        await this._emitThoughtStream(state, thought);
      }

      const decision = {
        action,
        reason,
        thought,
        mode: "llm",
      };

      // 记录思考历史
      this._thinkingHistory.push({
        iteration: observation.iteration,
        observation: {
          openGapCount: observation.openGapCount,
          claimCount: observation.claimCount,
          hasReport: observation.hasReport,
        },
        decision,
        timestamp: Date.now(),
      });

      // 发出思考完成事件
      this._emit(StreamingThinkConfig.THOUGHT_COMPLETE_EVENT, {
        runId: state.runId,
        thought: decision.thought,
        action: decision.action,
        reason: decision.reason,
      });

      return decision;
    } catch (err) {
      logger?.warn("LLM thinking failed", {
        stage: "deepsearch-agent-loop",
        data: { error: err?.message },
      });
      // 回退到规则
      return think(observation, context);
    }
  }

  /**
   * 流式发出思考内容
   * @param {object} state - 状态
   * @param {string} thought - 思考内容
   */
  async _emitThoughtStream(state, thought) {
    const chunkSize = StreamingThinkConfig.DEFAULT_CHUNK_SIZE;
    const chunkDelay = StreamingThinkConfig.DEFAULT_CHUNK_DELAY;

    let offset = 0;
    while (offset < thought.length) {
      const chunk = thought.slice(offset, offset + chunkSize);
      offset += chunkSize;

      // 发出 delta 事件
      this._emit(StreamingThinkConfig.THOUGHT_DELTA_EVENT, {
        runId: state.runId,
        delta: chunk,
        offset: offset - chunkSize,
        total: thought.length,
        done: offset >= thought.length,
      });

      // 回调通知
      if (this.onThoughtDelta) {
        try {
          this.onThoughtDelta({
            delta: chunk,
            accumulated: thought.slice(0, offset),
            done: offset >= thought.length,
          });
        } catch (e) {
          // 忽略回调错误
        }
      }

      // 模拟流式延迟
      if (offset < thought.length && chunkDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, chunkDelay));
      }
    }
  }

  /**
   * 执行动作
   */
  async _execute(decision, state, stageApi, { logger, runContext }) {
    const { action, reason } = decision;

    switch (action) {
      case "scan_and_identify_gaps":
        return this._executeScanAndIdentifyGaps(state, stageApi, { logger, runContext });

      case "retrieve_and_extract":
        return this._executeRetrieveAndExtract(state, stageApi, { logger, runContext });

      case "generate_report":
        return this._executeGenerateReport(state, stageApi, { logger, runContext });

      case "fork_subagents":
        return this._executeForkSubAgents(state, stageApi, { logger, runContext });

      case "complete":
        return { completed: true, reason };

      case "abort":
        return { aborted: true, reason };

      default:
        logger.warn(`Unknown action: ${action}`, { stage: "deepsearch-agent-loop" });
        return { completed: true, reason: "unknown_action" };
    }
  }

  /**
   * 扫描 + 识别缺口
   */
  async _executeScanAndIdentifyGaps(state, stageApi, { logger }) {
    logger.info("Executing: scan_and_identify_gaps", { stage: "deepsearch-agent-loop" });

    // 调用能力
    if (this.capabilities.scanAndIdentifyGaps) {
      const result = await this.capabilities.scanAndIdentifyGaps(state, stageApi);
      return result;
    }

    // 默认实现：使用现有的 scan + gaps 函数
    const { runDeepSearchScanStage } = await import("./scan.js");
    const { runDeepSearchGapsStage } = await import("./gaps.js");

    await runDeepSearchScanStage({}, { state }, stageApi);
    await runDeepSearchGapsStage({}, { state }, stageApi);

    return { scanned: true, gapsIdentified: true };
  }

  /**
   * 检索 + 提取
   */
  async _executeRetrieveAndExtract(state, stageApi, { logger }) {
    logger.info("Executing: retrieve_and_extract", { stage: "deepsearch-agent-loop", data: { iteration: state.iteration } });

    // 调用能力
    if (this.capabilities.retrieveAndExtract) {
      const result = await this.capabilities.retrieveAndExtract(state, stageApi);
      state.iteration++;
      return result;
    }

    // 默认实现
    const { runDeepSearchRetrieveStage } = await import("./retrieve.js");
    const { runDeepSearchUnderstandStage } = await import("./understand.js");

    await runDeepSearchRetrieveStage({}, { state }, stageApi);
    await runDeepSearchUnderstandStage({}, { state }, stageApi);

    state.iteration++;
    return { retrieved: true, extracted: true };
  }

  /**
   * 生成报告
   */
  async _executeGenerateReport(state, stageApi, { logger }) {
    logger.info("Executing: generate_report", { stage: "deepsearch-agent-loop" });

    // 调用能力
    if (this.capabilities.generateReport) {
      const result = await this.capabilities.generateReport(state, stageApi);
      return result;
    }

    // 默认实现
    const { runDeepSearchWriteStage } = await import("./write.js");
    await runDeepSearchWriteStage({}, { state }, stageApi);

    return { reportGenerated: true };
  }

  /**
   * 分叉 SubAgents（大文档分治）
   * - Lead Agent 拆分文档
   * - 每个 SubAgent 处理不同片段
   * - SharedContext L1/L2 只读共享，L3 独立
   */
  async _executeForkSubAgents(state, stageApi, { logger, runContext }) {
    logger.info("Executing: fork_subagents", { stage: "deepsearch-agent-loop" });

    const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
    if (sources.length <= 1) {
      // 单文档，不需要分治
      return { forked: false, reason: "single_source" };
    }

    if (!isPlainObject(state.L2)) state.L2 = {};
    if (state.L2.subagentsForked) {
      return { forked: false, reason: "already_forked" };
    }
    state.L2.subagentsForked = true;

    // 创建共享的 SharedContext（如果没有）
    const sharedContext = this.sharedContext || new SharedContext({
      runId: state.runId,
      limits: {
        summariesMax: 20,
        indexKeywordsMax: 100,
      },
    });

    // 设置 Lead Agent 的初始摘要
    sharedContext.setSummary("lead_agent", {
      taskGoal: state.taskGoal,
      sourceCount: sources.length,
      startedAt: new Date().toISOString(),
    });

    const parentRunId = state.runId;
    const concurrency = resolveSubAgentConcurrency(state);
    state.L2.subagentConcurrency = concurrency;

    const subAgentResults = await mapConcurrent(sources, async (source, i) => {
      checkCancelled(stageApi?.signal);
      const subRunId = `${parentRunId}_sub_${i}`;
      const subState = new DeepSearchState({
        runId: subRunId,
        taskGoal: state.taskGoal,
        userConfig: state.userConfig,
        L0: { sources: [source] },
      });

      const subAgent = new DeepSearchAgentLoop({
        eventBus: this.eventBus,
        capabilities: this.capabilities,
        archive: this.archive, // 共享 Archive
        budgetManager: this.budgetManager,
        reviewRules: this.reviewRules, // 共享规则
        shadowConfig: this._shadowConfig,
        isSubAgent: true,
        parentAgentId: parentRunId,
        subAgentIndex: i,
        sharedContext, // 共享 SharedContext（只读 L1/L2）
      });

      const subMeta = {
        runId: subRunId,
        parentRunId,
        isSubAgent: true,
        subIndex: i,
      };
      const baseEventBus = stageApi?.eventBus || this.eventBus;
      const subEventBus = wrapEventBus(baseEventBus, subMeta);
      const subEmit = wrapEmit(stageApi?.emit, subMeta) || (subEventBus ? subEventBus.emit : null);

      try {
        const result = await subAgent.run(
          { state: subState },
          { ...stageApi, runContext, eventBus: subEventBus, emit: subEmit }
        );
        return { sourceId: source.sourceId, result, success: true, index: i };
      } catch (err) {
        return { sourceId: source.sourceId, error: err?.message, success: false, index: i };
      }
    }, concurrency);

    // 合并结果
    await this._mergeSubAgentResults(state, subAgentResults, stageApi, { logger, sharedContext });

    state.iteration++;
    return { forked: true, subAgentCount: sources.length, results: subAgentResults };
  }

  /**
   * 合并 SubAgent 结果
   */
  async _mergeSubAgentResults(state, subAgentResults, stageApi, { logger }) {
    logger.info("Merging SubAgent results", { stage: "deepsearch-agent-loop", data: { count: subAgentResults.length } });

    const successResults = subAgentResults.filter(r => r.success);
    if (successResults.length === 0) {
      logger.warn("No successful SubAgent results to merge", { stage: "deepsearch-agent-loop" });
      return;
    }

    const allClaims = [];
    const allEvidence = [];
    const allGaps = [];

    for (const [i, entry] of successResults.entries()) {
      const subIndex = Number.isFinite(entry?.index) ? entry.index : i;
      const { claims, evidenceLedger } = this._remapSubAgentResult(entry?.result, subIndex);
      if (claims.length) allClaims.push(...claims);
      if (evidenceLedger.length) allEvidence.push(...evidenceLedger);
      if (entry?.result?.gaps) allGaps.push(...entry.result.gaps);
    }

    const { evidenceLedger, evidenceIdMap } = this._deduplicateEvidenceLedger(allEvidence);
    const remappedClaims = allClaims.map((c) => {
      const evidenceIds = this._normalizeIdList(c?.evidenceIds);
      const mapped = evidenceIds.map((eid) => evidenceIdMap.get(eid) || eid);
      const uniqueEvidenceIds = Array.from(new Set(mapped));
      return { ...c, evidenceIds: uniqueEvidenceIds };
    });

    state.L1.claims = this._deduplicateClaims(remappedClaims);
    state.L1.evidenceLedger = evidenceLedger;
    state.L1.gaps = this._mergeGaps(allGaps);

    logger.info("SubAgent results merged", {
      stage: "deepsearch-agent-loop",
      data: { claimCount: state.L1.claims.length, evidenceCount: state.L1.evidenceLedger.length },
    });
  }

  _normalizeIdList(values) {
    const out = [];
    const seen = new Set();
    for (const v of Array.isArray(values) ? values : []) {
      const id = toNonEmptyString(v);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  _remapSubAgentResult(result, subIndex) {
    const prefix = `sub${subIndex}_`;
    const idMap = new Map();

    const evidenceLedger = Array.isArray(result?.evidenceLedger) ? result.evidenceLedger : [];
    const claims = Array.isArray(result?.claims) ? result.claims : [];

    const remappedEvidence = evidenceLedger.map((e, i) => {
      const baseId = toNonEmptyString(e?.evidenceId) || toNonEmptyString(e?.id) || `e_${i + 1}`;
      const newId = baseId.startsWith(prefix) ? baseId : `${prefix}${baseId}`;
      idMap.set(baseId, newId);
      const updated = { ...e, evidenceId: newId };
      if ("id" in e) updated.id = newId;
      return updated;
    });

    const remappedClaims = claims.map((c, i) => {
      const baseId = toNonEmptyString(c?.claimId) || toNonEmptyString(c?.id) || `c_${i + 1}`;
      const newId = baseId.startsWith(prefix) ? baseId : `${prefix}${baseId}`;
      const evidenceIds = this._normalizeIdList(c?.evidenceIds);
      const remappedEvidenceIds = evidenceIds
        .map((eid) => idMap.get(eid) || (eid.startsWith(prefix) ? eid : `${prefix}${eid}`))
        .filter(Boolean);
      const updated = { ...c, claimId: newId, evidenceIds: Array.from(new Set(remappedEvidenceIds)) };
      if ("id" in c) updated.id = newId;
      return updated;
    });

    return { claims: remappedClaims, evidenceLedger: remappedEvidence };
  }

  _deduplicateEvidenceLedger(evidenceLedger) {
    const byHash = new Map();
    const evidenceIdMap = new Map();
    const deduped = [];

    for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
      if (!e) continue;
      const evidenceId = toNonEmptyString(e?.evidenceId) || toNonEmptyString(e?.id);
      if (!evidenceId) continue;

      const key = evidenceContentKey(e) || evidenceId;
      const hash = contentHash(key);
      const existing = byHash.get(hash);
      if (!existing) {
        const normalized = { ...e, evidenceId };
        if ("id" in e) normalized.id = evidenceId;
        byHash.set(hash, { evidenceId, index: deduped.length });
        evidenceIdMap.set(evidenceId, evidenceId);
        deduped.push(normalized);
        continue;
      }

      evidenceIdMap.set(evidenceId, existing.evidenceId);
    }

    return { evidenceLedger: deduped, evidenceIdMap };
  }

  /**
   * 去重 claims
   */
  _deduplicateClaims(claims) {
    const seen = new Map();
    const deduped = [];

    for (const c of Array.isArray(claims) ? claims : []) {
      if (!c) continue;
      const key = claimContentKey(c);
      if (!key) continue;

      const hash = contentHash(key);
      const existing = seen.get(hash);
      if (!existing) {
        const evidenceIds = this._normalizeIdList(c?.evidenceIds);
        const gapIds = this._normalizeIdList(c?.gapIds);
        const normalized = { ...c, evidenceIds, ...(gapIds.length ? { gapIds } : {}) };
        deduped.push(normalized);
        seen.set(hash, { index: deduped.length - 1 });
        continue;
      }

      const prior = deduped[existing.index];
      const mergedEvidenceIds = Array.from(new Set([...this._normalizeIdList(prior?.evidenceIds), ...this._normalizeIdList(c?.evidenceIds)]));
      const mergedGapIds = Array.from(new Set([...this._normalizeIdList(prior?.gapIds), ...this._normalizeIdList(c?.gapIds)]));
      deduped[existing.index] = {
        ...prior,
        evidenceIds: mergedEvidenceIds,
        ...(mergedGapIds.length ? { gapIds: mergedGapIds } : {}),
      };
    }

    return deduped;
  }

  /**
   * 合并 gaps
   */
  _mergeGaps(gaps) {
    const seen = new Set();
    return gaps.filter(g => {
      const key = g?.question?.toLowerCase().trim() || g?.gapId;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 自审查 - 3 层监督策略
   * Layer 1: ReviewRules (规则检查，纯代码)
   * Layer 2: ShadowAgent (轻量 LLM 验证)
   * Layer 3: Agent 自审查 (完整分析，replan 能力)
   */
  async _review(decision, result, state, stageApi) {
    // Layer 1: ReviewRules 规则检查
    const stageKey = `deepsearch.${decision.action}`;
    const ruleResult = this.reviewRules.check(stageKey, result);
    if (!ruleResult.pass && ruleResult.severity === "error") {
      return {
        decision: AgentDecision.RETRY,
        reason: ruleResult.reason,
        suggestions: ruleResult.suggestions,
        layer: "rules",
      };
    }

    // Layer 2: ShadowAgent 验证（关键内容）
    const claims = Array.isArray(result?.claims) ? result.claims : [];
    const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

    if (claims.length > 0 && evidenceLedger.length > 0) {
      // 延迟初始化 ShadowAgent
      if (!this._shadowAgent && stageApi) {
        this._shadowAgent = createShadowAgent(stageApi, state, this._shadowConfig);
      }

      if (this._shadowAgent) {
        try {
          const shadowResults = await this._shadowAgent.validateBatch(
            claims.slice(0, 5), // 限制验证数量
            evidenceLedger,
            { round: state.iteration || 0 }
          );

          const invalidCount = shadowResults.filter(r => !r.valid && !r.skipped).length;
          const totalValidated = shadowResults.filter(r => !r.skipped).length;

          // 超过 50% 验证失败，需要重试
          if (totalValidated > 0 && invalidCount / totalValidated > 0.5) {
            return {
              decision: AgentDecision.RETRY,
              reason: `ShadowAgent: ${invalidCount}/${totalValidated} claims failed validation`,
              shadowResults,
              layer: "shadow",
            };
          }
        } catch (err) {
          // ShadowAgent 失败不阻塞主流程
          console.warn("[DeepSearchAgentLoop] ShadowAgent validation failed:", err?.message);
        }
      }
    }

    // Layer 3: 能力注入的规则检查（自定义验证）
    if (this.capabilities.validateRules) {
      const customResult = await this.capabilities.validateRules(decision, result, state);
      if (!customResult.pass) {
        return {
          decision: customResult.severity === "fatal" ? AgentDecision.ABORT : AgentDecision.RETRY,
          reason: customResult.reason,
          layer: "custom",
        };
      }
    }

    // 完成条件
    if (result?.completed || result?.aborted) {
      return {
        decision: result.aborted ? AgentDecision.ABORT : AgentDecision.COMPLETE,
        reason: result.reason,
      };
    }

    return { decision: AgentDecision.CONTINUE };
  }

  /**
   * 压缩记忆（金蝉脱壳）
   * - Working Memory → Condensed Memory (精华)
   * - 完整状态 → Archive (冷存储)
   */
  async _compressMemory(state, stageApi) {
    // 1. 使用能力注入的压缩器（如 CicadaCompressor）
    if (this.capabilities.compressMemory) {
      const compressed = await this.capabilities.compressMemory(state, stageApi);
      if (compressed) {
        state.L1.condensedMemory = compressed.summary;
      }
    } else {
      // 默认压缩策略：保留 claims + evidence IDs，丢弃中间过程
      const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
      const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];

      state.L1.condensedMemory = {
        claimCount: claims.length,
        claimSummary: claims.slice(0, 10).map(c => c?.text?.slice(0, 100)),
        openGapCount: gaps.filter(g => g?.status === "open").length,
        filledGapCount: gaps.filter(g => g?.status === "filled").length,
        iteration: state.iteration,
        compressedAt: new Date().toISOString(),
      };
    }

    // 2. 清理 L2 详细数据（保留最近的 chunk）
    if (state.L2?.retrievedChunks?.length > 100) {
      state.L2.retrievedChunks = state.L2.retrievedChunks.slice(-50);
    }

    // 3. 归档完整状态到 Archive（蝉蜕存档）
    if (this.archive) {
      try {
        await this._saveCheckpoint(state, {
          runId: state.runId,
          iteration: state.iteration,
          kind: "memory_compress",
        });
      } catch (err) {
        console.warn("[DeepSearchAgentLoop] Archive save failed:", err?.message);
      }
    }

    // 4. 更新 SharedContext（如果有）
    if (this.sharedContext && typeof this.sharedContext.setSummary === "function") {
      const summaryKey = this.isSubAgent
        ? buildSubAgentSummaryKey(this.parentAgentId || state.runId, this.subAgentIndex)
        : `deepsearch_${state.iteration}`;
      this.sharedContext.setSummary(summaryKey, state.L1.condensedMemory);
    }
  }

  /**
   * 构建输出
   */
  _buildOutput(state, runContext) {
    const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
    const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
    const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
    const slideIntents = Array.isArray(state?.L1?.slideIntents) ? state.L1.slideIntents : [];
    const dataTables = Array.isArray(state?.L1?.dataTables) ? state.L1.dataTables : [];
    const assets = Array.isArray(state?.L0?.assets) ? state.L0.assets : [];

    return buildContentPackage(
      runContext || { runId: state.runId, mode: "deepsearch", constraints: {} },
      sources,
      slideIntents,
      claims,
      evidenceLedger,
      dataTables,
      {
        mode: "deepsearch",
        scanSummary: state?.L1?.scanSummary || null,
        gaps: Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [],
        condensedMemory: state?.L1?.condensedMemory || null,
        report: state?.L1?.report || null,
        assets,
      }
    );
  }

  /**
   * 确保状态对象
   */
  _ensureState(runContext, input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

    const sources = Array.isArray(input?.sources) ? input.sources : [];
    const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
    const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

    const state = new DeepSearchState({
      runId: runContext?.runId,
      taskGoal,
      userConfig,
      L0: { sources },
    });

    const maxIt = safeInt(userConfig?.maxIterations);
    if (maxIt !== null && maxIt >= 1) state.maxIterations = maxIt;

    return state;
  }

  _emit(name, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") {
      emit(name, { actor: "deepsearch-agent-loop", status: "info", payload });
    }
  }
}

/**
 * 便捷入口函数
 */
export async function runDeepSearchAgentLoop(runContext, input, stageApi = {}) {
  const agentLoop = new DeepSearchAgentLoop({
    eventBus: stageApi?.eventBus,
    archive: stageApi?.archive,
    budgetManager: stageApi?.budgetManager,
  });

  return agentLoop.execute(runContext, input, stageApi);
}

/**
 * 从 checkpoint 恢复 Agent Loop
 * @param {string} checkpointId - checkpoint ID
 * @param {object} stageApi - Stage API
 * @returns {Promise<object>} 执行结果
 */
export async function resumeDeepSearchAgentLoop(checkpointId, stageApi = {}) {
  const archive = stageApi?.archive || new Archive(new MapAdapter());

  // 加载 checkpoint
  const snapshot = migrateCheckpoint(await archive.restore(checkpointId));
  if (!snapshot?.nodeStates) {
    throw new Error(`Checkpoint not found or invalid: ${checkpointId}`);
  }

  // 恢复状态
  const state = DeepSearchState.fromJSON(snapshot.nodeStates);
  const runContext = { runId: state.runId };

  // 创建 Agent Loop
  const agentLoop = new DeepSearchAgentLoop({
    eventBus: stageApi?.eventBus,
    archive,
    budgetManager: stageApi?.budgetManager,
  });

  // 重置 pause 标志
  agentLoop._pauseRequested = false;
  agentLoop._pauseReason = null;

  // 从 checkpoint 继续执行
  return agentLoop.execute(runContext, { state }, stageApi);
}

export default DeepSearchAgentLoop;
