import { createLogger } from "../../shared/index.js";
import { VFS_REQUEST, VFS_RESPONSE, VFS_OPS } from "./vfs-proxy-protocol.js";

const logger = createLogger("runtime/core/vfs-proxy-client");

function isSharedArrayBufferAvailable() {
  try {
    return typeof SharedArrayBuffer !== "undefined" && new SharedArrayBuffer(1).byteLength === 1;
  } catch {
    return false;
  }
}

function hasAtomicsWait() {
  try {
    return typeof Atomics !== "undefined" && typeof Atomics.wait === "function";
  } catch {
    return false;
  }
}

function isSharedArrayBuffer(value) {
  return isSharedArrayBufferAvailable() && value instanceof SharedArrayBuffer;
}

/**
 * @param {any} err
 * @returns {boolean}
 */
function isMissingPathError(err) {
  const code = String(err?.code || "");
  if (code === "ENOENT") return true;
  const msg = String(err?.message || err || "");
  return msg.includes("ENOENT") || msg.includes("NotFoundError");
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} op
 * @param {any} payload
 * @returns {any}
 */
function validateJsonPayload(op, payload) {
  if (!isPlainObject(payload)) {
    throw new Error(`VfsProxyClient: invalid ${op} payload`);
  }

  if (op === VFS_OPS.STAT) {
    if (typeof payload.exists !== "boolean") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (missing exists)`);
    }
    if ("size" in payload && typeof payload.size !== "number") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (size)`);
    }
    if ("mtimeMs" in payload && typeof payload.mtimeMs !== "number") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (mtimeMs)`);
    }
    if ("isFile" in payload && typeof payload.isFile !== "boolean") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (isFile)`);
    }
    if ("isDirectory" in payload && typeof payload.isDirectory !== "boolean") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (isDirectory)`);
    }
    return payload;
  }

  if (op === VFS_OPS.LIST) {
    if (typeof payload.exists !== "boolean") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (missing exists)`);
    }
    if (!Array.isArray(payload.entries)) {
      throw new Error(`VfsProxyClient: invalid ${op} payload (entries)`);
    }
    for (const entry of payload.entries) {
      if (!isPlainObject(entry) || typeof entry.name !== "string") {
        throw new Error(`VfsProxyClient: invalid ${op} payload (entry)`);
      }
      if ("kind" in entry && typeof entry.kind !== "string") {
        throw new Error(`VfsProxyClient: invalid ${op} payload (entry.kind)`);
      }
    }
    return payload;
  }

  if (op === VFS_OPS.EXISTS) {
    if (typeof payload.exists !== "boolean") {
      throw new Error(`VfsProxyClient: invalid ${op} payload (missing exists)`);
    }
    return payload;
  }

  if (op === VFS_OPS.WRITE || op === VFS_OPS.MKDIR || op === VFS_OPS.DELETE) {
    if ("ok" in payload && payload.ok !== true) {
      throw new Error(`VfsProxyClient: invalid ${op} payload (ok)`);
    }
    return payload;
  }

  return payload;
}

/**
 * VFS Proxy Client (Worker side)
 *
 * Exposes a VFS-like interface for runtimes that require synchronous I/O (e.g., Pyodide FS).
 *
 * Sync mode requirements:
 * - SharedArrayBuffer enabled (crossOriginIsolated in browsers)
 * - Atomics.wait available (Worker only)
 *
 * Shared response layout (matches vfs-proxy-host.js):
 * - Int32 header (16 bytes):
 *   [0] status: 1=ok, -1=error, 0=pending
 *   [1] byteLength: payload bytes written (or error msg bytes)
 *   [2] requiredBytes: >0 indicates overflow
 *   [3] reserved
 * - Uint8 payload starts at offset 16
 */

/**
 * @typedef {object} VfsProxyClientOptions
 * @property {(msg:any, transfer?: Transferable[]) => void} [postMessage]
 * @property {EventTarget & { postMessage?: Function }} [target] - defaults to `self` in worker
 * @property {number} [timeoutMs]
 * @property {number} [maxJsonBytes]
 * @property {SharedArrayBuffer} [sharedBuffer] - optional reusable response buffer for sync mode
 */

