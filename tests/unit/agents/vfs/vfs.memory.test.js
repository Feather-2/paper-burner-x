import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { normalizeVfsPathMock, isPlainObjectMock } = vi.hoisted(() => {
  /** @param {unknown} inputPath */
  const normalizeVfsPathMock = vi.fn((inputPath) => {
    const raw = String(inputPath ?? "").replaceAll("\\", "/").trim();
    if (!raw || raw === "/" || raw === "." || raw === "./") return "";

    let p = raw;
    while (p.startsWith("./")) p = p.slice(2);
    while (p.startsWith("/")) p = p.slice(1);
    p = p.replace(/\/+/g, "/").replace(/\/+$/, "");

    const parts = p.split("/").filter(Boolean);
    if (parts.some((seg) => seg === "..")) throw new Error(`Invalid VFS path traversal: ${raw}`);
    return parts.join("/");
  });

  /** @param {unknown} value */
  const isPlainObjectMock = vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  return { normalizeVfsPathMock, isPlainObjectMock };
});

vi.mock("../../../../js/agents/vfs/path.js", () => ({ normalizeVfsPath: normalizeVfsPathMock }));
vi.mock("../../../../js/agents/shared/index.js", () => ({ isPlainObject: isPlainObjectMock }));

import * as MemoryModule from "../../../../js/agents/vfs/vfs.memory.js";

/** @type {MemoryModule.MemoryVfs} */
let vfs;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  vfs = new MemoryModule.MemoryVfs();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("vfs/vfs.memory exports", () => {
  it("exports MemoryVfs and default (same class reference)", () => {
    expect(MemoryModule.MemoryVfs).toBeTypeOf("function");
    expect(MemoryModule.default).toBe(MemoryModule.MemoryVfs);
    expect(new MemoryModule.MemoryVfs()).toBeInstanceOf(MemoryModule.default);
  });
});

