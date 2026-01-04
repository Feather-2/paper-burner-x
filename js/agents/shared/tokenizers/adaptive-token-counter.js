import { isPlainObject } from "../utils/value-utils.js";
import { estimateTokensCached } from "../utils/token-cache.js";
import { isWasmSupported } from "../utils/wasm-support.js";

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
    return await import("@dqbd/tiktoken");
  }
}

/**
 * @typedef {object} TokenCounter
 * @property {(value:any)=>number} count Synchronous, always returns a number.
 * @property {(options?:{model?:string,encoding?:string})=>Promise<boolean>} init Best-effort WASM init; resolves true when ready.
 * @property {()=>void} dispose Free WASM resources if allocated.
 * @property {()=>({mode:"heuristic"|"tiktoken",ready:boolean,failed:boolean})} getStatus
 */

/**
 * Create an adaptive token counter:
 * - Uses heuristic counts immediately
 * - Lazily upgrades to tiktoken (WASM) when supported and available
 * - Falls back permanently if tiktoken init fails
 *
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {string} [options.encoding]
 * @param {boolean} [options.warmup=true]
 * @param {number} [options.warmupIdleMs=0] If set, delay warmup via setTimeout to avoid blocking critical path.
 * @param {(info:{level:"warn"|"error",message:string,error?:string})=>void} [options.onLog]
 * @returns {TokenCounter}
 */
export function createAdaptiveTokenCounter(options = {}) {
  if (!isPlainObject(options)) throw new TypeError("createAdaptiveTokenCounter(options): options must be an object");

  const onLog =
    typeof options.onLog === "function"
      ? options.onLog
      : ({ level, message, error }) => {
          try {
            const c = typeof console !== "undefined" ? console : null;
            const fn = level === "error" ? c?.error : c?.warn;
            if (typeof fn === "function") fn.call(c, message, error ? { error } : undefined);
          } catch {
            // ignore
          }
        };

  let encoder = null;
  let mode = "heuristic";
  let ready = false;
  let failed = false;
  let initPromise = null;
  let lastModel = typeof options.model === "string" ? options.model : null;
  let lastEncoding = typeof options.encoding === "string" ? options.encoding : null;

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

  const warmupRaw = options.warmup;
  const warmup = warmupRaw === undefined ? true : !!warmupRaw;
  const warmupIdleMs = Number.isFinite(Number(options.warmupIdleMs)) ? Math.max(0, Math.floor(Number(options.warmupIdleMs))) : 0;
  if (warmup) {
    if (warmupIdleMs > 0 && typeof setTimeout === "function") {
      setTimeout(() => void init({ model: lastModel || undefined, encoding: lastEncoding || undefined }), warmupIdleMs);
    } else {
      void init({ model: lastModel || undefined, encoding: lastEncoding || undefined });
    }
  }

  return { count, init, dispose, getStatus };
}

let _globalCounter = null;

/**
 * Shared, process-wide token counter for convenience.
 * @returns {TokenCounter}
 */
export function getGlobalTokenCounter() {
  if (_globalCounter) return _globalCounter;
  _globalCounter = createAdaptiveTokenCounter();
  return _globalCounter;
}

export default { createAdaptiveTokenCounter, getGlobalTokenCounter };
