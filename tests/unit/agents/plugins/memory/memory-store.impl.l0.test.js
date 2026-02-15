import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  return {
    isPlainObject: vi.fn(),
    toNonEmptyString: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => {
  return {
    deepClone: vi.fn(),
  };
});

vi.mock("../../../../../js/agents/plugins/memory/todo-normalize.js", () => {
  const normalizeTodoStatus = vi.fn((value) => {
    const v = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!v) return "pending";
    if (v === "done" || v === "complete" || v === "completed") return "completed";
    if (v === "inprogress" || v === "in_progress" || v === "in-progress" || v === "in progress") return "in_progress";
    if (v === "cancel" || v === "canceled" || v === "cancelled") return "cancelled";
    return v;
  });

  const normalizeTodoEntry = vi.fn();
  const normalizeTodoInPlace = vi.fn();

  return { normalizeTodoEntry, normalizeTodoInPlace, normalizeTodoStatus };
});

vi.mock("../../../../../js/agents/plugins/memory/memory-store.impl.utils.js", () => {
  return {
    defineGetter: vi.fn(),
    defineMethod: vi.fn(),
    estimateTokens: vi.fn(),
    genId: vi.fn(),
  };
});

import { defineL0Layer } from "../../../../../js/agents/plugins/memory/memory-store.impl.l0.js";
import { isPlainObject, toNonEmptyString } from "../../../../../js/agents/shared/index.js";
import { deepClone } from "../../../../../js/agents/shared/utils/value-utils.js";
import { normalizeTodoEntry, normalizeTodoInPlace, normalizeTodoStatus } from "../../../../../js/agents/plugins/memory/todo-normalize.js";
import { defineGetter, defineMethod, estimateTokens, genId } from "../../../../../js/agents/plugins/memory/memory-store.impl.utils.js";

let genIdCounter = 0;

const setupDefaultMocks = () => {
  genIdCounter = 0;

  toNonEmptyString.mockImplementation((value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });

  isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  deepClone.mockImplementation((value) => JSON.parse(JSON.stringify(value)));

  normalizeTodoStatus.mockImplementation((value) => {
    const v = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!v) return "pending";
    if (v === "done" || v === "complete" || v === "completed") return "completed";
    if (v === "inprogress" || v === "in_progress" || v === "in-progress" || v === "in progress") return "in_progress";
    if (v === "cancel" || v === "canceled" || v === "cancelled") return "cancelled";
    return v;
  });

  normalizeTodoEntry.mockImplementation((todo, options = {}) => {
    const raw = todo && typeof todo === "object" && !Array.isArray(todo) ? { ...todo } : { content: String(todo ?? "") };
    const generateId = typeof options.generateId === "function" ? options.generateId : () => "todo-1";

    const asNonEmptyString = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value).trim();
      return str.length ? str : "";
    };

    const idCandidate = asNonEmptyString(raw.id) || asNonEmptyString(raw.todoId);
    const id = idCandidate || generateId("todo");
    const todoId = asNonEmptyString(raw.todoId) || asNonEmptyString(raw.id) || id;
    const content =
      asNonEmptyString(raw.content) ||
      asNonEmptyString(raw.text) ||
      asNonEmptyString(raw.title) ||
      "";

    return {
      ...raw,
      id,
      todoId,
      content,
      text: content,
      status: normalizeTodoStatus(raw.status),
    };
  });

  normalizeTodoInPlace.mockImplementation((todo) => {
    if (!todo || typeof todo !== "object") return null;
    if (todo.text && !todo.content) todo.content = todo.text;
    if (todo.content && !todo.text) todo.text = todo.content;
    if ("status" in todo) todo.status = normalizeTodoStatus(todo.status);
    return todo;
  });

  defineMethod.mockImplementation((fn) => ({
    value: fn,
    writable: true,
    configurable: true,
  }));

  defineGetter.mockImplementation((fn) => ({
    get: fn,
    configurable: true,
  }));

  estimateTokens.mockImplementation((text) => {
    if (text === null || text === undefined) return 0;
    if (typeof text === "string") return text.length;
    try {
      return JSON.stringify(text).length;
    } catch {
      return String(text).length;
    }
  });

  genId.mockImplementation(() => {
    genIdCounter += 1;
    return `gen-${genIdCounter}`;
  });
};

