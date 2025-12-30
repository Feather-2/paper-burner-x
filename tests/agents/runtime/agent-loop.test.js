const test = require("node:test");
const assert = require("node:assert/strict");

async function createTestLoop(options) {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
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
    checkPaused,
    checkCancelledOrPaused,
    normalizeToolResult,
    resolveToolExecutor,
  } = await import("../../../js/agents/runtime/core/agent-loop.js");

  const { setRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  const emit = () => {};
  assert.equal(getEmitFn({ emit }), emit);
  assert.equal(getEmitFn({ eventBus: { emit } }), emit);
  assert.equal(getEmitFn({}), null);
  assert.equal(getEmitFn(null), null);

  assert.doesNotThrow(() => checkPaused(null));
  assert.doesNotThrow(() => checkPaused(undefined));

  assert.deepEqual(normalizeToolResult({ ok: false, error: "bad" }), { ok: false, error: "bad" });
  assert.deepEqual(normalizeToolResult({ error: "bad", data: 3 }), { ok: false, data: 3, error: "bad" });
  assert.deepEqual(normalizeToolResult({ data: 3 }), { ok: true, data: 3, error: undefined });
  assert.deepEqual(normalizeToolResult("value"), { ok: true, data: "value" });

  const fn = () => {};
  assert.equal(resolveToolExecutor({ toolExecutor: fn }), fn);
  const executor = resolveToolExecutor({ tools: { execute: fn } });
  assert.equal(typeof executor, "function");
  assert.equal(executor("name", { ok: true }), fn("name", { ok: true }));
  assert.equal(resolveToolExecutor({ toolExecutor: {} }), null);
  assert.equal(resolveToolExecutor({ tools: {} }), null);
  assert.equal(resolveToolExecutor({}), null);

  const controller = new AbortController();
  assert.doesNotThrow(() => checkCancelled(controller.signal));
  controller.abort("stop");
  assert.throws(() => checkCancelled(controller.signal), /stop/);

  const controller2 = new AbortController();
  controller2.abort(new Error("boom"));
  assert.throws(() => checkCancelled(controller2.signal), /Run cancelled/);

  const pauseController = new AbortController();
  setRuntimeState(pauseController.signal, {
    status: LoopRuntimeStatuses.PAUSED,
    pausedReason: "user",
    lastCheckpointId: "ckpt_1",
  });
  assert.throws(() => checkPaused(pauseController.signal), /Run paused/);

  assert.doesNotThrow(() => checkCancelledOrPaused(null));
  assert.doesNotThrow(() => checkCancelledOrPaused(undefined));

  const cancelController = new AbortController();
  cancelController.abort("stop");
  assert.throws(() => checkCancelledOrPaused(cancelController.signal), /stop/);
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

test("BaseAgentLoop flushCompression waits for scheduled compression", async () => {
  const loop = await createTestLoop({
    contextConfig: { contextWindow: 800, compressThreshold: 0.9, keepLastTurns: 1 },
  });

  loop.addMessage({ role: "user", content: "x".repeat(5000) });
  loop.addMessage({ role: "assistant", content: "ok" });

  assert.equal(loop.getContextStatus().needsCompression, true);

  await loop.flushCompression();

  const ctx = loop.getContextStatus();
  assert.equal(ctx.compressionPending, false);
  assert.equal(ctx.needsCompression, false);

  assert.equal(loop.messages.length, 2);
  assert.equal(loop.messages[0].role, "system");
  assert.ok(loop.messages[0].content.startsWith("[Context Summary]"));
  assert.equal(loop.messages[1].content, "ok");
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

test("BaseAgentLoop transitions without state object", async () => {
  const loop = await createTestLoop({ stageName: "simple", actor: "simple" });
  assert.equal(loop._transitionPhase(null, "next"), "next");
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

test("BaseAgentLoop _checkPaused delegates to runtime pause check", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
  const { setRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop();
  assert.doesNotThrow(() => loop._checkPaused(null));

  const controller = new AbortController();
  setRuntimeState(controller.signal, { status: LoopRuntimeStatuses.PAUSED });
  assert.throws(() => loop._checkPaused(controller.signal), /Run paused/);
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
  const { EventBus } = await import("../../../js/agents/runtime/events/event-bus.js");

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
  const { EventBus } = await import("../../../js/agents/runtime/events/event-bus.js");

  const eventBus = new EventBus({ runId: "run_exec" });
  const loop = await createTestLoop({ eventBus, stageName: "exec" });

  const result = await loop.execute({ runId: "run_exec" }, { value: 1 }, { eventBus });

  assert.equal(result.context.runContext.runId, "run_exec");
  assert.deepEqual(result.input, { value: 1 });
});

test("BaseAgentLoop.run throws by default", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
  const loop = new BaseAgentLoop();

  await assert.rejects(() => loop.run(), /not implemented/);
});

test("BaseAgentLoop waitForUserAction requires an event bus", async () => {
  const loop = await createTestLoop();
  await assert.rejects(loop.waitForUserAction("confirm"), /eventBus/);
});

test("BaseStage execute emits lifecycle and delegates to run", async () => {
  const { BaseStage } = await import("../../../js/agents/runtime/core/agent-loop.js");

  const calls = [];
  const emit = (name, record) => calls.push({ name, record });

  class TestStage extends BaseStage {
    constructor() {
      super({ name: "unit" });
    }

    async run(input, context) {
      assert.equal(context.runContext.runId, "run_1");
      return { ok: true, input, hasEmit: typeof context.emit === "function" };
    }
  }

  const stage = new TestStage();
  const result = await stage.execute({ runId: "run_1" }, { value: 1 }, { emit });

  assert.deepEqual(result, { ok: true, input: { value: 1 }, hasEmit: true });
  assert.equal(calls[0].name, "unit.started");
  assert.equal(calls[0].record.actor, "unit");
  assert.equal(calls[0].record.status, "started");
  assert.equal(calls[1].name, "unit.completed");
  assert.equal(calls[1].record.status, "completed");
});

test("BaseStage execute emits failed when cancelled during run", async () => {
  const { BaseStage } = await import("../../../js/agents/runtime/core/agent-loop.js");

  const calls = [];
  const emit = (name, record) => calls.push({ name, record });
  const controller = new AbortController();

  class TestStage extends BaseStage {
    constructor() {
      super({ name: "cancel" });
    }

    async run(_input, context) {
      controller.abort("stop");
      context.checkCancelled();
      return "unreachable";
    }
  }

  const stage = new TestStage();
  await assert.rejects(() => stage.execute({ runId: "run_cancel" }, { value: 1 }, { emit, signal: controller.signal }), /stop|cancel/i);
  assert.ok(calls.some((e) => e.name === "cancel.failed"));
});
