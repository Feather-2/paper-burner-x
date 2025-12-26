const test = require("node:test");
const assert = require("node:assert/strict");

test("LoopRuntimeState serializes and restores", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    status: LoopRuntimeStatuses.RUNNING,
    cursor: { step: 1 },
    pausedReason: null,
    lastCheckpointId: "ckpt_1",
    statusHistory: [{ from: "idle", to: "running", timestamp: "2020-01-01T00:00:00.000Z" }],
  });

  const json = state.toJSON();
  assert.deepEqual(json, {
    status: "running",
    cursor: { step: 1 },
    pausedReason: null,
    lastCheckpointId: "ckpt_1",
    statusHistory: [{ from: "idle", to: "running", timestamp: "2020-01-01T00:00:00.000Z" }],
  });

  const restored = LoopRuntimeState.fromJSON(json);
  assert.ok(restored instanceof LoopRuntimeState);
  assert.deepEqual(restored.toJSON(), json);
});

test("LoopRuntimeState normalizes statusHistory entries", async () => {
  const { LoopRuntimeState } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    statusHistory: [
      { from: 1, to: "running", timestamp: 0 },
      { from: "running", to: "paused", timestamp: "  " },
    ],
  });

  assert.equal(state.statusHistory.length, 2);
  assert.equal(state.statusHistory[0].from, "1");
  assert.equal(state.statusHistory[0].to, "running");
  assert.equal(state.statusHistory[0].timestamp, "1970-01-01T00:00:00.000Z");

  assert.equal(state.statusHistory[1].from, "running");
  assert.equal(state.statusHistory[1].to, "paused");
  assert.equal(typeof state.statusHistory[1].timestamp, "string");
  assert.ok(state.statusHistory[1].timestamp.includes("T"));
});

test("LoopRuntimeState normalizes cursor inputs", async () => {
  const { LoopRuntimeState } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const objectCursor = { step: 1 };
  const stateA = new LoopRuntimeState({ cursor: objectCursor });
  assert.deepEqual(stateA.cursor, { step: 1 });
  assert.notEqual(stateA.cursor, objectCursor);

  const arrCursor = ["a", "b"];
  const stateB = new LoopRuntimeState({ cursor: arrCursor });
  assert.deepEqual(stateB.cursor, ["a", "b"]);
  assert.notEqual(stateB.cursor, arrCursor);

  const stateC = new LoopRuntimeState({ cursor: " ckpt_1 " });
  assert.equal(stateC.cursor, "ckpt_1");

  const stateD = new LoopRuntimeState({ cursor: 123 });
  assert.equal(stateD.cursor, null);
});

test("LoopRuntimeState normalizes status, pausedReason, and lastCheckpointId", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    status: "unknown",
    pausedReason: "  ",
    lastCheckpointId: " ckpt_1 ",
  });

  assert.equal(state.status, LoopRuntimeStatuses.IDLE);
  assert.equal(state.pausedReason, null);
  assert.equal(state.lastCheckpointId, "ckpt_1");
});

test("LoopRuntimeState.fromJSON accepts non-object payloads", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = LoopRuntimeState.fromJSON(null);
  assert.equal(state.status, LoopRuntimeStatuses.IDLE);
  assert.equal(state.cursor, null);
  assert.deepEqual(state.statusHistory, []);
});

test("LoopRuntimeState validates transitions", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });

  assert.equal(state.canTransition(LoopRuntimeStatuses.RUNNING), true);
  assert.equal(state.canTransition(LoopRuntimeStatuses.PAUSED), false);

  state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: "2020-01-01T00:00:00.000Z" });
  assert.equal(state.status, LoopRuntimeStatuses.RUNNING);

  state.transitionTo(LoopRuntimeStatuses.PAUSED, { timestamp: 0 });
  assert.equal(state.status, LoopRuntimeStatuses.PAUSED);
  assert.equal(state.statusHistory.length, 2);

  assert.throws(() => state.transitionTo(LoopRuntimeStatuses.COMPLETED), /Invalid runtime transition/);

  state.transitionTo(LoopRuntimeStatuses.RUNNING);
  state.transitionTo(LoopRuntimeStatuses.COMPLETED);
  assert.equal(state.status, LoopRuntimeStatuses.COMPLETED);
});

test("getRuntimeState/setRuntimeState isolate per signal", async () => {
  const {
    getRuntimeState,
    setRuntimeState,
    LoopRuntimeStatuses,
    LoopRuntimeState,
  } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const a = new AbortController();
  const b = new AbortController();

  assert.equal(getRuntimeState(a.signal), null);
  assert.equal(getRuntimeState(b.signal), null);

  const stateA = setRuntimeState(a.signal, { status: LoopRuntimeStatuses.RUNNING, lastCheckpointId: "ckpt_a" });
  assert.ok(stateA instanceof LoopRuntimeState);
  assert.equal(getRuntimeState(a.signal).lastCheckpointId, "ckpt_a");
  assert.equal(getRuntimeState(b.signal), null);

  setRuntimeState(b.signal, { status: LoopRuntimeStatuses.PAUSED, pausedReason: "user" });
  assert.equal(getRuntimeState(b.signal).status, LoopRuntimeStatuses.PAUSED);
  assert.equal(getRuntimeState(a.signal).status, LoopRuntimeStatuses.RUNNING);
});

test("setRuntimeState validates signal type and clearRuntimeState is safe", async () => {
  const {
    setRuntimeState,
    clearRuntimeState,
    getRuntimeState,
    LoopRuntimeStatuses,
  } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  assert.throws(() => setRuntimeState(null, { status: LoopRuntimeStatuses.RUNNING }), /signal must be an object/);

  clearRuntimeState(null);
  clearRuntimeState(undefined);

  const controller = new AbortController();
  setRuntimeState(controller.signal, { status: LoopRuntimeStatuses.RUNNING });
  assert.ok(getRuntimeState(controller.signal));
  clearRuntimeState(controller.signal);
  assert.equal(getRuntimeState(controller.signal), null);
});
