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
    const runContext = context.runContext || {
      runId: contentPackage?.runId || "run_unknown",
      constraints: contentPackage?.constraints || {},
      userConfig: context?.userConfig || contentPackage?.userConfig || {},
    };
    const runId = runContext.runId || contentPackage?.runId || "run_unknown";
	    const traceContext =
	      context?.traceContext && typeof context.traceContext.withSpan === "function" ? context.traceContext : null;
	    this.eventBus = context.eventBus || this.eventBus || null;
	    const eventBus = this.eventBus;
	    const backpressureBus = /** @type {BackpressureCapableEventBus | null} */ (eventBus);
	    let emit = getEmitFn(context);
	    if ((!emit || emit === this.eventBus?.emit) && this.eventBus?.emit) {
	      emit = this.eventBus.emit.bind(this.eventBus);
	    }
    this.emit = emit || this.emit || null;
	    this._emit = this.emit;

	    // P4.6: Enable backpressure for high-frequency events (best-effort).
	    if (backpressureBus && typeof backpressureBus.enableBackpressure === "function" && !backpressureBus?._backpressure?.enabled) {
	      const cfg = context?.eventBusBackpressure ?? context?.backpressure;
	      if (cfg !== false) {
	        const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
	        try {
	          backpressureBus.enableBackpressure({
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

    const { watchdog, watchdogSettings, handleWatchdogHealth, offRefineWatchdog } = await initWatchdogManager({
      loop: this,
      context,
      runContext,
      contentPackage,
      runId,
      emit,
      eventBus,
    });

	    // 仅在初始运行时初始化状态，回溯重启时保留已恢复的状态
	    if (!context.resumed && !this._isBacktracking) {
	      /** @type {DesignPhaseState} */
	      this.phase = { status: DesignPhase.IDLE };
	      // 从容器或 context 获取 memoryStore 并绑定到 Blackboard
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
    let iteration = 0;
    const buildLoopState = (step) => ({
      phase: this.phase?.status,
      step,
    });
    const startExecution = async (step, nodeStates) => {
      const loopIteration = ++iteration;
      watchdog?.tick?.();
      // 用事件替代复杂状态转换
      emitStage(emit, "design.step.started", "progress", { runId, step, iteration: loopIteration });
      const stepInfo = this.stepRunner._beginStep({
        name: step,
        runId,
        iteration: loopIteration,
        meta: nodeStates,
      }, context);
      return { loopIteration, stepInfo };
    };
    const finishExecution = async (step, loopIteration, stepInfo) => {
      emitStage(emit, "design.step.completed", "progress", { runId, step, iteration: loopIteration });
      this.stepRunner._endStep(stepInfo, { status: "completed" });
    };
    const emitDeckUpdate = createDeckUpdateEmitter({
      loop: this,
      emit,
      runId,
      watchdog,
      watchdogSettings,
      handleWatchdogHealth,
    });

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
        await runPreparationPhase(this, {
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          traceContext,
        });
      }

      // --- 2. Planning Phase ---
      if (context?.enablePlanning !== false && (!this.state.plans || this.phase.status === DesignPhase.DECK_PLANNING)) {
        await runPlanningPhase(this, {
          context,
          runContext,
          emit,
          traceContext,
        });
      }

      // --- 3. Layout Phase (New!) ---
      if (context?.enableLayout !== false && (!this.state.layoutData || this.phase.status === DesignPhase.LAYOUT_DEVELOPING)) {
        await runLayoutPhase(this, {
          context,
          runContext,
          emit,
          traceContext,
        });
      }

      this.phaseRunner._transitionPhase(this.phase, DesignPhase.GENERATING, { emit, runId: runContext.runId });

      // Compute skipReview flag for generating phase (skips REVIEWING transition)
      const skipReview = context?.skipReview === true || context?.interactionMode?.finalReview === "skip";

      // --- 4. Generating Phase ---
      if (this.phase.status === DesignPhase.GENERATING) {
        await runGeneratingPhase(this, {
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          traceContext,
          skipReview,
        });

        // --- 5. Batch Repair Phase (Orchestrated Health Check & Fix) ---
        await runBatchRepairPhase(this, {
          context,
          runContext,
          emit,
          traceContext,
        });

        // --- 6. Visual Filling Phase ---
        await runVisualPhase(this, {
          context,
          runContext,
          emit,
          startExecution,
          finishExecution,
          emitDeckUpdate,
          traceContext,
        });

        // --- 7. Final Review Phase (Optional final audit) ---
        // skipReview already computed above
        if (context?.enableFinalReview === true && !skipReview) {
          this.phaseRunner._transitionPhase(this.phase, DesignPhase.REVIEWING, { emit, runId: runId });
          await runReviewPhase(this, {
            context,
            runContext,
            emit,
            traceContext,
          });
        }

        this.phaseRunner._transitionPhase(this.phase, DesignPhase.COMPLETED, { emit, runId: runContext.runId });
        await this._transitionTo(AgentStatus.COMPLETED, {
          runId,
          iteration,
          stageApi,
          state: buildLoopState("completed"),
        });

        finalizeDeck(this);

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
	      const pauseLike = this.statusController._shouldPauseFromError(err, context.signal);
	      if (this._activeStep) {
	        const message = err instanceof Error ? err.message : String(err);
	        this.stepRunner._endStep(null, { status: pauseLike ? "paused" : "failed", error: message });
	      }
      if (err instanceof StagePausedError) {
        throw err;
      }
      if (pauseLike) {
        throw this.statusController._createPauseError({ signal: context.signal, runId });
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

installStateManager(DesignAgentLoop);
installDeckOperations(DesignAgentLoop);
installToolHandler(DesignAgentLoop);

export async function resumeDesignAgentLoop(checkpointId, stageApi = {}) {
  return resumeDesignAgentLoopInternal(checkpointId, stageApi, { DesignAgentLoopCtor: DesignAgentLoop });
}
