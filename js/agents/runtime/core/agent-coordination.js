import { ActorType, OrchestratorState } from "./constants.js";
import { AgentLifecycleEvents } from "../events/events.js";
import { isFailureStopReason } from "./orchestrator-helpers.js";
import { toNonEmptyString } from "../../shared/index.js";

/**
 * Agent coordination and lifecycle methods for AgentOrchestrator.
 * These methods handle agent registration, lifecycle events, and state transitions.
 */
/**
 * @typedef {{
 *   _ensureNotDisposed: () => void,
 *   _childAgents: Set<any>,
 *   runContext?: { mode?: string, scenario?: string, constraints?: unknown },
 *   _services?: unknown,
 *   eventBus: { emit: (event: string, payload: unknown) => void },
 *   _degradationMatrix?: unknown,
 *   registerAgent: (agent: any) => any,
 *   constructor: new (options?: object) => any,
 *   state: string,
 *   signal: AbortSignal,
 *   _abortController: AbortController,
 *   runId?: string,
 *   _emitRunStarted: () => void,
 *   _emitRunFailed: (payload: { error: string }) => void,
 *   _emitRunCancelled: (reason: string) => void,
 *   _emitRunCompleted: (payload: { reason: string }) => void,
 *   _emitRunEnded: (payload: { reason: string }) => void
 * }} AgentCoordinationHost
 */
export const AgentCoordination = {
  /**
   * Register a disposable child agent to be cleaned up when this orchestrator is disposed.
   * @this {AgentCoordinationHost}
   * @param {any} agent
   * @returns {AgentCoordinationHost}
   */
  registerAgent(agent) {
    this._ensureNotDisposed();
    if (agent && typeof agent.dispose === "function") {
      this._childAgents.add(agent);
    }
    return this;
  },

  /**
   * Create a child orchestrator that inherits parent config.
   * Inherits: services, eventBus, degradationMatrix, runContext (mode/scenario/constraints).
   * The child is auto-registered for disposal.
   * @this {AgentCoordinationHost}
   * @param {object} [overrides] - Override any constructor option.
   * @returns {import('./orchestrator-core.js').AgentOrchestrator}
   */
  createChildOrchestrator(overrides = {}) {
    this._ensureNotDisposed();
    const Ctor = /** @type {new (options?: object) => any} */ (this.constructor);
    const child = new Ctor({
      mode: this.runContext?.mode,
      scenario: this.runContext?.scenario,
      constraints: this.runContext?.constraints,
      services: this._services,
      eventBus: this.eventBus,
      degradationMatrix: this._degradationMatrix,
      ...overrides,
    });
    this.registerAgent(child);
    return child;
  },

  /**
   * @this {AgentCoordinationHost}
   * @returns {void}
   */
  start() {
    this._ensureNotDisposed();
    if (this.state === OrchestratorState.RUNNING) return;
    this.state = OrchestratorState.RUNNING;
    this._emitRunStarted();
    this.eventBus.emit(AgentLifecycleEvents.BUSY, { actor: ActorType.SYSTEM, status: "busy", payload: { runId: this.runId } });
  },

  /**
   * @this {AgentCoordinationHost}
   * @param {any} [reason]
   * @returns {void}
   */
  stop(reason = "cancelled") {
    this._ensureNotDisposed();
    if (this.signal.aborted) return;
    const r = toNonEmptyString(reason) || "cancelled";
    const isFailure = isFailureStopReason(r);

    this.state = isFailure ? OrchestratorState.FAILED : OrchestratorState.CANCELLED;
    this._abortController.abort(r);
    if (isFailure) this._emitRunFailed({ error: r });
    else this._emitRunCancelled(r);
    this._emitRunEnded({ reason: r });
    this.eventBus.emit(AgentLifecycleEvents.STOPPED, { actor: ActorType.SYSTEM, status: "stopped", payload: { reason: r, runId: this.runId } });
  },

  /**
   * @this {AgentCoordinationHost}
   * @param {any} [reason]
   * @returns {void}
   */
  end(reason = "completed") {
    this._ensureNotDisposed();
    if (this.state === OrchestratorState.ENDED) return;
    if (this.state === OrchestratorState.RUNNING) {
      this.state = OrchestratorState.ENDED;
      this._emitRunCompleted({ reason });
      this._emitRunEnded({ reason });
      this.eventBus.emit(AgentLifecycleEvents.STOPPED, { actor: ActorType.SYSTEM, status: "stopped", payload: { reason, runId: this.runId } });
      return;
    }
    this.state = OrchestratorState.ENDED;
  },

  /**
   * @returns {void}
   */
  _emitRunStarted() {
    this._ensureNotDisposed();
    if (this._runStarted) return;
    this._runStarted = true;
    // P0: 统一事件命名为 run:started（兼容旧 run.started）
    const startedRecord = {
      actor: ActorType.SYSTEM,
      status: "started",
      payload: {
        runId: this.runId,
        mode: this.runContext.mode,
        scenario: this.runContext.scenario,
      },
    };
    this.emit("run:started", startedRecord);
  },

  /**
   * @param {any} reason
   * @returns {void}
   */
  _emitRunCancelled(reason) {
    this._ensureNotDisposed();
    if (this._runCancelled) return;
    this._runCancelled = true;
    // P0: 统一事件命名为 run:cancelled（兼容旧 run.cancelled）
    const cancelledRecord = {
      actor: ActorType.SYSTEM,
      status: "cancelled",
      payload: { reason: toNonEmptyString(reason) || "cancelled", runId: this.runId },
    };
    this.emit("run:cancelled", cancelledRecord);
  },

  /**
   * @param {{ error?: any, stage?: string } | undefined} [options]
   * @returns {void}
   */
  _emitRunFailed({ error, stage } = {}) {
    this._ensureNotDisposed();
    if (this._runFailed) return;
    this._runFailed = true;
    const message = toNonEmptyString(error) || "Unknown error";
    // P0: 统一事件命名为 run:failed（兼容旧 run.failed）
    const failedRecord = {
      actor: ActorType.SYSTEM,
      status: "failed",
      payload: {
        runId: this.runId,
        error: message,
        ...(toNonEmptyString(stage) ? { stage: toNonEmptyString(stage) } : {}),
      },
    };
    this.emit("run:failed", failedRecord);
  },

  /**
   * @param {{ reason?: any } | undefined} [options]
   * @returns {void}
   */
  _emitRunCompleted({ reason } = {}) {
    this._ensureNotDisposed();
    if (this._runCompleted) return;
    this._runCompleted = true;
    const r = toNonEmptyString(reason) || "completed";
    // P0: 统一事件命名为 run:completed（兼容旧 run.completed）
    const completedRecord = { actor: ActorType.SYSTEM, status: "completed", payload: { reason: r, runId: this.runId } };
    this.emit("run:completed", completedRecord);
  },

  /**
   * @param {{ reason?: any } | undefined} [options]
   * @returns {void}
   */
  _emitRunEnded({ reason } = {}) {
    this._ensureNotDisposed();
    if (this._runEnded) return;
    this._runEnded = true;
    const r = toNonEmptyString(reason);
    // P0: 统一事件命名为 run:ended（兼容旧 run.ended）
    const endedRecord = {
      actor: ActorType.SYSTEM,
      status: "ended",
      ...(r ? { payload: { reason: r, runId: this.runId } } : { payload: { runId: this.runId } }),
    };
    this.emit("run:ended", endedRecord);
  },
};
