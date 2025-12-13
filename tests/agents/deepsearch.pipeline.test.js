const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearchState: serialization/deserialization preserves L0/L1/L2", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  assert.throws(() => DeepSearchState.fromJSON(null), /must be an object/);

  const state = new DeepSearchState({
    runId: "run_test",
    taskGoal: "Compare A vs B",
    userConfig: { title: "Test Deck" },
    L0: { sources: [{ sourceId: "s1", kind: "file", title: "Doc", sourceTextNormalized: "Alpha beta gamma" }] },
    L1: { claims: [{ claimId: "c1", text: "Alpha", evidenceIds: ["e1"] }], evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" }] },
    L2: { retrievedChunks: [{ retrievedId: "rch_1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }] },
  });
  state.addTodo({ todoId: "todo_1", text: "Fill definition gap" });
  state.addTimeline({ name: "deepsearch.scan", status: "completed", payload: { sourceCount: 1 } });

  const serialized = state.serialize({ pretty: true });
  const roundtrip = DeepSearchState.deserialize(serialized);

  assert.deepEqual(roundtrip.toJSON().runId, "run_test");
  assert.deepEqual(roundtrip.toJSON().taskGoal, "Compare A vs B");
  assert.ok(roundtrip.toJSON().L0 && roundtrip.toJSON().L1 && roundtrip.toJSON().L2);
  assert.equal(roundtrip.todos.length, 1);
  assert.equal(roundtrip.timeline.length, 1);
});

test("DeepSearch scan: optional LLM parsing + fallback", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");

  const state = new DeepSearchState({
    runId: "run_test",
    taskGoal: "Test scanning",
    L0: { sources: [{ sourceId: "s1", kind: "url", title: "Doc", sourceTextNormalized: "Alpha beta gamma delta" }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  // LLM path
  {
    const aiApiService = {
      chat: async () => ({
        content:
          "```json\n" +
          JSON.stringify({
            scanSummary: { summaryText: "LLM summary", topSources: [{ sourceId: "s1", reason: "high density" }] },
            deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "focus" }] },
          }) +
          "\n```",
      }),
    };
    const out = await runDeepSearchScanStage({ runId: "run_test" }, { state }, { emit, aiApiService });
    assert.equal(out.scanSummary.summaryText, "LLM summary");
    assert.ok(Array.isArray(out.deepDivePlan.steps) && out.deepDivePlan.steps.length >= 1);
    assert.ok(events.some((e) => e.name === "deepsearch.scan.completed" && e.record.actor === "deepsearch"));
  }

  // Fallback path
  {
    const badAi = { chat: async () => ({ content: "not json" }) };
    const out = await runDeepSearchScanStage({ runId: "run_test" }, { state }, { emit, aiApiService: badAi });
    assert.ok(typeof out.scanSummary.summaryText === "string" && out.scanSummary.summaryText.includes("Sources="));
  }
});

test("DeepSearch gaps/retrieve/understand/write/condense: placeholder IO contracts", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../js/agents/stages/deepsearch/scan.js");
  const { runDeepSearchGapsStage } = await import("../../js/agents/stages/deepsearch/gaps.js");
  const { runDeepSearchRetrieveStage } = await import("../../js/agents/stages/deepsearch/retrieve.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");
  const { runDeepSearchWriteStage } = await import("../../js/agents/stages/deepsearch/write.js");
  const { runDeepSearchCondenseStage } = await import("../../js/agents/stages/deepsearch/condense.js");

  const sourceText = [
    "Definition: Alpha is the first letter.\n",
    "Statistics: Alpha adoption reached 42% in 2024.\n",
    "Process: Start with scan, then retrieve, then understand.\n",
  ].join("");

  const state = new DeepSearchState({
    runId: "run_contract",
    taskGoal: "Compare Alpha vs Beta; explain mechanism; give example",
    userConfig: { title: "Alpha vs Beta" },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: sourceText }] },
  });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  await runDeepSearchScanStage({ runId: "run_contract" }, { state }, { emit });

  const gapsOut = await runDeepSearchGapsStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(gapsOut.gaps) && gapsOut.gaps.length >= 3);
  assert.equal(gapsOut.todos.length, gapsOut.gaps.length);
  assert.ok(events.some((e) => e.name === "deepsearch.todo.created"));

  const retOut = await runDeepSearchRetrieveStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(retOut.retrievedChunks));
  assert.ok(retOut.retrievedChunks.length >= 1);
  assert.ok(typeof retOut.retrievedChunks[0].locator.charStart === "number");

  const undOut = await runDeepSearchUnderstandStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(undOut.claims) && Array.isArray(undOut.evidenceLedger));
  assert.ok(undOut.claims.length >= 1);
  assert.ok(undOut.evidenceLedger.length >= 1);

  const evidenceById = new Map(undOut.evidenceLedger.map((e) => [e.evidenceId, e]));
  for (const c of undOut.claims) {
    assert.ok(c.evidenceIds.length >= 1);
    assert.ok(evidenceById.has(c.evidenceIds[0]));
  }

  const sourceTextById = new Map(state.L0.sources.map((s) => [s.sourceId, s.sourceTextNormalized]));
  for (const e of undOut.evidenceLedger) {
    const t = sourceTextById.get(e.sourceId);
    const slice = t.slice(e.locator.charStart, e.locator.charEnd);
    assert.ok(slice.includes(e.quote));
  }

  const writeOut = await runDeepSearchWriteStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(Array.isArray(writeOut.slideIntents) && writeOut.slideIntents.length >= 4);
  assert.ok(writeOut.slideIntents.some((s) => s.pageType === "cover"));
  assert.ok(writeOut.slideIntents.some((s) => s.pageType === "summary"));

  const condOut = await runDeepSearchCondenseStage({ runId: "run_contract" }, { state }, { emit });
  assert.ok(typeof condOut.condensedMemory.summary === "string" && condOut.condensedMemory.summary.length > 0);
  assert.deepEqual(state.L2.logs, []);
});

