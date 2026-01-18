import { safeJsonParse } from "../shared/utils/safe-json.js";
import { createLogger } from "../shared/utils/logger.js";

import { isPlainObject } from "../shared/utils/value-utils.js";

const logger = createLogger("llm/rate-limit");
const queueMicrotaskSafe =
  typeof globalThis.queueMicrotask === "function" ? globalThis.queueMicrotask.bind(globalThis) : (fn) => Promise.resolve().then(fn);
function isStorageLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function"
  );
}

/**
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} RateLimitTime
 */

/**
 * @typedef {object} TokenBucketRateLimiterOptions
 * @property {number=} rps
 * @property {number=} burst
 * @property {number=} concurrency
 * @property {number=} maxQueue
 * @property {RateLimitTime=} time
 */

function defaultTime() {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function createAbortError(message) {
  const err = new Error(message || "Aborted");
  err.name = "AbortError";
  return err;
}

function isAbortSignal(signal) {
  return !!signal && typeof signal === "object" && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function";
}

/**
 * Normalizes rate limit configuration with defaults.
 * @param {object} input - Raw configuration object.
 * @param {object} [fallback={}] - Fallback defaults.
 * @returns {{ enabled: boolean, rps: number, burst: number, concurrency: number, maxQueue: number }}
 */
export function normalizeRateLimitConfig(input, fallback = {}) {
  const base = isPlainObject(fallback) ? fallback : {};
  const raw = isPlainObject(input) ? input : {};

  const enabled = raw.enabled === undefined ? (base.enabled ?? true) : !!raw.enabled;

  const rpsRaw = raw.rps ?? base.rps ?? 2;
  const burstRaw = raw.burst ?? base.burst ?? 4;
  const concurrencyRaw = raw.concurrency ?? base.concurrency ?? 2;

  const rpsNum = Number(rpsRaw);
  const burstNum = Number(burstRaw);
  const concurrencyNum = Number(concurrencyRaw);

  const rps = Number.isFinite(rpsNum) && rpsNum > 0 ? rpsNum : Infinity;
  const burst = Number.isFinite(burstNum) && burstNum >= 1 ? Math.floor(burstNum) : 1;
  const concurrency = Number.isFinite(concurrencyNum) && concurrencyNum >= 1 ? Math.floor(concurrencyNum) : 1;

  const maxQueueRaw = raw.maxQueue ?? base.maxQueue ?? 500;
  const maxQueueNum = Number(maxQueueRaw);
  const maxQueue = Number.isFinite(maxQueueNum) && maxQueueNum >= 0 ? Math.floor(maxQueueNum) : 500;

  return { enabled, rps, burst, concurrency, maxQueue };
}

/**
 * Loads rate limit configuration from storage.
 * Falls back to defaults if storage is unavailable or data is invalid.
 * @param {{ storageKey?: string, storage?: Storage | null }} [options={}]
 * @returns {{ enabled: boolean, rps: number, burst: number, concurrency: number, maxQueue: number }}
 */
export function loadRateLimitConfig({ storageKey = "paperburner_llm_rate_limit_v1", storage = null } = {}) {
  try {
    const store = isStorageLike(storage) ? storage : null;
    if (!store) return normalizeRateLimitConfig({});
    const raw = store.getItem(storageKey);
    if (!raw) return normalizeRateLimitConfig({});
    const parsed = safeJsonParse(raw, { maxChars: 200_000 });
    return normalizeRateLimitConfig(parsed);
  } catch {
    return normalizeRateLimitConfig({});
  }
}

export class TokenBucketRateLimiter {
  /**
   * @param {TokenBucketRateLimiterOptions} [options]
   */
  constructor({ rps = 2, burst = 4, concurrency = 2, maxQueue = 500, time } = {}) {
    const cfg = normalizeRateLimitConfig({ enabled: true, rps, burst, concurrency, maxQueue });
    this._rps = cfg.rps;
    this._burst = cfg.burst;
    this._concurrency = cfg.concurrency;
    this._maxQueue = cfg.maxQueue;
    this._time = time || defaultTime();

    this._tokens = this._rps === Infinity ? Infinity : this._burst;
    this._lastRefillMs = this._time.now();
    this._blockedUntilMs = 0;

    this._queue = [];
    this._inFlight = 0;
    this._pumping = false;
    this._pumpRequested = false;
    this._pumpScheduled = false;
  }

  getState() {
    return {
      rps: this._rps,
      burst: this._burst,
      concurrency: this._concurrency,
      maxQueue: this._maxQueue,
      queueSize: this._queue.length,
      inFlight: this._inFlight,
      blockedUntilMs: this._blockedUntilMs,
      tokens: this._tokens,
      lastRefillMs: this._lastRefillMs,
      nowMs: this._time.now(),
    };
  }

  blockFor(ms) {
    const waitMs = Number(ms);
    if (!Number.isFinite(waitMs) || waitMs <= 0) return;
    const now = this._time.now();
    const until = now + Math.floor(waitMs);
    if (until > this._blockedUntilMs) this._blockedUntilMs = until;
    this._requestPump();
  }

  /**
   * @template T
   * @param {() => (Promise<T>|T)} execute
   * @param {{ signal?: AbortSignal, label?: string }} [options]
   * @returns {Promise<T>}
   */
  async schedule(execute, { signal, label } = {}) {
    if (typeof execute !== "function") throw new TypeError("TokenBucketRateLimiter.schedule(): execute must be a function");
    if (isAbortSignal(signal) && signal.aborted) throw createAbortError(`Aborted${label ? `: ${label}` : ""}`);
    // maxQueue=0 means allow at most one queued item (in-flight does not count).
    if (this._maxQueue === 0 && this._queue.length > 0) throw new Error("TokenBucketRateLimiter: queue full");
    if (this._maxQueue > 0 && this._queue.length >= this._maxQueue) throw new Error("TokenBucketRateLimiter: queue full");

    return new Promise((resolve, reject) => {
      let settled = false;
      const finalizeResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanupAbort?.();
        resolve(value);
      };
      const finalizeReject = (err) => {
        if (settled) return;
        settled = true;
        cleanupAbort?.();
        reject(err);
      };

      const item = {
        label: typeof label === "string" ? label : "",
        signal: isAbortSignal(signal) ? signal : null,
        settled: () => settled,
        execute,
        resolve: finalizeResolve,
        reject: finalizeReject,
        enqueuedAtMs: this._time.now(),
        canceled: false,
        started: false,
        cleanupAbort: null,
      };

      let cleanupAbort = null;
      if (item.signal) {
        const onAbort = () => {
          item.canceled = true;
          this._requestPump();
          finalizeReject(createAbortError(`Aborted${item.label ? `: ${item.label}` : ""}`));
        };
        try {
          item.signal.addEventListener("abort", onAbort, { once: true });
          cleanupAbort = () => {
            try {
              item.signal.removeEventListener("abort", onAbort);
            } catch {
              // ignore
            }
          };
          item.cleanupAbort = cleanupAbort;
        } catch {
          // ignore
        }
      }

      this._queue.push(item);
      this._requestPump();
    });
  }

  _requestPump() {
    if (this._pumping) {
      this._pumpRequested = true;
      return;
    }
    this._pump().catch((err) => logger.warn("Pump error", { error: err.message }));
  }

  _requestPumpSoon() {
    if (this._pumpScheduled) return;
    this._pumpScheduled = true;
    queueMicrotaskSafe(() => {
      this._pumpScheduled = false;
      this._requestPump();
    });
  }

  _refill(nowMs) {
    if (this._rps === Infinity) {
      this._tokens = Infinity;
      this._lastRefillMs = nowMs;
      return;
    }
    const elapsedMs = Math.max(0, nowMs - this._lastRefillMs);
    if (elapsedMs <= 0) return;
    const refill = (elapsedMs / 1000) * this._rps;
    this._tokens = Math.min(this._burst, this._tokens + refill);
    this._lastRefillMs = nowMs;
  }

  _msUntilToken(nowMs) {
    if (this._rps === Infinity) return 0;
    const missing = 1 - this._tokens;
    if (missing <= 0) return 0;
    return Math.ceil((missing / this._rps) * 1000);
  }

  _shiftRunnable() {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item || typeof item !== "object") continue;
      if (item.settled()) continue;
      if (item.canceled) continue;
      if (item.signal?.aborted) {
        item.canceled = true;
        item.reject(createAbortError(`Aborted${item.label ? `: ${item.label}` : ""}`));
        continue;
      }
      return item;
    }
    return null;
  }

  async _pump() {
    if (this._pumping) {
      this._pumpRequested = true;
      return;
    }
    this._pumping = true;
    this._pumpRequested = false;

    try {
      while (true) {
        if (this._queue.length === 0) return;

        const now = this._time.now();
        this._refill(now);

        if (now < this._blockedUntilMs) {
          await this._time.sleep(Math.max(0, this._blockedUntilMs - now));
          continue;
        }

        if (this._inFlight >= this._concurrency) return;

        if (this._rps !== Infinity && this._tokens < 1) {
          await this._time.sleep(this._msUntilToken(now));
          continue;
        }

        const item = this._shiftRunnable();
        if (!item) continue;

        if (this._rps !== Infinity) {
          this._tokens = Math.max(0, this._tokens - 1);
        }

        this._inFlight += 1;
        const decrementInFlight = (() => {
          let done = false;
          return () => {
            if (done) return;
            done = true;
            this._inFlight = Math.max(0, this._inFlight - 1);
          };
        })();
        item.started = true;
        try {
          item.cleanupAbort?.();
        } catch {
          // ignore
        }

        Promise.resolve()
          .then(() => item.execute())
          .then(item.resolve, item.reject)
          .finally(() => {
            decrementInFlight();
            this._requestPump();
          });
      }
    } finally {
      this._pumping = false;
      if (this._pumpRequested) {
        this._pumpRequested = false;
        this._requestPumpSoon();
      }
    }
  }
}

export default {
  TokenBucketRateLimiter,
  loadRateLimitConfig,
  normalizeRateLimitConfig,
};
