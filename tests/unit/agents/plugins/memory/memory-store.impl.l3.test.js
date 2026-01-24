import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeepClone = vi.hoisted(() => vi.fn());
const mockIsPlainObject = vi.hoisted(() => vi.fn());
const mockToNonEmptyString = vi.hoisted(() => vi.fn());

const mockDefineGetter = vi.hoisted(() => vi.fn((fn) => ({ get: fn, configurable: true })));
const mockDefineMethod = vi.hoisted(() => vi.fn((fn) => ({ value: fn, writable: true, configurable: true })));
const mockEstimateBytes = vi.hoisted(() => vi.fn());
const mockGenId = vi.hoisted(() => {
  let counters = new Map();
  const fn = vi.fn((prefix = "id") => {
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    return `${prefix}-${next}`;
  });
  fn.__reset = () => {
    counters = new Map();
  };
  return fn;
});
const mockTruncate = vi.hoisted(() => vi.fn());

const mockRecall = vi.hoisted(() => vi.fn());
const mockSemanticRecall = vi.hoisted(() => vi.fn());
const mockHybridRecall = vi.hoisted(() => vi.fn());
const mockRetrievalEngineConstructor = vi.hoisted(() => vi.fn());

const MockRetrievalEngine = vi.hoisted(() => {
  return class RetrievalEngine {
    constructor(options) {
      this.options = options;
      this.recall = mockRecall;
      this.semanticRecall = mockSemanticRecall;
      this.hybridRecall = mockHybridRecall;
      mockRetrievalEngineConstructor(options);
    }
  };
});

const mockL3StorageConstructor = vi.hoisted(() => vi.fn());
const mockL3StorageArchive = vi.hoisted(() => vi.fn());
const mockL3StorageGetSnapshot = vi.hoisted(() => vi.fn());
const mockL3StorageListCheckpoints = vi.hoisted(() => vi.fn());
const mockL3StorageCheckpoint = vi.hoisted(() => vi.fn());
const mockL3StorageGetCheckpoint = vi.hoisted(() => vi.fn());

const MockL3Storage = vi.hoisted(() => {
  return class L3Storage {
    constructor(options) {
      this.options = options;
      this.archive = mockL3StorageArchive;
      this.getSnapshot = mockL3StorageGetSnapshot;
      this.listCheckpoints = mockL3StorageListCheckpoints;
      this.checkpoint = mockL3StorageCheckpoint;
      this.getCheckpoint = mockL3StorageGetCheckpoint;
      mockL3StorageConstructor(options);
    }
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  deepClone: mockDeepClone,
  isPlainObject: mockIsPlainObject,
  toNonEmptyString: mockToNonEmptyString,
}));

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.utils.js", () => ({
  defineGetter: mockDefineGetter,
  defineMethod: mockDefineMethod,
  estimateBytes: mockEstimateBytes,
  genId: mockGenId,
  truncate: mockTruncate,
}));

vi.mock("../../../../../js/agents/plugins/memory/retrieval-engine.js", () => ({
  RetrievalEngine: MockRetrievalEngine,
}));

vi.mock("../../../../../js/agents/plugins/memory/l3-storage.js", () => ({
  L3Storage: MockL3Storage,
}));

import * as L3LayerModule from "../../../../../js/agents/plugins/memory/memory-store.impl.l3.js";

const createBaseL3 = () => ({
  snapshots: new Map(),
  index: {
    keywords: new Map(),
    stages: new Map(),
    timeline: [],
  },
  checkpoints: [],
});

const buildStore = (overrides = {}) => {
  const store = {
    _L0: null,
    _L1: null,
    _L2: null,
    _L3: createBaseL3(),
    _l3BytesUsed: 0,
    _stats: { archiveCount: 0, recallCount: 0 },
    config: { maxL3Bytes: Number.POSITIVE_INFINITY },
    runId: "run-1",
    _vfs: null,
    _l3Storage: null,
    _l3StoragePromise: null,
    _embeddingService: null,
    _vectorIndex: null,
    eventBus: null,
    _retrievalEngine: null,
    _dirty: { L0: false, L1: false, L2: false, L3: false },
    _emit: vi.fn(),
    _markDirty: vi.fn(),
    _recalculateTotalTokens: vi.fn(),
    cloneL0: vi.fn(() => ({ L0: "clone" })),
    cloneL1: vi.fn(() => ({ L1: "clone" })),
    cloneL2: vi.fn(() => ({ L2: "clone" })),
    _clearDirty: vi.fn(function () {
      this._dirty = { L0: false, L1: false, L2: false, L3: false };
    }),
    _updateTokenUsage: vi.fn(),
  };

  Object.defineProperties(store, L3LayerModule.defineL3Layer());
  Object.assign(store, overrides);
  return store;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenId.__reset?.();

  mockDeepClone.mockImplementation((value) => ({ cloned: value }));
  mockIsPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  mockToNonEmptyString.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
  });
  mockEstimateBytes.mockImplementation((value) => {
    if (value && typeof value === "object" && Number.isFinite(value.__bytes)) return value.__bytes;
    try {
      return JSON.stringify(value ?? "").length * 2;
    } catch {
      return 1024;
    }
  });
  mockTruncate.mockImplementation((text, maxLen = 200) => {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + "...";
  });

  mockL3StorageArchive.mockResolvedValue("snap-1");
  mockL3StorageGetSnapshot.mockResolvedValue(null);
  mockL3StorageListCheckpoints.mockResolvedValue([]);
  mockL3StorageCheckpoint.mockResolvedValue(undefined);
  mockL3StorageGetCheckpoint.mockResolvedValue(null);

  mockRecall.mockImplementation(() => []);
  mockSemanticRecall.mockResolvedValue([]);
  mockHybridRecall.mockResolvedValue([]);
});

