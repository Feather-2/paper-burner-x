/**
 * 全局并发控制器 - 分层限流
 *
 * 层级：
 * - global: 总并发上限 (默认 10)
 * - model: LLM 调用上限 (默认 5)
 * - fetch: 网络请求上限 (默认 8)
 */
export class GlobalConcurrencyLimiter {
  constructor(limits = {}) {
    this.limits = {
      global: limits.global ?? 10,
      model: limits.model ?? 5,
      fetch: limits.fetch ?? 8,
    };
    this.active = { global: 0, model: 0, fetch: 0 };
    this.queues = { global: [], model: [], fetch: [] };
  }

  _normalizeType(type) {
    const t = String(type || "global");
    if (t === "global" || t === "model" || t === "fetch") return t;
    throw new Error(`Unknown limiter type: ${t}`);
  }

  _canAcquire(type) {
    if (this.active.global >= this.limits.global) return false;
    if (type === "global") return true;
    return this.active[type] < this.limits[type];
  }

  _acquireNow(type) {
    this.active.global += 1;
    if (type !== "global") this.active[type] += 1;
    return () => this.release(type);
  }

  _drain() {
    const q = this.queues.global;
    if (!q.length) return;

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < q.length; i++) {
        const waiter = q[i];
        if (!waiter) continue;
        if (!this._canAcquire(waiter.type)) continue;

        q.splice(i, 1);
        i -= 1;
        progressed = true;
        waiter.resolve(this._acquireNow(waiter.type));
      }
    }
  }

  async acquire(type = "global") {
    const t = this._normalizeType(type);
    if (this._canAcquire(t)) return this._acquireNow(t);

    return await new Promise((resolve) => {
      this.queues.global.push({ type: t, resolve });
    });
  }

  release(type = "global") {
    const t = this._normalizeType(type);
    this.active.global = Math.max(0, this.active.global - 1);
    if (t !== "global") this.active[t] = Math.max(0, this.active[t] - 1);
    this._drain();
  }

  async run(type, fn) {
    const release = await this.acquire(type);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  getStats() {
    return { limits: { ...this.limits }, active: { ...this.active } };
  }
}

let _instance = null;
export function getGlobalLimiter(limits) {
  if (!_instance) _instance = new GlobalConcurrencyLimiter(limits);
  return _instance;
}

export function resetGlobalLimiter() {
  _instance = null;
}

/**
 * 带并发限制的 map
 * @param {Array} items
 * @param {Function} fn - (item, index) => Promise
 * @param {number} concurrency - 最大并发数
 * @param {object} options - { signal, limiter, limiterType }
 */
export async function mapConcurrent(items, fn, concurrency = 5, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  const results = new Array(rows.length);
  const { signal, limiter, limiterType = "global" } = options || {};
  const workerCount = Math.min(
    rows.length,
    typeof concurrency === "number" && Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1
  );

  let index = 0;

  async function worker() {
    while (index < rows.length) {
      if (signal?.aborted) throw new Error("Aborted");
      const i = index++;

      if (limiter) {
        results[i] = await limiter.run(limiterType, () => fn(rows[i], i));
      } else {
        results[i] = await fn(rows[i], i);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
