import { createStageApi } from "../shared/stage-api.js";
import { StagePausedError } from "./stage-errors.js";
import { getRuntimeState } from "./loop-runtime-state.js";

const USER_ACTION_PREFIX = "user.action";

export function getEmitFn(ctx) {
  const emit = ctx?.emit || ctx?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

export function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(typeof reason === "string" ? reason : "Run cancelled");
}

export function checkPaused(signal) {
  const runtimeState = getRuntimeState(signal);
  if (!runtimeState) return;
  if (runtimeState.status !== "paused") return;

  throw new StagePausedError("Run paused", {
    checkpointId: runtimeState.lastCheckpointId ?? null,
    reason: runtimeState.pausedReason ?? null,
    timestamp: Date.now(),
  });
}

export function checkCancelledOrPaused(signal) {
  checkCancelled(signal);
  checkPaused(signal);
}

export function normalizeToolResult(result) {
  if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "ok")) {
    return result;
  }
  if (result && typeof result === "object" && ("error" in result || "data" in result)) {
    return { ok: !result.error, data: result.data, error: result.error };
  }
  return { ok: true, data: result };
}

export function resolveToolExecutor(context) {
  const executor = context?.toolExecutor || context?.tools;
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.execute === "function") return (name, params) => executor.execute(name, params);
  return null;
}

function mergeSignals(a, b) {
  const signals = [a, b].filter(Boolean);
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) return s;
    s.addEventListener?.("abort", abort, { once: true });
  }
  return controller.signal;
}

let _stepSeq = 0;
function buildStepId(prefix) {
  _stepSeq += 1;
  const base = prefix && typeof prefix === "string" ? prefix : "step";
  return `${base}_${Date.now().toString(36)}_${_stepSeq}`;
}

export class BaseStage {
  constructor({ name, eventBus, logger } = {}) {
    this.name = name || "stage";
    this.eventBus = eventBus || null;
    this.logger = logger || null;
  }

  // Standard stage entrypoint.
  async execute(runContext, input, stageApi = {}) {
    const base = stageApi && typeof stageApi === "object" ? stageApi : {};
    const api = createStageApi({ ...base, eventBus: base.eventBus || this.eventBus });
    api.checkCancelled?.();

    this._emitStage("started", {}, api);
    try {
      const result = await this.run(input, { runContext, ...api });
      this._emitStage("completed", { result }, api);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._emitStage("failed", { error: message }, api);
      throw err;
    }
  }

  // Subclasses must implement.
  async run(_input, _context) {
    throw new Error("Subclass must implement run()");
  }

  _emitStage(status, payload, api) {
    const stageName = String(this.name || "").trim();
    if (!stageName) return;
    api.emit?.(`${stageName}.${status}`, { actor: stageName, status, payload });
  }
}

export class BaseAgentLoop {
  constructor({ eventBus, stateMachine, tools, actor, stageName, emit } = {}) {
    this.eventBus = eventBus || null;
    this.stateMachine = stateMachine || null;
    this.actor = actor || stageName || "agent";
    this.stageName = stageName || actor || "agent";
    this.emit = typeof emit === "function" ? emit : null;
    this._tools = {};
    this.registerTools(tools);
    this._loopMachine = null;
    this._loopEventName = null;
    this._loopStatus = null;
    this._statusHistory = [];
    this._pauseRequested = false;
    this._pauseReason = null;
    this._activeStep = null;
    this._userInputs = [];
    this._userInputUnsub = null;
    this._userInputBus = null;
    this._userInputEvent = "user.input";
    this._pauseListenerUnsub = null;
  }

