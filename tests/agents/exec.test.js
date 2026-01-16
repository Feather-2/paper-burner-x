import { describe, it, expect, beforeEach, afterEach } from "vitest";

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { exec, execShell, execSimple, commandExists } from "../../js/agents/runtime/exec/index.js";

describe("runtime/exec", () => {
  describe("exec", () => {
    it("executes command and returns result", async () => {
      const result = await exec("echo", ["hello"]);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.includes("hello")).toBeTruthy();
      expect(result.timedOut).toBe(false);
    });

    it("captures stderr for failed commands", async () => {
      const result = await exec("ls", ["nonexistent_file_xyz_123"]);

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    it("respects timeout option", async () => {
      const result = await exec("sleep", ["10"], { timeout: 100 });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.error?.includes("timed out")).toBeTruthy();
    });

    it("respects cwd option", async () => {
      const result = await exec("pwd", [], { cwd: "/tmp" });

      expect(result.success).toBe(true);
      expect(result.stdout.includes("/tmp") || result.stdout.includes("\\tmp")).toBeTruthy();
    });

    it("collects streaming output via callbacks", async () => {
      const chunks = [];
      const result = await exec("echo", ["chunk1 chunk2"], {
        onStdout: (chunk) => chunks.push(chunk),
      });

      expect(result.success).toBe(true);
      expect(chunks.length >= 1).toBeTruthy();
    });

    it("truncates output exceeding maxOutputBytes", async () => {
      // Generate output larger than limit
      const result = await exec("node", ["-e", "console.log('x'.repeat(1000))"], {
        maxOutputBytes: 100,
      });

      expect(result.truncated).toBe(true);
      expect(result.stdout.length <= 100).toBeTruthy();
    });

    it("respects AbortSignal", async () => {
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await exec("sleep", ["10"], { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(result.error?.includes("abort")).toBeTruthy();
    });

    it("writes to stdin when provided", async () => {
      const result = await exec("cat", [], { stdin: "stdin input" });

      expect(result.success).toBe(true);
      expect(result.stdout.includes("stdin input")).toBeTruthy();
    });
  });

  describe("execShell", () => {
    it("executes shell command string", async () => {
      const result = await execShell("echo hello && echo world");

      expect(result.success).toBe(true);
      expect(result.stdout.includes("hello")).toBeTruthy();
      expect(result.stdout.includes("world")).toBeTruthy();
    });

    it("handles pipes", async () => {
      const result = await execShell("echo 'line1\nline2\nline3' | wc -l");

      expect(result.success).toBe(true);
      expect(result.stdout.includes("3")).toBeTruthy();
    });
  });

  describe("execSimple", () => {
    it("returns stdout on success", async () => {
      const output = await execSimple("echo", ["simple output"]);

      expect(output.includes("simple output")).toBeTruthy();
    });

    it("throws on failure", async () => {
      await expect(() => execSimple("ls", ["nonexistent_file_xyz_123"]),
        (err) => {
          expect(err instanceof Error).toBeTruthy();
          expect(typeof err.exitCode === "number").toBeTruthy();
          return true;
        }
      );
    });
  });

  describe("commandExists", () => {
    it("returns true for existing commands", async () => {
      const exists = await commandExists("echo");
      expect(exists).toBe(true);
    });

    it("returns false for non-existing commands", async () => {
      const exists = await commandExists("nonexistent_command_xyz_123");
      expect(exists).toBe(false);
    });

    it("returns true for node", async () => {
      const exists = await commandExists("node");
      expect(exists).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles spawn errors gracefully", async () => {
      const result = await exec("/nonexistent/binary/xyz", []);

      expect(result.success).toBe(false);
      expect(result.error?.length > 0).toBeTruthy();
    });
  });
});
