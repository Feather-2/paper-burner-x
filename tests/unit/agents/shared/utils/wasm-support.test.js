
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock(
  "virtual:wasm-env",
  () => {
    const createMockWebAssembly = (options = {}) => {
      const instantiate = Object.prototype.hasOwnProperty.call(options, "instantiate")
        ? options.instantiate
        : () => {};
      const moduleBehavior = options.moduleBehavior;
      const instanceBehavior = options.instanceBehavior;

      function Module(bytes) {
        if (moduleBehavior) {
          const result = moduleBehavior(bytes);
          if (result !== undefined) return result;
        }
        return undefined;
      }

      function Instance(mod) {
        if (instanceBehavior) {
          const result = instanceBehavior(mod);
          if (result !== undefined) return result;
        }
        return undefined;
      }

      return { instantiate, Module, Instance };
    };

    const createCountingWebAssembly = () => {
      const counts = { module: 0, instance: 0 };
      const wasm = createMockWebAssembly({
        moduleBehavior: () => {
          counts.module += 1;
          return undefined;
        },
        instanceBehavior: () => {
          counts.instance += 1;
          return undefined;
        },
      });
      return { wasm, counts };
    };

    return { createMockWebAssembly, createCountingWebAssembly };
  },
  { virtual: true },
);

import { createMockWebAssembly, createCountingWebAssembly } from "virtual:wasm-env";

const modulePath = "../../../../../js/agents/shared/utils/wasm-support.js";

const baselineDescriptors = {
  WebAssembly: Object.getOwnPropertyDescriptor(globalThis, "WebAssembly"),
  SharedArrayBuffer: Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer"),
  crossOriginIsolated: Object.getOwnPropertyDescriptor(globalThis, "crossOriginIsolated"),
  Uint8Array: Object.getOwnPropertyDescriptor(globalThis, "Uint8Array"),
};

function restoreGlobal(name) {
  const descriptor = baselineDescriptors[name];
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  delete globalThis[name];
}

function restoreAllGlobals() {
  restoreGlobal("WebAssembly");
  restoreGlobal("SharedArrayBuffer");
  restoreGlobal("crossOriginIsolated");
  restoreGlobal("Uint8Array");
}

function setGlobals(globals = {}) {
  for (const [key, value] of Object.entries(globals)) {
    vi.stubGlobal(key, value);
  }
}

async function loadModuleWithGlobals(globals = {}) {
  vi.resetModules();
  vi.unstubAllGlobals();
  restoreAllGlobals();
  setGlobals(globals);
  return await import(modulePath);
}

function setThrowingGlobal(name, message) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error(message);
    },
  });
}

function makeDeepObject(depth) {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.child = { level: i };
    cursor = cursor.child;
  }
  return root;
}

function makeLongString(size) {
  return "x".repeat(size);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreAllGlobals();
  vi.resetModules();
});

