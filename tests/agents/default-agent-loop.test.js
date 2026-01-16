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

import test from "node:test";
import assert from "node:assert/strict";

/**
 * 创建测试用 BaseAgentLoop 实例
 * @param {object} options
 * @returns {Promise<InstanceType<typeof import("../js/agents/runtime/core/agent-loop.js").BaseAgentLoop>>}
 */
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

test("BaseStage.execute emits started/completed events", async () => {
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

  assert.deepEqual(result.input, { value: 1 });
  assert.deepEqual(result.runContext, { runId: "run_1" });
  assert.equal(result.hasSignal, true);

  assert.equal(events.length, 2);
  assert.equal(events[0].name, "demo.started");
  assert.equal(events[1].name, "demo.completed");
  assert.equal(events[1].record.payload.result.input.value, 1);
});

test("BaseStage.execute emits failed event on error", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  class FailStage extends BaseStage {
    async run() {
      throw new Error("boom");
    }
  }

  const stage = new FailStage({ name: "fail", eventBus: { emit } });

  await assert.rejects(() => stage.execute({}, {}, { emit }), /boom/);

  assert.equal(events.length, 2);
  assert.equal(events[0].name, "fail.started");
  assert.equal(events[1].name, "fail.failed");
  assert.equal(events[1].record.payload.error, "boom");
});

test("BaseStage.execute respects cancellation before start", async () => {
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
  await assert.rejects(
    () => stage.execute({}, {}, { emit, signal: controller.signal }),
    (err) => err?.name === "AbortError"
  );

  assert.equal(events.length, 0);
});

test("BaseStage.run throws when not implemented", async () => {
  const { BaseStage } = await import("../../js/agents/runtime/core/agent-loop.js");
  const stage = new BaseStage({ name: "base" });

  await assert.rejects(stage.run("input", {}), /Subclass must implement run/);
});

// ============================================================================
// 用户输入队列管理测试
// ============================================================================

test("recordUserInput stores entries with timestamp", async () => {
  const loop = await createTestLoop({ stageName: "test", actor: "test" });

  const before = Date.now();
  const entry = loop.recordUserInput({ text: "hello" });
  const after = Date.now();

  assert.deepEqual(entry.payload, { text: "hello" });
  assert.ok(entry.ts >= before && entry.ts <= after, "timestamp should be in valid range");
  assert.equal(loop._userInputs.size, 1);
});

test("recordUserInput emits user.input event", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "demo", actor: "demo", emit });
  loop.recordUserInput("test message");

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "demo.user.input");
  assert.equal(events[0].record.actor, "demo");
  assert.equal(events[0].record.status, "info");
  assert.equal(events[0].record.payload.payload, "test message");
});

test("recordUserInput respects maxUserInputs limit", async () => {
  const loop = await createTestLoop({ maxUserInputs: 3 });

  loop.recordUserInput("first");
  loop.recordUserInput("second");
  loop.recordUserInput("third");
  loop.recordUserInput("fourth");
  loop.recordUserInput("fifth");

  assert.equal(loop._userInputs.size, 3);
  const items = loop.consumeUserInputs({ clear: false });
  assert.equal(items[0].payload, "third");
  assert.equal(items[1].payload, "fourth");
  assert.equal(items[2].payload, "fifth");
});

test("recordUserInput handles invalid maxUserInputs", async () => {
  const loop = await createTestLoop({ maxUserInputs: -1 });

  loop.recordUserInput("a");
  loop.recordUserInput("b");
  loop.recordUserInput("c");

  // 负数或无效值不应限制队列
  assert.equal(loop._userInputs.size, 3);
});

test("consumeUserInputs returns all entries and clears by default", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("one");
  loop.recordUserInput("two");

  const items = loop.consumeUserInputs();

  assert.equal(items.length, 2);
  assert.equal(items[0].payload, "one");
  assert.equal(items[1].payload, "two");
  assert.equal(loop._userInputs.size, 0);
});

test("consumeUserInputs with clear=false preserves entries", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("one");
  loop.recordUserInput("two");

  const items = loop.consumeUserInputs({ clear: false });

  assert.equal(items.length, 2);
  assert.equal(loop._userInputs.size, 2);
});

test("drainUserInputsAsText returns items and formatted text", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("first line");
  loop.recordUserInput("second line");

  const result = loop.drainUserInputsAsText();

  assert.equal(result.items.length, 2);
  assert.equal(result.text, "first line\nsecond line");
  assert.equal(loop._userInputs.size, 0);
});

