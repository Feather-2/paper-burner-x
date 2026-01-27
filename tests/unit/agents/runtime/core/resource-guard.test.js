import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  return {
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

import { ResourceGuard } from "../../../../../js/agents/runtime/core/resource-guard.js";

function extractQuotaReasonFromCall(call) {
  const [a, b] = call ?? [];
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && typeof a.reason === "string") return a.reason;
  if (typeof b === "string") return b;
  if (b && typeof b === "object" && typeof b.reason === "string") return b.reason;
  return undefined;
}

describe("ResourceGuard", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("uses defaults when options are undefined or empty object", () => {
      const a = new ResourceGuard();
      a._getMemoryUsageMB = () => 0;
      expect(a.stats).toMatchObject({
        concurrent: 0,
        maxConcurrent: 8,
        tasksPerSecond: 0,
        maxTasksPerSecond: 100,
        memoryMB: 0,
        maxMemoryMB: 512,
        paused: false,
      });

      const b = new ResourceGuard({});
      b._getMemoryUsageMB = () => 0;
      expect(b.stats).toMatchObject({
        concurrent: 0,
        maxConcurrent: 8,
        tasksPerSecond: 0,
        maxTasksPerSecond: 100,
        maxMemoryMB: 512,
        paused: false,
      });
    });

    it("throws when options is null (null boundary)", () => {
      expect(() => new ResourceGuard(null)).toThrow();
    });

    it("does not throw for empty/primitive/non-null options (type boundaries)", () => {
      expect(() => new ResourceGuard(undefined)).not.toThrow();
      expect(() => new ResourceGuard("")).not.toThrow();
      expect(() => new ResourceGuard("   ")).not.toThrow();
      expect(() => new ResourceGuard([])).not.toThrow();
      expect(() => new ResourceGuard(0)).not.toThrow();
      expect(() => new ResourceGuard(false)).not.toThrow();
    });

    it("accepts very large quota values (MAX_SAFE_INTEGER boundary)", () => {
      const guard = new ResourceGuard({
        maxConcurrent: Number.MAX_SAFE_INTEGER,
        maxTasksPerSecond: Number.MAX_SAFE_INTEGER,
        maxMemoryMB: Number.MAX_SAFE_INTEGER,
      });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.acquire()).toBe(true);
      expect(guard.stats.concurrent).toBe(2);
    });

    it("treats numeric-string config values as numbers in comparisons (type boundary)", () => {
      const guard = new ResourceGuard({
        maxConcurrent: "1",
        maxTasksPerSecond: "1000",
        maxMemoryMB: "999999",
      });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.acquire()).toBe(false);
      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "max_concurrent" });
    });

    it("handles non-numeric option types without throwing (type boundary)", () => {
      const guard = new ResourceGuard({
        maxConcurrent: {},
        maxTasksPerSecond: [],
        maxMemoryMB: "not-a-number",
      });
      guard._getMemoryUsageMB = () => 0;

      expect(() => guard.canAcquire()).not.toThrow();
      const result = guard.canAcquire();
      expect(typeof result.allowed).toBe("boolean");
      if (!result.allowed) expect(typeof result.reason).toBe("string");
    });
  });

  describe("stats", () => {
    it("reports rolling tasksPerSecond, memoryMB, and paused state", () => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);

      const guard = new ResourceGuard();
      guard._getMemoryUsageMB = () => 42;
      guard._currentConcurrent = 3;
      guard._paused = true;
      guard._taskCountWindow = [8_000, 9_001, 9_999, 10_000];

      expect(guard.stats).toEqual({
        concurrent: 3,
        maxConcurrent: 8,
        tasksPerSecond: 3,
        maxTasksPerSecond: 100,
        memoryMB: 42,
        maxMemoryMB: 512,
        paused: true,
      });
    });
  });

  describe("canAcquire", () => {
    it("disallows acquisition when paused (reason precedence)", () => {
      const guard = new ResourceGuard({ maxConcurrent: 0, maxTasksPerSecond: 0, maxMemoryMB: 0 });
      guard._getMemoryUsageMB = () => 9999;
      guard._paused = true;

      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "paused" });
    });

    it("disallows when maxConcurrent is 0 or -1 (boundary values)", () => {
      const a = new ResourceGuard({ maxConcurrent: 0, maxTasksPerSecond: 1000 });
      a._getMemoryUsageMB = () => 0;
      expect(a.canAcquire()).toEqual({ allowed: false, reason: "max_concurrent" });

      const b = new ResourceGuard({ maxConcurrent: -1, maxTasksPerSecond: 1000 });
      b._getMemoryUsageMB = () => 0;
      expect(b.canAcquire()).toEqual({ allowed: false, reason: "max_concurrent" });
    });

    it("disallows when maxTasksPerSecond is 0 or -1 (boundary values)", () => {
      const a = new ResourceGuard({ maxConcurrent: 1000, maxTasksPerSecond: 0 });
      a._getMemoryUsageMB = () => 0;
      expect(a.canAcquire()).toEqual({ allowed: false, reason: "rate_limit" });

      const b = new ResourceGuard({ maxConcurrent: 1000, maxTasksPerSecond: -1 });
      b._getMemoryUsageMB = () => 0;
      expect(b.canAcquire()).toEqual({ allowed: false, reason: "rate_limit" });
    });

    it("disallows when currentConcurrent >= maxConcurrent", () => {
      const guard = new ResourceGuard({ maxConcurrent: 1, maxTasksPerSecond: 1000 });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "max_concurrent" });
    });

    it("enforces rate limit within a 1s sliding window, then recovers after 1s", () => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);

      const guard = new ResourceGuard({ maxConcurrent: 1000, maxTasksPerSecond: 2 });
      guard._getMemoryUsageMB = () => 0;

      guard._taskCountWindow = [9_500, 9_900];
      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "rate_limit" });

      vi.setSystemTime(11_001);
      expect(guard.canAcquire()).toEqual({ allowed: true });
    });

    it("disallows when memory usage exceeds maxMemoryMB, but allows at equality", () => {
      const over = new ResourceGuard({ maxMemoryMB: 10, maxTasksPerSecond: 1000 });
      over._getMemoryUsageMB = () => 10.0001;
      expect(over.canAcquire()).toEqual({ allowed: false, reason: "memory_limit" });

      const equal = new ResourceGuard({ maxMemoryMB: 10, maxTasksPerSecond: 1000 });
      equal._getMemoryUsageMB = () => 10;
      expect(equal.canAcquire()).toEqual({ allowed: true });
    });
  });

  describe("acquire / release", () => {
    it("acquire increments concurrent and records timestamp on success", () => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);

      const guard = new ResourceGuard({ maxConcurrent: 2, maxTasksPerSecond: 1000 });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.stats.concurrent).toBe(1);
      expect(guard._taskCountWindow).toContain(10_000);
    });

    it("acquire calls onQuotaExceeded with a reason on failure", () => {
      const onQuotaExceeded = vi.fn();
      const guard = new ResourceGuard({ maxConcurrent: 1, maxTasksPerSecond: 1000, onQuotaExceeded });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.acquire()).toBe(false);

      expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
      const reason = extractQuotaReasonFromCall(onQuotaExceeded.mock.calls[0]);
      expect(reason).toBe("max_concurrent");
    });

    it("acquire does not call onQuotaExceeded on success", () => {
      const onQuotaExceeded = vi.fn();
      const guard = new ResourceGuard({ maxConcurrent: 10, maxTasksPerSecond: 1000, onQuotaExceeded });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(onQuotaExceeded).not.toHaveBeenCalled();
    });

    it("enforces maxConcurrent under rapid consecutive calls (concurrency boundary)", () => {
      const onQuotaExceeded = vi.fn();
      const guard = new ResourceGuard({ maxConcurrent: 2, maxTasksPerSecond: 1000, onQuotaExceeded });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.acquire()).toBe(true);
      expect(guard.acquire()).toBe(false);

      expect(onQuotaExceeded).toHaveBeenCalledTimes(1);
      const reason = extractQuotaReasonFromCall(onQuotaExceeded.mock.calls[0]);
      expect(reason).toBe("max_concurrent");
    });

    it("enforces maxTasksPerSecond under rapid calls even when releases occur (concurrency boundary)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const guard = new ResourceGuard({ maxConcurrent: 1000, maxTasksPerSecond: 2 });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      guard.release();
      expect(guard.acquire()).toBe(true);
      guard.release();

      expect(guard.acquire()).toBe(false);
      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "rate_limit" });
    });

    it("release decrements concurrent but never below zero (boundary values)", () => {
      const guard = new ResourceGuard({ maxConcurrent: 2, maxTasksPerSecond: 1000 });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.acquire()).toBe(true);
      expect(guard.stats.concurrent).toBe(1);

      guard.release();
      guard.release();
      guard.release();
      expect(guard.stats.concurrent).toBe(0);
    });

    it("prunes old task timestamps on acquire to avoid unbounded growth (resource boundary)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(10_000);

      const guard = new ResourceGuard({
        maxConcurrent: Number.MAX_SAFE_INTEGER,
        maxTasksPerSecond: Number.MAX_SAFE_INTEGER,
      });
      guard._getMemoryUsageMB = () => 0;

      guard._taskCountWindow = Array.from({ length: 2000 }, (_, i) => 10_000 - 2_000 - i);
      expect(guard.acquire()).toBe(true);
      expect(guard._taskCountWindow.length).toBe(1);
      expect(guard._taskCountWindow[0]).toBe(10_000);
    });

    it("treats whitespace string numeric limits as 0 via coercion (type boundary)", () => {
      const guard = new ResourceGuard({ maxConcurrent: "   ", maxTasksPerSecond: 1000 });
      guard._getMemoryUsageMB = () => 0;

      expect(guard.canAcquire()).toEqual({ allowed: false, reason: "max_concurrent" });
      expect(guard.acquire()).toBe(false);
    });
  });

  describe("waitForSlot", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
    });

    it("acquires immediately when a slot is available (normal path)", async () => {
      const guard = new ResourceGuard({
        maxConcurrent: 1,
        maxTasksPerSecond: 1000,
        maxMemoryMB: 1000,
        checkIntervalMs: 5,
      });
      guard._getMemoryUsageMB = () => 0;

      await expect(guard.waitForSlot({ timeoutMs: 50 })).resolves.toBeUndefined();
      expect(guard.stats.concurrent).toBe(1);
    });

    it("waits until a slot is released when multiple callers compete (concurrency boundary)", async () => {
      const guard = new ResourceGuard({
        maxConcurrent: 1,
        maxTasksPerSecond: 1000,
        maxMemoryMB: 1000,
        checkIntervalMs: 10,
      });
      guard._getMemoryUsageMB = () => 0;

      const first = guard.waitForSlot({ timeoutMs: 1000 });
      const second = guard.waitForSlot({ timeoutMs: 1000 });

      await first;
      expect(guard.stats.concurrent).toBe(1);

      guard.release();
      await vi.advanceTimersByTimeAsync(50);

      await expect(second).resolves.toBeUndefined();
      expect(guard.stats.concurrent).toBe(1);
    });

    it("rejects if the AbortSignal is already aborted (error handling)", async () => {
      const guard = new ResourceGuard({ checkIntervalMs: 10 });
      guard._getMemoryUsageMB = () => 0;

      const controller = new AbortController();
      controller.abort();

      await expect(
        guard.waitForSlot({ timeoutMs: 100, signal: controller.signal }),
      ).rejects.toThrow(/aborted/i);
    });

    it("rejects if aborted while waiting (error handling)", async () => {
      const guard = new ResourceGuard({ maxConcurrent: 0, checkIntervalMs: 10 });
      guard._getMemoryUsageMB = () => 0;

      const controller = new AbortController();
      const p = guard.waitForSlot({ timeoutMs: 1000, signal: controller.signal });

      await vi.advanceTimersByTimeAsync(20);
      controller.abort();
      await vi.advanceTimersByTimeAsync(20);

      await expect(p).rejects.toThrow(/aborted/i);
    });

    it("times out when a slot never becomes available (error handling)", async () => {
      const guard = new ResourceGuard({ maxConcurrent: 0, checkIntervalMs: 10 });
      guard._getMemoryUsageMB = () => 0;

      const p = guard.waitForSlot({ timeoutMs: 25 });
      await vi.advanceTimersByTimeAsync(200);

      await expect(p).rejects.toBeInstanceOf(Error);
    });
  });
});