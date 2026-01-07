import { compressAgentLoopMessagesAsync } from "./compression-async.js";

/**
 * @typedef {Object} CompressionCoordinatorOptions
 * @property {() => Record<string, any>} [getContextConfig]
 * @property {() => any} [getTokenUsage]
 * @property {any} [logger]
 */

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {number} totalTokens
 * @param {number} contextWindow
 * @returns {number}
 */
function computeFillRatio(totalTokens, contextWindow) {
  return contextWindow ? totalTokens / contextWindow : 0;
}

export class CompressionCoordinator {
  /**
   * @param {CompressionCoordinatorOptions} [options]
   */
  constructor({ getContextConfig, getTokenUsage, logger } = {}) {
    this._getContextConfig = typeof getContextConfig === "function" ? getContextConfig : () => ({});
    this._getTokenUsage = typeof getTokenUsage === "function" ? getTokenUsage : () => ({ total: 0 });
    this._logger = logger || null;
  }

  /**
   * @returns {number}
   */
  _resolveTokenUsageTotal() {
    const usage = this._getTokenUsage?.();
    if (usage && typeof usage === "object") {
      const total = toFiniteNumber(usage.total, 0);
      return total >= 0 ? total : 0;
    }
    const total = toFiniteNumber(usage, 0);
    return total >= 0 ? total : 0;
  }

  /**
   * Decide whether the loop is over its context budget.
   * Used for scheduling; does not perform compression.
   *
   * @returns {boolean}
   */
  shouldCompress() {
    const cfg = this._getContextConfig?.() || {};
    const threshold = cfg.contextWindow * cfg.compressThreshold;
    return this._resolveTokenUsageTotal() >= threshold;
  }

  /**
   * Maybe compress messages (async).
   * Encapsulates trigger logic for title-only mode and worker threshold.
   *
   * @param {Array} messages
   * @returns {Promise<{messages:Array, sessionSummary:string|null, stats:object|null, afterTokens:number|undefined}>}
   */
  async maybeCompress(messages) {
    const cfg = this._getContextConfig?.() || {};
    const totalTokens = this._resolveTokenUsageTotal();
    const fillRatio = computeFillRatio(totalTokens, cfg.contextWindow);
    const titleThresholdRaw = cfg.titleOnlySummaryThreshold;
    const titleThreshold =
      typeof titleThresholdRaw === "number" && Number.isFinite(titleThresholdRaw) ? titleThresholdRaw : 0.8;
    const titleOnly = fillRatio >= titleThreshold;

    const runtime = {
      useWorker: cfg.useCompressionWorker !== false,
      workerThresholdMessages: cfg.workerThresholdMessages,
    };

    try {
      return await compressAgentLoopMessagesAsync(
        messages,
        {
          keepLastTurns: cfg.keepLastTurns,
          titleOnly,
          titleMaxWords: cfg.titleOnlySummaryMaxWords,
          titleMaxChars: cfg.titleOnlySummaryMaxChars,
          maxKeptMessageChars: cfg.maxKeptMessageChars,
        },
        runtime
      );
    } catch (err) {
      if (this._logger && typeof this._logger.warn === "function") {
        this._logger.warn("[CompressionCoordinator] Compression failed:", err?.message);
      }
      return { messages: Array.isArray(messages) ? messages : [], sessionSummary: null, stats: null, afterTokens: undefined };
    }
  }
}

export { computeFillRatio };
