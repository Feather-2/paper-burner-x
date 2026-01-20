import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedCrypto = vi.hoisted(() => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockedCrypto.randomUUID,
}));

import { randomUUID } from "node:crypto";

import {
  allPassGrader,
  weightedGrader,
  thresholdGrader,
} from "../../../../../js/agents/eval/graders/composite.js";

beforeEach(() => {
  mockedCrypto.randomUUID.mockClear();
});

const makeResult = ({ graderType, passed, score }) => ({
  graderType,
  passed,
  score,
  reason: "",
  issues: [],
});

describe("allPassGrader", () => {
  it("returns passed true and min score when all considered pass", () => {
    const results = [
      makeResult({ graderType: "alpha", passed: true, score: 0.9 }),
      makeResult({ graderType: "beta", passed: true, score: 0.4 }),
      makeResult({ graderType: "gamma", passed: true, score: 1 }),
    ];

    const out = allPassGrader.grade(results, { options: {} });

    expect(out).toEqual({
      graderType: "all_pass",
      passed: true,
      score: 0.4,
      reason: "All graders passed",
      issues: [],
    });
  });

  it("filters subset including empty and whitespace grader types", () => {
    const results = [
      makeResult({ graderType: "", passed: true, score: 0 }),
      makeResult({ graderType: "   ", passed: true, score: 0.5 }),
      makeResult({ graderType: "b", passed: false, score: 0.2 }),
      makeResult({ graderType: "c", passed: true, score: 0.9 }),
    ];

    const out = allPassGrader.grade(results, { options: { types: ["", "   ", "b"] } });

    expect(out.passed).toBe(false);
    expect(out.score).toBe(0);
    expect(out.reason).toBe("At least one grader failed");
  });

  it("returns defaults for empty results with empty config", () => {
    const out = allPassGrader.grade([], {});

    expect(out).toEqual({
      graderType: "all_pass",
      passed: true,
      score: 1,
      reason: "All graders passed",
      issues: [],
    });
  });

  it("treats non-array types object as a single entry", () => {
    const results = [makeResult({ graderType: "a", passed: false, score: 0.2 })];

    const out = allPassGrader.grade(results, { options: { types: { a: 1 } } });

    expect(out.passed).toBe(true);
    expect(out.score).toBe(1);
  });

  it("throws for null or undefined results", () => {
    expect(() => allPassGrader.grade(null, {})).toThrow(TypeError);
    expect(() => allPassGrader.grade(undefined, {})).toThrow(TypeError);
  });

  it("handles concurrent and rapid sequential calls", async () => {
    const cases = [
      {
        results: [makeResult({ graderType: "x", passed: true, score: 0.8 })],
        config: { options: { types: ["x"] } },
        expected: { passed: true, score: 0.8 },
      },
      {
        results: [
          makeResult({ graderType: "y", passed: true, score: 0.6 }),
          makeResult({ graderType: "z", passed: false, score: 0.2 }),
        ],
        config: { options: { types: ["y", "z"] } },
        expected: { passed: false, score: 0.2 },
      },
      {
        results: [makeResult({ graderType: "w", passed: true, score: 0.3 })],
        config: {},
        expected: { passed: true, score: 0.3 },
      },
    ];

    const outputs = await Promise.all(
      cases.map((item) => Promise.resolve().then(() => allPassGrader.grade(item.results, item.config)))
    );

    expect(outputs.map((out) => ({ passed: out.passed, score: out.score }))).toEqual(
      cases.map((item) => item.expected)
    );

    for (let i = 0; i < 3; i += 1) {
      const out = allPassGrader.grade(
        [makeResult({ graderType: `seq-${i}`, passed: true, score: 0.1 + i })],
        undefined
      );
      expect(out.passed).toBe(true);
    }
  });
});

