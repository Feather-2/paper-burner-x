import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/state-utils.js", () => ({
  ensureTokenUsage: (value) => value,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/internal/checkpoint.js", () => ({
  buildLiteSnapshot: () => ({}),
  buildMinimalSnapshot: () => ({}),
  CHECKPOINT_SCHEMA_VERSION: "1.0",
  cloneValue: (value) => value,
  getCheckpointStrategyFromState: () => "full",
  loadCheckpoint: (cp) => cp,
  normalizeCheckpointStrategy: (value) => value,
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/state/serializer.js", () => ({
  buildStateSnapshot: () => ({}),
}));

import { checkpointMethods } from "../../../../../../js/agents/stages/deepsearch/state/checkpoint-methods.js";
import { CheckpointMode } from "../../../../../../js/agents/stages/deepsearch/constants.js";
import * as checkpointModule from "../../../../../../js/agents/stages/deepsearch/internal/checkpoint.js";
import * as serializerModule from "../../../../../../js/agents/stages/deepsearch/state/serializer.js";
import * as stateUtilsModule from "../../../../../../js/agents/stages/deepsearch/utils/state-utils.js";
import { PlanningTree } from "../../../../../../js/agents/stages/deepsearch/state/planning-tree.js";

const buildLiteSnapshotSpy = vi.spyOn(checkpointModule, "buildLiteSnapshot");
const buildMinimalSnapshotSpy = vi.spyOn(checkpointModule, "buildMinimalSnapshot");
const cloneValueSpy = vi.spyOn(checkpointModule, "cloneValue");
const getCheckpointStrategyFromStateSpy = vi.spyOn(checkpointModule, "getCheckpointStrategyFromState");
const loadCheckpointSpy = vi.spyOn(checkpointModule, "loadCheckpoint");
const normalizeCheckpointStrategySpy = vi.spyOn(checkpointModule, "normalizeCheckpointStrategy");
const buildStateSnapshotSpy = vi.spyOn(serializerModule, "buildStateSnapshot");
const ensureTokenUsageSpy = vi.spyOn(stateUtilsModule, "ensureTokenUsage");
const planningTreeFromJSONSpy = vi.spyOn(PlanningTree, "fromJSON");

class FakeStateSnapshot {
  constructor(restored, { hasToSnapshot = true } = {}) {
    this._restored = restored;
    this.toJSON = vi.fn(() => restored);
    if (hasToSnapshot) {
      this.toSnapshot = vi.fn(() => restored);
    }
  }
}

FakeStateSnapshot.fromJSON = vi.fn((json) => new FakeStateSnapshot(json));

