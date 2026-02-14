import { isPlainObject, toNonEmptyString } from "../shared/index.js";
import { isNodeLike } from "../shared/index.js";
import { createLogger } from "../shared/index.js";

const logger = createLogger("skills/user-store");

const INDEX_KEY = "paperburner_user_skills_index_v1";
const BODY_PREFIX = "paperburner_user_skills_body_v1:";

const IDB_DB_NAME = "paperburner_user_skills_db_v1";
const IDB_STORE_NAME = "user_skills_kv";

/**
 * @typedef {"indexeddb" | "localstorage" | "memory"} UserSkillStoreMode
 * @typedef {{ ok: boolean, mode: UserSkillStoreMode, count?: number }} UserSkillStoreInitResult
 *
 * @typedef {{ [key: string]: unknown, name: string, description: string }} UserSkillMetadata
 * @typedef {{ schemaVersion: string, skills: UserSkillMetadata[] }} UserSkillsIndex
 */

function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage && typeof localStorage.getItem === "function";
  } catch (err) {
    logger.debug("localStorage not available", { error: err?.message });
    return false;
  }
}

function hasIndexedDB() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
  } catch (err) {
    logger.debug("IndexedDB not available", { error: err?.message });
    return false;
  }
}

function shouldUseIndexedDB() {
  // Browser-first. Keep Node tests deterministic (avoid auto-opening fake-indexeddb unless explicitly needed).
  return !isNodeLike() && hasIndexedDB();
}

/** @type {{ index: UserSkillsIndex, bodies: Map<string, string> }} */
const MEMORY = { index: { schemaVersion: "0.1", skills: [] }, bodies: new Map() };
let _idb = null;
/** @type {Promise<UserSkillStoreInitResult> | null} */
let _initPromise = null;
let _initDone = false;

