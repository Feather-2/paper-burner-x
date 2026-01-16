/**
 * @fileoverview 补充测试 BaseAgentLoop 和 BaseStage 的未覆盖区域
 *
 * 目标覆盖:
 * - BaseStage 生命周期 (execute, run, error/cancel)
 * - 用户输入队列管理 (recordUserInput, consumeUserInputs, drainUserInputsAsText, applyUserInputsToConfig, formatUserInputs, hasPendingUserInputs)
 * - Step 生命周期 (_beginStep, _endStep, _emitStepEvent, _abortActiveStep, _createStepSignal)
 * - Loop 状态转换和验证
 * - 最大用户输入限制
 * - execute 钩子与 waitForUserAction
 * - 边界情况和错误处理
 * - 并发执行安全
 */

/**
 * 创建测试用 BaseAgentLoop 实例
 * @param {object} options
 * @returns {Promise<InstanceType<typeof import("../js/agents/runtime/core/agent-loop.js").BaseAgentLoop>>}
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

async function createTestLoop(options = {}) {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  class TestLoop extends BaseAgentLoop {
    async run(input, context) {
      return { input, context };
    }
  }

  return new TestLoop(options);
}

// ============================================================================
// BaseStage lifecycle tests
// ============================================================================

it("BaseStage.execute emits started/completed events", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  class TestStage extends BaseStage {
    async run(input, context) {
      return { input, runContext: context.runContext, hasSignal: !!context.signal };
    }
  }

  const stage = new TestStage({ name: "demo", eventBus: { emit } });
  const result = await stage.execute({ runId: "run_1" }, { value: 1 }, { emit });

  expect(result.input).toEqual({ value: 1 });
  expect(result.runContext).toEqual({ runId: "run_1" });
  expect(result.hasSignal).toBe(true);

  expect(events.length).toBe(2);
  expect(events[0].name).toBe("demo.started");
  expect(events[1].name).toBe("demo.completed");
  expect(events[1].record.payload.result.input.value).toBe(1);
});

it("BaseStage.execute emits failed event on error", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  class FailStage extends BaseStage {
    async run() {
      throw new Error("boom");
    }
  }

  const stage = new FailStage({ name: "fail", eventBus: { emit } });

  await expect(() => stage.execute({}, {}, { emit }), /boom/);

  expect(events.length).toBe(2);
  expect(events[0].name).toBe("fail.started");
  expect(events[1].name).toBe("fail.failed");
  expect(events[1].record.payload.error).toBe("boom");
});

it("BaseStage.execute respects cancellation before start", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  class CancelStage extends BaseStage {
    async run() {
      return "ok";
    }
  }

  const controller = new AbortController();
  controller.abort("stop");

  const stage = new CancelStage({ name: "cancel", eventBus: { emit } });
  await expect(() => stage.execute({}, {}, { emit, signal: controller.signal }),
    (err) => err?.name === "AbortError"
  );

  expect(events.length).toBe(0);
});

it("BaseStage.run throws when not implemented", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const stage = new BaseStage({ name: "base" });

  await expect(stage.run("input")).rejects.toThrow(/Subclass must implement run/);
});

// ============================================================================
// 用户输入队列管理测试
// ============================================================================

it("recordUserInput stores entries with timestamp", async () => {
  const loop = await createTestLoop({ stageName: "test", actor: "test" });

  const before = Date.now();
  const entry = loop.recordUserInput({ text: "hello" });
  const after = Date.now();

  expect(entry.payload).toEqual({ text: "hello" });
  expect(entry.ts >= before && entry.ts <= after, "timestamp should be in valid range").toBeTruthy();
  expect(loop._userInputs.size).toBe(1);
});

it("recordUserInput emits user.input event", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "demo", actor: "demo", emit });
  loop.recordUserInput("test message");

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("demo.user.input");
  expect(events[0].record.actor).toBe("demo");
  expect(events[0].record.status).toBe("info");
  expect(events[0].record.payload.payload).toBe("test message");
});

it("recordUserInput respects maxUserInputs limit", async () => {
  const loop = await createTestLoop({ maxUserInputs: 3 });

  loop.recordUserInput("first");
  loop.recordUserInput("second");
  loop.recordUserInput("third");
  loop.recordUserInput("fourth");
  loop.recordUserInput("fifth");

  expect(loop._userInputs.size).toBe(3);
  const items = loop.consumeUserInputs({ clear: false });
  expect(items[0].payload).toBe("third");
  expect(items[1].payload).toBe("fourth");
  expect(items[2].payload).toBe("fifth");
});

it("recordUserInput handles invalid maxUserInputs", async () => {
  const loop = await createTestLoop({ maxUserInputs: -1 });

  loop.recordUserInput("a");
  loop.recordUserInput("b");
  loop.recordUserInput("c");

  // 负数或无效值不应限制队列
  expect(loop._userInputs.size).toBe(3);
});

it("consumeUserInputs returns all entries and clears by default", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("one");
  loop.recordUserInput("two");

  const items = loop.consumeUserInputs();

  expect(items.length).toBe(2);
  expect(items[0].payload).toBe("one");
  expect(items[1].payload).toBe("two");
  expect(loop._userInputs.size).toBe(0);
});

it("consumeUserInputs with clear=false preserves entries", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("one");
  loop.recordUserInput("two");

  const items = loop.consumeUserInputs({ clear: false });

  expect(items.length).toBe(2);
  expect(loop._userInputs.size).toBe(2);
});

it("drainUserInputsAsText returns items and formatted text", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("first line");
  loop.recordUserInput("second line");

  const result = loop.drainUserInputsAsText();

  expect(result.items.length).toBe(2);
  expect(result.text).toBe("first line\nsecond line");
  expect(loop._userInputs.size).toBe(0);
});

it("drainUserInputsAsText with clear=false preserves entries", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("test");
  const result = loop.drainUserInputsAsText({ clear: false });

  expect(result.items.length).toBe(1);
  expect(loop._userInputs.size).toBe(1);
});

it("hasPendingUserInputs returns correct status", async () => {
  const loop = await createTestLoop();

  expect(loop.hasPendingUserInputs()).toBe(false);

  loop.recordUserInput("test");
  expect(loop.hasPendingUserInputs()).toBe(true);

  loop.consumeUserInputs();
  expect(loop.hasPendingUserInputs()).toBe(false);
});

it("formatUserInputs handles various payload types", async () => {
  const loop = await createTestLoop();

  // 字符串
  expect(loop.formatUserInputs([{ payload: "  hello  " }])).toBe("hello");

  // 带 text 属性的对象
  expect(loop.formatUserInputs([{ payload: { text: "  world  " } }])).toBe("world");

  // 带 message 属性的对象
  expect(loop.formatUserInputs([{ payload: { message: "  msg  " } }])).toBe("msg");

  // 普通对象 (JSON 序列化)
  expect(loop.formatUserInputs([{ payload: { foo: "bar" } }])).toBe('{"foo":"bar"}');

  // null payload 会回退到 item 本身并序列化
  expect(loop.formatUserInputs([{ payload: null }, { payload: "valid" }])).toBe('{"payload":null}\nvalid');

  // 纯 null 作为 item 会跳过
  expect(loop.formatUserInputs([null, "direct"])).toBe("direct");

  // 空数组
  expect(loop.formatUserInputs([])).toBe("");

  // 非数组输入
  expect(loop.formatUserInputs(null)).toBe("");

  // 多行组合
  const multiResult = loop.formatUserInputs([{ payload: "line1" }, { payload: { text: "line2" } }, { payload: { message: "line3" } }]);
  expect(multiResult).toBe("line1\nline2\nline3");
});

it("formatUserInputs handles circular reference objects", async () => {
  const loop = await createTestLoop();

  const circular = { a: 1 };
  circular.self = circular;

  // 应该优雅处理循环引用，回退到 String()
  const result = loop.formatUserInputs([{ payload: circular }]);
  expect(result.includes("object")).toBeTruthy(); // should contain string representation
});

it("applyUserInputsToConfig merges inputs into config", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("note 1");
  loop.recordUserInput("note 2");

  const config = { existingKey: "value" };
  const result = loop.applyUserInputsToConfig(config);

  expect(result.existingKey).toBe("value");
  expect(result.userNotes).toEqual(["note 1\nnote 2"]);
  expect(result._lastUserNote).toBe("note 1\nnote 2");
  expect(result._lastUserNoteAt > 0).toBeTruthy();
  expect(result._rawUserInputs.length).toBe(2);
  expect(loop._userInputs.size).toBe(0);
});

it("applyUserInputsToConfig with custom key", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("custom note");

  const result = loop.applyUserInputsToConfig({}, { key: "customNotes" });

  expect(result.customNotes).toEqual(["custom note"]);
});

it("applyUserInputsToConfig appends to existing array", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("new note");

  const config = { userNotes: ["existing note"] };
  const result = loop.applyUserInputsToConfig(config);

  expect(result.userNotes).toEqual(["existing note", "new note"]);
});

it("applyUserInputsToConfig converts existing string to array", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("second");

  const config = { userNotes: "first" };
  const result = loop.applyUserInputsToConfig(config);

  expect(result.userNotes).toEqual(["first", "second"]);
});

it("applyUserInputsToConfig returns original config if no inputs", async () => {
  const loop = await createTestLoop();

  const config = { key: "value" };
  const result = loop.applyUserInputsToConfig(config);

  expect(result).toBe(config);
});

it("applyUserInputsToConfig handles null/undefined config", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("test");

  const result1 = loop.applyUserInputsToConfig(null);
  expect(result1.userNotes).toEqual(["test"]);

  loop.recordUserInput("test2");
  const result2 = loop.applyUserInputsToConfig(undefined);
  expect(result2.userNotes).toEqual(["test2"]);
});

// ============================================================================
// Step 生命周期测试
// ============================================================================

it("_beginStep creates step with metadata and emits started event", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", actor: "lifecycle", emit });

  const before = Date.now();
  const { step, context } = loop._beginStep({ name: "test-step", runId: "run_1", iteration: 0 });
  const after = Date.now();

  expect(step.stepId.startsWith("lifecycle_")).toBeTruthy();
  expect(step.name).toBe("test-step");
  expect(step.runId).toBe("run_1");
  expect(step.iteration).toBe(0);
  expect(step.startedAt >= before && step.startedAt <= after).toBeTruthy();
  expect(context.signal instanceof AbortSignal).toBeTruthy();

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("lifecycle.step.started");
  expect(events[0].record.status).toBe("started");
});

it("_beginStep uses stepId from meta if provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ stepId: "custom_step_123" });

  expect(step.stepId).toBe("custom_step_123");
});

it("_beginStep uses step field as fallback for name", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ step: "fallback-name" });

  expect(step.name).toBe("fallback-name");
});

it("_beginStep defaults name to 'step' if not provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({});

  expect(step.name).toBe("step");
});

it("_beginStep sets _activeStep", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  expect(loop._activeStep).toBe(null);

  loop._beginStep({ name: "active" });

  expect(loop._activeStep).toBeTruthy();
  expect(loop._activeStep.name).toBe("active");
  expect(loop._activeStep.signal instanceof AbortSignal).toBeTruthy();
  expect(loop._activeStep.controller instanceof AbortController).toBeTruthy();
});

it("_endStep emits completed event by default", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0; // 清除 started 事件

  loop._endStep({ step });

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("lifecycle.step.completed");
  expect(events[0].record.status).toBe("completed");
});

it("_endStep emits custom status", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0;

  loop._endStep({ step }, { status: "failed", error: "boom" });

  expect(events[0].name).toBe("lifecycle.step.failed");
  expect(events[0].record.status).toBe("failed");
  expect(events[0].record.payload.error).toBe("boom");
});

it("_endStep includes result in payload", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0;

  loop._endStep({ step }, { result: { data: "success" } });

  expect(events[0].record.payload.result).toEqual({ data: "success" });
});

it("_endStep clears _activeStep when matching", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ name: "test" });
  expect(loop._activeStep).toBeTruthy();

  loop._endStep({ step });
  expect(loop._activeStep).toBe(null);
});

it("_endStep does not clear _activeStep when not matching", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "first" });
  const firstStep = { ...loop._activeStep };

  loop._beginStep({ name: "second" });
  expect(loop._activeStep.stepId).not.toBe(firstStep.stepId);

  // 结束第一个 step 不应清除当前活跃的第二个 step
  loop._endStep({ step: firstStep });
  expect(loop._activeStep).toBeTruthy();
  expect(loop._activeStep.name).toBe("second");
});

it("_endStep uses _activeStep if step not provided", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  loop._beginStep({ name: "implicit" });
  events.length = 0;

  loop._endStep(null);

  expect(events[0].record.payload.name).toBe("implicit");
});

it("_endStep handles null stepInfo gracefully", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  // 没有活跃 step 时调用不应抛出
  expect(() => loop._endStep(null)).not.toThrow();
  expect(() => loop._endStep(undefined)).not.toThrow();
  expect(() => loop._endStep({})).not.toThrow();
});

it("_abortActiveStep aborts the active step controller", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "to-abort" });
  const controller = loop._activeStep.controller;

  expect(controller.signal.aborted).toBe(false);

  loop._abortActiveStep("test reason");

  expect(controller.signal.aborted).toBe(true);
});

it("_abortActiveStep uses default reason if not provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "to-abort" });

  loop._abortActiveStep();

  expect(loop._activeStep.controller.signal.aborted).toBe(true);
});

it("_abortActiveStep does nothing if no active step", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  expect(() => loop._abortActiveStep("reason")).not.toThrow();
});

it("_abortActiveStep does nothing if already aborted", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "already-aborted" });
  loop._activeStep.controller.abort("first");

  expect(() => loop._abortActiveStep("second")).not.toThrow();
});

it("_createStepSignal creates independent signal", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { signal, controller } = loop._createStepSignal(null);

  expect(signal instanceof AbortSignal).toBeTruthy();
  expect(controller instanceof AbortController).toBeTruthy();
  expect(signal.aborted).toBe(false);

  controller.abort("test");
  expect(signal.aborted).toBe(true);
});

it("_createStepSignal merges with parent signal", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const parentController = new AbortController();
  const { signal } = loop._createStepSignal(parentController.signal);

  expect(signal.aborted).toBe(false);

  parentController.abort("parent");
  expect(signal.aborted).toBe(true);
});

it("_emitStepEvent does nothing if no emit function", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  // 确保没有 emit 函数
  loop.emit = null;
  loop.eventBus = null;

  expect(() => loop._emitStepEvent("test", { data: "value" })).not.toThrow();
});

// ============================================================================
// Loop 状态转换测试
// ============================================================================

it("_transitionPhase updates state.status", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running");

  expect(state.status).toBe("running");
});

it("_transitionPhase updates state.state when status not present", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = { state: "idle" };
  loop._transitionPhase(state, "running");

  expect(state.state).toBe("running");
});

it("_transitionPhase adds status to empty state object", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = {};
  loop._transitionPhase(state, "running");

  expect(state.status).toBe("running");
});

it("_transitionPhase throws when state machine rejects transition", async () => {
  const stateMachine = {
    transition: () => false,
  };

  const loop = await createTestLoop({ stageName: "strict", stateMachine });

  const state = { status: "idle" };

  expect(() => loop._transitionPhase(state, "invalid")).toThrow(/phase transition rejected/);
});

it("_transitionPhase emits event with payload", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { emit, runId: "run_1", payload: { extra: "data" } });

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("transition.phase.transition");
  expect(events[0].record.payload.from).toBe("idle");
  expect(events[0].record.payload.to).toBe("running");
  expect(events[0].record.payload.runId).toBe("run_1");
  expect(events[0].record.payload.extra).toBe("data");
});

it("_transitionPhase uses custom eventName", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { emit, eventName: "custom.transition" });

  expect(events[0].name).toBe("custom.transition");
});

it("_transitionPhase uses loop emit when no emit provided", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition", emit });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { runId: "run_2" });

  expect(events.length).toBe(1);
  expect(events[0].name).toBe("transition.phase.transition");
  expect(events[0].record.payload.from).toBe("idle");
  expect(events[0].record.payload.to).toBe("running");
});

// ============================================================================
// execute + hook tests
// ============================================================================

it("execute triggers PreAgent and PostAgent hooks", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/index.js");

  const eventBus = enhanceEventBusWithHooks(new EventBus({ runId: "hook" }));
  const preCalls = [];
  const postCalls = [];

  eventBus.registerHook("PreAgent", {
    type: "command",
    handler: async (ctx) => {
      preCalls.push(ctx);
    },
  });

  eventBus.registerHook("PostAgent", {
    type: "command",
    handler: async (ctx) => {
      postCalls.push(ctx);
    },
  });

  class HookLoop extends BaseAgentLoop {
    async run(input) {
      return { ok: true, input };
    }
  }

  const loop = new HookLoop({ eventBus, stageName: "hooked", actor: "hooked" });
  const result = await loop.execute({ sessionId: "s1" }, { text: "hello" }, { eventBus });

  expect(result.ok).toBe(true);
  expect(preCalls.length).toBe(1);
  expect(postCalls.length).toBe(1);
  expect(preCalls[0].sessionId).toBe("s1");
  expect(preCalls[0].input.text).toBe("hello");
  expect(typeof preCalls[0].runId).toBe("string");
  expect(postCalls[0].result.ok).toBe(true);
  expect(typeof postCalls[0].duration).toBe("number");
});

it("execute respects PreAgent skip and emits skipped event", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/index.js");

  const eventBus = enhanceEventBusWithHooks(new EventBus({ runId: "skip" }));
  const events = [];
  const emit = (name, record) => events.push({ name, record });
  let runCalls = 0;

  eventBus.registerHook("PreAgent", {
    type: "command",
    handler: async () => ({ skip: true, reason: "blocked", value: { ok: false, error: "blocked" } }),
  });

  class SkipLoop extends BaseAgentLoop {
    async run() {
      runCalls += 1;
      return { ok: true };
    }
  }

  const loop = new SkipLoop({ eventBus, stageName: "skipper", actor: "skipper", emit });
  const result = await loop.execute({ sessionId: "s2" }, { text: "hi" }, { eventBus, emit });

  expect(runCalls).toBe(0);
  expect(result).toEqual({ ok: false, error: "blocked" });
  expect(events.length).toBe(1);
  expect(events[0].name).toBe("skipper.agent.skipped");
  expect(events[0].record.payload.reason).toBe("blocked");
});

it("execute calls PostAgent hook with error on failure", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/index.js");

  const eventBus = enhanceEventBusWithHooks(new EventBus({ runId: "fail" }));
  const postCalls = [];

  eventBus.registerHook("PostAgent", {
    type: "command",
    handler: async (ctx) => {
      postCalls.push(ctx);
    },
  });

  class FailLoop extends BaseAgentLoop {
    async run() {
      throw new Error("boom");
    }
  }

  const loop = new FailLoop({ eventBus, stageName: "failure", actor: "failure" });
  await expect(() => loop.execute({ sessionId: "s3" }, { text: "x" }, { eventBus }), /boom/);

  expect(postCalls.length).toBe(1);
  expect(postCalls[0].error.message).toBe("boom");
});

it("execute swallows PostAgent hook errors and emits hook error event", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { enhanceEventBusWithHooks } = await import("../../js/agents/runtime/hooks/index.js");

  const eventBus = enhanceEventBusWithHooks(new EventBus({ runId: "post-error" }));
  const hookErrors = [];

  eventBus.subscribe("agent.hook.error", (evt) => hookErrors.push(evt));
  eventBus.registerHook("PostAgent", {
    type: "command",
    handler: async () => {
      throw new Error("post boom");
    },
  });

  class OkLoop extends BaseAgentLoop {
    async run() {
      return "ok";
    }
  }

  const loop = new OkLoop({ eventBus, stageName: "post", actor: "post" });
  const result = await loop.execute({}, { text: "ok" }, { eventBus });

  expect(result).toBe("ok");
  expect(hookErrors.length).toBe(1);
  expect(hookErrors[0].payload.error).toBe("post boom");
});

// ============================================================================
// waitForUserAction tests
// ============================================================================

it("waitForUserAction resolves with payload", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "wait" });
  const loop = await createTestLoop({ eventBus });

  const promise = loop.waitForUserAction("confirm", { eventBus, timeout: 200 });
  eventBus.emit("user.action.confirm", { payload: { ok: true } });

  const result = await promise;
  expect(result).toEqual({ ok: true });
});

it("waitForUserAction rejects on timeout", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "timeout" });
  const loop = await createTestLoop({ eventBus });

  await expect(loop.waitForUserAction("idle", { eventBus, timeout: 20 })).rejects.toThrow(
    /Timeout waiting for user action: idle/
  );
});

it("waitForUserAction rejects on abort", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "abort" });
  const loop = await createTestLoop({ eventBus });
  const controller = new AbortController();

  const promise = loop.waitForUserAction("cancel", { eventBus, signal: controller.signal, timeout: 200 });
  controller.abort("stop");

  await expect(promise).rejects.toThrow(/Run cancelled/);
});

it("waitForUserAction requires an eventBus with subscribe", async () => {
  const loop = await createTestLoop();

  await expect(loop.waitForUserAction("missing")).rejects.toThrow(/eventBus with subscribe/);
});

// ============================================================================
// 并发安全测试
// ============================================================================

it("execute aborts superseded run", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  let firstSignal = null;
  let releaseFirst = null;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  class ConcurrentLoop extends BaseAgentLoop {
    async run(input, context) {
      if (input === "first") {
        firstSignal = context.signal;
        await firstGate;
        return { ok: true, input };
      }
      return { ok: true, input };
    }
  }

  const loop = new ConcurrentLoop({ stageName: "concurrent", actor: "concurrent" });
  const firstPromise = loop.execute({}, "first");
  const secondResult = await loop.execute({}, "second");

  expect(secondResult).toEqual({ ok: true, input: "second" });
  expect(firstSignal?.aborted).toBe(true);

  releaseFirst();
  const firstResult = await firstPromise;
  expect(firstResult).toEqual({ ok: true, input: "first" });
});

// ============================================================================
// pause/resume 测试
// ============================================================================

it("pause sets status to PAUSED and aborts active step", async () => {
  const { AgentStatus } = await import("../../js/agents/runtime/core/agent-status.js");
  const loop = await createTestLoop({ stageName: "pausable" });

  loop._transitionLoopStatus(AgentStatus.RUNNING, { force: true });

  loop._beginStep({ name: "active" });
  const stepController = loop._activeStep.controller;

  loop.pause("test reason");

  expect(loop.isPaused).toBe(true);
  expect(loop._pauseReason).toBe("test reason");
  expect(stepController.signal.aborted).toBe(true);
});

it("resume sets status to RUNNING from PAUSED", async () => {
  const loop = await createTestLoop({ stageName: "pausable" });

  loop.pause("hold");
  expect(loop.isPaused).toBe(true);

  loop.resume();

  expect(loop.isPaused).toBe(false);
  expect(loop._pauseReason).toBe(null);
});

// ============================================================================
// 工具调用边界测试
// ============================================================================

it("_callTool catches synchronous errors", async () => {
  const loop = await createTestLoop({
    tools: {
      syncFail: () => {
        throw new Error("sync error");
      },
    },
  });

  const result = await loop._callTool("syncFail", {}, {});

  expect(result.ok).toBe(false);
  expect(result.error).toBe("sync error");
});

it("_callTool handles tool returning undefined", async () => {
  const loop = await createTestLoop({
    tools: {
      noReturn: () => undefined,
    },
  });

  const result = await loop._callTool("noReturn", {}, {});

  expect(result.ok).toBe(true);
  expect(result.data).toBe(undefined);
});

it("_callTool handles tool returning null", async () => {
  const loop = await createTestLoop({
    tools: {
      nullReturn: () => null,
    },
  });

  const result = await loop._callTool("nullReturn", {}, {});

  expect(result.ok).toBe(true);
  expect(result.data).toBe(null);
});

// ============================================================================
// EventBus 监听器管理测试
// ============================================================================

it("_attachUserInputListener subscribes to user.input event", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "test" });
  const loop = await createTestLoop({ stageName: "input" });

  loop._attachUserInputListener(eventBus);

  eventBus.emit("user.input", { payload: "test input" });

  expect(loop._userInputs.size).toBe(1);
  expect(loop._userInputs.toArray()[0].payload).toBe("test input");
});

it("_attachUserInputListener does nothing without eventBus", async () => {
  const loop = await createTestLoop({ stageName: "input" });

  expect(() => loop._attachUserInputListener(null)).not.toThrow();
  expect(() => loop._attachUserInputListener(undefined)).not.toThrow();
});

it("_attachPauseListener subscribes once and pauses with reason", async () => {
  const loop = await createTestLoop({ stageName: "pause" });
  const calls = [];
  const eventBus = {
    subscribe: (name, handler) => {
      calls.push({ name, handler });
      return () => {
        calls.push({ name: "unsub" });
      };
    },
  };

  loop._attachPauseListener(eventBus);
  loop._attachPauseListener(eventBus);

  expect(calls.length).toBe(1);
  calls[0].handler({ payload: { reason: "coffee" } });

  expect(loop.isPaused).toBe(true);
  expect(loop._pauseReason).toBe("coffee");
});

it("_detachEventBusListeners unsubscribes pause listener", async () => {
  let unsubCalls = 0;
  const eventBus = {
    subscribe: () => () => {
      unsubCalls += 1;
    },
  };

  const loop = await createTestLoop({ stageName: "cleanup" });

  loop._attachPauseListener(eventBus);
  loop._detachEventBusListeners();

  expect(unsubCalls).toBe(1);
});

it("_detachEventBusListeners cleans up subscriptions", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "test" });
  const loop = await createTestLoop({ stageName: "cleanup" });

  loop._attachUserInputListener(eventBus);
  loop._attachPauseListener(eventBus);

  expect(loop._userInputUnsub).toBeTruthy();
  expect(loop._pauseListenerUnsub).toBeTruthy();

  loop._detachEventBusListeners();

  expect(loop._userInputUnsub).toBe(null);
  expect(loop._userInputBus).toBe(null);
  expect(loop._pauseListenerUnsub).toBe(null);
});

// ============================================================================
// getContextStatus 测试
// ============================================================================

it("getContextStatus returns context information", async () => {
  const loop = await createTestLoop({
    contextConfig: { contextWindow: 1000, compressThreshold: 0.9 },
  });

  loop.addMessage({ role: "user", content: "hello" });

  const status = loop.getContextStatus();

  expect(typeof status.tokenUsage.total).toBe("number");
  expect(typeof status.fillRatio).toBe("number");
  expect(typeof status.needsCompression).toBe("boolean");
  expect(typeof status.compressionPending).toBe("boolean");
});

// ============================================================================
// 消息管理测试
// ============================================================================

it("addMessage delegates to MessageManager", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "test" });

  expect(loop.messages.length).toBe(1);
  expect(loop.messages[0].role).toBe("user");
  expect(loop.messages[0].content).toBe("test");
});

it("addMessages appends multiple messages", async () => {
  const loop = await createTestLoop();

  loop.addMessages([
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
  ]);

  expect(loop.messages.length).toBe(2);
  expect(loop.messages[0].role).toBe("user");
  expect(loop.messages[1].role).toBe("assistant");
});

it("resetMessages clears messages", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "one" });
  loop.addMessage({ role: "assistant", content: "two" });

  expect(loop.messages.length).toBe(2);

  await loop.resetMessages();

  expect(loop.messages.length).toBe(0);
});

// ============================================================================
// 工具注册测试
// ============================================================================

it("registerTool adds tool to registry", async () => {
  const loop = await createTestLoop();

  loop.registerTool("custom", async () => "result");

  const result = await loop._callTool("custom", {}, {});

  expect(result.ok).toBe(true);
  expect(result.data).toBe("result");
});

it("tool registry exposes registered tool names", async () => {
  const loop = await createTestLoop({
    tools: {
      tool1: () => {},
      tool2: () => {},
    },
  });

  const tools = loop._toolRegistry.getToolNames();

  expect(tools.includes("tool1")).toBeTruthy();
  expect(tools.includes("tool2")).toBeTruthy();
});

// ============================================================================
// hooks 测试
// ============================================================================

it("hooks are called during tool execution", async () => {
  const beforeCalls = [];
  const afterCalls = [];

  const loop = await createTestLoop({
    tools: {
      myTool: async ({ value }) => ({ result: value * 2 }),
    },
    hooks: {
      before: [
        (ctx) => {
          beforeCalls.push(ctx);
          return ctx;
        },
      ],
      after: [
        (ctx) => {
          afterCalls.push(ctx);
          return ctx;
        },
      ],
    },
  });

  await loop._callTool("myTool", { value: 5 }, {});

  expect(beforeCalls.length).toBe(1);
  expect(beforeCalls[0].tool).toBe("myTool");
  expect(beforeCalls[0].params).toEqual({ value: 5 });

  expect(afterCalls.length).toBe(1);
  expect(afterCalls[0].tool).toBe("myTool");
});

// ============================================================================
// dispose 测试
// ============================================================================

it("message manager dispose marks instance as disposed", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "test" });

  loop._messageManager.dispose();

  expect(loop._messageManager._disposed).toBe(true);
});

// ============================================================================
// 初始化测试
// ============================================================================

it("BaseAgentLoop.run throws when not implemented", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const loop = new BaseAgentLoop();

  await expect(loop.run("input")).rejects.toThrow(/not implemented/);
});

it("constructor with tools as Map", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const toolsMap = new Map([
    ["mapTool1", async () => "result1"],
    ["mapTool2", async () => "result2"],
  ]);

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop({ tools: toolsMap });
  const tools = loop._toolRegistry.getToolNames();

  expect(tools.includes("mapTool1")).toBeTruthy();
  expect(tools.includes("mapTool2")).toBeTruthy();
});

it("constructor with tools as array of tuples", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  const toolsArray = [
    ["arrayTool1", async () => "result1"],
    ["arrayTool2", async () => "result2"],
  ];

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop({ tools: toolsArray });
  const tools = loop._toolRegistry.getToolNames();

  expect(tools.includes("arrayTool1")).toBeTruthy();
  expect(tools.includes("arrayTool2")).toBeTruthy();
});

it("constructor without options uses defaults", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop();

  expect(loop.stageName).toBe("agent");
  expect(loop.actor).toBe("agent");
  expect(loop.eventBus).toBe(null);
});

// ============================================================================
// _isAbortError 测试
// ============================================================================

it("_isAbortError detects abort errors", async () => {
  const loop = await createTestLoop();

  const controller = new AbortController();
  controller.abort("test");

  const abortError = new Error("AbortError");
  abortError.name = "AbortError";

  expect(loop._isAbortError(abortError, controller.signal)).toBe(true);
});

it("_isAbortError returns false for non-abort errors", async () => {
  const loop = await createTestLoop();

  const regularError = new Error("regular");
  const controller = new AbortController();

  expect(loop._isAbortError(regularError, controller.signal)).toBe(false);
});
