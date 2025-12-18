const test = require("node:test");
const assert = require("node:assert/strict");

test("Product Flow: Orchestrator (ingest -> deepsearch.pipeline) produces ContentPackage with report/slideIntents", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");
  const { IngestStage } = await import("../../js/agents/ingest/ingest-stage.js");
  const { registerDeepSearchStages } = await import("../../js/agents/stages/deepsearch/index.js");

  const orch = new AgentOrchestrator({ mode: "deepsearch", scenario: "test", constraints: { pageCount: 8 } });
  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  orch.registerStage(
    "deepsearch.ingest",
    async (ctx, input, api) => {
      const stage = new IngestStage({ defaultChunkOptions: { chunkSize: 160, overlap: 0, includeLineNumbers: true } });
      return stage.execute(ctx, input, { emit: api.emit, signal: api.signal, checkCancelled: api.checkCancelled });
    },
    { actor: "ingest", timeoutMs: 20_000 }
  );

  registerDeepSearchStages(orch, { timeoutMs: 30_000 });

  const rawTexts = [
    {
      title: "Doc A",
      text: [
        "Definition: Alpha is the first letter; scope and terms are defined here.",
        "Mechanism: The process works by scanning, retrieving, then extracting claims.",
        "",
      ].join("\n"),
    },
    {
      title: "Doc B",
      text: [
        "Statistics: Alpha adoption reached 42% in 2024, supported by evidence.",
        "Comparison: Alpha vs Beta trade-offs depend on context; pros/cons differ.",
        "Example: A case study shows Alpha outperforming Beta in trials.",
        "",
      ].join("\n"),
    },
  ];

  const ingestOut = await orch.runStage("deepsearch.ingest", { rawTexts });
  assert.ok(Array.isArray(ingestOut.sources) && ingestOut.sources.length === 2);

  const taskGoal = "Compare Alpha vs Beta; explain mechanism; cite key numbers and examples";
  const pkg = await orch.runStage("deepsearch.pipeline", {
    sources: ingestOut.sources,
    taskGoal,
    userConfig: {
      title: "Alpha vs Beta",
      gaps: { blockAfterMisses: 1 },
      retrieval: { topK: 4, windowSize: 1, useBm25: true, useGrep: true, caseSensitive: false },
    },
  });

  assert.equal(pkg.schemaVersion, "0.1");
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(typeof pkg.summary === "string");
  assert.ok(Array.isArray(pkg.sources) && pkg.sources.length === 2);
  assert.ok(pkg.sources.some((s) => s.sourceId === ingestOut.sources[0].sourceId));

  assert.ok(pkg.report && typeof pkg.report === "object");
  assert.ok(typeof pkg.report.markdown === "string" && pkg.report.markdown.length > 0);
  assert.ok(Array.isArray(pkg.report.sections));
  assert.ok(Array.isArray(pkg.report.citations));

  assert.ok(Array.isArray(pkg.slideIntents) && pkg.slideIntents.length >= 4);
  assert.ok(pkg.slideIntents.some((s) => s.pageType === "cover"));
  assert.ok(pkg.slideIntents.some((s) => s.pageType === "summary"));

  // DeepSearch internal progress events should be visible on the orchestrator bus.
  // Note: In direct mode (small docs), scan/retrieve may be skipped, so check for any progress event
  const hasProgressEvents = events.some((e) =>
    e.name === "deepsearch.scan.progress" ||
    e.name === "deepsearch.retrieve.progress" ||
    e.name === "deepsearch.direct.progress" ||
    e.name === "deepsearch.pipeline.started"
  );
  assert.ok(hasProgressEvents, "expected at least one deepsearch progress event");

  // In direct mode, iterations may not run; check for either iteration events or pipeline completion
  const iterationEvents = events.filter((e) => e.name === "deepsearch.iteration.completed");
  const completionEvents = events.filter((e) =>
    e.name === "deepsearch.completed" ||
    e.name === "deepsearch.node.completed" ||
    e.name === "stage.completed"
  );
  assert.ok(
    iterationEvents.length >= 1 || completionEvents.length >= 1,
    "expected at least one deepsearch.iteration.completed or completion event"
  );
  if (iterationEvents.length >= 1) {
    assert.ok(iterationEvents.every((e) => typeof e.payload?.hitCount === "number" && Number.isFinite(e.payload.hitCount)));
  }
});

test("Product Flow: DeepSearch pipeline error propagates and aborts orchestrator.run()", async () => {
  const { AgentOrchestrator } = await import("../../js/agents/runtime/orchestrator.js");
  const { registerDeepSearchStages } = await import("../../js/agents/stages/deepsearch/index.js");

  const orch = new AgentOrchestrator({ mode: "deepsearch", scenario: "test" });
  const events = [];
  orch.eventBus.on("*", (e) => events.push(e));

  registerDeepSearchStages(orch, { timeoutMs: 30_000 });

  const sourceTextNormalized = "Definition: Alpha is the first letter.\nStatistics: adoption reached 42%.\n";
  const badSources = [
    {
      sourceId: "s_bad",
      kind: "user_text",
      title: "Bad Locator",
      sourceTextNormalized,
      // Malformed chunk locator: out of bounds, should trigger a hard-gate error in understand stage.
      chunks: [{ chunkId: "chunk_1", text: sourceTextNormalized, locator: { charStart: 0, charEnd: 9999 } }],
    },
  ];

  await assert.rejects(
    () =>
      orch.run(async (o) =>
        o.runStage("deepsearch.pipeline", {
          sources: badSources,
          taskGoal: "Define Alpha and cite key numbers",
          userConfig: { gaps: { blockAfterMisses: 1 }, retrieval: { topK: 2, windowSize: 0, useBm25: false, useGrep: true } },
        })
      ),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(String(err.message || ""), /Hard gate H2 failed|Hard gate H3 failed|Hard gate H4 failed/);
      return true;
    }
  );

  assert.ok(events.some((e) => e.name === "deepsearch.pipeline.failed"));
  assert.ok(events.some((e) => e.name === "run.failed"));
});

