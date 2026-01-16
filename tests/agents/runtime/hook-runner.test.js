import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createPreToolUseHook,
  createPreAgentHook,
  createPostAgentHook,
} from "../../../js/agents/runtime/hooks/hook-runner.js";
import { HookRegistry, HookType } from "../../../js/agents/runtime/hooks/hook-registry.js";
import { enhanceEventBusWithHooks } from "../../../js/agents/runtime/hooks/event-bus-hooks.js";

/** Helper: create mock EventBus with hook registry attached */
function createMockEventBus() {
  const events = [];
  const bus = {
    emit(event, payload) {
      events.push({ event, payload });
    },
    events,
  };
  return enhanceEventBusWithHooks(bus);
}

/** Helper: create context with eventBus */
function createContext(eventBus, extras = {}) {
  return { eventBus, ...extras };
}

async function getDeniedArgs(params, contextOverrides = {}) {
  const eventBus = createMockEventBus();
  const context = createContext(eventBus, {
    toolRestrictions: { blockedTools: ["write"] },
    ...contextOverrides,
  });
  const hook = createPreToolUseHook();
  await hook({ tool: "write", params, context });
  const denied = eventBus.events.find((e) => e.event === "tool.denied");
  assert.ok(denied, "expected tool.denied event");
  return denied.payload.args;
}

async function runPromptDecision(content) {
  const eventBus = createMockEventBus();
  eventBus.registerHook("PreToolUse", {
    type: HookType.PROMPT,
    prompt: "Check",
    blocking: true,
  });
  const modelRouter = {
    call: async () => ({ content }),
  };
  const context = createContext(eventBus, { modelRouter });
  const hook = createPreToolUseHook();
  return hook({ tool: "read", params: {}, context });
}

// -----------------------------------------------------------------------------
// createPreToolUseHook
// -----------------------------------------------------------------------------

