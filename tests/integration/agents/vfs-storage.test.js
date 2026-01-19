
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { StorageVfs } from '../../../js/agents/vfs/vfs.storage.js';

/**
 * Mock storage adapter implementing get/set/delete/keys/has interface.
 */
function createMockStorageAdapter() {
  const store = new Map();
  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
    },
    delete(key) {
      const had = store.has(key);
      store.delete(key);
      return had;
    },
    keys() {
      return Array.from(store.keys());
    },
    has(key) {
      return store.has(key);
    },
    _store: store, // expose for inspection
  };
}

describe("StorageVfs - constructor", () => {
  it("throws if adapter is missing required methods", () => {
    expect(() => new StorageVfs(null)).toThrow(/storageAdapter with get\/set\/delete\/keys is required/);
    expect(() => new StorageVfs({})).toThrow(/storageAdapter/);
    expect(() => new StorageVfs({ get: () => {} })).toThrow(/storageAdapter/);
    expect(() => new StorageVfs({ get: () => {}, set: () => {} })).toThrow(/storageAdapter/);
    expect(() => new StorageVfs({ get: () => {}, set: () => {}, delete: () => {} })).toThrow(/storageAdapter/);
  });

  it("creates instance with valid adapter", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter);
    expect(vfs).toBeInstanceOf(StorageVfs);
    expect(vfs.storageAdapter).toBe(adapter);
  });

  it("uses default keyPrefix when not provided", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter);
    expect(vfs._filePrefix).toBe("pb_vfs:file:");
    expect(vfs._dirPrefix).toBe("pb_vfs:dir:");
  });

  it("uses custom keyPrefix when provided", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "custom:" });
    expect(vfs._filePrefix).toBe("custom:file:");
    expect(vfs._dirPrefix).toBe("custom:dir:");
  });

  it("falls back to default keyPrefix for empty string", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "" });
    expect(vfs._filePrefix).toBe("pb_vfs:file:");
  });
});