describe("MemoryVfs", () => {
  describe("constructor", () => {
    it("creates an empty, readable root directory", async () => {
      await expect(vfs.readdir("/")).resolves.toEqual([]);
      const st = await vfs.stat("/");
      expect(st.isDirectory()).toBe(true);
      expect(st.isFile()).toBe(false);
      expect(st.size).toBe(0);
      expect(st.mtimeMs).toBe(Date.parse("2020-01-01T00:00:00.000Z"));
    });
  });

  describe("writeFile / readFile / readText", () => {
    it("stores Uint8Array data and readFile returns a copy", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      await expect(vfs.writeFile("/bin.dat", bytes)).resolves.toBe(true);

      const read1 = await vfs.readFile("/bin.dat");
      expect(read1).toEqual(bytes);
      expect(read1).not.toBe(bytes);

      read1[0] = 9;
      const read2 = await vfs.readFile("/bin.dat");
      expect(read2[0]).toBe(1);
    });

    it("converts ArrayBuffer, ArrayBufferView, string, array, and plain object inputs", async () => {
      const ab = new Uint8Array([9, 8, 7]).buffer;
      await vfs.writeFile("ab.bin", ab);
      await expect(vfs.readFile("ab.bin")).resolves.toEqual(new Uint8Array(ab));

      const view = new Uint16Array([0x1234, 0x00ff]);
      const expectedViewBytes = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
      await vfs.writeFile("view.bin", view);
      await expect(vfs.readFile("view.bin")).resolves.toEqual(expectedViewBytes);

      await vfs.writeFile("str.txt", "hello");
      await expect(vfs.readText("str.txt")).resolves.toBe("hello");

      const arr = [1, "two", false];
      await vfs.writeFile("arr.json", arr);
      await expect(vfs.readText("arr.json")).resolves.toBe(JSON.stringify(arr));

      const obj = { a: 1, b: "x" };
      await vfs.writeFile("obj.json", obj);
      await expect(vfs.readText("obj.json")).resolves.toBe(JSON.stringify(obj));

      // Plain-object detection is delegated (mocked), but should be invoked for non-string data.
      expect(isPlainObjectMock).toHaveBeenCalled();
    });

    it("encodes nullish values as empty bytes", async () => {
      await vfs.writeFile("null.bin", null);
      await expect(vfs.readFile("null.bin")).resolves.toEqual(new Uint8Array(0));
      await expect(vfs.readText("null.bin")).resolves.toBe("");

      await vfs.writeFile("undef.bin", undefined);
      await expect(vfs.readFile("undef.bin")).resolves.toEqual(new Uint8Array(0));
      await expect(vfs.readText("undef.bin")).resolves.toBe("");
    });

    it("stringifies non-plain-object values via String(data)", async () => {
      isPlainObjectMock.mockImplementationOnce(() => false);
      await vfs.writeFile("obj.txt", { a: 1 });
      await expect(vfs.readText("obj.txt")).resolves.toBe("[object Object]");

      await vfs.writeFile("num.txt", 42);
      await expect(vfs.readText("num.txt")).resolves.toBe("42");
    });

    it("creates parent directories automatically", async () => {
      await vfs.writeText("/a/b/c/file.txt", "content");
      await expect(vfs.readText("a/b/c/file.txt")).resolves.toBe("content");
      await expect(vfs.readdir("a/b/c")).resolves.toEqual(["file.txt"]);
    });

    it("overwrites an existing file", async () => {
      await vfs.writeText("x.txt", "first");
      await vfs.writeText("x.txt", "second");
      await expect(vfs.readText("x.txt")).resolves.toBe("second");
    });

    it("throws EISDIR when reading or writing the root path", async () => {
      await expect(vfs.readFile("/")).rejects.toThrow(/EISDIR: \//);
      await expect(vfs.writeText("/", "nope")).rejects.toThrow(/EISDIR: \//);
    });

    it("throws ENOENT when reading a missing file", async () => {
      await expect(vfs.readFile("missing.txt")).rejects.toThrow(/ENOENT: missing\.txt/);
    });

    it("throws EISDIR when reading a directory path", async () => {
      await vfs.mkdir("dir");
      await expect(vfs.readFile("dir")).rejects.toThrow(/EISDIR: dir/);
    });

    it("throws EISDIR when writing over an existing directory", async () => {
      await vfs.mkdir("dir");
      await expect(vfs.writeText("dir", "x")).rejects.toThrow(/EISDIR: dir/);
    });

    it("throws ENOTDIR when a path traversal hits a file", async () => {
      await vfs.writeText("a", "x");
      await expect(vfs.readFile("a/b")).rejects.toThrow(/ENOTDIR: a\/b/);
      await expect(vfs.writeText("a/b", "y")).rejects.toThrow(/ENOTDIR: a/);
    });
  });

  describe("stat", () => {
    it("returns correct file size and mtimeMs (and updates on overwrite)", async () => {
      vi.setSystemTime(new Date("2020-01-01T00:00:01.000Z"));
      await vfs.writeText("file.txt", "abc");
      const st1 = await vfs.stat("file.txt");
      expect(st1.isFile()).toBe(true);
      expect(st1.isDirectory()).toBe(false);
      expect(st1.size).toBe(3);
      expect(st1.mtimeMs).toBe(Date.parse("2020-01-01T00:00:01.000Z"));

      vi.setSystemTime(new Date("2020-01-01T00:00:02.000Z"));
      await vfs.writeText("file.txt", "abcd");
      const st2 = await vfs.stat("file.txt");
      expect(st2.size).toBe(4);
      expect(st2.mtimeMs).toBe(Date.parse("2020-01-01T00:00:02.000Z"));
    });

    it("returns directory stat with size=0 and updates mtimeMs when children change", async () => {
      await vfs.mkdir("dir");
      const dir0 = await vfs.stat("dir");
      expect(dir0.isDirectory()).toBe(true);
      expect(dir0.size).toBe(0);

      vi.setSystemTime(new Date("2020-01-01T00:00:03.000Z"));
      await vfs.writeText("dir/a.txt", "x");
      const dir1 = await vfs.stat("dir");
      expect(dir1.mtimeMs).toBe(Date.parse("2020-01-01T00:00:03.000Z"));

      vi.setSystemTime(new Date("2020-01-01T00:00:04.000Z"));
      await vfs.unlink("dir/a.txt");
      const dir2 = await vfs.stat("dir");
      expect(dir2.mtimeMs).toBe(Date.parse("2020-01-01T00:00:04.000Z"));
    });

    it("throws ENOENT for missing paths", async () => {
      await expect(vfs.stat("missing")).rejects.toThrow(/ENOENT: missing/);
    });
  });

  describe("readdir / list", () => {
    beforeEach(async () => {
      await vfs.writeText("dir/b.txt", "b");
      await vfs.writeText("dir/a.txt", "a");
      await vfs.mkdir("dir/sub");
    });

    it("lists directory contents in sorted order", async () => {
      await expect(vfs.readdir("dir")).resolves.toEqual(["a.txt", "b.txt", "sub"]);
    });

    it("returns dirents when withFileTypes is enabled", async () => {
      const entries = await vfs.readdir("dir", { withFileTypes: true });
      expect(entries.map((e) => e.name)).toEqual(["a.txt", "b.txt", "sub"]);

      const a = entries.find((e) => e.name === "a.txt");
      const sub = entries.find((e) => e.name === "sub");

      expect(a?.isFile()).toBe(true);
      expect(a?.isDirectory()).toBe(false);
      expect(sub?.isDirectory()).toBe(true);
      expect(sub?.isFile()).toBe(false);
    });

    it("throws ENOENT for missing directories", async () => {
      await expect(vfs.readdir("missing-dir")).rejects.toThrow(/ENOENT: missing-dir/);
    });

    it("throws ENOTDIR when target is a file", async () => {
      await expect(vfs.readdir("dir/a.txt")).rejects.toThrow(/ENOTDIR: dir\/a\.txt/);
    });

    it("returns the legacy list() format", async () => {
      const entries = await vfs.list("dir");
      expect(entries).toEqual([
        { name: "a.txt", kind: "file" },
        { name: "b.txt", kind: "file" },
        { name: "sub", kind: "dir" },
      ]);
    });
  });

  describe("mkdir", () => {
    it("returns true for the root path", async () => {
      await expect(vfs.mkdir("/")).resolves.toBe(true);
      await expect(vfs.readdir("/")).resolves.toEqual([]);
    });

    it("creates nested directories when recursive is enabled (default)", async () => {
      await expect(vfs.mkdir("a/b/c")).resolves.toBe(true);
      const st = await vfs.stat("a/b/c");
      expect(st.isDirectory()).toBe(true);
    });

    it("throws ENOENT when recursive=false and intermediate segments are missing", async () => {
      await expect(vfs.mkdir("a/b", { recursive: false })).rejects.toThrow(/ENOENT: a\/b/);
    });

    it("throws EEXIST when the directory already exists and recursive=false", async () => {
      await vfs.mkdir("existing");
      await expect(vfs.mkdir("existing", { recursive: false })).rejects.toThrow(/EEXIST: existing/);
    });

    it("throws EEXIST when the path exists as a file", async () => {
      await vfs.writeText("file", "x");
      await expect(vfs.mkdir("file")).rejects.toThrow(/EEXIST: file/);
    });

    it("throws ENOTDIR when an intermediate segment is a file", async () => {
      await vfs.writeText("a", "x");
      await expect(vfs.mkdir("a/b/c")).rejects.toThrow(/ENOTDIR: a\/b\/c/);
    });
  });

  describe("unlink / rmdir", () => {
    it("unlink() deletes files but not directories", async () => {
      await vfs.writeText("file.txt", "x");
      await expect(vfs.unlink("file.txt")).resolves.toBe(true);
      await expect(vfs.exists("file.txt")).resolves.toBe(false);

      await vfs.mkdir("dir");
      await expect(vfs.unlink("dir")).rejects.toThrow(/EISDIR: dir/);
    });

    it("unlink() rejects root and missing entries", async () => {
      await expect(vfs.unlink("/")).rejects.toThrow(/EISDIR: \//);
      await expect(vfs.unlink("missing")).rejects.toThrow(/ENOENT: missing/);
    });

    it("rmdir() removes empty directories and rejects root", async () => {
      await vfs.mkdir("empty");
      await expect(vfs.rmdir("empty")).resolves.toBe(true);
      await expect(vfs.exists("empty")).resolves.toBe(false);

      await expect(vfs.rmdir("/")).rejects.toThrow(/EPERM: cannot remove root/);
    });

    it("rmdir() rejects non-directories and non-empty dirs without recursive", async () => {
      await vfs.writeText("file", "x");
      await expect(vfs.rmdir("file")).rejects.toThrow(/ENOTDIR: file/);

      await vfs.mkdir("dir");
      await vfs.writeText("dir/a.txt", "x");
      await expect(vfs.rmdir("dir", { recursive: false })).rejects.toThrow(/ENOTEMPTY: dir/);
    });

    it("rmdir() removes non-empty dirs when recursive=true", async () => {
      await vfs.writeText("dir/sub/a.txt", "x");
      await expect(vfs.rmdir("dir", { recursive: true })).resolves.toBe(true);
      await expect(vfs.exists("dir")).resolves.toBe(false);
      await expect(vfs.exists("dir/sub/a.txt")).resolves.toBe(false);
    });
  });

  describe("listFiles / walkFiles", () => {
    beforeEach(async () => {
      await vfs.writeText("root.txt", "r");
      await vfs.writeText("a/a.txt", "a");
      await vfs.writeText("a/sub/z.txt", "z");
      await vfs.writeText("b/b.txt", "b");
    });

    it("listFiles() returns sorted file paths for the whole tree by default", async () => {
      await expect(vfs.listFiles()).resolves.toEqual(["a/a.txt", "a/sub/z.txt", "b/b.txt", "root.txt"]);
    });

    it("listFiles() respects prefix and recursive=false", async () => {
      await expect(vfs.listFiles({ prefix: "a", recursive: false })).resolves.toEqual(["a/a.txt"]);
      await expect(vfs.listFiles({ prefix: "a", recursive: true })).resolves.toEqual(["a/a.txt", "a/sub/z.txt"]);
    });

    it("listFiles() returns the file itself when prefix points to a file", async () => {
      await expect(vfs.listFiles({ prefix: "root.txt" })).resolves.toEqual(["root.txt"]);
      await expect(vfs.listFiles({ prefix: "missing.txt" })).resolves.toEqual([]);
    });

    it("walkFiles() yields files in a stable, sorted traversal order", async () => {
      const seen = [];
      for await (const p of vfs.walkFiles()) seen.push(p);
      expect(seen).toEqual(["a/a.txt", "a/sub/z.txt", "b/b.txt", "root.txt"]);
    });

    it("walkFiles() respects prefix and recursive=false", async () => {
      const seen = [];
      for await (const p of vfs.walkFiles({ prefix: "a", recursive: false })) seen.push(p);
      expect(seen).toEqual(["a/a.txt"]);

      const missing = [];
      for await (const p of vfs.walkFiles({ prefix: "missing" })) missing.push(p);
      expect(missing).toEqual([]);
    });

    it("walkFiles() yields the file itself when prefix points to a file", async () => {
      const seen = [];
      for await (const p of vfs.walkFiles({ prefix: "root.txt" })) seen.push(p);
      expect(seen).toEqual(["root.txt"]);
    });
  });

  describe("exists", () => {
    it("returns true for root and existing nodes, false for missing nodes", async () => {
      await expect(vfs.exists("/")).resolves.toBe(true);

      await vfs.mkdir("dir");
      await vfs.writeText("dir/file.txt", "x");

      await expect(vfs.exists("dir")).resolves.toBe(true);
      await expect(vfs.exists("dir/file.txt")).resolves.toBe(true);
      await expect(vfs.exists("missing")).resolves.toBe(false);
    });

    it("returns false when internal traversal throws (ENOTDIR)", async () => {
      await vfs.writeText("a", "x");
      await expect(vfs.exists("a/b")).resolves.toBe(false);
    });
  });

  describe("copy", () => {
    it("copies file contents to a new destination (creating parents)", async () => {
      const bytes = new Uint8Array([5, 6, 7]);
      await vfs.writeFile("src.bin", bytes);

      await expect(vfs.copy("src.bin", "/nested/dst.bin")).resolves.toBe(true);
      await expect(vfs.readFile("nested/dst.bin")).resolves.toEqual(bytes);
    });

    it("overwrites existing destination files", async () => {
      await vfs.writeText("src.txt", "A");
      await vfs.writeText("dst.txt", "B");
      await vfs.copy("src.txt", "dst.txt");
      await expect(vfs.readText("dst.txt")).resolves.toBe("A");
    });

    it("throws on root src/dest and propagates ENOENT from readFile", async () => {
      await expect(vfs.copy("/", "x")).rejects.toThrow(/EISDIR: \//);
      await expect(vfs.copy("x", "/")).rejects.toThrow(/EISDIR: \//);
      await expect(vfs.copy("missing", "dst")).rejects.toThrow(/ENOENT: missing/);
    });

    it("throws EISDIR when the destination is an existing directory", async () => {
      await vfs.writeText("src.txt", "x");
      await vfs.mkdir("dest");
      await expect(vfs.copy("src.txt", "dest")).rejects.toThrow(/EISDIR: dest/);
    });
  });

  describe("move", () => {
    it("moves files, removes the source, and creates destination parents", async () => {
      await vfs.writeText("src.txt", "x");
      await expect(vfs.move("/src.txt", "a/b/dst.txt")).resolves.toBe(true);
      await expect(vfs.exists("src.txt")).resolves.toBe(false);
      await expect(vfs.readText("a/b/dst.txt")).resolves.toBe("x");
    });

    it("throws when source is missing or src/dest is root", async () => {
      await expect(vfs.move("missing.txt", "dst.txt")).rejects.toThrow(/ENOENT: missing\.txt/);
      await expect(vfs.move("/", "dst.txt")).rejects.toThrow(/EISDIR: \//);
      await expect(vfs.move("src.txt", "/")).rejects.toThrow(/EISDIR: \//);
    });

    it("throws EISDIR when moving a file onto an existing directory", async () => {
      await vfs.writeText("src.txt", "x");
      await vfs.mkdir("dest");
      await expect(vfs.move("src.txt", "dest")).rejects.toThrow(/EISDIR: dest/);
    });

    it("moves directories as a single node (subtree preserved)", async () => {
      await vfs.writeText("dir/sub/file.txt", "x");
      await expect(vfs.move("dir", "moved")).resolves.toBe(true);
      await expect(vfs.exists("dir")).resolves.toBe(false);
      await expect(vfs.readText("moved/sub/file.txt")).resolves.toBe("x");
    });
  });

  describe("appendText", () => {
    it("creates a new file when missing and appends to existing files", async () => {
      await expect(vfs.appendText("log.txt", "a")).resolves.toBe(true);
      await expect(vfs.readText("log.txt")).resolves.toBe("a");

      await vfs.appendText("log.txt", "b");
      await expect(vfs.readText("log.txt")).resolves.toBe("ab");
    });

    it("treats nullish text as empty string", async () => {
      await vfs.writeText("log.txt", "x");
      await vfs.appendText("log.txt", null);
      await vfs.appendText("log.txt", undefined);
      await expect(vfs.readText("log.txt")).resolves.toBe("x");
    });

    it("throws for root and directory targets", async () => {
      await expect(vfs.appendText("/", "x")).rejects.toThrow(/EISDIR: \//);
      await vfs.mkdir("dir");
      await expect(vfs.appendText("dir", "x")).rejects.toThrow(/EISDIR: dir/);
    });

    it("propagates traversal errors (ENOTDIR)", async () => {
      await vfs.writeText("a", "x");
      await expect(vfs.appendText("a/b", "y")).rejects.toThrow(/ENOTDIR: a\/b/);
    });
  });

  describe("dependency usage", () => {
    it("routes paths through normalizeVfsPath", async () => {
      await vfs.writeText("  /dir//file.txt  ", "x");
      await expect(vfs.readText("dir/file.txt")).resolves.toBe("x");
      expect(normalizeVfsPathMock).toHaveBeenCalled();
    });
  });
});
