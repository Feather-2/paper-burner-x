/**
 * Budget 管理器 - Token 预算记账与运行时控制
 */

export const BudgetAction = Object.freeze({
  CONTINUE: "continue", // 正常继续
  DEGRADE: "degrade", // 降级（跳过某些操作）
  STOP: "stop", // 硬停止
});

export class BudgetManager {
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
   * @returns {BudgetAction}
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
   * @returns {BudgetAction}
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
 */
export function createBudgetManager(userConfig = {}) {
  const budgetConfig = userConfig?.budget || {};
  return new BudgetManager({
    maxInputTokens: budgetConfig.maxInputTokens,
    maxOutputTokens: budgetConfig.maxOutputTokens,
    maxTotalTokens: budgetConfig.maxTotalTokens,
    degradeThreshold: budgetConfig.degradeThreshold,
  });
}
