import { toNonEmptyString } from "../../shared/index.js";

/**
 * @typedef {"idle" | "running" | "paused" | "completed" | "failed" | "cancelled"} LoopRuntimeStatus
 */
/**
 * @typedef {string | Array<unknown> | Record<string, unknown> | null} LoopRuntimeCursor
 */
/**
 * @typedef {object} LoopRuntimeStateJSON
 * @property {unknown} [status]
 * @property {unknown} [cursor]
 * @property {unknown} [pausedReason]
 * @property {unknown} [lastCheckpointId]
 * @property {Array<unknown>} [statusHistory]
 */

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

/**
 * @param {unknown} value
 * @returns {LoopRuntimeStatus}
 */
function normalizeStatus(value) {
  const s = toNonEmptyString(value);
  if (!s) return LoopRuntimeStatuses.IDLE;
  return Object.values(LoopRuntimeStatuses).includes(/** @type {LoopRuntimeStatus} */ (s))
    ? /** @type {LoopRuntimeStatus} */ (s)
    : LoopRuntimeStatuses.IDLE;
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
  /**
   * @param {object} [param0]
   * @param {unknown=} param0.status
   * @param {unknown=} param0.cursor
   * @param {unknown=} param0.pausedReason
   * @param {unknown=} param0.lastCheckpointId
   * @param {Array<unknown>=} param0.statusHistory
   */
  constructor({ status, cursor, pausedReason, lastCheckpointId, statusHistory } = {}) {
    this.status = normalizeStatus(status);
    this.cursor = normalizeCursor(cursor);
    this.pausedReason = toNonEmptyString(pausedReason) ?? null;
    this.lastCheckpointId = toNonEmptyString(lastCheckpointId) ?? null;
    this.statusHistory = Array.isArray(statusHistory) ? statusHistory.map(normalizeHistoryItem) : [];
  }

  /**
   * 检查是否可以转换到目标状态
   * @param {unknown} to - 目标状态
   * @returns {boolean} 是否可以转换
   */
  canTransition(to) {
    const target = normalizeStatus(to);
    const allowed = LOOP_RUNTIME_TRANSITIONS[this.status] || [];
    return allowed.includes(target);
  }

  /**
   * @param {unknown} to
   * @param {object} [param1]
   * @param {string|number=} param1.timestamp
   * @returns {LoopRuntimeStatus}
   */
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

  /**
   * 序列化为 JSON 对象
   * @returns {{status: LoopRuntimeStatus, cursor: LoopRuntimeCursor, pausedReason: string|null, lastCheckpointId: string|null, statusHistory: Array<{from: string|null, to: string|null, timestamp: string}>}}
   */
  toJSON() {
    return {
      status: this.status,
      cursor: this.cursor,
      pausedReason: this.pausedReason,
      lastCheckpointId: this.lastCheckpointId,
      statusHistory: this.statusHistory,
    };
  }

  /**
   * 从 JSON 对象反序列化
   * @param {LoopRuntimeStateJSON | null | undefined} payload - JSON 对象
   * @returns {LoopRuntimeState} 新的 LoopRuntimeState 实例
   */
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

/**
 * 获取与 signal 关联的运行时状态
 * @param {object|Function} signal - WeakMap 键（通常是 AbortSignal 或对象）
 * @returns {LoopRuntimeState|null} 关联的运行时状态，不存在时返回 null
 */
export function getRuntimeState(signal) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) return null;
  return runtimeStateBySignal.get(signal) || null;
}

/**
 * 设置与 signal 关联的运行时状态
 * @param {object|Function} signal - WeakMap 键（通常是 AbortSignal 或对象）
 * @param {LoopRuntimeState|object} state - 运行时状态或初始化参数
 * @returns {LoopRuntimeState} 设置的运行时状态
 * @throws {TypeError} signal 必须是对象
 */
export function setRuntimeState(signal, state) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) {
    throw new TypeError("setRuntimeState(signal, state): signal must be an object");
  }
  const runtimeState = state instanceof LoopRuntimeState ? state : new LoopRuntimeState(state);
  runtimeStateBySignal.set(signal, runtimeState);
  return runtimeState;
}

/**
 * 确保存在与 signal 关联的运行时状态（不存在时创建）
 * @param {object|Function} signal - WeakMap 键（通常是 AbortSignal 或对象）
 * @param {object} [initialState] - 初始状态参数
 * @returns {LoopRuntimeState} 现有或新创建的运行时状态
 */
export function ensureRuntimeState(signal, initialState) {
  const existing = getRuntimeState(signal);
  if (existing) return existing;
  return setRuntimeState(signal, initialState);
}

/**
 * 清除与 signal 关联的运行时状态
 * @param {object|Function} signal - WeakMap 键（通常是 AbortSignal 或对象）
 * @returns {void}
 */
export function clearRuntimeState(signal) {
  if (!signal || (typeof signal !== "object" && typeof signal !== "function")) return;
  runtimeStateBySignal.delete(signal);
}
