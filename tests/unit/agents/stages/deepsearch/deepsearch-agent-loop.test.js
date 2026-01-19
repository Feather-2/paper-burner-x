import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      return { action: "continue", reason: "default" };
    }
  }

  class MockBehaviorFingerprint {
    constructor() {
      this._calls = 0;
    }
    recordAction() {
      this._calls += 1;
      if (this._calls >= 2) {
        return { loopDetected: true, loopInfo: { totalLoopsDetected: this._calls } };
      }
      return { loopDetected: false };
    }
    getSuggestion() {
      return { action: "change", message: "try a different tool" };
    }
  }

  return {
    logger,
    lifecycleEmitter,
    // Call getContext once (best-effort) so the closure passed from the agent-loop file is covered.
    createLogger: vi.fn((opts) => {
      try {
        opts?.getContext?.();
      } catch {
        // ignore
      }
      return logger;
    }),
    createLifecycleEmitter: vi.fn(() => lifecycleEmitter),
    loadDeepSearchCapabilities: vi.fn(async () => ({
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
          // Invoke injected callbacks to cover the closures defined in deepsearch-agent-loop.js.
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
        constructor({ runId }) {
          this.runId = runId;
          this.todos = [];
          this.claims = [];
          this.report = null;
          this.iteration = 0;
          this.bind = vi.fn();
        }
        getContextStatus() {
          return { runId: this.runId, iteration: this.iteration };
        }
      },
    })),
    getModelCaller: vi.fn(),
    classifyDeepSearchError: vi.fn(),
    addInitialDeepSearchMessages: vi.fn(async ({ agent }) => {
      agent.addMessage({ role: "system", content: "boot" });
    }),
    getGapConvergencePolicy: vi.fn(() => ({ maxFindingGaps: 50, gapOnlyStreakLimit: 2, noProgressStreakLimit: 3 })),
    createIterationConvergenceTracker: vi.fn(() => ({
      convergence: { lastClaimCount: 0, lastGapFindingCount: 0, lastOpenTodoCount: 0, lastCompletedTodoCount: 0, gapOnlyStreak: 0, noProgressStreak: 0 },
      initBaselines: vi.fn(),
      emitIterationCompleted: vi.fn(),
    })),
    runPlanningPhaseIteration: vi.fn(),
    executeDeepSearchDecision: vi.fn(),
    runWritingPhaseIfNeeded: vi.fn(async () => ({ ok: true })),
    ensureReportOnComplete: vi.fn(async ({ agent }) => {
      if (!agent.state.L1) agent.state.L1 = {};
      agent.state.L1.report = { markdown: "# Completed\n\nok" };
    }),
    MockModelResponseHandler,
    MockConvergenceDetector,
    MockBehaviorFingerprint,
  };
});

vi.mock("../../../../js/agents/stages/deepsearch/runtime/logger.js", () => ({
  createLogger: hoisted.createLogger,
}));

vi.mock("../../../../js/agents/stages/deepsearch/capabilities-loader.js", () => ({
  loadDeepSearchCapabilities: hoisted.loadDeepSearchCapabilities,
}));

vi.mock("../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: hoisted.getModelCaller,
}));

vi.mock("../../../../js/agents/shared/utils/error-classifier.js", () => ({
  classifyDeepSearchError: hoisted.classifyDeepSearchError,
}));

vi.mock("../../../../js/agents/runtime/core/lifecycle.js", () => ({
  createLifecycleEmitter: hoisted.createLifecycleEmitter,
}));

vi.mock("../../../../js/agents/stages/deepsearch/runtime/model-response-handler.js", () => ({
  ModelResponseHandler: hoisted.MockModelResponseHandler,
}));

vi.mock("../../../../js/agents/runtime/analysis/convergence-detector.js", () => ({
  ConvergenceDetector: hoisted.MockConvergenceDetector,
}));

