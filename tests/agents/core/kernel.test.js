/**
 * Kernel 测试
 * 使用 node:test + node:assert/strict
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
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
      assert.equal(kernel.status, KernelStatus.CREATED);
    });

    it('should use custom id when provided', () => {
      kernel = new Kernel({ id: 'my-kernel' });
      assert.equal(kernel.id, 'my-kernel');
    });

    it('should generate id when not provided', () => {
      kernel = new Kernel();
      assert.match(kernel.id, /^kernel_\d+$/);
    });

    it('should initialize three buses', () => {
      kernel = new Kernel();
      assert.ok(kernel.events instanceof EventBus);
      assert.ok(kernel.state instanceof StateBus);
      assert.ok(kernel.services instanceof ServiceBus);
    });

    it('should set initial meta state', () => {
      kernel = new Kernel({ id: 'test-id' });
      assert.equal(kernel.state.get('meta.kernelId'), 'test-id');
      assert.equal(kernel.state.get('meta.status'), KernelStatus.CREATED);
    });
  });

  describe('lifecycle', () => {
    it('should transition to RUNNING on start', async () => {
      kernel = new Kernel();
      await kernel.start();
      assert.equal(kernel.status, KernelStatus.RUNNING);
    });

    it('should transition to STOPPED on stop', async () => {
      kernel = new Kernel();
      await kernel.start();
      await kernel.stop();
      assert.equal(kernel.status, KernelStatus.STOPPED);
    });

    it('should emit lifecycle events', async () => {
      kernel = new Kernel({ keepHistory: true });
      await kernel.start();
      await kernel.stop();

      const history = kernel.events.getHistory();
      const types = history.map(e => e.type);
      assert.ok(types.includes('kernel.started'));
      assert.ok(types.includes('kernel.stopped'));
    });

    it('start() should be idempotent when already RUNNING', async () => {
      const installFn = mock.fn();
      const onStart = mock.fn();
      const plugin = createPlugin({
        name: 'idempotent-start',
        install: installFn,
        onStart,
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();
      await kernel.start();

      assert.equal(kernel.status, KernelStatus.RUNNING);
      assert.equal(installFn.mock.callCount(), 1);
      assert.equal(onStart.mock.callCount(), 1);
    });

    it('stop() should be idempotent when already STOPPED', async () => {
      const uninstall = mock.fn();
      const plugin = createPlugin({
        name: 'idempotent-stop',
        uninstall,
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();
      await kernel.stop();
      await kernel.stop();

      assert.equal(kernel.status, KernelStatus.STOPPED);
      assert.equal(uninstall.mock.callCount(), 1);
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
      assert.equal(kernel.status, KernelStatus.STARTING);

      gate.resolve();
      await startPromise;
      assert.equal(kernel.status, KernelStatus.RUNNING);
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
      assert.equal(kernel.status, KernelStatus.STOPPING);

      gate.resolve();
      await stopPromise;
      assert.equal(kernel.status, KernelStatus.STOPPED);
    });

    it('should enter ERROR state when plugin install fails', async () => {
      const plugin = createPlugin({
        name: 'bad-install',
        install: () => { throw new Error('install boom'); },
      });

      kernel = new Kernel({ keepHistory: true });
      await kernel.use(plugin);

      await assert.rejects(() => kernel.start(), /install boom/);
      assert.equal(kernel.status, KernelStatus.ERROR);

      const types = kernel.events.getHistory().map(e => e.type);
      assert.ok(types.includes('kernel.error'));
    });

    it('should enter ERROR state when onStop throws', async () => {
      const plugin = createPlugin({
        name: 'bad-stop',
        onStop: () => { throw new Error('stop boom'); },
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      await assert.rejects(() => kernel.stop(), /stop boom/);
      assert.equal(kernel.status, KernelStatus.ERROR);
    });

    it('should set meta.startedAt on start', async () => {
      kernel = new Kernel();
      await kernel.start();
      const startedAt = kernel.state.get('meta.startedAt');
      assert.ok(typeof startedAt === 'number');
      assert.ok(startedAt > 0);
    });

    it('should set meta.stoppedAt on stop', async () => {
      kernel = new Kernel();
      await kernel.start();
      await kernel.stop();
      const stoppedAt = kernel.state.get('meta.stoppedAt');
      assert.ok(typeof stoppedAt === 'number');
      assert.ok(stoppedAt > 0);
    });
  });

  describe('static create()', () => {
    it('should create and start with minimal preset', async () => {
      kernel = await Kernel.create('minimal');
      assert.equal(kernel.status, KernelStatus.RUNNING);
    });

    it('should accept custom config', async () => {
      kernel = await Kernel.create('minimal', { id: 'test-kernel' });
      assert.equal(kernel.id, 'test-kernel');
    });

    it('should default to minimal preset', async () => {
      kernel = await Kernel.create();
      assert.equal(kernel.status, KernelStatus.RUNNING);
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
      assert.equal(service.greet(), 'hello');
    });

    it('should support factory registration (lazy load)', async () => {
      const factory = mock.fn(() => ({ value: 42 }));
      kernel.registerServiceFactory('lazy', factory);

      assert.equal(factory.mock.callCount(), 0);

      const service = await kernel.services.get('lazy');
      assert.equal(factory.mock.callCount(), 1);
      assert.equal(service.value, 42);

      // Second get should not call factory again
      await kernel.services.get('lazy');
      assert.equal(factory.mock.callCount(), 1);
    });

    it('should call service methods via call()', async () => {
      kernel.registerService('math', {
        add: (a, b) => a + b,
      });

      await kernel.start();
      const sum = await kernel.call('math', 'add', [2, 3]);
      assert.equal(sum, 5);
    });

    it('should call service methods via invoke()', async () => {
      kernel.registerService('math', {
        multiply: (a, b) => a * b,
      });

      await kernel.start();
      const product = await kernel.invoke('math.multiply', 4, 5);
      assert.equal(product, 20);
    });

    it('getServices() should list registered services', () => {
      kernel.registerService('svc1', {});
      kernel.registerService('svc2', {});

      const services = kernel.getServices();
      assert.ok(services.some(s => s.name === 'svc1'));
      assert.ok(services.some(s => s.name === 'svc2'));
    });

    it('getServices() should include lazy factories', () => {
      kernel.registerServiceFactory('lazy-service', () => ({ ok: true }));

      const services = kernel.getServices();
      assert.ok(services.some(s => s.name === 'lazy-service' && s.registeredAt === 0));
    });
  });

  describe('plugins', () => {
    it('should install plugin on start', async () => {
      const installFn = mock.fn();
      const plugin = createPlugin({
        name: 'test-plugin',
        install: installFn,
      });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      assert.equal(installFn.mock.callCount(), 1);
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

      assert.ok(capturedCtx !== undefined);
      assert.ok(capturedCtx.events instanceof EventBus);
      assert.ok(capturedCtx.services instanceof ServiceBus);
      assert.ok(capturedCtx.log !== undefined);
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

      assert.deepEqual(order, ['a', 'b']);
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

      assert.deepEqual(hooks, ['install', 'start', 'stop']);
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
      assert.deepEqual(calls, ['b', 'a']);
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
      assert.equal(pluginState.get('counter'), 0);
      assert.equal(pluginState.get('name'), 'test');

      // Global state access
      assert.equal(kernel.state.get('plugins.state-plugin.counter'), 0);
    });

    it('getPlugins() should list all registered plugins', async () => {
      const plugin = createPlugin({ name: 'list-test' });

      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      const plugins = kernel.getPlugins();
      assert.ok(plugins.some(p => p.name === 'list-test'));
    });
  });

  describe('plugin loaders', () => {
    it('should use injected pluginLoader', async () => {
      const customLoader = mock.fn(async (name) => {
        return createPlugin({
          name,
          install: () => {},
        });
      });

      kernel = new Kernel({ pluginLoader: customLoader });
      await kernel.use('custom/my-plugin');
      await kernel.start();

      assert.equal(customLoader.mock.callCount(), 1);
      assert.deepEqual(customLoader.mock.calls[0].arguments, ['custom/my-plugin']);
    });

    it('should support registerPluginLoader() for prefix matching', async () => {
      const installFn = mock.fn();
      const loader = mock.fn(async (name) => {
        return createPlugin({
          name,
          install: installFn,
        });
      });

      kernel = new Kernel();
      kernel.registerPluginLoader('custom/', loader);

      await kernel.use('custom/foo');
      await kernel.start();

      assert.equal(loader.mock.callCount(), 1);
      assert.deepEqual(loader.mock.calls[0].arguments, ['custom/foo']);
      assert.equal(installFn.mock.callCount(), 1);
    });

    it('registerPluginLoader() should return this for chaining', () => {
      kernel = new Kernel();
      const result = kernel.registerPluginLoader('prefix/', () => {});
      assert.equal(result, kernel);
    });

    it('should throw when no loader available', async () => {
      kernel = new Kernel();
      await assert.rejects(
        () => kernel.use('unknown/plugin'),
        /cannot load plugin/i,
      );
    });
  });

  describe('presets', () => {
    it('should load minimal preset', async () => {
      kernel = new Kernel();
      await kernel.usePreset('minimal');
      await kernel.start();

      assert.equal(kernel.status, KernelStatus.RUNNING);
    });

    it('should emit kernel.preset.loaded event', async () => {
      kernel = new Kernel({ keepHistory: true });
      await kernel.usePreset('minimal');

      const history = kernel.events.getHistory();
      const loadedEvent = history.find(e => e.type === 'kernel.preset.loaded');
      assert.ok(loadedEvent);
      assert.equal(loadedEvent.payload.preset, 'minimal');
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
      assert.ok(plugin);
      assert.equal(plugin._config?.aggressive, true);
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
      assert.ok(warnCount >= 1);
    });
  });

  describe('health check', () => {
    it('should return health status', async () => {
      kernel = await Kernel.create('minimal');
      const health = await kernel.healthCheck();

      assert.equal(health.kernelId, kernel.id);
      assert.equal(health.status, KernelStatus.RUNNING);
      assert.ok(health.uptime >= 0);
      assert.ok(health.plugins !== undefined);
      assert.ok(health.services !== undefined);
    });

    it('should count active plugins', async () => {
      kernel = await Kernel.create('minimal');
      const health = await kernel.healthCheck();

      assert.ok(health.plugins.total >= 1);
      assert.ok(health.plugins.active >= 1);
      assert.equal(health.plugins.errors, 0);
    });

    it('should return 0 uptime before start', async () => {
      kernel = new Kernel();
      const health = await kernel.healthCheck();
      assert.equal(health.uptime, 0);
    });
  });

  describe('snapshot', () => {
    it('should return kernel snapshot', async () => {
      kernel = await Kernel.create('minimal');
      const snapshot = kernel.snapshot();

      assert.equal(snapshot.kernelId, kernel.id);
      assert.equal(snapshot.status, KernelStatus.RUNNING);
      assert.ok(snapshot.state !== undefined);
      assert.ok(Array.isArray(snapshot.plugins));
      assert.ok(Array.isArray(snapshot.services));
      assert.ok(snapshot.timestamp > 0);
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
      assert.equal(info.id, kernel.id);
      assert.equal(info.status, KernelStatus.RUNNING);
      assert.ok(Array.isArray(info.eventHistory));
      assert.ok(Array.isArray(info.stateChangeLog));
      assert.ok(Array.isArray(info.serviceStats));
    });
  });

  describe('_getPlugin', () => {
    it('should return null for unknown plugin names', () => {
      kernel = new Kernel();
      assert.equal(kernel._getPlugin('missing'), null);
    });

    it('should return plugin after registration', async () => {
      const plugin = createPlugin({ name: 'test' });
      kernel = new Kernel();
      await kernel.use(plugin);
      await kernel.start();

      assert.ok(kernel._getPlugin('test') !== null);
    });
  });

  describe('proxy configuration', () => {
    it('should enable retry proxy by default', async () => {
      kernel = new Kernel();
      await kernel.start();
      // Retry proxy should be applied
      assert.ok(kernel.services._proxies.some(p => p.proxyName === 'retry'));
    });

    it('should enable timeout proxy by default', async () => {
      kernel = new Kernel();
      await kernel.start();
      // Timeout proxy should be applied
      assert.ok(kernel.services._proxies.some(p => p.proxyName === 'timeout'));
    });

    it('should disable retry proxy when enableRetry is false', async () => {
      kernel = new Kernel({ enableRetry: false });
      await kernel.start();
      assert.ok(!kernel.services._proxies.some(p => p.proxyName === 'retry'));
    });

    it('should disable timeout proxy when enableTimeout is false', async () => {
      kernel = new Kernel({ enableTimeout: false });
      await kernel.start();
      assert.ok(!kernel.services._proxies.some(p => p.proxyName === 'timeout'));
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

    assert.equal(kernel.status, KernelStatus.RUNNING);
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
    assert.ok(plugins.some(p => p.name === 'builder-plugin'));
  });

  it('should add services via builder', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withService('my-service', { hello: 'world' })
      .build();

    assert.ok(kernel.services.has('my-service'));
  });

  it('should merge config via builder', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withConfig({ id: 'builder-kernel' })
      .build();

    assert.equal(kernel.id, 'builder-kernel');
  });

  it('should apply config for string plugins', async () => {
    kernel = await KernelBuilder.create()
      .withPreset('minimal')
      .withPlugin('resilience/retry', { maxRetries: 7 })
      .build();

    const plugin = kernel._getPlugin('resilience/retry');
    assert.ok(plugin?._config?.maxRetries === 7);
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
      assert.equal(pm.getStatus('test'), PluginStatus.PENDING);
    });

    it('should reject duplicate plugin names', () => {
      const pm = new PluginManager(k);
      const plugin = createPlugin({ name: 'dup' });

      pm.register(plugin);
      assert.throws(() => pm.register(plugin), /already registered/);
    });
  });

  describe('install', () => {
    it('should error when plugin is missing', async () => {
      const pm = new PluginManager(k);
      await assert.rejects(() => pm.install('missing'), /Plugin not found/);
    });

    it('should be idempotent when already ACTIVE', async () => {
      const pm = new PluginManager(k);
      const install = mock.fn();
      pm.register(createPlugin({ name: 'once', install }));

      await pm.install('once');
      await pm.install('once');

      assert.equal(install.mock.callCount(), 1);
      assert.equal(pm.getStatus('once'), PluginStatus.ACTIVE);
    });

    it('should resolve dependencies', async () => {
      const pm = new PluginManager(k);
      const order = [];

      pm.register(createPlugin({ name: 'a', install: () => order.push('a') }));
      pm.register(createPlugin({ name: 'b', dependencies: ['a'], install: () => order.push('b') }));

      await pm.install('b');
      assert.deepEqual(order, ['a', 'b']);
    });

    it('should throw on missing dependency', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'needs-missing', dependencies: ['missing'] }));

      await assert.rejects(() => pm.installAll(), /Missing dependency/);
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
      await assert.rejects(() => pm.install('bad-install'), /install boom/);
      assert.equal(pm.getStatus('bad-install'), PluginStatus.ERROR);
      assert.equal(pm.getContext('bad-install'), undefined);
      assert.equal(k.services.has('tmp'), false);
    });
  });

  describe('uninstall', () => {
    it('should return false when plugin is not ACTIVE', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'inactive' }));
      assert.equal(await pm.uninstall('inactive'), false);
      assert.equal(await pm.uninstall('missing'), false);
    });

    it('should reject when other ACTIVE plugins depend on it', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'base' }));
      pm.register(createPlugin({ name: 'dep', dependencies: ['base'] }));

      await pm.installAll();
      await assert.rejects(() => pm.uninstall('base'), /depends on it/);
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

      await assert.rejects(() => pm.uninstall('bad-uninstall'), /uninstall boom/);
      assert.equal(pm.getStatus('bad-uninstall'), PluginStatus.UNINSTALLED);
      assert.equal(k.services.has('tmp'), false);
    });
  });

  describe('getStatus', () => {
    it('should return null when missing', () => {
      const pm = new PluginManager(k);
      assert.equal(pm.getStatus('missing'), null);
    });
  });

  describe('list', () => {
    it('should list all registered plugins', async () => {
      const pm = new PluginManager(k);
      pm.register(createPlugin({ name: 'a', version: '1.0.0' }));
      pm.register(createPlugin({ name: 'b', version: '2.0.0' }));

      const list = pm.list();
      assert.equal(list.length, 2);
      assert.ok(list.some(p => p.name === 'a' && p.version === '1.0.0'));
      assert.ok(list.some(p => p.name === 'b' && p.version === '2.0.0'));
    });
  });
});

describe('createPlugin', () => {
  it('should validate name is required', () => {
    assert.throws(() => createPlugin({}), /must have a name/);
  });

  it('should validate name is a string', () => {
    assert.throws(() => createPlugin({ name: 123 }), /must have a name/);
  });

  it('should use default values', () => {
    const plugin = createPlugin({ name: 'test' });
    assert.equal(plugin.name, 'test');
    assert.equal(plugin.version, '1.0.0');
    assert.equal(plugin.description, '');
    assert.deepEqual(plugin.dependencies, []);
    assert.deepEqual(plugin.defaultConfig, {});
  });

  it('should use provided values', () => {
    const plugin = createPlugin({
      name: 'my-plugin',
      version: '2.0.0',
      description: 'My plugin',
      dependencies: ['dep1', 'dep2'],
      defaultConfig: { key: 'value' },
    });

    assert.equal(plugin.name, 'my-plugin');
    assert.equal(plugin.version, '2.0.0');
    assert.equal(plugin.description, 'My plugin');
    assert.deepEqual(plugin.dependencies, ['dep1', 'dep2']);
    assert.deepEqual(plugin.defaultConfig, { key: 'value' });
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

    assert.deepEqual(ctx.config, { a: 1, b: 3, c: 4 });
  });

  it('should provide scoped state helpers', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'ctx' });
    pm.register(plugin);

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    ctx.state.set('a', 1);
    ctx.state.merge('obj', { x: 1 });

    assert.equal(ctx.state.get('a'), 1);
    assert.ok(ctx.state.get() !== undefined);
    assert.equal(ctx.state.getGlobal('plugins.ctx.a'), 1);
  });

  it('should support state subscription with auto-cleanup', async () => {
    const pm = new PluginManager(k);
    const plugin = createPlugin({ name: 'ctx' });
    pm.register(plugin);

    await pm.install('ctx');
    const ctx = pm.getContext('ctx');

    const subscriber = mock.fn();
    ctx.state.subscribe('plugins.ctx.*', subscriber);
    ctx.state.set('b', 2);

    assert.ok(subscriber.mock.callCount() >= 1);
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

      assert.ok(debugCalls.length > 0);
      assert.ok(infoCalls.length > 0);
      assert.ok(warnCalls.length > 0);
      assert.ok(errorCalls.length > 0);
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
    assert.ok(k.services.has('tmp'));

    await pm.uninstall('svc-test');
    assert.equal(k.services.has('tmp'), false);
  });

  it('should auto-cleanup event subscriptions on dispose', async () => {
    const pm = new PluginManager(k);
    const handler = mock.fn();
    const plugin = createPlugin({
      name: 'evt-test',
      install: (ctx) => {
        ctx.on('test.event', handler);
      },
    });

    pm.register(plugin);
    await pm.install('evt-test');

    k.events.emit('test.event', {});
    assert.equal(handler.mock.callCount(), 1);

    await pm.uninstall('evt-test');

    k.events.emit('test.event', {});
    assert.equal(handler.mock.callCount(), 1); // Should still be 1
  });
});

describe('KernelStatus', () => {
  it('should export all status values', () => {
    assert.equal(KernelStatus.CREATED, 'created');
    assert.equal(KernelStatus.STARTING, 'starting');
    assert.equal(KernelStatus.RUNNING, 'running');
    assert.equal(KernelStatus.STOPPING, 'stopping');
    assert.equal(KernelStatus.STOPPED, 'stopped');
    assert.equal(KernelStatus.ERROR, 'error');
  });
});
