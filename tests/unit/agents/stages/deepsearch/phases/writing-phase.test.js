import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => {
  const executeTool = vi.fn();
  const WritingPhaseHandler = vi.fn();
  WritingPhaseHandler.instances = [];
  WritingPhaseHandler.defaultImplementation = (options) => {
    const instance = {
      options,
      shouldEnter: vi.fn(),
      run: vi.fn(),
    };
    WritingPhaseHandler.instances.push(instance);
    return instance;
  };
  WritingPhaseHandler.mockImplementation(function (options) {
    return WritingPhaseHandler.defaultImplementation(options);
  });
  return { executeTool, WritingPhaseHandler };
});

vi.mock("../../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  executeTool: hoisted.executeTool,
}));

vi.mock(
  "../../../../../../js/agents/stages/deepsearch/internal/writing-phase-handler.js",
  () => ({
    WritingPhaseHandler: hoisted.WritingPhaseHandler,
  })
);

const loadModule = async () =>
  await import(
    "../../../../../../js/agents/stages/deepsearch/phases/writing-phase.js"
  );

const makeAgent = (overrides = {}) => ({
  state: { L0: { sources: [] }, L1: { report: {} } },
  mode: "quick",
  globalConfig: {},
  maxIterations: 10,
  maxToolCalls: 10,
  writeIterations: 2,
  sourceManager: { syncSources: vi.fn() },
  _logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  _emit: vi.fn(),
  _parseDecision: vi.fn(),
  sharedContext: {},
  addMessage: vi.fn(),
  messages: [],
  flushCompression: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  hoisted.WritingPhaseHandler.instances = [];
  hoisted.WritingPhaseHandler.mockImplementation(function (options) {
    return hoisted.WritingPhaseHandler.defaultImplementation(options);
  });
  hoisted.executeTool.mockResolvedValue({ ok: true });
});

describe("ensureReportOnComplete", () => {
  it.each([
    ["empty object", {}],
    ["empty array", []],
    ["whitespace string", "   "],
    ["negative number", -1],
    ["max safe integer", Number.MAX_SAFE_INTEGER],
  ])("skips write-report when report is %s", async (_label, reportValue) => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { state: { L1: { report: reportValue } }, _emit: vi.fn() };

    await ensureReportOnComplete({ agent, stageApi: {} });

    expect(hoisted.executeTool).not.toHaveBeenCalled();
  });

  it.each([
    ["null state", { state: null }],
    ["undefined state", { state: undefined }],
    ["missing report", { state: { L1: {} } }],
    ["empty string report", { state: { L1: { report: "" } } }],
    ["zero report", { state: { L1: { report: 0 } } }],
  ])("writes report when %s", async (_label, agentOverrides) => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { _emit: vi.fn(), ...agentOverrides };

    await ensureReportOnComplete({ agent, stageApi: {} });

    expect(hoisted.executeTool).toHaveBeenCalledTimes(1);
  });

  it("passes state, stageApi, and emit wrapper to executeTool", async () => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { state: { L1: { report: "" } }, _emit: vi.fn() };
    const stageApi = { id: "stage" };

    await ensureReportOnComplete({ agent, stageApi });

    const [name, args, ctx] = hoisted.executeTool.mock.calls[0];
    expect(name).toBe("write-report");
    expect(args).toEqual({ action: "full" });
    expect(ctx.state).toBe(agent.state);
    expect(ctx.stageApi).toBe(stageApi);
    expect(typeof ctx.emit).toBe("function");
    ctx.emit("event", { ok: true });
    expect(agent._emit).toHaveBeenCalledWith("event", { ok: true });
  });

  it("allows emit wrapper to be called when _emit is missing", async () => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { state: { L1: { report: "" } } };

    await ensureReportOnComplete({ agent, stageApi: null });

    const ctx = hoisted.executeTool.mock.calls[0][2];
    expect(() => ctx.emit("event", { ok: true })).not.toThrow();
  });

  it("propagates executeTool errors", async () => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { state: { L1: { report: "" } }, _emit: vi.fn() };
    const error = new Error("tool failure");
    hoisted.executeTool.mockRejectedValueOnce(error);

    await expect(
      ensureReportOnComplete({ agent, stageApi: {} })
    ).rejects.toThrow("tool failure");
  });

  it("handles concurrent calls when report is missing", async () => {
    const { ensureReportOnComplete } = await loadModule();
    const agent = { state: { L1: {} }, _emit: vi.fn() };

    await Promise.all([
      ensureReportOnComplete({ agent, stageApi: {} }),
      ensureReportOnComplete({ agent, stageApi: {} }),
    ]);

    expect(hoisted.executeTool).toHaveBeenCalledTimes(2);
  });
});

