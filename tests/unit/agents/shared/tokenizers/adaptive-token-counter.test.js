import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
  estimateTokensCached: vi.fn(),
  isWasmSupported: vi.fn(),
  getGlobalContainer: vi.fn(),
  tiktokenImportError: null,
  dqbdImportError: null,
  tiktokenShape: "direct",
  tiktokenGetEncoding: vi.fn(),
  tiktokenEncodingForModel: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  isPlainObject: (...args) => mocks.isPlainObject(...args),
}));

vi.mock("../../../../../js/agents/shared/utils/token-cache.js", () => ({
  estimateTokensCached: (...args) => mocks.estimateTokensCached(...args),
}));

vi.mock("../../../../../js/agents/shared/utils/wasm-support.js", () => ({
  isWasmSupported: () => mocks.isWasmSupported(),
}));

vi.mock("../../../../../js/agents/core/di/global-container.js", () => ({
  getGlobalContainer: () => mocks.getGlobalContainer(),
}));

vi.mock("tiktoken", () => {
  if (mocks.tiktokenImportError) throw mocks.tiktokenImportError;
  return {
    get get_encoding() {
      if (mocks.tiktokenShape !== "direct") return undefined;
      return (...args) => mocks.tiktokenGetEncoding(...args);
    },
    get encoding_for_model() {
      if (mocks.tiktokenShape !== "direct") return undefined;
      return (...args) => mocks.tiktokenEncodingForModel(...args);
    },
    get default() {
      if (mocks.tiktokenShape === "missing") return undefined;
      return {
        get_encoding: (...args) => mocks.tiktokenGetEncoding(...args),
        encoding_for_model: (...args) => mocks.tiktokenEncodingForModel(...args),
      };
    },
  };
});

vi.mock("@dqbd/tiktoken", () => {
  if (mocks.dqbdImportError) throw mocks.dqbdImportError;
  return {
    get_encoding: (...args) => mocks.tiktokenGetEncoding(...args),
    encoding_for_model: (...args) => mocks.tiktokenEncodingForModel(...args),
  };
});

async function loadModule() {
  return await import("../../../../../js/agents/shared/tokenizers/adaptive-token-counter.js");
}

function makeContainer() {
  const store = new Map();
  return {
    has: vi.fn((id) => store.has(id)),
    get: vi.fn((id) => store.get(id)),
    register: vi.fn((id, factory) => {
      const value = factory();
      store.set(id, value);
      return value;
    }),
    _store: store,
  };
}

let container;
let defaultEncoder;

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();

  mocks.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  mocks.estimateTokensCached.mockImplementation((text) => {
    if (!text || typeof text !== "string") return 0;
    return Math.ceil(text.length / 4);
  });

  mocks.isWasmSupported.mockReturnValue(true);
  mocks.tiktokenImportError = null;
  mocks.dqbdImportError = null;
  mocks.tiktokenShape = "direct";

  mocks.tiktokenGetEncoding.mockReset();
  mocks.tiktokenEncodingForModel.mockReset();

  defaultEncoder = {
    encode: vi.fn(() => [1, 2, 3]),
    free: vi.fn(),
  };

  mocks.tiktokenGetEncoding.mockImplementation(() => defaultEncoder);
  mocks.tiktokenEncodingForModel.mockImplementation(() => defaultEncoder);

  container = makeContainer();
  mocks.getGlobalContainer.mockReturnValue(container);
});