test("drainUserInputsAsText with clear=false preserves entries", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("test");
  const result = loop.drainUserInputsAsText({ clear: false });

  assert.equal(result.items.length, 1);
  assert.equal(loop._userInputs.size, 1);
});

test("hasPendingUserInputs returns correct status", async () => {
  const loop = await createTestLoop();

  assert.equal(loop.hasPendingUserInputs(), false);

  loop.recordUserInput("test");
  assert.equal(loop.hasPendingUserInputs(), true);

  loop.consumeUserInputs();
  assert.equal(loop.hasPendingUserInputs(), false);
});

test("formatUserInputs handles various payload types", async () => {
  const loop = await createTestLoop();

  // 字符串
  assert.equal(loop.formatUserInputs([{ payload: "  hello  " }]), "hello");

  // 带 text 属性的对象
  assert.equal(loop.formatUserInputs([{ payload: { text: "  world  " } }]), "world");

  // 带 message 属性的对象
  assert.equal(loop.formatUserInputs([{ payload: { message: "  msg  " } }]), "msg");

  // 普通对象 (JSON 序列化)
  assert.equal(loop.formatUserInputs([{ payload: { foo: "bar" } }]), '{"foo":"bar"}');

  // null payload 会回退到 item 本身并序列化
  assert.equal(loop.formatUserInputs([{ payload: null }, { payload: "valid" }]), '{"payload":null}\nvalid');

  // 纯 null 作为 item 会跳过
  assert.equal(loop.formatUserInputs([null, "direct"]), "direct");

  // 空数组
  assert.equal(loop.formatUserInputs([]), "");

  // 非数组输入
  assert.equal(loop.formatUserInputs(null), "");

  // 多行组合
  const multiResult = loop.formatUserInputs([{ payload: "line1" }, { payload: { text: "line2" } }, { payload: { message: "line3" } }]);
  assert.equal(multiResult, "line1\nline2\nline3");
});

test("formatUserInputs handles circular reference objects", async () => {
  const loop = await createTestLoop();

  const circular = { a: 1 };
  circular.self = circular;

  // 应该优雅处理循环引用，回退到 String()
  const result = loop.formatUserInputs([{ payload: circular }]);
  assert.ok(result.includes("object"), "should contain string representation");
});

test("applyUserInputsToConfig merges inputs into config", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("note 1");
  loop.recordUserInput("note 2");

  const config = { existingKey: "value" };
  const result = loop.applyUserInputsToConfig(config);

  assert.equal(result.existingKey, "value");
  assert.deepEqual(result.userNotes, ["note 1\nnote 2"]);
  assert.equal(result._lastUserNote, "note 1\nnote 2");
  assert.ok(result._lastUserNoteAt > 0);
  assert.equal(result._rawUserInputs.length, 2);
  assert.equal(loop._userInputs.size, 0);
});

test("applyUserInputsToConfig with custom key", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("custom note");

  const result = loop.applyUserInputsToConfig({}, { key: "customNotes" });

  assert.deepEqual(result.customNotes, ["custom note"]);
});

test("applyUserInputsToConfig appends to existing array", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("new note");

  const config = { userNotes: ["existing note"] };
  const result = loop.applyUserInputsToConfig(config);

  assert.deepEqual(result.userNotes, ["existing note", "new note"]);
});

test("applyUserInputsToConfig converts existing string to array", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("second");

  const config = { userNotes: "first" };
  const result = loop.applyUserInputsToConfig(config);

  assert.deepEqual(result.userNotes, ["first", "second"]);
});

test("applyUserInputsToConfig returns original config if no inputs", async () => {
  const loop = await createTestLoop();

  const config = { key: "value" };
  const result = loop.applyUserInputsToConfig(config);

  assert.equal(result, config);
});

test("applyUserInputsToConfig handles null/undefined config", async () => {
  const loop = await createTestLoop();

  loop.recordUserInput("test");

  const result1 = loop.applyUserInputsToConfig(null);
  assert.deepEqual(result1.userNotes, ["test"]);

  loop.recordUserInput("test2");
  const result2 = loop.applyUserInputsToConfig(undefined);
  assert.deepEqual(result2.userNotes, ["test2"]);
});

// ============================================================================
// Step 生命周期测试
// ============================================================================

