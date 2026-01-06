/**
 * Compatibility Layer - 兼容旧 Provider API
 *
 * 让新 Kernel 可以直接使用旧的 ServiceProvider
 */

import { createPlugin } from './plugin.js';

/**
 * 检测是否为旧 ServiceProvider
 */
export function isServiceProvider(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.register === 'function' &&
    !value.install // 新 Plugin 有 install，旧 Provider 没有
  );
}

/**
 * 将旧 ServiceProvider 适配为新 Plugin
 *
 * @param {Object} provider - 旧 ServiceProvider
 * @returns {Object} 新 Plugin
 */
export function adaptProvider(provider) {
  const name = provider.name || provider.constructor?.name || `provider_${Date.now()}`;

  return createPlugin({
    name: `compat/${name}`,
    version: '1.0.0',
    description: `Adapted from legacy ServiceProvider: ${name}`,

    async install(ctx) {
      // 创建兼容的 kernel 接口
      const kernelCompat = createKernelCompat(ctx);

      // 调用旧 provider 的 register
      await provider.register(kernelCompat);

      // 保存引用供 start/stop 使用
      ctx._legacyProvider = provider;
      ctx._kernelCompat = kernelCompat;

      ctx.log.info(`Legacy provider "${name}" adapted`);
    },

    async onStart(ctx) {
      if (typeof ctx._legacyProvider?.start === 'function') {
        await ctx._legacyProvider.start(ctx._kernelCompat);
      }
    },

    async onStop(ctx) {
      if (typeof ctx._legacyProvider?.stop === 'function') {
        await ctx._legacyProvider.stop(ctx._kernelCompat);
      }
    },

    async uninstall(ctx) {
      ctx._legacyProvider = null;
      ctx._kernelCompat = null;
    },
  });
}

/**
 * 创建兼容的 kernel 接口
 * 让旧 Provider 的 register(kernel) 能正常工作
 */
function createKernelCompat(ctx) {
  const registeredServices = new Map();

  return {
    // === 旧 MicroKernel API ===

    /**
     * 注册服务（兼容旧 Container API）
     */
    register(id, factoryOrValue, options = {}) {
      if (typeof factoryOrValue === 'function') {
        // 工厂函数 - 懒加载
        ctx.services.registerFactory(id, () => factoryOrValue(this), options);
      } else {
        // 直接值
        ctx.services.register(id, factoryOrValue, options);
      }
      registeredServices.set(id, true);
      return this;
    },

    /**
     * 获取服务
     */
    getService(id) {
      return ctx.services.get(id);
    },

    /**
     * 发射事件
     */
    emit(type, payload) {
      return ctx.events.emit(type, payload);
    },

    /**
     * 订阅事件
     */
    on(type, handler) {
      return ctx.on(type, handler);
    },

    /**
     * 请求-响应模式
     */
    async request(type, payload, options = {}) {
      const timeout = options.timeout || 30000;

      // 发射请求事件
      ctx.events.emit(type, payload);

      // 等待响应
      try {
        const response = await ctx.events.waitFor(`${type}.response`, timeout);
        return response.data;
      } catch (err) {
        if (err.message.includes('timeout')) {
          throw new Error(`Request timeout: ${type}`);
        }
        throw err;
      }
    },

    // === 扩展访问 ===

    /**
     * 访问新 Kernel 的 EventBus
     */
    get eventBus() {
      return ctx.events;
    },

    /**
     * 访问新 Kernel 的 StateBus
     */
    get state() {
      return ctx.state;
    },

    /**
     * 访问新 Kernel 的 ServiceBus
     */
    get services() {
      return ctx.services;
    },

    /**
     * 获取已注册的服务列表
     */
    getRegisteredServices() {
      return [...registeredServices.keys()];
    },
  };
}

/**
 * 批量适配 Providers
 */
export function adaptProviders(providers) {
  return providers.map(p => adaptProvider(p));
}

export default {
  isServiceProvider,
  adaptProvider,
  adaptProviders,
};
