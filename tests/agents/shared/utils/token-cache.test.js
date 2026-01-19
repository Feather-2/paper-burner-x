import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("estimateTokensCached: empty/non-string -> 0", async () => {
  const { estimateTokensCached, clearTokenCache } = await import("../../../js/agents/shared/utils/token-cache.js");
  clearTokenCache();

  expect(estimateTokensCached("")).toBe(0);
  expect(estimateTokensCached(null)).toBe(0);
  expect(estimateTokensCached(undefined)).toBe(0);
  expect(estimateTokensCached(123)).toBe(0);
});

it("estimateTokensCached: caches short strings and can be cleared", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );
  const { estimateTokens } = await import("../../../js/agents/shared/utils/value-utils.js");

  clearTokenCache();
  expect(getTokenCacheStats().size).toEqual(0);
  expect(getTokenCacheStats().hits).toEqual(0);
  expect(getTokenCacheStats().misses).toEqual(0);

  const text = "hello world";
  const expected = estimateTokens(text);

  expect(estimateTokensCached(text)).toBe(expected);
  expect(getTokenCacheStats().size).toBe(1);
  expect(getTokenCacheStats().hits).toBe(0);
  expect(getTokenCacheStats().misses).toBe(1);

  expect(estimateTokensCached(text)).toBe(expected);
  expect(getTokenCacheStats().size).toBe(1);
  expect(getTokenCacheStats().hits).toBe(1);
  expect(getTokenCacheStats().misses).toBe(1);

  clearTokenCache();
  expect(getTokenCacheStats().size).toBe(0);
  expect(getTokenCacheStats().hits).toBe(0);
  expect(getTokenCacheStats().misses).toBe(0);
});

it("estimateTokensCached: hashes and caches long strings (>100 chars)", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );

  clearTokenCache();

  const longText = "a".repeat(150);
  const first = estimateTokensCached(longText);
  expect(getTokenCacheStats().size).toBe(1);
  expect(getTokenCacheStats().hits).toBe(0);
  expect(getTokenCacheStats().misses).toBe(1);

  const second = estimateTokensCached(longText);
  expect(second).toBe(first);
  expect(getTokenCacheStats().size).toBe(1);
  expect(getTokenCacheStats().hits).toBe(1);
  expect(getTokenCacheStats().misses).toBe(1);
});

it("estimateTokensCached: evicts oldest when exceeding max size", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );

  clearTokenCache();
  const maxSize = getTokenCacheStats().maxSize;

  for (let i = 0; i < maxSize + 25; i++) {
    estimateTokensCached(`msg-${i}`);
  }

  expect(getTokenCacheStats().size).toBe(maxSize);
  expect(getTokenCacheStats().misses).toBe(maxSize + 25);
});

