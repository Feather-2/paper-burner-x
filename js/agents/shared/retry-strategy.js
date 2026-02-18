/**
 * Retry Strategy - 重试风暴预防
 *
 * 特性：
 * - 指数退避 + 抖动
 * - 最大重试次数限制
 * - 全局重试预算（防止雪崩）
 * - 可配置重试条件
 */

import { createLogger } from "./utils/logger.js";

const logger = createLogger("runtime/core/retry-strategy");

/**
 * @typedef {Error & {
 *   code?: string,
 *   status?: number,
 * }} RetryableError
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_JITTER_FACTOR = 0.3;
const DEFAULT_GLOBAL_BUDGET_PER_MINUTE = 100;
const DEFAULT_GLOBAL_BUDGET_SCOPE = "__shared__";

// ─────────────────────────────────────────────────────────────────────────────
// Retry Errors
// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
]);

const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
// Note: 500 removed from default - often indicates logic errors that won't resolve on retry

/**
 * Check if error is retryable
 * @param {RetryableError} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!error) return false;

  // Network errors
  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }

  // HTTP status codes
  if (error.status && RETRYABLE_STATUS_CODES.has(error.status)) {
    return true;
  }

  // Rate limit
  if (error.message?.includes("rate limit") || error.message?.includes("429")) {
    return true;
  }

  // Timeout
  if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Budget Tracker (shared across all instances)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, number[]>} */
let _globalRetryTimestamps = new Map();

function normalizeBudgetScope(scope) {
  const s = typeof scope === "string" ? scope.trim() : "";
  return s || DEFAULT_GLOBAL_BUDGET_SCOPE;
}