test("buildContentPackage: mode=deepsearch includes scanSummary/gaps/condensedMemory/openQuestions", async () => {
  const { buildContentPackage } = await import("../../js/agents/stages/textprep/build-content-package.js");

  const runContext = { runId: "run_pkg", mode: "deepsearch", constraints: { pageCount: 5 } };
  const sources = [
    {
      sourceId: "s1",
      kind: "user_text",
      title: "Input",
      textHash: "sha256:deadbeef",
      sourceTextNormalized: "Alpha beta gamma delta",
    },
  ];

  const slideIntents = [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c1"] }];
  const claims = [{ claimId: "c1", text: "Alpha beta", evidenceIds: ["e1"] }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" }];

  const pkg = buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, [], {
    mode: "deepsearch",
    scanSummary: { summaryText: "Scan summary" },
    gaps: [{ gapId: "gap_1", type: "definition", question: "Define Alpha" }],
    condensedMemory: { summary: "Condensed summary" },
    openQuestions: [{ questionId: "q_1", text: "What is Beta?", status: "open" }],
  });

  assert.equal(pkg.mode, "deepsearch");
  assert.equal(pkg.scanSummary.summaryText, "Scan summary");
  assert.equal(pkg.gaps.length, 1);
  assert.equal(pkg.condensedMemory.summary, "Condensed summary");
  assert.equal(pkg.openQuestions.length, 1);
});

test("AgentOrchestrator: deepsearch stages register + emit internal events", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");
  const { registerDeepSearchStages } = await import("../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");

  const orch = new AgentOrchestrator({ mode: "deepsearch", scenario: "test", runId: "run_orch" });
  registerDeepSearchStages(orch, { timeoutMs: 2000 });

  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  const state = new DeepSearchState({
    runId: "run_orch",
    taskGoal: "Compare Alpha vs Beta",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized: "Alpha vs Beta. Definition: Alpha." }] },
  });

  const pkg = await orch.run(async (o) => {
    await o.runStage("deepsearch.scan", { state });
    await o.runStage("deepsearch.gaps", { state });
    await o.runStage("deepsearch.retrieve", { state });
    await o.runStage("deepsearch.understand", { state });
    await o.runStage("deepsearch.write", { state });
    await o.runStage("deepsearch.condense", { state });
    return o.runStage("deepsearch.pipeline", { state });
  });
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(Array.isArray(pkg.slideIntents) && pkg.slideIntents.length >= 4);

  assert.ok(events.some((e) => e.name === "deepsearch.scan.started" && e.status === "started"));
  assert.ok(events.some((e) => e.name === "deepsearch.scan.completed" && e.actor === "deepsearch" && e.status === "completed"));
  assert.ok(events.some((e) => e.name === "deepsearch.gaps.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.retrieve.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.understand.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.write.completed" && e.actor === "deepsearch"));
  assert.ok(events.some((e) => e.name === "deepsearch.condense.completed" && e.actor === "deepsearch"));
});
