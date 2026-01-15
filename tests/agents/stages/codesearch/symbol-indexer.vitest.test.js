import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../js/agents/storage/artifact-manager.js", () => {
  return {
    computeSha256: vi.fn(async (text) => `sha_${String(text ?? "").length}`),
  };
});

vi.mock("../../../../js/agents/shared/parser/tree-sitter-wasm.js", () => {
  return {
    initTreeSitter: vi.fn(async () => {}),
    loadTreeSitterLanguage: vi.fn(async () => ({ id: "mockLang" })),
  };
});

let parseFn = () => ({ rootNode: null });
let ctorShouldThrow = false;
vi.mock("web-tree-sitter", () => {
  class Parser {
    constructor() {
      if (ctorShouldThrow) throw new Error("ctor fail");
    }
    setLanguage(_lang) {}
    parse(text) {
      return parseFn(text);
    }
  }

  return {
    Parser,
    default: { Parser },
    __setParseFn: (fn) => {
      parseFn = typeof fn === "function" ? fn : () => ({ rootNode: null });
    },
    __setCtorShouldThrow: (v) => {
      ctorShouldThrow = v === true;
    },
  };
});

import SymbolIndexer from "../../../../js/agents/stages/codesearch/indexing/symbol-indexer.js";
import CodeSearchIndexStore from "../../../../js/agents/stages/codesearch/indexing/index-store.js";
import { initTreeSitter, loadTreeSitterLanguage } from "../../../../js/agents/shared/parser/tree-sitter-wasm.js";
import { computeSha256 } from "../../../../js/agents/storage/artifact-manager.js";

function makeNameNode(text, row) {
  return {
    text,
    startPosition: { row },
    endPosition: { row },
    namedChildren: [],
    childForFieldName: () => null,
  };
}

function makeDeclNode(type, name, { nameRow, endRow }) {
  const nameNode = makeNameNode(name, nameRow);
  return {
    type,
    startPosition: { row: nameRow },
    endPosition: { row: endRow },
    namedChildren: [],
    childForFieldName: (field) => (field === "name" ? nameNode : null),
  };
}