const makeDeepNested = (depth) => {
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

const createState = (overrides = {}) => {
  const base = {
    schemaVersion: "1.0",
    runId: "run_1",
    createdAt: "2020-01-01T00:00:00.000Z",
    taskGoal: "goal",
    userConfig: { memory: { maxCheckpoints: 30 } },
    iteration: 0,
    maxIterations: 5,
    L0: { sources: [], sourceIndex: null },
    L1: { gaps: [], claims: [], evidenceLedger: [] },
    L2: {
      retrievedChunks: [],
      tokenUsage: { input: 0, output: 0, total: 0 },
      awaitUserFeedback: false,
      taskImpossible: false,
      reason: "",
    },
    planningTree: new PlanningTree({ rootGoal: "goal", runId: "run_1" }),
    todos: [],
    timeline: [],
    checkpoints: [],
    addTimeline: vi.fn(),
    constructor: FakeStateSnapshot,
  };
  return Object.assign(base, checkpointMethods, overrides);
};

beforeEach(() => {
  vi.clearAllMocks();
  buildStateSnapshotSpy.mockReturnValue({ snapshot: "full" });
  buildMinimalSnapshotSpy.mockReturnValue({ snapshotStrategy: CheckpointMode.MINIMAL, L2: { marker: "minimal" } });
  buildLiteSnapshotSpy.mockReturnValue({ snapshotStrategy: CheckpointMode.LITE, L2: { marker: "lite" } });
  cloneValueSpy.mockImplementation((value) => ({ cloned: value }));
  getCheckpointStrategyFromStateSpy.mockReturnValue(CheckpointMode.FULL);
  loadCheckpointSpy.mockImplementation((cp) => cp);
  normalizeCheckpointStrategySpy.mockImplementation((value) => String(value).trim().toLowerCase());
  ensureTokenUsageSpy.mockImplementation((value) => ({ input: 0, output: 0, total: 0, ...(value || {}) }));
  planningTreeFromJSONSpy.mockImplementation(
    (json) => new PlanningTree({ rootGoal: json?.rootGoal || "", runId: json?.runId || "" })
  );
  FakeStateSnapshot.fromJSON.mockImplementation((json) => new FakeStateSnapshot(json));
});

describe("checkpointMethods.saveCheckpoint", () => {
  it("creates a full checkpoint and skips recording when record is false", () => {
    const state = createState({ iteration: 2 });
    const snapshot = { nested: { value: 1 } };
    buildStateSnapshotSpy.mockReturnValue(snapshot);

    const checkpoint = state.saveCheckpoint({
      checkpointId: "custom",
      timestamp: "2023-01-01T00:00:00.000Z",
      record: false,
    });

    expect(getCheckpointStrategyFromStateSpy).toHaveBeenCalledWith(state, undefined);
    expect(buildStateSnapshotSpy).toHaveBeenCalledWith(state, { includeCheckpoints: false });
    expect(cloneValueSpy).toHaveBeenCalledWith(snapshot);
    expect(checkpoint).toEqual(
      expect.objectContaining({
        schemaVersion: checkpointModule.CHECKPOINT_SCHEMA_VERSION,
        checkpointId: "custom",
        iteration: 2,
        timestamp: "2023-01-01T00:00:00.000Z",
        strategy: CheckpointMode.FULL,
      })
    );
    expect(checkpoint.stateSnapshot).toEqual({ cloned: snapshot });
    expect(state.checkpoints).toHaveLength(0);
  });

  it("defaults checkpointId and timestamp for empty or whitespace values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2022-02-02T02:02:02.000Z"));
    try {
      const state = createState({
        checkpoints: [
          { checkpointId: "cp_1", stateSnapshot: {} },
          { checkpointId: "cp_2", stateSnapshot: {} },
        ],
      });

      const checkpoint = state.saveCheckpoint({ checkpointId: "   ", timestamp: "", record: false });
      expect(checkpoint.checkpointId).toBe("cp_3");
      expect(checkpoint.timestamp).toBe("2022-02-02T02:02:02.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the minimal snapshot builder when strategy is minimal", () => {
    const state = createState();
    const minimalSnapshot = { snapshotStrategy: CheckpointMode.MINIMAL, L2: { minimal: true } };
    getCheckpointStrategyFromStateSpy.mockReturnValue(CheckpointMode.MINIMAL);
    buildMinimalSnapshotSpy.mockReturnValue(minimalSnapshot);

    const checkpoint = state.saveCheckpoint({ record: false });

    expect(buildMinimalSnapshotSpy).toHaveBeenCalledWith(state);
    expect(buildLiteSnapshotSpy).not.toHaveBeenCalled();
    expect(buildStateSnapshotSpy).not.toHaveBeenCalled();
    expect(cloneValueSpy).not.toHaveBeenCalled();
    expect(checkpoint.stateSnapshot).toBe(minimalSnapshot);
  });

  it("uses the lite snapshot builder when strategy is lite", () => {
    const state = createState();
    const liteSnapshot = { snapshotStrategy: CheckpointMode.LITE, L2: { lite: true } };
    getCheckpointStrategyFromStateSpy.mockReturnValue(CheckpointMode.LITE);
    buildLiteSnapshotSpy.mockReturnValue(liteSnapshot);

    const checkpoint = state.saveCheckpoint({ record: false });

    expect(buildLiteSnapshotSpy).toHaveBeenCalledWith(state);
    expect(buildMinimalSnapshotSpy).not.toHaveBeenCalled();
    expect(buildStateSnapshotSpy).not.toHaveBeenCalled();
    expect(cloneValueSpy).not.toHaveBeenCalled();
    expect(checkpoint.stateSnapshot).toBe(liteSnapshot);
  });

  it("counts open gaps and supports falsy statuses when metrics are omitted", () => {
    const state = createState({
      L1: {
        gaps: [{ status: "open" }, { status: "closed" }, {}, { status: 0 }, { status: "open" }],
        claims: [{}, {}],
        evidenceLedger: [{}],
      },
      L2: { retrievedChunks: [{}, {}, {}] },
    });

    const checkpoint = state.saveCheckpoint({ record: false });

    expect(checkpoint.metrics).toEqual({
      gapCount: 4,
      claimCount: 2,
      evidenceCount: 1,
      retrievedCount: 3,
    });
  });

  it("honors metric overrides with string numbers and falls back on invalid values", () => {
    const state = createState({
      L1: { gaps: [{ status: "open" }], claims: [{}, {}, {}], evidenceLedger: [{}, {}] },
      L2: { retrievedChunks: [{}, {}] },
    });

    const checkpoint = state.saveCheckpoint({
      metrics: { gapCount: "5", claimCount: null, evidenceCount: {}, retrievedCount: " 2 " },
      record: false,
    });

    expect(checkpoint.metrics).toEqual({
      gapCount: 5,
      claimCount: 3,
      evidenceCount: 2,
      retrievedCount: 2,
    });
  });

  it("treats non-array L1/L2 fields as empty arrays", () => {
    const state = createState({
      L1: { gaps: {}, claims: { length: 2 }, evidenceLedger: "nope" },
      L2: { retrievedChunks: { length: 10 } },
    });

    const checkpoint = state.saveCheckpoint({ record: false });

    expect(checkpoint.metrics).toEqual({
      gapCount: 0,
      claimCount: 0,
      evidenceCount: 0,
      retrievedCount: 0,
    });
  });

  it("enforces maxCheckpoints cap and shifts older checkpoints", () => {
    const state = createState({ userConfig: { memory: { maxCheckpoints: 2 } } });

    state.saveCheckpoint({ checkpointId: "cp1" });
    state.saveCheckpoint({ checkpointId: "cp2" });
    state.saveCheckpoint({ checkpointId: "cp3" });

    expect(state.checkpoints).toHaveLength(2);
    expect(state.checkpoints[0].checkpointId).toBe("cp2");
    expect(state.checkpoints[1].checkpointId).toBe("cp3");
  });

  it("handles long checkpointId and deep snapshot data", () => {
    const deepSnapshot = makeDeepNested(50);
    const longId = "x".repeat(10000);
    const state = createState({
      L2: { retrievedChunks: [{ chunkId: "big", text: "x".repeat(100000) }] },
    });
    buildStateSnapshotSpy.mockReturnValue(deepSnapshot);

    const checkpoint = state.saveCheckpoint({ checkpointId: longId, record: false });

    expect(checkpoint.checkpointId.length).toBe(10000);
    expect(cloneValueSpy).toHaveBeenCalledWith(deepSnapshot);
    expect(checkpoint.metrics.retrievedCount).toBe(1);
  });

  it("handles rapid consecutive calls without shared-state races", async () => {
    const state = createState();

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => state.saveCheckpoint()),
      Promise.resolve().then(() => state.saveCheckpoint()),
    ]);

    expect(first.checkpointId).toBe("cp_1");
    expect(second.checkpointId).toBe("cp_2");
    expect(state.checkpoints).toHaveLength(2);
  });
});

