import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setGlobalContainer } from '../../../../../js/agents/runtime/di/global-container.js';

let wasmSupported = true;

/** @type {"direct" | "default" | "missing"} */
let tiktokenShape = "direct";
/** @type {ReturnType<typeof vi.fn>} */
let tiktokenGetEncoding = vi.fn();
/** @type {ReturnType<typeof vi.fn>} */
let tiktokenEncodingForModel = vi.fn();

vi.mock("../../../js/agents/shared/utils/wasm-support.js", () => ({
  isWasmSupported: () => wasmSupported,
}));

vi.mock("tiktoken", () => {
  // Exports are dynamic so we can switch shapes per-test without relying on module cache resets.
  return {
    get get_encoding() {
      if (tiktokenShape !== "direct") return undefined;
      return (...args) => tiktokenGetEncoding(...args);
    },
    get encoding_for_model() {
      if (tiktokenShape !== "direct") return undefined;
      return (...args) => tiktokenEncodingForModel(...args);
    },
    get default() {
      if (tiktokenShape === "missing") return undefined;
      return {
        get_encoding: (...args) => tiktokenGetEncoding(...args),
        encoding_for_model: (...args) => tiktokenEncodingForModel(...args),
      };
    },
  };
});

async function importAdaptiveTokenCounter() {
  return await import("../../../js/agents/shared/tokenizers/adaptive-token-counter.js");
}

beforeEach(() => {
  wasmSupported = true;
  tiktokenShape = "direct";
  tiktokenGetEncoding = vi.fn();
  tiktokenEncodingForModel = vi.fn();
});

