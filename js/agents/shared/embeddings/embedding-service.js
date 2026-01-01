function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toNonNegativeInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function safeHeaderObject(value) {
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

export function normalizeEmbeddingConfig(raw) {
  const cfg = isPlainObject(raw) ? raw : null;
  if (!cfg) return null;

  const endpoint = toNonEmptyString(cfg.endpoint || cfg.url || cfg.baseUrl);
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

  return {
    endpoint,
    model,
    apiKey,
    headers,
    timeoutMs,
    batchSize,
    flushIntervalMs,
    maxQueue,
    cooldownMs,
  };
}

export class EmbeddingService {
  constructor(config = {}, { fetchImpl } = {}) {
    const normalized = normalizeEmbeddingConfig(config);
    this._cfg = normalized;
    this._fetch = typeof fetchImpl === "function" ? fetchImpl : typeof fetch === "function" ? fetch.bind(globalThis) : null;

    this._queue = [];
    this._flushTimer = null;
    this._inFlight = null;

    this._available = normalized ? null : false; // null=unknown, false=disabled/unavailable, true=ok
    this._failures = 0;
    this._nextRetryAt = 0;
  }

  get enabled() {
    return !!this._cfg && typeof this._fetch === "function";
  }

  getStatus() {
    return {
      enabled: this.enabled,
      available: this._available,
      failures: this._failures,
      nextRetryAt: this._nextRetryAt,
      endpoint: this._cfg?.endpoint || null,
      model: this._cfg?.model || null,
    };
  }

  _canAttemptNow() {
    if (!this.enabled) return false;
    if (this._available === true) return true;
    if (this._available === null) return true;
    const now = Date.now();
    return now >= (this._nextRetryAt || 0);
  }

  _markFailure() {
    this._failures += 1;
    this._available = false;
    const cooldown = this._cfg?.cooldownMs || 300_000;
    const now = Date.now();
    this._nextRetryAt = now + cooldown;
  }

  async _callEmbeddings(texts, { signal, timeoutMs } = {}) {
    if (!this._canAttemptNow()) return null;

    const inputs = Array.isArray(texts) ? texts.map((t) => String(t ?? "")).filter((t) => t.trim()) : [];
    if (!inputs.length) return [];

    const cfg = this._cfg;
    if (!cfg) return null;

    const endpoint = cfg.endpoint;
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
        this._markFailure();
        return null;
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        this._markFailure();
        return null;
      }

      const vectors = normalizeEmbeddingResponse(json, inputs.length);
      if (!vectors) {
        this._markFailure();
        return null;
      }

      this._available = true;
      return vectors;
    } catch {
      this._markFailure();
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
    if (t && typeof t.unref === "function") {
      try {
        t.unref();
      } catch {
        // ignore
      }
    }
    this._flushTimer = t;
  }

  /**
   * Enqueue an embedding request; resolves with Float32Array[] or null when unavailable.
   *
   * @param {string[]|string} texts
   * @param {object=} options
   * @param {AbortSignal=} options.signal
   * @param {number=} options.timeoutMs
   * @param {boolean=} options.immediate
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
   * @param {object=} options
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
      if (t && typeof t.unref === "function") {
        try {
          t.unref();
        } catch {
          // ignore
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

        while (this._queue.length && batchTexts.length < batchSize) {
          const req = this._queue[0];
          const remaining = batchSize - batchTexts.length;
          const take = Math.min(remaining, req.texts.length);
          if (take <= 0) break;

          batchReqs.push({ req, take });
          batchTexts.push(...req.texts.slice(0, take));
          req.texts = req.texts.slice(take);

          if (req.texts.length === 0) {
            this._queue.shift();
          } else {
            break; // partial - continue next batch later
          }
        }

        const vectors = await this._callEmbeddings(batchTexts);
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

export function createEmbeddingService(config, options) {
  return new EmbeddingService(config, options);
}

export default { EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig };
