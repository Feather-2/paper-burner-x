import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setInterval as mockedSetInterval, clearInterval as mockedClearInterval } from "node:timers";

import LRUCacheDefault, {
  LRUCache,
  createAutoPruningCache,
} from "../../../../../js/agents/shared/utils/lru-cache.js";

vi.mock("node:timers", () => ({
  setInterval: vi.fn((fn, ms) => ({ fn, ms })),
  clearInterval: vi.fn(),
}));

describe("LRUCache", () => {
  /** @type {LRUCache<string, number>} */
  let cache;

  beforeEach(() => {
    cache = new LRUCache({ maxSize: 3 });
    vi.clearAllMocks();
  });

  it("exports LRUCache as default", () => {
    expect(LRUCacheDefault).toBe(LRUCache);
  });

  describe("constructor", () => {
    it("normalizes maxSize boundary values", () => {
      const zero = new LRUCache({ maxSize: 0 });
      const negative = new LRUCache({ maxSize: -1 });
      const huge = new LRUCache({ maxSize: Number.MAX_SAFE_INTEGER });

      expect(zero.getStats().maxSize).toBe(100);
      expect(negative.getStats().maxSize).toBe(1);
      expect(huge.getStats().maxSize).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("accepts numeric strings for maxSize", () => {
      const stringSize = new LRUCache({ maxSize: "2" });
      stringSize.set("a", 1);
      stringSize.set("b", 2);
      stringSize.set("c", 3);
      expect(stringSize.has("a")).toBe(false);
      expect(stringSize.size).toBe(2);
    });
  });

  describe("set/get", () => {
    it("stores and retrieves values including nullish and empty keys/values", () => {
      const edgeCache = new LRUCache({ maxSize: 20 });

      const emptyArrayKey = [];
      const emptyObjectKey = {};

      const emptyArrayValue = [];
      const emptyObjectValue = {};

      edgeCache.set(null, "null-key");
      edgeCache.set(undefined, "undefined-key");
      edgeCache.set("", "empty-string-key");
      edgeCache.set("   ", "whitespace-key");
      edgeCache.set(emptyArrayKey, "empty-array-key");
      edgeCache.set(emptyObjectKey, "empty-object-key");
      edgeCache.set("emptyArrayValue", emptyArrayValue);
      edgeCache.set("emptyObjectValue", emptyObjectValue);
      edgeCache.set("undefinedValue", undefined);

      expect(edgeCache.get(null)).toBe("null-key");
      expect(edgeCache.get(undefined)).toBe("undefined-key");
      expect(edgeCache.get("")).toBe("empty-string-key");
      expect(edgeCache.get("   ")).toBe("whitespace-key");
      expect(edgeCache.get(emptyArrayKey)).toBe("empty-array-key");
      expect(edgeCache.get(emptyObjectKey)).toBe("empty-object-key");
      expect(edgeCache.get("emptyArrayValue")).toBe(emptyArrayValue);
      expect(edgeCache.get("emptyObjectValue")).toBe(emptyObjectValue);
      expect(edgeCache.get("undefinedValue")).toBeUndefined();
      expect(edgeCache.has("undefinedValue")).toBe(true);
    });

    it("handles numeric boundary values as values", () => {
      cache.set("zero", 0);
      cache.set("negative", -1);
      cache.set("max", Number.MAX_SAFE_INTEGER);

      expect(cache.get("zero")).toBe(0);
      expect(cache.get("negative")).toBe(-1);
      expect(cache.get("max")).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("evicts least recently used entry and updates LRU order on get", () => {
      const lru = new LRUCache({ maxSize: 2 });
      lru.set("a", 1);
      lru.set("b", 2);

      expect(lru.get("a")).toBe(1);
      lru.set("c", 3);

      expect(lru.get("b")).toBeUndefined();
      expect(lru.keys()).toEqual(["a", "c"]);
    });

    it("does not update LRU order on has", () => {
      const lru = new LRUCache({ maxSize: 2 });
      lru.set("a", 1);
      lru.set("b", 2);

      expect(lru.has("a")).toBe(true);
      lru.set("c", 3);

      expect(lru.has("a")).toBe(false);
      expect(lru.keys()).toEqual(["b", "c"]);
    });

    it("returns this from set", () => {
      expect(cache.set("a", 1)).toBe(cache);
    });
  });

  describe("stats", () => {
    it("tracks hits, misses, sets, and hitRate", () => {
      cache.set("a", 1);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("missing")).toBeUndefined();

      const stats = cache.getStats();
      expect(stats.sets).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(3);
    });

    it("tracks evictions when maxSize is exceeded", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      cache.set("d", 4);

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
      expect(cache.size).toBe(3);
    });

    it("resets stats", () => {
      cache.set("a", 1);
      cache.get("a");
      cache.get("missing");
      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
      expect(stats.evictions).toBe(0);
    });
  });

  describe("TTL and prune", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("expires entries after ttl and records misses", () => {
      const ttlCache = new LRUCache({ maxSize: 5, ttlMs: 100 });
      ttlCache.set("a", 1);

      vi.advanceTimersByTime(101);

      expect(ttlCache.get("a")).toBeUndefined();
      const stats = ttlCache.getStats();
      expect(stats.misses).toBe(1);
      expect(ttlCache.size).toBe(0);
    });

    it("treats numeric string ttlMs as milliseconds", () => {
      const ttlCache = new LRUCache({ maxSize: 5, ttlMs: "10" });
      ttlCache.set("a", 1);

      vi.advanceTimersByTime(9);
      expect(ttlCache.has("a")).toBe(true);

      vi.advanceTimersByTime(2);
      expect(ttlCache.has("a")).toBe(false);
    });

    it("does not expire when ttlMs is zero or negative", () => {
      const noTtlCache = new LRUCache({ maxSize: 2, ttlMs: 0 });
      const negativeTtlCache = new LRUCache({ maxSize: 2, ttlMs: -1 });

      noTtlCache.set("a", 1);
      negativeTtlCache.set("b", 2);

      vi.advanceTimersByTime(1000);

      expect(noTtlCache.get("a")).toBe(1);
      expect(negativeTtlCache.get("b")).toBe(2);
      expect(noTtlCache.prune()).toBe(0);
      expect(negativeTtlCache.prune()).toBe(0);
    });

    it("prunes only expired entries", () => {
      const ttlCache = new LRUCache({ maxSize: 5, ttlMs: 50 });
      ttlCache.set("a", 1);
      ttlCache.set("b", 2);

      vi.advanceTimersByTime(40);
      ttlCache.set("c", 3);

      vi.advanceTimersByTime(20);

      const pruned = ttlCache.prune();
      expect(pruned).toBe(2);
      expect(ttlCache.has("a")).toBe(false);
      expect(ttlCache.has("b")).toBe(false);
      expect(ttlCache.has("c")).toBe(true);
    });
  });

  describe("getMany/setMany", () => {
    it("returns a map for found keys and handles empty input", () => {
      cache.set("a", 1);
      cache.set("b", 2);

      const result = cache.getMany(["a", "b", "missing"]);
      expect(result.size).toBe(2);
      expect(result.get("a")).toBe(1);
      expect(result.get("b")).toBe(2);

      const empty = cache.getMany([]);
      expect(empty.size).toBe(0);
    });

    it("sets multiple entries from iterable and returns this", () => {
      const entries = new Map([
        ["a", 1],
        ["b", 2],
      ]);
      expect(cache.setMany(entries)).toBe(cache);
      expect(cache.get("a")).toBe(1);
      expect(cache.get("b")).toBe(2);

      const emptyResult = cache.setMany([]);
      expect(emptyResult).toBe(cache);
      expect(cache.size).toBe(2);
    });

    it("throws when non-iterables are passed as array-like inputs", () => {
      expect(() => cache.getMany({})).toThrow(TypeError);
      expect(() => cache.setMany({})).toThrow(TypeError);
    });
  });

  describe("keys/values", () => {
    it("returns keys and values in LRU order", () => {
      const lru = new LRUCache({ maxSize: 3 });
      lru.set("a", 1);
      lru.set("b", 2);
      lru.set("c", 3);

      lru.get("a");

      expect(lru.keys()).toEqual(["b", "c", "a"]);
      expect(lru.values()).toEqual([2, 3, 1]);
    });
  });

  describe("delete/clear/size", () => {
    it("deletes entries and reports size", () => {
      cache.set("a", 1);
      expect(cache.size).toBe(1);
      expect(cache.delete("a")).toBe(true);
      expect(cache.delete("a")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("clears all entries", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe("resource boundaries", () => {
    it("stores large values and deep structures", () => {
      const resourceCache = new LRUCache({ maxSize: 5 });

      const largeBuffer = Buffer.alloc(1024 * 1024);
      const longString = "x".repeat(100000);
      const deepObject = {};
      let node = deepObject;
      for (let i = 0; i < 100; i += 1) {
        node.next = {};
        node = node.next;
      }

      resourceCache.set("file", largeBuffer);
      resourceCache.set("long", longString);
      resourceCache.set("deep", deepObject);

      expect(resourceCache.get("file")).toBe(largeBuffer);
      expect(resourceCache.get("long")).toBe(longString);
      expect(resourceCache.get("deep")).toBe(deepObject);
    });
  });

  describe("concurrency", () => {
    it("handles simultaneous updates without exceeding maxSize", async () => {
      const concurrent = new LRUCache({ maxSize: 10 });
      const keys = ["a", "b", "c", "d", "e"];

      await Promise.all(
        keys.map((key, index) =>
          Promise.resolve().then(() => concurrent.set(key, index)),
        ),
      );

      expect(concurrent.size).toBe(keys.length);
      keys.forEach((key, index) => {
        expect(concurrent.get(key)).toBe(index);
      });
    });

    it("handles rapid consecutive updates to the same key", () => {
      const rapid = new LRUCache({ maxSize: 2 });

      for (let i = 0; i < 50; i += 1) {
        rapid.set("key", i);
      }

      expect(rapid.size).toBe(1);
      expect(rapid.get("key")).toBe(49);
      expect(rapid.getStats().sets).toBe(50);
    });
  });

  describe("onEvict callback", () => {
    it("calls onEvict with key and value", () => {
      const onEvict = vi.fn();
      const evicting = new LRUCache({ maxSize: 1, onEvict });

      evicting.set("a", 1);
      evicting.set("b", 2);

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith("a", 1);
    });

    it("swallows errors from onEvict", () => {
      const onEvict = vi.fn(() => {
        throw new Error("boom");
      });
      const evicting = new LRUCache({ maxSize: 1, onEvict });

      expect(() => {
        evicting.set("a", 1);
        evicting.set("b", 2);
      }).not.toThrow();

      expect(evicting.size).toBe(1);
    });
  });
});

describe("createAutoPruningCache", () => {
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    vi.clearAllMocks();
    originalSetInterval = globalThis.setInterval;
    originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = mockedSetInterval;
    globalThis.clearInterval = mockedClearInterval;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  it("creates cache and schedules pruning", () => {
    const { cache, stop } = createAutoPruningCache({
      maxSize: 2,
      ttlMs: 10,
      pruneIntervalMs: 123,
    });

    expect(cache).toBeInstanceOf(LRUCache);
    expect(mockedSetInterval).toHaveBeenCalledTimes(1);
    const [callback, intervalMs] = mockedSetInterval.mock.calls[0];
    expect(intervalMs).toBe(123);

    const pruneSpy = vi.spyOn(cache, "prune");
    callback();
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    stop();
    expect(mockedClearInterval).toHaveBeenCalledWith(
      mockedSetInterval.mock.results[0].value,
    );
  });

  it("passes onEvict to the underlying cache", () => {
    const onEvict = vi.fn();
    const { cache, stop } = createAutoPruningCache({
      maxSize: 1,
      onEvict,
    });

    cache.set("a", 1);
    cache.set("b", 2);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("a", 1);
    stop();
  });
});
