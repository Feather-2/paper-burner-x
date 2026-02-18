import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedLogger = vi.hoisted(() => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockedAgentConfig = vi.hoisted(() => {
  const instances = [];
  const ctor = vi.fn();

  class AgentConfig {
    constructor(options = {}) {
      ctor(options);
      this.options = options;
      this.useCapability = vi.fn();
      this.useCapabilities = vi.fn();
      this.useHook = vi.fn();
      this.useMcp = vi.fn();
      this.useCicada = vi.fn();
      this.useBacktrack = vi.fn();
      this.useWatchdog = vi.fn();
      this.useDiscovery = vi.fn();
      this.useAlertMonitor = vi.fn();
      this.onEvent = vi.fn();
      this.setActor = vi.fn();
      this.useSubagent = vi.fn();
      instances.push(this);
    }
  }

  return { AgentConfig, ctor, instances };
});

const mockedAgentFactory = vi.hoisted(() => {
  const instances = [];

  class AgentFactory {
    constructor() {
      this.create = vi.fn();
      instances.push(this);
    }
  }

  class AgentInstance {}

  return { AgentFactory, AgentInstance, instances };
});

vi.mock("../../../../js/agents/shared/index.js", () => mockedLogger);
vi.mock("../../../../js/agents/sdk/agent-config.js", () => ({
  AgentConfig: mockedAgentConfig.AgentConfig,
}));
vi.mock("../../../../js/agents/sdk/agent-factory.js", () => ({
  AgentFactory: mockedAgentFactory.AgentFactory,
  AgentInstance: mockedAgentFactory.AgentInstance,
}));

const loadModule = async () => import("../../../../js/agents/sdk/AgentBuilder.js");

beforeEach(() => {
  mockedAgentConfig.instances.length = 0;
  mockedAgentFactory.instances.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("AgentBuilder", () => {
  it("constructs config/factory and forwards options", async () => {
    const { AgentBuilder } = await loadModule();

    const options = { actor: "tester", extra: { enabled: true } };
    const builder = new AgentBuilder(options);

    expect(mockedLogger.createLogger).toHaveBeenCalledWith("sdk/AgentBuilder");
    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith(options);
    expect(mockedAgentConfig.instances).toHaveLength(1);
    expect(builder._config).toBe(mockedAgentConfig.instances[0]);
    expect(mockedAgentFactory.instances).toHaveLength(1);
    expect(builder._factory).toBe(mockedAgentFactory.instances[0]);
  });

  it("delegates fluent methods and returns this on the happy path", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder({ actor: "init" });

    const beforeHook = vi.fn();
    const afterHook = vi.fn();
    const onEventHandler = vi.fn();
    const subagentFactory = vi.fn();
    const echoHandler = vi.fn();
    const lazyCapability = {
      definition: { name: "Lazy", description: "lazy" },
      handler: vi.fn(),
    };

    const chain = builder
      .useCapability("Echo", echoHandler)
      .useCapability("Lazy", lazyCapability)
      .useCapabilities({ Extra: vi.fn() })
      .useHook("before", beforeHook)
      .useHook("after", afterHook)
      .useMcp({ provider: "local" })
      .useCicada({ enabled: true })
      .onEvent("sdk:test.event", onEventHandler)
      .actor("actor2")
      .useSubagent("Explore", subagentFactory)
      .useSubagent("Write", subagentFactory, "desc");

    expect(chain).toBe(builder);
    expect(builder._config.useCapability).toHaveBeenCalledWith("Echo", echoHandler);
    expect(builder._config.useCapability).toHaveBeenCalledWith("Lazy", lazyCapability);
    expect(builder._config.useCapabilities).toHaveBeenCalledWith({ Extra: expect.any(Function) });
    expect(builder._config.useHook).toHaveBeenCalledWith("before", beforeHook);
    expect(builder._config.useHook).toHaveBeenCalledWith("after", afterHook);
    expect(builder._config.useMcp).toHaveBeenCalledWith({ provider: "local" });
    expect(builder._config.useCicada).toHaveBeenCalledWith({ enabled: true });
    expect(builder._config.onEvent).toHaveBeenCalledWith("sdk:test.event", onEventHandler);
    expect(builder._config.setActor).toHaveBeenCalledWith("actor2");
    expect(builder._config.useSubagent).toHaveBeenCalledWith("Explore", subagentFactory, "");
    expect(builder._config.useSubagent).toHaveBeenCalledWith("Write", subagentFactory, "desc");
  });

  it("forwards boundary values and resource-heavy inputs", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder();
    const handler = vi.fn();
    const largeString = "x".repeat(512 * 1024);
    const deepConfig = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: { value: "deep" },
              },
            },
          },
        },
      },
    };

    builder
      .useCapability("", null)
      .useCapability("   ", handler)
      .useCapability(0, handler)
      .useCapability(-1, handler)
      .useCapability(Number.MAX_SAFE_INTEGER, handler)
      .useCapabilities({})
      .useCapabilities([])
      .useMcp(null)
      .useCicada(undefined)
      .useBacktrack()
      .useWatchdog({})
      .useDiscovery({ deep: deepConfig })
      .useAlertMonitor({ payload: largeString })
      .onEvent("", handler)
      .onEvent("   ", handler)
      .onEvent(0, handler)
      .onEvent(largeString, handler)
      .actor("")
      .actor("   ")
      .actor(0)
      .actor(-1)
      .actor(Number.MAX_SAFE_INTEGER)
      .useSubagent("", handler, undefined)
      .useSubagent("Huge", handler, largeString);

    expect(builder._config.useCapability).toHaveBeenCalledWith("", null);
    expect(builder._config.useCapability).toHaveBeenCalledWith("   ", handler);
    expect(builder._config.useCapability).toHaveBeenCalledWith(0, handler);
    expect(builder._config.useCapability).toHaveBeenCalledWith(-1, handler);
    expect(builder._config.useCapability).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, handler);
    expect(builder._config.useCapabilities).toHaveBeenCalledWith({});
    expect(builder._config.useCapabilities).toHaveBeenCalledWith([]);
    expect(builder._config.useMcp).toHaveBeenCalledWith(null);
    expect(builder._config.useCicada).toHaveBeenCalledWith(undefined);
    expect(builder._config.useBacktrack).toHaveBeenCalledWith({});
    expect(builder._config.useWatchdog).toHaveBeenCalledWith({});
    expect(builder._config.useDiscovery).toHaveBeenCalledWith({ deep: deepConfig });
    expect(builder._config.useAlertMonitor).toHaveBeenCalledWith({ payload: largeString });
    expect(builder._config.onEvent).toHaveBeenCalledWith("", handler);
    expect(builder._config.onEvent).toHaveBeenCalledWith("   ", handler);
    expect(builder._config.onEvent).toHaveBeenCalledWith(0, handler);
    expect(builder._config.onEvent).toHaveBeenCalledWith(largeString, handler);
    expect(builder._config.setActor).toHaveBeenCalledWith("");
    expect(builder._config.setActor).toHaveBeenCalledWith("   ");
    expect(builder._config.setActor).toHaveBeenCalledWith(0);
    expect(builder._config.setActor).toHaveBeenCalledWith(-1);
    expect(builder._config.setActor).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
    expect(builder._config.useSubagent).toHaveBeenCalledWith("", handler, "");
    expect(builder._config.useSubagent).toHaveBeenCalledWith("Huge", handler, largeString);
  });

  it("forwards type boundary inputs without coercion", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder();
    const handler = vi.fn();
    const stringNumber = "42";
    const arrayLike = { 0: handler, length: 1 };
    const arrayLikeCapabilities = { 0: { definition: { name: "Arr" }, handler }, length: 1 };
    const objectName = { name: "not-a-string" };

    builder.useBacktrack({ depth: stringNumber });
    builder.useCapabilities(arrayLikeCapabilities);
    builder.useHook(stringNumber, "not a function");
    builder.useCapability(objectName, arrayLike);

    expect(builder._config.useBacktrack).toHaveBeenCalledWith({ depth: stringNumber });
    expect(builder._config.useCapabilities).toHaveBeenCalledWith(arrayLikeCapabilities);
    expect(builder._config.useHook).toHaveBeenCalledWith(stringNumber, "not a function");
    expect(builder._config.useCapability).toHaveBeenCalledWith(objectName, arrayLike);
  });

  it("supports concurrent and rapid calls", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder();
    const handler = vi.fn();

    const concurrentCalls = Array.from({ length: 6 }, (_, index) =>
      Promise.resolve().then(() => builder.useCapability(`Cap${index}`, handler))
    );

    await Promise.all(concurrentCalls);

    for (let i = 0; i < 20; i += 1) {
      builder.onEvent(`event:${i}`, handler);
    }

    expect(builder._config.useCapability).toHaveBeenCalledTimes(6);
    expect(builder._config.onEvent).toHaveBeenCalledTimes(20);
  });

  it("build() calls AgentFactory.create with config and returns result", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder({ actor: "builder" });
    const fakeAgent = { kind: "agent-instance" };
    builder._factory.create.mockReturnValue(fakeAgent);

    expect(builder.build()).toBe(fakeAgent);
    expect(builder._factory.create).toHaveBeenCalledWith(builder._config);
  });

  it("propagates errors from AgentConfig delegates", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder();
    const error = new Error("config boom");
    builder._config.useCapability.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => builder.useCapability("Bad", vi.fn())).toThrow(error);
  });

  it("propagates errors from AgentFactory.create", async () => {
    const { AgentBuilder } = await loadModule();

    const builder = new AgentBuilder();
    const error = new Error("factory boom");
    builder._factory.create.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => builder.build()).toThrow(error);
  });
});

