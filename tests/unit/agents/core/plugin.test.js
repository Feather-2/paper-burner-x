import { beforeEach, describe, expect, it, vi } from 'vitest';

const { EventBusMock, StateBusMock, ServiceBusMock } = vi.hoisted(() => {
  function EventBus() {
    this._handlers = new Map();
    this.emitSync = vi.fn((event, payload) => {
      this.emit(event, payload);
    });
  }

  EventBus.prototype.on = function on(event, callback) {
    const handlers = this._handlers.get(event) ?? new Set();
    handlers.add(callback);
    this._handlers.set(event, handlers);
    return vi.fn(() => handlers.delete(callback));
  };

  EventBus.prototype.emit = function emit(event, payload) {
    const handlers = this._handlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  };

  EventBus.prototype.dispose = function dispose() {
    this._handlers.clear();
  };

  function StateBus() {
    this._store = new Map();
    this._meta = new Map();
    this._subscriptions = new Set();
  }

  StateBus.prototype.get = function get(path) {
    if (path === undefined || path === null) return undefined;
    if (this._store.has(path)) return this._store.get(path);
    const prefix = `${path}.`;
    const result = {};
    let found = false;
    for (const [key, value] of this._store) {
      if (key.startsWith(prefix)) {
        found = true;
        const subKey = key.slice(prefix.length);
        result[subKey] = value;
      }
    }
    return found ? result : undefined;
  };

  StateBus.prototype.set = function set(path, value, meta = {}) {
    this._store.set(path, value);
    this._meta.set(path, meta ?? {});
    this._notify(path, value);
  };

  StateBus.prototype.merge = function merge(path, updates, meta = {}) {
    const current = this._store.get(path);
    let merged;
    if (current && typeof current === 'object' && updates && typeof updates === 'object') {
      merged = { ...current, ...updates };
    } else {
      merged = updates;
    }
    this._store.set(path, merged);
    this._meta.set(path, meta ?? {});
    this._notify(path, merged);
  };

  StateBus.prototype.subscribe = function subscribe(pattern, callback) {
    const entry = { pattern, callback };
    this._subscriptions.add(entry);
    const unsub = vi.fn(() => {
      this._subscriptions.delete(entry);
    });
    return unsub;
  };

  StateBus.prototype._notify = function _notify(path, value) {
    for (const entry of this._subscriptions) {
      if (this._matches(entry.pattern, path)) {
        entry.callback({ path, value });
      }
    }
  };

  StateBus.prototype._matches = function _matches(pattern, path) {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return pattern === path;
  };

  function ServiceBus() {
    this._services = new Map();
    this.register = vi.fn((name, service, options = {}) => {
      this._services.set(name, { service, options });
    });
    this.unregister = vi.fn((name) => {
      this._services.delete(name);
    });
  }

  ServiceBus.prototype.has = function has(name) {
    return this._services.has(name);
  };

  ServiceBus.prototype.get = function get(name) {
    return this._services.get(name);
  };

  return { EventBusMock: EventBus, StateBusMock: StateBus, ServiceBusMock: ServiceBus };
});

vi.mock('../../../../js/agents/core/event-bus.js', () => ({ EventBus: EventBusMock }));
vi.mock('../../../../js/agents/core/state-bus.js', () => ({ StateBus: StateBusMock }));
vi.mock('../../../../js/agents/core/service-bus.js', () => ({ ServiceBus: ServiceBusMock }));

import {
  createPlugin,
  PluginContext,
  PluginManager,
  PluginStatus,
} from '../../../../js/agents/core/plugin.js';
import { EventBus } from '../../../../js/agents/core/event-bus.js';
import { StateBus } from '../../../../js/agents/core/state-bus.js';
import { ServiceBus } from '../../../../js/agents/core/service-bus.js';

const LARGE_STRING = 'x'.repeat(200000);

function createMockKernel() {
  return {
    events: new EventBus(),
    state: new StateBus(),
    services: new ServiceBus(),
  };
}

function createDeepObject(depth) {
  let current = { level: depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    current = { level: i, child: current };
  }
  return current;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PluginStatus', () => {
  it('exposes expected states', () => {
    expect(PluginStatus.PENDING).toBe('pending');
    expect(PluginStatus.INSTALLING).toBe('installing');
    expect(PluginStatus.ACTIVE).toBe('active');
    expect(PluginStatus.ERROR).toBe('error');
    expect(PluginStatus.UNINSTALLED).toBe('uninstalled');
  });
});

