const test = require("node:test");
const assert = require("node:assert/strict");

function makeMockAiApiService() {
  const calls = [];
  return {
    calls,
    async chat({ messages } = {}) {
      const list = Array.isArray(messages) ? messages : [];
      calls.push({ messages: list });

      const joined = list
        .map((m) => (m && typeof m.content === "string" ? m.content : ""))
        .join("\n")
        .toLowerCase();

      // S2 scan stage (used by pipeline today).
      if (joined.includes("deepsearch scanner")) {
        const last = list[list.length - 1]?.content;
        let sources = [];
        try {
          const parsed = JSON.parse(String(last || ""));
          sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
        } catch {
          // ignore
        }
        const topSourceId = String(sources[0]?.sourceId || "source_1");

        const payload = {
          scanSummary: {
            summaryText: "LLM scan: definitions, metrics, comparisons, mechanism, examples",
            keyTopics: ["Alpha", "Beta"],
            topSources: [{ sourceId: topSourceId, reason: "high signal density" }],
          },
          deepDivePlan: {
            steps: [{ action: "review_source", sourceId: topSourceId, notes: "start with most relevant source" }],
            notes: "deterministic plan",
          },
        };
        return { content: "```json\n" + JSON.stringify(payload) + "\n```" };
      }

      // Placeholder routes for future LLM-backed stages (not required by current P0 implementation).
      if (joined.includes("gap") || joined.includes("缺口")) {
        return {
          content: JSON.stringify({
            gaps: [{ gapId: "g1", type: "definition", question: "Define Alpha", priority: "high", queryHints: ["definition", "Alpha"], status: "open" }],
          }),
        };
      }
      if (joined.includes("understand") || joined.includes("claim") || joined.includes("evidence")) {
        return {
          content: JSON.stringify({
            claims: [{ claimId: "c1", text: "Alpha is defined.", evidenceIds: ["e1"], gapIds: ["g1"] }],
            evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha is", gapIds: ["g1"] }],
          }),
        };
      }
      if (joined.includes("write") || joined.includes("slideintent") || joined.includes("slide")) {
        return {
          content: JSON.stringify({
            slideIntents: [{ slideIntentId: "s_cover", pageType: "cover", title: "Deck", claimIds: [] }],
          }),
        };
      }

      return { content: "{}" };
    },
  };
}

function assertContentPackageBasics(pkg) {
  assert.ok(pkg && typeof pkg === "object");
  assert.equal(pkg.schemaVersion, "0.1");
  assert.equal(pkg.mode, "deepsearch");
  assert.ok(typeof pkg.runId === "string" && pkg.runId.length > 0);
  assert.ok(typeof pkg.createdAt === "string" && pkg.createdAt.length > 0);
  assert.ok(typeof pkg.summary === "string");
  assert.ok(Array.isArray(pkg.sources));
  assert.ok(Array.isArray(pkg.slideIntents));
  assert.ok(Array.isArray(pkg.claims));
  assert.ok(Array.isArray(pkg.evidenceLedger));
  assert.ok(Array.isArray(pkg.gaps));
  assert.ok(pkg.metrics && typeof pkg.metrics === "object");
  assert.ok(pkg.metrics.deepsearch && typeof pkg.metrics.deepsearch.iteration === "number");
}

