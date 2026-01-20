import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/runtime/safety/command-classifier.js", () => ({
  classifyCommand: vi.fn(),
}));

vi.mock("../../../../../js/agents/runtime/safety/tool-restrictions.js", () => ({
  evaluateToolRestrictions: vi.fn(),
  normalizeToolRestrictions: vi.fn((input) => (input && typeof input === "object" ? input : null)),
}));

vi.mock("../../../../../js/agents/runtime/hooks/event-bus-hooks.js", async (importActual) => {
  const actual = await importActual();
  return { ...actual };
});

vi.mock("../../../../../js/agents/runtime/hooks/hook-registry.js", async (importActual) => {
  const actual = await importActual();
  return { ...actual };
});

vi.mock("../../../../../js/agents/shared/index.js", async (importActual) => {
  const actual = await importActual();
  return { ...actual };
});

import {
  createPreToolUseHook,
  createPreAgentHook,
  createPostAgentHook,
  default as hookRunnerDefault,
} from "../../../../../js/agents/runtime/hooks/hook-runner.js";
import { HookType } from "../../../../../js/agents/runtime/hooks/hook-registry.js";
import { enhanceEventBusWithHooks } from "../../../../../js/agents/runtime/hooks/event-bus-hooks.js";
import { classifyCommand } from "../../../../../js/agents/runtime/safety/command-classifier.js";
import { evaluateToolRestrictions, normalizeToolRestrictions } from "../../../../../js/agents/runtime/safety/tool-restrictions.js";

const classifyCommandMock = vi.mocked(classifyCommand);
const evaluateToolRestrictionsMock = vi.mocked(evaluateToolRestrictions);
const normalizeToolRestrictionsMock = vi.mocked(normalizeToolRestrictions);

function createEventBus() {
  const events = [];
  const bus = {
    emit: vi.fn((event, payload) => {
      events.push({ event, payload });
    }),
    events,
  };
  return enhanceEventBusWithHooks(bus);
}

function createContext(eventBus, extras = {}) {
  return { eventBus, ...extras };
}

function findEvent(events, name) {
  return events.find((entry) => entry.event === name) || null;
}

beforeEach(() => {
  vi.clearAllMocks();
  classifyCommandMock.mockReturnValue({ requiresApproval: false, level: "safe" });
  evaluateToolRestrictionsMock.mockReturnValue({ allowed: true });
  normalizeToolRestrictionsMock.mockImplementation((input) => (input && typeof input === "object" ? input : null));
});

