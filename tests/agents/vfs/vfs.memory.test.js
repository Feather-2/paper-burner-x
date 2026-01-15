import { describe, expect, it } from "vitest";

import { MemoryVfs } from "../../../js/agents/vfs/vfs.memory.js";

describe("agents/vfs/vfs.memory", () => {
  it("supports CRUD operations and basic listing APIs", async () => {
    const vfs = new MemoryVfs();

    // Root exists by definition.
    await expect(vfs.exists("")).resolves.toBe(true);

    // Create directories/files (including non-text payloads).
    await expect(vfs.mkdir("a/b")).resolves.toBe(true);
    await expect(vfs.writeText("a/root.txt", "root")).resolves.toBe(true);
    await expect(vfs.writeFile("a/b/data.json", { ok: true, n: 1 })).resolves.toBe(true);
    await expect(vfs.writeFile("a/b/list.json", [1, 2, 3])).resolves.toBe(true);
    await expect(vfs.writeFile("a/b/num.txt", 123)).resolves.toBe(true);
    await expect(vfs.writeFile("a/b/empty.bin", null)).resolves.toBe(true);

    const ab = new Uint8Array([1, 2, 3]).buffer;
    await expect(vfs.writeFile("a/b/buf.bin", ab)).resolves.toBe(true);

    const view = new Uint16Array([0x1234, 0x5678]);
    await expect(vfs.writeFile("a/b/view.bin", view)).resolves.toBe(true);

    const bytes = new Uint8Array([9, 8, 7]);
    await expect(vfs.writeFile("a/b/bytes.bin", bytes)).resolves.toBe(true);

    // Read-back.
    await expect(vfs.readText("a/root.txt")).resolves.toBe("root");
    await expect(vfs.readText("a/b/data.json")).resolves.toBe(JSON.stringify({ ok: true, n: 1 }));
    await expect(vfs.readText("a/b/list.json")).resolves.toBe(JSON.stringify([1, 2, 3]));
    await expect(vfs.readText("a/b/num.txt")).resolves.toBe("123");

    await expect(vfs.readFile("a/b/empty.bin")).resolves.toHaveLength(0);
    await expect(vfs.readFile("a/b/buf.bin")).resolves.toHaveLength(3);
    await expect(vfs.readFile("a/b/view.bin")).resolves.toHaveLength(view.byteLength);

    // readFile returns a copy, so mutations to the returned Uint8Array don't affect stored content.
    const r1 = await vfs.readFile("a/b/bytes.bin");
    r1[0] = 255;
    const r2 = await vfs.readFile("a/b/bytes.bin");
    expect(Array.from(r2)).toEqual([9, 8, 7]);

    // stat() for file/dir/root.
    const stRoot = await vfs.stat("");
    expect(stRoot.isDirectory()).toBe(true);
    expect(stRoot.isFile()).toBe(false);

    const stDir = await vfs.stat("a/b");
    expect(stDir.isDirectory()).toBe(true);
    expect(stDir.isFile()).toBe(false);
    expect(stDir.size).toBe(0);

    const stFile = await vfs.stat("a/root.txt");
    expect(stFile.isFile()).toBe(true);
    expect(stFile.isDirectory()).toBe(false);
    expect(stFile.size).toBe(4);

    // readdir() (sorted) and withFileTypes mode.
    await expect(vfs.readdir("a/b")).resolves.toEqual([
      "buf.bin",
      "bytes.bin",
      "data.json",
      "empty.bin",
      "list.json",
      "num.txt",
      "view.bin",
    ]);
    const dirents = /** @type {any[]} */ (await vfs.readdir("a/b", { withFileTypes: true }));
    expect(dirents.map((d) => [d.name, d.isFile(), d.isDirectory()])).toEqual([
      ["buf.bin", true, false],
      ["bytes.bin", true, false],
      ["data.json", true, false],
      ["empty.bin", true, false],
      ["list.json", true, false],
      ["num.txt", true, false],
      ["view.bin", true, false],
    ]);

    // list() legacy helper (dir/file kinds).
    await expect(vfs.list("a")).resolves.toEqual([{ name: "b", kind: "dir" }, { name: "root.txt", kind: "file" }]);

    // listFiles() respects prefix and recursion, and handles "prefix is file".
    await expect(vfs.listFiles({ prefix: "a", recursive: false })).resolves.toEqual(["a/root.txt"]);
    await expect(vfs.listFiles({ prefix: "a/b/data.json" })).resolves.toEqual(["a/b/data.json"]);
    await expect(vfs.listFiles({ prefix: "missing" })).resolves.toEqual([]);

    const files = await vfs.listFiles({ prefix: "a", recursive: true });
    expect(files).toEqual([
      "a/b/buf.bin",
      "a/b/bytes.bin",
      "a/b/data.json",
      "a/b/empty.bin",
      "a/b/list.json",
      "a/b/num.txt",
      "a/b/view.bin",
      "a/root.txt",
    ]);

    // walkFiles() yields stable ordering and supports file-prefix.
    const walked = [];
    for await (const f of vfs.walkFiles({ prefix: "a", recursive: true })) walked.push(f);
    expect(walked).toEqual(files);

    const walkedFile = [];
    for await (const f of vfs.walkFiles({ prefix: "a/root.txt" })) walkedFile.push(f);
    expect(walkedFile).toEqual(["a/root.txt"]);

    // Update operations: overwrite, append, copy, move.
    await expect(vfs.writeText("a/root.txt", "overwrite")).resolves.toBe(true);
    await expect(vfs.appendText("a/root.txt", "!")).resolves.toBe(true);
    await expect(vfs.readText("a/root.txt")).resolves.toBe("overwrite!");

    await expect(vfs.copy("a/root.txt", "a/root.copy.txt")).resolves.toBe(true);
    await expect(vfs.readText("a/root.copy.txt")).resolves.toBe("overwrite!");

    await expect(vfs.move("a/root.copy.txt", "a/moved.txt")).resolves.toBe(true);
    await expect(vfs.exists("a/root.copy.txt")).resolves.toBe(false);
    await expect(vfs.readText("a/moved.txt")).resolves.toBe("overwrite!");

    // Delete file and directory.
    await expect(vfs.unlink("a/moved.txt")).resolves.toBe(true);
    await expect(vfs.exists("a/moved.txt")).resolves.toBe(false);

    await expect(vfs.rmdir("a/b", { recursive: true })).resolves.toBe(true);
    await expect(vfs.exists("a/b")).resolves.toBe(false);
  });

  it("throws useful errors for invalid operations and edge cases", async () => {
    const vfs = new MemoryVfs();

    await expect(vfs.readFile("")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.readFile("missing.txt")).rejects.toThrow(/ENOENT/i);

    await expect(vfs.writeText("", "nope")).rejects.toThrow(/EISDIR/i);

    await vfs.writeText("file.txt", "x");
    await expect(vfs.readdir("file.txt")).rejects.toThrow(/ENOTDIR/i);

    await expect(vfs.mkdir("file.txt")).rejects.toThrow(/EEXIST/i);
    await expect(vfs.mkdir("x/y", { recursive: false })).rejects.toThrow(/ENOENT/i);

    // mkdir() is idempotent when the target directory already exists (default recursive behavior).
    await vfs.mkdir("existing/dir");
    await expect(vfs.mkdir("existing/dir")).resolves.toBe(true);

    await expect(vfs.rmdir("")).rejects.toThrow(/EPERM/i);
    await expect(vfs.rmdir("file.txt")).rejects.toThrow(/ENOTDIR/i);

    await vfs.mkdir("dir");
    await vfs.writeText("dir/child.txt", "y");
    await expect(vfs.rmdir("dir")).rejects.toThrow(/ENOTEMPTY/i);
    await expect(vfs.rmdir("dir", { recursive: true })).resolves.toBe(true);

    await vfs.mkdir("dir2");
    await expect(vfs.unlink("dir2")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.unlink("missing.txt")).rejects.toThrow(/ENOENT/i);

    await vfs.writeText("src.txt", "s");
    await vfs.mkdir("destdir");
    await expect(vfs.move("src.txt", "destdir")).rejects.toThrow(/EISDIR/i);

    // exists() returns false when a parent path is a file (ENOTDIR during traversal).
    await vfs.writeText("a", "not-a-dir");
    await expect(vfs.writeText("a/b.txt", "x")).rejects.toThrow(/ENOTDIR/i);
    await expect(vfs.exists("a/b")).resolves.toBe(false);

    await expect(vfs.copy("", "x")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.copy("missing.txt", "x")).rejects.toThrow(/ENOENT/i);

    await vfs.mkdir("d");
    await expect(vfs.appendText("d", "x")).rejects.toThrow(/EISDIR/i);
  });

  it("appendText treats ENOENT during read as empty (race-safe behavior)", async () => {
    const vfs = new MemoryVfs();
    await vfs.writeText("race.txt", "before");

    // Simulate a race: the first _getNode sees the file, but the subsequent read sees it as missing.
    let calls = 0;
    const origGetNode = vfs._getNode.bind(vfs);
    vfs._getNode = (p) => {
      calls += 1;
      if (calls === 2) return null;
      return origGetNode(p);
    };

    await expect(vfs.appendText("race.txt", "after")).resolves.toBe(true);
    await expect(vfs.readText("race.txt")).resolves.toBe("after");
  });
});
