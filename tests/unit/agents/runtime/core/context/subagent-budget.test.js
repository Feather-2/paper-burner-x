import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeout as mockedSetTimeout } from 'node:timers';
import {
  SubagentBudgetManager,
  createSubagentBudgetManager,
} from '../../../../../../js/agents/runtime/core/context/subagent-budget.js';

const mockedTimers = vi.hoisted(() => ({
  setTimeout: vi.fn((callback) => {
    if (typeof callback === 'function') {
      callback();
    }
    return 0;
  }),
  clearTimeout: vi.fn(),
}));

vi.mock('node:timers', () => ({
  setTimeout: mockedTimers.setTimeout,
  clearTimeout: mockedTimers.clearTimeout,
}));

const BASE_PARENT_BUDGET = 10000;
const BASE_RESERVE_RATIO = 0.2;
const BASE_DISTRIBUTABLE = Math.floor(BASE_PARENT_BUDGET * (1 - BASE_RESERVE_RATIO));
const ISOLATED_BUDGET = Math.floor(BASE_DISTRIBUTABLE * 0.15);
const SHARED_BUDGET = Math.floor(BASE_DISTRIBUTABLE * 0.25);
const HANDOFF_BUDGET = Math.floor(BASE_DISTRIBUTABLE * 0.35);

