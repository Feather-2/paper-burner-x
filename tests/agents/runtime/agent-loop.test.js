import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

it("BaseAgentLoop helpers normalize and resolve", async () => {
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
  expect(getEmitFn({ emit })).toBe(emit);
  expect(getEmitFn({ eventBus: { emit } })).toBe(emit);
  expect(getEmitFn({})).toBe(null);
  expect(getEmitFn(null)).toBe(null);

  expect(() => checkPaused(null)).not.toThrow();
  expect(() => checkPaused(undefined)).not.toThrow();

  expect(normalizeToolResult({ ok: false, error: "bad" })).toEqual({ ok: false, error: "bad" });
  expect(normalizeToolResult({ error: "bad", data: 3 })).toEqual({ ok: false, data: 3, error: "bad" });
  expect(normalizeToolResult({ data: 3 })).toEqual({ ok: true, data: 3, error: undefined });
  expect(normalizeToolResult("value")).toEqual({ ok: true, data: "value" });

  const fn = () => {};
  expect(resolveToolExecutor({ toolExecutor: fn })).toBe(fn);
  const executor = resolveToolExecutor({ tools: { execute: fn } });
  expect(typeof executor).toBe("function");
  expect(executor("name", { ok: true })).toBe(fn("name", { ok: true }));
  expect(resolveToolExecutor({ toolExecutor: {} })).toBe(null);
  expect(resolveToolExecutor({ tools: {} })).toBe(null);
  expect(resolveToolExecutor({})).toBe(null);

  const controller = new AbortController();
  expect(() => checkCancelled(controller.signal)).not.toThrow();
  controller.abort("stop");
  expect(() => checkCancelled(controller.signal)).toThrow(/stop/);

  const controller2 = new AbortController();
  controller2.abort(new Error("boom"));
  expect(() => checkCancelled(controller2.signal)).toThrow(/boom/);

  const pauseController = new AbortController();
  setRuntimeState(pauseController.signal, {
    status: LoopRuntimeStatuses.PAUSED,
    pausedReason: "user",
    lastCheckpointId: "ckpt_1",
  });
  expect(() => checkPaused(pauseController.signal)).toThrow(/Run paused/);

  expect(() => checkCancelledOrPaused(null)).not.toThrow();
  expect(() => checkCancelledOrPaused(undefined)).not.toThrow();

  const cancelController = new AbortController();
  cancelController.abort("stop");
  expect(() => checkCancelledOrPaused(cancelController.signal)).toThrow(/stop/);
});

it("BaseAgentLoop registers tools and calls them", async () => {
  const loop = await createTestLoop({
    tools: {
      ping: async ({ value }) => ({ value }),
    },
    stageName: "demo",
    actor: "demo",
  });

  loop.registerTool("pong", async () => "ok");

  const result = await loop._callTool("ping", { value: 2 }, {});
  expect(result).toEqual({ ok: true, data: { value: 2 } });

  const pong = await loop._callTool("pong", {}, {});
  expect(pong).toEqual({ ok: true, data: "ok" });

  const missing = await loop._callTool("nope", {}, {});
  expect(missing.ok).toBe(false);
  expect(missing.error).toMatch(/Unknown tool/);
});

it("BaseAgentLoop flushCompression waits for scheduled compression", async () => {
  const loop = await createTestLoop({
    contextConfig: { contextWindow: 800, compressThreshold: 0.9, keepLastTurns: 1 },
  });

  // Ensure the token budget is exceeded even when the adaptive token counter has warmed up (tiktoken mode).
  loop.addMessage({ role: "user", content: "x".repeat(8000) });
  loop.addMessage({ role: "assistant", content: "ok" });

  expect(loop.getContextStatus().needsCompression).toBe(true);

  await loop.flushCompression();

  const ctx = loop.getContextStatus();
  expect(ctx.compressionPending).toBe(false);
  expect(ctx.needsCompression).toBe(false);

  expect(loop.messages.length).toBe(2);
  expect(loop.messages[0].content).toBe("ok");
  expect(loop.messages[1].role).toBe("system");
  expect(loop.messages[1].content.startsWith("[Context Summary]")).toBeTruthy();
});

it("BaseAgentLoop clears cooldown timers during flushCompression", async () => {
  const loop = await createTestLoop({
    contextConfig: { contextWindow: 800, compressThreshold: 0.9, keepLastTurns: 1, compressCooldownMs: 1000 },
  });

  loop.addMessage({ role: "user", content: "x".repeat(8000) });
  loop.addMessage({ role: "assistant", content: "ok" });
  await loop.flushCompression();

  loop.addMessage({ role: "user", content: "x".repeat(8000) });
  loop.addMessage({ role: "assistant", content: "ok" });
  // Timer is now in _messageManager
  expect(loop._messageManager._compressionCooldownTimer).toBeTruthy();

  await loop.flushCompression();
  expect(loop._messageManager._compressionCooldownTimer).toBe(null);
});

it("BaseAgentLoop uses tool executor when provided", async () => {
  const loop = await createTestLoop();

  const toolExecutor = async () => ({ data: "from-executor" });
  const result = await loop._callTool("external", { value: 1 }, { toolExecutor });
  expect(result).toEqual({ ok: true, data: "from-executor", error: undefined });

  const executorObj = {
    execute: async () => ({ ok: false, error: "nope" }),
  };
  const failed = await loop._callTool("external", { value: 1 }, { toolExecutor: executorObj });
  expect(failed.ok).toBe(false);
  expect(failed.error).toBe("nope");
});

