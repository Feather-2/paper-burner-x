import { afterEach, describe, expect, it, vi } from "vitest";

import { StorageVfs } from "../../../js/agents/vfs/vfs.storage.js";

function createMapAdapter() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      return store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async keys() {
      return Array.from(store.keys());
    },
    async clear() {
      store.clear();
    },
    _dump() {
      return new Map(store);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agents/vfs/vfs.storage", () => {
  it("validates storageAdapter shape", () => {
    expect(() => new StorageVfs(null)).toThrow(/storageAdapter/i);
    expect(() => new StorageVfs({ get: async () => undefined })).toThrow(/get\/set\/delete\/keys/i);
  });

  it("supports writeText/readText + writeFile/readFile + directory listing", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await expect(vfs.exists("")).resolves.toBe(true);
    await expect(vfs.exists("missing.txt")).resolves.toBe(false);

    await vfs.writeText("a/b.txt", "hello");
    await expect(vfs.exists("a/b.txt")).resolves.toBe(true);
    await vfs.writeFile("a/raw.bin", new Uint8Array([1, 2, 3]));

    await expect(vfs.readText("a/b.txt")).resolves.toBe("hello");
    await expect(vfs.readFile("a/raw.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));

    // Blob write path.
    await vfs.writeFile("a/blob.txt", new Blob(["blob"]));
    await expect(vfs.readText("a/blob.txt")).resolves.toBe("blob");

    // readdir() detects implicit dirs from file keys.
    await vfs.writeText("a/sub/c.txt", "c");
    await expect(vfs.readdir("a")).resolves.toEqual(["b.txt", "blob.txt", "raw.bin", "sub"]);

    const dirents = /** @type {any[]} */ (await vfs.readdir("a", { withFileTypes: true }));
    expect(dirents.map((d) => [d.name, d.isDirectory(), d.isFile()])).toEqual([
      ["b.txt", false, true],
      ["blob.txt", false, true],
      ["raw.bin", false, true],
      ["sub", true, false],
    ]);

    await expect(vfs.list("a")).resolves.toEqual([
      { name: "b.txt", kind: "file" },
      { name: "blob.txt", kind: "file" },
      { name: "raw.bin", kind: "file" },
      { name: "sub", kind: "dir" },
    ]);
  });

  it("supports mkdir() recursive and non-recursive semantics", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await expect(vfs.mkdir("")).resolves.toBe(true);

    // Non-recursive mkdir requires the parent directory record to exist.
    await expect(vfs.mkdir("a/b", { recursive: false })).rejects.toThrow(/ENOENT/i);

    await expect(vfs.mkdir("a", { recursive: true })).resolves.toBe(true);
    await expect(vfs.mkdir("a/b", { recursive: false })).resolves.toBe(true);
    await expect(vfs.stat("a/b")).resolves.toMatchObject({ size: 0 });
  });

  it("writeFile() normalizes multiple input types via dataToBytes()", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await vfs.writeFile("ab.bin", new Uint8Array([1, 2, 3]).buffer);
    await expect(vfs.readFile("ab.bin")).resolves.toEqual(new Uint8Array([1, 2, 3]));

    const view = new Uint16Array([0x1234, 0x5678]);
    await vfs.writeFile("view.bin", view);
    await expect(vfs.readFile("view.bin")).resolves.toHaveLength(view.byteLength);

    await vfs.writeFile("obj.json", { ok: true, n: 1 });
    await expect(vfs.readText("obj.json")).resolves.toBe(JSON.stringify({ ok: true, n: 1 }));

    await vfs.writeFile("arr.json", [1, 2, 3]);
    await expect(vfs.readText("arr.json")).resolves.toBe(JSON.stringify([1, 2, 3]));

    await vfs.writeFile("num.txt", 123);
    await expect(vfs.readText("num.txt")).resolves.toBe("123");
  });

  it("throws for read/write edge cases and missing directories", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await expect(vfs.readFile("missing.bin")).rejects.toThrow(/ENOENT/i);

    await adapter.set("t:file:dir", { kind: "dir", path: "dir" });
    await expect(vfs.readFile("dir")).rejects.toThrow(/EISDIR/i);

    await expect(vfs.writeFile("", new Uint8Array([1]))).rejects.toThrow(/EISDIR/i);

    await expect(vfs.readdir("missing-dir")).rejects.toThrow(/ENOENT/i);

    await expect(vfs.mkdir("empty-dir")).resolves.toBe(true);
    await expect(vfs.readdir("empty-dir")).resolves.toEqual([]);
  });

  it("handles stat() for root/file/dir and can infer implicit directory existence", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    const stRoot = await vfs.stat("");
    expect(stRoot.isDirectory()).toBe(true);
    expect(stRoot.isFile()).toBe(false);

    await vfs.writeText("dir/file.txt", "x");
    const stFile = await vfs.stat("dir/file.txt");
    expect(stFile.isFile()).toBe(true);
    expect(stFile.size).toBeGreaterThan(0);

    const stDir = await vfs.stat("dir");
    expect(stDir.isDirectory()).toBe(true);

    // Directly inject a file key without a corresponding dir record to exercise inference.
    const injected = createMapAdapter();
    const vfs2 = new StorageVfs(injected, { keyPrefix: "t2:" });
    await injected.set("t2:file:implicit/child.txt", {
      kind: "file",
      path: "implicit/child.txt",
      encoding: "utf8",
      data: "x",
      size: 1,
    });

    const inferred = await vfs2.stat("implicit");
    expect(inferred.isDirectory()).toBe(true);
    await expect(vfs2.readdir("implicit")).resolves.toEqual(["child.txt"]);

    // Malformed file record should still be treated as a file with size=0.
    await injected.set("t2:file:bad.bin", { kind: "file", path: "bad.bin", encoding: "base64", data: "", size: "nope" });
    const stBad = await vfs2.stat("bad.bin");
    expect(stBad.isFile()).toBe(true);
    expect(stBad.size).toBe(0);
  });

  it("supports unlink/rmdir/rm errors and recursive deletion", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await expect(vfs.unlink("missing.txt")).rejects.toThrow(/ENOENT/i);
    await expect(vfs.unlink("")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.rmdir("")).rejects.toThrow(/EPERM/i);

    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/sub/b.txt", "b");

    await expect(vfs.rmdir("dir")).rejects.toThrow(/ENOTEMPTY/i);
    await expect(vfs.rm("dir")).rejects.toThrow(/ENOTEMPTY/i);
    await expect(vfs.rmdir("dir", { recursive: true })).resolves.toBe(true);
    await expect(vfs.exists("dir/a.txt")).resolves.toBe(false);

    // rm(): file vs directory
    await vfs.writeText("x.txt", "x");
    await expect(vfs.rm("x.txt")).resolves.toBe(true);
    await expect(vfs.exists("x.txt")).resolves.toBe(false);

    await vfs.writeText("d/e.txt", "e");
    await expect(vfs.rm("d", { recursive: true })).resolves.toBe(true);
    await expect(vfs.exists("d/e.txt")).resolves.toBe(false);

    // rm() should rethrow errors for missing paths via its catch block.
    await expect(vfs.rm("missing")).rejects.toThrow();
  });

  it("supports listFiles/walkFiles, copy/move, rename and encoding fallbacks", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await vfs.writeText("a/1.txt", "1");
    await vfs.writeText("a/b/2.txt", "2");
    await vfs.writeText("a/b/c/3.txt", "3");

    await expect(vfs.listFiles({ prefix: "a", recursive: false })).resolves.toEqual(["a/1.txt"]);
    await expect(vfs.listFiles({ prefix: "a", recursive: true })).resolves.toEqual(["a/1.txt", "a/b/2.txt", "a/b/c/3.txt"]);
    await expect(vfs.listFiles({ prefix: "a/1.txt" })).resolves.toEqual(["a/1.txt"]);

    const walked = [];
    for await (const p of vfs.walkFiles({ prefix: "a", recursive: true })) walked.push(p);
    expect(walked).toEqual(["a/1.txt", "a/b/2.txt", "a/b/c/3.txt"]);

    await vfs.copy("a/1.txt", "a/1.copy.txt");
    await expect(vfs.readText("a/1.copy.txt")).resolves.toBe("1");

    await vfs.move("a/1.copy.txt", "a/1.moved.txt");
    await expect(vfs.exists("a/1.copy.txt")).resolves.toBe(false);
    await expect(vfs.readText("a/1.moved.txt")).resolves.toBe("1");

    await vfs.rename("a/1.moved.txt", "a/renamed.txt");
    await expect(vfs.exists("a/1.moved.txt")).resolves.toBe(false);
    await expect(vfs.readText("a/renamed.txt")).resolves.toBe("1");

    // readFile() encoding fallback: unknown encoding treated as base64.
    await adapter.set("t:file:weird.bin", {
      kind: "file",
      path: "weird.bin",
      encoding: "wat",
      data: Buffer.from("hi", "utf8").toString("base64"),
      size: 2,
    });
    await expect(vfs.readText("weird.bin")).resolves.toBe("hi");
  });

  it("rejects root paths for copy/move/rename", async () => {
    const adapter = createMapAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "t:" });

    await expect(vfs.copy("", "dest.txt")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.copy("file.txt", "")).rejects.toThrow(/EISDIR/i);

    await expect(vfs.move("", "dest.txt")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.move("file.txt", "")).rejects.toThrow(/EISDIR/i);

    await expect(vfs.rename("", "dest.txt")).rejects.toThrow(/EISDIR/i);
    await expect(vfs.rename("file.txt", "")).rejects.toThrow(/EISDIR/i);
  });
});

