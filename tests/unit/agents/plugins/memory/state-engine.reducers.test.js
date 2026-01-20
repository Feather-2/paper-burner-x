import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockShared = vi.hoisted(() => ({
  isPlainObject: vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }),
  toNonEmptyString: vi.fn((value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  }),
  deepClone: vi.fn((value) => JSON.parse(JSON.stringify(value))),
}));

const mockStateDiff = vi.hoisted(() => ({
  cloneJson: vi.fn((value) => value),
}));

const mockTodoNormalize = vi.hoisted(() => {
  const normalizeTodoStatus = vi.fn((value) => `status:${String(value)}`);
  const normalizeTodoPriority = vi.fn((value) => `priority:${String(value)}`);
  const normalizeTodoEntry = vi.fn((todo, options = {}) => {
    const raw =
      todo && typeof todo === "object" && !Array.isArray(todo)
        ? { ...todo }
        : { text: String(todo ?? "") };
    const generateId = typeof options.generateId === "function" ? options.generateId : () => "todo-gen";
    const id = raw.id ?? raw.todoId ?? generateId("todo");
    const todoId = raw.todoId ?? raw.id ?? id;
    const text = raw.text ?? raw.content ?? "";
    const createdAt = raw.createdAt ?? new Date().toISOString();
    const updatedAt = raw.updatedAt ?? createdAt;
    return {
      ...raw,
      id,
      todoId,
      text,
      status: raw.status ?? "pending",
      priority: raw.priority ?? "medium",
      createdAt,
      updatedAt,
    };
  });
  return { normalizeTodoEntry, normalizeTodoPriority, normalizeTodoStatus };
});

const mockActionTypes = vi.hoisted(() => ({
  L0_SET_SYSTEM_PROMPT: "L0/SET_SYSTEM_PROMPT",
  L0_SET_TASK_GOAL: "L0/SET_TASK_GOAL",
  L0_ADD_TODO: "L0/ADD_TODO",
  L0_UPDATE_TODO: "L0/UPDATE_TODO",
  L0_REMOVE_TODO: "L0/REMOVE_TODO",
  L0_REPLACE_TODOS: "L0/REPLACE_TODOS",
  L1_ADD_MESSAGE: "L1/ADD_MESSAGE",
  L1_ADD_MESSAGES: "L1/ADD_MESSAGES",
  L1_CLEAR_MESSAGES: "L1/CLEAR_MESSAGES",
  L1_SET_MESSAGES: "L1/SET_MESSAGES",
  L1_SET_DECK: "L1/SET_DECK",
  L1_ADD_SIGNAL: "L1/ADD_SIGNAL",
  L1_ACKNOWLEDGE_SIGNAL: "L1/ACKNOWLEDGE_SIGNAL",
  L1_RECORD_DECISION: "L1/RECORD_DECISION",
  L1_SET_SCRATCHPAD: "L1/SET_SCRATCHPAD",
  L1_CLEAR_SCRATCHPAD: "L1/CLEAR_SCRATCHPAD",
  L1_SET_FLAG: "L1/SET_FLAG",
  L1_SYNC_DISCOVERY: "L1/SYNC_DISCOVERY",
  L1_SYNC_SUBAGENT: "L1/SYNC_SUBAGENT",
  L2_SET_HISTORY_SUMMARY: "L2/SET_HISTORY_SUMMARY",
  L2_APPEND_HISTORY_SUMMARY: "L2/APPEND_HISTORY_SUMMARY",
  L2_SET_STAGE_SUMMARY: "L2/SET_STAGE_SUMMARY",
  L2_ADD_SUMMARY: "L2/ADD_SUMMARY",
  L2_RECORD_DECISION: "L2/RECORD_DECISION",
  L2_ADD_CLAIM: "L2/ADD_CLAIM",
  L2_REPLACE_CLAIMS: "L2/REPLACE_CLAIMS",
  L3_ARCHIVE: "L3/ARCHIVE",
  L3_ADD_CHECKPOINT: "L3/ADD_CHECKPOINT",
  RESTORE_SNAPSHOT: "MEMORY/RESTORE_SNAPSHOT",
  BATCH: "MEMORY/BATCH",
  getActionLayer: vi.fn(),
}));

