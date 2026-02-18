import { protoSafeReviver } from "../../shared/utils/safe-json.js";
import { VFS_REQUEST, VFS_OPS } from "./vfs-proxy-protocol.js";
/**
 * VfsProxy
 *
 * A small RPC bridge between a Worker and the main thread for on-demand VFS access.
 *
 * Design goals:
 * - Worker initiates requests only when a file/dir is needed.
 * - Main thread reads from the kernel VFS and writes responses into a SharedArrayBuffer,
 *   then wakes the worker via Atomics.notify (so the worker can keep the call "sync").
 *
 * This is intentionally minimal: only the operations required by the Python runtime
 * (stat/readdir/readFile) are implemented.
 */

/**
 * @typedef {'directory'|'file'|'unknown'} VfsDirEntryKind
 */

/**
 * @typedef {Object} VfsDirEntry
 * @property {string} name
 * @property {VfsDirEntryKind} kind
 */

/**
 * @typedef {Object} VfsSharedResponse
 * @property {boolean} ok
 * @property {Uint8Array|ArrayBuffer|ArrayLike<number>|null|undefined} [bytes]
 * @property {any} [error]
 * @property {number} [requiredBytes]
 */

/**
 * @typedef {Object} VfsProxyOptions
 * @property {'server'|'client'} [role]
 * @property {(msg:any)=>void} [postMessage]
 * @property {(runId:number)=>any} [getVfs] - server-only; maps runId -> VFS
 * @property {number} [timeoutMs] - client-only; Atomics.wait timeout
 * @property {number} [maxJsonBytes] - client-only; response buffer size for JSON ops
 * @property {SharedArrayBuffer} [sharedBuffer] - client-only; reusable sync response buffer
 */

/**
 * @typedef {Error & { code?: string, requiredBytes?: number }} VfsProxyError
 */

function isSharedArrayBuffer(value) {
  return typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer;
}

/**
 * @param {string} op
 * @returns {string|null}
 */
function normalizeProxyOp(op) {
  const raw = String(op || '');
  if (raw === VFS_OPS.READ || raw === 'readFile') return VFS_OPS.READ;
  if (raw === VFS_OPS.LIST || raw === 'readdir') return VFS_OPS.LIST;
  if (raw === VFS_OPS.STAT) return VFS_OPS.STAT;
  if (raw === VFS_OPS.WRITE) return VFS_OPS.WRITE;
  if (raw === VFS_OPS.MKDIR) return VFS_OPS.MKDIR;
  if (raw === VFS_OPS.DELETE) return VFS_OPS.DELETE;
  if (raw === VFS_OPS.EXISTS) return VFS_OPS.EXISTS;
  return null;
}

function stripLeadingSlashes(path) {
  return String(path ?? '').replace(/^\/+/, '');
}

function toDirEntries(entries) {
  const arr = Array.isArray(entries) ? entries : [];
  return arr
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, kind: 'unknown' };
      }
      const name = typeof entry?.name === 'string' ? entry.name : String(entry?.name ?? '');
      const isDir = typeof entry?.isDirectory === 'function' ? !!entry.isDirectory() : false;
      const isFile = typeof entry?.isFile === 'function' ? !!entry.isFile() : false;
      const kind = isDir ? 'directory' : isFile ? 'file' : 'unknown';
      return { name, kind };
    })
    .filter((e) => typeof e.name === 'string' && e.name.length > 0);
}

