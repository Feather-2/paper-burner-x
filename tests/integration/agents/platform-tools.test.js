import { describe, it, expect, beforeEach, afterEach } from "vitest";

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  createPlatformTools,
  getPlatformType,
  hasCapability,
  isNodeLike,
} from '../../../js/agents/runtime/tools/platform/index.js';

describe("runtime/tools/platform", () => {
  describe("platform detection", () => {
    it("getPlatformType returns valid type", () => {
      const type = getPlatformType();
      expect(["browser", "node", "bun", "deno", "unknown"]).toContain(type);
    });

    it("isNodeLike returns true in Node environment", () => {
      expect(isNodeLike()).toBe(true);
    });
  });

  describe("hasCapability", () => {
    it("bash is available in Node environment", () => {
      expect(hasCapability("bash")).toBe(true);
    });

    it("python is always available", () => {
      expect(hasCapability("python")).toBe(true);
    });

    it("js_sandbox is always available", () => {
      expect(hasCapability("js_sandbox")).toBe(true);
    });

    it("unknown capability returns false", () => {
      expect(hasCapability("unknown_capability")).toBe(false);
    });
  });

  describe("createPlatformTools (Node)", () => {
    /** @type {string} */
    let testDir;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), "platform-tools-"));
    });

    afterEach(async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    });

    it("creates tools with all expected methods", async () => {
      const tools = await createPlatformTools({ basePath: testDir });

      expect(typeof tools.glob).toBe("function");
      expect(typeof tools.grep).toBe("function");
      expect(typeof tools.read).toBe("function");
      expect(typeof tools.write).toBe("function");
      expect(typeof tools.list).toBe("function");
      expect(typeof tools.bash).toBe("function");
      expect(["node", "bun", "deno"]).toContain(tools.platform);
    });

    it("glob finds files matching pattern", async () => {
      await fs.writeFile(path.join(testDir, "foo.js"), "");
      await fs.writeFile(path.join(testDir, "bar.js"), "");
      await fs.writeFile(path.join(testDir, "baz.txt"), "");

      const tools = await createPlatformTools({ basePath: testDir });
      const { files } = await tools.glob({ pattern: "*.js" });

      expect(files.length).toBe(2);
      expect(files.some(f => f.includes("foo.js")));
      expect(files.some(f => f.includes("bar.js")));
    });

    it("grep finds matches in files", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "hello world\nfoo bar\nhello again");

      const tools = await createPlatformTools({ basePath: testDir });
      const { matches } = await tools.grep({ pattern: "hello", path: testDir });

      expect(matches.length).toBeGreaterThan(0);
    });

    it("read returns file content", async () => {
      const content = "test content here";
      await fs.writeFile(path.join(testDir, "readme.txt"), content);

      const tools = await createPlatformTools({ basePath: testDir });
      const result = await tools.read({ path: path.join(testDir, "readme.txt") });

      expect(result.content).toBe(content);
    });

    it("write creates file with content", async () => {
      const tools = await createPlatformTools({ basePath: testDir });
      const filePath = path.join(testDir, "output.txt");

      const result = await tools.write({ path: filePath, content: "written content" });

      expect(result.success).toBe(true);
      const actual = await fs.readFile(filePath, "utf8");
      expect(actual).toBe("written content");
    });

    it("list returns directory entries", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "");
      await fs.mkdir(path.join(testDir, "subdir"));

      const tools = await createPlatformTools({ basePath: testDir });
      const { entries } = await tools.list({ path: testDir });

      expect(entries).toContain("file1.txt");
      expect(entries).toContain("subdir");
    });

    it("bash executes commands", async () => {
      const tools = await createPlatformTools({ basePath: testDir });
      const result = await tools.bash({ command: "echo hello" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    });

    it("bash respects timeout", async () => {
      const tools = await createPlatformTools({ basePath: testDir, allowedCommands: ['sleep'] });
      const result = await tools.bash({ command: "sleep 10", timeout: 100 });

      expect(result.exitCode).toBe(-1);
      expect(result.error).toMatch(/timed out/i);
    });
  });
});
