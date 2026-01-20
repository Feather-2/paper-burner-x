import { describe, it, expect, vi, beforeEach } from "vitest";

const stateUtilsMocks = vi.hoisted(() => ({
  ensureTokenUsage: vi.fn(),
  normalizeBudgetConfig: vi.fn(),
}));

const usageMocks = vi.hoisted(() => ({
  normalizeTokenUsage: vi.fn(),
}));

const checkpointMocks = vi.hoisted(() => ({
  cloneValue: vi.fn(),
}));

const todoUtilsMocks = vi.hoisted(() => ({
  createTodo: vi.fn(),
  transitionTodoStatus: vi.fn(),
}));

const stateLogicMocks = vi.hoisted(() => ({
  addTodo: vi.fn(),
  setAwaitUserFeedback: vi.fn(),
  setTaskImpossible: vi.fn(),
  addTimeline: vi.fn(),
  saveWriteSnapshot: vi.fn(),
  reopenGaps: vi.fn(),
  addNewGaps: vi.fn(),
}));

const memoryMocks = vi.hoisted(() => ({
  L0_ADD_TODO: "L0/ADD_TODO",
  L0_UPDATE_TODO: "L0/UPDATE_TODO",
  L0_REMOVE_TODO: "L0/REMOVE_TODO",
  L0_REPLACE_TODOS: "L0/REPLACE_TODOS",
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/state-utils.js", () => ({
  ensureTokenUsage: stateUtilsMocks.ensureTokenUsage,
  normalizeBudgetConfig: stateUtilsMocks.normalizeBudgetConfig,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/model/usage.js", () => ({
  normalizeTokenUsage: usageMocks.normalizeTokenUsage,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/internal/checkpoint.js", () => ({
  cloneValue: checkpointMocks.cloneValue,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  createTodo: todoUtilsMocks.createTodo,
  transitionTodoStatus: todoUtilsMocks.transitionTodoStatus,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/state-logic.js", () => ({
  addTodo: stateLogicMocks.addTodo,
  setAwaitUserFeedback: stateLogicMocks.setAwaitUserFeedback,
  setTaskImpossible: stateLogicMocks.setTaskImpossible,
  addTimeline: stateLogicMocks.addTimeline,
  saveWriteSnapshot: stateLogicMocks.saveWriteSnapshot,
  reopenGaps: stateLogicMocks.reopenGaps,
  addNewGaps: stateLogicMocks.addNewGaps,
}));

vi.mock("../../../../../../js/agents/plugins/memory/index.js", () => ({
  L0_ADD_TODO: memoryMocks.L0_ADD_TODO,
  L0_UPDATE_TODO: memoryMocks.L0_UPDATE_TODO,
  L0_REMOVE_TODO: memoryMocks.L0_REMOVE_TODO,
  L0_REPLACE_TODOS: memoryMocks.L0_REPLACE_TODOS,
}));

import { stateMethods } from "../../../../../../js/agents/stages/deepsearch/state/state-methods.js";

