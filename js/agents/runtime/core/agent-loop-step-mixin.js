/**
 * Step Mixin for BaseAgentLoop
 *
 * Extracted from BaseAgentLoop (C4 audit) to support Interface Segregation.
 * Manages step lifecycle: begin, end, emit events, abort, signal creation.
 *
 * Pattern: initStepMixin(this) in constructor + attachStepMixin(Class) after class.
 */

/**
 * @typedef {Record<string, any>} AnyRecord
 * @typedef {{ stepId?: string, name?: string, step?: string, runId?: string | null, iteration?: number | null, meta?: any }} StepMeta
 * @typedef {{ stepId: string, name: string, runId: string | null, iteration: number | null, startedAt: number, meta: any }} StepInfo
 * @typedef {StepInfo & { signal: AbortSignal, controller: AbortController }} ActiveStep
 * @typedef {{ status?: string, error?: any, result?: any }} EndStepOptions
 */

let _stepSeq = 0;

/**
 * @param {string | null | undefined} prefix
 * @returns {string}
 */
function buildStepId(prefix) {
  _stepSeq += 1;
  const base = prefix && typeof prefix === "string" ? prefix : "step";
  return `${base}_${Date.now().toString(36)}_${_stepSeq}`;
}

/**
 * @param {AbortSignal | null | undefined} a
 * @param {AbortSignal | null | undefined} b
 * @returns {AbortSignal | null}
 */
function mergeSignals(a, b) {
  const signals = [a, b].filter(Boolean);
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener?.("abort", abort, { once: true });
  }
  return controller.signal;
}

/**
 * Initialize step mixin state on the loop instance.
 * @param {any} loop
 */
export function initStepMixin(loop) {
  loop._activeStep = null;
}

/**
 * @internal Mixin class — methods are copied to BaseAgentLoop.prototype via attachStepMixin().
 */
class AgentLoopStepMixin {
  /**
   * @param {StepMeta} [stepMeta]
   * @param {AnyRecord} [context]
   * @returns {{ step: StepInfo, context: AnyRecord }}
   */
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

  /**
   * @param {{ step?: StepInfo } | null | undefined} stepInfo
   * @param {EndStepOptions} [options]
   */
  _endStep(stepInfo, { status = "completed", error, result } = {}) {
    const step = stepInfo?.step || this._activeStep;
    if (!step) return;
    const payload = /** @type {AnyRecord} */ ({ ...step });
    if (error) payload.error = error;
    if (result !== undefined) payload.result = result;
    this._emitStepEvent(status, payload);
    if (this._activeStep && this._activeStep.stepId === step.stepId) {
      this._activeStep = null;
    }
  }

  /**
   * @param {string} status
   * @param {AnyRecord} payload
   */
  _emitStepEvent(status, payload) {
    const emit = this.emit || this.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(`${this.stageName}.step.${status}`, { actor: this.actor, status, payload });
  }

  /** @param {string | null | undefined} reason */
  _abortActiveStep(reason) {
    const controller = this._activeStep?.controller;
    if (!controller || controller.signal.aborted) return;
    controller.abort(reason || "paused");
  }

  /**
   * @param {AbortSignal | null | undefined} parentSignal
   * @returns {{ signal: AbortSignal, controller: AbortController }}
   */
  _createStepSignal(parentSignal) {
    const controller = new AbortController();
    const signal = mergeSignals(parentSignal, controller.signal) || controller.signal;
    return { signal, controller };
  }
}

/** @param {new (...args: any[]) => any} BaseAgentLoop */
export function attachStepMixin(BaseAgentLoop) {
  const descriptors = Object.getOwnPropertyDescriptors(AgentLoopStepMixin.prototype);
  delete descriptors.constructor;
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}
