import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockedTodoUtils = vi.hoisted(() => ({
  createTodo: vi.fn(),
  transitionTodoStatus: vi.fn(),
  validateTodo: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  TodoStatus: {
    OPEN: "open",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  },
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  createTodo: mockedTodoUtils.createTodo,
  transitionTodoStatus: mockedTodoUtils.transitionTodoStatus,
  validateTodo: mockedTodoUtils.validateTodo,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/states.js", () => ({
  TodoStatus: mockedStates.TodoStatus,
}));

async function loadModule() {
  return await import("../../../../../../../js/agents/stages/deepsearch/tools/manage-todos/handler.js");
}

beforeEach(() => {
  vi.resetModules();

  mockedTodoUtils.createTodo.mockReset();
  mockedTodoUtils.transitionTodoStatus.mockReset();
  mockedTodoUtils.validateTodo.mockReset();

  mockedTodoUtils.createTodo.mockImplementation((payload) => ({
    ...payload,
    todoId: payload.todoId ?? "todo_1",
    text: payload.text,
  }));
  mockedTodoUtils.validateTodo.mockReturnValue({ valid: true, issues: [] });
  mockedTodoUtils.transitionTodoStatus.mockImplementation((todo, status) => {
    todo.status = status;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("definition", () => {
  it("exposes expected metadata", async () => {
    const { definition } = await loadModule();

    expect(definition).toMatchObject({
      name: "manage-todos",
      layer: 0,
      activation: {
        keywords: expect.arrayContaining(["todo"]),
        phases: expect.arrayContaining(["planning", "executing"]),
      },
    });
    expect(typeof definition.description).toBe("string");
  });
});

describe("handler", () => {
  it("creates todo with state.addTodo and emits event", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = {
      addTodo: vi.fn((draft) => ({ ...draft, todoId: "todo_added" })),
    };

    const result = await handler(
      { action: "create", text: "  Task 1  ", priority: "high", queryHints: ["q1"] },
      { state, emit }
    );

    const created = mockedTodoUtils.createTodo.mock.results[0]?.value;
    expect(mockedTodoUtils.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Task 1",
        priority: "high",
        queryHints: ["q1"],
        status: mockedStates.TodoStatus.OPEN,
        source: "user",
      })
    );
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(created);
    expect(state.addTodo).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true });
    expect(result.todo.todoId).toBe("todo_added");
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.created", { todoId: "todo_added", text: "Task 1" });
  });

  it("creates todo and falls back to state.todos array with legacy content", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: null };

    const result = await handler({ action: "create", content: "  Legacy content  " }, { state, emit });

    expect(mockedTodoUtils.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Legacy content",
        priority: "medium",
      })
    );
    expect(Array.isArray(state.todos)).toBe(true);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].text).toBe("Legacy content");
    expect(result.success).toBe(true);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.created", { todoId: "todo_1", text: "Legacy content" });
  });

  it.each([
    ["null", { action: "create", text: null }],
    ["undefined", { action: "create" }],
    ["empty string", { action: "create", text: "" }],
    ["whitespace", { action: "create", text: "   " }],
    ["empty array", { action: "create", text: [] }],
    ["empty object", { action: "create", text: {} }],
  ])("returns error when text is invalid (%s)", async (_label, args) => {
    const { handler } = await loadModule();
    const result = await handler(args, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "text is required for creating a todo" });
    expect(mockedTodoUtils.createTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();
  });

  it("returns validation issues for create", async () => {
    const { handler } = await loadModule();
    mockedTodoUtils.validateTodo.mockReturnValueOnce({ valid: false, issues: ["bad", "worse"] });
    const emit = vi.fn();
    const state = { todos: [] };

    const result = await handler({ action: "create", text: "Task" }, { state, emit });

    expect(result).toEqual({ success: false, error: "bad; worse", issues: ["bad", "worse"] });
    expect(state.todos).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("handles long text and deep nested todo data with non-array queryHints", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: [] };
    const longText = "x".repeat(10000);
    const nestedMeta = { deep: { nest: { level: 3 } } };
    const queryHints = { hint: "not-array" };

    const result = await handler(
      {
        action: "create",
        text: `  ${longText}  `,
        todo: { meta: nestedMeta, queryHints, priority: "low" },
      },
      { state, emit }
    );

    const call = mockedTodoUtils.createTodo.mock.calls[0][0];
    expect(call.text).toBe(longText);
    expect(call.queryHints).toBe(queryHints);
    expect(call.meta).toEqual(nestedMeta);
    expect(result.success).toBe(true);
  });

  it.each([
    ["undefined", { action: "update" }],
    ["null", { action: "update", todoId: null }],
    ["empty string", { action: "update", todoId: "" }],
    ["zero", { action: "update", todoId: 0 }],
  ])("returns error when todoId is missing (%s)", async (_label, args) => {
    const { handler } = await loadModule();
    const result = await handler(args, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "todoId is required" });
  });

  it("returns error when todoId type mismatches", async () => {
    const { handler } = await loadModule();
    const state = { todos: [{ todoId: 1, text: "one", status: "open" }] };

    const result = await handler({ action: "update", todoId: "1", text: "new" }, { state, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "Todo not found" });
  });

  it("updates using state.updateTodo with trimmed updates", async () => {
    const { handler } = await loadModule();
    const todo = { todoId: "t1", text: "old", status: "open" };
    const emit = vi.fn();
    const state = {
      todos: [todo],
      updateTodo: vi.fn((id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler(
      { action: "update", todoId: "t1", text: "  new  ", status: " completed " },
      { state, emit }
    );

    expect(state.updateTodo).toHaveBeenCalledWith("t1", { text: "new", status: "completed" }, emit);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(expect.objectContaining({ todoId: "t1", text: "new" }));
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.todo.updated",
      expect.objectContaining({ todoId: "t1", status: "completed", text: "new" })
    );
    expect(result.success).toBe(true);
  });

  it("skips updateTodo when no valid updates are provided", async () => {
    const { handler } = await loadModule();
    const todo = { todoId: "t1", text: "old", status: "open" };
    const emit = vi.fn();
    const state = {
      todos: [todo],
      updateTodo: vi.fn(),
    };

    const result = await handler({ action: "update", todoId: "t1", text: "  ", status: "  " }, { state, emit });

    expect(state.updateTodo).not.toHaveBeenCalled();
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(todo);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.updated", expect.objectContaining({ todoId: "t1" }));
    expect(result.success).toBe(true);
  });

  it("returns error when state.updateTodo returns null", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = {
      todos: [{ todoId: "t1", text: "old", status: "open" }],
      updateTodo: vi.fn(() => null),
    };

    const result = await handler({ action: "update", todoId: "t1", text: "new" }, { state, emit });

    expect(result).toEqual({ success: false, error: "Todo not found" });
    expect(mockedTodoUtils.validateTodo).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("updates in-place without state.updateTodo and uses transition", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: "t2", text: "old", status: "open" };
    const state = { todos: [todo] };

    const result = await handler({ action: "update", todoId: "t2", text: "  revise ", status: "completed" }, { state, emit });

    expect(todo.text).toBe("revise");
    expect(typeof todo.updatedAt).toBe("string");
    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, "completed", emit);
    expect(mockedTodoUtils.validateTodo).toHaveBeenCalledWith(todo);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.updated", expect.objectContaining({ todoId: "t2", status: "completed" }));
    expect(result.success).toBe(true);
  });

  it("returns validation errors after in-place update", async () => {
    const { handler } = await loadModule();
    mockedTodoUtils.validateTodo.mockReturnValueOnce({ valid: false, issues: ["bad"] });
    const emit = vi.fn();
    const todo = { todoId: "t3", text: "old", status: "open" };
    const state = { todos: [todo] };

    const result = await handler({ action: "update", todoId: "t3", status: "completed" }, { state, emit });

    expect(result).toEqual({ success: false, error: "bad", issues: ["bad"] });
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", -1],
    ["max safe", Number.MAX_SAFE_INTEGER],
  ])("updates with numeric todoId boundaries (%s)", async (_label, todoId) => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId, text: "old", status: "open" };
    const state = { todos: [todo] };

    const result = await handler({ action: "update", todoId, status: "completed" }, { state, emit });

    expect(result.success).toBe(true);
    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, "completed", emit);
  });

  it("handles rapid consecutive updates", async () => {
    const { handler } = await loadModule();
    const todo = { todoId: "t4", text: "old", status: "open" };
    const state = { todos: [todo] };

    await handler({ action: "update", todoId: "t4", text: "first" }, { state, emit: vi.fn() });
    await handler({ action: "update", todoId: "t4", status: "completed" }, { state, emit: vi.fn() });

    expect(todo.text).toBe("first");
    expect(todo.status).toBe("completed");
  });

  it("completes todo using state.updateTodo when available", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: "t5", text: "a", status: "open" };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: "complete", todoId: "t5" }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith("t5", { status: mockedStates.TodoStatus.COMPLETED }, emit);
    expect(mockedTodoUtils.transitionTodoStatus).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.completed", { todoId: "t5" });
    expect(result.todo.status).toBe("completed");
  });

  it("completes todo by transition when updateTodo missing", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: "t6", text: "a", status: "open" };
    const state = { todos: [todo] };

    const result = await handler({ action: "complete", todoId: "t6" }, { state, emit });

    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, mockedStates.TodoStatus.COMPLETED, emit);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.completed", { todoId: "t6" });
    expect(result.todo).toBe(todo);
  });

  it("returns error when completing missing todo", async () => {
    const { handler } = await loadModule();
    const result = await handler({ action: "complete", todoId: "missing" }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "Todo not found" });
  });

  it("cancels todo using state.updateTodo when available", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: "t7", text: "a", status: "open" };
    const state = {
      todos: [todo],
      updateTodo: vi.fn((id, updates) => ({ ...todo, ...updates })),
    };

    const result = await handler({ action: "cancel", todoId: "t7" }, { state, emit });

    expect(state.updateTodo).toHaveBeenCalledWith("t7", { status: mockedStates.TodoStatus.CANCELLED }, emit);
    expect(mockedTodoUtils.transitionTodoStatus).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.cancelled", { todoId: "t7" });
    expect(result.todo.status).toBe("cancelled");
  });

  it("cancels todo by transition when updateTodo missing", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const todo = { todoId: "t8", text: "a", status: "open" };
    const state = { todos: [todo] };

    const result = await handler({ action: "cancel", todoId: "t8" }, { state, emit });

    expect(mockedTodoUtils.transitionTodoStatus).toHaveBeenCalledWith(todo, mockedStates.TodoStatus.CANCELLED, emit);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.cancelled", { todoId: "t8" });
    expect(result.todo).toBe(todo);
  });

  it("returns error when cancelling missing todo", async () => {
    const { handler } = await loadModule();
    const result = await handler({ action: "cancel", todoId: "missing" }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "Todo not found" });
  });

  it("lists todos with selected fields only", async () => {
    const { handler } = await loadModule();
    const state = {
      todos: [
        { todoId: "t1", text: "one", status: "open", priority: "high", extra: "x" },
        { todoId: "t2", text: "two", status: "completed", priority: "low", extra: "y" },
      ],
    };

    const result = await handler({ action: "list" }, { state, emit: vi.fn() });

    expect(result).toEqual({
      success: true,
      todos: [
        { todoId: "t1", text: "one", status: "open", priority: "high" },
        { todoId: "t2", text: "two", status: "completed", priority: "low" },
      ],
    });
  });

  it("lists empty todos when state.todos is missing", async () => {
    const { handler } = await loadModule();
    const result = await handler({ action: "list" }, { state: {}, emit: vi.fn() });

    expect(result).toEqual({ success: true, todos: [] });
  });

  it("returns error for unknown action", async () => {
    const { handler } = await loadModule();
    const result = await handler({ action: "unknown" }, { state: { todos: [] }, emit: vi.fn() });

    expect(result).toEqual({ success: false, error: "Unknown action: unknown" });
  });

  it("supports concurrent create calls on shared state", async () => {
    const { handler } = await loadModule();
    const emit = vi.fn();
    const state = { todos: [] };
    let counter = 0;
    mockedTodoUtils.createTodo.mockImplementation((payload) => ({
      ...payload,
      todoId: `todo_${++counter}`,
      text: payload.text,
    }));

    const [first, second] = await Promise.all([
      handler({ action: "create", text: "A" }, { state, emit }),
      handler({ action: "create", text: "B" }, { state, emit }),
    ]);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(state.todos).toHaveLength(2);
    expect(new Set(state.todos.map((t) => t.todoId)).size).toBe(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe("default", () => {
  it("exports definition and handler", async () => {
    const mod = await loadModule();

    expect(mod.default.definition).toBe(mod.definition);
    expect(mod.default.handler).toBe(mod.handler);
  });
});
