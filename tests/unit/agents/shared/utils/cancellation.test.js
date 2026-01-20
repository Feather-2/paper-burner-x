import { describe, it, expect, vi, beforeEach } from "vitest";

const errorUtilsMocks = vi.hoisted(() => ({
  isAbortError: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/utils/error-utils.js", () => ({
  isAbortError: errorUtilsMocks.isAbortError,
}));

import {
  checkCancelled,
  isAbortError,
  withCancellation,
  createLinkedSignal,
} from "../../../../../js/agents/shared/utils/cancellation.js";

const getThrownError = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw");
};

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }
  return root;
};

beforeEach(() => {
  errorUtilsMocks.isAbortError.mockReset();
  vi.useRealTimers();
});

describe("checkCancelled", () => {
  it("ignores nullish and non-aborted inputs including boundary values", () => {
    const values = [
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
      { aborted: false },
      { aborted: false, reason: "noop" },
      { aborted: 0 },
    ];

    for (const value of values) {
      expect(() => checkCancelled(value)).not.toThrow();
    }
  });

  it("throws AbortError with message and cause from string reason", () => {
    const controller = new AbortController();
    controller.abort("User cancelled");

    const err = getThrownError(() => checkCancelled(controller.signal));
    expect(err.name).toBe("AbortError");
    expect(err.message).toBe("User cancelled");
    expect(err.cause).toBe("User cancelled");
  });

  it("uses Error.message when reason is an Error", () => {
    const controller = new AbortController();
    const reason = new Error("Error reason");
    controller.abort(reason);

    const err = getThrownError(() => checkCancelled(controller.signal));
    expect(err.message).toBe("Error reason");
    expect(err.cause).toBe(reason);
  });

  it("uses reason.message when reason is an object", () => {
    const controller = new AbortController();
    const reason = { message: "from object" };
    controller.abort(reason);

    const err = getThrownError(() => checkCancelled(controller.signal));
    expect(err.message).toBe("from object");
    expect(err.cause).toBe(reason);
  });

  it("falls back to default message for empty or whitespace reasons", () => {
    const reasons = ["", "   ", { message: "" }, { message: "   " }, {}, []];

    for (const reason of reasons) {
      const controller = new AbortController();
      controller.abort(reason);
      const err = getThrownError(() => checkCancelled(controller.signal));
      expect(err.message).toBe("Run cancelled");
      expect(err.cause).toBe(reason);
    }
  });

  it("handles long and huge reason strings", () => {
    const longText = "a".repeat(100000);
    const hugeText = "b".repeat(1024 * 1024);

    const controller1 = new AbortController();
    controller1.abort(longText);
    const err1 = getThrownError(() => checkCancelled(controller1.signal));
    expect(err1.message.length).toBe(longText.length);

    const controller2 = new AbortController();
    controller2.abort(new Error(hugeText));
    const err2 = getThrownError(() => checkCancelled(controller2.signal));
    expect(err2.message.length).toBe(hugeText.length);
  });

  it("handles deeply nested reason objects without crashing", () => {
    const deepReason = buildDeepObject(50);
    const controller = new AbortController();
    controller.abort(deepReason);

    const err = getThrownError(() => checkCancelled(controller.signal));
    expect(err.message).toBe("Run cancelled");
    expect(err.cause).toBe(deepReason);
  });

  it("handles signal-like objects with aborted true", () => {
    const signalLike = { aborted: true, reason: "stop" };
    const err = getThrownError(() => checkCancelled(signalLike));
    expect(err.message).toBe("stop");
  });
});

describe("isAbortError", () => {
  it("delegates to error-utils for boundary values", () => {
    const sentinel = { code: "ABORT_ERR" };
    const cases = [
      { input: sentinel, expected: true },
      { input: null, expected: false },
      { input: undefined, expected: false },
      { input: "", expected: false },
      { input: [], expected: false },
      { input: {}, expected: false },
      { input: 0, expected: false },
      { input: -1, expected: false },
      { input: Number.MAX_SAFE_INTEGER, expected: false },
      { input: "   ", expected: false },
      { input: "123", expected: false },
    ];

    errorUtilsMocks.isAbortError.mockImplementation((value) => value === sentinel);

    for (const { input, expected } of cases) {
      expect(isAbortError(input)).toBe(expected);
    }

    expect(errorUtilsMocks.isAbortError).toHaveBeenCalledTimes(cases.length);
    cases.forEach(({ input }, index) => {
      expect(errorUtilsMocks.isAbortError).toHaveBeenNthCalledWith(index + 1, input);
    });
  });
});

