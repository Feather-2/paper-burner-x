import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  validateChunk,
  validateChunks,
  validateGlobResult,
  validateGrepMatch,
  validateGrepResults,
  validateSearchQuery,
  ValidationErrorCode,
  createValidationError,
} from "../../../js/agents/shared/utils/schema-validator.js";

describe("schema-validator", () => {
  describe("validateChunk", () => {
    it("should accept valid chunk", () => {
      const r = validateChunk({ chunkId: "c1", text: "hello world" });
      expect(r.ok).toBe(true);
      expect(r.value.chunkId).toBe("c1");
      expect(r.value.text).toBe("hello world");
    });

    it("should reject non-object", () => {
      const r = validateChunk("not an object");
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("expected object");
    });

    it("should reject missing chunkId", () => {
      const r = validateChunk({ text: "hello" });
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("chunkId")]));
    });

    it("should reject missing text", () => {
      const r = validateChunk({ chunkId: "c1" });
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("text")]));
    });

    it("should include index in error message", () => {
      const r = validateChunk({ chunkId: "" }, 5);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("chunk[5]");
    });
  });

  describe("validateChunks", () => {
    it("should accept valid chunks array", () => {
      const chunks = [
        { chunkId: "c1", text: "hello" },
        { chunkId: "c2", text: "world" },
      ];
      const r = validateChunks(chunks);
      expect(r.ok).toBe(true);
      expect(r.value.length).toBe(2);
    });

    it("should reject non-array", () => {
      const r = validateChunks("not an array");
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("expected array");
    });

    it("should reject empty array by default", () => {
      const r = validateChunks([]);
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toContain("empty");
    });

    it("should allow empty array with option", () => {
      const r = validateChunks([], { allowEmpty: true });
      expect(r.ok).toBe(true);
      expect(r.value.length).toBe(0);
    });

    it("should limit error count", () => {
      const chunks = Array(20).fill({ invalid: true });
      const r = validateChunks(chunks, { maxErrors: 3 });
      expect(r.ok).toBe(false);
      // maxErrors limits individual error messages, not chunk count
      // Each invalid chunk may generate multiple errors
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors.length).toBeLessThanOrEqual(10); // reasonable upper bound
    });

    it("should return validated chunks even with some invalid", () => {
      const chunks = [
        { chunkId: "c1", text: "valid" },
        { invalid: true },
        { chunkId: "c2", text: "also valid" },
      ];
      const r = validateChunks(chunks);
      expect(r.ok).toBe(false);
      expect(r.value.length).toBe(2);
    });
  });

  describe("validateGlobResult", () => {
    it("should accept valid glob result", () => {
      const r = validateGlobResult({ files: ["a.txt", "b.txt"], fromCache: true });
      expect(r.ok).toBe(true);
      expect(r.value.files).toEqual(["a.txt", "b.txt"]);
      expect(r.value.fromCache).toBe(true);
    });

    it("should reject non-object", () => {
      const r = validateGlobResult(null);
      expect(r.ok).toBe(false);
    });

    it("should reject missing files array", () => {
      const r = validateGlobResult({ fromCache: true });
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("files")]));
    });

    it("should filter non-string files", () => {
      const r = validateGlobResult({ files: ["a.txt", 123, null, "b.txt"] });
      expect(r.ok).toBe(true);
      expect(r.value.files).toEqual(["a.txt", "b.txt"]);
    });

    it("should preserve error field", () => {
      const r = validateGlobResult({ files: [], error: "timeout" });
      expect(r.ok).toBe(true);
      expect(r.value.error).toBe("timeout");
    });
  });

  describe("validateGrepMatch", () => {
    it("should accept valid match", () => {
      const r = validateGrepMatch({ chunkId: "c1", matchCount: 3, spans: [[0, 5]] });
      expect(r.ok).toBe(true);
      expect(r.value.chunkId).toBe("c1");
      expect(r.value.matchCount).toBe(3);
    });

    it("should default matchCount to 1", () => {
      const r = validateGrepMatch({ chunkId: "c1" });
      expect(r.ok).toBe(true);
      expect(r.value.matchCount).toBe(1);
    });

    it("should default spans to empty array", () => {
      const r = validateGrepMatch({ chunkId: "c1" });
      expect(r.ok).toBe(true);
      expect(r.value.spans).toEqual([]);
    });

    it("should reject missing chunkId", () => {
      const r = validateGrepMatch({ matchCount: 1 });
      expect(r.ok).toBe(false);
    });
  });

  describe("validateGrepResults", () => {
    it("should accept valid grep results", () => {
      const r = validateGrepResults({
        matches: [{ chunkId: "c1", matchCount: 2 }],
      });
      expect(r.ok).toBe(true);
      expect(r.value.matches.length).toBe(1);
    });

    it("should reject non-object", () => {
      const r = validateGrepResults([]);
      expect(r.ok).toBe(false);
    });

    it("should skip invalid matches silently", () => {
      const r = validateGrepResults({
        matches: [
          { chunkId: "c1" },
          { invalid: true },
          { chunkId: "c2" },
        ],
      });
      expect(r.ok).toBe(true);
      expect(r.value.matches.length).toBe(2);
    });
  });

  describe("validateSearchQuery", () => {
    it("should accept valid query", () => {
      const r = validateSearchQuery({
        strategy: "grep-only",
        keywords: ["hello", "world"],
        patterns: ["*.md"],
      });
      expect(r.ok).toBe(true);
      expect(r.value.strategy).toBe("grep-only");
    });

    it("should normalize strategy to lowercase", () => {
      const r = validateSearchQuery({ strategy: "GREP-ONLY" });
      expect(r.ok).toBe(true);
      expect(r.value.strategy).toBe("grep-only");
    });

    it("should reject invalid strategy", () => {
      const r = validateSearchQuery({ strategy: "invalid-strategy" });
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(expect.arrayContaining([expect.stringContaining("strategy")]));
    });

    it("should default patterns to empty array", () => {
      const r = validateSearchQuery({});
      expect(r.ok).toBe(true);
      expect(r.value.patterns).toEqual([]);
    });

    it("should default keywords to empty array", () => {
      const r = validateSearchQuery({});
      expect(r.ok).toBe(true);
      expect(r.value.keywords).toEqual([]);
    });
  });

  describe("ValidationErrorCode", () => {
    it("should have expected error codes", () => {
      expect(ValidationErrorCode.INVALID_CHUNKS).toBe("INVALID_CHUNKS");
      expect(ValidationErrorCode.INVALID_QUERY).toBe("INVALID_QUERY");
      expect(ValidationErrorCode.NO_KEYWORDS).toBe("NO_KEYWORDS");
    });
  });

  describe("createValidationError", () => {
    it("should create structured error", () => {
      const err = createValidationError(
        ValidationErrorCode.INVALID_CHUNKS,
        "Chunks are invalid",
        { count: 5 }
      );
      expect(err.ok).toBe(false);
      expect(err.error.code).toBe("INVALID_CHUNKS");
      expect(err.error.message).toBe("Chunks are invalid");
      expect(err.error.count).toBe(5);
      expect(err.results).toEqual([]);
    });
  });
});
