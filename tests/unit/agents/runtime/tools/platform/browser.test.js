import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    globToRegex: vi.fn(actual.globToRegex),
  };
});

import { createBrowserTools } from "../../../../../../js/agents/runtime/tools/platform/browser.js";
import { globToRegex } from "../../../../../../js/agents/shared/index.js";

const makeLogger = () => ({
  warn: vi.fn(),
  debug: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBrowserTools", () => {
  it("exposes browser toolset metadata", () => {
    const vfs = { readText: vi.fn(async () => "ok") };
    const tools = createBrowserTools({ vfs });

    expect(tools.platform).toBe("browser");
    expect(tools.bash).toBeNull();
    expect(typeof tools.read).toBe("function");
    expect(typeof tools.write).toBe("function");
    expect(typeof tools.list).toBe("function");
    expect(typeof tools.glob).toBe("function");
    expect(typeof tools.grep).toBe("function");
  });

  it("warns when vfs is missing and returns VFS not available errors", async () => {
    const logger = makeLogger();
    const tools = createBrowserTools({ logger });

    expect(logger.warn).toHaveBeenCalledWith(
      "[platform/browser] VFS not provided, file operations will fail",
    );

    const [globResult, grepResult, readResult, writeResult, listResult] = await Promise.all([
      tools.glob({ pattern: "*.txt", path: "." }),
      tools.grep({ pattern: "x", path: "." }),
      tools.read({ path: "file.txt" }),
      tools.write({ path: "file.txt", content: "x" }),
      tools.list({ path: "." }),
    ]);

    expect(globResult.error).toBe("VFS not available");
    expect(grepResult.error).toBe("VFS not available");
    expect(readResult.error).toBe("VFS not available");
    expect(writeResult.error).toBe("VFS not available");
    expect(listResult.error).toBe("VFS not available");
  });

  it("normalizes paths with basePath and handles empty inputs", async () => {
    const vfs = { readText: vi.fn(async () => "data") };
    const tools = createBrowserTools({ vfs, basePath: "root\\base//" });

    await tools.read({ path: "folder\\file.txt" });
    await tools.read({ path: "   " });
    await tools.read({ path: "" });
    await tools.read({ path: null });
    await tools.read({ path: undefined });

    const calls = vfs.readText.mock.calls.map((call) => call[0]);
    expect(calls).toEqual([
      "root/base/folder/file.txt",
      "root/base",
      "root/base",
      "root/base",
      "root/base",
    ]);
  });

  it("rejects absolute paths and traversal attempts", async () => {
    const vfs = { readText: vi.fn(async () => "data") };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const absolute = await tools.read({ path: "/etc/passwd" });
    const traversal = await tools.read({ path: "../secret" });
    const nestedTraversal = await tools.read({ path: "a/../b" });

    expect(absolute.error).toBe("Absolute paths are not allowed");
    expect(traversal.error).toBe("Path traversal detected");
    expect(nestedTraversal.error).toBe("Path traversal detected");
  });

  it("reads line ranges with boundary values and ignores non-numeric ranges", async () => {
    const content = "line1\nline2\nline3";
    const vfs = { readText: vi.fn(async () => content) };
    const tools = createBrowserTools({ vfs });

    const full = await tools.read({
      path: "file.txt",
      startLine: 0,
      endLine: Number.MAX_SAFE_INTEGER,
    });
    const sliced = await tools.read({
      path: "file.txt",
      startLine: -1,
      endLine: -1,
    });
    const typeBoundary = await tools.read({
      path: "file.txt",
      startLine: "2",
    });

    expect(full.content).toBe(content);
    expect(sliced.content).toBe("line1\nline2");
    expect(typeBoundary.content).toBe(content);
  });

  it("reads via vfs.read when readText is missing and reports missing files", async () => {
    const encoder = new TextEncoder();
    const vfs = {
      read: vi.fn(async (path) => {
        if (path === "missing.txt") return null;
        return encoder.encode("binary-data");
      }),
    };
    const tools = createBrowserTools({ vfs });

    const ok = await tools.read({ path: "file.txt" });
    const missing = await tools.read({ path: "missing.txt" });

    expect(ok.content).toBe("binary-data");
    expect(missing.error).toBe("File not found");
  });

  it("writes with writeText and supports long content", async () => {
    const store = new Map();
    const vfs = {
      writeText: vi.fn(async (path, content) => {
        store.set(path, content);
      }),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });
    const longContent = "x".repeat(10000);

    const result = await tools.write({ path: "file.txt", content: longContent });

    expect(result.success).toBe(true);
    expect(store.get("root/file.txt")).toBe(longContent);
  });

  it("writes via vfs.write fallback and handles unsupported VFS", async () => {
    const writes = [];
    const vfs = {
      write: vi.fn(async (path, data) => {
        writes.push({ path, data });
      }),
    };
    const tools = createBrowserTools({ vfs });

    const ok = await tools.write({ path: "file.txt", content: "hello" });
    const unsupportedTools = createBrowserTools({ vfs: {} });
    const unsupported = await unsupportedTools.write({ path: "x", content: "y" });

    expect(ok.success).toBe(true);
    expect(writes[0].path).toBe("file.txt");
    expect(writes[0].data).toBeInstanceOf(Uint8Array);
    expect(unsupported.error).toBe("VFS write not supported");
  });

  it("lists entries via list/readdir and handles non-array results", async () => {
    const vfsList = { list: vi.fn(async () => ["a", "b"]) };
    const toolsList = createBrowserTools({ vfs: vfsList });
    const listResult = await toolsList.list({ path: "." });

    const vfsNonArray = { list: vi.fn(async () => ({ a: 1 })) };
    const toolsNonArray = createBrowserTools({ vfs: vfsNonArray });
    const nonArrayResult = await toolsNonArray.list({ path: "." });

    const vfsReaddir = { readdir: vi.fn(async () => ["x"]) };
    const toolsReaddir = createBrowserTools({ vfs: vfsReaddir });
    const readdirResult = await toolsReaddir.list({ path: "." });

    const unsupportedTools = createBrowserTools({ vfs: {} });
    const unsupported = await unsupportedTools.list({ path: "." });

    expect(listResult.entries).toEqual(["a", "b"]);
    expect(nonArrayResult.entries).toEqual([]);
    expect(readdirResult.entries).toEqual(["x"]);
    expect(unsupported.error).toBe("VFS list not supported");
  });

  it("glob uses vfs.glob, normalizes cwd, and handles empty results", async () => {
    const vfs = {
      glob: vi.fn()
        .mockResolvedValueOnce(["a.txt"])
        .mockResolvedValueOnce([]),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const result = await tools.glob({ pattern: "*.txt", path: "dir" });
    const empty = await tools.glob({ pattern: "*.none", path: "" });

    expect(result.files).toEqual(["a.txt"]);
    expect(vfs.glob).toHaveBeenCalledWith("*.txt", { cwd: "root/dir" });
    expect(empty.files).toEqual([]);
  });

  it("glob handles non-array returns and vfs.glob errors", async () => {
    const vfs = {
      glob: vi.fn()
        .mockResolvedValueOnce("oops")
        .mockRejectedValueOnce(new Error("boom")),
    };
    const tools = createBrowserTools({ vfs });

    const nonArray = await tools.glob({ pattern: "*.txt", path: "." });
    const error = await tools.glob({ pattern: "*.txt", path: "." });

    expect(nonArray.files).toEqual([]);
    expect(error.error).toBe("boom");
  });

  it("glob falls back to walkAndMatch and handles deep nesting", async () => {
    const tree = new Map([
      ["root", ["level1", "notes.txt"]],
      ["root/level1", ["level2"]],
      ["root/level1/level2", ["level3"]],
      ["root/level1/level2/level3", ["leaf.txt", "skip.md"]],
    ]);
    const vfs = {
      list: vi.fn(async (path) => tree.get(path) || []),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const result = await tools.glob({ pattern: "**/*.txt", path: "." });

    expect(result.files).toContain("root/notes.txt");
    expect(result.files).toContain("root/level1/level2/level3/leaf.txt");
  });

  it("glob fallback detects directories via stat instead of filename heuristics", async () => {
    const tree = new Map([
      ["root", ["dir.with.dot", "README"]],
      ["root/dir.with.dot", ["nested.txt"]],
    ]);
    const stats = new Map([
      ["root/dir.with.dot", true],
      ["root/README", false],
      ["root/dir.with.dot/nested.txt", false],
    ]);
    const vfs = {
      list: vi.fn(async (path) => {
        if (!tree.has(path)) throw new Error("not a directory");
        return tree.get(path);
      }),
      stat: vi.fn(async (path) => ({
        isDirectory: () => stats.get(path) === true,
      })),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const result = await tools.glob({ pattern: "**/*.txt", path: "." });
    expect(result.files).toEqual(["root/dir.with.dot/nested.txt"]);
  });

  it("glob fallback caps results at 100", async () => {
    const many = Array.from({ length: 120 }, (_, i) => `file${i}.log`);
    const tree = new Map([["root", many]]);
    const vfs = {
      list: vi.fn(async (path) => tree.get(path) || []),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const result = await tools.glob({ pattern: "**/*.log", path: "." });

    expect(result.files.length).toBe(100);
  });

  it("glob returns error when globToRegex throws and logs list failures", async () => {
    globToRegex.mockImplementationOnce(() => {
      throw new Error("bad glob");
    });
    const logger = makeLogger();
    const vfs = {
      list: vi.fn(async () => {
        throw new Error("nope");
      }),
    };
    const tools = createBrowserTools({ vfs, logger });

    const errorResult = await tools.glob({ pattern: "bad", path: "." });
    const listResult = await tools.glob({ pattern: "**/*", path: "." });

    expect(errorResult.error).toBe("bad glob");
    expect(listResult.files).toEqual([]);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("grep finds string matches and skips unreadable files", async () => {
    const logger = makeLogger();
    const vfs = {
      glob: vi.fn(async () => ["a.txt", "b.txt", "empty.txt"]),
      readText: vi.fn(async (path) => {
        if (path === "b.txt") throw new Error("read fail");
        if (path === "empty.txt") return "";
        return "hello\nfoo bar\nbaz";
      }),
    };
    const tools = createBrowserTools({ vfs, logger });

    const result = await tools.grep({ pattern: "foo", path: "." });

    expect(result.matches).toEqual([
      { file: "a.txt", line: 2, content: "foo bar" },
    ]);
    expect(logger.debug).toHaveBeenCalled();
  });

  it("grep supports regex search and caps matches for large files", async () => {
    const lines = Array.from({ length: 2000 }, () => "hit");
    const vfs = {
      glob: vi.fn(async () => ["big.txt"]),
      readText: vi.fn(async () => lines.join("\n")),
    };
    const tools = createBrowserTools({ vfs });

    const result = await tools.grep({ pattern: "^hit$", regex: true, path: "." });

    expect(result.matches.length).toBe(100);
    expect(result.matches[0]).toEqual({ file: "big.txt", line: 1, content: "hit" });
  });

  it("grep returns error for invalid regex patterns", async () => {
    const vfs = { glob: vi.fn(async () => []) };
    const tools = createBrowserTools({ vfs });

    const result = await tools.grep({ pattern: "[", regex: true, path: "." });

    expect(result.error).toMatch(/Invalid regular expression|unterminated/i);
  });

  it("supports concurrent reads and rapid consecutive calls", async () => {
    const store = new Map([
      ["root/a.txt", "A"],
      ["root/b.txt", "B"],
    ]);
    const vfs = {
      readText: vi.fn(async (path) => store.get(path) || null),
    };
    const tools = createBrowserTools({ vfs, basePath: "root" });

    const [a, b] = await Promise.all([
      tools.read({ path: "a.txt" }),
      tools.read({ path: "b.txt" }),
    ]);

    expect(a.content).toBe("A");
    expect(b.content).toBe("B");

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await tools.read({ path: "a.txt" }));
    }

    expect(results.every((item) => item.content === "A")).toBe(true);
  });
});
