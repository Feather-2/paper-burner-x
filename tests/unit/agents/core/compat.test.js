import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../js/agents/core/plugin.js', () => ({
  createPlugin: vi.fn(config => ({ ...config })),
}));

import { adaptProvider, isServiceProvider } from '../../../../js/agents/core/compat.js';
import { createPlugin } from '../../../../js/agents/core/plugin.js';

const mockedCreatePlugin = vi.mocked(createPlugin);

function createMockContext() {
  return {
    services: {
      register: vi.fn(),
      registerFactory: vi.fn(),
      get: vi.fn(),
    },
    events: {
      emit: vi.fn(),
      waitFor: vi.fn(),
    },
    on: vi.fn(),
    state: { active: true },
    log: { info: vi.fn() },
  };
}

function createDeepObject(depth) {
  let current = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    current = { nested: current };
  }
  return current;
}

beforeEach(() => {
  mockedCreatePlugin.mockClear();
  mockedCreatePlugin.mockImplementation(config => ({ ...config }));
});

describe('isServiceProvider', () => {
  it('returns false for empty, boundary, and mismatched types', () => {
    const cases = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      { 0: 'a', length: 1 },
    ];

    for (const value of cases) {
      expect(isServiceProvider(value)).toBe(false);
    }
  });

  it('returns false when install is present even with register', () => {
    const value = { register: () => {}, install: () => {} };
    expect(isServiceProvider(value)).toBe(false);
  });

  it('returns true for legacy provider objects with register only', () => {
    const provider = { register: vi.fn() };
    expect(isServiceProvider(provider)).toBe(true);
  });
});

