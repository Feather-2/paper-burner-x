import { describe, it, expect, vi, beforeEach } from "vitest";

const INDEX_PATH = "../../../../../js/agents/stages/codesearch/index.js";

let stepSequence = 0;
let mockModelCaller;
let planningTodos;
let planningResult;
let executionQueue;
let summarizeResult;
let buildSystemPromptValue;
let todoOpenPredicate;
let watchdogHealth;

let runPlanningPhaseImpl;
let runExecutionStepImpl;
let runSummarizingPhaseImpl;

let grepChunksMock;
let computeSha256Mock;
let writeTextFileWithPolicyMock;
let multiEditTextFileWithPolicyMock;
let symbolIndexerIndexFileMock;
let symbolIndexerExtractSymbolsMock;
let symbolIndexerQueryMock;
let symbolIndexerStorePutMock;
let symbolIndexerInvalidateCachesMock;
let symbolIndexerInstances;

vi.mock("../../../../../js/agents/runtime/index.js", () => {
  const AgentStatus = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    PAUSED: "paused",
    FAILED: "failed",
    COMPLETED: "completed",
  });

  const StepStatus = Object.freeze({
    PENDING: "pending",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
  });

  const isValidAgentStatus = (value) => Object.values(AgentStatus).includes(value);
  const isValidStepStatus = (value) => Object.values(StepStatus).includes(value);
  const isAgentActive = (value) => value === AgentStatus.RUNNING || value === AgentStatus.PAUSED;
  const isAgentTerminal = (value) => value === AgentStatus.COMPLETED || value === AgentStatus.FAILED;

  class StagePausedError extends Error {
    constructor(message, info = {}) {
      super(message);
      this.name = "StagePausedError";
      this.info = info;
    }
  }

  class StageCancelledError extends Error {
    constructor(message) {
      super(message);
      this.name = "StageCancelledError";
    }
  }

  class StageTimeoutError extends Error {
    constructor(message) {
      super(message);
      this.name = "StageTimeoutError";
    }
  }

  class BaseAgentLoop {
    constructor({ actor, stageName, eventBus } = {}) {
      this.actor = actor;
      this.stageName = stageName;
      this.eventBus = eventBus || null;
      this.loopStatus = AgentStatus.IDLE;
    }

    initLoopStatus({ status } = {}) {
      this.loopStatus = status || AgentStatus.IDLE;
    }

    async _transitionLoopStatus(status) {
      this.loopStatus = status;
    }

    _beginStep(meta = {}, context = {}) {
      stepSequence += 1;
      const stepId = meta.stepId || `step_${stepSequence}`;
      const controller = new AbortController();
      const signal = context.signal || controller.signal;
      const step = {
        stepId,
        name: meta.name || meta.step || "step",
        runId: meta.runId || null,
        iteration: meta.iteration ?? null,
      };
      return { step, context: { ...context, signal } };
    }

    _endStep() {
      return;
    }

    _shouldPauseFromError(err) {
      return err instanceof StagePausedError || err?.awaitUserFeedback === true;
    }

    _createPauseError({ runId, reason }) {
      return new StagePausedError("Run paused", { runId, reason });
    }

    async _resolveDependency(serviceId, context, fallback) {
      const container = context?.container;
      if (container && typeof container.tryGet === "function") {
        const fromContainer = await container.tryGet(serviceId);
        if (fromContainer !== undefined) return fromContainer;
      }
      if (context && typeof context === "object" && serviceId in context) {
        const fromContext = context[serviceId];
        if (fromContext !== undefined) return fromContext;
      }
      return fallback;
    }

    async execute(runContext, input, stageApi = {}) {
      return this.run(input, { ...stageApi, runContext });
    }
  }

  const checkCancelled = (signal) => {
    if (signal?.aborted) {
      throw new Error("Run cancelled");
    }
  };

  const loadMechanisms = vi.fn(async () => {});
  const initMechanisms = vi.fn();

  const createLifecycleEmitter = () => {
    const emit = vi.fn();
    return {
      emit,
      started: vi.fn(),
      phaseTransition: vi.fn(),
      completed: vi.fn(),
    };
  };

  class Watchdog {
    constructor() {
      this.actions = [];
    }

    tick() {
      this.ticked = true;
    }

    recordOutput(output) {
      this.actions.push(output);
    }

    recordAction(action) {
      this.actions.push(action);
    }

    checkHealth() {
      return watchdogHealth || { healthy: true, issues: [], stats: {} };
    }

    reset() {
      return;
    }

    configure() {
      return;
    }

    resetOscillation() {
      return;
    }

    resetToolLoop() {
      return;
    }
  }

  return {
    AgentStatus,
    StepStatus,
    isValidAgentStatus,
    isValidStepStatus,
    isAgentActive,
    isAgentTerminal,
    StagePausedError,
    StageCancelledError,
    StageTimeoutError,
    BaseAgentLoop,
    checkCancelled,
    loadMechanisms,
    initMechanisms,
    createLifecycleEmitter,
    Watchdog,
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/model.js", () => ({
  getModelCaller: () => mockModelCaller,
}));

