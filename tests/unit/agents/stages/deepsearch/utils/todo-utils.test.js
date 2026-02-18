import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const logger = { warn: vi.fn() };
  const createLogger = vi.fn(() => logger);
  const makeSecureTimestampedId = vi.fn((prefix = "todo") => `${prefix}_secure_id`);
  const isPlainObject = (v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };
  const toNonEmptyString = (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  };
  return { logger, createLogger, isPlainObject, toNonEmptyString, makeSecureTimestampedId };
});

const stateMocks = vi.hoisted(() => {
  const TodoStatus = Object.freeze({
    OPEN: "open",
    PENDING: "pending",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
  });
  const isValidTodoStatus = (value) => Object.values(TodoStatus).includes(value);
  return { TodoStatus, isValidTodoStatus };
});

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  createLogger: sharedMocks.createLogger,
  makeSecureTimestampedId: sharedMocks.makeSecureTimestampedId,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/states.js", () => ({
  TodoStatus: stateMocks.TodoStatus,
  isValidTodoStatus: stateMocks.isValidTodoStatus,
}));

import {
  TodoSchema,
  createTodo,
  validateTodo,
  transitionTodoStatus,
  migratGapToTodo,
  migrateGapToTodo,
} from "../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js";

const FIXED_DATE = new Date("2024-01-02T03:04:05.000Z");
const FIXED_ISO = FIXED_DATE.toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE);
  vi.clearAllMocks();
  sharedMocks.makeSecureTimestampedId.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TodoSchema", () => {
  it("defines a frozen schema map", () => {
    expect(Object.isFrozen(TodoSchema)).toBe(true);
    expect(TodoSchema).toEqual({
      todoId: "string (required)",
      text: "string (required)",
      priority: "high|medium|low",
      status: "open|pending|in_progress|completed|cancelled",
      queryHints: "string[]",
      expectedEvidence: "string",
      source: "user|llm|system",
      history: "array of status changes",
      createdAt: "ISO string",
      updatedAt: "ISO string",
    });
  });
});

