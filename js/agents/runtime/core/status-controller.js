/**
 * StatusController - 状态机和暂停/恢复管理
 *
 * 从 BaseAgentLoop 提取的职责：
 * - Loop 状态管理 (IDLE, RUNNING, PAUSED, COMPLETED, FAILED)
 * - 状态转换验证
 * - 暂停/恢复控制
 */

import { AgentStatus, isValidAgentStatus } from "./agent-status.js";
import { StagePausedError } from "./stage-errors.js";
import { getRuntimeState } from "../telemetry/loop-runtime-state.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/core/status-controller");

const DEFAULT_LOOP_STATUS_TRANSITIONS = Object.freeze({
  [AgentStatus.IDLE]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.RUNNING]: [AgentStatus.PAUSED, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.PAUSED]: [AgentStatus.RUNNING, AgentStatus.COMPLETED, AgentStatus.FAILED],
  [AgentStatus.COMPLETED]: [AgentStatus.IDLE],
  [AgentStatus.FAILED]: [AgentStatus.IDLE],
});

function isAllowedLoopStatusTransition(from, to, meta = {}) {
  if (meta && typeof meta === "object") {
    if (meta.force) return true;
    if (meta.allowReset && to === AgentStatus.IDLE) return true;
  }
  if (!isValidAgentStatus(from) || !isValidAgentStatus(to)) return true;
  const allowed = DEFAULT_LOOP_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function parseBooleanish(value) {
  if (value === true || value === false) return value;
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "on", "enabled"].includes(s)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(s)) return false;
  return undefined;
}

function resolveStrictLoopStatusTransitions(explicit) {
  if (explicit === true || explicit === false) return explicit;

  const env = typeof process !== "undefined" ? process.env : null;
  const fromEnv = parseBooleanish(env?.PB_STRICT_LOOP_STATUS_TRANSITIONS);
  if (typeof fromEnv === "boolean") return fromEnv;

  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("pb_strictLoopStatusTransitions") : null;
    const fromStorage = parseBooleanish(raw);
    if (typeof fromStorage === "boolean") return fromStorage;
  } catch {}

  return true;
}

export class StatusController {
  constructor(options = {}) {
    this._loopStatus = options.status || AgentStatus.IDLE;
    this._loopMachine = options.machine || null;
    this._loopEventName = options.eventName || null;
    this._strictLoopStatusTransitions = resolveStrictLoopStatusTransitions(options.strict);
    this._statusHistory = [];
    this._pauseRequested = false;
    this._pauseReason = null;
    this._logger = options.logger || null;
    this._emit = options.emit || null;
    this._stageName = options.stageName || "agent";
    this._actor = options.actor || "agent";
  }

  get status() {
    return this._loopStatus;
  }

  get isPaused() {
    return this._pauseRequested;
  }

  get pauseReason() {
    return this._pauseReason;
  }

  get statusHistory() {
    return [...this._statusHistory];
  }

  init({ status, machine, eventName, strict } = {}) {
    if (machine) this._loopMachine = machine;
    if (eventName) this._loopEventName = eventName;
    if (status) this._loopStatus = status;
    if (typeof strict === "boolean") this._strictLoopStatusTransitions = strict;
    if (!Array.isArray(this._statusHistory)) this._statusHistory = [];
  }

  pause(reason = "user_requested") {
    this._pauseRequested = true;
    this._pauseReason = reason;
  }

  resume() {
    this._pauseRequested = false;
    this._pauseReason = null;
  }

  transition(newStatus, metadata = {}) {
    const oldStatus = this._loopStatus;
    if (oldStatus === newStatus) return null;

    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const from = oldStatus;
    const to = newStatus;

    let ok = true;
    const machine = this._loopMachine;
    if (machine) {
      try {
        if (typeof machine === "function") ok = machine(from, to, meta) !== false;
        else if (typeof machine.canTransition === "function") ok = machine.canTransition(from, to, meta) !== false;
        else if (typeof machine.transition === "function") ok = machine.transition(from, to, meta) !== false;
      } catch (err) {
        ok = false;
        const message = err instanceof Error ? err.message : String(err);
        this._logger?.warn?.(`[status-controller] loopStatus machine threw: ${message}`);
      }
    } else {
      ok = isAllowedLoopStatusTransition(from, to, meta);
    }

    if (!ok) {
      const strict = typeof meta.strict === "boolean" ? meta.strict : this._strictLoopStatusTransitions;
      const msg = `${this._stageName} loopStatus transition rejected: ${from} -> ${to}`;
      if (strict) throw new Error(msg);
      if (this._logger && typeof this._logger.warn === "function") {
        this._logger.warn(msg);
      } else {
        logger.warn(msg);
      }
      return this._recordTransition({ from: oldStatus, to: newStatus, invalid: true, ...meta });
    }

    return this._recordTransition({ from: oldStatus, to: newStatus, ...meta });
  }

  _recordTransition({ from, to, timestamp, ...meta } = {}) {
    const ts = typeof timestamp === "number" ? timestamp : Date.now();
    const entry = { from, to, timestamp: ts, ...meta };
    this._statusHistory.push(entry);
    this._loopStatus = to;
    this._emitStatusChanged(entry);
    return entry;
  }

  _emitStatusChanged(payload) {
    if (typeof this._emit !== "function") return;
    const name = this._loopEventName || `${this._stageName}.agent.status.changed`;
    this._emit(name, { actor: this._actor, status: "info", payload });
  }

  checkPaused(signal) {
    const runtimeState = getRuntimeState(signal);
    if (!runtimeState) return;
    if (runtimeState.status !== "paused") return;

    throw new StagePausedError("Run paused", {
      checkpointId: runtimeState.lastCheckpointId ?? null,
      reason: runtimeState.pausedReason ?? null,
      timestamp: Date.now(),
    });
  }

  createPauseError({ signal, runId } = {}) {
    const runtimeState = getRuntimeState(signal);
    const reason = runtimeState?.pausedReason || this._pauseReason || null;
    const checkpointId = runtimeState?.lastCheckpointId ?? null;
    return new StagePausedError("Run paused", {
      checkpointId,
      reason,
      timestamp: Date.now(),
      runId,
    });
  }

  shouldPauseFromError(err, signal) {
    const runtimeState = getRuntimeState(signal);
    const pauseRequested = this._pauseRequested || runtimeState?.status === "paused";
    if (!pauseRequested) return false;
    return this._isAbortError(err, signal);
  }

  _isAbortError(err, signal) {
    if (!err) return false;
    if (signal?.aborted) return true;
    const name = err.name || err.code;
    if (name === "AbortError" || name === "CanceledError" || name === "CancelledError") return true;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("cancelled");
  }
}

export default StatusController;
