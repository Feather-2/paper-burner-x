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
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNonRetryableError(err) {
  return _isNonRetryableError(err);
}
