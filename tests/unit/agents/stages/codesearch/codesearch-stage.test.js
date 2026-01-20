import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRunPlanningPhase,
  mockRunExecutionStep,
  mockRunSummarizingPhase,
  mockBuildSystemPrompt,
  mockBuildTodoCompletionStats,
  mockIsTodoOpen,
} = vi.hoisted(() => ({
  mockRunPlanningPhase: vi.fn(),
  mockRunExecutionStep: vi.fn(),
  mockRunSummarizingPhase: vi.fn(),
  mockBuildSystemPrompt: vi.fn(),
  mockBuildTodoCompletionStats: vi.fn(),
  mockIsTodoOpen: vi.fn(),
}));

const { mockGetModelCaller } = vi.hoisted(() => ({
  mockGetModelCaller: vi.fn(),
}));

const { mockCreateToolExecutor } = vi.hoisted(() => ({
  mockCreateToolExecutor: vi.fn(),
}));

vi.mock("../../../../../js/agents/stages/codesearch/phases/index.js", () => ({
  runPlanningPhase: mockRunPlanningPhase,
  runExecutionStep: mockRunExecutionStep,
  runSummarizingPhase: mockRunSummarizingPhase,
  buildSystemPrompt: mockBuildSystemPrompt,
  buildTodoCompletionStats: mockBuildTodoCompletionStats,
  isTodoOpen: mockIsTodoOpen,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: mockGetModelCaller,
}));

vi.mock("../../../../../js/agents/stages/codesearch/code-tools.js", () => ({
  createToolExecutor: mockCreateToolExecutor,
}));

import {
  CodeSearchStage,
  runCodeSearchStage,
  registerCodeSearchStages,
  CodeSearchState,
} from "../../../../../js/agents/stages/codesearch/codesearch-stage.js";
import { AgentStatus, StagePausedError } from "../../../../../js/agents/runtime/index.js";

const DEFAULT_QUERY = "分析这个代码库的架构";
const DEFAULT_TODO_STATS = { total: 0, completed: 0, cancelled: 0, open: 0 };

function buildWatchdog(overrides = {}) {
  return {
    reset: vi.fn(),
    configure: vi.fn(),
    tick: vi.fn(),
    recordOutput: vi.fn(),
    checkHealth: vi.fn().mockReturnValue({ healthy: true, issues: [], stats: {} }),
    resetOscillation: vi.fn(),
    resetToolLoop: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetModelCaller.mockReturnValue(vi.fn());
  mockBuildSystemPrompt.mockReturnValue("system");
  mockIsTodoOpen.mockImplementation((todo) => {
    const status = typeof todo?.status === "string" ? todo.status.toLowerCase() : "open";
    return status !== "completed" && status !== "cancelled";
  });
  mockRunPlanningPhase.mockImplementation(async ({ state }) => {
    state.todos = [];
    return { success: true, todos: [] };
  });
  mockRunExecutionStep.mockResolvedValue({ done: true });
  mockRunSummarizingPhase.mockResolvedValue({
    summary: "summary",
    todoStats: { ...DEFAULT_TODO_STATS },
    budgetUsage: { total: 0 },
  });
  mockCreateToolExecutor.mockImplementation(() => ({
    execute: vi.fn(),
    definitions: [],
  }));
});

