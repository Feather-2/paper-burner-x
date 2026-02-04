import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));
const createLoggerMock = vi.hoisted(() => vi.fn(() => loggerMock));
const checkCancelledMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    createLogger: createLoggerMock,
    checkCancelled: checkCancelledMock,
  };
});

vi.mock("../../../../../../js/agents/stages/codesearch/phases/planning-phase.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    formatOpenTodos: vi.fn(actual.formatOpenTodos),
    isTodoOpen: vi.fn(actual.isTodoOpen),
  };
});

vi.mock("../../../../../../js/agents/stages/codesearch/prompts.js", () => ({
  CODESEARCH_STEP_PROMPT: "Q:{QUERY}|S:{STEP}|M:{MAX_STEPS}|O:{OPEN_TODOS}|Obs:{OBSERVATIONS}",
}));

import { runExecutionStep } from "../../../../../../js/agents/stages/codesearch/phases/execution-phase.js";
import { TodoStatus } from "../../../../../../js/agents/stages/codesearch/states.js";
import { formatOpenTodos } from "../../../../../../js/agents/stages/codesearch/phases/planning-phase.js";

function createState({ todos = [], observations = [] } = {}) {
  const state = {
    query: "Inspect repo",
    todos: [...todos],
    observations: [...observations],
    steps: [],
    finalThought: null,
    addObservation: vi.fn((text) => {
      state.observations.push(text);
    }),
    addStep: vi.fn((step) => {
      state.steps.push(step);
      return step;
    }),
    updateTodo: vi.fn((todoId, updates) => {
      const idx = state.todos.findIndex((t) => t.todoId === todoId);
      if (idx >= 0) state.todos[idx] = { ...state.todos[idx], ...updates };
      return state.todos[idx] ?? null;
    }),
  };
  return state;
}

function makeTodo(todoId = "t1", status = TodoStatus.OPEN, text = "todo") {
  return { todoId, text, status };
}

