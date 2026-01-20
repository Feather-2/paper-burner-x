import { describe, it, expect, vi, beforeEach } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: fsMocks.readFileSync,
}));

import { readFileSync } from "node:fs";

import {
  isPlainObject,
  toNonEmptyString,
  toNumber,
  toBoolean,
  normalizeKey,
  safeNumber,
  safeInt,
  toNonNegativeInt,
  toPositiveInt,
  normalizeRenderType,
} from "../../../../../js/agents/shared/utils/value-utils.js";

beforeEach(() => {
  fsMocks.readFileSync.mockReset();
});

describe("isPlainObject", () => {
  it("returns false for nullish, primitives, and arrays", () => {
    const values = [null, undefined, "", 0, -1, false, true, [], () => {}];
    for (const value of values) {
      expect(isPlainObject(value)).toBe(false);
    }
  });

  it("accepts plain objects with Object.prototype or null prototype", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it("rejects built-ins and custom prototypes", () => {
    class Example {}
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(new Set())).toBe(false);
    expect(isPlainObject(/re/)).toBe(false);
    expect(isPlainObject(new Error("x"))).toBe(false);
    expect(isPlainObject(new Example())).toBe(false);
    expect(isPlainObject(Object.create({ a: 1 }))).toBe(false);
    expect(isPlainObject(Object.create(Object.create(null)))).toBe(false);
  });

  it("handles array-like objects and deep nesting", () => {
    const arrayLike = { 0: "a", length: 1 };
    expect(isPlainObject(arrayLike)).toBe(true);

    const deep = {};
    let node = deep;
    for (let i = 0; i < 50; i += 1) {
      node.next = {};
      node = node.next;
    }
    expect(isPlainObject(deep)).toBe(true);
  });
});

describe("toNonEmptyString", () => {
  it("returns undefined for nullish, empty, whitespace, and empty arrays", () => {
    expect(toNonEmptyString(undefined)).toBeUndefined();
    expect(toNonEmptyString(null)).toBeUndefined();
    expect(toNonEmptyString("")).toBeUndefined();
    expect(toNonEmptyString("   \t\n  ")).toBeUndefined();
    expect(toNonEmptyString([])).toBeUndefined();
  });

  it("converts values via String() and trims", () => {
    expect(toNonEmptyString("  hello  ")).toBe("hello");
    expect(toNonEmptyString(0)).toBe("0");
    expect(toNonEmptyString(-1)).toBe("-1");
    expect(toNonEmptyString(false)).toBe("false");
    expect(toNonEmptyString({ toString: () => "  ok  " })).toBe("ok");
    expect(toNonEmptyString({})).toBe("[object Object]");
  });

  it("handles large content inputs from external sources", () => {
    const largeContent = "x".repeat(100000);
    fsMocks.readFileSync.mockReturnValue(`  ${largeContent}  `);

    const content = readFileSync("/virtual/large.txt", "utf8");
    expect(fsMocks.readFileSync).toHaveBeenCalledWith("/virtual/large.txt", "utf8");
    expect(toNonEmptyString(content)).toBe(largeContent);
  });
});

describe("toNumber", () => {
  it("converts finite numbers and numeric strings", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber(-1)).toBe(-1);
    expect(toNumber(1.5)).toBe(1.5);
    expect(toNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(toNumber("42")).toBe(42);
    expect(toNumber(" 3.5 ")).toBe(3.5);
    expect(toNumber("1e2")).toBe(100);
    expect(toNumber("   ")).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber([])).toBe(0);
  });

  it("returns null for invalid, non-finite, and non-numeric objects", () => {
    expect(toNumber(NaN)).toBe(null);
    expect(toNumber(Infinity)).toBe(null);
    expect(toNumber(-Infinity)).toBe(null);
    expect(toNumber(undefined)).toBe(null);
    expect(toNumber("nope")).toBe(null);
    expect(toNumber("1e309")).toBe(null);
    expect(toNumber({})).toBe(null);
    expect(toNumber({ 0: "1", length: 1 })).toBe(null);
    expect(toNumber(() => 1)).toBe(null);
  });
});

