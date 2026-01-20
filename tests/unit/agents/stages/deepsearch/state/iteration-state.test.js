import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  const isPlainObject = vi.fn((value) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  const safeInt = vi.fn((value) => {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isSafeInteger(num) ? num : null;
    }
    return null;
  });

  const toNonEmptyString = vi.fn((value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  });

  return { isPlainObject, safeInt, toNonEmptyString };
});

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: hoisted.isPlainObject,
  safeInt: hoisted.safeInt,
  toNonEmptyString: hoisted.toNonEmptyString,
}));

import { IterationState } from "../../../../../../js/agents/stages/deepsearch/state/iteration-state.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../../../../../js/agents/shared/index.js";

describe("IterationState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults and ignores setters when root is null or undefined", () => {
    const stateNull = new IterationState(null);
    const stateUndefined = new IterationState(undefined);

    expect(stateNull.iteration).toBe(0);
    expect(stateNull.phase).toBe("");
    expect(stateNull.gaps).toEqual([]);
    expect(stateNull.chunks).toEqual([]);

    expect(stateUndefined.iteration).toBe(0);
    expect(stateUndefined.phase).toBe("");
    expect(stateUndefined.gaps).toEqual([]);
    expect(stateUndefined.chunks).toEqual([]);

    expect(() => {
      stateNull.iteration = 5;
      stateNull.phase = "phase";
      stateNull.gaps = [{ id: "g1" }];
      stateNull.chunks = [{ id: "c1" }];
    }).not.toThrow();

    expect(() => {
      stateUndefined.iteration = 1;
      stateUndefined.phase = "phase";
    }).not.toThrow();

    expect(safeInt).toHaveBeenCalledWith(undefined);
    expect(toNonEmptyString).toHaveBeenCalledWith(undefined);
  });

  it("reads and writes iteration using safeInt with boundary values", () => {
    const root = { iteration: "7" };
    const state = new IterationState(root);

    expect(state.iteration).toBe(7);
    expect(safeInt).toHaveBeenCalledWith("7");

    state.iteration = -1;
    expect(root.iteration).toBe(-1);

    state.iteration = 0;
    expect(root.iteration).toBe(0);

    state.iteration = Number.MAX_SAFE_INTEGER;
    expect(root.iteration).toBe(Number.MAX_SAFE_INTEGER);

    state.iteration = "42";
    expect(root.iteration).toBe(42);

    const badValue = { bad: true };
    state.iteration = badValue;
    expect(root.iteration).toBe(0);
    expect(safeInt).toHaveBeenCalledWith(badValue);

    const invalid = new IterationState({ iteration: "nope" });
    expect(invalid.iteration).toBe(0);
  });

  it("normalizes phase, handles empty/whitespace, and initializes L2", () => {
    const root = {};
    const state = new IterationState(root);

    state.phase = "   ";
    expect(root.L2).toEqual({ phase: "" });
    expect(state.phase).toBe("");
    expect(toNonEmptyString).toHaveBeenCalledWith("   ");

    state.phase = "";
    expect(root.L2.phase).toBe("");

    state.phase = "alpha";
    expect(root.L2.phase).toBe("alpha");
    expect(state.phase).toBe("alpha");

    const longPhase = "x".repeat(100000);
    state.phase = longPhase;
    expect(state.phase).toBe(longPhase);

    const rootBad = { L2: "bad" };
    const stateBad = new IterationState(rootBad);
    stateBad.phase = "beta";
    expect(rootBad.L2).toEqual({ phase: "beta" });
    expect(isPlainObject).toHaveBeenCalledWith("bad");
  });

  it("initializes gaps container and preserves deep nested L1", () => {
    const root = {};
    const state = new IterationState(root);

    expect(() => state.gaps).not.toThrow();
    expect(root.L1).toEqual({ gaps: [] });
    expect(state.gaps).toBe(root.L1.gaps);

    const rootBad = { L1: [] };
    const stateBad = new IterationState(rootBad);
    expect(stateBad.gaps).toEqual([]);
    expect(rootBad.L1).toEqual({ gaps: [] });

    const deepRoot = {
      L1: {
        gaps: [{ id: "g1", status: "open" }],
        meta: { nested: { level: { deep: true } } },
      },
    };
    const originalL1 = deepRoot.L1;
    const originalGaps = deepRoot.L1.gaps;
    const deepState = new IterationState(deepRoot);

    expect(deepState.gaps).toBe(originalGaps);
    expect(deepRoot.L1).toBe(originalL1);
    expect(isPlainObject).toHaveBeenCalledWith(originalL1);
  });

  it("sets gaps with type boundaries and large arrays", () => {
    const root = { L1: {} };
    const state = new IterationState(root);

    state.gaps = { not: "array" };
    expect(root.L1.gaps).toEqual([]);

    const empty = [];
    state.gaps = empty;
    expect(root.L1.gaps).toBe(empty);

    const large = Array.from({ length: 10000 }, (_, i) => ({ id: `g${i}` }));
    state.gaps = large;
    expect(root.L1.gaps).toBe(large);
    expect(root.L1.gaps).toHaveLength(10000);
  });

  it("initializes and sets chunks with resource boundary content", () => {
    const root = {};
    const state = new IterationState(root);

    expect(() => state.chunks).not.toThrow();
    expect(root.L2).toEqual({ retrievedChunks: [] });
    expect(state.chunks).toBe(root.L2.retrievedChunks);

    const rootBad = { L2: null };
    const stateBad = new IterationState(rootBad);
    expect(stateBad.chunks).toEqual([]);
    expect(rootBad.L2).toEqual({ retrievedChunks: [] });

    state.chunks = { not: "array" };
    expect(root.L2.retrievedChunks).toEqual([]);

    const largeContent = "x".repeat(200000);
    const chunks = [{ id: "c1", content: largeContent, score: 1 }];
    state.chunks = chunks;
    expect(root.L2.retrievedChunks).toBe(chunks);
    expect(state.chunks[0].content).toBe(largeContent);
  });

  it("handles concurrent updates to gaps and chunks", async () => {
    const root = {};
    const state = new IterationState(root);
    const gaps = [{ id: "g1" }];
    const chunks = [{ id: "c1" }];

    await Promise.all([
      Promise.resolve().then(() => {
        state.gaps = gaps;
      }),
      Promise.resolve().then(() => {
        state.chunks = chunks;
      }),
    ]);

    expect(root.L1.gaps).toBe(gaps);
    expect(root.L2.retrievedChunks).toBe(chunks);
  });

  it("handles rapid successive iteration updates", () => {
    const root = {};
    const state = new IterationState(root);

    for (let i = 0; i < 5; i += 1) {
      state.iteration = i;
    }

    expect(root.iteration).toBe(4);
    expect(state.iteration).toBe(4);
  });
});
