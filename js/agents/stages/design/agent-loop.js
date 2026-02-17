import { enableBackpressureIfNeeded } from "../../shared/utils/backpressure-init.js";
import { AgentStatus, BaseAgentLoop, StagePausedError, createLifecycleEmitter, getEmitFn } from "../../runtime/index.js";
import { DesignPhase } from "./states.js";
import {
  runPreparationPhase,
  runGeneratingPhase,
  runBatchRepairPhase,
  runVisualPhase,
  runReviewPhase,
  runPlanningPhase,
  runLayoutPhase,
} from "./internal/phases/index.js";
import { DesignBlackboard } from "./internal/design-blackboard.js";
import {
  DESIGN_LOOP_DEFAULTS,
  resolveStageTraceContext,
  resolveErrorBoundary,
  createTracedAiApiService,
  createTracedModelRouter,
  emitStage,
  loadDesignConcurrencyConfig,
  BacktrackError,
} from "./design-helpers.js";
import { shouldDegrade as shouldDegradeCheck } from "../../shared/index.js";
import { DeckOperations, createDeckUpdateEmitter, finalizeDeck, initWatchdogManager, installDeckOperations } from "./internal/deck-operations.js";
import { createEmptyDesignLoopState, installStateManager, resumeDesignAgentLoop as resumeDesignAgentLoopInternal } from "./internal/state-manager.js";
import { initDesignTooling, installToolHandler } from "./internal/tool-handler.js";

export { DESIGN_AGENT_TOOL_DEFINITIONS } from "./design-tools.js";

/**
 * @typedef {import("./internal/design-loop-types.js").DesignLoopConstructorOptions} DesignLoopConstructorOptions
 * @typedef {import("./internal/design-loop-types.js").DesignStageApi} DesignStageApi
 * @typedef {import("./internal/design-loop-types.js").DesignPhaseState} DesignPhaseState
 * @typedef {import("./internal/design-loop-types.js").DesignLoopState} DesignLoopState
 */

/**
 * @typedef {object} EventBusBackpressureConfig
 * @property {RegExp} [coalescePattern]
 * @property {boolean} [deferNonCoalesced]
 * @property {number} [maxQueueSize]
 */

/**
 * @typedef {object} BackpressureCapableEventBus
 * @property {(name: string, record: Record<string, unknown>) => void} [emit]
 * @property {(config: EventBusBackpressureConfig) => void} [enableBackpressure]
 * @property {{ enabled?: boolean }} [_backpressure]
 */

const SCHEMA_VERSION = "0.1";

export { BacktrackError };

/**
 * Main orchestrator for the design stage.
 */
export class DesignAgentLoop extends BaseAgentLoop {
  /**
   * Installed by `installStateManager(DesignAgentLoop)` below.
   * Declared here for TS checkJs (TS2339).
   * @private
   * @type {(newStatus: string, metadata?: Record<string, any>) => Promise<string|null>}
   */
  _transitionTo = DesignAgentLoop.prototype._transitionTo;

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
    this._deckOps = new DeckOperations(this, { imageConcurrency: this.imageConcurrency });
    initDesignTooling(this, tools);
    /** @type {DesignPhaseState} */
    this.phase = { status: DesignPhase.IDLE };
    /** @type {string} */
    this.statusController._loopStatus = AgentStatus.IDLE;
    if (Array.isArray(this.statusController._statusHistory)) this.statusController._statusHistory.length = 0;
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
    /** @type {unknown} Snapshot of last resume (resumeDesignAgentLoop). */
    this._resumeState = null;
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
    return this.statusController._loopStatus || AgentStatus.IDLE;
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
      const shouldDegrade = () => shouldDegradeCheck({ stageApi, configs: [runContext?.userConfig, contentPackage?.userConfig] });

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
    const rt = await this._initCoreRuntime(contentPackage, context);

