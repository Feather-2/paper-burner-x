import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import { McpClient } from "./mcp-client.js";

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

function safeGetItem(storage, key) {
  if (!isStorageLike(storage)) return null;
  try {
    const v = storage.getItem(String(key));
    return v === null || v === undefined ? null : String(v);
  } catch {
    return null;
  }
}

function safeSetItem(storage, key, value) {
  if (!isStorageLike(storage)) return false;
  try {
    storage.setItem(String(key), String(value));
    return true;
  } catch {
    return false;
  }
}

function safeJsonParse(text) {
  const s = typeof text === "string" ? text.trim() : "";
  if (!s) return null;
  try {
    return JSON.parse(s);
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

function keyOf(providerId, uri) {
  return `${providerId || "provider_unknown"}:${uri || ""}`;
}

const RESOURCES_CACHE_KEY = "pb_mcp_resources_cache_v1";

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
  } = {}) {
    this.client = client instanceof McpClient ? client : null;
    this.storage = isStorageLike(storage) ? storage : getDefaultStorage();
    this.defaultTtlMs = normalizeTtlMs(defaultTtlMs, 60_000);
    this.maxPersistBytes = normalizeTtlMs(maxPersistBytes, 50_000);

    this._listCache = new Map(); // providerId -> { ts, ttlMs, resources }
    this._templatesCache = new Map(); // providerId -> { ts, ttlMs, templates }
    this._contentCache = new Map(); // providerId:uri -> { ts, ttlMs, content }

    this._subs = new Map(); // subId -> { providerId, uri, callback }
    this._subSeq = 0;
    this._serverSubRefCounts = new Map(); // providerId:uri -> count
    this._providerNotifyUnsub = new Map(); // providerId -> unsubscribe()

    this._hydratePersistedCache();
  }

  _hydratePersistedCache() {
    const raw = safeGetItem(this.storage, RESOURCES_CACHE_KEY);
    const parsed = safeJsonParse(raw);
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
  }

  _persistCache() {
    const store = this.storage;
    if (!isStorageLike(store)) return false;

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

    return safeSetItem(store, RESOURCES_CACHE_KEY, JSON.stringify({ schemaVersion: "0.1", ts: Date.now(), providers }));
  }

  _getProvider(providerId) {
    const c = this.client;
    if (!c) throw new Error("McpResourceManager: missing client");
    const id = normalizeProviderId(providerId, c._defaultProviderId);
    if (!id) throw new Error("McpResourceManager: missing providerId");
    const p = c.getProvider(id);
    if (!p) throw new Error(`McpResourceManager: no provider: ${id}`);
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
    const { providerId: id, provider } = this._getProvider(providerId);
    const u = toNonEmptyString(uri);
    if (!u) throw new Error("readResource: uri is required");
    const ttl = normalizeTtlMs(ttlMs, this.defaultTtlMs);

    const cacheKey = keyOf(id, u);
    const cached = this._contentCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && (ttl <= 0 || now - cached.ts <= ttl)) return cached.content;

    if (typeof provider.readResource !== "function") {
      throw new Error(`Provider ${id} does not support resources/read`);
    }

    const content = await provider.readResource(u);
    this._contentCache.set(cacheKey, { ts: Date.now(), ttlMs: ttl, content: isPlainObject(content) ? content : { uri: u } });
    this._persistCache();
    return this._contentCache.get(cacheKey).content;
  }

  async subscribeResource({ providerId, uri, callback } = {}) {
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
  }

  _stopProviderNotifications(providerId) {
    const pid = toNonEmptyString(providerId);
    if (!pid) return false;
    const off = this._providerNotifyUnsub.get(pid);
    if (!off) return false;
    this._providerNotifyUnsub.delete(pid);
    try {
      off?.();
    } catch {
      // ignore
    }
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
