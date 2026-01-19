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
  // Prefer import.meta.env (Vite/modern bundlers)
  try {
    // @ts-ignore - import.meta.env may not exist
    if (typeof import.meta !== "undefined" && import.meta.env && typeof import.meta.env === "object") {
      return /** @type {Record<string, string | undefined>} */ (import.meta.env);
    }
  } catch {
    // import.meta not supported
  }
  // Fallback to globalThis.process.env (Node.js or bundler polyfill)
  const proc = /** @type {any} */ (globalThis).process;
  if (proc && typeof proc === "object" && proc.env && typeof proc.env === "object") {
    return proc.env;
  }
  return null;
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
  /** @type {any} */ (err).code = 124;
  if (ms) /** @type {any} */ (err).timeoutMs = ms;
  return err;
}

// Hard timeout: aborts via AbortController and rejects with exit-code-like 124 on timeout.
function withHardTimeout(promiseFactory, timeoutMs, signal) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  const controller = new AbortController();

  let didTimeout = false;
  let timeoutId = null;
  let removeOuterAbortListener = null;

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
        controller.abort("TIMEOUT");
      } catch {
        controller.abort();
      }
    }, ms);
  }

  let removeControllerAbortListener = null;
  const abortPromise = new Promise((_, reject) => {
    const onAbort = () => {
      reject(didTimeout ? makeTimeoutError(ms) : abortErrorFromSignal(controller.signal));
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
	      const { timeoutMs: _timeoutMs, signal: _signal, ...forwardOpts } = opts;
	      debugLog("[design.model] call via ModelRouter", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      await flushBeforeCall();
      const hintedMessages = injectSystemHint(messages, systemHint);
      return withHardTimeout(
        (hardSignal) => baseCall(hintedMessages, { ...forwardOpts, ...(hardSignal ? { signal: hardSignal } : {}) }),
        timeoutMs,
        signal
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
	      const { timeoutMs: _timeoutMs, signal: _signal, ...forwardOpts } = opts;
	      debugLog("[design.model] call via aiApiService.chat", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      await flushBeforeCall();
      const hintedMessages = injectSystemHint(messages, systemHint);
      return withHardTimeout(
        (hardSignal) => baseCall(hintedMessages, { ...forwardOpts, ...(hardSignal ? { signal: hardSignal } : {}) }),
        timeoutMs,
        signal
      );
    };
  }

  return null;
}
