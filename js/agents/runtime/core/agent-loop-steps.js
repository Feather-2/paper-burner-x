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

/**
 * @returns {string}
 */
function createStepInstanceId() {
  const uuid = typeof globalThis?.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : null;
  if (uuid) return uuid.replace(/-/g, "").slice(0, 8);
  return `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * @param {string | null | undefined} prefix
 * @param {string} instanceId
 * @param {number} sequence
 * @param {string | null | undefined} runId
 * @returns {string}
 */
function buildStepId(prefix, instanceId, sequence, runId) {
  const base = prefix && typeof prefix === "string" ? prefix : "step";
  const runScope = runId && typeof runId === "string"
    ? runId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || instanceId
    : instanceId;
  return `${base}_${runScope}_${sequence}`;
}

export class StepRunner {
  /**
   * @param {any} loop
   * @param {Record<string, any>} [_options]
   */
  constructor(loop, _options = {}) {
    this._loop = loop;
    this._loop._activeStep = null;
    this._stepSeq = 0;
    this._stepInstanceId = createStepInstanceId();
  }

  /**
   * @param {StepMeta} [stepMeta]
   * @param {AnyRecord} [context]
   * @returns {{ step: StepInfo, context: AnyRecord }}
   */
  _beginStep(stepMeta = {}, context = {}) {
    const loop = this._loop;
    const meta = stepMeta && typeof stepMeta === "object" ? stepMeta : {};
    this._stepSeq += 1;
    const stepId = meta.stepId || buildStepId(loop.stageName, this._stepInstanceId, this._stepSeq, meta.runId);
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
