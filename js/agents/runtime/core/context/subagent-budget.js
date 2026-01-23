/**
 * 子 Agent 预算管理器
 * @module runtime/context/subagent-budget
 *
 * 为子 Agent 分配 token 预算，防止子 Agent 消耗过多资源。
 * 支持按 ContextMode (isolated/shared/handoff) 分配不同比例的预算。
 */

/**
 * @typedef {'isolated'|'shared'|'handoff'} ContextModeValue
 */

/**
 * @typedef {object} AllocationResult
 * @property {number} budget - 分配的预算
 * @property {ContextModeValue} mode - 上下文模式
 * @property {number} priority - 优先级 (用于排队)
 */

/**
 * @typedef {object} AllocationRecord
 * @property {string} subagentId
 * @property {number} allocated - 分配的预算
 * @property {number} used - 实际使用量
 * @property {ContextModeValue} mode
 * @property {number} startTime
 * @property {number} endTime
 * @property {'active'|'completed'|'aborted'} status
 */

/**
 * 各模式的默认分配比例
 */
const MODE_ALLOCATION_RATIOS = Object.freeze({
  isolated: 0.15, // 隔离模式：最小预算 (15%)
  shared: 0.25, // 共享模式：中等预算 (25%)
  handoff: 0.35, // 交接模式：较大预算 (35%)
});

/**
 * 各模式的优先级 (数值越低优先级越高)
 */
const MODE_PRIORITY = Object.freeze({
  isolated: 3,
  shared: 2,
  handoff: 1,
});

export class SubagentBudgetManager {
  /**
   * @param {object} [options]
   * @param {number} [options.parentBudget=100000] - 父 Agent 总预算
   * @param {number} [options.reserveRatio=0.2] - 为父 Agent 保留的比例
   * @param {number} [options.maxConcurrent=3] - 最大并发子 Agent 数
   * @param {Record<ContextModeValue, number>} [options.modeRatios] - 自定义模式分配比例
   * @param {Function} [options.onBudgetExhausted] - 预算耗尽回调
   */
  constructor(options = {}) {
    this._parentBudget = Math.max(1, options.parentBudget ?? 100000);
    this._reserveRatio = Math.max(0.1, Math.min(0.5, options.reserveRatio ?? 0.2));
    this._maxConcurrent = Math.max(1, options.maxConcurrent ?? 3);
    this._modeRatios = { ...MODE_ALLOCATION_RATIOS, ...options.modeRatios };
    this._onBudgetExhausted = options.onBudgetExhausted;

    /** @type {Map<string, AllocationRecord>} */
    this._allocations = new Map();

    // 计算可分配预算
    this._distributableBudget = Math.floor(this._parentBudget * (1 - this._reserveRatio));
    this._totalAllocated = 0;
    this._totalUsed = 0;
  }

  /**
   * 获取可分配的剩余预算
   * @returns {number}
   */
  getAvailable() {
    return Math.max(0, this._distributableBudget - this._totalAllocated);
  }

  /**
   * 获取当前活跃的子 Agent 数量
   * @returns {number}
   */
  getActiveCount() {
    let count = 0;
    for (const record of this._allocations.values()) {
      if (record.status === "active") count++;
    }
    return count;
  }

  /**
   * 检查是否可以分配新的子 Agent
   * @returns {{canAllocate: boolean, reason?: string}}
   */
  canAllocate() {
    const activeCount = this.getActiveCount();
    if (activeCount >= this._maxConcurrent) {
      return { canAllocate: false, reason: `Max concurrent limit reached (${this._maxConcurrent})` };
    }
    if (this.getAvailable() <= 0) {
      return { canAllocate: false, reason: "No budget available" };
    }
    return { canAllocate: true };
  }

