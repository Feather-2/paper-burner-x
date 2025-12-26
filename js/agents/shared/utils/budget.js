/**
 * Budget 管理器 - Token 预算预估与运行时控制
 */

export const BudgetAction = Object.freeze({
  CONTINUE: "continue", // 正常继续
  DEGRADE: "degrade", // 降级（跳过某些操作）
  STOP: "stop", // 硬停止
});

/**
 * 默认消耗估算（每次调用的平均 token 数）
 */
const DEFAULT_ESTIMATES = {
  scan: { input: 2000, output: 500 },
  gaps: { input: 3000, output: 800 },
  retrieve: { input: 500, output: 200 },
  understand: { input: 4000, output: 1500 },
  write: { input: 5000, output: 3000 },
  rerank: { input: 2000, output: 500 },
  shadow: { input: 1000, output: 300 },
  external: { input: 1500, output: 500 },
};

export class BudgetManager {
  constructor({
    maxInputTokens = 500000,
    maxOutputTokens = 200000,
    maxTotalTokens = 700000,
    degradeThreshold = 0.8, // 80% 时开始降级
    estimates = {},
    onThresholdReached,
  } = {}) {
    this.limits = {
      input: Math.max(1, maxInputTokens),
      output: Math.max(1, maxOutputTokens),
      total: Math.max(1, maxTotalTokens),
    };
    this.degradeThreshold = Math.max(0.1, Math.min(0.99, degradeThreshold));
    this.estimates = { ...DEFAULT_ESTIMATES, ...estimates };
    this.onThresholdReached = onThresholdReached;

    this.usage = { input: 0, output: 0, total: 0 };
    this.degraded = false;
    this.stopped = false;
    this.complexityMultiplier = 1.0;
  }

  /**
   * Adjust estimates based on task complexity or document properties.
   * @param {number} multiplier - e.g., 1.5 for dense technical docs, 0.8 for simple lists.
   */
  setComplexity(multiplier) {
    this.complexityMultiplier = Math.max(0.1, Math.min(10, multiplier));
  }

  /**
   * 预估迭代消耗
   * @param {object} config - 迭代配置
   * @returns {object} { input, output, total, iterations }
   */
  estimateIteration({
    maxIterations = 5,
    gapCount = 5,
    sourceCount = 5,
    enableRerank = false,
    enableShadow = false,
    enableExternal = false,
  } = {}) {
    // sourceCount 暂不参与估算；保留字段用于未来更精细的估算策略
    void sourceCount;

    const m = this.complexityMultiplier;
    const perIteration = {
      scan: { input: this.estimates.scan.input * m, output: this.estimates.scan.output },
      gaps: { input: (this.estimates.gaps.input * gapCount * m) / 5, output: this.estimates.gaps.output },
      retrieve: { input: this.estimates.retrieve.input * gapCount * m, output: this.estimates.retrieve.output * gapCount },
      understand: { input: this.estimates.understand.input * gapCount * m, output: this.estimates.understand.output * gapCount },
      write: { input: this.estimates.write.input * m, output: this.estimates.write.output },
    };

    if (enableRerank) {
      perIteration.rerank = { input: this.estimates.rerank.input * m, output: this.estimates.rerank.output };
    }
    if (enableShadow) {
      perIteration.shadow = {
        input: (this.estimates.shadow.input * gapCount) / 2,
        output: (this.estimates.shadow.output * gapCount) / 2,
      };
    }
    if (enableExternal) {
      perIteration.external = this.estimates.external;
    }

    let iterInput = 0;
    let iterOutput = 0;
    for (const est of Object.values(perIteration)) {
      iterInput += est.input || 0;
      iterOutput += est.output || 0;
    }

    return {
      input: iterInput * maxIterations,
      output: iterOutput * maxIterations,
      total: (iterInput + iterOutput) * maxIterations,
      perIteration: { input: iterInput, output: iterOutput },
      iterations: maxIterations,
    };
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
   * 预检查操作是否可执行
   * @param {string} operation - 操作名称
   * @returns {{ canExecute: boolean, action: BudgetAction, estimated: object }}
   */
  canExecute(operation) {
    const est = this.estimates[operation] || { input: 1000, output: 500 };
    const projected = {
      input: this.usage.input + est.input,
      output: this.usage.output + est.output,
      total: this.usage.total + est.input + est.output,
    };

    const wouldExceed =
      projected.input > this.limits.input || projected.output > this.limits.output || projected.total > this.limits.total;

    if (wouldExceed && this.degraded) {
      return { canExecute: false, action: BudgetAction.STOP, estimated: est };
    }

    const action = this.checkBudget();
    return { canExecute: action !== BudgetAction.STOP, action, estimated: est };
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