/** @returns {UserSkillsIndex} */
function normalizeIndex(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const skills = Array.isArray(obj.skills) ? obj.skills : [];
  /** @type {UserSkillMetadata[]} */
  const normalizedSkills = [];
  for (const candidate of skills) {
    if (!isPlainObject(candidate)) continue;
    const name = toNonEmptyString(candidate.name);
    if (!name) continue;
    const description = typeof candidate.description === "string" ? candidate.description : "";
    normalizedSkills.push({ ...candidate, name, description });
  }
  return {
    schemaVersion: "0.1",
    skills: normalizedSkills,
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
          } catch (err) {
            logger.debug("Failed to close IDB on version change", { error: err?.message });
          } finally {
            _idb = null;
          }
        };
      } catch (err) {
        logger.debug("Failed to set IDB onversionchange handler", { error: err?.message });
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

import { safeJsonParse } from "../shared/index.js";
import { canUseStorageEncryption, decryptString, encryptString, isEncryptedString } from "../shared/index.js";

const DEFAULT_ENCRYPTION_AAD = "paperburner:user-skills:v1";
let _encryptionConfig = {
  enabled: false,
  passphrase: "",
  required: false,
  aad: DEFAULT_ENCRYPTION_AAD,
  iterations: 100_000,
};

function normalizeEncryptionConfig(input) {
  const cfg = input && typeof input === "object" ? input : {};
  const passphrase = toNonEmptyString(cfg.passphrase);
  const enabled = Boolean(cfg.enabled ?? passphrase);
  const required = Boolean(cfg.required);
  const aad = toNonEmptyString(cfg.aad) || DEFAULT_ENCRYPTION_AAD;
  const iterations = typeof cfg.iterations === "number" && Number.isFinite(cfg.iterations) ? Math.max(10_000, Math.floor(cfg.iterations)) : 100_000;
  return { enabled, passphrase, required, aad, iterations };
}

/**
 * Configure encryption for user skill store.
 *
 * @param {Object} [options] - Encryption configuration
 * @param {boolean} [options.enabled] - Enable encryption
 * @param {string} [options.passphrase] - Encryption passphrase
 * @param {boolean} [options.required] - Throw if encryption unavailable
 * @param {string} [options.aad] - Additional authenticated data
 * @param {number} [options.iterations] - PBKDF2 iterations
 * @returns {{ enabled: boolean, passphrase: string, required: boolean, aad: string, iterations: number, available: boolean }}
 * @throws {Error} If required but passphrase missing or WebCrypto unavailable
 */
export function configureUserSkillStoreEncryption(options = {}) {
  const next = normalizeEncryptionConfig(options);
  if (next.enabled && !next.passphrase) {
    if (next.required) throw new Error("UserSkillStore encryption is required but passphrase is missing");
    _encryptionConfig = { ...next, enabled: false };
    return { ..._encryptionConfig, available: canUseStorageEncryption() };
  }
  if (next.enabled && !canUseStorageEncryption()) {
    if (next.required) throw new Error("UserSkillStore encryption is required but WebCrypto is unavailable");
    _encryptionConfig = { ...next, enabled: false };
    return { ..._encryptionConfig, available: false };
  }
  _encryptionConfig = next;
  return { ..._encryptionConfig, available: canUseStorageEncryption() };
}

async function decryptIfNeeded(value) {
  const cfg = _encryptionConfig;
  if (!cfg.enabled) return value;
  const raw = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  if (!isEncryptedString(raw)) return value;
  return await decryptString(raw, { passphrase: cfg.passphrase, aad: cfg.aad });
}

async function encryptIfNeeded(plaintext) {
  const cfg = _encryptionConfig;
  if (!cfg.enabled) return plaintext;
  return await encryptString(typeof plaintext === "string" ? plaintext : String(plaintext ?? ""), {
    passphrase: cfg.passphrase,
    aad: cfg.aad,
    iterations: cfg.iterations,
  });
}

async function migrateLocalStorageToIndexedDB(db) {
  if (!db || !hasLocalStorage()) return false;
  const rawIndex = localStorage.getItem(INDEX_KEY);
  if (!rawIndex) return false;
  const indexEncrypted = isEncryptedString(rawIndex);
  let normalized = null;

  if (indexEncrypted && _encryptionConfig.enabled) {
    try {
      const plaintext = await decryptString(rawIndex, { passphrase: _encryptionConfig.passphrase, aad: _encryptionConfig.aad });
      normalized = normalizeIndex(safeJsonParse(plaintext));
    } catch (err) {
      if (_encryptionConfig.required) throw err;
      normalized = null;
    }
  } else if (!indexEncrypted) {
    normalized = normalizeIndex(safeJsonParse(rawIndex));
  }

  // If we can parse the index, only migrate referenced bodies.
  // Otherwise, migrate all BODY_PREFIX keys so encrypted indexes can still be recovered later.
  const bodyKeys = [];
  if (normalized && Array.isArray(normalized.skills) && normalized.skills.length) {
    for (const s of normalized.skills) {
      const name = toNonEmptyString(s?.name);
      if (!name) continue;
      bodyKeys.push(BODY_PREFIX + name);
    }
  } else {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && String(k).startsWith(BODY_PREFIX)) bodyKeys.push(String(k));
      }
    } catch (err) {
      logger.debug("Failed to enumerate localStorage keys", { error: err?.message });
    }
  }

  // Persist index + bodies into IndexedDB.
  if (_encryptionConfig.enabled) {
    if (indexEncrypted) {
      await idbSet(db, INDEX_KEY, rawIndex);
    } else {
      const encIndex = await encryptIfNeeded(JSON.stringify(normalized || { schemaVersion: "0.1", skills: [] }));
      await idbSet(db, INDEX_KEY, encIndex);
    }
  } else {
    await idbSet(db, INDEX_KEY, indexEncrypted ? rawIndex : normalized || { schemaVersion: "0.1", skills: [] });
  }

  for (const key of bodyKeys) {
    const body = localStorage.getItem(key);
    if (typeof body !== "string") continue;
    if (_encryptionConfig.enabled) {
      const payload = isEncryptedString(body) ? body : await encryptIfNeeded(body);
      await idbSet(db, key, payload);
    } else {
      await idbSet(db, key, body);
    }
  }

  // Best-effort cleanup (avoid 5MB localStorage ceiling).
  try {
    localStorage.removeItem(INDEX_KEY);
    for (const key of bodyKeys) localStorage.removeItem(key);
  } catch (err) {
    logger.debug("Failed to cleanup localStorage after migration", { error: err?.message });
  }

  return true;
}

/** @returns {Promise<UserSkillStoreInitResult>} */
async function hydrateFromLocalStorage() {
  if (!hasLocalStorage()) return { ok: true, mode: "memory" };

  try {
    const rawIndex = localStorage.getItem(INDEX_KEY);
    const indexText = rawIndex ? await decryptIfNeeded(rawIndex) : null;
    const parsedIndex = typeof indexText === "string" ? safeJsonParse(indexText) : null;
    const normalized = normalizeIndex(parsedIndex);
    MEMORY.index = normalized;

    MEMORY.bodies.clear();
    await Promise.all(
      normalized.skills.map(async (s) => {
        const name = toNonEmptyString(s?.name);
        if (!name) return;
        const rawBody = localStorage.getItem(BODY_PREFIX + name);
        const bodyText = rawBody ? await decryptIfNeeded(rawBody) : "";
        if (typeof bodyText === "string") MEMORY.bodies.set(name, bodyText);
      })
    );

    return { ok: true, mode: "localstorage", count: normalized.skills.length };
  } catch (err) {
    if (_encryptionConfig.required) throw err;
    return { ok: false, mode: "memory" };
  }
}

