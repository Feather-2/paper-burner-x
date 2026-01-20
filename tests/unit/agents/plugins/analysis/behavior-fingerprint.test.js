import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const mockedCreateLogger = vi.hoisted(() => vi.fn(() => mockedLogger));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockedCreateLogger,
}));

import BehaviorFingerprint, {
  BehaviorFingerprint as BehaviorFingerprintNamed,
  ContextDistiller,
  createActionSignature,
  findRepeatingPatterns,
  findConsecutiveLoops,
} from "../../../../../js/agents/plugins/analysis/behavior-fingerprint.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createActionSignature", () => {
  it("builds signature from type and sorted param keys", () => {
    const action = { type: "tool", params: { b: 2, a: 1, nested: { x: 1 } } };
    expect(createActionSignature(action)).toBe("tool:a,b,nested");
  });

  it("falls back to name/args and handles empty object", () => {
    expect(createActionSignature({ name: "fallback", args: { z: 1 } })).toBe("fallback:z");
    expect(createActionSignature({})).toBe("unknown:");
  });

  it("handles empty and whitespace types with non-object inputs", () => {
    expect(createActionSignature({ type: "", name: "named" })).toBe("named:");
    expect(createActionSignature({ type: "   ", params: {} })).toBe("   :");
    expect(createActionSignature("")).toBe("unknown:");
    expect(createActionSignature(0)).toBe("unknown:");
  });

  it("throws on null or undefined input", () => {
    expect(() => createActionSignature(null)).toThrow(TypeError);
    expect(() => createActionSignature(undefined)).toThrow(TypeError);
  });
});

describe("findRepeatingPatterns", () => {
  it("detects repeated patterns and sorts by count", () => {
    const sequence = ["x", "y", "x", "y", "x", "y"];
    const results = findRepeatingPatterns(sequence, 2, 2);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      pattern: ["x", "y"],
      count: 3,
      positions: [0, 2, 4],
    });
    expect(results[1]).toEqual({
      pattern: ["y", "x"],
      count: 2,
      positions: [1, 3],
    });
  });

  it("returns empty for empty or short sequences", () => {
    expect(findRepeatingPatterns([], 2, 2)).toEqual([]);
    expect(findRepeatingPatterns(["only"], 2, 2)).toEqual([]);
  });

  it("handles long strings with numeric lengths", () => {
    const long = "a".repeat(10000);
    const sequence = [long, "b", long, "b", "c"];
    const results = findRepeatingPatterns(sequence, 2, 2);

    expect(results[0].pattern).toEqual([long, "b"]);
    expect(results[0].count).toBe(2);
  });

  it("handles numeric string lengths without throwing", () => {
    const sequence = ["x", "y", "x", "y"];
    const results = findRepeatingPatterns(sequence, "2", "2");

    expect(results[0]).toEqual({
      pattern: ["x", "y"],
      count: 2,
      positions: [0, 2],
    });
  });

  it("throws when sequence is not array-like", () => {
    expect(() => findRepeatingPatterns({ length: 4 }, 2, 2)).toThrow();
  });

  it("handles concurrent calls with large sequences", async () => {
    const sequence = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? "a" : "b"));
    const reversed = [...sequence].reverse();

    const [forward, backward] = await Promise.all([
      Promise.resolve().then(() => findRepeatingPatterns(sequence, 2, 2)),
      Promise.resolve().then(() => findRepeatingPatterns(reversed, 2, 2)),
    ]);

    expect(forward[0].pattern).toEqual(["a", "b"]);
    expect(backward[0].pattern).toEqual(["b", "a"]);
  });
});

describe("findConsecutiveLoops", () => {
  it("detects consecutive loops and sorts by count", () => {
    const sequence = ["a", "b", "a", "b", "a", "b"];
    const loops = findConsecutiveLoops(sequence, 2, 2);

    expect(loops[0]).toEqual({
      pattern: ["a", "b"],
      consecutiveCount: 3,
      startPos: 0,
    });
  });

  it("returns empty for empty or short sequences", () => {
    expect(findConsecutiveLoops([], 2, 2)).toEqual([]);
    expect(findConsecutiveLoops(["only"], 2, 2)).toEqual([]);
  });

  it("returns empty when lengths are numeric strings", () => {
    const loops = findConsecutiveLoops(["x", "x", "x"], "1", "1");
    expect(loops).toEqual([]);
  });

  it("throws when sequence is not array-like", () => {
    expect(() => findConsecutiveLoops({ length: 2 }, 1, 1)).toThrow();
  });
});