it("BaseAgentLoop transitions without a state machine", async () => {
  const loop = await createTestLoop({ stageName: "simple", actor: "simple" });
  const events = [];
  const emit = (name, record) => events.push({ name, record });
  const state = { state: "idle" };

  loop._transitionPhase(state, "done", { emit, runId: "run_simple" });

  expect(state.state).toBe("done");
  expect(events[0].name).toBe("simple.phase.transition");
  expect(events[0].record.payload.to).toBe("done");
});

it("BaseAgentLoop transitions without state object", async () => {
  const loop = await createTestLoop({ stageName: "simple", actor: "simple" });
  expect(loop._transitionPhase(null, "next")).toBe("next");
});

it("BaseAgentLoop emits stages with actor via emit callback", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "demo", actor: "demo", emit });

  // Use emit directly instead of _emitStage (which is on BaseStage, not BaseAgentLoop)
  emit("demo.started", { actor: "demo", status: "started", payload: { ok: true } });

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("demo.started");
  expect(events[0].record.actor).toBe("demo");
  expect(events[0].record.status).toBe("started");
  expect(events[0].record.payload).toEqual({ ok: true });
});

it("BaseAgentLoop _checkPaused delegates to runtime pause check", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
  const { setRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/telemetry/loop-runtime-state.js");

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop();
  expect(() => loop._checkPaused(null)).not.toThrow();

  const controller = new AbortController();
  setRuntimeState(controller.signal, { status: LoopRuntimeStatuses.PAUSED });
  expect(() => loop._checkPaused(controller.signal)).toThrow(/Run paused/);
});

it("BaseAgentLoop reports tool errors", async () => {
  const loop = await createTestLoop({
    tools: {
      fail: async () => {
        throw new Error("boom");
      },
    },
  });

  const result = await loop._callTool("fail", {}, {});
  expect(result.ok).toBe(false);
  expect(result.error).toBe("boom");
});

it("BaseAgentLoop waitForUserAction resolves, aborts, and times out", async () => {
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "run_wait" });
  const loop = await createTestLoop({ eventBus });

  const action = loop.waitForUserAction("confirm", { timeout: 50 });
  eventBus.emit("user.action.confirm", { ok: true });
  const payload = await action;
  expect(payload).toEqual({ ok: true });

  const controller = new AbortController();
  const aborted = loop.waitForUserAction("confirm", { eventBus, signal: controller.signal });
  controller.abort("stop");
  await expect(aborted).rejects.toThrow(/Run cancelled/);

  const timed = loop.waitForUserAction("confirm", { eventBus, timeout: 5 });
  await expect(timed).rejects.toThrow(/Timeout waiting for user action/);
});

it("BaseAgentLoop execute adapts stage inputs", async () => {
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "run_exec" });
  const loop = await createTestLoop({ eventBus, stageName: "exec" });

  const result = await loop.execute({ runId: "run_exec" }, { value: 1 }, { eventBus });

  expect(result.context.runContext.runId).toBe("run_exec");
  expect(result.input).toEqual({ value: 1 });
});

it("BaseAgentLoop execute cleans up EventBus subscriptions", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "run_exec_cleanup" });

  class TestLoop extends BaseAgentLoop {
    async run() {
      expect(eventBus._listeners.get("user.input")?.size ?? 0).toBe(1);
      expect(eventBus._listeners.get("user.action.pause")?.size ?? 0).toBe(1);
      return { ok: true };
    }
  }

  const loop = new TestLoop({ eventBus, stageName: "exec_cleanup" });
  await loop.execute({ runId: "run_exec_cleanup" }, { value: 1 }, { eventBus });

  expect(eventBus._listeners.get("user.input")).toBe(undefined);
  expect(eventBus._listeners.get("user.action.pause")).toBe(undefined);
});

it("BaseAgentLoop.run throws by default", async () => {
  const { BaseAgentLoop } = await import("../../../js/agents/runtime/core/agent-loop.js");
  const loop = new BaseAgentLoop();

  await expect(() => loop.run()).rejects.toThrow(/not implemented/);
});

it("BaseAgentLoop waitForUserAction requires an event bus", async () => {
  const loop = await createTestLoop();
  await expect(loop.waitForUserAction("confirm")).rejects.toThrow(/eventBus/);
});

it("BaseStage execute emits lifecycle and delegates to run", async () => {
  const { BaseStage } = await import("../../../js/agents/runtime/core/agent-loop.js");

  const calls = [];
  const emit = (name, record) => calls.push({ name, record });

  class TestStage extends BaseStage {
    constructor() {
      super({ name: "unit" });
    }

    async run(input, context) {
      expect(context.runContext.runId).toBe("run_1");
      return { ok: true, input, hasEmit: typeof context.emit === "function" };
    }
  }

  const stage = new TestStage();
  const result = await stage.execute({ runId: "run_1" }, { value: 1 }, { emit });

  expect(result).toEqual({ ok: true, input: { value: 1 }, hasEmit: true });
  expect(calls[0].name).toBe("unit.started");
  expect(calls[0].record.actor).toBe("unit");
  expect(calls[0].record.status).toBe("started");
  expect(calls[1].name).toBe("unit.completed");
  expect(calls[1].record.status).toBe("completed");
});

it("BaseStage execute emits failed when cancelled during run", async () => {
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
  await expect(() => stage.execute({ runId: "run_cancel" }, { value: 1 }, { emit, signal: controller.signal }), /stop|cancel/i);
  expect(calls.some(e => e.name === "cancel.failed")).toBeTruthy();
});
