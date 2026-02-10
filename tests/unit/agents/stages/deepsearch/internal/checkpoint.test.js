import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }));
const mockEnsureTokenUsage = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    createLogger: vi.fn(() => mockLogger),
    createCheckpoint: vi.fn((state, meta) => ({ state, meta, timestamp: 0 })),
    CheckpointType: { ARCHIVE: "archive" },
  };
});

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/state-utils.js", async () => {
  const actual = await vi.importActual("../../../../../../js/agents/stages/deepsearch/utils/state-utils.js");
  mockEnsureTokenUsage.mockImplementation(actual.ensureTokenUsage);
  return { ...actual, ensureTokenUsage: mockEnsureTokenUsage };
});

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/todo-utils.js", () => ({
  migratGapToTodo: vi.fn(() => null),
}));

import {
  CHECKPOINT_SCHEMA_VERSION,
  normalizeCheckpointStrategy,
  getCheckpointStrategyFromState,
  cloneValue,
  buildLiteSnapshot,
} from "../../../../../../js/agents/stages/deepsearch/internal/checkpoint.js";
import { CheckpointMode } from "../../../../../../js/agents/stages/deepsearch/constants.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CHECKPOINT_SCHEMA_VERSION", () => {
  it("exposes the current schema version string", () => {
    expect(CHECKPOINT_SCHEMA_VERSION).toBe("1.0");
    expect(typeof CHECKPOINT_SCHEMA_VERSION).toBe("string");
    expect(CHECKPOINT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});

describe("normalizeCheckpointStrategy", () => {
  it("normalizes known modes case-insensitively", () => {
    expect(normalizeCheckpointStrategy("FULL")).toBe(CheckpointMode.FULL);
    expect(normalizeCheckpointStrategy("Minimal")).toBe(CheckpointMode.MINIMAL);
    expect(normalizeCheckpointStrategy(" lite ")).toBe(CheckpointMode.LITE);
  });

  it("defaults to LITE for empty, whitespace, or invalid values", () => {
    const inputs = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, {}, [], "123"];
    for (const input of inputs) {
      expect(normalizeCheckpointStrategy(input)).toBe(CheckpointMode.LITE);
    }
  });

  it("handles rapid concurrent normalization", async () => {
    const values = ["FULL", "minimal", "unknown", "", "   ", 0, Number.MAX_SAFE_INTEGER];
    const results = await Promise.all(values.map((v) => Promise.resolve(normalizeCheckpointStrategy(v))));
    expect(results).toEqual([
      CheckpointMode.FULL,
      CheckpointMode.MINIMAL,
      CheckpointMode.LITE,
      CheckpointMode.LITE,
      CheckpointMode.LITE,
      CheckpointMode.LITE,
      CheckpointMode.LITE,
    ]);
  });
});

describe("getCheckpointStrategyFromState", () => {
  it("prefers explicit overrides over state", () => {
    const state = { userConfig: { checkpointStrategy: "minimal" } };
    expect(getCheckpointStrategyFromState(state, "FULL")).toBe(CheckpointMode.FULL);
  });

  it("reads the strategy from state when override is undefined", () => {
    const state = { userConfig: { checkpointStrategy: "minimal" } };
    expect(getCheckpointStrategyFromState(state)).toBe(CheckpointMode.MINIMAL);
  });

  it("falls back to the default when state is missing or values are empty", () => {
    expect(getCheckpointStrategyFromState(null)).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState({ userConfig: { checkpointStrategy: "" } })).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState({ userConfig: { checkpointStrategy: "   " } }, undefined)).toBe(
      CheckpointMode.LITE
    );
  });

  it("treats explicit empty overrides as default", () => {
    const state = { userConfig: { checkpointStrategy: "full" } };
    expect(getCheckpointStrategyFromState(state, "")).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState(state, null)).toBe(CheckpointMode.LITE);
  });

  it("handles boundary numeric overrides and type coercion", () => {
    const state = { userConfig: { checkpointStrategy: "full" } };
    expect(getCheckpointStrategyFromState(state, 0)).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState(state, -1)).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState(state, Number.MAX_SAFE_INTEGER)).toBe(CheckpointMode.LITE);
    expect(getCheckpointStrategyFromState(state, "123")).toBe(CheckpointMode.LITE);
  });

  it("supports concurrent calls without shared state", async () => {
    const cases = [
      [{ userConfig: { checkpointStrategy: "full" } }, undefined, CheckpointMode.FULL],
      [{ userConfig: { checkpointStrategy: "minimal" } }, undefined, CheckpointMode.MINIMAL],
      [null, "FULL", CheckpointMode.FULL],
      [{ userConfig: { checkpointStrategy: "full" } }, "", CheckpointMode.LITE],
    ];
    const results = await Promise.all(
      cases.map(([state, override]) => Promise.resolve(getCheckpointStrategyFromState(state, override)))
    );
    expect(results).toEqual(cases.map(([, , expected]) => expected));
  });
});

