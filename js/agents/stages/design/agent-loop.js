import { Archive, FallbackAdapter, MapAdapter } from "../../shared/archive/archive.js";
import { deepClone } from "../../shared/utils/value-utils.js";
import { CheckpointType, createCheckpoint, migrateCheckpoint } from "../../shared/archive/checkpoint-schema.js";
import { createLogger } from "../../shared/utils/logger.js";
import { DesignPhase, designPhaseMachine } from "./states.js";
import { AgentStatus } from "../../runtime/core/agent-status.js";
import { BaseAgentLoop, checkCancelled, getEmitFn, resolveToolExecutor } from "../../runtime/core/agent-loop.js";
import { StagePausedError } from "../../runtime/core/stage-errors.js";
import { createLifecycleEmitter } from "../../runtime/core/lifecycle.js";
import { getRuntimeState } from "../../runtime/telemetry/loop-runtime-state.js";
import { DESIGN_AGENT_TOOL_DEFINITIONS, createDesignToolHandlers } from "./design-tools.js";
import { VisualHandler } from "./internal/visual-handler.js";
import { runPreparationPhase, runGeneratingPhase, runBatchRepairPhase, runVisualPhase, runReviewPhase, runPlanningPhase, runLayoutPhase } from "./internal/design-phases.js";
import { DesignBlackboard } from "./internal/design-blackboard.js";
import { Watchdog } from "../../runtime/compression/watchdog.js";
import {
  DESIGN_LOOP_DEFAULTS,
  resolveWatchdogSettings,
  safeJsonStringify,
  resolveStageTraceContext,
  resolveErrorBoundary,
  createTracedAiApiService,
  createTracedModelRouter,
  buildDesignWatchdogAdvice,
  summarizeRefineEventForWatchdog,
  emitStage,
  loadDesignConcurrencyConfig,
  BacktrackError,
} from "./design-helpers.js";

/**
 * @typedef {object} DesignLoopConstructorOptions
 * @property {number} [batchSize]
 * @property {Archive|null} [archive]
 * @property {any} [eventBus]
 * @property {Record<string, Function>|null} [tools]
 * @property {any} [memoryStore]
 * @property {any} [stateEngine]
 * @property {any} [container]
 */

/**
 * Minimal Stage API surface used by the design loop.
 * Keep it permissive (JSDoc-only typing) to reduce `checkJs` friction.
 *
 * @typedef {object} DesignStageApi
 * @property {{ runId?: string, constraints?: any, userConfig?: any }=} [runContext]
 * @property {(eventName: string, record: { actor?: string, status?: string, payload?: any }) => void=} [emit]
 * @property {any=} [eventBus]
 * @property {AbortSignal=} [signal]
 * @property {any=} [aiApiService]
 * @property {any=} [modelRouter]
 * @property {any=} [imageService]
 * @property {any=} [imageProvider]
 * @property {any=} [traceContext]
 * @property {any=} [runtimeHints]
 * @property {any=} [flushCompression]
 * @property {any=} [errorBoundaryConfig]
 * @property {boolean=} [errorBoundaryDegrade]
 * @property {boolean=} [degradeOnError]
 * @property {any=} [eventBusBackpressure]
 * @property {any=} [backpressure]
 * @property {any=} [memoryStore]
 * @property {any=} [stateEngine]
 * @property {any=} [watchdog]
 * @property {boolean=} [resumed]
 * @property {any=} [resumeState]
 * @property {any=} [toolExecutor]
 * @property {any=} [tools]
 * @property {boolean=} [enablePlanning]
 * @property {boolean=} [enableLayout]
 * @property {boolean=} [enableFinalReview]
 * @property {any=} [interactionMode]
 * @property {boolean=} [skipReview]
 * @property {any=} [userConfig]
 */

/**
 * @typedef {object} DesignPhaseState
 * @property {string} status
 */

/**
 * @typedef {Error & { code?: any, timeoutMs?: number }} ErrorWithCode
 */

/**
 * @typedef {object} DesignLoopState
 * @property {any} contentPackage
 * @property {any[]} slideIntents
 * @property {any} designSystem
 * @property {Record<string, any>} constraints
 * @property {Record<string, any>} userConfig
 * @property {any} plans
 * @property {any[]} generated
 * @property {any[]} slideHtmls
 * @property {any[]} slidesMeta
 * @property {any[]} imageSlots
 * @property {any[]} visualSlots
 * @property {string} deckHtmlDsl
 * @property {any[]} pendingImages
 * @property {any} brainstormResult
 * @property {any=} layoutData
 * @property {any=} baseDeckHtmlDsl
 * @property {any=} degradedCount
 * @property {any=} finalImageSlots
 * @property {any=} imageReport
 * @property {any=} visualReport
 * @property {any=} refineResult
 * @property {any=} reviewResult
 */

/**
 * @returns {DesignLoopState}
 */
function createEmptyDesignLoopState() {
  return {
    contentPackage: null,
    slideIntents: [],
    designSystem: null,
    constraints: {},
    userConfig: {},
    plans: null,
    generated: [],
    slideHtmls: [],
    slidesMeta: [],
    imageSlots: [],
    visualSlots: [],
    deckHtmlDsl: "",
    pendingImages: [],
    brainstormResult: null,
  };
}

const logger = createLogger("stages/design/agent-loop");

const SCHEMA_VERSION = "0.1";

// Re-export for backward compatibility
export { DESIGN_AGENT_TOOL_DEFINITIONS };
export { BacktrackError };

/**
 * Main orchestrator for the design stage.
 */
