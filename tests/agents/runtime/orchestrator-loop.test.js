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

function makeDeps({
  analysis = { level: 0, requiredCapabilities: [] },
  plan = { stages: [] },
  dag = { nodes: [] },
  dagResult = { ok: true },
  compressed = { context: { ok: true }, metadata: { layersApplied: [] } },
  blocks,
} = {}) {
  const calls = {
    analyze: [],
    loadRequired: [],
    plan: [],
    assembleDAG: [],
    dagExecute: [],
    compress: [],
  };

  const requirementAnalyzer = {
    analyze: async (task, context) => {
      calls.analyze.push({ task, context });
      return analysis;
    },
  };

  const capabilityLoader = {
    blocks: {
      getBlockExecutor: (name) => (blocks ? blocks[name] : undefined),
    },
    loadRequired: async (caps) => {
      calls.loadRequired.push(caps);
    },
  };

  const routerAgent = {
    modelRouter: null,
    plan: async (task, context) => {
      calls.plan.push({ task, context });
      return plan;
    },
    assembleDAG: (stages) => {
      calls.assembleDAG.push(stages);
      return dag;
    },
  };

  const dagExecutor = {
    eventBus: null,
    execute: async (dagArg, runContext, input, blockApi) => {
      calls.dagExecute.push({ dag: dagArg, runContext, input, blockApi });
      return dagResult;
    },
  };

  const cicadaCompressor = {
    modelRouter: null,
    eventBus: null,
    compress: async (result, options) => {
      calls.compress.push({ result, options });
      return compressed;
    },
  };

  return {
    deps: { requirementAnalyzer, capabilityLoader, routerAgent, dagExecutor, cicadaCompressor },
    calls,
  };
}

test("OrchestratorLoop constructor uses default options and injected deps", async () => {
  const { OrchestratorLoop, defaultOptions } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const bus = makeEventBus();
  const { deps } = makeDeps();
  const loop = new OrchestratorLoop({ ...deps, eventBus: bus });

  assert.deepEqual(loop.opts, defaultOptions);
  assert.equal(loop.analyzer, deps.requirementAnalyzer);
  assert.equal(loop.loader, deps.capabilityLoader);
  assert.equal(loop.router, deps.routerAgent);
  assert.equal(loop.compressor, deps.cicadaCompressor);
  assert.equal(loop.dagExecutor, deps.dagExecutor);
});

test("OrchestratorLoop constructor merges custom options (withDefaults pattern)", async () => {
  const { OrchestratorLoop, defaultOptions } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { deps } = makeDeps();

  const loop = new OrchestratorLoop(deps, {
    timeout: 123,
    maxIterations: 7,
    enableCompression: false,
    compressionLayers: ["tool_output"],
  });

  assert.equal(loop.opts.timeout, 123);
  assert.equal(loop.opts.maxIterations, 7);
  assert.equal(loop.opts.enableCompression, false);
  assert.deepEqual(loop.opts.compressionLayers, ["tool_output"]);
  assert.deepEqual({ ...loop.opts, timeout: 0, maxIterations: 0, enableCompression: true, compressionLayers: defaultOptions.compressionLayers }, defaultOptions);

  const fallback = new OrchestratorLoop(deps, { timeout: "bad", maxIterations: NaN, compressionLayers: [] });
  assert.equal(fallback.opts.timeout, 0);
  assert.equal(fallback.opts.maxIterations, 0);
  assert.deepEqual(fallback.opts.compressionLayers, defaultOptions.compressionLayers);
});

