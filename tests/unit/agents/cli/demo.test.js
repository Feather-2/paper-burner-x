import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  capabilities: new Map(),
  subagents: new Map(),
  eventHandlers: [],
  agents: [],
  emittedEvents: [],
  toolCalls: [],
  includeTaskSkill: false,
  taskHandler: null,
  skillCatalogPrompt: "mock-skill-catalog",
  createAgentCalls: [],
}));

const routerState = vi.hoisted(() => ({
  instances: [],
  availableModels: [],
  tierMapping: {},
  getClient: vi.fn(),
}));

vi.mock("../../../../js/agents/sdk/index.js", () => {
  const createAgent = vi.fn((options) => {
    mockState.createAgentCalls.push(options);

    const builder = {
      memory: null,
      backtrack: null,
      discovery: null,
      useCapability(name, config) {
        mockState.capabilities.set(name, config.handler);
        return builder;
      },
      useSubagent(name, factory, description) {
        mockState.subagents.set(name, { factory, description });
        return builder;
      },
      useCicada(options) {
        builder.memory = { type: "CicadaCompressor", options };
        return builder;
      },
      useWatchdog(options) {
        builder.backtrack = { type: "BacktrackManager", options };
        builder.discovery = { type: "DiscoveryManager", options };
        return builder;
      },
      onEvent(pattern, handler) {
        mockState.eventHandlers.push({ pattern, handler });
        return builder;
      },
      build() {
        const skills = new Map();
        for (const name of mockState.capabilities.keys()) {
          skills.set(name, {});
        }
        if (mockState.includeTaskSkill) {
          skills.set("Task", {});
        }

        const toolExecutor = vi.fn(async (name, args) => {
          const handler =
            mockState.capabilities.get(name) ||
            (name === "Task" && mockState.includeTaskSkill
              ? mockState.taskHandler || (async () => ({ ok: true }))
              : null);

          if (!handler) {
            throw new Error(`Unknown tool: ${name}`);
          }

          const emit = (eventName, payload) => {
            mockState.emittedEvents.push({ name: eventName, payload });
            for (const { pattern, handler: evtHandler } of mockState.eventHandlers) {
              const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
              const matches = pattern.endsWith("*")
                ? eventName.startsWith(prefix)
                : eventName === pattern;
              if (matches) {
                evtHandler({ payload }, { name: eventName });
              }
            }
          };

          const result = await handler(args, { emit });
          mockState.toolCalls.push({ name, args, result });
          return result;
        });

        const agent = {
          skills,
          memory: builder.memory,
          backtrack: builder.backtrack,
          discovery: builder.discovery,
          getSkillCatalogPrompt: () => mockState.skillCatalogPrompt,
          subagentRegistry: {
            getAvailableTypes: () => Array.from(mockState.subagents.keys()),
            getDescription: (type) => mockState.subagents.get(type)?.description || "",
          },
          toolExecutor,
        };

        mockState.agents.push(agent);
        return agent;
      },
    };

    return builder;
  });

  return {
    createAgent,
    ContextMode: { ISOLATED: "isolated" },
  };
});

vi.mock("../../../../js/agents/cli/model-client.js", () => {
  class CliModelRouter {
    constructor() {
      routerState.instances.push(this);
    }

    getAvailableModels() {
      return routerState.availableModels;
    }

    getTierMapping() {
      return routerState.tierMapping;
    }

    getClient(role) {
      return routerState.getClient(role);
    }
  }

  return {
    CliModelRouter,
    createAiApiServiceAdapter: vi.fn(),
  };
});

const modulePath = "../../../../js/agents/cli/demo.js";
const baseArgv = process.argv.slice(0, 2);

const setArgv = (args) => {
  process.argv = [...baseArgv, ...args];
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const loadDemo = async (args = []) => {
  setArgv(args);
  vi.resetModules();
  await import(modulePath);
  await flushMicrotasks();
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();

  mockState.capabilities.clear();
  mockState.subagents.clear();
  mockState.eventHandlers.length = 0;
  mockState.agents.length = 0;
  mockState.emittedEvents.length = 0;
  mockState.toolCalls.length = 0;
  mockState.includeTaskSkill = false;
  mockState.taskHandler = null;
  mockState.skillCatalogPrompt = "mock-skill-catalog";
  mockState.createAgentCalls.length = 0;

  routerState.instances.length = 0;
  routerState.availableModels = [];
  routerState.tierMapping = {};
  routerState.getClient = vi.fn(() => ({
    model: "mock-model",
    ask: vi.fn(async (prompt) => `ok:${prompt}`),
  }));

  process.argv = baseArgv.slice();
});

