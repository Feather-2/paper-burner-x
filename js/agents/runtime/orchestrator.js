import { createStageApi } from "../shared/utils/stage-api.js";
import { EventBus } from "../core/event-bus.js";
import { ActorType, OrchestratorState, isValidActorType } from "./core/constants.js";
import { ServiceId } from "./di/defaults.js";
import { CommonSchemas, validateConfig } from "./core/config-validator.js";
import { TaskGraph } from "./parallel/task-graph.js";
import { enhanceEventBusWithHooks } from "./hooks/event-bus-hooks.js";
import { DisposableBase } from "../shared/base/disposable-base.js";

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";

/**
 * @typedef {import("./core/constants.js").OrchestratorState[keyof import("./core/constants.js").OrchestratorState]} OrchestratorStateValue
 */

/**
 * @typedef {Object} SchedulingConfig
 * @property {string} [mode]
 * @property {number} [maxConcurrency]
 */

/**
 * @typedef {Object} AgentOrchestratorOptions
 * @property {string} [mode]
 * @property {string} [scenario]
 * @property {object} [constraints]
 * @property {Record<string, any>} [services]
 * @property {EventBus} [eventBus]
 * @property {string} [runId]
 * @property {SchedulingConfig} [scheduling]
 * @property {any} [degradationMatrix]
 * @property {{ strict?: boolean, coerce?: boolean }} [configValidation]
 */

/**
 * @param {unknown} v
 * @param {number|null} fallback
 * @returns {number|null}
 */