describe("runWritingPhaseIfNeeded", () => {
  it("skips run when shouldEnter is false and forwards boundary values", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    const handler = {
      options: null,
      shouldEnter: vi.fn(() => false),
      run: vi.fn(),
    };
    hoisted.WritingPhaseHandler.mockImplementationOnce(function (options) {
      handler.options = options;
      hoisted.WritingPhaseHandler.instances.push(handler);
      return handler;
    });

    const agent = makeAgent({
      state: {},
      mode: " ",
      globalConfig: {},
      maxIterations: Number.MAX_SAFE_INTEGER,
      maxToolCalls: -1,
      writeIterations: 0,
      messages: [],
    });

    await runWritingPhaseIfNeeded({
      agent,
      stageApi: {},
      callModel: vi.fn(),
      iteration: "0",
      toolCallCount: 0,
      signal: undefined,
    });

    expect(handler.shouldEnter).toHaveBeenCalledWith({
      state: agent.state,
      mode: agent.mode,
      globalConfig: agent.globalConfig,
      iteration: "0",
      maxIterations: agent.maxIterations,
      toolCallCount: 0,
      maxToolCalls: agent.maxToolCalls,
    });
    expect(handler.run).not.toHaveBeenCalled();
    expect(handler.options.maxIterations).toBe(5);
    expect(handler.options.maxParseFailures).toBe(3);
    handler.options.parseDecision("decision");
    expect(agent._parseDecision).toHaveBeenCalledWith("decision");
    handler.options.emit("event", { ok: true });
    expect(agent._emit).toHaveBeenCalledWith("event", { ok: true });
  });

  it("runs writing phase and forwards run parameters", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    const handler = {
      options: null,
      shouldEnter: vi.fn(() => true),
      run: vi.fn(async () => ({ ok: true })),
    };
    hoisted.WritingPhaseHandler.mockImplementationOnce(function (options) {
      handler.options = options;
      hoisted.WritingPhaseHandler.instances.push(handler);
      return handler;
    });

    const longString = "a".repeat(50000);
    const agent = makeAgent({
      sharedContext: { note: longString },
      messages: {},
    });
    const stageApi = [];
    const callModel = vi.fn();
    const signal = new AbortController().signal;

    await runWritingPhaseIfNeeded({
      agent,
      stageApi,
      callModel,
      iteration: 1,
      toolCallCount: 2,
      signal,
    });

    expect(handler.run).toHaveBeenCalledTimes(1);
    const runArgs = handler.run.mock.calls[0][0];
    expect(runArgs.state).toBe(agent.state);
    expect(runArgs.stageApi).toBe(stageApi);
    expect(runArgs.sharedContext).toBe(agent.sharedContext);
    expect(runArgs.callModel).toBe(callModel);
    expect(runArgs.signal).toBe(signal);
    runArgs.addMessage({ role: "user", content: "ping" });
    expect(agent.addMessage).toHaveBeenCalledWith({ role: "user", content: "ping" });
    expect(runArgs.messages()).toBe(agent.messages);
    runArgs.flushMessages();
    expect(agent.flushCompression).toHaveBeenCalled();
  });

  it("syncs sources before executing tools", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    const handler = {
      options: null,
      shouldEnter: vi.fn(() => true),
      run: vi.fn(async (params) => {
        await handler.options.executeTool(
          "collect",
          { payload: "ok" },
          { state: params.state, emit: handler.options.emit, stageApi: params.stageApi }
        );
      }),
    };
    hoisted.WritingPhaseHandler.mockImplementationOnce(function (options) {
      handler.options = options;
      hoisted.WritingPhaseHandler.instances.push(handler);
      return handler;
    });

    const deepSources = [
      {
        id: "root",
        content: "x".repeat(100000),
        meta: {
          children: [
            { id: "child", meta: { children: [{ id: "leaf", meta: { depth: 3 } }] } },
          ],
        },
      },
    ];
    const agent = makeAgent({
      state: { L0: { sources: deepSources }, L1: { report: {} } },
    });
    const stageApi = { id: "stage" };

    await runWritingPhaseIfNeeded({
      agent,
      stageApi,
      callModel: vi.fn(),
      iteration: 2,
      toolCallCount: 2,
      signal: undefined,
    });

    expect(agent.sourceManager.syncSources).toHaveBeenCalledWith(deepSources);
    expect(hoisted.executeTool).toHaveBeenCalledWith(
      "collect",
      { payload: "ok" },
      expect.objectContaining({
        state: agent.state,
        stageApi,
        sourceManager: agent.sourceManager,
      })
    );
    const syncOrder = agent.sourceManager.syncSources.mock.invocationCallOrder[0];
    const execOrder = hoisted.executeTool.mock.invocationCallOrder[0];
    expect(syncOrder).toBeLessThan(execOrder);
  });

  it("propagates shouldEnter errors", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    const error = new Error("shouldEnter failed");
    hoisted.WritingPhaseHandler.mockImplementationOnce(function (options) {
      const instance = {
        options,
        shouldEnter: vi.fn(() => {
          throw error;
        }),
        run: vi.fn(),
      };
      hoisted.WritingPhaseHandler.instances.push(instance);
      return instance;
    });

    await expect(
      runWritingPhaseIfNeeded({
        agent: makeAgent(),
        stageApi: {},
        callModel: vi.fn(),
        iteration: 1,
        toolCallCount: 1,
        signal: undefined,
      })
    ).rejects.toThrow("shouldEnter failed");
  });

  it("propagates run errors", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    const error = new Error("run failed");
    hoisted.WritingPhaseHandler.mockImplementationOnce(function (options) {
      const instance = {
        options,
        shouldEnter: vi.fn(() => true),
        run: vi.fn(async () => {
          throw error;
        }),
      };
      hoisted.WritingPhaseHandler.instances.push(instance);
      return instance;
    });

    await expect(
      runWritingPhaseIfNeeded({
        agent: makeAgent(),
        stageApi: {},
        callModel: vi.fn(),
        iteration: 1,
        toolCallCount: 1,
        signal: undefined,
      })
    ).rejects.toThrow("run failed");
  });

  it("handles rapid consecutive calls with separate handler instances", async () => {
    const { runWritingPhaseIfNeeded } = await loadModule();
    hoisted.WritingPhaseHandler.mockImplementation(function (options) {
      const instance = {
        options,
        shouldEnter: vi.fn(() => true),
        run: vi.fn(async () => ({ ok: true })),
      };
      hoisted.WritingPhaseHandler.instances.push(instance);
      return instance;
    });

    const agent = makeAgent();

    await runWritingPhaseIfNeeded({
      agent,
      stageApi: {},
      callModel: vi.fn(),
      iteration: 1,
      toolCallCount: 1,
      signal: undefined,
    });
    await runWritingPhaseIfNeeded({
      agent,
      stageApi: {},
      callModel: vi.fn(),
      iteration: 2,
      toolCallCount: 2,
      signal: undefined,
    });

    expect(hoisted.WritingPhaseHandler).toHaveBeenCalledTimes(2);
    expect(hoisted.WritingPhaseHandler.instances).toHaveLength(2);
    expect(hoisted.WritingPhaseHandler.instances[0].run).toHaveBeenCalledTimes(1);
    expect(hoisted.WritingPhaseHandler.instances[1].run).toHaveBeenCalledTimes(1);
  });
});