describe("cli/demo.js CLI", () => {
  it("prints help and exits", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });

    await expect(loadDemo(["--help"])).rejects.toThrow(/exit:0/);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Agent SDK CLI Demo"));
  });

  it("lists skills", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockState.skillCatalogPrompt = "catalog-output";

    await loadDemo(["--list-skills"]);

    expect(logSpy).toHaveBeenCalledWith("catalog-output");
  });

  it("lists subagent types", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await loadDemo(["--list-subagents"]);

    const call = logSpy.mock.calls.find((args) =>
      typeof args[0] === "string" && args[0].includes("explorer")
    );
    expect(call).toBeTruthy();
  });

  it("prints dry-run summary", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    routerState.availableModels = ["model-a", "model-b"];
    routerState.tierMapping = { default: ["model-a"] };

    await loadDemo(["--dry-run"]);

    const skillsCall = logSpy.mock.calls.find((args) => args[0] === "Skills:");
    expect(skillsCall).toBeTruthy();
    expect(skillsCall[1]).toEqual(expect.arrayContaining(["echo", "analyze", "llm_chat"]));

    const modelsCall = logSpy.mock.calls.find((args) => args[0] === "Models:");
    expect(modelsCall[1]).toBe("model-a, model-b");

    const tiersCall = logSpy.mock.calls.find((args) => args[0] === "Tiers:");
    expect(tiersCall[1]).toContain("\"default\"");

    const memoryCall = logSpy.mock.calls.find((args) => args[0] === "Memory:");
    expect(memoryCall[1]).toBe("CicadaCompressor");

    const backtrackCall = logSpy.mock.calls.find((args) => args[0] === "Backtrack:");
    expect(backtrackCall[1]).toBe("BacktrackManager");

    const discoveryCall = logSpy.mock.calls.find((args) => args[0] === "Discovery:");
    expect(discoveryCall[1]).toBe("DiscoveryManager");

    expect(mockState.createAgentCalls[0]).toEqual({ actor: "demo" });
  });

  it("runs chat with configured model", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const ask = vi.fn(async (prompt) => `reply:${prompt}`);
    routerState.availableModels = ["model-a"];
    routerState.getClient = vi.fn(() => ({ model: "model-a", ask }));

    await loadDemo(["--chat", "hello"]);

    expect(routerState.getClient).toHaveBeenCalledWith("worker");
    expect(ask).toHaveBeenCalled();
    expect(logSpy.mock.calls.some((args) => args[0] === "Model:" && args[1] === "model-a")).toBe(true);
    expect(logSpy.mock.calls.some((args) => args[0] === "reply:hello")).toBe(true);

    const eventNames = mockState.emittedEvents.map((evt) => evt.name);
    expect(eventNames).toEqual(expect.arrayContaining(["demo:llm.start", "demo:llm.done"]));

    const toolNames = mockState.toolCalls.map((call) => call.name);
    expect(toolNames).toEqual(expect.arrayContaining(["llm_chat"]));
  });

  it("executes default flow and optional task tool", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockState.includeTaskSkill = true;
    mockState.taskHandler = vi.fn(async () => ({ result: "task-result" }));

    await loadDemo([]);

    const toolNames = mockState.toolCalls.map((call) => call.name);
    expect(toolNames).toEqual(expect.arrayContaining(["echo", "analyze", "Task"]));

    const echoCall = mockState.toolCalls.find((call) => call.name === "echo");
    expect(echoCall.args.message).toBe("Hello Agent SDK!");

    const analyzeCall = mockState.toolCalls.find((call) => call.name === "analyze");
    expect(analyzeCall.args.text).toBe("Hello Agent SDK!");

    expect(mockState.taskHandler).toHaveBeenCalledWith(
      expect.objectContaining({ subagent_type: "explorer", context_mode: "isolated" }),
      expect.objectContaining({ emit: expect.any(Function) })
    );
  });
});

describe("llm_chat capability", () => {
  it("returns content and emits events", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ask = vi.fn(async (prompt) => `ok:${prompt}`);
    routerState.getClient = vi.fn((role) => ({ model: `model-${role}`, ask }));

    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const result = await agent.toolExecutor("llm_chat", { prompt: "ping", role: "reviewer" });

    expect(result).toEqual({ content: "ok:ping" });
    expect(routerState.getClient).toHaveBeenCalledWith("reviewer");

    const eventNames = mockState.emittedEvents.map((evt) => evt.name);
    expect(eventNames).toEqual(expect.arrayContaining(["demo:llm.start", "demo:llm.done"]));
  });

  it("returns error when prompt is not a string", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ask = vi.fn((prompt) => {
      if (typeof prompt !== "string") {
        throw new Error("prompt must be string");
      }
      return "ok";
    });
    routerState.getClient = vi.fn(() => ({ model: "mock-model", ask }));

    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const result = await agent.toolExecutor("llm_chat", { prompt: { bad: true } });

    expect(result).toEqual({ error: "prompt must be string" });
  });

  it("handles concurrent calls", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ask = vi.fn(async (prompt) => `resp:${prompt}`);
    routerState.getClient = vi.fn(() => ({ model: "mock-model", ask }));

    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const [r1, r2] = await Promise.all([
      agent.toolExecutor("llm_chat", { prompt: "one" }),
      agent.toolExecutor("llm_chat", { prompt: "two" }),
    ]);

    expect(r1.content).toBe("resp:one");
    expect(r2.content).toBe("resp:two");
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe("echo capability", () => {
  it("echoes values with timestamps and supports rapid calls", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    const agent = mockState.agents[0];
    const messages = [0, -1, Number.MAX_SAFE_INTEGER, "", "   ", [], {}, null, undefined];

    const results = await Promise.all(
      messages.map((message) => agent.toolExecutor("echo", { message }))
    );

    expect(results[0].timestamp).toBe("2020-01-01T00:00:00.000Z");
    for (let i = 0; i < messages.length; i += 1) {
      expect(results[i].echoed).toBe(messages[i]);
    }

    const echoEvents = mockState.emittedEvents.filter((evt) => evt.name === "demo:echo");
    expect(echoEvents).toHaveLength(messages.length);

    vi.useRealTimers();
  });
});