describe("createPreToolUseHook", () => {
  describe("basic behavior", () => {
    it("returns null when no eventBus in context", async () => {
      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context: {} });
      assert.equal(result, null);
    });

    it("returns null when no hooks registered", async () => {
      const eventBus = createMockEventBus();
      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });
      assert.equal(result, null);
    });

    it("accepts custom eventName option", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("CustomPreTool", { type: HookType.COMMAND });

      const hook = createPreToolUseHook({ eventName: "CustomPreTool" });
      const result = await hook({
        tool: "bash",
        params: { command: "ls" },
        context: createContext(eventBus),
      });
      // COMMAND hook with safe command => null (allow)
      assert.equal(result, null);
    });
  });

  describe("tool restrictions (blockedTools)", () => {
    it("blocks tool in blockedTools list", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { blockedTools: ["write", "edit"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: { path: "/tmp/x" }, context });

      assert.equal(result.skip, true);
      assert.equal(result.value.ok, false);
      assert.equal(result.value.error, "tool_blocked");
      assert.equal(result.value.policy.hookType, "restriction");
    });

    it("allows tool not in blockedTools", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { blockedTools: ["write"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      assert.equal(result, null);
    });

    it("emits tool.denied event when blocked", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { blockedTools: ["delete_file"] },
      });

      const hook = createPreToolUseHook();
      await hook({ tool: "delete_file", params: { path: "/x" }, context });

      const denied = eventBus.events.find((e) => e.event === "tool.denied");
      assert.ok(denied);
      assert.equal(denied.payload.tool, "delete_file");
    });
  });

  describe("tool restrictions (allowedTools)", () => {
    it("blocks tool not in allowedTools", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { allowedTools: ["read", "glob"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: {}, context });

      assert.equal(result.skip, true);
      assert.equal(result.value.error, "tool_not_allowed");
    });

    it("allows tool in allowedTools", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { allowedTools: ["read", "glob"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "glob", params: {}, context });
      assert.equal(result, null);
    });
  });

  describe("readonly permissionLevel", () => {
    it("blocks write tools in readonly mode", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: {}, context });

      assert.equal(result.skip, true);
      assert.equal(result.value.ok, false);
    });

    it("allows read tools in readonly mode", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      assert.equal(result, null);
    });

    it("blocks non-readonly bash commands", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "npm install" },
        context,
      });

      assert.equal(result.skip, true);
    });

    it("allows readonly bash commands (ls, cat, grep)", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      for (const cmd of ["ls -la", "cat file.txt", "grep pattern file"]) {
        const result = await hook({ tool: "bash", params: { command: cmd }, context });
        assert.equal(result, null, `should allow: ${cmd}`);
      }
    });
  });

  describe("HookType.COMMAND", () => {
    it("blocks dangerous command in blocking mode", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.COMMAND,
        tools: ["bash"],
        blocking: true,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "rm -rf /" },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("requires approval"));
    });

    it("allows safe command", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.COMMAND,
        tools: ["bash"],
        blocking: true,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "ls -la" },
        context: createContext(eventBus),
      });

      assert.equal(result, null);
    });

    it("does not block in non-blocking mode", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.COMMAND,
        tools: ["bash"],
        blocking: false,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "rm -rf /" },
        context: createContext(eventBus),
      });

      // non-blocking => continues, returns null
      assert.equal(result, null);
    });
  });

  describe("HookType.PROMPT", () => {
    it("blocks when ModelRouter unavailable (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Is this safe? tool={{tool}}",
        blocking: true,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "echo hi" },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("ModelRouter unavailable"));
    });

    it("continues when ModelRouter unavailable (non-blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Check",
        blocking: false,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "read",
        params: {},
        context: createContext(eventBus),
      });

      assert.equal(result, null);
    });

    it("allows when model returns allow", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Check {{tool}}",
        blocking: true,
      });

      const modelRouter = {
        call: async () => ({ content: '{"allow": true, "reason": "ok"}' }),
      };
      const context = createContext(eventBus, { modelRouter });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });

      assert.equal(result, null);
    });

    it("blocks when model returns deny", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Check {{tool}}",
        blocking: true,
      });

      const modelRouter = {
        call: async () => ({ content: '{"allow": false, "reason": "not safe"}' }),
      };
      const context = createContext(eventBus, { modelRouter });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "bash", params: {}, context });

      assert.equal(result.skip, true);
      assert.equal(result.value.error, "not safe");
    });

    it("blocks when model response unparseable (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Check",
        blocking: true,
      });

      const modelRouter = {
        call: async () => ({ content: "random garbage" }),
      };
      const context = createContext(eventBus, { modelRouter });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("unparseable"));
    });

    it("blocks when model call throws (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.PROMPT,
        prompt: "Check",
        blocking: true,
      });

      const modelRouter = {
        call: async () => {
          throw new Error("network error");
        },
      };
      const context = createContext(eventBus, { modelRouter });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("network error"));
    });
  });

  describe("HookType.AGENT", () => {
    it("blocks when SubagentRegistry unavailable (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "safety",
        blocking: true,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: {},
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("SubagentRegistry unavailable"));
    });

    it("blocks when agentType not found (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "unknown_agent",
        blocking: true,
      });

      const subagentRegistry = {
        getFactory: () => null,
      };
      const context = createContext(eventBus, { subagentRegistry });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "bash", params: {}, context });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("unknown agentType"));
    });

    it("allows when agent returns allow", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "safety",
        prompt: "Check {{tool}}",
        blocking: true,
      });

      const subagentRegistry = {
        getFactory: (type) => {
          if (type === "safety") {
            return async () => ({
              run: async () => ({ allow: true }),
            });
          }
          return null;
        },
      };
      const context = createContext(eventBus, { subagentRegistry });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });

      assert.equal(result, null);
    });

    it("blocks when agent returns deny", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "safety",
        blocking: true,
      });

      const subagentRegistry = {
        getFactory: (type) => {
          if (type === "safety") {
            return async () => ({
              run: async () => ({ decision: "deny", reason: "risky" }),
            });
          }
          return null;
        },
      };
      const context = createContext(eventBus, { subagentRegistry });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "bash", params: {}, context });

      assert.equal(result.skip, true);
      assert.equal(result.value.error, "risky");
    });

    it("blocks when agent throws (blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "safety",
        blocking: true,
      });

      const subagentRegistry = {
        getFactory: () => async () => ({
          run: async () => {
            throw new Error("agent crashed");
          },
        }),
      };
      const context = createContext(eventBus, { subagentRegistry });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });

      assert.equal(result.skip, true);
      assert.ok(result.value.error.includes("agent crashed"));
    });

    it("continues when SubagentRegistry unavailable (non-blocking)", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", {
        type: HookType.AGENT,
        agentType: "safety",
        blocking: false,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "read",
        params: {},
        context: createContext(eventBus),
      });

      assert.equal(result, null);
    });
  });

  describe("context resolution variants", () => {
    it("resolves eventBus from stageApi.eventBus", async () => {
      const eventBus = createMockEventBus();
      const context = { stageApi: { eventBus } };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      assert.equal(result, null);
    });

    it("resolves eventBus from services.eventBus", async () => {
      const eventBus = createMockEventBus();
      const context = { services: { eventBus } };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      assert.equal(result, null);
    });

    it("resolves toolRestrictions from stageApi", async () => {
      const eventBus = createMockEventBus();
      const context = {
        eventBus,
        stageApi: { toolRestrictions: { blockedTools: ["write"] } },
      };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: {}, context });
      assert.equal(result.skip, true);
    });

    it("resolves permissionLevel from options", async () => {
      const eventBus = createMockEventBus();
      const context = {
        eventBus,
        options: { permissionLevel: "readonly" },
      };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "edit", params: {}, context });
      assert.equal(result.skip, true);
    });
  });

  describe("command extraction from params", () => {
    it("extracts command from params.command", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: true });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "rm -rf /" },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
    });

    it("extracts command from params.cmd", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: true });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { cmd: "rm -rf /" },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
    });

    it("extracts command from params.argv array", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: true });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { argv: ["rm", "-rf", "/"] },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
    });

    it("handles string params directly", async () => {
      const eventBus = createMockEventBus();
      eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: true });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: "rm -rf /",
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
    });
  });

  describe("multiple hooks execution", () => {
    it("stops at first blocking denial", async () => {
      const eventBus = createMockEventBus();
      let secondHookCalled = false;

      // First hook denies
      eventBus.registerHook("PreToolUse", {
        type: HookType.COMMAND,
        tools: ["bash"],
        blocking: true,
      });

      const hook = createPreToolUseHook();
      const result = await hook({
        tool: "bash",
        params: { command: "rm -rf /" },
        context: createContext(eventBus),
      });

      assert.equal(result.skip, true);
    });
  });
});

