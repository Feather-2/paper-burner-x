/**
 * @file tests/unit/agents/plugins/memory/l3-storage.test.js
 * @description Unit tests for L3Storage and createL3Storage.
 *
 * NOTE: Per project policy, this test suite mocks ALL transitive imports of the module under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };

  class FakeDisposableBase {
    constructor() {
      /** @type {boolean} */
      this.disposed = false;
    }

    _ensureNotDisposed() {
      if (this.disposed) {
        throw new Error("disposed");
      }
    }

    async dispose() {
      this.disposed = true;
    }
  }

  class FakeLRUCache {
    constructor(options = {}) {
      const raw = options && typeof options === "object" ? options.maxSize : undefined;
      this.maxSize = typeof raw === "number" && Number.isFinite(raw) ? raw : 10;
      this._map = new Map();
    }

    get size() {
      return this._map.size;
    }

    set(key, value) {
      if (this._map.has(key)) this._map.delete(key);
      this._map.set(key, value);
      while (this._map.size > this.maxSize) {
        const oldestKey = this._map.keys().next().value;
        this._map.delete(oldestKey);
      }
    }

    get(key) {
      if (!this._map.has(key)) return undefined;
      const value = this._map.get(key);
      this._map.delete(key);
      this._map.set(key, value);
      return value;
    }

    delete(key) {
      this._map.delete(key);
    }

    clear() {
      this._map.clear();
    }
  }

  const DEFAULT_MAX_SNAPSHOTS = 1000;
  const DEFAULT_MAX_STORAGE_BYTES = 104857600;

  const computeContentHash = vi.fn((data) => {
    try {
      return `hash:${JSON.stringify(data)}`;
    } catch {
      return "hash:[unserializable]";
    }
  });

  const createIndexState = vi.fn(() => ({
    timeline: [],
    keywords: new Map(),
    stages: new Map(),
    hashIndex: new Map(),
  }));

  const addSnapshotToIndex = vi.fn((index, snapshot) => {
    if (!index || typeof index !== "object") return;
    if (!Array.isArray(index.timeline)) index.timeline = [];
    const entry = {
      id: snapshot?.id,
      ts: snapshot?.ts,
      accessedAt: snapshot?.accessedAt,
      summary: snapshot?.summary,
      stageKey: snapshot?.stageKey,
      contentHash: snapshot?.contentHash,
      superseded: snapshot?.superseded,
      supersededBy: snapshot?.supersededBy,
    };
    index.timeline.push(entry);
    if (snapshot?.contentHash && snapshot?.id) {
      if (!(index.hashIndex instanceof Map)) index.hashIndex = new Map();
      index.hashIndex.set(snapshot.contentHash, snapshot.id);
    }
    const kw = Array.isArray(snapshot?.keywords) ? snapshot.keywords : [];
    if (!(index.keywords instanceof Map)) index.keywords = new Map();
    for (const k of kw) {
      if (typeof k !== "string" || !k) continue;
      const set = index.keywords.get(k) instanceof Set ? index.keywords.get(k) : new Set();
      set.add(snapshot.id);
      index.keywords.set(k, set);
    }
    if (typeof snapshot?.stageKey === "string" && snapshot.stageKey) {
      if (!(index.stages instanceof Map)) index.stages = new Map();
      index.stages.set(snapshot.stageKey, snapshot.id);
    }
  });

  const updateSnapshotAccess = vi.fn((index, id, accessedAt) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    const entry = list.find((e) => e?.id === id);
    if (entry && typeof accessedAt === "number") entry.accessedAt = accessedAt;
  });

  const removeSnapshotFromIndex = vi.fn((index, id) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    if (Array.isArray(index?.timeline)) {
      index.timeline = list.filter((e) => e?.id !== id);
    }
    if (index?.hashIndex instanceof Map) {
      for (const [hash, existing] of index.hashIndex.entries()) {
        if (existing === id) index.hashIndex.delete(hash);
      }
    }
    if (index?.keywords instanceof Map) {
      for (const [k, set] of index.keywords.entries()) {
        if (!(set instanceof Set)) continue;
        set.delete(id);
        if (set.size === 0) index.keywords.delete(k);
      }
    }
  });

  const estimateStorageBytes = vi.fn((index) => {
    const count = Array.isArray(index?.timeline) ? index.timeline.length : 0;
    return count * 100;
  });

  const getSupersededSnapshotCount = vi.fn((index) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    return list.filter((e) => e?.superseded === true).length;
  });

  const markSnapshotSupersededInIndex = vi.fn((index, id, correctionText) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    const entry = list.find((e) => e?.id === id) || null;
    if (!entry) return { entry: null, wasSuperseded: false };
    const wasSuperseded = entry.superseded === true;
    entry.superseded = true;
    entry.supersededBy = correctionText;
    return { entry, wasSuperseded };
  });

  const markSnapshotsSupersededInIndex = vi.fn((index, ids, correctionText) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    const updatedIds = [];
    let marked = 0;
    for (const id of Array.isArray(ids) ? ids : []) {
      const entry = list.find((e) => e?.id === id);
      if (!entry) continue;
      if (entry.superseded !== true) {
        marked += 1;
      }
      entry.superseded = true;
      entry.supersededBy = correctionText;
      updatedIds.push(id);
    }
    return { marked, touched: updatedIds.length > 0, updatedIds };
  });

  const serializeIndexState = vi.fn((index, checkpointIndex, runId) => ({
    schemaVersion: "test",
    runId,
    index,
    checkpointIndex,
  }));

  const restoreIndexState = vi.fn(() => null);

  const getTimeline = vi.fn((index, options = {}) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    const includeSuperseded = options && typeof options === "object" ? options.includeSuperseded === true : false;
    return includeSuperseded ? [...list] : list.filter((e) => e?.superseded !== true);
  });

  const getSupersededTimeline = vi.fn((index) => {
    const list = Array.isArray(index?.timeline) ? index.timeline : [];
    return list.filter((e) => e?.superseded === true);
  });

  const searchByKeyword = vi.fn((index, keyword, options = {}) => {
    const includeSuperseded = options && typeof options === "object" ? options.includeSuperseded === true : false;
    if (!(index?.keywords instanceof Map)) return [];
    const ids = index.keywords.get(keyword);
    const list = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [];
    if (includeSuperseded) return list;
    const timeline = Array.isArray(index?.timeline) ? index.timeline : [];
    const supersededIds = new Set(timeline.filter((e) => e?.superseded === true).map((e) => e.id));
    return list.filter((id) => !supersededIds.has(id));
  });

  const isDuplicate = vi.fn((index, data) => {
    const hash = computeContentHash(data);
    const existingId = index?.hashIndex instanceof Map ? index.hashIndex.get(hash) : undefined;
    return existingId ? { duplicate: true, existingId } : { duplicate: false };
  });

  const createStorageIO = vi.fn(({ vfs, basePath }) => {
    const store = new Map();
    const indexPath = `${basePath}/index.json`;
    return {
      basePath,
      indexPath,
      ensureDirs: vi.fn(async () => {
        await vfs.mkdir(basePath, { recursive: true });
      }),
      snapshotPath: (id) => `${basePath}/snapshots/${id}.json`,
      checkpointPath: (id) => `${basePath}/checkpoints/${id}.json`,
      writeJson: vi.fn(async (path, data) => {
        store.set(path, data);
      }),
      readJson: vi.fn(async (path) => (store.has(path) ? store.get(path) : null)),
      persistIndex: vi.fn(async (data) => {
        store.set(indexPath, data);
      }),
      readIndexRaw: vi.fn(async () => (store.has(indexPath) ? store.get(indexPath) : null)),
      __store: store,
    };
  });

  const encodeTabCoordinatorSession = vi.fn((runId, snapshotId) => {
    if (typeof runId !== "string" || typeof snapshotId !== "string") return null;
    if (!runId || !snapshotId) return null;
    return `${runId}::${snapshotId}`;
  });

  const decodeTabCoordinatorSession = vi.fn((sessionId) => {
    if (typeof sessionId !== "string") return null;
    const parts = sessionId.split("::");
    if (parts.length !== 2) return null;
    const [runId, snapshotId] = parts;
    if (!runId || !snapshotId) return null;
    return { runId, snapshotId };
  });

  const ensureTabCoordinatorHooks = vi.fn(() => ({ eviction: new Set(), access: new Set() }));
  const releaseTabCoordinatorHooks = vi.fn();

  const toNonEmptyString = vi.fn((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });

  const normalizeKeywords = vi.fn((value) => {
    const list = Array.isArray(value) ? value : [];
    const out = [];
    for (const item of list) {
      const s = typeof item === "string" ? item.trim() : "";
      if (s) out.push(s);
    }
    return [...new Set(out)];
  });

  const getSummary = vi.fn((data) => {
    if (data && typeof data === "object" && typeof data.summary === "string") {
      return data.summary;
    }
    return "summary";
  });

  const validateRunId = vi.fn((value) => {
    const runId = typeof value === "string" ? value.trim() : "";
    if (!runId) throw new Error("invalid runId");
    if (runId.includes("..") || runId.includes("/") || runId.includes("\\")) throw new Error("invalid runId");
    return runId;
  });

  const createLogger = vi.fn(() => logger);

  return {
    logger,
    FakeDisposableBase,
    FakeLRUCache,
    DEFAULT_MAX_SNAPSHOTS,
    DEFAULT_MAX_STORAGE_BYTES,
    computeContentHash,
    createIndexState,
    addSnapshotToIndex,
    updateSnapshotAccess,
    removeSnapshotFromIndex,
    estimateStorageBytes,
    getSupersededSnapshotCount,
    markSnapshotSupersededInIndex,
    markSnapshotsSupersededInIndex,
    serializeIndexState,
    restoreIndexState,
    getTimeline,
    getSupersededTimeline,
    searchByKeyword,
    isDuplicate,
    createStorageIO,
    encodeTabCoordinatorSession,
    decodeTabCoordinatorSession,
    ensureTabCoordinatorHooks,
    releaseTabCoordinatorHooks,
    toNonEmptyString,
    normalizeKeywords,
    getSummary,
    validateRunId,
    createLogger,
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  LRUCache: h.FakeLRUCache,
  DisposableBase: h.FakeDisposableBase,
  createLogger: h.createLogger,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/constants.js", () => ({
  DEFAULT_MAX_SNAPSHOTS: h.DEFAULT_MAX_SNAPSHOTS,
  DEFAULT_MAX_STORAGE_BYTES: h.DEFAULT_MAX_STORAGE_BYTES,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/hash.js", () => ({
  computeContentHash: h.computeContentHash,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/index-manager.js", () => ({
  addSnapshotToIndex: h.addSnapshotToIndex,
  createIndexState: h.createIndexState,
  estimateStorageBytes: h.estimateStorageBytes,
  getSupersededSnapshotCount: h.getSupersededSnapshotCount,
  markSnapshotSupersededInIndex: h.markSnapshotSupersededInIndex,
  markSnapshotsSupersededInIndex: h.markSnapshotsSupersededInIndex,
  removeSnapshotFromIndex: h.removeSnapshotFromIndex,
  restoreIndexState: h.restoreIndexState,
  serializeIndexState: h.serializeIndexState,
  updateSnapshotAccess: h.updateSnapshotAccess,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/query.js", () => ({
  getSupersededTimeline: h.getSupersededTimeline,
  getTimeline: h.getTimeline,
  isDuplicate: h.isDuplicate,
  searchByKeyword: h.searchByKeyword,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/storage-io.js", () => ({
  createStorageIO: h.createStorageIO,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/tab-coordinator.js", () => ({
  decodeTabCoordinatorSession: h.decodeTabCoordinatorSession,
  encodeTabCoordinatorSession: h.encodeTabCoordinatorSession,
  ensureTabCoordinatorHooks: h.ensureTabCoordinatorHooks,
  releaseTabCoordinatorHooks: h.releaseTabCoordinatorHooks,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage/utils.js", () => ({
  getSummary: h.getSummary,
  normalizeKeywords: h.normalizeKeywords,
  toNonEmptyString: h.toNonEmptyString,
  validateRunId: h.validateRunId,
}));

