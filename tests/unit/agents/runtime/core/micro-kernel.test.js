import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/core/event-bus.js", () => {
  const instances = [];

  class EventBus {
    constructor(options = {}) {
      this.options = options;
      this.runId = options?.runId ?? null;

      /** @type {Map<string, Set<Function>>} */
      this._handlers = new Map();

      /** @type {null | { eventType: string, payload: unknown, options: unknown }} */
      this.__lastRequest = null;

      /** @type {unknown} */
      this.__nextRequestRecord = null;

      /** @type {Error | null} */
      this.__nextRequestError = null;

      this.on = vi.fn((eventType, handler) => {
        const type = String(eventType);
        if (!this._handlers.has(type)) this._handlers.set(type, new Set());
        this._handlers.get(type).add(handler);
      });

      this.off = vi.fn((eventType, handler) => {
        const type = String(eventType);
        this._handlers.get(type)?.delete(handler);
      });

      this.emit = vi.fn((eventType, payload) => {
        const type = String(eventType);
        const record = { type, payload };
        const set = this._handlers.get(type);
        if (!set) return;
        for (const handler of set) handler(record);
      });

      this.request = vi.fn(async (eventType, payload, options) => {
        const type = String(eventType);
        this.__lastRequest = { eventType: type, payload, options };
        if (this.__nextRequestError) throw this.__nextRequestError;
        if (this.__nextRequestRecord) return this.__nextRequestRecord;
        return { type, payload };
      });

      // common aliases (defensive; MicroKernel may use these)
      this.subscribe = this.on;
      this.unsubscribe = this.off;
      this.publish = this.emit;

      instances.push(this);
    }
  }

  return { EventBus, __instances: instances };
});

vi.mock("../../../../../js/agents/core/di/defaults.js", () => {
  return {
    ServiceId: {
      KERNEL: "ServiceId.KERNEL",
      EVENT_BUS: "ServiceId.EVENT_BUS",
    },
  };
});

vi.mock("../../../../../js/agents/runtime/hooks/event-bus-hooks.js", () => {
  return { enhanceEventBusWithHooks: vi.fn() };
});

async function loadSubject() {
  return import("../../../../../js/agents/runtime/core/micro-kernel.js");
}

async function loadEventBusMock() {
  return import("../../../../../js/agents/core/event-bus.js");
}

async function loadHooksMock() {
  return import("../../../../../js/agents/runtime/hooks/event-bus-hooks.js");
}

async function loadServiceIdMock() {
  return import("../../../../../js/agents/core/di/defaults.js");
}

function createDeepObject(depth) {
  let node = { leaf: true };
  for (let i = 0; i < depth; i++) node = { level: i, next: node };
  return node;
}

function getDispatchFn(kernel) {
  const candidates = [
    "dispatchTask",
    "dispatch",
    "runTask",
    "scheduleTask",
    "schedule",
  ];
  for (const name of candidates) {
    if (typeof kernel?.[name] === "function") return kernel[name].bind(kernel);
  }
  throw new Error(
    `Expected MicroKernel to implement one of: ${candidates.join(", ")}`
  );
}

async function captureThrownOrRejected(fn) {
  try {
    await Promise.resolve().then(fn);
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw or return a rejecting promise");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("MicroKernelConfigError", () => {
  it("sets name and message", async () => {
    const { MicroKernelConfigError } = await loadSubject();
    const err = new MicroKernelConfigError("bad config");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MicroKernelConfigError");
    expect(err.message).toBe("bad config");
  });

  it("supports empty/undefined messages (boundary)", async () => {
    const { MicroKernelConfigError } = await loadSubject();

    const empty = new MicroKernelConfigError("");
    expect(empty.name).toBe("MicroKernelConfigError");
    expect(empty.message).toBe("");

    // JS Error semantics: passing `undefined` as an argument yields empty message in Node/V8.
    const undef = new MicroKernelConfigError(undefined);
    expect(undef.name).toBe("MicroKernelConfigError");
    expect(undef.message).toBe("");
  });
});

