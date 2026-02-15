/**
 * ServiceBus - 服务注册与调用
 *
 * 特性：
 * - 服务注册与发现
 * - 懒加载支持
 * - 中间件代理（重试、超时、熔断）
 * - 服务健康检查
 */

/**
 * @typedef {import('./types').EventBus} EventBus
 * @typedef {import('./types').ServiceOptions} ServiceOptions
 * @typedef {import('./types').CallOptions} CallOptions
 * @typedef {import('./types').CallContext} CallContext
 * @typedef {import('./types').ServiceEntry} ServiceEntry
 * @typedef {import('./types').ServiceHealthResult} ServiceHealthResult
 * @typedef {import('./types').ServiceStats} ServiceStats
 * @typedef {import('./types').ServiceProxy} ServiceProxy
 *
 * @typedef {{ instance: unknown, options: ServiceOptions, registeredAt: number }} RegisteredService
 * @typedef {{ factory: () => unknown | Promise<unknown>, options: ServiceOptions, registeredAt: number }} FactoryService
 * @typedef {ServiceProxy & { invoke: ServiceProxy, proxyName?: string }} ServiceProxyWithInvoke
 * @typedef {ServiceProxy | { name?: string, invoke: ServiceProxy }} ServiceProxyLike
 *
 * @typedef {{ maxRetries?: number, backoff?: number, delay?: number, shouldRetry?: (error: unknown, context: CallContext) => boolean }} RetryProxyOptions
 * @typedef {{ timeout?: number }} TimeoutProxyOptions
 * @typedef {{ ttl?: number, maxSize?: number, keyFn?: (context: CallContext) => string }} CacheProxyOptions
 */

const PERSIST_DEBOUNCE_MS = 500;

export class ServiceBus {
  /**
   * @param {{ events?: EventBus, archive?: any, runId?: string }} [options]
   */
  constructor(options = {}) {
    /** @type {EventBus | null} */
    this._events = options.events || null;

    /** @type {Map<string, RegisteredService>} */
    this._services = new Map();

    /** @type {Map<string, FactoryService>} */
    this._factories = new Map();

    /** @type {ServiceProxyWithInvoke[]} */
    this._proxies = [];

    /** @type {Map<string, ServiceStats>} */
    this._stats = new Map();

    /** @type {any | null} */
    this._archive = options.archive || null;

    /** @type {string} */
    this._runId = options.runId || 'default';

    /** @type {ReturnType<typeof setTimeout> | null} */
    this._persistStatsTimerId = null;
  }

  /**
   * 初始化 ServiceBus，从 Archive 恢复统计（如果可用）
   * @returns {Promise<void>}
   */
  async init() {
    if (!this._archive) return;

    try {
      const checkpoints = await this._archive.list(this._runId);
      if (!Array.isArray(checkpoints) || checkpoints.length === 0) return;

      for (const ckpt of checkpoints) {
        if (!ckpt?.id || !ckpt.id.includes(':servicebus:stats:')) continue;

        try {
          const restored = await this._archive.load(ckpt.id);
          if (restored?.stats && typeof restored.stats === 'object') {
            for (const [name, stat] of Object.entries(restored.stats)) {
              if (stat && typeof stat === 'object') {
                this._stats.set(name, {
                  name,
                  calls: stat.calls || 0,
                  errors: stat.errors || 0,
                  totalTime: stat.totalTime || 0,
                });
              }
            }
          }
        } catch (err) {
          // 持久化失败不影响内存统计
        }
      }
    } catch (err) {
      // Archive 不可用时静默失败
    }
  }