test("_beginStep creates step with metadata and emits started event", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", actor: "lifecycle", emit });

  const before = Date.now();
  const { step, context } = loop._beginStep({ name: "test-step", runId: "run_1", iteration: 0 });
  const after = Date.now();

  assert.ok(step.stepId.startsWith("lifecycle_"));
  assert.equal(step.name, "test-step");
  assert.equal(step.runId, "run_1");
  assert.equal(step.iteration, 0);
  assert.ok(step.startedAt >= before && step.startedAt <= after);
  assert.ok(context.signal instanceof AbortSignal);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "lifecycle.step.started");
  assert.equal(events[0].record.status, "started");
});

test("_beginStep uses stepId from meta if provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ stepId: "custom_step_123" });

  assert.equal(step.stepId, "custom_step_123");
});

test("_beginStep uses step field as fallback for name", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ step: "fallback-name" });

  assert.equal(step.name, "fallback-name");
});

test("_beginStep defaults name to 'step' if not provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({});

  assert.equal(step.name, "step");
});

test("_beginStep sets _activeStep", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  assert.equal(loop._activeStep, null);

  loop._beginStep({ name: "active" });

  assert.ok(loop._activeStep);
  assert.equal(loop._activeStep.name, "active");
  assert.ok(loop._activeStep.signal instanceof AbortSignal);
  assert.ok(loop._activeStep.controller instanceof AbortController);
});

test("_endStep emits completed event by default", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0; // 清除 started 事件

  loop._endStep({ step });

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "lifecycle.step.completed");
  assert.equal(events[0].record.status, "completed");
});

test("_endStep emits custom status", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0;

  loop._endStep({ step }, { status: "failed", error: "boom" });

  assert.equal(events[0].name, "lifecycle.step.failed");
  assert.equal(events[0].record.status, "failed");
  assert.equal(events[0].record.payload.error, "boom");
});

test("_endStep includes result in payload", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  const { step } = loop._beginStep({ name: "test" });
  events.length = 0;

  loop._endStep({ step }, { result: { data: "success" } });

  assert.deepEqual(events[0].record.payload.result, { data: "success" });
});

test("_endStep clears _activeStep when matching", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { step } = loop._beginStep({ name: "test" });
  assert.ok(loop._activeStep);

  loop._endStep({ step });
  assert.equal(loop._activeStep, null);
});

test("_endStep does not clear _activeStep when not matching", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "first" });
  const firstStep = { ...loop._activeStep };

  loop._beginStep({ name: "second" });
  assert.notEqual(loop._activeStep.stepId, firstStep.stepId);

  // 结束第一个 step 不应清除当前活跃的第二个 step
  loop._endStep({ step: firstStep });
  assert.ok(loop._activeStep);
  assert.equal(loop._activeStep.name, "second");
});

test("_endStep uses _activeStep if step not provided", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "lifecycle", emit });

  loop._beginStep({ name: "implicit" });
  events.length = 0;

  loop._endStep(null);

  assert.equal(events[0].record.payload.name, "implicit");
});

test("_endStep handles null stepInfo gracefully", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  // 没有活跃 step 时调用不应抛出
  assert.doesNotThrow(() => loop._endStep(null));
  assert.doesNotThrow(() => loop._endStep(undefined));
  assert.doesNotThrow(() => loop._endStep({}));
});

test("_abortActiveStep aborts the active step controller", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "to-abort" });
  const controller = loop._activeStep.controller;

  assert.equal(controller.signal.aborted, false);

  loop._abortActiveStep("test reason");

  assert.equal(controller.signal.aborted, true);
});

test("_abortActiveStep uses default reason if not provided", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "to-abort" });

  loop._abortActiveStep();

  assert.equal(loop._activeStep.controller.signal.aborted, true);
});

test("_abortActiveStep does nothing if no active step", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  assert.doesNotThrow(() => loop._abortActiveStep("reason"));
});

test("_abortActiveStep does nothing if already aborted", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  loop._beginStep({ name: "already-aborted" });
  loop._activeStep.controller.abort("first");

  assert.doesNotThrow(() => loop._abortActiveStep("second"));
});

test("_createStepSignal creates independent signal", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const { signal, controller } = loop._createStepSignal(null);

  assert.ok(signal instanceof AbortSignal);
  assert.ok(controller instanceof AbortController);
  assert.equal(signal.aborted, false);

  controller.abort("test");
  assert.equal(signal.aborted, true);
});

test("_createStepSignal merges with parent signal", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  const parentController = new AbortController();
  const { signal } = loop._createStepSignal(parentController.signal);

  assert.equal(signal.aborted, false);

  parentController.abort("parent");
  assert.equal(signal.aborted, true);
});

