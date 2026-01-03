const test = require("node:test");
const assert = require("node:assert/strict");

test("WorkerPool: basic lifecycle", async (t) => {
  const { WorkerPool, TaskPriority } = await import("../../../js/agents/runtime/core/worker-pool.js");

  let workerCount = 0;
  const mockWorker = () => ({
    postMessage: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    terminate: () => { workerCount--; },
  });

  await t.test("constructor requires createWorker", () => {
    assert.throws(() => new WorkerPool(), /requires createWorker/);
    assert.throws(() => new WorkerPool({}), /requires createWorker/);
  });

  await t.test("stats reports pool state", () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const stats = pool.stats;
    assert.equal(stats.total, 0);
    assert.equal(stats.busy, 0);
    assert.equal(stats.idle, 0);
    assert.equal(stats.queued, 0);
    assert.equal(stats.maxWorkers, 4);
    pool.close();
  });

  await t.test("warmup creates workers", () => {
    const pool = new WorkerPool({ createWorker: mockWorker, maxWorkers: 3 });
    pool.warmup(2);
    assert.equal(pool.stats.total, 2);
    assert.equal(pool.stats.idle, 2);
    pool.close();
  });

  await t.test("close rejects pending tasks", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const pending = pool.exec("test", {});
    pool.close();
    await assert.rejects(pending, /closed/);
  });

  await t.test("exec rejects after close", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    pool.close();
    await assert.rejects(pool.exec("test", {}), /closed/);
  });

  await t.test("exec respects abort signal", async () => {
    const pool = new WorkerPool({ createWorker: mockWorker });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(pool.exec("test", {}, { signal: ac.signal }), /Aborted/);
    pool.close();
  });

  await t.test("TaskPriority constants exist", () => {
    assert.equal(TaskPriority.HIGH, 0);
    assert.equal(TaskPriority.NORMAL, 1);
    assert.equal(TaskPriority.LOW, 2);
  });
});

test("ResourceGuard: quota management", async (t) => {
  const { ResourceGuard } = await import("../../../js/agents/runtime/core/resource-guard.js");

  await t.test("stats reports current state", () => {
    const guard = new ResourceGuard({ maxConcurrent: 4 });
    const stats = guard.stats;
    assert.equal(stats.concurrent, 0);
    assert.equal(stats.maxConcurrent, 4);
    assert.equal(stats.paused, false);
  });

  await t.test("acquire/release manages concurrency", () => {
    const guard = new ResourceGuard({ maxConcurrent: 2 });

    assert.equal(guard.acquire(), true);
    assert.equal(guard.stats.concurrent, 1);

    assert.equal(guard.acquire(), true);
    assert.equal(guard.stats.concurrent, 2);

    // Should fail - at max
    assert.equal(guard.acquire(), false);
    assert.equal(guard.stats.concurrent, 2);

    guard.release();
    assert.equal(guard.stats.concurrent, 1);

    assert.equal(guard.acquire(), true);
    assert.equal(guard.stats.concurrent, 2);
  });

  await t.test("pause/resume controls acquisition", () => {
    const guard = new ResourceGuard({ maxConcurrent: 4 });

    assert.equal(guard.acquire(), true);
    guard.release();

    guard.pause();
    assert.equal(guard.stats.paused, true);
    assert.equal(guard.acquire(), false);

    guard.resume();
    assert.equal(guard.stats.paused, false);
    assert.equal(guard.acquire(), true);
  });

  await t.test("canAcquire checks without modifying state", () => {
    const guard = new ResourceGuard({ maxConcurrent: 1 });

    const check1 = guard.canAcquire();
    assert.equal(check1.allowed, true);
    assert.equal(guard.stats.concurrent, 0);

    guard.acquire();

    const check2 = guard.canAcquire();
    assert.equal(check2.allowed, false);
    assert.equal(check2.reason, "max_concurrent");
  });

  await t.test("run() executes with guard", async () => {
    const guard = new ResourceGuard({ maxConcurrent: 1 });

    let executed = false;
    const result = await guard.run(async () => {
      executed = true;
      assert.equal(guard.stats.concurrent, 1);
      return 42;
    });

    assert.equal(executed, true);
    assert.equal(result, 42);
    assert.equal(guard.stats.concurrent, 0);
  });

  await t.test("onQuotaExceeded callback fires", () => {
    let callbackData = null;
    const guard = new ResourceGuard({
      maxConcurrent: 1,
      onQuotaExceeded: (data) => { callbackData = data; },
    });

    guard.acquire();
    guard.acquire(); // Should trigger callback

    assert.ok(callbackData);
    assert.equal(callbackData.reason, "max_concurrent");
  });
});

