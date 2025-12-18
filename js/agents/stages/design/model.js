/**
 * Design stage model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 *
 * Notes:
 * - Default usage is "designer" (can override to "brainstorm", "refiner", etc.).
 * - Adds a soft timeout (default 30s) via Promise.race (does not abort underlying fetch if unsupported).
 */

// Error class for non-retryable errors (config missing, auth failed, etc.)
export class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NonRetryableError";
    this.nonRetryable = true;
  }
}

// Check if error should not be retried
export function isNonRetryableError(err) {
  if (!err) return false;
  if (err.nonRetryable === true) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("No available model config") ||
    msg.includes("not available") ||
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("Invalid API key") ||
    msg.includes("authentication")
  );
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function abortErrorFromSignal(signal) {
  const reason = signal?.reason;
  const msg = typeof reason === "string" && reason.trim() ? reason : "Run cancelled";
  const err = new Error(msg);
  err.name = "AbortError";
  return err;
}

function withTimeout(promise, timeoutMs, signal) {
  const ms = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  if (!ms) return promise;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(`LLM call timeout after ${ms}ms`)), ms);
      if (signal?.aborted) {
        clearTimeout(t);
        reject(abortErrorFromSignal(signal));
        return;
      }
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(abortErrorFromSignal(signal));
          },
          { once: true }
        );
      }
    }),
  ]);
}

export function getDesignModelCaller(stageApi, options = {}) {
  // 优先级：
  // 1. stageApi.modelRouter (如果有)
  // 2. stageApi.aiApiService (包装为兼容接口)

  const usage = toNonEmptyString(options?.usage) || "designer";
  const defaultTimeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(0, Math.floor(options.timeoutMs)) : 30_000;

  const routerCall = stageApi?.modelRouter?.call;
  if (typeof routerCall === "function") {
    const legacySignature = routerCall.length >= 2;
    const baseCall = legacySignature
      ? (messages, opts = {}) => stageApi.modelRouter.call(messages, { usage, ...(opts && typeof opts === "object" ? opts : {}) })
      : (messages, opts = {}) => stageApi.modelRouter.call({ usage, messages, ...(opts && typeof opts === "object" ? opts : {}) });

    return async (messages, callOptions = {}) => {
      const opts = callOptions && typeof callOptions === "object" ? callOptions : {};
      const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, Math.floor(opts.timeoutMs)) : defaultTimeoutMs;
      const signal = opts.signal || stageApi?.signal || options?.signal;
      const { timeoutMs: _timeoutMs, ...forwardOpts } = opts;
      console.log("[design.model] call via ModelRouter", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      return withTimeout(baseCall(messages, { ...forwardOpts, ...(signal ? { signal } : {}) }), timeoutMs, signal);
    };
  }

  const chat = stageApi?.aiApiService?.chat;
  if (typeof chat === "function") {
    const baseCall = (messages, opts = {}) =>
      stageApi.aiApiService.chat({ messages, usage, ...(opts && typeof opts === "object" ? opts : {}) });

    return async (messages, callOptions = {}) => {
      const opts = callOptions && typeof callOptions === "object" ? callOptions : {};
      const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(0, Math.floor(opts.timeoutMs)) : defaultTimeoutMs;
      const signal = opts.signal || stageApi?.signal || options?.signal;
      const { timeoutMs: _timeoutMs, signal: _signal, ...forwardOpts } = opts;
      console.log("[design.model] call via aiApiService.chat", { usage, timeoutMs });
      if (signal?.aborted) throw abortErrorFromSignal(signal);
      return withTimeout(baseCall(messages, forwardOpts), timeoutMs, signal);
    };
  }

  return null;
}