import * as l3StorageModule from "../../../../../js/agents/plugins/memory/l3-storage.js";

function createMemoryVfs(overrides = {}) {
  const store = new Map();
  return {
    store,
    readFile: vi.fn(async (path) => store.get(path)),
    writeFile: vi.fn(async (path, data) => {
      store.set(path, data);
    }),
    mkdir: vi.fn(async () => undefined),
    unlink: vi.fn(async (path) => {
      store.delete(path);
    }),
    ...overrides,
  };
}

function createStorage(options = {}) {
  const vfs = options.vfs ?? createMemoryVfs();
  const runId = options.runId ?? "run-1";
  return new l3StorageModule.L3Storage({ vfs, runId, ...options });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exports", () => {
  it("should_export_L3Storage_when_module_loaded", () => {
    expect(typeof l3StorageModule.L3Storage).toBe("function");
  });

  it("should_export_createL3Storage_when_module_loaded", () => {
    expect(typeof l3StorageModule.createL3Storage).toBe("function");
  });
});

describe("L3Storage.constructor", () => {
  it("should_throw_when_vfs_is_missing", () => {
    expect(() => new l3StorageModule.L3Storage({ runId: "run-1" })).toThrow("vfs");
  });

  it("should_throw_when_vfs_readFile_is_missing", () => {
    const vfs = { writeFile: vi.fn(), mkdir: vi.fn() };
    expect(() => createStorage({ vfs })).toThrow("readFile");
  });

  it("should_throw_when_vfs_writeFile_is_missing", () => {
    const vfs = { readFile: vi.fn(), mkdir: vi.fn() };
    expect(() => createStorage({ vfs })).toThrow("writeFile");
  });

  it("should_throw_when_vfs_mkdir_is_missing", () => {
    const vfs = { readFile: vi.fn(), writeFile: vi.fn() };
    expect(() => createStorage({ vfs })).toThrow("mkdir");
  });

  it.each([null, undefined, "", "   ", "../x", "a/b", "a\\b", 0, -1, Number.MAX_SAFE_INTEGER])(
    "should_throw_when_runId_is_invalid_%#",
    (runId) => {
      const vfs = createMemoryVfs();
      expect(() => new l3StorageModule.L3Storage({ vfs, runId })).toThrow();
    },
  );

  it("should_store_validated_runId_when_runId_has_whitespace", () => {
    const storage = createStorage({ runId: "  run-1  " });
    expect(storage._runId).toBe("run-1");
  });

  it("should_call_createStorageIO_with_basePath_when_constructed", () => {
    const vfs = createMemoryVfs();
    createStorage({ vfs, runId: "run-1" });
    expect(h.createStorageIO).toHaveBeenCalledWith({ vfs, basePath: ".agents/runs/run-1/l3" });
  });

  it("should_use_default_limits_when_max_values_are_invalid", () => {
    const storage = createStorage({ maxSnapshots: "5", maxStorageBytes: -1 });
    expect(storage.getStorageStats().maxSnapshots).toBe(h.DEFAULT_MAX_SNAPSHOTS);
  });

  it("should_use_floor_when_maxSnapshots_is_fractional", () => {
    const storage = createStorage({ maxSnapshots: 2.9 });
    expect(storage.getStorageStats().maxSnapshots).toBe(2);
  });

  it("should_default_deduplicateByDefault_to_true_when_option_omitted", async () => {
    const storage = createStorage();
    storage._index.hashIndex.set("hash:1", "snap_existing");
    h.computeContentHash.mockReturnValueOnce("hash:1");
    const id = await storage.archive("stage", { value: 1 }, []);
    expect(id).toBe("snap_existing");
  });

  it("should_disable_deduplication_by_default_when_deduplicateByDefault_is_false", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    storage._index.hashIndex.set("hash:1", "snap_existing");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    h.computeContentHash.mockReturnValueOnce("hash:1");
    const id = await storage.archive("stage", { value: 1 }, []);
    expect(id).not.toBe("snap_existing");
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_evict_oldest_entry_when_cacheSize_is_zero", () => {
    const storage = createStorage({ cacheSize: 0 });
    storage._snapshotCache.set("a", { id: "a" });
    storage._snapshotCache.set("b", { id: "b" });
    expect(storage._snapshotCache.get("a")).toBeUndefined();
  });
});

