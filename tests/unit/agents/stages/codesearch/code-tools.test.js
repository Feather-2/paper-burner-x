import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockGrepChunks = vi.fn();
  const mockComputeSha256 = vi.fn();
  const mockWriteTextFileWithPolicy = vi.fn();
  const mockMultiEditTextFileWithPolicy = vi.fn();
  const mockIsPlainObject = vi.fn();
  const symbolIndexerInstances = [];

  class SymbolIndexerMock {
    constructor(options) {
      this.options = options;
      this.workspaceId = options?.workspaceId;
      this.store = { putSymbolRecord: vi.fn() };
      this.indexFile = vi.fn().mockResolvedValue({ skipped: false, symbols: [] });
      this.extractSymbolsAsync = vi.fn().mockResolvedValue([]);
      this.query = vi.fn().mockResolvedValue([]);
      this.invalidateCaches = vi.fn();
      symbolIndexerInstances.push(this);
    }
  }

  return {
    mockGrepChunks,
    mockComputeSha256,
    mockWriteTextFileWithPolicy,
    mockMultiEditTextFileWithPolicy,
    mockIsPlainObject,
    SymbolIndexerMock,
    symbolIndexerInstances,
  };
});

vi.mock("../../../../../js/agents/retrieval/grep.js", () => ({
  grepChunks: mocks.mockGrepChunks,
}));

vi.mock("../../../../../js/agents/stages/codesearch/indexing/symbol-indexer.js", () => ({
  default: mocks.SymbolIndexerMock,
}));

vi.mock("../../../../../js/agents/storage/artifact-manager.js", () => ({
  computeSha256: mocks.mockComputeSha256,
}));

vi.mock("../../../../../js/agents/vfs/operations.js", () => ({
  writeTextFileWithPolicy: mocks.mockWriteTextFileWithPolicy,
  multiEditTextFileWithPolicy: mocks.mockMultiEditTextFileWithPolicy,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: mocks.mockIsPlainObject,
}));

import {
  TOOL_DEFINITIONS,
  createToolExecutor,
  formatToolDefinitionsForLLM,
} from "../../../../../js/agents/stages/codesearch/code-tools.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.symbolIndexerInstances.length = 0;
  mocks.mockIsPlainObject.mockImplementation((value) => !!value && typeof value === "object" && !Array.isArray(value));
  mocks.mockGrepChunks.mockReturnValue([]);
});

describe("TOOL_DEFINITIONS", () => {
  it("exposes all tool definitions with required fields", () => {
    expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
    expect(TOOL_DEFINITIONS).toHaveLength(9);

    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(9);
    expect(names).toEqual([
      "glob",
      "grep",
      "read_file",
      "write_file",
      "multi_edit",
      "list_dir",
      "tree",
      "index_symbols",
      "find_symbol",
    ]);

    for (const tool of TOOL_DEFINITIONS) {
      expect(tool).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          parameters: expect.any(Object),
          examples: expect.any(Array),
        }),
      );
    }
  });
});

describe("formatToolDefinitionsForLLM", () => {
  it("formats tool definitions into markdown sections", () => {
    const output = formatToolDefinitionsForLLM();
    expect(output).toContain("### glob");
    expect(output).toContain("pattern: glob 模式");
    expect(output).toContain("(必需)");
    expect(output).toContain("{\"pattern\":\"**/*.ts\"}");
    expect(output).toContain("### find_symbol");
  });
});

