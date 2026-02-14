import { createStageApi } from "../../shared/index.js";
import { EventBus } from "../../core/event-bus.js";
import { ActorType, OrchestratorState, isValidActorType } from "./constants.js";
import { AgentLifecycleEvents } from "../events/events.js";
import { ServiceId } from "../../core/di/defaults.js";
import { TaskGraph } from "./parallel/task-graph.js";
import { enhanceEventBusWithHooks } from "../hooks/event-bus-hooks.js";
import { DisposableBase } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";
import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import {
  normalizeTimeoutMs, maybeAwait,
  isDegradationMatrixLike, defaultMemoryUsageRatio,
  buildRunContext, deriveActorFromStageName, createStageAbortSignal,
  buildDegradationContext, prepareStageInputWithUserConfigValidation,
} from "./orchestrator-helpers.js";
import { AgentCoordination } from "./agent-coordination.js";
import { SchedulingMode, SchedulingStrategies } from "./scheduling-strategies.js";

const logger = createLogger("runtime/orchestrator");

/**
 * @typedef {import("./constants.js").OrchestratorState[keyof import("./constants.js").OrchestratorState]} OrchestratorStateValue
 */

/**
 * AgentOrchestrator
 *
 * Lightweight stage runner used by the PPT workflow layer:
 * - registerStage(name, fn, { actor?, timeoutMs? })
 * - runStage(name, input?)
 * - runStagesParallel(stages) - run multiple stages concurrently
 *
 * Scheduling modes:
 * - sequential (default): stages run one at a time via queue
 * - parallel: stages can run concurrently up to maxConcurrency
 */

export class AgentOrchestrator extends DisposableBase {
  /**
   * @param {AgentOrchestratorOptions} [options]
   */
  constructor({ mode, scenario, constraints, services, eventBus, runId, scheduling, degradationMatrix, configValidation } = {}) {
    super();

    this.runContext = buildRunContext({ runId, mode, scenario, constraints });
    this.runId = this.runContext.runId;

    this._services = services && typeof services === "object" ? services : {};
    this.eventBus = eventBus instanceof EventBus ? eventBus : new EventBus({ runId: this.runId });
    enhanceEventBusWithHooks(this.eventBus);
    this._registerDisposable(this.eventBus);
    // P2.1: 默认启用背压（浏览器和 Node.js 均生效），coalesce *.progress 事件
    if (typeof this.eventBus.enableBackpressure === "function") {
      const cfg = this._services?.eventBusBackpressure ?? this._services?.backpressure;
      if (cfg !== false) {
        const opts = isPlainObject(cfg) ? cfg : {};
        try {
          this.eventBus.enableBackpressure({ deferNonCoalesced: opts.deferNonCoalesced ?? false, ...opts });
        } catch (err) {
          logger.debug("Failed to enable backpressure", { error: err?.message });
        }
      }
    }

    this._abortController = new AbortController();
    this.signal = this._abortController.signal;

    /** @type {OrchestratorStateValue} */
    this.state = OrchestratorState.IDLE;
    this._runStarted = false;
    this._runEnded = false;
    this._runCompleted = false;
    this._runFailed = false;
    this._runCancelled = false;
    this._stages = new Map(); // stageName -> { handler, options }
    this._queue = Promise.resolve();

    // Scheduling configuration
    const sched = scheduling && typeof scheduling === "object" ? scheduling : {};
    this._schedulingMode = sched.mode === SchedulingMode.PARALLEL ? SchedulingMode.PARALLEL : SchedulingMode.SEQUENTIAL;
    this._maxConcurrency = normalizeTimeoutMs(sched.maxConcurrency, 3);
    this._inFlight = 0;
    this._parallelWaiters = [];

    this._degradationMatrix = isDegradationMatrixLike(degradationMatrix) ? degradationMatrix : null;
    this._lastOperationLevel = null;

    const globalCfg = isPlainObject(configValidation)
      ? configValidation
      : isPlainObject(this._services?.configValidation)
        ? this._services.configValidation
        : {};
    this._configValidation = {
      strict: globalCfg.strict === true,
      coerce: globalCfg.coerce === true,
    };

    /** @type {Set<any>} */
    this._childAgents = new Set();
    const initialAgents = this._services?.agents ?? this._services?.childAgents;
    if (Array.isArray(initialAgents)) {
      for (const agent of initialAgents) this.registerAgent(agent);
    } else if (initialAgents instanceof Map || initialAgents instanceof Set) {
      for (const agent of initialAgents.values()) this.registerAgent(agent);
    } else if (isPlainObject(initialAgents)) {
      for (const agent of Object.values(initialAgents)) this.registerAgent(agent);
    }

    this._registerDisposable(async () => {
      const agents = Array.from(this._childAgents);
      this._childAgents.clear();
      if (agents.length === 0) return;

      const settled = await Promise.allSettled(
        agents.map(async (agent) => {
          if (!agent || typeof agent.dispose !== "function") return;
          await agent.dispose();
        })
      );
      const errors = settled.filter((r) => r.status === "rejected").map((r) => r.reason);
      if (errors.length > 0) {
        logger.warn(`[${this.constructor.name}] ${errors.length} child agent(s) failed to dispose`, errors);
      }
    });

    this.taskGraph = new TaskGraph();
    this._registerDisposable(this.taskGraph);

    this.emit = (name, record) => {
      this._ensureNotDisposed();
      this.eventBus.emit(name, record);
    };
  }

