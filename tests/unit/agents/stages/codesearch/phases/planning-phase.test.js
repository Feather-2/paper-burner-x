import { describe, it, expect, vi, beforeEach } from "vitest";

// buildSystemPrompt() depends on code-tools; mock it to keep this suite unit-scoped.
vi.mock("../../../../../../js/agents/stages/codesearch/code-tools.js", () => {
  return {
    formatToolDefinitionsForLLM: vi.fn(() => "MOCK_TOOL_DEFS"),
  };
});

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  };
});

import {
  runPlanningPhase,
  buildSystemPrompt,
  formatOpenTodos,
  isTodoOpen,
} from "../../../../../../js/agents/stages/codesearch/phases/planning-phase.js";
import { TodoStatus } from "../../../../../../js/agents/stages/codesearch/states.js";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPlanningPhase", () => {
  it("creates todos from fenced JSON, records usage, and emits events", async () => {
    const callModel = vi.fn(async () => ({
      content:
        "```json\n[{\"text\":\"List root\",\"priority\":\"high\",\"queryHints\":[\"tree\"],\"expectedEvidence\":\"layout\"}]\n```",
      usage: { input: 10, output: 20 },
    }));
    const budgetManager = { recordUsage: vi.fn() };
    const emit = vi.fn();
    const state = createStateStub({ query: "Q1" });

    const res = await runPlanningPhase({ state, callModel, budgetManager, emit, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].status).toBe(TodoStatus.OPEN);
    expect(budgetManager.recordUsage).toHaveBeenCalledWith({ input: 10, output: 20 });
    expect(emit).toHaveBeenCalledWith("codesearch:planning_started", { query: "Q1" });
    expect(emit).toHaveBeenCalledWith("codesearch:planning_completed", { todoCount: 1 });
    expect(state.addObservation).toHaveBeenCalledTimes(1);
    expect(callModel).toHaveBeenCalledTimes(1);
    const [messages] = callModel.mock.calls[0];
    expect(messages[1]).toEqual({ role: "user", content: "Q1" });
  });

  it("uses the default query when state query/taskGoal are empty", async () => {
    const callModel = vi.fn(async () => ({ content: "" }));
    const state = createStateStub({ query: "", taskGoal: undefined });

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
    const [messages] = callModel.mock.calls[0];
    expect(messages[1]).toEqual({ role: "user", content: "分析代码库" });
  });

  it("returns a failure when the model call throws", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("boom");
    });
    const emit = vi.fn();
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, emit, signal: null });

    expect(res.success).toBe(false);
    expect(res.error).toBe("boom");
    expect(emit).toHaveBeenCalledWith("codesearch:planning_failed", { error: "boom" });
    expect(state.addObservation).not.toHaveBeenCalled();
    expect(state.addTodo).not.toHaveBeenCalled();
  });

  it("reads prompt_tokens usage and supports { todos: [...] } responses", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ todos: [{ text: "B", priority: "low" }] }),
      usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0 },
    }));
    const budgetManager = { recordUsage: vi.fn() };
    const state = createStateStub({ query: "Q_obj_direct" });

    const res = await runPlanningPhase({ state, callModel, budgetManager, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(budgetManager.recordUsage).toHaveBeenCalledWith({
      input: Number.MAX_SAFE_INTEGER,
      output: 0,
    });
  });

  it("returns no_todos_generated when todos is an object instead of an array", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({ todos: { text: "A" } }),
    }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
    expect(state.addTodo).not.toHaveBeenCalled();
  });

  it("accepts legacy numeric-string priorities and normalizes them", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "A", priority: "1" }]),
    }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(1);
    expect(res.todos[0].priority).toBe("high");
  });

  it("rejects deep nested query hints", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "Nested", queryHints: ["ok", ["nested", ["deep"]]] }]),
    }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
  });

  it("rejects responses larger than the max response size", async () => {
    const callModel = vi.fn(async () => ({
      content: "x".repeat(12001),
    }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
  });

  it("rejects todo entries with overly long text", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "x".repeat(401) }]),
    }));
    const state = createStateStub();

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res).toEqual({ success: false, todos: [], error: "no_todos_generated" });
  });

  it("supports concurrent planning calls without shared state", async () => {
    const stateA = createStateStub({ query: "QA" });
    const stateB = createStateStub({ query: "QB" });
    const callModelA = vi.fn(async () => ({ content: JSON.stringify([{ text: "Todo A" }]) }));
    const callModelB = vi.fn(async () => ({ content: JSON.stringify([{ text: "Todo B" }]) }));

    const [resA, resB] = await Promise.all([
      runPlanningPhase({ state: stateA, callModel: callModelA, signal: null }),
      runPlanningPhase({ state: stateB, callModel: callModelB, signal: null }),
    ]);

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(stateA.todos).toHaveLength(1);
    expect(stateB.todos).toHaveLength(1);
  });

  it("supports rapid consecutive planning calls on the same state", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "Todo" }]),
    }));
    const state = createStateStub({ query: "Q_fast" });

    const res1 = await runPlanningPhase({ state, callModel, signal: null });
    const res2 = await runPlanningPhase({ state, callModel, signal: null });

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(state.todos).toHaveLength(2);
    expect(state.addObservation).toHaveBeenCalledTimes(2);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("supports injectable todoIdFactory and resolves collisions", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "A" }, { text: "B" }, { text: "C" }]),
    }));
    const state = createStateStub({ query: "Q_ids" });
    const factory = vi.fn(() => "fixed-id");

    const res = await runPlanningPhase({ state, callModel, signal: null, todoIdFactory: factory });

    expect(res.success).toBe(true);
    expect(res.todos).toHaveLength(3);
    expect(new Set(res.todos.map((todo) => todo.todoId)).size).toBe(3);
    expect(factory).toHaveBeenCalled();
    expect(res.todos.some((todo) => todo.todoId === "fixed-id")).toBe(true);
  });

  it("uses state.createTodoId when provided", async () => {
    const callModel = vi.fn(async () => ({
      content: JSON.stringify([{ text: "A" }]),
    }));
    const createTodoId = vi.fn(() => "state-id");
    const state = createStateStub({ createTodoId });

    const res = await runPlanningPhase({ state, callModel, signal: null });

    expect(res.success).toBe(true);
    expect(res.todos[0].todoId).toBe("state-id");
    expect(createTodoId).toHaveBeenCalled();
  });
});