test("_emitStepEvent does nothing if no emit function", async () => {
  const loop = await createTestLoop({ stageName: "lifecycle" });

  // 确保没有 emit 函数
  loop.emit = null;
  loop.eventBus = null;

  assert.doesNotThrow(() => loop._emitStepEvent("test", { data: "value" }));
});

// ============================================================================
// Loop 状态转换测试
// ============================================================================

test("_transitionPhase updates state.status", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running");

  assert.equal(state.status, "running");
});

test("_transitionPhase updates state.state when status not present", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = { state: "idle" };
  loop._transitionPhase(state, "running");

  assert.equal(state.state, "running");
});

test("_transitionPhase adds status to empty state object", async () => {
  const loop = await createTestLoop({ stageName: "transition" });

  const state = {};
  loop._transitionPhase(state, "running");

  assert.equal(state.status, "running");
});

test("_transitionPhase throws when state machine rejects transition", async () => {
  const stateMachine = {
    transition: () => false,
  };

  const loop = await createTestLoop({ stageName: "strict", stateMachine });

  const state = { status: "idle" };

  assert.throws(() => loop._transitionPhase(state, "invalid"), /phase transition rejected/);
});

test("_transitionPhase emits event with payload", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { emit, runId: "run_1", payload: { extra: "data" } });

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "transition.phase.transition");
  assert.equal(events[0].record.payload.from, "idle");
  assert.equal(events[0].record.payload.to, "running");
  assert.equal(events[0].record.payload.runId, "run_1");
  assert.equal(events[0].record.payload.extra, "data");
});

test("_transitionPhase uses custom eventName", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition" });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { emit, eventName: "custom.transition" });

  assert.equal(events[0].name, "custom.transition");
});

test("_transitionPhase uses loop emit when no emit provided", async () => {
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = await createTestLoop({ stageName: "transition", emit });

  const state = { status: "idle" };
  loop._transitionPhase(state, "running", { runId: "run_2" });

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "transition.phase.transition");
  assert.equal(events[0].record.payload.from, "idle");
  assert.equal(events[0].record.payload.to, "running");
});

// ============================================================================
// execute + hook tests
// ============================================================================

test("execute triggers PreAgent and PostAgent hooks", async () => {
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

  assert.equal(result.ok, true);
  assert.equal(preCalls.length, 1);
  assert.equal(postCalls.length, 1);
  assert.equal(preCalls[0].sessionId, "s1");
  assert.equal(preCalls[0].input.text, "hello");
  assert.equal(typeof preCalls[0].runId, "string");
  assert.equal(postCalls[0].result.ok, true);
  assert.equal(typeof postCalls[0].duration, "number");
});

test("execute respects PreAgent skip and emits skipped event", async () => {
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

  assert.equal(runCalls, 0);
  assert.deepEqual(result, { ok: false, error: "blocked" });
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "skipper.agent.skipped");
  assert.equal(events[0].record.payload.reason, "blocked");
});

test("execute calls PostAgent hook with error on failure", async () => {
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
  await assert.rejects(() => loop.execute({ sessionId: "s3" }, { text: "x" }, { eventBus }), /boom/);

  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].error.message, "boom");
});

test("execute swallows PostAgent hook errors and emits hook error event", async () => {
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

  assert.equal(result, "ok");
  assert.equal(hookErrors.length, 1);
  assert.equal(hookErrors[0].payload.error, "post boom");
});

// ============================================================================
// waitForUserAction tests
// ============================================================================

test("waitForUserAction resolves with payload", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "wait" });
  const loop = await createTestLoop({ eventBus });

  const promise = loop.waitForUserAction("confirm", { eventBus, timeout: 200 });
  eventBus.emit("user.action.confirm", { payload: { ok: true } });

  const result = await promise;
  assert.deepEqual(result, { ok: true });
});

test("waitForUserAction rejects on timeout", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "timeout" });
  const loop = await createTestLoop({ eventBus });

  await assert.rejects(
    loop.waitForUserAction("idle", { eventBus, timeout: 20 }),
    /Timeout waiting for user action: idle/
  );
});

test("waitForUserAction rejects on abort", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "abort" });
  const loop = await createTestLoop({ eventBus });
  const controller = new AbortController();

  const promise = loop.waitForUserAction("cancel", { eventBus, signal: controller.signal, timeout: 200 });
  controller.abort("stop");

  await assert.rejects(promise, /Run cancelled/);
});

