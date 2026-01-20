import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/core/kernel.js", () => {
  class Kernel {
    constructor() {
      this.services = createServiceBus();
      this.events = createEventBus();
    }
  }

  function createServiceBus() {
    const bus = {
      _services: new Map(),
    };

    bus.registerFactory = (id, factory, options) => {
      bus._services.set(id, { instance: factory, options, type: "factory" });
    };
    bus.register = (id, value, options) => {
      bus._services.set(id, { instance: value, options, type: "value" });
    };
    bus.get = async (id) => bus._services.get(id)?.instance ?? null;
    bus.has = (id) => bus._services.has(id);
    bus.call = async (id, method, args) => {
      const target = bus._services.get(id)?.instance;
      if (!target || typeof target[method] !== "function") {
        throw new Error("Missing service method");
      }
      return target[method](...args);
    };

    return bus;
  }

  function createEventBus() {
    const bus = {
      _handlers: [],
      _history: [],
    };

    bus.emit = async (type, payload) => {
      bus._history.push({ type, payload });
    };

    bus.on = (type, handler) => {
      bus._handlers.push({ type, handler });
      return () => {
        bus._handlers = bus._handlers.filter((entry) => entry.type !== type || entry.handler !== handler);
      };
    };

    return bus;
  }

  return { Kernel };
});

import KernelCompatDefault, {
  KernelCompat,
  attachKernelCompat,
} from "../../../../js/agents/core/kernel-compat.js";