  registerTools(tools) {
    if (!tools) return;
    if (tools instanceof Map) {
      for (const [name, fn] of tools.entries()) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (Array.isArray(tools)) {
      for (const [name, fn] of tools) {
        this.registerTool(name, fn);
      }
      return;
    }
    if (typeof tools === "object") {
      for (const [name, fn] of Object.entries(tools)) {
        this.registerTool(name, fn);
      }
      return;
    }
    throw new TypeError("BaseAgentLoop.registerTools: tools must be an object, array, or map");
  }

  registerTool(name, fn) {
    if (!name || typeof name !== "string") {
      throw new TypeError("BaseAgentLoop.registerTool: name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new TypeError("BaseAgentLoop.registerTool: fn must be a function");
    }
    this._tools[name] = fn;
  }

  _emitStage(name, status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(name, { actor: this.actor, status, payload });
  }

  async _callTool(name, params, context) {
    const executor = resolveToolExecutor(context);
    if (executor) {
      return normalizeToolResult(await executor(name, params, context));
    }
    const tool = this._tools[name];
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }
    try {
      const data = await tool(params, context);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  _transitionPhase(state, next, { emit, runId, payload, eventName } = {}) {
    const from = state?.status ?? state?.state;
    let ok = true;
    if (this.stateMachine && typeof this.stateMachine.transition === "function") {
      ok = this.stateMachine.transition(state, next, { runId, from, to: next, ...payload });
    } else if (state && typeof state === "object") {
      if ("status" in state) state.status = next;
      else if ("state" in state) state.state = next;
      else state.status = next;
    }

    if (!ok) {
      throw new Error(`${this.stageName} phase transition rejected: ${from} -> ${next}`);
    }

    const emitFn = emit || this.emit || this.eventBus?.emit;
    if (typeof emitFn === "function") {
      emitFn(eventName || `${this.stageName}.phase.transition`, {
        actor: this.actor,
        status: "progress",
        payload: { runId, from, to: next, ...payload },
      });
    }

    return next;
  }

  async waitForUserAction(actionName, { timeout = 300000, eventBus, signal } = {}) {
    const bus = eventBus || this.eventBus;
    if (!bus || typeof bus.subscribe !== "function") {
      throw new Error("waitForUserAction: eventBus with subscribe() is required");
    }

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, payload) => {
        if (done) return;
        done = true;
        clearTimeout(timeoutId);
        off?.();
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
        if (err) reject(err);
        else resolve(payload);
      };

      const onAbort = () => {
        finish(new Error("Run cancelled"));
      };

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutId = setTimeout(() => {
        finish(new Error(`Timeout waiting for user action: ${actionName}`));
      }, timeout);

      const off = bus.subscribe(`${USER_ACTION_PREFIX}.${actionName}`, (evt) => {
        const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
        finish(null, payload);
      });
    });
  }

  async run() {
    throw new Error("BaseAgentLoop.run() is not implemented");
  }

  async execute(runContext, input, stageApi = {}) {
    const context = { ...stageApi, runContext };
    this.eventBus = stageApi.eventBus || this.eventBus || null;
    this.emit = getEmitFn(stageApi) || this.emit || this.eventBus?.emit || null;
    if (this.eventBus) {
      this._attachUserInputListener(this.eventBus);
      this._attachPauseListener(this.eventBus);
    }
    return this.run(input, context);
  }

  _checkPaused(signal) {
    checkPaused(signal);
  }

  pause(reason = "user_requested") {
    this._pauseRequested = true;
    this._pauseReason = reason;
    this._abortActiveStep(reason);
  }

  resume() {
    this._pauseRequested = false;
    this._pauseReason = null;
  }

  get loopStatus() {
    return this._loopStatus;
  }

  get isPaused() {
    return this._pauseRequested;
  }

  get statusHistory() {
    return Array.isArray(this._statusHistory) ? [...this._statusHistory] : [];
  }

  initLoopStatus({ status, machine, eventName } = {}) {
    if (machine) this._loopMachine = machine;
    if (eventName) this._loopEventName = eventName;
    if (status) this._loopStatus = status;
    if (!Array.isArray(this._statusHistory)) this._statusHistory = [];
  }

