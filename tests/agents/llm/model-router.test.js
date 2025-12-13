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