describe("checkpointMethods.restoreCheckpoint", () => {
  it("throws for empty checkpointId values", () => {
    const state = createState();

    expect(() => state.restoreCheckpoint()).toThrow(TypeError);
    expect(() => state.restoreCheckpoint(null)).toThrow(TypeError);
    expect(() => state.restoreCheckpoint("")).toThrow(TypeError);
    expect(() => state.restoreCheckpoint("   ")).toThrow(TypeError);
  });

  it("propagates errors from _loadCheckpointById", () => {
    const state = createState();
    state._loadCheckpointById = vi.fn(() => {
      throw new Error("load failed");
    });

    expect(() => state.restoreCheckpoint("cp1")).toThrow("load failed");
  });

  it("restores full checkpoints without applying L2 fixups", () => {
    const restored = {
      schemaVersion: "1.0",
      runId: "run_full",
      createdAt: "2021-01-01T00:00:00.000Z",
      taskGoal: "goal_full",
      userConfig: {},
      iteration: 1,
      maxIterations: 5,
      L0: { full: true },
      L1: { full: true },
      L2: { recovered: true },
      planningTree: new PlanningTree({ rootGoal: "goal_full", runId: "run_full" }),
      todos: [],
      timeline: [],
    };
    const cp = {
      checkpointId: "cp_full",
      stateSnapshot: new FakeStateSnapshot(restored),
    };
    const state = createState({ constructor: FakeStateSnapshot });
    state._loadCheckpointById = vi.fn(() => cp);

    const result = state.restoreCheckpoint("cp_full");

    expect(result).toBe(cp);
    expect(ensureTokenUsageSpy).not.toHaveBeenCalled();
    expect(state.L2.restoredFromLiteCheckpoint).toBeUndefined();
    expect(state.L2.restoredFromMinimalCheckpoint).toBeUndefined();
    expect(state.addTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "deepsearch:checkpointRestored",
        status: "info",
        payload: { checkpointId: "cp_full", iteration: state.iteration },
      })
    );
  });

  it("applies lite fixups and preserves core state", () => {
    const restored = {
      L2: { retrievedChunkIds: [1, "2", "", null], tokenUsage: { input: 7 } },
    };
    const cp = {
      checkpointId: "cp_lite",
      stateSnapshot: { L2: { retrievedChunkIds: [1, "2"], tokenUsage: { input: 7 } } },
    };
    const state = createState({
      L2: { existing: "keep" },
    });
    state._loadCheckpointById = vi.fn(() => cp);
    state._restoreCore = vi.fn(() => restored);
    ensureTokenUsageSpy.mockReturnValue({ input: 7, output: 3, total: 10 });

    const result = state.restoreCheckpoint("cp_lite");

    expect(result).toBe(cp);
    expect(state._restoreCore).toHaveBeenCalledWith(cp, FakeStateSnapshot, CheckpointMode.LITE, true);
    expect(state.L2).toEqual(
      expect.objectContaining({
        existing: "keep",
        retrievedChunkIds: ["1", "2", "null"],
        tokenUsage: { input: 7, output: 3, total: 10 },
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        incomplete: true,
        restoredFromLiteCheckpoint: true,
      })
    );
  });

  it("applies minimal fixups and falls back to preserved L2 flags", () => {
    const restored = { L2: { tokenUsage: { total: 4 }, awaitUserFeedback: false } };
    const cp = {
      checkpointId: "cp_min",
      strategy: "minimal",
      stateSnapshot: { snapshotStrategy: CheckpointMode.MINIMAL },
    };
    const state = createState({
      L2: { awaitUserFeedback: true, taskImpossible: true, reason: "why", existing: "keep" },
    });
    state._loadCheckpointById = vi.fn(() => cp);
    state._restoreCore = vi.fn(() => restored);
    ensureTokenUsageSpy.mockReturnValue({ input: 1, output: 2, total: 3 });

    const result = state.restoreCheckpoint("cp_min");

    expect(result).toBe(cp);
    expect(normalizeCheckpointStrategySpy).toHaveBeenCalledWith("minimal");
    expect(state._restoreCore).toHaveBeenCalledWith(cp, FakeStateSnapshot, CheckpointMode.MINIMAL, true);
    expect(state.L2).toEqual(
      expect.objectContaining({
        existing: "keep",
        retrievedChunkIds: [],
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        tokenUsage: { input: 1, output: 2, total: 3 },
        awaitUserFeedback: false,
        taskImpossible: true,
        reason: "why",
        incomplete: true,
        restoredFromMinimalCheckpoint: true,
      })
    );
  });

  it("supports concurrent restoreCheckpoint calls", async () => {
    const cpMap = {
      cp_a: { checkpointId: "cp_a", stateSnapshot: { L2: {} } },
      cp_b: { checkpointId: "cp_b", stateSnapshot: { L2: {} } },
    };
    const state = createState();
    state._loadCheckpointById = vi.fn((id) => cpMap[id]);
    state._restoreCore = vi.fn(() => ({ L2: {} }));

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => state.restoreCheckpoint("cp_a")),
      Promise.resolve().then(() => state.restoreCheckpoint("cp_b")),
    ]);

    expect(first).toBe(cpMap.cp_a);
    expect(second).toBe(cpMap.cp_b);
    expect(state.addTimeline).toHaveBeenCalledTimes(2);
  });
});

