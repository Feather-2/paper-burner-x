import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/core/kernel.js", () => {
  class Kernel {
    constructor() {
      const servicesMap = new Map();

      const services = {
        _services: servicesMap,
        register: vi.fn((id, value, options) => {
          servicesMap.set(id, { instance: value, options });
        }),
        registerFactory: vi.fn((id, factory, options) => {
          servicesMap.set(id, { instance: undefined, factory, options });
        }),
        get: vi.fn(async (id) => {
          const entry = servicesMap.get(id);
          return entry ? entry.instance : null;
        }),
        has: vi.fn((id) => servicesMap.has(id)),
        call: vi.fn(async (id, method, args) => {
          const entry = servicesMap.get(id);
          if (!entry) throw new Error(`Service not found: ${String(id)}`);
          const serviceInstance = entry.instance;
          if (!serviceInstance || typeof serviceInstance[method] !== "function") {
            throw new Error(`Method not found: ${String(id)}.${String(method)}`);
          }
          return await serviceInstance[method](...args);
        }),
      };

      const listeners = new Map();

      const events = {
        emit: vi.fn(async (type, payload) => {
          const handlers = listeners.get(type);
          if (!handlers) return;
          for (const handler of handlers) handler(payload);
        }),
        on: vi.fn((type, handler) => {
          const handlers = listeners.get(type) ?? [];
          handlers.push(handler);
          listeners.set(type, handlers);
          return () => {
            const nextHandlers = (listeners.get(type) ?? []).filter((h) => h !== handler);
            listeners.set(type, nextHandlers);
          };
        }),
      };

      this.services = services;
      this.events = events;
    }
  }

  return { Kernel };
});

let KernelCompat;
let attachKernelCompat;
let KernelCompatDefault;
let Kernel;

beforeEach(async () => {
  vi.clearAllMocks();

  if (!KernelCompat || !attachKernelCompat || !KernelCompatDefault) {
    const mod = await import("../../../../js/agents/core/kernel-compat.js");
    KernelCompat = mod.KernelCompat;
    attachKernelCompat = mod.attachKernelCompat;
    KernelCompatDefault = mod.default;
  }

  if (!Kernel) {
    const kernelMod = await import("../../../../js/agents/core/kernel.js");
    Kernel = kernelMod.Kernel;
  }
});

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i++) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

function makeString(length) {
  return "x".repeat(length);
}

