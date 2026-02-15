import { describe, it, expect, vi, beforeEach } from "vitest";

let loggerInstances = [];
let behaviorFingerprintInstances = [];
let behaviorFingerprintThrow = false;
let rpcCallMock = vi.fn();
let rpcTerminateMock = vi.fn();

const originalWorker = globalThis.Worker;
const originalURL = globalThis.URL;

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  return {
    ...actual,
    estimateTokensCached: vi.fn((text) => String(text ?? "").length),
    createLogger: vi.fn((name) => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      loggerInstances.push({ name, logger });
      return logger;
    }),
    isNodeLike: vi.fn(() => true),
  };
});

vi.mock("../../../../../js/agents/runtime/core/worker-rpc.js", () => {
  return {
    WorkerRpcClient: class WorkerRpcClient {
      constructor(opts) {
        this.opts = opts;
      }
      call(...args) {
        return rpcCallMock(...args);
      }
      terminate(...args) {
        return rpcTerminateMock(...args);
      }
    },
  };
});

vi.mock("../../../../../js/agents/plugins/analysis/behavior-fingerprint.js", () => {
  class BehaviorFingerprint {
    constructor(config) {
      if (behaviorFingerprintThrow) {
        throw new Error("BehaviorFingerprint init failed");
      }
      this.config = config;
      this.recordAction = vi.fn(() => ({ loopDetected: false, loopInfo: null }));
      this.getSuggestion = vi.fn(() => null);
      this.reset = vi.fn();
      behaviorFingerprintInstances.push(this);
    }
  }
  return { BehaviorFingerprint };
});

const indexPath = "../../../../../js/agents/plugins/compression/index.js";
const cicadaImplPath = "../../../../../js/agents/plugins/compression/impl/cicada-compressor.js";
const compressionAsyncPath = "../../../../../js/agents/plugins/compression/impl/compression-async.js";
const sharedPath = "../../../../../js/agents/shared/index.js";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unmock("../../../../../js/agents/plugins/compression/impl/cicada-compressor.js");
  vi.unmock("../../../../../js/agents/plugins/compression/impl/compression-async.js");
  loggerInstances = [];
  behaviorFingerprintInstances = [];
  behaviorFingerprintThrow = false;
  rpcCallMock.mockReset();
  rpcTerminateMock.mockReset();
  globalThis.Worker = originalWorker;
  globalThis.URL = originalURL;
});

function createCicadaCtx({ config = {} } = {}) {
  const localState = new Map();
  const listeners = new Map();

  const ctx = {
    config: {
      aggressive: false,
      maxContextTokens: 100,
      compressionRatio: 0.6,
      ...config,
    },
    state: {
      set: vi.fn((path, value) => {
        localState.set(path, value);
      }),
      get: vi.fn((path) => localState.get(path)),
      getGlobal: vi.fn(),
    },
    events: { emit: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn((name, service) => {
      ctx._services[name] = service;
    }),
    on: vi.fn((event, handler) => {
      listeners.set(event, handler);
      return vi.fn();
    }),
    _services: {},
    _listeners: listeners,
    __getState: (path) => localState.get(path),
  };

  return ctx;
}

function createWatchdogCtx({ config = {}, globals = {} } = {}) {
  const localState = new Map();
  const globalState = new Map(Object.entries(globals));

  const ctx = {
    config: {
      threshold: 0.75,
      checkInterval: 0,
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
      return vi.fn();
    }),
    __setGlobal: (path, value) => globalState.set(path, value),
    __getLocal: (path) => localState.get(path),
  };

  return ctx;
}

function findLogger(nameFragment) {
  return loggerInstances.find((entry) => entry.name.includes(nameFragment))?.logger;
}

