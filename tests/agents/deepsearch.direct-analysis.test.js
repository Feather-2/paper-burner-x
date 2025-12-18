const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch DirectAnalysis: multi-source merge uses virtual direct_merged sourceId", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDirectAnalysis } = await import("../../js/agents/stages/deepsearch/direct-analysis.js");

  const s1Text = "Alpha is first.";
  const s2Text = "Beta is second.";

  const state = new DeepSearchState({
    runId: "run_direct_merge",
    taskGoal: "Summarize",
    userConfig: { directAnalysis: { enabled: true } },
    L0: {
      sources: [
        { sourceId: "s1", kind: "user_text", title: "Doc A", sourceTextNormalized: s1Text },
        { sourceId: "s2", kind: "user_text", title: "Doc B", sourceTextNormalized: s2Text },
      ],
    },
  });

  const modelRouter = {
    async call(_messages, _opts) {
      return {
        content: JSON.stringify({
          gaps: [{ gapId: "g1", type: "definition", question: "What is Beta?", status: "filled" }],
          claims: [{ claimId: "c1", text: "Beta is second.", importance: "core", gapIds: ["g1"], evidenceIds: ["e1"] }],
          evidenceLedger: [{ evidenceId: "e1", sourceId: "direct_merged", quote: "Beta is second.", charStart: null, charEnd: null }],
          report: {
            title: "Report",
            summary: "Summary",
            sections: [{ sectionId: "sec_1", title: "S1", markdown: "See [1]." }],
          },
        }),
      };
    },
  };

  await runDirectAnalysis({ runId: "run_direct_merge" }, { state }, { modelRouter });

  const merged = state.L0.sources.find((s) => s?.sourceId === "direct_merged");
  assert.ok(merged);
  assert.equal(merged.kind, "direct_merged");
  assert.ok(typeof merged.sourceTextNormalized === "string" && merged.sourceTextNormalized.length > 0);

  assert.ok(Array.isArray(state.L1.evidenceLedger) && state.L1.evidenceLedger.length === 1);
  const e = state.L1.evidenceLedger[0];
  assert.equal(e.sourceId, "direct_merged");
  assert.equal(
    merged.sourceTextNormalized.slice(e.locator.charStart, e.locator.charEnd),
    e.quote
  );
});

test("DeepSearch DirectAnalysis: single-source mode keeps original sourceId/locator basis", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDirectAnalysis } = await import("../../js/agents/stages/deepsearch/direct-analysis.js");

  const sourceText = "Alpha is first.";
  const charStart = 0;
  const charEnd = sourceText.length;

  const state = new DeepSearchState({
    runId: "run_direct_single",
    taskGoal: "Summarize",
    userConfig: { directAnalysis: { enabled: true } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
  });

  const modelRouter = {
    async call(_messages, _opts) {
      return {
        content: JSON.stringify({
          gaps: [{ gapId: "g1", type: "definition", question: "What is Alpha?", status: "filled" }],
          claims: [{ claimId: "c1", text: "Alpha is first.", importance: "core", gapIds: ["g1"], evidenceIds: ["e1"] }],
          evidenceLedger: [{ evidenceId: "e1", sourceId: "s1", quote: "Alpha is first.", charStart, charEnd }],
          report: {
            title: "Report",
            summary: "Summary",
            sections: [{ sectionId: "sec_1", title: "S1", markdown: "See [1]." }],
          },
        }),
      };
    },
  };

  await runDirectAnalysis({ runId: "run_direct_single" }, { state }, { modelRouter });

  assert.ok(!state.L0.sources.some((s) => s?.sourceId === "direct_merged"));
  assert.ok(Array.isArray(state.L1.evidenceLedger) && state.L1.evidenceLedger.length === 1);
  const e = state.L1.evidenceLedger[0];
  assert.equal(e.sourceId, "s1");
  assert.equal(sourceText.slice(e.locator.charStart, e.locator.charEnd), e.quote);
});

