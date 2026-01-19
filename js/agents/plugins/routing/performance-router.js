/**
 * Performance Router - 性能感知路由
 *
 * 特性：
 * - EWMA 延迟追踪
 * - 语义分层路由 (Fast/Power Tier)
 * - 自适应负载均衡
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("runtime/routing/performance-router");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_EWMA_ALPHA = 0.3; // EWMA 衰减因子
const DEFAULT_ERROR_PENALTY_MS = 5000; // 错误惩罚延迟

/**
 * 模型分层
 */
export const ModelTier = Object.freeze({
  FAST: "fast", // 快速响应，低成本
  POWER: "power", // 高性能，复杂任务
  FALLBACK: "fallback", // 降级备选
});

/**
 * @typedef {(typeof ModelTier)[keyof typeof ModelTier]} ModelTierType
 */

/**
 * 任务复杂度
 */
export const TaskComplexity = Object.freeze({
  SIMPLE: "simple", // 简单任务
  MODERATE: "moderate", // 中等复杂度
  COMPLEX: "complex", // 复杂任务
});

/**
 * @typedef {(typeof TaskComplexity)[keyof typeof TaskComplexity]} TaskComplexityType
 */

// ─────────────────────────────────────────────────────────────────────────────
// EWMA Tracker
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EWMA (指数加权移动平均) 延迟追踪器
 */
export class EwmaTracker {
  /**
   * @param {object} options
   * @param {number} [options.alpha=0.3] - 衰减因子 (0-1)
   * @param {number} [options.initialValue=0] - 初始值
   */
  constructor({ alpha = DEFAULT_EWMA_ALPHA, initialValue = 0 } = {}) {
    this._alpha = Math.max(0.01, Math.min(0.99, alpha));
    this._value = initialValue;
    this._count = 0;
    this._min = Infinity;
    this._max = -Infinity;
  }

  /**
   * 记录新样本
   * @param {number} sample
   * @returns {number} - 更新后的 EWMA 值
   */
  record(sample) {
    if (typeof sample !== "number" || !Number.isFinite(sample)) {
      return this._value;
    }

    if (this._count === 0) {
      this._value = sample;
    } else {
      this._value = this._alpha * sample + (1 - this._alpha) * this._value;
    }

    this._count++;
    this._min = Math.min(this._min, sample);
    this._max = Math.max(this._max, sample);

    return this._value;
  }

  /**
   * 获取当前 EWMA 值
   */
  get value() {
    return this._value;
  }

  /**
   * 获取统计信息
   */
  get stats() {
    return {
      ewma: this._value,
      count: this._count,
      min: this._count > 0 ? this._min : 0,
      max: this._count > 0 ? this._max : 0,
    };
  }

