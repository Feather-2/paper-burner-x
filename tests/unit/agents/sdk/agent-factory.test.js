import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedDefaultAgentLoop = vi.hoisted(() => {
  const instances = [];
  let runImpl = null;
  let runError = null;

  class DefaultAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.run = vi.fn(async (input, context) => {
        if (runError) {
          const err = runError;
          runError = null;
          throw err;
        }
        if (runImpl) {
          return await runImpl(input, context);
        }
        return { ok: true, input, context };
      });
      this.dispose = vi.fn(async () => {});
      this._executeAbortController = { abort: vi.fn() };
      this._detachEventBusListeners = vi.fn();
      instances.push(this);
    }
  }

  return {
    instances,
    DefaultAgentLoop,
    setRunImpl: (fn) => {
      runImpl = fn;
    },
    setRunError: (err) => {
      runError = err;
    },
    reset: () => {
      instances.length = 0;
      runImpl = null;
      runError = null;
    },
  };
});

vi.mock("../../../../js/agents/sdk/DefaultAgentLoop.js", () => ({
  DefaultAgentLoop: mockedDefaultAgentLoop.DefaultAgentLoop,
}));

let AgentInstance;

const createEventBus = (overrides = {}) => ({
  emit: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  ...overrides,
});

const createInstance = (overrides = {}) => {
  const eventBus = overrides.eventBus || createEventBus();
  const instance = new AgentInstance({
    core: {
      eventBus,
      logger: overrides.logger ?? { warn: vi.fn(), info: vi.fn() },
      actor: overrides.actor ?? "Agent",
    },
    capabilities: {
      capabilities: overrides.capabilities ?? new Map(),
      toolExecutor: overrides.toolExecutor ?? null,
      mcpConfig: overrides.mcpConfig ?? null,
      subagentRegistry: overrides.subagentRegistry ?? null,
    },
    managers: {
      compressor: overrides.compressor ?? null,
      backtrackManager: overrides.backtrackManager ?? null,
      discoveryManager: overrides.discoveryManager ?? null,
    },
    options: overrides.options ?? {},
  });

  return { instance, eventBus };
};

beforeEach(async () => {
  mockedDefaultAgentLoop.reset();
  vi.clearAllMocks();
  if (!AgentInstance) {
    ({ AgentInstance } = await import("../../../../js/agents/sdk/agent-factory.js"));
  }
});

