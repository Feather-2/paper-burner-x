import {
  classifyDeepSearchError as _classifyDeepSearchError,
  isNonRecoverableDeepSearchError as _isNonRecoverableDeepSearchError,
  toDeepSearchErrorMessage as _toDeepSearchErrorMessage,
} from "../../../shared/index.js";

/**
 * @typedef {"config"|"system"|"auth"|"quota"|"rate_limit"|"timeout"|"server"|"network"|"invalid_request"|"unknown"} DeepSearchErrorCategory
 */

/**
 * @typedef {Object} DeepSearchErrorClassification
 * @property {boolean} recoverable
 * @property {DeepSearchErrorCategory} category
 * @property {number|null} statusCode
 * @property {string|null} code
 * @property {string} message
 */

/**
 * Classify DeepSearch-stage errors into retryable / non-retryable buckets.
 *
 * @param {unknown} err
 * @returns {DeepSearchErrorClassification}
 */
export function classifyDeepSearchError(err) {
  return /** @type {DeepSearchErrorClassification} */ (_classifyDeepSearchError(err));
}

/**
 * Check whether the given error should not be retried in the DeepSearch stage.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNonRecoverableDeepSearchError(err) {
  return _isNonRecoverableDeepSearchError(err);
}

/**
 * Extract a user-facing DeepSearch error message.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function toDeepSearchErrorMessage(err) {
  return _toDeepSearchErrorMessage(err);
}
