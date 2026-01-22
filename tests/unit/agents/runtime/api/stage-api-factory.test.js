import { describe, it, expect, vi, beforeEach } from "vitest";

const SUBJECT_PATH = "../../../../../js/agents/runtime/api/stage-api-factory.js";

let lastLogger = null;

let toolQuotaManagerInstances = [];
let messageBusInstances = [];
let traceContextConstructorCalls = [];

let tokenTrackerRecordSpy = vi.fn();
const getGlobalTokenTrackerSpy = vi.fn(() => ({ record: tokenTrackerRecordSpy }));

const createStageApiSpy = vi.fn((cfg) => ({ ...cfg }));
const createLoggerSpy = vi.fn((name) => {
  lastLogger = { name, debug: vi.fn(), warn: vi.fn() };
  return lastLogger;
});

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < 0) return fallback;
  return i;
}

class CircuitBreakerRegistry {
  constructor() {
    this.get = vi.fn(() => null);
  }
}

let shouldMessageBusThrow = false;
class MessageBus {
  constructor(eventBus) {
    if (shouldMessageBusThrow) throw new Error("MessageBus ctor failed");
    this.eventBus = eventBus;
    messageBusInstances.push(this);
  }
  async request(name, payload) {
    return { name, payload };
  }
  handle(_name, _handler) {}
}

class ToolQuotaManager {
  constructor(config = {}) {
    this.config = config;
    toolQuotaManagerInstances.push(this);
  }
  async tryCall(_toolName, fn) {
    return await fn();
  }
}

class TraceContext {
  constructor(opts = {}) {
    this.opts = opts;
    traceContextConstructorCalls.push(opts);
  }
  startSpan() {}
  endSpan() {}
  withSpan(_name, fn) {
    return fn();
  }
  getTraceparent() {
    return "00-00000000000000000000000000000000-0000000000000000-01";
  }
}
TraceContext.parseTraceparent = vi.fn(() => null);

const createFsAdapterFromVfsSpy = vi.fn(() => ({ kind: "fsAdapter" }));
const createVfsGlobFnSpy = vi.fn(() => vi.fn(() => []));

const withRetrySpy = vi.fn(async (fn, _options = {}) => await fn());
const getErrorBoundarySpy = vi.fn(() => ({ wrap: vi.fn(async (fn) => await fn()) }));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createStageApi: createStageApiSpy,
  createLogger: createLoggerSpy,
  isPlainObject,
  toNonNegativeInt,
  CircuitBreakerRegistry,
}));

vi.mock("../../../../../js/agents/vfs/fs-adapter.js", () => ({
  createFsAdapterFromVfs: createFsAdapterFromVfsSpy,
}));

vi.mock("../../../../../js/agents/vfs/glob.js", () => ({
  createVfsGlobFn: createVfsGlobFnSpy,
}));

vi.mock("../../../../../js/agents/plugins/telemetry/index.js", () => ({
  getGlobalTokenTracker: getGlobalTokenTrackerSpy,
  TraceContext,
}));

vi.mock("../../../../../js/agents/runtime/core/retry-strategy.js", () => ({
  withRetry: withRetrySpy,
}));

vi.mock("../../../../../js/agents/runtime/core/error-boundary.js", () => ({
  getErrorBoundary: getErrorBoundarySpy,
}));

vi.mock("../../../../../js/agents/runtime/tools/tool-quotas.js", () => ({
  ToolQuotaManager,
}));