describe("StorageVfs - writeFile and readFile", () => {
  let adapter;
  let vfs;

  beforeEach(() => {
    adapter = createMockStorageAdapter();
    vfs = new StorageVfs(adapter);
  });

  it("writes and reads binary data", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await vfs.writeFile("test.bin", data);
    const result = await vfs.readFile("test.bin");
    expect(result).toEqual(data);
  });

  it("writes and reads string data", async () => {
    await vfs.writeFile("test.txt", "hello world");
    const result = await vfs.readFile("test.txt");
    const text = new TextDecoder().decode(result);
    expect(text).toBe("hello world");
  });

  it("writes and reads JSON objects", async () => {
    const obj = { key: "value", num: 123 };
    await vfs.writeFile("data.json", obj);
    const result = await vfs.readFile("data.json");
    const parsed = JSON.parse(new TextDecoder().decode(result));
    expect(parsed).toEqual(obj);
  });

  it("writes and reads arrays", async () => {
    const arr = [1, 2, 3];
    await vfs.writeFile("arr.json", arr);
    const result = await vfs.readFile("arr.json");
    const parsed = JSON.parse(new TextDecoder().decode(result));
    expect(parsed).toEqual(arr);
  });

  it("handles null and undefined data", async () => {
    await vfs.writeFile("null.bin", null);
    const result1 = await vfs.readFile("null.bin");
    expect(result1.length).toBe(0);

    await vfs.writeFile("undef.bin", undefined);
    const result2 = await vfs.readFile("undef.bin");
    expect(result2.length).toBe(0);
  });

  it("handles ArrayBuffer data", async () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view.set([10, 20, 30, 40]);
    await vfs.writeFile("buffer.bin", buffer);
    const result = await vfs.readFile("buffer.bin");
    expect(result).toEqual(new Uint8Array([10, 20, 30, 40]));
  });

  it("handles DataView data", async () => {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint8(0, 1);
    view.setUint8(1, 2);
    await vfs.writeFile("view.bin", new Uint8Array(buffer));
    const result = await vfs.readFile("view.bin");
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
  });

  it("throws EISDIR for root path on writeFile", async () => {
    await expect(vfs.writeFile("", "data")).rejects.toThrow(/EISDIR/);
    await expect(vfs.writeFile("/", "data")).rejects.toThrow(/EISDIR/);
  });

  it("throws EISDIR for root path on readFile", async () => {
    await expect(vfs.readFile("")).rejects.toThrow(/EISDIR/);
    await expect(vfs.readFile("/")).rejects.toThrow(/EISDIR/);
  });

  it("throws ENOENT for non-existent file", async () => {
    await expect(vfs.readFile("nonexistent.txt")).rejects.toThrow(/ENOENT/);
  });

  it("creates parent directories automatically", async () => {
    await vfs.writeFile("a/b/c/file.txt", "nested");
    const result = await vfs.readFile("a/b/c/file.txt");
    expect(new TextDecoder().decode(result)).toBe("nested");

    // Check directories were created
    const stat = await vfs.stat("a/b/c");
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("StorageVfs - writeText and readText", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("writes and reads text", async () => {
    await vfs.writeText("file.txt", "hello");
    const text = await vfs.readText("file.txt");
    expect(text).toBe("hello");
  });

  it("handles non-string values in writeText", async () => {
    await vfs.writeText("num.txt", 123);
    expect(await vfs.readText("num.txt")).toBe("123");

    await vfs.writeText("null.txt", null);
    expect(await vfs.readText("null.txt")).toBe("");

    await vfs.writeText("undef.txt", undefined);
    expect(await vfs.readText("undef.txt")).toBe("");
  });

  it("throws EISDIR for root path on writeText", async () => {
    await expect(vfs.writeText("", "data")).rejects.toThrow(/EISDIR/);
  });

  it("stores text with utf8 encoding", async () => {
    const adapter = createMockStorageAdapter();
    const vfs2 = new StorageVfs(adapter);
    await vfs2.writeText("text.txt", "hello");
    const record = adapter.get("pb_vfs:file:text.txt");
    expect(record.encoding).toBe("utf8");
    expect(record.data).toBe("hello");
  });
});

describe("StorageVfs - mkdir", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("creates directory recursively by default", async () => {
    await vfs.mkdir("a/b/c");
    const stat = await vfs.stat("a/b/c");
    expect(stat.isDirectory()).toBe(true);
  });

  it("returns true for root path", async () => {
    const result = await vfs.mkdir("");
    expect(result).toBe(true);
  });

  it("throws ENOENT for non-recursive when parent missing", async () => {
    await expect(vfs.mkdir("missing/dir", { recursive: false })).rejects.toThrow(/ENOENT/);
  });

  it("succeeds non-recursive when parent exists", async () => {
    await vfs.mkdir("parent");
    await vfs.mkdir("parent/child", { recursive: false });
    const stat = await vfs.stat("parent/child");
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("StorageVfs - rmdir", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("throws EPERM when removing root", async () => {
    await expect(vfs.rmdir("")).rejects.toThrow(/EPERM/);
    await expect(vfs.rmdir("/")).rejects.toThrow(/EPERM/);
  });

  it("throws ENOTEMPTY for non-empty dir without recursive", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await expect(vfs.rmdir("dir", { recursive: false })).rejects.toThrow(/ENOTEMPTY/);
  });

  it("removes empty directory", async () => {
    await vfs.mkdir("emptydir");
    await vfs.rmdir("emptydir");
    expect(await vfs.exists("emptydir")).toBe(false);
  });

  it("removes directory recursively", async () => {
    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/sub/b.txt", "b");
    await vfs.rmdir("dir", { recursive: true });
    expect(await vfs.exists("dir")).toBe(false);
    expect(await vfs.exists("dir/a.txt")).toBe(false);
    expect(await vfs.exists("dir/sub/b.txt")).toBe(false);
  });
});

describe("StorageVfs - unlink", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("deletes existing file", async () => {
    await vfs.writeText("file.txt", "content");
    await vfs.unlink("file.txt");
    expect(await vfs.exists("file.txt")).toBe(false);
  });

  it("throws EISDIR for root path", async () => {
    await expect(vfs.unlink("")).rejects.toThrow(/EISDIR/);
  });

  it("throws ENOENT for non-existent file", async () => {
    await expect(vfs.unlink("missing.txt")).rejects.toThrow(/ENOENT/);
  });
});

describe("StorageVfs - stat", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("returns directory stat for root", async () => {
    const stat = await vfs.stat("");
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isFile()).toBe(false);
    expect(stat.size).toBe(0);
  });

  it("returns file stat with size and mtime", async () => {
    await vfs.writeText("file.txt", "hello");
    const stat = await vfs.stat("file.txt");
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.size).toBeGreaterThan(0);
    expect(stat.mtimeMs).toBeGreaterThan(0);
  });

  it("returns directory stat", async () => {
    await vfs.mkdir("mydir");
    const stat = await vfs.stat("mydir");
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isFile()).toBe(false);
  });

  it("infers directory from children", async () => {
    await vfs.writeText("implicit/file.txt", "content");
    const stat = await vfs.stat("implicit");
    expect(stat.isDirectory()).toBe(true);
  });

  it("throws ENOENT for non-existent path", async () => {
    await expect(vfs.stat("nonexistent")).rejects.toThrow(/ENOENT/);
  });
});

