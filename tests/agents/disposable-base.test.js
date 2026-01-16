import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { DisposableBase } from "../../js/agents/shared/base/disposable-base.js";

describe("shared/base/disposable-base", () => {
  describe("DisposableBase", () => {
    /** @type {DisposableBase} */
    let base;

    beforeEach(() => {
      base = new DisposableBase();
    });

    describe("constructor", () => {
      it("initializes disposed to false", () => {
        assert.equal(base.disposed, false);
      });

      it("initializes empty disposables array", () => {
        assert.ok(Array.isArray(base._disposables));
        assert.equal(base._disposables.length, 0);
      });
    });

    describe("_registerDisposable", () => {
      it("registers function", () => {
        base._registerDisposable(() => {});
        assert.equal(base._disposables.length, 1);
      });

      it("registers disposable object", () => {
        base._registerDisposable({ dispose: () => {} });
        assert.equal(base._disposables.length, 1);
      });

      it("warns when registering after disposed", async () => {
        await base.dispose();
        // Should not throw, just warn
        base._registerDisposable(() => {});
        assert.equal(base._disposables.length, 0);
      });

      it("ignores non-function non-disposable", () => {
        base._registerDisposable("string");
        assert.equal(base._disposables.length, 0);
      });
    });

    describe("_registerSubscription", () => {
      it("registers function", () => {
        base._registerSubscription(() => {});
        assert.equal(base._disposables.length, 1);
      });

      it("ignores non-function", () => {
        base._registerSubscription("not a function");
        assert.equal(base._disposables.length, 0);
      });
    });

    describe("_registerTimer", () => {
      it("registers interval timer", () => {
        const timerId = setInterval(() => {}, 1000);
        base._registerTimer(timerId, "interval");
        assert.equal(base._disposables.length, 1);
        clearInterval(timerId);
      });

      it("registers timeout timer", () => {
        const timerId = setTimeout(() => {}, 1000);
        base._registerTimer(timerId, "timeout");
        assert.equal(base._disposables.length, 1);
        clearTimeout(timerId);
      });

      it("defaults to interval type", () => {
        const timerId = setInterval(() => {}, 1000);
        base._registerTimer(timerId);
        assert.equal(base._disposables.length, 1);
        clearInterval(timerId);
      });
    });

    describe("dispose", () => {
      it("sets disposed to true", async () => {
        await base.dispose();
        assert.equal(base.disposed, true);
      });

      it("calls registered disposables in reverse order", async () => {
        const order = [];
        base._registerDisposable(() => order.push(1));
        base._registerDisposable(() => order.push(2));
        base._registerDisposable(() => order.push(3));
        await base.dispose();
        assert.deepEqual(order, [3, 2, 1]);
      });

      it("handles async disposables", async () => {
        let disposed = false;
        base._registerDisposable(async () => {
          await Promise.resolve();
          disposed = true;
        });
        await base.dispose();
        assert.ok(disposed);
      });

      it("does not dispose twice", async () => {
        let count = 0;
        base._registerDisposable(() => count++);
        await base.dispose();
        await base.dispose();
        assert.equal(count, 1);
      });

      it("clears disposables array", async () => {
        base._registerDisposable(() => {});
        await base.dispose();
        assert.equal(base._disposables.length, 0);
      });

      it("handles error in disposable", async () => {
        base._registerDisposable(() => { throw new Error("test"); });
        await base.dispose(); // Should not throw
        assert.equal(base.disposed, true);
      });

      it("calls _onDispose hook", async () => {
        let hookCalled = false;
        base._onDispose = () => { hookCalled = true; };
        await base.dispose();
        assert.ok(hookCalled);
      });
    });

    describe("_ensureNotDisposed", () => {
      it("does not throw when not disposed", () => {
        base._ensureNotDisposed(); // Should not throw
      });

      it("throws when disposed", async () => {
        await base.dispose();
        assert.throws(
          () => base._ensureNotDisposed(),
          /has been disposed/
        );
      });
    });

    describe("subclass", () => {
      it("works with subclass", async () => {
        class MyComponent extends DisposableBase {
          constructor() {
            super();
            this.cleaned = false;
            this._registerDisposable(() => { this.cleaned = true; });
          }
        }
        const component = new MyComponent();
        await component.dispose();
        assert.ok(component.cleaned);
      });
    });
  });
});
