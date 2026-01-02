function toPositiveInt(value, fallback = 1) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Simple concurrency limiter (pLimit-style).
 *
 * @param {number} concurrency Max concurrent tasks
 * @returns {<T>(fn: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(concurrency) {
  const limit = toPositiveInt(concurrency, 1);
  const queue = [];
  let running = 0;

  const run = async () => {
    if (running >= limit || queue.length === 0) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    try {
      resolve(await fn());
    } catch (err) {
      reject(err);
    } finally {
      running--;
      run();
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      run();
    });
}

export default { createLimiter };
