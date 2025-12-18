const test = require("node:test");
const assert = require("node:assert/strict");

test("Reviewer: validates input/output contracts (happy + unhappy)", async () => {
  const { validateReviewerInput, validateReviewerOutput } = await import("../../../js/agents/stages/deepsearch/review.js");

  const input = {
    reportSkeleton: {
      title: "Report",
      sections: [
        {
          sectionId: "sec_1",
          title: "Intro",
          claimIds: ["c1"],
          wordCount: 42,
          opening: "Hello",
          closing: "World",
          citationIdsUsed: ["e1"],
        },
      ],
      globalStats: { targetWords: 1000, actualWords: 900, sectionCount: 1, citationCount: 1 },
    },
    constraints: { tone: "neutral", audience: "general", reportLength: "brief" },
  };

  assert.ok(validateReviewerInput(input));

  assert.throws(
    () => validateReviewerInput({ ...input, reportSkeleton: { ...input.reportSkeleton, title: "" } }),
    /reportSkeleton\.title/i
  );

  const out = {
    overallScore: 0.75,
    issues: [
      {
        id: "iss_1",
        severity: "minor",
        type: "style",
        sectionId: "sec_1",
        description: "Tone inconsistent.",
        whyItMatters: "Reader trust.",
      },
    ],
    patchPlan: [
      { op: "styleUnify", find: "we", replace: "this report", scope: "global", rationale: "Align tone." },
      { op: "editTitle", newTitle: "New Report", rationale: "Clarify topic." },
    ],
  };

  const normalized = validateReviewerOutput(out);
  assert.equal(normalized.overallScore, 0.75);
  assert.equal(normalized.issues.length, 1);
  assert.equal(normalized.patchPlan.length, 2);

  assert.throws(() => validateReviewerOutput({ ...out, overallScore: 2 }), /overallScore/i);
  assert.throws(() => validateReviewerOutput({ ...out, patchPlan: [{ op: "unknown", rationale: "x" }] }), /patchPlan\.op/i);
});

test("Reviewer: runReviewerAgent parses model JSON and validates output", async () => {
  const { runReviewerAgent } = await import("../../../js/agents/stages/deepsearch/review.js");

  const stageApi = {
    modelRouter: {
      call: async () => ({
        content: JSON.stringify({
          overallScore: 0.9,
          issues: [],
          patchPlan: [{ op: "editTitle", newTitle: "Better", rationale: "Test" }],
        }),
      }),
    },
  };

  const result = await runReviewerAgent(
    { runId: "run_rv" },
    {
      reportSkeleton: {
        title: "Report",
        sections: [
          {
            sectionId: "sec_1",
            title: "Intro",
            claimIds: ["c1"],
            wordCount: 10,
            opening: "a",
            closing: "b",
            citationIdsUsed: [],
          },
        ],
        globalStats: { targetWords: 10, actualWords: 10, sectionCount: 1, citationCount: 0 },
      },
      constraints: { tone: "neutral", audience: "general", reportLength: "brief" },
    },
    stageApi
  );

  assert.equal(result.overallScore, 0.9);
  assert.equal(result.patchPlan.length, 1);
  assert.equal(result.patchPlan[0].op, "editTitle");
});

