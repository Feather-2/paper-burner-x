import { describe, expect, it, vi } from 'vitest';

import { AgentBuilder, createAgent } from '../../../js/agents/sdk/AgentBuilder.js';

describe('agents/sdk AgentBuilder', () => {
  it('createAgent() returns an AgentBuilder and forwards options', () => {
    const builder = createAgent({ actor: 'tester' });
    expect(builder).toBeInstanceOf(AgentBuilder);

    // AgentBuilder stores AgentConfig internally; validate that options were forwarded.
    expect(builder._config.actor).toBe('tester');
    expect(builder._config.options.actor).toBe('tester');
  });

  it('exposes a fluent API that delegates to AgentConfig', () => {
    const builder = new AgentBuilder({ actor: 'test' });

    const spies = {
      useCapability: vi.spyOn(builder._config, 'useCapability'),
      useCapabilities: vi.spyOn(builder._config, 'useCapabilities'),
      useHook: vi.spyOn(builder._config, 'useHook'),
      useMcp: vi.spyOn(builder._config, 'useMcp'),
      useCicada: vi.spyOn(builder._config, 'useCicada'),
      useBacktrack: vi.spyOn(builder._config, 'useBacktrack'),
      useWatchdog: vi.spyOn(builder._config, 'useWatchdog'),
      useDiscovery: vi.spyOn(builder._config, 'useDiscovery'),
      useAlertMonitor: vi.spyOn(builder._config, 'useAlertMonitor'),
      onEvent: vi.spyOn(builder._config, 'onEvent'),
      setActor: vi.spyOn(builder._config, 'setActor'),
      useSubagent: vi.spyOn(builder._config, 'useSubagent'),
    };

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
      .useBacktrack({ maxSteps: 3 })
      .useWatchdog({ maxIterations: 5 })
      .useDiscovery({ enabled: true })
      .useAlertMonitor({ maxWarnings: 1 })
      .onEvent('sdk.test.event', onEventHandler)
      .actor('actor2')
      .useSubagent('Explore', subagentFactory, 'desc');

    expect(chain).toBe(builder);

    expect(spies.useCapability).toHaveBeenCalledWith('Echo', echoHandler);
    expect(spies.useCapability).toHaveBeenCalledWith('Lazy', lazyCap);
    expect(spies.useCapabilities).toHaveBeenCalledWith({ Extra: expect.any(Function) });
    expect(spies.useHook).toHaveBeenCalledWith('before', beforeHook);
    expect(spies.useHook).toHaveBeenCalledWith('after', afterHook);
    expect(spies.useMcp).toHaveBeenCalledWith({ provider: 'local' });
    expect(spies.useCicada).toHaveBeenCalledWith({ enabled: true });
    expect(spies.useBacktrack).toHaveBeenCalledWith({ maxSteps: 3 });
    expect(spies.useWatchdog).toHaveBeenCalledWith({ maxIterations: 5 });
    expect(spies.useDiscovery).toHaveBeenCalledWith({ enabled: true });
    expect(spies.useAlertMonitor).toHaveBeenCalledWith({ maxWarnings: 1 });
    expect(spies.onEvent).toHaveBeenCalledWith('sdk.test.event', onEventHandler);
    expect(spies.setActor).toHaveBeenCalledWith('actor2');
    expect(spies.useSubagent).toHaveBeenCalledWith('Explore', subagentFactory, 'desc');
  });

  it('build() calls AgentFactory.create(config) and returns its result', () => {
    const builder = new AgentBuilder({ actor: 'builder' });

    const fakeAgent = { kind: 'agent-instance' };
    const createSpy = vi.spyOn(builder._factory, 'create').mockReturnValue(fakeAgent);

    expect(builder.build()).toBe(fakeAgent);
    expect(createSpy).toHaveBeenCalledWith(builder._config);
  });
});