describe("L3Storage.init", () => {
  it("should_call_ensureDirs_once_when_init_called_twice", async () => {
    const storage = createStorage();
    await storage.init();
    await storage.init();
    expect(storage._io.ensureDirs).toHaveBeenCalledTimes(1);
  });

  it("should_set_initialized_true_when_init_completes", async () => {
    const storage = createStorage();
    await storage.init();
    expect(storage._initialized).toBe(true);
  });

  it("should_not_throw_when_init_called_concurrently", async () => {
    const storage = createStorage();
    await Promise.all([storage.init(), storage.init()]);
    expect(storage._initialized).toBe(true);
  });
});

describe("L3Storage tab coordination", () => {
  it("should_not_call_ensureTabCoordinatorHooks_when_tabCoordinator_is_missing", async () => {
    const storage = createStorage();
    await storage.init();
    expect(h.ensureTabCoordinatorHooks).not.toHaveBeenCalled();
  });

  it("should_call_tabCoordinator_init_when_attachTabCoordinator_called", async () => {
    const tabCoordinator = { init: vi.fn(async () => undefined) };
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    expect(tabCoordinator.init).toHaveBeenCalledTimes(1);
  });

  it("should_log_warning_when_tabCoordinator_init_throws", async () => {
    const tabCoordinator = {
      init: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("should_keep_listeners_null_when_ensureTabCoordinatorHooks_returns_null", async () => {
    const tabCoordinator = { init: vi.fn(async () => undefined) };
    h.ensureTabCoordinatorHooks.mockReturnValueOnce(null);
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    expect(storage._tabCoordinatorListeners).toBeNull();
  });

  it("should_add_eviction_handler_when_attachTabCoordinator_succeeds", async () => {
    const hooks = { eviction: new Set(), access: new Set() };
    h.ensureTabCoordinatorHooks.mockReturnValueOnce(hooks);
    const storage = createStorage({ tabCoordinator: { init: vi.fn(async () => undefined) } });
    await storage._attachTabCoordinator();
    expect(hooks.eviction.size).toBe(1);
  });

  it("should_remove_handlers_and_release_hooks_when_detachTabCoordinator_called", async () => {
    const tabCoordinator = { init: vi.fn(async () => undefined) };
    const hooks = { eviction: new Set(), access: new Set() };
    h.ensureTabCoordinatorHooks.mockReturnValueOnce(hooks);
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    storage._detachTabCoordinator();
    expect(h.releaseTabCoordinatorHooks).toHaveBeenCalledWith(tabCoordinator, hooks);
  });

  it("should_call_removeSnapshotFromIndex_when_remote_eviction_received", async () => {
    const tabCoordinator = { init: vi.fn(async () => undefined) };
    const hooks = { eviction: new Set(), access: new Set() };
    h.ensureTabCoordinatorHooks.mockReturnValueOnce(hooks);
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    const session = h.encodeTabCoordinatorSession("run-1", "snap_1");
    for (const handler of hooks.eviction) handler(session);
    expect(h.removeSnapshotFromIndex).toHaveBeenCalledWith(storage._index, "snap_1");
  });

  it("should_not_update_when_remote_event_runId_is_foreign", async () => {
    const tabCoordinator = { init: vi.fn(async () => undefined) };
    const hooks = { eviction: new Set(), access: new Set() };
    h.ensureTabCoordinatorHooks.mockReturnValueOnce(hooks);
    const storage = createStorage({ tabCoordinator });
    await storage._attachTabCoordinator();
    const foreign = h.encodeTabCoordinatorSession("other-run", "snap_1");
    for (const handler of hooks.access) handler(foreign);
    expect(h.updateSnapshotAccess).not.toHaveBeenCalled();
  });
});

describe("L3Storage.archive", () => {
  it("should_call_computeContentHash_when_archiving", async () => {
    const storage = createStorage();
    const data = { value: 1 };
    await storage.archive("stage", data, []);
    expect(h.computeContentHash).toHaveBeenCalledWith(data);
  });

  it("should_return_existing_id_when_deduplicate_option_true_and_hash_exists", async () => {
    const storage = createStorage();
    storage._index.hashIndex.set("hash:1", "snap_existing");
    h.computeContentHash.mockReturnValueOnce("hash:1");
    const id = await storage.archive("stage", { value: 1 }, [], { deduplicate: true });
    expect(id).toBe("snap_existing");
  });

  it("should_not_write_snapshot_when_deduplicated", async () => {
    const storage = createStorage();
    storage._index.hashIndex.set("hash:1", "snap_existing");
    h.computeContentHash.mockReturnValueOnce("hash:1");
    await storage.archive("stage", { value: 1 }, [], { deduplicate: true });
    expect(storage._io.writeJson).not.toHaveBeenCalled();
  });

  it("should_set_lastArchiveStats_when_deduplicated", async () => {
    const storage = createStorage();
    storage._index.hashIndex.set("hash:1", "snap_existing");
    h.computeContentHash.mockReturnValueOnce("hash:1");
    await storage.archive("stage", { value: 1 }, [], { deduplicate: true });
    expect(storage.getLastArchiveStats()).toEqual({ id: "snap_existing", deduplicated: true });
  });

  it("should_return_deterministic_snapshot_id_when_time_and_random_are_stubbed", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const now = 1700000000000;
    const rand = 0.123456;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(rand);
    const expectedId = `snap_${now.toString(36)}_${rand.toString(36).slice(2, 8)}`;
    const id = await storage.archive("stage", { value: 1 }, []);
    expect(id).toBe(expectedId);
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_write_snapshot_entry_with_normalized_stageKey", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("  stage  ", { summary: "Hello" }, [" a ", "a", ""]);
    const stored = storage._io.__store.get(storage._io.snapshotPath(id));
    expect(stored.stageKey).toBe("stage");
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_trigger_background_eviction_and_log_when_eviction_rejects", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    storage._maybeEvict = vi.fn(async () => {
      throw new Error("evict boom");
    });
    await storage.archive("stage", { value: 1 }, []);
    await storage.waitForEviction();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("should_set_lastArchiveStats_when_archived_without_deduplication", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("stage", { value: 1 }, []);
    expect(storage.getLastArchiveStats()).toEqual({ id, deduplicated: false });
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });
});

describe("L3Storage.getSnapshot", () => {
  it.each([null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, [], {}, "bad/id", "has space"])(
    "should_return_null_when_getSnapshot_given_invalid_id_%#",
    async (id) => {
      const storage = createStorage();
      expect(await storage.getSnapshot(id)).toBeNull();
    },
  );

  it("should_update_snapshot_access_when_getSnapshot_called", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("stage", { value: 1 }, []);
    await storage.getSnapshot(id);
    expect(h.updateSnapshotAccess).toHaveBeenCalledWith(storage._index, id, expect.any(Number));
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_return_cached_snapshot_when_present", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("stage", { value: 1 }, []);
    const result = await storage.getSnapshot(id);
    expect(result).toEqual(expect.objectContaining({ id }));
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_read_from_storage_when_snapshot_not_cached", async () => {
    const storage = createStorage({ deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("stage", { value: 1 }, []);
    storage._snapshotCache.clear();
    await storage.getSnapshot(id);
    expect(storage._io.readJson).toHaveBeenCalled();
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_return_null_when_snapshot_missing_on_disk", async () => {
    const storage = createStorage();
    await storage.init();
    storage._io.readJson.mockResolvedValueOnce(null);
    expect(await storage.getSnapshot("snap_missing")).toBeNull();
  });

  it("should_broadcast_access_when_tabCoordinator_present", async () => {
    const tabCoordinator = { broadcastAccess: vi.fn() };
    const storage = createStorage({ tabCoordinator, deduplicateByDefault: false });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.111111);
    const id = await storage.archive("stage", { value: 1 }, []);
    await storage.getSnapshot(id);
    expect(tabCoordinator.broadcastAccess).toHaveBeenCalledWith(`run-1::${id}`);
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });
});

describe("L3Storage.checkpoint", () => {
  it("should_reuse_checkpoint_id_when_valid_id_provided", async () => {
    const storage = createStorage();
    expect(await storage.checkpoint({ id: "ckpt_1", ts: 42, runId: "" })).toBe("ckpt_1");
  });

  it("should_fallback_to_storage_runId_when_checkpoint_runId_is_empty", async () => {
    const storage = createStorage();
    const id = await storage.checkpoint({ id: "ckpt_1", ts: 1, runId: "" });
    const ckpt = await storage.getCheckpoint(id);
    expect(ckpt.runId).toBe("run-1");
  });

  it("should_generate_checkpoint_id_when_id_missing", async () => {
    const storage = createStorage();
    const now = 1700000000123;
    const rand = 0.654321;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(rand);
    const expectedId = `ckpt_${now.toString(36)}_${rand.toString(36).slice(2, 8)}`;
    expect(await storage.checkpoint("raw-data")).toBe(expectedId);
    nowSpy.mockRestore();
    randomSpy.mockRestore();
  });

  it("should_replace_checkpoint_meta_when_same_id_checkpointed_twice", async () => {
    const storage = createStorage();
    await storage.checkpoint({ id: "ckpt_1", ts: 1 });
    await storage.checkpoint({ id: "ckpt_1", ts: 2 });
    expect((await storage.listCheckpoints()).length).toBe(1);
  });
});

describe("L3Storage.getCheckpoint / getLatestCheckpoint / listCheckpoints", () => {
  it("should_return_null_when_getCheckpoint_given_invalid_id", async () => {
    const storage = createStorage();
    expect(await storage.getCheckpoint("bad/id")).toBeNull();
  });

  it("should_return_null_when_getCheckpoint_missing_on_disk", async () => {
    const storage = createStorage();
    await storage.init();
    storage._io.readJson.mockResolvedValueOnce(null);
    expect(await storage.getCheckpoint("ckpt_missing")).toBeNull();
  });

  it("should_return_null_when_getLatestCheckpoint_has_no_entries", async () => {
    const storage = createStorage();
    expect(await storage.getLatestCheckpoint()).toBeNull();
  });

  it("should_return_latest_checkpoint_when_available", async () => {
    const storage = createStorage();
    await storage.checkpoint({ id: "ckpt_1", ts: 1 });
    await storage.checkpoint({ id: "ckpt_2", ts: 2 });
    expect((await storage.getLatestCheckpoint()).id).toBe("ckpt_2");
  });

  it("should_return_defaults_when_listCheckpoints_has_invalid_entries", async () => {
    const storage = createStorage();
    storage._checkpointIndex = [{ id: null, ts: "bad", encoding: 12, baseId: {} }];
    expect(await storage.listCheckpoints()).toEqual([{ id: "", ts: 0, encoding: null, baseId: null }]);
  });
});

describe("L3Storage.persistIndex / restoreIndex", () => {
  it("should_call_serializeIndexState_with_index_and_checkpointIndex_and_runId", async () => {
    const storage = createStorage();
    await storage.persistIndex();
    expect(h.serializeIndexState).toHaveBeenCalledWith(storage._index, storage._checkpointIndex, "run-1");
  });

  it("should_call_io_persistIndex_with_serialized_data", async () => {
    const storage = createStorage();
    const payload = { ok: true };
    h.serializeIndexState.mockReturnValueOnce(payload);
    await storage.persistIndex();
    expect(storage._io.persistIndex).toHaveBeenCalledWith(payload);
  });

  it("should_not_call_restoreIndexState_when_readIndexRaw_returns_null", async () => {
    const storage = createStorage();
    storage._io.readIndexRaw.mockResolvedValueOnce(null);
    await storage.restoreIndex();
    expect(h.restoreIndexState).not.toHaveBeenCalled();
  });

  it("should_update_snapshotCount_when_restoreIndexState_returns_data", async () => {
    const storage = createStorage();
    const restoredIndex = h.createIndexState();
    restoredIndex.timeline.push({ id: "a", ts: 1 });
    restoredIndex.timeline.push({ id: "b", ts: 2 });
    h.restoreIndexState.mockReturnValueOnce({ index: restoredIndex, checkpointIndex: [] });
    storage._io.readIndexRaw.mockResolvedValueOnce({ some: "raw" });
    await storage.restoreIndex();
    expect(storage.getStorageStats().snapshotCount).toBe(2);
  });
});

describe("L3Storage eviction", () => {
  it("should_not_unlink_when_timeline_is_empty", async () => {
    const vfs = createMemoryVfs();
    const storage = createStorage({ vfs });
    storage._index.timeline = [];
    await storage._maybeEvict();
    expect(vfs.unlink).not.toHaveBeenCalled();
  });

  it("should_not_unlink_when_limits_not_exceeded", async () => {
    const vfs = createMemoryVfs();
    const storage = createStorage({ vfs, maxSnapshots: 10, maxStorageBytes: 10_000_000 });
    storage._index.timeline = [{ id: "snap_1", ts: 1, accessedAt: 1 }];
    await storage._maybeEvict();
    expect(vfs.unlink).not.toHaveBeenCalled();
  });

  it("should_unlink_oldest_snapshot_when_maxSnapshots_exceeded", async () => {
    const vfs = createMemoryVfs();
    const storage = createStorage({ vfs, maxSnapshots: 1 });
    storage._index.timeline = [
      { id: "snap_old", ts: 1, accessedAt: 1 },
      { id: "snap_new", ts: 2, accessedAt: 2 },
    ];
    await storage._maybeEvict();
    expect(vfs.unlink).toHaveBeenCalledWith(storage._io.snapshotPath("snap_old"));
  });

  it("should_emit_event_when_evictions_occur_and_eventBus_present", async () => {
    const vfs = createMemoryVfs();
    const eventBus = { emit: vi.fn() };
    const storage = createStorage({ vfs, maxSnapshots: 1, eventBus });
    storage._index.timeline = [
      { id: "snap_old", ts: 1, accessedAt: 1 },
      { id: "snap_new", ts: 2, accessedAt: 2 },
    ];
    await storage._maybeEvict();
    expect(eventBus.emit).toHaveBeenCalledWith("l3:evicted", {
      runId: "run-1",
      evictedIds: ["snap_old"],
      count: 1,
    });
  });

  it("should_broadcast_eviction_when_tabCoordinator_present", async () => {
    const vfs = createMemoryVfs();
    const tabCoordinator = { broadcastEviction: vi.fn() };
    const storage = createStorage({ vfs, maxSnapshots: 1, tabCoordinator });
    storage._tabCoordinatorEnabled = true;
    storage._index.timeline = [
      { id: "snap_old", ts: 1, accessedAt: 1 },
      { id: "snap_new", ts: 2, accessedAt: 2 },
    ];
    await storage._maybeEvict();
    expect(tabCoordinator.broadcastEviction).toHaveBeenCalledWith("run-1::snap_old");
  });

  it("should_ignore_unlink_errors_during_eviction", async () => {
    const vfs = createMemoryVfs({
      unlink: vi.fn(async () => {
        throw new Error("unlink failed");
      }),
    });
    const storage = createStorage({ vfs, maxSnapshots: 1 });
    storage._index.timeline = [
      { id: "snap_old", ts: 1, accessedAt: 1 },
      { id: "snap_new", ts: 2, accessedAt: 2 },
    ];
    await storage._maybeEvict();
    expect(storage.getStorageStats().snapshotCount).toBe(1);
  });
});

describe("L3Storage stats and queries", () => {
  it("should_return_snapshotCount_when_getStorageStats_called", () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "a", ts: 1 }, { id: "b", ts: 2 }];
    expect(storage.getStorageStats().snapshotCount).toBe(2);
  });

  it("should_return_estimatedBytes_from_estimateStorageBytes_when_getStorageStats_called", () => {
    const storage = createStorage();
    h.estimateStorageBytes.mockReturnValueOnce(1234);
    expect(storage.getStorageStats().estimatedBytes).toBe(1234);
  });

  it("should_return_supersededSnapshotCount_when_getter_accessed", () => {
    const storage = createStorage();
    h.getSupersededSnapshotCount.mockReturnValueOnce(5);
    expect(storage.supersededSnapshotCount).toBe(5);
  });

  it("should_return_value_from_getTimeline_when_called", () => {
    const storage = createStorage();
    h.getTimeline.mockReturnValueOnce([{ id: "a" }]);
    expect(storage.getTimeline()).toEqual([{ id: "a" }]);
  });

  it("should_return_value_from_getSupersededTimeline_when_called", () => {
    const storage = createStorage();
    h.getSupersededTimeline.mockReturnValueOnce([{ id: "b" }]);
    expect(storage.getSupersededTimeline()).toEqual([{ id: "b" }]);
  });

  it("should_return_value_from_searchByKeyword_when_called", () => {
    const storage = createStorage();
    h.searchByKeyword.mockReturnValueOnce(["a"]);
    expect(storage.searchByKeyword("alpha")).toEqual(["a"]);
  });

  it("should_delegate_isDuplicate_to_query_module_when_called", () => {
    const storage = createStorage();
    h.isDuplicate.mockReturnValueOnce({ duplicate: true, existingId: "a" });
    expect(storage.isDuplicate({ value: 1 })).toEqual({ duplicate: true, existingId: "a" });
  });
});