describe('createPlugin', () => {
  it('throws when config or name is invalid', () => {
    expect(() => createPlugin()).toThrow();
    expect(() => createPlugin(null)).toThrow();
    expect(() => createPlugin({})).toThrow(/must have a name/);
    expect(() => createPlugin({ name: '' })).toThrow(/must have a name/);
    expect(() => createPlugin({ name: 123 })).toThrow(/must have a name/);
  });

  it('accepts whitespace and numeric string names', () => {
    const whitespace = createPlugin({ name: '   ' });
    const numeric = createPlugin({ name: '123' });

    expect(whitespace.name).toBe('   ');
    expect(numeric.name).toBe('123');
  });

  it('applies defaults for optional fields', () => {
    const plugin = createPlugin({ name: 'minimal' });

    expect(plugin.version).toBe('1.0.0');
    expect(plugin.description).toBe('');
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.defaultConfig).toEqual({});
    expect(typeof plugin.install).toBe('function');
    expect(typeof plugin.uninstall).toBe('function');
    expect(plugin.onStart).toBeNull();
    expect(plugin.onStop).toBeNull();
    expect(plugin.onError).toBeNull();
    expect(plugin._status).toBe(PluginStatus.PENDING);
    expect(plugin._context).toBeNull();
    expect(plugin._config).toBeNull();
  });

  it('preserves provided values and boundary types', () => {
    const dependencies = { dep: 'a' };
    const defaultConfig = {};
    const install = vi.fn();
    const uninstall = vi.fn();

    const plugin = createPlugin({
      name: 'custom',
      version: -1,
      description: 'desc',
      dependencies,
      defaultConfig,
      install,
      uninstall,
      onStart: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    });

    expect(plugin.version).toBe(-1);
    expect(plugin.dependencies).toBe(dependencies);
    expect(plugin.defaultConfig).toBe(defaultConfig);
    expect(plugin.install).toBe(install);
    expect(plugin.uninstall).toBe(uninstall);
  });

  it('handles version edge values and long description', () => {
    const longDescription = 'x'.repeat(50000);
    const zeroVersion = createPlugin({ name: 'zero', version: 0, description: longDescription });
    const maxVersion = createPlugin({ name: 'max', version: Number.MAX_SAFE_INTEGER });

    expect(zeroVersion.version).toBe('1.0.0');
    expect(zeroVersion.description).toBe(longDescription);
    expect(maxVersion.version).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('creates independent instances under rapid calls', async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => createPlugin({ name: 'fast-a', defaultConfig: { v: 0 } })),
      Promise.resolve().then(() => createPlugin({ name: 'fast-b', defaultConfig: { v: -1 } })),
    ]);

    expect(first).not.toBe(second);
    expect(first.name).toBe('fast-a');
    expect(second.name).toBe('fast-b');
    expect(first.defaultConfig).toEqual({ v: 0 });
    expect(second.defaultConfig).toEqual({ v: -1 });
  });
});

