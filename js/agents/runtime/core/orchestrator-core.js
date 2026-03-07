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
 * @typedef {{
 *   mode?: string,
 *   scenario?: string,
 *   constraints?: Record<string, unknown>,
 *   services?: Record<string, unknown> & {
 *     eventBusBackpressure?: Record<string, unknown> | false,
 *     backpressure?: Record<string, unknown> | false,
 *     configValidation?: Record<string, unknown>,
 *     degradationMatrix?: unknown,
 *     agents?: unknown,
 *     childAgents?: unknown,
 *     container?: { get?: (id: string) => unknown, tryGet?: (id: string) => unknown }
 *   },
 *   eventBus?: EventBus,
 *   runId?: string,
 *   scheduling?: { mode?: string, maxConcurrency?: number },
 *   degradationMatrix?: object,
 *   configValidation?: Record<string, unknown>
 * }} AgentOrchestratorOptions
 *
 * @typedef {{
 *   actor?: string,
 *   rawActor?: string,
 *   timeoutMs?: number,
 *   configSchema?: Record<string, unknown>,
 *   configValidation?: Record<string, unknown>,
 *   retryPolicy?: unknown,
 *   requiredServices?: string[],
 *   statePrefix?: string,
 *   tools?: string[],
 *   dependencies?: string[]
 * }} StageRegistrationOptions
 *
 * @typedef {StageRegistrationOptions} RegisterStageOptions
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
        const opts = /** @type {{ deferNonCoalesced?: boolean, batchWindowMs?: number, maxQueueSize?: number, dropPolicy?: "oldest" | "newest" }} */ (isPlainObject(cfg) ? cfg : {});
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
    this._degradationMatrixPromise = null;
    this._lastOperationLevel = null;

    const globalCfg = /** @type {Record<string, unknown>} */ (
      isPlainObject(configValidation)
        ? configValidation
        : isPlainObject(this._services?.configValidation)
          ? this._services.configValidation
          : {}
    );
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

  /** @param {unknown} _agent */
  registerAgent(_agent) {}

  start() {}

  /** @param {{ error?: unknown, stage?: string }} [_info] */
  _emitRunFailed(_info) {}

  /** @param {{ reason?: string }} [_info] */
  _emitRunEnded(_info) {}

  /** @returns {Promise<number>} */
  async _getEffectiveConcurrencyLimit() { return this._maxConcurrency; }

  /** @param {string} _reason */
  _rejectParallelWaiters(_reason) {}

  /**
   * @returns {Promise<any|null>}
   */
  async _getDegradationMatrix() {
    this._ensureNotDisposed();
    if (isDegradationMatrixLike(this._degradationMatrix)) return this._degradationMatrix;
    this._degradationMatrixPromise ??= this._resolveDegradationMatrix();
    return this._degradationMatrixPromise;
  }

  /**
   * Resolve degradation matrix from services, DI container, or fallback.
   * @returns {Promise<any|null>}
   */
  async _resolveDegradationMatrix() {
    const fromServices = this._services?.degradationMatrix;
    if (isDegradationMatrixLike(fromServices)) {
      this._degradationMatrix = fromServices;
      return fromServices;
    }

    const fromContainer = await this._resolveMatrixFromContainer();
    if (fromContainer) return fromContainer;

    return this._createFallbackMatrix();
  }

  /**
   * Attempt to resolve degradation matrix from the DI container.
   * @returns {Promise<any|null>}
   */
  async _resolveMatrixFromContainer() {
    const container = this._services?.container;
    if (!container || (typeof container.get !== "function" && typeof container.tryGet !== "function")) return null;

    try {
      const resolved = await maybeAwait(
        typeof container.tryGet === "function"
          ? container.tryGet(ServiceId.DEGRADATION_MATRIX)
          : container.get?.(ServiceId.DEGRADATION_MATRIX)
      );
      if (!isDegradationMatrixLike(resolved)) return null;
      this._degradationMatrix = resolved;
      return resolved;
    } catch (err) {
      logger.debug("Failed to resolve degradation matrix from container", { error: err?.message });
      return null;
    }
  }

  /**
   * Best-effort fallback: create an isolated matrix for this orchestrator.
   * @returns {Promise<any|null>}
   */
  async _createFallbackMatrix() {
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
   * @param {RegisterStageOptions} [options]
   */
  registerStage(name, handler, options = {}) {
    if (typeof name !== "string" || !name || !name.trim()) throw new TypeError("registerStage: name must be a non-empty string");
    if (typeof handler !== "function") throw new TypeError("registerStage: handler must be a function");

    const actorRaw = toNonEmptyString(options.actor);
    const validActor = actorRaw && isValidActorType(actorRaw) ? actorRaw : undefined;

    /** @type {StageRegistrationOptions} */
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
        await this._recordAndEmitDegradation(degradationMatrix, { stageName, durationMs, stageFailed });
      }
      cleanup();
    }
  }

  /**
   * Record a request to the degradation matrix and emit level-change / recommendation events.
   * Extracted from `_runStageNow` finally-block to keep nesting shallow.
   *
   * @param {object} matrix - DegradationMatrix instance.
   * @param {{ stageName: string, durationMs: number, stageFailed: boolean }} info
   */
  async _recordAndEmitDegradation(matrix, { stageName, durationMs, stageFailed }) {
    try {
      matrix.recordRequest({ latencyMs: durationMs, isError: stageFailed });
    } catch (err) {
      logger.debug("Failed to record degradation matrix request", { error: err?.message });
    }

    this._emitDegradationLevelChange(matrix, { stageName, durationMs, stageFailed });
    this._emitDegradationRecommendations(matrix, { stageName, stageFailed });
  }

  /**
   * Emit `system:degradation:level:changed` (and optionally `DEGRADED`) when the
   * degradation level transitions.
   *
   * @param {object} matrix
   * @param {{ stageName: string, durationMs: number, stageFailed: boolean }} info
   */
  async _emitDegradationLevelChange(matrix, { stageName, durationMs, stageFailed }) {
    try {
      const level = matrix.currentLevel;
      if (!toNonEmptyString(level) || level === this._lastOperationLevel) return;

      const previousLevel = this._lastOperationLevel || "normal";
      this._lastOperationLevel = level;

      const decisionContext = { level, previousLevel, runId: this.runId, stage: stageName, durationMs, stageFailed };

      try { if (typeof matrix.getMetrics === "function") decisionContext.metrics = matrix.getMetrics(); }
      catch (err) { logger.debug("Failed to get degradation matrix metrics", { error: err?.message }); }

      try { decisionContext.effectiveConcurrency = await this._getEffectiveConcurrencyLimit(); }
      catch (err) { logger.debug("Failed to get effective concurrency limit", { error: err?.message }); }

      this.eventBus.emit("system:degradation:level:changed", {
        actor: ActorType.SYSTEM, status: "info", payload: decisionContext,
      });
      if (level !== "normal") {
        this.eventBus.emit(AgentLifecycleEvents.DEGRADED, { actor: ActorType.SYSTEM, status: "degraded", payload: decisionContext });
      }
    } catch (err) {
      logger.debug("Failed to process degradation level change", { error: err?.message });
    }
  }

  /**
   * Emit `system:degradation:recommendations` when the system is degraded or a stage failed.
   *
   * @param {object} matrix
   * @param {{ stageName: string, stageFailed: boolean }} info
   */
  _emitDegradationRecommendations(matrix, { stageName, stageFailed }) {
    try {
      const level = matrix.currentLevel;
      const recommendations = matrix.getRecommendations();
      if (!(stageFailed || level !== "normal") || !Array.isArray(recommendations) || recommendations.length === 0) return;

      this.eventBus.emit("system:degradation:recommendations", {
        actor: ActorType.SYSTEM, status: "info",
        payload: { recommendations, level, runId: this.runId, stage: stageName },
      });
    } catch (err) {
      logger.debug("Failed to emit degradation recommendations", { error: err?.message });
    }
  }

  /**
   * Get a snapshot of the orchestrator's current status.
   *
   * Returns state, registered stages, in-flight count, scheduling mode,
   * child agent count, and run context. Useful for external inspection
   * and multi-agent coordination dashboards.
   *
   * @returns {{ state: OrchestratorStateValue, runId: string, schedulingMode: string, inFlight: number, maxConcurrency: number, stages: Array<{ name: string, actor: string, dependencies: string[] }>, childAgentCount: number, aborted: boolean }}
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
    this._parallelWaiters = [];
  }
}

Object.assign(AgentOrchestrator.prototype, AgentCoordination);
Object.assign(AgentOrchestrator.prototype, SchedulingStrategies);

export { SchedulingMode };
