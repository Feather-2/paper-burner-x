
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  checkCancelled,
  isAbortError,
  withCancellation,
  createLinkedSignal,
} from "../../js/agents/shared/utils/cancellation.js";

describe("shared/utils/cancellation", () => {
  describe("checkCancelled", () => {
    it("does nothing for null signal", () => {
      expect(() => checkCancelled(null)).not.toThrow();
    });

    it("does nothing for undefined signal", () => {
      expect(() => checkCancelled(undefined)).not.toThrow();
    });

    it("does nothing for non-aborted signal", () => {
      const controller = new AbortController();
      expect(() => checkCancelled(controller.signal)).not.toThrow();
    });

    it("throws AbortError for aborted signal", () => {
      const controller = new AbortController();
      controller.abort();

      expect(() => checkCancelled(controller.signal)).toThrow();
    });

    it("uses reason message when string", () => {
      const controller = new AbortController();
      controller.abort("Custom reason");

      try {
        checkCancelled(controller.signal);
        throw new Error("Should have thrown" || 'Test failed');
      } catch (err) {
        expect(err.message).toContain("Custom reason");
      }
    });

    it("uses reason.message when Error", () => {
      const controller = new AbortController();
      controller.abort(new Error("Error reason"));

      try {
        checkCancelled(controller.signal);
        throw new Error("Should have thrown" || 'Test failed');
      } catch (err) {
        expect(err.message).toContain("Error reason");
      }
    });

    it("uses default message when reason empty", () => {
      const controller = new AbortController();
      controller.abort("");

      try {
        checkCancelled(controller.signal);
        throw new Error("Should have thrown" || 'Test failed');
      } catch (err) {
        expect(err.message).toContain("cancelled");
      }
    });

    it("sets cause to original reason", () => {
      const controller = new AbortController();
      const reason = new Error("original");
      controller.abort(reason);

      try {
        checkCancelled(controller.signal);
        throw new Error("Should have thrown" || 'Test failed');
      } catch (err) {
        expect(err.cause).toBe(reason);
      }
    });

    it("handles signal-like object", () => {
      const signalLike = { aborted: true, reason: "Custom" };

      expect(() => checkCancelled(signalLike)).toThrow();
    });
  });

  describe("isAbortError", () => {
    it("returns true for AbortError", () => {
      const err = new Error("abort");
      err.name = "AbortError";
      expect(isAbortError(err)).toBe(true);
    });

    it("returns false for regular Error", () => {
      expect(isAbortError(new Error("test"))).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAbortError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isAbortError(undefined)).toBe(false);
    });

    it("returns false for non-Error objects", () => {
      expect(isAbortError({ name: "AbortError" })).toBe(false);
    });
  });

  describe("withCancellation", () => {
    it("wraps function with cancellation check", async () => {
      const fn = async (x, options) => x * 2;
      const wrapped = withCancellation(fn, "test");

      const result = await wrapped(5, {});
      expect(result).toBe(10);
    });

    it("throws when signal already aborted", async () => {
      const fn = async () => "should not run";
      const wrapped = withCancellation(fn, "test");

      const controller = new AbortController();
      controller.abort();

      await expect(() => wrapped({}, { signal: controller.signal }),
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

      expect(called).toBe(true);
      expect(result).toBe("done");
    });

    it("throws TypeError for non-function", () => {
      expect(() => withCancellation("not a function", "test")).toThrow(/must be a function/);
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
      expect(result).toBe(42);
    });
  });

  describe("createLinkedSignal", () => {
    it("creates signal from null parent", () => {
      const signal = createLinkedSignal(null);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it("creates signal from undefined parent", () => {
      const signal = createLinkedSignal(undefined);
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it("creates pre-aborted signal when parent already aborted", () => {
      const parent = new AbortController();
      parent.abort("parent aborted");

      const signal = createLinkedSignal(parent.signal);
      expect(signal.aborted).toBe(true);
    });

    it("aborts when parent aborts", async () => {
      const parent = new AbortController();
      const signal = createLinkedSignal(parent.signal);

      expect(signal.aborted).toBe(false);
      parent.abort();

      // Give time for abort to propagate
      await new Promise((r) => setTimeout(r, 10));
      expect(signal.aborted).toBe(true);
    });

    it("aborts after timeout", async () => {
      const signal = createLinkedSignal(null, 50);

      expect(signal.aborted).toBe(false);

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 100));
      expect(signal.aborted).toBe(true);
    });

    it("respects parent with timeout", async () => {
      const parent = new AbortController();
      const signal = createLinkedSignal(parent.signal, 5000);

      // Parent aborts before timeout
      parent.abort("early");
      await new Promise((r) => setTimeout(r, 10));

      expect(signal.aborted).toBe(true);
    });

    it("handles invalid timeout", () => {
      const signal = createLinkedSignal(null, -100);
      expect(signal.aborted).toBe(false);
    });

    it("handles NaN timeout", () => {
      const signal = createLinkedSignal(null, NaN);
      expect(signal.aborted).toBe(false);
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
      expect(linked.aborted).toBe(false);
    });
  });
});
