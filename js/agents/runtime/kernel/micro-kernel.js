import { RuntimeScheduler, TaskPriority } from "../core/scheduler.js";
import { Container } from "../di/container.js";
import { ServiceId } from "../di/defaults.js";
import { EventBus } from "../events/event-bus.js";

import { MessageBus } from "./message-bus.js";
import { isServiceProvider } from "./service-provider.js";

function isContainerLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.register === "function" &&
    typeof value.get === "function"
  );
}

function ensureContainer(container) {
  if (container === undefined || container === null) return new Container();
  if (container instanceof Container) return container;
  if (isContainerLike(container)) return container;
  throw new TypeError("MicroKernel({ container }): container must be a Container");
}

function ensureEventBus(eventBus) {
  if (eventBus === undefined || eventBus === null) return new EventBus();
  if (eventBus instanceof EventBus) return eventBus;
  throw new TypeError("MicroKernel({ eventBus }): eventBus must be an EventBus");
}

function maybeOverride(container, id, value) {
  if (container && typeof container.override === "function") {
    container.override(id, () => value);
    return;
  }
  if (container && typeof container.registerValue === "function") {
    container.registerValue(id, value);
    return;
  }
  container.register(id, () => value);
}

function isDispatchTask(task) {
  return (
    task &&
    typeof task === "object" &&
    typeof task.code === "string" &&
    (typeof task.runtimeType === "string" || typeof task.type === "string")
  );
}

export class MicroKernel {
  constructor({ container, eventBus, scheduler, providers } = {}) {
    this.container = ensureContainer(container);
    this.eventBus = ensureEventBus(eventBus);
    this.scheduler =
      scheduler === undefined || scheduler === null
        ? new RuntimeScheduler({ eventBus: this.eventBus })
        : scheduler;

    this.messageBus = new MessageBus(this.eventBus);

    this._ownsEventBus = eventBus === undefined || eventBus === null;
    this._ownsScheduler = scheduler === undefined || scheduler === null;
    this._started = false;
    this._providers = [];
    this._registeredProviders = new Set();

    this._registerCoreServices();

    if (providers !== undefined && providers !== null) {
      if (!Array.isArray(providers)) {
        throw new TypeError("MicroKernel({ providers }): providers must be an array");
      }
      for (const p of providers) this.use(p);
    }
  }

  _registerCoreServices() {
    maybeOverride(this.container, "kernel", this);
    maybeOverride(this.container, ServiceId.EVENT_BUS, this.eventBus);
    maybeOverride(this.container, "messageBus", this.messageBus);
    if (this.scheduler) maybeOverride(this.container, "scheduler", this.scheduler);
  }

  register(id, factory, options) {
    if (typeof factory === "function") {
      this.container.register(id, factory, options);
      return this;
    }
    if (typeof this.container.registerValue === "function") {
      this.container.registerValue(id, factory);
      return this;
    }
    this.container.register(id, () => factory, options);
    return this;
  }

  getService(id) {
    return this.container.get(id);
  }

  emit(type, payload) {
    return this.messageBus.emit(type, payload);
  }

  on(type, handler) {
    return this.messageBus.on(type, handler);
  }

  request(type, payload, options) {
    return this.messageBus.request(type, payload, options);
  }

  /**
   * Schedule a task with optional priority.
   *
   * Supports:
   * - Function task: () => any | Promise<any>
   * - Dispatch task: { runtimeType|type, code, inputState?, options? }
   */
  schedule(task, priority = TaskPriority.NORMAL) {
    if (this.scheduler && typeof this.scheduler.schedule === "function") {
      return this.scheduler.schedule(task, priority);
    }

    if (this.scheduler && typeof this.scheduler.dispatch === "function" && isDispatchTask(task)) {
      const runtimeType = task.runtimeType || task.type;
      const inputState = task.inputState && typeof task.inputState === "object" ? task.inputState : {};
      const options = task.options && typeof task.options === "object" ? { ...task.options } : {};
      if (priority !== undefined) options.priority = priority;
      return this.scheduler.dispatch(runtimeType, task.code, inputState, options);
    }

    if (typeof task === "function") {
      return Promise.resolve().then(() => task());
    }

    throw new Error("MicroKernel.schedule(task, priority): unsupported task type");
  }

  use(provider) {
    if (!isServiceProvider(provider)) {
      throw new TypeError("MicroKernel.use(provider): provider must implement register(kernel)");
    }
    this._providers.push(provider);
    return this;
  }

  async start() {
    if (this._started) return;
    this._started = true;

    for (const provider of this._providers) {
      if (this._registeredProviders.has(provider)) continue;
      this._registeredProviders.add(provider);
      await provider.register(this);
    }

    for (const provider of this._providers) {
      if (typeof provider.start === "function") {
        await provider.start(this);
      }
    }

    this.emit("kernel.started", { hasScheduler: !!this.scheduler });
  }

  async stop() {
    if (!this._started) return;
    this._started = false;

    this.emit("kernel.stopping");

    for (const provider of [...this._providers].reverse()) {
      if (typeof provider.stop === "function") {
        await provider.stop(this);
      }
    }

    try {
      this.messageBus.dispose();
    } catch {
      // ignore
    }

    if (this._ownsScheduler && typeof this.scheduler?.stop === "function") {
      try {
        await this.scheduler.stop();
      } catch {
        // ignore
      }
    }

    if (this._ownsEventBus && typeof this.eventBus?.dispose === "function") {
      try {
        this.eventBus.dispose();
      } catch {
        // ignore
      }
    }
  }
}

