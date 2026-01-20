// Unit tests cover memoryMethods branches with boundary cases and failure paths.
// Focus on deepsearch memory state syncing, scratchpad updates, and todo binding.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { debugSpy, isPlainObject } = vi.hoisted(() => {
  const isPlainObject = (value) => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };
  return { debugSpy: vi.fn(), isPlainObject };
});

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: () => ({ debug: debugSpy }),
  isPlainObject,
}));

import { memoryMethods } from "../../../../../../js/agents/stages/deepsearch/state/memory-methods.js";

const createContext = (overrides = {}) => ({
  _memoryStore: null,
  sharedContext: null,
  subAgentIndex: null,
  taskGoal: "",
  L2: undefined,
  todos: undefined,
  _stateEngine: null,
  _syncFromStateEngine: undefined,
  ...overrides,
});

beforeEach(() => {
  debugSpy.mockReset();
  vi.restoreAllMocks();
});

describe("memoryMethods._syncToShared", () => {
  it("syncs to memory store and shared context with timestamp", () => {
    const syncDiscovery = vi.fn();
    const upsertSignal = vi.fn();
    const ctx = createContext({
      _memoryStore: { syncDiscovery },
      sharedContext: { upsertSignal },
      subAgentIndex: -1,
    });

    const summary = {
      score: 0,
      meta: { nested: true },
      payload: "x".repeat(10000),
    };

    vi.spyOn(Date, "now").mockReturnValue(123456);

    memoryMethods._syncToShared.call(ctx, "doc", "id_1", summary);

    expect(syncDiscovery).toHaveBeenCalledWith("id_1", { type: "doc", ...summary, by: -1 });
    expect(upsertSignal).toHaveBeenCalledWith({ type: "doc", id: "id_1", ...summary, by: -1, ts: 123456 });
  });

  it("skips sharedContext when upsertSignal is missing", () => {
    const syncDiscovery = vi.fn();
    const ctx = createContext({
      _memoryStore: { syncDiscovery },
      sharedContext: { upsertSignal: null },
      subAgentIndex: 0,
    });

    memoryMethods._syncToShared.call(ctx, "type", "id", {});

    expect(syncDiscovery).toHaveBeenCalledTimes(1);
  });

  it("handles whitespace/empty ids and rapid calls", async () => {
    const syncDiscovery = vi.fn();
    const upsertSignal = vi.fn();
    const ctx = createContext({
      _memoryStore: { syncDiscovery },
      sharedContext: { upsertSignal },
      subAgentIndex: Number.MAX_SAFE_INTEGER,
    });

    await Promise.all(
      ["", " ", "id"].map((id) =>
        Promise.resolve().then(() => memoryMethods._syncToShared.call(ctx, " ", id, {})),
      ),
    );

    expect(syncDiscovery).toHaveBeenCalledTimes(3);
    expect(upsertSignal).toHaveBeenCalledTimes(3);
    expect(upsertSignal.mock.calls[0][0]).toMatchObject({ type: " ", by: Number.MAX_SAFE_INTEGER });
    expect(typeof upsertSignal.mock.calls[0][0].ts).toBe("number");
  });
});

