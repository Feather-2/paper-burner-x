
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { safeJsonParse } from "../../js/agents/shared/utils/safe-json.js";

describe("shared/utils/safe-json", () => {
  describe("safeJsonParse", () => {
    it("parses valid JSON string", () => {
      const result = safeJsonParse('{"key": "value"}');
      expect(result).toEqual({ key: "value" });
    });

    it("parses JSON array", () => {
      const result = safeJsonParse("[1, 2, 3]");
      expect(result).toEqual([1, 2, 3]);
    });

    it("parses JSON primitives", () => {
      expect(safeJsonParse("123")).toBe(123);
      expect(safeJsonParse("true")).toBe(true);
      expect(safeJsonParse('"hello"')).toBe("hello");
    });

    it("returns null for null input", () => {
      expect(safeJsonParse(null)).toBe(null);
    });

    it("returns null for undefined input", () => {
      expect(safeJsonParse(undefined)).toBe(null);
    });

    it("returns object as-is", () => {
      const obj = { already: "object" };
      expect(safeJsonParse(obj)).toBe(obj);
    });

    it("returns array as-is", () => {
      const arr = [1, 2, 3];
      expect(safeJsonParse(arr)).toBe(arr);
    });

    it("returns null for empty string", () => {
      expect(safeJsonParse("")).toBe(null);
    });

    it("returns null for whitespace only", () => {
      expect(safeJsonParse("   ")).toBe(null);
    });

    it("trims whitespace before parsing", () => {
      const result = safeJsonParse('  {"key": "value"}  ');
      expect(result).toEqual({ key: "value" });
    });

    it("returns null for invalid JSON", () => {
      expect(safeJsonParse("{invalid}")).toBe(null);
    });

    it("returns null for string exceeding maxChars", () => {
      const longJson = '{"data": "' + "x".repeat(100) + '"}';
      const result = safeJsonParse(longJson, { maxChars: 50 });
      expect(result).toBe(null);
    });

    it("parses when under maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: 100 });
      expect(result).toEqual({ key: "value" });
    });

    it("handles Infinity maxChars", () => {
      const longJson = '{"data": "' + "x".repeat(1000) + '"}';
      const result = safeJsonParse(longJson, { maxChars: Infinity });
      expect(result).toBeTruthy();
      expect(result.data.length === 1000).toBeTruthy();
    });

    it("uses default maxChars when not specified", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json);
      expect(result).toEqual({ key: "value" });
    });

    it("handles non-number maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: "invalid" });
      expect(result).toEqual({ key: "value" });
    });

    it("handles zero maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: 0 });
      // Falls back to default, so should parse
      expect(result).toEqual({ key: "value" });
    });

    it("handles negative maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: -100 });
      // Falls back to default
      expect(result).toEqual({ key: "value" });
    });

    it("converts non-string to string", () => {
      const result = safeJsonParse(123);
      expect(result).toBe(123);
    });

    it("handles null options", () => {
      const result = safeJsonParse('{"a": 1}', null);
      expect(result).toEqual({ a: 1 });
    });

    it("handles non-object options", () => {
      const result = safeJsonParse('{"a": 1}', "not object");
      expect(result).toEqual({ a: 1 });
    });
  });
});
