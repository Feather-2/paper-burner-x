/**
 * Plugin Interface - 插件系统
 *
 * 特性：
 * - 声明式插件定义
 * - 依赖管理
 * - 生命周期钩子
 * - 配置验证
 */

/**
 * 插件状态
 */
export const PluginStatus = {
  PENDING: 'pending',
  INSTALLING: 'installing',
  ACTIVE: 'active',
  ERROR: 'error',
  UNINSTALLED: 'uninstalled',
};

/**
 * 创建插件
 * @param {Object} config - 插件配置
 * @returns {Object} 插件对象
 */
export function createPlugin(config) {
  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Plugin must have a name');
  }

  return {
    // 元数据
    name: config.name,
    version: config.version || '1.0.0',
    description: config.description || '',
    dependencies: config.dependencies || [],

    // 配置
    defaultConfig: config.defaultConfig || {},

    // 生命周期
    install: config.install || (() => {}),
    uninstall: config.uninstall || (() => {}),

    // 可选钩子
    onStart: config.onStart || null,
    onStop: config.onStop || null,
    onError: config.onError || null,

    // 内部状态
    _status: PluginStatus.PENDING,
    _context: null,
    _config: null,
  };
}

/**
 * 插件上下文 - 传递给插件的 API 接口
 */
export class PluginContext {
  constructor(kernel, plugin, config = {}) {
    this._kernel = kernel;
    this._plugin = plugin;
    this._subscriptions = [];
    this._services = [];

    // 合并配置
    this.config = { ...plugin.defaultConfig, ...config };

    // 暴露核心 API
    this.events = kernel.events;
    this.state = this._createScopedState(kernel.state, plugin.name);
    this.services = kernel.services;
    this.log = this._createLogger(plugin.name);
  }

  /**
   * 创建作用域状态访问器
   */
  _createScopedState(stateBus, pluginName) {
    const safePluginName = String(pluginName).replace(/\./g, '_');
    const prefix = `plugins.${safePluginName}`;

    return {
      // 插件私有状态
      get: (path) => {
        const isRoot = path === undefined || path === null || path === '';
        const key = isRoot ? prefix : `${prefix}.${String(path)}`;
        return stateBus.get(key);
      },
      set: (path, value, meta) => {
        const isRoot = path === undefined || path === null || path === '';
        const key = isRoot ? prefix : `${prefix}.${String(path)}`;
        const extraMeta =
          meta && typeof meta === 'object' && !Array.isArray(meta)
            ? /** @type {Record<string, unknown>} */ (meta)
            : {};
        stateBus.set(key, value, { ...extraMeta, plugin: pluginName });
      },
      merge: (path, updates, meta) => {
        const isRoot = path === undefined || path === null || path === '';
        const key = isRoot ? prefix : `${prefix}.${String(path)}`;
        const extraMeta =
          meta && typeof meta === 'object' && !Array.isArray(meta)
            ? /** @type {Record<string, unknown>} */ (meta)
            : {};
        stateBus.merge(key, updates, { ...extraMeta, plugin: pluginName });
      },

      // 全局状态只读访问
      getGlobal: (path) => stateBus.get(path),

      // 订阅（自动清理）
      subscribe: (pattern, callback) => {
        const unsub = stateBus.subscribe(pattern, callback);
        this._subscriptions.push(unsub);
        return unsub;
      },
    };
  }

  /**
   * 创建日志器
   */
  _createLogger(pluginName) {
    const prefix = `[${pluginName}]`;
    return {
      debug: (...args) => console.debug(prefix, ...args),
      info: (...args) => console.info(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args),
    };
  }

  /**
   * 注册服务（自动清理）
   */
  registerService(name, service, options = {}) {
    this.services.register(name, service, options);
    this._services.push(name);
  }

  /**
   * 订阅事件（自动清理）
   */
  on(event, callback) {
    const unsub = this.events.on(event, callback);
    this._subscriptions.push(unsub);
    return unsub;
  }

