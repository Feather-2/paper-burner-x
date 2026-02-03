/**
 * File Watcher - Cross-platform file watcher with native Node support and polling fallback.
 * @module shared/utils/file-watcher
 */

import { DisposableBase } from "../base/disposable-base.js";
import { toNonEmptyString, toPositiveInt } from "./value-utils.js";

/**
 * @typedef {import("../../core/contracts/disposable.js").Disposable} Disposable
 *
 * @typedef {"change" | "rename" | "error"} FileWatcherEventType
 *
 * @typedef {object} FileWatcherEvent
 * @property {FileWatcherEventType} type
 * @property {string} path
 * @property {Error=} error
 *
 * Minimal `process` shape used by this module.
 * (Avoids a hard dependency on `@types/node` in browser builds.)
 * @typedef {object} ProcessLike
 * @property {{ node?: string }=} versions
 *
 * @typedef {object} VfsStatLike
 * @property {number=} size
 * @property {number=} mtimeMs
 * @property {() => boolean=} isFile
 * @property {() => boolean=} isDirectory
 *
 * @typedef {object} VfsLike
 * @property {(path: string) => Promise<VfsStatLike>} stat
 * @property {(path: string) => Promise<boolean>=} exists
 * @property {(path: string) => Promise<Uint8Array | string>=} readFile
 *
 * @typedef {object} FileWatcherOptions
 * @property {string} path
 * @property {(event: FileWatcherEvent) => void} onChange
 * @property {number=} pollIntervalMs
 * @property {VfsLike=} vfs
 */

const DEFAULT_POLL_INTERVAL_MS = 2000;
const NOT_FOUND_CODES = new Set(["ENOENT", "ENOTDIR"]);

let _nodeFsModulePromise = null;
let _nativeWatchSupported = null;
let _nativeWatchSupportedPromise = null;

/**
 * @returns {boolean}
 */
function isNodeRuntime() {
  const maybeProcess =
    /** @type {ProcessLike | undefined} */ (/** @type {any} */ (globalThis).process);
  return !!maybeProcess?.versions?.node;
}

/**
 * @param {any} mod
 * @returns {any}
 */
function normalizeNodeFsModule(mod) {
  if (mod && typeof mod.watch === "function") return mod;
  const def = mod && typeof mod === "object" ? mod.default : null;
  if (def && typeof def.watch === "function") return def;
  if (def && (def.promises || def.stat)) return def;
  return mod;
}

/**
 * Attempt to load the Node.js fs module.
 * NOTE: This uses dynamic import of the Node fs module which is Node-only.
 * In browser environments, the import will fail and return null,
 * causing FileWatcher to fall back to polling mode with VFS.
 * @returns {Promise<any | null>}
 */
async function loadNodeFsModule() {
  if (_nodeFsModulePromise) return _nodeFsModulePromise;
  _nodeFsModulePromise = (async () => {
    if (!isNodeRuntime()) return null;
    try {
      // Node-only: browsers will fail this import and fall back to polling.
      const fsSpecifier = ["node", "fs"].join(String.fromCharCode(58));
      const mod = await import(/* @vite-ignore */ fsSpecifier);
      return normalizeNodeFsModule(mod);
    } catch {
      return null;
    }
  })();
  return _nodeFsModulePromise;
}

/**
 * @param {any} err
 * @returns {boolean}
 */
function isNotFoundError(err) {
  if (!err) return false;
  const code = String(err.code || err?.code || "");
  if (NOT_FOUND_CODES.has(code)) return true;
  const message = String(err.message || err);
  return message.includes("ENOENT") || message.includes("ENOTDIR");
}

/**
 * @param {VfsStatLike | any} stat
 * @returns {string}
 */
function createStatSignature(stat) {
  if (!stat || typeof stat !== "object") return "unknown";
  const mtimeMs = Number.isFinite(stat.mtimeMs) ? Math.floor(stat.mtimeMs) : null;
  const size = Number.isFinite(stat.size) ? stat.size : null;
  let kind = "unknown";
  try {
    if (typeof stat.isFile === "function" && stat.isFile()) kind = "file";
    else if (typeof stat.isDirectory === "function" && stat.isDirectory()) kind = "dir";
  } catch {
    kind = "unknown";
  }
  return `${kind}:${mtimeMs ?? "na"}:${size ?? "na"}`;
}

