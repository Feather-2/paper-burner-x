import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

async function loadModules() {
  const { BacktrackManager } = await import("../../../js/agents/stages/deepsearch/runtime/backtrack-manager.js");
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");
  return { BacktrackManager, DeepSearchState };
}

function makeArchiveWithState(restoredState, { onRestore } = {}) {
  return {
    restore: async (checkpointId) => {
      if (typeof onRestore === "function") onRestore(checkpointId);
      return { nodeStates: restoredState.toJSON({ includeCheckpoints: false }) };
    },
  };
}

function makeLogger() {
  return { info: () => {}, warn: () => {} };
}

it("BacktrackManager backtrack without extra params behaves as before", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  restoredState.todos = [{ todoId: "todo_1", status: "open" }];

  const events = [];
  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_1");

  expect(result.success).toBe(true);
  expect(result.reason).toBe("restored");
  expect(result.state).toBeInstanceOf(DeepSearchState);

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("deepsearch.agent.backtracked");
  expect(events[0].payload.checkpointId).toBe("checkpoint_1");
  expect(events[0].payload.backtrackCount).toBe(1);
  expect(events[0].payload.failReason).toBe(null);
  expect(events[0].payload.correctionHint).toBe(null);
});

it("BacktrackManager backtrack includes failReason in event payload", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const events = [];

  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_2", { failReason: "validation_failed" });

  expect(result.success).toBe(true);
  expect(events.length).toBe(1);
  expect(events[0].payload.failReason).toBe("validation_failed");
  expect(events[0].payload.correctionHint).toBe(null);
});

it("BacktrackManager backtrack calls sharedContext.signal when provided", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const events = [];
  const signals = [];
  const sharedContext = {
    signal: (name, payload) => signals.push({ name, payload }),
  };

  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_3", {
    failReason: "timeout",
    correctionHint: "retry_with_smaller_batch",
    sharedContext,
  });

  expect(result.success).toBe(true);
  expect(signals.length).toBe(1);
  expect(signals[0].name).toBe("backtrack_hint");
  expect(signals[0].payload.stage).toBe("backtrack-manager");
  expect(signals[0].payload.failReason).toBe("timeout");
  expect(signals[0].payload.correctionHint).toBe("retry_with_smaller_batch");
  expect(signals[0].payload.checkpointId).toBe("checkpoint_3");
  expect(signals[0].payload.backtrackCount).toBe(1);
});

it("BacktrackManager backtrack degrades gracefully without sharedContext", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const events = [];

  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_4", { sharedContext: null });

  expect(result.success).toBe(true);
  expect(events.length).toBe(1);
  expect(events[0].payload.checkpointId).toBe("checkpoint_4");
});

it("BacktrackManager returns no_archive when archive is missing", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const manager = new BacktrackManager();

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_1");

  expect(result.success).toBe(false);
  expect(result.reason).toBe("no_archive");
});

it("BacktrackManager emits backtrack_limit and summarizes todos", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const events = [];
  const state = new DeepSearchState({ runId: "run_1" });
  state.todos = [
    { todoId: "todo_open", status: "open" },
    { todoId: "todo_done", status: "completed" },
    { todoId: "todo_cancelled", status: "cancelled" },
  ];

  const manager = new BacktrackManager({
    archive: { restore: async () => ({ nodeStates: state.toJSON({ includeCheckpoints: false }) }) },
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
    maxBacktracks: 1,
  });
  manager._backtrackCount = 1;

  const result = await manager.backtrack(state, "checkpoint_limit");

  expect(result.success).toBe(false);
  expect(result.reason).toBe("limit_reached");
  expect(events.length).toBe(1);
  expect(events[0].name).toBe("deepsearch.agent.backtrack_limit");
  expect(events[0].payload.todoContext).toEqual({
    todoCount: 3,
    openTodoCount: 1,
    completedTodoCount: 1,
    cancelledTodoCount: 1,
    openTodoIds: ["todo_open"],
  });
});

