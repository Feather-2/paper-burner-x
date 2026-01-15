import { describe, it, expect, vi } from "vitest";

import {
  validateChunk,
  validateChunks,
  validateGlobResult,
  validateGrepMatch,
  validateGrepResults,
  validateSearchQuery,
  ValidationErrorCode,
  createValidationError,
} from "../../../../js/agents/shared/utils/schema-validator.js";

describe("schema-validator", () => {
  describe("validateChunk", () => {
    it("rejects non-plain-object inputs", () => {
      const r = validateChunk("nope", 0);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("chunk[0]: expected object");
    });

    it("collects field errors and returns trimmed chunkId on success", () => {
      const bad = validateChunk({ chunkId: "", text: 123 }, 2);
      expect(bad.ok).toBe(false);
      expect(bad.errors).toEqual([
        "chunk[2].chunkId: required non-empty string",
        "chunk[2].text: required string, got number",
      ]);

      const chunkIdObj = { toString: vi.fn(() => "  abc  ") };
      const good = validateChunk({ chunkId: chunkIdObj, text: "hello", extra: true });
      expect(chunkIdObj.toString).toHaveBeenCalled();
      expect(good.ok).toBe(true);
      expect(good.value).toEqual({ chunkId: "abc", text: "hello", extra: true });
    });
  });

  describe("validateChunks", () => {
    it("rejects non-arrays and (by default) empty arrays", () => {
      expect(validateChunks(null).ok).toBe(false);
      expect(validateChunks([]).errors).toEqual(["chunks: array is empty"]);
      expect(validateChunks([], { allowEmpty: true })).toEqual({ ok: true, value: [], errors: [] });
    });

    it("collects up to maxErrors and includes a summary when there are many invalid chunks", () => {
      const chunks = Array.from({ length: 5 }, () => ({ text: "t" })); // missing chunkId => 1 error each
      const r = validateChunks(chunks, { maxErrors: 2 });

      expect(r.ok).toBe(false);
      expect(r.value).toEqual([]);
      expect(r.errors).toHaveLength(3);
      expect(r.errors[0]).toContain("chunk[0].chunkId");
      expect(r.errors[1]).toContain("chunk[1].chunkId");
      expect(r.errors[2]).toBe("... and 3 more invalid chunks");
    });

    it("returns validated subset when some chunks are invalid", () => {
      const r = validateChunks([
        { chunkId: "ok-1", text: "a" },
        { text: "missing chunkId" },
        { chunkId: "ok-2", text: "b" },
      ]);

      expect(r.ok).toBe(false);
      expect(r.value).toEqual([
        { chunkId: "ok-1", text: "a" },
        { chunkId: "ok-2", text: "b" },
      ]);
      expect(r.errors.some((e) => e.includes("chunk[1].chunkId"))).toBe(true);
    });
  });

  describe("validateGlobResult", () => {
    it("validates structure and coerces/filters fields", () => {
      expect(validateGlobResult(null)).toEqual({ ok: false, value: null, errors: ["globResult: expected object"] });
      expect(validateGlobResult({ files: "nope" }).ok).toBe(false);
      expect(validateGlobResult({ files: [], error: 123 }).errors).toEqual(["globResult.error: expected string or undefined"]);

      const r = validateGlobResult({
        files: ["a.txt", 1, "b.txt"],
        fromCache: "yes",
        error: "warning",
      });

      expect(r.ok).toBe(true);
      expect(r.value).toEqual({
        files: ["a.txt", "b.txt"],
        fromCache: true,
        error: "warning",
      });
    });
  });

  describe("validateGrepMatch / validateGrepResults", () => {
    it("validates and normalizes grep match objects", () => {
      const bad = validateGrepMatch("nope", 0);
      expect(bad.ok).toBe(false);
      expect(bad.errors[0]).toContain("match[0]: expected object");

      const good = validateGrepMatch({ chunkId: "  c1  " });
      expect(good.ok).toBe(true);
      expect(good.value).toEqual({ chunkId: "c1", matchCount: 1, spans: [] });
    });

    it("skips invalid matches but returns ok=true for the overall grep results", () => {
      const r = validateGrepResults({
        matches: [{ chunkId: "ok", matchCount: 2, spans: [1, 2] }, { nope: true }],
        error: undefined,
      });

      expect(r.ok).toBe(true);
      expect(r.value.matches).toEqual([{ chunkId: "ok", matchCount: 2, spans: [1, 2] }]);
    });

    it("rejects invalid grep results shapes", () => {
      expect(validateGrepResults(null).ok).toBe(false);
      expect(validateGrepResults({ matches: "nope" }).errors).toEqual(["grepResults.matches: expected array"]);
      expect(validateGrepResults({ matches: [], error: 123 }).errors).toEqual(["grepResults.error: expected string or undefined"]);
    });
  });

  describe("validateSearchQuery", () => {
    it("validates strategy and normalizes to lowercase", () => {
      const bad = validateSearchQuery({ strategy: "wat" });
      expect(bad.ok).toBe(false);
      expect(bad.errors[0]).toContain("query.strategy: expected one of");

      const good = validateSearchQuery({ strategy: "GLOB-THEN-GREP" });
      expect(good.ok).toBe(true);
      expect(good.value).toEqual({ strategy: "glob-then-grep", patterns: [], keywords: [] });
    });

    it("validates patterns/keywords array shape", () => {
      expect(validateSearchQuery({ patterns: "x" }).errors).toEqual(["query.patterns: expected array"]);
      expect(validateSearchQuery({ keywords: "x" }).errors).toEqual(["query.keywords: expected array"]);
    });
  });

  describe("createValidationError", () => {
    it("creates a structured error response", () => {
      const r = createValidationError(ValidationErrorCode.INVALID_QUERY, "bad query", { details: { a: 1 } });
      expect(r).toEqual({
        ok: false,
        error: { code: ValidationErrorCode.INVALID_QUERY, message: "bad query", details: { a: 1 } },
        results: [],
        stats: {},
      });
    });
  });
});

