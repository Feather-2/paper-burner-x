
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  safeExec,
  catchAndLog,
  makeSafe,
  isErrorType,
  isAbortError,
  isTimeoutError,
  wrapError,
} from '../../../../../js/agents/shared/utils/error-utils.js';

describe("shared/utils/error-utils", () => {
  describe("safeExec", () => {
    it("returns result of successful sync function", () => {
      const result = safeExec(() => 42, { context: "test" });
      expect(result).toBe(42);
    });

    it("returns fallback on sync error", () => {
      const result = safeExec(
        () => { throw new Error("fail"); },
        { context: "test", fallback: "default" }
      );
      expect(result).toBe("default");
    });

    it("returns undefined fallback by default", () => {
      const result = safeExec(
        () => { throw new Error("fail"); },
        { context: "test" }
      );
      expect(result).toBe(undefined);
    });

    it("calls onError handler on sync error", () => {
      let capturedError = null;
      safeExec(
        () => { throw new Error("test error"); },
        { context: "test", onError: (err) => { capturedError = err; } }
      );
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe("test error");
    });

    it("returns result of successful async function", async () => {
      const result = await safeExec(async () => 100, { context: "test" });
      expect(result).toBe(100);
    });

    it("returns fallback on async error", async () => {
      const result = await safeExec(
        async () => { throw new Error("async fail"); },
        { context: "test", fallback: "async default" }
      );
      expect(result).toBe("async default");
    });

    it("calls onError handler on async error", async () => {
      let capturedError = null;
      await safeExec(
        async () => { throw new Error("async error"); },
        { context: "test", onError: (err) => { capturedError = err; } }
      );
      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe("async error");
    });

    it("uses default context when not provided", () => {
      const result = safeExec(() => { throw new Error("fail"); });
      expect(result).toBe(undefined);
    });
  });

  describe("catchAndLog", () => {
    it("returns fallback value", () => {
      const handler = catchAndLog("test", "fallback");
      const result = handler(new Error("test error"));
      expect(result).toBe("fallback");
    });

    it("handles non-Error objects", () => {
      const handler = catchAndLog("test", "fallback");
      const result = handler("string error");
      expect(result).toBe("fallback");
    });

    it("returns undefined when no fallback", () => {
      const handler = catchAndLog("test");
      const result = handler(new Error("test"));
      expect(result).toBe(undefined);
    });

    it("can be used with promise catch", async () => {
      const result = await Promise.reject(new Error("fail"))
        .catch(catchAndLog("test", "recovered"));
      expect(result).toBe("recovered");
    });
  });

  describe("makeSafe", () => {
    it("wraps sync function", () => {
      const unsafe = () => 42;
      const safe = makeSafe(unsafe);
      expect(safe()).toBe(42);
    });

    it("catches sync errors and returns fallback", () => {
      const unsafe = () => { throw new Error("fail"); };
      const safe = makeSafe(unsafe, { fallback: "safe" });
      expect(safe()).toBe("safe");
    });

    it("wraps async function", async () => {
      const unsafe = async () => 100;
      const safe = makeSafe(unsafe);
      expect(await safe()).toBe(100);
    });

    it("catches async errors and returns fallback", async () => {
      const unsafe = async () => { throw new Error("async fail"); };
      const safe = makeSafe(unsafe, { fallback: "safe" });
      expect(await safe()).toBe("safe");
    });

    it("preserves this context", () => {
      const obj = {
        value: 10,
        method() { return this.value; },
      };
      obj.safeMethod = makeSafe(obj.method);
      expect(obj.safeMethod()).toBe(10);
    });

    it("passes arguments through", () => {
      const unsafe = (a, b) => a + b;
      const safe = makeSafe(unsafe);
      expect(safe(3, 4)).toBe(7);
    });
  });

  describe("isErrorType", () => {
    it("returns true for matching error name", () => {
      const err = new TypeError("test");
      expect(isErrorType(err, "TypeError")).toBe(true);
    });

    it("returns false for non-matching error name", () => {
      const err = new Error("test");
      expect(isErrorType(err, "TypeError")).toBe(false);
    });

    it("returns false for non-Error objects", () => {
      expect(isErrorType("not an error", "Error")).toBe(false);
    });

    it("returns false for null", () => {
      expect(isErrorType(null, "Error")).toBe(false);
    });
  });

  describe("isAbortError", () => {
    it("returns true for AbortError name", () => {
      const err = new Error("abort");
      err.name = "AbortError";
      expect(isAbortError(err)).toBe(true);
    });

    it("returns true for ABORT_ERR code", () => {
      const err = new Error("abort");
      err.code = "ABORT_ERR";
      expect(isAbortError(err)).toBe(true);
    });

    it("returns false for regular Error", () => {
      expect(isAbortError(new Error("test"))).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAbortError(null)).toBe(false);
    });
  });

  describe("isTimeoutError", () => {
    it("returns true for TimeoutError name", () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      expect(isTimeoutError(err)).toBe(true);
    });

    it("returns true for ETIMEDOUT code", () => {
      const err = new Error("timeout");
      err.code = "ETIMEDOUT";
      expect(isTimeoutError(err)).toBe(true);
    });

    it("returns false for regular Error", () => {
      expect(isTimeoutError(new Error("test"))).toBe(false);
    });
  });

  describe("wrapError", () => {
    it("creates wrapped error with context", () => {
      const original = new Error("original message");
      const wrapped = wrapError(original, "Additional context");

      expect(wrapped.message).toContain("Additional context");
      expect(wrapped.message).toContain("original message");
    });

    it("preserves original error as cause", () => {
      const original = new Error("original");
      const wrapped = wrapError(original, "Context");

      expect(wrapped.cause).toBe(original);
    });

    it("includes original stack in new stack", () => {
      const original = new Error("original");
      const wrapped = wrapError(original, "Context");

      expect(wrapped.stack).toContain("Caused by:");
    });
  });
});
