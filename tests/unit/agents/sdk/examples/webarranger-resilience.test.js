import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../../js/agents/sdk/examples/webarranger-resilience.js";

const hoisted = vi.hoisted(() => ({
  createAgent: vi.fn(),
  createLogger: vi.fn(),
  loggerError: vi.fn(),
  discoveryStatus: { CONTRADICTED: "contradicted" }
}));

vi.mock("../../../../../js/agents/sdk/index.js", () => ({
  createAgent: hoisted.createAgent,
  createLogger: hoisted.createLogger
}));

vi.mock("../../../../../js/agents/sdk/DiscoveryManager.js", () => ({
  DiscoveryStatus: hoisted.discoveryStatus
}));

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

const makeBuilder = () => {
  const builder = {
    useCicada: vi.fn(),
    useBacktrack: vi.fn(),
    build: vi.fn()
  };

  builder.useCicada.mockReturnValue(builder);
  builder.useBacktrack.mockReturnValue(builder);
  builder.build.mockReturnValue({ id: "arranger" });

  return builder;
};

const runModule = async () => {
  const mod = await import(MODULE_PATH);
  await flushMicrotasks();
  return mod;
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();

  hoisted.createAgent.mockReset();
  hoisted.createLogger.mockReset();
  hoisted.loggerError.mockReset();
  hoisted.discoveryStatus.CONTRADICTED = "contradicted";

  hoisted.createLogger.mockReturnValue({ error: hoisted.loggerError });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("sdk/examples/webarranger-resilience.js", () => {
  it("executes the workflow and logs key steps", async () => {
    const builder = makeBuilder();
    hoisted.createAgent.mockReturnValue(builder);

    await runModule();

    expect(hoisted.createLogger).toHaveBeenCalledWith("sdk/examples/webarranger-resilience");
    expect(hoisted.createAgent).toHaveBeenCalledTimes(1);
    expect(builder.useCicada).toHaveBeenCalledWith({ maxTokens: 4000 });
    expect(builder.useBacktrack).toHaveBeenCalledWith({ maxBacktracks: 3 });
    expect(builder.build).toHaveBeenCalledTimes(1);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Starting Resilient WebArranger Workflow")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Arranger Evaluation:")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Resilience demonstration completed")
    );
    expect(hoisted.loggerError).not.toHaveBeenCalled();
  });

  it("has no public exports (side-effect only module)", async () => {
    hoisted.createAgent.mockReturnValue(makeBuilder());

    const mod = await runModule();

    expect(Object.keys(mod)).toHaveLength(0);
  });

  it("logs errors when the workflow fails", async () => {
    const error = new Error("boom");
    hoisted.createAgent.mockImplementation(() => {
      throw error;
    });

    await runModule();

    expect(hoisted.loggerError).toHaveBeenCalledTimes(1);
    expect(hoisted.loggerError).toHaveBeenCalledWith("main failed", { error });
  });

  const boundaryCases = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace string", value: "   " },
    { label: "empty array", value: [] },
    { label: "empty object", value: {} },
    { label: "zero", value: 0 },
    { label: "negative one", value: -1 },
    { label: "max safe integer", value: Number.MAX_SAFE_INTEGER },
    { label: "string as number", value: "4000" },
    { label: "object as array", value: { 0: "item", length: 1 } }
  ];

  it.each(boundaryCases)("logs boundary error values: $label", async ({ value }) => {
    hoisted.createAgent.mockImplementation(() => {
      throw value;
    });

    await runModule();

    expect(hoisted.loggerError).toHaveBeenCalledWith("main failed", { error: value });
  });

  it("logs resource-sized error payloads", async () => {
    const longString = "x".repeat(200000);
    const deepNested = (() => {
      const root = {};
      let cursor = root;
      for (let i = 0; i < 25; i += 1) {
        cursor.level = {};
        cursor = cursor.level;
      }
      return root;
    })();
    const hugeFile = {
      name: "huge.pdf",
      size: Number.MAX_SAFE_INTEGER,
      contents: longString
    };
    const payload = { file: hugeFile, message: longString, nested: deepNested };

    hoisted.createAgent.mockImplementation(() => {
      throw payload;
    });

    await runModule();

    expect(hoisted.loggerError).toHaveBeenCalledWith("main failed", { error: payload });
  });

  it("handles simultaneous imports", async () => {
    hoisted.createAgent.mockReturnValue(makeBuilder());

    const [modA, modB] = await Promise.all([runModule(), runModule()]);

    expect(modA).toBe(modB);
    expect(hoisted.createAgent).toHaveBeenCalledTimes(1);
  });

  it("handles rapid sequential imports", async () => {
    const builder = makeBuilder();
    hoisted.createAgent.mockReturnValue(builder);

    for (let i = 0; i < 3; i += 1) {
      await runModule();
      vi.resetModules();
    }

    expect(hoisted.createAgent).toHaveBeenCalledTimes(3);
    expect(builder.useCicada).toHaveBeenCalledTimes(3);
    expect(builder.useBacktrack).toHaveBeenCalledTimes(3);
  });
});
