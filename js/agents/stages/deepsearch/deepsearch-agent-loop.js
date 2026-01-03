/**
 * DeepSearch Agent Loop
 *
 * 极简核心 + 可插拔（capabilities loader）+ phases（planning/execution/writing）
 */

import { BaseAgentLoop } from "../../runtime/core/agent-loop.js";
import { DeepSearchState } from "./state.js";
import { getModelCaller } from "./model.js";
import { createLogger } from "./runtime/logger.js";
import { robustParseJson } from "../../shared/utils/robust-json.js";
import { isPlainObject, sanitizeForJson } from "../../shared/utils/value-utils.js";
import { DeepSearchEvents } from "../../runtime/events/events.js";
import { ModelResponseHandler } from "./runtime/model-response-handler.js";
import { classifyDeepSearchError } from "./runtime/error-classifier.js";
import SourceManager from "./source-manager.js";
import { loadDeepSearchCapabilities } from "./capabilities-loader.js";
import {
  addInitialDeepSearchMessages,
  createIterationConvergenceTracker,
  getGapConvergencePolicy,
  runPlanningPhaseIteration,
} from "./phases/planning-phase.js";
import { executeDeepSearchDecision } from "./phases/execution-phase.js";
import { ensureReportOnComplete, runWritingPhaseIfNeeded } from "./phases/writing-phase.js";

export const AgentStatus = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
});

// 分析模式配置（默认值，可被 config.json 覆盖）
export const AnalysisMode = Object.freeze({
  QUICK: "quick",
  WIDER: "wider",
  DEEPER: "deeper",
});

const DEFAULT_MODE_CONFIG = {
  quick: { maxIterations: 15, writeIterations: 5, maxToolCalls: 50, subagentIterations: 5, description: "快速概览" },
  wider: { maxIterations: 30, writeIterations: 10, maxToolCalls: 100, subagentIterations: 10, description: "广度优先，覆盖所有文档" },
  deeper: { maxIterations: 50, writeIterations: 15, maxToolCalls: 200, subagentIterations: 15, description: "深度优先，逐个分析" },
};

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function deepSortForStableJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => deepSortForStableJson(v, seen));
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = deepSortForStableJson(value[key], seen);
  return out;
}

function stableStringify(value, { maxChars = 2000 } = {}) {
  const cleaned = sanitizeForJson(value);
  let s = "";
  try {
    s = JSON.stringify(deepSortForStableJson(cleaned));
  } catch {
    try {
      s = JSON.stringify(cleaned);
    } catch {
      s = String(value ?? "");
    }
  }
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 0;
  if (!limit || s.length <= limit) return s;
  return s.slice(0, limit) + "...";
}

function normalizeToolCallGuard(config) {
  const cfg = isPlainObject(config) ? config : {};
  const enabled = cfg.enabled === true;
  const maxConsecutive = toPositiveInt(cfg.maxConsecutive, 6);
  const warnAt = toPositiveInt(cfg.warnAt, Math.max(2, maxConsecutive - 1));
  const maxSigChars = toPositiveInt(cfg.maxSignatureChars, 2000);
  const ignoreTools = new Set(Array.isArray(cfg.ignoreTools) ? cfg.ignoreTools.map(String).filter(Boolean) : []);
  return { enabled, maxConsecutive, warnAt, maxSigChars, ignoreTools };
}

function getModeConfig(mode, globalConfig) {
  const defaults = DEFAULT_MODE_CONFIG[mode] || DEFAULT_MODE_CONFIG.wider;
  const override = globalConfig?.agent?.[mode] || {};
  return {
    ...defaults,
    ...override,
    description: defaults.description,
    subagentIterations: override.subagentIterations || defaults.subagentIterations,
  };
}

