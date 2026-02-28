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

function normalizePositiveInteger(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
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
   * @param {boolean} [options.enableIncrementalIndex=true] - Enable incremental index refresh on init
   * @param {number} [options.incrementalIndexWindowMs=3600000] - Recent modification window for incremental refresh
   * @param {number} [options.incrementalIndexMaxEntries=64] - Max snapshots to load during incremental refresh
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

    /** @private */
    this._enableIncrementalIndex = o.enableIncrementalIndex !== false;
    /** @private */
    this._incrementalIndexWindowMs = normalizePositiveInteger(o.incrementalIndexWindowMs, 60 * 60 * 1000);
    /** @private */
    this._incrementalIndexMaxEntries = normalizePositiveInteger(o.incrementalIndexMaxEntries, 64);
    /** @private */
    this._indexUpdatedAt = 0;
    /** @private */
    this._incrementalRefreshPromise = null;
  }

  /**
   * Initialize storage: create directories and restore index from VFS.
   * @returns {Promise<void>}
   */
  async init() {
    this._ensureNotDisposed();
    if (this._initialized) return;

    const timeout = 30000; // 30秒
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('L3Storage init timeout after 30s')), timeout)
    );

    await Promise.race([
      (async () => {
        await this._io.ensureDirs();
        await this.restoreIndex();
        this._scheduleIncrementalIndexRefresh();

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
      })(),
      timeoutPromise
    ]);
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
   * Schedule incremental index refresh in a microtask.
   * Keeps init fast while still repairing stale/missing index entries.
   * @private
   * @returns {void}
   */
  _scheduleIncrementalIndexRefresh() {
    if (!this._enableIncrementalIndex) return;
    if (this._incrementalRefreshPromise) return;

    this._incrementalRefreshPromise = new Promise((resolve) => {
      queueMicrotask(async () => {
        try {
          await this._refreshIndexIncrementally();
        } catch (err) {
          logger.warn("[L3Storage] incremental index refresh failed:", err);
        } finally {
          this._incrementalRefreshPromise = null;
          resolve();
        }
      });
    });
  }

  /**
   * Wait for pending incremental index refresh.
   * Useful for deterministic tests.
   * @returns {Promise<void>}
   */
  async waitForIncrementalIndexRefresh() {
    if (this._incrementalRefreshPromise) {
      await this._incrementalRefreshPromise;
    }
  }

  /**
   * @private
   * @param {string} path
   * @returns {string|null}
   */
  _snapshotIdFromPath(path) {
    const raw = toNonEmptyString(path);
    if (!raw) return null;
    const fileName = raw.split("/").pop() || "";
    if (!fileName.endsWith(".json")) return null;
    return normalizeStorageId(fileName.slice(0, -5));
  }

  /**
   * @private
   * @returns {Promise<string[]>}
   */
  async _listSnapshotFilePaths() {
    const dir = this._io.snapshotsDir;

    if (typeof this._vfs.listFiles === "function") {
      try {
        const files = await this._vfs.listFiles({ prefix: dir, recursive: false });
        return Array.isArray(files) ? files.filter((path) => String(path).endsWith(".json")) : [];
      } catch (err) {
        logger.warn("[L3Storage] listFiles failed during incremental refresh:", err);
      }
    }

    if (typeof this._vfs.readdir === "function") {
      try {
        const entries = await this._vfs.readdir(dir, { withFileTypes: true });
        if (!Array.isArray(entries)) return [];
        const files = [];
        for (const entry of entries) {
          const name = toNonEmptyString(entry?.name || entry);
          if (!name || !name.endsWith(".json")) continue;
          const isDirectory = typeof entry?.isDirectory === "function" ? entry.isDirectory() : false;
          if (isDirectory) continue;
          files.push(`${dir}/${name}`);
        }
        return files;
      } catch (err) {
        logger.warn("[L3Storage] readdir failed during incremental refresh:", err);
      }
    }

    return [];
  }

  /**
   * @private
   * @param {string} path
   * @returns {Promise<number>}
   */
  async _readMtime(path) {
    if (typeof this._vfs.stat !== "function") return 0;
    try {
      const st = await this._vfs.stat(path);
      const mtime = typeof st?.mtimeMs === "number" && Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;
      return mtime > 0 ? Math.floor(mtime) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * @private
   * @returns {Promise<Array<{ id: string, path: string, mtimeMs: number }>>}
   */
  async _collectIncrementalCandidates() {
    const files = await this._listSnapshotFilePaths();
    if (files.length === 0) return [];

    const knownIds = new Set(
      (Array.isArray(this._index.timeline) ? this._index.timeline : [])
        .map((entry) => normalizeStorageId(entry?.id))
        .filter(Boolean)
    );
    const now = Date.now();
    const windowStart = Math.max(0, now - this._incrementalIndexWindowMs);
    const baseUpdatedAt = this._indexUpdatedAt > 0 ? this._indexUpdatedAt : 0;
    const cutoffTs = Math.max(windowStart, baseUpdatedAt > 0 ? baseUpdatedAt - 1000 : 0);
    const coldStart = knownIds.size === 0;

    const candidates = [];
    for (const filePath of files) {
      const id = this._snapshotIdFromPath(filePath);
      if (!id) continue;
      const mtimeMs = await this._readMtime(filePath);
      const isKnown = knownIds.has(id);

      let shouldLoad = false;
      if (coldStart) {
        shouldLoad = true;
      } else if (!isKnown) {
        shouldLoad = mtimeMs <= 0 || mtimeMs >= cutoffTs;
      } else {
        shouldLoad = mtimeMs > 0 && mtimeMs >= cutoffTs;
      }
      if (!shouldLoad) continue;

      candidates.push({ id, path: filePath, mtimeMs });
    }

    candidates.sort((a, b) => {
      const aTs = typeof a.mtimeMs === "number" ? a.mtimeMs : 0;
      const bTs = typeof b.mtimeMs === "number" ? b.mtimeMs : 0;
      if (bTs !== aTs) return bTs - aTs;
      return String(a.id).localeCompare(String(b.id));
    });

    return candidates.slice(0, this._incrementalIndexMaxEntries);
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _refreshIndexIncrementally() {
    if (!this._enableIncrementalIndex || this.disposed) return;

    const candidates = await this._collectIncrementalCandidates();
    if (candidates.length === 0) return;

    let touched = false;
    for (const candidate of candidates) {
      try {
        const snapshot = await this._io.readJson(candidate.path);
        if (!snapshot || typeof snapshot !== "object") continue;

        const snapshotId = normalizeStorageId(snapshot.id) || candidate.id;
        if (!snapshotId) continue;

        removeSnapshotFromIndex(this._index, snapshotId);

        const stageKey = toNonEmptyString(snapshot.stageKey);
        const keywords = normalizeKeywords(snapshot.keywords);
        const ts = typeof snapshot.ts === "number" && Number.isFinite(snapshot.ts)
          ? snapshot.ts
          : candidate.mtimeMs > 0
            ? candidate.mtimeMs
            : Date.now();
        const summary = toNonEmptyString(snapshot.summary) || getSummary(snapshot.data);
        const contentHash = toNonEmptyString(snapshot.contentHash);

        addSnapshotToIndex(this._index, {
          id: snapshotId,
          ts,
          stageKey,
          keywords,
          summary,
          ...(contentHash ? { contentHash } : {}),
        });

        const timelineEntry = Array.isArray(this._index.timeline)
          ? this._index.timeline.find((entry) => entry?.id === snapshotId)
          : null;
        if (timelineEntry && snapshot.superseded === true) {
          timelineEntry.superseded = true;
          timelineEntry.supersededBy = toNonEmptyString(snapshot.supersededBy) || "";
        }

        this._snapshotCache.set(snapshotId, snapshot);
        touched = true;
      } catch (err) {
        logger.warn("[L3Storage] failed to refresh incremental snapshot:", {
          id: candidate.id,
          error: err?.message || String(err),
        });
      }
    }

    if (!touched) return;

    this._indexUpdatedAt = Date.now();

    try {
      await this.persistIndex();
    } catch (err) {
      logger.warn("[L3Storage] persistIndex failed after incremental refresh:", err);
    }
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
    this._indexUpdatedAt = typeof data?.updatedAt === "number" && Number.isFinite(data.updatedAt)
      ? data.updatedAt
      : Date.now();
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
    this._indexUpdatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : 0;
  }

  /**
   * Background eviction: remove lowest-value snapshots if limits exceeded.
   * Uses weighted scoring: recency 70% + access frequency 30% (replaces pure LRU).
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

    // Weighted eviction: recency (70%) + access frequency (30%)
    // Lower score = more likely to evict
    const now = Date.now();
    const maxAge = Math.max(1, now - Math.min(...timeline.map(e => e?.ts || now)));
    const sorted = [...timeline].sort((a, b) => {
      const aAt = typeof a?.accessedAt === "number" ? a.accessedAt : a?.ts || 0;
      const bAt = typeof b?.accessedAt === "number" ? b.accessedAt : b?.ts || 0;
      const aFreq = typeof a?.accessCount === "number" ? a.accessCount : 1;
      const bFreq = typeof b?.accessCount === "number" ? b.accessCount : 1;
      const aRecency = (now - aAt) / maxAge; // 0=newest, 1=oldest
      const bRecency = (now - bAt) / maxAge;
      const aScore = 0.7 * (1 - aRecency) + 0.3 * Math.log2(aFreq + 1);
      const bScore = 0.7 * (1 - bRecency) + 0.3 * Math.log2(bFreq + 1);
      return aScore - bScore; // lowest score evicted first
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
      await this.waitForIncrementalIndexRefresh();
    } catch (err) {
      logger.warn("[L3Storage] waitForIncrementalIndexRefresh() failed during dispose:", err);
    }
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