function normalizeNumberOption(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pruneGlobalScope(scope, now = Date.now()) {
  const normalizedScope = normalizeBudgetScope(scope);
  const minuteAgo = now - 60000;
  const list = _globalRetryTimestamps.get(normalizedScope) || [];
  const filtered = list.filter((t) => t > minuteAgo);
  if (filtered.length > 0) _globalRetryTimestamps.set(normalizedScope, filtered);
  else _globalRetryTimestamps.delete(normalizedScope);
  return filtered;
}

/**
 * Get global retry stats
 * @param {string} [scope]
 * @param {number} [budgetPerMinute]
 * @returns {{ retriesLastMinute: number, budgetRemaining: number, scope: string }}
 */
export function getGlobalRetryStats(scope = DEFAULT_GLOBAL_BUDGET_SCOPE, budgetPerMinute = DEFAULT_GLOBAL_BUDGET_PER_MINUTE) {
  const normalizedScope = normalizeBudgetScope(scope);
  const timestamps = pruneGlobalScope(normalizedScope);
  const normalizedBudget = normalizeNumberOption(budgetPerMinute, DEFAULT_GLOBAL_BUDGET_PER_MINUTE, { min: 0 });
  return {
    retriesLastMinute: timestamps.length,
    budgetRemaining: Math.max(0, normalizedBudget - timestamps.length),
    scope: normalizedScope,
  };
}

/**
 * Check if global budget allows retry
 * @param {number} [budgetPerMinute]
 * @param {string} [scope]
 * @returns {boolean}
 */
function canRetryGlobal(budgetPerMinute = DEFAULT_GLOBAL_BUDGET_PER_MINUTE, scope = DEFAULT_GLOBAL_BUDGET_SCOPE) {
  const normalizedBudget = normalizeNumberOption(budgetPerMinute, DEFAULT_GLOBAL_BUDGET_PER_MINUTE, { min: 0 });
  const timestamps = pruneGlobalScope(scope);
  return timestamps.length < normalizedBudget;
}

/**
 * Record a global retry
 * @param {string} [scope]
 */
function recordRetryGlobal(scope = DEFAULT_GLOBAL_BUDGET_SCOPE) {
  const normalizedScope = normalizeBudgetScope(scope);
  const list = pruneGlobalScope(normalizedScope);
  list.push(Date.now());
  _globalRetryTimestamps.set(normalizedScope, list);
}

/**
 * Reset global retry stats (for testing)
 * @param {string} [scope]
 */
export function resetGlobalRetryStats(scope) {
  if (scope !== undefined) {
    _globalRetryTimestamps.delete(normalizeBudgetScope(scope));
    return;
  }
  _globalRetryTimestamps = new Map();
}

// ─────────────────────────────────────────────────────────────────────────────
// RetryStrategy
// ─────────────────────────────────────────────────────────────────────────────

export class RetryStrategy {
  /**
   * @param {object} options
   * @param {number} [options.maxRetries=3]
   * @param {number} [options.baseDelayMs=1000]
   * @param {number} [options.maxDelayMs=30000]
   * @param {number} [options.jitterFactor=0.3]
   * @param {number} [options.globalBudgetPerMinute=100]
   * @param {function} [options.isRetryable] - Custom retry condition
   * @param {boolean} [options.useGlobalBudget=true] - Use shared global budget
   * @param {string} [options.budgetScope="__shared__"] - Global budget namespace
   * @param {() => number} [options.random] - RNG for jitter
   */
  constructor({
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    globalBudgetPerMinute = DEFAULT_GLOBAL_BUDGET_PER_MINUTE,
    isRetryable,
    useGlobalBudget = true,
    budgetScope = DEFAULT_GLOBAL_BUDGET_SCOPE,
    random,
  } = {}) {
    this._maxRetries = Math.floor(normalizeNumberOption(maxRetries, DEFAULT_MAX_RETRIES, { min: 0 }));
    this._baseDelayMs = normalizeNumberOption(baseDelayMs, DEFAULT_BASE_DELAY_MS, { min: 0 });
    this._maxDelayMs = normalizeNumberOption(maxDelayMs, DEFAULT_MAX_DELAY_MS, { min: 0 });
    this._jitterFactor = normalizeNumberOption(jitterFactor, DEFAULT_JITTER_FACTOR, { min: 0 });
    this._globalBudgetPerMinute = Math.floor(
      normalizeNumberOption(globalBudgetPerMinute, DEFAULT_GLOBAL_BUDGET_PER_MINUTE, { min: 0 })
    );
    this._isRetryable = typeof isRetryable === "function" ? isRetryable : isRetryableError;
    this._useGlobalBudget = useGlobalBudget;
    this._budgetScope = normalizeBudgetScope(budgetScope);
    this._random = typeof random === "function" ? random : null;

    this._retryTimestamps = []; // timestamps of recent retries (instance-local)
  }

  /**
   * Get stats
   */
  get stats() {
    if (this._useGlobalBudget) {
      const global = getGlobalRetryStats(this._budgetScope, this._globalBudgetPerMinute);
      return {
        retriesLastMinute: global.retriesLastMinute,
        budgetPerMinute: this._globalBudgetPerMinute,
        budgetRemaining: Math.max(0, this._globalBudgetPerMinute - global.retriesLastMinute),
      };
    }

    const now = Date.now();
    const minuteAgo = now - 60000;
    const recentRetries = this._retryTimestamps.filter((t) => t > minuteAgo).length;

    return {
      retriesLastMinute: recentRetries,
      budgetPerMinute: this._globalBudgetPerMinute,
      budgetRemaining: Math.max(0, this._globalBudgetPerMinute - recentRetries),
    };
  }

  /**
   * Calculate delay for retry attempt
   * @param {number} attempt - 0-indexed attempt number
   * @returns {number} Delay in ms
   */
  calculateDelay(attempt) {
    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = this._baseDelayMs * Math.pow(2, attempt);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this._maxDelayMs);

    // Add jitter: delay * (1 ± jitterFactor)
    const randomSource = typeof this._random === "function" ? this._random : Math.random;
    const randomValue = normalizeNumberOption(randomSource(), 0.5, { min: 0, max: 1 });
    const jitter = cappedDelay * this._jitterFactor * (randomValue * 2 - 1);

    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * Check if can retry (global budget)
   * @returns {boolean}
   */
  canRetry() {
    if (this._useGlobalBudget) {
      return canRetryGlobal(this._globalBudgetPerMinute, this._budgetScope);
    }
    // Instance-local budget (legacy behavior)
    const now = Date.now();
    const minuteAgo = now - 60000;
    this._retryTimestamps = this._retryTimestamps.filter((t) => t > minuteAgo);
    return this._retryTimestamps.length < this._globalBudgetPerMinute;
  }

  /**
   * Record a retry attempt
   */
  recordRetry() {
    if (this._useGlobalBudget) {
      recordRetryGlobal(this._budgetScope);
    } else {
      this._retryTimestamps.push(Date.now());
    }
  }

  /**
   * Execute with retry
   * @param {function} fn - Async function to execute
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {function} [options.onRetry] - Callback before retry
   * @returns {Promise<any>}
   */
  async execute(fn, options = {}) {
    const { signal, onRetry } = options;
    let lastError = null;

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Check if should retry
        const isLast = attempt === this._maxRetries;
        const isRetryable = this._isRetryable(error);
        const hasBudget = this.canRetry();

        if (isLast || !isRetryable || !hasBudget) {
          throw error;
        }

        // Record and wait
        this.recordRetry();
        const delay = this.calculateDelay(attempt);

        logger.info("Retrying", {
          attempt: attempt + 1,
          maxRetries: this._maxRetries,
          delayMs: delay,
          error: error?.message,
        });

        if (onRetry) {
          try {
            onRetry({ attempt, delay, error });
          } catch {
            // Ignore callback errors
          }
        }

        await this._sleep(delay, signal);
      }
    }

    throw lastError;
  }

  /**
   * Sleep with abort support
   * @private
   */
  _sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute with default retry strategy
 * @param {function} fn
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export async function withRetry(fn, options = {}) {
  const strategy = new RetryStrategy(options);
  return strategy.execute(fn, options);
}

export default RetryStrategy;