describe("MicroKernelError", () => {
  it("sets name, message, and default code=null", async () => {
    const { MicroKernelError } = await loadSubject();
    const err = new MicroKernelError("runtime fail");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MicroKernelError");
    expect(err.message).toBe("runtime fail");
    expect(err.code).toBeNull();
  });

  it("accepts { code } and normalizes undefined to null", async () => {
    const { MicroKernelError } = await loadSubject();

    const e1 = new MicroKernelError("x", { code: "E_X" });
    expect(e1.code).toBe("E_X");

    const e2 = new MicroKernelError("y", { code: undefined });
    expect(e2.code).toBeNull();
  });
});

describe("MicroKernel", () => {
  it("constructs with non-object options (null/undefined/string/number/array) and still creates an EventBus", async () => {
    const { MicroKernel } = await loadSubject();
    const { __instances } = await loadEventBusMock();

    const k1 = new MicroKernel();
    const k2 = new MicroKernel(undefined);
    const k3 = new MicroKernel(null);
    const k4 = new MicroKernel("not-an-object");
    const k5 = new MicroKernel(123);
    const k6 = new MicroKernel([]);

    expect(__instances.length).toBe(6);
    expect(k1.eventBus).toBe(__instances[0]);
    expect(k2.eventBus).toBe(__instances[1]);
    expect(k3.eventBus).toBe(__instances[2]);
    expect(k4.eventBus).toBe(__instances[3]);
    expect(k5.eventBus).toBe(__instances[4]);
    expect(k6.eventBus).toBe(__instances[5]);
  });

  it("passes sanitized runId to EventBus and enhances it with hooks (empty/0/whitespace)", async () => {
    const { MicroKernel } = await loadSubject();
    const hooks = await loadHooksMock();

    const kEmpty = new MicroKernel({ runId: "" });
    expect(kEmpty.eventBus.options).toEqual({ runId: null });

    const kZero = new MicroKernel({ runId: 0 });
    expect(kZero.eventBus.options).toEqual({ runId: null });

    const kWs = new MicroKernel({ runId: "   " });
    expect(kWs.eventBus.options).toEqual({ runId: "   " });

    expect(hooks.enhanceEventBusWithHooks).toHaveBeenCalledTimes(3);
    expect(hooks.enhanceEventBusWithHooks).toHaveBeenCalledWith(kEmpty.eventBus);
    expect(hooks.enhanceEventBusWithHooks).toHaveBeenCalledWith(kZero.eventBus);
    expect(hooks.enhanceEventBusWithHooks).toHaveBeenCalledWith(kWs.eventBus);
  });

  it("registers built-in services (kernel, ServiceId.KERNEL, ServiceId.EVENT_BUS)", async () => {
    const { MicroKernel } = await loadSubject();
    const { ServiceId } = await loadServiceIdMock();

    const kernel = new MicroKernel();

    expect(kernel.getService("kernel")).toBe(kernel);
    expect(kernel.getService(ServiceId.KERNEL)).toBe(kernel);
    expect(kernel.getService(ServiceId.EVENT_BUS)).toBe(kernel.eventBus);
  });

  it("register(id) rejects empty ids (null/undefined/empty string/0/false/NaN) and accepts whitespace", async () => {
    const { MicroKernel, MicroKernelConfigError } = await loadSubject();
    const kernel = new MicroKernel();

    const badIds = [undefined, null, "", 0, false, Number.NaN];
    for (const id of badIds) {
      expect(() => kernel.register(id, 1)).toThrow(MicroKernelConfigError);
    }

    expect(() => kernel.register("   ", 123)).not.toThrow();
    expect(kernel.getService("   ")).toBe(123);
  });

  it("register(factory) runs the factory on first getService() only, caches the value, and passes kernel", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const factory = vi.fn((k) => ({ from: k, n: Math.random() }));
    kernel.register("svc", factory);

    const a = kernel.getService("svc");
    const b = kernel.getService("svc");

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(kernel);
    expect(a).toBe(b);
    expect(a).toMatchObject({ from: kernel });
  });

  it("getService() caches undefined results from factories (boundary)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const factory = vi.fn(() => undefined);
    kernel.register("undef", factory);

    expect(kernel.getService("undef")).toBeUndefined();
    expect(kernel.getService("undef")).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("getService() returns nullish for missing ids (boundary)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const value = kernel.getService("missing-service");
    expect(value == null).toBe(true);
  });

  it("getService() is safe under rapid/concurrent access (same factory invoked once)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const factory = vi.fn(() => ({ createdAt: Date.now() }));
    kernel.register("concurrent", factory);

    const [a, b, c] = await Promise.all([
      Promise.resolve().then(() => kernel.getService("concurrent")),
      Promise.resolve().then(() => kernel.getService("concurrent")),
      Promise.resolve().then(() => kernel.getService("concurrent")),
    ]);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("on()/off() bridge EventBus event records to raw payload and properly unsubscribe", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();
    const bus = kernel.eventBus;

    const handler = vi.fn();
    kernel.on("evt", handler);

    expect(bus.on).toHaveBeenCalledTimes(1);
    const [typeArg, wrapper] = bus.on.mock.calls[0];
    expect(typeArg).toBe("evt");
    expect(typeof wrapper).toBe("function");
    expect(wrapper).not.toBe(handler);

    bus.emit("evt", { a: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ a: 1 });

    kernel.off("evt", handler);
    expect(bus.off).toHaveBeenCalledTimes(1);
    const [offType, offHandler] = bus.off.mock.calls[0];
    expect(offType).toBe("evt");
    expect(offHandler).toBe(wrapper);

    bus.emit("evt", { a: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("on()/off() support multiple handlers without cross-removal (concurrency/rapid calls)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();
    const bus = kernel.eventBus;

    const a = vi.fn();
    const b = vi.fn();

    kernel.on("evt", a);
    kernel.on("evt", b);

    bus.emit("evt", "x");
    expect(a).toHaveBeenCalledWith("x");
    expect(b).toHaveBeenCalledWith("x");

    kernel.off("evt", a);
    bus.emit("evt", "y");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("on()/off() reject invalid inputs (empty eventType / null handler) (boundary)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const err1 = await captureThrownOrRejected(() => kernel.on("", () => {}));
    expect(err1).toBeInstanceOf(Error);
    expect(["MicroKernelConfigError", "MicroKernelError"]).toContain(err1.name);

    const err2 = await captureThrownOrRejected(() => kernel.on("evt", null));
    expect(err2).toBeInstanceOf(Error);
    expect(["MicroKernelConfigError", "MicroKernelError"]).toContain(err2.name);

    const err3 = await captureThrownOrRejected(() => kernel.off("evt", null));
    expect(err3).toBeInstanceOf(Error);
    expect(["MicroKernelConfigError", "MicroKernelError"]).toContain(err3.name);
  });

  it("request() forwards to EventBus.request(), unwraps payload, and applies default timeout", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const expected = { ok: true };
    kernel.eventBus.__nextRequestRecord = { type: "ask", payload: expected };

    const res = await kernel.request("ask", { q: 1 });
    expect(kernel.eventBus.request).toHaveBeenCalledTimes(1);

    const [eventTypeArg, payloadArg, optionsArg] =
      kernel.eventBus.request.mock.calls[0];
    expect(eventTypeArg).toBe("ask");
    expect(payloadArg).toEqual({ q: 1 });

    // Legacy MicroKernel should provide a deterministic timeout value.
    expect(optionsArg).toBeTruthy();
    expect(optionsArg.timeoutMs).toBe(30_000);

    // Compatible with either "unwrap payload" or "return record".
    expect(res === expected || res?.payload === expected).toBe(true);
  });

  it("request() sanitizes timeout options (0, -1, MAX_SAFE_INTEGER, numeric string, object)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    kernel.eventBus.__nextRequestRecord = { type: "t", payload: "ok" };

    await kernel.request("t", null, { timeoutMs: 0 });
    expect(kernel.eventBus.__lastRequest.options.timeoutMs).toBe(0);

    await kernel.request("t", null, { timeout: -1 });
    expect(kernel.eventBus.__lastRequest.options.timeoutMs).toBe(30_000);

    await kernel.request("t", null, { timeoutMs: Number.MAX_SAFE_INTEGER });
    expect(kernel.eventBus.__lastRequest.options.timeoutMs).toBe(
      Number.MAX_SAFE_INTEGER
    );

    await kernel.request("t", null, { timeoutMs: "123.9" });
    expect(kernel.eventBus.__lastRequest.options.timeoutMs).toBe(123);

    await kernel.request("t", null, { timeoutMs: {} });
    expect(kernel.eventBus.__lastRequest.options.timeoutMs).toBe(30_000);
  });

  it("request() supports concurrent calls with independent timeout options", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    kernel.eventBus.request.mockImplementation(async (eventType, payload, opts) => {
      return { type: eventType, payload: { payload, timeoutMs: opts?.timeoutMs } };
    });

    const [a, b] = await Promise.all([
      kernel.request("a", { n: 1 }, { timeoutMs: 1 }),
      kernel.request("b", { n: 2 }, { timeout: 2 }),
    ]);

    const aTimeout = a?.timeoutMs ?? a?.payload?.timeoutMs;
    const bTimeout = b?.timeoutMs ?? b?.payload?.timeoutMs;

    expect(aTimeout).toBe(1);
    expect(bTimeout).toBe(2);
  });

  it("request() rejects invalid eventType (null/undefined/empty string) (boundary)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel();

    const badTypes = [null, undefined, ""];
    for (const t of badTypes) {
      const err = await captureThrownOrRejected(() => kernel.request(t, {}));
      expect(err).toBeInstanceOf(Error);
      expect(["MicroKernelConfigError", "MicroKernelError"]).toContain(err.name);
    }
  });

  it("dispatch task requires scheduler (error handling)", async () => {
    const { MicroKernel } = await loadSubject();
    const kernel = new MicroKernel({ scheduler: null });

    const dispatch = getDispatchFn(kernel);
    const err = await captureThrownOrRejected(() =>
      dispatch({ runtimeType: "js", code: "x" })
    );

    expect(err).toBeInstanceOf(Error);
    expect(["MicroKernelError", "MicroKernelConfigError"]).toContain(err.name);
  });

  it("dispatch task forwards to scheduler.dispatch with normalized args (runtimeType/type/default, inputState/options)", async () => {
    const { MicroKernel } = await loadSubject();

    const scheduler = {
      dispatch: vi.fn(async (runtimeType, code, inputState, options) => {
        return { runtimeType, code, inputState, options };
      }),
    };

    const kernel = new MicroKernel({ scheduler });
    const dispatch = getDispatchFn(kernel);

    const deepState = createDeepObject(120);
    const deepOptions = { meta: createDeepObject(80) };

    const res = await dispatch({
      type: "python",
      code: "print('hi')",
      inputState: deepState,
      options: deepOptions,
    });

    expect(scheduler.dispatch).toHaveBeenCalledTimes(1);

    const [rt, code, inputStateArg, optionsArg] = scheduler.dispatch.mock.calls[0];
    expect(rt).toBe("python");
    expect(code).toBe("print('hi')");
    expect(inputStateArg).toEqual(deepState);
    expect(optionsArg).toEqual(deepOptions);

    expect(res).toMatchObject({ runtimeType: "python" });

    // runtimeType takes precedence over type
    await dispatch({ runtimeType: "js", type: "python", code: "console.log(1)" });
    expect(scheduler.dispatch).toHaveBeenCalledTimes(2);
    expect(scheduler.dispatch.mock.calls[1][0]).toBe("js");

    // default runtimeType when omitted
    await dispatch({ code: "x" });
    expect(scheduler.dispatch).toHaveBeenCalledTimes(3);
    expect(scheduler.dispatch.mock.calls[2][0]).toBe("");
  });

  it("dispatch task rejects invalid runtimeType values (boundary/whitespace/type mismatch)", async () => {
    const { MicroKernel } = await loadSubject();

    const scheduler = { dispatch: vi.fn(async () => "ok") };
    const kernel = new MicroKernel({ scheduler });
    const dispatch = getDispatchFn(kernel);

    const err1 = await captureThrownOrRejected(() =>
      dispatch({ runtimeType: "ruby", code: "x" })
    );
    expect(err1).toBeInstanceOf(Error);
    expect(["MicroKernelError", "MicroKernelConfigError"]).toContain(err1.name);

    const err2 = await captureThrownOrRejected(() =>
      dispatch({ type: " js ", code: "x" })
    );
    expect(err2).toBeInstanceOf(Error);
    expect(["MicroKernelError", "MicroKernelConfigError"]).toContain(err2.name);

    expect(scheduler.dispatch).not.toHaveBeenCalled();
  });

  it("dispatch task enforces code length boundary (<= 1,000,000 ok; > 1,000,000 rejects) (resource boundary)", async () => {
    const { MicroKernel } = await loadSubject();

    const scheduler = { dispatch: vi.fn(async () => "ok") };
    const kernel = new MicroKernel({ scheduler });
    const dispatch = getDispatchFn(kernel);

    const max = "x".repeat(1_000_000);
    await dispatch({ runtimeType: "js", code: max });
    expect(scheduler.dispatch).toHaveBeenCalledTimes(1);

    const tooBig = "x".repeat(1_000_001);
    const err = await captureThrownOrRejected(() =>
      dispatch({ runtimeType: "js", code: tooBig })
    );
    expect(err).toBeInstanceOf(Error);
    expect(["MicroKernelError", "MicroKernelConfigError"]).toContain(err.name);
    expect(scheduler.dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatch task rejects non-string code inputs (null/undefined/number/object) (type boundary)", async () => {
    const { MicroKernel } = await loadSubject();

    const scheduler = { dispatch: vi.fn(async () => "ok") };
    const kernel = new MicroKernel({ scheduler });
    const dispatch = getDispatchFn(kernel);

    const badCodes = [null, undefined, 123, { code: "x" }];
    for (const code of badCodes) {
      const err = await captureThrownOrRejected(() =>
        dispatch({ runtimeType: "js", code })
      );
      expect(err).toBeInstanceOf(Error);
      expect(["MicroKernelError", "MicroKernelConfigError"]).toContain(err.name);
    }

    expect(scheduler.dispatch).not.toHaveBeenCalled();
  });

  it("dispatch task normalizes null/undefined inputState/options to objects (boundary)", async () => {
    const { MicroKernel } = await loadSubject();

    const scheduler = { dispatch: vi.fn(async () => "ok") };
    const kernel = new MicroKernel({ scheduler });
    const dispatch = getDispatchFn(kernel);

    await dispatch({
      runtimeType: "js",
      code: "x",
      inputState: null,
      options: undefined,
    });

    expect(scheduler.dispatch).toHaveBeenCalledTimes(1);
    const [, , inputStateArg, optionsArg] = scheduler.dispatch.mock.calls[0];

    // Accept either `{}` or some other plain-object normalization, but not null/array.
    expect(inputStateArg).toBeTruthy();
    expect(Array.isArray(inputStateArg)).toBe(false);
    expect(typeof inputStateArg).toBe("object");

    expect(optionsArg).toBeTruthy();
    expect(Array.isArray(optionsArg)).toBe(false);
    expect(typeof optionsArg).toBe("object");
  });

  it("lifecycle: start() calls provider.register/start once each, awaits async providers; stop() calls provider.stop once", async () => {
    const { MicroKernel } = await loadSubject();

    let registerDone = false;
    let startDone = false;
    let stopDone = false;

    const provider = {
      register: vi.fn(async () => {
        await Promise.resolve();
        registerDone = true;
      }),
      start: vi.fn(async () => {
        await Promise.resolve();
        startDone = true;
      }),
      stop: vi.fn(async () => {
        await Promise.resolve();
        stopDone = true;
      }),
    };

    const kernel = new MicroKernel({ providers: [provider] });

    await kernel.start();
    expect(provider.register).toHaveBeenCalledTimes(1);
    expect(provider.start).toHaveBeenCalledTimes(1);
    expect(registerDone).toBe(true);
    expect(startDone).toBe(true);

    await kernel.start();
    expect(provider.register).toHaveBeenCalledTimes(1);
    expect(provider.start).toHaveBeenCalledTimes(1);

    await kernel.stop();
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(stopDone).toBe(true);

    await kernel.stop();
    expect(provider.stop).toHaveBeenCalledTimes(1);
  });

  it("constructor ignores invalid providers shape (object instead of array) (type boundary)", async () => {
    const { MicroKernel } = await loadSubject();

    const kernel = new MicroKernel({ providers: {} });
    await expect(kernel.start()).resolves.toBeUndefined();
    await expect(kernel.stop()).resolves.toBeUndefined();
  });

  it("start() tolerates providers without lifecycle methods; start() propagates provider errors (error handling)", async () => {
    const { MicroKernel } = await loadSubject();

    const okProvider = {};
    const badProvider = {
      start: vi.fn(() => {
        throw new Error("boom");
      }),
    };

    const kernel = new MicroKernel({ providers: [okProvider, badProvider] });

    const err = await captureThrownOrRejected(() => kernel.start());
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/boom/);
  });
});