import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };
  const safeInt = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    return Number.isNaN(i) ? null : i;
  };
  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };
  class Deque {
    constructor() {
      this._data = [];
    }
    get size() {
      return this._data.length;
    }
    push(value) {
      this._data.push(value);
    }
    shift() {
      return this._data.shift();
    }
  }
  return { isPlainObject, safeInt, toNonEmptyString, Deque };
});

const stateMocks = vi.hoisted(() => {
  const DecisionOutcome = Object.freeze({ SUCCESS: "success", FAIL: "fail" });
  const DecisionStage = Object.freeze({ GAPS: "gaps" });
  const GapStatus = Object.freeze({ OPEN: "open", FILLED: "filled", BLOCKED: "blocked" });
  const TodoStatus = Object.freeze({ OPEN: "open", COMPLETED: "completed", CANCELLED: "cancelled" });
  return { DecisionOutcome, DecisionStage, GapStatus, TodoStatus };
});

const todoMocks = vi.hoisted(() => {
  const createTodo = vi.fn((params) => ({ ...params }));
  const transitionTodoStatus = vi.fn(() => true);
  return { createTodo, transitionTodoStatus };
});

const checkpointMocks = vi.hoisted(() => {
  const cloneValue = vi.fn((value) => value);
  return { cloneValue };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  safeInt: sharedMocks.safeInt,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  Deque: sharedMocks.Deque,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/states.js", () => ({
  DecisionOutcome: stateMocks.DecisionOutcome,
  DecisionStage: stateMocks.DecisionStage,
  GapStatus: stateMocks.GapStatus,
  TodoStatus: stateMocks.TodoStatus,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  createTodo: todoMocks.createTodo,
  transitionTodoStatus: todoMocks.transitionTodoStatus,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/internal/checkpoint.js", () => ({
  cloneValue: checkpointMocks.cloneValue,
}));

import { transitionGap, computeRoundHitsByGapId } from "../../../../../js/agents/stages/deepsearch/state-logic.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("transitionGap", () => {
  it("returns false for falsy gap values", () => {
    const emitFn = vi.fn();
    const cases = [null, undefined, "", 0];
    for (const gap of cases) {
      expect(transitionGap(gap, stateMocks.GapStatus.FILLED, { ts: "2024-01-01T00:00:00Z" }, emitFn)).toBe(false);
    }
    expect(emitFn).not.toHaveBeenCalled();
  });

  it("does not transition when status is unchanged", () => {
    const emitFn = vi.fn();
    const gap = { gapId: "gap_1", status: stateMocks.GapStatus.OPEN, updatedAt: "prev" };

    const didTransition = transitionGap(gap, stateMocks.GapStatus.OPEN, { ts: "2024-01-01T00:00:00Z" }, emitFn);

    expect(didTransition).toBe(false);
    expect(gap.status).toBe(stateMocks.GapStatus.OPEN);
    expect(gap.updatedAt).toBe("prev");
    expect(emitFn).not.toHaveBeenCalled();
  });

  it("transitions with default status and emits payload", () => {
    const emitFn = vi.fn();
    const gap = { gapId: "gap_2" };

    const didTransition = transitionGap(gap, stateMocks.GapStatus.FILLED, { ts: "2024-01-01T00:00:00Z" }, emitFn);

    expect(didTransition).toBe(true);
    expect(gap.status).toBe(stateMocks.GapStatus.FILLED);
    expect(gap.updatedAt).toBe("2024-01-01T00:00:00Z");
    expect(emitFn).toHaveBeenCalledTimes(1);
    expect(emitFn).toHaveBeenCalledWith("deepsearch.gap.transitioned", {
      gapId: "gap_2",
      from: stateMocks.GapStatus.OPEN,
      to: stateMocks.GapStatus.FILLED,
    });
  });

  it("uses Date.now when meta.ts is missing", () => {
    const emitFn = vi.fn();
    const gap = { gapId: "gap_3", status: stateMocks.GapStatus.OPEN };
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    const didTransition = transitionGap(gap, stateMocks.GapStatus.BLOCKED, {}, emitFn);

    expect(didTransition).toBe(true);
    expect(gap.updatedAt).toBe(1710000000000);
    nowSpy.mockRestore();
  });

  it("handles rapid consecutive calls on the same gap", () => {
    const emitFn = vi.fn();
    const gap = { gapId: "gap_rapid", status: stateMocks.GapStatus.OPEN };

    const first = transitionGap(gap, stateMocks.GapStatus.FILLED, { ts: "t1" }, emitFn);
    const second = transitionGap(gap, stateMocks.GapStatus.FILLED, { ts: "t2" }, emitFn);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(gap.updatedAt).toBe("t1");
    expect(emitFn).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent transitions across gaps", async () => {
    const emitFn = vi.fn();
    const gapA = { gapId: "gap_a", status: stateMocks.GapStatus.OPEN };
    const gapB = { gapId: "gap_b", status: stateMocks.GapStatus.OPEN };

    const [resultA, resultB] = await Promise.all([
      Promise.resolve(transitionGap(gapA, stateMocks.GapStatus.FILLED, { ts: "a" }, emitFn)),
      Promise.resolve(transitionGap(gapB, stateMocks.GapStatus.BLOCKED, { ts: "b" }, emitFn)),
    ]);

    expect(resultA).toBe(true);
    expect(resultB).toBe(true);
    expect(gapA.status).toBe(stateMocks.GapStatus.FILLED);
    expect(gapB.status).toBe(stateMocks.GapStatus.BLOCKED);
    expect(emitFn).toHaveBeenCalledTimes(2);
    expect(emitFn.mock.calls).toEqual(
      expect.arrayContaining([
        [
          "deepsearch.gap.transitioned",
          { gapId: "gap_a", from: stateMocks.GapStatus.OPEN, to: stateMocks.GapStatus.FILLED },
        ],
        [
          "deepsearch.gap.transitioned",
          { gapId: "gap_b", from: stateMocks.GapStatus.OPEN, to: stateMocks.GapStatus.BLOCKED },
        ],
      ])
    );
  });

  it("handles long strings and deep nested meta", () => {
    const emitFn = vi.fn();
    const longId = "g".repeat(100000);
    const gap = { gapId: longId, status: stateMocks.GapStatus.OPEN };
    const meta = { ts: "2024-01-01T00:00:00Z", deep: { a: { b: { c: [1, { d: "x" }] } } } };

    const didTransition = transitionGap(gap, stateMocks.GapStatus.FILLED, meta, emitFn);

    expect(didTransition).toBe(true);
    expect(gap.updatedAt).toBe("2024-01-01T00:00:00Z");
    expect(emitFn).toHaveBeenCalledWith("deepsearch.gap.transitioned", {
      gapId: longId,
      from: stateMocks.GapStatus.OPEN,
      to: stateMocks.GapStatus.FILLED,
    });
  });
});

