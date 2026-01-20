import { describe, it, expect, vi, beforeEach } from "vitest";

const { isPlainObject, toNonEmptyString, sanitizeForJson, cloneValue, Deque } = vi.hoisted(() => {
  const isPlainObject = vi.fn();
  const toNonEmptyString = vi.fn();
  const sanitizeForJson = vi.fn();
  const cloneValue = vi.fn();
  class Deque {
    constructor(items = []) {
      this.items = items;
    }
    toArray() {
      return Array.isArray(this.items) ? [...this.items] : [];
    }
  }
  return { isPlainObject, toNonEmptyString, sanitizeForJson, cloneValue, Deque };
});

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  isPlainObject,
  toNonEmptyString,
  sanitizeForJson,
  Deque,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/internal/checkpoint.js", () => ({
  cloneValue,
}));

import {
  buildCheckpointReferences,
  buildStateSnapshot,
  toJSON,
  toSnapshot,
  fromSnapshot,
} from "../../../../../../js/agents/stages/deepsearch/state/serializer.js";

const makeDeepNested = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

const createState = (overrides = {}) => ({
  schemaVersion: "1.0",
  runId: "run_1",
  createdAt: "2024-01-01T00:00:00.000Z",
  taskGoal: "",
  userConfig: {},
  planningTree: null,
  trajectoryId: "",
  trajectoryConfig: undefined,
  iteration: 0,
  maxIterations: 0,
  checkpoints: [],
  writeBacktrackCount: 0,
  writeSnapshots: [],
  L0: {},
  L1: {},
  L2: {},
  todos: [],
  timeline: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });
  toNonEmptyString.mockImplementation((value) => typeof value === "string" && value.trim().length > 0);
  sanitizeForJson.mockImplementation((value) => value);
  cloneValue.mockImplementation((value) => ({ cloned: value }));
});

describe("buildCheckpointReferences", () => {
  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "empty object", value: {} },
    { label: "object as array", value: { 0: { checkpointId: "cp" } } },
  ])("returns empty array for $label input", ({ value }) => {
    expect(buildCheckpointReferences(value)).toEqual([]);
  });

  it("returns empty array for an empty array", () => {
    expect(buildCheckpointReferences([])).toEqual([]);
  });

  it("maps checkpoint objects and strips snapshot payloads", () => {
    const deepStrategy = { level1: { level2: { value: "x".repeat(2000) } } };
    const checkpoints = [
      {
        schemaVersion: "v1",
        checkpointId: "cp_1",
        iteration: 0,
        timestamp: "2024-01-01T00:00:00.000Z",
        strategy: deepStrategy,
        metrics: { count: 1 },
        stateSnapshot: { ignore: true },
      },
      {
        schemaVersion: "v2",
        checkpointId: "",
        iteration: -1,
        timestamp: "",
        strategy: null,
        metrics: {},
        stateSnapshot: null,
      },
      {
        schemaVersion: "v3",
        checkpointId: "cp_3",
        iteration: Number.MAX_SAFE_INTEGER,
        timestamp: " ",
        strategy: { nested: { depth: makeDeepNested(3) } },
        metrics: { large: "z".repeat(5000) },
      },
      {
        schemaVersion: "v4",
        checkpointId: "cp_4",
        iteration: "5",
        timestamp: "t4",
        strategy: {},
        metrics: { count: 0 },
      },
      "invalid",
      null,
    ];

    const result = buildCheckpointReferences(checkpoints);

    expect(result).toHaveLength(checkpoints.length);
    expect(result[0]).toEqual({
      schemaVersion: "v1",
      checkpointId: "cp_1",
      iteration: 0,
      timestamp: "2024-01-01T00:00:00.000Z",
      strategy: deepStrategy,
      metrics: { count: 1 },
    });
    expect(result[0]).not.toHaveProperty("stateSnapshot");
    expect(result[1].iteration).toBe(-1);
    expect(result[2].iteration).toBe(Number.MAX_SAFE_INTEGER);
    expect(result[3].iteration).toBe("5");
    expect(result[4]).toEqual({
      schemaVersion: undefined,
      checkpointId: undefined,
      iteration: undefined,
      timestamp: undefined,
      strategy: undefined,
      metrics: undefined,
    });
    expect(result[5]).toEqual({
      schemaVersion: undefined,
      checkpointId: undefined,
      iteration: undefined,
      timestamp: undefined,
      strategy: undefined,
      metrics: undefined,
    });
  });
});

