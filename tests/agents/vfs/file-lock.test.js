import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileLock, LockType, acquireLock, getFileLock, withLock } from "../../../js/agents/vfs/file-lock.js";
import { setGlobalContainer } from "../../../js/agents/runtime/di/global-container.js";

beforeEach(() => {
  // Silence createLogger() output from the lock implementation.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  // Ensure global DI container doesn't leak state across tests.
  setGlobalContainer(null);
});

describe("agents/vfs/file-lock", () => {
  it("acquires/releases a write lock and reports lock state", async () => {
    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 100 });
    const { holder, release } = await lock.acquire("a.txt", { type: LockType.WRITE, holder: "H" });
    expect(holder).toBe("H");

    expect(lock.isLocked("a.txt")).toEqual({ locked: true, type: LockType.WRITE, holders: ["H"] });
    expect(lock.release("a.txt", "H")).toBe(true);
    expect(lock.isLocked("a.txt")).toEqual({ locked: false });
    expect(release()).toBe(false);
  });

  it("allows multiple read locks but blocks write locks until released", async () => {
    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 100 });

    const r1 = await lock.acquire("f", { type: LockType.READ, holder: "R1" });
    const r2 = await lock.acquire("f", { type: LockType.READ, holder: "R2" });
    expect(lock.isLocked("f").type).toBe(LockType.READ);

    // Write lock cannot be acquired while reads are held.
    const tryWrite = lock.tryAcquire("f", { type: LockType.WRITE, holder: "W" });
    expect(tryWrite.acquired).toBe(false);

    r1.release();
    r2.release();

    const w = await lock.acquire("f", { type: LockType.WRITE, holder: "W" });
    expect(lock.isLocked("f").type).toBe(LockType.WRITE);
    w.release();
  });

  it("waits for a lock and resolves when the lock is released", async () => {
    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 1000 });

    const w = await lock.acquire("f", { type: LockType.WRITE, holder: "W" });
    const pending = lock.acquire("f", { type: LockType.READ, holder: "R", timeoutMs: 1000 });

    // Releasing should wake the waiter immediately.
    w.release();
    const r = await pending;
    expect(r.holder).toBe("R");
    r.release();
  });

  it("times out while waiting to acquire a lock", async () => {
    vi.useFakeTimers();

    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 1000 });
    const w = await lock.acquire("f", { type: LockType.WRITE, holder: "W" });

    const pending = lock.acquire("f", { type: LockType.READ, holder: "R", timeoutMs: 50 });
    const assertion = expect(pending).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    w.release();
  });

  it("supports aborting a pending acquire", async () => {
    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 1000 });
    const w = await lock.acquire("f", { type: LockType.WRITE, holder: "W" });

    const ac = new AbortController();
    const pending = lock.acquire("f", { type: LockType.READ, holder: "R", timeoutMs: 1000, signal: ac.signal });

    const assertion = expect(pending).rejects.toThrow(/aborted/i);
    ac.abort();
    await assertion;

    w.release();
  });

  it("cleans expired locks and allows new acquisitions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const lock = new FileLock({ lockTimeoutMs: 10, acquireTimeoutMs: 1000 });
    await lock.acquire("f", { type: LockType.WRITE, holder: "W" });
    expect(lock.isLocked("f").locked).toBe(true);

    // Move time forward past expiry; next access should clean it up.
    vi.setSystemTime(new Date(25));
    expect(lock.isLocked("f")).toEqual({ locked: false });

    const r = await lock.acquire("f", { type: LockType.READ, holder: "R" });
    expect(lock.isLocked("f").type).toBe(LockType.READ);
    r.release();
  });

  it("releaseAllForHolder removes all locks for a holder", async () => {
    const lock = new FileLock({ lockTimeoutMs: 1000, acquireTimeoutMs: 1000 });
    await lock.acquire("a", { type: LockType.READ, holder: "H" });
    await lock.acquire("b", { type: LockType.WRITE, holder: "H" });

    const released = lock.releaseAllForHolder("H");
    expect(released).toBe(2);
    expect(lock.isLocked("a").locked).toBe(false);
  });

  it("global helpers (getFileLock/acquireLock/withLock) share a singleton", async () => {
    setGlobalContainer(null);

    const l1 = getFileLock();
    const l2 = getFileLock();
    expect(l1).toBe(l2);

    const acquired = await acquireLock("p", { type: LockType.WRITE, holder: "H" });
    expect(getFileLock().isLocked("p").locked).toBe(true);
    acquired.release();
    expect(getFileLock().isLocked("p").locked).toBe(false);

    const out = await withLock("p2", async () => "ok", { type: LockType.WRITE, holder: "H2" });
    expect(out).toBe("ok");
    expect(getFileLock().isLocked("p2").locked).toBe(false);
  });
});
