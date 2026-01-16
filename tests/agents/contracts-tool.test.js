import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateToolResult,
  normalizeToolResult,
} from "../../js/agents/shared/contracts/tool-result.js";

describe("shared/contracts/tool-result", () => {
  describe("validateToolResult", () => {
    it("validates successful result with ok", () => {
      const result = validateToolResult({
        ok: true,
        data: { value: 42 },
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, true);
      assert.equal(result.value.success, true);
      assert.deepEqual(result.value.data, { value: 42 });
    });

    it("validates successful result with success", () => {
      const result = validateToolResult({
        success: true,
        data: "result",
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, true);
      assert.equal(result.value.success, true);
    });

    it("validates failure result with ok=false", () => {
      const result = validateToolResult({
        ok: false,
        error: "Something failed",
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, false);
      assert.equal(result.value.success, false);
      assert.equal(result.value.error, "Something failed");
    });

    it("validates failure result with success=false", () => {
      const result = validateToolResult({
        success: false,
        error: "Failed",
      });
      assert.ok(result.ok);
      assert.equal(result.value.ok, false);
    });

    it("rejects null", () => {
      const result = validateToolResult(null);
      assert.equal(result.ok, false);
    });

    it("rejects non-object", () => {
      const result = validateToolResult("string");
      assert.equal(result.ok, false);
    });

    it("handles missing ok and success", () => {
      const result = validateToolResult({ data: "test" });
      assert.ok(result.ok);
      // Without explicit ok/success, defaults to false
      assert.equal(result.value.ok, false);
    });

    it("handles non-string error", () => {
      const result = validateToolResult({ ok: false, error: 123 });
      assert.ok(result.ok);
      assert.equal(result.value.error, undefined);
    });

    it("handles meta object", () => {
      const result = validateToolResult({
        ok: true,
        meta: { duration: 100 },
      });
      assert.ok(result.ok);
      assert.deepEqual(result.value.meta, { duration: 100 });
    });

    it("handles null meta", () => {
      const result = validateToolResult({ ok: true, meta: null });
      assert.ok(result.ok);
      assert.equal(result.value.meta, undefined);
    });

    it("handles non-object meta", () => {
      const result = validateToolResult({ ok: true, meta: "string" });
      assert.ok(result.ok);
      assert.equal(result.value.meta, undefined);
    });
  });

  describe("normalizeToolResult", () => {
    it("passes through valid ToolResult", () => {
      const input = { ok: true, data: "test" };
      const result = normalizeToolResult(input);
      assert.equal(result.ok, true);
      assert.equal(result.data, "test");
    });

    it("passes through result with success", () => {
      const input = { success: true, data: "test" };
      const result = normalizeToolResult(input);
      assert.equal(result.success, true);
    });

    it("converts Error to failed result", () => {
      const error = new Error("Test error");
      const result = normalizeToolResult(error);
      assert.equal(result.ok, false);
      assert.equal(result.success, false);
      assert.equal(result.error, "Test error");
      assert.ok(result.meta?.stack);
    });

    it("handles null", () => {
      const result = normalizeToolResult(null);
      assert.equal(result.ok, true);
      assert.equal(result.success, true);
      assert.equal(result.data, null);
    });

    it("handles undefined", () => {
      const result = normalizeToolResult(undefined);
      assert.equal(result.ok, true);
      assert.equal(result.success, true);
      assert.equal(result.data, null);
    });

    it("wraps primitive value", () => {
      const result = normalizeToolResult("string value");
      assert.equal(result.ok, true);
      assert.equal(result.data, "string value");
    });

    it("wraps number value", () => {
      const result = normalizeToolResult(42);
      assert.equal(result.ok, true);
      assert.equal(result.data, 42);
    });

    it("wraps unknown object as data", () => {
      const obj = { custom: "data", nested: { value: 1 } };
      const result = normalizeToolResult(obj);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, obj);
    });

    it("wraps array as data", () => {
      const arr = [1, 2, 3];
      const result = normalizeToolResult(arr);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, arr);
    });
  });
});