describe("agents/vfs/vfs.storage (base64 fallback without Buffer)", () => {
  it("uses btoa/atob when Buffer is unavailable", async () => {
    const originalBuffer = globalThis.Buffer;

    // Implement btoa/atob using the saved Buffer, but make Buffer unavailable to the module.
    const btoa = (bin) => originalBuffer.from(String(bin), "binary").toString("base64");
    const atob = (b64) => originalBuffer.from(String(b64), "base64").toString("binary");

    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("btoa", btoa);
    vi.stubGlobal("atob", atob);

    vi.resetModules();
    const mod = await import("../../../js/agents/vfs/vfs.storage.js");
    const adapter = createMapAdapter();
    const vfs = new mod.StorageVfs(adapter, { keyPrefix: "t3:" });

    await vfs.writeFile("bin.dat", new Uint8Array([1, 2, 3]));
    const bytes = await vfs.readFile("bin.dat");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);

    // base64ToBytes should strip whitespace in the atob path.
    const rawBase64 = btoa("hi");
    await adapter.set("t3:file:spaced.txt", { kind: "file", path: "spaced.txt", encoding: "base64", data: ` ${rawBase64} `, size: 2 });
    await expect(vfs.readText("spaced.txt")).resolves.toBe("hi");
  });

  it("throws a clear error when neither Buffer nor btoa/atob are available", async () => {
    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("btoa", undefined);
    vi.stubGlobal("atob", undefined);

    vi.resetModules();
    const mod = await import("../../../js/agents/vfs/vfs.storage.js");
    const adapter = createMapAdapter();
    const vfs = new mod.StorageVfs(adapter, { keyPrefix: "t4:" });

    await expect(vfs.writeFile("x.bin", new Uint8Array([1]))).rejects.toThrow(/base64 encoding is unavailable/i);
  });

  it("throws a clear error when base64 decoding is unavailable", async () => {
    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("atob", undefined);
    vi.stubGlobal("btoa", () => "ignored");

    vi.resetModules();
    const mod = await import("../../../js/agents/vfs/vfs.storage.js");
    const adapter = createMapAdapter();
    const vfs = new mod.StorageVfs(adapter, { keyPrefix: "t5:" });

    await adapter.set("t5:file:x.bin", { kind: "file", path: "x.bin", encoding: "base64", data: "Zg==", size: 1 });
    await expect(vfs.readFile("x.bin")).rejects.toThrow(/base64 decoding is unavailable/i);
  });
});
