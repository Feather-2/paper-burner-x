import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = "../../../../js/agents/cli/test-memory.js";

const mockRuntime = vi.hoisted(() => {
  const data = {
    runImpl: null,
    stateThrow: null,
    agentConstructorArgs: [],
    agentRunCalls: [],
    stateConstructorArgs: [],
    stateInstances: [],
    eventBusInstances: [],
    modelRouterInstances: [],
    getClientCalls: [],
    chatCalls: [],
  };

  return {
    data,
    reset() {
      data.runImpl = null;
      data.stateThrow = null;
      data.agentConstructorArgs.length = 0;
      data.agentRunCalls.length = 0;
      data.stateConstructorArgs.length = 0;
      data.stateInstances.length = 0;
      data.eventBusInstances.length = 0;
      data.modelRouterInstances.length = 0;
      data.getClientCalls.length = 0;
      data.chatCalls.length = 0;
    },
  };
});

vi.mock("../../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js", () => ({
  default: class MockDeepSearchAgentLoop {
    constructor(options) {
      mockRuntime.data.agentConstructorArgs.push(options);
    }

    async run(state, { stageApi }) {
      mockRuntime.data.agentRunCalls.push({ state, stageApi });
      if (mockRuntime.data.runImpl) {
        return await mockRuntime.data.runImpl(state, stageApi);
      }
      return { status: "ok", report: { id: "mock-report" } };
    }
  },
}));

vi.mock("../../../../js/agents/stages/deepsearch/state.js", () => ({
  DeepSearchState: class MockDeepSearchState {
    constructor(args) {
      if (mockRuntime.data.stateThrow) {
        throw mockRuntime.data.stateThrow;
      }
      this.taskGoal = args?.taskGoal;
      this.L0 = args?.L0;
      mockRuntime.data.stateConstructorArgs.push(args);
      mockRuntime.data.stateInstances.push(this);
    }
  },
}));

vi.mock("../../../../js/agents/core/event-bus.js", () => ({
  EventBus: class MockEventBus {
    constructor() {
      this.subscriptions = [];
      this.emit = vi.fn((name, payload) => {
        this.subscriptions.forEach((sub) => {
          if (sub.pattern === "*" || sub.pattern === name) {
            sub.handler(payload, { name });
          }
        });
      });
      mockRuntime.data.eventBusInstances.push(this);
    }

    subscribe(pattern, handler) {
      this.subscriptions.push({ pattern, handler });
    }
  },
}));

vi.mock("../../../../js/agents/cli/model-client.js", () => ({
  CliModelRouter: class MockCliModelRouter {
    constructor() {
      this.getClient = vi.fn((usage) => {
        const chat = vi.fn(async (payload) => {
          mockRuntime.data.chatCalls.push({ usage, payload });
          return { ok: true, usage, payload };
        });
        const client = { chat };
        mockRuntime.data.getClientCalls.push({ usage, client });
        return client;
      });
      mockRuntime.data.modelRouterInstances.push(this);
    }
  },
}));

const buildDeepNested = (depth) => {
  let node = { level: depth };
  for (let i = 0; i < depth; i += 1) {
    node = { next: node };
  }
  return node;
};