describe("buildSystemPrompt", () => {
  it("injects tool definitions into the system prompt", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("MOCK_TOOL_DEFS");
    expect(prompt).not.toContain("{TOOLS}");
  });
});

describe("formatOpenTodos", () => {
  it("returns (无) for nullish, empty, or closed inputs", () => {
    expect(formatOpenTodos(null)).toBe("(无)");
    expect(formatOpenTodos(undefined)).toBe("(无)");
    expect(formatOpenTodos([])).toBe("(无)");
    expect(formatOpenTodos({})).toBe("(无)");
    expect(
      formatOpenTodos([
        { todoId: "t1", text: "A", status: "completed" },
        { todoId: "t2", text: "B", status: "cancelled" },
      ])
    ).toBe("(无)");
  });

  it("formats open todos with hints, defaults, and fallbacks", () => {
    const text = formatOpenTodos([
      {
        todoId: "t1",
        text: "A",
        status: "open",
        priority: "high",
        queryHints: ["h1", "h2", "h3", "h4", "h5", "h6", "h7"],
      },
      { status: "open", title: "Title fallback", priority: "   " },
      { todoId: "t3", text: "C", status: "cancelled" },
    ]);

    expect(text).toContain("1. [t1] (high) A");
    expect(text).toContain("h1");
    expect(text).toContain("h6");
    expect(text).not.toContain("h7");
    expect(text).toContain("2. [todo_2] (medium) Title fallback");
    expect(text).not.toContain("[t3]");
  });

  it("stringifies numeric values and handles whitespace text", () => {
    const text = formatOpenTodos([
      { todoId: 0, text: "Zero id", priority: -1, status: "open" },
      {
        todoId: Number.MAX_SAFE_INTEGER,
        text: "   ",
        name: "Name fallback",
        priority: "   ",
        status: "open",
      },
    ]);

    expect(text).toContain("[0]");
    expect(text).toContain("(-1)");
    expect(text).toContain(`[${Number.MAX_SAFE_INTEGER}]`);
    expect(text).toContain("(medium)");
    expect(text).toContain("Name fallback");
  });
});

describe("isTodoOpen", () => {
  it("treats missing or whitespace status as open", () => {
    expect(isTodoOpen()).toBe(true);
    expect(isTodoOpen(null)).toBe(true);
    expect(isTodoOpen(undefined)).toBe(true);
    expect(isTodoOpen({})).toBe(true);
    expect(isTodoOpen({ status: "" })).toBe(true);
    expect(isTodoOpen({ status: "   " })).toBe(true);
  });

  it("is case-insensitive for completed/cancelled", () => {
    expect(isTodoOpen({ status: "OPEN" })).toBe(true);
    expect(isTodoOpen({ status: "completed" })).toBe(false);
    expect(isTodoOpen({ status: "CANCELLED" })).toBe(false);
  });
});
