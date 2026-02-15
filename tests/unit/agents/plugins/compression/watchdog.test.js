import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../js/agents/core/plugin.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/core/plugin.js');
  return {
    ...actual,
    createPlugin: vi.fn((config) => actual.createPlugin(config)),
  };
});

import watchdogPlugin from '../../../../../js/agents/plugins/compression/watchdog.js';

function createMockCtx({ config = {}, globals = {} } = {}) {
  const localState = new Map();
  const globalState = new Map(Object.entries(globals));
  const unsubscribe = vi.fn();

  /** @type {any} */
  const ctx = {
    config: {
      threshold: 0.75,
      checkInterval: 5000,
      autoCompress: true,
      maxContextTokens: 100000,
      ...config,
    },
    _services: {},
    _watchdogInterval: null,
    _watchdogCleanup: null,
    events: { emit: vi.fn() },
    services: { call: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    state: {
      getGlobal: vi.fn((path) => globalState.get(path)),
      get: vi.fn((path) => localState.get(path)),
      set: vi.fn((path, value) => {
        localState.set(path, value);
      }),
    },
    registerService: vi.fn((name, service) => {
      ctx._services[name] = service;
    }),
    on: vi.fn((pattern, cb) => {
      ctx._subscription = { pattern, cb };
      return unsubscribe;
    }),
    _unsubscribe: unsubscribe,
    __setGlobal: (path, value) => globalState.set(path, value),
    __getLocal: (path) => localState.get(path),
  };

  return ctx;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('default', () => {
  it('registers watchdog service and reports healthy state under threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 10, output: 0 },
        'runtime.messages': [{ role: 'user', content: 'hello' }],
      },
    });

    await watchdogPlugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith('watchdog', expect.any(Object));
    expect(ctx._services.watchdog).toEqual(expect.any(Object));
    expect(typeof ctx._services.watchdog.check).toBe('function');
    expect(typeof ctx._services.watchdog.getHealth).toBe('function');

    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.usage).toBeCloseTo(0.1);
    expect(health.checkedAt).toBe(0);
    expect(ctx.services.call).not.toHaveBeenCalled();
    expect(ctx.events.emit).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);

    expect(ctx._watchdogInterval).toBeNull();
    expect(ctx._watchdogCleanup).toBeNull();
  });

  it('emits threshold event and auto-compresses when over budget with messages', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 80, output: 0 },
        'runtime.messages': messages,
      },
    });
    ctx.services.call.mockResolvedValue({ ok: true });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('warning');
    expect(health.usage).toBeCloseTo(0.8);
    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 0.8,
      threshold: 0.75,
    });
    expect(ctx.services.call).toHaveBeenCalledWith('compression', 'compress', [messages]);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining('Auto-compressed'));

    await watchdogPlugin.uninstall(ctx);
  });

  it('keeps warning status but skips emit/compress when autoCompress is false', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: false, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 80, output: 0 },
        'runtime.messages': [{ role: 'user', content: 'hello' }],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('warning');
    expect(ctx.events.emit).not.toHaveBeenCalled();
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('treats usage equal to threshold as healthy', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 75, output: 0 },
        'runtime.messages': [{ role: 'user', content: 'hello' }],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('healthy');
    expect(ctx.events.emit).not.toHaveBeenCalled();
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('handles null tokens, undefined messages, and falsy maxContextTokens', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, maxContextTokens: 0 },
      globals: {
        'runtime.tokens': null,
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.usage).toBe(0);
    expect(ctx.events.emit).not.toHaveBeenCalled();
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('emits threshold event but skips compression for empty message array', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 80, output: 0 },
        'runtime.messages': [],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 0.8,
      threshold: 0.75,
    });
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('handles empty tokens object without crashing', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': {},
        'runtime.messages': [],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe('healthy');
    expect(Number.isNaN(health.usage)).toBe(true);
    expect(ctx.events.emit).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('emits threshold event but skips compression when messages is not an array', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 80, output: 0 },
        'runtime.messages': {},
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 0.8,
      threshold: 0.75,
    });
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it('accepts numeric strings for threshold and maxContextTokens', async () => {
    const messages = [{ role: 'user', content: 'ok' }];
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: '0.5', maxContextTokens: '100' },
      globals: {
        'runtime.tokens': { input: 60, output: 0 },
        'runtime.messages': messages,
      },
    });
    ctx.services.call.mockResolvedValue({ ok: true });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.usage).toBeCloseTo(0.6);
    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 0.6,
      threshold: '0.5',
    });
    expect(ctx.services.call).toHaveBeenCalledWith('compression', 'compress', [messages]);

    await watchdogPlugin.uninstall(ctx);
  });

  it('handles empty string checkInterval and whitespace threshold', async () => {
    const messages = [''];
    const ctx = createMockCtx({
      config: { checkInterval: '', threshold: ' ', maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 1, output: 0 },
        'runtime.messages': messages,
      },
    });
    ctx.services.call.mockResolvedValue({ ok: true });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx._watchdogInterval).toBeNull();
    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 0.01,
      threshold: ' ',
    });
    expect(ctx.services.call).toHaveBeenCalledWith('compression', 'compress', [messages]);

    await watchdogPlugin.uninstall(ctx);
  });

  it('handles negative maxContextTokens', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, maxContextTokens: -1 },
      globals: {
        'runtime.tokens': { input: 10, output: 0 },
        'runtime.messages': [],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.usage).toBe(-10);
    expect(health.status).toBe('healthy');

    await watchdogPlugin.uninstall(ctx);
  });

  it('handles MAX_SAFE_INTEGER tokens with large, nested messages', async () => {
    const largeContent = 'x'.repeat(100000);
    const messages = [
      {
        role: 'user',
        content: largeContent,
        file: largeContent,
        meta: { nested: { depth: { value: 1 } } },
      },
    ];
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: Number.MAX_SAFE_INTEGER },
      globals: {
        'runtime.tokens': { input: Number.MAX_SAFE_INTEGER, output: 0 },
        'runtime.messages': messages,
      },
    });
    ctx.services.call.mockResolvedValue({ ok: true });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith('watchdog:threshold:exceeded', {
      usage: 1,
      threshold: 0.75,
    });
    expect(ctx.services.call).toHaveBeenCalledWith('compression', 'compress', [messages]);

    await watchdogPlugin.uninstall(ctx);
  });

  it('logs errors from scheduled health checks', async () => {
    vi.useFakeTimers();

    const ctx = createMockCtx({
      config: { checkInterval: 1000 },
      globals: {
        'runtime.tokens': { input: 0, output: 0 },
      },
    });
    ctx.state.getGlobal.mockImplementation(() => {
      throw new Error('boom');
    });

    await watchdogPlugin.install(ctx);

    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();

    expect(ctx.log.error).toHaveBeenCalledWith('Scheduled health check failed:', expect.any(Error));

    await watchdogPlugin.uninstall(ctx);
  });

  it('rate-limits rapid token event checks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 10, output: 0 },
        'runtime.messages': [],
      },
    });

    await watchdogPlugin.install(ctx);

    await ctx._services.watchdog.check();
    ctx.state.set.mockClear();

    vi.setSystemTime(new Date(500));
    ctx._subscription.cb();
    expect(ctx.state.set).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(1501));
    ctx._subscription.cb();
    expect(ctx.state.set).toHaveBeenCalledTimes(1);

    await watchdogPlugin.uninstall(ctx);
  });

  it('supports concurrent manual checks', async () => {
    const ctx = createMockCtx({
      config: { checkInterval: 0, maxContextTokens: 100 },
      globals: {
        'runtime.tokens': { input: 1, output: 0 },
        'runtime.messages': [],
      },
    });

    await watchdogPlugin.install(ctx);

    await Promise.all([
      ctx._services.watchdog.check(),
      ctx._services.watchdog.check(),
      ctx._services.watchdog.check(),
    ]);

    expect(ctx.state.set).toHaveBeenCalledTimes(3);

    await watchdogPlugin.uninstall(ctx);
  });

  it('invokes previous cleanup on re-install and logs warning if it throws', async () => {
    const oldCleanup = vi.fn(() => {
      throw new Error('ignore');
    });
    const ctx = createMockCtx({
      config: { checkInterval: 0 },
      globals: { 'runtime.tokens': { input: 0, output: 0 } },
    });
    ctx._watchdogCleanup = oldCleanup;

    await expect(watchdogPlugin.install(ctx)).resolves.toBeUndefined();
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith('Watchdog cleanup failed:', expect.any(Error));

    await watchdogPlugin.uninstall(ctx);
  });

  it('logs warning when unsubscribe throws during cleanup', async () => {
    const unsubscribe = vi.fn(() => {
      throw new Error('unsubscribe fail');
    });
    const ctx = createMockCtx({
      config: { checkInterval: 0 },
      globals: { 'runtime.tokens': { input: 0, output: 0 } },
    });
    ctx.on.mockImplementation((pattern, cb) => {
      ctx._subscription = { pattern, cb };
      return unsubscribe;
    });

    await watchdogPlugin.install(ctx);
    await watchdogPlugin.uninstall(ctx);

    expect(ctx.log.warn).toHaveBeenCalledWith('Watchdog unsubscribe failed:', expect.any(Error));
  });

  it('cleans up interval and state when install fails partway', async () => {
    vi.useFakeTimers();

    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const ctx = createMockCtx({
      config: { checkInterval: 1000 },
      globals: { 'runtime.tokens': { input: 0, output: 0 } },
    });
    ctx.on.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(watchdogPlugin.install(ctx)).rejects.toThrow(/boom/);

    expect(clearSpy).toHaveBeenCalled();
    expect(ctx.registerService).not.toHaveBeenCalled();
    expect(ctx._watchdogCleanup).toBeNull();
    expect(ctx._watchdogInterval).toBeNull();
  });

  it('uninstall clears interval when cleanup is missing', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const ctx = createMockCtx({ config: { checkInterval: 0 } });
    ctx._watchdogCleanup = null;
    ctx._watchdogInterval = 123;

    await watchdogPlugin.uninstall(ctx);

    expect(clearSpy).toHaveBeenCalledWith(123);
    expect(ctx._watchdogInterval).toBeNull();
  });
});
