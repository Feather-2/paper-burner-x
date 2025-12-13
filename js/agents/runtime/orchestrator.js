import { EventBus } from "./event-bus.js";
import { RunContext } from "./run-context.js";

class StageTimeoutError extends Error {
  constructor(message, { stageName, timeoutMs } = {}) {
    super(message);
    this.name = "StageTimeoutError";
    this.stageName = stageName;
    this.timeoutMs = timeoutMs;
  }
}

class StageCancelledError extends Error {
  constructor(message, { stageName } = {}) {
    super(message);
    this.name = "StageCancelledError";
    this.stageName = stageName;
  }
}

function makeCombinedSignal(signals) {
  const alive = signals.filter(Boolean);
  if (alive.length === 0) return undefined;
  if (alive.length === 1) return alive[0];

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(alive);
  }

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const s of alive) {
    if (s.aborted) return s;
    s.addEventListener("abort", onAbort, { once: true });
  }
  return ctrl.signal;
}

function abortErrorFromSignal(signal, stageName) {
  const reason = signal?.reason;
  const msg = typeof reason === "string" ? reason : "Run cancelled";
  return new StageCancelledError(msg, { stageName });
}

export class AgentOrchestrator {
  constructor({ mode, scenario, constraints, runId, eventBus } = {}) {
    this.runContext = new RunContext({ runId, mode, scenario, constraints });
    this.eventBus = eventBus || new EventBus({ runId: this.runContext.runId });

    this._stages = new Map(); // name -> { fn, actor, timeoutMs }
    this._runAbort = new AbortController();
    this._state = "idle"; // idle|running|ended|failed|cancelled
  }

  get state() {
    return this._state;
  }

  registerStage(name, fn, { actor = "system", timeoutMs } = {}) {
    if (typeof fn !== "function") {
      throw new TypeError("registerStage(name, fn): fn must be a function");
    }
    this._stages.set(name, { fn, actor, timeoutMs });
  }

  start({ payload } = {}) {
    if (this._state !== "idle") return;
    this._state = "running";
    this.eventBus.emit("run.started", {
      actor: "system",
      status: "started",
      payload: {
        mode: this.runContext.mode,
        scenario: this.runContext.scenario,
        constraints: this.runContext.constraints,
        ...(payload || {}),
      },
    });
  }

  stop(reason = "cancelled") {
    if (this._state !== "running") return;
    this._state = "cancelled";
    this._runAbort.abort(reason);
    this.eventBus.emit("run.cancelled", {
      actor: "system",
      status: "cancelled",
      payload: { reason },
    });
  }

  end({ payload } = {}) {
    if (this._state !== "running") return;
    this._state = "ended";
    this.eventBus.emit("run.ended", {
      actor: "system",
      status: "ended",
      payload,
    });
  }

  async run(pipelineFn) {
    this.start();
    try {
      const result = await pipelineFn(this);
      if (this._state === "running") this.end();
      return result;
    } catch (err) {
      if (this._state === "cancelled") throw err;
      this._state = "failed";
      this.eventBus.emit("run.failed", {
        actor: "system",
        status: "failed",
        payload: { message: err?.message, name: err?.name },
      });
      throw err;
    }
  }

  async runStage(name, input, { timeoutMs, actor, payload } = {}) {
    if (this._state === "idle") this.start();
    if (this._state !== "running") {
      throw new Error(`Cannot run stage when orchestrator state=${this._state}`);
    }

    const stage = this._stages.get(name);
    if (!stage) {
      throw new Error(`Stage not registered: ${name}`);
    }

    const stageActor = actor ?? stage.actor ?? "system";
    const stageTimeoutMs = timeoutMs ?? stage.timeoutMs;
    const startedAt = Date.now();

    this.eventBus.emit(`${name}.started`, {
      actor: stageActor,
      status: "started",
      payload,
    });

    const timeoutCtrl = typeof stageTimeoutMs === "number" ? new AbortController() : null;
    let timer = null;
    if (timeoutCtrl) {
      timer = setTimeout(() => timeoutCtrl.abort("timeout"), stageTimeoutMs);
    }

    const signal = makeCombinedSignal([this._runAbort.signal, timeoutCtrl?.signal]);
    const stageApi = {
      runContext: this.runContext,
      signal,
      emit: (eventName, record) => this.eventBus.emit(eventName, record),
      progress: (progressPayload, extra = {}) =>
        this.eventBus.emit(`${name}.progress`, {
          actor: stageActor,
          status: "progress",
          payload: progressPayload,
          ...extra,
        }),
      checkCancelled: () => {
        if (signal?.aborted) throw abortErrorFromSignal(signal, name);
      },
    };

    const stagePromise = (async () => stage.fn(this.runContext, input, stageApi))();

    try {
      const result = await Promise.race([
        stagePromise,
        new Promise((_, reject) => {
          if (!signal) return;
          if (signal.aborted) return reject(abortErrorFromSignal(signal, name));
          signal.addEventListener(
            "abort",
            () => {
              if (timeoutCtrl?.signal.aborted) {
                reject(new StageTimeoutError(`Stage timed out: ${name}`, { stageName: name, timeoutMs: stageTimeoutMs }));
              } else {
                reject(abortErrorFromSignal(signal, name));
              }
            },
            { once: true }
          );
        }),
      ]);

      const durationMs = Date.now() - startedAt;
      this.eventBus.emit(`${name}.ended`, {
        actor: stageActor,
        status: "ended",
        durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      this.eventBus.emit(`${name}.failed`, {
        actor: stageActor,
        status: "failed",
        durationMs,
        payload: { message: err?.message, name: err?.name },
      });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// Expose common error types without exporting extra classes from this module.
AgentOrchestrator.StageTimeoutError = StageTimeoutError;
AgentOrchestrator.StageCancelledError = StageCancelledError;
