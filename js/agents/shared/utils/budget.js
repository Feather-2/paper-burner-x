/**
 * Budget 管理器 - Token 预算记账与运行时控制
 */

export const BudgetAction = Object.freeze({
  CONTINUE: "continue", // 正常继续
  DEGRADE: "degrade", // 降级（跳过某些操作）
  STOP: "stop", // 硬停止
});

/**
 * @typedef {"continue"|"degrade"|"stop"} BudgetActionValue
 */

/**
 * @typedef {{ input: number, output: number, total: number }} BudgetUsage
 */

/**
 * @typedef {{ input: number, output: number, total: number }} BudgetLimits
 */

/**
 * @typedef {(event: { action: BudgetActionValue, usage: BudgetUsage, limits: BudgetLimits, ratio: number }) => void} BudgetThresholdCallback
 */

/**
 * @typedef {object} BudgetManagerOptions
 * @property {number=} maxInputTokens
 * @property {number=} maxOutputTokens
 * @property {number=} maxTotalTokens
 * @property {number=} degradeThreshold
 * @property {BudgetThresholdCallback=} onThresholdReached
 */

export class BudgetManager {
  /**
   * @param {BudgetManagerOptions} [options]
   */
  constructor({
    maxInputTokens = 500000,
    maxOutputTokens = 200000,
    maxTotalTokens = 700000,
    degradeThreshold = 0.8, // 80% 时开始降级
    onThresholdReached,
  } = {}) {
    this.limits = {
      input: Math.max(1, maxInputTokens),
      output: Math.max(1, maxOutputTokens),
      total: Math.max(1, maxTotalTokens),
    };
    this.degradeThreshold = Math.max(0.1, Math.min(0.99, degradeThreshold));
    this.onThresholdReached = onThresholdReached;

    this.usage = { input: 0, output: 0, total: 0 };
    this.degraded = false;
    this.stopped = false;
  }

  /**
   * 检查是否超出预算
   * @returns {BudgetActionValue}
   */
  checkBudget() {
    if (this.stopped) return BudgetAction.STOP;

    const inputRatio = this.usage.input / this.limits.input;
    const outputRatio = this.usage.output / this.limits.output;
    const totalRatio = this.usage.total / this.limits.total;
    const maxRatio = Math.max(inputRatio, outputRatio, totalRatio);

    if (maxRatio >= 1) {
      this.stopped = true;
      this.onThresholdReached?.({ action: BudgetAction.STOP, usage: this.usage, limits: this.limits, ratio: maxRatio });
      return BudgetAction.STOP;
    }

    if (maxRatio >= this.degradeThreshold && !this.degraded) {
      this.degraded = true;
      this.onThresholdReached?.({ action: BudgetAction.DEGRADE, usage: this.usage, limits: this.limits, ratio: maxRatio });
      return BudgetAction.DEGRADE;
    }

    return this.degraded ? BudgetAction.DEGRADE : BudgetAction.CONTINUE;
  }

  /**
   * 记录实际消耗
   * @param {object} tokens - { input, output }
   * @returns {BudgetActionValue}
   */
  recordUsage({ input = 0, output = 0 } = {}) {
    this.usage.input += Math.max(0, input);
    this.usage.output += Math.max(0, output);
    this.usage.total = this.usage.input + this.usage.output;
    return this.checkBudget();
  }

  /**
   * 获取剩余预算
   */
  getRemaining() {
    return {
      input: Math.max(0, this.limits.input - this.usage.input),
      output: Math.max(0, this.limits.output - this.usage.output),
      total: Math.max(0, this.limits.total - this.usage.total),
    };
  }

  /**
   * 获取使用率
   */
  getUsageRatio() {
    return {
      input: this.usage.input / this.limits.input,
      output: this.usage.output / this.limits.output,
      total: this.usage.total / this.limits.total,
    };
  }

  /**
   * 获取完整状态
   */
  getStats() {
    return {
      usage: { ...this.usage },
      limits: { ...this.limits },
      remaining: this.getRemaining(),
      ratio: this.getUsageRatio(),
      degraded: this.degraded,
      stopped: this.stopped,
    };
  }

  /**
   * 重置（用于新的运行）
   */
  reset() {
    this.usage = { input: 0, output: 0, total: 0 };
    this.degraded = false;
    this.stopped = false;
  }
}

