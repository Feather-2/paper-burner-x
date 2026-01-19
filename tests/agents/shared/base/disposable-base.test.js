
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
        expect(base.disposed).toBe(false);
      });

      it("initializes empty disposables array", () => {
        expect(Array.isArray(base._disposables)).toBe(true);
        expect(base._disposables.length).toBe(0);
      });
    });

    describe("_registerDisposable", () => {
      it("registers function", () => {
        base._registerDisposable(() => {});
        expect(base._disposables.length).toBe(1);
      });

      it("registers disposable object", () => {
        base._registerDisposable({ dispose: () => {} });
        expect(base._disposables.length).toBe(1);
      });

      it("warns when registering after disposed", async () => {
        await base.dispose();
        // Should not throw, just warn
        base._registerDisposable(() => {});
        expect(base._disposables.length).toBe(0);
      });

      it("ignores non-function non-disposable", () => {
        base._registerDisposable("string");
        expect(base._disposables.length).toBe(0);
      });
    });

    describe("_registerSubscription", () => {
      it("registers function", () => {
        base._registerSubscription(() => {});
        expect(base._disposables.length).toBe(1);
      });

      it("ignores non-function", () => {
        base._registerSubscription("not a function");
        expect(base._disposables.length).toBe(0);
      });
    });

    describe("_registerTimer", () => {
      it("registers interval timer", () => {
        const timerId = setInterval(() => {}, 1000);
        base._registerTimer(timerId, "interval");
        expect(base._disposables.length).toBe(1);
        clearInterval(timerId);
      });

      it("registers timeout timer", () => {
        const timerId = setTimeout(() => {}, 1000);
        base._registerTimer(timerId, "timeout");
        expect(base._disposables.length).toBe(1);
        clearTimeout(timerId);
      });

      it("defaults to interval type", () => {
        const timerId = setInterval(() => {}, 1000);
        base._registerTimer(timerId);
        expect(base._disposables.length).toBe(1);
        clearInterval(timerId);
      });
    });

    describe("dispose", () => {
      it("sets disposed to true", async () => {
        await base.dispose();
        expect(base.disposed).toBe(true);
      });

      it("calls registered disposables in reverse order", async () => {
        const order = [];
        base._registerDisposable(() => order.push(1));
        base._registerDisposable(() => order.push(2));
        base._registerDisposable(() => order.push(3));
        await base.dispose();
        expect(order).toEqual([3, 2, 1]);
      });

      it("handles async disposables", async () => {
        let disposed = false;
        base._registerDisposable(async () => {
          await Promise.resolve();
          disposed = true;
        });
        await base.dispose();
        expect(disposed).toBe(true);
      });

      it("does not dispose twice", async () => {
        let count = 0;
        base._registerDisposable(() => count++);
        await base.dispose();
        await base.dispose();
        expect(count).toBe(1);
      });

      it("clears disposables array", async () => {
        base._registerDisposable(() => {});
        await base.dispose();
        expect(base._disposables.length).toBe(0);
      });

      it("handles error in disposable", async () => {
        base._registerDisposable(() => { throw new Error("test"); });
        await base.dispose(); // Should not throw
        expect(base.disposed).toBe(true);
      });

      it("calls _onDispose hook", async () => {
        let hookCalled = false;
        base._onDispose = () => { hookCalled = true; };
        await base.dispose();
        expect(hookCalled).toBe(true);
      });
    });

    describe("_ensureNotDisposed", () => {
      it("does not throw when not disposed", () => {
        base._ensureNotDisposed(); // Should not throw
      });

      it("throws when disposed", async () => {
        await base.dispose();
        expect(() => base._ensureNotDisposed()).toThrow(/has been disposed/);
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
        expect(component.cleaned).toBe(true);
      });
    });
  });
});