describe("createAgent", () => {
  it("returns AgentBuilder and forwards options", async () => {
    const { AgentBuilder, createAgent } = await loadModule();

    const builderDefault = createAgent();
    const builderNull = createAgent(null);

    expect(builderDefault).toBeInstanceOf(AgentBuilder);
    expect(builderNull).toBeInstanceOf(AgentBuilder);
    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith({});
    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith(null);
  });

  it("propagates constructor errors", async () => {
    const { createAgent } = await loadModule();

    const error = new Error("constructor failed");
    mockedAgentConfig.ctor.mockImplementationOnce(() => {
      throw error;
    });

    expect(() => createAgent({ actor: "boom" })).toThrow(error);
  });
});

describe("createAgentBuilder", () => {
  it("returns AgentBuilder and mirrors createAgent semantics", async () => {
    const { AgentBuilder, createAgentBuilder } = await loadModule();

    const builderDefault = createAgentBuilder();
    const builderNull = createAgentBuilder(null);

    expect(builderDefault).toBeInstanceOf(AgentBuilder);
    expect(builderNull).toBeInstanceOf(AgentBuilder);
    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith({});
    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith(null);
  });
});

describe("AgentInstance", () => {
  it("re-exports AgentInstance from agent-factory", async () => {
    const module = await loadModule();

    expect(module.AgentInstance).toBe(mockedAgentFactory.AgentInstance);
    expect(module.default.AgentInstance).toBe(mockedAgentFactory.AgentInstance);
    expect(module.default.createAgentBuilder).toBe(module.createAgentBuilder);
  });
});
