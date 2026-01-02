/**
 * 统一的快照存储接口
 * @example
 * const archive = new Archive(new MapAdapter());
 * await archive.save('run_123', { nodeStates: {...}, timestamp: '...' });
 * const snapshot = await archive.load('run_123:ckpt_1');
 */

import { isPlainObject, toNonEmptyString } from "../utils/value-utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DIFF_CONFIG = Object.freeze({
  enabled: true,
  // Store a full snapshot every N checkpoints (best-effort, per Archive instance).
  fullSnapshotEvery: 10,
  // Require at least this many bytes saved (rough estimate) to store as diff.
  minSavingsBytes: 1024,
  // Safety limits to avoid pathological diffs.
  maxOps: 5000,
  maxDepth: 12,
});
const DEFAULT_RESTORE_CACHE_MAX = 200;

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeCacheMax(value, fallback) {
  if (value === Infinity) return Infinity;
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  return Math.floor(n);
}

function normalizeDiffConfig(diff) {
  if (!diff || typeof diff !== "object") return { ...DEFAULT_DIFF_CONFIG };
  return {
    enabled: diff.enabled === undefined ? DEFAULT_DIFF_CONFIG.enabled : !!diff.enabled,
    fullSnapshotEvery: toPositiveInt(diff.fullSnapshotEvery, DEFAULT_DIFF_CONFIG.fullSnapshotEvery),
    minSavingsBytes: toPositiveInt(diff.minSavingsBytes, DEFAULT_DIFF_CONFIG.minSavingsBytes),
    maxOps: toPositiveInt(diff.maxOps, DEFAULT_DIFF_CONFIG.maxOps),
    maxDepth: toPositiveInt(diff.maxDepth, DEFAULT_DIFF_CONFIG.maxDepth),
  };
}

function safeClone(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    // Fallback: best-effort deep clone for plain JSON-ish data.
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function safeJsonSize(value) {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length : 0;
  } catch {
    return 0;
  }
}

function isUnsafePathSegment(seg) {
  const s = String(seg || "");
  return s === "__proto__" || s === "prototype" || s === "constructor";
}

function encodePointerSegment(seg) {
  return String(seg).replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodePointerSegment(seg) {
  return String(seg).replace(/~1/g, "/").replace(/~0/g, "~");
}

function toJsonPointer(segments) {
  const parts = Array.isArray(segments) ? segments : [];
  if (parts.length === 0) return "";
  return "/" + parts.map(encodePointerSegment).join("/");
}

function parseJsonPointer(ptr) {
  const p = typeof ptr === "string" ? ptr : "";
  if (!p) return [];
  if (!p.startsWith("/")) throw new Error(`Invalid JSON pointer: ${p}`);
  return p
    .slice(1)
    .split("/")
    .map(decodePointerSegment);
}

function deepEqualLimited(a, b, depth) {
  if (Object.is(a, b)) return true;
  if (depth <= 0) return false;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualLimited(a[i], b[i], depth - 1)) return false;
    }
    return true;
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bSet = new Set(bKeys);
  for (const k of aKeys) {
    if (!bSet.has(k)) return false;
    if (!deepEqualLimited(a[k], b[k], depth - 1)) return false;
  }
  return true;
}

function buildJsonPatch(base, next, { maxDepth, maxOps } = {}) {
  const depth = toPositiveInt(maxDepth, DEFAULT_DIFF_CONFIG.maxDepth);
  const opsLimit = toPositiveInt(maxOps, DEFAULT_DIFF_CONFIG.maxOps);
  const ops = [];

  const pushOp = (op) => {
    if (ops.length >= opsLimit) throw new Error("patch_ops_limit");
    ops.push(op);
  };

  const walk = (a, b, path, remainingDepth) => {
    if (Object.is(a, b)) return;
    if (remainingDepth <= 0) {
      pushOp({ op: "replace", path: toJsonPointer(path), value: safeClone(b) });
      return;
    }

    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);
    if (aIsArr || bIsArr) {
      if (!deepEqualLimited(a, b, remainingDepth - 1)) {
        pushOp({ op: "replace", path: toJsonPointer(path), value: safeClone(b) });
      }
      return;
    }

    const aObj = isPlainObject(a);
    const bObj = isPlainObject(b);
    if (!aObj || !bObj) {
      pushOp({ op: "replace", path: toJsonPointer(path), value: safeClone(b) });
      return;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    const bSet = new Set(bKeys);

    for (const k of aKeys) {
      if (isUnsafePathSegment(k)) throw new Error("unsafe_path_segment");
      if (!bSet.has(k)) {
        pushOp({ op: "remove", path: toJsonPointer([...path, k]) });
      }
    }

    const aSet = new Set(aKeys);
    for (const k of bKeys) {
      if (isUnsafePathSegment(k)) throw new Error("unsafe_path_segment");
      if (!aSet.has(k)) {
        pushOp({ op: "add", path: toJsonPointer([...path, k]), value: safeClone(b[k]) });
      }
    }

    for (const k of bKeys) {
      if (!aSet.has(k)) continue;
      walk(a[k], b[k], [...path, k], remainingDepth - 1);
    }
  };

  walk(base, next, [], depth);
  return ops;
}

