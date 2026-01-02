const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModule() {
  return import("../../../js/agents/retrieval/grep.js");
}

test("grepChunks: maxMatchesPerChunk controls per-chunk match cap (literal + regex)", async () => {
  const { grepChunks } = await loadModule();

  const text = "a".repeat(60);
  const chunks = [{ chunkId: "c1", text }];

  const literalDefault = grepChunks(chunks, "a");
  assert.equal(literalDefault[0].matchCount, 50);

  const literalOverride = grepChunks(chunks, "a", { maxMatchesPerChunk: 200 });
  assert.equal(literalOverride[0].matchCount, 60);

  const regexDefault = grepChunks(chunks, /a/g);
  assert.equal(regexDefault[0].matchCount, 50);

  const regexOverride = grepChunks(chunks, /a/g, { maxMatchesPerChunk: Infinity });
  assert.equal(regexOverride[0].matchCount, 60);
});

test("grepChunksAsync: maxMatchesPerChunk controls per-chunk match cap", async () => {
  const { grepChunksAsync } = await loadModule();

  const text = "a".repeat(60);
  const chunks = [{ chunkId: "c1", text }];

  const defaultOut = await grepChunksAsync(chunks, "a");
  assert.equal(defaultOut[0].matchCount, 50);

  const overrideOut = await grepChunksAsync(chunks, "a", { maxMatchesPerChunk: 200 });
  assert.equal(overrideOut[0].matchCount, 60);
});

