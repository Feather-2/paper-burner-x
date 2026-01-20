import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/plugins/memory/l3-storage/utils.js", () => ({
  isMissingPathError: vi.fn(),
}));

import { createStorageIO } from "../../../../../../js/agents/plugins/memory/l3-storage/storage-io.js";
import { isMissingPathError } from "../../../../../../js/agents/plugins/memory/l3-storage/utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createMemoryVfs(options = {}) {
  const { withExists = true, withRename = true, withUnlink = true } = options;
  const store = new Map();
  const mkdir = vi.fn(async () => undefined);
  const writeFile = vi.fn(async (path, bytes) => {
    store.set(path, bytes);
  });
  const readFile = vi.fn(async (path) => {
    if (!store.has(path)) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return store.get(path);
  });
  const vfs = { store, mkdir, writeFile, readFile };
  if (withExists) {
    vfs.exists = vi.fn(async (path) => store.has(path));
  }
  if (withRename) {
    vfs.rename = vi.fn(async (from, to) => {
      if (!store.has(from)) {
        throw new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`);
      }
      const bytes = store.get(from);
      store.set(to, bytes);
      store.delete(from);
    });
  }
  if (withUnlink) {
    vfs.unlink = vi.fn(async (path) => {
      store.delete(path);
    });
  }
  return vfs;
}

function setJson(vfs, path, value) {
  vfs.store.set(path, encoder.encode(JSON.stringify(value)));
}

function setText(vfs, path, text) {
  vfs.store.set(path, encoder.encode(text));
}

function readJsonFromStore(vfs, path) {
  const bytes = vfs.store.get(path);
  if (!bytes) return null;
  return JSON.parse(decoder.decode(bytes));
}

describe("createStorageIO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMissingPathError).mockReturnValue(false);
  });

  it("builds paths and creates directories", async () => {
    const vfs = createMemoryVfs();
    const basePath = "/tmp/l3";
    const io = createStorageIO({ vfs, basePath });

    expect(io.snapshotsDir).toBe(`${basePath}/snapshots`);
    expect(io.checkpointsDir).toBe(`${basePath}/checkpoints`);
    expect(io.indexPath).toBe(`${basePath}/index.json`);
    expect(io.indexTmpPath).toBe(`${basePath}/index.json.tmp`);

    await io.ensureDirs();
    expect(vfs.mkdir).toHaveBeenCalledWith(basePath, { recursive: true });
    expect(vfs.mkdir).toHaveBeenCalledWith(`${basePath}/snapshots`, { recursive: true });
    expect(vfs.mkdir).toHaveBeenCalledWith(`${basePath}/checkpoints`, { recursive: true });
  });

  it("builds snapshot and checkpoint paths with trimmed ids", () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });

    expect(io.snapshotPath(" 123 ")).toBe("/base/snapshots/123.json");
    expect(io.checkpointPath(" ckpt ")).toBe("/base/checkpoints/ckpt.json");
  });

  it("rejects missing or non-string snapshot ids including boundary values", () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });

    const invalidIds = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, [], {}];
    for (const id of invalidIds) {
      expect(() => io.snapshotPath(id)).toThrow("snapshotId");
    }
  });

  it("rejects path traversal snapshot ids", () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });

    const traversalIds = ["..", "../a", "a/..", "a/b", "a\\b", "a..b"];
    for (const id of traversalIds) {
      expect(() => io.snapshotPath(id)).toThrow("path traversal attempt");
    }
  });

  it("builds checkpoint paths and rejects traversal attempts", () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });

    expect(io.checkpointPath("ok")).toBe("/base/checkpoints/ok.json");
    expect(() => io.checkpointPath("a/b")).toThrow("checkpointId");
  });

  it("readJson returns null when exists() is false", async () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });

    const result = await io.readJson(io.indexPath);
    expect(result).toBeNull();
    expect(vfs.readFile).not.toHaveBeenCalled();
  });

  it("readJson returns null on missing path errors", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    vi.mocked(isMissingPathError).mockReturnValue(true);

    const result = await io.readJson(io.indexPath);
    expect(result).toBeNull();
    expect(vfs.readFile).toHaveBeenCalledTimes(1);
  });

  it("readJson rethrows non-missing errors", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const err = new Error("boom");
    vfs.readFile = vi.fn(async () => {
      throw err;
    });

    await expect(io.readJson(io.indexPath)).rejects.toThrow("boom");
  });

  it("readJson returns null for invalid JSON", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    setText(vfs, io.indexPath, "{bad json");

    const result = await io.readJson(io.indexPath);
    expect(result).toBeNull();
  });

  it("readJson validates index shape and accepts empty arrays", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const indexData = { timeline: [], checkpointIndex: [], meta: {} };
    setJson(vfs, io.indexPath, indexData);

    const result = await io.readJson(io.indexPath);
    expect(result).toEqual(indexData);
  });

  it("readJson rejects index with invalid timeline type", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    setJson(vfs, io.indexPath, { timeline: {} });

    const result = await io.readJson(io.indexPath);
    expect(result).toBeNull();
  });

  it("readJson accepts index when checkpointIndex is invalid but checkpoints is array", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const indexData = { checkpointIndex: {}, checkpoints: [] };
    setJson(vfs, io.indexPath, indexData);

    const result = await io.readJson(io.indexPath);
    expect(result).toEqual(indexData);
  });

  it("readJson validates snapshot and checkpoint payloads", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const snapshotPath = io.snapshotPath("snap-1");
    const checkpointPath = io.checkpointPath("ckpt-1");

    const snapshotData = { id: "snap-1", payload: { ok: true } };
    const checkpointData = { id: "ckpt-1", size: 0 };
    setJson(vfs, snapshotPath, snapshotData);
    setJson(vfs, checkpointPath, checkpointData);

    expect(await io.readJson(snapshotPath)).toEqual(snapshotData);
    expect(await io.readJson(checkpointPath)).toEqual(checkpointData);

    setJson(vfs, snapshotPath, { id: "   " });
    setJson(vfs, checkpointPath, { id: null });
    expect(await io.readJson(snapshotPath)).toBeNull();
    expect(await io.readJson(checkpointPath)).toBeNull();
  });

  it("readJson returns raw value for non-index/snapshot/checkpoint paths", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const miscPath = "/base/misc.json";
    setJson(vfs, miscPath, []);

    const result = await io.readJson(miscPath);
    expect(result).toEqual([]);
  });

  it("writeJson writes encoded JSON", async () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });
    const path = "/base/custom.json";
    const value = { ok: true, items: [1, 2], empty: {} };

    await io.writeJson(path, value);
    expect(readJsonFromStore(vfs, path)).toEqual(value);
  });

  it("persistIndex writes atomically with rename", async () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });
    const serialized = { timeline: [], checkpointIndex: [] };

    await io.persistIndex(serialized);

    expect(vfs.writeFile).toHaveBeenCalledWith(io.indexTmpPath, expect.any(Uint8Array));
    expect(vfs.rename).toHaveBeenCalledWith(io.indexTmpPath, io.indexPath);
    expect(vfs.store.has(io.indexTmpPath)).toBe(false);
    expect(readJsonFromStore(vfs, io.indexPath)).toEqual(serialized);
  });

  it("persistIndex falls back without rename and ignores unlink errors", async () => {
    const vfs = createMemoryVfs({ withRename: false, withUnlink: true });
    vfs.unlink = vi.fn(async () => {
      throw new Error("unlink failed");
    });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const serialized = { checkpoints: [] };

    await io.persistIndex(serialized);

    expect(vfs.writeFile).toHaveBeenCalledWith(io.indexTmpPath, expect.any(Uint8Array));
    expect(vfs.writeFile).toHaveBeenCalledWith(io.indexPath, expect.any(Uint8Array));
    expect(readJsonFromStore(vfs, io.indexPath)).toEqual(serialized);
  });

  it("readIndexRaw recovers temp index files with rename", async () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });
    const tempData = { timeline: [], checkpointIndex: [] };
    setJson(vfs, io.indexTmpPath, tempData);

    const result = await io.readIndexRaw();
    expect(result).toEqual(tempData);
    expect(vfs.rename).toHaveBeenCalledWith(io.indexTmpPath, io.indexPath);
    expect(vfs.store.has(io.indexTmpPath)).toBe(false);
    expect(readJsonFromStore(vfs, io.indexPath)).toEqual(tempData);
  });

  it("readIndexRaw discards invalid temp index files", async () => {
    const vfs = createMemoryVfs();
    const io = createStorageIO({ vfs, basePath: "/base" });
    setText(vfs, io.indexTmpPath, "nope");

    const result = await io.readIndexRaw();
    expect(result).toBeNull();
    expect(vfs.unlink).toHaveBeenCalledWith(io.indexTmpPath);
  });

  it("supports concurrent readJson calls and rapid successive persistIndex calls", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const snapshotData = { id: "s1", payload: 0 };
    const checkpointData = { id: "c1", value: -1 };
    setJson(vfs, io.snapshotPath("s1"), snapshotData);
    setJson(vfs, io.checkpointPath("c1"), checkpointData);

    const [snapResult, checkpointResult] = await Promise.all([
      io.readJson(io.snapshotPath("s1")),
      io.readJson(io.checkpointPath("c1")),
    ]);
    expect(snapResult).toEqual(snapshotData);
    expect(checkpointResult).toEqual(checkpointData);

    await io.persistIndex({ version: 4 });
    await io.persistIndex({ version: 5 });
    expect(readJsonFromStore(vfs, io.indexPath)).toEqual({ version: 5 });
  });

  it("handles large payloads, long ids, and deep nesting", async () => {
    const vfs = createMemoryVfs({ withExists: false });
    const io = createStorageIO({ vfs, basePath: "/base" });
    const longId = "a".repeat(10000);
    const longPath = io.snapshotPath(longId);
    expect(longPath.endsWith(`${longId}.json`)).toBe(true);

    const largePayload = { id: "large", payload: "a".repeat(1024 * 1024) };
    setJson(vfs, io.snapshotPath("large"), largePayload);
    const largeResult = await io.readJson(io.snapshotPath("large"));
    expect(largeResult.payload.length).toBe(1024 * 1024);

    let deep = { level: 0 };
    for (let i = 0; i < 50; i += 1) {
      deep = { level: i + 1, next: deep };
    }
    const deepPayload = { id: "deep", data: deep };
    setJson(vfs, io.snapshotPath("deep"), deepPayload);
    const deepResult = await io.readJson(io.snapshotPath("deep"));
    expect(deepResult.data.level).toBe(50);
    expect(typeof deepResult.data.next).toBe("object");
  });
});
