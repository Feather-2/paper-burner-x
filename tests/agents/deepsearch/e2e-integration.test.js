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

function makeMockModelRouter() {
  const calls = [];
  return {
    calls,
    async call(messages, opts = {}) {
      calls.push({ messages: Array.isArray(messages) ? messages : [], opts: opts && typeof opts === "object" ? { ...opts } : {} });
      return { content: "{}" };
    },
  };
}

function detectModelStage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const sys = String(list.find((m) => m && m.role === "system")?.content || "").toLowerCase();
  if (sys.includes("deepsearch scanner")) return "scan";
  if (sys.includes("gap planner")) return "gaps";
  if (sys.includes("claim extractor")) return "understand";
  if (sys.includes("ppt slide planner")) return "write";
  return null;
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

// P1 Tests
test("P1 E2E: ModelRouter integration (usage-based routing)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const modelRouter = makeMockModelRouter();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMore evidence: 42% is cited.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_modelrouter", constraints: {} }, { rawTexts }, { emit });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_modelrouter",
    taskGoal: "Define Alpha and provide key metrics and numbers",
    maxIterations: 2,
    userConfig: { retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
    L0: { sources: ingestOut.sources },
  });

  const stage = new DeepSearchStage();
  await stage.execute({ runId: "run_ds_e2e_modelrouter", mode: "deepsearch", constraints: {} }, { state }, { emit, modelRouter });

  const expectedUsage = { scan: "analyst", gaps: "planner", understand: "analyst", write: "writer" };
  const seen = new Set();

  for (const c of modelRouter.calls) {
    const detected = detectModelStage(c.messages);
    if (!detected) continue;
    seen.add(detected);
    assert.equal(c.opts.usage, expectedUsage[detected], `expected usage=${expectedUsage[detected]} for stage=${detected}, got ${String(c.opts.usage)}`);
  }

  assert.equal(seen.has("scan"), true);
  assert.equal(seen.has("gaps"), true);
  assert.equal(seen.has("understand"), true);
  assert.equal(seen.has("write"), true);
  assert.ok(events.some((e) => e.name === "deepsearch.completed"));
});

test("P1 E2E: PlanningTree integration (gap expansion)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const aiApiService = makeMockAiApiService();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMore evidence: 42% is cited.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_planningtree", constraints: {} }, { rawTexts }, { emit });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_planningtree",
    taskGoal: "Define Alpha and provide key metrics and numbers",
    maxIterations: 3,
    userConfig: { gaps: { blockAfterMisses: 2 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
    L0: { sources: ingestOut.sources },
  });

  let nodesAtFirstGapsStage = null;
  const emitWithSnapshot = (name, record) => {
    emit(name, record);
    if (name === "deepsearch.gaps.completed" && nodesAtFirstGapsStage === null) {
      nodesAtFirstGapsStage = state.planningTree?.nodes?.size ?? null;
    }
  };

  const stage = new DeepSearchStage();
  const pkg = await stage.execute({ runId: "run_ds_e2e_planningtree", mode: "deepsearch", constraints: {} }, { state }, { emit: emitWithSnapshot, aiApiService });

  assertContentPackageBasics(pkg);

  assert.ok(state.planningTree && typeof state.planningTree.getNodesForGap === "function");
  assert.ok(nodesAtFirstGapsStage !== null && nodesAtFirstGapsStage > 1, `expected planningTree nodes > 1 after gaps stage, got ${String(nodesAtFirstGapsStage)}`);

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  assert.ok(gaps.length >= 2);

  for (const g of gaps) {
    const nodes = state.planningTree.getNodesForGap(g.gapId);
    assert.ok(Array.isArray(nodes) && nodes.length >= 1, `expected planningTree nodes for gapId=${String(g.gapId)}`);
  }

  // Verify status updates when gaps are filled.
  const filled = gaps.filter((g) => g.status === "filled");
  assert.ok(filled.length >= 1);
  for (const g of filled) {
    const nodes = state.planningTree.getNodesForGap(g.gapId);
    assert.ok(nodes.every((n) => n.status === "completed"), `expected planningTree nodes completed for filled gapId=${String(g.gapId)}`);
  }
});

