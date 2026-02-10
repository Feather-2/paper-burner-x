import { describe, it, expect, vi, beforeEach } from "vitest";

const utilsMocks = vi.hoisted(() => ({
  DB_NAME: "RunStoreDB",
  DB_VERSION: 7,
  STORE_RUNS: "runs",
  STORE_ARTIFACTS: "artifacts",
  STORE_EVENTS: "events",
  STORE_COUNTERS: "counters",
  ensureIndex: vi.fn(),
  ensureObjectStore: vi.fn(),
  hasIndexedDB: vi.fn(),
  logger: { warn: vi.fn() },
  normalizeRetentionConfig: vi.fn((value) => ({ normalized: value })),
}));

const crudMocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  appendEvents: vi.fn(),
  createRun: vi.fn(),
  deleteRun: vi.fn(),
  saveArtifact: vi.fn(),
  saveState: vi.fn(),
  saveTask: vi.fn(),
  updateManifest: vi.fn(),
  updateRunContext: vi.fn(),
}));

const queryMocks = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  getArtifactById: vi.fn(),
  getArtifactRecord: vi.fn(),
  getEvents: vi.fn(),
  getLatestArtifactSummary: vi.fn(),
  getManifest: vi.fn(),
  getRun: vi.fn(),
  listArtifacts: vi.fn(),
  listArtifactSummaries: vi.fn(),
  listRunRecords: vi.fn(),
  listRuns: vi.fn(),
  loadArtifact: vi.fn(),
  loadState: vi.fn(),
  loadTask: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  _estimateRunBytes: vi.fn(),
  _estimateRunBytesFromManifest: vi.fn(),
  _maybeWarnQuota: vi.fn(),
  cleanupRuns: vi.fn(),
  estimateQuota: vi.fn(),
  setRetentionPolicy: vi.fn(),
}));

vi.mock("../../../../js/agents/storage/run-store-utils.js", () => utilsMocks);
vi.mock("../../../../js/agents/storage/run-store-crud.js", () => crudMocks);
vi.mock("../../../../js/agents/storage/run-store-queries.js", () => queryMocks);
vi.mock("../../../../js/agents/storage/run-store-cache.js", () => cacheMocks);

import { RunStore, RunStoreConstants } from "../../../../js/agents/storage/run-store.js";

const makeDeepObject = (depth = 24) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }
  return root;
};

const makeOpenRequest = () => {
  const stores = new Map();
  const tx = {
    objectStore: vi.fn((name) => {
      if (!stores.has(name)) stores.set(name, { name });
      return stores.get(name);
    }),
  };
  const db = { close: vi.fn() };
  const req = {
    result: db,
    transaction: tx,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
    error: null,
  };
  return { req, db, tx, stores };
};

const makeDeleteRequest = () => ({
  onsuccess: null,
  onerror: null,
  onblocked: null,
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  utilsMocks.hasIndexedDB.mockReturnValue(false);
});

