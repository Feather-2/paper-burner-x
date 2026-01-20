import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    globToRegex: vi.fn(actual.globToRegex),
  };
});

vi.mock("../../../../../../js/agents/runtime/core/exec/index.js", () => ({
  exec: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

import { createNodeTools } from "../../../../../../js/agents/runtime/tools/platform/node.js";
import { exec as execCommand } from "../../../../../../js/agents/runtime/core/exec/index.js";
import { toNonEmptyString, globToRegex } from "../../../../../../js/agents/shared/index.js";
import fastGlob from "fast-glob";

let tempDir;
let outsideDir;
let originalBun;
let originalDeno;
let hadBun;
let hadDeno;

async function makeTools(options = {}) {
  return await createNodeTools({ basePath: tempDir, ...options });
}

async function writeFile(relativePath, content) {
  const fullPath = path.join(tempDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
  return fullPath;
}

beforeEach(async () => {
  hadBun = Object.prototype.hasOwnProperty.call(globalThis, "Bun");
  hadDeno = Object.prototype.hasOwnProperty.call(globalThis, "Deno");
  originalBun = globalThis.Bun;
  originalDeno = globalThis.Deno;

  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "node-tools-test-"));
  outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "node-tools-outside-"));

  execCommand.mockReset();
  fastGlob.mockReset();
  fastGlob.mockResolvedValue([]);
  toNonEmptyString.mockClear();
  globToRegex.mockClear();
});

