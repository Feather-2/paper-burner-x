/**
 * Error Boundary - 错误边界
 *
 * 特性：
 * - 捕获异步错误
 * - 错误分类和上报
 * - 降级策略
 * - 错误恢复
 */

import { createLogger } from "../../shared/utils/logger.js";
import { getGlobalContainer } from "../di/global-container.js";

const logger = createLogger("runtime/core/error-boundary");

// ─────────────────────────────────────────────────────────────────────────────
// Error Categories
// ─────────────────────────────────────────────────────────────────────────────

export const ErrorCategory = {
  NETWORK: "network",
  VALIDATION: "validation",
  TIMEOUT: "timeout",
  QUOTA: "quota",
  PERMISSION: "permission",
  INTERNAL: "internal",
  EXTERNAL: "external",
  UNKNOWN: "unknown",
};

export const ERROR_BOUNDARY_UNHANDLED = Symbol("error_boundary_unhandled");

/**
 * @typedef {Error & {
 *   code?: string,
 *   status?: number,
 * }} ErrorWithMeta
 */

/**
 * Categorize error
 * @param {ErrorWithMeta} error
 * @returns {string}
 */
export function categorizeError(error) {
  if (!error) return ErrorCategory.UNKNOWN;

  const message = error.message?.toLowerCase() || "";
  const name = error.name?.toLowerCase() || "";
  const code = error.code?.toLowerCase() || "";

  // Network errors
  if (
    code.includes("econnreset") ||
    code.includes("enotfound") ||
    code.includes("econnrefused") ||
    code.includes("etimedout") ||
    message.includes("network") ||
    message.includes("fetch")
  ) {
    return ErrorCategory.NETWORK;
  }

  // Timeout
  if (name.includes("timeout") || message.includes("timeout")) {
    return ErrorCategory.TIMEOUT;
  }

  // Validation
  if (
    name.includes("validation") ||
    name.includes("typeerror") ||
    message.includes("invalid") ||
    message.includes("required")
  ) {
    return ErrorCategory.VALIDATION;
  }

  // Quota
  if (message.includes("quota") || message.includes("limit") || code.includes("quota")) {
    return ErrorCategory.QUOTA;
  }

  // Permission
  if (message.includes("permission") || message.includes("denied") || message.includes("forbidden")) {
    return ErrorCategory.PERMISSION;
  }

  // External (API errors)
  if (error.status && error.status >= 400) {
    return ErrorCategory.EXTERNAL;
  }

  return ErrorCategory.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ErrorInfo
 * @property {string} id
 * @property {string} category
 * @property {string} message
 * @property {string} [name]
 * @property {string} [code]
 * @property {string} [stack]
 * @property {number} ts
 * @property {object} [context]
 * @property {boolean} [recovered]
 */

/**
 * Create error info from error
 * @param {ErrorWithMeta} error
 * @param {object} [context]
 * @returns {ErrorInfo}
 */
export function createErrorInfo(error, context = {}) {
  return {
    id: `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    category: categorizeError(error),
    message: error?.message || String(error),
    name: error?.name,
    code: error?.code,
    stack: error?.stack,
    ts: Date.now(),
    context,
    recovered: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ErrorBoundary
// ─────────────────────────────────────────────────────────────────────────────

export class ErrorBoundary {
  /**
   * @param {object} options
   * @param {function} [options.onError] - Error callback
   * @param {function} [options.onRecovery] - Recovery callback
   * @param {Object<string, function>} [options.fallbacks] - Category → fallback function
   * @param {number} [options.maxErrors=100] - Max errors to keep
   */
  constructor({
    onError,
    onRecovery,
    fallbacks = {},
    maxErrors = 100,
  } = {}) {
    this._onError = typeof onError === "function" ? onError : null;
    this._onRecovery = typeof onRecovery === "function" ? onRecovery : null;
    this._fallbacks = fallbacks;
    this._maxErrors = maxErrors;

    /** @type {ErrorInfo[]} */
    this._errors = [];
  }

  /**
   * Get error history
   */
  get errors() {
    return [...this._errors];
  }

  /**
   * Get error stats
   */
  get stats() {
    const byCategory = {};
    for (const err of this._errors) {
      byCategory[err.category] = (byCategory[err.category] || 0) + 1;
    }
    return {
      total: this._errors.length,
      byCategory,
      recovered: this._errors.filter((e) => e.recovered).length,
    };
  }

  /**
   * Wrap async function with error boundary
   * @param {function} fn
   * @param {object} [options]
   * @param {object} [options.context]
   * @param {any} [options.fallbackValue]
   * @param {boolean} [options.rethrow=false]
   * @returns {Promise<any>}
   */
  async wrap(fn, options = {}) {
    const { context = {}, fallbackValue, rethrow = false } = options;

    try {
      return await fn();
    } catch (error) {
      return this._handleError(error, context, fallbackValue, rethrow);
    }
  }

  /**
   * Report error manually
   * @param {Error} error
   * @param {object} [context]
   */
  report(error, context = {}) {
    this._recordError(error, context);
  }

  /**
   * Mark error as recovered
   * @param {string} errorId
   */
  markRecovered(errorId) {
    const err = this._errors.find((e) => e.id === errorId);
    if (err) {
      err.recovered = true;
      if (this._onRecovery) {
        try {
          this._onRecovery(err);
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * Clear error history
   */
  clear() {
    this._errors = [];
  }

  /**
   * Handle error internally
   * @private
   */
  _handleError(error, context, fallbackValue, rethrow) {
    const info = this._recordError(error, context);
    const category = info.category;

    // Try category-specific fallback
    if (this._fallbacks[category]) {
      try {
        const result = this._fallbacks[category](error, info);
        if (result !== ERROR_BOUNDARY_UNHANDLED) {
          info.recovered = true;
          return result;
        }
      } catch (fallbackError) {
        logger.error("Fallback failed", { category, error: fallbackError?.message });
      }
    }

    // Rethrow if requested
    if (rethrow) {
      throw error;
    }

    // Return fallback value
    return fallbackValue;
  }

  /**
   * Record error
   * @private
   */
  _recordError(error, context) {
    const info = createErrorInfo(error, context);
    this._errors.push(info);

    // Trim old errors
    while (this._errors.length > this._maxErrors) {
      this._errors.shift();
    }

    // Notify callback
    if (this._onError) {
      try {
        this._onError(info);
      } catch {
        // Ignore callback errors
      }
    }

    logger.error("Error caught", {
      id: info.id,
      category: info.category,
      message: info.message,
    });

    return info;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Boundary
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_BOUNDARY_SERVICE_ID = "errorBoundary";

function shouldDegrade(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (ctx.degrade === true) return true;
  if (typeof ctx.shouldDegrade === "function") {
    try {
      return ctx.shouldDegrade() === true;
    } catch {
      return false;
    }
  }
  return false;
}

function resolveFallbackValue(ctx, error, info) {
  if (ctx && typeof ctx === "object") {
    if (typeof ctx.fallbackFactory === "function") {
      try {
        return ctx.fallbackFactory(error, info);
      } catch {
        return undefined;
      }
    }
    if ("fallbackValue" in ctx) return ctx.fallbackValue;
  }
  return undefined;
}

function maybeNotifyDegraded(ctx, payload) {
  if (!ctx || typeof ctx !== "object") return;
  if (typeof ctx.onDegrade === "function") {
    try {
      ctx.onDegrade(payload);
    } catch {
      // ignore
    }
    return;
  }
  if (typeof ctx.emit === "function") {
    try {
      const stage = typeof ctx.stage === "string" && ctx.stage ? ctx.stage : "runtime";
      ctx.emit(`${stage}.error.degraded`, {
        actor: stage,
        status: "degraded",
        payload,
      });
    } catch {
      // ignore
    }
  }
}

function createDefaultFallback(category) {
  return (error, info) => {
    const ctx = info?.context;
    if (!shouldDegrade(ctx)) return ERROR_BOUNDARY_UNHANDLED;

    const value = resolveFallbackValue(ctx, error, info);
    if (value === undefined) return ERROR_BOUNDARY_UNHANDLED;

    maybeNotifyDegraded(ctx, {
      id: info.id,
      category,
      stage: typeof ctx?.stage === "string" ? ctx.stage : undefined,
      runId: ctx?.runId,
      message: info.message,
    });

    return value;
  };
}

/**
 * Create the default ErrorBoundary instance (used by DI defaults).
 * @returns {ErrorBoundary}
 */
export function createDefaultErrorBoundary() {
  return new ErrorBoundary({
    fallbacks: {
      [ErrorCategory.NETWORK]: createDefaultFallback(ErrorCategory.NETWORK),
      [ErrorCategory.TIMEOUT]: createDefaultFallback(ErrorCategory.TIMEOUT),
      [ErrorCategory.QUOTA]: createDefaultFallback(ErrorCategory.QUOTA),
    },
  });
}

/**
 * Get global error boundary (compatibility layer).
 * @returns {ErrorBoundary}
 *
 * @deprecated Prefer resolving via DI container (`ServiceId.ERROR_BOUNDARY`) or passing an explicit boundary instance.
 */
export function getErrorBoundary() {
  const container = getGlobalContainer();
  if (!container.has(ERROR_BOUNDARY_SERVICE_ID)) {
    container.register(ERROR_BOUNDARY_SERVICE_ID, () => createDefaultErrorBoundary());
  }
  return container.get(ERROR_BOUNDARY_SERVICE_ID);
}

/**
 * Wrap function with global error boundary
 * @param {function} fn
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export function withErrorBoundary(fn, options) {
  return getErrorBoundary().wrap(fn, options);
}

export default ErrorBoundary;
