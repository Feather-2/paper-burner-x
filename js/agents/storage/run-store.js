const DB_NAME = "AgentRuntimeDB";
const DB_VERSION = 2;

const STORE_RUNS = "runs";
const STORE_ARTIFACTS = "artifacts";
const STORE_EVENTS = "events";
const STORE_COUNTERS = "counters";

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function encodeUtf8Bytes(text) {
  if (typeof text !== "string") return undefined;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length;
  }
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
  constructor({ dbName = DB_NAME, dbVersion = DB_VERSION, storageAdapter, prefix = "deepsearch:run:" } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
    this.storage = storageAdapter;
    this.prefix = prefix;
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
          console.warn(`[RunStore] IndexedDB open blocked for ${this.dbName}@v${this.dbVersion}`);
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
      return data ? JSON.parse(data) : null;
    }

    const data = await this.getArtifact(taskId, "task.json");
    if (data === null || data === undefined) return null;
    return typeof data === "string" ? JSON.parse(data) : data;
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
      return data ? JSON.parse(data) : null;
    }

    const data = await this.getArtifact(runId, "state.json");
    if (data === null || data === undefined) return null;
    return typeof data === "string" ? JSON.parse(data) : data;
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
