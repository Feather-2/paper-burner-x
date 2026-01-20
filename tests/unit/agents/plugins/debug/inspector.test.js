import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createPluginMock = vi.hoisted(() => vi.fn((config) => config));

vi.mock('../../../../../js/agents/core/plugin.js', () => ({
  createPlugin: createPluginMock,
}));

import inspectorPlugin from '../../../../../js/agents/plugins/debug/inspector.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalDevFlag = globalThis.__DEV__;

const createMockContext = (overrides = {}) => {
  const kernelStatus = { id: 'kernel-1', phase: 'running', uptime: 42 };
  const kernelSnapshot = { id: 'snap-1', timestamp: 1, state: { ok: true } };
  const healthResult = { healthy: true, issues: [] };

  const kernelState = {
    snapshot: vi.fn((id) => id ?? 'snap-default'),
    rollback: vi.fn((id) => id !== 'bad'),
    getChangeLog: vi.fn((limit) => [
      { path: 'state.path', oldValue: 1, newValue: 2, timestamp: 10, limit },
    ]),
  };

  const kernel = {
    id: 'kernel-1',
    status: kernelStatus,
    snapshot: vi.fn(() => kernelSnapshot),
    healthCheck: vi.fn(() => Promise.resolve(healthResult)),
    state: kernelState,
    getPlugins: vi.fn(() => [{ name: 'plugin-a', version: '0.1.0' }]),
  };

  const events = {
    getHistory: vi.fn((pattern) => [{ name: 'evt', payload: pattern ?? null, timestamp: 0 }]),
    emit: vi.fn(),
    waitFor: vi.fn((pattern, timeout) => Promise.resolve({ event: pattern, data: timeout })),
  };

  const state = {
    getGlobal: vi.fn((path) => ({ path })),
    set: vi.fn(),
  };

  const services = {
    list: vi.fn(() => [{ name: 'svc', methods: ['run'] }]),
    call: vi.fn((name, method, args) => Promise.resolve({ name, method, args })),
    getStats: vi.fn((name) => ({ calls: 1, errors: 0, avgTime: 5, name })),
  };

  const ctx = {
    _kernel: kernel,
    events,
    state,
    services,
    config: { enabled: true, exposeGlobal: false },
    registerService: vi.fn(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };

  if (overrides._kernel) {
    Object.assign(kernel, overrides._kernel);
    if (overrides._kernel.state) {
      Object.assign(kernelState, overrides._kernel.state);
    }
  }
  if (overrides.events) Object.assign(events, overrides.events);
  if (overrides.state) Object.assign(state, overrides.state);
  if (overrides.services) Object.assign(services, overrides.services);
  if (overrides.config) Object.assign(ctx.config, overrides.config);
  if (overrides.log) Object.assign(ctx.log, overrides.log);
  if (overrides.registerService) ctx.registerService = overrides.registerService;

  return { ctx, kernel, kernelState, events, state, services };
};

const installInspector = (ctx) => {
  inspectorPlugin.install(ctx);
  const call = ctx.registerService.mock.calls[0];
  return call ? call[1] : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  if (typeof globalThis !== 'undefined' && globalThis.__kernelInspector) {
    delete globalThis.__kernelInspector;
  }
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalDevFlag === undefined) {
    delete globalThis.__DEV__;
  } else {
    globalThis.__DEV__ = originalDevFlag;
  }
  if (typeof globalThis !== 'undefined' && globalThis.__kernelInspector) {
    delete globalThis.__kernelInspector;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('default export', () => {
  it('exposes plugin metadata and defaults', () => {
    expect(inspectorPlugin.name).toBe('debug/inspector');
    expect(inspectorPlugin.version).toBe('1.0.0');
    expect(inspectorPlugin.description).toContain('API');
    expect(inspectorPlugin.defaultConfig).toEqual({ enabled: true, exposeGlobal: false });
    expect(inspectorPlugin.install).toBeTypeOf('function');
    expect(inspectorPlugin.uninstall).toBeTypeOf('function');
  });

  it('installs inspector service and proxies core APIs', async () => {
    const { ctx, kernel, events, state, services } = createMockContext();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const inspector = installInspector(ctx);

    expect(ctx.registerService).toHaveBeenCalledTimes(1);
    expect(ctx.registerService).toHaveBeenCalledWith('inspector', expect.any(Object));
    expect(inspector.kernel.id).toBe(kernel.id);
    expect(inspector.kernel.status()).toBe(kernel.status);
    expect(inspector.kernel.snapshot()).toEqual(expect.objectContaining({ id: 'snap-1' }));
    await expect(inspector.kernel.healthCheck()).resolves.toEqual({ healthy: true, issues: [] });

    expect(inspector.events.history('evt')).toEqual(expect.any(Array));
    expect(events.getHistory).toHaveBeenCalledWith('evt');

    inspector.events.emit('evt', { ok: true });
    expect(events.emit).toHaveBeenCalledWith('evt', { ok: true });

    await expect(inspector.events.waitFor('evt', 10)).resolves.toEqual({ event: 'evt', data: 10 });

    expect(inspector.state.get('path')).toEqual({ path: 'path' });
    expect(state.getGlobal).toHaveBeenCalledWith('path');

    inspector.state.set('path', 123);
    expect(state.set).toHaveBeenCalledWith('path', 123);

    inspector.state.snapshot('snap');
    expect(kernel.state.snapshot).toHaveBeenCalledWith('snap');

    inspector.state.rollback('snap');
    expect(kernel.state.rollback).toHaveBeenCalledWith('snap');

    inspector.state.changeLog(5);
    expect(kernel.state.getChangeLog).toHaveBeenCalledWith(5);

    expect(inspector.services.list()).toEqual([{ name: 'svc', methods: ['run'] }]);
    await expect(inspector.services.call('svc', 'run', [1])).resolves.toEqual({
      name: 'svc',
      method: 'run',
      args: [1],
    });
    expect(inspector.services.stats('svc')).toEqual({ calls: 1, errors: 0, avgTime: 5, name: 'svc' });

    expect(inspector.plugins.list()).toEqual([{ name: 'plugin-a', version: '0.1.0' }]);

    inspector.help();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('Inspector API');

    expect(ctx.log.info).toHaveBeenCalledWith('Debug inspector plugin installed');
  });

  it('passes boundary values and resource payloads to underlying context', async () => {
    const { ctx, kernel, events, state, services } = createMockContext();
    const inspector = installInspector(ctx);

    const historyInputs = [null, undefined, '', '   '];
    for (const pattern of historyInputs) {
      inspector.events.history(pattern);
      expect(events.getHistory).toHaveBeenLastCalledWith(pattern);
    }

    const emitPayloads = [null, undefined, '', [], {}, 0, -1, Number.MAX_SAFE_INTEGER, '   '];
    for (const payload of emitPayloads) {
      inspector.events.emit('edge', payload);
      expect(events.emit).toHaveBeenLastCalledWith('edge', payload);
    }

    const largeString = 'x'.repeat(1024 * 1024);
    const largeBinary = new Uint8Array(1024 * 1024);
    const deepNested = { level: 0 };
    let current = deepNested;
    for (let i = 1; i < 20; i += 1) {
      current.next = { level: i };
      current = current.next;
    }

    inspector.events.emit('edge', largeString);
    expect(events.emit).toHaveBeenLastCalledWith('edge', largeString);

    inspector.state.set('large', largeBinary);
    expect(state.set).toHaveBeenLastCalledWith('large', largeBinary);

    inspector.state.set('deep', deepNested);
    expect(state.set).toHaveBeenLastCalledWith('deep', deepNested);

    const paths = [null, undefined, '', '   '];
    for (const path of paths) {
      inspector.state.get(path);
      expect(state.getGlobal).toHaveBeenLastCalledWith(path);
    }

    const snapshotIds = [undefined, null, '', '   '];
    for (const id of snapshotIds) {
      inspector.state.snapshot(id);
      expect(kernel.state.snapshot).toHaveBeenLastCalledWith(id);
    }

    const rollbackIds = ['', '   ', 'snap'];
    for (const id of rollbackIds) {
      inspector.state.rollback(id);
      expect(kernel.state.rollback).toHaveBeenLastCalledWith(id);
    }

    const limits = [0, -1, Number.MAX_SAFE_INTEGER, '123', undefined];
    for (const limit of limits) {
      inspector.state.changeLog(limit);
      expect(kernel.state.getChangeLog).toHaveBeenLastCalledWith(limit);
    }

    const waitTimeouts = [0, -1, Number.MAX_SAFE_INTEGER, '456'];
    for (const timeout of waitTimeouts) {
      await inspector.events.waitFor('edge', timeout);
      expect(events.waitFor).toHaveBeenLastCalledWith('edge', timeout);
    }

    await inspector.services.call('svc', 'run', []);
    expect(services.call).toHaveBeenLastCalledWith('svc', 'run', []);

    const objectArgs = { not: 'array' };
    await inspector.services.call('svc', 'run', objectArgs);
    expect(services.call).toHaveBeenLastCalledWith('svc', 'run', objectArgs);

    inspector.services.stats('');
    expect(services.getStats).toHaveBeenLastCalledWith('');
  });

  it('supports concurrent and rapid calls', async () => {
    const { ctx, events } = createMockContext();
    const inspector = installInspector(ctx);

    const results = await Promise.all([
      inspector.events.waitFor('a', 1),
      inspector.events.waitFor('b', 2),
      inspector.services.call('svc', 'm1', [1]),
      inspector.services.call('svc', 'm2', [2]),
    ]);

    expect(results).toEqual([
      { event: 'a', data: 1 },
      { event: 'b', data: 2 },
      { name: 'svc', method: 'm1', args: [1] },
      { name: 'svc', method: 'm2', args: [2] },
    ]);

    inspector.events.emit('fast', 1);
    inspector.events.emit('fast', 2);
    expect(events.emit).toHaveBeenCalledTimes(2);
    expect(events.emit).toHaveBeenNthCalledWith(1, 'fast', 1);
    expect(events.emit).toHaveBeenNthCalledWith(2, 'fast', 2);
  });

  it('propagates errors from underlying APIs', async () => {
    const snapshotError = new Error('snapshot failed');
    const waitError = new Error('wait failed');
    const callError = new Error('call failed');
    const healthError = new Error('health failed');

    const { ctx } = createMockContext({
      _kernel: {
        snapshot: vi.fn(() => {
          throw snapshotError;
        }),
        healthCheck: vi.fn(() => Promise.reject(healthError)),
      },
      events: {
        waitFor: vi.fn(() => Promise.reject(waitError)),
      },
      services: {
        call: vi.fn(() => Promise.reject(callError)),
      },
    });
    const inspector = installInspector(ctx);

    expect(() => inspector.kernel.snapshot()).toThrow(snapshotError);
    await expect(inspector.kernel.healthCheck()).rejects.toThrow(healthError);
    await expect(inspector.events.waitFor('evt', 1)).rejects.toThrow(waitError);
    await expect(inspector.services.call('svc', 'run', [])).rejects.toThrow(callError);
  });

  it('skips install when disabled', () => {
    const { ctx } = createMockContext({ config: { enabled: false, exposeGlobal: true } });
    inspectorPlugin.install(ctx);

    expect(ctx.registerService).not.toHaveBeenCalled();
    expect(ctx.log.info).not.toHaveBeenCalled();
    expect(globalThis.__kernelInspector).toBeUndefined();
  });

  it('exposes inspector globally in development when configured', () => {
    process.env.NODE_ENV = 'development';
    const { ctx } = createMockContext({ config: { exposeGlobal: true } });

    const inspector = installInspector(ctx);

    expect(globalThis.__kernelInspector).toBe(inspector);
    expect(ctx.log.info).toHaveBeenCalledWith('Inspector exposed as globalThis.__kernelInspector');
  });

  it('does not expose inspector in production and warns', () => {
    process.env.NODE_ENV = 'production';
    const { ctx } = createMockContext({ config: { exposeGlobal: true } });

    installInspector(ctx);

    expect(globalThis.__kernelInspector).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith('exposeGlobal disabled: non-development environment');
    expect(ctx.registerService).toHaveBeenCalledWith('inspector', expect.any(Object));
  });

  it('uninstall removes global inspector', () => {
    const { ctx } = createMockContext();
    globalThis.__kernelInspector = { marker: true };

    inspectorPlugin.uninstall(ctx);

    expect(globalThis.__kernelInspector).toBeUndefined();
  });
});
