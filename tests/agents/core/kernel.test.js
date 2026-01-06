/**
 * Kernel 集成测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Kernel,
  KernelStatus,
  KernelBuilder,
  createPlugin,
  EventBus,
  StateBus,
  ServiceBus,
} from '../../../js/agents/core/index.js';

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