  _emitAgentStatusChanged(payload, { eventName } = {}) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    const name = eventName || this._loopEventName || `${this.stageName}.agent.status.changed`;
    emit(name, { actor: this.actor, status: "info", payload });
  }

  _recordLoopStatusTransition({ from, to, timestamp, ...meta } = {}) {
    const ts = typeof timestamp === "number" ? timestamp : Date.now();
    const entry = { from, to, timestamp: ts, ...meta };
    if (!Array.isArray(this._statusHistory)) this._statusHistory = [];
    this._statusHistory.push(entry);
    this._loopStatus = to;
    this._emitAgentStatusChanged(entry);
    return entry;
  }

  _transitionLoopStatus(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null;
    if (this._loopMachine && typeof this._loopMachine.canTransition === "function") {
      if (!this._loopMachine.canTransition(oldStatus, newStatus)) {
        const err = new Error(`Invalid AgentLoop state transition: ${oldStatus} -> ${newStatus}`);
        err.code = "INVALID_STATE_TRANSITION";
        throw err;
      }
    }
    return this._recordLoopStatusTransition({ from: oldStatus, to: newStatus, ...metadata });
  }

  _attachUserInputListener(eventBus, { eventName } = {}) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    const resolvedEvent = typeof eventName === "string" && eventName ? eventName : this._userInputEvent;
    if (this._userInputBus === eventBus && this._userInputEvent === resolvedEvent) return;
    if (typeof this._userInputUnsub === "function") this._userInputUnsub();
    this._userInputBus = eventBus;
    this._userInputEvent = resolvedEvent;
    this._userInputUnsub = eventBus.subscribe(resolvedEvent, (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      this.recordUserInput(payload);
    });
  }

  _attachPauseListener(eventBus) {
    if (!eventBus || typeof eventBus.subscribe !== "function") return;
    if (this._pauseListenerUnsub) return;
    this._pauseListenerUnsub = eventBus.subscribe("user.action.pause", (evt) => {
      const payload = evt && typeof evt === "object" && "payload" in evt ? evt.payload : evt;
      const reason = payload?.reason || payload?.message || payload;
      this.pause(typeof reason === "string" ? reason : "user_requested");
    });
  }

  recordUserInput(payload) {
    const entry = {
      payload,
      ts: Date.now(),
    };
    this._userInputs.push(entry);
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${this.stageName}.user.input`, { actor: this.actor, status: "info", payload: entry });
    }
    return entry;
  }

  consumeUserInputs({ clear = true } = {}) {
    const items = Array.isArray(this._userInputs) ? [...this._userInputs] : [];
    if (clear) this._userInputs = [];
    return items;
  }

  drainUserInputsAsText({ clear = true } = {}) {
    const items = this.consumeUserInputs({ clear });
    const text = this.formatUserInputs(items);
    return { items, text };
  }

  applyUserInputsToConfig(userConfig, { key = "userNotes" } = {}) {
    const { items, text } = this.drainUserInputsAsText({ clear: true });
    if (!text) return userConfig;
    const next = userConfig && typeof userConfig === "object" ? { ...userConfig } : {};
    const existing = Array.isArray(next[key]) ? next[key] : typeof next[key] === "string" ? [next[key]] : [];
    next[key] = [...existing, text];
    next._lastUserNote = text;
    next._lastUserNoteAt = Date.now();
    next._rawUserInputs = Array.isArray(next._rawUserInputs) ? [...next._rawUserInputs, ...items] : [...items];
    return next;
  }

  hasPendingUserInputs() {
    return Array.isArray(this._userInputs) && this._userInputs.length > 0;
  }

  formatUserInputs(items) {
    const list = Array.isArray(items) ? items : [];
    const lines = [];
    for (const item of list) {
      const payload = item?.payload ?? item;
      if (payload == null) continue;
      if (typeof payload === "string") {
        lines.push(payload.trim());
        continue;
      }
      if (typeof payload?.text === "string") {
        lines.push(payload.text.trim());
        continue;
      }
      if (typeof payload?.message === "string") {
        lines.push(payload.message.trim());
        continue;
      }
      try {
        lines.push(JSON.stringify(payload));
      } catch {
        lines.push(String(payload));
      }
    }
    return lines.filter(Boolean).join("\n");
  }

  _beginStep(stepMeta = {}, context = {}) {
    const meta = stepMeta && typeof stepMeta === "object" ? stepMeta : {};
    const stepId = meta.stepId || buildStepId(this.stageName);
    const startedAt = Date.now();
    const { signal, controller } = this._createStepSignal(context.signal);
    const step = {
      stepId,
      name: meta.name || meta.step || "step",
      runId: meta.runId || null,
      iteration: meta.iteration ?? null,
      startedAt,
      meta: meta.meta || null,
    };
    this._activeStep = { ...step, signal, controller };
    this._emitStepEvent("started", step);
    return {
      step,
      context: { ...context, signal },
    };
  }

  _endStep(stepInfo, { status = "completed", error, result } = {}) {
    const step = stepInfo?.step || this._activeStep;
    if (!step) return;
    const payload = { ...step };
    if (error) payload.error = error;
    if (result !== undefined) payload.result = result;
    this._emitStepEvent(status, payload);
    if (this._activeStep && this._activeStep.stepId === step.stepId) {
      this._activeStep = null;
    }
  }

  _emitStepEvent(status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(`${this.stageName}.step.${status}`, { actor: this.actor, status, payload });
  }

  _abortActiveStep(reason) {
    const controller = this._activeStep?.controller;
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason || "paused");
  }

  _createStepSignal(parentSignal) {
    const controller = new AbortController();
    const signal = mergeSignals(parentSignal, controller.signal) || controller.signal;
    return { signal, controller };
  }

  _isAbortError(err, signal) {
    if (!err) return false;
    if (signal?.aborted) return true;
    const name = err.name || err.code;
    if (name === "AbortError" || name === "CanceledError" || name === "CancelledError") return true;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("cancelled");
  }

  _shouldPauseFromError(err, signal) {
    const runtimeState = getRuntimeState(signal);
    const pauseRequested = this._pauseRequested || runtimeState?.status === "paused";
    if (!pauseRequested) return false;
    return this._isAbortError(err, signal);
  }

  _createPauseError({ signal, runId } = {}) {
    const runtimeState = getRuntimeState(signal);
    const reason = runtimeState?.pausedReason || this._pauseReason || null;
    const checkpointId = runtimeState?.lastCheckpointId ?? null;
    return new StagePausedError("Run paused", {
      checkpointId,
      reason,
      timestamp: Date.now(),
      runId,
    });
  }
}
