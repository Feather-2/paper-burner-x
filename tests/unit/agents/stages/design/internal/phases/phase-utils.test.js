import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DESIGN_PHASE_DEFAULTS,
  runWithPhaseSpan,
} from "../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("DESIGN_PHASE_DEFAULTS", () => {
  it("exposes expected numeric defaults", () => {
    expect(DESIGN_PHASE_DEFAULTS).toEqual({
      costPerHDSlot: 0.04,
      costPerBasicSlot: 0.003,
      refineRecommendedSteps: 5,
      refineHardLimit: 15,
    });
  });

  it("uses only finite numeric values", () => {
    Object.values(DESIGN_PHASE_DEFAULTS).forEach((value) => {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    });
  });
});

describe("runWithPhaseSpan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "withSpan not a function", value: { withSpan: 123 } },
  ])("calls fn directly when traceContext is $label", async ({ value }) => {
    const fn = vi.fn(async () => "done");

    const result = await runWithPhaseSpan(value, "phase", { a: 1 }, fn);

    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes through empty and whitespace names", async () => {
    const span = { setAttributes: vi.fn() };
    const withSpan = vi.fn(async (spanName, callback) => callback(span));
    const fn = vi.fn(async () => "ok");

    await runWithPhaseSpan({ withSpan }, "", {}, fn);
    await runWithPhaseSpan({ withSpan }, "   ", {}, fn);

    expect(withSpan).toHaveBeenNthCalledWith(1, "", expect.any(Function));
    expect(withSpan).toHaveBeenNthCalledWith(2, "   ", expect.any(Function));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invokes withSpan, sets attributes, and returns fn result", async () => {
    const { randomUUID } = await import("node:crypto");

    const longString = "x".repeat(10000);
    const hugeFile = new Uint8Array(1024 * 1024);
    const deepNested = {
      level1: { level2: { level3: { level4: { level5: { level6: "deep" } } } } },
    };
    const attributes = {
      nullValue: null,
      undefinedValue: undefined,
      emptyString: "",
      emptyArray: [],
      emptyObject: {},
      zero: 0,
      negative: -1,
      maxSafe: Number.MAX_SAFE_INTEGER,
      whitespace: "   ",
      stringNumber: "42",
      objectAsArray: { 0: "zero", 1: "one", length: 2 },
      longString,
      hugeFile,
      deepNested,
    };

    const span = { setAttributes: vi.fn() };
    const withSpan = vi.fn(async (spanName, callback) => callback(span));
    const traceContext = { withSpan };
    const fn = vi.fn(async () => "result");

    const name = `${randomUUID()}-${longString}`;
    const result = await runWithPhaseSpan(traceContext, name, attributes, fn);

    expect(result).toBe("result");
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(withSpan).toHaveBeenCalledWith(name, expect.any(Function));
    expect(span.setAttributes).toHaveBeenCalledTimes(1);
    expect(span.setAttributes.mock.calls[0][0]).toBe(attributes);
    expect(span.setAttributes.mock.calls[0][0].hugeFile).toBe(hugeFile);
    expect(span.setAttributes.mock.calls[0][0].deepNested).toBe(deepNested);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "null span", span: null },
    { label: "missing setAttributes", span: {} },
    { label: "non-function setAttributes", span: { setAttributes: "nope" } },
  ])("skips setAttributes when span is $label", async ({ span }) => {
    const withSpan = vi.fn(async (spanName, callback) => callback(span));
    const fn = vi.fn(async () => "ok");

    const result = await runWithPhaseSpan({ withSpan }, "phase", {}, fn);

    expect(result).toBe("ok");
    expect(withSpan).toHaveBeenCalledWith("phase", expect.any(Function));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from fn without traceContext", async () => {
    const error = new Error("boom");
    const fn = vi.fn(() => {
      throw error;
    });

    await expect(runWithPhaseSpan(null, "phase", {}, fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from fn when wrapped in withSpan", async () => {
    const error = new Error("boom");
    const span = { setAttributes: vi.fn() };
    const withSpan = vi.fn(async (spanName, callback) => callback(span));
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(runWithPhaseSpan({ withSpan }, "phase", { a: 1 }, fn)).rejects.toThrow(
      "boom",
    );
    expect(withSpan).toHaveBeenCalledTimes(1);
    expect(span.setAttributes).toHaveBeenCalledWith({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("handles concurrent calls with shared traceContext", async () => {
    const spans = [];
    const withSpan = vi.fn(async (spanName, callback) => {
      const span = { setAttributes: vi.fn() };
      spans.push(span);
      return callback(span);
    });
    const traceContext = { withSpan };
    const deferreds = [];
    const fn = vi.fn(() => {
      const deferred = createDeferred();
      deferreds.push(deferred);
      return deferred.promise;
    });

    const promises = [
      runWithPhaseSpan(traceContext, "a", { index: 0 }, fn),
      runWithPhaseSpan(traceContext, "b", { index: 1 }, fn),
      runWithPhaseSpan(traceContext, "c", { index: 2 }, fn),
    ];

    expect(withSpan).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(deferreds).toHaveLength(3);

    deferreds.forEach((deferred, index) => deferred.resolve(`done-${index}`));

    const results = await Promise.all(promises);

    expect(results).toEqual(["done-0", "done-1", "done-2"]);
    expect(spans).toHaveLength(3);
    expect(spans[0].setAttributes).toHaveBeenCalledWith({ index: 0 });
    expect(spans[1].setAttributes).toHaveBeenCalledWith({ index: 1 });
    expect(spans[2].setAttributes).toHaveBeenCalledWith({ index: 2 });
  });

  it("handles rapid consecutive calls without traceContext", async () => {
    const fn = vi.fn((value) => Promise.resolve(value));
    const calls = [];

    for (let i = 0; i < 5; i += 1) {
      calls.push(runWithPhaseSpan(undefined, "phase", { index: i }, () => fn(i)));
    }

    const results = await Promise.all(calls);

    expect(results).toEqual([0, 1, 2, 3, 4]);
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
