/**
 * Design stage model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 *
 * Notes:
 * - Default usage is "designer" (can override to "brainstorm", "refiner", etc.).
 * - Adds a hard timeout via AbortController (default 120s, configurable by env).
 */

import { injectSystemHint } from "../../shared/index.js";

// Re-export for backward compatibility
export { isNonRetryableError } from "./shared/error-classifier.js";

/**
 * Environment adapter - reads env vars from globalThis.process.env or import.meta.env.
 * Falls back gracefully when neither is available (browser without polyfill).
 * @returns {Record<string, string | undefined> | null}
 */
function getEnvAdapter() {
  /** @type {Record<string, string | undefined> | null} */
  let importMetaEnv = null;
  try {
    // @ts-ignore - import.meta.env may not exist
    if (typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env === "object") {
      importMetaEnv = /** @type {Record<string, string | undefined>} */ (
        (/** @type {{ env: Record<string, string | undefined> }} */ (/** @type {unknown} */ (import.meta))).env
      );
    }
  } catch {
    // import.meta not supported
  }
  // globalThis.process.env (Node.js or bundler polyfill)
  const proc = /** @type {{ env?: Record<string, string | undefined> } | undefined} */ (
    /** @type {Record<string, unknown>} */ (globalThis).process
  );
  if (proc && typeof proc === "object" && proc.env && typeof proc.env === "object") {
    // In Node/Vitest, process.env is mutable and should override import.meta.env.
    if (importMetaEnv) return { ...importMetaEnv, ...proc.env };
    return proc.env;
  }
  return importMetaEnv;
}

/**
 * Error class for non-retryable errors (config missing, auth failed, etc.)
 */
export class NonRetryableError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "NonRetryableError";
    this.nonRetryable = true;
  }
}

import { toNonEmptyString } from "./shared/design-utils.js";

const DEFAULT_TIMEOUT_MS = 120_000;

let injectedLogger = null;

/**
 * @param {((message: string, meta?: any) => void) | { debug?: Function } | null | undefined} loggerFn
 * @returns {void}
 */
export function setLogger(loggerFn) {
  if (loggerFn == null) {
    injectedLogger = null;
    return;
  }
  if (typeof loggerFn === "function") {
    injectedLogger = loggerFn;
    return;
  }
  // Support logger-like objects (debug/info/warn/error) used elsewhere in the repo.
  if (typeof loggerFn === "object" && typeof loggerFn.debug === "function") {
    injectedLogger = (msg, meta) => loggerFn.debug(msg, meta);
    return;
  }
  throw new TypeError("setLogger(loggerFn): loggerFn must be a function or logger-like object");
}

function isTruthyEnvFlag(value) {
  if (value === undefined || value === null) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  return !["0", "false", "no", "off"].includes(s);
}

function isProductionEnv() {
  const env = getEnvAdapter();
  const nodeEnv = env && typeof env.NODE_ENV === "string" ? env.NODE_ENV : "";
  return String(nodeEnv).trim().toLowerCase() === "production";
}

function isDebugEnabled() {
  if (isProductionEnv()) return false;
  const env = getEnvAdapter();
  return isTruthyEnvFlag(env?.DEBUG_DESIGN_MODEL);
}

function resolveDefaultLoggerFn() {
  if (isProductionEnv()) return null;
  const c = typeof console !== "undefined" ? console : null;
  return typeof c?.log === "function" ? c.log.bind(c) : null;
}

function debugLog(message, meta) {
  if (!isDebugEnabled()) return;
  const loggerFn = injectedLogger || resolveDefaultLoggerFn();
  if (!loggerFn) return;
  loggerFn(message, meta);
}

function abortErrorFromSignal(signal) {
  const reason = signal?.reason;
  const msg =
    typeof reason === "string" && reason.trim()
      ? reason
      : reason instanceof Error && reason.message
        ? reason.message
        : "Run cancelled";
  const err = new Error(msg);
  err.name = "AbortError";
  return err;
}

