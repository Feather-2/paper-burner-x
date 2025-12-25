const test = require("node:test");
const assert = require("node:assert/strict");

test("validateStepSchema: accepts valid thought + action step", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step = {
    thought: "Need to check word count",
    action: {
      tool: "getWordCount",
      params: {},
    },
  };

  const result = validateStepSchema(step);
  assert.ok(result.valid);
  assert.equal(result.error, undefined);
});

test("validateStepSchema: accepts valid thought + finish step", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step = {
    thought: "Report quality is sufficient",
    finish: {
      qualityScore: 8,
      remainingIssues: 2,
      patchPlan: [],
    },
  };

  const result = validateStepSchema(step);
  assert.ok(result.valid);
  assert.equal(result.error, undefined);
});

test("validateStepSchema: accepts step without thought (optional)", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step = {
    action: { tool: "getWordCount", params: {} },
  };

  const result = validateStepSchema(step);
  assert.ok(result.valid); // thought is optional per schema
  assert.equal(result.error, undefined);
});

test("validateStepSchema: rejects step with both action and finish", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step = {
    thought: "Confused step",
    action: { tool: "getWordCount", params: {} },
    finish: { qualityScore: 8, remainingIssues: 0, patchPlan: [] },
  };

  const result = validateStepSchema(step);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("both"));
});

test("validateStepSchema: rejects action without tool name", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step = {
    thought: "Check something",
    action: { params: {} },
  };

  const result = validateStepSchema(step);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("tool"));
});

test("validateStepSchema: rejects finish with qualityScore out of range", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateStepSchema } = __test;

  const step1 = {
    thought: "Done",
    finish: { qualityScore: 11, remainingIssues: 0, patchPlan: [] },
  };

  const result1 = validateStepSchema(step1);
  assert.equal(result1.valid, false);
  assert.ok(result1.error.includes("qualityScore"));

  const step2 = {
    thought: "Done",
    finish: { qualityScore: 0, remainingIssues: 0, patchPlan: [] },
  };

  const result2 = validateStepSchema(step2);
  assert.equal(result2.valid, false);
});

test("validateFinishConditions: accepts qualityScore >= 7 and remainingIssues <= 3", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateFinishConditions } = __test;

  const finish = { qualityScore: 8, remainingIssues: 2 };
  const result = validateFinishConditions(finish);
  assert.ok(result.accepted);
  assert.equal(result.reason, undefined);
});

test("validateFinishConditions: rejects qualityScore < 7", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateFinishConditions } = __test;

  const finish = { qualityScore: 6.5, remainingIssues: 1 };
  const result = validateFinishConditions(finish);
  assert.equal(result.accepted, false);
  assert.ok(result.reason.includes("6.5"));
  assert.ok(result.reason.includes("below minimum 7"));
});

test("validateFinishConditions: rejects remainingIssues > 3", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { validateFinishConditions } = __test;

  const finish = { qualityScore: 8, remainingIssues: 4 };
  const result = validateFinishConditions(finish);
  assert.equal(result.accepted, false);
  assert.ok(result.reason.includes("4"));
  assert.ok(result.reason.includes("exceeds maximum 3"));
});

test("getAvailableTools: returns correct tools for each level", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { TOOL_REGISTRY } = __test;

  const level1 = TOOL_REGISTRY[1];
  assert.ok(level1.includes("getWordCount"));
  assert.ok(level1.includes("searchEvidence"));
  assert.ok(!level1.includes("getSourceChunk"));
  assert.ok(!level1.includes("externalSearch"));

  const level2 = TOOL_REGISTRY[2];
  assert.ok(level2.includes("getWordCount"));
  assert.ok(level2.includes("getSourceChunk"));
  assert.ok(!level2.includes("externalSearch"));

  const level3 = TOOL_REGISTRY[3];
  assert.ok(level3.includes("getWordCount"));
  assert.ok(level3.includes("getSourceChunk"));
  assert.ok(level3.includes("externalSearch"));
});