afterEach(() => {
  setGlobalContainer(null);
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("shared/tokenizers/adaptive-token-counter", () => {
  it("rejects non-plain options objects", async () => {
    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();

    expect(() => createAdaptiveTokenCounter("nope")).toThrow(TypeError);
    expect(() => createAdaptiveTokenCounter(null)).toThrow(TypeError);
    expect(() => createAdaptiveTokenCounter([])).toThrow(TypeError);
  });

  it("counts tokens heuristically and handles CJK + non-string values", async () => {
    wasmSupported = false;
    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();

    const counter = createAdaptiveTokenCounter({ warmup: false });

    expect(counter.count("abcd")).toBe(1);
    expect(counter.count("a中")).toBe(2);
    expect(counter.count("")).toBe(0);
    expect(counter.count(null)).toBe(0);

    expect(counter.count({ ok: true })).toBeGreaterThan(0);

    const cyclic = {};
    cyclic.self = cyclic;
    expect(counter.count(cyclic)).toBeGreaterThan(0);

    const status = counter.getStatus();
    expect(status.mode).toBe("heuristic");
    expect(status.failed).toBe(true);
  });

  it("logs and permanently falls back when tiktoken exports are missing", async () => {
    tiktokenShape = "missing";
    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();

    const onLog = vi.fn();
    const counter = createAdaptiveTokenCounter({ warmup: false, onLog });

    await expect(counter.init()).resolves.toBe(false);
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toMatchObject({
      level: "warn",
    });

    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: true });

    // Once failed, further init attempts short-circuit.
    await expect(counter.init()).resolves.toBe(false);
    expect(onLog).toHaveBeenCalledTimes(1);

    // Counting continues safely using heuristic path.
    expect(counter.count("abcd")).toBe(1);
  });

  it("uses default onLog (console.warn) when init fails", async () => {
    tiktokenShape = "missing";
    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/\[token-counter\]/);
  });

  it("picks an explicit encoding and uses encoder.encode() array length", async () => {
    const encoder = {
      encode: vi.fn(() => [1, 2, 3]),
      free: vi.fn(),
    };

    tiktokenGetEncoding = vi.fn((name) => {
      expect(name).toBe("my_enc");
      return encoder;
    });
    tiktokenEncodingForModel = vi.fn(() => {
      throw new Error("encoding_for_model should not be called");
    });

    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
    const counter = createAdaptiveTokenCounter({ encoding: " my_enc ", warmup: false });

    await expect(counter.init()).resolves.toBe(true);
    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });

    expect(counter.count("hello")).toBe(3);
    expect(encoder.encode).toHaveBeenCalledWith("hello");

    counter.dispose();
    expect(encoder.free).toHaveBeenCalledTimes(1);
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: false });
  });

  it("falls back from invalid encoding -> model and uses typed array length", async () => {
    const encoder = {
      encode: vi.fn(() => new Uint32Array([1, 2, 3, 4])),
      free: vi.fn(),
    };

    tiktokenGetEncoding = vi.fn(() => {
      throw new Error("unknown encoding");
    });
    tiktokenEncodingForModel = vi.fn((model) => {
      expect(model).toBe("gpt-unit-test");
      return encoder;
    });

    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init({ encoding: "bad", model: "gpt-unit-test" })).resolves.toBe(true);
    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });
    expect(counter.count("hi")).toBe(4);
  });

  it("falls back o200k_base -> cl100k_base and safely degrades on bad token shapes / encoder errors", async () => {
    const encoder = {
      encode: vi.fn(() => ({ length: "nope" })),
      free: vi.fn(() => {
        throw new Error("free failed");
      }),
    };

    tiktokenGetEncoding = vi.fn((name) => {
      if (name === "o200k_base") throw new Error("not available");
      if (name === "cl100k_base") return encoder;
      throw new Error(`unexpected encoding: ${name}`);
    });
    tiktokenEncodingForModel = vi.fn(() => {
      throw new Error("unexpected model lookup");
    });

    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init()).resolves.toBe(true);
    expect(tiktokenGetEncoding).toHaveBeenCalledWith("o200k_base");
    expect(tiktokenGetEncoding).toHaveBeenCalledWith("cl100k_base");

    // When encode returns a non-numeric length, fall back to heuristic.
    expect(counter.count("abcd")).toBe(1);

    encoder.encode.mockImplementation(() => {
      throw new Error("encode failed");
    });
    expect(counter.count("abcd")).toBe(1);

    // dispose swallows free() errors and resets state.
    expect(() => counter.dispose()).not.toThrow();
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: false });
  });

  it("supports delayed warmup via warmupIdleMs", async () => {
    vi.useFakeTimers();

    const encoder = {
      encode: vi.fn(() => [1]),
      free: vi.fn(),
    };

    tiktokenShape = "default";
    tiktokenGetEncoding = vi.fn(() => encoder);
    tiktokenEncodingForModel = vi.fn(() => encoder);

    const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
    const counter = createAdaptiveTokenCounter({ warmup: true, warmupIdleMs: 10 });

    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: false });

    await vi.advanceTimersByTimeAsync(10);
    await vi.runAllTimersAsync();

    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });
  });

  it("returns a shared process-wide global counter", async () => {
    wasmSupported = false;
    const { getGlobalTokenCounter } = await importAdaptiveTokenCounter();

    const first = getGlobalTokenCounter();
    const second = getGlobalTokenCounter();
    expect(first).toBe(second);
  });

  describe("edge cases and boundary conditions", () => {
    it("handles numeric edge values: 0, -1, MAX_SAFE_INTEGER", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      // Numbers are JSON-stringified
      expect(counter.count(0)).toBeGreaterThan(0);
      expect(counter.count(-1)).toBeGreaterThan(0);
      expect(counter.count(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(0);
      expect(counter.count(Infinity)).toBeGreaterThan(0);
      expect(counter.count(-Infinity)).toBeGreaterThan(0);
      expect(counter.count(NaN)).toBeGreaterThan(0);
    });

    it("handles pure whitespace strings", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      expect(counter.count(" ")).toBeGreaterThanOrEqual(0);
      expect(counter.count("   ")).toBeGreaterThanOrEqual(0);
      expect(counter.count("\t")).toBeGreaterThanOrEqual(0);
      expect(counter.count("\n")).toBeGreaterThanOrEqual(0);
      expect(counter.count("  \t\n  ")).toBeGreaterThanOrEqual(0);
    });

    it("handles very long strings", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      const longString = "a".repeat(100000);
      const count = counter.count(longString);
      expect(count).toBeGreaterThan(0);
      // Heuristic: ~4 chars per token
      expect(count).toBeLessThanOrEqual(30000);
    });

    it("handles concurrent/consecutive init calls", async () => {
      const encoder = {
        encode: vi.fn(() => [1, 2]),
        free: vi.fn(),
      };
      tiktokenGetEncoding = vi.fn(() => encoder);
      tiktokenEncodingForModel = vi.fn(() => encoder);

      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      // Fire multiple concurrent init calls
      const results = await Promise.all([
        counter.init(),
        counter.init(),
        counter.init(),
      ]);

      // All should resolve to the same result (true)
      expect(results.every(r => r === true)).toBe(true);
      expect(counter.getStatus().ready).toBe(true);
    });

    it("handles undefined input", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      expect(counter.count(undefined)).toBe(0);
    });

    it("handles boolean values", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      expect(counter.count(true)).toBeGreaterThan(0);
      expect(counter.count(false)).toBeGreaterThan(0);
    });

    it("handles deeply nested objects", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      const deep = { a: { b: { c: { d: { e: "value" } } } } };
      expect(counter.count(deep)).toBeGreaterThan(0);
    });

    it("handles empty array and object", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      expect(counter.count([])).toBeGreaterThan(0); // "[]"
      expect(counter.count({})).toBeGreaterThan(0); // "{}"
    });

    it("handles consecutive count calls rapidly", async () => {
      wasmSupported = false;
      const { createAdaptiveTokenCounter } = await importAdaptiveTokenCounter();
      const counter = createAdaptiveTokenCounter({ warmup: false });

      const counts = [];
      for (let i = 0; i < 100; i++) {
        counts.push(counter.count(`message ${i}`));
      }

      expect(counts.every(c => typeof c === "number" && c > 0)).toBe(true);
    });
  });
});