describe("createPreToolUseHook", () => {
  it("returns null when no eventBus and no restrictions", async () => {
    const hook = createPreToolUseHook();
    const result = await hook({ tool: "read", params: {}, context: {} });

    expect(result).toBe(null);
    expect(evaluateToolRestrictionsMock).not.toHaveBeenCalled();
  });

  it("denies on restriction and sanitizes args for edge/resource boundaries", async () => {
    const eventBus = createEventBus();
    const hook = createPreToolUseHook();

    evaluateToolRestrictionsMock.mockReturnValue({
      allowed: false,
      reason: "tool_blocked",
      policy: { type: "blocklist" },
    });

    const longString = `${"a".repeat(600)} token=secret`;
    const deep = {
      level1: { level2: { level3: { level4: { level5: { level6: { level7: "x" } } } } } },
    };

    const params = {
      emptyString: "",
      whitespace: "   ",
      emptyArray: [],
      emptyObject: {},
      nullVal: null,
      undefinedVal: undefined,
      zero: 0,
      neg: -1,
      max: Number.MAX_SAFE_INTEGER,
      numAsString: "42",
      listObject: { 0: "a", length: "2" },
      password: "secret",
      token: "abc",
      header: "authorization: bearer supersecret",
      query: "api_key=12345",
      longString,
      deep,
      buffer: new ArrayBuffer(1024 * 1024),
      typed: new Uint8Array(4),
      __proto__: { polluted: true },
    };

    const result = await hook({
      tool: "write",
      params,
      context: createContext(eventBus, { toolRestrictions: {} }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false, error: "tool_blocked" } });

    const denied = findEvent(eventBus.events, "tool:denied");
    expect(denied).not.toBeNull();

    const args = denied.payload.args;
    expect(args.password).toBe("[REDACTED]");
    expect(args.token).toBe("[REDACTED]");
    expect(args.header).toContain("[REDACTED]");
    expect(args.query).toContain("[REDACTED]");
    expect(args.longString.endsWith("...")).toBe(true);
    expect(args.longString.length).toBeLessThanOrEqual(500);
    expect(args.emptyArray).toEqual([]);
    expect(Object.keys(args.emptyObject)).toHaveLength(0);
    expect(args.nullVal).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(args, "undefinedVal")).toBe(true);
    expect(args.undefinedVal).toBeUndefined();
    expect(args.zero).toBe(0);
    expect(args.neg).toBe(-1);
    expect(args.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(args.numAsString).toBe("42");
    expect(args.listObject[0]).toBe("a");
    expect(args.listObject.length).toBe("2");
    expect(args.deep.level1.level2.level3.level4.level5).toBe("[MaxDepth]");
    expect(args.buffer).toBe("[ArrayBuffer 1048576 bytes]");
    expect(args.typed).toBe("[Uint8Array 4 bytes]");
    expect(Object.prototype.hasOwnProperty.call(args, "__proto__")).toBe(false);
  });

  it("merges readonly restrictions when permissionLevel is readonly", async () => {
    const eventBus = createEventBus();
    const hook = createPreToolUseHook();

    let captured = null;
    evaluateToolRestrictionsMock.mockImplementation((input) => {
      captured = input.restrictions;
      return { allowed: true };
    });

    await hook({
      tool: "bash",
      params: { command: "ls" },
      context: createContext(eventBus, {
        permissionLevel: "read-only",
        toolRestrictions: { blockedTools: ["net"], bash: { blockedCommands: ["rm"], toolNames: ["bash"] } },
      }),
    });

    expect(captured).not.toBeNull();
    expect(captured.blockedTools).toEqual(expect.arrayContaining(["net", "write"]));
    expect(captured.bash.allowedCommands).toEqual(expect.arrayContaining(["ls"]));
    expect(captured.bash.blockedCommands).toEqual(expect.arrayContaining(["rm"]));
    expect(captured.bash.toolNames).toEqual(expect.arrayContaining(["bash"]));
  });

  it("denies when command hook requires approval", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

    classifyCommandMock.mockReturnValue({
      requiresApproval: true,
      baseCommand: "rm",
      level: "dangerous",
    });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "bash",
      params: { command: "rm -rf /" },
      context: createContext(eventBus),
    });

    expect(classifyCommandMock).toHaveBeenCalledWith("rm -rf /");
    expect(result).toMatchObject({ skip: true, value: { ok: false } });

    const denied = findEvent(eventBus.events, "tool:denied");
    expect(denied?.payload?.policy?.hookType).toBe("command");
  });

  it("allows command hook when blocking is false", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.COMMAND, blocking: false });

    classifyCommandMock.mockReturnValue({
      requiresApproval: true,
      baseCommand: "rm",
      level: "dangerous",
    });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "bash",
      params: { command: "rm -rf /" },
      context: createContext(eventBus),
    });

    expect(result).toBe(null);
    expect(findEvent(eventBus.events, "tool:denied")).toBeNull();
  });

  it("handles type boundary when argv is an object", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "bash",
      params: { argv: { 0: "ls" } },
      context: createContext(eventBus),
    });

    expect(classifyCommandMock).toHaveBeenCalledWith(null);
    expect(result).toBe(null);
  });

  it("denies when prompt hook has no model router", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

    const hook = createPreToolUseHook();
    const result = await hook({ tool: "read", params: {}, context: createContext(eventBus) });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.hookType).toBe("prompt");
  });

  it("blocks when prompt hook returns deny decision", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

    const modelRouter = {
      call: vi.fn().mockResolvedValue({ content: "{\"allow\": false, \"reason\": \"nope\"}" }),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { modelRouter }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false, error: "nope" } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.reason).toBe("nope");
  });

  it("allows when prompt hook decision is allow", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

    const modelRouter = {
      call: vi.fn().mockResolvedValue({ content: "allow" }),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { modelRouter }),
    });

    expect(result).toBe(null);
    expect(findEvent(eventBus.events, "tool:denied")).toBeNull();
  });

  it("blocks when prompt hook response is unparseable", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

    const modelRouter = {
      call: vi.fn().mockResolvedValue({ content: "maybe" }),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { modelRouter }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.error).toBe("unparseable");
  });

  it("blocks when prompt hook model call throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check" });

    const modelRouter = {
      call: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { modelRouter }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.error).toBe("model_call_failed");
  });

  it("blocks when agent hook registry is missing", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.error).toBe("registry_unavailable");
  });

  it("blocks when agent type is unknown", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

    const subagentRegistry = {
      getFactory: vi.fn().mockReturnValue(null),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { subagentRegistry }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.error).toBe("unknown_agent");
  });

  it("blocks when agent hook denies", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

    const factory = vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({ allow: false, reason: "no" }),
    });

    const subagentRegistry = {
      getFactory: vi.fn().mockReturnValue(factory),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { subagentRegistry }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false, error: "no" } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.policy?.agentType).toBe("guard");
  });

  it("allows when agent hook permits", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

    const factory = vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({ allow: true }),
    });

    const subagentRegistry = {
      getFactory: vi.fn().mockReturnValue(factory),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { subagentRegistry }),
    });

    expect(result).toBe(null);
    expect(findEvent(eventBus.events, "tool:denied")).toBeNull();
  });

  it("blocks when agent hook throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.AGENT, agentType: "guard" });

    const factory = vi.fn().mockRejectedValue(new Error("factory down"));
    const subagentRegistry = {
      getFactory: vi.fn().mockReturnValue(factory),
    };

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "read",
      params: {},
      context: createContext(eventBus, { subagentRegistry }),
    });

    expect(result).toMatchObject({ skip: true, value: { ok: false } });
    expect(findEvent(eventBus.events, "tool:denied")?.payload?.reason).toContain("factory down");
  });

  it("handles concurrent calls independently", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

    classifyCommandMock.mockImplementation((cmd) => {
      const text = Array.isArray(cmd) ? cmd.join(" ") : String(cmd || "");
      if (text.includes("rm")) {
        return { requiresApproval: true, baseCommand: "rm", level: "dangerous" };
      }
      return { requiresApproval: false, level: "safe" };
    });

    const hook = createPreToolUseHook();
    const [denyResult, allowResult] = await Promise.all([
      hook({ tool: "bash", params: { command: "rm -rf /" }, context: createContext(eventBus) }),
      hook({ tool: "bash", params: { command: "ls" }, context: createContext(eventBus) }),
    ]);

    expect(denyResult).toMatchObject({ skip: true, value: { ok: false } });
    expect(allowResult).toBe(null);
    expect(eventBus.events.filter((e) => e.event === "tool:denied")).toHaveLength(1);
  });

  it("handles rapid sequential calls with different outcomes", async () => {
    const eventBus = createEventBus();
    const hook = createPreToolUseHook();

    evaluateToolRestrictionsMock
      .mockReturnValueOnce({ allowed: false, reason: "tool_blocked" })
      .mockReturnValueOnce({ allowed: true });

    const first = await hook({
      tool: "write",
      params: { path: "/tmp/a" },
      context: createContext(eventBus, { toolRestrictions: {} }),
    });

    const second = await hook({
      tool: "write",
      params: { path: "/tmp/b" },
      context: createContext(eventBus, { toolRestrictions: {} }),
    });

    expect(first).toMatchObject({ skip: true, value: { ok: false, error: "tool_blocked" } });
    expect(second).toBe(null);
  });
});