/**
 * 创建 budget 管理器的工厂函数
 * @param {{ budget?: BudgetManagerOptions }} [userConfig] - User configuration containing optional budget settings.
 * @returns {BudgetManager} A new BudgetManager instance.
 */
export function createBudgetManager(userConfig = {}) {
  const budgetConfig = /** @type {BudgetManagerOptions} */ (userConfig?.budget || {});
  return new BudgetManager({
    maxInputTokens: budgetConfig.maxInputTokens,
    maxOutputTokens: budgetConfig.maxOutputTokens,
    maxTotalTokens: budgetConfig.maxTotalTokens,
    degradeThreshold: budgetConfig.degradeThreshold,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive Budget Inheritance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 递归预算分配策略
 */
export const AllocationStrategy = Object.freeze({
  EQUAL: "equal", // 均分
  PROPORTIONAL: "proportional", // 按权重比例
  FIXED: "fixed", // 固定额度
  REMAINING: "remaining", // 使用剩余预算
});

/**
 * 递归预算管理器 - 支持子代理预算继承
 */
export class RecursiveBudgetManager extends BudgetManager {
  /**
   * @param {object} options
   * @param {BudgetManager} [options.parent] - 父级预算管理器
   * @param {number} [options.inheritRatio=0.5] - 继承父级预算的比例
   * @param {string} [options.strategy='remaining'] - 分配策略
   * @param {number} [options.depth=0] - 递归深度
   * @param {number} [options.maxDepth=5] - 最大递归深度
   */
  constructor({
    parent,
    inheritRatio = 0.5,
    strategy = AllocationStrategy.REMAINING,
    depth = 0,
    maxDepth = 5,
    ...baseOptions
  } = {}) {
    const base = /** @type {BudgetManagerOptions} */ (baseOptions);
    // 从父级继承预算
    if (parent) {
      const remaining = parent.getRemaining();
      const ratio = Math.min(1, Math.max(0.1, inheritRatio));

      base.maxInputTokens = base.maxInputTokens ?? Math.floor(remaining.input * ratio);
      base.maxOutputTokens = base.maxOutputTokens ?? Math.floor(remaining.output * ratio);
      base.maxTotalTokens = base.maxTotalTokens ?? Math.floor(remaining.total * ratio);
    }

    super(base);

    this._parent = parent;
    this._inheritRatio = inheritRatio;
    this._strategy = strategy;
    this._depth = depth;
    this._maxDepth = maxDepth;
    this._children = [];
  }

  /**
   * 为子代理创建预算
   * @param {object} options
   * @returns {RecursiveBudgetManager}
   */
  createChildBudget(options = {}) {
    if (this._depth >= this._maxDepth) {
      throw new Error(`Max recursion depth (${this._maxDepth}) reached`);
    }

    const child = new RecursiveBudgetManager({
      parent: this,
      inheritRatio: options.inheritRatio ?? this._inheritRatio * 0.8, // 递减
      strategy: options.strategy ?? this._strategy,
      depth: this._depth + 1,
      maxDepth: this._maxDepth,
      degradeThreshold: options.degradeThreshold ?? this.degradeThreshold,
      ...options,
    });

    this._children.push(child);
    return child;
  }

  /**
   * 同步子级消耗到父级
   */
  syncToParent() {
    if (!this._parent) return;

    const totalChildUsage = this._children.reduce(
      (acc, child) => ({
        input: acc.input + child.usage.input,
        output: acc.output + child.usage.output,
      }),
      { input: 0, output: 0 }
    );

    // 父级记录子级消耗
    this._parent.recordUsage(totalChildUsage);
  }

  /**
   * 获取层级信息
   */
  getHierarchyInfo() {
    return {
      depth: this._depth,
      maxDepth: this._maxDepth,
      childCount: this._children.length,
      strategy: this._strategy,
      inheritRatio: this._inheritRatio,
      hasParent: !!this._parent,
    };
  }

  /**
   * 获取所有后代的总消耗
   */
  getTotalDescendantUsage() {
    let total = { input: 0, output: 0, total: 0 };

    for (const child of this._children) {
      total.input += child.usage.input;
      total.output += child.usage.output;
      total.total += child.usage.total;

      const descendant = child.getTotalDescendantUsage();
      total.input += descendant.input;
      total.output += descendant.output;
      total.total += descendant.total;
    }

    return total;
  }
}