describe("CodeSearchStage", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("defaults query when input is %s", async (_label, value) => {
    const watchdog = buildWatchdog();
    const stage = new CodeSearchStage();
    const result = await stage.execute(
      { runId: "run_default_query" },
      { query: value, userConfig: {}, basePath: "" },
      { watchdog }
    );

    expect(result.query).toBe(DEFAULT_QUERY);
    expect(mockCreateToolExecutor).toHaveBeenCalledWith(expect.objectContaining({ basePath: "." }));
  });

  it("clamps watchdog settings and forwards to health checks", async () => {
    const watchdog = buildWatchdog({
      checkHealth: vi.fn().mockReturnValue({ healthy: true, issues: [], stats: {} }),
    });
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ state }) => {
      state.todos[0].status = "completed";
      return { done: true, watchdogOutput: "ok" };
    });

    const stage = new CodeSearchStage({ maxSteps: 1 });
    await stage.execute(
      { runId: "run_watchdog_clamp" },
      {
        query: "check",
        userConfig: { watchdog: { maxRecentOutputs: 0, similarityThreshold: -1, maxConsecutiveSimilar: 1 } },
      },
      { watchdog }
    );

    expect(watchdog.reset).toHaveBeenCalledTimes(1);
    expect(watchdog.configure).toHaveBeenCalledWith({ maxRecentOutputs: 2, oscillationThreshold: 0 });
    expect(watchdog.checkHealth).toHaveBeenCalledWith(expect.objectContaining({ oscillationConsecutiveThreshold: 2 }));
    expect(watchdog.recordOutput).toHaveBeenCalledWith("ok");
  });

  it("uses default watchdog settings when userConfig is an empty array", async () => {
    const watchdog = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ state }) => {
      state.todos[0].status = "completed";
      return { done: true };
    });

    const stage = new CodeSearchStage();
    await stage.execute(
      { runId: "run_watchdog_defaults" },
      { query: "defaults", userConfig: [] },
      { watchdog }
    );

    expect(watchdog.configure).toHaveBeenCalledWith({ maxRecentOutputs: 6, oscillationThreshold: 0.8 });
    expect(watchdog.checkHealth).toHaveBeenCalledWith(expect.objectContaining({ oscillationConsecutiveThreshold: 3 }));
  });

  it("honors boundary values for options", () => {
    const stageWithZero = new CodeSearchStage({ maxSteps: 0, timeoutMs: 0 });
    expect(stageWithZero.maxSteps).toBe(20);
    expect(stageWithZero.timeoutMs).toBe(120000);

    const stageWithNeg = new CodeSearchStage({
      maxSteps: -1,
      timeoutMs: Number.MAX_SAFE_INTEGER,
      maxBacktracks: -1,
    });
    expect(stageWithNeg.maxSteps).toBe(-1);
    expect(stageWithNeg.timeoutMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(stageWithNeg.maxBacktracks).toBe(-1);
  });

  it("accepts numeric strings for maxSteps", async () => {
    const watchdog = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ state, step }) => {
      if (step >= 2) state.todos[0].status = "completed";
      return { done: step >= 2 };
    });

    const stage = new CodeSearchStage({ maxSteps: "2" });
    await stage.execute({ runId: "run_string_steps" }, { query: "two steps" }, { watchdog });

    expect(mockRunExecutionStep).toHaveBeenCalledTimes(2);
  });

  it("pauses when model caller is unavailable", async () => {
    mockGetModelCaller.mockReturnValue(null);
    const watchdog = buildWatchdog();
    const stage = new CodeSearchStage();

    await expect(
      stage.execute({ runId: "run_no_model" }, { query: null }, { watchdog })
    ).rejects.toThrow(StagePausedError);

    expect(stage.loopState?.awaitUserFeedback).toBe(true);
    expect(stage.loopState?.pauseReason).toBe("LLM unavailable, awaiting user input");
    expect(stage.loopStatus).toBe(AgentStatus.PAUSED);
  });

  it("pauses when planning phase reports failure", async () => {
    mockRunPlanningPhase.mockResolvedValue({ success: false, todos: [] });
    const watchdog = buildWatchdog();
    const stage = new CodeSearchStage();

    await expect(
      stage.execute({ runId: "run_plan_fail" }, { query: "plan" }, { watchdog })
    ).rejects.toThrow(StagePausedError);

    expect(stage.loopState?.awaitUserFeedback).toBe(true);
  });

  it("marks failed when execution step throws and still summarizes", async () => {
    const watchdog = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockRejectedValue(new Error("boom"));
    mockRunSummarizingPhase.mockResolvedValue({
      summary: "final",
      todoStats: { total: 1, completed: 0, cancelled: 0, open: 1 },
      budgetUsage: { total: 0 },
    });

    const stage = new CodeSearchStage({ maxSteps: 1 });
    const result = await stage.execute({ runId: "run_exec_error" }, { query: "fail" }, { watchdog });

    expect(stage.loopStatus).toBe(AgentStatus.FAILED);
    expect(result.summary).toBe("final");
    expect(mockRunSummarizingPhase).toHaveBeenCalledTimes(1);
  });

  it("stops early on watchdog timeout and records observation", async () => {
    const watchdog = buildWatchdog({
      checkHealth: vi.fn().mockReturnValue({
        healthy: false,
        issues: [{ type: "timeout" }, { type: "oscillation" }],
        stats: { iterations: 1 },
      }),
    });
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async () => ({ done: false, watchdogOutput: "loop" }));

    const stage = new CodeSearchStage({ maxSteps: 3 });
    const result = await stage.execute({ runId: "run_watchdog_stop" }, { query: "loop" }, { watchdog });

    expect(result.completionReason).toBe("watchdog_timeout");
    expect(stage.state.observations.some((obs) => obs.includes("Watchdog"))).toBe(true);
    expect(watchdog.resetOscillation).toHaveBeenCalledTimes(1);
  });

  it("handles large tool output and long query strings", async () => {
    const watchdog = buildWatchdog();
    const longQuery = "a".repeat(10000);
    const largeContent = "b".repeat(1_000_000);

    mockCreateToolExecutor.mockImplementation(() => ({
      read_file: vi.fn().mockResolvedValue(largeContent),
      execute: vi.fn(),
      definitions: [],
    }));
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: "todo_1", status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ tools, state }) => {
      const content = await tools.read_file({ path: "big.txt" });
      state.addObservation(`size:${content.length}`);
      state.todos[0].status = "completed";
      return { done: true, watchdogOutput: content.slice(0, 64) };
    });

    const stage = new CodeSearchStage();
    const result = await stage.execute({ runId: "run_large" }, { query: longQuery }, { watchdog });

    expect(result.query).toBe(longQuery);
    expect(stage.state.observations).toContain(`size:${largeContent.length}`);
  });

  it("enables backpressure with deep config objects", async () => {
    const watchdog = buildWatchdog();
    const eventBus = {
      emit: vi.fn(),
      enableBackpressure: vi.fn(),
      _backpressure: { enabled: false },
    };
    const deepConfig = { maxQueueSize: 1, deep: { nested: { value: true } } };

    const stage = new CodeSearchStage();
    await stage.execute(
      { runId: "run_backpressure" },
      { query: "backpressure", userConfig: {} },
      { watchdog, eventBus, eventBusBackpressure: deepConfig }
    );

    expect(eventBus.enableBackpressure).toHaveBeenCalledWith(expect.objectContaining(deepConfig));
  });

  it("supports concurrent runs on separate instances", async () => {
    const watchdogA = buildWatchdog();
    const watchdogB = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: state.query, status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ state }) => {
      state.todos[0].status = "completed";
      return { done: true };
    });
    mockRunSummarizingPhase.mockImplementation(async ({ state }) => ({
      summary: `summary:${state.query}`,
      todoStats: { total: 1, completed: 1, cancelled: 0, open: 0 },
      budgetUsage: { total: 0 },
    }));

    const stageA = new CodeSearchStage();
    const stageB = new CodeSearchStage();
    const [resA, resB] = await Promise.all([
      stageA.execute({ runId: "run_concurrent_a" }, { query: "A" }, { watchdog: watchdogA }),
      stageB.execute({ runId: "run_concurrent_b" }, { query: "B" }, { watchdog: watchdogB }),
    ]);

    expect(resA.summary).toBe("summary:A");
    expect(resB.summary).toBe("summary:B");
    expect(stageA.state.query).toBe("A");
    expect(stageB.state.query).toBe("B");
  });

  it("supports rapid sequential runs with fresh instances", async () => {
    const watchdog = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state.todos = [{ todoId: state.query, status: "open" }];
      return { success: true, todos: state.todos };
    });
    mockRunExecutionStep.mockImplementation(async ({ state }) => {
      state.todos[0].status = "completed";
      return { done: true };
    });
    mockRunSummarizingPhase.mockImplementation(async ({ state }) => ({
      summary: `summary:${state.query}`,
      todoStats: { total: 1, completed: 1, cancelled: 0, open: 0 },
      budgetUsage: { total: 0 },
    }));

    const firstStage = new CodeSearchStage();
    const first = await firstStage.execute({ runId: "run_seq_1" }, { query: "first" }, { watchdog });
    const secondStage = new CodeSearchStage();
    const second = await secondStage.execute({ runId: "run_seq_2" }, { query: "second" }, { watchdog });

    expect(first.summary).toBe("summary:first");
    expect(second.summary).toBe("summary:second");
    expect(firstStage.state.query).toBe("first");
    expect(secondStage.state.query).toBe("second");
  });

  it("throws when todos is an object instead of an array", async () => {
    const watchdog = buildWatchdog();
    mockRunPlanningPhase.mockImplementation(async ({ state }) => {
      state._todos = { invalid: true };
      return { success: true, todos: [] };
    });

    const stage = new CodeSearchStage({ maxSteps: 1 });
    await expect(stage.execute({ runId: "run_bad_todos" }, { query: "bad" }, { watchdog })).rejects.toThrow();
  });

  it("resolves dependencies from context, container, and fallback", async () => {
    const container = {
      get: vi.fn()
        .mockResolvedValueOnce("fromContainer")
        .mockRejectedValueOnce(new Error("missing")),
    };
    const stage = new CodeSearchStage({ container });

    const fromContext = await stage._resolveDependency("eventBus", { eventBus: "fromContext" }, "fallback");
    const fromContainer = await stage._resolveDependency("eventBus", {}, "fallback");
    const fromFallback = await stage._resolveDependency("missing", {}, "fallback");

    expect(fromContext).toBe("fromContext");
    expect(fromContainer).toBe("fromContainer");
    expect(fromFallback).toBe("fallback");
  });

  it("returns default Node fs helpers when available", async () => {
    const stage = new CodeSearchStage();
    const fs = await stage._getDefaultFs();

    expect(fs).toEqual(
      expect.objectContaining({
        readFile: expect.any(Function),
        readdir: expect.any(Function),
        stat: expect.any(Function),
      })
    );
  });
});

