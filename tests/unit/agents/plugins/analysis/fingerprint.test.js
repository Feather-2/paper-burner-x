import { describe, it, expect, vi, beforeEach } from "vitest";

const behaviorFingerprintState = vi.hoisted(() => ({
  instances: [],
  recordActionResponse: { loopDetected: false, loopInfo: null },
  recordActionImpl: null,
  recordActionThrows: false,
  withRecordAction: true,
  withAnalysis: true,
  withSuggestion: true,
  analysisResponse: null,
  suggestionResponse: null,
  stats: null,
  throwOnConstruct: false,
}));

vi.mock("../../../../../js/agents/plugins/analysis/behavior-fingerprint.js", () => {
  class BehaviorFingerprint {
    constructor(config) {
      if (behaviorFingerprintState.throwOnConstruct) {
        throw new Error("BehaviorFingerprint init failed");
      }
      this.config = config;
      behaviorFingerprintState.instances.push(this);

      if (behaviorFingerprintState.withRecordAction) {
        this.recordAction = vi.fn((action) => {
          if (behaviorFingerprintState.recordActionThrows) {
            throw new Error("recordAction failed");
          }
          if (typeof behaviorFingerprintState.recordActionImpl === "function") {
            return behaviorFingerprintState.recordActionImpl(action);
          }
          return behaviorFingerprintState.recordActionResponse;
        });
      }

      if (behaviorFingerprintState.withAnalysis) {
        this.getAnalysis = vi.fn(() => behaviorFingerprintState.analysisResponse);
      }

      if (behaviorFingerprintState.withSuggestion) {
        this.getSuggestion = vi.fn(() => behaviorFingerprintState.suggestionResponse);
      }

      this.reset = vi.fn();
      this.stats = behaviorFingerprintState.stats;
    }
  }

  return { BehaviorFingerprint };
});

import fingerprintPlugin from "../../../../../js/agents/plugins/analysis/fingerprint.js";

const createDefaultAnalysis = () => ({
  totalActions: 1,
  uniqueActions: 1,
  diversityScore: 1,
  actionFrequency: {},
  repeatingPatterns: [],
  consecutiveLoops: [],
  loopCount: 0,
  lastLoopPattern: null,
});

const createDefaultSuggestion = () => ({
  action: "none",
  severity: "low",
  reason: "mock",
  suggestion: null,
});

const createDefaultStats = () => ({
  historySize: 0,
  maxHistorySize: 50,
  loopCount: 0,
  hasActiveLoop: false,
});

const createDeepNested = (depth = 5) => {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  return root;
};

const createFingerprintHarness = async ({ config = {}, servicesCallImpl = null } = {}) => {
  const stateStore = new Map();
  const listeners = new Map();

  const services = {
    registry: new Map(),
    register: vi.fn((name, service) => {
      services.registry.set(name, service);
    }),
    call: vi.fn(async (name, method, args) => {
      if (servicesCallImpl) {
        return servicesCallImpl(name, method, args, services.registry);
      }
      const svc = services.registry.get(name);
      if (!svc || typeof svc[method] !== "function") {
        throw new Error(`service method missing: ${name}.${method}`);
      }
      return svc[method](...args);
    }),
  };

  const ctx = {
    config: {
      windowSize: 5,
      similarityThreshold: 0.85,
      maxHistory: 50,
      ...config,
    },
    state: {
      set: vi.fn((path, value) => {
        stateStore.set(path, value);
      }),
      get: vi.fn((path) => stateStore.get(path)),
    },
    events: { emit: vi.fn() },
    services,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn((name, service) => services.register(name, service)),
    on: vi.fn((pattern, handler) => {
      listeners.set(pattern, handler);
      return vi.fn();
    }),
  };

  await fingerprintPlugin.install(ctx);

  return {
    ctx,
    service: services.registry.get("fingerprint"),
    listeners,
    stateStore,
    services,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  behaviorFingerprintState.instances = [];
  behaviorFingerprintState.recordActionResponse = { loopDetected: false, loopInfo: null };
  behaviorFingerprintState.recordActionImpl = null;
  behaviorFingerprintState.recordActionThrows = false;
  behaviorFingerprintState.withRecordAction = true;
  behaviorFingerprintState.withAnalysis = true;
  behaviorFingerprintState.withSuggestion = true;
  behaviorFingerprintState.analysisResponse = createDefaultAnalysis();
  behaviorFingerprintState.suggestionResponse = createDefaultSuggestion();
  behaviorFingerprintState.stats = createDefaultStats();
  behaviorFingerprintState.throwOnConstruct = false;
});