test("Report diff: applyPatchPlan supports all ops + finalizes citations", async () => {
  const { applyPatchPlan } = await import("../../../js/agents/stages/deepsearch/report-diff.js");

  const sources = [{ sourceId: "s1", title: "Doc", uri: "https://example.com" }];
  const evidenceLedger = [
    { evidenceId: "e1", sourceId: "s1", quote: "Alpha", locator: { charStart: 0, charEnd: 5 } },
    { evidenceId: "e2", sourceId: "s1", quote: "Beta", locator: { charStart: 6, charEnd: 10 } },
  ];

  const report = {
    title: "T",
    strategy: "toc-based",
    sections: [
      { sectionId: "sec_1", title: "Intro", claimIds: ["c1"], content: "Intro {{cite:e1}}." },
      { sectionId: "sec_2", title: "Body", claimIds: ["c2"], content: "Body {{cite:e2}}." },
    ],
  };

  const updated = applyPatchPlan(
    report,
    [
      { op: "editTitle", newTitle: "New T", rationale: "Update" },
      { op: "replaceSection", sectionId: "sec_1", newContent: "UPDATED {{cite:e1}} and {{cite:e2}}.", rationale: "Fix" },
      { op: "insertSection", afterSectionId: "sec_1", sectionId: "sec_ins", newTitle: "Inserted", newContent: "X {{cite:e1}}.", rationale: "Add" },
      { op: "deleteSection", sectionId: "sec_2", rationale: "Remove" },
      { op: "styleUnify", scope: "section", sectionId: "sec_ins", find: "X", replace: "Y", rationale: "Style" },
    ],
    evidenceLedger,
    sources
  );

  assert.equal(updated.title, "New T");
  assert.equal(updated.sections.length, 2);
  assert.equal(updated.sections[0].sectionId, "sec_1");
  assert.equal(updated.sections[1].sectionId, "sec_ins");
  assert.match(updated.draftMarkdown, /## Table of Contents/i);
  assert.match(updated.draftMarkdown, /\{\{cite:e1\}\}/);
  assert.ok(Array.isArray(updated.citations) && updated.citations.length >= 1);
  assert.match(updated.markdown, /\n## References\n/i);
  assert.match(updated.markdown, /\[1\]/);
  assert.match(updated.markdown, /Y \[1\]/);
});

test("Report diff: validates usedEvidenceIds", async () => {
  const { applyPatchPlan } = await import("../../../js/agents/stages/deepsearch/report-diff.js");

  const report = { title: "T", sections: [{ sectionId: "sec_1", title: "Intro", content: "Intro." }] };
  const evidenceLedger = [{ evidenceId: "e1" }];

  assert.throws(
    () =>
      applyPatchPlan(
        report,
        [{ op: "styleUnify", find: "a", replace: "b", scope: "global", usedEvidenceIds: ["e404"], rationale: "bad" }],
        evidenceLedger
      ),
    /Unknown evidenceId/i
  );
});

test("Write stage: reviewer rounds obey maxReviewRounds + emits events + writes reviewFeedback", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage } = await import("../../../js/agents/stages/deepsearch/write.js");

  const state = new DeepSearchState({
    runId: "run_wr",
    taskGoal: "Alpha",
    userConfig: { reportLength: "brief", write: { enableReviewer: true, maxReviewRounds: 1 } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", uri: "https://example.com", sourceTextNormalized: "Alpha is first." }] },
    L1: {
      gaps: [{ gapId: "g1", type: "definition", question: "What is Alpha?", status: "open" }],
      claims: [{ claimId: "c1", text: "Alpha is first.", evidenceIds: ["e1"], gapIds: ["g1"] }],
      evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha is first.", locator: { charStart: 0, charEnd: 14 } }],
    },
  });

  const events = [];
  let reviewCalls = 0;

  const stageApi = {
    emit: (name, record) => events.push({ name, record }),
    reviewer: {
      review: async () => {
        reviewCalls += 1;
        return {
          overallScore: 0.5,
          issues: [],
          patchPlan: [{ op: "styleUnify", find: "Alpha", replace: "ALPHA", scope: "global", rationale: "caps" }],
        };
      },
    },
  };

  const out = await runDeepSearchWriteStage({ runId: "run_wr" }, { state }, stageApi);
  assert.equal(reviewCalls, 1);
  assert.equal(out.report.reviewFeedback.reviewed, true);
  assert.equal(out.report.reviewFeedback.rounds, 1);
  assert.equal(out.report.reviewFeedback.appliedPatches, 1);
  assert.match(out.report.markdown, /ALPHA is first/i);

  const names = events.map((e) => e.name);
  assert.ok(names.includes("deepsearch.write.review.started"));
  assert.ok(names.includes("deepsearch.write.review.completed"));
  assert.ok(names.includes("deepsearch.write.patch.applied"));
});

test("Write stage: reviewer runs multiple rounds when allowed", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage } = await import("../../../js/agents/stages/deepsearch/write.js");

  const state = new DeepSearchState({
    runId: "run_wr2",
    taskGoal: "Alpha",
    userConfig: { reportLength: "brief", write: { enableReviewer: true, maxReviewRounds: 2 } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha is first." }] },
    L1: {
      gaps: [{ gapId: "g1", type: "definition", question: "What is Alpha?", status: "open" }],
      claims: [{ claimId: "c1", text: "Alpha is first.", evidenceIds: ["e1"], gapIds: ["g1"] }],
      evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha is first.", locator: { charStart: 0, charEnd: 14 } }],
    },
  });

  let reviewCalls = 0;
  const stageApi = {
    reviewer: {
      review: async () => {
        reviewCalls += 1;
        return {
          overallScore: 0.5,
          issues: [],
          patchPlan: [{ op: "styleUnify", find: "Alpha", replace: "ALPHA", scope: "global", rationale: "caps" }],
        };
      },
    },
  };

  const out = await runDeepSearchWriteStage({ runId: "run_wr2" }, { state }, stageApi);
  assert.equal(reviewCalls, 2);
  assert.equal(out.report.reviewFeedback.rounds, 2);
  assert.equal(out.report.reviewFeedback.appliedPatches, 2);
});

