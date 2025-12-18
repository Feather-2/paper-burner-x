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
      userConfig: { understanding: { strictMode: true } },
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
      userConfig: { understanding: { strictMode: true } },
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
      userConfig: { understanding: { strictMode: true } },
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc" }] },
      L2: { retrievedChunks: [{ chunkId: "ch1", sourceId: "s1", locator: { charStart: 0, charEnd: 5 }, text: "Alpha" }] },
    });
    await assert.rejects(() => runDeepSearchUnderstandStage({ runId: "run_h4" }, { state }, {}), /H4/);
  }
});

function createTestEmitter() {
  const events = [];
  const stageApi = {
    emit(name, payload) {
      events.push({ name, payload });
    },
  };
  return { stageApi, events };
}

function createMockModelRouter({ claimEditsContent = "not json", reflectContent = "{}", onCall } = {}) {
  const calls = [];
  const claimCalls = [];
  const reflectCalls = [];

  const modelRouter = {
    async call(messages, opts) {
      const kind = Array.isArray(messages) && messages.length === 1 && messages[0]?.role === "user" ? "reflect" : "claimEdits";
      const record = { kind, messages, opts };
      calls.push(record);
      if (kind === "reflect") reflectCalls.push(record);
      else claimCalls.push(record);

      if (typeof onCall === "function") onCall(record);

      const content = kind === "reflect" ? reflectContent : claimEditsContent;
      return { content: typeof content === "function" ? await content(record) : content };
    },
  };

  return { modelRouter, calls, claimCalls, reflectCalls };
}

test("DeepSearch S5: understand soft-degrades invalid evidence and emits degraded hardgate", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", "Beta is second.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;
  const bStart = sourceText.indexOf("Beta");
  const bEnd = bStart + "Beta is second.".length;

  const state = new DeepSearchState({
    runId: "run_soft_degrade",
    taskGoal: "Test soft degradation",
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: {
      gaps: [],
      claims: [{ claimId: "c_bad", text: "Bad claim", importance: "support", evidenceIds: ["e_bad"] }],
      evidenceLedger: [
        {
          evidenceId: "e_bad",
          sourceId: "s1",
          locator: { charStart: aStart, charEnd: aEnd },
          quote: "Alpha is second.",
        },
      ],
    },
    L2: {
      retrievedChunks: [
        // Missing chunkId is allowed: validation is grounded on sourceId + locator + quote only.
        { sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 2.0 },
        { chunkId: "ch_ok", sourceId: "s1", locator: { charStart: bStart, charEnd: bEnd }, text: sourceText.slice(bStart, bEnd), score: 1.0 },
      ],
    },
  });

  const { stageApi, events } = createTestEmitter();
  const out = await runDeepSearchUnderstandStage({ runId: "run_soft_degrade" }, { state }, stageApi);

  assert.ok(out.degradation);
  assert.equal(out.degradation.invalidEvidenceCount, 1);
  assert.ok(out.degradation.validEvidenceCount >= 1);
  assert.ok(out.evidenceLedger.length >= 1);
  assert.ok(!out.evidenceLedger.some((e) => e.evidenceId === "e_bad"));

  const invalidEvents = events.filter((e) => e.name === "deepsearch.evidence.invalid");
  assert.equal(invalidEvents.length, 1);
  assert.equal(invalidEvents[0].payload?.payload?.evidenceId, "e_bad");
  assert.ok(Array.isArray(invalidEvents[0].payload?.payload?.issues));
  assert.ok(invalidEvents[0].payload.payload.issues.some((s) => String(s).includes("quote mismatch")));

  const degradedEmits = events.filter((e) => e.name === "deepsearch.hardgate.degraded");
  assert.equal(degradedEmits.length, 1);
  assert.equal(degradedEmits[0].payload?.payload?.invalidEvidenceCount, 1);

  const orphanedEmits = events.filter((e) => e.name === "deepsearch.claim.orphaned");
  assert.equal(orphanedEmits.length, 1);

  assert.ok(out.state.timeline.some((t) => t?.name === "deepsearch.hardgate.degraded"));
});

test("DeepSearch S5: reflect gating disabled skips reflect LLM and returns sufficient", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;

  const state = new DeepSearchState({
    runId: "run_reflect_off",
    taskGoal: "Test reflect off",
    userConfig: { reflect: { enabled: false } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps: [{ gapId: "g1", status: "open", question: "Need g1" }] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 1.0, matchedGapIds: ["g1"] },
      ],
    },
  });

  const { stageApi: baseApi } = createTestEmitter();
  const router = createMockModelRouter({
    reflectContent: () => {
      throw new Error("reflect LLM should be gated off");
    },
  });
  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_off" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 0);
  assert.ok(out.reflectResult);
  assert.equal(out.reflectResult.sufficient, true);
});

test("DeepSearch S5: reflect enabled calls LLM and parses response", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;

  const state = new DeepSearchState({
    runId: "run_reflect_on",
    taskGoal: "Test reflect on",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps: [{ gapId: "g1", status: "open", question: "Need g1" }] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 1.0 },
      ],
    },
  });

  const { stageApi: baseApi, events } = createTestEmitter();
  const router = createMockModelRouter({
    reflectContent: JSON.stringify({
      sufficient: false,
      confidence: 0.93,
      reason: "Missing key aspect",
      missingAspects: ["Aspect A"],
      suggestedQueries: ["query a"],
    }),
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_on" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 1);
  assert.equal(out.reflectResult.sufficient, false);
  assert.equal(out.reflectResult.confidence, 0.93);
  assert.deepEqual(out.reflectResult.missingAspects, ["Aspect A"]);
  assert.deepEqual(out.reflectResult.suggestedQueries, ["query a"]);

  assert.ok(events.some((e) => e.name === "deepsearch.reflect.needsmore"));
});

