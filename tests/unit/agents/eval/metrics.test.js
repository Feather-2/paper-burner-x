import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "virtual:trial-fixtures",
  () => {
    return {
      makeTrials: vi.fn((count = 4, passIndexes = [0]) => {
        const indexes = Array.isArray(passIndexes) ? passIndexes : [];
        const passSet = new Set(indexes);
        return Array.from({ length: count }, (_, i) => ({ passed: passSet.has(i) }));
      }),
    };
  },
  { virtual: true },
);

import { makeTrials } from "virtual:trial-fixtures";
import { aggregateResults, passAtK, passExpK } from "../../../../js/agents/eval/metrics.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("passAtK", () => {
  it("computes pass@k with empirical pass rate", () => {
    const trials = makeTrials(4, [0, 2]);
    const result = passAtK(trials, 2);

    expect(result).toBeCloseTo(0.75, 6);
    expect(makeTrials).toHaveBeenCalledTimes(1);
  });

  it("floors k and ignores non-true passed flags", () => {
    const trials = [
      { passed: true },
      { passed: "true" },
      { passed: 1 },
      { passed: false },
      {},
    ];

    const result = passAtK(trials, 1.9);

    expect(result).toBeCloseTo(0.2, 6);
  });

  it("returns 0 for empty or invalid trials and non-positive k", () => {
    const trials = [{ passed: true }];

    expect(passAtK(trials, 0)).toBe(0);
    expect(passAtK(trials, -1)).toBe(0);
    expect(passAtK([], 1)).toBe(0);
    expect(passAtK(null, 1)).toBe(0);
    expect(passAtK(undefined, 1)).toBe(0);
    expect(passAtK("", 1)).toBe(0);
    expect(passAtK("   ", 1)).toBe(0);
    expect(passAtK({}, 1)).toBe(0);
  });

  it("treats non-finite or string k as 0 and clamps large k", () => {
    const trials = [{ passed: true }];

    expect(passAtK(trials, "2")).toBe(0);
    expect(passAtK(trials, Number.POSITIVE_INFINITY)).toBe(0);
    expect(passAtK(trials, Number.NaN)).toBe(0);
    expect(passAtK(trials, Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it("handles large input and concurrent calls consistently", async () => {
    const largeTrials = Array.from({ length: 20000 }, (_, i) => ({
      passed: i % 2 === 0,
    }));
    const expected = 1 - Math.pow(1 - 0.5, 3);

    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        Promise.resolve().then(() => passAtK(largeTrials, 3)),
      ),
    );

    expect(new Set(results)).toEqual(new Set([expected]));

    for (let i = 0; i < 25; i += 1) {
      expect(passAtK(largeTrials, 3)).toBeCloseTo(expected, 6);
    }
  });
});

describe("passExpK", () => {
  it("computes pass^k with empirical pass rate", () => {
    const trials = makeTrials(4, [0, 2]);
    const result = passExpK(trials, 2);

    expect(result).toBeCloseTo(0.25, 6);
  });

  it("returns 0 for empty trials and non-positive k", () => {
    const trials = makeTrials(3, [0]);

    expect(passExpK([], 1)).toBe(0);
    expect(passExpK(trials, 0)).toBe(0);
    expect(passExpK(trials, -1)).toBe(0);
  });

  it("floors fractional k, rejects string k, and clamps max safe integer", () => {
    const trials = [{ passed: true }, { passed: false }];

    expect(passExpK(trials, 1.9)).toBeCloseTo(0.5, 6);
    expect(passExpK(trials, "2")).toBe(0);
    expect(passExpK([{ passed: true }], Number.MAX_SAFE_INTEGER)).toBe(1);
  });

  it("handles concurrent and rapid calls consistently", async () => {
    const trials = Array.from({ length: 12000 }, (_, i) => ({
      passed: i % 3 === 0,
    }));
    const expected = Math.pow(1 / 3, 2);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => passExpK(trials, 2)),
      ),
    );

    for (const value of results) {
      expect(value).toBeCloseTo(expected, 6);
    }

    for (let i = 0; i < 20; i += 1) {
      expect(passExpK(trials, 2)).toBeCloseTo(expected, 6);
    }
  });
});