export class DesignAgentLoop extends BaseAgentLoop {
  /**
   * @param {DesignLoopConstructorOptions} [options]
   */
  constructor({ batchSize, archive, eventBus, tools, memoryStore, stateEngine, container } = {}) {
    super({ actor: "design", stageName: "design", eventBus });
    const config = loadDesignConcurrencyConfig();
    const defaultBatchSize = config?.batchSize || DESIGN_LOOP_DEFAULTS.batchSize;
    this.batchSize = Math.max(1, Number(batchSize) || defaultBatchSize);
    this.batchConcurrency = Math.max(1, Number(config?.batchConcurrency) || DESIGN_LOOP_DEFAULTS.batchConcurrency);
    this.imageConcurrency = Math.max(1, Number(config?.imageConcurrency) || DESIGN_LOOP_DEFAULTS.imageConcurrency);
    // DI 容器
    this._container = container || null;
    // Inject VisualHandler
    this._visualHandler = new VisualHandler({ imageConcurrency: this.imageConcurrency });
    // Register design tools - preserve _toolRegistry._tools reference set by BaseAgentLoop
    const designTools = createDesignToolHandlers(this);
    this.registerTools(designTools);
    if (tools) this.registerTools(tools);
    // Local reference for backward compat (used by _toolXxx shortcuts below)
    this._designTools = designTools;
    /** @type {DesignPhaseState} */
    this.phase = { status: DesignPhase.IDLE };
    /** @type {string} */
    this._loopStatus = AgentStatus.IDLE;
    if (Array.isArray(this._statusHistory)) this._statusHistory.length = 0;
    this.archive = archive || null;
    // Blackboard for cross-phase communication (支持 MemoryStore 集成)
    this._blackboard = new DesignBlackboard({ memoryStore, stateEngine });
    this._memoryStore = memoryStore || null;
    this._stateEngine = stateEngine || null;
    // Loop control
    this._maxIterations = DESIGN_LOOP_DEFAULTS.maxIterations;
    this._iteration = 0;
    this._watchdog = null;

    // Runtime state (春秋蝉模式)
    /** @type {DesignLoopState} */
    this.state = createEmptyDesignLoopState();

    /** @type {Function|null} Backward-compatible emit alias used by older tests. */
    this._emit = null;
    /** @type {any} Snapshot of last resume (resumeDesignAgentLoop). */
    this._resumeState = null;

    // Expose tool methods for backward compatibility (tests)
    this._toolParseOutline = this._designTools.parse_outline;
    this._toolExtractStyle = this._designTools.extract_style;
    this._toolSpawnSlideAgent = this._designTools.spawn_slide_agent;
    this._toolTakeScreenshot = this._designTools.take_screenshot;
    this._toolFixSlide = this._designTools.fix_slide;
    this._toolFillVisual = this._designTools.fill_visual;
    this._toolChatAsk = this._designTools.chat_ask;
  }

  /**
   * @returns {DesignBlackboard|null}
   */
  get blackboard() {
    return this._blackboard;
  }

  /**
   * @returns {string}
   */
  getPhase() {
    return this.phase?.status || DesignPhase.IDLE;
  }

  /**
   * @returns {string}
   */
  getStatus() {
    return this._loopStatus || AgentStatus.IDLE;
  }

  /**
   * 从容器或 context 解析依赖
   * @private
   * @param {string} serviceId
   * @param {DesignStageApi} context
   * @param {any} fallback
   * @returns {Promise<any>}
   */
  async _resolveDependency(serviceId, context, fallback) {
    // 优先从 context 获取（显式传入）
    if (context?.[serviceId]) return context[serviceId];
    // 其次从容器获取
    if (this._container) {
      try {
        return await this._container.get(serviceId);
      } catch { /* fallback */ }
    }
    // 最后使用回退值
    return fallback;
  }

	  // === Version Management ===

	  /**
	   * @param {string} label
	   * @returns {any}
	   */
	  saveVersion(label) {
	    if (!this._blackboard) return null;
	    const snapshot = {
	      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      state: deepClone(this.state), // 保存当前执行快照
      timestamp: Date.now(),
    };
	    return this._blackboard.saveVersion(label, snapshot);
	  }

	  /**
	   * @param {string} label
	   * @returns {any}
	   */
	  getVersion(label) {
	    return this._blackboard?.getVersion(label) || null;
	  }

	  /**
	   * @returns {any[]}
	   */
	  listVersions() {
	    return this._blackboard?.listVersions() || [];
	  }

  /**
   * 回溯到指定版本（抛出 BacktrackError 触发主循环重启）
   * @param {string} label - 版本标签
   * @param {string} [reason] - 回溯原因
   * @throws {BacktrackError} 触发主循环从目标阶段重启
   */
  backtrackTo(label, reason = "user_requested") {
    if (!this._blackboard) throw new Error("Cannot backtrack: no blackboard");
    const version = this._blackboard.getVersion(label);
    if (!version) throw new Error(`Cannot backtrack: version "${label}" not found`);
    // 恢复状态
    const targetPhase = version.snapshot?.phase || DesignPhase.IDLE;
    if (version.snapshot?.phase) this.phase.status = version.snapshot.phase;
    if (version.snapshot?.loopStatus) this._loopStatus = version.snapshot.loopStatus;

    // 深度恢复 state (对照 BacktrackManager)
    if (version.snapshot?.state) {
      this.state = deepClone(version.snapshot.state);
    }

    this._blackboard.restoreVersion(label);
    this._emit?.("design.backtrack", { label, targetPhase, reason, timestamp: Date.now() });

    // 标记正在回溯，防止 _runCore 重置状态
    this._isBacktracking = true;
    // 抛出 BacktrackError 触发主循环重启
    throw new BacktrackError(targetPhase, label, reason);
  }

  /**
   * 回溯到最近的 checkpoint
   * @param {string} [reason] - 回溯原因
   * @throws {BacktrackError} 触发主循环从目标阶段重启
   */
	  backtrackToLastCheckpoint(reason = "auto_recovery") {
	    const versions = this.listVersions();
	    if (versions.length === 0) throw new Error("Cannot backtrack: no versions available");
	    const latest = versions[versions.length - 1];
	    this.backtrackTo(latest.label, reason);
	  }

	  /**
	   * @returns {any[]}
	   */
	  getToolDefinitions() {
	    return DESIGN_AGENT_TOOL_DEFINITIONS.slice();
	  }

	  /**
	   * @returns {Record<string, any>}
	   */
	  serializeNodeStates() {
	    const state = this.state && typeof this.state === "object" ? this.state : {};
	    const out = {
	      contentPackage: state.contentPackage ?? null,
      slideIntents: Array.isArray(state.slideIntents) ? state.slideIntents : [],
      designSystem: state.designSystem ?? null,
      slideHtmls: Array.isArray(state.slideHtmls) ? state.slideHtmls : [],
      deckHtmlDsl: typeof state.deckHtmlDsl === "string" ? state.deckHtmlDsl : "",
      imageSlots: Array.isArray(state.imageSlots) ? state.imageSlots : [],
      visualSlots: Array.isArray(state.visualSlots) ? state.visualSlots : [],
	    };
	    return deepClone(out);
	  }

	  /**
	   * @param {any} nodeStates
	   * @returns {void}
	   */
	  hydrateFromNodeStates(nodeStates) {
	    const source = nodeStates && typeof nodeStates === "object" ? nodeStates : {};
	    if (!this.state || typeof this.state !== "object") this.state = createEmptyDesignLoopState();

	    const contentPackage = source.contentPackage || source.parsedContentPackage || null;
	    if (contentPackage && typeof contentPackage === "object") {
	      this.state.contentPackage = deepClone(contentPackage);
	    }

    if (Array.isArray(source.slideIntents)) {
      this.state.slideIntents = deepClone(source.slideIntents);
    }

    if (source.designSystem && typeof source.designSystem === "object") {
      this.state.designSystem = deepClone(source.designSystem);
    }

    if (Array.isArray(source.slideHtmls)) {
      this.state.slideHtmls = deepClone(source.slideHtmls);
    }

    if (typeof source.deckHtmlDsl === "string") {
      this.state.deckHtmlDsl = source.deckHtmlDsl;
    }

    if (Array.isArray(source.imageSlots)) {
      this.state.imageSlots = deepClone(source.imageSlots);
    }

    if (Array.isArray(source.visualSlots)) {
      this.state.visualSlots = deepClone(source.visualSlots);
    }
	  }