test("determineNextLevel: upgrades to Level 2 when searchEvidence returns < 3 results", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { determineNextLevel } = __test;

  const state = {
    currentLevel: 1,
    searchEvidence_lowResultCount: 0,
    getSourceChunk_callCount: 0,
  };

  const result = { success: true, data: [{ evidenceId: "e1" }] }; // Only 1 result

  const nextLevel = determineNextLevel(state, "searchEvidence", result, 800, 1000, 1);

  assert.equal(nextLevel, 2);
  assert.equal(state.searchEvidence_lowResultCount, 1);
});

test("determineNextLevel: stays at Level 1 when searchEvidence returns >= 3 results", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { determineNextLevel } = __test;

  const state = {
    currentLevel: 1,
    searchEvidence_lowResultCount: 0,
    getSourceChunk_callCount: 0,
  };

  const result = {
    success: true,
    data: [
      { evidenceId: "e1" },
      { evidenceId: "e2" },
      { evidenceId: "e3" },
    ],
  };

  const nextLevel = determineNextLevel(state, "searchEvidence", result, 800, 1000, 1);

  assert.equal(nextLevel, 1);
});

test("determineNextLevel: upgrades to Level 3 when getSourceChunk called multiple times with large word delta", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { determineNextLevel } = __test;

  const state = {
    currentLevel: 2,
    searchEvidence_lowResultCount: 1,
    getSourceChunk_callCount: 1, // First call
  };

  // Second call to getSourceChunk
  let nextLevel = determineNextLevel(state, "getSourceChunk", { success: true }, 500, 1200, 3);
  assert.equal(state.getSourceChunk_callCount, 2);

  // Word delta = 700, >= 3 iterations, >= 2 getSourceChunk calls
  nextLevel = determineNextLevel(state, "getWordCount", { success: true }, 500, 1200, 3);
  assert.equal(nextLevel, 3);
});

test("determineNextLevel: stays at Level 2 when word delta < 500", async () => {
  const { __test } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");
  const { determineNextLevel } = __test;

  const state = {
    currentLevel: 2,
    searchEvidence_lowResultCount: 1,
    getSourceChunk_callCount: 2,
  };

  // Word delta = 200 (< 500)
  const nextLevel = determineNextLevel(state, "getWordCount", { success: true }, 900, 1100, 3);
  assert.equal(nextLevel, 2);
});

test("runReactReviewer: completes successfully when finish accepted", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  const report = {
    title: "Test Report",
    markdown: "# Test Report\n\n## Introduction\n\nTest content.",
    wordCount: 800,
    sections: [
      { sectionId: "sec_1", title: "Introduction", wordCount: 800 },
    ],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async () => ({
          model: "test-model",
          content: JSON.stringify({
            thought: "Report quality is good",
            finish: {
              qualityScore: 8,
              remainingIssues: 1,
              patchPlan: [],
            },
          }),
        }),
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 15,
    toolExecutor: async (tool, params) => ({ success: true, data: {} }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.equal(result.qualityScore, 8);
  assert.equal(result.remainingIssues, 1);
  assert.equal(result.terminationReason, "quality_met");
  assert.equal(result.steps.length, 1);
  assert.ok(result.steps[0].accepted);
});

test("runReactReviewer: rejects finish when qualityScore < 7 and continues", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  let callCount = 0;

  const report = {
    title: "Test Report",
    markdown: "# Test Report\n\n## Introduction\n\nTest content.",
    wordCount: 800,
    sections: [
      { sectionId: "sec_1", title: "Introduction", wordCount: 800 },
    ],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async () => {
          callCount += 1;
          if (callCount === 1) {
            // First attempt: low quality score
            return {
              model: "test-model",
              content: JSON.stringify({
                thought: "Quality too low",
                finish: {
                  qualityScore: 6,
                  remainingIssues: 1,
                  patchPlan: [],
                },
              }),
            };
          } else {
            // Second attempt: acceptable
            return {
              model: "test-model",
              content: JSON.stringify({
                thought: "Quality improved",
                finish: {
                  qualityScore: 8,
                  remainingIssues: 1,
                  patchPlan: [],
                },
              }),
            };
          }
        },
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 15,
    toolExecutor: async (tool, params) => ({ success: true, data: {} }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.equal(result.qualityScore, 8);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].accepted, undefined); // First finish rejected
  assert.ok(result.steps[1].accepted); // Second finish accepted
});