const createManager = (options = {}) =>
  new SubagentBudgetManager({
    parentBudget: BASE_PARENT_BUDGET,
    reserveRatio: BASE_RESERVE_RATIO,
    maxConcurrent: 2,
    ...options,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SubagentBudgetManager', () => {
  it('uses defaults with empty config', () => {
    const manager = new SubagentBudgetManager({});

    expect(manager.getAvailable()).toBe(80000);
    expect(manager.getActiveCount()).toBe(0);
    expect(manager.canAllocate()).toEqual({ canAllocate: true });
  });

  it('clamps parent budget and reserve ratio and reports no available budget', () => {
    const manager = new SubagentBudgetManager({ parentBudget: 0, reserveRatio: -1 });
    const stats = manager.getStats();

    expect(stats.parentBudget).toBe(1);
    expect(stats.reserveRatio).toBe(0.1);
    expect(stats.distributableBudget).toBe(0);
    expect(manager.canAllocate()).toEqual({
      canAllocate: false,
      reason: 'No budget available',
    });
  });

  it('clamps maxConcurrent to at least 1', () => {
    const manager = createManager({ maxConcurrent: 0 });

    const first = manager.allocate('first');
    expect(first).toMatchObject({ budget: ISOLATED_BUDGET, mode: 'isolated' });

    const second = manager.allocate('second');
    expect(second).toEqual({ error: 'Max concurrent limit reached (1)' });
  });

  it.each([
    ['empty string id with whitespace mode', '', { mode: '   ', requestedBudget: 0 }, 'isolated', ISOLATED_BUDGET],
    ['minimal mode with string budget', 'minimal', { mode: 'minimal', requestedBudget: '3000' }, 'isolated', ISOLATED_BUDGET],
    [
      'deep nested mode and object budget',
      'nested',
      { mode: { deep: { level: { value: 'handoff' } } }, requestedBudget: { value: 2000 } },
      'isolated',
      ISOLATED_BUDGET,
    ],
    ['empty array options', 'array', [], 'isolated', ISOLATED_BUDGET],
    ['long subagent id', 'x'.repeat(10000), { mode: 'handoff' }, 'handoff', HANDOFF_BUDGET],
  ])('allocates with edge inputs (%s)', (_label, subagentId, options, expectedMode, expectedBudget) => {
    const manager = createManager({ maxConcurrent: 10 });

    const result = manager.allocate(subagentId, options);

    expect(result).toMatchObject({ mode: expectedMode, budget: expectedBudget });
    expect(manager.getAllocation(subagentId)).not.toBeNull();
  });

  it('caps requested budget by mode and available and uses custom priority', () => {
    const manager = createManager();

    const result = manager.allocate('shared', {
      mode: 'SHARED',
      requestedBudget: 5000,
      priority: 7,
    });

    expect(result).toEqual({
      budget: SHARED_BUDGET,
      mode: 'shared',
      priority: 7,
    });
  });

  it('rejects duplicate active allocation for the same subagent', () => {
    const manager = createManager();

    expect(manager.allocate('dup')).toMatchObject({ budget: ISOLATED_BUDGET });
    expect(manager.allocate('dup')).toEqual({
      error: 'Subagent dup already has active allocation',
    });
  });

  it('invokes onBudgetExhausted when budget is below minimum', () => {
    const onBudgetExhausted = vi.fn();
    const manager = createManager({ onBudgetExhausted });

    const result = manager.allocate('low-budget', { requestedBudget: 500 });

    expect(result).toEqual({
      error: 'Insufficient budget: need 1000, available ' + BASE_DISTRIBUTABLE,
    });
    expect(onBudgetExhausted).toHaveBeenCalledWith({
      subagentId: 'low-budget',
      mode: 'isolated',
      available: BASE_DISTRIBUTABLE,
    });
    expect(manager.getAllocation('low-budget')).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string number', '100'],
    ['object', {}],
    ['negative', -1],
  ])('treats %s tokensUsed as zero', (_label, tokensUsed) => {
    const manager = createManager();
    const allocation = manager.allocate('usage');

    const result = manager.recordUsage('usage', tokensUsed);

    expect(result).toEqual({
      ok: true,
      remaining: allocation.budget,
      exceeded: false,
    });
  });

  it('flags exceeded usage when tokensUsed is larger than allocation', () => {
    const manager = createManager();
    const allocation = manager.allocate('over');

    const result = manager.recordUsage('over', allocation.budget + 1);

    expect(result).toEqual({ ok: true, remaining: 0, exceeded: true });
  });

  it('returns errors when recording usage for missing or inactive allocations', () => {
    const manager = createManager();

    expect(manager.recordUsage('missing', 10)).toEqual({
      ok: false,
      error: 'No allocation found for missing',
    });

    manager.allocate('inactive');
    const record = manager.getAllocation('inactive');
    record.status = 'completed';

    expect(manager.recordUsage('inactive', 10)).toEqual({
      ok: false,
      error: 'Allocation for inactive is not active',
    });
  });

  it('releases allocations, adjusts usage, and refunds remaining budget', () => {
    const manager = createManager();
    const allocation = manager.allocate('release');

    manager.recordUsage('release', 200);
    const result = manager.release('release', 500);

    expect(result).toEqual({ ok: true, refunded: allocation.budget - 500 });
    expect(manager.getAllocation('release')).toBeNull();
    expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - 500);
  });

  it('ignores negative actualUsed during release', () => {
    const manager = createManager();
    const allocation = manager.allocate('release-negative');

    manager.recordUsage('release-negative', 200);
    const result = manager.release('release-negative', -1);

    expect(result).toEqual({ ok: true, refunded: allocation.budget - 200 });
    expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - 200);
  });

  it('aborts allocations, frees unused budget, and errors when missing', () => {
    const manager = createManager();

    expect(manager.abort('missing')).toEqual({
      ok: false,
      error: 'No allocation found for missing',
    });

    manager.allocate('abort');
    manager.recordUsage('abort', 300);

    expect(manager.abort('abort')).toEqual({ ok: true });
    expect(manager.getAllocation('abort')).toBeNull();
    expect(manager.getAvailable()).toBe(BASE_DISTRIBUTABLE - 300);
  });

  it('returns copies of active allocations and tracks active count', () => {
    const manager = createManager();

    manager.allocate('alpha');
    manager.allocate('beta', { mode: 'shared' });

    const active = manager.getActiveAllocations();

    expect(active).toHaveLength(2);
    expect(manager.getActiveCount()).toBe(2);

    active[0].used = 999;
    const original = manager.getAllocation(active[0].subagentId);
    expect(original.used).toBe(0);
  });

  it('reports stats and resets allocations', () => {
    const manager = createManager();
    const allocation = manager.allocate('stats');

    manager.recordUsage('stats', 600);
    const stats = manager.getStats();

    expect(stats.totalAllocated).toBe(allocation.budget);
    expect(stats.totalUsed).toBe(600);
    expect(stats.available).toBe(BASE_DISTRIBUTABLE - allocation.budget);
    expect(stats.utilizationRatio).toBeCloseTo(600 / BASE_DISTRIBUTABLE);

    manager.reset();
    const resetStats = manager.getStats();

    expect(resetStats.totalAllocated).toBe(0);
    expect(resetStats.totalUsed).toBe(0);
    expect(resetStats.activeCount).toBe(0);
    expect(resetStats.available).toBe(BASE_DISTRIBUTABLE);
  });

  it.each([
    ['string', '9000'],
    ['null', null],
    ['undefined', undefined],
  ])('ignores non-finite newBudget values (%s)', (_label, value) => {
    const manager = createManager();
    const before = manager.getStats().parentBudget;

    const result = manager.adjustParentBudget(value);

    expect(result.oldBudget).toBe(before);
    expect(result.newBudget).toBe(before);
  });

  it('clamps negative budgets and accepts very large budgets', () => {
    const manager = createManager();

    const negative = manager.adjustParentBudget(-1);

    expect(negative.newBudget).toBe(1);
    expect(negative.distributableBudget).toBe(0);
    expect(negative.available).toBe(0);

    const huge = manager.adjustParentBudget(Number.MAX_SAFE_INTEGER);

    expect(huge.newBudget).toBe(Number.MAX_SAFE_INTEGER);
    expect(huge.distributableBudget).toBe(Math.floor(Number.MAX_SAFE_INTEGER * 0.8));
  });

  it('handles scheduled and rapid allocations without exceeding concurrency', () => {
    const manager = createManager({ maxConcurrent: 2 });
    let first;
    let second;

    mockedSetTimeout(() => {
      first = manager.allocate('scheduled-one');
    }, 0);
    mockedSetTimeout(() => {
      second = manager.allocate('scheduled-two');
    }, 0);

    expect(mockedTimers.setTimeout).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ budget: ISOLATED_BUDGET, mode: 'isolated' });
    expect(second).toMatchObject({ budget: ISOLATED_BUDGET, mode: 'isolated' });
    expect(manager.allocate('scheduled-three')).toEqual({
      error: 'Max concurrent limit reached (2)',
    });
  });
});

describe('createSubagentBudgetManager', () => {
  it('creates a manager with provided config', () => {
    const manager = createSubagentBudgetManager({
      parentBudget: 2000,
      reserveRatio: 0.2,
      maxConcurrent: 1,
    });

    expect(manager).toBeInstanceOf(SubagentBudgetManager);
    expect(manager.getStats().parentBudget).toBe(2000);
    expect(manager.canAllocate()).toEqual({ canAllocate: true });
  });

  it('accepts empty or array-like config values', () => {
    const empty = createSubagentBudgetManager();
    const arrayConfig = createSubagentBudgetManager([]);

    expect(empty).toBeInstanceOf(SubagentBudgetManager);
    expect(arrayConfig).toBeInstanceOf(SubagentBudgetManager);
  });
});
