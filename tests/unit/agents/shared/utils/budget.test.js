import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  BudgetAction,
  BudgetManager,
  createBudgetManager,
} from '../../../../../js/agents/shared/utils/budget.js';
import { getBudgetConfig } from 'budget-config-provider';

vi.mock(
  'budget-config-provider',
  () => ({
    getBudgetConfig: vi.fn(() => ({
      budget: {
        maxInputTokens: 12,
        maxOutputTokens: 34,
        maxTotalTokens: 50,
        degradeThreshold: 0.6,
      },
    })),
  }),
  { virtual: true }
);

describe('BudgetAction', () => {
  it('exposes frozen constants', () => {
    expect(BudgetAction).toEqual({
      CONTINUE: 'continue',
      DEGRADE: 'degrade',
      STOP: 'stop',
    });
    expect(Object.isFrozen(BudgetAction)).toBe(true);
  });
});

describe('BudgetManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with defaults', () => {
    const manager = new BudgetManager();
    expect(manager.limits).toEqual({
      input: 500000,
      output: 200000,
      total: 700000,
    });
    expect(manager.degradeThreshold).toBe(0.8);
    expect(manager.usage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.degraded).toBe(false);
    expect(manager.stopped).toBe(false);
  });

  it('clamps limits and thresholds for boundary values', () => {
    const manager = new BudgetManager({
      maxInputTokens: 0,
      maxOutputTokens: -1,
      maxTotalTokens: '   ',
      degradeThreshold: -5,
    });

    expect(manager.limits).toEqual({ input: 1, output: 1, total: 1 });
    expect(manager.degradeThreshold).toBe(0.1);

    const upper = new BudgetManager({ degradeThreshold: 5 });
    expect(upper.degradeThreshold).toBe(0.99);
  });

  it('coerces numeric strings for limits and thresholds', () => {
    const manager = new BudgetManager({
      maxInputTokens: '10',
      maxOutputTokens: '5',
      maxTotalTokens: '20',
      degradeThreshold: '0.6',
    });

    expect(manager.limits).toEqual({ input: 10, output: 5, total: 20 });
    expect(manager.degradeThreshold).toBe(0.6);
  });

  it('handles long numeric strings as large limits', () => {
    const longNumber = '9'.repeat(308);
    const manager = new BudgetManager({
      maxInputTokens: longNumber,
      maxOutputTokens: 10,
      maxTotalTokens: longNumber,
    });

    expect(manager.limits.input).toBe(1e308);
    expect(manager.limits.total).toBe(1e308);
    expect(manager.recordUsage({ input: 1 })).toBe(BudgetAction.CONTINUE);
  });

  it('records usage and returns CONTINUE below threshold', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 25,
      degradeThreshold: 0.8,
    });

    const action = manager.recordUsage({ input: 3, output: 2 });

    expect(action).toBe(BudgetAction.CONTINUE);
    expect(manager.usage).toEqual({ input: 3, output: 2, total: 5 });
  });

  it('transitions to DEGRADE and STOP with callback events', () => {
    const onThresholdReached = vi.fn();
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 20,
      degradeThreshold: 0.5,
      onThresholdReached,
    });

    const first = manager.recordUsage({ input: 5 });
    expect(first).toBe(BudgetAction.DEGRADE);
    expect(manager.degraded).toBe(true);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
    expect(onThresholdReached.mock.calls[0][0]).toMatchObject({
      action: BudgetAction.DEGRADE,
    });

    const stillDegraded = manager.checkBudget();
    expect(stillDegraded).toBe(BudgetAction.DEGRADE);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);

    const second = manager.recordUsage({ output: 10 });
    expect(second).toBe(BudgetAction.STOP);
    expect(manager.stopped).toBe(true);
    expect(onThresholdReached).toHaveBeenCalledTimes(2);
    expect(onThresholdReached.mock.calls[1][0]).toMatchObject({
      action: BudgetAction.STOP,
    });

    const afterStop = manager.recordUsage({ input: 1 });
    expect(afterStop).toBe(BudgetAction.STOP);
    expect(onThresholdReached).toHaveBeenCalledTimes(2);
  });

  it('getRemaining, getUsageRatio, and getStats provide snapshots', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 5,
      maxTotalTokens: 20,
    });

    manager.recordUsage({ input: 3, output: 2 });

    expect(manager.getRemaining()).toEqual({ input: 7, output: 3, total: 15 });

    const ratio = manager.getUsageRatio();
    expect(ratio.input).toBeCloseTo(0.3);
    expect(ratio.output).toBeCloseTo(0.4);
    expect(ratio.total).toBeCloseTo(0.25);

    const stats = manager.getStats();
    expect(stats.usage).toEqual({ input: 3, output: 2, total: 5 });
    expect(stats.limits).toEqual({ input: 10, output: 5, total: 20 });
    expect(stats.remaining).toEqual({ input: 7, output: 3, total: 15 });
    expect(stats.ratio).toEqual(ratio);
    expect(stats.usage).not.toBe(manager.usage);
    stats.usage.input = 99;
    expect(manager.usage.input).toBe(3);
  });

  it('reset clears usage and state', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 20,
    });

    manager.recordUsage({ input: 6, output: 5 });
    manager.degraded = true;
    manager.stopped = true;

    manager.reset();

    expect(manager.usage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.degraded).toBe(false);
    expect(manager.stopped).toBe(false);
  });

  it('clamps negative usage to zero', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 20,
    });

    const action = manager.recordUsage({ input: -1, output: -5 });
    expect(action).toBe(BudgetAction.CONTINUE);
    expect(manager.usage).toEqual({ input: 0, output: 0, total: 0 });
  });

  it('handles undefined, empty string, empty array, and empty object inputs', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 20,
    });

    expect(manager.recordUsage()).toBe(BudgetAction.CONTINUE);
    expect(manager.recordUsage({ input: '', output: [] })).toBe(BudgetAction.CONTINUE);
    expect(manager.recordUsage({})).toBe(BudgetAction.CONTINUE);
    expect(manager.recordUsage([])).toBe(BudgetAction.CONTINUE);
    expect(manager.usage).toEqual({ input: 0, output: 0, total: 0 });
  });

  it('throws on null recordUsage input', () => {
    const manager = new BudgetManager({
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxTotalTokens: 20,
    });

    expect(() => manager.recordUsage(null)).toThrow(TypeError);
  });

  it('accepts array-like and deep nested numeric inputs', () => {
    const deepNested = {
      nested: { nested: { nested: { value: 7 } } },
      valueOf() {
        return this.nested.nested.nested.value;
      },
    };
    const arrayLike = {
      0: 3,
      length: 1,
      valueOf() {
        return this[0];
      },
    };

    const manager = new BudgetManager({
      maxInputTokens: 20,
      maxOutputTokens: 20,
      maxTotalTokens: 50,
    });

    manager.recordUsage({ input: deepNested, output: arrayLike });
    expect(manager.usage).toEqual({ input: 7, output: 3, total: 10 });
  });

  it('aggregates usage across concurrent calls', async () => {
    const manager = new BudgetManager({
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxTotalTokens: 1000,
    });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        Promise.resolve().then(() => manager.recordUsage({ input: 2, output: 3 }))
      )
    );

    expect(manager.usage).toEqual({ input: 10, output: 15, total: 25 });
  });

  it('handles rapid consecutive calls without losing counts', () => {
    const manager = new BudgetManager({
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxTotalTokens: 2000,
    });

    for (let i = 0; i < 250; i += 1) {
      manager.recordUsage({ input: 1, output: 1 });
    }

    expect(manager.usage).toEqual({ input: 250, output: 250, total: 500 });
  });

  it('stops at MAX_SAFE_INTEGER usage', () => {
    const max = Number.MAX_SAFE_INTEGER;
    const manager = new BudgetManager({
      maxInputTokens: max,
      maxOutputTokens: max,
      maxTotalTokens: max,
    });

    const action = manager.recordUsage({ input: max });

    expect(action).toBe(BudgetAction.STOP);
    expect(manager.stopped).toBe(true);
    expect(manager.getRemaining()).toEqual({ input: 0, output: max, total: 0 });
  });
});

