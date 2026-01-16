import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { StorageVfs } from "../../js/agents/vfs/vfs.storage.js";

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
    assert.throws(() => new StorageVfs(null), /storageAdapter with get\/set\/delete\/keys is required/);
    assert.throws(() => new StorageVfs({}), /storageAdapter/);
    assert.throws(() => new StorageVfs({ get: () => {} }), /storageAdapter/);
    assert.throws(() => new StorageVfs({ get: () => {}, set: () => {} }), /storageAdapter/);
    assert.throws(() => new StorageVfs({ get: () => {}, set: () => {}, delete: () => {} }), /storageAdapter/);
  });

  it("creates instance with valid adapter", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter);
    assert.ok(vfs instanceof StorageVfs);
    assert.strictEqual(vfs.storageAdapter, adapter);
  });

  it("uses default keyPrefix when not provided", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter);
    assert.strictEqual(vfs._filePrefix, "pb_vfs:file:");
    assert.strictEqual(vfs._dirPrefix, "pb_vfs:dir:");
  });

  it("uses custom keyPrefix when provided", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "custom:" });
    assert.strictEqual(vfs._filePrefix, "custom:file:");
    assert.strictEqual(vfs._dirPrefix, "custom:dir:");
  });

  it("falls back to default keyPrefix for empty string", () => {
    const adapter = createMockStorageAdapter();
    const vfs = new StorageVfs(adapter, { keyPrefix: "" });
    assert.strictEqual(vfs._filePrefix, "pb_vfs:file:");
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
    assert.deepEqual(result, data);
  });

  it("writes and reads string data", async () => {
    await vfs.writeFile("test.txt", "hello world");
    const result = await vfs.readFile("test.txt");
    const text = new TextDecoder().decode(result);
    assert.equal(text, "hello world");
  });

  it("writes and reads JSON objects", async () => {
    const obj = { key: "value", num: 123 };
    await vfs.writeFile("data.json", obj);
    const result = await vfs.readFile("data.json");
    const parsed = JSON.parse(new TextDecoder().decode(result));
    assert.deepEqual(parsed, obj);
  });

  it("writes and reads arrays", async () => {
    const arr = [1, 2, 3];
    await vfs.writeFile("arr.json", arr);
    const result = await vfs.readFile("arr.json");
    const parsed = JSON.parse(new TextDecoder().decode(result));
    assert.deepEqual(parsed, arr);
  });

  it("handles null and undefined data", async () => {
    await vfs.writeFile("null.bin", null);
    const result1 = await vfs.readFile("null.bin");
    assert.equal(result1.length, 0);

    await vfs.writeFile("undef.bin", undefined);
    const result2 = await vfs.readFile("undef.bin");
    assert.equal(result2.length, 0);
  });

  it("handles ArrayBuffer data", async () => {
    const buffer = new ArrayBuffer(4);
    const view = new Uint8Array(buffer);
    view.set([10, 20, 30, 40]);
    await vfs.writeFile("buffer.bin", buffer);
    const result = await vfs.readFile("buffer.bin");
    assert.deepEqual(result, new Uint8Array([10, 20, 30, 40]));
  });

  it("handles DataView data", async () => {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint8(0, 1);
    view.setUint8(1, 2);
    await vfs.writeFile("view.bin", new Uint8Array(buffer));
    const result = await vfs.readFile("view.bin");
    assert.equal(result[0], 1);
    assert.equal(result[1], 2);
  });

  it("throws EISDIR for root path on writeFile", async () => {
    await assert.rejects(vfs.writeFile("", "data"), /EISDIR/);
    await assert.rejects(vfs.writeFile("/", "data"), /EISDIR/);
  });

  it("throws EISDIR for root path on readFile", async () => {
    await assert.rejects(vfs.readFile(""), /EISDIR/);
    await assert.rejects(vfs.readFile("/"), /EISDIR/);
  });

  it("throws ENOENT for non-existent file", async () => {
    await assert.rejects(vfs.readFile("nonexistent.txt"), /ENOENT/);
  });

  it("creates parent directories automatically", async () => {
    await vfs.writeFile("a/b/c/file.txt", "nested");
    const result = await vfs.readFile("a/b/c/file.txt");
    assert.equal(new TextDecoder().decode(result), "nested");

    // Check directories were created
    const stat = await vfs.stat("a/b/c");
    assert.equal(stat.isDirectory(), true);
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
    assert.equal(text, "hello");
  });

  it("handles non-string values in writeText", async () => {
    await vfs.writeText("num.txt", 123);
    assert.equal(await vfs.readText("num.txt"), "123");

    await vfs.writeText("null.txt", null);
    assert.equal(await vfs.readText("null.txt"), "");

    await vfs.writeText("undef.txt", undefined);
    assert.equal(await vfs.readText("undef.txt"), "");
  });

  it("throws EISDIR for root path on writeText", async () => {
    await assert.rejects(vfs.writeText("", "data"), /EISDIR/);
  });

  it("stores text with utf8 encoding", async () => {
    const adapter = createMockStorageAdapter();
    const vfs2 = new StorageVfs(adapter);
    await vfs2.writeText("text.txt", "hello");
    const record = adapter.get("pb_vfs:file:text.txt");
    assert.equal(record.encoding, "utf8");
    assert.equal(record.data, "hello");
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
    assert.equal(stat.isDirectory(), true);
  });

  it("returns true for root path", async () => {
    const result = await vfs.mkdir("");
    assert.equal(result, true);
  });

  it("throws ENOENT for non-recursive when parent missing", async () => {
    await assert.rejects(vfs.mkdir("missing/dir", { recursive: false }), /ENOENT/);
  });

  it("succeeds non-recursive when parent exists", async () => {
    await vfs.mkdir("parent");
    await vfs.mkdir("parent/child", { recursive: false });
    const stat = await vfs.stat("parent/child");
    assert.equal(stat.isDirectory(), true);
  });
});

