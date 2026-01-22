import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerDebugMock = vi.hoisted(() => vi.fn());

const createLoggerMock = vi.hoisted(() =>
  vi.fn(() => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock,
  }))
);

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: createLoggerMock,
}));

import {
  EwmaTracker,
  ModelTier,
  TaskComplexity,
} from '../../../../../js/agents/plugins/routing/performance-router.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelTier', () => {
  it('exposes expected tiers and is frozen', () => {
    expect(ModelTier).toEqual({
      FAST: 'fast',
      POWER: 'power',
      FALLBACK: 'fallback',
    });
    expect(Object.values(ModelTier).sort()).toEqual(['fallback', 'fast', 'power'].sort());
    expect(Object.isFrozen(ModelTier)).toBe(true);
  });

  it('rejects mutations (existing/new keys, whitespace keys, large payloads)', () => {
    const snapshot = { ...ModelTier };
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    expect(() => {
      // @ts-expect-error - mutation attempt
      ModelTier.FAST = 'slow';
    }).toThrow();

    expect(() => {
      // @ts-expect-error - new property on frozen object
      ModelTier['   '] = 'whitespace-key';
    }).toThrow();

    expect(() => {
      // @ts-expect-error - new property with large key/value
      ModelTier['x'.repeat(10_000)] = deep;
    }).toThrow();

    expect(ModelTier).toEqual(snapshot);
  });
});

describe('TaskComplexity', () => {
  it('exposes expected levels and is frozen', () => {
    expect(TaskComplexity).toEqual({
      SIMPLE: 'simple',
      MODERATE: 'moderate',
      COMPLEX: 'complex',
    });
    expect(Object.values(TaskComplexity).sort()).toEqual(['complex', 'moderate', 'simple'].sort());
    expect(Object.isFrozen(TaskComplexity)).toBe(true);
  });

  it('rejects mutations (existing/new keys, whitespace keys, large payloads)', () => {
    const snapshot = { ...TaskComplexity };
    const huge = 'x'.repeat(200_000);

    expect(() => {
      // @ts-expect-error - mutation attempt
      TaskComplexity.SIMPLE = 'easy';
    }).toThrow();

    expect(() => {
      // @ts-expect-error - new property on frozen object
      TaskComplexity[''] = 'empty-key';
    }).toThrow();

    expect(() => {
      // @ts-expect-error - new property on frozen object
      TaskComplexity['   '] = huge;
    }).toThrow();

    expect(TaskComplexity).toEqual(snapshot);
  });
});

describe('EwmaTracker', () => {
  it('initializes with defaults and stable empty stats', () => {
    const a = new EwmaTracker();
    const b = new EwmaTracker(undefined);
    const c = new EwmaTracker([]);

    for (const tracker of [a, b, c]) {
      expect(tracker.value).toBe(0);
      expect(tracker.stats).toEqual({ ewma: 0, count: 0, min: 0, max: 0 });
    }
  });

  it('throws for null options (null boundary)', () => {
    expect(() => new EwmaTracker(null)).toThrow();
  });

  it('records first sample directly then applies EWMA for later samples', () => {
    const tracker = new EwmaTracker({ alpha: 0.5 });
    expect(tracker.record(10)).toBe(10);
    expect(tracker.record(20)).toBe(15);
    expect(tracker.stats).toEqual({ ewma: 15, count: 2, min: 10, max: 20 });
  });

  it('clamps alpha into [0.01, 0.99] and accepts numeric strings', () => {
    const hi = new EwmaTracker({ alpha: 2 });
    hi.record(10);
    expect(hi.record(20)).toBeCloseTo(19.9, 10);

    const lo = new EwmaTracker({ alpha: -1 });
    lo.record(10);
    expect(lo.record(20)).toBeCloseTo(10.1, 10);

    const str = new EwmaTracker({ alpha: '0.5' });
    str.record(10);
    expect(str.record(20)).toBe(15);
  });

  it('preserves initialValue until the first valid sample is recorded', () => {
    const tracker = new EwmaTracker({ initialValue: 42 });
    expect(tracker.value).toBe(42);
    expect(tracker.stats).toEqual({ ewma: 42, count: 0, min: 0, max: 0 });

    expect(tracker.record('10')).toBe(42);
    expect(tracker.stats).toEqual({ ewma: 42, count: 0, min: 0, max: 0 });

    expect(tracker.record(7)).toBe(7);
    expect(tracker.stats).toEqual({ ewma: 7, count: 1, min: 7, max: 7 });
  });

  it('ignores invalid samples without mutating stats (empty/type/resource boundaries)', () => {
    const tracker = new EwmaTracker({ initialValue: 7 });
    const hugeText = 'x'.repeat(1_000_000);
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.nested = {};
      cursor = cursor.nested;
    }

    const invalidSamples = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      { a: 1 },
      deep,
      hugeText,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      // @ts-expect-error - bigint boundary
      10n,
    ];

    for (const sample of invalidSamples) {
      expect(tracker.record(sample)).toBe(7);
    }

    expect(tracker.stats).toEqual({ ewma: 7, count: 0, min: 0, max: 0 });
  });

  it('handles numeric boundary values and resets cleanly', () => {
    const tracker = new EwmaTracker();
    tracker.record(0);
    tracker.record(-1);
    tracker.record(Number.MAX_SAFE_INTEGER);

    expect(tracker.stats.count).toBe(3);
    expect(tracker.stats.min).toBe(-1);
    expect(tracker.stats.max).toBe(Number.MAX_SAFE_INTEGER);

    tracker.reset();
    expect(tracker.value).toBe(0);
    expect(tracker.stats).toEqual({ ewma: 0, count: 0, min: 0, max: 0 });
  });

  it('supports rapid consecutive and microtask-batched updates', async () => {
    const tracker = new EwmaTracker({ alpha: 0.2 });

    for (let i = 0; i < 100; i += 1) {
      tracker.record(i);
    }
    expect(tracker.stats.count).toBe(100);
    expect(tracker.stats.min).toBe(0);
    expect(tracker.stats.max).toBe(99);

    tracker.reset();

    const samples = Array.from({ length: 50 }, (_, index) => index - 25);
    await Promise.all(samples.map((n) => Promise.resolve().then(() => tracker.record(n))));

    expect(tracker.stats.count).toBe(samples.length);
    expect(tracker.stats.min).toBe(-25);
    expect(tracker.stats.max).toBe(24);
  });
});
