import { toNonEmptyString } from "../../shared/utils/value-utils.js";

export class StageTimeoutError extends Error {
  constructor(message, { stageName, timeoutMs } = {}) {
    super(message);
    this.name = "StageTimeoutError";
    this.stageName = stageName;
    this.timeoutMs = timeoutMs;
  }
}

export class StageCancelledError extends Error {
  constructor(message, { stageName } = {}) {
    super(message);
    this.name = "StageCancelledError";
    this.stageName = stageName;
  }
}

export class StagePausedError extends Error {
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

export function abortReasonToMessage(reason, fallback = "Run cancelled") {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  return fallback;
}

export function cancelledErrorFromSignal(signal, stageName) {
  const message = abortReasonToMessage(signal?.reason);
  return new StageCancelledError(message, { stageName });
}

export function toErrorPayload(err, { includeStack = true } = {}) {
  if (!err) {
    return { message: "Unknown error", name: "Error" };
  }

  if (err instanceof Error) {
    const payload = {
      message: toNonEmptyString(err.message) ?? "Error",
      name: toNonEmptyString(err.name) ?? "Error",
    };

    // 保留堆栈信息（默认启用）
    if (includeStack && typeof err.stack === "string" && err.stack) {
      payload.stack = err.stack;
    }

    // 保留 cause 链（递归处理）
    if (err.cause) {
      payload.cause = toErrorPayload(err.cause, { includeStack });
    }

    if (typeof err.stageName === "string" && err.stageName) payload.stageName = err.stageName;
    if (typeof err.timeoutMs === "number" && Number.isFinite(err.timeoutMs)) payload.timeoutMs = err.timeoutMs;
    if (typeof err.checkpointId === "string" && err.checkpointId) payload.checkpointId = err.checkpointId;
    if (typeof err.reason === "string" && err.reason) payload.reason = err.reason;
    if (typeof err.timestamp === "string" && err.timestamp) payload.timestamp = err.timestamp;
    if (typeof err.runId === "string" && err.runId) payload.runId = err.runId;
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
