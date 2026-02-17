import { isPlainObject, toNonEmptyString, toPositiveInt } from "../../shared/utils/value-utils.js";
import { applyJsonPatch, buildJsonPatch, safeJsonSize } from "./serialization.js";

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
const DEFAULT_RESTORE_MAX_DEPTH = 50;

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
   * @param {{ diff?: any, restoreCacheMax?: number }} [options]
   */
  constructor(storage, { diff, restoreCacheMax } = {}) {
    this.storage = assertStorageAdapter(storage);
    this._saveCounter = 0;
    this._diff = normalizeDiffConfig(diff);
    this._lastCheckpointIdByRunId = new Map(); // runId -> checkpointId
    this._diffSinceFullByRunId = new Map(); // runId -> number
    this._saveLocks = new Map(); // runId -> Promise
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

  async _restoreCheckpointInternal(checkpointId, visited = new Set(), depth = 0) {
    const id = toNonEmptyString(checkpointId);
    if (!id) return null;

    // Guard: cycle detection
    if (visited.has(id)) {
      throw new Error(`Circular checkpoint reference detected: ${id}`);
    }
    // Guard: max depth
    if (depth > DEFAULT_RESTORE_MAX_DEPTH) {
      throw new Error(`Checkpoint restore max depth exceeded (${DEFAULT_RESTORE_MAX_DEPTH}): ${id}`);
    }

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

    // Add current id to visited set for cycle detection
    visited.add(id);
    const base = await this._restoreCheckpointInternal(baseId, visited, depth + 1);
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

    const runKey = normalizedRunId;
    // Serialize saves per runId to prevent checkpointId collisions.
    const lockMap = this._saveLocks;
    const prevTail = lockMap.get(runKey) || Promise.resolve();
    /** @type {(() => void) | null} */
    let release = null;
    const tail = new Promise((resolve) => {
      release = () => resolve();
    });
    lockMap.set(runKey, tail);

    try {
      await prevTail;

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
      const sinceFull = this._diffSinceFullByRunId.get(runKey) || 0;

      /** @type {unknown} */
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
    } finally {
      try {
        release?.();
      } catch {
        // ignore
      }
      if (lockMap.get(runKey) === tail) {
        lockMap.delete(runKey);
      }
    }
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
      const parsed = splitCheckpointId(key);
      const timestamp = parsed?.timestamp ?? "";
      const counter = Number.isFinite(parsed?.counter) ? parsed.counter : 0;

      // Only read full snapshot if timestamp cannot be extracted from key
      let nodeStates = {};
      if (!timestamp) {
        const snapshot = await this.storage.get(key);
        if (!snapshot) continue;
        nodeStates = snapshot.nodeStates ?? {};
      }

      checkpoints.push({
        checkpointId: key,
        timestamp,
        nodeStates,
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

    // Collect base references from all snapshots to protect diff chain integrity
    const referencedBases = new Set();
    for (const key of keys) {
      const snap = await this.storage.get(key);
      if (snap && typeof snap.base === "string" && snap.base) {
        referencedBases.add(snap.base);
      }
    }

    let deleted = 0;
    for (const key of keys) {
      const parsed = splitCheckpointId(key);
      if (!parsed) continue;

      const tsMs = toEpochMs(parsed.timestamp);
      if (tsMs === null) continue;
      if (tsMs >= cutoffMs) continue;

      // Skip snapshots referenced as base by diff snapshots to prevent chain breakage
      if (referencedBases.has(key)) continue;

      await this.storage.delete(key);
      this._restoreCache.delete(key);
      deleted += 1;
    }

    return deleted;
  }
}