	  /**
	   * @param {DesignPhaseState} state
	   * @param {string} next
	   * @param {{ emit?: Function, runId?: string, payload?: any, lifecycle?: any }} [context]
	   * @returns {string}
	   */
	  _transitionPhase(state, next, { emit, runId, payload, lifecycle } = {}) {
	    const from = state.status;
	    const ok = designPhaseMachine.transition(state, next, { runId, from, to: next, ...payload });
	    if (!ok) {
      throw new Error(`DesignPhase transition rejected: ${from} -> ${next}`);
    }
    const phaseLifecycle =
      lifecycle ||
      this._lifecycle ||
      createLifecycleEmitter({
        actor: "design",
        emit,
        eventBus: this.eventBus,
      });
    const traceContext = this._traceContext;
    if (traceContext && typeof traceContext.startSpan === "function" && typeof traceContext.endSpan === "function") {
      const span = traceContext.startSpan("design.phase.transition", {
        attributes: { from, to: next, runId },
      });
      try {
        phaseLifecycle.phaseTransition(from, next, runId, payload);
      } finally {
        traceContext.endSpan(span);
      }
    } else {
      phaseLifecycle.phaseTransition(from, next, runId, payload);
    }
	    return next;
	  }

	  /**
	   * @param {string} newStatus
	   * @param {Record<string, any>} [metadata]
	   * @returns {Promise<string|null>}
	   */
	  async _transitionTo(newStatus, metadata = {}) {
	    const oldStatus = this._loopStatus;
	    if (oldStatus === newStatus) return null;

    // 简化状态机：只验证基本转换
    const validTransitions = {
      [AgentStatus.IDLE]: [AgentStatus.RUNNING],
      [AgentStatus.RUNNING]: [AgentStatus.COMPLETED, AgentStatus.FAILED, AgentStatus.PAUSED],
      [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.FAILED],
      [AgentStatus.COMPLETED]: [],
      [AgentStatus.FAILED]: [],
    };
	    const allowed = validTransitions[oldStatus] || [];
	    if (!allowed.includes(newStatus)) {
	      const err = new Error(`Invalid DesignLoop state transition: ${oldStatus} -> ${newStatus}`);
	      /** @type {ErrorWithCode} */ (err).code = "INVALID_STATE_TRANSITION";
	      throw err;
	    }

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { stageApi, nodeStates, ...historyMeta } = meta;
    const timestamp = Date.now();
    const runtimeState = stageApi?.signal ? getRuntimeState(stageApi.signal) : null;
    const runtimePauseRequested = runtimeState?.status === "paused";
    let checkpointId = null;

    // 在 RUNNING 状态下检查暂停请求
    if (newStatus === AgentStatus.RUNNING && this.archive) {
      checkpointId = await this._savePreActionCheckpoint({
        ...historyMeta,
        ...(nodeStates && typeof nodeStates === "object" ? { nodeStates } : {}),
      });
      if (runtimeState && checkpointId) runtimeState.lastCheckpointId = checkpointId;
    }

    const shouldPause = this._pauseRequested || runtimePauseRequested;
    if (shouldPause && newStatus === AgentStatus.RUNNING) {
      const reason = runtimeState?.pausedReason || this._pauseReason || null;
      const resolvedCheckpointId = checkpointId ?? historyMeta.checkpointId ?? runtimeState?.lastCheckpointId ?? null;
      if (runtimeState && resolvedCheckpointId) runtimeState.lastCheckpointId = resolvedCheckpointId;

      this._loopStatus = AgentStatus.PAUSED;
      this._statusHistory.push({
        from: oldStatus,
        to: AgentStatus.PAUSED,
        timestamp,
        ...historyMeta,
        ...(resolvedCheckpointId ? { checkpointId: resolvedCheckpointId } : {}),
        pausedReason: reason,
      });

      // 发出暂停状态变更事件
      this._emitAgentStatusChanged({ from: oldStatus, to: AgentStatus.PAUSED, timestamp, pausedReason: reason });

      throw new StagePausedError("Run paused", {
        checkpointId: resolvedCheckpointId,
        reason,
        timestamp,
        runId: historyMeta.runId ?? null,
      });
    }

    this._loopStatus = newStatus;
    this._statusHistory.push({
      from: oldStatus,
      to: newStatus,
      timestamp,
      ...historyMeta,
      ...(checkpointId ? { checkpointId } : {}),
    });

    // 发出状态变更事件，供 UI/Workflow 层监听
    this._emitAgentStatusChanged({ from: oldStatus, to: newStatus, timestamp, ...historyMeta });

    return checkpointId;
  }

  /**
   * @param {any} payload
   * @returns {void}
   */
  _emitAgentStatusChanged(payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit("design.agent.status.changed", { actor: "design", status: "info", payload });
  }

  /**
   * @param {Record<string, any>} metadata
   * @returns {Promise<string|null>}
   */
  async _savePreActionCheckpoint(metadata) {
    if (!this.archive) return null;
    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const { nodeStates, ...metadataRest } = meta;
    const serialized = this.serializeNodeStates();
    const mergedNodeStates = {
      ...(serialized && typeof serialized === "object" ? serialized : {}),
      ...(nodeStates && typeof nodeStates === "object" ? nodeStates : {}),
    };
    const state = {
      phase: this.phase?.status,
      loopStatus: this._loopStatus,
      statusHistory: this._statusHistory.map((entry) => ({ ...entry })),
      ...mergedNodeStates,
    };

    const checkpoint = createCheckpoint(state, {
      ...metadataRest,
      type: CheckpointType.PRE_ACTION,
    });

    return this.archive.save(meta.runId || "unknown", checkpoint);
  }

  /**
   * @returns {string}
   */
  get loopStatus() {
    return this._loopStatus;
  }

  /**
   * @returns {any[]}
   */
  get statusHistory() {
    return [...this._statusHistory];
  }

  // Delegate to VisualHandler
  /**
   * @param {any} contentPackage
   * @param {DesignStageApi} context
   * @param {any} constraints
   * @param {any} userConfig
   * @returns {Promise<any>}
   */
  async _initDesignSystem(contentPackage, context, constraints, userConfig) {
    return this._visualHandler.initDesignSystem(contentPackage, context, constraints, userConfig);
  }

