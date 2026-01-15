/**
 * CompressionQualityMonitor - 压缩质量监控器
 *
 * 评估压缩后信息保留率，支持趋势分析和健康检查。
 * 用于动态调整压缩策略，确保重要信息不丢失。
 *
 * @module runtime/compression/quality-monitor
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * @typedef {Object} CompressionStats
 * @property {number} beforeTokens - 压缩前 token 数
 * @property {number} afterTokens - 压缩后 token 数
 * @property {number} [keptMessages] - 保留消息数
 * @property {number} [summarizedMessages] - 摘要消息数
 * @property {number} [archivedMessages] - 归档消息数
 * @property {number} [timestamp] - 记录时间戳
 */

/**
 * @typedef {Object} QualityAssessment
 * @property {number} avgRetention - 平均保留率 (0-1)
 * @property {number} belowThresholdCount - 低于阈值的次数
 * @property {'improving'|'stable'|'degrading'} trend - 趋势
 * @property {number} sampleCount - 样本数量
 */

/**
 * @typedef {Object} HealthCheckResult
 * @property {boolean} needsAdjustment - 是否需要调整策略
 * @property {string} recommendation - 调整建议
 * @property {'healthy'|'warning'|'critical'} status - 健康状态
 */

/**
 * @typedef {Object} QualityMonitorOptions
 * @property {number} [minRetentionRatio] - 最小保留率阈值 (0-1)，默认 0.7
 * @property {number} [maxSamples] - 最大样本数，默认 100
 * @property {number} [trendWindowSize] - 趋势分析窗口大小，默认 10
 * @property {number} [warningThreshold] - 警告阈值（低于阈值次数比例），默认 0.2
 * @property {number} [criticalThreshold] - 临界阈值，默认 0.4
 */

// ============================================================================
// 常量
// ============================================================================

const DEFAULT_MIN_RETENTION_RATIO = 0.7;
const DEFAULT_MAX_SAMPLES = 100;
const DEFAULT_TREND_WINDOW_SIZE = 10;
const DEFAULT_WARNING_THRESHOLD = 0.2;
const DEFAULT_CRITICAL_THRESHOLD = 0.4;

// ============================================================================
// 实现
// ============================================================================

export class CompressionQualityMonitor {
  /**
   * @param {QualityMonitorOptions} [options]
   */
  constructor(options = {}) {
    this._minRetentionRatio = Math.max(0, Math.min(1, options.minRetentionRatio ?? DEFAULT_MIN_RETENTION_RATIO));
    this._maxSamples = Math.max(10, Math.floor(options.maxSamples ?? DEFAULT_MAX_SAMPLES));
    this._trendWindowSize = Math.max(3, Math.floor(options.trendWindowSize ?? DEFAULT_TREND_WINDOW_SIZE));
    this._warningThreshold = Math.max(0, Math.min(1, options.warningThreshold ?? DEFAULT_WARNING_THRESHOLD));
    this._criticalThreshold = Math.max(0, Math.min(1, options.criticalThreshold ?? DEFAULT_CRITICAL_THRESHOLD));

    /** @type {Array<{retention: number, timestamp: number, stats: CompressionStats}>} */
    this._samples = [];
  }

  /**
   * 记录压缩结果
   * @param {CompressionStats} stats - 压缩统计
   * @returns {{ retention: number, belowThreshold: boolean }}
   */
  record(stats) {
    const beforeTokens = Math.max(0, Number(stats.beforeTokens) || 0);
    const afterTokens = Math.max(0, Number(stats.afterTokens) || 0);

    // 计算保留率
    const retention = beforeTokens > 0 ? afterTokens / beforeTokens : 1;
    const belowThreshold = retention < this._minRetentionRatio;

    const sample = {
      retention,
      timestamp: stats.timestamp ?? Date.now(),
      stats: {
        beforeTokens,
        afterTokens,
        keptMessages: Math.max(0, Number(stats.keptMessages) || 0),
        summarizedMessages: Math.max(0, Number(stats.summarizedMessages) || 0),
        archivedMessages: Math.max(0, Number(stats.archivedMessages) || 0),
      },
    };

    this._samples.push(sample);

    // 超过最大样本数时移除最老的
    while (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }

    return { retention, belowThreshold };
  }

