/**
 * cyrb53 - fast, high-quality 53-bit hash.
 * @see https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 * @param {string} str - Input string to hash.
 * @param {number} [seed=0] - Optional seed to mix into the hash.
 * @returns {string} Hex string hash value.
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 53-bit integer as hex string
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Compute content hash for deduplication.
 * @param {any} data - Data to hash (stringified when not already a string).
 * @returns {string} Hex string content hash.
 */
export function computeContentHash(data) {
  try {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    return cyrb53(str);
  } catch {
    return cyrb53(String(data ?? ""));
  }
}
