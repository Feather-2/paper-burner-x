import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "external-listener",
  () => ({
    createListener: vi.fn((label) => vi.fn((...args) => ({ label, args }))),
  }),
  { virtual: true }
);

import { createListener } from "external-listener";
import { ModelEventEmitter } from "../../../../js/agents/llm/model-events.js";

describe("ModelEventEmitter", () => {
  /** @type {ModelEventEmitter} */
  let emitter;

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = new ModelEventEmitter();
  });

  it("registers listeners, emits args, and supports off/removeAllListeners", () => {
    const external = createListener("external");
    const local = vi.fn();

    expect(emitter.on("x", external)).toBe(emitter);
    emitter.on("x", local);

    expect(emitter.emit("x", 1, 2)).toBe(true);
    expect(createListener).toHaveBeenCalledWith("external");
    expect(external).toHaveBeenCalledWith(1, 2);
    expect(local).toHaveBeenCalledWith(1, 2);

    emitter.off("x", external);
    external.mockClear();
    local.mockClear();

    expect(emitter.emit("x", "v")).toBe(true);
    expect(external).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledWith("v");

    expect(emitter.removeAllListeners("x")).toBe(emitter);
    local.mockClear();
    expect(emitter.emit("x")).toBe(false);
    expect(local).not.toHaveBeenCalled();

    emitter.on("a", vi.fn());
    emitter.on("b", vi.fn());
    expect(emitter.removeAllListeners()).toBe(emitter);
    expect(emitter.emit("a")).toBe(false);
    expect(emitter.emit("b")).toBe(false);
  });

  it("no-ops for unknown events and listeners", () => {
    const listener = vi.fn();

    expect(emitter.off("missing", listener)).toBe(emitter);
    expect(emitter.removeAllListeners("missing")).toBe(emitter);
    expect(emitter.emit("missing")).toBe(false);
  });

  it("supports empty and whitespace event names", () => {
    const emptyListener = vi.fn();
    const spaceListener = vi.fn();

    emitter.on("", emptyListener);
    emitter.on("   ", spaceListener);

    expect(emitter.emit("", "empty")).toBe(true);
    expect(emptyListener).toHaveBeenCalledWith("empty");
    expect(spaceListener).not.toHaveBeenCalled();

    expect(emitter.emit("   ", "space")).toBe(true);
    expect(spaceListener).toHaveBeenCalledWith("space");
  });

  it("passes through boundary argument values unchanged", () => {
    const emptyArray = [];
    const emptyObject = {};
    const arrayLikeObject = { 0: "a", length: 1 };
    const deepNested = { level1: { level2: { level3: { value: 42 } } } };
    const longString = "l".repeat(10000);
    const largeFile = "f".repeat(1024 * 1024);

    const args = [
      null,
      undefined,
      "",
      emptyArray,
      emptyObject,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "123",
      arrayLikeObject,
      longString,
      largeFile,
      deepNested,
    ];

    const listener = vi.fn();
    emitter.on("payload", listener);

    expect(emitter.emit("payload", ...args)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    const received = listener.mock.calls[0];
    expect(received.length).toBe(args.length);
    args.forEach((value, index) => {
      expect(received[index]).toBe(value);
    });
  });

  it("emits over a snapshot when listeners mutate during emit", () => {
    const calls = [];
    let mutated = false;

    const second = vi.fn(() => calls.push("second"));
    const third = vi.fn(() => calls.push("third"));
    const first = vi.fn(() => {
      calls.push("first");
      if (!mutated) {
        mutated = true;
        emitter.off("x", second);
        emitter.on("x", third);
      }
    });

    emitter.on("x", first);
    emitter.on("x", second);

    expect(emitter.emit("x")).toBe(true);
    expect(calls).toEqual(["first", "second"]);

    calls.length = 0;
    expect(emitter.emit("x")).toBe(true);
    expect(calls).toEqual(["first", "third"]);
  });

  it("handles rapid sequential and microtask emits", async () => {
    const listener = vi.fn();
    emitter.on("x", listener);

    for (let i = 0; i < 100; i += 1) {
      expect(emitter.emit("x", i)).toBe(true);
    }
    expect(listener).toHaveBeenCalledTimes(100);
    expect(listener.mock.calls[0][0]).toBe(0);
    expect(listener.mock.calls[99][0]).toBe(99);

    listener.mockClear();

    const tasks = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() => emitter.emit("x", i))
    );
    const results = await Promise.all(tasks);

    expect(results.every(Boolean)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(50);

    const received = listener.mock.calls.map((call) => call[0]).sort((a, b) => a - b);
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("propagates listener errors and allows recovery", () => {
    const error = new Error("boom");
    const bad = vi.fn(() => {
      throw error;
    });
    const good = vi.fn();

    emitter.on("x", bad);
    emitter.on("x", good);

    expect(() => emitter.emit("x")).toThrow(error);
    expect(good).not.toHaveBeenCalled();

    emitter.off("x", bad);
    expect(emitter.emit("x", "ok")).toBe(true);
    expect(good).toHaveBeenCalledWith("ok");
  });
});
