
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
      expect(result.ok).toBeTruthy();
      expect(result.value.ok).toBe(true);
      expect(result.value.success).toBe(true);
      expect(result.value.data).toEqual({ value: 42 });
    });

    it("validates successful result with success", () => {
      const result = validateToolResult({
        success: true,
        data: "result",
      });
      expect(result.ok).toBeTruthy();
      expect(result.value.ok).toBe(true);
      expect(result.value.success).toBe(true);
    });

    it("validates failure result with ok=false", () => {
      const result = validateToolResult({
        ok: false,
        error: "Something failed",
      });
      expect(result.ok).toBeTruthy();
      expect(result.value.ok).toBe(false);
      expect(result.value.success).toBe(false);
      expect(result.value.error).toBe("Something failed");
    });

    it("validates failure result with success=false", () => {
      const result = validateToolResult({
        success: false,
        error: "Failed",
      });
      expect(result.ok).toBeTruthy();
      expect(result.value.ok).toBe(false);
    });

    it("rejects null", () => {
      const result = validateToolResult(null);
      expect(result.ok).toBe(false);
    });

    it("rejects non-object", () => {
      const result = validateToolResult("string");
      expect(result.ok).toBe(false);
    });

    it("handles missing ok and success", () => {
      const result = validateToolResult({ data: "test" });
      expect(result.ok).toBeTruthy();
      // Without explicit ok/success, defaults to false
      expect(result.value.ok).toBe(false);
    });

    it("handles non-string error", () => {
      const result = validateToolResult({ ok: false, error: 123 });
      expect(result.ok).toBeTruthy();
      expect(result.value.error).toBe(undefined);
    });

    it("handles meta object", () => {
      const result = validateToolResult({
        ok: true,
        meta: { duration: 100 },
      });
      expect(result.ok).toBeTruthy();
      expect(result.value.meta).toEqual({ duration: 100 });
    });

    it("handles null meta", () => {
      const result = validateToolResult({ ok: true, meta: null });
      expect(result.ok).toBeTruthy();
      expect(result.value.meta).toBe(undefined);
    });

    it("handles non-object meta", () => {
      const result = validateToolResult({ ok: true, meta: "string" });
      expect(result.ok).toBeTruthy();
      expect(result.value.meta).toBe(undefined);
    });
  });

  describe("normalizeToolResult", () => {
    it("passes through valid ToolResult", () => {
      const input = { ok: true, data: "test" };
      const result = normalizeToolResult(input);
      expect(result.ok).toBe(true);
      expect(result.data).toBe("test");
    });

    it("passes through result with success", () => {
      const input = { success: true, data: "test" };
      const result = normalizeToolResult(input);
      expect(result.success).toBe(true);
    });

    it("converts Error to failed result", () => {
      const error = new Error("Test error");
      const result = normalizeToolResult(error);
      expect(result.ok).toBe(false);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Test error");
      expect(result.meta?.stack).toBeTruthy();
    });

    it("handles null", () => {
      const result = normalizeToolResult(null);
      expect(result.ok).toBe(true);
      expect(result.success).toBe(true);
      expect(result.data).toBe(null);
    });

    it("handles undefined", () => {
      const result = normalizeToolResult(undefined);
      expect(result.ok).toBe(true);
      expect(result.success).toBe(true);
      expect(result.data).toBe(null);
    });

    it("wraps primitive value", () => {
      const result = normalizeToolResult("string value");
      expect(result.ok).toBe(true);
      expect(result.data).toBe("string value");
    });

    it("wraps number value", () => {
      const result = normalizeToolResult(42);
      expect(result.ok).toBe(true);
      expect(result.data).toBe(42);
    });

    it("wraps unknown object as data", () => {
      const obj = { custom: "data", nested: { value: 1 } };
      const result = normalizeToolResult(obj);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(obj);
    });

    it("wraps array as data", () => {
      const arr = [1, 2, 3];
      const result = normalizeToolResult(arr);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(arr);
    });
  });
});
