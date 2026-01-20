import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/index.js", () => {
  const isPlainObject = vi.fn((v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  });
  const toNonEmptyString = vi.fn((v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  });
  return { isPlainObject, toNonEmptyString };
});

vi.mock("../../../../../js/agents/plugins/memory/index.js", () => ({
  L0_SET_TASK_GOAL: "L0_SET_TASK_GOAL",
  L0_REPLACE_TODOS: "L0_REPLACE_TODOS",
  L0_ADD_TODO: "L0_ADD_TODO",
  L0_UPDATE_TODO: "L0_UPDATE_TODO",
}));

vi.mock("../../../../../js/agents/stages/codesearch/states.js", () => ({
  CodeSearchPhase: {
    PLANNING: "planning",
    EXECUTING: "executing",
    SUMMARIZING: "summarizing",
    COMPLETED: "completed",
  },
  TodoStatus: {
    OPEN: "open",
    DONE: "done",
  },
}));

import { CodeSearchState } from "../../../../../js/agents/stages/codesearch/state.js";
import { CodeSearchPhase, TodoStatus } from "../../../../../js/agents/stages/codesearch/states.js";
import {
  L0_SET_TASK_GOAL,
  L0_REPLACE_TODOS,
  L0_ADD_TODO,
  L0_UPDATE_TODO,
} from "../../../../../js/agents/plugins/memory/index.js";