describe("weightedGrader", () => {
  it("computes weighted average for subset and weights", () => {
    const results = [
      makeResult({ graderType: "a", passed: true, score: 1 }),
      makeResult({ graderType: "b", passed: true, score: 0 }),
      makeResult({ graderType: "c", passed: true, score: 0.5 }),
    ];

    const out = weightedGrader.grade(results, {
      options: { types: ["a", "b"], weights: { a: 2, b: 1 } },
    });

    expect(out.passed).toBe(true);
    expect(out.score).toBeCloseTo(2 / 3, 6);
    expect(out.reason).toBe("Weighted aggregation");
  });

  it("defaults invalid weights and scores and reflects failed results", () => {
    const results = [
      makeResult({ graderType: "a", passed: true, score: "0.3" }),
      makeResult({ graderType: "b", passed: false, score: undefined }),
    ];

    const out = weightedGrader.grade(results, {
      options: { weights: { a: "2", b: Number.NaN } },
    });

    expect(out.score).toBe(0);
    expect(out.passed).toBe(false);
  });

  it("handles object-as-array types with empty weights", () => {
    const results = [makeResult({ graderType: "x", passed: false, score: 0.5 })];

    const out = weightedGrader.grade(results, {
      options: { types: { foo: "bar" }, weights: {} },
    });

    expect(out.passed).toBe(true);
    expect(out.score).toBe(0);
  });

  it("handles large datasets, long grader types, and nested options", () => {
    const longType = `${randomUUID()}-${"x".repeat(10000)}`;
    const largeResults = Array.from({ length: 10000 }, (_, index) =>
      makeResult({
        graderType: index % 2 === 0 ? longType : "short",
        passed: true,
        score: index % 2,
      })
    );

    const out = weightedGrader.grade(largeResults, {
      options: {
        weights: { [longType]: 2 },
        meta: { a: { b: { c: { d: { e: "deep" } } } } },
      },
    });

    expect(out.passed).toBe(true);
    expect(out.score).toBeCloseTo(1 / 3, 5);
    expect(mockedCrypto.randomUUID).toHaveBeenCalledTimes(1);
  });
});

describe("thresholdGrader", () => {
  it("aggregates using avg/min/max and compares against threshold", () => {
    const results = [
      makeResult({ graderType: "a", passed: true, score: 0.2 }),
      makeResult({ graderType: "b", passed: true, score: 0.8 }),
    ];

    const avgOut = thresholdGrader.grade(results, { options: { threshold: 0.5, use: "avg" } });
    expect(avgOut.score).toBeCloseTo(0.5, 6);
    expect(avgOut.passed).toBe(true);
    expect(avgOut.reason).toContain(">= threshold 0.5");

    const minOut = thresholdGrader.grade(results, { options: { threshold: 0.3, use: "min" } });
    expect(minOut.score).toBe(0.2);
    expect(minOut.passed).toBe(false);

    const maxOut = thresholdGrader.grade(results, { options: { threshold: 0.7, use: "max" } });
    expect(maxOut.score).toBe(0.8);
    expect(maxOut.passed).toBe(true);
  });

  it("clamps threshold to [0,1] for boundary values", () => {
    const lowOut = thresholdGrader.grade([makeResult({ graderType: "a", passed: true, score: 0 })], {
      options: { threshold: -1 },
    });
    expect(lowOut.passed).toBe(true);
    expect(lowOut.reason).toContain("threshold 0");

    const highOut = thresholdGrader.grade([makeResult({ graderType: "b", passed: true, score: 0.9 })], {
      options: { threshold: Number.MAX_SAFE_INTEGER },
    });
    expect(highOut.passed).toBe(false);
    expect(highOut.reason).toContain("threshold 1");
  });

  it("defaults when threshold/use are invalid and handles empty arrays", () => {
    const results = [
      makeResult({ graderType: "a", passed: true, score: 0.5 }),
      makeResult({ graderType: "b", passed: true, score: 0.7 }),
    ];

    const out = thresholdGrader.grade(results, {
      options: { threshold: "0.75", use: "nope", types: [] },
    });

    expect(out.score).toBeCloseTo(0.6, 6);
    expect(out.passed).toBe(true);
    expect(out.reason).toContain("threshold 0.6");

    const emptyOut = thresholdGrader.grade([], undefined);
    expect(emptyOut.score).toBe(0);
    expect(emptyOut.passed).toBe(false);
  });
});