describe("memoryMethods.getScratchpad", () => {
  it("delegates to memory store when available", () => {
    const getScratchpad = vi.fn().mockReturnValue(0);
    const ctx = createContext({ _memoryStore: { getScratchpad } });

    const result = memoryMethods.getScratchpad.call(ctx, "key");

    expect(result).toBe(0);
    expect(getScratchpad).toHaveBeenCalledWith("key");
  });

  it("returns a shallow copy when key is omitted", () => {
    const nested = { deep: { value: 1 } };
    const ctx = createContext({ L2: { scratchpad: { a: 1, nested } } });

    const result = memoryMethods.getScratchpad.call(ctx);

    expect(result).toEqual({ a: 1, nested });
    expect(result).not.toBe(ctx.L2.scratchpad);
    result.newKey = "x";
    expect(ctx.L2.scratchpad.newKey).toBeUndefined();
    expect(result.nested).toBe(nested);
  });

  it("returns values for specific keys and handles null L2", () => {
    const ctx = createContext({ L2: { scratchpad: { "": "empty", "0": "zero", " ": "space" } } });

    expect(memoryMethods.getScratchpad.call(ctx, "")).toBe("empty");
    expect(memoryMethods.getScratchpad.call(ctx, 0)).toBe("zero");
    expect(memoryMethods.getScratchpad.call(ctx, " ")).toBe("space");

    const ctx2 = createContext({ L2: null });

    expect(memoryMethods.getScratchpad.call(ctx2)).toEqual({});
    expect(memoryMethods.getScratchpad.call(ctx2, "missing")).toBeUndefined();
  });
});

describe("memoryMethods.setScratchpad", () => {
  it("initializes L2 and scratchpad and writes to memory store", () => {
    const setScratchpad = vi.fn();
    const ctx = createContext({ L2: [], _memoryStore: { setScratchpad } });

    memoryMethods.setScratchpad.call(ctx, "alpha", "value");

    expect(setScratchpad).toHaveBeenCalledWith("alpha", "value");
    expect(isPlainObject(ctx.L2)).toBe(true);
    expect(Object.getPrototypeOf(ctx.L2.scratchpad)).toBeNull();
    expect(ctx.L2.scratchpad.alpha).toBe("value");
  });

  it("ignores empty/null/blocked keys", () => {
    const setScratchpad = vi.fn();
    const ctx = createContext({
      L2: { scratchpad: Object.create(null) },
      _memoryStore: { setScratchpad },
    });

    ctx.L2.scratchpad.keep = "ok";

    memoryMethods.setScratchpad.call(ctx, "", "x");
    memoryMethods.setScratchpad.call(ctx, null, "x");
    memoryMethods.setScratchpad.call(ctx, undefined, "x");
    memoryMethods.setScratchpad.call(ctx, "__proto__", "x");
    memoryMethods.setScratchpad.call(ctx, "prototype", "x");
    memoryMethods.setScratchpad.call(ctx, "constructor", "x");

    expect(setScratchpad).not.toHaveBeenCalled();
    expect(ctx.L2.scratchpad).toMatchObject({ keep: "ok" });
    expect(Object.prototype.hasOwnProperty.call(ctx.L2.scratchpad, "__proto__")).toBe(false);
  });

  it("applies patch object with filtered keys and deep values", () => {
    const setScratchpad = vi.fn();
    const ctx = createContext({
      L2: { scratchpad: Object.create(null) },
      _memoryStore: { setScratchpad },
    });

    const deep = { level1: { level2: { level3: 1 } } };
    const big = "x".repeat(10000);
    const patch = Object.create(null);
    patch.safe = 1;
    patch.deep = deep;
    patch.big = big;
    patch.emptyObj = {};
    patch.__proto__ = "bad";
    patch.constructor = "bad";
    patch.prototype = "bad";

    memoryMethods.setScratchpad.call(ctx, patch);

    expect(setScratchpad).toHaveBeenCalledTimes(1);
    const arg = setScratchpad.mock.calls[0][0];
    expect(Object.getPrototypeOf(arg)).toBeNull();
    expect(arg).toMatchObject({ safe: 1, deep, big, emptyObj: {} });
    expect(Object.prototype.hasOwnProperty.call(arg, "__proto__")).toBe(false);

    expect(ctx.L2.scratchpad.safe).toBe(1);
    expect(ctx.L2.scratchpad.deep).toBe(deep);
    expect(ctx.L2.scratchpad.big).toBe(big);
  });

  it("stringifies non-string keys and respects numeric/whitespace boundaries", () => {
    const setScratchpad = vi.fn();
    const ctx = createContext({ _memoryStore: { setScratchpad } });

    memoryMethods.setScratchpad.call(ctx, 0, "zero");
    memoryMethods.setScratchpad.call(ctx, -1, "neg");
    memoryMethods.setScratchpad.call(ctx, Number.MAX_SAFE_INTEGER, "max");
    memoryMethods.setScratchpad.call(ctx, " ", "space");
    memoryMethods.setScratchpad.call(ctx, "123", "numericString");
    memoryMethods.setScratchpad.call(ctx, { a: 1 }, "obj");
    memoryMethods.setScratchpad.call(ctx, [1, 2], "arr");
    memoryMethods.setScratchpad.call(ctx, [], "emptyArray");

    expect(ctx.L2.scratchpad["0"]).toBe("zero");
    expect(ctx.L2.scratchpad["-1"]).toBe("neg");
    expect(ctx.L2.scratchpad[String(Number.MAX_SAFE_INTEGER)]).toBe("max");
    expect(ctx.L2.scratchpad[" "]).toBe("space");
    expect(ctx.L2.scratchpad["123"]).toBe("numericString");
    expect(ctx.L2.scratchpad["[object Object]"]).toBe("obj");
    expect(ctx.L2.scratchpad["1,2"]).toBe("arr");
    expect(ctx.L2.scratchpad[""]).toBeUndefined();

    expect(setScratchpad).toHaveBeenCalledWith("0", "zero");
    expect(setScratchpad).toHaveBeenCalledWith("1,2", "arr");
  });

  it("handles rapid consecutive calls", async () => {
    const ctx = createContext({});

    await Promise.all(
      ["a", "b", "c", "d"].map((key) =>
        Promise.resolve().then(() => memoryMethods.setScratchpad.call(ctx, key, key)),
      ),
    );

    expect(ctx.L2.scratchpad).toMatchObject({ a: "a", b: "b", c: "c", d: "d" });
  });
});