describe("createPreAgentHook", () => {
  it("returns null when no eventBus", async () => {
    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: {}, context: {} });

    expect(result).toBe(null);
  });

  it("blocks when handler returns skip", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: vi.fn().mockResolvedValue({ skip: true, reason: "blocked", value: { ok: false } }),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: 0, runId: -1, input: "", context: createContext(eventBus) });

    expect(result).toMatchObject({ skip: true, reason: "blocked", value: { ok: false } });
    expect(findEvent(eventBus.events, "agent:denied")?.payload?.reason).toBe("blocked");
  });

  it("ignores skip when blocking is false", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: false,
      handler: vi.fn().mockResolvedValue({ skip: true, reason: "blocked" }),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: {}, context: createContext(eventBus) });

    expect(result).toBe(null);
    expect(findEvent(eventBus.events, "agent:denied")).toBeNull();
  });

  it("emits hook-error when handler throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: {}, context: createContext(eventBus) });

    expect(result).toBe(null);
    expect(findEvent(eventBus.events, "agent:hook-error")?.payload?.error).toBe("boom");
  });
});

describe("createPostAgentHook", () => {
  it("returns without error when no eventBus", async () => {
    const hook = createPostAgentHook();
    await expect(hook({ sessionId: "s", runId: "r", input: {}, result: {}, context: {} })).resolves.toBeUndefined();
  });

  it("calls handler and passes through payload", async () => {
    const eventBus = createEventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    eventBus.registerHook("PostAgent", { type: HookType.COMMAND, handler });

    const hook = createPostAgentHook();
    await hook({
      sessionId: "s",
      runId: "r",
      input: { q: "x" },
      result: { ok: true },
      error: null,
      duration: 12,
      context: createContext(eventBus),
    });

    expect(handler).toHaveBeenCalledWith({
      sessionId: "s",
      runId: "r",
      input: { q: "x" },
      result: { ok: true },
      error: null,
      duration: 12,
      context: createContext(eventBus),
    });
  });

  it("emits hook-error when handler throws", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: vi.fn().mockRejectedValue(new Error("post boom")),
    });

    const hook = createPostAgentHook();
    await hook({
      sessionId: "s",
      runId: "r",
      input: {},
      result: {},
      error: null,
      duration: 0,
      context: createContext(eventBus),
    });

    expect(findEvent(eventBus.events, "agent:hook-error")?.payload?.error).toBe("post boom");
  });
});

describe("default export", () => {
  it("exposes hook creators", () => {
    expect(hookRunnerDefault).toMatchObject({
      createPreToolUseHook,
      createPreAgentHook,
      createPostAgentHook,
    });
  });
});
