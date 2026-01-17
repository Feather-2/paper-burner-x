/**
 * Kernel 测试
 * 使用 node:test + node:assert/strict
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/**
 * 创建 deferred promise 用于控制异步流程
 */
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
  /** @type {Kernel} */
  let kernel;

  afterEach(async () => {
    if (kernel && kernel.status === KernelStatus.RUNNING) {
      await kernel.stop();
    }
    kernel = null;
  });

  describe('constructor', () => {
    it('should create with CREATED status', () => {
      kernel = new Kernel();
      expect(kernel.status).toBe(KernelStatus.CREATED);
    });

    it('should use custom id when provided', () => {
      kernel = new Kernel({ id: 'my-kernel' });
      expect(kernel.id).toBe('my-kernel');
    });

    it('should generate id when not provided', () => {
      kernel = new Kernel();
      expect(kernel.id).toMatch(/^kernel_\d+$/);
    });

    it('should initialize three buses', () => {
      kernel = new Kernel();
      expect(kernel.events).toBeInstanceOf(EventBus);
      expect(kernel.state).toBeInstanceOf(StateBus);
      expect(kernel.services).toBeInstanceOf(ServiceBus);
    });

    it('should set initial meta state', () => {
      kernel = new Kernel({ id: 'test-id' });
      expect(kernel.state.get('meta.kernelId')).toBe('test-id');
      expect(kernel.state.get('meta.status')).toBe(KernelStatus.CREATED);
    });
  });

  describe('lifecycle', () => {
    it('should transition to RUNNING on start', async () => {
      kernel = new Kernel();
      await kernel.start();
      expect(kernel.status).toBe(KernelStatus.RUNNING);
    });

    it('should transition to STOPPED on stop', async () => {
      kernel = new Kernel();
      await kernel.start();
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
      expect(installFn.mock.calls.length).toBe(1);
      expect(onStart.mock.calls.length).toBe(1);
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
      expect(uninstall.mock.calls.length).toBe(1);
    });

    it('should reflect STARTING status during async install', async () => {
      const gate = createDeferred();
      const plugin = createPlugin({
        name: 'slow-install',
        install: async () => { await gate.promise; },
      });

      kernel = new Kernel();
      await kernel.use(plugin);

      const startPromise = kernel.start();
      expect(kernel.status).toBe(KernelStatus.STARTING);

      gate.resolve();
      await startPromise;
      expect(kernel.status).toBe(KernelStatus.RUNNING);
    });

    it('should reflect STOPPING status during async uninstall', async () => {
      const gate = createDeferred();
      const plugin = createPlugin({
        name: 'slow-uninstall',
        uninstall: async () => { await gate.promise; },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      const stopPromise = kernel.stop();
      expect(kernel.status).toBe(KernelStatus.STOPPING);

      gate.resolve();
      await stopPromise;
      expect(kernel.status).toBe(KernelStatus.STOPPED);
    });

    it('should enter ERROR state when plugin install fails', async () => {
      const plugin = createPlugin({
        name: 'bad-install',
        install: () => { throw new Error('install boom'); },
      });

      kernel = new Kernel({ keepHistory: true });
      await kernel.use(plugin);

      await expect(() => kernel.start()).rejects.toThrow(/install boom/);
      expect(kernel.status).toBe(KernelStatus.ERROR);

      const types = kernel.events.getHistory().map(e => e.type);
      expect(types).toContain('kernel.error');
    });

    it('should enter ERROR state when onStop throws', async () => {
      const plugin = createPlugin({
        name: 'bad-stop',
        onStop: () => { throw new Error('stop boom'); },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      await expect(() => kernel.stop()).rejects.toThrow(/stop boom/);
      expect(kernel.status).toBe(KernelStatus.ERROR);
    });

    it('should set meta.startedAt on start', async () => {
      kernel = new Kernel();
      await kernel.start();
      const startedAt = kernel.state.get('meta.startedAt');
      expect(startedAt).toBeTypeOf('number');
      expect(startedAt).toBeGreaterThan(0);
    });

    it('should set meta.stoppedAt on stop', async () => {
      kernel = new Kernel();
      await kernel.start();
      await kernel.stop();
      const stoppedAt = kernel.state.get('meta.stoppedAt');
      expect(stoppedAt).toBeTypeOf('number');
      expect(stoppedAt).toBeGreaterThan(0);
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

    it('should default to minimal preset', async () => {
      kernel = await Kernel.create();
      expect(kernel.status).toBe(KernelStatus.RUNNING);
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

      expect(factory.mock.calls.length).toBe(0);

      const service = await kernel.services.get('lazy');
      expect(factory.mock.calls.length).toBe(1);
      expect(service.value).toBe(42);

      // Second get should not call factory again
      await kernel.services.get('lazy');
      expect(factory.mock.calls.length).toBe(1);
    });

    it('should call service methods via call()', async () => {
      kernel.registerService('math', {
        add: (a, b) => a + b,
      });

      await kernel.start();
      const sum = await kernel.call('math', 'add', [2, 3]);
      expect(sum).toBe(5);
    });

    it('should call service methods via invoke()', async () => {
      kernel.registerService('math', {
        multiply: (a, b) => a * b,
      });

      await kernel.start();
      const product = await kernel.invoke('math.multiply', 4, 5);
      expect(product).toBe(20);
    });

    it('getServices() should list registered services', () => {
      kernel.registerService('svc1', {});
      kernel.registerService('svc2', {});

      const services = kernel.getServices();
      expect(services).toContainEqual(expect.objectContaining({ name: 'svc1' }));
      expect(services).toContainEqual(expect.objectContaining({ name: 'svc2' }));
    });

    it('getServices() should include lazy factories', () => {
      kernel.registerServiceFactory('lazy-service', () => ({ ok: true }));

      const services = kernel.getServices();
      expect(services).toContainEqual(expect.objectContaining({ name: 'lazy-service', registeredAt: 0 }));
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

      expect(installFn.mock.calls.length).toBe(1);
    });

    it('should pass PluginContext to plugin', async () => {
      let capturedCtx;
      const plugin = createPlugin({
        name: 'ctx-plugin',
        install: (ctx) => { capturedCtx = ctx; },
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

    it('should call onStop in reverse order on stop', async () => {
      const calls = [];
      const gate = createDeferred();

      const pluginA = createPlugin({
        name: 'plugin-a',
        install: async () => { await gate.promise; },
        uninstall: () => calls.push('a'),
      });

      const pluginB = createPlugin({
        name: 'plugin-b',
        dependencies: ['plugin-a'],
        uninstall: async () => {
          calls.push('b');
          await gate.promise;
        },
      });

      kernel = new Kernel();
      await kernel.use(pluginB);
      await kernel.use(pluginA);

      gate.resolve();
      await kernel.start();

      const stopPromise = kernel.stop();
      gate.resolve();
      await stopPromise;

      // B depends on A, so B should be uninstalled first
      expect(calls).toEqual(['b', 'a']);
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

    it('getPlugins() should list all registered plugins', async () => {
      const plugin = createPlugin({ name: 'list-test' });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      const plugins = kernel.getPlugins();
      expect(plugins).toContainEqual(expect.objectContaining({ name: 'list-test' }));
    });
  });

  describe('plugin loaders', () => {
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

      expect(customLoader.mock.calls.length).toBe(1);
      expect(customLoader.mock.calls[0]).toEqual(['custom/my-plugin']);
    });

    it('should support registerPluginLoader() for prefix matching', async () => {
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

      expect(loader.mock.calls.length).toBe(1);
      expect(loader.mock.calls[0]).toEqual(['custom/foo']);
      expect(installFn.mock.calls.length).toBe(1);
    });

    it('registerPluginLoader() should return this for chaining', () => {
      kernel = new Kernel();
      const result = kernel.registerPluginLoader('prefix/', () => {});
      expect(result).toBe(kernel);
    });

    it('should throw when no loader available', async () => {
      kernel = new Kernel();
      await expect(() => kernel.use('unknown/plugin')).rejects.toThrow(/cannot load plugin/i,
      );
    });
  });

  describe('presets', () => {
    it('should load minimal preset', async () => {
      kernel = new Kernel();
      await kernel.usePreset('minimal');
      await kernel.start();

      expect(kernel.status).toBe(KernelStatus.RUNNING);
    });

    it('should emit kernel.preset.loaded event', async () => {
      kernel = new Kernel({ keepHistory: true });
      await kernel.usePreset('minimal');

      const history = kernel.events.getHistory();
      const loadedEvent = history.find(e => e.type === 'kernel.preset.loaded');
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent.payload.preset).toBe('minimal');
    });

    it('should merge user config with preset config', async () => {
      kernel = new Kernel();
      await kernel.usePreset('minimal', {
        config: {
          'compression/cicada': { aggressive: true },
        },
      });
      await kernel.start();

      const plugin = kernel._getPlugin('compression/cicada');
      expect(plugin).not.toBeNull();
      expect(plugin._config?.aggressive).toBe(true);
    });

    it('should warn but continue when plugin fails to load', async () => {
      const originalWarn = console.warn;
      let warnCount = 0;
      console.warn = () => { warnCount += 1; };

      kernel = new Kernel();
      await kernel.usePreset('minimal', {
        plugins: ['nonexistent/plugin'],
      });

      console.warn = originalWarn;
      // Should have warned about failed plugin load
      expect(warnCount).toBeGreaterThanOrEqual(1);
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

    it('should count active plugins', async () => {
      kernel = await Kernel.create('minimal');
      const health = await kernel.healthCheck();

      expect(health.plugins.total).toBeGreaterThanOrEqual(1);
      expect(health.plugins.active).toBeGreaterThanOrEqual(1);
      expect(health.plugins.errors).toBe(0);
    });

    it('should return 0 uptime before start', async () => {
      kernel = new Kernel();
      const health = await kernel.healthCheck();
      expect(health.uptime).toBe(0);
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

  describe('inspect', () => {
    it('should include diagnostic information', async () => {
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
  });

  describe('_getPlugin', () => {
    it('should return null for unknown plugin names', () => {
      kernel = new Kernel();
      expect(kernel._getPlugin('missing')).toBe(null);
    });

    it('should return plugin after registration', async () => {
      const plugin = createPlugin({ name: 'test' });
      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      expect(kernel._getPlugin('test')).not.toBeNull();
    });
  });

  describe('proxy configuration', () => {
    it('should enable retry proxy by default', async () => {
      kernel = new Kernel();
      await kernel.start();
      // Retry proxy should be applied
      expect(kernel.services._proxies).toContainEqual(expect.objectContaining({ proxyName: 'retry' }));
    });

    it('should enable timeout proxy by default', async () => {
      kernel = new Kernel();
      await kernel.start();
      // Timeout proxy should be applied
      expect(kernel.services._proxies).toContainEqual(expect.objectContaining({ proxyName: 'timeout' }));
    });

    it('should disable retry proxy when enableRetry is false', async () => {
      kernel = new Kernel({ enableRetry: false });
      await kernel.start();
      expect(kernel.services._proxies).not.toContainEqual(expect.objectContaining({ proxyName: 'retry' }));
    });

    it('should disable timeout proxy when enableTimeout is false', async () => {
      kernel = new Kernel({ enableTimeout: false });
      await kernel.start();
      expect(kernel.services._proxies).not.toContainEqual(expect.objectContaining({ proxyName: 'timeout' }));
    });
  });
});

describe('KernelBuilder', () => {
  /** @type {Kernel} */
  let kernel;

  afterEach(async () => {
    if (kernel && kernel.status === KernelStatus.RUNNING) {
      await kernel.stop();
    }
    kernel = null;
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
    expect(plugins).toContainEqual(expect.objectContaining({ name: 'builder-plugin' }));
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

  it('should apply config for string plugins', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withPlugin('resilience/retry', { maxRetries: 7 })
      .build();

    const plugin = kernel._getPlugin('resilience/retry');
    expect(plugin?._config?.maxRetries).toBe(7);
  });
});

describe('PluginManager', () => {
  /** @type {Kernel} */
  let k;

  beforeEach(() => {
    k = new Kernel();
  });

  afterEach(async () => {
    if (k && k.status === KernelStatus.RUNNING) {
      await k.stop();
    }
  });

  describe('register', () => {
    it('should register plugin', () => {
      const pm = new PluginManager(k);
      const plugin = createPlugin({ name: 'test' });
      pm.register(plugin);
      expect(pm.getStatus('test')).toBe(PluginStatus.PENDING);
    });

    it('should reject duplicate plugin names', () => {
      const pm = new PluginManager(k);
      const plugin = createPlugin({ name: 'dup' });

      pm.register(plugin);
      expect(() => pm.register(plugin)).toThrow(/already registered/);
    });
  });

  describe('install', () => {
    it('should error when plugin is missing', async () => {
      const pm = new PluginManager(k);
      await expect(() => pm.install('missing')).rejects.toThrow(/Plugin not found/);
    });

    it('should be idempotent when already ACTIVE', async () => {
      const pm = new PluginManager(k);
      const install = vi.fn();
      pm.register(createPlugin({ name: 'once', install }));

      await pm.install('once');
      await pm.install('once');

      expect(install.mock.calls.length).toBe(1);
      expect(pm.getStatus('once')).toBe(PluginStatus.ACTIVE);
    });

    it('should resolve dependencies', async () => {
      const pm = new PluginManager(k);
      const order = [];

      pm.register(createPlugin({ name: 'a', install: () => order.push('a') }));
      pm.register(createPlugin({ name: 'b', dependencies: ['a'], install: () => order.push('b') }));

      await pm.install('b');
      expect(order).toEqual(['a', 'b']);
    });

    it('should throw on missing dependency', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'needs-missing', dependencies: ['missing'] }));

      await expect(() => pm.installAll()).rejects.toThrow(/Missing dependency/);
    });

    it('should cleanup context when install throws', async () => {
      const pm = new PluginManager(k);
      const plugin = createPlugin({
        name: 'bad-install',
        install: (ctx) => {
          ctx.registerService('tmp', { ok: true });
          throw new Error('install boom');
        },
      });

      pm.register(plugin);
      await expect(() => pm.install('bad-install')).rejects.toThrow(/install boom/);
      expect(pm.getStatus('bad-install')).toBe(PluginStatus.ERROR);
      expect(pm.getContext('bad-install')).toBe(undefined);
      expect(k.services.has('tmp')).toBe(false);
    });
  });

  describe('uninstall', () => {
    it('should return false when plugin is not ACTIVE', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'inactive' }));
      expect(await pm.uninstall('inactive')).toBe(false);
      expect(await pm.uninstall('missing')).toBe(false);
    });

    it('should reject when other ACTIVE plugins depend on it', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'base' }));
      pm.register(createPlugin({ name: 'dep', dependencies: ['base'] }));

      await pm.installAll();
      await expect(() => pm.uninstall('base')).rejects.toThrow(/depends on it/);
    });

    it('should cleanup and mark UNINSTALLED even when uninstall throws', async () => {
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

      await expect(() => pm.uninstall('bad-uninstall')).rejects.toThrow(/uninstall boom/);
      expect(pm.getStatus('bad-uninstall')).toBe(PluginStatus.UNINSTALLED);
      expect(k.services.has('tmp')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return null when missing', () => {
      const pm = new PluginManager(k);
      expect(pm.getStatus('missing')).toBe(null);
    });
  });

  describe('list', () => {
    it('should list all registered plugins', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'a', version: '1.0.0' }));
      pm.register(createPlugin({ name: 'b', version: '2.0.0' }));

      const list = pm.list();
      expect(list.length).toBe(2);
      expect(list).toContainEqual(expect.objectContaining({ name: 'a', version: '1.0.0' }));
      expect(list).toContainEqual(expect.objectContaining({ name: 'b', version: '2.0.0' }));
    });
  });
});

describe('createPlugin', () => {
  it('should validate name is required', () => {
    expect(() => createPlugin({})).toThrow(/must have a name/);
  });

  it('should validate name is a string', () => {
    expect(() => createPlugin({ name: 123 })).toThrow(/must have a name/);
  });

  it('should use default values', () => {
    const plugin = createPlugin({ name: 'test' });
    expect(plugin.name).toBe('test');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.description).toBe('');
    expect(plugin.dependencies).toEqual([]);
    expect(plugin.defaultConfig).toEqual({});
  });

  it('should use provided values', () => {
    const plugin = createPlugin({
      name: 'my-plugin',
      version: '2.0.0',
      description: 'My plugin',
      dependencies: ['dep1', 'dep2'],
      defaultConfig: { key: 'value' },
    });

    expect(plugin.name).toBe('my-plugin');
    expect(plugin.version).toBe('2.0.0');
    expect(plugin.description).toBe('My plugin');
    expect(plugin.dependencies).toEqual(['dep1', 'dep2']);
    expect(plugin.defaultConfig).toEqual({ key: 'value' });
  });
});

