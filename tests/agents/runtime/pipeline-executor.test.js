const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModules() {
  const [{ PipelineExecutor }, { Archive, MapAdapter }, { BlockDAGExecutor }] = await Promise.all([
    import("../../../js/agents/runtime/pipeline-executor.js"),
    import("../../../js/agents/shared/archive.js"),
    import("../../../js/agents/runtime/block-dag-executor.js"),
  ]);
  return { PipelineExecutor, Archive, MapAdapter, BlockDAGExecutor };
}

function makeRegistry(executors) {
  const table = executors && typeof executors === "object" ? executors : {};
  return {
    getBlockExecutor: (name) => table[name],
  };
}

test("PipelineExecutor.buildDAG converts stages into DAG nodes", async () => {
  const { PipelineExecutor } = await loadModules();
  const executor = new PipelineExecutor(makeRegistry({}));

  const nodes = executor.buildDAG([
    "a",
    "   ",
    { name: "b", dependsOn: ["a"] },
    { id: "c", block: "c_block", dependsOn: "a,b", timeoutMs: 123, condition: () => true },
    { bogus: true },
  ]).nodes;

  assert.equal(nodes.length, 3);
  assert.deepEqual(nodes[0], { id: "a", block: "a", dependsOn: [] });
  assert.deepEqual(nodes[1], { id: "b", block: "b", dependsOn: ["a"] });
  assert.equal(nodes[2].id, "c");
  assert.equal(nodes[2].block, "c_block");
  assert.deepEqual(nodes[2].dependsOn, ["a", "b"]);
  assert.equal(nodes[2].timeoutMs, 123);
  assert.equal(typeof nodes[2].condition, "function");
});

test("PipelineExecutor.quickCheck marks suspicious outputs without decision", async () => {
  const { PipelineExecutor } = await loadModules();
  const executor = new PipelineExecutor(makeRegistry({}));

  assert.deepEqual(executor.quickCheck("s", null), { needsReview: true, reason: "empty_result" });
  assert.deepEqual(executor.quickCheck("s", {}), { needsReview: true, reason: "empty_result" });
  assert.deepEqual(executor.quickCheck("s", { error: "boom" }), { needsReview: true, reason: "has_error" });
  assert.deepEqual(executor.quickCheck("s", { _error: "boom" }), { needsReview: true, reason: "has_error" });
  assert.deepEqual(executor.quickCheck("s", { confidence: 0.4 }), { needsReview: true, reason: "low_confidence" });
  assert.deepEqual(executor.quickCheck("s", { confidence: 0.5 }), { needsReview: false });
  assert.deepEqual(executor.quickCheck("s", { ok: true }), { needsReview: false });
});

test("PipelineExecutor.execute runs pipeline and stores checkpoints", async () => {
  const { PipelineExecutor, Archive, MapAdapter } = await loadModules();

  const calls = { a: 0, b: 0 };
  const seen = { runIds: [], apis: [] };

  const registry = makeRegistry({
    a: async (runContext, input, api) => {
      calls.a += 1;
      seen.runIds.push(runContext?.runId);
      seen.apis.push(api);
      return { state: { value: (input?.seed ?? 0) + 1 } };
    },
    b: async (_runContext, input) => {
      calls.b += 1;
      return { state: { value: input.state.value + 1 }, confidence: 0.9 };
    },
  });

  const archive = new Archive(new MapAdapter());
  const executor = new PipelineExecutor(registry, { checkpointStore: archive, parallel: false });

  const pipeline = {
    id: "pipe_exec",
    stages: [
      { name: "a" },
      { name: "b", dependsOn: ["a"] },
    ],
  };

  const { results, checkpoints } = await executor.execute(pipeline, { seed: 1 }, { blockApi: { marker: "ok" } });
  assert.equal(calls.a, 1);
  assert.equal(calls.b, 1);
  assert.equal(seen.runIds[0], "pipe_exec");
  assert.equal(seen.apis[0]?.marker, "ok");

  assert.equal(results.a.state.value, 2);
  assert.equal(results.b.state.value, 3);
  assert.equal(checkpoints.length, 2);

  const snapA = await archive.load("pipe_exec:ckpt_a_1");
  assert.deepEqual(snapA?.nodeStates, { a: { value: 2 } });
  assert.equal(snapA?.metadata?.dagCheckpointId, "ckpt_a_1");
  assert.deepEqual(snapA?.metadata?.completedNodes, ["a"]);
  assert.equal(snapA?.metadata?.pipeline?.id, "pipe_exec");
  assert.deepEqual(snapA?.metadata?.initialInput, { seed: 1 });

  const snapB = await archive.load("pipe_exec:ckpt_b_2");
  assert.equal(snapB?.metadata?.dagCheckpointId, "ckpt_b_2");
  assert.ok(snapB?.nodeStates?.b);
});

