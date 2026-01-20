/**
 * Unit coverage for DeepSearch budget helpers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual(
    "../../../../../../js/agents/shared/index.js",
  );
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    safeInt: vi.fn(actual.safeInt),
    safeNumber: vi.fn(actual.safeNumber),
  };
});

import {
  ensureBudgetState,
  emitBudgetEvents,
} from "../../../../../../js/agents/stages/deepsearch/model/budget.js";
import {
  isPlainObject,
  safeInt,
  safeNumber,
} from "../../../../../../js/agents/shared/index.js";

const DEFAULT_BUDGET_STATE = {
  warnedTokens: false,
  warnedCost: false,
  exceededTokens: false,
  exceededCost: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureBudgetState", () => {
  it("returns null for invalid state types", () => {
    const cases = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const input of cases) {
      expect(ensureBudgetState(input)).toBeNull();
    }

    expect(isPlainObject).not.toHaveBeenCalled();
  });

  it("initializes missing L2 and budgetState while preserving existing data", () => {
    const nested = { level: { value: "keep" } };
    const state = { L2: { nested } };

    const budgetState = ensureBudgetState(state);

    expect(budgetState).toEqual(DEFAULT_BUDGET_STATE);
    expect(state.L2.budgetState).toBe(budgetState);
    expect(state.L2.nested).toBe(nested);
    expect(isPlainObject).toHaveBeenCalled();
  });

  it("returns existing budgetState without overwriting flags", () => {
    const existing = {
      warnedTokens: true,
      warnedCost: false,
      exceededTokens: true,
      exceededCost: false,
    };
    const state = { L2: { budgetState: existing } };

    const budgetState = ensureBudgetState(state);

    expect(budgetState).toBe(existing);
    expect(state.L2.budgetState).toBe(existing);
  });

  it("replaces non-plain L2 or budgetState with defaults", () => {
    const stateWithArray = { L2: [] };
    const budgetStateArray = ensureBudgetState(stateWithArray);

    expect(Array.isArray(stateWithArray.L2)).toBe(false);
    expect(budgetStateArray).toEqual(DEFAULT_BUDGET_STATE);

    const stateWithBadBudget = { L2: { budgetState: [] } };
    const budgetStateBad = ensureBudgetState(stateWithBadBudget);

    expect(Array.isArray(stateWithBadBudget.L2.budgetState)).toBe(false);
    expect(budgetStateBad).toEqual(DEFAULT_BUDGET_STATE);
  });

  it("handles empty array state objects", () => {
    const state = [];

    const budgetState = ensureBudgetState(state);

    expect(budgetState).toEqual(DEFAULT_BUDGET_STATE);
    expect(state.L2.budgetState).toBe(budgetState);
  });

  it("is idempotent across rapid repeated calls", () => {
    const state = {};

    const first = ensureBudgetState(state);
    const second = ensureBudgetState(state);

    expect(second).toBe(first);
  });
});

describe("emitBudgetEvents", () => {
  it("returns empty reasons for invalid state and skips emit", () => {
    const emit = vi.fn();

    const result = emitBudgetEvents({
      emit,
      state: null,
      budget: { maxTokens: 10, warnAt: 0.5 },
      totalTokens: 5,
    });

    expect(result).toEqual({ warningReasons: [], exceededReasons: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(safeInt).not.toHaveBeenCalled();
    expect(safeNumber).not.toHaveBeenCalled();
  });

  it("emits warning events with full payload when thresholds are met", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: 100, maxCostUSD: 10, warnAt: 0.5 },
      totalTokens: 50,
      totalCostUSD: 5,
    });

    expect(result.warningReasons).toEqual(["tokens", "cost"]);
    expect(result.exceededReasons).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe("deepsearch:budgetWarning");
    expect(emit.mock.calls[1][0]).toBe("deepsearch.budget.warning");

    const payload = emit.mock.calls[0][1];
    expect(payload).toEqual({
      reasons: ["tokens", "cost"],
      budget: { maxTokens: 100, maxCostUSD: 10, warnAt: 0.5, action: "warn" },
      total: { tokens: 50, estimatedCostUSD: 5 },
      ratios: { tokens: 0.5, cost: 0.5 },
    });
    expect(emit.mock.calls[1][1]).toEqual(payload);
  });

  it("does not re-emit warnings on rapid consecutive calls", () => {
    const emit = vi.fn();
    const state = {};
    const budget = { maxTokens: 10, maxCostUSD: 10, warnAt: 0.5 };

    const first = emitBudgetEvents({
      emit,
      state,
      budget,
      totalTokens: 5,
      totalCostUSD: 5,
    });
    const second = emitBudgetEvents({
      emit,
      state,
      budget,
      totalTokens: 6,
      totalCostUSD: 6,
    });

    expect(first.warningReasons).toEqual(["tokens", "cost"]);
    expect(second.warningReasons).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("handles simultaneous calls without duplicating warnings", async () => {
    const emit = vi.fn();
    const state = {};
    const budget = { maxTokens: 10, warnAt: 0.5 };

    const results = await Promise.all([
      Promise.resolve().then(() =>
        emitBudgetEvents({ emit, state, budget, totalTokens: 5 }),
      ),
      Promise.resolve().then(() =>
        emitBudgetEvents({ emit, state, budget, totalTokens: 5 }),
      ),
    ]);

    const warningCount = results.reduce(
      (count, res) => count + res.warningReasons.length,
      0,
    );

    expect(warningCount).toBe(1);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("clamps warnAt below 0 to 0 and warns at ratio 0", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: 100, warnAt: -1 },
      totalTokens: 0,
    });

    expect(result.warningReasons).toEqual(["tokens"]);
    expect(result.exceededReasons).toEqual([]);

    const payload = emit.mock.calls[0][1];
    expect(payload.budget.warnAt).toBe(0);
    expect(payload.ratios.tokens).toBe(0);
  });

  it("clamps warnAt above 1 to 1", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: 100, warnAt: 2 },
      totalTokens: 100,
    });

    expect(result.warningReasons).toEqual(["tokens"]);
    expect(result.exceededReasons).toEqual([]);
    expect(emit.mock.calls[0][1].budget.warnAt).toBe(1);
  });

  it("emits exceeded events when limits are surpassed", () => {
    const emit = vi.fn();
    const state = {
      L2: {
        budgetState: {
          warnedTokens: true,
          warnedCost: true,
          exceededTokens: false,
          exceededCost: false,
        },
      },
    };

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: 1, maxCostUSD: 1, warnAt: 0.5 },
      totalTokens: 2,
      totalCostUSD: 3,
    });

    expect(result.warningReasons).toEqual([]);
    expect(result.exceededReasons).toEqual(["tokens", "cost"]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toBe("deepsearch:budgetExceeded");
    expect(emit.mock.calls[1][0]).toBe("deepsearch.budget.exceeded");
    expect(emit.mock.calls[0][1].ratios).toEqual({ tokens: 2, cost: 3 });
  });

  it("treats zero or invalid limits as nullable", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: 0, maxCostUSD: -1, warnAt: 0.5 },
      totalTokens: 1,
      totalCostUSD: 1,
    });

    expect(result.warningReasons).toEqual([]);
    expect(result.exceededReasons).toEqual(["tokens"]);

    const payload = emit.mock.calls[0][1];
    expect(payload.budget.maxTokens).toBe(0);
    expect(payload.budget.maxCostUSD).toBeNull();
    expect(payload.ratios).toEqual({ tokens: null, cost: null });
  });

  it("handles MAX_SAFE_INTEGER totals without exceeding", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: Number.MAX_SAFE_INTEGER, warnAt: 1 },
      totalTokens: Number.MAX_SAFE_INTEGER,
    });

    expect(result.warningReasons).toEqual(["tokens"]);
    expect(result.exceededReasons).toEqual([]);
    expect(emit.mock.calls[0][1].total.tokens).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("handles empty and mismatched input types without emitting", () => {
    const emit = vi.fn();
    const state = {};

    const result = emitBudgetEvents({
      emit,
      state,
      budget: { maxTokens: "", maxCostUSD: [], warnAt: "   ", action: "" },
      totalTokens: {},
      totalCostUSD: [],
    });

    expect(result.warningReasons).toEqual([]);
    expect(result.exceededReasons).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores non-function emit while still updating state", () => {
    const state = {};

    const result = emitBudgetEvents({
      emit: "not-a-function",
      state,
      budget: { maxTokens: 10, warnAt: 0.5 },
      totalTokens: 5,
    });

    expect(result.warningReasons).toEqual(["tokens"]);
    expect(state.L2.budgetState.warnedTokens).toBe(true);
  });

  it("handles long strings and deep nested state data", () => {
    const emit = vi.fn();
    const longAction = "x".repeat(10000);
    const state = { L2: { nested: { a: { b: { c: {} } } } } };

    const result = emitBudgetEvents({
      emit,
      state,
      budget: {
        maxTokens: "100",
        maxCostUSD: " 2.5 ",
        warnAt: "   ",
        action: longAction,
      },
      totalTokens: "80",
      totalCostUSD: "2",
    });

    expect(result.warningReasons).toEqual(["tokens", "cost"]);
    expect(result.exceededReasons).toEqual([]);

    const payload = emit.mock.calls[0][1];
    expect(payload.budget.action).toBe(longAction);
    expect(payload.budget.warnAt).toBe(0.8);
    expect(state.L2.nested.a.b.c).toEqual({});
  });
});
