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

test("RouterAgent.assemblePipeline uses modelRouter.call and preserves dependencies", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");

  const calls = [];
  const modelRouter = {
    call: async ({ usage, messages }) => {
      calls.push({ usage, messages });
      return {
        content: JSON.stringify({
          stages: ["scan", "retrieve", "write", "condense"],
          dependsOn: { retrieve: ["scan"], write: ["retrieve"], condense: ["scan"] },
          reasoning: "ok",
        }),
      };
    },
  };

  const registry = await makeRegistry([makeManifest("scan"), makeManifest("retrieve"), makeManifest("write"), makeManifest("condense")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter });
  const pipeline = await agent.assemblePipeline({ taskGoal: "Task" }, { sources: [] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].usage, "planner");
  assert.equal(pipeline.mode, "assembled_dag");
  assert.deepEqual(pipeline.stages, [
    { name: "scan", dependsOn: [] },
    { name: "retrieve", dependsOn: ["scan"] },
    { name: "write", dependsOn: ["retrieve"] },
    { name: "condense", dependsOn: ["scan"] },
  ]);

  const dag = agent.assembleDAG(pipeline.stages);
  assert.deepEqual(dag.nodes, [
    { id: "scan", block: "scan", dependsOn: [] },
    { id: "retrieve", block: "retrieve", dependsOn: ["scan"] },
    { id: "write", block: "write", dependsOn: ["retrieve"] },
    { id: "condense", block: "condense", dependsOn: ["scan"] },
  ]);
});

test("RouterAgent.assemblePipeline falls back when modelRouter fails", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");

  const modelRouter = { call: async () => { throw new Error("boom"); } };
  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter });

  const pipeline = await agent.assemblePipeline({ taskGoal: "Task" }, { sources: [] });
  assert.equal(pipeline.mode, "enhanced_pipeline");
  assert.deepEqual(pipeline.stages, agent.getEnhancedPipeline());
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
      assert.equal(options.usage, "planner");
      return { content: JSON.stringify({ stages: ["scan"], dependsOn: {}, reasoning: "ok" }) };
    },
  };

  const registry = await makeRegistry([makeManifest("scan")]);
  const agent = new RouterAgent({ blockRegistry: registry, modelRouter });
  const pipeline = await agent.assemblePipeline({ taskGoal: "Task" }, { sources: [] });

  assert.equal(calls, 1);
  assert.equal(pipeline.mode, "assembled_dag");
  assert.deepEqual(pipeline.stages, [{ name: "scan", dependsOn: [] }]);
});

test("RouterAgent.evaluateComplexity computes routing metrics", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const agent = new RouterAgent();

  const metricsFromTokens = agent.evaluateComplexity(
    { taskGoal: "Summarize", estimatedTokens: 1200, needsExternalSearch: true },
    { sources: [{ type: "pdf" }, { type: "html" }] }
  );
  assert.equal(metricsFromTokens.estimatedTokens, 1200);
  assert.equal(metricsFromTokens.needsExternalSearch, true);
  assert.equal(metricsFromTokens.typeCount, 2);

  const metricsFromChars = agent.evaluateComplexity(
    { taskGoal: "Short goal" },
    { sources: [{ type: "pdf" }], totalChars: 8000 }
  );
  assert.equal(metricsFromChars.estimatedTokens, 2000);
  assert.equal(metricsFromChars.typeCount, 1);
});

test("RouterAgent.determineLevel maps metrics to levels", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const agent = new RouterAgent();

  assert.equal(agent.determineLevel({ sourceCount: 2, estimatedTokens: 4000 }), 0);
  assert.equal(agent.determineLevel({ sourceCount: 5, estimatedTokens: 15000 }), 1);
  assert.equal(agent.determineLevel({ sourceCount: 12, estimatedTokens: 25000, needsExternalSearch: true }), 2);
  assert.equal(agent.determineLevel({ sourceCount: 25, estimatedTokens: 40000 }), 3);
  assert.equal(agent.determineLevel({ sourceCount: 15, estimatedTokens: 40000 }), 1);
});

test("RouterAgent.assembleDAG builds nodes and parallel groups", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const agent = new RouterAgent();

  const linear = agent.assembleDAG(["scan", "retrieve", "write"]);
  assert.deepEqual(linear.nodes, [
    { id: "scan", block: "scan", dependsOn: [] },
    { id: "retrieve", block: "retrieve", dependsOn: ["scan"] },
    { id: "write", block: "write", dependsOn: ["retrieve"] },
  ]);

  const dag = agent.assembleDAG([
    { name: "classify" },
    { name: "ocr", dependsOn: ["classify"] },
    { name: "fetch", dependsOn: ["classify"] },
    { name: "merge", dependsOn: ["ocr", "fetch"] },
  ]);
  assert.ok(dag.parallelGroups.some((group) => group.includes("ocr") && group.includes("fetch")));
});

