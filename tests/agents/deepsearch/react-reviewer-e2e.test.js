const { describe, it, mock } = require("node:test");
const assert = require("node:assert/strict");

function createStageApi({ modelCaller, events }) {
  return {
    modelRouter: {
      call: async (messages, opts) => modelCaller(messages, opts),
    },
    emit: (name, data) => {
      if (Array.isArray(events)) events.push({ name, data });
    },
  };
}

function createToolExecutor({ tools, onCall } = {}) {
  const toolMap = tools && typeof tools === "object" ? tools : {};
  const onToolCall = typeof onCall === "function" ? onCall : null;

  return async (toolName, params) => {
    onToolCall?.(toolName, params);

    const toolFn = toolMap[toolName];
    if (typeof toolFn !== "function") {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    const result = await toolFn(params || {});
    if (!result || typeof result !== "object") {
      return { success: false, error: `Tool '${toolName}' returned ${result === null ? "null" : typeof result}` };
    }

    return result;
  };
}

describe("ReAct Reviewer - End-to-End Integration", () => {
  it("should improve report quality from 6.5 to 8+ through ReAct loop", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    const sources = [
      {
        sourceId: "s1",
        title: "Machine Learning Basics",
        uri: "https://example.com/ml",
        kind: "user_text",
        sourceTextNormalized:
          "Machine learning is a subset of artificial intelligence. It enables computers to learn from data without explicit programming. Supervised learning requires labeled data.",
      },
    ];

    const evidenceLedger = [
      {
        evidenceId: "e1",
        sourceId: "s1",
        quote: "Machine learning is a subset of artificial intelligence",
        locator: { charStart: 0, charEnd: 56 },
        gapIds: ["gap_1"],
      },
      {
        evidenceId: "e2",
        sourceId: "s1",
        quote: "It enables computers to learn from data without explicit programming",
        locator: { charStart: 58, charEnd: 126 },
        gapIds: ["gap_1"],
      },
      {
        evidenceId: "e3",
        sourceId: "s1",
        quote: "Supervised learning requires labeled data",
        locator: { charStart: 128, charEnd: 169 },
        gapIds: ["gap_2"],
      },
    ];

    const initialReport = {
      title: "ML Report",
      markdown: "# ML Report\n\n## Introduction\n\nML is powerful.",
      sections: [
        {
          sectionId: "sec_1",
          title: "Introduction",
          content: "ML is powerful.",
          claimIds: [],
        },
      ],
    };

    let step = 0;
    let toolCallSequence = [];

    const mockModelCaller = async () => {
      step += 1;

      if (step === 1) {
        return {
          content: JSON.stringify({
            thought: "First, check current word count",
            action: { tool: "getWordCount", params: {} },
          }),
        };
      }

      if (step === 2) {
        return {
          content: JSON.stringify({
            thought: "Search for ML evidence to expand",
            action: { tool: "searchEvidence", params: { query: "machine learning" } },
          }),
        };
      }

      if (step === 3) {
        return {
          content: JSON.stringify({
            thought: "Get details for e1",
            action: { tool: "getEvidence", params: { evidenceId: "e1" } },
          }),
        };
      }

      if (step === 4) {
        return {
          content: JSON.stringify({
            thought: "Apply patch to improve content",
            action: {
              tool: "applyPatch",
              params: {
                patchPlan: [
                  {
                    op: "replaceSection",
                    sectionId: "sec_1",
                    newContent: "Machine learning is a subset of artificial intelligence {{cite:e1}}. It enables computers to learn from data {{cite:e2}}.",
                    rationale: "Expand with evidence",
                  },
                ],
              },
            },
          }),
        };
      }

      // Final finish with improved quality
      return {
        content: JSON.stringify({
          thought: "Report is now comprehensive",
          finish: {
            qualityScore: 8.2,
            remainingIssues: 1,
            patchPlan: [],
          },
        }),
      };
    };

    const updatedMarkdown =
      "# ML Report\n\n## Introduction\n\nMachine learning is a subset of artificial intelligence [1]. It enables computers to learn from data [2].\n\n## References\n- [1] Machine Learning Basics\n- [2] Machine Learning Basics";

    const mockTools = {
      getWordCount: async () => ({ success: true, data: { total: 3, sections: [] } }),
      searchEvidence: async () => ({
        success: true,
        data: [
          { evidenceId: "e1", quote: evidenceLedger[0].quote, score: 0.95 },
          { evidenceId: "e2", quote: evidenceLedger[1].quote, score: 0.88 },
        ],
      }),
      getEvidence: async (params) => {
        const ev = evidenceLedger.find((e) => e.evidenceId === params.evidenceId);
        return ev ? { success: true, data: ev } : { success: false, error: "Not found" };
      },
      applyPatch: async (params) => ({
        success: true,
        data: {
          ...initialReport,
          markdown: updatedMarkdown,
          wordCount: 20,
          appliedOps: Array.isArray(params?.patchPlan) ? params.patchPlan.length : 0,
        },
      }),
    };

    const events = [];
    const stageApi = createStageApi({ modelCaller: mockModelCaller, events });
    const toolExecutor = createToolExecutor({
      tools: mockTools,
      onCall: (toolName) => toolCallSequence.push(toolName),
    });

    const result = await runReactReviewer(
      initialReport,
      {
        state: { userConfig: {} },
        evidenceLedger,
        sources,
        stageApi,
      },
      {
        toolExecutor,
        hardLimit: 15,
        recommendedSteps: 5,
      }
    );

    // Verify quality improvement
    assert.ok(result.qualityScore >= 8.0);
    assert.equal(result.steps.length, 5);

    // Verify tool call sequence
    assert.deepEqual(toolCallSequence, ["getWordCount", "searchEvidence", "getEvidence", "applyPatch"]);

    // Verify final report has citations
    assert.match(result.finalReport.markdown, /\[1\]/);
    assert.match(result.finalReport.markdown, /## References/i);
  });

  it("should gracefully terminate at hardLimit with warning", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let callCount = 0;
    const logs = [];

    const mockModelCaller = async () => {
      callCount += 1;
      // Never finish, force hardLimit
      return {
        content: JSON.stringify({
          thought: `Iteration ${callCount}`,
          action: { tool: "getWordCount", params: {} },
        }),
      };
    };

    const mockEmit = (name, payload) => {
      logs.push({ name, payload });
    };

    const stageApi = createStageApi({
      modelCaller: mockModelCaller,
      events: logs,
    });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      {
        hardLimit: 10,
        recommendedSteps: 5,
        toolExecutor: createToolExecutor({
          tools: { getWordCount: async () => ({ success: true, data: { total: 5 } }) },
        }),
      }
    );

    assert.equal(result.terminationReason, "hard_limit");
    assert.equal(result.steps.length, 10);

    // Verify hard limit event was logged
    const hardLimitEvents = logs.filter((l) => l.name.includes("react.hard_limit"));
    assert.ok(hardLimitEvents.length > 0);
  });

  it("should retry once on invalid JSON at step 1 and then throw on continued invalid JSON", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let attempt = 0;
    const errors = [];

    const mockModelCaller = async () => {
      attempt += 1;

      if (attempt === 1) {
        // Return invalid JSON
        return { content: "This is not JSON { broken" };
      }

      if (attempt === 2) {
        // Return malformed JSON
        return { content: '{"thought": "Test", "action": {incomplete' };
      }

      // Finally return valid
      return {
        content: JSON.stringify({
          thought: "Valid now",
          finish: { qualityScore: 7.5, remainingIssues: 2, patchPlan: [] },
        }),
      };
    };

    const mockEmit = (name, payload) => {
      if (name.includes("error")) errors.push(payload);
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller, events: errors });

    await assert.rejects(
      () =>
        runReactReviewer(
          { markdown: "# Test" },
          { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
          { toolExecutor: createToolExecutor({ tools: {} }), hardLimit: 15, recommendedSteps: 5 }
        ),
      /parse failed/i
    );

    assert.equal(attempt, 2); // initial call + single retry
    const parseRetry = errors.find((e) => e.name.includes("react.parse_retry"));
    const parseError = errors.find((e) => e.name.includes("react.parse_error"));
    assert.ok(parseRetry);
    assert.ok(parseError);
  });

  it("should track full tool call sequence", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    const events = [];
    let step = 0;

    const mockModelCaller = async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({
            thought: "Check word count",
            action: { tool: "getWordCount", params: {} },
          }),
        };
      }
      if (step === 2) {
        return {
          content: JSON.stringify({
            thought: "Get section",
            action: { tool: "getSectionFull", params: { sectionPath: "## Section" } },
          }),
        };
      }
      return {
        content: JSON.stringify({
          thought: "Done",
          finish: { qualityScore: 8, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const mockEmit = (name, payload) => {
      events.push({ name, payload });
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller, events });

    const mockTools = {
      getWordCount: async () => ({ success: true, data: { total: 100 } }),
      getSectionFull: async () => ({ success: true, data: { sectionId: "sec_1", content: "Content" } }),
    };

    const result = await runReactReviewer(
      { markdown: "# Test\n\n## Section\n\nContent", sections: [{ sectionId: "sec_1", title: "Section", content: "Content" }] },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor: createToolExecutor({ tools: mockTools }), hardLimit: 15, recommendedSteps: 5 }
    );

    // Verify step events
    const stepEvents = events.filter((e) => e.name.includes("react.step"));
    assert.ok(stepEvents.length >= 2);

    // Verify each step has tool, params, result
    for (const evt of stepEvents) {
      assert.ok(evt.data?.payload?.stepIndex !== undefined);
      assert.ok(evt.data?.payload?.tool);
      assert.ok(evt.data?.payload?.result);
    }
  });

  it("should rollback on patch application failure", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let attempt = 0;
    const mockModelCaller = async () => {
      attempt += 1;

      if (attempt === 1) {
        return {
          content: JSON.stringify({
            thought: "Try to apply invalid patch",
            action: {
              tool: "applyPatch",
              params: {
                patchPlan: [
                  {
                    op: "replaceSection",
                    sectionId: "sec_999", // Non-existent section
                    newContent: "New",
                    rationale: "Test",
                  },
                ],
              },
            },
          }),
        };
      }

      // After failure, finish with original report
      return {
        content: JSON.stringify({
          thought: "Patch failed, keep original",
          finish: { qualityScore: 7, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const originalMarkdown = "# Original\n\n## Section\n\nOriginal content";

    const mockTools = {
      applyPatch: async (params) => {
        // Simulate failure
        return {
          success: false,
          error: "Patch failed: Section sec_999 not found",
        };
      },
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });
    const toolExecutor = createToolExecutor({ tools: mockTools });

    const result = await runReactReviewer(
      {
        title: "Original",
        markdown: originalMarkdown,
        sections: [{ sectionId: "sec_1", title: "Section", content: "Original content" }],
      },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor, hardLimit: 15, recommendedSteps: 5 }
    );

    // Verify original report is preserved after failed patch
    assert.equal(result.finalReport.markdown, originalMarkdown);
    assert.equal(String(result.steps[0].observation?.error || "").includes("failed"), true);
  });

  it("should handle model returning <think> blocks correctly", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    const mockModelCaller = async () => {
      return {
        content: `<think>
Let me analyze this report:
1. Word count seems low
2. Need more evidence
3. Structure is acceptable
{"some": "noise in thinking"}
</think>

{"thought": "Analysis complete", "finish": {"qualityScore": 8, "remainingIssues": 1, "patchPlan": []}}`,
      };
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor: createToolExecutor({ tools: {} }), hardLimit: 15, recommendedSteps: 5 }
    );

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].thought, "Analysis complete");
    assert.equal(result.qualityScore, 8);
  });

  it("should enforce quality threshold and reject low scores", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let attempt = 0;
    const mockModelCaller = async () => {
      attempt += 1;

      if (attempt <= 2) {
        return {
          content: JSON.stringify({
            thought: `Attempt ${attempt}`,
            finish: {
              qualityScore: 6.0 + attempt * 0.5, // 6.5, then 7.0
              remainingIssues: 4 - attempt,
              patchPlan: [],
            },
          }),
        };
      }

      return {
        content: JSON.stringify({
          thought: "Finally acceptable",
          finish: { qualityScore: 7.5, remainingIssues: 2, patchPlan: [] },
        }),
      };
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor: createToolExecutor({ tools: {} }), hardLimit: 15, recommendedSteps: 5 }
    );

    // Should reject first two attempts
    assert.ok(attempt >= 2);
    assert.ok(result.qualityScore >= 7.0);
    assert.ok(result.remainingIssues <= 3);
  });

  it("should emit performance metrics", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    const events = [];
    const mockModelCaller = async () => {
      return {
        content: JSON.stringify({
          thought: "Quick analysis",
          finish: { qualityScore: 8, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const mockEmit = (name, payload) => {
      events.push({ name, payload });
    };

    const startTime = Date.now();

    const stageApi = createStageApi({ modelCaller: mockModelCaller, events });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor: createToolExecutor({ tools: {} }), hardLimit: 15, recommendedSteps: 5 }
    );

    const endTime = Date.now();

    // Verify finish accepted event
    const finishAcceptedEvent = events.find((e) => e.name.includes("react.finish_accepted"));
    assert.ok(finishAcceptedEvent);

    // Verify duration tracking
    const duration = finishAcceptedEvent.data?.payload?.duration;
    assert.ok(duration !== undefined);
    assert.ok(duration >= 0);
    assert.ok(duration <= endTime - startTime + 100); // +100ms tolerance
  });

  it("should handle concurrent tool unlocking based on iteration", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let step = 0;

    const mockModelCaller = async (messages) => {
      step += 1;

      if (step === 1) {
        return {
          content: JSON.stringify({
            thought: "Search evidence",
            action: { tool: "searchEvidence", params: { query: "test" } },
          }),
        };
      }

      if (step === 2) {
        return {
          content: JSON.stringify({
            thought: "Try Level 2 tool",
            action: { tool: "getSourceChunk", params: { sourceId: "s1", charStart: 0, charEnd: 50 } },
          }),
        };
      }

      return {
        content: JSON.stringify({
          thought: "Done",
          finish: { qualityScore: 8, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const mockTools = {
      searchEvidence: async () => ({ success: true, data: [{ evidenceId: "e1" }] }), // < 3 results triggers Level 2
      getSourceChunk: async () => ({ success: true, data: { text: "chunk", wordCount: 10 } }),
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });

    const result = await runReactReviewer(
      { markdown: "# Test", wordCount: 50 },
      {
        state: { userConfig: {} },
        evidenceLedger: [],
        sources: [{ sourceId: "s1", sourceTextNormalized: "Source text content here for testing purposes." }],
        stageApi,
      },
      { toolExecutor: createToolExecutor({ tools: mockTools }), hardLimit: 15, recommendedSteps: 5 }
    );

    // Verify level progression
    assert.ok(result.steps.some((s) => s.observation?.currentLevel >= 2));
  });
});

describe("ReAct Reviewer - Coverage Edge Cases", () => {
  it("should handle empty evidenceLedger and sources", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    const mockModelCaller = async () => {
      return {
        content: JSON.stringify({
          thought: "No evidence available",
          finish: { qualityScore: 7, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { toolExecutor: createToolExecutor({ tools: {} }), hardLimit: 15, recommendedSteps: 5 }
    );

    assert.equal(result.qualityScore, 7);
  });

  it("should handle tool returning null or undefined (toolExecutor normalizes)", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let step = 0;
    const mockModelCaller = async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({
            thought: "Call buggy tool",
            action: { tool: "getWordCount", params: {} },
          }),
        };
      }

      return {
        content: JSON.stringify({
          thought: "Done",
          finish: { qualityScore: 7, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const mockTools = {
      getWordCount: async () => null, // Buggy tool
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });
    const toolExecutor = createToolExecutor({
      tools: mockTools,
      onCall: () => {},
    });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      {
        hardLimit: 2,
        recommendedSteps: 5,
        toolExecutor: async (toolName, params) => {
          const res = await toolExecutor(toolName, params);
          if (!res || typeof res !== "object") return { success: false, error: `Tool '${toolName}' returned null` };
          return res;
        },
      }
    );

    assert.equal(result.steps.length, 2);
    assert.ok(String(result.steps[0].observation?.error || "").toLowerCase().includes("null"));
  });

  it("should handle missing tool implementation", async () => {
    const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

    let step = 0;
    const mockModelCaller = async () => {
      step += 1;
      if (step === 1) {
        return {
          content: JSON.stringify({
            thought: "Call missing tool",
            action: { tool: "getWordCount", params: {} },
          }),
        };
      }

      return {
        content: JSON.stringify({
          thought: "Done",
          finish: { qualityScore: 7, remainingIssues: 0, patchPlan: [] },
        }),
      };
    };

    const stageApi = createStageApi({ modelCaller: mockModelCaller });

    const result = await runReactReviewer(
      { markdown: "# Test" },
      { state: { userConfig: {} }, evidenceLedger: [], sources: [], stageApi },
      { hardLimit: 2, recommendedSteps: 5, toolExecutor: createToolExecutor({ tools: {} }) }
    );

    assert.equal(String(result.steps[0].observation?.error || "").toLowerCase().includes("unknown"), true);
  });
});