describe("AgentInstance", () => {
  it("normalizes flat and grouped configs", () => {
    const eventBus = createEventBus();
    const capabilities = new Map();
    const compressor = { id: "mem" };
    const backtrackManager = { id: "bt" };
    const discoveryManager = { id: "disc" };

    const flat = new AgentInstance({
      eventBus,
      logger: { tag: "log" },
      actor: "FlatActor",
      capabilities,
      toolExecutor: null,
      mcpConfig: { id: 1 },
      subagentRegistry: { id: 2 },
      compressor,
      backtrackManager,
      discoveryManager,
      options: "flat",
    });

    expect(flat.eventBus).toBe(eventBus);
    expect(flat.logger).toEqual({ tag: "log" });
    expect(flat.actor).toBe("FlatActor");
    expect(flat.capabilities).toBe(capabilities);
    expect(flat.mcpConfig).toEqual({ id: 1 });
    expect(flat.subagentRegistry).toEqual({ id: 2 });
    expect(flat.memory).toBe(compressor);
    expect(flat.backtrack).toBe(backtrackManager);
    expect(flat.discovery).toBe(discoveryManager);
    expect(flat.options).toBe("flat");

    const groupedCapabilities = new Map();
    const grouped = new AgentInstance({
      core: { eventBus: "bus", logger: "log", actor: "" },
      capabilities: { capabilities: groupedCapabilities, toolExecutor: null, mcpConfig: { m: 1 }, subagentRegistry: { s: 1 } },
      managers: { compressor: "mem", backtrackManager: "bt", discoveryManager: "disc" },
      options: { tag: "group" },
    });

    expect(grouped.eventBus).toBe("bus");
    expect(grouped.logger).toBe("log");
    expect(grouped.actor).toBe("");
    expect(grouped.capabilities).toBe(groupedCapabilities);
    expect(grouped.mcpConfig).toEqual({ m: 1 });
    expect(grouped.subagentRegistry).toEqual({ s: 1 });
    expect(grouped.memory).toBe("mem");
    expect(grouped.backtrack).toBe("bt");
    expect(grouped.discovery).toBe("disc");
    expect(grouped.options).toEqual({ tag: "group" });
  });

  it("handles empty and invalid inputs without throwing", () => {
    const inputs = [null, undefined, {}, []];
    for (const input of inputs) {
      expect(() => new AgentInstance(input)).not.toThrow();
    }

    const instance = new AgentInstance(null);
    expect(instance.eventBus).toBeUndefined();
    expect(instance.capabilities).toBeUndefined();
    expect(instance.options).toBeUndefined();
  });

  it("normalizes toolExecutor values and enforces disposal guards", async () => {
    const { instance } = createInstance();
    const badValues = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, [], {}];

    for (const value of badValues) {
      instance.toolExecutor = value;
      expect(instance.toolExecutor).toBeNull();
    }

    const handler = vi.fn(async (name, params, context) => ({ name, params, context }));
    instance.toolExecutor = handler;

    const exec = instance.toolExecutor;
    const out = await exec("ping", { value: 1 }, { state: { ok: true } });
    expect(out).toEqual({ name: "ping", params: { value: 1 }, context: { state: { ok: true } } });
    expect(handler).toHaveBeenCalledWith("ping", { value: 1 }, { state: { ok: true } });

    await instance.dispose();

    await expect(exec("ping", {}, {})).rejects.toThrow(/disposed/i);
    expect(() => instance.toolExecutor).toThrow(/disposed/i);
  });

  it("builds capability definitions and catalog prompt with priorities", () => {
    const longDesc = "x".repeat(10000);
    const critical = {
      definition: { name: "Critical", description: "critical desc", priority: 0, activation: { keywords: ["alpha_kw", "beta_kw"] } },
    };
    const importantNeg = { definition: { name: "ImportantNeg", description: "important neg", priority: -1 } };
    const importantMax = { definition: { name: "ImportantMax", description: longDesc, priority: Number.MAX_SAFE_INTEGER } };
    const optional = { definition: { name: "Optional", description: "optional desc", priority: 2 } };

    const capabilities = new Map([
      ["Critical", critical],
      ["ImportantNeg", importantNeg],
      ["ImportantMax", importantMax],
      ["Optional", optional],
    ]);

    const subagentRegistry = { getSubagentCatalogPrompt: vi.fn(() => "SUBAGENT:demo") };

    const instance = new AgentInstance({
      core: { eventBus: createEventBus(), logger: null, actor: "Catalog" },
      capabilities: { capabilities, toolExecutor: null, mcpConfig: null, subagentRegistry },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {},
    });

    const defs = instance.getCapabilityDefinitions();
    expect(defs).toHaveLength(4);
    expect(defs).toEqual(
      expect.arrayContaining([critical.definition, importantNeg.definition, importantMax.definition, optional.definition])
    );
    expect(instance.skills).toBe(capabilities);
    expect(instance.getSkillDefinitions()).toEqual(defs);

    const prompt = instance.getCapabilityCatalogPrompt();
    expect(prompt).toContain("**Critical**: critical desc");
    expect(prompt).toContain("**ImportantNeg**: important neg");
    expect(prompt).toContain(`**ImportantMax**: ${longDesc}`);
    expect(prompt).toContain("**Optional**: optional desc");
    expect(prompt).toContain("alpha_kw, beta_kw");
    expect(prompt).toContain("SUBAGENT:demo");

    const criticalIndex = prompt.indexOf("**Critical**");
    const importantIndex = prompt.indexOf("**ImportantNeg**");
    const optionalIndex = prompt.indexOf("**Optional**");
    expect(criticalIndex).toBeGreaterThanOrEqual(0);
    expect(importantIndex).toBeGreaterThan(criticalIndex);
    expect(optionalIndex).toBeGreaterThan(importantIndex);

    expect(instance.getSkillCatalogPrompt()).toEqual(prompt);
  });

  it("run builds loop with normalized options and emits started with runId fallback", async () => {
    const eventBus = createEventBus();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123);
    const toolRestrictions = { 0: "alpha", length: 1, allow: ["a"] };
    const instance = new AgentInstance({
      core: { eventBus, logger: { warn: vi.fn() }, actor: "Runner" },
      capabilities: { capabilities: new Map(), toolExecutor: vi.fn(), mcpConfig: null, subagentRegistry: null },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {
        permissionLevel: "42",
        toolRestrictions,
        defaultLoop: [],
      },
    });

    const output = await instance.run({ query: "q" }, { runId: "", state: { ok: true }, signal: null });
    expect(output.ok).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith("runner:agent.started", { runId: "123" });

    const loop = mockedDefaultAgentLoop.instances[0];
    expect(loop.options.permissionLevel).toBe("42");
    expect(loop.options.toolRestrictions).toBe(toolRestrictions);
    expect(loop.options.eventBus).toBe(eventBus);

    nowSpy.mockRestore();
  });

  it("run uses defaultLoop permissionLevel and emits failure events on errors", async () => {
    mockedDefaultAgentLoop.setRunError(new Error("boom"));

    const eventBus = createEventBus();
    const instance = new AgentInstance({
      core: { eventBus, logger: { warn: vi.fn() }, actor: "Runner2" },
      capabilities: { capabilities: new Map(), toolExecutor: null, mcpConfig: null, subagentRegistry: null },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {
        permissionLevel: "   ",
        toolRestrictions: { fallback: true },
        defaultLoop: { permissionLevel: 0, toolRestrictions: null, maxIterations: "5" },
      },
    });

    const runId = Number.MAX_SAFE_INTEGER;
    await expect(instance.run({ query: "x" }, { runId, state: {}, signal: null })).rejects.toThrow("boom");

    expect(eventBus.emit).toHaveBeenCalledWith("runner2:agent.started", { runId });
    expect(eventBus.emit).toHaveBeenCalledWith("runner2:agent.failed", { error: "boom" });

    const loop = mockedDefaultAgentLoop.instances[0];
    expect(loop.options.permissionLevel).toBe("0");
    expect(loop.options.toolRestrictions).toEqual({ fallback: true });
    expect(loop.options.maxIterations).toBe("5");
  });

  it("reuses the loop for concurrent and rapid consecutive runs with large inputs", async () => {
    const eventBus = createEventBus();
    const deepState = { level1: { level2: { level3: { level4: { level5: { value: "deep" } } } } } };
    const largeText = "L".repeat(200000);

    mockedDefaultAgentLoop.setRunImpl(async (input, context) => ({
      ok: true,
      id: input.id,
      fileSize: input.file.length,
      state: context.state,
    }));

    const instance = new AgentInstance({
      core: { eventBus, logger: null, actor: "Concurrent" },
      capabilities: { capabilities: new Map(), toolExecutor: null, mcpConfig: null, subagentRegistry: null },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {},
    });

    const [out1, out2] = await Promise.all([
      instance.run({ id: 1, file: largeText }, { runId: "a", state: deepState, signal: null }),
      instance.run({ id: 2, file: `${largeText}b` }, { runId: "b", state: deepState, signal: null }),
    ]);

    expect(out1).toEqual(expect.objectContaining({ id: 1, state: deepState }));
    expect(out2).toEqual(expect.objectContaining({ id: 2, state: deepState }));
    expect(mockedDefaultAgentLoop.instances).toHaveLength(1);

    await instance.run({ id: 3, file: largeText }, { runId: "c", state: deepState, signal: null });
    expect(mockedDefaultAgentLoop.instances).toHaveLength(1);
    expect(mockedDefaultAgentLoop.instances[0].run).toHaveBeenCalledTimes(3);
  });

  it("on returns a safe unsubscribe and tolerates non-function returns", async () => {
    const unsubscribe = vi.fn();
    const eventBus = createEventBus({ subscribe: vi.fn(() => unsubscribe) });
    const instance = new AgentInstance({
      core: { eventBus, logger: null, actor: "Listener" },
      capabilities: { capabilities: new Map(), toolExecutor: null, mcpConfig: null, subagentRegistry: null },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {},
    });

    const safe = instance.on("topic.*", vi.fn());
    expect(typeof safe).toBe("function");
    safe();
    safe();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    await instance.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    const eventBus2 = createEventBus({ subscribe: vi.fn(() => 123) });
    const instance2 = new AgentInstance({
      core: { eventBus: eventBus2, logger: null, actor: "Listener2" },
      capabilities: { capabilities: new Map(), toolExecutor: null, mcpConfig: null, subagentRegistry: null },
      managers: { compressor: null, backtrackManager: null, discoveryManager: null },
      options: {},
    });

    const result = instance2.on("x", () => {});
    expect(result).toBe(123);
    await instance2.dispose();
  });

  it("dispose releases resources, guards methods, and setLoop is chainable", async () => {
    const eventBus = createEventBus();
    const compressor = { dispose: vi.fn(async () => {}) };
    const instance = new AgentInstance({
      core: { eventBus, logger: null, actor: "Dispose" },
      capabilities: { capabilities: new Map(), toolExecutor: vi.fn(), mcpConfig: null, subagentRegistry: null },
      managers: { compressor, backtrackManager: null, discoveryManager: null },
      options: {},
    });

    const loop = {
      _executeAbortController: { abort: vi.fn() },
      _detachEventBusListeners: vi.fn(),
      dispose: vi.fn(async () => {}),
    };

    const chained = instance.setLoop(loop);
    expect(chained).toBe(instance);

    await instance.dispose();

    expect(loop._executeAbortController.abort).toHaveBeenCalledWith("disposed");
    expect(loop._detachEventBusListeners).toHaveBeenCalledTimes(1);
    expect(loop.dispose).toHaveBeenCalledTimes(1);
    expect(compressor.dispose).toHaveBeenCalledTimes(1);
    expect(instance._loop).toBeNull();
    expect(instance._toolExecutor).toBeNull();

    expect(() => instance.getCapabilityDefinitions()).toThrow(/disposed/i);
    expect(() => instance.on("x", () => {})).toThrow(/disposed/i);
  });
});