describe("BehaviorFingerprint", () => {
  it("uses the same class for default and named exports", () => {
    expect(BehaviorFingerprint).toBe(BehaviorFingerprintNamed);
  });

  it("records actions with non-object inputs and sorted params", () => {
    const fingerprint = new BehaviorFingerprint({ historySize: 10 });

    fingerprint.recordAction(null);
    fingerprint.recordAction(undefined);
    fingerprint.recordAction({});
    fingerprint.recordAction({ type: "tool", params: { b: 2, a: 1 } });

    const recent = fingerprint.getRecentActions(4);
    expect(recent.map((entry) => entry.signature)).toEqual([
      "unknown:",
      "unknown:",
      "unknown:",
      "tool:a,b",
    ]);
  });

  it("trims history to the enforced minimum size", () => {
    const fingerprint = new BehaviorFingerprint({ historySize: 0 });

    for (let i = 0; i < 12; i++) {
      fingerprint.recordAction({ type: "tick", params: { index: i } });
    }

    expect(fingerprint.stats.maxHistorySize).toBe(10);
    expect(fingerprint.stats.historySize).toBe(10);
  });

  it("detects loops, logs warnings, and invokes callback", () => {
    const onLoopDetected = vi.fn();
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 2,
      loopThreshold: -1,
      onLoopDetected,
    });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "a" });
    const result = fingerprint.recordAction({ type: "b" });

    expect(result.loopDetected).toBe(true);
    expect(onLoopDetected).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
    expect(result.loopInfo.pattern).toEqual(["a:", "b:"]);
  });

  it("summarizes analysis metrics without patterns for short histories", () => {
    const fingerprint = new BehaviorFingerprint({ historySize: 10 });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "a" });

    const analysis = fingerprint.getAnalysis();
    expect(analysis.totalActions).toBe(3);
    expect(analysis.uniqueActions).toBe(2);
    expect(analysis.diversityScore).toBeCloseTo(2 / 3);
    expect(analysis.actionFrequency).toEqual({ "a:": 2, "b:": 1 });
    expect(analysis.repeatingPatterns).toEqual([]);
    expect(analysis.consecutiveLoops).toEqual([]);
  });

  it("returns a high severity suggestion when loops exceed threshold", () => {
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 2,
      loopThreshold: 2,
    });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });

    const suggestion = fingerprint.getSuggestion();
    expect(suggestion.action).toBe("break_loop");
    expect(suggestion.severity).toBe("high");
  });

  it("returns a medium severity suggestion for low diversity", () => {
    const fingerprint = new BehaviorFingerprint({
      loopThreshold: Number.MAX_SAFE_INTEGER,
    });

    for (let i = 0; i < 20; i++) {
      fingerprint.recordAction({ type: "same" });
    }

    const suggestion = fingerprint.getSuggestion();
    expect(suggestion.action).toBe("diversify");
    expect(suggestion.severity).toBe("medium");
  });

  it("returns a low severity suggestion when many repeating patterns exist", () => {
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 10,
    });

    ["a", "b", "c", "a", "b", "d", "a", "b", "c", "a", "b", "d"].forEach((type) => {
      fingerprint.recordAction({ type });
    });

    const suggestion = fingerprint.getSuggestion();
    expect(suggestion.action).toBe("review");
    expect(suggestion.severity).toBe("low");
  });

  it("reports loop state and stats accurately", () => {
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 2,
      loopThreshold: 2,
    });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });

    expect(fingerprint.isInLoop()).toBe(true);
    expect(fingerprint.stats.hasActiveLoop).toBe(true);
  });

  it("handles boundary counts for recent actions", () => {
    const fingerprint = new BehaviorFingerprint({ historySize: 10 });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "c" });

    expect(fingerprint.getRecentActions(0)).toHaveLength(3);
    expect(fingerprint.getRecentActions(-1)).toHaveLength(2);
    expect(fingerprint.getRecentActions(Number.MAX_SAFE_INTEGER)).toHaveLength(3);
  });

  it("resets history and loop counters", () => {
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 2,
      loopThreshold: 2,
    });

    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });
    fingerprint.recordAction({ type: "a" });
    fingerprint.recordAction({ type: "b" });

    fingerprint.reset();

    const analysis = fingerprint.getAnalysis();
    expect(analysis.totalActions).toBe(0);
    expect(analysis.loopCount).toBe(0);
    expect(analysis.lastLoopPattern).toBeNull();
  });

  it("handles rapid consecutive recordAction calls", async () => {
    const fingerprint = new BehaviorFingerprint({ historySize: 50 });
    const actions = Array.from({ length: 20 }, (_, i) => ({ type: `t${i}` }));

    await Promise.all(
      actions.map((action) => Promise.resolve().then(() => fingerprint.recordAction(action)))
    );

    expect(fingerprint.stats.historySize).toBe(20);
  });
});

