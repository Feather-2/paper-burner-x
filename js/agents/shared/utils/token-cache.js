import { estimateTokens } from "./value-utils.js";

const cache = new Map();
const MAX_CACHE_SIZE = 10000;

let hits = 0;
let misses = 0;

export function estimateTokensCached(text) {
  if (!text || typeof text !== "string") return 0;

  const key = text.length > 100 ? hashCode(text) : text;
  if (cache.has(key)) {
    hits++;
    return cache.get(key);
  }

  misses++;
  const tokens = estimateTokens(text);
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, tokens);
  return tokens;
}

function hashCode(str) {
  // 32-bit stable hash (Java-style).
  let hash = str.length | 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

export function clearTokenCache() {
  cache.clear();
  hits = 0;
  misses = 0;
}

export function getTokenCacheStats() {
  const total = hits + misses;
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    hits,
    misses,
    hitRate: total > 0 ? hits / total : 0,
  };
}

