/**
 * 统一的快照存储接口
 * @example
 * const archive = new Archive(new MapAdapter());
 * await archive.save('run_123', { nodeStates: {...}, timestamp: '...' });
 * const snapshot = await archive.load('run_123:ckpt_1');
 */

import { toNonEmptyString } from "../../shared/utils/value-utils.js";
import { createLogger } from "../../shared/utils/logger.js";
import { MapAdapter } from "./map-adapter.js";

export { Archive } from "./archive-core.js";
export { MapAdapter };

const logger = createLogger("shared/archive/archive");

/**
 * IndexedDB 存储适配器（浏览器持久化）
 * 解决问题：MapAdapter 是内存存储，刷新即丢失
 * @see StorageAdapter (./storage-adapter.js)
 */
export class IndexedDBAdapter {
  /** @type {string} */
  dbName;
  /** @type {string} */
  storeName;
  /** @type {IDBDatabase|null} */
  _db;
  /** @type {Promise<IDBDatabase>|null} */
  _initPromise;

  /**
   * @param {string} [dbName="ppt_archive"] - 数据库名称
   * @param {string} [storeName="checkpoints"] - 对象存储名称
   */
  constructor(dbName = "ppt_archive", storeName = "checkpoints") {
    this.dbName = dbName;
    this.storeName = storeName;
    this._db = null;
    this._initPromise = null;
  }

  /**
   * 确保数据库已初始化
   * @returns {Promise<IDBDatabase>}
   * @private
   */
  async _ensureDb() {
    if (this._db) return this._db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not available"));
        return;
      }

      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        try {
          logger.warn(`[IndexedDBAdapter] open blocked for ${this.dbName}@v1`);
        } catch (err) {
          console.warn(
            `[IndexedDBAdapter] failed to log blocked open for ${this.dbName}@v1`,
            err,
          );
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        try {
          this._db.onversionchange = () => this.close();
        } catch (err) {
          console.warn("[IndexedDBAdapter] failed to set onversionchange handler", err);
        }
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" });
        }
      };
    }).catch((err) => {
      // Allow callers to retry after an open failure.
      this._initPromise = null;
      throw err;
    });

    return this._initPromise;
  }

  /**
   * 获取存储值
   * @param {string} key - 键
   * @returns {Promise<any|null>} 值或 null
   */
  async get(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(String(key));
      let settled = false;
      const settle = (fn) => { if (!settled) { settled = true; fn(); } };
      tx.onerror = () => settle(() => reject(tx.error ?? new Error("Transaction error")));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error("Transaction aborted")));
      request.onerror = () => settle(() => reject(request.error));
      request.onsuccess = () => settle(() => {
        const result = request.result;
        resolve(result ? result.value : null);
      });
    });
  }

  /**
   * 设置存储值
   * @param {string} key - 键
   * @param {any} value - 值
   * @returns {Promise<boolean>} 成功返回 true
   */
  async set(key, value) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put({ key: String(key), value });
      let settled = false;
      const settle = (fn) => { if (!settled) { settled = true; fn(); } };
      tx.onerror = () => settle(() => reject(tx.error ?? new Error("Transaction error")));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error("Transaction aborted")));
      request.onerror = () => settle(() => reject(request.error));
      request.onsuccess = () => settle(() => resolve(true));
    });
  }

  /**
   * 删除存储值
   * @param {string} key - 键
   * @returns {Promise<boolean>} 是否删除成功
   */
  async delete(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(String(key));
      let settled = false;
      const settle = (fn) => { if (!settled) { settled = true; fn(); } };
      tx.onerror = () => settle(() => reject(tx.error ?? new Error("Transaction error")));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error("Transaction aborted")));
      request.onerror = () => settle(() => reject(request.error));
      request.onsuccess = () => settle(() => resolve(true));
    });
  }

  /**
   * 按模式列出键
   * @param {string} [pattern="*"] - glob 模式 (仅支持 *)
   * @returns {Promise<string[]>} 匹配的键列表
   */
  async keys(pattern) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      let settled = false;
      const settle = (fn) => { if (!settled) { settled = true; fn(); } };
      tx.onerror = () => settle(() => reject(tx.error ?? new Error("Transaction error")));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error("Transaction aborted")));
      request.onerror = () => settle(() => reject(request.error));
      request.onsuccess = () => settle(() => {
        const allKeys = request.result || [];
        const p = toNonEmptyString(pattern) ?? "*";
        const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
        const matches = /** @type {string[]} */ (
          allKeys.filter((key) => regex.test(String(key)))
        );
        matches.sort();
        resolve(/** @type {string[]} */ (matches));
      });
    });
  }

  /**
   * 清空所有数据
   * @returns {Promise<boolean>} 成功返回 true
   */
  async clear() {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.clear();
      let settled = false;
      const settle = (fn) => { if (!settled) { settled = true; fn(); } };
      tx.onerror = () => settle(() => reject(tx.error ?? new Error("Transaction error")));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error("Transaction aborted")));
      request.onerror = () => settle(() => reject(request.error));
      request.onsuccess = () => settle(() => resolve(true));
    });
  }

  /**
   * 关闭数据库连接
   * @returns {void}
   */
  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._initPromise = null;
    }
  }
}