export class VfsProxyClient {
  /**
   * @param {VfsProxyClientOptions} [options]
   */
  constructor(options = {}) {
    /** @type {EventTarget & { postMessage?: Function }} */
    this._target = options.target || /** @type {any} */ (typeof self !== "undefined" ? self : globalThis);
    /** @type {(msg:any, transfer?: Transferable[]) => void} */
    this._postMessage =
      options.postMessage ||
      ((msg, transfer) => {
        const pm = this._target?.postMessage;
        if (typeof pm !== "function") throw new Error("VfsProxyClient: postMessage unavailable");
        if (Array.isArray(transfer) && transfer.length > 0) pm.call(this._target, msg, transfer);
        else pm.call(this._target, msg);
      });

    this.timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 30_000;
    this.maxJsonBytes = typeof options.maxJsonBytes === "number" ? options.maxJsonBytes : 256 * 1024;

    this._supportsSync = isSharedArrayBufferAvailable() && hasAtomicsWait();

    /** @type {SharedArrayBuffer | null} */
    this._sharedBuffer = isSharedArrayBuffer(options.sharedBuffer) ? options.sharedBuffer : null;

    /** @type {Map<number, { resolve: (value:any)=>void, reject: (err:any)=>void }>} */
    this._pending = new Map();
    this._nextId = 0;

    this._boundOnMessage = this._handleMessageEvent.bind(this);
    if (this._target && typeof this._target.addEventListener === "function") {
      this._target.addEventListener("message", this._boundOnMessage);
    }
  }

  get supportsSync() {
    return this._supportsSync;
  }

  dispose() {
    try {
      if (this._target && typeof this._target.removeEventListener === "function") {
        this._target.removeEventListener("message", this._boundOnMessage);
      }
    } catch (err) {
      logger.warn("[VfsProxyClient] dispose() failed", { error: err?.message || String(err) });
    }
    for (const [id, pending] of this._pending) {
      pending.reject(new Error("VfsProxyClient disposed"));
      this._pending.delete(id);
    }
  }

  /**
   * Async: read file from host VFS.
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   */
  async readFile(path) {
    const res = await this._requestAsync(VFS_OPS.READ, path, {});
    const bytes = res?.bytes;
    if (bytes instanceof Uint8Array) return bytes;
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    return new Uint8Array(0);
  }

  /**
   * Async: write file to host VFS.
   * @param {string} path
   * @param {any} data
   * @returns {Promise<boolean>}
   */
  async writeFile(path, data) {
    await this._requestAsync(VFS_OPS.WRITE, path, { data });
    return true;
  }

  /**
   * Async: list directory entries.
   * @param {string} path
   * @returns {Promise<any>}
   */
  async list(path) {
    return await this._requestAsync(VFS_OPS.LIST, path, {});
  }

  /**
   * Async: stat path.
   * @param {string} path
   * @returns {Promise<any>}
   */
  async stat(path) {
    return await this._requestAsync(VFS_OPS.STAT, path, {});
  }

  /**
   * Async: create directory.
   * @param {string} path
   * @param {{ recursive?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async mkdir(path, options = {}) {
    await this._requestAsync(VFS_OPS.MKDIR, path, { recursive: options.recursive !== false });
    return true;
  }

  /**
   * Async: delete file/dir.
   * @param {string} path
   * @param {{ recursive?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async delete(path, options = {}) {
    await this._requestAsync(VFS_OPS.DELETE, path, { recursive: options.recursive === true });
    return true;
  }

  /**
   * Async: exists check.
   * @param {string} path
   * @returns {Promise<boolean>}
   */
  async exists(path) {
    const res = await this._requestAsync(VFS_OPS.EXISTS, path, {});
    return !!res?.exists;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sync mode (for Pyodide FS)
  // ───────────────────────────────────────────────────────────────────────────

  _assertSync() {
    if (!this._supportsSync) {
      throw new Error("VfsProxyClient: sync mode requires SharedArrayBuffer + Atomics.wait (crossOriginIsolated)");
    }
  }

  /**
   * Ensure `this._sharedBuffer` has at least `payloadBytes` payload capacity.
   * @param {number} payloadBytes
   * @returns {SharedArrayBuffer}
   */
  _ensureSharedBuffer(payloadBytes) {
    const cap = Math.max(64, Number.isFinite(payloadBytes) ? Math.floor(payloadBytes) : 0);
    const desired = 16 + cap;
    const current = this._sharedBuffer;
    if (current && current.byteLength >= desired) return current;
    const buf = new SharedArrayBuffer(desired);
    this._sharedBuffer = buf;
    return buf;
  }

  /**
   * @param {string} op
   * @param {string} path
   * @param {any} args
   * @param {{ payloadBytes: number }} param3
   * @returns {Uint8Array}
   */
  _requestBytesSync(op, path, args, { payloadBytes }) {
    this._assertSync();

    const id = ++this._nextId;
    const sharedBuffer = this._ensureSharedBuffer(payloadBytes);
    const header = new Int32Array(sharedBuffer, 0, 4);
    const payload = new Uint8Array(sharedBuffer, 16);

    Atomics.store(header, 0, 0);
    Atomics.store(header, 1, 0);
    Atomics.store(header, 2, 0);
    Atomics.store(header, 3, 0);

    this._postMessage({
      type: VFS_REQUEST,
      id,
      op,
      path: String(path || "/"),
      args,
      mode: "sync",
      buffer: sharedBuffer,
    });

    const res = Atomics.wait(header, 0, 0, this.timeoutMs);
    if (res === "timed-out") {
      throw new Error(`VfsProxyClient: ${op} timed out for ${path}`);
    }

    const status = Atomics.load(header, 0);
    const len = Atomics.load(header, 1);
    const required = Atomics.load(header, 2);

    if (status !== 1) {
      const msg = new TextDecoder().decode(payload.subarray(0, Math.max(0, len)));
      /** @type {Error & { code?: string, requiredBytes?: number }} */
      const err = new Error(msg || `VFS ${op} failed for ${path}`);
      err.code = required > 0 ? "EOVERFLOW" : isMissingPathError(msg) ? "ENOENT" : "EVFS";
      err.requiredBytes = required > 0 ? required : undefined;
      throw err;
    }

    return payload.subarray(0, Math.max(0, len));
  }

  /**
   * @param {string} op
   * @param {string} path
   * @param {any} args
   * @returns {any}
   */
  _requestJsonSync(op, path, args) {
    const bytes = this._requestBytesSync(op, path, args, { payloadBytes: this.maxJsonBytes });
    const text = new TextDecoder().decode(bytes);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      throw new Error(`VfsProxyClient: invalid JSON response for ${op}(${path}): ${err?.message || String(err)}`);
    }
    try {
      return validateJsonPayload(op, payload);
    } catch (err) {
      throw new Error(`VfsProxyClient: invalid ${op} payload for ${path}: ${err?.message || String(err)}`);
    }
  }

