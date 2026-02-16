/**
 * Step Runner for BaseAgentLoop
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

import { mergeSignals } from "../../shared/utils/cancellation.js";

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
 * @param {any} loop
 * @param {Record<string, any>} [options]
 * @returns {StepRunner}
 */
function ensureStepRunner(loop, options = {}) {
  if (!loop || typeof loop !== "object") {
    throw new Error("StepRunner requires a loop instance");
  }
  if (loop._stepMixin instanceof StepRunner) return loop._stepMixin;
  const component = new StepRunner(loop, options);
  loop._stepMixin = component;
  return component;
}

/**
 * @param {(loop: any) => StepRunner} ensureComponent
 * @param {PropertyDescriptorMap} descriptors
 * @returns {PropertyDescriptorMap}
 */
function createDelegatedDescriptors(ensureComponent, descriptors) {
  /** @type {PropertyDescriptorMap} */
  const delegated = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (name === "constructor") continue;
    /** @type {PropertyDescriptor} */
    const next = {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
    };
    if (typeof descriptor.get === "function") {
      next.get = function delegatedGetter() {
        const component = ensureComponent(this);
        return descriptor.get.call(component);
      };
    }
    if (typeof descriptor.set === "function") {
      next.set = function delegatedSetter(value) {
        const component = ensureComponent(this);
        descriptor.set.call(component, value);
      };
    }
    if (typeof descriptor.value === "function") {
      next.writable = true;
      next.value = function delegatedMethod(...args) {
        const component = ensureComponent(this);
        return descriptor.value.apply(component, args);
      };
    }
    delegated[name] = next;
  }
  return delegated;
}

export class StepRunner {
  /**
   * @param {any} loop
   * @param {Record<string, any>} [_options]
   */
  constructor(loop, _options = {}) {
    this._loop = loop;
    this._loop._activeStep = null;
  }

  /**
   * @param {StepMeta} [stepMeta]
   * @param {AnyRecord} [context]
   * @returns {{ step: StepInfo, context: AnyRecord }}
   */
  _beginStep(stepMeta = {}, context = {}) {
    const loop = this._loop;
    const meta = stepMeta && typeof stepMeta === "object" ? stepMeta : {};
    const stepId = meta.stepId || buildStepId(loop.stageName);
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
    loop._activeStep = { ...step, signal, controller };
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
    const loop = this._loop;
    const step = stepInfo?.step || loop._activeStep;
    if (!step) return;
    const payload = /** @type {AnyRecord} */ ({ ...step });
    if (error) payload.error = error;
    if (result !== undefined) payload.result = result;
    this._emitStepEvent(status, payload);
    if (loop._activeStep && loop._activeStep.stepId === step.stepId) {
      loop._activeStep = null;
    }
  }

  /**
   * @param {string} status
   * @param {AnyRecord} payload
   */
  _emitStepEvent(status, payload) {
    const loop = this._loop;
    const emit = loop.emit || loop.eventBus?.emit;
    if (typeof emit !== "function") return;
    emit(`${loop.stageName}.step.${status}`, { actor: loop.actor, status, payload });
  }

  /** @param {string | null | undefined} reason */
  _abortActiveStep(reason) {
    const controller = this._loop._activeStep?.controller;
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

/**
 * @deprecated Use `new StepRunner(loop)` instead.
 * @param {any} loop
 * @param {Record<string, any>} [options]
 * @returns {StepRunner}
 */
export function initStepMixin(loop, options = {}) {
  const component = new StepRunner(loop, options);
  loop._stepMixin = component;
  return component;
}

/**
 * @deprecated BaseAgentLoop now delegates explicitly; this exists for legacy callers.
 * @param {new (...args: any[]) => any} BaseAgentLoop
 */
export function attachStepMixin(BaseAgentLoop) {
  const descriptors = createDelegatedDescriptors(
    (loop) => ensureStepRunner(loop),
    Object.getOwnPropertyDescriptors(StepRunner.prototype)
  );
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}
