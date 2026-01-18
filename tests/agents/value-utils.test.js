
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  isCjkChar,
  estimateTokenCount,
  estimateTokens,
  estimateTokenCountFast,
  deepClone,
  sanitizeForJson,
  TOKEN_ESTIMATE_CONFIG,
} from "../../js/agents/shared/utils/value-utils.js";

describe("shared/utils/value-utils", () => {
  describe("isPlainObject", () => {
    it("returns true for object literal", () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
    });

    it("returns true for Object.create(null)", () => {
      expect(isPlainObject(Object.create(null))).toBe(true);
    });

    it("returns false for null", () => {
      expect(isPlainObject(null)).toBe(false);
    });

    it("returns false for arrays", () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject([1, 2, 3])).toBe(false);
    });

    it("returns false for class instances", () => {
      class Foo {}
      expect(isPlainObject(new Foo())).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isPlainObject("string")).toBe(false);
      expect(isPlainObject(123)).toBe(false);
      expect(isPlainObject(true)).toBe(false);
    });

    it("returns false for Date", () => {
      expect(isPlainObject(new Date())).toBe(false);
    });
  });

  describe("toNonEmptyString", () => {
    it("returns trimmed string", () => {
      expect(toNonEmptyString("  hello  ")).toBe("hello");
    });

    it("returns undefined for empty string", () => {
      expect(toNonEmptyString("")).toBe(undefined);
      expect(toNonEmptyString("   ")).toBe(undefined);
    });

    it("returns undefined for null", () => {
      expect(toNonEmptyString(null)).toBe(undefined);
    });

    it("returns undefined for undefined", () => {
      expect(toNonEmptyString(undefined)).toBe(undefined);
    });

    it("converts numbers to string", () => {
      expect(toNonEmptyString(42)).toBe("42");
    });
  });

  describe("toNumber", () => {
    it("returns number for valid input", () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber("3.14")).toBe(3.14);
    });

    it("returns null for NaN", () => {
      expect(toNumber(NaN)).toBe(null);
    });

    it("returns null for Infinity", () => {
      expect(toNumber(Infinity)).toBe(null);
    });

    it("returns null for non-numeric string", () => {
      expect(toNumber("hello")).toBe(null);
    });
  });

  describe("toBoolean", () => {
    it("returns boolean as-is", () => {
      expect(toBoolean(true)).toBe(true);
      expect(toBoolean(false)).toBe(false);
    });

    it("converts numbers", () => {
      expect(toBoolean(1)).toBe(true);
      expect(toBoolean(0)).toBe(false);
      expect(toBoolean(-1)).toBe(true);
    });

    it("converts truthy strings", () => {
      expect(toBoolean("true")).toBe(true);
      expect(toBoolean("TRUE")).toBe(true);
      expect(toBoolean("yes")).toBe(true);
      expect(toBoolean("1")).toBe(true);
      expect(toBoolean("on")).toBe(true);
    });

    it("converts falsy strings", () => {
      expect(toBoolean("false")).toBe(false);
      expect(toBoolean("no")).toBe(false);
      expect(toBoolean("0")).toBe(false);
      expect(toBoolean("off")).toBe(false);
    });

    it("returns false for unknown values", () => {
      expect(toBoolean("maybe")).toBe(false);
      expect(toBoolean(null)).toBe(false);
    });
  });

  describe("normalizeKey", () => {
    it("normalizes to lowercase alphanumeric", () => {
      expect(normalizeKey("Hello-World_123")).toBe("hello world 123");
    });

    it("returns empty for null", () => {
      expect(normalizeKey(null)).toBe("");
    });

    it("returns empty for undefined", () => {
      expect(normalizeKey(undefined)).toBe("");
    });
  });

  describe("safeNumber", () => {
    it("returns number for valid number", () => {
      expect(safeNumber(42)).toBe(42);
      expect(safeNumber(3.14)).toBe(3.14);
    });

    it("returns null for NaN", () => {
      expect(safeNumber(NaN)).toBe(null);
    });

    it("returns null for Infinity", () => {
      expect(safeNumber(Infinity)).toBe(null);
    });

    it("parses numeric strings", () => {
      expect(safeNumber("42")).toBe(42);
      expect(safeNumber("  3.14  ")).toBe(3.14);
    });

    it("returns null for empty string", () => {
      expect(safeNumber("")).toBe(null);
      expect(safeNumber("   ")).toBe(null);
    });

    it("returns null for non-string non-number", () => {
      expect(safeNumber({})).toBe(null);
      expect(safeNumber([])).toBe(null);
    });
  });

  describe("safeInt", () => {
    it("floors valid numbers", () => {
      expect(safeInt(3.7)).toBe(3);
      expect(safeInt(3.2)).toBe(3);
    });

    it("returns null for invalid", () => {
      expect(safeInt("hello")).toBe(null);
      expect(safeInt(NaN)).toBe(null);
    });
  });

  describe("toNonNegativeInt", () => {
    it("returns non-negative int", () => {
      expect(toNonNegativeInt(5)).toBe(5);
      expect(toNonNegativeInt(0)).toBe(0);
    });

    it("returns fallback for negative", () => {
      expect(toNonNegativeInt(-5)).toBe(0);
      expect(toNonNegativeInt(-5, 10)).toBe(10);
    });

    it("parses parseInt-style strings", () => {
      expect(toNonNegativeInt("10px")).toBe(10);
    });

    it("returns fallback for invalid", () => {
      expect(toNonNegativeInt("hello", 42)).toBe(42);
    });
  });

  describe("toPositiveInt", () => {
    it("returns positive int", () => {
      expect(toPositiveInt(5)).toBe(5);
    });

    it("returns fallback for zero", () => {
      expect(toPositiveInt(0)).toBe(1);
      expect(toPositiveInt(0, 10)).toBe(10);
    });

    it("returns fallback for negative", () => {
      expect(toPositiveInt(-5, 3)).toBe(3);
    });
  });

  describe("normalizeRenderType", () => {
    it("normalizes ai-image variants", () => {
      expect(normalizeRenderType("ai-image")).toBe("ai-image");
      expect(normalizeRenderType("ai_image")).toBe("ai-image");
      expect(normalizeRenderType("image")).toBe("ai-image");
    });

    it("normalizes svg", () => {
      expect(normalizeRenderType("svg")).toBe("svg");
      expect(normalizeRenderType("SVG")).toBe("svg");
    });

    it("normalizes asset variants", () => {
      expect(normalizeRenderType("asset")).toBe("asset");
      expect(normalizeRenderType("doc-asset")).toBe("asset");
      expect(normalizeRenderType("document-asset")).toBe("asset");
    });

    it("defaults to ai-image", () => {
      expect(normalizeRenderType("unknown")).toBe("ai-image");
      expect(normalizeRenderType(null)).toBe("ai-image");
    });
  });

  describe("isCjkChar", () => {
    it("detects Chinese characters", () => {
      expect(isCjkChar("中".charCodeAt(0))).toBe(true);
      expect(isCjkChar("国".charCodeAt(0))).toBe(true);
    });

    it("detects Japanese hiragana", () => {
      expect(isCjkChar("あ".charCodeAt(0))).toBe(true);
    });

    it("detects Japanese katakana", () => {
      expect(isCjkChar("ア".charCodeAt(0))).toBe(true);
    });

    it("detects Korean hangul", () => {
      expect(isCjkChar("한".charCodeAt(0))).toBe(true);
    });

    it("returns false for ASCII", () => {
      expect(isCjkChar("a".charCodeAt(0))).toBe(false);
      expect(isCjkChar("1".charCodeAt(0))).toBe(false);
    });
  });

  describe("estimateTokenCount", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });

    it("returns 0 for null", () => {
      expect(estimateTokenCount(null)).toBe(0);
    });

    it("estimates English text", () => {
      const count = estimateTokenCount("Hello world this is a test");
      expect(count).toBeGreaterThan(0);
    });

    it("estimates Chinese text", () => {
      const count = estimateTokenCount("你好世界");
      expect(count).toBeGreaterThan(0);
    });

    it("handles mixed text", () => {
      const count = estimateTokenCount("Hello 世界");
      expect(count).toBeGreaterThan(0);
    });

    it("accepts custom config", () => {
      const count = estimateTokenCount("test", { latinCharsPerToken: 2 });
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("estimateTokens", () => {
    it("is alias for estimateTokenCount", () => {
      const a = estimateTokenCount("test");
      const b = estimateTokens("test");
      expect(a).toBe(b);
    });
  });

  describe("estimateTokenCountFast", () => {
    it("returns 0 for empty", () => {
      expect(estimateTokenCountFast("")).toBe(0);
    });

    it("estimates based on length/2", () => {
      expect(estimateTokenCountFast("abcd")).toBe(2);
    });
  });

  describe("deepClone", () => {
    it("clones primitives", () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone("hello")).toBe("hello");
      expect(deepClone(null)).toBe(null);
    });

    it("clones objects", () => {
      const obj = { a: 1, b: { c: 2 } };
      const clone = deepClone(obj);
      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.b).not.toBe(obj.b);
    });

    it("clones arrays", () => {
      const arr = [1, [2, 3], { x: 4 }];
      const clone = deepClone(arr);
      expect(clone).toEqual(arr);
      expect(clone).not.toBe(arr);
    });

    it("clones Date", () => {
      const date = new Date("2025-01-01");
      const clone = deepClone(date);
      expect(clone.getTime()).toBe(date.getTime());
      expect(clone).not.toBe(date);
    });

    it("clones RegExp", () => {
      const regex = /test/gi;
      const clone = deepClone(regex);
      expect(clone.source).toBe(regex.source);
      expect(clone.flags).toBe(regex.flags);
    });

    it("clones Map", () => {
      const map = new Map([["a", 1], ["b", 2]]);
      const clone = deepClone(map);
      expect(clone.get("a")).toBe(1);
      expect(clone).not.toBe(map);
    });

    it("clones Set", () => {
      const set = new Set([1, 2, 3]);
      const clone = deepClone(set);
      expect(clone.has(1)).toBe(true);
      expect(clone).not.toBe(set);
    });

    it("handles circular references", () => {
      const obj = { a: 1 };
      obj.self = obj;
      const clone = deepClone(obj);
      expect(clone.a).toBe(1);
      expect(clone.self).toBe(clone);
    });
  });

  describe("sanitizeForJson", () => {
    it("passes through primitives", () => {
      expect(sanitizeForJson("hello")).toBe("hello");
      expect(sanitizeForJson(42)).toBe(42);
      expect(sanitizeForJson(true)).toBe(true);
      expect(sanitizeForJson(null)).toBe(null);
    });

    it("converts bigint to string", () => {
      expect(sanitizeForJson(BigInt(123))).toBe("123");
    });

    it("returns undefined for functions", () => {
      expect(sanitizeForJson(() => {})).toBe(undefined);
    });

    it("returns undefined for symbols", () => {
      expect(sanitizeForJson(Symbol("test"))).toBe(undefined);
    });

    it("returns null for Infinity/NaN", () => {
      expect(sanitizeForJson(Infinity)).toBe(null);
      expect(sanitizeForJson(NaN)).toBe(null);
    });

    it("converts Date to ISO string", () => {
      const date = new Date("2025-01-01T00:00:00Z");
      expect(sanitizeForJson(date)).toBe("2025-01-01T00:00:00.000Z");
    });

    it("converts RegExp to string", () => {
      const result = sanitizeForJson(/test/gi);
      expect(result).toBe("/test/gi");
    });

    it("handles arrays", () => {
      const result = sanitizeForJson([1, undefined, 3]);
      expect(result).toEqual([1, null, 3]);
    });

    it("handles Set", () => {
      const result = sanitizeForJson(new Set([1, 2]));
      expect(result).toEqual([1, 2]);
    });

    it("handles Map with string keys", () => {
      const map = new Map([["a", 1], ["b", 2]]);
      const result = sanitizeForJson(map);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("handles Map with non-string keys", () => {
      const map = new Map([[1, "a"], [2, "b"]]);
      const result = sanitizeForJson(map);
      expect(result).toEqual([[1, "a"], [2, "b"]]);
    });

    it("handles circular references", () => {
      const obj = { a: 1 };
      obj.self = obj;
      const result = sanitizeForJson(obj);
      expect(result.a).toBe(1);
      expect(result.self).toBe("[Circular]");
    });

    it("skips dangerous keys", () => {
      // Create object with dangerous keys explicitly
      const obj = Object.create(null);
      obj.a = 1;
      Object.defineProperty(obj, "__proto__", { value: { b: 2 }, enumerable: true });
      Object.defineProperty(obj, "constructor", { value: "bad", enumerable: true });
      const result = sanitizeForJson(obj);
      expect(result.a).toBe(1);
      // The function filters these out
      expect(Object.hasOwn(result, "__proto__")).toBe(false);
    });

    it("returns undefined for WeakMap", () => {
      expect(sanitizeForJson(new WeakMap())).toBe(undefined);
    });

    it("returns undefined for WeakSet", () => {
      expect(sanitizeForJson(new WeakSet())).toBe(undefined);
    });
  });

  describe("TOKEN_ESTIMATE_CONFIG", () => {
    it("exports config object", () => {
      expect(TOKEN_ESTIMATE_CONFIG.latinCharsPerToken).toBeGreaterThan(0);
      expect(TOKEN_ESTIMATE_CONFIG.cjkTokensPerChar).toBeGreaterThan(0);
    });
  });
});
