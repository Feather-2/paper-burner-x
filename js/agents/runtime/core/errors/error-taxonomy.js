/**
 * Error Taxonomy - 错误分类
 *
 * 根据错误的 name/code/message/status 自动分类。
 *
 * @module runtime/errors/error-taxonomy
 */

/** @readonly @enum {string} */
export const ErrorTaxonomy = {
  RETRYABLE: 'retryable',
  NON_RETRYABLE: 'non_retryable',
  EXTERNAL_DEPENDENCY: 'external_dependency',
  INPUT_VALIDATION: 'input_validation',
  TIMEOUT: 'timeout',
  RESOURCE_EXHAUSTION: 'resource_exhaustion',
  INTERNAL: 'internal',
  UNKNOWN: 'unknown',
};

const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
  'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN',
]);

const TIMEOUT_NAMES = new Set(['AbortError', 'TimeoutError']);

const RESOURCE_PATTERNS = [/out of memory/i, /quota exceeded/i, /oom/i, /heap/i, /ENOMEM/];

/**
 * @typedef {Error & {
 *   code?: string,
 *   status?: number,
 *   retryable?: boolean,
 *   category?: string
 * }} ClassifiedError
 */

/**
 * 分类错误
 * @param {Error | { name?: string, message?: string, code?: string, status?: number, retryable?: boolean, category?: string }} error
 * @returns {{ taxonomy: string, retryable: boolean }}
 */
export function classifyError(error) {
  if (!error || typeof error !== 'object') {
    return { taxonomy: ErrorTaxonomy.UNKNOWN, retryable: false };
  }
  const err = /** @type {ClassifiedError} */ (error);

  // 如果已有显式标记，尊重它
  if (typeof err.retryable === 'boolean' && typeof err.category === 'string') {
    return { taxonomy: err.category, retryable: err.retryable };
  }

  const name = typeof err.name === 'string' ? err.name : '';
  const msg = typeof err.message === 'string' ? err.message : '';
  const code = typeof err.code === 'string' ? err.code : '';
  const status = typeof err.status === 'number' ? err.status : 0;

  // Timeout
  if (TIMEOUT_NAMES.has(name) || /timeout/i.test(msg) || code === 'ETIMEDOUT') {
    return { taxonomy: ErrorTaxonomy.TIMEOUT, retryable: true };
  }

  // Resource exhaustion
  if (RESOURCE_PATTERNS.some(p => p.test(msg) || p.test(code))) {
    return { taxonomy: ErrorTaxonomy.RESOURCE_EXHAUSTION, retryable: false };
  }

  // Retryable HTTP/network
  if (status === 429 || status === 503) {
    return { taxonomy: ErrorTaxonomy.RETRYABLE, retryable: true };
  }
  if (RETRYABLE_CODES.has(code) || /network/i.test(msg) || /fetch failed/i.test(msg)) {
    return { taxonomy: ErrorTaxonomy.RETRYABLE, retryable: true };
  }

  // External dependency (non-2xx HTTP)
  if (status >= 500) {
    return { taxonomy: ErrorTaxonomy.EXTERNAL_DEPENDENCY, retryable: true };
  }
  if (status >= 400 && status < 500) {
    return { taxonomy: ErrorTaxonomy.NON_RETRYABLE, retryable: false };
  }

  // Input validation
  if (name === 'TypeError' || name === 'RangeError' || name === 'ValidationError' ||
      /invalid|missing|required|expected/i.test(msg)) {
    return { taxonomy: ErrorTaxonomy.INPUT_VALIDATION, retryable: false };
  }

  // Internal
  if (name === 'ReferenceError' || name === 'SyntaxError') {
    return { taxonomy: ErrorTaxonomy.INTERNAL, retryable: false };
  }

  return { taxonomy: ErrorTaxonomy.UNKNOWN, retryable: false };
}
