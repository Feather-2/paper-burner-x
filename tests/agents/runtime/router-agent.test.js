const test = require("node:test");
const assert = require("node:assert/strict");

function makeManifest(name, { capabilities = [], whenToUse, description, estimatedCost = "low" } = {}) {
  return {
    name,
    version: "1.0.0",
    description: description || `${name} block`,
    capabilities,
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    whenToUse: whenToUse || `Use ${name} when needed.`,
    dependsOn: [],
    incompatibleWith: [],
    estimatedCost,
    estimatedTokens: 100,
    timeoutMs: 1000,
    retryable: true,
  };
}

async function makeRegistry(names = []) {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const registry = new BlockRegistry();
  for (const manifest of names) {
    registry.register(manifest, () => manifest.name);
  }
  return registry;
}

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

test("RouterAgent.assessComplexity returns tiers", async () => {
  const { RouterAgent, ComplexityTier } = await import("../../../js/agents/runtime/router-agent.js");

  const agent = new RouterAgent();

  const simple = await agent.assessComplexity({ taskGoal: "Summarize" }, { sources: [{}, {}], totalChars: 1000 });
  assert.equal(simple, ComplexityTier.SIMPLE);

  const longGoal = "x".repeat(150);
  const moderate = await agent.assessComplexity({ taskGoal: longGoal }, { sources: new Array(5).fill({}) });
  assert.equal(moderate, ComplexityTier.MODERATE);

  const complex = await agent.assessComplexity(
    { taskGoal: "Why? What? How?", estimatedTime: 90 },
    { sources: [{ kind: "video" }], totalChars: 250000 }
  );
  assert.equal(complex, ComplexityTier.COMPLEX);
});

test("RouterAgent.selectBestBlock scores relevance", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const registry = await makeRegistry([
    makeManifest("scan", { capabilities: ["scan"] }),
    makeManifest("summarize", { capabilities: ["summarize"] }),
  ]);

  const agent = new RouterAgent({ blockRegistry: registry });
  const block = agent.selectBestBlock({ taskGoal: "Summarize the report" });
  assert.equal(block.name, "summarize");
});

test("RouterAgent pipelines are linear and stable", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const agent = new RouterAgent();

  assert.deepEqual(agent.getDefaultPipeline(), [
    { name: "scan", dependsOn: [] },
    { name: "gaps", dependsOn: ["scan"] },
    { name: "retrieve", dependsOn: ["gaps"] },
    { name: "understand", dependsOn: ["retrieve"] },
    { name: "write", dependsOn: ["understand"] },
  ]);

  assert.deepEqual(agent.getRecommendedPipeline(), [
    { name: "scan", dependsOn: [] },
    { name: "retrieve", dependsOn: ["scan"] },
    { name: "write", dependsOn: ["retrieve"] },
  ]);

  assert.deepEqual(agent.getEnhancedPipeline(), [
    { name: "scan", dependsOn: [] },
    { name: "gaps", dependsOn: ["scan"] },
    { name: "retrieve", dependsOn: ["gaps"] },
    { name: "understand", dependsOn: ["retrieve"] },
    { name: "write", dependsOn: ["understand"] },
    { name: "condense", dependsOn: ["write"] },
  ]);
});

test("RouterAgent.plan uses fixed pipeline for weak models", async () => {
  const { RouterAgent, ModelTier, ComplexityTier } = await import("../../../js/agents/runtime/router-agent.js");
  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelTier: ModelTier.WEAK });
  agent.assessComplexity = async () => ComplexityTier.COMPLEX;

  const plan = await agent.plan({ taskGoal: "Anything" }, { sources: [] });
  assert.equal(plan.mode, "fixed_pipeline");
  assert.deepEqual(plan.stages, agent.getDefaultPipeline());
});