describe("cicadaPlugin", () => {
  it("registers compression service and emits events on compress", async () => {
    const compressMock = vi.fn(async (messages) => ({
      messages: messages.slice(0, 1),
      ratio: 0.5,
    }));

    vi.doMock(cicadaImplPath, () => {
      class MockCompressor {
        constructor(config) {
          this.config = config;
          this.compress = compressMock;
        }
      }
      return { CicadaCompressor: MockCompressor };
    });

    try {
      const { cicadaPlugin } = await import(indexPath);
      const ctx = createCicadaCtx({ config: { maxContextTokens: 100 } });

      await cicadaPlugin.install(ctx);

      const service = ctx._services.compression;
      const messages = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "ok" },
      ];
      const result = await service.compress(messages, { aggressive: true });

      expect(compressMock).toHaveBeenCalledWith(messages, { aggressive: true });
      expect(result.ratio).toBe(0.5);
      expect(ctx.__getState("lastCompression")).toEqual(
        expect.objectContaining({
          before: 2,
          after: 1,
          timestamp: expect.any(Number),
        }),
      );
      expect(ctx.events.emit).toHaveBeenCalledWith("compression:done", {
        originalCount: 2,
        compressedCount: 1,
        ratio: 0.5,
      });
    } finally {
      vi.doUnmock(cicadaImplPath);
    }
  });

  it("handles shouldCompress boundaries and warning events", async () => {
    const { cicadaPlugin } = await import(indexPath);
    const ctx = createCicadaCtx({ config: { maxContextTokens: 100 } });

    await cicadaPlugin.install(ctx);

    const service = ctx._services.compression;
    expect(await service.shouldCompress([], 0)).toBe(false);
    expect(await service.shouldCompress([], -1)).toBe(false);
    expect(await service.shouldCompress([], Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(await service.shouldCompress([], "81")).toBe(true);
    expect(await service.shouldCompress([], "")).toBe(false);
    expect(await service.shouldCompress([], undefined)).toBe(false);
    expect(await service.shouldCompress(null, {})).toBe(false);

    const handler =
      ctx._listeners.get("runtime:tokens:updated") ||
      ctx._listeners.get("runtime.tokens.updated");
    handler?.({ payload: { total: 95 } });

    expect(ctx.events.emit).toHaveBeenCalledWith("compression:warning", {
      current: 95,
      threshold: 100,
    });
  });

  it("propagates compressor failures", async () => {
    const compressMock = vi.fn(async () => {
      throw new Error("boom");
    });

    vi.doMock(cicadaImplPath, () => {
      class MockCompressor {
        constructor(config) {
          this.config = config;
          this.compress = compressMock;
        }
      }
      return { CicadaCompressor: MockCompressor };
    });

    try {
      const { cicadaPlugin } = await import(indexPath);
      const ctx = createCicadaCtx();

      await cicadaPlugin.install(ctx);

      const service = ctx._services.compression;
      await expect(
        service.compress([{ role: "user", content: "oops" }]),
      ).rejects.toThrow("boom");
    } finally {
      vi.doUnmock(cicadaImplPath);
    }
  });
});