describe("toBoolean", () => {
  it("returns booleans as-is and handles numbers", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(-1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(toBoolean(NaN)).toBe(true);
  });

  it("parses known truthy/falsey strings with flexible casing", () => {
    const truthy = ["true", "1", "yes", "y", "on", " TRUE ", "YeS"];
    for (const value of truthy) {
      expect(toBoolean(value)).toBe(true);
    }

    const falsey = ["false", "0", "no", "n", "off", "  OFF  "];
    for (const value of falsey) {
      expect(toBoolean(value)).toBe(false);
    }

    expect(toBoolean("maybe")).toBe(false);
    expect(toBoolean("   ")).toBe(false);
  });

  it("returns false for nullish and non-string objects", () => {
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(undefined)).toBe(false);
    expect(toBoolean({})).toBe(false);
    expect(toBoolean([])).toBe(false);
    expect(toBoolean(() => true)).toBe(false);
  });

  it("handles rapid consecutive calls without shared state", () => {
    let trueCount = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (toBoolean(i % 2 === 0 ? "true" : "false")) {
        trueCount += 1;
      }
    }
    expect(trueCount).toBe(500);
  });
});

describe("normalizeKey", () => {
  it("returns empty string for nullish, empty, whitespace, and empty arrays", () => {
    expect(normalizeKey(null)).toBe("");
    expect(normalizeKey(undefined)).toBe("");
    expect(normalizeKey("")).toBe("");
    expect(normalizeKey("   ")).toBe("");
    expect(normalizeKey([])).toBe("");
  });

  it("normalizes mixed input to lowercase alphanumeric keys", () => {
    expect(normalizeKey("Hello, World!")).toBe("hello world");
    expect(normalizeKey("A1-B2")).toBe("a1 b2");
    expect(normalizeKey(123)).toBe("123");
    expect(normalizeKey({})).toBe("object object");
    expect(normalizeKey("foo_bar")).toBe("foo bar");
  });

  it("handles long strings without retaining punctuation", () => {
    const longValue = "A-".repeat(50000);
    const normalized = normalizeKey(longValue);
    expect(normalized.startsWith("a")).toBe(true);
    expect(normalized.endsWith("a")).toBe(true);
    expect(normalized.includes("-")).toBe(false);
    expect(normalized.startsWith(" ")).toBe(false);
    expect(normalized.endsWith(" ")).toBe(false);
  });
});

describe("safeNumber", () => {
  it("accepts finite numbers and numeric strings", () => {
    expect(safeNumber(0)).toBe(0);
    expect(safeNumber(-1)).toBe(-1);
    expect(safeNumber(1.25)).toBe(1.25);
    expect(safeNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeNumber("42")).toBe(42);
    expect(safeNumber(" 3.5 ")).toBe(3.5);
    expect(safeNumber("1e2")).toBe(100);
    expect(safeNumber("0007")).toBe(7);
  });

  it("rejects invalid, empty, or non-number inputs", () => {
    expect(safeNumber(NaN)).toBe(null);
    expect(safeNumber(Infinity)).toBe(null);
    expect(safeNumber(-Infinity)).toBe(null);
    expect(safeNumber("")).toBe(null);
    expect(safeNumber("   ")).toBe(null);
    expect(safeNumber("nope")).toBe(null);
    expect(safeNumber("1e309")).toBe(null);
    expect(safeNumber(true)).toBe(null);
    expect(safeNumber(null)).toBe(null);
    expect(safeNumber(undefined)).toBe(null);
    expect(safeNumber({})).toBe(null);
    expect(safeNumber([])).toBe(null);
    expect(safeNumber("10px")).toBe(null);
  });
});

describe("safeInt", () => {
  it("floors finite numeric input and numeric strings", () => {
    expect(safeInt(2.9)).toBe(2);
    expect(safeInt(-1.2)).toBe(-2);
    expect(safeInt(-0.1)).toBe(-1);
    expect(safeInt(0)).toBe(0);
    expect(safeInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeInt(" 3.9 ")).toBe(3);
    expect(safeInt(" -2.1 ")).toBe(-3);
  });

  it("returns null for invalid inputs", () => {
    expect(safeInt(NaN)).toBe(null);
    expect(safeInt(Infinity)).toBe(null);
    expect(safeInt("")).toBe(null);
    expect(safeInt("abc")).toBe(null);
    expect(safeInt(null)).toBe(null);
    expect(safeInt(undefined)).toBe(null);
    expect(safeInt(true)).toBe(null);
    expect(safeInt("10px")).toBe(null);
    expect(safeInt({})).toBe(null);
  });
});

