import { createLogger } from "../shared/utils/logger.js";
import { isPlainObject } from "../shared/utils/value-utils.js";
import { safeJsonParse } from "../shared/utils/safe-json.js";

const logger = createLogger("storage/run-store");

const DB_NAME = "AgentRuntimeDB";
const DB_VERSION = 2;

const STORE_RUNS = "runs";
const STORE_ARTIFACTS = "artifacts";
const STORE_EVENTS = "events";
const STORE_COUNTERS = "counters";

const DAY_MS = 24 * 60 * 60 * 1000;

function hasIndexedDB() {
  return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

function toISO(d = new Date()) {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function encodeUtf8Bytes(text) {
  if (typeof text !== "string") return undefined;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length;
  }
}

function parseIsoMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeRetentionConfig(config) {
  const c = isPlainObject(config) ? config : {};
  const maxRunsRaw = c.maxRuns;
  const maxAgeDaysRaw = c.maxAgeDays;
  const maxTotalBytesRaw = c.maxTotalBytes ?? c.maxBytes;

  const maxRuns =
    typeof maxRunsRaw === "number" && Number.isFinite(maxRunsRaw) && maxRunsRaw > 0 ? Math.floor(maxRunsRaw) : null;
  const maxAgeDays =
    typeof maxAgeDaysRaw === "number" && Number.isFinite(maxAgeDaysRaw) && maxAgeDaysRaw > 0 ? maxAgeDaysRaw : null;
  const maxTotalBytes =
    typeof maxTotalBytesRaw === "number" && Number.isFinite(maxTotalBytesRaw) && maxTotalBytesRaw > 0
      ? Math.floor(maxTotalBytesRaw)
      : null;

  const enabled = c.enabled === undefined ? null : !!c.enabled;
  const keepPinned = c.keepPinned === undefined ? true : !!c.keepPinned;
  const pinnedKey = typeof c.pinnedKey === "string" && c.pinnedKey.trim() ? c.pinnedKey.trim() : "pinned";

  return { enabled, maxRuns, maxAgeDays, maxTotalBytes, keepPinned, pinnedKey };
}

function isPinnedRunContext(ctx, pinnedKey = "pinned") {
  const key = typeof pinnedKey === "string" && pinnedKey ? pinnedKey : "pinned";
  if (!ctx || typeof ctx !== "object") return false;
  if (ctx[key] === true) return true;
  if (ctx.retention && typeof ctx.retention === "object" && ctx.retention[key] === true) return true;
  return false;
}

async function deleteByIndexKey(store, indexName, key) {
  const index = store.index(indexName);
  const req = index.openCursor(key);
  await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = async () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      cursor.delete();
      cursor.continue();
    };
  });
}

async function getLastByCompoundIndex(store, indexName, range) {
  const index = store.index(indexName);
  const req = index.openCursor(range, "prev");
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      resolve(cursor ? cursor.value : null);
    };
  });
}

function ensureObjectStore(db, name, options) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, options);
  }
}

function ensureIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

export class RunStore {
  constructor({
    dbName = DB_NAME,
    dbVersion = DB_VERSION,
    storageAdapter,
    prefix = "deepsearch:run:",
    quotaWarnRatio = 0.1,
    quotaCheckIntervalMs = 60_000,
    onQuotaWarning,
    retention,
    autoCleanup,
  } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
    this.storage = storageAdapter;
    this.prefix = prefix;
    this._quotaWarnRatio = typeof quotaWarnRatio === "number" && Number.isFinite(quotaWarnRatio) ? Math.max(0, quotaWarnRatio) : 0.1;
    this._quotaCheckIntervalMs =
      typeof quotaCheckIntervalMs === "number" && Number.isFinite(quotaCheckIntervalMs) ? Math.max(0, Math.floor(quotaCheckIntervalMs)) : 60_000;
    this._onQuotaWarning = typeof onQuotaWarning === "function" ? onQuotaWarning : null;
    this._lastQuotaCheckMs = 0;
    this._lastQuotaInfo = null;
    this._lastQuotaWarnMs = 0;

    this._retention = normalizeRetentionConfig(retention);
    this._autoCleanup = normalizeRetentionConfig(autoCleanup);
    this._lastCleanupMs = 0;
    this._cleanupPromise = null;
  }

