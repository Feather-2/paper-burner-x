
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  normalizeMaxBytes,
  createResponseTooLargeError,
  readTextWithLimit,
  readJsonWithLimit,
} from "../../js/agents/shared/utils/response-limits.js";

describe("shared/utils/response-limits", () => {
  describe("normalizeMaxBytes", () => {
    it("returns Infinity for Infinity input", () => {
      expect(normalizeMaxBytes(Infinity, 1000)).toBe(Infinity);
    });

    it("returns valid positive number", () => {
      expect(normalizeMaxBytes(500, 1000)).toBe(500);
    });

    it("floors decimal values", () => {
      expect(normalizeMaxBytes(500.7, 1000)).toBe(500);
    });

    it("returns fallback for NaN", () => {
      expect(normalizeMaxBytes(NaN, 1000)).toBe(1000);
    });

    it("returns fallback for non-finite string", () => {
      expect(normalizeMaxBytes("invalid", 1000)).toBe(1000);
    });

    it("parses numeric string", () => {
      expect(normalizeMaxBytes("500", 1000)).toBe(500);
    });

    it("returns fallback for zero", () => {
      expect(normalizeMaxBytes(0, 1000)).toBe(1000);
    });

    it("returns fallback for negative", () => {
      expect(normalizeMaxBytes(-100, 1000)).toBe(1000);
    });
  });

  describe("createResponseTooLargeError", () => {
    it("creates error with message", () => {
      const err = createResponseTooLargeError("test", 100, 200);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain("exceeds limit");
      expect(err.message).toContain("200");
      expect(err.message).toContain("100");
    });

    it("sets error properties", () => {
      const err = createResponseTooLargeError("context", 100, 200);
      expect(err.name).toBe("ResponseTooLargeError");
      expect(err.code).toBe("ERESPONSE_TOO_LARGE");
      expect(err.maxBytes).toBe(100);
      expect(err.observedBytes).toBe(200);
    });

    it("uses custom code", () => {
      const err = createResponseTooLargeError("context", 100, 200, "CUSTOM_CODE");
      expect(err.code).toBe("CUSTOM_CODE");
    });

    it("uses default context for empty string", () => {
      const err = createResponseTooLargeError("", 100, 200);
      expect(err.message).toContain("Response body");
    });
  });

  describe("readTextWithLimit", () => {
    it("returns null for response without text method", async () => {
      const result = await readTextWithLimit({});
      expect(result).toBe(null);
    });

    it("reads text from response.text()", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      const result = await readTextWithLimit(mockResponse);
      expect(result).toBe("hello world");
    });

    it("throws when text exceeds limit", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      await expect(() => readTextWithLimit(mockResponse, { maxBytes: 5 }),
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
      await expect(() => readTextWithLimit(mockResponse, { maxBytes: 100 }),
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
      expect(result).toBe("hello");
    });

    it("handles headers.get throwing", async () => {
      const mockResponse = {
        headers: {
          get: () => { throw new Error("headers error"); },
        },
        text: async () => "hello",
      };
      const result = await readTextWithLimit(mockResponse);
      expect(result).toBe("hello");
    });

    it("handles null headers", async () => {
      const mockResponse = {
        headers: null,
        text: async () => "hello",
      };
      const result = await readTextWithLimit(mockResponse);
      expect(result).toBe("hello");
    });

    it("uses custom context in error", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      await expect(() => readTextWithLimit(mockResponse, { maxBytes: 5, context: "Custom Context" }),
        /Custom Context/
      );
    });

    it("uses custom code in error", async () => {
      const mockResponse = {
        text: async () => "hello world",
      };
      try {
        await readTextWithLimit(mockResponse, { maxBytes: 5, code: "CUSTOM" });
        throw new Error("Should have thrown" || 'Test failed');
      } catch (err) {
        expect(err.code).toBe("CUSTOM");
      }
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const mockResponse = {
        text: async () => "hello",
      };
      await expect(() => readTextWithLimit(mockResponse, { signal: controller.signal }),
        /abort/i
      );
    });

    it("handles Infinity maxBytes", async () => {
      const mockResponse = {
        text: async () => "x".repeat(10000),
      };
      const result = await readTextWithLimit(mockResponse, { maxBytes: Infinity });
      expect(result).toHaveLength(10000);
    });
  });

  describe("readJsonWithLimit", () => {
    it("parses JSON from response", async () => {
      const mockResponse = {
        text: async () => '{"key": "value"}',
      };
      const result = await readJsonWithLimit(mockResponse);
      expect(result).toEqual({ key: "value" });
    });

    it("throws for empty response", async () => {
      const mockResponse = {
        // No text method
      };
      await expect(() => readJsonWithLimit(mockResponse)).rejects.toThrow(/empty/
      );
    });

    it("throws for invalid JSON", async () => {
      const mockResponse = {
        text: async () => "not json",
      };
      await expect(() => readJsonWithLimit(mockResponse)).rejects.toThrow(/JSON/
      );
    });

    it("respects maxBytes limit", async () => {
      const mockResponse = {
        text: async () => '{"key": "value"}',
      };
      await expect(() => readJsonWithLimit(mockResponse, { maxBytes: 5 }),
        /exceeds limit/
      );
    });
  });
});
