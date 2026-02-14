import { LRUCache, DisposableBase, createLogger } from "../../shared/index.js";
import { DEFAULT_MAX_SNAPSHOTS, DEFAULT_MAX_STORAGE_BYTES } from "./l3-storage/constants.js";
import { computeContentHash } from "./l3-storage/hash.js";
import {
  addSnapshotToIndex,
  createIndexState,
  estimateStorageBytes,
  getSupersededSnapshotCount,
  markSnapshotSupersededInIndex,
  markSnapshotsSupersededInIndex,
  removeSnapshotFromIndex,
  restoreIndexState,
  serializeIndexState,
  updateSnapshotAccess,
} from "./l3-storage/index-manager.js";
import { getSupersededTimeline, getTimeline, isDuplicate as isDuplicateQuery, searchByKeyword } from "./l3-storage/query.js";
import { createStorageIO } from "./l3-storage/storage-io.js";
import {
  decodeTabCoordinatorSession,
  encodeTabCoordinatorSession,
  ensureTabCoordinatorHooks,
  releaseTabCoordinatorHooks,
} from "./l3-storage/tab-coordinator.js";
import { getSummary, normalizeKeywords, toNonEmptyString, validateRunId } from "./l3-storage/utils.js";

const logger = createLogger("runtime/memory/l3-storage");
const SAFE_STORAGE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function normalizeStorageId(value) {
  const id = toNonEmptyString(value);
  if (!id || !SAFE_STORAGE_ID_RE.test(id)) return null;
  return id;
}

/**
 * @typedef {object} L3TimelineEntry
 * @property {string} id
 * @property {number} ts
 * @property {number} [accessedAt]
 * @property {string} [summary]
 * @property {string} [stageKey]
 * @property {boolean} [superseded]
 * @property {string} [supersededBy]
 *
 * @typedef {object} L3TimelineOptions
 * @property {boolean} [includeSuperseded]
 */

/** @typedef {import("../coordination/tab-coordinator.js").TabCoordinator} TabCoordinator */

export class L3Storage extends DisposableBase {
  /**
   * @param {object} options
   * @param {any} options.vfs - VFS instance (required)
   * @param {string} options.runId - Run ID (required)
   * @param {number} [options.cacheSize=10] - Snapshot LRU cache size
   * @param {number} [options.checkpointCacheSize=5] - Checkpoint LRU cache size
   * @param {boolean} [options.deduplicateByDefault=true] - Default deduplication behavior
   * @param {number} [options.maxSnapshots=1000] - Max snapshot count before eviction
   * @param {number} [options.maxStorageBytes=104857600] - Max storage bytes before eviction (100MB)
   * @param {TabCoordinator} [options.tabCoordinator] - Optional TabCoordinator for cross-tab LRU sync
   * @param {object} [options.eventBus] - Optional EventBus for emitting l3:evicted events
   */
  constructor(options) {
    super();

    const o = options && typeof options === "object" ? options : {};
    const vfs = o.vfs;
    if (!vfs || typeof vfs !== "object") throw new Error("L3Storage requires { vfs }");
    if (typeof vfs.readFile !== "function") throw new Error("L3Storage requires vfs.readFile(path)");
    if (typeof vfs.writeFile !== "function") throw new Error("L3Storage requires vfs.writeFile(path, data)");
    if (typeof vfs.mkdir !== "function") throw new Error("L3Storage requires vfs.mkdir(path, { recursive })");

    const runId = validateRunId(o.runId);

    const cacheSizeRaw = o.cacheSize;
    const checkpointCacheSizeRaw = o.checkpointCacheSize;
    const cacheSize =
      typeof cacheSizeRaw === "number" && Number.isFinite(cacheSizeRaw) ? Math.max(1, Math.floor(cacheSizeRaw)) : 10;
    const checkpointCacheSize =
      typeof checkpointCacheSizeRaw === "number" && Number.isFinite(checkpointCacheSizeRaw)
        ? Math.max(1, Math.floor(checkpointCacheSizeRaw))
        : 5;

    // Eviction config
    const maxSnapshotsRaw = o.maxSnapshots;
    const maxStorageBytesRaw = o.maxStorageBytes;
    /** @private */
    this._maxSnapshots =
      typeof maxSnapshotsRaw === "number" && Number.isFinite(maxSnapshotsRaw) && maxSnapshotsRaw > 0
        ? Math.floor(maxSnapshotsRaw)
        : DEFAULT_MAX_SNAPSHOTS;
    /** @private */
    this._maxStorageBytes =
      typeof maxStorageBytesRaw === "number" && Number.isFinite(maxStorageBytesRaw) && maxStorageBytesRaw > 0
        ? Math.floor(maxStorageBytesRaw)
        : DEFAULT_MAX_STORAGE_BYTES;

    /** @private */
    this._tabCoordinator = o.tabCoordinator && typeof o.tabCoordinator === "object" ? o.tabCoordinator : null;
    /** @private */
    this._tabCoordinatorListeners = null;
    /** @private */
    this._eventBus = o.eventBus && typeof o.eventBus === "object" ? o.eventBus : null;

    /** @private */
    this._vfs = vfs;
    /** @private */
    this._runId = runId;
    /** @private */
    this._basePath = `.agents/runs/${runId}/l3`;
    /** @private */
    this._io = createStorageIO({ vfs, basePath: this._basePath });
    /** @private */
    this._deduplicateByDefault = o.deduplicateByDefault !== false;

    /** @private */
    this._snapshotCache = new LRUCache({ maxSize: cacheSize });
    /** @private */
    this._checkpointCache = new LRUCache({ maxSize: checkpointCacheSize });

    /** @private */
    this._index = createIndexState();

    /** @private */
    this._checkpointIndex = [];

    /** @private */
    this._initialized = false;

    /** @private @type {{ id: string, deduplicated: boolean } | null} */
    this._lastArchiveResult = null;

    /** @private - pending eviction promise (for testing/await) */
    this._evictionPromise = null;

    /** @private - whether TabCoordinator is successfully enabled */
    this._tabCoordinatorEnabled = false;
  }