  /**
   * 获取质量评估
   * @returns {QualityAssessment}
   */
  getAssessment() {
    const sampleCount = this._samples.length;

    if (sampleCount === 0) {
      return {
        avgRetention: 1,
        belowThresholdCount: 0,
        trend: "stable",
        sampleCount: 0,
      };
    }

    // 计算平均保留率
    const totalRetention = this._samples.reduce((sum, s) => sum + s.retention, 0);
    const avgRetention = totalRetention / sampleCount;

    // 计算低于阈值次数
    const belowThresholdCount = this._samples.filter((s) => s.retention < this._minRetentionRatio).length;

    // 计算趋势
    const trend = this._computeTrend();

    return {
      avgRetention,
      belowThresholdCount,
      trend,
      sampleCount,
    };
  }

  /**
   * 检查是否需要调整策略
   * @returns {HealthCheckResult}
   */
  checkHealth() {
    const assessment = this.getAssessment();

    if (assessment.sampleCount === 0) {
      return {
        needsAdjustment: false,
        recommendation: "No compression data available yet",
        status: "healthy",
      };
    }

    const belowRatio = assessment.belowThresholdCount / assessment.sampleCount;

    // 临界状态: 低于阈值的比例超过临界阈值
    if (belowRatio >= this._criticalThreshold) {
      return {
        needsAdjustment: true,
        recommendation: `Critical: ${(belowRatio * 100).toFixed(1)}% of compressions below ${(this._minRetentionRatio * 100).toFixed(0)}% retention. Consider increasing keepLastTurns or reducing compression aggressiveness.`,
        status: "critical",
      };
    }

    // 警告状态: 低于阈值的比例超过警告阈值，或趋势恶化
    if (belowRatio >= this._warningThreshold || assessment.trend === "degrading") {
      const trendMsg = assessment.trend === "degrading" ? " Trend is degrading." : "";
      return {
        needsAdjustment: true,
        recommendation: `Warning: ${(belowRatio * 100).toFixed(1)}% of compressions below ${(this._minRetentionRatio * 100).toFixed(0)}% retention.${trendMsg} Monitor closely and consider adjusting compression parameters.`,
        status: "warning",
      };
    }

    // 健康状态
    const trendMsg =
      assessment.trend === "improving" ? " Trend is improving." : "";
    return {
      needsAdjustment: false,
      recommendation: `Healthy: Average retention at ${(assessment.avgRetention * 100).toFixed(1)}%.${trendMsg}`,
      status: "healthy",
    };
  }

  /**
   * 获取最近的样本统计
   * @param {number} [count] - 返回的样本数量，默认全部
   * @returns {Array<{retention: number, timestamp: number, stats: CompressionStats}>}
   */
  getSamples(count) {
    if (count === undefined || count >= this._samples.length) {
      return [...this._samples];
    }
    return this._samples.slice(-count);
  }

  /**
   * 清空所有样本
   */
  reset() {
    this._samples = [];
  }

  /**
   * 获取配置
   * @returns {{ minRetentionRatio: number, maxSamples: number, trendWindowSize: number }}
   */
  getConfig() {
    return {
      minRetentionRatio: this._minRetentionRatio,
      maxSamples: this._maxSamples,
      trendWindowSize: this._trendWindowSize,
      warningThreshold: this._warningThreshold,
      criticalThreshold: this._criticalThreshold,
    };
  }

  /**
   * 计算趋势
   * @private
   * @returns {'improving'|'stable'|'degrading'}
   */
  _computeTrend() {
    const windowSize = Math.min(this._trendWindowSize, this._samples.length);

    if (windowSize < 3) {
      return "stable";
    }

    // 取最近的窗口样本
    const recentSamples = this._samples.slice(-windowSize);

    // 计算前半部分和后半部分的平均保留率
    const midPoint = Math.floor(windowSize / 2);
    const firstHalf = recentSamples.slice(0, midPoint);
    const secondHalf = recentSamples.slice(midPoint);

    const firstAvg = firstHalf.reduce((sum, s) => sum + s.retention, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, s) => sum + s.retention, 0) / secondHalf.length;

    // 计算变化率
    const changeRate = (secondAvg - firstAvg) / Math.max(firstAvg, 0.01);

    // 阈值判断
    if (changeRate > 0.05) {
      return "improving";
    }
    if (changeRate < -0.05) {
      return "degrading";
    }
    return "stable";
  }
}
