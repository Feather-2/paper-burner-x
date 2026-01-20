import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "virtual:vfs-helpers",
  () => {
    const makeLargeUint8Array = (size) => {
      const data = new Uint8Array(size);
      data.fill(7);
      return data;
    };

    const makeDeepPath = (segments) =>
      Array.from({ length: segments }, (_, i) => `seg${i}`).join("/");

    const buildMockVfs = (overrides = {}) => {
      const base = {
        readFile: (path) => Promise.resolve(`read:${String(path)}`),
        readdir: (path, options) =>
          Promise.resolve([String(path), JSON.stringify(options ?? {})]),
        stat: (path) => Promise.resolve({ size: String(path).length }),
      };
      return { ...base, ...overrides };
    };

    return { buildMockVfs, makeLargeUint8Array, makeDeepPath };
  },
  { virtual: true },
);

import { buildMockVfs, makeDeepPath, makeLargeUint8Array } from "virtual:vfs-helpers";

import fsAdapterDefault, {
  createFsAdapterFromVfs,
} from "../../../../js/agents/vfs/fs-adapter.js";

describe("createFsAdapterFromVfs", () => {
  let vfs;
  let adapter;

  beforeEach(() => {
    vfs = buildMockVfs({
      readFile: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
    });
    adapter = createFsAdapterFromVfs(vfs);
  });

  it("returns null for missing or invalid vfs inputs", () => {
    const cases = [
      null,
      undefined,
      "",
      "   ",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "42",
      [],
      {},
      { readFile: null },
      { readFile: "nope" },
    ];

    for (const value of cases) {
      expect(createFsAdapterFromVfs(value)).toBeNull();
    }
  });

  it("forwards calls and returns results for normal paths", async () => {
    const path = "dir/file.txt";
    const options = { withFileTypes: true };
    const readResult = new Uint8Array([1, 2, 3]);
    const dirents = [
      { name: "file.txt", isDirectory: () => false, isFile: () => true },
    ];
    const statResult = { size: 3, mtimeMs: 123 };

    vfs.readFile.mockResolvedValue(readResult);
    vfs.readdir.mockResolvedValue(dirents);
    vfs.stat.mockResolvedValue(statResult);

    await expect(adapter.readFile(path)).resolves.toBe(readResult);
    await expect(adapter.readdir(path, options)).resolves.toBe(dirents);
    await expect(adapter.stat(path)).resolves.toBe(statResult);

    expect(vfs.readFile).toHaveBeenCalledWith(path);
    expect(vfs.readdir).toHaveBeenCalledWith(path, options);
    expect(vfs.stat).toHaveBeenCalledWith(path);
  });

  it("propagates errors from vfs methods", async () => {
    const error = new Error("boom");
    const errorVfs = buildMockVfs({
      readFile: vi.fn(async () => {
        throw error;
      }),
      readdir: vi.fn(async () => {
        throw error;
      }),
      stat: vi.fn(async () => {
        throw error;
      }),
    });

    const errorAdapter = createFsAdapterFromVfs(errorVfs);

    await expect(errorAdapter.readFile("x")).rejects.toBe(error);
    await expect(errorAdapter.readdir("x")).rejects.toBe(error);
    await expect(errorAdapter.stat("x")).rejects.toBe(error);
  });

  it("handles boundary inputs, types, and resource sizes without transforming", async () => {
    const longPath = "a".repeat(5000);
    const deepPath = makeDeepPath(120);
    const largeBuffer = makeLargeUint8Array(1024 * 1024);
    const objectAsArray = { 0: "file.txt", length: 1 };
    const emptyStat = {};

    const boundaryVfs = buildMockVfs({
      readFile: vi.fn(async (path) => {
        if (path === longPath) return "long-path";
        if (path === deepPath) return largeBuffer;
        if (path === "") return "";
        if (path === "   ") return "whitespace";
        if (path === "0") return "string-number";
        return String(path);
      }),
      readdir: vi.fn(async (path) => {
        if (path === "") return [];
        if (path === "object-array") return objectAsArray;
        return ["ok"];
      }),
      stat: vi.fn(async (path) => {
        if (path === 0) return { size: 0 };
        if (path === -1) return { size: -1 };
        if (path === Number.MAX_SAFE_INTEGER)
          return { size: Number.MAX_SAFE_INTEGER };
        if (path === "string-number") return { size: "123" };
        if (path === "empty-object") return emptyStat;
        return { size: 1 };
      }),
    });

    const boundaryAdapter = createFsAdapterFromVfs(boundaryVfs);

    await expect(boundaryAdapter.readFile("")).resolves.toBe("");
    await expect(boundaryAdapter.readFile("   ")).resolves.toBe("whitespace");
    await expect(boundaryAdapter.readFile(longPath)).resolves.toBe("long-path");
    await expect(boundaryAdapter.readFile(deepPath)).resolves.toBe(largeBuffer);
    await expect(boundaryAdapter.readFile("0")).resolves.toBe("string-number");

    await expect(boundaryAdapter.readdir("")).resolves.toEqual([]);
    await expect(boundaryAdapter.readdir("object-array")).resolves.toBe(objectAsArray);

    await expect(boundaryAdapter.stat(0)).resolves.toEqual({ size: 0 });
    await expect(boundaryAdapter.stat(-1)).resolves.toEqual({ size: -1 });
    await expect(boundaryAdapter.stat(Number.MAX_SAFE_INTEGER)).resolves.toEqual({
      size: Number.MAX_SAFE_INTEGER,
    });
    await expect(boundaryAdapter.stat("string-number")).resolves.toEqual({
      size: "123",
    });
    await expect(boundaryAdapter.stat("empty-object")).resolves.toBe(emptyStat);
  });

  it("supports concurrent and rapid successive calls", async () => {
    const calls = [];
    const concurrentVfs = buildMockVfs({
      readFile: vi.fn(async (path) => {
        calls.push(`read:${String(path)}`);
        return `data:${String(path)}`;
      }),
      readdir: vi.fn(async (path) => {
        calls.push(`dir:${String(path)}`);
        return [String(path)];
      }),
      stat: vi.fn(async (path) => {
        calls.push(`stat:${String(path)}`);
        return { size: String(path).length };
      }),
    });

    const concurrentAdapter = createFsAdapterFromVfs(concurrentVfs);

    const results = await Promise.all([
      concurrentAdapter.readFile("a"),
      concurrentAdapter.readFile("b"),
      concurrentAdapter.readdir("c"),
      concurrentAdapter.stat("d"),
      concurrentAdapter.stat("e"),
    ]);

    expect(results).toEqual(["data:a", "data:b", ["c"], { size: 1 }, { size: 1 }]);
    expect(concurrentVfs.readFile).toHaveBeenCalledTimes(2);
    expect(concurrentVfs.readdir).toHaveBeenCalledTimes(1);
    expect(concurrentVfs.stat).toHaveBeenCalledTimes(2);

    await concurrentAdapter.readFile("a");
    await concurrentAdapter.readFile("a");
    expect(concurrentVfs.readFile).toHaveBeenCalledTimes(4);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("default", () => {
  it("exposes createFsAdapterFromVfs", () => {
    expect(fsAdapterDefault).toEqual({ createFsAdapterFromVfs });
    expect(fsAdapterDefault.createFsAdapterFromVfs).toBe(createFsAdapterFromVfs);
  });
});