test("DeepSearch S5: reflect quick-path no gaps returns sufficient without reflect LLM", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;

  const state = new DeepSearchState({
    runId: "run_reflect_quick_nogaps",
    taskGoal: "Test no gaps quick path",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps: [] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 1.0 },
      ],
    },
  });

  const { stageApi: baseApi } = createTestEmitter();
  const router = createMockModelRouter({
    reflectContent: () => {
      throw new Error("reflect LLM should not be called on no-gaps quick path");
    },
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_quick_nogaps" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 0);
  assert.equal(out.reflectResult.sufficient, true);
});

test("DeepSearch S5: reflect quick-path high coverage returns sufficient without reflect LLM", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["A1.", "A2.", "A3.", "A4.", "A5.", ""].join("\n");
  const starts = ["A1.", "A2.", "A3.", "A4.", "A5."].map((t) => sourceText.indexOf(t));
  const ends = starts.map((s) => s + 3);

  const gaps = [
    { gapId: "g1", status: "filled", question: "g1" },
    { gapId: "g2", status: "filled", question: "g2" },
    { gapId: "g3", status: "filled", question: "g3" },
    { gapId: "g4", status: "filled", question: "g4" },
    { gapId: "g5", status: "filled", question: "g5" },
    { gapId: "g6", status: "filled", question: "g6" },
    { gapId: "g7", status: "filled", question: "g7" },
    { gapId: "g8", status: "filled", question: "g8" },
    { gapId: "g9", status: "open", question: "g9" },
    { gapId: "g10", status: "open", question: "g10" },
  ];

  const state = new DeepSearchState({
    runId: "run_reflect_quick_coverage",
    taskGoal: "Test high coverage quick path",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: starts[0], charEnd: ends[0] }, text: sourceText.slice(starts[0], ends[0]), score: 5.0 },
        { chunkId: "ch2", sourceId: "s1", locator: { charStart: starts[1], charEnd: ends[1] }, text: sourceText.slice(starts[1], ends[1]), score: 4.0 },
        { chunkId: "ch3", sourceId: "s1", locator: { charStart: starts[2], charEnd: ends[2] }, text: sourceText.slice(starts[2], ends[2]), score: 3.0 },
        { chunkId: "ch4", sourceId: "s1", locator: { charStart: starts[3], charEnd: ends[3] }, text: sourceText.slice(starts[3], ends[3]), score: 2.0 },
        { chunkId: "ch5", sourceId: "s1", locator: { charStart: starts[4], charEnd: ends[4] }, text: sourceText.slice(starts[4], ends[4]), score: 1.0 },
      ],
    },
  });

  const { stageApi: baseApi } = createTestEmitter();
  const router = createMockModelRouter({
    claimEditsContent: JSON.stringify({
      claims: [
        { claimId: "c_1", text: "A1.", importance: "core" },
        { claimId: "c_2", text: "A2.", importance: "core" },
        { claimId: "c_3", text: "A3.", importance: "support" },
        { claimId: "c_4", text: "A4.", importance: "support" },
        { claimId: "c_5", text: "A5.", importance: "support" },
      ],
    }),
    reflectContent: () => {
      throw new Error("reflect LLM should not be called on high-coverage quick path");
    },
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_quick_coverage" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 0);
  assert.equal(out.reflectResult.sufficient, true);
  assert.ok(String(out.reflectResult.reason).includes("High coverage"));
});

test("DeepSearch S5: reflect malformed JSON falls back using default response", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;

  const state = new DeepSearchState({
    runId: "run_reflect_bad_json",
    taskGoal: "Test malformed reflect JSON",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps: [{ gapId: "g1", status: "open", question: "Need g1" }] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 1.0 },
      ],
    },
  });

  const { stageApi: baseApi } = createTestEmitter();
  const router = createMockModelRouter({
    reflectContent: "```json\n{\"sufficient\": tru, \"confidence\": 0.9}\n```",
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_bad_json" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 1);
  assert.equal(out.reflectResult.sufficient, false);
  assert.ok(String(out.reflectResult.reason).startsWith("Reflect error:"));
  assert.ok(Array.isArray(out.reflectResult.missingAspects));
});

test("DeepSearch S5: reflect extracts JSON from code fences", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const sourceText = ["Alpha is first.", ""].join("\n");
  const aStart = sourceText.indexOf("Alpha");
  const aEnd = aStart + "Alpha is first.".length;

  const state = new DeepSearchState({
    runId: "run_reflect_fenced_json",
    taskGoal: "Test fenced JSON parsing",
    userConfig: { reflect: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    L1: { gaps: [{ gapId: "g1", status: "open", question: "Need g1" }] },
    L2: {
      retrievedChunks: [
        { chunkId: "ch1", sourceId: "s1", locator: { charStart: aStart, charEnd: aEnd }, text: sourceText.slice(aStart, aEnd), score: 1.0 },
      ],
    },
  });

  const { stageApi: baseApi } = createTestEmitter();
  const router = createMockModelRouter({
    reflectContent: [
      "Here is the result:",
      "```json",
      JSON.stringify({ sufficient: true, confidence: 1, reason: "OK", missingAspects: [], suggestedQueries: [] }, null, 2),
      "```",
      "extra trailing text",
    ].join("\n"),
  });

  const out = await runDeepSearchUnderstandStage({ runId: "run_reflect_fenced_json" }, { state }, { ...baseApi, modelRouter: router.modelRouter });

  assert.equal(router.reflectCalls.length, 1);
  assert.equal(out.reflectResult.sufficient, true);
  assert.equal(out.reflectResult.confidence, 1);
});