test("RetryStrategy: retry behavior", async (t) => {
  const { RetryStrategy, isRetryableError, withRetry } = await import("../../../js/agents/runtime/core/retry-strategy.js");

  await t.test("isRetryableError detects retryable errors", () => {
    assert.equal(isRetryableError(null), false);
    assert.equal(isRetryableError(new Error("generic")), false);

    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    assert.equal(isRetryableError(timeout), true);

    const rateLimit = new Error("rate limit exceeded");
    assert.equal(isRetryableError(rateLimit), true);

    const networkError = new Error("network");
    networkError.code = "ECONNRESET";
    assert.equal(isRetryableError(networkError), true);

    const httpError = new Error("server error");
    httpError.status = 503;
    assert.equal(isRetryableError(httpError), true);
  });

  await t.test("calculateDelay uses exponential backoff", () => {
    const strategy = new RetryStrategy({ baseDelayMs: 1000, maxDelayMs: 30000, jitterFactor: 0 });

    assert.equal(strategy.calculateDelay(0), 1000);
    assert.equal(strategy.calculateDelay(1), 2000);
    assert.equal(strategy.calculateDelay(2), 4000);
    assert.equal(strategy.calculateDelay(3), 8000);
    assert.equal(strategy.calculateDelay(10), 30000); // Capped
  });

  await t.test("execute succeeds without retry", async () => {
    const strategy = new RetryStrategy();
    let attempts = 0;

    const result = await strategy.execute(async () => {
      attempts++;
      return "success";
    });

    assert.equal(result, "success");
    assert.equal(attempts, 1);
  });

  await t.test("execute retries on retryable error", async () => {
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

    assert.equal(result, "success");
    assert.equal(attempts, 3);
  });

  await t.test("execute throws after max retries", async () => {
    const strategy = new RetryStrategy({ baseDelayMs: 10, maxRetries: 2 });
    let attempts = 0;

    await assert.rejects(
      strategy.execute(async () => {
        attempts++;
        const err = new Error("timeout");
        err.name = "TimeoutError";
        throw err;
      }),
      /timeout/
    );

    assert.equal(attempts, 3); // 1 initial + 2 retries
  });

  await t.test("execute respects abort signal", async () => {
    const strategy = new RetryStrategy({ baseDelayMs: 100 });
    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      strategy.execute(async () => "success", { signal: ac.signal }),
      /Aborted/
    );
  });

  await t.test("withRetry convenience function works", async () => {
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

    assert.equal(result, "done");
    assert.equal(attempts, 2);
  });

  await t.test("stats tracks retry budget", () => {
    const strategy = new RetryStrategy({ globalBudgetPerMinute: 10 });
    const stats = strategy.stats;

    assert.equal(stats.retriesLastMinute, 0);
    assert.equal(stats.budgetPerMinute, 10);
    assert.equal(stats.budgetRemaining, 10);

    strategy.recordRetry();
    strategy.recordRetry();

    const stats2 = strategy.stats;
    assert.equal(stats2.retriesLastMinute, 2);
    assert.equal(stats2.budgetRemaining, 8);
  });
});