  /**
   * 清理所有订阅和服务
   */
  dispose() {
    for (const unsub of this._subscriptions) {
      try { unsub(); } catch { /* intentional: disposal cleanup */ }
    }
    this._subscriptions.length = 0;

    for (const name of this._services) {
      try { this.services.unregister(name); } catch { /* intentional: disposal cleanup */ }
    }
    this._services.length = 0;
  }
}

/**
 * 插件管理器
 */
export class PluginManager {
  constructor(kernel) {
    this._kernel = kernel;
    this._plugins = new Map();
    this._contexts = new Map();
  }

  /**
   * 注册插件
   */
  register(plugin, config = {}) {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }

    this._plugins.set(plugin.name, { plugin, config, status: PluginStatus.PENDING });
    return this;
  }

  /**
   * 安装插件
   */
  async install(pluginName) {
    const entry = this._plugins.get(pluginName);
    if (!entry) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (entry.status === PluginStatus.ACTIVE) {
      return; // 已安装
    }

    const { plugin, config } = entry;

    // 检查依赖
    for (const dep of plugin.dependencies) {
      if (!this._plugins.has(dep)) {
        throw new Error(`Missing dependency: ${dep} (required by ${pluginName})`);
      }
      const depEntry = this._plugins.get(dep);
      if (depEntry.status !== PluginStatus.ACTIVE) {
        await this.install(dep);
      }
    }

    // 创建上下文
    entry.status = PluginStatus.INSTALLING;
    const ctx = new PluginContext(this._kernel, plugin, config);
    this._contexts.set(pluginName, ctx);

    try {
      // 调用安装钩子
      await plugin.install(ctx);
      entry.status = PluginStatus.ACTIVE;
      plugin._status = PluginStatus.ACTIVE;
      plugin._context = ctx;
      plugin._config = config;

      this._kernel.events.emitSync('plugin.installed', { name: pluginName });
    } catch (error) {
      entry.status = PluginStatus.ERROR;
      ctx.dispose();
      this._contexts.delete(pluginName);
      throw error;
    }
  }

  /**
   * 安装所有已注册插件
   */
  async installAll() {
    // 拓扑排序
    const sorted = this._topologicalSort();

    for (const name of sorted) {
      await this.install(name);
    }
  }

  /**
   * 卸载插件
   */
  async uninstall(pluginName) {
    const entry = this._plugins.get(pluginName);
    if (!entry || entry.status !== PluginStatus.ACTIVE) {
      return false;
    }

    const { plugin } = entry;
    const ctx = this._contexts.get(pluginName);

    // 检查是否有其他插件依赖它
    for (const [name, e] of this._plugins) {
      if (name !== pluginName && e.status === PluginStatus.ACTIVE) {
        if (e.plugin.dependencies.includes(pluginName)) {
          throw new Error(`Cannot uninstall ${pluginName}: ${name} depends on it`);
        }
      }
    }

    try {
      await plugin.uninstall(ctx);
    } finally {
      ctx.dispose();
      this._contexts.delete(pluginName);
      entry.status = PluginStatus.UNINSTALLED;
      plugin._status = PluginStatus.UNINSTALLED;

      this._kernel.events.emitSync('plugin.uninstalled', { name: pluginName });
    }

    return true;
  }

  /**
   * 获取插件状态
   */
  getStatus(pluginName) {
    const entry = this._plugins.get(pluginName);
    return entry ? entry.status : null;
  }

  /**
   * 列出所有插件
   */
  list() {
    return [...this._plugins].map(([name, entry]) => ({
      name,
      version: entry.plugin.version,
      status: entry.status,
      dependencies: entry.plugin.dependencies,
    }));
  }

  /**
   * 获取插件上下文
   */
  getContext(pluginName) {
    return this._contexts.get(pluginName);
  }

  /**
   * 拓扑排序
   */
  _topologicalSort() {
    const visited = new Set();
    const result = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      visited.add(name);

      const entry = this._plugins.get(name);
      if (entry) {
        for (const dep of entry.plugin.dependencies) {
          visit(dep);
        }
        result.push(name);
      }
    };

    for (const name of this._plugins.keys()) {
      visit(name);
    }

    return result;
  }
}

export default createPlugin;
