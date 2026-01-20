import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const lifecycleEmitter = {
    started: vi.fn(),
    completed: vi.fn(),
    failed: vi.fn(),
    statusChanged: vi.fn(),
    phaseTransition: vi.fn(),
  };

  let convergenceSuggestion = { action: "continue", reason: "default" };

  class MockModelResponseHandler {
    constructor({ maxRetries, parseDecision, emit } = {}) {
      this.retryCount = 0;
      this.maxRetries = maxRetries ?? 0;
      this.parseDecision = typeof parseDecision === "function" ? parseDecision : null;
      this.emit = typeof emit === "function" ? emit : null;
    }
  }

  class MockConvergenceDetector {
    constructor() {
      this._samples = [];
    }
    addSample(sample) {
      this._samples.push(sample);
      return { metrics: { entropy: 0.1, similarity: 0.99 } };
    }
    getSuggestion() {
      return convergenceSuggestion;
    }
  }

  class MockBehaviorFingerprint {
    constructor(config = {}) {
      this._calls = 0;
      this._loopThreshold = typeof config.loopThreshold === "number" ? config.loopThreshold : 2;
    }
    recordAction() {
      this._calls += 1;
      if (this._calls >= this._loopThreshold) {
        return { loopDetected: true, loopInfo: { totalLoopsDetected: this._calls } };
      }
      return { loopDetected: false };
    }
    getSuggestion() {
      return { action: "change", message: "try a different tool" };
    }
  }

  const makeCapabilities = () => ({
    SkillsManager: null,
    BudgetManager: class BudgetManager {
      constructor(state) {
        this.state = state;
      }
      isExhausted() {
        return false;
      }
    },
    CheckpointManager: class CheckpointManager {
      constructor(opts) {
        this.opts = opts;
        this.opts?.emit?.("checkpoint.init", { ok: true });
      }
    },
    SharedContext: class SharedContext {
      constructor() {
        this.search = vi.fn(() => []);
      }
    },
    BacktrackManager: class BacktrackManager {
      constructor(opts) {
        this.opts = opts;
        this.opts?.emit?.("backtrack.init", { ok: true });
      }
    },
    DiscoveryManager: class DiscoveryManager {
      constructor(opts) {
        this.opts = opts;
      }
    },
    MemoryStore: class MemoryStore {
      constructor(opts) {
        this.opts = opts;
        this.bind = vi.fn();
      }
    },
    UnifiedAgentContext: class UnifiedAgentContext {
      constructor({ runId, eventBus }) {
        this.runId = runId;
        this.eventBus = eventBus;
        this.todos = [];
        this.claims = [];
        this.report = null;
        this.iteration = 0;
      }
      bind() {}
      getContextStatus() {
        return {
          runId: this.runId,
          iteration: this.iteration,
          todoCount: this.todos.length,
          claimCount: this.claims.length,
        };
      }
    },
  });

  return {
    logger,
    lifecycleEmitter,
    createLogger: vi.fn((opts) => {
      try {
        opts?.getContext?.();
      } catch {
        // ignore
      }
      return logger;
    }),
    createLifecycleEmitter: vi.fn(() => lifecycleEmitter),
    robustParseJson: vi.fn(),
    classifyDeepSearchError: vi.fn(),
    getModelCaller: vi.fn(),
    loadDeepSearchCapabilities: vi.fn(),
    addInitialDeepSearchMessages: vi.fn(async ({ agent }) => {
      agent.addMessage({ role: "system", content: "boot" });
    }),
    getGapConvergencePolicy: vi.fn(() => ({ maxFindingGaps: 50, gapOnlyStreakLimit: 2, noProgressStreakLimit: 3 })),
    createIterationConvergenceTracker: vi.fn(() => ({
      convergence: {
        lastClaimCount: 0,
        lastGapFindingCount: 0,
        lastOpenTodoCount: 0,
        lastCompletedTodoCount: 0,
        gapOnlyStreak: 0,
        noProgressStreak: 0,
      },
      initBaselines: vi.fn(),
      emitIterationCompleted: vi.fn(),
    })),
    runPlanningPhaseIteration: vi.fn(),
    executeDeepSearchDecision: vi.fn(),
    runWritingPhaseIfNeeded: vi.fn(),
    ensureReportOnComplete: vi.fn(),
    makeCapabilities,
    setConvergenceSuggestion: (next) => {
      convergenceSuggestion = next;
    },
    MockModelResponseHandler,
    MockConvergenceDetector,
    MockBehaviorFingerprint,
  };
});

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: hoisted.createLogger,
    robustParseJson: hoisted.robustParseJson,
    classifyDeepSearchError: hoisted.classifyDeepSearchError,
  };
});

