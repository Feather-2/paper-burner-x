import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedSdk = vi.hoisted(() => {
  let nextAgent = null;
  let lastCreateOptions = null;
  let lastUseCicadaOptions = null;

  const makeDefaultAgent = () => ({
    getSkillCatalogPrompt: vi.fn(() => "mock catalog"),
    memory: { archive: vi.fn(async () => {}) },
    toolExecutor: vi.fn(async () => ({ data: null })),
  });

  const createAgent = vi.fn((options) => {
    lastCreateOptions = options;
    const builder = {
      useCicada: vi.fn((opts) => {
        lastUseCicadaOptions = opts;
        return builder;
      }),
      build: vi.fn(() => {
        if (!nextAgent) {
          nextAgent = makeDefaultAgent();
        }
        return nextAgent;
      }),
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
    getLastCreateOptions: () => lastCreateOptions,
    getLastUseCicadaOptions: () => lastUseCicadaOptions,
    makeDefaultAgent,
    reset: () => {
      nextAgent = null;
      lastCreateOptions = null;
      lastUseCicadaOptions = null;
      createAgent.mockClear();
      createLogger.mockClear();
    },
  };
});

vi.mock("../../../../../js/agents/sdk/index.js", () => mockedSdk);

const modulePath = "../../../../../js/agents/sdk/examples/memory-recall.js";

const buildAgent = (overrides = {}) => {
  const base = {
    getSkillCatalogPrompt: vi.fn(() => "mock catalog"),
    memory: { archive: vi.fn(async () => {}) },
    toolExecutor: vi.fn(async () => ({ data: null })),
  };
  const memory = { ...base.memory, ...(overrides.memory || {}) };
  return { ...base, ...overrides, memory };
};

const loadModuleWithAgent = async (overrides = {}) => {
  const agent = buildAgent(overrides);
  mockedSdk.setNextAgent(agent);
  const mod = await import(modulePath);
  return { runDemo: mod.runDemo, moduleAgent: mod.agent, agent };
};

const buildToolExecutor = (resultsByAction = {}) =>
  vi.fn(async (toolName, params) => {
    if (toolName !== "Recall") {
      return { data: null };
    }
    const action = params?.action;
    if (Object.prototype.hasOwnProperty.call(resultsByAction, action)) {
      return { data: resultsByAction[action] };
    }
    return { data: null };
  });

const getCallForAction = (toolExecutor, action) =>
  toolExecutor.mock.calls.find(([, params]) => params?.action === action);

beforeEach(() => {
  vi.resetModules();
  mockedSdk.reset();
});

describe("agent", () => {
  it("builds a historian agent with cicada archive store", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { agent, moduleAgent } = await loadModuleWithAgent();

    expect(moduleAgent).toBe(agent);
    expect(mockedSdk.createAgent).toHaveBeenCalledTimes(1);
    expect(mockedSdk.getLastCreateOptions()).toEqual({ actor: "historian" });
    expect(mockedSdk.createLogger).toHaveBeenCalledWith("sdk/examples/memory-recall");

    const cicadaOptions = mockedSdk.getLastUseCicadaOptions();
    expect(cicadaOptions).toMatchObject({ maxTokens: 1000 });
    expect(cicadaOptions.archive).toBeDefined();
    expect(typeof cicadaOptions.archive.store).toBe("function");

    const key = "snapshot-1";
    const stored = await cicadaOptions.archive.store(key, { note: "ok" });
    expect(stored).toBe(key);
    expect(logSpy).toHaveBeenCalledWith(`[Archive] Saved snapshot: ${key}`);
    logSpy.mockRestore();
  });

  it("archive store accepts boundary keys and payload types", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await loadModuleWithAgent();

    const store = mockedSdk.getLastUseCicadaOptions().archive.store;
    const keys = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER, "123"];
    const payloads = [[], {}, { nested: { list: [] } }];

    for (let i = 0; i < keys.length; i++) {
      const stored = await store(keys[i], payloads[i % payloads.length]);
      expect(stored).toBe(keys[i]);
    }

    expect(logSpy).toHaveBeenCalledTimes(keys.length);
    logSpy.mockRestore();
  });
});

