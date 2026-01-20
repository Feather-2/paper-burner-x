import {
  classifyDesignError as _classifyDesignError,
  isNonRetryableError as _isNonRetryableError,
} from "../../../shared/index.js";

/**
 * Classify design-stage errors into retryable / non-retryable buckets.
 *
 * @param {unknown} err - Error to classify.
 * @returns {{ kind: "auth"|"config"|"rate_limit"|"network"|"timeout"|"unknown", code: string, canRetry: boolean }} Classification result.
 */
export function classifyDesignError(err) {
  return _classifyDesignError(err);
}

/**
 * Check whether the given error should not be retried in the design stage.
 * Includes design-specific check for NonRetryableError instances (err.nonRetryable === true).
 *
 * @param {unknown} err - Error to inspect.
 * @returns {boolean} True if the error should not be retried.
 */
export function isNonRetryableError(err) {
  if (!err) return false;
  // Design-specific: NonRetryableError class instances
  if (typeof err === "object" && err !== null) {
    const maybeNonRetryable = /** @type {{ nonRetryable?: boolean }} */ (err);
    if (maybeNonRetryable.nonRetryable === true) return true;
  }
  return _isNonRetryableError(err);
}