describe("checkpointMethods._loadCheckpointById", () => {
  it("loads and replaces checkpoint when loadCheckpoint returns a new object", () => {
    const existing = { checkpointId: "cp1", stateSnapshot: {} };
    const updated = { checkpointId: "cp1", stateSnapshot: {}, migrated: true };
    const state = createState({ checkpoints: [existing] });
    loadCheckpointSpy.mockReturnValue(updated);

    const result = state._loadCheckpointById("cp1");

    expect(loadCheckpointSpy).toHaveBeenCalledWith(existing);
    expect(result).toBe(updated);
    expect(state.checkpoints[0]).toBe(updated);
  });

  it("throws when checkpoint is not found", () => {
    const state = createState({ checkpoints: [] });

    expect(() => state._loadCheckpointById("missing")).toThrow("Checkpoint not found");
  });

  it("throws when checkpoint is missing stateSnapshot", () => {
    const state = createState({ checkpoints: [{ checkpointId: "cp1" }] });

    expect(() => state._loadCheckpointById("cp1")).toThrow("Invalid checkpoint: missing stateSnapshot");
  });

  it("propagates loadCheckpoint errors", () => {
    const state = createState({ checkpoints: [{ checkpointId: "cp1", stateSnapshot: {} }] });
    loadCheckpointSpy.mockImplementation(() => {
      throw new Error("bad checkpoint");
    });

    expect(() => state._loadCheckpointById("cp1")).toThrow("bad checkpoint");
  });

  it("treats whitespace ids as not found", () => {
    const state = createState({ checkpoints: [{ checkpointId: "cp1", stateSnapshot: {} }] });

    expect(() => state._loadCheckpointById("   ")).toThrow("Checkpoint not found");
  });
});