const mockUtils = vi.hoisted(() => ({
  generateId: vi.fn(),
  truncate: vi.fn((text, maxLen = 200) => {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, Math.max(0, maxLen - 3)) + "...";
  }),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => mockShared);
vi.mock("../../../../../js/agents/plugins/memory/state-diff.js", () => mockStateDiff);
vi.mock("../../../../../js/agents/plugins/memory/todo-normalize.js", () => mockTodoNormalize);
vi.mock("../../../../../js/agents/plugins/memory/action-types.js", () => mockActionTypes);
vi.mock("../../../../../js/agents/plugins/memory/state-engine.utils.js", () => mockUtils);

import { createInitialState, reduceL0 } from "../../../../../js/agents/plugins/memory/state-engine.reducers.js";
import {
  L0_SET_SYSTEM_PROMPT,
  L0_SET_TASK_GOAL,
  L0_ADD_TODO,
  L0_UPDATE_TODO,
  L0_REMOVE_TODO,
  L0_REPLACE_TODOS,
} from "../../../../../js/agents/plugins/memory/action-types.js";

const FIXED_TIME = new Date("2024-05-01T12:34:56.789Z");
const LONG_STRING = "x".repeat(50_000);
const HUGE_FILE_CONTENT = "f".repeat(1024 * 1024);

const buildDeepNested = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.leaf = "end";
  return root;
};

let idCounter = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_TIME);
  vi.clearAllMocks();
  idCounter = 0;
  mockUtils.generateId.mockImplementation((prefix = "id") => {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createInitialState", () => {
  it("builds initial state with provided runId and defaults", () => {
    const state = createInitialState({ runId: "  custom-run  " });

    expect(state.runId).toBe("custom-run");
    expect(state.schemaVersion).toBe("1.0");
    expect(state.createdAt).toBe(FIXED_TIME.toISOString());
    expect(state.L0).toEqual({ systemPrompt: "", taskGoal: "", todos: [] });
    expect(state.L1.flags).toEqual({ awaitUserFeedback: false, taskImpossible: false });
    expect(state.L1.syncTable).toEqual({ discoveries: {}, subagents: {} });
    expect(state.L2).toMatchObject({ historySummary: "", stageSummaries: {}, decisions: [], claims: [] });
    expect(state.L3.index.timeline).toEqual([]);
    expect(mockUtils.generateId).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace", "   "],
  ])("falls back to generated runId for %s input", (_label, runId) => {
    const state = createInitialState({ runId });

    expect(state.runId).toBe("run-1");
    expect(mockUtils.generateId).toHaveBeenCalledWith("run");
  });

  it.each([
    ["zero", 0, "0"],
    ["negative", -1, "-1"],
  ])("accepts numeric runId %s", (_label, runId, expected) => {
    const state = createInitialState({ runId });

    expect(state.runId).toBe(expected);
    expect(mockUtils.generateId).not.toHaveBeenCalled();
  });

  it("creates distinct state objects across calls", () => {
    const first = createInitialState({ runId: "run-a" });
    const second = createInitialState({ runId: "run-b" });

    expect(first).not.toBe(second);
    expect(first.L0).not.toBe(second.L0);
    expect(first.L0.todos).not.toBe(second.L0.todos);
    expect(first.L1).not.toBe(second.L1);
    expect(first.L3.index).not.toBe(second.L3.index);
  });
});

