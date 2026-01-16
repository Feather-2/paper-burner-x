
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  estimateTokensCached,
  clearTokenCache,
  getTokenCacheStats,
} from "../../js/agents/shared/utils/token-cache.js";

describe("shared/utils/token-cache", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  describe("estimateTokensCached", () => {
    it("returns 0 for empty string", () => {
      expect(estimateTokensCached("")).toBe(0);
    });

    it("returns 0 for null", () => {
      expect(estimateTokensCached(null)).toBe(0);
    });

    it("returns 0 for undefined", () => {
      expect(estimateTokensCached(undefined)).toBe(0);
    });

    it("returns 0 for non-string", () => {
      expect(estimateTokensCached(123)).toBe(0);
    });

    it("estimates tokens for simple text", () => {
      const count = estimateTokensCached("Hello world");
      expect(count > 0).toBeTruthy();
    });

    it("caches repeated calls", () => {
      const text = "This is a test message";
      const first = estimateTokensCached(text);
      const second = estimateTokensCached(text);

      expect(first).toBe(second);

      const stats = getTokenCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it("uses custom tokenCounter when provided", () => {
      const mockCounter = {
        count: (text) => text.split(" ").length,
      };

      const count = estimateTokensCached("one two three", mockCounter);
      expect(count).toBe(3);
    });

    it("falls back when tokenCounter throws", () => {
      const badCounter = {
        count: () => { throw new Error("fail"); },
      };

      const count = estimateTokensCached("test text", badCounter);
      expect(count > 0).toBeTruthy();
    });

    it("falls back when tokenCounter returns invalid", () => {
      const badCounter = {
        count: () => "not a number",
      };

      const count = estimateTokensCached("test text", badCounter);
      expect(count > 0).toBeTruthy();
    });

    it("falls back when tokenCounter returns negative", () => {
      const badCounter = {
        count: () => -5,
      };

      const count = estimateTokensCached("test text", badCounter);
      expect(count > 0).toBeTruthy();
    });

    it("handles long strings with hash key", () => {
      const longText = "x".repeat(200);
      const count = estimateTokensCached(longText);
      expect(count > 0).toBeTruthy();

      // Second call should hit cache
      const count2 = estimateTokensCached(longText);
      expect(count).toBe(count2);
    });

    it("evicts oldest entry when cache is full", () => {
      // This is hard to test directly without exposing internals
      // Just verify it doesn't throw
      for (let i = 0; i < 100; i++) {
        estimateTokensCached(`unique text ${i}`);
      }

      const stats = getTokenCacheStats();
      expect(stats.size > 0).toBeTruthy();
    });
  });

  describe("clearTokenCache", () => {
    it("clears cache and resets counters", () => {
      estimateTokensCached("test");
      estimateTokensCached("test");

      clearTokenCache();

      const stats = getTokenCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe("getTokenCacheStats", () => {
    it("returns initial stats", () => {
      const stats = getTokenCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("includes maxSize", () => {
      const stats = getTokenCacheStats();
      expect(stats.maxSize > 0).toBeTruthy();
    });

    it("tracks hit rate", () => {
      estimateTokensCached("test");
      estimateTokensCached("test");
      estimateTokensCached("test");

      const stats = getTokenCacheStats();
      // 1 miss, 2 hits = 66.67% hit rate
      expect(stats.hitRate > 0.5).toBeTruthy();
    });
  });
});
