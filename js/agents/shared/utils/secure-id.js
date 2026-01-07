/**
 * @returns {Crypto}
 */
function getCrypto() {
  const c = globalThis.crypto;
  if (!c) throw new Error("secure-id: globalThis.crypto is unavailable in this environment");
  return c;
}

/**
 * Generate cryptographically strong random bytes and encode as lower-case hex.
 * @param {number} [bytes]
 * @returns {string}
 */
export function cryptoRandomHex(bytes = 16) {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? Math.max(1, Math.floor(bytes)) : 16;
  const crypto = getCrypto();
  if (typeof crypto.getRandomValues !== "function") {
    throw new Error("secure-id: crypto.getRandomValues is unavailable in this environment");
  }
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Generate a cryptographically strong UUID v4 (or a v4-ish fallback).
 * @returns {string}
 */
export function cryptoRandomUuid() {
  const crypto = getCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4-ish fallback (still cryptographically strong when getRandomValues exists).
  const hex = cryptoRandomHex(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Generate a stable, namespaced id using a prefix and random UUID.
 * @param {string} [prefix]
 * @returns {string}
 */
export function makeSecureId(prefix = "id") {
  const p = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "id";
  return `${p}_${cryptoRandomUuid()}`;
}

/**
 * Generate a stable, namespaced id using a prefix, timestamp, and random bytes.
 * @param {string} [prefix]
 * @returns {string}
 */
export function makeSecureTimestampedId(prefix = "id") {
  const p = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "id";
  return `${p}_${Date.now().toString(36)}_${cryptoRandomHex(8)}`;
}
