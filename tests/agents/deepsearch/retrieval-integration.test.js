const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch S4->S5: retrieval-router integration + gapId propagation", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchRetrieveStage } = await import("../../../js/agents/stages/deepsearch/retrieve.js");
  const { runDeepSearchUnderstandStage, computeGapFill } = await import("../../../js/agents/stages/deepsearch/understand.js");
  const { buildToc } = await import("../../../js/agents/retrieval/toc-builder.js");

  const fillerA = "Background filler ".repeat(30);
  const fillerB = "Additional metrics ".repeat(30);
  const sourceText = [
    "# Section A",
    "Definition: Alpha is the first letter.",
    fillerA,
    "More details.",
    "",
    "# Section B",
    "Statistics: Alpha adoption reached 42% in 2024.",
    fillerB,
    "More metrics.",
    "",
  ].join("\n");

  const toc = buildToc(sourceText).tocNodes;
  const secA = toc.find((n) => n.title === "Section A");
  const secB = toc.find((n) => n.title === "Section B");
  assert.ok(secA && secB);

  const state = new DeepSearchState({
    runId: "run_gap_integration",
    taskGoal: "Find definitions and key numbers for Alpha",
    userConfig: { retrieval: { chunkSize: 200, overlap: 0, topK: 2, windowSize: 1, useBm25: true, useGrep: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText, toc }] },
    L1: {
      gaps: [
        { gapId: "gap_def", type: "definition", question: "Define Alpha", queryHints: ["Definition", "Alpha"], targetSectionId: secA.tocNodeId },
        { gapId: "gap_data", type: "data", question: "Key stats for Alpha", queryHints: ["Statistics", "42%"], targetSectionId: secB.tocNodeId },
      ],
    },
  });

  const ret = await runDeepSearchRetrieveStage({ runId: state.runId }, { state }, {});
  assert.ok(Array.isArray(ret.retrievedChunks) && ret.retrievedChunks.length >= 2);

  const hits = ret.retrievedChunks.filter((c) => c.relevance === "hit");
  const contexts = ret.retrievedChunks.filter((c) => c.relevance === "context");
  assert.ok(hits.length >= 1);
  assert.ok(contexts.length >= 1);

  for (const c of ret.retrievedChunks) {
    assert.ok(typeof c.chunkId === "string" && c.chunkId.length);
    assert.equal(c.sourceId, "s1");
    assert.ok(typeof c.locator?.charStart === "number" && typeof c.locator?.charEnd === "number");
    assert.ok(c.locator.charStart < c.locator.charEnd);
    assert.ok(typeof c.text === "string");
    assert.ok(Array.isArray(c.matchedGapIds));
    assert.ok(c.matchedGapIds.length >= 1);
    assert.ok(typeof c.gapId === "string" && c.gapId.length);
  }

  // Scope sanity: at least one hit for gap_data should land in Section B.
  const secBStart = secB.locator.charStart;
  assert.ok(
    hits.some((c) => c.matchedGapIds.includes("gap_data") && c.locator.charEnd > secBStart),
    "expected a hit chunk for gap_data within Section B scope"
  );

  const und = await runDeepSearchUnderstandStage({ runId: state.runId }, { state }, {});
  assert.ok(Array.isArray(und.claims) && und.claims.length >= 1);
  assert.ok(Array.isArray(und.evidenceLedger) && und.evidenceLedger.length >= 1);

  for (const e of und.evidenceLedger) {
    assert.ok(typeof e.evidenceId === "string" && e.evidenceId.length);
    assert.ok(typeof e.chunkId === "string" && e.chunkId.length);
    assert.equal(e.sourceId, "s1");
    assert.ok(Array.isArray(e.gapIds));
    assert.ok(e.gapIds.every((x) => x === "gap_def" || x === "gap_data"));
    assert.ok(e.gapIds.length >= 1);
  }

  for (const c of und.claims) {
    assert.ok(typeof c.claimId === "string" && c.claimId.length);
    assert.ok(Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1);
    assert.ok(Array.isArray(c.gapIds));
    assert.ok(c.gapIds.every((x) => x === "gap_def" || x === "gap_data"));
  }

  const fill = computeGapFill(state.L1.gaps, { claims: und.claims, evidenceLedger: und.evidenceLedger });
  assert.deepEqual(new Set(fill.filledGapIds), new Set(["gap_def", "gap_data"]));
  assert.equal(fill.remainingGaps.length, 0);
});