describe("checkpointMethods._restoreCore", () => {
  it("uses toSnapshot for FULL strategy and restores core fields", () => {
    const restored = {
      schemaVersion: "1.0",
      runId: "run_restored",
      createdAt: "2024-01-01T00:00:00.000Z",
      taskGoal: "goal_restored",
      userConfig: { checkpointStrategy: "full" },
      iteration: "7.9",
      maxIterations: "0",
      L0: { data: "l0" },
      L1: { data: "l1" },
      L2: { data: "l2" },
      planningTree: { rootGoal: "plan_goal", runId: "run_restored" },
      todos: [{ id: 1 }],
      timeline: ["event"],
    };
    const snapshot = new FakeStateSnapshot(restored, { hasToSnapshot: true });
    const cp = { stateSnapshot: snapshot };
    const checkpoints = [{ checkpointId: "cp_keep", stateSnapshot: {} }];
    const state = createState({
      L0: { before: true },
      L1: { before: true },
      checkpoints,
      constructor: FakeStateSnapshot,
    });

    const result = state._restoreCore(cp, FakeStateSnapshot, CheckpointMode.FULL, false);

    expect(snapshot.toSnapshot).toHaveBeenCalledWith({ includeCheckpoints: false });
    expect(snapshot.toJSON).not.toHaveBeenCalled();
    expect(result).toBe(restored);
    expect(state.iteration).toBe(7);
    expect(state.maxIterations).toBe(0);
    expect(state.L0).toBe(restored.L0);
    expect(state.L1).toBe(restored.L1);
    expect(planningTreeFromJSONSpy).toHaveBeenCalledWith(restored.planningTree);
    expect(state.planningTree).toBeInstanceOf(PlanningTree);
    expect(state.checkpoints).toBe(checkpoints);
  });

  it("preserves L0/L1 for minimal strategy and defaults invalid numbers", () => {
    const restored = {
      schemaVersion: "1.0",
      runId: "run_restored",
      createdAt: "2024-01-02T00:00:00.000Z",
      taskGoal: "goal_restored",
      userConfig: {},
      iteration: {},
      maxIterations: { bad: true },
      L0: { data: "l0" },
      L1: { data: "l1" },
      L2: { data: "l2" },
      planningTree: { rootGoal: "plan_goal", runId: "run_restored" },
      todos: [],
      timeline: [],
    };
    const snapshot = new FakeStateSnapshot(restored);
    FakeStateSnapshot.fromJSON.mockReturnValue(snapshot);
    const cp = { stateSnapshot: { raw: true } };
    const preservedL0 = { preserved: true };
    const preservedL1 = { preserved: true };
    const state = createState({
      L0: preservedL0,
      L1: preservedL1,
      constructor: FakeStateSnapshot,
    });

    state._restoreCore(cp, FakeStateSnapshot, CheckpointMode.MINIMAL, true);

    expect(FakeStateSnapshot.fromJSON).toHaveBeenCalledWith(cp.stateSnapshot);
    expect(snapshot.toJSON).toHaveBeenCalledWith({ includeCheckpoints: false });
    expect(snapshot.toSnapshot).not.toHaveBeenCalled();
    expect(state.L0).toBe(preservedL0);
    expect(state.L1).toBe(preservedL1);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(5);
  });

  it("keeps planningTree instances and accepts boundary iteration values", () => {
    const planningTree = new PlanningTree({ rootGoal: "goal_x", runId: "run_x" });
    const restored = {
      schemaVersion: "1.0",
      runId: "run_x",
      createdAt: "2024-01-03T00:00:00.000Z",
      taskGoal: "goal_x",
      userConfig: {},
      iteration: "-1",
      maxIterations: Number.MAX_SAFE_INTEGER,
      L0: {},
      L1: {},
      L2: {},
      planningTree,
      todos: [],
      timeline: [],
    };
    const snapshot = new FakeStateSnapshot(restored);
    const cp = { stateSnapshot: snapshot };
    const state = createState({ constructor: FakeStateSnapshot });

    state._restoreCore(cp, FakeStateSnapshot, CheckpointMode.FULL, false);

    expect(planningTreeFromJSONSpy).not.toHaveBeenCalled();
    expect(state.planningTree).toBe(planningTree);
    expect(state.iteration).toBe(-1);
    expect(state.maxIterations).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("creates a new PlanningTree when restored planningTree is missing", () => {
    const restored = {
      schemaVersion: "1.0",
      runId: "run_new",
      createdAt: "2024-01-04T00:00:00.000Z",
      taskGoal: "goal_new",
      userConfig: {},
      iteration: 1,
      maxIterations: 2,
      L0: {},
      L1: {},
      L2: {},
      planningTree: null,
      todos: [],
      timeline: [],
    };
    const snapshot = new FakeStateSnapshot(restored);
    const cp = { stateSnapshot: snapshot };
    const state = createState({ constructor: FakeStateSnapshot });

    state._restoreCore(cp, FakeStateSnapshot, CheckpointMode.FULL, false);

    expect(state.planningTree).toBeInstanceOf(PlanningTree);
    expect(state.planningTree.rootGoal).toBe("goal_new");
    expect(state.planningTree.runId).toBe("run_new");
  });
});