describe("StorageVfs - rmdir", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("throws EPERM when removing root", async () => {
    await assert.rejects(vfs.rmdir(""), /EPERM/);
    await assert.rejects(vfs.rmdir("/"), /EPERM/);
  });

  it("throws ENOTEMPTY for non-empty dir without recursive", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await assert.rejects(vfs.rmdir("dir", { recursive: false }), /ENOTEMPTY/);
  });

  it("removes empty directory", async () => {
    await vfs.mkdir("emptydir");
    await vfs.rmdir("emptydir");
    assert.equal(await vfs.exists("emptydir"), false);
  });

  it("removes directory recursively", async () => {
    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/sub/b.txt", "b");
    await vfs.rmdir("dir", { recursive: true });
    assert.equal(await vfs.exists("dir"), false);
    assert.equal(await vfs.exists("dir/a.txt"), false);
    assert.equal(await vfs.exists("dir/sub/b.txt"), false);
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
    assert.equal(await vfs.exists("file.txt"), false);
  });

  it("throws EISDIR for root path", async () => {
    await assert.rejects(vfs.unlink(""), /EISDIR/);
  });

  it("throws ENOENT for non-existent file", async () => {
    await assert.rejects(vfs.unlink("missing.txt"), /ENOENT/);
  });
});

describe("StorageVfs - stat", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("returns directory stat for root", async () => {
    const stat = await vfs.stat("");
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isFile(), false);
    assert.equal(stat.size, 0);
  });

  it("returns file stat with size and mtime", async () => {
    await vfs.writeText("file.txt", "hello");
    const stat = await vfs.stat("file.txt");
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isDirectory(), false);
    assert.ok(stat.size > 0);
    assert.ok(stat.mtimeMs > 0);
  });

  it("returns directory stat", async () => {
    await vfs.mkdir("mydir");
    const stat = await vfs.stat("mydir");
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isFile(), false);
  });

  it("infers directory from children", async () => {
    await vfs.writeText("implicit/file.txt", "content");
    const stat = await vfs.stat("implicit");
    assert.equal(stat.isDirectory(), true);
  });

  it("throws ENOENT for non-existent path", async () => {
    await assert.rejects(vfs.stat("nonexistent"), /ENOENT/);
  });
});

describe("StorageVfs - exists", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("returns true for root", async () => {
    assert.equal(await vfs.exists(""), true);
  });

  it("returns true for existing file", async () => {
    await vfs.writeText("file.txt", "content");
    assert.equal(await vfs.exists("file.txt"), true);
  });

  it("returns false for non-existent path", async () => {
    assert.equal(await vfs.exists("missing.txt"), false);
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
    assert.deepEqual(names, ["a.txt", "b.txt"]);
  });

  it("lists with file types", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await vfs.mkdir("dir/subdir");
    const entries = await vfs.readdir("dir", { withFileTypes: true });
    assert.equal(entries.length, 2);

    const fileEntry = entries.find((e) => e.name === "file.txt");
    assert.equal(fileEntry.isFile(), true);
    assert.equal(fileEntry.isDirectory(), false);

    const dirEntry = entries.find((e) => e.name === "subdir");
    assert.equal(dirEntry.isDirectory(), true);
    assert.equal(dirEntry.isFile(), false);
  });

  it("lists root directory", async () => {
    await vfs.writeText("root.txt", "root");
    await vfs.writeText("dir/nested.txt", "nested");
    const names = await vfs.readdir("");
    assert.ok(names.includes("root.txt"));
    assert.ok(names.includes("dir"));
  });

  it("infers directory from nested files", async () => {
    await vfs.writeText("parent/child/file.txt", "content");
    const entries = await vfs.readdir("parent", { withFileTypes: true });
    const childEntry = entries.find((e) => e.name === "child");
    assert.ok(childEntry);
    assert.equal(childEntry.isDirectory(), true);
  });

  it("throws ENOENT for non-existent directory", async () => {
    await assert.rejects(vfs.readdir("nonexistent"), /ENOENT/);
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
    assert.ok(Array.isArray(items));

    const fileItem = items.find((i) => i.name === "file.txt");
    assert.equal(fileItem.kind, "file");

    const dirItem = items.find((i) => i.name === "sub");
    assert.equal(dirItem.kind, "dir");
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
    assert.equal(await vfs.readText("dst.txt"), "content");
    assert.equal(await vfs.exists("src.txt"), true);
  });

  it("throws EISDIR for root as source", async () => {
    await assert.rejects(vfs.copy("", "dst.txt"), /EISDIR/);
  });

  it("throws EISDIR for root as destination", async () => {
    await vfs.writeText("src.txt", "content");
    await assert.rejects(vfs.copy("src.txt", ""), /EISDIR/);
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
    assert.equal(await vfs.readText("dst.txt"), "content");
    assert.equal(await vfs.exists("src.txt"), false);
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
    assert.equal(await vfs.readText("new.txt"), "content");
    assert.equal(await vfs.exists("old.txt"), false);
  });

  it("throws EISDIR for root as source", async () => {
    await assert.rejects(vfs.rename("", "dst.txt"), /EISDIR/);
  });

  it("throws EISDIR for root as destination", async () => {
    await vfs.writeText("src.txt", "content");
    await assert.rejects(vfs.rename("src.txt", ""), /EISDIR/);
  });

  it("throws ENOENT for non-existent source", async () => {
    await assert.rejects(vfs.rename("missing.txt", "dst.txt"), /ENOENT/);
  });
});

