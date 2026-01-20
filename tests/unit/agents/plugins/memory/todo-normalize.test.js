import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedShared = vi.hoisted(() => {
  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = (value) => {
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
  };

  const makeSecureTimestampedId = (prefix = "id") => `${prefix}_mocked_id`;

  return {
    isPlainObject: vi.fn(isPlainObject),
    toNonEmptyString: vi.fn(toNonEmptyString),
    makeSecureTimestampedId: vi.fn(makeSecureTimestampedId),
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => mockedShared);

import todoNormalize, {
  normalizeTodoEntry,
  normalizeTodoInPlace,
  normalizeTodoPriority,
  normalizeTodoStatus,
} from "../../../../../js/agents/plugins/memory/todo-normalize.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("normalizeTodoStatus", () => {
  it("normalizes known values and trims/case-folds input", () => {
    expect(normalizeTodoStatus(" Done ")).toBe("completed");
    expect(normalizeTodoStatus("COMPLETE")).toBe("completed");
    expect(normalizeTodoStatus("in progress")).toBe("in_progress");
    expect(normalizeTodoStatus("In-Progress")).toBe("in_progress");
    expect(normalizeTodoStatus("cancel")).toBe("cancelled");
  });

  it("defaults to pending for empty or non-string inputs", () => {
    const cases = [null, undefined, "", "   ", 0, -1, [], {}, Number.MAX_SAFE_INTEGER];
    cases.forEach((value) => {
      expect(normalizeTodoStatus(value)).toBe("pending");
    });
  });

  it("passes through unknown string values", () => {
    expect(normalizeTodoStatus("Blocked")).toBe("blocked");
    expect(normalizeTodoStatus(" waiting ")).toBe("waiting");
  });

  it("handles concurrent calls consistently", async () => {
    const inputs = ["done", "inprogress", "cancelled", " custom "];
    const outputs = await Promise.all(inputs.map((value) => Promise.resolve(normalizeTodoStatus(value))));
    expect(outputs).toEqual(["completed", "in_progress", "cancelled", "custom"]);
  });
});

describe("normalizeTodoPriority", () => {
  it("normalizes known values and maps normal to medium", () => {
    expect(normalizeTodoPriority(" HIGH ")).toBe("high");
    expect(normalizeTodoPriority("normal")).toBe("medium");
    expect(normalizeTodoPriority("low")).toBe("low");
  });

  it("defaults to medium for empty or non-string inputs", () => {
    const cases = [null, undefined, "", "   ", 0, -1, [], {}, Number.MAX_SAFE_INTEGER];
    cases.forEach((value) => {
      expect(normalizeTodoPriority(value)).toBe("medium");
    });
  });

  it("passes through unknown strings, including numeric strings", () => {
    expect(normalizeTodoPriority("urgent")).toBe("urgent");
    expect(normalizeTodoPriority(" 1 ")).toBe("1");
  });

  it("handles concurrent calls consistently", async () => {
    const inputs = ["high", "normal", "low", "custom"];
    const outputs = await Promise.all(inputs.map((value) => Promise.resolve(normalizeTodoPriority(value))));
    expect(outputs).toEqual(["high", "medium", "low", "custom"]);
  });
});

