const test = require("node:test");
const assert = require("node:assert/strict");

test("BlockManifest validation: valid examples", async () => {
  const {
    validateBlockManifest,
    RetrieveBlockManifest,
    ScanBlockManifest,
  } = await import("../../../js/agents/shared/block-manifest.js");

  const retrieve = validateBlockManifest(RetrieveBlockManifest);
  assert.equal(retrieve.ok, true);
  assert.deepEqual(retrieve.errors, []);

  const scan = validateBlockManifest(ScanBlockManifest);
  assert.equal(scan.ok, true);
  assert.deepEqual(scan.errors, []);
});

test("BlockManifest validation: non-object input", async () => {
  const { validateBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  const result = validateBlockManifest(null);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ["manifest must be an object"]);
});

test("BlockManifest validation: missing fields and type checks", async () => {
  const { validateBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  const invalid = {
    name: 42,
    version: "",
    description: " ",
    capabilities: ["search", 1],
    input: [],
    output: null,
    whenToUse: 10,
    dependsOn: ["", 1],
    incompatibleWith: "nope",
    estimatedCost: "cheap",
    estimatedTokens: "100",
    timeoutMs: "500",
    retryable: "yes",
  };

  const result = validateBlockManifest(invalid);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("name must be a non-empty string"));
  assert.ok(result.errors.includes("version must be a non-empty string"));
  assert.ok(result.errors.includes("description must be a non-empty string"));
  assert.ok(result.errors.includes("capabilities must be an array of strings"));
  assert.ok(result.errors.includes("input must be an object"));
  assert.ok(result.errors.includes("output must be an object"));
  assert.ok(result.errors.includes("whenToUse must be a non-empty string"));
  assert.ok(result.errors.includes("dependsOn must be an array of strings"));
  assert.ok(result.errors.includes("incompatibleWith must be an array of strings"));
  assert.ok(result.errors.includes("estimatedCost must be one of low, medium, high"));
  assert.ok(result.errors.includes("estimatedTokens must be a number"));
  assert.ok(result.errors.includes("timeoutMs must be a number"));
  assert.ok(result.errors.includes("retryable must be a boolean"));
});

test("BlockRegistry: register + get + manifests", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { RetrieveBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  const registry = new BlockRegistry();
  const executor = () => "ok";

  registry.register(RetrieveBlockManifest, executor);

  assert.equal(registry.getExecutor("retrieve"), executor);
  assert.equal(registry.getManifest("retrieve"), RetrieveBlockManifest);
  const manifests = registry.getManifests();
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0], RetrieveBlockManifest);
});

test("BlockRegistry: invalid manifest + executor + duplicate", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { RetrieveBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  const registry = new BlockRegistry();

  assert.throws(() => registry.register({ name: "bad" }, () => "noop"), /Invalid block manifest/);
  assert.throws(() => registry.register(RetrieveBlockManifest, "nope"), /executor must be a function/);

  registry.register(RetrieveBlockManifest, () => "ok");
  assert.throws(() => registry.register(RetrieveBlockManifest, () => "ok"), /already registered/);
});

test("BlockRegistry: missing blocks return undefined", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");

  const registry = new BlockRegistry();
  assert.equal(registry.getExecutor("missing"), undefined);
  assert.equal(registry.getManifest("missing"), undefined);
});

test("BlockRegistry: buildCatalogPrompt format", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");
  const { RetrieveBlockManifest } = await import("../../../js/agents/shared/block-manifest.js");

  const registry = new BlockRegistry();
  const silentBlock = {
    name: "silent",
    version: "0.1.0",
    description: "Minimal block for catalog coverage.",
    capabilities: [],
    input: { type: "object", properties: {} },
    output: { type: "object", properties: {} },
    whenToUse: "Use when no other block applies.",
    dependsOn: [],
    incompatibleWith: [],
    estimatedCost: "low",
    estimatedTokens: 0,
    timeoutMs: 1,
    retryable: false,
  };

  registry.register(RetrieveBlockManifest, () => "ok");
  registry.register(silentBlock, () => "ok");

  const prompt = registry.buildCatalogPrompt();
  assert.ok(prompt.includes("## retrieve (v1.0.0)"));
  assert.ok(prompt.includes("## silent (v0.1.0)"));
  assert.ok(prompt.includes("**When to use**:"));
  assert.ok(prompt.includes("**Depends on**: none"));
  assert.ok(prompt.includes("**Incompatible with**: none"));
  assert.ok(prompt.includes("**Retryable**: no"));
  assert.ok(prompt.includes("**Capabilities**: none"));
  assert.ok(prompt.includes("---"));
  assert.ok(prompt.indexOf("## retrieve") < prompt.indexOf("## silent"));
});

test("BlockRegistry: buildCatalogPrompt empty registry", async () => {
  const { BlockRegistry } = await import("../../../js/agents/runtime/block-registry.js");

  const registry = new BlockRegistry();
  assert.equal(registry.buildCatalogPrompt(), "");
});
