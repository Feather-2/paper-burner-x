import { isPlainObject, toNonEmptyString, toNonNegativeInt, toPositiveInt } from "../../shared/utils/value-utils.js";

function isIpv4Host(hostname) {
  const h = String(hostname || "").trim();
  const parts = h.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isPrivateIpv4(hostname) {
  if (!isIpv4Host(hostname)) return false;
  const [a, b] = hostname.split(".").map((x) => Number(x));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h || !h.includes(":")) return false;
  if (h.includes("%")) return true;
  if (h === "::1" || h === "::" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  const mapped = (() => {
    const tail = h.slice(h.lastIndexOf(":") + 1);
    if (tail && tail.includes(".") && isIpv4Host(tail)) return tail;
    const m = h.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (!m) return null;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    const ipv4 = `${a}.${b}.${c}.${d}`;
    return isIpv4Host(ipv4) ? ipv4 : null;
  })();
  if (mapped && isPrivateIpv4(mapped)) return true;
  return false;
}

function isPrivateHostname(hostname) {
  let h = String(hostname || "").trim().toLowerCase();
  if (!h) return false;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

function normalizeEmbeddingEndpoint(raw) {
  const endpoint = toNonEmptyString(raw);
  if (!endpoint) return null;

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  const hostname = toNonEmptyString(url.hostname);
  if (!hostname) return null;
  if (isPrivateHostname(hostname)) return null;
  return url.toString();
}

/**
 * @typedef {object} EmbeddingConfig
 * @property {string} endpoint
 * @property {string|null} model
 * @property {string|null} apiKey
 * @property {Record<string, string>} headers
 * @property {number} timeoutMs
 * @property {number} batchSize
 * @property {number} flushIntervalMs
 * @property {number} maxQueue
 * @property {number} cooldownMs
 */

/**
 * @typedef {object} AbortableOptions
 * @property {AbortSignal=} signal
 * @property {number=} timeoutMs
 */

function safeHeaderObject(value) {
  /** @type {Record<string, string>} */
  const out = {};
  const obj = isPlainObject(value) ? value : null;
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = toNonEmptyString(k);
    if (!key) continue;
    out[key] = String(v ?? "");
  }
  return out;
}

/**
 * @param {AbortableOptions} [options]
 * @returns {{ signal: AbortSignal | undefined, cleanup: () => void }}
 */
function withAbort({ signal, timeoutMs } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const cleanupFns = [];

  const abort = (reason) => {
    try {
      controller?.abort(reason);
    } catch {
      // ignore
    }
  };

  if (signal && typeof signal === "object") {
    if (signal.aborted) abort(signal.reason);
    else if (typeof signal.addEventListener === "function") {
      const onAbort = () => abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      cleanupFns.push(() => {
        try {
          signal.removeEventListener("abort", onAbort);
        } catch {
          // ignore
        }
      });
    }
  }

  const ms = Number.isFinite(Number(timeoutMs)) ? Math.max(0, Math.floor(Number(timeoutMs))) : 0;
  if (ms > 0 && typeof setTimeout === "function") {
    const t = setTimeout(() => abort("timeout"), ms);
    cleanupFns.push(() => {
      try {
        clearTimeout(t);
      } catch {
        // ignore
      }
    });
  }

  return {
    signal: controller ? controller.signal : signal,
    cleanup: () => {
      for (const fn of cleanupFns) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
    },
  };
}

function normalizeEmbeddingResponse(json, expectedCount) {
  const obj = isPlainObject(json) ? json : null;
  if (!obj) return null;

  let rawVectors = null;
  if (Array.isArray(obj.data)) {
    const rows = obj.data;
    if (rows.length && isPlainObject(rows[0]) && Array.isArray(rows[0].embedding)) {
      const hasIndex = rows.every((r) => typeof r?.index === "number" && Number.isFinite(r.index));
      const ordered = hasIndex ? rows.slice().sort((a, b) => a.index - b.index) : rows;
      rawVectors = ordered.map((r) => r.embedding);
    } else if (rows.length && Array.isArray(rows[0])) {
      rawVectors = rows;
    }
  } else if (Array.isArray(obj.embeddings)) {
    rawVectors = obj.embeddings;
  } else if (Array.isArray(obj.embedding)) {
    rawVectors = [obj.embedding];
  } else if (Array.isArray(obj.vector)) {
    rawVectors = [obj.vector];
  }

  if (!rawVectors) return null;

  const out = [];
  for (const v of rawVectors) {
    if (!Array.isArray(v) || v.length === 0) return null;
    const arr = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = Number(v[i] ?? 0);
      if (!Number.isFinite(n)) return null;
      arr[i] = n;
    }
    out.push(arr);
  }

  const want = typeof expectedCount === "number" && Number.isFinite(expectedCount) ? expectedCount : null;
  if (want !== null && out.length !== want) {
    if (want === 1 && out.length >= 1) return [out[0]];
    return null;
  }

  return out;
}

