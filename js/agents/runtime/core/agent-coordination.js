import { ActorType, OrchestratorState } from "./constants.js";
import { AgentLifecycleEvents } from "../events/events.js";
import { isFailureStopReason } from "./orchestrator-helpers.js";
import { toNonEmptyString } from "../../shared/index.js";

/**
 * Agent coordination and lifecycle methods for AgentOrchestrator.
 * These methods handle agent registration, lifecycle events, and state transitions.
 */
export const AgentCoordination = {
  /**
   * Register a disposable child agent to be cleaned up when this orchestrator is disposed.
   * @param {any} agent
   * @returns {this}
   */
  registerAgent(agent) {
    this._ensureNotDisposed();
    if (agent && typeof agent.dispose === "function") {
      this._childAgents.add(agent);
    }
    return this;
  },

  /**
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
    // P0: 统一事件命名为 run:started
    this.emit("run:started", {
      actor: ActorType.SYSTEM,
      status: "started",
      payload: {
        runId: this.runId,
        mode: this.runContext.mode,
        scenario: this.runContext.scenario,
      },
    });
  },

  /**
   * @param {any} reason
   * @returns {void}
   */
  _emitRunCancelled(reason) {
    this._ensureNotDisposed();
    if (this._runCancelled) return;
    this._runCancelled = true;
    // P0: 统一事件命名为 run:cancelled
    this.emit("run:cancelled", {
      actor: ActorType.SYSTEM,
      status: "cancelled",
      payload: { reason: toNonEmptyString(reason) || "cancelled", runId: this.runId },
    });
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
    // P0: 统一事件命名为 run:failed
    this.emit("run:failed", {
      actor: ActorType.SYSTEM,
      status: "failed",
      payload: {
        runId: this.runId,
        error: message,
        ...(toNonEmptyString(stage) ? { stage: toNonEmptyString(stage) } : {}),
      },
    });
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
    // P0: 统一事件命名为 run:completed
    this.emit("run:completed", { actor: ActorType.SYSTEM, status: "completed", payload: { reason: r, runId: this.runId } });
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
    // P0: 统一事件命名为 run:ended
    this.emit("run:ended", {
      actor: ActorType.SYSTEM,
      status: "ended",
      ...(r ? { payload: { reason: r, runId: this.runId } } : { payload: { runId: this.runId } }),
    });
  },
};
