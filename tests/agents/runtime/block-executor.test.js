const test = require("node:test");
const assert = require("node:assert/strict");

function createManifest(overrides = {}) {
  const base = {
    name: "demo",
    version: "1.0.0",
    description: "Demo block for executor tests.",
    capabilities: [],
    input: {
      type: "object",
      properties: {
        value: { type: "string" },
        count: { type: "number", default: 1 },
      },
      required: ["value"],
    },
    output: {
      type: "object",
      properties: {
        result: { type: "string" },
        total: { type: "number" },
      },
      required: ["result"],
    },
    whenToUse: "Use for executor test coverage.",
    dependsOn: [],
    incompatibleWith: [],
    estimatedCost: "low",
    estimatedTokens: 1,
    timeoutMs: 1000,
    retryable: false,
  };

  return { ...base, ...overrides };
}

function createBlockApi() {
  const events = [];
  return {
    events,
    emit: (name, record) => {
      events.push({ name, record });
    },
  };
}

test("BlockExecutor: normalizes input and maps output", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest();
  let seenInput;
  const stageFn = async (_ctx, input) => {
    seenInput = input;
    return { state: { ok: true }, result: "done", total: 2, extra: "ignore" };
  };

  const executor = createBlockExecutor(stageFn, manifest);
  const result = await executor({ runId: "run_1" }, { value: "x", extra: "drop" }, {});

  assert.deepEqual(seenInput, { value: "x", count: 1 });
  assert.deepEqual(result, { state: { ok: true }, result: "done", total: 2 });
});

test("BlockExecutor: emits lifecycle events", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest();
  const stageFn = async () => ({ state: { ok: true }, result: "ok", total: 3 });
  const blockApi = createBlockApi();

  const executor = createBlockExecutor(stageFn, manifest);
  await executor({}, { value: "x" }, blockApi);

  assert.equal(blockApi.events.length, 2);
  assert.equal(blockApi.events[0].name, "dag.node.started");
  assert.equal(blockApi.events[0].record.status, "started");
  assert.equal(blockApi.events[0].record.payload.block, manifest.name);
  assert.equal(blockApi.events[0].record.payload.attempt, 1);

  assert.equal(blockApi.events[1].name, "dag.node.completed");
  assert.equal(blockApi.events[1].record.status, "completed");
  assert.equal(blockApi.events[1].record.payload.block, manifest.name);
  assert.ok(blockApi.events[1].record.durationMs >= 0);
});

test("BlockExecutor: invalid input types throw", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest();
  const stageFn = async () => ({ state: { ok: true }, result: "ok" });
  const executor = createBlockExecutor(stageFn, manifest);

  await assert.rejects(() => executor({}, { value: 123 }, {}), /Input value must be string/);
  await assert.rejects(() => executor({}, "nope", {}), /input must be an object/i);
});

test("BlockExecutor: missing required output throws", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest();
  const stageFn = async () => ({ state: { ok: true }, total: 2 });
  const executor = createBlockExecutor(stageFn, manifest);

  await assert.rejects(() => executor({}, { value: "x" }, {}), /Missing required output: result/);
});

test("BlockExecutor: retryable blocks retry once", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest({ retryable: true });
  const blockApi = createBlockApi();
  let calls = 0;

  const stageFn = async () => {
    calls += 1;
    if (calls === 1) throw new Error("first failure");
    return { state: { ok: true }, result: "ok" };
  };

  const executor = createBlockExecutor(stageFn, manifest);
  const result = await executor({}, { value: "x" }, blockApi);

  assert.equal(calls, 2);
  assert.equal(blockApi.events.filter((evt) => evt.name === "dag.node.started").length, 2);
  assert.equal(blockApi.events.filter((evt) => evt.name === "dag.node.completed").length, 1);
  assert.deepEqual(result, { state: { ok: true }, result: "ok" });
});

test("BlockExecutor: non-retryable blocks fail fast", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");

  const manifest = createManifest({ retryable: false });
  const blockApi = createBlockApi();
  let calls = 0;

  const stageFn = async () => {
    calls += 1;
    throw new Error("boom");
  };

  const executor = createBlockExecutor(stageFn, manifest);

  await assert.rejects(() => executor({}, { value: "x" }, blockApi), /boom/);
  assert.equal(calls, 1);
  assert.equal(blockApi.events[blockApi.events.length - 1].name, "dag.node.failed");
});

test("BlockExecutor: validation and registry helpers", async () => {
  const { createBlockExecutor } = await import("../../../js/agents/runtime/block-executor.js");
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");

  const manifest = createManifest();

  assert.throws(() => createBlockExecutor("nope", manifest), /stageFn must be a function/);
  assert.throws(() => createBlockExecutor(() => {}, { name: "bad" }), /Invalid block manifest/);

  const registry = new BlockRegistry();
  const executor = registry.registerWithExecutor(manifest, async () => ({ state: {}, result: "ok" }));
  assert.equal(registry.getBlockExecutor(manifest.name), executor);
});
