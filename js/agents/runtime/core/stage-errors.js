import { toNonEmptyString } from "../../shared/index.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {object} StageTimeoutOptions
 * @property {string} [stageName]
 * @property {number} [timeoutMs]
 *
 * @typedef {object} StageCancelledOptions
 * @property {string} [stageName]
 *
 * @typedef {object} StagePausedOptions
 * @property {string | null} [checkpointId]
 * @property {string | null} [reason]
 * @property {string | number | null} [timestamp]
 * @property {string | null} [runId]
 *
 * @typedef {object} StagePausedErrorJSON
 * @property {string} [name]
 * @property {string} [message]
 * @property {string | null} [checkpointId]
 * @property {string | null} [reason]
 * @property {string | number | null} [timestamp]
 * @property {string | null} [runId]
 *
 * @typedef {object} ErrorPayload
 * @property {string} message
 * @property {string} name
 * @property {string} [stack]
 * @property {ErrorPayload} [cause]
 * @property {string} [stageName]
 * @property {number} [timeoutMs]
 * @property {string} [checkpointId]
 * @property {string} [reason]
 * @property {string} [timestamp]
 * @property {string} [runId]
 * @property {string} [code]
 * @property {number} [status]
 * @property {boolean} [retryable]
 * @property {string} [category]
 * @property {Record<string, any>} [context]
 *
 * @typedef {Error & {
 *   stageName?: string;
 *   timeoutMs?: number;
 *   checkpointId?: string;
 *   reason?: string;
 *   timestamp?: string;
 *   runId?: string;
 *   code?: string;
 *   status?: number;
 *   retryable?: boolean;
 *   category?: string;
 *   context?: Record<string, any>;
 * }} StageErrorLike
 */

export class StageTimeoutError extends Error {
  /**
   * @param {string} message
   * @param {StageTimeoutOptions} [options]
   */
  constructor(message, { stageName, timeoutMs } = {}) {
    super(message);
    this.name = "StageTimeoutError";
    this.stageName = stageName;
    this.timeoutMs = timeoutMs;
  }
}

export class StageCancelledError extends Error {
  /**
   * @param {string} message
   * @param {StageCancelledOptions} [options]
   */
  constructor(message, { stageName } = {}) {
    super(message);
    this.name = "StageCancelledError";
    this.stageName = stageName;
  }
}

export class StagePausedError extends Error {
  /**
   * @param {string} [message]
   * @param {StagePausedOptions} [options]
   */
  constructor(message = "Run paused", { checkpointId, reason, timestamp, runId } = {}) {
    super(message);
    this.name = "StagePausedError";
    this.checkpointId = toNonEmptyString(checkpointId) ?? null;
    this.reason = toNonEmptyString(reason) ?? null;

    let resolvedTimestamp = timestamp;
    if (typeof resolvedTimestamp === "number" && Number.isFinite(resolvedTimestamp)) {
      resolvedTimestamp = new Date(resolvedTimestamp).toISOString();
    }
    this.timestamp = toNonEmptyString(resolvedTimestamp) ?? new Date().toISOString();
    this.runId = toNonEmptyString(runId) ?? null;
  }

  /** @returns {StagePausedErrorJSON} */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      checkpointId: this.checkpointId,
      reason: this.reason,
      timestamp: this.timestamp,
      runId: this.runId,
    };
  }

  /**
   * @param {StagePausedErrorJSON | null | undefined} payload
   * @returns {StagePausedError}
   */
  static fromJSON(payload) {
    const raw = payload && typeof payload === "object" ? payload : {};
    const message = toNonEmptyString(raw.message) ?? "Run paused";
    const checkpointId = toNonEmptyString(raw.checkpointId) ?? null;
    const reason = toNonEmptyString(raw.reason) ?? null;
    const runId = toNonEmptyString(raw.runId) ?? null;

    let timestamp = raw.timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) timestamp = new Date(timestamp).toISOString();
    timestamp = toNonEmptyString(timestamp) ?? new Date().toISOString();

    return new StagePausedError(message, { checkpointId, reason, timestamp, runId });
  }
}

/**
 * @param {unknown} reason
 * @param {string} [fallback]
 * @returns {string}
 */