describe('PluginContext', () => {
  let kernel;

  beforeEach(() => {
    vi.restoreAllMocks();
    kernel = createMockKernel();
  });

  it('merges config shallowly with deep defaults and large payloads', () => {
    const deepDefaults = createDeepObject(12);
    const plugin = createPlugin({
      name: 'ctx',
      defaultConfig: {
        nested: deepDefaults,
        file: LARGE_STRING,
        keep: 'default',
        emptyObj: {},
      },
    });

    const ctx = new PluginContext(kernel, plugin, {
      nested: { override: true },
      keep: 'override',
      extra: 0,
    });

    expect(ctx.config).toEqual({
      nested: { override: true },
      file: LARGE_STRING,
      keep: 'override',
      emptyObj: {},
      extra: 0,
    });
  });

  it('uses defaults when config is undefined or empty', () => {
    const plugin = createPlugin({
      name: 'defaults',
      defaultConfig: { value: 1, empty: {} },
    });

    const ctxA = new PluginContext(kernel, plugin);
    const ctxB = new PluginContext(kernel, plugin, {});

    expect(ctxA.config).toEqual({ value: 1, empty: {} });
    expect(ctxB.config).toEqual({ value: 1, empty: {} });
  });

  it('exposes kernel APIs and logger prefix', () => {
    const plugin = createPlugin({ name: 'logger' });
    const ctx = new PluginContext(kernel, plugin);

    expect(ctx.events).toBe(kernel.events);
    expect(ctx.services).toBe(kernel.services);
    expect(ctx.state).toBeDefined();

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ctx.log.debug('debug');
    ctx.log.info('info');
    ctx.log.warn('warn');
    ctx.log.error('error');

    expect(debugSpy).toHaveBeenCalledWith('[logger]', 'debug');
    expect(infoSpy).toHaveBeenCalledWith('[logger]', 'info');
    expect(warnSpy).toHaveBeenCalledWith('[logger]', 'warn');
    expect(errorSpy).toHaveBeenCalledWith('[logger]', 'error');
  });

  it('scopes state access, preserves meta, and handles boundary paths', () => {
    const plugin = createPlugin({ name: 'scope' });
    const ctx = new PluginContext(kernel, plugin);

    ctx.state.set(0, 'zero', { trace: 't0' });
    ctx.state.set(-1, 'neg');
    ctx.state.set(Number.MAX_SAFE_INTEGER, 'max');
    ctx.state.set('   ', 'space');
    ctx.state.set('object', { a: 1 });
    ctx.state.merge('object', { b: 2 }, { trace: 'merge' });

    expect(kernel.state.get('plugins.scope.0')).toBe('zero');
    expect(kernel.state.get('plugins.scope.-1')).toBe('neg');
    expect(kernel.state.get(`plugins.scope.${Number.MAX_SAFE_INTEGER}`)).toBe('max');
    expect(kernel.state.get('plugins.scope.   ')).toBe('space');
    expect(kernel.state.get('plugins.scope.object')).toEqual({ a: 1, b: 2 });

    expect(ctx.state.get(0)).toBe('zero');
    expect(ctx.state.get('')).toEqual(ctx.state.get());

    expect(kernel.state._meta.get('plugins.scope.0')).toEqual({
      plugin: 'scope',
      trace: 't0',
    });
    expect(kernel.state._meta.get('plugins.scope.object')).toEqual({
      plugin: 'scope',
      trace: 'merge',
    });
  });

  it('exposes global state read access', () => {
    kernel.state.set('global.value', 'secret');

    const plugin = createPlugin({ name: 'reader' });
    const ctx = new PluginContext(kernel, plugin);

    expect(ctx.state.getGlobal('global.value')).toBe('secret');
  });

  it('tracks subscriptions/services and disposes cleanly', () => {
    const plugin = createPlugin({ name: 'cleanup' });
    const ctx = new PluginContext(kernel, plugin);

    ctx.registerService('svc', { run: () => 'ok' }, { scoped: true });

    const eventHandler = vi.fn();
    const eventUnsub = ctx.on('event.test', eventHandler);

    const stateHandler = vi.fn();
    const stateUnsub = ctx.state.subscribe('plugins.cleanup.*', stateHandler);

    expect(kernel.services.has('svc')).toBe(true);
    expect(ctx._services).toEqual(['svc']);
    expect(ctx._subscriptions).toContain(eventUnsub);
    expect(ctx._subscriptions).toContain(stateUnsub);

    kernel.events.emit('event.test', { value: 1 });
    ctx.state.set('value', 'one');

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(stateHandler).toHaveBeenCalledTimes(1);

    ctx.dispose();

    expect(eventUnsub).toHaveBeenCalledTimes(1);
    expect(stateUnsub).toHaveBeenCalledTimes(1);
    expect(kernel.services.has('svc')).toBe(false);
    expect(ctx._subscriptions.length).toBe(0);
    expect(ctx._services.length).toBe(0);

    kernel.events.emit('event.test', { value: 2 });
    ctx.state.set('value', 'two');

    expect(eventHandler).toHaveBeenCalledTimes(1);
    expect(stateHandler).toHaveBeenCalledTimes(1);
  });

  it('dispose is resilient and idempotent', () => {
    const plugin = createPlugin({ name: 'idempotent' });
    const ctx = new PluginContext(kernel, plugin);

    const brokenUnsub = vi.fn(() => {
      throw new Error('unsubscribe failed');
    });

    ctx._subscriptions.push(brokenUnsub);
    ctx._services.push('missing');

    expect(() => ctx.dispose()).not.toThrow();
    expect(() => ctx.dispose()).not.toThrow();

    expect(brokenUnsub).toHaveBeenCalledTimes(1);
    expect(ctx._subscriptions.length).toBe(0);
    expect(ctx._services.length).toBe(0);
  });
});

