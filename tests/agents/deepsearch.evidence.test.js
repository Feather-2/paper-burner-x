const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch S5: claimsFromChunks extracts minimal claims with evidence linkage", async () => {
  const { claimsFromChunks } = await import("../../js/agents/deepsearch/understanding/claims-from-chunks.js");

  const sourceText = ["Alpha is first.", "Beta is second.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;
  const bStart = sourceText.indexOf("Beta");
  const bEnd = bStart + "Beta is second.".length;

  const retrievedChunks = [
    { chunkId: "ch_1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 2.0 },
    { chunkId: "ch_2", sourceId: "s1", locator: { charStart: bStart, charEnd: bEnd }, text: sourceText.slice(bStart, bEnd), score: 1.0 },
  ];

  const out = claimsFromChunks(retrievedChunks, { maxQuoteLen: 120 });
  assert.equal(out.claims.length, 2);
  assert.equal(out.evidences.length, 2);

  const evidenceById = new Map(out.evidences.map((e) => [e.evidenceId, e]));
  for (const c of out.claims) {
    assert.ok(typeof c.claimId === "string" && c.claimId.length);
    assert.ok(typeof c.text === "string" && c.text.length);
    assert.ok(typeof c.importance === "string" && c.importance.length);
    assert.ok(Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1);
    for (const eid of c.evidenceIds) assert.ok(evidenceById.has(eid));
  }

  for (const e of out.evidences) {
    assert.ok(typeof e.evidenceId === "string" && e.evidenceId.length);
    assert.ok(typeof e.chunkId === "string" && e.chunkId.length);
    assert.equal(e.sourceId, "s1");
    assert.ok(typeof e.locator?.charStart === "number" && typeof e.locator?.charEnd === "number");
    assert.ok(e.locator.charStart < e.locator.charEnd);
    assert.ok(typeof e.quote === "string" && e.quote.length);
  }
});

test("DeepSearch S5: dedupeClaims merges duplicates and keeps best evidence binding", async () => {
  const { dedupeClaims } = await import("../../js/agents/deepsearch/understanding/dedupe.js");

  const claims = [
    { claimId: "c1", text: "Alpha improves performance in 2024.", importance: "core", evidenceIds: ["e1"] },
    { claimId: "c2", text: "Alpha improves performance in 2024", importance: "support", evidenceIds: ["e2", "e3"] },
    { claimId: "c3", text: "Beta is unrelated.", importance: "support", evidenceIds: ["e4"] },
  ];

  const merged = dedupeClaims(claims, { threshold: 0.8 });
  assert.equal(merged.length, 2);

  const alpha = merged.find((c) => c.text.toLowerCase().includes("alpha improves performance"));
  assert.ok(alpha);
  assert.equal(alpha.importance, "core");
  assert.deepEqual(new Set(alpha.evidenceIds), new Set(["e1", "e2", "e3"]));

  const noMerge = dedupeClaims(claims, { threshold: 0.8, mergeEvidence: false });
  const alphaNoMerge = noMerge.find((c) => c.text.toLowerCase().includes("alpha improves performance"));
  assert.ok(alphaNoMerge);
  assert.deepEqual(alphaNoMerge.evidenceIds, ["e1"]);

  const distinct = dedupeClaims(
    [
      { claimId: "d1", text: "Alpha improves performance.", importance: "support", evidenceIds: ["e1"] },
      { claimId: "d2", text: "Alpha improves quality.", importance: "support", evidenceIds: ["e2"] },
    ],
    { threshold: 0.82 }
  );
  assert.equal(distinct.length, 2);
});