describe("watchdogPlugin", () => {
  it("installs and reports healthy state without compressing", async () => {
    const { watchdogPlugin } = await import(indexPath);
    const ctx = createWatchdogCtx({
      config: { checkInterval: 0, threshold: 0.75, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 10, output: 0 },
        "runtime.messages": [{ role: "user", content: "hello" }],
      },
    });

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    const health = ctx._services.watchdog.getHealth();
    expect(health.status).toBe("healthy");
    expect(health.usage).toBeCloseTo(0.1);
    expect(ctx.services.call).not.toHaveBeenCalled();
    expect(ctx.events.emit).not.toHaveBeenCalled();
  });

  it("handles empty globals and falsy maxContextTokens", async () => {
    const { watchdogPlugin } = await import(indexPath);
    const ctx = createWatchdogCtx({
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
  });

  it("logs errors when auto-compression fails", async () => {
    const { watchdogPlugin } = await import(indexPath);
    const ctx = createWatchdogCtx({
      config: { checkInterval: 0, threshold: 0.5, autoCompress: true, maxContextTokens: 100 },
      globals: {
        "runtime.tokens": { input: 80, output: 0 },
        "runtime.messages": [{ role: "user", content: "trigger" }],
      },
    });
    ctx.services.call.mockRejectedValue(new Error("fail"));

    await watchdogPlugin.install(ctx);
    await ctx._services.watchdog.check();

    expect(ctx.log.error).toHaveBeenCalledWith("Auto-compression failed:", expect.any(Error));
    expect(ctx.events.emit).toHaveBeenCalledWith("watchdog:threshold:exceeded", {
      usage: 0.8,
      threshold: 0.5,
    });
  });
});

describe("CompressionLayer", () => {
  it("exposes immutable layer names", async () => {
    const { CompressionLayer } = await import(indexPath);

    expect(CompressionLayer).toEqual({
      TOOL_OUTPUT: "tool_output",
      SESSION_HISTORY: "session_history",
      LLM_SUMMARY: "llm_summary",
    });
    expect(Object.isFrozen(CompressionLayer)).toBe(true);
  });

  it("ignores invalid keys and stays frozen", async () => {
    const { CompressionLayer } = await import(indexPath);

    expect(CompressionLayer.UNKNOWN).toBeUndefined();
    expect(Object.isFrozen(CompressionLayer)).toBe(true);
  });

  it("throws on mutation attempts", async () => {
    const { CompressionLayer } = await import(indexPath);

    expect(() => {
      CompressionLayer.TOOL_OUTPUT = "changed";
    }).toThrow(TypeError);
  });
});

describe("CicadaCompressor", () => {
  it("compresses session history and records metadata", async () => {
    const { CicadaCompressor, CompressionLayer } = await import(indexPath);
    const compressor = new CicadaCompressor({
      layers: [CompressionLayer.SESSION_HISTORY],
    });

    const context = {
      messages: [
        { role: "system", content: "rules" },
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
    };

    const result = await compressor.compress(context, {
      keepLastTurns: 1,
      summaryLineChars: 50,
    });

    expect(result.metadata.layersApplied).toEqual([
      CompressionLayer.SESSION_HISTORY,
    ]);
    expect(Array.isArray(result.context.messages)).toBe(true);
    expect(typeof result.context.sessionSummary).toBe("string");
    expect(result.metadata.stats.sessionHistory.summarizedMessages).toBeGreaterThan(0);
  });

  it("handles null context and deep nested tool outputs with long strings", async () => {
    const { CicadaCompressor, CompressionLayer } = await import(indexPath);
    const compressor = new CicadaCompressor({
      layers: [CompressionLayer.TOOL_OUTPUT],
    });

    const nullResult = await compressor.compress(null, { layers: [] });
    expect(nullResult.context).toEqual({ value: null });

    const huge = "x".repeat(20000);
    const deep = { level1: { level2: { level3: { value: huge } } } };
    const { context: compressed } = await compressor.compress(
      { toolOutputs: [{ output: huge, meta: deep }] },
      { layers: [CompressionLayer.TOOL_OUTPUT], maxToolOutputChars: 50, maxToolOutputDepth: 1 },
    );

    expect(compressed.toolOutputs[0].output.length).toBeLessThanOrEqual(50);
    expect(typeof compressed.toolOutputs[0].meta).toBe("string");
  });

  it("archives with whitespace keys and restores unsupported schema", async () => {
    const { CicadaCompressor } = await import(indexPath);
    const compressor = new CicadaCompressor({ maxArchives: 0, archiveRetentionDays: -1 });

    const archiveId = await compressor.archive("   ", {
      context: {},
      metadata: {},
      summary: "",
    });
    expect(typeof archiveId).toBe("string");

    compressor._archiveStore.set("legacy", {
      schemaVersion: "9.9",
      timestamp: Date.now(),
      summary: "",
      stageKey: "legacy",
    });

    const restored = await compressor.restore("legacy");
    expect(restored._schemaWarning).toContain("Unsupported schema version");

    const filtered = await compressor.listArchives({
      limit: Number.MAX_SAFE_INTEGER,
      pattern: "[",
    });
    expect(Array.isArray(filtered)).toBe(true);

    const archives = await compressor.listArchives({
      limit: Number.MAX_SAFE_INTEGER,
      pattern: "",
    });
    expect(archives.length).toBeGreaterThan(0);
  });

  it("falls back when model router fails", async () => {
    const { CicadaCompressor, CompressionLayer } = await import(indexPath);
    const modelRouter = {
      call: vi.fn(() => {
        throw new Error("router failure");
      }),
    };
    const compressor = new CicadaCompressor({
      modelRouter,
      layers: [CompressionLayer.LLM_SUMMARY],
    });

    const result = await compressor.compress(
      { messages: [{ role: "user", content: "hi" }] },
      { layers: [CompressionLayer.LLM_SUMMARY] },
    );

    expect(modelRouter.call).toHaveBeenCalled();
    expect(result.metadata.layersApplied).toEqual([CompressionLayer.LLM_SUMMARY]);
    expect(result.metadata.llmSummary.summary).toEqual(expect.any(String));
  });
});

describe("Watchdog", () => {
  it("detects repeated outputs and emits interventions", async () => {
    const { Watchdog } = await import(indexPath);
    const eventBus = { emit: vi.fn() };
    const watchdog = new Watchdog({
      eventBus,
      maxRecentOutputs: 2,
      oscillationThreshold: 0.5,
      behaviorFingerprint: false,
    });

    const first = watchdog.recordOutput("hello world");
    const second = watchdog.recordOutput("hello world");

    expect(first.similar).toBe(false);
    expect(second.similar).toBe(true);

    watchdog.tick();
    const health = watchdog.checkHealth({
      maxIterations: 0,
      maxTimeMs: 0,
      stuckThresholdMs: 0,
      oscillationConsecutiveThreshold: 1,
    });

    expect(health.issues.length).toBeGreaterThan(0);
    expect(eventBus.emit).toHaveBeenCalled();
  });

  it("clamps configuration and handles large outputs", async () => {
    const { Watchdog } = await import(indexPath);
    const watchdog = new Watchdog({
      maxRecentOutputs: 0,
      oscillationThreshold: -1,
      behaviorFingerprint: false,
    });

    const config = watchdog.configure({ maxRecentOutputs: 0, oscillationThreshold: 2 });
    expect(config.maxRecentOutputs).toBeGreaterThanOrEqual(2);
    expect(config.oscillationThreshold).toBeLessThanOrEqual(1);

    expect(() => watchdog.recordOutput("x".repeat(15000))).not.toThrow();
  });

  it("emits loop interventions when BehaviorFingerprint detects loops", async () => {
    const { Watchdog } = await import(indexPath);
    const eventBus = { emit: vi.fn() };
    const watchdog = new Watchdog({ eventBus });

    expect(behaviorFingerprintInstances.length).toBeGreaterThan(0);
    const fingerprint = behaviorFingerprintInstances[0];
    fingerprint.recordAction.mockReturnValue({
      loopDetected: true,
      loopInfo: { totalLoopsDetected: 1 },
    });
    fingerprint.getSuggestion.mockReturnValue({
      action: "break_loop",
      severity: "high",
      reason: "loop detected",
      suggestion: "reset",
    });

    const result = watchdog.recordAction({ type: "tool", name: "search" });

    expect(result.loopDetected).toBe(true);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "watchdog:intervention",
      expect.objectContaining({
        payload: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ type: "tool_loop" }),
          ]),
        }),
      }),
    );
  });

  it("handles invalid observers and BehaviorFingerprint failures", async () => {
    behaviorFingerprintThrow = true;
    const { Watchdog } = await import(indexPath);
    const eventBus = { emit: vi.fn() };
    const watchdog = new Watchdog({ eventBus });

    expect(eventBus.emit).toHaveBeenCalled();
    expect(() => watchdog.observe("", () => {})).toThrow();
    expect(() => watchdog.observe("event", null)).toThrow(TypeError);
  });
});

