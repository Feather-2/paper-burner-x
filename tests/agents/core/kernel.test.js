/**
 * Kernel 集成测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Kernel,
  KernelStatus,
  KernelBuilder,
  createPlugin,
  PluginManager,
  PluginStatus,
  EventBus,
  StateBus,
  ServiceBus,
} from '../../../js/agents/core/index.js';

function createDeferred() {
  /** @type {(value?: unknown) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Kernel', () => {
  let kernel;

  afterEach(async () => {
    if (kernel && kernel.status === KernelStatus.RUNNING) {
      await kernel.stop();
    }
    kernel = null;
  });

  describe('lifecycle', () => {
    it('should create with CREATED status', () => {
      kernel = new Kernel();
      expect(kernel.status).toBe(KernelStatus.CREATED);
    });

    it('should start and stop correctly', async () => {
      kernel = new Kernel();
      await kernel.start();
      expect(kernel.status).toBe(KernelStatus.RUNNING);

      await kernel.stop();
      expect(kernel.status).toBe(KernelStatus.STOPPED);
    });

    it('should emit lifecycle events', async () => {
      kernel = new Kernel({ keepHistory: true });
      await kernel.start();
      await kernel.stop();

      const history = kernel.events.getHistory();
      const types = history.map(e => e.type);
      expect(types).toContain('kernel.started');
      expect(types).toContain('kernel.stopped');
    });
  });

  describe('static create()', () => {
    it('should create and start with minimal preset', async () => {
      kernel = await Kernel.create('minimal');
      expect(kernel.status).toBe(KernelStatus.RUNNING);
    });

    it('should accept custom config', async () => {
      kernel = await Kernel.create('minimal', { id: 'test-kernel' });
      expect(kernel.id).toBe('test-kernel');
    });
  });

  describe('services', () => {
    beforeEach(() => {
      kernel = new Kernel();
    });

    it('should register and get service', async () => {
      const myService = { greet: () => 'hello' };
      kernel.registerService('greeter', myService);

      const service = await kernel.services.get('greeter');
      expect(service.greet()).toBe('hello');
    });

    it('should support factory registration (lazy load)', async () => {
      const factory = vi.fn(() => ({ value: 42 }));
      kernel.registerServiceFactory('lazy', factory);

      expect(factory).not.toHaveBeenCalled();

      const service = await kernel.services.get('lazy');
      expect(factory).toHaveBeenCalledTimes(1);
      expect(service.value).toBe(42);

      // Second get should not call factory again
      await kernel.services.get('lazy');
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should call service methods', async () => {
      kernel.registerService('math', {
        add: (a, b) => a + b,
        multiply: (a, b) => a * b,
      });

      await kernel.start();

      const sum = await kernel.call('math', 'add', [2, 3]);
      expect(sum).toBe(5);

      const product = await kernel.invoke('math.multiply', 4, 5);
      expect(product).toBe(20);
    });
  });

  describe('plugins', () => {
    it('should install plugin on start', async () => {
      const installFn = vi.fn();
      const plugin = createPlugin({
        name: 'test-plugin',
        install: installFn,
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      expect(installFn).toHaveBeenCalledTimes(1);
    });

    it('should pass context to plugin', async () => {
      let capturedCtx;
      const plugin = createPlugin({
        name: 'ctx-plugin',
        install: (ctx) => {
          capturedCtx = ctx;
        },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx.events).toBeInstanceOf(EventBus);
      expect(capturedCtx.services).toBeInstanceOf(ServiceBus);
      expect(capturedCtx.log).toBeDefined();
    });

    it('should respect plugin dependencies', async () => {
      const order = [];

      const pluginA = createPlugin({
        name: 'plugin-a',
        install: () => order.push('a'),
      });

      const pluginB = createPlugin({
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        install: () => order.push('b'),
      });

      kernel = new Kernel();
      // Register B first, but A should install first due to dependency
      await kernel.use(pluginB);
      await kernel.use(pluginA);
      await kernel.start();

      expect(order).toEqual(['a', 'b']);
    });

    it('should call onStart and onStop hooks', async () => {
      const hooks = [];
      const plugin = createPlugin({
        name: 'hooks-plugin',
        install: () => hooks.push('install'),
        onStart: () => hooks.push('start'),
        onStop: () => hooks.push('stop'),
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();
      await kernel.stop();

      expect(hooks).toEqual(['install', 'start', 'stop']);
    });

    it('should provide scoped state to plugins', async () => {
      let pluginState;
      const plugin = createPlugin({
        name: 'state-plugin',
        install: (ctx) => {
          ctx.state.set('counter', 0);
          ctx.state.set('name', 'test');
          pluginState = ctx.state;
        },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      // Plugin state is scoped
      expect(pluginState.get('counter')).toBe(0);
      expect(pluginState.get('name')).toBe('test');

      // Global state access
      expect(kernel.state.get('plugins.state-plugin.counter')).toBe(0);
    });
  });

  describe('custom plugin loader', () => {
    it('should use injected pluginLoader', async () => {
      const customLoader = vi.fn(async (name) => {
        return createPlugin({
          name,
          install: () => {},
        });
      });

      kernel = new Kernel({ pluginLoader: customLoader });
      await kernel.use('custom/my-plugin');
      await kernel.start();

      expect(customLoader).toHaveBeenCalledWith('custom/my-plugin');
    });
  });

  describe('legacy API compatibility', () => {
    beforeEach(() => {
      kernel = new Kernel();
    });

    it('should support kernel.register()', () => {
      kernel.register('legacy-service', { value: 123 });
      expect(kernel.services.has('legacy-service')).toBe(true);
    });

    it('should support kernel.getService()', async () => {
      kernel.registerService('my-service', { data: 'test' });
      const service = await kernel.getService('my-service');
      expect(service.data).toBe('test');
    });

    it('should support kernel.emit() and kernel.on()', async () => {
      const handler = vi.fn();
      kernel.on('test.event', handler);
      await kernel.emit('test.event', { value: 42 });

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].payload).toEqual({ value: 42 });
    });

    it('should expose container-like interface', () => {
      kernel.container.register('container-service', () => ({ x: 1 }));
      expect(kernel.container.has('container-service')).toBe(true);
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      kernel = await Kernel.create('minimal');
      const health = await kernel.healthCheck();

      expect(health.kernelId).toBe(kernel.id);
      expect(health.status).toBe(KernelStatus.RUNNING);
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.plugins).toBeDefined();
      expect(health.services).toBeDefined();
    });
  });

  describe('snapshot', () => {
    it('should return kernel snapshot', async () => {
      kernel = await Kernel.create('minimal');
      const snapshot = kernel.snapshot();

      expect(snapshot.kernelId).toBe(kernel.id);
      expect(snapshot.status).toBe(KernelStatus.RUNNING);
      expect(snapshot.state).toBeDefined();
      expect(snapshot.plugins).toBeInstanceOf(Array);
      expect(snapshot.services).toBeInstanceOf(Array);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should support registerPluginLoader() and prefix resolution', async () => {
      const installFn = vi.fn();
      const loader = vi.fn(async (name) => {
        return createPlugin({
          name,
          install: installFn,
        });
      });

      kernel = new Kernel();
      kernel.registerPluginLoader('custom/', loader);

      await kernel.use('custom/foo');
      await kernel.start();

      expect(loader).toHaveBeenCalledWith('custom/foo');
      expect(installFn).toHaveBeenCalledTimes(1);
    });

    it('should adapt legacy ServiceProvider via kernel.use()', async () => {
      const provider = {
        name: 'LegacyProvider',
        register: vi.fn(async (k) => {
          k.register('legacy.service', { ok: true });
        }),
        start: vi.fn(async (k) => {
          await k.emit('legacy.started', { ok: true });
        }),
        stop: vi.fn(async (k) => {
          await k.emit('legacy.stopped', { ok: true });
        }),
      };

      kernel = new Kernel({ keepHistory: true });
      await kernel.use(provider);
      await kernel.start();

      expect(provider.register).toHaveBeenCalledTimes(1);
      expect(provider.start).toHaveBeenCalledTimes(1);
      expect(kernel.services.has('legacy.service')).toBe(true);

      await kernel.stop();

      expect(provider.stop).toHaveBeenCalledTimes(1);
      const types = kernel.events.getHistory().map(e => e.type);
      expect(types).toContain('legacy.started');
      expect(types).toContain('legacy.stopped');
    });

    it('schedule() should delegate to scheduler service when present', async () => {
      kernel = new Kernel();
      const schedule = vi.fn((task, priority) => ({ task, priority }));
      kernel.registerService('scheduler', { schedule });

      const task = { code: 'noop' };
      const result = await kernel.schedule(task, 7);

      expect(schedule).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ task, priority: 7 });
    });

    it('schedule() should fallback to direct function execution when scheduler is absent', async () => {
      kernel = new Kernel();
      const result = await kernel.schedule(() => 42);
      expect(result).toBe(42);
    });

    it('schedule() should throw when scheduler is absent and task is not a function', async () => {
      kernel = new Kernel();
      expect(() => kernel.schedule({ code: 'x' })).toThrow(/Scheduler not available/);
    });

    it('should expose eventBus alias and container.get()', async () => {
      kernel = new Kernel();
      kernel.registerService('container-service', { value: 123 });

      expect(kernel.eventBus).toBe(kernel.events);

      const svc = await kernel.container.get('container-service');
      expect(svc.value).toBe(123);
    });

    it('start() should be idempotent when already RUNNING', async () => {
      const installFn = vi.fn();
      const onStart = vi.fn();
      const plugin = createPlugin({
        name: 'idempotent-start',
        install: installFn,
        onStart,
      });

      kernel = new Kernel();
      await kernel.use(plugin);

      await kernel.start();
      await kernel.start();

      expect(kernel.status).toBe(KernelStatus.RUNNING);
      expect(installFn).toHaveBeenCalledTimes(1);
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('stop() should be idempotent when already STOPPED', async () => {
      const uninstall = vi.fn();
      const plugin = createPlugin({
        name: 'idempotent-stop',
        uninstall,
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();
      await kernel.stop();
      await kernel.stop();

      expect(kernel.status).toBe(KernelStatus.STOPPED);
      expect(uninstall).toHaveBeenCalledTimes(1);
    });

    it('should reflect STARTING/STOPPING status during async lifecycle', async () => {
      const startGate = createDeferred();
      const stopGate = createDeferred();
      const calls = [];

      const pluginA = createPlugin({
        name: 'plugin-a',
        install: async () => {
          await startGate.promise;
        },
        uninstall: () => calls.push('a'),
      });

      const pluginB = createPlugin({
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        uninstall: async () => {
          calls.push('b');
          await stopGate.promise;
        },
      });

      kernel = new Kernel();
      await kernel.use(pluginB);
      await kernel.use(pluginA);

      const startPromise = kernel.start();
      expect(kernel.status).toBe(KernelStatus.STARTING);
      startGate.resolve();
      await startPromise;
      expect(kernel.status).toBe(KernelStatus.RUNNING);

      const stopPromise = kernel.stop();
      expect(kernel.status).toBe(KernelStatus.STOPPING);
      stopGate.resolve();
      await stopPromise;

      expect(kernel.status).toBe(KernelStatus.STOPPED);
      expect(calls).toEqual(['b', 'a']);
    });

    it('start() should enter ERROR state and emit kernel.error when plugin install fails', async () => {
      const install = vi.fn(() => {
        throw new Error('boom');
      });
      const plugin = createPlugin({ name: 'start-boom', install });

      kernel = new Kernel({ keepHistory: true });
      await kernel.use(plugin);

      await expect(kernel.start()).rejects.toThrow('boom');
      expect(kernel.status).toBe(KernelStatus.ERROR);

      const types = kernel.events.getHistory().map(e => e.type);
      expect(types).toContain('kernel.error');
    });

    it('stop() should enter ERROR state when onStop throws', async () => {
      const plugin = createPlugin({
        name: 'stop-boom',
        onStop: () => {
          throw new Error('stop boom');
        },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      await expect(kernel.stop()).rejects.toThrow('stop boom');
      expect(kernel.status).toBe(KernelStatus.ERROR);
    });

    it('should include lazy service factories in getServices() before instantiation', () => {
      kernel = new Kernel();
      kernel.registerServiceFactory('lazy-service', () => ({ ok: true }));

      const services = kernel.getServices();
      expect(services.some(s => s.name === 'lazy-service' && s.registeredAt === 0)).toBe(true);
    });

    it('inspect() should include event/state/service diagnostics', async () => {
      kernel = new Kernel({ keepHistory: true, keepLog: true });
      kernel.registerService('math', { add: (a, b) => a + b });

      await kernel.start();
      await kernel.invoke('math.add', 1, 2);
      kernel.state.set('debug.value', 1);

      const info = kernel.inspect();
      expect(info.id).toBe(kernel.id);
      expect(info.status).toBe(KernelStatus.RUNNING);
      expect(info.eventHistory).toBeInstanceOf(Array);
      expect(info.stateChangeLog).toBeInstanceOf(Array);
      expect(info.serviceStats).toBeInstanceOf(Array);
    });

    it('_getPlugin() should return null for unknown plugin names', () => {
      kernel = new Kernel();
      expect(kernel._getPlugin('missing')).toBeNull();
    });
  });
});

describe('KernelBuilder', () => {
  let kernel;

  afterEach(async () => {
    if (kernel && kernel.status === KernelStatus.RUNNING) {
      await kernel.stop();
    }
  });

  it('should build kernel with preset', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .build();

    expect(kernel.status).toBe(KernelStatus.RUNNING);
  });

  it('should add plugins via builder', async () => {
    const plugin = createPlugin({
      name: 'builder-plugin',
      install: () => {},
    });

    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withPlugin(plugin)
      .build();

    const plugins = kernel.getPlugins();
    expect(plugins.some(p => p.name === 'builder-plugin')).toBe(true);
  });

  it('should add services via builder', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withService('my-service', { hello: 'world' })
      .build();

    expect(kernel.services.has('my-service')).toBe(true);
  });

  it('should merge config via builder', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withConfig({ id: 'builder-kernel' })
      .build();

    expect(kernel.id).toBe('builder-kernel');
  });
});

describe('Plugin system (core/plugin.js)', () => {
  it('createPlugin() should validate name', () => {
    expect(() => createPlugin({})).toThrow(/must have a name/);
  });

  it('PluginContext should expose scoped state helpers and logger methods', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const k = new Kernel({ keepLog: true });
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'ctx' });
    pm.register(plugin, { enabled: true });

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    expect(ctx.config).toEqual({ enabled: true });
    ctx.state.set('a', 1);
    ctx.state.merge('obj', { x: 1 });
    expect(ctx.state.get('a')).toBe(1);
    expect(ctx.state.get()).toEqual(expect.anything());
    expect(ctx.state.getGlobal('plugins.ctx.a')).toBe(1);

    const subscriber = vi.fn();
    ctx.state.subscribe('plugins.ctx.*', subscriber);
    ctx.state.set('b', 2);
    expect(subscriber).toHaveBeenCalled();

    ctx.log.debug('d');
    ctx.log.info('i');
    ctx.log.warn('w');
    ctx.log.error('e');

    expect(debug).toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();

    debug.mockRestore();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('PluginManager.register() should reject duplicate plugin names', () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'dup' });

    pm.register(plugin);
    expect(() => pm.register(plugin)).toThrow(/already registered/);
  });

  it('PluginManager.install() should error when plugin is missing', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    await expect(pm.install('missing')).rejects.toThrow(/Plugin not found/);
  });

  it('PluginManager.install() should be idempotent when already ACTIVE', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    const install = vi.fn();
    pm.register(createPlugin({ name: 'once', install }));

    await pm.install('once');
    await pm.install('once');

    expect(install).toHaveBeenCalledTimes(1);
    expect(pm.getStatus('once')).toBe(PluginStatus.ACTIVE);
  });

  it('PluginManager should resolve dependencies and keep install order', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    const order = [];

    pm.register(createPlugin({ name: 'a', install: () => order.push('a') }));
    pm.register(createPlugin({ name: 'b', dependencies: ['a'], install: () => order.push('b') }));

    await pm.install('b');
    expect(order).toEqual(['a', 'b']);
  });

  it('PluginManager.installAll() should throw on missing dependency and still visit it during topo sort', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);

    pm.register(createPlugin({ name: 'needs-missing', dependencies: ['missing'] }));

    await expect(pm.installAll()).rejects.toThrow(/Missing dependency/);
  });

  it('PluginManager.install() should cleanup context when install throws', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    const plugin = createPlugin({
      name: 'bad-install',
      install: (ctx) => {
        ctx.registerService('tmp', { ok: true });
        throw new Error('install boom');
      },
    });

    pm.register(plugin);
    await expect(pm.install('bad-install')).rejects.toThrow('install boom');
    expect(pm.getStatus('bad-install')).toBe(PluginStatus.ERROR);
    expect(pm.getContext('bad-install')).toBeUndefined();
    expect(k.services.has('tmp')).toBe(false);
  });

  it('PluginManager.uninstall() should return false when plugin is not ACTIVE', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    pm.register(createPlugin({ name: 'inactive' }));
    expect(await pm.uninstall('inactive')).toBe(false);
    expect(await pm.uninstall('missing')).toBe(false);
  });

  it('PluginManager.uninstall() should reject when other ACTIVE plugins depend on it', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    pm.register(createPlugin({ name: 'base' }));
    pm.register(createPlugin({ name: 'dep', dependencies: ['base'] }));

    await pm.installAll();
    await expect(pm.uninstall('base')).rejects.toThrow(/depends on it/);
  });

  it('PluginManager.uninstall() should cleanup and mark UNINSTALLED even when uninstall throws', async () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    const plugin = createPlugin({
      name: 'bad-uninstall',
      install: (ctx) => {
        ctx.registerService('tmp', { ok: true });
      },
      uninstall: () => {
        throw new Error('uninstall boom');
      },
    });

    pm.register(plugin);
    await pm.install('bad-uninstall');

    await expect(pm.uninstall('bad-uninstall')).rejects.toThrow('uninstall boom');
    expect(pm.getStatus('bad-uninstall')).toBe(PluginStatus.UNINSTALLED);
    expect(k.services.has('tmp')).toBe(false);
  });

  it('PluginManager.getStatus() should return null when missing', () => {
    const k = new Kernel();
    const pm = new PluginManager(k);
    expect(pm.getStatus('missing')).toBeNull();
  });
});
