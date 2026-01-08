import { describe, it, expect, vi } from "vitest";

import { MockModelClient } from "../../../../js/agents/testing/mock-suite.js";
import {
  buildBaseCaller,
  getModelCaller,
  normalizeTokenUsage,
  resolveModelPricing,
  estimateCostUSDDelta,
  emitBudgetEvents,
  ensureBudgetState,
} from "../../../../js/agents/stages/deepsearch/model.js";

function makeMessages() {
  return [
    { role: "system", content: "You are helpful." },
    { role: "assistant", content: "Acknowledged." },
    { role: "user", content: "What is 2+2?" },
  ];
}

describe("deepsearch/model caller adapter", () => {
  it("buildBaseCaller: supports legacy routerCall(messages, opts) and injects system hint", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({
        content: "ok",
        model: "mock-model",
        provider: "mock",
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    });

    const calls = [];
    async function legacyRouterCall(messages, opts) {
      calls.push({ messages, opts });
      return modelClient.chat({ messages, ...opts });
    }

    const defaultSignal = new AbortController().signal;
    const providedSignal = new AbortController().signal;
    const stageApi = {
      signal: defaultSignal,
      runtimeHints: { system: "SYSTEM_HINT" },
      modelRouter: { call: legacyRouterCall },
    };

    const caller = buildBaseCaller(stageApi, { usage: "worker" });
    expect(typeof caller).toBe("function");

    const messages = makeMessages();
    await caller(messages, { temperature: 0.2, max_tokens: 10, signal: providedSignal });

    expect(calls).toHaveLength(1);
    expect(calls[0].opts).toMatchObject({ usage: "worker", temperature: 0.2, max_tokens: 10, signal: providedSignal });

    expect(messages).toHaveLength(3);
    expect(calls[0].messages).toHaveLength(4);
    expect(calls[0].messages[2]).toMatchObject({ role: "system", content: "SYSTEM_HINT" });
    expect(calls[0].messages[3]).toMatchObject({ role: "user", content: "What is 2+2?" });
  });

  it("buildBaseCaller: supports new routerCall(opts) signature and injects system hint", async () => {
    const modelClient = new MockModelClient({ responses: { default: "ok" } });

    const calls = [];
    async function routerCall(opts) {
      calls.push(opts);
      return modelClient.chat(opts);
    }

    const stageApi = {
      signal: new AbortController().signal,
      runtimeHints: { system: "SYSTEM_HINT" },
      modelRouter: { call: routerCall },
    };

    const caller = buildBaseCaller(stageApi, { usage: "worker" });
    const messages = makeMessages();
    await caller(messages, { temperature: 0.3 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ usage: "worker", temperature: 0.3, signal: stageApi.signal });
    expect(calls[0].messages).toHaveLength(4);
    expect(calls[0].messages[2]).toMatchObject({ role: "system", content: "SYSTEM_HINT" });
  });

  it("buildBaseCaller: falls back to aiApiService.chat({messages, ...}) with system hint injection", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({ content: "ok", usage: { total_tokens: 42 } }),
    });

    const calls = [];
    async function chat(opts) {
      calls.push(opts);
      return modelClient.chat(opts);
    }

    const stageApi = {
      signal: new AbortController().signal,
      runtimeHints: { system: "SYSTEM_HINT" },
      aiApiService: { chat },
    };

    const caller = buildBaseCaller(stageApi, { usage: "worker" });
    const messages = [{ role: "user", content: "Hi" }];
    await caller(messages, { model: "mock" });

    expect(calls).toHaveLength(1);
    expect(calls[0].usage).toBe("worker");
    expect(calls[0].messages).toEqual([
      { role: "system", content: "SYSTEM_HINT" },
      { role: "user", content: "Hi" },
    ]);
  });

  it("normalizeTokenUsage: normalizes across provider payload shapes", () => {
    expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 40 })).toEqual({
      input: 10,
      output: 20,
      total: 40,
    });

    expect(normalizeTokenUsage({ inputTokens: "5", outputTokens: 7 })).toEqual({
      input: 5,
      output: 7,
      total: 12,
    });

    expect(normalizeTokenUsage({ prompt_tokens: -1, completion_tokens: 2 })).toEqual({
      input: 0,
      output: 2,
      total: 2,
    });

    expect(normalizeTokenUsage(null)).toBeNull();
    expect(normalizeTokenUsage({})).toBeNull();
  });

  it("pricing: resolves exact/prefix/* entries and estimates cost delta", () => {
    const prices = {
      "gpt-4o": { input: 1, output: 2 },
      gpt: { input: 9, output: 9 },
      "*": { input: 100, output: 100 },
    };

    expect(resolveModelPricing("gpt-4o", prices)?.modelKey).toBe("gpt-4o");
    expect(resolveModelPricing("gpt-4o-mini", prices)?.modelKey).toBe("gpt-4o");
    expect(resolveModelPricing("unknown-model", prices)?.modelKey).toBe("*");

    expect(
      estimateCostUSDDelta({
        model: "gpt-4o-mini",
        usage: { input: 2000, output: 1000 },
        prices,
      })
    ).toBe(4);
  });

  it("budget: initializes budgetState and emits warning/exceeded events", () => {
    const state = {};
    expect(ensureBudgetState(state)).toMatchObject({
      warnedTokens: false,
      warnedCost: false,
      exceededTokens: false,
      exceededCost: false,
    });

    const emit = vi.fn();
    const budget = { maxTokens: 100, maxCostUSD: 1, warnAt: 0.8, action: "warn" };
    const res1 = emitBudgetEvents({ emit, state, budget, totalTokens: 90, totalCostUSD: 0.9 });
    expect(res1).toEqual({ warningReasons: ["tokens", "cost"], exceededReasons: [] });

    const res2 = emitBudgetEvents({ emit, state, budget, totalTokens: 120, totalCostUSD: 1.2 });
    expect(res2).toEqual({ warningReasons: [], exceededReasons: ["tokens", "cost"] });

    const names = emit.mock.calls.map(([name]) => name);
    expect(names).toContain("deepsearch.budget.warning");
    expect(names).toContain("deepsearch.budget.exceeded");
  });

  it("getModelCaller: normalizes usage, estimates cost, and emits token/budget events (no cache)", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({
        content: "ok",
        model: "unit-test-model-v2",
        provider: "mock",
        usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
      }),
    });

    const routerCalls = [];
    async function routerCall(opts) {
      routerCalls.push(opts);
      return modelClient.chat(opts);
    }

    const emitted = [];
    const emit = vi.fn((name, record) => emitted.push({ name, record }));
    const stageApi = {
      signal: new AbortController().signal,
      runtimeHints: { system: "SYSTEM_HINT" },
      modelRouter: { call: routerCall },
      emit,
    };

    const state = {
      userConfig: {
        budget: {
          maxTokens: 100,
          maxCostUSD: 0.1,
          warnAt: 0.8,
          prices: { "unit-test-model": { input: 1, output: 2 } },
        },
      },
      addTokenUsage: vi.fn((delta) => ({
        input: delta.input,
        output: delta.output,
        total: delta.total,
        estimatedCostUSD: delta.estimatedCostUSD,
      })),
    };

    const caller = getModelCaller(stageApi, { usage: "worker", state });
    expect(typeof caller).toBe("function");

    const messages = [{ role: "user", content: "Hi" }];
    const result = await caller(messages, { temperature: 0.2, cacheKeyInputs: { ignored: true } });

    expect(result.content).toBe("ok");

    expect(routerCalls).toHaveLength(1);
    expect(routerCalls[0].cacheKeyInputs).toBeUndefined();

    expect(state.addTokenUsage).toHaveBeenCalledTimes(1);
    expect(state.addTokenUsage.mock.calls[0][0]).toMatchObject({
      input: 2000,
      output: 1000,
      total: 3000,
      estimatedCostUSD: 4,
    });

    const names = emitted.map((e) => e.name);
    expect(names).toContain("deepsearch.token.usage");
    expect(names).toContain("deepsearch.budget.warning");
    expect(names).toContain("deepsearch.budget.exceeded");

    const tokenEvt = emitted.find((e) => e.name === "deepsearch.token.usage");
    expect(tokenEvt.record.payload.usage).toEqual({ input: 2000, output: 1000, total: 3000, estimatedCostUSD: 4 });
    expect(tokenEvt.record.payload.total.total).toBe(3000);
    expect(tokenEvt.record.payload.model).toBe("unit-test-model-v2");
    expect(tokenEvt.record.payload.provider).toBe("mock");

    expect(state.L2?.budgetState?.warnedTokens).toBe(true);
    expect(state.L2?.budgetState?.exceededTokens).toBe(true);
  });

  it("getModelCaller: skips token tracking when state has no addTokenUsage", async () => {
    const modelClient = new MockModelClient({ responses: { default: "ok" } });

    const routerCalls = [];
    async function routerCall(opts) {
      routerCalls.push(opts);
      return modelClient.chat(opts);
    }

    const emit = vi.fn();
    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      emit,
    };

    const state = { userConfig: { budget: { maxTokens: 10, maxCostUSD: 1 } } };
    const caller = getModelCaller(stageApi, { usage: "worker", state });
    await caller([{ role: "user", content: "Hi" }], { cacheKeyInputs: { ignored: true } });

    expect(routerCalls).toHaveLength(1);
    expect(routerCalls[0].cacheKeyInputs).toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it("getModelCaller: does not emit or track when usage cannot be normalized", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({ content: "ok", usage: {} }),
    });

    async function routerCall(opts) {
      return modelClient.chat(opts);
    }

    const emit = vi.fn();
    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      emit,
    };

    const state = {
      userConfig: { budget: { prices: { "*": { input: 1, output: 1 } } } },
      addTokenUsage: vi.fn(),
    };

    const caller = getModelCaller(stageApi, { usage: "worker", state });
    await caller([{ role: "user", content: "Hi" }]);

    expect(state.addTokenUsage).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("getModelCaller: uses opts.model for pricing when result.model is not a string", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({
        content: "ok",
        model: 123,
        provider: "mock",
        usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 },
      }),
    });

    async function routerCall(opts) {
      return modelClient.chat(opts);
    }

    const emitted = [];
    const emit = vi.fn((name, record) => emitted.push({ name, record }));
    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      emit,
    };

    const state = {
      userConfig: { budget: { prices: { "priced-model": { input: 1, output: 2 } } } },
      addTokenUsage: vi.fn((delta) => ({
        input: delta.input,
        output: delta.output,
        total: delta.total,
        estimatedCostUSD: delta.estimatedCostUSD,
      })),
    };

    const caller = getModelCaller(stageApi, { usage: "worker", state });
    await caller([{ role: "user", content: "Hi" }], { model: "priced-model-v1" });

    expect(state.addTokenUsage).toHaveBeenCalledTimes(1);
    expect(state.addTokenUsage.mock.calls[0][0]).toMatchObject({ estimatedCostUSD: 3 });

    const tokenEvt = emitted.find((e) => e.name === "deepsearch.token.usage");
    expect(tokenEvt).toBeTruthy();
    expect(tokenEvt.record.payload.model).toBeUndefined();
    expect(tokenEvt.record.payload.provider).toBe("mock");
  });

  it("getModelCaller: does not throttle deepsearch.token.usage events", async () => {
    const modelClient = new MockModelClient({
      handler: async () => ({
        content: "ok",
        model: "unit-test-model",
        provider: "mock",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    });

    async function routerCall(opts) {
      return modelClient.chat(opts);
    }

    const emit = vi.fn();
    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      emit,
    };

    let total = { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
    const state = {
      userConfig: { budget: { prices: { "unit-test-model": { input: 1, output: 1 } } } },
      addTokenUsage: vi.fn((delta) => {
        total = {
          input: total.input + delta.input,
          output: total.output + delta.output,
          total: total.total + delta.total,
          estimatedCostUSD: total.estimatedCostUSD + (delta.estimatedCostUSD ?? 0),
        };
        return total;
      }),
    };

    const caller = getModelCaller(stageApi, { usage: "worker", state });
    const messages = [{ role: "user", content: "Hi" }];
    await caller(messages);
    await caller(messages);

    const tokenUsageCalls = emit.mock.calls.filter(([name]) => name === "deepsearch.token.usage");
    expect(tokenUsageCalls).toHaveLength(2);
  });

  it("getModelCaller: uses trajectory cache key selection and flushCompression barrier", async () => {
    const modelClient = new MockModelClient({ responses: { default: "ok" } });

    const order = [];
    const routerCalls = [];
    async function routerCall(opts) {
      order.push("routerCall");
      routerCalls.push(opts);
      return modelClient.chat(opts);
    }

    const cacheStore = new Map();
    const trajectoryCache = {
      computeKey: vi.fn((stageName, inputs, meta) => {
        order.push("computeKey");
        return `${stageName}:${JSON.stringify(inputs)}:${String(meta?.model || "")}:${String(meta?.temperature ?? "")}`;
      }),
      getOrCompute: vi.fn(async (key, compute) => {
        order.push("getOrCompute");
        if (cacheStore.has(key)) return cacheStore.get(key);
        const valuePromise = Promise.resolve().then(compute);
        cacheStore.set(key, valuePromise);
        return valuePromise;
      }),
    };

    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      trajectoryCache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
      flushCompression: vi.fn(async () => {
        order.push("flushCompression");
      }),
    };

    const caller = getModelCaller(stageApi, { usage: "worker" });
    const cacheKeyInputs = vi.fn((messages, opts) => ({ prompt: messages[0]?.content, model: opts?.model }));

    const messages = [{ role: "user", content: "Hi" }];
    await caller(messages, { model: "gpt-4o-mini", temperature: 0.1, cacheKeyInputs, extra: 123 });
    await caller(messages, { model: "gpt-4o-mini", temperature: 0.1, cacheKeyInputs, extra: 123 });

    expect(stageApi.flushCompression).toHaveBeenCalledTimes(2);
    expect(cacheKeyInputs).toHaveBeenCalledTimes(2);
    expect(trajectoryCache.computeKey).toHaveBeenCalledTimes(2);
    expect(trajectoryCache.getOrCompute).toHaveBeenCalledTimes(2);
    expect(routerCalls).toHaveLength(1);
    expect(routerCalls[0].cacheKeyInputs).toBeUndefined();

    const firstFlushIdx = order.indexOf("flushCompression");
    const firstRouterIdx = order.indexOf("routerCall");
    expect(firstFlushIdx).toBeGreaterThan(-1);
    expect(firstRouterIdx).toBeGreaterThan(-1);
    expect(firstFlushIdx).toBeLessThan(firstRouterIdx);
  });

  it("getModelCaller: falls back to stageApi.trajectoryCacheKeyInputs when opts.cacheKeyInputs is absent", async () => {
    const modelClient = new MockModelClient({ responses: { default: "ok" } });

    const routerCalls = [];
    async function routerCall(opts) {
      routerCalls.push(opts);
      return modelClient.chat(opts);
    }

    const cacheStore = new Map();
    const trajectoryCache = {
      computeKey: vi.fn((stageName, inputs, meta) => `${stageName}:${JSON.stringify(inputs)}:${String(meta?.model || "")}`),
      getOrCompute: vi.fn(async (key, compute) => {
        if (cacheStore.has(key)) return cacheStore.get(key);
        const value = await compute();
        cacheStore.set(key, value);
        return value;
      }),
    };

    const stageApi = {
      signal: new AbortController().signal,
      modelRouter: { call: routerCall },
      trajectoryCache,
      trajectoryCachePolicy: "share",
      trajectoryCacheStageName: "deepsearch",
      trajectoryCacheKeyInputs: vi.fn((messages, opts) => ({ prompt: messages[0]?.content, extra: opts?.extra })),
    };

    const caller = getModelCaller(stageApi, { usage: "worker" });
    const messages = [{ role: "user", content: "Hi" }];
    await caller(messages, { model: "gpt-4o-mini", extra: 123 });

    expect(stageApi.trajectoryCacheKeyInputs).toHaveBeenCalledTimes(1);
    expect(trajectoryCache.computeKey).toHaveBeenCalledWith("deepsearch", { prompt: "Hi", extra: 123 }, { model: "gpt-4o-mini", temperature: undefined });
    expect(routerCalls).toHaveLength(1);
  });

  it("getModelCaller: returns null when stageApi provides no model service", () => {
    const stageApi = { signal: new AbortController().signal };
    expect(getModelCaller(stageApi)).toBeNull();
  });
});