  async open() {
    if (this.storage) return null;
    if (this._dbp) return this._dbp;
    if (!hasIndexedDB()) {
      throw new Error("IndexedDB is not available in this environment");
    }

    this._dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = req.transaction;

        ensureObjectStore(db, STORE_RUNS, { keyPath: "runId" });
        ensureObjectStore(db, STORE_ARTIFACTS, { keyPath: "artifactId" });
        ensureObjectStore(db, STORE_EVENTS, { keyPath: "eventId" });
        ensureObjectStore(db, STORE_COUNTERS, { keyPath: ["runId", "type"] });

        const runsStore = tx.objectStore(STORE_RUNS);
        ensureIndex(runsStore, "byCreatedAt", "createdAt", { unique: false });

        const artifactsStore = tx.objectStore(STORE_ARTIFACTS);
        ensureIndex(artifactsStore, "byRunId", "runId", { unique: false });
        ensureIndex(artifactsStore, "byRunIdTypeSeq", ["runId", "type", "seq"], { unique: false });

        const eventsStore = tx.objectStore(STORE_EVENTS);
        ensureIndex(eventsStore, "byRunId", "runId", { unique: false });
        ensureIndex(eventsStore, "byRunIdTs", ["runId", "ts"], { unique: false });

        const countersStore = tx.objectStore(STORE_COUNTERS);
        ensureIndex(countersStore, "byRunId", "runId", { unique: false });
      };

