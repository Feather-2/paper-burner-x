import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { LRUCache, createAutoPruningCache } from '../../../../../js/agents/shared/utils/lru-cache.js';

describe("LRUCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tracks hits/misses and evicts least-recently-used entries", () => {
    const onEvict = vi.fn();
    const cache = new LRUCache({ maxSize: 2, onEvict });

    cache.set("a", 1);
    cache.set("b", 2);

    // Touch "a" so "b" becomes the LRU entry.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("b", 2);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.keys()).toEqual(["a", "c"]);
    expect(cache.values()).toEqual([1, 3]);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(stats.sets).toBe(3);
    expect(stats.hitRate).toBeCloseTo(0.5);
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(2);
  });

  it("set() on an existing key updates value and recency without growing the cache", () => {
    const cache = new LRUCache({ maxSize: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);

    expect(cache.size).toBe(2);
    // After updating "a", it becomes most recently used.
    expect(cache.keys()).toEqual(["b", "a"]);
    expect(cache.get("a")).toBe(10);
  });

  it("respects ttlMs in get()/has() and can prune expired entries", () => {
    const cache = new LRUCache({ maxSize: 10, ttlMs: 10 });

    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.has("a")).toBe(true);

    vi.advanceTimersByTime(11);

    // get() should delete expired entries and count as a miss.
    expect(cache.get("a")).toBeUndefined();
    // has() should also delete expired entries (but does not record misses).
    expect(cache.has("b")).toBe(false);

    cache.set("c", 3);
    vi.advanceTimersByTime(11);
    expect(cache.prune()).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("prune() is a no-op when ttl is disabled", () => {
    const cache = new LRUCache({ ttlMs: 0 });
    cache.set("a", 1);
    vi.advanceTimersByTime(1000);
    expect(cache.prune()).toBe(0);
    expect(cache.has("a")).toBe(true);
  });

  it("swallows errors thrown by onEvict callbacks", () => {
    const onEvict = vi.fn(() => {
      throw new Error("onEvict boom");
    });
    const cache = new LRUCache({ maxSize: 1, onEvict });

    cache.set("a", 1);
    expect(() => cache.set("b", 2)).not.toThrow();
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("a", 1);
  });

  it("has() does not update the LRU order", () => {
    const cache = new LRUCache({ maxSize: 2 });

    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.has("a")).toBe(true);

    // If has() updated LRU, "b" would be evicted; it should evict "a" instead.
    cache.set("c", 3);
    expect(cache.has("a")).toBe(false);
    expect(cache.keys()).toEqual(["b", "c"]);
  });

  it("supports getMany()/setMany() and preserves result insertion order", () => {
    const cache = new LRUCache({ maxSize: 3 });
    expect(cache.setMany([["a", 1], ["b", 2], ["c", 3]])).toBe(cache);

    const got = cache.getMany(["b", "missing", "a"]);
    expect([...got.entries()]).toEqual([["b", 2], ["a", 1]]);

    // LRU order after accesses: initial a,b,c -> after get(b): a,c,b -> after get(a): c,b,a
    expect(cache.keys()).toEqual(["c", "b", "a"]);
    expect(cache.values()).toEqual([3, 2, 1]);
  });

  it("resetStats() clears counters and hitRate handles zero-total case", () => {
    const cache = new LRUCache({ maxSize: 2 });
    expect(cache.getStats().hitRate).toBe(0);

    cache.set("a", 1);
    cache.get("a"); // hit
    cache.get("missing"); // miss
    expect(cache.getStats().hitRate).toBeCloseTo(0.5);

    cache.resetStats();
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
    expect(cache.getStats().evictions).toBe(0);
    expect(cache.getStats().sets).toBe(0);
    expect(cache.getStats().hitRate).toBe(0);
    expect(cache.getStats().size).toBe(1);
  });

  it("supports delete() and clear()", () => {
    const cache = new LRUCache({ maxSize: 5 });
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("missing")).toBe(false);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.keys()).toEqual([]);
  });
});

describe("createAutoPruningCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sets up an interval to call prune() and stop() cancels it", () => {
    const { cache, stop } = createAutoPruningCache({
      maxSize: 10,
      ttlMs: 10,
      pruneIntervalMs: 5,
    });

    const pruneSpy = vi.spyOn(cache, "prune");

    vi.advanceTimersByTime(5);
    expect(pruneSpy).toHaveBeenCalled();

    stop();
    const calls = pruneSpy.mock.calls.length;

    vi.advanceTimersByTime(20);
    expect(pruneSpy.mock.calls.length).toBe(calls);
  });
});