// -----------------------------------------------------------------------------
// createPreAgentHook
// -----------------------------------------------------------------------------

describe("createPreAgentHook", () => {
  it("returns null when no eventBus in context", async () => {
    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s1", runId: "r1", input: {}, context: {} });
    assert.equal(result, null);
  });

  it("returns null when no hooks registered", async () => {
    const eventBus = createMockEventBus();
    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s1", runId: "r1", input: {}, context: createContext(eventBus) });
    assert.equal(result, null);
  });

  it("accepts custom eventName", async () => {
    const eventBus = createMockEventBus();
    let called = false;
    eventBus.registerHook("CustomPreAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        called = true;
        return null;
      },
    });

    const hook = createPreAgentHook({ eventName: "CustomPreAgent" });
    await hook({ sessionId: "s1", runId: "r1", input: {}, context: createContext(eventBus) });

    assert.equal(called, true);
  });

  it("calls handler with correct params", async () => {
    const eventBus = createMockEventBus();
    let receivedCtx = null;

    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: async (ctx) => {
        receivedCtx = ctx;
        return null;
      },
    });

    const hook = createPreAgentHook();
    await hook({
      sessionId: "sess123",
      runId: "run456",
      input: { query: "hello" },
      context: createContext(eventBus),
    });

    assert.equal(receivedCtx.sessionId, "sess123");
    assert.equal(receivedCtx.runId, "run456");
    assert.deepEqual(receivedCtx.input, { query: "hello" });
  });

  it("blocks when handler returns skip (blocking)", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: true,
      handler: async () => ({ skip: true, reason: "rate limited" }),
    });

    const hook = createPreAgentHook();
    const result = await hook({
      sessionId: "s1",
      runId: "r1",
      input: {},
      context: createContext(eventBus),
    });

    assert.equal(result.skip, true);
    assert.equal(result.reason, "rate limited");
  });

  it("emits agent.denied event when blocked", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: true,
      handler: async () => ({ skip: true, reason: "quota exceeded" }),
    });

    const hook = createPreAgentHook();
    await hook({ sessionId: "s1", runId: "r1", input: {}, context: createContext(eventBus) });

    const denied = eventBus.events.find((e) => e.event === "agent.denied");
    assert.ok(denied);
    assert.equal(denied.payload.sessionId, "s1");
    assert.equal(denied.payload.reason, "quota exceeded");
  });

  it("does not block when handler returns skip but non-blocking", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: false,
      handler: async () => ({ skip: true }),
    });

    const hook = createPreAgentHook();
    const result = await hook({
      sessionId: "s1",
      runId: "r1",
      input: {},
      context: createContext(eventBus),
    });

    assert.equal(result, null);
  });

  it("blocks when handler throws (blocking)", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: true,
      handler: async () => {
        throw new Error("auth failed");
      },
    });

    const hook = createPreAgentHook();
    const result = await hook({
      sessionId: "s1",
      runId: "r1",
      input: {},
      context: createContext(eventBus),
    });

    assert.equal(result.skip, true);
    assert.ok(result.reason.includes("auth failed"));
  });

  it("continues when handler throws (non-blocking)", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: false,
      handler: async () => {
        throw new Error("minor issue");
      },
    });

    const hook = createPreAgentHook();
    const result = await hook({
      sessionId: "s1",
      runId: "r1",
      input: {},
      context: createContext(eventBus),
    });

    assert.equal(result, null);
  });

  it("supports value in blocked result", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: true,
      handler: async () => ({ skip: true, value: { cached: true }, reason: "cached" }),
    });

    const hook = createPreAgentHook();
    const result = await hook({
      sessionId: "s1",
      runId: "r1",
      input: {},
      context: createContext(eventBus),
    });

    assert.equal(result.skip, true);
    assert.deepEqual(result.value, { cached: true });
  });

  it("executes multiple hooks in order", async () => {
    const eventBus = createMockEventBus();
    const order = [];

    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        order.push(1);
        return null;
      },
    });
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        order.push(2);
        return null;
      },
    });

    const hook = createPreAgentHook();
    await hook({ sessionId: "s1", runId: "r1", input: {}, context: createContext(eventBus) });

    assert.deepEqual(order, [1, 2]);
  });
});

