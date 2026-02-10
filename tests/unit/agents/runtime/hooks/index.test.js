import { describe, it, expect, vi, beforeEach } from "vitest";

const actuals = vi.hoisted(() => ({
  classifyCommand: null,
  evaluateToolRestrictions: null,
  normalizeToolRestrictions: null,
}));

vi.mock("../../../../../js/agents/runtime/safety/command-classifier.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/runtime/safety/command-classifier.js");
  actuals.classifyCommand = actual.classifyCommand;
  return { ...actual, classifyCommand: vi.fn(actual.classifyCommand) };
});

vi.mock("../../../../../js/agents/runtime/safety/tool-restrictions.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/runtime/safety/tool-restrictions.js");
  actuals.evaluateToolRestrictions = actual.evaluateToolRestrictions;
  actuals.normalizeToolRestrictions = actual.normalizeToolRestrictions;
  return {
    ...actual,
    evaluateToolRestrictions: vi.fn(actual.evaluateToolRestrictions),
    normalizeToolRestrictions: vi.fn(actual.normalizeToolRestrictions),
  };
});

import {
  HookRegistry,
  HookType,
  HookEvent,
  enhanceEventBusWithHooks,
  getHookRegistry,
  createPreToolUseHook,
  createPreAgentHook,
  createPostAgentHook,
  HooksConfigLoader,
  createHooksConfigLoader,
} from "../../../../../js/agents/runtime/hooks/index.js";
import { classifyCommand } from "../../../../../js/agents/runtime/safety/command-classifier.js";
import { evaluateToolRestrictions, normalizeToolRestrictions } from "../../../../../js/agents/runtime/safety/tool-restrictions.js";

const mockedClassifyCommand = vi.mocked(classifyCommand);
const mockedEvaluateToolRestrictions = vi.mocked(evaluateToolRestrictions);
const mockedNormalizeToolRestrictions = vi.mocked(normalizeToolRestrictions);

beforeEach(() => {
  mockedClassifyCommand.mockReset();
  mockedEvaluateToolRestrictions.mockReset();
  mockedNormalizeToolRestrictions.mockReset();

  if (actuals.classifyCommand) mockedClassifyCommand.mockImplementation(actuals.classifyCommand);
  if (actuals.evaluateToolRestrictions) mockedEvaluateToolRestrictions.mockImplementation(actuals.evaluateToolRestrictions);
  if (actuals.normalizeToolRestrictions) mockedNormalizeToolRestrictions.mockImplementation(actuals.normalizeToolRestrictions);
});

function createEventBus() {
  const events = [];
  const bus = {
    events,
    emit: vi.fn((event, payload) => {
      events.push({ event, payload });
    }),
  };
  return enhanceEventBusWithHooks(bus);
}

function createDeepObject(depth) {
  const root = {};
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.child = {};
    current = current.child;
  }
  return root;
}

