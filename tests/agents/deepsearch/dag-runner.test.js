const test = require("node:test");
const assert = require("node:assert/strict");

function makeStubExecutor(name) {
  return async (_ctx, input) => {
    const prev = Array.isArray(input?.state?.executed) ? input.state.executed : [];
    const executed = [...prev, name];
    return { state: { executed } };
  };
}

test("DeepSearch blocks register with executors", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { registerDeepSearchBlocks } = await import("../../../js/agents/stages/deepsearch/blocks.js");
  const {
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  } = await import("../../../js/agents/shared/block-manifest.js");

  const registry = new BlockRegistry();
  registerDeepSearchBlocks(registry);

  const manifests = [
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  ];

  for (const manifest of manifests) {
    const executor = registry.getExecutor(manifest.name);
    assert.equal(typeof executor, "function");
    assert.equal(registry.getManifest(manifest.name), manifest);
  }
});

test("DEEPSEARCH_DAG builds a valid plan", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");
  const { DEEPSEARCH_DAG } = await import("../../../js/agents/stages/deepsearch/blocks.js");

  const executor = new BlockDAGExecutor(new BlockRegistry());
  const plan = executor.topologicalSort(DEEPSEARCH_DAG);
  const layers = executor.buildLayers(plan.sorted, DEEPSEARCH_DAG);

  assert.ok(plan.sorted.includes("scan"));
  assert.ok(plan.sorted.indexOf("scan") < plan.sorted.indexOf("gaps"));
  assert.ok(plan.sorted.indexOf("retrieve") < plan.sorted.indexOf("understand"));
  assert.ok(plan.sorted.indexOf("understand") < plan.sorted.indexOf("write"));
  assert.ok(layers.length >= 4);
});

test("DeepSearch DAG runner works with mocked executors", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { BlockDAGExecutor } = await import("../../../js/agents/runtime/block-dag-executor.js");
  const { DEEPSEARCH_DAG } = await import("../../../js/agents/stages/deepsearch/blocks.js");
  const { DeepSearchBlockManifests } = await import("../../../js/agents/shared/block-manifest.js");

  const registry = new BlockRegistry();
  for (const manifest of DeepSearchBlockManifests) {
    registry.register(manifest, makeStubExecutor(manifest.name));
  }

  const executor = new BlockDAGExecutor(registry, { parallel: false });
  const { results } = await executor.execute(DEEPSEARCH_DAG, { runId: "dag_test" }, { sources: [] });

  assert.ok(results.write);
  assert.ok(results.condense);
  assert.deepEqual(results.write.state.executed, ["scan", "gaps", "retrieve", "understand", "write"]);
  assert.deepEqual(results.condense.state.executed, ["scan", "gaps", "retrieve", "understand", "condense"]);
});
