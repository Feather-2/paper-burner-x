/**
 * ContextPredictor - 上下文容量回归预测器
 *
 * 基于加权移动平均的回归预测，动态评估每条消息长度，
 * 预测剩余上下文容量，用于触发主动压缩。
 *
 * @module runtime/compression/context-predictor
 */

import { estimateTokensCached } from "../../../shared/utils/token-cache.js";

/**
 * @typedef {Object} ContextPredictorOptions
 * @property {number} [contextWindow] - 上下文窗口大小（tokens）
 * @property {number} [windowSize] - 滑动窗口大小（消息数）
 * @property {number} [decayFactor] - 权重衰减因子（0-1，越大越重视近期）
 */

/**
 * @typedef {Object} PredictionResult
 * @property {number} currentTokens - 当前使用的 tokens
 * @property {number} fillRatio - 填充率 (0-1)
 * @property {number} avgMessageTokens - 平均消息 tokens（加权）
 * @property {number} predictedRemainingMessages - 预测剩余消息数
 * @property {boolean} shouldCompress - 是否应该压缩
 * @property {string} zone - 当前所在区域 (archive/condensed/working/active)
 */

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_DECAY_FACTOR = 0.9;

export class ContextPredictor {
  /**
   * @param {ContextPredictorOptions} [options]
   */
  constructor({
    contextWindow = DEFAULT_CONTEXT_WINDOW,
    windowSize = DEFAULT_WINDOW_SIZE,
    decayFactor = DEFAULT_DECAY_FACTOR,
  } = {}) {
    this._contextWindow = Math.max(1000, contextWindow);
    this._windowSize = Math.max(5, Math.floor(windowSize));
    this._decayFactor = Math.min(0.99, Math.max(0.5, decayFactor));

    /** @type {number[]} 最近消息的 token 计数 */
    this._recentTokenCounts = [];

    /** @type {number} 累计 tokens */
    this._totalTokens = 0;

    /** @type {number} 消息计数 */
    this._messageCount = 0;
  }

  /**
   * 记录一条消息
   * @param {string|object} message - 消息内容或消息对象
   * @returns {number} 该消息的 token 数
   */
  record(message) {
    const content = typeof message === "string"
      ? message
      : String(message?.content || message?.text || "");

    const tokens = estimateTokensCached(content);

    this._recentTokenCounts.push(tokens);
    while (this._recentTokenCounts.length > this._windowSize) {
      this._recentTokenCounts.shift();
    }

    this._totalTokens += tokens;
    this._messageCount += 1;

    return tokens;
  }

  /**
   * 批量记录多条消息
   * @param {Array} messages
   * @returns {number} 总 tokens
   */
  recordBatch(messages) {
    let total = 0;
    for (const msg of messages) {
      total += this.record(msg);
    }
    return total;
  }

  /**
   * 计算加权平均消息 tokens
   * @returns {number}
   */
  getWeightedAverageTokens() {
    if (this._recentTokenCounts.length === 0) {
      return 500; // 默认估计
    }

    let weightSum = 0;
    let valueSum = 0;
    const n = this._recentTokenCounts.length;

    for (let i = 0; i < n; i++) {
      // 越近的消息权重越大
      const weight = Math.pow(this._decayFactor, n - 1 - i);
      weightSum += weight;
      valueSum += this._recentTokenCounts[i] * weight;
    }

    return weightSum > 0 ? valueSum / weightSum : 500;
  }

  /**
   * 获取当前填充率
   * @param {number} [currentTokens] - 可选，外部提供的当前 token 数
   * @returns {number} 0-1
   */
  getFillRatio(currentTokens) {
    const tokens = typeof currentTokens === "number" ? currentTokens : this._totalTokens;
    return tokens / this._contextWindow;
  }

  /**
   * 预测剩余可容纳的消息数
   * @param {number} [currentTokens]
   * @returns {number}
   */
  predictRemainingMessages(currentTokens) {
    const tokens = typeof currentTokens === "number" ? currentTokens : this._totalTokens;
    const remaining = this._contextWindow - tokens;
    const avgTokens = this.getWeightedAverageTokens();

    if (avgTokens <= 0) return Infinity;
    return Math.max(0, Math.floor(remaining / avgTokens));
  }

  /**
   * 确定当前所在区域
   * @param {number} fillRatio
   * @returns {'archive'|'condensed'|'working'|'active'}
   */
  getZone(fillRatio) {
    if (fillRatio < 0.2) return "archive";
    if (fillRatio < 0.5) return "condensed";
    if (fillRatio < 0.8) return "working";
    return "active";
  }

  /**
   * 综合预测
   * @param {number} [currentTokens]
   * @param {{ compressThreshold?: number }} [options]
   * @returns {PredictionResult}
   */
  predict(currentTokens, { compressThreshold = 0.9 } = {}) {
    const tokens = typeof currentTokens === "number" ? currentTokens : this._totalTokens;
    const fillRatio = this.getFillRatio(tokens);
    const avgMessageTokens = this.getWeightedAverageTokens();
    const predictedRemainingMessages = this.predictRemainingMessages(tokens);
    const zone = this.getZone(fillRatio);
    const shouldCompress = fillRatio >= compressThreshold;

    return {
      currentTokens: tokens,
      fillRatio,
      avgMessageTokens,
      predictedRemainingMessages,
      shouldCompress,
      zone,
    };
  }

  /**
   * 更新上下文窗口大小（模型切换时）
   * @param {number} newWindow
   */
  setContextWindow(newWindow) {
    this._contextWindow = Math.max(1000, newWindow);
  }

  /**
   * 重置状态
   */
  reset() {
    this._recentTokenCounts = [];
    this._totalTokens = 0;
    this._messageCount = 0;
  }

  /**
   * 获取统计信息
   * @returns {{ messageCount: number, totalTokens: number, avgTokens: number, windowSize: number }}
   */
  getStats() {
    return {
      messageCount: this._messageCount,
      totalTokens: this._totalTokens,
      avgTokens: this.getWeightedAverageTokens(),
      windowSize: this._recentTokenCounts.length,
    };
  }
}

export default ContextPredictor;
