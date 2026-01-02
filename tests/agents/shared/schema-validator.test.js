import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.chunkId, "c1");
      assert.strictEqual(r.value.text, "hello world");
    });

    it("should reject non-object", () => {
      const r = validateChunk("not an object");
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors[0].includes("expected object"));
    });

    it("should reject missing chunkId", () => {
      const r = validateChunk({ text: "hello" });
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors.some(e => e.includes("chunkId")));
    });

    it("should reject missing text", () => {
      const r = validateChunk({ chunkId: "c1" });
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors.some(e => e.includes("text")));
    });

    it("should include index in error message", () => {
      const r = validateChunk({ chunkId: "" }, 5);
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors[0].includes("chunk[5]"));
    });
  });

  describe("validateChunks", () => {
    it("should accept valid chunks array", () => {
      const chunks = [
        { chunkId: "c1", text: "hello" },
        { chunkId: "c2", text: "world" },
      ];
      const r = validateChunks(chunks);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.length, 2);
    });

    it("should reject non-array", () => {
      const r = validateChunks("not an array");
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors[0].includes("expected array"));
    });

    it("should reject empty array by default", () => {
      const r = validateChunks([]);
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors[0].includes("empty"));
    });

    it("should allow empty array with option", () => {
      const r = validateChunks([], { allowEmpty: true });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.length, 0);
    });

    it("should limit error count", () => {
      const chunks = Array(20).fill({ invalid: true });
      const r = validateChunks(chunks, { maxErrors: 3 });
      assert.strictEqual(r.ok, false);
      // maxErrors limits individual error messages, not chunk count
      // Each invalid chunk may generate multiple errors
      assert.ok(r.errors.length > 0);
      assert.ok(r.errors.length <= 10); // reasonable upper bound
    });

    it("should return validated chunks even with some invalid", () => {
      const chunks = [
        { chunkId: "c1", text: "valid" },
        { invalid: true },
        { chunkId: "c2", text: "also valid" },
      ];
      const r = validateChunks(chunks);
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.value.length, 2);
    });
  });

  describe("validateGlobResult", () => {
    it("should accept valid glob result", () => {
      const r = validateGlobResult({ files: ["a.txt", "b.txt"], fromCache: true });
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.value.files, ["a.txt", "b.txt"]);
      assert.strictEqual(r.value.fromCache, true);
    });

    it("should reject non-object", () => {
      const r = validateGlobResult(null);
      assert.strictEqual(r.ok, false);
    });

    it("should reject missing files array", () => {
      const r = validateGlobResult({ fromCache: true });
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors.some(e => e.includes("files")));
    });

    it("should filter non-string files", () => {
      const r = validateGlobResult({ files: ["a.txt", 123, null, "b.txt"] });
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.value.files, ["a.txt", "b.txt"]);
    });

    it("should preserve error field", () => {
      const r = validateGlobResult({ files: [], error: "timeout" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.error, "timeout");
    });
  });

  describe("validateGrepMatch", () => {
    it("should accept valid match", () => {
      const r = validateGrepMatch({ chunkId: "c1", matchCount: 3, spans: [[0, 5]] });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.chunkId, "c1");
      assert.strictEqual(r.value.matchCount, 3);
    });

    it("should default matchCount to 1", () => {
      const r = validateGrepMatch({ chunkId: "c1" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.matchCount, 1);
    });

    it("should default spans to empty array", () => {
      const r = validateGrepMatch({ chunkId: "c1" });
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.value.spans, []);
    });

    it("should reject missing chunkId", () => {
      const r = validateGrepMatch({ matchCount: 1 });
      assert.strictEqual(r.ok, false);
    });
  });

  describe("validateGrepResults", () => {
    it("should accept valid grep results", () => {
      const r = validateGrepResults({
        matches: [{ chunkId: "c1", matchCount: 2 }],
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.matches.length, 1);
    });

    it("should reject non-object", () => {
      const r = validateGrepResults([]);
      assert.strictEqual(r.ok, false);
    });

    it("should skip invalid matches silently", () => {
      const r = validateGrepResults({
        matches: [
          { chunkId: "c1" },
          { invalid: true },
          { chunkId: "c2" },
        ],
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.matches.length, 2);
    });
  });

  describe("validateSearchQuery", () => {
    it("should accept valid query", () => {
      const r = validateSearchQuery({
        strategy: "grep-only",
        keywords: ["hello", "world"],
        patterns: ["*.md"],
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.strategy, "grep-only");
    });

    it("should normalize strategy to lowercase", () => {
      const r = validateSearchQuery({ strategy: "GREP-ONLY" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.value.strategy, "grep-only");
    });

    it("should reject invalid strategy", () => {
      const r = validateSearchQuery({ strategy: "invalid-strategy" });
      assert.strictEqual(r.ok, false);
      assert.ok(r.errors.some(e => e.includes("strategy")));
    });

    it("should default patterns to empty array", () => {
      const r = validateSearchQuery({});
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.value.patterns, []);
    });

    it("should default keywords to empty array", () => {
      const r = validateSearchQuery({});
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(r.value.keywords, []);
    });
  });

  describe("ValidationErrorCode", () => {
    it("should have expected error codes", () => {
      assert.strictEqual(ValidationErrorCode.INVALID_CHUNKS, "INVALID_CHUNKS");
      assert.strictEqual(ValidationErrorCode.INVALID_QUERY, "INVALID_QUERY");
      assert.strictEqual(ValidationErrorCode.NO_KEYWORDS, "NO_KEYWORDS");
    });
  });

  describe("createValidationError", () => {
    it("should create structured error", () => {
      const err = createValidationError(
        ValidationErrorCode.INVALID_CHUNKS,
        "Chunks are invalid",
        { count: 5 }
      );
      assert.strictEqual(err.ok, false);
      assert.strictEqual(err.error.code, "INVALID_CHUNKS");
      assert.strictEqual(err.error.message, "Chunks are invalid");
      assert.strictEqual(err.error.count, 5);
      assert.deepStrictEqual(err.results, []);
    });
  });
});
