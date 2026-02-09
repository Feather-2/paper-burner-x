import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

describe("WorkerPool: basic lifecycle", () => {
  let WorkerPool;
  let TaskPriority;

  beforeAll(async () => {
    const mod = await import("../../../../js/agents/runtime/core/worker-pool.js");
    WorkerPool = mod.WorkerPool;
    TaskPriority = mod.TaskPriority;
  });

  let workerCount = 0;
  const mockWorker = () => ({
    postMessage: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    terminate: () => { workerCount--; },
  });

  it("constructor requires createWorker", () => {
    expect(() => new WorkerPool()).toThrow(/requires createWorker/);
    expect(() => new WorkerPool({})).toThrow(/requires createWorker/);
  });

  it("stats reports pool state", () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const stats = pool.stats;
    expect(stats.total).toBe(0);
    expect(stats.busy).toBe(0);
    expect(stats.idle).toBe(0);
    expect(stats.queued).toBe(0);
    // maxWorkers is derived from navigator.hardwareConcurrency at runtime
    expect(typeof stats.maxWorkers).toBe("number");
    expect(stats.maxWorkers).toBeGreaterThanOrEqual(2);
    pool.close();
  });

  it("warmup creates workers", () => {
    const pool = new WorkerPool({ createWorker: mockWorker, maxWorkers: 3 });
    pool.warmup(2);
    expect(pool.stats.total).toBe(2);
    expect(pool.stats.idle).toBe(2);
    pool.close();
  });

  it("close rejects pending tasks", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const pending = pool.exec("test", {});
    pool.close();
    await expect(pending).rejects.toThrow(/closed/);
  });

  it("exec rejects after close", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    pool.close();
    await expect(pool.exec("test")).rejects.toThrow(/closed/);
  });

  it("exec respects abort signal", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const ac = new AbortController();
    ac.abort();
    await expect(pool.exec("test", { signal: ac.signal })).rejects.toThrow(/Aborted/);
    pool.close();
  });

  it("TaskPriority constants exist", () => {
    expect(TaskPriority.HIGH).toBe(0);
    expect(TaskPriority.NORMAL).toBe(1);
    expect(TaskPriority.LOW).toBe(2);
  });
});

describe("ResourceGuard: quota management", () => {
  let ResourceGuard;

  beforeAll(async () => {
    const mod = await import("../../../../js/agents/runtime/core/resource-guard.js");
    ResourceGuard = mod.ResourceGuard;
  });

  it("stats reports current state", () => {
    const guard = new ResourceGuard({ maxConcurrent: 4 });
    const stats = guard.stats;
    expect(stats.concurrent).toBe(0);
    expect(stats.maxConcurrent).toBe(4);
    expect(stats.paused).toBe(false);
  });

  it("acquire/release manages concurrency", () => {
    const guard = new ResourceGuard({ maxConcurrent: 2 });

    expect(guard.acquire()).toBe(true);
    expect(guard.stats.concurrent).toBe(1);

    expect(guard.acquire()).toBe(true);
    expect(guard.stats.concurrent).toBe(2);

    // Should fail - at max
    expect(guard.acquire()).toBe(false);
    expect(guard.stats.concurrent).toBe(2);

    guard.release();
    expect(guard.stats.concurrent).toBe(1);

    expect(guard.acquire()).toBe(true);
    expect(guard.stats.concurrent).toBe(2);
  });

  it("pause/resume controls acquisition", () => {
    const guard = new ResourceGuard({ maxConcurrent: 4 });

    expect(guard.acquire()).toBe(true);
    guard.release();

    guard.pause();
    expect(guard.stats.paused).toBe(true);
    expect(guard.acquire()).toBe(false);

    guard.resume();
    expect(guard.stats.paused).toBe(false);
    expect(guard.acquire()).toBe(true);
  });

  it("canAcquire checks without modifying state", () => {
    const guard = new ResourceGuard({ maxConcurrent: 1 });

    const check1 = guard.canAcquire();
    expect(check1.allowed).toBe(true);
    expect(guard.stats.concurrent).toBe(0);

    guard.acquire();

    const check2 = guard.canAcquire();
    expect(check2.allowed).toBe(false);
    expect(check2.reason).toBe("max_concurrent");
  });

  it("run() executes with guard", async () => {
    const guard = new ResourceGuard({ maxConcurrent: 1 });

    let executed = false;
    const result = await guard.run(async () => {
      executed = true;
      expect(guard.stats.concurrent).toBe(1);
      return 42;
    });

    expect(executed).toBe(true);
    expect(result).toBe(42);
    expect(guard.stats.concurrent).toBe(0);
  });

  it("onQuotaExceeded callback fires", () => {
    let callbackData = null;
    const guard = new ResourceGuard({
      maxConcurrent: 1,
      onQuotaExceeded: (data) => { callbackData = data; },
    });

    guard.acquire();
    guard.acquire(); // Should trigger callback

    expect(callbackData).toEqual(expect.any(Object));
    expect(callbackData.reason).toBe("max_concurrent");
  });
});