beforeEach(() => {
  stateUtilsMocks.ensureTokenUsage.mockReset();
  stateUtilsMocks.normalizeBudgetConfig.mockReset();
  usageMocks.normalizeTokenUsage.mockReset();
  checkpointMocks.cloneValue.mockReset();
  todoUtilsMocks.createTodo.mockReset();
  todoUtilsMocks.transitionTodoStatus.mockReset();
  stateLogicMocks.addTodo.mockReset();
  stateLogicMocks.setAwaitUserFeedback.mockReset();
  stateLogicMocks.setTaskImpossible.mockReset();
  stateLogicMocks.addTimeline.mockReset();
  stateLogicMocks.saveWriteSnapshot.mockReset();
  stateLogicMocks.reopenGaps.mockReset();
  stateLogicMocks.addNewGaps.mockReset();

  stateUtilsMocks.ensureTokenUsage.mockImplementation((value) => {
    if (value && typeof value === "object") return value;
    return { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
  });
  stateUtilsMocks.normalizeBudgetConfig.mockImplementation((budget) => ({ normalized: true, budget }));
  usageMocks.normalizeTokenUsage.mockReturnValue({ input: 1, output: 2, total: 3 });
  checkpointMocks.cloneValue.mockImplementation((value) => JSON.parse(JSON.stringify(value)));
  todoUtilsMocks.createTodo.mockImplementation((params = {}) => ({
    todoId: params.todoId || params.id || "todo_1",
    text: params.text ?? params.content ?? params.title ?? "",
    status: params.status ?? "pending",
    priority: params.priority ?? "medium",
  }));
  todoUtilsMocks.transitionTodoStatus.mockImplementation((todo, status) => {
    if (todo && status !== undefined) todo.status = status;
  });
  stateLogicMocks.addTodo.mockImplementation((_state, params) => ({ fromLogic: true, params }));
  stateLogicMocks.setAwaitUserFeedback.mockImplementation((_state, value, reason) => ({ value, reason }));
  stateLogicMocks.setTaskImpossible.mockImplementation((_state, reason) => ({ reason }));
  stateLogicMocks.addTimeline.mockImplementation((_state, payload) => ({ payload }));
  stateLogicMocks.saveWriteSnapshot.mockImplementation((_state, payload) => ({ payload }));
  stateLogicMocks.reopenGaps.mockImplementation((_state, gapIds, options, emit) => ({ gapIds, options, emit }));
  stateLogicMocks.addNewGaps.mockImplementation((_state, newGaps, options, emit) => ({ newGaps, options, emit }));
});

describe("stateMethods.addTokenUsage", () => {
  it("returns default usage when delta is null and state is empty", () => {
    usageMocks.normalizeTokenUsage.mockReturnValueOnce(null);
    const state = {};
    const result = stateMethods.addTokenUsage.call(state, undefined);
    expect(result).toEqual({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });
    expect(state.L2).toBeUndefined();
  });

  it("returns existing token usage when delta is null", () => {
    usageMocks.normalizeTokenUsage.mockReturnValueOnce(null);
    const existing = { input: 0, output: 1, total: 1, estimatedCostUSD: 0 };
    const state = { L2: { tokenUsage: existing } };
    const result = stateMethods.addTokenUsage.call(state, {});
    expect(result).toBe(existing);
  });

  it("initializes L2 and accumulates values with string numbers and cost clamp", () => {
    const state = {
      L2: {
        tokenUsage: { input: "2.9", output: "1", total: "4.1", estimatedCostUSD: "1.5" },
      },
    };
    const result = stateMethods.addTokenUsage.call(state, { estimatedCostUSD: "-1" });
    expect(result).toEqual({ input: 3, output: 3, total: 7, estimatedCostUSD: 1.5 });
    expect(state.L2.awaitUserFeedback).toBe(false);
    expect(state.L2.taskImpossible).toBe(false);
    expect(state.L2.reason).toBe("");
  });

  it("handles rapid consecutive calls and string cost values at numeric boundaries", async () => {
    usageMocks.normalizeTokenUsage.mockReturnValue({ input: 1, output: 0, total: 1 });
    const state = {
      L2: {
        tokenUsage: {
          input: Number.MAX_SAFE_INTEGER - 1,
          output: 0,
          total: Number.MAX_SAFE_INTEGER - 1,
          estimatedCostUSD: 0,
        },
      },
    };

    await Promise.all([
      Promise.resolve(stateMethods.addTokenUsage.call(state, { estimatedCostUSD: "2.5" })),
      Promise.resolve(stateMethods.addTokenUsage.call(state, { estimatedCostUSD: "  " })),
    ]);

    expect(state.L2.tokenUsage.input).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(state.L2.tokenUsage.estimatedCostUSD).toBe(2.5);
  });
});

describe("stateMethods.getBudgetConfig", () => {
  it("normalizes undefined budgets", () => {
    const state = {};
    const result = stateMethods.getBudgetConfig.call(state);
    expect(stateUtilsMocks.normalizeBudgetConfig).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ normalized: true, budget: undefined });
  });

  it("passes through provided budget values including empty objects and whitespace", () => {
    const budget = {};
    const state = { userConfig: { budget } };
    stateMethods.getBudgetConfig.call(state);
    expect(stateUtilsMocks.normalizeBudgetConfig).toHaveBeenCalledWith(budget);

    const state2 = { userConfig: { budget: "   " } };
    stateMethods.getBudgetConfig.call(state2);
    expect(stateUtilsMocks.normalizeBudgetConfig).toHaveBeenCalledWith("   ");
  });
});

