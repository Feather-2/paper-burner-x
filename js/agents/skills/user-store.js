const INDEX_KEY = "paperburner_user_skills_index_v1";
const BODY_PREFIX = "paperburner_user_skills_body_v1:";

const IDB_DB_NAME = "paperburner_user_skills_db_v1";
const IDB_STORE_NAME = "user_skills_kv";

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch {
    return false;
  }
}

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function hasIndexedDB() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
  } catch {
    return false;
  }
}

function shouldUseIndexedDB() {
  // Browser-first. Keep Node tests deterministic (avoid auto-opening fake-indexeddb unless explicitly needed).
  return !isNodeLike() && hasIndexedDB();
}

const MEMORY = { index: { schemaVersion: "0.1", skills: [] }, bodies: new Map() };
let _idb = null;
let _initPromise = null;
let _initDone = false;

function toNonEmptyString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeIndex(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const skills = Array.isArray(obj.skills) ? obj.skills : [];
  return {
    schemaVersion: "0.1",
    skills: skills.filter((s) => s && typeof s === "object" && toNonEmptyString(s.name)),
  };
}

function openUserSkillsDb() {
  if (_idb) return Promise.resolve(_idb);
  if (!shouldUseIndexedDB()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(null);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      _idb = req.result;
      try {
        _idb.onversionchange = () => {
          try {
            _idb.close();
          } catch {
            // ignore
          } finally {
            _idb = null;
          }
        };
      } catch {
        // ignore
      }
      resolve(_idb);
    };
  }).catch(() => null);
}

function idbGet(db, key) {
  if (!db) return Promise.resolve(null);
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE_NAME, "readonly");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.get(String(key));
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
  });
}

function idbSet(db, key, value) {
  if (!db) return Promise.resolve(false);
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.put({ key: String(key), value });
    req.onerror = () => resolve(false);
    req.onsuccess = () => resolve(true);
  });
}

function idbDelete(db, key) {
  if (!db) return Promise.resolve(false);
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE_NAME, "readwrite");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.delete(String(key));
    req.onerror = () => resolve(false);
    req.onsuccess = () => resolve(true);
  });
}

import { safeJsonParse } from "../shared/utils/safe-json.js";

async function migrateLocalStorageToIndexedDB(db) {
  if (!db || !hasLocalStorage()) return false;
  const rawIndex = localStorage.getItem(INDEX_KEY);
  if (!rawIndex) return false;
  const parsedIndex = safeJsonParse(rawIndex);
  const normalized = normalizeIndex(parsedIndex);
  if (!normalized.skills.length) return false;

  // Persist index + bodies into IndexedDB.
  await idbSet(db, INDEX_KEY, normalized);
  for (const s of normalized.skills) {
    const name = toNonEmptyString(s?.name);
    if (!name) continue;
    const body = localStorage.getItem(BODY_PREFIX + name);
    if (typeof body === "string") {
      await idbSet(db, BODY_PREFIX + name, body);
    }
  }

  // Best-effort cleanup (avoid 5MB localStorage ceiling).
  try {
    localStorage.removeItem(INDEX_KEY);
    for (const s of normalized.skills) {
      const name = toNonEmptyString(s?.name);
      if (name) localStorage.removeItem(BODY_PREFIX + name);
    }
  } catch {
    // ignore
  }

  return true;
}

export async function initUserSkillStore({ forceReload = false } = {}) {
  if (!shouldUseIndexedDB()) {
    _initDone = true;
    return { ok: true, mode: "memory" };
  }

  if (_initDone && !forceReload) return { ok: true, mode: "indexeddb" };
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await openUserSkillsDb();
    if (!db) {
      _initDone = true;
      return { ok: true, mode: "memory" };
    }

    // One-time migration from localStorage to IndexedDB.
    const existing = await idbGet(db, INDEX_KEY);
    if (!existing) await migrateLocalStorageToIndexedDB(db);

    const indexRaw = await idbGet(db, INDEX_KEY);
    const normalized = normalizeIndex(indexRaw);
    MEMORY.index = normalized;

    // Hydrate bodies into memory for sync reads (best-effort).
    MEMORY.bodies.clear();
    await Promise.all(
      normalized.skills.map(async (s) => {
        const name = toNonEmptyString(s?.name);
        if (!name) return;
        const body = await idbGet(db, BODY_PREFIX + name);
        if (typeof body === "string") MEMORY.bodies.set(name, body);
      })
    );

    _initDone = true;
    return { ok: true, mode: "indexeddb", count: normalized.skills.length };
  })()
    .catch(() => ({ ok: false, mode: "memory" }))
    .finally(() => {
      _initPromise = null;
    });

  return _initPromise;
}