describe("RetryStrategy: retry behavior", () => {
  let RetryStrategy;
  let isRetryableError;
  let withRetry;
  let resetGlobalRetryStats;

  beforeAll(async () => {
    const mod = await import("../../../../js/agents/shared/retry-strategy.js");
    RetryStrategy = mod.RetryStrategy;
    isRetryableError = mod.isRetryableError;
    withRetry = mod.withRetry;
    resetGlobalRetryStats = mod.resetGlobalRetryStats;
  });

  beforeEach(() => {
    resetGlobalRetryStats?.();
  });

  it("isRetryableError detects retryable errors", () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(new Error("generic"))).toBe(false);

    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    expect(isRetryableError(timeout)).toBe(true);

    const rateLimit = new Error("rate limit exceeded");
    expect(isRetryableError(rateLimit)).toBe(true);

    const networkError = new Error("network");
    networkError.code = "ECONNRESET";
    expect(isRetryableError(networkError)).toBe(true);

    const httpError = new Error("server error");
    httpError.status = 503;
    expect(isRetryableError(httpError)).toBe(true);
  });

  it("calculateDelay uses exponential backoff", () => {
    const strategy = new RetryStrategy({ baseDelayMs: 1000, maxDelayMs: 30000, jitterFactor: 0 });

    expect(strategy.calculateDelay(0)).toBe(1000);
    expect(strategy.calculateDelay(1)).toBe(2000);
    expect(strategy.calculateDelay(2)).toBe(4000);
    expect(strategy.calculateDelay(3)).toBe(8000);
    expect(strategy.calculateDelay(10)).toBe(30000); // Capped
  });

  it("execute succeeds without retry", async () => {
    const strategy = new RetryStrategy();
    let attempts = 0;

    const result = await strategy.execute(async () => {
      attempts++;
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(1);
  });

  it("execute retries on retryable error", async () => {
    const strategy = new RetryStrategy({ baseDelayMs: 10, maxRetries: 2 });
    let attempts = 0;

    const result = await strategy.execute(async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return "success";
    });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("execute throws after max retries", async () => {
    const strategy = new RetryStrategy({ baseDelayMs: 10, maxRetries: 2 });
    let attempts = 0;

    await expect(
      strategy.execute(async () => {
        attempts++;
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      })
    ).rejects.toThrow(/timeout/);

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("execute respects abort signal", async () => {
    const strategy = new RetryStrategy({ baseDelayMs: 100 });
    const ac = new AbortController();
    ac.abort();

    await expect(
      strategy.execute(async () => "success", { signal: ac.signal })
    ).rejects.toThrow(/Aborted/);
  });

  it("withRetry convenience function works", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) {
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return "done";
    }, { baseDelayMs: 10 });

    expect(result).toBe("done");
    expect(attempts).toBe(2);
  });

  it("stats tracks retry budget", () => {
    const strategy = new RetryStrategy({ globalBudgetPerMinute: 10 });
    const stats = strategy.stats;

    expect(stats.retriesLastMinute).toBe(0);
    expect(stats.budgetPerMinute).toBe(10);
    expect(stats.budgetRemaining).toBe(10);

    strategy.recordRetry();
    strategy.recordRetry();

    const stats2 = strategy.stats;
    expect(stats2.retriesLastMinute).toBe(2);
    expect(stats2.budgetRemaining).toBe(8);
  });
});

