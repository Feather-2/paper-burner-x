import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const createPlugin = vi.fn(plugin => plugin);

  const poolInstances = [];
  const sandboxInstances = [];

  const SandboxPool = vi.fn().mockImplementation(function SandboxPool(opts) {
    const sandbox = {
      execute: vi.fn(),
      executeAsync: vi.fn(),
    };

    const instance = {
      opts,
      withSandbox: vi.fn(),
      getStats: vi.fn(() => ({ size: 0 })),
      clear: vi.fn(),
      dispose: vi.fn(),
      __sandbox: sandbox,
      __lastWithSandboxConfig: undefined,
    };

    instance.withSandbox.mockImplementation(async (config, fn) => {
      instance.__lastWithSandboxConfig = config;
      return await fn(sandbox);
    });

    poolInstances.push(instance);
    sandboxInstances.push(sandbox);

    return instance;
  });

  const SandboxPreset = {
    SKILL: ['cap:skill'],
    TRUSTED: ['cap:trusted'],
  };

  const ResourceLimits = {
    STANDARD: { cpu: 1, memory: 128 },
    HEAVY: { cpu: 4, memory: 1024 },
  };

  return {
    createPlugin,
    SandboxPool,
    poolInstances,
    sandboxInstances,
    SandboxPreset,
    ResourceLimits,
  };
});

vi.mock('../../../../../js/agents/core/plugin.js', () => ({
  createPlugin: hoisted.createPlugin,
}));

vi.mock('../../../../../js/agents/core/sandbox/pool.js', () => ({
  SandboxPool: hoisted.SandboxPool,
}));

vi.mock('../../../../../js/agents/core/sandbox/constants.js', () => ({
  SandboxPreset: hoisted.SandboxPreset,
  ResourceLimits: hoisted.ResourceLimits,
}));

async function importSubject() {
  return await import('../../../../../js/agents/core/sandbox/plugin.js');
}

function createCtx(config = {}, overrides = {}) {
  const ctx = {
    config,
    events: { emit: vi.fn() },
    services: {},
    registerService: vi.fn((name, service) => {
      ctx.services[name] = service;
    }),
    ...overrides,
  };
  return ctx;
}

function getSandboxPoolSymbol(ctx) {
  return Object.getOwnPropertySymbols(ctx).find(s => s.description === 'sandboxPool');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  hoisted.poolInstances.length = 0;
  hoisted.sandboxInstances.length = 0;
});