describe("withCancellation", () => {
  it("throws TypeError for non-function inputs", () => {
    expect(() => withCancellation("not a function", "ctx")).toThrow(
      /must be a function/
    );
  });

  it("checks aborted signal before invoking fn", async () => {
    const fn = vi.fn(async () => "ok");
    const wrapped = withCancellation(fn, "blocked");
    const controller = new AbortController();
    controller.abort("stop");

    await expect(
      wrapped("value", { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("preserves this binding and passes array-like objects unchanged", async () => {
    const arrayLike = { 0: "a", length: 1 };
    const obj = {
      value: 7,
      async method(multiplier, list, options) {
        return { result: this.value * multiplier, list, options };
      },
    };

    const wrapped = withCancellation(obj.method, "ctx");
    const result = await wrapped.call(obj, 2, arrayLike, { signal: null });

    expect(result.result).toBe(14);
    expect(result.list).toBe(arrayLike);
    expect(Array.isArray(result.list)).toBe(false);
  });

  it("supports boundary option values with rapid sequential calls", async () => {
    const fn = vi.fn((value, options) => ({ value, options }));
    const wrapped = withCancellation(fn, "seq");

    const boundaryOptions = [
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
    ];

    const results = [];
    for (let i = 0; i < boundaryOptions.length; i += 1) {
      results.push(await wrapped(i, boundaryOptions[i]));
    }

    results.forEach((result, index) => {
      expect(result.value).toBe(index);
      expect(result.options).toBe(boundaryOptions[index]);
    });
    expect(fn).toHaveBeenCalledTimes(boundaryOptions.length);
  });

  it("handles concurrent calls with mixed abort states", async () => {
    const fn = vi.fn(async (value) => {
      await Promise.resolve();
      return value;
    });
    const wrapped = withCancellation(fn, "concurrent");

    const okController = new AbortController();
    const badController = new AbortController();
    badController.abort("nope");

    const tasks = [
      wrapped(1, { signal: okController.signal }),
      wrapped(2, { signal: okController.signal }),
      wrapped(3, { signal: badController.signal }),
    ];

    const results = await Promise.allSettled(tasks);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled.map((result) => result.value)).toEqual([1, 2]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason?.name).toBe("AbortError");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("createLinkedSignal", () => {
  it("returns active signal for nullish or non-signal parents", () => {
    const parents = [null, undefined, [], {}, { aborted: false }, { aborted: 0 }];

    for (const parent of parents) {
      const signal = createLinkedSignal(parent);
      expect(signal.aborted).toBe(false);
    }
  });

  it("returns pre-aborted signal when parent already aborted", () => {
    const parent = { aborted: true, reason: "parent aborted" };
    const signal = createLinkedSignal(parent);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("parent aborted");

    const err = getThrownError(() => checkCancelled(signal));
    expect(err.message).toBe("parent aborted");
  });

  it("aborts when parent aborts and propagates reason to all linked signals", () => {
    const parent = new AbortController();
    const signals = [
      createLinkedSignal(parent.signal),
      createLinkedSignal(parent.signal),
      createLinkedSignal(parent.signal),
    ];

    expect(signals.every((signal) => signal.aborted === false)).toBe(true);

    parent.abort("parent stop");

    for (const signal of signals) {
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("parent stop");
    }
  });

  it("aborts after timeout", () => {
    vi.useFakeTimers();
    try {
      const signal = createLinkedSignal(null, 50);
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(49);
      expect(signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("Timeout");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("honors parent abort over timeout", () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const signal = createLinkedSignal(parent.signal, 10);

      parent.abort("parent first");
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("parent first");

      vi.advanceTimersByTime(20);
      expect(signal.reason).toBe("parent first");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("does not schedule timeout for non-finite or non-positive values", () => {
    vi.useFakeTimers();
    try {
      const values = [0, -1, NaN, "123"];

      for (const value of values) {
        const signal = createLinkedSignal(null, value);
        vi.runAllTimers();
        expect(signal.aborted).toBe(false);
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("accepts very large timeout values without immediate abort", () => {
    vi.useFakeTimers();
    try {
      const signal = createLinkedSignal(null, Number.MAX_SAFE_INTEGER);
      expect(signal.aborted).toBe(false);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("handles signal-like parents and removes listeners on abort", () => {
    let capturedHandler;
    const parent = {
      aborted: false,
      reason: undefined,
      addEventListener: vi.fn((type, handler) => {
        if (type === "abort") {
          capturedHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };

    const signal = createLinkedSignal(parent);

    expect(parent.addEventListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true }
    );
    expect(typeof capturedHandler).toBe("function");

    parent.reason = "signal-like";
    capturedHandler();

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("signal-like");
    expect(parent.removeEventListener).toHaveBeenCalledWith(
      "abort",
      capturedHandler
    );
  });
});