test("OrchestratorLoop.run orchestrates analyze→load→plan→execute(DAG)→compress and emits events", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { RuntimeEvents } = await import("../../../js/agents/runtime/events.js");
  const { setRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/loop-runtime-state.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/stage-errors.js");

  const bus = makeEventBus();
  const analysis = { level: 3, requiredCapabilities: ["scan", "retrieve"] };
  const plan = { stages: [{ name: "scan", dependsOn: [] }] };
  const dag = { nodes: [{ id: "scan", block: "scan", dependsOn: [] }] };
  const dagResult = { results: { scan: { state: { ok: true } } }, checkpoints: [] };
  const compressed = { context: { trimmed: true }, metadata: { layersApplied: ["tool_output"], archiveId: "arch_1" } };
  const { deps, calls } = makeDeps({ analysis, plan, dag, dagResult, compressed });

  const loop = new OrchestratorLoop({ ...deps, eventBus: bus });
  const task = { taskGoal: "Test pipeline" };
  const controller = new AbortController();
  const context = { runId: "run_orch_1", eventBus: bus, sources: [{ id: 1 }], signal: controller.signal };

  const out = await loop.run(task, context);

  assert.deepEqual(out.analysis, analysis);
  assert.deepEqual(out.plan, plan);
  assert.deepEqual(out.result, dagResult);
  assert.deepEqual(out.compressed, compressed);

  assert.equal(calls.analyze.length, 1);
  assert.equal(calls.analyze[0].task, task);
  assert.equal(calls.analyze[0].context.runId, "run_orch_1");

  assert.equal(calls.loadRequired.length, 1);
  assert.deepEqual(calls.loadRequired[0], analysis.requiredCapabilities);

  assert.equal(calls.plan.length, 1);
  assert.equal(calls.plan[0].task, task);
  assert.equal(calls.plan[0].context.analysis, analysis);

  assert.equal(calls.assembleDAG.length, 1);
  assert.deepEqual(calls.assembleDAG[0], plan.stages);

  assert.equal(calls.dagExecute.length, 1);
  assert.equal(calls.dagExecute[0].dag.id, "run_orch_1");
  assert.deepEqual(calls.dagExecute[0].dag.nodes, dag.nodes);
  assert.deepEqual(calls.dagExecute[0].runContext, { runId: "run_orch_1" });
  assert.equal(calls.dagExecute[0].blockApi.eventBus, bus);
  assert.equal(calls.dagExecute[0].blockApi.signal, controller.signal);
  assert.equal(calls.dagExecute[0].blockApi.signal.aborted, false);
  assert.deepEqual(calls.dagExecute[0].input.sources, [{ id: 1 }]);

  assert.equal(calls.compress.length, 1);
  assert.equal(calls.compress[0].result, dagResult);
  assert.deepEqual(calls.compress[0].options, {
    layers: ["tool_output", "session_history", "llm_summary"],
    archiveKey: "run_orch_1",
  });

  const names = bus.events.map((evt) => evt.name);
  assert.deepEqual(names, [
    RuntimeEvents.RUN_STARTED,
    RuntimeEvents.STAGE_STARTED,
    RuntimeEvents.STAGE_COMPLETED,
    RuntimeEvents.STAGE_STARTED,
    RuntimeEvents.STAGE_COMPLETED,
    RuntimeEvents.STAGE_STARTED,
    RuntimeEvents.STAGE_COMPLETED,
    RuntimeEvents.STAGE_STARTED,
    RuntimeEvents.STAGE_COMPLETED,
    RuntimeEvents.STAGE_STARTED,
    RuntimeEvents.STAGE_COMPLETED,
    RuntimeEvents.RUN_COMPLETED,
  ]);

  const startedStages = bus.events
    .filter((evt) => evt.name === RuntimeEvents.STAGE_STARTED)
    .map((evt) => evt.record.payload.stage);
  assert.deepEqual(startedStages, ["analyze", "load_capabilities", "plan", "execute", "compress"]);

  const completedStages = bus.events
    .filter((evt) => evt.name === RuntimeEvents.STAGE_COMPLETED)
    .map((evt) => evt.record.payload.stage);
  assert.deepEqual(completedStages, ["analyze", "load_capabilities", "plan", "execute", "compress"]);

  assert.equal(bus.events[0].record.status, "started");
  assert.equal(bus.events.at(-1).record.status, "completed");
  assert.ok(bus.events.every((evt) => evt.record.actor === "orchestrator"));

  // When runtime is marked as paused, orchestrator should return paused state.
  const pausedController = new AbortController();
  setRuntimeState(pausedController.signal, {
    status: LoopRuntimeStatuses.PAUSED,
    pausedReason: "user",
    lastCheckpointId: "ckpt_1",
  });

  const pausedOut = await loop.run(task, {
    runId: "run_orch_pause",
    eventBus: bus,
    sources: [{ id: 1 }],
    signal: pausedController.signal,
  });

  assert.equal(pausedOut.paused, true);
  assert.equal(pausedOut.checkpointId, "ckpt_1");
  assert.equal(pausedOut.reason, "user");
});

test("OrchestratorLoop.run executes blocks sequentially when level < 3", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");

  const bus = makeEventBus();
  const analysis = { level: 0, requiredCapabilities: [] };
  const plan = {
    stages: [
      { name: "one", dependsOn: [] },
      { name: "two", dependsOn: ["one"] },
    ],
  };

  const inputs = [];
  const blocks = {
    one: async (_runContext, input) => ({ state: { id: "one" }, input }),
    two: async (_runContext, input) => {
      inputs.push(input);
      return { state: { id: "two" }, seen: input.state.id };
    },
  };

  const { deps, calls } = makeDeps({ analysis, plan, blocks });
  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false });

  const out = await loop.run({ taskGoal: "sequential" }, { runId: "run_seq", eventBus: bus });

  assert.equal(calls.dagExecute.length, 0);
  assert.ok(out.result.one);
  assert.ok(out.result.two);
  assert.equal(out.result.two.seen, "one");
  assert.deepEqual(inputs[0], out.result.one);
});

test("OrchestratorLoop.run respects signal cancellation and emits RUN_CANCELLED", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { RuntimeEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();
  const { deps, calls } = makeDeps();
  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false });

  const controller = new AbortController();
  controller.abort("stop");

  await assert.rejects(loop.run({ taskGoal: "cancel" }, { runId: "run_cancel", eventBus: bus, signal: controller.signal }), /stop/);

  assert.equal(calls.analyze.length, 0);
  assert.equal(calls.loadRequired.length, 0);
  assert.equal(calls.plan.length, 0);
  assert.equal(calls.compress.length, 0);

  const names = bus.events.map((evt) => evt.name);
  assert.deepEqual(names, [RuntimeEvents.RUN_STARTED, RuntimeEvents.STAGE_STARTED, RuntimeEvents.RUN_CANCELLED]);
  assert.equal(bus.events.at(-1).record.status, "cancelled");
  assert.equal(bus.events.at(-1).record.payload.error, "stop");
});

