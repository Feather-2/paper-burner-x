/**
 * Degradation Matrix - 多级降级矩阵
 *
 * 特性：
 * - Normal/Degraded/Critical 三级状态
 * - 基于指标的自动降级
 * - 降级策略配置
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/resilience/degradation-matrix");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 系统运行级别
 */
export const OperationLevel = Object.freeze({
  NORMAL: "normal", // 正常运行
  DEGRADED: "degraded", // 降级运行
  CRITICAL: "critical", // 危急状态
  OFFLINE: "offline", // 离线
});

/** @typedef {(typeof OperationLevel)[keyof typeof OperationLevel]} OperationLevelValue */

/**
 * 降级触发器类型
 */
export const DegradationTrigger = Object.freeze({
  ERROR_RATE: "error_rate",
  LATENCY: "latency",
  MEMORY: "memory",
  QUOTA: "quota",
  TIMEOUT: "timeout",
  MANUAL: "manual",
});

/** @typedef {(typeof DegradationTrigger)[keyof typeof DegradationTrigger]} DegradationTriggerValue */

// ─────────────────────────────────────────────────────────────────────────────
// Degradation Policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 默认降级阈值
 */
const DEFAULT_THRESHOLDS = {
  errorRateDegraded: 0.1, // 10% 错误率触发降级
  errorRateCritical: 0.3, // 30% 错误率触发危急
  latencyDegradedMs: 2000, // 2秒延迟触发降级
  latencyCriticalMs: 5000, // 5秒延迟触发危急
  memoryDegradedRatio: 0.7, // 70% 内存触发降级
  memoryCriticalRatio: 0.9, // 90% 内存触发危急
};

/**
 * 降级策略
 */
export class DegradationPolicy {
  constructor(config = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };

