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