  /**
   * Initialize storage: create directories and restore index from VFS.
   * @returns {Promise<void>}
   */
  async init() {
    this._ensureNotDisposed();
    if (this._initialized) return;

    await this._io.ensureDirs();
    await this.restoreIndex();

    // Attach TabCoordinator with error handling (graceful degradation)
    if (this._tabCoordinator) {
      try {
        await this._attachTabCoordinator();
        this._tabCoordinatorEnabled = true;
      } catch (err) {
        logger.warn("[L3Storage] Failed to attach TabCoordinator, continuing without cross-tab sync:", err);
        this._tabCoordinatorEnabled = false;
      }
    }

    this._initialized = true;
  }

  /**
   * Attach tabCoordinator listeners for cross-tab LRU updates.
   * @private
   * @returns {Promise<void>}
   */
  async _attachTabCoordinator() {
    if (this._tabCoordinatorListeners) return;
    const coordinator = this._tabCoordinator;
    if (!coordinator || typeof coordinator !== "object") return;

    if (typeof coordinator.init === "function") {
      try {
        await coordinator.init();
      } catch (err) {
        logger.warn("[L3Storage] tabCoordinator init failed:", err);
      }
    }

    const hooks = ensureTabCoordinatorHooks(coordinator, logger);
    if (!hooks) return;

    const evictionHandler = (sessionId) => {
      const snapshotId = this._parseTabCoordinatorSessionId(sessionId);
      if (!snapshotId) return;
      this._handleRemoteEviction(snapshotId);
    };

    const accessHandler = (sessionId) => {
      const snapshotId = this._parseTabCoordinatorSessionId(sessionId);
      if (!snapshotId) return;
      this._handleRemoteAccess(snapshotId);
    };

    hooks.eviction.add(evictionHandler);
    hooks.access.add(accessHandler);
    this._tabCoordinatorListeners = { coordinator, hooks, evictionHandler, accessHandler };
  }

