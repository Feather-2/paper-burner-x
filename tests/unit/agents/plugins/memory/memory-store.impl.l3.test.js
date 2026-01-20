import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { defineL3Layer } from "../../../../../js/agents/plugins/memory/memory-store.impl.l3.js";

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

  Object.defineProperties(store, defineL3Layer());
  Object.assign(store, overrides);
  return store;
};

const buildDeepObject = (depth, leafValue = "x") => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.value = leafValue;
  return root;
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
    if (typeof value === "string") return value.length * 2;
    if (typeof value === "number") return 8;
    if (typeof value === "boolean") return 4;
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

describe("defineL3Layer", () => {
  describe("L3 getter", () => {
    it("returns a frozen shallow view with expected references", () => {
      const store = buildStore();
      store._L3.snapshots.set("s1", { id: "s1" });
      store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "one" });
      store._L3.checkpoints.push({ id: "c1" });

      const view = store.L3;

      expect(Object.isFrozen(view)).toBe(true);
      expect(view.snapshots).toBe(store._L3.snapshots);
      expect(Object.isFrozen(view.index)).toBe(true);
      expect(view.index.keywords).toBe(store._L3.index.keywords);
      expect(view.index.stages).toBe(store._L3.index.stages);
      expect(view.index.timeline).not.toBe(store._L3.index.timeline);
      expect(view.index.timeline).toEqual(store._L3.index.timeline);
      expect(Object.isFrozen(view.index.timeline)).toBe(true);
      expect(view.checkpoints).not.toBe(store._L3.checkpoints);
      expect(view.checkpoints).toEqual(store._L3.checkpoints);
      expect(Object.isFrozen(view.checkpoints)).toBe(true);
    });
  });

  describe("cloneL3", () => {
    it("delegates to deepClone with L3 state", () => {
      const store = buildStore();

      const cloned = store.cloneL3();

      expect(mockDeepClone).toHaveBeenCalledWith(store._L3);
      expect(cloned).toEqual({ cloned: store._L3 });
    });
  });

  describe("_getL3Storage", () => {
    it("returns cached storage when available", async () => {
      const existing = { id: "cached" };
      const store = buildStore({ _l3Storage: existing });

      const result = await store._getL3Storage();

      expect(result).toBe(existing);
      expect(mockL3StorageConstructor).not.toHaveBeenCalled();
    });

    it("returns null when vfs is missing", async () => {
      const store = buildStore({ _vfs: null });

      const result = await store._getL3Storage();

      expect(result).toBeNull();
      expect(mockL3StorageConstructor).not.toHaveBeenCalled();
    });

    it("awaits an in-flight storage promise", async () => {
      const pending = Promise.resolve({ id: "pending" });
      const store = buildStore({
        _vfs: { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() },
        _l3StoragePromise: pending,
      });

      const result = await store._getL3Storage();

      expect(result).toEqual({ id: "pending" });
      expect(mockL3StorageConstructor).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent creation", async () => {
      const vfs = { readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() };
      const store = buildStore({ _vfs: vfs });

      const [first, second] = await Promise.all([store._getL3Storage(), store._getL3Storage()]);

      expect(first).toBe(second);
      expect(mockL3StorageConstructor).toHaveBeenCalledTimes(1);
      expect(mockL3StorageConstructor).toHaveBeenCalledWith({ vfs, runId: store.runId });
    });
  });

  describe("_evictOldestSnapshot", () => {
    it("does nothing when timeline is empty", () => {
      const store = buildStore();
      store._l3BytesUsed = 10;

      store._evictOldestSnapshot();

      expect(store._l3BytesUsed).toBe(10);
      expect(store._L3.snapshots.size).toBe(0);
    });

    it("skips entries without an id", () => {
      const store = buildStore();
      store._L3.index.timeline.push({ ts: 1 });

      store._evictOldestSnapshot();

      expect(store._L3.index.timeline.length).toBe(0);
      expect(store._L3.snapshots.size).toBe(0);
    });

    it("removes the oldest snapshot and keyword references", () => {
      const store = buildStore();
      const entry = { id: "s1", summary: "old", __bytes: 5 };
      store._L3.snapshots.set("s1", entry);
      store._L3.index.timeline.push({ id: "s1", ts: 1, summary: "old" });
      store._L3.index.keywords.set("alpha", new Set(["s1", "s2"]));
      store._L3.index.keywords.set("beta", new Set(["s1"]));
      store._l3BytesUsed = 12;

      store._evictOldestSnapshot();

      expect(store._L3.snapshots.has("s1")).toBe(false);
      expect(store._l3BytesUsed).toBe(7);
      expect(store._L3.index.keywords.get("alpha").has("s1")).toBe(false);
      expect(store._L3.index.keywords.get("beta").has("s1")).toBe(false);
      expect(store._L3.index.timeline.length).toBe(0);
    });
  });

  describe("_evictOldestCheckpoint", () => {
    it("does nothing when checkpoints are empty", () => {
      const store = buildStore();
      store._l3BytesUsed = 8;

      store._evictOldestCheckpoint();

      expect(store._l3BytesUsed).toBe(8);
    });

    it("ignores falsy checkpoints", () => {
      const store = buildStore();
      store._l3BytesUsed = 6;
      store._L3.checkpoints.push(null);

      store._evictOldestCheckpoint();

      expect(store._l3BytesUsed).toBe(6);
    });

    it("removes the oldest checkpoint and updates bytes", () => {
      const store = buildStore();
      store._l3BytesUsed = 10;
      store._L3.checkpoints.push({ id: "c1", __bytes: 4 });

      store._evictOldestCheckpoint();

      expect(store._l3BytesUsed).toBe(6);
      expect(store._L3.checkpoints.length).toBe(0);
    });
  });

  describe("_ensureL3Capacity", () => {
    it.each([0, -1, Number.POSITIVE_INFINITY])("returns early for maxL3Bytes=%s", (max) => {
      const store = buildStore({ config: { maxL3Bytes: max } });
      const snapshotSpy = vi.spyOn(store, "_evictOldestSnapshot");
      const checkpointSpy = vi.spyOn(store, "_evictOldestCheckpoint");

      store._ensureL3Capacity(10);

      expect(snapshotSpy).not.toHaveBeenCalled();
      expect(checkpointSpy).not.toHaveBeenCalled();
    });

    it("evicts snapshots before checkpoints", () => {
      const store = buildStore({ config: { maxL3Bytes: 10 } });
      store._L3.snapshots.set("s1", { id: "s1", __bytes: 4 });
      store._L3.index.timeline.push({ id: "s1", ts: 1 });
      store._L3.checkpoints.push({ id: "c1", __bytes: 3 });
      store._l3BytesUsed = 8;
      const snapshotSpy = vi.spyOn(store, "_evictOldestSnapshot");
      const checkpointSpy = vi.spyOn(store, "_evictOldestCheckpoint");

      store._ensureL3Capacity(4);

      expect(snapshotSpy).toHaveBeenCalledTimes(1);
      expect(checkpointSpy).not.toHaveBeenCalled();
      expect(store._L3.snapshots.has("s1")).toBe(false);
      expect(store._L3.checkpoints.length).toBe(1);
      expect(store._l3BytesUsed).toBe(4);
    });

    it("evicts checkpoints when snapshots are gone and preserves one", () => {
      const store = buildStore({ config: { maxL3Bytes: 10 } });
      store._L3.checkpoints.push({ id: "c1", __bytes: 3 }, { id: "c2", __bytes: 3 });
      store._l3BytesUsed = 12;
      const checkpointSpy = vi.spyOn(store, "_evictOldestCheckpoint");

      store._ensureL3Capacity(0);

      expect(checkpointSpy).toHaveBeenCalledTimes(1);
      expect(store._L3.checkpoints.length).toBe(1);
      expect(store._l3BytesUsed).toBe(9);
    });
  });

  describe("archive", () => {
    it("archives in memory, updates indexes, and emits events", async () => {
      const store = buildStore();
      const ensureSpy = vi.spyOn(store, "_ensureL3Capacity");
      const keywords = ["Alpha", "  ", null, "beta", "ALPHA", 0];
      const data = { summary: "ok", payload: "value" };

      const id = await store.archive("stage-1", data, keywords);

      expect(id).toBe("snap-1");
      const entry = store._L3.snapshots.get(id);
      expect(entry.summary).toBe("ok");
      expect(entry.stageKey).toBe("stage-1");
      expect(store._L3.index.stages.get("stage-1")).toBe(id);
      expect(store._L3.index.timeline[0].id).toBe(id);
      expect(store._L3.index.keywords.get("alpha")).toEqual(new Set([id]));
      expect(store._L3.index.keywords.get("beta")).toEqual(new Set([id]));
      expect(store._L3.index.keywords.get("0")).toEqual(new Set([id]));
      expect(store._markDirty).toHaveBeenCalledWith("L3");
      expect(store._stats.archiveCount).toBe(1);
      expect(ensureSpy).toHaveBeenCalledWith(expect.any(Number));
      expect(store._emit).toHaveBeenCalledWith(
        "memory:archived",
        expect.objectContaining({ id, stageKey: "stage-1", summary: "ok" })
      );
      expect(store._emit).toHaveBeenCalledWith(
        "memory:l3:archive",
        expect.objectContaining({ id, stageKey: "stage-1", keywordCount: keywords.length })
      );
    });

    it("truncates large payloads and handles deep nesting", async () => {
      const store = buildStore();
      const deep = buildDeepObject(30, "x".repeat(50000));

      const id = await store.archive("", deep, []);

      const entry = store._L3.snapshots.get(id);
      expect(entry.summary.length).toBeLessThanOrEqual(200);
      const [textArg, maxLenArg] = mockTruncate.mock.calls[0];
      expect(textArg.length).toBeGreaterThan(200);
      expect(maxLenArg).toBe(200);
      expect(store._L3.index.stages.size).toBe(0);
    });

    it("throws when data is null or undefined", async () => {
      const store = buildStore();

      await expect(store.archive("stage", null)).rejects.toThrow();
      await expect(store.archive("stage", undefined)).rejects.toThrow();
    });

    it("throws when keywords is a non-iterable object", async () => {
      const store = buildStore();

      await expect(store.archive("stage", { summary: "ok" }, { bad: true })).rejects.toThrow();
    });

    it("uses storage backend and emits stored metadata", async () => {
      const store = buildStore({
        _l3Storage: {
          archive: mockL3StorageArchive,
          getSnapshot: mockL3StorageGetSnapshot,
        },
      });
      mockL3StorageArchive.mockResolvedValueOnce("snap-9");
      mockL3StorageGetSnapshot.mockResolvedValueOnce({
        id: "snap-9",
        stageKey: "stored",
        summary: "stored summary",
        ts: 111,
      });

      const id = await store.archive("stage", { summary: "data" }, ["k1"]);

      expect(id).toBe("snap-9");
      expect(store._stats.archiveCount).toBe(1);
      expect(store._L3.snapshots.size).toBe(0);
      expect(store._emit).toHaveBeenCalledWith(
        "memory:archived",
        expect.objectContaining({ id: "snap-9", stageKey: "stored", summary: "stored summary", ts: 111 })
      );
      expect(store._emit).toHaveBeenCalledWith(
        "memory:l3:archive",
        expect.objectContaining({ id: "snap-9", stageKey: "stored", keywordCount: 1 })
      );
    });

    it("falls back to minimal metadata when storage snapshot is missing", async () => {
      const store = buildStore({
        _l3Storage: {
          archive: mockL3StorageArchive,
          getSnapshot: mockL3StorageGetSnapshot,
        },
      });
      mockL3StorageArchive.mockResolvedValueOnce("snap-10");
      mockL3StorageGetSnapshot.mockResolvedValueOnce(null);

      const id = await store.archive("stage-10", { summary: "data" }, []);

      expect(id).toBe("snap-10");
      expect(store._emit).toHaveBeenCalledWith(
        "memory:archived",
        expect.objectContaining({ id: "snap-10", stageKey: "stage-10", ts: expect.any(Number) })
      );
      expect(store._emit).toHaveBeenCalledWith(
        "memory:l3:archive",
        expect.objectContaining({ id: "snap-10", stageKey: "stage-10", keywordCount: 0 })
      );
    });

    it("handles rapid concurrent archives independently", async () => {
      const store = buildStore();

      const [first, second] = await Promise.all([
        store.archive("stage-a", { summary: "a" }, []),
        store.archive("stage-b", { summary: "b" }, []),
      ]);

      expect(new Set([first, second]).size).toBe(2);
      expect(store._L3.snapshots.size).toBe(2);
      expect(store._stats.archiveCount).toBe(2);
    });
  });

  describe("_getRetrievalEngine", () => {
    it("returns the existing engine when valid", () => {
      const engine = { recall: vi.fn() };
      const store = buildStore({ _retrievalEngine: engine });

      const result = store._getRetrievalEngine();

      expect(result).toBe(engine);
      expect(mockRetrievalEngineConstructor).not.toHaveBeenCalled();
    });

    it("creates a new engine with expected dependencies", () => {
      const embeddingService = { id: "embed" };
      const vectorIndex = { id: "vector" };
      const eventBus = { id: "bus" };
      const store = buildStore({
        _embeddingService: embeddingService,
        _vectorIndex: vectorIndex,
        eventBus,
      });

      const result = store._getRetrievalEngine();

      expect(result).toBe(store._retrievalEngine);
      expect(mockRetrievalEngineConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryStore: store,
          embeddingService,
          vectorIndex,
          eventBus,
        })
      );
    });
  });

  describe("recall", () => {
    it("increments stats, delegates to retrieval engine, and emits event", () => {
      const recallMock = vi.fn(() => [{ id: "r1" }, { id: "r2" }]);
      const store = buildStore({ _retrievalEngine: { recall: recallMock } });
      const longQuery = "q".repeat(150);

      const result = store.recall(longQuery, 0);

      expect(result).toHaveLength(2);
      expect(store._stats.recallCount).toBe(1);
      expect(recallMock).toHaveBeenCalledWith(longQuery, 0);
      const [, payload] = store._emit.mock.calls[0];
      expect(payload.query.length).toBe(100);
      expect(payload.method).toBe("keyword");
      expect(payload.resultCount).toBe(2);
    });
  });

  describe("semanticRecall", () => {
    it("handles non-string queries and awaits semantic results", async () => {
      const semanticMock = vi.fn(async () => ["s1"]);
      const store = buildStore({ _retrievalEngine: { recall: vi.fn(), semanticRecall: semanticMock } });

      const results = await store.semanticRecall({ q: "x" }, { limit: 1 });

      expect(results).toEqual(["s1"]);
      expect(store._stats.recallCount).toBe(1);
      expect(semanticMock).toHaveBeenCalledWith({ q: "x" }, { limit: 1 });
      expect(store._emit).toHaveBeenCalledWith(
        "memory:recall",
        expect.objectContaining({ query: "(non-string)", resultCount: 1, method: "semantic" })
      );
    });
  });

  describe("hybridRecall", () => {
    it("handles hybrid recall with non-string query", async () => {
      const hybridMock = vi.fn(async () => ["h1", "h2", "h3"]);
      const store = buildStore({ _retrievalEngine: { recall: vi.fn(), hybridRecall: hybridMock } });

      const results = await store.hybridRecall({ q: 1 }, { limit: -1 });

      expect(results).toEqual(["h1", "h2", "h3"]);
      expect(store._stats.recallCount).toBe(1);
      expect(hybridMock).toHaveBeenCalledWith({ q: 1 }, { limit: -1 });
      expect(store._emit).toHaveBeenCalledWith(
        "memory:recall",
        expect.objectContaining({ query: "(non-string)", resultCount: 3, method: "hybrid" })
      );
    });
  });

  describe("listArchives", () => {
    it("returns reverse chronological entries with boundary limits", () => {
      const store = buildStore();
      store._L3.index.timeline.push(
        { id: "a", ts: 1 },
        { id: "b", ts: 2 },
        { id: "c", ts: 3 }
      );

      expect(store.listArchives().map((entry) => entry.id)).toEqual(["c", "b", "a"]);
      expect(store.listArchives("2").map((entry) => entry.id)).toEqual(["c", "b"]);
      expect(store.listArchives(0).map((entry) => entry.id)).toEqual(["c", "b", "a"]);
      expect(store.listArchives(Number.MAX_SAFE_INTEGER).length).toBe(3);
    });
  });

  describe("getSnapshot", () => {
    it("uses storage backend when available", async () => {
      const storage = { getSnapshot: vi.fn(async () => ({ id: "s1" })) };
      const store = buildStore({ _l3Storage: storage });

      const result = await store.getSnapshot("s1");

      expect(result).toEqual({ id: "s1" });
      expect(storage.getSnapshot).toHaveBeenCalledWith("s1");
    });

    it.each([null, undefined, "", "   ", [], {}])("returns null for invalid id %s", async (value) => {
      const store = buildStore();

      const result = await store.getSnapshot(value);

      expect(result).toBeNull();
    });

    it("accepts numeric snapshot ids", async () => {
      const store = buildStore();
      store._L3.snapshots.set("123", { id: "123" });

      const result = await store.getSnapshot(123);

      expect(result).toEqual({ id: "123" });
    });
  });

  describe("checkpoint", () => {
    it("creates a full checkpoint in memory for empty options", async () => {
      const store = buildStore();
      mockEstimateBytes.mockImplementationOnce(() => 5);

      const id = await store.checkpoint({});

      expect(id).toBe("ckpt-1");
      expect(store._recalculateTotalTokens).toHaveBeenCalled();
      expect(store._L3.checkpoints.length).toBe(1);
      const snapshot = store._L3.checkpoints[0];
      expect(snapshot.encoding).toBe("full");
      expect(snapshot.L0).toEqual({ L0: "clone" });
      expect(snapshot.L1).toEqual({ L1: "clone" });
      expect(snapshot.L2).toEqual({ L2: "clone" });
      expect(store._l3BytesUsed).toBe(5);
      expect(store._clearDirty).toHaveBeenCalled();
    });

    it("creates an incremental checkpoint when dirty", async () => {
      const store = buildStore();
      store._L3.checkpoints.push({ id: "base", encoding: "full" });
      store._dirty = { L0: false, L1: true, L2: false, L3: false };
      const dirtySnapshot = { ...store._dirty };

      const id = await store.checkpoint({ incremental: true, fullSnapshotEvery: 5 });

      expect(id).toBe("ckpt-1");
      expect(store._L3.checkpoints.length).toBe(2);
      const snapshot = store._L3.checkpoints[1];
      expect(snapshot.encoding).toBe("incremental");
      expect(snapshot.dirtyLayers).toEqual(dirtySnapshot);
      expect(snapshot.baseId).toBe("base");
      expect(snapshot.L1).toEqual({ L1: "clone" });
      expect(snapshot.L0).toBeUndefined();
      expect(snapshot.L2).toBeUndefined();
    });

    it("treats non-plain options as defaults", async () => {
      const store = buildStore();

      const id = await store.checkpoint("not-object");

      expect(id).toBe("ckpt-1");
      expect(mockIsPlainObject).toHaveBeenCalledWith("not-object");
      expect(store._L3.checkpoints[0].encoding).toBe("full");
    });

    it("uses storage backend and sets baseId from checkpoint index", async () => {
      const store = buildStore({
        _l3Storage: {
          listCheckpoints: mockL3StorageListCheckpoints,
          checkpoint: mockL3StorageCheckpoint,
        },
      });
      store._dirty = { L0: true, L1: false, L2: false, L3: false };
      mockL3StorageListCheckpoints.mockResolvedValueOnce([{ id: "base" }]);

      const id = await store.checkpoint({ incremental: true, fullSnapshotEvery: Number.MAX_SAFE_INTEGER });

      expect(id).toBe("ckpt-1");
      expect(mockL3StorageCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({ encoding: "incremental", baseId: "base", L0: { L0: "clone" } })
      );
      expect(store._clearDirty).toHaveBeenCalled();
    });
  });

  describe("_hasAnyDirty", () => {
    it("detects dirty flags", () => {
      const store = buildStore();
      store._dirty = { L0: false, L1: 0, L2: "", L3: null };

      expect(store._hasAnyDirty()).toBeFalsy();

      store._dirty.L2 = true;
      expect(store._hasAnyDirty()).toBe(true);
    });
  });

  describe("restore", () => {
    it.each([null, undefined, "", "missing"])("returns false for unknown checkpoint %s", async (id) => {
      const store = buildStore();

      const result = await store.restore(id);

      expect(result).toBe(false);
    });

    it("restores a full checkpoint from memory", async () => {
      const store = buildStore();
      const ckpt = {
        id: "ckpt-1",
        encoding: "full",
        L0: { foo: 1 },
        L1: { bar: 2 },
        L2: { baz: 3 },
      };
      store._L3.checkpoints.push(ckpt);

      const result = await store.restore("ckpt-1");

      expect(result).toBe(true);
      expect(store._L0).toEqual({ cloned: ckpt.L0 });
      expect(store._L1).toEqual({ cloned: ckpt.L1 });
      expect(store._L2).toEqual({ cloned: ckpt.L2 });
      expect(store._updateTokenUsage).toHaveBeenCalled();
      expect(store._clearDirty).toHaveBeenCalled();
    });

    it("falls back to incremental layers when base restore fails", async () => {
      const store = buildStore();
      const ckpt = {
        id: "inc",
        encoding: "incremental",
        baseId: "missing",
        L0: { foo: 1 },
        L1: { bar: 2 },
      };
      store._L3.checkpoints.push(ckpt);
      store._restoreFromBase = vi.fn(() => false);

      const result = await store.restore("inc");

      expect(result).toBe(true);
      expect(store._restoreFromBase).toHaveBeenCalledWith(ckpt);
      expect(store._L0).toEqual({ cloned: ckpt.L0 });
      expect(store._L1).toEqual({ cloned: ckpt.L1 });
    });

    it.each([null, undefined, "", "   "])("returns false for invalid storage checkpoint id %s", async (id) => {
      const storage = { getCheckpoint: vi.fn() };
      const store = buildStore({ _l3Storage: storage });

      const result = await store.restore(id);

      expect(result).toBe(false);
      expect(storage.getCheckpoint).not.toHaveBeenCalled();
    });

    it("restores from storage and falls back when base restore fails", async () => {
      const ckpt = {
        id: "ckpt-2",
        encoding: "incremental",
        baseId: "base",
        L0: { foo: 1 },
      };
      const storage = { getCheckpoint: vi.fn(async () => ckpt) };
      const store = buildStore({ _l3Storage: storage });
      store._restoreFromBaseStorage = vi.fn(async () => false);

      const result = await store.restore("ckpt-2");

      expect(result).toBe(true);
      expect(store._restoreFromBaseStorage).toHaveBeenCalledWith(ckpt, storage);
      expect(store._L0).toEqual({ cloned: ckpt.L0 });
      expect(store._updateTokenUsage).toHaveBeenCalled();
      expect(store._clearDirty).toHaveBeenCalled();
    });
  });

  describe("_restoreFromBase", () => {
    it("restores a chain ending at a full checkpoint", () => {
      const store = buildStore();
      const base = { id: "base", encoding: "full", L0: { value: "base" }, L1: { value: 1 } };
      const mid = { id: "mid", encoding: "incremental", baseId: "base", L0: { value: "mid" } };
      const inc = { id: "inc", encoding: "incremental", baseId: "mid", L1: { value: 2 } };
      store._L3.checkpoints.push(base, mid, inc);

      const result = store._restoreFromBase(inc);

      expect(result).toBe(true);
      expect(store._L0).toEqual({ cloned: mid.L0 });
      expect(store._L1).toEqual({ cloned: inc.L1 });
    });

    it("returns false when no full checkpoint is found", () => {
      const store = buildStore();
      const inc = { id: "inc", encoding: "incremental", baseId: "missing", L0: { value: "x" } };
      store._L3.checkpoints.push(inc);
      store._L0 = { existing: true };

      const result = store._restoreFromBase(inc);

      expect(result).toBe(false);
      expect(store._L0).toEqual({ existing: true });
    });
  });

  describe("_restoreFromBaseStorage", () => {
    it("restores incremental chains from storage when a full base exists", async () => {
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
      expect(store._L0).toEqual({ cloned: incremental.L0 });
    });

    it("guards against cyclic base references", async () => {
      const store = buildStore();
      const incremental = { id: "loop", encoding: "incremental", baseId: "loop", L0: { value: "loop" } };
      const storage = { getCheckpoint: vi.fn() };

      const result = await store._restoreFromBaseStorage(incremental, storage);

      expect(result).toBe(false);
      expect(storage.getCheckpoint).not.toHaveBeenCalled();
    });
  });

  describe("getLatestCheckpoint", () => {
    it("returns the latest checkpoint or null", () => {
      const store = buildStore();

      expect(store.getLatestCheckpoint()).toBeNull();

      store._L3.checkpoints.push({ id: "c1" }, { id: "c2" });
      expect(store.getLatestCheckpoint().id).toBe("c2");
    });
  });

  describe("_recalculateL3Bytes", () => {
    it("sums snapshot and checkpoint sizes", () => {
      const store = buildStore();
      store._L3.snapshots.set("s1", { __bytes: 3 });
      store._L3.snapshots.set("s2", { __bytes: 4 });
      store._L3.checkpoints.push({ __bytes: 5 });

      store._recalculateL3Bytes();

      expect(store._l3BytesUsed).toBe(12);
      expect(mockEstimateBytes).toHaveBeenCalledTimes(3);
    });
  });
});