describe("L3Storage superseding", () => {
  it("should_return_false_when_markSnapshotSuperseded_given_invalid_id", async () => {
    const storage = createStorage();
    expect(await storage.markSnapshotSuperseded(null, "x")).toBe(false);
  });

  it("should_return_false_when_markSnapshotSuperseded_index_returns_no_entry", async () => {
    const storage = createStorage();
    h.markSnapshotSupersededInIndex.mockReturnValueOnce({ entry: null, wasSuperseded: false });
    expect(await storage.markSnapshotSuperseded("snap_1", "fix")).toBe(false);
  });

  it("should_return_true_when_markSnapshotSuperseded_is_new", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    storage._snapshotCache.set("snap_1", { id: "snap_1" });
    expect(await storage.markSnapshotSuperseded("snap_1", "fix")).toBe(true);
  });

  it("should_return_false_when_markSnapshotSuperseded_called_twice", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    storage._snapshotCache.set("snap_1", { id: "snap_1" });
    await storage.markSnapshotSuperseded("snap_1", "fix");
    expect(await storage.markSnapshotSuperseded("snap_1", "fix")).toBe(false);
  });

  it("should_write_snapshot_when_markSnapshotSuperseded_has_cached_entry", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    storage._snapshotCache.set("snap_1", { id: "snap_1" });
    await storage.markSnapshotSuperseded("snap_1", "fix");
    expect(storage._io.writeJson).toHaveBeenCalled();
  });

  it("should_not_write_snapshot_when_markSnapshotSuperseded_has_no_cached_entry", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    await storage.markSnapshotSuperseded("snap_1", "fix");
    expect(storage._io.writeJson).not.toHaveBeenCalled();
  });

  it("should_return_0_when_markSnapshotsSuperseded_ids_is_not_array", async () => {
    const storage = createStorage();
    expect(await storage.markSnapshotsSuperseded({}, "fix")).toBe(0);
  });

  it("should_return_0_when_markSnapshotsSuperseded_all_ids_invalid", async () => {
    const storage = createStorage();
    expect(await storage.markSnapshotsSuperseded(["bad/id", ""], "fix")).toBe(0);
  });

  it("should_persistIndex_when_markSnapshotsSuperseded_touched_is_true", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    h.markSnapshotsSupersededInIndex.mockReturnValueOnce({ marked: 1, touched: true, updatedIds: [] });
    await storage.markSnapshotsSuperseded(["snap_1"], "fix");
    expect(storage._io.persistIndex).toHaveBeenCalled();
  });

  it("should_not_persistIndex_when_markSnapshotsSuperseded_touched_is_false", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    h.markSnapshotsSupersededInIndex.mockReturnValueOnce({ marked: 0, touched: false, updatedIds: [] });
    await storage.markSnapshotsSuperseded(["snap_1"], "fix");
    expect(storage._io.persistIndex).not.toHaveBeenCalled();
  });

  it("should_write_snapshots_for_updatedIds_when_cached", async () => {
    const storage = createStorage();
    storage._index.timeline = [{ id: "snap_1", ts: 1 }];
    storage._snapshotCache.set("snap_1", { id: "snap_1" });
    h.markSnapshotsSupersededInIndex.mockReturnValueOnce({ marked: 1, touched: true, updatedIds: ["snap_1"] });
    await storage.markSnapshotsSuperseded(["snap_1"], "fix");
    expect(storage._io.writeJson).toHaveBeenCalled();
  });
});

