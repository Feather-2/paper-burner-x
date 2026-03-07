/**
 * @fileoverview Browser zlib shim using CompressionStream/DecompressionStream.
 * Drop-in partial replacement for Node.js `zlib` in browser sandboxes.
 */

// ── Constants ────────────────────────────────────────────────────
export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  ZLIB_VERNUM: 4784,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1,
  BROTLI_DECODE: 0,
  BROTLI_ENCODE: 1,
  BROTLI_OPERATION_PROCESS: 0,
  BROTLI_OPERATION_FLUSH: 1,
  BROTLI_OPERATION_FINISH: 2,
  BROTLI_OPERATION_EMIT_METADATA: 3,
  BROTLI_PARAM_MODE: 0,
  BROTLI_MODE_GENERIC: 0,
  BROTLI_MODE_TEXT: 1,
  BROTLI_MODE_FONT: 2,
  BROTLI_PARAM_QUALITY: 1,
  BROTLI_MIN_QUALITY: 0,
  BROTLI_MAX_QUALITY: 11,
  BROTLI_DEFAULT_QUALITY: 11,
  BROTLI_PARAM_LGWIN: 2,
  BROTLI_MIN_WINDOW_BITS: 10,
  BROTLI_MAX_WINDOW_BITS: 24,
  BROTLI_DEFAULT_WINDOW: 22,
  BROTLI_PARAM_LGBLOCK: 3,
  BROTLI_MIN_INPUT_BLOCK_BITS: 16,
  BROTLI_MAX_INPUT_BLOCK_BITS: 24,
};

export const {
  Z_NO_FLUSH,
  Z_PARTIAL_FLUSH,
  Z_SYNC_FLUSH,
  Z_FULL_FLUSH,
  Z_FINISH,
  Z_BLOCK,
  Z_OK,
  Z_STREAM_END,
  Z_NEED_DICT,
  Z_ERRNO,
  Z_STREAM_ERROR,
  Z_DATA_ERROR,
  Z_MEM_ERROR,
  Z_BUF_ERROR,
  Z_VERSION_ERROR,
  Z_NO_COMPRESSION,
  Z_BEST_SPEED,
  Z_BEST_COMPRESSION,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED,
  Z_HUFFMAN_ONLY,
  Z_RLE,
  Z_FIXED,
  Z_DEFAULT_STRATEGY,
  ZLIB_VERNUM,
  Z_MIN_WINDOWBITS,
  Z_MAX_WINDOWBITS,
  Z_DEFAULT_WINDOWBITS,
  Z_MIN_CHUNK,
  Z_MAX_CHUNK,
  Z_DEFAULT_CHUNK,
  Z_MIN_MEMLEVEL,
  Z_MAX_MEMLEVEL,
  Z_DEFAULT_MEMLEVEL,
  Z_MIN_LEVEL,
  Z_MAX_LEVEL,
  Z_DEFAULT_LEVEL,
  BROTLI_DECODE,
  BROTLI_ENCODE,
  BROTLI_OPERATION_PROCESS,
  BROTLI_OPERATION_FLUSH,
  BROTLI_OPERATION_FINISH,
  BROTLI_OPERATION_EMIT_METADATA,
  BROTLI_PARAM_MODE,
  BROTLI_MODE_GENERIC,
  BROTLI_MODE_TEXT,
  BROTLI_MODE_FONT,
  BROTLI_PARAM_QUALITY,
  BROTLI_MIN_QUALITY,
  BROTLI_MAX_QUALITY,
  BROTLI_DEFAULT_QUALITY,
  BROTLI_PARAM_LGWIN,
  BROTLI_MIN_WINDOW_BITS,
  BROTLI_MAX_WINDOW_BITS,
  BROTLI_DEFAULT_WINDOW,
  BROTLI_PARAM_LGBLOCK,
  BROTLI_MIN_INPUT_BLOCK_BITS,
  BROTLI_MAX_INPUT_BLOCK_BITS,
} = constants;

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
 * @param {'gzip'|'deflate'|'deflate-raw'} format
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function compressWithStream(format, data) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream not available');
  }
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(/** @type {BufferSource} */ (data));
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
 * @param {'gzip'|'deflate'|'deflate-raw'} format
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function decompressWithStream(format, data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream not available');
  }
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(/** @type {BufferSource} */ (data));
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

/**
 * @param {Uint8Array|string} input
 * @param {object|Function} [options]
 * @param {Function} [callback]
 */
export function deflate(input, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  compressWithStream('deflate', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/**
 * @param {Uint8Array} input
 * @param {object|Function} [options]
 * @param {Function} [callback]
 */
export function inflate(input, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  decompressWithStream('deflate', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/**
 * @param {Uint8Array|string} input
 * @param {object|Function} [options]
 * @param {Function} [callback]
 */
export function deflateRaw(input, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  compressWithStream('deflate-raw', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

/**
 * @param {Uint8Array} input
 * @param {object|Function} [options]
 * @param {Function} [callback]
 */
export function inflateRaw(input, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  decompressWithStream('deflate-raw', toBytes(input)).then(r => callback(null, r), e => callback(e));
}

// ── Sync variants (not available in browser) ────────────────────

const SYNC_ERR = 'Sync compression not available in browser, use async variant';

export function gzipSync() { throw new Error(SYNC_ERR); }
export function gunzipSync() { throw new Error(SYNC_ERR); }
export function deflateSync() { throw new Error(SYNC_ERR); }
export function inflateSync() { throw new Error(SYNC_ERR); }
export function deflateRawSync() { throw new Error(SYNC_ERR); }
export function inflateRawSync() { throw new Error(SYNC_ERR); }

// ── Promise API ─────────────────────────────────────────────────

/** @param {Uint8Array|string} input @returns {Promise<Uint8Array>} */
export function gzipAsync(input) { return compressWithStream('gzip', toBytes(input)); }
/** @param {Uint8Array} input @returns {Promise<Uint8Array>} */
export function gunzipAsync(input) { return decompressWithStream('gzip', toBytes(input)); }
/** @param {Uint8Array|string} input @returns {Promise<Uint8Array>} */
export function deflateAsync(input) { return compressWithStream('deflate', toBytes(input)); }
/** @param {Uint8Array} input @returns {Promise<Uint8Array>} */
export function inflateAsync(input) { return decompressWithStream('deflate', toBytes(input)); }
/** @param {Uint8Array|string} input @returns {Promise<Uint8Array>} */
export function deflateRawAsync(input) { return compressWithStream('deflate-raw', toBytes(input)); }
/** @param {Uint8Array} input @returns {Promise<Uint8Array>} */
export function inflateRawAsync(input) { return decompressWithStream('deflate-raw', toBytes(input)); }

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
export function createDeflateRaw() { return createCompressTransform('deflate-raw'); }
export function createInflateRaw() { return createDecompressTransform('deflate-raw'); }

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
  gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw,
  gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync,
  gzipAsync, gunzipAsync, deflateAsync, inflateAsync, deflateRawAsync, inflateRawAsync,
  createGzip, createGunzip, createDeflate, createInflate, createDeflateRaw, createInflateRaw,
  brotliCompress, brotliDecompress, brotliCompressSync, brotliDecompressSync,
  createBrotliCompress, createBrotliDecompress,
  constants,
  ...constants,
};
