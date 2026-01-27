import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/core/contracts/disposable.js", () => ({
  isDisposable: vi.fn(),
}));

import DisposableBaseDefault, {
  DisposableBase,
} from "../../../../../js/agents/shared/base/disposable-base.js";
import { isDisposable } from "../../../../../js/agents/core/contracts/disposable.js";

function createDeferred() {
  /** @type {(value?: unknown) => void} */
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createDeepObject(depth) {
  let root = {};
  let current = root;
  for (let i = 0; i < depth; i++) {
    current.next = {};
    current = current.next;
  }
  return root;
}

describe("DisposableBase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    isDisposable.mockReset();
    isDisposable.mockReturnValue(false);
  });

  describe("constructor", () => {
    it("initializes with disposed=false and an empty disposables list", () => {
      const d = new DisposableBase();

      expect(d.disposed).toBe(false);
      expect(d._disposables).toEqual([]);
    });
  });

  describe("_registerDisposable()", () => {
    it("adds a cleanup function to the internal disposables list", () => {
      const d = new DisposableBase();
      const cleanup = vi.fn();

      d._registerDisposable(cleanup);

      expect(d._disposables).toHaveLength(1);
      expect(d._disposables[0]).toBe(cleanup);
      expect(isDisposable).not.toHaveBeenCalled();
    });

    it("wraps Disposable objects when isDisposable() returns true", async () => {
      const d = new DisposableBase();
      const disposable = { dispose: vi.fn() };

      isDisposable.mockReturnValue(true);

      d._registerDisposable(disposable);

      expect(isDisposable).toHaveBeenCalledTimes(1);
      expect(isDisposable).toHaveBeenCalledWith(disposable);
      expect(d._disposables).toHaveLength(1);
      expect(disposable.dispose).not.toHaveBeenCalled();

      await d.dispose();

      expect(disposable.dispose).toHaveBeenCalledTimes(1);
    });

    it("ignores non-function, non-disposable cleanup values (including empty/boundary/resource types)", () => {
      const d = new DisposableBase();
      const longString = "x".repeat(100000);
      const bigBinary = new Uint8Array(1024 * 1024);
      const deep = createDeepObject(100);

      const values = [
        null,
        undefined,
        "",
        "   ",
        longString,
        [],
        {},
        deep,
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        "123",
        bigBinary,
      ];

      for (const v of values) {
        d._registerDisposable(v);
      }

      expect(d._disposables).toHaveLength(0);
      expect(isDisposable).toHaveBeenCalledTimes(values.length);
      for (let i = 0; i < values.length; i++) {
        expect(isDisposable.mock.calls[i][0]).toBe(values[i]);
      }
    });

    it("warns and ignores registration after the instance is disposed", () => {
      const d = new DisposableBase();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      d.disposed = true;

      const cleanup = vi.fn();
      d._registerDisposable(cleanup);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[DisposableBase] registering disposable after disposed",
      );
      expect(isDisposable).not.toHaveBeenCalled();
      expect(d._disposables).toHaveLength(0);
    });
  });

  describe("_registerSubscription()", () => {
    it("registers an unsubscribe function for disposal", async () => {
      const d = new DisposableBase();
      const unsubscribe = vi.fn();

      d._registerSubscription(unsubscribe);

      expect(d._disposables).toHaveLength(1);

      await d.dispose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("ignores non-function unsubscribe values (null/undefined/strings/objects/arrays)", () => {
      const d = new DisposableBase();
      const values = [
        null,
        undefined,
        "",
        "   ",
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        {},
        [],
        { unsubscribe: vi.fn() },
      ];

      for (const v of values) {
        d._registerSubscription(v);
      }

      expect(d._disposables).toHaveLength(0);
      expect(isDisposable).not.toHaveBeenCalled();
    });
  });

  describe("_registerTimer()", () => {
    it("registers interval timers via clearInterval (default behavior, including boundary timer ids)", async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const d = new DisposableBase();

      const timerIds = [0, -1, Number.MAX_SAFE_INTEGER, "123"];
      for (const id of timerIds) {
        d._registerTimer(id);
      }

      await d.dispose();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(timerIds.length);
      for (const id of timerIds) {
        expect(clearIntervalSpy).toHaveBeenCalledWith(id);
      }
    });

    it('registers timeout timers via clearTimeout when type="timeout"', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
      const d = new DisposableBase();

      d._registerTimer(0, "timeout");
      await d.dispose();

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(0);
    });

    it("treats unexpected timer type values as interval", async () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const d = new DisposableBase();

      d._registerTimer(0, "");
      await d.dispose();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(0);
    });
  });

  describe("dispose()", () => {
    it("calls _onDispose() before disposing resources in LIFO order, and clears the disposables list", async () => {
      const calls = [];

      class TestDisposable extends DisposableBase {
        _onDispose() {
          calls.push("onDispose");
        }
      }

      const d = new TestDisposable();
      d._registerDisposable(() => calls.push("first"));
      d._registerDisposable(() => calls.push("second"));

      await d.dispose();

      expect(d.disposed).toBe(true);
      expect(d._disposables).toHaveLength(0);
      expect(calls).toEqual(["onDispose", "second", "first"]);
    });

    it("is idempotent: multiple dispose() calls only dispose once", async () => {
      const d = new DisposableBase();
      const cleanup = vi.fn();
      const onDisposeSpy = vi.spyOn(d, "_onDispose");

      d._registerDisposable(cleanup);

      await d.dispose();
      await d.dispose();

      expect(onDisposeSpy).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("awaits promise-returning cleanup functions before resolving", async () => {
      const d = new DisposableBase();
      const deferred = createDeferred();

      let cleaned = false;
      d._registerDisposable(async () => {
        await deferred.promise;
        cleaned = true;
      });

      let resolved = false;
      const disposePromise = d.dispose().then(() => {
        resolved = true;
      });

      await Promise.resolve();
      expect(resolved).toBe(false);
      expect(cleaned).toBe(false);

      deferred.resolve();
      await disposePromise;

      expect(cleaned).toBe(true);
      expect(resolved).toBe(true);
    });

    it("continues disposing after a cleanup error and logs a warning", async () => {
      const d = new DisposableBase();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const good = vi.fn();
      const boom = new Error("boom");
      const badDisposable = {
        dispose: vi.fn(() => {
          throw boom;
        }),
      };

      isDisposable.mockImplementation((value) => value === badDisposable);

      d._registerDisposable(good);
      d._registerDisposable(badDisposable);

      await d.dispose();

      expect(badDisposable.dispose).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("[DisposableBase] dispose error:", boom);
      expect(d._disposables).toHaveLength(0);
    });

    it("propagates _onDispose errors and does not run registered disposables afterwards", async () => {
      const cleanup = vi.fn();

      class FailingOnDispose extends DisposableBase {
        _onDispose() {
          throw new Error("onDispose failed");
        }
      }

      const d = new FailingOnDispose();
      d._registerDisposable(cleanup);

      await expect(d.dispose()).rejects.toThrow("onDispose failed");

      expect(d.disposed).toBe(true);
      expect(cleanup).not.toHaveBeenCalled();
      expect(d._disposables).toHaveLength(1);
    });

    it("handles concurrent dispose() calls without double-running cleanup", async () => {
      const deferred = createDeferred();

      class AsyncOnDispose extends DisposableBase {
        constructor() {
          super();
          this.onDisposeCalls = 0;
        }

        async _onDispose() {
          this.onDisposeCalls++;
          await deferred.promise;
        }
      }

      const d = new AsyncOnDispose();
      const cleanup = vi.fn();
      d._registerDisposable(cleanup);

      const p1 = d.dispose();
      const p2 = d.dispose();

      await p2;
      expect(d.onDisposeCalls).toBe(1);
      expect(cleanup).not.toHaveBeenCalled();

      deferred.resolve();
      await p1;

      expect(d.onDisposeCalls).toBe(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe("_ensureNotDisposed()", () => {
    it("does not throw when not disposed", () => {
      const d = new DisposableBase();
      expect(() => d._ensureNotDisposed()).not.toThrow();
    });

    it("throws with the class name when already disposed", () => {
      class Widget extends DisposableBase {}
      const d = new Widget();
      d.disposed = true;

      expect(() => d._ensureNotDisposed()).toThrow("Widget has been disposed");
    });
  });
});

describe("default", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("exports DisposableBase as the default export", () => {
    expect(DisposableBaseDefault).toBe(DisposableBase);
  });
});