describe("KernelCompat", () => {
  let kernel;

  beforeEach(() => {
    kernel = new KernelCompat();
  });

  it("register uses services.registerFactory when factoryOrValue is a function", () => {
    const factory = vi.fn(() => ({ ok: true }));
    const options = { scope: "unit", nested: makeDeepObject(3) };

    const result = kernel.register("svc.factory", factory, options);

    expect(result).toBe(kernel);
    expect(kernel.services.registerFactory).toHaveBeenCalledTimes(1);
    expect(kernel.services.registerFactory).toHaveBeenCalledWith("svc.factory", factory, options);
    expect(kernel.services.register).not.toHaveBeenCalled();
  });

  it("register uses services.register when factoryOrValue is not a function (including null/undefined)", () => {
    const value = { a: 1 };

    expect(kernel.register("svc.value", value)).toBe(kernel);
    expect(kernel.services.register).toHaveBeenCalledWith("svc.value", value, {});

    const arrayOptions = [];
    expect(kernel.register("", undefined, arrayOptions)).toBe(kernel);
    expect(kernel.services.register).toHaveBeenCalledWith("", undefined, arrayOptions);

    const emptyObject = {};
    expect(kernel.register("   ", null, emptyObject)).toBe(kernel);
    expect(kernel.services.register).toHaveBeenCalledWith("   ", null, emptyObject);
  });

  it("getService returns instance when registered, null when missing, and preserves undefined instances", () => {
    const instance = { name: "svc" };
    kernel.services._services.set("svc", { instance });

    expect(kernel.getService("svc")).toBe(instance);
    expect(kernel.getService("missing")).toBeNull();

    kernel.services._services.set("undefined.instance", { instance: undefined });
    expect(kernel.getService("undefined.instance")).toBeUndefined();

    kernel.services._services.set("", { instance: 123 });
    expect(kernel.getService("")).toBe(123);

    expect(kernel.getService(/** @type {any} */ (0))).toBeNull();
  });

  it("emit forwards type/payload to events.emit (including empty and long strings)", () => {
    const deepPayload = { deep: makeDeepObject(20), emptyObj: {}, emptyArr: [], nil: null };

    kernel.emit("", undefined);
    kernel.emit("event", deepPayload);

    const longType = makeString(10_000);
    kernel.emit(longType, null);

    expect(kernel.events.emit).toHaveBeenCalledWith("", undefined);
    expect(kernel.events.emit).toHaveBeenCalledWith("event", deepPayload);
    expect(kernel.events.emit).toHaveBeenCalledWith(longType, null);
  });

  it("on forwards to events.on and returns the unsubscribe function", () => {
    const handler = vi.fn();
    const unsubscribe = vi.fn();

    kernel.events.on.mockReturnValueOnce(unsubscribe);

    const returned = kernel.on("evt", handler);

    expect(kernel.events.on).toHaveBeenCalledWith("evt", handler);
    expect(returned).toBe(unsubscribe);
  });

  it("on propagates errors from the underlying event bus", () => {
    kernel.events.on.mockImplementationOnce(() => {
      throw new Error("bad handler");
    });

    expect(() => kernel.on("evt", /** @type {any} */ (null))).toThrow("bad handler");
  });

  it("schedule uses scheduler service when available (priority boundaries included)", async () => {
    const scheduler = {
      schedule: vi.fn(async (task, priority) => ({ task, priority })),
    };
    kernel.services._services.set("scheduler", { instance: scheduler });

    const dispatchTask = {
      code: "do-something",
      runtimeType: "",
      type: "job",
      inputState: {},
      options: {},
    };

    const out0 = await kernel.schedule(dispatchTask, 0);
    expect(out0).toEqual({ task: dispatchTask, priority: 0 });

    const outNeg = await kernel.schedule(dispatchTask, -1);
    expect(outNeg).toEqual({ task: dispatchTask, priority: -1 });

    const outMax = await kernel.schedule(dispatchTask, Number.MAX_SAFE_INTEGER);
    expect(outMax).toEqual({ task: dispatchTask, priority: Number.MAX_SAFE_INTEGER });

    const outString = await kernel.schedule(dispatchTask, /** @type {any} */ ("0"));
    expect(outString).toEqual({ task: dispatchTask, priority: "0" });

    expect(kernel.services.call).toHaveBeenCalledWith("scheduler", "schedule", [dispatchTask, 0]);
    expect(kernel.services.call).toHaveBeenCalledWith("scheduler", "schedule", [dispatchTask, -1]);
    expect(kernel.services.call).toHaveBeenCalledWith("scheduler", "schedule", [dispatchTask, Number.MAX_SAFE_INTEGER]);
    expect(kernel.services.call).toHaveBeenCalledWith("scheduler", "schedule", [dispatchTask, "0"]);
    expect(scheduler.schedule).toHaveBeenCalledTimes(4);
  });

  it("schedule falls back to executing a function when scheduler is missing (concurrent calls supported)", async () => {
    const seen = new Set();
    const tasks = [
      () => {
        seen.add(1);
        return 1;
      },
      () => {
        seen.add(2);
        return 2;
      },
      async () => {
        seen.add(3);
        return 3;
      },
    ];

    const results = await Promise.all(tasks.map((t) => kernel.schedule(t, 0)));

    expect(results.sort()).toEqual([1, 2, 3]);
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it("schedule rejects when the fallback task function throws", async () => {
    const error = new Error("boom");
    await expect(
      kernel.schedule(() => {
        throw error;
      })
    ).rejects.toThrow("boom");
  });

  it("schedule throws when scheduler is missing and task is not a function (including null/empty objects)", () => {
    expect(() => kernel.schedule({ code: "" }, 0)).toThrow("Scheduler not available");
    expect(() => kernel.schedule({}, -1)).toThrow("Scheduler not available");
    expect(() => kernel.schedule(/** @type {any} */ (null), 0)).toThrow("Scheduler not available");
  });

  it("schedule passes through large and deeply nested dispatch tasks to the scheduler", async () => {
    const scheduler = {
      schedule: vi.fn(async (task) => task),
    };
    kernel.services._services.set("scheduler", { instance: scheduler });

    const hugeTask = {
      code: makeString(512 * 1024),
      runtimeType: "node",
      type: "dispatch",
      inputState: makeDeepObject(50),
      options: { empty: {}, list: [], whitespace: "   " },
    };

    const returned = await kernel.schedule(hugeTask, 0);

    expect(returned).toBe(hugeTask);
    expect(scheduler.schedule).toHaveBeenCalledWith(hugeTask, 0);
    expect(hugeTask.code.length).toBe(512 * 1024);
    expect(hugeTask.inputState).toEqual(makeDeepObject(50));
  });

  it("eventBus getter returns the underlying events instance", () => {
    expect(kernel.eventBus).toBe(kernel.events);
  });

  it("container exposes register/get/has and delegates to kernel/services", async () => {
    const container = kernel.container;

    const serviceValue = { ok: true };
    const returnedKernel = container.register("svc", serviceValue, {});
    expect(returnedKernel).toBe(kernel);

    expect(container.has("svc")).toBe(true);
    expect(await container.get("svc")).toBe(serviceValue);

    expect(container.has("")).toBe(false);
    expect(await container.get("")).toBeNull();
  });
});

describe("attachKernelCompat", () => {
  it("returns KernelClass as-is when KernelClass is null/undefined", () => {
    expect(attachKernelCompat(null)).toBe(null);
    expect(attachKernelCompat(undefined)).toBe(undefined);
  });

  it("does not attach when KernelClass.prototype.register already exists", () => {
    class AlreadyHasRegister {
      register() {
        return "custom";
      }
    }

    const Out = attachKernelCompat(AlreadyHasRegister);
    const instance = new AlreadyHasRegister();

    expect(Out).toBe(AlreadyHasRegister);
    expect(instance.register()).toBe("custom");
    expect("getService" in instance).toBe(false);
    expect("schedule" in instance).toBe(false);
  });

  it("attaches legacy API methods/getters onto a Kernel subclass without register", async () => {
    class PlainKernel extends Kernel {}

    expect(PlainKernel.prototype.register).toBeUndefined();

    const Out = attachKernelCompat(PlainKernel);
    expect(Out).toBe(PlainKernel);

    const instance = new PlainKernel();

    expect(typeof instance.register).toBe("function");
    expect(typeof instance.getService).toBe("function");
    expect(typeof instance.emit).toBe("function");
    expect(typeof instance.on).toBe("function");
    expect(typeof instance.schedule).toBe("function");
    expect(instance.eventBus).toBe(instance.events);
    expect(typeof instance.container?.register).toBe("function");

    const value = { v: 1 };
    expect(instance.register("svc", value)).toBe(instance);
    expect(instance.getService("svc")).toBe(value);

    const handler = vi.fn();
    const unsub = instance.on("e", handler);
    expect(typeof unsub).toBe("function");

    instance.emit("e", { nested: makeDeepObject(2) });
    expect(instance.events.emit).toHaveBeenCalledWith("e", { nested: makeDeepObject(2) });

    const got = await instance.container.get("svc");
    expect(got).toBe(value);

    const scheduleResult = await instance.schedule(() => "ok", 0);
    expect(scheduleResult).toBe("ok");

    const eventBusDescriptor = Object.getOwnPropertyDescriptor(PlainKernel.prototype, "eventBus");
    expect(typeof eventBusDescriptor?.get).toBe("function");
    expect(eventBusDescriptor?.value).toBeUndefined();

    const containerDescriptor = Object.getOwnPropertyDescriptor(PlainKernel.prototype, "container");
    expect(typeof containerDescriptor?.get).toBe("function");
    expect(containerDescriptor?.value).toBeUndefined();
  });

  it("is idempotent when called multiple times on the same class", () => {
    class PlainKernel extends Kernel {}

    attachKernelCompat(PlainKernel);
    const firstRegister = PlainKernel.prototype.register;

    attachKernelCompat(PlainKernel);
    expect(PlainKernel.prototype.register).toBe(firstRegister);
  });
});

describe("default", () => {
  it("default export is KernelCompat", () => {
    expect(KernelCompatDefault).toBe(KernelCompat);

    const instance = new KernelCompatDefault();
    expect(instance).toBeInstanceOf(KernelCompat);
  });
});