  /**
   * Detach tabCoordinator listeners.
   * @private
   * @returns {void}
   */
  _detachTabCoordinator() {
    const listeners = this._tabCoordinatorListeners;
    if (!listeners) return;
    const { coordinator, hooks, evictionHandler, accessHandler } = listeners;
    if (hooks?.eviction) hooks.eviction.delete(evictionHandler);
    if (hooks?.access) hooks.access.delete(accessHandler);
    releaseTabCoordinatorHooks(coordinator, hooks);
    this._tabCoordinatorListeners = null;
  }

  /**
   * @private
   * @param {string} snapshotId
   * @returns {string | null}
   */
  _buildTabCoordinatorSessionId(snapshotId) {
    return encodeTabCoordinatorSession(this._runId, snapshotId);
  }

  /**
   * @private
   * @param {string} sessionId
   * @returns {string | null}
   */
  _parseTabCoordinatorSessionId(sessionId) {
    const parsed = decodeTabCoordinatorSession(sessionId);
    if (!parsed || parsed.runId !== this._runId) return null;
    return parsed.snapshotId;
  }

  /**
   * @private
   * @param {string} snapshotId
   * @returns {void}
   */
  _broadcastEviction(snapshotId) {
    if (!this._tabCoordinatorEnabled) return;
    const coordinator = this._tabCoordinator;
    if (!coordinator || typeof coordinator.broadcastEviction !== "function") return;
    const sessionId = this._buildTabCoordinatorSessionId(snapshotId);
    if (!sessionId) return;
    coordinator.broadcastEviction(sessionId);
  }

  /**
   * @private
   * @param {string} snapshotId
   * @returns {void}
   */
  _broadcastAccess(snapshotId) {
    if (!this._tabCoordinatorEnabled) return;
    const coordinator = this._tabCoordinator;
    if (!coordinator || typeof coordinator.broadcastAccess !== "function") return;
    const sessionId = this._buildTabCoordinatorSessionId(snapshotId);
    if (!sessionId) return;
    coordinator.broadcastAccess(sessionId);
  }

  /**
   * Remove locally cached data for snapshots evicted by another tab.
   * @private
   * @param {string} snapshotId
   * @returns {void}
   */
  _handleRemoteEviction(snapshotId) {
    if (this.disposed) return;
    const id = normalizeStorageId(snapshotId);
    if (!id) return;

    this._snapshotCache.delete(id);
    removeSnapshotFromIndex(this._index, id);
  }

  /**
   * Update local LRU access timestamp for snapshots touched by another tab.
   * @private
   * @param {string} snapshotId
   * @returns {void}
   */
  _handleRemoteAccess(snapshotId) {
    if (this.disposed) return;
    const id = normalizeStorageId(snapshotId);
    if (!id) return;

    updateSnapshotAccess(this._index, id, Date.now());
  }

  /**
   * Archive a snapshot to VFS and update the in-memory index.
   * Supports content-based deduplication via hash.
   * Triggers background LRU eviction if limits are exceeded.
   * @param {string} stageKey
   * @param {any} data
   * @param {string[]} [keywords=[]]
   * @param {{ deduplicate?: boolean }} [options={}]
   * @returns {Promise<string>} Snapshot ID (may be existing if deduplicated)
   */
  async archive(stageKey, data, keywords = [], options = {}) {
    this._ensureNotDisposed();
    await this.init();

    const opts = options && typeof options === "object" ? options : {};
    const shouldDeduplicate = typeof opts.deduplicate === "boolean" ? opts.deduplicate : this._deduplicateByDefault;

    // Compute content hash for deduplication
    const contentHash = computeContentHash(data);

    // Check for existing snapshot with same content
    if (shouldDeduplicate && this._index.hashIndex.has(contentHash)) {
      const existingId = this._index.hashIndex.get(contentHash);
      this._lastArchiveResult = { id: existingId, deduplicated: true };
      return existingId;
    }

    // genId pattern: snap_<ts>_<rand>
    const id = "snap_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const ts = Date.now();
    const stage = toNonEmptyString(stageKey);
    const normalizedKeywords = normalizeKeywords(keywords);

    const entry = {
      id,
      runId: this._runId,
      stageKey: stage,
      keywords: normalizedKeywords,
      ts,
      summary: getSummary(data),
      contentHash,
      data,
    };

    await this._io.writeJson(this._io.snapshotPath(id), entry);
    this._snapshotCache.set(id, entry);

    addSnapshotToIndex(this._index, {
      id,
      ts,
      stageKey: stage,
      keywords: normalizedKeywords,
      summary: entry.summary,
      contentHash,
    });

    await this.persistIndex();
    this._lastArchiveResult = { id, deduplicated: false };

    // Trigger background eviction (non-blocking)
    this._evictionPromise = this._maybeEvict().catch((err) => {
      logger.warn("[L3Storage] eviction error:", err);
    });

    return id;
  }