test("DeepSearch P0 E2E: Happy Path (Ingest rawTexts -> DeepSearchStage -> ContentPackage)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const aiApiService = makeMockAiApiService();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    {
      title: "Notes A",
      text: [
        "Definition: Alpha is the first letter; Beta is the second letter.",
        "Comparison: We compare Alpha vs Beta; pros and cons differ by context.",
        "",
      ].join("\n"),
    },
    {
      title: "Notes B",
      text: [
        "Statistics: Alpha adoption reached 42% in 2024. Evidence suggests continued growth.",
        "Mechanism: The process is scan -> retrieve -> understand; the workflow repeats until gaps clear.",
        "",
      ].join("\n"),
    },
    {
      title: "Notes C",
      text: ["Example: A case study shows Alpha outperforming Beta in controlled trials.", "Case study details: sample size=100.", ""].join("\n"),
    },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 160, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_happy", constraints: {} }, { rawTexts }, { emit });

  assert.equal(Array.isArray(ingestOut.sources), true);
  assert.equal(ingestOut.sources.length, 3);
  for (const s of ingestOut.sources) {
    assert.ok(typeof s.sourceId === "string" && s.sourceId.length > 0);
    assert.equal(s.kind, "user_text");
    assert.ok(typeof s.sourceTextNormalized === "string" && s.sourceTextNormalized.length > 0);
    assert.ok(typeof s.textHash === "string" && s.textHash.startsWith("sha256:"));
    assert.ok(Array.isArray(s.chunks) && s.chunks.length >= 1);
  }

  const state = new DeepSearchState({
    runId: "run_ds_e2e_happy",
    taskGoal: "Compare Alpha vs Beta; explain mechanism; provide examples with evidence",
    maxIterations: 5,
    userConfig: {
      title: "Alpha vs Beta",
      gaps: { blockAfterMisses: 1 },
      retrieval: { topK: 3, windowSize: 1, useBm25: true, useGrep: true, caseSensitive: false },
    },
    L0: { sources: ingestOut.sources },
  });

  const deepsearch = new DeepSearchStage();
  const pkg = await deepsearch.execute({ runId: "run_ds_e2e_happy", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService });

  assert.equal(aiApiService.calls.length >= 1, true);
  assert.equal(typeof state.L1.scanSummary?.summaryText, "string");
  assert.equal(state.L1.scanSummary.summaryText, "LLM scan: definitions, metrics, comparisons, mechanism, examples");

  assertContentPackageBasics(pkg);

  assert.ok(pkg.slideIntents.length >= 4);
  assert.ok(pkg.slideIntents.some((s) => s.pageType === "cover"));
  assert.ok(pkg.slideIntents.some((s) => s.pageType === "summary"));

  assert.ok(pkg.gaps.length >= 5);
  assert.ok(pkg.claims.length >= 1);
  assert.ok(pkg.evidenceLedger.length >= 1);

  // Key assertions: gapId propagation.
  for (const e of pkg.evidenceLedger) {
    assert.ok(Array.isArray(e.gapIds) && e.gapIds.length >= 1);
  }
  for (const c of pkg.claims) {
    assert.ok(Array.isArray(c.gapIds));
    assert.ok(c.gapIds.every((g) => typeof g === "string" && g.length > 0));
  }

  // Loop + checkpoints.
  assert.ok(pkg.metrics.deepsearch.iteration >= 1);
  assert.ok(Array.isArray(state.checkpoints) && state.checkpoints.length >= 1);
  assert.ok(events.some((e) => e.name === "deepsearch.checkpoint.saved"));
  assert.ok(events.some((e) => e.name === "deepsearch.completed"));
});

test("DeepSearch P0 E2E: Gap fill validation (open -> filled; exit when gaps cleared)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const aiApiService = makeMockAiApiService();
  const events = [];

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMore evidence: 42% is cited.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_gapfill", constraints: {} }, { rawTexts }, { emit: (name, record) => events.push({ name, record }) });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_gapfill",
    taskGoal: "Define Alpha and provide key metrics and numbers",
    maxIterations: 5,
    userConfig: { gaps: { blockAfterMisses: 2 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
    L0: { sources: ingestOut.sources },
  });

  const stage = new DeepSearchStage();

  const gapStatusAtGapsStage = [];
  const emitWithSnapshot = (name, record) => {
    events.push({ name, record });
    if (name === "deepsearch.gaps.completed") {
      gapStatusAtGapsStage.push((Array.isArray(state.L1.gaps) ? state.L1.gaps.map((g) => g.status) : []).slice());
    }
  };

  const pkg = await stage.execute({ runId: "run_ds_e2e_gapfill", mode: "deepsearch", constraints: {} }, { state }, { emit: emitWithSnapshot, aiApiService });

  assertContentPackageBasics(pkg);
  // iteration may be 1 or 2 depending on gap-fill timing; key assertion is gapCount=0
  assert.ok(pkg.metrics.deepsearch.iteration >= 1 && pkg.metrics.deepsearch.iteration <= 2, `iteration should be 1-2, got ${pkg.metrics.deepsearch.iteration}`);
  assert.equal(pkg.metrics.deepsearch.gapCount, 0);
  assert.ok(state.L1.gaps.length >= 2);
  assert.equal(state.L1.gaps.every((g) => g.status === "filled"), true);
  assert.ok(pkg.claims.length >= 1);
  assert.ok(pkg.evidenceLedger.length >= 1);

  assert.ok(gapStatusAtGapsStage.length >= 1);
  assert.ok(gapStatusAtGapsStage[0].some((s) => s === "open"));
  assert.ok(state.L1.gaps.some((g) => g.status === "filled"));

  for (const e of pkg.evidenceLedger) assert.ok(Array.isArray(e.gapIds) && e.gapIds.length >= 1);
  for (const c of pkg.claims) assert.ok(Array.isArray(c.gapIds) && c.gapIds.length >= 1);

  // checkpoints count matches iteration count
  assert.ok(state.checkpoints.length >= 1 && state.checkpoints.length <= 2, `checkpoints should be 1-2, got ${state.checkpoints.length}`);
  assert.ok(events.some((e) => e.name === "deepsearch.checkpoint.saved"));
});

