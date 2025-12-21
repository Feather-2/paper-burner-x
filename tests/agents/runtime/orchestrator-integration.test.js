const test = require("node:test");
const assert = require("node:assert/strict");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEventBus() {
  const events = [];
  return {
    events,
    emit: (name, record) => events.push({ name, record }),
  };
}

test("OrchestratorLoop integrates async compression hot-swap + review + archive checkpoints (sequential)", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { ArchiveEvents, CompressionEvents, ReviewEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();

  const archiveCalls = [];
  const archive = {
    save: async (runId, data) => {
      archiveCalls.push({ runId, data });
      await delay(15);
      return `${runId}:${data.timestamp}`;
    },
  };

  const reviewCalls = [];
  const reviewRules = {
    check: (stageId, result) => {
      reviewCalls.push({ stageId, result });
      return { pass: true, severity: "info", reason: "ok", suggestions: [] };
    },
  };

  const compressCalls = [];
  const cicadaCompressor = {
    modelRouter: null,
    eventBus: bus,
    compress: async (result, options) => {
      compressCalls.push({ result, options });
      return { context: { ...result, compressed: true } };
    },
  };

  const plan = {
    stages: [
      { name: "one", dependsOn: [] },
      { name: "two", dependsOn: ["one"] },
    ],
  };

  const requirementAnalyzer = {
    analyze: async () => ({ level: 0, requiredCapabilities: [] }),
  };

  const blocks = {
    one: async () => ({ id: "one", value: "raw" }),
    two: async (_runContext, _input, stageApi) => {
      const one = stageApi?.stageResults?.one;
      return { id: "two", sawCompressed: one?.compressed === true };
    },
  };

  const capabilityLoader = {
    blocks: {
      getBlockExecutor: (name) => blocks[name],
    },
    loadRequired: async () => {},
  };

  const routerAgent = {
    modelRouter: null,
    plan: async () => plan,
  };

  const loop = new OrchestratorLoop(
    {
      eventBus: bus,
      archive,
      reviewRules,
      cicadaCompressor,
      requirementAnalyzer,
      capabilityLoader,
      routerAgent,
    },
    { enableCompression: false }
  );

  const stageResults = {};
  const out = await loop.run({ taskGoal: "integration" }, { runId: "run_orch_integration", eventBus: bus, stageResults });

  assert.equal(out.compressed, null);
  assert.equal(out.result.two.sawCompressed, true);

  assert.deepEqual(
    reviewCalls.map((call) => call.stageId),
    ["one", "two"]
  );

  assert.ok(compressCalls.length >= 2);
  assert.deepEqual(compressCalls[0].options.layers, ["tool_output"]);

  assert.ok(archiveCalls.length >= 3);
  assert.equal(archiveCalls[0].data.metadata.stageId, "one");
  assert.equal(archiveCalls[0].data.nodeStates.one.compressed, undefined);
  assert.equal(archiveCalls[1].data.metadata.stageId, "two");
  assert.equal(archiveCalls[1].data.nodeStates.one.compressed, true);
  assert.equal(archiveCalls.at(-1).data.metadata.final, true);
  assert.equal(archiveCalls.at(-1).data.nodeStates.two.compressed, true);

  assert.equal(stageResults.one.compressed, true);
  assert.equal(stageResults.two.compressed, true);

  const eventNames = bus.events.map((evt) => evt.name);
  assert.ok(eventNames.includes(ReviewEvents.REVIEW_COMPLETED));
  assert.ok(eventNames.includes(CompressionEvents.COMPRESSION_SCHEDULED));
  assert.ok(eventNames.includes(CompressionEvents.COMPRESSION_APPLIED));
  assert.ok(eventNames.includes(ArchiveEvents.CHECKPOINT_SAVED));
});

test("OrchestratorLoop respects opts.enableReview/enableAsyncCompression toggles", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { ArchiveEvents, CompressionEvents, ReviewEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();

  const archiveCalls = [];
  const archive = {
    save: async (runId, data) => {
      archiveCalls.push({ runId, data });
      return `${runId}:${data.timestamp}`;
    },
  };

  const reviewCalls = [];
  const reviewRules = {
    check: (stageId) => {
      reviewCalls.push(stageId);
      return { pass: true, severity: "info", reason: "ok", suggestions: [] };
    },
  };

  const compressCalls = [];
  const cicadaCompressor = {
    modelRouter: null,
    eventBus: bus,
    compress: async (result) => {
      compressCalls.push(result);
      return { context: { ...result, compressed: true } };
    },
  };

  const plan = {
    stages: [
      { name: "one", dependsOn: [] },
      { name: "two", dependsOn: ["one"] },
    ],
  };

  const requirementAnalyzer = {
    analyze: async () => ({ level: 0, requiredCapabilities: [] }),
  };

  const blocks = {
    one: async () => ({ id: "one", value: "raw" }),
    two: async (_runContext, _input, stageApi) => ({
      id: "two",
      sawCompressed: stageApi?.stageResults?.one?.compressed === true,
    }),
  };

  const capabilityLoader = {
    blocks: {
      getBlockExecutor: (name) => blocks[name],
    },
    loadRequired: async () => {},
  };

  const routerAgent = {
    modelRouter: null,
    plan: async () => plan,
  };

  const loop = new OrchestratorLoop(
    {
      eventBus: bus,
      archive,
      reviewRules,
      cicadaCompressor,
      requirementAnalyzer,
      capabilityLoader,
      routerAgent,
    },
    { enableCompression: false, enableReview: false, enableAsyncCompression: false }
  );

  const stageResults = {};
  const out = await loop.run({ taskGoal: "integration" }, { runId: "run_orch_no_hooks", eventBus: bus, stageResults });

  assert.equal(out.result.two.sawCompressed, false);
  assert.deepEqual(reviewCalls, []);
  assert.deepEqual(compressCalls, []);
  assert.ok(archiveCalls.length >= 3);

  const eventNames = bus.events.map((evt) => evt.name);
  assert.ok(eventNames.includes(ArchiveEvents.CHECKPOINT_SAVED));
  assert.ok(!eventNames.includes(ReviewEvents.REVIEW_COMPLETED));
  assert.ok(!eventNames.includes(CompressionEvents.COMPRESSION_SCHEDULED));
});