// -----------------------------------------------------------------------------
// createPostAgentHook
// -----------------------------------------------------------------------------

describe("createPostAgentHook", () => {
  it("returns immediately when no eventBus in context", async () => {
    const hook = createPostAgentHook();
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: {} });
    // no error = pass
  });

  it("returns immediately when no hooks registered", async () => {
    const eventBus = createMockEventBus();
    const hook = createPostAgentHook();
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: createContext(eventBus) });
    // no error = pass
  });

  it("accepts custom eventName", async () => {
    const eventBus = createMockEventBus();
    let called = false;
    eventBus.registerHook("CustomPostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        called = true;
      },
    });

    const hook = createPostAgentHook({ eventName: "CustomPostAgent" });
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: createContext(eventBus) });

    assert.equal(called, true);
  });

  it("calls handler with all params", async () => {
    const eventBus = createMockEventBus();
    let receivedCtx = null;

    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async (ctx) => {
        receivedCtx = ctx;
      },
    });

    const hook = createPostAgentHook();
    await hook({
      sessionId: "sess123",
      runId: "run456",
      input: { query: "hello" },
      result: { answer: "world" },
      error: null,
      duration: 1234,
      context: createContext(eventBus),
    });

    assert.equal(receivedCtx.sessionId, "sess123");
    assert.equal(receivedCtx.runId, "run456");
    assert.deepEqual(receivedCtx.input, { query: "hello" });
    assert.deepEqual(receivedCtx.result, { answer: "world" });
    assert.equal(receivedCtx.duration, 1234);
  });

  it("does not block on handler error", async () => {
    const eventBus = createMockEventBus();
    let secondCalled = false;

    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        throw new Error("logging failed");
      },
    });
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        secondCalled = true;
      },
    });

    const hook = createPostAgentHook();
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: createContext(eventBus) });

    assert.equal(secondCalled, true);
  });

  it("emits agent.hook.error when handler throws", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        throw new Error("db write failed");
      },
    });

    const hook = createPostAgentHook();
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: createContext(eventBus) });

    const errEvt = eventBus.events.find((e) => e.event === "agent.hook.error");
    assert.ok(errEvt);
    assert.equal(errEvt.payload.sessionId, "s1");
    assert.ok(errEvt.payload.error.includes("db write failed"));
  });

  it("executes all hooks even if some fail", async () => {
    const eventBus = createMockEventBus();
    const order = [];

    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        order.push(1);
        throw new Error("fail1");
      },
    });
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        order.push(2);
      },
    });
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async () => {
        order.push(3);
        throw new Error("fail3");
      },
    });

    const hook = createPostAgentHook();
    await hook({ sessionId: "s1", runId: "r1", result: {}, context: createContext(eventBus) });

    assert.deepEqual(order, [1, 2, 3]);
    const errors = eventBus.events.filter((e) => e.event === "agent.hook.error");
    assert.equal(errors.length, 2);
  });

  it("receives error object when agent failed", async () => {
    const eventBus = createMockEventBus();
    let receivedError = null;

    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: async (ctx) => {
        receivedError = ctx.error;
      },
    });

    const hook = createPostAgentHook();
    const testError = new Error("agent crashed");
    await hook({
      sessionId: "s1",
      runId: "r1",
      result: null,
      error: testError,
      context: createContext(eventBus),
    });

    assert.equal(receivedError, testError);
  });
});