describe("cloneValue", () => {
  it("returns primitive values unchanged", () => {
    const values = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, true, false];
    for (const value of values) {
      expect(cloneValue(value)).toBe(value);
    }
  });

  it("delegates cloning without relying on global structuredClone", () => {
    const structuredClone = vi.fn(() => ({ cloned: true }));
    vi.stubGlobal("structuredClone", structuredClone);

    const input = { a: 1 };
    const output = cloneValue(input);

    expect(structuredClone).not.toHaveBeenCalled();
    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });

  it("clones successfully even when global structuredClone throws", () => {
    const structuredClone = vi.fn(() => {
      throw new Error("boom");
    });
    vi.stubGlobal("structuredClone", structuredClone);

    const input = { a: 1, b: { c: 2 } };
    const output = cloneValue(input);

    expect(output).toEqual({ a: 1, b: { c: 2 } });
    expect(output).not.toBe(input);
    expect(output.b).not.toBe(input.b);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it("preserves circular references in cloned output", () => {
    const structuredClone = vi.fn(() => ({ cloned: true }));
    vi.stubGlobal("structuredClone", structuredClone);

    const input = { name: "root" };
    input.self = input;

    const output = cloneValue(input);

    expect(structuredClone).not.toHaveBeenCalled();
    expect(output).not.toBe(input);
    expect(output.name).toBe("root");
    expect(output.self).toBe(output);
  });

  it("clones arrays, dates, regexes, maps, and sets in fallback mode", () => {
    vi.stubGlobal("structuredClone", undefined);

    const date = new Date("2023-01-01T00:00:00Z");
    const regex = /abc/gi;
    const keyObj = { k: 1 };
    const mapValObj = { v: 2 };
    const setValObj = { v: 3 };
    const map = new Map([
      ["a", 1],
      [keyObj, mapValObj],
    ]);
    const set = new Set([1, setValObj]);
    const input = { date, regex, map, set, list: [1, { deep: true }] };

    const output = cloneValue(input);

    expect(output).not.toBe(input);
    expect(output.list).not.toBe(input.list);
    expect(output.list[1]).not.toBe(input.list[1]);
    expect(output.date).toBeInstanceOf(Date);
    expect(output.date.getTime()).toBe(date.getTime());
    expect(output.date).not.toBe(date);
    expect(output.regex).toBeInstanceOf(RegExp);
    expect(output.regex.source).toBe(regex.source);
    expect(output.regex.flags).toBe(regex.flags);

    expect(output.map).toBeInstanceOf(Map);
    expect(output.map.size).toBe(2);
    const clonedKeyObj = [...output.map.keys()].find((key) => typeof key === "object");
    const clonedValObj = output.map.get(clonedKeyObj);
    expect(clonedKeyObj).not.toBe(keyObj);
    expect(clonedValObj).not.toBe(mapValObj);
    expect(clonedValObj).toEqual({ v: 2 });

    expect(output.set).toBeInstanceOf(Set);
    expect(output.set.size).toBe(2);
    const setObjects = [...output.set].filter((value) => typeof value === "object");
    expect(setObjects[0]).not.toBe(setValObj);
    expect(setObjects[0]).toEqual({ v: 3 });
  });

  it("retains enumerable keys when cloning plain objects", () => {
    vi.stubGlobal("structuredClone", undefined);

    const input = Object.create(null);
    Object.defineProperty(input, "safe", { value: 1, enumerable: true });
    Object.defineProperty(input, "__proto__", { value: { polluted: true }, enumerable: true });
    Object.defineProperty(input, "constructor", { value: { hacked: true }, enumerable: true });
    Object.defineProperty(input, "prototype", { value: { sneaky: true }, enumerable: true });

    const output = cloneValue(input);

    expect(output.safe).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(output, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(output, "constructor")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(output, "prototype")).toBe(true);
    expect(output["__proto__"]).toEqual({ polluted: true });
    expect(output.constructor).toEqual({ hacked: true });
    expect(output.prototype).toEqual({ sneaky: true });
  });

  it("handles deep nesting, long strings, and rapid cloning", async () => {
    vi.stubGlobal("structuredClone", undefined);

    const longString = "x".repeat(100_000);
    const root = { level: 0, payload: longString };
    let node = root;
    for (let i = 1; i <= 50; i += 1) {
      node.child = { level: i };
      node = node.child;
    }

    const clones = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve(cloneValue(root))));

    for (const clone of clones) {
      expect(clone).not.toBe(root);
      expect(clone.payload.length).toBe(longString.length);
      expect(clone.child.level).toBe(1);
    }
    expect(clones[0].child).not.toBe(clones[1].child);
  });
});