describe("default", () => {
  it("exposes plugin metadata and defaults", () => {
    expect(fingerprintPlugin.name).toBe("analysis/fingerprint");
    expect(fingerprintPlugin.version).toBe("1.0.0");
    expect(typeof fingerprintPlugin.description).toBe("string");
    expect(fingerprintPlugin.description.length).toBeGreaterThan(0);
    expect(fingerprintPlugin.defaultConfig).toEqual({
      windowSize: 5,
      similarityThreshold: 0.85,
      maxHistory: 50,
    });
    expect(typeof fingerprintPlugin.install).toBe("function");
  });

  it("registers fingerprint service and tool call listener", async () => {
    const { ctx, service } = await createFingerprintHarness();

    expect(ctx.registerService).toHaveBeenCalledWith("fingerprint", expect.any(Object));
    expect(service).toBeTruthy();
    expect(typeof service.analyze).toBe("function");
    expect(typeof service.getHistory).toBe("function");
    expect(typeof service.reset).toBe("function");
    expect(ctx.on).toHaveBeenCalledWith("tool.call.*", expect.any(Function));
    expect(ctx.log.info).toHaveBeenCalledWith("Fingerprint analysis plugin installed");
  });

  it("computes fingerprints, updates state, and returns analysis details", async () => {
    const loopInfo = { pattern: ["a", "b"], count: 2, startPosition: 0, totalLoopsDetected: 1 };
    behaviorFingerprintState.recordActionResponse = { loopDetected: false, loopInfo };

    const { service, ctx, stateStore } = await createFingerprintHarness();
    const action = { name: "search", params: { b: 2, a: 1 } };

    const result = await service.analyze(action);

    expect(result.fingerprint).toBe("tool_call:search:a,b");
    expect(result.similarity).toBe(0);
    expect(result.isLoop).toBe(false);
    expect(result.loopLength).toBe(2);
    expect(result.loopInfo).toEqual(loopInfo);
    expect(result.analysis).toEqual(behaviorFingerprintState.analysisResponse);
    expect(result.suggestion).toEqual(behaviorFingerprintState.suggestionResponse);
    expect(result.stats).toEqual(behaviorFingerprintState.stats);
    expect(typeof result.timestamp).toBe("number");

    expect(ctx.state.set).toHaveBeenCalledWith("lastAnalysis", result);
    expect(stateStore.get("lastAnalysis")).toEqual(result);

    const history = service.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("search");
    expect(history[0].fingerprint).toBe("tool_call:search:a,b");
    expect(typeof history[0].timestamp).toBe("number");

    expect(behaviorFingerprintState.instances).toHaveLength(1);
    expect(behaviorFingerprintState.instances[0].config).toEqual({
      historySize: 50,
      maxPatternLength: 5,
    });
  });

  it.each([
    ["null action", null, "unknown:"],
    ["undefined action", undefined, "unknown:"],
    ["empty string action", "", "unknown:"],
    ["empty array action", [], "unknown:"],
    ["empty object action", {}, "unknown:"],
    ["type zero", { type: 0 }, "unknown:"],
    ["type negative", { type: -1 }, "-1:"],
    ["max safe integer type", { type: Number.MAX_SAFE_INTEGER }, `${Number.MAX_SAFE_INTEGER}:`],
    ["whitespace type", { type: "   " }, "   :"],
    ["whitespace name", { name: "   " }, "tool_call:   :"],
    ["string numeric type", { type: "1", params: {} }, "1:"],
    ["array params fallback", { type: "tool", params: [] }, "tool:"],
    ["array-like params", { type: "tool", params: { 0: "x", length: 1 } }, "tool:0,length"],
  ])("handles boundary values for %s", async (_label, action, expectedFingerprint) => {
    const { service } = await createFingerprintHarness();
    const result = await service.analyze(action);

    expect(result.fingerprint).toBe(expectedFingerprint);
    expect(result.loopLength).toBe(0);
    expect(result.isLoop).toBe(false);
  });

  it("trims history to maxHistory and returns a copy", async () => {
    const { service } = await createFingerprintHarness({ config: { maxHistory: 2 } });

    await service.analyze({ type: "a" });
    await service.analyze({ type: "b" });
    await service.analyze({ type: "c" });

    const history = service.getHistory();
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.action)).toEqual(["b", "c"]);

    history.push({ action: "x", fingerprint: "x:", timestamp: 0 });
    expect(service.getHistory()).toHaveLength(2);
  });

  it("emits loopDetected when similarity exceeds threshold", async () => {
    const { service, ctx } = await createFingerprintHarness({
      config: { windowSize: 2, similarityThreshold: 0.5 },
    });
    const action = { type: "repeat", params: { x: 1 } };

    await service.analyze(action);
    expect(ctx.events.emit).not.toHaveBeenCalled();

    await service.analyze(action);

    expect(ctx.events.emit).toHaveBeenCalledTimes(1);
    expect(ctx.events.emit).toHaveBeenCalledWith("fingerprint.loop.detected", {
      action,
      similarity: 1,
      loopLength: 0,
    });
  });

  it("emits loopDetected when BehaviorFingerprint reports a loop", async () => {
    const loopInfo = { pattern: ["x", "y", "z"], count: 3, startPosition: 1, totalLoopsDetected: 2 };
    behaviorFingerprintState.recordActionResponse = { loopDetected: true, loopInfo };

    const { service, ctx } = await createFingerprintHarness({
      config: { similarityThreshold: 0.99 },
    });

    const action = { type: "loop", params: { a: 1 } };
    const result = await service.analyze(action);

    expect(result.isLoop).toBe(true);
    expect(result.loopLength).toBe(3);
    expect(ctx.events.emit).toHaveBeenCalledWith("fingerprint.loop.detected", {
      action,
      similarity: 0,
      loopLength: 3,
    });
  });

  it("handles missing BehaviorFingerprint methods and stats", async () => {
    behaviorFingerprintState.withRecordAction = false;
    behaviorFingerprintState.withAnalysis = false;
    behaviorFingerprintState.withSuggestion = false;
    behaviorFingerprintState.stats = null;

    const { service } = await createFingerprintHarness();
    const result = await service.analyze({ type: "tool", params: { a: 1 } });

    expect(result.isLoop).toBe(false);
    expect(result.loopLength).toBe(0);
    expect(result.analysis).toBeNull();
    expect(result.suggestion).toBeNull();
    expect(result.stats).toBeNull();
  });

  it("propagates recordAction errors", async () => {
    behaviorFingerprintState.recordActionThrows = true;

    const { service } = await createFingerprintHarness();

    await expect(service.analyze({ type: "fail" })).rejects.toThrow("recordAction failed");
  });

  it("supports concurrent analyze calls after initialization", async () => {
    const { service } = await createFingerprintHarness();

    await service.analyze({ type: "init", params: { a: 1 } });

    const [first, second] = await Promise.all([
      service.analyze({ type: "fast", params: { b: 2 } }),
      service.analyze({ type: "fast", params: { b: 3 } }),
    ]);

    expect(first.fingerprint).toBe("fast:b");
    expect(second.fingerprint).toBe("fast:b");
    expect(service.getHistory()).toHaveLength(3);
    expect(behaviorFingerprintState.instances[0].recordAction).toHaveBeenCalledTimes(3);
  });

  it("supports rapid sequential calls with string windowSize", async () => {
    const { service } = await createFingerprintHarness({
      config: { windowSize: "2", similarityThreshold: 0.9 },
    });

    const action = { type: "seq", params: { a: 1 } };
    const first = await service.analyze(action);
    const second = await service.analyze(action);

    expect(first.similarity).toBe(0);
    expect(second.similarity).toBe(1);
  });

  it("handles resource-heavy payloads with long strings and deep objects", async () => {
    const longString = "x".repeat(100000);
    const deep = createDeepNested(10);

    const { service } = await createFingerprintHarness();
    const action = {
      type: "tool",
      name: longString,
      params: { deep, huge: longString, z: 1 },
    };

    const result = await service.analyze(action);

    expect(result.fingerprint.startsWith(`tool:${longString}:`)).toBe(true);
    expect(result.fingerprint.endsWith("deep,huge,z")).toBe(true);
  });

  it("routes tool.call.* events through the fingerprint service", async () => {
    const callSpy = vi.fn().mockResolvedValue({ ok: true });
    const { listeners } = await createFingerprintHarness({
      servicesCallImpl: (name, method, args) => callSpy(name, method, args),
    });

    const handler = listeners.get("tool.call.*");
    await handler({ payload: { name: "fetch", args: { q: "test" } } });
    await handler({ payload: [] });

    expect(callSpy).toHaveBeenNthCalledWith(1, "fingerprint", "analyze", [
      { type: "tool_call", name: "fetch", args: { q: "test" } },
    ]);
    expect(callSpy).toHaveBeenNthCalledWith(2, "fingerprint", "analyze", [
      { type: "tool_call", name: undefined, args: undefined },
    ]);
  });

  it("resets history and recreates the fingerprinter", async () => {
    const { service } = await createFingerprintHarness();

    await service.analyze({ type: "one" });
    await service.analyze({ type: "two" });

    expect(service.getHistory()).toHaveLength(2);
    expect(behaviorFingerprintState.instances).toHaveLength(1);

    service.reset();

    expect(service.getHistory()).toEqual([]);
    expect(behaviorFingerprintState.instances[0].reset).toHaveBeenCalledTimes(1);

    await service.analyze({ type: "three" });

    expect(behaviorFingerprintState.instances).toHaveLength(2);
    expect(service.getHistory()).toHaveLength(1);
  });
});
