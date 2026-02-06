/**
 * Node-only I/O utilities for adapters.
 *
 * These functions wrap `node:path` and `node:fs/promises` with runtime detection.
 * In browser environments, they throw clear errors instead of attempting to load Node modules.
 *
 * @module adapters/node-io
 */

import { isNodeLike } from "../../shared/index.js";

/**
 * Assert Node environment or throw a descriptive error.
 * @param {string} operation - Description of the attempted operation
 * @throws {Error} If not in Node environment
 */
function assertNodeEnvironment(operation) {
  if (!isNodeLike()) {
    throw new Error(
      `${operation} requires Node.js. ` +
      `In browser environments, pass a File or ArrayBuffer instead of a file path.`
    );
  }
}

/**
 * Get basename of a file path (Node-only).
 * @param {string} path - File path
 * @returns {Promise<string>} Base filename
 * @throws {Error} If not in Node environment
 */
export async function basenameOfPath(path) {
  assertNodeEnvironment("basenameOfPath()");
  const { basename } = await import("node:path");
  return basename(path);
}

/**
 * Read file contents as Buffer (Node-only).
 * @param {string} path - File path
 * @param {string} [encoding] - Optional encoding (e.g., 'utf8')
 * @returns {Promise<Buffer|string>} File contents
 * @throws {Error} If not in Node environment
 */
export async function readFileFromPath(path, encoding) {
  assertNodeEnvironment("readFileFromPath()");
  const { readFile } = await import("node:fs/promises");
  return encoding ? readFile(path, encoding) : readFile(path);
}

/**
 * Get file stats (Node-only).
 * @param {string} path - File path
 * @returns {Promise<{size: number, mtime: Date}>} File stats
 * @throws {Error} If not in Node environment
 */
export async function statFile(path) {
  assertNodeEnvironment("statFile()");
  const { stat } = await import("node:fs/promises");
  return stat(path);
}

/**
 * Convert Node Buffer to ArrayBuffer.
 * @param {Buffer|null} buf - Node Buffer
 * @returns {ArrayBuffer}
 */
export function bufferToArrayBuffer(buf) {
  if (!buf) return new ArrayBuffer(0);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Create a file-like object from a file path (Node-only).
 * @param {string} path - File path
 * @param {object} [options]
 * @param {number} [options.maxBytes] - Maximum allowed file size
 * @param {string} [options.mimeType] - MIME type to set on the file-like object
 * @returns {Promise<{name: string, type: string, size: number, arrayBuffer: () => Promise<ArrayBuffer>}>}
 * @throws {Error} If not in Node environment or file exceeds maxBytes
 */
export async function fileLikeFromPath(path, { maxBytes, mimeType = "application/octet-stream" } = {}) {
  assertNodeEnvironment("fileLikeFromPath()");
  const { readFile, stat } = await import("node:fs/promises");
  const { basename } = await import("node:path");

  const stats = await stat(path);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && stats.size > maxBytes) {
    throw new Error(`File too large: ${stats.size} bytes (max ${maxBytes})`);
  }

  const buf = await readFile(path);
  const name = basename(path);

  return {
    name,
    type: mimeType,
    size: buf.length,
    async arrayBuffer() {
      return bufferToArrayBuffer(buf);
    },
  };
}

/**
 * Read text content from a file path (Node-only).
 * @param {string} path - File path
 * @param {object} [options]
 * @param {number} [options.maxBytes] - Maximum allowed file size
 * @returns {Promise<{text: string, size: number}>}
 * @throws {Error} If not in Node environment or file exceeds maxBytes
 */
export async function readTextFromPath(path, { maxBytes } = {}) {
  assertNodeEnvironment("readTextFromPath()");
  const { readFile, stat } = await import("node:fs/promises");

  const stats = await stat(path);
  if (Number.isFinite(maxBytes) && maxBytes > 0 && stats.size > maxBytes) {
    throw new Error(`File too large: ${stats.size} bytes (max ${maxBytes})`);
  }

  const text = await readFile(path, "utf8");
  return { text, size: stats.size };
}

/**
 * Check if running in Node.js environment.
 * @returns {boolean}
 */
export { isNodeLike as isNodeEnvironment };