describe("buildLiteSnapshot", () => {
  it("builds a snapshot with expected fields and clones", () => {
    const planningTree = { serialize: vi.fn(() => ({ root: "plan" })) };
    const state = {
      schemaVersion: "state.v1",
      runId: "run-1",
      createdAt: 1234,
      taskGoal: "goal",
      userConfig: { checkpointStrategy: "full", nested: { maxTokens: 10 } },
      planningTree,
      trajectoryId: "traj-1",
      trajectoryConfig: { mode: "fast" },
      iteration: 2,
      maxIterations: 10,
      writeBacktrackCount: 1,
      writeSnapshots: [{ id: 1 }],
      L0: { sources: [{ id: "s1" }, { id: "s2" }], sourceIndex: { s1: 0 } },
      L1: { gaps: [{ gapId: "g1" }, { gapId: " " }, { gapId: 0 }], claims: [{}, {}] },
      L2: {
        retrievedChunks: [{ chunkId: "c1" }, { chunkId: "" }, { chunkId: 0 }, {}],
        tokenUsage: { input: 1, output: 2, total: 3, estimatedCostUSD: 0.1 },
        awaitUserFeedback: true,
        taskImpossible: false,
        reason: " because ",
      },
      todos: [{ id: "todo1" }],
      timeline: [{ at: 1 }],
    };

    const snapshot = buildLiteSnapshot(state);

    expect(snapshot.snapshotStrategy).toBe(CheckpointMode.LITE);
    expect(snapshot.checkpointSchemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(snapshot.schemaVersion).toBe("state.v1");
    expect(snapshot.runId).toBe("run-1");
    expect(snapshot.planningTree).toEqual({ root: "plan" });
    expect(planningTree.serialize).toHaveBeenCalled();

    expect(snapshot.userConfig).toEqual(state.userConfig);
    expect(snapshot.userConfig).not.toBe(state.userConfig);
    expect(snapshot.userConfig.nested).not.toBe(state.userConfig.nested);

    expect(snapshot.trajectoryId).toBe("traj-1");
    expect(snapshot.trajectoryConfig).toEqual({ mode: "fast" });

    expect(snapshot.L0).toEqual({
      sourcesRef: "state.L0.sources",
      sourceIndexRef: "state.L0.sourceIndex",
      sourcesCount: 2,
      hasSourceIndex: true,
    });

    expect(snapshot.L1Summary).toEqual({
      gapCount: 3,
      claimCount: 2,
      gapIds: ["g1", "0"],
    });

    expect(mockEnsureTokenUsage).toHaveBeenCalledWith(state.L2.tokenUsage);
    const tokenUsage = mockEnsureTokenUsage.mock.results[0].value;
    expect(snapshot.L2).toEqual({
      retrievedChunkIds: ["c1", "0"],
      tokenUsage,
      incomplete: true,
      awaitUserFeedback: true,
      taskImpossible: false,
      reason: "because",
    });

    expect(snapshot.todos).toEqual(state.todos);
    expect(snapshot.todos).not.toBe(state.todos);
    expect(snapshot.timeline).toEqual(state.timeline);
    expect(snapshot.timeline).not.toBe(state.timeline);
  });

  it("throws when state is null or undefined", () => {
    expect(() => buildLiteSnapshot(null)).toThrow(TypeError);
    expect(() => buildLiteSnapshot(undefined)).toThrow(TypeError);
  });

  it("handles empty arrays, empty objects, and malformed nested data", () => {
    const state = {
      schemaVersion: "state.v1",
      runId: "run-2",
      createdAt: 0,
      taskGoal: "",
      userConfig: {},
      L0: { sources: {}, sourceIndex: 0 },
      L1: { gaps: [], claims: [] },
      L2: { retrievedChunks: {}, tokenUsage: null, awaitUserFeedback: "yes", taskImpossible: 1, reason: " " },
      todos: [],
      timeline: {},
    };

    const snapshot = buildLiteSnapshot(state);

    expect(snapshot.L0.sourcesCount).toBe(0);
    expect(snapshot.L0.hasSourceIndex).toBe(false);
    expect(snapshot.L1Summary).toEqual({ gapCount: 0, claimCount: 0, gapIds: [] });
    expect(snapshot.L2.retrievedChunkIds).toEqual([]);
    expect(snapshot.L2.awaitUserFeedback).toBe(false);
    expect(snapshot.L2.taskImpossible).toBe(false);
    expect(snapshot.L2.reason).toBe("");
  });

  it("omits invalid trajectory fields and preserves large payloads", async () => {
    const longGoal = "g".repeat(120_000);
    const state = {
      schemaVersion: "state.v1",
      runId: "run-3",
      createdAt: 99,
      taskGoal: longGoal,
      trajectoryId: "   ",
      trajectoryConfig: [],
      userConfig: { nested: { depth: { value: "x" } } },
      L0: { sources: Array.from({ length: 500 }, (_, i) => ({ id: "s" + i })), sourceIndex: {} },
      L1: { gaps: [{ gapId: "g" }], claims: [] },
      L2: { retrievedChunks: [], tokenUsage: undefined },
      todos: [],
      timeline: [],
    };

    const snapshots = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(buildLiteSnapshot(state)))
    );

    for (const snapshot of snapshots) {
      expect(snapshot.taskGoal.length).toBe(longGoal.length);
      expect(snapshot).not.toHaveProperty("trajectoryId");
      expect(snapshot).not.toHaveProperty("trajectoryConfig");
      expect(snapshot.userConfig).toEqual(state.userConfig);
      expect(snapshot.userConfig).not.toBe(state.userConfig);
      expect(snapshot.L0.sourcesCount).toBe(500);
    }
    expect(snapshots[0].userConfig).not.toBe(snapshots[1].userConfig);
  });
});
