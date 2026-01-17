import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";

const DB_NAME = "CodeSearchIndexDB";
const DB_VERSION = 1;
const STORE_SYMBOLS = "symbols";

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
   * @param {{ dbName?: string, dbVersion?: number }=} options
   */
  constructor({ dbName = DB_NAME, dbVersion = DB_VERSION } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
    this._mem = new Map(); // key -> record
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
    });

    return this._dbp;
  }

  /**
   * @returns {Promise<void>}
   */
  async close() {
    const db = await this._dbp;
    if (db) db.close();
    this._dbp = null;
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
