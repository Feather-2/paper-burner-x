const test = require("node:test");
const assert = require("node:assert/strict");

function createFakeTime(startMs = 0) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    sleep: async (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
    advance: (ms) => {
      nowMs += Math.max(0, Math.floor(ms || 0));
    },
  };
}

function createCaptureLogger() {
  const calls = [];
  const make = (level) => (msg, meta) => calls.push({ level, msg: String(msg), meta });
  return {
    calls,
    logger: { debug: make("debug"), info: make("info"), warn: make("warn"), error: make("error") },
  };
}

function withPatchedConsole(methods, fn) {
  const originals = {};
  for (const [k, v] of Object.entries(methods)) {
    originals[k] = console[k];
    console[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(originals)) console[k] = v;
    });
}

test("ModelRouter: usage-based selection picks first healthy candidate", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      m1: [{ content: "ok-m1" }],
      m2: [{ content: "ok-m2" }],
    },
  });

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text", "cheap"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text", "fast"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.content, "ok-m1");
  assert.equal(out.model, "m1");
  assert.equal(out.provider, "mock");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].model, "m1");
});

test("ModelRouter: debug=false is silent (no logger calls)", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const { logger, calls } = createCaptureLogger();
  const provider = new MockProvider({ id: "mock", behaviors: { m1: [{ content: "ok" }] } });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    debug: false,
    logger,
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.model, "m1");
  assert.equal(calls.length, 0);
});

test("ModelRouter: debug=true uses injected logger for selection + failover logs", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const { logger, calls } = createCaptureLogger();
  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["bad", "good"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    debug: true,
    logger,
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
  assert.equal(out.model, "good");

  assert.ok(calls.some((c) => c.level === "debug" && c.msg.includes("try bad")));
  assert.ok(calls.some((c) => c.level === "warn" && c.msg.includes("fail bad")));
  assert.ok(calls.some((c) => c.level === "info" && c.msg.includes("failover bad -> good")));
  assert.ok(calls.some((c) => c.level === "debug" && c.msg.includes("ok good")));
});

test("ModelRouter: capability tag filtering skips non-vision model when images present", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      textOnly: [{ content: "should-not-be-called" }],
      visionOK: [{ content: "ok-vision" }],
    },
  });

  const router = new ModelRouter({
    models: [
      { id: "textOnly", provider: "mock", tags: ["text"], limits: {} },
      { id: "visionOK", provider: "mock", tags: ["text", "vision"], limits: {} },
    ],
    usageConfig: { worker: [], planner: [], analyst: [], writer: [], vision: ["textOnly", "visionOK"] },
    providers: { mock: provider },
  });

  const out = await router.call({
    usage: "vision",
    messages: [{ role: "user", content: "describe" }],
    images: [{ type: "image/png", data: "base64:xxx" }],
  });

  assert.equal(out.content, "ok-vision");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].model, "visionOK");
});

test("ModelRouter: failover emits events and marks unhealthy", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: [], planner: ["bad", "good"], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 60_000,
    time: createFakeTime(1000),
  });

  const events = [];
  router.on("model.unhealthy", (e) => events.push({ name: "model.unhealthy", e }));
  router.on("model.failover", (e) => events.push({ name: "model.failover", e }));

  const out = await router.call({ usage: "planner", messages: [{ role: "user", content: "plan" }] });
  assert.equal(out.content, "ok-good");
  assert.equal(out.model, "good");

  assert.ok(events.some((x) => x.name === "model.unhealthy" && x.e.modelId === "bad" && x.e.error.message === "boom"));
  assert.ok(events.some((x) => x.name === "model.failover" && x.e.fromModelId === "bad" && x.e.toModelId === "good"));

  const h = router.getHealth("bad");
  assert.ok(h && h.unhealthyUntilMs > 1000);
  assert.equal(router.isAvailable("bad"), false);
});

test("ModelRouter: unhealthy cooldown recovery retries model after time passes", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock" });
  provider.setBehaviors("m1", [{ throw: new Error("down") }, { content: "m1-back" }]);
  provider.setBehaviors("m2", [{ content: "m2-ok" }, { content: "m2-ok2" }]);

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text", "fast"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 60_000,
    time,
  });

  const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
  assert.equal(out1.model, "m2");
  assert.equal(router.isAvailable("m1"), false);

  time.advance(60_001);
  assert.equal(router.isAvailable("m1"), true);

  const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
  assert.equal(out2.model, "m1");
  assert.equal(out2.content, "m1-back");
});

test("ModelRouter: waits for shortest cooldown (<30s) then retries once", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock" });
  provider.setBehaviors("m1", [{ throw: new Error("down") }, { content: "m1-back" }]);
  const { logger, calls } = createCaptureLogger();

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 10_000,
    time,
    debug: true,
    logger,
  });

  await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] }), /All models failed for usage: worker/);
  assert.equal(router.isAvailable("m1"), false);
  assert.equal(provider.calls.length, 1);

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
  assert.equal(out.model, "m1");
  assert.equal(out.content, "m1-back");
  assert.equal(provider.calls.length, 2);
  assert.ok(time.now() >= 10_000);
  assert.ok(calls.some((c) => c.level === "info" && c.msg.includes("waiting")));
  assert.ok(calls.some((c) => c.level === "info" && c.msg.includes("retry after cooldown wait")));
});