test("DeepSearch gap-fill logic: partial fill keeps remaining gaps", async () => {
  const { computeGapFill } = await import("../../../js/agents/stages/deepsearch/understand.js");

  const gaps = [
    { gapId: "g1", type: "definition", question: "Define X" },
    { gapId: "g2", type: "data", question: "Stats for X" },
  ];

  const claims = [{ claimId: "c1", text: "Some claim", evidenceIds: ["e1"], gapIds: ["g1"] }];
  const evidenceLedger = [{ evidenceId: "e1", chunkId: "ch1", sourceId: "s1", locator: { charStart: 0, charEnd: 1 }, quote: "x", gapIds: ["g1"] }];

  const out = computeGapFill(gaps, { claims, evidenceLedger });
  assert.deepEqual(out.filledGapIds, ["g1"]);
  assert.equal(out.remainingGaps.length, 1);
  assert.equal(out.remainingGaps[0].gapId, "g2");
});

test("DeepSearchState utilities: extractJsonCandidate, emitter, cancellation, checkpoints", async () => {
  const { DeepSearchState, extractJsonCandidate, makeStageEmitter, checkCancelled } = await import("../../../js/agents/stages/deepsearch/state.js");

  const objJson = JSON.stringify({ a: 1 }, null, 2);
  assert.equal(extractJsonCandidate("```json\n" + objJson + "\n```"), objJson);
  assert.equal(extractJsonCandidate("prefix " + JSON.stringify({ x: 2 }) + " suffix"), '{"x":2}');
  assert.equal(extractJsonCandidate("prefix " + JSON.stringify([1, 2, 3]) + " suffix"), "[1,2,3]");
  assert.equal(extractJsonCandidate(""), null);

  const events = [];
  const emit = (name, payload) => events.push({ name, payload });
  const stageEmit = makeStageEmitter({ emit }, "deepsearch");
  assert.ok(typeof stageEmit === "function");
  stageEmit("evt", { ok: true }, { status: "started" });
  assert.deepEqual(events[0], { name: "evt", payload: { actor: "deepsearch", status: "started", payload: { ok: true } } });

  let checked = false;
  checkCancelled({ checkCancelled: () => (checked = true) });
  assert.equal(checked, true);

  const controller = new AbortController();
  controller.abort("stop");
  assert.throws(() => checkCancelled({ signal: controller.signal }), /stop|Run cancelled/);

  const state = new DeepSearchState({
    runId: "run_cp",
    taskGoal: "Test checkpoints",
    L0: { sources: [] },
    L1: { gaps: [{ gapId: "g1", status: "open" }, { gapId: "g2", status: "filled" }], claims: [{ claimId: "c1" }], evidenceLedger: [{ evidenceId: "e1" }] },
    L2: { retrievedChunks: [{ retrievedId: "rch_1" }] },
  });

  const cp = state.saveCheckpoint();
  assert.equal(cp.metrics.gapCount, 1);
  assert.equal(cp.metrics.claimCount, 1);
  assert.equal(cp.metrics.evidenceCount, 1);
  assert.equal(cp.metrics.retrievedCount, 1);

  state.taskGoal = "mutated";
  state.restoreCheckpoint(cp.checkpointId);
  assert.equal(state.taskGoal, "Test checkpoints");
  assert.ok(state.timeline.some((t) => t.name === "deepsearch.checkpoint.restored"));

  assert.throws(() => state.restoreCheckpoint(""), /checkpointId is required/);
  assert.throws(() => state.restoreCheckpoint("cp_missing"), /Checkpoint not found/);
});

test("Retrieval primitives: chunkText line numbers, grep regex, router metadata merge", async () => {
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");
  const { grepChunks } = await import("../../../js/agents/retrieval/grep.js");
  const { retrieve } = await import("../../../js/agents/retrieval/retrieval-router.js");

  const text = "a\\nbb\\nccc\\n";
  const chunks = chunkText(text, { chunkSize: 3, overlap: 0, includeLineNumbers: true });
  assert.ok(chunks.length >= 2);
  assert.ok(typeof chunks[0].locator.lineStart === "number");
  assert.ok(typeof chunks[0].locator.lineEnd === "number");

  const reHits = grepChunks([{ chunkId: "c1", text: "Hello hello" }], /hello/g, { regex: true, caseSensitive: true });
  assert.equal(reHits[0].matchCount, 1);
  const reHitsI = grepChunks([{ chunkId: "c1", text: "Hello hello" }], /hello/g, { regex: true, caseSensitive: false });
  assert.ok(reHitsI[0].matchCount >= 2);

  const srcText = "alpha alpha alpha beta";
  const srcChunks = chunkText(srcText, { chunkSize: 200, overlap: 0 });
  const sourceIndex = { sourceId: "s1", chunks: srcChunks, fullText: srcText, toc: [] };
  const out = retrieve(
    sourceIndex,
    [
      { gapId: "g_alpha", queryHints: ["alpha"] },
      { gapId: "g_beta", queryHints: ["beta"] },
      "alpha",
    ],
    { topK: 1, windowSize: 0, useBm25: false, useGrep: true }
  );

  assert.equal(out.length, 1);
  assert.deepEqual(new Set(out[0].matchedGapIds), new Set(["g_alpha", "g_beta"]));
});