/**
 * Initialize user skill store (IndexedDB or localStorage fallback).
 *
 * @param {Object} [options] - Init options
 * @param {boolean} [options.forceReload] - Force re-initialization
 * @param {Object} [options.encryption] - Encryption config (passed to configureUserSkillStoreEncryption)
 * @returns {Promise<UserSkillStoreInitResult>}
 */
export async function initUserSkillStore({ forceReload = false } = {}) {
  // Optional: initUserSkillStore({ encryption: { passphrase, ... } })
  try {
    const enc = arguments.length ? arguments[0]?.encryption : null;
    if (enc && typeof enc === "object") configureUserSkillStoreEncryption(enc);
  } catch {
    // ignore
  }

  if (!shouldUseIndexedDB()) {
    if (!isNodeLike() && hasLocalStorage() && _encryptionConfig.enabled) {
      if (_initDone && !forceReload) return { ok: true, mode: "localstorage" };
      if (_initPromise) return _initPromise;

      _initPromise = (async () => {
        const outcome = await hydrateFromLocalStorage();
        _initDone = true;
        return outcome;
      })()
        .catch(() => /** @type {UserSkillStoreInitResult} */ ({ ok: false, mode: "memory" }))
        .finally(() => {
          _initPromise = null;
        });

      return _initPromise;
    }

    _initDone = true;
    return { ok: true, mode: "memory" };
  }

  if (_initDone && !forceReload) return { ok: true, mode: "indexeddb" };
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await openUserSkillsDb();
    if (!db) {
      _initDone = true;
      return /** @type {UserSkillStoreInitResult} */ ({ ok: true, mode: "memory" });
    }

    // One-time migration from localStorage to IndexedDB.
    const existing = await idbGet(db, INDEX_KEY);
    if (!existing) await migrateLocalStorageToIndexedDB(db);

    const indexRaw = await idbGet(db, INDEX_KEY);
    const indexValue = await decryptIfNeeded(indexRaw);
    const parsedIndex = typeof indexValue === "string" ? safeJsonParse(indexValue) : indexValue;
    const normalized = normalizeIndex(parsedIndex);
    MEMORY.index = normalized;

    // Hydrate bodies into memory for sync reads (best-effort).
    MEMORY.bodies.clear();
    await Promise.all(
      normalized.skills.map(async (s) => {
        const name = toNonEmptyString(s?.name);
        if (!name) return;
        const bodyRaw = await idbGet(db, BODY_PREFIX + name);
        const body = await decryptIfNeeded(bodyRaw);
        if (typeof body === "string") MEMORY.bodies.set(name, body);
      })
    );

    _initDone = true;
    return /** @type {UserSkillStoreInitResult} */ ({ ok: true, mode: "indexeddb", count: normalized.skills.length });
  })()
    .catch(() => /** @type {UserSkillStoreInitResult} */ ({ ok: false, mode: "memory" }))
    .finally(() => {
      _initPromise = null;
    });

  return _initPromise;
}

/**
 * List all user skills metadata.
 *
 * @returns {UserSkillMetadata[]}
 */
export function listUserSkills() {
  const index = loadUserSkillsIndex();
  return index.skills;
}

/**
 * Load the user skills index from storage.
 *
 * @returns {UserSkillsIndex}
 */
export function loadUserSkillsIndex() {
  if (shouldUseIndexedDB()) {
    if (!_initDone) void initUserSkillStore().catch((err) => logger.debug("User store error", { error: err?.message }));
    return normalizeIndex(MEMORY.index);
  }
  if (_encryptionConfig.enabled) {
    if (!_initDone) void initUserSkillStore().catch((err) => logger.debug("User store error", { error: err?.message }));
    return normalizeIndex(MEMORY.index);
  }
  if (!hasLocalStorage()) return normalizeIndex(MEMORY.index);
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return { schemaVersion: "0.1", skills: [] };
  const parsed = safeJsonParse(raw);
  return normalizeIndex(parsed);
}

/**
 * Save the user skills index to storage.
 *
 * @param {{ schemaVersion?: string, skills: Array<{ name: string, [key: string]: unknown }> }} index
 * @returns {boolean}
 */