// P2 Tests
test("P2 E2E: Multi-trajectory (pass@2 with merge)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TrajectoryManager } = await import("../../../js/agents/stages/deepsearch/trajectory.js");

  const aiApiService = makeMockAiApiService();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMore evidence: 42% is cited.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_traj", constraints: {} }, { rawTexts }, { emit });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_traj",
    taskGoal: "Define Alpha and provide key metrics and numbers",
    maxIterations: 2,
    userConfig: {
      trajectory: { n: 2, mergeStrategy: "best" },
      gaps: { blockAfterMisses: 2 },
      retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true },
    },
    L0: { sources: ingestOut.sources },
  });

  const originalComputeQuality = TrajectoryManager.prototype.computeQuality;
  let computeQualityCalls = 0;
  TrajectoryManager.prototype.computeQuality = function (...args) {
    computeQualityCalls++;
    return originalComputeQuality.call(this, ...args);
  };

  try {
    const stage = new DeepSearchStage();
    const pkg = await stage.execute({ runId: "run_ds_e2e_traj", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService });
    assertContentPackageBasics(pkg);
  } finally {
    TrajectoryManager.prototype.computeQuality = originalComputeQuality;
  }

  const forked = events.find((e) => e.name === "deepsearch.trajectory.forked");
  const merged = events.find((e) => e.name === "deepsearch.trajectory.merged");
  assert.ok(forked && forked.record?.payload?.n === 2);
  assert.ok(merged);

  const trajectoryIds = new Set(
    events
      .filter((e) => e.name === "deepsearch.checkpoint.saved")
      .map((e) => e.record?.payload?.trajectoryId)
      .filter(Boolean)
  );
  assert.equal(trajectoryIds.size, 2);
  assert.ok(computeQualityCalls >= 2, `expected computeQuality called >= 2 times, got ${computeQualityCalls}`);
});

test("P2 E2E: Audio adapter produces LRC format", async () => {
  const { AudioAdapter } = await import("../../../js/agents/ingest/adapters/audio.js");

  const whisperApi = {
    async transcribe(_file, _opts) {
      return {
        text: "Hello world",
        segments: [
          { start: 0, end: 0.5, text: "Hello" },
          { start: 1.23, end: 1.9, text: "world" },
        ],
      };
    },
  };

  const adapter = new AudioAdapter({ whisperApi });
  const buf = new Uint8Array([0, 1, 2, 3]).buffer;
  const fileLike = { name: "clip.wav", type: "audio/wav", size: 4, async arrayBuffer() { return buf; } };

  const out = await adapter.parse(fileLike);
  assert.ok(typeof out.lrc === "string" && out.lrc.length > 0);
  const lines = out.lrc.split("\n").filter(Boolean);
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.match(line, /^\[\d{2}:\d{2}\.\d{2}\].+/);
  assert.ok(out.lrc.includes("[00:00.00]Hello"));
  assert.ok(out.lrc.includes("[00:01.23]world"));
});

test("P2 E2E: WorkerPool offloads BM25 indexing", async () => {
  const { buildIndex, buildIndexAsync, search } = await import("../../../js/agents/retrieval/bm25.js");

  const chunks = [
    { chunkId: "a", text: "deep learning for search and retrieval" },
    { chunkId: "b", text: "bm25 ranking function for information retrieval" },
    { chunkId: "c", text: "cats and dogs" },
  ];

  let offloaded = false;
  const mockWorkerPool = {
    async buildIndex(ch, opts) {
      offloaded = true;
      return buildIndex(ch, opts);
    },
  };

  const idx = await buildIndexAsync(chunks, { k1: 1.2, b: 0.75, workerPool: mockWorkerPool });
  assert.equal(offloaded, true);

  const results = search(idx, "bm25 retrieval", 3);
  assert.equal(results[0].chunkId, "b");
});

// P3 Tests
test("P3 E2E: Error handling (retry + degradation + timeline recording)", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { ErrorHandler, DeepSearchError, ErrorLevel } = await import("../../../js/agents/core/error-handler.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\nComparison: Alpha vs Beta.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMechanism: scan -> retrieve -> understand.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_p3_err", constraints: {} }, { rawTexts }, { emit });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_p3_err",
    taskGoal: "Define Alpha; compare Alpha vs Beta; provide key metrics",
    maxIterations: 2,
    userConfig: { gaps: { blockAfterMisses: 2 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
    L0: { sources: ingestOut.sources },
  });

  const baseAiApiService = makeMockAiApiService();
  const handler = new ErrorHandler({ maxRetries: 3, retryDelayMs: 1, exponentialBackoff: false });
  handler.sleep = async () => {};

  let providerAttempts = 0;
  const aiApiService = {
    calls: baseAiApiService.calls,
    async chat({ messages } = {}) {
      return handler.withRetry(
        async () => {
          providerAttempts++;
          if (providerAttempts === 1) throw new DeepSearchError("rate limit", { level: ErrorLevel.RETRYABLE, canRetry: true });
          if (providerAttempts === 2) throw new DeepSearchError("temporary degradation", { level: ErrorLevel.DEGRADABLE, canRetry: true });
          return baseAiApiService.chat({ messages });
        },
        {
          retries: 3,
          onRetry: ({ error }) => handler.recordError(state, error, { stage: "aiApiService.chat" }),
        }
      );
    },
  };

  const deepsearch = new DeepSearchStage();
  const pkg = await deepsearch.execute({ runId: "run_ds_e2e_p3_err", mode: "deepsearch", constraints: {} }, { state }, { emit, aiApiService });

  assertContentPackageBasics(pkg);
  assert.equal(providerAttempts >= 3, true);

  const errorEvents = (Array.isArray(state.timeline) ? state.timeline : []).filter((e) => String(e?.name || "").startsWith("deepsearch.error."));
  assert.ok(errorEvents.some((e) => e.name === "deepsearch.error.retryable"));
  assert.ok(errorEvents.some((e) => e.name === "deepsearch.error.degradable"));
  assert.ok(events.some((e) => e.name === "deepsearch.completed"));

  assert.equal(state.L1.scanSummary.summaryText, "LLM scan: definitions, metrics, comparisons, mechanism, examples");
});