describe('createBudgetManager', () => {
  const defaults = {
    input: 500000,
    output: 200000,
    total: 700000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses defaults when config is missing or empty', () => {
    const cases = [
      undefined,
      null,
      '',
      [],
      {},
      { budget: undefined },
      { budget: {} },
    ];

    for (const value of cases) {
      const manager = value === undefined ? createBudgetManager() : createBudgetManager(value);
      expect(manager.limits).toEqual(defaults);
      expect(manager.degradeThreshold).toBe(0.8);
    }
  });

  it('creates a manager from mocked external config', () => {
    const config = getBudgetConfig();
    const manager = createBudgetManager(config);

    expect(getBudgetConfig).toHaveBeenCalledTimes(1);
    expect(manager.limits).toEqual({ input: 12, output: 34, total: 50 });
    expect(manager.degradeThreshold).toBe(0.6);
  });

  it('passes through budget config boundary values', () => {
    const manager = createBudgetManager({
      budget: {
        maxInputTokens: 0,
        maxOutputTokens: -1,
        maxTotalTokens: '   ',
        degradeThreshold: 5,
      },
    });

    expect(manager.limits).toEqual({ input: 1, output: 1, total: 1 });
    expect(manager.degradeThreshold).toBe(0.99);
  });

  it('accepts array-based budget config objects', () => {
    const arrayBudget = [];
    arrayBudget.maxInputTokens = 3;
    arrayBudget.maxOutputTokens = 4;
    arrayBudget.maxTotalTokens = 5;
    arrayBudget.degradeThreshold = 0.4;

    const manager = createBudgetManager({ budget: arrayBudget });

    expect(manager.limits).toEqual({ input: 3, output: 4, total: 5 });
    expect(manager.degradeThreshold).toBe(0.4);
  });
});
