/**
 * Retry Strategy - 重试风暴预防
 *
 * 特性：
 * - 指数退避 + 抖动
 * - 最大重试次数限制
 * - 全局重试预算（防止雪崩）
 * - 可配置重试条件
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/core/retry-strategy");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_JITTER_FACTOR = 0.3;
const DEFAULT_GLOBAL_BUDGET_PER_MINUTE = 100;

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

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Check if error is retryable
 * @param {Error} error
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
   */
  constructor({
    maxRetries = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    globalBudgetPerMinute = DEFAULT_GLOBAL_BUDGET_PER_MINUTE,
    isRetryable,
  } = {}) {
    this._maxRetries = maxRetries;
    this._baseDelayMs = baseDelayMs;
    this._maxDelayMs = maxDelayMs;
    this._jitterFactor = jitterFactor;
    this._globalBudgetPerMinute = globalBudgetPerMinute;
    this._isRetryable = typeof isRetryable === "function" ? isRetryable : isRetryableError;

    this._retryTimestamps = []; // timestamps of recent retries
  }

  /**
   * Get stats
   */
  get stats() {
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
    const jitter = cappedDelay * this._jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, Math.round(cappedDelay + jitter));
  }

  /**
   * Check if can retry (global budget)
   * @returns {boolean}
   */
  canRetry() {
    const now = Date.now();
    const minuteAgo = now - 60000;
    this._retryTimestamps = this._retryTimestamps.filter((t) => t > minuteAgo);

    return this._retryTimestamps.length < this._globalBudgetPerMinute;
  }

  /**
   * Record a retry attempt
   */
  recordRetry() {
    this._retryTimestamps.push(Date.now());
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

      const timer = setTimeout(resolve, ms);

      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error("Aborted"));
        };
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
