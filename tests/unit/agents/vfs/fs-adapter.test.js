import { describe, it, expect, vi, beforeEach } from "vitest";
import fsAdapterDefault, { createFsAdapterFromVfs } from "../../../../js/agents/vfs/fs-adapter.js";

vi.mock(
  "virtual:vfs-like",
  () => {
    const createDeferred = () => {
      /** @type {(value: any) => void} */
      let resolve;
      /** @type {(reason?: any) => void} */
      let reject;

      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      return { promise, resolve, reject };
    };

    return {
      createDeferred,
      createVfsLikeMock(overrides = {}) {
        return {
          readFile: vi.fn(async (path) => new Uint8Array([String(path).length])),
          readdir: vi.fn(async () => []),
          stat: vi.fn(async (path) => ({ size: String(path).length })),
          ...overrides,
        };
      },
    };
  },
  { virtual: true },
);

let createVfsLikeMock;
let createDeferred;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ createVfsLikeMock, createDeferred } = await import("virtual:vfs-like"));
});

describe("createFsAdapterFromVfs", () => {
  it("returns null for invalid vfs inputs (nullish/falsy/empty/type-mismatch)", () => {
    const cases = [
      { vfs: null, label: "null" },
      { vfs: undefined, label: "undefined" },
      { vfs: "", label: "empty string (falsy)" },
      { vfs: 0, label: "0 (falsy)" },
      { vfs: false, label: "false (falsy)" },
      { vfs: [], label: "empty array" },
      { vfs: {}, label: "empty object" },
      { vfs: { readFile: "not a function" }, label: "readFile is string" },
      { vfs: { readFile: 123 }, label: "readFile is number" },
      { vfs: { readFile: null }, label: "readFile is null" },
    ];

    for (const { vfs, label } of cases) {
      expect(createFsAdapterFromVfs(vfs), label).toBe(null);
    }
  });

  it("returns an adapter that forwards calls to the underlying VFS", async () => {
    const vfs = createVfsLikeMock();
    const adapter = createFsAdapterFromVfs(vfs);

    expect(adapter).not.toBe(null);
    expect(typeof adapter.readFile).toBe("function");
    expect(typeof adapter.readdir).toBe("function");
    expect(typeof adapter.stat).toBe("function");

    const data = await adapter.readFile("a.txt");
    expect(vfs.readFile).toHaveBeenCalledTimes(1);
    expect(vfs.readFile).toHaveBeenCalledWith("a.txt");
    expect(data).toBeInstanceOf(Uint8Array);

    const entries = await adapter.readdir("/dir", { withFileTypes: false });
    expect(vfs.readdir).toHaveBeenCalledTimes(1);
    expect(vfs.readdir).toHaveBeenCalledWith("/dir", { withFileTypes: false });
    expect(entries).toEqual([]);

    const stat = await adapter.stat("/dir/a.txt");
    expect(vfs.stat).toHaveBeenCalledTimes(1);
    expect(vfs.stat).toHaveBeenCalledWith("/dir/a.txt");
    expect(stat).toEqual({ size: "/dir/a.txt".length });
  });

  it("does not require readdir/stat to exist to create an adapter (but calling them will throw)", async () => {
    const vfs = { readFile: vi.fn(async () => "ok") };
    const adapter = createFsAdapterFromVfs(vfs);

    expect(adapter).not.toBe(null);
    await expect(adapter.readFile("x")).resolves.toBe("ok");

    expect(() => adapter.readdir("/")).toThrow(TypeError);
    expect(() => adapter.stat("/")).toThrow(TypeError);
  });

  it("propagates async errors from vfs.readFile/readdir/stat", async () => {
    const readErr = new Error("read boom");
    const dirErr = new Error("dir boom");
    const statErr = new Error("stat boom");

    const vfs = createVfsLikeMock({
      readFile: vi.fn().mockRejectedValueOnce(readErr),
      readdir: vi.fn().mockRejectedValueOnce(dirErr),
      stat: vi.fn().mockRejectedValueOnce(statErr),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    await expect(adapter.readFile("x")).rejects.toBe(readErr);
    await expect(adapter.readdir("x")).rejects.toBe(dirErr);
    await expect(adapter.stat("x")).rejects.toBe(statErr);
  });

  it("propagates synchronous throws from vfs methods", () => {
    const vfs = createVfsLikeMock({
      readFile: vi.fn(() => {
        throw new Error("sync read boom");
      }),
      readdir: vi.fn(() => {
        throw new Error("sync dir boom");
      }),
      stat: vi.fn(() => {
        throw new Error("sync stat boom");
      }),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    expect(() => adapter.readFile("x")).toThrow("sync read boom");
    expect(() => adapter.readdir("x")).toThrow("sync dir boom");
    expect(() => adapter.stat("x")).toThrow("sync stat boom");
  });

  it("forwards boundary and type-edge path/option values without coercion", async () => {
    const vfs = createVfsLikeMock({
      readFile: vi.fn(async (path) => `p:${String(path)}`),
      readdir: vi.fn(async (path, options) => [`${String(path)}|${JSON.stringify(options)}`]),
      stat: vi.fn(async (path) => ({ size: String(path).length, mtimeMs: 0 })),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    await expect(adapter.readFile("")).resolves.toBe("p:");
    await expect(adapter.readFile("   ")).resolves.toBe("p:   ");

    await expect(adapter.readFile(0)).resolves.toBe("p:0");
    await expect(adapter.readFile(-1)).resolves.toBe("p:-1");
    await expect(adapter.readFile(Number.MAX_SAFE_INTEGER)).resolves.toBe(`p:${Number.MAX_SAFE_INTEGER}`);

    await expect(adapter.readFile([])).resolves.toBe("p:");
    await expect(adapter.readFile({})).resolves.toBe("p:[object Object]");

    await expect(adapter.readdir("/x", undefined)).resolves.toEqual(["/x|undefined"]);
    await expect(adapter.readdir("/x", null)).resolves.toEqual(["/x|null"]);
    await expect(adapter.readdir("/x", [])).resolves.toEqual(["/x|[]"]);
    await expect(adapter.readdir("/x", "withFileTypes")).resolves.toEqual(['/x|"withFileTypes"']);
    await expect(adapter.readdir("/x", { withFileTypes: "true" })).resolves.toEqual(['/x|{"withFileTypes":"true"}']);

    await expect(adapter.stat("123")).resolves.toEqual({ size: 3, mtimeMs: 0 });
    await expect(adapter.stat(0)).resolves.toEqual({ size: 1, mtimeMs: 0 });
    await expect(adapter.stat(-1)).resolves.toEqual({ size: 2, mtimeMs: 0 });
    await expect(adapter.stat(Number.MAX_SAFE_INTEGER)).resolves.toEqual({
      size: String(Number.MAX_SAFE_INTEGER).length,
      mtimeMs: 0,
    });
  });

  it("handles withFileTypes readdir shapes by pass-through", async () => {
    const dirents = [
      { name: "a", isDirectory: () => false, isFile: () => true },
      { name: "b", isDirectory: () => true, isFile: () => false },
    ];

    const vfs = createVfsLikeMock({
      readdir: vi.fn().mockResolvedValueOnce(["a", "b"]).mockResolvedValueOnce(dirents),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    await expect(adapter.readdir("/d", { withFileTypes: false })).resolves.toEqual(["a", "b"]);
    await expect(adapter.readdir("/d", { withFileTypes: true })).resolves.toBe(dirents);
  });

  it("supports large payloads (resource boundary) without copying", async () => {
    const largeBin = new Uint8Array(1024 * 1024); // 1 MiB
    largeBin[0] = 1;
    largeBin[largeBin.length - 1] = 2;

    const longText = "x".repeat(200_000);

    const vfs = createVfsLikeMock({
      readFile: vi.fn(async (path) => (String(path).endsWith(".bin") ? largeBin : longText)),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    const bin = await adapter.readFile("/big.bin");
    expect(bin).toBe(largeBin);
    expect(bin.length).toBe(1024 * 1024);
    expect(bin[0]).toBe(1);
    expect(bin[bin.length - 1]).toBe(2);

    const text = await adapter.readFile("/big.txt");
    expect(text).toBe(longText);
    expect(text.length).toBe(200_000);
    expect(text.slice(0, 3)).toBe("xxx");
  });

  it("supports very long paths and deep nesting (resource boundary)", async () => {
    const deepPath = `/${"a/".repeat(500)}file.txt`;
    const longPath = "x".repeat(20_000);

    const vfs = createVfsLikeMock({
      stat: vi.fn(async (path) => ({ size: String(path).length })),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    await expect(adapter.stat(deepPath)).resolves.toEqual({ size: deepPath.length });
    await expect(adapter.stat(longPath)).resolves.toEqual({ size: longPath.length });
    expect(vfs.stat).toHaveBeenCalledWith(deepPath);
    expect(vfs.stat).toHaveBeenCalledWith(longPath);
  });

  it("allows concurrent calls (concurrency boundary) and preserves per-call results", async () => {
    const d1 = createDeferred();
    const d2 = createDeferred();

    const vfs = createVfsLikeMock({
      readFile: vi.fn((path) => {
        if (path === "a") return d1.promise;
        if (path === "b") return d2.promise;
        return Promise.resolve("unexpected");
      }),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    const p1 = adapter.readFile("a");
    const p2 = adapter.readFile("b");

    expect(vfs.readFile).toHaveBeenCalledTimes(2);
    expect(vfs.readFile).toHaveBeenCalledWith("a");
    expect(vfs.readFile).toHaveBeenCalledWith("b");

    d2.resolve("B");
    d1.resolve("A");

    await expect(Promise.all([p1, p2])).resolves.toEqual(["A", "B"]);
  });

  it("supports rapid successive calls (concurrency boundary)", async () => {
    const vfs = createVfsLikeMock({
      stat: vi.fn(async (path) => ({ size: String(path).length })),
    });

    const adapter = createFsAdapterFromVfs(vfs);

    const calls = Array.from({ length: 50 }, (_, i) => adapter.stat(`/f/${i}`));
    const results = await Promise.all(calls);

    expect(results).toHaveLength(50);
    expect(vfs.stat).toHaveBeenCalledTimes(50);
    expect(results[0]).toEqual({ size: "/f/0".length });
    expect(results[49]).toEqual({ size: "/f/49".length });
  });

  it("returns null for a truthy object whose readFile is inherited but not a function", () => {
    const proto = { readFile: "nope" };
    const vfs = Object.create(proto);

    expect(createFsAdapterFromVfs(vfs)).toBe(null);
  });
});

describe("default export", () => {
  it("exports createFsAdapterFromVfs on the default object", () => {
    expect(fsAdapterDefault).toBeTruthy();
    expect(fsAdapterDefault).toHaveProperty("createFsAdapterFromVfs", createFsAdapterFromVfs);
  });

  it("default export function behaves the same as the named export", async () => {
    const vfs = createVfsLikeMock({
      readFile: vi.fn(async (path) => `ok:${path}`),
      readdir: vi.fn(async (path) => [path]),
      stat: vi.fn(async () => ({ size: 0 })),
    });

    const adapter = fsAdapterDefault.createFsAdapterFromVfs(vfs);

    await expect(adapter.readFile("p")).resolves.toBe("ok:p");
    await expect(adapter.readdir("d")).resolves.toEqual(["d"]);
    await expect(adapter.stat("s")).resolves.toEqual({ size: 0 });
  });
});