      req.onsuccess = () => resolve(req.result);
      req.onblocked = () => {
        try {
          logger.warn(`[RunStore] IndexedDB open blocked for ${this.dbName}@v${this.dbVersion}`);
        } catch {
          // ignore
        }
      };
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      // If open fails, clear the cached promise so callers can retry later.
      this._dbp = null;
      throw err;
    });

    return this._dbp;
  }

  async close() {
    if (!this._dbp) return;
    const db = await this._dbp;
    if (db) db.close();
    this._dbp = null;
  }

  _keyForTask(taskId) {
    return this.prefix + taskId;
  }

  _keyForState(runId) {
    return this.prefix + runId + ":state";
  }

  _keyForArtifact(runId, name) {
    return this.prefix + runId + ":artifact:" + name;
  }

  _keyForManifest(runId) {
    return this.prefix + runId + ":manifest";
  }

  async saveTask(task) {
    if (!task || typeof task !== "object") throw new Error("saveTask(task): task must be an object");
    const taskId = task.taskId;
    if (!taskId || typeof taskId !== "string") throw new Error("saveTask(task): task.taskId must be a string");

    if (this.storage?.set) {
      await this.storage.set(this._keyForTask(taskId), JSON.stringify(task));
      return;
    }

    await this.saveArtifact(taskId, "task.json", task, {
      artifactId: `task_${taskId}`,
      storageKey: `runs/${taskId}/task.json`,
      seq: 1,
      mime: "application/json",
    });
  }

  async loadTask(taskId) {
    if (!taskId || typeof taskId !== "string") throw new Error("loadTask(taskId): taskId must be a string");

    if (this.storage?.get) {
      const data = await this.storage.get(this._keyForTask(taskId));
      return data ? safeJsonParse(data, null) : null;
    }

    const data = await this.getArtifact(taskId, "task.json");
    if (data === null || data === undefined) return null;
    return typeof data === "string" ? safeJsonParse(data, null) : data;
  }

  async saveState(runId, state) {
    if (!runId || typeof runId !== "string") throw new Error("saveState(runId, state): runId must be a string");
    const payload = state && typeof state.toJSON === "function" ? state.toJSON() : state;

    if (this.storage?.set) {
      await this.storage.set(this._keyForState(runId), JSON.stringify(payload));
      return;
    }

    await this.saveArtifact(runId, "state.json", payload, {
      artifactId: `state_${runId}`,
      storageKey: `runs/${runId}/state.json`,
      seq: 1,
      mime: "application/json",
    });
  }

  async loadState(runId) {
    if (!runId || typeof runId !== "string") throw new Error("loadState(runId): runId must be a string");

    if (this.storage?.get) {
      const data = await this.storage.get(this._keyForState(runId));
      return data ? safeJsonParse(data, null) : null;
    }

    const data = await this.getArtifact(runId, "state.json");
    if (data === null || data === undefined) return null;
    return typeof data === "string" ? safeJsonParse(data, null) : data;
  }

  async estimateQuota() {
    try {
      const estimate = globalThis?.navigator?.storage?.estimate;
      if (typeof estimate !== "function") return { supported: false };
      const out = await estimate.call(globalThis.navigator.storage);
      return {
        supported: true,
        quota: typeof out?.quota === "number" ? out.quota : undefined,
        usage: typeof out?.usage === "number" ? out.usage : undefined,
      };
    } catch (err) {
      return { supported: false, error: String(err?.message || err) };
    }
  }

  async _maybeWarnQuota({ upcomingBytes = 0, runId, type } = {}) {
    const ratio = this._quotaWarnRatio;
    if (!(ratio > 0)) return;

    const now = Date.now();
    const minInterval = this._quotaCheckIntervalMs;
    const cachedOk = this._lastQuotaInfo && minInterval > 0 && now - this._lastQuotaCheckMs < minInterval;

    const info = cachedOk ? this._lastQuotaInfo : await this.estimateQuota();
    if (!cachedOk) {
      this._lastQuotaInfo = info;
      this._lastQuotaCheckMs = now;
    }

    if (!info || info.supported !== true) return;
    if (typeof info.quota !== "number" || typeof info.usage !== "number") return;

    const quota = info.quota;
    const usage = info.usage;
    if (!(quota > 0) || !(usage >= 0)) return;

    const upcoming = typeof upcomingBytes === "number" && Number.isFinite(upcomingBytes) ? Math.max(0, upcomingBytes) : 0;
    const remaining = quota - usage - upcoming;
    const remainingRatio = remaining / quota;

    if (remainingRatio >= ratio) return;

    // Throttle warnings (avoid spamming during batch writes).
    const warnInterval = Math.max(10_000, minInterval || 0);
    if (now - this._lastQuotaWarnMs < warnInterval) return;
    this._lastQuotaWarnMs = now;

    const payload = {
      runId: typeof runId === "string" ? runId : undefined,
      type: typeof type === "string" ? type : undefined,
      quota,
      usage,
      upcomingBytes: upcoming,
      remaining,
      remainingRatio,
      warnRatio: ratio,
    };

    if (this._onQuotaWarning) {
      try {
        this._onQuotaWarning(payload);
        return;
      } catch {
        // fall through to console
      }
    }

    try {
      logger.warn("[RunStore] Storage quota low; consider exporting/cleaning old runs", payload);
    } catch {
      // ignore
    }

    // Optional: auto cleanup when quota is low (best-effort, throttled).
    const auto = this._autoCleanup;
    const enabled = auto.enabled === null ? false : auto.enabled;
    if (!enabled) return;

    const nowMs = Date.now();
    const minIntervalMs = Math.max(10_000, this._quotaCheckIntervalMs || 0);
    if (nowMs - this._lastCleanupMs < minIntervalMs) return;
    if (this._cleanupPromise) return;

    this._cleanupPromise = Promise.resolve()
      .then(() =>
        this.cleanupRuns({
          retention: auto,
          keepRunIds: typeof runId === "string" && runId ? [runId] : [],
          reason: "quota_low",
        })
      )
      .catch((err) => logger.warn("Store cleanup error", { error: err.message }))
      .finally(() => {
        this._cleanupPromise = null;
        this._lastCleanupMs = Date.now();
      });
  }

  /**
   * Update retention policy (housekeeping configuration).
   * @param {object} retention
   */
  setRetentionPolicy(retention) {
    this._retention = normalizeRetentionConfig(retention);
    return this._retention;
  }

  /**
   * List run records (metadata) in IndexedDB mode.
   *
   * @param {object} [options]
   * @param {"asc"|"desc"} [options.order="desc"]
   * @param {boolean} [options.includeContext=false]
   * @returns {Promise<Array<{runId:string,createdAt:string,updatedAt:string,manifest:any,runContext?:any}>>}
   */
  async listRunRecords({ order = "desc", includeContext = false } = {}) {
    if (this.storage) return [];
    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readonly");
    const store = tx.objectStore(STORE_RUNS);
    const index = store.index("byCreatedAt");
    const direction = order === "asc" ? "next" : "prev";

    const rows = [];
    const req = index.openCursor(null, direction);
    await new Promise((resolve, reject) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const value = cursor.value;
        if (value && typeof value === "object") {
          rows.push({
            runId: String(value.runId),
            createdAt: String(value.createdAt || ""),
            updatedAt: String(value.updatedAt || ""),
            manifest: value.manifest ?? null,
            ...(includeContext ? { runContext: value.runContext } : {}),
          });
        }
        cursor.continue();
      };
    });

    await promisifyTransaction(tx);
    return rows;
  }

  async _estimateRunBytes(runId, { estimateObjectBytes = false } = {}) {
    if (this.storage) return null;
    const id = typeof runId === "string" ? runId.trim() : "";
    if (!id) return null;

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const index = store.index("byRunId");
    const req = index.openCursor(IDBKeyRange.only(id));

    let total = 0;
    await new Promise((resolve, reject) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        const rec = cursor.value;

        let bytes = typeof rec?.bytes === "number" && Number.isFinite(rec.bytes) ? rec.bytes : null;
        if (bytes === null) {
          const data = rec?.data;
          if (typeof Blob !== "undefined" && data instanceof Blob) bytes = data.size;
          else if (typeof data === "string") bytes = encodeUtf8Bytes(data) ?? data.length;
          else if (data && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) bytes = data.byteLength;
          else if (estimateObjectBytes && (isPlainObject(data) || Array.isArray(data))) {
            try {
              bytes = encodeUtf8Bytes(JSON.stringify(data)) ?? null;
            } catch {
              bytes = null;
            }
          }
        }

        if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) total += bytes;
        cursor.continue();
      };
    });

    await promisifyTransaction(tx);
    return total;
  }

  _estimateRunBytesFromManifest(manifest) {
    const m = manifest && typeof manifest === "object" ? manifest : null;
    if (!m || !Array.isArray(m.artifacts)) return null;
    let total = 0;
    let hasAny = false;
    for (const a of m.artifacts) {
      const bytes = typeof a?.bytes === "number" && Number.isFinite(a.bytes) ? a.bytes : null;
      if (bytes === null) continue;
      hasAny = true;
      total += Math.max(0, bytes);
    }
    return hasAny ? total : null;
  }

  /**
   * Housekeeping: delete old runs by retention policy.
   *
   * Safe defaults:
   * - Does nothing unless at least one retention knob is set (maxRuns/maxAgeDays/maxTotalBytes)
   * - Keeps "pinned" runs when `keepPinned` is true (default)
   *
   * @param {object} [options]
   * @param {object} [options.retention] Override the store retention policy for this call
   * @param {string[]} [options.keepRunIds] Run IDs that must not be deleted (e.g. current run)
   * @param {boolean} [options.dryRun=false]
   * @param {boolean} [options.estimateObjectBytes=false] Whether to JSON.stringify object payloads when estimating size
   * @param {string} [options.reason]
   * @returns {Promise<{deletedRunIds:string[],keptRunIds:string[],plannedDeleteRunIds:string[],bytesBefore?:number,bytesAfter?:number,reason?:string}>}
   */
  async cleanupRuns(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    const retention = normalizeRetentionConfig(opts.retention ?? this._retention);
    const { enabled, maxRuns, maxAgeDays, maxTotalBytes, keepPinned, pinnedKey } = retention;
    const dryRun = !!opts.dryRun;
    const estimateObjectBytes = opts.estimateObjectBytes === true;

    if (enabled === false) {
      const records = await this.listRunRecords({ order: "desc", includeContext: false });
      return {
        deletedRunIds: [],
        keptRunIds: records.map((r) => String(r.runId)).filter(Boolean),
        plannedDeleteRunIds: [],
        ...(opts.reason ? { reason: String(opts.reason) } : {}),
      };
    }

    if (!maxRuns && !maxAgeDays && !maxTotalBytes) {
      return { deletedRunIds: [], keptRunIds: [], plannedDeleteRunIds: [], ...(opts.reason ? { reason: String(opts.reason) } : {}) };
    }

    const keepRunIds = new Set(Array.isArray(opts.keepRunIds) ? opts.keepRunIds.map(String).filter(Boolean) : []);

    const records = await this.listRunRecords({ order: "desc", includeContext: keepPinned });

    const pinned = new Set();
    if (keepPinned) {
      for (const r of records) {
        if (!r || typeof r !== "object") continue;
        if (keepRunIds.has(r.runId)) continue;
        if (isPinnedRunContext(r.runContext, pinnedKey)) pinned.add(r.runId);
      }
    }

    const nowMs = Date.now();
    const cutoffMs = maxAgeDays ? nowMs - maxAgeDays * DAY_MS : null;

    const candidates = records
      .map((r) => ({
        runId: r.runId,
        createdAt: r.createdAt,
        createdAtMs: parseIsoMs(r.createdAt) ?? 0,
        manifest: r.manifest ?? null,
      }))
      .filter((r) => r.runId && !keepRunIds.has(r.runId) && !pinned.has(r.runId));

    const deleteSet = new Set();

    if (cutoffMs !== null) {
      for (const r of candidates) {
        const ms = r.createdAtMs || 0;
        if (ms > 0 && ms < cutoffMs) deleteSet.add(r.runId);
      }
    }

    if (maxRuns) {
      const keep = candidates
        .filter((r) => !deleteSet.has(r.runId))
        .slice(0, maxRuns)
        .map((r) => r.runId);
      const keepSet = new Set(keep);
      for (const r of candidates) {
        if (deleteSet.has(r.runId)) continue;
        if (!keepSet.has(r.runId)) deleteSet.add(r.runId);
      }
    }

    let bytesBefore = undefined;
    let bytesAfter = undefined;

    if (maxTotalBytes) {
      const byRunId = new Map();
      for (const r of candidates) byRunId.set(r.runId, r);

      const estimateBytes = async (runId) => {
        const rec = byRunId.get(runId);
        const fromManifest = rec ? this._estimateRunBytesFromManifest(rec.manifest) : null;
        if (typeof fromManifest === "number") return fromManifest;
        const fromStore = await this._estimateRunBytes(runId, { estimateObjectBytes });
        return typeof fromStore === "number" ? fromStore : 0;
      };

      // Compute sizes for kept (including pinned + protected) and for deletable candidates, oldest-first pruning.
      const allKeepIds = new Set([...pinned, ...keepRunIds]);
      const keepCandidates = records.map((r) => String(r.runId)).filter(Boolean);

      const sizes = new Map();
      for (const runId of keepCandidates) {
        if (!runId) continue;
        if (deleteSet.has(runId)) continue;
        sizes.set(runId, await estimateBytes(runId));
      }

      bytesBefore = 0;
      for (const v of sizes.values()) bytesBefore += typeof v === "number" && Number.isFinite(v) ? v : 0;

      // Remove oldest runs until total <= maxTotalBytes.
      let total = bytesBefore;
      if (total > maxTotalBytes) {
        // Order deletable candidates from oldest to newest.
        const deletableOrdered = candidates
          .filter((r) => !deleteSet.has(r.runId))
          .slice()
          .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
          .map((r) => r.runId);

        for (const runId of deletableOrdered) {
          if (total <= maxTotalBytes) break;
          if (allKeepIds.has(runId)) continue;
          deleteSet.add(runId);
          total -= sizes.get(runId) || 0;
        }
      }

      bytesAfter = bytesBefore;
      for (const runId of deleteSet.values()) {
        if (sizes.has(runId)) bytesAfter -= sizes.get(runId) || 0;
      }
    }

    const createdMsByRunId = new Map(candidates.map((r) => [String(r.runId), r.createdAtMs || 0]));
    const plannedDeleteRunIds = Array.from(deleteSet.values());
    plannedDeleteRunIds.sort((a, b) => {
      const rawAms = createdMsByRunId.get(String(a)) || 0;
      const rawBms = createdMsByRunId.get(String(b)) || 0;
      const ams = rawAms > 0 ? rawAms : Number.POSITIVE_INFINITY;
      const bms = rawBms > 0 ? rawBms : Number.POSITIVE_INFINITY;
      if (ams !== bms) return ams - bms;
      return String(a).localeCompare(String(b));
    });

    const keptRunIds = records.map((r) => String(r.runId)).filter(Boolean).filter((id) => !deleteSet.has(id));

    if (dryRun) {
      return {
        deletedRunIds: [],
        keptRunIds,
        plannedDeleteRunIds,
        ...(bytesBefore !== undefined ? { bytesBefore } : {}),
        ...(bytesAfter !== undefined ? { bytesAfter } : {}),
        ...(opts.reason ? { reason: String(opts.reason) } : {}),
      };
    }

    const deletedRunIds = [];
    for (const runId of plannedDeleteRunIds) {
      try {
        await this.deleteRun(runId);
        deletedRunIds.push(runId);
      } catch {
        // ignore individual delete errors
      }
    }

    const deletedSet = new Set(deletedRunIds);
    return {
      deletedRunIds,
      keptRunIds: records.map((r) => String(r.runId)).filter(Boolean).filter((id) => !deletedSet.has(id)),
      plannedDeleteRunIds,
      ...(bytesBefore !== undefined ? { bytesBefore } : {}),
      ...(bytesAfter !== undefined ? { bytesAfter } : {}),
      ...(opts.reason ? { reason: String(opts.reason) } : {}),
    };
  }

  async createRun(runContext) {
    const ctx = runContext && typeof runContext.toJSON === "function" ? runContext.toJSON() : runContext;
    const runId = ctx?.runId;
    if (!runId || typeof runId !== "string") {
      throw new Error("createRun(runContext): runContext.runId must be a string");
    }

    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readwrite");
    const store = tx.objectStore(STORE_RUNS);
    const now = toISO();
    store.put({
      runId,
      runContext: isPlainObject(ctx) ? ctx : { value: ctx },
      createdAt: now,
      updatedAt: now,
      manifest: null,
    });
    await promisifyTransaction(tx);
    return runId;
  }

  async getRun(runId) {
    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readonly");
    const store = tx.objectStore(STORE_RUNS);
    const rec = await promisifyRequest(store.get(runId));
    await promisifyTransaction(tx);
    return rec ? rec.runContext : null;
  }

  async updateRunContext(runId, patch, { replace = false } = {}) {
    const id = typeof runId === "string" ? runId.trim() : "";
    if (!id) throw new Error("updateRunContext(runId, patch): runId must be a non-empty string");

    if (this.storage) {
      throw new Error("updateRunContext is not supported when using a storageAdapter");
    }

    const nextPatch = patch && typeof patch.toJSON === "function" ? patch.toJSON() : patch;
    if (!nextPatch || typeof nextPatch !== "object") {
      throw new Error("updateRunContext(runId, patch): patch must be an object");
    }

    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readwrite");
    const store = tx.objectStore(STORE_RUNS);
    const existing = await promisifyRequest(store.get(id));
    if (!existing) {
      await promisifyTransaction(tx);
      throw new Error(`updateRunContext(runId, patch): run not found: ${id}`);
    }

    const current = isPlainObject(existing.runContext) ? existing.runContext : { value: existing.runContext };
    const patchObj = isPlainObject(nextPatch) ? nextPatch : { value: nextPatch };
    const merged = replace ? patchObj : { ...current, ...patchObj };
    if (typeof merged.runId === "string" && merged.runId !== id) merged.runId = id;
    if (merged.runId === undefined) merged.runId = id;

    store.put({
      ...existing,
      runContext: merged,
      updatedAt: toISO(),
    });
    await promisifyTransaction(tx);
    return merged;
  }

  async listRuns() {
    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readonly");
    const store = tx.objectStore(STORE_RUNS);
    const rows = await promisifyRequest(store.getAll());
    await promisifyTransaction(tx);

    return (rows || [])
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((r) => r.runContext);
  }

  async deleteRun(runId) {
    const db = await this.open();
    const tx = db.transaction([STORE_RUNS, STORE_ARTIFACTS, STORE_EVENTS, STORE_COUNTERS], "readwrite");

    const runsStore = tx.objectStore(STORE_RUNS);
    runsStore.delete(runId);

    const artifactsStore = tx.objectStore(STORE_ARTIFACTS);
    await deleteByIndexKey(artifactsStore, "byRunId", IDBKeyRange.only(runId));

    const eventsStore = tx.objectStore(STORE_EVENTS);
    await deleteByIndexKey(eventsStore, "byRunId", IDBKeyRange.only(runId));

    const countersStore = tx.objectStore(STORE_COUNTERS);
    await deleteByIndexKey(countersStore, "byRunId", IDBKeyRange.only(runId));

    await promisifyTransaction(tx);
  }

  async appendEvent(runId, event) {
    if (!event || typeof event !== "object") throw new Error("appendEvent(runId, event): event must be an object");
    if (!event.eventId || typeof event.eventId !== "string") throw new Error("appendEvent(runId, event): event.eventId must be a string");

    const db = await this.open();
    const tx = db.transaction([STORE_EVENTS], "readwrite");
    const store = tx.objectStore(STORE_EVENTS);

    const record = event.runId === runId ? event : { ...event, runId };
    store.put(record);

    await promisifyTransaction(tx);
    return record.eventId;
  }

  async appendEvents(runId, events = []) {
    if (!Array.isArray(events)) throw new Error("appendEvents(runId, events): events must be an array");
    if (events.length === 0) return 0;

    const db = await this.open();
    const tx = db.transaction([STORE_EVENTS], "readwrite");
    const store = tx.objectStore(STORE_EVENTS);
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      if (!event.eventId || typeof event.eventId !== "string") continue;
      const record = event.runId === runId ? event : { ...event, runId };
      store.put(record);
    }
    await promisifyTransaction(tx);
    return events.length;
  }

  async getEvents(runId) {
    const db = await this.open();
    const tx = db.transaction([STORE_EVENTS], "readonly");
    const store = tx.objectStore(STORE_EVENTS);
    const index = store.index("byRunIdTs");
    const range = IDBKeyRange.bound([runId, ""], [runId, "\uffff"]);
    const out = await promisifyRequest(index.getAll(range));
    await promisifyTransaction(tx);
    return out || [];
  }

  async saveArtifact(runId, type, data, options = {}) {
    if (!runId || typeof runId !== "string") throw new Error("saveArtifact(runId, type, data): runId must be a string");
    if (!type || typeof type !== "string") throw new Error("saveArtifact(runId, type, data): type must be a string");

    if (this.storage?.set) {
      const key = this._keyForArtifact(runId, type);
      await this.storage.set(key, typeof data === "string" ? data : JSON.stringify(data));
      return typeof options.artifactId === "string" ? options.artifactId : `art_${runId}_${type.replaceAll("/", "_")}_001`;
    }

    let bytes = options.bytes;
    if (typeof bytes !== "number") {
      if (typeof Blob !== "undefined" && data instanceof Blob) bytes = data.size;
      else if (typeof data === "string") bytes = encodeUtf8Bytes(data);
      else if (data && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) bytes = data.byteLength;
      // Avoid JSON.stringify() on potentially large objects by default (can stall the UI thread).
      // Callers that really need exact bytes can pass `bytes`, or opt-in via `estimateObjectBytes: true`.
      else if ((isPlainObject(data) || Array.isArray(data)) && options.estimateObjectBytes === true) {
        bytes = encodeUtf8Bytes(JSON.stringify(data));
      }
    }

    // Quota sentinel: best-effort warning before we start a write transaction.
    await this._maybeWarnQuota({ upcomingBytes: typeof bytes === "number" ? bytes : 0, runId, type });

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS, STORE_COUNTERS], "readwrite");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const counters = tx.objectStore(STORE_COUNTERS);

    const counterKey = [runId, type];
    const counterRec = await promisifyRequest(counters.get(counterKey));
    const lastSeq = typeof counterRec?.lastSeq === "number" && Number.isFinite(counterRec.lastSeq) ? counterRec.lastSeq : null;

    let nextSeq = typeof options.seq === "number" && Number.isFinite(options.seq) ? Math.floor(options.seq) : null;
    if (!nextSeq || nextSeq <= 0) {
      if (typeof lastSeq === "number" && lastSeq > 0) {
        nextSeq = lastSeq + 1;
      } else {
        // Seed from existing artifacts when counter is missing (upgrade/first write).
        const range = IDBKeyRange.bound([runId, type, 0], [runId, type, Number.MAX_SAFE_INTEGER]);
        const last = await getLastByCompoundIndex(store, "byRunIdTypeSeq", range);
        nextSeq = typeof last?.seq === "number" ? last.seq + 1 : 1;
      }
    }

    const updatedLastSeq = Math.max(typeof lastSeq === "number" && lastSeq > 0 ? lastSeq : 0, nextSeq);
    counters.put({ runId, type, lastSeq: updatedLastSeq, updatedAt: toISO() });

    const artifactId =
      typeof options.artifactId === "string"
        ? options.artifactId
        : `art_${runId}_${type.replaceAll("/", "_")}_${String(nextSeq).padStart(3, "0")}`;

    const createdAt = options.createdAt ? toISO(options.createdAt) : toISO();
    const mime =
      options.mime ||
      (type === "events.jsonl"
        ? "application/x-ndjson"
        : type.endsWith(".json")
          ? "application/json"
          : "application/octet-stream");

    const storageKey = options.storageKey || `runs/${runId}/${type}`;

    store.put({
      artifactId,
      runId,
      type,
      seq: nextSeq,
      createdAt,
      mime,
      ...(typeof bytes === "number" ? { bytes } : {}),
      ...(typeof options.sha256 === "string" ? { sha256: options.sha256 } : {}),
      storageKey,
      data,
    });

    await promisifyTransaction(tx);
    return artifactId;
  }

  async getArtifact(runId, type) {
    if (this.storage?.get) {
      const key = this._keyForArtifact(runId, type);
      return await this.storage.get(key);
    }

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const range = IDBKeyRange.bound([runId, type, 0], [runId, type, Number.MAX_SAFE_INTEGER]);
    const last = await getLastByCompoundIndex(store, "byRunIdTypeSeq", range);
    await promisifyTransaction(tx);

    if (last) return last.data;
    if (type === "events.jsonl") {
      const events = await this.getEvents(runId);
      return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
    }
    return null;
  }

  /**
   * Get raw artifact record by artifactId (IndexedDB mode only).
   * @param {string} artifactId
   * @returns {Promise<object|null>}
   */
  async getArtifactRecord(artifactId) {
    const id = typeof artifactId === "string" ? artifactId.trim() : "";
    if (!id) throw new Error("getArtifactRecord(artifactId): artifactId must be a non-empty string");
    if (this.storage) return null;

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const rec = await promisifyRequest(store.get(id));
    await promisifyTransaction(tx);
    return rec || null;
  }

  /**
   * Get artifact payload by artifactId (IndexedDB mode only).
   * @param {string} artifactId
   * @returns {Promise<any>}
   */
  async getArtifactById(artifactId) {
    const rec = await this.getArtifactRecord(artifactId);
    return rec ? rec.data : null;
  }

  async loadArtifact(runId, name) {
    return await this.getArtifact(runId, name);
  }

  async listArtifacts(runId) {
    if (this.storage) return [];
    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const index = store.index("byRunId");
    const rows = await promisifyRequest(index.getAll(IDBKeyRange.only(runId)));
    await promisifyTransaction(tx);
    return rows || [];
  }

  /**
   * List lightweight artifact summaries without loading full payloads.
   *
   * NOTE: This relies on `openKeyCursor` so values (including large `data`) are not fetched.
   * Returned items contain only `artifactId/runId/type/seq`.
   *
   * @param {string} runId
   * @param {object} [options]
   * @param {string} [options.type] Optional artifact type filter
   * @returns {Promise<Array<{artifactId:string,runId:string,type:string,seq:number}>>}
   */
  async listArtifactSummaries(runId, { type } = {}) {
    if (this.storage) return [];
    const id = typeof runId === "string" ? runId.trim() : "";
    if (!id) throw new Error("listArtifactSummaries(runId): runId must be a non-empty string");

    const typeFilter = typeof type === "string" ? type.trim() : "";

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const index = store.index("byRunIdTypeSeq");

    const range = typeFilter
      ? IDBKeyRange.bound([id, typeFilter, 0], [id, typeFilter, Number.MAX_SAFE_INTEGER])
      : IDBKeyRange.bound([id, "", 0], [id, "\uffff", Number.MAX_SAFE_INTEGER]);

    const out = [];
    const req = index.openKeyCursor(range);
    await new Promise((resolve, reject) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();

        const key = cursor.key;
        const primaryKey = cursor.primaryKey;
        const runKey = Array.isArray(key) ? key[0] : id;
        const typeKey = Array.isArray(key) ? key[1] : typeFilter;
        const seqKey = Array.isArray(key) ? key[2] : 0;

        out.push({
          artifactId: String(primaryKey),
          runId: String(runKey),
          type: String(typeKey),
          seq: typeof seqKey === "number" && Number.isFinite(seqKey) ? seqKey : 0,
        });

        cursor.continue();
      };
    });

    await promisifyTransaction(tx);
    return out;
  }

  /**
   * Get latest artifact summary for a given runId+type (highest seq).
   *
   * @param {string} runId
   * @param {string} type
   * @returns {Promise<{artifactId:string,runId:string,type:string,seq:number}|null>}
   */
  async getLatestArtifactSummary(runId, type) {
    if (this.storage) return null;
    const id = typeof runId === "string" ? runId.trim() : "";
    const t = typeof type === "string" ? type.trim() : "";
    if (!id) throw new Error("getLatestArtifactSummary(runId, type): runId must be a non-empty string");
    if (!t) throw new Error("getLatestArtifactSummary(runId, type): type must be a non-empty string");

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const index = store.index("byRunIdTypeSeq");
    const range = IDBKeyRange.bound([id, t, 0], [id, t, Number.MAX_SAFE_INTEGER]);

    const req = index.openKeyCursor(range, "prev");
    const cursor = await new Promise((resolve, reject) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });

    await promisifyTransaction(tx);

    if (!cursor) return null;
    const key = cursor.key;
    const seq = Array.isArray(key) ? key[2] : 0;
    return {
      artifactId: String(cursor.primaryKey),
      runId: Array.isArray(key) ? String(key[0]) : id,
      type: Array.isArray(key) ? String(key[1]) : t,
      seq: typeof seq === "number" && Number.isFinite(seq) ? seq : 0,
    };
  }

  async updateManifest(runId, manifest) {
    if (this.storage?.set) {
      await this.storage.set(this._keyForManifest(runId), JSON.stringify(manifest));
      return;
    }

    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readwrite");
    const store = tx.objectStore(STORE_RUNS);
    const existing = await promisifyRequest(store.get(runId));
    if (!existing) {
      await promisifyTransaction(tx);
      throw new Error(`updateManifest(runId, manifest): run not found: ${runId}`);
    }
    store.put({
      ...existing,
      manifest,
      updatedAt: toISO(),
    });
    await promisifyTransaction(tx);
  }

  async getManifest(runId) {
    if (this.storage?.get) {
      const data = await this.storage.get(this._keyForManifest(runId));
      return data ? JSON.parse(data) : null;
    }

    const db = await this.open();
    const tx = db.transaction([STORE_RUNS], "readonly");
    const store = tx.objectStore(STORE_RUNS);
    const rec = await promisifyRequest(store.get(runId));
    await promisifyTransaction(tx);
    return rec ? rec.manifest : null;
  }

  static async deleteDatabase({ dbName = DB_NAME } = {}) {
    if (!hasIndexedDB()) return;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  }
}

export const RunStoreConstants = {
  DB_NAME,
  DB_VERSION,
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
};
