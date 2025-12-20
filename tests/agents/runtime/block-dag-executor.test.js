const test = require("node:test");
const assert = require("node:assert/strict");

function makeManifest(name) {
  return {
    name,
    version: "1.0.0",
    description: `${name} block`,
    capabilities: [],
    input: { type: "object", properties: { state: { type: "object" } } },
    output: { type: "object", properties: { ok: { type: "boolean" } } },
    whenToUse: `Use ${name} when needed.`,
    dependsOn: [],
    incompatibleWith: [],
    estimatedCost: "low",
    estimatedTokens: 1,
    timeoutMs: 1000,
    retryable: false,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRegistry(entries) {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");
  const registry = new BlockRegistry();
  for (const { name, stageFn } of entries) {
    registry.registerWithExecutor(makeManifest(name), stageFn);
  }
  return registry;
}

test("BlockDAGExecutor.topologicalSort builds sorted layers", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");
  const registry = await makeRegistry([]);
  const executor = new BlockDAGExecutor(registry);

  const dag = {
    nodes: [
      { id: "scan", block: "scan", dependsOn: [] },
      { id: "gaps", block: "gaps", dependsOn: ["scan"] },
      { id: "retrieve", block: "retrieve", dependsOn: ["gaps"] },
      { id: "understand", block: "understand", dependsOn: ["retrieve"] },
      { id: "write", block: "write", dependsOn: ["understand"] },
      { id: "condense", block: "condense", dependsOn: ["understand"] },
    ],
  };

  const plan = executor.topologicalSort(dag);
  const layers = executor.buildLayers(plan.sorted, dag);

  assert.equal(layers[0][0], "scan");
  assert.ok(plan.sorted.indexOf("scan") < plan.sorted.indexOf("gaps"));
  assert.ok(plan.sorted.indexOf("understand") < plan.sorted.indexOf("write"));
});

test("BlockDAGExecutor executes layers in parallel", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const times = { a: {}, b: {} };
  const registry = await makeRegistry([
    {
      name: "a",
      stageFn: async () => {
        times.a.start = Date.now();
        await delay(60);
        times.a.end = Date.now();
        return { state: { id: "a" }, ok: true };
      },
    },
    {
      name: "b",
      stageFn: async () => {
        times.b.start = Date.now();
        await delay(60);
        times.b.end = Date.now();
        return { state: { id: "b" }, ok: true };
      },
    },
  ]);

  const executor = new BlockDAGExecutor(registry, { parallel: true });
  const dag = {
    nodes: [
      { id: "a", block: "a", dependsOn: [] },
      { id: "b", block: "b", dependsOn: [] },
    ],
  };

  const { results } = await executor.execute(dag, {}, { seed: true });
  assert.ok(times.a.start < times.b.end);
  assert.ok(times.b.start < times.a.end);
  assert.equal(Object.keys(results).length, 2);
});

test("BlockDAGExecutor saves checkpoints and emits checkpoint events", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const saveCalls = [];
  const makeState = (id) => ({
    id,
    saveCheckpoint: ({ checkpointId } = {}) => {
      saveCalls.push({ id, checkpointId });
      return { checkpointId, stateSnapshot: { id } };
    },
    toJSON: () => ({ id }),
  });

  const registry = await makeRegistry([
    {
      name: "one",
      stageFn: async () => ({ state: makeState("one"), ok: true }),
    },
    {
      name: "two",
      stageFn: async () => ({ state: makeState("two"), ok: true }),
    },
  ]);

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };
  const executor = new BlockDAGExecutor(registry, { eventBus: bus });

  const dag = {
    id: "dag_checkpoint",
    nodes: [
      { id: "one", block: "one", dependsOn: [] },
      { id: "two", block: "two", dependsOn: ["one"] },
    ],
  };

  const { checkpoints } = await executor.execute(dag, {}, {});

  assert.equal(saveCalls.length, 2);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].dagId, "dag_checkpoint");
  assert.ok(checkpoints[1].completedNodes.includes("one"));
  assert.ok(checkpoints[1].completedNodes.includes("two"));
  assert.deepEqual(checkpoints[1].nodeStates.two, { id: "two" });

  const checkpointEvents = events.filter((evt) => evt.name === "dag.checkpoint");
  assert.equal(checkpointEvents.length, 2);
  assert.equal(checkpointEvents[0].record.payload.nodeId, "one");
  assert.ok(checkpointEvents[0].record.payload.checkpointId);
});

test("BlockDAGExecutor resumes from checkpoint and skips completed nodes", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  let firstCalls = 0;
  let seenInput;
  const registry = await makeRegistry([
    {
      name: "first",
      stageFn: async () => {
        firstCalls += 1;
        return { state: { value: 1 }, ok: true };
      },
    },
    {
      name: "second",
      stageFn: async (_ctx, input) => {
        seenInput = input;
        return { state: { value: input.state.value + 1 }, ok: true };
      },
    },
  ]);

  const executor = new BlockDAGExecutor(registry);
  const dag = {
    id: "dag_resume",
    nodes: [
      { id: "first", block: "first", dependsOn: [] },
      { id: "second", block: "second", dependsOn: ["first"] },
    ],
  };

  const checkpoint = {
    dagId: "dag_resume",
    completedNodes: ["first"],
    nodeStates: { first: { value: 1 } },
    timestamp: new Date().toISOString(),
  };

  const { results, checkpoints } = await executor.resume(dag, {}, checkpoint, {});
  assert.equal(firstCalls, 0);
  assert.equal(seenInput.state.value, 1);
  assert.equal(results.second.state.value, 2);
  assert.equal(checkpoints.length, 1);
});

test("BlockDAGExecutor continues independent nodes on error when configured", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  let bCalls = 0;
  let cCalls = 0;
  const registry = await makeRegistry([
    {
      name: "a",
      stageFn: async () => {
        throw new Error("boom");
      },
    },
    {
      name: "b",
      stageFn: async () => {
        bCalls += 1;
        return { state: { ok: true }, ok: true };
      },
    },
    {
      name: "c",
      stageFn: async () => {
        cCalls += 1;
        return { state: { ok: true }, ok: true };
      },
    },
  ]);

  const executor = new BlockDAGExecutor(registry, { continueOnError: true });
  const dag = {
    nodes: [
      { id: "a", block: "a", dependsOn: [] },
      { id: "b", block: "b", dependsOn: [] },
      { id: "c", block: "c", dependsOn: ["a"] },
    ],
  };

  const { results } = await executor.execute(dag, {}, {});
  assert.equal(bCalls, 1);
  assert.equal(cCalls, 0);
  assert.ok(results.b);
});

test("BlockDAGExecutor fails fast by default", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const registry = await makeRegistry([
    {
      name: "fail",
      stageFn: async () => {
        throw new Error("kaput");
      },
    },
  ]);

  const executor = new BlockDAGExecutor(registry);
  const dag = { nodes: [{ id: "fail", block: "fail", dependsOn: [] }] };

  await assert.rejects(() => executor.execute(dag, {}, {}), /kaput/);
});

test("BlockDAGExecutor reports missing executors", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");
  const registry = await makeRegistry([]);
  const executor = new BlockDAGExecutor(registry, { continueOnError: false });

  const dag = { nodes: [{ id: "missing", block: "missing", dependsOn: [] }] };
  await assert.rejects(() => executor.execute(dag, {}, {}), /missing executor/i);
});
