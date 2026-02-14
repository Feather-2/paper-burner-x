import { isPlainObject, toNonEmptyString, createLogger } from "../../../shared/index.js";

const DB_NAME = "CodeSearchIndexDB";
const DB_VERSION = 1;
const STORE_SYMBOLS = "symbols";
const logger = createLogger("stages/codesearch/index-store");

/**
 * @typedef {object} SymbolRecord
 * @property {string} key
 * @property {string} workspaceId
 * @property {string} path
 * @property {string|null} sha256
 * @property {any[]} symbols
 * @property {string} updatedAt
 *
 * @typedef {object} PutSymbolRecordParams
 * @property {string=} sha256
 * @property {string=} hash - Alias for sha256 (fallback)
 * @property {any[]=} symbols
 * @property {string=} updatedAt
 */

function hasIndexedDB() {
  return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

function ensureObjectStore(db, name, options) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, options);
  }
}

function ensureIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

function normalizeWorkspaceId(v) {
  const id = toNonEmptyString(v) || "default";
  return id;
}

function normalizePath(v) {
  return toNonEmptyString(v);
}

function recordKey(workspaceId, path) {
  return `${normalizeWorkspaceId(workspaceId)}::${normalizePath(path)}`;
}

export class CodeSearchIndexStore {
  /**
   * @param {{ dbName?: string, dbVersion?: number, tabCoordinator?: any }=} options
   */
  constructor({ dbName = DB_NAME, dbVersion = DB_VERSION, tabCoordinator } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
    this._mem = new Map(); // key -> record
    this._tabCoordinator = tabCoordinator || null;
    this._bc = null;
  }

  /**
   * @returns {Promise<IDBDatabase|null>}
   */
  async open() {
    if (!hasIndexedDB()) return null;
    if (this._dbp) return this._dbp;

    this._dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction;
        ensureObjectStore(db, STORE_SYMBOLS, { keyPath: "key" });
        const store = tx.objectStore(STORE_SYMBOLS);
        ensureIndex(store, "byWorkspace", "workspaceId", { unique: false });
        ensureIndex(store, "byWorkspacePath", ["workspaceId", "path"], { unique: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB open blocked by another connection"));
    }).catch((err) => {
      // Reset _dbp so future calls can retry; fall back to memory storage
      this._dbp = null;
      return null;
    });

    const db = await this._dbp;
    if (db && typeof BroadcastChannel !== "undefined") {
      try {
        await this._attachTabCoordinator();
      } catch (err) {
        logger.warn("Failed to attach TabCoordinator:", err);
      }
    }

    return db;
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    this._detachTabCoordinator();
    const db = await this._dbp;
    if (db) db.close();
    this._dbp = null;
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _attachTabCoordinator() {
    if (this._bc) return;
    if (typeof BroadcastChannel === "undefined") return;

    try {
      this._bc = new BroadcastChannel(`codesearch-index:${this.dbName}`);
      this._bc.onmessage = (event) => {
        if (event.data?.type === "update" && event.data?.key) {
          this._handleRemoteUpdate(event.data.key);
        }
      };
    } catch (err) {
      logger.warn("Failed to create BroadcastChannel:", err);
      this._bc = null;
    }
  }

  /**
   * @private
   * @returns {void}
   */
  _detachTabCoordinator() {
    if (this._bc) {
      try {
        this._bc.close();
      } catch (err) {
        logger.warn("Failed to close BroadcastChannel:", err);
      }
      this._bc = null;
    }
  }

  /**
   * @private
   * @param {string} key
   * @returns {void}
   */
  _broadcastUpdate(key) {
    if (!this._bc) return;
    try {
      this._bc.postMessage({ type: "update", key });
    } catch (err) {
      logger.warn("Failed to broadcast update:", err);
    }
  }

  /**
   * @private
   * @param {string} key
   * @returns {void}
   */
  _handleRemoteUpdate(key) {
    if (typeof key !== "string") return;
    this._mem.delete(key);
  }

  /**
   * @param {string} workspaceId
   * @param {string} path
   * @returns {Promise<SymbolRecord|null>}
   */
  async getSymbolRecord(workspaceId, path) {
    let ws = workspaceId;
    let p = path;
    if (typeof p !== "string") {
      p = ws;
      ws = "default";
    }
    const key = recordKey(ws, p);

    const db = await this.open();
    if (!db) return this._mem.get(key) || null;

    const tx = db.transaction([STORE_SYMBOLS], "readonly");
    const store = tx.objectStore(STORE_SYMBOLS);
    const rec = await promisifyRequest(store.get(key));
    await promisifyTransaction(tx);
    return rec || null;
  }

  /**
   * @param {string} workspaceId
   * @param {string} path
   * @param {PutSymbolRecordParams=} params
   * @returns {Promise<string>}
   */
  async putSymbolRecord(workspaceId, path, { sha256, symbols, updatedAt } = {}) {
    let ws = workspaceId;
    let p = path;
    let params = { sha256, symbols, updatedAt };
    if (typeof p !== "string") {
      params = isPlainObject(p) ? p : { sha256, symbols, updatedAt };
      p = ws;
      ws = "default";
    }
    const normalizedParams = isPlainObject(params) ? params : { sha256, symbols, updatedAt };
    const wsId = normalizeWorkspaceId(ws);
    const pPath = normalizePath(p);
    if (!pPath) throw new Error("putSymbolRecord: path is required");

    const key = recordKey(wsId, pPath);
    const record = {
      key,
      workspaceId: wsId,
      path: pPath,
      sha256: typeof normalizedParams.sha256 === "string"
        ? normalizedParams.sha256
        : typeof normalizedParams.hash === "string"
          ? normalizedParams.hash
          : null,
      symbols: Array.isArray(normalizedParams.symbols) ? normalizedParams.symbols : [],
      updatedAt: typeof normalizedParams.updatedAt === "string" ? normalizedParams.updatedAt : new Date().toISOString(),
    };

    const db = await this.open();
    if (!db) {
      this._mem.set(key, record);
      return key;
    }

    const tx = db.transaction([STORE_SYMBOLS], "readwrite");
    const store = tx.objectStore(STORE_SYMBOLS);
    store.put(record);
    await promisifyTransaction(tx);
    this._broadcastUpdate(key);
    return key;
  }

  /**
   * @param {string} workspaceId
   * @returns {Promise<SymbolRecord[]>}
   */
  async listSymbolRecords(workspaceId) {
    const ws = normalizeWorkspaceId(workspaceId);
    const db = await this.open();
    if (!db) {
      return Array.from(this._mem.values()).filter((r) => r.workspaceId === ws);
    }

    const tx = db.transaction([STORE_SYMBOLS], "readonly");
    const store = tx.objectStore(STORE_SYMBOLS);
    const idx = store.index("byWorkspace");
    const rows = await promisifyRequest(idx.getAll(IDBKeyRange.only(ws)));
    await promisifyTransaction(tx);
    return rows || [];
  }
}

export default CodeSearchIndexStore;
