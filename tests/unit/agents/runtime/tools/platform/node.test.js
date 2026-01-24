import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  const toNonEmptyString = vi.fn((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });

  const globToRegex = vi.fn((pattern) => {
    const src = pattern && typeof pattern === "string" ? pattern : "*";
    const escaped = src
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/\\\\]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(escaped);
  });

  return { toNonEmptyString, globToRegex };
});

vi.mock("../../../../../../js/agents/runtime/core/exec/index.js", () => ({
  exec: vi.fn(),
}));

vi.mock("fast-glob", () => ({
  default: vi.fn(),
}));

import * as nodePlatform from "../../../../../../js/agents/runtime/tools/platform/node.js";
import { exec as execCommand } from "../../../../../../js/agents/runtime/core/exec/index.js";
import { globToRegex, toNonEmptyString } from "../../../../../../js/agents/shared/index.js";
import fastGlob from "fast-glob";

/** @type {string} */
let tempDir;
/** @type {string} */
let outsideDir;
let originalBun;
let originalDeno;
let hadBun;
let hadDeno;

async function createTools(options = {}) {
  return await nodePlatform.createNodeTools({ basePath: tempDir, ...options });
}

async function writeTempFile(relativePath, content) {
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
  if (hadBun) globalThis.Bun = originalBun;
  else delete globalThis.Bun;

  if (hadDeno) globalThis.Deno = originalDeno;
  else delete globalThis.Deno;

  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  if (outsideDir) await fs.rm(outsideDir, { recursive: true, force: true });
});

describe("platform/node exports", () => {
  it("should_export_createNodeTools_function_when_module_loaded", () => {
    expect(typeof nodePlatform.createNodeTools).toBe("function");
  });

  it("should_default_export_createNodeTools_when_module_loaded", () => {
    expect(nodePlatform.default.createNodeTools).toBe(nodePlatform.createNodeTools);
  });
});

