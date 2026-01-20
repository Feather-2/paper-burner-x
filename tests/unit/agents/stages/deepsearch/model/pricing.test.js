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
  estimateCostUSDDelta,
  resolveModelPricing,
  __test,
} from "../../../../../../js/agents/stages/deepsearch/model/pricing.js";
import {
  isPlainObject,
  safeInt,
  safeNumber,
} from "../../../../../../js/agents/shared/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveModelPricing", () => {
  it("returns null for invalid inputs and empty tables", () => {
    expect(resolveModelPricing("model", null)).toBeNull();
    expect(resolveModelPricing("model", undefined)).toBeNull();
    expect(resolveModelPricing("model", [])).toBeNull();
    expect(resolveModelPricing("model", {})).toBeNull();
    expect(resolveModelPricing("", { model: { input: 1 } })).toBeNull();
    expect(resolveModelPricing(null, { model: { input: 1 } })).toBeNull();
    expect(resolveModelPricing({ id: "x" }, { model: { input: 1 } })).toBeNull();
    expect(resolveModelPricing("   ", { model: { input: 1 } })).toBeNull();
  });

  it("resolves exact match and prefers the longest prefix", () => {
    const prices = {
      "gpt-4": { input: 1 },
      "gpt-4o": { input: 2 },
      "gpt": { input: 0.5 },
      "": { input: 9 },
      "*": { input: 0.1 },
      "gpt-4o-mini": [],
    };

    expect(resolveModelPricing("gpt-4", prices)).toEqual({
      modelKey: "gpt-4",
      entry: prices["gpt-4"],
    });
    expect(resolveModelPricing("gpt-4o-mini", prices)).toEqual({
      modelKey: "gpt-4o",
      entry: prices["gpt-4o"],
    });
    expect(resolveModelPricing("gpt-3.5-turbo", prices)).toEqual({
      modelKey: "gpt",
      entry: prices.gpt,
    });
  });

  it("falls back to wildcard pricing when no match exists", () => {
    const prices = {
      "*": { input: 0.2 },
      alpha: { input: 1 },
    };

    expect(resolveModelPricing("beta", prices)).toEqual({
      modelKey: "*",
      entry: prices["*"],
    });
    expect(resolveModelPricing("   ", prices)).toEqual({
      modelKey: "*",
      entry: prices["*"],
    });
  });

  it("supports deep nested entries and large payloads", () => {
    const longId = `model-${"x".repeat(10000)}`;
    const entry = {
      input: 1,
      meta: {
        level1: { level2: { level3: { ok: true } } },
        file: "y".repeat(200000),
      },
    };
    const prices = { "model-": entry };

    const result = resolveModelPricing(longId, prices);
    expect(result).toEqual({ modelKey: "model-", entry });
    expect(result.entry).toBe(entry);
  });

  it("is safe for concurrent lookups", async () => {
    const prices = { a: { input: 1 }, b: { input: 2 }, "*": { input: 0.1 } };

    const [ra, rb, rc] = await Promise.all([
      Promise.resolve().then(() => resolveModelPricing("a", prices)),
      Promise.resolve().then(() => resolveModelPricing("b-extended", prices)),
      Promise.resolve().then(() => resolveModelPricing("c", prices)),
    ]);

    expect(ra).toEqual({ modelKey: "a", entry: prices.a });
    expect(rb).toEqual({ modelKey: "b", entry: prices.b });
    expect(rc).toEqual({ modelKey: "*", entry: prices["*"] });
  });
});

describe("estimateCostUSDDelta", () => {
  it("calculates cost using per-1K rates and numeric strings", () => {
    const prices = {
      model: { inputPer1K: "0.01", outputUSDPer1K: 0.02 },
    };
    const usage = { input: "1500", output: "500" };

    const cost = estimateCostUSDDelta({ model: "model", usage, prices });

    expect(cost).toBeCloseTo(0.025, 10);
    expect(safeInt).toHaveBeenCalled();
    expect(safeNumber).toHaveBeenCalled();
  });

  it("returns 0 when pricing cannot be resolved or params are empty", () => {
    expect(estimateCostUSDDelta()).toBe(0);
    expect(
      estimateCostUSDDelta({ model: null, usage: null, prices: null }),
    ).toBe(0);
    expect(estimateCostUSDDelta({ model: "x", prices: {}, usage: {} })).toBe(
      0,
    );
    expect(
      estimateCostUSDDelta({
        model: "x",
        prices: [],
        usage: { input: 100 },
      }),
    ).toBe(0);
    expect(
      estimateCostUSDDelta({
        model: "",
        prices: { "*": { input: 1 } },
        usage: { input: 1000 },
      }),
    ).toBe(0);
  });

  it("clamps negative tokens and rates to zero", () => {
    const prices = { model: { input: -1, output: 0.2 } };
    const usage = { input: -100, output: 1000 };

    expect(
      estimateCostUSDDelta({ model: "model", usage, prices }),
    ).toBeCloseTo(0.2, 10);
  });

  it("treats invalid numbers and object/array usage as zero", () => {
    const prices = { model: { input: "   ", outputPer1K: "bad" } };
    const usage = { input: {}, output: [] };

    expect(estimateCostUSDDelta({ model: "model", usage, prices })).toBe(0);
    expect(estimateCostUSDDelta({ model: "model", usage: [], prices })).toBe(0);
  });

  it("handles boundary numeric values", () => {
    const prices = { model: { input: 0, output: 0.5 } };
    const usage = { input: Number.MAX_SAFE_INTEGER, output: 0 };

    expect(estimateCostUSDDelta({ model: "model", usage, prices })).toBe(0);
  });

  it("returns 0 when cost is non-finite", () => {
    const prices = { model: { input: Number.MAX_VALUE } };
    const usage = { input: Number.MAX_VALUE };

    expect(estimateCostUSDDelta({ model: "model", usage, prices })).toBe(0);
  });

  it("uses wildcard pricing for whitespace model ids", () => {
    const prices = { "*": { input: 1 } };
    const usage = { input: 1000, output: 0 };

    expect(estimateCostUSDDelta({ model: "   ", usage, prices })).toBe(1);
  });

  it("supports rapid consecutive calls", () => {
    const prices = { model: { input: 1 } };
    const usage = { input: 1000 };

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(estimateCostUSDDelta({ model: "model", usage, prices }));
    }

    expect(results).toEqual([1, 1, 1, 1, 1]);
  });

  it("calculates independently for concurrent calls", async () => {
    const prices = { model: { input: 1, output: 2 } };

    const results = await Promise.all([
      Promise.resolve().then(() =>
        estimateCostUSDDelta({
          model: "model",
          usage: { input: 1000, output: 1000 },
          prices,
        }),
      ),
      Promise.resolve().then(() =>
        estimateCostUSDDelta({
          model: "model",
          usage: { input: 0, output: 2000 },
          prices,
        }),
      ),
      Promise.resolve().then(() =>
        estimateCostUSDDelta({
          model: "unknown",
          usage: { input: 1000 },
          prices,
        }),
      ),
    ]);

    expect(results).toEqual([3, 4, 0]);
  });
});

describe("__test", () => {
  it("exposes shared helpers", () => {
    expect(__test.isPlainObject).toBe(isPlainObject);
    expect(__test.safeInt).toBe(safeInt);
    expect(__test.safeNumber).toBe(safeNumber);
  });
});