// -----------------------------------------------------------------------------
// Integration: hook factories with HookRegistry directly
// -----------------------------------------------------------------------------

describe("Hook factory integration", () => {
  it("works with manually created HookRegistry", async () => {
    const registry = new HookRegistry();
    registry.register("PreToolUse", {
      type: HookType.COMMAND,
      tools: ["bash"],
      blocking: true,
    });

    // Simulate eventBus with registry attached
    const eventBus = { emit: () => {} };
    Object.defineProperty(eventBus, Symbol.for("paperburner.hookRegistry.v1"), {
      value: registry,
      enumerable: false,
    });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "bash",
      params: { command: "rm -rf /" },
      context: { eventBus },
    });

    assert.equal(result.skip, true);
  });
});

// -----------------------------------------------------------------------------
// sanitize helpers / template / parsing coverage
// -----------------------------------------------------------------------------

describe("sanitizeString", () => {
  it("redacts authorization headers and common token formats", async () => {
    const args = await getDeniedArgs({
      headerValue: "Authorization: Bearer abc123",
      openaiValue: "sk-1234567890abcdef1234",
      ghValue: "ghp_1234567890abcdef1234",
      patValue: "github_pat_1234567890abcdef1234",
      slackValue: "xoxb-1234567890-abcdefghij",
    });

    assert.equal(args.headerValue, "Authorization: Bearer [REDACTED]");
    assert.equal(args.openaiValue, "sk-[REDACTED]");
    assert.equal(args.ghValue, "ghp_[REDACTED]");
    assert.equal(args.patValue, "github_pat_[REDACTED]");
    assert.equal(args.slackValue, "xox-...-[REDACTED]");
  });

  it("redacts jwt tokens and password flags", async () => {
    const args = await getDeniedArgs({
      payloadValue: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
      cliValue: "run --password supersecret -u admin:supersecret",
    });

    assert.equal(args.payloadValue, "[REDACTED]");
    assert.ok(args.cliValue.includes("--password [REDACTED]"));
    assert.ok(args.cliValue.includes("-u admin:[REDACTED]"));
    assert.ok(!args.cliValue.includes("supersecret"));
  });

  it("redacts env var style secrets", async () => {
    const args = await getDeniedArgs({
      envValue: "API_KEY=supersecret OTHER=ok",
    });

    assert.equal(args.envValue, "API_KEY=[REDACTED] OTHER=ok");
  });
});

