import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { NodeFsVfs } from "../../js/agents/vfs/vfs.node.js";

describe("NodeFsVfs", () => {
  /** @type {string} */
  let tmpDir;
  /** @type {NodeFsVfs} */
  let vfs;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vfs-node-test-"));
    vfs = new NodeFsVfs({ rootPath: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("readFile / readText", () => {
    it("reads binary file as Uint8Array", async () => {
      await fs.writeFile(path.join(tmpDir, "bin.dat"), Buffer.from([0x01, 0x02, 0x03]));
      const data = await vfs.readFile("bin.dat");
      assert.ok(data instanceof Uint8Array);
      assert.deepEqual([...data], [0x01, 0x02, 0x03]);
    });

    it("reads text file as string", async () => {
      await fs.writeFile(path.join(tmpDir, "text.txt"), "hello world", "utf8");
      const text = await vfs.readText("text.txt");
      assert.equal(text, "hello world");
    });

    it("reads file in nested directory", async () => {
      await fs.mkdir(path.join(tmpDir, "a", "b"), { recursive: true });
      await fs.writeFile(path.join(tmpDir, "a", "b", "nested.txt"), "nested", "utf8");
      assert.equal(await vfs.readText("a/b/nested.txt"), "nested");
    });

    it("throws on non-existent file", async () => {
      await assert.rejects(() => vfs.readFile("nonexistent.txt"), /ENOENT/);
    });
  });

  describe("writeFile", () => {
    it("writes string data", async () => {
      await vfs.writeFile("str.txt", "string content");
      const content = await fs.readFile(path.join(tmpDir, "str.txt"), "utf8");
      assert.equal(content, "string content");
    });

    it("writes ArrayBuffer data", async () => {
      const ab = new ArrayBuffer(3);
      new Uint8Array(ab).set([0x0a, 0x0b, 0x0c]);
      await vfs.writeFile("ab.bin", ab);
      const buf = await fs.readFile(path.join(tmpDir, "ab.bin"));
      assert.deepEqual([...buf], [0x0a, 0x0b, 0x0c]);
    });

    it("writes Uint8Array data", async () => {
      const u8 = new Uint8Array([0x10, 0x20, 0x30]);
      await vfs.writeFile("u8.bin", u8);
      const buf = await fs.readFile(path.join(tmpDir, "u8.bin"));
      assert.deepEqual([...buf], [0x10, 0x20, 0x30]);
    });

    it("writes typed array with offset", async () => {
      const ab = new ArrayBuffer(6);
      new Uint8Array(ab).set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
      const view = new Uint8Array(ab, 2, 3);
      await vfs.writeFile("offset.bin", view);
      const buf = await fs.readFile(path.join(tmpDir, "offset.bin"));
      assert.deepEqual([...buf], [0x02, 0x03, 0x04]);
    });

    it("writes null/undefined as empty string", async () => {
      await vfs.writeFile("null.txt", null);
      const content = await fs.readFile(path.join(tmpDir, "null.txt"), "utf8");
      assert.equal(content, "");
    });

    it("writes number as string", async () => {
      await vfs.writeFile("num.txt", 12345);
      const content = await fs.readFile(path.join(tmpDir, "num.txt"), "utf8");
      assert.equal(content, "12345");
    });

    it("creates parent directories automatically", async () => {
      await vfs.writeFile("deep/nested/dir/file.txt", "deep");
      const content = await fs.readFile(path.join(tmpDir, "deep/nested/dir/file.txt"), "utf8");
      assert.equal(content, "deep");
    });

    it("returns true on success", async () => {
      const result = await vfs.writeFile("result.txt", "ok");
      assert.equal(result, true);
    });
  });

  describe("writeText", () => {
    it("writes text content", async () => {
      await vfs.writeText("wt.txt", "text via writeText");
      assert.equal(await vfs.readText("wt.txt"), "text via writeText");
    });

    it("converts non-string to string", async () => {
      await vfs.writeText("num.txt", 42);
      assert.equal(await vfs.readText("num.txt"), "42");
    });

    it("handles null/undefined", async () => {
      await vfs.writeText("empty.txt", undefined);
      assert.equal(await vfs.readText("empty.txt"), "");
    });
  });

  describe("stat", () => {
    it("returns file stat info", async () => {
      await vfs.writeText("stat.txt", "stat test");
      const st = await vfs.stat("stat.txt");
      assert.equal(st.isFile(), true);
      assert.equal(st.isDirectory(), false);
      assert.ok(st.size > 0);
      assert.ok(st.mtimeMs > 0);
    });

    it("returns directory stat info", async () => {
      await vfs.writeText("subdir/file.txt", "x");
      const st = await vfs.stat("subdir");
      assert.equal(st.isFile(), false);
      assert.equal(st.isDirectory(), true);
    });

    it("throws on non-existent path", async () => {
      await assert.rejects(() => vfs.stat("missing"), /ENOENT/);
    });
  });

  describe("readdir", () => {
    beforeEach(async () => {
      await vfs.writeText("dir/a.txt", "a");
      await vfs.writeText("dir/b.txt", "b");
      await vfs.writeText("dir/sub/c.txt", "c");
    });

    it("returns file names without withFileTypes", async () => {
      const entries = await vfs.readdir("dir");
      assert.ok(Array.isArray(entries));
      const names = entries.map((e) => (typeof e === "string" ? e : e.name)).sort();
      assert.ok(names.includes("a.txt"));
      assert.ok(names.includes("b.txt"));
      assert.ok(names.includes("sub"));
    });

    it("returns dirent objects with withFileTypes", async () => {
      const entries = await vfs.readdir("dir", { withFileTypes: true });
      assert.ok(Array.isArray(entries));
      const fileEntry = entries.find((e) => e.name === "a.txt");
      assert.ok(fileEntry);
      assert.equal(typeof fileEntry.isDirectory, "function");
      assert.equal(fileEntry.isDirectory(), false);
      const dirEntry = entries.find((e) => e.name === "sub");
      assert.ok(dirEntry);
      assert.equal(dirEntry.isDirectory(), true);
    });
  });

  describe("list (legacy)", () => {
    it("returns array of {name, kind} objects", async () => {
      await vfs.writeText("legacy/file.txt", "f");
      await vfs.writeText("legacy/subdir/nested.txt", "n");
      const items = await vfs.list("legacy");
      assert.ok(Array.isArray(items));
      const file = items.find((i) => i.name === "file.txt");
      assert.ok(file);
      assert.equal(file.kind, "file");
      const dir = items.find((i) => i.name === "subdir");
      assert.ok(dir);
      assert.equal(dir.kind, "dir");
    });

    it("handles empty/invalid entries gracefully", async () => {
      await vfs.writeText("empty/x.txt", "x");
      const items = await vfs.list("empty");
      assert.ok(items.length >= 1);
    });
  });

  describe("listFiles", () => {
    beforeEach(async () => {
      await vfs.writeText("lf/a.txt", "a");
      await vfs.writeText("lf/b.txt", "b");
      await vfs.writeText("lf/sub/c.txt", "c");
      await vfs.writeText("lf/sub/deep/d.txt", "d");
      await fs.writeFile(path.join(tmpDir, "lf", ".hidden"), "hidden");
    });

    it("lists files recursively by default", async () => {
      const files = await vfs.listFiles({ prefix: "lf" });
      assert.ok(files.includes("lf/a.txt"));
      assert.ok(files.includes("lf/b.txt"));
      assert.ok(files.includes("lf/sub/c.txt"));
      assert.ok(files.includes("lf/sub/deep/d.txt"));
    });

    it("excludes hidden files", async () => {
      const files = await vfs.listFiles({ prefix: "lf" });
      assert.ok(!files.some((f) => f.includes(".hidden")));
    });

    it("returns sorted list", async () => {
      const files = await vfs.listFiles({ prefix: "lf" });
      const sorted = [...files].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(files, sorted);
    });

    it("lists files non-recursively", async () => {
      const files = await vfs.listFiles({ prefix: "lf", recursive: false });
      assert.ok(files.includes("lf/a.txt"));
      assert.ok(files.includes("lf/b.txt"));
      assert.ok(!files.includes("lf/sub/c.txt"));
    });

    it("lists from root with empty prefix", async () => {
      const files = await vfs.listFiles({});
      assert.ok(files.length >= 4);
    });
  });

  describe("walkFiles", () => {
    beforeEach(async () => {
      await vfs.writeText("walk/x.txt", "x");
      await vfs.writeText("walk/y.txt", "y");
      await vfs.writeText("walk/sub/z.txt", "z");
      await fs.writeFile(path.join(tmpDir, "walk", ".dotfile"), "dot");
    });

    it("yields files recursively", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "walk" })) {
        files.push(f);
      }
      assert.ok(files.includes("walk/x.txt"));
      assert.ok(files.includes("walk/y.txt"));
      assert.ok(files.includes("walk/sub/z.txt"));
    });

    it("excludes hidden files", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "walk" })) {
        files.push(f);
      }
      assert.ok(!files.some((f) => f.includes(".dotfile")));
    });

    it("yields files non-recursively", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "walk", recursive: false })) {
        files.push(f);
      }
      assert.ok(files.includes("walk/x.txt"));
      assert.ok(files.includes("walk/y.txt"));
      assert.ok(!files.includes("walk/sub/z.txt"));
    });

    it("yields single file when prefix is a file", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "walk/x.txt" })) {
        files.push(f);
      }
      assert.deepEqual(files, ["walk/x.txt"]);
    });

    it("yields nothing for non-existent path", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "nonexistent" })) {
        files.push(f);
      }
      assert.deepEqual(files, []);
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      const files = [];
      try {
        for await (const f of vfs.walkFiles({ prefix: "walk", signal: controller.signal })) {
          files.push(f);
          controller.abort();
        }
      } catch (err) {
        assert.ok(err.message.includes("aborted"));
      }
      assert.ok(files.length >= 1);
    });

    it("yields files in sorted order", async () => {
      const files = [];
      for await (const f of vfs.walkFiles({ prefix: "walk" })) {
        files.push(f);
      }
      const sorted = [...files].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(files, sorted);
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await vfs.writeText("exists.txt", "yes");
      assert.equal(await vfs.exists("exists.txt"), true);
    });

    it("returns true for existing directory", async () => {
      await vfs.writeText("existsdir/file.txt", "x");
      assert.equal(await vfs.exists("existsdir"), true);
    });

    it("returns false for non-existent path", async () => {
      assert.equal(await vfs.exists("nope.txt"), false);
    });
  });

  describe("copy", () => {
    it("copies file to new location", async () => {
      await vfs.writeText("src.txt", "source");
      const result = await vfs.copy("src.txt", "dest.txt");
      assert.equal(result, true);
      assert.equal(await vfs.readText("dest.txt"), "source");
      assert.equal(await vfs.exists("src.txt"), true);
    });

    it("creates parent directories for destination", async () => {
      await vfs.writeText("copy/src.txt", "copy source");
      await vfs.copy("copy/src.txt", "copy/deep/nested/dest.txt");
      assert.equal(await vfs.readText("copy/deep/nested/dest.txt"), "copy source");
    });

    it("throws on non-existent source", async () => {
      await assert.rejects(() => vfs.copy("missing.txt", "dest.txt"), /ENOENT/);
    });
  });

  describe("move", () => {
    it("moves file to new location", async () => {
      await vfs.writeText("mv_src.txt", "move me");
      const result = await vfs.move("mv_src.txt", "mv_dest.txt");
      assert.equal(result, true);
      assert.equal(await vfs.readText("mv_dest.txt"), "move me");
      assert.equal(await vfs.exists("mv_src.txt"), false);
    });

    it("creates parent directories for destination", async () => {
      await vfs.writeText("move/src.txt", "move source");
      await vfs.move("move/src.txt", "move/new/path/dest.txt");
      assert.equal(await vfs.readText("move/new/path/dest.txt"), "move source");
    });

    it("throws on non-existent source", async () => {
      await assert.rejects(() => vfs.move("missing.txt", "dest.txt"), /ENOENT/);
    });

    it("handles EXDEV by copy+unlink fallback", async () => {
      await vfs.writeText("exdev_src.txt", "cross device");
      const origFs = vfs._fs.bind(vfs);
      let renameCallCount = 0;
      vfs._fs = async () => {
        const realFs = await origFs();
        return {
          ...realFs,
          mkdir: realFs.mkdir,
          copyFile: realFs.copyFile,
          unlink: realFs.unlink,
          rename: async () => {
            renameCallCount++;
            const err = new Error("EXDEV: cross-device link not permitted");
            err.code = "EXDEV";
            throw err;
          },
        };
      };
      const result = await vfs.move("exdev_src.txt", "exdev_dest.txt");
      assert.equal(result, true);
      assert.equal(renameCallCount, 1);
      vfs._fs = origFs;
      assert.equal(await vfs.readText("exdev_dest.txt"), "cross device");
      assert.equal(await vfs.exists("exdev_src.txt"), false);
    });

    it("rethrows non-EXDEV errors from rename", async () => {
      await vfs.writeText("rethrow_src.txt", "rethrow");
      const origFs = vfs._fs.bind(vfs);
      vfs._fs = async () => {
        const realFs = await origFs();
        return {
          ...realFs,
          mkdir: realFs.mkdir,
          rename: async () => {
            const err = new Error("EACCES: permission denied");
            err.code = "EACCES";
            throw err;
          },
        };
      };
      await assert.rejects(() => vfs.move("rethrow_src.txt", "rethrow_dest.txt"), /EACCES/);
      vfs._fs = origFs;
    });
  });

  describe("appendText", () => {
    it("appends to existing file", async () => {
      await vfs.writeText("append.txt", "hello");
      await vfs.appendText("append.txt", " world");
      assert.equal(await vfs.readText("append.txt"), "hello world");
    });

    it("creates file if not exists", async () => {
      await vfs.appendText("newappend.txt", "first");
      assert.equal(await vfs.readText("newappend.txt"), "first");
    });

    it("creates parent directories", async () => {
      await vfs.appendText("deep/append/file.txt", "appended");
      assert.equal(await vfs.readText("deep/append/file.txt"), "appended");
    });

    it("converts non-string to string", async () => {
      await vfs.appendText("numappend.txt", 123);
      assert.equal(await vfs.readText("numappend.txt"), "123");
    });

    it("handles null/undefined", async () => {
      await vfs.appendText("nullappend.txt", null);
      assert.equal(await vfs.readText("nullappend.txt"), "");
    });

    it("returns true on success", async () => {
      const result = await vfs.appendText("ok.txt", "ok");
      assert.equal(result, true);
    });
  });

  describe("constructor defaults", () => {
    it("defaults rootPath to current directory", async () => {
      const defaultVfs = new NodeFsVfs();
      assert.equal(defaultVfs._rootPath, ".");
    });
  });

  describe("path normalization", () => {
    it("handles backslash paths", async () => {
      await vfs.writeText("norm\\sub\\file.txt", "normalized");
      assert.equal(await vfs.exists("norm/sub/file.txt"), true);
    });

    it("handles leading slashes", async () => {
      await vfs.writeText("/leading/file.txt", "leading");
      assert.equal(await vfs.exists("leading/file.txt"), true);
    });
  });
});
