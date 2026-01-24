import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  ProcessTransportMock,
  transportInstances,
  buildTransportInstance,
} = vi.hoisted(() => {
  const transportInstances = [];
  const buildTransportInstance = (options) => {
    const handlers = new Map();
    const instance = {
      options,
      on: vi.fn((event, handler) => {
        const list = handlers.get(event) || [];
        list.push(handler);
        handlers.set(event, list);
      }),
      emit: (event, payload) => {
        const list = handlers.get(event) || [];
        for (const handler of list) {
          handler(payload);
        }
      },
      connect: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
      isConnected: vi.fn(() => true),
      disconnect: vi.fn(),
    };
    transportInstances.push(instance);
    return instance;
  };
  const ProcessTransportMock = vi.fn(function ProcessTransportMock(options) {
    return buildTransportInstance(options);
  });
  return { ProcessTransportMock, transportInstances, buildTransportInstance };
});

vi.mock('../../../../../js/agents/plugins/transports/process-transport.js', () => ({
  ProcessTransport: ProcessTransportMock,
}));

import {
  BinarySkillProvider,
  createBinarySkillProvider,
} from '../../../../../js/agents/plugins/transports/binary-skill-provider.js';

const createDeepNested = (depth) => {
  let current = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    current = { level: current };
  }
  return current;
};