function readEnvTimeoutMs() {
  const env = getEnvAdapter();
  const raw = env?.DESIGN_MODEL_TIMEOUT_MS;
  const s = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
  if (!s) return DEFAULT_TIMEOUT_MS;
  const n = Number(s);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(0, Math.floor(n));
}

function makeTimeoutError(timeoutMs) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  const err = new Error(ms ? `LLM call timeout after ${ms}ms` : "LLM call timeout");
  err.name = "TimeoutError";
  const e = /** @type {Error & { code?: number, timeoutMs?: number }} */ (err);
  e.code = 124;
  if (ms) e.timeoutMs = ms;
  return err;
}

/**
 * @typedef {object} HardTimeoutHooks
 * @property {(info: { timeoutMs: number, abortRequested?: boolean }) => void} [onTimeout]
 * @property {(info: { reason?: unknown, timeout?: boolean, timeoutMs?: number }) => void} [onAbort]
 * @property {(info: { settled?: "fulfilled" | "rejected", timeoutMs?: number }) => void} [onLateSettle]
 */

// Hard timeout: aborts via AbortController and rejects with exit-code-like 124 on timeout.
/**
 * @param {(signal: AbortSignal) => Promise<unknown>} promiseFactory
 * @param {number} timeoutMs
 * @param {AbortSignal | null | undefined} signal
 * @param {HardTimeoutHooks} [hooks]
 */
function withHardTimeout(promiseFactory, timeoutMs, signal, { onTimeout, onAbort, onLateSettle } = {}) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  const controller = new AbortController();

  let didTimeout = false;
  let timeoutId = null;
  let removeOuterAbortListener = null;
  const notifyTimeout = typeof onTimeout === "function" ? onTimeout : null;
  const notifyAbort = typeof onAbort === "function" ? onAbort : null;
  const notifyLateSettle = typeof onLateSettle === "function" ? onLateSettle : null;
  let lateSettledNotified = false;

  const outerSignal = signal;
  const onOuterAbort =
    outerSignal && typeof outerSignal.addEventListener === "function"
      ? () => {
          try {
            controller.abort(outerSignal.reason);
          } catch {
            // Ignore double-abort or unsupported abort reason.
            controller.abort();
          }
        }
      : null;

  if (outerSignal?.aborted) {
    onOuterAbort?.();
  } else if (onOuterAbort) {
    outerSignal.addEventListener("abort", onOuterAbort);
    removeOuterAbortListener = () => outerSignal.removeEventListener("abort", onOuterAbort);
  }

  if (ms > 0) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      try {
        notifyTimeout?.({ timeoutMs: ms, abortRequested: true });
      } catch {
        // ignore callback errors
      }
      try {
        controller.abort("TIMEOUT");
      } catch {
        controller.abort();
      }
    }, ms);
  }

  let removeControllerAbortListener = null;
  const abortPromise = new Promise((_, reject) => {
    const onAbort = () => {
      const err = didTimeout ? makeTimeoutError(ms) : abortErrorFromSignal(controller.signal);
      if (didTimeout) {
        const timeoutErr = /** @type {Error & { timedOut?: boolean, abortRequested?: boolean, mayContinueInBackground?: boolean }} */ (err);
        timeoutErr.timedOut = true;
        timeoutErr.abortRequested = true;
        timeoutErr.mayContinueInBackground = true;
      }
      try {
        notifyAbort?.({
          reason: controller.signal?.reason,
          timeout: didTimeout,
          timeoutMs: ms,
        });
      } catch {
        // ignore callback errors
      }
      reject(err);
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort);
    removeControllerAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
  });

  const callPromise =
    typeof promiseFactory === "function"
      ? Promise.resolve().then(() => promiseFactory(controller.signal))
      : Promise.resolve(promiseFactory);

  callPromise.finally(() => {
    if (!didTimeout || lateSettledNotified) return;
    lateSettledNotified = true;
    try {
      notifyLateSettle?.({ timeoutMs: ms });
    } catch {
      // ignore callback errors
    }
  });

  return Promise.race([callPromise, abortPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
    removeOuterAbortListener?.();
    removeControllerAbortListener?.();
  });
}

