import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { safeJsonParse } from "../../js/agents/shared/utils/safe-json.js";

describe("shared/utils/safe-json", () => {
  describe("safeJsonParse", () => {
    it("parses valid JSON string", () => {
      const result = safeJsonParse('{"key": "value"}');
      assert.deepEqual(result, { key: "value" });
    });

    it("parses JSON array", () => {
      const result = safeJsonParse("[1, 2, 3]");
      assert.deepEqual(result, [1, 2, 3]);
    });

    it("parses JSON primitives", () => {
      assert.equal(safeJsonParse("123"), 123);
      assert.equal(safeJsonParse("true"), true);
      assert.equal(safeJsonParse('"hello"'), "hello");
    });

    it("returns null for null input", () => {
      assert.equal(safeJsonParse(null), null);
    });

    it("returns null for undefined input", () => {
      assert.equal(safeJsonParse(undefined), null);
    });

    it("returns object as-is", () => {
      const obj = { already: "object" };
      assert.equal(safeJsonParse(obj), obj);
    });

    it("returns array as-is", () => {
      const arr = [1, 2, 3];
      assert.equal(safeJsonParse(arr), arr);
    });

    it("returns null for empty string", () => {
      assert.equal(safeJsonParse(""), null);
    });

    it("returns null for whitespace only", () => {
      assert.equal(safeJsonParse("   "), null);
    });

    it("trims whitespace before parsing", () => {
      const result = safeJsonParse('  {"key": "value"}  ');
      assert.deepEqual(result, { key: "value" });
    });

    it("returns null for invalid JSON", () => {
      assert.equal(safeJsonParse("{invalid}"), null);
    });

    it("returns null for string exceeding maxChars", () => {
      const longJson = '{"data": "' + "x".repeat(100) + '"}';
      const result = safeJsonParse(longJson, { maxChars: 50 });
      assert.equal(result, null);
    });

    it("parses when under maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: 100 });
      assert.deepEqual(result, { key: "value" });
    });

    it("handles Infinity maxChars", () => {
      const longJson = '{"data": "' + "x".repeat(1000) + '"}';
      const result = safeJsonParse(longJson, { maxChars: Infinity });
      assert.ok(result);
      assert.ok(result.data.length === 1000);
    });

    it("uses default maxChars when not specified", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json);
      assert.deepEqual(result, { key: "value" });
    });

    it("handles non-number maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: "invalid" });
      assert.deepEqual(result, { key: "value" });
    });

    it("handles zero maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: 0 });
      // Falls back to default, so should parse
      assert.deepEqual(result, { key: "value" });
    });

    it("handles negative maxChars", () => {
      const json = '{"key": "value"}';
      const result = safeJsonParse(json, { maxChars: -100 });
      // Falls back to default
      assert.deepEqual(result, { key: "value" });
    });

    it("converts non-string to string", () => {
      const result = safeJsonParse(123);
      assert.equal(result, 123);
    });

    it("handles null options", () => {
      const result = safeJsonParse('{"a": 1}', null);
      assert.deepEqual(result, { a: 1 });
    });

    it("handles non-object options", () => {
      const result = safeJsonParse('{"a": 1}', "not object");
      assert.deepEqual(result, { a: 1 });
    });
  });
});