  /**
   * Sync: read file from host VFS.
   * @param {string} path
   * @param {{ sizeHint?: number }} [options]
   * @returns {Uint8Array}
   */
  readFileSync(path, options = {}) {
    let cap = typeof options.sizeHint === "number" && Number.isFinite(options.sizeHint) && options.sizeHint >= 0 ? Math.floor(options.sizeHint) : 4 * 1024 * 1024;
    cap = Math.max(64, cap);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this._requestBytesSync(VFS_OPS.READ, path, {}, { payloadBytes: cap });
      } catch (err) {
        if (String(err?.code || "") === "EOVERFLOW" && typeof err.requiredBytes === "number" && err.requiredBytes > cap) {
          cap = err.requiredBytes;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`VfsProxyClient.readFileSync: too many attempts for ${path}`);
  }

  /**
   * Sync: write file to host VFS.
   * @param {string} path
   * @param {any} data
   * @returns {boolean}
   */
  writeFileSync(path, data) {
    this._requestJsonSync(VFS_OPS.WRITE, path, { data });
    return true;
  }

  /**
   * Sync: stat (returns payload with { exists, size, isFile, isDirectory, ... }).
   * @param {string} path
   * @returns {any}
   */
  statSync(path) {
    return this._requestJsonSync(VFS_OPS.STAT, path, {});
  }

  /**
   * Sync: list directory (returns payload with { exists, entries }).
   * @param {string} path
   * @returns {any}
   */
  listSync(path) {
    return this._requestJsonSync(VFS_OPS.LIST, path, {});
  }

  /**
   * Sync: mkdir.
   * @param {string} path
   * @param {{ recursive?: boolean }} [options]
   * @returns {boolean}
   */
  mkdirSync(path, options = {}) {
    this._requestJsonSync(VFS_OPS.MKDIR, path, { recursive: options.recursive !== false });
    return true;
  }

  /**
   * Sync: delete (file/dir).
   * @param {string} path
   * @param {{ recursive?: boolean }} [options]
   * @returns {boolean}
   */
  deleteSync(path, options = {}) {
    this._requestJsonSync(VFS_OPS.DELETE, path, { recursive: options.recursive === true });
    return true;
  }

  /**
   * Sync: exists.
   * @param {string} path
   * @returns {boolean}
   */
  existsSync(path) {
    const res = this._requestJsonSync(VFS_OPS.EXISTS, path, {});
    return !!res?.exists;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: async request/response
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @private
   * @param {MessageEvent<any>} event
   */
  _handleMessageEvent(event) {
    const msg = event?.data;
    if (!msg || typeof msg !== "object" || msg.type !== VFS_RESPONSE) return;
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const pending = this._pending.get(id);
    if (!pending) return;
    this._pending.delete(id);
    if (msg.ok) pending.resolve(msg.data);
    else pending.reject(new Error(msg.error || "VFS request failed"));
  }

  /**
   * @private
   * @param {string} op
   * @param {string} path
   * @param {any} args
   * @returns {Promise<any>}
   */
  _requestAsync(op, path, args) {
    const id = ++this._nextId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try {
        this._postMessage({
          type: VFS_REQUEST,
          id,
          op,
          path: String(path || "/"),
          args,
          mode: "async",
        });
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }
}

export default VfsProxyClient;