    /**
     * 各级别可用的功能
     */
    this.features = {
      [OperationLevel.NORMAL]: {
        parallelRequests: true,
        caching: true,
        retries: true,
        fullSearch: true,
        externalApis: true,
        backgroundTasks: true,
      },
      [OperationLevel.DEGRADED]: {
        parallelRequests: false, // 改为顺序执行
        caching: true,
        retries: true,
        fullSearch: false, // 简化搜索
        externalApis: true,
        backgroundTasks: false, // 暂停后台任务
      },
      [OperationLevel.CRITICAL]: {
        parallelRequests: false,
        caching: true,
        retries: false, // 禁用重试
        fullSearch: false,
        externalApis: false, // 禁用外部 API
        backgroundTasks: false,
      },
      [OperationLevel.OFFLINE]: {
        parallelRequests: false,
        caching: true, // 仅缓存可用
        retries: false,
        fullSearch: false,
        externalApis: false,
        backgroundTasks: false,
      },
      ...config.features,
    };
  }

  /**
   * 检查功能是否可用
   * @param {OperationLevelValue} level - 运行级别
   * @param {string} feature - 功能名称
   * @returns {boolean} 功能是否可用
   */
  isFeatureEnabled(level, feature) {
    return this.features[level]?.[feature] ?? false;
  }

  /**
   * 获取级别的所有可用功能
   * @param {OperationLevelValue} level - 运行级别
   * @returns {string[]} 可用功能名称数组
   */
  getEnabledFeatures(level) {
    return Object.entries(this.features[level] || {})
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Metrics
// ─────────────────────────────────────────────────────────────────────────────

class HealthMetrics {
  constructor(windowMs = 60000) {
    this._windowMs = windowMs;
    this._requests = [];
    this._errors = [];
    this._latencies = [];
  }

  recordRequest(latencyMs, isError = false) {
    const now = Date.now();
    this._requests.push(now);
    this._latencies.push({ ts: now, value: latencyMs });

    if (isError) {
      this._errors.push(now);
    }

    this._cleanup(now);
  }

  _cleanup(now) {
    const cutoff = now - this._windowMs;
    this._requests = this._requests.filter((ts) => ts >= cutoff);
    this._errors = this._errors.filter((ts) => ts >= cutoff);
    this._latencies = this._latencies.filter((l) => l.ts >= cutoff);
  }

  get errorRate() {
    this._cleanup(Date.now());
    return this._requests.length > 0 ? this._errors.length / this._requests.length : 0;
  }

  get avgLatency() {
    this._cleanup(Date.now());
    if (this._latencies.length === 0) return 0;
    return this._latencies.reduce((sum, l) => sum + l.value, 0) / this._latencies.length;
  }

  get p99Latency() {
    this._cleanup(Date.now());
    if (this._latencies.length === 0) return 0;
    const sorted = [...this._latencies].sort((a, b) => a.value - b.value);
    const idx = Math.floor(sorted.length * 0.99);
    return sorted[idx]?.value || sorted[sorted.length - 1]?.value || 0;
  }

  get requestCount() {
    this._cleanup(Date.now());
    return this._requests.length;
  }

  reset() {
    this._requests = [];
    this._errors = [];
    this._latencies = [];
  }

  toJSON() {
    return {
      errorRate: this.errorRate,
      avgLatency: this.avgLatency,
      p99Latency: this.p99Latency,
      requestCount: this.requestCount,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Degradation Matrix
// ─────────────────────────────────────────────────────────────────────────────

export class DegradationMatrix {
  /**
   * @param {object} options
   * @param {DegradationPolicy} [options.policy] - 降级策略
   * @param {number} [options.metricsWindowMs=60000] - 指标窗口
   * @param {function} [options.onLevelChange] - 级别变更回调
   * @param {function} [options.getMemoryUsage] - 获取内存使用率函数
   */
  constructor({
    policy,
    metricsWindowMs = 60000,
    onLevelChange,
    getMemoryUsage,
  } = {}) {
    this._policy = policy || new DegradationPolicy();
    this._onLevelChange = typeof onLevelChange === "function" ? onLevelChange : null;
    this._getMemoryUsage = typeof getMemoryUsage === "function" ? getMemoryUsage : null;

    /** @type {OperationLevelValue} */
    this._currentLevel = OperationLevel.NORMAL;

    /** @type {Array<{from: OperationLevelValue, to: OperationLevelValue, trigger: DegradationTriggerValue|null, ts: number}>} */
    this._levelHistory = [];

    /** @type {Set<DegradationTriggerValue>} */
    this._triggers = new Set();
    this._metrics = new HealthMetrics(metricsWindowMs);

    /** @type {OperationLevelValue|null} */
    this._manualOverride = null;
    this._lastEvaluation = 0;
  }

  /**
   * 记录请求结果
   * @param {object} result
   */
  recordRequest({ latencyMs = 0, isError = false } = {}) {
    // Validate: latencyMs must be finite non-negative; isError must be boolean
    const validLatency = typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0
      ? latencyMs
      : 0;
    const validIsError = typeof isError === "boolean" ? isError : false;

    this._metrics.recordRequest(validLatency, validIsError);
    this._evaluate();
  }

  /**
   * 评估当前状态
   * @private
   */
  _evaluate() {
    // 限制评估频率
    const now = Date.now();
    if (now - this._lastEvaluation < 1000) return;
    this._lastEvaluation = now;

    // 如果有手动覆盖，使用覆盖值
    if (this._manualOverride) {
      this._setLevel(this._manualOverride, DegradationTrigger.MANUAL);
      return;
    }

    const thresholds = this._policy.thresholds;
    const errorRate = this._metrics.errorRate;
    const avgLatency = this._metrics.avgLatency;
    const memoryRatio = this._getMemoryUsage?.() ?? 0;

    this._triggers.clear();
    /** @type {OperationLevelValue} */
    let newLevel = OperationLevel.NORMAL;

    // 错误率检查
    if (errorRate >= thresholds.errorRateCritical) {
      newLevel = OperationLevel.CRITICAL;
      this._triggers.add(DegradationTrigger.ERROR_RATE);
    } else if (errorRate >= thresholds.errorRateDegraded) {
      newLevel = this._maxLevel(newLevel, OperationLevel.DEGRADED);
      this._triggers.add(DegradationTrigger.ERROR_RATE);
    }

    // 延迟检查
    if (avgLatency >= thresholds.latencyCriticalMs) {
      newLevel = OperationLevel.CRITICAL;
      this._triggers.add(DegradationTrigger.LATENCY);
    } else if (avgLatency >= thresholds.latencyDegradedMs) {
      newLevel = this._maxLevel(newLevel, OperationLevel.DEGRADED);
      this._triggers.add(DegradationTrigger.LATENCY);
    }

    // 内存检查
    if (memoryRatio >= thresholds.memoryCriticalRatio) {
      newLevel = OperationLevel.CRITICAL;
      this._triggers.add(DegradationTrigger.MEMORY);
    } else if (memoryRatio >= thresholds.memoryDegradedRatio) {
      newLevel = this._maxLevel(newLevel, OperationLevel.DEGRADED);
      this._triggers.add(DegradationTrigger.MEMORY);
    }

    this._setLevel(newLevel, [...this._triggers][0] || null);
  }

  /**
   * 设置级别
   * @private
   * @param {OperationLevelValue} newLevel
   * @param {DegradationTriggerValue|null} trigger
   */
  _setLevel(newLevel, trigger) {
    if (newLevel === this._currentLevel) return;

    const oldLevel = this._currentLevel;
    this._currentLevel = newLevel;

    this._levelHistory.push({
      from: oldLevel,
      to: newLevel,
      trigger,
      ts: Date.now(),
    });

    // 保持历史记录在合理范围
    if (this._levelHistory.length > 100) {
      this._levelHistory = this._levelHistory.slice(-100);
    }

    logger.warn("Operation level changed", { from: oldLevel, to: newLevel, trigger });

    if (this._onLevelChange) {
      try {
        this._onLevelChange({ from: oldLevel, to: newLevel, trigger });
      } catch (err) {
        logger.error("onLevelChange callback threw", { error: err });
      }
    }
  }

  /**
   * 比较级别严重程度
   * @private
   * @param {OperationLevelValue} a
   * @param {OperationLevelValue} b
   * @returns {OperationLevelValue}
   */
  _maxLevel(a, b) {
    const order = [OperationLevel.NORMAL, OperationLevel.DEGRADED, OperationLevel.CRITICAL, OperationLevel.OFFLINE];
    const idxA = order.indexOf(a);
    const idxB = order.indexOf(b);
    return order[Math.max(idxA, idxB)];
  }

  /**
   * 获取当前级别
   */
  get currentLevel() {
    return this._currentLevel;
  }

  /**
   * 检查功能是否可用
   * @param {string} feature
   */
  isFeatureEnabled(feature) {
    return this._policy.isFeatureEnabled(this._currentLevel, feature);
  }

  /**
   * 获取当前可用功能
   */
  getEnabledFeatures() {
    return this._policy.getEnabledFeatures(this._currentLevel);
  }

  /**
   * 手动设置级别（覆盖自动计算）
   * @param {OperationLevelValue} level
   */
  setManualOverride(level) {
    if (Object.values(OperationLevel).includes(level)) {
      this._manualOverride = level;
      this._evaluate();
    }
  }

  /**
   * 清除手动覆盖
   */
  clearManualOverride() {
    this._manualOverride = null;
    this._evaluate();
  }

  /**
   * 强制重新评估
   */
  forceEvaluate() {
    this._lastEvaluation = 0;
    this._evaluate();
  }

  /**
   * 获取状态摘要
   */
  getStatus() {
    return {
      level: this._currentLevel,
      triggers: [...this._triggers],
      metrics: this._metrics.toJSON(),
      enabledFeatures: this.getEnabledFeatures(),
      manualOverride: this._manualOverride,
      recentChanges: this._levelHistory.slice(-5),
    };
  }

  /**
   * 重置到正常状态
   */
  reset() {
    this._currentLevel = OperationLevel.NORMAL;
    this._triggers.clear();
    this._manualOverride = null;
    this._metrics.reset();
    this._levelHistory = [];
  }

  /**
   * 获取降级建议
   */
  getRecommendations() {
    const status = this.getStatus();
    const recommendations = [];

    if (this._triggers.has(DegradationTrigger.ERROR_RATE)) {
      recommendations.push({
        type: "error_rate",
        severity: this._currentLevel,
        message: `Error rate (${(status.metrics.errorRate * 100).toFixed(1)}%) exceeds threshold`,
        action: "Review error logs and fix underlying issues",
      });
    }

    if (this._triggers.has(DegradationTrigger.LATENCY)) {
      recommendations.push({
        type: "latency",
        severity: this._currentLevel,
        message: `Average latency (${status.metrics.avgLatency.toFixed(0)}ms) exceeds threshold`,
        action: "Consider caching or query optimization",
      });
    }

    if (this._triggers.has(DegradationTrigger.MEMORY)) {
      recommendations.push({
        type: "memory",
        severity: this._currentLevel,
        message: "Memory usage exceeds threshold",
        action: "Clear caches or reduce concurrent operations",
      });
    }

    return recommendations;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default DegradationMatrix;