test("runReactReviewer: enforces hardLimit and terminates", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  const report = {
    title: "Test Report",
    markdown: "# Test Report",
    wordCount: 500,
    sections: [],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async () => ({
          model: "test-model",
          content: JSON.stringify({
            thought: "Keep working",
            action: {
              tool: "getWordCount",
              params: {},
            },
          }),
        }),
      },
    },
  };

  const options = {
    recommendedSteps: 3,
    hardLimit: 5,
    toolExecutor: async () => ({ success: true, data: { wordCount: 500 } }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.equal(result.steps.length, 5);
  assert.equal(result.terminationReason, "hard_limit");
  assert.equal(result.qualityScore, 6); // Forced conservative score
});

test("runReactReviewer: rejects unavailable tool at current level", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  let callCount = 0;

  const report = {
    title: "Test Report",
    markdown: "# Test Report",
    wordCount: 500,
    sections: [],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async () => {
          callCount += 1;
          if (callCount === 1) {
            // Try to call Level 3 tool at Level 1
            return {
              model: "test-model",
              content: JSON.stringify({
                thought: "Need external search",
                action: {
                  tool: "externalSearch",
                  params: { query: "test" },
                },
              }),
            };
          } else {
            // Then finish
            return {
              model: "test-model",
              content: JSON.stringify({
                thought: "Done",
                finish: {
                  qualityScore: 7,
                  remainingIssues: 0,
                  patchPlan: [],
                },
              }),
            };
          }
        },
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 15,
    toolExecutor: async () => ({ success: true, data: {} }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].observation.success, false);
  assert.ok(result.steps[0].observation.error.includes("not available"));
});

test("runReactReviewer: handles model JSON parse failure with retry", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  let callCount = 0;

  const report = {
    title: "Test Report",
    markdown: "# Test Report",
    wordCount: 500,
    sections: [],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async (messages) => {
          callCount += 1;
          if (callCount === 1) {
            // First call: invalid JSON
            return {
              model: "test-model",
              content: "This is not JSON at all",
            };
          } else {
            // Retry: valid JSON
            return {
              model: "test-model",
              content: JSON.stringify({
                thought: "Fixed output",
                finish: {
                  qualityScore: 7,
                  remainingIssues: 0,
                  patchPlan: [],
                },
              }),
            };
          }
        },
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 15,
    toolExecutor: async () => ({ success: true, data: {} }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.ok(callCount >= 2); // Original + retry
  assert.equal(result.qualityScore, 7);
});

test("runReactReviewer: emits events for step execution", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  const events = [];

  const report = {
    title: "Test Report",
    markdown: "# Test Report",
    wordCount: 500,
    sections: [],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      emit: (name, payload) => {
        events.push({ name, payload });
      },
      modelRouter: {
        call: async () => ({
          model: "test-model",
          content: JSON.stringify({
            thought: "Check word count",
            action: {
              tool: "getWordCount",
              params: {},
            },
          }),
        }),
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 2,
    toolExecutor: async () => ({ success: true, data: { wordCount: 500 } }),
  };

  await runReactReviewer(report, context, options);

  const stepEvents = events.filter(e => e.name === "deepsearch.write.react.step");
  assert.ok(stepEvents.length > 0);
  assert.equal(stepEvents[0].payload.payload.tool, "getWordCount");
});

test("runReactReviewer: strips <think> tags from model output", async () => {
  const { runReactReviewer } = await import("../../../js/agents/stages/deepsearch/react-reviewer.js");

  const report = {
    title: "Test Report",
    markdown: "# Test Report",
    wordCount: 500,
    sections: [],
  };

  const context = {
    evidenceLedger: [],
    claims: [],
    sources: [],
    stageApi: {
      modelRouter: {
        call: async () => ({
          model: "test-model",
          content: `<think>
Let me analyze this carefully.
First check the structure.
Then evaluate quality.
</think>

${JSON.stringify({
            thought: "Analysis complete",
            finish: {
              qualityScore: 8,
              remainingIssues: 0,
              patchPlan: [],
            },
          })}`,
        }),
      },
    },
  };

  const options = {
    recommendedSteps: 5,
    hardLimit: 15,
    toolExecutor: async () => ({ success: true, data: {} }),
  };

  const result = await runReactReviewer(report, context, options);

  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].thought, "Analysis complete");
  assert.equal(result.qualityScore, 8);
});
