import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRouter } from "../../../js/agents/llm/model-router.js";
import { TokenBucketRateLimiter, loadRateLimitConfig, normalizeRateLimitConfig } from "../../../js/agents/llm/rate-limit.js";
import { ModelTier } from "../../../js/agents/runtime/routing/performance-router.js";

import { createCaptureLogger, createFakeTime, createMockProvider, createMockStorage, withPatchedConsole } from "./vitest-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agents/llm/model-router", () => {
  it("usage-based selection picks the first healthy candidate (priority order)", async () => {
    const time = createFakeTime(0);
    const { provider, calls } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }],
        m2: [{ content: "ok-m2" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out.content).toBe("ok-m1");
    expect(out.model).toBe("m1");
    expect(out.provider).toBe("mock");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("m1");
  });

  it("round-robin cursor survives model list reordering (cursor stored as model id)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }],
        m2: [{ content: "ok-m2" }],
        m3: [{ content: "ok-m3" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
        { id: "m3", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2", "m3"] },
      providers: { mock: provider },
      strategy: "round_robin",
      time,
    });

    router._rrNextIndexByUsage.set("worker", "m2");
    const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out1.model).toBe("m2");
    expect(router._rrNextIndexByUsage.get("worker")).toBe("m3");

    // Reorder candidates; the cursor should still start from "m3".
    router._usageConfig.worker = ["m3", "m2", "m1"];
    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi2" }] });
    expect(out2.model).toBe("m3");
  });

  it("persistRoundRobin reads/writes cursor via injected storage", async () => {
    const time = createFakeTime(0);
    const { store, storage } = createMockStorage();
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }],
        m2: [{ content: "ok-m2" }],
      },
    });

    const key = "rr_test_vitest_v1";
    const router1 = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "round_robin",
      persistRoundRobin: true,
      roundRobinStorageKey: key,
      storage,
      time,
    });

    const out1 = await router1.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out1.model).toBe("m1");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(store.get(key)).toContain("m2");

    const router2 = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "round_robin",
      persistRoundRobin: true,
      roundRobinStorageKey: key,
      storage,
      time,
    });

    const out2 = await router2.call({ usage: "worker", messages: [{ role: "user", content: "hi2" }] });
    expect(out2.model).toBe("m2");
  });

  it("debug=false is silent even with an injected logger", async () => {
    const time = createFakeTime(0);
    const { logger } = createCaptureLogger();
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      debug: false,
      logger,
      time,
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out.model).toBe("m1");
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("debug=true uses injected logger and logs try/fail/failover/ok", async () => {
    const time = createFakeTime(0);
    const { logger, calls: logs } = createCaptureLogger();
    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: new Error("boom") }],
        good: [{ content: "ok-good" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["bad", "good"] },
      providers: { mock: provider },
      debug: true,
      logger,
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("good");

    expect(logs.some((c) => c.level === "debug" && c.msg.includes("try bad"))).toBe(true);
    expect(logs.some((c) => c.level === "warn" && c.msg.includes("fail bad"))).toBe(true);
    expect(logs.some((c) => c.level === "info" && c.msg.includes("failover bad -> good"))).toBe(true);
    expect(logs.some((c) => c.level === "debug" && c.msg.includes("ok good"))).toBe(true);
  });

  it("capability tag filtering skips non-vision model when images present", async () => {
    const time = createFakeTime(0);
    const { provider, calls } = createMockProvider({
      time,
      behaviors: {
        textOnly: [{ throw: new Error("should-not-be-called") }],
        visionOK: [{ content: "ok-vision" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "textOnly", provider: "mock", tags: ["text"], limits: {} },
        { id: "visionOK", provider: "mock", tags: ["text", "vision"], limits: {} },
      ],
      usageConfig: { vision: ["textOnly", "visionOK"] },
      providers: { mock: provider },
      time,
    });

    const out = await router.call({
      usage: "vision",
      messages: [{ role: "user", content: "describe" }],
      images: [{ type: "image/png", data: "base64:xxx" }],
    });

    expect(out.content).toBe("ok-vision");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("visionOK");
  });

  it("failover emits events and marks model unhealthy", async () => {
    const time = createFakeTime(1000);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: new Error("boom") }],
        good: [{ content: "ok-good" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { planner: ["bad", "good"] },
      providers: { mock: provider },
      cooldownMs: 60_000,
      time,
      strategy: "priority",
    });

    const onUnhealthy = vi.fn();
    const onFailover = vi.fn();
    router.on("model.unhealthy", onUnhealthy);
    router.on("model.failover", onFailover);

    const out = await router.call({ usage: "planner", messages: [{ role: "user", content: "plan" }] });
    expect(out.model).toBe("good");

    expect(onUnhealthy).toHaveBeenCalled();
    expect(onFailover).toHaveBeenCalled();
    expect(onUnhealthy.mock.calls[0][0]).toMatchObject({ modelId: "bad", provider: "mock" });
    expect(onFailover.mock.calls[0][0]).toMatchObject({ fromModelId: "bad", toModelId: "good" });

    const h = router.getHealth("bad");
    expect(h?.unhealthyUntilMs).toBeGreaterThan(1000);
    expect(router.isAvailable("bad")).toBe(false);
  });

  it("401/403 disables model permanently until resetUnhealthy()", async () => {
    const time = createFakeTime(0);
    const authErr = new Error("Unauthorized");
    authErr.status = 401;

    const { provider, calls } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: authErr }],
        good: [{ content: "ok" }, { content: "ok2" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["bad", "good"] },
      providers: { mock: provider },
      time,
    });

    const onUnhealthy = vi.fn();
    router.on("model.unhealthy", onUnhealthy);

    const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out1.model).toBe("good");
    expect(out1.content).toBe("ok");
    expect(calls.map((c) => c.model)).toEqual(["bad", "good"]);

    const h = router.getHealth("bad");
    expect(h?.disabled).toBe(true);
    expect(h?.unhealthyUntilMs).toBe(0);
    expect(router.isAvailable("bad")).toBe(false);
    expect(onUnhealthy.mock.calls.some((c) => c[0]?.modelId === "bad" && c[0]?.disabled === true)).toBe(true);

    time.advance(600_000);
    expect(router.isAvailable("bad")).toBe(false);

    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
    expect(out2.model).toBe("good");
    expect(out2.content).toBe("ok2");
    expect(calls.map((c) => c.model)).toEqual(["bad", "good", "good"]);

    router.resetUnhealthy("bad");
    expect(router.isAvailable("bad")).toBe(true);
  });

  it("exponential cooldown backoff increases cooldownMs and backoffLevel", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: { m1: [{ throw: new Error("down-1") }, { throw: new Error("down-2") }] },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      baseCooldownMs: 1000,
      maxCooldownMs: 5000,
      backoffMultiplier: 2,
      time,
      strategy: "priority",
    });

    const unhealthyEvents = [];
    router.on("model.unhealthy", (e) => unhealthyEvents.push(e));

    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthyEvents[0]).toMatchObject({ cooldownMs: 1000, backoffLevel: 0 });
    expect(router.getHealth("m1")?.failures).toBe(1);

    time.advance(1001);
    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthyEvents[1]).toMatchObject({ cooldownMs: 2000, backoffLevel: 1 });
    expect(router.getHealth("m1")?.failures).toBe(2);
  });

  it("waits for the shortest cooldown (<30s) and retries once when all models are in cooldown", async () => {
    const time = createFakeTime(0);
    const { provider, calls } = createMockProvider({
      time,
      behaviors: { m1: [{ throw: new Error("down") }, { content: "m1-back" }] },
    });

    const { logger, calls: logs } = createCaptureLogger();
    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      cooldownMs: 10_000,
      time,
      debug: true,
      logger,
      strategy: "priority",
    });

    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /All models failed/
    );
    expect(router.isAvailable("m1")).toBe(false);
    expect(calls).toHaveLength(1);

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
    expect(out.model).toBe("m1");
    expect(out.content).toBe("m1-back");
    expect(calls).toHaveLength(2);
    expect(time.now()).toBeGreaterThanOrEqual(10_000);
    expect(logs.some((c) => c.level === "info" && c.msg.includes("waiting"))).toBe(true);
    expect(logs.some((c) => c.level === "info" && c.msg.includes("retry after cooldown wait"))).toBe(true);
  });

  it("round_robin distributes calls across models", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }, { content: "ok-m1" }, { content: "ok-m1" }, { content: "ok-m1" }],
        m2: [{ content: "ok-m2" }, { content: "ok-m2" }, { content: "ok-m2" }],
        m3: [{ content: "ok-m3" }, { content: "ok-m3" }, { content: "ok-m3" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
        { id: "m3", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2", "m3"] },
      providers: { mock: provider },
      time,
      strategy: "round_robin",
    });

    const seen = [];
    for (let i = 0; i < 10; i++) {
      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `hi-${i}` }] });
      seen.push(out.model);
    }

    const counts = new Map();
    for (const m of seen) counts.set(m, (counts.get(m) || 0) + 1);
    const values = [...counts.values()];
    expect(values.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  it("priority strategy always uses the first healthy candidate", async () => {
    const time = createFakeTime(0);
    const { provider, calls } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }, { content: "ok-m1-2" }, { content: "ok-m1-3" }],
        m2: [{ content: "ok-m2" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "priority",
      time,
    });

    for (let i = 0; i < 3; i++) {
      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] });
      expect(out.model).toBe("m1");
    }
    expect(calls.every((c) => c.model === "m1")).toBe(true);
  });

  it("round_robin pointer skips failed model and continues rotation", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: new Error("down") }],
        m2: [{ content: "ok-m2" }],
        m3: [{ content: "ok-m3" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
        { id: "m3", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2", "m3"] },
      providers: { mock: provider },
      time,
    });

    const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
    expect(out1.model).toBe("m2");
    expect(router.isAvailable("m1")).toBe(false);

    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
    expect(out2.model).toBe("m3");
  });

  it("throws when all candidates fail", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        a: [{ throw: new Error("a") }],
        b: [{ throw: new Error("b") }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "a", provider: "mock", tags: ["text"], limits: {} },
        { id: "b", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { analyst: ["a", "b"] },
      providers: { mock: provider },
      time,
    });

    await expect(router.call({ usage: "analyst", messages: [{ role: "user", content: "analyze" }] })).rejects.toThrow(
      /All models failed for usage: analyst/
    );
  });

  it("validates configs early (usageConfig/strategy/debug/logger)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { ok: [{ content: "ok" }] } });

    expect(
      () =>
        new ModelRouter({
          models: [{ id: "ok", provider: "mock", tags: ["text"], limits: {} }],
          // @ts-expect-error: invalid config for test
          usageConfig: { worker: "ok" },
          providers: { mock: provider },
        })
    ).toThrow(/UsageConfig/);

    expect(() => new ModelRouter({ strategy: "nope" })).toThrow(/strategy/i);
    expect(() => new ModelRouter({ debug: "yes" })).toThrow(/debug must be a boolean/i);

    expect(() => new ModelRouter({ debug: true, logger: { debug: () => {} } })).toThrow(/logger/i);
    expect(() => new ModelRouter({ debug: true, logger: null })).toThrow(/logger must be an object/i);
  });

  it("debug=true without logger does not call console.debug/info/warn/error", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });

    const consoleDebug = vi.spyOn(console, "debug");
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    const consoleError = vi.spyOn(console, "error");

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      debug: true,
      time,
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out.model).toBe("m1");

    expect(consoleDebug).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("supports providers Map + usageTags and exposes health helpers", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        slow: [{ content: "slow" }],
        fast: [{ content: "fast" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "slow", provider: "mock", tags: ["text"], limits: {} },
        { id: "fast", provider: "mock", tags: ["text", "fast"], limits: {} },
      ],
      usageConfig: { worker: ["slow", "fast"] },
      usageTags: { worker: ["fast"], "   ": ["cheap"] },
      providers: new Map([["mock", provider]]),
      time,
      strategy: "priority",
    });

    expect(router.getModelEntry("fast")?.id).toBe("fast");
    expect(router.getModelEntry("   ")).toBe(null);
    expect(router.getHealth("fast")).toBe(null);

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("fast");
  });

  it("resetUnhealthy clears cooldown; EventEmitter off/removeAllListeners are safe", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: new Error("boom") }],
        good: [{ content: "ok" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["bad", "good"] },
      providers: { mock: provider },
      cooldownMs: 60_000,
      time,
      strategy: "priority",
    });

    const handler = vi.fn();
    router.on("model.unhealthy", handler);
    router.off("model.unhealthy", () => {});
    router.off("model.unhealthy", handler);

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("good");
    expect(handler).not.toHaveBeenCalled();

    expect(router.isAvailable("bad")).toBe(false);
    router.resetUnhealthy("bad");
    expect(router.isAvailable("bad")).toBe(true);
    router.resetUnhealthy("   ");

    router.on("model.failover", () => {});
    router.removeAllListeners("model.failover");
    router.on("model.failover", () => {});
    router.removeAllListeners();
  });

  it("rateLimit waits between calls (and Infinity disables waiting)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok1" }, { content: "ok2" }],
        m2: [{ content: "ok" }, { content: "ok" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: { rateLimit: 2 } },
        { id: "m2", provider: "mock", tags: ["text"], limits: { rateLimit: Infinity } },
      ],
      usageConfig: { worker: ["m1"], planner: ["m2"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
    });

    const before = time.now();
    await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
    await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
    expect(time.now() - before).toBeGreaterThanOrEqual(500);

    const before2 = time.now();
    await router.call({ usage: "planner", messages: [{ role: "user", content: "a" }] });
    await router.call({ usage: "planner", messages: [{ role: "user", content: "b" }] });
    expect(time.now() - before2).toBe(0);
  });

  it("throws clear errors for unknown model and missing provider; _getProvider validates id", async () => {
    const routerUnknownModel = new ModelRouter({
      models: [{ id: "m1", provider: "p1", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["ghost"] },
      providers: {},
    });

    await expect(routerUnknownModel.call({ usage: "worker", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /Unknown model id: ghost/
    );

    const routerMissingProvider = new ModelRouter({
      models: [{ id: "m1", provider: "p1", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: null,
    });
    expect(routerMissingProvider._getProvider(" ")).toBe(null);
    await expect(routerMissingProvider.call({ usage: "worker", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /Missing provider: p1/
    );
  });

  it("latency_optimized uses PerformanceRouter to prefer lower latency endpoint over time", async () => {
    const time = createFakeTime(0);
    const provider = {
      id: "mock",
      chat: vi.fn(async ({ model } = {}) => {
        // Simulate different latencies via injected time.
        if (model === "m1") time.advance(100);
        if (model === "m2") time.advance(10);
        return { content: `ok-${model}` };
      }),
    };

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
      time,
    });

    const seen = [];
    for (let i = 0; i < 3; i++) {
      const out = await router.call({
        usage: "worker",
        messages: [
          {
            role: "user",
            // Exercise extractPromptText with non-trivial content types.
            content: [{ text: `hi-${i}` }, { content: `more-${i}` }],
          },
        ],
      });
      seen.push(out.model);
    }

    // With PerformanceRouter feedback, routing should converge to the lower latency endpoint ("m2").
    expect(seen.at(-1)).toBe("m2");
  });

  it("tierResolver is best-effort (invalid/throwing resolvers fall back)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });

    const resolver = vi
      .fn()
      .mockImplementationOnce(() => "nope")
      .mockImplementationOnce(() => {
        throw new Error("resolver boom");
      })
      .mockImplementationOnce(() => ModelTier.FAST);

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
      tierResolver: resolver,
    });

    // Directly exercise tier resolution; this is a unit test for routing inputs.
    const entry = router.getModelEntry("m1");
    expect(router._resolveEndpointTier("m1", entry, { usage: "worker" })).toBe(ModelTier.POWER);
    expect(router._resolveEndpointTier("m1", entry, { usage: "worker" })).toBe(ModelTier.POWER);
    expect(router._resolveEndpointTier("m1", entry, { usage: "worker" })).toBe(ModelTier.FAST);
  });

  it("supports a custom retryStrategy (execute wrapper) and uses limiter.blockFor(retryAfterMs) on failure", async () => {
    const time = createFakeTime(0);
    const retryStrategy = { execute: vi.fn(async (fn) => fn()) };

    const retryAfterErr = new Error("rate limited");
    retryAfterErr.retryAfterMs = 1000;

    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: retryAfterErr }],
        good: [{ content: "ok" }],
      },
    });

    const router = new ModelRouter({
      models: [
        // Enable per-model limiter for the retryAfterMs path.
        { id: "bad", provider: "mock", tags: ["text"], limits: { rateLimit: 10 } },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["bad", "good"] },
      providers: { mock: provider },
      time,
      retryStrategy,
      strategy: "priority",
    });

    const limiter = router._getRateLimiter(router.getModelEntry("bad"));
    const blockSpy = limiter ? vi.spyOn(limiter, "blockFor") : null;

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("good");
    expect(retryStrategy.execute).toHaveBeenCalled();
    expect(blockSpy).not.toBeNull();
    expect(blockSpy).toHaveBeenCalledWith(1000);
  });

  it("circuit breaker opens after repeated failures and then skips the endpoint", async () => {
    const time = createFakeTime(0);
    const { provider, calls } = createMockProvider({
      time,
      behaviors: {
        bad: [
          { throw: new Error("down") },
          { throw: new Error("down") },
          { throw: new Error("down") },
          { throw: new Error("down") },
          { throw: new Error("down") },
          { throw: new Error("down") }, // after reset, we should still fail over
        ],
        good: [{ content: "ok" }, { content: "ok" }, { content: "ok" }, { content: "ok" }, { content: "ok" }, { content: "ok" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["bad", "good"] },
      providers: { mock: provider },
      // Keep unhealthy cooldown minimal so repeated calls can reach the circuit breaker threshold quickly.
      baseCooldownMs: 1,
      maxCooldownMs: 1,
      time,
      strategy: "priority",
    });

    const stateChanges = [];
    router.on("circuit.stateChange", (e) => stateChanges.push(e));

    // First 5 calls: attempt "bad" then fail over to "good"; advance time so "bad" becomes eligible again.
    for (let i = 0; i < 5; i++) {
      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] });
      expect(out.model).toBe("good");
      time.advance(2);
    }

    // Circuit breaker should have transitioned to OPEN at least once.
    expect(stateChanges.some((e) => e.to === "open")).toBe(true);
    expect(router.getCircuitBreakerState("bad")?.state).toBe("open");

    const before = calls.length;
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "after-open" }] });
    expect(out.model).toBe("good");
    const afterCalls = calls.slice(before).map((c) => c.model);
    expect(afterCalls).toEqual(["good"]);

    router.resetCircuitBreaker("bad");
    time.advance(2);
    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "after-reset" }] });
    expect(out2.model).toBe("good");
    // "bad" is attempted again after reset (then fails over).
    expect(calls.slice(-2).map((c) => c.model)).toEqual(["bad", "good"]);
  });

  it("is robust to missing console methods when patching globals (noop logger remains callable)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: new Error("boom") }],
        good: [{ content: "ok" }],
      },
    });

    await withPatchedConsole({ debug: undefined, info: undefined, warn: undefined, error: undefined }, async () => {
      const router = new ModelRouter({
        models: [
          { id: "bad", provider: "mock", tags: ["text"], limits: {} },
          { id: "good", provider: "mock", tags: ["text"], limits: {} },
        ],
        usageConfig: { worker: ["bad", "good"] },
        providers: { mock: provider },
        time,
        debug: true,
      });

      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
      expect(out.model).toBe("good");

      // Ensure the fallback logger methods are callable even if the global console is patched.
      router._logger.error("covered");
      router._logger.debug("covered");
      router._logger.info("covered");
      router._logger.warn("covered");
    });
  });

  it("loads legacy numeric round-robin cursor values from storage", async () => {
    const time = createFakeTime(0);
    const { store, storage } = createMockStorage({
      rr_num: JSON.stringify({ worker: 1 }),
    });
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok-m1" }],
        m2: [{ content: "ok-m2" }],
        m3: [{ content: "ok-m3" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
        { id: "m3", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2", "m3"] },
      providers: { mock: provider },
      strategy: "round_robin",
      persistRoundRobin: true,
      roundRobinStorageKey: "rr_num",
      storage,
      time,
    });

    expect(store.get("rr_num")).toBeTruthy();
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("m2");
  });

  it("ignores invalid persisted round-robin entries (blank usage keys and negative indices)", async () => {
    const time = createFakeTime(0);
    const { storage } = createMockStorage({
      rr_bad: JSON.stringify({ "   ": "m2", worker: -1 }),
    });
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok-m1" }], m2: [{ content: "ok-m2" }] } });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "round_robin",
      persistRoundRobin: true,
      roundRobinStorageKey: "rr_bad",
      storage,
      time,
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    // With invalid cursor in storage, router falls back to startIndex=0.
    expect(out.model).toBe("m1");
  });

  it("normalizes backoffMultiplier and computeCooldownMs handles Infinity safely", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });

    const r1 = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      backoffMultiplier: 2,
      time,
    });
    expect(r1._backoffMultiplier).toBe(2);

    const r2 = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      backoffMultiplier: 0.5,
      time,
    });
    expect(r2._backoffMultiplier).toBe(1);

    const r3 = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      // Force an overflow in `baseMs * multiplier^level` to cover the non-finite guard.
      baseCooldownMs: 1e308,
      maxCooldownMs: 5000,
      backoffMultiplier: 1e308,
      time,
    });
    expect(r3._backoffMultiplier).toBe(1e308);
    expect(r3._computeCooldownMs(1)).toBe(r3._maxCooldownMs);
  });

  it("resolveRetryStrategy: builds RetryStrategy from config and ignores throwing getters", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      // Plain object => resolveRetryStrategy() should construct a RetryStrategy instance.
      retryStrategy: { maxRetries: 0 },
      time,
    });
    expect(router._retryStrategy && typeof router._retryStrategy.execute === "function").toBe(true);

    const badCfg = {};
    Object.defineProperty(badCfg, "maxRetries", {
      get() {
        throw new Error("boom");
      },
    });

    const router2 = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      retryStrategy: badCfg,
      time,
    });
    expect(router2._retryStrategy).toBe(null);
  });

  it("detects permanent auth errors via nested status and message heuristics (including non-Error throws)", async () => {
    const time = createFakeTime(0);
    const chat = vi.fn(async ({ model } = {}) => {
      if (model === "empty") throw new Error(""); // covers isPermanentAuthError() empty-message path
      if (model === "badNested") throw { response: { status: 403 } };
      if (model === "badString") throw "invalid api key";
      return { content: "ok" };
    });

    const router = new ModelRouter({
      models: [
        { id: "empty", provider: "mock", tags: ["text"], limits: {} },
        { id: "badNested", provider: "mock", tags: ["text"], limits: {} },
        { id: "badString", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["empty", "badNested", "badString", "good"] },
      providers: { mock: { id: "mock", chat } },
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("good");
    expect(chat).toHaveBeenCalledTimes(4);

    expect(router.getHealth("empty")?.disabled).not.toBe(true);
    expect(router.getHealth("badNested")?.disabled).toBe(true);
    expect(router.getHealth("badString")?.disabled).toBe(true);
  });

  it("call() validates inputs and warns on unknown usage types", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });
    const { logger } = createCaptureLogger();

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { weird: ["m1"], empty: [] },
      providers: { mock: provider },
      time,
      debug: true,
      logger,
      strategy: "priority",
    });

    await expect(router.call({ usage: "", messages: [] })).rejects.toThrow(/usage must be a non-empty string/);

    const out = await router.call({ usage: "weird", messages: [] });
    expect(out.model).toBe("m1");
    expect(logger.warn).toHaveBeenCalled();

    await expect(router.call({ usage: "empty", messages: [] })).rejects.toThrow(/No models configured for usage: empty/);
  });

  it("findNextCandidate skips missing-tag and unavailable models when computing failover target", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        bad: [{ throw: new Error("boom") }],
        good: [{ content: "ok-good" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "bad", provider: "mock", tags: ["vision"], limits: {} },
        { id: "textOnly", provider: "mock", tags: ["text"], limits: {} }, // skipped due to missing vision tag
        { id: "cooldown", provider: "mock", tags: ["vision"], limits: {} }, // skipped due to cooldown
        { id: "good", provider: "mock", tags: ["vision"], limits: {} },
      ],
      usageConfig: { vision: ["bad", "textOnly", "cooldown", "good"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
    });

    router.markUnhealthy("cooldown", new Error("down"));

    const failovers = [];
    router.on("model.failover", (e) => failovers.push(e));

    const out = await router.call({
      usage: "vision",
      messages: [{ role: "user", content: "x" }],
      images: [{ type: "image/png", data: "base64:xxx" }],
    });
    expect(out.model).toBe("good");

    expect(failovers.some((e) => e.fromModelId === "bad" && e.toModelId === "good")).toBe(true);
  });

  it("performanceRouting override toggles perf routing regardless of strategy", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: { m1: [{ content: "ok-m1" }], m2: [{ content: "ok-m2" }] },
    });

    const disabled = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {}, weight: 1 },
        { id: "m2", provider: "mock", tags: ["text"], limits: {}, weight: 10 },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
      performanceRouting: false,
      time,
    });
    const sel1 = vi.spyOn(disabled._performanceRouter, "selectEndpoint");
    const out1 = await disabled.call({ usage: "worker", messages: [] });
    expect(out1.model).toBe("m1");
    expect(sel1).not.toHaveBeenCalled();

    const enabled = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {}, weight: 1 },
        { id: "m2", provider: "mock", tags: ["text"], limits: {}, weight: 10 },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "priority",
      performanceRouting: true,
      time,
    });
    const sel2 = vi.spyOn(enabled._performanceRouter, "selectEndpoint");
    const out2 = await enabled.call({ usage: "worker", messages: [] });
    expect(out2.model).toBe("m2");
    expect(sel2).toHaveBeenCalled();
  });

  it("debug+latency_optimized triggers perfRoute debug logging via onRouteDecision()", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }], m2: [{ content: "ok" }] } });
    const { logger, calls: logs } = createCaptureLogger();

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
      debug: true,
      logger,
      time,
    });

    const out = await router.call({ usage: "worker", messages: [] });
    expect(out.model === "m1" || out.model === "m2").toBe(true);
    expect(logs.some((c) => c.level === "debug" && c.msg.includes("perfRoute"))).toBe(true);
  });

  it("performance routing: fails over on error and emits events (covers perf branch catch)", async () => {
    const time = createFakeTime(0);
    const retryAfterErr = new Error("rate limited");
    retryAfterErr.retryAfterMs = 1000;

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: retryAfterErr }],
        m2: [{ content: "ok-m2" }],
      },
    });

    const router = new ModelRouter({
      models: [
        // Weight makes perf router deterministically choose m1 first.
        { id: "m1", provider: "mock", tags: ["text"], limits: { rateLimit: 10 }, weight: 10 },
        { id: "m2", provider: "mock", tags: ["text"], limits: {}, weight: 1 },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
      time,
    });

    const unhealthy = vi.fn();
    const failover = vi.fn();
    router.on("model.unhealthy", unhealthy);
    router.on("model.failover", failover);

    const limiter = router._getRateLimiter(router.getModelEntry("m1"));
    const blockSpy = limiter ? vi.spyOn(limiter, "blockFor") : null;

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("m2");
    expect(unhealthy).toHaveBeenCalled();
    expect(failover).toHaveBeenCalled();
    expect(blockSpy).not.toBeNull();
    expect(blockSpy).toHaveBeenCalledWith(1000);
  });

  it("exposes health helpers for edge cases (blank ids and disabled/healthy transitions)", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, behaviors: { m1: [{ content: "ok" }] } });
    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text", "cheap"], limits: {}, tier: "fast" }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
    });

    expect(router.isAvailable(" ")).toBe(false);
    expect(router.markUnhealthy(" ", new Error("x"))).toBe(null);
    expect(router.disableModel(" ", new Error("x"))).toBe(null);
    expect(router.markHealthy(" ")).toBe(null);
    router.resetUnhealthy("m1"); // no-op: no health record

    router.disableModel("m1", new Error("x"), { reason: "auth" });
    expect(router.getHealth("m1")?.disabled).toBe(true);
    router.markHealthy("m1");
    expect(router.getHealth("m1")?.disabled).toBe(false);

    // Normalize tier from explicit tier + tags/id heuristics.
    const entry = router.getModelEntry("m1");
    expect(router._resolveEndpointTier("m1", entry)).toBe(ModelTier.FAST);
    expect(router._resolveEndpointTier("flash-mini", { tags: [] })).toBe(ModelTier.FAST);
    expect(router._resolveEndpointTier("any", { tags: ["fallback"] })).toBe(ModelTier.FALLBACK);
    expect(router._resolveEndpointTier("any", { tags: ["cheap"] })).toBe(ModelTier.FAST);
  });

  it("cleans up stale circuit breakers and evicts LRU when pool grows beyond limit", async () => {
    const time = createFakeTime(0);
    const router = new ModelRouter({
      models: [],
      usageConfig: {},
      providers: {},
      time,
    });

    // Blank id returns null.
    expect(router._getCircuitBreaker(" ")).toBe(null);

    // No breaker yet.
    expect(router.getCircuitBreakerState("m1")).toBe(null);
    expect(router.getCircuitBreakerState(" ")).toBe(null);

    // Create + then clean up as stale.
    router._getCircuitBreaker("m1");
    expect(router.getCircuitBreakerState("m1")?.state).toBe("closed");
    router._cleanupStaleBreakers(30 * 60_000 + 1);
    expect(router.getCircuitBreakerState("m1")).toBe(null);

    // LRU eviction: fabricate >100 records and ensure the pool is trimmed.
    for (let i = 0; i < 101; i++) {
      router._circuitBreakers.set(`x${i}`, { breaker: {}, lastUsedMs: i });
    }
    router._evictLruBreakers();
    expect(router._circuitBreakers.size).toBeLessThanOrEqual(100);

    router.resetCircuitBreaker(" "); // no-op
  });

  it("_getRateLimiter returns null for invalid/unsupported entries (defensive guards)", async () => {
    const time = createFakeTime(0);
    const router = new ModelRouter({ models: [], usageConfig: {}, providers: {}, time });

    expect(router._getRateLimiter(null)).toBe(null);
    expect(router._getRateLimiter({ id: "x", limits: {} })).toBe(null);
    expect(router._getRateLimiter({ id: "x", limits: { rateLimit: "nope" } })).toBe(null);
    expect(router._getRateLimiter({ id: "x", limits: { rateLimit: -1 } })).toBe(null);
  });

  it("covers additional auth + circuit breaker branches (message heuristics, disabled markUnhealthy, isFailure filters)", async () => {
    const time = createFakeTime(0);
    const provider = {
      id: "mock",
      chat: vi.fn(async ({ model } = {}) => {
        if (model === "m403") throw "403";
        if (model === "unauth") throw "unauthorized";
        if (model === "forbid") throw "forbidden";
        if (model === "apiKeyInvalid") throw "api key is invalid";
        if (model === "authFail") throw "authentication failed";
        return { content: "ok" };
      }),
    };

    const router = new ModelRouter({
      models: [
        { id: "m403", provider: "mock", tags: ["text"], limits: {} },
        { id: "unauth", provider: "mock", tags: ["text"], limits: {} },
        { id: "forbid", provider: "mock", tags: ["text"], limits: {} },
        { id: "apiKeyInvalid", provider: "mock", tags: ["text"], limits: {} },
        { id: "authFail", provider: "mock", tags: ["text"], limits: {} },
        { id: "good", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m403", "unauth", "forbid", "apiKeyInvalid", "authFail", "good"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
      // Use `retry` (not `retryStrategy`) to cover resolveRetryStrategy's alternate config branch.
      retry: { maxRetries: 0 },
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out.model).toBe("good");

    for (const id of ["m403", "unauth", "forbid", "apiKeyInvalid", "authFail"]) {
      expect(router.getHealth(id)?.disabled).toBe(true);
      // markUnhealthy() should no-op for disabled models (returns cooldownMs:null).
      expect(router.markUnhealthy(id, new Error("x"))?.cooldownMs).toBe(null);
    }

    // Circuit breaker isFailure() should ignore AbortError/TIMEOUT/permanent auth errors.
    const breaker = router._getCircuitBreaker("good");
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    await expect(breaker.execute(async () => Promise.reject(abortErr))).rejects.toBe(abortErr);
    const timeoutErr = new Error("Timeout");
    timeoutErr.code = "TIMEOUT";
    await expect(breaker.execute(async () => Promise.reject(timeoutErr))).rejects.toBe(timeoutErr);

    const authErr = new Error("Unauthorized");
    authErr.status = 401;
    await expect(breaker.execute(async () => Promise.reject(authErr))).rejects.toBe(authErr);

    expect(breaker.getStats().failureCount).toBe(0);
  });

  it("legacy cooldownMs keeps constant cooldown across failures", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, defaultOutcome: new Error("down") });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      cooldownMs: 1000,
      time,
      strategy: "priority",
    });

    const unhealthy = [];
    router.on("model.unhealthy", (e) => unhealthy.push(e));

    for (let i = 0; i < 3; i++) {
      await expect(router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] })).rejects.toThrow(
        /All models failed/
      );
      const evt = unhealthy[i];
      expect(evt.backoffLevel).toBe(i);
      expect(evt.cooldownMs).toBe(1000);
      time.advance(1001);
    }
  });

  it("markHealthy resets failures on successful call", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: new Error("down") }, { content: "ok" }, { throw: new Error("down-again") }],
      },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      baseCooldownMs: 1000,
      maxCooldownMs: 5000,
      backoffMultiplier: 2,
      time,
      strategy: "priority",
    });

    const unhealthy = [];
    router.on("model.unhealthy", (e) => unhealthy.push(e));

    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthy[0].cooldownMs).toBe(1000);
    expect(unhealthy[0].backoffLevel).toBe(0);
    expect(router.getHealth("m1")?.failures).toBe(1);

    time.advance(1001);
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
    expect(out.model).toBe("m1");
    expect(out.content).toBe("ok");
    expect(router.getHealth("m1")?.failures).toBe(0);

    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "c" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthy[1].cooldownMs).toBe(1000);
    expect(unhealthy[1].backoffLevel).toBe(0);
  });

  it("unhealthy cooldown recovery retries model after time passes", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ throw: new Error("down") }, { content: "m1-back" }],
        m2: [{ content: "m2-ok" }, { content: "m2-ok2" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text", "fast"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      cooldownMs: 60_000,
      time,
      strategy: "priority",
    });

    const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
    expect(out1.model).toBe("m2");
    expect(router.isAvailable("m1")).toBe(false);

    time.advance(60_001);
    expect(router.isAvailable("m1")).toBe(true);

    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
    expect(out2.model).toBe("m1");
    expect(out2.content).toBe("m1-back");
  });

  it("defaultTime.sleep is callable and toErrorInfo handles non-Error", async () => {
    const { provider } = createMockProvider({ behaviors: { m1: [{ content: "ok" }] } });
    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
    });

    await router._time.sleep(0);
    router.markUnhealthy("m1", "not-an-error");
    expect(router.getHealth("m1")?.lastError?.message).toBeTruthy();
  });

  it("cooldown object config overrides individual params", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({ time, defaultOutcome: new Error("down") });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      cooldown: { baseMs: 5000, maxMs: 20000, multiplier: 3 },
      time,
      strategy: "priority",
    });

    const unhealthy = [];
    router.on("model.unhealthy", (e) => unhealthy.push(e));

    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthy[0].cooldownMs).toBe(5000);

    time.advance(5001);
    await expect(router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] })).rejects.toThrow(/All models failed/);
    expect(unhealthy[1].cooldownMs).toBe(15000);
  });

  it("custom tierResolver overrides default tier detection", async () => {
    const { provider } = createMockProvider({
      behaviors: { m1: [{ content: "ok" }] },
    });

    const tierCalls = [];
    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
      tierResolver: ({ modelId, usage, images }) => {
        tierCalls.push({ modelId, usage, hasImages: !!images?.length });
        return "fast";
      },
    });

    await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(tierCalls.length).toBeGreaterThan(0);
    expect(tierCalls[0].modelId).toBe("m1");
    expect(tierCalls[0].usage).toBe("worker");
  });

  it("retry config retries transient failures", async () => {
    const time = createFakeTime(0);
    let callCount = 0;
    const provider = {
      id: "mock",
      chat: vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          const err = new Error("transient");
          err.status = 503;
          throw err;
        }
        return { content: "ok" };
      }),
    };

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out.content).toBe("ok");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("handles complex message content structures", async () => {
    const { provider } = createMockProvider({
      behaviors: { m1: [{ content: "ok" }] },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      strategy: "latency_optimized",
    });

    const out = await router.call({
      usage: "worker",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: [{ type: "text", text: "Hello" }, { type: "text", text: "World" }] },
        { role: "assistant", content: "" },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,abc" } }] },
        { role: "user", content: "Final question" },
      ],
    });
    expect(out.content).toBe("ok");
  });

  it("disableModel permanently disables until reset", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: { m1: [{ content: "ok" }] },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
    });

    router.disableModel("m1", new Error("manual disable"), { reason: "test" });
    const h = router.getHealth("m1");
    expect(h?.disabled).toBe(true);
    expect(h?.disabledReason).toBe("test");
    expect(h?.unhealthyUntilMs).toBe(0);
    expect(router.isAvailable("m1")).toBe(false);

    time.advance(1_000_000);
    expect(router.isAvailable("m1")).toBe(false);

    router.resetUnhealthy("m1");
    expect(router.isAvailable("m1")).toBe(true);
  });

  it("markHealthy returns null for unknown model", () => {
    const router = new ModelRouter({ models: [], usageConfig: {}, providers: {} });
    expect(router.markHealthy("ghost")).toBe(null);
    expect(router.markHealthy("")).toBe(null);
  });

  it("cost_optimized strategy works like priority", async () => {
    const { provider } = createMockProvider({
      behaviors: {
        m1: [{ content: "m1-ok" }, { content: "m1-ok2" }],
        m2: [{ content: "m2-ok" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "m1", provider: "mock", tags: ["text"], limits: {} },
        { id: "m2", provider: "mock", tags: ["text"], limits: {} },
      ],
      usageConfig: { worker: ["m1", "m2"] },
      providers: { mock: provider },
      strategy: "cost_optimized",
    });

    const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
    const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
    expect(out1.model).toBe("m1");
    expect(out2.model).toBe("m1");
  });

  it("images param requires vision tag for worker usage", async () => {
    const { provider } = createMockProvider({
      behaviors: {
        textOnly: [{ content: "text" }],
        visionModel: [{ content: "vision" }],
      },
    });

    const router = new ModelRouter({
      models: [
        { id: "textOnly", provider: "mock", tags: ["text"], limits: {} },
        { id: "visionModel", provider: "mock", tags: ["text", "vision"], limits: {} },
      ],
      usageConfig: { worker: ["textOnly", "visionModel"] },
      providers: { mock: provider },
    });

    const out = await router.call({
      usage: "worker",
      messages: [{ role: "user", content: "describe this" }],
      images: [{ data: "base64" }],
    });
    expect(out.model).toBe("visionModel");
  });

  it("rejects invalid provider without chat method", () => {
    expect(
      () =>
        new ModelRouter({
          models: [{ id: "m1", provider: "bad", tags: ["text"], limits: {} }],
          usageConfig: { worker: ["m1"] },
          providers: { bad: { id: "bad" } },
        })
    ).toThrow(/ModelProvider must implement chat/);
  });

  it("accepts unknown tags in model configs", () => {
    const { provider } = createMockProvider({ behaviors: { ok: [{ content: "ok" }] } });

    const router = new ModelRouter({
      models: [{ id: "ok", provider: "mock", tags: ["unknown-tag"], limits: {} }],
      usageConfig: { worker: ["ok"] },
      providers: { mock: provider },
    });

    expect(router).toBeTruthy();
  });

  it("getCircuitBreakerState returns null for unknown model", () => {
    const router = new ModelRouter({
      models: [],
      usageConfig: {},
      providers: {},
    });

    expect(router.getCircuitBreakerState("ghost")).toBe(null);
    expect(router.getCircuitBreakerState("")).toBe(null);
    expect(router.getCircuitBreakerState("   ")).toBe(null);
  });

  it("resetCircuitBreaker clears breaker state", async () => {
    const time = createFakeTime(0);
    const { provider } = createMockProvider({
      time,
      behaviors: { m1: [{ content: "ok" }] },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
    });

    await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    const before = router.getCircuitBreakerState("m1");
    expect(before).toBeTruthy();

    router.resetCircuitBreaker("m1");
    const after = router.getCircuitBreakerState("m1");
    expect(after?.state).toBe("closed");

    router.resetCircuitBreaker("");
    router.resetCircuitBreaker("   ");
    router.resetCircuitBreaker("unknown");
  });

  it("TokenBucketRateLimiter: normalize + load defaults", async () => {
    expect(normalizeRateLimitConfig({ enabled: false, rps: 5, burst: 3, concurrency: 2, maxQueue: 0 })).toStrictEqual({
      enabled: false,
      rps: 5,
      burst: 3,
      concurrency: 2,
      maxQueue: 0,
    });

    expect(normalizeRateLimitConfig({ rps: 0, burst: 0, concurrency: 0, maxQueue: -1 })).toStrictEqual({
      enabled: true,
      rps: Infinity,
      burst: 1,
      concurrency: 1,
      maxQueue: 500,
    });

    const cfg = loadRateLimitConfig();
    expect(cfg.enabled).toBe(true);
    expect(typeof cfg.rps).toBe("number");
    expect(cfg.burst).toBeGreaterThanOrEqual(1);
    expect(cfg.concurrency).toBeGreaterThanOrEqual(1);

    const { storage } = createMockStorage();
    storage.setItem("k", JSON.stringify({ enabled: false, rps: 10, burst: 2, concurrency: 3, maxQueue: 4 }));
    expect(loadRateLimitConfig({ storageKey: "k", storage })).toStrictEqual({
      enabled: false,
      rps: 10,
      burst: 2,
      concurrency: 3,
      maxQueue: 4,
    });
  });

  it("TokenBucketRateLimiter: respects token bucket pacing", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: 2, burst: 2, concurrency: 1, time });

    const starts = [];
    const mk = (id) =>
      limiter.schedule(async () => {
        starts.push({ id, t: time.now() });
        return id;
      });

    const out = await Promise.all([mk("a"), mk("b"), mk("c")]);
    expect(out).toStrictEqual(["a", "b", "c"]);
    expect(starts.map((s) => s.t)).toStrictEqual([0, 0, 500]);
  });

  it("TokenBucketRateLimiter: enforces concurrency and starts next after release", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 2, time });

    const started = [];
    const gates = new Map();
    const gate = (id) =>
      new Promise((resolve) => {
        gates.set(id, resolve);
      });

    const p1 = limiter.schedule(async () => {
      started.push("a");
      await gate("a");
      return "a";
    });
    const p2 = limiter.schedule(async () => {
      started.push("b");
      await gate("b");
      return "b";
    });
    const p3 = limiter.schedule(async () => {
      started.push("c");
      return "c";
    });

    await Promise.resolve();
    expect(started).toStrictEqual(["a", "b"]);

    gates.get("a")?.();
    await p1;
    await Promise.resolve();

    expect(started).toStrictEqual(["a", "b", "c"]);
    await expect(p3).resolves.toBe("c");

    gates.get("b")?.();
    await expect(p2).resolves.toBe("b");
  });

  it("TokenBucketRateLimiter: queued task abort rejects without running", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });

    let release = null;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    const p1 = limiter.schedule(async () => {
      await hold;
      return "a";
    });

    const ac = new AbortController();
    let ran = false;
    const p2 = limiter.schedule(
      async () => {
        ran = true;
        return "b";
      },
      { signal: ac.signal, label: "b" }
    );

    ac.abort();
    await expect(p2).rejects.toMatchObject({ name: "AbortError" });
    expect(ran).toBe(false);

    release?.();
    await expect(p1).resolves.toBe("a");
  });

  it("TokenBucketRateLimiter: blockFor delays execution", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });
    limiter.blockFor(1000);

    const startedAt = [];
    const out = await limiter.schedule(() => {
      startedAt.push(time.now());
      return "ok";
    });

    expect(out).toBe("ok");
    expect(startedAt).toStrictEqual([1000]);
  });

  it("TokenBucketRateLimiter: rejects when queue full (maxQueue=0)", async () => {
    const time = createFakeTime(0);
    const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, maxQueue: 0, time });

    let release = null;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    const p1 = limiter.schedule(async () => {
      await hold;
      return "a";
    });

    await new Promise((resolve) => setImmediate(resolve));

    await expect(limiter.schedule(() => "b")).rejects.toThrow(/queue full/i);

    release?.();
    await expect(p1).resolves.toBe("a");
  });

  it("TokenBucketRateLimiter: getState returns current state", async () => {
    const time = createFakeTime(1000);
    const limiter = new TokenBucketRateLimiter({ rps: 5, burst: 3, concurrency: 2, maxQueue: 100, time });

    const state = limiter.getState();
    expect(state.rps).toBe(5);
    expect(state.burst).toBe(3);
    expect(state.concurrency).toBe(2);
    expect(state.maxQueue).toBe(100);
    expect(state.queueSize).toBe(0);
    expect(state.inFlight).toBe(0);
    expect(state.nowMs).toBe(1000);
  });
});
