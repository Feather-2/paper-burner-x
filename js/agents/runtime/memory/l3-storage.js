import LRUCache from "../../shared/utils/lru-cache.js";
import DisposableBase from "../../shared/base/disposable-base.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/memory/l3-storage");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TAB_COORDINATOR_HOOKS_KEY = "__l3StorageHooks";

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

/**
 * cyrb53 - fast, high-quality 53-bit hash.
 * @see https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {string} hex string
 */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // 53-bit integer as hex string
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Compute content hash for deduplication.
 * @param {any} data
 * @returns {string}
 */
function computeContentHash(data) {
  try {
    const str = typeof data === "string" ? data : JSON.stringify(data);
    return cyrb53(str);
  } catch {
    return cyrb53(String(data ?? ""));
  }
}

function toNonEmptyString(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
}

/**
 * Validate runId to prevent path traversal attacks.
 * @param {string} runId - Run ID to validate
 * @returns {string} Validated runId
 * @throws {Error} If runId contains path traversal characters
 */
function validateRunId(runId) {
  const id = toNonEmptyString(runId);
  if (!id) throw new Error("L3Storage requires { runId }");
  // Reject path traversal attempts
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("L3Storage runId contains invalid characters (path traversal attempt)");
  }
  return id;
}

function encodeTabCoordinatorSession(runId, snapshotId) {
  const resolvedRunId = toNonEmptyString(runId);
  const resolvedSnapshotId = toNonEmptyString(snapshotId);
  if (!resolvedRunId || !resolvedSnapshotId) return null;
  return JSON.stringify({ runId: resolvedRunId, snapshotId: resolvedSnapshotId });
}

function decodeTabCoordinatorSession(sessionId) {
  const raw = toNonEmptyString(sessionId);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const runId = toNonEmptyString(parsed.runId);
  const snapshotId = toNonEmptyString(parsed.snapshotId);
  if (!runId || !snapshotId) return null;
  return { runId, snapshotId };
}

function callTabCoordinatorHandler(handler, sessionId, label) {
  if (typeof handler !== "function") return;
  try {
    handler(sessionId);
  } catch (err) {
    logger.warn(`[L3Storage] tabCoordinator ${label} handler error:`, err);
  }
}

function callTabCoordinatorHandlers(handlers, sessionId, label) {
  for (const handler of handlers) {
    callTabCoordinatorHandler(handler, sessionId, label);
  }
}

function ensureTabCoordinatorHooks(tabCoordinator) {
  const coordinator = tabCoordinator && typeof tabCoordinator === "object" ? tabCoordinator : null;
  if (!coordinator) return null;

  const existing = coordinator[TAB_COORDINATOR_HOOKS_KEY];
  if (existing && existing.eviction && existing.access) {
    return existing;
  }

  const hooks = {
    eviction: new Set(),
    access: new Set(),
    originalEviction: typeof coordinator._onEviction === "function" ? coordinator._onEviction : null,
    originalAccess: typeof coordinator._onAccess === "function" ? coordinator._onAccess : null,
  };

  coordinator[TAB_COORDINATOR_HOOKS_KEY] = hooks;

  coordinator._onEviction = (sessionId) => {
    callTabCoordinatorHandler(hooks.originalEviction, sessionId, "onEviction");
    callTabCoordinatorHandlers(hooks.eviction, sessionId, "onEviction");
  };

  coordinator._onAccess = (sessionId) => {
    callTabCoordinatorHandler(hooks.originalAccess, sessionId, "onAccess");
    callTabCoordinatorHandlers(hooks.access, sessionId, "onAccess");
  };

  return hooks;
}

function releaseTabCoordinatorHooks(tabCoordinator, hooks) {
  const coordinator = tabCoordinator && typeof tabCoordinator === "object" ? tabCoordinator : null;
  if (!coordinator || !hooks) return;
  if (coordinator[TAB_COORDINATOR_HOOKS_KEY] !== hooks) return;

  if (hooks.eviction.size === 0 && hooks.access.size === 0) {
    coordinator._onEviction = hooks.originalEviction || null;
    coordinator._onAccess = hooks.originalAccess || null;
    delete coordinator[TAB_COORDINATOR_HOOKS_KEY];
  }
}

