/**
 * ServiceBus - 服务注册与调用
 *
 * 特性：
 * - 服务注册与发现
 * - 懒加载支持
 * - 中间件代理（重试、超时、熔断）
 * - 服务健康检查
 */

export class ServiceBus {
  constructor(options = {}) {
    this._events = options.events || null;
    this._services = new Map();
    this._factories = new Map();
    this._proxies = [];
    this._stats = new Map();
  }

  /**
   * 注册服务实例
   * @param {string} name - 服务名称
   * @param {Object} service - 服务对象
   * @param {Object} options - 配置选项
   */
  register(name, service, options = {}) {
    if (this._services.has(name) && !options.override) {
      throw new Error(`Service already registered: ${name}`);
    }

    this._services.set(name, {
      instance: service,
      options,
      registeredAt: Date.now(),
    });

    this._stats.set(name, { calls: 0, errors: 0, totalTime: 0 });
    this._emit('service.registered', { name, options });

    return this;
  }

  /**
   * 注册服务工厂（懒加载）
   * @param {string} name - 服务名称
   * @param {Function} factory - 工厂函数 () => service | Promise<service>
   */
  registerFactory(name, factory, options = {}) {
    this._factories.set(name, { factory, options });
    this._emit('service.factory.registered', { name });
    return this;
  }

  /**
   * 获取服务实例
   */
  async get(name) {
    // 已注册的服务
    const registered = this._services.get(name);
    if (registered) {
      return registered.instance;
    }

    // 懒加载
    const factoryEntry = this._factories.get(name);
    if (factoryEntry) {
      const { factory, options } = factoryEntry;
      const instance = await factory();
      this.register(name, instance, options);
      this._factories.delete(name);
      return instance;
    }

    return null;
  }

  /**
   * 检查服务是否存在
   */
  has(name) {
    return this._services.has(name) || this._factories.has(name);
  }

  /**
   * 调用服务方法
   * @param {string} serviceName - 服务名称
   * @param {string} method - 方法名称
   * @param {Array} args - 参数
   * @param {Object} options - 调用选项
   */
  async call(serviceName, method, args = [], options = {}) {
    const startTime = Date.now();
    const callContext = {
      service: serviceName,
      method,
      args,
      options,
      startTime,
    };

    this._emit('service.call.start', callContext);

    try {
      // 获取服务
      const service = await this.get(serviceName);
      if (!service) {
        throw new Error(`Service not found: ${serviceName}`);
      }

      const fn = service[method];
      if (typeof fn !== 'function') {
        throw new Error(`Method not found: ${serviceName}.${method}`);
      }

      // 构建调用链（应用代理）
      let executor = async () => fn.apply(service, args);

      for (const proxy of this._proxies) {
        const currentExecutor = executor;
        executor = () => proxy.invoke(callContext, currentExecutor);
      }

      const result = await executor();

      // 统计
      this._recordSuccess(serviceName, Date.now() - startTime);
      this._emit('service.call.success', { ...callContext, result, duration: Date.now() - startTime });

      return result;
    } catch (error) {
      this._recordError(serviceName);
      this._emit('service.call.error', { ...callContext, error, duration: Date.now() - startTime });
      throw error;
    }
  }

  /**
   * 快捷调用 - 自动解析 'service.method' 格式
   */
  async invoke(path, ...args) {
    const [serviceName, method] = path.split('.');
    if (!method) {
      throw new Error(`Invalid service path: ${path}, expected 'service.method'`);
    }
    return this.call(serviceName, method, args);
  }

  /**
   * 注册调用代理（中间件）
   * @param {Object} proxy - { name, invoke: (context, next) => Promise }
   */
  useProxy(proxy) {
    if (typeof proxy.invoke !== 'function') {
      throw new Error('Proxy must have an invoke function');
    }
    this._proxies.push(proxy);
    return this;
  }