describe("toNonNegativeInt", () => {
  it("returns non-negative ints from numeric input", () => {
    expect(toNonNegativeInt(0)).toBe(0);
    expect(toNonNegativeInt(5)).toBe(5);
    expect(toNonNegativeInt("7")).toBe(7);
    expect(toNonNegativeInt(" 3.8 ")).toBe(3);
    expect(toNonNegativeInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("falls back for negative or invalid values", () => {
    const fallback = 4;
    expect(toNonNegativeInt(-1, fallback)).toBe(fallback);
    expect(toNonNegativeInt("-2", fallback)).toBe(fallback);
    expect(toNonNegativeInt(null, fallback)).toBe(fallback);
    expect(toNonNegativeInt(undefined, fallback)).toBe(fallback);
    expect(toNonNegativeInt("", fallback)).toBe(fallback);
    expect(toNonNegativeInt("   ", fallback)).toBe(fallback);
    expect(toNonNegativeInt({}, fallback)).toBe(fallback);
    expect(toNonNegativeInt([], fallback)).toBe(fallback);
    expect(toNonNegativeInt({ 0: "1", length: 1 }, fallback)).toBe(fallback);
  });

  it("supports parseInt-style strings for legacy inputs", () => {
    expect(toNonNegativeInt("10px")).toBe(10);
    expect(toNonNegativeInt("42 bottles")).toBe(42);
    expect(toNonNegativeInt(" -3px ", 2)).toBe(2);
  });

  it("handles concurrent calls with mixed inputs", async () => {
    const fallback = 9;
    const inputs = [0, "5", "-1", "10px", null, " 3.2 ", "nope"];
    const results = await Promise.all(
      inputs.map((value) => Promise.resolve(toNonNegativeInt(value, fallback)))
    );
    expect(results).toEqual([0, 5, fallback, 10, fallback, 3, fallback]);
  });
});

describe("toPositiveInt", () => {
  it("returns positive ints and falls back for zero/negative", () => {
    expect(toPositiveInt(1)).toBe(1);
    expect(toPositiveInt(5)).toBe(5);
    expect(toPositiveInt(0)).toBe(1);
    expect(toPositiveInt(-1)).toBe(1);
    expect(toPositiveInt("2")).toBe(2);
    expect(toPositiveInt("0")).toBe(1);
    expect(toPositiveInt("10px")).toBe(10);
    expect(toPositiveInt(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("respects custom fallback", () => {
    expect(toPositiveInt(-5, 7)).toBe(7);
    expect(toPositiveInt("invalid", 4)).toBe(4);
  });

  it("handles rapid consecutive calls without shared state", () => {
    let sum = 0;
    for (let i = 0; i < 1000; i += 1) {
      sum += toPositiveInt(i % 2 === 0 ? 0 : i, 2);
    }
    expect(sum).toBe(251000);
  });
});

describe("normalizeRenderType", () => {
  it("normalizes ai-image variants", () => {
    expect(normalizeRenderType("ai-image")).toBe("ai-image");
    expect(normalizeRenderType("ai_image")).toBe("ai-image");
    expect(normalizeRenderType("image")).toBe("ai-image");
    expect(normalizeRenderType("IMAGE")).toBe("ai-image");
    expect(normalizeRenderType("  AI-IMAGE  ")).toBe("ai-image");
  });

  it("normalizes svg variants", () => {
    expect(normalizeRenderType("svg")).toBe("svg");
    expect(normalizeRenderType("SVG")).toBe("svg");
    expect(normalizeRenderType("  svg  ")).toBe("svg");
  });

  it("normalizes asset variants", () => {
    expect(normalizeRenderType("asset")).toBe("asset");
    expect(normalizeRenderType("doc-asset")).toBe("asset");
    expect(normalizeRenderType("document-asset")).toBe("asset");
    expect(normalizeRenderType("ASSET")).toBe("asset");
  });

  it("defaults to ai-image for unknown or non-string inputs", () => {
    expect(normalizeRenderType("")).toBe("ai-image");
    expect(normalizeRenderType(null)).toBe("ai-image");
    expect(normalizeRenderType(undefined)).toBe("ai-image");
    expect(normalizeRenderType("unknown")).toBe("ai-image");
    expect(normalizeRenderType(123)).toBe("ai-image");
    expect(normalizeRenderType({})).toBe("ai-image");
    expect(normalizeRenderType([])).toBe("ai-image");
  });
});