describe("memory-store.impl.l3", () => {
  describe("exports", () => {
    it("should_import_all_exports_when_using_namespace_import", () => {
      expect(typeof L3LayerModule).toBe("object");
    });

    it("should_export_defineL3Layer_when_imported", () => {
      expect(typeof L3LayerModule.defineL3Layer).toBe("function");
    });
  });

  describe("defineL3Layer", () => {
    it("should_return_property_descriptors_when_called", () => {
      expect(typeof L3LayerModule.defineL3Layer()).toBe("object");
    });

    describe("L3 getter", () => {
      it("should_return_frozen_view_when_accessed", () => {
        const store = buildStore();

        const view = store.L3;

        expect(Object.isFrozen(view)).toBe(true);
      });

      it("should_return_snapshots_reference_when_accessed", () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { id: "s1" });

        const view = store.L3;

        expect(view.snapshots).toBe(store._L3.snapshots);
      });

      it("should_return_frozen_index_when_accessed", () => {
        const store = buildStore();

        const view = store.L3;

        expect(Object.isFrozen(view.index)).toBe(true);
      });

      it("should_return_keywords_reference_when_accessed", () => {
        const store = buildStore();

        const view = store.L3;

        expect(view.index.keywords).toBe(store._L3.index.keywords);
      });

      it("should_return_stages_reference_when_accessed", () => {
        const store = buildStore();

        const view = store.L3;

        expect(view.index.stages).toBe(store._L3.index.stages);
      });

      it("should_clone_timeline_array_when_accessed", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "one" });

        const view = store.L3;

        expect(view.index.timeline).not.toBe(store._L3.index.timeline);
      });

      it("should_match_timeline_entries_when_accessed", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "one" });

        const view = store.L3;

        expect(view.index.timeline).toEqual(store._L3.index.timeline);
      });

      it("should_freeze_timeline_array_when_accessed", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "one" });

        const view = store.L3;

        expect(Object.isFrozen(view.index.timeline)).toBe(true);
      });

      it("should_clone_checkpoints_array_when_accessed", () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "c1" });

        const view = store.L3;

        expect(view.checkpoints).not.toBe(store._L3.checkpoints);
      });

      it("should_match_checkpoints_entries_when_accessed", () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "c1" });

        const view = store.L3;

        expect(view.checkpoints).toEqual(store._L3.checkpoints);
      });

      it("should_freeze_checkpoints_array_when_accessed", () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "c1" });

        const view = store.L3;

        expect(Object.isFrozen(view.checkpoints)).toBe(true);
      });
    });

    describe("cloneL3", () => {
      it("should_call_deepClone_with_L3_state_when_called", () => {
        const store = buildStore();

        store.cloneL3();

        expect(mockDeepClone).toHaveBeenCalledWith(store._L3);
      });

      it("should_return_deepClone_result_when_called", () => {
        const store = buildStore();
        mockDeepClone.mockReturnValueOnce({ ok: true });

        const cloned = store.cloneL3();

        expect(cloned).toEqual({ ok: true });
      });
    });

    describe("_getL3Storage", () => {
      it("should_return_cached_storage_when_present", async () => {
        const existing = { id: "cached" };
        const store = buildStore({ _l3Storage: existing });

        const result = await store._getL3Storage();

        expect(result).toBe(existing);
      });

      it("should_return_null_when_vfs_missing", async () => {
        const store = buildStore({ _vfs: null });

        const result = await store._getL3Storage();

        expect(result).toBeNull();
      });

      it("should_return_inflight_storage_when_promise_exists", async () => {
        const pendingStorage = { id: "pending" };
        const store = buildStore({
          _vfs: { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() },
          _l3StoragePromise: Promise.resolve(pendingStorage),
        });

        const result = await store._getL3Storage();

        expect(result).toBe(pendingStorage);
      });

      it("should_construct_storage_with_vfs_and_runId_when_creating", async () => {
        const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
        const store = buildStore({ _vfs: vfs });

        await store._getL3Storage();

        expect(mockL3StorageConstructor).toHaveBeenCalledWith({ vfs, runId: store.runId });
      });

      it("should_cache_created_storage_on_store_when_creating", async () => {
        const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
        const store = buildStore({ _vfs: vfs });

        await store._getL3Storage();

        expect(store._l3Storage).not.toBeNull();
      });

      it("should_deduplicate_concurrent_creation_when_called_twice", async () => {
        const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
        const store = buildStore({ _vfs: vfs });

        await Promise.all([store._getL3Storage(), store._getL3Storage()]);

        expect(mockL3StorageConstructor).toHaveBeenCalledTimes(1);
      });

      it("should_return_same_instance_when_called_concurrently", async () => {
        const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
        const store = buildStore({ _vfs: vfs });

        const [first, second] = await Promise.all([store._getL3Storage(), store._getL3Storage()]);

        expect(first).toBe(second);
      });
    });

    describe("_evictOldestSnapshot", () => {
      it("should_keep_bytes_used_when_timeline_empty", () => {
        const store = buildStore();
        store._l3BytesUsed = 10;

        store._evictOldestSnapshot();

        expect(store._l3BytesUsed).toBe(10);
      });

      it("should_remove_oldest_timeline_entry_when_oldest_has_no_id", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ ts: 1 });

        store._evictOldestSnapshot();

        expect(store._L3.index.timeline.length).toBe(0);
      });

      it("should_delete_snapshot_when_oldest_id_exists", () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { id: "s1", __bytes: 5 });
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "old" });

        store._evictOldestSnapshot();

        expect(store._L3.snapshots.has("s1")).toBe(false);
      });

      it("should_decrease_bytes_used_when_snapshot_evicted", () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { id: "s1", __bytes: 5 });
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "old" });
        store._l3BytesUsed = 12;

        store._evictOldestSnapshot();

        expect(store._l3BytesUsed).toBe(7);
      });

      it("should_remove_evicted_snapshot_id_from_keyword_index", () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { id: "s1", __bytes: 5 });
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "old" });
        store._L3.index.keywords.set("alpha", new Set(["s1", "s2"]));

        store._evictOldestSnapshot();

        expect(store._L3.index.keywords.get("alpha").has("s1")).toBe(false);
      });

      it("should_not_change_bytes_used_when_snapshot_missing", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "s-missing", ts: 1, summary: "old" });
        store._l3BytesUsed = 12;

        store._evictOldestSnapshot();

        expect(store._l3BytesUsed).toBe(12);
      });
    });

    describe("_evictOldestCheckpoint", () => {
      it("should_keep_bytes_used_when_checkpoints_empty", () => {
        const store = buildStore();
        store._l3BytesUsed = 8;

        store._evictOldestCheckpoint();

        expect(store._l3BytesUsed).toBe(8);
      });

      it("should_keep_bytes_used_when_oldest_checkpoint_falsy", () => {
        const store = buildStore();
        store._l3BytesUsed = 6;
        store._L3.checkpoints.push(null);

        store._evictOldestCheckpoint();

        expect(store._l3BytesUsed).toBe(6);
      });

      it("should_decrease_bytes_used_when_checkpoint_evicted", () => {
        const store = buildStore();
        store._l3BytesUsed = 10;
        store._L3.checkpoints.push({ id: "c1", __bytes: 4 });

        store._evictOldestCheckpoint();

        expect(store._l3BytesUsed).toBe(6);
      });
    });

    describe("_ensureL3Capacity", () => {
      it.each([Number.POSITIVE_INFINITY, 0, -1])("should_not_evict_snapshots_when_maxL3Bytes_invalid_%s", (max) => {
        const store = buildStore({ config: { maxL3Bytes: max } });
        const snapshotSpy = vi.spyOn(store, "_evictOldestSnapshot");

        store._ensureL3Capacity(10);

        expect(snapshotSpy).not.toHaveBeenCalled();
      });

      it("should_evict_snapshots_before_checkpoints_when_over_capacity", () => {
        const store = buildStore({ config: { maxL3Bytes: 10 } });
        store._L3.snapshots.set("s1", { id: "s1", __bytes: 4 });
        store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "old" });
        store._L3.checkpoints.push({ id: "c1", __bytes: 3 });
        store._l3BytesUsed = 8;
        const snapshotSpy = vi.spyOn(store, "_evictOldestSnapshot");

        store._ensureL3Capacity(4);

        expect(snapshotSpy).toHaveBeenCalledTimes(1);
      });

      it("should_evict_checkpoints_when_no_snapshots_and_more_than_one_checkpoint", () => {
        const store = buildStore({ config: { maxL3Bytes: 10 } });
        store._L3.checkpoints.push({ id: "c1", __bytes: 3 }, { id: "c2", __bytes: 3 });
        store._l3BytesUsed = 12;
        const checkpointSpy = vi.spyOn(store, "_evictOldestCheckpoint");

        store._ensureL3Capacity(0);

        expect(checkpointSpy).toHaveBeenCalledTimes(1);
      });

      it("should_preserve_last_checkpoint_when_over_capacity", () => {
        const store = buildStore({ config: { maxL3Bytes: 10 } });
        store._L3.checkpoints.push({ id: "c1", __bytes: 3 });
        store._l3BytesUsed = 999;

        store._ensureL3Capacity(0);

        expect(store._L3.checkpoints.length).toBe(1);
      });
    });

    describe("archive", () => {
      it("should_return_generated_id_when_storage_missing", async () => {
        const store = buildStore();

        const id = await store.archive("stage-1", { summary: "ok" }, []);

        expect(id).toBe("snap-1");
      });

      it("should_store_entry_in_snapshots_when_storage_missing", async () => {
        const store = buildStore();

        const id = await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._L3.snapshots.has(id)).toBe(true);
      });

      it("should_increment_l3BytesUsed_when_entry_stored_in_memory", async () => {
        const store = buildStore();
        mockEstimateBytes.mockReturnValueOnce(5);

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._l3BytesUsed).toBe(5);
      });

      it("should_call_markDirty_L3_when_entry_stored_in_memory", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._markDirty).toHaveBeenCalledWith("L3");
      });

      it("should_add_lowercased_keyword_to_index_when_keyword_non_empty", async () => {
        const store = buildStore();

        const id = await store.archive("stage-1", { summary: "ok" }, ["Alpha"]);

        expect(store._L3.index.keywords.get("alpha").has(id)).toBe(true);
      });

      it("should_ignore_empty_keywords_when_keyword_blank", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, ["   "]);

        expect(store._L3.index.keywords.size).toBe(0);
      });

      it("should_deduplicate_keywords_when_duplicates_provided", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, ["Alpha", "ALPHA"]);

        expect(store._L3.index.keywords.get("alpha").size).toBe(1);
      });

      it("should_index_stageKey_when_stageKey_truthy", async () => {
        const store = buildStore();

        const id = await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._L3.index.stages.get("stage-1")).toBe(id);
      });

      it("should_not_index_stageKey_when_stageKey_falsy", async () => {
        const store = buildStore();

        await store.archive("", { summary: "ok" }, []);

        expect(store._L3.index.stages.size).toBe(0);
      });

      it("should_append_timeline_entry_when_archived_in_memory", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._L3.index.timeline.length).toBe(1);
      });

      it("should_emit_memory_archived_when_archived_in_memory", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._emit).toHaveBeenCalledWith("memory:archived", expect.any(Object));
      });

      it("should_emit_memory_l3_archive_when_archived_in_memory", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._emit).toHaveBeenCalledWith("memory:l3:archive", expect.any(Object));
      });

      it("should_increment_archiveCount_when_archived_in_memory", async () => {
        const store = buildStore();

        await store.archive("stage-1", { summary: "ok" }, []);

        expect(store._stats.archiveCount).toBe(1);
      });

      it("should_use_data_summary_when_data_contains_summary", async () => {
        const store = buildStore();

        const id = await store.archive("stage-1", { summary: "ok", payload: "value" }, []);

        expect(store._L3.snapshots.get(id).summary).toBe("ok");
      });

      it("should_call_truncate_when_data_summary_missing", async () => {
        const store = buildStore();

        await store.archive("stage-1", { payload: "x".repeat(1000) }, []);

        expect(mockTruncate).toHaveBeenCalled();
      });

      it("should_throw_when_data_null", async () => {
        const store = buildStore();

        await expect(store.archive("stage", null, [])).rejects.toThrow();
      });

      it("should_throw_when_data_undefined", async () => {
        const store = buildStore();

        await expect(store.archive("stage", undefined, [])).rejects.toThrow();
      });

      it("should_throw_when_keywords_non_iterable_object", async () => {
        const store = buildStore();

        await expect(store.archive("stage", { summary: "ok" }, { bad: true })).rejects.toThrow();
      });

      it("should_generate_unique_ids_when_archived_concurrently", async () => {
        const store = buildStore();

        const [first, second] = await Promise.all([
          store.archive("stage-a", { summary: "a" }, []),
          store.archive("stage-b", { summary: "b" }, []),
        ]);

        expect(first).not.toBe(second);
      });

      it("should_return_storage_id_when_storage_available", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-9");

        const id = await store.archive("stage", { summary: "data" }, ["k1"]);

        expect(id).toBe("snap-9");
      });

      it("should_not_mutate_in_memory_snapshots_when_storage_available", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-9");

        await store.archive("stage", { summary: "data" }, ["k1"]);

        expect(store._L3.snapshots.size).toBe(0);
      });

      it("should_increment_archiveCount_when_storage_available", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-9");

        await store.archive("stage", { summary: "data" }, ["k1"]);

        expect(store._stats.archiveCount).toBe(1);
      });

      it("should_emit_archived_event_with_storage_snapshot_stageKey_when_snapshot_found", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-9");
        mockL3StorageGetSnapshot.mockResolvedValueOnce({ id: "snap-9", stageKey: "stored", summary: "s", ts: 111 });

        await store.archive("stage", { summary: "data" }, ["k1"]);

        expect(store._emit).toHaveBeenCalledWith("memory:archived", expect.objectContaining({ stageKey: "stored" }));
      });

      it("should_emit_archived_event_with_input_stageKey_when_storage_snapshot_missing", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-10");
        mockL3StorageGetSnapshot.mockResolvedValueOnce(null);

        await store.archive("stage-10", { summary: "data" }, []);

        expect(store._emit).toHaveBeenCalledWith("memory:archived", expect.objectContaining({ stageKey: "stage-10" }));
      });

      it("should_emit_memory_l3_archive_with_keywordCount_when_storage_used", async () => {
        const store = buildStore({
          _l3Storage: {
            archive: mockL3StorageArchive,
            getSnapshot: mockL3StorageGetSnapshot,
          },
        });
        mockL3StorageArchive.mockResolvedValueOnce("snap-9");

        await store.archive("stage", { summary: "data" }, ["k1"]);

        expect(store._emit).toHaveBeenCalledWith("memory:l3:archive", expect.objectContaining({ keywordCount: 1 }));
      });
    });

    describe("_getRetrievalEngine", () => {
      it("should_return_existing_engine_when_engine_valid", () => {
        const engine = { recall: vi.fn() };
        const store = buildStore({ _retrievalEngine: engine });

        const result = store._getRetrievalEngine();

        expect(result).toBe(engine);
      });

      it("should_construct_new_engine_when_engine_missing", () => {
        const store = buildStore();

        store._getRetrievalEngine();

        expect(mockRetrievalEngineConstructor).toHaveBeenCalledTimes(1);
      });

      it("should_pass_expected_dependencies_when_constructing_engine", () => {
        const embeddingService = { id: "embed" };
        const vectorIndex = { id: "vector" };
        const eventBus = { id: "bus" };
        const store = buildStore({
          _embeddingService: embeddingService,
          _vectorIndex: vectorIndex,
          eventBus,
        });

        store._getRetrievalEngine();

        expect(mockRetrievalEngineConstructor).toHaveBeenCalledWith(
          expect.objectContaining({ memoryStore: store, embeddingService, vectorIndex, eventBus })
        );
      });

      it("should_cache_constructed_engine_on_store", () => {
        const store = buildStore();

        const result = store._getRetrievalEngine();

        expect(store._retrievalEngine).toBe(result);
      });
    });

    describe("recall", () => {
      it("should_increment_recallCount_when_called", () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(() => []) } });

        store.recall("q");

        expect(store._stats.recallCount).toBe(1);
      });

      it("should_delegate_to_engine_with_default_limit_when_limit_omitted", () => {
        const recallMock = vi.fn(() => []);
        const store = buildStore({ _retrievalEngine: { recall: recallMock } });

        store.recall("q");

        expect(recallMock).toHaveBeenCalledWith("q", 3);
      });

      it("should_return_engine_results_when_called", () => {
        const recallMock = vi.fn(() => ["r1", "r2"]);
        const store = buildStore({ _retrievalEngine: { recall: recallMock } });

        const result = store.recall("q", 2);

        expect(result).toEqual(["r1", "r2"]);
      });

      it("should_emit_memory_recall_event_when_called", () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(() => []) } });

        store.recall("q");

        expect(store._emit).toHaveBeenCalledWith("memory:recall", expect.any(Object));
      });

      it("should_truncate_query_to_100_chars_when_query_is_long_string", () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(() => []) } });

        store.recall("q".repeat(150));

        expect(store._emit.mock.calls[0][1].query.length).toBe(100);
      });

      it("should_emit_non_string_placeholder_when_query_is_not_string", () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(() => []) } });

        store.recall({ q: "x" });

        expect(store._emit.mock.calls[0][1].query).toBe("(non-string)");
      });
    });

    describe("semanticRecall", () => {
      it("should_increment_recallCount_when_called", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), semanticRecall: vi.fn(async () => []) } });

        await store.semanticRecall("q");

        expect(store._stats.recallCount).toBe(1);
      });

      it("should_delegate_to_engine_semanticRecall_when_called", async () => {
        const semanticMock = vi.fn(async () => ["s1"]);
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), semanticRecall: semanticMock } });

        await store.semanticRecall("q", { limit: 1 });

        expect(semanticMock).toHaveBeenCalledWith("q", { limit: 1 });
      });

      it("should_return_results_when_engine_resolves", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), semanticRecall: vi.fn(async () => ["s1"]) } });

        const result = await store.semanticRecall("q");

        expect(result).toEqual(["s1"]);
      });

      it("should_emit_semantic_method_when_called", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), semanticRecall: vi.fn(async () => []) } });

        await store.semanticRecall("q");

        expect(store._emit.mock.calls[0][1].method).toBe("semantic");
      });
    });

    describe("hybridRecall", () => {
      it("should_increment_recallCount_when_called", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), hybridRecall: vi.fn(async () => []) } });

        await store.hybridRecall("q");

        expect(store._stats.recallCount).toBe(1);
      });

      it("should_delegate_to_engine_hybridRecall_when_called", async () => {
        const hybridMock = vi.fn(async () => ["h1"]);
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), hybridRecall: hybridMock } });

        await store.hybridRecall("q", { limit: 2 });

        expect(hybridMock).toHaveBeenCalledWith("q", { limit: 2 });
      });

      it("should_return_results_when_engine_resolves", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), hybridRecall: vi.fn(async () => ["h1"]) } });

        const result = await store.hybridRecall("q");

        expect(result).toEqual(["h1"]);
      });

      it("should_emit_hybrid_method_when_called", async () => {
        const store = buildStore({ _retrievalEngine: { recall: vi.fn(), hybridRecall: vi.fn(async () => []) } });

        await store.hybridRecall("q");

        expect(store._emit.mock.calls[0][1].method).toBe("hybrid");
      });
    });

    describe("listArchives", () => {
      it("should_return_reverse_chronological_entries_when_called", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "a", ts: 1 }, { id: "b", ts: 2 }, { id: "c", ts: 3 });

        const ids = store.listArchives().map((entry) => entry.id);

        expect(ids).toEqual(["c", "b", "a"]);
      });

      it("should_apply_limit_when_limit_provided_as_string", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "a", ts: 1 }, { id: "b", ts: 2 }, { id: "c", ts: 3 });

        const ids = store.listArchives("2").map((entry) => entry.id);

        expect(ids).toEqual(["c", "b"]);
      });

      it("should_return_all_entries_when_limit_is_zero", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "a", ts: 1 }, { id: "b", ts: 2 }, { id: "c", ts: 3 });

        const ids = store.listArchives(0).map((entry) => entry.id);

        expect(ids).toEqual(["c", "b", "a"]);
      });

      it("should_return_all_entries_when_limit_is_large", () => {
        const store = buildStore();
        store._L3.index.timeline.push({ id: "a", ts: 1 }, { id: "b", ts: 2 }, { id: "c", ts: 3 });

        const result = store.listArchives(Number.MAX_SAFE_INTEGER);

        expect(result.length).toBe(3);
      });
    });

    describe("getSnapshot", () => {
      it("should_delegate_to_storage_getSnapshot_when_storage_available", async () => {
        const storage = { getSnapshot: vi.fn(async () => ({ id: "s1" })) };
        const store = buildStore({ _l3Storage: storage });

        await store.getSnapshot("s1");

        expect(storage.getSnapshot).toHaveBeenCalledWith("s1");
      });

      it.each([null, undefined, "", "   ", [], {}])("should_return_null_when_snapshotId_invalid_%s", async (value) => {
        const store = buildStore();

        const result = await store.getSnapshot(value);

        expect(result).toBeNull();
      });

      it("should_return_snapshot_from_memory_when_id_valid", async () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { id: "s1" });

        const result = await store.getSnapshot("s1");

        expect(result).toEqual({ id: "s1" });
      });

      it("should_accept_numeric_snapshotId_when_without_storage", async () => {
        const store = buildStore();
        store._L3.snapshots.set("123", { id: "123" });

        const result = await store.getSnapshot(123);

        expect(result).toEqual({ id: "123" });
      });
    });

    describe("checkpoint", () => {
      it("should_return_checkpoint_id_when_created_in_memory", async () => {
        const store = buildStore();

        const id = await store.checkpoint({});

        expect(id).toBe("ckpt-1");
      });

      it("should_push_checkpoint_to_memory_when_created_in_memory", async () => {
        const store = buildStore();

        await store.checkpoint({});

        expect(store._L3.checkpoints.length).toBe(1);
      });

      it("should_create_full_checkpoint_when_forced_by_schedule", async () => {
        const store = buildStore();

        await store.checkpoint({});

        expect(store._L3.checkpoints[0].encoding).toBe("full");
      });

      it("should_include_L0_in_full_checkpoint", async () => {
        const store = buildStore();

        await store.checkpoint({});

        expect(store._L3.checkpoints[0].L0).toEqual({ L0: "clone" });
      });

      it("should_call_recalculateTotalTokens_when_checkpoint_created_in_memory", async () => {
        const store = buildStore();

        await store.checkpoint({});

        expect(store._recalculateTotalTokens).toHaveBeenCalledTimes(1);
      });

      it("should_update_l3BytesUsed_when_checkpoint_stored_in_memory", async () => {
        const store = buildStore();
        mockEstimateBytes.mockReturnValueOnce(5);

        await store.checkpoint({});

        expect(store._l3BytesUsed).toBe(5);
      });

      it("should_clear_dirty_when_checkpoint_created_in_memory", async () => {
        const store = buildStore();

        await store.checkpoint({});

        expect(store._clearDirty).toHaveBeenCalledTimes(1);
      });

      it("should_call_ensureL3Capacity_with_snapshot_bytes_when_checkpoint_created", async () => {
        const store = buildStore();
        mockEstimateBytes.mockReturnValueOnce(5);
        const ensureSpy = vi.spyOn(store, "_ensureL3Capacity");

        await store.checkpoint({});

        expect(ensureSpy).toHaveBeenCalledWith(5);
      });

      it("should_create_incremental_checkpoint_when_dirty_and_not_forced_full", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });
        store._dirty = { L0: false, L1: true, L2: false, L3: false };

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].encoding).toBe("incremental");
      });

      it("should_record_dirtyLayers_when_incremental_checkpoint_created", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });
        store._dirty = { L0: false, L1: true, L2: false, L3: false };

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].dirtyLayers).toEqual({ L0: false, L1: true, L2: false, L3: false });
      });

      it("should_set_baseId_to_last_checkpoint_when_incremental_checkpoint_created", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });
        store._dirty = { L0: false, L1: true, L2: false, L3: false };

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].baseId).toBe("base");
      });

      it("should_include_dirty_layer_clone_when_incremental_checkpoint_created", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });
        store._dirty = { L0: false, L1: true, L2: false, L3: false };

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].L1).toEqual({ L1: "clone" });
      });

      it("should_not_include_clean_layer_clone_when_incremental_checkpoint_created", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });
        store._dirty = { L0: false, L1: true, L2: false, L3: false };

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].L0).toBeUndefined();
      });

      it("should_create_full_checkpoint_when_no_layers_dirty_even_if_incremental_true", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "base", encoding: "full" });

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(store._L3.checkpoints[1].encoding).toBe("full");
      });

      it("should_call_isPlainObject_when_options_not_plain_object", async () => {
        const store = buildStore();

        await store.checkpoint("not-object");

        expect(mockIsPlainObject).toHaveBeenCalledWith("not-object");
      });

      it("should_call_storage_checkpoint_when_storage_available", async () => {
        const store = buildStore({
          _l3Storage: {
            listCheckpoints: mockL3StorageListCheckpoints,
            checkpoint: mockL3StorageCheckpoint,
          },
        });

        await store.checkpoint({});

        expect(mockL3StorageCheckpoint).toHaveBeenCalledTimes(1);
      });

      it("should_return_checkpoint_id_when_storage_available", async () => {
        const store = buildStore({
          _l3Storage: {
            listCheckpoints: mockL3StorageListCheckpoints,
            checkpoint: mockL3StorageCheckpoint,
          },
        });

        const id = await store.checkpoint({});

        expect(id).toBe("ckpt-1");
      });

      it("should_clear_dirty_when_storage_checkpoint_succeeds", async () => {
        const store = buildStore({
          _l3Storage: {
            listCheckpoints: mockL3StorageListCheckpoints,
            checkpoint: mockL3StorageCheckpoint,
          },
        });

        await store.checkpoint({});

        expect(store._clearDirty).toHaveBeenCalledTimes(1);
      });

      it("should_set_baseId_from_storage_checkpoint_index_when_incremental", async () => {
        const store = buildStore({
          _l3Storage: {
            listCheckpoints: mockL3StorageListCheckpoints,
            checkpoint: mockL3StorageCheckpoint,
          },
        });
        store._dirty = { L0: true, L1: false, L2: false, L3: false };
        mockL3StorageListCheckpoints.mockResolvedValueOnce([{ id: "base" }]);

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(mockL3StorageCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ baseId: "base" }));
      });

      it("should_write_full_checkpoint_to_storage_when_checkpointCount_hits_fullSnapshotEvery", async () => {
        const store = buildStore({
          _l3Storage: {
            listCheckpoints: mockL3StorageListCheckpoints,
            checkpoint: mockL3StorageCheckpoint,
          },
        });
        store._dirty = { L0: true, L1: false, L2: false, L3: false };
        mockL3StorageListCheckpoints.mockResolvedValueOnce([]);

        await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

        expect(mockL3StorageCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ encoding: "full" }));
      });
    });

    describe("_hasAnyDirty", () => {
      it("should_return_false_when_all_dirty_flags_false", () => {
        const store = buildStore();

        const result = store._hasAnyDirty();

        expect(result).toBe(false);
      });

      it("should_return_true_when_any_dirty_flag_true", () => {
        const store = buildStore();
        store._dirty.L2 = true;

        const result = store._hasAnyDirty();

        expect(result).toBe(true);
      });
    });

    describe("restore", () => {
      it("should_return_false_when_checkpoint_missing_in_memory", async () => {
        const store = buildStore();

        const result = await store.restore("missing");

        expect(result).toBe(false);
      });

      it("should_return_true_when_full_checkpoint_restored_in_memory", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "full", encoding: "full", L0: { foo: 1 } });

        const result = await store.restore("full");

        expect(result).toBe(true);
      });

      it("should_apply_L0_when_restoring_full_checkpoint_in_memory", async () => {
        const store = buildStore();
        const ckpt = { id: "full", encoding: "full", L0: { foo: 1 } };
        store._L3.checkpoints.push(ckpt);

        await store.restore("full");

        expect(store._L0).toEqual({ cloned: ckpt.L0 });
      });

      it("should_call_updateTokenUsage_when_restore_succeeds_in_memory", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "full", encoding: "full", L0: { foo: 1 } });

        await store.restore("full");

        expect(store._updateTokenUsage).toHaveBeenCalledTimes(1);
      });

      it("should_clear_dirty_when_restore_succeeds_in_memory", async () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "full", encoding: "full", L0: { foo: 1 } });

        await store.restore("full");

        expect(store._clearDirty).toHaveBeenCalledTimes(1);
      });

      it("should_call_restoreFromBase_when_incremental_checkpoint_has_baseId", async () => {
        const ckpt = { id: "inc", encoding: "incremental", baseId: "base", L0: { foo: 1 } };
        const store = buildStore({ _restoreFromBase: vi.fn(() => true) });
        store._L3.checkpoints.push(ckpt);

        await store.restore("inc");

        expect(store._restoreFromBase).toHaveBeenCalledWith(ckpt);
      });

      it("should_fallback_to_incremental_layers_when_restoreFromBase_returns_false", async () => {
        const ckpt = { id: "inc", encoding: "incremental", baseId: "missing", L0: { foo: 1 } };
        const store = buildStore({ _restoreFromBase: vi.fn(() => false) });
        store._L3.checkpoints.push(ckpt);

        await store.restore("inc");

        expect(store._L0).toEqual({ cloned: ckpt.L0 });
      });

      it("should_return_false_when_storage_checkpointId_invalid", async () => {
        const store = buildStore({ _l3Storage: { getCheckpoint: vi.fn() } });

        const result = await store.restore(null);

        expect(result).toBe(false);
      });

      it("should_not_call_storage_getCheckpoint_when_checkpointId_invalid", async () => {
        const storage = { getCheckpoint: vi.fn() };
        const store = buildStore({ _l3Storage: storage });

        await store.restore("   ");

        expect(storage.getCheckpoint).not.toHaveBeenCalled();
      });

      it("should_return_false_when_storage_checkpoint_missing", async () => {
        const storage = { getCheckpoint: vi.fn(async () => null) };
        const store = buildStore({ _l3Storage: storage });

        const result = await store.restore("ckpt-x");

        expect(result).toBe(false);
      });

      it("should_call_restoreFromBaseStorage_when_storage_incremental_checkpoint_has_baseId", async () => {
        const ckpt = { id: "ckpt-2", encoding: "incremental", baseId: "base", L0: { foo: 1 } };
        const storage = { getCheckpoint: vi.fn(async () => ckpt) };
        const store = buildStore({ _l3Storage: storage, _restoreFromBaseStorage: vi.fn(async () => true) });

        await store.restore("ckpt-2");

        expect(store._restoreFromBaseStorage).toHaveBeenCalledWith(ckpt, storage);
      });

      it("should_fallback_to_layers_when_restoreFromBaseStorage_returns_false", async () => {
        const ckpt = { id: "ckpt-2", encoding: "incremental", baseId: "base", L0: { foo: 1 } };
        const storage = { getCheckpoint: vi.fn(async () => ckpt) };
        const store = buildStore({ _l3Storage: storage, _restoreFromBaseStorage: vi.fn(async () => false) });

        await store.restore("ckpt-2");

        expect(store._L0).toEqual({ cloned: ckpt.L0 });
      });

      it("should_restore_full_checkpoint_layers_from_storage", async () => {
        const ckpt = { id: "ckpt-full", encoding: "full", L0: { foo: 1 } };
        const storage = { getCheckpoint: vi.fn(async () => ckpt) };
        const store = buildStore({ _l3Storage: storage });

        await store.restore("ckpt-full");

        expect(store._L0).toEqual({ cloned: ckpt.L0 });
      });

      it("should_call_updateTokenUsage_when_storage_restore_succeeds", async () => {
        const ckpt = { id: "ckpt-full", encoding: "full", L0: { foo: 1 } };
        const storage = { getCheckpoint: vi.fn(async () => ckpt) };
        const store = buildStore({ _l3Storage: storage });

        await store.restore("ckpt-full");

        expect(store._updateTokenUsage).toHaveBeenCalledTimes(1);
      });

      it("should_clear_dirty_when_storage_restore_succeeds", async () => {
        const ckpt = { id: "ckpt-full", encoding: "full", L0: { foo: 1 } };
        const storage = { getCheckpoint: vi.fn(async () => ckpt) };
        const store = buildStore({ _l3Storage: storage });

        await store.restore("ckpt-full");

        expect(store._clearDirty).toHaveBeenCalledTimes(1);
      });
    });

    describe("_restoreFromBase", () => {
      it("should_return_true_when_chain_reaches_full_checkpoint", () => {
        const store = buildStore();
        const base = { id: "base", encoding: "full", L0: { value: "base" }, L1: { value: 1 } };
        const mid = { id: "mid", encoding: "incremental", baseId: "base", L0: { value: "mid" } };
        const inc = { id: "inc", encoding: "incremental", baseId: "mid", L1: { value: 2 } };
        store._L3.checkpoints.push(base, mid, inc);

        const result = store._restoreFromBase(inc);

        expect(result).toBe(true);
      });

      it("should_set_L0_to_latest_value_in_chain_when_restored", () => {
        const store = buildStore();
        const base = { id: "base", encoding: "full", L0: { value: "base" }, L1: { value: 1 } };
        const mid = { id: "mid", encoding: "incremental", baseId: "base", L0: { value: "mid" } };
        const inc = { id: "inc", encoding: "incremental", baseId: "mid", L1: { value: 2 } };
        store._L3.checkpoints.push(base, mid, inc);

        store._restoreFromBase(inc);

        expect(store._L0).toEqual({ cloned: mid.L0 });
      });

      it("should_set_L1_to_latest_value_in_chain_when_restored", () => {
        const store = buildStore();
        const base = { id: "base", encoding: "full", L0: { value: "base" }, L1: { value: 1 } };
        const mid = { id: "mid", encoding: "incremental", baseId: "base", L0: { value: "mid" } };
        const inc = { id: "inc", encoding: "incremental", baseId: "mid", L1: { value: 2 } };
        store._L3.checkpoints.push(base, mid, inc);

        store._restoreFromBase(inc);

        expect(store._L1).toEqual({ cloned: inc.L1 });
      });

      it("should_return_false_when_no_full_checkpoint_found", () => {
        const store = buildStore();
        const inc = { id: "inc", encoding: "incremental", baseId: "missing", L0: { value: "x" } };
        store._L3.checkpoints.push(inc);

        const result = store._restoreFromBase(inc);

        expect(result).toBe(false);
      });
    });

    describe("_restoreFromBaseStorage", () => {
      it("should_return_true_when_full_base_found_in_storage", async () => {
        const store = buildStore();
        const incremental = { id: "inc", encoding: "incremental", baseId: "base", L0: { value: "inc" } };
        const storage = {
          getCheckpoint: vi.fn(async (id) => {
            if (id === "base") return { id: "base", encoding: "full", L0: { value: "base" } };
            return null;
          }),
        };

        const result = await store._restoreFromBaseStorage(incremental, storage);

        expect(result).toBe(true);
      });

      it("should_set_L0_to_latest_value_when_restored_from_storage_chain", async () => {
        const store = buildStore();
        const incremental = { id: "inc", encoding: "incremental", baseId: "base", L0: { value: "inc" } };
        const storage = {
          getCheckpoint: vi.fn(async (id) => {
            if (id === "base") return { id: "base", encoding: "full", L0: { value: "base" } };
            return null;
          }),
        };

        await store._restoreFromBaseStorage(incremental, storage);

        expect(store._L0).toEqual({ cloned: incremental.L0 });
      });

      it("should_return_false_when_cycle_detected_in_base_chain", async () => {
        const store = buildStore();
        const incremental = { id: "loop", encoding: "incremental", baseId: "loop", L0: { value: "loop" } };
        const storage = { getCheckpoint: vi.fn() };

        const result = await store._restoreFromBaseStorage(incremental, storage);

        expect(result).toBe(false);
      });

      it("should_not_call_storage_when_cycle_detected_in_base_chain", async () => {
        const store = buildStore();
        const incremental = { id: "loop", encoding: "incremental", baseId: "loop", L0: { value: "loop" } };
        const storage = { getCheckpoint: vi.fn() };

        await store._restoreFromBaseStorage(incremental, storage);

        expect(storage.getCheckpoint).not.toHaveBeenCalled();
      });
    });

    describe("getLatestCheckpoint", () => {
      it("should_return_null_when_no_checkpoints", () => {
        const store = buildStore();

        const latest = store.getLatestCheckpoint();

        expect(latest).toBeNull();
      });

      it("should_return_last_checkpoint_when_checkpoints_exist", () => {
        const store = buildStore();
        store._L3.checkpoints.push({ id: "c1" }, { id: "c2" });

        const latest = store.getLatestCheckpoint();

        expect(latest.id).toBe("c2");
      });
    });

    describe("_recalculateL3Bytes", () => {
      it("should_sum_snapshot_and_checkpoint_sizes_when_called", () => {
        const store = buildStore();
        store._L3.snapshots.set("s1", { __bytes: 3 });
        store._L3.snapshots.set("s2", { __bytes: 4 });
        store._L3.checkpoints.push({ __bytes: 5 });

        store._recalculateL3Bytes();

        expect(store._l3BytesUsed).toBe(12);
      });
    });
  });
});