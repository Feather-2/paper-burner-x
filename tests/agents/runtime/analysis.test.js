import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const warnSpy = vi.fn();

vi.mock("../../../js/agents/shared/utils/logger.js", () => {
  return {
    createLogger: () => ({
      log: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
    }),
  };
});

beforeEach(() => {
  warnSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime/analysis/behavior-fingerprint.js", () => {
  it("createActionSignature builds a stable fingerprint from action type + sorted param keys", async () => {
    const { createActionSignature } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    expect(createActionSignature({ type: "tool", params: { b: 1, a: 2 } })).toBe("tool:a,b");
    expect(createActionSignature({ name: "search", args: { q: "hi", limit: 10 } })).toBe(
      "search:limit,q"
    );
    expect(createActionSignature({})).toBe("unknown:");

    // Values should not affect the signature (structure-only).
    expect(createActionSignature({ type: "tool", params: { a: 1 } })).toBe(
      createActionSignature({ type: "tool", params: { a: 999 } })
    );
  });

  it("findRepeatingPatterns detects and sorts repeated subsequences", async () => {
    const { findRepeatingPatterns } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    const seq = ["a", "b", "c", "a", "b", "c", "a", "b", "c", "d"];
    const patterns = findRepeatingPatterns(seq, 2, 3);

    expect(patterns.length).toBeGreaterThan(3);
    expect(patterns[0]).toMatchObject({
      pattern: ["a", "b", "c"],
      count: 3,
      positions: [0, 3, 6],
    });

    expect(findRepeatingPatterns(["a", "b", "c"], 2, 10)).toEqual([]);
  });

  it("findConsecutiveLoops detects adjacent repeated patterns (tight loops)", async () => {
    const { findConsecutiveLoops } = await import("../../../js/agents/runtime/analysis/behavior-fingerprint.js");

    const seq = ["x", "y", "x", "y", "x", "y", "z", "z", "z", "z"];
    const loops = findConsecutiveLoops(seq, 2, 2);

    expect(loops[0]).toEqual({ pattern: ["x", "y"], consecutiveCount: 3, startPos: 0 });
    expect(loops).toContainEqual({ pattern: ["z", "z"], consecutiveCount: 2, startPos: 6 });
    expect(findConsecutiveLoops(["a", "b", "c"], 2, 10)).toEqual([]);
  });

  it("BehaviorFingerprint detects loops at threshold and triggers callback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { BehaviorFingerprint } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    const detected = [];
    const fp = new BehaviorFingerprint({
      loopThreshold: 3,
      minPatternLength: 2,
      maxPatternLength: 2,
      onLoopDetected: (info) => detected.push(info),
    });

    const actions = [
      { type: "x" },
      { type: "y" },
      { type: "x" },
      { type: "y" },
      { type: "x" },
      { type: "y" },
    ];

    let lastResult = null;
    for (const [idx, action] of actions.entries()) {
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, idx));
      lastResult = fp.recordAction(action);
    }

    expect(lastResult).toEqual({
      loopDetected: true,
      loopInfo: {
        pattern: ["x:", "y:"],
        count: 3,
        startPosition: 0,
        totalLoopsDetected: 1,
      },
    });
    expect(fp.isInLoop()).toBe(true);
    expect(fp.stats.loopCount).toBe(1);
    expect(detected).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Recent actions should include timestamps from Date.now()
    const recent = fp.getRecentActions(2);
    expect(recent).toEqual([
      { signature: "x:", ts: expect.any(Number) },
      { signature: "y:", ts: expect.any(Number) },
    ]);
  });

  it("BehaviorFingerprint enforces history size and supports reset/stats", async () => {
    const { BehaviorFingerprint } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    const fp = new BehaviorFingerprint({ historySize: 10, minPatternLength: 2, maxPatternLength: 2 });
    for (let i = 0; i < 12; i++) {
      fp.recordAction({ type: `act${i}` });
    }

    expect(fp.stats.historySize).toBe(10);
    expect(fp.getRecentActions(10)[0].signature).toBe("act2:");

    fp.reset();
    expect(fp.stats).toEqual({
      historySize: 0,
      maxHistorySize: 10,
      loopCount: 0,
      hasActiveLoop: false,
    });
  });

  it("BehaviorFingerprint getSuggestion covers break_loop / diversify / review / continue", async () => {
    const { BehaviorFingerprint } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    // break_loop: consecutive loop meets threshold
    const breakFp = new BehaviorFingerprint({ loopThreshold: 3, minPatternLength: 2, maxPatternLength: 2 });
    for (const t of ["x", "y", "x", "y", "x", "y"]) breakFp.recordAction({ type: t });
    expect(breakFp.getSuggestion()).toMatchObject({ action: "break_loop", severity: "high" });

    // diversify: low diversity, but loops disabled by an oversized minPatternLength
    const diversifyFp = new BehaviorFingerprint({ minPatternLength: 20, maxPatternLength: 20 });
    for (let i = 0; i < 11; i++) diversifyFp.recordAction({ type: "same" });
    expect(diversifyFp.getSuggestion()).toMatchObject({ action: "diversify", severity: "medium" });

    // review: many repeating patterns, but loopThreshold higher than any detected consecutive loop
    const reviewFp = new BehaviorFingerprint({ minPatternLength: 2, maxPatternLength: 3, loopThreshold: 4 });
    for (const t of ["a", "b", "c", "a", "b", "c", "a", "b", "c", "d"]) reviewFp.recordAction({ type: t });
    expect(reviewFp.getSuggestion()).toMatchObject({ action: "review", severity: "low" });

    // continue: no concerning patterns
    const okFp = new BehaviorFingerprint({ minPatternLength: 2, maxPatternLength: 3 });
    for (const t of ["a", "b", "c", "d", "e"]) okFp.recordAction({ type: t });
    expect(okFp.getSuggestion()).toMatchObject({ action: "continue", severity: "none" });
  });

  it("ContextDistiller distills parent context by relevance and truncates long fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { ContextDistiller } = await import(
      "../../../js/agents/runtime/analysis/behavior-fingerprint.js"
    );

    const distiller = new ContextDistiller({ relevanceThreshold: 0.2 });

    expect(distiller.distill(null, "anything")).toEqual({});
    expect(distiller.distill({ taskGoal: "x" }, "")).toEqual({});

    const parentContext = {
      taskGoal: "g".repeat(250),
      discoveries: [
        "Speed reads improved by caching",
        "Caching speed improved",
        "Unrelated UI tweak",
      ],
      constraints: ["c1", "c2", "c3", "c4"],
      toolHistory: [{ name: "read" }, { tool: "grep" }, { name: "read" }, {}],
      decisions: [
        "Improve caching speed reads",
        "Caching speed reads",
        "Caching speed",
        "Caching",
        "Ignore this decision",
      ],
    };

    const distilled = distiller.distill(parentContext, "Improve caching speed reads");

    expect(distilled.parentGoal).toHaveLength(200);
    expect(distilled.parentGoal.endsWith("...")).toBe(true);
    expect(distilled.relevantDiscoveries).toEqual([
      "Speed reads improved by caching",
      "Caching speed improved",
    ]);
    expect(distilled.constraints).toEqual(["c1", "c2", "c3"]);
    expect(distilled.toolSummary).toEqual({ read: 2, grep: 1, unknown: 1 });
    expect(distilled.keyDecisions).toEqual([
      "Improve caching speed reads",
      "Caching speed reads",
      "Caching speed",
    ]);
    expect(distilled.childTask).toBe("Improve caching speed reads");
    expect(distilled.distilledAt).toBe(Date.now());

    // Non-string childTask: should still return a shaped object, but with empty relevance matches.
    const distilledNonString = distiller.distill(parentContext, 123);
    expect(distilledNonString.relevantDiscoveries).toEqual([]);
    expect(distilledNonString.keyDecisions).toEqual([]);
  });
});