vi.mock("../../../../js/agents/runtime/analysis/behavior-fingerprint.js", () => ({
  BehaviorFingerprint: hoisted.MockBehaviorFingerprint,
}));

vi.mock("../../../../js/agents/stages/deepsearch/phases/planning-phase.js", () => ({
  addInitialDeepSearchMessages: hoisted.addInitialDeepSearchMessages,
  getGapConvergencePolicy: hoisted.getGapConvergencePolicy,
  createIterationConvergenceTracker: hoisted.createIterationConvergenceTracker,
  runPlanningPhaseIteration: hoisted.runPlanningPhaseIteration,
}));

vi.mock("../../../../js/agents/stages/deepsearch/phases/execution-phase.js", () => ({
  executeDeepSearchDecision: hoisted.executeDeepSearchDecision,
}));

vi.mock("../../../../js/agents/stages/deepsearch/phases/writing-phase.js", () => ({
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

beforeEach(() => {
  // NOTE: vi.clearAllMocks() does not reset `mockImplementationOnce` queues.
  // These tests rely on per-test one-off implementations, so we reset those mocks explicitly.
  vi.clearAllMocks();
  hoisted.runPlanningPhaseIteration.mockReset();
  hoisted.executeDeepSearchDecision.mockReset();
  hoisted.classifyDeepSearchError.mockReset();
  hoisted.getModelCaller.mockReturnValue(async () => ({ content: '{"action":"noop"}', usage: { input: 1, output: 1, total: 2 } }));
  hoisted.classifyDeepSearchError.mockImplementation((err) => ({
    message: err instanceof Error ? err.message : String(err),
    recoverable: true,
    category: "system",
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("deepsearch/deepsearch-agent-loop", () => {
  it("run(): completes after a complete decision and runs writing phase (LLM + DI mocked)", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");

    const state = new DeepSearchState({
      runId: "run_test_1",
      userConfig: {
        // Make report convergence detector active to exercise that path.
        convergenceDetector: { enabled: true, minIterations: 1, minReportChars: 1, windowSize: 2 },
      },
      L1: {
        report: { markdown: "abc" },
        gaps: [],
      },
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async ({ callModel, responseHandler }) => {
      responseHandler?.emit?.("deepsearch.test.emit", { ok: true });
      responseHandler?.parseDecision?.('{"thought":"t","action":"complete","args":{}}');
      await callModel([{ role: "user", content: "ping" }], { model: "mock" });
      return { status: "success", decision: { action: "complete" } };
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 2, config: { agent: { quick: { maxToolCalls: 3 } } } });

    const out = await agent.run(state, stageApi);

    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(out.runId).toBe("run_test_1");
    expect(hoisted.loadDeepSearchCapabilities).toHaveBeenCalledTimes(1);
    expect(hoisted.getModelCaller).toHaveBeenCalledTimes(1);
    expect(hoisted.addInitialDeepSearchMessages).toHaveBeenCalledTimes(1);
    expect(hoisted.ensureReportOnComplete).toHaveBeenCalledTimes(1);
    expect(hoisted.runWritingPhaseIfNeeded).toHaveBeenCalledTimes(1);
    expect(stageApi.eventBus.enableBackpressure).toHaveBeenCalledTimes(1);
  });

  it("run(): executes decision via executeDeepSearchDecision and stops next iteration when toolCallCount exceeds maxToolCalls", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_tool_limit", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "success", decision: { action: "list-docs" } }));
    hoisted.executeDeepSearchDecision.mockResolvedValueOnce({ toolCalls: 999 });

    // Second iteration should never call planning (loop breaks at top).
    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "success", decision: { action: "complete" } }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 2 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.executeDeepSearchDecision).toHaveBeenCalledTimes(1);
    expect(hoisted.runPlanningPhaseIteration).toHaveBeenCalledTimes(1);
  });

  it("run(): supports planning status=retry then status=stop", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_retry_stop", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration
      .mockImplementationOnce(async () => ({ status: "retry" }))
      .mockImplementationOnce(async () => ({ status: "stop" }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.runPlanningPhaseIteration).toHaveBeenCalledTimes(2);
  });

  it("run(): supports planning status=skip (counts iteration + goes to writing)", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_skip", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "skip" }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.runPlanningPhaseIteration).toHaveBeenCalledTimes(1);
  });

  it("run(): breaks early when budget is exhausted", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_budget_break", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration.mockImplementation(async () => ({ status: "success", decision: { action: "complete" } }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 2 });
    agent.budget = { isExhausted: vi.fn(() => true) };

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(hoisted.runPlanningPhaseIteration).not.toHaveBeenCalled();
  });

  it("run(): passes shouldDegrade + fallbackFactory into errorBoundary.wrap context", async () => {
    const captured = { opts: null };
    const stageApi = makeStageApi({
      errorBoundaryConfig: { degrade: true },
      errorBoundary: {
        wrap: vi.fn(async (fn, opts) => {
          captured.opts = opts;
          const result = await fn();
          // Exercise fallbackFactory (normally used on errors).
          opts?.context?.fallbackFactory?.();
          return result;
        }),
      },
    });

    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_boundary", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "stop" }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(typeof captured.opts?.context?.shouldDegrade).toBe("function");
    expect(captured.opts.context.shouldDegrade()).toBe(true);
  });

  it("run(): system-retry updates state.iteration when UnifiedAgentContext capability is missing", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({
      runId: "run_sys_retry_no_ctx",
      userConfig: { budget: { maxSystemRetriesPerIteration: 1 } },
      L1: { report: { markdown: "abc" }, gaps: [] },
    });

    hoisted.loadDeepSearchCapabilities.mockResolvedValueOnce({
      ...(await hoisted.loadDeepSearchCapabilities()),
      UnifiedAgentContext: null,
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => {
      throw new Error("transient");
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(state.iteration).toBe(1);
  });

  it("run(): stops when report-convergence detector suggests stop (and updates state iteration when no context)", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({
      runId: "run_convergence_stop",
      userConfig: { convergenceDetector: { enabled: true, minIterations: 1, minReportChars: 1 } },
      L1: { report: { markdown: "abc" }, gaps: [] },
    });

    const originalSuggestion = hoisted.MockConvergenceDetector.prototype.getSuggestion;
    hoisted.MockConvergenceDetector.prototype.getSuggestion = () => ({ action: "stop", reason: "stable" });

    hoisted.loadDeepSearchCapabilities.mockResolvedValueOnce({
      ...(await hoisted.loadDeepSearchCapabilities()),
      UnifiedAgentContext: null,
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "skip" }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 3 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(state.iteration).toBe(1);

    hoisted.MockConvergenceDetector.prototype.getSuggestion = originalSuggestion;
  });

  it("run(): fails when model caller is unavailable", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({ runId: "run_no_model", L1: { report: { markdown: "abc" }, gaps: [] } });

    hoisted.getModelCaller.mockReturnValueOnce(null);
    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => ({ status: "stop" }));

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    await expect(agent.run(state, stageApi)).rejects.toThrow(/No model available/);
    expect(agent.status).toBe(AgentStatus.FAILED);
  });

  it("run(): counts recoverable system errors without consuming iteration budget until maxSystemRetriesPerIteration is hit", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
    const state = new DeepSearchState({
      runId: "run_sys_retry",
      userConfig: { budget: { maxSystemRetriesPerIteration: 1 } },
      L1: { report: { markdown: "abc" }, gaps: [] },
    });

    hoisted.runPlanningPhaseIteration.mockImplementationOnce(async () => {
      throw new Error("transient");
    });

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    const out = await agent.run(state, stageApi);
    expect(out.status).toBe(AgentStatus.COMPLETED);
    expect(agent.messages.some((m) => String(m?.content || "").includes("系统错误已连续发生"))).toBe(true);
  });

  it("run(): marks FAILED and rethrows on non-recoverable errors", async () => {
    const stageApi = makeStageApi();
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");
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

    const { DeepSearchAgentLoop, AgentStatus } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ mode: "quick", maxIterations: 1 });

    await expect(agent.run(state, stageApi)).rejects.toThrow("fatal");
    expect(agent.status).toBe(AgentStatus.FAILED);
  });

  it("_recordToolCall(): supports legacy guard + behavior-fingerprint loop detection", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({
      toolCallGuard: { enabled: true, warnAt: 2, maxConsecutive: 3, ignoreTools: ["ignore-me"] },
    });

    expect(agent._recordToolCall("ignore-me", { a: 1 })).toBeNull();

    const first = agent._recordToolCall("tool-a", { a: 1 });
    expect(first.tool).toBe("tool-a");
    expect(first.shouldWarn).toBe(false);
    expect(first.shouldStop).toBe(false);

    const second = agent._recordToolCall("tool-a", { a: 1 });
    expect(second.shouldWarn).toBe(true);
    expect(second.behavior?.loopDetected).toBe(true);

    const third = agent._recordToolCall("tool-a", { a: 1 });
    expect(third.shouldStop).toBe(true);
  });

  it("_recordToolCall(): returns behavior-only warnings when guard is disabled", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop({ toolCallGuard: { enabled: false } });

    expect(agent._recordToolCall("x", {})).toBeNull();
    const second = agent._recordToolCall("x", {});
    expect(second.shouldWarn).toBe(true);
    expect(second.signature).toBeNull();
    expect(second.behavior?.loopDetected).toBe(true);
  });

  it("_parseDecision() + _ensureState() + getAgentContextStatus() cover output helpers", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const { DeepSearchState } = await import("../../../../js/agents/stages/deepsearch/state.js");

    const agent = new DeepSearchAgentLoop();

    expect(agent._parseDecision('{"thought":"t","actions":[{"action":"a","args":{"x":1}}]}')).toEqual({
      thought: "t",
      actions: [{ action: "a", args: { x: 1 } }],
    });
    expect(agent._parseDecision('{"thought":"t","action":"complete","args":{"y":2}}')).toEqual({
      thought: "t",
      action: "complete",
      args: { y: 2 },
    });
    expect(agent._parseDecision("not json")).toBeNull();

    const state = new DeepSearchState({ runId: "run_state" });
    expect(agent._ensureState(state)).toBe(state);
    expect(agent._ensureState({ state })).toBe(state);
    expect(agent._ensureState({ state: { runId: "run_json" } })).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState({ runId: "run_json2" })).toBeInstanceOf(DeepSearchState);
    expect(agent._ensureState(null)).toBeInstanceOf(DeepSearchState);

    agent.state = state;
    expect(agent.getAgentContextStatus()).toEqual(
      expect.objectContaining({ runId: "run_state", iteration: 0, todoCount: 0, claimCount: 0 })
    );

    agent.context = { getContextStatus: vi.fn(() => ({ runId: "ctx", iteration: 3 })) };
    expect(agent.getAgentContextStatus()).toEqual({ runId: "ctx", iteration: 3 });
  });

  it("_emit(): prefixes event names and falls back to eventBus.emit", async () => {
    const { DeepSearchAgentLoop } = await import("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js");
    const agent = new DeepSearchAgentLoop();
    agent.emit = null;
    agent.eventBus = { emit: vi.fn() };

    agent._emit("foo", { ok: true }, { status: "started" });
    expect(agent.eventBus.emit).toHaveBeenCalledWith("deepsearch.foo", expect.objectContaining({ status: "started" }));

    agent._emit("deepsearch.bar", { ok: true });
    expect(agent.eventBus.emit).toHaveBeenCalledWith("deepsearch.bar", expect.any(Object));
  });
});
