/**
 * @fileoverview Browser zlib shim using CompressionStream/DecompressionStream.
 * Drop-in partial replacement for Node.js `zlib` in browser sandboxes.
 */

// ── Constants ────────────────────────────────────────────────────
export const Z_NO_COMPRESSION = 0;
export const Z_BEST_SPEED = 1;
export const Z_BEST_COMPRESSION = 9;
export const Z_DEFAULT_COMPRESSION = -1;

export const constants = {
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
};

// ── Helpers ──────────────────────────────────────────────────────

/** @param {Uint8Array|string|ArrayBuffer} input */
function toBytes(input) {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * @param {'gzip'|'deflate'} format
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function compressWithStream(format, data) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not available');
  }
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatUint8Arrays(chunks);
}

/**
 * @param {'gzip'|'deflate'} format
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function decompressWithStream(format, data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available');
  }
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatUint8Arrays(chunks);
}

// ── Callback API (Node-style) ───────────────────────────────────

/**
 * @param {Uint8Array|string} input
 * @param {object|Function} [options]
 * @param {Function} [callback]
 */
export function gzip(input, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  compressWithStream('gzip', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/** @param {Uint8Array} input @param {Function} callback */
export function gunzip(input, callback) {
  decompressWithStream('gzip', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/** @param {Uint8Array|string} input @param {Function} callback */
export function deflate(input, callback) {
  compressWithStream('deflate', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/** @param {Uint8Array} input @param {Function} callback */
export function inflate(input, callback) {
  decompressWithStream('deflate', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

// ── Sync variants (not available in browser) ────────────────────

const SYNC_ERR = 'Sync compression not available in browser, use async variant';

export function gzipSync() { throw new Error(SYNC_ERR); }
export function gunzipSync() { throw new Error(SYNC_ERR); }
export function deflateSync() { throw new Error(SYNC_ERR); }
export function inflateSync() { throw new Error(SYNC_ERR); }

// ── Promise API ─────────────────────────────────────────────────

/** @param {Uint8Array|string} input @returns {Promise<Uint8Array>} */
export function gzipAsync(input) { return compressWithStream('gzip', toBytes(input)); }
/** @param {Uint8Array} input @returns {Promise<Uint8Array>} */
export function gunzipAsync(input) { return decompressWithStream('gzip', toBytes(input)); }
/** @param {Uint8Array|string} input @returns {Promise<Uint8Array>} */
export function deflateAsync(input) { return compressWithStream('deflate', toBytes(input)); }
/** @param {Uint8Array} input @returns {Promise<Uint8Array>} */
export function inflateAsync(input) { return decompressWithStream('deflate', toBytes(input)); }

// ── Stream creators ─────────────────────────────────────────────

function createCompressTransform(format) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not available');
  }
  const cs = new CompressionStream(format);
  return { readable: cs.readable, writable: cs.writable, _stream: cs };
}

function createDecompressTransform(format) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available');
  }
  const ds = new DecompressionStream(format);
  return { readable: ds.readable, writable: ds.writable, _stream: ds };
}

export function createGzip() { return createCompressTransform('gzip'); }
export function createGunzip() { return createDecompressTransform('gzip'); }
export function createDeflate() { return createCompressTransform('deflate'); }
export function createInflate() { return createDecompressTransform('deflate'); }

// ── Brotli (stub — CompressionStream lacks brotli in most browsers) ────

export function brotliCompress(input, options, callback) {
  if (typeof options === 'function') { callback = options; }
  callback(new Error('Brotli compression not available in browser sandbox'));
}

export function brotliDecompress(input, options, callback) {
  if (typeof options === 'function') { callback = options; }
  callback(new Error('Brotli decompression not available in browser sandbox'));
}

export function brotliCompressSync() { throw new Error('Brotli compression not available in browser sandbox'); }
export function brotliDecompressSync() { throw new Error('Brotli decompression not available in browser sandbox'); }

export function createBrotliCompress() { throw new Error('Brotli compression not available in browser sandbox'); }
export function createBrotliDecompress() { throw new Error('Brotli decompression not available in browser sandbox'); }

// ── Default export ──────────────────────────────────────────────
export default {
  gzip, gunzip, deflate, inflate,
  gzipSync, gunzipSync, deflateSync, inflateSync,
  gzipAsync, gunzipAsync, deflateAsync, inflateAsync,
  createGzip, createGunzip, createDeflate, createInflate,
  brotliCompress, brotliDecompress, brotliCompressSync, brotliDecompressSync,
  createBrotliCompress, createBrotliDecompress,
  constants,
  Z_NO_COMPRESSION, Z_BEST_SPEED, Z_BEST_COMPRESSION, Z_DEFAULT_COMPRESSION,
};