test("waitForUserAction requires an eventBus with subscribe", async () => {
  const loop = await createTestLoop();

  await assert.rejects(loop.waitForUserAction("missing"), /eventBus with subscribe/);
});

// ============================================================================
// 并发安全测试
// ============================================================================

test("execute aborts superseded run", async () => {
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

  assert.deepEqual(secondResult, { ok: true, input: "second" });
  assert.equal(firstSignal?.aborted, true);

  releaseFirst();
  const firstResult = await firstPromise;
  assert.deepEqual(firstResult, { ok: true, input: "first" });
});

// ============================================================================
// pause/resume 测试
// ============================================================================

test("pause sets status to PAUSED and aborts active step", async () => {
  const { AgentStatus } = await import("../../js/agents/runtime/core/agent-status.js");
  const loop = await createTestLoop({ stageName: "pausable" });

  loop._transitionLoopStatus(AgentStatus.RUNNING, { force: true });

  loop._beginStep({ name: "active" });
  const stepController = loop._activeStep.controller;

  loop.pause("test reason");

  assert.equal(loop.isPaused, true);
  assert.equal(loop._pauseReason, "test reason");
  assert.equal(stepController.signal.aborted, true);
});

test("resume sets status to RUNNING from PAUSED", async () => {
  const loop = await createTestLoop({ stageName: "pausable" });

  loop.pause("hold");
  assert.equal(loop.isPaused, true);

  loop.resume();

  assert.equal(loop.isPaused, false);
  assert.equal(loop._pauseReason, null);
});

// ============================================================================
// 工具调用边界测试
// ============================================================================

test("_callTool catches synchronous errors", async () => {
  const loop = await createTestLoop({
    tools: {
      syncFail: () => {
        throw new Error("sync error");
      },
    },
  });

  const result = await loop._callTool("syncFail", {}, {});

  assert.equal(result.ok, false);
  assert.equal(result.error, "sync error");
});

test("_callTool handles tool returning undefined", async () => {
  const loop = await createTestLoop({
    tools: {
      noReturn: () => undefined,
    },
  });

  const result = await loop._callTool("noReturn", {}, {});

  assert.equal(result.ok, true);
  assert.equal(result.data, undefined);
});

test("_callTool handles tool returning null", async () => {
  const loop = await createTestLoop({
    tools: {
      nullReturn: () => null,
    },
  });

  const result = await loop._callTool("nullReturn", {}, {});

  assert.equal(result.ok, true);
  assert.equal(result.data, null);
});

// ============================================================================
// EventBus 监听器管理测试
// ============================================================================

test("_attachUserInputListener subscribes to user.input event", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "test" });
  const loop = await createTestLoop({ stageName: "input" });

  loop._attachUserInputListener(eventBus);

  eventBus.emit("user.input", { payload: "test input" });

  assert.equal(loop._userInputs.size, 1);
  assert.equal(loop._userInputs.toArray()[0].payload, "test input");
});

test("_attachUserInputListener does nothing without eventBus", async () => {
  const loop = await createTestLoop({ stageName: "input" });

  assert.doesNotThrow(() => loop._attachUserInputListener(null));
  assert.doesNotThrow(() => loop._attachUserInputListener(undefined));
});

test("_attachPauseListener subscribes once and pauses with reason", async () => {
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

  assert.equal(calls.length, 1);
  calls[0].handler({ payload: { reason: "coffee" } });

  assert.equal(loop.isPaused, true);
  assert.equal(loop._pauseReason, "coffee");
});

test("_detachEventBusListeners unsubscribes pause listener", async () => {
  let unsubCalls = 0;
  const eventBus = {
    subscribe: () => () => {
      unsubCalls += 1;
    },
  };

  const loop = await createTestLoop({ stageName: "cleanup" });

  loop._attachPauseListener(eventBus);
  loop._detachEventBusListeners();

  assert.equal(unsubCalls, 1);
});

test("_detachEventBusListeners cleans up subscriptions", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");

  const eventBus = new EventBus({ runId: "test" });
  const loop = await createTestLoop({ stageName: "cleanup" });

  loop._attachUserInputListener(eventBus);
  loop._attachPauseListener(eventBus);

  assert.ok(loop._userInputUnsub);
  assert.ok(loop._pauseListenerUnsub);

  loop._detachEventBusListeners();

  assert.equal(loop._userInputUnsub, null);
  assert.equal(loop._userInputBus, null);
  assert.equal(loop._pauseListenerUnsub, null);
});

