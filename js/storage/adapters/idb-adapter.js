/**
 * @file js/storage/adapters/idb-adapter.js
 * @description
 * IndexedDB 适配器实现：提供简单的 key-value 存储接口。
 *
 * IndexedDB 操作模式参考：js/storage/storage.js 中的 openDB / transaction 写法。
 */

import BaseStorageAdapter from "./base-adapter.js";

function createBlockedError(dbName) {
  return new Error(
    `IdbAdapter: upgrade blocked for IndexedDB database "${dbName}" (another tab may still be holding an open connection)`,
  );
}

function openDBEnsureStore(indexedDBImpl, dbName, storeName, { version, storeOptions, onUpgrade } = {}) {
  return new Promise((resolve, reject) => {
    const request = typeof version === "number" ? indexedDBImpl.open(dbName, version) : indexedDBImpl.open(dbName);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      try {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, storeOptions);
        }
        if (typeof onUpgrade === "function") onUpgrade({ db, event });
      } catch (e) {
        reject(e);
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => {
        db.close();
      };

      if (db.objectStoreNames.contains(storeName)) {
        resolve(db);
        return;
      }

      // 兼容：数据库已存在但缺少 store（需要升级版本创建 store）
      const currentVersion = db.version;
      db.close();

      const upgradeRequest = indexedDBImpl.open(dbName, currentVersion + 1);

      upgradeRequest.onupgradeneeded = (event) => {
        const upgradeDb = event.target.result;
        try {
          if (!upgradeDb.objectStoreNames.contains(storeName)) {
            upgradeDb.createObjectStore(storeName, storeOptions);
          }
          if (typeof onUpgrade === "function") onUpgrade({ db: upgradeDb, event });
        } catch (e) {
          reject(e);
        }
      };

      upgradeRequest.onsuccess = () => {
        const upgradedDb = upgradeRequest.result;
        upgradedDb.onversionchange = () => {
          upgradedDb.close();
        };
        resolve(upgradedDb);
      };

      upgradeRequest.onerror = () => reject(upgradeRequest.error);
      upgradeRequest.onblocked = () => reject(createBlockedError(dbName));
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(createBlockedError(dbName));
  });
}

export class IdbAdapter extends BaseStorageAdapter {
  /**
   * @param {Object} options
   * @param {string} options.dbName - 数据库名
   * @param {string} options.storeName - 对象仓库名（Object Store）
   * @param {IDBFactory} [options.indexedDB] - 注入 indexedDB 实例，默认使用 globalThis.indexedDB
   * @param {number} [options.version] - 数据库版本号（可选；用于确保 schema 升级）
   * @param {IDBObjectStoreParameters} [options.storeOptions] - createObjectStore 参数（例如 { keyPath: 'id' }）
   * @param {Function} [options.onUpgrade] - onupgradeneeded 钩子：({ db, event }) => void
   */
  constructor({
    dbName,
    storeName,
    indexedDB = globalThis?.indexedDB,
    version,
    storeOptions,
    onUpgrade,
  } = {}) {
    super();
    this.dbName = String(dbName || "");
    this.storeName = String(storeName || "");
    this.indexedDB = indexedDB;
    this.version = typeof version === "number" ? version : undefined;
    this.storeOptions = storeOptions;
    this.onUpgrade = onUpgrade;

    if (!this.dbName) throw new Error("IdbAdapter: dbName is required");
    if (!this.storeName) throw new Error("IdbAdapter: storeName is required");
    if (!this.indexedDB) throw new Error("IdbAdapter: indexedDB is not available");

    this._dbPromise = null;
  }

  async _getDB() {
    if (!this._dbPromise) {
      this._dbPromise = openDBEnsureStore(this.indexedDB, this.dbName, this.storeName, {
        version: this.version,
        storeOptions: this.storeOptions,
        onUpgrade: this.onUpgrade,
      });
    }
    return this._dbPromise;
  }

  async get(key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const req = store.get(key);

      req.onsuccess = () => {
        const value = typeof req.result === "undefined" ? null : req.result;
        resolve(value);
      };
      req.onerror = () => reject(req.error);

      tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
    });
  }

  async set(key, value) {
    if (typeof value === "undefined") {
      await this.remove(key);
      return;
    }

    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);

      try {
        // 兼容 inline key（keyPath）与 out-of-line key 两种 store schema：
        // - 若 store 有 keyPath，则 put(value) 不应传入 key 参数（否则会 DataError）
        // - 若 store 无 keyPath，则 put(value, key) 需要显式 key 参数
        if (store.keyPath) {
          let normalizedValue = value;
          if (typeof store.keyPath === "string" && value && typeof value === "object") {
            if (value[store.keyPath] !== key) {
              normalizedValue = { ...value, [store.keyPath]: key };
            }
          }
          store.put(normalizedValue);
        } else {
          store.put(value, key);
        }
      } catch (e) {
        try {
          tx.abort();
        } catch {}
        reject(e);
        return;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
    });
  }

  async remove(key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
    });
  }

  async keys() {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);

      if (typeof store.getAllKeys === "function") {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
        return;
      }

      const out = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.key);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
    });
  }

  async clear() {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IdbAdapter: transaction aborted"));
    });
  }
}

export default IdbAdapter;