test("RouterAgent.routeTask executes DAG for Level 3", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const runContext = { runId: "run_1" };
  const blockApi = { emit: () => {} };
  let captured = null;

  const dagExecutor = {
    execute: async (...args) => {
      captured = args;
      return { ok: true };
    },
  };

  const agent = new RouterAgent({ dagExecutor });
  agent.evaluateComplexity = () => ({ sourceCount: 25, estimatedTokens: 40000 });
  agent.selectBlocks = () => ["scan", "write"];

  const result = await agent.routeTask({ taskGoal: "Task" }, { runContext, blockApi });
  assert.deepEqual(result, { ok: true });
  assert.ok(captured);
  assert.deepEqual(captured[0].nodes, [
    { id: "scan", block: "scan", dependsOn: [] },
    { id: "write", block: "write", dependsOn: ["scan"] },
  ]);
  assert.equal(captured[1], runContext);
  assert.equal(captured[2].taskGoal, "Task");
  assert.ok(captured[3]);
  assert.equal(captured[3].runContext, runContext);
  assert.equal(typeof captured[3].emit, "function");
  assert.ok(captured[3].signal);
  assert.equal(captured[3].signal.aborted, false);
});

test("RouterAgent.routeTask uses plan for levels 0-2", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  let executeCalls = 0;
  let planCalls = 0;

  const dagExecutor = {
    execute: async () => {
      executeCalls += 1;
    },
  };

  const agent = new RouterAgent({ dagExecutor });
  agent.plan = async () => {
    planCalls += 1;
    if (planCalls === 1) return { mode: "direct", stages: [] };
    if (planCalls === 2) return { mode: "recommended_pipeline", stages: [] };
    return { mode: "enhanced_pipeline", stages: [] };
  };

  agent.evaluateComplexity = () => ({ sourceCount: 1, estimatedTokens: 1000 });
  const level0 = await agent.routeTask({ taskGoal: "Simple" }, { sources: [] });
  assert.equal(level0.mode, "direct");

  agent.evaluateComplexity = () => ({ sourceCount: 5, estimatedTokens: 10000 });
  const level1 = await agent.routeTask({ taskGoal: "Medium" }, { sources: [] });
  assert.equal(level1.mode, "recommended_pipeline");

  agent.evaluateComplexity = () => ({ sourceCount: 12, estimatedTokens: 25000, needsExternalSearch: true });
  const level2 = await agent.routeTask({ taskGoal: "Search" }, { sources: [] });
  assert.equal(level2.mode, "enhanced_pipeline");

  assert.equal(executeCalls, 0);
  assert.equal(planCalls, 3);
});

test("RouterAgent.routeTask emits skipped events when conditions are false", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };

  const registry = {
    getBlockExecutor: () => async () => ({ state: { ok: true } }),
  };

  const dagExecutor = new BlockDAGExecutor(registry, { eventBus: bus, parallel: false });
  const agent = new RouterAgent({ dagExecutor });

  agent.evaluateComplexity = () => ({ sourceCount: 25, estimatedTokens: 40000 });
  agent.selectBlocks = () => [
    { name: "a", condition: () => false },
    { name: "b", dependsOn: ["a"] },
  ];

  const out = await agent.routeTask({ taskGoal: "Task" }, { runContext: { runId: "run_router" }, eventBus: bus });
  assert.deepEqual(out, { results: {}, checkpoints: [] });

  const skippedA = events.find((evt) => evt.name === "a.skipped");
  assert.ok(skippedA);
  assert.equal(skippedA.record.status, "skipped");
  assert.equal(skippedA.record.payload.reason, "condition_false");

  const skippedB = events.find((evt) => evt.name === "b.skipped");
  assert.ok(skippedB);
  assert.equal(skippedB.record.payload.reason, "dependency_skipped");
});

test("RouterAgent.routeTask surfaces StageTimeoutError for Level 3 DAG execution", async () => {
  const { RouterAgent } = await import("../../../js/agents/runtime/router-agent.js");
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };

  const registry = {
    getBlockExecutor: () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { state: { ok: true } };
    },
  };

  const dagExecutor = new BlockDAGExecutor(registry, { eventBus: bus, parallel: false });
  const agent = new RouterAgent({ dagExecutor });

  agent.evaluateComplexity = () => ({ sourceCount: 25, estimatedTokens: 40000 });
  agent.selectBlocks = () => [{ name: "slow", timeoutMs: 5 }];

  await assert.rejects(
    () => agent.routeTask({ taskGoal: "Task" }, { runContext: { runId: "run_router" }, eventBus: bus }),
    (err) => {
      assert.equal(err?.name, "StageTimeoutError");
      return true;
    }
  );

  const failed = events.find((evt) => evt.name === "slow.failed");
  assert.ok(failed);
  assert.equal(failed.record.payload.name, "StageTimeoutError");
  assert.equal(failed.record.payload.stageName, "slow");
  assert.equal(failed.record.payload.timeoutMs, 5);
});