vi.mock("../../../../../js/agents/stages/codesearch/phases/index.js", () => ({
  runPlanningPhase: (...args) => runPlanningPhaseImpl(...args),
  runExecutionStep: (...args) => runExecutionStepImpl(...args),
  runSummarizingPhase: (...args) => runSummarizingPhaseImpl(...args),
  buildSystemPrompt: () => buildSystemPromptValue,
  buildTodoCompletionStats: () => ({ open: 0, completed: 0 }),
  isTodoOpen: (todo) => todoOpenPredicate(todo),
}));

vi.mock("../../../../../js/agents/retrieval/grep.js", () => ({
  grepChunks: (...args) => grepChunksMock(...args),
}));

vi.mock("../../../../../js/agents/storage/artifact-manager.js", () => ({
  computeSha256: (...args) => computeSha256Mock(...args),
}));

vi.mock("../../../../../js/agents/vfs/operations.js", () => ({
  writeTextFileWithPolicy: (...args) => writeTextFileWithPolicyMock(...args),
  multiEditTextFileWithPolicy: (...args) => multiEditTextFileWithPolicyMock(...args),
}));

vi.mock("../../../../../js/agents/stages/codesearch/indexing/symbol-indexer.js", () => ({
  default: class SymbolIndexerMock {
    constructor(opts = {}) {
      this.options = opts;
      this.workspaceId = opts.workspaceId || "default";
      this.store = {
        putSymbolRecord: (...args) => symbolIndexerStorePutMock(...args),
      };
      this.indexFile = (...args) => symbolIndexerIndexFileMock(...args);
      this.extractSymbolsAsync = (...args) => symbolIndexerExtractSymbolsMock(...args);
      this.query = (...args) => symbolIndexerQueryMock(...args);
      this.invalidateCaches = (...args) => symbolIndexerInvalidateCachesMock(...args);
      symbolIndexerInstances.push(this);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  stepSequence = 0;
  mockModelCaller = vi.fn(async () => ({ ok: true }));
  planningTodos = [{ todoId: "todo-1", text: "todo", status: "open" }];
  planningResult = { success: true };
  executionQueue = [{ done: true, watchdogOutput: "ok" }];
  summarizeResult = { summary: "summary", todoStats: { completed: 0 }, budgetUsage: { total: 0 } };
  buildSystemPromptValue = "system-prompt";
  todoOpenPredicate = (todo) => todo?.status !== "completed" && todo?.status !== "cancelled";
  watchdogHealth = { healthy: true, issues: [], stats: {} };

  runPlanningPhaseImpl = async ({ state }) => {
    if (Array.isArray(planningTodos)) {
      state.todos = planningTodos;
    }
    return planningResult;
  };

  runExecutionStepImpl = async () => {
    if (executionQueue.length > 0) {
      const next = executionQueue.shift();
      return typeof next === "function" ? next() : next;
    }
    return { done: true };
  };

  runSummarizingPhaseImpl = async () => summarizeResult;

  grepChunksMock = vi.fn(() => []);
  computeSha256Mock = vi.fn(async () => "sha256");
  writeTextFileWithPolicyMock = vi.fn(async () => ({ checkpointId: "cp1" }));
  multiEditTextFileWithPolicyMock = vi.fn(async () => ({ changes: 0 }));

  symbolIndexerIndexFileMock = vi.fn(async () => ({ skipped: false, symbols: [] }));
  symbolIndexerExtractSymbolsMock = vi.fn(async () => []);
  symbolIndexerQueryMock = vi.fn(async () => []);
  symbolIndexerStorePutMock = vi.fn(async () => {});
  symbolIndexerInvalidateCachesMock = vi.fn();
  symbolIndexerInstances = [];
});

describe("CodeSearchStage", () => {
  it("initializes defaults and honors boundary options", async () => {
    const { CodeSearchStage } = await import(INDEX_PATH);

    const stageDefault = new CodeSearchStage();
    expect(stageDefault.maxSteps).toBe(20);
    expect(stageDefault.timeoutMs).toBe(120000);
    expect(stageDefault.maxBacktracks).toBe(3);
    expect(stageDefault.loopState).toBe(null);

    const stageBoundary = new CodeSearchStage({ maxSteps: 0, timeoutMs: 0, maxBacktracks: 0 });
    expect(stageBoundary.maxSteps).toBe(20);
    expect(stageBoundary.timeoutMs).toBe(120000);
    expect(stageBoundary.maxBacktracks).toBe(0);

    const stageNegative = new CodeSearchStage({ maxSteps: -1 });
    expect(stageNegative.maxSteps).toBe(-1);
  });

  it("pauses when model caller is unavailable", async () => {
    mockModelCaller = null;
    const { CodeSearchStage } = await import(INDEX_PATH);

    const stage = new CodeSearchStage();
    let error;
    try {
      await stage.run({ query: "q" }, {});
    } catch (err) {
      error = err;
    }

    expect(error).toBeTruthy();
    expect(error.name).toBe("StagePausedError");
    expect(stage.state.awaitUserFeedback).toBe(true);
    expect(stage.state.pauseReason).toBe("LLM unavailable, awaiting user input");
  });

  it("runs planning/execution/summarizing and returns summary", async () => {
    const { CodeSearchStage, CodeSearchPhase } = await import(INDEX_PATH);

    const stage = new CodeSearchStage({ maxSteps: 1 });
    const result = await stage.run({ query: "Find entry" }, {});

    expect(result.summary).toBe("summary");
    expect(result.totalSteps).toBe(1);
    expect(result.todos).toHaveLength(1);
    expect(stage.state.phase).toBe(CodeSearchPhase.COMPLETED);
    expect(result.query).toBe("Find entry");
  });

  it("handles execution errors and still summarizes", async () => {
    executionQueue = [() => {
      throw new Error("boom");
    }];
    summarizeResult = { summary: "fallback", todoStats: {}, budgetUsage: {} };

    const { CodeSearchStage, CodeSearchPhase } = await import(INDEX_PATH);
    const stage = new CodeSearchStage();
    const result = await stage.run({ query: "q" }, {});

    expect(result.summary).toBe("fallback");
    expect(stage.state.phase).toBe(CodeSearchPhase.SUMMARIZING);
  });

  it("normalizes empty query to a non-empty default", async () => {
    const { CodeSearchStage } = await import(INDEX_PATH);

    const stage = new CodeSearchStage();
    const result = await stage.run({ query: "   " }, {});

    expect(result.query).toBeTruthy();
    expect(result.query.trim().length).toBeGreaterThan(0);
    expect(result.query).not.toBe("   ");
  });
});

describe("CodeSearchState", () => {
  it("initializes defaults and normalizes inputs", async () => {
    const { CodeSearchState, CodeSearchPhase } = await import(INDEX_PATH);

    const state = new CodeSearchState({
      runId: 0,
      query: " ",
      taskGoal: null,
      todos: {},
      phase: null,
      observations: null,
      steps: null,
    });

    expect(state.runId).toBe("0");
    expect(state.query).toBe("");
    expect(state.taskGoal).toBe("");
    expect(state.todos).toEqual([]);
    expect(state.phase).toBe(CodeSearchPhase.PLANNING);
    expect(state.observations).toEqual([]);
    expect(state.steps).toEqual([]);
  });

  it("syncs to stateEngine and memoryStore", async () => {
    const { CodeSearchState } = await import(INDEX_PATH);
    const { L0_SET_TASK_GOAL, L0_REPLACE_TODOS } = await import(
      "../../../../../js/agents/plugins/memory/action-types.js"
    );

    let subscriber;
    const stateEngine = {
      dispatchSync: vi.fn(),
      getState: vi.fn(() => ({ L0: { taskGoal: "engineGoal", todos: [{ todoId: "t1" }] } })),
      subscribe: vi.fn((_scope, cb) => {
        subscriber = cb;
        return vi.fn();
      }),
    };

    const memoryStore = {
      setTaskGoal: vi.fn(),
      replaceTodos: vi.fn(),
      L0: {},
    };

    const state = new CodeSearchState({ stateEngine, memoryStore });
    expect(state.taskGoal).toBe("engineGoal");
    expect(state.todos).toEqual([{ todoId: "t1" }]);

    state.taskGoal = "newGoal";
    expect(stateEngine.dispatchSync).toHaveBeenCalledWith({
      type: L0_SET_TASK_GOAL,
      payload: { taskGoal: "newGoal" },
    });
    expect(memoryStore.setTaskGoal).toHaveBeenCalledWith("newGoal");

    state.todos = [{ todoId: "t2" }];
    expect(stateEngine.dispatchSync).toHaveBeenCalledWith({
      type: L0_REPLACE_TODOS,
      payload: { todos: [{ todoId: "t2" }] },
    });
    expect(memoryStore.replaceTodos).toHaveBeenCalled();

    subscriber?.(null, null, { taskGoal: "engineUpdated", todos: [] });
    stateEngine.getState = vi.fn(() => ({ L0: { taskGoal: "engineUpdated", todos: [] } }));
    expect(state.taskGoal).toBe("engineUpdated");
  });

  it("tracks todo history and handles invalid updates", async () => {
    const { CodeSearchState, TodoStatus } = await import(INDEX_PATH);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);

    const state = new CodeSearchState();
    expect(state.addTodo(null)).toBeNull();

    const todo = state.addTodo({ todoId: "t1", status: TodoStatus.OPEN });
    expect(todo).toBeTruthy();

    const updated = state.updateTodo("t1", { status: TodoStatus.COMPLETED });
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]).toMatchObject({ from: TodoStatus.OPEN, to: TodoStatus.COMPLETED, timestamp: 123 });

    expect(state.updateTodo("missing", { status: TodoStatus.CANCELLED })).toBeNull();

    nowSpy.mockRestore();
  });

  it("builds snapshots with deep clones", async () => {
    const { CodeSearchState } = await import(INDEX_PATH);

    const state = new CodeSearchState({
      todos: [{ todoId: "t1", meta: { nested: { value: 1 } } }],
    });

    const snapshot = state.buildStateSnapshot();
    snapshot.todos[0].meta.nested.value = 99;

    expect(state.todos[0].meta.nested.value).toBe(1);
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it("rejects invalid snapshots", async () => {
    const { CodeSearchState } = await import(INDEX_PATH);

    expect(() => CodeSearchState.fromSnapshot(null)).toThrow(TypeError);
    expect(() => CodeSearchState.fromSnapshot("bad")).toThrow(TypeError);
    expect(() => CodeSearchState.fromSnapshot([])).toThrow(TypeError);
  });

  it("ignores invalid observations and steps", async () => {
    const { CodeSearchState } = await import(INDEX_PATH);

    const state = new CodeSearchState();
    state.addObservation("");
    state.addObservation(0);
    state.addObservation("ok");
    expect(state.observations).toEqual(["ok"]);

    expect(state.addStep("bad")).toBeNull();
    const step = state.addStep({ step: Number.MAX_SAFE_INTEGER, tool: "read" });
    expect(step.step).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("runCodeSearchStage", () => {
  it("calls execute with provided arguments", async () => {
    const { runCodeSearchStage, CodeSearchStage } = await import(INDEX_PATH);
    const executeSpy = vi.spyOn(CodeSearchStage.prototype, "execute").mockResolvedValue({ ok: true });

    const runContext = { runId: "r1" };
    const input = { query: "q", options: { maxSteps: 5 } };
    const stageApi = { foo: "bar" };

    const result = await runCodeSearchStage(runContext, input, stageApi);

    expect(result).toEqual({ ok: true });
    expect(executeSpy).toHaveBeenCalledWith(runContext, input, stageApi);
    expect(executeSpy.mock.instances[0].maxSteps).toBe(5);
  });

  it("propagates execute errors", async () => {
    const { runCodeSearchStage, CodeSearchStage } = await import(INDEX_PATH);
    const executeSpy = vi.spyOn(CodeSearchStage.prototype, "execute").mockRejectedValue(new Error("boom"));

    await expect(runCodeSearchStage({ runId: "r2" }, { query: "q" }, {})).rejects.toThrow("boom");
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it("supports concurrent invocations", async () => {
    const { runCodeSearchStage, CodeSearchStage } = await import(INDEX_PATH);
    vi.spyOn(CodeSearchStage.prototype, "execute").mockImplementation(async (runContext, input) => {
      return { runId: runContext.runId, query: input.query };
    });

    const [a, b] = await Promise.all([
      runCodeSearchStage({ runId: "rA" }, { query: "qa" }, {}),
      runCodeSearchStage({ runId: "rB" }, { query: "qb" }, {}),
    ]);

    expect(a).toEqual({ runId: "rA", query: "qa" });
    expect(b).toEqual({ runId: "rB", query: "qb" });
  });
});

describe("registerCodeSearchStages", () => {
  it("registers the stage with defaults", async () => {
    const { registerCodeSearchStages, runCodeSearchStage } = await import(INDEX_PATH);
    const registerStage = vi.fn();

    registerCodeSearchStages({ registerStage });

    expect(registerStage).toHaveBeenCalledWith("codesearch.pipeline", runCodeSearchStage, {
      actor: "codesearch",
      timeoutMs: 120000,
    });
  });

  it("passes boundary timeout values", async () => {
    const { registerCodeSearchStages, runCodeSearchStage } = await import(INDEX_PATH);
    const registerStage = vi.fn();

    registerCodeSearchStages({ registerStage }, { timeoutMs: 0 });
    registerCodeSearchStages({ registerStage }, { timeoutMs: Number.MAX_SAFE_INTEGER });

    expect(registerStage).toHaveBeenCalledWith("codesearch.pipeline", runCodeSearchStage, {
      actor: "codesearch",
      timeoutMs: 0,
    });
    expect(registerStage).toHaveBeenCalledWith("codesearch.pipeline", runCodeSearchStage, {
      actor: "codesearch",
      timeoutMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it("throws when orchestrator is invalid", async () => {
    const { registerCodeSearchStages } = await import(INDEX_PATH);

    expect(() => registerCodeSearchStages({}, {})).toThrow();
  });
});

describe("createToolExecutor", () => {
  it("creates executor with definitions", async () => {
    const { createToolExecutor, TOOL_DEFINITIONS } = await import(INDEX_PATH);
    const tools = createToolExecutor({ basePath: "src" });

    expect(typeof tools.glob).toBe("function");
    expect(typeof tools.read_file).toBe("function");
    expect(tools.definitions).toBe(TOOL_DEFINITIONS);
  });

  it("rejects invalid basePath values", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    expect(() => createToolExecutor({ basePath: "" })).toThrow(/basePath/);
    expect(() => createToolExecutor({ basePath: " " })).toThrow(/basePath/);
    expect(() => createToolExecutor({ basePath: "/" })).toThrow(/Invalid basePath/);
    expect(() => createToolExecutor({ basePath: "C:\\tmp" })).toThrow(/Invalid basePath/);
  });

  it("handles glob errors and missing globFn", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const tools = createToolExecutor({ basePath: "src" });

    await expect(tools.glob({ pattern: "" })).rejects.toThrow("glob: pattern is required");

    const result = await tools.glob({ pattern: "*.js" });
    expect(result.error).toBe("glob function not available");
    expect(result.total).toBe(0);
  });

  it("truncates glob results", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const globFn = vi.fn(async () => ["a.js", "b.js", "c.js"]);

    const tools = createToolExecutor({ basePath: "src", globFn, maxResults: 2 });
    const result = await tools.glob({ pattern: "*.js" });

    expect(result.files).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("returns no-files message from grep", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const globFn = vi.fn(async () => []);

    const tools = createToolExecutor({ basePath: "src", globFn });
    const result = await tools.grep({ pattern: "export", path: "src" });

    expect(result.matches).toEqual([]);
    expect(result.message).toBe("No files to search");
  });

  it("handles grep chunk errors", async () => {
    grepChunksMock.mockImplementation(() => {
      throw new Error("bad pattern");
    });

    const { createToolExecutor } = await import(INDEX_PATH);
    const globFn = vi.fn(async () => ["a.txt"]);
    const fs = {
      readFile: vi.fn(async () => "content"),
      stat: vi.fn(async () => ({ size: 10 })),
    };

    const tools = createToolExecutor({ basePath: "src", globFn, fs });
    const result = await tools.grep({ pattern: "(", path: "src", regex: true });

    expect(result.error).toMatch("bad pattern");
    expect(result.matches).toEqual([]);
  });

  it("validates read_file inputs and size limits", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const tools = createToolExecutor({ basePath: "src" });
    await expect(tools.read_file({ path: "" })).rejects.toThrow("read_file: path is required");
    await expect(tools.read_file({ path: "a.txt" })).rejects.toThrow("read_file: fs.readFile or vfs.readText is required");

    const fs = {
      readFile: vi.fn(async () => "content"),
      stat: vi.fn(async () => ({ size: 999 })),
    };
    const toolsTooLarge = createToolExecutor({ basePath: "src", fs, maxFileSize: 10 });
    await expect(toolsTooLarge.read_file({ path: "a.txt" })).rejects.toThrow("File too large");

    await expect(toolsTooLarge.read_file({ path: "../secret" })).rejects.toThrow("Invalid path");
  });

  it("truncates long lines and clamps ranges", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const fs = {
      readFile: vi.fn(async () => "longline\nshort"),
      stat: vi.fn(async () => ({ size: 10 })),
    };

    const tools = createToolExecutor({ basePath: "src", fs, maxLineLength: 3 });
    const result = await tools.read_file({ path: "a.txt", startLine: 0, endLine: Number.MAX_SAFE_INTEGER });

    expect(result.content).toContain("1│lon...");
    expect(result.range.start).toBe(1);
    expect(result.range.end).toBe(2);
  });

  it("supports concurrent read_file calls", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const files = {
      "src/a.txt": "a1",
      "src/b.txt": "b1",
    };
    const fs = {
      readFile: vi.fn(async (path) => files[path] || ""),
      stat: vi.fn(async (path) => ({ size: (files[path] || "").length })),
    };

    const tools = createToolExecutor({ basePath: "src", fs });
    const [a, b] = await Promise.all([
      tools.read_file({ path: "a.txt" }),
      tools.read_file({ path: "b.txt" }),
    ]);

    expect(a.content).toContain("1│a1");
    expect(b.content).toContain("1│b1");
  });

  it("handles write_file with missing vfs and size limits", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const toolsNoVfs = createToolExecutor({ basePath: "src" });
    const noVfs = await toolsNoVfs.write_file({ path: "a.txt", content: "x" });
    expect(noVfs.error).toMatch("vfs.writeText not available");

    const vfs = { writeText: vi.fn(async () => {}) };
    const toolsLarge = createToolExecutor({ basePath: "src", vfs, maxFileSize: 3 });
    const tooLarge = await toolsLarge.write_file({ path: "a.txt", content: "abcd" });
    expect(tooLarge.error).toMatch("Content too large");
  });

  it("writes files through policy helpers", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const vfs = { writeText: vi.fn(async () => {}) };

    const tools = createToolExecutor({ basePath: "src", vfs });
    const result = await tools.write_file({ path: "a.txt", content: "ok", checkpoint: false });

    expect(result.ok).toBe(true);
    expect(writeTextFileWithPolicyMock).toHaveBeenCalled();
  });

  it("handles multi_edit errors and normalizes edits", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const toolsNoVfs = createToolExecutor({ basePath: "src" });
    const noVfs = await toolsNoVfs.multi_edit({ path: "a.txt", edits: [] });
    expect(noVfs.error).toMatch("vfs.writeText not available");

    const vfs = { writeText: vi.fn(async () => {}) };
    const tools = createToolExecutor({ basePath: "src", vfs });
    const result = await tools.multi_edit({ path: "a.txt", edits: { bad: true } });

    expect(result.ok).toBe(true);
    expect(multiEditTextFileWithPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ edits: [] })
    );
  });

  it("lists directories with hidden filtering and sorting", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const fs = {
      readdir: vi.fn(async () => [
        { name: "b.txt", isDirectory: () => false },
        { name: ".hidden", isDirectory: () => false },
        { name: "a-dir", isDirectory: () => true },
      ]),
    };

    const tools = createToolExecutor({ basePath: "src", fs });
    const result = await tools.list_dir({ path: ".", showHidden: false });

    expect(result.entries.map((entry) => entry.name)).toEqual(["a-dir", "b.txt"]);

    const withHidden = await tools.list_dir({ path: ".", showHidden: true });
    expect(withHidden.entries.map((entry) => entry.name)).toEqual(["a-dir", ".hidden", "b.txt"]);
  });

  it("builds tree output and caps depth", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const vfs = {
      readdir: vi.fn(async (path) => {
        if (path === "src") {
          return [
            { name: "dir", isDirectory: () => true },
            { name: "file.js", isDirectory: () => false },
            { name: ".hidden", isDirectory: () => false },
          ];
        }
        if (path === "src/dir") {
          return [{ name: "deep.js", isDirectory: () => false }];
        }
        return [];
      }),
    };

    const tools = createToolExecutor({ basePath: "src", vfs });
    const shallow = await tools.tree({ path: ".", depth: 1 });

    expect(shallow.tree).toContain("dir");
    expect(shallow.tree).toContain("file.js");
    expect(shallow.tree).not.toContain(".hidden");
    expect(shallow.tree).not.toContain("deep.js");

    const deep = await tools.tree({ path: ".", depth: 10 });
    expect(deep.depth).toBe(5);
  });

  it("validates index_symbols inputs and limits", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const tools = createToolExecutor({ basePath: "src" });
    await expect(tools.index_symbols({ paths: [] })).rejects.toThrow("index_symbols: pattern or paths is required");

    const noGlob = await tools.index_symbols({ pattern: "*.js" });
    expect(noGlob.error).toBe("glob function not available");

    const limited = await tools.index_symbols({ paths: ["a.js", "b.js"], limit: "1" });
    expect(limited.total).toBe(1);
    expect(limited.truncated).toBe(true);
  });

  it("indexes symbols with force and handles oversized files", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    symbolIndexerExtractSymbolsMock.mockResolvedValue([{ name: "sym" }]);
    const vfs = { readText: vi.fn(async () => "content") };
    const fs = { stat: vi.fn(async () => ({ size: 2 })) };

    const tools = createToolExecutor({ basePath: "src", vfs, fs });
    const forced = await tools.index_symbols({ paths: ["a.js"], force: true, workspaceId: "ws1" });

    expect(forced.indexed).toBe(1);
    expect(forced.workspaceId).toBe("ws1");
    expect(computeSha256Mock).toHaveBeenCalled();
    expect(symbolIndexerStorePutMock).toHaveBeenCalledWith("ws1", expect.any(String), expect.any(Object));
    expect(symbolIndexerInvalidateCachesMock).toHaveBeenCalled();

    const fsLarge = { stat: vi.fn(async () => ({ size: 999 })) };
    const toolsLarge = createToolExecutor({ basePath: "src", fs: fsLarge, maxFileSize: 10 });
    const oversized = await toolsLarge.index_symbols({ paths: ["big.js"], limit: -1 });

    expect(oversized.failed).toBe(1);
    expect(oversized.files[0].error).toMatch("File too large");
  });

  it("validates find_symbol queries and truncates results", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);

    const tools = createToolExecutor({ basePath: "src", maxResults: 2 });
    await expect(tools.find_symbol({ query: " " })).rejects.toThrow("find_symbol: query is required");

    symbolIndexerQueryMock.mockResolvedValue([{ name: "a" }, { name: "b" }, { name: "c" }]);
    const result = await tools.find_symbol({ query: "a", pathPrefix: " src/ ", workspaceId: "ws2", limit: "2" });

    expect(result.workspaceId).toBe("ws2");
    expect(result.total).toBe(3);
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(symbolIndexerQueryMock).toHaveBeenCalledWith({ query: "a", pathPrefix: "src/", limit: "2" });
  });

  it("executes tools and records watchdog actions", async () => {
    const { createToolExecutor } = await import(INDEX_PATH);
    const watchdog = { recordAction: vi.fn() };
    const globFn = vi.fn(async () => []);

    const tools = createToolExecutor({ basePath: "src", globFn, watchdog });
    const unknown = await tools.execute("missing", {});

    expect(unknown.error).toMatch("Unknown tool");
    expect(watchdog.recordAction).not.toHaveBeenCalled();

    await tools.execute("glob", { pattern: "*.js" });
    expect(watchdog.recordAction).toHaveBeenCalledWith({ type: "glob", args: { pattern: "*.js" } });
  });
});

