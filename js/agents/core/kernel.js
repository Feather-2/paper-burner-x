/**
 * Kernel - 微内核
 *
 * 核心职责：
 * - 管理四大总线（EventBus, StateBus, ServiceBus, MessageBus）
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
 * Types
 * @typedef {import('./types.d.ts').KernelOptions} KernelOptions
 * @typedef {import('./types.d.ts').KernelStatusType} KernelStatusType
 * @typedef {import('./types.d.ts').KernelHealthCheck} KernelHealthCheck
 * @typedef {import('./types.d.ts').KernelSnapshot} KernelSnapshot
 * @typedef {import('./types.d.ts').Plugin} Plugin
 * @typedef {import('./types.d.ts').PluginEntry} PluginEntry
 * @typedef {import('./types.d.ts').ServiceEntry} ServiceEntry
 * @typedef {import('./types.d.ts').ServiceOptions} ServiceOptions
 * @typedef {import('./types.d.ts').CallOptions} CallOptions
 * @typedef {import('./types.d.ts').EventRecord} EventRecord
 * @typedef {import('./types.d.ts').StateChangeRecord} StateChangeRecord
 * @typedef {import('./types.d.ts').ServiceStats} ServiceStats
 * @typedef {import('./types.d.ts').ServiceProvider} ServiceProvider
 */

/**
 * @typedef {Object} KernelInspectResult
 * @property {string} id
 * @property {KernelStatusType} status
 * @property {EventRecord[]} eventHistory
 * @property {StateChangeRecord[]} stateChangeLog
 * @property {ServiceStats[]} serviceStats
 */


/**
 * 默认插件加载器 - 惰性加载 plugins 模块
 * 解耦 core 与 plugins 的编译时依赖
 */
let _defaultPluginLoader = null;