describe("ProactiveCompressor", () => {
  it("skips compression when below threshold", async () => {
    const { ProactiveCompressor } = await import(indexPath);
    const compressor = new ProactiveCompressor({
      contextWindow: 1000,
      compressThreshold: 0.9,
      targetFillRatio: 0.3,
      keepLastTurns: 2,
    });

    const messages = [
      { role: "user", content: "a", _tokens: 5 },
      { role: "assistant", content: "b", _tokens: 5 },
    ];

    const result = await compressor.compress(messages);
    expect(result.compressed).toBe(false);
    expect(result.stats.skipped).toBe(true);
    expect(result.messages).toBe(messages);
  });

  it("handles empty inputs and clamps configuration boundaries", async () => {
    const { ProactiveCompressor } = await import(indexPath);
    const compressor = new ProactiveCompressor();

    const empty = await compressor.compress([]);
    expect(empty.messages).toEqual([]);
    expect(empty.compressed).toBe(false);

    compressor.configure({
      contextWindow: Number.MAX_SAFE_INTEGER,
      compressThreshold: -1,
      targetFillRatio: 1,
      keepLastTurns: -5,
    });

    expect(compressor._contextWindow).toBe(Number.MAX_SAFE_INTEGER);
    expect(compressor._compressThreshold).toBeGreaterThanOrEqual(0.5);
    expect(compressor._targetFillRatio).toBeLessThanOrEqual(0.7);
    expect(compressor._keepLastTurns).toBeGreaterThanOrEqual(2);
  });

  it("archives locally when memoryStore fails", async () => {
    const { ProactiveCompressor } = await import(indexPath);
    const memoryStore = {
      archive: vi.fn(async () => {
        throw new Error("store down");
      }),
    };
    const compressor = new ProactiveCompressor({
      contextWindow: 10,
      compressThreshold: 0.5,
      targetFillRatio: 0.15,
      keepLastTurns: 2,
      memoryStore,
    });

    const messages = [
      { role: "user", content: "old", _tokens: 5 },
      { role: "assistant", content: "middle", _tokens: 5 },
      { role: "assistant", content: "new", _tokens: 5 },
    ];

    const result = await compressor.compress(messages, { force: true });
    expect(result.archivedIds.length).toBe(1);
    expect(result.archivedIds[0]).toContain("local-");

    const logger = findLogger("proactive-compressor");
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("CompressionCoordinator", () => {
  it("computes shouldCompress from token usage", async () => {
    const { CompressionCoordinator } = await import(indexPath);

    const coordinator = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100, compressThreshold: 0.75 }),
      getTokenUsage: () => ({ total: 80 }),
    });
    expect(coordinator.shouldCompress()).toBe(true);

    const negative = new CompressionCoordinator({
      getContextConfig: () => ({ contextWindow: 100, compressThreshold: 0.75 }),
      getTokenUsage: () => ({ total: -1 }),
    });
    expect(negative.shouldCompress()).toBe(false);
  });

  it("passes titleOnly settings to compression", async () => {
    const compressMock = vi.fn(async () => ({
      messages: ["ok"],
      sessionSummary: "sum",
      stats: { ok: true },
      afterTokens: 1,
    }));

    vi.doMock(compressionAsyncPath, () => {
      return { compressAgentLoopMessagesAsync: compressMock };
    });

    try {
      const { CompressionCoordinator } = await import(indexPath);
      const coordinator = new CompressionCoordinator({
        getContextConfig: () => ({
          contextWindow: 100,
          compressThreshold: 0.5,
          titleOnlySummaryThreshold: 0.1,
          keepLastTurns: 2,
          titleOnlySummaryMaxWords: 5,
          titleOnlySummaryMaxChars: 20,
          maxKeptMessageChars: 10,
          workerThresholdMessages: 1,
        }),
        getTokenUsage: () => ({ total: 80 }),
      });

      const result = await coordinator.maybeCompress(
        [{ role: "user", content: "hello" }],
        { useWorker: false, workerThresholdMessages: 2 },
      );

      expect(compressMock).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          keepLastTurns: 2,
          titleOnly: true,
          titleMaxWords: 5,
          titleMaxChars: 20,
          maxKeptMessageChars: 10,
        }),
        expect.objectContaining({
          useWorker: false,
          workerThresholdMessages: 2,
        }),
      );
      expect(result.messages).toEqual(["ok"]);
    } finally {
      vi.doUnmock(compressionAsyncPath);
    }
  });

  it("returns fallback result when compression fails", async () => {
    const compressMock = vi.fn(async () => {
      throw new Error("boom");
    });

    vi.doMock(compressionAsyncPath, () => {
      return { compressAgentLoopMessagesAsync: compressMock };
    });

    try {
      const warn = vi.fn();
      const { CompressionCoordinator } = await import(indexPath);
      const coordinator = new CompressionCoordinator({
        getContextConfig: () => ({ contextWindow: 100, compressThreshold: 0.5 }),
        getTokenUsage: () => ({ total: 80 }),
        logger: { warn },
      });

      const messages = [{ role: "user", content: "hi" }];
      const result = await coordinator.maybeCompress(messages);

      expect(result.messages).toEqual(messages);
      expect(warn).toHaveBeenCalled();
    } finally {
      vi.doUnmock(compressionAsyncPath);
    }
  });
});

