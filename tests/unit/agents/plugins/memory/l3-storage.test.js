/**
 * @file tests/unit/agents/plugins/memory/l3-storage.test.js
 * @description Unit tests for L3Storage and createL3Storage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  return {
    ...actual,
    createLogger: vi.fn(() => logger),
    __logger: logger,
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/hash.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/hash.js");
  return {
    ...actual,
    computeContentHash: vi.fn(actual.computeContentHash),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/index-manager.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/index-manager.js");
  return {
    ...actual,
    addSnapshotToIndex: vi.fn(actual.addSnapshotToIndex),
    createIndexState: vi.fn(actual.createIndexState),
    estimateStorageBytes: vi.fn(actual.estimateStorageBytes),
    getSupersededSnapshotCount: vi.fn(actual.getSupersededSnapshotCount),
    markSnapshotSupersededInIndex: vi.fn(actual.markSnapshotSupersededInIndex),
    markSnapshotsSupersededInIndex: vi.fn(actual.markSnapshotsSupersededInIndex),
    removeSnapshotFromIndex: vi.fn(actual.removeSnapshotFromIndex),
    restoreIndexState: vi.fn(actual.restoreIndexState),
    serializeIndexState: vi.fn(actual.serializeIndexState),
    updateSnapshotAccess: vi.fn(actual.updateSnapshotAccess),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/query.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/query.js");
  return {
    ...actual,
    getTimeline: vi.fn(actual.getTimeline),
    getSupersededTimeline: vi.fn(actual.getSupersededTimeline),
    isDuplicate: vi.fn(actual.isDuplicate),
    searchByKeyword: vi.fn(actual.searchByKeyword),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/storage-io.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/storage-io.js");
  return {
    ...actual,
    createStorageIO: vi.fn(actual.createStorageIO),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/tab-coordinator.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/tab-coordinator.js");
  return {
    ...actual,
    decodeTabCoordinatorSession: vi.fn(actual.decodeTabCoordinatorSession),
    encodeTabCoordinatorSession: vi.fn(actual.encodeTabCoordinatorSession),
    ensureTabCoordinatorHooks: vi.fn(actual.ensureTabCoordinatorHooks),
    releaseTabCoordinatorHooks: vi.fn(actual.releaseTabCoordinatorHooks),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/utils.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/plugins/memory/l3-storage/utils.js");
  return {
    ...actual,
    getSummary: vi.fn(actual.getSummary),
    normalizeKeywords: vi.fn(actual.normalizeKeywords),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    validateRunId: vi.fn(actual.validateRunId),
  };
});

import { L3Storage, createL3Storage } from "../../../../../js/agents/plugins/memory/l3-storage.js";
import { DEFAULT_MAX_SNAPSHOTS, DEFAULT_MAX_STORAGE_BYTES } from "../../../../../js/agents/plugins/memory/l3-storage/constants.js";
import { __logger } from "../../../../../js/agents/shared/index.js";
import { computeContentHash } from "../../../../../js/agents/plugins/memory/l3-storage/hash.js";
import {
  addSnapshotToIndex,
  estimateStorageBytes,
  getSupersededSnapshotCount,
  markSnapshotSupersededInIndex,
  markSnapshotsSupersededInIndex,
  removeSnapshotFromIndex,
  restoreIndexState,
  serializeIndexState,
  updateSnapshotAccess,
} from "../../../../../js/agents/plugins/memory/l3-storage/index-manager.js";
import { getSupersededTimeline, getTimeline, isDuplicate as isDuplicateQuery, searchByKeyword } from "../../../../../js/agents/plugins/memory/l3-storage/query.js";
import { createStorageIO } from "../../../../../js/agents/plugins/memory/l3-storage/storage-io.js";
import {
  encodeTabCoordinatorSession,
  ensureTabCoordinatorHooks,
  releaseTabCoordinatorHooks,
} from "../../../../../js/agents/plugins/memory/l3-storage/tab-coordinator.js";
import { getSummary, normalizeKeywords, validateRunId } from "../../../../../js/agents/plugins/memory/l3-storage/utils.js";

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

function readJson(vfs, path) {
  const bytes = vfs.store.get(path);
  if (!bytes) return null;
  return JSON.parse(decoder.decode(bytes));
}

function createDeepObject(depth) {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }
  return root;
}

function createStorage(options = {}) {
  const vfs = options.vfs || createMemoryVfs();
  const runId = options.runId ?? "run-1";
  const storage = new L3Storage({ vfs, runId, ...options });
  return { storage, vfs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("L3Storage", () => {
  it("constructs with defaults and wires storage IO", () => {
    const vfs = createMemoryVfs();
    const storage = new L3Storage({ vfs, runId: "run-1" });

    expect(storage._basePath).toBe(".agents/runs/run-1/l3");
    expect(storage._deduplicateByDefault).toBe(true);
    expect(storage._maxSnapshots).toBe(DEFAULT_MAX_SNAPSHOTS);
    expect(storage._maxStorageBytes).toBe(DEFAULT_MAX_STORAGE_BYTES);
    expect(storage._initialized).toBe(false);
    expect(createStorageIO).toHaveBeenCalledWith({ vfs, basePath: ".agents/runs/run-1/l3" });
  });

  it("rejects invalid runId inputs", () => {
    const vfs = createMemoryVfs();
    const invalidRunIds = [null, undefined, "", "   ", "../x", "a/b", "a\\b", 0, -1, Number.MAX_SAFE_INTEGER];

    for (const runId of invalidRunIds) {
      expect(() => new L3Storage({ vfs, runId })).toThrow();
    }

    expect(validateRunId).toHaveBeenCalled();
  });

  it("rejects missing vfs or required vfs methods", () => {
    const invalidVfsValues = [null, undefined, "", 0, -1];
    for (const vfs of invalidVfsValues) {
      expect(() => new L3Storage({ vfs, runId: "run-1" })).toThrow("vfs");
    }

    const missingRead = { writeFile: vi.fn(), mkdir: vi.fn() };
    expect(() => new L3Storage({ vfs: missingRead, runId: "run-1" })).toThrow("readFile");

    const missingWrite = { readFile: vi.fn(), mkdir: vi.fn() };
    expect(() => new L3Storage({ vfs: missingWrite, runId: "run-1" })).toThrow("writeFile");

    const missingMkdir = { readFile: vi.fn(), writeFile: vi.fn() };
    expect(() => new L3Storage({ vfs: missingMkdir, runId: "run-1" })).toThrow("mkdir");
  });

  it("normalizes cache sizes and eviction limits", () => {
    const vfs = createMemoryVfs();
    const storage = new L3Storage({
      vfs,
      runId: "run-1",
      cacheSize: 0,
      checkpointCacheSize: 0,
      maxSnapshots: "5",
      maxStorageBytes: -1,
    });

    storage._snapshotCache.set("a", { id: "a" });
    storage._snapshotCache.set("b", { id: "b" });
    expect(storage._snapshotCache.get("a")).toBeUndefined();

    storage._checkpointCache.set("c", { id: "c" });
    storage._checkpointCache.set("d", { id: "d" });
    expect(storage._checkpointCache.get("c")).toBeUndefined();

    expect(storage._maxSnapshots).toBe(DEFAULT_MAX_SNAPSHOTS);
    expect(storage._maxStorageBytes).toBe(DEFAULT_MAX_STORAGE_BYTES);
  });

  it("initializes once and sets up storage", async () => {
    const { storage } = createStorage();
    const ensureSpy = vi.spyOn(storage._io, "ensureDirs");
    const restoreSpy = vi.spyOn(storage, "restoreIndex");
    const attachSpy = vi.spyOn(storage, "_attachTabCoordinator");

    await storage.init();
    await storage.init();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(attachSpy).toHaveBeenCalledTimes(1);
    expect(storage._initialized).toBe(true);
  });

  it("allows concurrent init calls without throwing", async () => {
    const { storage } = createStorage();

    await Promise.all([storage.init(), storage.init()]);

    expect(storage._initialized).toBe(true);
  });

  it("attaches and detaches tab coordinator hooks", async () => {
    const hooks = { eviction: new Set(), access: new Set() };
    ensureTabCoordinatorHooks.mockImplementationOnce(() => hooks);

    const tabCoordinator = { init: vi.fn(async () => undefined) };
    const { storage } = createStorage({ tabCoordinator });
    const evictionSpy = vi.spyOn(storage, "_handleRemoteEviction");
    const accessSpy = vi.spyOn(storage, "_handleRemoteAccess");

    await storage._attachTabCoordinator();
    expect(hooks.eviction.size).toBe(1);
    expect(hooks.access.size).toBe(1);

    const sessionId = encodeTabCoordinatorSession("run-1", "snap_1");
    for (const handler of hooks.eviction) handler(sessionId);
    for (const handler of hooks.access) handler(sessionId);

    expect(evictionSpy).toHaveBeenCalledWith("snap_1");
    expect(accessSpy).toHaveBeenCalledWith("snap_1");

    storage._detachTabCoordinator();

    expect(hooks.eviction.size).toBe(0);
    expect(hooks.access.size).toBe(0);
    expect(releaseTabCoordinatorHooks).toHaveBeenCalledWith(tabCoordinator, hooks);
    expect(storage._tabCoordinatorListeners).toBeNull();
  });

  it("builds and parses tab coordinator session ids", () => {
    const { storage } = createStorage();

    const sessionId = storage._buildTabCoordinatorSessionId("snap_1");
    expect(typeof sessionId).toBe("string");
    expect(storage._parseTabCoordinatorSessionId(sessionId)).toBe("snap_1");

    const foreign = encodeTabCoordinatorSession("other-run", "snap_1");
    expect(storage._parseTabCoordinatorSessionId(foreign)).toBeNull();
    expect(storage._parseTabCoordinatorSessionId("")).toBeNull();
    expect(storage._parseTabCoordinatorSessionId(null)).toBeNull();
  });

  it("broadcasts access and eviction when coordinator is present", () => {
    const tabCoordinator = { broadcastEviction: vi.fn(), broadcastAccess: vi.fn() };
    const { storage } = createStorage({ tabCoordinator });

    storage._broadcastEviction("snap_1");
    storage._broadcastAccess("snap_1");

    expect(tabCoordinator.broadcastEviction).toHaveBeenCalledTimes(1);
    expect(tabCoordinator.broadcastAccess).toHaveBeenCalledTimes(1);

    storage._broadcastEviction("");
    storage._broadcastAccess("");

    expect(tabCoordinator.broadcastEviction).toHaveBeenCalledTimes(1);
    expect(tabCoordinator.broadcastAccess).toHaveBeenCalledTimes(1);
  });

  it("handles remote eviction and access updates", () => {
    const { storage } = createStorage();
    storage._snapshotCache.set("snap_1", { id: "snap_1" });
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];

    storage._handleRemoteEviction("snap_1");

    expect(storage._snapshotCache.get("snap_1")).toBeUndefined();
    expect(removeSnapshotFromIndex).toHaveBeenCalledWith(storage._index, "snap_1");

    storage._handleRemoteEviction("bad/id");
    storage._handleRemoteAccess("bad/id");

    expect(updateSnapshotAccess).not.toHaveBeenCalledWith(storage._index, "bad/id", expect.any(Number));

    storage._index.timeline = [{ id: "snap_2", ts: 2 }];
    storage._handleRemoteAccess("snap_2");

    expect(updateSnapshotAccess).toHaveBeenCalledWith(storage._index, "snap_2", expect.any(Number));
  });

  it("archives snapshots and persists metadata", async () => {
    const { storage, vfs } = createStorage();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456);
    const persistSpy = vi.spyOn(storage._io, "persistIndex");

    const data = { summary: "Hello", payload: "World" };
    const id = await storage.archive("  stage-1  ", data, ["Alpha", " alpha ", "Beta", ""], {});

    const stored = readJson(vfs, storage._io.snapshotPath(id));
    expect(stored.id).toBe(id);
    expect(stored.runId).toBe("run-1");
    expect(stored.stageKey).toBe("stage-1");
    expect(stored.keywords).toEqual(["alpha", "beta"]);
    expect(stored.summary).toBe("Hello");
    expect(stored.data).toEqual(data);

    expect(storage._snapshotCache.get(id)).toEqual(stored);
    expect(storage._index.timeline.some((entry) => entry.id === id)).toBe(true);
    expect(addSnapshotToIndex).toHaveBeenCalled();
    expect(normalizeKeywords).toHaveBeenCalledWith(["Alpha", " alpha ", "Beta", ""]);
    expect(getSummary).toHaveBeenCalledWith(data);
    expect(persistSpy).toHaveBeenCalled();
    expect(storage.getLastArchiveStats()).toEqual({ id, deduplicated: false });

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("deduplicates by content hash when enabled", async () => {
    const { storage } = createStorage();
    const writeSpy = vi.spyOn(storage._io, "writeJson");

    const data = { hello: "world" };
    const hash = computeContentHash(data);
    storage._index.hashIndex.set(hash, "existing-id");

    const id = await storage.archive("stage", data);

    expect(id).toBe("existing-id");
    expect(writeSpy).not.toHaveBeenCalled();
    expect(addSnapshotToIndex).not.toHaveBeenCalled();
    expect(storage.getLastArchiveStats()).toEqual({ id: "existing-id", deduplicated: true });
  });

  it("respects deduplicate option overrides", async () => {
    const { storage } = createStorage({ deduplicateByDefault: false });
    const data = { value: "x" };
    const hash = computeContentHash(data);
    storage._index.hashIndex.set(hash, "dup-id");

    const forced = await storage.archive("stage", data, [], { deduplicate: true });
    expect(forced).toBe("dup-id");

    const { storage: storage2 } = createStorage();
    storage2._index.hashIndex.set(hash, "dup-id");
    const writeSpy = vi.spyOn(storage2._io, "writeJson");
    const id = await storage2.archive("stage", data, [], { deduplicate: false });

    expect(id).not.toBe("dup-id");
    expect(writeSpy).toHaveBeenCalled();
  });

  it("supports concurrent archive calls", async () => {
    const { storage } = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2);
    const persistSpy = vi.spyOn(storage, "persistIndex").mockResolvedValue();

    const [first, second] = await Promise.all([
      storage.archive("stage", { value: 1 }, []),
      storage.archive("stage", { value: 2 }, []),
    ]);

    expect(first).not.toBe(second);
    expect(storage._index.timeline).toHaveLength(2);

    nowSpy.mockRestore();
    randomSpy.mockRestore();
    persistSpy.mockRestore();
  });

  it("archives resource-heavy payloads without failing", async () => {
    const { storage, vfs } = createStorage();
    const largeString = "x".repeat(100000);
    const deepObject = createDeepObject(50);

    const id = await storage.archive("stage", { text: largeString, deep: deepObject }, {});

    const stored = readJson(vfs, storage._io.snapshotPath(id));
    expect(stored.summary.length).toBeLessThanOrEqual(200);
    expect(stored.data.deep).toEqual(deepObject);
  });

  it("getSnapshot returns cached entries and falls back to storage", async () => {
    const tabCoordinator = { broadcastAccess: vi.fn() };
    const { storage } = createStorage({ tabCoordinator });
    const data = { summary: "cache", payload: true };
    const id = await storage.archive("stage", data, []);

    const cached = await storage.getSnapshot(id);
    expect(cached).toEqual(expect.objectContaining({ id }));
    expect(tabCoordinator.broadcastAccess).toHaveBeenCalledTimes(1);
    expect(updateSnapshotAccess).toHaveBeenCalledWith(storage._index, id, expect.any(Number));

    storage._snapshotCache.clear();
    const readSpy = vi.spyOn(storage._io, "readJson");
    const loaded = await storage.getSnapshot(id);

    expect(loaded).toEqual(expect.objectContaining({ id }));
    expect(readSpy).toHaveBeenCalled();
    expect(tabCoordinator.broadcastAccess).toHaveBeenCalledTimes(2);
  });

  it("getSnapshot returns null for invalid ids", async () => {
    const { storage } = createStorage();
    const invalidIds = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, [], {}, "bad/id", "has space"];

    for (const id of invalidIds) {
      const result = await storage.getSnapshot(id);
      expect(result).toBeNull();
    }

    expect(updateSnapshotAccess).not.toHaveBeenCalled();
  });

  it("checkpoint persists and reuses checkpoint ids", async () => {
    const { storage, vfs } = createStorage();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000123);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.654321);

    const firstId = await storage.checkpoint({ id: "ckpt_1", ts: 42, encoding: "json", runId: "" });
    const secondId = await storage.checkpoint({ id: "ckpt_1", ts: 84 });

    expect(firstId).toBe("ckpt_1");
    expect(secondId).toBe("ckpt_1");
    expect(storage._checkpointIndex).toHaveLength(1);

    const stored = readJson(vfs, storage._io.checkpointPath("ckpt_1"));
    expect(stored.ts).toBe(84);
    expect(stored.runId).toBe("run-1");

    const generatedId = await storage.checkpoint("raw-data");
    expect(generatedId).toMatch(/^ckpt_/);

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("getCheckpoint/getLatestCheckpoint/listCheckpoints handle boundaries", async () => {
    const { storage } = createStorage();
    const id = await storage.checkpoint({ id: "ckpt_ok", ts: 10, encoding: "json" });

    const cached = await storage.getCheckpoint(id);
    expect(cached).toEqual(expect.objectContaining({ id }));

    storage._checkpointCache.clear();
    const readSpy = vi.spyOn(storage._io, "readJson");
    const loaded = await storage.getCheckpoint(id);
    expect(loaded).toEqual(expect.objectContaining({ id }));
    expect(readSpy).toHaveBeenCalled();

    const latest = await storage.getLatestCheckpoint();
    expect(latest).toEqual(expect.objectContaining({ id }));

    storage._checkpointIndex = {};
    expect(await storage.getLatestCheckpoint()).toBeNull();
    expect(await storage.getCheckpoint("bad/id")).toBeNull();

    storage._checkpointIndex = [
      { id: "good", ts: 1, encoding: "utf8", baseId: "base" },
      { id: null, ts: "bad", encoding: 12, baseId: {} },
    ];

    const list = await storage.listCheckpoints();
    expect(list).toEqual([
      { id: "good", ts: 1, encoding: "utf8", baseId: "base" },
      { id: "", ts: 0, encoding: null, baseId: null },
    ]);
  });

  it("persists and restores index state", async () => {
    const { storage, vfs } = createStorage();
    const persistSpy = vi.spyOn(storage._io, "persistIndex");

    await storage.persistIndex();

    expect(serializeIndexState).toHaveBeenCalledWith(storage._index, storage._checkpointIndex, "run-1");
    expect(persistSpy).toHaveBeenCalled();

    const raw = {
      timeline: [{ id: "snap_1", ts: 1, accessedAt: 1 }],
      keywords: [["alpha", ["snap_1"]]],
      stages: [["stage", "snap_1"]],
      hashIndex: [["hash", "snap_1"]],
      checkpointIndex: ["ckpt_1"],
    };

    setJson(vfs, storage._io.indexPath, raw);
    await storage.restoreIndex();

    expect(restoreIndexState).toHaveBeenCalled();
    expect(storage._index.timeline).toEqual(raw.timeline);
    expect(storage._checkpointIndex).toEqual(["ckpt_1"]);
  });

  it("evicts snapshots when limits are exceeded and emits events", async () => {
    const vfs = createMemoryVfs();
    const eventBus = { emit: vi.fn() };
    const tabCoordinator = { broadcastEviction: vi.fn() };
    const storage = new L3Storage({ vfs, runId: "run-1", maxSnapshots: 1, eventBus, tabCoordinator });

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);

    const firstId = await storage.archive("stage", { value: 1 }, []);
    const secondId = await storage.archive("stage", { value: 2 }, []);

    await storage.waitForEviction();

    expect(storage._index.timeline).toHaveLength(1);
    expect(storage._index.timeline[0].id).toBe(secondId);
    expect(vfs.unlink).toHaveBeenCalledWith(storage._io.snapshotPath(firstId));
    expect(eventBus.emit).toHaveBeenCalledWith("l3:evicted", {
      runId: "run-1",
      evictedIds: [firstId],
      count: 1,
    });
    expect(tabCoordinator.broadcastEviction).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("eviction tolerates unlink errors", async () => {
    const vfs = createMemoryVfs();
    vfs.unlink = vi.fn(async () => {
      throw new Error("unlink failed");
    });

    const storage = new L3Storage({ vfs, runId: "run-1", maxSnapshots: 1 });
    storage._index.timeline = [
      { id: "snap_old", ts: 1, accessedAt: 1 },
      { id: "snap_new", ts: 2, accessedAt: 2 },
    ];

    await storage._maybeEvict();

    expect(storage._index.timeline).toHaveLength(1);
    expect(storage._index.timeline[0].id).toBe("snap_new");
  });

  it("exposes storage stats and superseded count", () => {
    const { storage } = createStorage();
    storage._index.timeline = [
      { id: "a", ts: 1, summary: "x" },
      { id: "b", ts: 2, summary: "y", superseded: true },
    ];

    estimateStorageBytes.mockReturnValueOnce(1234);

    const stats = storage.getStorageStats();
    expect(stats).toEqual({
      snapshotCount: 2,
      estimatedBytes: 1234,
      maxSnapshots: DEFAULT_MAX_SNAPSHOTS,
      maxStorageBytes: DEFAULT_MAX_STORAGE_BYTES,
    });

    expect(storage.supersededSnapshotCount).toBe(1);
    expect(getSupersededSnapshotCount).toHaveBeenCalled();
  });

  it("marks snapshots superseded and persists updates", async () => {
    const { storage, vfs } = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    storage._snapshotCache.set("snap_1", { id: "snap_1", payload: true });
    await storage._io.writeJson(storage._io.snapshotPath("snap_1"), { id: "snap_1" });

    const first = await storage.markSnapshotSuperseded("snap_1", "fix");
    const second = await storage.markSnapshotSuperseded("snap_1", "fix");

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(markSnapshotSupersededInIndex).toHaveBeenCalled();

    const stored = readJson(vfs, storage._io.snapshotPath("snap_1"));
    expect(stored.superseded).toBe(true);
    expect(stored.supersededBy).toBe("fix");

    expect(await storage.markSnapshotSuperseded(null, "x")).toBe(false);
  });

  it("marks multiple snapshots superseded", async () => {
    const { storage } = createStorage();
    storage._index.timeline = [
      { id: "snap_1", ts: 1 },
      { id: "snap_2", ts: 2 },
    ];
    storage._snapshotCache.set("snap_2", { id: "snap_2" });

    const writeSpy = vi.spyOn(storage._io, "writeJson");
    const marked = await storage.markSnapshotsSuperseded(["snap_1", "snap_2", "bad/id"], 123);

    expect(marked).toBe(2);
    expect(markSnapshotsSupersededInIndex).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);

    const empty = await storage.markSnapshotsSuperseded({}, "fix");
    expect(empty).toBe(0);
  });

  it("delegates timeline and keyword queries", () => {
    const { storage } = createStorage();
    storage._index.timeline = [
      { id: "a", ts: 1, summary: "x" },
      { id: "b", ts: 2, summary: "y", superseded: true },
    ];
    storage._index.keywords.set("alpha", new Set(["a", "b"]));

    const timeline = storage.getTimeline();
    const allTimeline = storage.getTimeline({ includeSuperseded: true });
    const superseded = storage.getSupersededTimeline();
    const keywordHits = storage.searchByKeyword("alpha");
    const keywordAll = storage.searchByKeyword("alpha", { includeSuperseded: true });

    expect(timeline.map((entry) => entry.id)).toEqual(["a"]);
    expect(allTimeline).toHaveLength(2);
    expect(superseded.map((entry) => entry.id)).toEqual(["b"]);
    expect(keywordHits).toEqual(["a"]);
    expect(keywordAll).toEqual(["a", "b"]);
    expect(getTimeline).toHaveBeenCalled();
    expect(getSupersededTimeline).toHaveBeenCalled();
    expect(searchByKeyword).toHaveBeenCalled();

    const data = { foo: "bar" };
    const hash = computeContentHash(data);
    storage._index.hashIndex.set(hash, "a");

    expect(storage.isDuplicate(data)).toEqual({ duplicate: true, existingId: "a" });
    expect(isDuplicateQuery).toHaveBeenCalled();
  });

  it("waits for pending eviction promise", async () => {
    const { storage } = createStorage();
    let resolved = false;
    storage._evictionPromise = Promise.resolve().then(() => {
      resolved = true;
    });

    await storage.waitForEviction();

    expect(resolved).toBe(true);
  });

  it("returns last archive stats and disposes safely", async () => {
    const { storage } = createStorage();
    expect(storage.getLastArchiveStats()).toBeNull();

    const id = await storage.archive("stage", { value: "x" }, []);
    expect(storage.getLastArchiveStats()).toEqual({ id, deduplicated: false });
    await storage.waitForEviction();

    const persistSpy = vi.spyOn(storage, "persistIndex").mockRejectedValue(new Error("fail"));
    storage._snapshotCache.set("snap", { id: "snap" });
    storage._checkpointCache.set("ckpt", { id: "ckpt" });

    await storage.dispose();

    expect(storage.disposed).toBe(true);
    expect(storage._snapshotCache.size).toBe(0);
    expect(storage._checkpointCache.size).toBe(0);
    expect(__logger.warn).toHaveBeenCalled();

    await storage.dispose();

    persistSpy.mockRestore();
  });
});

describe("createL3Storage", () => {
  it("creates a storage instance", () => {
    const vfs = createMemoryVfs();
    const storage = createL3Storage({ vfs, runId: "run-1" });

    expect(storage).toBeInstanceOf(L3Storage);
    expect(storage._runId).toBe("run-1");
  });
});