test("ModelRouter: round_robin strategy distributes calls across models", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["m1", "m2", "m3"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
  });

  const seen = [];
  for (let i = 0; i < 10; i++) {
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `hi-${i}` }] });
    seen.push(out.model);
  }

  const counts = new Map();
  for (const m of seen) counts.set(m, (counts.get(m) || 0) + 1);
  const values = [...counts.values()];
  assert.equal(values.reduce((a, b) => a + b, 0), 10);
  assert.ok(Math.max(...values) - Math.min(...values) <= 1);
});

test("ModelRouter: priority strategy preserves original first-healthy behavior", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "priority",
  });

  for (let i = 0; i < 3; i++) {
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] });
    assert.equal(out.model, "m1");
  }
  assert.ok(provider.calls.every((c) => c.model === "m1"));
});

test("ModelRouter: round_robin pointer skips failed model and continues rotation", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["m1", "m2", "m3"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    time: createFakeTime(0),
  });

  const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
  assert.equal(out1.model, "m2");
  assert.equal(router.isAvailable("m1"), false);

  const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
  assert.equal(out2.model, "m3");
});

test("ModelRouter: throws when all candidates fail", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: [], planner: [], analyst: ["a", "b"], writer: [], vision: [] },
    providers: { mock: provider },
    time: createFakeTime(0),
  });

  await assert.rejects(() => router.call({ usage: "analyst", messages: [{ role: "user", content: "analyze" }] }), /All models failed for usage: analyst/);
});

test("ModelRouter + validators: bad configs throw early", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({ id: "mock", behaviors: { ok: [{ content: "ok" }] } });

  assert.throws(
    () =>
      new ModelRouter({
        models: [{ id: "ok", provider: "mock", tags: ["text"], limits: {} }],
        usageConfig: { worker: ["ok"] },
        providers: { mock: provider },
      }),
    /UsageConfig/
  );

  assert.throws(
    () =>
      new ModelRouter({
        models: [{ id: "ok", provider: "mock", tags: ["unknown-tag"], limits: {} }],
        usageConfig: { worker: ["ok"], planner: [], analyst: [], writer: [], vision: [] },
        providers: { mock: provider },
      }),
    /unknown tag/i
  );
});

test("ModelRouter: invalid strategy throws clear error", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  assert.throws(() => new ModelRouter({ strategy: "nope" }), /strategy/i);
});

test("ModelRouter: debug=true without logger uses console methods (but gated by debug)", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({ id: "mock", behaviors: { m1: [{ content: "ok" }] } });

  const consoleCalls = [];
  await withPatchedConsole(
    {
      debug: (msg) => consoleCalls.push({ level: "debug", msg }),
      info: (msg) => consoleCalls.push({ level: "info", msg }),
      warn: (msg) => consoleCalls.push({ level: "warn", msg }),
      error: (msg) => consoleCalls.push({ level: "error", msg }),
    },
    async () => {
      const router = new ModelRouter({
        models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
        usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
        providers: { mock: provider },
        debug: true,
      });

      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
      assert.equal(out.model, "m1");
    }
  );

  assert.ok(consoleCalls.length > 0);

  await withPatchedConsole(
    {
      debug: () => {
        throw new Error("console.debug should not be called");
      },
      info: () => {
        throw new Error("console.info should not be called");
      },
      warn: () => {
        throw new Error("console.warn should not be called");
      },
      error: () => {
        throw new Error("console.error should not be called");
      },
    },
    async () => {
      const router = new ModelRouter({
        models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
        usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
        providers: { mock: provider },
        debug: false,
      });
      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
      assert.equal(out.model, "m1");
    }
  );
});

test("ModelRouter: supports providers Map + usageTags and exposes health helpers", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["slow", "fast"], planner: [], analyst: [], writer: [], vision: [] },
    usageTags: { worker: ["fast"], "   ": ["cheap"] },
    providers: new Map([["mock", provider]]),
    time,
    strategy: "priority",
  });

  assert.equal(router.getModelEntry("fast")?.id, "fast");
  assert.equal(router.getModelEntry("   "), null);
  assert.equal(router.getHealth("fast"), null);

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
  assert.equal(out.model, "fast");
});

test("ModelRouter: resetUnhealthy clears cooldown; EventEmitter off/removeAllListeners work", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["bad", "good"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 60_000,
    time,
    strategy: "priority",
  });

  let unhealthyCount = 0;
  const handler = () => unhealthyCount++;
  router.on("model.unhealthy", handler);
  router.off("model.unhealthy", () => {});
  router.off("model.unhealthy", handler);

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
  assert.equal(out.model, "good");
  assert.equal(unhealthyCount, 0);

  assert.equal(router.isAvailable("bad"), false);
  router.resetUnhealthy("bad");
  assert.equal(router.isAvailable("bad"), true);
  router.resetUnhealthy("   ");

  router.on("model.failover", () => {});
  router.removeAllListeners("model.failover");
  router.on("model.failover", () => {});
  router.removeAllListeners();
});