export function getDesignModelCaller(stageApi, options = {}) {
  // 优先级：
  // 1. stageApi.modelRouter (如果有)
  // 2. stageApi.aiApiService (包装为兼容接口)

  const usage = toNonEmptyString(options?.usage) || "designer";
  const defaultTimeoutMs = Number.isFinite(options?.timeoutMs)
    ? Math.max(0, Math.floor(options.timeoutMs))
    : readEnvTimeoutMs();
  const systemHint = stageApi?.runtimeHints?.system;

  // Sync barrier: flush any pending compression before model call to avoid context overflow race.
  const flushBeforeCall = async () => {
    if (typeof stageApi?.flushCompression === "function") {
      await stageApi.flushCompression();
    }
  };

  const routerCall = stageApi?.modelRouter?.call;
	  if (typeof routerCall === "function") {
	    const legacySignature = routerCall.length >= 2;
	    const baseCall = legacySignature
	      ? (messages, opts = {}) => stageApi.modelRouter.call(messages, { usage, ...(opts && typeof opts === "object" ? opts : {}) })
	      : (messages, opts = {}) => stageApi.modelRouter.call({ usage, messages, ...(opts && typeof opts === "object" ? opts : {}) });

	    return async (messages, callOptions = {}) => {
	      /** @type {Record<string, any> & { timeoutMs?: number, signal?: AbortSignal }} */
	      const opts = callOptions && typeof callOptions === "object" ? callOptions : {};
	      const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, Math.floor(opts.timeoutMs)) : defaultTimeoutMs;
	      const signal = opts.signal || stageApi?.signal || options?.signal;
	      const {
	        timeoutMs: _timeoutMs,
	        signal: _signal,
	        onTimeout,
	        onAbort,
	        onLateSettle,
	        ...forwardOpts
	      } = opts;
	      debugLog("[design.model] call via ModelRouter", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      await flushBeforeCall();
      const hintedMessages = injectSystemHint(messages, systemHint);
      return withHardTimeout(
        (hardSignal) => baseCall(hintedMessages, { ...forwardOpts, ...(hardSignal ? { signal: hardSignal } : {}) }),
        timeoutMs,
        signal,
        {
          onTimeout: typeof onTimeout === "function"
            ? onTimeout
            : () => debugLog("[design.model] timeout reached (request may continue in background)", { usage, timeoutMs }),
          onAbort,
          onLateSettle,
        }
      );
    };
  }

  const chat = stageApi?.aiApiService?.chat;
	  if (typeof chat === "function") {
	    const baseCall = (messages, opts = {}) =>
	      stageApi.aiApiService.chat({ messages, usage, ...(opts && typeof opts === "object" ? opts : {}) });

	    return async (messages, callOptions = {}) => {
	      /** @type {Record<string, any> & { timeoutMs?: number, signal?: AbortSignal }} */
	      const opts = callOptions && typeof callOptions === "object" ? callOptions : {};
	      const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, Math.floor(opts.timeoutMs)) : defaultTimeoutMs;
	      const signal = opts.signal || stageApi?.signal || options?.signal;
	      const {
	        timeoutMs: _timeoutMs,
	        signal: _signal,
	        onTimeout,
	        onAbort,
	        onLateSettle,
	        ...forwardOpts
	      } = opts;
	      debugLog("[design.model] call via aiApiService.chat", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      await flushBeforeCall();
      const hintedMessages = injectSystemHint(messages, systemHint);
      return withHardTimeout(
        (hardSignal) => baseCall(hintedMessages, { ...forwardOpts, ...(hardSignal ? { signal: hardSignal } : {}) }),
        timeoutMs,
        signal,
        {
          onTimeout: typeof onTimeout === "function"
            ? onTimeout
            : () => debugLog("[design.model] timeout reached (request may continue in background)", { usage, timeoutMs }),
          onAbort,
          onLateSettle,
        }
      );
    };
  }

  return null;
}
