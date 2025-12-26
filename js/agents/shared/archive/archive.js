/**
 * 统一的快照存储接口
 * @example
 * const archive = new Archive(new MapAdapter());
 * await archive.save('run_123', { nodeStates: {...}, timestamp: '...' });
 * const snapshot = await archive.load('run_123:ckpt_1');
 */

import { isPlainObject, toNonEmptyString } from "../utils/value-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function assertStorageAdapter(storage) {
  const adapter = storage && typeof storage === "object" ? storage : null;
  const required = ["get", "set", "delete", "keys"];
  for (const method of required) {
    if (typeof adapter?.[method] !== "function") {
      throw new TypeError(`Archive storage adapter must implement ${required.join("/")}`);
    }
  }
  return adapter;
}

function splitCheckpointId(checkpointId) {
  const id = toNonEmptyString(checkpointId);
  if (!id) return null;
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const runId = id.slice(0, idx);
  const timestampPart = id.slice(idx + 1);
  const match = timestampPart.match(/^(\d+)(?:-(\d+))?$/);
  if (match) {
    return {
      runId,
      timestamp: match[1],
      counter: match[2] ? Number(match[2]) : null,
    };
  }
  return {
    runId,
    timestamp: timestampPart,
    counter: null,
  };
}

function toEpochMs(timestamp) {
  if (timestamp === null || timestamp === undefined) return null;
  if (typeof timestamp === "number") return Number.isFinite(timestamp) ? timestamp : null;

  const s = String(timestamp).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareTimestampDesc(a, b) {
  const aMs = toEpochMs(a);
  const bMs = toEpochMs(b);
  if (aMs !== null && bMs !== null) return bMs - aMs;
  if (aMs !== null) return -1;
  if (bMs !== null) return 1;
  return String(b ?? "").localeCompare(String(a ?? ""));
}

export class Archive {
  /**
   * @param {Object} storage - 存储适配器，需实现 get/set/delete/keys 方法
   */
  constructor(storage) {
    this.storage = assertStorageAdapter(storage);
    this._saveCounter = 0;
  }

  /**
   * 保存快照
   * @param {string} runId - 运行ID
   * @param {Object} data - 快照数据 { nodeStates, timestamp?, metadata? }
   * @returns {Promise<string>} checkpointId (格式: {runId}:{timestamp} 或 {runId}:{timestamp}-{counter})
   */
  async save(runId, data) {
    const normalizedRunId = toNonEmptyString(runId);
    if (!normalizedRunId) {
      throw new TypeError("runId must be a non-empty string");
    }
    if (normalizedRunId.includes(":")) {
      throw new TypeError("runId must not include ':'");
    }

    const payload = isPlainObject(data) ? data : {};
    const timestamp = toNonEmptyString(payload.timestamp) ?? String(Date.now());
    const schemaVersion = toNonEmptyString(payload.schemaVersion);
    let checkpointId = `${normalizedRunId}:${timestamp}`;
    let attempts = 0;
    let existing = await this.storage.get(checkpointId);
    while (existing != null && attempts < 100) {
      this._saveCounter += 1;
      checkpointId = `${normalizedRunId}:${timestamp}-${this._saveCounter}`;
      attempts += 1;
      existing = await this.storage.get(checkpointId);
    }
    if (existing != null) {
      throw new Error("CHECKPOINT_ID_COLLISION: too many saves in same millisecond");
    }

    const snapshot = {
      ...(schemaVersion ? { schemaVersion } : {}),
      nodeStates: payload.nodeStates ?? {},
      timestamp,
      metadata: payload.metadata,
    };

    await this.storage.set(checkpointId, snapshot);
    return checkpointId;
  }

  /**
   * 加载快照
   * @param {string} key - checkpointId 或 runId
   * @returns {Promise<Object|null>} 快照数据或 null
   */
  async load(key) {
    const normalizedKey = toNonEmptyString(key);
    if (!normalizedKey) return null;

    if (normalizedKey.includes(":")) {
      const snapshot = await this.storage.get(normalizedKey);
      return snapshot ?? null;
    }

    const checkpoints = await this.listCheckpoints(normalizedKey);
    if (checkpoints.length === 0) return null;

    const snapshot = await this.storage.get(checkpoints[0].checkpointId);
    return snapshot ?? null;
  }

  /**
   * 恢复到指定 checkpoint
   * @param {string} checkpointId
   * @returns {Promise<Object>} { nodeStates, timestamp, metadata }
   */
  async restore(checkpointId) {
    const normalizedId = toNonEmptyString(checkpointId);
    if (!normalizedId) {
      throw new TypeError("checkpointId must be a non-empty string");
    }

    const snapshot = await this.storage.get(normalizedId);
    if (!snapshot) {
      throw new Error(`Checkpoint not found: ${normalizedId}`);
    }

    const parsed = splitCheckpointId(normalizedId);
    const timestamp = snapshot.timestamp ?? parsed?.timestamp ?? null;

    const schemaVersion = toNonEmptyString(snapshot.schemaVersion);

    return {
      ...(schemaVersion ? { schemaVersion } : {}),
      nodeStates: snapshot.nodeStates ?? {},
      timestamp,
      metadata: snapshot.metadata,
    };
  }

  /**
   * 列出某个 runId 下的所有 checkpoint
   * @param {string} runId
   * @returns {Promise<Array<{checkpointId, timestamp, nodeStates}>>} 按 timestamp/counter 降序
   */
  async listCheckpoints(runId) {
    const normalizedRunId = toNonEmptyString(runId);
    if (!normalizedRunId) return [];

    const keys = await this.storage.keys(`${normalizedRunId}:*`);
    const checkpoints = [];

    for (const key of keys) {
      const snapshot = await this.storage.get(key);
      if (!snapshot) continue;

      const parsed = splitCheckpointId(key);
      const timestamp = snapshot.timestamp ?? parsed?.timestamp ?? "";
      const counter = Number.isFinite(parsed?.counter) ? parsed.counter : 0;

      checkpoints.push({
        checkpointId: key,
        timestamp,
        nodeStates: snapshot.nodeStates ?? {},
        counter,
      });
    }

    checkpoints.sort((a, b) => {
      const timeCompare = compareTimestampDesc(a.timestamp, b.timestamp);
      if (timeCompare !== 0) return timeCompare;
      return b.counter - a.counter;
    });
    return checkpoints.map(({ counter, ...entry }) => entry);
  }

  /**
   * 删除早于指定天数的快照
   * @param {number} days
   * @returns {Promise<number>} 删除的快照数量
   */
  async deleteOlderThan(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 0) {
      throw new TypeError("days must be a non-negative finite number");
    }

    const cutoffMs = Date.now() - n * DAY_MS;
    const keys = await this.storage.keys("*");

    let deleted = 0;
    for (const key of keys) {
      const parsed = splitCheckpointId(key);
      if (!parsed) continue;

      const tsMs = toEpochMs(parsed.timestamp);
      if (tsMs === null) continue;
      if (tsMs >= cutoffMs) continue;

      await this.storage.delete(key);
      deleted += 1;
    }

    return deleted;
  }
}