describe("analyze capability", () => {
  it("returns shallow analysis by default", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const result = await agent.toolExecutor("analyze", { text: "hello world" });

    expect(result.wordCount).toBe(2);
    expect(result.charCount).toBe(11);
    expect(result.depth).toBe("shallow");
    expect(result.summary).toContain("2");
    expect(result.summary).not.toContain("11");
  });

  it("includes character count for deep analysis", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const result = await agent.toolExecutor("analyze", { text: "hello world", depth: "deep" });

    expect(result.wordCount).toBe(2);
    expect(result.charCount).toBe(11);
    expect(result.depth).toBe("deep");
    expect(result.summary).toContain("2");
    expect(result.summary).toContain("11");
  });

  it("handles empty, whitespace, and numeric-looking strings", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const empty = await agent.toolExecutor("analyze", { text: "" });
    const whitespace = await agent.toolExecutor("analyze", { text: " " });
    const numeric = await agent.toolExecutor("analyze", { text: "123" });

    expect(empty.wordCount).toBe(1);
    expect(empty.charCount).toBe(0);
    expect(whitespace.wordCount).toBe(2);
    expect(whitespace.charCount).toBe(1);
    expect(numeric.wordCount).toBe(1);
    expect(numeric.charCount).toBe(3);
  });

  it("throws for non-string input", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    await expect(agent.toolExecutor("analyze", { text: { bad: true } })).rejects.toThrow();
  });

  it("handles very large text", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);

    const agent = mockState.agents[0];
    const huge = "a".repeat(10000);
    const result = await agent.toolExecutor("analyze", { text: huge, depth: 0 });

    expect(result.wordCount).toBe(1);
    expect(result.charCount).toBe(10000);
    expect(result.depth).toBe(0);
  });
});

describe("event logging", () => {
  it("redacts sensitive data and skips prototype keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);
    logSpy.mockClear();

    const handler = mockState.eventHandlers[0].handler;
    const token = `sk-${"a".repeat(20)}`;
    const bearer = `Bearer ${"b".repeat(20)}`;

    const payload = Object.create(null);
    payload.apiKey = token;
    payload.authorization = bearer;
    payload.note = bearer;
    payload.nested = {
      token: "secret",
      list: [token, { auth: bearer }],
    };
    payload.__proto__ = { polluted: true };
    payload.constructor = "bad";
    payload.prototype = "bad";

    let cursor = payload;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = { safe: "ok" };
      cursor = cursor.next;
    }

    handler({ payload }, { name: "demo:test" });

    const logged = logSpy.mock.calls[0][1];
    expect(typeof logged).toBe("string");
    expect(logged).toContain("\"apiKey\":\"REDACTED\"");
    expect(logged).toContain("Bearer REDACTED");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("polluted");
  });

  it("stringifies empty and boundary values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);
    logSpy.mockClear();

    const handler = mockState.eventHandlers[0].handler;
    const cases = [
      { value: null, expected: "null" },
      { value: undefined, expected: undefined },
      { value: "", expected: "\"\"" },
      { value: [], expected: "[]" },
      { value: {}, expected: "{}" },
      { value: 0, expected: "0" },
      { value: -1, expected: "-1" },
      { value: Number.MAX_SAFE_INTEGER, expected: String(Number.MAX_SAFE_INTEGER) },
      { value: "   ", expected: "\"   \"" },
    ];

    for (const { value, expected } of cases) {
      handler(value, { name: "demo:edge" });
      const logged = logSpy.mock.calls[logSpy.mock.calls.length - 1][1];
      expect(logged).toBe(expected);
    }
  });

  it("handles circular and array-like payloads", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await loadDemo(["--dry-run"]);
    logSpy.mockClear();

    const handler = mockState.eventHandlers[0].handler;
    const circular = {};
    circular.self = circular;

    handler({ payload: circular }, { name: "demo:circular" });
    const circularLogged = logSpy.mock.calls[0][1];
    expect(circularLogged).toBe("[object Object]");

    const arrayLike = { 0: "a", 1: "b", length: 2 };
    handler({ payload: arrayLike }, { name: "demo:arraylike" });
    const arrayLogged = logSpy.mock.calls[1][1];
    expect(arrayLogged).toContain("\"length\":2");
  });
});