describe('BinarySkillProvider', () => {
  let eventBus;
  let serviceBus;
  let logger;

  beforeEach(() => {
    transportInstances.length = 0;
    ProcessTransportMock.mockClear();
    eventBus = { emit: vi.fn() };
    serviceBus = { register: vi.fn() };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    vi.useRealTimers();
  });

  it('constructs with defaults and empty options', () => {
    const provider = new BinarySkillProvider();
    expect(provider.skills).toEqual([]);
    expect(provider.eventBus).toBe(null);
    expect(provider.serviceBus).toBe(null);
    expect(provider.logger).toBe(null);
    expect(provider._connections.size).toBe(0);
    expect(provider._initialized).toBe(false);
    expect(provider._shuttingDown).toBe(false);
    expect(provider._retryCount.size).toBe(0);
    expect(provider._maxRetries).toBe(5);
  });

  it('throws when constructed with null options', () => {
    expect(() => new BinarySkillProvider(null)).toThrow();
  });

  it('initializes skills and emits ready once', async () => {
    const skills = [
      { name: 'alpha', command: 'cmd-a' },
      { name: 'beta', command: 'cmd-b', timeout: 15000 },
    ];
    const provider = new BinarySkillProvider({ skills, eventBus, serviceBus, logger });

    await provider.initialize();

    expect(ProcessTransportMock).toHaveBeenCalledTimes(2);
    expect(provider._initialized).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:provider:ready',
      { actor: 'binary-provider', status: 'info', payload: { skills: ['alpha', 'beta'] } },
    );

    const callsAfterFirst = ProcessTransportMock.mock.calls.length;
    await provider.initialize();
    expect(ProcessTransportMock).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('initSkill connects, registers service, and handles transport events', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    const config = {
      name: 'alpha',
      command: 'cmd',
      args: ['--flag'],
      env: { FOO: 'bar' },
      cwd: '/tmp',
      timeout: 0,
    };

    await provider._initSkill(config);

    expect(ProcessTransportMock).toHaveBeenCalledWith({
      command: 'cmd',
      args: ['--flag'],
      env: { FOO: 'bar' },
      cwd: '/tmp',
      timeout: 30000,
    });

    const transport = transportInstances[0];
    expect(provider._connections.get('alpha').transport).toBe(transport);

    expect(serviceBus.register).toHaveBeenCalledTimes(1);
    const [registeredName, service] = serviceBus.register.mock.calls[0];
    expect(registeredName).toBe('alpha');
    expect(service.name).toBe('alpha');

    transport.request.mockResolvedValueOnce({ ok: true });
    await expect(service.call('ping', { value: 'test' })).resolves.toEqual({ ok: true });
    expect(transport.request).toHaveBeenCalledWith('ping', { value: 'test' });

    service.notify('notice', { value: 1 });
    expect(transport.notify).toHaveBeenCalledWith('notice', { value: 1 });

    transport.isConnected.mockReturnValueOnce(false);
    expect(service.isConnected()).toBe(false);

    transport.emit('transport:message', { method: 'hello', params: { a: 1 } });
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:alpha:message',
      { actor: 'binary-provider', status: 'info', payload: { method: 'hello', params: { a: 1 } } },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:alpha:hello',
      { actor: 'binary-provider', status: 'info', payload: { a: 1 } },
    );

    transport.emit('transport:stderr', 'stderr text');
    expect(logger.debug).toHaveBeenCalledWith('[alpha] stderr text');

    transport.emit('transport:error', new Error('boom'));
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:alpha:error',
      { actor: 'binary-provider', status: 'info', payload: { error: 'boom' } },
    );

    transport.emit('transport:exit', { code: 0, signal: null });
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:alpha:exit',
      { actor: 'binary-provider', status: 'info', payload: { code: 0, signal: null } },
    );
    expect(provider._connections.has('alpha')).toBe(false);
    expect(provider._retryCount.has('alpha')).toBe(false);

    expect(logger.info).toHaveBeenCalledWith('Binary skill connected: alpha');
  });

  it('passes allowlist options through to ProcessTransport', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    const config = {
      name: 'alpha',
      command: 'cmd',
      args: ['--flag'],
      env: { FOO: 'bar' },
      cwd: '/tmp',
      timeout: 0,
      allowedCommands: ['cmd'],
      allowedCwdRoots: ['/tmp'],
      allowedEnvKeys: ['FOO'],
    };

    await provider._initSkill(config);

    expect(ProcessTransportMock).toHaveBeenCalledWith({
      command: 'cmd',
      args: ['--flag'],
      env: { FOO: 'bar' },
      cwd: '/tmp',
      timeout: 30000,
      allowedCommands: ['cmd'],
      allowedCwdRoots: ['/tmp'],
      allowedEnvKeys: ['FOO'],
    });
  });

  it('logs and rethrows connection errors during initSkill', async () => {
    ProcessTransportMock.mockImplementationOnce(function ProcessTransportMockOnce(options) {
      const instance = buildTransportInstance(options);
      instance.connect.mockRejectedValueOnce(new Error('connect-failed'));
      return instance;
    });

    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    const config = { name: 'broken', command: 'cmd' };

    await expect(provider._initSkill(config)).rejects.toThrow('connect-failed');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to connect binary skill: broken',
      expect.any(Error),
    );
  });

  it('auto-reconnects with exponential backoff', async () => {
    vi.useFakeTimers();
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    const config = { name: 'reconnect', command: 'cmd', autoReconnect: true };
    const initSpy = vi.spyOn(provider, '_initSkill');
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await provider._initSkill(config);
    const transport = transportInstances[0];

    transport.emit('transport:exit', { code: 1, signal: 'SIGTERM' });

    expect(provider._retryCount.get('reconnect')).toBe(1);
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(transportInstances.length).toBe(2);

    vi.useRealTimers();
  });

  it('stops reconnecting after max retries and during shutdown', async () => {
    vi.useFakeTimers();
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    provider._maxRetries = 1;
    const config = { name: 'retry', command: 'cmd', autoReconnect: true };
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await provider._initSkill(config);
    const firstTransport = transportInstances[0];
    firstTransport.emit('transport:exit', { code: 1, signal: null });

    await vi.advanceTimersByTimeAsync(1000);

    const secondTransport = transportInstances[1];
    const callsBefore = timeoutSpy.mock.calls.length;
    secondTransport.emit('transport:exit', { code: 1, signal: null });

    expect(logger.warn).toHaveBeenCalledWith('Max reconnect attempts for retry');
    expect(provider._retryCount.has('retry')).toBe(false);
    expect(timeoutSpy.mock.calls.length).toBe(callsBefore);

    provider._shuttingDown = true;
    const callsBeforeShutdown = timeoutSpy.mock.calls.length;
    secondTransport.emit('transport:exit', { code: 0, signal: null });
    expect(timeoutSpy.mock.calls.length).toBe(callsBeforeShutdown);

    vi.useRealTimers();
  });

  it('creates service proxies with edge method values', async () => {
    const provider = new BinarySkillProvider();
    const transport = buildTransportInstance({ command: 'cmd' });
    const service = provider._createService('svc', transport);

    transport.request.mockResolvedValueOnce('ok');
    await expect(service.call('123', { value: 0 })).resolves.toBe('ok');
    expect(transport.request).toHaveBeenCalledWith('123', { value: 0 });

    service.notify('   ', { value: -1 });
    expect(transport.notify).toHaveBeenCalledWith('   ', { value: -1 });

    transport.isConnected.mockReturnValueOnce(true);
    expect(service.isConnected()).toBe(true);
  });

  it('calls skill methods and emits result or error', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    await provider._initSkill({ name: 'call', command: 'cmd' });
    const transport = transportInstances[0];

    transport.request.mockResolvedValueOnce({ ok: true });
    await expect(provider.call('call', 'run', { value: 0 })).resolves.toEqual({ ok: true });
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:call:call',
      { actor: 'binary-provider', status: 'info', payload: { method: 'run', params: { value: 0 } } },
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:call:result',
      { actor: 'binary-provider', status: 'info', payload: { method: 'run', result: { ok: true } } },
    );

    transport.request.mockRejectedValueOnce(new Error('bad'));
    await expect(provider.call('call', 'run', { value: -1 })).rejects.toThrow('bad');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'binary:call:error',
      { actor: 'binary-provider', status: 'info', payload: { method: 'run', error: 'bad' } },
    );
  });

  it('handles concurrent calls with boundary payloads', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    await provider._initSkill({ name: 'edge', command: 'cmd' });
    const transport = transportInstances[0];
    transport.request.mockImplementation((method, params) => Promise.resolve({ method, params }));

    const largeText = 'x'.repeat(20000);
    const largeFile = 'f'.repeat(100000);
    const deepNested = createDeepNested(12);

    const results = await Promise.all([
      provider.call('edge', 'run', {}),
      provider.call('edge', '123', { value: 0, text: '   ' }),
      provider.call('edge', -1, { value: -1, list: [] }),
      provider.call('edge', '', { value: Number.MAX_SAFE_INTEGER, content: largeText, file: largeFile, nested: deepNested }),
    ]);

    expect(results).toHaveLength(4);
    expect(transport.request).toHaveBeenCalledWith('run', {});
    expect(transport.request).toHaveBeenCalledWith('123', { value: 0, text: '   ' });
    expect(transport.request).toHaveBeenCalledWith(-1, { value: -1, list: [] });
    expect(transport.request).toHaveBeenCalledWith(
      '',
      { value: Number.MAX_SAFE_INTEGER, content: largeText, file: largeFile, nested: deepNested },
    );
  });

  it('throws for missing skill names including null, undefined, and empty strings', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });

    await expect(provider.call('missing', 'run', null)).rejects.toThrow('Binary skill not found: missing');
    await expect(provider.call('', 'run', {})).rejects.toThrow('Binary skill not found: ');
    await expect(provider.call('   ', 'run', {})).rejects.toThrow('Binary skill not found:    ');
    await expect(provider.call(null, 'run', null)).rejects.toThrow('Binary skill not found: null');
    await expect(provider.call(undefined, 'run', undefined)).rejects.toThrow('Binary skill not found: undefined');
  });

  it('returns connected skills and connection status', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    await provider._initSkill({ name: 'one', command: 'cmd' });

    const transport = transportInstances[0];
    transport.isConnected.mockReturnValueOnce(true);

    expect(provider.getConnectedSkills()).toEqual(['one']);
    expect(provider.isConnected('one')).toBe(true);
    expect(provider.isConnected('missing')).toBe(false);
  });

  it('builds tool definitions with default and custom methods', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    await provider._initSkill({
      name: 'tools',
      command: 'cmd',
      methods: ['run', 0, -1, Number.MAX_SAFE_INTEGER],
    });

    const callSpy = vi.spyOn(provider, 'call').mockResolvedValue('ok');
    const tools = provider.getToolDefinitions();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('tools.run');
    expect(names).toContain('tools.0');
    expect(names).toContain('tools.-1');
    expect(names).toContain(`tools.${Number.MAX_SAFE_INTEGER}`);

    const runTool = tools.find((tool) => tool.name === 'tools.run');
    await expect(runTool.handler({ value: 'test' }, {})).resolves.toBe('ok');
    expect(callSpy).toHaveBeenCalledWith('tools', 'run', { value: 'test' });
  });

  it('returns no tools for empty methods and throws for non-iterable methods', () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    const transport = buildTransportInstance({ command: 'cmd' });

    provider._connections.set('empty', {
      transport,
      config: { name: 'empty', command: 'cmd', methods: [] },
    });
    expect(provider.getToolDefinitions()).toEqual([]);

    provider._connections.set('bad', {
      transport,
      config: { name: 'bad', command: 'cmd', methods: {} },
    });
    expect(() => provider.getToolDefinitions()).toThrow();
  });

  it('shutdown disconnects transports and clears state', async () => {
    const provider = new BinarySkillProvider({ eventBus, serviceBus, logger });
    await provider._initSkill({ name: 'one', command: 'cmd' });
    await provider._initSkill({ name: 'two', command: 'cmd2' });

    provider._retryCount.set('one', 2);
    provider._initialized = true;

    await provider.shutdown();

    const disconnectPayload = { actor: 'binary-provider', status: 'info', payload: {} };
    expect(eventBus.emit).toHaveBeenCalledWith('binary:one:disconnected', disconnectPayload);
    expect(eventBus.emit).toHaveBeenCalledWith('binary:two:disconnected', disconnectPayload);
    expect(transportInstances[0].disconnect).toHaveBeenCalled();
    expect(transportInstances[1].disconnect).toHaveBeenCalled();
    expect(provider._connections.size).toBe(0);
    expect(provider._retryCount.size).toBe(0);
    expect(provider._initialized).toBe(false);
    expect(provider._shuttingDown).toBe(true);
  });

  it('emit is a no-op when eventBus emit is not a function', () => {
    const provider = new BinarySkillProvider({ eventBus: { emit: null } });
    expect(() => provider._emit('event', { value: 1 })).not.toThrow();
  });
});

describe('createBinarySkillProvider', () => {
  beforeEach(() => {
    transportInstances.length = 0;
    ProcessTransportMock.mockClear();
  });

  it('creates a BinarySkillProvider instance', () => {
    const provider = createBinarySkillProvider({ skills: [] });
    expect(provider).toBeInstanceOf(BinarySkillProvider);
  });
});
