import { toNonEmptyString } from "../../shared/utils/value-utils.js";

const runtimeStateBySignal = new WeakMap();

export const LoopRuntimeStatuses = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const LOOP_RUNTIME_TRANSITIONS = Object.freeze({
  [LoopRuntimeStatuses.IDLE]: [LoopRuntimeStatuses.RUNNING, LoopRuntimeStatuses.CANCELLED],
  [LoopRuntimeStatuses.RUNNING]: [
    LoopRuntimeStatuses.PAUSED,
    LoopRuntimeStatuses.COMPLETED,
    LoopRuntimeStatuses.FAILED,
    LoopRuntimeStatuses.CANCELLED,
  ],
  [LoopRuntimeStatuses.PAUSED]: [LoopRuntimeStatuses.RUNNING, LoopRuntimeStatuses.CANCELLED],
  [LoopRuntimeStatuses.COMPLETED]: [],
  [LoopRuntimeStatuses.FAILED]: [],
  [LoopRuntimeStatuses.CANCELLED]: [],
});

function normalizeStatus(value) {
  const s = toNonEmptyString(value);
  if (!s) return LoopRuntimeStatuses.IDLE;
  return Object.values(LoopRuntimeStatuses).includes(s) ? s : LoopRuntimeStatuses.IDLE;
}

function normalizeCursor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return toNonEmptyString(value) ?? null;
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === "object") return { ...value };
  return null;
}

function normalizeHistoryItem(item) {
  const raw = item && typeof item === "object" ? item : {};
  const from = toNonEmptyString(raw.from) ?? null;
  const to = toNonEmptyString(raw.to) ?? null;

  let timestamp = raw.timestamp;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) timestamp = new Date(timestamp).toISOString();
  timestamp = toNonEmptyString(timestamp) ?? new Date().toISOString();

  return { from, to, timestamp };
}

export class LoopRuntimeState {
  constructor({ status, cursor, pausedReason, lastCheckpointId, statusHistory } = {}) {
    this.status = normalizeStatus(status);
    this.cursor = normalizeCursor(cursor);
    this.pausedReason = toNonEmptyString(pausedReason) ?? null;
    this.lastCheckpointId = toNonEmptyString(lastCheckpointId) ?? null;
    this.statusHistory = Array.isArray(statusHistory) ? statusHistory.map(normalizeHistoryItem) : [];
  }

  canTransition(to) {
    const target = normalizeStatus(to);
    const allowed = LOOP_RUNTIME_TRANSITIONS[this.status] || [];
    return allowed.includes(target);
  }

  transitionTo(to, { timestamp } = {}) {
    const target = normalizeStatus(to);
    if (!this.canTransition(target)) {
      throw new Error(`Invalid runtime transition: ${this.status} -> ${target}`);
    }

    let ts = timestamp;
    if (typeof ts === "number" && Number.isFinite(ts)) ts = new Date(ts).toISOString();
    ts = toNonEmptyString(ts) ?? new Date().toISOString();

    this.statusHistory.push({ from: this.status, to: target, timestamp: ts });
    this.status = target;
    return target;
  }

  toJSON() {
    return {
      status: this.status,
      cursor: this.cursor,
      pausedReason: this.pausedReason,
      lastCheckpointId: this.lastCheckpointId,
      statusHistory: this.statusHistory,
    };
  }

  static fromJSON(payload) {
    const raw = payload && typeof payload === "object" ? payload : {};
    return new LoopRuntimeState({
      status: raw.status,
      cursor: raw.cursor,
      pausedReason: raw.pausedReason,
      lastCheckpointId: raw.lastCheckpointId,
      statusHistory: raw.statusHistory,
    });
  }
}

export function getRuntimeState(signal) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) return null;
  return runtimeStateBySignal.get(signal) || null;
}

export function setRuntimeState(signal, state) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) {
    throw new TypeError("setRuntimeState(signal, state): signal must be an object");
  }
  const runtimeState = state instanceof LoopRuntimeState ? state : new LoopRuntimeState(state);
  runtimeStateBySignal.set(signal, runtimeState);
  return runtimeState;
}

export function ensureRuntimeState(signal, initialState) {
  const existing = getRuntimeState(signal);
  if (existing) return existing;
  return setRuntimeState(signal, initialState);
}

export function clearRuntimeState(signal) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) return;
  runtimeStateBySignal.delete(signal);
}