  /**
   * Fetch a snapshot by ID (cache-first).
   * Updates accessedAt for LRU tracking.
   * @param {string} id
   * @returns {Promise<any | null>}
   */
  async getSnapshot(id) {
    this._ensureNotDisposed();
    await this.init();

    const snapId = normalizeStorageId(id);
    if (!snapId) return null;

    // Update accessedAt in timeline for LRU tracking
    updateSnapshotAccess(this._index, snapId, Date.now());

    const cached = this._snapshotCache.get(snapId);
    if (cached) {
      this._broadcastAccess(snapId);
      return cached;
    }

    const entry = await this._io.readJson(this._io.snapshotPath(snapId));
    if (!entry) return null;

    this._snapshotCache.set(snapId, entry);
    this._broadcastAccess(snapId);
    return entry;
  }

  /**
   * Persist a checkpoint to VFS and update checkpoint metadata index.
   * @param {any} snapshotData
   * @returns {Promise<string>} Checkpoint ID
   */
  async checkpoint(snapshotData) {
    this._ensureNotDisposed();
    await this.init();

    const base = snapshotData && typeof snapshotData === "object" ? { ...snapshotData } : { data: snapshotData };
    const existingId = normalizeStorageId(base.id);

    const id = existingId || "ckpt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const ts = typeof base.ts === "number" && Number.isFinite(base.ts) ? base.ts : Date.now();

    const checkpoint = { ...base, id, ts, runId: toNonEmptyString(base.runId) || this._runId };
    await this._io.writeJson(this._io.checkpointPath(id), checkpoint);
    this._checkpointCache.set(id, checkpoint);

    const meta = {
      id,
      ts,
      encoding: toNonEmptyString(checkpoint.encoding),
      baseId: toNonEmptyString(checkpoint.baseId),
    };

    // Replace existing entry (if any) while preserving order semantics.
    this._checkpointIndex = Array.isArray(this._checkpointIndex) ? this._checkpointIndex.filter((c) => c?.id !== id) : [];
    this._checkpointIndex.push(meta);

    await this.persistIndex();
    return id;
  }

  /**
   * Fetch a checkpoint by ID (cache-first).
   * @param {string} id
   * @returns {Promise<any | null>}
   */
  async getCheckpoint(id) {
    this._ensureNotDisposed();
    await this.init();

    const ckptId = normalizeStorageId(id);
    if (!ckptId) return null;

    const cached = this._checkpointCache.get(ckptId);
    if (cached) return cached;

    const checkpoint = await this._io.readJson(this._io.checkpointPath(ckptId));
    if (!checkpoint) return null;

    this._checkpointCache.set(ckptId, checkpoint);
    return checkpoint;
  }

  /**
   * Return the most recent checkpoint (full data), or null if none.
   * @returns {Promise<any | null>}
   */
  async getLatestCheckpoint() {
    this._ensureNotDisposed();
    await this.init();

    const last = Array.isArray(this._checkpointIndex) ? this._checkpointIndex[this._checkpointIndex.length - 1] : null;
    const id = normalizeStorageId(last?.id);
    if (!id) return null;
    return await this.getCheckpoint(id);
  }