describe("ContextDistiller", () => {
  it("returns empty object when required inputs are missing", () => {
    const distiller = new ContextDistiller();

    expect(distiller.distill(null, "task")).toEqual({});
    expect(distiller.distill(undefined, "task")).toEqual({});
    expect(distiller.distill({}, "")).toEqual({});
    expect(distiller.distill({}, 0)).toEqual({});
  });

  it("distills relevant fields and summarizes tool usage", () => {
    const distiller = new ContextDistiller();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);
    const parentContext = {
      taskGoal: "g".repeat(220),
      discoveries: ["login bug observed", "cache warmup ok"],
      constraints: ["c1", "c2", "c3", "c4"],
      toolHistory: [{ name: "search" }, { tool: "search" }, { name: "compile" }, {}],
      decisions: ["login bug fixed by retry", "update docs"],
    };

    const result = distiller.distill(parentContext, "fix login bug");

    expect(result.parentGoal).toHaveLength(200);
    expect(result.parentGoal.endsWith("...")).toBe(true);
    expect(result.relevantDiscoveries).toEqual(["login bug observed"]);
    expect(result.constraints).toEqual(["c1", "c2", "c3"]);
    expect(result.toolSummary).toEqual({ search: 2, compile: 1, unknown: 1 });
    expect(result.keyDecisions).toEqual(["login bug fixed by retry"]);
    expect(result.childTask).toBe("fix login bug");
    expect(result.distilledAt).toBe(123456);

    nowSpy.mockRestore();
  });

  it("enforces token limits and trims content with numeric maxTokens", () => {
    const distiller = new ContextDistiller({ maxTokens: "5", relevanceThreshold: 0 });
    const parentContext = {
      taskGoal: "goal ".repeat(50),
      discoveries: Array.from({ length: 10 }, (_, i) => `alpha beta ${i}`),
      constraints: ["c1", "c2", "c3", "c4", "c5"],
      toolHistory: Array.from({ length: 20 }, (_, i) => ({
        name: i % 2 === 0 ? "toolA" : "toolB",
      })),
      decisions: Array.from({ length: 6 }, (_, i) => `alpha beta decision ${i}`),
    };

    const result = distiller.distill(parentContext, "alpha beta task");

    expect(result.relevantDiscoveries.length).toBeLessThan(parentContext.discoveries.length);
    expect(result.keyDecisions.length).toBeLessThan(parentContext.decisions.length);
    expect(result.constraints.length).toBeLessThan(parentContext.constraints.length);
    expect(result.parentGoal.length).toBeLessThan(parentContext.taskGoal.length);
  });

  it("supports concurrent distillation with deep nested data", async () => {
    const distiller = new ContextDistiller({ relevanceThreshold: 0.2 });
    const deepItem = {
      level1: { level2: { level3: { detail: "login bug root cause" } } },
    };
    const toolHistory = Array.from({ length: 500 }, (_, i) => ({
      name: i % 2 === 0 ? "toolA" : "toolB",
    }));

    const [resultA, resultB] = await Promise.all([
      Promise.resolve().then(() =>
        distiller.distill(
          {
            taskGoal: "investigate",
            discoveries: [deepItem],
            toolHistory,
            constraints: [],
            decisions: [],
          },
          "login bug"
        )
      ),
      Promise.resolve().then(() =>
        distiller.distill(
          {
            taskGoal: "document",
            discoveries: ["unrelated topic"],
            toolHistory: [],
            constraints: [],
            decisions: [],
          },
          "write docs"
        )
      ),
    ]);

    expect(resultA.relevantDiscoveries).toHaveLength(1);
    expect(resultA.toolSummary).toEqual({ toolA: 250, toolB: 250 });
    expect(resultB.childTask).toBe("write docs");
  });
});
