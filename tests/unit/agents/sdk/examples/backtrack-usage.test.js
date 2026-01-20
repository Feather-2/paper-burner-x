// Adds unit tests for backtrack-usage, covering happy path, edge cases, concurrency, and errors.
// Mocks sdk index to isolate agent construction and validate logging/archive interactions.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockedSdk = vi.hoisted(() => {
  const logger = { error: vi.fn() };
  const builder = {
    useCicada: vi.fn(() => builder),
    useBacktrack: vi.fn(() => builder),
    build: vi.fn(),
  };
  const createAgent = vi.fn(() => builder);
  const createLogger = vi.fn(() => logger);
  const setAgent = (agent) => {
    builder.build.mockImplementation(() => agent);
  };

  return {
    logger,
    builder,
    createAgent,
    createLogger,
    setAgent,
  };
});

vi.mock("../../../../../js/agents/sdk/index.js", () => ({
  createAgent: mockedSdk.createAgent,
  createLogger: mockedSdk.createLogger,
}));

const MODULE_PATH = "../../../../../js/agents/sdk/examples/backtrack-usage.js";

async function loadModule() {
  return await import(MODULE_PATH);
}

function createMockAgent(overrides = {}) {
  const defaultToolExecutor = vi.fn(async (name) => {
    if (name === "Backtrack") {
      return {
        backtrack: {
          checkpointId: "step_1_start",
          state: { location: "起点" },
          hint: "forest",
        },
      };
    }
    if (name === "Recall") {
      return { data: [] };
    }
    return {};
  });

  return {
    memory: overrides.memory ?? { archive: vi.fn(async () => {}) },
    backtrack: overrides.backtrack ?? { remaining: 3 },
    toolExecutor: overrides.toolExecutor ?? defaultToolExecutor,
    getSkillCatalogPrompt: overrides.getSkillCatalogPrompt ?? vi.fn(() => "catalog"),
    ...overrides,
  };
}

async function setup(agentOverrides = {}) {
  const agent = createMockAgent(agentOverrides);
  mockedSdk.setAgent(agent);
  const mod = await loadModule();
  return { agent, mod };
}

let consoleSpy;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy?.mockRestore();
});

describe("agent", () => {
  it("builds the agent with cicada/backtrack support", async () => {
    const agent = createMockAgent();
    mockedSdk.setAgent(agent);

    const mod = await loadModule();

    expect(mod.agent).toBe(agent);
    expect(mockedSdk.createLogger).toHaveBeenCalledWith("sdk/examples/backtrack-usage");
    expect(mockedSdk.createAgent).toHaveBeenCalledWith({ actor: "traveler" });
    expect(mockedSdk.builder.useCicada).toHaveBeenCalledWith({ maxTokens: 2000 });
    expect(mockedSdk.builder.useBacktrack).toHaveBeenCalledWith({ maxBacktracks: 5 });
    expect(mockedSdk.builder.build).toHaveBeenCalledTimes(1);
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

    const { mod } = await setup({ memory, backtrack, toolExecutor, getSkillCatalogPrompt });

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
    expect(backtrackContext.signal).toBeInstanceOf(AbortSignal);

    const recallCall = toolExecutor.mock.calls.find(([name]) => name === "Recall");
    expect(recallCall).toEqual(["Recall", { action: "list" }, { state: {} }]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("成功回滚到存档: step_1_start"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("当时的地点: 起点"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("给未来的提示: \"use forest path\""));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("剩余回溯次数: 3"));
    expect(console.log).toHaveBeenCalledWith(listData);
  });

  it("skips backtrack logging when result is null/undefined and handles empty strings", async () => {
    const backtrackResults = [{ backtrack: null }, { backtrack: undefined }];
    const recallResults = [{ data: "" }, { data: "   " }];
    const toolExecutor = vi.fn(async (name) => {
      if (name === "Backtrack") {
        return backtrackResults.shift();
      }
      if (name === "Recall") {
        return recallResults.shift();
      }
      return {};
    });

    const { mod } = await setup({ toolExecutor });

    await mod.runDemo();
    await mod.runDemo();

    const logMessages = console.log.mock.calls.map(([value]) => value);
    expect(logMessages).toContain("");
    expect(logMessages).toContain("   ");
    expect(
      logMessages.find((msg) => typeof msg === "string" && msg.includes("成功回滚到存档"))
    ).toBeUndefined();
    expect(toolExecutor).toHaveBeenCalledTimes(4);
  });

  it("handles boundary values, type edges, and large payloads", async () => {
    const longString = "x".repeat(12000);
    const deepNested = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deep",
            },
          },
        },
      },
    };
    const arrayLike = { 0: "zero", length: 1 };
    const bigFile = { ...arrayLike, file: longString };

    const backtrackResults = [
      { backtrack: { checkpointId: "", state: { location: null }, hint: "" } },
      { backtrack: { checkpointId: "neg", state: { location: undefined }, hint: "   " } },
      { backtrack: { checkpointId: "max", state: { location: "deep" }, hint: longString } },
      { backtrack: { checkpointId: "string", state: { location: "0" }, hint: "hint" } },
    ];
    const recallResults = [{ data: [] }, { data: {} }, { data: bigFile }, { data: deepNested }];
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

    const { mod, agent } = await setup({ toolExecutor, backtrack });

    const remainingValues = [0, -1, Number.MAX_SAFE_INTEGER, "0"];
    for (const value of remainingValues) {
      agent.backtrack.remaining = value;
      await mod.runDemo();
    }

    const logMessages = console.log.mock.calls.map(([value]) => value);
    expect(logMessages).toContain("成功回滚到存档: ");
    expect(logMessages).toContain("当时的地点: null");
    expect(logMessages).toContain("当时的地点: undefined");
    expect(logMessages).toContain("给未来的提示: \"   \"");
    expect(logMessages).toContain("剩余回溯次数: -1");
    expect(logMessages).toContain(`剩余回溯次数: ${Number.MAX_SAFE_INTEGER}`);
    expect(logMessages).toContain("剩余回溯次数: 0");
    expect(
      logMessages.some(
        (msg) => typeof msg === "string" && msg.includes(longString.slice(0, 120))
      )
    ).toBe(true);
    expect(console.log).toHaveBeenCalledWith([]);
    expect(console.log).toHaveBeenCalledWith({});
    expect(console.log).toHaveBeenCalledWith(bigFile);
    expect(console.log).toHaveBeenCalledWith(deepNested);
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

    const { mod, agent } = await setup({ memory, toolExecutor });

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

    const { mod } = await setup({ memory, toolExecutor });

    await expect(mod.runDemo()).rejects.toThrow("archive failed");
    expect(toolExecutor).not.toHaveBeenCalled();
  });
});