  /**
   * @param {any} brainstormResult
   * @param {any[]} imageSlots
   * @param {any} imageProvider
   * @param {boolean} [hasModelCapability]
   * @returns {any[]}
   */
  _buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
    return this._visualHandler.buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);
  }

  /**
   * @param {any[]} visualSlotsForRender
   * @param {any} contentPackage
   * @param {any} designSystem
   * @param {any[]} slideHtmls
   * @param {DesignStageApi} context
   * @param {any} runContext
   * @param {any} constraints
   * @param {any[]} imageSlots
   * @param {string[]} aiImageSlotIds
   * @returns {Promise<any>}
   */
  async _renderVisuals(
    visualSlotsForRender,
    contentPackage,
    designSystem,
    slideHtmls,
    context,
    runContext,
    constraints,
    imageSlots,
    aiImageSlotIds
  ) {
    if (this.state && typeof this.state === "object") {
      this.state.visualSlots = Array.isArray(visualSlotsForRender) ? deepClone(visualSlotsForRender) : [];
    }
    return this._visualHandler.renderVisuals(
      visualSlotsForRender,
      contentPackage,
      designSystem,
      slideHtmls,
      context,
      runContext,
      constraints,
      imageSlots,
      aiImageSlotIds
    );
  }

  /**
   * Stage interface (Runtime): execute(runContext, contentPackage) -> DeckPackage.
   * @param {object} runContext
   * @param {object} contentPackage ContentPackage v0.1
   * @param {DesignStageApi} [stageApi]
   * @returns {Promise<any>}
   */
  async execute(runContext, contentPackage, stageApi = {}) {
    return super.execute(runContext, contentPackage, stageApi);
  }

  /**
   * Convenience adapter: run(contentPackage, context) -> DeckPackage.
   * 支持 BacktrackError 自动重启机制
   * @param {any} contentPackage
   * @param {DesignStageApi} [context]
   * @returns {Promise<any>}
   */
  async run(contentPackage = null, context = {}) {
    const stageApi = context && typeof context === "object" ? context : {};
    const traceContext = resolveStageTraceContext(stageApi);
    const runContext = stageApi.runContext || {
      runId: contentPackage?.runId || "run_unknown",
      constraints: contentPackage?.constraints || {},
      userConfig: stageApi?.userConfig || contentPackage?.userConfig || {},
    };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
    const errorBoundary = resolveErrorBoundary(stageApi, this._container);

    const tracedContext = {
      ...stageApi,
      traceContext,
      aiApiService: createTracedAiApiService(stageApi.aiApiService, traceContext),
      modelRouter: createTracedModelRouter(stageApi.modelRouter, traceContext),
    };

    const prevTraceContext = this._traceContext;
    this._traceContext = traceContext;
    try {
      const shouldDegrade = () => {
        const cfg =
          stageApi && typeof stageApi === "object" && stageApi.errorBoundaryConfig && typeof stageApi.errorBoundaryConfig === "object"
            ? stageApi.errorBoundaryConfig
            : null;
        if (cfg?.degrade === true) return true;
        if (stageApi?.errorBoundaryDegrade === true || stageApi?.degradeOnError === true) return true;
        if (runContext?.userConfig?.errorBoundary?.degrade === true) return true;
        if (contentPackage?.userConfig?.errorBoundary?.degrade === true) return true;
        return false;
      };

      const fallbackFactory = () => {
        return {
          schemaVersion: SCHEMA_VERSION,
          runId,
          designSystem: this.state?.designSystem || null,
          deckHtmlDsl: typeof this.state?.deckHtmlDsl === "string" ? this.state.deckHtmlDsl : "",
          slidesMeta: Array.isArray(this.state?.slidesMeta) ? this.state.slidesMeta : [],
        };
      };

      return await errorBoundary.wrap(
        async () =>
          await traceContext.withSpan(
            "design.run",
            async (runSpan) => {
          runSpan.setAttributes({
            runId,
            slideCount: Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents.length : 0,
            batchSize: this.batchSize,
          });

          let backtrackAttempts = 0;
          const maxAttempts = DESIGN_LOOP_DEFAULTS.maxBacktrackAttempts;

          // BacktrackError 重启循环
          while (backtrackAttempts <= maxAttempts) {
            try {
              return await this._runCore(contentPackage, tracedContext);
            } catch (err) {
              if (err instanceof BacktrackError && backtrackAttempts < maxAttempts) {
                backtrackAttempts++;
                this._emit?.("design.backtrack.restart", {
                  attempt: backtrackAttempts,
                  maxAttempts,
                  targetPhase: err.targetPhase,
                  reason: err.reason,
                });
                // 继续循环，从恢复的状态重新执行
                continue;
              }
              throw err;
            }
          }

          throw new Error(`Max backtrack attempts (${maxAttempts}) exceeded`);
        },
        { attributes: { stage: "design", runId } }
          ),
        {
          context: {
            stage: "design",
            runId,
            shouldDegrade,
            fallbackFactory,
            emit: typeof stageApi?.emit === "function" ? stageApi.emit : null,
          },
          rethrow: true,
        }
      );
    } finally {
      this._traceContext = prevTraceContext;
    }
  }

  /**
   * 核心执行逻辑（从 run 提取）
   * @private
   * @param {any} contentPackage
   * @param {DesignStageApi} [context]
   * @returns {Promise<any>}
   */
  async _runCore(contentPackage, context = {}) {
    const runContext = context.runContext || {
      runId: contentPackage?.runId || "run_unknown",
      constraints: contentPackage?.constraints || {},
      userConfig: context?.userConfig || contentPackage?.userConfig || {},
    };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
	    const traceContext =
	      context?.traceContext && typeof context.traceContext.withSpan === "function" ? context.traceContext : null;
	    this.eventBus = context.eventBus || this.eventBus || null;
	    const eventBus = /** @type {any} */ (this.eventBus);
	    let emit = getEmitFn(context);
	    if ((!emit || emit === this.eventBus?.emit) && this.eventBus?.emit) {
	      emit = this.eventBus.emit.bind(this.eventBus);
	    }
    this.emit = emit || this.emit || null;
	    this._emit = this.emit;

	    // P4.6: Enable backpressure for high-frequency events (best-effort).
	    if (eventBus && typeof eventBus.enableBackpressure === "function" && !eventBus?._backpressure?.enabled) {
	      const cfg = context?.eventBusBackpressure ?? context?.backpressure;
	      if (cfg !== false) {
	        const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
	        try {
	          eventBus.enableBackpressure({
	            coalescePattern: /\.progress$/,
	            deferNonCoalesced: false,
	            maxQueueSize: 10000,
	            ...opts,
	          });
        } catch {
          // ignore
        }
      }
    }

    const lifecycle = createLifecycleEmitter({
      actor: "design",
      emit: this.emit,
      eventBus: this.eventBus,
    });
    this._lifecycle = lifecycle;

    // Watchdog: loop/oscillation detection (deck update + refine loop)
    const initialUserConfig =
      (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
      (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
      (context && typeof context === "object" ? context.userConfig : undefined) ||
      {};
    const watchdogSettings = resolveWatchdogSettings(initialUserConfig);
    let watchdog = await this._resolveDependency("watchdog", context, null);
    if (watchdog && typeof watchdog.reset === "function") watchdog.reset();
    if (!watchdog) {
      watchdog = new Watchdog(
        /** @type {any} */ ({
          eventBus: this.eventBus,
          maxRecentOutputs: watchdogSettings.maxRecentOutputs,
          oscillationThreshold: watchdogSettings.similarityThreshold,
        })
      );
    } else if (typeof watchdog.configure === "function") {
      watchdog.configure({
        maxRecentOutputs: watchdogSettings.maxRecentOutputs,
        oscillationThreshold: watchdogSettings.similarityThreshold,
      });
    }
    this._watchdog = watchdog;
	    let lastInterventionAt = 0;

	    const handleWatchdogHealth = (health, meta = {}) => {
      if (!health || health.healthy) return;
      const now = Date.now();
      if (now - lastInterventionAt < 1500) return;
      lastInterventionAt = now;

      const advice = buildDesignWatchdogAdvice(health.issues);
      logger.warn("[design] Watchdog intervention", { runId, ...meta, issues: health.issues, stats: health.stats, advice });
      emitStage(emit, "design.watchdog.intervention", "warn", { runId, ...meta, issues: health.issues, stats: health.stats, advice });
      this._blackboard?.logDecision?.("watchdog_intervention", advice, { runId, ...meta, issues: health.issues, stats: health.stats });

      // Soft reset to avoid repeated triggers without extending overall timers.
      if (typeof watchdog?.resetOscillation === "function") watchdog.resetOscillation();
    };

	    const offRefineWatchdog =
	      eventBus && typeof eventBus.on === "function"
	        ? eventBus.on("design.refine.step", (evt) => {
	          if (evt?.runId && evt.runId !== runId) return;
	          if (!watchdog) return;

          const summary = summarizeRefineEventForWatchdog(evt);
          if (!summary) return;
          watchdog.tick?.();
          watchdog.recordOutput?.(summary);
          const health = watchdog.checkHealth?.({
            maxIterations: 200,
            maxTimeMs: watchdogSettings.maxTimeMs,
            stuckThresholdMs: watchdogSettings.stuckThresholdMs,
            oscillationConsecutiveThreshold: watchdogSettings.maxConsecutiveSimilar,
          });
          if (health && !health.healthy) {
            handleWatchdogHealth(health, { phase: this.phase?.status, source: "refine_step", refineStep: evt?.payload?.stepIndex });
          }
        })
        : null;

	    // 仅在初始运行时初始化状态，回溯重启时保留已恢复的状态
	    if (!context.resumed && !this._isBacktracking) {
	      /** @type {DesignPhaseState} */
	      this.phase = { status: DesignPhase.IDLE };
	      // 从容器或 context 获取 memoryStore 并绑定到 Blackboard
	      const memoryStore = await this._resolveDependency("memoryStore", context, this._memoryStore);
	      const stateEngine = await this._resolveDependency("stateEngine", context, this._stateEngine);
	      this._blackboard = new DesignBlackboard(/** @type {any} */ ({ runId, memoryStore, stateEngine }));
	      this._memoryStore = memoryStore;
	      this._stateEngine = stateEngine;
	      this._iteration = 0;
	      this.state.contentPackage = contentPackage;
	    }
    this._isBacktracking = false;

    const stageApi = { signal: context.signal };
    let iteration = 0;
    const buildLoopState = (step) => ({
      phase: this.phase?.status,
      step,
    });
    const buildLoopMeta = (step, loopIteration) => ({
      runId,
      iteration: loopIteration,
      state: buildLoopState(step),
      stageApi,
    });
    const startExecution = async (step, nodeStates) => {
      const loopIteration = ++iteration;
      watchdog?.tick?.();
      // 用事件替代复杂状态转换
      emitStage(emit, "design.step.started", "progress", { runId, step, iteration: loopIteration });
      const stepInfo = this._beginStep({
        name: step,
        runId,
        iteration: loopIteration,
        meta: nodeStates,
      }, context);
      return { loopIteration, stepInfo };
    };
    const finishExecution = async (step, loopIteration, stepInfo) => {
      emitStage(emit, "design.step.completed", "progress", { runId, step, iteration: loopIteration });
      this._endStep(stepInfo, { status: "completed" });
    };
    const buildDeckSignature = (deckHtmlDsl) => {
      if (typeof deckHtmlDsl !== "string") return null;
      const sigLen = DESIGN_LOOP_DEFAULTS.signatureLength;
      const head = deckHtmlDsl.slice(0, sigLen);
      const tail = deckHtmlDsl.slice(-sigLen);
      return `${deckHtmlDsl.length}:${head}:${tail}`;
	    };
	    let lastDeckSignature = null;
	    /**
	     * @param {string} deckHtmlDsl
	     * @param {any[]} slidesMeta
	     * @param {{ source?: string }} [options]
	     * @returns {void}
	     */
	    const emitDeckUpdate = (deckHtmlDsl, slidesMeta, { source } = {}) => {
	      if (!emit || typeof deckHtmlDsl !== "string") return;
	      if (!deckHtmlDsl.includes("<section")) return;
      const signature = buildDeckSignature(deckHtmlDsl);

      if (watchdog && signature) {
        watchdog.recordOutput?.(`deck_update | source=${source || "update"} | sig=${signature}`);
        const health = watchdog.checkHealth?.({
          maxIterations: 200,
          maxTimeMs: watchdogSettings.maxTimeMs,
          stuckThresholdMs: watchdogSettings.stuckThresholdMs,
          oscillationConsecutiveThreshold: watchdogSettings.maxConsecutiveSimilar,
        });
        if (health && !health.healthy) {
          handleWatchdogHealth(health, { phase: this.phase?.status, source: source || "update" });
        }
      }

      if (signature && signature === lastDeckSignature) return;
      lastDeckSignature = signature;
      this._blackboard?.setDeck?.({ deckHtmlDsl, slidesMeta: Array.isArray(slidesMeta) ? slidesMeta : [] });
      emitStage(emit, "design.deck.updated", "progress", {
        runId,
        source: source || "update",
        phase: this.phase?.status,
        slides: Array.isArray(slidesMeta) ? slidesMeta.length : undefined,
        deckHtmlDsl,
        slidesMeta: Array.isArray(slidesMeta) ? slidesMeta : undefined,
      });
    };

    try {
      await this._transitionTo(AgentStatus.RUNNING, {
        runId,
        stageApi,
        state: buildLoopState("run_start"),
      });

      lifecycle.started(runId, {
        slideCount: Array.isArray(this.state.contentPackage?.slideIntents) ? this.state.contentPackage.slideIntents.length : 0,
      });

      // --- 1. Preparation Phase (Outline + Style) ---
      if (!this.phase.status || this.phase.status === DesignPhase.IDLE || this.phase.status === DesignPhase.OUTLINE_PARSING) {
        const prepResult = traceContext
          ? await traceContext.withSpan("design.phase.preparation", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.contentPackage?.slideIntents) ? this.state.contentPackage.slideIntents.length : 0 });
              return await runPreparationPhase(this, {
                contentPackage: this.state.contentPackage,
                context,
                runContext,
                emit,
                startExecution,
                finishExecution,
              });
            })
          : await runPreparationPhase(this, {
              contentPackage: this.state.contentPackage,
              context,
              runContext,
              emit,
              startExecution,
              finishExecution,
            });
        // 更新持久化状态
        this.state.contentPackage = prepResult.parsedContentPackage;
        this.state.slideIntents = prepResult.slideIntents;
        this.state.designSystem = prepResult.designSystem;
        this.state.constraints = prepResult.constraints;
        this.state.userConfig = prepResult.userConfig;

        this._blackboard.setSummary("outline", `${this.state.slideIntents.length} slides parsed`);
        this._blackboard.setSummary("style", this.state.designSystem?.theme || "default");
        this._blackboard.logDecision("preparation_complete", `Parsed ${this.state.slideIntents.length} slides`);
      }

      // --- 2. Planning Phase ---
      if (context?.enablePlanning !== false && (!this.state.plans || this.phase.status === DesignPhase.DECK_PLANNING)) {
        const planningResult = traceContext
          ? await traceContext.withSpan("design.phase.planning", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.slideIntents) ? this.state.slideIntents.length : 0 });
              return await runPlanningPhase(this, {
                slideIntents: this.state.slideIntents,
                designSystem: this.state.designSystem,
                context,
                runContext,
                emit,
              });
            })
          : await runPlanningPhase(this, {
              slideIntents: this.state.slideIntents,
              designSystem: this.state.designSystem,
              context,
              runContext,
              emit,
            });
        this.state.plans = planningResult.plans;
        this._blackboard.setSummary("plan", `${this.state.plans.length} slides planned`);
      }

      // --- 3. Layout Phase (New!) ---
      if (context?.enableLayout !== false && (!this.state.layoutData || this.phase.status === DesignPhase.LAYOUT_DEVELOPING)) {
        const layoutResult = traceContext
          ? await traceContext.withSpan("design.phase.layout", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.slideIntents) ? this.state.slideIntents.length : 0 });
	              return await runLayoutPhase(this, /** @type {any} */ ({
	                slideIntents: this.state.slideIntents,
	                designSystem: this.state.designSystem,
	                plans: this.state.plans,
	                context,
	                runContext,
	                emit,
	                startExecution,
	                finishExecution,
	              }));
	            })
	          : await runLayoutPhase(this, /** @type {any} */ ({
	              slideIntents: this.state.slideIntents,
	              designSystem: this.state.designSystem,
	              plans: this.state.plans,
	              context,
	              runContext,
	              emit,
	              startExecution,
	              finishExecution,
	            }));
        this.state.layoutData = layoutResult;
        this._blackboard.setSummary("layout", "Wireframes generated");
      }

      this._transitionPhase(this.phase, DesignPhase.GENERATING, { emit, runId: runContext.runId });
      this.state.userConfig = this.applyUserInputsToConfig(this.state.userConfig);

      // Compute skipReview flag for generating phase (skips REVIEWING transition)
      const skipReview = context?.skipReview === true || context?.interactionMode?.finalReview === "skip";

      // --- 4. Generating Phase ---
      if (this.phase.status === DesignPhase.GENERATING) {
        const genPhaseResult = traceContext
          ? await traceContext.withSpan("design.phase.generating", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.slideIntents) ? this.state.slideIntents.length : 0, skipReview });
	              return await runGeneratingPhase(this, /** @type {any} */ ({
	                slideIntents: this.state.slideIntents,
	                contentPackage: this.state.contentPackage,
	                designSystem: this.state.designSystem,
	                constraints: this.state.constraints,
	                userConfig: this.state.userConfig,
	                context,
	                runContext,
	                emit,
	                startExecution,
	                finishExecution,
	                emitDeckUpdate,
	                plans: this.state.plans,
	                layoutData: this.state.layoutData,
	                skipReview,
	              }));
	            })
	          : await runGeneratingPhase(this, /** @type {any} */ ({
	              slideIntents: this.state.slideIntents,
	              contentPackage: this.state.contentPackage,
	              designSystem: this.state.designSystem,
	              constraints: this.state.constraints,
	              userConfig: this.state.userConfig,
	              context,
	              runContext,
	              emit,
	              startExecution,
	              finishExecution,
	              emitDeckUpdate,
	              plans: this.state.plans,
	              layoutData: this.state.layoutData,
	              skipReview,
	            }));

        this.state.generated = genPhaseResult.generated;
        this.state.slideHtmls = genPhaseResult.slideHtmls;
        this.state.slidesMeta = genPhaseResult.slidesMeta;
        this.state.imageSlots = genPhaseResult.imageSlots;
        this.state.baseDeckHtmlDsl = genPhaseResult.baseDeckHtmlDsl;
        this.state.pendingImages = genPhaseResult.pendingImages;
        this.state.brainstormResult = genPhaseResult.brainstormResult;
        this.state.degradedCount = genPhaseResult.degradedCount;

        this.state.userConfig = this.applyUserInputsToConfig(this.state.userConfig);

        // --- 5. Batch Repair Phase (Orchestrated Health Check & Fix) ---
        const repairResult = traceContext
          ? await traceContext.withSpan("design.phase.repair", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.slideHtmls) ? this.state.slideHtmls.length : 0 });
              return await runBatchRepairPhase(
                this,
                {
                  slideHtmls: this.state.slideHtmls,
                  slidesMeta: this.state.slidesMeta,
                  designSystem: this.state.designSystem,
                  contentPackage: this.state.contentPackage,
                  baseDeckHtmlDsl: this.state.baseDeckHtmlDsl,
                },
                { context, runContext, emit }
              );
            })
          : await runBatchRepairPhase(
              this,
              {
                slideHtmls: this.state.slideHtmls,
                slidesMeta: this.state.slidesMeta,
                designSystem: this.state.designSystem,
                contentPackage: this.state.contentPackage,
                baseDeckHtmlDsl: this.state.baseDeckHtmlDsl,
              },
              { context, runContext, emit }
            );

        this.state.deckHtmlDsl = repairResult.deckHtmlDsl;
        this.state.slidesMeta = repairResult.slidesMeta;
        this.state.baseDeckHtmlDsl = repairResult.deckHtmlDsl; // Update base for next steps

        // --- 5. Visual Filling Phase ---
        const visualPhaseResult = traceContext
          ? await traceContext.withSpan("design.phase.visual", async (span) => {
              span.setAttributes({ runId, slideCount: Array.isArray(this.state.slideHtmls) ? this.state.slideHtmls.length : 0 });
              return await runVisualPhase(this, {
                contentPackage: this.state.contentPackage,
                slideIntents: this.state.slideIntents,
                designSystem: this.state.designSystem,
                generated: this.state.generated,
                slideHtmls: this.state.slideHtmls,
                slidesMeta: this.state.slidesMeta,
                imageSlots: this.state.imageSlots,
                baseDeckHtmlDsl: this.state.baseDeckHtmlDsl,
                pendingImages: this.state.pendingImages,
                brainstormResult: this.state.brainstormResult,
                constraints: this.state.constraints,
                userConfig: this.state.userConfig,
                context,
                runContext,
                emit,
                startExecution,
                finishExecution,
                emitDeckUpdate,
              });
            })
          : await runVisualPhase(this, {
              contentPackage: this.state.contentPackage,
              slideIntents: this.state.slideIntents,
              designSystem: this.state.designSystem,
              generated: this.state.generated,
              slideHtmls: this.state.slideHtmls,
              slidesMeta: this.state.slidesMeta,
              imageSlots: this.state.imageSlots,
              baseDeckHtmlDsl: this.state.baseDeckHtmlDsl,
              pendingImages: this.state.pendingImages,
              brainstormResult: this.state.brainstormResult,
              constraints: this.state.constraints,
              userConfig: this.state.userConfig,
              context,
              runContext,
              emit,
              startExecution,
              finishExecution,
              emitDeckUpdate,
            });

        this.state.deckHtmlDsl = visualPhaseResult.deckHtmlDsl;
        this.state.slidesMeta = visualPhaseResult.slidesMeta;
        this.state.finalImageSlots = visualPhaseResult.imageSlots;
        this.state.visualReport = visualPhaseResult.visualReport;
        this.state.imageReport = visualPhaseResult.imageReport;
        this.state.refineResult = visualPhaseResult.refineResult;
        if (Array.isArray(visualPhaseResult.pendingImages)) {
          this.state.pendingImages = visualPhaseResult.pendingImages;
        }

        // --- 7. Final Review Phase (Optional final audit) ---
        // skipReview already computed above
        if (context?.enableFinalReview === true && !skipReview) {
          this._transitionPhase(this.phase, DesignPhase.REVIEWING, { emit, runId: runId });
          const finalReviewResult = traceContext
            ? await traceContext.withSpan("design.phase.review", async (span) => {
                span.setAttributes({ runId, slideCount: Array.isArray(this.state.slidesMeta) ? this.state.slidesMeta.length : 0 });
                return await runReviewPhase(this, {
                  deckHtmlDsl: this.state.deckHtmlDsl,
                  slidesMeta: this.state.slidesMeta,
                  designSystem: this.state.designSystem,
                  context,
                  runContext,
                  emit,
                });
              })
            : await runReviewPhase(this, {
                deckHtmlDsl: this.state.deckHtmlDsl,
                slidesMeta: this.state.slidesMeta,
                designSystem: this.state.designSystem,
                context,
                runContext,
                emit,
              });
          this.state.reviewResult = finalReviewResult.reviewResult;
        }

        this._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId,
          iteration,
          stageApi,
          state: buildLoopState("completed"),
        });

        this._blackboard.setSummary("generation", `${this.state.slideHtmls.length} slides generated`);
        this._blackboard.saveVersion("final", {
          deckHtmlDsl: this.state.deckHtmlDsl,
          designSystem: this.state.designSystem,
          slidesMeta: this.state.slidesMeta,
        });
        this._blackboard.setDeck({ deckHtmlDsl: this.state.deckHtmlDsl, slidesMeta: this.state.slidesMeta });

        lifecycle.completed(runId, { slides: this.state.slideHtmls.length, degradedCount: this.state.degradedCount });

        return {
          schemaVersion: SCHEMA_VERSION,
          runId: runContext.runId,
          designSystem: this.state.designSystem,
          deckHtmlDsl: this.state.deckHtmlDsl,
          slidesMeta: this.state.slidesMeta,
          editHints: { degradedCount: this.state.degradedCount },
          imageSlots: this.state.finalImageSlots,
          imageReport: this.state.imageReport,
          visualReport: this.state.visualReport,
          pendingImages: this.state.pendingImages,
          refineReport: this.state.refineResult || null,
          reviewReport: this.state.reviewResult || null,
        };
      }

      await this._transitionTo(AgentStatus.COMPLETED, {
        runId,
        iteration,
        stageApi,
        state: buildLoopState("completed"),
      });

      return {
        schemaVersion: SCHEMA_VERSION,
        runId: runContext.runId,
        designSystem: null,
        deckHtmlDsl: "",
        slidesMeta: [],
      };
    } catch (err) {
      // BacktrackError: 重新抛出让外层 while 循环处理
      if (err instanceof BacktrackError) {
        throw err;
      }
	      const pauseLike = this._shouldPauseFromError(err, context.signal);
	      if (this._activeStep) {
	        const message = err instanceof Error ? err.message : String(err);
	        this._endStep(null, /** @type {any} */ ({ status: pauseLike ? "paused" : "failed", error: message }));
	      }
      if (err instanceof StagePausedError) {
        throw err;
      }
      if (pauseLike) {
        throw this._createPauseError({ signal: context.signal, runId });
      }

      try {
        await this._transitionTo(AgentStatus.FAILED, {
          runId,
          stageApi,
          state: buildLoopState("failed"),
          error: err?.message,
        });
      } catch {
        // ignore secondary transition failures
      }

      lifecycle.failed(runId, err);
      throw err;
    } finally {
      try {
        offRefineWatchdog?.();
      } catch {
        // ignore
      }
    }
  }
}

