import { isPlainObject } from "../utils/value-utils.js";
import { estimateTokensCached } from "../utils/token-cache.js";
import { isWasmSupported } from "../utils/wasm-support.js";
import { getGlobalContainer } from "../../core/di/global-container.js";

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pickEncoding({ model, encoding, tiktoken }) {
  const encName = typeof encoding === "string" && encoding.trim() ? encoding.trim() : null;
  if (encName) {
    try {
      return tiktoken.get_encoding(encName);
    } catch {
      // ignore invalid encoding names
    }
  }

  const modelName = typeof model === "string" && model.trim() ? model.trim() : null;
  if (modelName) {
    try {
      return tiktoken.encoding_for_model(modelName);
    } catch {
      // ignore unknown model ids
    }
  }

  // Sensible default for modern chat models.
  try {
    return tiktoken.get_encoding("o200k_base");
  } catch {
    return tiktoken.get_encoding("cl100k_base");
  }
}

async function loadTiktoken() {
  // Prefer the canonical package name ("tiktoken"); allow legacy alias if present.
  try {
    return await import("tiktoken");
  } catch {
    return await import(/** @type {string} */ ("@dqbd/tiktoken"));
  }
}

/**
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
      // ignore
    }
  };
}

/**
 * Schedules warmup init based on options.
 * @param {boolean} warmup - Whether to warmup.
 * @param {number} warmupIdleMs - Delay in milliseconds.
 * @param {() => void} triggerInit - Function to trigger init.
 */
function scheduleWarmup(warmup, warmupIdleMs, triggerInit) {
  if (!warmup) return;
  if (warmupIdleMs > 0 && typeof setTimeout === "function") {
    setTimeout(triggerInit, warmupIdleMs);
  } else {
    triggerInit();
  }
}

/**
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

  let encoder = null;
  /** @type {"heuristic"|"tiktoken"} */
  let mode = "heuristic";
  let ready = false;
  let failed = false;
  let initPromise = null;
  let lastModel = typeof options.model === "string" ? options.model : null;
  let lastEncoding = typeof options.encoding === "string" ? options.encoding : null;

  /**
   * @param {{ model?: string, encoding?: string }} [options]
   * @returns {Promise<boolean>}
   */
  const init = async ({ model, encoding } = {}) => {
    if (failed) return false;
    if (ready && encoder) return true;
    if (!isWasmSupported()) {
      failed = true;
      return false;
    }

    const nextModel = typeof model === "string" && model.trim() ? model : lastModel;
    const nextEncoding = typeof encoding === "string" && encoding.trim() ? encoding : lastEncoding;
    lastModel = nextModel || lastModel;
    lastEncoding = nextEncoding || lastEncoding;

    if (initPromise) return initPromise;

    initPromise = Promise.resolve()
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
        encoder = enc;
        mode = "tiktoken";
        ready = true;
        return true;
      })
      .catch((err) => {
        failed = true;
        encoder = null;
        mode = "heuristic";
        const message = err instanceof Error ? err.message : String(err);
        onLog({ level: "warn", message: "[token-counter] tiktoken init failed; falling back to heuristic", error: message });
        return false;
      })
      .finally(() => {
        initPromise = null;
      });

    return initPromise;
  };

  const dispose = () => {
    try {
      if (encoder && typeof encoder.free === "function") encoder.free();
    } catch {
      // ignore
    } finally {
      encoder = null;
      ready = false;
      mode = "heuristic";
      failed = false;
      initPromise = null;
    }
  };

  const count = (value) => {
    const text = toText(value);
    if (!text) return 0;

    if (ready && encoder) {
      try {
        const tokens = encoder.encode(text);
        return Array.isArray(tokens) ? tokens.length : typeof tokens?.length === "number" ? tokens.length : estimateTokensCached(text);
      } catch {
        // If encoding fails (should be rare), fall back safely.
        return estimateTokensCached(text);
      }
    }

    // Kick off WASM init best-effort (no await).
    void init({ model: lastModel || undefined, encoding: lastEncoding || undefined });
    return estimateTokensCached(text);
  };

  const getStatus = () => ({ mode, ready, failed });

  const { warmup, warmupIdleMs } = parseWarmupOptions(options.warmup, options.warmupIdleMs);
  scheduleWarmup(warmup, warmupIdleMs, () => void init({ model: lastModel || undefined, encoding: lastEncoding || undefined }));

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
