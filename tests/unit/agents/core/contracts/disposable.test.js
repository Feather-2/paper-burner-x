import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Console, __warn } from "node:console";
import {
  isDisposable,
  safeDispose,
  disposeAll,
  using,
  createCompositeDisposable,
} from "../../../../../js/agents/core/contracts/disposable.js";

vi.mock("node:console", () => {
  const warn = vi.fn();
  function Console() {
    return { warn };
  }
  return { Console, __warn: warn };
});

const originalConsole = globalThis.console;

beforeEach(() => {
  __warn.mockClear();
  globalThis.console = new Console();
});

afterEach(() => {
  globalThis.console = originalConsole;
});

describe("isDisposable", () => {
  it("returns true for objects with dispose function", () => {
    const obj = { dispose: vi.fn() };

    expect(isDisposable(obj)).toBe(true);
  });

  it("returns false for non-disposable and boundary values", () => {
    const deepNested = { a: { b: { c: { d: {} } } } };
    const cases = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      deepNested,
      () => {},
      { dispose: "nope" },
    ];

    for (const value of cases) {
      expect(isDisposable(value)).toBe(false);
    }
  });
});

describe("safeDispose", () => {
  it("returns false for non-disposable primitives and boundary numbers", async () => {
    const cases = [0, -1, Number.MAX_SAFE_INTEGER, "123", " "];

    for (const value of cases) {
      await expect(safeDispose(value)).resolves.toBe(false);
    }
  });

  it("disposes sync resource and returns true", async () => {
    const disposable = { disposed: false, dispose: vi.fn() };

    const result = await safeDispose(disposable);

    expect(result).toBe(true);
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it("awaits async dispose for large payloads", async () => {
    const disposable = {
      file: Buffer.alloc(1024 * 1024),
      text: "x".repeat(100_000),
      dispose: vi.fn(async () => Promise.resolve()),
    };

    const result = await safeDispose(disposable);

    expect(result).toBe(true);
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips dispose when already disposed", async () => {
    const disposable = { disposed: true, dispose: vi.fn() };

    const result = await safeDispose(disposable);

    expect(result).toBe(true);
    expect(disposable.dispose).not.toHaveBeenCalled();
  });

  it("calls onError and returns false when dispose throws", async () => {
    const disposable = {
      dispose: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const onError = vi.fn();

    const result = await safeDispose(disposable, { onError });

    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(__warn).not.toHaveBeenCalled();
  });

  it("logs when onError throws", async () => {
    const disposable = {
      dispose: vi.fn(() => {
        throw new Error("fail");
      }),
    };
    const onError = vi.fn(() => {
      throw new Error("onError failed");
    });

    const result = await safeDispose(disposable, { onError });

    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(__warn).toHaveBeenCalledTimes(1);
    expect(String(__warn.mock.calls[0][1] ?? __warn.mock.calls[0][0])).toBe("[safeDispose] onError callback failed:");
  });

  it("logs when dispose throws without onError", async () => {
    const disposable = {
      dispose: vi.fn(() => {
        throw new Error("fail");
      }),
    };

    const result = await safeDispose(disposable);

    expect(result).toBe(false);
    expect(__warn).toHaveBeenCalledTimes(1);
    expect(String(__warn.mock.calls[0][1] ?? __warn.mock.calls[0][0])).toBe("[safeDispose] error:");
  });

  it("handles quick consecutive calls when dispose marks disposed", async () => {
    const disposable = {
      disposed: false,
      dispose: vi.fn(() => {
        disposable.disposed = true;
      }),
    };

    const first = await safeDispose(disposable);
    const second = await safeDispose(disposable);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("disposeAll", () => {
  it("disposes items and returns counts", async () => {
    const disposable = { dispose: vi.fn() };
    const alreadyDisposed = { disposed: true, dispose: vi.fn() };
    const nonDisposable = { value: 1 };

    const result = await disposeAll([disposable, alreadyDisposed, nonDisposable]);

    expect(disposable.dispose).toHaveBeenCalledTimes(1);
    expect(alreadyDisposed.dispose).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 3, success: 2, failed: 1 });
  });

  it("calls onError with item when dispose fails", async () => {
    const bad = {
      dispose: vi.fn(() => {
        throw new Error("bad");
      }),
    };
    const onError = vi.fn();

    const result = await disposeAll([bad], { onError });

    expect(result).toEqual({ total: 1, success: 0, failed: 1 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe(bad);
    expect(__warn).not.toHaveBeenCalled();
  });

  it("handles empty iterable", async () => {
    const result = await disposeAll([]);

    expect(result).toEqual({ total: 0, success: 0, failed: 0 });
  });

  it("throws for non-iterable objects", async () => {
    await expect(disposeAll({})).rejects.toThrow(TypeError);
  });

  it("starts disposals in parallel", async () => {
    let resolveA;
    let resolveB;
    const d1 = {
      dispose: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          })
      ),
    };
    const d2 = {
      dispose: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          })
      ),
    };

    const promise = disposeAll([d1, d2]);

    expect(d1.dispose).toHaveBeenCalledTimes(1);
    expect(d2.dispose).toHaveBeenCalledTimes(1);

    resolveA();
    resolveB();

    const result = await promise;

    expect(result.success).toBe(2);
    expect(result.failed).toBe(0);
  });
});

describe("using", () => {
  it("returns fn result and disposes resource after use", async () => {
    const order = [];
    const resource = {
      payload: "x".repeat(100_000),
      dispose: vi.fn(() => {
        order.push("dispose");
      }),
    };

    const result = await using(resource, async (value) => {
      order.push("use");
      return value.payload.length;
    });

    expect(result).toBe(resource.payload.length);
    expect(resource.dispose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["use", "dispose"]);
  });

  it("disposes even when fn throws", async () => {
    const resource = { dispose: vi.fn() };

    await expect(
      using(resource, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(resource.dispose).toHaveBeenCalledTimes(1);
  });

  it("swallows dispose errors and logs warning", async () => {
    const resource = {
      dispose: vi.fn(() => {
        throw new Error("dispose failed");
      }),
    };

    const result = await using(resource, async () => "ok");

    expect(result).toBe("ok");
    expect(__warn).toHaveBeenCalledTimes(1);
    expect(String(__warn.mock.calls[0][1] ?? __warn.mock.calls[0][0])).toBe("[safeDispose] error:");
  });
});

describe("createCompositeDisposable", () => {
  it("disposes in reverse order for functions and disposables", async () => {
    const calls = [];
    const first = { dispose: vi.fn(async () => calls.push("first")) };
    const middle = vi.fn(() => calls.push("middle"));
    const last = { dispose: vi.fn(async () => calls.push("last")) };

    const composite = createCompositeDisposable([first, middle, last]);

    await composite.dispose();

    expect(calls).toEqual(["last", "middle", "first"]);
  });

  it("adds disposables before dispose and ignores adds after", async () => {
    const disposable = { dispose: vi.fn() };
    const lateDisposable = { dispose: vi.fn() };
    const composite = createCompositeDisposable([]);

    composite.add(disposable);
    await composite.dispose();
    composite.add(lateDisposable);
    await composite.dispose();

    expect(disposable.dispose).toHaveBeenCalledTimes(1);
    expect(lateDisposable.dispose).not.toHaveBeenCalled();
    expect(composite.disposed).toBe(true);
  });

  it("is idempotent for concurrent dispose calls", async () => {
    const disposable = { dispose: vi.fn(async () => Promise.resolve()) };
    const composite = createCompositeDisposable([disposable]);

    await Promise.all([composite.dispose(), composite.dispose()]);

    expect(disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it("continues disposing when one item throws and logs warning", async () => {
    const calls = [];
    const good = {
      dispose: vi.fn(async () => {
        calls.push("good");
      }),
    };
    const bad = {
      dispose: vi.fn(() => {
        calls.push("bad");
        throw new Error("bad");
      }),
    };

    const composite = createCompositeDisposable([good, bad]);

    await composite.dispose();

    expect(calls).toEqual(["bad", "good"]);
    expect(__warn).toHaveBeenCalledTimes(1);
    expect(String(__warn.mock.calls[0][1] ?? __warn.mock.calls[0][0])).toBe("[CompositeDisposable] error:");
  });
});
