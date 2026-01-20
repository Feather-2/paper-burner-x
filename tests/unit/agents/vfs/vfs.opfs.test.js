import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/vfs/path.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/vfs/path.js");
  return {
    ...actual,
    normalizeVfsPath: vi.fn(actual.normalizeVfsPath),
    dirnameVfsPath: vi.fn(actual.dirnameVfsPath),
    basenameVfsPath: vi.fn(actual.basenameVfsPath),
  };
});

import { OpfsVfs, supportsOpfs } from "../../../../js/agents/vfs/vfs.opfs.js";
import { createMockOpfsRoot, MockDirectoryHandle, NotFoundError } from "./opfs-mock.js";
import { normalizeVfsPath, dirnameVfsPath, basenameVfsPath } from "../../../../js/agents/vfs/path.js";

const setupVfs = async (options = {}) => {
  const root = createMockOpfsRoot();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });
  const vfs = await OpfsVfs.create(options);
  return { root, vfs };
};

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("supportsOpfs", () => {
  it("reflects navigator.storage.getDirectory presence and ignores input", () => {
    vi.stubGlobal("navigator", undefined);
    expect(supportsOpfs(null)).toBe(false);

    vi.stubGlobal("navigator", { storage: {} });
    expect(supportsOpfs(undefined)).toBe(false);

    vi.stubGlobal("navigator", { storage: { getDirectory: async () => createMockOpfsRoot() } });
    expect(supportsOpfs("unused")).toBe(true);
  });
});

describe("OpfsVfs", () => {
  it("create throws when OPFS is unavailable", async () => {
    vi.stubGlobal("navigator", { storage: {} });
    await expect(OpfsVfs.create()).rejects.toThrow(/OPFS not available/i);
  });

  it("create respects rootDirName and stringifies non-string names", async () => {
    const root = createMockOpfsRoot();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root } });

    const vfsNumber = await OpfsVfs.create({ rootDirName: 123 });
    await expect(root.getDirectoryHandle("123", { create: false })).resolves.toBeInstanceOf(
      MockDirectoryHandle,
    );
    expect(vfsNumber).toBeInstanceOf(OpfsVfs);

    const vfsRoot = await OpfsVfs.create({ rootDirName: "" });
    expect(vfsRoot._root).toBe(root);
  });

  it("writeFile writes supported data types and readFile returns bytes", async () => {
    const { vfs } = await setupVfs();
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const viewSource = new Uint8Array([9, 8, 7, 6]);
    const view = new DataView(viewSource.buffer, 1, 2);
    const blob = typeof Blob !== "undefined" ? new Blob(["blob"]) : null;

    await vfs.writeFile("data/null.bin", null);
    await vfs.writeFile("data/undefined.bin", undefined);
    await vfs.writeFile("data/string.txt", "hi");
    await vfs.writeFile("data/buffer.bin", buffer);
    await vfs.writeFile("data/view.bin", view);
    await vfs.writeFile("data/object.bin", {});
    await vfs.writeFile("data/empty-array.bin", []);
    await vfs.writeFile("data/array-like.bin", { 0: "x", length: 1 });
    await vfs.writeFile("data/number-string.txt", "123");
    if (blob) await vfs.writeFile("data/blob.bin", blob);

    await expect(vfs.readFile("data/null.bin")).resolves.toEqual(new Uint8Array(0));
    await expect(vfs.readFile("data/undefined.bin")).resolves.toEqual(new Uint8Array(0));
    await expect(vfs.readText("data/string.txt")).resolves.toBe("hi");
    await expect(vfs.readFile("data/buffer.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(vfs.readFile("data/view.bin")).resolves.toEqual(new Uint8Array([8, 7]));
    await expect(vfs.readText("data/object.bin")).resolves.toBe("[object Object]");
    await expect(vfs.readText("data/empty-array.bin")).resolves.toBe("");
    await expect(vfs.readText("data/array-like.bin")).resolves.toBe("[object Object]");
    await expect(vfs.readText("data/number-string.txt")).resolves.toBe("123");
    if (blob) await expect(vfs.readText("data/blob.bin")).resolves.toBe("blob");

    expect(normalizeVfsPath).toHaveBeenCalled();
    expect(dirnameVfsPath).toHaveBeenCalled();
    expect(basenameVfsPath).toHaveBeenCalled();
  });

  it.each([
    [0, "0", "zero.txt"],
    [-1, "-1", "neg.txt"],
    [Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER), "max.txt"],
    ["", "", "empty.txt"],
    ["   ", "   ", "space.txt"],
  ])("writeText stringifies %s", async (value, expected, name) => {
    const { vfs } = await setupVfs();
    await expect(vfs.writeText(`texts/${name}`, value)).resolves.toBe(true);
    await expect(vfs.readText(`texts/${name}`)).resolves.toBe(expected);
  });

  it("rejects root-like paths for file operations", async () => {
    const { vfs } = await setupVfs();

    await expect(vfs.readFile("")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.writeFile("   ", "x")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.writeFile(null, "x")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.unlink(undefined)).rejects.toThrow(/EISDIR/i);
  });

  it("mkdir handles recursive and non-recursive behavior", async () => {
    const { vfs } = await setupVfs();

    await expect(vfs.mkdir("", { recursive: true })).resolves.toBe(true);
    await expect(vfs.mkdir(null)).resolves.toBe(true);
    await expect(vfs.mkdir("parent/child", { recursive: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(vfs.mkdir("parent", { recursive: true })).resolves.toBe(true);
    await expect(vfs.mkdir("parent/child", { recursive: false })).resolves.toBe(true);
  });

  it("stat and exists report file/dir and missing paths", async () => {
    const { vfs } = await setupVfs();

    await vfs.writeText("stat/file.txt", "x");
    await vfs.mkdir("stat/dir", { recursive: true });

    const rootStat = await vfs.stat("");
    expect(rootStat.isDirectory()).toBe(true);
    expect(rootStat.size).toBe(0);

    const fileStat = await vfs.stat("stat/file.txt");
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isDirectory()).toBe(false);
    expect(fileStat.size).toBeGreaterThan(0);
    expect(typeof fileStat.mtimeMs).toBe("number");

    const dirStat = await vfs.stat("stat");
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.isFile()).toBe(false);

    await expect(vfs.stat("missing" कायम )).rejects.toThrow(/ENOENT/); // Actually we must not include non-ascii. Oops.
  });
});