function applyJsonPatch(base, ops) {
  const doc = safeClone(base);
  const list = Array.isArray(ops) ? ops : [];
  let root = doc;

  const getParent = (segments) => {
    let obj = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (isUnsafePathSegment(seg)) throw new Error("unsafe_path_segment");
      if (obj === null || obj === undefined) throw new Error("patch_path_missing");
      if (typeof obj !== "object") throw new Error("patch_path_not_object");
      obj = obj[seg];
    }
    return obj;
  };

  for (const raw of list) {
    const op = raw && typeof raw === "object" ? raw : null;
    const kind = typeof op?.op === "string" ? op.op : "";
    const segments = parseJsonPointer(op?.path);

    if (segments.length === 0) {
      if (kind === "replace" || kind === "add") {
        root = safeClone(op.value);
        continue;
      }
      if (kind === "remove") {
        root = undefined;
        continue;
      }
      throw new Error(`Unsupported patch op: ${kind}`);
    }

    const parentSegments = segments.slice(0, -1);
    const leaf = segments[segments.length - 1];
    if (isUnsafePathSegment(leaf)) throw new Error("unsafe_path_segment");

    const parent = getParent(parentSegments);
    if (parent === null || parent === undefined || typeof parent !== "object") throw new Error("patch_parent_not_object");

    if (kind === "remove") {
      if (Array.isArray(parent)) {
        const idx = Number(leaf);
        if (!Number.isFinite(idx) || idx < 0 || idx >= parent.length) continue;
        parent.splice(idx, 1);
      } else {
        delete parent[leaf];
      }
      continue;
    }

    if (kind === "add" || kind === "replace") {
      if (Array.isArray(parent)) {
        const idx = Number(leaf);
        if (!Number.isFinite(idx) || idx < 0) continue;
        if (idx >= parent.length) parent.push(safeClone(op.value));
        else parent[idx] = safeClone(op.value);
      } else {
        parent[leaf] = safeClone(op.value);
      }
      continue;
    }

    throw new Error(`Unsupported patch op: ${kind}`);
  }

  return root;
}

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
   * @param {object=} options
   * @param {object=} options.diff Incremental checkpoint diff settings (best-effort).
   * @param {number=} options.restoreCacheMax Max restored checkpoints to cache in memory (0 disables caching).
   */
  constructor(storage, { diff, restoreCacheMax } = {}) {
    this.storage = assertStorageAdapter(storage);
    this._saveCounter = 0;
    this._diff = normalizeDiffConfig(diff);
    this._lastCheckpointIdByRunId = new Map(); // runId -> checkpointId
    this._diffSinceFullByRunId = new Map(); // runId -> number
    this._restoreCacheMax = normalizeCacheMax(restoreCacheMax, DEFAULT_RESTORE_CACHE_MAX);
    this._restoreCache = new Map(); // checkpointId -> {schemaVersion?,nodeStates,timestamp,metadata}
  }

  _pruneRestoreCache() {
    const max = this._restoreCacheMax;
    if (max === Infinity) return;
    const limit = typeof max === "number" && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
    if (limit <= 0) {
      this._restoreCache.clear();
      return;
    }
    while (this._restoreCache.size > limit) {
      const oldest = this._restoreCache.keys().next().value;
      if (!oldest) break;
      this._restoreCache.delete(oldest);
    }
  }

  _cacheRestoredCheckpoint(checkpointId, restored) {
    const id = toNonEmptyString(checkpointId);
    if (!id) return;
    const max = this._restoreCacheMax;
    if (max === 0) return;
    this._restoreCache.set(id, restored);
    this._pruneRestoreCache();
  }

  _touchRestoreCache(checkpointId) {
    const max = this._restoreCacheMax;
    if (max === 0 || max === Infinity) return;
    const id = toNonEmptyString(checkpointId);
    if (!id) return;
    const cached = this._restoreCache.get(id);
    if (!cached) return;
    this._restoreCache.delete(id);
    this._restoreCache.set(id, cached);
  }

  async _restoreCheckpointInternal(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) return null;
    const cached = this._restoreCache.get(id);
    if (cached) {
      this._touchRestoreCache(id);
      return cached;
    }

    const snapshot = await this.storage.get(id);
    if (!snapshot) return null;

    const parsed = splitCheckpointId(id);
    const timestamp = snapshot.timestamp ?? parsed?.timestamp ?? null;
    const schemaVersion = toNonEmptyString(snapshot.schemaVersion);

    // Full snapshot (default).
    const encoding = typeof snapshot.encoding === "string" ? snapshot.encoding : "";
    if (encoding !== "diff") {
      const out = {
        ...(schemaVersion ? { schemaVersion } : {}),
        nodeStates: snapshot.nodeStates ?? {},
        timestamp,
        metadata: snapshot.metadata,
      };
      this._cacheRestoredCheckpoint(id, out);
      return out;
    }

    // Diff snapshot.
    const baseId = toNonEmptyString(snapshot.base);
    const patch = Array.isArray(snapshot.patch) ? snapshot.patch : null;
    if (!baseId || !patch) {
      const out = {
        ...(schemaVersion ? { schemaVersion } : {}),
        nodeStates: snapshot.nodeStates ?? {},
        timestamp,
        metadata: snapshot.metadata,
      };
      this._cacheRestoredCheckpoint(id, out);
      return out;
    }

    const base = await this._restoreCheckpointInternal(baseId);
    const reconstructed = applyJsonPatch(base?.nodeStates ?? {}, patch);
    const out = {
      ...(schemaVersion ? { schemaVersion } : {}),
      nodeStates: reconstructed ?? {},
      timestamp,
      metadata: snapshot.metadata,
    };
    this._cacheRestoredCheckpoint(id, out);
    return out;
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

    const nodeStates = payload.nodeStates ?? {};
    const metadata = payload.metadata;

    const snapshotFull = {
      ...(schemaVersion ? { schemaVersion } : {}),
      nodeStates,
      timestamp,
      metadata,
    };

    const diffCfg = this._diff;
    const diffEnabled = diffCfg?.enabled === true;
    const runKey = normalizedRunId;
    const sinceFull = this._diffSinceFullByRunId.get(runKey) || 0;

    let snapshotToStore = snapshotFull;

    if (diffEnabled && sinceFull < diffCfg.fullSnapshotEvery - 1) {
      const prevId = this._lastCheckpointIdByRunId.get(runKey) || (await this._getLatestCheckpointId(runKey));
      if (prevId) {
        try {
          const prev = await this._restoreCheckpointInternal(prevId);
          const patch = buildJsonPatch(prev?.nodeStates ?? {}, nodeStates, {
            maxDepth: diffCfg.maxDepth,
            maxOps: diffCfg.maxOps,
          });

          const diffSnapshot = {
            ...(schemaVersion ? { schemaVersion } : {}),
            encoding: "diff",
            base: prevId,
            patch,
            timestamp,
            metadata,
          };

          const fullBytes = safeJsonSize(snapshotFull);
          const diffBytes = safeJsonSize(diffSnapshot);
          const saved = fullBytes > 0 && diffBytes > 0 ? fullBytes - diffBytes : 0;
          if (saved >= diffCfg.minSavingsBytes) {
            snapshotToStore = diffSnapshot;
          }
        } catch {
          // Best-effort: if diff fails, fall back to full snapshot.
          snapshotToStore = snapshotFull;
        }
      }
    }

    await this.storage.set(checkpointId, snapshotToStore);
    this._lastCheckpointIdByRunId.set(runKey, checkpointId);
    if (snapshotToStore === snapshotFull) {
      this._diffSinceFullByRunId.set(runKey, 0);
    } else {
      this._diffSinceFullByRunId.set(runKey, sinceFull + 1);
    }
    return checkpointId;
  }

  async _getLatestCheckpointId(runId) {
    try {
      const checkpoints = await this.listCheckpoints(runId);
      const latest = checkpoints && checkpoints.length ? checkpoints[0].checkpointId : null;
      const id = toNonEmptyString(latest);
      return id || null;
    } catch {
      return null;
    }
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
      return await this._restoreCheckpointInternal(normalizedKey);
    }

    const checkpoints = await this.listCheckpoints(normalizedKey);
    if (checkpoints.length === 0) return null;

    return await this._restoreCheckpointInternal(checkpoints[0].checkpointId);
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

    const restored = await this._restoreCheckpointInternal(normalizedId);
    if (!restored) throw new Error(`Checkpoint not found: ${normalizedId}`);
    return restored;
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
      this._restoreCache.delete(key);
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
      request.onblocked = () => {
        try {
          console.warn(`[IndexedDBAdapter] open blocked for ${this.dbName}@v1`);
        } catch {
          // ignore
        }
      };
      request.onsuccess = () => {
        this._db = request.result;
        try {
          this._db.onversionchange = () => this.close();
        } catch {
          // ignore
        }
        resolve(this._db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
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
