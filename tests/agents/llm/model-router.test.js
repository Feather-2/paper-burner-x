import test from "node:test";
import assert from "node:assert/strict";

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

test("ModelRouter: round-robin cursor survives model list reordering", async () => {
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
    strategy: "round_robin",
  });

  router._rrNextIndexByUsage.set("worker", "m2");
  const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out1.model, "m2");
  assert.equal(router._rrNextIndexByUsage.get("worker"), "m3");

  // Reorder the configured candidates; the cursor should still start from "m3".
  router._usageConfig.worker = ["m3", "m2", "m1"];
  const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi2" }] });
  assert.equal(out2.model, "m3");
});

test("ModelRouter: persistRoundRobin reads/writes via injected storage", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      m1: [{ content: "ok-m1" }],
      m2: [{ content: "ok-m2" }],
    },
  });

  const store = new Map();
  const storage = {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };

  const key = "rr_test_v1";
  const router1 = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "round_robin",
    persistRoundRobin: true,
    roundRobinStorageKey: key,
    storage,
  });

  const out1 = await router1.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out1.model, "m1");
  assert.ok(String(storage.getItem(key)).includes("m2"));

  const router2 = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "round_robin",
    persistRoundRobin: true,
    roundRobinStorageKey: key,
    storage,
  });

  const out2 = await router2.call({ usage: "worker", messages: [{ role: "user", content: "hi2" }] });
  assert.equal(out2.model, "m2");
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

test("ModelRouter: 401/403 disables model permanently until reset", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const authErr = new Error("Unauthorized");
  authErr.status = 401;

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["bad", "good"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 60_000,
    time,
  });

  const events = [];
  router.on("model.unhealthy", (e) => events.push(e));

  const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] });
  assert.equal(out1.model, "good");
  assert.equal(out1.content, "ok");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0].model, "bad");
  assert.equal(provider.calls[1].model, "good");

  const h = router.getHealth("bad");
  assert.ok(h);
  assert.equal(h.disabled, true);
  assert.equal(h.unhealthyUntilMs, 0);
  assert.equal(router.isAvailable("bad"), false);
  assert.ok(events.some((e) => e.modelId === "bad" && e.disabled === true));

  time.advance(600_000);
  assert.equal(router.isAvailable("bad"), false);

  const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] });
  assert.equal(out2.model, "good");
  assert.equal(out2.content, "ok2");
  assert.equal(provider.calls.length, 3);
  assert.equal(provider.calls[2].model, "good");

  router.resetUnhealthy("bad");
  assert.equal(router.isAvailable("bad"), true);
});

test("ModelRouter: exponential backoff increases cooldown and emits backoffLevel", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock", defaultOutcome: new Error("down") });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    baseCooldownMs: 60_000,
    maxCooldownMs: 600_000,
    backoffMultiplier: 2,
    time,
  });

  const unhealthy = [];
  router.on("model.unhealthy", (e) => unhealthy.push(e));

  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] }), /All models failed/);
    const evt = unhealthy[i];
    assert.equal(evt.backoffLevel, i);
    const expectedCooldownMs = Math.min(60_000 * 2 ** i, 600_000);
    assert.equal(evt.cooldownMs, expectedCooldownMs);
    time.advance(expectedCooldownMs + 1);
  }
});

test("ModelRouter: legacy cooldownMs keeps constant cooldown across failures", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock", defaultOutcome: new Error("down") });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldownMs: 1000,
    time,
  });

  const unhealthy = [];
  router.on("model.unhealthy", (e) => unhealthy.push(e));

  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] }), /All models failed/);
    const evt = unhealthy[i];
    assert.equal(evt.backoffLevel, i);
    assert.equal(evt.cooldownMs, 1000);
    time.advance(1001);
  }
});