describe("createAdaptiveTokenCounter", () => {
  it("throws for non-plain options", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    expect(() => createAdaptiveTokenCounter("nope")).toThrow(TypeError);
    expect(() => createAdaptiveTokenCounter(null)).toThrow(TypeError);
    expect(() => createAdaptiveTokenCounter([])).toThrow(TypeError);
  });

  it("returns 0 for null, undefined, and empty string", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    const counter = createAdaptiveTokenCounter({ warmup: false });

    mocks.estimateTokensCached.mockClear();

    expect(counter.count(null)).toBe(0);
    expect(counter.count(undefined)).toBe(0);
    expect(counter.count("")).toBe(0);
    expect(mocks.estimateTokensCached).not.toHaveBeenCalled();
  });

  it("serializes empty array/object and array-like objects", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.estimateTokensCached.mockImplementation((text) => text.length);

    const counter = createAdaptiveTokenCounter({ warmup: false });
    const arrayLike = { 0: "a", length: 1 };

    expect(counter.count([])).toBe("[]".length);
    expect(counter.count({})).toBe("{}".length);

    const arrayLikeText = JSON.stringify(arrayLike);
    expect(counter.count(arrayLike)).toBe(arrayLikeText.length);

    expect(mocks.estimateTokensCached).toHaveBeenCalledWith("[]");
    expect(mocks.estimateTokensCached).toHaveBeenCalledWith("{}");
    expect(mocks.estimateTokensCached).toHaveBeenCalledWith(arrayLikeText);
  });

  it("handles numeric edges, whitespace, and numeric strings", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.estimateTokensCached.mockImplementation((text) => text.length);

    const counter = createAdaptiveTokenCounter({ warmup: false });

    expect(counter.count(0)).toBe("0".length);
    expect(counter.count(-1)).toBe("-1".length);

    const maxText = String(Number.MAX_SAFE_INTEGER);
    expect(counter.count(Number.MAX_SAFE_INTEGER)).toBe(maxText.length);

    expect(counter.count("123")).toBe(3);
    expect(counter.count("   ")).toBe(3);

    expect(mocks.estimateTokensCached).toHaveBeenCalledWith("123");
    expect(mocks.estimateTokensCached).toHaveBeenCalledWith("   ");
  });

  it("logs and coerces when JSON.stringify fails", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.estimateTokensCached.mockImplementation((text) => text.length);

    const onLog = vi.fn();
    const counter = createAdaptiveTokenCounter({ warmup: false, onLog });

    const circular = {};
    circular.self = circular;

    const count = counter.count(circular);

    expect(count).toBe("[object Object]".length);
    expect(mocks.estimateTokensCached).toHaveBeenCalledWith("[object Object]");
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("JSON.stringify failed"),
      })
    );
  });

  it("fails init when WASM is unsupported", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.isWasmSupported.mockReturnValue(false);

    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init()).resolves.toBe(false);
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: true });
    expect(mocks.tiktokenGetEncoding).not.toHaveBeenCalled();
  });

  it("uses console.warn when init fails without onLog", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.tiktokenShape = "missing";

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const counter = createAdaptiveTokenCounter({ warmup: false });
    await expect(counter.init()).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: true });

    warn.mockRestore();
  });

  it("initializes tiktoken with encoding override and counts via encoder.encode", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    const encoder = {
      encode: vi.fn(() => [1, 2, 3, 4]),
      free: vi.fn(),
    };

    mocks.tiktokenGetEncoding.mockImplementation((name) => {
      expect(name).toBe("my_enc");
      return encoder;
    });
    mocks.tiktokenEncodingForModel.mockImplementation(() => {
      throw new Error("encoding_for_model should not be called");
    });

    const counter = createAdaptiveTokenCounter({ warmup: false, encoding: " my_enc " });

    await expect(counter.init()).resolves.toBe(true);
    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });

    mocks.estimateTokensCached.mockClear();
    expect(counter.count("hello")).toBe(4);
    expect(encoder.encode).toHaveBeenCalledWith("hello");
    expect(mocks.estimateTokensCached).not.toHaveBeenCalled();
  });

  it("falls back from invalid encoding to model encoding", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    const encoder = {
      encode: vi.fn(() => new Uint32Array([1, 2, 3, 4, 5])),
      free: vi.fn(),
    };

    mocks.tiktokenGetEncoding.mockImplementation(() => {
      throw new Error("unknown encoding");
    });
    mocks.tiktokenEncodingForModel.mockImplementation((model) => {
      expect(model).toBe("gpt-test");
      return encoder;
    });

    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init({ encoding: "bad", model: "gpt-test" })).resolves.toBe(true);
    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });
    expect(counter.count("hi")).toBe(5);
  });

  it("falls back to default encodings when model lookup fails", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    const encoder = {
      encode: vi.fn(() => [1, 2]),
      free: vi.fn(),
    };

    mocks.tiktokenGetEncoding.mockImplementation((name) => {
      if (name === "o200k_base") throw new Error("missing");
      if (name === "cl100k_base") return encoder;
      throw new Error(`unexpected encoding: ${name}`);
    });
    mocks.tiktokenEncodingForModel.mockImplementation(() => {
      throw new Error("unknown model");
    });

    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init()).resolves.toBe(true);
    expect(mocks.tiktokenGetEncoding).toHaveBeenCalledWith("o200k_base");
    expect(mocks.tiktokenGetEncoding).toHaveBeenCalledWith("cl100k_base");
    expect(counter.count("ok")).toBe(2);
  });

  it("falls back to estimate when encoder returns invalid length or throws", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.estimateTokensCached.mockImplementation(() => 17);

    const encoder = {
      encode: vi.fn(() => ({ length: "nope" })),
      free: vi.fn(),
    };

    mocks.tiktokenGetEncoding.mockImplementation(() => encoder);
    mocks.tiktokenEncodingForModel.mockImplementation(() => encoder);

    const counter = createAdaptiveTokenCounter({ warmup: false });

    await expect(counter.init()).resolves.toBe(true);

    expect(counter.count("text")).toBe(17);

    encoder.encode.mockImplementation(() => {
      throw new Error("encode failed");
    });

    expect(counter.count("text")).toBe(17);
    expect(mocks.estimateTokensCached).toHaveBeenCalled();
  });

  it("dispose resets state and logs free errors", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    const onLog = vi.fn();
    const encoder = {
      encode: vi.fn(() => [1]),
      free: vi.fn(() => {
        throw new Error("free failed");
      }),
    };

    mocks.tiktokenGetEncoding.mockImplementation(() => encoder);
    mocks.tiktokenEncodingForModel.mockImplementation(() => encoder);

    const counter = createAdaptiveTokenCounter({ warmup: false, onLog });
    await expect(counter.init()).resolves.toBe(true);

    expect(() => counter.dispose()).not.toThrow();
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: false });
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining("encoder.free failed"),
      })
    );

    expect(() => counter.dispose()).not.toThrow();
  });

  it("shares init promise across concurrent calls", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    const counter = createAdaptiveTokenCounter({ warmup: false });

    const first = counter.init();
    const second = counter.init();

    const results = await Promise.all([first, second]);
    expect(results).toEqual([true, true]);
    expect(mocks.tiktokenGetEncoding).toHaveBeenCalledTimes(1);
  });

  it("schedules warmup init when warmupIdleMs is set", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();

    vi.useFakeTimers();
    mocks.tiktokenShape = "default";

    const counter = createAdaptiveTokenCounter({ warmup: true, warmupIdleMs: 25 });
    expect(counter.getStatus()).toEqual({ mode: "heuristic", ready: false, failed: false });

    await vi.advanceTimersByTimeAsync(25);
    await vi.runAllTimersAsync();

    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });

    vi.useRealTimers();
  });

  it("handles large payloads and deep nesting", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.estimateTokensCached.mockImplementation((text) => text.length);

    const counter = createAdaptiveTokenCounter({ warmup: false });

    const hugeText = "x".repeat(200000);
    const hugeCount = counter.count(hugeText);
    expect(hugeCount).toBe(hugeText.length);

    const deep = { a: { b: { c: { d: { e: "value" } } } } };
    const deepText = JSON.stringify(deep);
    expect(counter.count(deep)).toBe(deepText.length);
    expect(mocks.estimateTokensCached).toHaveBeenCalledWith(deepText);
  });

  it("supports rapid consecutive count calls", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.isWasmSupported.mockReturnValue(false);

    const counter = createAdaptiveTokenCounter({ warmup: false });
    await counter.init();

    mocks.estimateTokensCached.mockClear();

    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(counter.count(`message-${i}`));
    }

    expect(results.every((value) => typeof value === "number" && value > 0)).toBe(true);
    expect(mocks.estimateTokensCached).toHaveBeenCalledTimes(50);
  });

  it("falls back to @dqbd/tiktoken when tiktoken import fails", async () => {
    const { createAdaptiveTokenCounter } = await loadModule();
    mocks.tiktokenImportError = new Error("missing tiktoken");

    const encoder = {
      encode: vi.fn(() => [1]),
      free: vi.fn(),
    };

    mocks.tiktokenGetEncoding.mockImplementation(() => encoder);
    mocks.tiktokenEncodingForModel.mockImplementation(() => encoder);

    const counter = createAdaptiveTokenCounter({ warmup: false });
    await expect(counter.init()).resolves.toBe(true);
    expect(counter.getStatus()).toEqual({ mode: "tiktoken", ready: true, failed: false });
  });
});

describe("getGlobalTokenCounter", () => {
  it("registers and returns a shared instance", async () => {
    const { getGlobalTokenCounter } = await loadModule();
    mocks.isWasmSupported.mockReturnValue(false);

    const first = getGlobalTokenCounter();
    const second = getGlobalTokenCounter();

    expect(first).toBe(second);
    expect(container.register).toHaveBeenCalledTimes(1);
    expect(container.get).toHaveBeenCalledTimes(2);
  });

  it("returns existing service without registering", async () => {
    const { getGlobalTokenCounter } = await loadModule();

    const existing = { count: vi.fn(), init: vi.fn(), dispose: vi.fn(), getStatus: vi.fn() };
    container._store.set("tokenCounter", existing);

    const counter = getGlobalTokenCounter();
    expect(counter).toBe(existing);
    expect(container.register).not.toHaveBeenCalled();
  });
});

describe("default export", () => {
  it("exposes named exports", async () => {
    const module = await loadModule();

    expect(module.default.createAdaptiveTokenCounter).toBe(module.createAdaptiveTokenCounter);
    expect(module.default.getGlobalTokenCounter).toBe(module.getGlobalTokenCounter);
  });
});
