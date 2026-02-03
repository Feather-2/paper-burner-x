import { isPlainObject } from "../utils/value-utils.js";
import { estimateTokensCached } from "../utils/token-cache.js";
import { isWasmSupported } from "../utils/wasm-support.js";
import { getGlobalContainer } from "../../core/di/global-container.js";

/**
 * @private
 * @typedef {object} TiktokenEncoder
 * @property {(text: string) => number[] | { length: number }} encode
 * @property {(() => void) | undefined} [free]
 */

/**
 * @private
 * @param {unknown} value
 * @param {(info: TokenCounterLogInfo) => void} onLog
 * @returns {string}
 */
function toText(value, onLog) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog({ level: "warn", message: "[token-counter] JSON.stringify failed; coercing to String()", error: message });
    return String(value);
  }
}

/**
 * @private
 * @param {{ model: string | null, encoding: string | null, tiktoken: { get_encoding: (name: string) => TiktokenEncoder, encoding_for_model: (model: string) => TiktokenEncoder } }} options
 * @returns {TiktokenEncoder}
 */
function pickEncoding({ model, encoding, tiktoken }) {
  const encName = typeof encoding === "string" && encoding.trim() ? encoding.trim() : null;
  if (encName) {
    try {
      return tiktoken.get_encoding(encName);
    } catch {
      // Invalid encoding names are expected; fall back to model/default.
    }
  }

  const modelName = typeof model === "string" && model.trim() ? model.trim() : null;
  if (modelName) {
    try {
      return tiktoken.encoding_for_model(modelName);
    } catch {
      // Unknown model ids are expected; fall back to default.
    }
  }

  // Sensible default for modern chat models.
  try {
    return tiktoken.get_encoding("o200k_base");
  } catch {
    return tiktoken.get_encoding("cl100k_base");
  }
}

/**
 * @private
 * @returns {Promise<{ get_encoding: Function, encoding_for_model: Function, default?: { get_encoding?: Function, encoding_for_model?: Function } }>}
 */
async function loadTiktoken() {
  // Prefer the canonical package name ("tiktoken"); allow legacy alias if present.
  try {
    return await import("tiktoken");
  } catch {
    return await import(/** @type {string} */ ("@dqbd/tiktoken"));
  }
}

/**
 * @private
 * Creates a log handler from options, falling back to console.warn/error.
 * @param {((info: TokenCounterLogInfo) => void) | undefined} onLogOption - User-provided log callback.
 * @returns {(info: TokenCounterLogInfo) => void} Resolved log handler.
 */
function createLogHandler(onLogOption) {
  if (typeof onLogOption === "function") return onLogOption;
  return ({ level, message, error }) => {
    try {
      const c = typeof console !== "undefined" ? console : null;
      const fn = level === "error" ? c?.error : c?.warn;
      if (typeof fn === "function") fn.call(c, message, error ? { error } : undefined);
    } catch {
      // Ignore console failures to avoid recursive logging in constrained environments.
    }
  };
}

/**
 * @private
 * Schedules warmup init based on options.
 * @param {boolean} warmup - Whether to warmup.
 * @param {number} warmupIdleMs - Delay in milliseconds.
 * @param {() => void} triggerInit - Function to trigger init.
 * @returns {ReturnType<typeof setTimeout> | null} Timer id if scheduled.
 */
function scheduleWarmup(warmup, warmupIdleMs, triggerInit) {
  if (!warmup) return null;
  if (warmupIdleMs > 0 && typeof setTimeout === "function") {
    return setTimeout(triggerInit, warmupIdleMs);
  }
  triggerInit();
  return null;
}

/**
 * @private
 * Parses warmup options from raw config.
 * @param {boolean | undefined} warmupRaw - Raw warmup option.
 * @param {number | undefined} warmupIdleMsRaw - Raw warmupIdleMs option.
 * @returns {{ warmup: boolean, warmupIdleMs: number }} Parsed warmup config.
 */
function parseWarmupOptions(warmupRaw, warmupIdleMsRaw) {
  const warmup = warmupRaw === undefined ? true : !!warmupRaw;
  const warmupIdleMs = Number.isFinite(Number(warmupIdleMsRaw)) ? Math.max(0, Math.floor(Number(warmupIdleMsRaw))) : 0;
  return { warmup, warmupIdleMs };
}