/**
 * 内存存储适配器
 */
export class MapAdapter {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const k = String(key);
    if (!this.store.has(k)) return null;
    return this.store.get(k);
  }

  async set(key, value) {
    const k = String(key);
    this.store.set(k, value);
    return true;
  }

  async delete(key) {
    const k = String(key);
    return this.store.delete(k);
  }

  async keys(pattern) {
    const p = toNonEmptyString(pattern) ?? "*";
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    const matches = Array.from(this.store.keys()).filter((key) => regex.test(key));
    matches.sort();
    return matches;
  }
}

/**
 * IndexedDB 存储适配器（浏览器持久化）
 * 解决问题：MapAdapter 是内存存储，刷新即丢失
 */
export class IndexedDBAdapter {
  constructor(dbName = "ppt_archive", storeName = "checkpoints") {
    this.dbName = dbName;
    this.storeName = storeName;
    this._db = null;
    this._initPromise = null;
  }

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
      request.onsuccess = () => {
        this._db = request.result;
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" });
        }
      };
    });

    return this._initPromise;
  }

  async get(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(String(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
    });
  }

  async set(key, value) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put({ key: String(key), value });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async delete(key) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(String(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

  async keys(pattern) {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const allKeys = request.result || [];
        const p = toNonEmptyString(pattern) ?? "*";
        const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
        const matches = allKeys.filter((key) => regex.test(key));
        matches.sort();
        resolve(matches);
      };
    });
  }

  async clear() {
    const db = await this._ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  }

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
 */
export class FallbackAdapter {
  constructor(dbName = "ppt_archive", storeName = "checkpoints") {
    this._primary = null;
    this._fallback = new MapAdapter();
    this._useFallback = false;
    this._dbName = dbName;
    this._storeName = storeName;
  }

  async _ensureAdapter() {
    if (this._useFallback) return this._fallback;
    if (this._primary) return this._primary;

    try {
      if (typeof indexedDB === "undefined") {
        throw new Error("IndexedDB not available");
      }
      this._primary = new IndexedDBAdapter(this._dbName, this._storeName);
      await this._primary._ensureDb();
      return this._primary;
    } catch (err) {
      console.warn("[FallbackAdapter] IndexedDB unavailable, using MapAdapter:", err?.message);
      this._useFallback = true;
      return this._fallback;
    }
  }

  async get(key) {
    const adapter = await this._ensureAdapter();
    return adapter.get(key);
  }

  async set(key, value) {
    const adapter = await this._ensureAdapter();
    return adapter.set(key, value);
  }

  async delete(key) {
    const adapter = await this._ensureAdapter();
    return adapter.delete(key);
  }

  async keys(pattern) {
    const adapter = await this._ensureAdapter();
    return adapter.keys(pattern);
  }
}