describe("stateMethods.addTodo", () => {
  it("dispatches add through state engine and syncs to shared", () => {
    const engine = { dispatchSync: vi.fn() };
    const state = {
      todos: [],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(() => {
        state.todos = [{ todoId: "todo_1", text: "Alpha", status: "open" }];
      }),
      _syncToShared: vi.fn(),
    };
    const row = { todoId: "todo_1", text: "Alpha", status: "open" };
    todoUtilsMocks.createTodo.mockReturnValueOnce(row);

    const result = stateMethods.addTodo.call(state, { todoId: "todo_1", text: "Alpha" });

    expect(engine.dispatchSync).toHaveBeenCalledWith({
      type: memoryMocks.L0_ADD_TODO,
      payload: { todo: expect.any(Object) },
    });
    expect(checkpointMocks.cloneValue).toHaveBeenCalledWith(row);
    expect(state._syncFromStateEngine).toHaveBeenCalledTimes(1);
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_1", {
      status: "open",
      keywords: ["Alpha"],
    });
    expect(result).toBe(state.todos[0]);
  });

  it("generates an id for non-object params and syncs long text keywords", () => {
    const engine = { dispatchSync: vi.fn() };
    const longText = "x".repeat(10000);
    const state = {
      todos: [{ todoId: "todo_1" }, { todoId: "todo_2" }],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(),
      _syncToShared: vi.fn(),
    };
    todoUtilsMocks.createTodo.mockReturnValueOnce({ todoId: "todo_3", text: longText, status: "pending" });

    const result = stateMethods.addTodo.call(state, []);

    expect(todoUtilsMocks.createTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: "todo_3" }));
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_3", {
      status: "pending",
      keywords: [longText.slice(0, 50)],
    });
    expect(result).toEqual({ todoId: "todo_3", text: longText, status: "pending" });
  });

  it("falls back to addTodo logic when engine is absent", () => {
    const state = {};
    const result = stateMethods.addTodo.call(state, null);
    expect(stateLogicMocks.addTodo).toHaveBeenCalledWith(state, null);
    expect(result).toEqual({ fromLogic: true, params: null });
  });
});

describe("stateMethods.replaceTodos", () => {
  it("dispatches replace through state engine and returns synced todos", () => {
    const list = [
      { todoId: "todo_1", text: "One" },
      { todoId: "todo_2", text: "Two" },
    ];
    const engine = { dispatchSync: vi.fn() };
    const state = {
      todos: [{ todoId: "old" }],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(() => {
        state.todos = list;
      }),
    };

    const result = stateMethods.replaceTodos.call(state, list);

    expect(engine.dispatchSync).toHaveBeenCalledWith({
      type: memoryMocks.L0_REPLACE_TODOS,
      payload: { todos: expect.any(Array) },
    });
    expect(checkpointMocks.cloneValue).toHaveBeenCalledWith(list);
    expect(state._syncFromStateEngine).toHaveBeenCalledTimes(1);
    expect(result).toBe(state.todos);
  });

  it("replaces local todos for non-engine calls and handles non-array input", () => {
    const deepList = Array.from({ length: 1000 }, (_, i) => ({
      todoId: `todo_${i}`,
      meta: { deep: { nested: { index: i } } },
    }));
    const state = { todos: null };
    const result = stateMethods.replaceTodos.call(state, deepList);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1000);
    expect(state.todos).toBe(result);

    const result2 = stateMethods.replaceTodos.call(state, {});
    expect(result2).toEqual([]);
    expect(state.todos).toEqual([]);
  });
});

