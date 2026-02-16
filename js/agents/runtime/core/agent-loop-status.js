/**
 * Loop Status Controller for BaseAgentLoop
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
 * @param {any} loop
 * @param {{ strictLoopStatus?: boolean, logger?: any, emit?: any, stageName?: string, actor?: string }} [options]
 * @returns {LoopStatusController}
 */
function ensureLoopStatusController(loop, options = {}) {
  if (!loop || typeof loop !== "object") {
    throw new Error("LoopStatusController requires a loop instance");
  }
  if (loop._statusMixin instanceof LoopStatusController) return loop._statusMixin;
  const component = new LoopStatusController(loop, options);
  loop._statusMixin = component;
  return component;
}

/**
 * @param {(loop: any) => LoopStatusController} ensureComponent
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
    this._loop._abortActiveStep(reason);
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

/**
 * @deprecated Use `new LoopStatusController(loop, options)` instead.
 * @param {any} loop
 * @param {{ strictLoopStatus?: boolean, logger?: any, emit?: any, stageName?: string, actor?: string }} [options]
 * @returns {LoopStatusController}
 */
export function initStatusMixin(loop, options = {}) {
  const component = new LoopStatusController(loop, options);
  loop._statusMixin = component;
  return component;
}

/**
 * @deprecated BaseAgentLoop now delegates explicitly; this exists for legacy callers.
 * @param {new (...args: any[]) => any} BaseAgentLoop
 */
export function attachStatusMixin(BaseAgentLoop) {
  const descriptors = createDelegatedDescriptors(
    (loop) => ensureLoopStatusController(loop),
    Object.getOwnPropertyDescriptors(LoopStatusController.prototype)
  );
  Object.defineProperties(BaseAgentLoop.prototype, descriptors);
}