export async function resumeDesignAgentLoop(checkpointId, stageApi = {}) {
  const archive =
    stageApi?.archive ||
    new Archive(typeof indexedDB !== "undefined" ? new FallbackAdapter("PPTArchiveDB", "checkpoints") : new MapAdapter());

  const snapshot = migrateCheckpoint(await archive.restore(checkpointId));
  if (!snapshot?.nodeStates) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }

  const nodeStates = snapshot.nodeStates || {};

  const agentLoop = new DesignAgentLoop({ ...stageApi, archive });
  const restoredLoopStatus = nodeStates.loopStatus || AgentStatus.IDLE;
  const restoredPhase = nodeStates.phase || DesignPhase.IDLE;

  agentLoop._loopStatus = AgentStatus.IDLE;
  // Start from a valid "forward" phase to avoid illegal transitions when resuming.
  agentLoop.phase = { status: DesignPhase.IDLE };
  if (Array.isArray(nodeStates.statusHistory)) {
    agentLoop._statusHistory.length = 0;
    for (const entry of nodeStates.statusHistory) agentLoop._statusHistory.push({ ...entry });
  }

  agentLoop._pauseRequested = false;
  agentLoop._pauseReason = null;

  agentLoop.hydrateFromNodeStates(nodeStates);

  const resumeState = {
    phase: restoredPhase,
    loopStatus: restoredLoopStatus,
    contentPackage: agentLoop.state?.contentPackage || null,
    parsedContentPackage: nodeStates.parsedContentPackage || null,
    slideIntents: Array.isArray(agentLoop.state?.slideIntents) ? agentLoop.state.slideIntents : null,
    designSystem: agentLoop.state?.designSystem || null,
    generated: Array.isArray(nodeStates.generated) ? nodeStates.generated : null,
    slideHtmls: Array.isArray(agentLoop.state?.slideHtmls) ? agentLoop.state.slideHtmls : null,
    deckHtmlDsl: typeof agentLoop.state?.deckHtmlDsl === "string" ? agentLoop.state.deckHtmlDsl : "",
    slidesMeta: Array.isArray(nodeStates.slidesMeta) ? nodeStates.slidesMeta : null,
    imageSlots: Array.isArray(agentLoop.state?.imageSlots) ? agentLoop.state.imageSlots : null,
    visualSlots: Array.isArray(agentLoop.state?.visualSlots) ? agentLoop.state.visualSlots : null,
    imageReport: nodeStates.imageReport || null,
    visualReport: nodeStates.visualReport || null,
    pendingImages: Array.isArray(nodeStates.pendingImages) ? nodeStates.pendingImages : null,
    refineReport: nodeStates.refineReport || null,
    constraints: nodeStates.constraints || null,
    userConfig: nodeStates.userConfig || null,
  };

  agentLoop._resumeState = resumeState;

  const fallbackContentPackage = stageApi?.contentPackage || stageApi?.input || null;
  const contentPackage = resumeState.contentPackage || fallbackContentPackage;
  if (!contentPackage || typeof contentPackage !== "object") {
    throw new Error(`Checkpoint missing contentPackage: ${checkpointId}`);
  }
  if (agentLoop.state && typeof agentLoop.state === "object" && !agentLoop.state.contentPackage) {
    agentLoop.state.contentPackage = deepClone(contentPackage);
  }

  const runIdFromMeta = snapshot?.metadata?.runId;
  const resolvedRunId =
    (stageApi?.runContext && stageApi.runContext.runId) || nodeStates.runId || runIdFromMeta || contentPackage.runId || "run_unknown";
  const resolvedConstraints =
    (stageApi?.runContext && stageApi.runContext.constraints) || contentPackage.constraints || resumeState.constraints || {};
  const runContext = stageApi?.runContext
    ? { ...stageApi.runContext, runId: resolvedRunId, constraints: stageApi.runContext.constraints || resolvedConstraints }
    : { runId: resolvedRunId, constraints: resolvedConstraints };

  const phaseRank = {
    [DesignPhase.IDLE]: 0,
    [DesignPhase.OUTLINE_PARSING]: 1,
    [DesignPhase.OUTLINE_CONFIRMING]: 1,
    [DesignPhase.STYLE_EXTRACTING]: 1,
    [DesignPhase.STYLE_CONFIRMING]: 2,
    [DesignPhase.DECK_PLANNING]: 2,
    [DesignPhase.PLAN_CONFIRMING]: 2,
    [DesignPhase.LAYOUT_ANALYZING]: 3,
    [DesignPhase.LAYOUT_GENERATING]: 4,
    [DesignPhase.LAYOUT_DEVELOPING]: 4,
    [DesignPhase.LAYOUT_CONFIRMING]: 4,
    [DesignPhase.GENERATING]: 5,
    [DesignPhase.GENERATING_PAUSED]: 5,
    [DesignPhase.REVIEWING]: 6,
    [DesignPhase.FIXING]: 6,
    [DesignPhase.REPAIR]: 6,
    [DesignPhase.VISUAL_FILLING]: 7,
    [DesignPhase.COMPLETED]: 8,
    [DesignPhase.EDITING]: 8,
    [DesignPhase.FAILED]: 0,
  };

  const resumePhase = resumeState.phase || DesignPhase.IDLE;
  const resumeIndex = phaseRank[resumePhase] ?? 0;
  const canUseOutline = resumeIndex >= phaseRank[DesignPhase.STYLE_EXTRACTING];
  const canUseDesign = resumeIndex >= phaseRank[DesignPhase.STYLE_CONFIRMING];
  const canUseGenerated = resumeIndex >= phaseRank[DesignPhase.VISUAL_FILLING];

  const baseExecutor = resolveToolExecutor(stageApi);
  const outlineContentPackage = resumeState.parsedContentPackage || resumeState.contentPackage || contentPackage;
  const outlineSlideIntents =
    resumeState.slideIntents ||
    (Array.isArray(outlineContentPackage?.slideIntents) ? outlineContentPackage.slideIntents : null);
  let cachedGenerated = resumeState.generated;
  if (!cachedGenerated && Array.isArray(resumeState.slideHtmls)) {
    const sources = Array.isArray(resumeState.slidesMeta) ? resumeState.slidesMeta : [];
    cachedGenerated = resumeState.slideHtmls.map((slideHtml, index) => ({
      slideHtml,
      source: sources[index]?.source || "resume",
    }));
  }

  const toolExecutor = async (name, params, context) => {
    if (name === "parse_outline" && canUseOutline && Array.isArray(outlineSlideIntents)) {
      return { contentPackage: outlineContentPackage, slideIntents: outlineSlideIntents };
    }
    if (name === "extract_style" && canUseDesign && resumeState.designSystem) {
      return { designSystem: resumeState.designSystem };
    }
    if (name === "spawn_slide_agent" && canUseGenerated && Array.isArray(cachedGenerated)) {
      return { generated: cachedGenerated };
    }
    if (typeof baseExecutor === "function") {
      return baseExecutor(name, params, context);
    }
    const tool = agentLoop._tools?.[name];
    if (typeof tool === "function") {
      return tool(params, context);
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  };

  return agentLoop.run(contentPackage, {
    ...stageApi,
    runContext,
    resumed: true,
    resumeState,
    toolExecutor,
  });
}