describe("stateMethods.updateTodo", () => {
  it("returns null for invalid ids or non-object updates", () => {
    const state = { todos: [{ todoId: "todo_1" }] };
    expect(stateMethods.updateTodo.call(state, "   ", {})).toBeNull();
    expect(stateMethods.updateTodo.call(state, "todo_1", null)).toBeNull();
    expect(stateMethods.updateTodo.call(state, "todo_1", [])).toBeNull();
  });

  it("returns null when todo is not found", () => {
    const state = { todos: [] };
    const result = stateMethods.updateTodo.call(state, "todo_1", { text: "x" });
    expect(result).toBeNull();
  });

  it("updates todo locally with trimmed text, status transition, and patch filtering", () => {
    const deepNested = { level1: { level2: { level3: { value: "x" } } } };
    const patch = Object.create(null);
    patch.text = "  New Text  ";
    patch.status = "completed";
    patch.priority = "high";
    patch.queryHints = ["hint"];
    patch.expectedEvidence = deepNested;
    patch.source = "user";
    patch.history = [{ from: "pending", to: "completed", ts: "2024-01-01T00:00:00.000Z" }];
    patch.relatedGapId = "gap_1";
    patch.extra = "ignore";
    Object.defineProperty(patch, "__proto__", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(patch, "constructor", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(patch, "prototype", { value: { polluted: true }, enumerable: true });

    const todo = {
      todoId: "todo_1",
      text: "old",
      content: "old",
      status: "pending",
      priority: "low",
      queryHints: [],
      expectedEvidence: "",
      source: "system",
      history: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const state = { todos: [todo], _syncToShared: vi.fn() };
    const emit = vi.fn();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-01T00:00:00.000Z"));
    const result = stateMethods.updateTodo.call(state, "todo_1", patch, emit);
    vi.useRealTimers();

    expect(result).toBe(todo);
    expect(todo.text).toBe("New Text");
    expect(todo.content).toBe("New Text");
    expect(todo.status).toBe("completed");
    expect(todo.priority).toBe("high");
    expect(todo.queryHints).toEqual(["hint"]);
    expect(todo.expectedEvidence).toEqual(deepNested);
    expect(todo.source).toBe("user");
    expect(todo.history).toEqual([{ from: "pending", to: "completed", ts: "2024-01-01T00:00:00.000Z" }]);
    expect(todo.relatedGapId).toBe("gap_1");
    expect(todo.updatedAt).toBe("2024-02-01T00:00:00.000Z");
    expect(Object.prototype.hasOwnProperty.call(todo, "extra")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(todo, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(todo, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(todo, "prototype")).toBe(false);
    expect(todoUtilsMocks.transitionTodoStatus).toHaveBeenCalledWith(todo, "completed", emit);
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_1", {
      status: "completed",
      keywords: ["New Text"],
    });
  });

  it("ignores whitespace-only text updates and empty patches", () => {
    const todo = { todoId: "todo_1", text: "keep", content: "keep", updatedAt: "2024-01-01T00:00:00.000Z" };
    const state = { todos: [todo], _syncToShared: vi.fn() };

    const result = stateMethods.updateTodo.call(state, "todo_1", { text: "   " });

    expect(result).toBe(todo);
    expect(todo.text).toBe("keep");
    expect(todo.content).toBe("keep");
    expect(todo.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(todoUtilsMocks.transitionTodoStatus).not.toHaveBeenCalled();
    expect(state._syncToShared).not.toHaveBeenCalled();

    const result2 = stateMethods.updateTodo.call(state, "todo_1", {});
    expect(result2).toBe(todo);
    expect(state._syncToShared).not.toHaveBeenCalled();
  });

  it("dispatches updates through state engine and syncs when status changes", () => {
    const engine = { dispatchSync: vi.fn() };
    const originalTodo = { todoId: "todo_2", text: "old", status: "pending" };
    const state = {
      todos: [originalTodo],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(() => {
        state.todos = [{ todoId: "todo_2", text: "engine text", status: "done" }];
      }),
      _syncToShared: vi.fn(),
    };

    const result = stateMethods.updateTodo.call(state, "todo_2", { content: "  new  ", status: "done", priority: "high" });

    expect(checkpointMocks.cloneValue).toHaveBeenCalledWith(originalTodo);
    expect(engine.dispatchSync).toHaveBeenCalledWith({
      type: memoryMocks.L0_UPDATE_TODO,
      payload: { id: "todo_2", updates: expect.any(Object) },
    });
    const dispatched = engine.dispatchSync.mock.calls[0][0].payload.updates;
    expect(dispatched.text).toBe("new");
    expect(dispatched.priority).toBe("high");
    expect(state._syncFromStateEngine).toHaveBeenCalledTimes(1);
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_2", {
      status: "done",
      keywords: ["engine text"],
    });
    expect(result).toBe(state.todos[0]);
  });

  it("does not sync when status is not provided and supports numeric ids", () => {
    const engine = { dispatchSync: vi.fn() };
    const state = {
      todos: [{ todoId: "0", text: "zero", status: "pending" }],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(() => {
        state.todos = [{ todoId: "0", text: "zero", status: "pending", priority: "low" }];
      }),
      _syncToShared: vi.fn(),
    };

    const result = stateMethods.updateTodo.call(state, 0, { priority: "low" });

    expect(result).toBe(state.todos[0]);
    expect(state._syncToShared).not.toHaveBeenCalled();
    expect(todoUtilsMocks.transitionTodoStatus).not.toHaveBeenCalled();
  });

  it("handles rapid consecutive updates on the same todo", async () => {
    const todo = { todoId: "todo_1", text: "x", priority: "low" };
    const state = { todos: [todo] };

    await Promise.all([
      Promise.resolve(stateMethods.updateTodo.call(state, "todo_1", { priority: "high" })),
      Promise.resolve(stateMethods.updateTodo.call(state, "todo_1", { priority: "low" })),
    ]);

    expect(todo.priority).toBe("low");
  });
});

describe("stateMethods.removeTodo", () => {
  it("returns null for empty or invalid ids", () => {
    const state = { todos: [{ todoId: "todo_1" }] };
    expect(stateMethods.removeTodo.call(state, undefined)).toBeNull();
    expect(stateMethods.removeTodo.call(state, "   ")).toBeNull();
  });

  it("dispatches remove through state engine and returns existing todo", () => {
    const engine = { dispatchSync: vi.fn() };
    const state = {
      todos: [{ todoId: "todo_1", text: "Alpha" }],
      _stateEngine: engine,
      _syncFromStateEngine: vi.fn(),
    };

    const result = stateMethods.removeTodo.call(state, "todo_1");

    expect(engine.dispatchSync).toHaveBeenCalledWith({
      type: memoryMocks.L0_REMOVE_TODO,
      payload: { id: "todo_1" },
    });
    expect(state._syncFromStateEngine).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ todoId: "todo_1", text: "Alpha" });
    expect(state.todos.length).toBe(1);
  });

  it("removes todo locally when engine is absent", () => {
    const state = { todos: [{ todoId: "todo_1" }] };
    const removed = stateMethods.removeTodo.call(state, "todo_1");
    expect(removed).toEqual({ todoId: "todo_1" });
    expect(state.todos).toEqual([]);

    const missing = stateMethods.removeTodo.call(state, "todo_2");
    expect(missing).toBeNull();
  });
});

