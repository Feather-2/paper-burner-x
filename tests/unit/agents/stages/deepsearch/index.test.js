import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const state = { runImpl: null, fromJSONImpl: null };
  const instances = [];
  const defaultIsPlainObject = (value) => {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  class MockDeepSearchAgentLoop {
    constructor(options = {}) {
      this.options = options;
      this.run = vi.fn((input, ctx) => {
        if (typeof state.runImpl === "function") {
          return state.runImpl(input, ctx, this);
        }
        return Promise.resolve({ input, ctx, instance: this });
      });
      instances.push(this);
    }
  }

  const AgentStatus = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
  });

  class MockDeepSearchState {
    constructor(snapshot = {}) {
      this.snapshot = snapshot;
    }
    static fromJSON(json) {
      if (typeof state.fromJSONImpl === "function") {
        return state.fromJSONImpl(json);
      }
      return new MockDeepSearchState({ fromJSON: json });
    }
  }

  const runDeepSearchTodosStage = vi.fn();
  const tools = { alpha: { definition: { description: "alpha" } } };
  const executeTool = vi.fn();
  const getToolCatalogPrompt = vi.fn();
  const isPlainObject = vi.fn(defaultIsPlainObject);

  return {
    state,
    instances,
    defaultIsPlainObject,
    MockDeepSearchAgentLoop,
    AgentStatus,
    MockDeepSearchState,
    runDeepSearchTodosStage,
    tools,
    executeTool,
    getToolCatalogPrompt,
    isPlainObject,
  };
});

vi.mock("../../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => ({
  default: hoisted.MockDeepSearchAgentLoop,
  AgentStatus: hoisted.AgentStatus,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/state.js", () => ({
  DeepSearchState: hoisted.MockDeepSearchState,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/todos.js", () => ({
  runDeepSearchTodosStage: hoisted.runDeepSearchTodosStage,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/tools/index.js", () => ({
  tools: hoisted.tools,
  executeTool: hoisted.executeTool,
  getToolCatalogPrompt: hoisted.getToolCatalogPrompt,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: hoisted.isPlainObject,
}));

const modulePath = "../../../../../js/agents/stages/deepsearch/index.js";
const loadModule = async () => import(modulePath);

beforeEach(() => {
  hoisted.instances.length = 0;
  hoisted.state.runImpl = null;
  hoisted.state.fromJSONImpl = null;
  vi.clearAllMocks();
  hoisted.isPlainObject.mockImplementation(hoisted.defaultIsPlainObject);
});

