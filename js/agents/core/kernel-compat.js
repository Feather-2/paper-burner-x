import { Kernel } from "./kernel.js";

/**
 * Types
 * @typedef {import('./types.d.ts').EventHandler} EventHandler
 *
 * @typedef {Object} DispatchTask
 * @property {string} code
 * @property {string} [runtimeType]
 * @property {string} [type]
 * @property {Record<string, unknown>} [inputState]
 * @property {Record<string, unknown>} [options]
 *
 * @typedef {Object} KernelContainerCompat
 * @property {(id: string, factoryOrValue: unknown, options?: Record<string, unknown>) => KernelCompat} register
 * @property {(id: string) => Promise<unknown | null>} get
 * @property {(id: string) => boolean} has
 */

/**
 * KernelCompat - legacy MicroKernel API wrapper
 */
export class KernelCompat extends Kernel {
  /**
   * 兼容旧 API: kernel.register(id, factory)
   * @deprecated 使用 registerService 或 registerServiceFactory
   * @param {string} id
   * @param {unknown} factoryOrValue
   * @param {Record<string, unknown>} [options={}]
   * @returns {this}
   */
  register(id, factoryOrValue, options = {}) {
    if (typeof factoryOrValue === "function") {
      this.services.registerFactory(id, /** @type {() => unknown | Promise<unknown>} */ (factoryOrValue), options);
    } else {
      this.services.register(id, /** @type {unknown} */ (factoryOrValue), options);
    }
    return this;
  }

  /**
   * 兼容旧 API: kernel.getService(id)
   * @deprecated 使用 services.get(id)
   * @template T
   * @param {string} id
   * @returns {T | null}
   */
  getService(id) {
    const registered = this.services._services.get(id);
    return registered ? /** @type {T} */ (registered.instance) : null;
  }

  /**
   * 兼容旧 API: kernel.emit(type, payload)
   * @param {string} type
   * @param {unknown} [payload]
   * @returns {void}
   */
  emit(type, payload) {
    void this.events.emit(type, payload);
  }

  /**
   * 兼容旧 API: kernel.on(type, handler)
   * @param {string} type
   * @param {EventHandler} handler
   * @returns {() => void}
   */
  on(type, handler) {
    return /** @type {() => void} */ (
      /** @type {import('./types.d.ts').EventBus} */ (/** @type {unknown} */ (this.events)).on(type, handler)
    );
  }

  /**
   * 兼容旧 API: kernel.schedule(task, priority)
   * 需要 scheduler 插件支持
   * @param {(() => unknown) | DispatchTask} task
   * @param {number} [priority]
   * @returns {Promise<unknown>}
   */
  schedule(task, priority) {
    if (this.services.has("scheduler")) {
      return this.services.call("scheduler", "schedule", [task, priority]);
    }
    // 降级：直接执行
    if (typeof task === "function") {
      return Promise.resolve().then(() => task());
    }
    throw new Error("Scheduler not available. Use scheduler plugin or pass a function.");
  }

  /**
   * 兼容旧 API: kernel.eventBus
   * @returns {import('./types.d.ts').EventBus}
   */
  get eventBus() {
    return /** @type {import('./types.d.ts').EventBus} */ (/** @type {unknown} */ (this.events));
  }

  /**
   * 兼容旧 API: kernel.container (部分兼容)
   * 返回一个类似 Container 的接口
   * @returns {KernelContainerCompat}
   */
  get container() {
    const self = this;
    return {
      register: (id, factory, opts) => self.register(id, factory, opts),
      get: (id) => self.services.get(id),
      has: (id) => self.services.has(id),
    };
  }
}

/**
 * Attach legacy methods to a Kernel subclass.
 * @param {typeof Kernel} KernelClass
 * @returns {typeof Kernel}
 */
export function attachKernelCompat(KernelClass) {
  if (!KernelClass || /** @type {{ register?: unknown }} */ (KernelClass.prototype).register) return KernelClass;
  const descriptors = Object.getOwnPropertyDescriptors(KernelCompat.prototype);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "constructor") continue;
    Object.defineProperty(KernelClass.prototype, key, descriptor);
  }
  return KernelClass;
}

export default KernelCompat;
