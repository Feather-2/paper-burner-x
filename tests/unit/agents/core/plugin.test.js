/**
 * Plugin System Tests
 * Tests for createPlugin, PluginContext, and PluginManager
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlugin,
  PluginContext,
  PluginManager,
  PluginStatus,
} from '../../../../js/agents/core/plugin.js';
import { EventBus } from '../../../../js/agents/core/event-bus.js';
import { StateBus } from '../../../../js/agents/core/state-bus.js';
import { ServiceBus } from '../../../../js/agents/core/service-bus.js';

/**
 * Create a minimal kernel-like object for testing
 */
function createMockKernel() {
  const events = new EventBus({ keepHistory: true });
  const state = new StateBus({ events, keepLog: true });
  const services = new ServiceBus({ events });

  return { events, state, services };
}

describe('createPlugin', () => {
  it('throws when name is missing', () => {
    expect(() => createPlugin({})).toThrow(/must have a name/);
    expect(() => createPlugin({ name: '' })).toThrow(/must have a name/);
    expect(() => createPlugin({ name: 123 })).toThrow(/must have a name/);
  });

  it('creates plugin with minimal config', () => {
    const plugin = createPlugin({ name: 'minimal' });

    expect(plugin.name).toBe('minimal');
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

  it('creates plugin with full config', () => {
    const install = vi.fn();
    const uninstall = vi.fn();
    const onStart = vi.fn();
    const onStop = vi.fn();
    const onError = vi.fn();

    const plugin = createPlugin({
      name: 'full-plugin',
      version: '2.0.0',
      description: 'A full plugin',
      dependencies: ['dep-a', 'dep-b'],
      defaultConfig: { option: 'value' },
      install,
      uninstall,
      onStart,
      onStop,
      onError,
    });

    expect(plugin.name).toBe('full-plugin');
    expect(plugin.version).toBe('2.0.0');
    expect(plugin.description).toBe('A full plugin');
    expect(plugin.dependencies).toEqual(['dep-a', 'dep-b']);
    expect(plugin.defaultConfig).toEqual({ option: 'value' });
    expect(plugin.install).toBe(install);
    expect(plugin.uninstall).toBe(uninstall);
    expect(plugin.onStart).toBe(onStart);
    expect(plugin.onStop).toBe(onStop);
    expect(plugin.onError).toBe(onError);
  });

  it('install/uninstall are no-ops by default', () => {
    const plugin = createPlugin({ name: 'no-op' });

    // Should not throw
    expect(plugin.install()).toBeUndefined();
    expect(plugin.uninstall()).toBeUndefined();
  });
});

describe('PluginStatus', () => {
  it('contains all expected states', () => {
    expect(PluginStatus.PENDING).toBe('pending');
    expect(PluginStatus.INSTALLING).toBe('installing');
    expect(PluginStatus.ACTIVE).toBe('active');
    expect(PluginStatus.ERROR).toBe('error');
    expect(PluginStatus.UNINSTALLED).toBe('uninstalled');
  });
});

describe('PluginContext', () => {
  let kernel;

  beforeEach(() => {
    kernel = createMockKernel();
  });

  afterEach(() => {
    kernel.events.dispose();
  });

  it('merges plugin defaultConfig with provided config', () => {
    const plugin = createPlugin({
      name: 'ctx-test',
      defaultConfig: { a: 1, b: 2 },
    });

    const ctx = new PluginContext(kernel, plugin, { b: 20, c: 30 });

    expect(ctx.config).toEqual({ a: 1, b: 20, c: 30 });
  });

  it('exposes kernel buses', () => {
    const plugin = createPlugin({ name: 'buses' });
    const ctx = new PluginContext(kernel, plugin);

    expect(ctx.events).toBe(kernel.events);
    expect(ctx.services).toBe(kernel.services);
    expect(ctx.state).toBeDefined();
  });

  it('provides scoped state accessors', () => {
    const plugin = createPlugin({ name: 'scoped' });
    const ctx = new PluginContext(kernel, plugin);

    // Set via scoped state
    ctx.state.set('foo', 'bar');
    expect(kernel.state.get('plugins.scoped.foo')).toBe('bar');

    // Get via scoped state
    expect(ctx.state.get('foo')).toBe('bar');

    // Get plugin root
    expect(ctx.state.get()).toEqual({ foo: 'bar' });

    // Merge
    ctx.state.merge('nested', { x: 1 });
    expect(kernel.state.get('plugins.scoped.nested')).toEqual({ x: 1 });
  });

  it('provides global state read-only access', () => {
    kernel.state.set('global.data', 'secret');

    const plugin = createPlugin({ name: 'reader' });
    const ctx = new PluginContext(kernel, plugin);

    expect(ctx.state.getGlobal('global.data')).toBe('secret');
  });

  it('provides logger with plugin prefix', () => {
    const plugin = createPlugin({ name: 'logger-test' });
    const ctx = new PluginContext(kernel, plugin);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ctx.log.debug('debug msg');
    ctx.log.info('info msg');
    ctx.log.warn('warn msg');
    ctx.log.error('error msg');

    expect(debugSpy).toHaveBeenCalledWith('[logger-test]', 'debug msg');
    expect(infoSpy).toHaveBeenCalledWith('[logger-test]', 'info msg');
    expect(warnSpy).toHaveBeenCalledWith('[logger-test]', 'warn msg');
    expect(errorSpy).toHaveBeenCalledWith('[logger-test]', 'error msg');

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('registerService tracks services for cleanup', () => {
    const plugin = createPlugin({ name: 'svc-reg' });
    const ctx = new PluginContext(kernel, plugin);

    ctx.registerService('myService', { fn: () => 'ok' });

    expect(kernel.services.has('myService')).toBe(true);
    expect(ctx._services).toContain('myService');
  });

  it('on() subscribes to events and tracks for cleanup', () => {
    const plugin = createPlugin({ name: 'evt-sub' });
    const ctx = new PluginContext(kernel, plugin);

    const handler = vi.fn();
    const unsub = ctx.on('test.event', handler);

    expect(ctx._subscriptions).toContain(unsub);

    kernel.events.emit('test.event', { data: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('state.subscribe tracks subscriptions for cleanup', () => {
    const plugin = createPlugin({ name: 'state-sub' });
    const ctx = new PluginContext(kernel, plugin);

    const handler = vi.fn();
    const unsub = ctx.state.subscribe('plugins.state-sub.*', handler);

    expect(ctx._subscriptions).toContain(unsub);
  });

  it('dispose cleans up all subscriptions and services', () => {
    const plugin = createPlugin({ name: 'disposable' });
    const ctx = new PluginContext(kernel, plugin);

    // Register service
    ctx.registerService('dispSvc', { fn: () => {} });

    // Subscribe to events
    const evtHandler = vi.fn();
    ctx.on('dispose.evt', evtHandler);

    // Subscribe to state
    const stateHandler = vi.fn();
    ctx.state.subscribe('plugins.disposable.*', stateHandler);

    expect(ctx._subscriptions.length).toBe(2);
    expect(ctx._services.length).toBe(1);

    ctx.dispose();

    expect(ctx._subscriptions.length).toBe(0);
    expect(ctx._services.length).toBe(0);
    expect(kernel.services.has('dispSvc')).toBe(false);

    // Event should no longer fire
    kernel.events.emit('dispose.evt', {});
    expect(evtHandler).not.toHaveBeenCalled();
  });

  it('dispose handles errors in unsub/unregister gracefully', () => {
    const plugin = createPlugin({ name: 'err-dispose' });
    const ctx = new PluginContext(kernel, plugin);

    // Add a broken unsubscribe
    ctx._subscriptions.push(() => {
      throw new Error('unsub error');
    });

    // Add a service that's already removed
    ctx._services.push('nonexistent');

    // Should not throw
    expect(() => ctx.dispose()).not.toThrow();
    expect(ctx._subscriptions.length).toBe(0);
    expect(ctx._services.length).toBe(0);
  });
});

describe('PluginManager', () => {
  let kernel;
  let manager;

  beforeEach(() => {
    kernel = createMockKernel();
    manager = new PluginManager(kernel);
  });

  afterEach(() => {
    kernel.events.dispose();
  });

  describe('register', () => {
    it('registers a plugin', () => {
      const plugin = createPlugin({ name: 'reg-test' });
      const result = manager.register(plugin);

      expect(result).toBe(manager); // chainable
      expect(manager.getStatus('reg-test')).toBe(PluginStatus.PENDING);
    });

    it('throws on duplicate registration', () => {
      const plugin = createPlugin({ name: 'dup' });
      manager.register(plugin);

      expect(() => manager.register(plugin)).toThrow(/already registered/);
    });

    it('stores config with plugin', () => {
      const plugin = createPlugin({ name: 'with-config' });
      manager.register(plugin, { custom: 'value' });

      // Config is accessible after install
      // (Tested in install tests)
    });
  });

  describe('install', () => {
    it('installs a registered plugin', async () => {
      const install = vi.fn();
      const plugin = createPlugin({ name: 'inst', install });

      manager.register(plugin);
      await manager.install('inst');

      expect(install).toHaveBeenCalledTimes(1);
      expect(install.mock.calls[0][0]).toBeInstanceOf(PluginContext);
      expect(manager.getStatus('inst')).toBe(PluginStatus.ACTIVE);
      expect(plugin._status).toBe(PluginStatus.ACTIVE);
    });

    it('throws for unknown plugin', async () => {
      await expect(manager.install('unknown')).rejects.toThrow(/not found/);
    });

    it('skips already active plugin', async () => {
      const install = vi.fn();
      const plugin = createPlugin({ name: 'skip', install });

      manager.register(plugin);
      await manager.install('skip');
      await manager.install('skip'); // second call

      expect(install).toHaveBeenCalledTimes(1);
    });

    it('emits plugin.installed event', async () => {
      const plugin = createPlugin({ name: 'evt-test' });
      manager.register(plugin);

      const handler = vi.fn();
      kernel.events.on('plugin.installed', handler);

      await manager.install('evt-test');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plugin.installed',
          payload: expect.objectContaining({ name: 'evt-test' }),
        })
      );
    });

    it('merges config into context', async () => {
      let capturedCtx;
      const plugin = createPlugin({
        name: 'cfg-merge',
        defaultConfig: { a: 1 },
        install: (ctx) => {
          capturedCtx = ctx;
        },
      });

      manager.register(plugin, { b: 2 });
      await manager.install('cfg-merge');

      expect(capturedCtx.config).toEqual({ a: 1, b: 2 });
      expect(plugin._config).toEqual({ b: 2 });
    });

    it('sets plugin internal state on success', async () => {
      const plugin = createPlugin({ name: 'internal' });
      manager.register(plugin);
      await manager.install('internal');

      expect(plugin._status).toBe(PluginStatus.ACTIVE);
      expect(plugin._context).toBeInstanceOf(PluginContext);
    });

    it('handles install error and sets ERROR status', async () => {
      const plugin = createPlugin({
        name: 'fail-install',
        install: () => {
          throw new Error('install failed');
        },
      });

      manager.register(plugin);

      await expect(manager.install('fail-install')).rejects.toThrow(
        /install failed/
      );
      expect(manager.getStatus('fail-install')).toBe(PluginStatus.ERROR);
      expect(manager.getContext('fail-install')).toBeUndefined();
    });
  });

  describe('dependencies', () => {
    it('installs dependencies first', async () => {
      const order = [];

      const depA = createPlugin({
        name: 'dep-a',
        install: () => order.push('dep-a'),
      });

      const depB = createPlugin({
        name: 'dep-b',
        dependencies: ['dep-a'],
        install: () => order.push('dep-b'),
      });

      const main = createPlugin({
        name: 'main',
        dependencies: ['dep-b'],
        install: () => order.push('main'),
      });

      manager.register(depA);
      manager.register(depB);
      manager.register(main);

      await manager.install('main');

      expect(order).toEqual(['dep-a', 'dep-b', 'main']);
    });

    it('throws for missing dependency', async () => {
      const plugin = createPlugin({
        name: 'needs-missing',
        dependencies: ['missing-dep'],
      });

      manager.register(plugin);

      await expect(manager.install('needs-missing')).rejects.toThrow(
        /Missing dependency.*missing-dep/
      );
    });

    it('does not reinstall already active dependencies', async () => {
      const depInstall = vi.fn();
      const dep = createPlugin({ name: 'shared-dep', install: depInstall });

      const pluginA = createPlugin({
        name: 'plugin-a',
        dependencies: ['shared-dep'],
      });

      const pluginB = createPlugin({
        name: 'plugin-b',
        dependencies: ['shared-dep'],
      });

      manager.register(dep);
      manager.register(pluginA);
      manager.register(pluginB);

      await manager.install('plugin-a');
      await manager.install('plugin-b');

      expect(depInstall).toHaveBeenCalledTimes(1);
    });
  });

  describe('installAll', () => {
    it('installs all plugins in topological order', async () => {
      const order = [];

      const a = createPlugin({
        name: 'a',
        install: () => order.push('a'),
      });

      const b = createPlugin({
        name: 'b',
        dependencies: ['a'],
        install: () => order.push('b'),
      });

      const c = createPlugin({
        name: 'c',
        dependencies: ['b'],
        install: () => order.push('c'),
      });

      // Register in reverse order to test sorting
      manager.register(c);
      manager.register(b);
      manager.register(a);

      await manager.installAll();

      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('handles diamond dependencies', async () => {
      const order = [];

      const base = createPlugin({
        name: 'base',
        install: () => order.push('base'),
      });

      const left = createPlugin({
        name: 'left',
        dependencies: ['base'],
        install: () => order.push('left'),
      });

      const right = createPlugin({
        name: 'right',
        dependencies: ['base'],
        install: () => order.push('right'),
      });

      const top = createPlugin({
        name: 'top',
        dependencies: ['left', 'right'],
        install: () => order.push('top'),
      });

      manager.register(top);
      manager.register(right);
      manager.register(left);
      manager.register(base);

      await manager.installAll();

      // base should come first, top should come last
      expect(order[0]).toBe('base');
      expect(order[order.length - 1]).toBe('top');
      expect(order).toContain('left');
      expect(order).toContain('right');
    });
  });

  describe('uninstall', () => {
    it('uninstalls an active plugin', async () => {
      const uninstall = vi.fn();
      const plugin = createPlugin({ name: 'uninst', uninstall });

      manager.register(plugin);
      await manager.install('uninst');

      const result = await manager.uninstall('uninst');

      expect(result).toBe(true);
      expect(uninstall).toHaveBeenCalledTimes(1);
      expect(manager.getStatus('uninst')).toBe(PluginStatus.UNINSTALLED);
      expect(plugin._status).toBe(PluginStatus.UNINSTALLED);
    });

    it('returns false for non-existent plugin', async () => {
      const result = await manager.uninstall('nonexistent');
      expect(result).toBe(false);
    });

    it('returns false for non-active plugin', async () => {
      const plugin = createPlugin({ name: 'pending' });
      manager.register(plugin);

      const result = await manager.uninstall('pending');
      expect(result).toBe(false);
    });

    it('emits plugin.uninstalled event', async () => {
      const plugin = createPlugin({ name: 'evt-uninst' });
      manager.register(plugin);
      await manager.install('evt-uninst');

      const handler = vi.fn();
      kernel.events.on('plugin.uninstalled', handler);

      await manager.uninstall('evt-uninst');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'plugin.uninstalled',
          payload: expect.objectContaining({ name: 'evt-uninst' }),
        })
      );
    });

    it('disposes context on uninstall', async () => {
      const plugin = createPlugin({ name: 'ctx-disp' });
      manager.register(plugin);
      await manager.install('ctx-disp');

      const ctx = manager.getContext('ctx-disp');
      const disposeSpy = vi.spyOn(ctx, 'dispose');

      await manager.uninstall('ctx-disp');

      expect(disposeSpy).toHaveBeenCalled();
      expect(manager.getContext('ctx-disp')).toBeUndefined();
    });

    it('prevents uninstall if other plugins depend on it', async () => {
      const dep = createPlugin({ name: 'dep' });
      const dependent = createPlugin({
        name: 'dependent',
        dependencies: ['dep'],
      });

      manager.register(dep);
      manager.register(dependent);
      await manager.installAll();

      await expect(manager.uninstall('dep')).rejects.toThrow(
        /Cannot uninstall dep.*dependent depends on it/
      );
    });

    it('allows uninstall after dependent is uninstalled', async () => {
      const dep = createPlugin({ name: 'dep2' });
      const dependent = createPlugin({
        name: 'dependent2',
        dependencies: ['dep2'],
      });

      manager.register(dep);
      manager.register(dependent);
      await manager.installAll();

      await manager.uninstall('dependent2');
      const result = await manager.uninstall('dep2');

      expect(result).toBe(true);
    });

    it('disposes context even if uninstall hook throws', async () => {
      const plugin = createPlugin({
        name: 'throw-uninst',
        uninstall: () => {
          throw new Error('uninstall error');
        },
      });

      manager.register(plugin);
      await manager.install('throw-uninst');

      const ctx = manager.getContext('throw-uninst');
      const disposeSpy = vi.spyOn(ctx, 'dispose');

      await expect(manager.uninstall('throw-uninst')).rejects.toThrow(
        /uninstall error/
      );

      // Context should still be disposed
      expect(disposeSpy).toHaveBeenCalled();
      expect(manager.getContext('throw-uninst')).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    it('returns null for unknown plugin', () => {
      expect(manager.getStatus('unknown')).toBeNull();
    });

    it('returns correct status', async () => {
      const plugin = createPlugin({ name: 'status-test' });

      manager.register(plugin);
      expect(manager.getStatus('status-test')).toBe(PluginStatus.PENDING);

      await manager.install('status-test');
      expect(manager.getStatus('status-test')).toBe(PluginStatus.ACTIVE);

      await manager.uninstall('status-test');
      expect(manager.getStatus('status-test')).toBe(PluginStatus.UNINSTALLED);
    });
  });

  describe('list', () => {
    it('returns all registered plugins with metadata', async () => {
      const a = createPlugin({
        name: 'list-a',
        version: '1.0.0',
        dependencies: [],
      });

      const b = createPlugin({
        name: 'list-b',
        version: '2.0.0',
        dependencies: ['list-a'],
      });

      manager.register(a);
      manager.register(b);
      await manager.install('list-a');

      const list = manager.list();

      expect(list).toHaveLength(2);

      const itemA = list.find((p) => p.name === 'list-a');
      expect(itemA).toEqual({
        name: 'list-a',
        version: '1.0.0',
        status: PluginStatus.ACTIVE,
        dependencies: [],
      });

      const itemB = list.find((p) => p.name === 'list-b');
      expect(itemB).toEqual({
        name: 'list-b',
        version: '2.0.0',
        status: PluginStatus.PENDING,
        dependencies: ['list-a'],
      });
    });
  });

  describe('getContext', () => {
    it('returns context for installed plugin', async () => {
      const plugin = createPlugin({ name: 'get-ctx' });
      manager.register(plugin);
      await manager.install('get-ctx');

      const ctx = manager.getContext('get-ctx');
      expect(ctx).toBeInstanceOf(PluginContext);
    });

    it('returns undefined for non-installed plugin', () => {
      const plugin = createPlugin({ name: 'no-ctx' });
      manager.register(plugin);

      expect(manager.getContext('no-ctx')).toBeUndefined();
    });

    it('returns undefined for unknown plugin', () => {
      expect(manager.getContext('unknown')).toBeUndefined();
    });
  });

  describe('topological sort', () => {
    it('handles plugins with no dependencies', async () => {
      const a = createPlugin({ name: 'no-dep-a' });
      const b = createPlugin({ name: 'no-dep-b' });
      const c = createPlugin({ name: 'no-dep-c' });

      manager.register(a);
      manager.register(b);
      manager.register(c);

      // Should not throw
      await manager.installAll();

      expect(manager.getStatus('no-dep-a')).toBe(PluginStatus.ACTIVE);
      expect(manager.getStatus('no-dep-b')).toBe(PluginStatus.ACTIVE);
      expect(manager.getStatus('no-dep-c')).toBe(PluginStatus.ACTIVE);
    });

    it('handles complex dependency graph', async () => {
      const order = [];

      // Create a more complex graph:
      // e -> d -> b -> a
      //      d -> c -> a
      const a = createPlugin({
        name: 'g-a',
        install: () => order.push('a'),
      });

      const b = createPlugin({
        name: 'g-b',
        dependencies: ['g-a'],
        install: () => order.push('b'),
      });

      const c = createPlugin({
        name: 'g-c',
        dependencies: ['g-a'],
        install: () => order.push('c'),
      });

      const d = createPlugin({
        name: 'g-d',
        dependencies: ['g-b', 'g-c'],
        install: () => order.push('d'),
      });

      const e = createPlugin({
        name: 'g-e',
        dependencies: ['g-d'],
        install: () => order.push('e'),
      });

      // Register in random order
      manager.register(e);
      manager.register(c);
      manager.register(a);
      manager.register(d);
      manager.register(b);

      await manager.installAll();

      // Verify order constraints
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
      expect(order.indexOf('d')).toBeLessThan(order.indexOf('e'));
    });
  });
});