function normalizeKeywords(keywords) {
  const raw = Array.isArray(keywords) ? keywords : [];
  const out = [];
  const seen = new Set();
  for (const kw of raw) {
    const k = typeof kw === "string" ? kw.trim().toLowerCase() : "";
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function truncate(text, maxLen) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const n = typeof maxLen === "number" && Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : 0;
  if (!n) return "";
  return s.length > n ? s.slice(0, n) : s;
}

function getSummary(data) {
  const summary = data && typeof data === "object" ? toNonEmptyString(data.summary) : null;
  if (summary) return summary;
  try {
    return truncate(typeof data === "string" ? data : JSON.stringify(data), 200);
  } catch {
    return truncate(String(data ?? ""), 200);
  }
}

function isMissingPathError(err) {
  const msg = String(err?.message || err || "");
  return msg.includes("ENOENT") || msg.includes("NotFoundError") || msg.includes("NOT_FOUND");
}

/** Default max snapshots before eviction */
const DEFAULT_MAX_SNAPSHOTS = 1000;
/** Default max storage bytes (100MB) */
const DEFAULT_MAX_STORAGE_BYTES = 100 * 1024 * 1024;
/** Estimated bytes per character in summary (UTF-8 avg) */
const BYTES_PER_CHAR = 2;
/** Base overhead per snapshot entry (id, ts, stageKey, accessedAt, etc.) */
const ENTRY_OVERHEAD_BYTES = 200;

/**
 * L3Storage - L3 cold storage for MemoryStore.
 *
 * Persists snapshots + checkpoints to VFS, keeping only:
 * - index metadata
 * - a small LRU cache of recent snapshots/checkpoints
 *
 * Supports LRU eviction when snapshot count or storage bytes exceed limits.
 */
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
    const runId = validateRunId(o.runId);
    if (!vfs || typeof vfs !== "object") throw new Error("L3Storage requires { vfs }");
    if (typeof vfs.readFile !== "function") throw new Error("L3Storage requires vfs.readFile(path)");
    if (typeof vfs.writeFile !== "function") throw new Error("L3Storage requires vfs.writeFile(path, data)");
    if (typeof vfs.mkdir !== "function") throw new Error("L3Storage requires vfs.mkdir(path, { recursive })");

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
    this._deduplicateByDefault = o.deduplicateByDefault !== false;

    /** @private */
    this._snapshotCache = new LRUCache({ maxSize: cacheSize });
    /** @private */
    this._checkpointCache = new LRUCache({ maxSize: checkpointCacheSize });

    /** @private */
    this._index = {
      timeline: [], // entries now include accessedAt field
      keywords: new Map(), // keyword -> Set<snapshotId>
      stages: new Map(), // stageKey -> snapshotId (latest)
      hashIndex: new Map(), // contentHash -> snapshotId
    };

    /** @private */
    this._checkpointIndex = [];

    /** @private */
    this._initialized = false;

    /** @private @type {{ id: string, deduplicated: boolean } | null} */
    this._lastArchiveResult = null;

    /** @private - pending eviction promise (for testing/await) */
    this._evictionPromise = null;
  }

  _snapshotsDir() {
    return `${this._basePath}/snapshots`;
  }

  _checkpointsDir() {
    return `${this._basePath}/checkpoints`;
  }

  _indexPath() {
    return `${this._basePath}/index.json`;
  }

  _indexTmpPath() {
    return `${this._basePath}/index.json.tmp`;
  }

  _snapshotPath(id) {
    return `${this._snapshotsDir()}/${id}.json`;
  }

  _checkpointPath(id) {
    return `${this._checkpointsDir()}/${id}.json`;
  }

  async _ensureDirs() {
    await this._vfs.mkdir(this._basePath, { recursive: true });
    await this._vfs.mkdir(this._snapshotsDir(), { recursive: true });
    await this._vfs.mkdir(this._checkpointsDir(), { recursive: true });
  }

  async _readJson(path) {
    if (typeof this._vfs.exists === "function") {
      const exists = await this._vfs.exists(path);
      if (!exists) return null;
    }

    let bytes;
    try {
      bytes = await this._vfs.readFile(path);
    } catch (err) {
      if (isMissingPathError(err)) return null;
      throw err;
    }

    const text = decoder.decode(bytes);
    return JSON.parse(text);
  }

  async _writeJson(path, value) {
    const json = JSON.stringify(value);
    const bytes = encoder.encode(json);
    await this._vfs.writeFile(path, bytes);
  }

  _serializeIndex() {
    return {
      schemaVersion: "0.1",
      runId: this._runId,
      updatedAt: Date.now(),
      timeline: Array.isArray(this._index.timeline) ? this._index.timeline : [],
      keywords: Array.from(this._index.keywords.entries()).map(([k, set]) => [k, Array.from(set || [])]),
      stages: Array.from(this._index.stages.entries()),
      hashIndex: Array.from(this._index.hashIndex.entries()),
      checkpointIndex: Array.isArray(this._checkpointIndex) ? this._checkpointIndex : [],
    };
  }

  /**
   * Initialize storage: create directories and restore index from VFS.
   * @returns {Promise<void>}
   */
  async init() {
    this._ensureNotDisposed();
    if (this._initialized) return;

    await this._ensureDirs();
    await this.restoreIndex();
    await this._attachTabCoordinator();
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

    const hooks = ensureTabCoordinatorHooks(coordinator);
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
    const id = toNonEmptyString(snapshotId);
    if (!id) return;

    this._snapshotCache.delete(id);

    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    this._index.timeline = timeline.filter((e) => e?.id !== id);

    for (const [, idSet] of this._index.keywords) {
      idSet.delete(id);
    }

    for (const [stage, snapId] of this._index.stages) {
      if (snapId === id) {
        this._index.stages.delete(stage);
      }
    }

    for (const [hash, snapId] of this._index.hashIndex) {
      if (snapId === id) {
        this._index.hashIndex.delete(hash);
      }
    }
  }

  /**
   * Update local LRU access timestamp for snapshots touched by another tab.
   * @private
   * @param {string} snapshotId
   * @returns {void}
   */
  _handleRemoteAccess(snapshotId) {
    if (this.disposed) return;
    const id = toNonEmptyString(snapshotId);
    if (!id) return;

    const timelineEntry = this._index.timeline.find((e) => e?.id === id);
    if (timelineEntry) {
      timelineEntry.accessedAt = Date.now();
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

    await this._writeJson(this._snapshotPath(id), entry);
    this._snapshotCache.set(id, entry);

    for (const kw of normalizedKeywords) {
      if (!this._index.keywords.has(kw)) this._index.keywords.set(kw, new Set());
      this._index.keywords.get(kw).add(id);
    }

    if (stage) this._index.stages.set(stage, id);
    // Include accessedAt for LRU tracking (initialized to ts)
    this._index.timeline.push({ id, ts, accessedAt: ts, summary: entry.summary, stageKey: stage || undefined });
    this._index.hashIndex.set(contentHash, id);

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

    const snapId = toNonEmptyString(id);
    if (!snapId) return null;

    // Update accessedAt in timeline for LRU tracking
    const timelineEntry = this._index.timeline.find((e) => e?.id === snapId);
    if (timelineEntry) {
      timelineEntry.accessedAt = Date.now();
      // Persist is deferred (not blocking getSnapshot)
    }

    const cached = this._snapshotCache.get(snapId);
    if (cached) {
      this._broadcastAccess(snapId);
      return cached;
    }

    const entry = await this._readJson(this._snapshotPath(snapId));
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
    const existingId = toNonEmptyString(base.id);

    const id = existingId || "ckpt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const ts = typeof base.ts === "number" && Number.isFinite(base.ts) ? base.ts : Date.now();

    const checkpoint = { ...base, id, ts, runId: toNonEmptyString(base.runId) || this._runId };
    await this._writeJson(this._checkpointPath(id), checkpoint);
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

    const ckptId = toNonEmptyString(id);
    if (!ckptId) return null;

    const cached = this._checkpointCache.get(ckptId);
    if (cached) return cached;

    const checkpoint = await this._readJson(this._checkpointPath(ckptId));
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
    const id = toNonEmptyString(last?.id);
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
    await this._ensureDirs();

    const indexPath = this._indexPath();
    const tempPath = this._indexTmpPath();
    const data = this._serializeIndex();
    const json = JSON.stringify(data);
    const bytes = encoder.encode(json);

    // Step 1: Write to temporary file
    await this._vfs.writeFile(tempPath, bytes);

    // Step 2: Atomic rename if VFS supports it
    if (typeof this._vfs.rename === "function") {
      await this._vfs.rename(tempPath, indexPath);
    } else {
      // Fallback: write to target, then remove temp
      await this._vfs.writeFile(indexPath, bytes);
      try {
        if (typeof this._vfs.unlink === "function") {
          await this._vfs.unlink(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Restore index (timeline/keywords/stages + checkpoint metadata) from VFS.
   * Checks for incomplete writes (.tmp file) and recovers if needed.
   * @returns {Promise<void>}
   */
  async restoreIndex() {
    this._ensureNotDisposed();
    await this._ensureDirs();

    const indexPath = this._indexPath();
    const tempPath = this._indexTmpPath();

    // Recovery: check for orphaned .tmp file from interrupted write
    let tempExists = false;
    if (typeof this._vfs.exists === "function") {
      tempExists = await this._vfs.exists(tempPath);
    } else {
      try {
        await this._vfs.readFile(tempPath);
        tempExists = true;
      } catch {
        tempExists = false;
      }
    }

    if (tempExists) {
      // Attempt to recover from temp file
      let tempData = null;
      try {
        tempData = await this._readJson(tempPath);
      } catch {
        // Parse error - treat as corrupted
        tempData = null;
      }

      if (tempData && typeof tempData === "object") {
        // Temp file is valid - complete the interrupted atomic write
        if (typeof this._vfs.rename === "function") {
          await this._vfs.rename(tempPath, indexPath);
        } else {
          const json = JSON.stringify(tempData);
          const bytes = encoder.encode(json);
          await this._vfs.writeFile(indexPath, bytes);
          try {
            if (typeof this._vfs.unlink === "function") {
              await this._vfs.unlink(tempPath);
            }
          } catch {
            // Ignore cleanup errors
          }
        }
      } else {
        // Temp file is corrupted - remove it
        try {
          if (typeof this._vfs.unlink === "function") {
            await this._vfs.unlink(tempPath);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    const raw = await this._readJson(indexPath);
    if (!raw || typeof raw !== "object") return;

    const timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
    const keywordEntries = Array.isArray(raw.keywords) ? raw.keywords : [];
    const stageEntries = Array.isArray(raw.stages) ? raw.stages : [];
    const hashIndexEntries = Array.isArray(raw.hashIndex) ? raw.hashIndex : [];
    const checkpointIndex = Array.isArray(raw.checkpointIndex)
      ? raw.checkpointIndex
      : Array.isArray(raw.checkpoints)
        ? raw.checkpoints
        : [];

    this._index.timeline = timeline;
    this._index.keywords = new Map(
      keywordEntries
        .filter((e) => Array.isArray(e) && typeof e[0] === "string")
        .map(([k, ids]) => [k, new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [])])
    );
    this._index.stages = new Map(
      stageEntries.filter((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string")
    );
    this._index.hashIndex = new Map(
      hashIndexEntries.filter((e) => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string")
    );
    this._checkpointIndex = checkpointIndex;
  }

  /**
   * Estimate total storage bytes used by snapshots.
   * Uses summary length as proxy (actual file size varies).
   * @private
   * @returns {number}
   */
  _estimateStorageBytes() {
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    let bytes = 0;
    for (const entry of timeline) {
      const summaryLen = typeof entry?.summary === "string" ? entry.summary.length : 0;
      bytes += ENTRY_OVERHEAD_BYTES + summaryLen * BYTES_PER_CHAR;
    }
    return bytes;
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
    const bytes = this._estimateStorageBytes();
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
      const currentBytes = this._estimateStorageBytes();
      if (currentCount <= this._maxSnapshots && currentBytes <= this._maxStorageBytes) break;

      const id = entry?.id;
      if (!id) continue;

      // Remove from VFS
      try {
        if (typeof this._vfs.unlink === "function") {
          await this._vfs.unlink(this._snapshotPath(id));
        }
      } catch {
        // Ignore removal errors
      }

      // Remove from indexes
      this._snapshotCache.delete(id);
      this._index.timeline = this._index.timeline.filter((e) => e?.id !== id);

      // Remove from keyword index
      for (const [, idSet] of this._index.keywords) {
        idSet.delete(id);
      }

      // Remove from stages if this was the latest
      for (const [stage, snapId] of this._index.stages) {
        if (snapId === id) {
          this._index.stages.delete(stage);
        }
      }

      // Remove from hashIndex
      for (const [hash, snapId] of this._index.hashIndex) {
        if (snapId === id) {
          this._index.hashIndex.delete(hash);
        }
      }

      evicted.push(id);
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
      estimatedBytes: this._estimateStorageBytes(),
      maxSnapshots: this._maxSnapshots,
      maxStorageBytes: this._maxStorageBytes,
    };
  }

  /** @returns {number} */
  get supersededSnapshotCount() {
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    let count = 0;
    for (const entry of timeline) {
      if (entry && typeof entry === "object" && entry.superseded === true) {
        count += 1;
      }
    }
    return count;
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

    const id = toNonEmptyString(snapshotId);
    if (!id) return false;

    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    const entry = timeline.find((e) => e?.id === id);
    if (!entry) return false;

    const correctionText = typeof correction === "string" ? correction : String(correction ?? "");
    const wasSuperseded = entry.superseded === true;
    entry.superseded = true;
    entry.supersededBy = correctionText;

    const cached = this._snapshotCache.get(id);
    if (cached && typeof cached === "object") {
      cached.superseded = true;
      cached.supersededBy = correctionText;
      await this._writeJson(this._snapshotPath(id), cached);
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

    const correctionText = typeof correction === "string" ? correction : String(correction ?? "");
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    let marked = 0;
    let touched = false;

    for (const rawId of list) {
      const id = toNonEmptyString(rawId);
      if (!id) continue;
      const entry = timeline.find((e) => e?.id === id);
      if (!entry) continue;
      const wasSuperseded = entry.superseded === true;
      entry.superseded = true;
      entry.supersededBy = correctionText;
      if (!wasSuperseded) marked += 1;
      touched = true;

      const cached = this._snapshotCache.get(id);
      if (cached && typeof cached === "object") {
        cached.superseded = true;
        cached.supersededBy = correctionText;
        await this._writeJson(this._snapshotPath(id), cached);
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
    const includeSuperseded = options?.includeSuperseded === true;
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    const filtered = includeSuperseded
      ? timeline
      : timeline.filter((e) => !(e && typeof e === "object" && e.superseded === true));
    return filtered.map((e) => (e && typeof e === "object" ? { ...e } : e));
  }

  /**
   * Return only superseded timeline entries (metadata only).
   * @returns {L3TimelineEntry[]}
   */
  getSupersededTimeline() {
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    return timeline
      .filter((e) => e && typeof e === "object" && e.superseded === true)
      .map((e) => ({ ...e }));
  }

  /**
   * Search archived snapshot IDs by keyword (index-only, sync).
   * @param {string} keyword
   * @param {L3TimelineOptions} [options]
   * @returns {string[]} Snapshot IDs
   */
  searchByKeyword(keyword, options = {}) {
    const k = typeof keyword === "string" ? keyword.trim().toLowerCase() : "";
    if (!k) return [];
    const ids = this._index.keywords.get(k);
    if (!ids) return [];
    const list = Array.from(ids || []);
    const includeSuperseded = options?.includeSuperseded === true;
    if (includeSuperseded) return list;

    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    if (timeline.length === 0) return list;

    const supersededIds = new Set();
    for (const entry of timeline) {
      const id = typeof entry?.id === "string" ? entry.id : null;
      if (id && entry && typeof entry === "object" && entry.superseded === true) {
        supersededIds.add(id);
      }
    }

    return list.filter((id) => !supersededIds.has(id));
  }

  /**
   * Check if data would be deduplicated (without archiving).
   * @param {any} data
   * @returns {{ duplicate: boolean, existingId?: string }}
   */
  isDuplicate(data) {
    const contentHash = computeContentHash(data);
    if (this._index.hashIndex.has(contentHash)) {
      return { duplicate: true, existingId: this._index.hashIndex.get(contentHash) };
    }
    return { duplicate: false };
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