describe("RunStore", () => {
  describe("constructor", () => {
    it("uses defaults and normalizes retention policies", () => {
      const store = new RunStore();

      expect(store.dbName).toBe(utilsMocks.DB_NAME);
      expect(store.dbVersion).toBe(utilsMocks.DB_VERSION);
      expect(store.prefix).toBe("deepsearch:run:");
      expect(store._quotaWarnRatio).toBe(0.1);
      expect(store._quotaCheckIntervalMs).toBe(60_000);
      expect(store._onQuotaWarning).toBeNull();
      expect(utilsMocks.normalizeRetentionConfig).toHaveBeenCalledWith(undefined);
      expect(utilsMocks.normalizeRetentionConfig).toHaveBeenCalledTimes(2);
      expect(store._retention).toEqual({ normalized: undefined });
      expect(store._autoCleanup).toEqual({ normalized: undefined });
    });

    it("sanitizes numeric options and preserves prefix", () => {
      const store = new RunStore({
        quotaWarnRatio: -1,
        quotaCheckIntervalMs: -1,
        onQuotaWarning: "nope",
        retention: [],
        autoCleanup: {},
        prefix: "   ",
      });

      expect(store._quotaWarnRatio).toBe(0);
      expect(store._quotaCheckIntervalMs).toBe(0);
      expect(store._onQuotaWarning).toBeNull();
      expect(store.prefix).toBe("   ");
      expect(utilsMocks.normalizeRetentionConfig).toHaveBeenCalledWith([]);
      expect(utilsMocks.normalizeRetentionConfig).toHaveBeenCalledWith({});
    });

    it("falls back for non-numeric inputs and floors intervals", () => {
      const handler = () => {};
      const store = new RunStore({
        quotaWarnRatio: "0.25",
        quotaCheckIntervalMs: "123",
        onQuotaWarning: handler,
      });

      expect(store._quotaWarnRatio).toBe(0.1);
      expect(store._quotaCheckIntervalMs).toBe(60_000);
      expect(store._onQuotaWarning).toBe(handler);

      const store2 = new RunStore({
        quotaWarnRatio: Number.MAX_SAFE_INTEGER,
        quotaCheckIntervalMs: 123.9,
      });

      expect(store2._quotaWarnRatio).toBe(Number.MAX_SAFE_INTEGER);
      expect(store2._quotaCheckIntervalMs).toBe(123);
    });
  });

  describe("open", () => {
    it("returns null and skips indexedDB when storageAdapter is provided", async () => {
      const storageAdapter = { get: vi.fn(), set: vi.fn() };
      vi.stubGlobal("indexedDB", { open: vi.fn() });
      const store = new RunStore({ storageAdapter });

      await expect(store.open()).resolves.toBeNull();
      expect(utilsMocks.hasIndexedDB).not.toHaveBeenCalled();
      expect(indexedDB.open).not.toHaveBeenCalled();
    });

    it("throws when IndexedDB is unavailable", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(false);
      const store = new RunStore();

      await expect(store.open()).rejects.toThrow("IndexedDB is not available in this environment");
    });

    it("creates stores and indexes during upgrade", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(true);
      const { req, db, stores } = makeOpenRequest();
      const openSpy = vi.fn(() => req);
      vi.stubGlobal("indexedDB", { open: openSpy });

      const store = new RunStore({ dbName: "db-main", dbVersion: 3 });
      const openPromise = store.open();

      req.onupgradeneeded();

      expect(openSpy).toHaveBeenCalledWith("db-main", 3);
      expect(utilsMocks.ensureObjectStore).toHaveBeenCalledWith(db, utilsMocks.STORE_RUNS, { keyPath: "runId" });
      expect(utilsMocks.ensureObjectStore).toHaveBeenCalledWith(db, utilsMocks.STORE_ARTIFACTS, { keyPath: "artifactId" });
      expect(utilsMocks.ensureObjectStore).toHaveBeenCalledWith(db, utilsMocks.STORE_EVENTS, { keyPath: "eventId" });
      expect(utilsMocks.ensureObjectStore).toHaveBeenCalledWith(db, utilsMocks.STORE_COUNTERS, { keyPath: ["runId", "type"] });

      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_RUNS),
        "byCreatedAt",
        "createdAt",
        { unique: false },
      );
      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_ARTIFACTS),
        "byRunId",
        "runId",
        { unique: false },
      );
      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_ARTIFACTS),
        "byRunIdTypeSeq",
        ["runId", "type", "seq"],
        { unique: false },
      );
      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_EVENTS),
        "byRunId",
        "runId",
        { unique: false },
      );
      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_EVENTS),
        "byRunIdTs",
        ["runId", "ts"],
        { unique: false },
      );
      expect(utilsMocks.ensureIndex).toHaveBeenCalledWith(
        stores.get(utilsMocks.STORE_COUNTERS),
        "byRunId",
        "runId",
        { unique: false },
      );

      req.onsuccess();
      await expect(openPromise).resolves.toBe(db);
    });

    it("caches concurrent open calls and logs blocked events", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(true);
      const { req, db } = makeOpenRequest();
      const openSpy = vi.fn(() => req);
      vi.stubGlobal("indexedDB", { open: openSpy });

      const store = new RunStore({ dbName: "blocked-db", dbVersion: 11 });
      const p1 = store.open();
      const p2 = store.open();

      expect(openSpy).toHaveBeenCalledTimes(1);

      req.onblocked();
      expect(utilsMocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining("blocked-db@v11"));

      req.onsuccess();
      const [db1, db2] = await Promise.all([p1, p2]);
      expect(db1).toBe(db);
      expect(db2).toBe(db);
    });

    it("clears cached promise on open failure and allows retry", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(true);
      const first = makeOpenRequest();
      const second = makeOpenRequest();
      const openSpy = vi.fn()
        .mockReturnValueOnce(first.req)
        .mockReturnValueOnce(second.req);
      vi.stubGlobal("indexedDB", { open: openSpy });

      const store = new RunStore();
      const failure = new Error("open failed");

      const p1 = store.open();
      first.req.error = failure;
      first.req.onerror();
      await expect(p1).rejects.toBe(failure);
      expect(store._dbp).toBeNull();

      const p2 = store.open();
      second.req.onsuccess();
      await expect(p2).resolves.toBe(second.db);
      expect(openSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("close", () => {
    it("closes an open database and resets state", async () => {
      const store = new RunStore();
      const db = { close: vi.fn() };
      store._dbp = Promise.resolve(db);

      await store.close();

      expect(db.close).toHaveBeenCalledTimes(1);
      expect(store._dbp).toBeNull();
    });

    it("is a no-op when not opened and handles rapid consecutive calls", async () => {
      const store = new RunStore();
      await expect(store.close()).resolves.toBeUndefined();

      const db = { close: vi.fn() };
      store._dbp = Promise.resolve(db);
      await store.close();
      await store.close();

      expect(db.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("key helpers", () => {
    it("builds task/state/manifest keys with boundary values", () => {
      const store = new RunStore({ prefix: "p:" });

      expect(store._keyForTask("task-1")).toBe("p:task-1");
      expect(store._keyForTask("")).toBe("p:");
      expect(store._keyForTask(" ")).toBe("p: ");
      expect(store._keyForTask(null)).toBe("p:null");
      expect(store._keyForTask(undefined)).toBe("p:undefined");

      expect(store._keyForState("run-1")).toBe("p:run-1:state");
      expect(store._keyForState("")).toBe("p::state");
      expect(store._keyForState("  ")).toBe("p:  :state");

      expect(store._keyForManifest("run-2")).toBe("p:run-2:manifest");
      expect(store._keyForManifest(null)).toBe("p:null:manifest");

      const emptyPrefixStore = new RunStore({ prefix: "" });
      expect(emptyPrefixStore._keyForTask("")).toBe("");
    });

    it("builds artifact keys with empty and whitespace inputs", () => {
      const store = new RunStore({ prefix: "p:" });

      expect(store._keyForArtifact("run-1", "file.txt")).toBe("p:run-1:artifact:file.txt");
      expect(store._keyForArtifact("", "")).toBe("p::artifact:");
      expect(store._keyForArtifact(" ", "  ")).toBe("p: :artifact:  ");
      expect(store._keyForArtifact(undefined, null)).toBe("p:undefined:artifact:null");
    });
  });

  describe("delegated methods", () => {
    it("exposes delegated APIs from storage modules", () => {
      const store = new RunStore();

      const delegated = [
        ["saveTask", crudMocks.saveTask, [{ id: "t" }]],
        ["loadTask", queryMocks.loadTask, ["t"]],
        ["saveState", crudMocks.saveState, ["run", { s: 1 }]],
        ["loadState", queryMocks.loadState, ["run"]],
        ["estimateQuota", cacheMocks.estimateQuota, []],
        ["_maybeWarnQuota", cacheMocks._maybeWarnQuota, []],
        ["setRetentionPolicy", cacheMocks.setRetentionPolicy, [{}]],
        ["listRunRecords", queryMocks.listRunRecords, [{}]],
        ["_estimateRunBytes", cacheMocks._estimateRunBytes, ["run"]],
        ["_estimateRunBytesFromManifest", cacheMocks._estimateRunBytesFromManifest, [{}]],
        ["cleanupRuns", cacheMocks.cleanupRuns, []],
        ["createRun", crudMocks.createRun, [{ runId: "run" }]],
        ["getRun", queryMocks.getRun, ["run"]],
        ["updateRunContext", crudMocks.updateRunContext, ["run", {}]],
        ["listRuns", queryMocks.listRuns, [{}]],
        ["deleteRun", crudMocks.deleteRun, ["run"]],
        ["appendEvent", crudMocks.appendEvent, ["run", { id: "e1" }]],
        ["appendEvents", crudMocks.appendEvents, ["run", [{ id: "e1" }]]],
        ["getEvents", queryMocks.getEvents, ["run"]],
        ["saveArtifact", crudMocks.saveArtifact, ["run", "report.json", { ok: true }]],
        ["getArtifact", queryMocks.getArtifact, ["run", "report.json"]],
        ["getArtifactRecord", queryMocks.getArtifactRecord, ["run", "report.json"]],
        ["getArtifactById", queryMocks.getArtifactById, ["artifact-id"]],
        ["loadArtifact", queryMocks.loadArtifact, ["run", "report.json"]],
        ["listArtifacts", queryMocks.listArtifacts, ["run"]],
        ["listArtifactSummaries", queryMocks.listArtifactSummaries, ["run"]],
        ["getLatestArtifactSummary", queryMocks.getLatestArtifactSummary, ["run", "report.json"]],
        ["updateManifest", crudMocks.updateManifest, ["run", {}]],
        ["getManifest", queryMocks.getManifest, ["run"]],
      ];

      for (const [method, fn, args] of delegated) {
        expect(store[method]).toEqual(expect.any(Function));
        store[method](...args);
        expect(fn).toHaveBeenLastCalledWith(...args);
        expect(fn.mock.contexts.at(-1)).toBe(store);
      }
    });

    it("forwards boundary and resource-heavy inputs", () => {
      const store = new RunStore();
      const deepState = makeDeepObject(32);
      const hugeString = "x".repeat(1_000_000);
      const emptyArray = [];
      const emptyObject = {};

      crudMocks.saveTask.mockImplementationOnce(function () {
        return this;
      });

      const ctx = store.saveTask({ taskId: "", title: "  " });
      store.saveState("run-0", deepState);
      store.saveArtifact("run-0", "big.txt", hugeString, { size: hugeString.length });
      store.appendEvents("run-0", emptyArray);
      store.appendEvents("run-0", { not: "array" });
      store.updateRunContext("run-0", emptyObject);
      store.listRuns({ limit: "10" });
      store.getRun(null);
      store.getRun(undefined);

      expect(ctx).toBe(store);
      expect(crudMocks.saveTask).toHaveBeenCalledWith({ taskId: "", title: "  " });
      expect(crudMocks.saveState).toHaveBeenCalledWith("run-0", deepState);
      expect(crudMocks.saveArtifact).toHaveBeenCalledWith("run-0", "big.txt", hugeString, { size: hugeString.length });
      expect(crudMocks.appendEvents).toHaveBeenCalledWith("run-0", emptyArray);
      expect(crudMocks.appendEvents).toHaveBeenCalledWith("run-0", { not: "array" });
      expect(crudMocks.updateRunContext).toHaveBeenCalledWith("run-0", emptyObject);
      expect(queryMocks.listRuns).toHaveBeenCalledWith({ limit: "10" });
      expect(queryMocks.getRun).toHaveBeenCalledWith(null);
      expect(queryMocks.getRun).toHaveBeenCalledWith(undefined);
    });
  });

  describe("deleteDatabase", () => {
    it("returns early when IndexedDB is unavailable", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(false);
      const deleteSpy = vi.fn();
      vi.stubGlobal("indexedDB", { deleteDatabase: deleteSpy });

      await expect(RunStore.deleteDatabase({ dbName: "" })).resolves.toBeUndefined();
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("resolves on delete success and blocked events", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(true);
      const req = makeDeleteRequest();
      const deleteSpy = vi.fn(() => req);
      vi.stubGlobal("indexedDB", { deleteDatabase: deleteSpy });

      const promise = RunStore.deleteDatabase({ dbName: "" });
      req.onsuccess();
      await expect(promise).resolves.toBeUndefined();
      expect(deleteSpy).toHaveBeenCalledWith("");

      const blockedReq = makeDeleteRequest();
      deleteSpy.mockReturnValueOnce(blockedReq);
      const blockedPromise = RunStore.deleteDatabase({ dbName: "blocked" });
      blockedReq.onblocked();
      await expect(blockedPromise).rejects.toThrow(/deleteDatabase blocked/);
    });

    it("rejects on delete errors", async () => {
      utilsMocks.hasIndexedDB.mockReturnValue(true);
      const req = makeDeleteRequest();
      const deleteSpy = vi.fn(() => req);
      vi.stubGlobal("indexedDB", { deleteDatabase: deleteSpy });

      const failure = new Error("delete failed");
      const promise = RunStore.deleteDatabase({ dbName: "error-db" });
      req.error = failure;
      req.onerror();

      await expect(promise).rejects.toBe(failure);
      expect(deleteSpy).toHaveBeenCalledWith("error-db");
    });
  });
});

describe("RunStoreConstants", () => {
  it("exports the expected constants", () => {
    expect(RunStoreConstants).toEqual({
      DB_NAME: utilsMocks.DB_NAME,
      DB_VERSION: utilsMocks.DB_VERSION,
      STORE_RUNS: utilsMocks.STORE_RUNS,
      STORE_ARTIFACTS: utilsMocks.STORE_ARTIFACTS,
      STORE_EVENTS: utilsMocks.STORE_EVENTS,
      STORE_COUNTERS: utilsMocks.STORE_COUNTERS,
    });
  });
});