describe("createTodo", () => {
  it("normalizes fields and preserves provided history", () => {
    const history = [{ from: "open", to: "pending", ts: "2023-01-01T00:00:00Z" }];
    const todo = createTodo({
      todoId: "todo_123",
      text: "  Test task  ",
      priority: "HIGH",
      status: "in progress",
      queryHints: ["  foo ", "bar", ""],
      expectedEvidence: " proof ",
      source: "LLM",
      history,
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
      relatedGapId: "gap_1",
    });

    expect(todo).toEqual(
      expect.objectContaining({
        todoId: "todo_123",
        text: "Test task",
        priority: "high",
        status: "in_progress",
        queryHints: ["foo", "bar"],
        expectedEvidence: "proof",
        source: "llm",
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-02T00:00:00.000Z",
        relatedGapId: "gap_1",
      })
    );
    expect(todo.history).toEqual(history);
    expect(todo.history).not.toBe(history);
    expect(sharedMocks.logger.warn).not.toHaveBeenCalled();
  });

  it("fills defaults and warns when text is empty", () => {
    const todo = createTodo({
      id: "legacy_1",
      content: "   ",
      title: "",
      done: true,
      priority: "urgent",
      status: "unknown",
      queryHints: "",
      expectedEvidence: "   ",
      source: "bot",
      history: {},
      relatedGapId: "  ",
    });

    expect(todo.todoId).toBe("legacy_1");
    expect(todo.text).toBe("");
    expect(todo.status).toBe("completed");
    expect(todo.priority).toBe("medium");
    expect(todo.queryHints).toEqual([]);
    expect(todo.expectedEvidence).toBe("");
    expect(todo.source).toBe("system");
    expect(todo.createdAt).toBe(FIXED_ISO);
    expect(todo.updatedAt).toBe(FIXED_ISO);
    expect(todo.history).toEqual([{ from: null, to: "completed", ts: FIXED_ISO }]);
    expect("relatedGapId" in todo).toBe(false);

    expect(sharedMocks.logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = sharedMocks.logger.warn.mock.calls[0];
    expect(message).toEqual(expect.stringContaining("Creating todo"));
    expect(meta).toEqual(
      expect.objectContaining({
        hasContent: true,
        hasTitle: true,
        hasText: false,
      })
    );
    expect(Array.isArray(meta.keys)).toBe(true);
  });

  it("handles numeric boundaries and object queryHints", () => {
    const todo = createTodo({
      todoId: 0,
      text: -1,
      priority: 0,
      source: 0,
      queryHints: { nested: { depth: 3 } },
      expectedEvidence: 0,
    });

    expect(todo.todoId).toBe("0");
    expect(todo.text).toBe("-1");
    expect(todo.priority).toBe("medium");
    expect(todo.source).toBe("system");
    expect(todo.queryHints).toEqual(["[object Object]"]);
    expect(todo.expectedEvidence).toBe("0");
    expect(todo.status).toBe("open");
    expect(todo.createdAt).toBe(FIXED_ISO);
    expect(todo.updatedAt).toBe(FIXED_ISO);
    expect(sharedMocks.logger.warn).not.toHaveBeenCalled();
  });

  it("supports long strings and concurrent calls", () => {
    const longText = "x".repeat(100000);
    const params = {
      todoId: Number.MAX_SAFE_INTEGER,
      text: longText,
      expectedEvidence: longText,
      queryHints: ["q"],
    };

    const first = createTodo(params);
    const second = createTodo(params);

    expect(first.todoId).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(first.text.length).toBe(longText.length);
    expect(first.expectedEvidence.length).toBe(longText.length);
    expect(first.history).not.toBe(second.history);
    expect(first.queryHints).not.toBe(second.queryHints);
    expect(first.status).toBe("open");
    expect(second.status).toBe("open");
  });

  it("handles non-object params safely", () => {
    const todo = createTodo(null);
    expect(todo.todoId).toBe("todo_secure_id");
    expect(todo.text).toBe("");
    expect(todo.status).toBe("open");
    expect(sharedMocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("supports custom idFactory for deterministic todo ids", () => {
    const idFactory = vi.fn(() => "todo_custom_id");
    const todo = createTodo({}, { idFactory });
    expect(todo.todoId).toBe("todo_custom_id");
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(sharedMocks.makeSecureTimestampedId).not.toHaveBeenCalled();
  });
});

describe("validateTodo", () => {
  it.each([null, undefined, "", [], 0])("rejects non-object input: %p", (value) => {
    const result = validateTodo(value);
    expect(result).toEqual({ valid: false, issues: ["todo must be an object"] });
  });

  it("flags missing required fields for empty object", () => {
    const result = validateTodo({});
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(["todoId is required", "text is required"]));
    expect(result.issues).toHaveLength(2);
  });

  it("accepts minimal valid todo and tolerates empty optional fields", () => {
    const result = validateTodo({
      todoId: "todo_1",
      text: "Do work",
      queryHints: [],
      createdAt: null,
      updatedAt: undefined,
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it("reports invalid fields and type boundaries", () => {
    const result = validateTodo({
      todoId: "   ",
      text: "",
      priority: "1",
      status: "done",
      queryHints: ["", 1, ["deep"]],
      expectedEvidence: 42,
      source: "robot",
      history: {},
      createdAt: "not a date",
      updatedAt: 0,
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "todoId is required",
        "text is required",
        "priority must be high|medium|low",
        "status must be open|pending|in_progress|completed|cancelled",
        "queryHints must contain non-empty strings",
        "expectedEvidence must be a string",
        "source must be user|llm|system",
        "history must be an array",
        "createdAt must be an ISO timestamp",
        "updatedAt must be an ISO timestamp",
      ])
    );
  });

  it("reports queryHints type errors for non-array input", () => {
    const result = validateTodo({
      todoId: "todo_2",
      text: "Task",
      queryHints: {},
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining(["queryHints must be an array"]));
  });
});

describe("transitionTodoStatus", () => {
  it("updates status, timestamps, history, and emits event", () => {
    const todo = {
      todoId: "todo_1",
      text: "task",
      status: "open",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      history: "not-array",
    };
    const emit = vi.fn();

    const result = transitionTodoStatus(todo, "completed", emit);

    expect(result).toBe(true);
    expect(todo.status).toBe("completed");
    expect(todo.createdAt).toBe("2024-01-01T00:00:00.000Z");
    expect(todo.updatedAt).toBe(FIXED_ISO);
    expect(todo.history).toEqual([{ from: "open", to: "completed", ts: FIXED_ISO }]);
    expect(emit).toHaveBeenCalledWith("deepsearch:todo.status.changed", {
      todoId: "todo_1",
      from: "open",
      to: "completed",
      ts: FIXED_ISO,
    });
  });

  it.each([
    [null, "completed"],
    ["bad", "completed"],
    [{ status: "open" }, "bad-status"],
    [{ status: "pending" }, "pending"],
  ])("returns false for invalid inputs (%p, %p)", (todo, next) => {
    const result = transitionTodoStatus(todo, next);
    expect(result).toBe(false);
  });

  it("defaults from invalid status and sets createdAt when missing", () => {
    const todo = {
      todoId: "",
      status: "???",
      history: [],
    };
    const emit = vi.fn();

    const result = transitionTodoStatus(todo, "pending", emit);

    expect(result).toBe(true);
    expect(todo.status).toBe("pending");
    expect(todo.createdAt).toBe(FIXED_ISO);
    expect(todo.updatedAt).toBe(FIXED_ISO);
    expect(todo.history).toEqual([{ from: "open", to: "pending", ts: FIXED_ISO }]);
    expect(emit).toHaveBeenCalledWith("deepsearch:todo.status.changed", {
      todoId: "todo_unknown",
      from: "open",
      to: "pending",
      ts: FIXED_ISO,
    });
  });
});

describe("migratGapToTodo", () => {
  it.each([null, undefined, "", []])("returns null for invalid gap input: %p", (value) => {
    expect(migratGapToTodo(value)).toBeNull();
  });

  it("maps gap fields to a todo", () => {
    const todo = migratGapToTodo({
      gapId: "gap_42",
      question: "Why does it fail?",
      type: "fact",
      status: "filled",
      priority: "LOW",
      queryHints: ["a", "b"],
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    expect(todo).toEqual(
      expect.objectContaining({
        todoId: "todo_42",
        text: "Fill gap: fact - Why does it fail?",
        priority: "low",
        status: "completed",
        queryHints: ["a", "b"],
        expectedEvidence: "",
        source: "system",
        relatedGapId: "gap_42",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      })
    );
    expect(todo.history).toEqual([{ from: null, to: "completed", ts: "2024-01-01T00:00:00.000Z" }]);
  });

  it.each([
    { status: "blocked", expected: "cancelled", gapId: "gap_1" },
    { status: "searching", expected: "pending", gapId: "gap_2" },
    { status: "understanding", expected: "pending", gapId: "gap_3" },
    { status: "unknown", expected: "open", gapId: "custom", question: "" },
  ])("maps gap status $status to todo status $expected", ({ status, expected, gapId, question }) => {
    const todo = migratGapToTodo({
      gapId,
      question,
      status,
      queryHints: "not-array",
    });

    expect(todo.status).toBe(expected);
    expect(todo.queryHints).toEqual([]);
    if (!question) {
      expect(todo.text).toBe(`Fill gap: ${gapId || "gap"}`);
    }
  });
});

describe("migrateGapToTodo", () => {
  it("aliases migratGapToTodo", () => {
    expect(migrateGapToTodo).toBe(migratGapToTodo);
  });
});