describe("buildStateSnapshot", () => {
  it("builds full snapshot with serialized planningTree, checkpoints, and Deque timeline", () => {
    const longString = "g".repeat(200000);
    const planningTree = { serialize: vi.fn(() => ({ root: "ok" })) };
    const deque = new Deque(["t1", "t2"]);
    const toArraySpy = vi.spyOn(deque, "toArray");
    const checkpointSnapshot = { payload: makeDeepNested(4) };
    const state = createState({
      taskGoal: longString,
      userConfig: { deep: makeDeepNested(10), flag: true },
      planningTree,
      trajectoryId: "traj-1",
      trajectoryConfig: { mode: "full" },
      iteration: 0,
      maxIterations: -1,
      checkpoints: [{ checkpointId: "cp", stateSnapshot: checkpointSnapshot }],
      writeBacktrackCount: Number.MAX_SAFE_INTEGER,
      writeSnapshots: [{ file: longString }],
      L2: { nested: makeDeepNested(3) },
      timeline: deque,
    });

    const snapshot = buildStateSnapshot(state);

    expect(planningTree.serialize).toHaveBeenCalledTimes(1);
    expect(snapshot.planningTree).toEqual({ root: "ok" });
    expect(snapshot.trajectoryId).toBe("traj-1");
    expect(snapshot.trajectoryConfig).toEqual({ mode: "full" });
    expect(snapshot.checkpoints).toBe(state.checkpoints);
    expect(snapshot.checkpoints[0].stateSnapshot).toBe(checkpointSnapshot);
    expect(snapshot.timeline).toEqual(["t1", "t2"]);
    expect(toArraySpy).toHaveBeenCalledTimes(1);
    expect(snapshot.iteration).toBe(0);
    expect(snapshot.maxIterations).toBe(-1);
    expect(snapshot.writeBacktrackCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(snapshot.taskGoal.length).toBe(longString.length);
  });

  it("omits optional fields when blank and includeCheckpoints is false", () => {
    const timeline = ["t1"];
    const state = createState({
      planningTree: { noSerialize: true },
      trajectoryId: "   ",
      trajectoryConfig: ["not plain"],
      checkpoints: [{ checkpointId: "cp", stateSnapshot: {} }],
      timeline,
    });

    const snapshot = buildStateSnapshot(state, { includeCheckpoints: false });

    expect(snapshot.planningTree).toBeNull();
    expect(snapshot).not.toHaveProperty("trajectoryId");
    expect(snapshot).not.toHaveProperty("trajectoryConfig");
    expect(snapshot).not.toHaveProperty("checkpoints");
    expect(snapshot.timeline).toBe(timeline);
  });

  it("builds checkpoint references when includeCheckpointSnapshots is false", () => {
    const checkpoints = [
      {
        schemaVersion: "v1",
        checkpointId: "cp1",
        iteration: 1,
        timestamp: "t1",
        strategy: { mode: "x" },
        metrics: { ok: true },
        stateSnapshot: { data: "x" },
      },
      { checkpointId: "cp2", iteration: 2, stateSnapshot: null },
    ];
    const state = createState({ checkpoints });

    const snapshot = buildStateSnapshot(state, { includeCheckpoints: true, includeCheckpointSnapshots: false });

    expect(snapshot.checkpoints).toHaveLength(2);
    expect(snapshot.checkpoints[0]).toMatchObject({
      schemaVersion: "v1",
      checkpointId: "cp1",
      iteration: 1,
      timestamp: "t1",
      strategy: { mode: "x" },
      metrics: { ok: true },
    });
    expect(snapshot.checkpoints[0]).not.toHaveProperty("stateSnapshot");
  });

  it("preserves non-array checkpoints and string iteration when snapshots are included", () => {
    const checkpoints = { checkpointId: "cp_obj" };
    const state = createState({
      iteration: "1",
      trajectoryId: "",
      trajectoryConfig: {},
      checkpoints,
    });

    const snapshot = buildStateSnapshot(state, { includeCheckpoints: true, includeCheckpointSnapshots: true });

    expect(snapshot.checkpoints).toBe(checkpoints);
    expect(snapshot.iteration).toBe("1");
    expect(snapshot).not.toHaveProperty("trajectoryId");
    expect(snapshot.trajectoryConfig).toEqual({});
  });
});

describe("toJSON", () => {
  it("sanitizes snapshot and strips checkpoint snapshots by default", () => {
    sanitizeForJson.mockImplementation((value) => ({ sanitized: true, payload: value }));
    const state = createState({
      checkpoints: [{ checkpointId: "cp1", iteration: 1, stateSnapshot: { data: "x" } }],
    });

    const result = toJSON(state);

    expect(sanitizeForJson).toHaveBeenCalledTimes(1);
    expect(result.sanitized).toBe(true);
    expect(result.payload.checkpoints).toHaveLength(1);
    expect(result.payload.checkpoints[0]).not.toHaveProperty("stateSnapshot");
  });

  it("respects includeCheckpoints false", () => {
    const state = createState({
      checkpoints: [{ checkpointId: "cp1", iteration: 1, stateSnapshot: { data: "x" } }],
    });

    const result = toJSON(state, { includeCheckpoints: false });

    expect(result).not.toHaveProperty("checkpoints");
  });

  it("handles concurrent calls with large payloads", async () => {
    const payload = "a".repeat(150000);
    const stateA = createState({ runId: "run_a", taskGoal: payload });
    const stateB = createState({ runId: "run_b", taskGoal: `${payload}b` });

    const [resultA, resultB] = await Promise.all([
      Promise.resolve().then(() => toJSON(stateA)),
      Promise.resolve().then(() => toJSON(stateB)),
    ]);

    expect(resultA.runId).toBe("run_a");
    expect(resultB.runId).toBe("run_b");
    expect(resultA.taskGoal.length).toBe(payload.length);
    expect(resultB.taskGoal.length).toBe(payload.length + 1);
  });
});

describe("toSnapshot", () => {
  it("clones snapshot with checkpoint snapshots and deep nested payloads", () => {
    const deepNested = makeDeepNested(12);
    const hugeText = "h".repeat(120000);
    const state = createState({
      taskGoal: hugeText,
      L2: { nested: deepNested },
      checkpoints: [{ checkpointId: "cp1", stateSnapshot: { deep: deepNested } }],
    });

    const result = toSnapshot(state);

    expect(cloneValue).toHaveBeenCalledTimes(1);
    const snapshotArg = cloneValue.mock.calls[0][0];
    expect(snapshotArg.checkpoints[0].stateSnapshot).toEqual({ deep: deepNested });
    expect(snapshotArg.L2).toEqual({ nested: deepNested });
    expect(snapshotArg.taskGoal.length).toBe(hugeText.length);
    expect(result).toEqual({ cloned: snapshotArg });
  });

  it("omits checkpoints when includeCheckpoints is false and supports rapid sequential calls", () => {
    const stateA = createState({ runId: "run_a", checkpoints: [{ checkpointId: "cp1" }] });
    const stateB = createState({ runId: "run_b", checkpoints: [{ checkpointId: "cp2" }] });

    const resultA = toSnapshot(stateA, { includeCheckpoints: false });
    const resultB = toSnapshot(stateB, { includeCheckpoints: false });

    expect(cloneValue).toHaveBeenCalledTimes(2);
    expect(cloneValue.mock.calls[0][0]).not.toHaveProperty("checkpoints");
    expect(cloneValue.mock.calls[1][0]).not.toHaveProperty("checkpoints");
    expect(resultA.cloned.runId).toBe("run_a");
    expect(resultB.cloned.runId).toBe("run_b");
  });
});

describe("fromSnapshot", () => {
  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: "   " },
    { label: "number", value: 0 },
    { label: "array", value: [] },
  ])("throws when json is not a plain object ($label)", ({ value }) => {
    expect(() => fromSnapshot(value)).toThrow(TypeError);
  });

  it("accepts empty and null-prototype objects", () => {
    const empty = {};
    const nullProto = Object.create(null);
    nullProto.value = 1;

    expect(fromSnapshot(empty)).toBe(empty);
    expect(fromSnapshot(nullProto)).toBe(nullProto);
  });

  it("accepts deep nested objects and returns the same reference", () => {
    const deep = makeDeepNested(20);
    const wrapper = { deep, list: [1, 2, 3], text: "x".repeat(1000) };

    expect(fromSnapshot(wrapper)).toBe(wrapper);
  });
});
