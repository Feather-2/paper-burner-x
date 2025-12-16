const test = require("node:test");
const assert = require("node:assert/strict");

function createMockModelRouter(handler) {
  const calls = [];
  return {
    calls,
    call: async (messages, opts) => {
      calls.push({ messages, opts });
      return handler(messages, opts);
    },
  };
}

function createMockAiApiService(handler) {
  const calls = [];
  return {
    calls,
    chat: async (arg) => {
      calls.push(arg);
      return handler(arg);
    },
  };
}

test("getModelCaller: modelRouter vs aiApiService vs null", async () => {
  const { getModelCaller } = await import("../../../js/agents/stages/deepsearch/model.js");

  assert.equal(getModelCaller(null), null);
  assert.equal(getModelCaller({}), null);

  {
    const modelRouter = createMockModelRouter(async () => ({ content: "ok" }));
    const caller = getModelCaller({ modelRouter }, { usage: "planner" });
    assert.equal(typeof caller, "function");
    await caller([{ role: "user", content: "x" }], { temperature: 0.1 });
    assert.equal(modelRouter.calls.length, 1);
    assert.equal(modelRouter.calls[0].opts.usage, "planner");
    assert.equal(modelRouter.calls[0].opts.temperature, 0.1);
  }

  {
    const aiApiService = createMockAiApiService(async () => ({ content: "ok" }));
    const caller = getModelCaller({ aiApiService }, { usage: "writer" });
    assert.equal(typeof caller, "function");
    await caller([{ role: "user", content: "x" }], { ignored: true });
    assert.equal(aiApiService.calls.length, 1);
    assert.deepEqual(aiApiService.calls[0], { messages: [{ role: "user", content: "x" }], usage: "writer", ignored: true });
  }
});

test("DeepSearch scan: uses modelRouter usage=analyst; falls back to aiApiService", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchScanStage } = await import("../../../js/agents/stages/deepsearch/scan.js");

  const makeState = () =>
    new DeepSearchState({
      runId: "run_scan",
      taskGoal: "Test scanning",
      L0: { sources: [{ sourceId: "s1", kind: "url", title: "Doc", uri: "https://example.com", sourceTextNormalized: "Alpha beta gamma delta" }] },
    });

  {
    const state = makeState();
    const modelRouter = createMockModelRouter(async () => ({
      content:
        "```json\n" +
        JSON.stringify({
          scanSummary: { summaryText: "MR summary", topSources: [{ sourceId: "s1", reason: "relevant" }] },
          deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "focus" }] },
        }) +
        "\n```",
    }));

    const out = await runDeepSearchScanStage({ runId: "run_scan" }, { state }, { modelRouter });
    assert.equal(out.scanSummary.summaryText, "MR summary");
    assert.equal(modelRouter.calls.length, 1);
    assert.equal(modelRouter.calls[0].opts.usage, "analyst");
  }

  {
    const state = makeState();
    const aiApiService = createMockAiApiService(async () => ({
      content: JSON.stringify({
        scanSummary: { summaryText: "AI summary", topSources: [{ sourceId: "s1", reason: "relevant" }] },
        deepDivePlan: { steps: [{ action: "review_source", sourceId: "s1", notes: "focus" }] },
      }),
    }));

    const out = await runDeepSearchScanStage({ runId: "run_scan" }, { state }, { aiApiService });
    assert.equal(out.scanSummary.summaryText, "AI summary");
    assert.equal(aiApiService.calls.length, 1);
  }
});

test("DeepSearch gaps: uses modelRouter usage=planner; falls back to aiApiService", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchGapsStage } = await import("../../../js/agents/stages/deepsearch/gaps.js");

  const makeState = () =>
    new DeepSearchState({
      runId: "run_gaps",
      taskGoal: "Compare Alpha vs Beta; explain mechanism",
      L0: { sources: [] },
      L1: { scanSummary: { keyTopics: ["Alpha", "Beta"] } },
    });

  {
    const state = makeState();
    const modelRouter = createMockModelRouter(async () => ({
      content: JSON.stringify({
        gaps: [{ type: "example", question: "What is a real-world example of Alpha vs Beta?", priority: "low", queryHints: ["case", "example"] }],
      }),
    }));

    const out = await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, { modelRouter });
    assert.equal(modelRouter.calls.length, 1);
    assert.equal(modelRouter.calls[0].opts.usage, "planner");
    assert.ok(out.gaps.some((g) => g.question === "What is a real-world example of Alpha vs Beta?"));
  }

  {
    const state = makeState();
    const aiApiService = createMockAiApiService(async () => ({
      content: JSON.stringify({
        gaps: [{ type: "data", question: "What is the key metric for Alpha?", priority: "high", queryHints: ["metric"] }],
      }),
    }));

    const out = await runDeepSearchGapsStage({ runId: "run_gaps" }, { state }, { aiApiService });
    assert.equal(aiApiService.calls.length, 1);
    assert.ok(out.gaps.some((g) => g.question === "What is the key metric for Alpha?"));
  }
});