describe("runCodeSearchStage", () => {
  it("creates a stage with options and forwards execute arguments", async () => {
    const executeSpy = vi.spyOn(CodeSearchStage.prototype, "execute").mockResolvedValue("ok");
    const runContext = { runId: "run_wrapper" };
    const input = { query: "wrapped", options: { maxSteps: 9 } };
    const stageApi = { watchdog: buildWatchdog() };

    const result = await runCodeSearchStage(runContext, input, stageApi);

    expect(result).toBe("ok");
    expect(executeSpy).toHaveBeenCalledWith(runContext, input, stageApi);
    expect(executeSpy.mock.instances[0].maxSteps).toBe(9);
    executeSpy.mockRestore();
  });
});

describe("registerCodeSearchStages", () => {
  it("registers the codesearch pipeline with default timeout", () => {
    const orchestrator = { registerStage: vi.fn() };
    registerCodeSearchStages(orchestrator);

    expect(orchestrator.registerStage).toHaveBeenCalledWith(
      "codesearch.pipeline",
      runCodeSearchStage,
      { actor: "codesearch", timeoutMs: 120000 }
    );
  });

  it("registers the codesearch pipeline with custom timeout", () => {
    const orchestrator = { registerStage: vi.fn() };
    registerCodeSearchStages(orchestrator, { timeoutMs: 500 });

    expect(orchestrator.registerStage).toHaveBeenCalledWith(
      "codesearch.pipeline",
      runCodeSearchStage,
      { actor: "codesearch", timeoutMs: 500 }
    );
  });
});

describe("CodeSearchState", () => {
  it("tracks todo status transitions with history", () => {
    const state = new CodeSearchState({ runId: "", query: "   " });
    state.addTodo({ todoId: "todo_1", status: "open" });

    const updated = state.updateTodo("todo_1", { status: "completed" });

    expect(state.runId).toBe("run_unknown");
    expect(state.query).toBe("");
    expect(updated.status).toBe("completed");
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0].from).toBe("open");
    expect(updated.history[0].to).toBe("completed");
  });
});