function createDeepConfig(depth) {
  const root = { hooks: [] };
  let current = root;
  for (let i = 0; i < depth; i += 1) {
    current.nested = {};
    current = current.nested;
  }
  return root;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class MockVfs {
  constructor() {
    this.files = new Map();
    this.stats = new Map();
  }

  set(path, content, mtimeMs = Date.now()) {
    this.files.set(path, content);
    this.stats.set(path, { mtimeMs });
  }

  async readText(path) {
    if (!this.files.has(path)) {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    }
    return this.files.get(path);
  }

  async readFile(path) {
    const text = await this.readText(path);
    return new TextEncoder().encode(text);
  }

  async stat(path) {
    if (!this.stats.has(path)) {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    }
    return this.stats.get(path);
  }
}

describe("HookRegistry", () => {
  it("registers hooks and matches tool patterns", () => {
    const registry = new HookRegistry();
    const def = registry.register("PreToolUse", {
      type: "COMMAND",
      toolPatterns: ["foo*", "bar", "foo*", ""],
    });

    expect(def.type).toBe("command");
    expect(def.blocking).toBe(true);
    expect(def.tools).toEqual(["foo*", "bar"]);

    const listA = registry.list("PreToolUse");
    const listB = registry.list("PreToolUse");
    expect(listA).toHaveLength(1);
    expect(listA).not.toBe(listB);

    expect(registry.match("PreToolUse", "foobar")).toHaveLength(1);
    expect(registry.match("PreToolUse", "baz")).toHaveLength(0);
  });

  it("throws for invalid event names or definitions", () => {
    const registry = new HookRegistry();

    expect(() => registry.register("", { type: "command" })).toThrow(TypeError);
    expect(() => registry.register("PreToolUse", null)).toThrow(TypeError);
    expect(() => registry.register("PreToolUse", { type: "unknown" })).toThrow(TypeError);
    expect(() => registry.register("PreToolUse", { type: "prompt" })).toThrow(TypeError);
    expect(() => registry.register("PreToolUse", { type: "agent" })).toThrow(TypeError);
  });

  it("handles boundary event names and clear semantics", () => {
    const registry = new HookRegistry();
    registry.register(0, { type: "command" });
    registry.register(-1, { type: "command" });
    registry.register(Number.MAX_SAFE_INTEGER, { type: "command" });

    expect(registry.list("0")).toHaveLength(1);
    expect(registry.list("-1")).toHaveLength(1);
    expect(registry.list(String(Number.MAX_SAFE_INTEGER))).toHaveLength(1);

    expect(registry.list(null)).toEqual([]);
    expect(registry.list(undefined)).toEqual([]);
    expect(registry.list("")).toEqual([]);

    registry.clear("   ");
    expect(registry.list("0")).toEqual([]);
  });
});

describe("HookType", () => {
  it("exposes frozen hook type constants", () => {
    expect(HookType).toEqual({
      COMMAND: "command",
      PROMPT: "prompt",
      AGENT: "agent",
    });
    expect(Object.isFrozen(HookType)).toBe(true);
  });

  it("rejects mutation and keeps values non-empty", () => {
    expect(() => {
      HookType.EXTRA = "new";
    }).toThrow(TypeError);

    const values = Object.values(HookType);
    expect(values.every((value) => typeof value === "string" && value.trim().length > 0)).toBe(true);
  });
});

describe("HookEvent", () => {
  it("exposes frozen hook event constants", () => {
    expect(HookEvent).toMatchObject({
      PRE_AGENT: "PreAgent",
      POST_AGENT: "PostAgent",
      PRE_TOOL_USE: "PreToolUse",
      POST_TOOL_USE: "PostToolUse",
    });
    expect(Object.isFrozen(HookEvent)).toBe(true);
  });

  it("rejects mutation and keeps values non-empty", () => {
    expect(() => {
      HookEvent.EXTRA = "Event";
    }).toThrow(TypeError);

    const values = Object.values(HookEvent);
    expect(values.every((value) => typeof value === "string" && value.trim().length > 0)).toBe(true);
  });
});

describe("enhanceEventBusWithHooks", () => {
  it("returns non-object inputs unchanged", () => {
    const inputs = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, true, false];
    inputs.forEach((value) => {
      expect(enhanceEventBusWithHooks(value)).toBe(value);
    });
  });

  it("enhances empty arrays and objects with hook methods", () => {
    const objectBus = {};
    const arrayBus = [];

    enhanceEventBusWithHooks(objectBus);
    enhanceEventBusWithHooks(arrayBus);

    expect(typeof objectBus.registerHook).toBe("function");
    expect(typeof objectBus.getHooks).toBe("function");
    expect(typeof objectBus.clearHooks).toBe("function");
    expect(getHookRegistry(objectBus)).toBeInstanceOf(HookRegistry);

    expect(typeof arrayBus.registerHook).toBe("function");
    expect(getHookRegistry(arrayBus)).toBeInstanceOf(HookRegistry);
  });

  it("preserves existing hook methods and is idempotent", () => {
    const registerHook = vi.fn();
    const getHooks = vi.fn();
    const clearHooks = vi.fn();
    const bus = { registerHook, getHooks, clearHooks };

    const first = enhanceEventBusWithHooks(bus);
    const registry = getHookRegistry(bus);
    const second = enhanceEventBusWithHooks(bus);

    expect(first).toBe(bus);
    expect(second).toBe(bus);
    expect(bus.registerHook).toBe(registerHook);
    expect(getHookRegistry(bus)).toBe(registry);
  });
});

describe("getHookRegistry", () => {
  it("returns registry for enhanced buses", () => {
    const bus = enhanceEventBusWithHooks({ emit: vi.fn() });
    const registry = getHookRegistry(bus);
    expect(registry).toBeInstanceOf(HookRegistry);
  });

  it("returns null for invalid values or wrong registry types", () => {
    const registrySymbol = Symbol.for("paperburner.hookRegistry.v1");
    const bus = { [registrySymbol]: {} };

    const inputs = [null, undefined, "", "   ", 0, [], {}, bus];
    inputs.forEach((value) => {
      expect(getHookRegistry(value)).toBeNull();
    });
  });
});

