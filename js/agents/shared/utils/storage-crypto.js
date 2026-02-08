import { toNonEmptyString } from "./value-utils.js";
import { protoSafeReviver } from "./safe-json.js";

/**
 * Minimal `Buffer` constructor shape used by this module.
 * (Avoids a hard dependency on `@types/node` in browser builds.)
 * @typedef {object} NodeBufferConstructorLike
 * @property {(data: string | Uint8Array, encoding?: string) => (Uint8Array & { toString: (encoding?: string) => string })} from
 */

/** @type {NodeBufferConstructorLike | undefined} */
const NodeBuffer = (/** @type {{ Buffer?: NodeBufferConstructorLike }} */ (globalThis)).Buffer;

/**
 * @typedef {object} StorageEncryptionOptions
 * @property {string=} passphrase
 * @property {string=} aad
 * @property {number=} iterations
 */

function hasNodeBuffer() {
  return !!NodeBuffer && typeof NodeBuffer.from === "function";
}

function utf8Encode(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  if (hasNodeBuffer()) return Uint8Array.from(NodeBuffer.from(s, "utf8"));
  // Extremely old environments: best-effort Latin1.
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function utf8Decode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(arr);
  if (hasNodeBuffer()) return NodeBuffer.from(arr).toString("utf8");
  let out = "";
  for (let i = 0; i < arr.length; i++) out += String.fromCharCode(arr[i]);
  return out;
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : null;
  if (!arr || arr.length === 0) return "";
  if (hasNodeBuffer()) {
    try {
      return NodeBuffer.from(arr).toString("base64");
    } catch {
      return "";
    }
  }
  if (typeof globalThis.btoa !== "function") return "";

  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    const slice = arr.subarray(i, i + chunk);
    bin += String.fromCharCode(...slice);
  }
  try {
    return globalThis.btoa(bin);
  } catch {
    return "";
  }
}

function base64ToBytes(base64) {
  const b64 = toNonEmptyString(base64);
  if (!b64) return new Uint8Array();
  if (hasNodeBuffer()) {
    try {
      return new Uint8Array(NodeBuffer.from(b64, "base64"));
    } catch {
      return new Uint8Array();
    }
  }
  if (typeof globalThis.atob !== "function") return new Uint8Array();
  try {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  } catch {
    return new Uint8Array();
  }
}

function getWebCrypto() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  const subtle = c && typeof c.subtle === "object" ? c.subtle : null;
  const getRandomValues = c && typeof c.getRandomValues === "function" ? c.getRandomValues.bind(c) : null;
  if (!subtle || !getRandomValues) return null;
  return { subtle, getRandomValues };
}

export const PB_ENCRYPTED_PREFIX = "pbenc:v1:";

export function isEncryptedString(value) {
  return typeof value === "string" && value.startsWith(PB_ENCRYPTED_PREFIX);
}

export function canUseStorageEncryption() {
  return !!getWebCrypto();
}

async function deriveAesKeyFromPassphrase(passphrase, saltBytes, { iterations = 100_000 } = {}) {
  const cryptoImpl = getWebCrypto();
  if (!cryptoImpl) throw new Error("WebCrypto is not available");

  const pwd = toNonEmptyString(passphrase);
  if (!pwd) throw new Error("passphrase is required");

  const iter = typeof iterations === "number" && Number.isFinite(iterations) ? Math.max(10_000, Math.floor(iterations)) : 100_000;
  const salt = saltBytes instanceof Uint8Array ? saltBytes : new Uint8Array(saltBytes || []);

  const keyMaterial = await cryptoImpl.subtle.importKey("raw", utf8Encode(pwd), { name: "PBKDF2" }, false, ["deriveKey"]);
  return cryptoImpl.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * @param {unknown} plaintext
 * @param {StorageEncryptionOptions} [options]
 * @returns {Promise<string>}
 */
export async function encryptString(plaintext, { passphrase, aad, iterations } = {}) {
  const cryptoImpl = getWebCrypto();
  if (!cryptoImpl) throw new Error("encryptString: WebCrypto is not available");

  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  cryptoImpl.getRandomValues(salt);
  cryptoImpl.getRandomValues(iv);

  const key = await deriveAesKeyFromPassphrase(passphrase, salt, { iterations });
  const data = utf8Encode(typeof plaintext === "string" ? plaintext : String(plaintext ?? ""));
  const additionalData = toNonEmptyString(aad) ? utf8Encode(aad) : undefined;

  const ct = await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv, ...(additionalData ? { additionalData } : {}) }, key, data);

  const payload = {
    schemaVersion: "pbenc/1",
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iter: typeof iterations === "number" && Number.isFinite(iterations) ? Math.max(10_000, Math.floor(iterations)) : 100_000,
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ctB64: bytesToBase64(new Uint8Array(ct)),
  };

  return `${PB_ENCRYPTED_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * @param {unknown} payload
 * @param {StorageEncryptionOptions} [options]
 * @returns {Promise<string>}
 */
export async function decryptString(payload, { passphrase, aad } = {}) {
  const cryptoImpl = getWebCrypto();
  if (!cryptoImpl) throw new Error("decryptString: WebCrypto is not available");

  const raw = typeof payload === "string" ? payload : String(payload ?? "");
  if (!isEncryptedString(raw)) throw new Error("decryptString: payload is not encrypted");

  let decoded;
  try {
    decoded = JSON.parse(raw.slice(PB_ENCRYPTED_PREFIX.length, protoSafeReviver));
  } catch {
    throw new Error("decryptString: invalid payload JSON");
  }

  const salt = base64ToBytes(decoded?.saltB64);
  const iv = base64ToBytes(decoded?.ivB64);
  const ct = base64ToBytes(decoded?.ctB64);
  const iter = typeof decoded?.iter === "number" && Number.isFinite(decoded.iter) ? Math.max(10_000, Math.floor(decoded.iter)) : 100_000;

  if (!(salt.length >= 8) || !(iv.length >= 8) || !(ct.length >= 8)) {
    throw new Error("decryptString: invalid payload fields");
  }

  const key = await deriveAesKeyFromPassphrase(passphrase, salt, { iterations: iter });
  const additionalData = toNonEmptyString(aad) ? utf8Encode(aad) : undefined;

  const pt = await cryptoImpl.subtle.decrypt({ name: "AES-GCM", iv, ...(additionalData ? { additionalData } : {}) }, key, ct);
  return utf8Decode(new Uint8Array(pt));
}

export default {
  PB_ENCRYPTED_PREFIX,
  canUseStorageEncryption,
  isEncryptedString,
  encryptString,
  decryptString,
};
