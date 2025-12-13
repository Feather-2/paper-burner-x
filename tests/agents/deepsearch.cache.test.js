const test = require("node:test");
const assert = require("node:assert/strict");

require("fake-indexeddb/auto");

function makeDbName(label) {
  return `AgentRuntimeDB_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

test("Condense: clears L2 temp, preserves L1, builds hierarchical condensedMemory", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { condenseDeepSearchState } = await import("../../js/agents/deepsearch/condense/condense.js");

  const sourceText = ["Intro: Alpha.\n", "\n", "Section A: Beta.\n", "Data: 42%.\n"].join("");

  const claims = [{ claimId: "c1", text: "Alpha is important", evidenceIds: ["e1"] }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 12 }, quote: "Intro: Alpha." }];

  const state = new DeepSearchState({
    runId: "run_condense",
    taskGoal: "Test condense",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc 1", sourceTextNormalized: sourceText }] },
    L1: {
      claims,
      evidenceLedger,
      dataTables: [{ tableId: "t1", title: "Numbers" }],
      slideIntents: [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c1"] }],
      conflicts: [{ conflictId: "x1", text: "No conflict (placeholder)" }],
      condensed_summary: "keep me",
    },
    L2: {
      retrievedChunks: [
        { retrievedId: "rch_keep", sourceId: "s1", locator: { charStart: 0, charEnd: 12 }, text: "Intro: Alpha." },
        { retrievedId: "rch_drop", sourceId: "s1", locator: { charStart: 100, charEnd: 120 }, text: "Unreferenced." },
      ],
      scratchpad: { tmp: "discard" },
      logs: [{ level: "error", msg: "failed retrieval" }],
      failedRetrievalLogs: [{ msg: "drop field" }],
    },
  });

  const out = condenseDeepSearchState(state);

  assert.equal(state.L2.logs.length, 0);
  assert.deepEqual(state.L2.scratchpad, {});
  assert.equal(state.L2.retrievedChunks.length, 1);
  assert.equal(state.L2.retrievedChunks[0].retrievedId, "rch_keep");

  assert.deepEqual(state.L1.claims, claims);
  assert.deepEqual(state.L1.evidenceLedger, evidenceLedger);
  assert.equal(state.L1.dataTables.length, 1);
  assert.equal(state.L1.slideIntents.length, 1);
  assert.equal(state.L1.condensed_summary, "keep me");

  assert.ok(out.condensedMemory && typeof out.condensedMemory === "object");
  assert.ok(typeof out.condensedMemory.summary === "string" && out.condensedMemory.summary.length > 0);
  assert.ok(Array.isArray(out.condensedMemory.documents) && out.condensedMemory.documents.length === 1);
  assert.ok(Array.isArray(out.condensedMemory.documents[0].sections) && out.condensedMemory.documents[0].sections.length >= 1);

  assert.ok(out.l2Cleared.retrievedChunks.removed >= 1);
  assert.ok(out.l2Cleared.removedFields.includes("failedRetrievalLogs"));
  assert.ok(out.l1Preserved && Array.isArray(out.l1Preserved.claims));
});

test("ArtifactManager: deepsearch_state/condensed_memory types + serialize/deserialize", async () => {
  const {
    SUPPORTED_ARTIFACT_TYPES,
    canonicalArtifactType,
    isSupportedArtifactType,
    serializeArtifactPayload,
    deserializeArtifactPayload,
  } = await import("../../js/agents/storage/artifact-manager.js");

  assert.ok(SUPPORTED_ARTIFACT_TYPES.includes("deepsearch_state.json"));
  assert.ok(SUPPORTED_ARTIFACT_TYPES.includes("condensed_memory.json"));

  assert.equal(canonicalArtifactType("deepsearch_state"), "deepsearch_state.json");
  assert.equal(canonicalArtifactType("condensed_memory"), "condensed_memory.json");
  assert.ok(isSupportedArtifactType("deepsearch_state"));
  assert.ok(isSupportedArtifactType("condensed_memory"));

  const payload = { a: 1, b: { c: 2 } };
  const text = serializeArtifactPayload("deepsearch_state", payload, { pretty: true });
  assert.ok(typeof text === "string" && text.includes("\n"));
  assert.deepEqual(deserializeArtifactPayload("deepsearch_state", text), payload);
});

test("RunStore telemetry: aggregates timeline/todos and persists events", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { EventBus } = await import("../../js/agents/runtime/event-bus.js");
  const { subscribeTelemetry } = await import("../../js/agents/runtime/runstore-telemetry.js");

  const dbName = makeDbName("telemetry");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_tel";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "deepsearch", constraints: {}, startedAt: new Date().toISOString() });

  const bus = new EventBus({ runId });
  const tel = subscribeTelemetry(bus, store);

  bus.emit("run.started", { actor: "system", status: "started", payload: { mode: "deepsearch" } });
  bus.emit("deepsearch.todo.created", { actor: "deepsearch", status: "completed", payload: { todoId: "todo_1", text: "Fill gap", status: "open" } });
  bus.emit("deepsearch.scan.completed", { actor: "deepsearch", status: "completed", payload: { sourceCount: 1 } });

  await tel.flush();

  const snap = tel.snapshot();
  assert.equal(snap.timeline.length, 3);
  assert.equal(snap.todos.length, 1);
  assert.equal(snap.todos[0].todoId, "todo_1");
  assert.equal(snap.todos[0].status, "open");

  const events = await store.getEvents(runId);
  assert.equal(events.length, 3);

  tel.unsubscribe();
  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("Cache writer: persists artifacts and rebuilds DeepSearchState", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { writeDeepSearchArtifacts, rebuildDeepSearchStateFromArtifacts } = await import("../../js/agents/deepsearch/condense/cache-writer.js");
  const { condenseDeepSearchState } = await import("../../js/agents/deepsearch/condense/condense.js");

  const dbName = makeDbName("cache");
  await RunStore.deleteDatabase({ dbName });

  const store = new RunStore({ dbName });
  const runId = "run_cache";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "deepsearch", constraints: {}, startedAt: new Date().toISOString() });

  const state = new DeepSearchState({
    runId,
    taskGoal: "Test caching",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha beta gamma" }] },
    L1: {
      claims: [{ claimId: "c1", text: "Alpha", evidenceIds: ["e1"] }],
      evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" }],
    },
    L2: {
      retrievedChunks: [{ retrievedId: "rch_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }],
      scratchpad: { tmp: true },
      logs: [{ msg: "drop" }],
    },
  });

  const { condensedMemory } = condenseDeepSearchState(state);
  await writeDeepSearchArtifacts({ runStore: store, runId, state, condensedMemory, pretty: true, updateManifest: true });

  const rawState = await store.getArtifact(runId, "deepsearch_state.json");
  const rawMem = await store.getArtifact(runId, "condensed_memory.json");
  assert.ok(rawState && typeof rawState === "object");
  assert.ok(rawMem && typeof rawMem === "object");

  const rebuilt = await rebuildDeepSearchStateFromArtifacts({ runStore: store, runId });
  assert.ok(rebuilt instanceof DeepSearchState);
  assert.deepEqual(rebuilt.toJSON(), state.toJSON());

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

test("Condense stage: emits summary and writes artifacts via runStore", async () => {
  const { RunStore } = await import("../../js/agents/storage/run-store.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchCondenseStage } = await import("../../js/agents/stages/deepsearch/condense.js");

  const dbName = makeDbName("stage_cache");
  await RunStore.deleteDatabase({ dbName });
  const store = new RunStore({ dbName });

  const runId = "run_stage_cache";
  await store.createRun({ schemaVersion: "0.1", runId, mode: "deepsearch", constraints: {}, startedAt: new Date().toISOString() });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const state = new DeepSearchState({
    runId,
    taskGoal: "Test condense stage",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Intro: Alpha." }] },
    L1: {
      claims: [{ claimId: "c1", text: "Alpha", evidenceIds: ["e1"] }],
      evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Intro" }],
    },
    L2: { retrievedChunks: [{ retrievedId: "rch_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Intro" }], scratchpad: { x: 1 }, logs: [{ msg: "drop" }] },
  });

  await runDeepSearchCondenseStage({ runId }, { state }, { emit, runStore: store });

  assert.ok(events.some((e) => e.name === "deepsearch.condense.completed" && typeof e.record?.payload?.summary === "string"));
  assert.ok(events.some((e) => e.name === "deepsearch.condense.ended" && typeof e.record?.payload?.summary === "string"));

  const saved = await store.getArtifact(runId, "deepsearch_state.json");
  assert.ok(saved && typeof saved === "object" && saved.runId === runId);

  await store.close();
  await RunStore.deleteDatabase({ dbName });
});

