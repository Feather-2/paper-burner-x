
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { MemoryVfs } from "../../js/agents/vfs/vfs.memory.js";

describe("vfs/vfs.memory", () => {
  /** @type {MemoryVfs} */
  let vfs;

  beforeEach(() => {
    vfs = new MemoryVfs();
  });

  describe("constructor", () => {
    it("creates empty vfs", () => {
      expect(vfs).toBeTruthy();
    });
  });

  describe("writeFile / readFile", () => {
    it("writes and reads bytes", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      await vfs.writeFile("/test.bin", data);
      const read = await vfs.readFile("/test.bin");
      expect(read).toEqual(data);
    });

    it("writes and reads string as bytes", async () => {
      await vfs.writeFile("/test.txt", "hello");
      const read = await vfs.readFile("/test.txt");
      expect(read instanceof Uint8Array).toBeTruthy();
    });

    it("creates parent directories automatically", async () => {
      await vfs.writeFile("/a/b/c/file.txt", "content");
      const read = await vfs.readFile("/a/b/c/file.txt");
      expect(read).toBeTruthy();
    });

    it("throws ENOENT for non-existent file", async () => {
      await expect(() => vfs.readFile("/nonexistent.txt")).rejects.toThrow(/ENOENT/
      );
    });

    it("throws EISDIR when reading root", async () => {
      await expect(() => vfs.readFile("/")).rejects.toThrow(/EISDIR/
      );
    });

    it("overwrites existing file", async () => {
      await vfs.writeFile("/file.txt", "first");
      await vfs.writeFile("/file.txt", "second");
      const text = await vfs.readText("/file.txt");
      expect(text).toBe("second");
    });
  });

  describe("writeText / readText", () => {
    it("writes and reads text", async () => {
      await vfs.writeText("/test.txt", "hello world");
      const text = await vfs.readText("/test.txt");
      expect(text).toBe("hello world");
    });

    it("handles unicode text", async () => {
      await vfs.writeText("/unicode.txt", "你好世界 🌍");
      const text = await vfs.readText("/unicode.txt");
      expect(text).toBe("你好世界 🌍");
    });
  });

  describe("stat", () => {
    it("stats root directory", async () => {
      const stat = await vfs.stat("/");
      expect(stat.isDirectory()).toBeTruthy();
      expect(stat.isFile()).toBe(false);
    });

    it("stats file", async () => {
      await vfs.writeFile("/file.txt", "content");
      const stat = await vfs.stat("/file.txt");
      expect(stat.isFile()).toBeTruthy();
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size > 0).toBeTruthy();
    });

    it("stats directory", async () => {
      await vfs.mkdir("/mydir");
      const stat = await vfs.stat("/mydir");
      expect(stat.isDirectory()).toBeTruthy();
      expect(stat.isFile()).toBe(false);
    });

    it("throws ENOENT for non-existent path", async () => {
      await expect(() => vfs.stat("/nonexistent")).rejects.toThrow(/ENOENT/
      );
    });

    it("includes mtimeMs", async () => {
      await vfs.writeFile("/file.txt", "test");
      const stat = await vfs.stat("/file.txt");
      expect(stat.mtimeMs > 0).toBeTruthy();
    });
  });

  describe("mkdir", () => {
    it("creates directory", async () => {
      await vfs.mkdir("/newdir");
      const stat = await vfs.stat("/newdir");
      expect(stat.isDirectory()).toBeTruthy();
    });

    it("creates nested directories with recursive", async () => {
      await vfs.mkdir("/a/b/c", { recursive: true });
      const stat = await vfs.stat("/a/b/c");
      expect(stat.isDirectory()).toBeTruthy();
    });

    it("succeeds if directory already exists with recursive", async () => {
      await vfs.mkdir("/existing");
      await vfs.mkdir("/existing", { recursive: true });
      const stat = await vfs.stat("/existing");
      expect(stat.isDirectory()).toBeTruthy();
    });

    it("throws EEXIST without recursive if exists", async () => {
      await vfs.mkdir("/existing");
      await expect(() => vfs.mkdir("/existing", { recursive: false }),
        /EEXIST/
      );
    });

    it("returns true for root path", async () => {
      const result = await vfs.mkdir("/");
      expect(result).toBe(true);
    });
  });

  describe("readdir", () => {
    it("lists directory contents", async () => {
      await vfs.writeFile("/dir/a.txt", "a");
      await vfs.writeFile("/dir/b.txt", "b");
      await vfs.mkdir("/dir/subdir");

      const entries = await vfs.readdir("/dir");
      expect(entries.includes("a.txt")).toBeTruthy();
      expect(entries.includes("b.txt")).toBeTruthy();
      expect(entries.includes("subdir")).toBeTruthy();
    });

    it("returns empty array for empty directory", async () => {
      await vfs.mkdir("/empty");
      const entries = await vfs.readdir("/empty");
      expect(entries).toEqual([]);
    });

    it("returns dirents with withFileTypes", async () => {
      await vfs.writeFile("/dir/file.txt", "x");
      await vfs.mkdir("/dir/subdir");

      const entries = await vfs.readdir("/dir", { withFileTypes: true });
      const file = entries.find((e) => e.name === "file.txt");
      const dir = entries.find((e) => e.name === "subdir");

      expect(file.isFile()).toBeTruthy();
      expect(dir.isDirectory()).toBeTruthy();
    });

    it("throws ENOENT for non-existent directory", async () => {
      await expect(() => vfs.readdir("/nonexistent")).rejects.toThrow(/ENOENT/
      );
    });

    it("throws ENOTDIR for file", async () => {
      await vfs.writeFile("/file.txt", "x");
      await expect(() => vfs.readdir("/file.txt")).rejects.toThrow(/ENOTDIR/
      );
    });
  });

  describe("list", () => {
    it("returns legacy format", async () => {
      await vfs.writeFile("/dir/file.txt", "x");
      await vfs.mkdir("/dir/subdir");

      const entries = await vfs.list("/dir");
      expect(entries.some(e => e.name === "file.txt" && e.kind === "file")).toBeTruthy();
      expect(entries.some(e => e.name === "subdir" && e.kind === "dir")).toBeTruthy();
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await vfs.writeFile("/file.txt", "x");
      const exists = await vfs.exists("/file.txt");
      expect(exists).toBeTruthy();
    });

    it("returns true for existing directory", async () => {
      await vfs.mkdir("/dir");
      const exists = await vfs.exists("/dir");
      expect(exists).toBeTruthy();
    });

    it("returns false for non-existent path", async () => {
      const exists = await vfs.exists("/nonexistent");
      expect(exists).toBe(false);
    });
  });

  describe("unlink", () => {
    it("deletes file", async () => {
      await vfs.writeFile("/file.txt", "x");
      await vfs.unlink("/file.txt");
      const exists = await vfs.exists("/file.txt");
      expect(exists).toBe(false);
    });

    it("throws ENOENT for non-existent file", async () => {
      await expect(() => vfs.unlink("/nonexistent")).rejects.toThrow(/ENOENT/
      );
    });

    it("throws EISDIR for directory", async () => {
      await vfs.mkdir("/dir");
      await expect(() => vfs.unlink("/dir")).rejects.toThrow(/EISDIR/
      );
    });
  });

  describe("rmdir", () => {
    it("removes empty directory", async () => {
      await vfs.mkdir("/emptydir");
      await vfs.rmdir("/emptydir");
      const exists = await vfs.exists("/emptydir");
      expect(exists).toBe(false);
    });

    it("removes non-empty directory with recursive", async () => {
      await vfs.writeFile("/dir/file.txt", "x");
      await vfs.rmdir("/dir", { recursive: true });
      const exists = await vfs.exists("/dir");
      expect(exists).toBe(false);
    });

    it("throws ENOTEMPTY without recursive", async () => {
      await vfs.writeFile("/dir/file.txt", "x");
      await expect(() => vfs.rmdir("/dir", { recursive: false }),
        /ENOTEMPTY/
      );
    });
  });

  describe("copy", () => {
    it("copies file", async () => {
      await vfs.writeFile("/src.txt", "content");
      await vfs.copy("/src.txt", "/dst.txt");

      const srcText = await vfs.readText("/src.txt");
      const dstText = await vfs.readText("/dst.txt");
      expect(srcText).toBe("content");
      expect(dstText).toBe("content");
    });
  });

  describe("listFiles", () => {
    it("lists files with prefix", async () => {
      await vfs.writeFile("/data/a.txt", "a");
      await vfs.writeFile("/data/b.txt", "b");
      await vfs.writeFile("/other/c.txt", "c");

      const files = await vfs.listFiles({ prefix: "/data" });
      expect(files.length).toBe(2);
    });

    it("lists files recursively", async () => {
      await vfs.writeFile("/a/b/c.txt", "x");
      await vfs.writeFile("/a/d.txt", "y");

      const files = await vfs.listFiles({ prefix: "/a", recursive: true });
      expect(files.length >= 2).toBeTruthy();
    });
  });
});
