import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/lru-cache.js", async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

import { LRUCache } from "../../../../../js/agents/shared/utils/lru-cache.js";

function createDeepObject(depth) {
  let value = { leaf: true };
  for (let i = 0; i < depth; i++) value = { nested: value };
  return value;
}

describe("LRUCache", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("uses sane defaults and initializes stats", () => {
      const cache = new LRUCache();

      expect(cache.size).toBe(0);
      expect(cache.getStats()).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        sets: 0,
        hitRate: 0,
        size: 0,
        maxSize: 100,
      });
    });

    it("sanitizes boundary inputs and ignores non-function onEvict", () => {
      const cache = new LRUCache({
        maxSize: -1,
        ttlMs: -1,
        // @ts-expect-error - intentional type boundary
        onEvict: "not-a-function",
      });

      expect(cache.getStats().maxSize).toBe(1);

      cache.set("a", 1);
      expect(() => cache.set("b", 2)).not.toThrow();
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);

      const stats = cache.getStats();
      expect(stats.sets).toBe(2);
      expect(stats.evictions).toBe(1);
    });

    it("parses numeric strings for maxSize/ttlMs", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({ maxSize: "2", ttlMs: "10" });

      expect(cache.getStats().maxSize).toBe(2);

      now.mockReturnValueOnce(0);
      cache.set("k", "v");

      now.mockReturnValueOnce(11);
      expect(cache.get("k")).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it("falls back for invalid numeric types (arrays/objects/whitespace)", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({
        // @ts-expect-error - intentional type boundary
        maxSize: [],
        // @ts-expect-error - intentional type boundary
        ttlMs: {},
      });

      expect(cache.getStats().maxSize).toBe(100);

      now.mockReturnValueOnce(0);
      cache.set("a", 1);

      cache.get("a");
      expect(now).toHaveBeenCalledTimes(1);
    });
  });

  describe("set()/get()", () => {
    it("stores and retrieves values for null/undefined/empty/whitespace and object keys/values", () => {
      const cache = new LRUCache({ maxSize: 50 });

      const emptyArrayKey = [];
      const emptyObjectKey = {};
      const deepObjectKey = { k: { nested: true } };

      const longString = "x".repeat(100_000);
      const deepValue = createDeepObject(200);
      const arrayValue = [];

      cache
        .set(null, "nullKey")
        .set(undefined, "undefinedKey")
        .set("", "emptyStringKey")
        .set("   ", "whitespaceKey")
        .set(0, "zeroKey")
        .set(-1, "negativeKey")
        .set(Number.MAX_SAFE_INTEGER, "maxSafeKey")
        .set(emptyArrayKey, longString)
        .set(emptyObjectKey, deepValue)
        .set(deepObjectKey, arrayValue);

      expect(cache.get(null)).toBe("nullKey");
      expect(cache.get(undefined)).toBe("undefinedKey");
      expect(cache.get("")).toBe("emptyStringKey");
      expect(cache.get("   ")).toBe("whitespaceKey");
      expect(cache.get(0)).toBe("zeroKey");
      expect(cache.get(-1)).toBe("negativeKey");
      expect(cache.get(Number.MAX_SAFE_INTEGER)).toBe("maxSafeKey");
      expect(cache.get(emptyArrayKey)).toBe(longString);
      expect(cache.get(emptyObjectKey)).toBe(deepValue);
      expect(cache.get(deepObjectKey)).toBe(arrayValue);
    });

    it("returns undefined on miss and increments misses", () => {
      const cache = new LRUCache();

      expect(cache.get("missing")).toBeUndefined();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(0);
    });

    it("treats a stored undefined value as a cache hit", () => {
      const cache = new LRUCache();

      cache.set("k", undefined);
      expect(cache.get("k")).toBeUndefined();

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(1);
    });

    it("evicts the least recently used entry and updates recency on get()", () => {
      const cache = new LRUCache({ maxSize: 2 });

      cache.set("a", 1).set("b", 2);
      expect(cache.get("a")).toBe(1);

      cache.set("c", 3);

      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("c")).toBe(true);

      expect(cache.getStats().evictions).toBe(1);
    });

    it("overwrites an existing key without counting as eviction and refreshes its recency", () => {
      const onEvict = vi.fn();
      const cache = new LRUCache({ maxSize: 2, onEvict });

      cache.set("a", 1).set("b", 2);
      cache.set("a", 3);
      cache.set("c", 4);

      expect(cache.get("a")).toBe(3);
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe(4);

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith("b", 2);
      expect(cache.getStats().evictions).toBe(1);
    });

    it("swallows errors thrown by onEvict callback", () => {
      const onEvict = vi.fn(() => {
        throw new Error("boom");
      });
      const cache = new LRUCache({ maxSize: 1, onEvict });

      cache.set("a", 1);
      expect(() => cache.set("b", 2)).not.toThrow();

      expect(onEvict).toHaveBeenCalledTimes(1);
      expect(onEvict).toHaveBeenCalledWith("a", 1);
      expect(cache.has("a")).toBe(false);
      expect(cache.get("b")).toBe(2);
      expect(cache.getStats().evictions).toBe(1);
    });
  });

  describe("TTL behavior", () => {
    it("expires entries when ttlMs is exceeded, but not when exactly equal", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({ ttlMs: 10 });

      now.mockReturnValueOnce(0);
      cache.set("a", 1);

      now.mockReturnValueOnce(10);
      expect(cache.get("a")).toBe(1);

      now.mockReturnValueOnce(11);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.size).toBe(0);

      const stats = cache.getStats();
      expect(stats.sets).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.evictions).toBe(0);
    });

    it("does not refresh TTL on get()", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({ ttlMs: 10 });

      now.mockReturnValueOnce(0);
      cache.set("k", "v");

      now.mockReturnValueOnce(9);
      expect(cache.get("k")).toBe("v");

      now.mockReturnValueOnce(11);
      expect(cache.get("k")).toBeUndefined();
    });

    it("refreshes TTL timestamp on set() overwrite", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({ ttlMs: 10 });

      now.mockReturnValueOnce(0);
      cache.set("k", "v1");

      now.mockReturnValueOnce(5);
      cache.set("k", "v2");

      now.mockReturnValueOnce(14);
      expect(cache.get("k")).toBe("v2");

      now.mockReturnValueOnce(16);
      expect(cache.get("k")).toBeUndefined();
    });

    it("has() deletes expired entries and does not affect hit/miss stats", () => {
      const now = vi.spyOn(Date, "now");
      const cache = new LRUCache({ ttlMs: 1 });

      now.mockReturnValueOnce(0);
      cache.set("a", 1);

      now.mockReturnValueOnce(2);
      expect(cache.has("a")).toBe(false);
      expect(cache.size).toBe(0);

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(1);
    });
  });

  describe("has()", () => {
    it("does not update LRU order", () => {
      const cache = new LRUCache({ maxSize: 2 });

      cache.set("a", 1).set("b", 2);
      expect(cache.has("a")).toBe(true);

      cache.set("c", 3);

      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(true);
      expect(cache.has("c")).toBe(true);
      expect(cache.getStats().evictions).toBe(1);
    });
  });

  describe("delete()/clear/size", () => {
    it("delete() removes entries and returns whether a key existed", () => {
      const cache = new LRUCache();

      cache.set("a", 1);
      expect(cache.size).toBe(1);

      expect(cache.delete("a")).toBe(true);
      expect(cache.delete("a")).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("clear() empties the cache without resetting stats", () => {
      const cache = new LRUCache();

      cache.set("a", 1).set("b", 2);
      cache.get("a");
      cache.get("missing");

      cache.clear();
      expect(cache.size).toBe(0);

      const stats = cache.getStats();
      expect(stats.sets).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe("getStats()", () => {
    it("computes hitRate from hits and misses and includes size/maxSize", () => {
      const cache = new LRUCache({ maxSize: 3 });

      cache.set("a", 1);
      cache.get("a"); // hit
      cache.get("b"); // miss
      cache.get("a"); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(3);
    });
  });

  describe("concurrency/rapid calls", () => {
    it("handles rapid microtask-driven writes without exceeding maxSize", async () => {
      const cache = new LRUCache({ maxSize: 50 });

      await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          Promise.resolve().then(() => cache.set(`k${i}`, i)),
        ),
      );

      expect(cache.size).toBe(50);
      expect(cache.has("k0")).toBe(false);
      expect(cache.has("k49")).toBe(false);
      expect(cache.has("k50")).toBe(true);
      expect(cache.get("k99")).toBe(99);
    });
  });
});