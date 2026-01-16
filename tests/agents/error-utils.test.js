import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  safeExec,
  catchAndLog,
  makeSafe,
  isErrorType,
  isAbortError,
  isTimeoutError,
  wrapError,
} from "../../js/agents/shared/utils/error-utils.js";

describe("shared/utils/error-utils", () => {
  describe("safeExec", () => {
    it("returns result of successful sync function", () => {
      const result = safeExec(() => 42, { context: "test" });
      assert.equal(result, 42);
    });

    it("returns fallback on sync error", () => {
      const result = safeExec(
        () => { throw new Error("fail"); },
        { context: "test", fallback: "default" }
      );
      assert.equal(result, "default");
    });

    it("returns undefined fallback by default", () => {
      const result = safeExec(
        () => { throw new Error("fail"); },
        { context: "test" }
      );
      assert.equal(result, undefined);
    });

    it("calls onError handler on sync error", () => {
      let capturedError = null;
      safeExec(
        () => { throw new Error("test error"); },
        { context: "test", onError: (err) => { capturedError = err; } }
      );
      assert.ok(capturedError);
      assert.equal(capturedError.message, "test error");
    });

    it("returns result of successful async function", async () => {
      const result = await safeExec(async () => 100, { context: "test" });
      assert.equal(result, 100);
    });

    it("returns fallback on async error", async () => {
      const result = await safeExec(
        async () => { throw new Error("async fail"); },
        { context: "test", fallback: "async default" }
      );
      assert.equal(result, "async default");
    });

    it("calls onError handler on async error", async () => {
      let capturedError = null;
      await safeExec(
        async () => { throw new Error("async error"); },
        { context: "test", onError: (err) => { capturedError = err; } }
      );
      assert.ok(capturedError);
      assert.equal(capturedError.message, "async error");
    });

    it("uses default context when not provided", () => {
      const result = safeExec(() => { throw new Error("fail"); });
      assert.equal(result, undefined);
    });
  });

  describe("catchAndLog", () => {
    it("returns fallback value", () => {
      const handler = catchAndLog("test", "fallback");
      const result = handler(new Error("test error"));
      assert.equal(result, "fallback");
    });

    it("handles non-Error objects", () => {
      const handler = catchAndLog("test", "fallback");
      const result = handler("string error");
      assert.equal(result, "fallback");
    });

    it("returns undefined when no fallback", () => {
      const handler = catchAndLog("test");
      const result = handler(new Error("test"));
      assert.equal(result, undefined);
    });

    it("can be used with promise catch", async () => {
      const result = await Promise.reject(new Error("fail"))
        .catch(catchAndLog("test", "recovered"));
      assert.equal(result, "recovered");
    });
  });

  describe("makeSafe", () => {
    it("wraps sync function", () => {
      const unsafe = () => 42;
      const safe = makeSafe(unsafe);
      assert.equal(safe(), 42);
    });

    it("catches sync errors and returns fallback", () => {
      const unsafe = () => { throw new Error("fail"); };
      const safe = makeSafe(unsafe, { fallback: "safe" });
      assert.equal(safe(), "safe");
    });

    it("wraps async function", async () => {
      const unsafe = async () => 100;
      const safe = makeSafe(unsafe);
      assert.equal(await safe(), 100);
    });

    it("catches async errors and returns fallback", async () => {
      const unsafe = async () => { throw new Error("async fail"); };
      const safe = makeSafe(unsafe, { fallback: "safe" });
      assert.equal(await safe(), "safe");
    });

    it("preserves this context", () => {
      const obj = {
        value: 10,
        method() { return this.value; },
      };
      obj.safeMethod = makeSafe(obj.method);
      assert.equal(obj.safeMethod(), 10);
    });

    it("passes arguments through", () => {
      const unsafe = (a, b) => a + b;
      const safe = makeSafe(unsafe);
      assert.equal(safe(3, 4), 7);
    });
  });

  describe("isErrorType", () => {
    it("returns true for matching error name", () => {
      const err = new TypeError("test");
      assert.ok(isErrorType(err, "TypeError"));
    });

    it("returns false for non-matching error name", () => {
      const err = new Error("test");
      assert.equal(isErrorType(err, "TypeError"), false);
    });

    it("returns false for non-Error objects", () => {
      assert.equal(isErrorType("not an error", "Error"), false);
    });

    it("returns false for null", () => {
      assert.equal(isErrorType(null, "Error"), false);
    });
  });

  describe("isAbortError", () => {
    it("returns true for AbortError name", () => {
      const err = new Error("abort");
      err.name = "AbortError";
      assert.ok(isAbortError(err));
    });

    it("returns true for ABORT_ERR code", () => {
      const err = new Error("abort");
      err.code = "ABORT_ERR";
      assert.ok(isAbortError(err));
    });

    it("returns false for regular Error", () => {
      assert.equal(isAbortError(new Error("test")), false);
    });

    it("returns false for null", () => {
      assert.equal(isAbortError(null), false);
    });
  });

  describe("isTimeoutError", () => {
    it("returns true for TimeoutError name", () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      assert.ok(isTimeoutError(err));
    });

    it("returns true for ETIMEDOUT code", () => {
      const err = new Error("timeout");
      err.code = "ETIMEDOUT";
      assert.ok(isTimeoutError(err));
    });

    it("returns false for regular Error", () => {
      assert.equal(isTimeoutError(new Error("test")), false);
    });
  });

  describe("wrapError", () => {
    it("creates wrapped error with context", () => {
      const original = new Error("original message");
      const wrapped = wrapError(original, "Additional context");

      assert.ok(wrapped.message.includes("Additional context"));
      assert.ok(wrapped.message.includes("original message"));
    });

    it("preserves original error as cause", () => {
      const original = new Error("original");
      const wrapped = wrapError(original, "Context");

      assert.equal(wrapped.cause, original);
    });

    it("includes original stack in new stack", () => {
      const original = new Error("original");
      const wrapped = wrapError(original, "Context");

      assert.ok(wrapped.stack.includes("Caused by:"));
    });
  });
});
