import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
      assert.ok(isPlainObject({}));
      assert.ok(isPlainObject({ a: 1 }));
    });

    it("returns true for Object.create(null)", () => {
      assert.ok(isPlainObject(Object.create(null)));
    });

    it("returns false for null", () => {
      assert.equal(isPlainObject(null), false);
    });

    it("returns false for arrays", () => {
      assert.equal(isPlainObject([]), false);
      assert.equal(isPlainObject([1, 2, 3]), false);
    });

    it("returns false for class instances", () => {
      class Foo {}
      assert.equal(isPlainObject(new Foo()), false);
    });

    it("returns false for primitives", () => {
      assert.equal(isPlainObject("string"), false);
      assert.equal(isPlainObject(123), false);
      assert.equal(isPlainObject(true), false);
    });

    it("returns false for Date", () => {
      assert.equal(isPlainObject(new Date()), false);
    });
  });

  describe("toNonEmptyString", () => {
    it("returns trimmed string", () => {
      assert.equal(toNonEmptyString("  hello  "), "hello");
    });

    it("returns undefined for empty string", () => {
      assert.equal(toNonEmptyString(""), undefined);
      assert.equal(toNonEmptyString("   "), undefined);
    });

    it("returns undefined for null", () => {
      assert.equal(toNonEmptyString(null), undefined);
    });

    it("returns undefined for undefined", () => {
      assert.equal(toNonEmptyString(undefined), undefined);
    });

    it("converts numbers to string", () => {
      assert.equal(toNonEmptyString(42), "42");
    });
  });

  describe("toNumber", () => {
    it("returns number for valid input", () => {
      assert.equal(toNumber(42), 42);
      assert.equal(toNumber("3.14"), 3.14);
    });

    it("returns null for NaN", () => {
      assert.equal(toNumber(NaN), null);
    });

    it("returns null for Infinity", () => {
      assert.equal(toNumber(Infinity), null);
    });

    it("returns null for non-numeric string", () => {
      assert.equal(toNumber("hello"), null);
    });
  });

  describe("toBoolean", () => {
    it("returns boolean as-is", () => {
      assert.equal(toBoolean(true), true);
      assert.equal(toBoolean(false), false);
    });

    it("converts numbers", () => {
      assert.equal(toBoolean(1), true);
      assert.equal(toBoolean(0), false);
      assert.equal(toBoolean(-1), true);
    });

    it("converts truthy strings", () => {
      assert.equal(toBoolean("true"), true);
      assert.equal(toBoolean("TRUE"), true);
      assert.equal(toBoolean("yes"), true);
      assert.equal(toBoolean("1"), true);
      assert.equal(toBoolean("on"), true);
    });

    it("converts falsy strings", () => {
      assert.equal(toBoolean("false"), false);
      assert.equal(toBoolean("no"), false);
      assert.equal(toBoolean("0"), false);
      assert.equal(toBoolean("off"), false);
    });

    it("returns false for unknown values", () => {
      assert.equal(toBoolean("maybe"), false);
      assert.equal(toBoolean(null), false);
    });
  });

  describe("normalizeKey", () => {
    it("normalizes to lowercase alphanumeric", () => {
      assert.equal(normalizeKey("Hello-World_123"), "hello world 123");
    });

    it("returns empty for null", () => {
      assert.equal(normalizeKey(null), "");
    });

    it("returns empty for undefined", () => {
      assert.equal(normalizeKey(undefined), "");
    });
  });

  describe("safeNumber", () => {
    it("returns number for valid number", () => {
      assert.equal(safeNumber(42), 42);
      assert.equal(safeNumber(3.14), 3.14);
    });

    it("returns null for NaN", () => {
      assert.equal(safeNumber(NaN), null);
    });

    it("returns null for Infinity", () => {
      assert.equal(safeNumber(Infinity), null);
    });

    it("parses numeric strings", () => {
      assert.equal(safeNumber("42"), 42);
      assert.equal(safeNumber("  3.14  "), 3.14);
    });

    it("returns null for empty string", () => {
      assert.equal(safeNumber(""), null);
      assert.equal(safeNumber("   "), null);
    });

    it("returns null for non-string non-number", () => {
      assert.equal(safeNumber({}), null);
      assert.equal(safeNumber([]), null);
    });
  });

  describe("safeInt", () => {
    it("floors valid numbers", () => {
      assert.equal(safeInt(3.7), 3);
      assert.equal(safeInt(3.2), 3);
    });

    it("returns null for invalid", () => {
      assert.equal(safeInt("hello"), null);
      assert.equal(safeInt(NaN), null);
    });
  });

  describe("toNonNegativeInt", () => {
    it("returns non-negative int", () => {
      assert.equal(toNonNegativeInt(5), 5);
      assert.equal(toNonNegativeInt(0), 0);
    });

    it("returns fallback for negative", () => {
      assert.equal(toNonNegativeInt(-5), 0);
      assert.equal(toNonNegativeInt(-5, 10), 10);
    });

    it("parses parseInt-style strings", () => {
      assert.equal(toNonNegativeInt("10px"), 10);
    });

    it("returns fallback for invalid", () => {
      assert.equal(toNonNegativeInt("hello", 42), 42);
    });
  });

  describe("toPositiveInt", () => {
    it("returns positive int", () => {
      assert.equal(toPositiveInt(5), 5);
    });

    it("returns fallback for zero", () => {
      assert.equal(toPositiveInt(0), 1);
      assert.equal(toPositiveInt(0, 10), 10);
    });

    it("returns fallback for negative", () => {
      assert.equal(toPositiveInt(-5, 3), 3);
    });
  });

  describe("normalizeRenderType", () => {
    it("normalizes ai-image variants", () => {
      assert.equal(normalizeRenderType("ai-image"), "ai-image");
      assert.equal(normalizeRenderType("ai_image"), "ai-image");
      assert.equal(normalizeRenderType("image"), "ai-image");
    });

    it("normalizes svg", () => {
      assert.equal(normalizeRenderType("svg"), "svg");
      assert.equal(normalizeRenderType("SVG"), "svg");
    });

    it("normalizes asset variants", () => {
      assert.equal(normalizeRenderType("asset"), "asset");
      assert.equal(normalizeRenderType("doc-asset"), "asset");
      assert.equal(normalizeRenderType("document-asset"), "asset");
    });

    it("defaults to ai-image", () => {
      assert.equal(normalizeRenderType("unknown"), "ai-image");
      assert.equal(normalizeRenderType(null), "ai-image");
    });
  });

  describe("isCjkChar", () => {
    it("detects Chinese characters", () => {
      assert.ok(isCjkChar("中".charCodeAt(0)));
      assert.ok(isCjkChar("国".charCodeAt(0)));
    });

    it("detects Japanese hiragana", () => {
      assert.ok(isCjkChar("あ".charCodeAt(0)));
    });

    it("detects Japanese katakana", () => {
      assert.ok(isCjkChar("ア".charCodeAt(0)));
    });

    it("detects Korean hangul", () => {
      assert.ok(isCjkChar("한".charCodeAt(0)));
    });

    it("returns false for ASCII", () => {
      assert.equal(isCjkChar("a".charCodeAt(0)), false);
      assert.equal(isCjkChar("1".charCodeAt(0)), false);
    });
  });

  describe("estimateTokenCount", () => {
    it("returns 0 for empty string", () => {
      assert.equal(estimateTokenCount(""), 0);
    });

    it("returns 0 for null", () => {
      assert.equal(estimateTokenCount(null), 0);
    });

    it("estimates English text", () => {
      const count = estimateTokenCount("Hello world this is a test");
      assert.ok(count > 0);
    });

    it("estimates Chinese text", () => {
      const count = estimateTokenCount("你好世界");
      assert.ok(count > 0);
    });

    it("handles mixed text", () => {
      const count = estimateTokenCount("Hello 世界");
      assert.ok(count > 0);
    });

    it("accepts custom config", () => {
      const count = estimateTokenCount("test", { latinCharsPerToken: 2 });
      assert.ok(count > 0);
    });
  });

  describe("estimateTokens", () => {
    it("is alias for estimateTokenCount", () => {
      const a = estimateTokenCount("test");
      const b = estimateTokens("test");
      assert.equal(a, b);
    });
  });

  describe("estimateTokenCountFast", () => {
    it("returns 0 for empty", () => {
      assert.equal(estimateTokenCountFast(""), 0);
    });

    it("estimates based on length/2", () => {
      assert.equal(estimateTokenCountFast("abcd"), 2);
    });
  });

  describe("deepClone", () => {
    it("clones primitives", () => {
      assert.equal(deepClone(42), 42);
      assert.equal(deepClone("hello"), "hello");
      assert.equal(deepClone(null), null);
    });

    it("clones objects", () => {
      const obj = { a: 1, b: { c: 2 } };
      const clone = deepClone(obj);
      assert.deepEqual(clone, obj);
      assert.notEqual(clone, obj);
      assert.notEqual(clone.b, obj.b);
    });

    it("clones arrays", () => {
      const arr = [1, [2, 3], { x: 4 }];
      const clone = deepClone(arr);
      assert.deepEqual(clone, arr);
      assert.notEqual(clone, arr);
    });

    it("clones Date", () => {
      const date = new Date("2025-01-01");
      const clone = deepClone(date);
      assert.equal(clone.getTime(), date.getTime());
      assert.notEqual(clone, date);
    });

    it("clones RegExp", () => {
      const regex = /test/gi;
      const clone = deepClone(regex);
      assert.equal(clone.source, regex.source);
      assert.equal(clone.flags, regex.flags);
    });

    it("clones Map", () => {
      const map = new Map([["a", 1], ["b", 2]]);
      const clone = deepClone(map);
      assert.equal(clone.get("a"), 1);
      assert.notEqual(clone, map);
    });

    it("clones Set", () => {
      const set = new Set([1, 2, 3]);
      const clone = deepClone(set);
      assert.ok(clone.has(1));
      assert.notEqual(clone, set);
    });

    it("handles circular references", () => {
      const obj = { a: 1 };
      obj.self = obj;
      const clone = deepClone(obj);
      assert.equal(clone.a, 1);
      assert.equal(clone.self, clone);
    });
  });

  describe("sanitizeForJson", () => {
    it("passes through primitives", () => {
      assert.equal(sanitizeForJson("hello"), "hello");
      assert.equal(sanitizeForJson(42), 42);
      assert.equal(sanitizeForJson(true), true);
      assert.equal(sanitizeForJson(null), null);
    });

    it("converts bigint to string", () => {
      assert.equal(sanitizeForJson(BigInt(123)), "123");
    });

    it("returns undefined for functions", () => {
      assert.equal(sanitizeForJson(() => {}), undefined);
    });

    it("returns undefined for symbols", () => {
      assert.equal(sanitizeForJson(Symbol("test")), undefined);
    });

    it("returns null for Infinity/NaN", () => {
      assert.equal(sanitizeForJson(Infinity), null);
      assert.equal(sanitizeForJson(NaN), null);
    });

    it("converts Date to ISO string", () => {
      const date = new Date("2025-01-01T00:00:00Z");
      assert.equal(sanitizeForJson(date), "2025-01-01T00:00:00.000Z");
    });

    it("converts RegExp to string", () => {
      const result = sanitizeForJson(/test/gi);
      assert.equal(result, "/test/gi");
    });

    it("handles arrays", () => {
      const result = sanitizeForJson([1, undefined, 3]);
      assert.deepEqual(result, [1, null, 3]);
    });

    it("handles Set", () => {
      const result = sanitizeForJson(new Set([1, 2]));
      assert.deepEqual(result, [1, 2]);
    });

    it("handles Map with string keys", () => {
      const map = new Map([["a", 1], ["b", 2]]);
      const result = sanitizeForJson(map);
      assert.deepEqual(result, { a: 1, b: 2 });
    });

    it("handles Map with non-string keys", () => {
      const map = new Map([[1, "a"], [2, "b"]]);
      const result = sanitizeForJson(map);
      assert.deepEqual(result, [[1, "a"], [2, "b"]]);
    });

    it("handles circular references", () => {
      const obj = { a: 1 };
      obj.self = obj;
      const result = sanitizeForJson(obj);
      assert.equal(result.a, 1);
      assert.equal(result.self, "[Circular]");
    });

    it("skips dangerous keys", () => {
      // Create object with dangerous keys explicitly
      const obj = Object.create(null);
      obj.a = 1;
      Object.defineProperty(obj, "__proto__", { value: { b: 2 }, enumerable: true });
      Object.defineProperty(obj, "constructor", { value: "bad", enumerable: true });
      const result = sanitizeForJson(obj);
      assert.equal(result.a, 1);
      // The function filters these out
      assert.ok(!Object.hasOwn(result, "__proto__") || result.__proto__ === undefined);
    });

    it("returns undefined for WeakMap", () => {
      assert.equal(sanitizeForJson(new WeakMap()), undefined);
    });

    it("returns undefined for WeakSet", () => {
      assert.equal(sanitizeForJson(new WeakSet()), undefined);
    });
  });

  describe("TOKEN_ESTIMATE_CONFIG", () => {
    it("exports config object", () => {
      assert.ok(TOKEN_ESTIMATE_CONFIG.latinCharsPerToken > 0);
      assert.ok(TOKEN_ESTIMATE_CONFIG.cjkTokensPerChar > 0);
    });
  });
});