describe("computeRoundHitsByGapId", () => {
  it("returns an empty map for nullish or empty inputs", () => {
    const cases = [null, undefined, [], ""];
    for (const input of cases) {
      const result = computeRoundHitsByGapId(input);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    }
  });

  it("throws for non-iterable inputs like plain objects", () => {
    expect(() => computeRoundHitsByGapId({})).toThrow(TypeError);
  });

  it("maps gapId to hitCount with boundary values", () => {
    const gaps = [
      { gapId: "gap_1", hitCount: 0 },
      { gapId: "gap_2", hitCount: -1 },
      { gapId: "gap_3", hitCount: Number.MAX_SAFE_INTEGER },
      { gapId: "gap_4", hitCount: "5" },
      { gapId: "gap_5", hitCount: null },
      { gapId: "   ", hitCount: 7 },
      { gapId: "", hitCount: 12 },
      { gapId: 0, hitCount: 2 },
      null,
      0,
      "junk",
    ];

    const result = computeRoundHitsByGapId(gaps);

    expect(result.size).toBe(6);
    expect(result.get("gap_1")).toBe(0);
    expect(result.get("gap_2")).toBe(-1);
    expect(result.get("gap_3")).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.get("gap_4")).toBe("5");
    expect(result.get("gap_5")).toBe(0);
    expect(result.get("   ")).toBe(7);
    expect(result.has("")).toBe(false);
    expect(result.has("0")).toBe(false);
  });

  it("returns independent maps for concurrent calls", async () => {
    const gaps = [{ gapId: "gap_a", hitCount: 1 }];
    const [first, second, third] = await Promise.all([
      Promise.resolve(computeRoundHitsByGapId(gaps)),
      Promise.resolve(computeRoundHitsByGapId(gaps)),
      Promise.resolve(computeRoundHitsByGapId(gaps)),
    ]);

    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(first.get("gap_a")).toBe(1);
    expect(second.get("gap_a")).toBe(1);
    expect(third.get("gap_a")).toBe(1);

    first.set("extra", 99);
    expect(second.has("extra")).toBe(false);
    expect(third.has("extra")).toBe(false);
  });

  it("handles large inputs and long gapId strings", () => {
    const longId = "x".repeat(100000);
    const gaps = Array.from({ length: 10000 }, (_, index) => ({
      gapId: `gap_${index}`,
      hitCount: index,
    }));
    gaps.push({ gapId: longId, hitCount: 1, extra: { nested: { depth: 6 } } });

    const result = computeRoundHitsByGapId(gaps);

    expect(result.size).toBe(10001);
    expect(result.get("gap_9999")).toBe(9999);
    expect(result.get(longId)).toBe(1);
  });
});