describe("formatToolDefinitionsForLLM", () => {
  it("formats definitions into markdown", async () => {
    const { formatToolDefinitionsForLLM } = await import(INDEX_PATH);
    const output = formatToolDefinitionsForLLM();

    expect(output).toContain("### glob");
    expect(output).toContain("read_file");
  });

  it("returns empty string for empty definitions", async () => {
    const { formatToolDefinitionsForLLM, TOOL_DEFINITIONS } = await import(INDEX_PATH);

    TOOL_DEFINITIONS.length = 0;
    const output = formatToolDefinitionsForLLM();
    expect(output).toBe("");
  });
});

describe("TOOL_DEFINITIONS", () => {
  it("contains unique tool names", async () => {
    const { TOOL_DEFINITIONS } = await import(INDEX_PATH);

    const names = TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has parameters and examples for each tool", async () => {
    const { TOOL_DEFINITIONS } = await import(INDEX_PATH);

    const allHaveFields = TOOL_DEFINITIONS.every((tool) => {
      return tool && typeof tool.name === "string" && tool.parameters && Array.isArray(tool.examples);
    });

    expect(allHaveFields).toBe(true);
  });
});

describe("CODESEARCH_SYSTEM_PROMPT", () => {
  it("is a non-empty string with tool placeholder", async () => {
    const { CODESEARCH_SYSTEM_PROMPT } = await import(INDEX_PATH);

    expect(typeof CODESEARCH_SYSTEM_PROMPT).toBe("string");
    expect(CODESEARCH_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
    expect(CODESEARCH_SYSTEM_PROMPT).toContain("{TOOLS}");
  });
});

describe("CODESEARCH_TODO_PLANNER_PROMPT", () => {
  it("includes query placeholder", async () => {
    const { CODESEARCH_TODO_PLANNER_PROMPT } = await import(INDEX_PATH);

    expect(typeof CODESEARCH_TODO_PLANNER_PROMPT).toBe("string");
    expect(CODESEARCH_TODO_PLANNER_PROMPT.trim().length).toBeGreaterThan(0);
    expect(CODESEARCH_TODO_PLANNER_PROMPT).toContain("{QUERY}");
  });
});

describe("CODESEARCH_STEP_PROMPT", () => {
  it("includes required placeholders", async () => {
    const { CODESEARCH_STEP_PROMPT } = await import(INDEX_PATH);

    expect(typeof CODESEARCH_STEP_PROMPT).toBe("string");
    expect(CODESEARCH_STEP_PROMPT).toContain("{QUERY}");
    expect(CODESEARCH_STEP_PROMPT).toContain("action");
  });
});

describe("CODESEARCH_SUMMARIZE_PROMPT", () => {
  it("includes mermaid section", async () => {
    const { CODESEARCH_SUMMARIZE_PROMPT } = await import(INDEX_PATH);

    expect(typeof CODESEARCH_SUMMARIZE_PROMPT).toBe("string");
    expect(CODESEARCH_SUMMARIZE_PROMPT).toContain("```mermaid");
  });
});

describe("PROMPTS", () => {
  it("exposes prompt presets", async () => {
    const { PROMPTS } = await import(INDEX_PATH);

    expect(PROMPTS).toHaveProperty("architecture");
    expect(PROMPTS.architecture.query).toBeTruthy();
    expect(Array.isArray(PROMPTS.architecture.focus)).toBe(true);
    expect(PROMPTS.architecture.focus.length).toBeGreaterThan(0);
    expect(PROMPTS.unknown).toBeUndefined();
  });
});

describe("CodeSearchPhase", () => {
  it("exposes frozen phase values", async () => {
    const { CodeSearchPhase } = await import(INDEX_PATH);

    expect(CodeSearchPhase.PLANNING).toBe("planning");
    expect(Object.isFrozen(CodeSearchPhase)).toBe(true);

    const original = CodeSearchPhase.PLANNING;
    try {
      CodeSearchPhase.PLANNING = "changed";
    } catch {
      // ignore
    }
    expect(CodeSearchPhase.PLANNING).toBe(original);
  });
});

describe("TodoStatus", () => {
  it("exposes frozen todo values", async () => {
    const { TodoStatus } = await import(INDEX_PATH);

    expect(TodoStatus.OPEN).toBe("open");
    expect(Object.isFrozen(TodoStatus)).toBe(true);

    const original = TodoStatus.OPEN;
    try {
      TodoStatus.OPEN = "changed";
    } catch {
      // ignore
    }
    expect(TodoStatus.OPEN).toBe(original);
  });
});

describe("isValidTodoStatus", () => {
  it("accepts valid statuses and rejects invalid ones", async () => {
    const { isValidTodoStatus, TodoStatus } = await import(INDEX_PATH);

    expect(isValidTodoStatus(TodoStatus.OPEN)).toBe(true);
    expect(isValidTodoStatus(TodoStatus.IN_PROGRESS)).toBe(true);

    const invalidValues = [null, undefined, "", " ", 0, -1, Number.MAX_SAFE_INTEGER, {}, [], "OPEN"];
    for (const value of invalidValues) {
      expect(isValidTodoStatus(value)).toBe(false);
    }
  });
});

describe("isValidCodeSearchPhase", () => {
  it("accepts valid phases and rejects invalid ones", async () => {
    const { isValidCodeSearchPhase, CodeSearchPhase } = await import(INDEX_PATH);

    expect(isValidCodeSearchPhase(CodeSearchPhase.PLANNING)).toBe(true);
    expect(isValidCodeSearchPhase(CodeSearchPhase.COMPLETED)).toBe(true);

    const invalidValues = [null, undefined, "", " ", 0, -1, Number.MAX_SAFE_INTEGER, {}, [], "planning " ];
    for (const value of invalidValues) {
      expect(isValidCodeSearchPhase(value)).toBe(false);
    }
  });
});