/**
 * Normalize raw embedding configuration into a validated EmbeddingConfig.
 * @param {unknown} raw - Raw configuration object.
 * @returns {EmbeddingConfig | null} Normalized config or null if invalid/disabled.
 */
export function normalizeEmbeddingConfig(raw) {
  /** @type {Record<string, unknown> | null} */
  const cfg = isPlainObject(raw) ? /** @type {Record<string, unknown>} */ (raw) : null;
  if (!cfg) return null;

  const endpoint = normalizeEmbeddingEndpoint(cfg.endpoint || cfg.url || cfg.baseUrl);
  if (!endpoint) return null;

  const enabled = cfg.enabled === undefined ? true : !!cfg.enabled;
  if (!enabled) return null;

  const model = toNonEmptyString(cfg.model);
  const apiKey = toNonEmptyString(cfg.apiKey || cfg.key);
  const headers = safeHeaderObject(cfg.headers);

  const timeoutMs = toPositiveInt(cfg.timeoutMs, 5000);
  const batchSize = toPositiveInt(cfg.batchSize, 32);
  const flushIntervalMs = toNonNegativeInt(cfg.flushIntervalMs, 30);
  const maxQueue = toPositiveInt(cfg.maxQueue, 2000);
  const cooldownMs = toPositiveInt(cfg.cooldownMs, 300_000);

  /** @type {EmbeddingConfig} */
  return {
    endpoint,
    model: model || null,
    apiKey: apiKey || null,
    headers,
    timeoutMs,
    batchSize,
    flushIntervalMs,
    maxQueue,
    cooldownMs,
  };
}

export class EmbeddingService {
  /** @type {EmbeddingConfig | null} */
  _cfg;
  /** @type {typeof fetch | null} */
  _fetch;
  /** @type {any[]} */
  _queue;
  /** @type {ReturnType<typeof setTimeout> | true | null} */
  _flushTimer;
  /** @type {Promise<void> | null} */
  _inFlight;
  /** @type {boolean | null} */
  _available;
  /** @type {number} */
  _failures;
  /** @type {number} */
  _nextRetryAt;
  /** @type {string | null} */
  _lastError;

  /**
   * @param {unknown} config
   * @param {{ fetchImpl?: typeof fetch }} [options]
   */
  constructor(config = {}, { fetchImpl } = {}) {
    const normalized = normalizeEmbeddingConfig(config);
    this._cfg = normalized;
    // If fetchImpl is explicitly passed (even as null), use it; otherwise fallback to global fetch
    this._fetch = arguments.length >= 2 && arguments[1] && "fetchImpl" in arguments[1]
      ? (typeof fetchImpl === "function" ? fetchImpl : null)
      : (typeof fetch === "function" ? fetch.bind(globalThis) : null);

    this._queue = [];
    this._flushTimer = null;
    this._inFlight = null;

    this._available = normalized ? null : false; // null=unknown, false=disabled/unavailable, true=ok
    this._failures = 0;
    this._nextRetryAt = 0;
    this._lastError = null;
  }

  get enabled() {
    return !!this._cfg && typeof this._fetch === "function";
  }

  /**
   * @returns {{ enabled: boolean, available: boolean|null, failures: number, nextRetryAt: number, endpoint: string|null, model: string|null, lastError: string|null }}
   */
  getStatus() {
    return {
      enabled: this.enabled,
      available: this._available,
      failures: this._failures,
      nextRetryAt: this._nextRetryAt,
      endpoint: this._cfg?.endpoint || null,
      model: this._cfg?.model || null,
      lastError: this._lastError,
    };
  }

  _canAttemptNow() {
    if (!this.enabled) return false;
    if (this._available === true) return true;
    if (this._available === null) return true;
    const now = Date.now();
    return now >= (this._nextRetryAt || 0);
  }