describe("normalizeTodoEntry", () => {
  it("uses provided ids and text precedence with normalized status/priority", () => {
    const todo = {
      id: "id-1",
      todoId: "todo-1",
      text: "Write tests",
      content: "ignored",
      title: "ignored title",
      message: "ignored message",
      status: "Done",
      priority: "normal",
      ts: 123,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-02T00:00:00.000Z",
      meta: { nested: true },
    };

    const generateId = vi.fn(() => "gen");
    const result = normalizeTodoEntry(todo, { generateId });

    expect(result.id).toBe("id-1");
    expect(result.todoId).toBe("todo-1");
    expect(result.text).toBe("Write tests");
    expect(result.content).toBe("Write tests");
    expect(result.status).toBe("completed");
    expect(result.priority).toBe("medium");
    expect(result.ts).toBe(123);
    expect(result.createdAt).toBe(todo.createdAt);
    expect(result.updatedAt).toBe(todo.updatedAt);
    expect(result.meta).toBe(todo.meta);
    expect(generateId).not.toHaveBeenCalled();
  });

  it("generates ids and fills timestamps when missing", () => {
    vi.useFakeTimers();
    const now = new Date("2024-01-01T00:00:00.000Z");
    vi.setSystemTime(now);

    mockedShared.makeSecureTimestampedId.mockReturnValueOnce("todo_123");

    const result = normalizeTodoEntry({});

    expect(mockedShared.makeSecureTimestampedId).toHaveBeenCalledWith("todo");
    expect(result.id).toBe("todo_123");
    expect(result.todoId).toBe("todo_123");
    expect(result.text).toBe("");
    expect(result.content).toBe("");
    expect(result.createdAt).toBe(now.toISOString());
    expect(result.updatedAt).toBe(now.toISOString());
    expect(result.ts).toBe(now.getTime());
  });

  it("respects fillTimestamps false and avoids adding timestamps", () => {
    const result = normalizeTodoEntry({}, { fillTimestamps: false, generateId: () => "id-0" });

    expect(result.id).toBe("id-0");
    expect(Object.prototype.hasOwnProperty.call(result, "createdAt")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "updatedAt")).toBe(false);
  });

  it("falls back to content/title/message when text is empty", () => {
    const result = normalizeTodoEntry(
      { text: "   ", content: "from content", title: "from title", message: "from message" },
      { fillTimestamps: false, generateId: () => "id-1" },
    );

    expect(result.text).toBe("from content");
    expect(result.content).toBe("from content");
  });

  it("accepts numeric ids and uses them as strings", () => {
    const result = normalizeTodoEntry(
      { id: 0, text: "zero" },
      { fillTimestamps: false, generateId: () => "ignored" },
    );

    expect(result.id).toBe("0");
    expect(result.todoId).toBe("0");
  });

  it("uses finite numeric ts values including boundary values", () => {
    const values = [0, -1, Number.MAX_SAFE_INTEGER];
    values.forEach((ts) => {
      const result = normalizeTodoEntry(
        { ts, text: "t" },
        { fillTimestamps: false, generateId: () => "id-ts" },
      );
      expect(result.ts).toBe(ts);
    });
  });

  it("coerces non-plain inputs into text safely", () => {
    const cases = [
      { input: null, expected: "" },
      { input: undefined, expected: "" },
      { input: [], expected: "" },
      { input: ["a", "b"], expected: "a,b" },
      { input: "123", expected: "123" },
    ];

    const results = cases.map(({ input }) =>
      normalizeTodoEntry(input, { fillTimestamps: false, generateId: () => "id" }),
    );

    expect(results.map((result) => result.text)).toEqual(cases.map((entry) => entry.expected));
  });

  it("handles long text payloads and deep nested objects", () => {
    const longText = "x".repeat(100000);
    const nested = { level1: { level2: { level3: { value: "deep" } } } };
    const todo = { content: longText, meta: nested };

    const result = normalizeTodoEntry(todo, { fillTimestamps: false, generateId: () => "id-long" });

    expect(result.text).toBe(longText);
    expect(result.content).toBe(longText);
    expect(result.meta).toBe(nested);
  });

  it("ignores non-string createdAt/updatedAt when fillTimestamps is false", () => {
    const updatedAt = {};
    const result = normalizeTodoEntry(
      { createdAt: 0, updatedAt, text: "x" },
      { fillTimestamps: false, generateId: () => "id-ts" },
    );

    expect(result.createdAt).toBe(0);
    expect(result.updatedAt).toBe(updatedAt);
  });

  it("handles concurrent calls with custom id generator", async () => {
    let counter = 0;
    const generateId = vi.fn(() => `id_${counter++}`);
    const inputs = ["a", "b", "c"];

    const results = await Promise.all(
      inputs.map((text) => Promise.resolve(normalizeTodoEntry({ text }, { generateId, fillTimestamps: false }))),
    );

    expect(results.map((result) => result.id)).toEqual(["id_0", "id_1", "id_2"]);
    expect(results.map((result) => result.text)).toEqual(inputs);
    expect(generateId).toHaveBeenCalledTimes(3);
  });
});

describe("normalizeTodoInPlace", () => {
  it("returns null for invalid inputs", () => {
    const cases = [null, undefined, 0, -1, "", "todo", false];
    cases.forEach((value) => {
      expect(normalizeTodoInPlace(value)).toBeNull();
    });
  });

  it("fills id/todoId and text/content in place", () => {
    const todo = { todoId: "t1", content: "content" };
    const result = normalizeTodoInPlace(todo);

    expect(result).toBe(todo);
    expect(todo.id).toBe("t1");
    expect(todo.todoId).toBe("t1");
    expect(todo.text).toBe("content");
    expect(todo.content).toBe("content");
  });

  it("normalizes status and priority when present", () => {
    const todo = { id: "t2", text: "x", status: "DONE", priority: "normal" };
    normalizeTodoInPlace(todo);

    expect(todo.status).toBe("completed");
    expect(todo.priority).toBe("medium");
  });

  it("normalizes empty status/priority strings to defaults", () => {
    const todo = { status: "  ", priority: "   " };
    normalizeTodoInPlace(todo);

    expect(todo.status).toBe("pending");
    expect(todo.priority).toBe("medium");
  });

  it("does not add status or priority when missing", () => {
    const todo = { id: "t3", text: "x" };
    normalizeTodoInPlace(todo);

    expect(Object.prototype.hasOwnProperty.call(todo, "status")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(todo, "priority")).toBe(false);
  });

  it("accepts array objects with fields without throwing", () => {
    const todo = [];
    todo.todoId = "arr-1";
    todo.text = "array text";
    todo.status = "done";

    const result = normalizeTodoInPlace(todo);

    expect(result).toBe(todo);
    expect(todo.id).toBe("arr-1");
    expect(todo.todoId).toBe("arr-1");
    expect(todo.content).toBe("array text");
    expect(todo.status).toBe("completed");
  });
});

describe("default export", () => {
  it("exposes normalize helpers", () => {
    expect(todoNormalize).toMatchObject({
      normalizeTodoStatus,
      normalizeTodoPriority,
      normalizeTodoEntry,
      normalizeTodoInPlace,
    });
  });
});