  /**
   * 移除代理
   */
  removeProxy(proxyName) {
    const idx = this._proxies.findIndex(p => p.name === proxyName);
    if (idx >= 0) {
      this._proxies.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * 注销服务
   */
  unregister(name) {
    const deleted = this._services.delete(name);
    this._factories.delete(name);
    if (deleted) {
      this._emit('service.unregistered', { name });
    }
    return deleted;
  }

  /**
   * 获取服务列表
   */
  list() {
    const services = [];

    for (const [name, entry] of this._services) {
      services.push({
        name,
        status: 'active',
        registeredAt: entry.registeredAt,
        stats: this._stats.get(name),
      });
    }

    for (const [name] of this._factories) {
      if (!this._services.has(name)) {
        services.push({
          name,
          status: 'lazy',
          stats: null,
        });
      }
    }

    return services;
  }

  /**
   * 健康检查
   */
  async healthCheck(serviceName) {
    const service = await this.get(serviceName);
    if (!service) {
      return { name: serviceName, healthy: false, error: 'not found' };
    }

    if (typeof service.healthCheck === 'function') {
      try {
        const result = await service.healthCheck();
        return { name: serviceName, healthy: true, ...result };
      } catch (error) {
        return { name: serviceName, healthy: false, error: error.message };
      }
    }

    return { name: serviceName, healthy: true };
  }

  /**
   * 批量健康检查
   */
  async healthCheckAll() {
    const results = [];
    for (const [name] of this._services) {
      results.push(await this.healthCheck(name));
    }
    return results;
  }

  /**
   * 获取统计信息
   */
  getStats(serviceName) {
    if (serviceName) {
      return this._stats.get(serviceName) || null;
    }
    return Object.fromEntries(this._stats);
  }

  /**
   * 重置统计
   */
  resetStats() {
    for (const [name] of this._stats) {
      this._stats.set(name, { calls: 0, errors: 0, totalTime: 0 });
    }
  }

  /**
   * 清空所有服务
   */
  clear() {
    this._services.clear();
    this._factories.clear();
    this._proxies.length = 0;
    this._stats.clear();
  }

  _recordSuccess(name, duration) {
    const stats = this._stats.get(name);
    if (stats) {
      stats.calls++;
      stats.totalTime += duration;
    }
  }

  _recordError(name) {
    const stats = this._stats.get(name);
    if (stats) {
      stats.calls++;
      stats.errors++;
    }
  }

  _emit(event, data) {
    if (this._events) {
      this._events.emitSync(event, data);
    }
  }
}

// 内置代理：重试
export function createRetryProxy(options = {}) {
  const { maxRetries = 3, delay = 1000, shouldRetry = () => true } = options;

  return {
    name: 'retry',
    async invoke(context, next) {
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await next();
        } catch (error) {
          lastError = error;
          const canRetry = attempt < maxRetries && shouldRetry(error, context);
          if (!canRetry) break;
          await new Promise(r => setTimeout(r, delay * Math.pow(2, attempt)));
        }
      }
      throw lastError;
    },
  };
}

// 内置代理：超时
export function createTimeoutProxy(options = {}) {
  const { timeout = 30000 } = options;

  return {
    name: 'timeout',
    async invoke(context, next) {
      const timeoutMs = context.options?.timeout || timeout;

      return Promise.race([
        next(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Service call timeout: ${context.service}.${context.method}`)), timeoutMs)
        ),
      ]);
    },
  };
}

// 内置代理：缓存
export function createCacheProxy(options = {}) {
  const { ttl = 60000, keyFn = null } = options;
  const cache = new Map();

  return {
    name: 'cache',
    async invoke(context, next) {
      const key = keyFn
        ? keyFn(context)
        : `${context.service}.${context.method}:${JSON.stringify(context.args)}`;

      const cached = cache.get(key);
      if (cached && Date.now() - cached.time < ttl) {
        return cached.value;
      }

      const result = await next();
      cache.set(key, { value: result, time: Date.now() });

      return result;
    },
  };
}

export default ServiceBus;