describe("StorageVfs - exists", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("returns true for root", async () => {
    expect(await vfs.exists("")).toBe(true);
  });

  it("returns true for existing file", async () => {
    await vfs.writeText("file.txt", "content");
    expect(await vfs.exists("file.txt")).toBe(true);
  });

  it("returns false for non-existent path", async () => {
    expect(await vfs.exists("missing.txt")).toBe(false);
  });
});

describe("StorageVfs - readdir", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("lists files in directory", async () => {
    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/b.txt", "b");
    const names = await vfs.readdir("dir");
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  it("lists with file types", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await vfs.mkdir("dir/subdir");
    const entries = await vfs.readdir("dir", { withFileTypes: true });
    expect(entries.length).toBe(2);

    const fileEntry = entries.find((e) => e.name === "file.txt");
    expect(fileEntry.isFile()).toBe(true);
    expect(fileEntry.isDirectory()).toBe(false);

    const dirEntry = entries.find((e) => e.name === "subdir");
    expect(dirEntry.isDirectory()).toBe(true);
    expect(dirEntry.isFile()).toBe(false);
  });

  it("lists root directory", async () => {
    await vfs.writeText("root.txt", "root");
    await vfs.writeText("dir/nested.txt", "nested");
    const names = await vfs.readdir("");
    expect(names).toContain("root.txt");
    expect(names).toContain("dir");
  });

  it("infers directory from nested files", async () => {
    await vfs.writeText("parent/child/file.txt", "content");
    const entries = await vfs.readdir("parent", { withFileTypes: true });
    const childEntry = entries.find((e) => e.name === "child");
    expect(childEntry).toBeDefined();
    expect(childEntry.isDirectory()).toBe(true);
  });

  it("throws ENOENT for non-existent directory", async () => {
    await expect(vfs.readdir("nonexistent")).rejects.toThrow(/ENOENT/);
  });
});

describe("StorageVfs - list (legacy)", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("returns array with name and kind", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await vfs.mkdir("dir/sub");
    const items = await vfs.list("dir");
    expect(items).toBeInstanceOf(Array);

    const fileItem = items.find((i) => i.name === "file.txt");
    expect(fileItem.kind).toBe("file");

    const dirItem = items.find((i) => i.name === "sub");
    expect(dirItem.kind).toBe("dir");
  });
});

describe("StorageVfs - copy", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("copies file content", async () => {
    await vfs.writeText("src.txt", "content");
    await vfs.copy("src.txt", "dst.txt");
    expect(await vfs.readText("dst.txt")).toBe("content");
    expect(await vfs.exists("src.txt")).toBe(true);
  });

  it("throws EISDIR for root as source", async () => {
    await expect(vfs.copy("", "dst.txt")).rejects.toThrow(/EISDIR/);
  });

  it("throws EISDIR for root as destination", async () => {
    await vfs.writeText("src.txt", "content");
    await expect(vfs.copy("src.txt", "")).rejects.toThrow(/EISDIR/);
  });
});