export function abortReasonToMessage(reason, fallback = "Run cancelled") {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  return fallback;
}

/**
 * @param {AbortSignal | null | undefined} signal
 * @param {string | null | undefined} stageName
 * @returns {StageCancelledError}
 */
export function cancelledErrorFromSignal(signal, stageName) {
  const message = abortReasonToMessage(signal?.reason);
  return new StageCancelledError(message, { stageName });
}

/**
 * @param {unknown} err
 * @param {{ includeStack?: boolean }} [options]
 * @returns {ErrorPayload}
 */
export function toErrorPayload(err, { includeStack = false } = {}) {
  if (!err) {
    return { message: "Unknown error", name: "Error" };
  }

  if (err instanceof Error) {
    /** @type {StageErrorLike} */
    const stageErr = err;

    const payload = {
      message: toNonEmptyString(err.message) ?? "Error",
      name: toNonEmptyString(err.name) ?? "Error",
    };

    // 保留堆栈信息（默认关闭）
    if (includeStack && typeof err.stack === "string" && err.stack) {
      const stack = err.stack;
      payload.stack = stack.length > 4000 ? `${stack.slice(0, 4000)}...` : stack;
    }

    // 保留 cause 链（递归处理）
    if (err.cause) {
      payload.cause = toErrorPayload(err.cause, { includeStack });
    }

    // 保留 Stage 相关字段
    if (typeof stageErr.stageName === "string" && stageErr.stageName) payload.stageName = stageErr.stageName;
    if (typeof stageErr.timeoutMs === "number" && Number.isFinite(stageErr.timeoutMs)) payload.timeoutMs = stageErr.timeoutMs;
    if (typeof stageErr.checkpointId === "string" && stageErr.checkpointId) payload.checkpointId = stageErr.checkpointId;
    if (typeof stageErr.reason === "string" && stageErr.reason) payload.reason = stageErr.reason;
    if (typeof stageErr.timestamp === "string" && stageErr.timestamp) payload.timestamp = stageErr.timestamp;
    if (typeof stageErr.runId === "string" && stageErr.runId) payload.runId = stageErr.runId;

    // P0: 保留错误分类与可重试性字段
    if (typeof stageErr.code === "string" && stageErr.code) payload.code = stageErr.code;
    if (typeof stageErr.status === "number" && Number.isFinite(stageErr.status)) payload.status = stageErr.status;
    if (typeof stageErr.retryable === "boolean") payload.retryable = stageErr.retryable;
    if (typeof stageErr.category === "string" && stageErr.category) payload.category = stageErr.category;

    // P0: 保留错误上下文（限制大小）
    if (stageErr.context && typeof stageErr.context === "object" && !Array.isArray(stageErr.context)) {
      try {
        const contextStr = JSON.stringify(stageErr.context);
        if (contextStr.length <= 2000) {
          payload.context = stageErr.context;
        }
      } catch {
        // 忽略无法序列化的 context
      }
    }

    return payload;
  }

  const message = toNonEmptyString(err) ?? String(err);
  return {
    message,
    name: "Error",
  };
}

/**
 * 从 payload 重建 Error 对象（用于跨边界恢复）
 * @param {ErrorPayload | AnyRecord | null | undefined} payload
 * @returns {Error}
 */
export function fromErrorPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return new Error("Unknown error");
  }

  const message = toNonEmptyString(payload.message) ?? "Error";
  const name = toNonEmptyString(payload.name) ?? "Error";

  let error;
  if (name === "StageTimeoutError") {
    error = new StageTimeoutError(message, { stageName: payload.stageName, timeoutMs: payload.timeoutMs });
  } else if (name === "StageCancelledError") {
    error = new StageCancelledError(message, { stageName: payload.stageName });
  } else if (name === "StagePausedError") {
    error = StagePausedError.fromJSON(payload);
  } else {
    error = new Error(message);
    error.name = name;
  }

  // 恢复堆栈（如果存在）
  if (typeof payload.stack === "string") {
    error.stack = payload.stack;
  }

  // 恢复 cause 链
  if (payload.cause) {
    error.cause = fromErrorPayload(payload.cause);
  }

  return error;
}