describe("createPreToolUseHook", () => {
  it("returns null when no eventBus in context", async () => {
    const hook = createPreToolUseHook();
    const result = await hook({ tool: "read", params: {}, context: null });
    expect(result).toBeNull();
  });

  it("blocks on restriction denial and sanitizes args", async () => {
    mockedEvaluateToolRestrictions.mockReturnValueOnce({
      allowed: false,
      reason: "tool_blocked",
      policy: { type: "blocklist" },
    });

    const eventBus = createEventBus();
    const hook = createPreToolUseHook();
    const longText = "x".repeat(800);
    const params = {
      password: "secret",
      note: longText,
      nested: createDeepObject(10),
      list: Array.from({ length: 60 }, (_, i) => i),
    };

    const result = await hook({
      tool: 0,
      params,
      context: { eventBus, permissionLevel: "readonly", toolRestrictions: { blockedTools: ["write"] } },
    });

    expect(result?.skip).toBe(true);
    expect(result?.value?.error).toBe("tool_blocked");

    const denied = eventBus.events.find((entry) => entry.event === "tool:denied");
    expect(denied).not.toBeNull();
    expect(denied.payload.tool).toBe("0");
    expect(denied.payload.args.password).toBe("[REDACTED]");
    expect(typeof denied.payload.args.note).toBe("string");
    expect(denied.payload.args.note).toContain("[REDACTED]");
    expect(JSON.stringify(denied.payload.args.nested)).toContain("MaxDepth");
    expect(denied.payload.args.list.length).toBeLessThanOrEqual(51);

    expect(mockedEvaluateToolRestrictions).toHaveBeenCalled();
    expect(mockedEvaluateToolRestrictions.mock.calls[0][0].toolName).toBe("0");
  });

  it("blocks command hooks when classifyCommand requires approval", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.COMMAND });

    mockedClassifyCommand.mockReturnValueOnce({
      requiresApproval: true,
      baseCommand: "rm",
      level: "dangerous",
    });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "bash",
      params: { command: "rm -rf /" },
      context: { eventBus },
    });

    expect(result?.skip).toBe(true);
    expect(result?.value?.error).toContain("Command requires approval");

    const denied = eventBus.events.find((entry) => entry.event === "tool:denied");
    expect(denied?.payload?.policy?.hookType).toBe("command");
    expect(mockedClassifyCommand).toHaveBeenCalledWith("rm -rf /");
  });

  it("blocks prompt hooks when modelRouter is unavailable", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreToolUse", { type: HookType.PROMPT, prompt: "Check", blocking: true });

    const hook = createPreToolUseHook();
    const result = await hook({
      tool: "   ",
      params: {},
      context: { eventBus },
    });

    expect(result?.skip).toBe(true);
    expect(result?.value?.error).toContain("ModelRouter unavailable");

    const denied = eventBus.events.find((entry) => entry.event === "tool:denied");
    expect(denied?.payload?.policy?.hookType).toBe("prompt");
  });

  it("handles concurrent and rapid successive calls independently", async () => {
    const eventBus = createEventBus();
    const hook = createPreToolUseHook();
    const context = { eventBus, toolRestrictions: { allowedTools: ["read"] } };

    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => hook({ tool: "read", params: { command: "ls" }, context }))
    );

    expect(concurrent.every((result) => result === null)).toBe(true);

    const quick1 = hook({ tool: "read", params: {}, context });
    const quick2 = hook({ tool: "read", params: {}, context });
    const [result1, result2] = await Promise.all([quick1, quick2]);

    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});

describe("createPreAgentHook", () => {
  it("returns null when no eventBus or hooks", async () => {
    const hook = createPreAgentHook();

    const withoutBus = await hook({ sessionId: "s", runId: "r", input: {}, context: null });
    expect(withoutBus).toBeNull();

    const eventBus = createEventBus();
    const withoutHooks = await hook({ sessionId: "s", runId: "r", input: {}, context: { eventBus } });
    expect(withoutHooks).toBeNull();
  });

  it("allows handlers to deny with fallback reason", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      blocking: true,
      handler: () => ({ skip: true, reason: "   ", value: 0 }),
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "", runId: 0, input: {}, context: { eventBus } });

    expect(result?.skip).toBe(true);
    expect(result?.reason).toBe("PreAgent hook denied");

    const denied = eventBus.events.find((entry) => entry.event === "agent:denied");
    expect(denied).not.toBeNull();
  });

  it("captures handler errors without throwing", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PreAgent", {
      type: HookType.COMMAND,
      handler: () => {
        throw new Error("boom");
      },
    });

    const hook = createPreAgentHook();
    const result = await hook({ sessionId: "s", runId: "r", input: "", context: { eventBus } });

    expect(result).toBeNull();
    const errorEvent = eventBus.events.find((entry) => entry.event === "agent:hook:error");
    expect(errorEvent).not.toBeNull();
  });

  it("handles concurrent calls independently", async () => {
    const eventBus = createEventBus();
    const handler = vi.fn(() => ({ skip: false }));
    eventBus.registerHook("PreAgent", { type: HookType.COMMAND, handler });

    const hook = createPreAgentHook();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => hook({ sessionId: `s${i}`, runId: i, input: "x", context: { eventBus } }))
    );

    expect(results.every((result) => result === null)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(5);
  });
});