describe('createSandboxPlugin', () => {
  it('creates plugin metadata and defaultConfig with defaults (options undefined / null)', async () => {
    const mod = await importSubject();

    // Ignore module-level default export creation side-effect.
    hoisted.createPlugin.mockClear();

    const plugin1 = mod.createSandboxPlugin();
    expect(plugin1).toMatchObject({
      name: 'sandbox',
      version: '1.0.0',
      description: expect.any(String),
    });
    expect(plugin1.defaultConfig).toEqual({
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: hoisted.SandboxPreset.SKILL,
      defaultLimits: hoisted.ResourceLimits.STANDARD,
    });

    const plugin2 = mod.createSandboxPlugin(null);
    expect(plugin2.defaultConfig).toEqual(plugin1.defaultConfig);

    expect(hoisted.createPlugin).toHaveBeenCalledTimes(2);
  });

  it('merges options and keeps boundary / type-edge values intact', async () => {
    const mod = await importSubject();
    hoisted.createPlugin.mockClear();

    const plugin = mod.createSandboxPlugin({
      poolSize: 0,
      idleTimeoutMs: Number.MAX_SAFE_INTEGER,
      defaultCapabilities: [],
      defaultLimits: {},
      extra: 'kept',
    });

    expect(plugin.defaultConfig).toEqual({
      poolSize: 0,
      idleTimeoutMs: Number.MAX_SAFE_INTEGER,
      defaultCapabilities: [],
      defaultLimits: {},
      extra: 'kept',
    });
  });

  it('allows options to override defaults with explicit null/undefined', async () => {
    const mod = await importSubject();
    hoisted.createPlugin.mockClear();

    const plugin = mod.createSandboxPlugin({
      poolSize: undefined,
      idleTimeoutMs: -1,
      defaultCapabilities: undefined,
      defaultLimits: null,
    });

    expect(plugin.defaultConfig.poolSize).toBeUndefined();
    expect(plugin.defaultConfig.idleTimeoutMs).toBe(-1);
    expect(plugin.defaultConfig.defaultCapabilities).toBeUndefined();
    expect(plugin.defaultConfig.defaultLimits).toBeNull();
  });

  it('install() uses ctx.config (not plugin.defaultConfig) and registers sandbox service', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin({ poolSize: 4, idleTimeoutMs: 60000 });

    const ctxConfig = {
      poolSize: '4', // type boundary: string as number
      idleTimeoutMs: 0, // boundary: 0
      defaultCapabilities: {}, // type boundary: object as array-ish
      defaultLimits: [], // type boundary: array as object-ish
    };
    const ctx = createCtx(ctxConfig);

    await plugin.install(ctx);

    expect(hoisted.SandboxPool).toHaveBeenCalledTimes(1);
    expect(hoisted.SandboxPool).toHaveBeenCalledWith({
      maxSize: '4',
      idleTimeoutMs: 0,
      defaultCapabilities: {},
      defaultLimits: [],
    });

    expect(ctx.registerService).toHaveBeenCalledTimes(1);
    expect(ctx.services.sandbox).toBeTruthy();
    expect(typeof ctx.services.sandbox.execute).toBe('function');
    expect(typeof ctx.services.sandbox.executeSkill).toBe('function');
    expect(typeof ctx.services.sandbox.getStats).toBe('function');
    expect(typeof ctx.services.sandbox.clear).toBe('function');

    const sym = getSandboxPoolSymbol(ctx);
    expect(typeof sym).toBe('symbol');
    expect(ctx[sym]).toBe(hoisted.poolInstances[0]);
  });

  it('uninstall() disposes pool when installed, and is safe when called without install', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();

    const ctx1 = createCtx({});
    await plugin.uninstall(ctx1);
    const sym1 = getSandboxPoolSymbol(ctx1);
    expect(typeof sym1).toBe('symbol');
    expect(ctx1[sym1]).toBeNull();

    const ctx2 = createCtx(plugin.defaultConfig);
    await plugin.install(ctx2);

    const sym2 = getSandboxPoolSymbol(ctx2);
    const pool = ctx2[sym2];

    await plugin.uninstall(ctx2);

    expect(pool.dispose).toHaveBeenCalledTimes(1);
    expect(ctx2[sym2]).toBeNull();
  });

  it('execute() forwards empty/whitespace/null code values and supports execOptions omitted', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    sandbox.execute.mockResolvedValueOnce('empty-ok');
    await expect(service.execute('')).resolves.toBe('empty-ok');
    expect(sandbox.execute).toHaveBeenLastCalledWith('', undefined);

    sandbox.execute.mockResolvedValueOnce('ws-ok');
    const ws = ' \n\t ';
    await expect(service.execute(ws, { context: {}, async: false })).resolves.toBe('ws-ok');
    expect(sandbox.execute).toHaveBeenLastCalledWith(ws, {});

    sandbox.execute.mockResolvedValueOnce('null-ok');
    await expect(service.execute(null, { context: { ok: 1 } })).resolves.toBe('null-ok');
    expect(sandbox.execute).toHaveBeenLastCalledWith(null, { ok: 1 });

    expect(pool.withSandbox).toHaveBeenCalledTimes(3);
  });

  it('sandbox.execute() routes sync vs async execution and forwards config + event hooks', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    sandbox.execute.mockResolvedValueOnce('sync-result');
    const res = await service.execute('code', {
      capabilities: ['c1'],
      limits: { cpu: 9 },
      state: { s: 1 },
      context: { a: 1 },
      async: false,
    });

    expect(res).toBe('sync-result');
    expect(pool.withSandbox).toHaveBeenCalledTimes(1);

    const withCfg = pool.__lastWithSandboxConfig;
    expect(withCfg).toMatchObject({
      capabilities: ['c1'],
      limits: { cpu: 9 },
      state: { s: 1 },
    });
    expect(typeof withCfg.onLog).toBe('function');
    expect(typeof withCfg.onEmit).toBe('function');

    withCfg.onLog('info', []);
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:log', { level: 'info', args: [] });

    const deepPayload = { deep: { a: { b: { c: [1, 2, 3] } } } };
    withCfg.onEmit('evt', deepPayload);
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:emit', { name: 'evt', ...deepPayload });

    // Null/undefined payload should not throw (object spread ignores them); should emit { name } only.
    withCfg.onEmit('evt-null', null);
    withCfg.onEmit('evt-undef', undefined);
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:emit', { name: 'evt-null' });
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:emit', { name: 'evt-undef' });

    expect(sandbox.execute).toHaveBeenCalledWith('code', { a: 1 });
    expect(sandbox.executeAsync).not.toHaveBeenCalled();

    sandbox.executeAsync.mockResolvedValueOnce('async-result');
    const res2 = await service.execute('code2', { context: {}, async: true });
    expect(res2).toBe('async-result');
    expect(sandbox.executeAsync).toHaveBeenCalledWith('code2', {});
  });

  it('sandbox.execute() propagates errors (null execOptions, pool.withSandbox rejection, sandbox execution failure)', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    await expect(service.execute('code', null)).rejects.toBeInstanceOf(TypeError);

    const boom = new Error('boom');
    pool.withSandbox.mockRejectedValueOnce(boom);
    await expect(service.execute('code', {})).rejects.toBe(boom);

    const execErr = new Error('exec-fail');
    sandbox.execute.mockRejectedValueOnce(execErr);
    await expect(service.execute('bad', { context: {} })).rejects.toBe(execErr);
  });

  it('executeSkill() selects preset capabilities/limits and always uses async execution', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    sandbox.executeAsync.mockResolvedValueOnce('skill-result');
    const res = await service.executeSkill('skill body', {
      trusted: true,
      heavy: true,
      state: { k: 'v' },
      args: { x: 42 },
    });

    expect(res).toBe('skill-result');

    const withCfg = pool.__lastWithSandboxConfig;
    expect(withCfg.capabilities).toBe(hoisted.SandboxPreset.TRUSTED);
    expect(withCfg.limits).toBe(hoisted.ResourceLimits.HEAVY);
    expect(withCfg.state).toEqual({ k: 'v' });

    expect(sandbox.executeAsync).toHaveBeenCalledWith('skill body', { x: 42 });
    expect(sandbox.execute).not.toHaveBeenCalled();

    sandbox.executeAsync.mockResolvedValueOnce('default-skill');
    const res2 = await service.executeSkill('skill2');
    expect(res2).toBe('default-skill');
    expect(pool.__lastWithSandboxConfig.capabilities).toBe(hoisted.SandboxPreset.SKILL);
    expect(pool.__lastWithSandboxConfig.limits).toBe(hoisted.ResourceLimits.STANDARD);
  });

  it('executeSkill() throws when context is null (null boundary)', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    await expect(service.executeSkill('body', null)).rejects.toBeInstanceOf(TypeError);
  });

  it('supports concurrent execute() calls (rapid + parallel) without shared-state leaks', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    sandbox.execute.mockImplementation(async (code, context) => ({ code, context }));

    const calls = [];
    for (let i = 0; i < 10; i++) {
      calls.push(service.execute(`code-${i}`, { context: { i }, async: false }));
    }
    const results = await Promise.all(calls);

    expect(results).toHaveLength(10);
    expect(pool.withSandbox).toHaveBeenCalledTimes(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toEqual({ code: `code-${i}`, context: { i } });
    }
  });

  it('handles resource-boundary inputs (very long code string and deep nested emit payload)', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];
    const sandbox = pool.__sandbox;

    const bigCode = 'x'.repeat(200_000);
    sandbox.executeAsync.mockResolvedValueOnce('big-ok');

    const res = await service.execute(bigCode, { async: true, context: { ok: true } });
    expect(res).toBe('big-ok');
    expect(sandbox.executeAsync).toHaveBeenCalledWith(bigCode, { ok: true });

    const deep = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) {
      cur.next = { i };
      cur = cur.next;
    }

    pool.__lastWithSandboxConfig.onEmit('deep', { payload: deep });
    expect(ctx.events.emit).toHaveBeenCalledWith('sandbox:emit', { name: 'deep', payload: deep });
  });

  it('getStats() and clear() proxy to the underlying pool', async () => {
    const mod = await importSubject();
    const plugin = mod.createSandboxPlugin();
    const ctx = createCtx(plugin.defaultConfig);

    await plugin.install(ctx);

    const service = ctx.services.sandbox;
    const pool = hoisted.poolInstances[0];

    const stats = { size: 123, idle: 7 };
    pool.getStats.mockReturnValueOnce(stats);

    expect(service.getStats()).toBe(stats);

    service.clear();
    expect(pool.clear).toHaveBeenCalledTimes(1);
  });
});

describe('default', () => {
  it('exports a default sandbox plugin instance with defaultConfig', async () => {
    const mod = await importSubject();
    const plugin = mod.default;

    expect(plugin).toMatchObject({
      name: 'sandbox',
      version: '1.0.0',
      description: expect.any(String),
    });

    expect(plugin.defaultConfig).toEqual({
      poolSize: 4,
      idleTimeoutMs: 60000,
      defaultCapabilities: hoisted.SandboxPreset.SKILL,
      defaultLimits: hoisted.ResourceLimits.STANDARD,
    });
  });

  it('default plugin can install and provide a working sandbox service', async () => {
    const mod = await importSubject();
    const plugin = mod.default;

    const ctx = createCtx(plugin.defaultConfig);
    await plugin.install(ctx);

    expect(ctx.services.sandbox).toBeTruthy();

    const pool = hoisted.poolInstances[0];
    pool.__sandbox.executeAsync.mockResolvedValueOnce('ok');

    const result = await ctx.services.sandbox.executeSkill('body', { args: { a: 1 } });
    expect(result).toBe('ok');
  });
});
