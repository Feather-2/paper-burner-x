const test = require("node:test");
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

test("BacktrackManager backtrack without extra params behaves as before", async () => {
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

  assert.equal(result.success, true);
  assert.equal(result.reason, "restored");
  assert.ok(result.state instanceof DeepSearchState);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "deepsearch.agent.backtracked");
  assert.equal(events[0].payload.checkpointId, "checkpoint_1");
  assert.equal(events[0].payload.backtrackCount, 1);
  assert.equal(events[0].payload.failReason, null);
  assert.equal(events[0].payload.correctionHint, null);
});

test("BacktrackManager backtrack includes failReason in event payload", async () => {
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

  assert.equal(result.success, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.failReason, "validation_failed");
  assert.equal(events[0].payload.correctionHint, null);
});

test("BacktrackManager backtrack calls sharedContext.signal when provided", async () => {
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

  assert.equal(result.success, true);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].name, "backtrack_hint");
  assert.equal(signals[0].payload.stage, "backtrack-manager");
  assert.equal(signals[0].payload.failReason, "timeout");
  assert.equal(signals[0].payload.correctionHint, "retry_with_smaller_batch");
  assert.equal(signals[0].payload.checkpointId, "checkpoint_3");
  assert.equal(signals[0].payload.backtrackCount, 1);
});

test("BacktrackManager backtrack degrades gracefully without sharedContext", async () => {
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

  assert.equal(result.success, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.checkpointId, "checkpoint_4");
});

test("BacktrackManager returns no_archive when archive is missing", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const manager = new BacktrackManager();

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_1");

  assert.equal(result.success, false);
  assert.equal(result.reason, "no_archive");
});

test("BacktrackManager emits backtrack_limit and summarizes todos", async () => {
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

  assert.equal(result.success, false);
  assert.equal(result.reason, "limit_reached");
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "deepsearch.agent.backtrack_limit");
  assert.deepEqual(events[0].payload.todoContext, {
    todoCount: 3,
    openTodoCount: 1,
    completedTodoCount: 1,
    cancelledTodoCount: 1,
    openTodoIds: ["todo_open"],
  });
});

test("BacktrackManager uses default hints when sharedContext is provided", async () => {
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

  assert.equal(result.success, true);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].payload.failReason, "unknown");
  assert.equal(signals[0].payload.correctionHint, null);
});

test("BacktrackManager handles non-array todos in limit event", async () => {
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

  assert.equal(result.success, false);
  assert.deepEqual(events[0].payload.todoContext, {
    todoCount: 0,
    openTodoCount: 0,
    completedTodoCount: 0,
    cancelledTodoCount: 0,
    openTodoIds: [],
  });
});

test("BacktrackManager falls back to the previous checkpoint id", async () => {
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

  assert.equal(result.success, true);
  assert.deepEqual(restoredIds, ["checkpoint_2"]);
});

test("BacktrackManager _getFallbackCheckpointId handles non-array checkpoints", async () => {
  const { BacktrackManager } = await loadModules();
  const manager = new BacktrackManager({ logger: makeLogger() });

  assert.equal(manager._getFallbackCheckpointId({ checkpoints: "nope" }), null);
});

test("BacktrackManager returns no_checkpoint when none available", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const restoredState = new DeepSearchState({ runId: "restored" });
  const manager = new BacktrackManager({
    archive: makeArchiveWithState(restoredState),
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  state.checkpoints = [{ checkpointId: "checkpoint_1" }];

  const result = await manager.backtrack(state);

  assert.equal(result.success, false);
  assert.equal(result.reason, "no_checkpoint");
});

test("BacktrackManager returns invalid_checkpoint when payload is missing nodeStates", async () => {
  const { BacktrackManager, DeepSearchState } = await loadModules();
  const manager = new BacktrackManager({
    archive: { restore: async () => null },
    logger: makeLogger(),
  });

  const state = new DeepSearchState({ runId: "run_1" });
  const result = await manager.backtrack(state, "checkpoint_invalid");

  assert.equal(result.success, false);
  assert.equal(result.reason, "invalid_checkpoint");
});

test("BacktrackManager returns restore_failed when archive restore throws", async () => {
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

  assert.equal(result.success, false);
  assert.equal(result.reason, "restore_failed");
  assert.equal(result.error, "restore blew up");
});

test("BacktrackManager uses fallback todo defaults when fields are missing", async () => {
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

  assert.equal(result.success, true);
  assert.deepEqual(events[0].payload.todoContext, {
    todoCount: 1,
    openTodoCount: 1,
    completedTodoCount: 0,
    cancelledTodoCount: 0,
    openTodoIds: ["todo_unknown"],
  });
});

test("BacktrackManager reset clears count and canBacktrack respects limits", async () => {
  const { BacktrackManager } = await loadModules();
  const manager = new BacktrackManager({ archive: {}, maxBacktracks: 2, logger: makeLogger() });
  manager._backtrackCount = 2;

  assert.equal(manager.canBacktrack(), false);
  assert.equal(manager.remaining, 0);

  manager.reset();

  assert.equal(manager.backtrackCount, 0);
  assert.equal(manager.canBacktrack(), true);
  assert.equal(manager.remaining, 2);
});

test("createBacktrackManager returns a BacktrackManager instance", async () => {
  const { createBacktrackManager, BacktrackManager } = await import("../../../js/agents/stages/deepsearch/runtime/backtrack-manager.js");
  const manager = createBacktrackManager({ maxBacktracks: 4, logger: makeLogger() });

  assert.ok(manager instanceof BacktrackManager);
  assert.equal(manager.maxBacktracks, 4);
});
