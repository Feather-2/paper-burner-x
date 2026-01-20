import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMocks = vi.hoisted(() => {
  const logger = {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

vi.mock("../../../../../js/agents/shared/utils/logger.js", () => ({
  createLogger: loggerMocks.createLogger,
}));

import EventEmitterDefault, { EventEmitter } from "../../../../../js/agents/shared/utils/event-emitter.js";

describe("EventEmitter", () => {
  /** @type {EventEmitter} */
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
    for (const fn of Object.values(loggerMocks.logger)) {
      if (typeof fn.mockClear === "function") {
        fn.mockClear();
      }
    }
  });

  describe("constructor", () => {
    it("initializes an empty event map", () => {
      expect(emitter._events).toBeInstanceOf(Map);
      expect(emitter._events.size).toBe(0);
    });
  });

  describe("on", () => {
    it("registers a listener and returns the emitter", () => {
      const listener = vi.fn();
      const result = emitter.on("ready", listener);
      expect(result).toBe(emitter);
      expect(emitter.emit("ready", 1, 2)).toBe(true);
      expect(listener).toHaveBeenCalledWith(1, 2);
    });

    it("coerces event keys for boundary values", () => {
      const cases = [
        null,
        undefined,
        "",
        [],
        {},
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        "   ",
        "123",
      ];

      for (const event of cases) {
        const listener = vi.fn();
        emitter.on(event, listener);
        const payload = { event };
        expect(emitter.emit(event, payload)).toBe(true);
        expect(listener).toHaveBeenCalledWith(payload);
        emitter.off(event, listener);
      }
    });

    it.each([null, undefined, "", 0, {}, []])("throws when listener is not a function (%s)", (value) => {
      expect(() => emitter.on("bad", value)).toThrow(TypeError);
    });
  });

  describe("once", () => {
    it("invokes the listener once and removes it", () => {
      const listener = vi.fn();
      expect(emitter.once("ping", listener)).toBe(emitter);
      expect(emitter.emit("ping", "a")).toBe(true);
      expect(emitter.emit("ping", "b")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("a");
    });

    it.each([null, undefined, "", 0, {}, []])("throws when listener is not a function (%s)", (value) => {
      expect(() => emitter.once("bad", value)).toThrow(TypeError);
    });
  });

  describe("off", () => {
    it("removes a specific listener", () => {
      const first = vi.fn();
      const second = vi.fn();
      emitter.on("evt", first).on("evt", second);
      expect(emitter.off("evt", first)).toBe(emitter);
      emitter.emit("evt", 1);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(1);
    });

    it("removes all listeners when listener is omitted or invalid", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      expect(emitter.off("evt")).toBe(emitter);
      expect(emitter.emit("evt", "x")).toBe(false);

      emitter.on("evt", listener);
      emitter.off("evt", "not-a-function");
      expect(emitter.emit("evt", "y")).toBe(false);
    });

    it("is a no-op for unknown events", () => {
      expect(emitter.off("missing")).toBe(emitter);
      expect(emitter.emit("missing")).toBe(false);
    });
  });

  describe("emit", () => {
    it("returns false when no listeners are registered", () => {
      expect(emitter.emit("none")).toBe(false);
      expect(emitter.emit(null)).toBe(false);
    });

    it("passes through boundary args without mutation", () => {
      const listener = vi.fn();
      emitter.on("payload", listener);

      const arrayLike = { 0: "a", length: 1 };
      const args = [
        null,
        undefined,
        "",
        [],
        {},
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        "   ",
        "123",
        arrayLike,
      ];

      expect(emitter.emit("payload", ...args)).toBe(true);
      expect(listener).toHaveBeenCalledWith(...args);
    });

    it("logs listener errors and continues invoking others", () => {
      const bad = vi.fn(() => {
        throw new Error("boom");
      });
      const good = vi.fn();
      emitter.on("err", bad).on("err", good);

      expect(emitter.emit("err", "x")).toBe(true);
      expect(good).toHaveBeenCalledWith("x");
      expect(loggerMocks.logger.error).toHaveBeenCalledWith("EventEmitter listener error: err", {
        event: "err",
        error: "boom",
      });
    });

    it("tolerates listener mutation during emit", () => {
      const second = vi.fn();
      const first = vi.fn(() => {
        emitter.off("mutate", second);
      });
      emitter.on("mutate", first).on("mutate", second);

      emitter.emit("mutate", "x");

      expect(first).toHaveBeenCalledWith("x");
      expect(second).toHaveBeenCalledWith("x");
    });

    it("does not invoke listeners added mid-emit until the next emit", () => {
      const late = vi.fn();
      emitter.on("late", () => {
        emitter.on("late", late);
      });

      emitter.emit("late", "first");
      expect(late).not.toHaveBeenCalled();

      emitter.emit("late", "second");
      expect(late).toHaveBeenCalledWith("second");
    });

    it("handles rapid consecutive emits", () => {
      const listener = vi.fn();
      emitter.on("burst", listener);

      for (let i = 0; i < 100; i += 1) {
        emitter.emit("burst", i);
      }

      expect(listener).toHaveBeenCalledTimes(100);
      expect(listener).toHaveBeenLastCalledWith(99);
    });

    it("handles simultaneous emits", async () => {
      const listener = vi.fn();
      emitter.on("tick", listener);

      const tasks = Array.from({ length: 25 }, (_, i) =>
        Promise.resolve().then(() => emitter.emit("tick", i)),
      );

      const results = await Promise.all(tasks);
      expect(results.every(Boolean)).toBe(true);
      expect(listener).toHaveBeenCalledTimes(25);
    });

    it("supports large payloads and deep nesting", () => {
      const listener = vi.fn();
      emitter.on("resource", listener);

      const longString = "x".repeat(200000);
      const hugeBuffer = new Uint8Array(1024 * 1024);
      let deep = {};
      let cursor = deep;
      for (let i = 0; i < 50; i += 1) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }

      expect(emitter.emit("resource", longString, hugeBuffer, deep)).toBe(true);
      const [receivedString, receivedBuffer, receivedDeep] = listener.mock.calls[0];
      expect(receivedString).toBe(longString);
      expect(receivedBuffer).toBe(hugeBuffer);
      expect(receivedDeep).toBe(deep);
    });
  });

  describe("clear", () => {
    it("clears all listeners", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      expect(emitter.clear()).toBe(emitter);
      expect(emitter.emit("evt")).toBe(false);
    });

    it("allows reuse after clear", () => {
      const listener = vi.fn();
      emitter.on("evt", listener);
      emitter.clear();
      emitter.on("evt", listener);
      emitter.emit("evt", "ok");
      expect(listener).toHaveBeenCalledWith("ok");
    });
  });
});

describe("default export", () => {
  it("exposes EventEmitter as default", () => {
    expect(EventEmitterDefault).toBe(EventEmitter);
    const instance = new EventEmitterDefault();
    expect(instance).toBeInstanceOf(EventEmitter);
  });
});