test("PipelineExecutor.resume restores from checkpoint and skips completed stages", async () => {
  const { PipelineExecutor, Archive, MapAdapter } = await loadModules();

  const calls = { a: 0, b: 0 };
  const registry = makeRegistry({
    a: async (_runContext, input) => {
      calls.a += 1;
      return { state: { value: (input?.seed ?? 0) + 1 } };
    },
    b: async (_runContext, input) => {
      calls.b += 1;
      return { state: { value: input.state.value + 1 } };
    },
  });

  const archive = new Archive(new MapAdapter());
  const executor = new PipelineExecutor(registry, { checkpointStore: archive, parallel: false });

  const pipeline = {
    id: "pipe_resume",
    stages: ["a", { name: "b", dependsOn: ["a"] }],
  };

  await executor.execute(pipeline, { seed: 5 }, {});
  assert.deepEqual(calls, { a: 1, b: 1 });

  const { results, checkpoints } = await executor.resume("pipe_resume", "ckpt_a_1", {});
  assert.deepEqual(calls, { a: 1, b: 2 });
  assert.equal(results.a.state.value, 6);
  assert.equal(results.b.state.value, 7);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].checkpointId, "ckpt_b_2");
});

test("PipelineExecutor.execute resolves pipeline IDs from context and checkpoint store", async () => {
  const { PipelineExecutor, Archive, MapAdapter } = await loadModules();

  const registry = makeRegistry({
    x: async () => ({ state: { ok: true } }),
  });

  const pipeline = { id: "pipe_lookup", stages: ["x"] };

  const archive = new Archive(new MapAdapter());
  await archive.save("pipe_ckpt", { nodeStates: {}, timestamp: "meta", metadata: { pipeline } });

  const executor = new PipelineExecutor(registry, { checkpointStore: archive, parallel: false });

  const ctxMap = { pipelines: new Map([["pipe_map", pipeline]]) };
  const viaMap = await executor.execute("pipe_map", {}, ctxMap);
  assert.equal(viaMap.results.x.state.ok, true);

  const ctxFn = { getPipeline: async () => pipeline };
  const viaFn = await executor.execute("pipe_fn", {}, ctxFn);
  assert.equal(viaFn.results.x.state.ok, true);

  const viaCheckpoint = await executor.execute("pipe_ckpt", {}, {});
  assert.equal(viaCheckpoint.results.x.state.ok, true);
});

test("PipelineExecutor surfaces invalid inputs early", async () => {
  const { PipelineExecutor, Archive, MapAdapter } = await loadModules();

  assert.throws(() => new PipelineExecutor(null), /blockRegistry/);

  const executor = new PipelineExecutor(makeRegistry({}));
  await assert.rejects(() => executor.execute({ id: "bad", stages: [] }, {}), /stages must be a non-empty array/);
  await assert.rejects(() => executor.execute("missing", {}), /pipeline must be a Pipeline object or pipeline ID/);
  await assert.rejects(() => executor.execute({ id: "bad:1", stages: ["x"] }, {}), /must not include ':'/);

  const archive = new Archive(new MapAdapter());
  const withStore = new PipelineExecutor(makeRegistry({}), { checkpointStore: archive });
  await assert.rejects(() => withStore.resume("", "x"), /pipelineId must be a non-empty string/);
  await assert.rejects(() => withStore.resume("run", ""), /checkpointId must be a non-empty string/);

  const withoutRestore = new PipelineExecutor(makeRegistry({}), { checkpointStore: { save: async () => {} } });
  await assert.rejects(() => withoutRestore.resume("run", "x"), /checkpointStore with restore\(\) is required/);
});

test("PipelineExecutor integrates with BlockDAGExecutor semantics", async () => {
  const { PipelineExecutor, BlockDAGExecutor } = await loadModules();

  const registry = makeRegistry({
    a: async (_ctx, input) => ({ state: { v: (input?.seed ?? 0) + 1 } }),
    b: async (_ctx, input) => ({ state: { v: input.state.v + 1 } }),
  });

  const pipeline = { id: "pipe_compare", stages: ["a", { name: "b", dependsOn: ["a"] }] };
  const pipelineExecutor = new PipelineExecutor(registry, { parallel: false });
  const dagExecutor = new BlockDAGExecutor(registry, { parallel: false });

  const fromPipeline = await pipelineExecutor.execute(pipeline, { seed: 10 }, {});
  const dag = { id: "pipe_compare", nodes: pipelineExecutor.buildDAG(pipeline.stages).nodes };
  const fromDag = await dagExecutor.execute(dag, { runId: "pipe_compare" }, { seed: 10 }, {});

  assert.deepEqual(fromPipeline.results, fromDag.results);
});

