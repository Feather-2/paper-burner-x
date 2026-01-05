import { estimateTokens } from "./value-utils.js";

const cache = new Map();
const MAX_CACHE_SIZE = 10000;

let hits = 0;
let misses = 0;

export function estimateTokensCached(text, tokenCounter) {
  if (!text || typeof text !== "string") return 0;

  // Key design:
  // - short strings: use the string itself (fast, collision-free)
  // - long strings: use `${len}:${hash}` to reduce collision risk
  const key = text.length > 100 ? `${text.length}:${hashCode(text)}` : text;
  if (cache.has(key)) {
    hits++;
    return cache.get(key);
  }

  misses++;
  let tokens;
  if (tokenCounter && typeof tokenCounter === "object" && typeof tokenCounter.count === "function") {
    try {
      tokens = tokenCounter.count(text);
    } catch {
      // ignore and fall back below
    }
  }
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) {
    tokens = estimateTokens(text);
  }
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