describe("stateMethods.setAwaitUserFeedback", () => {
  it("delegates to logic with value and reason", () => {
    const state = {};
    stateLogicMocks.setAwaitUserFeedback.mockReturnValueOnce({ ok: true });
    const result = stateMethods.setAwaitUserFeedback.call(state, false, " ");
    expect(stateLogicMocks.setAwaitUserFeedback).toHaveBeenCalledWith(state, false, " ");
    expect(result).toEqual({ ok: true });
  });
});

describe("stateMethods.setTaskImpossible", () => {
  it("delegates to logic with reason", () => {
    const state = {};
    stateLogicMocks.setTaskImpossible.mockReturnValueOnce({ ok: true });
    const result = stateMethods.setTaskImpossible.call(state, "nope");
    expect(stateLogicMocks.setTaskImpossible).toHaveBeenCalledWith(state, "nope");
    expect(result).toEqual({ ok: true });
  });
});

describe("stateMethods.addTimeline", () => {
  it("passes default status and payload", () => {
    const state = {};
    const result = stateMethods.addTimeline.call(state);
    expect(stateLogicMocks.addTimeline).toHaveBeenCalledWith(state, { name: undefined, status: "info", payload: undefined });
    expect(result).toEqual({ payload: { name: undefined, status: "info", payload: undefined } });
  });

  it("passes provided timeline entry values", () => {
    const state = {};
    const entry = { name: "step", status: "warn", payload: { deep: { nested: true } } };
    stateMethods.addTimeline.call(state, entry);
    expect(stateLogicMocks.addTimeline).toHaveBeenCalledWith(state, entry);
  });
});

