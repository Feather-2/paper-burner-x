import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedSdk = vi.hoisted(() => {
  let nextAgent = null;
  let lastCreateAgentOptions = null;
  let lastUseCicadaOptions = null;
  let lastUseBacktrackOptions = null;

  const createAgent = vi.fn((options) => {
    lastCreateAgentOptions = options;

    const builder = {
      useCicada: vi.fn((opts) => {
        lastUseCicadaOptions = opts;
        return builder;
      }),
      useBacktrack: vi.fn((opts) => {
        lastUseBacktrackOptions = opts;
        return builder;
      }),
      build: vi.fn(() => nextAgent),
    };

    return builder;
  });

  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));

  return {
    createAgent,
    createLogger,
    setNextAgent: (agent) => {
      nextAgent = agent;
    },
    getLastCreateAgentOptions: () => lastCreateAgentOptions,
    getLastUseCicadaOptions: () => lastUseCicadaOptions,
    getLastUseBacktrackOptions: () => lastUseBacktrackOptions,
    reset: () => {
      nextAgent = null;
      lastCreateAgentOptions = null;
      lastUseCicadaOptions = null;
      lastUseBacktrackOptions = null;
      createAgent.mockClear();
      createLogger.mockClear();
    },
  };
});

vi.mock("../../../../../js/agents/sdk/index.js", () => ({
  createAgent: mockedSdk.createAgent,
  createLogger: mockedSdk.createLogger,
}));

const MODULE_PATH = "../../../../../js/agents/sdk/examples/backtrack-usage.js";

const buildAgent = (overrides = {}) => {
  const base = {
    getSkillCatalogPrompt: vi.fn(() => "catalog"),
    memory: { archive: vi.fn(async () => {}) },
    backtrack: { remaining: 3 },
    toolExecutor: vi.fn(async (toolName) => {
      if (toolName === "Backtrack") {
        return {
          backtrack: { checkpointId: "step_1_start", state: { location: "起点" }, hint: "hint" },
        };
      }
      if (toolName === "Recall") return { data: [] };
      return {};
    }),
  };

  const memory = { ...base.memory, ...(overrides.memory || {}) };
  const backtrack = { ...base.backtrack, ...(overrides.backtrack || {}) };
  return { ...base, ...overrides, memory, backtrack };
};