describe("CodeSearchState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes defaults and handles empty or invalid values", () => {
    const state = new CodeSearchState({
      runId: -1,
      query: "   ",
      taskGoal: null,
      todos: {},
      observations: "",
      steps: null,
      phase: undefined,
      awaitUserFeedback: false,
      pauseReason: "",
      finalThought: "   ",
      budgetUsage: [],
      createdAt: Number.MAX_SAFE_INTEGER,
      schemaVersion: "",
    });

    expect(state.schemaVersion).toBe("0.1");
    expect(state.runId).toBe("-1");
    expect(state.createdAt).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(state.query).toBe("");
    expect(state.taskGoal).toBe("");
    expect(state.todos).toEqual([]);
    expect(state.phase).toBe(CodeSearchPhase.PLANNING);
    expect(state.observations).toEqual([]);
    expect(state.steps).toEqual([]);
    expect(state.awaitUserFeedback).toBe(false);
    expect(state.pauseReason).toBeNull();
    expect(state.finalThought).toBeNull();
    expect(state.budgetUsage).toBeNull();

    const stateWithBudget = new CodeSearchState({ budgetUsage: {} });
    expect(stateWithBudget.budgetUsage).toEqual({});
  });

  it("normalizes query values including boundaries and large strings", () => {
    const state = new CodeSearchState();

    state.query = 0;
    expect(state.query).toBe("0");

    state.query = "   ";
    expect(state.query).toBe("");

    const longText = "a".repeat(10000);
    state.query = longText;
    expect(state.query).toBe(longText);
  });

  it("prefers taskGoal from stateEngine then memoryStore then local", () => {
    const state = new CodeSearchState({ taskGoal: "local" });
    state._memoryStore = { L0: { taskGoal: "memory" } };
    state._stateEngine = { getState: () => ({ L0: { taskGoal: "engine" } }) };

    expect(state.taskGoal).toBe("engine");

    const errorState = new CodeSearchState({ taskGoal: "local2" });
    errorState._memoryStore = { L0: { taskGoal: "memory2" } };
    errorState._stateEngine = { getState: () => { throw new Error("boom"); } };
    expect(errorState.taskGoal).toBe("memory2");

    const fallbackState = new CodeSearchState({ taskGoal: "local3" });
    fallbackState._stateEngine = { getState: () => ({ L0: { taskGoal: "   " } }) };
    fallbackState._memoryStore = { L0: { taskGoal: "   " } };
    expect(fallbackState.taskGoal).toBe("local3");
  });

  it("syncs taskGoal to dependencies and tolerates dispatch errors", () => {
    const dispatchSync = vi.fn();
    const memoryStore = { setTaskGoal: vi.fn() };
    const state = new CodeSearchState({ stateEngine: { dispatchSync }, memoryStore });

    state.taskGoal = " goal ";
    expect(state.taskGoal).toBe("goal");
    expect(dispatchSync).toHaveBeenCalledWith({
      type: L0_SET_TASK_GOAL,
      payload: { taskGoal: "goal" },
    });
    expect(memoryStore.setTaskGoal).toHaveBeenCalledWith("goal");

    const memoryStoreFallback = { L0: {} };
    const stateWithErrors = new CodeSearchState({
      stateEngine: { dispatchSync: () => { throw new Error("fail"); } },
      memoryStore: memoryStoreFallback,
    });

    expect(() => {
      stateWithErrors.taskGoal = "x";
    }).not.toThrow();
    expect(memoryStoreFallback.L0.taskGoal).toBe("x");

    stateWithErrors.taskGoal = "y";
    expect(stateWithErrors.taskGoal).toBe("y");
  });

  it("sets todos, syncs clones, and handles type boundaries", () => {
    const dispatchSync = vi.fn();
    const replaceTodos = vi.fn();
    const state = new CodeSearchState({
      stateEngine: { dispatchSync },
      memoryStore: { replaceTodos },
    });

    const todos = [{ todoId: "t1", text: "a", meta: { nested: [1, 2] } }];
    state.todos = todos;
    const dispatched = dispatchSync.mock.calls[0][0].payload.todos;
    expect(dispatchSync).toHaveBeenCalledWith({
      type: L0_REPLACE_TODOS,
      payload: { todos: dispatched },
    });
    expect(dispatched).toEqual(todos);
    expect(dispatched).not.toBe(todos);
    expect(replaceTodos).toHaveBeenCalledWith(dispatched);
    expect(replaceTodos.mock.calls[0][0]).not.toBe(todos);

    state.todos = {};
    expect(state.todos).toEqual([]);

    state.todos = [];
    expect(state.todos).toEqual([]);
  });

  it("adds todos for plain objects and ignores invalid inputs", () => {
    const dispatchSync = vi.fn();
    const state = new CodeSearchState({ stateEngine: { dispatchSync } });

    expect(state.addTodo(null)).toBeNull();
    expect(state.addTodo([])).toBeNull();
    expect(state.todos).toEqual([]);

    const todo = { todoId: "t1", text: "do" };
    const added = state.addTodo(todo);
    const dispatched = dispatchSync.mock.calls[0][0].payload.todo;

    expect(added).toBe(todo);
    expect(state.todos).toHaveLength(1);
    expect(dispatched).toEqual(todo);
    expect(dispatched).not.toBe(todo);
    expect(dispatchSync).toHaveBeenCalledWith({
      type: L0_ADD_TODO,
      payload: { todo: dispatched },
    });
  });

  it("updates todos with history, supports id match, and handles missing todos", () => {
    const dispatchSync = vi.fn();
    const state = new CodeSearchState({ stateEngine: { dispatchSync } });
    state.todos = [
      { todoId: "t1", text: "a" },
      { id: "t2", status: TodoStatus.OPEN, history: [] },
    ];
    dispatchSync.mockClear();

    const updated = state.updateTodo("t1", { status: TodoStatus.DONE, text: "b" });
    expect(updated.status).toBe(TodoStatus.DONE);
    expect(state.todos[0].history).toHaveLength(1);
    expect(state.todos[0].history[0].from).toBe(TodoStatus.OPEN);
    expect(state.todos[0].history[0].to).toBe(TodoStatus.DONE);
    expect(typeof state.todos[0].history[0].timestamp).toBe("number");
    expect(dispatchSync).toHaveBeenCalledWith({
      type: L0_UPDATE_TODO,
      payload: { todoId: "t1", updates: { status: TodoStatus.DONE, text: "b" } },
    });

    const updatedById = state.updateTodo("t2", { text: "changed" });
    expect(updatedById.text).toBe("changed");
    expect(state.todos[1].history).toHaveLength(0);

    const missing = state.updateTodo("missing", { status: TodoStatus.DONE });
    expect(missing).toBeNull();
  });

  it("handles rapid consecutive updates without losing history", () => {
    const state = new CodeSearchState({
      todos: [{ todoId: "t1", status: TodoStatus.OPEN, history: [] }],
    });

    state.updateTodo("t1", { status: TodoStatus.DONE });
    state.updateTodo("t1", { status: TodoStatus.OPEN });
    expect(state.todos[0].status).toBe(TodoStatus.OPEN);
    expect(state.todos[0].history).toHaveLength(2);
  });

  it("normalizes phase values and accepts stringified numbers", () => {
    const state = new CodeSearchState();

    state.phase = "   ";
    expect(state.phase).toBe(CodeSearchPhase.PLANNING);

    state.phase = -1;
    expect(state.phase).toBe("-1");
  });

  it("adds observations safely and supports concurrent calls", async () => {
    const state = new CodeSearchState();

    state.addObservation(null);
    state.addObservation(undefined);
    state.addObservation("");
    state.addObservation(0);
    expect(state.observations).toEqual([]);

    const values = ["one", "two", "three"];
    await Promise.all(
      values.map((text) => Promise.resolve().then(() => state.addObservation(text)))
    );
    expect(state.observations).toHaveLength(3);
    values.forEach((value) => {
      expect(state.observations).toContain(value);
    });
  });

  it("adds steps only for plain objects and preserves type boundaries", () => {
    const state = new CodeSearchState();

    expect(state.addStep([])).toBeNull();
    expect(state.addStep(() => {})).toBeNull();

    const step = { step: "1", tool: "tool", args: { q: "x" } };
    const added = state.addStep(step);
    expect(added).toBe(step);
    expect(state.steps).toEqual([step]);
  });

  it("binds stateEngine, syncs initial state, and unsubscribes previous engine", () => {
    const engineTodos = [{ todoId: "e1", text: "a" }];
    const unsubscribe1 = vi.fn();
    let callback1;
    const engine1 = {
      getState: () => ({ L0: { taskGoal: "engine1", todos: engineTodos } }),
      subscribe: vi.fn((_scope, cb) => {
        callback1 = cb;
        return unsubscribe1;
      }),
    };

    const state = new CodeSearchState({ taskGoal: "local" });
    state.bindStateEngine(engine1);
    expect(state.taskGoal).toBe("engine1");
    expect(state.todos).toEqual(engineTodos);
    expect(state.todos).not.toBe(engineTodos);

    engineTodos[0].text = "mutated";
    expect(state.todos[0].text).toBe("a");

    const engineTodos2 = [{ todoId: "e2" }];
    const unsubscribe2 = vi.fn();
    let callback2;
    const engine2 = {
      getState: () => ({ L0: { taskGoal: "engine2", todos: engineTodos2 } }),
      subscribe: vi.fn((_scope, cb) => {
        callback2 = cb;
        return unsubscribe2;
      }),
    };

    state.bindStateEngine(engine2);
    expect(unsubscribe1).toHaveBeenCalledTimes(1);
    expect(state.taskGoal).toBe("engine2");
    expect(state.todos).toEqual(engineTodos2);

    callback1?.(null, null, { taskGoal: "ignored", todos: [{ todoId: "x" }] });
    callback2(null, null, { taskGoal: "fromSub", todos: [{ todoId: "s1" }] });
    expect(state.todos).toEqual([{ todoId: "s1" }]);
    expect(state._taskGoal).toBe("fromSub");
  });

  it("ignores missing stateEngine snapshots during sync", () => {
    const state = new CodeSearchState({
      taskGoal: "keep",
      todos: [{ todoId: "t1" }],
    });
    state._stateEngine = { getState: () => ({}) };

    state._syncFromStateEngine();
    expect(state.taskGoal).toBe("keep");
    expect(state.todos).toEqual([{ todoId: "t1" }]);

    state._stateEngine = null;
    state._syncFromStateEngine();
    expect(state.taskGoal).toBe("keep");
  });

  it("binds memoryStore and syncs initial values", () => {
    const state = new CodeSearchState({
      taskGoal: "goal",
      todos: [{ todoId: "t1" }],
    });
    const setTaskGoal = vi.fn();
    const replaceTodos = vi.fn();

    state.bindMemoryStore({ setTaskGoal, replaceTodos });
    expect(setTaskGoal).toHaveBeenCalledWith("goal");
    const passedTodos = replaceTodos.mock.calls[0][0];
    expect(passedTodos).toEqual([{ todoId: "t1" }]);
    expect(passedTodos).not.toBe(state.todos);

    const stateEmpty = new CodeSearchState({ taskGoal: "goal" });
    const setTaskGoal2 = vi.fn();
    const replaceTodos2 = vi.fn();
    stateEmpty.bindMemoryStore({ setTaskGoal: setTaskGoal2, replaceTodos: replaceTodos2 });
    expect(setTaskGoal2).toHaveBeenCalledWith("goal");
    expect(replaceTodos2).not.toHaveBeenCalled();

    expect(() => state.bindMemoryStore({})).not.toThrow();
  });

  it("builds snapshots with deep clones and length metadata", () => {
    const deepTodo = { todoId: "t1", meta: { nested: { list: [{ value: 1 }] } } };
    const deepBudget = {
      input: 1,
      output: 2,
      total: 3,
      estimatedCostUSD: 4,
      extra: { arr: [{ x: 1 }] },
    };
    const longText = "x".repeat(50000);
    const state = new CodeSearchState({
      runId: "r1",
      query: longText,
      taskGoal: "goal",
      todos: [deepTodo],
      observations: ["obs"],
      steps: [{ step: 1, tool: "t", args: { payload: longText } }],
      phase: CodeSearchPhase.EXECUTING,
      awaitUserFeedback: true,
      pauseReason: "pause",
      finalThought: "final",
      budgetUsage: deepBudget,
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    const snapshot = state.buildStateSnapshot();
    const { length, ...rest } = snapshot;
    expect(length).toBe(JSON.stringify(rest).length);

    expect(snapshot.query).toBe(longText);
    expect(snapshot.todos).toEqual([deepTodo]);
    expect(snapshot.todos).not.toBe(state.todos);

    snapshot.todos[0].meta.nested.list[0].value = 99;
    expect(state.todos[0].meta.nested.list[0].value).toBe(1);

    expect(snapshot.budgetUsage).toEqual(deepBudget);
    snapshot.budgetUsage.extra.arr[0].x = 42;
    expect(state.budgetUsage.extra.arr[0].x).toBe(1);
  });

  it("toJSON returns the current snapshot", () => {
    const state = new CodeSearchState({ runId: "r1", query: "q" });
    const snapshot = state.buildStateSnapshot();
    expect(state.toJSON()).toEqual(snapshot);
  });

  it("fromSnapshot validates input and fromJSON proxies correctly", () => {
    const invalidInputs = [null, undefined, "", [], 1];
    invalidInputs.forEach((input) => {
      expect(() => CodeSearchState.fromSnapshot(input)).toThrow(TypeError);
    });

    const snapshot = {
      runId: "r1",
      query: " test ",
      todos: [],
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    const state = CodeSearchState.fromSnapshot(snapshot);
    expect(state).toBeInstanceOf(CodeSearchState);
    expect(state.runId).toBe("r1");
    expect(state.query).toBe("test");

    const stateFromJson = CodeSearchState.fromJSON(snapshot);
    expect(stateFromJson.runId).toBe("r1");
  });
});