describe("AdaptiveZoneManager", () => {
  it("maps fill ratios to zones and configs", async () => {
    const { AdaptiveZoneManager } = await import(indexPath);
    const manager = new AdaptiveZoneManager();

    expect(manager.getZone(0.1)).toBe("archive");
    expect(manager.getZone(0.3)).toBe("condensed");
    expect(manager.getZone(0.7)).toBe("working");
    expect(manager.getZone(0.95)).toBe("active");

    const config = manager.getZoneConfig("condensed");
    expect(config.summarizeThinking).toBe(true);
  });

  it("returns safe defaults for empty inputs", async () => {
    const { AdaptiveZoneManager } = await import(indexPath);
    const manager = new AdaptiveZoneManager();

    const strategy = manager.getCompressionStrategy(0, 0, 0.5);
    expect(strategy.zone).toBe("active");

    expect(manager.computeStrategies([], 0.5)).toEqual([]);
    expect(manager.getZoneStats([], 0.5)).toEqual({
      archive: 0,
      condensed: 0,
      working: 0,
      active: 0,
    });
  });

  it("ignores invalid zones without throwing", async () => {
    const { AdaptiveZoneManager } = await import(indexPath);
    const manager = new AdaptiveZoneManager();
    const before = manager.getBoundaries();

    expect(() => manager.updateDensity("bogus", 100)).not.toThrow();
    expect(manager.getBoundaries()).toEqual(before);
  });
});

