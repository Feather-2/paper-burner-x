import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const executeTool = vi.fn();
  const maybePersistToolOutput = vi.fn();
  return { executeTool, maybePersistToolOutput };
});

vi.mock("../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  executeTool: hoisted.executeTool,
}));

vi.mock("../../../../../js/agents/runtime/persisted-output.js", () => ({
  maybePersistToolOutput: hoisted.maybePersistToolOutput,
}));

function makeAgent(overrides = {}) {
  return {
    state: { runId: "test_run", L0: { sources: [] } },
    _logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    _emit: vi.fn(),
    _recordToolCall: vi.fn(() => null),
    addMessage: vi.fn(),
    sourceManager: { syncSources: vi.fn() },
    sharedContext: {},
    discoveryManager: null,
    memory: null,
    checkpoint: null,
    backtrackManager: null,
    ...overrides,
  };
}

function makeStageApi(overrides = {}) {
  return {
    runStore: null,
    sideEffects: { getCursor: vi.fn(() => "cursor_123") },
    toolTimeoutMs: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.executeTool.mockResolvedValue({ success: true, data: "ok" });
  hoisted.maybePersistToolOutput.mockResolvedValue({
    inline: { success: true, data: "ok" },
    persisted: false,
    ref: null,
  });
});

describe("execution-phase/executeDeepSearchDecision", () => {
  it("returns { toolCalls: 0 } when decision is null", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const result = await executeDeepSearchDecision({
      agent: makeAgent(),
      stageApi: makeStageApi(),
      decision: null,
      plannedIteration: 1,
    });
    expect(result).toEqual({ toolCalls: 0 });
  });

  it("validates and falls back to ask-user when action is not a string", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: 123, args: {} },
      plannedIteration: 1,
    });
    expect(agent._logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid tool action"));
    expect(hoisted.executeTool).toHaveBeenCalledWith("ask-user", { reason: "invalid_tool_action" }, expect.any(Object));
  });

  it("validates and falls back to ask-user when args is an array", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "read-doc", args: ["bad", "args"] },
      plannedIteration: 1,
    });
    expect(agent._logger.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid tool args"));
    expect(hoisted.executeTool).toHaveBeenCalledWith("ask-user", { reason: "invalid_tool_args" }, expect.any(Object));
  });

  it("executes single tool with timeout wrapper", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    const result = await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi({ toolTimeoutMs: 1000 }),
      decision: { action: "list-docs", args: { filter: "pdf" } },
      plannedIteration: 2,
    });
    expect(result).toEqual({ toolCalls: 1 });
    expect(hoisted.executeTool).toHaveBeenCalledWith("list-docs", { filter: "pdf" }, expect.any(Object));
    expect(agent.addMessage).toHaveBeenCalledTimes(1);
  });

  it("handles batch execution with multiple tools", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    const result = await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: {
        actions: [
          { action: "list-docs", args: {} },
          { action: "read-doc", args: { docId: "doc_1" } },
        ],
      },
      plannedIteration: 3,
    });
    expect(result).toEqual({ toolCalls: 2 });
    expect(hoisted.executeTool).toHaveBeenCalledTimes(2);
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("批量执行结果"),
      })
    );
  });

  it("times out when tool exceeds timeout", async () => {
    hoisted.executeTool.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 200))
    );
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    // Use a very short timeout to trigger timeout
    const stageApi = makeStageApi({ toolTimeoutMs: 50 });
    // For single tool, the timeout error should propagate
    await expect(
      executeDeepSearchDecision({
        agent,
        stageApi,
        decision: { action: "slow-tool", args: {} },
        plannedIteration: 1,
      })
    ).rejects.toThrow(/timed out/);
  });

  it("logs only metadata for tool result (no sensitive data)", async () => {
    hoisted.executeTool.mockResolvedValue({ success: true, secretKey: "sk_123456" });
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent();
    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "get-secrets", args: {} },
      plannedIteration: 1,
    });
    const debugCalls = agent._logger.debug.mock.calls.map((c) => c[0]);
    const metaLog = debugCalls.find((c) => c.includes("Tool result meta"));
    expect(metaLog).toBeDefined();
    expect(metaLog).not.toContain("sk_123456");
    expect(metaLog).toContain("success");
    expect(metaLog).toContain("byteSize");
  });

  it("logs warning when getSideEffectsCursor throws", async () => {
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const agent = makeAgent({
      checkpoint: { save: vi.fn() },
    });
    const stageApi = makeStageApi({
      sideEffects: {
        getCursor: () => {
          throw new Error("cursor error");
        },
      },
    });
    await executeDeepSearchDecision({
      agent,
      stageApi,
      decision: { action: "test-tool", args: {} },
      plannedIteration: 1,
    });
    expect(agent._logger.warn).toHaveBeenCalledWith(expect.stringContaining("getSideEffectsCursor failed"));
  });

  it("handles watchdog handoff and backtrack", async () => {
    hoisted.executeTool.mockResolvedValue({
      mode: "handoff",
      handoff: { reason: "stuck", hint: "try different approach" },
    });
    const { executeDeepSearchDecision } = await import(
      "../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
    );
    const newState = { runId: "test_run", iteration: 0 };
    const agent = makeAgent({
      backtrackManager: {
        canBacktrack: vi.fn(() => true),
        backtrack: vi.fn(async () => ({ success: true, state: newState })),
      },
    });
    const result = await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "watchdog", args: {} },
      plannedIteration: 5,
    });
    expect(result).toEqual({ toolCalls: 1, backtracked: true });
    expect(agent.backtrackManager.backtrack).toHaveBeenCalled();
    expect(agent.state).toBe(newState);
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("已回溯"),
      })
    );
  });
});
