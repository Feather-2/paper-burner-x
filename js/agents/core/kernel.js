/**
 * Kernel - 微内核
 *
 * 核心职责：
 * - 管理三大总线（EventBus, StateBus, ServiceBus）
 * - 插件生命周期管理
 * - 预设加载
 * - 统一入口
 */

import { EventBus } from './event-bus.js';
import { StateBus } from './state-bus.js';
import { ServiceBus, createRetryProxy, createTimeoutProxy } from './service-bus.js';
import { PluginManager, PluginStatus } from './plugin.js';
import { resolvePreset, mergePresetConfig } from './presets.js';
import { isServiceProvider, adaptProvider } from './compat.js';

/**
 * 默认插件加载器 - 惰性加载 plugins 模块
 * 解耦 core 与 plugins 的编译时依赖
 */
let _defaultPluginLoader = null;
async function getDefaultPluginLoader() {
  if (!_defaultPluginLoader) {
    const mod = await import('../plugins/index.js');
    _defaultPluginLoader = mod.loadPlugin || mod.default?.load;
  }
  return _defaultPluginLoader;
}

/**
 * Kernel 状态
 */
export const KernelStatus = {
  CREATED: 'created',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

/**
 * 微内核
 */
export class Kernel {
  /**
   * @param {Object} options - 配置选项
   * @param {string} options.id - 内核实例 ID
   * @param {boolean} options.keepHistory - 保留事件历史
   * @param {boolean} options.keepLog - 保留状态变更日志
   * @param {Function} options.pluginLoader - 自定义插件加载器 (name) => Promise<Plugin>
   */
  constructor(options = {}) {
    this.id = options.id || `kernel_${Date.now()}`;
    this._status = KernelStatus.CREATED;
    this._options = options;

    // 三大总线
    this.events = new EventBus({
      keepHistory: options.keepHistory ?? false,
      maxHistory: options.maxHistory || 100,
    });

    this.state = new StateBus({
      events: this.events,
      keepLog: options.keepLog ?? false,
      maxLog: options.maxLog || 500,
    });

    this.services = new ServiceBus({
      events: this.events,
    });

    // 插件管理器
    this._pluginManager = new PluginManager(this);
    this._pluginLoaders = new Map();
    this._customPluginLoader = options.pluginLoader || null;

    // 初始化状态
    this.state.set('meta.kernelId', this.id);
    this.state.set('meta.status', this._status);
  }

  /**
   * 快速创建并启动
   * @param {string} preset - 预设名称
   * @param {Object} config - 用户配置
   * @returns {Promise<Kernel>}
   */
  static async create(preset = 'minimal', config = {}) {
    const kernel = new Kernel(config);
    await kernel.usePreset(preset, config);
    await kernel.start();
    return kernel;
  }

  /**
   * 获取状态
   */
  get status() {
    return this._status;
  }

  /**
   * 注册插件加载器
   * @param {string} prefix - 插件前缀（如 'compression/'）
   * @param {Function} loader - (name) => Promise<Plugin>
   */
  registerPluginLoader(prefix, loader) {
    this._pluginLoaders.set(prefix, loader);
    return this;
  }

  /**
   * 使用插件或旧 Provider
   * @param {Object|string} plugin - 插件对象、名称或旧 ServiceProvider
   * @param {Object} config - 插件配置
   */
  async use(plugin, config = {}) {
    // 如果是字符串，尝试加载
    if (typeof plugin === 'string') {
      plugin = await this._loadPlugin(plugin);
    }

    // 兼容旧 ServiceProvider
    if (isServiceProvider(plugin)) {
      plugin = adaptProvider(plugin);
    }

    this._pluginManager.register(plugin, config);
    return this;
  }

  /**
   * 使用预设
   * @param {string} presetName - 预设名称
   * @param {Object} userConfig - 用户配置覆盖
   */
  async usePreset(presetName, userConfig = {}) {
    const resolved = mergePresetConfig(presetName, userConfig);

    for (const pluginName of resolved.plugins) {
      const pluginConfig = resolved.config[pluginName] || {};
      try {
        await this.use(pluginName, pluginConfig);
      } catch (err) {
        console.warn(`[Kernel] Failed to load plugin "${pluginName}":`, err.message);
      }
    }

    this.events.emitSync('kernel.preset.loaded', { preset: presetName, plugins: resolved.plugins });
    return this;
  }

  /**
   * 注册服务
   */
  registerService(name, service, options = {}) {
    this.services.register(name, service, options);
    return this;
  }

  /**
   * 注册服务工厂（懒加载）
   */
  registerServiceFactory(name, factory, options = {}) {
    this.services.registerFactory(name, factory, options);
    return this;
  }

  /**
   * 调用服务
   */
  async call(serviceName, method, args = [], options = {}) {
    return this.services.call(serviceName, method, args, options);
  }

  /**
   * 快捷调用
   */
  async invoke(path, ...args) {
    return this.services.invoke(path, ...args);
  }

  // === 旧 MicroKernel 兼容 API ===

  /**
   * 兼容旧 API: kernel.register(id, factory)
   * @deprecated 使用 registerService 或 registerServiceFactory
   */
  register(id, factoryOrValue, options = {}) {
    if (typeof factoryOrValue === 'function') {
      this.services.registerFactory(id, factoryOrValue, options);
    } else {
      this.services.register(id, factoryOrValue, options);
    }
    return this;
  }

  /**
   * 兼容旧 API: kernel.getService(id)
   * @deprecated 使用 services.get(id)
   */
  getService(id) {
    return this.services.get(id);
  }

  /**
   * 兼容旧 API: kernel.emit(type, payload)
   */
  emit(type, payload) {
    return this.events.emit(type, payload);
  }

  /**
   * 兼容旧 API: kernel.on(type, handler)
   */
  on(type, handler) {
    return this.events.on(type, handler);
  }

  /**
   * 兼容旧 API: kernel.schedule(task, priority)
   * 需要 scheduler 插件支持
   */
  schedule(task, priority) {
    if (this.services.has('scheduler')) {
      return this.services.call('scheduler', 'schedule', [task, priority]);
    }
    // 降级：直接执行
    if (typeof task === 'function') {
      return Promise.resolve().then(() => task());
    }
    throw new Error('Scheduler not available. Use scheduler plugin or pass a function.');
  }

  // === 旧 MicroKernel 兼容属性 ===

  /**
   * 兼容旧 API: kernel.eventBus
   */
  get eventBus() {
    return this.events;
  }

  /**
   * 兼容旧 API: kernel.container (部分兼容)
   * 返回一个类似 Container 的接口
   */
  get container() {
    const self = this;
    return {
      register: (id, factory, opts) => self.register(id, factory, opts),
      get: (id) => self.services.get(id),
      has: (id) => self.services.has(id),
    };
  }

  /**
   * 启动内核
   */
  async start() {
    if (this._status === KernelStatus.RUNNING) {
      return this;
    }

    this._setStatus(KernelStatus.STARTING);
    this.state.set('meta.startedAt', Date.now());

    try {
      // 安装所有插件
      await this._pluginManager.installAll();

      // 应用默认代理
      if (this._options.enableRetry !== false) {
        this.services.useProxy(createRetryProxy({
          maxRetries: this._options.maxRetries || 3,
        }));
      }

      if (this._options.enableTimeout !== false) {
        this.services.useProxy(createTimeoutProxy({
          timeout: this._options.defaultTimeout || 30000,
        }));
      }

      // 触发启动钩子
      for (const entry of this._pluginManager.list()) {
        if (entry.status === PluginStatus.ACTIVE) {
          const ctx = this._pluginManager.getContext(entry.name);
          const plugin = this._getPlugin(entry.name);
          if (plugin?.onStart) {
            await plugin.onStart(ctx);
          }
        }
      }

      this._setStatus(KernelStatus.RUNNING);
      this.events.emit('kernel.started', { id: this.id });
    } catch (error) {
      this._setStatus(KernelStatus.ERROR);
      this.events.emit('kernel.error', { error });
      throw error;
    }

    return this;
  }

  /**
   * 停止内核
   */
  async stop() {
    if (this._status === KernelStatus.STOPPED) {
      return this;
    }

    this._setStatus(KernelStatus.STOPPING);

    try {
      // 触发停止钩子
      for (const entry of this._pluginManager.list().reverse()) {
        if (entry.status === PluginStatus.ACTIVE) {
          const ctx = this._pluginManager.getContext(entry.name);
          const plugin = this._getPlugin(entry.name);
          if (plugin?.onStop) {
            await plugin.onStop(ctx);
          }
        }
      }

      // 卸载所有插件
      for (const entry of this._pluginManager.list().reverse()) {
        if (entry.status === PluginStatus.ACTIVE) {
          await this._pluginManager.uninstall(entry.name);
        }
      }

      this._setStatus(KernelStatus.STOPPED);
      this.state.set('meta.stoppedAt', Date.now());
      this.events.emit('kernel.stopped', { id: this.id });
    } catch (error) {
      this._setStatus(KernelStatus.ERROR);
      throw error;
    }

    return this;
  }

  /**
   * 获取插件列表
   */
  getPlugins() {
    return this._pluginManager.list();
  }

  /**
   * 获取服务列表
   */
  getServices() {
    return this.services.list();
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const plugins = this._pluginManager.list();
    const services = await this.services.healthCheckAll();

    return {
      kernelId: this.id,
      status: this._status,
      uptime: this.state.get('meta.startedAt')
        ? Date.now() - this.state.get('meta.startedAt')
        : 0,
      plugins: {
        total: plugins.length,
        active: plugins.filter(p => p.status === PluginStatus.ACTIVE).length,
        errors: plugins.filter(p => p.status === PluginStatus.ERROR).length,
      },
      services: {
        total: services.length,
        healthy: services.filter(s => s.healthy).length,
        unhealthy: services.filter(s => !s.healthy),
      },
    };
  }

  /**
   * 导出状态快照
   */
  snapshot() {
    return {
      kernelId: this.id,
      status: this._status,
      state: this.state.toJSON(),
      plugins: this._pluginManager.list(),
      services: this.services.list(),
      timestamp: Date.now(),
    };
  }

  /**
   * 调试信息
   */
  inspect() {
    return {
      id: this.id,
      status: this._status,
      eventHistory: this.events.getHistory(),
      stateChangeLog: this.state.getChangeLog(),
      serviceStats: this.services.getStats(),
    };
  }

  /**
   * 加载插件
   */
  async _loadPlugin(name) {
    // 1. 查找匹配的前缀加载器
    for (const [prefix, loader] of this._pluginLoaders) {
      if (name.startsWith(prefix)) {
        return loader(name);
      }
    }

    // 2. 使用自定义加载器（如果注入了）
    if (this._customPluginLoader) {
      return this._customPluginLoader(name);
    }

    // 3. 惰性加载默认插件注册表（解耦编译时依赖）
    try {
      const loader = await getDefaultPluginLoader();
      if (loader) {
        return await loader(name);
      }
    } catch (err) {
      throw new Error(`Cannot load plugin "${name}": ${err.message}`);
    }

    throw new Error(`Cannot load plugin "${name}": no loader available`);
  }

  /**
   * 获取已注册的插件对象
   */
  _getPlugin(name) {
    const entry = this._pluginManager._plugins.get(name);
    return entry?.plugin || null;
  }

  /**
   * 设置状态
   */
  _setStatus(status) {
    this._status = status;
    this.state.set('meta.status', status);
  }
}

export default Kernel;
