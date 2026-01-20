import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/shared/parser/tree-sitter-wasm.js";

let wasmSupported = true;
let nodeLike = false;

const isWasmSupportedMock = vi.fn(() => wasmSupported);
const isNodeLikeMock = vi.fn(() => nodeLike);

let parserInitMock = vi.fn();
let languageLoadMock = vi.fn();
let parserShape = "valid";
let languageShape = "valid";

vi.mock("../../../../../js/agents/shared/utils/wasm-support.js", () => ({
  isWasmSupported: isWasmSupportedMock,
}));

vi.mock("../../../../../js/agents/shared/platform.js", () => ({
  isNodeLike: isNodeLikeMock,
}));

vi.mock("web-tree-sitter", () => ({
  get Parser() {
    if (parserShape === "missing") return undefined;
    if (parserShape === "noInit") return {};
    return { init: (...args) => parserInitMock(...args) };
  },
  get Language() {
    if (languageShape === "missing") return undefined;
    if (languageShape === "noLoad") return {};
    return { load: (...args) => languageLoadMock(...args) };
  },
}));

async function importTreeSitterWasm() {
  return await import(MODULE_PATH);
}

function setWebRuntime({ locationHref } = {}) {
  nodeLike = false;
  vi.stubGlobal("fetch", vi.fn());
  if (locationHref !== undefined) {
    vi.stubGlobal("location", { href: locationHref });
  }
}

function setWebTreeSitterModule({
  parserShape: nextParserShape = "valid",
  languageShape: nextLanguageShape = "valid",
  parserInitImpl,
  languageLoadImpl,
} = {}) {
  parserShape = nextParserShape;
  languageShape = nextLanguageShape;
  parserInitMock = vi.fn(parserInitImpl || (async () => {}));
  languageLoadMock = vi.fn(languageLoadImpl || (async (url) => ({ url })));
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  wasmSupported = true;
  nodeLike = false;
  parserInitMock = vi.fn();
  languageLoadMock = vi.fn();
  parserShape = "valid";
  languageShape = "valid";
});

describe("DEFAULT_TREE_SITTER_WASM_BASE_URL", () => {
  it("exports the expected default base URL", async () => {
    const mod = await importTreeSitterWasm();
    expect(mod.DEFAULT_TREE_SITTER_WASM_BASE_URL).toBe("wasm/tree-sitter/");
  });
});

