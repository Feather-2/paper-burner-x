import { toNonEmptyString } from "../shared/value-utils.js";

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

export function abortReasonToMessage(reason, fallback = "Run cancelled") {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  return fallback;
}

export function cancelledErrorFromSignal(signal, stageName) {
  const message = abortReasonToMessage(signal?.reason);
  return new StageCancelledError(message, { stageName });
}

export function toErrorPayload(err) {
  if (!err) {
    return { message: "Unknown error", name: "Error" };
  }

  if (err instanceof Error) {
    const payload = {
      message: toNonEmptyString(err.message) ?? "Error",
      name: toNonEmptyString(err.name) ?? "Error",
    };

    if (typeof err.stageName === "string" && err.stageName) payload.stageName = err.stageName;
    if (typeof err.timeoutMs === "number" && Number.isFinite(err.timeoutMs)) payload.timeoutMs = err.timeoutMs;
    return payload;
  }

  const message = toNonEmptyString(err) ?? String(err);
  return {
    message,
    name: "Error",
  };
}