    try {
      await this._transitionTo(AgentStatus.RUNNING, {
        runId: rt.runId, stageApi: rt.stageApi, state: rt.buildLoopState("run_start"),
      });
      rt.lifecycle.started(rt.runId, {
        slideCount: Array.isArray(this.state.contentPackage?.slideIntents) ? this.state.contentPackage.slideIntents.length : 0,
      });

      // --- Sequential phase orchestration ---
      await this._phasePreparation(rt);
      await this._phasePlanning(rt);
      await this._phaseLayout(rt);

      this.phaseRunner._transitionPhase(this.phase, DesignPhase.GENERATING, { emit: rt.emit, runId: rt.runContext.runId });

      if (this.phase.status === DesignPhase.GENERATING) {
        await this._phaseGenerating(rt);
        await this._phaseBatchRepair(rt);
        await this._phaseVisual(rt);
        await this._phaseReview(rt);

        this.phaseRunner._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit: rt.emit, runId: rt.runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId: rt.runId, iteration: rt.iter.count, stageApi: rt.stageApi, state: rt.buildLoopState("completed"),
        });
        finalizeDeck(this);
        rt.lifecycle.completed(rt.runId, { slides: this.state.slideHtmls.length, degradedCount: this.state.degradedCount });
        return this._buildDeckResult(rt);
      }

      await this._transitionTo(AgentStatus.COMPLETED, {
        runId: rt.runId, iteration: rt.iter.count, stageApi: rt.stageApi, state: rt.buildLoopState("completed"),
      });
      return { schemaVersion: SCHEMA_VERSION, runId: rt.runContext.runId, designSystem: null, deckHtmlDsl: "", slidesMeta: [] };
    } catch (err) {
      await this._handleCoreError(err, rt);
    } finally {
      try { rt.offRefineWatchdog?.(); } catch { /* ignore */ }
    }
  }

  /**
   * Initialize core runtime context for a _runCore execution.
   * @private
   * @param {any} contentPackage
   * @param {DesignStageApi} context
   * @returns {Promise<{runContext: object, runId: string, emit: Function, lifecycle: object, watchdog: object|null, watchdogSettings: object|null, handleWatchdogHealth: Function|null, offRefineWatchdog: Function|null, stageApi: object, iter: {count: number}, traceContext: object|null, skipReview: boolean, startExecution: Function, finishExecution: Function, emitDeckUpdate: Function, context: DesignStageApi}>}
   */
  async _initCoreRuntime(contentPackage, context = {}) {
    const runContext = context.runContext || {
      runId: contentPackage?.runId || "run_unknown",
      constraints: contentPackage?.constraints || {},
      userConfig: context?.userConfig || contentPackage?.userConfig || {},
    };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
    const traceContext =
      context?.traceContext && typeof context.traceContext.withSpan === "function" ? context.traceContext : null;
    this.eventBus = context.eventBus || this.eventBus || null;
    let emit = getEmitFn(context);
    if ((!emit || emit === this.eventBus?.emit) && this.eventBus?.emit) {
      emit = this.eventBus.emit.bind(this.eventBus);
    }
    this.emit = emit || this.emit || null;
    this._emit = this.emit;

    enableBackpressureIfNeeded(this.eventBus, context?.eventBusBackpressure ?? context?.backpressure);

    const lifecycle = createLifecycleEmitter({ actor: "design", emit: this.emit, eventBus: this.eventBus });
    this._lifecycle = lifecycle;

    const { watchdog, watchdogSettings, handleWatchdogHealth, offRefineWatchdog } = await initWatchdogManager({
      loop: this, context, runContext, contentPackage, runId, emit, eventBus: this.eventBus,
    });

    if (!context.resumed && !this._isBacktracking) {
      this.phase = { status: DesignPhase.IDLE };
      const memoryStore = await this.phaseRunner._resolveDependency("memoryStore", context, this._memoryStore);
      const stateEngine = await this.phaseRunner._resolveDependency("stateEngine", context, this._stateEngine);
      this._blackboard = new DesignBlackboard({ runId, memoryStore, stateEngine });
      this._memoryStore = memoryStore;
      this._stateEngine = stateEngine;
      this._iteration = 0;
      this.state.contentPackage = contentPackage;
    }
    this._isBacktracking = false;

    const stageApi = { signal: context.signal };
    const iter = { count: 0 };
    const skipReview = context?.skipReview === true || context?.interactionMode?.finalReview === "skip";

    const buildLoopState = (step) => ({ phase: this.phase?.status, step });

    const startExecution = async (step, nodeStates) => {
      const loopIteration = ++iter.count;
      watchdog?.tick?.();
      emitStage(emit, "design.step.started", "progress", { runId, step, iteration: loopIteration });
      const stepInfo = this.stepRunner._beginStep({ name: step, runId, iteration: loopIteration, meta: nodeStates }, context);
      return { loopIteration, stepInfo };
    };

    const finishExecution = async (step, loopIteration, stepInfo) => {
      emitStage(emit, "design.step.completed", "progress", { runId, step, iteration: loopIteration });
      this.stepRunner._endStep(stepInfo, { status: "completed" });
    };

    const emitDeckUpdate = createDeckUpdateEmitter({ loop: this, emit, runId, watchdog, watchdogSettings, handleWatchdogHealth });

    return {
      runContext, runId, emit, lifecycle, watchdog, watchdogSettings, handleWatchdogHealth,
      offRefineWatchdog, stageApi, iter, traceContext, skipReview,
      startExecution, finishExecution, emitDeckUpdate, buildLoopState, context,
    };
  }

  /**
   * Run preparation phase if applicable.
   * @private
   * @param {object} rt - Core runtime context from _initCoreRuntime.
   */
  async _phasePreparation(rt) {
    if (!this.phase.status || this.phase.status === DesignPhase.IDLE || this.phase.status === DesignPhase.OUTLINE_PARSING) {
      await runPreparationPhase(this, {
        context: rt.context, runContext: rt.runContext, emit: rt.emit,
        startExecution: rt.startExecution, finishExecution: rt.finishExecution, traceContext: rt.traceContext,
      });
    }
  }

  /**
   * Run planning phase if enabled and needed.
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phasePlanning(rt) {
    if (rt.context?.enablePlanning !== false && (!this.state.plans || this.phase.status === DesignPhase.DECK_PLANNING)) {
      await runPlanningPhase(this, {
        context: rt.context, runContext: rt.runContext, emit: rt.emit, traceContext: rt.traceContext,
      });
    }
  }

  /**
   * Run layout phase if enabled and needed.
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phaseLayout(rt) {
    if (rt.context?.enableLayout !== false && (!this.state.layoutData || this.phase.status === DesignPhase.LAYOUT_DEVELOPING)) {
      await runLayoutPhase(this, {
        context: rt.context, runContext: rt.runContext, emit: rt.emit, traceContext: rt.traceContext,
      });
    }
  }

  /**
   * Run slide generation phase.
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phaseGenerating(rt) {
    await runGeneratingPhase(this, {
      context: rt.context, runContext: rt.runContext, emit: rt.emit,
      startExecution: rt.startExecution, finishExecution: rt.finishExecution,
      traceContext: rt.traceContext, skipReview: rt.skipReview,
    });
  }

  /**
   * Run batch repair phase (health check and fix).
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phaseBatchRepair(rt) {
    await runBatchRepairPhase(this, {
      context: rt.context, runContext: rt.runContext, emit: rt.emit, traceContext: rt.traceContext,
    });
  }

  /**
   * Run visual filling phase.
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phaseVisual(rt) {
    await runVisualPhase(this, {
      context: rt.context, runContext: rt.runContext, emit: rt.emit,
      startExecution: rt.startExecution, finishExecution: rt.finishExecution,
      emitDeckUpdate: rt.emitDeckUpdate, traceContext: rt.traceContext,
    });
  }

  /**
   * Run optional final review phase.
   * @private
   * @param {object} rt - Core runtime context.
   */
  async _phaseReview(rt) {
    if (rt.context?.enableFinalReview !== true || rt.skipReview) return;
    this.phaseRunner._transitionPhase(this.phase, DesignPhase.REVIEWING, { emit: rt.emit, runId: rt.runId });
    await runReviewPhase(this, {
      context: rt.context, runContext: rt.runContext, emit: rt.emit, traceContext: rt.traceContext,
    });
  }

  /**
   * Build the full deck result package on successful completion.
   * @private
   * @param {object} rt - Core runtime context.
   * @returns {object}
   */
  _buildDeckResult(rt) {
    return {
      schemaVersion: SCHEMA_VERSION,
      runId: rt.runContext.runId,
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

  /**
   * Handle errors from the core execution try block.
   * Re-throws after emitting lifecycle events and transitioning status.
   * @private
   * @param {Error} err
   * @param {object} rt - Core runtime context.
   */
  async _handleCoreError(err, rt) {
    if (err instanceof BacktrackError) throw err;

    const pauseLike = this.statusController._shouldPauseFromError(err, rt.context.signal);
    if (this._activeStep) {
      const message = err instanceof Error ? err.message : String(err);
      this.stepRunner._endStep(null, { status: pauseLike ? "paused" : "failed", error: message });
    }
    if (err instanceof StagePausedError) throw err;
    if (pauseLike) throw this.statusController._createPauseError({ signal: rt.context.signal, runId: rt.runId });

    try {
      await this._transitionTo(AgentStatus.FAILED, {
        runId: rt.runId, stageApi: rt.stageApi, state: rt.buildLoopState("failed"), error: err?.message,
      });
    } catch {
      // ignore secondary transition failures
    }
    rt.lifecycle.failed(rt.runId, err);
    throw err;
  }
}

installStateManager(DesignAgentLoop);
installDeckOperations(DesignAgentLoop);
installToolHandler(DesignAgentLoop);

export async function resumeDesignAgentLoop(checkpointId, stageApi = {}) {
  return resumeDesignAgentLoopInternal(checkpointId, stageApi, { DesignAgentLoopCtor: DesignAgentLoop });
}
