import { isAbortError as _isAbortError } from "./error-utils.js";

/**
 * @typedef {object} AbortSignalLike
 * @property {boolean} aborted
 * @property {any} [reason]
 * @property {(type: string, listener: (...args: any[]) => void, options?: any) => void} [addEventListener]
 * @property {(type: string, listener: (...args: any[]) => void, options?: any) => void} [removeEventListener]
 *
 * @typedef {{ signal?: AbortSignal | AbortSignalLike | null }} AbortOptions
 */

/**
 * @param {unknown} reason
 * @returns {string}
 */
function toCancellationMessage(reason) {
  if (typeof reason === "string" && reason.trim()) return reason;
  if (reason instanceof Error && typeof reason.message === "string" && reason.message.trim()) return reason.message;
  if (reason && typeof reason === "object" && typeof /** @type {any} */ (reason).message === "string" && /** @type {any} */ (reason).message.trim()) return /** @type {any} */ (reason).message;
  return "Run cancelled";
}

/**
 * @param {AbortSignal | AbortSignalLike | null | undefined} signal
 * @returns {void}
 * @throws {Error} AbortError when aborted
 */
export function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  const error = new Error(toCancellationMessage(reason));
  error.name = "AbortError";
  error.cause = reason;
  throw error;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  return _isAbortError(/** @type {any} */ (err));
}

/**
 * Wrap a function to enforce pre-call cancellation checks via `options.signal`.
 * @template {(...args: any[]) => any} T
 * @param {T} fn
 * @param {string} [context]
 * @returns {(...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>}
 */
export function withCancellation(fn, context = "unknown") {
  if (typeof fn !== "function") throw new TypeError(`withCancellation(${context}): fn must be a function`);
  return async function (...args) {
    const options = args[args.length - 1];
    const signal = options?.signal;
    checkCancelled(signal);
    return fn.apply(this, args);
  };
}

/**
 * Create an AbortSignal linked to a parent (optional) with an optional timeout.
 * @param {AbortSignal | AbortSignalLike | null | undefined} parent
 * @param {number} [timeoutMs]
 * @returns {AbortSignal}
 */
export function createLinkedSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const hasParent = parent && typeof parent === "object" && typeof parent.aborted === "boolean";
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;

  if (hasParent && parent.aborted) {
    controller.abort(parent.reason);
    return controller.signal;
  }

  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
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
