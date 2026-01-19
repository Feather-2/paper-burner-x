import { describe, it, expect, vi, beforeEach } from "vitest";

// buildSystemPrompt() depends on code-tools; mock it to keep this suite unit-scoped.
vi.mock("../../../../js/agents/stages/codesearch/code-tools.js", () => {
  return {
    formatToolDefinitionsForLLM: vi.fn(() => "MOCK_TOOL_DEFS"),
  };
});

import {
  runPlanningPhase,
  buildSystemPrompt,
  formatOpenTodos,
  isTodoOpen,
} from '../../../../../../js/agents/stages/codesearch/phases/planning-phase.js';
import { TodoStatus } from '../../../../../../js/agents/stages/codesearch/states.js';

function createStateStub(overrides = {}) {
  const state = {
    query: "Inspect repo",
    taskGoal: "Inspect repo",
    todos: [],
    addTodo: vi.fn((todo) => {
      state.todos.push(todo);
      return todo;
    }),
    addObservation: vi.fn(),
    ...overrides,
  };
  return state;
}

describe("codesearch/phases/planning-phase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runPlanningPhase creates todos from fenced JSON and records budget usage", async () => {
    const callModel = vi.fn(async () => {
      return {
        content: "```json\n[{\"text\":\"List root\",\"priority\":\"high\",\"queryHints\":[\"tree\"],\"expectedEvidence\":\"layout\"}]\n```",
        usage: { input: 10, output: 20 },
      };
    });

    const budgetManager = { recordUsage: vi.fn() };
    const emit = vi.fn();
    const state = createStateStub({ query: "Q1" });

    const res = await runPlanningPhase({ state, callModel, budgetManager, emit, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(state.addTodo).toHaveBeenCalledTimes(1);
    expect(state.todos[0].status).toBe(TodoStatus.OPEN);

    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 10, output: 20 });
    expect(emit).toHaveBeenCalledWith("codesearch.planning.started", { query: "Q1" });
    expect(emit).toHaveBeenCalledWith("codesearch.planning.completed", { todoCount: 1 });
    expect(state.addObservation).toHaveBeenCalledTimes(1);
  });

  it("runPlanningPhase supports fenced JSON object with { todos: [...] }", async () => {
    const callModel = vi.fn(async () => {
      return {
        content: "```json\n{\"todos\":[{\"text\":\"A\"}]}\n```",
      };
    });
    const state = createStateStub({ query: "Q_obj_fenced" });

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(res.todos[0].text).toBe("A");
  });

  it("runPlanningPhase supports direct JSON object with { todos: [...] } and reads prompt_tokens usage", async () => {
    const callModel = vi.fn(async () => {
      return {
        content: JSON.stringify({ todos: [{ text: "B", priority: "low" }] }),
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      };
    });
    const budgetManager = { recordUsage: vi.fn() };
    const state = createStateStub({ query: "Q_obj_direct" });

    const res = await runPlanningPhase({ state, callModel, budgetManager, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(res.todos[0].text).toBe("B");
    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 3, output: 4 });
  });

  it("runPlanningPhase returns no_todos_generated when response is not parseable", async () => {
    const callModel = vi.fn(async () => ({ content: "not json" }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
    expect(state.addTodo).not.toHaveBeenCalled();
  });

  it("runPlanningPhase returns all_todos_invalid when todos parse but are invalid objects", async () => {
    const callModel = vi.fn(async () => ({ content: JSON.stringify([{ title: "" }, { nope: true }]) }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res.success).toBe(false);
    expect(res.error).toBe("all_todos_invalid");
    expect(state.addTodo).not.toHaveBeenCalled();
  });

  it("runPlanningPhase accepts string todos and non-standard fields (todo/title)", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify(["String todo", { todo: "From todo field" }, { title: "From title field" }]),
    }));
    const state = createStateStub({ query: "Q_strings" });

    const res = await runPlanningPhase({ state, callModel, emit: vi.fn(), signal: null });

    expect(res.success).toBe(true);
    expect(res.todos.length).toBeGreaterThanOrEqual(1);
    expect(state.todos.map((t) => t.text)).toEqual(expect.arrayContaining(["String todo", "From todo field", "From title field"]));
  });

  it("buildSystemPrompt injects tool definitions", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("MOCK_TOOL_DEFS");
    expect(prompt).not.toContain("{TOOLS}");
  });

  it("formatOpenTodos filters non-open todos and includes hints/priority/id", () => {
    const text = formatOpenTodos([
      { todoId: "t1", text: "A", status: "open", priority: "high", queryHints: ["x", "y"] },
      { todoId: "t2", text: "B", status: "completed", priority: "low" },
      { todoId: "t3", text: "C", status: "cancelled", priority: "low" },
    ]);
    expect(text).toContain("[t1]");
    expect(text).toContain("(high)");
    expect(text).toContain("hints:");
    expect(text).not.toContain("[t2]");
    expect(text).not.toContain("[t3]");
  });

  it("formatOpenTodos returns (无) when no open todos exist", () => {
    expect(formatOpenTodos([])).toBe("(无)");
    expect(
      formatOpenTodos([
        { todoId: "t1", text: "A", status: "completed" },
        { todoId: "t2", text: "B", status: "cancelled" },
      ])
    ).toBe("(无)");
  });

  it("isTodoOpen treats missing/unknown status as open and is case-insensitive", () => {
    expect(isTodoOpen({ status: undefined })).toBe(true);
    expect(isTodoOpen({ status: "OPEN" })).toBe(true);
    expect(isTodoOpen({ status: "completed" })).toBe(false);
    expect(isTodoOpen({ status: "CANCELLED" })).toBe(false);
  });
});