describe("createPostAgentHook", () => {
  it("invokes handlers with boundary values", async () => {
    const eventBus = createEventBus();
    const handler = vi.fn();
    eventBus.registerHook("PostAgent", { type: HookType.COMMAND, handler });

    const hook = createPostAgentHook();
    const result = await hook({
      sessionId: "s",
      runId: -1,
      input: "",
      result: {},
      error: null,
      duration: Number.MAX_SAFE_INTEGER,
      context: { eventBus },
    });

    expect(result).toBeUndefined();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: -1,
        duration: Number.MAX_SAFE_INTEGER,
        input: "",
      })
    );
  });

  it("captures handler errors without throwing", async () => {
    const eventBus = createEventBus();
    eventBus.registerHook("PostAgent", {
      type: HookType.COMMAND,
      handler: () => {
        throw new Error("fail");
      },
    });

    const hook = createPostAgentHook();
    await hook({ sessionId: "s", runId: "r", input: {}, result: null, error: null, duration: 0, context: { eventBus } });

    const errorEvent = eventBus.events.find((entry) => entry.event === "agent:hook:error");
    expect(errorEvent).not.toBeNull();
  });

  it("returns without error when registry is missing", async () => {
    const hook = createPostAgentHook();
    await expect(hook({ context: null })).resolves.toBeUndefined();
  });
});

describe("HooksConfigLoader", () => {
  it("validates constructor options and clamps pollIntervalMs", () => {
    const registry = new HookRegistry();
    const vfs = new MockVfs();

    expect(() => new HooksConfigLoader({ registry })).toThrow(/vfs/i);
    expect(() => new HooksConfigLoader({ vfs })).toThrow(/registry/i);

    const loader = new HooksConfigLoader({ vfs, registry, pollIntervalMs: -1 });
    expect(loader._pollIntervalMs).toBe(250);

    const loader2 = new HooksConfigLoader({ vfs, registry, pollIntervalMs: "123" });
    expect(loader2._pollIntervalMs).toBe(2000);
  });

  it("returns null for missing, empty, or invalid configs", async () => {
    const vfs = new MockVfs();
    const loader = new HooksConfigLoader({ vfs, registry: new HookRegistry() });

    expect(await loader.loadConfig()).toBeNull();

    vfs.set(".agents/hooks.json", "   ");
    expect(await loader.loadConfig()).toBeNull();

    vfs.set(".agents/hooks.json", "{ not: json }");
    expect(await loader.loadConfig()).toBeNull();
  });

  it("applies valid hooks and skips invalid entries", async () => {
    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs: new MockVfs(), registry });

    await loader.applyConfig({
      hooks: [
        { event: "PreToolUse", type: "command", tools: ["read"] },
        { event: "", type: "command" },
      ],
    });

    expect(registry.list("PreToolUse")).toHaveLength(1);

    await loader.applyConfig({ hooks: {} });
    expect(registry.list("PreToolUse")).toHaveLength(0);
  });

  it("rejects oversized or overly deep configs", async () => {
    const registry = new HookRegistry();
    const vfs = new MockVfs();
    const loader = new HooksConfigLoader({ vfs, registry });

    const large = "x".repeat(256 * 1024 + 5);
    vfs.set(".agents/hooks.json", large);
    expect(await loader.loadConfig()).toBeNull();

    const deep = JSON.stringify(createDeepConfig(8));
    vfs.set(".agents/hooks.json", deep);
    expect(await loader.loadConfig()).toBeNull();
  });

  it("coalesces concurrent reload calls", async () => {
    const deferred = createDeferred();
    const vfs = {
      readText: vi.fn(() => deferred.promise),
      stat: vi.fn(() => ({ mtimeMs: 1 })),
    };
    const registry = new HookRegistry();
    const loader = new HooksConfigLoader({ vfs, registry, configPath: "hooks.json" });

    const first = loader.reload();
    const second = loader.reload();

    await Promise.resolve();

    expect(vfs.readText).toHaveBeenCalledTimes(1);
    deferred.resolve("{\"hooks\": []}");

    await Promise.all([first, second]);
    expect(registry.list("PreToolUse")).toHaveLength(0);
  });
});

describe("createHooksConfigLoader", () => {
  it("creates loaders and surfaces constructor errors", () => {
    const registry = new HookRegistry();
    const vfs = new MockVfs();

    const loader = createHooksConfigLoader({ vfs, registry });
    expect(loader).toBeInstanceOf(HooksConfigLoader);

    expect(() => createHooksConfigLoader({ registry })).toThrow(/vfs/i);
  });
});