describe("stateMethods.saveWriteSnapshot", () => {
  it("passes timestamp options", () => {
    const state = {};
    const result = stateMethods.saveWriteSnapshot.call(state, { timestamp: "2024-01-01T00:00:00.000Z" });
    expect(stateLogicMocks.saveWriteSnapshot).toHaveBeenCalledWith(state, { timestamp: "2024-01-01T00:00:00.000Z" });
    expect(result).toEqual({ payload: { timestamp: "2024-01-01T00:00:00.000Z" } });
  });
});

describe("stateMethods.reopenGaps", () => {
  it("delegates gap reopening with options and emit", () => {
    const state = {};
    const emit = vi.fn();
    const result = stateMethods.reopenGaps.call(state, "gap_1", { reason: "why", timestamp: "t" }, emit);
    expect(stateLogicMocks.reopenGaps).toHaveBeenCalledWith(state, "gap_1", { reason: "why", timestamp: "t" }, emit);
    expect(result).toEqual({ gapIds: "gap_1", options: { reason: "why", timestamp: "t" }, emit });
  });

  it("supports empty arrays for gapIds", () => {
    const state = {};
    stateMethods.reopenGaps.call(state, [], {});
    expect(stateLogicMocks.reopenGaps).toHaveBeenCalledWith(state, [], { reason: undefined, timestamp: undefined }, null);
  });
});

describe("stateMethods.addNewGaps", () => {
  it("delegates new gap creation with options", () => {
    const state = {};
    const emit = vi.fn();
    const result = stateMethods.addNewGaps.call(state, [{ id: "gap_1" }], { timestamp: "t" }, emit);
    expect(stateLogicMocks.addNewGaps).toHaveBeenCalledWith(state, [{ id: "gap_1" }], { timestamp: "t" }, emit);
    expect(result).toEqual({ newGaps: [{ id: "gap_1" }], options: { timestamp: "t" }, emit });
  });
});

describe("stateMethods._ensureTokenUsage", () => {
  it("ensures L2 and token usage defaults", () => {
    const state = { L2: null };
    stateUtilsMocks.ensureTokenUsage.mockReturnValueOnce({ input: 1, output: 2, total: 3, estimatedCostUSD: 4 });
    const result = stateMethods._ensureTokenUsage.call(state);
    expect(state.L2).toEqual({ tokenUsage: { input: 1, output: 2, total: 3, estimatedCostUSD: 4 } });
    expect(result).toEqual({ input: 1, output: 2, total: 3, estimatedCostUSD: 4 });
  });

  it("reuses existing token usage object when provided", () => {
    const originalUsage = { input: 9 };
    const state = { L2: { tokenUsage: originalUsage } };
    stateUtilsMocks.ensureTokenUsage.mockReturnValueOnce({ input: 9, output: 0, total: 9, estimatedCostUSD: 0 });
    const result = stateMethods._ensureTokenUsage.call(state);
    expect(stateUtilsMocks.ensureTokenUsage).toHaveBeenCalledWith(originalUsage);
    expect(result).toEqual({ input: 9, output: 0, total: 9, estimatedCostUSD: 0 });
  });
});