// ============================================================================
// getContextStatus 测试
// ============================================================================

test("getContextStatus returns context information", async () => {
  const loop = await createTestLoop({
    contextConfig: { contextWindow: 1000, compressThreshold: 0.9 },
  });

  loop.addMessage({ role: "user", content: "hello" });

  const status = loop.getContextStatus();

  assert.equal(typeof status.tokenUsage.total, "number");
  assert.equal(typeof status.fillRatio, "number");
  assert.equal(typeof status.needsCompression, "boolean");
  assert.equal(typeof status.compressionPending, "boolean");
});

// ============================================================================
// 消息管理测试
// ============================================================================

test("addMessage delegates to MessageManager", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "test" });

  assert.equal(loop.messages.length, 1);
  assert.equal(loop.messages[0].role, "user");
  assert.equal(loop.messages[0].content, "test");
});

test("addMessages appends multiple messages", async () => {
  const loop = await createTestLoop();

  loop.addMessages([
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
  ]);

  assert.equal(loop.messages.length, 2);
  assert.equal(loop.messages[0].role, "user");
  assert.equal(loop.messages[1].role, "assistant");
});

test("resetMessages clears messages", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "one" });
  loop.addMessage({ role: "assistant", content: "two" });

  assert.equal(loop.messages.length, 2);

  await loop.resetMessages();

  assert.equal(loop.messages.length, 0);
});

// ============================================================================
// 工具注册测试
// ============================================================================

test("registerTool adds tool to registry", async () => {
  const loop = await createTestLoop();

  loop.registerTool("custom", async () => "result");

  const result = await loop._callTool("custom", {}, {});

  assert.equal(result.ok, true);
  assert.equal(result.data, "result");
});

test("tool registry exposes registered tool names", async () => {
  const loop = await createTestLoop({
    tools: {
      tool1: () => {},
      tool2: () => {},
    },
  });

  const tools = loop._toolRegistry.getToolNames();

  assert.ok(tools.includes("tool1"));
  assert.ok(tools.includes("tool2"));
});

// ============================================================================
// hooks 测试
// ============================================================================

test("hooks are called during tool execution", async () => {
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

  assert.equal(beforeCalls.length, 1);
  assert.equal(beforeCalls[0].tool, "myTool");
  assert.deepEqual(beforeCalls[0].params, { value: 5 });

  assert.equal(afterCalls.length, 1);
  assert.equal(afterCalls[0].tool, "myTool");
});

// ============================================================================
// dispose 测试
// ============================================================================

test("message manager dispose marks instance as disposed", async () => {
  const loop = await createTestLoop();

  loop.addMessage({ role: "user", content: "test" });

  loop._messageManager.dispose();

  assert.equal(loop._messageManager._disposed, true);
});

// ============================================================================
// 初始化测试
// ============================================================================

test("BaseAgentLoop.run throws when not implemented", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");
  const loop = new BaseAgentLoop();

  await assert.rejects(loop.run("input", {}), /not implemented/);
});

test("constructor with tools as Map", async () => {
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

  assert.ok(tools.includes("mapTool1"));
  assert.ok(tools.includes("mapTool2"));
});

test("constructor with tools as array of tuples", async () => {
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

  assert.ok(tools.includes("arrayTool1"));
  assert.ok(tools.includes("arrayTool2"));
});

test("constructor without options uses defaults", async () => {
  const { BaseAgentLoop } = await import("../../js/agents/runtime/core/agent-loop.js");

  class TestLoop extends BaseAgentLoop {
    async run() {
      return null;
    }
  }

  const loop = new TestLoop();

  assert.equal(loop.stageName, "agent");
  assert.equal(loop.actor, "agent");
  assert.equal(loop.eventBus, null);
});

// ============================================================================
// _isAbortError 测试
// ============================================================================

test("_isAbortError detects abort errors", async () => {
  const loop = await createTestLoop();

  const controller = new AbortController();
  controller.abort("test");

  const abortError = new Error("AbortError");
  abortError.name = "AbortError";

  assert.equal(loop._isAbortError(abortError, controller.signal), true);
});

test("_isAbortError returns false for non-abort errors", async () => {
  const loop = await createTestLoop();

  const regularError = new Error("regular");
  const controller = new AbortController();

  assert.equal(loop._isAbortError(regularError, controller.signal), false);
});