vi.mock("../../../../../js/agents/runtime/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/runtime/index.js");
  return {
    ...actual,
    createLifecycleEmitter: hoisted.createLifecycleEmitter,
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: hoisted.getModelCaller,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/internal/model-response-handler.js", () => ({
  ModelResponseHandler: hoisted.MockModelResponseHandler,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/capabilities-loader.js", () => ({
  loadDeepSearchCapabilities: hoisted.loadDeepSearchCapabilities,
}));

vi.mock("../../../../../js/agents/plugins/analysis/index.js", () => ({
  ConvergenceDetector: hoisted.MockConvergenceDetector,
  BehaviorFingerprint: hoisted.MockBehaviorFingerprint,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/phases/planning-phase.js", () => ({
  addInitialDeepSearchMessages: hoisted.addInitialDeepSearchMessages,
  createIterationConvergenceTracker: hoisted.createIterationConvergenceTracker,
  getGapConvergencePolicy: hoisted.getGapConvergencePolicy,
  runPlanningPhaseIteration: hoisted.runPlanningPhaseIteration,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/phases/execution-phase.js", () => ({
  executeDeepSearchDecision: hoisted.executeDeepSearchDecision,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/phases/writing-phase.js", () => ({
  runWritingPhaseIfNeeded: hoisted.runWritingPhaseIfNeeded,
  ensureReportOnComplete: hoisted.ensureReportOnComplete,
}));

function makeTraceContext() {
  const span = {
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
  };
  return {
    withSpan: vi.fn(async (_name, fn) => await fn(span)),
    startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setAttributes: vi.fn() })),
    endSpan: vi.fn(),
  };
}

function makeStageApi(overrides = {}) {
  const eventBus = {
    emit: vi.fn(),
    _backpressure: { enabled: false },
    enableBackpressure: vi.fn(function enableBackpressure(opts) {
      this._backpressure = { enabled: true, opts };
    }),
  };
  return {
    emit: vi.fn(),
    eventBus,
    traceContext: makeTraceContext(),
    errorBoundary: {
      wrap: vi.fn(async (fn, _opts) => await fn()),
    },
    archive: {},
    sideEffects: {},
    ...overrides,
  };
}

let sharedActual;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  sharedActual = sharedActual || (await vi.importActual("../../../../../js/agents/shared/index.js"));

  hoisted.loadDeepSearchCapabilities.mockImplementation(async () => hoisted.makeCapabilities());
  hoisted.getModelCaller.mockReturnValue(async () => ({
    content: '{"action":"noop"}',
    usage: { input: 1, output: 1, total: 2 },
  }));
  hoisted.robustParseJson.mockImplementation(sharedActual.robustParseJson);
  hoisted.classifyDeepSearchError.mockImplementation((err) => ({
    message: err instanceof Error ? err.message : String(err),
    recoverable: true,
    category: "system",
  }));
  hoisted.runPlanningPhaseIteration.mockResolvedValue({ status: "stop" });
  hoisted.executeDeepSearchDecision.mockResolvedValue({ toolCalls: 0 });
  hoisted.runWritingPhaseIfNeeded.mockResolvedValue({ ok: true });
  hoisted.ensureReportOnComplete.mockImplementation(async ({ agent }) => {
    if (!agent.state.L1) agent.state.L1 = {};
    agent.state.L1.report = { markdown: "# Completed" };
  });
  hoisted.setConvergenceSuggestion({ action: "continue", reason: "default" });
});

describe("AgentStatus", () => {
  it("exposes stable statuses", async () => {
    const { AgentStatus } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    expect(Object.isFrozen(AgentStatus)).toBe(true);
    expect(AgentStatus).toEqual({
      IDLE: "idle",
      RUNNING: "running",
      COMPLETED: "completed",
      FAILED: "failed",
    });
  });
});

