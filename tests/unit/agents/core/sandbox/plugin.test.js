import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pluginMock = vi.hoisted(() => ({
  createPlugin: vi.fn((config) => config),
}));

const sandboxPoolMock = vi.hoisted(() => {
  const instances = [];
  class MockSandboxPool {
    constructor(options) {
      this.options = options;
      this.withSandbox = vi.fn();
      this.getStats = vi.fn(() => ({ total: 0, inUse: 0 }));
      this.clear = vi.fn();
      this.dispose = vi.fn();
      instances.push(this);
    }
  }

  return { SandboxPool: MockSandboxPool, instances };
});

const constantsMock = vi.hoisted(() => ({
  SandboxPreset: {
    SKILL: ['skill-cap'],
    TRUSTED: ['trusted-cap'],
  },
  ResourceLimits: {
    STANDARD: { name: 'standard', memoryLimit: 8 },
    HEAVY: { name: 'heavy', memoryLimit: 64 },
  },
}));

vi.mock('../../../../../js/agents/core/plugin.js', () => ({
  createPlugin: pluginMock.createPlugin,
}));

vi.mock('../../../../../js/agents/core/sandbox/pool.js', () => ({
  SandboxPool: sandboxPoolMock.SandboxPool,
}));

vi.mock('../../../../../js/agents/core/sandbox/constants.js', () => ({
  SandboxPreset: constantsMock.SandboxPreset,
  ResourceLimits: constantsMock.ResourceLimits,
}));

async function loadSandboxPluginModule() {
  return await import('../../../../../js/agents/core/sandbox/plugin.js');
}

function createContext(configOverrides = {}) {
  return {
    config: {
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: constantsMock.SandboxPreset.SKILL,
      defaultLimits: constantsMock.ResourceLimits.STANDARD,
      ...configOverrides,
    },
    registerService: vi.fn(),
    events: { emit: vi.fn() },
  };
}

function getRegisteredService(ctx) {
  expect(ctx.registerService).toHaveBeenCalledTimes(1);
  return ctx.registerService.mock.calls[0][1];
}

