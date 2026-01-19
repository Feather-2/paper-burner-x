import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

async function loadModule() {
  return import("../../../js/agents/retrieval/grep.js");
}

it("grepChunks: maxMatchesPerChunk controls per-chunk match cap (literal + regex)", async () => {
  const { grepChunks } = await loadModule();

  const text = "a".repeat(60);
  const chunks = [{ chunkId: "c1", text }];

  const literalDefault = grepChunks(chunks, "a");
  expect(literalDefault[0].matchCount).toBe(50);

  const literalOverride = grepChunks(chunks, "a", { maxMatchesPerChunk: 200 });
  expect(literalOverride[0].matchCount).toBe(60);

  const regexDefault = grepChunks(chunks, /a/g);
  expect(regexDefault[0].matchCount).toBe(50);

  const regexOverride = grepChunks(chunks, /a/g, { maxMatchesPerChunk: Infinity });
  expect(regexOverride[0].matchCount).toBe(60);
});

it("grepChunksAsync: maxMatchesPerChunk controls per-chunk match cap", async () => {
  const { grepChunksAsync } = await loadModule();

  const text = "a".repeat(60);
  const chunks = [{ chunkId: "c1", text }];

  const defaultOut = await grepChunksAsync(chunks, "a");
  expect(defaultOut[0].matchCount).toBe(50);

  const overrideOut = await grepChunksAsync(chunks, "a", { maxMatchesPerChunk: 200 });
  expect(overrideOut[0].matchCount).toBe(60);
});