describe("StorageVfs - rm", () => {
  let vfs;

  beforeEach(() => {
    vfs = new StorageVfs(createMockStorageAdapter());
  });

  it("throws EPERM when removing root", async () => {
    await assert.rejects(vfs.rm(""), /EPERM/);
  });

  it("removes file", async () => {
    await vfs.writeText("file.txt", "content");
    await vfs.rm("file.txt");
    assert.equal(await vfs.exists("file.txt"), false);
  });

  it("removes directory recursively", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await vfs.rm("dir", { recursive: true });
    assert.equal(await vfs.exists("dir"), false);
  });

  it("throws ENOTEMPTY for non-recursive on non-empty dir", async () => {
    await vfs.writeText("dir/file.txt", "content");
    await assert.rejects(vfs.rm("dir", { recursive: false }), /ENOTEMPTY/);
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
    assert.deepEqual(files.sort(), ["a.txt", "dir/b.txt", "dir/sub/c.txt"]);
  });

  it("lists files with prefix", async () => {
    await vfs.writeText("a.txt", "a");
    await vfs.writeText("dir/b.txt", "b");
    const files = await vfs.listFiles({ prefix: "dir" });
    assert.deepEqual(files, ["dir/b.txt"]);
  });

  it("lists files non-recursively", async () => {
    await vfs.writeText("dir/a.txt", "a");
    await vfs.writeText("dir/sub/b.txt", "b");
    const files = await vfs.listFiles({ prefix: "dir", recursive: false });
    assert.deepEqual(files, ["dir/a.txt"]);
  });

  it("returns single file when prefix is a file path", async () => {
    await vfs.writeText("file.txt", "content");
    const files = await vfs.listFiles({ prefix: "file.txt" });
    assert.deepEqual(files, ["file.txt"]);
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
    assert.deepEqual(files.sort(), ["a.txt", "b.txt"]);
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
    assert.equal(new TextDecoder().decode(bytes), "manual content");
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
    assert.equal(new TextDecoder().decode(bytes), "hello");
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
    assert.equal(new TextDecoder().decode(bytes), "hello");
  });

  it("throws EISDIR when record has directory kind", async () => {
    adapter.set("pb_vfs:file:fakedir", {
      kind: "directory",
      path: "fakedir",
    });
    await assert.rejects(vfs.readFile("fakedir"), /EISDIR/);
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
    assert.equal(stat.isFile(), true);
    assert.equal(stat.size, 0); // fallback
  });

  it("handles missing mtimeMs in directory record", async () => {
    adapter.set("pb_vfs:dir:nomtime", {
      kind: "dir",
      path: "nomtime",
    });
    const stat = await vfs.stat("nomtime");
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.size, 0);
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
    assert.equal(stat.size, 0);
    assert.ok(!("mtimeMs" in stat) || stat.mtimeMs === undefined);
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
    assert.equal(await vfs.readText("file.txt"), "content");
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
    assert.ok(files.includes("file.txt"));

    const entries = await vfs.readdir("");
    assert.ok(entries.includes("file.txt"));
  });
});

describe("StorageVfs - _getFileRecord edge cases", () => {
  it("returns null for non-object record", async () => {
    const adapter = createMockStorageAdapter();
    adapter.set("pb_vfs:file:bad", "not an object");
    const vfs = new StorageVfs(adapter);
    await assert.rejects(vfs.readFile("bad"), /ENOENT/);
  });
});