/**
 * @returns {Promise<((name: string) => Promise<Plugin>) | null>}
 */
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
/** @type {{ CREATED: KernelStatusType, STARTING: KernelStatusType, RUNNING: KernelStatusType, STOPPING: KernelStatusType, STOPPED: KernelStatusType, ERROR: KernelStatusType }} */
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
   * @param {Partial<KernelOptions>} options
   */
  constructor(options = {}) {
    /** @type {string} */
    this.id = options.id || `kernel_${Date.now()}`;
    /** @type {KernelStatusType} */
    this._status = KernelStatus.CREATED;
    /** @type {Partial<KernelOptions>} */
    this._options = options;

    // 四大总线 (MessageBus 惰性创建)
    this.events = new EventBus({
      keepHistory: options.keepHistory ?? false,
      maxHistory: options.maxHistory || 100,
    });
    this.events.runId = this.id;

    this.state = new StateBus({
      events: /** @type {import('./types.d.ts').EventBus} */ (/** @type {unknown} */ (this.events)),
      keepLog: options.keepLog ?? false,
      maxLog: options.maxLog || 500,
    });

    this.services = new ServiceBus({
      events: /** @type {import('./types.d.ts').EventBus} */ (/** @type {unknown} */ (this.events)),
    });

    // 插件管理器
    this._pluginManager = new PluginManager(this);
    /** @type {Map<string, (name: string) => Promise<Plugin>>} */
    this._pluginLoaders = new Map();
    /** @type {((name: string) => Promise<Plugin>) | null} */
    this._customPluginLoader = options.pluginLoader || null;

    // 初始化状态
    this.state.set('meta.kernelId', this.id);
    this.state.set('meta.status', this._status);
  }

  /**
   * 快速创建并启动
   * @param {string} [preset='minimal'] - 预设名称
   * @param {Record<string, unknown>} [config={}] - 用户配置
   * @returns {Promise<Kernel>}
   */
  static async create(preset = 'minimal', config = {}) {
    const kernel = new Kernel(/** @type {Partial<KernelOptions>} */ (config));
    await kernel.usePreset(preset, config);
    await kernel.start();
    return kernel;
  }

  /**
   * 获取状态
   * @returns {KernelStatusType}
   */
  get status() {
    return this._status;
  }

  /**
   * 注册插件加载器
   * @param {string} prefix - 插件前缀（如 'compression/'）
   * @param {(name: string) => Promise<Plugin>} loader - (name) => Promise<Plugin>
   * @returns {this}
   */
  registerPluginLoader(prefix, loader) {
    this._pluginLoaders.set(prefix, loader);
    return this;
  }

  /**
   * 使用插件或旧 Provider
   * @param {Plugin | string} plugin - 插件对象或名称
   * @param {Record<string, unknown>} [config={}] - 插件配置
   * @returns {Promise<this>}
   */
  async use(plugin, config = {}) {
    // 如果是字符串，尝试加载
    if (typeof plugin === 'string') {
      plugin = await this._loadPlugin(plugin);
    }

    // 兼容旧 ServiceProvider
    if (isServiceProvider(plugin)) {
      plugin = /** @type {Plugin} */ (
        adaptProvider(/** @type {ServiceProvider} */ (/** @type {unknown} */ (plugin)))
      );
    }

    this._pluginManager.register(plugin, config);
    return this;
  }

  /**
   * 使用预设
   * @param {string} presetName - 预设名称
   * @param {Record<string, unknown>} [userConfig={}] - 用户配置覆盖
   * @returns {Promise<this>}
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
   * @param {string} name
   * @param {unknown} service
   * @param {ServiceOptions} [options={}]
   * @returns {this}
   */
  registerService(name, service, options = {}) {
    this.services.register(name, /** @type {unknown} */ (service), options);
    return this;
  }

  /**
   * 注册服务工厂（懒加载）
   * @param {string} name
   * @param {() => unknown | Promise<unknown>} factory
   * @param {ServiceOptions} [options={}]
   * @returns {this}
   */
  registerServiceFactory(name, factory, options = {}) {
    this.services.registerFactory(name, factory, options);
    return this;
  }

  /**
   * 调用服务
   * @template T
   * @param {string} serviceName
   * @param {string} method
   * @param {unknown[]} [args=[]]
   * @param {CallOptions} [options={}]
   * @returns {Promise<T>}
   */
  async call(serviceName, method, args = [], options = {}) {
    return this.services.call(serviceName, method, args, options);
  }

  /**
   * 快捷调用
   * @template T
   * @param {string} path
   * @param {...unknown} args
   * @returns {Promise<T>}
   */
  async invoke(path, ...args) {
    return this.services.invoke(path, ...args);
  }

  /**
   * 启动内核
   * @returns {Promise<this>}
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
   * @returns {Promise<this>}
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

      // 卸载所有插件 - 按依赖拓扑逆序
      const plugins = this._pluginManager.list().filter(p => p.status === PluginStatus.ACTIVE);
      const uninstallOrder = this._getUninstallOrder(plugins);
      for (const entry of uninstallOrder) {
        await this._pluginManager.uninstall(entry.name);
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
   * @returns {PluginEntry[]}
   */
  getPlugins() {
    return this._pluginManager.list();
  }

  /**
   * 获取服务列表
   * @returns {ServiceEntry[]}
   */
  getServices() {
    /** @type {ServiceEntry[]} */
    const entries = [];

    for (const [name, entry] of this.services._services) {
      entries.push({
        name,
        registeredAt: entry.registeredAt,
        options: entry.options || {},
      });
    }

    for (const [name, entry] of this.services._factories) {
      if (!this.services._services.has(name)) {
        entries.push({
          name,
          registeredAt: 0,
          options: entry.options || {},
        });
      }
    }

    return entries;
  }

  /**
   * 健康检查
   * @returns {Promise<KernelHealthCheck>}
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
   * @returns {KernelSnapshot}
   */
  snapshot() {
    return {
      kernelId: this.id,
      status: this._status,
      state: this.state.toJSON(),
      plugins: this._pluginManager.list(),
      services: this.getServices(),
      timestamp: Date.now(),
    };
  }

  /**
   * 调试信息
   * @returns {KernelInspectResult}
   */
  inspect() {
    return {
      id: this.id,
      status: this._status,
      eventHistory: /** @type {EventRecord[]} */ (this.events.getHistory()),
      stateChangeLog: this.state.getChangeLog(),
      serviceStats: this.services.getStats(),
    };
  }

  /**
   * 加载插件
   * @param {string} name
   * @returns {Promise<Plugin>}
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
   * @param {string} name
   * @returns {Plugin | null}
   */
  _getPlugin(name) {
    const entry = this._pluginManager._plugins.get(name);
    return entry?.plugin || null;
  }

  /**
   * 设置状态
   * @param {KernelStatusType} status
   * @returns {void}
   */
  _setStatus(status) {
    this._status = status;
    this.state.set('meta.status', status);
  }

  /**
   * 计算插件卸载顺序（依赖的拓扑逆序）
   * 被依赖的插件应该最后卸载
   * @param {PluginEntry[]} plugins
   * @returns {PluginEntry[]}
   */
  _getUninstallOrder(plugins) {
    const pluginMap = new Map(plugins.map(p => [p.name, p]));
    const visited = new Set();
    const order = [];

    /**
     * @param {PluginEntry} entry
     */
    const visit = (entry) => {
      if (visited.has(entry.name)) return;
      visited.add(entry.name);

      // 先访问依赖当前插件的其他插件
      for (const other of plugins) {
        if (other.name !== entry.name) {
          const otherPlugin = this._getPlugin(other.name);
          if (otherPlugin?.dependencies?.includes(entry.name)) {
            visit(other);
          }
        }
      }

      order.push(entry);
    };

    for (const plugin of plugins) {
      visit(plugin);
    }

    return order;
  }
}

export default Kernel;