describe("runDemo", () => {
  it("runs the demo and recalls memories", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(7000000);

    const toolExecutor = buildToolExecutor({
      list: ["brainstorm_v1", "db_design"],
      search: ["db_design"],
      get: { id: "db_design" },
    });
    const archive = vi.fn(async () => {});
    const getSkillCatalogPrompt = vi.fn(() => "catalog");

    const { runDemo } = await loadModuleWithAgent({
      getSkillCatalogPrompt,
      memory: { archive },
      toolExecutor,
    });

    await runDemo();

    expect(getSkillCatalogPrompt).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledTimes(2);
    expect(archive).toHaveBeenCalledWith(
      "brainstorm_v1",
      expect.objectContaining({
        summary: expect.stringContaining("React"),
        timestamp: 7000000 - 3600000,
        context: expect.objectContaining({
          detail: expect.stringContaining("React"),
        }),
      })
    );
    expect(archive).toHaveBeenCalledWith(
      "db_design",
      expect.objectContaining({
        summary: expect.stringContaining("PostgreSQL"),
        timestamp: 7000000 - 1800000,
        context: expect.objectContaining({
          tables: expect.arrayContaining(["users", "posts", "comments"]),
          indexing_strategy: "B-Tree on user_id",
        }),
      })
    );

    const listCall = getCallForAction(toolExecutor, "list");
    const searchCall = getCallForAction(toolExecutor, "search");
    const getCall = getCallForAction(toolExecutor, "get");

    expect(listCall?.[0]).toBe("Recall");
    expect(searchCall?.[0]).toBe("Recall");
    expect(getCall?.[0]).toBe("Recall");

    for (const call of [listCall, searchCall, getCall]) {
      expect(call?.[2]).toEqual(
        expect.objectContaining({
          state: {},
          signal: expect.any(AbortSignal),
        })
      );
    }

    expect(logSpy).toHaveBeenCalledWith("=== Historian Agent Skill Catalog ===");
    expect(logSpy).toHaveBeenCalledWith("catalog");
    expect(logSpy).toHaveBeenCalledWith(["brainstorm_v1", "db_design"]);
    expect(logSpy).toHaveBeenCalledWith(["db_design"]);
    expect(logSpy).toHaveBeenCalledWith(
      "Detailed info:",
      JSON.stringify({ id: "db_design" }, null, 2)
    );

    nowSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("handles empty structures and type mismatches", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const toolExecutor = buildToolExecutor({
      list: {},
      search: [],
      get: "",
    });

    const { runDemo } = await loadModuleWithAgent({ toolExecutor });
    await runDemo();

    expect(logSpy).toHaveBeenCalledWith({});
    expect(logSpy).toHaveBeenCalledWith([]);
    expect(logSpy).toHaveBeenCalledWith("Detailed info:", JSON.stringify("", null, 2));
    logSpy.mockRestore();
  });

  it("handles nullish and whitespace responses", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const toolExecutor = buildToolExecutor({
      list: null,
      search: undefined,
      get: "   ",
    });

    const { runDemo } = await loadModuleWithAgent({ toolExecutor });
    await runDemo();

    expect(logSpy).toHaveBeenCalledWith(null);
    expect(logSpy).toHaveBeenCalledWith(undefined);
    expect(logSpy).toHaveBeenCalledWith("Detailed info:", JSON.stringify("   ", null, 2));
    logSpy.mockRestore();
  });

  it("handles large payloads and deep nesting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const largePayload = "x".repeat(100000);
    const longString = "y".repeat(50000);
    let deepObject = { leaf: true };
    for (let i = 0; i < 40; i++) {
      deepObject = { level: i, child: deepObject };
    }

    const toolExecutor = buildToolExecutor({
      list: { file: largePayload },
      search: longString,
      get: deepObject,
    });

    const { runDemo } = await loadModuleWithAgent({ toolExecutor });
    await runDemo();

    expect(logSpy).toHaveBeenCalledWith({ file: largePayload });
    expect(logSpy).toHaveBeenCalledWith(longString);
    expect(logSpy).toHaveBeenCalledWith("Detailed info:", expect.stringContaining("level"));
    logSpy.mockRestore();
  });

  it("supports concurrent executions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const toolExecutor = buildToolExecutor({
      list: ["a"],
      search: ["b"],
      get: { ok: true },
    });
    const archive = vi.fn(async () => {});
    const { runDemo } = await loadModuleWithAgent({ toolExecutor, memory: { archive } });

    await Promise.all([runDemo(), runDemo()]);

    expect(archive).toHaveBeenCalledTimes(4);
    expect(toolExecutor).toHaveBeenCalledTimes(6);
    logSpy.mockRestore();
  });

  it("supports rapid successive executions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const toolExecutor = buildToolExecutor({
      list: ["a"],
      search: ["b"],
      get: { ok: true },
    });
    const archive = vi.fn(async () => {});
    const { runDemo } = await loadModuleWithAgent({ toolExecutor, memory: { archive } });

    await runDemo();
    await runDemo();

    expect(archive).toHaveBeenCalledTimes(4);
    expect(toolExecutor).toHaveBeenCalledTimes(6);
    logSpy.mockRestore();
  });

  it("rejects when recall tool fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const toolExecutor = vi.fn(async () => {
      throw new Error("recall failed");
    });

    const { runDemo } = await loadModuleWithAgent({ toolExecutor });
    await expect(runDemo()).rejects.toThrow("recall failed");
    logSpy.mockRestore();
  });

  it("rejects when archive fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const archive = vi.fn(async () => {
      throw new Error("archive failed");
    });

    const { runDemo } = await loadModuleWithAgent({ memory: { archive } });
    await expect(runDemo()).rejects.toThrow("archive failed");
    expect(archive).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});