  /**
   * 注册服务实例
   * @param {string} name - 服务名称
   * @param {unknown} service - 服务对象
   * @param {ServiceOptions} [options] - 配置选项
   * @returns {this}
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

    this._stats.set(name, { name, calls: 0, errors: 0, totalTime: 0 });
    this._emit('service.registered', { name, options });

    return this;
  }

  /**
   * 注册服务工厂（懒加载）
   * @param {string} name - 服务名称
   * @param {() => unknown | Promise<unknown>} factory - 工厂函数
   * @param {ServiceOptions} [options] - 配置选项
   * @returns {this}
   */
  registerFactory(name, factory, options = {}) {
    if ((this._services.has(name) || this._factories.has(name)) && !options.override) {
      throw new Error(`Service already registered: ${name}`);
    }

    this._factories.set(name, { factory, options, registeredAt: Date.now() });
    this._emit('service.factory.registered', { name });
    return this;
  }

  /**
   * 获取服务实例
   * @template T
   * @param {string} name
   * @returns {Promise<T | null>}
   */
  async get(name) {
    // 已注册的服务
    const registered = this._services.get(name);
    if (registered) {
      return /** @type {T} */ (registered.instance);
    }

    // 懒加载
    const factoryEntry = this._factories.get(name);
    if (factoryEntry) {
      const { factory, options } = factoryEntry;
      const instance = await factory();
      this.register(name, instance, options);
      this._factories.delete(name);
      return /** @type {T} */ (instance);
    }

    return null;
  }

