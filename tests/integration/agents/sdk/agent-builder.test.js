import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      this.actor = options.actor;

      // Methods that AgentBuilder delegates to.
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

  // Re-exported by AgentBuilder.js (not used by these tests, but required by module shape).
  class AgentInstance {}

  return { AgentFactory, AgentInstance, instances };
});

vi.mock('../../../js/agents/shared/utils/logger.js', () => mockedLogger);
vi.mock('../../../js/agents/sdk/agent-config.js', () => ({ AgentConfig: mockedAgentConfig.AgentConfig }));
vi.mock('../../../js/agents/sdk/agent-factory.js', () => ({
  AgentFactory: mockedAgentFactory.AgentFactory,
  AgentInstance: mockedAgentFactory.AgentInstance,
}));

describe('agents/sdk AgentBuilder', () => {
  beforeEach(() => {
    mockedAgentConfig.instances.length = 0;
    mockedAgentFactory.instances.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('createAgent() returns an AgentBuilder and forwards options to AgentConfig', async () => {
    const { AgentBuilder, createAgent } = await import('../../../../js/agents/sdk/AgentBuilder.js');

    const builder = createAgent({ actor: 'tester', some: 'opt' });
    expect(builder).toBeInstanceOf(AgentBuilder);

    expect(mockedAgentConfig.ctor).toHaveBeenCalledWith({ actor: 'tester', some: 'opt' });
    expect(mockedAgentConfig.instances).toHaveLength(1);
    expect(builder._config).toBe(mockedAgentConfig.instances[0]);
    expect(mockedAgentFactory.instances).toHaveLength(1);
  });

  it('exposes a fluent API that delegates to AgentConfig and returns `this`', async () => {
    const { AgentBuilder } = await import('../../../../js/agents/sdk/AgentBuilder.js');

    const builder = new AgentBuilder({ actor: 'test' });

    const beforeHook = vi.fn(async () => {});
    const afterHook = vi.fn(async () => {});
    const onEventHandler = vi.fn();
    const subagentFactory = vi.fn(async () => ({ run: vi.fn(async () => ({ ok: true })) }));

    const echoHandler = vi.fn(async (args) => ({ echo: args.text }));
    const lazyCap = {
      definition: { name: 'Lazy', description: 'lazy', lazy: true },
      handler: vi.fn(async () => ({ ok: true })),
    };

    const chain = builder
      .useCapability('Echo', echoHandler)
      .useCapability('Lazy', lazyCap)
      .useCapabilities({ Extra: vi.fn(async () => ({ ok: true })) })
      .useHook('before', beforeHook)
      .useHook('after', afterHook)
      .useMcp({ provider: 'local' })
      .useCicada({ enabled: true })
      .useBacktrack()
      .useWatchdog()
      .useDiscovery()
      .useAlertMonitor()
      .onEvent('sdk.test.event', onEventHandler)
      .actor('actor2')
      .useSubagent('Explore', subagentFactory)
      .useSubagent('Write', subagentFactory, 'desc');

    expect(chain).toBe(builder);

    expect(builder._config.useCapability).toHaveBeenCalledWith('Echo', echoHandler);
    expect(builder._config.useCapability).toHaveBeenCalledWith('Lazy', lazyCap);
    expect(builder._config.useCapabilities).toHaveBeenCalledWith({ Extra: expect.any(Function) });
    expect(builder._config.useHook).toHaveBeenCalledWith('before', beforeHook);
    expect(builder._config.useHook).toHaveBeenCalledWith('after', afterHook);
    expect(builder._config.useMcp).toHaveBeenCalledWith({ provider: 'local' });
    expect(builder._config.useCicada).toHaveBeenCalledWith({ enabled: true });
    expect(builder._config.useBacktrack).toHaveBeenCalledWith({});
    expect(builder._config.useWatchdog).toHaveBeenCalledWith({});
    expect(builder._config.useDiscovery).toHaveBeenCalledWith({});
    expect(builder._config.useAlertMonitor).toHaveBeenCalledWith({});
    expect(builder._config.onEvent).toHaveBeenCalledWith('sdk.test.event', onEventHandler);
    expect(builder._config.setActor).toHaveBeenCalledWith('actor2');
    expect(builder._config.useSubagent).toHaveBeenCalledWith('Explore', subagentFactory, '');
    expect(builder._config.useSubagent).toHaveBeenCalledWith('Write', subagentFactory, 'desc');
  });

  it('build() calls AgentFactory.create(config) and returns its result', async () => {
    const { AgentBuilder } = await import('../../../../js/agents/sdk/AgentBuilder.js');

    const builder = new AgentBuilder({ actor: 'builder' });

    const fakeAgent = { kind: 'agent-instance' };
    builder._factory.create.mockReturnValue(fakeAgent);

    expect(builder.build()).toBe(fakeAgent);
    expect(builder._factory.create).toHaveBeenCalledWith(builder._config);
  });
});
