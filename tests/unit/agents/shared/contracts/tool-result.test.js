import { describe, expect, it } from "vitest";

import { normalizeToolResult, validateToolResult } from '../../../../../js/agents/shared/index.js';

describe("shared/contracts/tool-result", () => {
  describe("validateToolResult", () => {
    it("rejects non-objects", () => {
      expect(validateToolResult(null)).toEqual({ ok: false, error: "ToolResult: expected object" });
      expect(validateToolResult(123)).toEqual({ ok: false, error: "ToolResult: expected object" });
    });

    it("treats ok/success as compatible and prioritizes explicit failure", () => {
      const okOnly = validateToolResult({ ok: true, data: 1, error: "x", meta: { a: 1 } });
      expect(okOnly.ok).toBe(true);
      expect(okOnly.value).toEqual({ ok: true, success: true, data: 1, error: "x", meta: { a: 1 } });

      const successOnly = validateToolResult({ success: true, data: 2 });
      expect(successOnly.ok).toBe(true);
      expect(successOnly.value).toMatchObject({ ok: true, success: true, data: 2 });

      // Explicit failure wins even if the other flag is truthy.
      const mixed = validateToolResult({ ok: true, success: false, data: 3 });
      expect(mixed.ok).toBe(true);
      expect(mixed.value).toMatchObject({ ok: false, success: false, data: 3 });
    });

    it("normalizes error/meta types", () => {
      const out = validateToolResult({
        ok: false,
        error: 123, // non-string -> dropped
        meta: null, // null -> dropped
      });
      expect(out.ok).toBe(true);
      expect(out.value).toEqual({ ok: false, success: false, data: undefined, error: undefined, meta: undefined });
    });
  });

  describe("normalizeToolResult", () => {
    it("returns a validated ToolResult when ok/success is present", () => {
      expect(normalizeToolResult({ success: true, data: 1 })).toEqual({ ok: true, success: true, data: 1, error: undefined, meta: undefined });
      expect(normalizeToolResult({ ok: false, error: "bad" })).toEqual({ ok: false, success: false, data: undefined, error: "bad", meta: undefined });
    });

    it("wraps Error instances as failures with stack meta", () => {
      const err = new Error("boom");
      const out = normalizeToolResult(err);
      expect(out.ok).toBe(false);
      expect(out.success).toBe(false);
      expect(out.error).toBe("boom");
      expect(out.meta).toEqual({ stack: err.stack });
    });

    it("normalizes null/undefined to ok:true with data:null", () => {
      expect(normalizeToolResult(null)).toEqual({ ok: true, success: true, data: null });
      expect(normalizeToolResult(undefined)).toEqual({ ok: true, success: true, data: null });
    });

    it("wraps raw values (including plain objects without ok/success) into data", () => {
      expect(normalizeToolResult(123)).toEqual({ ok: true, success: true, data: 123 });
      expect(normalizeToolResult({ a: 1 })).toEqual({ ok: true, success: true, data: { a: 1 } });
    });
  });
});
