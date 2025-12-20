const test = require("node:test");
const assert = require("node:assert/strict");

async function createTestLoop(options) {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/agent-loop.js");
  class TestLoop extends BaseAgentLoop {
    async run(input, context) {
      return { input, context };
    }
  }
  return new TestLoop(options);
}

test("BaseAgentLoop helpers normalize and resolve", async () => {
  const {
    getEmitFn,
    checkCancelled,
    normalizeToolResult,
    resolveToolExecutor,
  } = await import("../../../js/agents/runtime/agent-loop.js");

  const emit = () => {};
  assert.equal(getEmitFn({ emit }), emit);
  assert.equal(getEmitFn({ eventBus: { emit } }), emit);
  assert.equal(getEmitFn({}), null);

  assert.deepEqual(normalizeToolResult({ ok: false, error: "bad" }), { ok: false, error: "bad" });
  assert.deepEqual(normalizeToolResult({ error: "bad", data: 3 }), { ok: false, data: 3, error: "bad" });
  assert.deepEqual(normalizeToolResult("value"), { ok: true, data: "value" });

  const fn = () => {};
  assert.equal(resolveToolExecutor({ toolExecutor: fn }), fn);
  const executor = resolveToolExecutor({ tools: { execute: fn } });
  assert.equal(typeof executor, "function");
  assert.equal(resolveToolExecutor({}), null);

  const controller = new AbortController();
  assert.doesNotThrow(() => checkCancelled(controller.signal));
  controller.abort("stop");
  assert.throws(() => checkCancelled(controller.signal), /stop/);
});

test("BaseAgentLoop registers tools and calls them", async () => {
  const loop = await createTestLoop({
    tools: {
      ping: async ({ value }) => ({ value }),
    },
    stageName: "demo",
    actor: "demo",
  });

  loop.registerTool("pong", async () => "ok");

  const result = await loop._callTool("ping", { value: 2 }, {});
  assert.deepEqual(result, { ok: true, data: { value: 2 } });

  const pong = await loop._callTool("pong", {}, {});
  assert.deepEqual(pong, { ok: true, data: "ok" });

  const missing = await loop._callTool("nope", {}, {});
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Unknown tool/);
});

test("BaseAgentLoop uses tool executor when provided", async () => {
  const loop = await createTestLoop();

  const toolExecutor = async () => ({ data: "from-executor" });
  const result = await loop._callTool("external", { value: 1 }, { toolExecutor });
  assert.deepEqual(result, { ok: true, data: "from-executor", error: undefined });

  const executorObj = {
    execute: async () => ({ ok: false, error: "nope" }),
  };
  const failed = await loop._callTool("external", { value: 1 }, { toolExecutor: executorObj });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "nope");
});

test("BaseAgentLoop transitions state and emits", async () => {
  const { createStateMachine } = await import("../../../js/agents/runtime/state-machine.js");

  const stateMachine = createStateMachine({ idle: ["next"] }, "TestLoop");
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stateMachine, stageName: "design", actor: "design" });
  const state = { status: "idle" };

  loop._transitionPhase(state, "next", { emit, runId: "run_1", payload: { note: "ok" } });

  assert.equal(state.status, "next");
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "design.phase.transition");
  assert.equal(events[0].record.actor, "design");
  assert.equal(events[0].record.status, "progress");
  assert.deepEqual(events[0].record.payload, { runId: "run_1", from: "idle", to: "next", note: "ok" });
});

test("BaseAgentLoop transitions without a state machine", async () => {
  const loop = await createTestLoop({ stageName: "simple", actor: "simple" });
  const events = [];
  const emit = (name, record) => events.push({ name, record });
  const state = { state: "idle" };

  loop._transitionPhase(state, "done", { emit, runId: "run_simple" });

  assert.equal(state.state, "done");
  assert.equal(events[0].name, "simple.phase.transition");
  assert.equal(events[0].record.payload.to, "done");
});

test("BaseAgentLoop rejects invalid transitions", async () => {
  const { createStateMachine } = await import("../../../js/agents/runtime/state-machine.js");

  const stateMachine = createStateMachine({ idle: [] }, "TestLoop");
  const loop = await createTestLoop({ stateMachine, stageName: "design" });
  const state = { status: "idle" };

  assert.throws(() => loop._transitionPhase(state, "bad", { emit: () => {} }), /transition rejected/);
});

test("BaseAgentLoop emits stages with actor", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "demo", actor: "demo", emit });
  loop._emitStage("demo.started", "started", { ok: true });

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "demo.started");
  assert.equal(events[0].record.actor, "demo");
  assert.equal(events[0].record.status, "started");
  assert.deepEqual(events[0].record.payload, { ok: true });
});

test("BaseAgentLoop reports tool errors", async () => {
  const loop = await createTestLoop({
    tools: {
      fail: async () => {
        throw new Error("boom");
      },
    },
  });

  const result = await loop._callTool("fail", {}, {});
  assert.equal(result.ok, false);
  assert.equal(result.error, "boom");
});

test("BaseAgentLoop waitForUserAction resolves, aborts, and times out", async () => {
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  const eventBus = new EventBus({ runId: "run_wait" });
  const loop = await createTestLoop({ eventBus });

  const action = loop.waitForUserAction("confirm", { timeout: 50 });
  eventBus.emit("user.action.confirm", { ok: true });
  const payload = await action;
  assert.deepEqual(payload, { ok: true });

  const controller = new AbortController();
  const aborted = loop.waitForUserAction("confirm", { eventBus, signal: controller.signal });
  controller.abort("stop");
  await assert.rejects(aborted, /Run cancelled/);

  const timed = loop.waitForUserAction("confirm", { eventBus, timeout: 5 });
  await assert.rejects(timed, /Timeout waiting for user action/);
});

test("BaseAgentLoop execute adapts stage inputs", async () => {
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  const eventBus = new EventBus({ runId: "run_exec" });
  const loop = await createTestLoop({ eventBus, stageName: "exec" });

  const result = await loop.execute({ runId: "run_exec" }, { value: 1 }, { eventBus });

  assert.equal(result.context.runContext.runId, "run_exec");
  assert.deepEqual(result.input, { value: 1 });
});

test("BaseAgentLoop.run throws by default", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/agent-loop.js");
  const loop = new BaseAgentLoop();

  await assert.rejects(() => loop.run(), /not implemented/);
});

test("BaseAgentLoop waitForUserAction requires an event bus", async () => {
  const loop = await createTestLoop();
  await assert.rejects(loop.waitForUserAction("confirm"), /eventBus/);
});
