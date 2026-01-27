import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../../js/agents/shared/utils/wasm-support.js";

vi.mock(
  "virtual:wasm-env",
  () => {
    function createWebAssemblyGlobal(options = {}) {
      const moduleCalls = [];
      const instanceCalls = [];

      class Module {
        constructor(bytes) {
          moduleCalls.push(bytes);
          if (options.moduleThrows) throw options.moduleThrows;
          if (Object.prototype.hasOwnProperty.call(options, "moduleReturn")) return options.moduleReturn;
        }
      }

      class Instance {
        constructor(mod) {
          instanceCalls.push(mod);
          if (options.instanceThrows) throw options.instanceThrows;
          if (Object.prototype.hasOwnProperty.call(options, "instanceReturn")) return options.instanceReturn;
        }
      }

      const wasm = {
        instantiate: Object.prototype.hasOwnProperty.call(options, "instantiate") ? options.instantiate : () => {},
        Module,
        Instance,
      };

      return { wasm, moduleCalls, instanceCalls };
    }

    function createSharedArrayBufferGlobal() {
      return function SharedArrayBuffer() {};
    }

    return { createWebAssemblyGlobal, createSharedArrayBufferGlobal };
  },
  { virtual: true },
);

const savedGlobalDescriptors = new Map();

function stubGlobalValue(name, value) {
  if (!savedGlobalDescriptors.has(name)) {
    savedGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  try {
    globalThis[name] = value;
  } catch {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

function stubGlobalDescriptor(name, descriptor) {
  if (!savedGlobalDescriptors.has(name)) {
    savedGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
}

function restoreGlobals() {
  for (const [name, originalDescriptor] of savedGlobalDescriptors.entries()) {
    try {
      if (originalDescriptor) Object.defineProperty(globalThis, name, originalDescriptor);
      else delete globalThis[name];
    } catch {
      // Best-effort restore; ignore if environment prevents restoration.
    }
  }
  savedGlobalDescriptors.clear();
}

async function loadWasmSupport() {
  return await import(modulePath);
}

async function getWasmEnv() {
  return await import("virtual:wasm-env");
}

function makeDeepObject(depth = 100) {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }
  return root;
}

const hugeArray = new Array(100_000).fill(0);
const hugeString = "x".repeat(200_000);
const deepNested = makeDeepObject(120);

const boundaryArgs = [
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
  { length: "not-a-number", 0: "a" },
  { 0: "a", 1: "b", length: 2 },
  hugeArray,
  hugeString,
  deepNested,
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  restoreGlobals();
});

describe("isWasmSupported", () => {
  it("returns false when WebAssembly is undefined", async () => {
    stubGlobalValue("WebAssembly", undefined);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
  });

  it("returns false when WebAssembly is not an object", async () => {
    stubGlobalValue("WebAssembly", "nope");

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
  });

  it("returns false when WebAssembly.instantiate is not a function", async () => {
    stubGlobalValue("WebAssembly", { instantiate: "not-a-function" });

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
  });

  it("returns true when a minimal WASM module can be instantiated", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm, moduleCalls, instanceCalls } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(true);

    expect(moduleCalls).toHaveLength(1);
    expect(moduleCalls[0]).toBeInstanceOf(Uint8Array);
    expect(Array.from(moduleCalls[0])).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

    expect(instanceCalls).toHaveLength(1);
    expect(instanceCalls[0]).toBeInstanceOf(wasm.Module);
  });

  it("returns false (and does not throw) when WebAssembly.Module throws", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal({ moduleThrows: new Error("Module boom") });

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    let result;
    expect(() => {
      result = mod.isWasmSupported();
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("returns false (and does not throw) when WebAssembly.Instance throws", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal({ instanceThrows: new Error("Instance boom") });

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    let result;
    expect(() => {
      result = mod.isWasmSupported();
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("returns false when WebAssembly.Module does not produce a Module instance", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal({ moduleReturn: {} });

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
  });

  it("returns false when WebAssembly.Instance does not produce an Instance instance", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal({ instanceReturn: {} });

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
  });

  it("caches the first computed value (true) across subsequent calls", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm, moduleCalls } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(true);

    stubGlobalValue("WebAssembly", undefined);
    expect(mod.isWasmSupported()).toBe(true);
    expect(moduleCalls).toHaveLength(1);
  });

  it("caches the first computed value (false) across subsequent calls", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm: failingWasm, moduleCalls } = createWebAssemblyGlobal({ moduleThrows: new Error("fail") });

    stubGlobalValue("WebAssembly", failingWasm);

    const mod = await loadWasmSupport();
    expect(mod.isWasmSupported()).toBe(false);
    expect(moduleCalls).toHaveLength(1);

    const { wasm: succeedingWasm } = createWebAssemblyGlobal();
    stubGlobalValue("WebAssembly", succeedingWasm);
    expect(mod.isWasmSupported()).toBe(false);
    expect(moduleCalls).toHaveLength(1);
  });

  it("is stable under rapid concurrent calls (single instantiation)", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm, moduleCalls } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);

    const mod = await loadWasmSupport();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve().then(() => mod.isWasmSupported())),
    );

    expect(results).toHaveLength(50);
    expect(results.every((value) => value === true)).toBe(true);
    expect(moduleCalls).toHaveLength(1);
  });

  it("ignores extra args (null/undefined/empty/boundary/resource types) and remains deterministic", async () => {
    stubGlobalValue("WebAssembly", undefined);

    const mod = await loadWasmSupport();
    for (const arg of boundaryArgs) {
      expect(mod.isWasmSupported(arg)).toBe(false);
    }
    expect(mod.isWasmSupported(...boundaryArgs)).toBe(false);
  });
});

