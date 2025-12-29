const test = require("node:test");
const assert = require("node:assert/strict");

test("cross-verify: starts subtask and writes verdict back", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  const { SharedContext } = await import("../../../js/agents/stages/deepsearch/runtime/shared-context.js");
  const { DiscoveryManager, DiscoveryStatus } = await import("../../../js/agents/sdk/DiscoveryManager.js");
  const { globalSubagentRegistry } = await import("../../../js/agents/sdk/SubagentRegistry.js");
  const { handler } = await import("../../../js/agents/stages/deepsearch/tools/cross-verify/handler.js");

  const mockType = "__test_verifier__";
  globalSubagentRegistry.register(
    mockType,
    async () => ({
      run: async () => ({
        ok: true,
        report:
          "```json\n" +
          JSON.stringify(
            {
              status: "satisfied",
              conclusion: "10B 是 2023 实际值，8B 是 2024 预测值（口径/时间轴不同）",
              confidence: 0.9,
              rationale: "两者来自不同年份/口径，不构成同一指标的直接矛盾。",
              keyEvidence: [
                { sourceId: "doc_2023", evidenceId: "ev_a", quote: "Revenue 2023: $10B" },
                { sourceId: "doc_2024", evidenceId: "ev_b", quote: "Revenue 2024E: $8B" },
              ],
              remainingUncertainty: "",
            },
            null,
            2
          ) +
          "\n```\n" +
          "- Done\n",
      }),
    }),
    "test-only verifier"
  );

  const state = new DeepSearchState({
    runId: "run_cross_verify_test",
    taskGoal: "test",
    L0: {
      sources: [
        { sourceId: "doc_2023", name: "doc_2023", sourceText: "Revenue 2023: $10B" },
        { sourceId: "doc_2024", name: "doc_2024", sourceText: "Revenue 2024E: $8B" },
      ],
    },
  });
  const sharedContext = new SharedContext({ runId: "run_cross_verify_test" });
  const discoveryManager = new DiscoveryManager({ sharedContext, runId: "run_cross_verify_test" });

  const result = await handler(
    {
      factId: "gap_revenue",
      contradiction: "同一项目在不同文档中金额不一致 (10B vs 8B)",
      sourceIds: ["doc_2023", "doc_2024"],
      subagent_type: mockType,
      async: false,
      timeout: 2000,
    },
    {
      state,
      sharedContext,
      discoveryManager,
      stageApi: { signal: new AbortController().signal },
      emit: () => {},
    }
  );

  assert.equal(result.success, true);
  assert.equal(result.factId, "gap_revenue");
  assert.ok(typeof result.taskId === "string" && result.taskId.startsWith("task_"));
  assert.equal(result.discoveryStatus, DiscoveryStatus.SATISFIED);
  assert.equal(result.verification.factId, "gap_revenue");
  assert.equal(result.verification.discoveryStatus, DiscoveryStatus.SATISFIED);
  assert.equal(result.verification.verdict.status, "satisfied");

  const scratch = state.getScratchpad("crossVerify");
  assert.ok(scratch && typeof scratch === "object");
  assert.ok(scratch.gap_revenue);
  assert.equal(scratch.gap_revenue.status, "completed");
  assert.equal(scratch.gap_revenue.taskId, result.taskId);
  assert.equal(scratch.gap_revenue.discoveryStatus, DiscoveryStatus.SATISFIED);

  const pointer = sharedContext.getDetail("cross_verify:gap_revenue");
  assert.ok(pointer);
  assert.equal(pointer.taskId, result.taskId);
  assert.equal(pointer.discoveryStatus, DiscoveryStatus.SATISFIED);

  const discovery = discoveryManager.getDiscovery("gap_revenue");
  assert.ok(discovery);
  assert.equal(discovery.status, DiscoveryStatus.SATISFIED);
});

