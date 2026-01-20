import { describe, it, expect, vi, beforeEach } from "vitest";

const { warnSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  createLogger: vi.fn(() => ({ warn: warnSpy })),
  toNonEmptyString: vi.fn(),
}));

const memoryMocks = vi.hoisted(() => ({
  L0_SET_TASK_GOAL: "L0/SET_TASK_GOAL",
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  createLogger: sharedMocks.createLogger,
  toNonEmptyString: sharedMocks.toNonEmptyString,
}));

vi.mock("../../../../../../js/agents/plugins/memory/index.js", () => ({
  L0_SET_TASK_GOAL: memoryMocks.L0_SET_TASK_GOAL,
}));

import { TaskState } from "../../../../../../js/agents/stages/deepsearch/state/task-state.js";

beforeEach(() => {
  warnSpy.mockReset();
  sharedMocks.toNonEmptyString.mockReset();
  sharedMocks.toNonEmptyString.mockImplementation((value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });
});

describe("TaskState", () => {
  it("returns taskGoal from state engine snapshot when available", () => {
    const engine = {
      _getStateRef: vi.fn(() => ({ L0: { taskGoal: "engine-goal" } })),
    };
    const root = {
      _stateEngine: engine,
      _memoryStore: { L0: { taskGoal: "mem-goal" } },
      _localTaskGoal: "local-goal",
    };

    const state = new TaskState(root);
    expect(state.taskGoal).toBe("engine-goal");
    expect(engine._getStateRef).toHaveBeenCalledTimes(1);
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledWith("engine-goal");
  });

  it("uses getState when _getStateRef is missing", () => {
    const engine = {
      getState: vi.fn(() => ({ L0: { taskGoal: "engine-get" } })),
    };
    const root = {
      _stateEngine: engine,
      _memoryStore: { L0: { taskGoal: "mem-goal" } },
    };

    const state = new TaskState(root);
    expect(state.taskGoal).toBe("engine-get");
    expect(engine.getState).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory store when engine goal is empty", () => {
    const engine = {
      _getStateRef: vi.fn(() => ({ L0: { taskGoal: "   " } })),
    };
    const root = {
      _stateEngine: engine,
      _memoryStore: { L0: { taskGoal: "mem-goal" } },
      _localTaskGoal: "local-goal",
    };

    const state = new TaskState(root);
    expect(state.taskGoal).toBe("mem-goal");
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledWith("   ");
  });

  it("logs warning and falls back when state engine read fails", () => {
    const engine = {
      _getStateRef: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const root = {
      _stateEngine: engine,
      _memoryStore: { L0: { taskGoal: "mem-goal" } },
    };

    const state = new TaskState(root);
    expect(state.taskGoal).toBe("mem-goal");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe("TaskState.taskGoal: state engine read failed");
    expect(warnSpy.mock.calls[0][1]).toEqual({ error: "boom" });
  });

  it("falls back to local task goal or empty string when memory store is falsey", () => {
    const state1 = new TaskState({ _localTaskGoal: "local" });
    expect(state1.taskGoal).toBe("local");

    const state2 = new TaskState({
      _memoryStore: { L0: { taskGoal: 0 } },
      _localTaskGoal: "local2",
    });
    expect(state2.taskGoal).toBe("local2");

    const state3 = new TaskState({ _memoryStore: { L0: { taskGoal: "" } } });
    expect(state3.taskGoal).toBe("");

    const state4 = new TaskState(undefined);
    expect(state4.taskGoal).toBe("");
  });

  it("returns memory store goals for truthy non-strings and deep nesting", () => {
    const emptyArray = [];
    const emptyObject = {};

    const arrayState = new TaskState({ _memoryStore: { L0: { taskGoal: emptyArray } } });
    expect(arrayState.taskGoal).toBe(emptyArray);

    const objectState = new TaskState({ _memoryStore: { L0: { taskGoal: emptyObject } } });
    expect(objectState.taskGoal).toBe(emptyObject);

    let deep = { level: 0 };
    let cursor = deep;
    for (let i = 1; i < 120; i += 1) {
      cursor.next = { level: i };
      cursor = cursor.next;
    }

    const deepState = new TaskState({ _memoryStore: { L0: { taskGoal: deep } } });
    expect(deepState.taskGoal).toBe(deep);
  });

  it("dispatches taskGoal updates and writes to memory store setTaskGoal", () => {
    const dispatchSync = vi.fn();
    const setTaskGoal = vi.fn();
    const root = {
      _stateEngine: { dispatchSync },
      _memoryStore: { setTaskGoal },
      _localTaskGoal: "old",
    };

    const state = new TaskState(root);
    state.taskGoal = "  new goal  ";

    expect(dispatchSync).toHaveBeenCalledTimes(1);
    expect(dispatchSync).toHaveBeenCalledWith({
      type: memoryMocks.L0_SET_TASK_GOAL,
      payload: { goal: "new goal" },
    });
    expect(setTaskGoal).toHaveBeenCalledWith("new goal");
    expect(root._localTaskGoal).toBe("new goal");
    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledWith("  new goal  ");
  });

  it("writes taskGoal to memory store L0 when setTaskGoal is missing", () => {
    const memoryStore = { L0: {} };
    const state = new TaskState({ _memoryStore: memoryStore });

    state.taskGoal = "value";

    expect(memoryStore.L0.taskGoal).toBe("value");
    expect(state.taskGoal).toBe("value");
  });

  it("logs warning on dispatch failure but still stores taskGoal", () => {
    const dispatchSync = vi.fn(() => {
      throw new Error("dispatch boom");
    });
    const memoryStore = { L0: {} };
    const root = { _stateEngine: { dispatchSync }, _memoryStore: memoryStore };

    const state = new TaskState(root);
    state.taskGoal = "goal";

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe("TaskState.taskGoal: state engine dispatch failed");
    expect(warnSpy.mock.calls[0][1]).toEqual({ error: "dispatch boom" });
    expect(memoryStore.L0.taskGoal).toBe("goal");
    expect(root._localTaskGoal).toBe("goal");
  });

  it("normalizes boundary values and type edges for taskGoal", () => {
    const root = { _memoryStore: { L0: {} } };
    const state = new TaskState(root);

    const cases = [
      { value: null, expected: "" },
      { value: undefined, expected: "" },
      { value: "", expected: "" },
      { value: "   ", expected: "" },
      { value: [], expected: "" },
      { value: {}, expected: "[object Object]" },
      { value: 0, expected: "0" },
      { value: -1, expected: "-1" },
      { value: Number.MAX_SAFE_INTEGER, expected: String(Number.MAX_SAFE_INTEGER) },
      { value: "42", expected: "42" },
      { value: { 0: "a", length: 1 }, expected: "[object Object]" },
    ];

    for (const { value, expected } of cases) {
      state.taskGoal = value;
      expect(root._memoryStore.L0.taskGoal).toBe(expected);
      expect(root._localTaskGoal).toBe(expected);
    }

    expect(sharedMocks.toNonEmptyString).toHaveBeenCalledTimes(cases.length);
  });

  it("supports large taskGoal payloads", () => {
    const root = { _memoryStore: { L0: {} } };
    const state = new TaskState(root);
    const huge = "x".repeat(1024 * 1024);

    state.taskGoal = huge;

    expect(root._memoryStore.L0.taskGoal).toBe(huge);
    expect(root._localTaskGoal).toBe(huge);
    expect(root._localTaskGoal.length).toBe(huge.length);
  });

  it("handles rapid consecutive taskGoal updates", async () => {
    const root = { _memoryStore: { L0: {} } };
    const state = new TaskState(root);
    const values = ["first", "second", "third"];

    await Promise.all(values.map((value) => Promise.resolve().then(() => {
      state.taskGoal = value;
    })));

    expect(state.taskGoal).toBe("third");
    expect(root._localTaskGoal).toBe("third");
    expect(root._memoryStore.L0.taskGoal).toBe("third");
  });

  it("awaitUserFeedback getter prefers memory store boolean and falls back", () => {
    const state1 = new TaskState({
      _memoryStore: { awaitUserFeedback: false },
      L2: { awaitUserFeedback: true },
    });
    expect(state1.awaitUserFeedback).toBe(false);

    const state2 = new TaskState({
      _memoryStore: { awaitUserFeedback: "false" },
      L2: { awaitUserFeedback: true },
    });
    expect(state2.awaitUserFeedback).toBe(true);

    const state3 = new TaskState({ L2: { awaitUserFeedback: true } });
    expect(state3.awaitUserFeedback).toBe(true);

    const state4 = new TaskState({});
    expect(state4.awaitUserFeedback).toBe(false);
  });

  it("awaitUserFeedback setter coerces values and updates stores", () => {
    const root = { _memoryStore: {}, L2: {} };
    const state = new TaskState(root);

    const cases = [
      { value: 0, expected: false },
      { value: "0", expected: true },
      { value: "", expected: false },
      { value: [], expected: true },
      { value: { length: 0 }, expected: true },
    ];

    for (const { value, expected } of cases) {
      state.awaitUserFeedback = value;
      expect(root._memoryStore.awaitUserFeedback).toBe(expected);
      expect(root.L2.awaitUserFeedback).toBe(expected);
    }
  });

  it("taskImpossible getter prefers memory store boolean and falls back", () => {
    const state1 = new TaskState({
      _memoryStore: { taskImpossible: true },
      L2: { taskImpossible: false },
    });
    expect(state1.taskImpossible).toBe(true);

    const state2 = new TaskState({
      _memoryStore: { taskImpossible: "nope" },
      L2: { taskImpossible: false },
    });
    expect(state2.taskImpossible).toBe(false);

    const state3 = new TaskState({ L2: { taskImpossible: true } });
    expect(state3.taskImpossible).toBe(true);

    const state4 = new TaskState({});
    expect(state4.taskImpossible).toBe(false);
  });

  it("taskImpossible setter coerces values and updates stores", () => {
    const root = { _memoryStore: {}, L2: {} };
    const state = new TaskState(root);

    const cases = [
      { value: null, expected: false },
      { value: 1, expected: true },
      { value: "", expected: false },
      { value: "yes", expected: true },
      { value: {}, expected: true },
    ];

    for (const { value, expected } of cases) {
      state.taskImpossible = value;
      expect(root._memoryStore.taskImpossible).toBe(expected);
      expect(root.L2.taskImpossible).toBe(expected);
    }
  });
});
