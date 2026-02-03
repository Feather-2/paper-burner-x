/**
 * MicroKernel (legacy-compatible)
 *
 * This is a small compatibility layer used by older runtime code/tests.
 * The main system uses `core/Kernel`, but some unit tests still expect the
 * historical MicroKernel surface.
 */

import { EventBus } from "../../core/event-bus.js";
import { ServiceId } from "../../core/di/defaults.js";
import { enhanceEventBusWithHooks } from "../hooks/event-bus-hooks.js";

/** Default timeout for request() in milliseconds */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Maximum code length for scheduled tasks */
const MAX_TASK_CODE_LENGTH = 1_000_000;

/** Allowed runtime types for dispatch tasks */
const ALLOWED_RUNTIME_TYPES = Object.freeze(["js", "python", "wasm", ""]);

/**
 * Custom error for MicroKernel configuration issues.
 */
export class MicroKernelConfigError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "MicroKernelConfigError";
  }
}

/**
 * Custom error for MicroKernel runtime issues.
 */
export class MicroKernelError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "MicroKernelError";
    this.code = options.code ?? null;
  }
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteTimeoutMs(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * @typedef {object} MicroKernelScheduler
 * @property {(runtimeType: string, code: string, inputState: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>} dispatch
 */

/**
 * @typedef {object} MicroKernelProvider
 * @property {(kernel: MicroKernel) => void | Promise<void>} [register]
 * @property {(kernel: MicroKernel) => void | Promise<void>} [start]
 * @property {(kernel: MicroKernel) => void | Promise<void>} [stop]
 */

/**
 * @typedef {object} MicroKernelOptions
 * @property {MicroKernelScheduler | null} [scheduler] - Task dispatcher
 * @property {MicroKernelProvider[]} [providers] - Lifecycle providers
 * @property {string | null} [runId] - Run identifier for tracing
 */

/**
 * @typedef {object} DispatchTask
 * @property {string} [runtimeType] - Runtime type (js, python, wasm)
 * @property {string} [type] - Alternative to runtimeType
 * @property {string} code - Code to execute
 * @property {Record<string, unknown>} [inputState] - Input state
 * @property {Record<string, unknown>} [options] - Additional options
 */

/**
 * @typedef {object} RequestOptions
 * @property {number} [timeoutMs] - Timeout in milliseconds
 * @property {number} [timeout] - Alternative to timeoutMs
 */

export class MicroKernel {
  /**
   * Creates a MicroKernel instance.
   * @param {MicroKernelOptions} [options] - Configuration options
   * @throws {MicroKernelConfigError} When options is provided but invalid
   */
  constructor(options = {}) {
    const base = options && typeof options === "object" ? options : {};

    /** @type {EventBus} */
    this.eventBus = new EventBus({ runId: base.runId || null });
    enhanceEventBusWithHooks(this.eventBus);

    /** @type {MicroKernelScheduler | null} */
    this.scheduler = base.scheduler || null;

    /** @type {MicroKernelProvider[]} */
    this.providers = Array.isArray(base.providers) ? base.providers : [];

    /** @type {boolean} */
    this._started = false;

    /** @type {Map<string, unknown>} */
    this._instances = new Map();

    /** @type {Map<string, (kernel: MicroKernel) => unknown>} */
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
   * @param {string} id - Service identifier
   * @param {unknown | ((kernel: MicroKernel) => unknown)} factoryOrValue - Service instance or factory
   * @returns {this}
   * @throws {MicroKernelConfigError} When id is empty
   */
  register(id, factoryOrValue) {
    const key = String(id || "");
    if (!key) throw new MicroKernelConfigError("MicroKernel.register(id): id is required");

    if (typeof factoryOrValue === "function") {
      this._factories.set(key, /** @type {any} */ (factoryOrValue));
      this._instances.delete(key);
      return this;
    }

    this._instances.set(key, factoryOrValue);
    this._factories.delete(key);
    return this;
  }

  /**
   * Resolve a service synchronously.
   * @param {string} id - Service identifier
   * @returns {unknown} Service instance or null if not found
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
   * @param {string} type - Event type
   * @param {unknown} payload - Event payload
   * @returns {void}
   */
  emit(type, payload) {
    this.eventBus.emit(String(type || ""), payload);
  }

  /**
   * Subscribe to events; handler receives the raw payload.
   * @param {string} type - Event type
   * @param {(payload: unknown) => unknown} handler - Event handler
   * @returns {() => void} Unsubscribe function
   * @throws {MicroKernelConfigError} When type is empty or handler is not a function
   */
  on(type, handler) {
    const name = String(type || "");
    if (!name) throw new MicroKernelConfigError("MicroKernel.on(type): type is required");
    if (typeof handler !== "function") throw new MicroKernelConfigError("MicroKernel.on(type): handler must be a function");

    let map = this._handlerWrappers.get(name);
    if (!map) {
      map = new Map();
      this._handlerWrappers.set(name, map);
    }

    const wrapper = (evt) => handler(evt?.payload);
    map.set(handler, wrapper);

    const offCore = this.eventBus.on(name, /** @type {any} */ (wrapper));
    return () => {
      offCore?.();
      map.delete(handler);
      if (map.size === 0) this._handlerWrappers.delete(name);
    };
  }

  /**
   * Request/response helper that invokes the first registered handler.
   * @param {string} type - Event type
   * @param {unknown} payload - Request payload
   * @param {RequestOptions} [options] - Request options
   * @returns {Promise<unknown>} Handler result
   * @throws {MicroKernelConfigError} When type is empty
   * @throws {MicroKernelError} When request times out
   */
  async request(type, payload, options = {}) {
    const name = String(type || "");
    if (!name) throw new MicroKernelConfigError("MicroKernel.request(type): type is required");

    const timeoutMs = toFiniteTimeoutMs(options?.timeoutMs ?? options?.timeout, DEFAULT_REQUEST_TIMEOUT_MS);
    const handlers = this._handlerWrappers.get(name);
    const handler = handlers ? handlers.keys().next().value : null;

    if (typeof handler !== "function") {
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      throw new MicroKernelError(`Request timeout: ${name}`, { code: "TIMEOUT" });
    }

    let timer = null;
    const timeoutPromise =
      timeoutMs > 0
        ? new Promise((_, reject) => {
            timer = setTimeout(() => reject(new MicroKernelError(`Request timeout: ${name}`, { code: "TIMEOUT" })), timeoutMs);
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
   * @param {(() => unknown) | DispatchTask} task - Function or dispatch task object
   * @param {number} [priority] - Task priority
   * @returns {Promise<unknown>} Task result
   * @throws {MicroKernelConfigError} When task is invalid or runtimeType is not allowed
   * @throws {MicroKernelError} When scheduler is not available
   */
  async schedule(task, priority) {
    if (typeof task === "function") {
      return await task();
    }

    if (!task || typeof task !== "object") {
      throw new MicroKernelConfigError("MicroKernel.schedule(task): task must be a function or dispatch object");
    }

    if (!this.scheduler || typeof this.scheduler.dispatch !== "function") {
      throw new MicroKernelError("Scheduler not available", { code: "SCHEDULER_UNAVAILABLE" });
    }

    const runtimeType = String(task.runtimeType || task.type || "");
    if (!ALLOWED_RUNTIME_TYPES.includes(runtimeType)) {
      throw new MicroKernelConfigError(`MicroKernel.schedule(task): invalid runtimeType "${runtimeType}", allowed: ${ALLOWED_RUNTIME_TYPES.join(", ")}`);
    }

    const code = String(task.code || "");
    if (code.length > MAX_TASK_CODE_LENGTH) {
      throw new MicroKernelConfigError(`MicroKernel.schedule(task): code exceeds maximum length of ${MAX_TASK_CODE_LENGTH}`);
    }

    const inputState = task.inputState && typeof task.inputState === "object" ? task.inputState : Object.create(null);
    const options = task.options && typeof task.options === "object" ? task.options : Object.create(null);

    return await this.scheduler.dispatch(runtimeType, code, inputState, {
      ...options,
      priority: typeof priority === "number" && Number.isFinite(priority) ? priority : options.priority,
    });
  }

  /**
   * Start the kernel and all registered providers.
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
        await provider.start(this);
      }
    }
  }

  /**
   * Stop the kernel and all registered providers.
   * @returns {Promise<void>}
   */
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
