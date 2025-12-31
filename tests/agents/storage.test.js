const test = require("node:test");
const assert = require("node:assert/strict");

require("fake-indexeddb/auto");

function makeDbName(label) {
  return `AgentRuntimeDB_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

test("RunStore: IndexedDB CRUD (runs/events/artifacts)", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("crud");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_crud";
  const runContext = { schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() };

  await store.createRun(runContext);
  assert.deepEqual(await store.getRun(runId), runContext);

  const all = await store.listRuns();
  assert.equal(all.length, 1);
  assert.deepEqual(all[0], runContext);

  const updated = await store.updateRunContext(runId, { title: "Hello", tags: ["demo"] });
  assert.deepEqual(updated, { ...runContext, title: "Hello", tags: ["demo"] });
  assert.deepEqual(await store.getRun(runId), updated);

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
  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, evt.eventId);

  await store.saveArtifact(runId, "content_package.json", { hello: "world" });
  assert.deepEqual(await store.getArtifact(runId, "content_package.json"), { hello: "world" });

  await store.deleteRun(runId);
  assert.equal(await store.getRun(runId), null);
  assert.deepEqual(await store.getEvents(runId), []);
  assert.equal(await store.getArtifact(runId, "content_package.json"), null);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("RunStore: events.jsonl append + readback (1000+ events)", async () => {
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
  assert.equal(n, 1200);

  const events = await store.getEvents(runId);
  assert.equal(events.length, 1200);
  assert.equal(events[0].eventId, `evt_${runId}_1`);
  assert.equal(events[1199].eventId, `evt_${runId}_1200`);

  const jsonl = await store.getArtifact(runId, "events.jsonl");
  assert.ok(typeof jsonl === "string" && jsonl.includes(`"eventId":"evt_${runId}_1"`));
  assert.ok(jsonl.split("\n").filter(Boolean).length === 1200);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("ArtifactManager: manifest integrity + sha256", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { createManifest, addArtifactToManifest, generateArtifactId, computeSha256 } = await import("../../js/agents/storage/artifact-manager.js");

  const dbName = makeDbName("manifest");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_test_manifest";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "textprep", constraints: {}, startedAt: new Date().toISOString() });

  const content = { a: 1, b: { c: 2 } };
  const sha = await computeSha256(content);
  assert.ok(typeof sha === "string" && sha.length === 64);

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

  assert.equal(back.schemaVersion, "0.1");
  assert.equal(back.runId, runId);
  assert.ok(typeof back.createdAt === "string" && back.createdAt.includes("T"));
  assert.equal(back.artifacts.length, 2);
  assert.ok(back.artifacts.some((a) => a.type === "content_package.json" && a.sha256 === sha));

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("RunExporter: zip export/import roundtrip", async () => {
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

  await store1.saveArtifact(runId, "content_package.json", contentPkg, { artifactId: art1, storageKey: `runs/${runId}/content_package.json` });
  await store1.saveArtifact(runId, "deck_package.json", deckPkg, { artifactId: art2, storageKey: `runs/${runId}/deck_package.json` });
  await store1.saveArtifact(runId, "plan.json", plan1, { artifactId: art4, storageKey: `runs/${runId}/plan.json`, seq: 1 });
  await store1.saveArtifact(runId, "plan.json", plan2, { artifactId: art5, storageKey: `runs/${runId}/plan.json`, seq: 2 });

  const manifest = createManifest(runId);
  addArtifactToManifest(manifest, { artifactId: art1, type: "content_package.json", mime: "application/json", storageKey: `runs/${runId}/content_package.json` });
  addArtifactToManifest(manifest, { artifactId: art2, type: "deck_package.json", mime: "application/json", storageKey: `runs/${runId}/deck_package.json` });
  addArtifactToManifest(manifest, { artifactId: art3, type: "events.jsonl", mime: "application/x-ndjson", storageKey: `runs/${runId}/events.jsonl` });
  addArtifactToManifest(manifest, { artifactId: art4, type: "plan.json", mime: "application/json", storageKey: `runs/${runId}/plan.json` });
  addArtifactToManifest(manifest, { artifactId: art5, type: "plan.json", mime: "application/json", storageKey: `runs/${runId}/plan.json` });
  await store1.updateManifest(runId, manifest);

  const zipBlob = await exportRunAsZip(runId, { runStore: store1 });
  assert.ok(zipBlob);

  await store1.close();

  const dbName2 = makeDbName("zip_dst");
  await RunStore.deleteDatabase({ dbName: dbName2 });
  const store2 = new RunStore({ dbName: dbName2 });

  const importedRunId = await importRunFromZip(zipBlob, { runStore: store2, overwrite: true });
  assert.equal(importedRunId, runId);

  assert.deepEqual(await store2.getArtifact(runId, "content_package.json"), contentPkg);
  assert.deepEqual(await store2.getArtifact(runId, "deck_package.json"), deckPkg);
  assert.deepEqual(await store2.getArtifact(runId, "plan.json"), plan2);
  assert.deepEqual(await store2.getEvents(runId), events);

  const backManifest = await store2.getManifest(runId);
  assert.equal(backManifest.runId, runId);
  assert.ok(backManifest.artifacts.some((a) => a.type === "events.jsonl"));
  assert.ok(backManifest.artifacts.some((a) => a.type === "plan.json"));

  const importedPlans = (await store2.listArtifacts(runId)).filter((a) => a && a.type === "plan.json");
  assert.equal(importedPlans.length, 2);

  await store2.close();
  await RunStore.deleteDatabase({ dbName: dbName1 });
  await RunStore.deleteDatabase({ dbName: dbName2 });
});

test("RunStore: storage quota detection does not throw", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");

  const dbName = makeDbName("quota");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const est = await store.estimateQuota();
  assert.ok(est && typeof est === "object" && "supported" in est);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("PlanStore: create/save/update plan artifacts", async () => {
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

  assert.equal(plan.schemaVersion, "0.1");
  assert.equal(plan.runId, runId);
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.selectedStepIndex, 1);
  assert.equal(findPlanStepIndex(plan, 0), 0);
  assert.equal(findPlanStepIndex(plan, "analyze"), 1);
  assert.equal(findPlanStepIndex(plan, "missing"), -1);

  const normalized = normalizePlanStep({ stepId: "x", status: "weird" }, { fallbackIndex: 0 });
  assert.equal(normalized.status, "pending");

  const art1 = await savePlan({ runStore: store, runId, plan, type: PLAN_ARTIFACT_TYPE });
  assert.ok(typeof art1 === "string" && art1.startsWith(`art_${runId}_${PLAN_ARTIFACT_TYPE.replaceAll("/", "_")}_`));

  const updated1 = setPlanStepStatus(plan, "ingest", "in_progress");
  const updated2 = setPlanStepStatus(updated1, 1, "completed", { select: false });

  assert.equal(updated2.steps[0].status, "in_progress");
  assert.equal(updated2.steps[1].status, "completed");
  assert.equal(updated2.selectedStepIndex, 0);

  assert.throws(() => setPlanStepStatus(plan, "ingest", "nope"), /invalid status/i);

  const art2 = await savePlan({ runStore: store, runId, plan: updated2 });
  assert.notEqual(art2, art1);

  const loaded = await store.getArtifactById(art2);
  assert.equal(loaded.planId, plan.planId);
  assert.equal(loaded.steps[0].status, "in_progress");
  assert.equal(loaded.steps[1].status, "completed");

  const artifacts = await store.listArtifacts(runId);
  const plans = artifacts.filter((a) => a.type === PLAN_ARTIFACT_TYPE);
  assert.equal(plans.length, 2);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});
