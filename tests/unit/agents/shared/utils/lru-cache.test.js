
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  LRUCache,
  createAutoPruningCache,
} from "../../../../../js/agents/shared/utils/lru-cache.js";

describe("shared/utils/lru-cache", () => {
  describe("LRUCache", () => {
    /** @type {LRUCache<string, number>} */
    let cache;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 3 });
    });

    describe("constructor", () => {
      it("creates with default options", () => {
        const c = new LRUCache();
        expect(c).toBeInstanceOf(LRUCache);
        expect(c.size).toBe(0);
      });

      it("enforces minimum maxSize", () => {
        const c = new LRUCache({ maxSize: 0 });
        expect(c._maxSize).toBeGreaterThanOrEqual(1);
      });

      it("handles invalid maxSize", () => {
        const c = new LRUCache({ maxSize: NaN });
        expect(c._maxSize).toBeGreaterThanOrEqual(1);
      });

      it("handles negative ttlMs", () => {
        const c = new LRUCache({ ttlMs: -100 });
        expect(c._ttlMs).toBe(0);
      });
    });

    describe("set/get", () => {
      it("stores and retrieves value", () => {
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
      });

      it("returns undefined for missing key", () => {
        expect(cache.get("missing")).toBe(undefined);
      });

      it("updates existing key", () => {
        cache.set("a", 1);
        cache.set("a", 2);
        expect(cache.get("a")).toBe(2);
      });

      it("evicts oldest when full", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.set("d", 4);
        expect(cache.get("a")).toBe(undefined);
        expect(cache.get("d")).toBe(4);
      });

      it("updates LRU order on get", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.get("a"); // Move "a" to end
        cache.set("d", 4);
        // "b" should be evicted, not "a"
        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBe(undefined);
      });

      it("returns this from set", () => {
        const result = cache.set("a", 1);
        expect(result).toBe(cache);
      });
    });

    describe("TTL", () => {
      it("expires entries after ttl", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        expect(ttlCache.get("a")).toBe(1);
        await new Promise((r) => setTimeout(r, 60));
        expect(ttlCache.get("a")).toBe(undefined);
      });

      it("has returns false for expired entry", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        expect(ttlCache.has("a")).toBe(true);
        await new Promise((r) => setTimeout(r, 60));
        expect(ttlCache.has("a")).toBe(false);
      });
    });

    describe("has", () => {
      it("returns true for existing key", () => {
        cache.set("a", 1);
        expect(cache.has("a")).toBe(true);
      });

      it("returns false for missing key", () => {
        expect(cache.has("missing")).toBe(false);
      });
    });

    describe("delete", () => {
      it("removes entry", () => {
        cache.set("a", 1);
        cache.delete("a");
        expect(cache.has("a")).toBe(false);
      });

      it("returns true when deleted", () => {
        cache.set("a", 1);
        expect(cache.delete("a")).toBe(true);
      });

      it("returns false when not found", () => {
        expect(cache.delete("missing")).toBe(false);
      });
    });

    describe("clear", () => {
      it("removes all entries", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.clear();
        expect(cache.size).toBe(0);
      });
    });

    describe("size", () => {
      it("returns current size", () => {
        expect(cache.size).toBe(0);
        cache.set("a", 1);
        expect(cache.size).toBe(1);
      });
    });

    describe("getStats", () => {
      it("returns stats", () => {
        cache.set("a", 1);
        cache.get("a");
        cache.get("missing");
        const stats = cache.getStats();
        expect(stats.sets).toBe(1);
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe(0.5);
      });

      it("returns 0 hit rate when no accesses", () => {
        const stats = cache.getStats();
        expect(stats.hitRate).toBe(0);
      });

      it("tracks evictions", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.set("d", 4);
        const stats = cache.getStats();
        expect(stats.evictions).toBe(1);
      });
    });

    describe("resetStats", () => {
      it("resets all stats", () => {
        cache.set("a", 1);
        cache.get("a");
        cache.resetStats();
        const stats = cache.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.sets).toBe(0);
        expect(stats.evictions).toBe(0);
      });
    });

    describe("prune", () => {
      it("returns 0 when no TTL", () => {
        cache.set("a", 1);
        expect(cache.prune()).toBe(0);
      });

      it("removes expired entries", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        ttlCache.set("b", 2);
        await new Promise((r) => setTimeout(r, 60));
        const pruned = ttlCache.prune();
        expect(pruned).toBe(2);
        expect(ttlCache.size).toBe(0);
      });
    });

    describe("keys", () => {
      it("returns all keys", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const keys = cache.keys();
        expect(keys).toContain("a");
        expect(keys).toContain("b");
      });
    });

    describe("values", () => {
      it("returns all values", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const values = cache.values();
        expect(values).toContain(1);
        expect(values).toContain(2);
      });
    });

    describe("getMany", () => {
      it("returns map of found values", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const result = cache.getMany(["a", "b", "c"]);
        expect(result.size).toBe(2);
        expect(result.get("a")).toBe(1);
        expect(result.get("b")).toBe(2);
      });
    });

    describe("setMany", () => {
      it("sets multiple entries", () => {
        cache.setMany([
          ["a", 1],
          ["b", 2],
        ]);
        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBe(2);
      });

      it("returns this", () => {
        const result = cache.setMany([["a", 1]]);
        expect(result).toBe(cache);
      });
    });

    describe("onEvict callback", () => {
      it("calls onEvict when evicting", () => {
        let evicted = null;
        const c = new LRUCache({
          maxSize: 2,
          onEvict: (key, value) => {
            evicted = { key, value };
          },
        });
        c.set("a", 1);
        c.set("b", 2);
        c.set("c", 3);
        expect(evicted).toEqual({ key: "a", value: 1 });
      });

      it("handles onEvict error gracefully", () => {
        const c = new LRUCache({
          maxSize: 2,
          onEvict: () => {
            throw new Error("callback error");
          },
        });
        c.set("a", 1);
        c.set("b", 2);
        c.set("c", 3); // Should not throw
        expect(c.size).toBe(2);
      });
    });
  });

  describe("createAutoPruningCache", () => {
    it("creates cache and stop function", () => {
      const { cache, stop } = createAutoPruningCache({
        maxSize: 10,
        ttlMs: 1000,
        pruneIntervalMs: 100,
      });
      expect(cache).toBeInstanceOf(LRUCache);
      expect(typeof stop).toBe("function");
      stop(); // Cleanup
    });

    it("creates with default options", () => {
      const { cache, stop } = createAutoPruningCache();
      expect(cache).toBeInstanceOf(LRUCache);
      stop();
    });

    it("passes onEvict to cache", () => {
      let called = false;
      const { cache, stop } = createAutoPruningCache({
        maxSize: 2,
        onEvict: () => {
          called = true;
        },
      });
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      expect(called).toBe(true);
      stop();
    });
  });
});