describe("runDeepSearchAgent", () => {
  it("constructs agent with stageApi options and forwards run args", async () => {
    const { runDeepSearchAgent } = await loadModule();
    const stageApi = { eventBus: { emit: vi.fn() } };
    const runContext = { runId: "run_1" };
    const input = { mode: "fast", userConfig: { maxIterations: "7" } };

    hoisted.state.runImpl = vi.fn((_input, ctx, instance) => ({ ok: true, ctx, instance }));

    const result = await runDeepSearchAgent(runContext, input, stageApi);

    expect(hoisted.instances).toHaveLength(1);
    expect(hoisted.instances[0].options).toEqual({
      eventBus: stageApi.eventBus,
      mode: "fast",
      maxIterations: "7",
    });
    expect(hoisted.instances[0].run).toHaveBeenCalledWith(input, { stageApi, runContext });
    expect(result.instance).toBe(hoisted.instances[0]);
  });

  it("handles undefined input with default stageApi", async () => {
    const { runDeepSearchAgent } = await loadModule();
    const runContext = { runId: "run_empty" };

    hoisted.state.runImpl = vi.fn(() => "ok");

    const result = await runDeepSearchAgent(runContext);

    expect(hoisted.instances).toHaveLength(1);
    expect(hoisted.instances[0].options).toEqual({
      eventBus: undefined,
      mode: undefined,
      maxIterations: undefined,
    });
    expect(hoisted.instances[0].run).toHaveBeenCalledWith(undefined, { stageApi: {}, runContext });
    expect(result).toBe("ok");
  });

  it("passes boundary maxIterations values across rapid calls", async () => {
    const { runDeepSearchAgent } = await loadModule();
    const values = [0, -1, Number.MAX_SAFE_INTEGER];
    const results = [];

    hoisted.state.runImpl = vi.fn((input) => ({ seen: input?.userConfig?.maxIterations }));

    for (const value of values) {
      results.push(await runDeepSearchAgent(null, { userConfig: { maxIterations: value } }, {}));
    }

    expect(hoisted.instances.map((instance) => instance.options.maxIterations)).toEqual(values);
    expect(results.map((item) => item.seen)).toEqual(values);
  });

  it("handles concurrent calls with distinct inputs", async () => {
    const { runDeepSearchAgent } = await loadModule();
    const pending = [];

    hoisted.state.runImpl = vi.fn((input) => new Promise((resolve) => pending.push({ input, resolve })));

    const p1 = runDeepSearchAgent({ runId: "run_a" }, { mode: "a" }, { eventBus: "bus_a" });
    const p2 = runDeepSearchAgent({ runId: "run_b" }, { mode: "b" }, { eventBus: "bus_b" });

    expect(pending).toHaveLength(2);
    pending[0].resolve({ ok: pending[0].input.mode });
    pending[1].resolve({ ok: pending[1].input.mode });

    const results = await Promise.all([p1, p2]);

    expect(results).toEqual([{ ok: "a" }, { ok: "b" }]);
    expect(hoisted.instances).toHaveLength(2);
  });

  it("propagates agent.run rejections", async () => {
    const { runDeepSearchAgent } = await loadModule();
    const error = new Error("run failed");
    hoisted.state.runImpl = vi.fn(() => Promise.reject(error));

    await expect(runDeepSearchAgent(null, { userConfig: { maxIterations: 1 } }, {})).rejects.toThrow("run failed");
  });
});

describe("runDeepSearchStage", () => {
  it("delegates to runDeepSearchAgent", async () => {
    const { runDeepSearchStage } = await loadModule();
    const stageApi = { eventBus: { emit: vi.fn() } };
    const runContext = { runId: "run_stage" };
    const input = { mode: "stage", userConfig: { maxIterations: 2 } };

    hoisted.state.runImpl = vi.fn(() => ({ ok: true }));

    const result = await runDeepSearchStage(runContext, input, stageApi);

    expect(hoisted.instances).toHaveLength(1);
    expect(hoisted.instances[0].run).toHaveBeenCalledWith(input, { stageApi, runContext });
    expect(result).toEqual({ ok: true });
  });

  it("propagates errors from runDeepSearchAgent", async () => {
    const { runDeepSearchStage } = await loadModule();
    hoisted.state.runImpl = vi.fn(() => Promise.reject(new Error("stage failed")));

    await expect(runDeepSearchStage(null, { userConfig: { maxIterations: 1 } }, {})).rejects.toThrow("stage failed");
  });
});

describe("DeepSearchAgentLoop", () => {
  it("re-exports the agent loop class", async () => {
    const { DeepSearchAgentLoop } = await loadModule();
    expect(DeepSearchAgentLoop).toBe(hoisted.MockDeepSearchAgentLoop);
  });
});

describe("DeepSearchState", () => {
  it("re-exports the state class", async () => {
    const { DeepSearchState } = await loadModule();
    expect(DeepSearchState).toBe(hoisted.MockDeepSearchState);
  });
});

describe("AgentStatus", () => {
  it("re-exports AgentStatus constants", async () => {
    const { AgentStatus } = await loadModule();
    expect(AgentStatus).toBe(hoisted.AgentStatus);
    expect(AgentStatus.IDLE).toBe("idle");
  });
});

describe("runDeepSearchTodosStage", () => {
  it("re-exports runDeepSearchTodosStage", async () => {
    const { runDeepSearchTodosStage } = await loadModule();
    expect(runDeepSearchTodosStage).toBe(hoisted.runDeepSearchTodosStage);
  });
});

describe("tools", () => {
  it("re-exports tools catalog", async () => {
    const { tools } = await loadModule();
    expect(tools).toBe(hoisted.tools);
    expect(tools.alpha.definition.description).toBe("alpha");
  });
});

