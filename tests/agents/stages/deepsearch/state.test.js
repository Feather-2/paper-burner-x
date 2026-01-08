import { afterEach, describe, expect, it, vi } from "vitest";

import { Deque } from "../../../../js/agents/shared/utils/deque.js";
import { PlanningTree } from "../../../../js/agents/stages/deepsearch/state/planning-tree.js";
import { IterationState } from "../../../../js/agents/stages/deepsearch/state/iteration-state.js";
import {
  buildCheckpointReferences,
  buildStateSnapshot,
  fromSnapshot,
  toJSON as serializerToJSON,
  toSnapshot as serializerToSnapshot,
} from "../../../../js/agents/stages/deepsearch/state/serializer.js";
import { stateMethods } from "../../../../js/agents/stages/deepsearch/state/state-methods.js";
import { DeepSearchState, validateIteration, transitionGap } from "../../../../js/agents/stages/deepsearch/state.js";

describe("deepsearch/state", () => {
  afterEach(() => {
    try {
      vi.runOnlyPendingTimers();
      vi.clearAllTimers();
    } catch {}
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("initializes default structures (L0/L1/L2, timeline, planningTree)", () => {
    const state = new DeepSearchState({ runId: "run_init", taskGoal: "goal_init" });

    expect(state.schemaVersion).toBe("0.1");
    expect(state.runId).toBe("run_init");
    expect(state.taskGoal).toBe("goal_init");
    expect(typeof state.createdAt).toBe("string");
    expect(state.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(state.L0).toMatchObject({ sources: [], sourceIndex: null });
    expect(Array.isArray(state.L1.gaps)).toBe(true);
    expect(Array.isArray(state.L2.retrievedChunks)).toBe(true);
    expect(state.L2.tokenUsage).toMatchObject({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });

    expect(state.timeline).toBeInstanceOf(Deque);
    expect(state.timeline.size).toBe(0);

    expect(state.planningTree).toBeInstanceOf(PlanningTree);
    expect(state.planningTree.rootGoal).toBe("goal_init");
    expect(state.planningTree.runId).toBe("run_init");
  });

  it("todos setter keeps stable internal array reference", () => {
    const state = new DeepSearchState({ runId: "run_todos_ref", taskGoal: "g" });
    const originalRef = state.todos;

    state.todos = [{ todoId: "t1", text: "x", status: "open" }];
    expect(state.todos).toBe(originalRef);
    expect(state.todos.map((t) => t.todoId)).toEqual(["t1"]);

    state.todos = [{ todoId: "t2", text: "y", status: "open" }];
    expect(state.todos).toBe(originalRef);
    expect(state.todos.map((t) => t.todoId)).toEqual(["t2"]);
  });

  it("supports addTodo/updateTodo/removeTodo without StateEngine", () => {
    const state = new DeepSearchState({ runId: "run_todos_crud", taskGoal: "g" });

    const created = state.addTodo({
      todoId: "todo_a",
      text: "Draft outline",
      status: "open",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    expect(created).toMatchObject({ todoId: "todo_a", text: "Draft outline", status: "open" });
    expect(state.todos).toHaveLength(1);

    const updated = state.updateTodo("todo_a", { status: "completed", text: "Outline done" });
    expect(updated).toMatchObject({ todoId: "todo_a", text: "Outline done", status: "completed" });
    expect(updated.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(Array.isArray(updated.history)).toBe(true);
    expect(updated.history.at(-1)).toMatchObject({ to: "completed" });

    const removed = state.removeTodo("todo_a");
    expect(removed).toMatchObject({ todoId: "todo_a" });
    expect(state.todos).toHaveLength(0);
  });

  it("validateIteration: fills gaps with evidence and blocks after misses (syncs todos + timeline)", () => {
    const state = new DeepSearchState({
      runId: "run_validate",
      taskGoal: "g",
      userConfig: { gaps: { minEvidenceToFill: 2 } },
    });

    state.L1.gaps = [
      { gapId: "gap_1", question: "What is X?", status: "open", missCount: 0 },
      { gapId: "gap_2", question: "What is Y?", status: "open", missCount: 0 },
    ];
    state.todos = [
      { todoId: "todo_1", text: "Fill gap 1", status: "open", relatedGapId: "gap_1", createdAt: "2020-01-01T00:00:00.000Z" },
      { todoId: "todo_2", text: "Fill gap 2", status: "open", relatedGapId: "gap_2", createdAt: "2020-01-01T00:00:00.000Z" },
    ];
    state.L1.evidenceLedger = [{ gapIds: ["gap_1"] }, { gapIds: ["gap_1"] }];

    const events = [];
    const emit = (name, payload) => events.push({ name, payload });

    const res1 = validateIteration(state, { blockAfterMisses: 2, emit });
    expect(res1).toMatchObject({ filledCount: 1, blockedCount: 0 });
    expect(state.L1.gaps.find((g) => g.gapId === "gap_1")?.status).toBe("filled");
    expect(state.L1.gaps.find((g) => g.gapId === "gap_2")?.missCount).toBe(1);

    expect(state.todos.find((t) => t.todoId === "todo_1")?.status).toBe("completed");
    expect(state.todos.find((t) => t.todoId === "todo_2")?.status).toBe("open");

    const res2 = validateIteration(state, { blockAfterMisses: 2, emit });
    expect(res2).toMatchObject({ blockedCount: 1 });
    expect(state.L1.gaps.find((g) => g.gapId === "gap_2")?.status).toBe("blocked");
    expect(state.todos.find((t) => t.todoId === "todo_2")?.status).toBe("cancelled");

    expect(state.timeline).toBeInstanceOf(Deque);
    const timeline = state.timeline.toArray();
    expect(timeline.some((row) => row?.name === "deepsearch.validate")).toBe(true);

    expect(events.some((e) => e.name === "deepsearch.gap.transitioned")).toBe(true);
    expect(events.some((e) => e.name === "deepsearch.todo.status.changed")).toBe(true);
  });

  it("transitionGap: no-op on same status, emits on change", () => {
    const gap = { gapId: "gap_99", status: "open" };
    const events = [];
    const emit = (name, payload) => events.push({ name, payload });

    expect(transitionGap(gap, "open", { ts: "2020-01-01T00:00:00.000Z" }, emit)).toBe(false);
    expect(events).toHaveLength(0);

    expect(transitionGap(gap, "filled", { ts: "2020-01-01T00:00:01.000Z" }, emit)).toBe(true);
    expect(gap.status).toBe("filled");
    expect(gap.updatedAt).toBe("2020-01-01T00:00:01.000Z");
    expect(events.at(-1)).toMatchObject({ name: "deepsearch.gap.transitioned" });
  });

  it("serializes via toJSON/toSnapshot and supports deserialize/clone", () => {
    const state = new DeepSearchState({ runId: "run_serde", taskGoal: "g" });
    state.addTimeline({ name: "e1", status: "info", payload: { ok: true } });
    state.addTodo({ todoId: "todo_s", text: "t", status: "open", createdAt: "2020-01-01T00:00:00.000Z" });
    state.saveCheckpoint({ checkpointId: "cp_1" });

    const json = state.toJSON();
    expect(json).toMatchObject({ runId: "run_serde", taskGoal: "g" });
    expect(Array.isArray(json.timeline)).toBe(true);
    expect(json.timeline.at(-1)).toMatchObject({ name: "e1" });
    expect(Array.isArray(json.checkpoints)).toBe(true);
    expect(json.checkpoints[0]).toMatchObject({ checkpointId: "cp_1" });
    expect("stateSnapshot" in json.checkpoints[0]).toBe(false);

    const jsonWithoutCheckpoints = state.toJSON({ includeCheckpoints: false });
    expect("checkpoints" in jsonWithoutCheckpoints).toBe(false);

    const snapshot = state.toSnapshot();
    expect(Array.isArray(snapshot.checkpoints)).toBe(true);
    expect(snapshot.checkpoints[0]).toMatchObject({ checkpointId: "cp_1" });
    expect(snapshot.checkpoints[0]).toHaveProperty("stateSnapshot");

    const serialized = state.serialize({ pretty: true });
    expect(typeof serialized).toBe("string");
    expect(serialized).toMatch(/\n/);

    const restored = DeepSearchState.deserialize(serialized);
    expect(restored).toBeInstanceOf(DeepSearchState);
    expect(restored.runId).toBe("run_serde");
    expect(restored.taskGoal).toBe("g");
    expect(restored.planningTree).toBeInstanceOf(PlanningTree);

    const cloned = state.clone({ includeCheckpoints: false });
    expect(cloned).toBeInstanceOf(DeepSearchState);
    expect(cloned).not.toBe(state);
    expect(cloned.runId).toBe("run_serde");
  });

  it("PlanningTree: toJSON/serialize roundtrip + defensive fromJSON", () => {
    const empty = PlanningTree.fromJSON(null);
    expect(empty).toBeInstanceOf(PlanningTree);
    expect(empty.rootGoal).toBe("");
    expect(empty.runId).toBe("");
    expect(empty.nodes).toBeInstanceOf(Map);
    expect(() => empty.expandFromGap()).not.toThrow();
    expect(() => empty.expandFromTodo()).not.toThrow();

    const tree = PlanningTree.fromJSON({ rootGoal: "goal", runId: "run" });
    expect(tree.serialize()).toEqual({ rootGoal: "goal", runId: "run" });
    expect(tree.toJSON()).toEqual({ rootGoal: "goal", runId: "run" });

    const partial = PlanningTree.fromJSON({ rootGoal: "onlyGoal" });
    expect(partial.serialize()).toEqual({ rootGoal: "onlyGoal", runId: "" });
  });

  it("serializer: supports optional fields + validates snapshot payloads", () => {
    const base = {
      schemaVersion: "0.1",
      runId: "run_ser",
      createdAt: "2020-01-01T00:00:00.000Z",
      taskGoal: "goal",
      userConfig: {},
      planningTree: null,
      trajectoryId: "traj_1",
      trajectoryConfig: { mode: "fast" },
      iteration: 1,
      maxIterations: 3,
      checkpoints: [{ checkpointId: "cp_1", stateSnapshot: { ok: true } }],
      writeBacktrackCount: 0,
      writeSnapshots: [],
      L0: {},
      L1: {},
      L2: {},
      todos: [],
      timeline: [{ name: "e1" }],
    };

    const snapshotWithoutCheckpoints = buildStateSnapshot(base, { includeCheckpoints: false });
    expect("checkpoints" in snapshotWithoutCheckpoints).toBe(false);
    expect(snapshotWithoutCheckpoints.planningTree).toBeNull();
    expect(snapshotWithoutCheckpoints.trajectoryId).toBe("traj_1");
    expect(snapshotWithoutCheckpoints.trajectoryConfig).toEqual({ mode: "fast" });
    expect(snapshotWithoutCheckpoints.timeline).toEqual([{ name: "e1" }]);

    expect(buildCheckpointReferences(null)).toEqual([]);
    const refs = buildCheckpointReferences(base.checkpoints);
    expect(refs[0]).toMatchObject({ checkpointId: "cp_1" });
    expect(refs[0]).not.toHaveProperty("stateSnapshot");

    const json = serializerToJSON(base);
    expect(json.checkpoints[0]).not.toHaveProperty("stateSnapshot");

    const snap = serializerToSnapshot(base);
    expect(snap.checkpoints[0]).toHaveProperty("stateSnapshot");

    expect(() => fromSnapshot(null)).toThrow(TypeError);
    expect(fromSnapshot({ ok: true })).toEqual({ ok: true });
  });

  it("IterationState: safe defaults and container initialization", () => {
    const missing = new IterationState(null);
    expect(missing.iteration).toBe(0);
    expect(missing.phase).toBe("");
    expect(missing.gaps).toEqual([]);
    expect(missing.chunks).toEqual([]);
    expect(() => {
      missing.iteration = 3;
      missing.phase = "x";
      missing.gaps = [{ gapId: "gap_1" }];
      missing.chunks = [{ id: 1 }];
    }).not.toThrow();

    const root = { iteration: "2", L1: null, L2: [] };
    const itState = new IterationState(root);
    expect(itState.iteration).toBe(2);
    itState.iteration = "5";
    expect(root.iteration).toBe(5);

    expect(itState.phase).toBe("");
    itState.phase = "  understanding  ";
    expect(root.L2).toMatchObject({ phase: "understanding" });

    expect(itState.gaps).toEqual([]);
    expect(root.L1).toHaveProperty("gaps");
    itState.gaps = "nope";
    expect(root.L1.gaps).toEqual([]);
    itState.gaps = [{ gapId: "gap_1" }];
    expect(root.L1.gaps).toEqual([{ gapId: "gap_1" }]);

    expect(itState.chunks).toEqual([]);
    expect(root.L2).toHaveProperty("retrievedChunks");
    itState.chunks = "nope";
    expect(root.L2.retrievedChunks).toEqual([]);
    itState.chunks = [{ id: 1 }];
    expect(root.L2.retrievedChunks).toEqual([{ id: 1 }]);
  });

  function createFakeStateEngine({ taskGoal = "", todos = [] } = {}) {
    const ref = {
      L0: {
        taskGoal,
        todos: Array.isArray(todos) ? [...todos] : [],
      },
    };
    const dispatched = [];

    return {
      dispatched,
      _getStateRef: () => ref,
      dispatchSync(action) {
        dispatched.push(action);
        if (!action || typeof action !== "object") return;
        if (!ref.L0 || typeof ref.L0 !== "object") ref.L0 = { taskGoal: "", todos: [] };
        if (!Array.isArray(ref.L0.todos)) ref.L0.todos = [];

        const type = action.type;
        const payload = action.payload || {};
        if (type === "L0/ADD_TODO") {
          ref.L0.todos.push(payload.todo);
        } else if (type === "L0/REPLACE_TODOS") {
          ref.L0.todos = Array.isArray(payload.todos) ? payload.todos : [];
        } else if (type === "L0/UPDATE_TODO") {
          const id = payload.id;
          const idx = ref.L0.todos.findIndex((t) => t?.todoId === id || t?.id === id);
          if (idx >= 0) ref.L0.todos[idx] = payload.updates;
        } else if (type === "L0/REMOVE_TODO") {
          const id = payload.id;
          const idx = ref.L0.todos.findIndex((t) => t?.todoId === id || t?.id === id);
          if (idx >= 0) ref.L0.todos.splice(idx, 1);
        }
      },
    };
  }

  it("stateMethods: token usage accumulation + fallback for invalid payloads", () => {
    const state = new DeepSearchState({ runId: "run_usage", taskGoal: "g" });
    state.L2 = null;

    const cur1 = state.addTokenUsage({ prompt_tokens: 2, completion_tokens: 1, costUSD: 0.1 });
    expect(cur1).toEqual({ input: 2, output: 1, total: 3, estimatedCostUSD: 0.1 });
    expect(state.L2).toMatchObject({ awaitUserFeedback: false, taskImpossible: false, reason: "" });

    const cur2 = state.addTokenUsage({ input_tokens: 1, output_tokens: 2, total_tokens: 10, estimatedCostUSD: -5 });
    expect(cur2).toEqual({ input: 3, output: 3, total: 13, estimatedCostUSD: 0.1 });

    const sameRef = state.addTokenUsage({}); // un-parseable usage should be a no-op
    expect(sameRef).toBe(state.L2.tokenUsage);

    const fallback = stateMethods.addTokenUsage.call({}, {});
    expect(fallback).toEqual({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });
  });

  it("stateMethods: todo CRUD dispatches through StateEngine and syncs keywords/status", () => {
    const state = new DeepSearchState({ runId: "run_engine", taskGoal: "goal" });
    const engine = createFakeStateEngine({ taskGoal: "goal" });
    state._stateEngine = engine;
    state._syncToShared = vi.fn();

    const created = state.addTodo({ text: "  Draft outline  ", status: "open" });
    expect(created.todoId).toBe("todo_1");
    expect(state.todos).toHaveLength(1);
    expect(engine.dispatched.some((a) => a.type === "L0/ADD_TODO")).toBe(true);
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_1", expect.objectContaining({ status: "open" }));

    const emit = vi.fn();
    const updated = state.updateTodo("todo_1", { title: "  Outline done  ", status: "completed", extra: 123 }, emit);
    expect(updated).toMatchObject({ todoId: "todo_1", text: "Outline done", status: "completed", extra: 123 });
    expect(Array.isArray(updated.history)).toBe(true);
    expect(emit).toHaveBeenCalledWith("deepsearch.todo.status.changed", expect.any(Object));
    expect(engine.dispatched.some((a) => a.type === "L0/UPDATE_TODO")).toBe(true);
    expect(state._syncToShared).toHaveBeenCalledWith("todo", "todo_1", expect.objectContaining({ status: "completed" }));

    const removed = state.removeTodo("todo_1");
    expect(removed).toMatchObject({ todoId: "todo_1" });
    expect(state.todos).toHaveLength(0);
    expect(engine.dispatched.some((a) => a.type === "L0/REMOVE_TODO")).toBe(true);

    expect(state.updateTodo("", { status: "open" })).toBeNull();
    expect(state.updateTodo("missing", { status: "open" })).toBeNull();
    expect(state.removeTodo("")).toBeNull();
  });

  it("stateMethods: replaceTodos (engine vs local) + snapshot/timeline/gap wrappers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    const state = new DeepSearchState({
      runId: "run_misc",
      taskGoal: "g",
      userConfig: { memory: { maxTimeline: 2 }, gaps: { maxGapDepth: 3 } },
    });
    state._syncToShared = vi.fn();

    const engine = createFakeStateEngine({ taskGoal: "g" });
    state._stateEngine = engine;

    const next = state.replaceTodos([{ todoId: "t1", text: "x", status: "open" }]);
    expect(next).toBe(state.todos);
    expect(state.todos.map((t) => t.todoId)).toEqual(["t1"]);
    expect(engine.dispatched.some((a) => a.type === "L0/REPLACE_TODOS")).toBe(true);

    state._stateEngine = null;
    const ref = state.todos;
    const replaced = state.replaceTodos([{ todoId: "t2", text: "y", status: "open" }]);
    expect(replaced).toBe(ref);
    expect(state.todos.map((t) => t.todoId)).toEqual(["t2"]);

    state.addTimeline({});
    state.addTimeline({ name: "x" });
    state.addTimeline({ name: "y" });
    expect(state.timeline.toArray().map((row) => row.name)).toEqual(["x", "y"]);

    state.L1.slideIntents = [{ id: 1 }];
    state.L1.report = { text: "r" };
    const snap = state.saveWriteSnapshot({});
    expect(snap).toMatchObject({ snapshotId: "wcp_1", timestamp: "2020-01-01T00:00:00.000Z", iteration: 0 });
    expect(snap.slideIntents).toEqual([{ id: 1 }]);

    state.L1.gaps = [{ gapId: "gap_1", status: "open", missCount: 2, filledAt: "x", filledIteration: 1, evidenceCount: 3 }];
    const reopened = state.reopenGaps("gap_1", { reason: "back", timestamp: "2020-01-01T00:00:01.000Z" });
    expect(reopened).toEqual({ reopened: ["gap_1"], missing: [] });
    expect(state.L1.gaps[0]).toMatchObject({ status: "open", missCount: 0, reopenedReason: "back" });
    expect(state.L1.gaps[0]).not.toHaveProperty("filledAt");
    expect(state.L1.gaps[0]).not.toHaveProperty("filledIteration");
    expect(state.L1.gaps[0]).not.toHaveProperty("evidenceCount");

    const added = state.addNewGaps([{ question: "What is Z?" }], { timestamp: "2020-01-01T00:00:02.000Z" });
    expect(added).toHaveLength(1);
    expect(state.L1.gaps.some((g) => g.gapId === added[0].gapId)).toBe(true);
    expect(state.todos.length).toBeGreaterThan(0);

    state.L2 = null;
    const tokenUsage = state._ensureTokenUsage();
    expect(tokenUsage).toEqual({ input: 0, output: 0, total: 0, estimatedCostUSD: 0 });
  });

  it("memoryMethods: scratchpad helpers, _syncToShared, and bindMemoryStore sync", () => {
    const state = new DeepSearchState({ runId: "run_mem", taskGoal: "goal" });

    state.L2 = null;
    state.setScratchpad("k", "v");
    expect(state.getScratchpad("k")).toBe("v");
    const shallow = state.getScratchpad();
    expect(shallow).toEqual({ k: "v" });
    shallow.k = "changed";
    expect(state.getScratchpad("k")).toBe("v");

    state.setScratchpad({ a: 1, b: 2 });
    expect(state.getScratchpad()).toEqual({ k: "v", a: 1, b: 2 });

    const getStore = { getScratchpad: vi.fn(() => ({ from: "store" })) };
    state._memoryStore = getStore;
    expect(state.getScratchpad()).toEqual({ from: "store" });
    expect(getStore.getScratchpad).toHaveBeenCalledWith(undefined);

    const setStore = { setScratchpad: vi.fn() };
    state._memoryStore = setStore;
    state.setScratchpad({ c: 3 });
    expect(setStore.setScratchpad).toHaveBeenCalledWith({ c: 3 }, undefined);

    const syncStore = { syncDiscovery: vi.fn() };
    const upsert = vi.fn();
    state._memoryStore = syncStore;
    state.sharedContext = { upsertSignal: upsert };
    state.subAgentIndex = 2;
    vi.spyOn(Date, "now").mockReturnValue(123);
    state._syncToShared("todo", "todo_1", { status: "open", keywords: ["x"] });
    expect(syncStore.syncDiscovery).toHaveBeenCalledWith("todo_1", { type: "todo", status: "open", keywords: ["x"], by: 2 });
    expect(upsert).toHaveBeenCalledWith({ type: "todo", id: "todo_1", status: "open", keywords: ["x"], by: 2, ts: 123 });

    const engine = createFakeStateEngine();
    const store = {
      L0: { todos: [{ id: "t1", content: "hello", status: "open" }], taskGoal: "" },
      getTodos: () => [{ id: "t1", content: "hello", status: "open" }],
      setTaskGoal: vi.fn(),
      setScratchpad: vi.fn(),
      replaceTodos: vi.fn((todos) => {
        store.L0.todos = Array.isArray(todos) ? todos : [];
      }),
    };

    state._stateEngine = engine;
    state._syncFromStateEngine = vi.fn();
    state.bindMemoryStore({ setScratchpad: vi.fn() });

    state._stateEngine = null;
    state._syncFromStateEngine = DeepSearchState.prototype._syncFromStateEngine;
    state.L2.awaitUserFeedback = true;
    state.L2.taskImpossible = true;
    state.L2.scratchpad = { s: 1 };

    state.bindMemoryStore(store);
    const localTodosRef = state.todos;
    expect(store.setTaskGoal).toHaveBeenCalledWith("goal");
    expect(store.awaitUserFeedback).toBe(true);
    expect(store.taskImpossible).toBe(true);
    expect(store.setScratchpad).toHaveBeenCalledWith({ s: 1 });
    expect(state.todos[0]).toMatchObject({ id: "t1", todoId: "t1", content: "hello", text: "hello" });

    state.todos = [{ todoId: "t2", text: "next" }];
    expect(store.L0.todos).toEqual([{ todoId: "t2", text: "next" }]);
    expect(localTodosRef).toEqual([{ todoId: "t2", text: "next" }]);
  });
});
