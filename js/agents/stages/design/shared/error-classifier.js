import {
  classifyDesignError as _classifyDesignError,
  isNonRetryableError as _isNonRetryableError,
} from "../../../shared/index.js";

/**
 * Classify design-stage errors into retryable / non-retryable buckets.
 *
 * @param {unknown} err
 * @returns {{ kind: "auth"|"config"|"rate_limit"|"network"|"timeout"|"unknown", code: string, canRetry: boolean }}
 */
export function classifyDesignError(err) {
  return _classifyDesignError(err);
}

/**
 * Check whether the given error should not be retried in the design stage.
 * Includes design-specific check for NonRetryableError instances (err.nonRetryable === true).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNonRetryableError(err) {
  if (!err) return false;
  // Design-specific: NonRetryableError class instances
  if (/** @type {any} */ (err).nonRetryable === true) return true;
  return _isNonRetryableError(err);
}