  /**
   * 为子 Agent 分配预算
   * @param {string} subagentId - 子 Agent ID
   * @param {object} options
   * @param {ContextModeValue} [options.mode='isolated'] - 上下文模式
   * @param {number} [options.requestedBudget] - 请求的预算 (可选，不超过模式上限)
   * @param {number} [options.priority] - 自定义优先级
   * @returns {AllocationResult | { error: string }}
   */
  allocate(subagentId, options = {}) {
    const { mode = "isolated", requestedBudget, priority } = options;

    // 验证模式
    const normalizedMode = this._normalizeMode(mode);

    // 检查是否可以分配
    const check = this.canAllocate();
    if (!check.canAllocate) {
      return { error: check.reason };
    }

    // 检查是否已存在
    if (this._allocations.has(subagentId)) {
      const existing = this._allocations.get(subagentId);
      if (existing.status === "active") {
        return { error: `Subagent ${subagentId} already has active allocation` };
      }
    }

    // 计算分配预算
    const modeRatio = this._modeRatios[normalizedMode] ?? MODE_ALLOCATION_RATIOS.isolated;
    const maxForMode = Math.floor(this._distributableBudget * modeRatio);
    const available = this.getAvailable();

    let budget;
    if (requestedBudget !== undefined && Number.isFinite(requestedBudget) && requestedBudget > 0) {
      // 使用请求预算，但不超过模式上限和可用预算
      budget = Math.min(requestedBudget, maxForMode, available);
    } else {
      // 使用模式默认预算
      budget = Math.min(maxForMode, available);
    }

    // 最小预算保护
    const minBudget = 1000;
    if (budget < minBudget) {
      this._onBudgetExhausted?.({ subagentId, mode: normalizedMode, available });
      return { error: `Insufficient budget: need ${minBudget}, available ${available}` };
    }

    // 创建分配记录
    /** @type {AllocationRecord} */
    const record = {
      subagentId,
      allocated: budget,
      used: 0,
      mode: normalizedMode,
      startTime: Date.now(),
      endTime: 0,
      status: "active",
    };

    this._allocations.set(subagentId, record);
    this._totalAllocated += budget;

    return {
      budget,
      mode: normalizedMode,
      priority: priority ?? MODE_PRIORITY[normalizedMode] ?? 3,
    };
  }

  /**
   * 记录子 Agent 使用量
   * @param {string} subagentId
   * @param {number} tokensUsed - 使用的 token 数
   * @returns {{ok: boolean, remaining?: number, exceeded?: boolean, error?: string}}
   */
  recordUsage(subagentId, tokensUsed) {
    const record = this._allocations.get(subagentId);
    if (!record) {
      return { ok: false, error: `No allocation found for ${subagentId}` };
    }
    if (record.status !== "active") {
      return { ok: false, error: `Allocation for ${subagentId} is not active` };
    }

    // 校验 tokensUsed 为有效数值
    const safeTokens = Number.isFinite(tokensUsed) ? Math.max(0, tokensUsed) : 0;
    record.used += safeTokens;
    this._totalUsed += safeTokens;

    const remaining = record.allocated - record.used;
    const exceeded = remaining < 0;

    return { ok: true, remaining: Math.max(0, remaining), exceeded };
  }

  /**
   * 释放子 Agent 预算
   * @param {string} subagentId
   * @param {number} [actualUsed] - 实际使用量 (可选，用于修正记录)
   * @returns {{ok: boolean, refunded?: number, error?: string}}
   */
  release(subagentId, actualUsed) {
    const record = this._allocations.get(subagentId);
    if (!record) {
      return { ok: false, error: `No allocation found for ${subagentId}` };
    }
    if (record.status !== "active") {
      return { ok: false, error: `Allocation for ${subagentId} is not active` };
    }

    // 更新使用量
    if (actualUsed !== undefined && actualUsed >= 0) {
      const delta = actualUsed - record.used;
      record.used = actualUsed;
      this._totalUsed += delta;
    }

    // 计算退还
    const refunded = Math.max(0, record.allocated - record.used);
    this._totalAllocated -= refunded;

    // 更新状态并保留记录（用于统计/调试）
    record.status = "completed";
    record.endTime = Date.now();

    return { ok: true, refunded };
  }