test("RouterAgent.plan handles direct mode and emits events", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const { RouterEvents } = await import("../../../js/agents/runtime/events.js");
  const registry = await makeRegistry([makeManifest("summarize", { capabilities: ["summarize"] })]);
  const bus = makeEventBus();
  const agent = new RouterAgent({ blockRegistry: registry, eventBus: bus });

  const plan = await agent.plan({ taskGoal: "Summarize report" }, { sources: [] });

  assert.equal(plan.mode, "direct");
  assert.deepEqual(plan.stages, [{ name: "summarize", dependsOn: [] }]);

  const names = bus.events.map((evt) => evt.name);
  assert.ok(names.includes(RouterEvents.ROUTER_PLAN_START));
  assert.ok(names.includes(RouterEvents.ROUTER_COMPLEXITY_ASSESSED));
  assert.ok(names.includes(RouterEvents.ROUTER_BLOCK_SELECTED));
  assert.ok(names.includes(RouterEvents.ROUTER_PIPELINE_ASSEMBLED));
});

test("RouterAgent.plan selects recommended and enhanced pipelines", async () => {
  const { RouterAgent, ModelTier, ComplexityTier } = await import("../../../js/agents/runtime/router-agent.js");
  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelTier: ModelTier.STANDARD });

  agent.assessComplexity = async () => ComplexityTier.MODERATE;
  const moderatePlan = await agent.plan({ taskGoal: "Moderate" }, { sources: [] });
  assert.equal(moderatePlan.mode, "recommended_pipeline");
  assert.deepEqual(moderatePlan.stages, agent.getRecommendedPipeline());

  agent.assessComplexity = async () => ComplexityTier.COMPLEX;
  const complexPlan = await agent.plan({ taskGoal: "Complex" }, { sources: [] });
  assert.equal(complexPlan.mode, "enhanced_pipeline");
  assert.deepEqual(complexPlan.stages, agent.getEnhancedPipeline());
});

test("RouterAgent.plan assembles a DAG with strong models", async () => {
  const { RouterAgent, ModelTier, ComplexityTier } = await import("../../../js/agents/runtime/router-agent.js");
  const { ScanBlockManifest, RetrieveBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  let seenPrompt = "";
  const modelRouter = {
    chat: async (messages) => {
      seenPrompt = messages[0].content;
      return {
        content: JSON.stringify({
          stages: ["scan", "retrieve"],
          dependsOn: { retrieve: ["scan"] },
          reasoning: "ok",
        }),
      };
    },
  };

  const registry = await makeRegistry([ScanBlockManifest, RetrieveBlockManifest]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter, modelTier: ModelTier.STRONG });
  agent.assessComplexity = async () => ComplexityTier.COMPLEX;

  const plan = await agent.plan({ taskGoal: "Build pipeline" }, { sources: [] });
  assert.equal(plan.mode, "assembled_dag");
  assert.deepEqual(plan.stages, [
    { name: "scan", dependsOn: [] },
    { name: "retrieve", dependsOn: ["scan"] },
  ]);
  assert.ok(seenPrompt.includes("## scan (v1.0.0)"));
});

test("RouterAgent.assemblePipeline falls back on invalid response", async () => {
  const { RouterAgent, ModelTier } = await import("../../../js/agents/runtime/router-agent.js");

  const modelRouter = { chat: async () => ({ content: "nope" }) };
  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter, modelTier: ModelTier.STRONG });

  const pipeline = await agent.assemblePipeline({ taskGoal: "Task" }, { sources: [] });
  assert.equal(pipeline.mode, "enhanced_pipeline");
  assert.deepEqual(pipeline.stages, agent.getEnhancedPipeline());
});

test("RouterAgent.assemblePipeline supports modelRouter.call fallback signature", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");

  let calls = 0;
  const modelRouter = {
    call: async function (messages, options) {
      calls += 1;
      if (!Array.isArray(messages)) throw new Error("expected array");
      void options;
      return { content: JSON.stringify({ stages: ["scan"], dependsOn: {}, reasoning: "ok" }) };
    },
  };

  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter });
  const pipeline = await agent.assemblePipeline({ taskGoal: "Task" }, { sources: [] });

  assert.equal(calls, 2);
  assert.equal(pipeline.mode, "assembled_dag");
  assert.deepEqual(pipeline.stages, [{ name: "scan", dependsOn: [] }]);
});
