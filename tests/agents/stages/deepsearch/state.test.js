import { describe, it, expect } from "vitest";

import { Deque } from "../../../../js/agents/shared/utils/deque.js";
import { PlanningTree } from "../../../../js/agents/stages/deepsearch/state/planning-tree.js";
import { DeepSearchState, validateIteration, transitionGap } from "../../../../js/agents/stages/deepsearch/state.js";

describe("deepsearch/state", () => {
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
});