describe("createToolExecutor", () => {
  it("throws when basePath is empty or whitespace", () => {
    expect(() => createToolExecutor({ basePath: "   " })).toThrow("basePath must not be empty");
  });

  it("exposes TOOL_DEFINITIONS on executor", () => {
    const executor = createToolExecutor();
    expect(executor.definitions).toBe(TOOL_DEFINITIONS);
  });

  describe("glob", () => {
    it("returns empty result with error when globFn is missing", async () => {
      const executor = createToolExecutor();
      const result = await executor.glob({ pattern: "*.js" });

      expect(result).toEqual(
        expect.objectContaining({
          total: 0,
          truncated: false,
          error: "glob function not available",
        }),
      );
      expect(result.files).toBe(result);
      expect(result).toHaveLength(0);
    });

    it("limits results and supports concurrent calls", async () => {
      const globFn = vi.fn(({ pattern }) => {
        return pattern === "a" ? Promise.resolve(["a.js", "a2.js"]) : Promise.resolve(["b.js"]);
      });
      const executor = createToolExecutor({ globFn, maxResults: 1 });

      const [resA, resB] = await Promise.all([
        executor.glob({ pattern: "a", path: "src" }),
        executor.glob({ pattern: "b", path: "src" }),
      ]);

      expect(globFn).toHaveBeenCalledTimes(2);
      expect(resA.slice()).toEqual(["a.js"]);
      expect(resA.total).toBe(2);
      expect(resA.truncated).toBe(true);
      expect(resB.slice()).toEqual(["b.js"]);
      expect(resB.total).toBe(1);
      expect(resB.truncated).toBe(false);
    });

    it("throws when pattern is empty", async () => {
      const executor = createToolExecutor({ globFn: vi.fn() });
      await expect(executor.glob({ pattern: "" })).rejects.toThrow("glob: pattern is required");
      await expect(executor.glob({ pattern: null })).rejects.toThrow("glob: pattern is required");
    });
  });

  describe("grep", () => {
    it("searches files and maps matches", async () => {
      const fs = {
        readFile: vi.fn((path) => {
          return Buffer.from(path === "a.txt" ? "alpha\nbeta" : "gamma\ndelta");
        }),
        stat: vi.fn().mockResolvedValue({ size: 10 }),
      };
      const globFn = vi.fn().mockResolvedValue(["a.txt", "b.txt"]);
      mocks.mockGrepChunks.mockReturnValue([
        { chunkId: "a.txt", matchCount: 2, spans: [1, 2, 3, 4, 5, 6] },
        { chunkId: "b.txt", matchCount: 1, spans: [7] },
      ]);

      const executor = createToolExecutor({ fs, globFn, maxResults: 10 });
      const result = await executor.grep({ pattern: "alpha", path: "." });

      expect(mocks.mockGrepChunks).toHaveBeenCalledWith(
        expect.any(Array),
        "alpha",
        { regex: false, caseSensitive: false },
      );
      expect(result.matches).toEqual([
        { file: "a.txt", matchCount: 2, spans: [1, 2, 3, 4, 5] },
        { file: "b.txt", matchCount: 1, spans: [7] },
      ]);
      expect(result.total).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it("returns message when no files to search", async () => {
      const executor = createToolExecutor({ globFn: vi.fn().mockResolvedValue([]) });
      const result = await executor.grep({ pattern: "todo", path: "src" });
      expect(result).toEqual({ matches: [], message: "No files to search" });
    });

    it("returns error when grepChunks throws", async () => {
      const fs = {
        readFile: vi.fn(() => Buffer.from("hello")),
        stat: vi.fn().mockResolvedValue({ size: 5 }),
      };
      const globFn = vi.fn().mockResolvedValue(["a.txt"]);
      mocks.mockGrepChunks.mockImplementation(() => {
        throw new Error("boom");
      });

      const executor = createToolExecutor({ fs, globFn });
      const result = await executor.grep({ pattern: "hello", path: "src", regex: true });

      expect(result).toEqual({ error: "boom", matches: [] });
    });

    it("throws when pattern is missing", async () => {
      const executor = createToolExecutor({ globFn: vi.fn().mockResolvedValue([]) });
      await expect(executor.grep({ pattern: "" })).rejects.toThrow("grep: pattern is required");
    });
  });

  describe("read_file", () => {
    it("reads file with line numbers and range", async () => {
      const fs = {
        readFile: vi.fn(() => Buffer.from("first\nsecond\nthird")),
        stat: vi.fn().mockResolvedValue({ size: 30 }),
      };
      const executor = createToolExecutor({ fs });

      const result = await executor.read_file({ path: "notes.txt", startLine: 2, endLine: 3 });

      expect(result.content).toBe("2│second\n3│third");
      expect(result.path).toBe("notes.txt");
      expect(result.totalLines).toBe(3);
      expect(result.range).toEqual({ start: 2, end: 3 });
      expect(result.truncated).toBe(true);
    });

    it("clamps line ranges and ignores string line numbers", async () => {
      const fs = {
        readFile: vi.fn(() => Buffer.from("one\ntwo")),
        stat: vi.fn().mockResolvedValue({ size: 10 }),
      };
      const executor = createToolExecutor({ fs });

      const result = await executor.read_file({ path: "file.txt", startLine: 0, endLine: 1 });
      expect(result.content).toBe("1│one");

      const stringLine = await executor.read_file({ path: "file.txt", startLine: "2" });
      expect(stringLine.range).toEqual({ start: 1, end: 2 });
    });

    it("throws when path is missing", async () => {
      const executor = createToolExecutor({ fs: { readFile: vi.fn() } });
      await expect(executor.read_file({ path: null })).rejects.toThrow("read_file: path is required");
      await expect(executor.read_file({ path: undefined })).rejects.toThrow("read_file: path is required");
    });

    it("throws when file is too large", async () => {
      const fs = {
        readFile: vi.fn(() => Buffer.from("data")),
        stat: vi.fn().mockResolvedValue({ size: 999 }),
      };
      const executor = createToolExecutor({ fs, maxFileSize: 10 });

      await expect(executor.read_file({ path: "big.txt" })).rejects.toThrow("File too large");
    });

    it("truncates long lines", async () => {
      const fs = {
        readFile: vi.fn(() => Buffer.from("0123456789")),
        stat: vi.fn().mockResolvedValue({ size: 10 }),
      };
      const executor = createToolExecutor({ fs, maxLineLength: 5 });

      const result = await executor.read_file({ path: "long.txt" });
      expect(result.content).toBe("1│01234...");
    });
  });

  describe("write_file", () => {
    it("writes using VFS policy wrapper", async () => {
      const vfs = { writeText: vi.fn() };
      mocks.mockWriteTextFileWithPolicy.mockResolvedValue({ saved: true });

      const executor = createToolExecutor({ vfs });
      const result = await executor.write_file({ path: "note.txt", content: "hello" });

      expect(result).toEqual({ ok: true, saved: true });
      expect(mocks.mockWriteTextFileWithPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          vfs,
          path: "note.txt",
          text: "hello",
          checkpoint: true,
        }),
      );
    });

    it("returns error when vfs is missing", async () => {
      const executor = createToolExecutor();
      const result = await executor.write_file({ path: "note.txt", content: "hello" });
      expect(result).toEqual({ error: "vfs.writeText not available (Browser-only write requires VFS)" });
    });

    it("returns error when content is too large", async () => {
      const vfs = { writeText: vi.fn() };
      const executor = createToolExecutor({ vfs, maxFileSize: 3 });
      const result = await executor.write_file({ path: "note.txt", content: "abcd" });
      expect(result).toEqual({ error: "Content too large: 4 chars (max 3)" });
    });

    it("supports rapid consecutive calls", async () => {
      const vfs = { writeText: vi.fn() };
      mocks.mockWriteTextFileWithPolicy.mockResolvedValue({ ok: true });
      const executor = createToolExecutor({ vfs });

      await executor.write_file({ path: "note.txt", content: "one", checkpoint: false });
      await executor.write_file({ path: "note.txt", content: "two", checkpoint: false });

      expect(mocks.mockWriteTextFileWithPolicy).toHaveBeenCalledTimes(2);
      expect(mocks.mockWriteTextFileWithPolicy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ text: "one", checkpoint: false }),
      );
      expect(mocks.mockWriteTextFileWithPolicy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ text: "two", checkpoint: false }),
      );
    });

    it("throws when path is missing", async () => {
      const executor = createToolExecutor({ vfs: { writeText: vi.fn() } });
      await expect(executor.write_file({ path: undefined, content: "x" })).rejects.toThrow("write_file: path is required");
    });
  });

  describe("multi_edit", () => {
    it("applies edits via policy wrapper", async () => {
      const vfs = { writeText: vi.fn() };
      mocks.mockMultiEditTextFileWithPolicy.mockResolvedValue({ applied: true });

      const executor = createToolExecutor({ vfs });
      const result = await executor.multi_edit({
        path: "app.js",
        edits: [{ old_string: "a", new_string: "b" }],
      });

      expect(result).toEqual({ ok: true, applied: true });
      expect(mocks.mockMultiEditTextFileWithPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          vfs,
          path: "app.js",
          edits: [{ old_string: "a", new_string: "b" }],
          checkpoint: true,
        }),
      );
    });

    it("returns error when vfs is missing", async () => {
      const executor = createToolExecutor();
      const result = await executor.multi_edit({ path: "app.js", edits: [] });
      expect(result).toEqual({ error: "vfs.writeText not available (Browser-only write requires VFS)" });
    });

    it("handles non-array edits", async () => {
      const vfs = { writeText: vi.fn() };
      mocks.mockMultiEditTextFileWithPolicy.mockResolvedValue({ applied: true });

      const executor = createToolExecutor({ vfs });
      await executor.multi_edit({ path: "app.js", edits: { old_string: "a", new_string: "b" } });

      expect(mocks.mockMultiEditTextFileWithPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ edits: [] }),
      );
    });

    it("throws when path is missing", async () => {
      const executor = createToolExecutor({ vfs: { writeText: vi.fn() } });
      await expect(executor.multi_edit({ path: "" })).rejects.toThrow("multi_edit: path is required");
    });
  });

  describe("list_dir", () => {
    it("lists entries, filters hidden, and sorts dirs first", async () => {
      const fs = {
        readdir: vi.fn().mockResolvedValue([
          { name: ".env", isDirectory: () => false },
          { name: "src", isDirectory: () => true },
          { name: "b.txt", isDirectory: () => false },
          { name: "a.txt", isDirectory: () => false },
        ]),
      };
      const executor = createToolExecutor({ fs, maxResults: 10 });

      const result = await executor.list_dir({ path: "." });

      expect(Array.from(result.entries)).toEqual([
        { name: "src", type: "dir" },
        { name: "a.txt", type: "file" },
        { name: "b.txt", type: "file" },
      ]);
      expect(result.total).toBe(3);
      expect(result.truncated).toBe(false);
    });

    it("includes hidden entries and handles string listings", async () => {
      const vfs = {
        list: vi.fn().mockResolvedValue(["alpha", ".secret"]),
      };
      const executor = createToolExecutor({ vfs });

      const result = await executor.list_dir({ path: ".", showHidden: true });

      expect(Array.from(result.entries)).toEqual([
        { name: ".secret", type: "file" },
        { name: "alpha", type: "file" },
      ]);
    });

    it("returns error when no readdir available", async () => {
      const executor = createToolExecutor();
      const result = await executor.list_dir({ path: "." });
      expect(result).toEqual(
        expect.objectContaining({
          error: "list_dir requires fs.readdir or vfs.readdir/list",
          total: 0,
          truncated: false,
        }),
      );
      expect(Array.from(result.entries)).toEqual([]);
    });
  });

  describe("tree", () => {
    const dirent = (name, isDir) => ({ name, isDirectory: () => isDir });

    it("builds tree with depth cap for deep nesting", async () => {
      const entries = {
        ".": [dirent("level1", true)],
        "./level1": [dirent("level2", true)],
        "./level1/level2": [dirent("level3", true)],
        "./level1/level2/level3": [dirent("level4", true)],
        "./level1/level2/level3/level4": [dirent("level5", true)],
        "./level1/level2/level3/level4/level5": [dirent("level6", true)],
      };
      const fs = {
        readdir: vi.fn((path) => Promise.resolve(entries[path] || [])),
      };
      const executor = createToolExecutor({ fs });

      const result = await executor.tree({ depth: Number.MAX_SAFE_INTEGER });

      expect(result.depth).toBe(5);
      expect(result.tree).toContain("level5");
      expect(result.tree).not.toContain("level6");
      expect(result.stats.dirs).toBe(5);
    });

    it("filters entries using a simple pattern", async () => {
      const fs = {
        readdir: vi.fn().mockResolvedValue([
          dirent(".secret", false),
          dirent("note.md", false),
          dirent("index.js", false),
        ]),
      };
      const executor = createToolExecutor({ fs });

      const result = await executor.tree({ pattern: "md" });

      expect(result.tree).toContain("note.md");
      expect(result.tree).not.toContain("index.js");
      expect(result.tree).not.toContain(".secret");
    });

    it("returns error when no readdir available", async () => {
      const executor = createToolExecutor();
      const result = await executor.tree({ path: "src" });

      expect(result).toEqual({ error: "tree requires fs.readdir or vfs.readdir/list", tree: "" });
    });
  });

  describe("index_symbols", () => {
    it("throws when pattern and paths are missing", async () => {
      const executor = createToolExecutor({ globFn: vi.fn() });
      await expect(executor.index_symbols({ paths: [] })).rejects.toThrow("pattern or paths is required");
    });

    it("returns error when globFn is missing", async () => {
      const executor = createToolExecutor();
      const result = await executor.index_symbols({ pattern: "*.js" });

      expect(result).toEqual(
        expect.objectContaining({
          error: "glob function not available",
          indexed: 0,
          skipped: 0,
          failed: 0,
          files: [],
        }),
      );
    });

    it("indexes files and tracks skipped results", async () => {
      const fs = { stat: vi.fn().mockResolvedValue({ size: 1 }) };
      const globFn = vi.fn().mockResolvedValue(["a.js", "b.js"]);
      const executor = createToolExecutor({ fs, globFn });
      const indexer = mocks.symbolIndexerInstances[0];

      indexer.indexFile
        .mockResolvedValueOnce({ skipped: true, symbols: ["a"] })
        .mockResolvedValueOnce({ skipped: false, symbols: ["b", "c"] });

      const result = await executor.index_symbols({ pattern: "*.js" });

      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.total).toBe(2);
      expect(result.files[0]).toEqual(expect.objectContaining({ skipped: true, symbolsCount: 1 }));
      expect(result.files[1]).toEqual(expect.objectContaining({ skipped: false, symbolsCount: 2 }));
    });

    it("forces indexing and stores symbol records", async () => {
      const vfs = { readText: vi.fn().mockResolvedValue("code") };
      const executor = createToolExecutor({ vfs, workspaceId: "workspace" });
      const indexer = mocks.symbolIndexerInstances[0];

      indexer.extractSymbolsAsync.mockResolvedValue(["sym1", "sym2"]);
      mocks.mockComputeSha256.mockResolvedValue("hash");

      const result = await executor.index_symbols({
        paths: ["file.js"],
        force: true,
        workspaceId: " custom ",
      });

      expect(indexer.store.putSymbolRecord).toHaveBeenCalledWith(
        "custom",
        "file.js",
        { sha256: "hash", symbols: ["sym1", "sym2"] },
      );
      expect(indexer.invalidateCaches).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({ indexed: 1, skipped: 0, failed: 0, workspaceId: "custom" }),
      );
    });

    it("marks oversized files as failed", async () => {
      const fs = { stat: vi.fn().mockResolvedValue({ size: 999 }) };
      const globFn = vi.fn().mockResolvedValue(["big.js"]);
      const executor = createToolExecutor({ fs, globFn, maxFileSize: 10 });

      const result = await executor.index_symbols({ pattern: "*.js" });

      expect(result.failed).toBe(1);
      expect(result.files[0].error).toContain("File too large");
    });

    it("clamps limit boundaries and accepts string limits", async () => {
      const fs = { stat: vi.fn().mockResolvedValue({ size: 1 }) };
      const executor = createToolExecutor({ fs });
      const indexer = mocks.symbolIndexerInstances[0];

      indexer.indexFile.mockResolvedValue({ skipped: false, symbols: [] });

      const result = await executor.index_symbols({
        paths: ["a.js", "b.js"],
        limit: "0",
      });

      expect(result.total).toBe(1);
      expect(result.truncated).toBe(true);
    });
  });

  describe("find_symbol", () => {
    it("returns matches and enforces maxResults", async () => {
      const executor = createToolExecutor({ maxResults: 1 });
      const indexer = mocks.symbolIndexerInstances[0];

      indexer.query.mockResolvedValue([
        { name: "Foo", path: "a.js" },
        { name: "FooBar", path: "b.js" },
      ]);

      const result = await executor.find_symbol({ query: "Foo" });

      expect(result.matches).toEqual([{ name: "Foo", path: "a.js" }]);
      expect(result.total).toBe(2);
      expect(result.truncated).toBe(true);
    });

    it("throws when query is blank", async () => {
      const executor = createToolExecutor();
      await expect(executor.find_symbol({ query: "   " })).rejects.toThrow("find_symbol: query is required");
    });

    it("returns error when query fails", async () => {
      const executor = createToolExecutor();
      const indexer = mocks.symbolIndexerInstances[0];

      indexer.query.mockImplementation(() => {
        throw new Error("query failed");
      });

      const result = await executor.find_symbol({ query: "Foo" });
      expect(result).toEqual({ error: "query failed", matches: [] });
    });
  });

  describe("execute", () => {
    it("returns error for unknown tool", async () => {
      const executor = createToolExecutor();
      const result = await executor.execute("unknown", {});
      expect(result).toEqual({ error: "Unknown tool: unknown" });
    });

    it("records watchdog action for plain object args", async () => {
      mocks.mockIsPlainObject.mockReturnValue(true);
      const watchdog = { recordAction: vi.fn() };
      const fs = { readdir: vi.fn().mockResolvedValue([]) };
      const executor = createToolExecutor({ watchdog, fs });

      await executor.execute("tree", {});

      expect(watchdog.recordAction).toHaveBeenCalledWith({ type: "tree", args: {} });
    });

    it("sanitizes non-object args and ignores watchdog errors", async () => {
      mocks.mockIsPlainObject.mockReturnValue(false);
      const captured = [];
      const watchdog = {
        recordAction: vi.fn((payload) => {
          captured.push(payload);
          throw new Error("fail");
        }),
      };
      const fs = { readdir: vi.fn().mockResolvedValue([]) };
      const executor = createToolExecutor({ watchdog, fs });

      const result = await executor.execute("tree", "bad");

      expect(captured[0]).toEqual({ type: "tree", args: {} });
      expect(result).toEqual(
        expect.objectContaining({
          tree: expect.any(String),
        }),
      );
    });
  });
});