describe('PluginContext', () => {
  /** @type {Kernel} */
  let k;

  beforeEach(() => {
    k = new Kernel({ keepLog: true });
  });

  afterEach(async () => {
    if (k && k.status === KernelStatus.RUNNING) {
      await k.stop();
    }
  });

  it('should merge defaultConfig with provided config', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({
      name: 'ctx',
      defaultConfig: { a: 1, b: 2 },
    });
    pm.register(plugin, { b: 3, c: 4 });

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    expect(ctx.config).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should provide scoped state helpers', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'ctx' });
    pm.register(plugin);

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    ctx.state.set('a', 1);
    ctx.state.merge('obj', { x: 1 });

    expect(ctx.state.get('a')).toBe(1);
    expect(ctx.state.get()).toBeDefined();
    expect(ctx.state.getGlobal('plugins.ctx.a')).toBe(1);
  });

  it('should support state subscription with auto-cleanup', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'ctx' });
    pm.register(plugin);

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    const subscriber = vi.fn();
    ctx.state.subscribe('plugins.ctx.*', subscriber);
    ctx.state.set('b', 2);

    expect(subscriber.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should provide logger methods', async () => {
    const originalDebug = console.debug;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const debugCalls = [];
    const infoCalls = [];
    const warnCalls = [];
    const errorCalls = [];

    console.debug = (...args) => debugCalls.push(args);
    console.info = (...args) => infoCalls.push(args);
    console.warn = (...args) => warnCalls.push(args);
    console.error = (...args) => errorCalls.push(args);

    try {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'ctx' }));
      await pm.install('ctx');
      const ctx = pm.getContext('ctx');

      ctx.log.debug('d');
      ctx.log.info('i');
      ctx.log.warn('w');
      ctx.log.error('e');

      expect(debugCalls.length).toBeGreaterThan(0);
      expect(infoCalls.length).toBeGreaterThan(0);
      expect(warnCalls.length).toBeGreaterThan(0);
      expect(errorCalls.length).toBeGreaterThan(0);
    } finally {
      console.debug = originalDebug;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }
  });

  it('should auto-cleanup services on dispose', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({
      name: 'svc-test',
      install: (ctx) => {
        ctx.registerService('tmp', { ok: true });
      },
    });

    pm.register(plugin);
    await pm.install('svc-test');
    expect(k.services.has('tmp')).toBe(true);

    await pm.uninstall('svc-test');
    expect(k.services.has('tmp')).toBe(false);
  });

  it('should auto-cleanup event subscriptions on dispose', async () => {
    const pm = new PluginManager(k);
    const handler = vi.fn();
    const plugin = createPlugin({
      name: 'evt-test',
      install: (ctx) => {
        ctx.on('test.event', handler);
      },
    });

    pm.register(plugin);
    await pm.install('evt-test');

    k.events.emit('test.event', {});
    expect(handler.mock.calls.length).toBe(1);

    await pm.uninstall('evt-test');

    k.events.emit('test.event', {});
    expect(handler.mock.calls.length).toBe(1); // Should still be 1
  });
});

describe('KernelStatus', () => {
  it('should export all status values', () => {
    expect(KernelStatus.CREATED).toBe('created');
    expect(KernelStatus.STARTING).toBe('starting');
    expect(KernelStatus.RUNNING).toBe('running');
    expect(KernelStatus.STOPPING).toBe('stopping');
    expect(KernelStatus.STOPPED).toBe('stopped');
    expect(KernelStatus.ERROR).toBe('error');
  });
});