describe("isWasmSupported", () => {
  it("returns true when WebAssembly can instantiate modules", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmSupported } = await loadModuleWithGlobals({ WebAssembly: wasm });
    expect(isWasmSupported()).toBe(true);
  });

  it("returns false for missing or invalid WebAssembly values", async () => {
    const values = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
    ];

    for (const value of values) {
      const { isWasmSupported } = await loadModuleWithGlobals({ WebAssembly: value });
      expect(isWasmSupported()).toBe(false);
    }
  });

  it("returns false when WebAssembly.instantiate is not a function", async () => {
    const wasm = createMockWebAssembly({ instantiate: "not-a-function" });
    const { isWasmSupported } = await loadModuleWithGlobals({ WebAssembly: wasm });
    expect(isWasmSupported()).toBe(false);
  });

  it("returns false when Module or Instance are not proper instances", async () => {
    const wasmBadModule = createMockWebAssembly({
      moduleBehavior: () => ({}),
    });
    const { isWasmSupported: moduleCheck } = await loadModuleWithGlobals({
      WebAssembly: wasmBadModule,
    });
    expect(moduleCheck()).toBe(false);

    const wasmBadInstance = createMockWebAssembly({
      instanceBehavior: () => ({}),
    });
    const { isWasmSupported: instanceCheck } = await loadModuleWithGlobals({
      WebAssembly: wasmBadInstance,
    });
    expect(instanceCheck()).toBe(false);
  });

  it("handles errors and large inputs gracefully", async () => {
    const hugeLength = 5_000_000;
    class HugeUint8Array {
      constructor() {
        return { length: hugeLength };
      }
    }

    const wasm = createMockWebAssembly({
      moduleBehavior: (bytes) => {
        if (bytes && bytes.length >= hugeLength) {
          throw new Error("too large");
        }
        return undefined;
      },
    });

    const { isWasmSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      Uint8Array: HugeUint8Array,
    });

    expect(isWasmSupported()).toBe(false);
  });

  it("caches results across rapid and concurrent calls", async () => {
    const { wasm, counts } = createCountingWebAssembly();
    const { isWasmSupported } = await loadModuleWithGlobals({ WebAssembly: wasm });

    const first = isWasmSupported();
    const rapid = [isWasmSupported(), isWasmSupported(), isWasmSupported()];
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () => Promise.resolve().then(() => isWasmSupported())),
    );

    expect(first).toBe(true);
    expect(rapid.every(Boolean)).toBe(true);
    expect(concurrent.every(Boolean)).toBe(true);
    expect(counts.module).toBe(1);
    expect(counts.instance).toBe(1);
  });
});

describe("isWasmThreadsSupported", () => {
  it("returns true when wasm is supported and threads are available", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
      crossOriginIsolated: true,
    });

    expect(isWasmThreadsSupported()).toBe(true);
  });

  it("returns false when wasm is not supported", async () => {
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: undefined,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
      crossOriginIsolated: true,
    });

    expect(isWasmThreadsSupported()).toBe(false);
  });

  it("returns false when SharedArrayBuffer is undefined", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: undefined,
      crossOriginIsolated: true,
    });

    expect(isWasmThreadsSupported()).toBe(false);
  });

  it("returns false for non-boolean crossOriginIsolated values", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
    });

    const values = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "1",
      [],
      {},
      makeDeepObject(64),
      makeLongString(100_000),
    ];

    for (const value of values) {
      vi.stubGlobal("crossOriginIsolated", value);
      expect(isWasmThreadsSupported()).toBe(false);
    }
  });

  it("returns false when global access throws", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
      crossOriginIsolated: true,
    });

    setThrowingGlobal("SharedArrayBuffer", "boom");
    expect(isWasmThreadsSupported()).toBe(false);

    const { isWasmThreadsSupported: isWasmThreadsSupported2 } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
      crossOriginIsolated: true,
    });

    setThrowingGlobal("crossOriginIsolated", "boom");
    expect(isWasmThreadsSupported2()).toBe(false);
  });

  it("handles rapid and concurrent calls consistently", async () => {
    const wasm = createMockWebAssembly();
    const { isWasmThreadsSupported } = await loadModuleWithGlobals({
      WebAssembly: wasm,
      SharedArrayBuffer: function SharedArrayBufferMock() {},
      crossOriginIsolated: true,
    });

    const rapid = [isWasmThreadsSupported(), isWasmThreadsSupported(), isWasmThreadsSupported()];
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () =>
        Promise.resolve().then(() => isWasmThreadsSupported()),
      ),
    );

    expect(rapid.every(Boolean)).toBe(true);
    expect(concurrent.every(Boolean)).toBe(true);
  });
});

describe("default export", () => {
  it("exposes the named exports by reference", async () => {
    const wasm = createMockWebAssembly();
    const mod = await loadModuleWithGlobals({ WebAssembly: wasm });

    expect(mod.default.isWasmSupported).toBe(mod.isWasmSupported);
    expect(mod.default.isWasmThreadsSupported).toBe(mod.isWasmThreadsSupported);
  });
});