vi.mock("../../../../../js/agents/core/message-bus.js", () => ({
  MessageBus,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  lastLogger = null;
  toolQuotaManagerInstances = [];
  messageBusInstances = [];
  traceContextConstructorCalls = [];
  shouldMessageBusThrow = false;

  tokenTrackerRecordSpy = vi.fn();
  TraceContext.parseTraceparent.mockImplementation(() => null);
});

async function importSubject() {
  return await import(SUBJECT_PATH);
}

function makeTraceContextLike(label = "tc") {
  return {
    label,
    startSpan: vi.fn(),
    endSpan: vi.fn(),
    withSpan: vi.fn((_name, fn) => fn()),
    getTraceparent: vi.fn(() => "traceparent"),
  };
}

describe("default", () => {
  it("re-exports StageApiFactory as the default export", async () => {
    const mod = await importSubject();
    expect(mod.default).toBe(mod.StageApiFactory);
    expect(typeof mod.default).toBe("function");

    const instance = new mod.default();
    expect(instance).toBeInstanceOf(mod.StageApiFactory);
  });
});

describe("StageApiFactory", () => {
  it("constructor handles empty values and invalid types without throwing", async () => {
    const { StageApiFactory } = await importSubject();

    expect(() => new StageApiFactory(null)).not.toThrow();
    expect(() => new StageApiFactory(undefined)).not.toThrow();
    expect(() => new StageApiFactory("")).not.toThrow();
    expect(() => new StageApiFactory([])).not.toThrow();
    expect(() => new StageApiFactory({})).not.toThrow();

    // Reset instance tracking for an isolated assertion on defaults.
    toolQuotaManagerInstances = [];
    traceContextConstructorCalls = [];
    getErrorBoundarySpy.mockClear();

    // Default fallbacks should be constructed.
    const factory = new StageApiFactory();
    expect(factory.baseConfig.signal).toBeNull();
    expect(factory.baseConfig.emit).toBeNull();
    expect(toolQuotaManagerInstances.length).toBe(1);
    expect(getErrorBoundarySpy).toHaveBeenCalledTimes(1);
    expect(traceContextConstructorCalls.length).toBe(1);
  });

  it("resolves traceContext from explicit value, container, or traceparent (with safe fallbacks)", async () => {
    const { StageApiFactory } = await importSubject();

    const explicit = makeTraceContextLike("explicit");
    const f1 = new StageApiFactory({ traceContext: explicit });
    expect(f1.services.traceContext).toBe(explicit);
    expect(traceContextConstructorCalls.length).toBe(0);

    const fromContainer = makeTraceContextLike("container");
    const f2 = new StageApiFactory({
      container: { tryGet: vi.fn(() => fromContainer) },
      traceContext: null,
    });
    expect(f2.services.traceContext).toBe(fromContainer);

    TraceContext.parseTraceparent.mockImplementation((tp) => {
      if (tp === "valid-trace") return { traceId: "t1", spanId: "s1" };
      return null;
    });
    const f3 = new StageApiFactory({ traceparent: "  valid-trace  " });
    expect(TraceContext.parseTraceparent).toHaveBeenCalledWith("valid-trace");
    expect(f3.services.traceContext).toBeInstanceOf(TraceContext);
    expect(traceContextConstructorCalls[0]).toEqual({ traceId: "t1", parentSpanId: "s1" });

    const f4 = new StageApiFactory({ traceparent: " \t\n " });
    expect(f4.services.traceContext).toBeInstanceOf(TraceContext);
    expect(TraceContext.parseTraceparent).not.toHaveBeenCalledWith("");
  });

  it("handles container.get throwing during resolution (error handling)", async () => {
    const { StageApiFactory } = await importSubject();

    const container = { get: vi.fn(() => { throw new Error("missing"); }) };
    const factory = new StageApiFactory({ container });

    expect(factory.services.traceContext).toBeInstanceOf(TraceContext);
    expect(lastLogger?.debug).toHaveBeenCalled();
  });

  it("createBaseApi filters null/undefined overrides but preserves boundary values (0, blank string, empty array/object)", async () => {
    const { StageApiFactory } = await importSubject();

    const controller = new AbortController();
    const emit = vi.fn();
    const eventBus = { emit };
    const aiApiService = { chat: vi.fn(async () => ({ usage: { promptTokens: 0, completionTokens: 0 } })) };

    const factory = new StageApiFactory({ signal: controller.signal, eventBus, emit, aiApiService });
    const hugeText = "x".repeat(2 * 1024 * 1024);
    const deep = Object.create(null);
    let cursor = deep;
    for (let i = 0; i < 200; i++) {
      cursor.next = Object.create(null);
      cursor = cursor.next;
    }

    const api = factory.createBaseApi({
      dropUndefined: undefined,
      dropNull: null,
      keepZero: 0,
      keepWhitespace: "   ",
      keepEmptyString: "",
      keepEmptyArray: [],
      keepEmptyObject: {},
      hugeText,
      deep,
    });

    const cfg = createStageApiSpy.mock.calls[0]?.[0];
    expect(cfg).not.toHaveProperty("dropUndefined");
    expect(cfg).not.toHaveProperty("dropNull");
    expect(cfg.keepZero).toBe(0);
    expect(cfg.keepWhitespace).toBe("   ");
    expect(cfg.keepEmptyString).toBe("");
    expect(cfg.keepEmptyArray).toEqual([]);
    expect(cfg.keepEmptyObject).toEqual({});
    expect(cfg.hugeText).toBe(hugeText);
    expect(cfg.deep).toBe(deep);

    expect(api.signal).toBe(controller.signal);
    expect(api.emit).toBe(emit);
  });

  it("createBaseApi sets up EventBus backpressure and safely ignores incompatible buses/errors", async () => {
    const { StageApiFactory } = await importSubject();

    const enableBackpressure = vi.fn();
    const eventBus = { emit: vi.fn(), enableBackpressure, _backpressure: {} };
    const factory = new StageApiFactory({ eventBus, emit: eventBus.emit, eventBusBackpressure: { maxQueueSize: 42 } });

    expect(() => factory.createBaseApi()).not.toThrow();
    expect(enableBackpressure).toHaveBeenCalledTimes(1);
    expect(enableBackpressure.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        maxQueueSize: 42,
        deferNonCoalesced: false,
      })
    );
    expect(enableBackpressure.mock.calls[0][0].coalescePattern).toBeInstanceOf(RegExp);

    // Already-configured buses should not be overridden.
    enableBackpressure.mockClear();
    const configuredBus = { emit: vi.fn(), enableBackpressure, _backpressure: { enabled: true } };
    const factory2 = new StageApiFactory({ eventBus: configuredBus, emit: configuredBus.emit });
    factory2.createBaseApi();
    expect(enableBackpressure).not.toHaveBeenCalled();

    // Explicitly disabling should skip configuration.
    enableBackpressure.mockClear();
    const factory3 = new StageApiFactory({ eventBus, emit: eventBus.emit, backpressure: false });
    factory3.createBaseApi();
    expect(enableBackpressure).not.toHaveBeenCalled();

    // enableBackpressure throwing should be non-fatal.
    const throwingBus = {
      emit: vi.fn(),
      enableBackpressure: vi.fn(() => {
        throw new Error("boom");
      }),
      _backpressure: {},
    };
    const factory4 = new StageApiFactory({ eventBus: throwingBus, emit: throwingBus.emit });
    expect(() => factory4.createBaseApi()).not.toThrow();
    expect(lastLogger?.debug).toHaveBeenCalled();
  });

  it("createBaseApi derives fs/globFn from vfs only when missing (and does not over-eagerly override)", async () => {
    const { StageApiFactory } = await importSubject();

    const vfs = { kind: "vfs" };
    const factory = new StageApiFactory({ vfs, emit: vi.fn(), signal: new AbortController().signal });

    const api1 = factory.createBaseApi();
    expect(createFsAdapterFromVfsSpy).toHaveBeenCalledWith(vfs);
    expect(createVfsGlobFnSpy).toHaveBeenCalledWith(vfs);
    expect(api1.fs).toEqual({ kind: "fsAdapter" });
    expect(typeof api1.globFn).toBe("function");

    // When already present, should not call adapter builders.
    createFsAdapterFromVfsSpy.mockClear();
    createVfsGlobFnSpy.mockClear();
    const api2 = factory.createBaseApi({ fs: { already: true }, globFn: () => ["x"] });
    expect(createFsAdapterFromVfsSpy).not.toHaveBeenCalled();
    expect(createVfsGlobFnSpy).not.toHaveBeenCalled();
    expect(api2.fs).toEqual({ already: true });
    expect(api2.globFn()).toEqual(["x"]);
  });

  it("wraps aiApiService.chat with token tracking + circuit breaker + retry; supports concurrency and error paths", async () => {
    const { StageApiFactory } = await importSubject();

    // Deterministic latency (avoid time-based flakiness).
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    const breakerExecute = vi.fn(async (fn) => await fn());
    const circuitBreakerRegistry = { get: vi.fn(() => ({ execute: breakerExecute })) };

    let callCount = 0;
    const aiApiService = {
      chat: vi.fn(async (opts) => {
        callCount++;
        if (opts?.mode === "throw") throw new Error("chat failed");
        // Boundary coverage: string-as-number, -1, MAX_SAFE_INTEGER, and wrong types.
        if (opts?.mode === "neg") return { model: "m", provider: "p", usage: { promptTokens: -1, completion_tokens: -1 } };
        return {
          model: "m",
          provider: "p",
          usage: {
            promptTokens: "7",
            completion_tokens: Number.MAX_SAFE_INTEGER,
            outputTokens: {}, // ignored due to earlier key
          },
        };
      }),
    };

    const eventBus = { emit: vi.fn() };
    const factory = new StageApiFactory({
      signal: new AbortController().signal,
      emit: eventBus.emit,
      eventBus,
      aiApiService,
      circuitBreakerRegistry,
    });

    const api = factory.createBaseApi();

    // Rapid consecutive calls should be idempotent (no double wrapping).
    const wrapped1 = api.aiApiService.chat;
    factory.createBaseApi();
    const wrapped2 = api.aiApiService.chat;
    expect(wrapped2).toBe(wrapped1);

    // Simultaneous calls should each track tokens independently.
    await Promise.all([
      api.aiApiService.chat({ usage: "u1", model: "x" }),
      api.aiApiService.chat({ usage: "u1", model: "x", mode: "neg" }),
    ]);
    expect(callCount).toBe(2);
    expect(getGlobalTokenTrackerSpy).toHaveBeenCalledTimes(2);
    expect(tokenTrackerRecordSpy).toHaveBeenCalledTimes(2);
    expect(tokenTrackerRecordSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        model: "m",
        provider: "p",
        usage: "u1",
        promptTokens: 7,
        completionTokens: Number.MAX_SAFE_INTEGER,
        success: true,
      })
    );
    expect(tokenTrackerRecordSpy.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        promptTokens: 0,
        completionTokens: 0,
        success: true,
      })
    );

    // Circuit breaker lookup key should include usage+model.
    expect(circuitBreakerRegistry.get).toHaveBeenCalledWith(
      "aiApiService:chat:u1:x",
      expect.objectContaining({
        failureThreshold: 4,
        successThreshold: 1,
        openDurationMs: 15_000,
        halfOpenMaxCalls: 1,
        isFailure: expect.any(Function),
      })
    );
    expect(breakerExecute).toHaveBeenCalled();

    // Error path: record failure and rethrow.
    tokenTrackerRecordSpy.mockClear();
    await expect(api.aiApiService.chat({ usage: "u2", model: "y", mode: "throw" })).rejects.toThrow("chat failed");
    expect(tokenTrackerRecordSpy).toHaveBeenCalledTimes(1);
    expect(tokenTrackerRecordSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        usage: "u2",
        success: false,
        error: "chat failed",
      })
    );

    // Token tracker failures should be swallowed (error handling).
    tokenTrackerRecordSpy = vi.fn(() => {
      throw new Error("tracker broken");
    });
    const ok = await api.aiApiService.chat({ usage: "u3", model: "z" });
    expect(ok).toEqual(
      expect.objectContaining({
        model: "m",
        provider: "p",
      })
    );
    expect(lastLogger?.debug).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("wraps mcpClient/externalSearchProvider.callTool with retry (withRetry by default; custom strategy supported)", async () => {
    const { StageApiFactory } = await importSubject();

    const callTool = vi.fn(async (toolName, args, options) => ({ toolName, args, options }));
    const extCallTool = vi.fn(async (toolName, args, options) => ({ toolName, args, options }));
    const mcpClient = { callTool };
    const externalSearchProvider = { callTool: extCallTool };

    const controller = new AbortController();
    const factory = new StageApiFactory({
      signal: controller.signal,
      emit: vi.fn(),
      mcpClient,
      externalSearchProvider,
    });

    const api = factory.createBaseApi();

    // Type/empty boundaries: empty toolName, args as array, options with signal.
    const res1 = await api.mcpClient.callTool("", [], { signal: controller.signal });
    expect(res1).toEqual({ toolName: "", args: [], options: { signal: controller.signal } });
    expect(withRetrySpy).toHaveBeenCalledTimes(1);

    // Type boundary: object used where an array might be expected (array-like object).
    const arrayLike = { 0: "x", length: 1 };
    const res2 = await api.mcpClient.callTool("t2", arrayLike, {});
    expect(res2).toEqual({ toolName: "t2", args: arrayLike, options: {} });
    expect(withRetrySpy).toHaveBeenCalledTimes(2);

    // Idempotent wrapping on rapid consecutive createBaseApi calls.
    const wrapped1 = api.mcpClient.callTool;
    factory.createBaseApi();
    const wrapped2 = api.mcpClient.callTool;
    expect(wrapped2).toBe(wrapped1);

    // Custom retry strategy should be used when provided.
    const strategy = { execute: vi.fn(async (fn) => await fn()) };
    const mcpClient2 = { callTool: vi.fn(async () => "ok") };
    const factory2 = new StageApiFactory({ emit: vi.fn(), mcpClient: mcpClient2, retryStrategy: strategy });
    const api2 = factory2.createBaseApi();
    await api2.mcpClient.callTool("t", { a: 1 }, {});
    expect(strategy.execute).toHaveBeenCalledTimes(1);
  });

  it("createDeepSearchApi/createDesignApi validate required fields and log warnings (without throwing)", async () => {
    const { StageApiFactory } = await importSubject();

    const f1 = new StageApiFactory({});
    const api1 = f1.createDeepSearchApi();
    expect(api1).toBeTruthy();
    expect(lastLogger?.warn).toHaveBeenCalledTimes(1);
    expect(String(lastLogger.warn.mock.calls[0][0])).toContain("DeepSearch");
    expect(String(lastLogger.warn.mock.calls[0][0])).toContain("signal");
    expect(String(lastLogger.warn.mock.calls[0][0])).toContain("emit");
    expect(String(lastLogger.warn.mock.calls[0][0])).toContain("aiApiService");

    lastLogger.warn.mockClear();
    const aiApiService = { chat: vi.fn(async () => ({})) };
    const f2 = new StageApiFactory({
      signal: new AbortController().signal,
      emit: vi.fn(),
      aiApiService,
      imageProvider: "img",
      svgGenerator: "svg",
      modelRouter: "router",
    });
    const api2 = f2.createDesignApi();
    expect(api2.imageProvider).toBe("img");
    expect(lastLogger.warn).not.toHaveBeenCalled();
  });

  it("validate handles boundary inputs for requiredFields and values (empty array, empty string)", async () => {
    const { StageApiFactory } = await importSubject();
    const factory = new StageApiFactory();

    // Empty required fields should succeed and not warn.
    expect(factory.validate({ any: "value" }, [])).toBe(true);
    expect(lastLogger?.warn).not.toHaveBeenCalled();

    // Empty string is considered present (only null/undefined are missing).
    lastLogger.warn.mockClear();
    expect(factory.validate({ signal: "", emit: () => {} }, ["signal", "emit"], "Stage")).toBe(true);
    expect(lastLogger.warn).not.toHaveBeenCalled();
  });

  it("fromWorkflowContext maps services correctly, including fallback logic for imageProvider and emit", async () => {
    const { StageApiFactory } = await importSubject();

    const eventBus = { emit: vi.fn() };
    const ctx = {
      signal: "sig",
      eventBus,
      emit: undefined,
      traceContext: makeTraceContextLike("ctx"),
      traceparent: "tp",
      container: { tryGet: vi.fn(() => null) },
      aiApiService: { chat: vi.fn() },
      modelRouter: "router",
      localRetriever: "local",
      externalSearchProvider: "external",
      mcpClient: "mcp",
      mcpResources: "resources",
      circuitBreakerRegistry: "cbr",
      storageAdapter: "storage",
      ocr: "ocr",
      imageProvider: "", // boundary: falsy should fall back
      imageService: "image-service",
      svgGenerator: "svg",
      archive: "archive",
      logger: "logger",
      vfs: "vfs",
      policy: "policy",
    };

    const factory = StageApiFactory.fromWorkflowContext(ctx);
    expect(factory).toBeInstanceOf(StageApiFactory);
    expect(factory.baseConfig.signal).toBe("sig");
    expect(factory.baseConfig.emit).toBe(eventBus.emit);
    expect(factory.services.imageProvider).toBe("image-service");
    expect(factory.services.archive).toBe("archive");
    expect(factory.services.logger).toBe("logger");
  });
});

describe("createStageApiFactory", () => {
  it("creates a StageApiFactory instance and handles empty/null inputs", async () => {
    const { StageApiFactory, createStageApiFactory } = await importSubject();

    expect(createStageApiFactory(undefined)).toBeInstanceOf(StageApiFactory);
    expect(createStageApiFactory(null)).toBeInstanceOf(StageApiFactory);
    expect(createStageApiFactory({})).toBeInstanceOf(StageApiFactory);

    const factory = createStageApiFactory({ emit: vi.fn(), signal: "sig" });
    expect(factory.services.signal).toBe("sig");
  });
});
