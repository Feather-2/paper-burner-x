// TP1: Text normalization for stable locators.
// - newline: \r\n and \r -> \n
// - NBSP (\u00A0) -> space
// - textHash: sha256:<hex> computed on normalized text

function isString(v) {
  return typeof v === "string" || v instanceof String;
}

function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// Minimal synchronous SHA-256 for browser/node parity (no async WebCrypto).
// Adapted from the standard SHA-256 compression function.
function sha256HexUtf8(str) {
  // TextEncoder is available in modern browsers and Node >= 11.
  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  /** @ts-ignore - 浏览器环境无 Buffer，Node 环境无需 TextEncoder 的 fallback */
  const msg = enc ? enc.encode(str) : Uint8Array.from(Buffer.from(String(str), "utf8"));

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

  const ROTR = (x, n) => (x >>> n) | (x << (32 - n));
  const Ch = (x, y, z) => (x & y) ^ (~x & z);
  const Maj = (x, y, z) => (x & y) ^ (x & z) ^ (y & z);
  const Sigma0 = (x) => ROTR(x, 2) ^ ROTR(x, 13) ^ ROTR(x, 22);
  const Sigma1 = (x) => ROTR(x, 6) ^ ROTR(x, 11) ^ ROTR(x, 25);
  const sigma0 = (x) => ROTR(x, 7) ^ ROTR(x, 18) ^ (x >>> 3);
  const sigma1 = (x) => ROTR(x, 17) ^ ROTR(x, 19) ^ (x >>> 10);

  // Pad message
  const l = msg.length;
  const bitLenHi = Math.floor((l * 8) / 0x100000000);
  const bitLenLo = (l * 8) >>> 0;
  const withOne = l + 1;
  const padLen = (withOne % 64 <= 56 ? 56 - (withOne % 64) : 56 + (64 - (withOne % 64)));
  const totalLen = withOne + padLen + 8;

  const buf = new Uint8Array(totalLen);
  buf.set(msg);
  buf[l] = 0x80;
  // length in bits, big-endian 64-bit
  buf[totalLen - 8] = (bitLenHi >>> 24) & 0xff;
  buf[totalLen - 7] = (bitLenHi >>> 16) & 0xff;
  buf[totalLen - 6] = (bitLenHi >>> 8) & 0xff;
  buf[totalLen - 5] = bitLenHi & 0xff;
  buf[totalLen - 4] = (bitLenLo >>> 24) & 0xff;
  buf[totalLen - 3] = (bitLenLo >>> 16) & 0xff;
  buf[totalLen - 2] = (bitLenLo >>> 8) & 0xff;
  buf[totalLen - 1] = bitLenLo & 0xff;

  const W = new Uint32Array(64);
  for (let i = 0; i < buf.length; i += 64) {
    // message schedule
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      W[t] = ((buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      W[t] = (sigma1(W[t - 2]) + W[t - 7] + sigma0(W[t - 15]) + W[t - 16]) >>> 0;
    }

    // working vars
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (let t = 0; t < 64; t++) {
      const T1 = (h + Sigma1(e) + Ch(e, f, g) + K[t] + W[t]) >>> 0;
      const T2 = (Sigma0(a) + Maj(a, b, c)) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return toHex(out);
}

function countMatches(str, re) {
  let n = 0;
  str.replace(re, () => {
    n++;
    return "";
  });
  return n;
}

/**
 * @typedef {Object} TextNormalization
 * @property {string} profile
 * @property {string[]} ops
 * @property {Record<string, number>} counts
 */

/**
 * @typedef {Object} NormalizeTextResult
 * @property {string} normalized
 * @property {string} textHash
 * @property {TextNormalization} normalization
 */

/**
 * Normalize raw text for stable locators.
 *
 * @param {unknown} rawText
 * @returns {NormalizeTextResult}
 */
export function normalizeText(rawText) {
  if (!isString(rawText)) throw new TypeError("normalizeText(rawText): rawText must be a string");
  const input = String(rawText);

  const normalization = { profile: "v0", ops: [], counts: {} };

  // Newlines
  const hasCRLF = input.includes("\r\n");
  const hasCR = !hasCRLF && input.includes("\r");
  let text = input;
  if (hasCRLF || hasCR) {
    const crlfCount = countMatches(text, /\r\n/g);
    const crCount = countMatches(text.replace(/\r\n/g, ""), /\r/g);
    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    normalization.ops.push("newline_to_lf");
    normalization.counts.crlf = crlfCount;
    normalization.counts.cr = crCount;
  }

  // NBSP
  if (text.includes("\u00A0")) {
    const nbspCount = countMatches(text, /\u00A0/g);
    text = text.replace(/\u00A0/g, " ");
    normalization.ops.push("nbsp_to_space");
    normalization.counts.nbsp = nbspCount;
  }

  const textHash = `sha256:${sha256HexUtf8(text)}`;
  return { normalized: text, textHash, normalization };
}
