/**
 * MicroKernel (legacy-compatible)
 *
 * This is a small compatibility layer used by older runtime code/tests.
 * The main system uses `core/Kernel`, but some unit tests still expect the
 * historical MicroKernel surface.
 */

import { EventBus } from "../../core/event-bus.js";
import { ServiceId } from "../di/defaults.js";
import { enhanceEventBusWithHooks } from "../hooks/event-bus-hooks.js";

function toFiniteTimeoutMs(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export class MicroKernel {
  /**
   * @param {{ scheduler?: any, providers?: any[] }} [options]
   */
  constructor(options = {}) {
    const base = options && typeof options === "object" ? options : {};

    /** @type {EventBus} */
    this.eventBus = new EventBus({ runId: base.runId || null });
    enhanceEventBusWithHooks(this.eventBus);

    /** @type {any} */
    this.scheduler = base.scheduler || null;

    /** @type {any[]} */
    this.providers = Array.isArray(base.providers) ? base.providers : [];

    /** @type {boolean} */
    this._started = false;

    /** @type {Map<string, any>} */
    this._instances = new Map();

    /** @type {Map<string, () => any>} */
    this._factories = new Map();

    /**
     * eventType -> Map(handler -> wrapper)
     * (wrapper is used to bridge core EventBus event records -> raw payload)
     * @type {Map<string, Map<Function, Function>>}
     */
    this._handlerWrappers = new Map();

    // Built-in services
    this.register(ServiceId.KERNEL, this);
    this.register("kernel", this);
    this.register(ServiceId.EVENT_BUS, this.eventBus);
  }

  /**
   * Register a service (singleton).
   * If a factory is provided, it will run on first getService().
   *
   * @param {string} id
   * @param {any} factoryOrValue
   * @returns {this}
   */
  register(id, factoryOrValue) {
    const key = String(id || "");
    if (!key) throw new TypeError("MicroKernel.register(id): id is required");

    if (typeof factoryOrValue === "function") {
      this._factories.set(key, factoryOrValue);
      this._instances.delete(key);
      return this;
    }

    this._instances.set(key, factoryOrValue);
    this._factories.delete(key);
    return this;
  }

  /**
   * Resolve a service synchronously.
   * @param {string} id
   * @returns {any|null}
   */
  getService(id) {
    const key = String(id || "");
    if (!key) return null;

    if (this._instances.has(key)) return this._instances.get(key);

    const factory = this._factories.get(key);
    if (!factory) return null;

    const value = factory(this);
    this._factories.delete(key);
    this._instances.set(key, value);
    return value;
  }

  /**
   * Emit an event with a raw payload.
   * @param {string} type
   * @param {any} payload
   * @returns {void}
   */
  emit(type, payload) {
    this.eventBus.emit(String(type || ""), payload);
  }

  /**
   * Subscribe to events; handler receives the raw payload.
   * @param {string} type
   * @param {(payload: any) => any} handler
   * @returns {() => void}
   */
  on(type, handler) {
    const name = String(type || "");
    if (!name) throw new TypeError("MicroKernel.on(type): type is required");
    if (typeof handler !== "function") throw new TypeError("MicroKernel.on(type): handler must be a function");

    let map = this._handlerWrappers.get(name);
    if (!map) {
      map = new Map();
      this._handlerWrappers.set(name, map);
    }

    const wrapper = (evt) => handler(evt?.payload);
    map.set(handler, wrapper);

    const offCore = this.eventBus.on(name, wrapper);
    return () => {
      offCore?.();
      map.delete(handler);
      if (map.size === 0) this._handlerWrappers.delete(name);
    };
  }

  /**
   * Request/response helper that invokes the first registered handler.
   * @param {string} type
   * @param {any} payload
   * @param {{ timeoutMs?: number, timeout?: number }} [options]
   * @returns {Promise<any>}
   */
  async request(type, payload, options = {}) {
    const name = String(type || "");
    if (!name) throw new TypeError("MicroKernel.request(type): type is required");

    const timeoutMs = toFiniteTimeoutMs(options?.timeoutMs ?? options?.timeout, 30_000);
    const handlers = this._handlerWrappers.get(name);
    const handler = handlers ? handlers.keys().next().value : null;

    if (typeof handler !== "function") {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      throw new Error(`Request timeout: ${name}`);
    }

    let timer = null;
    const timeoutPromise =
      timeoutMs > 0
        ? new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Request timeout: ${name}`)), timeoutMs);
          })
        : null;

    try {
      const resultPromise = Promise.resolve().then(() => handler(payload));
      return timeoutPromise ? await Promise.race([resultPromise, timeoutPromise]) : await resultPromise;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Schedule either a function or a dispatch task.
   * @param {(() => any) | { runtimeType?: string, type?: string, code: string, inputState?: any, options?: any }} task
   * @param {number} [priority]
   * @returns {Promise<any>}
   */
  async schedule(task, priority) {
    if (typeof task === "function") {
      return await task();
    }

    if (!task || typeof task !== "object") {
      throw new TypeError("MicroKernel.schedule(task): task must be a function or dispatch object");
    }

    if (!this.scheduler || typeof this.scheduler.dispatch !== "function") {
      throw new Error("Scheduler not available");
    }

    const runtimeType = String(task.runtimeType || task.type || "");
    const code = String(task.code || "");
    const inputState = task.inputState && typeof task.inputState === "object" ? task.inputState : {};
    const options = task.options && typeof task.options === "object" ? task.options : {};

    return await this.scheduler.dispatch(runtimeType, code, inputState, {
      ...options,
      priority: typeof priority === "number" && Number.isFinite(priority) ? priority : options.priority,
    });
  }

  async start() {
    if (this._started) return;
    this._started = true;

    for (const provider of this.providers) {
      if (provider && typeof provider.register === "function") {
        await provider.register(this);
      }
    }

    for (const provider of this.providers) {
      if (provider && typeof provider.start === "function") {
        await provider.start(this);
      }
    }
  }

  async stop() {
    if (!this._started) return;
    this._started = false;

    for (const provider of this.providers) {
      if (provider && typeof provider.stop === "function") {
        await provider.stop(this);
      }
    }
  }
}

export default MicroKernel;
