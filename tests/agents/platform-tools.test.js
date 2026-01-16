import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  createPlatformTools,
  getPlatformType,
  hasCapability,
  isNodeLike,
} from "../../js/agents/runtime/tools/platform/index.js";

describe("runtime/tools/platform", () => {
  describe("platform detection", () => {
    it("getPlatformType returns valid type", () => {
      const type = getPlatformType();
      assert.ok(["browser", "node", "bun", "deno", "unknown"].includes(type));
    });

    it("isNodeLike returns true in Node environment", () => {
      assert.equal(isNodeLike(), true);
    });
  });

  describe("hasCapability", () => {
    it("bash is available in Node environment", () => {
      assert.equal(hasCapability("bash"), true);
    });

    it("python is always available", () => {
      assert.equal(hasCapability("python"), true);
    });

    it("js_sandbox is always available", () => {
      assert.equal(hasCapability("js_sandbox"), true);
    });

    it("unknown capability returns false", () => {
      assert.equal(hasCapability("unknown_capability"), false);
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

      assert.equal(typeof tools.glob, "function");
      assert.equal(typeof tools.grep, "function");
      assert.equal(typeof tools.read, "function");
      assert.equal(typeof tools.write, "function");
      assert.equal(typeof tools.list, "function");
      assert.equal(typeof tools.bash, "function");
      assert.ok(["node", "bun", "deno"].includes(tools.platform));
    });

    it("glob finds files matching pattern", async () => {
      await fs.writeFile(path.join(testDir, "foo.js"), "");
      await fs.writeFile(path.join(testDir, "bar.js"), "");
      await fs.writeFile(path.join(testDir, "baz.txt"), "");

      const tools = await createPlatformTools({ basePath: testDir });
      const { files } = await tools.glob({ pattern: "*.js" });

      assert.equal(files.length, 2);
      assert.ok(files.some((f) => f.includes("foo.js")));
      assert.ok(files.some((f) => f.includes("bar.js")));
    });

    it("grep finds matches in files", async () => {
      await fs.writeFile(path.join(testDir, "test.txt"), "hello world\nfoo bar\nhello again");

      const tools = await createPlatformTools({ basePath: testDir });
      const { matches } = await tools.grep({ pattern: "hello", path: testDir });

      assert.ok(matches.length >= 1);
    });

    it("read returns file content", async () => {
      const content = "test content here";
      await fs.writeFile(path.join(testDir, "readme.txt"), content);

      const tools = await createPlatformTools({ basePath: testDir });
      const result = await tools.read({ path: path.join(testDir, "readme.txt") });

      assert.equal(result.content, content);
    });

    it("write creates file with content", async () => {
      const tools = await createPlatformTools({ basePath: testDir });
      const filePath = path.join(testDir, "output.txt");

      const result = await tools.write({ path: filePath, content: "written content" });

      assert.equal(result.success, true);
      const actual = await fs.readFile(filePath, "utf8");
      assert.equal(actual, "written content");
    });

    it("list returns directory entries", async () => {
      await fs.writeFile(path.join(testDir, "file1.txt"), "");
      await fs.mkdir(path.join(testDir, "subdir"));

      const tools = await createPlatformTools({ basePath: testDir });
      const { entries } = await tools.list({ path: testDir });

      assert.ok(entries.includes("file1.txt"));
      assert.ok(entries.includes("subdir"));
    });

    it("bash executes commands", async () => {
      const tools = await createPlatformTools({ basePath: testDir });
      const result = await tools.bash({ command: "echo hello" });

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("hello"));
    });

    it("bash respects timeout", async () => {
      const tools = await createPlatformTools({ basePath: testDir });
      const result = await tools.bash({ command: "sleep 10", timeout: 100 });

      assert.equal(result.exitCode, -1);
      assert.ok(result.error?.includes("timeout") || result.stderr?.length >= 0);
    });
  });
});
