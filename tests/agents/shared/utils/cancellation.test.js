import { describe, it, expect, vi, afterEach } from "vitest";

import {
  checkCancelled,
  isAbortError,
  withCancellation,
  createLinkedSignal,
} from "../../../../js/agents/shared/utils/cancellation.js";

function createManualAbortSignal() {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const state = { aborted: false, reason: undefined };

  return {
    get aborted() {
      return state.aborted;
    },
    get reason() {
      return state.reason;
    },
    addEventListener: vi.fn((type, listener) => {
      if (type === "abort") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === "abort") listeners.delete(listener);
    }),
    abort(reason) {
      state.aborted = true;
      state.reason = reason;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("cancellation utils", () => {
  afterEach(() => {
    try {
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("checkCancelled", () => {
    it("does nothing when signal is not aborted", () => {
      const controller = new AbortController();
      expect(() => checkCancelled(controller.signal)).not.toThrow();
    });

    it("throws AbortError with a message derived from the abort reason", () => {
      const controller = new AbortController();
      controller.abort("custom reason");

      try {
        checkCancelled(controller.signal);
        throw new Error("expected checkCancelled to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("AbortError");
        expect(err.message).toBe("custom reason");
        expect(err.cause).toBe("custom reason");
      }
    });

    it("falls back to a default message when reason is empty/unknown", () => {
      const controller = new AbortController();
      controller.abort("   ");

      try {
        checkCancelled(controller.signal);
        throw new Error("expected checkCancelled to throw");
      } catch (err) {
        expect(err.name).toBe("AbortError");
        expect(err.message).toBe("Run cancelled");
        expect(err.cause).toBe("   ");
      }
    });

    it("uses the message field for Error/object abort reasons", () => {
      const controller1 = new AbortController();
      controller1.abort(new Error("from error"));

      try {
        checkCancelled(controller1.signal);
        throw new Error("expected checkCancelled to throw");
      } catch (err) {
        expect(err.name).toBe("AbortError");
        expect(err.message).toBe("from error");
        expect(err.cause).toBeInstanceOf(Error);
      }

      const controller2 = new AbortController();
      controller2.abort({ message: "from object" });

      try {
        checkCancelled(controller2.signal);
        throw new Error("expected checkCancelled to throw");
      } catch (err) {
        expect(err.name).toBe("AbortError");
        expect(err.message).toBe("from object");
        expect(err.cause).toEqual({ message: "from object" });
      }
    });
  });

  describe("isAbortError", () => {
    it("detects AbortError via name or code", () => {
      const controller = new AbortController();
      controller.abort("stop");

      let abortedErr;
      try {
        checkCancelled(controller.signal);
      } catch (err) {
        abortedErr = err;
      }

      expect(isAbortError(abortedErr)).toBe(true);
      expect(isAbortError(new Error("nope"))).toBe(false);

      const coded = /** @type {any} */ (new Error("coded"));
      coded.code = "ABORT_ERR";
      expect(isAbortError(coded)).toBe(true);
    });
  });

  describe("withCancellation", () => {
    it("validates input function type", () => {
      expect(() => withCancellation(/** @type {any} */ (null), "ctx")).toThrow(TypeError);
    });

    it("checks cancellation before calling the wrapped function", async () => {
      const fn = vi.fn(async () => "ok");
      const wrapped = withCancellation(fn, "test");

      const controller = new AbortController();
      controller.abort("stop");

      await expect(wrapped({ signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
        message: "stop",
      });
      expect(fn).not.toHaveBeenCalled();
    });

    it("preserves this-binding and forwards args transparently", async () => {
      const controller = new AbortController();
      const original = function (value, options) {
        return `${this.prefix}:${value}:${Boolean(options?.signal)}`;
      };

      const wrapped = withCancellation(original, "ctx");
      const out = await wrapped.call({ prefix: "p" }, "v", { signal: controller.signal });
      expect(out).toBe("p:v:true");
    });
  });

  describe("createLinkedSignal", () => {
    it("immediately aborts when parent is already aborted", () => {
      const parent = new AbortController();
      parent.abort("parent aborted");

      const child = createLinkedSignal(parent.signal, 1000);
      expect(child.aborted).toBe(true);
      expect(child.reason).toBe("parent aborted");
    });

    it("propagates parent abort and detaches listeners", () => {
      const parent = createManualAbortSignal();

      const child = createLinkedSignal(parent, 0);
      expect(child.aborted).toBe(false);

      parent.abort("boom");
      expect(child.aborted).toBe(true);
      expect(child.reason).toBe("boom");

      expect(parent.addEventListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
      expect(parent.removeEventListener).toHaveBeenCalled();
    });

    it("aborts on timeout when configured", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const child = createLinkedSignal(null, 10.9); // should be floored to 10
      expect(child.aborted).toBe(false);

      vi.advanceTimersByTime(10);
      expect(child.aborted).toBe(true);
      expect(child.reason).toBe("Timeout");
    });

    it("tolerates missing parent event listener APIs and non-finite timeouts", () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const parentLike = { aborted: false, reason: "x" }; // no add/removeEventListener
      const child = createLinkedSignal(parentLike, Number.NaN);
      expect(child.aborted).toBe(false);

      vi.advanceTimersByTime(100);
      expect(child.aborted).toBe(false);
    });
  });
});

