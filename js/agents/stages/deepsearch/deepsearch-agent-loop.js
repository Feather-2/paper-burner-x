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
import {
  AGENT_LOOP_CONFIG,
  CONCURRENCY_CONFIG,
  SMALL_DOC_TOKEN_THRESHOLD,
  AgentLoopStatus,
  agentLoopMachine,
} from "./constants.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/value-utils.js";
import { createStageApi, createRunTool } from "../../shared/stage-api.js";
import { buildContentPackage } from "../textprep/build-content-package.js";
import { ShadowAgent, createShadowAgent } from "./shadow-agent.js";
import { ReviewRules } from "../../runtime/review-rules.js";
import { Archive, MapAdapter } from "../../shared/archive.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/checkpoint-schema.js";
import { SharedContext } from "./shared-context.js";
import { mapConcurrent } from "../../shared/concurrency.js";
import { BacktrackManager } from "./backtrack-manager.js";
import { observe, think, AgentDecision } from "./step-runner.js";
import { BudgetAction, createBudgetManager } from "./budget.js";
import { collectMetrics, formatMetricsReport } from "./metrics.js";

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

// AgentDecision 从 step-runner.js 导入
export { AgentDecision } from "./step-runner.js";

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
- 待办事项: {openTodoCount}
- 已完成待办: {completedTodoCount}
- 已阻塞待办: {blockedTodoCount}
- 是否有报告: {hasReport}
- 是否大文档: {isLargeDoc}
- 是否子代理: {isSubAgent}

## 可用动作
1. scan_and_identify_gaps - 扫描文档，生成研究待办
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

function getTodoStats(state) {
  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const useTodos = todos.length > 0;
  const items = useTodos ? todos : gaps;
  const statusOf = (item) => {
    const raw = String(item?.status || "open").toLowerCase();
    if (useTodos) {
      if (raw === "completed") return "completed";
      if (raw === "cancelled") return "blocked";
      if (raw === "pending") return "open";
      return "open";
    }
    if (raw === "filled") return "completed";
    if (raw === "blocked") return "blocked";
    if (raw === "searching" || raw === "understanding") return "open";
    return "open";
  };

  const openTodos = items.filter((t) => statusOf(t) === "open");
  const completedTodos = items.filter((t) => statusOf(t) === "completed");
  const blockedTodos = items.filter((t) => statusOf(t) === "blocked");
  const openGaps = gaps.filter((g) => g?.status === "open" || !g?.status);
  const filledGaps = gaps.filter((g) => g?.status === "filled");
  const totalGaps = gaps.length || items.length;
  const openGapCount = gaps.length ? openGaps.length : openTodos.length;
  const filledGapCount = gaps.length ? filledGaps.length : completedTodos.length;

  return {
    totalTodos: items.length,
    openTodoCount: openTodos.length,
    completedTodoCount: completedTodos.length,
    blockedTodoCount: blockedTodos.length,
    openTodos,
    completedTodos,
    blockedTodos,
    totalGaps,
    openGapCount,
    filledGapCount,
  };
}

