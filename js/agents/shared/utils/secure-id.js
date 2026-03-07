let fallbackPrngState = ((Date.now() ^ 0x9e3779b9) >>> 0) || 1;
let fallbackCounter = 0;

/**
 * @returns {Crypto}
 */
function getCrypto() {
  const c = globalThis.crypto;
  if (!c) {
    throw new Error(
      "secure-id: globalThis.crypto is unavailable in this environment. " +
        "Call getSecureIdCapabilities() during startup and provide a Web Crypto polyfill if needed."
    );
  }
  return c;
}

/**
 * Probe secure-id runtime capabilities.
 * @returns {{
 *   hasCrypto: boolean,
 *   hasGetRandomValues: boolean,
 *   hasRandomUUID: boolean,
 *   supported: boolean,
 * }}
 */
export function getSecureIdCapabilities() {
  const crypto = globalThis.crypto;
  const hasCrypto = !!crypto;
  const hasGetRandomValues = typeof crypto?.getRandomValues === "function";
  const hasRandomUUID = typeof crypto?.randomUUID === "function";
  return {
    hasCrypto,
    hasGetRandomValues,
    hasRandomUUID,
    supported: hasCrypto && hasGetRandomValues,
  };
}

/**
 * Whether secure-id APIs are fully supported in current runtime.
 * @returns {boolean}
 */
export function isSecureIdSupported() {
  return getSecureIdCapabilities().supported;
}

/**
 * Fill a Uint8Array using a deterministic non-crypto PRNG fallback.
 * The goal is stable uniqueness under degraded environments, not security.
 *
 * @param {Uint8Array} buf
 * @returns {Uint8Array}
 */
export function fillNonCryptoRandomBytes(buf) {
  const target = buf instanceof Uint8Array ? buf : new Uint8Array(0);
  const nowPart = (Date.now() & 0xff) >>> 0;
  const perfPart =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? (Math.floor(performance.now() * 1000) & 0xff) >>> 0
      : 0;

  for (let i = 0; i < target.length; i += 1) {
    fallbackCounter = (fallbackCounter + 1) >>> 0;
    fallbackPrngState ^= (fallbackPrngState << 13) >>> 0;
    fallbackPrngState ^= fallbackPrngState >>> 17;
    fallbackPrngState ^= (fallbackPrngState << 5) >>> 0;
    target[i] = (fallbackPrngState + fallbackCounter + nowPart + perfPart + i) & 0xff;
  }

  return target;
}

/**
 * Lower-case hex encoded non-crypto random bytes.
 *
 * @param {number} [bytes=16]
 * @returns {string}
 */
export function nonCryptoRandomHex(bytes = 16) {
  const n = Math.max(1, Math.floor(Number(bytes) || 16));
  const buf = fillNonCryptoRandomBytes(new Uint8Array(n));
  let out = "";
  for (const value of buf) out += value.toString(16).padStart(2, "0");
  return out;
}

function insecureHex(bytes = 16) {
  return nonCryptoRandomHex(bytes);
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function insecureId(prefix) {
  const p = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "id";
  return `${p}_${Date.now().toString(36)}_${insecureHex(8)}`;
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
 * @param {{ allowInsecureFallback?: boolean }} [options]
 * @returns {string}
 */
export function makeSecureId(prefix = "id", options) {
  const p = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "id";
  try {
    return `${p}_${cryptoRandomUuid()}`;
  } catch (err) {
    if (options?.allowInsecureFallback === true) {
      return insecureId(p);
    }
    throw err;
  }
}

/**
 * Generate a stable, namespaced id using a prefix, timestamp, and random bytes.
 * @param {string} [prefix]
 * @param {{ allowInsecureFallback?: boolean }} [options]
 * @returns {string}
 */
export function makeSecureTimestampedId(prefix = "id", options) {
  const p = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "id";
  try {
    return `${p}_${Date.now().toString(36)}_${cryptoRandomHex(8)}`;
  } catch (err) {
    if (options?.allowInsecureFallback === true) {
      return insecureId(p);
    }
    throw err;
  }
}