  /**
   * 重置
   */
  reset() {
    this._value = 0;
    this._count = 0;
    this._min = Infinity;
    this._max = -Infinity;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint Stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 端点统计
 */
class EndpointStats {
  constructor(endpointId) {
    this.id = endpointId;
    this.latencyTracker = new EwmaTracker();
    this.successCount = 0;
    this.errorCount = 0;
    this.lastError = null;
    this.lastSuccess = null;
    /** @type {ModelTierType} */
    this.tier = ModelTier.POWER;
    this.weight = 1.0;
  }

  recordSuccess(latencyMs) {
    this.latencyTracker.record(latencyMs);
    this.successCount++;
    this.lastSuccess = Date.now();
  }

  recordError(errorMsg) {
    // 记录惩罚延迟
    this.latencyTracker.record(DEFAULT_ERROR_PENALTY_MS);
    this.errorCount++;
    this.lastError = { ts: Date.now(), message: errorMsg };
  }

  get successRate() {
    const total = this.successCount + this.errorCount;
    return total > 0 ? this.successCount / total : 1;
  }

  get score() {
    // 综合评分：延迟越低、成功率越高，评分越高
    const latencyScore = 1 / (1 + this.latencyTracker.value / 1000);
    const reliabilityScore = this.successRate;
    return latencyScore * reliabilityScore * this.weight;
  }

  toJSON() {
    return {
      id: this.id,
      tier: this.tier,
      latency: this.latencyTracker.stats,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate: this.successRate,
      score: this.score,
      weight: this.weight,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Router
// ─────────────────────────────────────────────────────────────────────────────

export class PerformanceRouter {
  /**
   * @param {object} options
   * @param {boolean} [options.preferFastTier=true] - 优先快速层
   * @param {function} [options.onRouteDecision] - 路由决策回调
   */
  constructor({
    preferFastTier = true,
    onRouteDecision,
  } = {}) {
    this._preferFastTier = preferFastTier;
    this._onRouteDecision = typeof onRouteDecision === "function" ? onRouteDecision : null;

    /** @type {Map<string, EndpointStats>} */
    this._endpoints = new Map();
  }

  /**
   * 注册端点
   * @param {string} endpointId - 端点标识符
   * @param {object} [options] - 配置选项
   * @param {ModelTierType} [options.tier=ModelTier.POWER] - 端点层级
   * @param {number} [options.weight=1.0] - 端点权重 (0-10)
   * @returns {this} 链式调用
   */
  registerEndpoint(endpointId, { tier = ModelTier.POWER, weight = 1.0 } = {}) {
    if (!this._endpoints.has(endpointId)) {
      const stats = new EndpointStats(endpointId);
      // Validate tier - must be a valid ModelTier value
      stats.tier = Object.values(ModelTier).includes(tier) ? tier : ModelTier.POWER;
      // Validate weight - must be finite number, clamped to [0, 10]
      stats.weight = typeof weight === "number" && Number.isFinite(weight)
        ? Math.max(0, Math.min(10, weight))
        : 1.0;
      this._endpoints.set(endpointId, stats);
    }
    return this;
  }

  /**
   * 记录请求结果
   * @param {string} endpointId - 端点标识符
   * @param {object} [result] - 请求结果
   * @param {boolean} [result.success] - 是否成功
   * @param {number} [result.latencyMs] - 延迟毫秒数 (需 >= 0)
   * @param {string} [result.error] - 错误信息
   * @returns {void}
   */
  recordResult(endpointId, { success, latencyMs, error } = {}) {
    // Validate endpointId
    if (typeof endpointId !== "string" || !endpointId) {
      return;
    }

    let stats = this._endpoints.get(endpointId);
    if (!stats) {
      stats = new EndpointStats(endpointId);
      this._endpoints.set(endpointId, stats);
    }

    if (success) {
      // Validate latencyMs - must be finite non-negative number
      const validLatency = typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0
        ? latencyMs
        : 0;
      stats.recordSuccess(validLatency);
    } else {
      stats.recordError(error || "Unknown error");
    }
  }

  /**
   * 选择最佳端点
   * @param {object} [options] - 选择选项
   * @param {TaskComplexityType} [options.complexity=TaskComplexity.MODERATE] - 任务复杂度
   * @param {string[]} [options.excludeIds=[]] - 排除的端点 ID 列表
   * @param {string[] | null} [options.includeIds=null] - 仅包含的端点 ID 列表
   * @returns {{ endpointId: string, reason: string } | null} 选择结果，无可用端点返回 null
   */
  selectEndpoint({ complexity = TaskComplexity.MODERATE, excludeIds = [], includeIds = null } = {}) {
    const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : []);
    const included = Array.isArray(includeIds) ? new Set(includeIds) : null;

    const candidates = [...this._endpoints.values()].filter((e) => {
      if (excluded.has(e.id)) return false;
      if (included && !included.has(e.id)) return false;
      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // 根据复杂度决定目标层级
    /** @type {ModelTierType} */
    let targetTier = ModelTier.POWER;
    if (complexity === TaskComplexity.SIMPLE && this._preferFastTier) {
      targetTier = ModelTier.FAST;
    }

    // 优先选择目标层级的端点
    let tierCandidates = candidates.filter((e) => e.tier === targetTier);
    if (tierCandidates.length === 0) {
      tierCandidates = candidates; // 回退到所有候选
    }

    // 按评分排序
    tierCandidates.sort((a, b) => b.score - a.score);

    const selected = tierCandidates[0];
    const reason = `tier=${selected.tier}, score=${selected.score.toFixed(3)}, latency=${selected.latencyTracker.value.toFixed(0)}ms`;

    if (this._onRouteDecision) {
      this._onRouteDecision({ endpointId: selected.id, reason, complexity });
    }

    logger.info("Endpoint selected", { id: selected.id, reason });

    return { endpointId: selected.id, reason };
  }

  /**
   * 获取端点统计
   * @param {string} endpointId - 端点标识符
   * @returns {object | null} 端点统计对象，不存在返回 null
   */
  getEndpointStats(endpointId) {
    const stats = this._endpoints.get(endpointId);
    return stats ? stats.toJSON() : null;
  }

  /**
   * 获取所有端点统计
   * @returns {Object<string, object>} 以端点 ID 为键的统计对象映射
   */
  getAllStats() {
    const result = Object.create(null);
    for (const [id, stats] of this._endpoints) {
      result[id] = stats.toJSON();
    }
    return result;
  }

  /**
   * 获取按评分排序的端点列表
   * @returns {object[]} 按评分降序排列的端点统计数组
   */
  getRankedEndpoints() {
    return [...this._endpoints.values()]
      .sort((a, b) => b.score - a.score)
      .map((e) => e.toJSON());
  }

  /**
   * 更新端点权重
   * @param {string} endpointId - 端点标识符
   * @param {number} weight - 新权重 (会被 clamp 到 [0, 10])
   * @returns {void}
   */
  setWeight(endpointId, weight) {
    const stats = this._endpoints.get(endpointId);
    if (stats) {
      stats.weight = Math.max(0, Math.min(10, weight));
    }
  }

  /**
   * 更新端点层级
   * @param {string} endpointId - 端点标识符
   * @param {ModelTierType} tier - 新层级
   * @returns {void}
   */
  setTier(endpointId, tier) {
    const stats = this._endpoints.get(endpointId);
    if (stats && Object.values(ModelTier).includes(tier)) {
      stats.tier = tier;
    }
  }

  /**
   * 移除端点
   * @param {string} endpointId - 端点标识符
   * @returns {void}
   */
  removeEndpoint(endpointId) {
    this._endpoints.delete(endpointId);
  }

  /**
   * 重置所有统计
   * @returns {void}
   */
  resetStats() {
    for (const stats of this._endpoints.values()) {
      stats.latencyTracker.reset();
      stats.successCount = 0;
      stats.errorCount = 0;
      stats.lastError = null;
      stats.lastSuccess = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Complexity Estimator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 估算任务复杂度
 * @param {object} [task] - 任务对象
 * @param {string} [task.prompt] - 提示词
 * @param {string} [task.content] - 内容
 * @param {string} [task.message] - 消息
 * @returns {TaskComplexityType} 任务复杂度
 */
export function estimateComplexity(task) {
  if (!task) return TaskComplexity.SIMPLE;

  const text = task.prompt || task.content || task.message || "";
  const tokenEstimate = Math.ceil(text.length / 4);

  // 简单启发式
  if (tokenEstimate < 100) return TaskComplexity.SIMPLE;
  if (tokenEstimate < 500) return TaskComplexity.MODERATE;
  return TaskComplexity.COMPLEX;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default PerformanceRouter;
