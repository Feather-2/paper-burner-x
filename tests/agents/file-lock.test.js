
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FileLock, LockType } from "../../js/agents/vfs/file-lock.js";

describe("vfs/file-lock", () => {
  /** @type {FileLock} */
  let lock;

  beforeEach(() => {
    lock = new FileLock({
      lockTimeoutMs: 1000,
      acquireTimeoutMs: 500,
    });
  });

  describe("constructor", () => {
    it("creates with default options", () => {
      const l = new FileLock();
      expect(l).toBeInstanceOf(FileLock);
    });

    it("accepts custom timeout options", () => {
      const l = new FileLock({
        lockTimeoutMs: 5000,
        acquireTimeoutMs: 2000,
      });
      expect(l).toBeInstanceOf(FileLock);
    });
  });

  describe("generateHolderId", () => {
    it("generates unique ids", () => {
      const id1 = lock.generateHolderId();
      const id2 = lock.generateHolderId();
      expect(id1).toMatch(/^lock_/);
      expect(id2).toMatch(/^lock_/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("acquire", () => {
    it("acquires write lock on free path", async () => {
      const result = await lock.acquire("/test/file.txt");
      expect(result.release).toBeTypeOf("function");
      expect(result.holder).toMatch(/^lock_/);
      result.release();
    });

    it("acquires read lock on free path", async () => {
      const result = await lock.acquire("/test/file.txt", { type: LockType.READ });
      expect(result.release).toBeTypeOf("function");
      result.release();
    });

    it("uses provided holder id", async () => {
      const result = await lock.acquire("/test/file.txt", { holder: "my-holder" });
      expect(result.holder).toBe("my-holder");
      result.release();
    });

    it("blocks write lock when write lock held", async () => {
      const first = await lock.acquire("/test/file.txt");

      // Second acquire should timeout
      await expect(() => lock.acquire("/test/file.txt", { timeoutMs: 100 }),
        /timeout/i
      );

      first.release();
    });

    it("blocks write lock when read lock held", async () => {
      const readLock = await lock.acquire("/test/file.txt", { type: LockType.READ });

      await expect(() => lock.acquire("/test/file.txt", { type: LockType.WRITE, timeoutMs: 100 }),
        /timeout/i
      );

      readLock.release();
    });

    it("allows multiple read locks", async () => {
      const read1 = await lock.acquire("/test/file.txt", { type: LockType.READ });
      const read2 = await lock.acquire("/test/file.txt", { type: LockType.READ });

      expect(read1.holder).toMatch(/^lock_/);
      expect(read2.holder).toMatch(/^lock_/);

      read1.release();
      read2.release();
    });

    it("respects AbortSignal - already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(() => lock.acquire("/test/file.txt", { signal: controller.signal }),
        /Aborted/
      );
    });

    it("respects AbortSignal - aborted while waiting", async () => {
      const first = await lock.acquire("/test/file.txt");

      const controller = new AbortController();
      const acquirePromise = lock.acquire("/test/file.txt", {
        signal: controller.signal,
        timeoutMs: 5000,
      });

      // Abort after short delay
      setTimeout(() => controller.abort(), 50);

      await expect(acquirePromise).rejects.toThrow(/Aborted/);
      first.release();
    });

    it("resolves waiters when lock released", async () => {
      const first = await lock.acquire("/test/file.txt");

      let secondAcquired = false;
      const secondPromise = lock.acquire("/test/file.txt").then((result) => {
        secondAcquired = true;
        return result;
      });

      // Give time for waiter to register
      await new Promise((r) => setTimeout(r, 10));

      first.release();

      const second = await secondPromise;
      expect(secondAcquired).toBe(true);
      second.release();
    });
  });

  describe("tryAcquire", () => {
    it("acquires when free", () => {
      const result = lock.tryAcquire("/test/file.txt");
      expect(result.acquired).toBe(true);
      expect(result.release).toBeTypeOf("function");
      result.release();
    });

    it("fails when locked", async () => {
      const first = await lock.acquire("/test/file.txt");

      const result = lock.tryAcquire("/test/file.txt");
      expect(result.acquired).toBe(false);
      expect(result.release).toBe(undefined);

      first.release();
    });

    it("allows read tryAcquire when read lock held", async () => {
      const first = await lock.acquire("/test/file.txt", { type: LockType.READ });

      const result = lock.tryAcquire("/test/file.txt", { type: LockType.READ });
      expect(result.acquired).toBe(true);

      result.release();
      first.release();
    });
  });

  describe("release", () => {
    it("returns true on success", async () => {
      const acquired = await lock.acquire("/test/file.txt");
      const success = lock.release("/test/file.txt", acquired.holder);
      expect(success).toBe(true);
    });

    it("returns false for unknown path", () => {
      const success = lock.release("/unknown/path", "holder");
      expect(success).toBe(false);
    });

    it("returns false for unknown holder", async () => {
      const acquired = await lock.acquire("/test/file.txt");
      const success = lock.release("/test/file.txt", "wrong-holder");
      expect(success).toBe(false);
      acquired.release();
    });
  });

  describe("isLocked", () => {
    it("returns locked=false for free path", () => {
      const status = lock.isLocked("/test/file.txt");
      expect(status.locked).toBe(false);
    });

    it("returns locked=true with write type", async () => {
      const acquired = await lock.acquire("/test/file.txt", { type: LockType.WRITE });

      const status = lock.isLocked("/test/file.txt");
      expect(status.locked).toBe(true);
      expect(status.type).toBe(LockType.WRITE);
      expect(status.holders).toContain(acquired.holder);

      acquired.release();
    });

    it("returns locked=true with read type for read locks", async () => {
      const acquired = await lock.acquire("/test/file.txt", { type: LockType.READ });

      const status = lock.isLocked("/test/file.txt");
      expect(status.locked).toBe(true);
      expect(status.type).toBe(LockType.READ);

      acquired.release();
    });
  });

  describe("getAllLocks", () => {
    it("returns empty map initially", () => {
      const all = lock.getAllLocks();
      expect(all.size).toBe(0);
    });

    it("returns all current locks", async () => {
      const lock1 = await lock.acquire("/file1.txt");
      const lock2 = await lock.acquire("/file2.txt");

      const all = lock.getAllLocks();
      expect(all.size).toBe(2);
      expect(all.has("/file1.txt")).toBe(true);
      expect(all.has("/file2.txt")).toBe(true);

      lock1.release();
      lock2.release();
    });
  });

  describe("releaseAllForHolder", () => {
    it("releases all locks for a holder", async () => {
      const holder = "shared-holder";
      await lock.acquire("/file1.txt", { holder });
      await lock.acquire("/file2.txt", { holder });

      const count = lock.releaseAllForHolder(holder);
      expect(count).toBe(2);

      expect(lock.isLocked("/file1.txt").locked).toBe(false);
      expect(lock.isLocked("/file2.txt").locked).toBe(false);
    });

    it("returns 0 for unknown holder", () => {
      const count = lock.releaseAllForHolder("unknown");
      expect(count).toBe(0);
    });

    it("does not affect other holders", async () => {
      const lock1 = await lock.acquire("/file1.txt", { holder: "holder-a" });
      const lock2 = await lock.acquire("/file2.txt", { holder: "holder-b" });

      lock.releaseAllForHolder("holder-a");

      expect(lock.isLocked("/file1.txt").locked).toBe(false);
      expect(lock.isLocked("/file2.txt").locked).toBe(true);

      lock2.release();
    });
  });

  describe("lock expiration", () => {
    it("expires locks after timeout", async () => {
      // Use very short timeout
      const shortLock = new FileLock({
        lockTimeoutMs: 50,
        acquireTimeoutMs: 200,
      });

      await shortLock.acquire("/test/file.txt");

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 100));

      // Should be able to acquire now
      const result = shortLock.tryAcquire("/test/file.txt");
      expect(result.acquired).toBe(true);
      result.release();
    });
  });

  describe("LockType", () => {
    it("has READ and WRITE values", () => {
      expect(LockType.READ).toBe("read");
      expect(LockType.WRITE).toBe("write");
    });
  });

  describe("concurrent scenarios", () => {
    it("handles sequential lock handoff", async () => {
      const events = [];

      // Acquire write lock
      const writer1 = await lock.acquire("/test", { type: LockType.WRITE, holder: "w1" });
      events.push("w1-acquired");

      // Queue up a second writer with longer timeout
      const writer2Promise = lock.acquire("/test", {
        type: LockType.WRITE,
        holder: "w2",
        timeoutMs: 2000,
      }).then((l) => {
        events.push("w2-acquired");
        return l;
      });

      await new Promise((r) => setTimeout(r, 10));

      // Release first writer - should wake up second
      writer1.release();
      events.push("w1-released");

      const writer2 = await writer2Promise;
      expect(events).toContain("w1-released");
      expect(events).toContain("w2-acquired");

      writer2.release();
    });
  });
});