  /**
   * @returns {Promise<any|null>}
   */
  async _getDegradationMatrix() {
    this._ensureNotDisposed();
    if (isDegradationMatrixLike(this._degradationMatrix)) return this._degradationMatrix;

    const fromServices = this._services?.degradationMatrix;
    if (isDegradationMatrixLike(fromServices)) {
      this._degradationMatrix = fromServices;
      return fromServices;
    }

    const container = this._services?.container;
    if (container && typeof container.get === "function") {
      try {
        const resolved = await maybeAwait(
          typeof container.tryGet === "function" ? container.tryGet(ServiceId.DEGRADATION_MATRIX) : container.get(ServiceId.DEGRADATION_MATRIX)
        );
        if (isDegradationMatrixLike(resolved)) {
          this._degradationMatrix = resolved;
          return resolved;
        }
      } catch (err) {
        logger.debug("Failed to resolve degradation matrix from container", { error: err?.message });
      }
    }

    // Best-effort fallback: create an isolated matrix for this orchestrator.
    try {
      const { DegradationMatrix } = await import("../../plugins/resilience/degradation-matrix.js");
      this._degradationMatrix = new DegradationMatrix({ getMemoryUsage: defaultMemoryUsageRatio });
      return this._degradationMatrix;
    } catch (err) {
      logger.debug("Failed to create degradation matrix", { error: err?.message });
      this._degradationMatrix = null;
      return null;
    }
  }

  /**
   * Register a stage.
   *
   * @param {string} name - Stage name
   * @param {(ctx: any, input: any, api: any) => Promise<any>} handler
   * @param {object} [options]
   * @param {string} [options.actor]
   * @param {number} [options.timeoutMs]
   * @param {object} [options.retryPolicy]
   * @param {string[]} [options.requiredServices] - Services this stage depends on
   * @param {string} [options.statePrefix] - StateBus namespace prefix
   * @param {string[]} [options.tools] - Tools this stage uses
   * @param {string[]} [options.dependencies] - Other stage names that must run before this one
   */
  registerStage(name, handler, options = {}) {
    if (typeof name !== "string" || !name || !name.trim()) throw new TypeError("registerStage: name must be a non-empty string");
    if (typeof handler !== "function") throw new TypeError("registerStage: handler must be a function");

    const actorRaw = toNonEmptyString(options.actor);
    const validActor = actorRaw && isValidActorType(actorRaw) ? actorRaw : undefined;

    const normalizedOptions = {
      actor: validActor,
      rawActor: actorRaw || undefined,
      timeoutMs: normalizeTimeoutMs(options.timeoutMs, null),
      configSchema: isPlainObject(options.configSchema) ? options.configSchema : undefined,
      configValidation: isPlainObject(options.configValidation) ? options.configValidation : undefined,
      retryPolicy: options.retryPolicy || null,
    };

    this._stages.set(name, {
      handler,
      actor: validActor,
      timeoutMs: normalizedOptions.timeoutMs ?? 0,
      retryPolicy: normalizedOptions.retryPolicy,
      options: normalizedOptions,
      // Manifest fields (declarative)
      requiredServices: Array.isArray(options.requiredServices) ? [...options.requiredServices] : [],
      statePrefix: typeof options.statePrefix === "string" ? options.statePrefix : name,
      tools: Array.isArray(options.tools) ? [...options.tools] : [],
      dependencies: Array.isArray(options.dependencies) ? [...options.dependencies] : [],
    });
  }

