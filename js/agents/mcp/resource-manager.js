import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import { McpClient } from "./mcp-client.js";
import { FallbackAdapter } from "../shared/archive/archive.js";
import { safeJsonParse } from "../shared/utils/safe-json.js";
import { canUseStorageEncryption, decryptString, encryptString, isEncryptedString } from "../shared/utils/storage-crypto.js";

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

function storeSetFireAndForget(store, key, value) {
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
      void store.set(String(key), value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * McpResourceManager (browser-first)
 *
 * Implements a minimal, Claude-Code-like resource manager:
 * - list resources / templates
 * - read resources with TTL cache
 * - subscribe to resource updates via provider notifications (SSE when available)
 */
export class McpResourceManager {
  constructor({
    client,
    storage,
    defaultTtlMs = 60_000,
    maxPersistBytes = 50_000,
    maxContentCacheEntries = 500,
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

    const enc = normalizeEncryptionConfig(encryption);
    if (enc.enabled && (!enc.passphrase || !canUseStorageEncryption())) {
      if (enc.required) throw new Error("McpResourceManager: encryption is required but unavailable (missing passphrase or WebCrypto)");
      this.encryption = { ...enc, enabled: false, available: canUseStorageEncryption() };
    } else {
      this.encryption = { ...enc, available: canUseStorageEncryption() };
    }

    this._listCache = new Map(); // providerId -> { ts, ttlMs, resources }
    this._templatesCache = new Map(); // providerId -> { ts, ttlMs, templates }
    this._contentCache = new Map(); // providerId:uri -> { ts, ttlMs, content }

    this._subs = new Map(); // subId -> { providerId, uri, callback }
    this._subSeq = 0;
    this._serverSubRefCounts = new Map(); // providerId:uri -> count
    this._providerNotifyUnsub = new Map(); // providerId -> unsubscribe()
    this._providerNotifyProvider = new Map(); // providerId -> provider instance

    this._hydrationPromise = this._hydratePersistedCache();
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
    const max = this.maxContentCacheEntries;
    const limit = typeof max === "number" && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;

    if (limit <= 0) {
      this._contentCache.clear();
      return;
    }

    for (const [k, v] of this._contentCache.entries()) {
      const ts = typeof v?.ts === "number" && Number.isFinite(v.ts) ? v.ts : 0;
      const ttlMs = typeof v?.ttlMs === "number" && Number.isFinite(v.ttlMs) ? v.ttlMs : 0;
      if (ttlMs > 0 && nowMs - ts > ttlMs) this._contentCache.delete(k);
    }

    if (max === Infinity) return;
    while (this._contentCache.size > limit) {
      const oldest = this._contentCache.keys().next().value;
      if (!oldest) break;
      this._contentCache.delete(oldest);
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
    for (const [providerId, entry] of Object.entries(parsed.providers)) {
      if (!isPlainObject(entry)) continue;
      const list = Array.isArray(entry.resources) ? entry.resources : null;
      const templates = Array.isArray(entry.templates) ? entry.templates : null;
      const contents = isPlainObject(entry.contents) ? entry.contents : null;
      const ts = Number.isFinite(Number(entry.ts)) ? Math.floor(Number(entry.ts)) : now;
      const ttlMs = normalizeTtlMs(entry.ttlMs, this.defaultTtlMs);
      if (ttlMs > 0 && now - ts > ttlMs) continue;

      if (list) this._listCache.set(providerId, { ts, ttlMs, resources: list });
      if (templates) this._templatesCache.set(providerId, { ts, ttlMs, templates });
      if (contents) {
        for (const [uri, c] of Object.entries(contents)) {
          if (!isPlainObject(c)) continue;
          const cts = Number.isFinite(Number(c.ts)) ? Math.floor(Number(c.ts)) : ts;
          const cttl = normalizeTtlMs(c.ttlMs, ttlMs);
          if (cttl > 0 && now - cts > cttl) continue;
          if (!isPlainObject(c.content)) continue;
          this._contentCache.set(keyOf(providerId, uri), { ts: cts, ttlMs: cttl, content: c.content });
        }
      }
    }

    this._pruneContentCache(now);
  }

  _persistCache() {
    const store = this.storage;
    if (!store) return false;

    this._pruneContentCache();

    const providers = {};
    for (const providerId of new Set([
      ...Array.from(this._listCache.keys()),
      ...Array.from(this._templatesCache.keys()),
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

        contents[uri] = { ts: v.ts, ttlMs: v.ttlMs, content };
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
    if (this.encryption?.enabled) {
      const json = JSON.stringify(payload);
      void encryptString(json, {
        passphrase: this.encryption.passphrase,
        aad: this.encryption.aad,
        iterations: this.encryption.iterations,
      })
        .then((enc) => storeSetFireAndForget(store, RESOURCES_CACHE_KEY, enc))
        .catch(() => {});
      return true;
    }

    const value = isStorageLike(store) ? JSON.stringify(payload) : payload;
    return storeSetFireAndForget(store, RESOURCES_CACHE_KEY, value);
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

  invalidateResourcesList(providerId) {
    const { providerId: id } = this._getProvider(providerId);
    this._listCache.delete(id);
    this._persistCache();
  }

  invalidateResource(providerId, uri) {
    const { providerId: id } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) return;
    this._contentCache.delete(keyOf(id, u));
    this._persistCache();
  }

  async listResources({ providerId, ttlMs } = {}) {
    await this._hydrationPromise;
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

  async listResourceTemplates({ providerId, ttlMs } = {}) {
    await this._hydrationPromise;
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

  async readResource({ providerId, uri, forceRefresh = false, ttlMs } = {}) {
    await this._hydrationPromise;
    const { providerId: id, provider } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) throw new Error("readResource: uri is required");
    const ttl = normalizeTtlMs(ttlMs, this.defaultTtlMs);

    const cacheKey = keyOf(id, u);
    const now = Date.now();
    this._pruneContentCache(now);
    const cached = this._contentCache.get(cacheKey);
    if (!forceRefresh && cached && (ttl <= 0 || now - cached.ts <= ttl)) {
      this._touchContentCache(cacheKey);
      return cached.content;
    }

    if (typeof provider.readResource !== "function") {
      throw new Error(`Provider ${id} does not support resources/read`);
    }

    const content = await provider.readResource(u);
    this._contentCache.set(cacheKey, { ts: Date.now(), ttlMs: ttl, content: isPlainObject(content) ? content : { uri: u } });
    this._pruneContentCache();
    this._persistCache();
    return this._contentCache.get(cacheKey).content;
  }

  async subscribeResource({ providerId, uri, callback } = {}) {
    await this._hydrationPromise;
    const { providerId: id, provider } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) throw new Error("subscribeResource: uri is required");
    if (typeof callback !== "function") throw new TypeError("subscribeResource: callback must be a function");

    const subId = `sub_${++this._subSeq}`;
    this._subs.set(subId, { providerId: id, uri: u, callback });

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
      this._stopProviderNotifications(providerId);
      // Re-subscribe server-side resources for the replacement provider (best-effort).
      void this._resubscribeProviderResources(providerId, provider);
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
    if (!pid) return false;
    if (!provider || typeof provider.subscribeResource !== "function") return false;

    const uris = [];
    const prefix = `${pid}:`;
    for (const [k, count] of this._serverSubRefCounts.entries()) {
      if (!(count > 0)) continue;
      if (!String(k).startsWith(prefix)) continue;
      const uri = String(k).slice(prefix.length);
      if (uri) uris.push(uri);
    }
    if (!uris.length) return true;

    await Promise.all(
      uris.map(async (uri) => {
        try {
          await provider.subscribeResource(uri);
        } catch {
          // ignore
        }
      })
    );
    return true;
  }

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
      this._contentCache.delete(keyOf(pid, uri));
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

  dispose() {
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
