import { safeJsonParse } from "../shared/index.js";

import {
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  getLastByCompoundIndex,
  logger,
  promisifyRequest,
  promisifyTransaction,
} from "./run-store-utils.js";

const MAX_MANIFEST_CHARS = 1_000_000;
const MAX_MANIFEST_ARTIFACTS = 5000;
const MAX_MANIFEST_FIELDS = 20000;

function isValidManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  const runId = typeof manifest.runId === "string" ? manifest.runId.trim() : "";
  if (!runId) return false;

  if (manifest.artifacts === undefined) return true;
  if (!Array.isArray(manifest.artifacts)) return false;
  if (manifest.artifacts.length > MAX_MANIFEST_ARTIFACTS) return false;

  let fieldCount = Object.keys(manifest).length;
  for (const item of manifest.artifacts) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    fieldCount += Object.keys(item).length;
    if (fieldCount > MAX_MANIFEST_FIELDS) return false;
  }

  return fieldCount <= MAX_MANIFEST_FIELDS;
}

/**
 * Load a task object from the store.
 * @param {string} taskId - The task identifier.
 * @returns {Promise<object|null>} The task object or null if not found.
 */
export async function loadTask(taskId) {
  if (!taskId || typeof taskId !== "string") throw new Error("loadTask(taskId): taskId must be a string");

  if (this.storage?.get) {
    const data = await this.storage.get(this._keyForTask(taskId));
    return data ? safeJsonParse(data, null) : null;
  }

  const data = await this.getArtifact(taskId, "task.json");
  if (data === null || data === undefined) return null;
  return typeof data === "string" ? safeJsonParse(data, null) : data;
}

/**
 * Load run state from the store.
 * @param {string} runId - The run identifier.
 * @returns {Promise<object|null>} The state object or null if not found.
 */
export async function loadState(runId) {
  if (!runId || typeof runId !== "string") throw new Error("loadState(runId): runId must be a string");

  if (this.storage?.get) {
    const data = await this.storage.get(this._keyForState(runId));
    return data ? safeJsonParse(data, null) : null;
  }

  const data = await this.getArtifact(runId, "state.json");
  if (data === null || data === undefined) return null;
  return typeof data === "string" ? safeJsonParse(data, null) : data;
}

/**
 * List run records (metadata) in IndexedDB mode.
 *
 * @param {object} [options]
 * @param {"asc"|"desc"} [options.order="desc"]
 * @param {boolean} [options.includeContext=false]
 * @returns {Promise<Array<{runId:string,createdAt:string,updatedAt:string,manifest:any,runContext?:any}>>}
 */
export async function listRunRecords({ order = "desc", includeContext = false } = {}) {
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

export async function listRuns() {
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

export async function getRun(runId) {
  const db = await this.open();
  const tx = db.transaction([STORE_RUNS], "readonly");
  const store = tx.objectStore(STORE_RUNS);
  const rec = await promisifyRequest(store.get(runId));
  await promisifyTransaction(tx);
  return rec ? rec.runContext : null;
}

export async function getEvents(runId) {
  const db = await this.open();
  const tx = db.transaction([STORE_EVENTS], "readonly");
  const store = tx.objectStore(STORE_EVENTS);
  const index = store.index("byRunIdTs");
  const range = IDBKeyRange.bound([runId, ""], [runId, "\uffff"]);
  const out = await promisifyRequest(index.getAll(range));
  await promisifyTransaction(tx);
  return out || [];
}

export async function getArtifact(runId, type) {
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
export async function getArtifactRecord(artifactId) {
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
export async function getArtifactById(artifactId) {
  const rec = await this.getArtifactRecord(artifactId);
  return rec ? rec.data : null;
}

export async function loadArtifact(runId, name) {
  return await this.getArtifact(runId, name);
}

export async function listArtifacts(runId) {
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
export async function listArtifactSummaries(runId, { type } = {}) {
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
export async function getLatestArtifactSummary(runId, type) {
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

export async function getManifest(runId) {
  if (this.storage?.get) {
    const data = await this.storage.get(this._keyForManifest(runId));
    if (!data) return null;
    const manifest = safeJsonParse(data, { maxChars: MAX_MANIFEST_CHARS });
    if (!isValidManifest(manifest)) {
      logger.warn("[RunStore] Invalid manifest in storage adapter", { runId });
      return null;
    }
    return manifest;
  }

  const db = await this.open();
  const tx = db.transaction([STORE_RUNS], "readonly");
  const store = tx.objectStore(STORE_RUNS);
  const rec = await promisifyRequest(store.get(runId));
  await promisifyTransaction(tx);
  return rec ? rec.manifest : null;
}

export default {
  loadTask,
  loadState,
  listRunRecords,
  listRuns,
  getRun,
  getEvents,
  getArtifact,
  getArtifactRecord,
  getArtifactById,
  loadArtifact,
  listArtifacts,
  listArtifactSummaries,
  getLatestArtifactSummary,
  getManifest,
};
