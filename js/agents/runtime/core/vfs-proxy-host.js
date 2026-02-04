import { createLogger } from "../../shared/index.js";
import { VFS_REQUEST, VFS_RESPONSE, VFS_OPS } from "./vfs-proxy-protocol.js";

const logger = createLogger("runtime/core/vfs-proxy-host");

/**
 * @typedef {'directory'|'file'|'unknown'} VfsDirEntryKind
 */

/**
 * @typedef {{ name: string, kind: VfsDirEntryKind }} VfsDirEntry
 */

/**
 * @typedef {object} VfsStatPayload
 * @property {boolean} exists
 * @property {number} [size]
 * @property {number} [mtimeMs]
 * @property {boolean} [isFile]
 * @property {boolean} [isDirectory]
 */

/**
 * @typedef {object} VfsLike
 * @property {(path: string) => Promise<Uint8Array>} [readFile]
 * @property {(path: string, data: any) => Promise<any>} [writeFile]
 * @property {(path: string, options?: any) => Promise<any>} [readdir]
 * @property {(path: string) => Promise<any>} [stat]
 * @property {(path: string, options?: any) => Promise<any>} [mkdir]
 * @property {(path: string, options?: any) => Promise<any>} [rmdir]
 * @property {(path: string) => Promise<any>} [unlink]
 * @property {(path: string) => Promise<any>} [list]
 * @property {(path: string) => Promise<boolean>} [exists]
 */

function isSharedArrayBuffer(value) {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function stripLeadingSlashes(path) {
  return String(path ?? "").replace(/^\/+/, "");
}

function isAbsoluteVfsPath(path) {
  if (/^[\\/]+/.test(path)) return true;
  return /^[A-Za-z]:[\\/]/.test(path);
}

function normalizeVfsPath(input) {
  const raw = String(input ?? "");
  if (!raw) return "";
  if (raw.includes("\0")) return null;
  if (raw.includes("\\")) return null;
  if (isAbsoluteVfsPath(raw)) return null;
  const normalized = stripLeadingSlashes(raw);
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === "..")) return null;
  return parts.filter((p) => p !== ".").join("/");
}

/**
 * Best-effort ENOENT detection across Node/DOMException/custom VFS impls.
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
 * @param {any} entries
 * @returns {VfsDirEntry[]}
 */
function toDirEntries(entries) {
  const arr = Array.isArray(entries) ? entries : [];
  return /** @type {any} */ (
    arr
      .map((entry) => {
        if (typeof entry === "string") {
          return { name: entry, kind: "unknown" };
        }
        const name = typeof entry?.name === "string" ? entry.name : String(entry?.name ?? "");
        const rawKind = typeof entry?.kind === "string" ? entry.kind : "";
        const isDir =
          rawKind === "dir" ||
          rawKind === "directory" ||
          (typeof entry?.isDirectory === "function" ? !!entry.isDirectory() : false);
        const isFile =
          rawKind === "file" ||
          (typeof entry?.isFile === "function" ? !!entry.isFile() : false);
        const kind = isDir ? "directory" : isFile ? "file" : "unknown";
        return { name, kind };
      })
      .filter((e) => typeof e.name === "string" && e.name.length > 0)
  );
}

/**
 * Shared response layout:
 * - Int32 header (16 bytes):
 *   [0] status: 1=ok, -1=error, 0=pending
 *   [1] byteLength: payload bytes written (or error msg bytes)
 *   [2] requiredBytes: >0 indicates overflow (client should retry with bigger buffer)
 *   [3] reserved
 * - Uint8 payload starts at offset 16
 *
 * @typedef {{ ok: boolean, bytes?: Uint8Array|ArrayBuffer|ArrayLike<number>|null, error?: any, requiredBytes?: number }} VfsSharedResponse
 */

/**
 * @param {SharedArrayBuffer} sharedBuffer
 * @param {VfsSharedResponse} response
 */
