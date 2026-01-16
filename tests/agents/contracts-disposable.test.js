import { describe, it } from "node:test";
import assert from "node:assert/strict";

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
      assert.ok(isDisposable(obj));
    });

    it("returns false for null", () => {
      assert.equal(isDisposable(null), false);
    });

    it("returns false for undefined", () => {
      assert.equal(isDisposable(undefined), false);
    });

    it("returns false for primitive", () => {
      assert.equal(isDisposable("string"), false);
      assert.equal(isDisposable(123), false);
    });

    it("returns false for object without dispose", () => {
      assert.equal(isDisposable({}), false);
    });

    it("returns false for object with non-function dispose", () => {
      assert.equal(isDisposable({ dispose: "not a function" }), false);
    });
  });

  describe("safeDispose", () => {
    it("returns false for non-disposable", async () => {
      const result = await safeDispose({});
      assert.equal(result, false);
    });

    it("returns true for already disposed", async () => {
      const obj = { dispose: () => {}, disposed: true };
      const result = await safeDispose(obj);
      assert.equal(result, true);
    });

    it("disposes and returns true", async () => {
      let disposed = false;
      const obj = {
        dispose: () => { disposed = true; },
      };
      const result = await safeDispose(obj);
      assert.equal(result, true);
      assert.ok(disposed);
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
      assert.equal(result, true);
      assert.ok(disposed);
    });

    it("catches error and returns false", async () => {
      const obj = {
        dispose: () => { throw new Error("dispose error"); },
      };
      const result = await safeDispose(obj);
      assert.equal(result, false);
    });

    it("calls onError callback", async () => {
      let capturedError = null;
      const obj = {
        dispose: () => { throw new Error("test error"); },
      };
      await safeDispose(obj, {
        onError: (e) => { capturedError = e; },
      });
      assert.ok(capturedError);
      assert.equal(capturedError.message, "test error");
    });

    it("handles non-Error thrown", async () => {
      let capturedError = null;
      const obj = {
        dispose: () => { throw "string error"; },
      };
      await safeDispose(obj, {
        onError: (e) => { capturedError = e; },
      });
      assert.ok(capturedError instanceof Error);
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
      assert.equal(result.total, 2);
      assert.equal(result.success, 2);
      assert.equal(result.failed, 0);
      assert.deepEqual(disposed, [1, 2]);
    });

    it("handles mixed success and failure", async () => {
      const items = [
        { dispose: () => {} },
        { dispose: () => { throw new Error("fail"); } },
        { dispose: () => {} },
      ];
      const result = await disposeAll(items);
      assert.equal(result.total, 3);
      assert.equal(result.success, 2);
      assert.equal(result.failed, 1);
    });

    it("calls onError for failed items", async () => {
      const errors = [];
      const items = [
        { dispose: () => { throw new Error("error1"); } },
      ];
      await disposeAll(items, {
        onError: (e, item) => errors.push({ e, item }),
      });
      assert.equal(errors.length, 1);
    });

    it("handles non-disposable items", async () => {
      const items = ["not disposable", { dispose: () => {} }];
      const result = await disposeAll(items);
      assert.equal(result.total, 2);
      assert.equal(result.failed, 1); // non-disposable counts as failed
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
      assert.equal(result, 84);
      assert.ok(disposed);
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
      assert.ok(disposed);
    });
  });

  describe("createCompositeDisposable", () => {
    it("creates composite disposable", () => {
      const composite = createCompositeDisposable([]);
      assert.ok(isDisposable(composite));
      assert.equal(composite.disposed, false);
    });

    it("disposes all in reverse order", async () => {
      const order = [];
      const composite = createCompositeDisposable([
        () => order.push(1),
        () => order.push(2),
        () => order.push(3),
      ]);
      await composite.dispose();
      assert.deepEqual(order, [3, 2, 1]);
    });

    it("handles mixed functions and disposables", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([
        () => disposed.push("fn1"),
        { dispose: () => disposed.push("obj1") },
        () => disposed.push("fn2"),
      ]);
      await composite.dispose();
      assert.deepEqual(disposed, ["fn2", "obj1", "fn1"]);
    });

    it("sets disposed to true after dispose", async () => {
      const composite = createCompositeDisposable([]);
      await composite.dispose();
      assert.equal(composite.disposed, true);
    });

    it("does not dispose twice", async () => {
      let count = 0;
      const composite = createCompositeDisposable([() => count++]);
      await composite.dispose();
      await composite.dispose();
      assert.equal(count, 1);
    });

    it("add() adds new disposable", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([]);
      composite.add(() => disposed.push(1));
      composite.add({ dispose: () => disposed.push(2) });
      await composite.dispose();
      assert.deepEqual(disposed, [2, 1]);
    });

    it("add() is ignored after disposed", async () => {
      const disposed = [];
      const composite = createCompositeDisposable([]);
      await composite.dispose();
      composite.add(() => disposed.push(1));
      assert.equal(disposed.length, 0);
    });

    it("handles error in disposable", async () => {
      const composite = createCompositeDisposable([
        () => { throw new Error("test"); },
        () => {}, // Should still run
      ]);
      await composite.dispose(); // Should not throw
      assert.ok(composite.disposed);
    });
  });
});
