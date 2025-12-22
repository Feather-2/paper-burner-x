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
    saveCheckpoint: ({ checkpointId, strategy } = {}) => {
      saveCalls.push({ id, checkpointId, strategy });
      return {
        checkpointId,
        stateSnapshot: {
          id,
          L0: { sources: strategy === "full" ? [{ sourceId: id }] : [] },
        },
      };
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
  assert.ok(saveCalls.every((call) => call.strategy === "full"));
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].dagId, "dag_checkpoint");
  assert.ok(checkpoints[1].completedNodes.includes("one"));
  assert.ok(checkpoints[1].completedNodes.includes("two"));
  assert.equal(checkpoints[1].nodeStates.two.L0.sources[0].sourceId, "two");

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

test("BlockDAGExecutor emits StageTimeoutError payload on timeout", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  const registry = await makeRegistry([
    {
      name: "slow",
      stageFn: async () => {
        await delay(50);
        return { state: { ok: true } };
      },
    },
  ]);

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };
  const executor = new BlockDAGExecutor(registry, { eventBus: bus, parallel: false });

  const dag = { nodes: [{ id: "slow", block: "slow", dependsOn: [], timeoutMs: 5 }] };
  await assert.rejects(
    () => executor.execute(dag, {}, {}),
    (err) => {
      assert.equal(err?.name, "StageTimeoutError");
      return true;
    }
  );

  const failed = events.find((evt) => evt.name === "slow.failed");
  assert.ok(failed);
  assert.equal(failed.record.status, "failed");
  assert.equal(failed.record.payload.name, "StageTimeoutError");
  assert.equal(failed.record.payload.stageName, "slow");
  assert.equal(failed.record.payload.timeoutMs, 5);
});

test("BlockDAGExecutor skips nodes when condition returns false", async () => {
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");

  let calls = 0;
  const registry = await makeRegistry([
    {
      name: "a",
      stageFn: async () => {
        calls += 1;
        return { state: { ok: true } };
      },
    },
    {
      name: "b",
      stageFn: async () => {
        calls += 1;
        return { state: { ok: true } };
      },
    },
  ]);

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };
  const executor = new BlockDAGExecutor(registry, { eventBus: bus, parallel: false });

  const dag = {
    nodes: [
      { id: "a", block: "a", dependsOn: [], condition: () => false },
      { id: "b", block: "b", dependsOn: ["a"] },
    ],
  };

  const { results } = await executor.execute(dag, {}, {});
  assert.deepEqual(results, {});
  assert.equal(calls, 0);

  const skippedA = events.find((evt) => evt.name === "a.skipped");
  assert.ok(skippedA);
  assert.equal(skippedA.record.status, "skipped");
  assert.equal(skippedA.record.payload.reason, "condition_false");

  const skippedB = events.find((evt) => evt.name === "b.skipped");
  assert.ok(skippedB);
  assert.equal(skippedB.record.payload.reason, "dependency_skipped");
});

test("AgentOrchestrator.runDAG cancels same-layer stages on failure", async () => {
  const { AgentOrchestrator } = await import("../../../js/agents/runtime/orchestrator.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };

  const orchestrator = new AgentOrchestrator({ eventBus: bus });
  let cancelledSeen = false;

  orchestrator.registerStage(
    "slow",
    async (_runContext, _input, stageApi) => {
      stageApi.signal.addEventListener(
        "abort",
        () => {
          cancelledSeen = true;
        },
        { once: true }
      );
      await delay(80);
      return { ok: true };
    },
    { dependsOn: [] }
  );

  orchestrator.registerStage(
    "fail",
    async () => {
      await delay(10);
      throw new Error("boom");
    },
    { dependsOn: [] }
  );

  await assert.rejects(() => orchestrator.runDAG({ parallel: true }), /boom/);
  assert.equal(cancelledSeen, true);

  const slowFailed = events.find((evt) => evt.name === "slow.failed");
  assert.ok(slowFailed);
  assert.equal(slowFailed.record.status, "failed");
  assert.equal(slowFailed.record.payload.name, "StageCancelledError");
});

test("AgentOrchestrator.runStage emits StageTimeoutError payload", async () => {
  const { AgentOrchestrator } = await import("../../../js/agents/runtime/orchestrator.js");

  const events = [];
  const bus = { emit: (name, record) => events.push({ name, record }) };

  const orchestrator = new AgentOrchestrator({ eventBus: bus });

  orchestrator.registerStage(
    "slow",
    async () => {
      await delay(40);
      return { ok: true };
    },
    { timeoutMs: 5 }
  );

  await assert.rejects(
    () => orchestrator.runStage("slow", {}),
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