  /**
   * 中止子 Agent (强制释放)
   * @param {string} subagentId
   * @returns {{ok: boolean, error?: string}}
   */
  abort(subagentId) {
    const record = this._allocations.get(subagentId);
    if (!record) {
      return { ok: false, error: `No allocation found for ${subagentId}` };
    }
    if (record.status !== "active") {
      return { ok: false, error: `Allocation for ${subagentId} is not active` };
    }

    // 释放全部未使用的预算
    const unused = Math.max(0, record.allocated - record.used);
    this._totalAllocated -= unused;

    record.status = "aborted";
    record.endTime = Date.now();

    return { ok: true };
  }

  /**
   * 获取分配记录
   * @param {string} subagentId
   * @returns {AllocationRecord | null}
   */
  getAllocation(subagentId) {
    return this._allocations.get(subagentId) ?? null;
  }

  /**
   * 获取所有活跃的分配
   * @returns {AllocationRecord[]}
   */
  getActiveAllocations() {
    const active = [];
    for (const record of this._allocations.values()) {
      if (record.status === "active") {
        active.push({ ...record });
      }
    }
    return active;
  }

  /**
   * 获取统计信息
   * @returns {{
   *   parentBudget: number,
   *   reserveRatio: number,
   *   distributableBudget: number,
   *   totalAllocated: number,
   *   totalUsed: number,
   *   available: number,
   *   activeCount: number,
   *   completedCount: number,
   *   utilizationRatio: number
   * }}
   */
  getStats() {
    let completedCount = 0;
    for (const record of this._allocations.values()) {
      if (record.status === "completed") completedCount++;
    }

    return {
      parentBudget: this._parentBudget,
      reserveRatio: this._reserveRatio,
      distributableBudget: this._distributableBudget,
      totalAllocated: this._totalAllocated,
      totalUsed: this._totalUsed,
      available: this.getAvailable(),
      activeCount: this.getActiveCount(),
      completedCount,
      utilizationRatio: this._distributableBudget > 0 ? this._totalUsed / this._distributableBudget : 0,
    };
  }

  /**
   * 重置所有分配 (用于新的运行)
   */
  reset() {
    // 中止所有活跃分配
    for (const [id, record] of this._allocations) {
      if (record.status === "active") {
        record.status = "aborted";
        record.endTime = Date.now();
      }
    }
    this._allocations.clear();
    this._totalAllocated = 0;
    this._totalUsed = 0;
  }

  /**
   * 调整父预算 (运行时动态调整)
   * @param {number} newBudget - 新的父预算值
   * @returns {{oldBudget: number, newBudget: number, distributableBudget: number, available: number}}
   */
  adjustParentBudget(newBudget) {
    // 校验 newBudget 为有效数值
    const safeBudget = Number.isFinite(newBudget) ? newBudget : this._parentBudget;
    const oldBudget = this._parentBudget;
    this._parentBudget = Math.max(1, safeBudget);
    this._distributableBudget = Math.floor(this._parentBudget * (1 - this._reserveRatio));

    // 如果新预算小于已分配，不回收活跃分配，但阻止新分配
    return {
      oldBudget,
      newBudget: this._parentBudget,
      distributableBudget: this._distributableBudget,
      available: this.getAvailable(),
    };
  }

  /**
   * 标准化上下文模式
   * @param {string} mode
   * @returns {ContextModeValue}
   * @private
   */
  _normalizeMode(mode) {
    const normalized = String(mode).toLowerCase();
    if (normalized === "isolated" || normalized === "shared" || normalized === "handoff") {
      return normalized;
    }
    // 兼容 ContextMode 常量
    if (normalized === "minimal") return "isolated";
    return "isolated";
  }
}

/**
 * 创建子 Agent 预算管理器的工厂函数
 * @param {object} [config]
 * @param {number} [config.parentBudget]
 * @param {number} [config.reserveRatio]
 * @param {number} [config.maxConcurrent]
 * @returns {SubagentBudgetManager}
 */
export function createSubagentBudgetManager(config = {}) {
  return new SubagentBudgetManager(config);
}

export { MODE_ALLOCATION_RATIOS, MODE_PRIORITY };
export default SubagentBudgetManager;
