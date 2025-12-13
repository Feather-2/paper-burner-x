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
