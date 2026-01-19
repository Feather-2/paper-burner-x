import { describe, it, expect, vi, beforeEach } from "vitest";

import { runExecutionStep } from "../../../../js/agents/stages/codesearch/phases/execution-phase.js";
import { TodoStatus } from "../../../../js/agents/stages/codesearch/states.js";

function createState({ todos = [], observations = [] } = {}) {
  const state = {
    query: "Inspect repo",
    todos,
    observations,
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

describe("codesearch/phases/execution-phase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns done when there are no open todos", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.COMPLETED }] });
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

  it("records budget usage when provided by model response", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ done: true, thought: "ok" }),
      usage: { input: 2, output: 3 },
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

    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 2, output: 3 });
  });

  it("adds an observation and returns parse_failed when decision is not parseable", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({ content: "unparseable response" }));

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
    expect(res.watchdogOutput).toContain("parse_failed");
    expect(state.addObservation).toHaveBeenCalled();
  });

  it("handles done decision and can complete selected todo", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ done: true, completeTodo: true, thought: "All good" }),
    }));

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      emit: vi.fn(),
      signal: null,
    });

    expect(res.done).toBe(true);
    expect(res.reason).toBe("llm_done");
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED });
    expect(state.finalThought).toBe("All good");
    expect(res.watchdogOutput).toContain("done=true");
  });

  it("treats 'analysis complete' as done even when response isn't JSON", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({ content: "Analysis complete." }));

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools: { execute: vi.fn() },
      signal: null,
    });

    expect(res.done).toBe(true);
    expect(res.reason).toBe("llm_done");
    expect(state.finalThought).toBe("Analysis complete.");
  });

  it("parses action/args from non-JSON text and executes tool, updating todo status", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: 'some text "action": "list_dir", "args": {"path":"."} trailing',
    }));
    const tools = {
      execute: vi.fn(async () => ({ path: ".", entries: [{ type: "file", name: "a.txt" }], total: 1 })),
    };

    const res = await runExecutionStep({
      state,
      step: 2,
      maxSteps: 3,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(tools.execute).toHaveBeenCalledWith("list_dir", { path: "." });
    // open -> pending transition happens before tool execution.
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.PENDING });
    expect(state.addStep).toHaveBeenCalledWith(expect.objectContaining({ tool: "list_dir", todoId: "t1" }));
    expect(res.watchdogOutput).toContain("action=list_dir");
  });

  it("parses fenced JSON decisions and formats read_file results (watchdog summary included)", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: "```json\n{\"action\":\"read_file\",\"args\":{\"path\":\"a.txt\",\"startLine\":1,\"endLine\":2}}\n```",
    }));
    const tools = {
      execute: vi.fn(async () => ({
        path: "a.txt",
        range: { start: 1, end: 2 },
        totalLines: 10,
        content: "hi",
      })),
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
    expect(state.observations.join("\n")).toContain("[read_file: a.txt] (lines 1-2 of 10)");
    expect(res.watchdogOutput).toContain("result=read_file:a.txt:1-2/10");
  });

  it("captures single-tool execution errors and returns watchdog summary", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ action: "read_file", args: { path: "a.txt", startLine: 1, endLine: 2 } }),
    }));
    const tools = { execute: vi.fn(async () => { throw new Error("boom"); }) };

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
    expect(res.watchdogOutput).toContain("result=error:boom");
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("[read_file] Error: boom"));
  });

  it("updates todo status to CANCELLED when requested", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
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

  it("supports batch actions and captures tool errors", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        actions: [
          { action: "grep", args: { pattern: "x" } },
          { action: "read_file", args: { path: "a.txt", startLine: 1, endLine: 2 } },
        ],
        todoId: "t1",
        todoStatus: "completed",
      }),
    }));
    const tools = {
      execute: vi.fn(async (name) => {
        if (name === "grep") return { total: 1, matches: [{ file: "a.txt", matchCount: 1 }] };
        throw new Error("boom");
      }),
    };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 5,
      systemPrompt: "SYS",
      callModel,
      tools,
      emit: vi.fn(),
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Batch (2 tools)"));
    expect(state.addStep).toHaveBeenCalledWith(expect.objectContaining({ tool: "batch" }));
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED });
    expect(res.watchdogOutput).toContain("action=batch");
    expect(res.watchdogOutput).toContain("grep:ok");
    expect(res.watchdogOutput).toContain("read_file:err");
  });

  it("batch actions can cancel the selected todo", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        actions: [{ action: "glob", args: { pattern: "*.js" } }],
        todoId: "t1",
        todoStatus: "cancelled",
      }),
    }));
    const tools = { execute: vi.fn(async () => ({ total: 0, files: [] })) };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 5,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.CANCELLED });
  });

  it("single-tool decisions can complete the selected todo", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ action: "grep", args: { pattern: "x" }, todoId: "t1", todoStatus: "completed" }),
    }));
    const tools = { execute: vi.fn(async () => ({ total: 1, matches: [{ file: "a.js", matchCount: 1 }] })) };

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
    expect(state.updateTodo).toHaveBeenCalledWith("t1", { status: TodoStatus.COMPLETED });
  });

  it("batch actions tolerate items without tool name", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        actions: [{ args: { a: 1 } }, { tool: "glob", args: { pattern: "*.js" } }],
        todoId: "t1",
      }),
    }));
    const tools = { execute: vi.fn(async () => ({ total: 0, files: [] })) };

    const res = await runExecutionStep({
      state,
      step: 1,
      maxSteps: 5,
      systemPrompt: "SYS",
      callModel,
      tools,
      signal: null,
    });

    expect(res.done).toBe(false);
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("missing tool name"));
    expect(tools.execute).toHaveBeenCalledWith("glob", { pattern: "*.js" });
  });

  it("formats tool results for common tools (glob/grep/find_symbol/default)", async () => {
    const cases = [
      {
        action: "glob",
        result: { total: 2, files: ["a.js", "b.js"], truncated: false },
        expectText: "[glob] Found 2 files:",
      },
      {
        action: "grep",
        result: { total: 1, matches: [{ file: "a.js", matchCount: 1 }] },
        expectText: "[grep] Found 1 matches:",
      },
      {
        action: "find_symbol",
        result: { total: 1, matches: [{ name: "Foo", kind: "function", file: "a.js", startLine: 3 }] },
        expectText: "[find_symbol] Found 1 matches:",
      },
      {
        action: "custom_tool",
        result: { ok: true, value: 1 },
        expectText: "[custom_tool]",
      },
    ];

    for (const c of cases) {
      const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
      const callModel = vi.fn(async () => ({ content: JSON.stringify({ action: c.action, args: {} }) }));
      const tools = { execute: vi.fn(async () => c.result) };

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
      expect(state.observations.join("\n")).toContain(c.expectText);
    }
  });

  it("returns missing_action when decision has neither action nor actions", async () => {
    const state = createState({ todos: [{ todoId: "t1", text: "x", status: TodoStatus.OPEN }] });
    const callModel = vi.fn(async () => ({ content: JSON.stringify({ thought: "hmm" }) }));

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
    expect(res.error).toBe("missing_action");
    expect(state.addObservation).toHaveBeenCalledWith(expect.stringContaining("Missing tool action"));
  });
});
