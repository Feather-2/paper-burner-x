import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMocks = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: loggerMocks.createLogger,
}));

import {
  safeExec,
  catchAndLog,
  makeSafe,
  isErrorType,
  isAbortError,
  isTimeoutError,
} from "../../../../../js/agents/shared/utils/error-utils.js";

beforeEach(() => {
  loggerMocks.createLogger.mockClear();
  loggerMocks.logger.debug.mockClear();
});

describe("safeExec", () => {
  it("returns sync results for empty/nullish/boundary values without logging", () => {
    const values = [
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "empty string", value: "" },
      { label: "empty array", value: [] },
      { label: "empty object", value: {} },
      { label: "zero", value: 0 },
      { label: "negative", value: -1 },
      { label: "max safe", value: Number.MAX_SAFE_INTEGER },
      { label: "whitespace", value: "   " },
      { label: "numeric string", value: "123" },
    ];

    for (const { value } of values) {
      const result = safeExec(() => value);
      expect(result).toBe(value);
    }

    expect(loggerMocks.logger.debug).not.toHaveBeenCalled();
    expect(loggerMocks.createLogger).toHaveBeenCalledTimes(values.length);
  });

  it("returns fallback and logs on sync error", () => {
    const onError = vi.fn();
    const result = safeExec(
      () => {
        throw new Error("boom");
      },
      { context: "sync", fallback: "fallback", onError }
    );

    expect(result).toBe("fallback");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:sync");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Sync error: boom");
  });

  it("returns fallback and logs on async error", async () => {
    const onError = vi.fn();
    const result = await safeExec(
      async () => {
        throw new Error("async boom");
      },
      { context: "async", fallback: "fallback", onError }
    );

    expect(result).toBe("fallback");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:async");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Async error: async boom");
  });

  it("uses default context and supports boundary context values", () => {
    safeExec(() => "ok");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:unknown");

    const contexts = ["", "   ", 0, -1, Number.MAX_SAFE_INTEGER, "123"];
    for (const context of contexts) {
      safeExec(() => "value", { context });
    }

    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:   ");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:0");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:-1");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith(
      `safe-exec:${Number.MAX_SAFE_INTEGER}`
    );
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:123");
  });

  it("handles concurrent async calls with mixed outcomes", async () => {
    const onError = vi.fn();
    const tasks = [0, 1, 2, 3].map((value) =>
      safeExec(
        async () => {
          await Promise.resolve();
          if (value % 2 === 0) {
            return value;
          }
          throw new Error(`boom-${value}`);
        },
        { context: `c${value}`, fallback: `f${value}`, onError }
      )
    );

    const results = await Promise.all(tasks);

    expect(results).toEqual([0, "f1", 2, "f3"]);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Async error: boom-1");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Async error: boom-3");
  });

  it("handles rapid sequential calls without shared state", () => {
    const results = [];
    for (let i = 0; i < 20; i += 1) {
      results.push(safeExec(() => i, { context: `seq-${i}` }));
    }

    expect(results).toEqual([
      0, 1, 2, 3, 4,
      5, 6, 7, 8, 9,
      10, 11, 12, 13, 14,
      15, 16, 17, 18, 19,
    ]);
    expect(loggerMocks.logger.debug).not.toHaveBeenCalled();
    expect(loggerMocks.createLogger).toHaveBeenCalledTimes(20);
  });
});

describe("catchAndLog", () => {
  it("returns fallback and logs Error messages", () => {
    const handler = catchAndLog("ctx", "fallback");
    const result = handler(new Error("boom"));

    expect(result).toBe("fallback");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("catch:ctx");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("boom");
  });

  it("coerces non-Error inputs including nullish and empty values", () => {
    const cases = [
      { input: null, expected: "null" },
      { input: undefined, expected: "undefined" },
      { input: "", expected: "" },
      { input: [], expected: "" },
      { input: {}, expected: "[object Object]" },
    ];

    for (const { input, expected } of cases) {
      loggerMocks.logger.debug.mockClear();
      const handler = catchAndLog("coerce", "fallback");
      const result = handler(input);
      expect(result).toBe("fallback");
      expect(loggerMocks.logger.debug).toHaveBeenCalledWith(expected);
    }
  });

  it("works with Promise.catch and returns fallback", async () => {
    const result = await Promise.reject(new Error("fail")).catch(
      catchAndLog("promise", "recovered")
    );
    expect(result).toBe("recovered");
  });

  it("handles long strings and large file-sized messages", () => {
    const longText = "a".repeat(100000);
    const hugeFileContent = "b".repeat(1024 * 1024);
    const handler = catchAndLog("resource", "fallback");

    const first = handler(new Error(longText));
    expect(first).toBe("fallback");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith(longText);

    loggerMocks.logger.debug.mockClear();

    const second = handler(new Error(hugeFileContent));
    expect(second).toBe("fallback");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith(hugeFileContent);
  });

  it("handles deeply nested objects without throwing", () => {
    const root = { level: 0 };
    let current = root;
    for (let i = 1; i <= 50; i += 1) {
      current.next = { level: i };
      current = current.next;
    }
    current.end = true;

    const handler = catchAndLog("nested", "fallback");
    const result = handler(root);

    expect(result).toBe("fallback");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("[object Object]");
  });
});

