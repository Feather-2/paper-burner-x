import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  LRUCache,
  createAutoPruningCache,
} from "../../js/agents/shared/utils/lru-cache.js";

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
        assert.ok(c);
        assert.equal(c.size, 0);
      });

      it("enforces minimum maxSize", () => {
        const c = new LRUCache({ maxSize: 0 });
        assert.ok(c._maxSize >= 1);
      });

      it("handles invalid maxSize", () => {
        const c = new LRUCache({ maxSize: NaN });
        assert.ok(c._maxSize >= 1);
      });

      it("handles negative ttlMs", () => {
        const c = new LRUCache({ ttlMs: -100 });
        assert.equal(c._ttlMs, 0);
      });
    });

    describe("set/get", () => {
      it("stores and retrieves value", () => {
        cache.set("a", 1);
        assert.equal(cache.get("a"), 1);
      });

      it("returns undefined for missing key", () => {
        assert.equal(cache.get("missing"), undefined);
      });

      it("updates existing key", () => {
        cache.set("a", 1);
        cache.set("a", 2);
        assert.equal(cache.get("a"), 2);
      });

      it("evicts oldest when full", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.set("d", 4);
        assert.equal(cache.get("a"), undefined);
        assert.equal(cache.get("d"), 4);
      });

      it("updates LRU order on get", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.get("a"); // Move "a" to end
        cache.set("d", 4);
        // "b" should be evicted, not "a"
        assert.equal(cache.get("a"), 1);
        assert.equal(cache.get("b"), undefined);
      });

      it("returns this from set", () => {
        const result = cache.set("a", 1);
        assert.equal(result, cache);
      });
    });

    describe("TTL", () => {
      it("expires entries after ttl", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        assert.equal(ttlCache.get("a"), 1);
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(ttlCache.get("a"), undefined);
      });

      it("has returns false for expired entry", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        assert.ok(ttlCache.has("a"));
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(ttlCache.has("a"), false);
      });
    });

    describe("has", () => {
      it("returns true for existing key", () => {
        cache.set("a", 1);
        assert.ok(cache.has("a"));
      });

      it("returns false for missing key", () => {
        assert.equal(cache.has("missing"), false);
      });
    });

    describe("delete", () => {
      it("removes entry", () => {
        cache.set("a", 1);
        cache.delete("a");
        assert.equal(cache.has("a"), false);
      });

      it("returns true when deleted", () => {
        cache.set("a", 1);
        assert.ok(cache.delete("a"));
      });

      it("returns false when not found", () => {
        assert.equal(cache.delete("missing"), false);
      });
    });

    describe("clear", () => {
      it("removes all entries", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.clear();
        assert.equal(cache.size, 0);
      });
    });

    describe("size", () => {
      it("returns current size", () => {
        assert.equal(cache.size, 0);
        cache.set("a", 1);
        assert.equal(cache.size, 1);
      });
    });

    describe("getStats", () => {
      it("returns stats", () => {
        cache.set("a", 1);
        cache.get("a");
        cache.get("missing");
        const stats = cache.getStats();
        assert.equal(stats.sets, 1);
        assert.equal(stats.hits, 1);
        assert.equal(stats.misses, 1);
        assert.equal(stats.hitRate, 0.5);
      });

      it("returns 0 hit rate when no accesses", () => {
        const stats = cache.getStats();
        assert.equal(stats.hitRate, 0);
      });

      it("tracks evictions", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3);
        cache.set("d", 4);
        const stats = cache.getStats();
        assert.equal(stats.evictions, 1);
      });
    });

    describe("resetStats", () => {
      it("resets all stats", () => {
        cache.set("a", 1);
        cache.get("a");
        cache.resetStats();
        const stats = cache.getStats();
        assert.equal(stats.hits, 0);
        assert.equal(stats.misses, 0);
        assert.equal(stats.sets, 0);
        assert.equal(stats.evictions, 0);
      });
    });

    describe("prune", () => {
      it("returns 0 when no TTL", () => {
        cache.set("a", 1);
        assert.equal(cache.prune(), 0);
      });

      it("removes expired entries", async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttlMs: 50 });
        ttlCache.set("a", 1);
        ttlCache.set("b", 2);
        await new Promise((r) => setTimeout(r, 60));
        const pruned = ttlCache.prune();
        assert.equal(pruned, 2);
        assert.equal(ttlCache.size, 0);
      });
    });

    describe("keys", () => {
      it("returns all keys", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const keys = cache.keys();
        assert.ok(keys.includes("a"));
        assert.ok(keys.includes("b"));
      });
    });

    describe("values", () => {
      it("returns all values", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const values = cache.values();
        assert.ok(values.includes(1));
        assert.ok(values.includes(2));
      });
    });

    describe("getMany", () => {
      it("returns map of found values", () => {
        cache.set("a", 1);
        cache.set("b", 2);
        const result = cache.getMany(["a", "b", "c"]);
        assert.equal(result.size, 2);
        assert.equal(result.get("a"), 1);
        assert.equal(result.get("b"), 2);
      });
    });

    describe("setMany", () => {
      it("sets multiple entries", () => {
        cache.setMany([
          ["a", 1],
          ["b", 2],
        ]);
        assert.equal(cache.get("a"), 1);
        assert.equal(cache.get("b"), 2);
      });

      it("returns this", () => {
        const result = cache.setMany([["a", 1]]);
        assert.equal(result, cache);
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
        assert.deepEqual(evicted, { key: "a", value: 1 });
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
        assert.equal(c.size, 2);
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
      assert.ok(cache instanceof LRUCache);
      assert.equal(typeof stop, "function");
      stop(); // Cleanup
    });

    it("creates with default options", () => {
      const { cache, stop } = createAutoPruningCache();
      assert.ok(cache);
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
      assert.ok(called);
      stop();
    });
  });
});
