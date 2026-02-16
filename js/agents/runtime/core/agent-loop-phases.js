import { AgentStatus, isValidAgentStatus } from "./agent-status.js";

/** @type {Record<string, readonly string[]>} */
const DEFAULT_LOOP_STATUS_TRANSITIONS = Object.freeze({
  [AgentStatus.IDLE]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.RUNNING]: [AgentStatus.PAUSED, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
  [AgentStatus.FAILED]: [AgentStatus.IDLE],
});

/**
 * @param {string} from
 * @param {string} to
 * @param {{ force?: boolean, allowReset?: boolean }} [meta]
 * @returns {boolean}
 */
export function isAllowedLoopStatusTransition(from, to, meta = {}) {
  if (meta && typeof meta === "object") {
    if (meta.force) return true;
    if (meta.allowReset && to === AgentStatus.IDLE) return true;
  }
  if (!isValidAgentStatus(from) || !isValidAgentStatus(to)) return true;
  const allowed = DEFAULT_LOOP_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export class PhaseRunner {
  /**
   * @param {any} loop
   * @param {Record<string, any>} [_options]
   */
  constructor(loop, _options = {}) {
    this._loop = loop;
  }

  /**
   * Resolve a dependency: DI container first, then context property, then fallback.
   * @param {string} serviceId
   * @param {any} context
   * @param {any} fallback
   * @returns {Promise<any>}
   */
  async _resolveDependency(serviceId, context, fallback) {
    const container = context?.container;
    if (container && typeof container.tryGet === "function") {
      const fromContainer = await container.tryGet(serviceId);
      if (fromContainer !== undefined) return fromContainer;
    }
    if (context && typeof context === "object" && serviceId in context) {
      const fromContext = context[serviceId];
      if (fromContext !== undefined) return fromContext;
    }
    return fallback;
  }

  /**
   * Transition phase state and emit event.
   * @param {any} state
   * @param {string} next
   * @param {{ emit?: Function, runId?: string|null, payload?: any, eventName?: string|null }} [options]
   * @returns {string}
   */
  _transitionPhase(state, next, { emit, runId, payload, eventName } = {}) {
    const loop = this._loop;
    const from = state?.status ?? state?.state;
    let ok = true;
    if (loop.stateMachine && typeof loop.stateMachine.transition === "function") {
      ok = loop.stateMachine.transition(state, next, { runId, from, to: next, ...payload });
    } else if (state && typeof state === "object") {
      if ("status" in state) state.status = next;
      else if ("state" in state) state.state = next;
      else state.status = next;
    }

    if (!ok) {
      throw new Error(`${loop.stageName} phase transition rejected: ${from} -> ${next}`);
    }

    const emitFn = emit || loop.emit || loop.eventBus?.emit;
    if (typeof emitFn === "function") {
      emitFn(eventName || `${loop.stageName}.phase.transition`, {
        actor: loop.actor,
        status: "progress",
        payload: { runId, from, to: next, ...payload },
      });
    }

    return next;
  }
}