function writeSharedResponse(sharedBuffer, { ok, bytes, error, requiredBytes = 0 }) {
  const header = new Int32Array(sharedBuffer, 0, 4);
  const payload = new Uint8Array(sharedBuffer, 16);

  const encoder = new TextEncoder();
  const writeError = (message) => {
    const msg = typeof message === "string" ? message : String(message ?? "VFS error");
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

function safePostMessage(worker, message, transfer) {
  try {
    if (Array.isArray(transfer) && transfer.length > 0) {
      worker.postMessage(message, transfer);
    } else {
      worker.postMessage(message);
    }
  } catch (err) {
    logger.warn("[VfsProxyHost] postMessage failed", { error: err?.message || String(err) });
  }
}

export class VfsProxyHost {
  /**
   * @param {VfsLike | null | undefined} vfs
   * @param {Worker} worker
   */
  constructor(vfs, worker) {
    /** @type {VfsLike | null} */
    this.vfs = vfs || null;
    /** @type {Worker} */
    this.worker = worker;
    this._disposed = false;
    this._boundHandleMessage = this.handleMessage.bind(this);

    if (this.worker && typeof this.worker.addEventListener === "function") {
      this.worker.addEventListener("message", this._boundHandleMessage);
    } else {
      logger.warn("[VfsProxyHost] Worker does not support addEventListener; proxy disabled");
    }
  }

  /**
   * Update the underlying VFS implementation (useful when the adapter executes with a different context.vfs).
   * @param {VfsLike | null | undefined} vfs
   */
  setVfs(vfs) {
    this.vfs = vfs || null;
  }

  /**
   * Handle Worker "message" events.
   * @param {MessageEvent<any>} event
   */
  handleMessage(event) {
    const msg = event?.data;
    if (!msg || typeof msg !== "object" || msg.type !== VFS_REQUEST) return;
    void this._handleRequest(msg);
  }

  /**
   * @private
   * @param {import('./vfs-proxy-protocol.js').VfsProxyRequest} msg
   */
  async _handleRequest(msg) {
    if (this._disposed) return;

    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const op = String(msg.op || "");
    const path = String(msg.path || "");
    const args = msg.args;
    const sharedBuffer = msg.buffer;
    const syncMode = isSharedArrayBuffer(sharedBuffer);

    const vfs = this.vfs;
    if (!vfs) {
      const error = "VFS unavailable (host not configured)";
      if (syncMode) {
        writeSharedResponse(sharedBuffer, { ok: false, error });
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error });
      } else {
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error });
      }
      return;
    }

    const vfsPath = normalizeVfsPath(path);
    if (vfsPath === null) {
      const error = "Invalid VFS path";
      if (syncMode) {
        writeSharedResponse(sharedBuffer, { ok: false, error });
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error });
      } else {
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error });
      }
      return;
    }

    /** @type {any} */
    let result;
    try {
      if (op === VFS_OPS.READ) {
        if (typeof vfs.readFile !== "function") throw new Error("VFS does not implement readFile()");
        const bytes = await vfs.readFile(vfsPath);
        if (syncMode) {
          writeSharedResponse(sharedBuffer, { ok: true, bytes });
          safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: true });
        } else {
          // Async mode: bytes are sent via postMessage (structured clone).
          safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: true, data: { bytes } });
        }
        return;
      }

      if (op === VFS_OPS.WRITE) {
        if (typeof vfs.writeFile !== "function") throw new Error("VFS does not implement writeFile()");
        const data = args && typeof args === "object" ? args.data : undefined;
        await vfs.writeFile(vfsPath, data);
        result = { ok: true };
      } else if (op === VFS_OPS.LIST) {
        // Prefer readdir(withFileTypes) to preserve kinds.
        try {
          if (typeof vfs.readdir === "function") {
            const entries = await vfs.readdir(vfsPath, { withFileTypes: true });
            result = { exists: true, entries: toDirEntries(entries) };
          } else if (typeof vfs.list === "function") {
            const entries = await vfs.list(vfsPath);
            result = { exists: true, entries: toDirEntries(entries) };
          } else {
            throw new Error("VFS does not implement readdir() or list()");
          }
        } catch (err) {
          if (isMissingPathError(err)) {
            result = { exists: false, entries: [] };
          } else {
            throw err;
          }
        }
      } else if (op === VFS_OPS.STAT) {
        if (typeof vfs.stat !== "function") throw new Error("VFS does not implement stat()");
        try {
          const st = await vfs.stat(vfsPath);
          /** @type {VfsStatPayload} */
          const payload = {
            exists: true,
            size: typeof st?.size === "number" ? st.size : 0,
            mtimeMs: typeof st?.mtimeMs === "number" ? st.mtimeMs : undefined,
            isFile: typeof st?.isFile === "function" ? !!st.isFile() : false,
            isDirectory: typeof st?.isDirectory === "function" ? !!st.isDirectory() : false,
          };
          result = payload;
        } catch (err) {
          if (isMissingPathError(err)) {
            result = { exists: false };
          } else {
            throw err;
          }
        }
      } else if (op === VFS_OPS.MKDIR) {
        if (typeof vfs.mkdir !== "function") throw new Error("VFS does not implement mkdir()");
        const recursive = args && typeof args === "object" ? args.recursive !== false : true;
        await vfs.mkdir(vfsPath, { recursive });
        result = { ok: true };
      } else if (op === VFS_OPS.DELETE) {
        const recursive = args && typeof args === "object" ? args.recursive === true : false;
        if (typeof vfs.stat === "function") {
          try {
            const st = await vfs.stat(vfsPath);
            if (typeof st?.isDirectory === "function" && st.isDirectory()) {
              if (typeof vfs.rmdir !== "function") throw new Error("VFS does not implement rmdir()");
              await vfs.rmdir(vfsPath, { recursive });
            } else {
              if (typeof vfs.unlink !== "function") throw new Error("VFS does not implement unlink()");
              await vfs.unlink(vfsPath);
            }
          } catch (err) {
            if (isMissingPathError(err)) {
              // Deleting a missing path is treated as ok (idempotent).
            } else {
              throw err;
            }
          }
        } else {
          // Best effort when stat() unavailable.
          if (typeof vfs.unlink === "function") {
            try {
              await vfs.unlink(vfsPath);
            } catch (err) {
              if (!isMissingPathError(err)) throw err;
            }
          } else if (typeof vfs.rmdir === "function") {
            try {
              await vfs.rmdir(vfsPath, { recursive });
            } catch (err) {
              if (!isMissingPathError(err)) throw err;
            }
          } else {
            throw new Error("VFS does not implement delete operations (stat+unlink/rmdir)");
          }
        }
        result = { ok: true };
      } else if (op === VFS_OPS.EXISTS) {
        if (typeof vfs.exists === "function") {
          const exists = await vfs.exists(vfsPath);
          result = { exists: !!exists };
        } else if (typeof vfs.stat === "function") {
          try {
            await vfs.stat(vfsPath);
            result = { exists: true };
          } catch (err) {
            if (isMissingPathError(err)) {
              result = { exists: false };
            } else {
              throw err;
            }
          }
        } else {
          throw new Error("VFS does not implement exists() or stat()");
        }
      } else {
        throw new Error(`Unsupported VFS op: ${op}`);
      }

      const jsonBytes = new TextEncoder().encode(JSON.stringify(result ?? null));
      if (syncMode) {
        writeSharedResponse(sharedBuffer, { ok: true, bytes: jsonBytes });
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: true });
      } else {
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: true, data: result ?? null });
      }
    } catch (err) {
      const message = err?.message || String(err || "VFS error");
      const code = String(err?.code || "");
      const errorText = code && !message.includes(code) ? `${code}: ${message}` : message;

      if (syncMode) {
        writeSharedResponse(sharedBuffer, { ok: false, error: errorText });
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error: errorText });
      } else {
        safePostMessage(this.worker, { type: VFS_RESPONSE, id, ok: false, error: errorText });
      }

      logger.warn("[VfsProxyHost] request failed", { op, path: vfsPath, error: errorText });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try {
      if (this.worker && typeof this.worker.removeEventListener === "function") {
        this.worker.removeEventListener("message", this._boundHandleMessage);
      }
    } catch (err) {
      logger.warn("[VfsProxyHost] dispose() failed", { error: err?.message || String(err) });
    }
  }
}

export default VfsProxyHost;