const loadModuleWithAgent = async (agentOverrides = {}) => {
  const agent = buildAgent(agentOverrides);
  mockedSdk.setNextAgent(agent);
  const mod = await import(MODULE_PATH);
  return { mod, agent, moduleAgent: mod.agent };
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mockedSdk.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("agent", () => {
  it("builds the agent with cicada/backtrack support", async () => {
    const { agent, moduleAgent } = await loadModuleWithAgent();

    expect(moduleAgent).toBe(agent);
    expect(mockedSdk.createLogger).toHaveBeenCalledWith("sdk/examples/backtrack-usage");
    expect(mockedSdk.createAgent).toHaveBeenCalledTimes(1);
    expect(mockedSdk.getLastCreateAgentOptions()).toEqual({ actor: "traveler" });
    expect(mockedSdk.getLastUseCicadaOptions()).toEqual({ maxTokens: 2000 });
    expect(mockedSdk.getLastUseBacktrackOptions()).toEqual({ maxBacktracks: 5 });
  });

  it("throws when the agent builder chain is broken", async () => {
    mockedSdk.createAgent.mockImplementationOnce(() => ({
      useCicada: vi.fn(() => null),
    }));

    await expect(import(MODULE_PATH)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("runDemo", () => {
  it("runs the happy path and logs the backtrack flow", async () => {
    const memory = { archive: vi.fn(async () => {}) };
    const backtrack = { remaining: 3 };
    const listData = ["step_1_start", "step_2_mountain", "step_2_forest_new"];
    const toolExecutor = vi.fn(async (name) => {
      if (name === "Backtrack") {
        return {
          backtrack: {
            checkpointId: "step_1_start",
            state: { location: "起点" },
            hint: "use forest path",
          },
        };
      }
      if (name === "Recall") {
        return { data: listData };
      }
      return {};
    });
    const getSkillCatalogPrompt = vi.fn(() => "catalog");

    const { mod } = await loadModuleWithAgent({ memory, backtrack, toolExecutor, getSkillCatalogPrompt });

    await mod.runDemo();

    expect(getSkillCatalogPrompt).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("=== Agent Skill Catalog ===");
    expect(console.log).toHaveBeenCalledWith("catalog");

    expect(memory.archive).toHaveBeenNthCalledWith(1, "step_1_start", {
      summary: "开始任务：寻找宝藏",
      context: { location: "起点", path: "未选择" },
    });
    expect(memory.archive).toHaveBeenNthCalledWith(2, "step_2_mountain", {
      summary: "走向了雪山路径",
      context: { location: "雪山脚下", path: "雪山", temperature: -20 },
    });
    expect(memory.archive).toHaveBeenNthCalledWith(3, "step_2_forest_new", {
      summary: "选择了森林路径 (基于回溯提示)",
      context: { location: "森林入口", path: "森林", hint_used: true },
    });

    const backtrackCall = toolExecutor.mock.calls.find(([name]) => name === "Backtrack");
    expect(backtrackCall).toBeDefined();
    const [, backtrackParams, backtrackContext] = backtrackCall;
    expect(backtrackParams).toEqual({
      reason: "雪山路径太危险，且没有带御寒装备，我需要回滚到起点重新选择森林路径。",
      hint: "不要选雪山，选那条长满蘑菇的森林小径。",
    });
    expect(backtrackContext.state).toEqual({});
    expect(backtrackContext).toEqual(
      expect.objectContaining({
        state: {},
        signal: expect.any(AbortSignal),
      })
    );

    const recallCall = toolExecutor.mock.calls.find(([name]) => name === "Recall");
    expect(recallCall).toEqual(["Recall", { action: "list" }, { state: {} }]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("成功回滚到存档: step_1_start"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("当时的地点: 起点"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("给未来的提示: \"use forest path\""));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("剩余回溯次数: 3"));
    expect(console.log).toHaveBeenCalledWith(listData);
  });

  it("handles nullish/empty results and type mismatches from tools", async () => {
    const backtrackResults = [
      { backtrack: null },
      { backtrack: undefined },
      { backtrack: "" },
      { backtrack: 0 },
    ];
    const recallResults = [
      { data: null },
      { data: undefined },
      { data: "" },
      { data: "   " },
      { data: [] },
      { data: {} },
      { data: { 0: "item", length: 1 } },
    ];
    const toolExecutor = vi.fn(async (name) => {
      if (name === "Backtrack") {
        return backtrackResults.shift() ?? { backtrack: undefined };
      }
      if (name === "Recall") {
        return recallResults.shift() ?? { data: undefined };
      }
      return {};
    });

    const { mod } = await loadModuleWithAgent({ toolExecutor });

    await mod.runDemo();
    await mod.runDemo();
    await mod.runDemo();
    await mod.runDemo();
    await mod.runDemo();
    await mod.runDemo();
    await mod.runDemo();

    const logMessages = console.log.mock.calls.map(([value]) => value);
    expect(logMessages).toContain("");
    expect(logMessages).toContain("   ");
    expect(
      logMessages.find((msg) => typeof msg === "string" && msg.includes("成功回滚到存档"))
    ).toBeUndefined();
    expect(logMessages).toContain(null);
    expect(logMessages).toContain(undefined);
    expect(console.log).toHaveBeenCalledWith([]);
    expect(console.log).toHaveBeenCalledWith({});
    expect(console.log).toHaveBeenCalledWith({ 0: "item", length: 1 });
    expect(toolExecutor).toHaveBeenCalledTimes(14);
  });

  it("handles boundary values and resource-sized payloads", async () => {
    const longString = "x".repeat(12000);
    let deepNested = { leaf: true };
    for (let i = 0; i < 35; i += 1) deepNested = { level: i, child: deepNested };
    const hugeFile = { name: "huge.bin", size: Number.MAX_SAFE_INTEGER, contents: longString };

    const backtrackResults = [
      { backtrack: { checkpointId: 0, state: [], hint: "" } },
      { backtrack: { checkpointId: -1, state: { location: undefined }, hint: "   " } },
      { backtrack: { checkpointId: Number.MAX_SAFE_INTEGER, state: { location: "deep" }, hint: longString } },
      { backtrack: { checkpointId: "0", state: { location: "0" }, hint: { text: "hint" } } },
    ];
    const recallResults = [{ data: hugeFile }, { data: deepNested }, { data: longString }, { data: [] }];
    const toolExecutor = vi.fn(async (name) => {
      if (name === "Backtrack") {
        return backtrackResults.shift();
      }
      if (name === "Recall") {
        return recallResults.shift();
      }
      return {};
    });
    const backtrack = { remaining: 0 };

    const { mod, agent } = await loadModuleWithAgent({ toolExecutor, backtrack });

    const remainingValues = [0, -1, Number.MAX_SAFE_INTEGER, "0"];
    for (const value of remainingValues) {
      agent.backtrack.remaining = value;
      await mod.runDemo();
    }

    const logMessages = console.log.mock.calls.map(([value]) => value);
    expect(logMessages).toContain("成功回滚到存档: 0");
    expect(logMessages).toContain("成功回滚到存档: -1");
    expect(logMessages).toContain(`成功回滚到存档: ${Number.MAX_SAFE_INTEGER}`);
    expect(logMessages).toContain("当时的地点: undefined");
    expect(logMessages).toContain("剩余回溯次数: -1");
    expect(logMessages).toContain(`剩余回溯次数: ${Number.MAX_SAFE_INTEGER}`);
    expect(logMessages).toContain("剩余回溯次数: 0");
    expect(
      logMessages.some(
        (msg) => typeof msg === "string" && msg.includes(longString.slice(0, 120))
      )
    ).toBe(true);
    expect(console.log).toHaveBeenCalledWith(hugeFile);
    expect(console.log).toHaveBeenCalledWith(deepNested);
    expect(console.log).toHaveBeenCalledWith(longString);
    expect(console.log).toHaveBeenCalledWith([]);
    expect(agent.backtrack.remaining).toBe("0");
  });

  it("supports concurrent and rapid sequential invocations", async () => {
    const memory = { archive: vi.fn(async () => {}) };
    const toolExecutor = vi.fn(async (name) => {
      if (name === "Backtrack") {
        return {
          backtrack: {
            checkpointId: "step_1_start",
            state: { location: "起点" },
            hint: "hint",
          },
        };
      }
      if (name === "Recall") {
        return { data: [] };
      }
      return {};
    });

    const { mod, agent } = await loadModuleWithAgent({ memory, toolExecutor });

    await Promise.all([mod.runDemo(), mod.runDemo()]);
    await mod.runDemo();

    expect(memory.archive).toHaveBeenCalledTimes(9);
    expect(toolExecutor).toHaveBeenCalledTimes(6);
    expect(agent.getSkillCatalogPrompt).toHaveBeenCalledTimes(3);
  });

  it("propagates archive errors", async () => {
    const error = new Error("archive failed");
    const memory = { archive: vi.fn().mockRejectedValueOnce(error) };
    const toolExecutor = vi.fn();

    const { mod } = await loadModuleWithAgent({ memory, toolExecutor });

    await expect(mod.runDemo()).rejects.toThrow("archive failed");
    expect(toolExecutor).not.toHaveBeenCalled();
  });

  it("propagates tool executor errors and invalid backtrack payloads", async () => {
    const failingExecutor = vi.fn(async (toolName) => {
      if (toolName === "Backtrack") throw new Error("tool failed");
      return { data: [] };
    });
    const { mod: modA } = await loadModuleWithAgent({ toolExecutor: failingExecutor });
    await expect(modA.runDemo()).rejects.toThrow("tool failed");

    vi.resetModules();
    mockedSdk.reset();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const invalidPayloadExecutor = vi.fn(async (toolName) => {
      if (toolName === "Backtrack") return { backtrack: { checkpointId: "x", state: undefined, hint: "h" } };
      if (toolName === "Recall") return { data: [] };
      return {};
    });
    const { mod: modB } = await loadModuleWithAgent({ toolExecutor: invalidPayloadExecutor });
    await expect(modB.runDemo()).rejects.toBeInstanceOf(TypeError);
  });
});
