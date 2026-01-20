import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedSdk = vi.hoisted(() => {
  const agents = [];
  const builders = [];
  let toolExecutorError = null;

  const createAgent = vi.fn((options = {}) => {
    const capabilities = new Map();
    const subagents = new Map();

    const builder = {
      useCapability: vi.fn((name, handler) => {
        capabilities.set(name, handler);
        return builder;
      }),
      useSubagent: vi.fn((name, factory, description) => {
        subagents.set(name, { factory, description });
        return builder;
      }),
      build: vi.fn(() => {
        const builtAgent = {
          actor: options?.actor,
          getCapabilityCatalogPrompt: vi.fn(() => {
            if (subagents.size === 0) {
              return "No subagents registered.";
            }
            return Array.from(subagents.entries())
              .map(([name, { description }]) => `${name}: ${description}`)
              .join("\n");
          }),
          toolExecutor: vi.fn(async (toolName, params, context) => {
            if (toolExecutorError) throw toolExecutorError;

            if (toolName !== "Task") {
              return { ok: false, success: false, error: `Unknown tool: ${toolName}` };
            }

            const safeParams = params && typeof params === "object" ? params : {};
            const subagentType = typeof safeParams.subagent_type === "string" ? safeParams.subagent_type : "";
            const subagentEntry = subagents.get(subagentType);

            if (!subagentEntry) {
              return { ok: false, success: false, error: `Unknown subagent: ${subagentType}` };
            }

            const subagent = await subagentEntry.factory({
              prompt: safeParams.prompt,
              model: safeParams.model,
            });

            let capabilityResult = null;

            if (subagent && subagent._capabilities) {
              if (subagent._capabilities.has("search")) {
                const handler = subagent._capabilities.get("search");
                capabilityResult = await handler({ query: safeParams.prompt }, context);
              } else if (subagent._capabilities.has("write")) {
                const handler = subagent._capabilities.get("write");
                capabilityResult = await handler({ topic: safeParams.prompt }, context);
              }
            }

            return { ok: true, success: true, subagent: subagentType, result: capabilityResult };
          }),
          _capabilities: capabilities,
          _subagents: subagents,
        };

        agents.push(builtAgent);
        return builtAgent;
      }),
    };

    builders.push(builder);
    return builder;
  });

  const createLogger = vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }));

  const reset = () => {
    agents.length = 0;
    builders.length = 0;
    toolExecutorError = null;
  };

  const setToolExecutorError = (error) => {
    toolExecutorError = error;
  };

  return { createAgent, createLogger, agents, builders, reset, setToolExecutorError };
});

vi.mock("../../../../../js/agents/sdk/index.js", () => ({
  createAgent: mockedSdk.createAgent,
  createLogger: mockedSdk.createLogger,
}));

const importModule = async () => await import("../../../../../js/agents/sdk/examples/subagent-usage.js");

const makeDeepNested = (depth) => {
  let node = {};
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
};

beforeEach(() => {
  vi.resetModules();
  mockedSdk.reset();
  vi.clearAllMocks();
});