describe("reduceL0", () => {
  const makeState = (overrides = {}) => {
    const base = createInitialState({ runId: "run-1" });
    return {
      ...base,
      ...overrides,
      L0: { ...base.L0, ...(overrides.L0 || {}) },
      L1: { ...base.L1, ...(overrides.L1 || {}) },
      L2: { ...base.L2, ...(overrides.L2 || {}) },
      L3: { ...base.L3, ...(overrides.L3 || {}) },
    };
  };

  it("returns state for unknown action", () => {
    const state = makeState();
    const next = reduceL0(state, { type: "UNKNOWN" });

    expect(next).toBe(state);
  });

  it("sets system prompt and preserves other layers for long input", () => {
    const state = makeState({ L0: { systemPrompt: "old" } });
    const next = reduceL0(state, { type: L0_SET_SYSTEM_PROMPT, payload: { prompt: LONG_STRING } });

    expect(next).not.toBe(state);
    expect(next.L0.systemPrompt).toBe(LONG_STRING);
    expect(next.L0.todos).toBe(state.L0.todos);
    expect(next.L1).toBe(state.L1);
    expect(state.L0.systemPrompt).toBe("old");
  });

  it.each([
    ["empty string", ""],
    ["whitespace", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("ignores empty system prompt for %s", (_label, prompt) => {
    const state = makeState();
    const next = reduceL0(state, { type: L0_SET_SYSTEM_PROMPT, payload: { prompt } });

    expect(next).toBe(state);
  });

  it("returns same state when prompt matches after trimming", () => {
    const state = makeState({ L0: { systemPrompt: "ready" } });
    const next = reduceL0(state, { type: L0_SET_SYSTEM_PROMPT, payload: { prompt: "  ready  " } });

    expect(next).toBe(state);
  });

  it.each([
    ["zero", 0, "0"],
    ["negative", -1, "-1"],
  ])("sets task goal for numeric boundary %s", (_label, goal, expected) => {
    const state = makeState();
    const next = reduceL0(state, { type: L0_SET_TASK_GOAL, payload: { goal } });

    expect(next).not.toBe(state);
    expect(next.L0.taskGoal).toBe(expected);
    expect(next.L1).toBe(state.L1);
  });

  it("adds normalized todo and handles huge content", () => {
    const state = makeState();
    const todo = { text: HUGE_FILE_CONTENT };
    const next = reduceL0(state, { type: L0_ADD_TODO, payload: { todo } });

    expect(mockTodoNormalize.normalizeTodoEntry).toHaveBeenCalledWith(
      todo,
      expect.objectContaining({ generateId: mockUtils.generateId, fillTimestamps: true }),
    );
    expect(mockUtils.generateId).toHaveBeenCalledWith("todo");
    expect(next.L0.todos).toHaveLength(1);
    expect(next.L0.todos[0].text).toBe(HUGE_FILE_CONTENT);
    expect(state.L0.todos).toHaveLength(0);
  });

  it("updates existing todo when id matches and refreshes updatedAt", () => {
    const state = makeState({
      L0: {
        todos: [{ id: "todo-1", text: "old", updatedAt: "2000-01-01T00:00:00.000Z" }],
      },
    });

    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const next = reduceL0(state, { type: L0_ADD_TODO, payload: { todo: { id: "todo-1", text: "new" } } });

    expect(next.L0.todos).toHaveLength(1);
    expect(next.L0.todos[0].text).toBe("new");
    expect(next.L0.todos[0].updatedAt).toBe("2024-01-01T00:00:00.000Z");
    expect(state.L0.todos[0].text).toBe("old");
  });

  it.each([
    ["missing id", undefined, { text: "x" }],
    ["whitespace id", "   ", { text: "x" }],
    ["null updates", "todo-1", null],
    ["array updates", "todo-1", []],
    ["string updates", "todo-1", "oops"],
  ])("returns state for invalid update (%s)", (_label, id, updates) => {
    const state = makeState({ L0: { todos: [{ id: "todo-1", text: "old" }] } });
    const next = reduceL0(state, { type: L0_UPDATE_TODO, payload: { id, updates } });

    expect(next).toBe(state);
    expect(mockTodoNormalize.normalizeTodoStatus).not.toHaveBeenCalled();
    expect(mockTodoNormalize.normalizeTodoPriority).not.toHaveBeenCalled();
  });

  it("updates todo with nested data and boundary values", () => {
    const state = makeState({
      L0: {
        todos: [{ id: "todo-1", text: "old", status: "pending", priority: "low", meta: { existing: true } }],
      },
    });
    const deepMeta = buildDeepNested(12);

    vi.setSystemTime(new Date("2024-02-02T02:02:02.000Z"));
    const next = reduceL0(state, {
      type: L0_UPDATE_TODO,
      payload: {
        id: "todo-1",
        updates: {
          status: Number.MAX_SAFE_INTEGER,
          priority: "5",
          meta: deepMeta,
        },
      },
    });

    expect(next.L0.todos).toHaveLength(1);
    expect(next.L0.todos[0].status).toBe(`status:${Number.MAX_SAFE_INTEGER}`);
    expect(next.L0.todos[0].priority).toBe("priority:5");
    expect(next.L0.todos[0].meta).toBe(deepMeta);
    expect(next.L0.todos[0].updatedAt).toBe("2024-02-02T02:02:02.000Z");
    expect(mockTodoNormalize.normalizeTodoStatus).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    expect(mockTodoNormalize.normalizeTodoPriority).toHaveBeenCalledWith("5");
  });

  it("updates timestamp when updates are an empty object", () => {
    const state = makeState({
      L0: {
        todos: [{ id: "todo-1", text: "old", status: "pending", priority: "low" }],
      },
    });

    vi.setSystemTime(new Date("2024-03-03T03:03:03.000Z"));
    const next = reduceL0(state, {
      type: L0_UPDATE_TODO,
      payload: { id: "todo-1", updates: {} },
    });

    expect(next).not.toBe(state);
    expect(next.L0.todos[0].status).toBe("pending");
    expect(next.L0.todos[0].priority).toBe("low");
    expect(next.L0.todos[0].updatedAt).toBe("2024-03-03T03:03:03.000Z");
    expect(mockTodoNormalize.normalizeTodoStatus).not.toHaveBeenCalled();
    expect(mockTodoNormalize.normalizeTodoPriority).not.toHaveBeenCalled();
  });

  it("removes todo by id or todoId", () => {
    const state = makeState({
      L0: {
        todos: [
          { id: "todo-1", text: "keep" },
          { id: "todo-2", todoId: "todo-2", text: "remove" },
        ],
      },
    });

    const next = reduceL0(state, { type: L0_REMOVE_TODO, payload: { id: "todo-2" } });

    expect(next.L0.todos).toHaveLength(1);
    expect(next.L0.todos[0].id).toBe("todo-1");
    expect(state.L0.todos).toHaveLength(2);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "],
  ])("ignores remove when id is %s", (_label, id) => {
    const state = makeState({ L0: { todos: [{ id: "todo-1" }] } });
    const next = reduceL0(state, { type: L0_REMOVE_TODO, payload: { id } });

    expect(next).toBe(state);
  });

  it("returns same state when remove id not found", () => {
    const state = makeState({ L0: { todos: [{ id: "todo-1" }] } });
    const next = reduceL0(state, { type: L0_REMOVE_TODO, payload: { id: "missing" } });

    expect(next).toBe(state);
  });

  it("replaces todos with empty array", () => {
    const state = makeState({ L0: { todos: [{ id: "todo-1" }] } });
    const next = reduceL0(state, { type: L0_REPLACE_TODOS, payload: { todos: [] } });

    expect(next.L0.todos).toEqual([]);
    expect(mockTodoNormalize.normalizeTodoEntry).not.toHaveBeenCalled();
  });

  it("treats non-array todos payload as empty", () => {
    const state = makeState({ L0: { todos: [{ id: "todo-1" }] } });
    const next = reduceL0(state, { type: L0_REPLACE_TODOS, payload: { todos: { id: "oops" } } });

    expect(next.L0.todos).toEqual([]);
    expect(mockTodoNormalize.normalizeTodoEntry).not.toHaveBeenCalled();
  });

  it("normalizes large todo lists", () => {
    const state = makeState();
    const todos = Array.from({ length: 1_000 }, (_value, i) => ({ text: `todo-${i}` }));
    const next = reduceL0(state, { type: L0_REPLACE_TODOS, payload: { todos } });

    expect(next.L0.todos).toHaveLength(1_000);
    expect(mockTodoNormalize.normalizeTodoEntry).toHaveBeenCalledTimes(1_000);
    expect(mockUtils.generateId).toHaveBeenCalledTimes(1_000);
    expect(next.L0.todos[0].id).toBe("todo-1");
    expect(next.L0.todos[999].id).toBe("todo-1000");
  });

  it("supports concurrent-style calls without mutation", async () => {
    const state = makeState();

    const [promptState, goalState] = await Promise.all([
      Promise.resolve(reduceL0(state, { type: L0_SET_SYSTEM_PROMPT, payload: { prompt: "A" } })),
      Promise.resolve(reduceL0(state, { type: L0_SET_TASK_GOAL, payload: { goal: "B" } })),
    ]);

    expect(state.L0.systemPrompt).toBe("");
    expect(state.L0.taskGoal).toBe("");
    expect(promptState.L0.systemPrompt).toBe("A");
    expect(goalState.L0.taskGoal).toBe("B");
    expect(promptState).not.toBe(goalState);
  });

  it("handles rapid successive todo updates", () => {
    const state = makeState();

    vi.setSystemTime(new Date("2024-04-04T04:04:04.000Z"));
    const first = reduceL0(state, { type: L0_ADD_TODO, payload: { todo: { id: "todo-1", text: "first" } } });

    vi.setSystemTime(new Date("2024-04-04T04:04:05.000Z"));
    const second = reduceL0(first, { type: L0_ADD_TODO, payload: { todo: { id: "todo-1", text: "second" } } });

    expect(first.L0.todos[0].text).toBe("first");
    expect(second.L0.todos).toHaveLength(1);
    expect(second.L0.todos[0].text).toBe("second");
    expect(second.L0.todos[0].updatedAt).toBe("2024-04-04T04:04:05.000Z");
  });
});
