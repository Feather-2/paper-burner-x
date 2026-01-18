
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  isDisposable,
  safeDispose,
  disposeAll,
  using,
  createCompositeDisposable,
} from "../../js/agents/shared/contracts/disposable.js";

describe("shared/contracts/disposable", () => {
  describe("isDisposable", () => {
    it("returns true for object with dispose method", () => {
      const obj = { dispose: () => {} };
      expect(isDisposable(obj)).toBe(true);
    });

    it("returns false for null", () => {
      expect(isDisposable(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isDisposable(undefined)).toBe(false);
    });

    it("returns false for primitive", () => {
      expect(isDisposable("string")).toBe(false);
      expect(isDisposable(123)).toBe(false);
    });

    it("returns false for object without dispose", () => {
      expect(isDisposable({})).toBe(false);
    });

    it("returns false for object with non-function dispose", () => {
      expect(isDisposable({ dispose: "not a function" })).toBe(false);
    });
  });

  describe("safeDispose", () => {
    it("returns false for non-disposable", async () => {
      const result = await safeDispose({});
      expect(result).toBe(false);
    });

    it("returns true for already disposed", async () => {
      const obj = { dispose: () => {}, disposed: true };
      const result = await safeDispose(obj);
      expect(result).toBe(true);
    });

    it("disposes and returns true", async () => {
      let disposed = false;
      const obj = {
        dispose: () => { disposed = true; },
      };
      const result = await safeDispose(obj);
      expect(result).toBe(true);
      expect(disposed).toBe(true);
    });

    it("handles async dispose", async () => {
      let disposed = false;
      const obj = {
        dispose: async () => {
          await Promise.resolve();
          disposed = true;
        },
      };
      const result = await safeDispose(obj);
      expect(result).toBe(true);
      expect(disposed).toBe(true);
    });

    it("catches error and returns false", async () => {
      const obj = {
        dispose: () => { throw new Error("dispose error"); },
      };
      const result = await safeDispose(obj);
      expect(result).toBe(false);
    });

    it("calls onError callback", async () => {
      let capturedError = null;
      const obj = {
        dispose: () => { throw new Error("test error"); },
      };
      await safeDispose(obj, {
        onError: (e) => { capturedError = e; },
      });
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe("test error");
    });

    it("handles non-Error thrown", async () => {
      let capturedError = null;
      const obj = {
        dispose: () => { throw "string error"; },
      };
      await safeDispose(obj, {
        onError: (e) => { capturedError = e; },
      });
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe("string error");
    });
  });

  describe("disposeAll", () => {
    it("disposes all items", async () => {
      const disposed = [];
      const items = [
        { dispose: () => disposed.push(1) },
        { dispose: () => disposed.push(2) },
      ];
      const result = await disposeAll(items);
      expect(result.total).toBe(2);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(disposed).toEqual([1, 2]);
    });

    it("handles mixed success and failure", async () => {
      const items = [
        { dispose: () => {} },
        { dispose: () => { throw new Error("fail"); } },
        { dispose: () => {} },
      ];
      const result = await disposeAll(items);
      expect(result.total).toBe(3);
      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });

    it("calls onError for failed items", async () => {
      const errors = [];
      const items = [
        { dispose: () => { throw new Error("error1"); } },
      ];
      await disposeAll(items, {
        onError: (e, item) => errors.push({ e, item }),
      });
      expect(errors.length).toBe(1);
    });

    it("handles non-disposable items", async () => {
      const items = ["not disposable", { dispose: () => {} }];
      const result = await disposeAll(items);
      expect(result.total).toBe(2);
      expect(result.failed).toBe(1); // non-disposable counts as failed
    });
  });

  describe("using", () => {
    it("disposes resource after use", async () => {
      let disposed = false;
      const resource = {
        value: 42,
        dispose: () => { disposed = true; },
      };
      const result = await using(resource, async (r) => r.value * 2);
      expect(result).toBe(84);
      expect(disposed).toBe(true);
    });

    it("disposes even on error", async () => {
      let disposed = false;
      const resource = {
        dispose: () => { disposed = true; },
      };
      try {
        await using(resource, async () => { throw new Error("test"); });
      } catch {
        // Expected
      }
      expect(disposed).toBe(true);
    });
  });

  describe("createCompositeDisposable", () => {
    it("creates composite disposable", () => {
      const composite = createCompositeDisposable([]);
      expect(isDisposable(composite)).toBe(true);
      expect(composite.disposed).toBe(false);
    });

    it("disposes all in reverse order", async () => {
      const order = [];
      const composite = createCompositeDisposable([
        () => order.push(1),
        () => order.push(2),
        () => order.push(3),
      ]);
      await composite.dispose();
      expect(order).toEqual([3, 2, 1]);
    });

    it("handles mixed functions and disposables", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([
        () => disposed.push("fn1"),
        { dispose: () => disposed.push("obj1") },
        () => disposed.push("fn2"),
      ]);
      await composite.dispose();
      expect(disposed).toEqual(["fn2", "obj1", "fn1"]);
    });

    it("sets disposed to true after dispose", async () => {
      const composite = createCompositeDisposable([]);
      await composite.dispose();
      expect(composite.disposed).toBe(true);
    });

    it("does not dispose twice", async () => {
      let count = 0;
      const composite = createCompositeDisposable([() => count++]);
      await composite.dispose();
      await composite.dispose();
      expect(count).toBe(1);
    });

    it("add() adds new disposable", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([]);
      composite.add(() => disposed.push(1));
      composite.add({ dispose: () => disposed.push(2) });
      await composite.dispose();
      expect(disposed).toEqual([2, 1]);
    });

    it("add() is ignored after disposed", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([]);
      await composite.dispose();
      composite.add(() => disposed.push(1));
      expect(disposed.length).toBe(0);
    });

    it("handles error in disposable", async () => {
      const composite = createCompositeDisposable([
        () => { throw new Error("test"); },
        () => {}, // Should still run
      ]);
      await composite.dispose(); // Should not throw
      expect(composite.disposed).toBe(true);
    });
  });
});
