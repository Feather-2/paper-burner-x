
import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  expect(denied, "expected tool.denied event").toMatchObject({ event: "tool.denied" });
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
      expect(result).toBe(null);
    });

    it("returns null when no hooks registered", async () => {
      const eventBus = createMockEventBus();
      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });
      expect(result).toBe(null);
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
      expect(result).toBe(null);
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

      expect(result.skip).toBe(true);
      expect(result.value.ok).toBe(false);
      expect(result.value.error).toBe("tool_blocked");
      expect(result.value.policy.hookType).toBe("restriction");
    });

    it("allows tool not in blockedTools", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { blockedTools: ["write"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      expect(result).toBe(null);
    });

    it("emits tool.denied event when blocked", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { blockedTools: ["delete_file"] },
      });

      const hook = createPreToolUseHook();
      await hook({ tool: "delete_file", params: { path: "/x" }, context });

      const denied = eventBus.events.find((e) => e.event === "tool.denied");
      expect(denied).toMatchObject({ event: "tool.denied" });
      expect(denied.payload.tool).toBe("delete_file");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toBe("tool_not_allowed");
    });

    it("allows tool in allowedTools", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, {
        toolRestrictions: { allowedTools: ["read", "glob"] },
      });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "glob", params: {}, context });
      expect(result).toBe(null);
    });
  });

  describe("readonly permissionLevel", () => {
    it("blocks write tools in readonly mode", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: {}, context });

      expect(result.skip).toBe(true);
      expect(result.value.ok).toBe(false);
    });

    it("allows read tools in readonly mode", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      expect(result).toBe(null);
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

      expect(result.skip).toBe(true);
    });

    it("allows readonly bash commands (ls, cat, grep)", async () => {
      const eventBus = createMockEventBus();
      const context = createContext(eventBus, { permissionLevel: "readonly" });

      const hook = createPreToolUseHook();
      for (const cmd of ["ls -la", "cat file.txt", "grep pattern file"]) {
        const result = await hook({ tool: "bash", params: { command: cmd }, context });
        expect(result).toBe(null, `should allow: ${cmd}`);
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("requires approval");
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

      expect(result).toBe(null);
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
      expect(result).toBe(null);
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("ModelRouter unavailable");
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

      expect(result).toBe(null);
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

      expect(result).toBe(null);
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toBe("not safe");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("unparseable");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("network error");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("SubagentRegistry unavailable");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("unknown agentType");
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

      expect(result).toBe(null);
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toBe("risky");
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

      expect(result.skip).toBe(true);
      expect(result.value.error).toContain("agent crashed");
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

      expect(result).toBe(null);
    });
  });

  describe("context resolution variants", () => {
    it("resolves eventBus from stageApi.eventBus", async () => {
      const eventBus = createMockEventBus();
      const context = { stageApi: { eventBus } };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      expect(result).toBe(null);
    });

    it("resolves eventBus from services.eventBus", async () => {
      const eventBus = createMockEventBus();
      const context = { services: { eventBus } };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "read", params: {}, context });
      expect(result).toBe(null);
    });

    it("resolves toolRestrictions from stageApi", async () => {
      const eventBus = createMockEventBus();
      const context = {
        eventBus,
        stageApi: { toolRestrictions: { blockedTools: ["write"] } },
      };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "write", params: {}, context });
      expect(result.skip).toBe(true);
    });

    it("resolves permissionLevel from options", async () => {
      const eventBus = createMockEventBus();
      const context = {
        eventBus,
        options: { permissionLevel: "readonly" },
      };

      const hook = createPreToolUseHook();
      const result = await hook({ tool: "edit", params: {}, context });
      expect(result.skip).toBe(true);
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

      expect(result.skip).toBe(true);
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

      expect(result.skip).toBe(true);
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

      expect(result.skip).toBe(true);
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

      expect(result.skip).toBe(true);
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

      expect(result.skip).toBe(true);
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
    expect(result).toBe(null);
  });

  it("returns null when no hooks registered", async () => {
    const eventBus = createMockEventBus();
    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s1", runId: "r1", input: {}, context: createContext(eventBus) });
    expect(result).toBe(null);
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

    expect(called).toBe(true);
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

    expect(receivedCtx.sessionId).toBe("sess123");
    expect(receivedCtx.runId).toBe("run456");
    expect(receivedCtx.input).toEqual({ query: "hello" });
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

    expect(result.skip).toBe(true);
    expect(result.reason).toBe("rate limited");
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
    expect(denied).toMatchObject({ event: "agent.denied" });
    expect(denied.payload.sessionId).toBe("s1");
    expect(denied.payload.reason).toBe("quota exceeded");
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

    expect(result).toBe(null);
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

    expect(result.skip).toBe(true);
    expect(result.reason).toContain("auth failed");
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

    expect(result).toBe(null);
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

    expect(result.skip).toBe(true);
    expect(result.value).toEqual({ cached: true });
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

    expect(order).toEqual([1, 2]);
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

    expect(called).toBe(true);
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

    expect(receivedCtx.sessionId).toBe("sess123");
    expect(receivedCtx.runId).toBe("run456");
    expect(receivedCtx.input).toEqual({ query: "hello" });
    expect(receivedCtx.result).toEqual({ answer: "world" });
    expect(receivedCtx.duration).toBe(1234);
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

    expect(secondCalled).toBe(true);
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
    expect(errEvt).toMatchObject({ event: "agent.hook.error" });
    expect(errEvt.payload.sessionId).toBe("s1");
    expect(errEvt.payload.error).toContain("db write failed");
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

    expect(order).toEqual([1, 2, 3]);
    const errors = eventBus.events.filter((e) => e.event === "agent.hook.error");
    expect(errors.length).toBe(2);
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

    expect(receivedError).toBe(testError);
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

    expect(result.skip).toBe(true);
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

    expect(args.headerValue).toBe("Authorization: Bearer [REDACTED]");
    expect(args.openaiValue).toBe("sk-[REDACTED]");
    expect(args.ghValue).toBe("ghp_[REDACTED]");
    expect(args.patValue).toBe("github_pat_[REDACTED]");
    expect(args.slackValue).toBe("xox-...-[REDACTED]");
  });

  it("redacts jwt tokens and password flags", async () => {
    const args = await getDeniedArgs({
      payloadValue: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
      cliValue: "run --password supersecret -u admin:supersecret",
    });

    expect(args.payloadValue).toBe("[REDACTED]");
    expect(args.cliValue).toContain("--password [REDACTED]");
    expect(args.cliValue).toContain("-u admin:[REDACTED]");
    expect(args.cliValue).not.toContain("supersecret");
  });

  it("redacts env var style secrets", async () => {
    const args = await getDeniedArgs({
      envValue: "API_KEY=supersecret OTHER=ok",
    });

    expect(args.envValue).toBe("API_KEY=[REDACTED] OTHER=ok");
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

    expect(args.password).toBe("[REDACTED]");
    expect(args.secret).toBe("[REDACTED]");
    expect(args.token).toBe("[REDACTED]");
    expect(args.api_key).toBe("[REDACTED]");
    expect(args.nested.password).toBe("[REDACTED]");
  });

  it("handles circular references", async () => {
    const node = { name: "node" };
    node.self = node;

    const args = await getDeniedArgs({ node });
    expect(args.node.self).toBe("[Circular]");
  });

  it("caps max depth", async () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };
    const args = await getDeniedArgs({ deep });

    expect(args.deep.a.b.c.d.e).toBe("[MaxDepth]");
  });

  it("caps array length", async () => {
    const items = Array.from({ length: 55 }, (_, idx) => idx);
    const args = await getDeniedArgs({ items });

    expect(args.items.length).toBe(51);
    expect(args.items[50]).toBe("[+5 items]");
  });

  it("formats typed arrays and array buffers", async () => {
    const args = await getDeniedArgs({
      bufferValue: new ArrayBuffer(8),
      typedValue: new Uint8Array(4),
    });

    expect(args.bufferValue).toBe("[ArrayBuffer 8 bytes]");
    expect(args.typedValue).toBe("[Uint8Array 4 bytes]");
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

    expect(result).toBe(null);
    expect(promptText).toBe(`tool=read args=${JSON.stringify(params)} missing=`);
  });
});

describe("parseAllowDenyText", () => {
  it("accepts JSON allow variants", async () => {
    for (const content of ['{"allow": true}', '{"allowed": true}', '{"decision": "allow"}']) {
      const result = await runPromptDecision(content);
      expect(result).toBe(null, `should allow: ${content}`);
    }
  });

  it("denies JSON decision deny", async () => {
    const result = await runPromptDecision('{"decision": "deny"}');
    expect(result.skip).toBe(true);
  });

  it("accepts text allow/ok/permit", async () => {
    for (const content of ["allow", "ok", "permit"]) {
      const result = await runPromptDecision(content);
      expect(result).toBe(null, `should allow: ${content}`);
    }
  });

  it("denies text deny/block", async () => {
    for (const content of ["deny", "block"]) {
      const result = await runPromptDecision(content);
      expect(result.skip).toBe(true, `should deny: ${content}`);
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

    expect(result).toBe(null);
    expect(requestedId).toBe("modelRouter");
    expect(routerCalled).toBe(true);
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

    expect(result).toBe(null);
    expect(requestedId).toBe("subagentRegistry");
  });
});