test("Write: finalizeCitationsInMarkdown handles duplicates + numbering + source resolution", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/write.js");

  const sources = [
    { sourceId: "s1", title: "Doc 1", uri: "https://example.com/1" },
    { sourceId: "s2", uri: "https://example.com/2" },
  ];
  const evidenceLedger = [
    { evidenceId: "e1", sourceId: "s1", quote: "Alpha" },
    { evidenceId: "e2", sourceId: "s2", quote: "Beta" },
  ];

  const out = finalizeCitationsInMarkdown("A {{cite:e1}} then {{cite:e1}} and {{cite:e2}}.", evidenceLedger, sources);
  assert.equal(out.citations.length, 2);
  assert.equal(out.citations[0].evidenceId, "e1");
  assert.equal(out.citations[0].citationId, 1);
  assert.equal(out.citations[1].evidenceId, "e2");
  assert.equal(out.citations[1].citationId, 2);

  assert.match(out.markdown, /A \[1\] then \[1\] and \[2\]\.\n/);
  assert.match(out.markdown, /\n## References\n/);
  assert.match(out.markdown, /- \[1\] Doc 1 — “Alpha”/);
  assert.match(out.markdown, /- \[2\] https:\/\/example\.com\/2 — “Beta”/);
});

test("Write: finalizeCitationsInMarkdown removes missing evidence IDs + skips References when empty", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/write.js");

  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha" }];
  const sources = [{ sourceId: "s1", title: "Doc 1" }];

  const out = finalizeCitationsInMarkdown("X {{cite:e999}} Y {{cite:e1}}.", evidenceLedger, sources);
  assert.match(out.markdown, /^X\s+Y \[1\]\.\n\n## References\n/i);
  assert.ok(!out.markdown.includes("{{cite:e999}}"));
  assert.equal(out.citations.length, 1);
  assert.equal(out.citations[0].evidenceId, "e1");

  const outEmptyLedger = finalizeCitationsInMarkdown("X {{cite:e1}}.", [], sources);
  assert.ok(!outEmptyLedger.markdown.includes("## References"));
  assert.ok(!outEmptyLedger.markdown.includes("[1]"));
  assert.equal(outEmptyLedger.citations.length, 0);
});

test("Write: finalizeCitationsInMarkdown numbers by first appearance order and matches References", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/write.js");

  const sources = [{ sourceId: "s1", title: "Doc 1" }];
  const evidenceLedger = [
    { evidenceId: "e1", sourceId: "s1", quote: "Alpha" },
    { evidenceId: "e2", sourceId: "s1", quote: "Beta" },
  ];

  const out = finalizeCitationsInMarkdown("First {{cite:e2}} then {{cite:e1}} then {{cite:e2}}.", evidenceLedger, sources);
  assert.match(out.markdown, /First \[1\] then \[2\] then \[1\]\.\n/);
  assert.equal(out.citations.length, 2);
  assert.equal(out.citations[0].evidenceId, "e2");
  assert.equal(out.citations[0].citationId, 1);
  assert.equal(out.citations[1].evidenceId, "e1");
  assert.equal(out.citations[1].citationId, 2);
  assert.match(out.markdown, /- \[1\] Doc 1 — “Beta”/);
  assert.match(out.markdown, /- \[2\] Doc 1 — “Alpha”/);
});

