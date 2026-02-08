import {
  DB_NAME,
  DB_VERSION,
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
  ensureIndex,
  ensureObjectStore,
  hasIndexedDB,
  logger,
  normalizeRetentionConfig,
} from "./run-store-utils.js";

import {
  appendEvent,
  appendEvents,
  createRun,
  deleteRun,
  saveArtifact,
  saveState,
  saveTask,
  updateManifest,
  updateRunContext,
} from "./run-store-crud.js";

import {
  getArtifact,
  getArtifactById,
  getArtifactRecord,
  getEvents,
  getLatestArtifactSummary,
  getManifest,
  getRun,
  listArtifacts,
  listArtifactSummaries,
  listRunRecords,
  listRuns,
  loadArtifact,
  loadState,
  loadTask,
} from "./run-store-queries.js";

import {
  _estimateRunBytes,
  _estimateRunBytesFromManifest,
  _maybeWarnQuota,
  cleanupRuns,
  estimateQuota,
  setRetentionPolicy,
} from "./run-store-cache.js";

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

      req.onupgradeneeded = () => {
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

      let blockedTimer = null;
      const blockedOpenTimeoutMs = 5000;

      req.onsuccess = () => {
        if (blockedTimer !== null) {
          clearTimeout(blockedTimer);
          blockedTimer = null;
        }
        resolve(req.result);
      };
      req.onblocked = () => {
        try {
          logger.warn(`[RunStore] IndexedDB open blocked for ${this.dbName}@v${this.dbVersion}`);
        } catch {
          // ignore
        }

        if (blockedTimer === null) {
          blockedTimer = setTimeout(() => {
            reject(new Error(`[RunStore] IndexedDB open blocked timeout after ${blockedOpenTimeoutMs}ms for ${this.dbName}@v${this.dbVersion}`));
          }, blockedOpenTimeoutMs);
        }
      };
      req.onerror = () => {
        if (blockedTimer !== null) {
          clearTimeout(blockedTimer);
          blockedTimer = null;
        }
        reject(req.error);
      };
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

  static async deleteDatabase({ dbName = DB_NAME } = {}) {
    if (!hasIndexedDB()) return;
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("deleteDatabase blocked"));
    });
  }

  // ─── Delegated CRUD (run-store-crud.js) ───
  saveTask(...a) { return saveTask.call(this, ...a); }
  loadTask(...a) { return loadTask.call(this, ...a); }
  saveState(...a) { return saveState.call(this, ...a); }
  loadState(...a) { return loadState.call(this, ...a); }
  createRun(...a) { return createRun.call(this, ...a); }
  updateRunContext(...a) { return updateRunContext.call(this, ...a); }
  deleteRun(...a) { return deleteRun.call(this, ...a); }
  appendEvent(...a) { return appendEvent.call(this, ...a); }
  appendEvents(...a) { return appendEvents.call(this, ...a); }
  saveArtifact(...a) { return saveArtifact.call(this, ...a); }
  updateManifest(...a) { return updateManifest.call(this, ...a); }

  // ─── Delegated queries (run-store-queries.js) ───
  getRun(...a) { return getRun.call(this, ...a); }
  listRuns(...a) { return listRuns.call(this, ...a); }
  listRunRecords(...a) { return listRunRecords.call(this, ...a); }
  getEvents(...a) { return getEvents.call(this, ...a); }
  getArtifact(...a) { return getArtifact.call(this, ...a); }
  getArtifactRecord(...a) { return getArtifactRecord.call(this, ...a); }
  getArtifactById(...a) { return getArtifactById.call(this, ...a); }
  loadArtifact(...a) { return loadArtifact.call(this, ...a); }
  listArtifacts(...a) { return listArtifacts.call(this, ...a); }
  listArtifactSummaries(...a) { return listArtifactSummaries.call(this, ...a); }
  getLatestArtifactSummary(...a) { return getLatestArtifactSummary.call(this, ...a); }
  getManifest(...a) { return getManifest.call(this, ...a); }

  // ─── Delegated lifecycle (run-store-cache.js) ───
  estimateQuota(...a) { return estimateQuota.call(this, ...a); }
  _maybeWarnQuota(...a) { return _maybeWarnQuota.call(this, ...a); }
  setRetentionPolicy(...a) { return setRetentionPolicy.call(this, ...a); }
  _estimateRunBytes(...a) { return _estimateRunBytes.call(this, ...a); }
  _estimateRunBytesFromManifest(...a) { return _estimateRunBytesFromManifest.call(this, ...a); }
  cleanupRuns(...a) { return cleanupRuns.call(this, ...a); }
}

export const RunStoreConstants = {
  DB_NAME,
  DB_VERSION,
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
};