describe("test-memory module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    mockRuntime.reset();
    process.exitCode = undefined;
    vi.spyOn(process, "exit").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("initializes dependencies and runs agent loop", async () => {
    const runSpy = vi.fn(async (state, stageApi) => {
      await stageApi.modelRouter.call([{ role: "user", content: "hi" }]);
      stageApi.emit("deepsearch:agent:started", { ok: true });
      return { status: "ok", report: { id: "r1" } };
    });
    mockRuntime.data.runImpl = runSpy;

    await import(modulePath);

    expect(mockRuntime.data.eventBusInstances).toHaveLength(1);
    const eventBus = mockRuntime.data.eventBusInstances[0];
    expect(eventBus.subscriptions).toHaveLength(1);
    expect(eventBus.subscriptions[0].pattern).toBe("*");

    expect(mockRuntime.data.modelRouterInstances).toHaveLength(1);
    expect(mockRuntime.data.agentConstructorArgs).toHaveLength(1);
    expect(mockRuntime.data.agentConstructorArgs[0]).toMatchObject({
      eventBus,
      mode: "quick",
      maxIterations: 5,
    });

    expect(mockRuntime.data.stateConstructorArgs).toHaveLength(1);
    const stateArgs = mockRuntime.data.stateConstructorArgs[0];
    expect(stateArgs).toMatchObject({
      taskGoal: expect.any(String),
      L0: { sources: expect.any(Array) },
    });
    expect(stateArgs.L0.sources).toHaveLength(1);
    expect(stateArgs.L0.sources[0]).toMatchObject({
      id: "test-doc-1",
      type: "markdown",
    });
    expect(String(stateArgs.L0.sources[0].name)).toMatch(/\.md$/);

    expect(mockRuntime.data.agentRunCalls).toHaveLength(1);
    const runCall = mockRuntime.data.agentRunCalls[0];
    expect(runCall.state).toBe(mockRuntime.data.stateInstances[0]);
    expect(runCall.stageApi.eventBus).toBe(eventBus);
    expect(runCall.stageApi).toHaveProperty("signal");
    expect(runCall.stageApi.signal).toHaveProperty("aborted");

    expect(eventBus.emit).toHaveBeenCalledWith("deepsearch:agent:started", { ok: true });

    expect(mockRuntime.data.getClientCalls).toHaveLength(1);
    expect(mockRuntime.data.getClientCalls[0].usage).toBe("agent");
    expect(mockRuntime.data.chatCalls[0].payload.messages).toEqual([
      { role: "user", content: "hi" },
    ]);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("logs event names that include iteration/completed/started", async () => {
    mockRuntime.data.runImpl = async () => ({ status: "ok", report: null });

    await import(modulePath);

    const eventBus = mockRuntime.data.eventBusInstances[0];
    eventBus.emit("deepsearch:agent:iteration", {});
    eventBus.emit("deepsearch:agent:completed", {});
    eventBus.emit("deepsearch:agent:started", {});
    eventBus.emit("deepsearch:agent:paused", {});

    const eventLogs = console.log.mock.calls
      .map((call) => call[0])
      .filter((entry) => typeof entry === "string" && entry.startsWith("[Event] "));

    expect(eventLogs).toEqual(
      expect.arrayContaining([
        "[Event] deepsearch:agent:iteration",
        "[Event] deepsearch:agent:completed",
        "[Event] deepsearch:agent:started",
      ]),
    );
    expect(eventLogs).not.toContain("[Event] deepsearch:agent:paused");
  });

  it("logs agent run errors without throwing", async () => {
    mockRuntime.data.runImpl = async () => {
      throw new Error("boom");
    };

    await import(modulePath);

    const errorCalls = console.error.mock.calls;
    expect(errorCalls.some((call) => call[1] === "boom")).toBe(true);
    expect(errorCalls.some((call) => typeof call[0] === "string" && call[0].includes("Error: boom"))).toBe(
      true,
    );
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("uses the top-level catch when initialization fails", async () => {
    mockRuntime.data.stateThrow = new Error("state failed");

    await import(modulePath);

    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(
      console.error.mock.calls.some(
        (call) => call[0] === "Error:" && call[1] === "state failed",
      ),
    ).toBe(true);
  });

  it("passes boundary values into modelRouter calls", async () => {
    const longText = "l".repeat(10000);
    const largeText = "f".repeat(1024 * 1024);
    const deepNested = buildDeepNested(48);
    const arrayLike = { 0: "x", length: 1 };
    const calls = [
      { messages: null, opts: { usage: undefined }, expectedUsage: "agent" },
      { messages: undefined, opts: { usage: null }, expectedUsage: "agent" },
      { messages: "", opts: { usage: "" }, expectedUsage: "agent" },
      { messages: [], opts: { usage: 0 }, expectedUsage: "agent" },
      { messages: {}, opts: { usage: -1 }, expectedUsage: -1 },
      { messages: "   ", opts: { usage: "   " }, expectedUsage: "   " },
      { messages: arrayLike, opts: { usage: "123" }, expectedUsage: "123" },
      { messages: deepNested, opts: { usage: Number.MAX_SAFE_INTEGER }, expectedUsage: Number.MAX_SAFE_INTEGER },
      { messages: [{ role: "user", content: longText }], opts: { usage: "agent" }, expectedUsage: "agent" },
      { messages: [{ role: "user", content: largeText }], opts: { usage: "agent" }, expectedUsage: "agent" },
    ];

    mockRuntime.data.runImpl = async () => ({ status: "ok", report: null });

    await import(modulePath);

    const stageApi = mockRuntime.data.agentRunCalls[0]?.stageApi;
    expect(stageApi).toBeDefined();
    for (const entry of calls) {
      await stageApi.modelRouter.call(entry.messages, entry.opts);
    }

    expect(mockRuntime.data.getClientCalls).toHaveLength(calls.length);
    expect(mockRuntime.data.chatCalls).toHaveLength(calls.length);
    calls.forEach((entry, index) => {
      expect(mockRuntime.data.getClientCalls[index].usage).toBe(entry.expectedUsage);
      expect(mockRuntime.data.chatCalls[index].payload.messages).toBe(entry.messages);
    });
    expect(longText.length).toBeGreaterThan(9999);
    expect(largeText.length).toBeGreaterThan(999999);
  });

  it("handles concurrent and rapid modelRouter calls", async () => {
    mockRuntime.data.runImpl = async (state, stageApi) => {
      const concurrent = [
        stageApi.modelRouter.call([{ role: "user", content: "c1" }], { usage: "concurrent" }),
        stageApi.modelRouter.call([{ role: "user", content: "c2" }], { usage: "concurrent" }),
      ];

      for (let i = 0; i < 3; i += 1) {
        await stageApi.modelRouter.call(
          [{ role: "user", content: `fast-${i}` }],
          { usage: "fast" },
        );
      }

      await Promise.all(concurrent);
      return { status: "ok", report: null };
    };

    await import(modulePath);

    expect(mockRuntime.data.getClientCalls).toHaveLength(5);
    const contents = mockRuntime.data.chatCalls.map((entry) => {
      const messages = entry.payload.messages;
      if (Array.isArray(messages) && messages[0]?.content) return messages[0].content;
      return null;
    });
    expect(contents).toEqual(
      expect.arrayContaining(["c1", "c2", "fast-0", "fast-1", "fast-2"]),
    );
  });
});