export class DeepSearchAgentLoop extends BaseAgentLoop {
  constructor(options = {}) {
    const contextConfig = {
      contextWindow: options.contextWindow || options.userConfig?.contextWindow,
      compressThreshold: options.compressThreshold || options.userConfig?.compressThreshold,
    };
    super({ actor: "deepsearch", stageName: "deepsearch", contextConfig, ...options });

    this.status = AgentStatus.IDLE;
    this.state = null;

    this.globalConfig = options.config || options.globalConfig || null;

    this.mode = options.mode || AnalysisMode.WIDER;
    const modeConfig = getModeConfig(this.mode, this.globalConfig);
    this.maxIterations = options.maxIterations || modeConfig.maxIterations;
    this.writeIterations = modeConfig.writeIterations;
    this.maxToolCalls = modeConfig.maxToolCalls;
    this.subagentIterations = modeConfig.subagentIterations;

    this.sourceManager = options.sourceManager || null;

    // 可插拔机制（允许外部注入）
    this.budget = options.budget || null;
    this.checkpoint = options.checkpoint || null;
    this.sharedContext = options.sharedContext || null;
    this.backtrackManager = options.backtrackManager || null;
    this.discoveryManager = options.discoveryManager || null;
    this.maxBacktracks = options.maxBacktracks ?? 3;

    // Memory 2.0
    this.memory = options.memory || null;
    this.memoryConfig = options.memoryConfig || options.userConfig?.memory || null;

    // Unified context facade
    this.context = options.context || null;

    this._logger = createLogger({ actor: "deepsearch", getContext: () => ({ stage: "agent-loop" }) });
    this._failureReported = false;

    this._toolCallGuardConfig = normalizeToolCallGuard(
      options.toolCallGuard || options.doomLoopGuard || options.userConfig?.toolCallGuard || options.globalConfig?.toolCallGuard
    );
    this._toolCallGuardState = { lastSig: null, consecutive: 0, warnedAt: 0 };
  }

  _recordToolCall(toolName, toolArgs) {
    const cfg = this._toolCallGuardConfig;
    if (!cfg?.enabled) return null;

    const name = typeof toolName === "string" ? toolName.trim() : String(toolName || "").trim();
    if (!name) return null;
    if (cfg.ignoreTools?.has(name)) return null;

    const sig = `${name}|${stableStringify(toolArgs, { maxChars: cfg.maxSigChars })}`;
    if (sig === this._toolCallGuardState.lastSig) {
      this._toolCallGuardState.consecutive += 1;
    } else {
      this._toolCallGuardState.lastSig = sig;
      this._toolCallGuardState.consecutive = 1;
      this._toolCallGuardState.warnedAt = 0;
    }

    const n = this._toolCallGuardState.consecutive;
    const shouldWarn = n >= cfg.warnAt && this._toolCallGuardState.warnedAt < cfg.warnAt;
    if (shouldWarn) this._toolCallGuardState.warnedAt = cfg.warnAt;

    const shouldStop = n >= cfg.maxConsecutive;
    return { tool: name, signature: sig, consecutive: n, shouldWarn, shouldStop };
  }

  _emit(name, payload, { actor = "deepsearch", status } = {}) {
    const eventName = name.startsWith("deepsearch.") ? name : `deepsearch.${name}`;
    const record = {
      actor,
      ...(typeof status === "string" && status ? { status } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    const emit = typeof this.emit === "function" ? this.emit : this.eventBus?.emit;
    emit?.(eventName, record);
  }

  _markFailed(err, classification) {
    const info = classification || classifyDeepSearchError(err);
    const payload = {
      error: info.message,
      recoverable: info.recoverable,
      category: info.category,
      ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
      ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
    };

    if (!this._failureReported) {
      this._emit(DeepSearchEvents.AGENT_ERROR, payload);
      this._emit(DeepSearchEvents.AGENT_FAILED, { runId: this.state?.runId, ...payload });
      this._emit("deepsearch.failed", { runId: this.state?.runId, error: payload.error }, { status: "failed" });
      this._failureReported = true;
    }

    if (this.status !== AgentStatus.FAILED) {
      const from = this.status;
      this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from, to: AgentStatus.FAILED });
      this.status = AgentStatus.FAILED;
    }
  }

