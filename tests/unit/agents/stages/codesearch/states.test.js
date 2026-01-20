import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/stages/deepsearch/states.js", () => {
  const TodoStatus = Object.freeze({
    OPEN: "open",
    IN_PROGRESS: "in_progress",
    DONE: "done",
  });

  return {
    TodoStatus,
    isValidTodoStatus: vi.fn((value) => Object.values(TodoStatus).includes(value)),
  };
});

import {
  CodeSearchPhase,
  isValidCodeSearchPhase,
  TodoStatus,
  isValidTodoStatus,
} from "../../../../../js/agents/stages/codesearch/states.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TodoStatus", () => {
  it("re-exports the mocked TodoStatus", async () => {
    const deepsearch = await import(
      "../../../../../js/agents/stages/deepsearch/states.js"
    );

    expect(TodoStatus).toBe(deepsearch.TodoStatus);
    expect(TodoStatus).toEqual({
      OPEN: "open",
      IN_PROGRESS: "in_progress",
      DONE: "done",
    });
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(TodoStatus)).toBe(true);
    const original = TodoStatus.OPEN;
    const didSet = Reflect.set(TodoStatus, "OPEN", "changed");

    expect(didSet).toBe(false);
    expect(TodoStatus.OPEN).toBe(original);
  });
});

describe("isValidTodoStatus", () => {
  it("returns true for known todo statuses", () => {
    for (const value of Object.values(TodoStatus)) {
      expect(isValidTodoStatus(value)).toBe(true);
    }
  });

  it("handles boundary values and invalid inputs", () => {
    const values = [null, undefined, "", [], {}, 0, "0"];

    for (const value of values) {
      expect(isValidTodoStatus(value)).toBe(false);
    }
  });

  it("propagates errors from the underlying validator", async () => {
    const deepsearch = await import(
      "../../../../../js/agents/stages/deepsearch/states.js"
    );

    deepsearch.isValidTodoStatus.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    expect(() => isValidTodoStatus("open")).toThrow("boom");
  });

  it("delegates to the mocked validator", async () => {
    const deepsearch = await import(
      "../../../../../js/agents/stages/deepsearch/states.js"
    );

    isValidTodoStatus("open");

    expect(deepsearch.isValidTodoStatus).toHaveBeenCalledWith("open");
  });
});

describe("CodeSearchPhase", () => {
  it("exposes the expected phase values", () => {
    expect(CodeSearchPhase).toEqual({
      PLANNING: "planning",
      EXECUTING: "executing",
      SUMMARIZING: "summarizing",
      COMPLETED: "completed",
    });
  });

  it("is frozen and immutable", () => {
    expect(Object.isFrozen(CodeSearchPhase)).toBe(true);
    const original = CodeSearchPhase.PLANNING;
    const didSet = Reflect.set(CodeSearchPhase, "PLANNING", "changed");

    expect(didSet).toBe(false);
    expect(CodeSearchPhase.PLANNING).toBe(original);
  });
});

describe("isValidCodeSearchPhase", () => {
  it("accepts known phases", () => {
    for (const value of Object.values(CodeSearchPhase)) {
      expect(isValidCodeSearchPhase(value)).toBe(true);
    }
  });

  it("rejects empty values, boundary values, and type edge cases", () => {
    const arrayLike = { 0: "planning", length: 1 };
    const values = [
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   ",
      "0",
      arrayLike,
    ];

    for (const value of values) {
      expect(isValidCodeSearchPhase(value)).toBe(false);
    }
  });

  it("handles resource-heavy inputs without throwing", () => {
    const hugeString = "x".repeat(1024 * 1024);
    const hugeFileLike = new Uint8Array(1024 * 1024);
    let nested = { level: 0 };
    let cursor = nested;

    for (let i = 1; i <= 1000; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    expect(isValidCodeSearchPhase(hugeString)).toBe(false);
    expect(isValidCodeSearchPhase(hugeFileLike)).toBe(false);
    expect(isValidCodeSearchPhase(nested)).toBe(false);
  });

  it("supports concurrent calls", async () => {
    const inputs = ["planning", "executing", null, "unknown"];

    const results = await Promise.all(
      inputs.map((value) =>
        Promise.resolve().then(() => isValidCodeSearchPhase(value))
      )
    );

    expect(results).toEqual([true, true, false, false]);
  });

  it("is stable under rapid consecutive calls", () => {
    const results = Array.from({ length: 1000 }, () =>
      isValidCodeSearchPhase("planning")
    );

    expect(results.every(Boolean)).toBe(true);
  });

  it("does not throw for unusual inputs", () => {
    const values = [Symbol("phase"), () => {}, BigInt(1)];

    for (const value of values) {
      expect(() => isValidCodeSearchPhase(value)).not.toThrow();
      expect(isValidCodeSearchPhase(value)).toBe(false);
    }
  });
});
