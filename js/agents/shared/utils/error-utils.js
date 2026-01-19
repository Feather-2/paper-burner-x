/**
 * Error Handling Utilities
 *
 * Provides structured error handling to replace silent catch blocks.
 */

import { createLogger } from "./logger.js";

/**
 * Safely execute a function, logging errors instead of silently swallowing them.
 *
 * @param {Function} fn - Function to execute (sync or async)
 * @param {Object} options
 * @param {string} [options.context="unknown"] - Context for logging
 * @param {*} [options.fallback=undefined] - Value to return on error
 * @param {Function} [options.onError] - Optional error handler
 * @returns {*} Result of fn or fallback on error
 */
export function safeExec(fn, { context = "unknown", fallback = undefined, onError } = {}) {
  const logger = createLogger(`safe-exec:${context}`);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.catch((err) => {
        logger.debug(`Async error: ${err.message}`);
        onError?.(err);
        return fallback;
      });
    }
    return result;
  } catch (err) {
    logger.debug(`Sync error: ${err.message}`);
    onError?.(err);
    return fallback;
  }
}

/**
 * Create a catch handler that logs instead of silently swallowing.
 *
 * Usage:
 *   try { ... } catch (err) { catchAndLog("context")(err); }
 *   promise.catch(catchAndLog("context"))
 *
 * @param {string} context - Context identifier for logging
 * @param {*} [fallback=undefined] - Value to return
 * @returns {Function} Error handler
 */
export function catchAndLog(context, fallback = undefined) {
  const logger = createLogger(`catch:${context}`);
  return (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(message);
    return fallback;
  };
}

/**
 * Wrap a function to make it safe (never throws).
 *
 * @param {Function} fn - Function to wrap
 * @param {Object} options
 * @param {string} [options.context] - Context for logging
 * @param {*} [options.fallback] - Fallback value
 * @returns {Function} Wrapped function
 */
export function makeSafe(fn, { context = fn.name || "anonymous", fallback = undefined } = {}) {
  return function (...args) {
    return safeExec(() => fn.apply(this, args), { context, fallback });
  };
}

/**
 * Check if an error is a specific type.
 *
 * @param {Error} err
 * @param {string} name - Error name to check
 * @returns {boolean}
 */
export function isErrorType(err, name) {
  return err instanceof Error && err.name === name;
}

/**
 * Check if error is an AbortError (cancellation).
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  const e = /** @type {any} */ (err);
  return isErrorType(err, "AbortError") || e?.code === "ABORT_ERR";
}

/**
 * Check if error is a timeout.
 *
 * @param {Error} err
 * @returns {boolean}
 */
export function isTimeoutError(err) {
  const e = /** @type {any} */ (err);
  return isErrorType(err, "TimeoutError") || e?.code === "ETIMEDOUT";
}