it("BacktrackManager uses default hints when sharedContext is provided", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const signals = [];
  const sharedContext = {
    signal: (name, payload) => signals.push({ name, payload }),
  };

  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_default_hint", { sharedContext });

  expect(result.success).toBe(true);
  expect(signals.length).toBe(1);
  expect(signals[0].payload.failReason).toBe("unknown");
  expect(signals[0].payload.correctionHint).toBe(null);
});

it("BacktrackManager handles non-array todos in limit event", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const events = [];
  const state = new DeepSearchState({ runId: "run_1" });
  state.todos = null;

  const manager = new BacktrackManager({
    archive: { restore: async () => ({ nodeStates: state.toJSON({ includeCheckpoints: false }) }) },
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
    maxBacktracks: 1,
  });
  manager._backtrackCount = 1;

  const result = await manager.backtrack(state, "checkpoint_limit");

  expect(result.success).toBe(false);
  expect(events[0].payload.todoContext).toEqual({
    todoCount: 0,
    openTodoCount: 0,
    completedTodoCount: 0,
    cancelledTodoCount: 0,
    openTodoIds: [],
  });
});

it("BacktrackManager falls back to the previous checkpoint id", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const restoredIds = [];
  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState, { onRestore: (id) => restoredIds.push(id) }),
    emit: () => {},
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  state.checkpoints = [
    { checkpointId: "checkpoint_1" },
    { checkpointId: "checkpoint_2" },
    { checkpointId: "checkpoint_3" },
  ];

  const result = await manager.backtrack(state);

  expect(result.success).toBe(true);
  expect(restoredIds).toEqual(["checkpoint_2"]);
});

it("BacktrackManager _getFallbackCheckpointId handles non-array checkpoints", async () => {
  const { BacktrackManager } = await loadModules();
  const manager = new BacktrackManager({ logger: makeLogger() });

  expect(manager._getFallbackCheckpointId({ checkpoints: "nope" })).toBe(null);
});

it("BacktrackManager returns no_checkpoint when none available", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  state.checkpoints = [{ checkpointId: "checkpoint_1" }];

  const result = await manager.backtrack(state);

  expect(result.success).toBe(false);
  expect(result.reason).toBe("no_checkpoint");
});

it("BacktrackManager returns invalid_checkpoint when payload is missing nodeStates", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const manager = new BacktrackManager({
    archive: { restore: async () => null },
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_invalid");

  expect(result.success).toBe(false);
  expect(result.reason).toBe("invalid_checkpoint");
});

it("BacktrackManager returns restore_failed when archive restore throws", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const manager = new BacktrackManager({
    archive: {
      restore: async () => {
        throw new Error("restore blew up");
      },
    },
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_error");

  expect(result.success).toBe(false);
  expect(result.reason).toBe("restore_failed");
  expect(result.error).toBe("restore blew up");
});

it("BacktrackManager uses fallback todo defaults when fields are missing", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  restoredState.todos = [{}];
  const events = [];

  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    emit: (name, payload) => events.push({ name, payload }),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_todo_defaults");

  expect(result.success).toBe(true);
  expect(events[0].payload.todoContext).toEqual({
    todoCount: 1,
    openTodoCount: 1,
    completedTodoCount: 0,
    cancelledTodoCount: 0,
    openTodoIds: ["todo_unknown"],
  });
});

it("BacktrackManager reset clears count and canBacktrack respects limits", async () => {
  const { BacktrackManager } = await loadModules();
  const manager = new BacktrackManager({ archive: {}, maxBacktracks: 2, logger: makeLogger() });
  manager._backtrackCount = 2;

  expect(manager.canBacktrack()).toBe(false);
  expect(manager.remaining).toBe(0);

  manager.reset();

  expect(manager.backtrackCount).toBe(0);
  expect(manager.canBacktrack()).toBe(true);
  expect(manager.remaining).toBe(2);
});

it("createBacktrackManager returns a BacktrackManager instance", async () => {
  const { createBacktrackManager, BacktrackManager } = await import("../../../js/agents/stages/deepsearch/runtime/backtrack-manager.js");
  const manager = createBacktrackManager({ maxBacktracks: 4, logger: makeLogger() });

  expect(manager).toBeInstanceOf(BacktrackManager);
  expect(manager.maxBacktracks).toBe(4);
});