describe("sanitizeArgs", () => {
  it("redacts sensitive keys", async () => {
    const args = await getDeniedArgs({
      password: "supersecret",
      secret: "topsecret",
      token: "tok123",
      api_key: "key123",
      nested: { password: "nested" },
    });

    assert.equal(args.password, "[REDACTED]");
    assert.equal(args.secret, "[REDACTED]");
    assert.equal(args.token, "[REDACTED]");
    assert.equal(args.api_key, "[REDACTED]");
    assert.equal(args.nested.password, "[REDACTED]");
  });

  it("handles circular references", async () => {
    const node = { name: "node" };
    node.self = node;

    const args = await getDeniedArgs({ node });
    assert.equal(args.node.self, "[Circular]");
  });

  it("caps max depth", async () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };
    const args = await getDeniedArgs({ deep });

    assert.equal(args.deep.a.b.c.d.e, "[MaxDepth]");
  });

  it("caps array length", async () => {
    const items = Array.from({ length: 55 }, (_, idx) => idx);
    const args = await getDeniedArgs({ items });

    assert.equal(args.items.length, 51);
    assert.equal(args.items[50], "[+5 items]");
  });

  it("formats typed arrays and array buffers", async () => {
    const args = await getDeniedArgs({
      bufferValue: new ArrayBuffer(8),
      typedValue: new Uint8Array(4),
    });

    assert.equal(args.bufferValue, "[ArrayBuffer 8 bytes]");
    assert.equal(args.typedValue, "[Uint8Array 4 bytes]");
  });
});

describe("renderTemplate", () => {
  it("renders template variables from tool and args", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreToolUse", {
      type: HookType.PROMPT,
      prompt: "tool={{tool}} args={{args}} missing={{missing}}",
      blocking: true,
    });

    let promptText = "";
    const modelRouter = {
      call: async ({ messages }) => {
        promptText = messages?.[1]?.content || "";
        return { content: '{"allow": true}' };
      },
    };
    const context = createContext(eventBus, { modelRouter });

    const hook = createPreToolUseHook();
    const params = { foo: "bar" };
    const result = await hook({ tool: "read", params, context });

    assert.equal(result, null);
    assert.equal(promptText, `tool=read args=${JSON.stringify(params)} missing=`);
  });
});

describe("parseAllowDenyText", () => {
  it("accepts JSON allow variants", async () => {
    for (const content of ['{"allow": true}', '{"allowed": true}', '{"decision": "allow"}']) {
      const result = await runPromptDecision(content);
      assert.equal(result, null, `should allow: ${content}`);
    }
  });

  it("denies JSON decision deny", async () => {
    const result = await runPromptDecision('{"decision": "deny"}');
    assert.equal(result.skip, true);
  });

  it("accepts text allow/ok/permit", async () => {
    for (const content of ["allow", "ok", "permit"]) {
      const result = await runPromptDecision(content);
      assert.equal(result, null, `should allow: ${content}`);
    }
  });

  it("denies text deny/block", async () => {
    for (const content of ["deny", "block"]) {
      const result = await runPromptDecision(content);
      assert.equal(result.skip, true, `should deny: ${content}`);
    }
  });
});

describe("container resolution", () => {
  it("resolves modelRouter from container", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreToolUse", {
      type: HookType.PROMPT,
      prompt: "Check {{tool}}",
      blocking: true,
    });

    let requestedId = null;
    let routerCalled = false;
    const modelRouter = {
      call: async () => {
        routerCalled = true;
        return { content: '{"allow": true}' };
      },
    };
    const container = {
      get: async (serviceId) => {
        requestedId = serviceId;
        return modelRouter;
      },
    };
    const context = createContext(eventBus, { container });

    const hook = createPreToolUseHook();
    const result = await hook({ tool: "read", params: {}, context });

    assert.equal(result, null);
    assert.equal(requestedId, "modelRouter");
    assert.equal(routerCalled, true);
  });

  it("resolves subagentRegistry from container", async () => {
    const eventBus = createMockEventBus();
    eventBus.registerHook("PreToolUse", {
      type: HookType.AGENT,
      agentType: "safety",
      prompt: "Check {{tool}}",
      blocking: true,
    });

    let requestedId = null;
    const subagentRegistry = {
      getFactory: (type) => {
        if (type !== "safety") return null;
        return async () => ({
          run: async () => ({ allow: true }),
        });
      },
    };
    const container = {
      get: async (serviceId) => {
        requestedId = serviceId;
        return subagentRegistry;
      },
    };
    const context = createContext(eventBus, { container });

    const hook = createPreToolUseHook();
    const result = await hook({ tool: "read", params: {}, context });

    assert.equal(result, null);
    assert.equal(requestedId, "subagentRegistry");
  });
});
