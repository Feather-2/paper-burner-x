import { toNonEmptyString } from "./value-utils.js";
import fs from "node:fs/promises";
import path from "node:path";

function createPatternRegex(pattern) {
  const p = toNonEmptyString(pattern) ?? "*";
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

function isIndexedDBAvailable() {
  return typeof globalThis.indexedDB?.open === "function";
}

function encodeFileKey(key) {
  const raw = String(key);
  return encodeURIComponent(raw).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeFileKey(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function encodeFileKeyPattern(pattern) {
  const raw = toNonEmptyString(pattern) ?? "*";
  const parts = raw.split("*");
  return parts.map((part) => encodeFileKey(part)).join("*");
}

function openDb(dbName, storeName) {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }

  const indexedDB = globalThis.indexedDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(storeName)) {
        resolve(db);
        return;
      }

      const nextVersion = (db.version ?? 1) + 1;
      db.close();
      const upgrade = indexedDB.open(dbName, nextVersion);

      upgrade.onupgradeneeded = () => {
        const upgradedDb = upgrade.result;
        if (!upgradedDb.objectStoreNames.contains(storeName)) {
          upgradedDb.createObjectStore(storeName);
        }
      };

      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error ?? new Error("Failed to open IndexedDB"));
      upgrade.onblocked = () => reject(new Error("IndexedDB open blocked"));
    };

    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

function txPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

/**
 * IndexedDB 适配器（浏览器环境）
 */
export class IndexedDBAdapter {
  constructor(dbName = "archive", storeName = "checkpoints") {
    this.dbName = dbName;
    this.storeName = storeName;
    this._dbPromise = null;
  }

  async _getDb() {
    if (!this._dbPromise) {
      this._dbPromise = openDb(this.dbName, this.storeName);
    }
    return this._dbPromise;
  }

  async get(key) {
    const k = String(key);
    const db = await this._getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(k);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB get failed"));
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction failed"));
    });
  }

  async set(key, value) {
    const k = String(key);
    const db = await this._getDb();

    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    store.put(value, k);
    await txPromise(tx);
    return true;
  }

  async delete(key) {
    const k = String(key);
    const db = await this._getDb();

    const existed = await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = typeof store.getKey === "function" ? store.getKey(k) : store.get(k);

      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB lookup failed"));
      tx.onabort = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction failed"));
    });

    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    store.delete(k);
    await txPromise(tx);
    return existed;
  }

  async keys(pattern) {
    const regex = createPatternRegex(pattern);
    const db = await this._getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);

      const matches = [];
      const request = store.openKeyCursor();

      request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          matches.sort();
          resolve(matches);
          return;
        }
        const key = String(cursor.key);
        if (regex.test(key)) matches.push(key);
        cursor.continue();
      };

      tx.onabort = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction failed"));
    });
  }
}

/**
 * File adapter (Node.js environment)
 */
export class FileAdapter {
  constructor(basePath = ".claude/checkpoints/") {
    const resolved = typeof basePath === "string" ? basePath.trim() : "";
    this.basePath = resolved || ".claude/checkpoints/";
  }

  _filePath(key) {
    const safe = encodeFileKey(key);
    return path.join(this.basePath, `${safe}.json`);
  }

  async get(key) {
    const filePath = this._filePath(key);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      try {
        return JSON.parse(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const e = new Error(`Failed to parse JSON for key '${String(key)}'`);
        e.cause = new Error(message);
        throw e;
      }
    } catch (err) {
      if (err && typeof err === "object" && err.code === "ENOENT") return null;
      throw err;
    }
  }

  async set(key, value) {
    const filePath = this._filePath(key);
    await fs.mkdir(this.basePath, { recursive: true });
    const serialized = JSON.stringify(value, null, 2);
    await fs.writeFile(filePath, serialized, "utf8");
    return true;
  }

  async delete(key) {
    const filePath = this._filePath(key);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err) {
      if (err && typeof err === "object" && err.code === "ENOENT") return false;
      throw err;
    }
  }

  async keys(pattern) {
    const encodedPattern = encodeFileKeyPattern(pattern);
    const matches = [];

    for await (const entry of fs.glob(`${encodedPattern}.json`, { cwd: this.basePath, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const base = entry.name.slice(0, -".json".length);
      const decoded = decodeFileKey(base);
      if (!decoded) continue;
      matches.push(decoded);
    }

    matches.sort();
    return matches;
  }
}

/**
 * Redis 适配器（服务端环境）
 * 注意：使用 Map 模拟 Redis 操作，避免引入 ioredis-mock 依赖
 */
export class RedisAdapter {
  constructor(options = {}) {
    const raw = options && typeof options === "object" ? options : {};

    this.client = raw.client && typeof raw.client === "object" ? raw.client : null;
    this.prefix = typeof raw.prefix === "string" ? raw.prefix : "";

    const store = raw.store;
    this.store = store instanceof Map ? store : new Map();
  }

  _formatKey(key) {
    return `${this.prefix}${String(key)}`;
  }

  _stripPrefix(storedKey) {
    const s = String(storedKey);
    if (!this.prefix) return s;
    if (!s.startsWith(this.prefix)) return null;
    return s.slice(this.prefix.length);
  }

  async get(key) {
    const storedKey = this._formatKey(key);

    if (this.client && typeof this.client.get === "function") {
      const rawValue = await this.client.get(storedKey);
      if (rawValue === null || rawValue === undefined) return null;
      const text =
        typeof rawValue === "string"
          ? rawValue
          : rawValue instanceof Uint8Array
            ? Buffer.from(rawValue).toString("utf8")
            : String(rawValue);
      try {
        return JSON.parse(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const e = new Error(`Failed to parse Redis JSON for key '${String(key)}'`);
        e.cause = err instanceof Error ? err : new Error(message);
        throw e;
      }
    }

    if (!this.store.has(storedKey)) return null;
    return this.store.get(storedKey);
  }

  async set(key, value) {
    const storedKey = this._formatKey(key);

    if (this.client && typeof this.client.set === "function") {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError("RedisAdapter.set value must be JSON serializable");
      }
      await this.client.set(storedKey, serialized);
      return true;
    }

    this.store.set(storedKey, value);
    return true;
  }

  async delete(key) {
    const storedKey = this._formatKey(key);

    if (this.client) {
      const del =
        typeof this.client.del === "function"
          ? this.client.del.bind(this.client)
          : typeof this.client.unlink === "function"
            ? this.client.unlink.bind(this.client)
            : null;
      if (del) {
        const result = await del(storedKey);
        return Number(result) > 0;
      }
    }

    return this.store.delete(storedKey);
  }

  async keys(pattern) {
    const regex = createPatternRegex(pattern);

    if (this.client && typeof this.client.keys === "function") {
      const rawKeys = await this.client.keys(this._formatKey(toNonEmptyString(pattern) ?? "*"));
      const matches = [];
      for (const k of rawKeys || []) {
        const stripped = this._stripPrefix(k);
        if (!stripped) continue;
        if (regex.test(stripped)) matches.push(stripped);
      }
      matches.sort();
      return matches;
    }

    const matches = [];
    for (const storedKey of this.store.keys()) {
      const stripped = this._stripPrefix(storedKey);
      if (!stripped) continue;
      if (regex.test(stripped)) matches.push(stripped);
    }
    matches.sort();
    return matches;
  }
}