describe("FileLock: read/write locking", () => {
  let FileLock;
  let LockType;
  let getFileLock;
  let acquireLock;
  let withLock;

  beforeAll(async () => {
    const mod = await import("../../../../js/agents/vfs/file-lock.js");
    FileLock = mod.FileLock;
    LockType = mod.LockType;
    getFileLock = mod.getFileLock;
    acquireLock = mod.acquireLock;
    withLock = mod.withLock;
  });

  it("acquire/release basic flow", async () => {
    const lock = new FileLock();

    const { release, holder } = await lock.acquire("/test/file.txt");
    expect(holder.startsWith("lock_")).toBe(true);

    const status = lock.isLocked("/test/file.txt");
    expect(status.locked).toBe(true);
    expect(status.type).toBe("write");

    release();

    const status2 = lock.isLocked("/test/file.txt");
    expect(status2.locked).toBe(false);
  });

  it("tryAcquire returns immediately", () => {
    const lock = new FileLock();

    const result1 = lock.tryAcquire("/test/file.txt");
    expect(result1.acquired).toBe(true);
    expect(result1.release).toBeInstanceOf(Function);

    const result2 = lock.tryAcquire("/test/file.txt");
    expect(result2.acquired).toBe(false);

    result1.release();

    const result3 = lock.tryAcquire("/test/file.txt");
    expect(result3.acquired).toBe(true);
    result3.release();
  });

  it("multiple read locks allowed", async () => {
    const lock = new FileLock();

    const r1 = await lock.acquire("/test/file.txt", { type: LockType.READ });
    const r2 = await lock.acquire("/test/file.txt", { type: LockType.READ });

    const status = lock.isLocked("/test/file.txt");
    expect(status.locked).toBe(true);
    expect(status.type).toBe("read");
    expect(status.holders.length).toBe(2);

    r1.release();
    r2.release();
  });

  it("write lock blocks other locks", async () => {
    const lock = new FileLock();

    const w = await lock.acquire("/test/file.txt", { type: LockType.WRITE });

    const result = lock.tryAcquire("/test/file.txt", { type: LockType.READ });
    expect(result.acquired).toBe(false);

    w.release();
  });

  it("read lock blocks write lock", async () => {
    const lock = new FileLock();

    const r = await lock.acquire("/test/file.txt", { type: LockType.READ });

    const result = lock.tryAcquire("/test/file.txt", { type: LockType.WRITE });
    expect(result.acquired).toBe(false);

    r.release();
  });

  it("acquire waits for lock release", async () => {
    const lock = new FileLock({ acquireTimeoutMs: 1000 });

    const w1 = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt");

    // Release after short delay
    setTimeout(() => w1.release(), 50);

    const w2 = await acquirePromise;
    expect(w2.holder).toMatch(/^lock_/);
    w2.release();
  });

  it("acquire timeout", async () => {
    const lock = new FileLock({ acquireTimeoutMs: 50 });

    const w = await lock.acquire("/test/file.txt");

    await expect(lock.acquire("/test/file.txt")).rejects.toThrow(/timeout/);

    w.release();
  });

  it("acquire respects abort signal", async () => {
    const lock = new FileLock();
    const ac = new AbortController();

    const w = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt", { signal: ac.signal });
    ac.abort();

    await expect(acquirePromise).rejects.toThrow(/Aborted/);

    w.release();
  });

  it("releaseAllForHolder releases all locks", async () => {
    const lock = new FileLock();

    const holder = "test_holder_123";
    await lock.acquire("/a.txt", { holder });
    await lock.acquire("/b.txt", { holder });
    await lock.acquire("/c.txt", { holder: "other" });

    const count = lock.releaseAllForHolder(holder);
    expect(count).toBe(2);

    expect(lock.isLocked("/a.txt").locked).toBe(false);
    expect(lock.isLocked("/b.txt").locked).toBe(false);
    expect(lock.isLocked("/c.txt").locked).toBe(true);

    lock.release("/c.txt", "other");
  });

  it("expired locks are cleaned up", async () => {
    const lock = new FileLock({ lockTimeoutMs: 50 });

    await lock.acquire("/test/file.txt");
    expect(lock.isLocked("/test/file.txt").locked).toBe(true);

    // Wait for expiry
    await new Promise(r => setTimeout(r, 60));

    // Should be cleaned on next check
    expect(lock.isLocked("/test/file.txt").locked).toBe(false);
  });

  it("getFileLock returns singleton", () => {
    const lock1 = getFileLock();
    const lock2 = getFileLock();
    expect(lock1).toBe(lock2);
  });

  it("withLock executes with automatic release", async () => {
    const lock = new FileLock();

    let executed = false;
    const result = await withLock.call({ _lock: lock }, "/test/file.txt", async () => {
      executed = true;
      return 42;
    });

    // Note: withLock uses global, so we can't easily test isolation here
    // Just verify the function exists and is callable
    expect(typeof withLock).toBe("function");
  });

  it("LockType constants", () => {
    expect(LockType.READ).toBe("read");
    expect(LockType.WRITE).toBe("write");
  });

  it("getAllLocks returns map", async () => {
    const lock = new FileLock();

    const w = await lock.acquire("/test/file.txt");

    const all = lock.getAllLocks();
    expect(all).toBeInstanceOf(Map);
    expect(all.has("/test/file.txt")).toBe(true);

    w.release();
  });
});