  async run(input, context = {}) {
    const capabilities = await loadDeepSearchCapabilities();
    const { stageApi = {} } = context;
    const { signal } = stageApi;

    this.state = this._ensureState(input);

    if (!this.sourceManager) this.sourceManager = new SourceManager(this.state?.L0?.sources || []);
    else this.sourceManager.syncSources(this.state?.L0?.sources);

    if (!this.state.userConfig) this.state.userConfig = {};
    this.state.userConfig.mode = this.mode;
    if (this.globalConfig) this.state.globalConfig = this.globalConfig;

    const fromStatus = this.status;
    this.status = AgentStatus.RUNNING;
    this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: fromStatus, to: AgentStatus.RUNNING });
    this._failureReported = false;
    await this.resetMessages();

    try {
      // ===== Optional mechanisms (DI) =====
      const {
        SkillsManager,
        BudgetManager,
        CheckpointManager,
        SharedContext,
        BacktrackManager,
        DiscoveryManager,
        MemoryStore,
        UnifiedAgentContext,
      } = capabilities;

      if (BudgetManager && !this.budget) this.budget = new BudgetManager(this.state);
      if (SharedContext && !this.sharedContext) this.sharedContext = new SharedContext();

      if (CheckpointManager && !this.checkpoint && stageApi.archive) {
        this.checkpoint = new CheckpointManager({
          archive: stageApi.archive,
          emit: (n, p) => this._emit(n, p),
          logger: this._logger,
        });
      }

      if (BacktrackManager && !this.backtrackManager) {
        this.backtrackManager = new BacktrackManager({
          archive: stageApi.archive,
          maxBacktracks: this.maxBacktracks,
          emit: (n, p) => this._emit(n, p),
          logger: this._logger,
          sideEffects: stageApi?.sideEffects || null,
        });
      }

      if (DiscoveryManager && !this.discoveryManager) {
        this.discoveryManager = new DiscoveryManager({
          sharedContext: this.sharedContext,
          runId: this.state.runId,
          logger: this._logger,
        });
      }

      const memoryConfig = this.memoryConfig || this.state?.userConfig?.memory || null;
      if (MemoryStore && !this.memory) {
        this.memory = new MemoryStore({
          runId: this.state.runId,
          config: memoryConfig,
          eventBus: this.eventBus,
          sharedContext: this.sharedContext,
          discoveryManager: this.discoveryManager,
        });
      } else if (this.memory) {
        this.memory.bind?.({ sharedContext: this.sharedContext, discoveryManager: this.discoveryManager });
      }

      if (this.state && typeof this.state.bindMemoryStore === "function") {
        this.state.bindMemoryStore(this.memory);
      }

      if (UnifiedAgentContext && !this.context) {
        this.context = new UnifiedAgentContext({ runId: this.state.runId, eventBus: this.eventBus });
        this.context.bind?.({ state: this.state, memory: this.memory, sharedContext: this.sharedContext });
      }

      this._emit(DeepSearchEvents.AGENT_STARTED, { runId: this.state.runId, mode: this.mode });
      this._emit("deepsearch.started", { runId: this.state.runId }, { status: "started" });

      const modeConfig = getModeConfig(this.mode, this.globalConfig);
      await addInitialDeepSearchMessages({
        agent: this,
        stageApi,
        SkillsManager,
        modeDescription: modeConfig.description || this.mode,
      });

      const callModel = getModelCaller(stageApi, { usage: "agent", state: this.state });
      if (!callModel) throw new Error("No model available");

      const responseHandler = new ModelResponseHandler({
        logger: this._logger,
        emit: (n, p) => this._emit(n, p),
        parseDecision: (content) => this._parseDecision(content),
        maxRetries: 5,
      });

      let iteration = 0;
      let toolCallCount = 0;
      let systemRetryCount = 0;
      const maxSystemRetriesPerIteration = (() => {
        const raw = this.state?.userConfig?.budget?.maxSystemRetriesPerIteration ?? this.state?.userConfig?.maxSystemRetriesPerIteration;
        const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : null;
        return n !== null && n >= 1 ? n : 3;
      })();

      const convergencePolicy = getGapConvergencePolicy(this.state);
      const { convergence, initBaselines, emitIterationCompleted } = createIterationConvergenceTracker({ agent: this, convergencePolicy });
      initBaselines();

      while (iteration < this.maxIterations) {
        const plannedIteration = iteration + 1;

        if (toolCallCount >= this.maxToolCalls) {
          this._logger.info?.(`工具调用次数达到上限 (${toolCallCount}/${this.maxToolCalls})，强制进入写作阶段`);
          break;
        }

        if (signal?.aborted) throw new Error("Aborted");

        if (this.budget?.isExhausted?.()) {
          this._logger.warn?.("Budget exhausted");
          break;
        }

        try {
          const planned = await runPlanningPhaseIteration({
            agent: this,
            stageApi,
            context,
            callModel,
            responseHandler,
            iteration,
            toolCallCount,
            systemRetryCount,
            maxSystemRetriesPerIteration,
            convergencePolicy,
            convergence,
          });

          if (planned.status === "retry") continue;
          if (planned.status === "skip") {
            iteration = plannedIteration;
            if (this.context) this.context.iteration = iteration;
            else this.state.iteration = iteration;
            systemRetryCount = 0;
            emitIterationCompleted(plannedIteration);
            continue;
          }
          if (planned.status === "stop") break;
          if (planned.status !== "success") break;

          const { decision } = planned;

          if (decision?.action === "complete") {
            await ensureReportOnComplete({ agent: this, stageApi });
            iteration = plannedIteration;
            systemRetryCount = 0;
            emitIterationCompleted(plannedIteration);
            break;
          }

          const executed = await executeDeepSearchDecision({
            agent: this,
            stageApi,
            decision,
            plannedIteration,
          });
          toolCallCount += typeof executed?.toolCalls === "number" ? executed.toolCalls : 0;

          iteration = plannedIteration;
          systemRetryCount = 0;
          emitIterationCompleted(plannedIteration);
        } catch (err) {
          const info = classifyDeepSearchError(err);
          this._logger.error?.("Iteration error", {
            error: info.message,
            category: info.category,
            recoverable: info.recoverable,
            ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
            ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
          });

          if (!info.recoverable) {
            this.addMessage({ role: "user", content: `致命错误: ${info.message}\n\n请检查配置/权限/网络后重试。` });
            this._markFailed(err, info);
            throw err;
          }

          this.addMessage({ role: "user", content: `错误: ${info.message}\n\n请尝试其他方法。` });
          systemRetryCount += 1;

          // System errors do not consume iteration budget by default.
          if (this.context) this.context.iteration = iteration;
          else this.state.iteration = iteration;

          if (systemRetryCount >= maxSystemRetriesPerIteration) {
            iteration = plannedIteration;
            if (this.context) this.context.iteration = iteration;
            else this.state.iteration = iteration;
            systemRetryCount = 0;
            this.addMessage({
              role: "user",
              content: `系统错误已连续发生 ${maxSystemRetriesPerIteration} 次，为避免卡死，已计入 1 轮迭代并继续。`,
            });
            emitIterationCompleted(plannedIteration);
          }
        }
      }

      await runWritingPhaseIfNeeded({
        agent: this,
        stageApi,
        callModel,
        iteration,
        toolCallCount,
        signal,
      });

      this._emit(DeepSearchEvents.AGENT_STATUS_CHANGED, { from: this.status, to: AgentStatus.COMPLETED });
      this.status = AgentStatus.COMPLETED;
      this._emit(DeepSearchEvents.AGENT_COMPLETED, { runId: this.state.runId, iterations: iteration });
      this._emit("deepsearch.completed", { runId: this.state.runId, iterations: iteration }, { status: "completed" });
      return this._buildOutput();
    } catch (err) {
      const info = classifyDeepSearchError(err);
      this._logger.error?.("DeepSearch run failed", {
        error: info.message,
        category: info.category,
        recoverable: info.recoverable,
        ...(typeof info.statusCode === "number" ? { statusCode: info.statusCode } : {}),
        ...(typeof info.code === "string" && info.code ? { code: info.code } : {}),
      });
      this._markFailed(err, info);
      throw err;
    }
  }

  _parseDecision(content) {
    try {
      const parsed = robustParseJson(content);
      if (!parsed) return null;

      if (Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        return { thought: parsed.thought || "", actions: parsed.actions };
      }
      return { thought: parsed.thought || "", action: parsed.action || "complete", args: parsed.args || {} };
    } catch {
      return null;
    }
  }

  _buildOutput() {
    const ctx = this.context;
    return {
      runId: ctx?.runId || this.state.runId,
      status: this.status,
      report: ctx?.report || this.state.L1?.report || null,
      todos: ctx?.todos || this.state.todos || [],
      claims: ctx?.claims || this.state.L1?.claims || [],
    };
  }

  _ensureState(input) {
    if (input instanceof DeepSearchState) return input;
    if (input?.state instanceof DeepSearchState) return input.state;
    if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
    if (isPlainObject(input)) return DeepSearchState.fromJSON(input);
    return new DeepSearchState();
  }

  getAgentContextStatus() {
    if (this.context?.getContextStatus) return this.context.getContextStatus();
    return {
      runId: this.state?.runId,
      iteration: this.state?.iteration || 0,
      todoCount: this.state?.todos?.length || 0,
      claimCount: this.state?.L1?.claims?.length || 0,
    };
  }
}

export default DeepSearchAgentLoop;