describe("StorageVfs - move", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("moves file (copy + unlink)", async () => {
    await vfs.writeText("src.txt", "content");
    await vfs.move("src.txt", "dst.txt");
    expect(await vfs.readText("dst.txt")).toBe("content");
    expect(await vfs.exists("src.txt")).toBe(false);
  });
});

describe("StorageVfs - rename", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("renames file", async () => {
    await vfs.writeText("old.txt", "content");
    await vfs.rename("old.txt", "new.txt");
    expect(await vfs.readText("new.txt")).toBe("content");
    expect(await vfs.exists("old.txt")).toBe(false);
  });

  it("throws EISDIR for root as source", async () => {
    await expect(vfs.rename("", "dst.txt")).rejects.toThrow(/EISDIR/);
  });

  it("throws EISDIR for root as destination", async () => {
    await vfs.writeText("src.txt", "content");
    await expect(vfs.rename("src.txt", "")).rejects.toThrow(/EISDIR/);
  });

  it("throws ENOENT for non-existent source", async () => {
    await expect(vfs.rename("missing.txt", "dst.txt")).rejects.toThrow(/ENOENT/);
  });
});

describe("StorageVfs - rm", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("throws EPERM when removing root", async () => {
    await expect(vfs.rm("")).rejects.toThrow(/EPERM/);
  });

  it("removes file", async () => {
    await vfs.writeText("file.txt", "content");
    await vfs.rm("file.txt");
    expect(await vfs.exists("file.txt")).toBe(false);
  });

  it("removes directory recursively", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await vfs.rm("dir", { recursive: true });
    expect(await vfs.exists("dir")).toBe(false);
  });

  it("throws ENOTEMPTY for non-recursive on non-empty dir", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await expect(vfs.rm("dir", { recursive: false })).rejects.toThrow(/ENOTEMPTY/);
  });
});

describe("StorageVfs - listFiles", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("lists all files recursively", async () => {
    await vfs.writeText("a.txt", "a");
    await vfs.writeText("dir/b.txt", "b");
    await vfs.writeText("dir/sub/c.txt", "c");
    const files = await vfs.listFiles({});
    expect(files.sort()).toEqual(["a.txt", "dir/b.txt", "dir/sub/c.txt"]);
  });

  it("lists files with prefix", async () => {
    await vfs.writeText("a.txt", "a");
    await vfs.writeText("dir/b.txt", "b");
    const files = await vfs.listFiles({ prefix: "dir" });
    expect(files).toEqual(["dir/b.txt"]);
  });

  it("lists files non-recursively", async () => {
    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/sub/b.txt", "b");
    const files = await vfs.listFiles({ prefix: "dir", recursive: false });
    expect(files).toEqual(["dir/a.txt"]);
  });

  it("returns single file when prefix is a file path", async () => {
    await vfs.writeText("file.txt", "content");
    const files = await vfs.listFiles({ prefix: "file.txt" });
    expect(files).toEqual(["file.txt"]);
  });
});

describe("StorageVfs - walkFiles", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("yields files as async iterator", async () => {
    await vfs.writeText("a.txt", "a");
    await vfs.writeText("b.txt", "b");
    const files = [];
    for await (const f of vfs.walkFiles({})) {
      files.push(f);
    }
    expect(files.sort()).toEqual(["a.txt", "b.txt"]);
  });
});