describe("CompressionQualityMonitor", () => {
  it("records retention and reports assessment", async () => {
    const { CompressionQualityMonitor } = await import(indexPath);
    const monitor = new CompressionQualityMonitor({ minRetentionRatio: 0.7 });

    monitor.record({ beforeTokens: 100, afterTokens: 80, keptMessages: 1 });
    monitor.record({ beforeTokens: 100, afterTokens: 50 });

    const assessment = monitor.getAssessment();
    expect(assessment.sampleCount).toBe(2);
    expect(assessment.avgRetention).toBeCloseTo(0.65, 2);
  });

  it("handles zero and string inputs as boundaries", async () => {
    const { CompressionQualityMonitor } = await import(indexPath);
    const monitor = new CompressionQualityMonitor();

    const result = monitor.record({
      beforeTokens: 0,
      afterTokens: 0,
      keptMessages: -1,
      summarizedMessages: "2",
    });

    expect(result.retention).toBe(1);
    expect(monitor.getSamples(Number.MAX_SAFE_INTEGER).length).toBe(1);
  });

  it("returns healthy status with no samples", async () => {
    const { CompressionQualityMonitor } = await import(indexPath);
    const monitor = new CompressionQualityMonitor();

    const health = monitor.checkHealth();
    expect(health.status).toBe("healthy");
    expect(health.needsAdjustment).toBe(false);
  });
});

describe("ContextPredictor", () => {
  it("records messages and predicts usage", async () => {
    const { ContextPredictor } = await import(indexPath);
    const predictor = new ContextPredictor({
      contextWindow: 1000,
      windowSize: 5,
      decayFactor: 0.9,
    });

    expect(predictor.record("abcd")).toBe(4);
    expect(predictor.recordBatch([{ content: "xx" }, "yyy"])).toBe(5);

    const prediction = predictor.predict(20, { compressThreshold: 0.01 });
    expect(prediction.shouldCompress).toBe(true);

    const stats = predictor.getStats();
    expect(stats.messageCount).toBe(3);
    expect(stats.totalTokens).toBeGreaterThan(0);
  });

  it("clamps context window and returns zones", async () => {
    const { ContextPredictor } = await import(indexPath);
    const predictor = new ContextPredictor({ contextWindow: 2000 });

    predictor.setContextWindow(-1);
    expect(predictor.getFillRatio(1000)).toBe(1);
    expect(predictor.getZone(0.2)).toBe("condensed");
  });

  it("throws on invalid batch input", async () => {
    const { ContextPredictor } = await import(indexPath);
    const predictor = new ContextPredictor();

    expect(() => predictor.recordBatch(null)).toThrow(TypeError);
  });
});