describe("isWasmThreadsSupported", () => {
  it("returns false when WASM is not supported (even if other requirements are met)", async () => {
    const { createSharedArrayBufferGlobal } = await getWasmEnv();

    stubGlobalValue("WebAssembly", undefined);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());
    stubGlobalValue("crossOriginIsolated", true);

    const mod = await loadWasmSupport();
    expect(mod.isWasmThreadsSupported()).toBe(false);
  });

  it("returns false when SharedArrayBuffer is missing", async () => {
    const { createWebAssemblyGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", undefined);
    stubGlobalValue("crossOriginIsolated", true);

    const mod = await loadWasmSupport();
    expect(mod.isWasmThreadsSupported()).toBe(false);
  });

  it("returns false when crossOriginIsolated is missing or not a boolean", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());

    const mod = await loadWasmSupport();

    const nonBooleanValues = [undefined, null, 0, 1, "", "true", "false", NaN, {}, [], boundaryArgs[10], boundaryArgs[11]];
    for (const value of nonBooleanValues) {
      stubGlobalValue("crossOriginIsolated", value);
      expect(mod.isWasmThreadsSupported()).toBe(false);
    }
  });

  it("returns true when WASM + SharedArrayBuffer + crossOriginIsolated are available", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());
    stubGlobalValue("crossOriginIsolated", true);

    const mod = await loadWasmSupport();
    expect(mod.isWasmThreadsSupported()).toBe(true);
  });

  it("returns false when crossOriginIsolated is explicitly false", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());
    stubGlobalValue("crossOriginIsolated", false);

    const mod = await loadWasmSupport();
    expect(mod.isWasmThreadsSupported()).toBe(false);
  });

  it("returns false (and does not throw) when crossOriginIsolated access throws", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());

    stubGlobalDescriptor("crossOriginIsolated", {
      get() {
        throw new Error("access boom");
      },
    });

    const mod = await loadWasmSupport();
    let result;
    expect(() => {
      result = mod.isWasmThreadsSupported();
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("is stable under rapid concurrent calls (WASM support computed once)", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm, moduleCalls } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());
    stubGlobalValue("crossOriginIsolated", true);

    const mod = await loadWasmSupport();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve().then(() => mod.isWasmThreadsSupported())),
    );

    expect(results).toHaveLength(50);
    expect(results.every((value) => value === true)).toBe(true);
    expect(moduleCalls).toHaveLength(1);
  });

  it("ignores extra args (null/undefined/empty/boundary/resource types) and remains deterministic", async () => {
    const { createWebAssemblyGlobal, createSharedArrayBufferGlobal } = await getWasmEnv();
    const { wasm } = createWebAssemblyGlobal();

    stubGlobalValue("WebAssembly", wasm);
    stubGlobalValue("SharedArrayBuffer", createSharedArrayBufferGlobal());
    stubGlobalValue("crossOriginIsolated", true);

    const mod = await loadWasmSupport();
    for (const arg of boundaryArgs) {
      expect(mod.isWasmThreadsSupported(arg)).toBe(true);
    }
    expect(mod.isWasmThreadsSupported(...boundaryArgs)).toBe(true);
  });
});

describe("default export", () => {
  it("exports an object containing the named functions (same references)", async () => {
    stubGlobalValue("WebAssembly", undefined);

    const mod = await loadWasmSupport();
    expect(mod.default).toBeTypeOf("object");
    expect(mod.default).not.toBeNull();

    expect(mod.default.isWasmSupported).toBe(mod.isWasmSupported);
    expect(mod.default.isWasmThreadsSupported).toBe(mod.isWasmThreadsSupported);
  });

  it("default export functions behave the same under boundary inputs", async () => {
    stubGlobalValue("WebAssembly", undefined);

    const mod = await loadWasmSupport();
    for (const arg of boundaryArgs) {
      expect(mod.default.isWasmSupported(arg)).toBe(false);
      expect(mod.default.isWasmThreadsSupported(arg)).toBe(false);
    }
    expect(mod.default.isWasmSupported(...boundaryArgs)).toBe(false);
    expect(mod.default.isWasmThreadsSupported(...boundaryArgs)).toBe(false);
  });
});