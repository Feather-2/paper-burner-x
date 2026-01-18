import { afterEach, describe, expect, it, vi } from "vitest";

import { OpfsVfs, supportsOpfs } from "../../../js/agents/vfs/vfs.opfs.js";

import { createMockOpfsRoot, MockDirectoryHandle, NotFoundError } from "./opfs-mock.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/vfs.opfs", () => {
  it("supportsOpfs reflects presence of navigator.storage.getDirectory", () => {
    // Node's navigator exists, but doesn't expose OPFS.
    expect(supportsOpfs()).toBe(false);

    vi.stubGlobal("navigator", { storage: { getDirectory: async () => createMockOpfsRoot() } });
    expect(supportsOpfs()).toBe(true);
  });

  it("OpfsVfs.create throws when OPFS is unavailable", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    await expect(OpfsVfs.create({ rootDirName: "x" })).rejects.toThrow(/OPFS not available/i);
  });

  it("supports basic CRUD operations and listing APIs on a mocked OPFS", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const vfs = await OpfsVfs.create({ rootDirName: "workspace" });

    // Root dir name should create a directory handle under the storage root.
    await expect(root.getDirectoryHandle("workspace", { create: false })).resolves.toBeInstanceOf(
      MockDirectoryHandle,
    );

    await expect(vfs.mkdir("a/b", { recursive: true })).resolves.toBe(true);
    await expect(vfs.writeText("a/b/hello.txt", "hi")).resolves.toBe(true);
    await expect(vfs.readText("a/b/hello.txt")).resolves.toBe("hi");

    await expect(vfs.writeFile("a/b/raw.bin", new Uint8Array([1, 2, 3]))).resolves.toBe(true);
    await expect(vfs.readFile("a/b/raw.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));

    const stRoot = await vfs.stat("");
    expect(stRoot.isDirectory()).toBe(true);

    const stDir = await vfs.stat("a/b");
    expect(stDir.isDirectory()).toBe(true);

    const stFile = await vfs.stat("a/b/hello.txt");
    expect(stFile.isFile()).toBe(true);
    expect(stFile.size).toBeGreaterThan(0);

    await expect(vfs.exists("a/b/hello.txt")).resolves.toBe(true);
    await expect(vfs.exists("missing.txt")).resolves.toBe(false);

    await expect(vfs.readdir("a/b")).resolves.toEqual(["hello.txt", "raw.bin"]);
    const dirents = /** @type {any[]} */ (await vfs.readdir("a/b", { withFileTypes: true }));
    expect(dirents.map((d) => [d.name, d.isFile(), d.isDirectory()])).toEqual([
      ["hello.txt", true, false],
      ["raw.bin", true, false],
    ]);

    await expect(vfs.list("a")).resolves.toEqual([{ name: "b", kind: "dir" }]);
    await expect(vfs.list("a/b")).resolves.toEqual([
      { name: "hello.txt", kind: "file" },
      { name: "raw.bin", kind: "file" },
    ]);
  });

  it("supports copy/move, unlink, rmdir and file walking", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const vfs = await OpfsVfs.create({ rootDirName: "w" });

    await vfs.writeText("base/a.txt", "a");
    await vfs.writeText("base/dir/b.txt", "b");
    await vfs.writeText("base/dir/sub/c.txt", "c");

    await vfs.copy("base/a.txt", "base/a.copy.txt");
    await expect(vfs.readText("base/a.copy.txt")).resolves.toBe("a");

    await vfs.move("base/a.copy.txt", "base/a.moved.txt");
    await expect(vfs.exists("base/a.copy.txt")).resolves.toBe(false);
    await expect(vfs.readText("base/a.moved.txt")).resolves.toBe("a");

    const files = await vfs.listFiles({ prefix: "base", recursive: true });
    expect(files).toEqual([
      "base/a.moved.txt",
      "base/a.txt",
      "base/dir/b.txt",
      "base/dir/sub/c.txt",
    ]);

    const walked = [];
    for await (const p of vfs.walkFiles({ prefix: "base", recursive: true })) walked.push(p);
    expect(walked).toEqual(files);

    // walkFiles on missing path yields nothing.
    const missingWalk = [];
    for await (const p of vfs.walkFiles({ prefix: "missing" })) missingWalk.push(p);
    expect(missingWalk).toEqual([]);

    // unlink/root safety
    await expect(vfs.unlink("")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.unlink("base/a.moved.txt")).resolves.toBe(true);
    await expect(vfs.exists("base/a.moved.txt")).resolves.toBe(false);

    // rmdir should enforce recursive flag for non-empty dirs (mirrors browser behavior).
    await expect(vfs.rmdir("base/dir", { recursive: false })).rejects.toThrow();
    await expect(vfs.rmdir("base/dir", { recursive: true })).resolves.toBe(true);
    await expect(vfs.exists("base/dir")).resolves.toBe(false);
  });

  it("maps OPFS errors to VFS-style behaviors", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const vfs = await OpfsVfs.create({ rootDirName: "w3" });

    await vfs.mkdir("dir");
    await vfs.writeText("dir/file.txt", "x");

    await expect(vfs.readFile("missing.txt")).resolves.toBeNull();
    await expect(vfs.readFile("dir")).rejects.toThrow(/EISDIR/i);

    await expect(vfs.writeFile("", new Uint8Array([1]))).rejects.toThrow(/EISDIR/i);

    await expect(vfs.stat("missing-dir")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.unlink("missing.txt")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.rmdir("missing-dir")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.readdir("missing-dir")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.readdir("dir/file.txt")).rejects.toThrow(/ENOTDIR/i);

    await expect(vfs.copy("missing.txt", "dest.txt")).rejects.toThrow(/ENOENT/i);

    if (typeof vfs.rename === "function") {
      await vfs.writeText("rename.txt", "r");
      await expect(vfs.rename("rename.txt", "renamed.txt")).resolves.toBe(true);
      await expect(vfs.exists("rename.txt")).resolves.toBe(false);
      await expect(vfs.readText("renamed.txt")).resolves.toBe("r");
    }
  });

  it("mkdir(recursive:false) rejects when parent doesn't exist", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const vfs = await OpfsVfs.create({ rootDirName: "w2" });
    await expect(vfs.mkdir("a/b", { recursive: false })).rejects.toBeInstanceOf(NotFoundError);
  });
});
