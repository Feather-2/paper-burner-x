import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

require("fake-indexeddb/auto");

function makeDbName(label) {
  return `AgentRuntimeDB_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

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

async function setRunCreatedAt({ store, runStoreName, runId, createdAt }) {
  const db = await store.open();
  const tx = db.transaction([runStoreName], "readwrite");
  const runs = tx.objectStore(runStoreName);
  const rec = await promisifyRequest(runs.get(runId));
  runs.put({ ...rec, createdAt, updatedAt: createdAt });
  await promisifyTransaction(tx);
}

it("RunStore: IndexedDB CRUD (runs/events/artifacts)", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("crud");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_crud";
  const runContext = { schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() };

  await store.createRun(runContext);
  expect(await store.getRun(runId)).toEqual(runContext);

  const all = await store.listRuns();
  expect(all.length).toBe(1);
  expect(all[0]).toEqual(runContext);

  const updated = await store.updateRunContext(runId, { title: "Hello", tags: ["demo"] });
  expect(updated).toEqual({ ...runContext, title: "Hello", tags: ["demo"] });
  expect(await store.getRun(runId)).toEqual(updated);

  const evt = {
    schemaVersion: "0.1",
    eventId: `evt_${runId}_1`,
    runId,
    ts: new Date().toISOString(),
    name: "run.started",
    actor: "system",
    status: "started",
    payload: { mode: "textprep" },
  };
  await store.appendEvent(runId, evt);
  const events = await store.getEvents(runId);
  expect(events.length).toBe(1);
  expect(events[0].eventId).toBe(evt.eventId);

  await store.saveArtifact(runId, "content_package.json", { hello: "world" });
  expect(await store.getArtifact(runId, "content_package.json")).toEqual({ hello: "world" });

  await store.deleteRun(runId);
  expect(await store.getRun(runId)).toBe(null);
  expect(await store.getEvents(runId)).toEqual([]);
  expect(await store.getArtifact(runId, "content_package.json")).toBe(null);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunStore: events.jsonl append + readback (1000+ events)", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("events");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_events";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() });

  const base = Date.now();
  const batch = [];
  for (let i = 0; i < 1200; i++) {
    batch.push({
      schemaVersion: "0.1",
      eventId: `evt_${runId}_${i + 1}`,
      runId,
      ts: new Date(base + i).toISOString(),
      name: "run.progress",
      actor: "system",
      status: "progress",
      payload: { i },
    });
  }

  const n = await store.appendEvents(runId, batch);
  expect(n).toBe(1200);

  const events = await store.getEvents(runId);
  expect(events.length).toBe(1200);
  expect(events[0].eventId).toBe(`evt_${runId}_1`);
  expect(events[1199].eventId).toBe(`evt_${runId}_1200`);

  const jsonl = await store.getArtifact(runId, "events.jsonl");
  expect(typeof jsonl === "string" && jsonl.includes(`"eventId":"evt_${runId}_1"`)).toBeTruthy();
  expect(jsonl.split("\n").filter(Boolean).length).toBe(1200);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("ArtifactManager: manifest integrity + sha256", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { createManifest, addArtifactToManifest, generateArtifactId, computeSha256 } = await import("../../js/agents/storage/artifact-manager.js");

  const dbName = makeDbName("manifest");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_manifest";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() });

  const content = { a: 1, b: { c: 2 } };
  const sha = await computeSha256(content);
  expect(typeof sha === "string" && sha.length === 64).toBeTruthy();

  const manifest = createManifest(runId);
  const contentId = generateArtifactId(runId, "content_package.json", 1);

  addArtifactToManifest(manifest, {
    artifactId: contentId,
    type: "content_package.json",
    mime: "application/json",
    storageKey: `runs/${runId}/content_package.json`,
    sha256: sha,
    summary: "content package",
  });

  addArtifactToManifest(manifest, {
    artifactId: generateArtifactId(runId, "events.jsonl", 1),
    type: "events.jsonl",
    mime: "application/x-ndjson",
    storageKey: `runs/${runId}/events.jsonl`,
  });

  await store.updateManifest(runId, manifest);
  const back = await store.getManifest(runId);

  expect(back.schemaVersion).toBe("0.1");
  expect(back.runId).toBe(runId);
  expect(typeof back.createdAt === "string" && back.createdAt.includes("T")).toBeTruthy();
  expect(back.artifacts.length).toBe(2);
  expect(back.artifacts.some(a => a.type === "content_package.json" && a.sha256 === sha)).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunExporter: zip export/import roundtrip", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { createManifest, addArtifactToManifest, generateArtifactId } = await import("../../js/agents/storage/artifact-manager.js");
  const { exportRunAsZip, importRunFromZip } = await import("../../js/agents/storage/run-exporter.js");
  const { createPlan } = await import("../../js/agents/runtime/plan/plan-store.js");

  const dbName1 = makeDbName("zip_src");
  await RunStore.deleteDatabase({ dbName: dbName1 });
  const store1 = new RunStore({ dbName: dbName1 });

  const runId = "run_test_zip";
  await store1.createRun({ schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() });

  const events = [
    { schemaVersion: "0.1", eventId: `evt_${runId}_1`, runId, ts: new Date().toISOString(), name: "run.started", actor: "system", status: "started" },
    { schemaVersion: "0.1", eventId: `evt_${runId}_2`, runId, ts: new Date(Date.now() + 1).toISOString(), name: "run.ended", actor: "system", status: "ended" },
  ];
  await store1.appendEvents(runId, events);

  const contentPkg = { kind: "content", ok: true };
  const deckPkg = { kind: "deck", slides: 2 };
  const plan1 = createPlan({
    runId,
    title: "Plan v1",
    kind: "workflow_plan",
    steps: [{ stepId: "s1", title: "Step 1", status: "in_progress" }],
    selectedStepIndex: 0,
  });
  const plan2 = createPlan({
    runId,
    title: "Plan v2",
    kind: "workflow_plan",
    steps: [{ stepId: "s1", title: "Step 1", status: "completed" }, { stepId: "s2", title: "Step 2", status: "in_progress" }],
    selectedStepIndex: 1,
  });

  const art1 = generateArtifactId(runId, "content_package.json", 1);
  const art2 = generateArtifactId(runId, "deck_package.json", 1);
  const art3 = generateArtifactId(runId, "events.jsonl", 1);
  const art4 = generateArtifactId(runId, "plan.json", 1);
  const art5 = generateArtifactId(runId, "plan.json", 2);
  const art6 = generateArtifactId(runId, "vfs_payload.bin", 1);

  await store1.saveArtifact(runId, "content_package.json", contentPkg, { artifactId: art1, storageKey: `runs/${runId}/content_package.json` });
  await store1.saveArtifact(runId, "deck_package.json", deckPkg, { artifactId: art2, storageKey: `runs/${runId}/deck_package.json` });
  await store1.saveArtifact(runId, "plan.json", plan1, { artifactId: art4, storageKey: `runs/${runId}/plan.json`, seq: 1 });
  await store1.saveArtifact(runId, "plan.json", plan2, { artifactId: art5, storageKey: `runs/${runId}/plan.json`, seq: 2 });
  const bin = new Uint8Array([0, 1, 2, 3, 254, 255]);
  await store1.saveArtifact(runId, "vfs_payload.bin", bin, {
    artifactId: art6,
    storageKey: `runs/${runId}/vfs_payload.bin`,
    mime: "application/octet-stream",
    bytes: bin.byteLength,
    seq: 1,
  });

  const manifest = createManifest(runId);
  addArtifactToManifest(manifest, { artifactId: art1, type: "content_package.json", mime: "application/json", storageKey: `runs/${runId}/content_package.json` });
  addArtifactToManifest(manifest, { artifactId: art2, type: "deck_package.json", mime: "application/json", storageKey: `runs/${runId}/deck_package.json` });
  addArtifactToManifest(manifest, { artifactId: art3, type: "events.jsonl", mime: "application/x-ndjson", storageKey: `runs/${runId}/events.jsonl` });
  addArtifactToManifest(manifest, { artifactId: art4, type: "plan.json", mime: "application/json", storageKey: `runs/${runId}/plan.json` });
  addArtifactToManifest(manifest, { artifactId: art5, type: "plan.json", mime: "application/json", storageKey: `runs/${runId}/plan.json` });
  addArtifactToManifest(manifest, { artifactId: art6, type: "vfs_payload.bin", mime: "application/octet-stream", storageKey: `runs/${runId}/vfs_payload.bin` });
  await store1.updateManifest(runId, manifest);

  const zipBlob = await exportRunAsZip(runId, { runStore: store1 });
  expect(zipBlob).toBeTruthy();

  await store1.close();

  const dbName2 = makeDbName("zip_dst");
  await RunStore.deleteDatabase({ dbName: dbName2 });
  const store2 = new RunStore({ dbName: dbName2 });

  const importedRunId = await importRunFromZip(zipBlob, { runStore: store2, overwrite: true });
  expect(importedRunId).toBe(runId);

  expect(await store2.getArtifact(runId, "content_package.json")).toEqual(contentPkg);
  expect(await store2.getArtifact(runId, "deck_package.json")).toEqual(deckPkg);
  expect(await store2.getArtifact(runId, "plan.json")).toEqual(plan2);
  expect(await store2.getArtifact(runId, "vfs_payload.bin")).toEqual(bin);
  expect(await store2.getEvents(runId)).toEqual(events);

  const backManifest = await store2.getManifest(runId);
  expect(backManifest.runId).toBe(runId);
  expect(backManifest.artifacts.some(a => a.type === "events.jsonl")).toBeTruthy();
  expect(backManifest.artifacts.some(a => a.type === "plan.json")).toBeTruthy();

  const importedPlans = (await store2.listArtifacts(runId)).filter((a) => a && a.type === "plan.json");
  expect(importedPlans.length).toBe(2);

  await store2.close();
  await RunStore.deleteDatabase({ dbName: dbName1 });
  await RunStore.deleteDatabase({ dbName: dbName2 });
});

it("RunStore: storage quota detection does not throw", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("quota");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const est = await store.estimateQuota();
  expect(est && typeof est === "object" && "supported" in est).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunStore: cleanupRuns respects maxRuns + pinned", async () => {
  const { RunStore, RunStoreConstants } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("cleanup_maxRuns");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const ids = ["run_cleanup_1", "run_cleanup_2", "run_cleanup_3", "run_cleanup_4", "run_cleanup_5"];
  await store.createRun({ schemaVersion: "0.1", runId: ids[0], mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: ids[1], mode: "deepsearch", constraints: {}, startedAt: iso(now), pinned: true });
  await store.createRun({ schemaVersion: "0.1", runId: ids[2], mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: ids[3], mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: ids[4], mode: "deepsearch", constraints: {}, startedAt: iso(now) });

  // Ensure deterministic createdAt ordering: 1 oldest -> 5 newest.
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[0], createdAt: iso(now - 5 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[1], createdAt: iso(now - 4 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[2], createdAt: iso(now - 3 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[3], createdAt: iso(now - 2 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[4], createdAt: iso(now - 1 * 86400000) });

  const result = await store.cleanupRuns({ retention: { maxRuns: 2 }, reason: "test_maxRuns" });
  expect(result.plannedDeleteRunIds).toEqual([ids[0], ids[2]]);
  expect(result.deletedRunIds).toEqual([ids[0], ids[2]]);

  expect(await store.getRun(ids[0])).toBe(null);
  expect(await store.getRun(ids[1])).toBeTruthy();
  expect(await store.getRun(ids[2])).toBe(null);
  expect(await store.getRun(ids[3])).toBeTruthy();
  expect(await store.getRun(ids[4])).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunStore: cleanupRuns respects maxAgeDays", async () => {
  const { RunStore, RunStoreConstants } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("cleanup_maxAgeDays");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const oldId = "run_cleanup_old";
  const newId = "run_cleanup_new";

  await store.createRun({ schemaVersion: "0.1", runId: oldId, mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: newId, mode: "deepsearch", constraints: {}, startedAt: iso(now) });

  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: oldId, createdAt: iso(now - 10 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: newId, createdAt: iso(now - 1 * 86400000) });

  const result = await store.cleanupRuns({ retention: { maxAgeDays: 3 }, reason: "test_maxAgeDays" });
  expect(result.deletedRunIds).toEqual([oldId]);
  expect(await store.getRun(oldId)).toBe(null);
  expect(await store.getRun(newId)).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunStore: cleanupRuns respects maxTotalBytes", async () => {
  const { RunStore, RunStoreConstants } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("cleanup_maxBytes");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const ids = ["run_bytes_1", "run_bytes_2", "run_bytes_3"];
  await store.createRun({ schemaVersion: "0.1", runId: ids[0], mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: ids[1], mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: ids[2], mode: "deepsearch", constraints: {}, startedAt: iso(now) });

  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[0], createdAt: iso(now - 3 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[1], createdAt: iso(now - 2 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: ids[2], createdAt: iso(now - 1 * 86400000) });

  // Store per-run sizes via a single binary artifact (bytes recorded by RunStore).
  await store.saveArtifact(ids[0], "vfs_payload.bin", new Uint8Array(200));
  await store.saveArtifact(ids[1], "vfs_payload.bin", new Uint8Array(200));
  await store.saveArtifact(ids[2], "vfs_payload.bin", new Uint8Array(100));

  const result = await store.cleanupRuns({ retention: { maxTotalBytes: 300 }, reason: "test_maxTotalBytes" });
  expect(result.deletedRunIds).toEqual([ids[0]]);
  expect(typeof result.bytesBefore === "number" && result.bytesBefore >= 500).toBeTruthy();
  expect(typeof result.bytesAfter === "number" && result.bytesAfter <= 300).toBeTruthy();

  expect(await store.getRun(ids[0])).toBe(null);
  expect(await store.getRun(ids[1])).toBeTruthy();
  expect(await store.getRun(ids[2])).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("RunStore: cleanupRuns dryRun + keepRunIds", async () => {
  const { RunStore, RunStoreConstants } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("cleanup_dryRun");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();

  const keepId = "run_keep";
  const otherId = "run_other";

  await store.createRun({ schemaVersion: "0.1", runId: keepId, mode: "deepsearch", constraints: {}, startedAt: iso(now) });
  await store.createRun({ schemaVersion: "0.1", runId: otherId, mode: "deepsearch", constraints: {}, startedAt: iso(now) });

  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: keepId, createdAt: iso(now - 2 * 86400000) });
  await setRunCreatedAt({ store, runStoreName: RunStoreConstants.STORE_RUNS, runId: otherId, createdAt: iso(now - 1 * 86400000) });

  const result = await store.cleanupRuns({ retention: { maxRuns: 1 }, keepRunIds: [keepId], dryRun: true, reason: "test_dryRun" });
  expect(result.deletedRunIds).toEqual([]);
  expect(result.plannedDeleteRunIds).toEqual([]);

  expect(await store.getRun(keepId)).toBeTruthy();
  expect(await store.getRun(otherId)).toBeTruthy();

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

it("PlanStore: create/save/update plan artifacts", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const {
    PLAN_ARTIFACT_TYPE,
    createPlan,
    findPlanStepIndex,
    normalizePlanStep,
    savePlan,
    setPlanStepStatus,
  } = await import("../../js/agents/runtime/plan/plan-store.js");

  const dbName = makeDbName("plan");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_plan";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "deepsearch", constraints: {}, startedAt: new Date().toISOString() });

  const plan = createPlan({
    runId,
    title: "Workflow Plan",
    kind: "workflow_plan",
    selectedStepIndex: 99,
    steps: [
      { stepId: "ingest", title: "Ingest", status: "pending" },
      { stepId: "analyze", title: "Analyze", status: "pending" },
    ],
    meta: { source: "test" },
  });

  expect(plan.schemaVersion).toBe("0.1");
  expect(plan.runId).toBe(runId);
  expect(plan.steps.length).toBe(2);
  expect(plan.selectedStepIndex).toBe(1);
  expect(findPlanStepIndex(plan, 0)).toBe(0);
  expect(findPlanStepIndex(plan, "analyze")).toBe(1);
  expect(findPlanStepIndex(plan, "missing")).toBe(-1);

  const normalized = normalizePlanStep({ stepId: "x", status: "weird" }, { fallbackIndex: 0 });
  expect(normalized.status).toBe("pending");

  const art1 = await savePlan({ runStore: store, runId, plan, type: PLAN_ARTIFACT_TYPE });
  expect(typeof art1 === "string" && art1.startsWith(`art_${runId}_${PLAN_ARTIFACT_TYPE.replaceAll("/", "_")}_`)).toBeTruthy();

  const updated1 = setPlanStepStatus(plan, "ingest", "in_progress");
  const updated2 = setPlanStepStatus(updated1, 1, "completed", { select: false });

  expect(updated2.steps[0].status).toBe("in_progress");
  expect(updated2.steps[1].status).toBe("completed");
  expect(updated2.selectedStepIndex).toBe(0);

  expect(() => setPlanStepStatus(plan, "ingest", "nope")).toThrow(/invalid status/i);

  const art2 = await savePlan({ runStore: store, runId, plan: updated2 });
  expect(art2).not.toBe(art1);

  const loaded = await store.getArtifactById(art2);
  expect(loaded.planId).toBe(plan.planId);
  expect(loaded.steps[0].status).toBe("in_progress");
  expect(loaded.steps[1].status).toBe("completed");

  const artifacts = await store.listArtifacts(runId);
  const plans = artifacts.filter((a) => a.type === PLAN_ARTIFACT_TYPE);
  expect(plans.length).toBe(2);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});