  /**
   * Get the manifest for a registered stage.
   * @param {string} name
   * @returns {{ requiredServices: string[], statePrefix: string, tools: string[], dependencies: string[] } | null}
   */
  getStageManifest(name) {
    const entry = this._stages.get(name);
    if (!entry) return null;
    return {
      requiredServices: entry.requiredServices || [],
      statePrefix: entry.statePrefix || name,
      tools: entry.tools || [],
      dependencies: entry.dependencies || [],
    };
  }

  /**
   * @param {string} stageName
   * @param {any} input
   * @returns {Promise<any>}
   */
  async _runStageNow(stageName, input) {
    this._ensureNotDisposed();
    if (this.state !== OrchestratorState.RUNNING) this.start();
    if (this.signal.aborted) throw new Error("Run cancelled");

    const entry = this._stages.get(stageName);
    if (!entry) throw new Error(`Stage not registered: ${stageName}`);

    const stageOptions = isPlainObject(entry.options) ? entry.options : null;
    const stageActor =
      toNonEmptyString(entry.actor) ||
      toNonEmptyString(stageOptions?.actor) ||
      deriveActorFromStageName(stageName);
    const stageTimeoutMs = normalizeTimeoutMs(entry.timeoutMs ?? stageOptions?.timeoutMs, null);
    const { signal: stageSignal, cleanup } = createStageAbortSignal(this.signal, stageTimeoutMs);

    // P6.1.3: Validate userConfig at stage init (best-effort, backward compatible).
    const { stageInput, userConfigValidation } = prepareStageInputWithUserConfigValidation({
      stageInput: input,
      entry,
      stageOptions,
      globalConfigValidation: this._configValidation,
      stageName,
      stageActor,
      emitInvalid: (record) => {
        this.eventBus.emit(`${stageName}.config.invalid`, record);
      },
    });

    const degradationMatrix = await this._getDegradationMatrix();
    const degradation = buildDegradationContext(degradationMatrix);

    const api = createStageApi({
      signal: stageSignal,
      eventBus: this.eventBus,
      emit: this.emit,
      ...this._services,
      ...(degradation ? { degradation } : {}),
      ...(userConfigValidation ? { configValidation: { userConfig: userConfigValidation } } : {}),
      progress: (payload) => {
        // P0: 统一事件命名为 stage:progress（兼容旧 ${stageName}.progress）
        const progressRecord = {
          actor: stageActor,
          status: "progress",
          payload: { stage: stageName, ...payload, runId: this.runId },
        };
        this.eventBus.emit("stage:progress", progressRecord);
        this.eventBus.emit(`${stageName}.progress`, progressRecord);
      },
    });

    const ctx = { ...this.runContext, runId: this.runId };

    // P1: Emit stage:dequeued for sequential mode
    if (this._schedulingMode === SchedulingMode.SEQUENTIAL) {
      this.eventBus.emit("stage:dequeued", {
        actor: "system",
        status: "dequeued",
        payload: { stage: stageName, mode: "sequential", runId: this.runId },
      });
    }

    // P0: 统一事件命名为 stage:started（兼容旧 ${stageName}.started）
    const startedRecord = {
      actor: stageActor,
      status: "started",
      payload: { stage: stageName, input: stageInput, runId: this.runId },
    };
    this.eventBus.emit("stage:started", startedRecord);
    this.eventBus.emit(`${stageName}.started`, startedRecord);

    const stageStartMs = Date.now();
    let stageFailed = false;

    try {
      const out = await entry.handler(ctx, stageInput, api);
      // P0: 统一事件命名为 stage:completed（兼容旧 ${stageName}.completed）
      const completedRecord = {
        actor: stageActor,
        status: "completed",
        payload: { stage: stageName, runId: this.runId, durationMs: Date.now() - stageStartMs },
      };
      this.eventBus.emit("stage:completed", completedRecord);
      this.eventBus.emit(`${stageName}.completed`, completedRecord);
      return out;
    } catch (err) {
      stageFailed = true;
      const message = String(err?.message || err);
      // P0: 统一事件命名为 stage:failed（兼容旧 ${stageName}.failed）
      const failedRecord = {
        actor: stageActor,
        status: "failed",
        payload: { stage: stageName, error: message, runId: this.runId },
      };
      this.eventBus.emit("stage:failed", failedRecord);
      this.eventBus.emit(`${stageName}.failed`, failedRecord);
      this.state = OrchestratorState.FAILED;
      this._emitRunFailed({ error: message, stage: stageName });
      this._emitRunEnded({ reason: "failed" });
      throw err;
    } finally {
      const durationMs = Math.max(0, Date.now() - stageStartMs);
      if (degradationMatrix) {
        try {
          degradationMatrix.recordRequest({ latencyMs: durationMs, isError: stageFailed });
        } catch (err) {
          logger.debug("Failed to record degradation matrix request", { error: err?.message });
        }

        try {
          const level = degradationMatrix.currentLevel;
          if (toNonEmptyString(level) && level !== this._lastOperationLevel) {
            this._lastOperationLevel = level;

            // P1: Emit degradation decision context
            const decisionContext = {
              level,
              previousLevel: this._lastOperationLevel || "normal",
              runId: this.runId,
              stage: stageName,
              durationMs,
              stageFailed,
            };

            // Best-effort: add decision metrics
            try {
              if (typeof degradationMatrix.getMetrics === "function") {
                const metrics = degradationMatrix.getMetrics();
                decisionContext.metrics = metrics;
              }
            } catch (err) {
              logger.debug("Failed to get degradation matrix metrics", { error: err?.message });
            }

            // Best-effort: add effective parameters
            try {
              const effectiveConcurrency = await this._getEffectiveConcurrencyLimit();
              decisionContext.effectiveConcurrency = effectiveConcurrency;
            } catch (err) {
              logger.debug("Failed to get effective concurrency limit", { error: err?.message });
            }

            this.eventBus.emit("system:degradation:level:changed", {
              actor: ActorType.SYSTEM,
              status: "info",
              payload: decisionContext,
            });
            if (level !== "normal") {
              this.eventBus.emit(AgentLifecycleEvents.DEGRADED, { actor: ActorType.SYSTEM, status: "degraded", payload: decisionContext });
            }
          }
        } catch (err) {
          logger.debug("Failed to process degradation level change", { error: err?.message });
        }

        // Emit recommendations on stage failures or whenever system is degraded (best-effort).
        try {
          const level = degradationMatrix.currentLevel;
          const recommendations = degradationMatrix.getRecommendations();
          if ((stageFailed || level !== "normal") && Array.isArray(recommendations) && recommendations.length > 0) {
            this.eventBus.emit("system:degradation:recommendations", {
              actor: ActorType.SYSTEM,
              status: "info",
              payload: { recommendations, level, runId: this.runId, stage: stageName },
            });
          }
        } catch (err) {
          logger.debug("Failed to emit degradation recommendations", { error: err?.message });
        }
      }

      cleanup();
    }
  }

