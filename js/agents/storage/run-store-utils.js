import { createLogger } from "../shared/index.js";
import { isPlainObject } from "../shared/index.js";

export const logger = createLogger("storage/run-store");

export const DB_NAME = "AgentRuntimeDB";
export const DB_VERSION = 2;

export const STORE_RUNS = "runs";
export const STORE_ARTIFACTS = "artifacts";
export const STORE_EVENTS = "events";
export const STORE_COUNTERS = "counters";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function hasIndexedDB() {
  return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
}

export function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function promisifyTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

export function toISO(d = new Date()) {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function encodeUtf8Bytes(text) {
  if (typeof text !== "string") return undefined;
  try {
    return new TextEncoder().encode(text).byteLength;
  } catch {
    return text.length;
  }
}

export function parseIsoMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeRetentionConfig(config) {
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

export function isPinnedRunContext(ctx, pinnedKey = "pinned") {
  const key = typeof pinnedKey === "string" && pinnedKey ? pinnedKey : "pinned";
  if (!ctx || typeof ctx !== "object") return false;
  if (ctx[key] === true) return true;
  if (ctx.retention && typeof ctx.retention === "object" && ctx.retention[key] === true) return true;
  return false;
}

export async function deleteByIndexKey(store, indexName, key) {
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

export async function getLastByCompoundIndex(store, indexName, range) {
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

export function ensureObjectStore(db, name, options) {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, options);
  }
}

export function ensureIndex(store, name, keyPath, options) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

export default {
  logger,
  DB_NAME,
  DB_VERSION,
  STORE_RUNS,
  STORE_ARTIFACTS,
  STORE_EVENTS,
  STORE_COUNTERS,
  DAY_MS,
  hasIndexedDB,
  promisifyRequest,
  promisifyTransaction,
  toISO,
  encodeUtf8Bytes,
  parseIsoMs,
  normalizeRetentionConfig,
  isPinnedRunContext,
  deleteByIndexKey,
  getLastByCompoundIndex,
  ensureObjectStore,
  ensureIndex,
};
