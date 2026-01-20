import { describe, it, expect, vi, beforeEach } from "vitest";

const modulePath = "../../../../../js/agents/llm/internal/config-parser.js";

const mocks = vi.hoisted(() => {
  const isPlainObjectValue = (value) => !!value && typeof value === "object" && !Array.isArray(value);

  const RouterStrategy = {
    ROUND_ROBIN: "round_robin",
    LATENCY_OPTIMIZED: "latency_optimized",
  };

  const ModelTier = {
    POWER: "power",
    FAST: "fast",
    FALLBACK: "fallback",
  };

  const defaultNormalizeRouterStrategy = (strategy, fallback) => {
    const value = typeof strategy === "string" ? strategy.trim().toLowerCase() : "";
    if (value === RouterStrategy.ROUND_ROBIN || value === RouterStrategy.LATENCY_OPTIMIZED) return value;
    return fallback;
  };

  const normalizeRouterStrategy = vi.fn(defaultNormalizeRouterStrategy);

  const assertModelEntry = vi.fn((entry) => {
    if (!isPlainObjectValue(entry) || !entry.id) throw new TypeError("Invalid model entry");
  });

  const assertProvider = vi.fn((provider) => {
    if (!isPlainObjectValue(provider)) throw new TypeError("Invalid provider");
  });

  const assertUsageConfig = vi.fn((cfg) => {
    if (!isPlainObjectValue(cfg)) throw new TypeError("Invalid usage config");
  });

  const normalizeModelTags = vi.fn((tags) =>
    Array.isArray(tags) ? tags.map((t) => String(t).toLowerCase()) : []
  );

  const safeJsonParse = vi.fn((raw, opts) => {
    if (typeof raw !== "string") return null;
    if (opts && typeof opts.maxChars === "number" && raw.length > opts.maxChars) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  const isPlainObject = vi.fn((value) => isPlainObjectValue(value));

  const toNonEmptyString = vi.fn((value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed ? trimmed : "";
  });

  const toPositiveInt = vi.fn((value, fallback) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return fallback;
  });

  class ModelEventEmitter {}

  class RetryStrategy {
    constructor(cfg) {
      if (cfg && cfg.throw) throw new Error("Invalid");
      this.cfg = cfg;
    }
    execute() {}
  }

  class PerformanceRouter {
    constructor(options) {
      this.options = options;
    }
  }

  return {
    isPlainObjectValue,
    RouterStrategy,
    ModelTier,
    defaultNormalizeRouterStrategy,
    normalizeRouterStrategy,
    assertModelEntry,
    assertProvider,
    assertUsageConfig,
    normalizeModelTags,
    safeJsonParse,
    isPlainObject,
    toNonEmptyString,
    toPositiveInt,
    ModelEventEmitter,
    RetryStrategy,
    PerformanceRouter,
  };
});

vi.mock("../../../../../js/agents/llm/provider.js", () => ({
  assertModelEntry: mocks.assertModelEntry,
  assertProvider: mocks.assertProvider,
  assertUsageConfig: mocks.assertUsageConfig,
  normalizeModelTags: mocks.normalizeModelTags,
}));

vi.mock("../../../../../js/agents/llm/constants.js", () => ({
  RouterStrategy: mocks.RouterStrategy,
  normalizeRouterStrategy: mocks.normalizeRouterStrategy,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  safeJsonParse: mocks.safeJsonParse,
  isPlainObject: mocks.isPlainObject,
  toNonEmptyString: mocks.toNonEmptyString,
  toPositiveInt: mocks.toPositiveInt,
}));

vi.mock("../../../../../js/agents/llm/model-events.js", () => ({
  ModelEventEmitter: mocks.ModelEventEmitter,
}));

vi.mock("../../../../../js/agents/runtime/core/retry-strategy.js", () => ({
  RetryStrategy: mocks.RetryStrategy,
}));

vi.mock("../../../../../js/agents/runtime/routing/performance-router.js", () => ({
  PerformanceRouter: mocks.PerformanceRouter,
  ModelTier: mocks.ModelTier,
}));

let resolveEndpointTier;
let shouldUsePerformanceRouting;
let applyModelRouterConfig;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ resolveEndpointTier, shouldUsePerformanceRouting, applyModelRouterConfig } = await import(modulePath));
});

describe("resolveEndpointTier", () => {
  it("uses valid custom tier resolver result", () => {
    const modelEntry = { tier: "power", tags: ["fast"] };
    const tierResolver = vi.fn(() => mocks.ModelTier.FALLBACK);
    const result = resolveEndpointTier({
      tierResolver,
      modelId: "model-1",
      modelEntry,
      usage: "chat",
      images: [],
    });
    expect(result).toBe(mocks.ModelTier.FALLBACK);
    expect(tierResolver).toHaveBeenCalledWith({
      modelId: "model-1",
      modelEntry,
      usage: "chat",
      images: [],
    });
  });

  it("falls back when resolver returns invalid tier", () => {
    const result = resolveEndpointTier({
      tierResolver: () => "invalid",
      modelId: "model-1",
      modelEntry: { tags: ["fast"] },
    });
    expect(result).toBe(mocks.ModelTier.FAST);
  });

  it("ignores resolver errors and uses tags", () => {
    const tierResolver = vi.fn(() => {
      throw new Error("boom");
    });
    const result = resolveEndpointTier({
      tierResolver,
      modelId: "model-1",
      modelEntry: { tags: ["fallback"] },
    });
    expect(result).toBe(mocks.ModelTier.FALLBACK);
  });

  it("uses explicit tier when valid and trims whitespace", () => {
    const result = resolveEndpointTier({
      tierResolver: null,
      modelId: "model-1",
      modelEntry: { tier: " fast ", tags: ["fallback"] },
    });
    expect(result).toBe(mocks.ModelTier.FAST);
  });

  it("falls back to tags when explicit tier is invalid", () => {
    const result = resolveEndpointTier({
      tierResolver: null,
      modelId: "model-1",
      modelEntry: { tier: "unknown", tags: ["fallback"] },
    });
    expect(result).toBe(mocks.ModelTier.FALLBACK);
  });

  it("uses id heuristic with long modelId and non-array tags", () => {
    const longId = `${"x".repeat(10000)}-flash-${"y".repeat(10000)}`;
    const result = resolveEndpointTier({
      tierResolver: undefined,
      modelId: longId,
      modelEntry: { tags: { not: "array" } },
    });
    expect(result).toBe(mocks.ModelTier.FAST);
  });

  it("handles null/undefined and empty inputs", () => {
    const result = resolveEndpointTier({
      tierResolver: undefined,
      modelId: "",
      modelEntry: null,
      usage: "",
      images: [],
    });
    expect(result).toBe(mocks.ModelTier.POWER);
  });

  it("handles concurrent calls without interference", async () => {
    const [tierA, tierB] = await Promise.all([
      Promise.resolve(
        resolveEndpointTier({ tierResolver: undefined, modelId: "flash-mini", modelEntry: { tags: [] } })
      ),
      Promise.resolve(
        resolveEndpointTier({ tierResolver: undefined, modelId: "model-2", modelEntry: { tags: ["fallback"] } })
      ),
    ]);
    expect(tierA).toBe(mocks.ModelTier.FAST);
    expect(tierB).toBe(mocks.ModelTier.FALLBACK);
  });
});

describe("shouldUsePerformanceRouting", () => {
  it("respects explicit performanceRouting overrides", () => {
    expect(
      shouldUsePerformanceRouting({
        strategy: mocks.RouterStrategy.LATENCY_OPTIMIZED,
        performanceRouting: false,
      })
    ).toBe(false);
    expect(
      shouldUsePerformanceRouting({
        strategy: mocks.RouterStrategy.ROUND_ROBIN,
        performanceRouting: true,
      })
    ).toBe(true);
  });

  it("uses strategy when performanceRouting is null or undefined", () => {
    expect(
      shouldUsePerformanceRouting({
        strategy: mocks.RouterStrategy.LATENCY_OPTIMIZED,
        performanceRouting: null,
      })
    ).toBe(true);
    expect(
      shouldUsePerformanceRouting({
        strategy: mocks.RouterStrategy.ROUND_ROBIN,
        performanceRouting: undefined,
      })
    ).toBe(false);
    expect(
      shouldUsePerformanceRouting({
        strategy: "",
        performanceRouting: null,
      })
    ).toBe(false);
  });

  it("handles type boundaries and concurrent calls", async () => {
    const [a, b, c] = await Promise.all([
      Promise.resolve(shouldUsePerformanceRouting({ strategy: {}, performanceRouting: null })),
      Promise.resolve(shouldUsePerformanceRouting({ strategy: 0, performanceRouting: null })),
      Promise.resolve(
        shouldUsePerformanceRouting({ strategy: mocks.RouterStrategy.LATENCY_OPTIMIZED, performanceRouting: null })
      ),
    ]);
    expect(a).toBe(false);
    expect(b).toBe(false);
    expect(c).toBe(true);
  });
});

describe("applyModelRouterConfig", () => {
  it("applies defaults with undefined options", () => {
    const router = {};
    const result = applyModelRouterConfig(router);
    expect(result).toBe(router);
    expect(router._events).toBeInstanceOf(mocks.ModelEventEmitter);
    expect(router._debug).toBe(false);
    expect(router._strategy).toBe(mocks.RouterStrategy.ROUND_ROBIN);
    expect(router._performanceRouting).toBe(null);
    expect(router._tierResolver).toBe(null);
    expect(router._performanceRouter).toBeInstanceOf(mocks.PerformanceRouter);
    expect(router._performanceRouter.options.preferFastTier).toBe(true);
    expect(router._rrNextIndexByUsage).toBeInstanceOf(Map);
    expect(router._persistRoundRobin).toBe(false);
    expect(router._roundRobinStorageKey).toBe("paperburner_modelrouter_rr_v1");
    expect(router._roundRobinStorage).toBe(null);
    expect(typeof router._logger.debug).toBe("function");
    expect(typeof router._logger.info).toBe("function");
    expect(typeof router._logger.warn).toBe("function");
    expect(typeof router._logger.error).toBe("function");
    expect(typeof router._time.now).toBe("function");
    expect(typeof router._time.sleep).toBe("function");
    expect(router._retryStrategy).toBe(null);
    expect(router._baseCooldownMs).toBe(60000);
    expect(router._maxCooldownMs).toBe(600000);
    expect(router._backoffMultiplier).toBe(2);
    expect(router._cooldownMs).toBe(60000);
    expect(router._models.size).toBe(0);
    expect(router._providers.size).toBe(0);
    expect(router._usageTags.size).toBe(0);
    expect(router._health).toBeInstanceOf(Map);
    expect(router._rateLimiters).toBeInstanceOf(Map);
    expect(router._circuitBreakers).toBeInstanceOf(Map);
    expect(router._lastCircuitBreakerCleanupMs).toBe(null);
    expect(mocks.assertUsageConfig).toHaveBeenCalledWith({});
  });

  it("uses debug logger and emits performance routing diagnostics", () => {
    const router = {};
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    applyModelRouterConfig(router, { debug: true, logger });
    expect(router._debug).toBe(true);
    expect(router._logger).toBe(logger);
    expect(router._performanceRouter.options.preferFastTier).toBe(true);
    expect(typeof router._performanceRouter.options.onRouteDecision).toBe("function");
    router._performanceRouter.options.onRouteDecision({
      endpointId: "m1",
      reason: "test",
      complexity: 3,
    });
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("m1"));
  });

  it("throws for invalid debug, strategy, and logger values", () => {
    expect(() => applyModelRouterConfig({}, { debug: "yes" })).toThrow(TypeError);
    expect(() => applyModelRouterConfig({}, { strategy: "unknown" })).toThrow(/strategy must be one of/);
    expect(() =>
      applyModelRouterConfig({}, { debug: true, logger: { debug: () => {}, info: () => {}, warn: () => {} } })
    ).toThrow(/logger\.error/);
  });

  it("honors performance router, tier resolver, and storage key fallback", () => {
    const router = {};
    const perfRouter = new mocks.PerformanceRouter({ preferFastTier: false });
    const tierResolver = vi.fn();
    applyModelRouterConfig(router, {
      performanceRouting: true,
      performanceRouter: perfRouter,
      tierResolver,
      roundRobinStorageKey: "   ",
    });
    expect(router._performanceRouting).toBe(true);
    expect(router._performanceRouter).toBe(perfRouter);
    expect(router._tierResolver).toBe(tierResolver);
    expect(router._roundRobinStorageKey).toBe("paperburner_modelrouter_rr_v1");
  });

  it("configures cooldown from object and clamps max", () => {
    const router = {};
    applyModelRouterConfig(router, { cooldown: { baseMs: 100, maxMs: 50, multiplier: 3 } });
    expect(router._baseCooldownMs).toBe(100);
    expect(router._maxCooldownMs).toBe(100);
    expect(router._backoffMultiplier).toBe(3);
    expect(router._cooldownMs).toBe(100);
  });

  it("handles legacy cooldown when no newer overrides are provided", () => {
    const router = {};
    applyModelRouterConfig(router, { cooldownMs: 123 });
    expect(router._baseCooldownMs).toBe(123);
    expect(router._maxCooldownMs).toBe(123);
  });

  it("clamps backoff multiplier to a minimum of 1 when positive", () => {
    const router = {};
    applyModelRouterConfig(router, { backoffMultiplier: 0.5 });
    expect(router._backoffMultiplier).toBe(1);
  });

  it("handles string numeric, zero, negative, and MAX_SAFE_INTEGER boundaries", () => {
    const routerA = {};
    applyModelRouterConfig(routerA, {
      baseCooldownMs: "1000",
      maxCooldownMs: Number.MAX_SAFE_INTEGER,
      backoffMultiplier: "2",
    });
    expect(routerA._baseCooldownMs).toBe(1000);
    expect(routerA._maxCooldownMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(routerA._backoffMultiplier).toBe(2);

    const routerB = {};
    applyModelRouterConfig(routerB, { baseCooldownMs: 0, maxCooldownMs: -1, backoffMultiplier: -1 });
    expect(routerB._baseCooldownMs).toBe(60000);
    expect(routerB._maxCooldownMs).toBe(600000);
    expect(routerB._backoffMultiplier).toBe(2);
  });

  it("populates models, providers, usage tags, and deep usage config", () => {
    const router = {};
    const models = [
      { id: "m1", tags: ["FAST", "Alpha"] },
      { id: "m2", tags: [] },
    ];
    const providers = { p1: { name: "p1" }, p2: { name: "p2" } };
    const usageTags = {
      chat: ["Alpha", "Beta"],
      "": ["ignore"],
      "   ": ["ignore2"],
      doc: { nested: true },
    };
    const usageConfig = { chat: { limits: { tokens: { max: 1 } } } };
    applyModelRouterConfig(router, { models, providers, usageTags, usageConfig });
    expect(router._models.get("m1").tags).toEqual(["fast", "alpha"]);
    expect(router._models.get("m2").tags).toEqual([]);
    expect(router._providers.size).toBe(2);
    expect(router._usageTags.get("chat")).toEqual(["alpha", "beta"]);
    expect(router._usageTags.has("")).toBe(false);
    expect(router._usageTags.has("   ")).toBe(false);
    expect(router._usageTags.get("doc")).toEqual([]);
    expect(router._usageConfig).toBe(usageConfig);
    expect(mocks.assertModelEntry).toHaveBeenCalledTimes(2);
    expect(mocks.assertProvider).toHaveBeenCalledTimes(2);
    expect(mocks.assertUsageConfig).toHaveBeenCalledWith(usageConfig);
  });

  it("accepts providers as a Map", () => {
    const router = {};
    const providers = new Map([
      [1, { name: "p1" }],
      ["p2", { name: "p2" }],
    ]);
    applyModelRouterConfig(router, { providers });
    expect(router._providers.get("1")).toEqual({ name: "p1" });
    expect(router._providers.get("p2")).toEqual({ name: "p2" });
  });

  it("ignores models when provided as a non-array object", () => {
    const router = {};
    applyModelRouterConfig(router, { models: { id: "x" } });
    expect(router._models.size).toBe(0);
    expect(mocks.assertModelEntry).not.toHaveBeenCalled();
  });

  it("resolves retry strategy from objects and handles failures", () => {
    const routerA = {};
    const retryStrategy = { execute: vi.fn() };
    applyModelRouterConfig(routerA, { retryStrategy });
    expect(routerA._retryStrategy).toBe(retryStrategy);

    const routerB = {};
    applyModelRouterConfig(routerB, { retry: { attempts: 2 } });
    expect(routerB._retryStrategy).toBeInstanceOf(mocks.RetryStrategy);
    expect(routerB._retryStrategy.cfg).toEqual({ attempts: 2 });

    const routerC = {};
    applyModelRouterConfig(routerC, { retry: { throw: true } });
    expect(routerC._retryStrategy).toBe(null);
  });

  it("restores round robin cursor from storage", () => {
    const router = {};
    const persisted = {
      chat: "model-a",
      ask: 2.7,
      empty: "   ",
      neg: -1,
      huge: Number.MAX_SAFE_INTEGER,
      nan: "NaN",
      obj: { bad: true },
    };
    const storage = {
      getItem: vi.fn(() => JSON.stringify(persisted)),
      setItem: vi.fn(),
    };
    applyModelRouterConfig(router, {
      persistRoundRobin: true,
      storage,
      roundRobinStorageKey: "rr",
    });
    expect(router._roundRobinStorage).toBe(storage);
    expect(router._rrNextIndexByUsage.get("chat")).toBe("model-a");
    expect(router._rrNextIndexByUsage.get("ask")).toBe(2);
    expect(router._rrNextIndexByUsage.get("huge")).toBe(Number.MAX_SAFE_INTEGER);
    expect(router._rrNextIndexByUsage.get("nan")).toBe("NaN");
    expect(router._rrNextIndexByUsage.has("empty")).toBe(false);
    expect(router._rrNextIndexByUsage.has("neg")).toBe(false);
    expect(router._rrNextIndexByUsage.has("obj")).toBe(false);
    expect(mocks.safeJsonParse).toHaveBeenCalledWith(JSON.stringify(persisted), { maxChars: 200000 });
  });

  it("ignores invalid storage and large persisted data", () => {
    const routerA = {};
    applyModelRouterConfig(routerA, {
      persistRoundRobin: true,
      storage: { getItem: () => "{}", setItem: "nope" },
    });
    expect(routerA._roundRobinStorage).toBe(null);

    const routerB = {};
    const huge = "a".repeat(210000);
    const storage = { getItem: () => huge, setItem: () => {} };
    applyModelRouterConfig(routerB, { persistRoundRobin: true, storage });
    expect(routerB._rrNextIndexByUsage.size).toBe(0);
  });

  it("swallows safeJsonParse errors during round robin restore", () => {
    const router = {};
    const storage = { getItem: () => "{}", setItem: () => {} };
    mocks.safeJsonParse.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => applyModelRouterConfig(router, { persistRoundRobin: true, storage })).not.toThrow();
    expect(router._rrNextIndexByUsage.size).toBe(0);
  });

  it("uses provided time object when valid and falls back when invalid", () => {
    const routerA = {};
    const time = { now: () => 123, sleep: vi.fn(() => Promise.resolve()) };
    applyModelRouterConfig(routerA, { time });
    expect(routerA._time).toBe(time);

    const routerB = {};
    const badTime = { now: () => 1 };
    applyModelRouterConfig(routerB, { time: badTime });
    expect(routerB._time).not.toBe(badTime);
    expect(typeof routerB._time.now).toBe("function");
    expect(typeof routerB._time.sleep).toBe("function");
  });

  it("handles concurrent and consecutive configuration calls", async () => {
    const routerA = {};
    const routerB = {};
    await Promise.all([
      Promise.resolve(applyModelRouterConfig(routerA, { strategy: mocks.RouterStrategy.ROUND_ROBIN })),
      Promise.resolve(applyModelRouterConfig(routerB, { strategy: mocks.RouterStrategy.LATENCY_OPTIMIZED })),
    ]);
    expect(routerA._strategy).toBe(mocks.RouterStrategy.ROUND_ROBIN);
    expect(routerB._strategy).toBe(mocks.RouterStrategy.LATENCY_OPTIMIZED);

    const routerC = {};
    applyModelRouterConfig(routerC, { roundRobinStorageKey: "first" });
    const firstEvents = routerC._events;
    applyModelRouterConfig(routerC, { strategy: mocks.RouterStrategy.LATENCY_OPTIMIZED, roundRobinStorageKey: "second" });
    expect(routerC._strategy).toBe(mocks.RouterStrategy.LATENCY_OPTIMIZED);
    expect(routerC._roundRobinStorageKey).toBe("second");
    expect(routerC._events).not.toBe(firstEvents);
  });
});
