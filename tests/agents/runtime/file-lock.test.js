import { afterEach, describe, expect, it, vi } from "vitest";

import { Container } from "../../../js/agents/runtime/di/container.js";
import { setGlobalContainer } from "../../../js/agents/runtime/di/global-container.js";
import { FileLock, LockType, acquireLock, getFileLock, withLock } from "../../../js/agents/vfs/file-lock.js";

afterEach(() => {
  setGlobalContainer(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("vfs/file-lock", () => {
  it("acquire/release basic flow", async () => {
    const lock = new FileLock();

    const { release, holder } = await lock.acquire("/test/file.txt");
    expect(holder.startsWith("lock_")).toBe(true);

    const status = lock.isLocked("/test/file.txt");
    expect(status.locked).toBe(true);
    expect(status.type).toBe("write");

    release();
    expect(lock.isLocked("/test/file.txt").locked).toBe(false);
  });

  it("tryAcquire returns immediately", () => {
    const lock = new FileLock();

    const result1 = lock.tryAcquire("/test/file.txt");
    expect(result1.acquired).toBe(true);
    expect(typeof result1.release).toBe("function");

    const result2 = lock.tryAcquire("/test/file.txt");
    expect(result2.acquired).toBe(false);

    result1.release();

    const result3 = lock.tryAcquire("/test/file.txt");
    expect(result3.acquired).toBe(true);
    result3.release();
  });

  it("allows multiple read locks", async () => {
    const lock = new FileLock();

    const r1 = await lock.acquire("/test/file.txt", { type: LockType.READ });
    const r2 = await lock.acquire("/test/file.txt", { type: LockType.READ });

    const status = lock.isLocked("/test/file.txt");
    expect(status.locked).toBe(true);
    expect(status.type).toBe("read");
    expect(status.holders).toHaveLength(2);

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const lock = new FileLock({ acquireTimeoutMs: 1000 });

    const w1 = await lock.acquire("/test/file.txt");
    const acquirePromise = lock.acquire("/test/file.txt");

    setTimeout(() => w1.release(), 50);
    await vi.advanceTimersByTimeAsync(50);

    const w2 = await acquirePromise;
    expect(typeof w2.holder).toBe("string");
    w2.release();
  });

  it("acquire times out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const lock = new FileLock({ acquireTimeoutMs: 50 });
    const w = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt");
    const rejection = expect(acquirePromise).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    w.release();
  });

  it("acquire respects abort signal", async () => {
    const lock = new FileLock();
    const ac = new AbortController();

    const w = await lock.acquire("/test/file.txt");

    const acquirePromise = lock.acquire("/test/file.txt", { signal: ac.signal });
    ac.abort();

    await expect(acquirePromise).rejects.toThrow(/aborted/i);
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

  it("cleans expired locks on next check", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const lock = new FileLock({ lockTimeoutMs: 50 });
    await lock.acquire("/test/file.txt");
    expect(lock.isLocked("/test/file.txt").locked).toBe(true);

    await vi.advanceTimersByTimeAsync(60);
    expect(lock.isLocked("/test/file.txt").locked).toBe(false);
  });

  it("getFileLock returns singleton", () => {
    const lock1 = getFileLock();
    const lock2 = getFileLock();
    expect(lock1).toBe(lock2);
  });

  it("withLock executes and releases lock", async () => {
    const lock = new FileLock();

    const container = new Container();
    container.registerValue("fileLock", lock);
    setGlobalContainer(container);

    const result = await withLock("/test/file.txt", async () => {
      expect(lock.isLocked("/test/file.txt").locked).toBe(true);
      return 42;
    });

    expect(result).toBe(42);
    expect(lock.isLocked("/test/file.txt").locked).toBe(false);
  });

  it("acquireLock uses the global instance", async () => {
    const lock = new FileLock();
    const container = new Container();
    container.registerValue("fileLock", lock);
    setGlobalContainer(container);

    const w = await acquireLock("/test/file.txt");
    expect(lock.isLocked("/test/file.txt").locked).toBe(true);
    w.release();
    expect(lock.isLocked("/test/file.txt").locked).toBe(false);
  });

  it("LockType constants", () => {
    expect(LockType.READ).toBe("read");
    expect(LockType.WRITE).toBe("write");
  });

  it("getAllLocks returns a Map snapshot", async () => {
    const lock = new FileLock();
    const w = await lock.acquire("/test/file.txt");

    const all = lock.getAllLocks();
    expect(all).toBeInstanceOf(Map);
    expect(all.has("/test/file.txt")).toBe(true);

    w.release();
  });
});