test("DeepSearch S5: detectConflicts flags contradictory claims (negation + numeric)", async () => {
  const { detectConflicts } = await import("../../js/agents/deepsearch/understanding/conflicts.js");

  const claims = [
    { claimId: "c1", text: "Alpha adoption reached 42% in 2024." },
    { claimId: "c2", text: "Alpha adoption reached 10% in 2024." },
    { claimId: "c3", text: "Alpha improves performance." },
    { claimId: "c4", text: "Alpha does not improve performance." },
  ];

  const out = detectConflicts(claims, { topicThreshold: 0.5, numericThreshold: 0.6 });
  assert.ok(out.conflicts.length >= 2);
  assert.ok(out.conflicts.some((c) => (c.claimId1 === "c3" && c.claimId2 === "c4") || (c.claimId1 === "c4" && c.claimId2 === "c3")));
  assert.ok(out.conflicts.some((c) => (c.claimId1 === "c1" && c.claimId2 === "c2") || (c.claimId1 === "c2" && c.claimId2 === "c1")));
  assert.ok(out.openQuestions.length >= 2);
  for (const q of out.openQuestions) {
    assert.ok(typeof q.question === "string" && q.question.length);
    assert.ok(Array.isArray(q.relatedClaimIds) && q.relatedClaimIds.length >= 2);
  }
});

test("DeepSearch S5: understand stage builds evidenceLedger with exact locator/quote and validates H1-H4", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", "Alpha is not first.", ""].join("\n");
  const a1Start = sourceText.indexOf("Alpha is first.");
  const a1End = a1Start + "Alpha is first.".length;
  const a2Start = sourceText.indexOf("Alpha is not first.");
  const a2End = a2Start + "Alpha is not first.".length;

  const state = new DeepSearchState({
    runId: "run_s5",
    taskGoal: "Test S5",
    userConfig: { understanding: { maxQuoteLen: 120, dedupeThreshold: 0.9 } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: a1Start, charEnd: a1End }, text: sourceText.slice(a1Start, a1End), score: 2 },
        { chunkId: "ch2", sourceId: "s1", locator: { charStart: a2Start, charEnd: a2End }, text: sourceText.slice(a2Start, a2End), score: 1 },
      ],
    },
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_s5" }, { state }, {});
  assert.ok(Array.isArray(out.claims) && out.claims.length >= 1);
  assert.ok(Array.isArray(out.evidenceLedger) && out.evidenceLedger.length >= 1);

  const evidenceById = new Map(out.evidenceLedger.map((e) => [e.evidenceId, e]));
  for (const c of out.claims) {
    assert.ok(Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1);
    for (const eid of c.evidenceIds) assert.ok(evidenceById.has(eid));
  }

  for (const e of out.evidenceLedger) {
    assert.equal(e.sourceId, "s1");
    assert.ok(typeof e.chunkId === "string" && e.chunkId.length);
    assert.ok(typeof e.locator?.charStart === "number" && typeof e.locator?.charEnd === "number");
    assert.ok(e.locator.charStart < e.locator.charEnd);
    assert.equal(sourceText.slice(e.locator.charStart, e.locator.charEnd), e.quote);
  }

  assert.ok(Array.isArray(out.conflicts));
  assert.ok(Array.isArray(out.openQuestions));
  assert.ok(out.openQuestions.some((q) => typeof q.question === "string" && q.relatedClaimIds?.length >= 2));
});

test("DeepSearch S5: hard gate failures surface as errors (H2/H3/H4)", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");

  // H2: locator out of bounds
  {
    const state = new DeepSearchState({
      runId: "run_h2",
      taskGoal: "Test H2",
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
      L2: { retrievedChunks: [{ chunkId: "ch1", sourceId: "s1", locator: { charStart: 0, charEnd: 10_000 }, text: "Alpha" }] },
    });
    await assert.rejects(() => runDeepSearchUnderstandStage({ runId: "run_h2" }, { state }, {}), /H2/);
  }

  // H3: locator slice is whitespace-only (cannot derive quote)
  {
    const whitespaceText = "     \nAlpha\n";
    const state = new DeepSearchState({
      runId: "run_h3",
      taskGoal: "Test H3",
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: whitespaceText }] },
      L2: { retrievedChunks: [{ chunkId: "ch1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }] },
    });
    await assert.rejects(() => runDeepSearchUnderstandStage({ runId: "run_h3" }, { state }, {}), /H3/);
  }

  // H4: missing sourceTextNormalized for referenced sourceId
  {
    const state = new DeepSearchState({
      runId: "run_h4",
      taskGoal: "Test H4",
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc" }] },
      L2: { retrievedChunks: [{ chunkId: "ch1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }] },
    });
    await assert.rejects(() => runDeepSearchUnderstandStage({ runId: "run_h4" }, { state }, {}), /H4/);
  }
});
