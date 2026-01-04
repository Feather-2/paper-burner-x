import { createStageApi } from "../shared/utils/stage-api.js";
import { EventBus } from "./events/event-bus.js";
import { ActorType, OrchestratorState, isValidActorType } from "./core/constants.js";

import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
function normalizeTimeoutMs(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

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

function deriveActorFromStageName(stageName, fallbackActor = ActorType.SYSTEM) {
  const name = toNonEmptyString(stageName);
  const head = name.split(".")[0];
  const candidate = head && isValidActorType(head) ? head : fallbackActor;
  return candidate;
}

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
 *
 * This orchestrator is intentionally minimal; complex stage composition lives in callers.
 */
export class AgentOrchestrator {
  constructor({ mode, scenario, constraints, services, eventBus, runId } = {}) {
    this.runContext = buildRunContext({ runId, mode, scenario, constraints });
    this.runId = this.runContext.runId;

    this._services = services && typeof services === "object" ? services : {};
    this.eventBus = eventBus instanceof EventBus ? eventBus : new EventBus({ runId: this.runId });
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

    this.state = OrchestratorState.IDLE;
    this._runStarted = false;
    this._runEnded = false;
    this._runCompleted = false;
    this._runFailed = false;
    this._runCancelled = false;
    this._stages = new Map(); // stageName -> { handler, options }
    this._queue = Promise.resolve();

    this.emit = (name, record) => this.eventBus.emit(name, record);
  }

  _emitRunStarted() {
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

  _emitRunCancelled(reason) {
    if (this._runCancelled) return;
    this._runCancelled = true;
    this.emit("run.cancelled", {
      actor: ActorType.SYSTEM,
      status: "cancelled",
      payload: { reason: toNonEmptyString(reason) || "cancelled", runId: this.runId },
    });
  }

  _emitRunFailed({ error, stage } = {}) {
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

  _emitRunCompleted({ reason } = {}) {
    if (this._runCompleted) return;
    this._runCompleted = true;
    const r = toNonEmptyString(reason) || "completed";
    // Compat: 일부旧 workflow 仍监听 run.completed
    this.emit("run.completed", { actor: ActorType.SYSTEM, status: "completed", payload: { reason: r, runId: this.runId } });
  }

  _emitRunEnded({ reason } = {}) {
    if (this._runEnded) return;
    this._runEnded = true;
    const r = toNonEmptyString(reason);
    this.emit("run.ended", {
      actor: ActorType.SYSTEM,
      status: "ended",
      ...(r ? { payload: { reason: r, runId: this.runId } } : { payload: { runId: this.runId } }),
    });
  }

  registerStage(name, handler, options = {}) {
    const stageName = toNonEmptyString(name);
    if (!stageName) throw new Error("AgentOrchestrator.registerStage(name, handler): name must be a non-empty string");
    if (typeof handler !== "function") throw new TypeError("AgentOrchestrator.registerStage(name, handler): handler must be a function");

    const actor = toNonEmptyString(options?.actor);
    const timeoutMs = normalizeTimeoutMs(options?.timeoutMs, null);
    this._stages.set(stageName, {
      handler,
      options: {
        actor: actor && isValidActorType(actor) ? actor : undefined,
        timeoutMs,
      },
    });
    return this;
  }

  start() {
    if (this.state === OrchestratorState.RUNNING) return;
    this.state = OrchestratorState.RUNNING;
    this._emitRunStarted();
  }

  stop(reason = "cancelled") {
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

  end(reason = "completed") {
    if (this.state === OrchestratorState.ENDED) return;
    if (this.state === OrchestratorState.RUNNING) {
      this.state = OrchestratorState.ENDED;
      this._emitRunCompleted({ reason });
      this._emitRunEnded({ reason });
      return;
    }
    this.state = OrchestratorState.ENDED;
  }

  async runStage(stageName, input) {
    const name = toNonEmptyString(stageName);
    if (!name) throw new Error("AgentOrchestrator.runStage(stageName): stageName must be a non-empty string");

    // Force sequential execution (shared UI + persistence assumptions).
    this._queue = this._queue.then(
      () => this._runStageNow(name, input),
      () => this._runStageNow(name, input)
    );
    return this._queue;
  }

  async _runStageNow(stageName, input) {
    if (this.state !== OrchestratorState.RUNNING) this.start();
    if (this.signal.aborted) throw new Error("Run cancelled");

    const entry = this._stages.get(stageName);
    if (!entry) throw new Error(`Stage not registered: ${stageName}`);

    const stageActor = entry.options.actor || deriveActorFromStageName(stageName);
    const { signal: stageSignal, cleanup } = createStageAbortSignal(this.signal, entry.options.timeoutMs);

    const api = createStageApi({
      signal: stageSignal,
      eventBus: this.eventBus,
      emit: (name, record) => this.eventBus.emit(name, record),
      ...this._services,
      progress: (payload) => {
        this.eventBus.emit(`${stageName}.progress`, { actor: stageActor, status: "progress", payload });
      },
    });

    const ctx = { ...this.runContext, runId: this.runId };

    this.eventBus.emit(`${stageName}.started`, { actor: stageActor, status: "started", payload: { input } });

    try {
      const out = await entry.handler(ctx, input, api);
      this.eventBus.emit(`${stageName}.completed`, { actor: stageActor, status: "completed" });
      return out;
    } catch (err) {
      const message = String(err?.message || err);
      this.eventBus.emit(`${stageName}.failed`, { actor: stageActor, status: "failed", payload: { error: message } });
      this.state = OrchestratorState.FAILED;
      this._emitRunFailed({ error: message, stage: stageName });
      this._emitRunEnded({ reason: "failed" });
      throw err;
    } finally {
      cleanup();
    }
  }
}