describe('PluginManager', () => {
  let kernel;
  let manager;

  beforeEach(() => {
    vi.restoreAllMocks();
    kernel = createMockKernel();
    manager = new PluginManager(kernel);
  });

  it('registers plugins and exposes list', () => {
    const plugin = createPlugin({ name: 'alpha', version: '2.0.0' });

    manager.register(plugin, {});

    expect(manager.getStatus('alpha')).toBe(PluginStatus.PENDING);
    expect(manager.list()).toEqual([
      {
        name: 'alpha',
        version: '2.0.0',
        status: PluginStatus.PENDING,
        dependencies: [],
      },
    ]);
  });

  it('throws on duplicate registration', () => {
    const plugin = createPlugin({ name: 'dup' });

    manager.register(plugin);

    expect(() => manager.register(plugin)).toThrow(/already registered/);
  });

  it('throws when installing unknown plugins', async () => {
    await expect(manager.install('missing')).rejects.toThrow(/not found/);
  });

  it('fails when dependencies are missing', async () => {
    const plugin = createPlugin({ name: 'needs', dependencies: ['missing'] });

    manager.register(plugin);

    await expect(manager.install('needs')).rejects.toThrow(/Missing dependency/);
    expect(manager.getStatus('needs')).toBe(PluginStatus.PENDING);
  });

  it('installs dependencies in order and wires context/config', async () => {
    const order = [];
    const dep = createPlugin({
      name: 'dep',
      install: () => {
        order.push('dep');
      },
    });
    const main = createPlugin({
      name: 'main',
      dependencies: ['dep'],
      install: () => {
        order.push('main');
      },
    });

    manager.register(main, { value: 0 });
    manager.register(dep);

    await manager.install('main');

    expect(order).toEqual(['dep', 'main']);
    expect(manager.getStatus('dep')).toBe(PluginStatus.ACTIVE);
    expect(manager.getStatus('main')).toBe(PluginStatus.ACTIVE);
    expect(main._context).toBeInstanceOf(PluginContext);
    expect(main._config).toEqual({ value: 0 });
    expect(kernel.events.emitSync).toHaveBeenCalledWith('plugin.installed', { name: 'dep' });
    expect(kernel.events.emitSync).toHaveBeenCalledWith('plugin.installed', { name: 'main' });
  });

  it('marks status error and clears context when install throws', async () => {
    const plugin = createPlugin({
      name: 'bad',
      install: () => {
        throw new Error('install failed');
      },
    });

    manager.register(plugin);

    await expect(manager.install('bad')).rejects.toThrow('install failed');
    expect(manager.getStatus('bad')).toBe(PluginStatus.ERROR);
    expect(manager.getContext('bad')).toBeUndefined();
    expect(kernel.events.emitSync).not.toHaveBeenCalled();
  });

  it('avoids re-installing active plugins on rapid calls', async () => {
    const install = vi.fn();
    const plugin = createPlugin({ name: 'once', install });

    manager.register(plugin);

    await manager.install('once');
    await manager.install('once');

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent installs without breaking state', async () => {
    const gate = createDeferred();
    const install = vi.fn(async () => {
      await gate.promise;
    });
    const plugin = createPlugin({ name: 'race', install });

    manager.register(plugin);

    const first = manager.install('race');
    const second = manager.install('race');

    expect(install).toHaveBeenCalledTimes(2);

    gate.resolve();
    await Promise.all([first, second]);

    expect(manager.getStatus('race')).toBe(PluginStatus.ACTIVE);
    expect(plugin._context).toBeInstanceOf(PluginContext);
  });

  it('installAll respects dependency ordering', async () => {
    const order = [];
    const pluginB = createPlugin({ name: 'b', install: () => order.push('b') });
    const pluginA = createPlugin({ name: 'a', dependencies: ['b'], install: () => order.push('a') });
    const pluginC = createPlugin({ name: 'c', dependencies: ['a'], install: () => order.push('c') });

    manager.register(pluginC);
    manager.register(pluginA);
    manager.register(pluginB);

    await manager.installAll();

    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
  });

  it('returns false when uninstalling inactive plugins', async () => {
    const plugin = createPlugin({ name: 'inactive' });

    manager.register(plugin);

    await expect(manager.uninstall('inactive')).resolves.toBe(false);
  });

  it('prevents uninstall when dependents are active', async () => {
    const base = createPlugin({ name: 'base' });
    const dependent = createPlugin({ name: 'dependent', dependencies: ['base'] });

    manager.register(dependent);
    manager.register(base);

    await manager.install('dependent');

    await expect(manager.uninstall('base')).rejects.toThrow(/depends on it/);
    expect(manager.getStatus('base')).toBe(PluginStatus.ACTIVE);
  });

  it('uninstalls active plugins and emits events', async () => {
    const plugin = createPlugin({ name: 'active' });

    manager.register(plugin);

    await manager.install('active');
    await expect(manager.uninstall('active')).resolves.toBe(true);

    expect(manager.getStatus('active')).toBe(PluginStatus.UNINSTALLED);
    expect(plugin._status).toBe(PluginStatus.UNINSTALLED);
    expect(kernel.events.emitSync).toHaveBeenCalledWith('plugin.uninstalled', { name: 'active' });
  });

  it('cleans up even when uninstall throws', async () => {
    const plugin = createPlugin({
      name: 'throwing',
      uninstall: () => {
        throw new Error('uninstall failed');
      },
    });

    manager.register(plugin);

    await manager.install('throwing');
    await expect(manager.uninstall('throwing')).rejects.toThrow('uninstall failed');

    expect(manager.getStatus('throwing')).toBe(PluginStatus.UNINSTALLED);
    expect(manager.getContext('throwing')).toBeUndefined();
    expect(kernel.events.emitSync).toHaveBeenCalledWith('plugin.uninstalled', { name: 'throwing' });
  });
});