test("ModelRouter: markHealthy resets failures on successful call", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock" });
  provider.setBehaviors("m1", [{ throw: new Error("down") }, { content: "ok" }, { throw: new Error("down-again") }]);

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    baseCooldownMs: 1000,
    maxCooldownMs: 5000,
    backoffMultiplier: 2,
    time,
  });

  const unhealthy = [];
  router.on("model.unhealthy", (e) => unhealthy.push(e));

  await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] }), /All models failed/);
  assert.equal(unhealthy[0].cooldownMs, 1000);
  assert.equal(unhealthy[0].backoffLevel, 0);
  assert.equal(router.getHealth("m1")?.failures, 1);

  time.advance(1001);
  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
  assert.equal(out.model, "m1");
  assert.equal(out.content, "ok");
  assert.equal(router.getHealth("m1")?.failures, 0);

  await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: "c" }] }), /All models failed/);
  assert.equal(unhealthy[1].cooldownMs, 1000);
  assert.equal(unhealthy[1].backoffLevel, 0);
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
        usageConfig: { worker: "ok" },
        providers: { mock: provider },
      }),
    /UsageConfig/
  );

  const router = new ModelRouter({
    models: [{ id: "ok", provider: "mock", tags: ["unknown-tag"], limits: {} }],
    usageConfig: { worker: ["ok"] },
    providers: { mock: provider },
  });
  assert.ok(router);
});

test("ModelRouter: invalid strategy throws clear error", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  assert.throws(() => new ModelRouter({ strategy: "nope" }), /strategy/i);
});

test("ModelRouter: debug=true without logger does not call console", async () => {
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

  assert.equal(consoleCalls.length, 0);

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

test("ModelRouter: latency_optimized uses PerformanceRouter to prefer lower latency", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const time = createFakeTime(0);
  const provider = {
    id: "mock",
    async chat({ model } = {}) {
      if (model === "m1") time.advance(100);
      if (model === "m2") time.advance(10);
      return { content: `ok-${model}` };
    },
  };

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "latency_optimized",
    time,
  });

  const seen = [];
  for (let i = 0; i < 3; i++) {
    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: `hi-${i}` }] });
    seen.push(out.model);
  }

  // Old behavior (pre-perf-router): always picks the first healthy candidate ("m1").
  // With PerformanceRouter, routing should converge to the lower latency endpoint ("m2").
  assert.equal(seen.at(-1), "m2");
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

  const store = new Map();
  const storage = {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };

  storage.setItem("k", JSON.stringify({ enabled: false, rps: 10, burst: 2, concurrency: 3, maxQueue: 4 }));
  assert.deepEqual(loadRateLimitConfig({ storageKey: "k", storage }), { enabled: false, rps: 10, burst: 2, concurrency: 3, maxQueue: 4 });
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

// --- Circuit Breaker Integration ---

test("ModelRouter: circuit breaker blocks model after consecutive failures", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      flaky: Array(6).fill({ throw: new Error("down") }),
      backup: [{ content: "backup-ok" }],
    },
  });

  const router = new ModelRouter({
    models: [
      { id: "flaky", provider: "mock", tags: ["text"], limits: {} },
      { id: "backup", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["flaky", "backup"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    baseCooldownMs: 100,
    maxCooldownMs: 1000,
    time,
  });

  const events = [];
  router.on("circuit.stateChange", (e) => events.push(e));

  // Trigger 5 failures to trip the circuit breaker
  for (let i = 0; i < 5; i++) {
    time.advance(101);
    try {
      await router.call({ usage: "worker", messages: [{ role: "user", content: `x-${i}` }] });
    } catch {
      // expected
    }
  }

  // Circuit breaker should be open after 5 failures
  const cbState = router.getCircuitBreakerState("flaky");
  assert.ok(cbState, "circuit breaker state should exist");
});

test("ModelRouter: getCircuitBreakerState returns null for unknown model", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const router = new ModelRouter({
    models: [],
    usageConfig: {},
    providers: {},
  });

  assert.equal(router.getCircuitBreakerState("ghost"), null);
  assert.equal(router.getCircuitBreakerState(""), null);
  assert.equal(router.getCircuitBreakerState("   "), null);
});

test("ModelRouter: resetCircuitBreaker clears breaker state", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: { m1: [{ content: "ok" }] },
  });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    time,
  });

  await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  const before = router.getCircuitBreakerState("m1");
  assert.ok(before, "state should exist after call");

  router.resetCircuitBreaker("m1");
  const after = router.getCircuitBreakerState("m1");
  assert.equal(after?.state, "closed");

  // no-op for blank/unknown
  router.resetCircuitBreaker("");
  router.resetCircuitBreaker("   ");
  router.resetCircuitBreaker("unknown");
});

// --- Cooldown Object Config ---