test("Write: finalizeCitationsInMarkdown respects pre-existing References section", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/write.js");

  const sources = [{ sourceId: "s1", title: "Doc 1" }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha" }];

  const input = "Body {{cite:e1}}.\n\n## References\n- preexisting\n";
  const out = finalizeCitationsInMarkdown(input, evidenceLedger, sources);
  assert.match(out.markdown, /^Body \[1\]\.\n\n## References\n- preexisting\n$/);
  assert.equal((out.markdown.match(/\n##\s+References\s*\n/gi) || []).length, 1);
});

test("Write: finalizeCitationsInMarkdown newline handling + empty/null input", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/write.js");

  assert.deepEqual(finalizeCitationsInMarkdown("", [], []), { markdown: "", citations: [] });
  assert.deepEqual(finalizeCitationsInMarkdown(null, null, null), { markdown: "", citations: [] });

  assert.equal(finalizeCitationsInMarkdown("Hello", [], []).markdown, "Hello\n");
  assert.equal(finalizeCitationsInMarkdown("Hello\n\n", [], []).markdown, "Hello\n");

  const outWithCite = finalizeCitationsInMarkdown("X {{cite:e1}}.", [{ evidenceId: "e1" }], []);
  assert.ok(outWithCite.markdown.endsWith("\n"));
});

test("ReAct writer: strips duplicate leading heading matching section title", async () => {
  const { stripLeadingDuplicateHeading } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  const md1 = "# Intro\n\nBody.";
  assert.equal(stripLeadingDuplicateHeading(md1, "Intro"), "Body.");

  const md2 = "## 1. Intro!\n\nBody.";
  assert.equal(stripLeadingDuplicateHeading(md2, "1 Intro"), "Body.");

  const md3 = "## Different\n\nBody.";
  assert.equal(stripLeadingDuplicateHeading(md3, "Intro"), md3);
});

test("ReAct writer: tracks used claims across sections via cited evidence IDs", async () => {
  const { createWriterToolExecutor } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  const toolExecutor = createWriterToolExecutor({
    state: {},
    gaps: [{ gapId: "g1", type: "definition", question: "What is Alpha?", status: "open" }],
    claims: [
      { claimId: "c1", text: "Alpha is first.", evidenceIds: ["e1"], gapIds: ["g1"] },
      { claimId: "c2", text: "Beta is second.", evidenceIds: ["e2"], gapIds: ["g1"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "s1", quote: "Alpha is first." },
      { evidenceId: "e2", sourceId: "s1", quote: "Beta is second." },
    ],
    sources: [{ sourceId: "s1", title: "Doc", sourceTextNormalized: "Alpha. Beta." }],
  });

  const before = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(before.claims.find((c) => c.claimId === "c1").usedInOtherSection, false);
  assert.equal(before.claims.find((c) => c.claimId === "c2").usedInOtherSection, false);

  await toolExecutor.execute("writeSection", {
    sectionId: "sec_1",
    gapId: "g1",
    title: "Intro",
    markdown: "Text {{cite:e1}}.",
  });

  const afterWrite = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(afterWrite.claims.find((c) => c.claimId === "c1").usedInOtherSection, true);
  assert.equal(afterWrite.claims.find((c) => c.claimId === "c2").usedInOtherSection, false);

  await toolExecutor.execute("editSection", { sectionId: "sec_1", markdown: "Revised {{cite:e2}}." });
  const afterEdit = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(afterEdit.claims.find((c) => c.claimId === "c1").usedInOtherSection, false);
  assert.equal(afterEdit.claims.find((c) => c.claimId === "c2").usedInOtherSection, true);
});

test("Citations: formats long/table quotes in References", async () => {
  const { finalizeCitationsInMarkdown } = await import("../../../js/agents/stages/deepsearch/citations.js");
  const { formatQuoteForCitation } = await import("../../../js/agents/stages/deepsearch/citations.js");

  const long = "A".repeat(250);
  const formatted = formatQuoteForCitation(long, { maxLen: 200 });
  assert.equal(formatted.length, 200);
  assert.ok(formatted.endsWith("..."));

  assert.equal(formatQuoteForCitation("A \n  B\tC"), "A B C");
  assert.equal(formatQuoteForCitation("|a|b|\n|c|d|"), "[表格数据]");

  const out = finalizeCitationsInMarkdown("X {{cite:e1}}.", [{ evidenceId: "e1", sourceId: "s1", quote: long }], [
    { sourceId: "s1", title: "Doc" },
  ]);
  assert.match(out.markdown, /\n## References\n/);
  assert.match(out.markdown, /— “A{10,}\.\.\.”/);
});

test("ReAct writer: createWriterToolExecutor tools cover happy + error paths", async () => {
  const { createWriterToolExecutor } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  const sourceText = "Alpha is first.\nBeta is second.\nGamma is third.";
  const ctx = {
    state: {},
    gaps: [
      { gapId: "g1", type: "definition", question: "What is Alpha?", status: "open", priority: 1 },
      { gapId: "g2", type: "other", question: "Closed gap", status: "closed", priority: 2 },
      { gapId: "g3", type: "other", question: "Filled gap", status: "filled", priority: 3 },
    ],
    claims: [
      { claimId: "c1", text: "Alpha is first.", importance: "support", evidenceIds: ["e1"], gapIds: ["g1"] },
      { claimId: "c2", text: "Beta is second.", importance: "support", evidenceIds: ["e2"], gapIds: ["g1"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "s1", quote: "Alpha is first.", locator: { charStart: 0, charEnd: 14 } },
      { evidenceId: "e2", sourceId: "s1", quote: "Beta is second.", locator: { charStart: 15, charEnd: 29 } },
    ],
    sources: [{ sourceId: "s1", title: "Doc", uri: "https://example.com", sourceTextNormalized: sourceText }],
    _targetWords: 100,
    _minWords: 1,
    _maxWords: 200,
  };

  const toolExecutor = createWriterToolExecutor(ctx);

  assert.deepEqual(await toolExecutor.execute("unknownTool", {}), { error: "Unknown tool: unknownTool" });

  const gaps = await toolExecutor.execute("getGaps", {});
  assert.equal(gaps.totalGaps, 2);
  assert.deepEqual(
    new Set(gaps.gaps.map((g) => g.gapId)),
    new Set(["g1", "g3"])
  );

  assert.deepEqual(await toolExecutor.execute("getGapDetail", {}), { error: "gapId is required" });
  assert.deepEqual(await toolExecutor.execute("getGapDetail", { gapId: "g404" }), { error: "Gap not found: g404" });
  const detail = await toolExecutor.execute("getGapDetail", { gapId: "g1" });
  assert.equal(detail.claims.length, 2);
  assert.equal(detail.claims[0].evidenceCount, 1);

  assert.deepEqual(await toolExecutor.execute("getClaimsForGap", {}), { error: "gapId is required" });
  const noClaims = await toolExecutor.execute("getClaimsForGap", { gapId: "g404" });
  assert.equal(noClaims.claims.length, 0);
  assert.match(noClaims.message, /No claims found/i);

  assert.deepEqual(await toolExecutor.execute("getEvidence", {}), { error: "evidenceId is required" });
  assert.deepEqual(await toolExecutor.execute("getEvidence", { evidenceId: "e404" }), { error: "Evidence not found: e404" });
  const ev1 = await toolExecutor.execute("getEvidence", { evidenceId: "e1" });
  assert.equal(ev1.sourceTitle, "Doc");
  assert.match(ev1.hint, /getSourceChunk/i);

  assert.deepEqual(await toolExecutor.execute("getSourceChunk", {}), { error: "sourceId is required" });
  assert.deepEqual(await toolExecutor.execute("getSourceChunk", { sourceId: "s404" }), { error: "Source text not available for: s404" });
  const chunk = await toolExecutor.execute("getSourceChunk", { sourceId: "s1", start: -5, end: 10 });
  assert.equal(chunk.charStart, 0);
  assert.equal(chunk.charEnd, 10);
  assert.equal(chunk.text, sourceText.slice(0, 10));

  assert.deepEqual(await toolExecutor.execute("searchEvidence", {}), { error: "query is required" });
  const search = await toolExecutor.execute("searchEvidence", { query: "beta", limit: 1 });
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].evidenceId, "e2");

  assert.deepEqual(await toolExecutor.execute("planOutline", {}), { error: "sections array is required" });
  const outline = await toolExecutor.execute("planOutline", { sections: [{ sectionId: "sec_1", title: "Intro", gapIds: ["g1"], targetWords: 50 }] });
  assert.equal(outline.success, true);
  assert.equal(outline.outline.length, 1);

  assert.deepEqual(await toolExecutor.execute("editSection", { sectionId: "sec_1" }), { error: "sectionId and markdown required" });
  assert.deepEqual(await toolExecutor.execute("editSection", { sectionId: "sec_404", markdown: "X" }), { error: "Section not found: sec_404" });

  assert.deepEqual(await toolExecutor.execute("writeSection", { sectionId: "sec_1", gapId: "g1", title: "Intro", markdown: "" }), { error: "markdown content is required" });
  await toolExecutor.execute("writeSection", { sectionId: "sec_1", gapId: "g1", title: "Intro", markdown: "Body {{cite:e1}}." });
  await toolExecutor.execute("writeSection", { sectionId: "sec_1", gapId: "g1", title: "Intro", markdown: "Updated {{cite:e2}}." });
  const progress = await toolExecutor.execute("getProgress", {});
  assert.equal(progress.sectionsWritten, 1);
  assert.equal(progress.sectionsRemaining, 0);

  const claimsAfter = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(claimsAfter.claims.find((c) => c.claimId === "c2").usedInOtherSection, true);

  await toolExecutor.execute("editSection", { sectionId: "sec_1", markdown: "Edited {{cite:e1}}." });
  const claimsAfterEdit = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(claimsAfterEdit.claims.find((c) => c.claimId === "c1").usedInOtherSection, true);

  const finished1 = await toolExecutor.execute("finishReport", {});
  assert.equal(finished1.title, "Research Report");
  assert.equal(finished1.meetsMinimum, true);
});

test("ReAct writer: runReactWriter end-to-end covers tool loop + heading de-dup + citations", async () => {
  const { runReactWriter } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  // No model caller => hard error
  await assert.rejects(
    () => runReactWriter({ state: { taskGoal: "X", L1: { gaps: [] } }, claims: [], evidenceLedger: [], sources: [], stageApi: {} }),
    /No model caller available/i
  );

  const sourceText = "Alpha is first.\nBeta is second.";
  const state = { taskGoal: "Alpha report", L1: { gaps: [{ gapId: "g1", type: "definition", question: "What is Alpha?", status: "open" }] } };
  const claims = [{ claimId: "c1", text: "Alpha is first.", importance: "support", evidenceIds: ["e1"], gapIds: ["g1"] }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha is first.", locator: { charStart: 0, charEnd: 14 }, gapIds: ["g1"] }];
  const sources = [{ sourceId: "s1", title: "Doc", uri: "https://example.com", sourceTextNormalized: sourceText }];

  const modelOutputs = [
    "not json",
    "{",
    JSON.stringify({ thought: "missing action+finish", foo: "bar" }),
    JSON.stringify({ thought: "missing tool", action: { params: {} } }),
    JSON.stringify({ thought: "unknown tool", action: { tool: "doesNotExist", params: {} } }),
    JSON.stringify({ thought: "get gaps", action: { tool: "getGaps", params: {} } }),
    JSON.stringify({
      thought: "plan outline",
      action: { tool: "planOutline", params: { sections: [{ sectionId: "sec_1", title: "Intro", gapIds: ["g1"], targetWords: 120 }] } },
    }),
    JSON.stringify({ thought: "get claims", action: { tool: "getClaimsForGap", params: { gapId: "g1" } } }),
    JSON.stringify({
      thought: "write",
      action: {
        tool: "writeSection",
        params: { sectionId: "sec_1", gapId: "g1", title: "Intro", markdown: "### Intro\n\nBody {{cite:e1}}." },
      },
    }),
    JSON.stringify({ thought: "progress", action: { tool: "getProgress", params: {} } }),
    JSON.stringify({ thought: "finish", finish: { params: { title: "Alpha", executiveSummary: "Summary." } } }),
  ];

  let callIdx = 0;
  const stageApi = {
    emit: () => {},
    modelRouter: {
      async call(messages, opts) {
        void messages;
        void opts;
        const content = modelOutputs[Math.min(callIdx, modelOutputs.length - 1)];
        callIdx += 1;
        return { content };
      },
    },
  };

  const steps = [];
  const out = await runReactWriter(
    { state, claims, evidenceLedger, sources, stageApi },
    { language: "en", targetWords: 200, minWords: 10, maxWords: 300, hardLimit: 30, onStep: (s) => steps.push(s) }
  );

  assert.equal(out.finished, true);
  assert.equal(out.title, "Alpha");
  assert.equal(out.summary, "Summary.");
  assert.equal(out.sections.length, 1);
  assert.ok(out.draftMarkdown.includes("## Intro"));
  assert.ok(!out.draftMarkdown.includes("### Intro"));
  assert.ok(out.markdown.includes("## References"));
  assert.ok(out.markdown.includes("[1]"));
  assert.ok(Array.isArray(out.citations) && out.citations.length === 1);
  assert.ok(steps.length >= 3);

  // Cover language branches + action-path finishReport break.
  const modelOutputs2 = [
    JSON.stringify({ thought: "write", action: { tool: "writeSection", params: { gapId: "g1", markdown: "Body {{cite:e1}}." } } }),
    JSON.stringify({ thought: "finish", action: { tool: "finishReport", params: { title: "Alpha2", summary: "S2" } } }),
  ];
  let callIdx2 = 0;
  const stageApi2 = {
    emit: () => {},
    modelRouter: {
      async call(messages, opts) {
        void messages;
        void opts;
        const content = modelOutputs2[Math.min(callIdx2, modelOutputs2.length - 1)];
        callIdx2 += 1;
        return { content };
      },
    },
  };

  const outZh = await runReactWriter({ state, claims, evidenceLedger, sources, stageApi: stageApi2 }, { language: "zh", hardLimit: 5 });
  assert.equal(outZh.title, "Alpha2");
  assert.equal(outZh.summary, "S2");

  callIdx2 = 0;
  const outAuto = await runReactWriter({ state, claims, evidenceLedger, sources, stageApi: stageApi2 }, { language: "auto", hardLimit: 5 });
  assert.equal(outAuto.title, "Alpha2");
});

test("ReAct writer: covers execute() error catch + branchy search/preview defaults", async () => {
  const { createWriterToolExecutor } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  const badEvidence = { evidenceId: "e_bad", sourceId: "s1" };
  Object.defineProperty(badEvidence, "quote", {
    get() {
      throw new Error("boom");
    },
  });

  const toolExecutor = createWriterToolExecutor({
    state: {},
    gaps: [{ gapId: "g1", question: "Q", status: undefined }],
    claims: [
      { claimId: "c1", text: "t", evidenceIds: ["e_missing"], gapIds: ["g1"] },
      { claimId: "c2", text: "t2", evidenceIds: ["e_num"], gapIds: ["g1"] },
    ],
    evidenceLedger: [
      badEvidence,
      { evidenceId: "e_num", sourceId: "s_missing", quote: 123, locator: null },
    ],
    sources: [{ sourceId: "s1", sourceTextNormalized: "Alpha", title: undefined }],
  });

  const caught = await toolExecutor.execute("searchEvidence", { query: "a" });
  assert.match(caught.error, /boom/);

  const claimsForGap = await toolExecutor.execute("getClaimsForGap", { gapId: "g1" });
  assert.equal(claimsForGap.claims[0].evidencePreviews[0].error, "not found");
  assert.equal(claimsForGap.claims[1].evidencePreviews[0].quotePreview, "");

  const eNum = await toolExecutor.execute("getEvidence", { evidenceId: "e_num" });
  assert.equal(eNum.sourceTitle, "Unknown Source");
  assert.equal(eNum.hint, null);

  const chunkDefaultEnd = await toolExecutor.execute("getSourceChunk", { sourceId: "s1", start: 0 });
  assert.equal(chunkDefaultEnd.charStart, 0);
  assert.ok(chunkDefaultEnd.charEnd >= 0);
  assert.equal(chunkDefaultEnd.sourceTitle, "Unknown");

  const toolExecutor2 = createWriterToolExecutor({
    state: {},
    gaps: [],
    claims: [],
    evidenceLedger: [
      { evidenceId: "e0", sourceId: "s1", quote: "x".repeat(250) },
      { evidenceId: "e1", sourceId: "s1", quote: "short" },
      { evidenceId: "e2", sourceId: "s1", quote: "also short" },
      { evidenceId: "e3", sourceId: "s1", quote: "ignored" },
      { evidenceId: "e4", sourceId: "s1", quote: "ignored2" },
    ],
    sources: [{ sourceId: "s1", sourceTextNormalized: "Alpha", title: undefined }],
  });

  const searchNoMatch = await toolExecutor2.execute("searchEvidence", { query: "zzz", limit: 0 });
  assert.equal(searchNoMatch.totalResults, 3);
  assert.equal(searchNoMatch.results.length, 3);

  const searchLimit1 = await toolExecutor2.execute("searchEvidence", { query: "short", limit: 1 });
  assert.equal(searchLimit1.results.length, 1);
});

test("ReAct writer: drives remaining branch outcomes for coverage thresholds", async () => {
  const { createWriterToolExecutor, runReactWriter } = await import("../../../js/agents/stages/deepsearch/react-writer.js");

  const toolExecutor = createWriterToolExecutor({
    state: {},
    gaps: [{ gapId: "g1", question: "Q1", status: " " }, { question: "no id", status: "open" }],
    claims: [
      { text: "missing claimId", evidenceIds: [null], gapIds: "nope" },
      { claimId: "c1", text: "Claim 1", evidenceIds: ["e1", null], gapIds: ["g1"] },
    ],
    evidenceLedger: [
      { sourceId: "s1", quote: "missing evidenceId" },
      { evidenceId: "e1", sourceId: "s1", quote: "Alpha", locator: { charStart: 0, charEnd: 5 } },
    ],
    sources: [
      { kind: "user_text", title: "no id", sourceTextNormalized: "x" },
      { sourceId: "s1", kind: "user_text", title: "", sourceTextNormalized: 42 },
    ],
  });

  // getGaps: status missing => default "open" path
  const gaps = await toolExecutor.execute("getGaps", {});
  assert.equal(gaps.totalGaps, 2);

  // planOutline: default sectionId/title/targetWords
  const outline = await toolExecutor.execute("planOutline", { sections: [{}] });
  assert.equal(outline.outline[0].sectionId, "sec_1");
  assert.equal(outline.outline[0].title, "Section 1");
  assert.ok(Array.isArray(outline.outline[0].gapIds));

  // getProgress: remaining path (planned but not written)
  const progress = await toolExecutor.execute("getProgress", {});
  assert.equal(progress.sectionsRemaining, 1);

  // writeSection: default sectionId + default title when no gap/title
  const ws = await toolExecutor.execute("writeSection", { markdown: "X {{cite:e1}}." });
  assert.equal(ws.sectionId, "sec_1");
  assert.match(ws.title, /Section 1/);

  // editSection: missing sectionId branch
  assert.deepEqual(await toolExecutor.execute("editSection", { markdown: "X" }), { error: "sectionId and markdown required" });

  // finishReport: warning path when minimum unmet.
  const toolExecutor2 = createWriterToolExecutor({
    state: {},
    gaps: [],
    claims: [],
    evidenceLedger: [],
    sources: [],
    _minWords: 9999,
  });
  await toolExecutor2.execute("writeSection", { markdown: "tiny" });
  const finished = await toolExecutor2.execute("finishReport", { title: "T", summary: "S" });
  assert.ok(finished.warning);

  // runReactWriter: hardLimit exit without finish => default title + summary omitted + language auto default branch.
  const stageApi = {
    emit: () => {},
    modelRouter: {
      async call() {
        return { content: JSON.stringify({ thought: "noop" }) };
      },
    },
  };
  const out = await runReactWriter(
    { state: { L1: {} }, claims: [], evidenceLedger: [], sources: [], stageApi },
    { hardLimit: 1, tone: "academic", audience: "expert", language: undefined }
  );
  assert.equal(out.finished, false);
  assert.ok(out.draftMarkdown.startsWith("# Research Report"));
});
