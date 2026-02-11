const TAR_BLOCK_SIZE = 512;

/**
 * @typedef {object} TarHeader
 * @property {string} name
 * @property {number} size
 * @property {string} type
 * @property {number} offset
 */

/**
 * Convert unknown binary input to Uint8Array.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Uint8Array}
 */
function toUint8Array(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  return new Uint8Array(buffer);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 * @returns {string}
 */
function readAscii(bytes, offset, length) {
  const end = offset + length;
  let result = '';
  for (let index = offset; index < end && index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === 0) break;
    result += String.fromCharCode(value);
  }
  return result.trim();
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {boolean}
 */
function isZeroBlock(bytes, offset) {
  if (offset + TAR_BLOCK_SIZE > bytes.length) return true;
  for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
    if (bytes[offset + index] !== 0) return false;
  }
  return true;
}

/**
 * Join path segments using POSIX separators.
 * @param {...string} segments
 * @returns {string}
 */
function joinPath(...segments) {
  return segments
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/^\.\//, '');
}

/**
 * Decompress gzip bytes via DecompressionStream.
 * @param {Uint8Array} gzipBytes
 * @returns {Promise<Uint8Array>}
 */
async function inflateWithDecompressionStream(gzipBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available');
  }
  const input = new Blob([gzipBytes]).stream();
  const stream = input.pipeThrough(new DecompressionStream('gzip'));
  const output = await new Response(stream).arrayBuffer();
  return new Uint8Array(output);
}

/**
 * Parse POSIX tar headers.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {TarHeader[]}
 */
export function parseTarHeaders(buffer) {
  const bytes = toUint8Array(buffer);
  /** @type {TarHeader[]} */
  const headers = [];
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= bytes.length) {
    if (isZeroBlock(bytes, offset)) {
      offset += TAR_BLOCK_SIZE;
      continue;
    }

    const rawName = readAscii(bytes, offset, 100);
    const prefix = readAscii(bytes, offset + 345, 155);
    const fullName = prefix ? `${prefix}/${rawName}` : rawName;
    const name = fullName
      .replace(/^package\//, '')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '');

    const sizeOct = readAscii(bytes, offset + 124, 12).replace(/\0/g, '').trim();
    const parsedSize = Number.parseInt(sizeOct || '0', 8);
    const size = Number.isFinite(parsedSize) ? parsedSize : 0;
    const typeByte = bytes[offset + 156];
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
    const dataOffset = offset + TAR_BLOCK_SIZE;

    if (name) {
      headers.push({
        name,
        size,
        type,
        offset: dataOffset,
      });
    }

    const alignedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    offset = dataOffset + alignedSize;
  }

  return headers;
}

/**
 * Tarball download/extraction utility.
 */
export class TarballManager {
  /**
   * @param {{ fetchFn?: typeof fetch, corsProxy?: string }} [options]
   */
  constructor({ fetchFn = fetch, corsProxy } = {}) {
    if (typeof fetchFn !== 'function') {
      throw new TypeError('TarballManager fetchFn must be a function');
    }
    this.fetchFn = fetchFn;
    this.corsProxy = corsProxy;
  }

  /**
   * Download tarball as ArrayBuffer.
   * @param {string} url
   * @returns {Promise<ArrayBuffer>}
   */
  async download(url) {
    const targetUrl = this.corsProxy
      ? `${this.corsProxy}${encodeURIComponent(url)}`
      : url;

    const response = await this.fetchFn(targetUrl);
    if (!response || !response.ok) {
      const status = response ? response.status : 'unknown';
      throw new Error(`Failed to download tarball: HTTP ${status}`);
    }
    return response.arrayBuffer();
  }

  /**
   * Extract tar(.gz) data and write files to VFS.
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {{ writeFile: (path: string, content: string|Uint8Array) => Promise<unknown>, mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<unknown> }} vfs
   * @param {string} destPath
   * @returns {Promise<number>} number of extracted files
   */
  async extract(buffer, vfs, destPath) {
    const source = toUint8Array(buffer);
    let tarBytes = source;

    if (globalThis.pako && typeof globalThis.pako.inflate === 'function') {
      try {
        const inflated = globalThis.pako.inflate(source);
        tarBytes = toUint8Array(inflated);
      } catch {
        tarBytes = source;
      }
    } else if (typeof DecompressionStream === 'function') {
      try {
        tarBytes = await inflateWithDecompressionStream(source);
      } catch {
        tarBytes = source;
      }
    }

    const headers = parseTarHeaders(tarBytes);
    let written = 0;

    for (const header of headers) {
      if (header.type === '5') continue;
      if (!header.name) continue;

      const start = header.offset;
      const end = start + header.size;
      const content = tarBytes.slice(start, end);
      const filePath = joinPath(destPath, header.name);
      const slashIndex = filePath.lastIndexOf('/');
      if (slashIndex > 0 && typeof vfs.mkdir === 'function') {
        const dirPath = filePath.slice(0, slashIndex);
        await vfs.mkdir(dirPath, { recursive: true });
      }
      await vfs.writeFile(filePath, content);
      written += 1;
    }

    return written;
  }

  /**
   * Parse POSIX tar headers.
   * @param {ArrayBuffer|Uint8Array} buffer
   * @returns {TarHeader[]}
   */
  parseTarHeaders(buffer) {
    return parseTarHeaders(buffer);
  }
}

export default TarballManager;
