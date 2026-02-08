/**
 * Status Mixin for BaseAgentLoop
 *
 * Extracted from BaseAgentLoop (C4 audit) to support Interface Segregation.
 * Delegates all status management to StatusController.
 *
 * Pattern: initStatusMixin(this, {...}) in constructor + attachStatusMixin(Class) after class.
 */

import { AgentStatus } from "./agent-status.js";
import { StatusController } from "./status-controller.js";

/**
 * @typedef {import("./agent-loop.js").LoopStatusTransitionMeta} LoopStatusTransitionMeta
 */

/**
 * Initialize status mixin state on the loop instance.
 * @param {any} loop
 * @param {{ strictLoopStatus?: boolean, logger?: any, emit?: any, stageName?: string, actor?: string }} [options]
 */
export function initStatusMixin(loop, { strictLoopStatus, logger, emit, stageName, actor } = {}) {
  loop._statusController = new StatusController({
    status: AgentStatus.IDLE,
    machine: null,
    eventName: null,
    strict: strictLoopStatus,
    logger,
    emit,
    stageName,
    actor,
  });
}

/**
 * @internal Mixin class — methods are copied to BaseAgentLoop.prototype via attachStatusMixin().
 */
class AgentLoopStatusMixin {
  /** @returns {string} */
  get loopStatus() {
    return this._statusController.status;
  }

  /** @returns {string} */
  get _loopStatus() {
    return this._statusController._loopStatus;
  }

  /** @param {string} value */
  set _loopStatus(value) {
    this._statusController._loopStatus = value;
  }

  /** @returns {boolean} */
  get isPaused() {
    return this._statusController.isPaused;
  }

  /** @returns {boolean} */
  get _pauseRequested() {
    return this._statusController._pauseRequested;
  }

  /** @param {boolean} value */
  set _pauseRequested(value) {
    this._statusController._pauseRequested = value;
  }

  /** @returns {string | null} */
  get _pauseReason() {
    return this._statusController._pauseReason;
  }

  /** @param {string | null} value */
  set _pauseReason(value) {
    this._statusController._pauseReason = value;
  }

  /** @returns {any[]} */
  get statusHistory() {
    return this._statusController.statusHistory;
  }

  /** @returns {any[]} */
  get _statusHistory() {
    return this._statusController._statusHistory;
  }

  /** @param {{ status?: string, machine?: any, eventName?: string, strict?: boolean } | null | undefined} [options] */
  initLoopStatus({ status, machine, eventName, strict } = {}) {
    this._statusController.init({ status, machine, eventName, strict });
  }

  /** @param {string} [reason] */
  pause(reason = "user_requested") {
    this._statusController.pause(reason);
    this._abortActiveStep(reason);
  }

  /** @returns {void} */
  resume() {
    this._statusController.resume();
  }

  /** @param {string} newStatus @param {LoopStatusTransitionMeta} [metadata] */
  _transitionLoopStatus(newStatus, metadata = {}) {
    return this._statusController.transition(newStatus, metadata);
  }

  /** @param {AbortSignal | null | undefined} signal */
  _checkPaused(signal) {
    return this._statusController.checkPaused(signal);
  }

  /** @param {{ signal?: AbortSignal, runId?: string | null } | null | undefined} [options] */
  _createPauseError(options) {
    return this._statusController.createPauseError(options);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _shouldPauseFromError(err, signal) {
    return this._statusController.shouldPauseFromError(err, signal);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _isAbortError(err, signal) {
    return this._statusController._isAbortError(err, signal);
  }
}

/** @param {new (...args: any[]) => any} BaseAgentLoop */
export function attachStatusMixin(BaseAgentLoop) {
  const descriptors = Object.getOwnPropertyDescriptors(AgentLoopStatusMixin.prototype);
  delete descriptors.constructor;
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}
