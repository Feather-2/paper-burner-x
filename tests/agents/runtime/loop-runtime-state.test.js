import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("LoopRuntimeState serializes and restores", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    status: LoopRuntimeStatuses.RUNNING,
    cursor: { step: 1 },
    pausedReason: null,
    lastCheckpointId: "ckpt_1",
    statusHistory: [{ from: "idle", to: "running", timestamp: "2020-01-01T00:00:00.000Z" }],
  });

  const json = state.toJSON();
  expect(json).toEqual({
    status: "running",
    cursor: { step: 1 },
    pausedReason: null,
    lastCheckpointId: "ckpt_1",
    statusHistory: [{ from: "idle", to: "running", timestamp: "2020-01-01T00:00:00.000Z" }],
  });

  const restored = LoopRuntimeState.fromJSON(json);
  expect(restored instanceof LoopRuntimeState).toBeTruthy();
  expect(restored.toJSON()).toEqual(json);
});

it("LoopRuntimeState normalizes statusHistory entries", async () => {
  const { LoopRuntimeState } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    statusHistory: [
      { from: 1, to: "running", timestamp: 0 },
      { from: "running", to: "paused", timestamp: "  " },
    ],
  });

  expect(state.statusHistory.length).toBe(2);
  expect(state.statusHistory[0].from).toBe("1");
  expect(state.statusHistory[0].to).toBe("running");
  expect(state.statusHistory[0].timestamp).toBe("1970-01-01T00:00:00.000Z");

  expect(state.statusHistory[1].from).toBe("running");
  expect(state.statusHistory[1].to).toBe("paused");
  expect(typeof state.statusHistory[1].timestamp).toBe("string");
  expect(state.statusHistory[1].timestamp.includes("T")).toBeTruthy();
});

it("LoopRuntimeState normalizes cursor inputs", async () => {
  const { LoopRuntimeState } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const objectCursor = { step: 1 };
  const stateA = new LoopRuntimeState({ cursor: objectCursor });
  expect(stateA.cursor).toEqual({ step: 1 });
  expect(stateA.cursor).not.toBe(objectCursor);

  const arrCursor = ["a", "b"];
  const stateB = new LoopRuntimeState({ cursor: arrCursor });
  expect(stateB.cursor).toEqual(["a", "b"]);
  expect(stateB.cursor).not.toBe(arrCursor);

  const stateC = new LoopRuntimeState({ cursor: " ckpt_1 " });
  expect(stateC.cursor).toBe("ckpt_1");

  const stateD = new LoopRuntimeState({ cursor: 123 });
  expect(stateD.cursor).toBe(null);
});

it("LoopRuntimeState normalizes status, pausedReason, and lastCheckpointId", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({
    status: "unknown",
    pausedReason: "  ",
    lastCheckpointId: " ckpt_1 ",
  });

  expect(state.status).toBe(LoopRuntimeStatuses.IDLE);
  expect(state.pausedReason).toBe(null);
  expect(state.lastCheckpointId).toBe("ckpt_1");
});

it("LoopRuntimeState.fromJSON accepts non-object payloads", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = LoopRuntimeState.fromJSON(null);
  expect(state.status).toBe(LoopRuntimeStatuses.IDLE);
  expect(state.cursor).toBe(null);
  expect(state.statusHistory).toEqual([]);
});

it("LoopRuntimeState validates transitions", async () => {
  const { LoopRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const state = new LoopRuntimeState({ status: LoopRuntimeStatuses.IDLE });

  expect(state.canTransition(LoopRuntimeStatuses.RUNNING)).toBe(true);
  expect(state.canTransition(LoopRuntimeStatuses.PAUSED)).toBe(false);

  state.transitionTo(LoopRuntimeStatuses.RUNNING, { timestamp: "2020-01-01T00:00:00.000Z" });
  expect(state.status).toBe(LoopRuntimeStatuses.RUNNING);

  state.transitionTo(LoopRuntimeStatuses.PAUSED, { timestamp: 0 });
  expect(state.status).toBe(LoopRuntimeStatuses.PAUSED);
  expect(state.statusHistory.length).toBe(2);

  expect(() => state.transitionTo(LoopRuntimeStatuses.COMPLETED)).toThrow(/Invalid runtime transition/);

  state.transitionTo(LoopRuntimeStatuses.RUNNING);
  state.transitionTo(LoopRuntimeStatuses.COMPLETED);
  expect(state.status).toBe(LoopRuntimeStatuses.COMPLETED);
});

it("getRuntimeState/setRuntimeState isolate per signal", async () => {
  const {
    getRuntimeState,
    setRuntimeState,
    LoopRuntimeStatuses,
    LoopRuntimeState,
  } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const a = new AbortController();
  const b = new AbortController();

  expect(getRuntimeState(a.signal)).toBe(null);
  expect(getRuntimeState(b.signal)).toBe(null);

  const stateA = setRuntimeState(a.signal, { status: LoopRuntimeStatuses.RUNNING, lastCheckpointId: "ckpt_a" });
  expect(stateA instanceof LoopRuntimeState).toBeTruthy();
  expect(getRuntimeState(a.signal).lastCheckpointId).toBe("ckpt_a");
  expect(getRuntimeState(b.signal)).toBe(null);

  setRuntimeState(b.signal, { status: LoopRuntimeStatuses.PAUSED, pausedReason: "user" });
  expect(getRuntimeState(b.signal).status).toBe(LoopRuntimeStatuses.PAUSED);
  expect(getRuntimeState(a.signal).status).toBe(LoopRuntimeStatuses.RUNNING);
});

it("setRuntimeState validates signal type and clearRuntimeState is safe", async () => {
  const {
    setRuntimeState,
    clearRuntimeState,
    getRuntimeState,
    LoopRuntimeStatuses,
  } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  expect(() => setRuntimeState(null, { status: LoopRuntimeStatuses.RUNNING })).toThrow(/signal must be an object/);

  clearRuntimeState(null);
  clearRuntimeState(undefined);

  const controller = new AbortController();
  setRuntimeState(controller.signal, { status: LoopRuntimeStatuses.RUNNING });
  expect(getRuntimeState(controller.signal)).toBeTruthy();
  clearRuntimeState(controller.signal);
  expect(getRuntimeState(controller.signal)).toBe(null);
});
