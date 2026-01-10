/**
 * @file tests/utils/performance-helpers.test.js
 * @description js/utils/performance-helpers.js 单元测试
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PerformanceHelpers } from "../../js/utils/performance-helpers.js";

const BASE_TIME = new Date("2024-01-01T00:00:00.000Z");

describe("js/utils/performance-helpers.js", () => {
  describe("debounce", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE_TIME);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("delays execution until after the delay", () => {
      const fn = vi.fn();
      const debounced = PerformanceHelpers.debounce(fn, 100);

      debounced("a");

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("a");
    });

    it("resets the timer when called repeatedly", () => {
      const fn = vi.fn();
      const debounced = PerformanceHelpers.debounce(fn, 100);

      debounced("a");
      vi.advanceTimersByTime(50);
      debounced("b");

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
    });

    it("preserves the this context from the last call", () => {
      let receivedThis;
      const fn = vi.fn(function () {
        receivedThis = this;
      });

      const debounced = PerformanceHelpers.debounce(fn, 100);
      const context = { value: 123 };

      debounced.call(context);
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(receivedThis).toBe(context);
    });
  });

  describe("throttle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE_TIME);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("runs at most once per interval when trailing is disabled", () => {
      const fn = vi.fn();
      const throttled = PerformanceHelpers.throttle(fn, 100, { trailing: false });

      throttled("a"); // t=0 -> leading edge
      throttled("b"); // t=0 -> ignored
      vi.advanceTimersByTime(50);
      throttled("c"); // t=50 -> ignored

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("a");

      vi.advanceTimersByTime(50); // t=100
      throttled("d"); // allowed again

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith("d");
    });

    it("supports leading: false (trailing call only)", () => {
      const fn = vi.fn();
      const throttled = PerformanceHelpers.throttle(fn, 100, {
        leading: false,
        trailing: true,
      });

      throttled("a"); // scheduled
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      throttled("b"); // rescheduled with latest args
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(49);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
    });

    it("supports trailing: true after a burst (default leading + trailing)", () => {
      const fn = vi.fn();
      const throttled = PerformanceHelpers.throttle(fn, 100);

      throttled("a"); // leading edge
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("a");

      vi.advanceTimersByTime(10);
      throttled("b");
      throttled("c"); // last call should win

      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(90);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith("c");
    });
  });

  describe("createLRUCache", () => {
    it("supports get/set and reports stats", () => {
      const cache = PerformanceHelpers.createLRUCache(2);

      expect(cache.size).toBe(0);
      expect(cache.getStats()).toEqual({
        size: 0,
        maxSize: 2,
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        hitRate: 0,
        hitRatePercent: "0%",
      });

      cache.set("a", 1);
      cache.set("b", 2);

      expect(cache.get("a")).toBe(1);
      expect(cache.get("missing")).toBeUndefined();

      expect(cache.getStats()).toEqual({
        size: 2,
        maxSize: 2,
        hits: 1,
        misses: 1,
        sets: 2,
        evictions: 0,
        hitRate: 0.5,
        hitRatePercent: "50.00%",
      });
    });

    it("evicts the least recently used item when full", () => {
      const cache = PerformanceHelpers.createLRUCache(2);

      cache.set("a", 1);
      cache.set("b", 2);

      // Mark "a" as most recently used, so "b" becomes LRU.
      expect(cache.get("a")).toBe(1);

      cache.set("c", 3);

      expect(cache.has("a")).toBe(true);
      expect(cache.has("b")).toBe(false);
      expect(cache.has("c")).toBe(true);

      expect(cache.getStats().evictions).toBe(1);
      expect(cache.size).toBe(2);
    });

    it("supports has/delete and clear resets both data and stats", () => {
      const cache = PerformanceHelpers.createLRUCache(2);

      cache.set("a", 1);
      expect(cache.has("a")).toBe(true);
      expect(cache.delete("a")).toBe(true);
      expect(cache.has("a")).toBe(false);
      expect(cache.delete("a")).toBe(false);

      cache.set("b", 2);
      expect(cache.get("b")).toBe(2);
      expect(cache.getStats().hits).toBe(1);
      expect(cache.getStats().sets).toBe(2);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.getStats()).toEqual({
        size: 0,
        maxSize: 2,
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        hitRate: 0,
        hitRatePercent: "0%",
      });
    });
  });

  describe("createManagedTimer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE_TIME);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("auto-cleans up setTimeout timers after they fire", () => {
      const timers = PerformanceHelpers.createManagedTimer();
      const fn = vi.fn();

      timers.setTimeout(fn, 100);
      expect(timers.activeCount).toBe(1);

      vi.advanceTimersByTime(99);
      expect(fn).not.toHaveBeenCalled();
      expect(timers.activeCount).toBe(1);

      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(timers.activeCount).toBe(0);
    });

    it("tracks setInterval timers and can clear them", () => {
      const timers = PerformanceHelpers.createManagedTimer();
      const fn = vi.fn();

      const id = timers.setInterval(fn, 50);
      expect(timers.activeCount).toBe(1);

      vi.advanceTimersByTime(150);
      expect(fn).toHaveBeenCalledTimes(3);

      timers.clear(id);
      expect(timers.activeCount).toBe(0);

      vi.advanceTimersByTime(200);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("clearAll cancels every tracked timer", () => {
      const timers = PerformanceHelpers.createManagedTimer();
      const timeoutFn = vi.fn();
      const intervalFn = vi.fn();

      timers.setTimeout(timeoutFn, 100);
      timers.setInterval(intervalFn, 50);
      expect(timers.activeCount).toBe(2);

      timers.clearAll();
      expect(timers.activeCount).toBe(0);

      vi.advanceTimersByTime(200);
      expect(timeoutFn).not.toHaveBeenCalled();
      expect(intervalFn).not.toHaveBeenCalled();
    });
  });
});