  /**
   * List checkpoint metadata only (no checkpoint payloads).
   * @returns {Promise<Array<{id: string, ts: number, encoding?: string|null, baseId?: string|null}>>}
   */
  async listCheckpoints() {
    this._ensureNotDisposed();
    await this.init();

    const list = Array.isArray(this._checkpointIndex) ? this._checkpointIndex : [];
    return list.map((c) => ({
      id: toNonEmptyString(c?.id) || "",
      ts: typeof c?.ts === "number" && Number.isFinite(c.ts) ? c.ts : 0,
      encoding: toNonEmptyString(c?.encoding),
      baseId: toNonEmptyString(c?.baseId),
    }));
  }

  /**
   * Persist the current index (timeline/keywords/stages + checkpoint metadata) to VFS.
   * Uses atomic write pattern: write to .tmp file, then rename (or fallback).
   * @returns {Promise<void>}
   */
  async persistIndex() {
    this._ensureNotDisposed();
    const data = serializeIndexState(this._index, this._checkpointIndex, this._runId);
    await this._io.persistIndex(data);
  }

  /**
   * Restore index (timeline/keywords/stages + checkpoint metadata) from VFS.
   * Checks for incomplete writes (.tmp file) and recovers if needed.
   * @returns {Promise<void>}
   */
  async restoreIndex() {
    this._ensureNotDisposed();
    const raw = await this._io.readIndexRaw();
    if (!raw || typeof raw !== "object") return;
    const restored = restoreIndexState(raw);
    if (!restored) return;
    this._index = restored.index;
    this._checkpointIndex = restored.checkpointIndex;
  }

  /**
   * Background eviction: remove oldest snapshots if limits exceeded.
   * Evicts by snapshot count or storage bytes, using LRU (accessedAt) ordering.
   * @private
   * @returns {Promise<void>}
   */
  async _maybeEvict() {
    const timeline = this._index.timeline;
    if (!Array.isArray(timeline) || timeline.length === 0) return;

    // Check if eviction needed
    const count = timeline.length;
    const bytes = estimateStorageBytes(this._index);
    if (count <= this._maxSnapshots && bytes <= this._maxStorageBytes) return;

    // Sort by accessedAt (oldest first) for LRU eviction
    const sorted = [...timeline].sort((a, b) => {
      const aAt = typeof a?.accessedAt === "number" ? a.accessedAt : a?.ts || 0;
      const bAt = typeof b?.accessedAt === "number" ? b.accessedAt : b?.ts || 0;
      return aAt - bAt;
    });

    const evicted = [];

    // Evict until under both limits
    for (const entry of sorted) {
      const currentCount = this._index.timeline.length;
      const currentBytes = estimateStorageBytes(this._index);
      if (currentCount <= this._maxSnapshots && currentBytes <= this._maxStorageBytes) break;

      const rawId = toNonEmptyString(entry?.id);
      if (!rawId) continue;
      const safeId = normalizeStorageId(rawId);

      // Remove from VFS
      try {
        if (safeId && typeof this._vfs.unlink === "function") {
          await this._vfs.unlink(this._io.snapshotPath(safeId));
        }
      } catch {
        // Ignore removal errors
      }

      // Remove from indexes
      this._snapshotCache.delete(rawId);
      removeSnapshotFromIndex(this._index, rawId);

      evicted.push(rawId);
    }

    if (evicted.length > 0) {
      await this.persistIndex();

      // Emit event if eventBus is available
      if (this._eventBus && typeof this._eventBus.emit === "function") {
        this._eventBus.emit("l3:evicted", { runId: this._runId, evictedIds: evicted, count: evicted.length });
      }

      for (const id of evicted) {
        this._broadcastEviction(id);
      }
    }
  }

  /**
   * Get current storage statistics.
   * @returns {{ snapshotCount: number, estimatedBytes: number, maxSnapshots: number, maxStorageBytes: number }}
   */
  getStorageStats() {
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    return {
      snapshotCount: timeline.length,
      estimatedBytes: estimateStorageBytes(this._index),
      maxSnapshots: this._maxSnapshots,
      maxStorageBytes: this._maxStorageBytes,
    };
  }

  /** @returns {number} */
  get supersededSnapshotCount() {
    return getSupersededSnapshotCount(this._index);
  }