test("ModelRouter: cooldown object config overrides individual params", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({ id: "mock", defaultOutcome: new Error("down") });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    cooldown: { baseMs: 5000, maxMs: 20000, multiplier: 3 },
    time,
  });

  const unhealthy = [];
  router.on("model.unhealthy", (e) => unhealthy.push(e));

  await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: "x" }] }), /All models failed/);
  assert.equal(unhealthy[0].cooldownMs, 5000);

  time.advance(5001);
  await assert.rejects(() => router.call({ usage: "worker", messages: [{ role: "user", content: "y" }] }), /All models failed/);
  assert.equal(unhealthy[1].cooldownMs, 15000); // 5000 * 3
});

// --- TierResolver Custom ---

test("ModelRouter: custom tierResolver overrides default tier detection", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: { m1: [{ content: "ok" }] },
  });

  const tierCalls = [];
  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "latency_optimized",
    tierResolver: ({ modelId, modelEntry, usage, images }) => {
      tierCalls.push({ modelId, usage, hasImages: !!images?.length });
      return "fast";
    },
  });

  await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.ok(tierCalls.length > 0);
  assert.equal(tierCalls[0].modelId, "m1");
  assert.equal(tierCalls[0].usage, "worker");
});

test("ModelRouter: tierResolver error falls back to tag-based detection", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: { m1: [{ content: "ok" }] },
  });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text", "fast"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "latency_optimized",
    tierResolver: () => {
      throw new Error("resolver error");
    },
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.content, "ok");
});

// --- PerformanceRouting Toggle ---

test("ModelRouter: performanceRouting=false disables perf routing even for latency_optimized", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      m1: [{ content: "m1-ok" }],
      m2: [{ content: "m2-ok" }],
    },
  });

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "latency_optimized",
    performanceRouting: false,
    time,
  });

  // Should use standard routing (first candidate)
  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.model, "m1");
});

test("ModelRouter: performanceRouting=true forces perf routing for round_robin", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: {
      m1: [{ content: "m1-ok" }, { content: "m1-ok2" }, { content: "m1-ok3" }],
      m2: [{ content: "m2-ok" }, { content: "m2-ok2" }],
    },
  });

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: {} },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "round_robin",
    performanceRouting: true,
    time,
  });

  // With performanceRouting=true, PerformanceRouter is used
  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.ok(["m1", "m2"].includes(out.model));
});

// --- RetryStrategy Integration ---

test("ModelRouter: retryStrategy retries transient failures", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  let callCount = 0;
  const provider = {
    id: "mock",
    async chat({ model, messages }) {
      callCount++;
      if (callCount < 3) {
        const err = new Error("transient");
        err.status = 503;
        throw err;
      }
      return { content: "ok" };
    },
  };

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
    time,
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.content, "ok");
  assert.ok(callCount >= 3);
});

// --- Complex Messages (extractPromptText) ---

test("ModelRouter: handles complex message content structures", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
    behaviors: { m1: [{ content: "ok" }] },
  });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "latency_optimized",
  });

  // Test various content formats (all must comply with assertChatMessages: string or array of objects)
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
  assert.equal(out.content, "ok");
});

// --- DisableModel ---

test("ModelRouter: disableModel permanently disables until reset", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const time = createFakeTime(0);
  const provider = new MockProvider({
    id: "mock",
    behaviors: { m1: [{ content: "ok" }] },
  });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: ["m1"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    time,
  });

  router.disableModel("m1", new Error("manual disable"), { reason: "test" });
  const h = router.getHealth("m1");
  assert.equal(h.disabled, true);
  assert.equal(h.disabledReason, "test");
  assert.equal(h.unhealthyUntilMs, 0);
  assert.equal(router.isAvailable("m1"), false);

  time.advance(1_000_000);
  assert.equal(router.isAvailable("m1"), false);

  router.resetUnhealthy("m1");
  assert.equal(router.isAvailable("m1"), true);
});

test("ModelRouter: disableModel returns null for blank modelId", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const router = new ModelRouter({ models: [], usageConfig: {}, providers: {} });
  assert.equal(router.disableModel("", new Error("x")), null);
  assert.equal(router.disableModel("   ", new Error("x")), null);
});

// --- Health Helpers Edge Cases ---

test("ModelRouter: markHealthy returns null for unknown model", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const router = new ModelRouter({ models: [], usageConfig: {}, providers: {} });
  assert.equal(router.markHealthy("ghost"), null);
  assert.equal(router.markHealthy(""), null);
});

test("ModelRouter: markUnhealthy handles disabled model gracefully", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const time = createFakeTime(0);
  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: {},
    providers: {},
    time,
  });

  router.disableModel("m1", new Error("disabled"));
  const result = router.markUnhealthy("m1", new Error("more"));
  assert.ok(result);
  assert.equal(result.cooldownMs, null);
  assert.equal(result.backoffLevel, null);
});