describe('adaptProvider', () => {
  it('creates plugin config using provider name', () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);

    expect(mockedCreatePlugin).toHaveBeenCalledTimes(1);
    const config = mockedCreatePlugin.mock.calls[0][0];
    expect(plugin).toEqual(expect.objectContaining(config));
    expect(config.name).toBe('compat/legacy');
    expect(config.version).toBe('1.0.0');
    expect(config.description).toBe('Adapted from legacy ServiceProvider: legacy');
    expect(typeof config.install).toBe('function');
    expect(typeof config.onStart).toBe('function');
    expect(typeof config.onStop).toBe('function');
    expect(typeof config.uninstall).toBe('function');
  });

  it('falls back to constructor name when provider name is empty', () => {
    class LegacyProvider {
      register() {}
    }

    const provider = new LegacyProvider();
    provider.name = '';

    adaptProvider(provider);

    const config = mockedCreatePlugin.mock.calls[0][0];
    expect(config.name).toBe('compat/LegacyProvider');
    expect(config.description).toBe('Adapted from legacy ServiceProvider: LegacyProvider');
  });

  it('falls back to Date.now when no name or constructor is available', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    const provider = Object.create(null);
    provider.register = vi.fn();

    adaptProvider(provider);

    const config = mockedCreatePlugin.mock.calls[0][0];
    expect(config.name).toBe('compat/provider_12345');
    expect(config.description).toBe('Adapted from legacy ServiceProvider: provider_12345');

    nowSpy.mockRestore();
  });

  it('handles very long provider names', () => {
    const longName = 'n'.repeat(10000);
    const provider = { name: longName, register: vi.fn() };

    adaptProvider(provider);

    const config = mockedCreatePlugin.mock.calls[0][0];
    expect(config.name).toBe(`compat/${longName}`);
    expect(config.description).toBe(`Adapted from legacy ServiceProvider: ${longName}`);
  });

  it('install registers legacy provider, sets context, and logs', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();

    await plugin.install(ctx);

    expect(provider.register).toHaveBeenCalledTimes(1);
    const kernelCompat = provider.register.mock.calls[0][0];
    expect(ctx._kernelCompat).toBe(kernelCompat);
    expect(ctx._legacyProvider).toBe(provider);
    expect(ctx.log.info).toHaveBeenCalledWith('Legacy provider \"legacy\" adapted');
  });

  it('propagates register errors without mutating context', async () => {
    const error = new Error('register failed');
    const provider = {
      name: 'bad',
      register: vi.fn(() => {
        throw error;
      }),
    };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();

    await expect(plugin.install(ctx)).rejects.toBe(error);
    expect(ctx._legacyProvider).toBeUndefined();
    expect(ctx._kernelCompat).toBeUndefined();
    expect(ctx.log.info).not.toHaveBeenCalled();
  });

  it('kernelCompat.register handles factories, values, and resource-heavy payloads', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    const kernelCompat = ctx._kernelCompat;

    const factory = vi.fn(() => 'built');
    const chainResult = kernelCompat.register('factory', factory, { scope: 'singleton' });

    const hugeContent = 'x'.repeat(50000);
    const deepValue = createDeepObject(40);

    kernelCompat.register('file', hugeContent, { ttl: 1 });
    kernelCompat.register('deep', deepValue);
    kernelCompat.register('deep', deepValue);

    expect(chainResult).toBe(kernelCompat);
    expect(ctx.services.registerFactory).toHaveBeenCalledTimes(1);

    const [factoryId, wrapper, options] = ctx.services.registerFactory.mock.calls[0];
    expect(factoryId).toBe('factory');
    expect(options).toEqual({ scope: 'singleton' });
    expect(wrapper()).toBe('built');
    expect(factory).toHaveBeenCalledWith(kernelCompat);

    expect(ctx.services.register).toHaveBeenCalledWith('file', hugeContent, { ttl: 1 });
    expect(ctx.services.register).toHaveBeenCalledWith('deep', deepValue, {});

    const registered = kernelCompat.getRegisteredServices();
    expect(registered).toEqual(expect.arrayContaining(['factory', 'file', 'deep']));
    expect(new Set(registered).size).toBe(3);
  });

  it('kernelCompat proxies service and event access', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    ctx.services.get.mockReturnValue('service-value');
    ctx.events.emit.mockReturnValue('emit-result');
    ctx.on.mockReturnValue('unsub');

    const kernelCompat = ctx._kernelCompat;
    const handler = vi.fn();

    expect(kernelCompat.getService('svc')).toBe('service-value');
    expect(ctx.services.get).toHaveBeenCalledWith('svc');

    expect(kernelCompat.emit('evt', { ok: true })).toBe('emit-result');
    expect(ctx.events.emit).toHaveBeenCalledWith('evt', { ok: true });

    expect(kernelCompat.on('evt', handler)).toBe('unsub');
    expect(ctx.on).toHaveBeenCalledWith('evt', handler);

    expect(kernelCompat.eventBus).toBe(ctx.events);
    expect(kernelCompat.state).toBe(ctx.state);
    expect(kernelCompat.services).toBe(ctx.services);
  });

  it('kernelCompat.request resolves response data with default timeout', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    ctx.events.waitFor.mockResolvedValueOnce({ data: 'ok' });

    const kernelCompat = ctx._kernelCompat;
    const result = await kernelCompat.request('ping', { value: 1 });

    expect(ctx.events.emit).toHaveBeenCalledWith('ping', { value: 1 });
    expect(ctx.events.waitFor).toHaveBeenCalledWith('ping.response', 30000);
    expect(result).toBe('ok');
  });

  it('kernelCompat.request supports concurrent calls and custom timeouts', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    ctx.events.waitFor
      .mockResolvedValueOnce({ data: 'first' })
      .mockResolvedValueOnce({ data: 'second' });

    const kernelCompat = ctx._kernelCompat;

    const [first, second] = await Promise.all([
      kernelCompat.request('typeA', 0),
      kernelCompat.request('typeB', -1, { timeout: 10 }),
    ]);

    expect(first).toBe('first');
    expect(second).toBe('second');
    expect(ctx.events.emit).toHaveBeenCalledWith('typeA', 0);
    expect(ctx.events.emit).toHaveBeenCalledWith('typeB', -1);
    expect(ctx.events.waitFor).toHaveBeenCalledWith('typeA.response', 30000);
    expect(ctx.events.waitFor).toHaveBeenCalledWith('typeB.response', 10);
  });

  it('kernelCompat.request normalizes timeout errors', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    ctx.events.waitFor.mockRejectedValueOnce(new Error('timeout waiting for response'));

    const kernelCompat = ctx._kernelCompat;

    await expect(kernelCompat.request('slow', { size: 'large' })).rejects.toThrow(
      'Request timeout: slow',
    );
  });

  it('kernelCompat.request rethrows non-timeout errors', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    const error = new Error('boom');
    ctx.events.waitFor.mockRejectedValueOnce(error);

    const kernelCompat = ctx._kernelCompat;

    await expect(kernelCompat.request('fail', { code: 500 })).rejects.toBe(error);
  });

  it('onStart/onStop invoke legacy lifecycle methods when present', async () => {
    const provider = {
      name: 'legacy',
      register: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    await plugin.onStart(ctx);
    await plugin.onStop(ctx);

    expect(provider.start).toHaveBeenCalledWith(ctx._kernelCompat);
    expect(provider.stop).toHaveBeenCalledWith(ctx._kernelCompat);
  });

  it('onStart/onStop no-op when legacy lifecycle is missing', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    await expect(plugin.onStart(ctx)).resolves.toBeUndefined();
    await expect(plugin.onStop(ctx)).resolves.toBeUndefined();
  });

  it('uninstall clears legacy references', async () => {
    const provider = { name: 'legacy', register: vi.fn() };
    const plugin = adaptProvider(provider);
    const ctx = createMockContext();
    await plugin.install(ctx);

    await plugin.uninstall(ctx);

    expect(ctx._legacyProvider).toBeNull();
    expect(ctx._kernelCompat).toBeNull();
  });

  it('supports concurrent installs without shared state', async () => {
    const providerA = { name: 'A', register: vi.fn() };
    const providerB = { name: 'B', register: vi.fn() };
    const pluginA = adaptProvider(providerA);
    const pluginB = adaptProvider(providerB);
    const ctxA = createMockContext();
    const ctxB = createMockContext();

    await Promise.all([pluginA.install(ctxA), pluginB.install(ctxB)]);

    expect(ctxA._legacyProvider).toBe(providerA);
    expect(ctxB._legacyProvider).toBe(providerB);
    expect(ctxA._kernelCompat).not.toBe(ctxB._kernelCompat);
    expect(providerA.register).toHaveBeenCalledWith(ctxA._kernelCompat);
    expect(providerB.register).toHaveBeenCalledWith(ctxB._kernelCompat);
  });
});
