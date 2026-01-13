/**
 * VFS Proxy Protocol
 *
 * Defines message types and payload shapes for bridging VFS calls between:
 * - Main thread (host): executes real VFS operations (e.g., OPFS-backed VFS)
 * - Worker (client): exposes a VFS-like API to runtimes (e.g., Pyodide)
 *
 * Transport:
 * - Sync mode: request includes a SharedArrayBuffer; host writes the response into it and wakes the worker with Atomics.notify.
 * - Async mode: request/response are regular postMessage payloads.
 */

export const VFS_REQUEST = /** @type {const} */ ("vfs:request");
export const VFS_RESPONSE = /** @type {const} */ ("vfs:response");

export const VFS_OPS = Object.freeze({
  READ: /** @type {const} */ ("read"),
  WRITE: /** @type {const} */ ("write"),
  LIST: /** @type {const} */ ("list"),
  STAT: /** @type {const} */ ("stat"),
  MKDIR: /** @type {const} */ ("mkdir"),
  DELETE: /** @type {const} */ ("delete"),
  EXISTS: /** @type {const} */ ("exists"),
});

/**
 * @typedef {'read'|'write'|'list'|'stat'|'mkdir'|'delete'|'exists'} VfsProxyOp
 */

/**
 * @typedef {'sync'|'async'} VfsProxyMode
 */

/**
 * Request payload.
 *
 * In sync mode, `buffer` must be a SharedArrayBuffer with the layout described in `vfs-proxy-client.js`.
 *
 * @typedef {object} VfsProxyRequest
 * @property {typeof VFS_REQUEST} type
 * @property {number} id - monotonically increasing request id (client-generated)
 * @property {VfsProxyOp} op
 * @property {string} path - absolute POSIX path from the worker FS (e.g. "/mnt/workspace/a.txt")
 * @property {any} [args] - op-specific arguments
 * @property {VfsProxyMode} [mode]
 * @property {SharedArrayBuffer} [buffer] - sync mode response buffer
 */

/**
 * Response payload (async mode).
 *
 * @typedef {object} VfsProxyResponse
 * @property {typeof VFS_RESPONSE} type
 * @property {number} id
 * @property {boolean} ok
 * @property {any} [data]
 * @property {string} [error]
 */

