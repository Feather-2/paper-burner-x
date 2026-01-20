
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:console", () => ({
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
}));

import * as mockedConsole from "node:console";

import {
  toErrorMessage,
  toErrorStack,
  wrapError,
  safeExec,
  safeExecAsync,
  catchAndLog,
  makeSafe,
  aggregateErrors,
} from "../../../../../js/agents/shared/utils/error-utils-extended.js";

const originalWarn = console.warn;

beforeEach(() => {
  vi.clearAllMocks();
  console.warn = mockedConsole.warn;
});

afterEach(() => {
  console.warn = originalWarn;
});

describe("shared/utils/error-utils-extended", () => {
  describe("toErrorMessage", () => {
    it("returns Unknown error for null and undefined", () => {
      expect(toErrorMessage(null)).toBe("Unknown error");
      expect(toErrorMessage(undefined)).toBe("Unknown error");
    });

    it("returns message for Error instances", () => {
      const err = new Error("boom");
      expect(toErrorMessage(err)).toBe("boom");
    });

    it("returns string inputs as-is including empty, whitespace, and numeric strings", () => {
      const inputs = ["", "   ", "123"];
      for (const input of inputs) {
        expect(toErrorMessage(input)).toBe(input);
      }
    });

    it("extracts message/error/reason fields from objects", () => {
      expect(toErrorMessage({ message: "msg" })).toBe("msg");
      expect(toErrorMessage({ error: "err" })).toBe("err");
      expect(toErrorMessage({ reason: "because" })).toBe("because");
    });

    it("stringifies objects and arrays including empty and array-like inputs", () => {
      expect(toErrorMessage({})).toBe("{}");
      expect(toErrorMessage([])).toBe("[]");
      const arrayLike = { 0: "a", length: 1 };
      expect(toErrorMessage(arrayLike)).toBe('{"0":"a","length":1}');
    });

    it("falls back to String when JSON.stringify throws", () => {
      const circular = { toString: () => "[circular]" };
      circular.self = circular;
      expect(toErrorMessage(circular)).toBe("[circular]");
    });

    it("stringifies numeric boundary values", () => {
      const values = [0, -1, Number.MAX_SAFE_INTEGER];
      for (const value of values) {
        expect(toErrorMessage(value)).toBe(String(value));
      }
    });

    it("handles long strings and large payloads", () => {
      const longText = "a".repeat(100000);
      const hugeText = "b".repeat(1024 * 1024);
      expect(toErrorMessage(longText)).toBe(longText);
      expect(toErrorMessage(hugeText)).toBe(hugeText);
    });

    it("handles deeply nested objects", () => {
      const root = { level: 0 };
      let current = root;
      for (let i = 1; i <= 50; i++) {
        current.next = { level: i };
        current = current.next;
      }
      current.end = true;

      const result = toErrorMessage(root);
      expect(result).toContain("\"end\":true");
    });
  });

  describe("toErrorStack", () => {
    it("returns stack for Error instances", () => {
      const err = new Error("stacked");
      expect(toErrorStack(err)).toBe(err.stack);
    });

    it("returns undefined for non-Error inputs", () => {
      expect(toErrorStack("nope")).toBe(undefined);
      expect(toErrorStack(null)).toBe(undefined);
      expect(toErrorStack({})).toBe(undefined);
    });
  });

  describe("wrapError", () => {
    it("wraps Error with context, cause, and stack", () => {
      const original = new Error("original");
      const wrapped = wrapError(original, "Context");

      expect(wrapped.message).toBe("Context: original");
      expect(wrapped.cause).toBe(original);
      expect(wrapped.stack).toContain("Caused by:");
      expect(wrapped.stack).toContain(original.stack);
    });

    it("wraps non-Error values without cause", () => {
      const wrapped = wrapError("boom", "Context");

      expect(wrapped.message).toBe("Context: boom");
      expect(wrapped.cause).toBe(undefined);
      expect(wrapped.stack || "").not.toContain("Caused by:");
    });
  });

  describe("safeExec", () => {
    it("returns ok true for successful calls with boundary values", () => {
      const values = [0, -1, Number.MAX_SAFE_INTEGER, "", "123", [], {}];
      for (const value of values) {
        const result = safeExec(() => value);
        expect(result.ok).toBe(true);
        expect(result.value).toBe(value);
      }
    });

    it("returns ok false with message for Error throws", () => {
      const result = safeExec(() => {
        throw new Error("fail");
      });

      expect(result).toEqual({ ok: false, error: "fail" });
    });

    it("returns ok false for non-Error throws", () => {
      const cases = [
        { thrown: "boom", expected: "boom" },
        { thrown: { error: "bad" }, expected: "bad" },
      ];

      for (const { thrown, expected } of cases) {
        const result = safeExec(() => {
          throw thrown;
        });
        expect(result).toEqual({ ok: false, error: expected });
      }
    });

    it("handles rapid consecutive calls without shared state", () => {
      const results = [];
      for (let i = 0; i < 20; i++) {
        results.push(safeExec(() => i));
      }

      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.map((result) => result.value)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
        10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      ]);
    });
  });

  describe("safeExecAsync", () => {
    it("returns ok true for resolved async calls", async () => {
      const result = await safeExecAsync(async () => "ok");
      expect(result).toEqual({ ok: true, value: "ok" });
    });

    it("returns ok false for rejected async calls with Error", async () => {
      const result = await safeExecAsync(async () => {
        throw new Error("fail");
      });

      expect(result).toEqual({ ok: false, error: "fail" });
    });

    it("returns ok false for rejected async calls with non-Error", async () => {
      const result = await safeExecAsync(async () => {
        throw "boom";
      });

      expect(result).toEqual({ ok: false, error: "boom" });
    });

    it("handles simultaneous async calls", async () => {
      const [first, second] = await Promise.all([
        safeExecAsync(async () => {
          await Promise.resolve();
          return "first";
        }),
        safeExecAsync(async () => {
          await Promise.resolve();
          return "second";
        }),
      ]);

      expect(first).toEqual({ ok: true, value: "first" });
      expect(second).toEqual({ ok: true, value: "second" });
    });

    it("handles rapid consecutive async calls", async () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(await safeExecAsync(async () => i));
      }

      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.map((result) => result.value)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });
  });

  describe("catchAndLog", () => {
    it("returns result when no error occurs", () => {
      const result = catchAndLog(() => "ok", { context: "ctx" });
      expect(result).toBe("ok");
      expect(mockedConsole.warn).not.toHaveBeenCalled();
    });

    it("calls onError and returns fallback when error occurs", () => {
      const onError = vi.fn();
      const fallback = { ok: false };
      const result = catchAndLog(() => {
        throw new Error("fail");
      }, { onError, fallback });

      expect(result).toBe(fallback);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe("fail");
      expect(mockedConsole.warn).not.toHaveBeenCalled();
    });

    it("logs with context and returns fallback for non-Error throws", () => {
      const fallback = "";
      const result = catchAndLog(() => {
        throw "boom";
      }, { context: "CTX", fallback });

      expect(result).toBe(fallback);
      expect(mockedConsole.warn).toHaveBeenCalledWith("[CTX] boom");
    });

    it("returns undefined when no fallback is provided", () => {
      const result = catchAndLog(() => {
        throw new Error("fail");
      }, { context: "ctx" });

      expect(result).toBe(undefined);
    });
  });

  describe("makeSafe", () => {
    it("wraps function and passes arguments through", () => {
      const add = (a, b) => a + b;
      const safeAdd = makeSafe(add);
      expect(safeAdd(2, 3)).toBe(5);
    });

    it("returns fallback and calls onError when wrapped function throws", () => {
      const onError = vi.fn();
      const fallback = {};
      const safeFn = makeSafe(() => {
        throw new Error("fail");
      }, { fallback, onError });

      const result = safeFn();

      expect(result).toBe(fallback);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });

  describe("aggregateErrors", () => {
    it("returns null for empty inputs including array-like objects", () => {
      expect(aggregateErrors(null)).toBe(null);
      expect(aggregateErrors(undefined)).toBe(null);
      expect(aggregateErrors([])).toBe(null);
      const arrayLike = { length: 0 };
      expect(aggregateErrors(arrayLike)).toBe(null);
    });

    it("returns the single error when only one is provided", () => {
      const err = new Error("one");
      expect(aggregateErrors([err])).toBe(err);
    });

    it("returns AggregateError with default message for multiple errors", () => {
      const errors = [new Error("a"), new Error("b")];
      const result = aggregateErrors(errors);

      expect(result).toBeInstanceOf(AggregateError);
      expect(result.message).toBe("2 errors occurred");
      expect(result.errors).toEqual(errors);
    });

    it("uses custom message when provided", () => {
      const errors = [new Error("a"), new Error("b"), new Error("c")];
      const result = aggregateErrors(errors, "custom message");

      expect(result).toBeInstanceOf(AggregateError);
      expect(result.message).toBe("custom message");
    });
  });
});
