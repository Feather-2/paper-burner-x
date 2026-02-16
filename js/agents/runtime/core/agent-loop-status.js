/**
 * Loop Status Controller for BaseAgentLoop
 *
 * Extracted from BaseAgentLoop (C4 audit) to support Interface Segregation.
 * Delegates all status management to StatusController.
 */

import { AgentStatus } from "./agent-status.js";
import { StatusController } from "./status-controller.js";

/**
 * @typedef {import("./agent-loop.js").LoopStatusTransitionMeta} LoopStatusTransitionMeta
 */

export class LoopStatusController {
  /**
   * @param {any} loop
   * @param {{ strictLoopStatus?: boolean, logger?: any, emit?: any, stageName?: string, actor?: string }} [options]
   */
  constructor(loop, { strictLoopStatus, logger, emit, stageName, actor } = {}) {
    this._loop = loop;
    this._loop._statusController = new StatusController({
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

  /** @returns {string} */
  get loopStatus() {
    return this._loop._statusController.status;
  }

  /** @returns {string} */
  get _loopStatus() {
    return this._loop._statusController._loopStatus;
  }

  /** @param {string} value */
  set _loopStatus(value) {
    this._loop._statusController._loopStatus = value;
  }

  /** @returns {boolean} */
  get isPaused() {
    return this._loop._statusController.isPaused;
  }

  /** @returns {boolean} */
  get _pauseRequested() {
    return this._loop._statusController._pauseRequested;
  }

  /** @param {boolean} value */
  set _pauseRequested(value) {
    this._loop._statusController._pauseRequested = value;
  }

  /** @returns {string | null} */
  get _pauseReason() {
    return this._loop._statusController._pauseReason;
  }

  /** @param {string | null} value */
  set _pauseReason(value) {
    this._loop._statusController._pauseReason = value;
  }

  /** @returns {any[]} */
  get statusHistory() {
    return this._loop._statusController.statusHistory;
  }

  /** @returns {any[]} */
  get _statusHistory() {
    return this._loop._statusController._statusHistory;
  }

  /** @param {{ status?: string, machine?: any, eventName?: string, strict?: boolean } | null | undefined} [options] */
  initLoopStatus({ status, machine, eventName, strict } = {}) {
    this._loop._statusController.init({ status, machine, eventName, strict });
  }

  /** @param {string} [reason] */
  pause(reason = "user_requested") {
    this._loop._statusController.pause(reason);
    this._loop.stepRunner._abortActiveStep(reason);
  }

  /** @returns {void} */
  resume() {
    this._loop._statusController.resume();
  }

  /** @param {string} newStatus @param {LoopStatusTransitionMeta} [metadata] */
  _transitionLoopStatus(newStatus, metadata = {}) {
    return this._loop._statusController.transition(newStatus, metadata);
  }

  /** @param {AbortSignal | null | undefined} signal */
  _checkPaused(signal) {
    return this._loop._statusController.checkPaused(signal);
  }

  /** @param {{ signal?: AbortSignal, runId?: string | null } | null | undefined} [options] */
  _createPauseError(options) {
    return this._loop._statusController.createPauseError(options);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _shouldPauseFromError(err, signal) {
    return this._loop._statusController.shouldPauseFromError(err, signal);
  }

  /** @param {any} err @param {AbortSignal | null | undefined} signal */
  _isAbortError(err, signal) {
    return this._loop._statusController._isAbortError(err, signal);
  }
}
