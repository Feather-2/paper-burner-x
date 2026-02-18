import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/stages/deepsearch/subagents.js";

const mockState = vi.hoisted(() => ({
  registry: { register: vi.fn() },
  eventBusInstances: [],
  agentLoopInstances: [],
  enableBackpressureImpl: null,
}));

class MockEventBus {
  constructor() {
    this.enableBackpressure = vi.fn((...args) => {
      if (mockState.enableBackpressureImpl) {
        return mockState.enableBackpressureImpl(...args);
      }
    });
    mockState.eventBusInstances.push(this);
  }
}

class MockDeepSearchAgentLoop {
  constructor(options) {
    this.options = options;
    this.run = vi.fn();
    mockState.agentLoopInstances.push(this);
  }
}

vi.mock("../../../../../js/agents/sdk/SubagentRegistry.js", () => ({
  globalSubagentRegistry: mockState.registry,
}));

vi.mock("../../../../../js/agents/core/event-bus.js", () => ({
  EventBus: MockEventBus,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => ({
  DeepSearchAgentLoop: MockDeepSearchAgentLoop,
  default: MockDeepSearchAgentLoop,
}));

const loadModule = async () => {
  vi.resetModules();
  return import(MODULE_PATH);
};

const setupFactories = async () => {
  const { registerDeepSearchSubagents } = await loadModule();
  const registry = { register: vi.fn() };
  registerDeepSearchSubagents(registry);
  const getFactory = (type) =>
    registry.register.mock.calls.find((call) => call[0] === type)?.[1];
  return {
    registry,
    researcherFactory: getFactory("researcher"),
    analyzerFactory: getFactory("analyzer"),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockState.registry.register.mockReset();
  mockState.eventBusInstances.length = 0;
  mockState.agentLoopInstances.length = 0;
  mockState.enableBackpressureImpl = null;
});

describe("registerDeepSearchSubagents", () => {
  it("registers researcher and analyzer with provided registry", async () => {
    const { registerDeepSearchSubagents } = await loadModule();
    const registry = { register: vi.fn() };

    registerDeepSearchSubagents(registry);

    expect(registry.register).toHaveBeenCalledTimes(2);
    expect(registry.register).toHaveBeenNthCalledWith(
      1,
      "researcher",
      expect.any(Function),
      expect.stringContaining("10")
    );
    expect(registry.register).toHaveBeenNthCalledWith(
      2,
      "analyzer",
      expect.any(Function),
      expect.stringContaining("15")
    );
  });

  it("researcher factory merges stageApi, scopes sharedContext, and truncates summaries", async () => {
    const { researcherFactory } = await setupFactories();
    const sharedContext = {
      count: 0,
      increment() {
        this.count += 1;
        return this.count;
      },
      buildBlackboardPrompt: vi.fn((options) => options),
      getSignals: vi.fn(),
    };
    const deepNested = { level1: { level2: { level3: { value: "deep" } } } };
    const longPrompt = "P".repeat(2000);
    const hugeReport = "R".repeat(60000);
    const parentStageApi = {
      traceContext: { getTraceparent: vi.fn(() => "tp-123") },
      traceparent: "ignore",
      modelRouter: "parent",
      signal: "parent-sig",
    };

    const agent = await researcherFactory({
      prompt: longPrompt,
      taskId: "  task-1  ",
      inheritedContext: { sharedContext, L0: deepNested },
      parentStageApi,
    });

    const instance = mockState.agentLoopInstances[0];
    instance.run.mockResolvedValue({ report: hugeReport, findings: ["f1"] });

    const result = await agent.run(
      { L0: "input-l0" },
      { stageApi: { traceContext: { ignore: true }, modelRouter: "ctx" }, signal: "ctx-sig" }
    );

    expect(mockState.eventBusInstances).toHaveLength(1);
    expect(mockState.eventBusInstances[0].enableBackpressure).toHaveBeenCalledWith({
      deferNonCoalesced: false,
    });

    expect(instance.options.maxIterations).toBe(10);
    const proxyContext = instance.options.sharedContext;
    expect(proxyContext).not.toBe(sharedContext);

    proxyContext.buildBlackboardPrompt({ foo: "bar" });
    expect(sharedContext.buildBlackboardPrompt).toHaveBeenCalledWith({
      foo: "bar",
      targetTaskId: "task-1",
    });

    proxyContext.getSignals({ 0: "alpha", length: 1 });
    expect(sharedContext.getSignals.mock.calls[0][0]).toEqual({
      0: "alpha",
      length: 1,
      targetTaskId: "task-1",
    });

    proxyContext.getSignals("alpha");
    const stringFilter = sharedContext.getSignals.mock.calls[1][0];
    expect(typeof stringFilter).toBe("function");
    expect(stringFilter({ type: "alpha", payload: { targetTaskId: "task-1" } })).toBe(true);
    expect(stringFilter({ stage: "alpha", payload: {} })).toBe(true);
    expect(stringFilter({ type: "alpha", payload: { targetTaskId: "other" } })).toBe(false);
    expect(stringFilter({ type: "beta", stage: "beta", payload: {} })).toBe(false);

    const customFilter = vi.fn((signal) => signal.type === "beta");
    proxyContext.getSignals(customFilter);
    const combinedFilter = sharedContext.getSignals.mock.calls[2][0];
    expect(combinedFilter({ type: "beta", payload: { targetTaskId: "task-1" } })).toBe(true);
    expect(combinedFilter({ type: "beta", payload: { targetTaskId: "other" } })).toBe(false);
    expect(combinedFilter({ type: "alpha", payload: { targetTaskId: "task-1" } })).toBe(false);
    expect(customFilter).toHaveBeenCalled();

    proxyContext.getSignals([]);
    expect(sharedContext.getSignals.mock.calls[3][0]).toEqual({ targetTaskId: "task-1" });

    expect(proxyContext.increment()).toBe(1);
    expect(sharedContext.count).toBe(1);

    expect(instance.run).toHaveBeenCalledTimes(1);
    const [runInput, runCtx] = instance.run.mock.calls[0];
    expect(runInput.taskGoal).toBe(longPrompt);
    expect(runInput.L0).toBe(deepNested);
    expect(runInput.userConfig).toEqual({ maxIterations: 10 });
    expect(runCtx.stageApi.modelRouter).toBe("ctx");
    expect(runCtx.stageApi.modelTier).toBe("fast");
    expect(runCtx.stageApi.signal).toBe("ctx-sig");
    expect(runCtx.stageApi.eventBus).toBe(mockState.eventBusInstances[0]);
    expect(runCtx.stageApi.traceparent).toBe("tp-123");
    expect("traceContext" in runCtx.stageApi).toBe(false);

    expect(result).toEqual({
      ok: true,
      summary: hugeReport.slice(0, 500),
      report: hugeReport,
      findings: ["f1"],
    });
  });

  it("analyzer factory uses input L0, handles traceparent errors, and falls back summary", async () => {
    const { analyzerFactory } = await setupFactories();
    const sharedContext = { buildBlackboardPrompt: vi.fn() };
    const parentStageApi = {
      traceContext: { getTraceparent: vi.fn(() => { throw new Error("boom"); }) },
      signal: "parent-sig",
    };

    const agent = await analyzerFactory({
      prompt: "Analyze",
      taskId: Number.MAX_SAFE_INTEGER,
      inheritedContext: { sharedContext },
      parentStageApi,
    });

    const instance = mockState.agentLoopInstances[0];
    instance.run.mockResolvedValue({ report: "", analysis: { conclusion: "done" } });

    const result = await agent.run(
      { L0: "0" },
      { stageApi: { traceContext: { ignore: true } } }
    );

    expect(instance.options.maxIterations).toBe(15);
    instance.options.sharedContext.buildBlackboardPrompt({ note: "x" });
    expect(sharedContext.buildBlackboardPrompt).toHaveBeenCalledWith({
      note: "x",
      targetTaskId: String(Number.MAX_SAFE_INTEGER),
    });

    const [runInput, runCtx] = instance.run.mock.calls[0];
    expect(runInput.L0).toBe("0");
    expect(runInput.userConfig).toEqual({ maxIterations: 15 });
    expect(runCtx.stageApi.modelTier).toBe("normal");
    expect(runCtx.stageApi.signal).toBe("parent-sig");
    expect(runCtx.stageApi.traceparent).toBeUndefined();
    expect("traceContext" in runCtx.stageApi).toBe(false);

    expect(result).toEqual({
      ok: true,
      summary: "Analysis completed",
      report: "",
      analysis: { conclusion: "done" },
    });
  });

  it("skips task scoping for empty taskIds and scopes for object/number cases", async () => {
    const { researcherFactory } = await setupFactories();
    const cases = [
      { taskId: null, expectProxy: false },
      { taskId: undefined, expectProxy: false },
      { taskId: "", expectProxy: false },
      { taskId: "   ", expectProxy: false },
      { taskId: [], expectProxy: false },
      { taskId: {}, expectProxy: true, expected: "[object Object]" },
      { taskId: -1, expectProxy: true, expected: "-1" },
      { taskId: 0, expectProxy: false },
      { taskId: "123", expectProxy: true, expected: "123" },
    ];

    for (const testCase of cases) {
      const sharedContext = { buildBlackboardPrompt: vi.fn() };
      await researcherFactory({
        prompt: "p",
        taskId: testCase.taskId,
        inheritedContext: { sharedContext },
      });

      const instance = mockState.agentLoopInstances.at(-1);
      if (testCase.expectProxy) {
        expect(instance.options.sharedContext).not.toBe(sharedContext);
        instance.options.sharedContext.buildBlackboardPrompt({ flag: true });
        expect(sharedContext.buildBlackboardPrompt).toHaveBeenCalledWith({
          flag: true,
          targetTaskId: testCase.expected,
        });
      } else {
        expect(instance.options.sharedContext).toBe(sharedContext);
      }
    }
  });

  it("creates independent agents across factory and concurrent run calls", async () => {
    const { researcherFactory } = await setupFactories();
    const sharedA = { marker: "A" };
    const sharedB = { marker: "B" };

    const agentA = await researcherFactory({
      prompt: "p1",
      taskId: 0,
      inheritedContext: { sharedContext: sharedA },
      parentStageApi: { traceparent: "  tp-a  " },
    });
    const agentB = await researcherFactory({
      prompt: "p2",
      taskId: -1,
      inheritedContext: { sharedContext: sharedB },
    });

    expect(mockState.agentLoopInstances).toHaveLength(2);
    const [first, second] = mockState.agentLoopInstances;
    const instanceA = first.options.sharedContext === sharedA ? first : second;
    const instanceB = instanceA === first ? second : first;
    expect(instanceA.options.sharedContext).toBe(sharedA);
    expect(instanceB.options.sharedContext).not.toBe(sharedA);

    instanceA.run
      .mockResolvedValueOnce({ report: "A1" })
      .mockResolvedValueOnce({ report: "A2" });
    instanceB.run.mockResolvedValue({ report: "B" });

    const [resultA1, resultB] = await Promise.all([
      agentA.run({ L0: [] }, { stageApi: {} }),
      agentB.run({ L0: { data: "x" } }, { stageApi: {} }),
    ]);
    const resultA2 = await agentA.run({ L0: [] }, { stageApi: {} });

    expect(instanceA.options.eventBus).not.toBe(instanceB.options.eventBus);
    expect(instanceA.run).toHaveBeenCalledTimes(2);
    expect(instanceB.run).toHaveBeenCalledTimes(1);

    const [inputA, ctxA] = instanceA.run.mock.calls[0];
    const [inputB, ctxB] = instanceB.run.mock.calls[0];
    expect(inputA.L0).toEqual([]);
    expect(inputB.L0).toEqual({ data: "x" });
    expect(ctxA.stageApi.eventBus).toBe(instanceA.options.eventBus);
    expect(ctxB.stageApi.eventBus).toBe(instanceB.options.eventBus);
    expect(ctxA.stageApi.traceparent).toBe("tp-a");

    expect(resultA1.summary).toBe("A1");
    expect(resultA2.summary).toBe("A2");
    expect(resultB.summary).toBe("B");
  });

  it("ignores backpressure errors and propagates run errors", async () => {
    const { researcherFactory } = await setupFactories();
    mockState.enableBackpressureImpl = () => {
      throw new Error("backpressure-failed");
    };

    const agent = await researcherFactory({
      prompt: "p",
      taskId: null,
      inheritedContext: {},
      parentStageApi: null,
    });

    const instance = mockState.agentLoopInstances[0];
    instance.run.mockRejectedValue(new Error("run-failed"));

    await expect(agent.run({ L0: {} }, { stageApi: null })).rejects.toThrow("run-failed");
    expect(mockState.eventBusInstances[0].enableBackpressure).toHaveBeenCalled();
    expect(instance.run.mock.calls[0][0].L0).toEqual({});
  });
});

describe("globalSubagentRegistry", () => {
  it("re-exports the global registry without implicit side effects", async () => {
    const mod = await loadModule();

    expect(mod.globalSubagentRegistry).toBe(mockState.registry);
    expect(mockState.registry.register).not.toHaveBeenCalled();
  });

  it("registerDeepSearchSubagents is idempotent by default and can force re-register", async () => {
    const mod = await loadModule();
    const registry = {
      register: vi.fn(),
      getFactory: vi.fn((type) => (type === "researcher" ? vi.fn() : null)),
    };

    const first = mod.registerDeepSearchSubagents(registry);
    expect(first).toEqual({
      registered: ["analyzer"],
      skipped: ["researcher"],
    });
    expect(registry.register).toHaveBeenCalledTimes(1);

    const second = mod.registerDeepSearchSubagents(registry, { force: true });
    expect(second).toEqual({
      registered: ["researcher", "analyzer"],
      skipped: [],
    });
    expect(registry.register).toHaveBeenCalledTimes(3);
  });
});
