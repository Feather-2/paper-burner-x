/**
 * Storage Adapter - OPFS/IndexedDB 统一存储接口
 *
 * P0.1: 建立 OPFS → IndexedDB 自动降级机制
 *
 * 策略：
 * 1. 优先使用 OPFS (Origin Private File System) - 高性能
 * 2. 降级到 IndexedDB - 兼容性好
 * 3. 最后降级到 localStorage - 容量小但普遍支持
 *
 * 浏览器友好，无 Node.js 依赖。
 */

import { createLogger } from "../shared/index.js";

const logger = createLogger("vfs/storage-adapter");

/**
 * 存储后端类型
 */
export const StorageBackend = Object.freeze({
  OPFS: "opfs",
  INDEXEDDB: "indexeddb",
  LOCALSTORAGE: "localstorage",
  MEMORY: "memory",
});

/**
 * 检测 OPFS 支持
 */
async function detectOpfsSupport() {
  if (typeof navigator === "undefined") return false;
  if (!navigator.storage?.getDirectory) return false;

  try {
    const root = await navigator.storage.getDirectory();
    // 尝试创建一个测试文件来验证完整支持
    const testName = `.opfs_test_${Date.now()}`;
    const testHandle = await root.getFileHandle(testName, { create: true });
    // 清理测试文件
    await root.removeEntry(testName);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测 IndexedDB 支持
 */
function detectIndexedDbSupport() {
  if (typeof indexedDB === "undefined") return false;
  try {
    // 尝试打开测试数据库
    const request = indexedDB.open("__storage_adapter_test__", 1);
    request.onsuccess = () => {
      request.result.close();
      indexedDB.deleteDatabase("__storage_adapter_test__");
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测 localStorage 支持
 */
function detectLocalStorageSupport() {
  if (typeof localStorage === "undefined") return false;
  try {
    const testKey = "__storage_adapter_test__";
    localStorage.setItem(testKey, "1");
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 存储适配器基类
 */
export class StorageAdapter {
  constructor(backend) {
    this.backend = backend;
  }

  /**
   * 读取数据
   * @param {string} key
   * @returns {Promise<any>}
   */
  async get(key) {
    throw new Error("Not implemented");
  }

  /**
   * 写入数据
   * @param {string} key
   * @param {any} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    throw new Error("Not implemented");
  }

  /**
   * 删除数据
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    throw new Error("Not implemented");
  }

  /**
   * 检查 key 是否存在
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    throw new Error("Not implemented");
  }

  /**
   * 列出所有 key
   * @returns {Promise<string[]>}
   */
  async keys() {
    throw new Error("Not implemented");
  }

  /**
   * 清空所有数据
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error("Not implemented");
  }

  /**
   * 获取存储使用量
   * @returns {Promise<{used: number, quota: number}>}
   */
  async getUsage() {
    return { used: 0, quota: 0 };
  }
}

/**
 * OPFS 存储适配器
 */
export class OpfsStorageAdapter extends StorageAdapter {
  constructor({ rootDirName = "paperburner_storage" } = {}) {
    super(StorageBackend.OPFS);
    this.rootDirName = rootDirName;
    this._rootDir = null;
  }

  async _getRootDir() {
    if (this._rootDir) return this._rootDir;

    const storageRoot = await navigator.storage.getDirectory();
    this._rootDir = await storageRoot.getDirectoryHandle(this.rootDirName, { create: true });
    return this._rootDir;
  }

  _keyToPath(key) {
    // 将 key 转换为安全的文件名
    // 先转义下划线为 %5F，再转义其他字符，最后把 % 替换为 _
    // 这样可以保证编码可逆：原始 _ -> %5F -> _5F，原始 % -> %25 -> _25
    return encodeURIComponent(String(key)).replace(/_/g, "%5F").replace(/%/g, "_");
  }

  _pathToKey(fileName) {
    // 逆向解码：_ 还原为 %，然后 decodeURIComponent
    return decodeURIComponent(fileName.replace(/_/g, "%"));
  }

  async get(key) {
    try {
      const root = await this._getRootDir();
      const fileName = this._keyToPath(key);
      const fileHandle = await root.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (err) {
      if (err.name === "NotFoundError") return undefined;
      throw err;
    }
  }

  async set(key, value) {
    const root = await this._getRootDir();
    const fileName = this._keyToPath(key);
    const fileHandle = await root.getFileHandle(fileName, { create: true });

    // 使用 createWritable 写入，确保 finally 中关闭
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(JSON.stringify(value));
    } finally {
      await writable.close();
    }
  }

  async delete(key) {
    try {
      const root = await this._getRootDir();
      const fileName = this._keyToPath(key);
      await root.removeEntry(fileName);
      return true;
    } catch (err) {
      if (err.name === "NotFoundError") return false;
      throw err;
    }
  }

  async has(key) {
    try {
      const root = await this._getRootDir();
      const fileName = this._keyToPath(key);
      await root.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  }

  async keys() {
    const root = await this._getRootDir();
    const keys = [];
    for await (const [name] of /** @type {AsyncIterable<[string, unknown]>} */ (/** @type {unknown} */ (root))) {
      keys.push(this._pathToKey(name));
    }
    return keys;
  }

  async clear() {
    const root = await this._getRootDir();
    const entries = [];
    for await (const [name] of /** @type {AsyncIterable<[string, unknown]>} */ (/** @type {unknown} */ (root))) {
      entries.push(name);
    }
    for (const name of entries) {
      await root.removeEntry(name);
    }
  }

  async getUsage() {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { used: 0, quota: 0 };
  }
}

/**
 * IndexedDB 存储适配器
 */
export class IndexedDbStorageAdapter extends StorageAdapter {
  constructor({ dbName = "paperburner_storage", storeName = "kv" } = {}) {
    super(StorageBackend.INDEXEDDB);
    this.dbName = dbName;
    this.storeName = storeName;
    this._db = null;
    this._dbPromise = null;
  }

  async _getDb() {
    if (this._db) return this._db;
    if (this._dbPromise) return this._dbPromise;

    this._dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = /** @type {IDBOpenDBRequest} */ (/** @type {unknown} */ (event.target)).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };
    });

    return this._dbPromise;
  }

  async get(key) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async set(key, value) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(value, key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(key) {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async has(key) {
    const value = await this.get(key);
    return value !== undefined;
  }

  async keys() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async clear() {
    const db = await this._getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getUsage() {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { used: 0, quota: 0 };
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
      this._dbPromise = null;
    }
  }
}

/**
 * localStorage 存储适配器
 */
export class LocalStorageAdapter extends StorageAdapter {
  constructor({ prefix = "pb_" } = {}) {
    super(StorageBackend.LOCALSTORAGE);
    this.prefix = prefix;
  }

  _prefixKey(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    const raw = localStorage.getItem(this._prefixKey(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key, value) {
    localStorage.setItem(this._prefixKey(key), JSON.stringify(value));
  }

  async delete(key) {
    const exists = localStorage.getItem(this._prefixKey(key)) !== null;
    localStorage.removeItem(this._prefixKey(key));
    return exists;
  }

  async has(key) {
    return localStorage.getItem(this._prefixKey(key)) !== null;
  }

  async keys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keys.push(key.slice(this.prefix.length));
      }
    }
    return keys;
  }

  async clear() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }

  async getUsage() {
    let used = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        used += key.length + (localStorage.getItem(key)?.length || 0);
      }
    }
    // localStorage 通常限制 5MB
    return { used, quota: 5 * 1024 * 1024 };
  }
}

/**
 * 内存存储适配器（用于测试或 fallback）
 */
export class MemoryStorageAdapter extends StorageAdapter {
  constructor() {
    super(StorageBackend.MEMORY);
    this._store = new Map();
  }

  async get(key) {
    return this._store.get(key);
  }

  async set(key, value) {
    this._store.set(key, value);
  }

  async delete(key) {
    return this._store.delete(key);
  }

  async has(key) {
    return this._store.has(key);
  }

  async keys() {
    return Array.from(this._store.keys());
  }

  async clear() {
    this._store.clear();
  }
}

/**
 * 创建最佳可用的存储适配器
 * @param {object} [options]
 * @param {boolean} [options.preferOpfs=true] - 是否优先使用 OPFS
 * @param {boolean} [options.silent=false] - 是否静默（不输出降级警告）
 * @returns {Promise<StorageAdapter>}
 */
export async function createStorageAdapter({ preferOpfs = true, silent = false } = {}) {
  // 1. 尝试 OPFS
  if (preferOpfs) {
    const opfsSupported = await detectOpfsSupport();
    if (opfsSupported) {
      if (!silent) {
        console.info("[StorageAdapter] Using OPFS backend (best performance)");
      }
      return new OpfsStorageAdapter();
    }
  }

  // 2. 降级到 IndexedDB
  if (detectIndexedDbSupport()) {
    if (!silent) {
      logger.warn("[StorageAdapter] OPFS not available, falling back to IndexedDB (reduced performance)");
    }
    return new IndexedDbStorageAdapter();
  }

  // 3. 降级到 localStorage
  if (detectLocalStorageSupport()) {
    if (!silent) {
      logger.warn("[StorageAdapter] IndexedDB not available, falling back to localStorage (limited capacity: 5MB)");
    }
    return new LocalStorageAdapter();
  }

  // 4. 最终降级到内存
  if (!silent) {
    logger.warn("[StorageAdapter] No persistent storage available, using memory (data will be lost on refresh)");
  }
  return new MemoryStorageAdapter();
}

/**
 * 获取当前环境支持的存储后端
 */
export async function detectAvailableBackends() {
  const backends = [];

  if (await detectOpfsSupport()) {
    backends.push(StorageBackend.OPFS);
  }
  if (detectIndexedDbSupport()) {
    backends.push(StorageBackend.INDEXEDDB);
  }
  if (detectLocalStorageSupport()) {
    backends.push(StorageBackend.LOCALSTORAGE);
  }
  backends.push(StorageBackend.MEMORY); // 内存始终可用

  return backends;
}

export default {
  StorageBackend,
  StorageAdapter,
  OpfsStorageAdapter,
  IndexedDbStorageAdapter,
  LocalStorageAdapter,
  MemoryStorageAdapter,
  createStorageAdapter,
  detectAvailableBackends,
};
