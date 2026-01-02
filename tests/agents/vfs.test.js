import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  basenameVfsPath,
  dirnameVfsPath,
  joinVfsPath,
  normalizeVfsPath,
} from "../../js/agents/vfs/path.js";
import { MemoryVfs } from "../../js/agents/vfs/index.js";
import { createVfs } from "../../js/agents/vfs/index.js";
import { createVfsGlobFn, expandBraces, globToRegExp, matchGlob } from "../../js/agents/vfs/glob.js";

describe("vfs/path", () => {
  it("normalizes to relative POSIX paths", () => {
    assert.equal(normalizeVfsPath(""), "");
    assert.equal(normalizeVfsPath("."), "");
    assert.equal(normalizeVfsPath("./"), "");
    assert.equal(normalizeVfsPath("/a/b/"), "a/b");
    assert.equal(normalizeVfsPath("\\a\\b\\c.txt"), "a/b/c.txt");
    assert.equal(normalizeVfsPath("a//b/./c"), "a/b/c");
  });

  it("rejects traversal and invalid segments", () => {
    assert.throws(() => normalizeVfsPath("../x"), /traversal/i);
    assert.throws(() => normalizeVfsPath("a/../b"), /traversal/i);
    assert.throws(() => normalizeVfsPath("C:/Windows/System32"), /absolute path/i);
    assert.throws(() => normalizeVfsPath("CON"), /reserved name/i);
    assert.throws(() => normalizeVfsPath("a/<b>"), /segment/i);
  });

  it("provides dirname/basename/join helpers", () => {
    assert.equal(dirnameVfsPath("a/b/c.txt"), "a/b");
    assert.equal(dirnameVfsPath("a"), "");
    assert.equal(basenameVfsPath("a/b/c.txt"), "c.txt");
    assert.equal(basenameVfsPath("a"), "a");
    assert.equal(joinVfsPath("", "a"), "a");
    assert.equal(joinVfsPath("a", ""), "a");
    assert.equal(joinVfsPath("a", "b/c.txt"), "a/b/c.txt");
  });
});

describe("vfs/memory", () => {
  it("reads/writes and lists files", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("a/b.txt", "hello");
    await vfs.writeText("a/c.txt", "world");
    assert.equal(await vfs.readText("a/b.txt"), "hello");

    const names = await vfs.readdir("a");
    assert.deepEqual(names, ["b.txt", "c.txt"]);

    const files = await vfs.listFiles({ prefix: "a" });
    assert.deepEqual(files, ["a/b.txt", "a/c.txt"]);

    await vfs.copy("a/b.txt", "a/b2.txt");
    assert.equal(await vfs.readText("a/b2.txt"), "hello");

    await vfs.appendText("a/b.txt", "!");
    assert.equal(await vfs.readText("a/b.txt"), "hello!");

    await vfs.move("a/c.txt", "a/moved.txt");
    assert.equal(await vfs.exists("a/c.txt"), false);
    assert.equal(await vfs.readText("a/moved.txt"), "world");
  });
});

describe("vfs/nodefs + createVfs", () => {
  it("creates a nodefs VFS and performs basic operations", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-vfs-"));
    try {
      const vfs = await createVfs({ kind: "nodefs", rootPath: tmp });
      await vfs.writeText("dir/file.txt", "node");
      assert.equal(await vfs.readText("dir/file.txt"), "node");

      const st = await vfs.stat("dir/file.txt");
      assert.equal(st.isFile(), true);
      assert.equal(st.isDirectory(), false);
      assert.ok(st.size > 0);

      const files = await vfs.listFiles({ prefix: "dir" });
      assert.deepEqual(files, ["dir/file.txt"]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("defaults to MemoryVfs in node", async () => {
    const vfs = await createVfs();
    assert.ok(vfs instanceof MemoryVfs);
  });
});

describe("vfs/glob", () => {
  it("expands braces and matches patterns", () => {
    assert.deepEqual(expandBraces("*.{md,txt}").sort(), ["*.md", "*.txt"]);
    assert.equal(matchGlob("*.md", "a.md"), true);
    assert.equal(matchGlob("*.md", "a.txt"), false);
    assert.equal(matchGlob("**/*.md", "dir/a.md"), true);
    assert.equal(matchGlob("**/*.md", "dir/a.txt"), false);

    const re = globToRegExp("a/**/b?.txt");
    assert.equal(re.test("a/b1.txt"), true);
    assert.equal(re.test("a/x/y/b2.txt"), true);
    assert.equal(re.test("a/x/y/b.txt"), false);
  });

  it("creates a glob function over a VFS", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("a.md", "a");
    await vfs.writeText("b.txt", "b");
    await vfs.writeText("dir/c.md", "c");
    await vfs.writeText("dir/d.js", "d");

    const globFn = createVfsGlobFn(vfs, { maxScanFiles: 10 });
    assert.equal(typeof globFn, "function");

    const out = await globFn({ pattern: "**/*.md", path: "" });
    assert.deepEqual(out, ["a.md", "dir/c.md"]);
  });
});