/**
 * @private
 * @typedef {object} TokenCounterState
 * @property {TiktokenEncoder | null} encoder
 * @property {"heuristic" | "tiktoken"} mode
 * @property {boolean} ready
 * @property {boolean} failed
 * @property {Promise<boolean> | null} initPromise
 * @property {string | null} lastModel
 * @property {string | null} lastEncoding
 * @property {number} generation
 * @property {ReturnType<typeof setTimeout> | null} warmupTimer
 */

/**
 * Input value accepted by TokenCounter.count().
 * Accepts any value: strings are used directly, null/undefined return 0,
 * objects/arrays are JSON-stringified, other types are coerced via String().
 * @typedef {string | number | boolean | null | undefined | object | unknown[]} TokenCounterInput
 */

/**
 * Status returned by TokenCounter.getStatus().
 * @typedef {object} TokenCounterStatus
 * @property {"heuristic" | "tiktoken"} mode - Current counting mode.
 * @property {boolean} ready - True if tiktoken WASM is initialized and ready.
 * @property {boolean} failed - True if tiktoken init failed permanently.
 */

/**
 * Options for TokenCounter.init() method.
 * @typedef {object} TokenCounterInitOptions
 * @property {string} [model] - Model name for encoding selection (e.g., "gpt-4o").
 * @property {string} [encoding] - Encoding name (e.g., "cl100k_base").
 */

/**
 * Log event info passed to onLog callback.
 * @typedef {object} TokenCounterLogInfo
 * @property {"warn" | "error"} level - Log level.
 * @property {string} message - Log message.
 * @property {string} [error] - Error message if applicable.
 */

/**
 * Options for createAdaptiveTokenCounter().
 * @typedef {object} AdaptiveTokenCounterOptions
 * @property {string} [model] - Model name for encoding selection.
 * @property {string} [encoding] - Encoding name override.
 * @property {boolean} [warmup=true] - Whether to trigger background init immediately.
 * @property {number} [warmupIdleMs=0] - Delay warmup via setTimeout to avoid blocking critical path.
 * @property {(info: TokenCounterLogInfo) => void} [onLog] - Custom log handler.
 */

/**
 * Adaptive token counter interface.
 * @typedef {object} TokenCounter
 * @property {(value: TokenCounterInput) => number} count - Counts tokens synchronously; always returns a non-negative integer.
 * @property {(options?: TokenCounterInitOptions) => Promise<boolean>} init - Best-effort WASM init; resolves true when ready, false on failure.
 * @property {() => void} dispose - Frees WASM resources if allocated; safe to call multiple times.
 * @property {() => TokenCounterStatus} getStatus - Returns current counter status.
 */

/**
 * @private
 * @param {TokenCounterState} state
 * @param {(info: TokenCounterLogInfo) => void} onLog
 * @returns {(options?: TokenCounterInitOptions) => Promise<boolean>}
 */
function createInitHandler(state, onLog) {
  return async ({ model, encoding } = {}) => {
    if (state.failed) return false;
    if (state.ready && state.encoder) return true;
    if (!isWasmSupported()) {
      state.failed = true;
      return false;
    }

    const nextModel = typeof model === "string" && model.trim() ? model : state.lastModel;
    const nextEncoding = typeof encoding === "string" && encoding.trim() ? encoding : state.lastEncoding;
    state.lastModel = nextModel || state.lastModel;
    state.lastEncoding = nextEncoding || state.lastEncoding;

    if (state.initPromise) return state.initPromise;

    const initGeneration = state.generation;
    const promise = Promise.resolve()
      .then(async () => {
        const mod = await loadTiktoken();
        const tiktoken = {
          get_encoding: mod.get_encoding || mod.default?.get_encoding,
          encoding_for_model: mod.encoding_for_model || mod.default?.encoding_for_model,
        };
        if (typeof tiktoken.get_encoding !== "function" || typeof tiktoken.encoding_for_model !== "function") {
          throw new Error("tiktoken: missing get_encoding/encoding_for_model exports");
        }

        const enc = pickEncoding({ model: nextModel, encoding: nextEncoding, tiktoken });
        if (initGeneration !== state.generation) {
          try {
            if (enc && typeof enc.free === "function") enc.free();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onLog({ level: "warn", message: "[token-counter] encoder.free failed after stale init", error: message });
          }
          return false;
        }

        state.encoder = enc;
        state.mode = "tiktoken";
        state.ready = true;
        return true;
      })
      .catch((err) => {
        if (initGeneration !== state.generation) return false;
        state.failed = true;
        state.encoder = null;
        state.mode = "heuristic";
        const message = err instanceof Error ? err.message : String(err);
        onLog({ level: "warn", message: "[token-counter] tiktoken init failed; falling back to heuristic", error: message });
        return false;
      })
      .finally(() => {
        if (state.initPromise === promise) state.initPromise = null;
      });

    state.initPromise = promise;
    return promise;
  };
}