export function listUserSkills() {
  const index = loadUserSkillsIndex();
  return index.skills;
}

export function loadUserSkillsIndex() {
  if (shouldUseIndexedDB()) {
    if (!_initDone) void initUserSkillStore().catch(() => {});
    return normalizeIndex(MEMORY.index);
  }
  if (!hasLocalStorage()) return normalizeIndex(MEMORY.index);
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return { schemaVersion: "0.1", skills: [] };
  const parsed = safeJsonParse(raw);
  return normalizeIndex(parsed);
}

export function saveUserSkillsIndex(index) {
  const normalized = normalizeIndex(index);
  MEMORY.index = normalized;

  if (shouldUseIndexedDB()) {
    void openUserSkillsDb().then((db) => idbSet(db, INDEX_KEY, normalized)).catch(() => {});
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.index = normalized;
    return true;
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(normalized));
  return true;
}

export function getUserSkillBody(name) {
  const id = toNonEmptyString(name);
  if (!id) return "";
  if (shouldUseIndexedDB()) {
    if (!_initDone) void initUserSkillStore().catch(() => {});
    return String(MEMORY.bodies.get(id) || "");
  }
  if (!hasLocalStorage()) return String(MEMORY.bodies.get(id) || "");
  return String(localStorage.getItem(BODY_PREFIX + id) || "");
}

export function setUserSkillBody(name, body) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const text = typeof body === "string" ? body : String(body ?? "");
  MEMORY.bodies.set(id, text);

  if (shouldUseIndexedDB()) {
    void openUserSkillsDb().then((db) => idbSet(db, BODY_PREFIX + id, text)).catch(() => {});
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.bodies.set(id, text);
    return true;
  }
  localStorage.setItem(BODY_PREFIX + id, text);
  return true;
}

export function upsertUserSkill({ metadata, body } = {}) {
  const meta = isPlainObject(metadata) ? metadata : {};
  const name = toNonEmptyString(meta.name);
  const description = toNonEmptyString(meta.description);
  if (!name || !description) throw new Error("upsertUserSkill: metadata.name/description are required");

  const index = loadUserSkillsIndex();
  const now = new Date().toISOString();

  const normalizedMeta = {
    name,
    description,
    shortDescription: toNonEmptyString(meta.shortDescription) || null,
    scope: "user",
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    keywordsAll: Array.isArray(meta.keywordsAll) ? meta.keywordsAll : [],
    allowedTools: toNonEmptyString(meta.allowedTools) || null,
    tags: isPlainObject(meta.tags) ? meta.tags : null,
    traits: Array.isArray(meta.traits) ? meta.traits : null,
    priority: Number.isFinite(Number(meta.priority)) ? Number(meta.priority) : 100,
    updatedAt: now,
  };

  const nextSkills = [];
  let replaced = false;
  for (const s of index.skills) {
    if (toNonEmptyString(s.name) !== name) {
      nextSkills.push(s);
      continue;
    }
    nextSkills.push({ ...s, ...normalizedMeta });
    replaced = true;
  }
  if (!replaced) {
    nextSkills.push({ ...normalizedMeta, createdAt: now });
  }

  saveUserSkillsIndex({ ...index, skills: nextSkills });
  setUserSkillBody(name, body);
  return { ok: true, name };
}

export function deleteUserSkill(name) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const index = loadUserSkillsIndex();
  const nextSkills = index.skills.filter((s) => toNonEmptyString(s.name) !== id);
  saveUserSkillsIndex({ ...index, skills: nextSkills });

  MEMORY.bodies.delete(id);

  if (shouldUseIndexedDB()) {
    void openUserSkillsDb().then((db) => idbDelete(db, BODY_PREFIX + id)).catch(() => {});
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.bodies.delete(id);
    return true;
  }
  localStorage.removeItem(BODY_PREFIX + id);
  return true;
}

export function clearUserSkills() {
  const index = loadUserSkillsIndex();
  for (const s of index.skills) {
    const id = toNonEmptyString(s?.name);
    if (!id) continue;
    deleteUserSkill(id);
  }
  saveUserSkillsIndex({ schemaVersion: "0.1", skills: [] });
  return true;
}

export default {
  initUserSkillStore,
  listUserSkills,
  loadUserSkillsIndex,
  saveUserSkillsIndex,
  getUserSkillBody,
  setUserSkillBody,
  upsertUserSkill,
  deleteUserSkill,
  clearUserSkills,
};
