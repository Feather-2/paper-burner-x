/**
 * Race a promise against a timeout.
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string} [label='operation']
 * @returns {Promise<any>}
 */
export function withTimeout(promise, timeoutMs, label = 'operation') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(promise);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = /** @type {Error & { code?: string }} */ (new Error(`${label} timed out after ${timeoutMs}ms`));
      err.code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), timeout]);
}