describe("executeTool", () => {
  it("re-exports executeTool", async () => {
    const { executeTool } = await loadModule();
    expect(executeTool).toBe(hoisted.executeTool);
  });
});

describe("getToolCatalogPrompt", () => {
  it("re-exports getToolCatalogPrompt", async () => {
    const { getToolCatalogPrompt } = await loadModule();
    expect(getToolCatalogPrompt).toBe(hoisted.getToolCatalogPrompt);
  });
});

describe("ensureState", () => {
  it("returns the same DeepSearchState instance when input is a state", async () => {
    const { ensureState } = await loadModule();
    const state = new hoisted.MockDeepSearchState({ runId: "run_direct" });

    const result = ensureState({ runId: "ignored" }, state);

    expect(result).toBe(state);
  });

  it("returns input.state when input.state is a DeepSearchState instance", async () => {
    const { ensureState } = await loadModule();
    const state = new hoisted.MockDeepSearchState({ runId: "run_wrapped" });

    const result = ensureState(null, { state });

    expect(result).toBe(state);
  });

  it("uses DeepSearchState.fromJSON for plain object state (empty object)", async () => {
    const { ensureState } = await loadModule();
    const raw = {};
    const fromJSONSpy = vi.fn((json) => new hoisted.MockDeepSearchState({ fromJSON: json }));
    hoisted.state.fromJSONImpl = fromJSONSpy;

    const result = ensureState(null, { state: raw });

    expect(fromJSONSpy).toHaveBeenCalledWith(raw);
    expect(result.snapshot.fromJSON).toBe(raw);
  });

  it.each([
    ["null input", null],
    ["undefined input", undefined],
  ])("creates new state for %s with defaults", async (_label, input) => {
    const { ensureState } = await loadModule();
    const runContext = { runId: 0 };

    const result = ensureState(runContext, input);

    expect(result.snapshot.runId).toBe(0);
    expect(result.snapshot.taskGoal).toBe("");
    expect(result.snapshot.userConfig).toEqual({});
    expect(result.snapshot.L0).toEqual({ sources: [], assets: [] });
  });

  it("normalizes invalid types and preserves whitespace taskGoal", async () => {
    const { ensureState } = await loadModule();
    const input = {
      sources: { not: "array" },
      assets: "not-array",
      taskGoal: "   ",
      userConfig: [],
    };

    const result = ensureState({ runId: "run_types" }, input);

    expect(result.snapshot.taskGoal).toBe("   ");
    expect(result.snapshot.L0.sources).toEqual([]);
    expect(result.snapshot.L0.assets).toEqual([]);
    expect(result.snapshot.userConfig).toEqual({});
  });

  it("keeps large payloads and deep nesting intact", async () => {
    const { ensureState } = await loadModule();
    const hugeText = "x".repeat(10000);
    const deepNested = { a: { b: { c: { d: [1, 2, 3] } } } };
    const sources = [{ id: "big", content: hugeText }];
    const assets = [{ name: "asset", meta: deepNested }];
    const userConfig = { nested: deepNested };

    const result = ensureState({ runId: "run_big" }, { sources, assets, taskGoal: hugeText, userConfig });

    expect(result.snapshot.taskGoal).toBe(hugeText);
    expect(result.snapshot.L0.sources).toBe(sources);
    expect(result.snapshot.L0.assets).toBe(assets);
    expect(result.snapshot.userConfig).toBe(userConfig);
  });

  it("throws when DeepSearchState.fromJSON fails", async () => {
    const { ensureState } = await loadModule();
    hoisted.state.fromJSONImpl = () => {
      throw new Error("bad state");
    };

    expect(() => ensureState(null, { state: { bad: true } })).toThrow("bad state");
  });
});

describe("default", () => {
  it("exports DeepSearchAgentLoop as default", async () => {
    const { default: DeepSearchAgentLoopDefault, DeepSearchAgentLoop } = await loadModule();
    expect(DeepSearchAgentLoopDefault).toBe(DeepSearchAgentLoop);
  });
});
