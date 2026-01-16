import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMaxBytes,
  createResponseTooLargeError,
  readTextWithLimit,
  readJsonWithLimit,
} from "../../js/agents/shared/utils/response-limits.js";

describe("shared/utils/response-limits", () => {
  describe("normalizeMaxBytes", () => {
    it("returns Infinity for Infinity input", () => {
      assert.equal(normalizeMaxBytes(Infinity, 1000), Infinity);
    });

    it("returns valid positive number", () => {
      assert.equal(normalizeMaxBytes(500, 1000), 500);
    });

    it("floors decimal values", () => {
      assert.equal(normalizeMaxBytes(500.7, 1000), 500);
    });

    it("returns fallback for NaN", () => {
      assert.equal(normalizeMaxBytes(NaN, 1000), 1000);
    });

    it("returns fallback for non-finite string", () => {
      assert.equal(normalizeMaxBytes("invalid", 1000), 1000);
    });

    it("parses numeric string", () => {
      assert.equal(normalizeMaxBytes("500", 1000), 500);
    });

    it("returns fallback for zero", () => {
      assert.equal(normalizeMaxBytes(0, 1000), 1000);
    });

    it("returns fallback for negative", () => {
      assert.equal(normalizeMaxBytes(-100, 1000), 1000);
    });
  });

  describe("createResponseTooLargeError", () => {
    it("creates error with message", () => {
      const err = createResponseTooLargeError("test", 100, 200);
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("exceeds limit"));
      assert.ok(err.message.includes("200"));
      assert.ok(err.message.includes("100"));
    });

    it("sets error properties", () => {
      const err = createResponseTooLargeError("context", 100, 200);
      assert.equal(err.name, "ResponseTooLargeError");
      assert.equal(err.code, "ERESPONSE_TOO_LARGE");
      assert.equal(err.maxBytes, 100);
      assert.equal(err.observedBytes, 200);
    });

    it("uses custom code", () => {
      const err = createResponseTooLargeError("context", 100, 200, "CUSTOM_CODE");
      assert.equal(err.code, "CUSTOM_CODE");
    });

    it("uses default context for empty string", () => {
      const err = createResponseTooLargeError("", 100, 200);
      assert.ok(err.message.includes("Response body"));
    });
  });

  describe("readTextWithLimit", () => {
    it("returns null for response without text method", async () => {
      const result = await readTextWithLimit({});
      assert.equal(result, null);
    });

    it("reads text from response.text()", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      const result = await readTextWithLimit(mockResponse);
      assert.equal(result, "hello world");
    });

    it("throws when text exceeds limit", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      await assert.rejects(
        () => readTextWithLimit(mockResponse, { maxBytes: 5 }),
        /exceeds limit/
      );
    });

    it("throws when content-length header exceeds limit", async () => {
      const mockResponse = {
        headers: {
          get: (name) => (name === "content-length" ? "1000" : null),
        },
        text: async () => "x".repeat(1000),
      };
      await assert.rejects(
        () => readTextWithLimit(mockResponse, { maxBytes: 100 }),
        /exceeds limit/
      );
    });

    it("passes with content-length under limit", async () => {
      const mockResponse = {
        headers: {
          get: (name) => (name === "content-length" ? "10" : null),
        },
        text: async () => "hello",
      };
      const result = await readTextWithLimit(mockResponse, { maxBytes: 100 });
      assert.equal(result, "hello");
    });

    it("handles headers.get throwing", async () => {
      const mockResponse = {
        headers: {
          get: () => { throw new Error("headers error"); },
        },
        text: async () => "hello",
      };
      const result = await readTextWithLimit(mockResponse);
      assert.equal(result, "hello");
    });

    it("handles null headers", async () => {
      const mockResponse = {
        headers: null,
        text: async () => "hello",
      };
      const result = await readTextWithLimit(mockResponse);
      assert.equal(result, "hello");
    });

    it("uses custom context in error", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      await assert.rejects(
        () => readTextWithLimit(mockResponse, { maxBytes: 5, context: "Custom Context" }),
        /Custom Context/
      );
    });

    it("uses custom code in error", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      try {
        await readTextWithLimit(mockResponse, { maxBytes: 5, code: "CUSTOM" });
        assert.fail("Should have thrown");
      } catch (err) {
        assert.equal(err.code, "CUSTOM");
      }
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const mockResponse = {
        text: async () => "hello",
      };
      await assert.rejects(
        () => readTextWithLimit(mockResponse, { signal: controller.signal }),
        /abort/i
      );
    });

    it("handles Infinity maxBytes", async () => {
      const mockResponse = {
        text: async () => "x".repeat(10000),
      };
      const result = await readTextWithLimit(mockResponse, { maxBytes: Infinity });
      assert.ok(result.length === 10000);
    });
  });

  describe("readJsonWithLimit", () => {
    it("parses JSON from response", async () => {
      const mockResponse = {
        text: async () => '{"key": "value"}',
      };
      const result = await readJsonWithLimit(mockResponse);
      assert.deepEqual(result, { key: "value" });
    });

    it("throws for empty response", async () => {
      const mockResponse = {
        // No text method
      };
      await assert.rejects(
        () => readJsonWithLimit(mockResponse),
        /empty/
      );
    });

    it("throws for invalid JSON", async () => {
      const mockResponse = {
        text: async () => "not json",
      };
      await assert.rejects(
        () => readJsonWithLimit(mockResponse),
        /JSON/
      );
    });

    it("respects maxBytes limit", async () => {
      const mockResponse = {
        text: async () => '{"key": "value"}',
      };
      await assert.rejects(
        () => readJsonWithLimit(mockResponse, { maxBytes: 5 }),
        /exceeds limit/
      );
    });
  });
});