/**
 * @param {any} err
 * @param {string} fallback
 * @returns {Error}
 */
function toError(err, fallback) {
  if (err instanceof Error) return err;
  const error = new Error(typeof err === "string" ? err : fallback);
  error.cause = err;
  return error;
}

/**
 * Detect whether native fs.watch is available.
 * @returns {Promise<boolean>}
 */
export async function isNativeWatchSupported() {
  if (_nativeWatchSupported !== null) return _nativeWatchSupported;
  if (_nativeWatchSupportedPromise) return _nativeWatchSupportedPromise;

  _nativeWatchSupportedPromise = (async () => {
    const fs = await loadNodeFsModule();
    _nativeWatchSupported = !!(fs && typeof fs.watch === "function");
    _nativeWatchSupportedPromise = null;
    return _nativeWatchSupported;
  })();

  return _nativeWatchSupportedPromise;
}

/**
 * Cross-platform file watcher that uses fs.watch in Node-like runtimes and polling otherwise.
 * @implements {Disposable}
 */
export class FileWatcher extends DisposableBase {
  /**
   * @param {FileWatcherOptions} options
   */
  constructor(options) {
    super();

    const opts = options && typeof options === "object" ? options : {};
    const path = toNonEmptyString(opts.path);
    if (!path) throw new Error("FileWatcher: options.path is required");

    if (typeof opts.onChange !== "function") {
      throw new Error("FileWatcher: options.onChange must be a function");
    }

    /** @type {string} */
    this._path = path;
    /** @type {(event: FileWatcherEvent) => void} */
    this._onChange = opts.onChange;
    /** @type {number} */
    this._pollIntervalMs = toPositiveInt(opts.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    /** @type {VfsLike | null} */
    this._vfs = opts.vfs || null;

    /** @type {boolean} */
    this._running = false;
    /** @type {Promise<void> | null} */
    this._startPromise = null;
    /** @type {number} */
    this._sessionId = 0;
    /** @type {"native" | "poll" | null} */
    this._mode = null;

    /** @type {any} */
    this._watcher = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._pollTimer = null;
    /** @type {boolean} */
    this._pollInFlight = false;
    /** @type {{ exists: boolean, signature: string } | null} */
    this._lastSnapshot = null;
    /** @type {((path: string) => Promise<any>) | null} */
    this._statReader = null;
  }

  /**
   * Start watching the configured path.
   * @returns {Promise<void>}
   */
  async start() {
    this._ensureNotDisposed();
    if (this._running) return;
    if (this._startPromise) return this._startPromise;

    this._startPromise = this._startInternal();
    try {
      await this._startPromise;
    } finally {
      this._startPromise = null;
    }
  }

  /**
   * Stop watching without disposing.
   * @returns {void}
   */
  stop() {
    if (this.disposed || !this._running) return;
    this._running = false;

    if (this._watcher && typeof this._watcher.close === "function") {
      try {
        this._watcher.close();
      } catch (err) {
        console.warn("[FileWatcher] close error:", err);
      }
    }

    this._watcher = null;
    this._mode = null;

    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
    this._pollTimer = null;
    this._pollInFlight = false;
    this._lastSnapshot = null;
    this._statReader = null;
  }

  /**
   * @protected
   * @returns {void}
   */
  _onDispose() {
    this.stop();
  }

  /**
   * @returns {Promise<void>}
   */
  async _startInternal() {
    this._running = true;
    this._sessionId += 1;
    const sessionId = this._sessionId;

    try {
      const nativeSupported = await isNativeWatchSupported();
      if (this._sessionId !== sessionId || !this._running) return;

      if (nativeSupported) {
        const started = await this._startNativeWatch(sessionId);
        if (started) return;
      }

      await this._startPolling(sessionId);
    } catch (err) {
      this._emitError(err);
      this._running = false;
    }
  }

  /**
   * @param {number} sessionId
   * @returns {Promise<boolean>}
   */
  async _startNativeWatch(sessionId) {
    const fs = await loadNodeFsModule();
    if (!fs || typeof fs.watch !== "function") return false;

    try {
      const watcher = fs.watch(this._path, (eventType) => {
        if (!this._running || this._sessionId !== sessionId) return;
        const type = eventType === "rename" ? "rename" : "change";
        this._emit({ type, path: this._path });
      });

      if (watcher && typeof watcher.on === "function") {
        watcher.on("error", (err) => {
          if (!this._running || this._sessionId !== sessionId) return;
          this._emitError(err);
        });
      }

      this._watcher = watcher;
      this._mode = "native";
      return true;
    } catch (err) {
      this._emitError(err);
      return false;
    }
  }

  /**
   * @param {number} sessionId
   * @returns {Promise<void>}
   */
  async _startPolling(sessionId) {
    this._statReader = await this._resolveStatReader();
    if (!this._statReader) {
      this._emitError(new Error("FileWatcher: no stat reader available for polling"));
      this._running = false;
      return;
    }

    this._mode = "poll";
    this._lastSnapshot = null;

    await this._pollOnce(sessionId);
    if (!this._running || this._sessionId !== sessionId) return;

    this._pollTimer = setInterval(() => {
      void this._pollOnce(sessionId);
    }, this._pollIntervalMs);
  }

  /**
   * @returns {Promise<((path: string) => Promise<any>) | null>}
   */
  async _resolveStatReader() {
    const vfs = this._vfs;
    if (vfs && typeof vfs.stat === "function") {
      return (path) => vfs.stat(path);
    }

    const fs = await loadNodeFsModule();
    if (fs?.promises?.stat) {
      return (path) => fs.promises.stat(path);
    }
    if (typeof fs?.stat === "function") {
      return (path) =>
        new Promise((resolve, reject) => {
          fs.stat(path, (err, stat) => {
            if (err) reject(err);
            else resolve(stat);
          });
        });
    }

    return null;
  }

  /**
   * @param {number} sessionId
   * @returns {Promise<void>}
   */
  async _pollOnce(sessionId) {
    if (this._pollInFlight || !this._running || this._sessionId !== sessionId) return;
    this._pollInFlight = true;

    try {
      const snapshot = await this._readSnapshot();
      if (!snapshot || !this._running || this._sessionId !== sessionId) return;

      if (!this._lastSnapshot) {
        this._lastSnapshot = snapshot;
        return;
      }

      const prev = this._lastSnapshot;
      this._lastSnapshot = snapshot;

      if (prev.exists !== snapshot.exists) {
        this._emit({ type: "rename", path: this._path });
        return;
      }

      if (snapshot.exists && prev.signature !== snapshot.signature) {
        this._emit({ type: "change", path: this._path });
      }
    } finally {
      this._pollInFlight = false;
    }
  }

  /**
   * @returns {Promise<{ exists: boolean, signature: string } | null>}
   */
  async _readSnapshot() {
    if (!this._statReader) return null;

    try {
      const stat = await this._statReader(this._path);
      return { exists: true, signature: createStatSignature(stat) };
    } catch (err) {
      if (isNotFoundError(err)) {
        return { exists: false, signature: "missing" };
      }
      this._emitError(err);
      return null;
    }
  }

  /**
   * @param {FileWatcherEvent} event
   * @returns {void}
   */
  _emit(event) {
    if (!this._running || this.disposed) return;
    try {
      this._onChange(event);
    } catch (err) {
      // Avoid crashing due to user callbacks.
      console.warn("[FileWatcher] onChange error:", err);
    }
  }

  /**
   * @param {any} err
   * @returns {void}
   */
  _emitError(err) {
    if (!this._running || this.disposed) return;
    const error = toError(err, "FileWatcher error");
    this._emit({ type: "error", path: this._path, error });
  }
}

/**
 * Factory for creating a FileWatcher instance.
 * @param {FileWatcherOptions} options
 * @returns {FileWatcher}
 */
export function createFileWatcher(options) {
  return new FileWatcher(options);
}
