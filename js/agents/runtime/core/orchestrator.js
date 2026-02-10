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
  isFailureStopReason, buildDegradationContext, prepareStageInputWithUserConfigValidation,
} from "./orchestrator-helpers.js";

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

export const SchedulingMode = Object.freeze({
  SEQUENTIAL: "sequential",
  PARALLEL: "parallel",
});

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
        } catch {
          // ignore
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
      } catch {
        // ignore missing container services
      }
    }

    // Best-effort fallback: create an isolated matrix for this orchestrator.
    try {
      const { DegradationMatrix } = await import("../../plugins/resilience/degradation-matrix.js");
      this._degradationMatrix = new DegradationMatrix({ getMemoryUsage: defaultMemoryUsageRatio });
      return this._degradationMatrix;
    } catch {
      this._degradationMatrix = null;
      return null;
    }
  }

  /**
   * @returns {Promise<number>}
   */
  async _getEffectiveConcurrencyLimit() {
    this._ensureNotDisposed();
    const limit = this._maxConcurrency;
    const matrix = await this._getDegradationMatrix();
    if (!matrix) return limit;
    try {
      if (!matrix.isFeatureEnabled("parallelRequests")) return 1;
    } catch {
      // ignore
    }
    return limit;
  }

  /**
   * @returns {void}
   */
  _emitRunStarted() {
    this._ensureNotDisposed();
    if (this._runStarted) return;
    this._runStarted = true;
    this.emit("run.started", {
      actor: ActorType.SYSTEM,
      status: "started",
      payload: {
        runId: this.runId,
        mode: this.runContext.mode,
        scenario: this.runContext.scenario,
      },
    });
  }

  /**
   * @param {any} reason
   * @returns {void}
   */
  _emitRunCancelled(reason) {
    this._ensureNotDisposed();
    if (this._runCancelled) return;
    this._runCancelled = true;
    this.emit("run.cancelled", {
      actor: ActorType.SYSTEM,
      status: "cancelled",
      payload: { reason: toNonEmptyString(reason) || "cancelled", runId: this.runId },
    });
  }

  /**
   * @param {{ error?: any, stage?: string } | undefined} [options]
   * @returns {void}
   */
  _emitRunFailed({ error, stage } = {}) {
    this._ensureNotDisposed();
    if (this._runFailed) return;
    this._runFailed = true;
    const message = toNonEmptyString(error) || "Unknown error";
    this.emit("run.failed", {
      actor: ActorType.SYSTEM,
      status: "failed",
      payload: {
        runId: this.runId,
        error: message,
        ...(toNonEmptyString(stage) ? { stage: toNonEmptyString(stage) } : {}),
      },
    });
  }

  /**
   * @param {{ reason?: any } | undefined} [options]
   * @returns {void}
   */
  _emitRunCompleted({ reason } = {}) {
    this._ensureNotDisposed();
    if (this._runCompleted) return;
    this._runCompleted = true;
    const r = toNonEmptyString(reason) || "completed";
    // Compat: 일부旧 workflow 仍监听 run.completed
    this.emit("run.completed", { actor: ActorType.SYSTEM, status: "completed", payload: { reason: r, runId: this.runId } });
  }

  /**
   * @param {{ reason?: any } | undefined} [options]
   * @returns {void}
   */
  _emitRunEnded({ reason } = {}) {
    this._ensureNotDisposed();
    if (this._runEnded) return;
    this._runEnded = true;
    const r = toNonEmptyString(reason);
    this.emit("run.ended", {
      actor: ActorType.SYSTEM,
      status: "ended",
      ...(r ? { payload: { reason: r, runId: this.runId } } : { payload: { runId: this.runId } }),
    });
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
   * Register a disposable child agent to be cleaned up when this orchestrator is disposed.
   * @param {any} agent
   * @returns {this}
   */
  registerAgent(agent) {
    this._ensureNotDisposed();
    if (agent && typeof agent.dispose === "function") {
      this._childAgents.add(agent);
    }
    return this;
  }

  /**
   * @returns {void}
   */
  start() {
    this._ensureNotDisposed();
    if (this.state === OrchestratorState.RUNNING) return;
    this.state = OrchestratorState.RUNNING;
    this._emitRunStarted();
    this.eventBus.emit(AgentLifecycleEvents.BUSY, { actor: ActorType.SYSTEM, status: "busy", payload: { runId: this.runId } });
  }

  /**
   * @param {any} [reason]
   * @returns {void}
   */
  stop(reason = "cancelled") {
    this._ensureNotDisposed();
    if (this.signal.aborted) return;
    const r = toNonEmptyString(reason) || "cancelled";
    const isFailure = isFailureStopReason(r);

    this.state = isFailure ? OrchestratorState.FAILED : OrchestratorState.CANCELLED;
    this._abortController.abort(r);
    if (isFailure) this._emitRunFailed({ error: r });
    else this._emitRunCancelled(r);
    this._emitRunEnded({ reason: r });
    this.eventBus.emit(AgentLifecycleEvents.STOPPED, { actor: ActorType.SYSTEM, status: "stopped", payload: { reason: r, runId: this.runId } });
  }

  /**
   * @param {any} [reason]
   * @returns {void}
   */
  end(reason = "completed") {
    this._ensureNotDisposed();
    if (this.state === OrchestratorState.ENDED) return;
    if (this.state === OrchestratorState.RUNNING) {
      this.state = OrchestratorState.ENDED;
      this._emitRunCompleted({ reason });
      this._emitRunEnded({ reason });
      this.eventBus.emit(AgentLifecycleEvents.STOPPED, { actor: ActorType.SYSTEM, status: "stopped", payload: { reason, runId: this.runId } });
      return;
    }
    this.state = OrchestratorState.ENDED;
  }

  /**
   * @param {string} stageName
   * @param {any} input
   * @returns {Promise<any>}
   */
  async runStage(stageName, input) {
    this._ensureNotDisposed();
    const name = toNonEmptyString(stageName);
    if (!name) throw new Error("AgentOrchestrator.runStage(stageName): stageName must be a non-empty string");

    if (this._schedulingMode === SchedulingMode.PARALLEL) {
      return this._runStageParallel(name, input);
    }

    // Sequential mode: Force sequential execution (shared UI + persistence assumptions).
    this._queue = this._queue.then(
      () => this._runStageNow(name, input),
      () => this._runStageNow(name, input)
    );
    return this._queue;
  }

  /**
   * Run multiple stages in parallel with concurrency limit
   * @param {Array<{name: string, input?: any}>} stages - Stages to run
   * @returns {Promise<Map<string, any>>} Map of stageName -> result
   */
  async runStagesParallel(stages) {
    this._ensureNotDisposed();
    if (!Array.isArray(stages) || stages.length === 0) {
      return new Map();
    }

    if (this.state !== OrchestratorState.RUNNING) this.start();
    if (this.signal.aborted) throw new Error("Run cancelled");

    const results = new Map();
    const concurrencyLimit = await this._getEffectiveConcurrencyLimit();
    const pending = [...stages];
    const executing = new Set();
    const allErrors = [];

    const runNext = async () => {
      while (pending.length > 0 && executing.size < concurrencyLimit) {
        const { name, input } = pending.shift();
        const stageName = toNonEmptyString(name);
        if (!stageName) continue;

        const promise = this._runStageNow(stageName, input)
          .then((result) => {
            results.set(stageName, { success: true, result });
            executing.delete(promise);
            return runNext();
          })
          .catch((error) => {
            const errorMessage = error?.message || String(error);
            results.set(stageName, { success: false, error: errorMessage });
            allErrors.push(new Error(`Stage "${stageName}": ${errorMessage}`));
            executing.delete(promise);
            return runNext();
          });

        executing.add(promise);
      }

      if (executing.size > 0) {
        await Promise.race(executing);
      }
    };

    await runNext();
    // Wait for all remaining
    if (executing.size > 0) {
      await Promise.allSettled(executing);
    }

    return results;
  }

  /**
   * Run stages with explicit DAG dependencies (layered parallelism).
   *
   * Example:
   * - A (no deps)
   * - B depends on A
   * - C depends on A
   * -> level1: [A], level2: [B, C]
   *
   * @param {Array<{name: string, input?: any, dependsOn?: string[]}>} stages
   * @param {{ continueOnError?: boolean } | undefined} [options]
   * @returns {Promise<Map<string, any>>} Map of stageName -> {success, result|error|skipped}
   */
  async runStagesGraph(stages, options = {}) {
    this._ensureNotDisposed();
    const list = Array.isArray(stages) ? stages : [];
    if (list.length === 0) return new Map();

    const continueOnError = options?.continueOnError === true;

    /** @type {Map<string, { name: string, input?: any, dependsOn?: string[] }>} */
    const byName = new Map();
    for (const item of list) {
      const stageName = toNonEmptyString(item?.name);
      if (!stageName) continue;
      byName.set(stageName, item);
    }

    const graph = this.taskGraph;
    graph.clear();
    try {
      for (const [stageName, item] of byName) {
        const deps = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
        graph.addTask(stageName, deps);
      }

      const levels = graph.getLevels();
      const results = new Map();

      for (const level of levels) {
        /** @type {Array<{name: string, input?: any}>} */
        const runnable = [];

        for (const stageName of level) {
          const node = byName.get(stageName);
          const deps = Array.isArray(node?.dependsOn) ? node.dependsOn : [];

          let blockedBy = null;
          for (const dep of deps) {
            const r = results.get(dep);
            if (r && r.success === false) {
              blockedBy = dep;
              break;
            }
          }

          if (blockedBy) {
            results.set(stageName, { success: false, skipped: true, error: `dependency_failed:${blockedBy}` });
            continue;
          }

          runnable.push({ name: stageName, input: node?.input });
        }

        if (runnable.length) {
          const levelResults = await this.runStagesParallel(runnable);
          for (const [name, outcome] of levelResults.entries()) {
            results.set(name, outcome);
          }
        }

        if (!continueOnError) {
          for (const stageName of level) {
            const r = results.get(stageName);
            if (r && r.success === false && !r.skipped) {
              throw new Error(`Stage failed: ${stageName}: ${r.error || "unknown_error"}`);
            }
          }
        }
      }

      return results;
    } finally {
      graph.clear();
    }
  }

  /**
   * Run stage with parallel mode concurrency control
   * @private
   * @param {string} stageName
   * @param {any} input
   * @returns {Promise<any>}
   */
  async _runStageParallel(stageName, input) {
    this._ensureNotDisposed();
    // Wait for slot - 每次唤醒后重新获取 limit（可能动态变化）
    while (true) {
      const limit = await this._getEffectiveConcurrencyLimit();
      if (this._inFlight < limit) break;
      await this._waitForParallelSlot();
      if (this.signal.aborted) throw new Error("Run cancelled");
    }

    this._inFlight++;
    try {
      return await this._runStageNow(stageName, input);
    } finally {
      this._inFlight--;
      this._releaseParallelSlot();
    }
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _waitForParallelSlot() {
    if (this.signal.aborted) throw new Error("Run cancelled");
    return await new Promise((resolve, reject) => {
      const entry = { resolve, reject, onAbort: null };
      if (this.signal && typeof this.signal.addEventListener === "function") {
        entry.onAbort = () => {
          this._removeParallelWaiter(entry);
          reject(new Error("Run cancelled"));
        };
        this.signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this._parallelWaiters.push(entry);
    });
  }

  /**
   * @private
   * @param {{ resolve: Function, reject: Function, onAbort: Function | null }} entry
   * @returns {void}
   */
  _removeParallelWaiter(entry) {
    if (entry?.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
      this.signal.removeEventListener("abort", /** @type {EventListener} */ (entry.onAbort));
    }
    this._parallelWaiters = this._parallelWaiters.filter((w) => w !== entry);
  }

  /**
   * @private
   * @returns {void}
   */
  _releaseParallelSlot() {
    while (this._parallelWaiters.length) {
      const waiter = this._parallelWaiters.shift();
      if (!waiter) continue;
      if (waiter.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
        this.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve();
      break;
    }
  }

  /**
   * @private
   * @param {Error | string} reason
   * @returns {void}
   */
  _rejectParallelWaiters(reason) {
    if (!this._parallelWaiters.length) return;
    const err = reason instanceof Error ? reason : new Error(String(reason || "Orchestrator disposed"));
    const waiters = this._parallelWaiters.splice(0);
    for (const waiter of waiters) {
      if (!waiter) continue;
      if (waiter.onAbort && this.signal && typeof this.signal.removeEventListener === "function") {
        this.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.reject(err);
    }
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
        this.eventBus.emit(`${stageName}.progress`, { actor: stageActor, status: "progress", payload });
      },
    });

    const ctx = { ...this.runContext, runId: this.runId };

    this.eventBus.emit(`${stageName}.started`, { actor: stageActor, status: "started", payload: { input: stageInput } });

    const stageStartMs = Date.now();
    let stageFailed = false;

    try {
      const out = await entry.handler(ctx, stageInput, api);
      this.eventBus.emit(`${stageName}.completed`, { actor: stageActor, status: "completed" });
      return out;
    } catch (err) {
      stageFailed = true;
      const message = String(err?.message || err);
      this.eventBus.emit(`${stageName}.failed`, { actor: stageActor, status: "failed", payload: { error: message } });
      this.state = OrchestratorState.FAILED;
      this._emitRunFailed({ error: message, stage: stageName });
      this._emitRunEnded({ reason: "failed" });
      throw err;
    } finally {
      const durationMs = Math.max(0, Date.now() - stageStartMs);
      if (degradationMatrix) {
        try {
          degradationMatrix.recordRequest({ latencyMs: durationMs, isError: stageFailed });
        } catch {
          // ignore
        }

        try {
          const level = degradationMatrix.currentLevel;
          if (toNonEmptyString(level) && level !== this._lastOperationLevel) {
            this._lastOperationLevel = level;
            this.eventBus.emit("system.degradation.level.changed", {
              actor: ActorType.SYSTEM,
              status: "info",
              payload: { level, runId: this.runId, stage: stageName },
            });
            if (level !== "normal") {
              this.eventBus.emit(AgentLifecycleEvents.DEGRADED, { actor: ActorType.SYSTEM, status: "degraded", payload: { level, runId: this.runId, stage: stageName } });
            }
          }
        } catch {
          // ignore
        }

        // Emit recommendations on stage failures or whenever system is degraded (best-effort).
        try {
          const level = degradationMatrix.currentLevel;
          const recommendations = degradationMatrix.getRecommendations();
          if ((stageFailed || level !== "normal") && Array.isArray(recommendations) && recommendations.length > 0) {
            this.eventBus.emit("system.degradation.recommendations", {
              actor: ActorType.SYSTEM,
              status: "info",
              payload: { recommendations, level, runId: this.runId, stage: stageName },
            });
          }
        } catch {
          // ignore
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
    } catch {
      // ignore
    }

    this._stages.clear();
    this._queue = Promise.resolve();
    this._inFlight = 0;
    this._rejectParallelWaiters("Orchestrator disposed");
  }
}