test("ModelRouter: rateLimit waits between calls (and Infinity disables waiting)", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["m1"], planner: ["m2"], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    time,
  });

  const before = time.now();
  await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
  await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
  assert.ok(time.now() - before >= 500);

  const before2 = time.now();
  await router.call({ usage: "planner", messages: [{ role: "user", content: "a" }] });
  await router.call({ usage: "planner", messages: [{ role: "user", content: "b" }] });
  assert.equal(time.now() - before2, 0);
});

test("ModelRouter: default logger fallbacks cover missing console methods", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      bad: [{ throw: new Error("boom") }],
      good: [{ content: "ok" }],
    },
  });

  await withPatchedConsole(
    { debug: undefined, info: undefined, warn: undefined, error: undefined },
    async () => {
      const router = new ModelRouter({
        models: [
          { id: "bad", provider: "mock", tags: ["text"], limits: {} },
          { id: "good", provider: "mock", tags: ["text"], limits: {} },
        ],
        usageConfig: { worker: ["bad", "good"], planner: [], analyst: [], writer: [], vision: [] },
        providers: { mock: provider },
        time,
        debug: true,
      });

      const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
      assert.equal(out.model, "good");

      router._logger.error("covered");
      router._logger.debug("covered");
      router._logger.info("covered");
      router._logger.warn("covered");
    }
  );
});

test("ModelRouter: defaultTime.sleep is callable and toErrorInfo handles non-Error", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({ id: "mock", behaviors: { m1: [{ content: "ok" }] } });
  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
  });

  await router._time.sleep(0);
  router.markUnhealthy("m1", "not-an-error");
  assert.ok(router.getHealth("m1")?.lastError?.message);
});

test("ModelRouter: throws clear errors for unknown model and missing provider; _getProvider validates id", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const routerUnknownModel = new ModelRouter({
    models: [{ id: "m1", provider: "p1", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["ghost"], planner: [], analyst: [], writer: [], vision: [] },
    providers: {},
  });
  await assert.rejects(
    () => routerUnknownModel.call({ usage: "worker", messages: [{ role: "user", content: "x" }] }),
    /Unknown model id: ghost/
  );

  const routerMissingProvider = new ModelRouter({
    models: [{ id: "m1", provider: "p1", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: null,
  });
  assert.equal(routerMissingProvider._getProvider(" "), null);
  await assert.rejects(
    () => routerMissingProvider.call({ usage: "worker", messages: [{ role: "user", content: "x" }] }),
    /Missing provider: p1/
  );
});

test("TokenBucketRateLimiter: normalize + load defaults", async () => {
  const { normalizeRateLimitConfig, loadRateLimitConfig } = await import("../../../js/agents/llm/rate-limit.js");

  assert.deepEqual(
    normalizeRateLimitConfig({ enabled: false, rps: 5, burst: 3, concurrency: 2, maxQueue: 0 }),
    { enabled: false, rps: 5, burst: 3, concurrency: 2, maxQueue: 0 }
  );

  assert.deepEqual(
    normalizeRateLimitConfig({ rps: 0, burst: 0, concurrency: 0, maxQueue: -1 }),
    { enabled: true, rps: Infinity, burst: 1, concurrency: 1, maxQueue: 500 }
  );

  const cfg = loadRateLimitConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(typeof cfg.rps, "number");
  assert.ok(cfg.burst >= 1);
  assert.ok(cfg.concurrency >= 1);
});

test("TokenBucketRateLimiter: respects token bucket pacing", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

  const time = createFakeTime(0);
  const limiter = new TokenBucketRateLimiter({ rps: 2, burst: 2, concurrency: 1, time });

  const starts = [];
  const mk = (id) =>
    limiter.schedule(async () => {
      starts.push({ id, t: time.now() });
      return id;
    });

  const out = await Promise.all([mk("a"), mk("b"), mk("c")]);
  assert.deepEqual(out, ["a", "b", "c"]);
  assert.deepEqual(starts.map((s) => s.t), [0, 0, 500]);
});

test("TokenBucketRateLimiter: enforces concurrency and starts next after release", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

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
  assert.deepEqual(started, ["a", "b"]);

  gates.get("a")?.();
  await p1;
  await Promise.resolve();

  assert.deepEqual(started, ["a", "b", "c"]);
  assert.equal(await p3, "c");

  gates.get("b")?.();
  assert.equal(await p2, "b");
});

test("TokenBucketRateLimiter: queued task abort rejects without running", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

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
  await assert.rejects(p2, (err) => err?.name === "AbortError");
  assert.equal(ran, false);

  release?.();
  assert.equal(await p1, "a");
});

test("TokenBucketRateLimiter: blockFor delays execution", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

  const time = createFakeTime(0);
  const limiter = new TokenBucketRateLimiter({ rps: Infinity, burst: 1, concurrency: 1, time });
  limiter.blockFor(1000);

  const startedAt = [];
  const out = await limiter.schedule(() => {
    startedAt.push(time.now());
    return "ok";
  });

  assert.equal(out, "ok");
  assert.deepEqual(startedAt, [1000]);
});
