import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
      assert.ok(l);
    });

    it("accepts custom timeout options", () => {
      const l = new FileLock({
        lockTimeoutMs: 5000,
        acquireTimeoutMs: 2000,
      });
      assert.ok(l);
    });
  });

  describe("generateHolderId", () => {
    it("generates unique ids", () => {
      const id1 = lock.generateHolderId();
      const id2 = lock.generateHolderId();
      assert.ok(id1.startsWith("lock_"));
      assert.ok(id2.startsWith("lock_"));
      assert.notEqual(id1, id2);
    });
  });

  describe("acquire", () => {
    it("acquires write lock on free path", async () => {
      const result = await lock.acquire("/test/file.txt");
      assert.ok(result.release);
      assert.ok(result.holder);
      result.release();
    });

    it("acquires read lock on free path", async () => {
      const result = await lock.acquire("/test/file.txt", { type: LockType.READ });
      assert.ok(result.release);
      result.release();
    });

    it("uses provided holder id", async () => {
      const result = await lock.acquire("/test/file.txt", { holder: "my-holder" });
      assert.equal(result.holder, "my-holder");
      result.release();
    });

    it("blocks write lock when write lock held", async () => {
      const first = await lock.acquire("/test/file.txt");

      // Second acquire should timeout
      await assert.rejects(
        () => lock.acquire("/test/file.txt", { timeoutMs: 100 }),
        /timeout/i
      );

      first.release();
    });

    it("blocks write lock when read lock held", async () => {
      const readLock = await lock.acquire("/test/file.txt", { type: LockType.READ });

      await assert.rejects(
        () => lock.acquire("/test/file.txt", { type: LockType.WRITE, timeoutMs: 100 }),
        /timeout/i
      );

      readLock.release();
    });

    it("allows multiple read locks", async () => {
      const read1 = await lock.acquire("/test/file.txt", { type: LockType.READ });
      const read2 = await lock.acquire("/test/file.txt", { type: LockType.READ });

      assert.ok(read1.holder);
      assert.ok(read2.holder);

      read1.release();
      read2.release();
    });

    it("respects AbortSignal - already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () => lock.acquire("/test/file.txt", { signal: controller.signal }),
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

      await assert.rejects(acquirePromise, /Aborted/);
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
      assert.ok(secondAcquired);
      second.release();
    });
  });

  describe("tryAcquire", () => {
    it("acquires when free", () => {
      const result = lock.tryAcquire("/test/file.txt");
      assert.ok(result.acquired);
      assert.ok(result.release);
      result.release();
    });

    it("fails when locked", async () => {
      const first = await lock.acquire("/test/file.txt");

      const result = lock.tryAcquire("/test/file.txt");
      assert.equal(result.acquired, false);
      assert.equal(result.release, undefined);

      first.release();
    });

    it("allows read tryAcquire when read lock held", async () => {
      const first = await lock.acquire("/test/file.txt", { type: LockType.READ });

      const result = lock.tryAcquire("/test/file.txt", { type: LockType.READ });
      assert.ok(result.acquired);

      result.release();
      first.release();
    });
  });

  describe("release", () => {
    it("returns true on success", async () => {
      const acquired = await lock.acquire("/test/file.txt");
      const success = lock.release("/test/file.txt", acquired.holder);
      assert.ok(success);
    });

    it("returns false for unknown path", () => {
      const success = lock.release("/unknown/path", "holder");
      assert.equal(success, false);
    });

    it("returns false for unknown holder", async () => {
      const acquired = await lock.acquire("/test/file.txt");
      const success = lock.release("/test/file.txt", "wrong-holder");
      assert.equal(success, false);
      acquired.release();
    });
  });

  describe("isLocked", () => {
    it("returns locked=false for free path", () => {
      const status = lock.isLocked("/test/file.txt");
      assert.equal(status.locked, false);
    });

    it("returns locked=true with write type", async () => {
      const acquired = await lock.acquire("/test/file.txt", { type: LockType.WRITE });

      const status = lock.isLocked("/test/file.txt");
      assert.ok(status.locked);
      assert.equal(status.type, LockType.WRITE);
      assert.ok(status.holders.includes(acquired.holder));

      acquired.release();
    });

    it("returns locked=true with read type for read locks", async () => {
      const acquired = await lock.acquire("/test/file.txt", { type: LockType.READ });

      const status = lock.isLocked("/test/file.txt");
      assert.ok(status.locked);
      assert.equal(status.type, LockType.READ);

      acquired.release();
    });
  });

  describe("getAllLocks", () => {
    it("returns empty map initially", () => {
      const all = lock.getAllLocks();
      assert.equal(all.size, 0);
    });

    it("returns all current locks", async () => {
      const lock1 = await lock.acquire("/file1.txt");
      const lock2 = await lock.acquire("/file2.txt");

      const all = lock.getAllLocks();
      assert.equal(all.size, 2);
      assert.ok(all.has("/file1.txt"));
      assert.ok(all.has("/file2.txt"));

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
      assert.equal(count, 2);

      assert.equal(lock.isLocked("/file1.txt").locked, false);
      assert.equal(lock.isLocked("/file2.txt").locked, false);
    });

    it("returns 0 for unknown holder", () => {
      const count = lock.releaseAllForHolder("unknown");
      assert.equal(count, 0);
    });

    it("does not affect other holders", async () => {
      const lock1 = await lock.acquire("/file1.txt", { holder: "holder-a" });
      const lock2 = await lock.acquire("/file2.txt", { holder: "holder-b" });

      lock.releaseAllForHolder("holder-a");

      assert.equal(lock.isLocked("/file1.txt").locked, false);
      assert.ok(lock.isLocked("/file2.txt").locked);

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
      assert.ok(result.acquired);
      result.release();
    });
  });

  describe("LockType", () => {
    it("has READ and WRITE values", () => {
      assert.equal(LockType.READ, "read");
      assert.equal(LockType.WRITE, "write");
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
      assert.ok(events.includes("w1-released"));
      assert.ok(events.includes("w2-acquired"));

      writer2.release();
    });
  });
});
