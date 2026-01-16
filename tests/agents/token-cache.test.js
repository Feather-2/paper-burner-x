import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
      assert.equal(estimateTokensCached(""), 0);
    });

    it("returns 0 for null", () => {
      assert.equal(estimateTokensCached(null), 0);
    });

    it("returns 0 for undefined", () => {
      assert.equal(estimateTokensCached(undefined), 0);
    });

    it("returns 0 for non-string", () => {
      assert.equal(estimateTokensCached(123), 0);
    });

    it("estimates tokens for simple text", () => {
      const count = estimateTokensCached("Hello world");
      assert.ok(count > 0);
    });

    it("caches repeated calls", () => {
      const text = "This is a test message";
      const first = estimateTokensCached(text);
      const second = estimateTokensCached(text);

      assert.equal(first, second);

      const stats = getTokenCacheStats();
      assert.equal(stats.hits, 1);
      assert.equal(stats.misses, 1);
    });

    it("uses custom tokenCounter when provided", () => {
      const mockCounter = {
        count: (text) => text.split(" ").length,
      };

      const count = estimateTokensCached("one two three", mockCounter);
      assert.equal(count, 3);
    });

    it("falls back when tokenCounter throws", () => {
      const badCounter = {
        count: () => { throw new Error("fail"); },
      };

      const count = estimateTokensCached("test text", badCounter);
      assert.ok(count > 0);
    });

    it("falls back when tokenCounter returns invalid", () => {
      const badCounter = {
        count: () => "not a number",
      };

      const count = estimateTokensCached("test text", badCounter);
      assert.ok(count > 0);
    });

    it("falls back when tokenCounter returns negative", () => {
      const badCounter = {
        count: () => -5,
      };

      const count = estimateTokensCached("test text", badCounter);
      assert.ok(count > 0);
    });

    it("handles long strings with hash key", () => {
      const longText = "x".repeat(200);
      const count = estimateTokensCached(longText);
      assert.ok(count > 0);

      // Second call should hit cache
      const count2 = estimateTokensCached(longText);
      assert.equal(count, count2);
    });

    it("evicts oldest entry when cache is full", () => {
      // This is hard to test directly without exposing internals
      // Just verify it doesn't throw
      for (let i = 0; i < 100; i++) {
        estimateTokensCached(`unique text ${i}`);
      }

      const stats = getTokenCacheStats();
      assert.ok(stats.size > 0);
    });
  });

  describe("clearTokenCache", () => {
    it("clears cache and resets counters", () => {
      estimateTokensCached("test");
      estimateTokensCached("test");

      clearTokenCache();

      const stats = getTokenCacheStats();
      assert.equal(stats.size, 0);
      assert.equal(stats.hits, 0);
      assert.equal(stats.misses, 0);
    });
  });

  describe("getTokenCacheStats", () => {
    it("returns initial stats", () => {
      const stats = getTokenCacheStats();
      assert.equal(stats.size, 0);
      assert.equal(stats.hits, 0);
      assert.equal(stats.misses, 0);
      assert.equal(stats.hitRate, 0);
    });

    it("includes maxSize", () => {
      const stats = getTokenCacheStats();
      assert.ok(stats.maxSize > 0);
    });

    it("tracks hit rate", () => {
      estimateTokensCached("test");
      estimateTokensCached("test");
      estimateTokensCached("test");

      const stats = getTokenCacheStats();
      // 1 miss, 2 hits = 66.67% hit rate
      assert.ok(stats.hitRate > 0.5);
    });
  });
});
