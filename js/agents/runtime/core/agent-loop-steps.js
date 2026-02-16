/**
 * Step Runner for BaseAgentLoop
 *
 * Extracted from BaseAgentLoop (C4 audit) to support Interface Segregation.
 * Manages step lifecycle: begin, end, emit events, abort, signal creation.
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