describe("aggregateResults", () => {
  it("aggregates totals and averages for normal data", () => {
    const taskResults = [
      {
        passRate: 0.5,
        trials: [
          { passed: true, score: 10, latencyMs: 100 },
          { passed: false, score: 0, latencyMs: 300 },
        ],
      },
      {
        passRate: 1,
        trials: [{ passed: true, score: 5, latencyMs: 50 }],
      },
      {
        passRate: 0,
        trials: [],
      },
    ];

    const metrics = aggregateResults(taskResults);

    expect(metrics.totalTasks).toBe(3);
    expect(metrics.passedTasks).toBe(2);
    expect(metrics.avgPassRate).toBeCloseTo(0.5, 6);
    expect(metrics.avgScore).toBeCloseTo(5, 6);
    expect(metrics.avgLatencyMs).toBeCloseTo(150, 6);
  });

  it("ignores non-finite values and non-array trials", () => {
    const taskResults = [
      {
        passRate: Number.NaN,
        trials: [{ passed: false, score: Number.NaN, latencyMs: Number.POSITIVE_INFINITY }],
      },
      {
        passRate: Number.POSITIVE_INFINITY,
        trials: "not-an-array",
      },
      {
        passRate: 0.25,
        trials: [{ passed: false, score: 4, latencyMs: 20 }],
      },
    ];

    const metrics = aggregateResults(taskResults);

    expect(metrics.totalTasks).toBe(3);
    expect(metrics.passedTasks).toBe(0);
    expect(metrics.avgPassRate).toBeCloseTo(0.25, 6);
    expect(metrics.avgScore).toBeCloseTo(4, 6);
    expect(metrics.avgLatencyMs).toBeCloseTo(20, 6);
  });

  it("returns zeros for empty or invalid inputs", () => {
    const emptyMetrics = {
      totalTasks: 0,
      passedTasks: 0,
      avgPassRate: 0,
      avgScore: 0,
      avgLatencyMs: 0,
    };

    expect(aggregateResults([])).toEqual(emptyMetrics);
    expect(aggregateResults(null)).toEqual(emptyMetrics);
    expect(aggregateResults(undefined)).toEqual(emptyMetrics);
    expect(aggregateResults("")).toEqual(emptyMetrics);
    expect(aggregateResults("   ")).toEqual(emptyMetrics);
    expect(aggregateResults({})).toEqual(emptyMetrics);
  });

  it("handles deep nesting, long strings, and large input lists", () => {
    const hugeString = "x".repeat(100000);
    const nestedTask = {
      passRate: hugeString,
      trials: [[[{ passed: true, score: 999, latencyMs: 1 }]]],
    };
    const largeTrials = Array.from({ length: 10000 }, (_, i) => ({
      passed: i % 2 === 0,
      score: i,
      latencyMs: i * 2,
    }));

    const metrics = aggregateResults([
      nestedTask,
      {
        passRate: 0.5,
        trials: largeTrials,
      },
    ]);

    expect(metrics.totalTasks).toBe(2);
    expect(metrics.passedTasks).toBe(1);
    expect(metrics.avgPassRate).toBeCloseTo(0.5, 6);
    expect(metrics.avgScore).toBeCloseTo(4999.5, 6);
    expect(metrics.avgLatencyMs).toBeCloseTo(9999, 6);
  });

  it("handles concurrent and rapid calls consistently", async () => {
    const taskResults = [
      {
        passRate: 1,
        trials: [{ passed: true, score: 1, latencyMs: 2 }],
      },
    ];
    const expected = {
      totalTasks: 1,
      passedTasks: 1,
      avgPassRate: 1,
      avgScore: 1,
      avgLatencyMs: 2,
    };

    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        Promise.resolve().then(() => aggregateResults(taskResults)),
      ),
    );

    for (const result of results) {
      expect(result).toEqual(expected);
    }

    for (let i = 0; i < 20; i += 1) {
      expect(aggregateResults(taskResults)).toEqual(expected);
    }
  });
});
