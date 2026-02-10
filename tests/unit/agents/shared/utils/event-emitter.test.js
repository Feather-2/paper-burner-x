import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => {
  const __loggerError = vi.fn();
  const createLogger = vi.fn(() => ({
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: __loggerError,
  }));
  return { createLogger, __loggerError };
});

import EventEmitterDefault, { EventEmitter } from "../../../../../js/agents/shared/utils/event-emitter.js";
import { __loggerError as loggerError } from "../../../../../js/agents/shared/utils/logger.js";

describe("EventEmitter", () => {
  /** @type {EventEmitter} */
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
    loggerError.mockClear();
  });

  describe("constructor", () => {
    it("initializes with an empty event map", () => {
      expect(emitter._events).toBeInstanceOf(Map);
      expect(emitter._events.size).toBe(0);
    });
  });

  describe("on", () => {
    it.each([
      { label: "null", listener: null },
      { label: "undefined", listener: undefined },
      { label: "empty string", listener: "" },
      { label: "empty array", listener: [] },
      { label: "empty object", listener: {} },
    ])("throws TypeError when listener is not a function ($label)", ({ listener }) => {
      expect(() => emitter.on("evt", listener)).toThrowError(
        new TypeError("EventEmitter.on(event, listener): listener must be a function"),
      );
    });

    it("registers listeners for stringified event keys (including boundary and resource-heavy keys) and is chainable", () => {
      const longEvent = "e".repeat(10_000);
      const customEvent = { toString: () => "custom-event" };
      const events = [
        null,
        undefined,
        "",
        "   \t\n",
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        "0",
        Symbol("sym"),
        customEvent,
        longEvent,
      ];

      for (const event of events) {
        const listener = vi.fn();
        expect(emitter.on(event, listener)).toBe(emitter);

        expect(emitter.emit(event, "payload")).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith("payload");

        emitter.off(event);
      }
    });

    it("does not register the same listener twice for the same event", () => {
      const listener = vi.fn();

      emitter.on("dup", listener);
      emitter.on("dup", listener);

      expect(emitter.emit("dup")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("once", () => {
    it.each([
      { label: "null", listener: null },
      { label: "undefined", listener: undefined },
      { label: "empty string", listener: "" },
      { label: "empty array", listener: [] },
      { label: "empty object", listener: {} },
    ])("throws TypeError when listener is not a function ($label)", ({ listener }) => {
      expect(() => emitter.once("evt", listener)).toThrowError(
        new TypeError("EventEmitter.once(event, listener): listener must be a function"),
      );
    });

    it("invokes the listener only once and removes it", () => {
      const listener = vi.fn();

      expect(emitter.once("once", listener)).toBe(emitter);

      expect(emitter.emit("once", 1)).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(1);

      expect(emitter.emit("once", 2)).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("removes the once wrapper before invoking the listener (prevents recursive re-entry)", () => {
      const listener = vi.fn();
      let innerEmitReturn;

      emitter.once("recurse", () => {
        listener();
        innerEmitReturn = emitter.emit("recurse");
      });

      expect(emitter.emit("recurse")).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(innerEmitReturn).toBe(false);
    });
  });

  describe("off", () => {
    it("is a no-op and chainable when the event is unknown", () => {
      expect(emitter.off("missing", () => {})).toBe(emitter);
      expect(emitter.off("missing")).toBe(emitter);
    });

    it("removes a specific listener and deletes the event key when the last listener is removed", () => {
      const a = vi.fn();
      const b = vi.fn();

      emitter.on("evt", a).on("evt", b);
      emitter.off("evt", a);

      expect(emitter.emit("evt", "x")).toBe(true);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledWith("x");

      emitter.off("evt", b);
      expect(emitter._events.has("evt")).toBe(false);
      expect(emitter.emit("evt")).toBe(false);
    });

    it("does not remove the event key when attempting to remove a non-registered listener", () => {
      const keep = vi.fn();
      const other = vi.fn();

      emitter.on("evt", keep);
      emitter.off("evt", other);

      expect(emitter._events.has("evt")).toBe(true);
      expect(emitter.emit("evt")).toBe(true);
      expect(keep).toHaveBeenCalledTimes(1);
    });

    it.each([
      { label: "omitted", args: ["all"] },
      { label: "undefined", args: ["all", undefined] },
      { label: "null", args: ["all", null] },
      { label: "empty string", args: ["all", ""] },
      { label: "empty array", args: ["all", []] },
      { label: "empty object", args: ["all", {}] },
      { label: "zero", args: ["all", 0] },
    ])("removes all listeners when listener is not a function ($label)", ({ args }) => {
      const a = vi.fn();
      const b = vi.fn();

      emitter.on("all", a).on("all", b);

      expect(emitter.off(...args)).toBe(emitter);
      expect(emitter.emit("all")).toBe(false);
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });
  });

  describe("emit", () => {
    it("returns false when there are no listeners (including an empty listener set)", () => {
      expect(emitter.emit("none")).toBe(false);

      emitter._events.set("empty", new Set());
      expect(emitter.emit("empty")).toBe(false);
    });

    it("passes through all arguments, including empty values, boundary values, type boundaries, and deep/large payloads", () => {
      const listener = vi.fn();

      const emptyArr = [];
      const emptyObj = {};
      const objectAsArray = { 0: "a", length: 1 };
      const fileLikeContent = "x".repeat(1024 * 1024); // 1 MiB string
      const deep = {};
      let cursor = deep;
      for (let i = 0; i < 75; i += 1) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }

      const args = [
        null,
        undefined,
        "",
        emptyArr,
        emptyObj,
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        "123",
        objectAsArray,
        fileLikeContent,
        deep,
      ];

      emitter.on("args", listener);
      expect(emitter.emit("args", ...args)).toBe(true);

      expect(listener).toHaveBeenCalledTimes(1);
      const call = listener.mock.calls[0];

      expect(call).toHaveLength(args.length);
      for (let i = 0; i < args.length; i += 1) {
        expect(call[i]).toBe(args[i]);
      }

      expect(typeof call[8]).toBe("string");
      expect(Array.isArray(call[9])).toBe(false);
    });

    it("continues invoking other listeners when one throws an Error, and logs the error", () => {
      const bad = vi.fn(() => {
        throw new Error("boom");
      });
      const good = vi.fn();

      emitter.on("err", bad).on("err", good);

      expect(emitter.emit("err", "payload")).toBe(true);
      expect(good).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledWith("payload");

      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith("EventEmitter listener error: err", {
        event: "err",
        error: "boom",
      });
    });

    it("stringifies non-Error thrown values when logging, without breaking other listeners", () => {
      const bad = vi.fn(() => {
        throw "oops";
      });
      const good = vi.fn();

      emitter.on(0, bad).on(0, good);

      expect(emitter.emit(0)).toBe(true);
      expect(good).toHaveBeenCalledTimes(1);

      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith("EventEmitter listener error: 0", {
        event: "0",
        error: "oops",
      });
    });

    it("snapshots listeners so removals during emit do not prevent scheduled listeners from running", () => {
      const second = vi.fn();
      const first = vi.fn(() => {
        emitter.off("mutate", second);
      });

      emitter.on("mutate", first).on("mutate", second);

      expect(emitter.emit("mutate")).toBe(true);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);

      expect(emitter.emit("mutate")).toBe(true);
      expect(first).toHaveBeenCalledTimes(2);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("does not call listeners added during emit until the next emit", () => {
      const late = vi.fn();
      const adder = vi.fn(() => {
        emitter.on("add", late);
      });

      emitter.on("add", adder);

      expect(emitter.emit("add")).toBe(true);
      expect(adder).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();

      expect(emitter.emit("add")).toBe(true);
      expect(adder).toHaveBeenCalledTimes(2);
      expect(late).toHaveBeenCalledTimes(1);
    });

    it("handles simulated concurrent emits (microtasks) across events without cross-talk", async () => {
      const a = vi.fn();
      const b = vi.fn();
      emitter.on("a", a);
      emitter.on("b", b);

      const results = await Promise.all([
        Promise.resolve().then(() => emitter.emit("a", 1)),
        Promise.resolve().then(() => emitter.emit("b", 2)),
        Promise.resolve().then(() => emitter.emit("a", 3)),
        Promise.resolve().then(() => emitter.emit("b", 4)),
      ]);

      expect(results).toEqual([true, true, true, true]);
      expect(a).toHaveBeenCalledTimes(2);
      expect(b).toHaveBeenCalledTimes(2);

      expect(a.mock.calls.map((c) => c[0]).sort()).toEqual([1, 3]);
      expect(b.mock.calls.map((c) => c[0]).sort()).toEqual([2, 4]);
    });

    it("handles rapid consecutive emits consistently", () => {
      const listener = vi.fn();
      emitter.on("fast", listener);

      for (let i = 0; i < 200; i += 1) {
        expect(emitter.emit("fast", i)).toBe(true);
      }

      expect(listener).toHaveBeenCalledTimes(200);
    });
  });

  describe("clear", () => {
    it("clears all listeners across all events and is chainable", () => {
      const a = vi.fn();
      const b = vi.fn();

      emitter.on("a", a).on("b", b);

      expect(emitter.clear()).toBe(emitter);
      expect(emitter._events.size).toBe(0);

      expect(emitter.emit("a")).toBe(false);
      expect(emitter.emit("b")).toBe(false);
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
    });
  });
});

describe("default", () => {
  it("exports EventEmitter as the default export", () => {
    expect(EventEmitterDefault).toBe(EventEmitter);

    const emitter = new EventEmitterDefault();
    expect(emitter).toBeInstanceOf(EventEmitter);
  });
});