test("DeepSearch understand: uses modelRouter usage=analyst; falls back to aiApiService", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../../js/agents/stages/deepsearch/understand.js");

  const sourceTextNormalized = "Definition: Alpha is the first letter. Statistics: Alpha adoption reached 42% in 2024.";
  const chunkText = sourceTextNormalized.slice(0, 60);

  const makeState = () =>
    new DeepSearchState({
      runId: "run_understand",
      taskGoal: "Explain Alpha",
      L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Input", sourceTextNormalized }] },
      L2: {
        retrievedChunks: [
          {
            chunkId: "chunk_1",
            sourceId: "s1",
            locator: { charStart: 0, charEnd: 60 },
            text: chunkText,
            score: 1,
            matchedGapIds: ["gap_1"],
          },
        ],
      },
    });

  {
    const state = makeState();
    const modelRouter = createMockModelRouter(async () => ({
      content: JSON.stringify({ claims: [{ claimId: "c_1", text: "Alpha is the first letter.", importance: "core" }] }),
    }));

    const out = await runDeepSearchUnderstandStage({ runId: "run_understand" }, { state }, { modelRouter });
    assert.equal(modelRouter.calls.length, 1);
    assert.equal(modelRouter.calls[0].opts.usage, "analyst");
    assert.ok(out.claims.some((c) => c.claimId === "c_1" && c.text === "Alpha is the first letter."));
  }

  {
    const state = makeState();
    const aiApiService = createMockAiApiService(async () => ({
      content: JSON.stringify({ claims: [{ claimId: "c_1", text: "Alpha adoption reached 42% in 2024.", importance: "support" }] }),
    }));

    const out = await runDeepSearchUnderstandStage({ runId: "run_understand" }, { state }, { aiApiService });
    assert.equal(aiApiService.calls.length, 1);
    assert.ok(out.claims.some((c) => c.claimId === "c_1" && c.text === "Alpha adoption reached 42% in 2024."));
  }
});

test("DeepSearch write: uses modelRouter usage=writer; falls back to aiApiService", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchWriteStage } = await import("../../../js/agents/stages/deepsearch/write.js");

  const makeState = () =>
    new DeepSearchState({
      runId: "run_write",
      taskGoal: "Compare Alpha vs Beta",
      userConfig: { title: "Alpha vs Beta" },
      L0: { sources: [{ sourceId: "s_1", kind: "user_text", title: "Doc", sourceTextNormalized: "Alpha Beta" }] },
      L1: {
        claims: [
          { claimId: "c_1", text: "Alpha is widely adopted.", importance: "core", evidenceIds: ["e_1"], gapIds: ["gap_1"] },
          { claimId: "c_2", text: "Beta has trade-offs.", importance: "support", evidenceIds: ["e_2"], gapIds: ["gap_2"] },
        ],
        evidenceLedger: [
          { evidenceId: "e_1", sourceId: "s_1", locator: { charStart: 0, charEnd: 5 }, quote: "Alpha" },
          { evidenceId: "e_2", sourceId: "s_1", locator: { charStart: 6, charEnd: 10 }, quote: "Beta" },
        ],
      },
    });

  {
    const state = makeState();
    const modelRouter = createMockModelRouter(async () => ({
      content: "ok",
    }));

    modelRouter.call = async (messages, opts) => {
      modelRouter.calls.push({ messages, opts });
      const sys = String(messages?.[0]?.content || "");
      if (sys.includes("PPT slide planner")) {
        return {
          content: JSON.stringify({
            slideIntents: [
              { slideIntentId: "s_custom", pageType: "overview", title: "LLM Overview", objective: "Summarize", keyPoints: ["A", "B"], claimIds: ["c_1"] },
            ],
            outlineCandidates: [{ outlineId: "o_custom", title: "LLM Outline", bullets: ["Background", "Findings"] }],
          }),
        };
      }
      if (sys.includes("research report writer")) {
        return { content: JSON.stringify({ title: "Alpha vs Beta", markdown: "Report text." }) };
      }
      return { content: "ok" };
    };

    const out = await runDeepSearchWriteStage({ runId: "run_write" }, { state }, { modelRouter });
    assert.equal(modelRouter.calls.length, 2);
    assert.equal(modelRouter.calls[0].opts.usage, "writer");
    assert.equal(modelRouter.calls[1].opts.usage, "writer");
    assert.ok(out.slideIntents.some((s) => s.pageType === "cover"));
    assert.ok(out.slideIntents.some((s) => s.pageType === "summary"));
    assert.ok(out.slideIntents.some((s) => s.pageType === "content"));
    assert.ok(out.outlineCandidates.some((o) => o.title === "LLM Outline"));
  }

  {
    const state = makeState();
    const aiApiService = createMockAiApiService(async () => ({
      content: "ok",
    }));

    aiApiService.chat = async (arg) => {
      aiApiService.calls.push(arg);
      const sys = String(arg?.messages?.[0]?.content || "");
      if (sys.includes("PPT slide planner")) {
        return { content: JSON.stringify({ slideIntents: [{ pageType: "comparison", title: "LLM Comparison", claimIds: ["c_2"] }] }) };
      }
      if (sys.includes("research report writer")) {
        return { content: JSON.stringify({ title: "Alpha vs Beta", markdown: "Report text." }) };
      }
      return { content: "ok" };
    };

    const out = await runDeepSearchWriteStage({ runId: "run_write" }, { state }, { aiApiService });
    assert.equal(aiApiService.calls.length, 2);
    assert.ok(out.slideIntents.some((s) => s.pageType === "cover"));
    assert.ok(out.slideIntents.some((s) => s.pageType === "summary"));
    assert.ok(out.slideIntents.some((s) => s.pageType === "content"));
  }
});