describe("initTreeSitter", () => {
  it("returns null outside web runtime", async () => {
    nodeLike = true;
    const { initTreeSitter } = await importTreeSitterWasm();

    await expect(initTreeSitter()).resolves.toBeNull();
    expect(isWasmSupportedMock).not.toHaveBeenCalled();
  });

  it("throws when WebAssembly is unsupported", async () => {
    setWebRuntime();
    wasmSupported = false;
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    await expect(initTreeSitter()).rejects.toThrow("Tree-sitter requires WebAssembly support");
    expect(parserInitMock).not.toHaveBeenCalled();
  });

  it("initializes Parser/Language and resolves an absolute base URL", async () => {
    setWebRuntime({ locationHref: "https://example.com/app/" });
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    const env = await initTreeSitter({ wasmBaseUrl: "assets/tree-sitter" });

    expect(typeof env.Parser.init).toBe("function");
    expect(typeof env.Language.load).toBe("function");
    expect(env.wasmBaseUrl).toBe("https://example.com/app/assets/tree-sitter/");
    expect(parserInitMock).toHaveBeenCalledTimes(1);

    const initArg = parserInitMock.mock.calls[0][0];
    expect(typeof initArg.locateFile).toBe("function");
    expect(initArg.locateFile("tree-sitter.wasm")).toBe("https://example.com/app/assets/tree-sitter/tree-sitter.wasm");
  });

  it("reuses the in-flight promise for concurrent calls", async () => {
    setWebRuntime();
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    const first = initTreeSitter();
    const second = initTreeSitter();
    const [env1, env2] = await Promise.all([first, second]);

    expect(env1).toBe(env2);
    expect(env1).toEqual(expect.objectContaining({ Parser: expect.any(Object), Language: expect.any(Object) }));
    expect(parserInitMock).toHaveBeenCalledTimes(1);
  });

  it("returns the cached module for rapid consecutive calls", async () => {
    setWebRuntime();
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    const env1 = await initTreeSitter();
    const env2 = await initTreeSitter();

    expect(env2).toBe(env1);
    expect(parserInitMock).toHaveBeenCalledTimes(1);
  });

  it("clears the cached promise on failure and allows retry", async () => {
    setWebRuntime();
    let attempts = 0;
    setWebTreeSitterModule({
      parserInitImpl: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error("boom"));
        return Promise.resolve();
      },
    });
    const { initTreeSitter } = await importTreeSitterWasm();

    await expect(initTreeSitter()).rejects.toThrow("boom");
    await expect(initTreeSitter()).resolves.toEqual(expect.objectContaining({ wasmBaseUrl: "wasm/tree-sitter/" }));
    expect(parserInitMock).toHaveBeenCalledTimes(2);
  });

  it("throws when Parser.init is missing", async () => {
    setWebRuntime();
    setWebTreeSitterModule({ parserShape: "noInit" });
    const { initTreeSitter } = await importTreeSitterWasm();

    await expect(initTreeSitter()).rejects.toThrow("web-tree-sitter Parser.init unavailable");
  });

  it("throws when Language.load is missing", async () => {
    setWebRuntime();
    setWebTreeSitterModule({ languageShape: "noLoad" });
    const { initTreeSitter } = await importTreeSitterWasm();

    await expect(initTreeSitter()).rejects.toThrow("web-tree-sitter Language.load unavailable");
  });

  const invalidBaseValues = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace", value: "   " },
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "array-like object", value: { 0: "x", length: 1 } },
  ];

  invalidBaseValues.forEach(({ label, value }) => {
    it(`falls back to the default base URL for ${label}`, async () => {
      setWebRuntime();
      setWebTreeSitterModule();
      const { initTreeSitter, DEFAULT_TREE_SITTER_WASM_BASE_URL } = await importTreeSitterWasm();

      const env = await initTreeSitter({ wasmBaseUrl: value });
      expect(env.wasmBaseUrl).toBe(DEFAULT_TREE_SITTER_WASM_BASE_URL);
    });
  });

  it("normalizes numeric-looking base strings", async () => {
    setWebRuntime();
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    const env = await initTreeSitter({ wasmBaseUrl: "0" });
    expect(env.wasmBaseUrl).toBe("0/");
  });

  it("handles very long base URL strings", async () => {
    setWebRuntime();
    setWebTreeSitterModule();
    const { initTreeSitter } = await importTreeSitterWasm();

    const longBase = "x".repeat(5000);
    const env = await initTreeSitter({ wasmBaseUrl: longBase });
    expect(env.wasmBaseUrl).toBe(`${longBase}/`);
  });

  it("accepts deeply nested options objects", async () => {
    setWebRuntime();
    setWebTreeSitterModule();
    const { initTreeSitter, DEFAULT_TREE_SITTER_WASM_BASE_URL } = await importTreeSitterWasm();

    const deepOptions = {
      wasmBaseUrl: "   ",
      meta: { a: { b: { c: { d: { e: { f: "g" } } } } } },
    };
    const env = await initTreeSitter(deepOptions);
    expect(env.wasmBaseUrl).toBe(DEFAULT_TREE_SITTER_WASM_BASE_URL);
  });
});