export function saveUserSkillsIndex(index) {
  const normalized = normalizeIndex(index);
  MEMORY.index = normalized;

  if (shouldUseIndexedDB()) {
    if (_encryptionConfig.enabled) {
      void (async () => {
        const db = await openUserSkillsDb();
        if (!db) return;
        const enc = await encryptIfNeeded(JSON.stringify(normalized));
        await idbSet(db, INDEX_KEY, enc);
      })().catch((err) => logger.debug("User store error", { error: err?.message }));
    } else {
      void openUserSkillsDb().then((db) => idbSet(db, INDEX_KEY, normalized)).catch((err) => logger.debug("User store error", { error: err?.message }));
    }
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.index = normalized;
    return true;
  }
  if (_encryptionConfig.enabled) {
    void encryptIfNeeded(JSON.stringify(normalized))
      .then((enc) => {
        try {
          localStorage.setItem(INDEX_KEY, enc);
        } catch {
          // ignore
        }
      })
      .catch((err) => logger.debug("User store error", { error: err?.message }));
  } else {
    localStorage.setItem(INDEX_KEY, JSON.stringify(normalized));
  }
  return true;
}

/**
 * Get the body content of a user skill.
 *
 * @param {string} name - Skill name
 * @returns {string}
 */
export function getUserSkillBody(name) {
  const id = toNonEmptyString(name);
  if (!id) return "";
  if (shouldUseIndexedDB()) {
    if (!_initDone) void initUserSkillStore().catch((err) => logger.debug("User store error", { error: err?.message }));
    return String(MEMORY.bodies.get(id) || "");
  }
  if (_encryptionConfig.enabled) {
    if (!_initDone) void initUserSkillStore().catch((err) => logger.debug("User store error", { error: err?.message }));
    return String(MEMORY.bodies.get(id) || "");
  }
  if (!hasLocalStorage()) return String(MEMORY.bodies.get(id) || "");
  return String(localStorage.getItem(BODY_PREFIX + id) || "");
}

/**
 * Set the body content of a user skill.
 *
 * @param {string} name - Skill name
 * @param {string} body - Skill body content
 * @returns {boolean}
 */
export function setUserSkillBody(name, body) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const text = typeof body === "string" ? body : String(body ?? "");
  MEMORY.bodies.set(id, text);

  if (shouldUseIndexedDB()) {
    if (_encryptionConfig.enabled) {
      void (async () => {
        const db = await openUserSkillsDb();
        if (!db) return;
        const enc = await encryptIfNeeded(text);
        await idbSet(db, BODY_PREFIX + id, enc);
      })().catch((err) => logger.debug("User store error", { error: err?.message }));
    } else {
      void openUserSkillsDb().then((db) => idbSet(db, BODY_PREFIX + id, text)).catch((err) => logger.debug("User store error", { error: err?.message }));
    }
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.bodies.set(id, text);
    return true;
  }
  if (_encryptionConfig.enabled) {
    void encryptIfNeeded(text)
      .then((enc) => {
        try {
          localStorage.setItem(BODY_PREFIX + id, enc);
        } catch {
          // ignore
        }
      })
      .catch((err) => logger.debug("User store error", { error: err?.message }));
  } else {
    localStorage.setItem(BODY_PREFIX + id, text);
  }
  return true;
}

/**
 * Upsert a user skill (create or update).
 *
 * @param {{
 *   metadata?: {
 *     name: string,
 *     description: string,
 *     shortDescription?: string,
 *     keywords?: string[],
 *     keywordsAll?: string[],
 *     allowedTools?: string,
 *     tags?: Record<string, string>,
 *     traits?: string[],
 *     priority?: number,
 *   },
 *   body?: string,
 * }} [input] - Skill data
 * @returns {{ ok: boolean, name: string }}
 * @throws {Error} If metadata.name or metadata.description is missing
 */
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

/**
 * Delete a user skill by name.
 *
 * @param {string} name - Skill name to delete
 * @returns {boolean}
 */
export function deleteUserSkill(name) {
  const id = toNonEmptyString(name);
  if (!id) return false;
  const index = loadUserSkillsIndex();
  const nextSkills = index.skills.filter((s) => toNonEmptyString(s.name) !== id);
  saveUserSkillsIndex({ ...index, skills: nextSkills });

  MEMORY.bodies.delete(id);

  if (shouldUseIndexedDB()) {
    void openUserSkillsDb().then((db) => idbDelete(db, BODY_PREFIX + id)).catch((err) => logger.debug("User store error", { error: err?.message }));
    return true;
  }

  if (!hasLocalStorage()) {
    MEMORY.bodies.delete(id);
    return true;
  }
  localStorage.removeItem(BODY_PREFIX + id);
  return true;
}

/**
 * Clear all user skills.
 *
 * @returns {boolean}
 */
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
  configureUserSkillStoreEncryption,
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
