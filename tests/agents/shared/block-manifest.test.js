const test = require("node:test");
const assert = require("node:assert/strict");

test("BlockManifest validation: all DeepSearch manifests are valid", async () => {
  const {
    validateBlockManifest,
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  } = await import("../../../js/agents/shared/block-manifest.js");

  const manifests = [
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  ];

  for (const manifest of manifests) {
    const result = validateBlockManifest(manifest);
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  }
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

  const expectedErrors = [
    "name must be a non-empty string",
    "version must be a non-empty string",
    "description must be a non-empty string",
    "capabilities must be an array of strings",
    "input must be an object",
    "output must be an object",
    "whenToUse must be a non-empty string",
    "dependsOn must be an array of strings",
    "incompatibleWith must be an array of strings",
    "estimatedCost must be one of low, medium, high",
    "estimatedTokens must be a number",
    "timeoutMs must be a number",
    "retryable must be a boolean",
  ];

  for (const error of expectedErrors) {
    assert.ok(result.errors.includes(error));
  }
});

test("DeepSearchBlockManifests: includes all manifests in order", async () => {
  const {
    DeepSearchBlockManifests,
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  } = await import("../../../js/agents/shared/block-manifest.js");

  const expected = [
    ScanBlockManifest,
    GapsBlockManifest,
    RetrieveBlockManifest,
    UnderstandBlockManifest,
    WriteBlockManifest,
    CondenseBlockManifest,
  ];

  assert.equal(DeepSearchBlockManifests.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(DeepSearchBlockManifests[i], expected[i]);
  }

  const names = DeepSearchBlockManifests.map((manifest) => manifest.name);
  assert.deepEqual(names, ["scan", "gaps", "retrieve", "understand", "write", "condense"]);
});
