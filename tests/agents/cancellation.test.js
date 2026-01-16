import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkCancelled,
  isAbortError,
  withCancellation,
  createLinkedSignal,
} from "../../js/agents/shared/utils/cancellation.js";

describe("shared/utils/cancellation", () => {
  describe("checkCancelled", () => {
    it("does nothing for null signal", () => {
      assert.doesNotThrow(() => checkCancelled(null));
    });

    it("does nothing for undefined signal", () => {
      assert.doesNotThrow(() => checkCancelled(undefined));
    });

    it("does nothing for non-aborted signal", () => {
      const controller = new AbortController();
      assert.doesNotThrow(() => checkCancelled(controller.signal));
    });

    it("throws AbortError for aborted signal", () => {
      const controller = new AbortController();
      controller.abort();

      assert.throws(
        () => checkCancelled(controller.signal),
        (err) => err.name === "AbortError"
      );
    });

    it("uses reason message when string", () => {
      const controller = new AbortController();
      controller.abort("Custom reason");

      try {
        checkCancelled(controller.signal);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err.message.includes("Custom reason"));
      }
    });

    it("uses reason.message when Error", () => {
      const controller = new AbortController();
      controller.abort(new Error("Error reason"));

      try {
        checkCancelled(controller.signal);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err.message.includes("Error reason"));
      }
    });

    it("uses default message when reason empty", () => {
      const controller = new AbortController();
      controller.abort("");

      try {
        checkCancelled(controller.signal);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.ok(err.message.includes("cancelled"));
      }
    });

    it("sets cause to original reason", () => {
      const controller = new AbortController();
      const reason = new Error("original");
      controller.abort(reason);

      try {
        checkCancelled(controller.signal);
        assert.fail("Should have thrown");
      } catch (err) {
        assert.equal(err.cause, reason);
      }
    });

    it("handles signal-like object", () => {
      const signalLike = { aborted: true, reason: "Custom" };

      assert.throws(
        () => checkCancelled(signalLike),
        (err) => err.name === "AbortError"
      );
    });
  });

  describe("isAbortError", () => {
    it("returns true for AbortError", () => {
      const err = new Error("abort");
      err.name = "AbortError";
      assert.ok(isAbortError(err));
    });

    it("returns false for regular Error", () => {
      assert.equal(isAbortError(new Error("test")), false);
    });

    it("returns false for null", () => {
      assert.equal(isAbortError(null), false);
    });

    it("returns false for undefined", () => {
      assert.equal(isAbortError(undefined), false);
    });

    it("returns false for non-Error objects", () => {
      assert.equal(isAbortError({ name: "AbortError" }), false);
    });
  });

  describe("withCancellation", () => {
    it("wraps function with cancellation check", async () => {
      const fn = async (x, options) => x * 2;
      const wrapped = withCancellation(fn, "test");

      const result = await wrapped(5, {});
      assert.equal(result, 10);
    });

    it("throws when signal already aborted", async () => {
      const fn = async () => "should not run";
      const wrapped = withCancellation(fn, "test");

      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        () => wrapped({}, { signal: controller.signal }),
        (err) => err.name === "AbortError"
      );
    });

    it("runs function when signal not aborted", async () => {
      let called = false;
      const fn = async (opts) => {
        called = true;
        return "done";
      };
      const wrapped = withCancellation(fn, "test");

      const controller = new AbortController();
      const result = await wrapped({ signal: controller.signal });

      assert.ok(called);
      assert.equal(result, "done");
    });

    it("throws TypeError for non-function", () => {
      assert.throws(
        () => withCancellation("not a function", "test"),
        /must be a function/
      );
    });

    it("preserves this context", async () => {
      const obj = {
        value: 42,
        async method(opts) {
          return this.value;
        },
      };

      const wrapped = withCancellation(obj.method, "test");
      const result = await wrapped.call(obj, {});
      assert.equal(result, 42);
    });
  });

  describe("createLinkedSignal", () => {
    it("creates signal from null parent", () => {
      const signal = createLinkedSignal(null);
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
    });

    it("creates signal from undefined parent", () => {
      const signal = createLinkedSignal(undefined);
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
    });

    it("creates pre-aborted signal when parent already aborted", () => {
      const parent = new AbortController();
      parent.abort("parent aborted");

      const signal = createLinkedSignal(parent.signal);
      assert.ok(signal.aborted);
    });

    it("aborts when parent aborts", async () => {
      const parent = new AbortController();
      const signal = createLinkedSignal(parent.signal);

      assert.equal(signal.aborted, false);
      parent.abort();

      // Give time for abort to propagate
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(signal.aborted);
    });

    it("aborts after timeout", async () => {
      const signal = createLinkedSignal(null, 50);

      assert.equal(signal.aborted, false);

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(signal.aborted);
    });

    it("respects parent with timeout", async () => {
      const parent = new AbortController();
      const signal = createLinkedSignal(parent.signal, 5000);

      // Parent aborts before timeout
      parent.abort("early");
      await new Promise((r) => setTimeout(r, 10));

      assert.ok(signal.aborted);
    });

    it("handles invalid timeout", () => {
      const signal = createLinkedSignal(null, -100);
      assert.equal(signal.aborted, false);
    });

    it("handles NaN timeout", () => {
      const signal = createLinkedSignal(null, NaN);
      assert.equal(signal.aborted, false);
    });

    it("handles signal-like parent", async () => {
      let abortHandler = null;
      const signalLike = {
        aborted: false,
        reason: undefined,
        addEventListener: (type, handler) => {
          if (type === "abort") abortHandler = handler;
        },
        removeEventListener: () => {},
      };

      const linked = createLinkedSignal(signalLike);
      assert.equal(linked.aborted, false);
    });
  });
});
