import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
    expect(normalizeVfsPath("")).toBe("");
    expect(normalizeVfsPath(".")).toBe("");
    expect(normalizeVfsPath("./")).toBe("");
    expect(normalizeVfsPath("/a/b/")).toBe("a/b");
    expect(normalizeVfsPath("\\a\\b\\c.txt")).toBe("a/b/c.txt");
    expect(normalizeVfsPath("a//b/./c")).toBe("a/b/c");
  });

  it("rejects traversal and invalid segments", () => {
    expect(() => normalizeVfsPath("../x")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("a/../b")).toThrow(/traversal/i);
    expect(() => normalizeVfsPath("C:/Windows/System32")).toThrow(/absolute path/i);
    expect(() => normalizeVfsPath("CON")).toThrow(/reserved name/i);
    expect(() => normalizeVfsPath("a/<b>")).toThrow(/segment/i);
  });

  it("provides dirname/basename/join helpers", () => {
    expect(dirnameVfsPath("a/b/c.txt")).toBe("a/b");
    expect(dirnameVfsPath("a")).toBe("");
    expect(basenameVfsPath("a/b/c.txt")).toBe("c.txt");
    expect(basenameVfsPath("a")).toBe("a");
    expect(joinVfsPath("", "a")).toBe("a");
    expect(joinVfsPath("a", "")).toBe("a");
    expect(joinVfsPath("a", "b/c.txt")).toBe("a/b/c.txt");
  });
});

describe("vfs/memory", () => {
  it("reads/writes and lists files", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("a/b.txt", "hello");
    await vfs.writeText("a/c.txt", "world");
    expect(await vfs.readText("a/b.txt")).toBe("hello");

    const names = await vfs.readdir("a");
    expect(names).toEqual(["b.txt", "c.txt"]);

    const files = await vfs.listFiles({ prefix: "a" });
    expect(files).toEqual(["a/b.txt", "a/c.txt"]);

    await vfs.copy("a/b.txt", "a/b2.txt");
    expect(await vfs.readText("a/b2.txt")).toBe("hello");

    await vfs.appendText("a/b.txt", "!");
    expect(await vfs.readText("a/b.txt")).toBe("hello!");

    await vfs.move("a/c.txt", "a/moved.txt");
    expect(await vfs.exists("a/c.txt")).toBe(false);
    expect(await vfs.readText("a/moved.txt")).toBe("world");
  });
});

describe("vfs/nodefs + createVfs", () => {
  it("creates a nodefs VFS and performs basic operations", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-vfs-"));
    try {
      const vfs = await createVfs({ kind: "nodefs", rootPath: tmp });
      await vfs.writeText("dir/file.txt", "node");
      expect(await vfs.readText("dir/file.txt")).toBe("node");

      const st = await vfs.stat("dir/file.txt");
      expect(st.isFile()).toBe(true);
      expect(st.isDirectory()).toBe(false);
      expect(st.size).toBeGreaterThan(0);

      const files = await vfs.listFiles({ prefix: "dir" });
      expect(files).toEqual(["dir/file.txt"]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("defaults to MemoryVfs in node", async () => {
    const vfs = await createVfs();
    expect(vfs).toBeInstanceOf(MemoryVfs);
  });
});

describe("vfs/glob", () => {
  it("expands braces and matches patterns", () => {
    expect(expandBraces("*.{md,txt}").sort()).toEqual(["*.md", "*.txt"]);
    expect(matchGlob("*.md", "a.md")).toBe(true);
    expect(matchGlob("*.md", "a.txt")).toBe(false);
    expect(matchGlob("**/*.md", "dir/a.md")).toBe(true);
    expect(matchGlob("**/*.md", "dir/a.txt")).toBe(false);

    const re = globToRegExp("a/**/b?.txt");
    expect(re.test("a/b1.txt")).toBe(true);
    expect(re.test("a/x/y/b2.txt")).toBe(true);
    expect(re.test("a/x/y/b.txt")).toBe(false);
  });

  it("creates a glob function over a VFS", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("a.md", "a");
    await vfs.writeText("b.txt", "b");
    await vfs.writeText("dir/c.md", "c");
    await vfs.writeText("dir/d.js", "d");

    const globFn = createVfsGlobFn(vfs, { maxScanFiles: 10 });
    expect(typeof globFn).toBe("function");

    const out = await globFn({ pattern: "**/*.md", path: "" });
    expect(out).toEqual(["a.md", "dir/c.md"]);
  });
});