describe("createNodeTools", () => {
  it("should_return_tools_with_expected_api_when_called", async () => {
    const tools = await createTools();

    expect(tools).toMatchObject({
      glob: expect.any(Function),
      grep: expect.any(Function),
      read: expect.any(Function),
      write: expect.any(Function),
      list: expect.any(Function),
      bash: expect.any(Function),
      platform: "node",
    });
  });

  it("should_return_bun_platform_when_globalThis_Bun_defined", async () => {
    globalThis.Bun = {};
    const tools = await createTools();

    expect(tools.platform).toBe("bun");
  });

  it("should_return_deno_platform_when_globalThis_Deno_defined", async () => {
    delete globalThis.Bun;
    globalThis.Deno = {};
    const tools = await createTools();

    expect(tools.platform).toBe("deno");
  });

  describe("glob", () => {
    it("should_return_files_when_fast_glob_available", async () => {
      const tools = await createTools();
      fastGlob.mockResolvedValue(["a.txt", "b.txt"]);

      const result = await tools.glob({ pattern: "**/*.txt", path: "." });

      expect(result).toEqual({ files: ["a.txt", "b.txt"] });
    });

    it("should_return_error_when_pattern_has_path_traversal", async () => {
      const tools = await createTools();

      const result = await tools.glob({ pattern: "../*.js", path: "." });

      expect(result).toEqual({ files: [], error: "Path traversal detected" });
    });

    it("should_return_error_when_search_path_has_path_traversal", async () => {
      const tools = await createTools();

      const result = await tools.glob({ pattern: "*.txt", path: "../" });

      expect(result).toEqual({ files: [], error: "Path traversal detected" });
    });

    it("should_return_error_when_search_path_outside_base_directory", async () => {
      const tools = await createTools();

      const result = await tools.glob({ pattern: "*.txt", path: outsideDir });

      expect(result).toEqual({ files: [], error: "Path outside allowed directory" });
    });

    it("should_fallback_to_walkDir_when_fast_glob_throws", async () => {
      const tools = await createTools();
      fastGlob.mockImplementation(() => {
        throw new Error("fast-glob unavailable");
      });

      await writeTempFile("root.txt", "root");
      await writeTempFile("sub/inner.txt", "inner");
      await writeTempFile("node_modules/skip.txt", "skip");
      await writeTempFile(".hidden/secret.txt", "secret");

      const deepSegments = Array.from({ length: 12 }, (_, i) => `level${i}`);
      const deepRelPath = path.join("deep", ...deepSegments, "deep.txt");
      await writeTempFile(deepRelPath, "deep");

      const result = await tools.glob({ pattern: "**/*.txt", path: "." });

      expect([...result.files].sort()).toEqual(
        ["root.txt", path.join("sub", "inner.txt"), deepRelPath].sort()
      );
    });
  });

  describe("grep", () => {
    it("should_return_matches_when_rg_succeeds", async () => {
      const tools = await createTools();
      execCommand.mockResolvedValue({
        success: true,
        stdout: "file1.txt:2:hello\nsub/file2.txt:10:world\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await tools.grep({ pattern: "hello", path: tempDir });

      expect(result).toEqual({
        matches: [
          { file: "file1.txt", line: 2, content: "hello" },
          { file: "sub/file2.txt", line: 10, content: "world" },
        ],
      });
    });

    it("should_fallback_to_manual_search_when_rg_fails_case_insensitive", async () => {
      const tools = await createTools();
      execCommand.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "missing rg",
        exitCode: 2,
      });
      fastGlob.mockResolvedValue(["alpha.txt", "beta.txt"]);

      await writeTempFile("alpha.txt", "Hello WORLD\nNext line");
      await writeTempFile("beta.txt", "nothing here");

      const result = await tools.grep({
        pattern: "world",
        path: tempDir,
        regex: false,
        caseSensitive: false,
      });

      expect(result).toEqual({
        matches: [{ file: "alpha.txt", line: 1, content: "Hello WORLD" }],
      });
    });

    it("should_support_regex_search_when_rg_fails_and_regex_true", async () => {
      const tools = await createTools();
      execCommand.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "missing rg",
        exitCode: 2,
      });
      fastGlob.mockResolvedValue(["alpha.txt"]);

      await writeTempFile("alpha.txt", "Hello WORLD\nNext line");

      const result = await tools.grep({
        pattern: "^hello",
        path: tempDir,
        regex: true,
        caseSensitive: false,
      });

      expect(result).toEqual({
        matches: [{ file: "alpha.txt", line: 1, content: "Hello WORLD" }],
      });
    });

    it("should_return_error_when_search_path_has_path_traversal", async () => {
      const tools = await createTools();

      const result = await tools.grep({ pattern: "x", path: "../" });

      expect(result).toEqual({ matches: [], error: "Path traversal detected" });
    });

    it("should_return_error_when_search_path_outside_base_directory", async () => {
      const tools = await createTools();

      const result = await tools.grep({ pattern: "x", path: outsideDir });

      expect(result).toEqual({ matches: [], error: "Path outside allowed directory" });
    });
  });

  describe("read", () => {
    it("should_return_content_when_file_exists", async () => {
      const tools = await createTools();
      await writeTempFile("sample.txt", "line1\nline2\nline3");

      const result = await tools.read({ path: "sample.txt" });

      expect(result).toEqual({ content: "line1\nline2\nline3" });
    });

    it("should_return_content_when_startLine_and_endLine_provided", async () => {
      const tools = await createTools();
      await writeTempFile("sample.txt", "line1\nline2\nline3");

      const result = await tools.read({ path: "sample.txt", startLine: 2, endLine: 3 });

      expect(result).toEqual({ content: "line2\nline3" });
    });

    it("should_return_content_when_startLine_is_zero_and_endLine_is_negative", async () => {
      const tools = await createTools();
      await writeTempFile("bounds.txt", "a\nb\nc");

      const result = await tools.read({ path: "bounds.txt", startLine: 0, endLine: -1 });

      expect(result).toEqual({ content: "a\nb" });
    });

    it("should_return_error_when_file_not_found", async () => {
      const tools = await createTools();

      const result = await tools.read({ path: "missing.txt" });

      expect(result).toEqual({ content: "", error: "File not found" });
    });

    it("should_return_error_when_path_has_path_traversal", async () => {
      const tools = await createTools();

      const result = await tools.read({ path: "../hack.txt" });

      expect(result).toEqual({ content: "", error: "Path traversal detected" });
    });

    it("should_return_error_when_path_outside_base_directory", async () => {
      const tools = await createTools();

      const result = await tools.read({ path: path.join(outsideDir, "out.txt") });

      expect(result).toEqual({ content: "", error: "Path outside allowed directory" });
    });

    it("should_return_large_content_when_file_is_large", async () => {
      const tools = await createTools();
      const largeContent = "x".repeat(1024 * 1024);
      await writeTempFile("big.txt", largeContent);

      const result = await tools.read({ path: "big.txt" });

      expect(result.content.length).toBe(largeContent.length);
    });
  });

  describe("write", () => {
    it("should_return_success_true_when_writing_nested_path", async () => {
      const tools = await createTools();

      const result = await tools.write({ path: "nested/dir/file.txt", content: "ok" });

      expect(result).toEqual({ success: true });
    });

    it("should_persist_content_when_write_succeeds", async () => {
      const tools = await createTools();
      const longContent = "y".repeat(10000);

      await tools.write({ path: "nested/dir/long.txt", content: longContent });
      const stored = await fs.readFile(path.join(tempDir, "nested/dir/long.txt"), "utf-8");

      expect(stored).toBe(longContent);
    });

    it("should_return_error_when_path_has_path_traversal", async () => {
      const tools = await createTools();

      const result = await tools.write({ path: "../hack.txt", content: "x" });

      expect(result).toEqual({ success: false, error: "Path traversal detected" });
    });

    it("should_return_error_when_path_outside_base_directory", async () => {
      const tools = await createTools();

      const result = await tools.write({ path: path.join(outsideDir, "out.txt"), content: "x" });

      expect(result).toEqual({ success: false, error: "Path outside allowed directory" });
    });

    it("should_return_success_false_when_content_is_invalid_type", async () => {
      const tools = await createTools();

      const result = await tools.write({ path: "bad.txt", content: Symbol("nope") });

      expect(result).toEqual({ success: false, error: expect.any(String) });
    });

    it("should_support_concurrent_writes_when_called_in_parallel", async () => {
      const tools = await createTools();

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          tools.write({ path: `batch/file-${i}.txt`, content: `data-${i}` })
        )
      );

      expect(results.every((result) => result.success)).toBe(true);
    });
  });

  describe("list", () => {
    it("should_list_entries_when_path_is_undefined", async () => {
      const tools = await createTools();
      await writeTempFile("alpha.txt", "a");

      const result = await tools.list({});

      expect(result.entries).toEqual(expect.arrayContaining(["alpha.txt"]));
    });

    it("should_list_entries_when_path_is_whitespace", async () => {
      const tools = await createTools();
      await writeTempFile("alpha.txt", "a");

      const result = await tools.list({ path: "   " });

      expect(result.entries).toEqual(expect.arrayContaining(["alpha.txt"]));
    });

    it("should_list_entries_when_path_is_null", async () => {
      const tools = await createTools();
      await writeTempFile("alpha.txt", "a");

      const result = await tools.list({ path: null });

      expect(result.entries).toEqual(expect.arrayContaining(["alpha.txt"]));
    });

    it("should_return_error_when_directory_not_found", async () => {
      const tools = await createTools();

      const result = await tools.list({ path: "missing-dir" });

      expect(result).toEqual({ entries: [], error: "Directory not found" });
    });

    it("should_return_error_when_path_outside_base_directory", async () => {
      const tools = await createTools();

      const result = await tools.list({ path: outsideDir });

      expect(result).toEqual({ entries: [], error: "Path outside allowed directory" });
    });
  });

  describe("bash", () => {
    it("should_return_error_when_command_is_empty_string", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: "" });

      expect(result).toEqual({ stdout: "", stderr: "", exitCode: -1, error: "Command required" });
    });

    it("should_return_error_when_command_is_whitespace", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: "   " });

      expect(result).toEqual({ stdout: "", stderr: "", exitCode: -1, error: "Command required" });
    });

    it("should_return_error_when_command_is_not_a_string", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: null });

      expect(result).toEqual({ stdout: "", stderr: "", exitCode: -1, error: "Command required" });
    });

    it("should_return_error_when_command_has_unclosed_quote", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: "echo \"oops" });

      expect(result).toEqual({
        stdout: "",
        stderr: "",
        exitCode: -1,
        error: "Unclosed quote in command",
      });
    });

    it("should_block_command_when_not_in_allowlist", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });

      const result = await tools.bash({ command: "ls -la" });

      expect(result).toEqual({
        stdout: "",
        stderr: "",
        exitCode: -1,
        error: "Command not allowed",
      });
    });

    it("should_log_warning_when_command_blocked_by_allowlist", async () => {
      const logger = { warn: vi.fn() };
      const tools = await createTools({ allowedCommands: ["echo"], logger });

      await tools.bash({ command: "ls -la" });

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("should_allow_all_commands_when_allowlist_is_empty_array", async () => {
      const tools = await createTools({ allowedCommands: [] });
      execCommand.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

      const result = await tools.bash({ command: "echo ok" });

      expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    });

    it("should_parse_quoted_args_when_command_contains_spaces", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo \"hello world\"" });

      expect(execCommand.mock.calls[0][1]).toEqual(["hello world"]);
    });

    it("should_parse_escaped_quotes_inside_double_quotes", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo \"a\\\"b\"" });

      expect(execCommand.mock.calls[0][1]).toEqual(["a\"b"]);
    });

    it("should_use_basePath_as_cwd_when_executing", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo hi" });

      expect(execCommand.mock.calls[0][2]).toMatchObject({ cwd: tempDir });
    });

    it("should_clamp_timeout_to_minimum_one_ms_when_timeout_is_zero", async () => {
      const tools = await createTools({ allowedCommands: ["echo"], maxTimeoutMs: 5 });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo hi", timeout: 0 });

      expect(execCommand.mock.calls[0][2]).toMatchObject({ timeout: 1 });
    });

    it("should_clamp_timeout_to_maxTimeoutMs_when_timeout_exceeds_maxTimeoutMs", async () => {
      const tools = await createTools({ allowedCommands: ["echo"], maxTimeoutMs: 5 });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo hi", timeout: Number.MAX_SAFE_INTEGER });

      expect(execCommand.mock.calls[0][2]).toMatchObject({ timeout: 5 });
    });

    it("should_use_maxTimeoutMs_when_timeout_is_not_finite", async () => {
      const tools = await createTools({ allowedCommands: ["echo"], maxTimeoutMs: 5 });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      await tools.bash({ command: "echo hi", timeout: "10" });

      expect(execCommand.mock.calls[0][2]).toMatchObject({ timeout: 5 });
    });

    it("should_return_error_when_execCommand_throws", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });
      execCommand.mockRejectedValue(new Error("boom"));

      const result = await tools.bash({ command: "echo hi" });

      expect(result).toEqual({ stdout: "", stderr: "", exitCode: -1, error: "boom" });
    });

    it("should_include_error_when_execCommand_returns_error_field", async () => {
      const tools = await createTools({ allowedCommands: ["echo"] });
      execCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1, error: "bad" });

      const result = await tools.bash({ command: "echo hi" });

      expect(result).toEqual({ stdout: "", stderr: "", exitCode: 1, error: "bad" });
    });
  });
});