  _markFailure(error) {
    this._failures += 1;
    this._available = false;
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._lastError = message || "EmbeddingService error";
    }
    const cooldown = this._cfg?.cooldownMs || 300_000;
    const now = Date.now();
    this._nextRetryAt = now + cooldown;
  }

  /**
   * @param {string[]|unknown} texts
   * @param {AbortableOptions} [options]
   * @returns {Promise<Float32Array[]|null>}
   */
  async _callEmbeddings(texts, { signal, timeoutMs } = {}) {
    if (!this._canAttemptNow()) return null;

    const inputs = Array.isArray(texts) ? texts.map((t) => String(t ?? "")).filter((t) => t.trim()) : [];
    if (!inputs.length) return [];

    const cfg = this._cfg;
    if (!cfg) return null;

    const endpoint = cfg.endpoint;
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json", ...cfg.headers };
    if (cfg.apiKey && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }

    const body = {
      ...(cfg.model ? { model: cfg.model } : {}),
      input: inputs,
    };

    const timeoutFinal = toPositiveInt(timeoutMs, cfg.timeoutMs || 5000);
    const { signal: mergedSignal, cleanup } = withAbort({ signal, timeoutMs: timeoutFinal });

    try {
      const res = await this._fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        ...(mergedSignal ? { signal: mergedSignal } : {}),
      });

      if (!res || !res.ok) {
        const status = res ? `${res.status}${res.statusText ? ` ${res.statusText}` : ""}` : "no response";
        this._markFailure(new Error(`EmbeddingService request failed (${status})`));
        return null;
      }

      let json = null;
      try {
        json = await res.json();
      } catch (err) {
        this._markFailure(err);
        return null;
      }

      const vectors = normalizeEmbeddingResponse(json, inputs.length);
      if (!vectors) {
        this._markFailure(new Error("EmbeddingService response format invalid"));
        return null;
      }

      this._available = true;
      this._lastError = null;
      return vectors;
    } catch (err) {
      this._markFailure(err);
      return null;
    } finally {
      cleanup();
    }
  }

  _scheduleFlush(delayMs) {
    if (this._flushTimer) return;
    const delay = Number.isFinite(Number(delayMs)) ? Math.max(0, Math.floor(Number(delayMs))) : this._cfg?.flushIntervalMs || 0;
    if (delay <= 0) {
      this._flushTimer = true;
      const qm = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => Promise.resolve().then(fn);
      qm(() => {
        this._flushTimer = null;
        void this.flush();
      });
      return;
    }
    const t = setTimeout(() => {
      this._flushTimer = null;
      void this.flush();
    }, delay);
    const maybeTimer = /** @type {unknown} */ (t);
    if (maybeTimer && typeof maybeTimer === "object" && "unref" in maybeTimer) {
      const unref = maybeTimer.unref;
      if (typeof unref === "function") {
        try {
          unref.call(maybeTimer);
        } catch {
          // ignore
        }
      }
    }
    this._flushTimer = t;
  }

  /**
   * Enqueue an embedding request; resolves with Float32Array[] or null when unavailable.
   *
   * @param {string[]|string} texts
   * @param {{ signal?: AbortSignal, timeoutMs?: number, immediate?: boolean }} [options]
   * @returns {Promise<Float32Array[]|null>}
   */
  enqueue(texts, { signal, timeoutMs, immediate } = {}) {
    if (!this.enabled) return Promise.resolve(null);
    if (!this._canAttemptNow()) return Promise.resolve(null);

    const list = Array.isArray(texts) ? texts : texts ? [texts] : [];
    const inputs = list.map((t) => String(t ?? "")).filter((t) => t.trim());
    if (!inputs.length) return Promise.resolve([]);

    const maxQueue = this._cfg?.maxQueue || 2000;
    if (this._queue.length >= maxQueue) return Promise.resolve(null);

    const req = {
      texts: inputs,
      expected: inputs.length,
      results: [],
      resolve: null,
      signal: signal && typeof signal === "object" ? signal : null,
      timeoutMs: timeoutMs,
    };

    const p = new Promise((resolve) => {
      req.resolve = resolve;
    });

    this._queue.push(req);
    this._scheduleFlush(immediate ? 0 : undefined);
    return p;
  }

  /**
   * Convenience: enqueue + await (best-effort).
   *
   * @param {string[]|string} texts
   * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
   * @returns {Promise<Float32Array[]|null>}
   */
  async embed(texts, options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const timeoutMs = toPositiveInt(opts.timeoutMs, null);
    const p = this.enqueue(texts, { ...opts, immediate: true });
    if (timeoutMs === null) return await p;

    return await new Promise((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
      const maybeTimer = /** @type {unknown} */ (t);
      if (maybeTimer && typeof maybeTimer === "object" && "unref" in maybeTimer) {
        const unref = maybeTimer.unref;
        if (typeof unref === "function") {
          try {
            unref.call(maybeTimer);
          } catch {
            // ignore
          }
        }
      }
      p.then((result) => {
        if (settled) return;
        settled = true;
        try {
          clearTimeout(t);
        } catch {
          // ignore
        }
        resolve(result);
      });
    });
  }

  async flush() {
    if (!this.enabled) return false;
    if (this._inFlight) return await this._inFlight.then(() => true).catch(() => false);
    if (!this._queue.length) return true;

    // If a flush was already scheduled, cancel it (we're flushing now).
    if (this._flushTimer && this._flushTimer !== true) {
      try {
        clearTimeout(this._flushTimer);
      } catch {
        // ignore
      }
      this._flushTimer = null;
    } else if (this._flushTimer === true) {
      this._flushTimer = null;
    }

    this._inFlight = (async () => {
      while (this._queue.length) {
        if (!this._canAttemptNow()) {
          const pending = this._queue.splice(0);
          for (const req of pending) req.resolve?.(null);
          break;
        }

        const batchSize = this._cfg?.batchSize || 32;
        const batchTexts = [];
        const batchReqs = [];

        // Derive combined signal/timeout for batch from pending requests
        let combinedSignal = null;
        let combinedTimeoutMs = Infinity;

        while (this._queue.length && batchTexts.length < batchSize) {
          const req = this._queue[0];

          // Skip requests that are already aborted
          if (req.signal?.aborted) {
            this._queue.shift();
            req.resolve?.(null);
            continue;
          }

          const remaining = batchSize - batchTexts.length;
          const take = Math.min(remaining, req.texts.length);
          if (take <= 0) break;

          // Track shortest timeout and first valid signal for batch
          if (req.timeoutMs != null && Number.isFinite(req.timeoutMs) && req.timeoutMs < combinedTimeoutMs) {
            combinedTimeoutMs = req.timeoutMs;
          }
          if (req.signal && !combinedSignal) {
            combinedSignal = req.signal;
          }

          batchReqs.push({ req, take });
          batchTexts.push(...req.texts.slice(0, take));
          req.texts = req.texts.slice(take);

          if (req.texts.length === 0) {
            this._queue.shift();
          } else {
            break; // partial - continue next batch later
          }
        }

        // Skip empty batch (all requests were aborted)
        if (batchTexts.length === 0) continue;

        const batchOptions = {};
        if (combinedSignal) batchOptions.signal = combinedSignal;
        if (Number.isFinite(combinedTimeoutMs) && combinedTimeoutMs < Infinity) {
          batchOptions.timeoutMs = combinedTimeoutMs;
        }

        const vectors = await this._callEmbeddings(batchTexts, batchOptions);
        if (!vectors) {
          // Degrade immediately: resolve all pending (including leftovers) with null.
          for (const { req } of batchReqs) req.resolve?.(null);
          const leftovers = this._queue.splice(0);
          for (const req of leftovers) req.resolve?.(null);
          break;
        }

        let offset = 0;
        for (const { req, take } of batchReqs) {
          req.results.push(...vectors.slice(offset, offset + take));
          offset += take;
          if (req.results.length >= req.expected) req.resolve?.(req.results.slice(0, req.expected));
        }
      }
    })()
      .catch(() => {
        // Ensure callers aren't left hanging.
        const pending = this._queue.splice(0);
        for (const req of pending) req.resolve?.(null);
      })
      .finally(() => {
        this._inFlight = null;
      });

    try {
      await this._inFlight;
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create an EmbeddingService instance.
 * @param {unknown} config - Embedding configuration.
 * @param {{ fetchImpl?: typeof fetch }} [options] - Optional fetch implementation.
 * @returns {EmbeddingService} A new EmbeddingService instance.
 */
export function createEmbeddingService(config, options) {
  return new EmbeddingService(config, options);
}

export default { EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig };
