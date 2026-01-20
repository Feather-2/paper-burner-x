import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMakeStageEmitter = vi.hoisted(() => vi.fn());
const mockNormalizeBudgetConfig = vi.hoisted(() => vi.fn());
const mockBuildBaseCaller = vi.hoisted(() => vi.fn());
const mockEmitBudgetEvents = vi.hoisted(() => vi.fn());
const mockEnsureBudgetState = vi.hoisted(() => vi.fn());
const mockEstimateCostUSDDelta = vi.hoisted(() => vi.fn());
const mockResolveModelPricing = vi.hoisted(() => vi.fn());
const mockNormalizeTokenUsage = vi.hoisted(() => vi.fn());
const mockIsPlainObject = vi.hoisted(() => vi.fn());
const mockToNonEmptyString = vi.hoisted(() => vi.fn());
const mockSafeInt = vi.hoisted(() => vi.fn());
const mockSafeNumber = vi.hoisted(() => vi.fn());

vi.mock("../../../../../js/agents/stages/deepsearch/state.js", () => ({
  makeStageEmitter: mockMakeStageEmitter,
  normalizeBudgetConfig: mockNormalizeBudgetConfig,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model/caller.js", () => ({
  buildBaseCaller: mockBuildBaseCaller,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model/budget.js", () => ({
  emitBudgetEvents: mockEmitBudgetEvents,
  ensureBudgetState: mockEnsureBudgetState,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model/pricing.js", () => ({
  estimateCostUSDDelta: mockEstimateCostUSDDelta,
  resolveModelPricing: mockResolveModelPricing,
}));

vi.mock("../../../../../js/agents/stages/deepsearch/model/usage.js", () => ({
  normalizeTokenUsage: mockNormalizeTokenUsage,
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isPlainObject: mockIsPlainObject,
  toNonEmptyString: mockToNonEmptyString,
  safeInt: mockSafeInt,
  safeNumber: mockSafeNumber,
}));

import {
  buildBaseCaller,
  emitBudgetEvents,
  ensureBudgetState,
  estimateCostUSDDelta,
  getModelCaller,
  normalizeTokenUsage,
  resolveModelPricing,
} from "../../../../../js/agents/stages/deepsearch/model.js";

function makeMessages(content = "Hello") {
  return [{ role: "user", content }];
}

function makeDeepObject(depth) {
  let node = { leaf: "value" };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, child: node };
  }
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMakeStageEmitter.mockReturnValue(vi.fn());
  mockNormalizeBudgetConfig.mockImplementation((budget) => (budget ? { ...budget } : undefined));
  mockNormalizeTokenUsage.mockReturnValue(null);
  mockEstimateCostUSDDelta.mockReturnValue(0);
  mockEmitBudgetEvents.mockReturnValue({ warningReasons: [], exceededReasons: [] });
  mockEnsureBudgetState.mockImplementation((state) => state);
  mockResolveModelPricing.mockReturnValue(null);
  mockSafeNumber.mockImplementation((value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined));
  mockSafeInt.mockImplementation((value) => {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : undefined;
  });
});

describe("buildBaseCaller", () => {
  it("re-exports buildBaseCaller from model/caller", () => {
    mockBuildBaseCaller.mockReturnValue("sentinel");
    const stageApi = { id: "stage" };
    const options = { usage: "worker" };

    expect(buildBaseCaller).toBe(mockBuildBaseCaller);
    expect(buildBaseCaller(stageApi, options)).toBe("sentinel");
    expect(mockBuildBaseCaller).toHaveBeenCalledWith(stageApi, options);
  });
});

describe("emitBudgetEvents", () => {
  it("re-exports emitBudgetEvents from model/budget", () => {
    mockEmitBudgetEvents.mockReturnValue({ ok: true });
    const payload = { emit: null, state: {}, budget: {}, totalTokens: 0, totalCostUSD: 0 };

    expect(emitBudgetEvents).toBe(mockEmitBudgetEvents);
    expect(emitBudgetEvents(payload)).toEqual({ ok: true });
    expect(mockEmitBudgetEvents).toHaveBeenCalledWith(payload);
  });
});

describe("ensureBudgetState", () => {
  it("re-exports ensureBudgetState from model/budget", () => {
    mockEnsureBudgetState.mockReturnValue({ warnedTokens: false });
    const state = {};

    expect(ensureBudgetState).toBe(mockEnsureBudgetState);
    expect(ensureBudgetState(state)).toEqual({ warnedTokens: false });
    expect(mockEnsureBudgetState).toHaveBeenCalledWith(state);
  });
});

describe("estimateCostUSDDelta", () => {
  it("re-exports estimateCostUSDDelta from model/pricing", () => {
    mockEstimateCostUSDDelta.mockReturnValue(1.5);
    const input = { model: "x", usage: { input: 1, output: 2 }, prices: {} };

    expect(estimateCostUSDDelta).toBe(mockEstimateCostUSDDelta);
    expect(estimateCostUSDDelta(input)).toBe(1.5);
    expect(mockEstimateCostUSDDelta).toHaveBeenCalledWith(input);
  });
});

describe("normalizeTokenUsage", () => {
  it("re-exports normalizeTokenUsage from model/usage", () => {
    mockNormalizeTokenUsage.mockReturnValue({ input: 0, output: 0, total: 0 });
    const usage = { prompt_tokens: 0 };

    expect(normalizeTokenUsage).toBe(mockNormalizeTokenUsage);
    expect(normalizeTokenUsage(usage)).toEqual({ input: 0, output: 0, total: 0 });
    expect(mockNormalizeTokenUsage).toHaveBeenCalledWith(usage);
  });
});

describe("resolveModelPricing", () => {
  it("re-exports resolveModelPricing from model/pricing", () => {
    mockResolveModelPricing.mockReturnValue({ modelKey: "*" });
    const model = "any";
    const prices = { "*": { input: 1, output: 2 } };

    expect(resolveModelPricing).toBe(mockResolveModelPricing);
    expect(resolveModelPricing(model, prices)).toEqual({ modelKey: "*" });
    expect(mockResolveModelPricing).toHaveBeenCalledWith(model, prices);
  });
});

describe("getModelCaller", () => {
  it("returns null when buildBaseCaller returns null", () => {
    mockBuildBaseCaller.mockReturnValue(null);
    const stageApi = { emit: vi.fn() };

    const caller = getModelCaller(stageApi, { usage: "worker" });

    expect(caller).toBeNull();
    expect(mockMakeStageEmitter).toHaveBeenCalledWith(stageApi, "deepsearch");
    expect(mockBuildBaseCaller).toHaveBeenCalledWith(stageApi, { usage: "worker" });
  });

  it("uses default usage and handles null stageApi with empty messages", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const caller = getModelCaller(null);
    const messages = [];
    const result = await caller(messages);

    expect(result).toEqual({ content: "ok" });
    expect(mockBuildBaseCaller).toHaveBeenCalledWith(null, { usage: "worker" });
    expect(base).toHaveBeenCalledWith(messages, {});
  });

  it("flushes before calling base and strips cacheKeyInputs when cache is disabled", async () => {
    const order = [];
    const base = vi.fn(async (messages, opts) => {
      order.push("base");
      return { content: "ok", messages, opts };
    });
    mockBuildBaseCaller.mockReturnValue(base);

    const stageApi = {
      flushCompression: vi.fn(async () => {
        order.push("flush");
      }),
      trajectoryCache: {},
      trajectoryCachePolicy: 123,
    };

    const caller = getModelCaller(stageApi, { usage: "worker" });
    const messages = makeMessages();
    const opts = { cacheKeyInputs: { ignored: true }, temperature: "0", maxTokens: 0 };
    const result = await caller(messages, opts);

    expect(result.content).toBe("ok");
    expect(order).toEqual(["flush", "base"]);
    expect(base).toHaveBeenCalledWith(messages, { temperature: "0", maxTokens: 0 });
  });

  it("tracks token usage, estimates cost, and emits budget events", async () => {
    const emit = vi.fn();
    mockMakeStageEmitter.mockReturnValue(emit);

    const baseResult = {
      content: "ok",
      model: "model-a",
      provider: "mock",
      usage: { prompt_tokens: 1 },
    };
    const base = vi.fn().mockResolvedValue(baseResult);
    mockBuildBaseCaller.mockReturnValue(base);

    mockNormalizeTokenUsage.mockReturnValue({ input: 0, output: -1, total: Number.MAX_SAFE_INTEGER });
    mockEstimateCostUSDDelta.mockReturnValue(4.5);
    mockSafeNumber.mockReturnValue(0);
    mockSafeInt.mockReturnValue(Number.MAX_SAFE_INTEGER);

    const state = {
      userConfig: { budget: {} },
      addTokenUsage: vi.fn(() => ({
        input: 0,
        output: -1,
        total: Number.MAX_SAFE_INTEGER,
        estimatedCostUSD: 0,
      })),
    };

    const caller = getModelCaller({ emit }, { usage: "worker", state });
    const result = await caller(makeMessages("Hi"), { model: "ignored" });

    expect(result).toEqual(baseResult);
    expect(mockNormalizeBudgetConfig).toHaveBeenCalledWith({});
    expect(mockEstimateCostUSDDelta).toHaveBeenCalledWith({
      model: "model-a",
      usage: { input: 0, output: -1, total: Number.MAX_SAFE_INTEGER },
      prices: undefined,
    });
    expect(state.addTokenUsage).toHaveBeenCalledWith({
      input: 0,
      output: -1,
      total: Number.MAX_SAFE_INTEGER,
      estimatedCostUSD: 4.5,
    });
    expect(emit).toHaveBeenCalledWith(
      "deepsearch.token.usage",
      {
        usage: { input: 0, output: -1, total: Number.MAX_SAFE_INTEGER, estimatedCostUSD: 4.5 },
        total: {
          input: 0,
          output: -1,
          total: Number.MAX_SAFE_INTEGER,
          estimatedCostUSD: 0,
        },
        model: "model-a",
        provider: "mock",
      },
      { throttle: false }
    );
    expect(mockEmitBudgetEvents).toHaveBeenCalledWith({
      emit,
      state,
      budget: {},
      totalTokens: Number.MAX_SAFE_INTEGER,
      totalCostUSD: 0,
    });
  });

  it("uses getBudgetConfig when provided and falls back to opts.model", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok", model: 123, usage: { prompt_tokens: 1 } });
    mockBuildBaseCaller.mockReturnValue(base);
    mockNormalizeTokenUsage.mockReturnValue({ input: 1, output: 1, total: 2 });

    const budget = { prices: { "opt-model": { input: 1, output: 1 } } };
    const state = {
      getBudgetConfig: vi.fn(() => budget),
      addTokenUsage: vi.fn(() => ({ input: 1, output: 1, total: 2, estimatedCostUSD: 2 })),
    };

    const caller = getModelCaller({}, { state });
    await caller(makeMessages(), { model: "opt-model" });

    expect(state.getBudgetConfig).toHaveBeenCalledTimes(1);
    expect(mockNormalizeBudgetConfig).not.toHaveBeenCalled();
    expect(mockEstimateCostUSDDelta).toHaveBeenCalledWith({
      model: "opt-model",
      usage: { input: 1, output: 1, total: 2 },
      prices: budget.prices,
    });
  });

  it("uses empty model string when result and opts model are not strings", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok", model: null, usage: { prompt_tokens: 1 } });
    mockBuildBaseCaller.mockReturnValue(base);
    mockNormalizeTokenUsage.mockReturnValue({ input: 1, output: 0, total: 1 });

    const state = {
      userConfig: { budget: { prices: { "": { input: 1, output: 2 } } } },
      addTokenUsage: vi.fn(() => ({ input: 1, output: 0, total: 1, estimatedCostUSD: 1 })),
    };

    const caller = getModelCaller({}, { state });
    await caller(makeMessages(), { model: null });

    expect(mockEstimateCostUSDDelta).toHaveBeenCalledWith({
      model: "",
      usage: { input: 1, output: 0, total: 1 },
      prices: state.userConfig.budget.prices,
    });
  });

  it("skips token tracking when normalizeTokenUsage returns null", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok", usage: { prompt_tokens: 1 } });
    mockBuildBaseCaller.mockReturnValue(base);
    mockNormalizeTokenUsage.mockReturnValue(null);

    const state = { addTokenUsage: vi.fn() };
    const caller = getModelCaller({}, { state });
    await caller(makeMessages());

    expect(state.addTokenUsage).not.toHaveBeenCalled();
    expect(mockEmitBudgetEvents).not.toHaveBeenCalled();
    expect(mockMakeStageEmitter).toHaveBeenCalled();
  });

  it("sanitizes non-finite totals and defaults cost to 0", async () => {
    const emit = vi.fn();
    mockMakeStageEmitter.mockReturnValue(emit);

    const base = vi.fn().mockResolvedValue({ content: "ok", usage: { prompt_tokens: 1 } });
    mockBuildBaseCaller.mockReturnValue(base);
    mockNormalizeTokenUsage.mockReturnValue({ input: 1, output: 2, total: 3 });
    mockSafeNumber.mockReturnValue(undefined);
    mockSafeInt.mockReturnValue(undefined);

    const state = {
      addTokenUsage: vi.fn(() => ({
        input: "1",
        output: Number.NaN,
        total: Number.POSITIVE_INFINITY,
        estimatedCostUSD: "bad",
      })),
    };

    const caller = getModelCaller({}, { state });
    await caller(makeMessages(" "));

    expect(emit).toHaveBeenCalledWith(
      "deepsearch.token.usage",
      {
        usage: { input: 1, output: 2, total: 3, estimatedCostUSD: 0 },
        total: { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
      },
      { throttle: false }
    );
    expect(mockEmitBudgetEvents).toHaveBeenCalledWith({
      emit,
      state,
      budget: undefined,
      totalTokens: 0,
      totalCostUSD: 0,
    });
  });

  it("propagates errors from flushCompression and base caller", async () => {
    const base = vi.fn().mockRejectedValue(new Error("base-fail"));
    mockBuildBaseCaller.mockReturnValue(base);

    const stageApi = {
      flushCompression: vi.fn().mockRejectedValue(new Error("flush-fail")),
    };
    const caller = getModelCaller(stageApi);

    await expect(caller(makeMessages())).rejects.toThrow("flush-fail");
    expect(base).not.toHaveBeenCalled();

    stageApi.flushCompression.mockResolvedValue(undefined);
    await expect(caller(makeMessages())).rejects.toThrow("base-fail");
  });

  it("propagates errors from addTokenUsage", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok", usage: { prompt_tokens: 1 } });
    mockBuildBaseCaller.mockReturnValue(base);
    mockNormalizeTokenUsage.mockReturnValue({ input: 1, output: 0, total: 1 });

    const state = {
      addTokenUsage: vi.fn(() => {
        throw new Error("usage-fail");
      }),
    };

    const caller = getModelCaller({}, { state });
    await expect(caller(makeMessages())).rejects.toThrow("usage-fail");
    expect(mockEmitBudgetEvents).not.toHaveBeenCalled();
  });

  it("uses cacheKeyInputs function from opts and forwards options without it", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const cache = {
      computeKey: vi.fn(() => "key-from-opts"),
      getOrCompute: vi.fn((key, compute) => compute()),
    };

    const stageApi = {
      trajectoryCache: cache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
      trajectoryCacheKeyInputs: vi.fn(() => ({ from: "stage" })),
    };

    const cacheKeyInputs = vi.fn(() => ({ from: "opts" }));
    const caller = getModelCaller(stageApi);
    const messages = makeMessages();

    await caller(messages, { cacheKeyInputs, model: "m", temperature: "0" });

    expect(cacheKeyInputs).toHaveBeenCalledWith(messages, { model: "m", temperature: "0" });
    expect(cache.computeKey).toHaveBeenCalledWith("deepsearch", { from: "opts" }, { model: "m", temperature: "0" });
    expect(cache.getOrCompute).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledWith(messages, { model: "m", temperature: "0" });
  });

  it("uses explicit cacheKeyInputs values including empty and whitespace strings", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const cache = {
      computeKey: vi.fn(() => "key"),
      getOrCompute: vi.fn((key, compute) => compute()),
    };

    const stageApi = {
      trajectoryCache: cache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
      trajectoryCacheKeyInputs: { from: "stage" },
    };

    const caller = getModelCaller(stageApi);
    const messages = makeMessages();

    await caller(messages, { cacheKeyInputs: "" });
    await caller(messages, { cacheKeyInputs: "   " });

    expect(cache.computeKey).toHaveBeenNthCalledWith(1, "deepsearch", "", { model: undefined, temperature: undefined });
    expect(cache.computeKey).toHaveBeenNthCalledWith(2, "deepsearch", "   ", { model: undefined, temperature: undefined });
  });

  it("uses stage-level cacheKeyInputs when opts are undefined", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const cache = {
      computeKey: vi.fn(() => "key-stage"),
      getOrCompute: vi.fn((key, compute) => compute()),
    };

    const stageKeyInputs = vi.fn(() => ({ stage: true }));
    const stageApi = {
      trajectoryCache: cache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
      trajectoryCacheKeyInputs: stageKeyInputs,
    };

    const caller = getModelCaller(stageApi);
    const messages = makeMessages();

    await caller(messages, undefined);

    expect(stageKeyInputs).toHaveBeenCalledWith(messages, {});
    expect(cache.computeKey).toHaveBeenCalledWith("deepsearch", { stage: true }, { model: undefined, temperature: undefined });
  });

  it("defaults cache inputs to messages array for non-array messages", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const cache = {
      computeKey: vi.fn(() => "key-default"),
      getOrCompute: vi.fn((key, compute) => compute()),
    };

    const stageApi = {
      trajectoryCache: cache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
    };

    const caller = getModelCaller(stageApi);

    await caller({ not: "array" }, {});
    await caller([], {});

    expect(cache.computeKey).toHaveBeenNthCalledWith(1, "deepsearch", { messages: [] }, { model: undefined, temperature: undefined });
    expect(cache.computeKey).toHaveBeenNthCalledWith(2, "deepsearch", { messages: [] }, { model: undefined, temperature: undefined });
  });

  it("accepts deep cache inputs and very long message content", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const cache = {
      computeKey: vi.fn(() => "key-deep"),
      getOrCompute: vi.fn((key, compute) => compute()),
    };

    const stageApi = {
      trajectoryCache: cache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
    };

    const caller = getModelCaller(stageApi);
    const hugeText = "x".repeat(100000);
    const deepInputs = makeDeepObject(50);
    const messages = makeMessages(hugeText);

    await caller(messages, { cacheKeyInputs: deepInputs });

    expect(cache.computeKey).toHaveBeenCalledWith("deepsearch", deepInputs, { model: undefined, temperature: undefined });
    expect(base).toHaveBeenCalledWith(messages, {});
  });

  it("handles concurrent calls without shared state", async () => {
    const base = vi.fn(async (messages) => ({ content: messages?.[0]?.content }));
    mockBuildBaseCaller.mockReturnValue(base);

    const stageApi = { flushCompression: vi.fn(() => undefined) };
    const caller = getModelCaller(stageApi);
    const first = caller(makeMessages("first"));
    const second = caller(makeMessages("second"));

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(base).toHaveBeenCalledTimes(2);
    expect(stageApi.flushCompression).toHaveBeenCalledTimes(2);
    expect(firstResult.content).toBe("first");
    expect(secondResult.content).toBe("second");
  });

  it("treats non-object opts as empty options", async () => {
    const base = vi.fn().mockResolvedValue({ content: "ok" });
    mockBuildBaseCaller.mockReturnValue(base);

    const caller = getModelCaller({});
    const messages = makeMessages();
    await caller(messages, "not-an-object");

    expect(base).toHaveBeenCalledWith(messages, {});
  });
});
