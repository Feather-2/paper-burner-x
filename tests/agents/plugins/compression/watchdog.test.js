import { afterEach, describe, expect, it, vi } from "vitest";

import watchdogPlugin from "../../../../js/agents/plugins/compression/watchdog.js";

function createMockCtx({ config = {}, globals = {} } = {}) {
  const localState = new Map();
  const globalState = new Map(Object.entries(globals));

  const unsubscribe = vi.fn();

  /** @type {any} */
  const ctx = {
    config: {
      threshold: 0.75,
      checkInterval: 5000,
      autoCompress: true,
      maxContextTokens: 100000,
      ...config,
    },
    _services: {},
    events: { emit: vi.fn() },
    services: { call: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    state: {
      getGlobal: vi.fn((path) => globalState.get(path)),
      get: vi.fn((path) => localState.get(path)),
      set: vi.fn((path, value) => {
        localState.set(path, value);
      }),
    },
    registerService: vi.fn((name, service) => {
      ctx._services[name] = service;
    }),
    on: vi.fn((pattern, cb) => {
      ctx._subscription = { pattern, cb };
      return unsubscribe;
    }),
    _unsubscribe: unsubscribe,
    __setGlobal: (path, value) => globalState.set(path, value),
    __getLocal: (path) => localState.get(path),
  };

  return ctx;
}

afterEach(() => {
  // Ensure fake timers (if enabled) do not leak across tests.
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("plugins/compression/watchdog.js", () => {
  it("installs, registers watchdog service, and reports healthy state without compressing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 1000, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 10, output: 0 },
        "runtime.messages": [{ role: "user", content: "hello" }],
      },
    });

    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    await watchdogPlugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith("watchdog", expect.any(Object));
    expect(ctx._services.watchdog).toBeTruthy();
    expect(typeof ctx._services.watchdog.check).toBe("function");
    expect(typeof ctx._services.watchdog.getHealth).toBe("function");

    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe("healthy");
    expect(health.usage).toBeCloseTo(0.1);
    expect(health.checkedAt).toBe(0);
    expect(ctx.services.call).not.toHaveBeenCalled();
    expect(ctx.events.emit).not.toHaveBeenCalled();

    const intervalId = ctx._watchdogInterval;
    expect(intervalId).toBeTruthy();

    await watchdogPlugin.uninstall(ctx);

    expect(clearSpy).toHaveBeenCalledWith(intervalId);
    expect(ctx._unsubscribe).toHaveBeenCalledTimes(1);
    expect(ctx._watchdogInterval).toBeNull();
    expect(ctx._watchdogCleanup).toBeNull();
  });

  it("uses safe defaults when runtime.tokens is missing and maxContextTokens is falsy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, maxContextTokens: 0 },
      globals: {},
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe("healthy");
    expect(health.usage).toBe(0);
    expect(ctx.events.emit).not.toHaveBeenCalled();
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it("treats missing runtime.messages as empty array (still emits threshold event)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        // Intentionally omit runtime.messages to exercise defaulting to [].
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith("watchdog.threshold.exceeded", { usage: 0.8, threshold: 0.75 });
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it("emits threshold event and calls compression when over budget and messages exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const messages = [{ role: "user", content: "hello" }];
    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        "runtime.messages": messages,
      },
    });
    ctx.services.call.mockResolvedValue({ ok: true });

    await watchdogPlugin.install(ctx);

    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe("warning");
    expect(health.usage).toBeCloseTo(0.8);

    expect(ctx.events.emit).toHaveBeenCalledWith("watchdog.threshold.exceeded", { usage: 0.8, threshold: 0.75 });
    expect(ctx.services.call).toHaveBeenCalledWith("compression", "compress", [messages]);
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("Auto-compressed"));

    await watchdogPlugin.uninstall(ctx);
  });

  it("emits threshold event but does not compress when messages are empty", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        "runtime.messages": [],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith("watchdog.threshold.exceeded", { usage: 0.8, threshold: 0.75 });
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it("does not auto-compress or emit when autoCompress is disabled (but still marks warning)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: false, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        "runtime.messages": [{ role: "user", content: "hello" }],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe("warning");
    expect(ctx.events.emit).not.toHaveBeenCalled();
    expect(ctx.services.call).not.toHaveBeenCalled();

    await watchdogPlugin.uninstall(ctx);
  });

  it("logs an error when compression fails and continues without throwing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, autoCompress: true, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        "runtime.messages": [{ role: "user", content: "hello" }],
      },
    });
    ctx.services.call.mockRejectedValue(new Error("boom"));

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.events.emit).toHaveBeenCalledWith("watchdog.threshold.exceeded", { usage: 0.8, threshold: 0.75 });
    expect(ctx.log.error).toHaveBeenCalledWith("Auto-compression failed:", expect.any(Error));

    await watchdogPlugin.uninstall(ctx);
  });

  it("rate-limits event-driven health checks to ~1s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const ctx = createMockCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 10, output: 0 },
        "runtime.messages": [],
      },
    });

    await watchdogPlugin.install(ctx);

    await ctx._services.watchdog.check(); // updates lastCheck = 0
    ctx.state.set.mockClear();

    // Within 1s: should not trigger another check.
    vi.setSystemTime(new Date(500));
    ctx._subscription.cb();
    expect(ctx.state.set).not.toHaveBeenCalled();

    // After 1s: should trigger.
    vi.setSystemTime(new Date(1501));
    ctx._subscription.cb();
    expect(ctx.state.set).toHaveBeenCalledTimes(1);

    await watchdogPlugin.uninstall(ctx);
  });

  it("invokes previous cleanup on re-install (even if it throws)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const oldCleanup = vi.fn(() => {
      throw new Error("ignore");
    });

    const ctx = createMockCtx({
      config: { checkInterval: 0 },
      globals: { "runtime.tokens": { input: 0, output: 0 } },
    });
    ctx._watchdogCleanup = oldCleanup;

    await expect(watchdogPlugin.install(ctx)).resolves.toBeUndefined();
    expect(oldCleanup).toHaveBeenCalledTimes(1);

    await watchdogPlugin.uninstall(ctx);
  });

  it("cleans up scheduled interval when install fails partway through", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const ctx = createMockCtx({
      config: { checkInterval: 1000 },
      globals: { "runtime.tokens": { input: 0, output: 0 } },
    });
    ctx.on.mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(watchdogPlugin.install(ctx)).rejects.toThrow(/boom/);

    expect(clearSpy).toHaveBeenCalled();
    expect(ctx.registerService).not.toHaveBeenCalled();
    expect(ctx._watchdogCleanup).toBeNull();
    expect(ctx._watchdogInterval).toBeNull();
  });

  it("uninstall clears interval when cleanup function is missing", async () => {
    vi.useFakeTimers();

    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const ctx = createMockCtx({ config: { checkInterval: 0 } });
    ctx._watchdogCleanup = null;
    ctx._watchdogInterval = 123;

    await watchdogPlugin.uninstall(ctx);

    expect(clearSpy).toHaveBeenCalledWith(123);
    expect(ctx._watchdogInterval).toBeNull();
  });
});