describe("runExecutionStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkCancelledMock.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns done when there are no open todos (empty array)", async () => {
    const state = createState({ todos: [] });
    const callModel = vi.fn();

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    expect(res).toEqual({ done: true, reason: "no_open_todos" });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("throws when cancellation is detected before running", async () => {
    const state = createState({ todos: [makeTodo()] });
    checkCancelledMock.mockImplementationOnce(() => {
      throw new Error("cancelled");
    });

    await expect(
      runExecutionStep({
        state,
        step: 1,
        maxSteps: 3,
        systemPrompt: "SYS",
        callModel: vi.fn(),
        tools: { execute: vi.fn() },
        signal: { aborted: true },
      })
    ).rejects.toThrow("cancelled");
  });

  it("records budget usage and builds prompt content for the model", async () => {
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ done: true, thought: "ok" }),
      usage: { prompt_tokens: 4, completion_tokens: 6 },
    }));
    const budgetManager = { recordUsage: vi.fn() };

    await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      budgetManager,
      signal: null,
    });

    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 4, output: 6 });
    expect(callModel).toHaveBeenCalledTimes(1);
    const [messages] = callModel.mock.calls[0];
    const expectedOpenTodos = formatOpenTodos(state.todos);
    expect(messages[1].content).toContain("Q:Inspect repo");
    expect(messages[1].content).toContain("S:1");
    expect(messages[1].content).toContain("M:3");
    expect(messages[1].content).toContain(`O:${expectedOpenTodos}`);
    expect(messages[1].content).toContain("Obs:");
  });

  it("returns model_error when callModel rejects", async () => {
    const state = createState({ todos: [makeTodo()] });
    const callModel = vi.fn(async () => {
      throw new Error("boom");
    });

    const res = await runExecutionStep({
      state,
      step: 2,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(res.error).toBe("model_error");
    expect(res.watchdogOutput).toContain("model_error");
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Model error: boom"));
  });

  it("returns model_timeout when callModel exceeds the timeout", async () => {
    vi.useFakeTimers();
    const state = createState({ todos: [makeTodo()] });
    const callModel = vi.fn(() => new Promise(() => {}));

    const promise = runExecutionStep({
      state,
      step: 3,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    vi.advanceTimersByTime(30000);
    await Promise.resolve();
    const res = await promise;

    expect(res.done).toBe(false);
    expect(res.error).toBe("model_timeout");
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Model error"));
  });

  it.each([
    ["null content", { content: null }],
    ["undefined content", { content: undefined }],
    ["empty string", { content: "" }],
    ["whitespace string", { content: "   " }],
    ["empty object response", {}],
    ["too long response", { content: "x".repeat(12001) }],
  ])("returns parse_failed for invalid response: %s", async (_label, response) => {
    const state = createState({ todos: [makeTodo()] });
    const callModel = vi.fn(async () => response);

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(res.error).toBe("parse_failed");
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Failed to parse LLM response"));
  });

  it.each([
    [
      "string used for number",
      JSON.stringify({
        action: "read_file",
        args: { path: "a.txt", startLine: "1", endLine: 2 },
      }),
    ],
    [
      "object used for edits array",
      JSON.stringify({
        action: "multi_edit",
        args: { path: "a.txt", edits: { old_string: "a", new_string: "b" } },
      }),
    ],
    [
      "deeply nested newTodos",
      JSON.stringify({
        action: "list_dir",
        args: { path: "." },
        newTodos: [{ text: "todo", queryHints: [["deep"]] }],
      }),
    ],
    [
      "oversized tool argument string",
      JSON.stringify({
        action: "list_dir",
        args: { path: "a".repeat(2001) },
      }),
    ],
  ])("returns parse_failed for invalid decision payload: %s", async (_label, content) => {
    const state = createState({ todos: [makeTodo()] });
    const callModel = vi.fn(async () => ({ content }));

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(res.error).toBe("parse_failed");
  });

  it("handles done decisions and selects the first open todo when todoId is missing", async () => {
    const state = createState({ todos: [makeTodo("t1"), makeTodo("t2")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ done: true, completeTodo: true, todoId: "missing", thought: "all good" }),
    }));
    const emit = vi.fn();

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      emit,
      signal: null,
    });

    expect(res.done).toBe(true);
    expect(res.reason).toBe("llm_done");
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED });
    expect(state.finalThought).toBe("all good");
    expect(emit).toHaveBeenCalledWith("codesearch:step_completed", { step: 1, action: "done" });
    expect(res.watchdogOutput).toContain("done=true");
  });

  it("executes a single tool, clamps summary values, and handles large content", async () => {
    const bigContent = "x".repeat(50000);
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        action: "read_file",
        args: { path: "big.txt", startLine: 0, endLine: 1 },
        todoId: "t1",
        todoStatus: "completed",
      }),
    }));
    const tools = {
      execute: vi.fn(async () => ({
        path: "big.txt",
        range: { start: -1, end: 0 },
        totalLines: Number.MAX_SAFE_INTEGER,
        content: bigContent,
      })),
    };

    const res = await runExecutionStep({
      state,
      step: 0,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(tools.execute).toHaveBeenCalledWith("read_file", { path: "big.txt", startLine: 0, endLine: 1 });
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.PENDING });
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED });
    expect(state.addObservation).toHaveBeenCalled();
    expect(state.observations[0]).toContain("[read_file: big.txt]");
    expect(state.observations[0].length).toBeGreaterThan(1000);
    expect(state.addStep).toHaveBeenCalledWith(expect.objectContaining({ tool: "read_file", todoId: "t1" }));
    expect(res.watchdogOutput).toContain("step=0");
    expect(res.watchdogOutput).toContain("result=read_file:big.txt:0-0/9007199254740991");
  });

  it("updates todo status to cancelled on single-tool decisions", async () => {
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ action: "tree", args: { path: "." }, todoId: "t1", todoStatus: "cancelled" }),
    }));
    const tools = { execute: vi.fn(async () => ({ tree: ".", stats: { files: 0, dirs: 0 } })) };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.CANCELLED });
  });

  it("captures tool execution errors and reports them in observations", async () => {
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ action: "grep", args: { pattern: "x" } }),
    }));
    const tools = {
      execute: vi.fn(async () => {
        throw new Error("boom");
      }),
    };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("[grep] Error: boom"));
    expect(res.watchdogOutput).toContain("error:boom");
  });

  it("times out tool execution and returns error summary", async () => {
    vi.useFakeTimers();
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ action: "list_dir", args: { path: "." } }),
    }));
    const tools = { execute: vi.fn(() => new Promise(() => {})) };

    const promise = runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    // Allow runExecutionStep() to advance past the callModel await and start the tool execution
    // (which is when the tool timeout timer is scheduled).
    for (let i = 0; i < 5 && tools.execute.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(tools.execute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    const res = await promise;

    expect(res.done).toBe(false);
    expect(res.watchdogOutput).toContain("timed out after 30000ms");
    expect(state.observations[0]).toContain("Error: tool:list_dir timed out after 30000ms");
  });

  it("executes batch actions and reports mixed results", async () => {
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        actions: [
          { action: "glob", args: { pattern: "*.js" } },
          { action: "read_file", args: { path: "a.txt", startLine: 1, endLine: 1 } },
        ],
        todoId: "t1",
        todoStatus: "cancelled",
      }),
    }));
    const tools = {
      execute: vi.fn(async (name) => {
        if (name === "glob") return { total: 2, files: ["a.js", "b.js"] };
        throw new Error("boom");
      }),
    };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Batch (2 tools)"));
    expect(state.addStep).toHaveBeenCalledWith(expect.objectContaining({ tool: "batch" }));
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.PENDING });
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.CANCELLED });
    expect(res.watchdogOutput).toContain("action=batch");
    expect(res.watchdogOutput).toContain("glob:ok:glob:2");
    expect(res.watchdogOutput).toContain("read_file:err:error:boom");
  });

  it("supports concurrent execution on independent states", async () => {
    const stateA = createState({ todos: [makeTodo("a1")] });
    const stateB = createState({ todos: [makeTodo("b1")] });
    const callModelA = vi.fn(async () => ({ content: JSON.stringify({ done: true, thought: "doneA" }) }));
    const callModelB = vi.fn(async () => ({ content: JSON.stringify({ done: true, thought: "doneB" }) }));

    const [resA, resB] = await Promise.all([
      runExecutionStep({
        state: stateA,
        step: 1,
        maxSteps: 2,
        systemPrompt: "SYS",
        callModel: callModelA,
        tools: { execute: vi.fn() },
        signal: null,
      }),
      runExecutionStep({
        state: stateB,
        step: 1,
        maxSteps: 2,
        systemPrompt: "SYS",
        callModel: callModelB,
        tools: { execute: vi.fn() },
        signal: null,
      }),
    ]);

    expect(resA.done).toBe(true);
    expect(resB.done).toBe(true);
    expect(stateA.finalThought).toBe("doneA");
    expect(stateB.finalThought).toBe("doneB");
    expect(callModelA).toHaveBeenCalledTimes(1);
    expect(callModelB).toHaveBeenCalledTimes(1);
  });

  it("handles rapid consecutive calls on the same state", async () => {
    const state = createState({ todos: [makeTodo("t1")] });
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: JSON.stringify({ action: "list_dir", args: { path: "." } }) })
      .mockResolvedValueOnce({
        content: JSON.stringify({ action: "read_file", args: { path: "a.txt", startLine: 1, endLine: 1 } }),
      });
    const tools = {
      execute: vi.fn(async (name) => {
        if (name === "list_dir") return { path: ".", entries: [] };
        return { path: "a.txt", range: { start: 1, end: 1 }, totalLines: 2, content: "hi" };
      }),
    };

    const res1 = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });
    const res2 = await runExecutionStep({
      state,
      step: 2,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res1.done).toBe(false);
    expect(res2.done).toBe(false);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(state.steps).toHaveLength(2);
    expect(state.observations).toHaveLength(2);
  });
});