test("P3 E2E: TaskManager tracks progress through pipeline", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { DeepSearchStage } = await import("../../../js/agents/stages/deepsearch/index.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { TaskManager, TaskStatus } = await import("../../../js/agents/core/task-manager.js");

  const aiApiService = makeMockAiApiService();
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const rawTexts = [
    { title: "Alpha Definition", text: "Definition: Alpha is a thing with clear scope.\n" },
    { title: "Metrics", text: "Statistics: adoption reached 42% in 2024.\nMore evidence: 42% is cited.\n" },
  ];

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 140, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute({ runId: "run_ds_e2e_p3_tm", constraints: {} }, { rawTexts }, { emit });

  const state = new DeepSearchState({
    runId: "run_ds_e2e_p3_tm",
    taskGoal: "Define Alpha and provide key metrics and numbers",
    maxIterations: 2,
    userConfig: { gaps: { blockAfterMisses: 2 }, retrieval: { topK: 2, windowSize: 0, useBm25: true, useGrep: true } },
    L0: { sources: ingestOut.sources },
  });

  const taskManager = new TaskManager();
  const progressUpdates = [];
  const originalUpdateProgress = taskManager.updateProgress.bind(taskManager);
  taskManager.updateProgress = (taskId, progress) => {
    progressUpdates.push({ taskId, ...progress });
    return originalUpdateProgress(taskId, progress);
  };

  const stage = new DeepSearchStage();
  const pkg = await stage.execute(
    { runId: "run_ds_e2e_p3_tm", mode: "deepsearch", constraints: {} },
    { state },
    { emit, aiApiService, taskManager }
  );

  assertContentPackageBasics(pkg);

  const task = taskManager.get("run_ds_e2e_p3_tm");
  assert.ok(task);
  assert.equal(task.status, TaskStatus.COMPLETED);
  assert.ok(task.completedAt);

  assert.ok(progressUpdates.length >= 2);
  assert.ok(progressUpdates.some((u) => typeof u.iteration === "number"));
  assert.ok(progressUpdates.some((u) => typeof u.gapCount === "number"));
  assert.ok(progressUpdates.some((u) => typeof u.claimCount === "number"));
  assert.ok(progressUpdates.some((u) => u.claimCount > 0));

  const last = progressUpdates[progressUpdates.length - 1];
  assert.equal(last.iteration, pkg.metrics.deepsearch.iteration);
  assert.equal(task.progress.iteration, pkg.metrics.deepsearch.iteration);
  assert.ok(events.some((e) => e.name === "deepsearch.completed"));
});

test("P3 E2E: Asset understanding with Vision API", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { understandAsset } = await import("../../../js/agents/ingest/asset-understanding.js");

  assert.equal(typeof understandAsset, "function");

  const bytes = Buffer.from("%PDF-1.4\n%mock\n");
  const file = {
    name: "doc.pdf",
    type: "application/pdf",
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };

  const placeholder = "![Figure](images/img-001.png)";
  const mockOcr = {
    async processFile(f) {
      assert.equal(f.name, "doc.pdf");
      return {
        markdown: `# Doc\n\n${placeholder}\n`,
        images: [{ id: "img-001.png", data: "data:image/png;base64,AAAA" }],
        metadata: { engine: "mock" },
      };
    },
  };

  const visionCalls = [];
  const visionApi = {
    async describe(image, prompt) {
      visionCalls.push({ image, prompt: String(prompt) });
      if (String(prompt).startsWith("Describe")) return { content: "A simple diagram about Alpha." };
      if (String(prompt).startsWith("Extract all")) return { content: "Alpha 42%" };
      return { content: "" };
    },
  };

  const stage = new IngestStage({ defaultChunkOptions: { chunkSize: 80, overlap: 0, includeLineNumbers: false } });
  const out = await stage.execute(
    { runId: "run_ingest_p3_vision", constraints: {} },
    { files: [file], config: { understandAssets: true } },
    { ocr: mockOcr, visionApi }
  );

  assert.equal(out.assets.length, 1);
  assert.equal(out.sources.length, 1);

  const asset = out.assets[0];
  assert.equal(asset.type, "image");
  assert.ok(asset.understanding && typeof asset.understanding === "object");
  assert.equal(asset.understanding.description, "A simple diagram about Alpha.");
  assert.ok(typeof asset.understanding.ocrText === "string" && asset.understanding.ocrText.includes("Alpha"));

  assert.ok(visionCalls.some((c) => c.prompt.startsWith("Describe")));
  assert.ok(visionCalls.some((c) => c.prompt.startsWith("Extract all")));
});
