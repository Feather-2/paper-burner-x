import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  const executeTool = vi.fn();
  const maybePersistToolOutput = vi.fn();
  return { executeTool, maybePersistToolOutput };
});

vi.mock("../../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  executeTool: hoisted.executeTool,
}));

vi.mock("../../../../../../js/agents/runtime/index.js", () => ({
  maybePersistToolOutput: hoisted.maybePersistToolOutput,
}));

const loadModule = async () =>
  await import(
    "../../../../../../js/agents/stages/deepsearch/phases/execution-phase.js"
  );

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
    runStore: { id: "runstore_1" },
    sideEffects: { getCursor: vi.fn(() => "cursor_123") },
    toolTimeoutMs: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  hoisted.executeTool.mockResolvedValue({ success: true, data: "ok" });
  hoisted.maybePersistToolOutput.mockResolvedValue({
    inline: { success: true, data: "ok" },
    persisted: false,
    ref: null,
  });
});

describe("execution-phase/executeDeepSearchDecision", () => {
  it("returns { toolCalls: 0 } for null/undefined decisions", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const resultNull = await executeDeepSearchDecision({
      agent: makeAgent(),
      stageApi: makeStageApi(),
      decision: null,
      plannedIteration: 1,
    });
    const resultUndefined = await executeDeepSearchDecision({
      agent: makeAgent(),
      stageApi: makeStageApi(),
      decision: undefined,
      plannedIteration: 1,
    });

    expect(resultNull).toEqual({ toolCalls: 0 });
    expect(resultUndefined).toEqual({ toolCalls: 0 });
    expect(hoisted.executeTool).not.toHaveBeenCalled();
  });

  it("falls back to ask-user when action is an empty string", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "", args: {} },
      plannedIteration: 1,
    });

    expect(agent._logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid tool action")
    );
    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "ask-user",
      { reason: "invalid_tool_action" },
      expect.any(Object)
    );
  });

  it("treats empty actions array as invalid tool action", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { actions: [] },
      plannedIteration: 2,
    });

    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "ask-user",
      { reason: "invalid_tool_action" },
      expect.any(Object)
    );
  });

  it("falls back to ask-user when args is an empty array", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "read-doc", args: [] },
      plannedIteration: 3,
    });

    expect(agent._logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid tool args")
    );
    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "ask-user",
      { reason: "invalid_tool_args" },
      expect.any(Object)
    );
  });

  it("accepts empty object args", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "list-docs", args: {} },
      plannedIteration: 4,
    });

    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "list-docs",
      {},
      expect.any(Object)
    );
    expect(agent._logger.warn).not.toHaveBeenCalled();
  });

  it("passes boundary values and whitespace strings through to executeTool", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    const args = {
      page: 0,
      offset: -1,
      limit: Number.MAX_SAFE_INTEGER,
      note: "   ",
      count: "12",
    };

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "list-docs", args },
      plannedIteration: 5,
    });

    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "list-docs",
      args,
      expect.any(Object)
    );
  });

  it("treats actions object as invalid (object-as-array boundary)", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { actions: { action: "list-docs", args: {} } },
      plannedIteration: 6,
    });

    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "ask-user",
      { reason: "invalid_tool_action" },
      expect.any(Object)
    );
  });

  it("executes batch tools, persists outputs, and adds loop guard note", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent({
      _recordToolCall: vi
        .fn()
        .mockReturnValueOnce({
          shouldWarn: true,
          tool: "list-docs",
          consecutive: 3,
        })
        .mockReturnValue(null),
    });

    hoisted.executeTool
      .mockResolvedValueOnce({ success: true, data: "one" })
      .mockResolvedValueOnce({ success: true, data: "two" });
    hoisted.maybePersistToolOutput
      .mockResolvedValueOnce({ inline: { data: "one" }, persisted: true, ref: "ref1" })
      .mockResolvedValueOnce({ inline: { data: "two" }, persisted: false, ref: null });

    const stageApi = makeStageApi({ runStore: { id: "store_1" } });

    const result = await executeDeepSearchDecision({
      agent,
      stageApi,
      decision: {
        actions: [
          { action: "list-docs", args: { filter: "pdf" } },
          { action: "read-doc", args: { docId: "doc_1" } },
        ],
      },
      plannedIteration: 7,
    });

    expect(result).toEqual({ toolCalls: 2 });
    expect(hoisted.executeTool).toHaveBeenCalledTimes(2);
    expect(hoisted.maybePersistToolOutput).toHaveBeenCalledTimes(2);
    expect(hoisted.maybePersistToolOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        runStore: stageApi.runStore,
        runId: "test_run",
        toolName: "list-docs",
        iteration: 7,
      })
    );

    const content = agent.addMessage.mock.calls[0][0].content;
    expect(content).toContain("批量执行结果");
    expect(content).toContain("list-docs");
    expect(content).toContain("read-doc");
    expect(content).toContain("[LoopGuard]");
    expect(content).toContain("连续 3 次");
  });

  it("handles batch timeout and failures without throwing", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    vi.useFakeTimers();

    hoisted.executeTool.mockImplementation((toolName) => {
      if (toolName === "slow") return new Promise(() => {});
      return Promise.resolve({ success: false, error: "bad" });
    });

    const agent = makeAgent();
    const stageApi = makeStageApi({ toolTimeoutMs: 5 });

    const promise = executeDeepSearchDecision({
      agent,
      stageApi,
      decision: {
        actions: [
          { action: "slow", args: {} },
          { action: "fail", args: {} },
        ],
      },
      plannedIteration: 8,
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    vi.useRealTimers();

    expect(result).toEqual({ toolCalls: 2 });
    const content = agent.addMessage.mock.calls[0][0].content;
    expect(content).toContain("timed out");
    expect(content).toContain("bad");
    expect(hoisted.maybePersistToolOutput).not.toHaveBeenCalled();
  });

  it("falls back to inline output when persistence fails and stringifies large/circular results", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();

    const largeText = "A".repeat(12000);
    const deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i < 20; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }
    deep.self = deep;

    const toolResult = {
      success: true,
      content: largeText,
      nested: deep,
      bigint: BigInt("9007199254740991"),
    };

    hoisted.executeTool.mockResolvedValue(toolResult);
    hoisted.maybePersistToolOutput.mockRejectedValue(new Error("persist failed"));

    await executeDeepSearchDecision({
      agent,
      stageApi: makeStageApi(),
      decision: { action: "read-doc", args: { path: "big.txt" } },
      plannedIteration: 9,
    });

    const content = agent.addMessage.mock.calls[0][0].content;
    expect(content).toContain(largeText.slice(0, 50));
    expect(content).toContain("[Circular]");
    expect(content).toContain("9007199254740991");
    expect(hoisted.maybePersistToolOutput).toHaveBeenCalled();
  });

  it("saves checkpoint with side effects cursor", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const checkpoint = { save: vi.fn() };
    const agent = makeAgent({ checkpoint });
    const stageApi = makeStageApi({
      sideEffects: { getCursor: vi.fn(() => "cursor_abc") },
    });

    await executeDeepSearchDecision({
      agent,
      stageApi,
      decision: { action: "list-docs", args: {} },
      plannedIteration: 10,
    });

    expect(checkpoint.save).toHaveBeenCalledWith(agent.state, {
      iteration: 10,
      metadata: { sideEffectsCursor: "cursor_abc" },
    });
  });

  it("warns when getSideEffectsCursor throws", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent({ checkpoint: { save: vi.fn() } });
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
      decision: { action: "list-docs", args: {} },
      plannedIteration: 11,
    });

    expect(agent._logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("getSideEffectsCursor failed")
    );
  });

  it("handles watchdog handoff and backtrack", async () => {
    hoisted.executeTool.mockResolvedValue({
      mode: "handoff",
      handoff: { reason: "stuck", hint: "try another plan" },
    });
    const { executeDeepSearchDecision } = await loadModule();
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
      plannedIteration: 12,
    });

    expect(result).toEqual({ toolCalls: 1, backtracked: true });
    expect(agent.backtrackManager.backtrack).toHaveBeenCalled();
    expect(agent.state).toBe(newState);
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("已回溯") })
    );
    expect(hoisted.maybePersistToolOutput).not.toHaveBeenCalled();
  });

  it("supports simultaneous calls without shared-state leakage", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();
    const stageApi = makeStageApi();

    hoisted.executeTool.mockImplementation(async (toolName) => ({
      success: true,
      tool: toolName,
    }));

    const [res1, res2] = await Promise.all([
      executeDeepSearchDecision({
        agent,
        stageApi,
        decision: { action: "tool-a", args: { id: 1 } },
        plannedIteration: 13,
      }),
      executeDeepSearchDecision({
        agent,
        stageApi,
        decision: { action: "tool-b", args: { id: 2 } },
        plannedIteration: 13,
      }),
    ]);

    expect(res1).toEqual({ toolCalls: 1 });
    expect(res2).toEqual({ toolCalls: 1 });
    expect(hoisted.executeTool).toHaveBeenCalledTimes(2);
    expect(hoisted.executeTool.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(["tool-a", "tool-b"])
    );
    expect(agent.addMessage).toHaveBeenCalledTimes(2);
  });

  it("supports rapid sequential calls", async () => {
    const { executeDeepSearchDecision } = await loadModule();
    const agent = makeAgent();
    const stageApi = makeStageApi();

    await executeDeepSearchDecision({
      agent,
      stageApi,
      decision: { action: "tool-1", args: { idx: 1 } },
      plannedIteration: 14,
    });
    await executeDeepSearchDecision({
      agent,
      stageApi,
      decision: { action: "tool-2", args: { idx: 2 } },
      plannedIteration: 15,
    });

    expect(hoisted.executeTool).toHaveBeenCalledTimes(2);
    expect(agent.addMessage).toHaveBeenCalledTimes(2);
  });
});