  /**
   * 检查服务是否存在
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._services.has(name) || this._factories.has(name);
  }

  /**
   * 调用服务方法
   * @template T
   * @param {string} serviceName - 服务名称
   * @param {string} method - 方法名称
   * @param {unknown[]} [args] - 参数
   * @param {CallOptions} [options] - 调用选项
   * @returns {Promise<T>}
   */
  async call(serviceName, method, args = [], options = {}) {
    const startTime = Date.now();
    /** @type {CallContext} */
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

      return /** @type {T} */ (result);
    } catch (error) {
      this._recordError(serviceName);
      this._emit('service.call.error', { ...callContext, error, duration: Date.now() - startTime });
      throw error;
    }
  }

  /**
   * 快捷调用 - 自动解析 'service.method' 格式
   * @template T
   * @param {string} path
   * @param {...unknown} args
   * @returns {Promise<T>}
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
   * @param {ServiceProxyLike} proxy
   * @returns {this}
   */
  useProxy(proxy) {
    this._proxies.push(normalizeProxy(proxy));
    return this;
  }

  /**
   * 移除代理
   * @param {string} proxyName
   * @returns {boolean}
   */
  removeProxy(proxyName) {
    const idx = this._proxies.findIndex(p => p.proxyName === proxyName || p.name === proxyName);
    if (idx >= 0) {
      this._proxies.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * 注销服务
   * @param {string} name
   * @returns {boolean}
   */
  unregister(name) {
    const deleted = this._services.delete(name);
    this._factories.delete(name);
    this._stats.delete(name);
    if (deleted) {
      this._emit('service.unregistered', { name });
    }
    return deleted;
  }

  /**
   * 获取服务列表
   * @returns {ServiceEntry[]}
   */
  list() {
    return [...this._services.entries()].map(([name, entry]) => ({
      name,
      registeredAt: entry.registeredAt,
      options: entry.options,
    }));
  }

  /**
   * 获取完整服务列表（含未实例化的工厂）
   * @returns {ServiceEntry[]}
   */
  listAll() {
    /** @type {ServiceEntry[]} */
    const entries = this.list();
    const registeredNames = new Set(entries.map(e => e.name));

    for (const [name, entry] of this._factories) {
      if (!registeredNames.has(name)) {
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
   * @param {string} serviceName
   * @returns {Promise<ServiceHealthResult>}
   */
  async healthCheck(serviceName) {
    const registered = this._services.get(serviceName);
    if (!registered) {
      return { name: serviceName, healthy: false, error: 'not found' };
    }

    const { instance, options } = registered;

    const instanceHealthCheck = (instance && (typeof instance === 'object' || typeof instance === 'function'))
      ? /** @type {Record<string, unknown>} */ (instance).healthCheck
      : undefined;
    const checkFn = typeof options.healthCheck === 'function'
      ? options.healthCheck
      : typeof instanceHealthCheck === 'function'
          ? () => instanceHealthCheck.call(instance)
          : null;

    if (typeof checkFn === 'function') {
      try {
        const result = await checkFn();
        return { name: serviceName, healthy: Boolean(result) };
      } catch (error) {
        return { name: serviceName, healthy: false, error: error?.message || String(error) };
      }
    }

    return { name: serviceName, healthy: true };
  }

  /**
   * 批量健康检查
   * @returns {Promise<ServiceHealthResult[]>}
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
   * @overload
   * @returns {ServiceStats[]}
   */
  /**
   * @overload
   * @param {string} serviceName
   * @returns {ServiceStats | null}
   */
  /**
   * @param {string} [serviceName]
   * @returns {ServiceStats[] | ServiceStats | null}
   */
  getStats(serviceName) {
    if (serviceName) {
      return this._stats.get(serviceName) || null;
    }
    return [...this._stats.values()];
  }

  /**
   * 重置统计
   * @returns {void}
   */
  resetStats() {
    for (const [name] of this._stats) {
      this._stats.set(name, { name, calls: 0, errors: 0, totalTime: 0 });
    }
  }

  /**
   * 清空所有服务
   * @returns {void}
   */
  clear() {
    if (this._persistStatsTimerId !== null) {
      clearTimeout(this._persistStatsTimerId);
      this._persistStatsTimerId = null;
      this._flushStats();
    }
    this._services.clear();
    this._factories.clear();
    this._proxies.length = 0;
    this._stats.clear();
  }

  /**
   * @private
   * @param {string} name
   * @param {number} duration
   * @returns {void}
   */
  _recordSuccess(name, duration) {
    const stats = this._stats.get(name);
    if (stats) {
      stats.calls++;
      stats.totalTime += duration;
      this._persistStatsAsync();
    }
  }

  /**
   * @private
   * @param {string} name
   * @returns {void}
   */
  _recordError(name) {
    const stats = this._stats.get(name);
    if (stats) {
      stats.calls++;
      stats.errors++;
      this._persistStatsAsync();
    }
  }

  /**
   * 异步持久化统计到 Archive (dual-write pattern)
   * @private
   * @returns {void}
   */
  _persistStatsAsync() {
    if (!this._archive || this._stats.size === 0) return;
    if (this._persistStatsTimerId !== null) {
      clearTimeout(this._persistStatsTimerId);
    }
    this._persistStatsTimerId = setTimeout(() => {
      this._persistStatsTimerId = null;
      this._flushStats();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * 立即执行统计持久化写入（fire-and-forget）
   * @private
   * @returns {void}
   */
  _flushStats() {
    if (!this._archive || this._stats.size === 0) return;
    const archive = this._archive;
    const runId = this._runId;
    const statsObj = {};
    for (const [name, stat] of this._stats) {
      statsObj[name] = { ...stat };
    }
    const serviceCount = this._stats.size;
    (async () => {
      try {
        const checkpointId = `${runId}:servicebus:stats:${Date.now()}`;
        await archive.save(checkpointId, {
          schemaVersion: 1,
          stats: statsObj,
          timestamp: Date.now(),
          metadata: { runId, serviceCount },
        });
      } catch (err) {
        // 持久化失败不影响内存统计
      }
    })();
  }

  /**
   * @private
   * @param {string} event
   * @param {unknown} data
   * @returns {void}
   */
  _emit(event, data) {
    if (this._events) {
      this._events.emitSync(event, data);
    }
  }
}

/**
 * Normalize proxy input to a function-like proxy with an `.invoke` method.
 * @param {ServiceProxyLike} proxy
 * @returns {ServiceProxyWithInvoke}
 */
function normalizeProxy(proxy) {
  if (typeof proxy === 'function') {
    /** @type {ServiceProxyWithInvoke} */
    const fnProxy = /** @type {ServiceProxyWithInvoke} */ (proxy);

    const proxyRecord = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (proxy));

    const invokeCandidate = proxyRecord.invoke;
    fnProxy.invoke = typeof invokeCandidate === 'function' ? /** @type {ServiceProxy} */ (invokeCandidate) : fnProxy;

    const proxyNameCandidate = proxyRecord.proxyName;
    fnProxy.proxyName = typeof proxyNameCandidate === 'string'
      ? proxyNameCandidate
      : /** @type {Function} */ (proxy).name || undefined;

    return fnProxy;
  }

  if (proxy && typeof proxy.invoke === 'function') {
    /** @type {ServiceProxyWithInvoke} */
    const wrapper = async (ctx, next) => wrapper.invoke(ctx, next);
    wrapper.proxyName = typeof proxy.name === 'string' ? proxy.name : undefined;
    wrapper.invoke = async (ctx, next) => proxy.invoke(ctx, next);
    return wrapper;
  }

  throw new Error('Proxy must be a function or have an invoke function');
}

// 内置代理：重试
/**
 * @param {RetryProxyOptions} [options]
 * @returns {ServiceProxyWithInvoke}
 */
export function createRetryProxy(options = {}) {
  const { maxRetries = 3, backoff = 1000, delay, shouldRetry = () => true } = options;
  const baseDelay = typeof delay === 'number' ? delay : backoff;

  /** @type {ServiceProxyWithInvoke} */
  const proxy = async (ctx, next) => proxy.invoke(ctx, next);
  proxy.proxyName = 'retry';
  proxy.invoke = async (context, next) => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await next();
      } catch (error) {
        lastError = error;
        const canRetry = attempt < maxRetries && shouldRetry(error, context);
        if (!canRetry) break;
        await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
      }
    }
    throw lastError;
  };

  return proxy;
}

// 内置代理：超时
/**
 * @param {TimeoutProxyOptions} [options]
 * @returns {ServiceProxyWithInvoke}
 */
export function createTimeoutProxy(options = {}) {
  const { timeout = 30000 } = options;

  /** @type {ServiceProxyWithInvoke} */
  const proxy = async (ctx, next) => proxy.invoke(ctx, next);
  proxy.proxyName = 'timeout';
  proxy.invoke = async (context, next) => {
    const timeoutMs = typeof context.options?.timeout === 'number' ? context.options.timeout : timeout;

    let timerId;
    let settled = false;
    return new Promise((resolve, reject) => {
      timerId = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Service call timeout: ${context.service}.${context.method}`));
        }
      }, timeoutMs);

      next().then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timerId);
            resolve(value);
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timerId);
            reject(err);
          }
        }
      );
    });
  };

  return proxy;
}

// 内置代理：缓存
/**
 * @param {CacheProxyOptions} [options]
 * @returns {ServiceProxyWithInvoke}
 */
export function createCacheProxy(options = {}) {
  const { ttl = 60000, maxSize, keyFn = null } = options;
  const cache = new Map();

  const resolvedMaxSize = Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : null;

  /** @type {ServiceProxyWithInvoke} */
  const proxy = async (ctx, next) => proxy.invoke(ctx, next);
  proxy.proxyName = 'cache';
  proxy.invoke = async (context, next) => {
    const key = keyFn
      ? keyFn(context)
      : `${context.service}.${context.method}:${JSON.stringify(context.args)}`;

    const optionTtl = typeof context.options?.cache === 'number' ? context.options.cache : ttl;
    const cacheEnabled = context.options?.cache !== false;
    if (!cacheEnabled || optionTtl <= 0) {
      return next();
    }

    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < optionTtl) {
      return cached.value;
    }

    const result = await next();
    if (resolvedMaxSize !== 0) {
      if (resolvedMaxSize != null && cache.size >= resolvedMaxSize) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(key, { value: result, time: Date.now() });
    }

    return result;
  };

  return proxy;
}

export default ServiceBus;
