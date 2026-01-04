import { isAbortError as _isAbortError } from "./error-utils.js";

function toCancellationMessage(reason) {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  if (reason && typeof reason === "object" && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  return "Run cancelled";
}

export function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  const error = new Error(toCancellationMessage(reason));
  error.name = "AbortError";
  error.cause = reason;
  throw error;
}

export function isAbortError(err) {
  return _isAbortError(err);
}

export function withCancellation(fn, context = "unknown") {
  if (typeof fn !== "function") throw new TypeError(`withCancellation(${context}): fn must be a function`);
  return async function (...args) {
    const options = args[args.length - 1];
    const signal = options?.signal;
    checkCancelled(signal);
    return fn.apply(this, args);
  };
}

export function createLinkedSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const hasParent = parent && typeof parent === "object" && typeof parent.aborted === "boolean";
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;

  if (hasParent && parent.aborted) {
    controller.abort(parent.reason);
    return controller.signal;
  }

  let settled = false;
  let timeoutId = null;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    if (hasParent && typeof parent.removeEventListener === "function") {
      parent.removeEventListener("abort", onParentAbort);
    }
  };

  const settle = (reason) => {
    if (settled) return;
    settled = true;
    cleanup();
    controller.abort(reason);
  };

  const onParentAbort = () => {
    settle(parent.reason);
  };

  if (hasParent && typeof parent.addEventListener === "function") {
    parent.addEventListener("abort", onParentAbort, { once: true });
  }

  if (ms > 0) {
    timeoutId = setTimeout(() => settle("Timeout"), ms);
  }

  // Ensure cleanup if the returned signal is aborted by consumers.
  controller.signal.addEventListener?.("abort", cleanup, { once: true });

  return controller.signal;
}

