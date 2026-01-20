import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

import { safeJsonSize, buildJsonPatch } from "../../../../../js/agents/core/archive/serialization.js";
import * as valueUtils from "../../../../../js/agents/shared/utils/value-utils.js";

const createDeepObject = (depth, leafValue) => {
  let value = leafValue;
  for (let i = depth - 1; i >= 0; i -= 1) {
    value = { [`level${i}`]: value };
  }
  return value;
};

describe("safeJsonSize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles null/undefined and empty values", () => {
    expect(safeJsonSize(null)).toBe(4);
    expect(safeJsonSize(undefined)).toBe(0);
    expect(safeJsonSize("")).toBe(2);
    expect(safeJsonSize([])).toBe(2);
    expect(safeJsonSize({})).toBe(2);
  });

  it("handles numeric boundaries and whitespace strings", () => {
    expect(safeJsonSize(0)).toBe(1);
    expect(safeJsonSize(-1)).toBe(2);
    expect(safeJsonSize(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER).length);
    expect(safeJsonSize("   ")).toBe(5);
    expect(safeJsonSize("123")).toBe(5);
  });

  it("returns 0 for circular structures", () => {
    const obj = {};
    obj.self = obj;
    expect(safeJsonSize(obj)).toBe(0);
  });

  it("handles long strings and large arrays", () => {
    const longString = "x".repeat(10000);
    expect(safeJsonSize(longString)).toBe(longString.length + 2);

    const largeArray = new Array(10000).fill(0);
    expect(safeJsonSize(largeArray)).toBe(largeArray.length * 2 + 1);
  });

  it("supports concurrent and rapid successive calls", async () => {
    const values = [null, "a", 0, "   "];
    const results = await Promise.all(
      values.map((value) => Promise.resolve().then(() => safeJsonSize(value)))
    );
    expect(results).toEqual([4, 3, 1, 5]);

    let last = null;
    for (let i = 0; i < 1000; i += 1) {
      last = safeJsonSize("z");
    }
    expect(last).toBe(3);
  });
});

describe("buildJsonPatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty ops for identical values and empty inputs", () => {
    expect(buildJsonPatch(null, null)).toEqual([]);
    expect(buildJsonPatch(undefined, undefined)).toEqual([]);
    expect(buildJsonPatch("", "")).toEqual([]);
    expect(buildJsonPatch([], [])).toEqual([]);
    expect(buildJsonPatch({}, {})).toEqual([]);
  });

  it("replaces root when types differ (object vs array)", () => {
    const base = { a: 1 };
    const next = [1, 2];
    expect(buildJsonPatch(base, next)).toEqual([
      { op: "replace", path: "", value: next },
    ]);
  });

  it("builds remove/add/replace operations for object changes", () => {
    const base = { a: 1, b: 2 };
    const next = { a: 2, c: 3 };
    expect(buildJsonPatch(base, next)).toEqual([
      { op: "remove", path: "/b" },
      { op: "add", path: "/c", value: 3 },
      { op: "replace", path: "/a", value: 2 },
    ]);
  });

  it("replaces parent path when maxDepth is exhausted for deep nesting", () => {
    const maxDepth = 8;
    const base = createDeepObject(20, 1);
    const next = createDeepObject(20, 2);
    const segments = Array.from({ length: maxDepth }, (_, i) => `level${i}`);
    let expectedValue = next;
    for (const seg of segments) {
      expectedValue = expectedValue[seg];
    }
    expect(buildJsonPatch(base, next, { maxDepth })).toEqual([
      { op: "replace", path: `/${segments.join("/")}`, value: expectedValue },
    ]);
  });

  it("throws patch_ops_limit when ops exceed maxOps (string input)", () => {
    const base = { a: 1, b: 2 };
    const next = { a: 2, c: 3 };
    expect(() => buildJsonPatch(base, next, { maxOps: "1" })).toThrow("patch_ops_limit");
    expect(valueUtils.toPositiveInt).toHaveBeenCalledWith("1", 5000);
  });

  it("throws unsafe_path_segment for prototype keys", () => {
    const base = Object.create(null);
    Object.defineProperty(base, "__proto__", { value: 1, enumerable: true });
    const next = Object.create(null);
    Object.defineProperty(next, "__proto__", { value: 2, enumerable: true });
    expect(() => buildJsonPatch(base, next)).toThrow("unsafe_path_segment");
  });

  it("supports rapid successive calls without shared state", () => {
    const base = { a: 1 };
    const next = { a: 2 };
    let last = null;
    for (let i = 0; i < 250; i += 1) {
      last = buildJsonPatch(base, next);
    }
    expect(last).toEqual([{ op: "replace", path: "/a", value: 2 }]);
  });
});