describe("codesearch/indexing/symbol-indexer", () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;

  beforeEach(async () => {
    // Keep module mocks in place, but reset call history and restore any spies.
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // Ensure symbol-indexer uses in-memory store by default.
    // @ts-ignore
    delete globalThis.indexedDB;
    // @ts-ignore
    delete globalThis.IDBKeyRange;

    // Reset the web-tree-sitter mock's parse behavior between tests.
    const webTreeSitter = await import("web-tree-sitter");
    webTreeSitter.__setParseFn(() => ({ rootNode: null }));
    webTreeSitter.__setCtorShouldThrow(false);
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
  });

  it("_ensureTreeSitter caches failure and logs warning", async () => {
    initTreeSitter.mockRejectedValueOnce(new Error("init fail"));

    const logger = { warn: vi.fn() };
    const indexer = new SymbolIndexer({ logger });

    expect(await indexer._ensureTreeSitter()).toBe(false);
    expect(await indexer._ensureTreeSitter()).toBe(false);

    expect(initTreeSitter).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("[SymbolIndexer] Tree-sitter init failed; falling back to regex", expect.any(Object));
  });

  it("_ensureTreeSitter caches success and avoids re-initializing", async () => {
    const indexer = new SymbolIndexer();
    expect(await indexer._ensureTreeSitter()).toBe(true);
    expect(await indexer._ensureTreeSitter()).toBe(true);
    expect(initTreeSitter).toHaveBeenCalledTimes(1);
  });

  it("_getLanguage returns null for unknown language ids and caches loaded languages", async () => {
    const indexer = new SymbolIndexer();
    expect(await indexer._getLanguage("python")).toBeNull();

    loadTreeSitterLanguage.mockResolvedValueOnce({ id: "jsLang" });
    const lang1 = await indexer._getLanguage("javascript");
    const lang2 = await indexer._getLanguage("javascript");
    expect(lang1).toBeTruthy();
    expect(lang2).toBe(lang1);
    expect(loadTreeSitterLanguage).toHaveBeenCalledTimes(1);
  });

  it("_getLanguage logs and returns null when language wasm load fails", async () => {
    loadTreeSitterLanguage.mockRejectedValueOnce(new Error("bad wasm"));
    const logger = { warn: vi.fn() };
    const indexer = new SymbolIndexer({ logger });

    const lang = await indexer._getLanguage("javascript");
    expect(lang).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("[SymbolIndexer] Failed to load language wasm: javascript", expect.any(Object));
  });

  it("_getParser caches the parser instance and de-duplicates concurrent requests", async () => {
    const indexer = new SymbolIndexer();
    const p1 = await indexer._getParser();
    const p2 = await indexer._getParser();
    expect(p1).toBe(p2);

    const indexer2 = new SymbolIndexer();
    const [a, b] = await Promise.all([indexer2._getParser(), indexer2._getParser()]);
    expect(a).toBe(b);
  });

  it("_getParser resets internal promise when constructor throws (retry works)", async () => {
    const webTreeSitter = await import("web-tree-sitter");
    webTreeSitter.__setCtorShouldThrow(true);

    const indexer = new SymbolIndexer();
    await expect(indexer._getParser()).rejects.toThrow("ctor fail");
    expect(indexer._parserPromise).toBeNull();

    webTreeSitter.__setCtorShouldThrow(false);
    const parser = await indexer._getParser();
    expect(parser).toBeTruthy();
  });

  it("_emit forwards events when an emitter is provided (and is a no-op otherwise)", () => {
    const emit = vi.fn();
    const indexer = new SymbolIndexer({ emit });
    indexer._emit("evt", { a: 1 });
    expect(emit).toHaveBeenCalledWith("evt", { a: 1 });

    const indexer2 = new SymbolIndexer();
    expect(() => indexer2._emit("evt", { a: 1 })).not.toThrow();
  });

  it("extractSymbols falls back to regex when tree-sitter is unavailable and extracts docs/signatures", async () => {
    initTreeSitter.mockRejectedValueOnce(new Error("no wasm"));

    const indexer = new SymbolIndexer({ logger: { warn: vi.fn() } });
    const text = [
      "/**",
      " * Doc for foo",
      " */",
      "export function foo(a) {",
      "  return a;",
      "}",
      "",
      "// Line doc",
      "// second",
      "export class Bar {",
      "}",
      "",
      "export interface IFoo {",
      "}",
      "export type TThing = string;",
      "export enum EKind { A, B }",
      "",
    ].join("\n");

    const syms = await indexer.extractSymbols(text, "src/a.js");
    expect(syms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
    expect(syms.some((s) => s.name === "Bar" && s.parser === "regex")).toBe(true);
    expect(syms.some((s) => s.name === "IFoo" && s.parser === "regex")).toBe(true);
    expect(syms.some((s) => s.name === "TThing" && s.parser === "regex")).toBe(true);
    expect(syms.some((s) => s.name === "EKind" && s.parser === "regex")).toBe(true);

    const foo = syms.find((s) => s.name === "foo");
    expect(foo?.doc).toContain("Doc for foo");
    expect(foo?.signature).toContain("function foo");

    const bar = syms.find((s) => s.name === "Bar");
    expect(bar?.doc).toContain("Line doc");
    expect(bar?.doc).toContain("second");
  });

  it("extractSymbols omits doc when no leading comments are present", async () => {
    initTreeSitter.mockRejectedValueOnce(new Error("no wasm"));
    const indexer = new SymbolIndexer({ logger: { warn: vi.fn() } });
    const syms = await indexer.extractSymbols("export function foo() {}", "a.js");
    const foo = syms.find((s) => s.name === "foo");
    expect(foo?.doc).toBeUndefined();
  });

  it("detects common language extensions (mjs/cjs/jsx/tsx/json) and still extracts via fallback paths", async () => {
    const indexer = new SymbolIndexer();
    const code = "export function foo() {}";
    const paths = ["a.mjs", "a.cjs", "a.jsx", "a.tsx", "a.json", "README"];

    const results = await Promise.all(paths.map((p) => indexer.extractSymbols(code, p)));
    for (const list of results) {
      expect(list.some((s) => s.name === "foo")).toBe(true);
    }
  });

  it("extractSymbols uses tree-sitter when language + parser are available", async () => {
    const webTreeSitter = await import("web-tree-sitter");
    webTreeSitter.__setParseFn(() => {
      const rootNode = {
        type: "program",
        namedChildren: [
          makeDeclNode("function_declaration", "foo", { nameRow: 3, endRow: 5 }),
          makeDeclNode("class_declaration", "Bar", { nameRow: 9, endRow: 10 }),
        ],
      };
      return { rootNode };
    });

    const indexer = new SymbolIndexer();
    const text = [
      "/**",
      " * Doc for foo",
      " */",
      "export function foo(a) {",
      "  return a;",
      "}",
      "",
      "// Line doc",
      "// second",
      "export class Bar {",
      "}",
      "",
    ].join("\n");

    const syms = await indexer.extractSymbols(text, "src/a.js");
    expect(syms.some((s) => s.name === "foo" && s.parser === "tree-sitter")).toBe(true);
    expect(syms.some((s) => s.name === "Bar" && s.parser === "tree-sitter")).toBe(true);
  });

  it("extractSymbols falls back to regex when parser returns no root node", async () => {
    const indexer = new SymbolIndexer();
    const text = "export function foo() {}";
    const syms = await indexer.extractSymbols(text, "src/a.js");
    expect(syms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
  });

  it("extractSymbols falls back to regex when tree-sitter parse throws", async () => {
    const webTreeSitter = await import("web-tree-sitter");
    webTreeSitter.__setParseFn(() => {
      throw new Error("parse fail");
    });

    const warn = vi.fn();
    const indexer = new SymbolIndexer({ logger: { warn } });
    const text = "export function foo() {}";
    const syms = await indexer.extractSymbols(text, "src/a.js");

    expect(syms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
    expect(warn).toHaveBeenCalledWith("[SymbolIndexer] Tree-sitter parse failed; falling back to regex", expect.any(Object));
  });

  it("extractSymbols uses regex for unsupported extensions", async () => {
    const indexer = new SymbolIndexer();
    const text = "export function foo() {}";
    const syms = await indexer.extractSymbols(text, "README.txt");
    expect(syms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
  });

  it("tree-sitter extraction supports interface/type/enum nodes", async () => {
    const webTreeSitter = await import("web-tree-sitter");
    webTreeSitter.__setParseFn(() => {
      const rootNode = {
        type: "program",
        namedChildren: [
          makeDeclNode("interface_declaration", "IFoo", { nameRow: 0, endRow: 1 }),
          makeDeclNode("type_alias_declaration", "TThing", { nameRow: 2, endRow: 2 }),
          makeDeclNode("enum_declaration", "EKind", { nameRow: 3, endRow: 4 }),
        ],
      };
      return { rootNode };
    });

    const indexer = new SymbolIndexer();
    const text = [
      "export interface IFoo {}",
      "",
      "export type TThing = string;",
      "export enum EKind { A }",
    ].join("\n");

    const syms = await indexer.extractSymbols(text, "src/a.ts");
    const kinds = syms.map((s) => s.kind).sort();
    expect(kinds).toEqual(["enum", "interface", "type"]);
    expect(syms.every((s) => s.parser === "tree-sitter")).toBe(true);
  });

  it("indexFile skips when sha256 matches existing record", async () => {
    const vfs = { readText: vi.fn(async () => "content") };
    expect(await computeSha256("content")).toBe("sha_7");

    const store = new CodeSearchIndexStore();
    vi.spyOn(store, "getSymbolRecord").mockResolvedValue({
      workspaceId: "default",
      path: "a.js",
      sha256: "sha_7",
      symbols: [{ name: "cached" }],
    });
    const putSpy = vi.spyOn(store, "putSymbolRecord");

    const indexer = new SymbolIndexer({ vfs, store });
    const res = await indexer.indexFile("a.js");

    expect(res).toEqual({ ok: true, path: "a.js", skipped: true, symbols: [{ name: "cached" }] });
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("indexFile throws when vfs is missing or path is invalid", async () => {
    const indexer = new SymbolIndexer();
    await expect(indexer.indexFile("a.js")).rejects.toThrow("vfs.readText is required");

    const indexer2 = new SymbolIndexer({ vfs: { readText: vi.fn(async () => "") } });
    await expect(indexer2.indexFile("")).rejects.toThrow("path is required");
  });

  it("indexFile stores symbols and bumps revision when sha256 differs", async () => {
    const vfs = { readText: vi.fn(async () => "hello") };
    const store = new CodeSearchIndexStore();
    vi.spyOn(store, "getSymbolRecord").mockResolvedValue(null);
    const putSpy = vi.spyOn(store, "putSymbolRecord").mockResolvedValue("default::a.js");

    const indexer = new SymbolIndexer({ vfs, store });
    vi.spyOn(indexer, "extractSymbols").mockResolvedValue([{ name: "foo" }]);

    expect(indexer._indexRevision).toBe(0);
    const res = await indexer.indexFile("a.js");
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(false);
    expect(res.symbols).toEqual([{ name: "foo" }]);
    expect(putSpy).toHaveBeenCalled();
    expect(indexer._indexRevision).toBe(1);
  });

  it("indexFiles returns per-file results and continues after failures", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    vi.spyOn(indexer, "indexFile").mockImplementation(async (p) => {
      if (p === "b.js") throw new Error("boom");
      return { ok: true, path: p };
    });

    const res = await indexer.indexFiles(["a.js", "", "b.js"]);
    expect(res).toEqual([
      { ok: true, path: "a.js" },
      { ok: false, path: "b.js", error: "boom" },
    ]);
  });

  it("query filters by name/prefix and caches results per revision", async () => {
    const store = new CodeSearchIndexStore();
    const listSpy = vi.spyOn(store, "listSymbolRecords").mockResolvedValue([
      {
        workspaceId: "default",
        path: "src/a.js",
        symbols: [{ name: "Foo" }, { name: "Bar" }],
      },
      {
        workspaceId: "default",
        path: "lib/b.js",
        symbols: [{ name: "Baz" }],
      },
    ]);

    const indexer = new SymbolIndexer({ store, workspaceId: "default" });

    const first = await indexer.query({ query: "ba", pathPrefix: "src/", limit: 10 });
    expect(first.map((s) => s.name)).toEqual(["Bar"]);
    expect(listSpy).toHaveBeenCalledTimes(1);

    const second = await indexer.query({ query: "ba", pathPrefix: "src/", limit: 10 });
    expect(second.map((s) => s.name)).toEqual(["Bar"]);
    expect(listSpy).toHaveBeenCalledTimes(1); // cache hit

    // Empty query should be supported and return all symbols under the prefix.
    const allInSrc = await indexer.query({ query: "", pathPrefix: "src/", limit: 10 });
    expect(allInSrc.map((s) => s.name)).toEqual(["Foo", "Bar"]);

    indexer.invalidateCaches();
    await indexer.query({ query: "ba", pathPrefix: "src/", limit: 10 });
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it("query skips invalid symbols and early-returns when limit is reached", async () => {
    const store = new CodeSearchIndexStore();
    vi.spyOn(store, "listSymbolRecords").mockResolvedValue([
      {
        workspaceId: "default",
        path: "a.js",
        symbols: [null, "bad", {}, { name: "Foo" }, { name: "Bar" }],
      },
    ]);

    const indexer = new SymbolIndexer({ store, workspaceId: "default" });
    const res = await indexer.query({ query: "", limit: 1 });
    expect(res).toEqual([{ name: "Foo" }]);
  });
});