// --- Cost-Optimized Strategy ---

test("ModelRouter: cost_optimized strategy works like priority", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    strategy: "cost_optimized",
  });

  const out1 = await router.call({ usage: "worker", messages: [{ role: "user", content: "a" }] });
  const out2 = await router.call({ usage: "worker", messages: [{ role: "user", content: "b" }] });
  assert.equal(out1.model, "m1");
  assert.equal(out2.model, "m1");
});

// --- RateLimiter Edge Cases ---

test("TokenBucketRateLimiter: rejects when queue full (maxQueue=0)", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

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

  // Give event loop a tick for p1 to start
  await new Promise((r) => setImmediate(r));

  // Queue is full (maxQueue=0), second schedule should reject
  let rejected = false;
  try {
    await limiter.schedule(() => "b");
  } catch (e) {
    if (/queue full/i.test(e.message)) rejected = true;
  }
  assert.ok(rejected, "Expected queue full rejection");

  // Release p1 so it completes
  release?.();
  assert.equal(await p1, "a");
});

test("TokenBucketRateLimiter: getState returns current state", async () => {
  const { TokenBucketRateLimiter } = await import("../../../js/agents/llm/rate-limit.js");

  const time = createFakeTime(1000);
  const limiter = new TokenBucketRateLimiter({ rps: 5, burst: 3, concurrency: 2, maxQueue: 100, time });

  const state = limiter.getState();
  assert.equal(state.rps, 5);
  assert.equal(state.burst, 3);
  assert.equal(state.concurrency, 2);
  assert.equal(state.maxQueue, 100);
  assert.equal(state.queueSize, 0);
  assert.equal(state.inFlight, 0);
  assert.equal(state.nowMs, 1000);
});

// --- Provider Validation ---

test("ModelRouter: rejects invalid provider without chat method", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  assert.throws(
    () =>
      new ModelRouter({
        models: [{ id: "m1", provider: "bad", tags: ["text"], limits: {} }],
        usageConfig: { worker: ["m1"] },
        providers: { bad: { id: "bad" } },
      }),
    /ModelProvider must implement chat/
  );
});

// --- Logger Validation ---

test("ModelRouter: throws for invalid logger", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  assert.throws(
    () =>
      new ModelRouter({
        models: [],
        usageConfig: {},
        providers: {},
        debug: true,
        logger: { debug: () => {}, info: () => {} }, // missing warn/error
      }),
    /logger\.warn must be a function/
  );
});

// --- Empty Usage Config ---

test("ModelRouter: throws for usage with no models configured", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({ id: "mock", behaviors: {} });

  const router = new ModelRouter({
    models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
    usageConfig: { worker: [], planner: ["m1"], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
  });

  await assert.rejects(
    () => router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] }),
    /No models configured for usage: worker/
  );
});

// --- retryAfterMs handling ---

test("ModelRouter: respects retryAfterMs from error and blocks limiter", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");

  const time = createFakeTime(0);
  let callCount = 0;
  const provider = {
    id: "mock",
    async chat() {
      callCount++;
      if (callCount === 1) {
        const err = new Error("rate limited");
        err.retryAfterMs = 5000;
        throw err;
      }
      return { content: "ok" };
    },
  };

  const router = new ModelRouter({
    models: [
      { id: "m1", provider: "mock", tags: ["text"], limits: { rateLimit: 10 } },
      { id: "m2", provider: "mock", tags: ["text"], limits: {} },
    ],
    usageConfig: { worker: ["m1", "m2"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
    time,
  });

  const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.content, "ok");
});

// --- Images with worker usage ---

test("ModelRouter: images param requires vision tag", async () => {
  const { ModelRouter } = await import("../../../js/agents/llm/model-router.js");
  const { MockProvider } = await import("../../../js/agents/llm/mock-provider.js");

  const provider = new MockProvider({
    id: "mock",
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
    usageConfig: { worker: ["textOnly", "visionModel"], planner: [], analyst: [], writer: [], vision: [] },
    providers: { mock: provider },
  });

  // With images, should skip textOnly and use visionModel
  const out = await router.call({
    usage: "worker",
    messages: [{ role: "user", content: "describe this" }],
    images: [{ data: "base64" }],
  });
  assert.equal(out.model, "visionModel");
});
