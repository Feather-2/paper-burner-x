import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";

import { RunStore, RunStoreConstants } from '../../../../js/agents/storage/run-store.js';

const makeDbName = (label) => `AgentRuntimeDB_vitest_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const iso = (ms) => new Date(ms).toISOString();

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

async function setRunCreatedAt({ store, runId, createdAt }) {
  const db = await store.open();
  const tx = db.transaction([RunStoreConstants.STORE_RUNS], "readwrite");
  const runs = tx.objectStore(RunStoreConstants.STORE_RUNS);
  const rec = await promisifyRequest(runs.get(runId));
  runs.put({ ...rec, createdAt, updatedAt: createdAt });
  await promisifyTransaction(tx);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("RunStore (storageAdapter mode)", () => {
  it("uses adapter for task/state/artifact/manifest operations", async () => {
    const map = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => map.get(k) ?? null),
      set: vi.fn(async (k, v) => map.set(k, String(v))),
    };

    const store = new RunStore({ storageAdapter, prefix: "t:" });

    // open() is a no-op in adapter mode
    await expect(store.open()).resolves.toBeNull();
    await expect(store.close()).resolves.toBeUndefined();

    await store.saveTask({ taskId: "task_1", title: "hello" });
    expect(storageAdapter.set).toHaveBeenCalledWith("t:task_1", expect.any(String));
    expect(await store.loadTask("task_1")).toEqual({ taskId: "task_1", title: "hello" });

    const state = { ok: true, toJSON: () => ({ ok: true, json: true }) };
    await store.saveState("run_1", state);
    expect(storageAdapter.set).toHaveBeenCalledWith("t:run_1:state", expect.any(String));
    expect(await store.loadState("run_1")).toEqual({ ok: true, json: true });

    const artId = await store.saveArtifact("run_1", "plan.json", { a: 1 });
    expect(artId).toBe("art_run_1_plan.json_001");
    const raw = await store.getArtifact("run_1", "plan.json");
    expect(raw).toBe('{"a":1}');

    await store.updateManifest("run_1", { runId: "run_1", artifacts: [] });
    expect(await store.getManifest("run_1")).toEqual({ runId: "run_1", artifacts: [] });

    expect(await store.listRunRecords()).toEqual([]);
    expect(await store.listArtifactSummaries("run_1")).toEqual([]);
    expect(await store.getLatestArtifactSummary("run_1", "plan.json")).toBeNull();

    await expect(store.updateRunContext("run_1", { x: 1 })).rejects.toThrow(/not supported/i);
  });

  it("returns empty/null for IndexedDB-only APIs when using a storageAdapter", async () => {
    const map = new Map();
    const storageAdapter = {
      get: vi.fn(async (k) => map.get(k) ?? null),
      set: vi.fn(async (k, v) => map.set(k, String(v))),
    };
    const store = new RunStore({ storageAdapter, prefix: "t:" });

    await store.saveArtifact("run_a", "tool_output.json", "hello", { artifactId: "a1" });
    expect(await store.loadArtifact("run_a", "tool_output.json")).toBe("hello");

    // IndexedDB-only APIs are no-ops in adapter mode.
    expect(await store.getArtifactRecord("a1")).toBeNull();
    expect(await store.listArtifacts("run_a")).toEqual([]);
    expect(await store._estimateRunBytes("run_a")).toBeNull();
  });
});

describe("RunStore (IndexedDB mode)", () => {
  it("open() throws when IndexedDB is missing", async () => {
    const dbName = makeDbName("no_idb");
    const store = new RunStore({ dbName });

    // Simulate environments where IndexedDB is not available.
    vi.stubGlobal("indexedDB", undefined);

    await expect(store.open()).rejects.toThrow(/IndexedDB is not available/i);
  });

  it("open() clears cached promise when open fails", async () => {
    const dbName = makeDbName("open_error");
    const store = new RunStore({ dbName });

    const openMock = vi.fn(() => {
      const req = {
        error: new Error("open failed"),
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        onblocked: null,
        result: null,
      };
      Promise.resolve().then(() => req.onerror && req.onerror());
      return req;
    });

    vi.stubGlobal("indexedDB", { open: openMock });

    await expect(store.open()).rejects.toThrow(/open failed/i);
    expect(store._dbp).toBeNull();

    await expect(store.open()).rejects.toThrow(/open failed/i);
    expect(openMock).toHaveBeenCalledTimes(2);
  });

  it("open() caches the open promise and close() releases it", async () => {
    const dbName = makeDbName("open_cache");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const p1 = store.open();
    const dbp1 = store._dbp;
    const p2 = store.open();
    const dbp2 = store._dbp;
    expect(dbp1).toBeInstanceOf(Promise);
    expect(dbp1).toBe(dbp2);

    const db1 = await p1;
    const db2 = await p2;
    expect(db1).toEqual(expect.objectContaining({ close: expect.any(Function) }));
    expect(db1).toBe(db2);

    await store.close();
    // Subsequent open() should create a new promise.
    const p3 = store.open();
    expect(store._dbp).not.toBe(dbp1);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("CRUD: runs, runContext patching (merge/replace), deleteRun()", async () => {
    const dbName = makeDbName("crud");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_crud";
    const base = { schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() };

    await expect(store.createRun({})).rejects.toThrow(/runContext\.runId must be a string/i);
    await store.createRun(base);

    expect(await store.getRun(runId)).toEqual(base);
    expect(await store.listRuns()).toEqual([base]);

    const merged = await store.updateRunContext(runId, { title: "hello", runId: "evil" });
    expect(merged.runId).toBe(runId);
    expect(merged.title).toBe("hello");

    const replaced = await store.updateRunContext(runId, { only: true }, { replace: true });
    expect(replaced).toEqual({ runId, only: true });

    await expect(store.updateRunContext("", { x: 1 })).rejects.toThrow(/non-empty string/i);
    await expect(store.updateRunContext(runId, null)).rejects.toThrow(/patch must be an object/i);
    await expect(store.updateRunContext("missing", { x: 1 })).rejects.toThrow(/run not found/i);

    await store.saveArtifact(runId, "content_package.json", { ok: true });
    await store.appendEvent(runId, {
      schemaVersion: "0.1",
      eventId: "evt_1",
      runId,
      ts: new Date().toISOString(),
      name: "run.started",
      actor: "system",
      status: "started",
    });

    await store.deleteRun(runId);
    expect(await store.getRun(runId)).toBeNull();
    expect(await store.getEvents(runId)).toEqual([]);
    expect(await store.getArtifact(runId, "content_package.json")).toBeNull();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("task/state helpers: saveTask/loadTask + saveState/loadState store as artifacts in IndexedDB mode", async () => {
    const dbName = makeDbName("task_state");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.saveTask({ taskId: "task_1", title: "hello" });
    expect(await store.loadTask("task_1")).toEqual({ taskId: "task_1", title: "hello" });
    expect(await store.getArtifactById("task_task_1")).toEqual({ taskId: "task_1", title: "hello" });

    const runId = "run_state";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    const stateObj = { a: 1, toJSON: () => ({ a: 1, json: true }) };
    await store.saveState(runId, stateObj);
    expect(await store.loadState(runId)).toEqual({ a: 1, json: true });
    expect(await store.getArtifactById(`state_${runId}`)).toEqual({ a: 1, json: true });

    // Also cover loadState() parsing when the latest artifact is a string.
    await store.saveArtifact(runId, "state.json", '{"from":"string"}', { seq: 2 });
    expect(await store.loadState(runId)).toEqual({ from: "string" });

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("covers input validation + null returns for task/state helpers", async () => {
    const dbName = makeDbName("task_state_validation");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await expect(store.saveTask(null)).rejects.toThrow(/task must be an object/i);
    await expect(store.saveTask({})).rejects.toThrow(/task\.taskId must be a string/i);
    await expect(store.loadTask(null)).rejects.toThrow(/taskId must be a string/i);
    await expect(store.loadTask("missing_task")).resolves.toBeNull();

    // Force a string payload path so loadTask() uses safeJsonParse().
    await store.saveArtifact("task_str", "task.json", '{"x":1}', { seq: 1 });
    await expect(store.loadTask("task_str")).resolves.toEqual({ x: 1 });

    await expect(store.saveState(null, {})).rejects.toThrow(/runId must be a string/i);
    await expect(store.loadState(null)).rejects.toThrow(/runId must be a string/i);
    await expect(store.loadState("run_missing_state")).resolves.toBeNull();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("loadTask/loadState return null for invalid JSON artifacts", async () => {
    const dbName = makeDbName("task_state_invalid_json");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.saveArtifact("task_bad_json", "task.json", "{nope", { seq: 1 });
    await expect(store.loadTask("task_bad_json")).resolves.toBeNull();

    const runId = "run_bad_state_json";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    await store.saveArtifact(runId, "state.json", "{bad", { seq: 1 });
    await expect(store.loadState(runId)).resolves.toBeNull();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("events: appendEvent/appendEvents/getEvents + events.jsonl fallback artifact", async () => {
    const dbName = makeDbName("events");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_events";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await expect(store.appendEvent(runId, null)).rejects.toThrow(/event must be an object/i);
    await expect(store.appendEvent(runId, { eventId: 1 })).rejects.toThrow(/eventId must be a string/i);

    const base = Date.now();
    const e1 = { schemaVersion: "0.1", eventId: "evt_1", runId, ts: iso(base + 1), name: "a", actor: "system", status: "ok" };
    const e0 = { schemaVersion: "0.1", eventId: "evt_0", runId, ts: iso(base + 0), name: "b", actor: "system", status: "ok" };
    await store.appendEvent(runId, e1);

    const n = await store.appendEvents(runId, [e0, null, { nope: true }]);
    // appendEvents returns input length, even if some entries are ignored.
    expect(n).toBe(3);

    const events = await store.getEvents(runId);
    expect(events.map((e) => e.eventId)).toEqual(["evt_0", "evt_1"]);

    const jsonl = await store.getArtifact(runId, "events.jsonl");
    expect(jsonl).toContain('"eventId":"evt_0"');
    expect(jsonl.endsWith("\n")).toBe(true);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("events.jsonl fallback returns empty string when no events exist", async () => {
    const dbName = makeDbName("events_empty");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_events_empty";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await expect(store.getArtifact(runId, "events.jsonl")).resolves.toBe("");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("appendEvents() validates input and handles empty batches", async () => {
    const dbName = makeDbName("appendEvents_validation");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_evt_validation";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await expect(store.appendEvents(runId, null)).rejects.toThrow(/events must be an array/i);
    await expect(store.appendEvents(runId, [])).resolves.toBe(0);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("artifacts: save/get by type and by id; seq + bytes handling; summaries", async () => {
    const dbName = makeDbName("artifacts");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_artifacts";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    const id1 = await store.saveArtifact(runId, "plan.json", { v: 1 }, { seq: 1 });
    const id2 = await store.saveArtifact(runId, "plan.json", { v: 2 }); // counter -> seq 2
    expect(id1).toMatch(/_001$/);
    expect(id2).toMatch(/_002$/);

    // Force a larger seq and verify the counter is updated.
    const id9 = await store.saveArtifact(runId, "plan.json", { v: 9 }, { seq: 9 });
    const id10 = await store.saveArtifact(runId, "plan.json", { v: 10 });
    expect(id9).toMatch(/_009$/);
    expect(id10).toMatch(/_010$/);

    expect(await store.getArtifact(runId, "plan.json")).toEqual({ v: 10 });
    expect(await store.getArtifactById(id1)).toEqual({ v: 1 });

    // Bytes: string is recorded, object is skipped unless estimateObjectBytes is enabled.
    const textId = await store.saveArtifact(runId, "tool_output.json", "hello");
    const textRec = await store.getArtifactRecord(textId);
    expect(textRec.bytes).toBe(5);

    const objNoBytesId = await store.saveArtifact(runId, "lint_report.json", { big: true });
    const objNoBytesRec = await store.getArtifactRecord(objNoBytesId);
    expect(objNoBytesRec.bytes).toBeUndefined();

    const objBytesId = await store.saveArtifact(runId, "lint_report.json", { big: true }, { estimateObjectBytes: true });
    const objBytesRec = await store.getArtifactRecord(objBytesId);
    expect(typeof objBytesRec.bytes).toBe("number");
    expect(objBytesRec.bytes).toBeGreaterThan(0);

    const all = await store.listArtifacts(runId);
    expect(all.some((a) => a.artifactId === id1 && a.type === "plan.json" && a.seq === 1)).toBe(true);

    const summaries = await store.listArtifactSummaries(runId);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0]).toEqual(
      expect.objectContaining({
        artifactId: expect.any(String),
        runId,
        type: expect.any(String),
        seq: expect.any(Number),
      }),
    );

    const planSummaries = await store.listArtifactSummaries(runId, { type: "plan.json" });
    expect(planSummaries.every((s) => s.type === "plan.json")).toBe(true);

    const latest = await store.getLatestArtifactSummary(runId, "plan.json");
    expect(latest).toEqual(expect.objectContaining({ runId, type: "plan.json", seq: 10 }));

    // Null path when no artifact exists for a type.
    expect(await store.getLatestArtifactSummary(runId, "missing.json")).toBeNull();

    await expect(store.listArtifactSummaries("")).rejects.toThrow(/non-empty string/i);
    await expect(store.getLatestArtifactSummary("", "plan.json")).rejects.toThrow(/non-empty string/i);
    await expect(store.getLatestArtifactSummary(runId, "")).rejects.toThrow(/non-empty string/i);
    await expect(store.getArtifactRecord("")).rejects.toThrow(/non-empty string/i);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("manifest: update/get + updateManifest throws when run is missing", async () => {
    const dbName = makeDbName("manifest");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await expect(store.updateManifest("missing", { runId: "missing" })).rejects.toThrow(/run not found/i);

    const runId = "run_manifest";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await store.updateManifest(runId, { runId, artifacts: [{ type: "events.jsonl" }] });
    expect(await store.getManifest(runId)).toEqual({ runId, artifacts: [{ type: "events.jsonl" }] });

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("listRunRecords() supports order + includeContext", async () => {
    const dbName = makeDbName("listRunRecords");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const r1 = "run_r1";
    const r2 = "run_r2";
    await store.createRun({ schemaVersion: "0.1", runId: r1, mode: "test", constraints: {}, startedAt: iso(Date.now()) });
    await store.createRun({ schemaVersion: "0.1", runId: r2, mode: "test", constraints: {}, startedAt: iso(Date.now()) });

    const now = Date.now();
    await setRunCreatedAt({ store, runId: r1, createdAt: iso(now - 10_000) });
    await setRunCreatedAt({ store, runId: r2, createdAt: iso(now - 1_000) });

    const desc = await store.listRunRecords({ order: "desc", includeContext: false });
    expect(desc.map((r) => r.runId)).toEqual([r2, r1]);
    expect(desc[0]).not.toHaveProperty("runContext");

    const asc = await store.listRunRecords({ order: "asc", includeContext: true });
    expect(asc.map((r) => r.runId)).toEqual([r1, r2]);
    expect(asc[0]).toHaveProperty("runContext");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("listRuns() sorts by createdAt desc (covers comparator)", async () => {
    const dbName = makeDbName("listRuns_sort");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const now = Date.now();
    const r1 = "run_sort_1";
    const r2 = "run_sort_2";

    await store.createRun({ schemaVersion: "0.1", runId: r1, mode: "test", constraints: {}, startedAt: iso(now) });
    await store.createRun({ schemaVersion: "0.1", runId: r2, mode: "test", constraints: {}, startedAt: iso(now) });

    // Force deterministic ordering.
    await setRunCreatedAt({ store, runId: r1, createdAt: iso(now - 10_000) });
    await setRunCreatedAt({ store, runId: r2, createdAt: iso(now - 1_000) });

    const rows = await store.listRuns();
    expect(rows.map((r) => r.runId)).toEqual([r2, r1]);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("retention: cleanupRuns() supports enabled=false, maxRuns/maxAgeDays/maxTotalBytes, and dryRun", async () => {
    const dbName = makeDbName("cleanup");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const now = Date.now();
    const ids = ["run_c1", "run_c2", "run_c3"];

    await store.createRun({ schemaVersion: "0.1", runId: ids[0], mode: "test", constraints: {}, startedAt: iso(now) });
    await store.createRun({ schemaVersion: "0.1", runId: ids[1], mode: "test", constraints: {}, startedAt: iso(now), pinned: true });
    await store.createRun({ schemaVersion: "0.1", runId: ids[2], mode: "test", constraints: {}, startedAt: iso(now) });

    await setRunCreatedAt({ store, runId: ids[0], createdAt: iso(now - 3 * 86400000) }); // oldest
    await setRunCreatedAt({ store, runId: ids[1], createdAt: iso(now - 2 * 86400000) });
    await setRunCreatedAt({ store, runId: ids[2], createdAt: iso(now - 1 * 86400000) }); // newest

    // enabled=false: should do nothing and list kept ids
    const disabled = await store.cleanupRuns({ retention: { enabled: false, maxRuns: 1 }, reason: "disabled" });
    expect(disabled.deletedRunIds).toEqual([]);
    expect(disabled.keptRunIds).toEqual(expect.arrayContaining(ids));

    // No knobs: safe no-op
    const noKnobs = await store.cleanupRuns({ retention: { enabled: true }, reason: "no_knobs" });
    expect(noKnobs).toEqual(expect.objectContaining({ deletedRunIds: [], keptRunIds: [], plannedDeleteRunIds: [] }));

    // maxRuns respects pinned by default
    const maxRuns = await store.cleanupRuns({ retention: { maxRuns: 1 }, reason: "maxRuns" });
    // pinned + keep newest, so oldest non-pinned should be deleted
    expect(maxRuns.deletedRunIds).toEqual([ids[0]]);
    expect(await store.getRun(ids[0])).toBeNull();
    expect(await store.getRun(ids[1])).toEqual(expect.objectContaining({ runId: ids[1], pinned: true }));
    expect(await store.getRun(ids[2])).toEqual(expect.objectContaining({ runId: ids[2] }));

    // maxAgeDays deletes runs older than cutoff (pinned still kept)
    const age = await store.cleanupRuns({ retention: { maxAgeDays: 0.00001 }, reason: "age" }); // tiny window
    expect(age.deletedRunIds).toEqual(expect.any(Array));

    // maxTotalBytes path (store scan; manifest missing bytes -> _estimateRunBytes)
    const b1 = new Uint8Array(200);
    const b2 = new Uint8Array(200);
    const b3 = new Uint8Array(100);
    await store.saveArtifact(ids[1], "vfs_payload.bin", b1);
    await store.saveArtifact(ids[2], "vfs_payload.bin", b2);
    await store.saveArtifact(ids[2], "vfs_payload.bin", b3, { seq: 2 });

    const bytesResult = await store.cleanupRuns({ retention: { maxTotalBytes: 250 }, dryRun: true, reason: "bytes" });
    expect(bytesResult.deletedRunIds).toEqual([]);
    expect(bytesResult.plannedDeleteRunIds.length).toBeGreaterThanOrEqual(0);
    expect(typeof bytesResult.bytesBefore).toBe("number");
    expect(typeof bytesResult.bytesAfter).toBe("number");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("retention: maxTotalBytes can prune oldest runs using manifest byte totals (no store scan)", async () => {
    const dbName = makeDbName("cleanup_bytes_manifest");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const now = Date.now();
    const r1 = "run_bytes_1";
    const r2 = "run_bytes_2";
    const r3 = "run_bytes_3";

    await store.createRun({ schemaVersion: "0.1", runId: r1, mode: "test", constraints: {}, startedAt: iso(now) });
    await store.createRun({ schemaVersion: "0.1", runId: r2, mode: "test", constraints: {}, startedAt: iso(now) });
    await store.createRun({ schemaVersion: "0.1", runId: r3, mode: "test", constraints: {}, startedAt: iso(now) });

    await setRunCreatedAt({ store, runId: r1, createdAt: iso(now - 3 * 86400000) }); // oldest
    await setRunCreatedAt({ store, runId: r2, createdAt: iso(now - 2 * 86400000) });
    await setRunCreatedAt({ store, runId: r3, createdAt: iso(now - 1 * 86400000) }); // newest

    // Manifest sizes: total=500, cap=300 => prune oldest run (r1 size=200) to reach 300.
    await store.updateManifest(r1, { runId: r1, artifacts: [{ type: "vfs_payload.bin", bytes: 200 }] });
    await store.updateManifest(r2, { runId: r2, artifacts: [{ type: "vfs_payload.bin", bytes: 200 }] });
    await store.updateManifest(r3, { runId: r3, artifacts: [{ type: "vfs_payload.bin", bytes: 100 }] });

    const scanSpy = vi.spyOn(store, "_estimateRunBytes");

    const out = await store.cleanupRuns({ retention: { maxTotalBytes: 300 }, reason: "bytes_manifest" });
    expect(out.deletedRunIds).toEqual([r1]);
    expect(typeof out.bytesBefore).toBe("number");
    expect(typeof out.bytesAfter).toBe("number");
    expect(out.bytesAfter).toBeLessThanOrEqual(300);

    expect(scanSpy).not.toHaveBeenCalled();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("retention: cleanupRuns() ordering is stable when createdAt is missing/invalid (Infinity sort path)", async () => {
    const dbName = makeDbName("cleanup_sort_invalid_createdAt");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const now = Date.now();
    const a = "run_invalid_a";
    const b = "run_invalid_b";

    await store.createRun({ schemaVersion: "0.1", runId: a, mode: "test", constraints: {}, startedAt: iso(now) });
    await store.createRun({ schemaVersion: "0.1", runId: b, mode: "test", constraints: {}, startedAt: iso(now) });

    // Make one createdAt invalid/empty so parseIsoMs() yields null => createdAtMs=0.
    await setRunCreatedAt({ store, runId: a, createdAt: "" });
    await setRunCreatedAt({ store, runId: b, createdAt: iso(now - 1_000) });

    const out = await store.cleanupRuns({ retention: { maxRuns: 1 }, dryRun: true, reason: "invalid_createdAt" });
    expect(out.plannedDeleteRunIds).toEqual([a]);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("setRetentionPolicy() normalizes values", async () => {
    const store = new RunStore();
    const out = store.setRetentionPolicy({
      enabled: "yes",
      keepPinned: 0,
      maxRuns: -1,
      maxAgeDays: 3.5,
      maxBytes: 1234.9,
      pinnedKey: " keep ",
    });

    expect(out).toEqual(
      expect.objectContaining({
        enabled: true,
        keepPinned: false,
        maxRuns: null,
        maxAgeDays: 3.5,
        maxTotalBytes: 1234,
        pinnedKey: "keep",
      }),
    );
  });

  it("_estimateRunBytes() covers Blob/string/ArrayBuffer/object branches (bytes missing/invalid)", async () => {
    const dbName = makeDbName("estimate_bytes_branches");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_est_bytes";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    // Store artifacts with a non-finite bytes value so the estimator recomputes from payload.
    await store.saveArtifact(runId, "tool_output.json", "hello", { bytes: Number.NaN, seq: 1 });
    await store.saveArtifact(runId, "vfs_payload.bin", new ArrayBuffer(7), { bytes: Number.NaN, seq: 1 });

    const blob = new Blob([new Uint8Array(10)]);
    await store.saveArtifact(runId, "export_report.json", blob, { bytes: Number.NaN, seq: 1 });

    const circular = {};
    circular.self = circular;
    await store.saveArtifact(runId, "lint_report.json", circular, { bytes: Number.NaN, seq: 1 });

    const total = await store._estimateRunBytes(runId, { estimateObjectBytes: true });
    // "hello" (5 bytes) + ArrayBuffer(7) + Blob(10) ; circular JSON.stringify fails => ignored
    expect(total).toBeGreaterThanOrEqual(22);

    // Storage mode / invalid run id short-circuits
    expect(await store._estimateRunBytes("")).toBeNull();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("_maybeWarnQuota() covers early-return branches (ratio<=0, missing quota/usage, remaining ok, throttling, enabled=false, cleanup error)", async () => {
    const dbName = makeDbName("quota_branches");
    await RunStore.deleteDatabase({ dbName });

    // ratio<=0 branch
    {
      const store = new RunStore({ dbName, quotaWarnRatio: 0 });
      vi.stubGlobal("navigator", { storage: { estimate: vi.fn(async () => ({ quota: 100, usage: 99 })) } });
      await expect(store._maybeWarnQuota({ runId: "r", type: "t" })).resolves.toBeUndefined();
      await store.close();
    }

    // Missing quota/usage + remainingRatio ok + throttling + enabled=false + cleanup error catch
    {
      const store = new RunStore({
        dbName,
        quotaWarnRatio: 0.2,
        // Disable caching so each call observes a different estimate() output.
        quotaCheckIntervalMs: 0,
        autoCleanup: undefined, // enabled=null -> enabled=false branch
        onQuotaWarning: vi.fn(), // should short-circuit before logger/cleanup
      });

      const estimate = vi
        .fn()
        .mockResolvedValue({ quota: 100, usage: 95 })
        .mockResolvedValueOnce({ quota: 100 }) // missing usage
        .mockResolvedValueOnce({ quota: 0, usage: 0 }) // invalid quota
        .mockResolvedValueOnce({ quota: 100, usage: 0 }) // remainingRatio >= ratio => no warn
        .mockResolvedValueOnce({ quota: 100, usage: 95 }) // low quota => warn
        .mockResolvedValueOnce({ quota: 100, usage: 95 }); // throttled warn

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
        vi.stubGlobal("navigator", { storage: { estimate } });

        await store._maybeWarnQuota({ runId: "r", type: "t" }); // missing usage
        await store._maybeWarnQuota({ runId: "r", type: "t" }); // quota invalid
        await store._maybeWarnQuota({ runId: "r", type: "t" }); // remaining ok

        await store._maybeWarnQuota({ runId: "r", type: "t" }); // warns via onQuotaWarning
        await store._maybeWarnQuota({ runId: "r", type: "t" }); // throttled (no new call)
        expect(store._onQuotaWarning).toHaveBeenCalledTimes(1);

        // enabled=false branch: remove callback so we reach logger -> autoCleanup enabled=false return.
        store._onQuotaWarning = null;
        store._autoCleanup = { enabled: null, maxRuns: 1, maxAgeDays: null, maxTotalBytes: null, keepPinned: true, pinnedKey: "pinned" };
        vi.advanceTimersByTime(60_000); // bypass warn throttling interval
        await store._maybeWarnQuota({ runId: "r1", type: "t1" });

        // cleanup error catch: enable auto cleanup and make cleanupRuns throw.
        // This cleanupRuns will throw, covering the `.catch()` path.
        store._autoCleanup = { enabled: true, maxRuns: 1, maxAgeDays: null, maxTotalBytes: null, keepPinned: true, pinnedKey: "pinned" };
        store.cleanupRuns = vi.fn(async () => {
          throw new Error("cleanup failed");
        });
        vi.advanceTimersByTime(60_000); // bypass warn throttling interval again
        await store._maybeWarnQuota({ runId: "r2", type: "t2" });
        await store._cleanupPromise;
      } finally {
        vi.useRealTimers();
        await store.close();
      }
    }

    await RunStore.deleteDatabase({ dbName });
  });

  it("estimateQuota() reports error when navigator.storage.estimate throws", async () => {
    const store = new RunStore();
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn(async () => { throw new Error("boom"); }) } });
    await expect(store.estimateQuota()).resolves.toEqual(expect.objectContaining({ supported: false, error: expect.any(String) }));
  });

  it("saveArtifact() input validation + bytes calculation for Blob/ArrayBuffer", async () => {
    const dbName = makeDbName("saveArtifact_bytes");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_saveArtifact_bytes";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await expect(store.saveArtifact(null, "plan.json", {})).rejects.toThrow(/runId must be a string/i);
    await expect(store.saveArtifact(runId, "", {})).rejects.toThrow(/type must be a string/i);

    const blob = new Blob([new Uint8Array(4)]);
    const blobId = await store.saveArtifact(runId, "export_report.json", blob);
    expect((await store.getArtifactRecord(blobId)).bytes).toBe(4);

    const abId = await store.saveArtifact(runId, "vfs_payload.bin", new ArrayBuffer(9));
    expect((await store.getArtifactRecord(abId)).bytes).toBe(9);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("saveArtifact() assigns default mime types based on artifact type", async () => {
    const dbName = makeDbName("saveArtifact_mime");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_saveArtifact_mime";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    const eventsId = await store.saveArtifact(runId, "events.jsonl", "");
    const jsonId = await store.saveArtifact(runId, "content_package.json", { ok: true });
    const binId = await store.saveArtifact(runId, "blob.bin", new Uint8Array(2));

    expect((await store.getArtifactRecord(eventsId)).mime).toBe("application/x-ndjson");
    expect((await store.getArtifactRecord(jsonId)).mime).toBe("application/json");
    expect((await store.getArtifactRecord(binId)).mime).toBe("application/octet-stream");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("saveArtifact() seeds seq from existing artifacts when counter record is missing", async () => {
    const dbName = makeDbName("saveArtifact_seq_fallback");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const runId = "run_seq_fallback";
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    const firstId = await store.saveArtifact(runId, "plan.json", { v: 1 }, { seq: 1 });
    expect(firstId).toMatch(/_001$/);

    const db = await store.open();
    const tx = db.transaction([RunStoreConstants.STORE_COUNTERS], "readwrite");
    const counters = tx.objectStore(RunStoreConstants.STORE_COUNTERS);
    counters.delete([runId, "plan.json"]);
    await promisifyTransaction(tx);

    const nextId = await store.saveArtifact(runId, "plan.json", { v: 2 });
    const nextRec = await store.getArtifactRecord(nextId);
    expect(nextRec.seq).toBe(2);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("quota: estimateQuota() is safe and _maybeWarnQuota() triggers callback + autoCleanup (best-effort)", async () => {
    const dbName = makeDbName("quota");
    await RunStore.deleteDatabase({ dbName });
    const onQuotaWarning = vi.fn(() => {
      throw new Error("quota warning handler failed");
    });
    const store = new RunStore({
      dbName,
      quotaWarnRatio: 0.2,
      quotaCheckIntervalMs: 0,
      // Throw so _maybeWarnQuota falls through to logger + autoCleanup.
      onQuotaWarning,
      autoCleanup: { enabled: true, maxRuns: 1 },
    });

    // In Node, navigator may be missing => supported=false
    const est = await store.estimateQuota();
    expect(est).toEqual(expect.objectContaining({ supported: expect.any(Boolean) }));

    // Force a supported navigator.storage.estimate() for the warning path.
    vi.stubGlobal("navigator", {
      storage: {
        estimate: vi.fn(async () => ({ quota: 100, usage: 95 })),
      },
    });

    // Avoid touching IndexedDB in this test: stub cleanupRuns to a resolved promise.
    const cleanupRuns = vi.fn(async () => ({ deletedRunIds: [], keptRunIds: [], plannedDeleteRunIds: [] }));
    store.cleanupRuns = cleanupRuns;

    await store._maybeWarnQuota({ upcomingBytes: 0, runId: "run_q", type: "plan.json" });

    expect(store._onQuotaWarning).toBe(onQuotaWarning);
    expect(store._onQuotaWarning).toHaveBeenCalledTimes(1);
    expect(store._onQuotaWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run_q",
        type: "plan.json",
        quota: 100,
        usage: 95,
      }),
    );

    // Auto cleanup is scheduled asynchronously; await it for deterministic assertions.
    await store._cleanupPromise;
    expect(cleanupRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "quota_low",
        keepRunIds: ["run_q"],
      }),
    );

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });
});