describe("StorageVfs - encoding edge cases", () => {
  let adapter;
  let vfs;

  beforeEach(() => {
    adapter = createMockStorageAdapter();
    vfs = new StorageVfs(adapter);
  });

  it("reads utf8 encoded record", async () => {
    // Manually set a utf8-encoded record
    adapter.set("pb_vfs:file:manual.txt", {
      kind: "file",
      path: "manual.txt",
      encoding: "utf8",
      data: "manual content",
      size: 14,
      mtimeMs: Date.now(),
    });
    const bytes = await vfs.readFile("manual.txt");
    expect(new TextDecoder().decode(bytes)).toBe("manual content");
  });

  it("reads base64 encoded record", async () => {
    // "hello" in base64 is "aGVsbG8="
    adapter.set("pb_vfs:file:b64.txt", {
      kind: "file",
      path: "b64.txt",
      encoding: "base64",
      data: "aGVsbG8=",
      size: 5,
      mtimeMs: Date.now(),
    });
    const bytes = await vfs.readFile("b64.txt");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("reads record without encoding (falls back to base64)", async () => {
    adapter.set("pb_vfs:file:noenc.txt", {
      kind: "file",
      path: "noenc.txt",
      data: "aGVsbG8=",
      size: 5,
      mtimeMs: Date.now(),
    });
    const bytes = await vfs.readFile("noenc.txt");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("throws EISDIR when record has directory kind", async () => {
    adapter.set("pb_vfs:file:fakedir", {
      kind: "directory",
      path: "fakedir",
    });
    await expect(vfs.readFile("fakedir")).rejects.toThrow(/EISDIR/);
  });
});

describe("StorageVfs - stat edge cases", () => {
  let adapter;
  let vfs;

  beforeEach(() => {
    adapter = createMockStorageAdapter();
    vfs = new StorageVfs(adapter);
  });

  it("handles missing size/mtimeMs in file record", async () => {
    adapter.set("pb_vfs:file:nosize.txt", {
      kind: "file",
      path: "nosize.txt",
      encoding: "utf8",
      data: "test",
    });
    const stat = await vfs.stat("nosize.txt");
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0); // fallback
  });

  it("handles missing mtimeMs in directory record", async () => {
    adapter.set("pb_vfs:dir:nomtime", {
      kind: "dir",
      path: "nomtime",
    });
    const stat = await vfs.stat("nomtime");
    expect(stat.isDirectory()).toBe(true);
    expect(stat.size).toBe(0);
  });

  it("handles non-finite size/mtimeMs values", async () => {
    adapter.set("pb_vfs:file:badnums.txt", {
      kind: "file",
      path: "badnums.txt",
      encoding: "utf8",
      data: "test",
      size: NaN,
      mtimeMs: Infinity,
    });
    const stat = await vfs.stat("badnums.txt");
    expect(stat.size).toBe(0);
    expect(stat.mtimeMs).toBeUndefined();
  });
});

describe("StorageVfs - adapter without has method", () => {
  it("works when adapter lacks has() method", async () => {
    const store = new Map();
    const adapter = {
      get(key) {
        return store.get(key);
      },
      set(key, value) {
        store.set(key, value);
      },
      delete(key) {
        const had = store.has(key);
        store.delete(key);
        return had;
      },
      keys() {
        return Array.from(store.keys());
      },
      // no has() method
    };
    const vfs = new StorageVfs(adapter);
    await vfs.writeText("file.txt", "content");
    expect(await vfs.readText("file.txt")).toBe("content");
  });
});

describe("StorageVfs - keys iteration edge cases", () => {
  it("handles empty/null keys in iteration", async () => {
    const store = new Map();
    store.set("", "empty");
    store.set(null, "null");
    const adapter = {
      get(key) {
        return store.get(key);
      },
      set(key, value) {
        store.set(key, value);
      },
      delete(key) {
        return store.delete(key);
      },
      keys() {
        return Array.from(store.keys());
      },
    };
    const vfs = new StorageVfs(adapter);
    await vfs.writeText("file.txt", "content");

    // These should not throw despite malformed keys
    const files = await vfs.listFiles({});
    expect(files).toContain("file.txt");

    const entries = await vfs.readdir("");
    expect(entries).toContain("file.txt");
  });
});

describe("StorageVfs - _getFileRecord edge cases", () => {
  it("returns null for non-object record", async () => {
    const adapter = createMockStorageAdapter();
    adapter.set("pb_vfs:file:bad", "not an object");
    const vfs = new StorageVfs(adapter);
    await expect(vfs.readFile("bad")).rejects.toThrow(/ENOENT/);
  });
});
