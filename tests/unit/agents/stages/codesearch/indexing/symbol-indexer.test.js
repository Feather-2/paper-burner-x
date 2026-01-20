import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/storage/artifact-manager.js", () => ({
  computeSha256: vi.fn(),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  const toNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  class LRUCache {
    constructor() {
      this.map = new Map();
    }

    get(key) {
      return this.map.get(key);
    }

    set(key, value) {
      this.map.set(key, value);
    }

    clear() {
      this.map.clear();
    }
  }

  return {
    initTreeSitter: vi.fn(),
    loadTreeSitterLanguage: vi.fn(),
    toNonEmptyString,
    isPlainObject,
    LRUCache,
  };
});

import SymbolIndexer, { SymbolIndexer as NamedSymbolIndexer } from "../../../../../../js/agents/stages/codesearch/indexing/symbol-indexer.js";
import CodeSearchIndexStore from "../../../../../../js/agents/stages/codesearch/indexing/index-store.js";
import { computeSha256 } from "../../../../../../js/agents/storage/artifact-manager.js";
import { initTreeSitter, loadTreeSitterLanguage } from "../../../../../../js/agents/shared/index.js";

function makeNameNode(text, row) {
  return {
    text,
    startPosition: { row },
    endPosition: { row },
    namedChildren: [],
    childForFieldName: () => null,
  };
}

function makeDeclNode(type, name, { nameRow = 0, endRow = nameRow, children = [] } = {}) {
  const nameNode = makeNameNode(name, nameRow);
  return {
    type,
    startPosition: { row: nameRow },
    endPosition: { row: endRow },
    namedChildren: Array.isArray(children) ? children : [],
    childForFieldName: (field) => (field === "name" ? nameNode : null),
  };
}

function makeWrapperNode(child) {
  return {
    type: "program",
    startPosition: { row: 0 },
    endPosition: { row: 0 },
    namedChildren: [child],
    childForFieldName: () => null,
  };
}

function makeDeepTree(depth, leaf) {
  let node = leaf;
  for (let i = 0; i < depth; i += 1) {
    node = makeWrapperNode(node);
  }
  return node;
}

function findSymbol(symbols, name) {
  return Array.isArray(symbols) ? symbols.find((sym) => sym?.name === name) : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  computeSha256.mockResolvedValue("sha-default");
  initTreeSitter.mockResolvedValue(undefined);
  loadTreeSitterLanguage.mockResolvedValue({ id: "stubLang" });
});