function normalizeTimeoutMs(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const DEFAULT_USER_CONFIG_SCHEMA = Object.freeze({
  mode: { type: "string" },
  maxIterations: CommonSchemas.positiveInt,
  contextWindow: CommonSchemas.positiveInt,
  compressThreshold: CommonSchemas.ratio,
  reportTargetWords: CommonSchemas.positiveInt,
  reportLength: { type: "string" },

  eventBusBackpressure: {
    type: "object",
    properties: {
      batchWindowMs: CommonSchemas.nonNegativeInt,
      maxQueueSize: CommonSchemas.positiveInt,
      deferNonCoalesced: { type: "boolean" },
    },
  },
  backpressure: {
    type: "object",
    properties: {
      batchWindowMs: CommonSchemas.nonNegativeInt,
      maxQueueSize: CommonSchemas.positiveInt,
      deferNonCoalesced: { type: "boolean" },
    },
  },
  watchdog: {
    type: "object",
    properties: {
      maxRecentOutputs: CommonSchemas.positiveInt,
      similarityThreshold: CommonSchemas.ratio,
    },
  },

  budget: { type: "object" },
  memory: { type: "object" },
  toolCallGuard: { type: "object" },
  behaviorFingerprint: { type: "object" },

  errorBoundary: {
    type: "object",
    properties: { degrade: { type: "boolean" } },
  },
  degradeOnError: { type: "boolean" },
});

/**
 * @param {Array<{ path?: string, message?: string }>} errors
 * @param {{ maxItems?: number } | undefined} [options]
 * @returns {string}
 */
function formatValidationErrors(errors, { maxItems = 10 } = {}) {
  const list = Array.isArray(errors) ? errors : [];
  if (list.length === 0) return "";
  const head = list.slice(0, Math.max(0, Math.floor(maxItems)));
  const lines = head.map((e) => `- ${e.path || "root"}: ${e.message || "Invalid"}`);
  const suffix = list.length > head.length ? `\n...and ${list.length - head.length} more` : "";
  return `${lines.join("\n")}${suffix}`;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPromiseLike(value) {
  return value !== null && typeof value === "object" && typeof value.then === "function";
}

/**
 * @template T
 * @param {T | Promise<T>} value
 * @returns {Promise<T>}
 */
async function maybeAwait(value) {
  return isPromiseLike(value) ? await value : value;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isDegradationMatrixLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.recordRequest === "function" &&
    typeof value.getStatus === "function" &&
    typeof value.getRecommendations === "function" &&
    typeof value.isFeatureEnabled === "function"
  );
}

/**
 * @returns {number}
 */
function defaultMemoryUsageRatio() {
  // Ratio in [0, 1] best-effort across runtimes.
  try {
    const proc = /** @type {any} */ (globalThis).process;
    if (proc && typeof proc.memoryUsage === "function") {
      const mem = proc.memoryUsage();
      const used = typeof mem.heapUsed === "number" ? mem.heapUsed : mem.rss;
      const total = typeof mem.heapTotal === "number" ? mem.heapTotal : mem.rss;
      if (typeof used === "number" && typeof total === "number" && total > 0) return used / total;
    }
  } catch {
    // ignore
  }

  try {
    const perfMem = /** @type {any} */ (globalThis?.performance)?.memory;
    if (
      perfMem &&
      typeof perfMem.usedJSHeapSize === "number" &&
      typeof perfMem.jsHeapSizeLimit === "number" &&
      perfMem.jsHeapSizeLimit > 0
    ) {
      return perfMem.usedJSHeapSize / perfMem.jsHeapSizeLimit;
    }
  } catch {
    // ignore
  }

  return 0;
}

/**
 * @param {{ runId?: string, mode?: string, scenario?: string, constraints?: object } | undefined} [input]
 * @returns {{ schemaVersion: string, runId: string, mode: string, scenario: string, constraints: object, createdAt: string }}
 */
function buildRunContext({ runId, mode, scenario, constraints } = {}) {
  return {
    schemaVersion: "0.1",
    runId: toNonEmptyString(runId) || `run_${Date.now()}`,
    mode: toNonEmptyString(mode) || "deepsearch",
    scenario: toNonEmptyString(scenario) || "business",
    constraints: constraints && typeof constraints === "object" ? constraints : {},
    createdAt: new Date().toISOString(),
  };
}

/**
 * @param {string} stageName
 * @param {string} [fallbackActor]
 * @returns {string}
 */
function deriveActorFromStageName(stageName, fallbackActor = ActorType.SYSTEM) {
  const name = toNonEmptyString(stageName);
  const head = name.split(".")[0];
  const candidate = head && isValidActorType(head) ? head : fallbackActor;
  return candidate;
}

/**
 * @param {AbortSignal|null|undefined} parentSignal
 * @param {number|null|undefined} timeoutMs
 * @returns {{ signal: AbortSignal, cleanup: () => void }}
 */
function createStageAbortSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const { signal } = controller;

  let timerId = null;
  const cleanup = () => {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    if (parentSignal && typeof parentSignal.removeEventListener === "function") {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  };

  const onParentAbort = () => {
    try {
      controller.abort(parentSignal.reason || "run_cancelled");
    } finally {
      cleanup();
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason || "run_cancelled");
      cleanup();
    } else if (typeof parentSignal.addEventListener === "function") {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !signal.aborted) {
    timerId = setTimeout(() => {
      controller.abort("stage_timeout");
      cleanup();
    }, timeoutMs);
  }

  return { signal, cleanup };
}

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
        console.warn(`[${this.constructor.name}] ${errors.length} child agent(s) failed to dispose`, errors);
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
      const { DegradationMatrix } = await import("./resilience/degradation-matrix.js");
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
   * @param {string} name
   * @param {(ctx: any, input: any, api: any) => any | Promise<any>} handler
   * @param {{ actor?: string, timeoutMs?: number, configSchema?: any, configValidation?: any }} [options]
   * @returns {this}
   */
  registerStage(name, handler, options = {}) {
    this._ensureNotDisposed();
    const stageName = toNonEmptyString(name);
    if (!stageName) throw new Error("AgentOrchestrator.registerStage(name, handler): name must be a non-empty string");
    if (typeof handler !== "function") throw new TypeError("AgentOrchestrator.registerStage(name, handler): handler must be a function");

    const actor = toNonEmptyString(options?.actor);
    const timeoutMs = normalizeTimeoutMs(options?.timeoutMs, null);
    const configSchema = isPlainObject(options?.configSchema) ? options.configSchema : null;
    const configValidation = isPlainObject(options?.configValidation) ? options.configValidation : null;
    this._stages.set(stageName, {
      handler,
      options: {
        actor: actor && isValidActorType(actor) ? actor : undefined,
        timeoutMs,
        configSchema,
        configValidation,
      },
    });
    return this;
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
  }

  /**
   * @param {any} [reason]
   * @returns {void}
   */
  stop(reason = "cancelled") {
    this._ensureNotDisposed();
    if (this.signal.aborted) return;
    const r = toNonEmptyString(reason) || "cancelled";
    const isFailure =
      r === "stage_failed" ||
      r === "workflow_failed" ||
      r.endsWith(".failed") ||
      r.endsWith("_failed") ||
      r.includes("failed");

    this.state = isFailure ? OrchestratorState.FAILED : OrchestratorState.CANCELLED;
    this._abortController.abort(r);
    if (isFailure) this._emitRunFailed({ error: r });
    else this._emitRunCancelled(r);
    this._emitRunEnded({ reason: r });
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
            results.set(stageName, { success: false, error: error?.message || String(error) });
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
    const settled = await Promise.allSettled(executing);
    const errors = settled.filter((r) => r.status === "rejected").map((r) => r.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} parallel stages failed`);
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
    // Wait for slot
    const limit = await this._getEffectiveConcurrencyLimit();
    while (this._inFlight >= limit) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (this.signal.aborted) throw new Error("Run cancelled");
    }

    this._inFlight++;
    try {
      return await this._runStageNow(stageName, input);
    } finally {
      this._inFlight--;
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

    const stageActor = entry.options.actor || deriveActorFromStageName(stageName);
    const { signal: stageSignal, cleanup } = createStageAbortSignal(this.signal, entry.options.timeoutMs);

    // P6.1.3: Validate userConfig at stage init (best-effort, backward compatible).
    let stageInput = input;
    let userConfigValidation = null;
    if (isPlainObject(stageInput) && ("userConfig" in stageInput || stageInput.userConfig !== undefined)) {
      const schema = entry.options?.configSchema || DEFAULT_USER_CONFIG_SCHEMA;
      const stageCfg = isPlainObject(entry.options?.configValidation) ? entry.options.configValidation : {};
      const strict =
        stageCfg.strict === true ||
        this._configValidation.strict === true ||
        stageInput?.userConfig?.strictValidation === true;
      const coerce = stageCfg.coerce === true || this._configValidation.coerce === true;

      const result = validateConfig(stageInput.userConfig, schema, { strict: false, coerce });
      userConfigValidation = { valid: result.valid, errors: result.errors };

      if (!result.valid) {
        const details = formatValidationErrors(result.errors);
        const err = new Error(`Invalid userConfig for stage "${stageName}"\n${details}`);
        err.name = "ConfigValidationError";
        /** @type {any} */ (err).errors = result.errors;

        // Always emit a structured validation event; throw only in strict mode.
        this.eventBus.emit(`${stageName}.config.invalid`, {
          actor: stageActor,
          status: "failed",
          payload: { message: err.message, errors: result.errors },
        });

        if (strict) throw err;
      }

      stageInput = { ...stageInput, userConfig: result.config };
    }

    const degradationMatrix = await this._getDegradationMatrix();
    const degradation =
      degradationMatrix
        ? {
            level: degradationMatrix.currentLevel,
            enabledFeatures: degradationMatrix.getEnabledFeatures(),
            recommendations: degradationMatrix.getRecommendations(),
            status: degradationMatrix.getStatus(),
            isFeatureEnabled: (feature) => degradationMatrix.isFeatureEnabled(feature),
          }
        : null;

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
  }
}
