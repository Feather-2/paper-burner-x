import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { exec, execShell, execSimple, commandExists } from "../../js/agents/runtime/exec/index.js";

describe("runtime/exec", () => {
  describe("exec", () => {
    it("executes command and returns result", async () => {
      const result = await exec("echo", ["hello"]);

      assert.equal(result.success, true);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("hello"));
      assert.equal(result.timedOut, false);
    });

    it("captures stderr for failed commands", async () => {
      const result = await exec("ls", ["nonexistent_file_xyz_123"]);

      assert.equal(result.success, false);
      assert.notEqual(result.exitCode, 0);
    });

    it("respects timeout option", async () => {
      const result = await exec("sleep", ["10"], { timeout: 100 });

      assert.equal(result.success, false);
      assert.equal(result.timedOut, true);
      assert.ok(result.error?.includes("timed out"));
    });

    it("respects cwd option", async () => {
      const result = await exec("pwd", [], { cwd: "/tmp" });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes("/tmp") || result.stdout.includes("\\tmp"));
    });

    it("collects streaming output via callbacks", async () => {
      const chunks = [];
      const result = await exec("echo", ["chunk1 chunk2"], {
        onStdout: (chunk) => chunks.push(chunk),
      });

      assert.equal(result.success, true);
      assert.ok(chunks.length >= 1);
    });

    it("truncates output exceeding maxOutputBytes", async () => {
      // Generate output larger than limit
      const result = await exec("node", ["-e", "console.log('x'.repeat(1000))"], {
        maxOutputBytes: 100,
      });

      assert.equal(result.truncated, true);
      assert.ok(result.stdout.length <= 100);
    });

    it("respects AbortSignal", async () => {
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await exec("sleep", ["10"], { signal: controller.signal });

      assert.equal(result.success, false);
      assert.ok(result.error?.includes("abort"));
    });

    it("writes to stdin when provided", async () => {
      const result = await exec("cat", [], { stdin: "stdin input" });

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes("stdin input"));
    });
  });

  describe("execShell", () => {
    it("executes shell command string", async () => {
      const result = await execShell("echo hello && echo world");

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes("hello"));
      assert.ok(result.stdout.includes("world"));
    });

    it("handles pipes", async () => {
      const result = await execShell("echo 'line1\nline2\nline3' | wc -l");

      assert.equal(result.success, true);
      assert.ok(result.stdout.includes("3"));
    });
  });

  describe("execSimple", () => {
    it("returns stdout on success", async () => {
      const output = await execSimple("echo", ["simple output"]);

      assert.ok(output.includes("simple output"));
    });

    it("throws on failure", async () => {
      await assert.rejects(
        () => execSimple("ls", ["nonexistent_file_xyz_123"]),
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(typeof err.exitCode === "number");
          return true;
        }
      );
    });
  });

  describe("commandExists", () => {
    it("returns true for existing commands", async () => {
      const exists = await commandExists("echo");
      assert.equal(exists, true);
    });

    it("returns false for non-existing commands", async () => {
      const exists = await commandExists("nonexistent_command_xyz_123");
      assert.equal(exists, false);
    });

    it("returns true for node", async () => {
      const exists = await commandExists("node");
      assert.equal(exists, true);
    });
  });

  describe("error handling", () => {
    it("handles spawn errors gracefully", async () => {
      const result = await exec("/nonexistent/binary/xyz", []);

      assert.equal(result.success, false);
      assert.ok(result.error?.length > 0);
    });
  });
});