/**
 * 降级适配器：优先 IndexedDB，失败时回退到 MapAdapter
 * @see StorageAdapter (./storage-adapter.js)
 */
export class FallbackAdapter {
  /** @type {IndexedDBAdapter|null} */
  _primary;
  /** @type {MapAdapter} */
  _fallback;
  /** @type {boolean} */
  _useFallback;
  /** @type {string} */
  _dbName;
  /** @type {string} */
  _storeName;

  /**
   * @param {string} [dbName="ppt_archive"] - 数据库名称
   * @param {string} [storeName="checkpoints"] - 对象存储名称
   */
  constructor(dbName = "ppt_archive", storeName = "checkpoints") {
    this._primary = null;
    this._fallback = new MapAdapter();
    this._useFallback = false;
    this._dbName = dbName;
    this._storeName = storeName;
  }

  /**
   * 确保适配器可用
   * @returns {Promise<MapAdapter|IndexedDBAdapter>}
   * @private
   */
  async _ensureAdapter() {
    if (this._useFallback) return this._fallback;
    if (this._primary) return this._primary;

    try {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB not available");
      }
      this._primary = new IndexedDBAdapter(this._dbName, this._storeName);
      // @ts-expect-error - accessing internal initialization method
      await this._primary._ensureDb();
      return this._primary;
    } catch (err) {
      logger.warn("[FallbackAdapter] IndexedDB unavailable, using MapAdapter:", { error: err?.message });
      this._useFallback = true;
      return this._fallback;
    }
  }

  /**
   * 获取存储值
   * @param {string} key - 键
   * @returns {Promise<any|null>} 值或 null
   */
  async get(key) {
    const adapter = await this._ensureAdapter();
    return adapter.get(key);
  }

  /**
   * 设置存储值
   * @param {string} key - 键
   * @param {any} value - 值
   * @returns {Promise<boolean>} 成功返回 true
   */
  async set(key, value) {
    const adapter = await this._ensureAdapter();
    return adapter.set(key, value);
  }

  /**
   * 删除存储值
   * @param {string} key - 键
   * @returns {Promise<boolean>} 是否删除成功
   */
  async delete(key) {
    const adapter = await this._ensureAdapter();
    return adapter.delete(key);
  }

  /**
   * 按模式列出键
   * @param {string} [pattern="*"] - glob 模式 (仅支持 *)
   * @returns {Promise<string[]>} 匹配的键列表
   */
  async keys(pattern) {
    const adapter = await this._ensureAdapter();
    return adapter.keys(pattern);
  }
}
