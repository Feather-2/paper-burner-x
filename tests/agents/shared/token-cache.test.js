import test from "node:test";
import assert from "node:assert/strict";

test("estimateTokensCached: empty/non-string -> 0", async () => {
  const { estimateTokensCached, clearTokenCache } = await import("../../../js/agents/shared/utils/token-cache.js");
  clearTokenCache();

  assert.equal(estimateTokensCached(""), 0);
  assert.equal(estimateTokensCached(null), 0);
  assert.equal(estimateTokensCached(undefined), 0);
  assert.equal(estimateTokensCached(123), 0);
});

test("estimateTokensCached: caches short strings and can be cleared", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );
  const { estimateTokens } = await import("../../../js/agents/shared/utils/value-utils.js");

  clearTokenCache();
  assert.deepEqual(getTokenCacheStats().size, 0);
  assert.deepEqual(getTokenCacheStats().hits, 0);
  assert.deepEqual(getTokenCacheStats().misses, 0);

  const text = "hello world";
  const expected = estimateTokens(text);

  assert.equal(estimateTokensCached(text), expected);
  assert.equal(getTokenCacheStats().size, 1);
  assert.equal(getTokenCacheStats().hits, 0);
  assert.equal(getTokenCacheStats().misses, 1);

  assert.equal(estimateTokensCached(text), expected);
  assert.equal(getTokenCacheStats().size, 1);
  assert.equal(getTokenCacheStats().hits, 1);
  assert.equal(getTokenCacheStats().misses, 1);

  clearTokenCache();
  assert.equal(getTokenCacheStats().size, 0);
  assert.equal(getTokenCacheStats().hits, 0);
  assert.equal(getTokenCacheStats().misses, 0);
});

test("estimateTokensCached: hashes and caches long strings (>100 chars)", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );

  clearTokenCache();

  const longText = "a".repeat(150);
  const first = estimateTokensCached(longText);
  assert.equal(getTokenCacheStats().size, 1);
  assert.equal(getTokenCacheStats().hits, 0);
  assert.equal(getTokenCacheStats().misses, 1);

  const second = estimateTokensCached(longText);
  assert.equal(second, first);
  assert.equal(getTokenCacheStats().size, 1);
  assert.equal(getTokenCacheStats().hits, 1);
  assert.equal(getTokenCacheStats().misses, 1);
});

test("estimateTokensCached: evicts oldest when exceeding max size", async () => {
  const { estimateTokensCached, clearTokenCache, getTokenCacheStats } = await import(
    "../../../js/agents/shared/utils/token-cache.js"
  );

  clearTokenCache();
  const maxSize = getTokenCacheStats().maxSize;

  for (let i = 0; i < maxSize + 25; i++) {
    estimateTokensCached(`msg-${i}`);
  }

  assert.equal(getTokenCacheStats().size, maxSize);
  assert.equal(getTokenCacheStats().misses, maxSize + 25);
});