describe("SymbolIndexer", () => {
  it("constructs with defaults and normalizes workspaceId", () => {
    const indexer = new SymbolIndexer();
    expect(indexer.workspaceId).toBe("default");
    expect(indexer.store).toBeInstanceOf(CodeSearchIndexStore);

    const blank = new SymbolIndexer({ workspaceId: "   " });
    expect(blank.workspaceId).toBe("default");

    const fakeStore = { listSymbolRecords: vi.fn() };
    const replaced = new SymbolIndexer({ store: fakeStore, workspaceId: "ws-1" });
    expect(replaced.workspaceId).toBe("ws-1");
    expect(replaced.store).toBeInstanceOf(CodeSearchIndexStore);
  });

  it("extractSymbols uses regex for unsupported extensions and captures docs/signatures", async () => {
    const longArgs = Array.from({ length: 200 }, (_, i) => `arg${i}`).join(", ");
    const text = [
      "/**",
      " * Block doc line 1",
      " * line2",
      " */",
      "",
      `export function blockDocFunction(${longArgs}) {`,
      "  return 1;",
      "}",
      "",
      "  // Line doc 1",
      "  // Line doc 2",
      "export class LineDocClass {",
      "}",
      "",
      "export interface Foo {",
      "}",
      "",
      "export type Bar = {",
      "  a: number;",
      "}",
      "",
      "export enum Baz { A }",
    ].join("\n");

    const indexer = new SymbolIndexer();
    const symbols = await indexer.extractSymbols(text, "notes.txt");

    expect(symbols).toHaveLength(5);
    const func = findSymbol(symbols, "blockDocFunction");
    expect(func).toMatchObject({ kind: "function", parser: "regex", file: "notes.txt" });
    expect(func.doc).toBe("Block doc line 1\nline2");
    expect(func.signature.endsWith("...")).toBe(true);
    expect(func.startLine).toBe(6);

    const cls = findSymbol(symbols, "LineDocClass");
    expect(cls.doc).toBe("Line doc 1\nLine doc 2");
    expect(cls.kind).toBe("class");

    expect(findSymbol(symbols, "Foo")?.kind).toBe("interface");
    expect(findSymbol(symbols, "Bar")?.kind).toBe("type");
    expect(findSymbol(symbols, "Baz")?.kind).toBe("enum");
  });

  it("extractSymbols supports tree-sitter output with deep nesting", async () => {
    const lines = [
      "/**",
      " * Deep function doc",
      " */",
      "function deepFn() {",
      "}",
      "",
      "// Class doc",
      "class DeepClass {",
      "}",
      "interface DeepInterface {}",
      "type DeepType = string",
      "enum DeepEnum { A }",
    ];
    const text = lines.join("\n");

    const functionNode = makeDeclNode("function_declaration", "deepFn", { nameRow: 3, endRow: 4 });
    const classNode = makeDeclNode("class_declaration", "DeepClass", { nameRow: 7, endRow: 8 });
    const interfaceNode = makeDeclNode("interface_declaration", "DeepInterface", { nameRow: 9, endRow: 9 });
    const typeNode = makeDeclNode("type_alias_declaration", "DeepType", { nameRow: 10, endRow: 10 });
    const enumNode = makeDeclNode("enum_declaration", "DeepEnum", { nameRow: 11, endRow: 11 });
    const ignoredNode = {
      type: "lexical_declaration",
      startPosition: { row: 0 },
      endPosition: { row: 0 },
      namedChildren: [],
    };

    const leaf = {
      type: "program",
      startPosition: { row: 0 },
      endPosition: { row: 0 },
      namedChildren: [functionNode, classNode, interfaceNode, typeNode, enumNode, ignoredNode],
      childForFieldName: () => null,
    };
    const rootNode = makeDeepTree(25, leaf);

    const indexer = new SymbolIndexer();
    indexer._getLanguage = vi.fn(async () => ({ id: "lang" }));
    indexer._getParser = vi.fn(async () => ({
      setLanguage: vi.fn(),
      parse: vi.fn(() => ({ rootNode })),
    }));

    const symbols = await indexer.extractSymbols(text, "a.js");
    expect(symbols).toHaveLength(5);

    const func = findSymbol(symbols, "deepFn");
    expect(func).toMatchObject({ kind: "function", parser: "tree-sitter" });
    expect(func.doc).toBe("Deep function doc");

    const cls = findSymbol(symbols, "DeepClass");
    expect(cls.doc).toBe("Class doc");

    expect(findSymbol(symbols, "DeepInterface")?.kind).toBe("interface");
    expect(findSymbol(symbols, "DeepType")?.kind).toBe("type");
    expect(findSymbol(symbols, "DeepEnum")?.kind).toBe("enum");
  });

  it("extractSymbols falls back to regex when tree-sitter init fails", async () => {
    initTreeSitter.mockRejectedValue(new Error("init failed"));
    const warn = vi.fn();
    const indexer = new SymbolIndexer({ logger: { warn } });

    const symbols = await indexer.extractSymbols("export function foo() {}", "a.js");
    expect(findSymbol(symbols, "foo")?.parser).toBe("regex");
    expect(warn).toHaveBeenCalledWith(
      "[SymbolIndexer] Tree-sitter init failed; falling back to regex",
      expect.objectContaining({ error: "init failed" }),
    );
  });

  it("extractSymbols falls back to regex when language wasm load fails", async () => {
    loadTreeSitterLanguage.mockRejectedValue(new Error("no wasm"));
    const warn = vi.fn();
    const indexer = new SymbolIndexer({ logger: { warn } });

    const symbols = await indexer.extractSymbols("export function foo() {}", "a.js");
    expect(findSymbol(symbols, "foo")?.parser).toBe("regex");
    expect(warn).toHaveBeenCalledWith(
      "[SymbolIndexer] Failed to load language wasm: javascript",
      expect.objectContaining({ error: "no wasm" }),
    );
  });

  it("extractSymbols logs and falls back when parser throws non-Error", async () => {
    const warn = vi.fn();
    const indexer = new SymbolIndexer({ logger: { warn } });
    indexer._getLanguage = vi.fn(async () => ({ id: "lang" }));
    indexer._getParser = vi.fn(async () => ({
      setLanguage: vi.fn(),
      parse: () => {
        throw "parse boom";
      },
    }));

    const symbols = await indexer.extractSymbols("export function foo() {}", "a.js");
    expect(findSymbol(symbols, "foo")?.parser).toBe("regex");
    expect(warn).toHaveBeenCalledWith(
      "[SymbolIndexer] Tree-sitter parse failed; falling back to regex",
      expect.objectContaining({ file: "a.js", error: "parse boom" }),
    );
  });

  it("extractSymbols handles empty or null inputs", async () => {
    const indexer = new SymbolIndexer();
    const emptySymbols = await indexer.extractSymbols("", "notes.txt");
    expect(emptySymbols).toEqual([]);

    const nullSymbols = await indexer.extractSymbols(null, null);
    expect(nullSymbols).toEqual([]);
  });

  it("extractSymbolsAsync proxies to extractSymbols", async () => {
    const indexer = new SymbolIndexer();
    const spy = vi.spyOn(indexer, "extractSymbols").mockResolvedValue([{ name: "X" }]);

    const res = await indexer.extractSymbolsAsync("content", "a.txt");
    expect(spy).toHaveBeenCalledWith("content", "a.txt");
    expect(res).toEqual([{ name: "X" }]);
  });

  it("extractSymbols handles large files and clips long docs", async () => {
    const indexer = new SymbolIndexer();
    const filler = Array.from({ length: 5000 }, (_, i) => `const filler${i} = ${i};`).join("\n");
    const longDoc = "x".repeat(1305);
    const text = `${filler}\n/**\n * ${longDoc}\n */\nfunction huge() {}`;

    const symbols = await indexer.extractSymbols(text, "big.txt");
    const sym = findSymbol(symbols, "huge");

    expect(sym.doc.endsWith("...")).toBe(true);
    expect(sym.doc.length).toBe(1203);
  });

  it("indexFile throws when vfs or path is missing", async () => {
    const indexer = new SymbolIndexer();
    await expect(indexer.indexFile("a.txt")).rejects.toThrow("vfs.readText is required");

    const withVfs = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    await expect(withVfs.indexFile("")).rejects.toThrow("path is required");
    await expect(withVfs.indexFile(null)).rejects.toThrow("path is required");
  });

  it("indexFile skips unchanged files based on sha256", async () => {
    const store = new CodeSearchIndexStore();
    await store.putSymbolRecord("default", "a.txt", { sha256: "sha-same", symbols: [{ name: "Old" }] });

    const vfs = { readText: vi.fn().mockResolvedValue("content") };
    computeSha256.mockResolvedValue("sha-same");

    const indexer = new SymbolIndexer({ vfs, store });
    const extractSpy = vi.spyOn(indexer, "extractSymbols");
    const putSpy = vi.spyOn(store, "putSymbolRecord");

    const res = await indexer.indexFile("a.txt");
    expect(res.skipped).toBe(true);
    expect(res.symbols).toEqual([{ name: "Old" }]);
    expect(extractSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("indexFile stores symbols and bumps revision on change", async () => {
    const store = new CodeSearchIndexStore();
    await store.putSymbolRecord("default", "a.txt", { sha256: "old", symbols: [{ name: "Old" }] });

    const vfs = { readText: vi.fn().mockResolvedValue("new-content") };
    computeSha256.mockResolvedValue("new");

    const indexer = new SymbolIndexer({ vfs, store });
    const extractSpy = vi.spyOn(indexer, "extractSymbols").mockResolvedValue([{ name: "New" }]);
    const revBefore = indexer._indexRevision;

    const res = await indexer.indexFile("a.txt");
    const stored = await store.getSymbolRecord("default", "a.txt");

    expect(res).toMatchObject({ ok: true, skipped: false, path: "a.txt" });
    expect(extractSpy).toHaveBeenCalled();
    expect(stored.sha256).toBe("new");
    expect(stored.symbols).toEqual([{ name: "New" }]);
    expect(indexer._indexRevision).toBe(revBefore + 1);
  });

  it("indexFile stores even when sha256 is undefined", async () => {
    const store = new CodeSearchIndexStore();
    const vfs = { readText: vi.fn().mockResolvedValue("content") };
    computeSha256.mockResolvedValue(undefined);

    const indexer = new SymbolIndexer({ vfs, store });
    vi.spyOn(indexer, "extractSymbols").mockResolvedValue([{ name: "Sym" }]);

    const res = await indexer.indexFile("a.txt");
    const stored = await store.getSymbolRecord("default", "a.txt");

    expect(res.ok).toBe(true);
    expect(stored.sha256).toBeNull();
    expect(stored.symbols[0].name).toBe("Sym");
  });

  it("indexFile supports concurrent calls", async () => {
    const store = new CodeSearchIndexStore();
    const vfs = { readText: vi.fn(async (path) => `content-${path}`) };
    computeSha256.mockImplementation(async (data) => `sha-${String(data).length}`);

    const indexer = new SymbolIndexer({ vfs, store });
    vi.spyOn(indexer, "extractSymbols").mockImplementation(async (_text, path) => [{ name: `Sym-${path}` }]);

    const [resA, resB] = await Promise.all([indexer.indexFile("a.txt"), indexer.indexFile("b.txt")]);
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);

    const recordA = await store.getSymbolRecord("default", "a.txt");
    const recordB = await store.getSymbolRecord("default", "b.txt");
    expect(recordA.symbols[0].name).toBe("Sym-a.txt");
    expect(recordB.symbols[0].name).toBe("Sym-b.txt");
  });

  it("indexFile skips on rapid consecutive calls", async () => {
    const store = new CodeSearchIndexStore();
    const vfs = { readText: vi.fn().mockResolvedValue("same") };
    computeSha256.mockResolvedValue("sha-same");

    const indexer = new SymbolIndexer({ vfs, store });
    const extractSpy = vi.spyOn(indexer, "extractSymbols").mockResolvedValue([{ name: "Same" }]);

    const first = await indexer.indexFile("a.txt");
    const second = await indexer.indexFile("a.txt");

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it("indexFiles treats non-array or empty arrays as no-ops", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    const spy = vi.spyOn(indexer, "indexFile").mockResolvedValue({ ok: true });

    const resObject = await indexer.indexFiles({});
    const resEmpty = await indexer.indexFiles([]);

    expect(resObject).toEqual([]);
    expect(resEmpty).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("indexFiles skips invalid paths and indexes valid ones", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    const spy = vi.spyOn(indexer, "indexFile").mockResolvedValue({ ok: true, path: "good.txt" });

    const res = await indexer.indexFiles([null, undefined, "", "   ", "good.txt"]);
    expect(res).toEqual([{ ok: true, path: "good.txt" }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("good.txt");
  });

  it("indexFiles stringifies non-Error throws", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    vi.spyOn(indexer, "indexFile").mockImplementation(async () => {
      throw "boom";
    });

    const res = await indexer.indexFiles(["a.txt"]);
    expect(res).toEqual([{ ok: false, path: "a.txt", error: "boom" }]);
  });

  it("query filters by pathPrefix and matches case-insensitively", async () => {
    const store = new CodeSearchIndexStore();
    await store.putSymbolRecord("default", "src/a.js", {
      sha256: "1",
      symbols: [{ name: "Alpha" }, { name: "beta" }],
    });
    await store.putSymbolRecord("default", "lib/b.js", {
      sha256: "2",
      symbols: [{ name: "Gamma" }],
    });

    const indexer = new SymbolIndexer({ store, workspaceId: "default" });
    const res = await indexer.query({ query: "A", pathPrefix: "src/" });
    expect(res.map((sym) => sym.name)).toEqual(["Alpha", "beta"]);
  });

  it("query ignores invalid symbols and non-array rows", async () => {
    const store = new CodeSearchIndexStore();
    vi.spyOn(store, "listSymbolRecords").mockResolvedValue([
      { workspaceId: "default", path: "bad.js", symbols: null },
      {
        workspaceId: "default",
        path: "good.js",
        symbols: [null, "bad", {}, { name: " " }, { name: "Ok" }],
      },
    ]);

    const indexer = new SymbolIndexer({ store });
    const res = await indexer.query({ query: "" });
    expect(res.map((sym) => sym.name)).toEqual(["Ok"]);
  });

  it("query clamps limits and handles numeric strings", async () => {
    const store = new CodeSearchIndexStore();
    const symbols = Array.from({ length: 60 }, (_, i) => ({ name: `S${i + 1}` }));
    await store.putSymbolRecord("default", "a.js", { sha256: "1", symbols });

    const indexer = new SymbolIndexer({ store });

    const resString = await indexer.query({ query: "", limit: "2" });
    expect(resString).toHaveLength(2);

    const resZero = await indexer.query({ query: "", limit: 0 });
    expect(resZero).toHaveLength(1);

    const resNegative = await indexer.query({ query: "", limit: -1 });
    expect(resNegative).toHaveLength(1);

    const resNonFinite = await indexer.query({ query: "", limit: "nope" });
    expect(resNonFinite).toHaveLength(50);

    const resMax = await indexer.query({ query: "", limit: Number.MAX_SAFE_INTEGER });
    expect(resMax).toHaveLength(60);

    const resWhitespace = await indexer.query({ query: "   ", limit: 3 });
    expect(resWhitespace).toHaveLength(3);

    const resNull = await indexer.query({ query: null, limit: 2 });
    expect(resNull).toHaveLength(2);
  });

  it("query caches results and invalidateCaches clears cache", async () => {
    const store = new CodeSearchIndexStore();
    await store.putSymbolRecord("default", "a.js", { sha256: "1", symbols: [{ name: "Alpha" }] });

    const indexer = new SymbolIndexer({ store });
    const spy = vi.spyOn(store, "listSymbolRecords");

    const first = await indexer.query({ query: "", limit: 10 });
    const second = await indexer.query({ query: "", limit: 10 });

    expect(first.map((sym) => sym.name)).toEqual(["Alpha"]);
    expect(second.map((sym) => sym.name)).toEqual(["Alpha"]);
    expect(spy).toHaveBeenCalledTimes(1);

    indexer.invalidateCaches();
    await indexer.query({ query: "", limit: 10 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("query supports concurrent calls", async () => {
    const store = new CodeSearchIndexStore();
    const deferred = [];

    vi.spyOn(store, "listSymbolRecords").mockImplementation(
      () => new Promise((resolve) => deferred.push(resolve)),
    );

    const indexer = new SymbolIndexer({ store });
    const p1 = indexer.query({ query: "", limit: 5 });
    const p2 = indexer.query({ query: "", limit: 5 });

    expect(deferred).toHaveLength(2);
    deferred.forEach((resolve) =>
      resolve([{ workspaceId: "default", path: "a.js", symbols: [{ name: "One" }] }]),
    );

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.map((sym) => sym.name)).toEqual(["One"]);
    expect(r2.map((sym) => sym.name)).toEqual(["One"]);
    expect(store.listSymbolRecords).toHaveBeenCalledTimes(2);
  });
});

describe("default export", () => {
  it("matches the named export", () => {
    expect(SymbolIndexer).toBe(NamedSymbolIndexer);
  });
});
