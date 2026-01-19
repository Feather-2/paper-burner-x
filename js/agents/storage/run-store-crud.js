import { isPlainObject } from "../shared/index.js";

import {
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
  deleteByIndexKey,
  encodeUtf8Bytes,
  getLastByCompoundIndex,
  promisifyRequest,
  promisifyTransaction,
  toISO,
} from "./run-store-utils.js";

/**
 * Save a task object to the store.
 * @param {object} task - Task object with a `taskId` property.
 * @returns {Promise<void>}
 */
export async function saveTask(task) {
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

/**
 * Save run state to the store.
 * @param {string} runId - The run identifier.
 * @param {object} state - State object to persist (may have `.toJSON()` method).
 * @returns {Promise<void>}
 */
export async function saveState(runId, state) {
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

export async function createRun(runContext) {
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

export async function updateRunContext(runId, patch, { replace = false } = {}) {
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

export async function deleteRun(runId) {
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

export async function appendEvent(runId, event) {
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

export async function appendEvents(runId, events = []) {
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

export async function saveArtifact(runId, type, data, options = {}) {
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

export async function updateManifest(runId, manifest) {
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

export default {
  saveTask,
  saveState,
  createRun,
  updateRunContext,
  deleteRun,
  appendEvent,
  appendEvents,
  saveArtifact,
  updateManifest,
};