afterEach(async () => {
  if (hadBun) {
    globalThis.Bun = originalBun;
  } else {
    delete globalThis.Bun;
  }

  if (hadDeno) {
    globalThis.Deno = originalDeno;
  } else {
    delete globalThis.Deno;
  }

  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (outsideDir) {
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

describe("createNodeTools", () => {
  it("creates tools and defaults to node platform", async () => {
    const tools = await makeTools();

    expect(tools.platform).toBe("node");
    expect(typeof tools.glob).toBe("function");
    expect(typeof tools.grep).toBe("function");
    expect(typeof tools.read).toBe("function");
    expect(typeof tools.write).toBe("function");
    expect(typeof tools.list).toBe("function");
    expect(typeof tools.bash).toBe("function");
  });

  it("detects bun and deno globals", async () => {
    globalThis.Bun = {};
    const bunTools = await makeTools();
    expect(bunTools.platform).toBe("bun");

    delete globalThis.Bun;
    globalThis.Deno = {};
    const denoTools = await makeTools();
    expect(denoTools.platform).toBe("deno");
  });

  describe("glob", () => {
    it("uses fast-glob when available", async () => {
      const tools = await makeTools();
      fastGlob.mockResolvedValue(["a.txt", "b.txt"]);

      const result = await tools.glob({ pattern: "**/*.txt", path: "." });

      expect(result).toEqual({ files: ["a.txt", "b.txt"] });
      expect(fastGlob).toHaveBeenCalledWith(
        "**/*.txt",
        expect.objectContaining({
          cwd: tempDir,
          absolute: false,
          onlyFiles: true,
          ignore: expect.any(Array),
        })
      );
    });

    it("falls back to walkDir and filters ignored entries", async () => {
      const tools = await makeTools();
      fastGlob.mockImplementation(() => {
        throw new Error("fast-glob unavailable");
      });

      await writeFile("root.txt", "root");
      await writeFile("sub/inner.txt", "inner");
      await writeFile("node_modules/skip.txt", "skip");
      await writeFile(".hidden/secret.txt", "secret");

      const deepSegments = Array.from({ length: 12 }, (_, i) => `level${i}`);
      const deepRelPath = path.join("deep", ...deepSegments, "deep.txt");
      await writeFile(deepRelPath, "deep");

      const result = await tools.glob({ pattern: "**/*.txt", path: "." });

      expect(result.files).toEqual(
        expect.arrayContaining([
          "root.txt",
          path.join("sub", "inner.txt"),
          deepRelPath,
        ])
      );
      expect(result.files).not.toEqual(
        expect.arrayContaining([
          path.join("node_modules", "skip.txt"),
          path.join(".hidden", "secret.txt"),
        ])
      );
      expect(globToRegex).toHaveBeenCalledWith("**/*.txt");
      expect(result.files.every((file) => !file.startsWith(tempDir))).toBe(true);
    });

    it("rejects traversal patterns and unsafe paths", async () => {
      const tools = await makeTools();

      const traversal = await tools.glob({ pattern: "../*.js", path: "." });
      expect(traversal).toEqual({ files: [], error: "Path traversal detected" });

      const outside = await tools.glob({ pattern: "*.txt", path: outsideDir });
      expect(outside.files).toEqual([]);
      expect(outside.error).toBe("Path outside allowed directory");
    });
  });

  describe("grep", () => {
    it("parses ripgrep output when rg succeeds", async () => {
      const tools = await makeTools();
      execCommand.mockResolvedValue({
        success: true,
        stdout: "file1.txt:2:hello\nsub/file2.txt:10:world\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await tools.grep({ pattern: "hello", path: tempDir });

      expect(result.matches).toEqual([
        { file: "file1.txt", line: 2, content: "hello" },
        { file: "sub/file2.txt", line: 10, content: "world" },
      ]);
      expect(execCommand).toHaveBeenCalledWith(
        "rg",
        expect.arrayContaining([
          "-F",
          "hello",
          "--line-number",
          "--no-heading",
          "--max-count=100",
          tempDir,
        ]),
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it("falls back to manual search when rg fails", async () => {
      const tools = await makeTools();
      execCommand.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "missing rg",
        exitCode: 2,
      });
      fastGlob.mockResolvedValue(["alpha.txt", "beta.txt"]);

      await writeFile("alpha.txt", "Hello WORLD\nNext line");
      await writeFile("beta.txt", "nothing here");

      const result = await tools.grep({
        pattern: "world",
        path: tempDir,
        regex: false,
        caseSensitive: false,
      });

      expect(result.matches).toEqual([
        { file: "alpha.txt", line: 1, content: "Hello WORLD" },
      ]);

      const regexResult = await tools.grep({
        pattern: "^hello",
        path: tempDir,
        regex: true,
        caseSensitive: false,
      });

      expect(regexResult.matches[0]).toMatchObject({ file: "alpha.txt", line: 1 });
    });

    it("rejects traversal paths", async () => {
      const tools = await makeTools();

      const result = await tools.grep({ pattern: "x", path: "../" });

      expect(result.matches).toEqual([]);
      expect(result.error).toBe("Path traversal detected");
    });
  });

  describe("read", () => {
    it("reads full content and line ranges", async () => {
      const tools = await makeTools();
      await writeFile("sample.txt", "line1\nline2\nline3");

      const full = await tools.read({ path: "sample.txt" });
      expect(full.content).toBe("line1\nline2\nline3");

      const range = await tools.read({ path: "sample.txt", startLine: 2, endLine: 3 });
      expect(range.content).toBe("line2\nline3");
    });

    it("handles boundary lines and missing files", async () => {
      const tools = await makeTools();
      await writeFile("bounds.txt", "a\nb\nc");

      const partial = await tools.read({ path: "bounds.txt", startLine: 0, endLine: -1 });
      expect(partial.content).toBe("a\nb");

      const missing = await tools.read({ path: "missing.txt" });
      expect(missing.error).toBe("File not found");
    });

    it("reads large files", async () => {
      const tools = await makeTools();
      const largeContent = "x".repeat(1024 * 1024);
      await writeFile("big.txt", largeContent);

      const result = await tools.read({ path: "big.txt" });

      expect(result.content.length).toBe(largeContent.length);
    });
  });

  describe("write", () => {
    it("writes long content to nested paths", async () => {
      const tools = await makeTools();
      const longContent = "y".repeat(10000);

      const result = await tools.write({
        path: "nested/dir/long.txt",
        content: longContent,
      });

      expect(result.success).toBe(true);

      const stored = await fs.readFile(path.join(tempDir, "nested/dir/long.txt"), "utf-8");
      expect(stored).toBe(longContent);
    });

    it("rejects traversal and outside paths", async () => {
      const tools = await makeTools();

      const traversal = await tools.write({ path: "../hack.txt", content: "x" });
      expect(traversal.success).toBe(false);
      expect(traversal.error).toBe("Path traversal detected");

      const outside = await tools.write({
        path: path.join(outsideDir, "out.txt"),
        content: "x",
      });
      expect(outside.success).toBe(false);
      expect(outside.error).toBe("Path outside allowed directory");
    });

    it("supports concurrent writes", async () => {
      const tools = await makeTools();

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          tools.write({ path: `batch/file-${i}.txt`, content: `data-${i}` })
        )
      );

      expect(results.every((result) => result.success)).toBe(true);

      const entries = await fs.readdir(path.join(tempDir, "batch"));
      expect(entries.length).toBe(5);
    });
  });

  describe("list", () => {
    it("lists entries for base path with empty or whitespace input", async () => {
      const tools = await makeTools();
      await writeFile("alpha.txt", "a");
      await writeFile("beta.txt", "b");
      await fs.mkdir(path.join(tempDir, "subdir"), { recursive: true });

      const first = await tools.list({});
      const second = await tools.list({ path: "   " });
      const third = await tools.list({ path: null });

      const normalize = (entries) => [...entries].sort();
      expect(normalize(first.entries)).toEqual(normalize(second.entries));
      expect(normalize(first.entries)).toEqual(normalize(third.entries));
      expect(first.entries).toEqual(expect.arrayContaining(["alpha.txt", "beta.txt", "subdir"]));
    });

    it("returns errors for missing or unsafe directories", async () => {
      const tools = await makeTools();

      const missing = await tools.list({ path: "missing-dir" });
      expect(missing.entries).toEqual([]);
      expect(missing.error).toBe("Directory not found");

      const outside = await tools.list({ path: outsideDir });
      expect(outside.entries).toEqual([]);
      expect(outside.error).toBe("Path outside allowed directory");
    });
  });

  describe("bash", () => {
    it("rejects empty or whitespace commands", async () => {
      const tools = await makeTools({ allowedCommands: ["echo"] });

      const empty = await tools.bash({ command: "" });
      expect(empty.exitCode).toBe(-1);
      expect(empty.error).toBe("Command required");

      const whitespace = await tools.bash({ command: "   " });
      expect(whitespace.exitCode).toBe(-1);
      expect(whitespace.error).toBe("Command required");
    });

    it("rejects unclosed quotes", async () => {
      const tools = await makeTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: "echo \"oops" });

      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe("Unclosed quote in command");
    });

    it("blocks commands when allowlist is empty or invalid", async () => {
      const logger = { warn: vi.fn() };
      const toolsEmpty = await makeTools({ allowedCommands: [], logger });

      const blocked = await toolsEmpty.bash({ command: "echo ok" });
      expect(blocked.exitCode).toBe(-1);
      expect(blocked.error).toBe("Command not allowed");

      const toolsInvalid = await makeTools({ allowedCommands: {}, logger });
      const blockedInvalid = await toolsInvalid.bash({ command: "echo ok" });
      expect(blockedInvalid.exitCode).toBe(-1);
      expect(blockedInvalid.error).toBe("Command not allowed");
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it("executes allowed commands with parsed args and timeout bounds", async () => {
      const tools = await makeTools({ allowedCommands: ["echo"], maxTimeoutMs: 5 });
      execCommand.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo \"hello world\"", timeout: 0 });
      await tools.bash({ command: "echo negative", timeout: -1 });
      await tools.bash({ command: "echo huge", timeout: Number.MAX_SAFE_INTEGER });
      await tools.bash({ command: "echo string", timeout: "10" });

      expect(execCommand).toHaveBeenCalledTimes(4);

      const [call1, call2, call3, call4] = execCommand.mock.calls;

      expect(call1[0]).toBe("echo");
      expect(call1[1]).toEqual(["hello world"]);
      expect(call1[2]).toMatchObject({ cwd: tempDir, timeout: 1 });

      expect(call2[2]).toMatchObject({ timeout: 1 });
      expect(call3[2]).toMatchObject({ timeout: 5 });
      expect(call4[2]).toMatchObject({ timeout: 5 });
    });

    it("returns error when execCommand throws", async () => {
      const tools = await makeTools({ allowedCommands: ["echo"] });
      execCommand.mockRejectedValue(new Error("boom"));

      const result = await tools.bash({ command: "echo hi" });

      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe("boom");
    });
  });
});