const buildStore = (overrides = {}) => {
  const layer = defineL0Layer();
  const store = {
    _L0: {
      systemPrompt: "",
      taskGoal: "",
      todos: [],
      ...(overrides._L0 || {}),
    },
    _stats: {
      l0Tokens: 0,
      tokenUsage: 0,
      ...(overrides._stats || {}),
    },
    _tokenCounter: overrides._tokenCounter || { name: "counter" },
    _markDirty: vi.fn(),
    _persistL0Async: vi.fn(),
  };
  Object.defineProperties(store, layer);
  return store;
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  setupDefaultMocks();
});

describe("defineL0Layer", () => {
  it("exposes a frozen shallow snapshot via L0 getter", () => {
    const store = buildStore();
    store._L0.systemPrompt = "sys";
    store._L0.taskGoal = "goal";
    store._L0.todos.push({ id: "1", todoId: "1", content: "task" });

    const snapshot = store.L0;

    expect(snapshot).toEqual({
      systemPrompt: "sys",
      taskGoal: "goal",
      todos: store._L0.todos,
    });
    expect(snapshot).not.toBe(store._L0);
    expect(snapshot.todos).not.toBe(store._L0.todos);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.todos)).toBe(true);

    expect(() => snapshot.todos.push({ id: "2" })).toThrow();
    expect(() => {
      snapshot.systemPrompt = "mutated";
    }).toThrow();

    expect(store._L0.systemPrompt).toBe("sys");
    expect(store._L0.todos).toHaveLength(1);
  });

  it("cloneL0 delegates to deepClone for nested data", () => {
    const nested = {
      systemPrompt: "sys",
      taskGoal: "goal",
      todos: [
        {
          id: "1",
          content: "text",
          meta: { level: { deep: [1, { value: "x" }] } },
        },
      ],
    };
    const store = buildStore({ _L0: nested });
    const cloned = { cloned: true };
    deepClone.mockReturnValueOnce(cloned);

    const result = store.cloneL0();

    expect(deepClone).toHaveBeenCalledWith(nested);
    expect(result).toBe(cloned);
  });

  it("setSystemPrompt ignores empty or unchanged prompts", () => {
    const store = buildStore();
    store._L0.systemPrompt = "";

    store.setSystemPrompt("   ");

    expect(store._L0.systemPrompt).toBe("");
    expect(store._stats.l0Tokens).toBe(0);
    expect(store._stats.tokenUsage).toBe(0);
    expect(store._markDirty).not.toHaveBeenCalled();
    expect(estimateTokens).not.toHaveBeenCalled();
  });

  it("setSystemPrompt updates stats for large input and rapid calls", () => {
    const store = buildStore();
    const large = "x".repeat(10000);

    store.setSystemPrompt(large);
    store.setSystemPrompt(`${large}y`);

    expect(store._L0.systemPrompt).toBe(`${large}y`);
    expect(store._stats.l0Tokens).toBe(large.length + 1);
    expect(store._stats.tokenUsage).toBe(large.length + 1);
    expect(store._markDirty).toHaveBeenCalledTimes(2);
  });

  it("setTaskGoal normalizes null/whitespace and numeric boundaries", () => {
    const store = buildStore();

    store.setTaskGoal(null);
    store.setTaskGoal(-1);
    store.setTaskGoal(Number.MAX_SAFE_INTEGER);

    expect(store._L0.taskGoal).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(store._markDirty).toHaveBeenCalledTimes(3);
  });

  it("getTaskGoal returns empty string when unset and value when set", () => {
    const store = buildStore();
    store._L0.taskGoal = undefined;

    expect(store.getTaskGoal()).toBe("");

    store._L0.taskGoal = "deliver";
    expect(store.getTaskGoal()).toBe("deliver");
  });

  it("addTodo adds normalized entries and updates stats", () => {
    const store = buildStore();
    const todo = { id: "1", content: "abc" };

    const result = store.addTodo(todo);

    const options = normalizeTodoEntry.mock.calls[0][1];
    expect(options.generateId).toBe(genId);
    expect(options.fillTimestamps).toBe(false);

    expect(store._L0.todos).toHaveLength(1);
    expect(result).toBe(store._L0.todos[0]);
    expect(result.content).toBe("abc");
    expect(store._stats.l0Tokens).toBe(3);
    expect(store._stats.tokenUsage).toBe(3);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
  });

  it("addTodo updates existing todo when duplicate id is added", () => {
    const store = buildStore();
    store._L0.todos.push({ id: "dup", todoId: "dup", content: "old", status: "pending" });
    store._stats.l0Tokens = "old".length;
    store._stats.tokenUsage = "old".length;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    const result = store.addTodo({ id: "dup", content: "newer", status: "done" });

    expect(result).toBe(store._L0.todos[0]);
    expect(store._L0.todos).toHaveLength(1);
    expect(result.content).toBe("newer");
    expect(result.updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(normalizeTodoInPlace).toHaveBeenCalledTimes(1);
    expect(store._stats.l0Tokens).toBe("newer".length);
    expect(store._stats.tokenUsage).toBe("newer".length);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
  });

  it("addTodo accepts null/undefined inputs and rapid consecutive calls", () => {
    const store = buildStore();

    [null, undefined, { id: "a", content: "x" }, { id: "b", content: "yy" }].forEach((item) => {
      store.addTodo(item);
    });

    expect(store._L0.todos).toHaveLength(4);
    expect(store._stats.l0Tokens).toBe(3);
    expect(store._stats.tokenUsage).toBe(3);
    expect(store._markDirty).toHaveBeenCalledTimes(4);
  });

  it("updateTodo returns null for invalid or missing ids", () => {
    const store = buildStore();

    expect(store.updateTodo(null, { content: "x" })).toBeNull();
    expect(store.updateTodo(undefined, { content: "x" })).toBeNull();
    expect(store.updateTodo("   ", { content: "x" })).toBeNull();
    expect(store.updateTodo(0, { content: "x" })).toBeNull();
    expect(store.updateTodo("missing", { content: "x" })).toBeNull();
    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it("updateTodo updates todo for numeric id strings and plain objects", () => {
    const store = buildStore();
    store._L0.todos = [{ id: 1, todoId: 1, content: "old", status: "pending" }];
    store._stats.l0Tokens = "old".length;
    store._stats.tokenUsage = "old".length;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-02-02T03:04:05.000Z"));

    const result = store.updateTodo("1", { content: "new content", status: "Done" });

    expect(result).toBe(store._L0.todos[0]);
    expect(result.content).toBe("new content");
    expect(result.status).toBe("completed");
    expect(result.updatedAt).toBe("2024-02-02T03:04:05.000Z");
    expect(normalizeTodoInPlace).toHaveBeenCalledTimes(1);
    expect(store._stats.l0Tokens).toBe("new content".length);
    expect(store._stats.tokenUsage).toBe("new content".length);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
  });

  it("updateTodo ignores non-plain data without mutating", () => {
    const store = buildStore();
    store._L0.todos = [{ id: "1", todoId: "1", content: "stay", status: "pending" }];
    store._stats.l0Tokens = "stay".length;
    store._stats.tokenUsage = "stay".length;

    const result = store.updateTodo("1", ["not", "plain"]);

    expect(result).toBe(store._L0.todos[0]);
    expect(result.content).toBe("stay");
    expect(normalizeTodoInPlace).not.toHaveBeenCalled();
    expect(store._stats.l0Tokens).toBe("stay".length);
    expect(store._stats.tokenUsage).toBe("stay".length);
    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it("removeTodo returns null for invalid or missing ids", () => {
    const store = buildStore();
    store._L0.todos = [{ id: "1", todoId: "1", content: "task" }];

    expect(store.removeTodo("")).toBeNull();
    expect(store.removeTodo("missing")).toBeNull();
    expect(store._L0.todos).toHaveLength(1);
    expect(store._markDirty).not.toHaveBeenCalled();
  });

  it("removeTodo removes existing todo and updates stats", () => {
    const store = buildStore();
    const id = Number.MAX_SAFE_INTEGER;
    store._L0.todos = [{ id, todoId: id, content: "abcdef" }];
    store._stats.l0Tokens = "abcdef".length;
    store._stats.tokenUsage = "abcdef".length;

    const removed = store.removeTodo(id);

    expect(removed).toEqual(expect.objectContaining({ id }));
    expect(store._L0.todos).toHaveLength(0);
    expect(store._stats.l0Tokens).toBe(0);
    expect(store._stats.tokenUsage).toBe(0);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
  });

  it("getTodos returns a copy for empty filters", () => {
    const store = buildStore();
    store._L0.todos = [
      { id: "1", todoId: "1", status: "pending", priority: "high" },
      { id: "2", todoId: "2", status: "done", priority: "low" },
    ];

    const all = store.getTodos();
    expect(all).toEqual(store._L0.todos);
    expect(all).not.toBe(store._L0.todos);

    all.push({ id: "3" });
    expect(store._L0.todos).toHaveLength(2);

    const viaEmptyObject = store.getTodos({});
    expect(viaEmptyObject).toHaveLength(2);
  });

  it("getTodos supports predicate, status string, and options filters", () => {
    const store = buildStore();
    store._L0.todos = [
      { id: "1", todoId: "1", status: "pending", priority: "high" },
      { id: "2", todoId: "2", status: "done", priority: "low" },
      { id: "3", todoId: "3", status: "in progress", priority: "high" },
    ];

    const highPriority = store.getTodos((t) => t.priority === "high");
    expect(highPriority.map((t) => t.id)).toEqual(["1", "3"]);

    const completed = store.getTodos("completed");
    expect(completed.map((t) => t.id)).toEqual(["2"]);

    const pendingHigh = store.getTodos({
      status: "pending",
      filter: (t) => t.priority === "high",
    });
    expect(pendingHigh.map((t) => t.id)).toEqual(["1"]);
  });

  it("replaceTodos normalizes list and updates token stats", () => {
    const store = buildStore();
    store._L0.todos = [
      { id: "a", todoId: "a", content: "aaa" },
      { id: "b", todoId: "b", content: "bb" },
    ];
    store._stats.l0Tokens = 5;
    store._stats.tokenUsage = 5;

    const result = store.replaceTodos([{ id: "c", content: "x" }]);

    expect(store._L0.todos).toHaveLength(1);
    expect(result).toEqual(store._L0.todos);
    expect(result).not.toBe(store._L0.todos);
    expect(store._stats.l0Tokens).toBe(1);
    expect(store._stats.tokenUsage).toBe(1);
    expect(store._markDirty).toHaveBeenCalledTimes(1);
  });

  it("replaceTodos handles non-array and empty array inputs", () => {
    const store = buildStore();
    store._L0.todos = [{ id: "1", todoId: "1", content: "aa" }];
    store._stats.l0Tokens = 2;
    store._stats.tokenUsage = 2;

    const cleared = store.replaceTodos({});
    expect(cleared).toEqual([]);
    expect(store._L0.todos).toEqual([]);
    expect(store._stats.l0Tokens).toBe(0);
    expect(store._stats.tokenUsage).toBe(0);

    const emptyAgain = store.replaceTodos([]);
    expect(emptyAgain).toEqual([]);
    expect(store._markDirty).toHaveBeenCalledTimes(2);
  });

  it("replaceTodos handles large todo arrays", () => {
    const store = buildStore();
    const largeTodos = Array.from({ length: 500 }, (_, idx) => ({ id: `t${idx}`, content: "x" }));

    const result = store.replaceTodos(largeTodos);

    expect(result).toHaveLength(500);
    expect(store._L0.todos).toHaveLength(500);
    expect(store._stats.l0Tokens).toBe(500);
    expect(store._stats.tokenUsage).toBe(500);
  });
});