describe("bossAgent", () => {
  it("registers subagents and exposes a catalog prompt", async () => {
    const { bossAgent } = await importModule();

    expect(mockedSdk.createAgent).toHaveBeenCalledWith({ actor: "boss" });
    expect(mockedSdk.builders).toHaveLength(1);

    const bossBuilder = mockedSdk.builders[0];
    expect(bossBuilder.useSubagent).toHaveBeenCalledTimes(2);
    expect(bossBuilder.useSubagent).toHaveBeenCalledWith(
      "Explore",
      expect.any(Function),
      expect.any(String),
    );
    expect(bossBuilder.useSubagent).toHaveBeenCalledWith(
      "Writer",
      expect.any(Function),
      expect.any(String),
    );

    const catalog = bossAgent.getCapabilityCatalogPrompt();
    expect(catalog).toContain("Explore");
    expect(catalog).toContain("Writer");
  });

  it("executes Explore Task with a normal prompt", async () => {
    const { bossAgent } = await importModule();
    const context = { state: {}, signal: new AbortController().signal };

    const result = await bossAgent.toolExecutor(
      "Task",
      { subagent_type: "Explore", prompt: "Find docs", model: "haiku" },
      context,
    );

    expect(result).toMatchObject({ ok: true, success: true, subagent: "Explore" });
    expect(result.result).toEqual({
      success: true,
      results: ['Search results for "Find docs"'],
    });
    expect(mockedSdk.createAgent).toHaveBeenCalledWith({ actor: "explorer" });
  });

  it("handles boundary prompt values and types for Explore tasks", async () => {
    const { bossAgent } = await importModule();
    const context = { state: {}, signal: new AbortController().signal };
    const cases = [
      { label: "null", prompt: null, expected: "" },
      { label: "undefined", prompt: undefined, expected: "" },
      { label: "empty string", prompt: "", expected: "" },
      { label: "whitespace", prompt: "   ", expected: "   " },
      { label: "empty array", prompt: [], expected: "" },
      { label: "empty object", prompt: {}, expected: "" },
      { label: "zero", prompt: 0, expected: "" },
      { label: "negative", prompt: -1, expected: "" },
      { label: "max safe integer", prompt: Number.MAX_SAFE_INTEGER, expected: "" },
      { label: "numeric string", prompt: "123", expected: "123" },
      { label: "string zero", prompt: "0", expected: "0" },
    ];

    for (const testCase of cases) {
      const result = await bossAgent.toolExecutor(
        "Task",
        { subagent_type: "Explore", prompt: testCase.prompt, model: testCase.model ?? "haiku" },
        context,
      );

      expect(result.result.results[0]).toBe(`Search results for "${testCase.expected}"`);
    }
  });

  it("supports Writer tasks with resource boundary prompts", async () => {
    const { bossAgent } = await importModule();
    const context = { state: {}, signal: new AbortController().signal };
    const longPrompt = "x".repeat(50000);
    const deepPrompt = makeDeepNested(40);

    const longResult = await bossAgent.toolExecutor(
      "Task",
      { subagent_type: "Writer", prompt: longPrompt, model: "haiku" },
      context,
    );

    expect(longResult.result.text.startsWith("Drafting content: ")).toBe(true);
    expect(longResult.result.text.length).toBe("Drafting content: ".length + longPrompt.length);

    const deepResult = await bossAgent.toolExecutor(
      "Task",
      { subagent_type: "Writer", prompt: deepPrompt, model: "haiku" },
      context,
    );

    expect(deepResult.result.text).toBe("Drafting content: ");
  });

  it("handles concurrent and rapid Task calls", async () => {
    const { bossAgent } = await importModule();
    const context = { state: {}, signal: new AbortController().signal };

    const [first, second, third] = await Promise.all([
      bossAgent.toolExecutor(
        "Task",
        { subagent_type: "Explore", prompt: "alpha", model: "haiku" },
        context,
      ),
      bossAgent.toolExecutor(
        "Task",
        { subagent_type: "Explore", prompt: "beta", model: "haiku" },
        context,
      ),
      bossAgent.toolExecutor(
        "Task",
        { subagent_type: "Writer", prompt: "gamma", model: "haiku" },
        context,
      ),
    ]);

    expect(first.result.results[0]).toBe('Search results for "alpha"');
    expect(second.result.results[0]).toBe('Search results for "beta"');
    expect(third.result.text).toBe("Drafting content: gamma");

    const rapidPrompts = ["one", "two", "three"];
    const rapidResults = [];

    for (const prompt of rapidPrompts) {
      rapidResults.push(
        await bossAgent.toolExecutor(
          "Task",
          { subagent_type: "Explore", prompt, model: "haiku" },
          context,
        ),
      );
    }

    expect(rapidResults.map((result) => result.result.results[0])).toEqual([
      'Search results for "one"',
      'Search results for "two"',
      'Search results for "three"',
    ]);
  });

  it("returns errors for unknown tools, subagents, and invalid params", async () => {
    const { bossAgent } = await importModule();
    const context = { state: {}, signal: new AbortController().signal };

    const unknownTool = await bossAgent.toolExecutor(
      "Unknown",
      { subagent_type: "Explore", prompt: "hi", model: "haiku" },
      context,
    );

    expect(unknownTool.success).toBe(false);
    expect(unknownTool.error).toContain("Unknown tool");

    const unknownSubagent = await bossAgent.toolExecutor(
      "Task",
      { subagent_type: "Missing", prompt: "hi", model: "haiku" },
      context,
    );

    expect(unknownSubagent.success).toBe(false);
    expect(unknownSubagent.error).toContain("Unknown subagent");

    const invalidParams = await bossAgent.toolExecutor("Task", "not-an-object", context);

    expect(invalidParams.success).toBe(false);
    expect(invalidParams.error).toContain("Unknown subagent");
  });
});

describe("runDemo", () => {
  it("logs catalog details and task results", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDemo, bossAgent } = await importModule();

    await runDemo();

    expect(bossAgent.getCapabilityCatalogPrompt).toHaveBeenCalledTimes(1);
    expect(bossAgent.toolExecutor).toHaveBeenCalledTimes(1);
    expect(bossAgent.toolExecutor).toHaveBeenCalledWith(
      "Task",
      expect.objectContaining({
        subagent_type: "Explore",
        prompt: "Find all instances of authentication logic",
        model: "haiku",
      }),
      expect.objectContaining({ state: {}, signal: expect.any(Object) }),
    );

    const logMessages = consoleSpy.mock.calls.map((call) => call[0]);
    expect(logMessages).toContain("=== Boss Agent Capability Catalog ===");
    expect(logMessages).toContain("\n=== Example Model Decision ===");
    expect(logMessages).toContain("Model would call Task tool like this:");

    const taskLog = consoleSpy.mock.calls.find((call) => call[0] === "Task Result:");
    expect(taskLog).toBeTruthy();
    expect(taskLog[1]).toContain("Search results for");

    consoleSpy.mockRestore();
  });

  it("propagates toolExecutor errors", async () => {
    mockedSdk.setToolExecutorError(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runDemo } = await importModule();

    await expect(runDemo()).rejects.toThrow("boom");

    consoleSpy.mockRestore();
  });
});