  /**
   * Wait for any pending eviction to complete.
   * Useful for testing to ensure eviction finishes before assertions.
   * @returns {Promise<void>}
   */
  async waitForEviction() {
    if (this._evictionPromise) {
      await this._evictionPromise;
    }
  }

  /**
   * Mark a snapshot as superseded in the timeline and index.
   * @param {string} snapshotId
   * @param {string} correction
   * @returns {Promise<boolean>} true if newly superseded
   */
  async markSnapshotSuperseded(snapshotId, correction) {
    this._ensureNotDisposed();
    await this.init();

    const id = normalizeStorageId(snapshotId);
    if (!id) return false;

    const correctionText = typeof correction === "string" ? correction : String(correction ?? "");
    const { entry, wasSuperseded } = markSnapshotSupersededInIndex(this._index, id, correctionText);
    if (!entry) return false;

    const cached = this._snapshotCache.get(id);
    if (cached && typeof cached === "object") {
      cached.superseded = true;
      cached.supersededBy = correctionText;
      await this._io.writeJson(this._io.snapshotPath(id), cached);
    }

    await this.persistIndex();
    return !wasSuperseded;
  }

  /**
   * Mark multiple snapshots as superseded.
   * @param {string[]} ids
   * @param {string} correction
   * @returns {Promise<number>} count of newly superseded snapshots
   */
  async markSnapshotsSuperseded(ids, correction) {
    this._ensureNotDisposed();
    await this.init();

    const list = Array.isArray(ids) ? ids : [];
    if (list.length === 0) return 0;

    const safeIds = list.map((rawId) => normalizeStorageId(rawId)).filter(Boolean);
    if (safeIds.length === 0) return 0;

    const correctionText = typeof correction === "string" ? correction : String(correction ?? "");
    const { marked, touched, updatedIds } = markSnapshotsSupersededInIndex(this._index, safeIds, correctionText);

    for (const id of updatedIds) {
      const cached = this._snapshotCache.get(id);
      if (cached && typeof cached === "object") {
        cached.superseded = true;
        cached.supersededBy = correctionText;
        await this._io.writeJson(this._io.snapshotPath(id), cached);
      }
    }

    if (touched) {
      await this.persistIndex();
    }

    return marked;
  }

  /**
   * Return the current timeline (metadata only).
   * @param {L3TimelineOptions} [options]
   * @returns {L3TimelineEntry[]}
   */
  getTimeline(options = {}) {
    return getTimeline(this._index, options);
  }

  /**
   * Return only superseded timeline entries (metadata only).
   * @returns {L3TimelineEntry[]}
   */
  getSupersededTimeline() {
    return getSupersededTimeline(this._index);
  }

  /**
   * Search archived snapshot IDs by keyword (index-only, sync).
   * @param {string} keyword
   * @param {L3TimelineOptions} [options]
   * @returns {string[]} Snapshot IDs
   */
  searchByKeyword(keyword, options = {}) {
    return searchByKeyword(this._index, keyword, options);
  }

  /**
   * Check if data would be deduplicated (without archiving).
   * @param {any} data
   * @returns {{ duplicate: boolean, existingId?: string }}
   */
  isDuplicate(data) {
    return isDuplicateQuery(this._index, data);
  }

  /**
   * Get the result of the last archive() call.
   * @returns {{ id: string, deduplicated: boolean } | null}
   */
  getLastArchiveStats() {
    return this._lastArchiveResult;
  }

  /**
   * Dispose storage: best-effort persist index and clear caches.
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.disposed) return;
    this._detachTabCoordinator();
    try {
      await this.persistIndex();
    } catch (err) {
      logger.warn("[L3Storage] persistIndex() failed during dispose:", err);
    }
    try {
      this._snapshotCache.clear();
      this._checkpointCache.clear();
    } catch {
      // ignore
    }
    await super.dispose();
  }
}

/**
 * Factory helper.
 * @param {ConstructorParameters<typeof L3Storage>[0]} options
 * @returns {L3Storage}
 */
export function createL3Storage(options) {
  return new L3Storage(options);
}