function isMissingPathError(err) {
  const code = String(err?.code || '');
  if (code === 'ENOENT') return true;
  const msg = String(err?.message || err || '');
  return msg.includes('ENOENT');
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {any} payload
 * @returns {any}
 */
function validateStatPayload(payload) {
  if (!isPlainObject(payload) || typeof payload.exists !== 'boolean') {
    throw new Error('invalid stat payload');
  }
  if ('size' in payload && typeof payload.size !== 'number') {
    throw new Error('invalid stat payload (size)');
  }
  if ('mtimeMs' in payload && typeof payload.mtimeMs !== 'number') {
    throw new Error('invalid stat payload (mtimeMs)');
  }
  if ('isFile' in payload && typeof payload.isFile !== 'boolean') {
    throw new Error('invalid stat payload (isFile)');
  }
  if ('isDirectory' in payload && typeof payload.isDirectory !== 'boolean') {
    throw new Error('invalid stat payload (isDirectory)');
  }
  return payload;
}

/**
 * @param {any} payload
 * @returns {any}
 */
function validateReaddirPayload(payload) {
  if (!isPlainObject(payload) || typeof payload.exists !== 'boolean') {
    throw new Error('invalid readdir payload');
  }
  if (!Array.isArray(payload.entries)) {
    throw new Error('invalid readdir payload (entries)');
  }
  for (const entry of payload.entries) {
    if (!isPlainObject(entry) || typeof entry.name !== 'string') {
      throw new Error('invalid readdir payload (entry)');
    }
    if ('kind' in entry && typeof entry.kind !== 'string') {
      throw new Error('invalid readdir payload (entry.kind)');
    }
  }
  return payload;
}

/**
 * @param {SharedArrayBuffer} sharedBuffer
 * @param {VfsSharedResponse} param1
 * @returns {void}
 */
function writeSharedResponse(sharedBuffer, { ok, bytes, error, requiredBytes = 0 }) {
  const header = new Int32Array(sharedBuffer, 0, 4);
  const payload = new Uint8Array(sharedBuffer, 16);

  const encoder = new TextEncoder();
  const writeError = (message) => {
    const msg = typeof message === 'string' ? message : String(message ?? 'VFS error');
    const encoded = encoder.encode(msg);
    const len = Math.min(encoded.byteLength, payload.byteLength);
    payload.set(encoded.subarray(0, len));
    Atomics.store(header, 1, len);
    Atomics.store(header, 2, requiredBytes > 0 ? requiredBytes : 0);
    Atomics.store(header, 0, -1);
    Atomics.notify(header, 0);
  };

  if (!ok) {
    writeError(error);
    return;
  }

  const out = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (out.byteLength > payload.byteLength) {
    requiredBytes = out.byteLength;
    writeError(`EOVERFLOW: response requires ${requiredBytes} bytes`);
    return;
  }

  payload.set(out);
  Atomics.store(header, 1, out.byteLength);
  Atomics.store(header, 2, 0);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

export class VfsProxy {
  /**
   * @param {VfsProxyOptions} [options]
   */
  constructor(options = {}) {
    this.role = options.role;
    this.postMessage = options.postMessage;
    this.getVfs = options.getVfs;
    this.timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 30_000;
    this.maxJsonBytes = typeof options.maxJsonBytes === 'number' ? options.maxJsonBytes : 256 * 1024;
    this._sharedBuffer = isSharedArrayBuffer(options.sharedBuffer) ? options.sharedBuffer : null;
    this._runId = null;
  }

  setRunId(runId) {
    const n = typeof runId === 'number' ? runId : Number(runId);
    this._runId = Number.isFinite(n) ? n : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Server side
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Handle a `vfs:request` message from the worker.
   * @param {any} message
   * @returns {Promise<boolean>} whether message was handled
   */
  async handleServerMessage(message) {
    const msg = message && typeof message === 'object' ? message : null;
    if (!msg || msg.type !== VFS_REQUEST) return false;
    if (this.role !== 'server') return false;

    const sharedBuffer = msg.buffer;
    if (!isSharedArrayBuffer(sharedBuffer)) return true;

    const runId = typeof msg.runId === 'number' ? msg.runId : Number(msg.runId);
    const vfs = typeof this.getVfs === 'function' ? this.getVfs(runId) : null;
    if (!vfs) {
      writeSharedResponse(sharedBuffer, { ok: false, error: `VFS unavailable for runId=${runId}` });
      return true;
    }

    const opRaw = String(msg.op || '');
    const op = normalizeProxyOp(opRaw);
    const path = String(msg.path || '');
    const vfsPath = stripLeadingSlashes(path);

    try {
      if (op === VFS_OPS.READ) {
        const bytes = await vfs.readFile(vfsPath);
        writeSharedResponse(sharedBuffer, { ok: true, bytes });
        return true;
      }

      if (op === VFS_OPS.STAT) {
        try {
          const st = await vfs.stat(vfsPath);
          const payload = {
            exists: true,
            size: typeof st?.size === 'number' ? st.size : 0,
            mtimeMs: typeof st?.mtimeMs === 'number' ? st.mtimeMs : undefined,
            isFile: typeof st?.isFile === 'function' ? !!st.isFile() : false,
            isDirectory: typeof st?.isDirectory === 'function' ? !!st.isDirectory() : false,
          };
          const json = new TextEncoder().encode(JSON.stringify(payload));
          writeSharedResponse(sharedBuffer, { ok: true, bytes: json });
        } catch (err) {
          if (isMissingPathError(err)) {
            const json = new TextEncoder().encode(JSON.stringify({ exists: false }));
            writeSharedResponse(sharedBuffer, { ok: true, bytes: json });
            return true;
          }
          throw err;
        }
        return true;
      }

      if (op === VFS_OPS.LIST) {
        try {
          const entries = await vfs.readdir(vfsPath, { withFileTypes: true });
          const payload = { exists: true, entries: toDirEntries(entries) };
          const json = new TextEncoder().encode(JSON.stringify(payload));
          writeSharedResponse(sharedBuffer, { ok: true, bytes: json });
        } catch (err) {
          if (isMissingPathError(err)) {
            const json = new TextEncoder().encode(JSON.stringify({ exists: false, entries: [] }));
            writeSharedResponse(sharedBuffer, { ok: true, bytes: json });
            return true;
          }
          throw err;
        }
        return true;
      }

      writeSharedResponse(sharedBuffer, { ok: false, error: `Unsupported VFS op: ${opRaw}` });
      return true;
    } catch (err) {
      writeSharedResponse(sharedBuffer, { ok: false, error: err?.message || String(err) });
      return true;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Client side (sync RPC via SAB + Atomics.wait)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} payloadBytes
   * @returns {SharedArrayBuffer}
   */
  _ensureSharedBuffer(payloadBytes) {
    const bytesCap = typeof payloadBytes === 'number' && payloadBytes > 0 ? Math.floor(payloadBytes) : 1024;
    const desired = 16 + bytesCap;
    if (this._sharedBuffer && this._sharedBuffer.byteLength >= desired) {
      return this._sharedBuffer;
    }
    const next = new SharedArrayBuffer(desired);
    this._sharedBuffer = next;
    return next;
  }

  _assertClientSyncSupport() {
    if (this.role !== 'client') {
      throw new Error('VfsProxy client methods require role="client"');
    }
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('VfsProxy requires SharedArrayBuffer support in the worker');
    }
    if (typeof Atomics === 'undefined' || typeof Atomics.wait !== 'function') {
      throw new Error('VfsProxy requires Atomics.wait support in the worker');
    }
    if (typeof this.postMessage !== 'function') {
      throw new Error('VfsProxy requires postMessage(msg)');
    }
  }

  _requestBytesSync(op, path, { payloadBytes }) {
    this._assertClientSyncSupport();
    const runId = this._runId;
    if (!Number.isFinite(runId)) {
      throw new Error('VfsProxy: runId not set (call setRunId(runId) first)');
    }

    const normalizedOp = normalizeProxyOp(op);
    if (!normalizedOp) {
      throw new Error(`VfsProxy: unsupported op ${op}`);
    }

    const bytesCap = typeof payloadBytes === 'number' && payloadBytes > 0 ? Math.floor(payloadBytes) : 1024;
    const sharedBuffer = this._ensureSharedBuffer(bytesCap);
    const header = new Int32Array(sharedBuffer, 0, 4);

    Atomics.store(header, 0, 0);
    Atomics.store(header, 1, 0);
    Atomics.store(header, 2, 0);
    Atomics.store(header, 3, 0);

    this.postMessage({
      type: VFS_REQUEST,
      op: normalizedOp,
      runId,
      path,
      buffer: sharedBuffer,
    });

    const res = Atomics.wait(header, 0, 0, this.timeoutMs);
    if (res === 'timed-out') {
      throw new Error(`VfsProxy: ${normalizedOp} timed out for ${path}`);
    }

    const status = Atomics.load(header, 0);
    const len = Atomics.load(header, 1);
    const required = Atomics.load(header, 2);
    const payload = new Uint8Array(sharedBuffer, 16, bytesCap);

    if (status !== 1) {
      const msg = new TextDecoder().decode(payload.subarray(0, Math.max(0, len)));
      /** @type {VfsProxyError} */
      const err = new Error(msg || `VfsProxy: ${normalizedOp} failed for ${path}`);
      err.code = required > 0 ? 'EOVERFLOW' : 'EVFS';
      err.requiredBytes = required > 0 ? required : undefined;
      throw err;
    }

    return payload.subarray(0, Math.max(0, len));
  }

  statSync(path) {
    const bytes = this._requestBytesSync(VFS_OPS.STAT, path, { payloadBytes: this.maxJsonBytes });
    const text = new TextDecoder().decode(bytes);
    let payload;
    try {
      payload = JSON.parse(text, protoSafeReviver);
    } catch (err) {
      throw new Error(`VfsProxy.statSync: invalid JSON response (${err?.message || err})`);
    }
    try {
      return validateStatPayload(payload);
    } catch (err) {
      throw new Error(`VfsProxy.statSync: invalid payload (${err?.message || err})`);
    }
  }

  readdirSync(path) {
    const bytes = this._requestBytesSync(VFS_OPS.LIST, path, { payloadBytes: this.maxJsonBytes });
    const text = new TextDecoder().decode(bytes);
    let payload;
    try {
      payload = JSON.parse(text, protoSafeReviver);
    } catch (err) {
      throw new Error(`VfsProxy.readdirSync: invalid JSON response (${err?.message || err})`);
    }
    try {
      return validateReaddirPayload(payload);
    } catch (err) {
      throw new Error(`VfsProxy.readdirSync: invalid payload (${err?.message || err})`);
    }
  }

  /**
   * @param {string} path
   * @param {{ sizeHint?: number }} [param1]
   * @returns {Uint8Array}
   */
  readFileSync(path, { sizeHint } = {}) {
    let cap = typeof sizeHint === 'number' && Number.isFinite(sizeHint) && sizeHint >= 0 ? Math.floor(sizeHint) : 4 * 1024 * 1024;
    cap = Math.max(64, cap);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this._requestBytesSync(VFS_OPS.READ, path, { payloadBytes: cap });
      } catch (err) {
        if (String(err?.code || '') === 'EOVERFLOW' && typeof err.requiredBytes === 'number' && err.requiredBytes > cap) {
          cap = err.requiredBytes;
          continue;
        }
        throw err;
      }
    }

    throw new Error(`VfsProxy.readFileSync: too many attempts for ${path}`);
  }
}

export default VfsProxy;
