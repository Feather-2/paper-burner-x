/**
 * Silent Error Reporter
 *
 * Collects and reports errors from catch blocks that would otherwise be silently swallowed.
 * Provides error categorization, sampling, statistics, and export capabilities.
 *
 * @module runtime/errors/silent-error-reporter
 */

/**
 * Error categories for classification
 * @readonly
 * @enum {string}
 */
export const ErrorCategory = {
  /** Recoverable errors, can be silently handled */
  RECOVERABLE: 'recoverable',
  /** Feature degradation occurred */
  DEGRADED: 'degraded',
  /** Critical errors that need attention */
  CRITICAL: 'critical',
};

/**
 * @typedef {Object} ErrorEntry
 * @property {string} [message] - Error message
 * @property {string} [stack] - Truncated stack trace (first 3 lines)
 * @property {string} location - Source location identifier
 * @property {string} category - Error category
 * @property {string} [operation] - Operation being performed
 * @property {number} ts - Timestamp
 */

/**
 * @typedef {Object} ErrorStats
 * @property {number} total - Total error count
 * @property {Record<string, number>} byCategory - Counts grouped by category
 * @property {Record<string, number>} byLocation - Counts grouped by location
 */

/**
 * @typedef {Object} SilentErrorReporterOptions
 * @property {boolean} [enabled=true] - Whether reporting is enabled
 * @property {number} [maxSamples=100] - Maximum samples to retain
 * @property {((entry: ErrorEntry) => void)} [onError] - Callback for each error
 */

/**
 * Silent Error Reporter
 * Collects errors from catch blocks for debugging and monitoring.
 */
export class SilentErrorReporter {
  /**
   * @param {SilentErrorReporterOptions} [options]
   */
  constructor(options = {}) {
    /** @type {boolean} */
    this._enabled = options.enabled ?? true;
    /** @type {ErrorEntry[]} */
    this._samples = [];
    /** @type {number} */
    this._maxSamples = options.maxSamples ?? 100;
    /** @type {((entry: ErrorEntry) => void) | null} */
    this._onError = options.onError ?? null;
  }

  /**
   * Enable or disable reporting
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  /**
   * Check if reporting is enabled
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Report a silent error
   * @param {Error | unknown} error - The caught error
   * @param {Object} context - Error context
   * @param {string} context.location - Source location identifier (e.g., 'MessageManager.compress')
   * @param {string} [context.category] - Error category (defaults to RECOVERABLE)
   * @param {string} [context.operation] - Operation being performed
   */
  report(error, context) {
    if (!this._enabled) return;

    const err = error instanceof Error ? error : null;
    /** @type {ErrorEntry} */
    const entry = {
      message: err?.message ?? String(error),
      stack: err?.stack?.split('\n').slice(0, 3).join('\n'),
      location: context.location,
      category: context.category ?? ErrorCategory.RECOVERABLE,
      operation: context.operation,
      ts: Date.now(),
    };

    this._samples.push(entry);

    // Ring buffer behavior
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }

    if (this._onError) {
      try {
        this._onError(entry);
      } catch {
        // Prevent callback errors from propagating
      }
    }
  }

  /**
   * Group samples by a key
   * @param {'category' | 'location'} key
   * @returns {Record<string, number>}
   * @private
   */
  _groupBy(key) {
    /** @type {Record<string, number>} */
    const groups = {};
    for (const sample of this._samples) {
      const value = sample[key] ?? 'unknown';
      groups[value] = (groups[value] ?? 0) + 1;
    }
    return groups;
  }

  /**
   * Get error statistics
   * @returns {ErrorStats}
   */
  getStats() {
    return {
      total: this._samples.length,
      byCategory: this._groupBy('category'),
      byLocation: this._groupBy('location'),
    };
  }

  /**
   * Export all sampled errors
   * @returns {ErrorEntry[]}
   */
  export() {
    return [...this._samples];
  }

  /**
   * Get recent errors (most recent first)
   * @param {number} [limit=10] - Maximum entries to return
   * @returns {ErrorEntry[]}
   */
  getRecent(limit = 10) {
    return this._samples.slice(-limit).reverse();
  }

  /**
   * Clear all samples
   */
  clear() {
    this._samples = [];
  }

  /**
   * Get sample count
   * @returns {number}
   */
  get size() {
    return this._samples.length;
  }
}

/** Global singleton instance */
export const silentErrors = new SilentErrorReporter();

/**
 * Convenience function for reporting silent errors
 * @param {Error | unknown} error - The caught error
 * @param {string} location - Source location identifier
 * @param {string} [category] - Error category (defaults to RECOVERABLE)
 */
export function reportSilentError(error, location, category = ErrorCategory.RECOVERABLE) {
  silentErrors.report(error, { location, category });
}

/**
 * Create a scoped reporter for a specific module
 * @param {string} moduleName - Module name prefix
 * @returns {{ report: (error: unknown, method: string, category?: string) => void }}
 */
export function createScopedReporter(moduleName) {
  return {
    report(error, method, category = ErrorCategory.RECOVERABLE) {
      silentErrors.report(error, {
        location: `${moduleName}.${method}`,
        category,
      });
    },
  };
}