describe("AnalysisMode", () => {
  it("exposes stable modes", async () => {
    const { AnalysisMode } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    expect(Object.isFrozen(AnalysisMode)).toBe(true);
    expect(AnalysisMode).toEqual({
      QUICK: "quick",
      WIDER: "wider",
      DEEPER: "deeper",
    });
  });
});

describe("DeepSearchAgentLoop", () => {
  it("constructor respects mode defaults and boundary maxIterations values", async () => {
    const { DeepSearchAgentLoop, AnalysisMode } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const { getModeConfig } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-helpers.js");

    const quickDefaults = getModeConfig(AnalysisMode.QUICK, null);
    const widerDefaults = getModeConfig("   ", null);

    const agentZero = new DeepSearchAgentLoop({ mode: AnalysisMode.QUICK, maxIterations: 0 });
    expect(agentZero.maxIterations).toBe(quickDefaults.maxIterations);

    const agentNegative = new DeepSearchAgentLoop({ maxIterations: -1 });
    expect(agentNegative.maxIterations).toBe(-1);

    const agentHuge = new DeepSearchAgentLoop({ maxIterations: Number.MAX_SAFE_INTEGER });
    expect(agentHuge.maxIterations).toBe(Number.MAX_SAFE_INTEGER);

    const agentWhitespace = new DeepSearchAgentLoop({ mode: "   " });
    expect(agentWhitespace.mode).toBe("   ");
    expect(agentWhitespace.maxIterations).toBe(widerDefaults.maxIterations);
  });

  it("_ensureState handles null/undefined/empty inputs", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const agent = new DeepSearchAgentLoop();
    const state = new DeepSearchState({ runId: "run_state" });

    expect(agent._ensureState(state)).toBe(state);
    expect(agent._ensureState({ state })).toBe(state);
    expect(agent._ensureState({ state: {} })).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState({})).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState([])).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState(null)).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState(undefined)).toBeInstanceOf(DeepSearchState);
  });

  it("_parseDecision handles arrays, object-as-array, empty input, long strings, and errors", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop();

    expect(agent._parseDecision('{"thought":"t","actions":[{"action":"a","args":{"x":1}}]}')).toEqual({
      thought: "t",
      actions: [{ action: "a", args: { x: 1 } }],
    });

    expect(agent._parseDecision('{"thought":"t","actions":{}}')).toEqual({
      thought: "t",
      action: "complete",
      args: {},
    });

    expect(agent._parseDecision("")).toBeNull();
    expect(agent._parseDecision("   ")).toBeNull();
    expect(agent._parseDecision("not json")).toBeNull();

    const longThought = "a".repeat(5000);
    const longParsed = agent._parseDecision(JSON.stringify({ thought: longThought, action: "complete", args: {} }));
    expect(longParsed.thought.length).toBe(longThought.length);

    hoisted.robustParseJson.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(agent._parseDecision('{"action":"complete"}')).toBeNull();
  });

  it("_recordToolCall ignores null/undefined/empty/whitespace names and ignore list", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop({
      toolCallGuard: { enabled: true, ignoreTools: ["skip"] },
      behaviorFingerprint: false,
    });

    expect(agent._recordToolCall(null, {})).toBeNull();
    expect(agent._recordToolCall(undefined, {})).toBeNull();
    expect(agent._recordToolCall("", {})).toBeNull();
    expect(agent._recordToolCall("   ", {})).toBeNull();
    expect(agent._recordToolCall("skip", {})).toBeNull();
  });

  it("_recordToolCall parses string numeric guard config and tracks rapid consecutive calls", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop({
      toolCallGuard: { enabled: true, warnAt: "2", maxConsecutive: "3", maxSignatureChars: "16" },
      behaviorFingerprint: false,
    });

    const first = agent._recordToolCall("tool-a", { a: 1 });
    const second = agent._recordToolCall("tool-a", { a: 1 });
    const third = agent._recordToolCall("tool-a", { a: 1 });

    expect(first.consecutive).toBe(1);
    expect(first.shouldWarn).toBe(false);
    expect(second.consecutive).toBe(2);
    expect(second.shouldWarn).toBe(true);
    expect(third.consecutive).toBe(3);
    expect(third.shouldStop).toBe(true);
  });

  it("_recordToolCall returns behavior warnings when guard is disabled", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop({
      toolCallGuard: { enabled: false },
      behaviorFingerprint: { enabled: true, loopThreshold: 2 },
    });

    expect(agent._recordToolCall("tool-b", {})).toBeNull();
    const second = agent._recordToolCall("tool-b", {});
    expect(second.shouldWarn).toBe(true);
    expect(second.shouldStop).toBe(false);
    expect(second.signature).toBeNull();
    expect(second.behavior?.loopDetected).toBe(true);
  });

  it("_recordToolCall handles large payloads, deep nesting, and array args", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop({
      toolCallGuard: { enabled: true, maxSignatureChars: 40, warnAt: 2, maxConsecutive: 4 },
      behaviorFingerprint: false,
    });

    const hugeText = "x".repeat(200000);
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 40; i++) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const record = agent._recordToolCall("read-file", { content: hugeText, nested: deep });
    expect(record).not.toBeNull();
    expect(record.signature).toContain("...");
    expect(record.signature.length).toBeLessThanOrEqual("read-file|".length + 43);

    const arrayRecord = agent._recordToolCall("list-items", []);
    expect(arrayRecord).not.toBeNull();
    expect(arrayRecord.signature).toContain("[]");
  });

  it("_emit prefixes event names and falls back to eventBus", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop();
    agent.emit = vi.fn();
    agent.eventBus = { emit: vi.fn() };

    agent._emit("foo", { ok: true }, { status: "started" });
    expect(agent.emit).toHaveBeenCalledWith("deepsearch.foo", expect.objectContaining({ status: "started" }));

    agent.emit = null;
    agent._emit("deepsearch.bar", { ok: true });
    expect(agent.eventBus.emit).toHaveBeenCalledWith("deepsearch.bar", expect.any(Object));
  });

  it("_markFailed emits once and updates status", async () => {
    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const { DeepSearchEvents } = await import("../../../../../js/agents/runtime/index.js");

    const agent = new DeepSearchAgentLoop();
    agent.state = { runId: "run_fail" };
    agent.status = AgentStatus.RUNNING;

    const emitSpy = vi.spyOn(agent, "_emit");
    const error = new Error("boom");
    const classification = {
      message: "boom",
      recoverable: true,
      category: "system",
      statusCode: 400,
      code: "E_TEST",
    };

    agent._markFailed(error, classification);

    expect(emitSpy).toHaveBeenCalledWith(DeepSearchEvents.AGENT_ERROR, expect.objectContaining({
      error: "boom",
      recoverable: true,
      category: "system",
      statusCode: 400,
      code: "E_TEST",
    }));
    expect(hoisted.lifecycleEmitter.failed).toHaveBeenCalledTimes(1);
    expect(hoisted.lifecycleEmitter.statusChanged).toHaveBeenCalledWith(AgentStatus.RUNNING, AgentStatus.FAILED, "run_fail");
    expect(agent.status).toBe(AgentStatus.FAILED);

    agent._markFailed(error, classification);
    expect(hoisted.lifecycleEmitter.failed).toHaveBeenCalledTimes(1);
    expect(hoisted.lifecycleEmitter.statusChanged).toHaveBeenCalledTimes(1);
  });

  it("_buildOutput prefers context values", async () => {
    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );

    const agent = new DeepSearchAgentLoop();
    agent.status = AgentStatus.COMPLETED;
    agent.state = { runId: "run_state", todos: ["s"], L1: { report: { markdown: "state" }, claims: ["c1"] } };
    agent.context = { runId: "run_ctx", report: { markdown: "ctx" }, todos: ["t1"], claims: ["cc"] };

    expect(agent._buildOutput()).toEqual({
      runId: "run_ctx",
      status: AgentStatus.COMPLETED,
      report: { markdown: "ctx" },
      todos: ["t1"],
      claims: ["cc"],
    });
  });

  it("getAgentContextStatus falls back to state counts", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");

    const agent = new DeepSearchAgentLoop();
    agent.state = { runId: "run_status", iteration: 2, todos: [1, 2], L1: { claims: ["c"] } };

    expect(agent.getAgentContextStatus()).toEqual({
      runId: "run_status",
      iteration: 2,
      todoCount: 2,
      claimCount: 1,
    });

    agent.context = { getContextStatus: vi.fn(() => ({ runId: "ctx", iteration: 9 })) };
    expect(agent.getAgentContextStatus()).toEqual({ runId: "ctx", iteration: 9 });
  });

  it("run completes on complete decision and runs writing", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({
      runId: "run_complete",
      L1: { report: { markdown: "abc" }, gaps: [] },
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async ({ callModel, responseHandler }) => {
      responseHandler?.emit?.("deepsearch.test.emit", { ok: true });
      responseHandler?.parseDecision?.('{"thought":"t","action":"complete"}');
      await callModel([{ role: "user", content: "ping" }], { model: "mock" });
      return { status: "success", decision: { action: "complete" } };
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 2 });

    const out = await agent.run(state, stageApi);

    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(out.runId).toBe("run_complete");
    expect(hoisted.addInitialDeepSearchMessages).toHaveBeenCalledTimes(1);
    expect(hoisted.ensureReportOnComplete).toHaveBeenCalledTimes(1);
    expect(hoisted.runWritingPhaseIfNeeded).toHaveBeenCalledTimes(1);
    expect(stageApi.eventBus.enableBackpressure).toHaveBeenCalledTimes(1);
  });

  it("run skips planning when maxToolCalls is 0", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({ runId: "run_tool_limit", L1: { report: { markdown: "abc" }, gaps: [] } });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({
      mode: "quick",
      config: { agent: { quick: { maxToolCalls: 0 } } },
    });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.runPlanningPhaseIteration).not.toHaveBeenCalled();
    expect(hoisted.runWritingPhaseIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("run handles negative maxIterations without entering the loop", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({ runId: "run_negative", L1: { report: { markdown: "abc" }, gaps: [] } });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: -1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.runPlanningPhaseIteration).not.toHaveBeenCalled();
    expect(hoisted.runWritingPhaseIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("run marks FAILED and rethrows on non-recoverable errors", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({ runId: "run_fatal", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.classifyDeepSearchError.mockReturnValueOnce({
      message: "fatal",
      recoverable: false,
      category: "auth",
      statusCode: 401,
      code: "E_AUTH",
    });
    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => {
      throw new Error("fatal");
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    await expect(agent.run(state, stageApi)).rejects.toThrow("fatal");
    expect(agent.status).toBe(AgentStatus.FAILED);
    expect(hoisted.lifecycleEmitter.failed).toHaveBeenCalledTimes(1);
  });

  it("run fails when model caller is unavailable", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({ runId: "run_no_model", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.getModelCaller.mockReturnValueOnce(null);

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    await expect(agent.run(state, stageApi)).rejects.toThrow(/No model available/);
    expect(agent.status).toBe(AgentStatus.FAILED);
  });

  it("run counts recoverable system errors and advances iteration when threshold is reached", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({
      runId: "run_sys_retry",
      userConfig: { budget: { maxSystemRetriesPerIteration: 1 } },
      L1: { report: { markdown: "abc" }, gaps: [] },
    });

    hoisted.loadDeepSearchCapabilities.mockResolvedValueOnce({
      ...hoisted.makeCapabilities(),
      UnifiedAgentContext: null,
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => {
      throw new Error("transient");
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(state.iteration).toBe(1);
  });

  it("run supports concurrent calls on separate instances", async () => {
    const stageApiA = makeStageApi();
    const stageApiB = makeStageApi();
    const { DeepSearchState } = await import("../../../../../js/agents/stages/deepsearch/state.js");

    const stateA = new DeepSearchState({ runId: "run_a", L1: { report: { markdown: "a" }, gaps: [] } });
    const stateB = new DeepSearchState({ runId: "run_b", L1: { report: { markdown: "b" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration.mockResolvedValue({ status: "stop" });

    const { DeepSearchAgentLoop, AgentStatus } = await import(
      "../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js"
    );
    const agentA = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });
    const agentB = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const [outA, outB] = await Promise.all([agentA.run(stateA, stageApiA), agentB.run(stateB, stageApiB)]);

    expect(outA.status).toBe(AgentStatus.COMPLETED);
    expect(outB.status).toBe(AgentStatus.COMPLETED);
    expect(outA.runId).toBe("run_a");
    expect(outB.runId).toBe("run_b");
  });
});
