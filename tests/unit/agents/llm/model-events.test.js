import { describe, expect, it, vi } from "vitest";

import { ModelEventEmitter } from '../../../../js/agents/llm/model-events.js';

describe("agents/llm/model-events", () => {
  it("on/emit/off/removeAllListeners behave like a minimal EventEmitter", () => {
    const e = new ModelEventEmitter();
    const a = vi.fn();
    const b = vi.fn();

    // on() returns self
    expect(e.on("x", a)).toBe(e);
    e.on("x", b);

    expect(e.emit("x", 1, 2)).toBe(true);
    expect(a).toHaveBeenCalledWith(1, 2);
    expect(b).toHaveBeenCalledWith(1, 2);

    e.off("x", a);
    a.mockClear();
    b.mockClear();

    expect(e.emit("x", "v")).toBe(true);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("v");

    e.removeAllListeners("x");
    b.mockClear();
    expect(e.emit("x")).toBe(false);
    expect(b).not.toHaveBeenCalled();

    // removeAllListeners() without event clears everything.
    e.on("a", () => {});
    e.on("b", () => {});
    e.removeAllListeners();
    expect(e.emit("a")).toBe(false);
    expect(e.emit("b")).toBe(false);
  });

  it("emit() snapshots listeners so mutation during emit does not break iteration", () => {
    const e = new ModelEventEmitter();
    const calls = [];

    const second = () => calls.push("second");
    const first = () => {
      calls.push("first");
      e.off("x", second);
    };

    e.on("x", first);
    e.on("x", second);

    expect(e.emit("x")).toBe(true);
    // `second` still runs because emitter iterates over a snapshot copy.
    expect(calls).toEqual(["first", "second"]);
  });
});