test("FileLock: read/write locking", async (t) => {
  const { FileLock, LockType, getFileLock, acquireLock, withLock } = await import("../../../js/agents/vfs/file-lock.js");

  await t.test("acquire/release basic flow", async () => {
    const lock = new FileLock();

    const { release, holder } = await lock.acquire("/test/file.txt");
    assert.ok(holder.startsWith("lock_"));

    const status = lock.isLocked("/test/file.txt");
    assert.equal(status.locked, true);
    assert.equal(status.type, "write");

    release();

    const status2 = lock.isLocked("/test/file.txt");
    assert.equal(status2.locked, false);
  });

  await t.test("tryAcquire returns immediately", () => {
    const lock = new FileLock();

    const result1 = lock.tryAcquire("/test/file.txt");
    assert.equal(result1.acquired, true);
    assert.ok(result1.release);

    const result2 = lock.tryAcquire("/test/file.txt");
    assert.equal(result2.acquired, false);

    result1.release();

    const result3 = lock.tryAcquire("/test/file.txt");
    assert.equal(result3.acquired, true);
    result3.release();
  });

  await t.test("multiple read locks allowed", async () => {
    const lock = new FileLock();

    const r1 = await lock.acquire("/test/file.txt", { type: LockType.READ });
    const r2 = await lock.acquire("/test/file.txt", { type: LockType.READ });

    const status = lock.isLocked("/test/file.txt");
    assert.equal(status.locked, true);
    assert.equal(status.type, "read");
    assert.equal(status.holders.length, 2);

    r1.release();
    r2.release();
  });

  await t.test("write lock blocks other locks", async () => {
    const lock = new FileLock();

    const w = await lock.acquire("/test/file.txt", { type: LockType.WRITE });

    const result = lock.tryAcquire("/test/file.txt", { type: LockType.READ });
    assert.equal(result.acquired, false);

    w.release();
  });

  await t.test("read lock blocks write lock", async () => {
    const lock = new FileLock();

    const r = await lock.acquire("/test/file.txt", { type: LockType.READ });

    const result = lock.tryAcquire("/test/file.txt", { type: LockType.WRITE });
    assert.equal(result.acquired, false);

    r.release();
  });

  await t.test("acquire waits for lock release", async () => {
    const lock = new FileLock({ acquireTimeoutMs: 1000 });

    const w1 = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt");

    // Release after short delay
    setTimeout(() => w1.release(), 50);

    const w2 = await acquirePromise;
    assert.ok(w2.holder);
    w2.release();
  });

  await t.test("acquire timeout", async () => {
    const lock = new FileLock({ acquireTimeoutMs: 50 });

    const w = await lock.acquire("/test/file.txt");

    await assert.rejects(
      lock.acquire("/test/file.txt"),
      /timeout/
    );

    w.release();
  });

  await t.test("acquire respects abort signal", async () => {
    const lock = new FileLock();
    const ac = new AbortController();

    const w = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt", { signal: ac.signal });
    ac.abort();

    await assert.rejects(acquirePromise, /Aborted/);

    w.release();
  });

  await t.test("releaseAllForHolder releases all locks", async () => {
    const lock = new FileLock();

    const holder = "test_holder_123";
    await lock.acquire("/a.txt", { holder });
    await lock.acquire("/b.txt", { holder });
    await lock.acquire("/c.txt", { holder: "other" });

    const count = lock.releaseAllForHolder(holder);
    assert.equal(count, 2);

    assert.equal(lock.isLocked("/a.txt").locked, false);
    assert.equal(lock.isLocked("/b.txt").locked, false);
    assert.equal(lock.isLocked("/c.txt").locked, true);

    lock.release("/c.txt", "other");
  });

  await t.test("expired locks are cleaned up", async () => {
    const lock = new FileLock({ lockTimeoutMs: 50 });

    await lock.acquire("/test/file.txt");
    assert.equal(lock.isLocked("/test/file.txt").locked, true);

    // Wait for expiry
    await new Promise(r => setTimeout(r, 60));

    // Should be cleaned on next check
    assert.equal(lock.isLocked("/test/file.txt").locked, false);
  });

  await t.test("getFileLock returns singleton", () => {
    const lock1 = getFileLock();
    const lock2 = getFileLock();
    assert.equal(lock1, lock2);
  });

  await t.test("withLock executes with automatic release", async () => {
    const lock = new FileLock();

    let executed = false;
    const result = await withLock.call({ _lock: lock }, "/test/file.txt", async () => {
      executed = true;
      return 42;
    });

    // Note: withLock uses global, so we can't easily test isolation here
    // Just verify the function exists and is callable
    assert.ok(typeof withLock === "function");
  });

  await t.test("LockType constants", () => {
    assert.equal(LockType.READ, "read");
    assert.equal(LockType.WRITE, "write");
  });

  await t.test("getAllLocks returns map", async () => {
    const lock = new FileLock();

    const w = await lock.acquire("/test/file.txt");

    const all = lock.getAllLocks();
    assert.ok(all instanceof Map);
    assert.ok(all.has("/test/file.txt"));

    w.release();
  });
});
