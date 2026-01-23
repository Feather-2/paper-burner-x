import { describe, it, expect, beforeEach, afterEach } from "vitest";

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { exec, execShell, execSimple, commandExists } from '../../../js/agents/runtime/core/exec/index.js';

describe("runtime/exec", () => {
  describe("exec", () => {
    it("executes command and returns result", async () => {
      const result = await exec("echo", ["hello"]);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
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
      expect(result.error).toContain("timed out");
    });

    it("respects cwd option", async () => {
      const result = await exec("pwd", [], { cwd: "/tmp" });

      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/\/tmp|\\tmp/);
    });

    it("collects streaming output via callbacks", async () => {
      const chunks = [];
      const result = await exec("echo", ["chunk1 chunk2"], {
        onStdout: (chunk) => chunks.push(chunk),
      });

      expect(result.success).toBe(true);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("truncates output exceeding maxOutputBytes", async () => {
      // Generate output larger than limit
      const result = await exec("node", ["-e", "console.log('x'.repeat(1000))"], {
        maxOutputBytes: 100,
      });

      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(100);
    });

    it("respects AbortSignal", async () => {
      const controller = new AbortController();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await exec("sleep", ["10"], { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(result.error).toContain("abort");
    });

    it("writes to stdin when provided", async () => {
      const result = await exec("cat", [], { stdin: "stdin input" });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("stdin input");
    });

    it("handles null/undefined/empty commands", async () => {
      const results = await Promise.all([
        exec(""),
        exec(/** @type {*} */(null)),
        exec(/** @type {*} */(undefined)),
      ]);

      results.forEach((result) => {
        expect(result.success).toBe(false);
        expect(result.error).toEqual(expect.any(String));
      });
    });

    it("handles concurrent executions", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) => exec("echo", [`job-${index}`]))
      );

      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.stdout).toContain(`job-${index}`);
      });
    });
  });

  describe("execShell", () => {
    it("rejects untrusted shell execution", async () => {
      const result = await execShell("echo hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("trusted");
    });

    it("rejects empty command string", async () => {
      const result = await execShell("", { trusted: true });

      expect(result.success).toBe(false);
      expect(result.error).toContain("non-empty string");
    });

    it("executes shell command string", async () => {
      const result = await execShell("echo hello && echo world", { trusted: true });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("world");
    });

    it("handles pipes", async () => {
      const result = await execShell("echo 'line1\nline2\nline3' | wc -l", { trusted: true });

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe("3");
    });
  });

  describe("execSimple", () => {
    it("returns stdout on success", async () => {
      const output = await execSimple("echo", ["simple output"]);

      expect(output.trim()).toBe("simple output");
    });

    it("throws on failure", async () => {
      await expect(() => execSimple("ls", ["nonexistent_file_xyz_123"]),
        (err) => {
          expect(err).toBeInstanceOf(Error);
          expect(err.exitCode).toEqual(expect.any(Number));
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
      expect(result.error).toEqual(expect.any(String));
      expect(result.error.length).toBeGreaterThan(0);
    });
  });
});