describe("memoryMethods.bindMemoryStore", () => {
  it("clears memory store when binding null", () => {
    const ctx = createContext({ _memoryStore: { existing: true } });

    memoryMethods.bindMemoryStore.call(ctx, null);

    expect(ctx._memoryStore).toBeNull();
  });

  it("syncs from state engine and logs errors while setting scratchpad", () => {
    const syncFromStateEngine = vi.fn(() => {
      throw new Error("boom");
    });
    const memoryStore = {
      setScratchpad: vi.fn(() => {
        throw new Error("scratchpad boom");
      }),
    };
    const ctx = createContext({
      _stateEngine: {},
      _syncFromStateEngine: syncFromStateEngine,
      L2: { scratchpad: { a: 1 } },
    });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    expect(ctx._memoryStore).toBe(memoryStore);
    expect(syncFromStateEngine).toHaveBeenCalledTimes(1);
    expect(memoryStore.setScratchpad).toHaveBeenCalledWith(ctx.L2.scratchpad);
    expect(debugSpy).toHaveBeenCalledWith("bindMemoryStore: sync from state engine failed", { error: "boom" });
    expect(debugSpy).toHaveBeenCalledWith("bindMemoryStore: setScratchpad from L2 failed", { error: "scratchpad boom" });
  });

  it("sets task goal, replaces todos, normalizes entries, and syncs flags", () => {
    const memoryStore = {
      L0: { todos: [] },
      setTaskGoal: vi.fn(),
      getTodos: vi.fn(() => [{ todoId: "m1", text: "mem", status: "open" }]),
      replaceTodos: vi.fn((todos) => {
        memoryStore.L0.todos = todos;
      }),
      setScratchpad: vi.fn(),
    };
    const ctx = createContext({
      taskGoal: "goal",
      todos: [
        { todoId: "t1", text: "text1", status: "open" },
        { id: "t2", content: "content2", status: "open" },
      ],
      L2: { awaitUserFeedback: true, taskImpossible: true, scratchpad: { note: "n" } },
    });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    expect(memoryStore.setTaskGoal).toHaveBeenCalledWith("goal");
    expect(memoryStore.replaceTodos).toHaveBeenCalledWith(ctx.todos);
    expect(memoryStore.awaitUserFeedback).toBe(true);
    expect(memoryStore.taskImpossible).toBe(true);
    expect(memoryStore.setScratchpad).toHaveBeenCalledWith(ctx.L2.scratchpad);

    expect(ctx.todos[0]).toMatchObject({ todoId: "t1", id: "t1", text: "text1", content: "text1" });
    expect(ctx.todos[1]).toMatchObject({ todoId: "t2", id: "t2", text: "content2", content: "content2" });
  });

  it("shares todos by reference when L0 is mutable and updates local copy on set", () => {
    const memoryStore = { L0: { todos: [] } };
    const ctx = createContext({
      todos: [{ todoId: "t1", text: "x", status: "open" }],
    });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    const initialRef = ctx.todos;
    expect(initialRef).toBe(memoryStore.L0.todos);

    ctx.todos = [{ todoId: "t2", text: "y", status: "open" }];

    expect(memoryStore.L0.todos).toHaveLength(1);
    expect(memoryStore.L0.todos[0].todoId).toBe("t2");
    expect(initialRef).toHaveLength(1);
    expect(initialRef[0].todoId).toBe("t2");
    expect(initialRef).not.toBe(memoryStore.L0.todos);
  });

  it("uses memory todos when state todos empty and L0 not shareable", () => {
    const bigText = "x".repeat(20000);
    const deep = { layer1: { layer2: { layer3: "v" } } };
    const memTodos = [{ id: "m1", content: bigText, meta: deep, status: "open" }];
    const memoryStore = {
      getTodos: vi.fn(() => memTodos),
      L0: Object.freeze({ todos: Object.freeze([]) }),
    };
    const ctx = createContext({ todos: { not: "array" } });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    expect(ctx.todos).toBe(memTodos);
    expect(ctx.todos[0].todoId).toBe("m1");
    expect(ctx.todos[0].text).toBe(bigText);
    expect(ctx.todos[0].meta).toBe(deep);
  });

  it("logs failures when task goal or todos APIs throw", () => {
    const memoryStore = {
      setTaskGoal: vi.fn(() => {
        throw new Error("goal boom");
      }),
      getTodos: vi.fn(() => {
        throw new Error("todos boom");
      }),
      replaceTodos: vi.fn(() => {
        throw new Error("replace boom");
      }),
      L0: Object.freeze({ todos: Object.freeze([]) }),
    };
    const ctx = createContext({
      taskGoal: "goal",
      todos: [{ todoId: "t1", text: "x", status: "open" }],
    });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    expect(debugSpy).toHaveBeenCalledWith("bindMemoryStore: setTaskGoal failed", { error: "goal boom" });
    expect(debugSpy).toHaveBeenCalledWith("bindMemoryStore: getTodos failed", { error: "todos boom" });
    expect(debugSpy).toHaveBeenCalledWith("bindMemoryStore: replaceTodos failed", { error: "replace boom" });
    expect(ctx.todos[0]).toMatchObject({ id: "t1", todoId: "t1", text: "x", content: "x" });
  });

  it("falls back when defineProperty for todos fails", () => {
    const memTodos = [{ todoId: "m1", text: "x", status: "open" }];
    const memoryStore = {
      getTodos: vi.fn(() => memTodos),
      L0: { todos: [] },
    };
    const ctx = createContext({ todos: [] });

    Object.defineProperty(ctx, "todos", {
      value: [],
      writable: true,
      enumerable: true,
      configurable: false,
    });

    memoryMethods.bindMemoryStore.call(ctx, memoryStore);

    expect(debugSpy).toHaveBeenCalledWith(
      "bindMemoryStore: defineProperty for todos failed",
      { error: expect.any(String) },
    );
    expect(ctx.todos).toBe(memTodos);
  });
});
