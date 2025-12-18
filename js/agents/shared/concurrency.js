/**
 * 带并发限制的 Promise.all
 * @param {Array} items - 待处理项
 * @param {Function} fn - 处理函数 (item, index) => Promise
 * @param {number} concurrency - 最大并发数，默认 5
 */
export async function mapConcurrent(items, fn, concurrency = 5) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * 信号量实现 - 控制并发资源访问
 */
export class Semaphore {
  constructor(max = 10) {
    this.max = Math.max(1, Math.floor(max));
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.current++;
  }

  release() {
    this.current = Math.max(0, this.current - 1);
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  get available() {
    return this.max - this.current;
  }

  get pending() {
    return this.queue.length;
  }
}

// 全局 LLM 并发池 - 默认 10 并发
export const llmPool = new Semaphore(10);

/**
 * 使用全局池的并发 map
 * @param {Array} items
 * @param {Function} fn - (item, index) => Promise
 * @param {number} localLimit - 本地并发上限（会与全局池取较小值）
 * @param {Semaphore} pool - 可选，默认使用 llmPool
 */
export async function mapConcurrentWithPool(items, fn, localLimit = 5, pool = llmPool) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      await pool.acquire();
      try {
        results[i] = await fn(items[i], i);
      } finally {
        pool.release();
      }
    }
  }

  const workerCount = Math.min(localLimit, items.length, pool.max);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);
  return results;
}