describe("compressSessionHistoryAsync", () => {
  it("uses sync compression when worker is unavailable", async () => {
    const { compressSessionHistoryAsync } = await import(indexPath);
    const messages = [
      { role: "system", content: "rules" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];

    const result = await compressSessionHistoryAsync(messages, {
      keepLastTurns: 1,
      summaryLineChars: 50,
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.sessionSummary).toContain("user:");
    expect(result.stats.totalMessages).toBe(3);
  });

  it("uses worker path when available and threshold met", async () => {
    const shared = await import(sharedPath);
    shared.isNodeLike.mockReturnValue(false);
    globalThis.Worker = class WorkerMock {};

    rpcCallMock.mockResolvedValue({
      messages: [{ role: "user", content: "ok" }],
      sessionSummary: "sum",
      stats: { totalMessages: 1 },
      afterTokens: 1,
    });

    const { compressSessionHistoryAsync } = await import(indexPath);
    const result = await compressSessionHistoryAsync(
      [{ role: "user", content: "hi" }],
      {},
      { useWorker: true, workerThresholdMessages: 1 },
    );

    expect(rpcCallMock).toHaveBeenCalled();
    expect(result.sessionSummary).toBe("sum");
  });

  it("throws on invalid inputs or aborted signals", async () => {
    const { compressSessionHistoryAsync } = await import(indexPath);
    await expect(compressSessionHistoryAsync("bad")).rejects.toThrow(TypeError);

    const controller = new AbortController();
    controller.abort();
    await expect(
      compressSessionHistoryAsync([], {}, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
  });

  it("supports concurrent calls", async () => {
    const { compressSessionHistoryAsync } = await import(indexPath);
    const messages = [{ role: "user", content: "fast" }];

    const results = await Promise.all([
      compressSessionHistoryAsync(messages),
      compressSessionHistoryAsync(messages),
    ]);

    expect(results[0].messages).toEqual(results[1].messages);
    expect(results[0]).not.toBe(results[1]);
  });
});

describe("terminateCompressionWorker", () => {
  it("is a no-op when no worker exists", async () => {
    const { terminateCompressionWorker } = await import(indexPath);

    expect(() => terminateCompressionWorker()).not.toThrow();
    expect(rpcTerminateMock).not.toHaveBeenCalled();
  });

  it("terminates worker and ignores termination errors", async () => {
    const shared = await import(sharedPath);
    shared.isNodeLike.mockReturnValue(false);
    globalThis.Worker = class WorkerMock {};

    rpcCallMock.mockResolvedValue({
      messages: [],
      sessionSummary: null,
      stats: {},
      afterTokens: 0,
    });

    const { compressSessionHistoryAsync, terminateCompressionWorker } = await import(indexPath);
    await compressSessionHistoryAsync(
      [{ role: "user", content: "init" }],
      {},
      { useWorker: true, workerThresholdMessages: 1 },
    );

    rpcTerminateMock.mockImplementation(() => {
      throw new Error("terminate failed");
    });

    expect(() => terminateCompressionWorker()).not.toThrow();
    expect(rpcTerminateMock).toHaveBeenCalledTimes(1);

    terminateCompressionWorker();
    expect(rpcTerminateMock).toHaveBeenCalledTimes(1);
  });
});

describe("isCompressionWorkerAvailable", () => {
  it("returns false in node-like environments", async () => {
    const shared = await import(sharedPath);
    shared.isNodeLike.mockReturnValue(true);

    const { isCompressionWorkerAvailable } = await import(indexPath);
    expect(isCompressionWorkerAvailable()).toBe(false);
  });

  it("reflects Worker availability and type boundaries", async () => {
    const shared = await import(sharedPath);
    shared.isNodeLike.mockReturnValue(false);

    globalThis.Worker = class WorkerMock {};
    const { isCompressionWorkerAvailable } = await import(indexPath);
    expect(isCompressionWorkerAvailable()).toBe(true);

    globalThis.Worker = undefined;
    expect(isCompressionWorkerAvailable()).toBe(false);
  });
});