test("DeepSearch P0 E2E: Convergence exits (maxIterations or no-new-hits)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const stage = new DeepSearchStage();
  const aiApiService = makeMockAiApiService();

  // Case 1: exit by maxIterations with remaining open gaps.
  {
    const events = [];
    const emit = (name, record) => events.push({ name, record });
    const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 160, overlap: 0, includeLineNumbers: true } });
    const ingestOut = await ingest.execute(
      { runId: "run_ds_e2e_maxit", constraints: {} },
      { rawTexts: [{ title: "Only Definition", text: "Definition: Alpha is a thing.\n" }] },
      { emit }
    );

    const state = new DeepSearchState({
      runId: "run_ds_e2e_maxit",
      taskGoal: "Define Alpha and provide key metrics and numbers",
      maxIterations: 1,
      userConfig: { gaps: { blockAfterMisses: 10 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
      L0: { sources: ingestOut.sources },
    });

    const pkg = await stage.execute({ runId: "run_ds_e2e_maxit", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService });
    assertContentPackageBasics(pkg);
    assert.equal(pkg.metrics.deepsearch.iteration, 1);
    assert.ok(pkg.metrics.deepsearch.gapCount > 0);
    assert.ok(state.L1.gaps.some((g) => g.status === "open"));
    assert.ok(state.checkpoints.length >= 1);
    assert.ok(events.some((e) => e.name === "deepsearch.checkpoint.saved"));
  }

  // Case 2: exit by no-new-hits rounds (gaps stay open; missCount increments).
  {
    const events = [];
    const emit = (name, record) => events.push({ name, record });
    const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 160, overlap: 0, includeLineNumbers: true } });
    const ingestOut = await ingest.execute(
      { runId: "run_ds_e2e_nonew", constraints: {} },
      { rawTexts: [{ title: "No Hits", text: "Lorem ipsum dolor sit amet.\nConsectetur adipiscing elit.\n" }] },
      { emit }
    );

    const state = new DeepSearchState({
      runId: "run_ds_e2e_nonew",
      taskGoal: "Define Alpha and provide key metrics and numbers",
      maxIterations: 10,
      userConfig: { gaps: { blockAfterMisses: 10 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
      L0: { sources: ingestOut.sources },
    });

    const pkg = await stage.execute({ runId: "run_ds_e2e_nonew", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService });

    assertContentPackageBasics(pkg);
    assert.equal(pkg.metrics.deepsearch.iteration, 2);
    assert.ok(pkg.metrics.deepsearch.gapCount > 0);
    assert.ok(state.L1.gaps.every((g) => g.status === "open"));
    const g1 = state.L1.gaps.find((g) => g.gapId === "gap_1");
    const g2 = state.L1.gaps.find((g) => g.gapId === "gap_2");
    assert.ok(g1 && g2);
    assert.ok(typeof g1.missCount === "number" && g1.missCount >= 2);
    assert.ok(typeof g2.missCount === "number" && g2.missCount >= 2);
    assert.equal(pkg.metrics.deepsearch.retrievedCount, 0);
    assert.equal(pkg.evidenceLedger.length, 0);
    assert.equal(pkg.claims.length, 0);

    const saved = events.filter((e) => e.name === "deepsearch.checkpoint.saved");
    assert.equal(saved.length, 2);
    assert.equal(state.checkpoints.length, 2);

    assert.equal(state.checkpoints[0].iteration, 0);
    assert.equal(state.checkpoints[1].iteration, 1);
    assert.ok(state.checkpoints[1].stateSnapshot);
  }
});