describe("loadTreeSitterLanguage", () => {
  it("returns null outside web runtime", async () => {
    nodeLike = true;
    setWebTreeSitterModule();
    const { loadTreeSitterLanguage } = await importTreeSitterWasm();

    await expect(loadTreeSitterLanguage("tree-sitter-js.wasm")).resolves.toBeNull();
    expect(languageLoadMock).not.toHaveBeenCalled();
  });

  const invalidFileValues = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace", value: "   " },
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "MAX_SAFE_INTEGER", value: Number.MAX_SAFE_INTEGER },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "array-like object", value: { 0: "x", length: 1 } },
  ];

  invalidFileValues.forEach(({ label, value }) => {
    it(`throws when wasmFileName is ${label}`, async () => {
      setWebRuntime();
      setWebTreeSitterModule();
      const { loadTreeSitterLanguage } = await importTreeSitterWasm();

      await expect(loadTreeSitterLanguage(value)).rejects.toThrow(
        "loadTreeSitterLanguage(wasmFileName): wasmFileName is required",
      );
      expect(languageLoadMock).not.toHaveBeenCalled();
    });
  });

  it("trims the wasm file name and resolves the language URL", async () => {
    setWebRuntime({ locationHref: "https://example.com/app/" });
    setWebTreeSitterModule();
    const { loadTreeSitterLanguage } = await importTreeSitterWasm();

    const result = await loadTreeSitterLanguage("  tree-sitter-js.wasm  ", { wasmBaseUrl: "wasm/tree-sitter" });

    expect(languageLoadMock).toHaveBeenCalledTimes(1);
    expect(languageLoadMock).toHaveBeenCalledWith(
      "https://example.com/app/wasm/tree-sitter/tree-sitter-js.wasm",
    );
    expect(result).toEqual({ url: "https://example.com/app/wasm/tree-sitter/tree-sitter-js.wasm" });
  });

  it("accepts numeric-looking file names as strings", async () => {
    setWebRuntime({ locationHref: "https://example.com/app/" });
    setWebTreeSitterModule();
    const { loadTreeSitterLanguage } = await importTreeSitterWasm();

    const result = await loadTreeSitterLanguage("0", { wasmBaseUrl: "wasm/tree-sitter/" });

    expect(languageLoadMock).toHaveBeenCalledTimes(1);
    expect(languageLoadMock).toHaveBeenCalledWith("https://example.com/app/wasm/tree-sitter/0");
    expect(result).toEqual({ url: "https://example.com/app/wasm/tree-sitter/0" });
  });

  it("handles very long wasm file names", async () => {
    setWebRuntime({ locationHref: "https://example.com/app/" });
    setWebTreeSitterModule();
    const { loadTreeSitterLanguage } = await importTreeSitterWasm();

    const longName = `tree-sitter-${"x".repeat(10000)}.wasm`;
    const result = await loadTreeSitterLanguage(longName, { wasmBaseUrl: "wasm/tree-sitter" });
    const expectedUrl = `https://example.com/app/wasm/tree-sitter/${longName}`;

    expect(languageLoadMock).toHaveBeenCalledWith(expectedUrl);
    expect(result).toEqual({ url: expectedUrl });
    expect(result.url.length).toBeGreaterThan(10000);
  });

  it("supports concurrent language loads with shared init", async () => {
    setWebRuntime({ locationHref: "https://example.com/app/" });
    setWebTreeSitterModule();
    const { loadTreeSitterLanguage } = await importTreeSitterWasm();

    const [first, second] = await Promise.all([
      loadTreeSitterLanguage("tree-sitter-a.wasm", { wasmBaseUrl: "wasm/tree-sitter" }),
      loadTreeSitterLanguage("tree-sitter-b.wasm", { wasmBaseUrl: "wasm/tree-sitter" }),
    ]);

    expect(parserInitMock).toHaveBeenCalledTimes(1);
    expect(languageLoadMock).toHaveBeenCalledTimes(2);
    expect(first).toEqual({ url: "https://example.com/app/wasm/tree-sitter/tree-sitter-a.wasm" });
    expect(second).toEqual({ url: "https://example.com/app/wasm/tree-sitter/tree-sitter-b.wasm" });
  });
});

describe("default", () => {
  it("exposes the public API on the default export", async () => {
    const mod = await importTreeSitterWasm();

    expect(mod.default).toEqual({
      initTreeSitter: mod.initTreeSitter,
      loadTreeSitterLanguage: mod.loadTreeSitterLanguage,
      DEFAULT_TREE_SITTER_WASM_BASE_URL: mod.DEFAULT_TREE_SITTER_WASM_BASE_URL,
    });
  });
});