/**
 * @private
 * @param {TokenCounterState} state
 * @param {(info: TokenCounterLogInfo) => void} onLog
 * @returns {() => void}
 */
function createDisposeHandler(state, onLog) {
  return () => {
    state.generation += 1;
    if (state.warmupTimer && typeof clearTimeout === "function") {
      clearTimeout(state.warmupTimer);
    }
    state.warmupTimer = null;

    try {
      if (state.encoder && typeof state.encoder.free === "function") state.encoder.free();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onLog({ level: "warn", message: "[token-counter] encoder.free failed during dispose", error: message });
    } finally {
      state.encoder = null;
      state.ready = false;
      state.mode = "heuristic";
      state.failed = false;
      state.initPromise = null;
    }
  };
}

/**
 * @private
 * @param {TokenCounterState} state
 * @param {(options?: TokenCounterInitOptions) => Promise<boolean>} init
 * @param {(info: TokenCounterLogInfo) => void} onLog
 * @returns {(value: TokenCounterInput) => number}
 */
function createCountHandler(state, init, onLog) {
  return (value) => {
    const text = toText(value, onLog);
    if (!text) return 0;

    if (state.ready && state.encoder) {
      try {
        const tokens = state.encoder.encode(text);
        return Array.isArray(tokens) ? tokens.length : typeof tokens?.length === "number" ? tokens.length : estimateTokensCached(text);
      } catch {
        // If encoding fails (should be rare), fall back safely.
        return estimateTokensCached(text);
      }
    }

    // Kick off WASM init best-effort (no await).
    void init({ model: state.lastModel || undefined, encoding: state.lastEncoding || undefined });
    return estimateTokensCached(text);
  };
}

/**
 * Creates an adaptive token counter that uses heuristic estimation immediately
 * and lazily upgrades to tiktoken (WASM) when supported. Falls back permanently
 * if tiktoken initialization fails.
 *
 * @param {AdaptiveTokenCounterOptions} [options] - Configuration options.
 * @returns {TokenCounter} Token counter instance.
 * @throws {TypeError} If options is not a plain object.
 */
export function createAdaptiveTokenCounter(options = {}) {
  if (!isPlainObject(options)) throw new TypeError("createAdaptiveTokenCounter(options): options must be an object");

  const onLog = createLogHandler(options.onLog);

  /** @type {TokenCounterState} */
  const state = {
    encoder: null,
    mode: "heuristic",
    ready: false,
    failed: false,
    initPromise: null,
    lastModel: typeof options.model === "string" ? options.model : null,
    lastEncoding: typeof options.encoding === "string" ? options.encoding : null,
    generation: 0,
    warmupTimer: null,
  };

  const init = createInitHandler(state, onLog);
  const dispose = createDisposeHandler(state, onLog);
  const count = createCountHandler(state, init, onLog);
  const getStatus = () => ({ mode: state.mode, ready: state.ready, failed: state.failed });

  const { warmup, warmupIdleMs } = parseWarmupOptions(options.warmup, options.warmupIdleMs);
  state.warmupTimer = scheduleWarmup(
    warmup,
    warmupIdleMs,
    () => void init({ model: state.lastModel || undefined, encoding: state.lastEncoding || undefined })
  );

  return { count, init, dispose, getStatus };
}

const TOKEN_COUNTER_SERVICE_ID = "tokenCounter";

/**
 * Shared, process-wide token counter for convenience.
 * @returns {TokenCounter}
 *
 * @deprecated Prefer resolving via DI container (`ServiceId.TOKEN_COUNTER`) or passing an explicit counter instance.
 */
export function getGlobalTokenCounter() {
  const container = getGlobalContainer();
  if (!container.has(TOKEN_COUNTER_SERVICE_ID)) {
    container.register(TOKEN_COUNTER_SERVICE_ID, () => createAdaptiveTokenCounter());
  }
  return container.get(TOKEN_COUNTER_SERVICE_ID);
}

export default { createAdaptiveTokenCounter, getGlobalTokenCounter };
