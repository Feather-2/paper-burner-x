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
 * 分类错误
 * @param {Error | { name?: string, message?: string, code?: string, status?: number, retryable?: boolean, category?: string }} error
 * @returns {{ taxonomy: string, retryable: boolean }}
 */
export function classifyError(error) {
  if (!error || typeof error !== 'object') {
    return { taxonomy: ErrorTaxonomy.UNKNOWN, retryable: false };
  }

  // 如果已有显式标记，尊重它
  if (typeof error.retryable === 'boolean' && typeof error.category === 'string') {
    return { taxonomy: error.category, retryable: error.retryable };
  }

  const name = typeof error.name === 'string' ? error.name : '';
  const msg = typeof error.message === 'string' ? error.message : '';
  const code = typeof error.code === 'string' ? error.code : '';
  const status = typeof error.status === 'number' ? error.status : 0;

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
