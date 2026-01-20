import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
}));

import { EditHistoryManager } from "../../../../../../js/agents/stages/design/edit-mode/history.js";

const makeDeepNestedObject = () => {
  let root = { level: 0 };
  let current = root;
  for (let i = 1; i <= 25; i += 1) {
    const next = { level: i };
    current.child = next;
    current = next;
  }
  return root;
};

const makeLargePayload = () => ({
  longText: "x".repeat(10000),
  largeFile: new Uint8Array(1024 * 1024 * 2),
  deepNested: makeDeepNestedObject(),
});

beforeEach(() => {
  vi.resetAllMocks();
  sharedMocks.isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
});

describe("EditHistoryManager", () => {
  it("initializes defaults and validates handlers", () => {
    const onRedo = vi.fn();
    const manager = new EditHistoryManager(undefined, { onUndo: "nope", onRedo });

    expect(manager.maxHistory).toBe(50);
    expect(manager.history).toEqual([]);
    expect(manager.redoStack).toEqual([]);
    expect(manager.transaction).toBe(null);
    expect(manager.onUndo).toBe(null);
    expect(manager.onRedo).toBe(onRedo);
  });

  it.each([
    { name: "null", value: null, expected: 50 },
    { name: "undefined", value: undefined, expected: 50 },
    { name: "zero", value: 0, expected: 50 },
    { name: "negative one", value: -1, expected: 50 },
    { name: "empty string", value: "", expected: 50 },
    { name: "whitespace string", value: "   ", expected: 50 },
    { name: "string number", value: "12", expected: 50 },
    { name: "float", value: 3.9, expected: 3 },
    { name: "max safe integer", value: Number.MAX_SAFE_INTEGER, expected: Number.MAX_SAFE_INTEGER },
  ])("normalizes maxHistory: $name", ({ value, expected }) => {
    const manager = new EditHistoryManager(value);

    expect(manager.maxHistory).toBe(expected);
  });

  it.each([
    { name: "null", value: null },
    { name: "undefined", value: undefined },
    { name: "empty string", value: "" },
    { name: "whitespace string", value: "   " },
    { name: "empty array", value: [] },
    { name: "zero", value: 0 },
    { name: "negative one", value: -1 },
  ])("rejects non-plain operations: $name", ({ value }) => {
    const manager = new EditHistoryManager();
    manager.redoStack = [{ operations: [{ id: "redo" }], timestamp: 1 }];

    const result = manager.push(value);

    expect(result).toBe(false);
    expect(manager.history).toEqual([]);
    expect(manager.redoStack).toHaveLength(1);
    expect(sharedMocks.isPlainObject).toHaveBeenCalledTimes(1);
    expect(sharedMocks.isPlainObject).toHaveBeenCalledWith(value);
  });

  it("accepts empty object operations and records history", () => {
    const manager = new EditHistoryManager();
    const operation = {};

    const result = manager.push(operation);

    expect(result).toBe(true);
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0].operations).toEqual([operation]);
    expect(typeof manager.history[0].timestamp).toBe("number");
  });

  it("clears redoStack when pushing outside transactions", () => {
    const manager = new EditHistoryManager();
    const op1 = { id: "one" };
    const op2 = { id: "two" };

    manager.push(op1);
    manager.undo();

    expect(manager.redoStack).toHaveLength(1);

    manager.push(op2);

    expect(manager.redoStack).toHaveLength(0);
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0].operations[0]).toBe(op2);
  });

  it("prevents overlapping transactions", () => {
    const manager = new EditHistoryManager();

    expect(manager.beginTransaction()).toBe(true);
    const existing = manager.transaction;
    expect(manager.beginTransaction()).toBe(false);
    expect(manager.transaction).toBe(existing);
  });

  it("batches operations in a transaction and clears redoStack on commit", () => {
    const manager = new EditHistoryManager();
    manager.redoStack = [{ operations: [{ id: "old" }], timestamp: 5 }];

    manager.beginTransaction();
    const op1 = { id: "first" };
    const op2 = { id: "second" };
    manager.push(op1);
    manager.push(op2);

    const result = manager.commit();

    expect(result).toBe(true);
    expect(manager.transaction).toBe(null);
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0].operations).toEqual([op1, op2]);
    expect(manager.redoStack).toHaveLength(0);
  });

  it("treats array-like transaction operations as empty when committing", () => {
    const manager = new EditHistoryManager();
    manager.beginTransaction();
    manager.transaction.operations = { length: 0 };

    const result = manager.commit();

    expect(result).toBe(true);
    expect(manager.history).toHaveLength(0);
    expect(manager.transaction).toBe(null);
  });

  it("commits empty transactions without clearing redoStack", () => {
    const manager = new EditHistoryManager();
    manager.push({ id: "entry" });
    manager.undo();
    expect(manager.redoStack).toHaveLength(1);

    manager.beginTransaction();
    const result = manager.commit();

    expect(result).toBe(true);
    expect(manager.history).toHaveLength(0);
    expect(manager.redoStack).toHaveLength(1);
  });

  it("rolls back transactions by undoing in reverse order", () => {
    const order = [];
    const op1 = { undo: vi.fn(() => order.push("op1")) };
    const op2 = { undo: vi.fn(() => order.push("op2")) };
    const manager = new EditHistoryManager();

    manager.beginTransaction();
    manager.push(op1);
    manager.push(op2);

    const result = manager.rollback();

    expect(result).toBe(true);
    expect(order).toEqual(["op2", "op1"]);
    expect(manager.history).toHaveLength(0);
    expect(manager.transaction).toBe(null);
  });

  it("undo/redo use operation handlers in the correct order", () => {
    const order = [];
    const op1 = {
      undo: vi.fn(() => order.push("undo1")),
      redo: vi.fn(() => order.push("redo1")),
    };
    const op2 = {
      undo: vi.fn(() => order.push("undo2")),
      redo: vi.fn(() => order.push("redo2")),
    };
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const manager = new EditHistoryManager(50, { onUndo, onRedo });

    manager.beginTransaction();
    manager.push(op1);
    manager.push(op2);
    manager.commit();

    const undoEntry = manager.undo();
    expect(undoEntry).not.toBeNull();
    expect(order).toEqual(["undo2", "undo1"]);
    expect(onUndo).not.toHaveBeenCalled();

    const redoEntry = manager.redo();
    expect(redoEntry).not.toBeNull();
    expect(order).toEqual(["undo2", "undo1", "redo1", "redo2"]);
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("falls back to onUndo/onRedo when operations lack handlers", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const manager = new EditHistoryManager(50, { onUndo, onRedo });
    const operation = { id: "fallback" };

    manager.push(operation);

    const undoEntry = manager.undo();
    expect(undoEntry).not.toBeNull();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith(operation);

    const redoEntry = manager.redo();
    expect(redoEntry).not.toBeNull();
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledWith(operation);
  });

  it("returns null when undo/redo stacks are empty", () => {
    const manager = new EditHistoryManager();

    expect(manager.undo()).toBeNull();
    expect(manager.redo()).toBeNull();
    expect(manager.history).toHaveLength(0);
    expect(manager.redoStack).toHaveLength(0);
  });

  it("trims history to the configured maxHistory", () => {
    const manager = new EditHistoryManager(2);

    manager.push({ id: "one" });
    manager.push({ id: "two" });
    manager.push({ id: "three" });

    expect(manager.history).toHaveLength(2);
    expect(manager.history[0].operations[0].id).toBe("two");
    expect(manager.history[1].operations[0].id).toBe("three");
  });

  it("handles large payload operations", () => {
    const manager = new EditHistoryManager();
    const operation = makeLargePayload();

    const result = manager.push(operation);

    expect(result).toBe(true);
    expect(manager.history).toHaveLength(1);
    expect(manager.history[0].operations[0]).toBe(operation);
  });

  it("handles simultaneous undo calls", async () => {
    const manager = new EditHistoryManager();
    manager.push({ id: "one" });
    manager.push({ id: "two" });

    const results = await Promise.all([
      Promise.resolve().then(() => manager.undo()),
      Promise.resolve().then(() => manager.undo()),
    ]);

    expect(results.map((entry) => entry?.operations[0].id)).toEqual(["two", "one"]);
    expect(manager.history).toHaveLength(0);
    expect(manager.redoStack).toHaveLength(2);
  });

  it("handles rapid successive undo/redo calls", () => {
    const manager = new EditHistoryManager();
    const ops = ["a", "b", "c", "d"];

    for (const id of ops) manager.push({ id });
    for (let i = 0; i < ops.length; i += 1) manager.undo();
    for (let i = 0; i < ops.length; i += 1) manager.redo();

    expect(manager.history).toHaveLength(ops.length);
    expect(manager.redoStack).toHaveLength(0);
    expect(manager.history.map((entry) => entry.operations[0].id)).toEqual(ops);
  });
});
