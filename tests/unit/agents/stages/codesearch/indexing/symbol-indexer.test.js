import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import SymbolIndexer from '../../../../../../js/agents/stages/codesearch/indexing/symbol-indexer.js';
import CodeSearchIndexStore from '../../../../../../js/agents/stages/codesearch/indexing/index-store.js';

function makeNameNode(text, row) {
  return {
    text,
    startPosition: { row },
    endPosition: { row },
    namedChildren: [],
    childForFieldName: () => null,
  };
}

function makeDeclNode(type, name, { nameRow = 0, endRow = nameRow } = {}) {
  const nameNode = makeNameNode(name, nameRow);
  return {
    type,
    startPosition: { row: nameRow },
    endPosition: { row: endRow },
    namedChildren: [],
    childForFieldName: (field) => (field === "name" ? nameNode : null),
  };
}

describe("codesearch/indexing/symbol-indexer (extra branch coverage)", () => {
  const originalIndexedDB = globalThis.indexedDB;
  const originalIDBKeyRange = globalThis.IDBKeyRange;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    // Ensure CodeSearchIndexStore stays on the in-memory path in tests.
    // @ts-ignore
    delete globalThis.indexedDB;
    // @ts-ignore
    delete globalThis.IDBKeyRange;
  });

  afterEach(() => {
    globalThis.indexedDB = originalIndexedDB;
    globalThis.IDBKeyRange = originalIDBKeyRange;
  });

  it("indexFiles treats non-array inputs as an empty list (Array.isArray false branch)", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    const spy = vi.spyOn(indexer, "indexFile");

    // @ts-ignore - intentional invalid input to cover branch
    const res = await indexer.indexFiles("not-an-array");
    expect(res).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("indexFiles stringifies non-Error throws (err instanceof Error false branch)", async () => {
    const indexer = new SymbolIndexer({ vfs: { readText: vi.fn() } });
    vi.spyOn(indexer, "indexFile").mockImplementation(async () => {
      // eslint-disable-next-line no-throw-literal
      throw "boom";
    });

    const res = await indexer.indexFiles(["a.js"]);
    expect(res).toEqual([{ ok: false, path: "a.js", error: "boom" }]);
  });

  it("query clamps limit to >=1 and defaults to 50 when limit is non-finite", async () => {
    const store = new CodeSearchIndexStore();
    const symbols = Array.from({ length: 60 }, (_, i) => ({ name: `S${i + 1}` }));

    vi.spyOn(store, "listSymbolRecords").mockResolvedValue([
      { workspaceId: "default", path: "a.js", symbols },
    ]);

    const indexer = new SymbolIndexer({ store, workspaceId: "default" });

    // Non-finite -> default 50
    // @ts-ignore - intentional invalid type to cover branch
    const fifty = await indexer.query({ query: "", limit: "nope" });
    expect(fifty).toHaveLength(50);
    expect(fifty[0].name).toBe("S1");
    expect(fifty[49].name).toBe("S50");

    // 0 -> clamps up to 1
    const one = await indexer.query({ query: "", limit: 0 });
    expect(one).toHaveLength(1);
  });

  it("query ignores rows with non-array symbols and filters invalid/blank symbol entries", async () => {
    const store = new CodeSearchIndexStore();
    vi.spyOn(store, "listSymbolRecords").mockResolvedValue([
      // symbols not an array -> should be ignored (Array.isArray false branch)
      { workspaceId: "default", path: "bad.js", symbols: null },
      // mixed symbol entries -> should filter down to valid named objects
      {
        workspaceId: "default",
        path: "good.js",
        symbols: [null, "bad", {}, { name: "   " }, { name: "Foo" }, { name: "Bar" }],
      },
    ]);

    const indexer = new SymbolIndexer({ store, workspaceId: "default" });
    const res = await indexer.query({ query: "", limit: 10 });
    expect(res.map((s) => s.name)).toEqual(["Foo", "Bar"]);
  });

  it("extractSymbols logs and falls back to regex when parser throws a non-Error (parse error handling)", async () => {
    const warn = vi.fn();
    const indexer = new SymbolIndexer({ logger: { warn } });

    // Force the tree-sitter branch in Node by stubbing internals.
    indexer._getLanguage = vi.fn(async () => ({ id: "stubLang" }));
    indexer._getParser = vi.fn(async () => ({
      setLanguage: vi.fn(),
      parse: () => {
        // eslint-disable-next-line no-throw-literal
        throw "parse boom";
      },
    }));

    const syms = await indexer.extractSymbols("export function foo() {}", "a.js");
    expect(syms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "[SymbolIndexer] Tree-sitter parse failed; falling back to regex",
      expect.objectContaining({ file: "a.js", error: "parse boom" }),
    );
  });

  it("extractSymbols handles empty files via the tree-sitter path (empty file handling)", async () => {
    const indexer = new SymbolIndexer();

    const parseSpy = vi.fn(() => ({
      rootNode: { type: "program", namedChildren: [] },
    }));

    indexer._getLanguage = vi.fn(async () => ({ id: "stubLang" }));
    indexer._getParser = vi.fn(async () => ({
      setLanguage: vi.fn(),
      parse: parseSpy,
    }));

    const syms = await indexer.extractSymbols("", "a.js");
    expect(syms).toEqual([]);
    expect(parseSpy).toHaveBeenCalledWith("");
  });

  it("extractSymbols dispatches to different language ids based on extension (language branch coverage)", async () => {
    const indexer = new SymbolIndexer();
    const getLanguage = vi.fn(async () => ({ id: "stubLang" }));
    const parser = {
      setLanguage: vi.fn(),
      parse: vi.fn(() => ({ rootNode: { type: "program", namedChildren: [] } })),
    };

    indexer._getLanguage = getLanguage;
    indexer._getParser = vi.fn(async () => parser);

    await indexer.extractSymbols("{}", "a.ts");
    await indexer.extractSymbols("{}", "a.tsx");
    await indexer.extractSymbols("{}", "a.json");

    expect(getLanguage).toHaveBeenNthCalledWith(1, "typescript");
    expect(getLanguage).toHaveBeenNthCalledWith(2, "tsx");
    expect(getLanguage).toHaveBeenNthCalledWith(3, "json");

    getLanguage.mockClear();
    const regexSyms = await indexer.extractSymbols("export function foo() {}", "README");
    expect(getLanguage).not.toHaveBeenCalled();
    expect(regexSyms.some((s) => s.name === "foo" && s.parser === "regex")).toBe(true);
  });

  it("extractSymbols returns only supported declaration node types (symbol kind filtering)", async () => {
    const indexer = new SymbolIndexer();

    const rootNode = {
      type: "program",
      namedChildren: [
        makeDeclNode("function_declaration", "foo", { nameRow: 0, endRow: 0 }),
        // Unhandled node type should be ignored by extractJsTsSymbolsFromTree
        { type: "lexical_declaration", startPosition: { row: 1 }, endPosition: { row: 1 }, namedChildren: null },
      ],
    };

    indexer._getLanguage = vi.fn(async () => ({ id: "stubLang" }));
    indexer._getParser = vi.fn(async () => ({
      setLanguage: vi.fn(),
      parse: vi.fn(() => ({ rootNode })),
    }));

    const text = ["export function foo() {}", "const x = 1;"].join("\n");
    const syms = await indexer.extractSymbols(text, "a.js");
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: "foo", kind: "function", parser: "tree-sitter" });
  });
});