test("OrchestratorLoop.run emits RUN_FAILED when a stage throws", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { RuntimeEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();
  const { deps, calls } = makeDeps();
  deps.requirementAnalyzer.analyze = async () => {
    calls.analyze.push({ task: null, context: null });
    throw new Error("boom");
  };

  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false });
  await assert.rejects(loop.run({ taskGoal: "fail" }, { runId: "run_fail", eventBus: bus }), /boom/);

  assert.equal(calls.loadRequired.length, 0);
  assert.equal(calls.plan.length, 0);

  const names = bus.events.map((evt) => evt.name);
  assert.deepEqual(names, [RuntimeEvents.RUN_STARTED, RuntimeEvents.STAGE_STARTED, RuntimeEvents.RUN_FAILED]);
  assert.equal(bus.events.at(-1).record.status, "failed");
  assert.equal(bus.events.at(-1).record.payload.error, "boom");
});

test("OrchestratorLoop enforces maxIterations for block execution", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { RuntimeEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();
  const stageCalls = [];
  const blocks = {
    one: async () => {
      stageCalls.push("one");
      return { state: { id: 1 } };
    },
    two: async () => {
      stageCalls.push("two");
      return { state: { id: 2 } };
    },
  };

  const analysis = { level: 0, requiredCapabilities: [] };
  const plan = {
    stages: [
      { name: "one", dependsOn: [] },
      { name: "two", dependsOn: ["one"] },
    ],
  };

  const { deps } = makeDeps({ analysis, plan, blocks });
  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false, maxIterations: 1 });

  await assert.rejects(loop.run({ taskGoal: "iterate" }, { runId: "run_iter", eventBus: bus }), /max iterations reached/);
  assert.deepEqual(stageCalls, ["one"]);

  const completedStages = bus.events
    .filter((evt) => evt.name === RuntimeEvents.STAGE_COMPLETED)
    .map((evt) => evt.record.payload.stage);
  assert.ok(completedStages.includes("plan"));
  assert.ok(!completedStages.includes("execute"));
  assert.equal(bus.events.at(-1).name, RuntimeEvents.RUN_FAILED);
});

test("OrchestratorLoop timeout aborts the run via internal AbortController", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { RuntimeEvents } = await import("../../../js/agents/runtime/events.js");

  const bus = makeEventBus();
  const analysis = { level: 0, requiredCapabilities: ["scan"] };
  const plan = { stages: [] };
  const { deps, calls } = makeDeps({ analysis, plan });

  deps.requirementAnalyzer.analyze = async (_task, context) => {
    calls.analyze.push({ task: _task, context });
    await delay(30);
    return analysis;
  };

  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false, timeout: 10 });
  await assert.rejects(loop.run({ taskGoal: "timeout" }, { runId: "run_timeout", eventBus: bus }), /timeout/);

  assert.equal(calls.analyze.length, 1);
  assert.equal(calls.loadRequired.length, 0);
  assert.equal(bus.events.at(-1).name, RuntimeEvents.RUN_CANCELLED);
  assert.equal(bus.events.at(-1).record.payload.error, "timeout");
});

test("OrchestratorLoop.run captures StagePausedError and persists checkpointId to runStore", async () => {
  const { OrchestratorLoop } = await import("../../../js/agents/runtime/orchestrator-loop.js");
  const { setRuntimeState, LoopRuntimeStatuses } = await import("../../../js/agents/runtime/loop-runtime-state.js");

  const bus = makeEventBus();
  const { deps, calls } = makeDeps();
  const loop = new OrchestratorLoop({ ...deps, eventBus: bus }, { enableCompression: false });

  const controller = new AbortController();
  setRuntimeState(controller.signal, {
    status: LoopRuntimeStatuses.PAUSED,
    pausedReason: "user",
    lastCheckpointId: "ckpt_99",
  });

  const manifests = [];
  const runStore = {
    getManifest: async () => null,
    updateManifest: async (runId, manifest) => {
      manifests.push({ runId, manifest });
    },
  };

  const out = await loop.run(
    { taskGoal: "paused" },
    { runId: "run_orch_paused", eventBus: bus, signal: controller.signal, runStore }
  );

  assert.equal(out.paused, true);
  assert.equal(out.checkpointId, "ckpt_99");
  assert.equal(out.reason, "user");

  assert.equal(calls.analyze.length, 0);
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].runId, "run_orch_paused");
  assert.equal(manifests[0].manifest.runtime.status, "paused");
  assert.equal(manifests[0].manifest.runtime.pausedCheckpointId, "ckpt_99");
  assert.equal(manifests[0].manifest.runtime.pausedReason, "user");
});
