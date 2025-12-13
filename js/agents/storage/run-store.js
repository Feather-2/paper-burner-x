const DB_NAME = "AgentRuntimeDB";
const DB_VERSION = 1;

const STORE_RUNS = "runs";
const STORE_ARTIFACTS = "artifacts";
const STORE_EVENTS = "events";

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
  constructor({ dbName = DB_NAME, dbVersion = DB_VERSION } = {}) {
    this.dbName = dbName;
    this.dbVersion = dbVersion;
    this._dbp = null;
  }

  async open() {
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

        const runsStore = tx.objectStore(STORE_RUNS);
        ensureIndex(runsStore, "byCreatedAt", "createdAt", { unique: false });

        const artifactsStore = tx.objectStore(STORE_ARTIFACTS);
        ensureIndex(artifactsStore, "byRunId", "runId", { unique: false });
        ensureIndex(artifactsStore, "byRunIdTypeSeq", ["runId", "type", "seq"], { unique: false });

        const eventsStore = tx.objectStore(STORE_EVENTS);
        ensureIndex(eventsStore, "byRunId", "runId", { unique: false });
        ensureIndex(eventsStore, "byRunIdTs", ["runId", "ts"], { unique: false });
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this._dbp;
  }

  async close() {
    const db = await this._dbp;
    if (db) db.close();
    this._dbp = null;
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
    const tx = db.transaction([STORE_RUNS, STORE_ARTIFACTS, STORE_EVENTS], "readwrite");

    const runsStore = tx.objectStore(STORE_RUNS);
    runsStore.delete(runId);

    const artifactsStore = tx.objectStore(STORE_ARTIFACTS);
    await deleteByIndexKey(artifactsStore, "byRunId", IDBKeyRange.only(runId));

    const eventsStore = tx.objectStore(STORE_EVENTS);
    await deleteByIndexKey(eventsStore, "byRunId", IDBKeyRange.only(runId));

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

    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readwrite");
    const store = tx.objectStore(STORE_ARTIFACTS);

    const range = IDBKeyRange.bound([runId, type, 0], [runId, type, Number.MAX_SAFE_INTEGER]);
    const last = await getLastByCompoundIndex(store, "byRunIdTypeSeq", range);
    const nextSeq = typeof options.seq === "number" ? options.seq : (typeof last?.seq === "number" ? last.seq + 1 : 1);

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
      else if (isPlainObject(data) || Array.isArray(data)) bytes = encodeUtf8Bytes(JSON.stringify(data));
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

  async listArtifacts(runId) {
    const db = await this.open();
    const tx = db.transaction([STORE_ARTIFACTS], "readonly");
    const store = tx.objectStore(STORE_ARTIFACTS);
    const index = store.index("byRunId");
    const rows = await promisifyRequest(index.getAll(IDBKeyRange.only(runId)));
    await promisifyTransaction(tx);
    return rows || [];
  }

  async updateManifest(runId, manifest) {
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
};
