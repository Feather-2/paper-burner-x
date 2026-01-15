import LRUCache from "../../shared/utils/lru-cache.js";
import DisposableBase from "../../shared/base/disposable-base.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toNonEmptyString(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
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

/**
 * L3Storage - L3 cold storage for MemoryStore.
 *
 * Persists snapshots + checkpoints to VFS, keeping only:
 * - index metadata
 * - a small LRU cache of recent snapshots/checkpoints
 */
export class L3Storage extends DisposableBase {
  /**
   * @param {object} options
   * @param {any} options.vfs - VFS instance (required)
   * @param {string} options.runId - Run ID (required)
   * @param {number} [options.cacheSize=10] - Snapshot LRU cache size
   * @param {number} [options.checkpointCacheSize=5] - Checkpoint LRU cache size
   */
  constructor(options) {
    super();

    const o = options && typeof options === "object" ? options : {};
    const vfs = o.vfs;
    const runId = toNonEmptyString(o.runId);
    if (!vfs || typeof vfs !== "object") throw new Error("L3Storage requires { vfs }");
    if (!runId) throw new Error("L3Storage requires { runId }");
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

    /** @private */
    this._vfs = vfs;
    /** @private */
    this._runId = runId;
    /** @private */
    this._basePath = `.agents/runs/${runId}/l3`;

    /** @private */
    this._snapshotCache = new LRUCache({ maxSize: cacheSize });
    /** @private */
    this._checkpointCache = new LRUCache({ maxSize: checkpointCacheSize });

    /** @private */
    this._index = {
      timeline: [],
      keywords: new Map(), // keyword -> Set<snapshotId>
      stages: new Map(), // stageKey -> snapshotId (latest)
    };

    /** @private */
    this._checkpointIndex = [];

    /** @private */
    this._initialized = false;
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
    this._initialized = true;
  }

  /**
   * Archive a snapshot to VFS and update the in-memory index.
   * @param {string} stageKey
   * @param {any} data
   * @param {string[]} [keywords=[]]
   * @returns {Promise<string>} Snapshot ID
   */
  async archive(stageKey, data, keywords = []) {
    this._ensureNotDisposed();
    await this.init();

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
      data,
    };

    await this._writeJson(this._snapshotPath(id), entry);
    this._snapshotCache.set(id, entry);

    for (const kw of normalizedKeywords) {
      if (!this._index.keywords.has(kw)) this._index.keywords.set(kw, new Set());
      this._index.keywords.get(kw).add(id);
    }

    if (stage) this._index.stages.set(stage, id);
    this._index.timeline.push({ id, ts, summary: entry.summary, stageKey: stage || undefined });

    await this.persistIndex();
    return id;
  }

  /**
   * Fetch a snapshot by ID (cache-first).
   * @param {string} id
   * @returns {Promise<any | null>}
   */
  async getSnapshot(id) {
    this._ensureNotDisposed();
    await this.init();

    const snapId = toNonEmptyString(id);
    if (!snapId) return null;

    const cached = this._snapshotCache.get(snapId);
    if (cached) return cached;

    const entry = await this._readJson(this._snapshotPath(snapId));
    if (!entry) return null;

    this._snapshotCache.set(snapId, entry);
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
    this._checkpointIndex = checkpointIndex;
  }

  /**
   * Return the current timeline (metadata only).
   * @returns {Array<{id: string, ts: number, summary?: string, stageKey?: string}>}
   */
  getTimeline() {
    const timeline = Array.isArray(this._index.timeline) ? this._index.timeline : [];
    return timeline.map((e) => (e && typeof e === "object" ? { ...e } : e));
  }

  /**
   * Search archived snapshot IDs by keyword (index-only, sync).
   * @param {string} keyword
   * @returns {string[]} Snapshot IDs
   */
  searchByKeyword(keyword) {
    const k = typeof keyword === "string" ? keyword.trim().toLowerCase() : "";
    if (!k) return [];
    const ids = this._index.keywords.get(k);
    if (!ids) return [];
    return Array.from(ids || []);
  }

  /**
   * Dispose storage: best-effort persist index and clear caches.
   * @returns {Promise<void>}
   */
  async dispose() {
    if (this.disposed) return;
    try {
      await this.persistIndex();
    } catch (err) {
      console.warn("[L3Storage] persistIndex() failed during dispose:", err);
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