describe("makeSafe", () => {
  it("passes arguments and preserves this", () => {
    const obj = {
      value: 3,
      add(a, b) {
        return this.value + a + b;
      },
    };

    obj.safeAdd = makeSafe(obj.add);
    expect(obj.safeAdd(4, 5)).toBe(12);
  });

  it("returns fallback on sync error and uses function name as default context", () => {
    function namedFail() {
      throw new Error("fail");
    }

    const safeFail = makeSafe(namedFail, { fallback: "fallback" });
    const result = safeFail();

    expect(result).toBe("fallback");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:namedFail");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Sync error: fail");
  });

  it("returns fallback on async error", async () => {
    async function asyncFail() {
      throw new Error("async fail");
    }

    const safeAsync = makeSafe(asyncFail, { fallback: "fallback" });
    const result = await safeAsync();

    expect(result).toBe("fallback");
    expect(loggerMocks.createLogger).toHaveBeenCalledWith("safe-exec:asyncFail");
    expect(loggerMocks.logger.debug).toHaveBeenCalledWith("Async error: async fail");
  });

  it("returns fallback for type boundary mismatches", () => {
    const safeSum = makeSafe(
      function sum(a, b) {
        if (typeof a !== "number" || typeof b !== "number") {
          throw new TypeError("number");
        }
        return a + b;
      },
      { fallback: "bad" }
    );

    const safeFirst = makeSafe(
      function first(list) {
        if (!Array.isArray(list)) {
          throw new TypeError("array");
        }
        return list[0];
      },
      { fallback: "bad" }
    );

    expect(safeSum("5", 2)).toBe("bad");
    expect(safeFirst({ 0: "x", length: 1 })).toBe("bad");
  });
});

describe("isErrorType", () => {
  it("returns true for matching error names", () => {
    const err = new TypeError("test");
    expect(isErrorType(err, "TypeError")).toBe(true);
  });

  it("returns false for mismatched or empty names", () => {
    const err = new Error("test");
    expect(isErrorType(err, "TypeError")).toBe(false);
    expect(isErrorType(err, "")).toBe(false);
    expect(isErrorType(err, "   ")).toBe(false);
  });

  it.each([null, undefined, "", 0, -1, Number.MAX_SAFE_INTEGER, [], {}])(
    "returns false for non-Error input %s",
    (value) => {
      expect(isErrorType(value, "Error")).toBe(false);
    }
  );
});

describe("isAbortError", () => {
  it("returns true for AbortError name", () => {
    const err = new Error("abort");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("returns true for ABORT_ERR code even on non-Error objects", () => {
    expect(isAbortError({ code: "ABORT_ERR" })).toBe(true);
  });

  it("returns false for unrelated errors and boundary inputs", () => {
    expect(isAbortError(new Error("test"))).toBe(false);
    const cases = [null, undefined, "", [], {}, 0, -1];
    for (const value of cases) {
      expect(isAbortError(value)).toBe(false);
    }
  });
});

describe("isTimeoutError", () => {
  it("returns true for TimeoutError name", () => {
    const err = new Error("timeout");
    err.name = "TimeoutError";
    expect(isTimeoutError(err)).toBe(true);
  });

  it("returns true for ETIMEDOUT code even on non-Error objects", () => {
    expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("returns false for unrelated errors and boundary inputs", () => {
    expect(isTimeoutError(new Error("test"))).toBe(false);
    const cases = [null, undefined, "", [], {}, 0, -1];
    for (const value of cases) {
      expect(isTimeoutError(value)).toBe(false);
    }
  });
});
