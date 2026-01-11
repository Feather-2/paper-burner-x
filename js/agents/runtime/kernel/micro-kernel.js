/**
 * MicroKernel (legacy compatibility)
 *
 * Runtime 2.x moved to `js/agents/core/kernel.js`, but some consumers/tests still
 * import the old MicroKernel entrypoint. This module provides a small, stable
 * subset of the historical API.
 */

import { EventBus } from "../../core/event-bus.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class MicroKernel {
  /**
   * @param {{ scheduler?: any, providers?: any[] }} [options]
   */
  constructor({ scheduler = null, providers = [] } = {}) {
    this.eventBus = new EventBus();
    this.scheduler = scheduler;
    this.providers = Array.isArray(providers) ? providers : [];

    /** @type {Map<string, unknown>} */
    this._services = new Map();
    /** @type {Map<string, Function>} */
    this._factories = new Map();
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();

    this._started = false;

    // Built-in services.
    this.register("kernel", this);
    this.register("eventBus", this.eventBus);
  }

  /**
   * Register a service factory or value.
   * @param {string} id
   * @param {unknown} factoryOrValue
   * @returns {this}
   */
  register(id, factoryOrValue) {
    if (typeof id !== "string" || !id) {
      throw new TypeError("MicroKernel.register: id must be a non-empty string");
    }

    if (typeof factoryOrValue === "function") {
      this._factories.set(id, factoryOrValue);
      this._services.delete(id);
      return this;
    }

    this._factories.delete(id);
    this._services.set(id, factoryOrValue);
    return this;
  }

  /**
   * Resolve a service by id (singleton).
   * @param {string} id
   * @returns {any|null}
   */
  getService(id) {
    const key = String(id || "");
    if (this._services.has(key)) return this._services.get(key);

    const factory = this._factories.get(key);
    if (!factory) return null;

    const instance = factory();
    this._services.set(key, instance);
    return instance;
  }

  /**
   * Subscribe to an event (payload-first).
   * @param {string} type
   * @param {(payload: any) => any} handler
   * @returns {() => void}
   */
  on(type, handler) {
    const eventType = String(type || "");
    if (typeof handler !== "function") {
      throw new TypeError("MicroKernel.on: handler must be a function");
    }

    let set = this._handlers.get(eventType);
    if (!set) {
      set = new Set();
      this._handlers.set(eventType, set);
    }
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) this._handlers.delete(eventType);
    };
  }

  /**
   * Emit an event (payload-first).
   * @param {string} type
   * @param {any} payload
   * @returns {void}
   */
  emit(type, payload) {
    const eventType = String(type || "");
    const handlers = this._handlers.get(eventType);
    if (handlers && handlers.size > 0) {
      for (const fn of Array.from(handlers)) {
        fn(payload);
      }
    }

    // Best-effort: also mirror to the structured EventBus.
    try {
      this.eventBus.emit(eventType, payload);
    } catch {
      // ignore
    }
  }

  /**
   * Request/response helper: resolves with the first non-undefined handler result.
   * Times out if no handler responds.
   * @param {string} type
   * @param {any} payload
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<any>}
   */
  request(type, payload, { timeoutMs = 5_000 } = {}) {
    const eventType = String(type || "");
    const timeout = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 5_000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        settled = true;
        reject(new Error(`Request timeout: ${eventType}`));
      }, timeout);

      const handlers = this._handlers.get(eventType);
      const list = handlers ? Array.from(handlers) : [];

      Promise.resolve()
        .then(async () => {
          for (const fn of list) {
            const res = await fn(payload);
            if (res !== undefined) return res;
          }
          return undefined;
        })
        .then(
          (res) => {
            if (settled) return;
            if (res === undefined) return; // wait for timeout
            settled = true;
            globalThis.clearTimeout(timer);
            resolve(res);
          },
          (err) => {
            if (settled) return;
            settled = true;
            globalThis.clearTimeout(timer);
            reject(err);
          }
        );
    });
  }

  /**
   * Task scheduling helper.
   * - Functions execute directly.
   * - DispatchTask objects delegate to scheduler.dispatch(runtimeType, code, inputState, options).
   * @param {Function | { runtimeType?: string, type?: string, code?: string, inputState?: any, options?: any }} task
   * @param {number} [priority]
   * @returns {Promise<any>}
   */
  async schedule(task, priority) {
    if (typeof task === "function") {
      return await Promise.resolve().then(() => task());
    }

    if (!isPlainObject(task)) {
      throw new TypeError("MicroKernel.schedule: task must be a function or an object");
    }

    if (!this.scheduler || typeof this.scheduler.dispatch !== "function") {
      throw new Error("MicroKernel.schedule: scheduler.dispatch is required for dispatch tasks");
    }

    const runtimeType = String(task.runtimeType || task.type || "js");
    const code = String(task.code || "");
    const inputState = isPlainObject(task.inputState) ? task.inputState : task.inputState ?? {};
    const options = isPlainObject(task.options) ? task.options : {};

    return await this.scheduler.dispatch(runtimeType, code, inputState, { ...options, priority });
  }

  /**
   * Start providers (idempotent).
   * @returns {Promise<void>}
   */
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
        await provider.start();
      }
    }
  }

  /**
   * Stop providers (best-effort, idempotent).
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this._started) return;
    this._started = false;

    for (const provider of this.providers) {
      if (provider && typeof provider.stop === "function") {
        await provider.stop();
      }
    }
  }
}

export default MicroKernel;
