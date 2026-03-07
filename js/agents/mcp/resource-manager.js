import { isPlainObject, toNonEmptyString } from "../shared/index.js";
import { McpClient } from "./mcp-client.js";
import { FallbackAdapter } from "../shared/index.js";
import { isNodeLike } from "../shared/index.js";
import { safeJsonParse } from "../shared/index.js";
import { canUseStorageEncryption, decryptString, encryptString, isEncryptedString } from "../shared/index.js";
import { createLogger } from "../shared/index.js";

const logger = createLogger("mcp/resource-manager");

/**
 * @typedef {object} McpResourceDefinition
 * @property {string} uri
 * @property {string=} name
 * @property {string=} description
 * @property {string=} mimeType
 * @property {any=} annotations
 */

/**
 * @typedef {object} McpResourceTemplateDefinition
 * @property {string} uriTemplate
 * @property {string=} name
 * @property {string=} description
 * @property {string=} mimeType
 */

/**
 * @typedef {object} McpResourceContent
 * @property {string} uri
 * @property {string=} mimeType
 * @property {string=} text
 * @property {Uint8Array=} blob
 */

/**
 * @typedef {object} McpResourceUpdate
 * @property {string} providerId
 * @property {string} uri
 * @property {any|null=} content
 * @property {string=} error
 */

/**
 * @callback McpResourceUpdateCallback
 * @param {McpResourceUpdate} update
 * @returns {void}
 */

/**
 * @typedef {object} McpResourceSubscription
 * @property {string} id
 * @property {string} providerId
 * @property {string} uri
 * @property {() => Promise<{ ok: boolean }>} unsubscribe
 */

/**
 * @typedef {object} McpResourceManagerOptions
 * @property {import("./mcp-client.js").McpClient=} client
 * @property {(Storage|{ get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<any> }|null)=} storage
 * @property {number=} defaultTtlMs
 * @property {number=} maxPersistBytes
 * @property {number=} maxContentCacheEntries
 * @property {number=} maxContentCacheBytes
 * @property {boolean=} persistStrict
 * @property {{ enabled?: boolean, required?: boolean, passphrase?: string, aad?: string, iterations?: number }=} encryption
 */

function isStorageLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function"
  );
}

