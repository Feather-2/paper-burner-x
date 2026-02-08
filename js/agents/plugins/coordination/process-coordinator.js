/**
 * ProcessCoordinator - Node.js cluster/worker coordination for cache/session sync.
 *
 * Mirrors TabCoordinator API but only uses cluster IPC to broadcast session
 * access/eviction events (cross-process LRU consistency).
 *
 * NOTE: This is NOT a distributed lock implementation.
 * It does not provide acquireLock()/releaseLock(), semaphore semantics,
 * or global mutual exclusion guarantees.
 *
 * Falls back to no-op when cluster is unavailable.
 *
 * @module process-coordinator
 * @environment node - This module uses Node.js-only APIs (globalThis.process, node:cluster).
 *                     Do NOT bundle for browser targets; use conditional imports or build aliases.
 */

import { isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { DisposableBase } from "../../shared/index.js";
import { Platform } from "../../shared/index.js";

/**
 * @typedef {"session-evicted" | "session-accessed"} ProcessCoordinatorMessageType
 */

/**
 * @typedef {object} ProcessCoordinatorMessage
 * @property {ProcessCoordinatorMessageType} type
 * @property {string} sessionId
 * @property {number} source
 */

/**
 * @typedef {Object} LoggerLike
 * @property {(...args: unknown[]) => void} [warn]
 */

/**
 * @typedef {object} ProcessCoordinatorOptions
 * @property {(sessionId: string) => void} [onEviction]
 * @property {(sessionId: string) => void} [onAccess]
 * @property {LoggerLike} [logger]
 */

/**
 * @typedef {(...args: unknown[]) => void} EventListenerLike
 */

/**
 * @typedef {object} ClusterWorkerLike
 * @property {(message: unknown) => void} [send]
 * @property {() => boolean} [isConnected]
 */

/**
 * @typedef {object} ClusterModuleLike
 * @property {boolean} isPrimary
 * @property {boolean} isWorker
 * @property {Record<string, ClusterWorkerLike>} workers
 * @property {(event: string, listener: EventListenerLike) => void} on
 * @property {(event: string, listener: EventListenerLike) => void} off
 * @property {(event: string, listener: EventListenerLike) => void} removeListener
 */

/**
 * @typedef {object} ProcessLike
 * @property {number} pid
 * @property {(message: unknown) => void} [send]
 * @property {(event: string, listener: EventListenerLike) => void} on
 * @property {(event: string, listener: EventListenerLike) => void} off
 * @property {(event: string, listener: EventListenerLike) => void} removeListener
 */

const MESSAGE_TYPES = new Set(["session-evicted", "session-accessed"]);

/** @type {Promise<ClusterModuleLike | null> | null} */
let clusterModulePromise = null;
/** @type {ClusterModuleLike | null} */
let clusterModule = null;

/**
 * @param {unknown} mod
 * @returns {ClusterModuleLike | null}
 */
function normalizeClusterModule(mod) {
  if (mod && typeof mod === "object") {
    const obj = /** @type {{ isPrimary?: unknown, default?: unknown }} */ (mod);
    if (typeof obj.isPrimary === "boolean") return /** @type {ClusterModuleLike} */ (obj);
    const def = obj.default;
    if (def && typeof def === "object") {
      const defObj = /** @type {{ isPrimary?: unknown }} */ (def);
      if (typeof defObj.isPrimary === "boolean") return /** @type {ClusterModuleLike} */ (defObj);
    }
  }
  return null;
}

/**
 * @returns {ProcessLike | null}
 */
function getProcessRef() {
  const g = /** @type {unknown} */ (globalThis);
  const p = /** @type {{ process?: ProcessLike }} */ (g).process;
  if (!p || typeof p !== "object") return null;
  return /** @type {ProcessLike} */ (p);
}

/**
 * @param {ProcessLike | null} proc
 * @returns {number | null}
 */
function getProcessId(proc) {
  if (!proc) return null;
  const pid = proc.pid;
  return typeof pid === "number" && Number.isFinite(pid) ? pid : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function toProcessId(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/**
 * @returns {Promise<ClusterModuleLike | null>}
 */
async function loadClusterModule() {
  if (clusterModule) return clusterModule;
  if (clusterModulePromise) return clusterModulePromise;

  clusterModulePromise = (async () => {
    if (!isClusterSupported()) {
      clusterModulePromise = null;
      return null;
    }
    try {
      /** @type {string} */
      const specifier = "node:cluster";
      const mod = await import(/* @vite-ignore */ specifier);
      clusterModule = normalizeClusterModule(mod);
      return clusterModule;
    } catch (err) {
      // Re-throw to let init() handle logging; expected in browser/non-cluster environments
      throw err;
    } finally {
      clusterModulePromise = null;
    }
  })();

  return clusterModulePromise;
}

/**
 * @param {{
 *   off?: (event: string, handler: EventListenerLike) => void,
 *   removeListener?: (event: string, handler: EventListenerLike) => void
 * } | null} emitter
 * @param {string} event
 * @param {EventListenerLike} handler
 * @returns {void}
 */
function removeListener(emitter, event, handler) {
  if (!emitter) return;
  if (typeof emitter.off === "function") {
    emitter.off(event, handler);
  } else if (typeof emitter.removeListener === "function") {
    emitter.removeListener(event, handler);
  }
}

/**
 * Check whether cluster is available (Node only).
 * @returns {boolean}
 */
export function isClusterSupported() {
  if (!Platform.isNode) return false;
  const proc = getProcessRef();
  return getProcessId(proc) !== null;
}

export class ProcessCoordinator extends DisposableBase {
  /** @type {(sessionId: string) => void | null} */
  _onEviction;
  /** @type {(sessionId: string) => void | null} */
  _onAccess;
  /** @type {LoggerLike | null} */
  _logger;

  /** @type {boolean} */
  _supported;
  /** @type {boolean} */
  _initialized;

  /** @type {ClusterModuleLike | null} */
  _cluster;
  /** @type {ProcessLike | null} */
  _process;
  /** @type {number | null} */
  _processId;

  /** @type {boolean} */
  _isPrimary;
  /** @type {boolean} */
  _isWorker;

  /**
   * @param {ProcessCoordinatorOptions} [options]
   */
  constructor(options = {}) {
    super();
    const opts = isPlainObject(options) ? options : {};

    /** @type {(sessionId: string) => void | null} */
    this._onEviction = typeof opts.onEviction === "function" ? opts.onEviction : null;
    /** @type {(sessionId: string) => void | null} */
    this._onAccess = typeof opts.onAccess === "function" ? opts.onAccess : null;
    /** @type {LoggerLike | null} */
    this._logger = opts.logger || null;

    /** @type {boolean} */
    this._supported = isClusterSupported();
    /** @type {boolean} */
    this._initialized = false;

    /** @type {ClusterModuleLike | null} */
    this._cluster = null;
    /** @type {ProcessLike | null} */
    this._process = getProcessRef();
    /** @type {number | null} */
    this._processId = getProcessId(this._process);

    /** @type {boolean} */
    this._isPrimary = false;
    /** @type {boolean} */
    this._isWorker = false;

    this._handleClusterMessage = this._handleClusterMessage.bind(this);
    this._handleProcessMessage = this._handleProcessMessage.bind(this);
  }

  /**
   * Initialize coordinator listeners.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initialized || this.disposed) return;
    this._initialized = true;

    if (!this._supported) return;

    let cluster = null;
    try {
      cluster = await loadClusterModule();
    } catch (err) {
      this._supported = false;
      this._logWarn("[ProcessCoordinator] Failed to load cluster module:", err);
      return;
    }

    if (!cluster) {
      this._supported = false;
      return;
    }

    this._cluster = cluster;
    this._isPrimary = !!cluster.isPrimary;
    this._isWorker = !!cluster.isWorker;

    if (this._isPrimary) {
      if (typeof cluster.on === "function") {
        cluster.on("message", this._handleClusterMessage);
        this._registerDisposable(() => removeListener(cluster, "message", this._handleClusterMessage));
      }
      return;
    }

    if (this._isWorker) {
      const proc = this._process;
      if (proc && typeof proc.on === "function") {
        proc.on("message", this._handleProcessMessage);
        this._registerDisposable(() => removeListener(proc, "message", this._handleProcessMessage));
      }
      return;
    }

    this._supported = false;
  }

  /**
   * Broadcast a session eviction to peers.
   * @param {string} sessionId
   * @returns {void}
   */
  broadcastEviction(sessionId) {
    this._broadcastWithSession("session-evicted", sessionId);
  }

  /**
   * Broadcast a session access to peers.
   * @param {string} sessionId
   * @returns {void}
   */
  broadcastAccess(sessionId) {
    this._broadcastWithSession("session-accessed", sessionId);
  }

  /**
   * @protected
   * @returns {void}
   */
  _onDispose() {
    this._initialized = false;
    this._cluster = null;
    this._isPrimary = false;
    this._isWorker = false;
  }

  /**
   * @param {ProcessCoordinatorMessageType} type
   * @param {string} sessionId
   * @returns {void}
   */
  _broadcastWithSession(type, sessionId) {
    const resolved = toNonEmptyString(sessionId);
    if (!resolved) return;
    this._broadcast(type, resolved);
  }

  /**
   * @param {ProcessCoordinatorMessageType} type
   * @param {string} sessionId
   * @returns {void}
   */
  _broadcast(type, sessionId) {
    if (!this._supported || this.disposed) return;
    if (!this._cluster) return;
    if (!MESSAGE_TYPES.has(type)) return;

    const source = this._processId ?? getProcessId(this._process);
    if (source === null) return;

    /** @type {ProcessCoordinatorMessage} */
    const message = { type, sessionId, source };

    if (this._isPrimary) {
      this._broadcastToWorkers(message);
    } else if (this._isWorker) {
      this._sendToPrimary(message);
    }
  }

  /**
   * @param {ProcessCoordinatorMessage} message
   * @returns {void}
   */
  _broadcastToWorkers(message) {
    const cluster = this._cluster;
    if (!cluster || !cluster.workers) return;
    const workers = Object.values(cluster.workers || {});
    for (const worker of workers) {
      if (!worker || typeof worker.send !== "function") continue;
      if (typeof worker.isConnected === "function" && !worker.isConnected()) continue;
      try {
        worker.send(message);
      } catch (err) {
        this._logWarn("[ProcessCoordinator] Failed to send message to worker:", err);
      }
    }
  }

  /**
   * @param {ProcessCoordinatorMessage} message
   * @returns {void}
   */
  _sendToPrimary(message) {
    const proc = this._process;
    if (!proc || typeof proc.send !== "function") return;
    try {
      proc.send(message);
    } catch (err) {
      this._logWarn("[ProcessCoordinator] Failed to send message to primary:", err);
    }
  }

  /**
   * @param {unknown} _worker
   * @param {unknown} message
   * @returns {void}
   */
  _handleClusterMessage(_worker, message) {
    if (this.disposed) return;
    const parsed = this._handleIncomingMessage(message);
    if (!parsed) return;
    this._broadcastToWorkers(parsed);
  }

  /**
   * @param {unknown} message
   * @returns {void}
   */
  _handleProcessMessage(message) {
    if (this.disposed) return;
    this._handleIncomingMessage(message);
  }

  /**
   * @param {unknown} raw
   * @returns {ProcessCoordinatorMessage | null}
   */
  _handleIncomingMessage(raw) {
    const message = this._parseMessage(raw);
    if (!message) return null;
    if (this._processId !== null && message.source === this._processId) return null;

    if (message.type === "session-evicted") {
      this._safeCall(this._onEviction, message.sessionId, "onEviction");
      return message;
    }

    if (message.type === "session-accessed") {
      this._safeCall(this._onAccess, message.sessionId, "onAccess");
      return message;
    }

    return null;
  }

  /**
   * @param {unknown} raw
   * @returns {ProcessCoordinatorMessage | null}
   */
  _parseMessage(raw) {
    let data = raw;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (err) {
        this._logWarn("[ProcessCoordinator] Failed to parse message:", err);
        return null;
      }
    }

    if (!isPlainObject(data)) return null;

    const obj = /** @type {Record<string, unknown>} */ (data);

    const type = toNonEmptyString(obj.type);
    const sessionId = toNonEmptyString(obj.sessionId);
    const source = toProcessId(obj.source);

    if (!type || !MESSAGE_TYPES.has(type)) return null;
    if (!sessionId) return null;
    if (source === null) return null;

    return { type: /** @type {ProcessCoordinatorMessageType} */ (type), sessionId, source };
  }

  /**
   * @param {Function | null} handler
   * @param {string} sessionId
   * @param {string} label
   * @returns {void}
   */
  _safeCall(handler, sessionId, label) {
    if (typeof handler !== "function") return;
    try {
      handler(sessionId);
    } catch (err) {
      this._logWarn(`[ProcessCoordinator] ${label} handler failed:`, err);
    }
  }

  /**
   * @param {...unknown} args
   * @returns {void}
   */
  _logWarn(...args) {
    if (this._logger && typeof this._logger.warn === "function") {
      this._logger.warn(...args);
    }
  }
}

export default ProcessCoordinator;