function resolveL2Guard(state) {
  const l2 = isPlainObject(state?.L2) ? state.L2 : {};
  if (l2.awaitUserFeedback) {
    return {
      action: "pause",
      reason: toNonEmptyString(l2.reason) || "Awaiting user feedback.",
    };
  }
  if (l2.taskImpossible) {
    return {
      action: "complete",
      reason: toNonEmptyString(l2.reason) || "Task marked impossible.",
    };
  }
  return null;
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
    // CapabilityLoader: 动态能力发现（第二优先级）
    this.capabilityLoader = options.capabilityLoader || null;
    // TempSkillStore: 临时 Skill 存储
    this.tempSkillStore = options.tempSkillStore || null;
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

    // 春秋蝉: 回溯管理器
    this.maxBacktracks = safeInt(options.maxBacktracks) ?? AGENT_LOOP_CONFIG.MAX_BACKTRACKS;
    this._backtrackManager = new BacktrackManager({
      archive: this.archive,
      maxBacktracks: this.maxBacktracks,
      emit: (name, payload) => this._emit(name, payload),
      logger: createLogger("backtrack-manager"),
    });
    this._budgetStopRequested = false;
    this._budgetDegradeApplied = false;

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
   * 请求暂停：立即中断当前步骤，并在安全边界进入暂停态
   */
  pause(reason = "user_requested") {
    super.pause(reason);
  }

  get isPaused() {
    return this._pauseRequested;
  }

  /**
   * 动态能力解析
   * 优先级：capabilities 注入 > CapabilityLoader > TempSkillStore > null
   * @param {string} name - 能力名称
   * @param {Object} state - 当前状态
   * @param {Object} stageApi - Stage API
   * @returns {Promise<Function|null>}
   */
  async _resolveCapability(name, state, stageApi) {
    // 1. 已在调用方检查过 capabilities 注入，这里跳过

    // 2. 尝试 CapabilityLoader
    if (this.capabilityLoader?.hasCapability(name)) {
      await this.capabilityLoader.loadRequired([name]);
      // CapabilityLoader 加载后，能力可能在 skills/blocks/mcp 中
      // 返回一个包装函数，通过 stageApi 调用
      return async (s, api) => {
        // 如果 CapabilityLoader 有 execute 方法
        if (typeof this.capabilityLoader.execute === "function") {
          return this.capabilityLoader.execute(name, s, api);
        }
        // 否则返回 null，让调用方使用默认实现
        return null;
      };
    }

    // 3. 尝试 TempSkillStore
    if (this.tempSkillStore?.hasCapability(name)) {
      const skill = await this.tempSkillStore.get(name);
      if (skill?.handler) {
        return skill.handler;
      }
    }

    return null;
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

  get _backtrackCount() {
    return this._backtrackManager?.backtrackCount ?? 0;
  }

  set _backtrackCount(value) {
    if (!this._backtrackManager) return;
    const next = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    this._backtrackManager._backtrackCount = next;
  }

  _getLastCheckpointId() {
    const history = Array.isArray(this._statusHistory) ? this._statusHistory : [];
    for (let i = history.length - 1; i >= 0; i--) {
      const id = history[i]?.checkpointId;
      if (id) return id;
    }
    return null;
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
    // 自动注入 runTool（如果 modelRouter 存在且 runTool 未提供）
    if (!stageApi.runTool && stageApi.modelRouter) {
      stageApi.runTool = createRunTool({
        modelRouter: stageApi.modelRouter,
        signal: stageApi.signal,
        logger: stageApi.logger,
      });
    }
    this.eventBus = stageApi.eventBus || this.eventBus;
    this.emit = typeof stageApi.emit === "function" ? stageApi.emit : this.emit;

    // 初始化状态
    const state = this._ensureState(runContext, input);
    if (runContext?.runId) state.runId = String(runContext.runId);
    this._currentState = state;
    this._budgetStopRequested = false;
    this._budgetDegradeApplied = false;
    if (!isPlainObject(state.L2)) state.L2 = {};
    if (!isPlainObject(state?.L1?.report)) {
      const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
      const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
      const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
      const todoStats = getTodoStats(state);
      if (
        todoStats.openTodoCount === 0 &&
        (todoStats.totalTodos > 0 || gaps.length > 0 || claims.length > 0 || evidenceLedger.length > 0)
      ) {
        state.L2.needsWrite = true;
      }
    }

    const sharedContext =
      stageApi?.sharedContext ||
      this.sharedContext ||
      (this.isSubAgent ? null : new SharedContext({ runId: state.runId }));
    if (sharedContext) {
      this.sharedContext = sharedContext;
      stageApi.sharedContext = sharedContext;
      if (typeof stageApi.getContextSummary !== "function") {
        stageApi.getContextSummary = () => {
          let text = sharedContext.buildSummaryText();
          const history = state?.L2?.thoughtHistory;
          if (Array.isArray(history) && history.length > 0) {
            const historyText = history
              .map((h) => `[Retry/Correction] Previous failure in ${h.stage}: ${h.reason}`)
              .join("\n");
            text = `## 历史经验 (Self-Correction)\n${historyText}\n\n${text}`;
          }
          return text;
        };
      }
    }

    const budgetConfig = typeof state?.getBudgetConfig === "function" ? state.getBudgetConfig() : null;
    const budgetManager = this.budgetManager || stageApi?.budgetManager || createBudgetManager(state?.userConfig);
    this.budgetManager = budgetManager;
    stageApi.budgetManager = budgetManager;
    stageApi.getBudgetStats = () => budgetManager.getStats();
    if (typeof budgetManager?.reset === "function") {
      budgetManager.reset();
    }

    const applyBudgetDegrade = ({ reason } = {}) => {
      if (this._budgetDegradeApplied) return;
      this._budgetDegradeApplied = true;
      budgetManager.degraded = true;

      if (!isPlainObject(state.userConfig)) state.userConfig = {};
      if (!isPlainObject(state.userConfig.retrieval)) state.userConfig.retrieval = {};

      if (!isPlainObject(state.userConfig.retrieval.rerank)) state.userConfig.retrieval.rerank = {};
      state.userConfig.retrieval.rerank.enabled = false;

      if (!isPlainObject(state.userConfig.retrieval.shadow)) state.userConfig.retrieval.shadow = {};
      state.userConfig.retrieval.shadow.enabled = false;

      if (!isPlainObject(state.userConfig.externalSearch)) state.userConfig.externalSearch = {};
      state.userConfig.externalSearch.autoTrigger = false;

      const curIt = safeInt(state.iteration) ?? 0;
      const nextMax = curIt + 1;
      const prevMax = safeInt(state.maxIterations) ?? nextMax;
      state.maxIterations = Math.min(prevMax, nextMax);

      state.addTimeline?.({
        name: "deepsearch.budget.degraded",
        status: "warning",
        payload: { maxIterations: state.maxIterations, iteration: state.iteration, ...(reason ? { reason: String(reason) } : {}) },
      });
    };

    const requestBudgetStop = ({ reason, payload } = {}) => {
      if (this._budgetStopRequested) return;
      this._budgetStopRequested = true;
      budgetManager.stopped = true;
      state.addTimeline?.({
        name: "deepsearch.budget.stop",
        status: "warning",
        payload: { ...(payload && typeof payload === "object" ? payload : {}), ...(reason ? { reason: String(reason) } : {}) },
      });
    };

    const extractPayload = (record) => {
      if (record && typeof record === "object" && "payload" in record) return record.payload;
      return record;
    };

    const handleTokenUsage = (record) => {
      const payload = extractPayload(record);
      const usage = payload && typeof payload === "object" ? payload.usage : null;
      const input = safeInt(usage?.input) ?? 0;
      const output = safeInt(usage?.output) ?? 0;
      const action = budgetManager.recordUsage({ input, output });
      if (action === BudgetAction.STOP) {
        requestBudgetStop({ reason: "token_usage" });
      } else if (action === BudgetAction.DEGRADE) {
        applyBudgetDegrade({ reason: "token_usage" });
      }
    };

    const handleBudgetExceeded = (record) => {
      const payload = extractPayload(record);
      const action = typeof budgetConfig?.action === "string" ? budgetConfig.action : "warn";
      if (action === "degrade") {
        applyBudgetDegrade({ reason: "budget_exceeded" });
        return;
      }
      if (action === "stop") {
        requestBudgetStop({ reason: "budget_exceeded", payload });
      }
    };

    if (typeof stageApi.emit === "function") {
      const baseEmit = stageApi.emit;
      stageApi.emit = (name, record, ...rest) => {
        const result = baseEmit(name, record, ...rest);
        if (name === "deepsearch.token.usage") {
          try {
            handleTokenUsage(record);
          } catch {
            // ignore handler errors
          }
        } else if (name === "deepsearch.budget.exceeded") {
          try {
            handleBudgetExceeded(record);
          } catch {
            // ignore handler errors
          }
        }
        return result;
      };
      this.emit = stageApi.emit;
    }

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
    this._emitLegacy("deepsearch.started", { runId: state.runId });

    try {
      await this._transitionTo(AgentLoopStatus.RUNNING, { runId: state.runId });

      // 小文档直通模式检测
      const directModeCheck = shouldUseDirectMode(state);
      const preLoopGuard = resolveL2Guard(state);
      if (directModeCheck.shouldUse && !this.isSubAgent && !preLoopGuard) {
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
        this._emitLegacy("deepsearch.completed", { runId: state.runId, iterations: state.iteration, mode: "direct" });
        return pkg;
      }

      // Agent Loop 主循环
      let loopCount = 0;
      const maxLoops = (state.maxIterations || 5) * 3; // 安全上限

      while (loopCount < maxLoops) {
        loopCount++;
        checkCancelled(stageApi?.signal);

        const guard = resolveL2Guard(state);
        if (guard?.action === "pause") {
          throw new StagePausedError("Run paused", { runId: state.runId, reason: guard.reason });
        }
        if (guard?.action === "complete") {
          if (!isPlainObject(state.L2)) state.L2 = {};
          if (!toNonEmptyString(state.L2.reason)) state.L2.reason = guard.reason;
          break;
        }

        const { step: stepMeta, context: stepContext } = this._beginStep(
          { name: "deepsearch.iteration", runId: state.runId, iteration: loopCount },
          stageApi
        );
        const stepSignal = stepContext.signal;
        const stepApi = { ...stageApi, signal: stepSignal };

        try {
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
          const decision = await this._think(observation, state, stepApi, {
            budgetExhausted: this.budgetManager?.stopped,
            aborted: stageApi?.signal?.aborted,
            isSubAgent: this.isSubAgent,
            subagentsForked: Boolean(state?.L2?.subagentsForked),
            logger,
          });

          if (decision?.action && stepMeta) {
            stepMeta.name = decision.action;
            stepMeta.meta = {
              ...(stepMeta.meta || {}),
              action: decision.action,
              reason: decision.reason,
            };
          }

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
          const result = await this._execute(decision, state, stepApi, { logger, runContext });

          // 4. 评估 + 自审查
          await this._transitionTo(AgentLoopStatus.REVIEWING, {
            runId: state.runId,
            iteration: loopCount,
          });
          const review = await this._review(decision, result, state, stageApi);

          // 5. 决策
          if (review.decision === AgentDecision.COMPLETE) {
            await this._transitionTo(AgentLoopStatus.COMPLETED, { runId: state.runId });
            this._endStep({ step: stepMeta }, { status: "completed" });
            break;
          }
          if (review.decision === AgentDecision.ABORT) {
            throw new Error(review.reason || "Agent aborted");
          }

          let shouldBreak = false;
          if (review.decision === AgentDecision.BACKTRACK) {
            const backtrackResult = await this._backtrackManager.backtrack(state, review.checkpointId);
            if (backtrackResult.success && backtrackResult.state) {
              Object.assign(state, backtrackResult.state);
            } else if (backtrackResult.reason === "limit_reached") {
              shouldBreak = true;
            }
          }

          // 压缩记忆（金蝉脱壳）：根据 Context 填充率动态触发
          const tokenStats = this.budgetManager?.getStats()?.usage || {};
          const currentTotalTokens = tokenStats.total || 0;
          const maxTotalTokens = this.budgetManager?.limits?.total || 100000;
          const fillRatio = currentTotalTokens / maxTotalTokens;
          const shouldCompress =
            !shouldBreak &&
            (fillRatio > AGENT_LOOP_CONFIG.COMPRESS_FILL_RATIO ||
              loopCount % AGENT_LOOP_CONFIG.COMPRESS_INTERVAL_LOOPS === 0);

          if (shouldCompress) {
            await this._compressMemory(state, stepApi);
          }

          this._endStep({ step: stepMeta }, { status: "completed" });
          if (shouldBreak) break;
        } catch (err) {
          if (err instanceof StagePausedError) {
            this._endStep({ step: stepMeta }, { status: "paused", error: err.message });
            throw err;
          }

          const pauseLike = this._shouldPauseFromError(err, stepSignal);
          if (pauseLike) {
            const message = err instanceof Error ? err.message : String(err);
            const fallbackCheckpointId = this._getLastCheckpointId();
            this._endStep({ step: stepMeta }, { status: "paused", error: message });
            if (this._loopStatus !== AgentLoopStatus.PAUSED) {
              try {
                this._applyTransition(AgentLoopStatus.PAUSED, {
                  runId: state.runId,
                  iteration: loopCount,
                  ...(fallbackCheckpointId ? { checkpointId: fallbackCheckpointId } : {}),
                  pausedReason: message,
                });
              } catch {
                // ignore invalid transition
              }
            }
            const pauseError = this._createPauseError({ signal: stageApi.signal, runId: state.runId });
            if (!pauseError.checkpointId && fallbackCheckpointId) {
              pauseError.checkpointId = fallbackCheckpointId;
            }
            throw pauseError;
          }

          const message = err instanceof Error ? err.message : String(err);
          this._endStep({ step: stepMeta }, { status: "failed", error: message });
          throw err;
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

      // 确保 report 存在（H5 hard gate 要求）
      if (!isPlainObject(state?.L1?.report)) {
        const { generateReport, generatePlaceholderReport } = await import("./write.js");
        const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
        const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
        const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
        const todos = Array.isArray(state?.todos) ? state.todos : [];
        const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
        const todoInput = todos.length ? todos : gaps;
        const allTodosResolved =
          todos.length > 0 &&
          todos.every((t) => {
            const status = typeof t?.status === "string" ? t.status : "open";
            return status === "completed" || status === "cancelled";
          });
        const completionReason =
          toNonEmptyString(state?.L2?.reason) ||
          (state?.L2?.taskImpossible ? "Task marked impossible." : "All todos completed.");
        state.L1.report = allTodosResolved
          ? generatePlaceholderReport({ taskGoal: state?.taskGoal, todos, completionReason })
          : generateReport(claims, evidenceLedger, todoInput, sources, String(state?.taskGoal || ""));
        logger.warn("Generated fallback report for H5 gate", { stage: "deepsearch-agent-loop" });
      }

      // 构建输出
      const pkg = this._buildOutput(state, runContext);

      logger.info("DeepSearch Agent Loop completed", {
        stage: "deepsearch-agent-loop",
        data: { runId: state.runId, iterations: state.iteration, loopCount },
      });

      this._emit("deepsearch.agent.completed", { runId: state.runId, iterations: state.iteration });
      this._emitLegacy("deepsearch.completed", { runId: state.runId, iterations: state.iteration });

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

      if (stageApi?.signal?.aborted) {
        const reason = typeof stageApi.signal.reason === "string" ? stageApi.signal.reason : err?.message;
        state.addTimeline?.({ name: "deepsearch.aborted", status: "warning", payload: { iteration: state.iteration, reason } });
        this._emit("deepsearch.agent.aborted", { runId: state.runId, reason });
        this._emitLegacy("deepsearch.aborted", { runId: state.runId, reason, iteration: state.iteration });
        try {
          await this._transitionTo(AgentLoopStatus.ABORTED, {
            runId: state.runId,
            error: reason,
          });
        } catch {
          // ignore secondary transition failures
        }
        if (!isPlainObject(state?.L1?.report)) {
          const { generateReport, generatePlaceholderReport } = await import("./write.js");
          const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
          const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
          const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
          const todos = Array.isArray(state?.todos) ? state.todos : [];
          const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
          const todoInput = todos.length ? todos : gaps;
          const allTodosResolved =
            todos.length > 0 &&
            todos.every((t) => {
              const status = typeof t?.status === "string" ? t.status : "open";
              return status === "completed" || status === "cancelled";
            });
          const completionReason =
            toNonEmptyString(state?.L2?.reason) ||
            (state?.L2?.taskImpossible ? "Task marked impossible." : "All todos completed.");
          state.L1.report = allTodosResolved
            ? generatePlaceholderReport({ taskGoal: state?.taskGoal, todos, completionReason })
            : generateReport(claims, evidenceLedger, todoInput, sources, String(state?.taskGoal || ""));
        }
        return this._buildOutput(state, runContext);
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
      this._emitLegacy("deepsearch.failed", { runId: state.runId, error: err.message });
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
    const hasUserNotes = this.hasPendingUserInputs();

    // 规则模式：使用纯规则决策
    if (this.thinkingMode === ThinkingMode.RULES) {
      if (hasUserNotes) {
        return this._thinkWithLLM(observation, state, stageApi, context);
      }
      return think(observation, { budgetExhausted, aborted, isSubAgent });
    }

    // LLM 模式：完全使用 LLM 思考
    if (this.thinkingMode === ThinkingMode.LLM) {
      return this._thinkWithLLM(observation, state, stageApi, context);
    }

    // 混合模式：规则优先，复杂/不确定情况用 LLM
    const rulesDecision = think(observation, { budgetExhausted, aborted, isSubAgent });

    if (hasUserNotes) {
      try {
        return await this._thinkWithLLM(observation, state, stageApi, context);
      } catch (err) {
        logger?.warn("交错思考: 用户意见触发的 LLM 思考失败，回退规则", {
          stage: "deepsearch-agent-loop",
          data: { error: err?.message },
        });
        return rulesDecision;
      }
    }

    // 触发 LLM 思考的条件
    const shouldUseLLM =
      // 情况不明确（多个可能动作）
      (observation.openTodoCount > 0 && observation.claimCount > 0 && !observation.hasReport) ||
      // 迭代次数过半仍有待办
      (observation.iteration > observation.maxIterations / 2 && observation.openTodoCount > 0) ||
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

    const { items: userInputItems, text: userNotes } = this.drainUserInputsAsText();
    if (userNotes) {
      const baseConfig = isPlainObject(state?.userConfig) ? state.userConfig : {};
      const existing = Array.isArray(baseConfig.userNotes) ? baseConfig.userNotes : [];
      state.userConfig = {
        ...baseConfig,
        userNotes: [...existing, userNotes],
        _lastUserNote: userNotes,
        _lastUserNoteAt: Date.now(),
        _rawUserInputs: Array.isArray(baseConfig._rawUserInputs)
          ? [...baseConfig._rawUserInputs, ...userInputItems]
          : [...userInputItems],
      };
    }

    // 构建 ReAct prompt
    const prompt = REACT_THINK_PROMPT
      .replace("{taskGoal}", state.taskGoal || "分析文档")
      .replace("{iteration}", String(observation.iteration))
      .replace("{maxIterations}", String(observation.maxIterations))
      .replace("{sourceCount}", String(observation.sourceCount))
      .replace("{claimCount}", String(observation.claimCount))
      .replace("{evidenceCount}", String(observation.evidenceCount))
      .replace("{openTodoCount}", String(observation.openTodoCount))
      .replace("{completedTodoCount}", String(observation.completedTodoCount))
      .replace("{blockedTodoCount}", String(observation.blockedTodoCount))
      .replace("{hasReport}", String(observation.hasReport))
      .replace("{isLargeDoc}", String(observation.isLargeDoc))
      .replace("{isSubAgent}", String(this.isSubAgent));
    const finalPrompt = userNotes
      ? `${prompt}\n\n## 用户意见\n${userNotes}`
      : prompt;

    try {
      const result = await callModel(
        [{ role: "user", content: finalPrompt }],
        { temperature: 0.3, maxTokens: 500, signal: stageApi?.signal }
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
          openTodoCount: observation.openTodoCount,
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
    const sharedContext = stageApi?.sharedContext || this.sharedContext;

    // 1. 优先使用注入的 capabilities
    if (this.capabilities.scanAndIdentifyGaps) {
      const result = await this.capabilities.scanAndIdentifyGaps(state, stageApi);
      return result;
    }

    // 2. 尝试 CapabilityLoader 动态发现
    const dynamicHandler = await this._resolveCapability("scanAndIdentifyGaps", state, stageApi);
    if (dynamicHandler) {
      const result = await dynamicHandler(state, stageApi);
      return result;
    }

    // 3. 默认实现：使用现有的 scan + todos 函数
    const { runDeepSearchScanStage } = await import("./scan.js");
    const { runDeepSearchTodosStage } = await import("./todos.js");

    await runDeepSearchScanStage({}, { state }, stageApi);
    if (sharedContext && typeof sharedContext.commit === "function") {
      const scanSources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
      const totalChars = scanSources.reduce((sum, s) => sum + (s?.sourceTextNormalized?.length || 0), 0);
      sharedContext.commit("scan", {
        summary: `${scanSources.length} 个来源，共 ${totalChars} 字符，主题：${String(state?.taskGoal || "").slice(0, 60)}`,
        keywords: [state?.taskGoal, ...(state?.L1?.scanSummary?.keyTopics || [])].filter(Boolean).slice(0, 10),
      });
    }

    if (this._budgetStopRequested || this.budgetManager?.stopped) {
      return { completed: true, reason: "budget_stop", forceOutput: true };
    }

    await runDeepSearchTodosStage({}, { state }, stageApi);
    if (sharedContext && typeof sharedContext.commit === "function") {
      const todoStats = getTodoStats(state);
      const openTodos = todoStats.openTodos || [];
      const keywords = openTodos.map((t) => t?.text || t?.question).filter(Boolean).slice(0, 8);
      sharedContext.commit("todos", {
        summary: `${openTodos.length}/${todoStats.totalTodos} 个待办待处理`,
        keywords,
        full: openTodos,
      });
      sharedContext.commit("gaps", {
        summary: `${todoStats.openGapCount}/${todoStats.totalGaps} 个缺口待处理`,
        keywords,
        full: openTodos,
      });
    }

    return { scanned: true, gapsIdentified: true, todosIdentified: true };
  }

  /**
   * 检索 + 提取
   */
  async _executeRetrieveAndExtract(state, stageApi, { logger }) {
    logger.info("Executing: retrieve_and_extract", { stage: "deepsearch-agent-loop", data: { iteration: state.iteration } });
    const iteration = state.iteration;
    const sharedContext = stageApi?.sharedContext || this.sharedContext;
    const todoStats = getTodoStats(state);
    this._emitLegacy("deepsearch.iteration.started", {
      runId: state.runId,
      iteration,
      openTodoCount: todoStats.openTodoCount,
      completedTodoCount: todoStats.completedTodoCount,
      blockedTodoCount: todoStats.blockedTodoCount,
      totalTodos: todoStats.totalTodos,
      openGapCount: todoStats.openGapCount,
    });

    // 1. 优先使用注入的 capabilities
    if (this.capabilities.retrieveAndExtract) {
      const result = await this.capabilities.retrieveAndExtract(state, stageApi);
      state.iteration++;
      return result;
    }

    // 2. 尝试 CapabilityLoader 动态发现
    const dynamicHandler = await this._resolveCapability("retrieveAndExtract", state, stageApi);
    if (dynamicHandler) {
      const result = await dynamicHandler(state, stageApi);
      state.iteration++;
      return result;
    }

    // 3. 默认实现
    const { runDeepSearchRetrieveStage } = await import("./retrieve.js");
    const { runDeepSearchUnderstandStage } = await import("./understand.js");

    const retOut = await runDeepSearchRetrieveStage({}, { state }, stageApi);
    if (sharedContext && typeof sharedContext.commit === "function") {
      const retrievedChunks = Array.isArray(retOut?.retrievedChunks) ? retOut.retrievedChunks : state?.L2?.retrievedChunks;
      const totalRetrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0;
      const hitCount = Array.isArray(retrievedChunks) ? retrievedChunks.length : 0;
      sharedContext.commit("retrieve", {
        summary: `检索 ${hitCount} 个 chunk，累计 ${totalRetrieved} 个`,
        keywords: Array.isArray(retrievedChunks)
          ? retrievedChunks
              .slice(0, 5)
              .flatMap((r) => r?.matchedTodoIds || r?.matchedGapIds || [])
              .filter(Boolean)
          : [],
      });
    }

    if (this._budgetStopRequested || this.budgetManager?.stopped) {
      return { completed: true, reason: "budget_stop", forceOutput: true };
    }

    await runDeepSearchUnderstandStage({}, { state }, stageApi);
    if (sharedContext && typeof sharedContext.commit === "function") {
      const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
      const evidenceCount = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger.length : 0;
      const updatedStats = getTodoStats(state);
      const filledGapsCount = updatedStats.filledGapCount;
      const completedTodoCount = updatedStats.completedTodoCount;
      sharedContext.commit("understand", {
        summary: `提取 ${claims.length} 个论点，${evidenceCount} 条证据，${completedTodoCount} 个待办已完成`,
        keywords: claims.slice(0, 5).map((c) => c?.text?.slice(0, 30)).filter(Boolean),
      });
    }

    if (!isPlainObject(state.L2)) state.L2 = {};
    state.L2.needsWrite = true;
    this._saveUiCheckpoint(state);
    const completedStats = getTodoStats(state);
    this._emitLegacy("deepsearch.iteration.completed", {
      runId: state.runId,
      iteration,
      openTodoCount: completedStats.openTodoCount,
      completedTodoCount: completedStats.completedTodoCount,
      blockedTodoCount: completedStats.blockedTodoCount,
      totalTodos: completedStats.totalTodos,
      openGapCount: completedStats.openGapCount,
    });
    state.iteration++;
    return { retrieved: true, extracted: true };
  }

  /**
   * 生成报告
   */
  async _executeGenerateReport(state, stageApi, { logger }) {
    logger.info("Executing: generate_report", { stage: "deepsearch-agent-loop" });

    // 1. 优先使用注入的 capabilities
    if (this.capabilities.generateReport) {
      const result = await this.capabilities.generateReport(state, stageApi);
      return result;
    }

    // 2. 尝试 CapabilityLoader 动态发现
    const dynamicHandler = await this._resolveCapability("generateReport", state, stageApi);
    if (dynamicHandler) {
      const result = await dynamicHandler(state, stageApi);
      return result;
    }

    // 3. 默认实现
    const { runDeepSearchWriteStage } = await import("./write.js");
    if (isPlainObject(state.L2)) state.L2.needsWrite = false;
    const emit = typeof stageApi?.emit === "function" ? stageApi.emit : stageApi?.eventBus?.emit;
    const writeOut = await runDeepSearchWriteStage({}, { state }, stageApi);

    const feedbackToResearch = writeOut?.feedbackToResearch;
    const needsMoreResearch = Boolean(feedbackToResearch?.needsMoreResearch);
    const todoIds = Array.isArray(feedbackToResearch?.todoIds) ? feedbackToResearch.todoIds : [];
    const newTodos = Array.isArray(feedbackToResearch?.newTodos) ? feedbackToResearch.newTodos : [];
    let feedbackPayload = feedbackToResearch;
    const maxWriteBacktrack =
      safeInt(state?.userConfig?.write?.maxWriteBacktrack) ??
      safeInt(state?.userConfig?.maxWriteBacktrack) ??
      3;
    const writeBacktrackCount = safeInt(state.writeBacktrackCount) ?? 0;

    const canBacktrack =
      needsMoreResearch &&
      state.iteration < state.maxIterations &&
      writeBacktrackCount < maxWriteBacktrack &&
      (todoIds.length > 0 || newTodos.length > 0);

    if (canBacktrack) {
      state.saveWriteSnapshot?.();
      state.writeBacktrackCount = writeBacktrackCount + 1;

      const todoById = new Map(
        (Array.isArray(state?.todos) ? state.todos : [])
          .map((t) => [toNonEmptyString(t?.todoId), t])
          .filter(([id]) => id)
      );
      const createdTodos = [];
      const gapIdsToReopen = new Set(Array.isArray(feedbackToResearch?.gapIds) ? feedbackToResearch.gapIds : []);

      const normalizedTodoIds = Array.from(new Set(todoIds.map((t) => String(t || "").trim()).filter(Boolean)));
      for (const tid of normalizedTodoIds) {
        const base = todoById.get(tid);
        const baseText = toNonEmptyString(base?.text) || `Todo ${tid}`;
        const text = `Follow up: ${baseText}`;
        const created = state.addTodo({
          text,
          priority: toNonEmptyString(base?.priority) || "high",
          source: "system",
          ...(Array.isArray(base?.queryHints) ? { queryHints: base.queryHints } : {}),
          ...(toNonEmptyString(base?.expectedEvidence) ? { expectedEvidence: base.expectedEvidence } : {}),
          ...(toNonEmptyString(base?.relatedGapId) ? { relatedGapId: base.relatedGapId } : {}),
        });
        createdTodos.push(created);
        if (toNonEmptyString(base?.relatedGapId)) gapIdsToReopen.add(String(base.relatedGapId));
      }

      for (const row of newTodos) {
        const text = toNonEmptyString(row?.text) || toNonEmptyString(row?.question);
        if (!text) continue;
        const created = state.addTodo({
          text: String(text),
          ...(toNonEmptyString(row?.priority) ? { priority: String(row.priority) } : {}),
          ...(Array.isArray(row?.queryHints) ? { queryHints: row.queryHints } : {}),
          ...(toNonEmptyString(row?.expectedEvidence) ? { expectedEvidence: String(row.expectedEvidence) } : {}),
          ...(toNonEmptyString(row?.relatedGapId) ? { relatedGapId: String(row.relatedGapId) } : {}),
          source: "system",
        });
        createdTodos.push(created);
        if (toNonEmptyString(row?.relatedGapId)) gapIdsToReopen.add(String(row.relatedGapId));
      }

      if (gapIdsToReopen.size) {
        state.reopenGaps(Array.from(gapIdsToReopen), { reason: feedbackToResearch?.reason }, emit);
      }

      const createdTodoIds = createdTodos.map((t) => toNonEmptyString(t?.todoId)).filter(Boolean);
      feedbackPayload = {
        ...(feedbackToResearch || {}),
        ...(createdTodoIds.length ? { createdTodoIds } : {}),
      };

      if (typeof emit === "function") {
        emit("deepsearch.write.backtrack.requested", {
          writeBacktrackCount: state.writeBacktrackCount,
          maxWriteBacktrack,
          feedbackToResearch: feedbackPayload,
        });
      }

      state.addTimeline?.({
        name: "deepsearch.write.backtrack.requested",
        status: "info",
        payload: {
          writeBacktrackCount: state.writeBacktrackCount,
          maxWriteBacktrack,
          ...(feedbackPayload ? { feedbackToResearch: feedbackPayload } : {}),
        },
      });
    }

    return { reportGenerated: true, ...(canBacktrack ? { backtrackRequested: true, feedbackToResearch: feedbackPayload } : {}) };
  }

  /**
   * 分叉 SubAgents（大文档分治）
   * - Lead Agent 拆分文档
   * - 每个 SubAgent 处理不同片段
   * - SharedContext L1/L2 只读共享，L3 独立
   */
  async _executeForkSubAgents(state, stageApi, { logger, runContext }) {
    logger.info("Executing: fork_subagents", { stage: "deepsearch-agent-loop" });
    const iteration = state.iteration;
    const todoStats = getTodoStats(state);
    this._emitLegacy("deepsearch.iteration.started", {
      runId: state.runId,
      iteration,
      openTodoCount: todoStats.openTodoCount,
      completedTodoCount: todoStats.completedTodoCount,
      blockedTodoCount: todoStats.blockedTodoCount,
      totalTodos: todoStats.totalTodos,
      openGapCount: todoStats.openGapCount,
    });

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

    this._saveUiCheckpoint(state);
    const completedStats = getTodoStats(state);
    this._emitLegacy("deepsearch.iteration.completed", {
      runId: state.runId,
      iteration,
      openTodoCount: completedStats.openTodoCount,
      completedTodoCount: completedStats.completedTodoCount,
      blockedTodoCount: completedStats.blockedTodoCount,
      totalTodos: completedStats.totalTodos,
      openGapCount: completedStats.openGapCount,
    });
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

    // Layer 4: 收集度量衡并 emit
    const metrics = collectMetrics(state, this._backtrackManager);
    this._emit("deepsearch.metrics", {
      runId: state.runId,
      iteration: state.iteration,
      metrics,
      summary: formatMetricsReport(metrics),
    });

    return { decision: AgentDecision.CONTINUE };
  }

  /**
   * 压缩记忆（金蝉脱壳）
   * - Working Memory → Condensed Memory (精华)
   * - 完整状态 → Archive (冷存储)
   * - 极端压力下：头部修剪 (Truncate first items)
   */
  async _compressMemory(state, stageApi) {
    const logger = createLogger("compress-memory");
    const tokenStats = this.budgetManager?.getStats()?.usage || {};
    const currentTotalTokens = tokenStats.total || 0;
    const maxTotalTokens = this.budgetManager?.limits?.total || 100000;
    const fillRatio = currentTotalTokens / maxTotalTokens;

    // 1. 使用能力注入的压缩器（如 CicadaCompressor）
    if (this.capabilities.compressMemory) {
      const compressed = await this.capabilities.compressMemory(state, stageApi);
      if (compressed) {
        state.L1.condensedMemory = compressed.summary;
      }
    } else {
      // 默认压缩策略：保留 claims + evidence IDs，丢弃中间过程
      const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
      const todoStats = getTodoStats(state);

      state.L1.condensedMemory = {
        claimCount: claims.length,
        claimSummary: claims.slice(0, 10).map(c => c?.text?.slice(0, 100)),
        openTodoCount: todoStats.openTodoCount,
        completedTodoCount: todoStats.completedTodoCount,
        blockedTodoCount: todoStats.blockedTodoCount,
        openGapCount: todoStats.openGapCount,
        filledGapCount: todoStats.filledGapCount,
        iteration: state.iteration,
        compressedAt: new Date().toISOString(),
      };
    }

    // 2. 清理 L2 详细数据（保留最近的 chunk）
    if (state.L2?.retrievedChunks?.length > 100) {
      state.L2.retrievedChunks = state.L2.retrievedChunks.slice(-50);
    }

    // 3. 头部修剪保底策略 (借鉴常用方法)
    // 当 Context 压力极大（如 > 90%）时，强制删除最早的 20% 证据/论点，保留最近的上下文
    if (fillRatio > AGENT_LOOP_CONFIG.CRITICAL_FILL_RATIO) {
      logger.warn("Critical context pressure detected, applying head-truncation", {
        fillRatio,
        currentTotalTokens,
        maxTotalTokens
      });

      if (
        Array.isArray(state.L1?.evidenceLedger) &&
        state.L1.evidenceLedger.length > AGENT_LOOP_CONFIG.MIN_EVIDENCE_FOR_TRUNCATE
      ) {
        const removeCount = Math.floor(state.L1.evidenceLedger.length * AGENT_LOOP_CONFIG.HEAD_TRUNCATE_RATIO);
        state.L1.evidenceLedger = state.L1.evidenceLedger.slice(removeCount);
        logger.info(`Truncated ${removeCount} early evidences`);
      }

      if (
        Array.isArray(state.L1?.claims) &&
        state.L1.claims.length > AGENT_LOOP_CONFIG.MIN_CLAIMS_FOR_TRUNCATE
      ) {
        const removeCount = Math.floor(state.L1.claims.length * AGENT_LOOP_CONFIG.HEAD_TRUNCATE_RATIO);
        state.L1.claims = state.L1.claims.slice(removeCount);
        logger.info(`Truncated ${removeCount} early claims`);
      }
    }

    // 4. 决策记忆固化：提取最近 3 条决策到 L1
    const thoughtHistory = Array.isArray(state.L2?.thoughtHistory)
      ? state.L2.thoughtHistory
      : [];
    const recentDecisions = thoughtHistory
      .filter((t) => t && t.action) // 只保留有效决策
      .slice(-3)
      .map((t) => ({
        action: t.action || "unknown",
        reason: t.reason || "",
        outcome: t.outcome || "unknown",
        iteration: typeof t.iteration === "number" ? t.iteration : state.iteration,
        ts: t.ts || new Date().toISOString()
      }));

    if (!state.L1.condensedMemory) state.L1.condensedMemory = {};
    state.L1.condensedMemory.decisionTrace = recentDecisions;

    logger.debug("Decision trace captured", {
      count: recentDecisions.length,
      actions: recentDecisions.map((d) => d.action)
    });

    // 5. 归档完整状态到 Archive（蝉蜕存档）
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

    // 6. 更新 SharedContext（如果有）
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
    const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
    const todos = Array.isArray(state?.todos) ? state.todos : [];
    const openQuestions = Array.isArray(state?.L1?.openQuestions) ? state.L1.openQuestions : [];
    const outlineCandidates = Array.isArray(state?.L1?.outlineCandidates) ? state.L1.outlineCandidates : [];
    const todoStats = getTodoStats(state);
    const allTodosResolved = todoStats.totalTodos > 0 && todoStats.openTodoCount === 0;
    const completionReason =
      toNonEmptyString(state?.L2?.reason) ||
      (state?.L2?.taskImpossible ? "Task marked impossible." : allTodosResolved ? "All todos completed." : "");
    const todoCompletionStats = {
      total: todoStats.totalTodos,
      completed: todoStats.completedTodoCount,
      cancelled: todoStats.blockedTodoCount,
    };

    const pkg = buildContentPackage(
      runContext || { runId: state.runId, mode: "deepsearch", constraints: {} },
      sources,
      slideIntents,
      claims,
      evidenceLedger,
      dataTables,
      {
        mode: "deepsearch",
        scanSummary: state?.L1?.scanSummary || null,
        gaps,
        todos,
        completionReason,
        todoCompletionStats,
        condensedMemory: state?.L1?.condensedMemory || null,
        openQuestions,
        outlineCandidates,
        report: state?.L1?.report || null,
        assets,
      }
    );
    if (pkg?.metrics) {
      const tokenUsageRaw = state?.L2?.tokenUsage;
      const tokenUsage =
        tokenUsageRaw && typeof tokenUsageRaw === "object"
          ? {
              input: typeof tokenUsageRaw.input === "number" && Number.isFinite(tokenUsageRaw.input) ? tokenUsageRaw.input : 0,
              output: typeof tokenUsageRaw.output === "number" && Number.isFinite(tokenUsageRaw.output) ? tokenUsageRaw.output : 0,
              total: typeof tokenUsageRaw.total === "number" && Number.isFinite(tokenUsageRaw.total) ? tokenUsageRaw.total : 0,
              estimatedCostUSD:
                typeof tokenUsageRaw.estimatedCostUSD === "number" && Number.isFinite(tokenUsageRaw.estimatedCostUSD)
                  ? tokenUsageRaw.estimatedCostUSD
                  : 0,
            }
          : { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
      pkg.metrics.deepsearch = {
        sourceCount: Array.isArray(sources) ? sources.length : 0,
        todoCount: todoStats.totalTodos,
        openTodoCount: todoStats.openTodoCount,
        completedTodoCount: todoStats.completedTodoCount,
        cancelledTodoCount: todoStats.blockedTodoCount,
        gapCount: todoStats.openGapCount,
        totalGaps: todoStats.totalGaps,
        retrievedCount: Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0,
        claimCount: claims.length,
        evidenceCount: evidenceLedger.length,
        slideCount: slideIntents.length,
        iteration: state.iteration,
        checkpointCount: Array.isArray(state?.checkpoints) ? state.checkpoints.length : 0,
        tokenUsage,
      };
    }
    return pkg;
  }

  /**
   * 确保状态对象
   */
  _ensureState(runContext, input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);

    const sources = Array.isArray(input?.sources) ? input.sources : [];
    const assets = Array.isArray(input?.assets) ? input.assets : [];
    const taskGoal = typeof input?.taskGoal === "string" ? input.taskGoal : "";
    const userConfig = isPlainObject(input?.userConfig) ? input.userConfig : {};

    const state = new DeepSearchState({
      runId: runContext?.runId,
      taskGoal,
      userConfig,
      L0: { sources, assets },
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

  _emitLegacy(name, payload) {
    if (this.isSubAgent) return;
    this._emit(name, payload);
  }

  _saveUiCheckpoint(state) {
    if (this.isSubAgent || typeof state?.saveCheckpoint !== "function") return null;
    try {
      const checkpoint = state.saveCheckpoint();
      if (checkpoint?.checkpointId) {
        this._emit("deepsearch.checkpoint.saved", {
          checkpointId: checkpoint.checkpointId,
          iteration: checkpoint.iteration,
          metrics: checkpoint.metrics,
        });
      }
      return checkpoint;
    } catch {
      return null;
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