function getDefaultStorage() {
  try {
    return isStorageLike(globalThis.localStorage) ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function normalizeTtlMs(ttlMs, fallback) {
  const n = typeof ttlMs === "number" ? ttlMs : Number(ttlMs);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function normalizeProviderId(value, fallback) {
  const id = toNonEmptyString(value);
  return id || toNonEmptyString(fallback) || null;
}

function normalizeCacheLimit(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function keyOf(providerId, uri) {
  return `${providerId || "provider_unknown"}:${uri || ""}`;
}

const RESOURCES_CACHE_KEY = "pb_mcp_resources_cache_v1";

const DEFAULT_ENCRYPTION_AAD = "paperburner:mcp-resource-cache:v1";

function normalizeEncryptionConfig(input) {
  const cfg = input && typeof input === "object" ? input : {};
  const passphrase = toNonEmptyString(cfg.passphrase);
  const enabled = Boolean(cfg.enabled ?? passphrase);
  const required = Boolean(cfg.required);
  const aad = toNonEmptyString(cfg.aad) || DEFAULT_ENCRYPTION_AAD;
  const iterations = typeof cfg.iterations === "number" && Number.isFinite(cfg.iterations) ? Math.max(10_000, Math.floor(cfg.iterations)) : 100_000;
  return { enabled, passphrase, required, aad, iterations };
}

function isAsyncStore(value) {
  return value !== null && typeof value === "object" && typeof value.get === "function" && typeof value.set === "function";
}

function hasIndexedDB() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
  } catch {
    return false;
  }
}

function getDefaultAsyncStore() {
  if (isNodeLike()) return null;
  if (!hasIndexedDB()) return null;
  return new FallbackAdapter("paperburner_mcp_cache_db_v1", "mcp_cache_kv");
}

async function storeGet(store, key) {
  if (!store) return null;
  if (isStorageLike(store)) {
    try {
      const v = store.getItem(String(key));
      return v === null || v === undefined ? null : String(v);
    } catch {
      return null;
    }
  }
  if (isAsyncStore(store)) {
    try {
      return await store.get(String(key));
    } catch {
      return null;
    }
  }
  return null;
}

async function storeSetAsync(store, key, value) {
  if (!store) return false;
  if (isStorageLike(store)) {
    try {
      store.setItem(String(key), String(value));
      return true;
    } catch {
      return false;
    }
  }
  if (isAsyncStore(store)) {
    try {
      await store.set(String(key), value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeVersionFieldValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const s = value.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.floor(value));
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return null;
}

function readVersionField(obj, keys) {
  if (!isPlainObject(obj)) return null;
  for (const key of keys) {
    const value = normalizeVersionFieldValue(obj[key]);
    if (value) return value;
  }
  return null;
}

function extractVersionInfo(value) {
  if (!isPlainObject(value)) return { etag: null, lastModified: null };
  const annotations = isPlainObject(value.annotations) ? value.annotations : null;
  const meta = isPlainObject(value.meta) ? value.meta : null;
  const firstContent =
    Array.isArray(value.contents) && value.contents.length > 0 && isPlainObject(value.contents[0]) ? value.contents[0] : null;

  const etag = readVersionField(value, ["etag", "eTag", "revision", "version"])
    || readVersionField(annotations, ["etag", "eTag", "revision", "version"])
    || readVersionField(meta, ["etag", "eTag", "revision", "version"])
    || readVersionField(firstContent, ["etag", "eTag", "revision", "version"]);

  const lastModified = readVersionField(value, ["lastModified", "last_modified", "updatedAt", "modifiedAt", "mtime", "ts"])
    || readVersionField(annotations, ["lastModified", "last_modified", "updatedAt", "modifiedAt", "mtime", "ts"])
    || readVersionField(meta, ["lastModified", "last_modified", "updatedAt", "modifiedAt", "mtime", "ts"])
    || readVersionField(firstContent, ["lastModified", "last_modified", "updatedAt", "modifiedAt", "mtime", "ts"]);

  return { etag, lastModified };
}

function hasVersionInfo(version) {
  return Boolean(version && (toNonEmptyString(version.etag) || toNonEmptyString(version.lastModified)));
}

function isVersionConsistent(cachedVersion, latestVersion) {
  if (!hasVersionInfo(cachedVersion)) return true;
  if (!hasVersionInfo(latestVersion)) return true;

  const cachedEtag = toNonEmptyString(cachedVersion.etag);
  const latestEtag = toNonEmptyString(latestVersion.etag);
  if (cachedEtag && latestEtag && cachedEtag !== latestEtag) return false;
  if (!cachedEtag && latestEtag) return false;

  const cachedLastModified = toNonEmptyString(cachedVersion.lastModified);
  const latestLastModified = toNonEmptyString(latestVersion.lastModified);
  if (cachedLastModified && latestLastModified && cachedLastModified !== latestLastModified) return false;
  if (!cachedLastModified && latestLastModified && !cachedEtag) return false;

  return true;
}

/**
 * McpResourceManager (browser-first)
 *
 * Implements a minimal, Claude-Code-like resource manager:
 * - list resources / templates
 * - read resources with TTL cache
 * - subscribe to resource updates via provider notifications (SSE when available)
 * @param {McpResourceManagerOptions} [options]
 * @returns {McpResourceManager}
 */
export class McpResourceManager {
  /**
   * @param {McpResourceManagerOptions} [options]
   */
  constructor({
    client,
    storage,
    defaultTtlMs = 60_000,
    maxPersistBytes = 50_000,
    maxContentCacheEntries = 500,
    maxContentCacheBytes = 10_000_000, // 10MB 内存缓存上限
    persistStrict = false,
    encryption,
  } = {}) {
    this.client = client instanceof McpClient ? client : null;
    this.storage =
      storage === null
        ? null
        : isStorageLike(storage) || isAsyncStore(storage)
          ? storage
          : getDefaultAsyncStore() || getDefaultStorage();
    this.defaultTtlMs = normalizeTtlMs(defaultTtlMs, 60_000);
    this.maxPersistBytes = normalizeTtlMs(maxPersistBytes, 50_000);
    this.maxContentCacheEntries = normalizeCacheLimit(maxContentCacheEntries, 500);
    this.maxContentCacheBytes = normalizeCacheLimit(maxContentCacheBytes, 10_000_000);
    this.persistStrict = persistStrict === true;

    const enc = normalizeEncryptionConfig(encryption);
    if (enc.enabled && (!enc.passphrase || !canUseStorageEncryption())) {
      if (enc.required) throw new Error("McpResourceManager: encryption is required but unavailable (missing passphrase or WebCrypto)");
      this.encryption = { ...enc, enabled: false, available: canUseStorageEncryption() };
    } else {
      this.encryption = { ...enc, available: canUseStorageEncryption() };
    }

    this._listCache = new Map(); // providerId -> { ts, ttlMs, resources }
    this._templatesCache = new Map(); // providerId -> { ts, ttlMs, templates }
    this._contentCache = new Map(); // providerId:uri -> { ts, ttlMs, content, byteSize, etag?, lastModified? }
    this._contentCacheTotalBytes = 0; // 当前缓存总字节数

    this._subs = new Map(); // subId -> { providerId, uri, callback }
    this._subSeq = 0;
    this._serverSubRefCounts = new Map(); // providerId:uri -> count
    this._providerNotifyUnsub = new Map(); // providerId -> unsubscribe()
    this._providerNotifyProvider = new Map(); // providerId -> provider instance

    this._initPromise = null;
    this._ttlCleanupInterval = null;
    this._persistQueue = Promise.resolve();
    this._persistQueueDepth = 0;
    this._stats = {
      evictions: { expired: 0, byteBudget: 0, entryBudget: 0, explicit: 0 },
      hydrate: { loaded: 0, droppedExpired: 0, droppedInvalid: 0, droppedVersionMismatch: 0 },
      persist: { attempted: 0, succeeded: 0, failed: 0, pending: 0, lastError: null },
      subscriptions: { providerReplacements: 0, resubscribeAttempts: 0, resubscribeFailures: 0 },
    };
  }

  /**
   * Initialize the resource manager (hydrate cache, start TTL cleanup).
   * Safe to call multiple times - only initializes once.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      await this._hydratePersistedCache();
      this._startTtlCleanup();
    })();

    return this._initPromise;
  }

  getStats() {
    return {
      evictions: { ...this._stats.evictions },
      hydrate: { ...this._stats.hydrate },
      persist: { ...this._stats.persist },
      subscriptions: { ...this._stats.subscriptions },
      cache: {
        listProviders: this._listCache.size,
        templateProviders: this._templatesCache.size,
        contentEntries: this._contentCache.size,
        contentBytes: this._contentCacheTotalBytes,
      },
    };
  }

  async flushPersist() {
    try {
      await this._persistQueue;
      return { ok: true, pending: this._persistQueueDepth };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), pending: this._persistQueueDepth };
    }
  }

  _startTtlCleanup() {
    if (this._ttlCleanupInterval) return;
    const intervalMs = Math.max(30_000, this.defaultTtlMs);
    this._ttlCleanupInterval = setInterval(() => {
      this._pruneContentCache();
    }, intervalMs);
    if (typeof this._ttlCleanupInterval.unref === "function") {
      this._ttlCleanupInterval.unref();
    }
  }

  _deleteContentCacheEntry(cacheKey, reason = null) {
    const entry = this._contentCache.get(cacheKey);
    if (!entry) return false;
    this._contentCacheTotalBytes -= entry.byteSize || 0;
    if (this._contentCacheTotalBytes < 0) this._contentCacheTotalBytes = 0;
    this._contentCache.delete(cacheKey);
    if (reason === "explicit") this._stats.evictions.explicit += 1;
    if (reason === "expired") this._stats.evictions.expired += 1;
    if (reason === "byte") this._stats.evictions.byteBudget += 1;
    if (reason === "entry") this._stats.evictions.entryBudget += 1;
    return true;
  }

  _extractCachedVersion(cachedEntry) {
    const etag = normalizeVersionFieldValue(cachedEntry?.etag);
    const lastModified = normalizeVersionFieldValue(cachedEntry?.lastModified);
    if (etag || lastModified) return { etag, lastModified };
    return extractVersionInfo(cachedEntry?.content);
  }

  _findResourceVersionInList(resources, uri) {
    if (!Array.isArray(resources)) return null;
    const target = toNonEmptyString(uri);
    if (!target) return null;
    const hit = resources.find((item) => toNonEmptyString(item?.uri) === target);
    if (!hit) return null;
    const version = extractVersionInfo(hit);
    return hasVersionInfo(version) ? version : null;
  }

  async _loadResourceVersionHint(providerId, provider, uri) {
    const pid = toNonEmptyString(providerId);
    const targetUri = toNonEmptyString(uri);
    if (!pid || !targetUri) return null;

    const now = Date.now();
    const cachedList = this._listCache.get(pid);
    const cachedTtl = normalizeTtlMs(cachedList?.ttlMs, this.defaultTtlMs);
    if (
      cachedList &&
      (cachedTtl <= 0 || now - cachedList.ts <= cachedTtl) &&
      Array.isArray(cachedList.resources)
    ) {
      const version = this._findResourceVersionInList(cachedList.resources, targetUri);
      if (version) return version;
    }

    if (!provider || typeof provider.listResources !== "function") return null;

    try {
      const fetched = await provider.listResources();
      const resources = Array.isArray(fetched) ? fetched : [];
      this._listCache.set(pid, { ts: Date.now(), ttlMs: this.defaultTtlMs, resources });
      this._persistCache();
      return this._findResourceVersionInList(resources, targetUri);
    } catch (err) {
      logger.warn("Resource version hint refresh failed", {
        providerId: pid,
        uri: targetUri,
        error: err?.message || String(err),
      });
      return null;
    }
  }

  async _isCachedEntryVersionConsistent(providerId, provider, uri, cachedEntry) {
    const cachedVersion = this._extractCachedVersion(cachedEntry);
    if (!hasVersionInfo(cachedVersion)) return true;

    const latestVersion = await this._loadResourceVersionHint(providerId, provider, uri);
    if (!hasVersionInfo(latestVersion)) return true;

    return isVersionConsistent(cachedVersion, latestVersion);
  }

  _touchContentCache(cacheKey) {
    const max = this.maxContentCacheEntries;
    if (max === 0 || max === Infinity) return;
    const cached = this._contentCache.get(cacheKey);
    if (!cached) return;
    this._contentCache.delete(cacheKey);
    this._contentCache.set(cacheKey, cached);
  }

  _pruneContentCache(nowMs = Date.now()) {
    const maxEntries = this.maxContentCacheEntries;
    const maxBytes = this.maxContentCacheBytes;
    const limitEntries = typeof maxEntries === "number" && Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0;
    const limitBytes = typeof maxBytes === "number" && Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : Infinity;

    if (limitEntries <= 0 && limitBytes <= 0) {
      this._contentCache.clear();
      this._contentCacheTotalBytes = 0;
      return;
    }

    // 1. 清理过期条目
    for (const [k, v] of this._contentCache.entries()) {
      const ts = typeof v?.ts === "number" && Number.isFinite(v.ts) ? v.ts : 0;
      const ttlMs = typeof v?.ttlMs === "number" && Number.isFinite(v.ttlMs) ? v.ttlMs : 0;
      if (ttlMs > 0 && nowMs - ts > ttlMs) {
        this._deleteContentCacheEntry(k, "expired");
      }
    }

    // 2. 字节配额限制：按 LRU 删除最旧条目直到满足配额
    while (this._contentCacheTotalBytes > limitBytes && this._contentCache.size > 0) {
      const oldest = this._contentCache.keys().next().value;
      if (!oldest) break;
      this._deleteContentCacheEntry(oldest, "byte");
    }

    // 3. 条目数限制
    if (maxEntries !== Infinity) {
      while (this._contentCache.size > limitEntries) {
        const oldest = this._contentCache.keys().next().value;
        if (!oldest) break;
        this._deleteContentCacheEntry(oldest, "entry");
      }
    }
  }

  async _hydratePersistedCache() {
    const raw = await storeGet(this.storage, RESOURCES_CACHE_KEY);
    let parsed = null;
    if (this.encryption?.enabled && typeof raw === "string" && isEncryptedString(raw)) {
      try {
        const text = await decryptString(raw, { passphrase: this.encryption.passphrase, aad: this.encryption.aad });
        parsed = safeJsonParse(text);
      } catch (err) {
        if (this.encryption.required) throw err;
        parsed = null;
      }
    } else {
      parsed = typeof raw === "string" ? safeJsonParse(raw) : isPlainObject(raw) ? raw : null;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.providers)) return;

    const now = Date.now();
    this._contentCacheTotalBytes = 0;
    for (const [providerId, entry] of Object.entries(parsed.providers)) {
      if (!isPlainObject(entry)) {
        this._stats.hydrate.droppedInvalid += 1;
        continue;
      }
      const list = Array.isArray(entry.resources) ? entry.resources : null;
      const templates = Array.isArray(entry.templates) ? entry.templates : null;
      const contents = isPlainObject(entry.contents) ? entry.contents : null;
      const ts = Number.isFinite(Number(entry.ts)) ? Math.floor(Number(entry.ts)) : now;
      const ttlMs = normalizeTtlMs(entry.ttlMs, this.defaultTtlMs);
      if (ttlMs > 0 && now - ts > ttlMs) {
        this._stats.hydrate.droppedExpired += 1;
        continue;
      }

      if (list) this._listCache.set(providerId, { ts, ttlMs, resources: list });
      if (templates) this._templatesCache.set(providerId, { ts, ttlMs, templates });
      if (contents) {
        const versionByUri = new Map();
        if (Array.isArray(list)) {
          for (const resource of list) {
            const uri = toNonEmptyString(resource?.uri);
            if (!uri) continue;
            const version = extractVersionInfo(resource);
            if (!hasVersionInfo(version)) continue;
            versionByUri.set(uri, version);
          }
        }

        for (const [uri, c] of Object.entries(contents)) {
          if (!isPlainObject(c)) {
            this._stats.hydrate.droppedInvalid += 1;
            continue;
          }
          const cts = Number.isFinite(Number(c.ts)) ? Math.floor(Number(c.ts)) : ts;
          const cttl = normalizeTtlMs(c.ttlMs, ttlMs);
          if (cttl > 0 && now - cts > cttl) {
            this._stats.hydrate.droppedExpired += 1;
            continue;
          }
          if (!isPlainObject(c.content)) {
            this._stats.hydrate.droppedInvalid += 1;
            continue;
          }
          const persistedVersion = {
            etag: normalizeVersionFieldValue(c.etag) || extractVersionInfo(c.content).etag,
            lastModified: normalizeVersionFieldValue(c.lastModified) || extractVersionInfo(c.content).lastModified,
          };
          const listVersion = versionByUri.get(uri) || null;
          if (!isVersionConsistent(persistedVersion, listVersion)) {
            this._stats.hydrate.droppedVersionMismatch += 1;
            continue;
          }

          const byteSize = this._estimateContentByteSize(c.content);
          this._contentCache.set(keyOf(providerId, uri), {
            ts: cts,
            ttlMs: cttl,
            content: c.content,
            byteSize,
            etag: persistedVersion.etag || null,
            lastModified: persistedVersion.lastModified || null,
          });
          this._contentCacheTotalBytes += byteSize;
          this._stats.hydrate.loaded += 1;
        }
      }
    }

    this._pruneContentCache(now);
  }

  _enqueuePersistTask(task) {
    if (typeof task !== "function") return false;
    this._stats.persist.attempted += 1;
    this._persistQueueDepth += 1;
    this._stats.persist.pending = this._persistQueueDepth;

    const runTask = async () => {
      try {
        await task();
        this._stats.persist.succeeded += 1;
        this._stats.persist.lastError = null;
        return true;
      } catch (err) {
        this._stats.persist.failed += 1;
        this._stats.persist.lastError = err?.message || String(err);
        logger.warn("Resource cache persist error", { error: this._stats.persist.lastError });
        if (this.persistStrict) throw err;
        return false;
      } finally {
        this._persistQueueDepth = Math.max(0, this._persistQueueDepth - 1);
        this._stats.persist.pending = this._persistQueueDepth;
      }
    };

    const next = this._persistQueue.catch(() => undefined).then(runTask);
    this._persistQueue = next.then(
      () => undefined,
      () => undefined
    );
    return true;
  }

  _persistCache() {
    const store = this.storage;
    if (!store) return false;

    this._pruneContentCache();

    const providers = {};
    const contentProviderIds = new Set();
    for (const cacheKey of this._contentCache.keys()) {
      const idx = String(cacheKey).indexOf(":");
      if (idx > 0) contentProviderIds.add(String(cacheKey).slice(0, idx));
    }
    for (const providerId of new Set([
      ...Array.from(this._listCache.keys()),
      ...Array.from(this._templatesCache.keys()),
      ...Array.from(contentProviderIds),
    ])) {
      const list = this._listCache.get(providerId);
      const templates = this._templatesCache.get(providerId);

      const contents = {};
      for (const [k, v] of this._contentCache.entries()) {
        if (!k.startsWith(`${providerId}:`)) continue;
        const uri = k.slice(providerId.length + 1);
        const content = v?.content;
        if (!isPlainObject(content)) continue;

        // Persist only small-ish textual resources; avoid blowing up localStorage.
        const text = typeof content.text === "string" ? content.text : "";
        const approxBytes = text.length;
        if (approxBytes > this.maxPersistBytes) continue;
        const version = {
          etag: normalizeVersionFieldValue(v?.etag) || extractVersionInfo(content).etag,
          lastModified: normalizeVersionFieldValue(v?.lastModified) || extractVersionInfo(content).lastModified,
        };
        contents[uri] = {
          ts: v.ts,
          ttlMs: v.ttlMs,
          content,
          ...(version.etag ? { etag: version.etag } : {}),
          ...(version.lastModified ? { lastModified: version.lastModified } : {}),
        };
      }

      providers[providerId] = {
        ts: list?.ts ?? templates?.ts ?? Date.now(),
        ttlMs: list?.ttlMs ?? templates?.ttlMs ?? this.defaultTtlMs,
        ...(Array.isArray(list?.resources) ? { resources: list.resources } : {}),
        ...(Array.isArray(templates?.templates) ? { templates: templates.templates } : {}),
        ...(Object.keys(contents).length ? { contents } : {}),
      };
    }

    const payload = { schemaVersion: "0.1", ts: Date.now(), providers };

    // Enforce an overall persistence size budget (best-effort).
    // This is separate from the per-resource `content.text` filter above and helps avoid
    // blowing up localStorage / storage quotas with large resource lists or metadata.
    let json = null;
    try {
      json = JSON.stringify(payload);
    } catch {
      this._stats.persist.failed += 1;
      this._stats.persist.lastError = "serialize_failed";
      return false;
    }
    if (typeof this.maxPersistBytes === "number" && Number.isFinite(this.maxPersistBytes) && this.maxPersistBytes >= 0) {
      if (json.length > this.maxPersistBytes) {
        this._stats.persist.failed += 1;
        this._stats.persist.lastError = "payload_too_large";
        return false;
      }
    }

    return this._enqueuePersistTask(async () => {
      if (this.encryption?.enabled) {
        const encrypted = await encryptString(json, {
          passphrase: this.encryption.passphrase,
          aad: this.encryption.aad,
          iterations: this.encryption.iterations,
        });
        const ok = await storeSetAsync(store, RESOURCES_CACHE_KEY, encrypted);
        if (!ok) throw new Error("persist_write_failed");
        return;
      }
      const value = isStorageLike(store) ? json : payload;
      const ok = await storeSetAsync(store, RESOURCES_CACHE_KEY, value);
      if (!ok) throw new Error("persist_write_failed");
    });
  }

  _getProvider(providerId) {
    const c = this.client;
    if (!c) throw new Error("McpResourceManager: missing client");
    const id = normalizeProviderId(providerId, c._defaultProviderId);
    if (!id) throw new Error("McpResourceManager: missing providerId");
    const p = c.getProvider(id);
    if (!p) throw new Error(`McpResourceManager: no provider: ${id}`);

    // Best-effort: if we have active subscriptions, keep provider notifications attached
    // and refresh wiring when providers are replaced.
    if (Array.from(this._subs.values()).some((s) => s.providerId === id)) {
      this._ensureProviderNotifications(id, p);
    }
    return { providerId: id, provider: p };
  }

  /**
   * @param {string=} providerId
   * @returns {void}
   */
  invalidateResourcesList(providerId) {
    const { providerId: id } = this._getProvider(providerId);
    this._listCache.delete(id);
    this._persistCache();
  }

  /**
   * @param {string=} providerId
   * @param {string=} uri
   * @returns {void}
   */
  invalidateResource(providerId, uri) {
    const { providerId: id } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) return;
    this._deleteContentCacheEntry(keyOf(id, u), "explicit");
    this._persistCache();
  }

  /**
   * @param {{ providerId?: string, ttlMs?: number }=} options
   * @returns {Promise<McpResourceDefinition[]>}
   */
  async listResources({ providerId, ttlMs } = {}) {
    await this.init();
    const { providerId: id, provider } = this._getProvider(providerId);
    const ttl = normalizeTtlMs(ttlMs, this.defaultTtlMs);
    const cached = this._listCache.get(id);
    const now = Date.now();
    if (cached && (ttl <= 0 || now - cached.ts <= ttl)) return cached.resources;

    const list = typeof provider.listResources === "function" ? await provider.listResources() : [];
    const resources = Array.isArray(list) ? list : [];
    this._listCache.set(id, { ts: Date.now(), ttlMs: ttl, resources });
    this._persistCache();
    return resources;
  }

  /**
   * @param {{ providerId?: string, ttlMs?: number }=} options
   * @returns {Promise<McpResourceTemplateDefinition[]>}
   */
  async listResourceTemplates({ providerId, ttlMs } = {}) {
    await this.init();
    const { providerId: id, provider } = this._getProvider(providerId);
    const ttl = normalizeTtlMs(ttlMs, this.defaultTtlMs);
    const cached = this._templatesCache.get(id);
    const now = Date.now();
    if (cached && (ttl <= 0 || now - cached.ts <= ttl)) return cached.templates;

    const list = typeof provider.listResourceTemplates === "function" ? await provider.listResourceTemplates() : [];
    const templates = Array.isArray(list) ? list : [];
    this._templatesCache.set(id, { ts: Date.now(), ttlMs: ttl, templates });
    this._persistCache();
    return templates;
  }

  /**
   * @param {{ providerId?: string, uri?: string, forceRefresh?: boolean, ttlMs?: number }=} options
   * @returns {Promise<McpResourceContent>}
   */
  async readResource({ providerId, uri, forceRefresh = false, ttlMs } = {}) {
    await this.init();
    const { providerId: id, provider } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) throw new Error("readResource: uri is required");
    const ttl = normalizeTtlMs(ttlMs, this.defaultTtlMs);

    const cacheKey = keyOf(id, u);
    const now = Date.now();
    this._pruneContentCache(now);
    const cached = this._contentCache.get(cacheKey);
    if (!forceRefresh && cached && (ttl <= 0 || now - cached.ts <= ttl)) {
      const versionOk = await this._isCachedEntryVersionConsistent(id, provider, u, cached);
      if (versionOk) {
        this._touchContentCache(cacheKey);
        return cached.content;
      }
      this._deleteContentCacheEntry(cacheKey, "explicit");
    }

    if (typeof provider.readResource !== "function") {
      throw new Error(`Provider ${id} does not support resources/read`);
    }

    const content = await provider.readResource(u);
    const normalizedContent = isPlainObject(content) ? content : { uri: u };
    const version = extractVersionInfo(normalizedContent);

    // 估算内容字节大小
    const byteSize = this._estimateContentByteSize(normalizedContent);

    // 如果已有旧缓存，先减去旧大小
    const oldCached = this._contentCache.get(cacheKey);
    if (oldCached) {
      this._deleteContentCacheEntry(cacheKey, "explicit");
    }

    this._contentCache.set(cacheKey, {
      ts: Date.now(),
      ttlMs: ttl,
      content: normalizedContent,
      byteSize,
      etag: version.etag,
      lastModified: version.lastModified,
    });
    this._contentCacheTotalBytes += byteSize;

    this._pruneContentCache();
    this._persistCache();
    // If the cache entry was immediately pruned due to size/entry limits, still return the fetched content.
    const latest = this._contentCache.get(cacheKey);
    return latest ? latest.content : normalizedContent;
  }

  _estimateContentByteSize(content) {
    if (!content) return 0;
    if (typeof content === "string") return content.length * 2; // UTF-16 估算
    if (content instanceof ArrayBuffer) return content.byteLength;
    if (ArrayBuffer.isView(content)) return content.byteLength;

    // 对象：估算 JSON 序列化大小
    try {
      const json = JSON.stringify(content);
      return json ? json.length * 2 : 0;
    } catch {
      return 1000; // fallback
    }
  }

  /**
   * @param {{ providerId?: string, uri?: string, callback?: McpResourceUpdateCallback }|string=} options
   * @param {McpResourceUpdateCallback=} callback
   * @returns {Promise<McpResourceSubscription>}
   */
  async subscribeResource(options = {}, callback) {
    await this.init();

    // Support a few calling conventions:
    // - subscribeResource({ providerId, uri, callback })
    // - subscribeResource({ providerId, uri }, callback)
    // - subscribeResource(providerId, uri, callback)
    // - subscribeResource(uri, callback)
    let providerId;
    let uri;
    let cb = callback;

    if (isPlainObject(options)) {
      const normalizedOptions = /** @type {{ providerId?: string, uri?: string, callback?: McpResourceUpdateCallback }} */ (options);
      providerId = normalizedOptions.providerId;
      uri = normalizedOptions.uri;
      if (typeof normalizedOptions.callback === "function") cb = normalizedOptions.callback;
    } else if (typeof options === "string") {
      // Positional form: (providerId, uri, callback) or (uri, callback)
      providerId = options;
    }

    // Handle positional args when called as (providerId, uri, cb) or (uri, cb).
    if (typeof options === "string") {
      // Heuristic: treat first arg as URI when it "looks like" one and 2nd arg is a function.
      if (typeof arguments[1] === "function" && arguments.length === 2 && options.includes("://")) {
        uri = options;
        providerId = undefined;
        cb = arguments[1];
      } else {
        uri = arguments[1];
        cb = arguments[2];
      }
    }

    // Allow (options, callback) where callback is supplied as 2nd argument.
    if (typeof cb !== "function" && typeof callback === "function") cb = callback;

    const { providerId: id, provider } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) throw new Error("subscribeResource: uri is required");
    if (typeof cb !== "function") throw new TypeError("subscribeResource: callback must be a function");

    const subId = `sub_${++this._subSeq}`;
    this._subs.set(subId, { providerId: id, uri: u, callback: cb });

    // Ensure notification stream after local subscription is registered (avoid missing early updates).
    this._ensureProviderNotifications(id, provider);

    const refKey = keyOf(id, u);
    const cur = this._serverSubRefCounts.get(refKey) || 0;
    this._serverSubRefCounts.set(refKey, cur + 1);
    if (cur === 0 && typeof provider.subscribeResource === "function") {
      try {
        await provider.subscribeResource(u);
      } catch {
        // ignore server-side subscribe failures
      }
    }

    return {
      id: subId,
      providerId: id,
      uri: u,
      unsubscribe: async () => this.unsubscribeResource(subId),
    };
  }

  /**
   * @param {string} subId
   * @returns {Promise<{ ok: boolean }>}
   */
  async unsubscribeResource(subId) {
    const sub = this._subs.get(subId);
    if (!sub) return { ok: true };
    this._subs.delete(subId);

    const refKey = keyOf(sub.providerId, sub.uri);
    const cur = this._serverSubRefCounts.get(refKey) || 0;
    const next = Math.max(0, cur - 1);
    if (next === 0) this._serverSubRefCounts.delete(refKey);
    else this._serverSubRefCounts.set(refKey, next);

    const provider = this.client?.getProvider(sub.providerId);
    if (provider && next === 0 && typeof provider.unsubscribeResource === "function") {
      try {
        await provider.unsubscribeResource(sub.uri);
      } catch {
        // ignore
      }
    }

    if (!Array.from(this._subs.values()).some((s) => s.providerId === sub.providerId)) {
      this._stopProviderNotifications(sub.providerId);
    }

    return { ok: true };
  }

  _ensureProviderNotifications(providerId, provider) {
    const currentProvider = this._providerNotifyProvider.get(providerId);
    if (currentProvider && currentProvider !== provider) {
      this._stats.subscriptions.providerReplacements += 1;
      this._stopProviderNotifications(providerId);
      // Re-subscribe server-side resources for the replacement provider.
      void this._resubscribeProviderResources(providerId, provider).then((result) => {
        if (!result?.ok) {
          logger.warn("Resource re-subscribe failed after provider replacement", {
            providerId,
            attempted: result?.attempted || 0,
            failed: Array.isArray(result?.failedUris) ? result.failedUris.length : 0,
          });
        }
      });
    }

    if (this._providerNotifyUnsub.has(providerId)) return;
    if (!provider || typeof provider.subscribeNotifications !== "function") return;

    const off = provider.subscribeNotifications((msg) => {
      try {
        this.handleNotification(providerId, msg);
      } catch {
        // ignore
      }
    });
    this._providerNotifyUnsub.set(providerId, off);
    this._providerNotifyProvider.set(providerId, provider);
  }

  _stopProviderNotifications(providerId) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return false;
    const off = this._providerNotifyUnsub.get(pid);
    if (!off) return false;
    this._providerNotifyUnsub.delete(pid);
    this._providerNotifyProvider.delete(pid);
    try {
      off?.();
    } catch {
      // ignore
    }
    return true;
  }

  async _resubscribeProviderResources(providerId, provider) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return { ok: false, attempted: 0, failedUris: [], reason: "missing_provider_id" };
    if (!provider || typeof provider.subscribeResource !== "function") {
      return { ok: false, attempted: 0, failedUris: [], reason: "provider_not_subscribable" };
    }

    const uris = [];
    const prefix = `${pid}:`;
    for (const [k, count] of this._serverSubRefCounts.entries()) {
      if (!(count > 0)) continue;
      if (!String(k).startsWith(prefix)) continue;
      const uri = String(k).slice(prefix.length);
      if (uri) uris.push(uri);
    }
    if (!uris.length) return { ok: true, attempted: 0, failedUris: [] };

    this._stats.subscriptions.resubscribeAttempts += uris.length;
    const failedUris = [];

    await Promise.all(uris.map(async (uri) => {
      try {
        await provider.subscribeResource(uri);
      } catch {
        failedUris.push(uri);
      }
    }));
    if (failedUris.length > 0) {
      this._stats.subscriptions.resubscribeFailures += failedUris.length;
    }
    return { ok: failedUris.length === 0, attempted: uris.length, failedUris };
  }

  /**
   * Provider notification handler for resource updates.
   * @param {string} providerId
   * @param {any} msg
   * @returns {Promise<void>}
   */
  async handleNotification(providerId, msg) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return;
    if (!isPlainObject(msg)) return;

    const method = toNonEmptyString(msg.method);
    const params = isPlainObject(msg.params) ? msg.params : {};

    if (method === "notifications/resources/list_changed") {
      this._listCache.delete(pid);
      this._persistCache();
      return;
    }

    if (method === "notifications/resources/updated") {
      const uri = toNonEmptyString(params.uri);
      if (!uri) return;
      this._deleteContentCacheEntry(keyOf(pid, uri), "explicit");
      this._persistCache();

      const subs = Array.from(this._subs.values()).filter((s) => s.providerId === pid && s.uri === uri);
      if (subs.length === 0) return;

      let content = null;
      let error = null;
      try {
        content = await this.readResource({ providerId: pid, uri, forceRefresh: true });
      } catch (err) {
        error = String(err?.message || err);
      }

      for (const sub of subs) {
        try {
          sub.callback({ providerId: pid, uri, content, ...(error ? { error } : {}) });
        } catch {
          // ignore callback errors
        }
      }
    }
  }

  /**
   * @returns {void}
   */
  dispose() {
    if (this._ttlCleanupInterval) {
      clearInterval(this._ttlCleanupInterval);
      this._ttlCleanupInterval = null;
    }

    for (const off of this._providerNotifyUnsub.values()) {
      try {
        off?.();
      } catch {
        // ignore
      }
    }
    this._providerNotifyUnsub.clear();

    this._subs.clear();
    this._serverSubRefCounts.clear();
  }
}

export default McpResourceManager;
