// Unit tests for DisposableBase in shared/base/disposable-base.js.
// Covers registration paths, timer cleanup, disposal ordering, and boundary/error cases.
import { describe, it, expect, vi, beforeEach } from "vitest";

const isDisposableMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/core/contracts/disposable.js", () => ({
  isDisposable: isDisposableMock,
}));

import DisposableBaseDefault, {
  DisposableBase,
} from "../../../../../js/agents/shared/base/disposable-base.js";

describe("shared/base/disposable-base", () => {
  describe("DisposableBase", () => {
    /** @type {DisposableBase} */
    let base;

    beforeEach(() => {
      isDisposableMock.mockReset();
      isDisposableMock.mockReturnValue(false);
      base = new DisposableBase();
    });

    describe("constructor", () => {
      it("initializes state", () => {
        expect(base.disposed).toBe(false);
        expect(base._disposables).toEqual([]);
      });
    });

    describe("_registerDisposable", () => {
      it("registers function cleanups without consulting isDisposable", () => {
        isDisposableMock.mockImplementation(() => {
          throw new Error("isDisposable should not be called");
        });
        const cleanup = vi.fn();
        base._registerDisposable(cleanup);
        expect(base._disposables).toEqual([cleanup]);
        expect(isDisposableMock).not.toHaveBeenCalled();
      });

      it("registers disposable objects when isDisposable returns true", async () => {
        const disposable = { dispose: vi.fn() };
        isDisposableMock.mockReturnValue(true);
        base._registerDisposable(disposable);
        expect(isDisposableMock).toHaveBeenCalledWith(disposable);
        expect(base._disposables.length).toBe(1);
        await base.dispose();
        expect(disposable.dispose).toHaveBeenCalledTimes(1);
      });

      it("warns and ignores registration after disposed", async () => {
        await base.dispose();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        base._registerDisposable(() => {});
        expect(base._disposables.length).toBe(0);
        expect(isDisposableMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(
          "registering disposable after disposed"
        );
        warnSpy.mockRestore();
      });

      it("ignores non-function inputs including boundary and resource cases", () => {
        const longString = "x".repeat(100000);
        const deepNested = {
          a: { b: { c: { d: { e: { f: { g: {} } } } } } },
        };
        const largeFile = {
          name: "large.bin",
          data: new Uint8Array(1024 * 1024),
        };
        const cases = [
          null,
          undefined,
          "",
          "   ",
          [],
          {},
          0,
          -1,
          Number.MAX_SAFE_INTEGER,
          "42",
          { 0: "a", length: 1 },
          deepNested,
          longString,
          largeFile,
        ];

        for (const value of cases) {
          base._registerDisposable(value);
        }

        expect(base._disposables.length).toBe(0);
        expect(isDisposableMock).toHaveBeenCalledTimes(cases.length);
      });
    });

    describe("_registerSubscription", () => {
      it("registers unsubscribe functions via _registerDisposable", () => {
        const unsubscribe = vi.fn();
        const registerSpy = vi.spyOn(base, "_registerDisposable");
        base._registerSubscription(unsubscribe);
        expect(registerSpy).toHaveBeenCalledWith(unsubscribe);
        expect(base._disposables.length).toBe(1);
        registerSpy.mockRestore();
      });

      it("ignores non-function unsubscribe values", () => {
        const registerSpy = vi.spyOn(base, "_registerDisposable");
        const cases = [
          null,
          undefined,
          "",
          "   ",
          [],
          {},
          0,
          -1,
          Number.MAX_SAFE_INTEGER,
          "123",
          { 0: "a", length: 1 },
        ];

        for (const value of cases) {
          base._registerSubscription(value);
        }

        expect(base._disposables.length).toBe(0);
        expect(registerSpy).not.toHaveBeenCalled();
        registerSpy.mockRestore();
      });
    });

    describe("_registerTimer", () => {
      it("registers interval timers by default and clears on dispose", async () => {
        const clearIntervalSpy = vi
          .spyOn(global, "clearInterval")
          .mockImplementation(() => {});
        const clearTimeoutSpy = vi
          .spyOn(global, "clearTimeout")
          .mockImplementation(() => {});
        const timerId = 123;
        base._registerTimer(timerId);
        await base.dispose();
        expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
        expect(clearTimeoutSpy).not.toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });

      it("registers timeout timers and clears string ids", async () => {
        const clearIntervalSpy = vi
          .spyOn(global, "clearInterval")
          .mockImplementation(() => {});
        const clearTimeoutSpy = vi
          .spyOn(global, "clearTimeout")
          .mockImplementation(() => {});
        const timerId = "123";
        base._registerTimer(timerId, "timeout");
        await base.dispose();
        expect(clearTimeoutSpy).toHaveBeenCalledWith(timerId);
        expect(clearIntervalSpy).not.toHaveBeenCalled();
        clearIntervalSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });

      it("handles boundary timer ids for interval", async () => {
        const clearIntervalSpy = vi
          .spyOn(global, "clearInterval")
          .mockImplementation(() => {});
        const timerIds = [0, -1, Number.MAX_SAFE_INTEGER, { 0: "a", length: 1 }];
        for (const id of timerIds) {
          base._registerTimer(id, "interval");
        }
        await base.dispose();
        const calls = clearIntervalSpy.mock.calls.map(([arg]) => arg);
        expect(calls).toHaveLength(timerIds.length);
        for (const id of timerIds) {
          expect(calls).toContain(id);
        }
        clearIntervalSpy.mockRestore();
      });
    });

    describe("dispose", () => {
      it("marks disposed and clears registered disposables", async () => {
        const cleanup = vi.fn();
        base._registerDisposable(cleanup);
        await base.dispose();
        expect(base.disposed).toBe(true);
        expect(base._disposables.length).toBe(0);
        expect(cleanup).toHaveBeenCalledTimes(1);
      });

      it("calls registered disposables in reverse order", async () => {
        const order = [];
        base._registerDisposable(() => order.push("first"));
        base._registerDisposable(() => order.push("second"));
        base._registerDisposable(() => order.push("third"));
        await base.dispose();
        expect(order).toEqual(["third", "second", "first"]);
      });

      it("awaits async disposables", async () => {
        let finished = false;
        base._registerDisposable(async () => {
          await Promise.resolve();
          finished = true;
        });
        await base.dispose();
        expect(finished).toBe(true);
      });

      it("runs _onDispose before disposables", async () => {
        const order = [];
        base._onDispose = async () => {
          order.push("hook");
          await Promise.resolve();
        };
        base._registerDisposable(() => order.push("cleanup"));
        await base.dispose();
        expect(order).toEqual(["hook", "cleanup"]);
      });

      it("logs and continues when a disposable throws", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const order = [];
        base._registerDisposable(() => order.push("after"));
        base._registerDisposable(() => {
          throw new Error("boom");
        });
        await base.dispose();
        expect(order).toEqual(["after"]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("dispose error");
        warnSpy.mockRestore();
      });

      it("handles concurrent dispose calls without double cleanup", async () => {
        const cleanup = vi.fn();
        base._registerDisposable(cleanup);
        await Promise.all([base.dispose(), base.dispose(), base.dispose()]);
        expect(cleanup).toHaveBeenCalledTimes(1);
      });
    });

    describe("_ensureNotDisposed", () => {
      it("does not throw when not disposed", () => {
        expect(() => base._ensureNotDisposed()).not.toThrow();
      });

      it("throws when disposed", async () => {
        await base.dispose();
        expect(() => base._ensureNotDisposed()).toThrow(/has been disposed/);
      });
    });
  });

  describe("default", () => {
    it("exports DisposableBase as default", () => {
      expect(DisposableBaseDefault).toBe(DisposableBase);
      const instance = new DisposableBaseDefault();
      expect(instance).toBeInstanceOf(DisposableBase);
    });
  });
});