  /**
   * Get a snapshot of the orchestrator's current status.
   *
   * Returns state, registered stages, in-flight count, scheduling mode,
   * child agent count, and run context. Useful for external inspection
   * and multi-agent coordination dashboards.
   *
   * @returns {{ state: string, runId: string, schedulingMode: string, inFlight: number, maxConcurrency: number, stages: Array<{ name: string, actor: string, dependencies: string[] }>, childAgentCount: number, aborted: boolean }}
   */
  getStatus() {
    const stages = [];
    for (const [name, entry] of this._stages) {
      stages.push({
        name,
        actor: entry.options?.rawActor || entry.actor || name,
        dependencies: entry.dependencies || [],
      });
    }
    return {
      state: this.state,
      runId: this.runId,
      schedulingMode: this._schedulingMode,
      inFlight: this._inFlight,
      maxConcurrency: this._maxConcurrency,
      stages,
      childAgentCount: this._childAgents.size,
      aborted: this.signal.aborted,
    };
  }

  /**
   * @protected
   * @returns {void}
   */
  _onDispose() {
    try {
      if (!this.signal.aborted) {
        this._abortController.abort("disposed");
      }
    } catch (err) {
      logger.debug("Failed to abort controller on dispose", { error: err?.message });
    }

    this._stages.clear();
    this._queue = Promise.resolve();
    this._inFlight = 0;
    this._rejectParallelWaiters("Orchestrator disposed");
  }
}

Object.assign(AgentOrchestrator.prototype, AgentCoordination);
Object.assign(AgentOrchestrator.prototype, SchedulingStrategies);

export { SchedulingMode };