async function setupService(configOverrides = {}) {
  const { createSandboxPlugin } = await loadSandboxPluginModule();
  pluginMock.createPlugin.mockClear();

  const plugin = createSandboxPlugin();
  const ctx = createContext(configOverrides);
  await plugin.install(ctx);

  const pool = sandboxPoolMock.instances[0];
  const service = getRegisteredService(ctx);

  return { plugin, ctx, pool, service };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sandboxPoolMock.instances.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSandboxPlugin', () => {
  it('builds plugin config with defaults when options are omitted', async () => {
    const { createSandboxPlugin } = await loadSandboxPluginModule();
    pluginMock.createPlugin.mockClear();

    const plugin = createSandboxPlugin();

    expect(pluginMock.createPlugin).toHaveBeenCalledTimes(1);
    const config = pluginMock.createPlugin.mock.calls[0][0];
    expect(config).toMatchObject({
      name: 'sandbox',
      version: '1.0.0',
      description: 'WASM sandbox for secure code execution',
    });
    expect(config.defaultConfig).toEqual({
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: constantsMock.SandboxPreset.SKILL,
      defaultLimits: constantsMock.ResourceLimits.STANDARD,
    });
    expect(plugin).toBe(config);
  });

  it('merges boundary option values into defaultConfig', async () => {
    const { createSandboxPlugin } = await loadSandboxPluginModule();
    pluginMock.createPlugin.mockClear();

    const plugin = createSandboxPlugin({
      poolSize: 0,
      idleTimeoutMs: -1,
      defaultCapabilities: [],
      defaultLimits: {},
    });

    const config = pluginMock.createPlugin.mock.calls[0][0];
    expect(config.defaultConfig).toEqual({
      poolSize: 0,
      idleTimeoutMs: -1,
      defaultCapabilities: [],
      defaultLimits: {},
    });
    expect(plugin.defaultConfig).toEqual(config.defaultConfig);
  });

  it('accepts string and MAX_SAFE_INTEGER boundaries in options', async () => {
    const { createSandboxPlugin } = await loadSandboxPluginModule();
    pluginMock.createPlugin.mockClear();

    const plugin = createSandboxPlugin({
      poolSize: '2',
      idleTimeoutMs: Number.MAX_SAFE_INTEGER,
      defaultCapabilities: ['cap'],
      defaultLimits: { memoryLimit: Number.MAX_SAFE_INTEGER },
    });

    expect(plugin.defaultConfig).toEqual({
      poolSize: '2',
      idleTimeoutMs: Number.MAX_SAFE_INTEGER,
      defaultCapabilities: ['cap'],
      defaultLimits: { memoryLimit: Number.MAX_SAFE_INTEGER },
    });
  });

  it('treats null options as empty input', async () => {
    const { createSandboxPlugin } = await loadSandboxPluginModule();
    pluginMock.createPlugin.mockClear();

    const plugin = createSandboxPlugin(null);

    expect(plugin.defaultConfig).toEqual({
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: constantsMock.SandboxPreset.SKILL,
      defaultLimits: constantsMock.ResourceLimits.STANDARD,
    });
    expect(pluginMock.createPlugin).toHaveBeenCalledTimes(1);
  });

  it('registers the sandbox service and wires pool options + event emitters', async () => {
    const { ctx, pool, service } = await setupService({
      poolSize: '3',
      idleTimeoutMs: 0,
      defaultCapabilities: ['cap-a'],
      defaultLimits: { memoryLimit: -1 },
    });

    expect(pool.options).toEqual({
      maxSize: '3',
      idleTimeoutMs: 0,
      defaultCapabilities: ['cap-a'],
      defaultLimits: { memoryLimit: -1 },
    });

    const sandbox = {
      execute: vi.fn().mockResolvedValue('sync-result'),
      executeAsync: vi.fn().mockResolvedValue('async-result'),
    };

    pool.withSandbox.mockImplementation(async (options, cb) => {
      options.onLog('info', ['log']);
      options.onEmit('event', { ok: true });
      return cb(sandbox);
    });

    const result = await service.execute('return 1', {
      capabilities: ['cap-x'],
      limits: { memoryLimit: 1 },
      state: { foo: 'bar' },
      context: { x: 1 },
    });

    expect(result).toBe('sync-result');
    expect(pool.withSandbox).toHaveBeenCalledTimes(1);
    const [options] = pool.withSandbox.mock.calls[0];
    expect(options).toMatchObject({
      capabilities: ['cap-x'],
      limits: { memoryLimit: 1 },
      state: { foo: 'bar' },
    });
    expect(sandbox.execute).toHaveBeenCalledWith('return 1', { x: 1 });
    expect(sandbox.executeAsync).not.toHaveBeenCalled();

    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:log', { level: 'info', args: ['log'] });
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:emit', { name: 'event', ok: true });
  });

  it('executes async code when execOptions.async is true', async () => {
    const { pool, service } = await setupService();

    const sandbox = {
      execute: vi.fn().mockResolvedValue('sync-result'),
      executeAsync: vi.fn().mockResolvedValue('async-result'),
    };

    pool.withSandbox.mockImplementation(async (options, cb) => cb(sandbox));

    const result = await service.execute('return 2', { async: true, context: { y: 2 } });

    expect(result).toBe('async-result');
    expect(sandbox.executeAsync).toHaveBeenCalledWith('return 2', { y: 2 });
    expect(sandbox.execute).not.toHaveBeenCalled();
  });

  it('passes empty values and type boundaries through execute', async () => {
    const { pool, service } = await setupService();

    const sandbox = {
      execute: vi.fn().mockResolvedValue('ok'),
      executeAsync: vi.fn(),
    };

    pool.withSandbox.mockImplementation(async (options, cb) => cb(sandbox));

    await service.execute('', {
      capabilities: [],
      limits: {},
      state: null,
      context: {},
    });

    await service.execute('   ', {
      capabilities: { not: 'array' },
      limits: [],
      state: undefined,
      context: [],
    });

    expect(pool.withSandbox).toHaveBeenCalledTimes(2);
    expect(sandbox.execute).toHaveBeenNthCalledWith(1, '', {});
    expect(sandbox.execute).toHaveBeenNthCalledWith(2, '   ', []);

    const firstOptions = pool.withSandbox.mock.calls[0][0];
    const secondOptions = pool.withSandbox.mock.calls[1][0];
    expect(firstOptions.capabilities).toEqual([]);
    expect(firstOptions.limits).toEqual({});
    expect(firstOptions.state).toBeNull();
    expect(secondOptions.capabilities).toEqual({ not: 'array' });
    expect(secondOptions.limits).toEqual([]);
    expect(secondOptions.state).toBeUndefined();
  });

  it('handles large payloads and deep nested state in execute', async () => {
    const { pool, service } = await setupService();

    const sandbox = {
      execute: vi.fn().mockResolvedValue('ok'),
      executeAsync: vi.fn(),
    };

    pool.withSandbox.mockImplementation(async (options, cb) => cb(sandbox));

    const hugeFile = 'x'.repeat(1024 * 1024);
    const longCode = 'y'.repeat(100000);
    const deepState = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: { value: 'deep' },
            },
          },
        },
      },
    };
    const context = {
      file: hugeFile,
      note: longCode,
      nested: { arr: [1, { deep: { more: true } }] },
    };

    const result = await service.execute(longCode, { state: deepState, context });

    expect(result).toBe('ok');
    expect(sandbox.execute).toHaveBeenCalledWith(longCode, context);
    const options = pool.withSandbox.mock.calls[0][0];
    expect(options.state).toBe(deepState);
  });

  it('propagates errors from pool.withSandbox', async () => {
    const { pool, service } = await setupService();
    pool.withSandbox.mockRejectedValue(new Error('boom'));

    await expect(service.execute('return 3')).rejects.toThrow('boom');
  });

  it('rejects when execOptions is null', async () => {
    const { pool, service } = await setupService();
    pool.withSandbox.mockResolvedValue('unused');

    await expect(service.execute('return 4', null)).rejects.toThrow(TypeError);
    expect(pool.withSandbox).not.toHaveBeenCalled();
  });

  it('supports concurrent execute calls', async () => {
    const { pool, service } = await setupService();

    const sandboxA = {
      execute: vi.fn().mockResolvedValue('one'),
      executeAsync: vi.fn(),
    };
    const sandboxB = {
      execute: vi.fn(),
      executeAsync: vi.fn().mockResolvedValue('two'),
    };

    const resolvers = [];
    pool.withSandbox.mockImplementation((options, cb) => {
      const sandbox = resolvers.length === 0 ? sandboxA : sandboxB;
      return new Promise((resolve, reject) => {
        resolvers.push(async () => {
          try {
            resolve(await cb(sandbox));
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    const p1 = service.execute('code-a', { context: { id: 1 } });
    const p2 = service.execute('code-b', { context: { id: 2 }, async: true });

    expect(pool.withSandbox).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);

    await resolvers[1]();
    await resolvers[0]();

    await expect(p1).resolves.toBe('one');
    await expect(p2).resolves.toBe('two');
    expect(sandboxA.execute).toHaveBeenCalledWith('code-a', { id: 1 });
    expect(sandboxB.executeAsync).toHaveBeenCalledWith('code-b', { id: 2 });
  });

  it('handles rapid consecutive execute calls', async () => {
    const { pool, service } = await setupService();

    const sandbox = {
      execute: vi.fn().mockResolvedValue('ok'),
      executeAsync: vi.fn(),
    };

    pool.withSandbox.mockImplementation((options, cb) => cb(sandbox));

    const codes = ['a', 'b', 'c'];
    const results = [];
    for (const code of codes) {
      results.push(await service.execute(code, { context: { code } }));
    }

    expect(results).toEqual(['ok', 'ok', 'ok']);
    expect(pool.withSandbox).toHaveBeenCalledTimes(3);
    expect(sandbox.execute).toHaveBeenCalledTimes(3);
  });

  it('maps executeSkill context flags to presets and limits', async () => {
    const { service } = await setupService();
    const executeSpy = vi.spyOn(service, 'execute').mockResolvedValue('ok');

    await service.executeSkill('return 5', {
      trusted: true,
      heavy: true,
      state: { foo: 'bar' },
      args: { x: 9 },
    });

    expect(executeSpy).toHaveBeenCalledWith('return 5', {
      capabilities: constantsMock.SandboxPreset.TRUSTED,
      limits: constantsMock.ResourceLimits.HEAVY,
      state: { foo: 'bar' },
      context: { x: 9 },
      async: true,
    });
  });

  it('defaults executeSkill to SKILL + STANDARD presets', async () => {
    const { service } = await setupService();
    const executeSpy = vi.spyOn(service, 'execute').mockResolvedValue('ok');

    await service.executeSkill('return 6', {});

    expect(executeSpy).toHaveBeenCalledWith('return 6', {
      capabilities: constantsMock.SandboxPreset.SKILL,
      limits: constantsMock.ResourceLimits.STANDARD,
      state: undefined,
      context: undefined,
      async: true,
    });
  });

  it('exposes getStats and clear from the pool', async () => {
    const { pool, service } = await setupService();
    pool.getStats.mockReturnValue({ total: 2, inUse: 1 });

    expect(service.getStats()).toEqual({ total: 2, inUse: 1 });
    expect(pool.getStats).toHaveBeenCalledTimes(1);

    service.clear();
    expect(pool.clear).toHaveBeenCalledTimes(1);
  });

  it('uninstalls by disposing the pool and clearing the symbol reference', async () => {
    const { plugin, ctx, pool } = await setupService();

    const poolSymbol = Object.getOwnPropertySymbols(ctx).find(
      (symbol) => symbol.description === 'sandboxPool',
    );

    expect(poolSymbol).toBeDefined();
    expect(ctx[poolSymbol]).toBe(pool);

    await plugin.uninstall(ctx);

    expect(pool.dispose).toHaveBeenCalledTimes(1);
    expect(ctx[poolSymbol]).toBeNull();
  });

  it('uninstall does not throw when no pool exists', async () => {
    const { createSandboxPlugin } = await loadSandboxPluginModule();
    pluginMock.createPlugin.mockClear();

    const plugin = createSandboxPlugin();
    const ctx = {};

    await expect(plugin.uninstall(ctx)).resolves.toBeUndefined();
  });
});

describe('default', () => {
  it('exports a default sandbox plugin instance with defaults', async () => {
    const module = await loadSandboxPluginModule();

    expect(pluginMock.createPlugin).toHaveBeenCalledTimes(1);
    const config = pluginMock.createPlugin.mock.calls[0][0];

    expect(module.default).toBe(config);
    expect(module.default.defaultConfig).toEqual({
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: constantsMock.SandboxPreset.SKILL,
      defaultLimits: constantsMock.ResourceLimits.STANDARD,
    });
  });
});
