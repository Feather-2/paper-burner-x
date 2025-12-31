const DB_NAME = "CodeSearchIndexDB";
const DB_VERSION = 1;
const STORE_SYMBOLS = "symbols";

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

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
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
  constructor({ dbName = DB_NAME, dbVersion = DB_VERSION } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
    this._mem = new Map(); // key -> record
  }

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

  async close() {
    const db = await this._dbp;
    if (db) db.close();
    this._dbp = null;
  }

  async getSymbolRecord(workspaceId, path) {
    const key = recordKey(workspaceId, path);

    const db = await this.open();
    if (!db) return this._mem.get(key) || null;

    const tx = db.transaction([STORE_SYMBOLS], "readonly");
    const store = tx.objectStore(STORE_SYMBOLS);
    const rec = await promisifyRequest(store.get(key));
    await promisifyTransaction(tx);
    return rec || null;
  }

  async putSymbolRecord(workspaceId, path, { sha256, symbols, updatedAt } = {}) {
    const ws = normalizeWorkspaceId(workspaceId);
    const p = normalizePath(path);
    if (!p) throw new Error("putSymbolRecord: path is required");

    const key = recordKey(ws, p);
    const record = {
      key,
      workspaceId: ws,
      path: p,
      sha256: typeof sha256 === "string" ? sha256 : null,
      symbols: Array.isArray(symbols) ? symbols : [],
      updatedAt: typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
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