describe("KernelCompat", () => {
  /** @type {KernelCompat} */
  let kernel;

  beforeEach(() => {
    vi.clearAllMocks();
    kernel = new KernelCompat();
  });

  it("register uses registerFactory for functions and returns this", () => {
    const registerFactorySpy = vi.spyOn(kernel.services, "registerFactory");
    const registerSpy = vi.spyOn(kernel.services, "register");
    const factory = vi.fn(() => ({ ok: true }));
    const options = { singleton: true };

    const result = kernel.register("service", factory, options);

    expect(result).toBe(kernel);
    expect(registerFactorySpy).toHaveBeenCalledTimes(1);
    expect(registerFactorySpy).toHaveBeenCalledWith("service", factory, options);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it("register uses register for non-function values with empty id and null value", () => {
    const registerFactorySpy = vi.spyOn(kernel.services, "registerFactory");
    const registerSpy = vi.spyOn(kernel.services, "register");
    const options = {};

    const result = kernel.register("", null, options);

    expect(result).toBe(kernel);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith("", null, options);
    expect(registerFactorySpy).not.toHaveBeenCalled();
  });

  it("getService returns registered instance or null for missing entries", () => {
    const instance = { name: "svc" };
    kernel.services._services.set("svc", { instance });

    expect(kernel.getService("svc")).toBe(instance);
    expect(kernel.getService("missing")).toBeNull();
    expect(kernel.getService(undefined)).toBeNull();
  });

  it("emit forwards payloads including empty and whitespace types", () => {
    const emitSpy = vi.spyOn(kernel.events, "emit");
    const hugeFileContents = "x".repeat(10000);
    const deepNested = { a: { b: { c: { d: { e: [] } } } } };
    const arrayLike = { 0: "a", length: 1 };
    const payload = {
      hugeFileContents,
      deepNested,
      arrayLike,
      emptyArray: [],
      emptyObject: {},
    };

    kernel.emit("", payload);
    kernel.emit(" ", null);

    expect(emitSpy).toHaveBeenNthCalledWith(1, "", payload);
    expect(emitSpy).toHaveBeenNthCalledWith(2, " ", null);
  });

  it("emit handles rapid consecutive calls", () => {
    const emitSpy = vi.spyOn(kernel.events, "emit");
    for (let i = 0; i < 5; i += 1) {
      kernel.emit("tick", i);
    }

    expect(emitSpy).toHaveBeenCalledTimes(5);
  });

  it("on returns unsubscribe function and tracks handlers", () => {
    const onSpy = vi.spyOn(kernel.events, "on");
    const handler = vi.fn();

    const unsubscribe = kernel.on("event", handler);

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledWith("event", handler);
    expect(typeof unsubscribe).toBe("function");
    expect(kernel.events._handlers).toHaveLength(1);

    unsubscribe();
    expect(kernel.events._handlers).toHaveLength(0);
  });

  it("schedule delegates to scheduler and preserves boundary values", async () => {
    const callSpy = vi.spyOn(kernel.services, "call");
    const scheduleSpy = vi.fn(async (task, priority) => ({ task, priority }));
    kernel.services._services.set("scheduler", { instance: { schedule: scheduleSpy } });

    const hugeFileContents = "y".repeat(12000);
    const deepNested = { level1: { level2: { level3: { level4: { value: "ok" } } } } };
    const arrayLike = { 0: "x", length: 1 };

    const tasks = [
      { code: "task-0", inputState: deepNested, options: { file: hugeFileContents } },
      { code: "task-1", inputState: arrayLike, options: { list: [] } },
      { code: "", inputState: {}, options: {} },
      { code: "task-3", inputState: [], options: { nested: { value: 0 } } },
    ];
    const priorities = [0, -1, Number.MAX_SAFE_INTEGER, "1"];

    const results = await Promise.all(
      tasks.map((task, index) => kernel.schedule(task, priorities[index]))
    );

    expect(callSpy).toHaveBeenCalledTimes(4);
    expect(scheduleSpy).toHaveBeenCalledTimes(4);
    expect(callSpy).toHaveBeenNthCalledWith(1, "scheduler", "schedule", [tasks[0], 0]);
    expect(callSpy).toHaveBeenNthCalledWith(2, "scheduler", "schedule", [tasks[1], -1]);
    expect(callSpy).toHaveBeenNthCalledWith(
      3,
      "scheduler",
      "schedule",
      [tasks[2], Number.MAX_SAFE_INTEGER]
    );
    expect(callSpy).toHaveBeenNthCalledWith(4, "scheduler", "schedule", [tasks[3], "1"]);
    expect(results[0]).toEqual({ task: tasks[0], priority: 0 });
  });

  it("schedule executes functions when scheduler is missing and supports concurrent calls", async () => {
    const values = ["ok", 0, Number.MAX_SAFE_INTEGER, undefined];
    const tasks = values.map((value) => vi.fn(() => value));

    const results = await Promise.all(tasks.map((task) => kernel.schedule(task, "2")));

    expect(results).toEqual(values);
    tasks.forEach((task) => {
      expect(task).toHaveBeenCalledTimes(1);
    });
  });

  it("schedule throws when scheduler is missing and task is not a function", async () => {
    const task = { code: "dispatch", inputState: {}, options: {} };

    expect(() => kernel.schedule(task)).toThrow(
      "Scheduler not available. Use scheduler plugin or pass a function."
    );
  });

  it("eventBus exposes the underlying events bus", () => {
    expect(kernel.eventBus).toBe(kernel.events);
  });

  it("container proxies register/get/has to services", async () => {
    const registerSpy = vi.spyOn(kernel.services, "register");
    const value = { ok: true };
    const options = { mode: "legacy" };

    const container = kernel.container;
    const result = container.register("svc", value, options);

    expect(result).toBe(kernel);
    expect(registerSpy).toHaveBeenCalledWith("svc", value, options);

    const fetched = await container.get("svc");
    expect(fetched).toBe(value);
    expect(container.has("svc")).toBe(true);
  });
});

describe("attachKernelCompat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches legacy methods and getters to a Kernel subclass", async () => {
    const KernelBase = Object.getPrototypeOf(KernelCompat);
    class LegacyKernel extends KernelBase {}

    const Patched = attachKernelCompat(LegacyKernel);
    const instance = new Patched();
    const registerSpy = vi.spyOn(instance.services, "register");

    expect(Patched).toBe(LegacyKernel);
    expect(typeof instance.register).toBe("function");
    expect(instance.eventBus).toBe(instance.events);

    const result = instance.register("service", { ok: true }, {});
    expect(result).toBe(instance);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(typeof instance.container.get).toBe("function");
    expect(await instance.container.get("service")).toEqual({ ok: true });
  });

  it("returns the input class unchanged when register already exists", () => {
    const existingRegister = vi.fn();
    const KernelBase = Object.getPrototypeOf(KernelCompat);
    class CustomKernel extends KernelBase {
      register() {
        return existingRegister();
      }
    }

    const Patched = attachKernelCompat(CustomKernel);

    expect(Patched).toBe(CustomKernel);
    expect(Patched.prototype.register).toBe(CustomKernel.prototype.register);
    expect(Patched.prototype.getService).toBeUndefined();
  });

  it("returns null or undefined input without errors", () => {
    expect(attachKernelCompat(null)).toBeNull();
    expect(attachKernelCompat(undefined)).toBeUndefined();
  });
});

describe("default", () => {
  it("exports KernelCompat as default", () => {
    expect(KernelCompatDefault).toBe(KernelCompat);
  });
});