describe("L3Storage.waitForEviction", () => {
  it("should_resolve_when_no_evictionPromise", async () => {
    const storage = createStorage();
    await expect(storage.waitForEviction()).resolves.toBeUndefined();
  });

  it("should_await_when_evictionPromise_present", async () => {
    const storage = createStorage();
    /** @type {(value?: unknown) => void} */
    let resolve;
    storage._evictionPromise = new Promise((r) => {
      resolve = r;
    });
    const waited = storage.waitForEviction().then(() => "done");
    resolve();
    expect(await waited).toBe("done");
  });
});

describe("L3Storage.dispose", () => {
  it("should_log_warning_when_persistIndex_fails_during_dispose", async () => {
    const storage = createStorage();
    storage.persistIndex = vi.fn(async () => {
      throw new Error("fail");
    });
    await storage.dispose();
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("should_clear_caches_when_disposed", async () => {
    const storage = createStorage();
    storage._snapshotCache.set("a", { id: "a" });
    storage._checkpointCache.set("b", { id: "b" });
    await storage.dispose();
    expect(storage._snapshotCache.size).toBe(0);
  });

  it("should_be_idempotent_when_dispose_called_twice", async () => {
    const storage = createStorage();
    const persistSpy = vi.spyOn(storage, "persistIndex").mockResolvedValueOnce();
    await storage.dispose();
    await storage.dispose();
    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("should_throw_when_archive_called_after_dispose", async () => {
    const storage = createStorage();
    await storage.dispose();
    await expect(() => storage.archive("stage", { value: 1 }, [])).rejects.toThrow("disposed");
  });
});

describe("createL3Storage", () => {
  it("should_return_L3Storage_instance_when_called", () => {
    const vfs = createMemoryVfs();
    const storage = l3StorageModule.createL3Storage({ vfs, runId: "run-1" });
    expect(storage).toBeInstanceOf(l3StorageModule.L3Storage);
  });
});
