import { isPlainObject, toNonEmptyString } from "../shared/utils/value-utils.js";
import { McpClient } from "./mcp-client.js";
import { LocalMcpProvider } from "./local-mcp-provider.js";
import { McpNexusProvider } from "./mcp-nexus-provider.js";
import { FallbackAdapter } from "../shared/archive/archive.js";

const NEXUS_CONFIG_KEY = "mcp_nexus_config";
const MCP_SERVERS_KEY = "pb_mcp_servers";
const TOOLS_CACHE_KEY = "pb_mcp_tools_cache_v1";

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

function safeJsonParse(text) {
  const s = typeof text === "string" ? text.trim() : "";
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeEndpoint(value) {
  const url = toNonEmptyString(value);
  if (!url) return null;
  try {
    return new URL(url).toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

function normalizeHeaders(value) {
  if (!isPlainObject(value)) return null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = toNonEmptyString(k);
    if (!key) continue;
    if (v === undefined || v === null) continue;
    out[key] = String(v);
  }
  return Object.keys(out).length ? out : null;
}

function normalizeNexusConfig(raw) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : isPlainObject(raw) ? raw : null;
  if (isPlainObject(parsed)) {
    const endpoint = normalizeEndpoint(parsed.endpoint || parsed.url || parsed.baseUrl);
    if (!endpoint) return null;
    const sseEndpoint = normalizeEndpoint(parsed.sseEndpoint || parsed.sseUrl || parsed.sse || parsed.eventsEndpoint || parsed.eventsUrl);
    return {
      id: "mcp-nexus",
      endpoint,
      authToken: toNonEmptyString(parsed.authToken || parsed.token),
      headers: normalizeHeaders(parsed.headers),
      enabled: parsed.enabled !== false,
      ...(sseEndpoint ? { sseEndpoint } : {}),
    };
  }

  const endpoint = normalizeEndpoint(raw);
  if (!endpoint) return null;
  return { id: "mcp-nexus", endpoint, authToken: null, headers: null, enabled: true };
}

function normalizeMcpServersConfig(raw) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : isPlainObject(raw) ? raw : null;
  if (!isPlainObject(parsed)) return null;

  const mcpServers = isPlainObject(parsed.mcpServers) ? parsed.mcpServers : isPlainObject(parsed.servers) ? parsed.servers : null;
  if (!mcpServers) return null;

  const out = [];
  for (const [idRaw, defRaw] of Object.entries(mcpServers)) {
    const id = toNonEmptyString(idRaw);
    if (!id) continue;
    if (!isPlainObject(defRaw)) continue;

    const endpoint = normalizeEndpoint(defRaw.endpoint || defRaw.url || defRaw.baseUrl);
    if (!endpoint) continue;
    const sseEndpoint = normalizeEndpoint(defRaw.sseEndpoint || defRaw.sseUrl || defRaw.sse || defRaw.eventsEndpoint || defRaw.eventsUrl);

    out.push({
      id,
      endpoint,
      authToken: toNonEmptyString(defRaw.authToken || defRaw.token),
      headers: normalizeHeaders(defRaw.headers),
      enabled: defRaw.enabled !== false,
      ...(sseEndpoint ? { sseEndpoint } : {}),
    });
  }

  const defaultProviderId = toNonEmptyString(parsed.defaultProvider || parsed.defaultProviderId);

  return {
    servers: out,
    ...(defaultProviderId ? { defaultProviderId } : {}),
  };
}

function normalizeToolsCache(raw) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : isPlainObject(raw) ? raw : null;
  if (!isPlainObject(parsed)) return null;
  const providers = isPlainObject(parsed.providers) ? parsed.providers : null;
  if (!providers) return null;
  const ttlMsRaw = parsed.ttlMs;
  const ttlMs = Number.isFinite(Number(ttlMsRaw)) ? Math.max(0, Math.floor(Number(ttlMsRaw))) : 0;
  const ts = Number.isFinite(Number(parsed.ts)) ? Math.floor(Number(parsed.ts)) : null;
  const now = Date.now();
  if (ts !== null && ttlMs > 0 && now - ts > ttlMs) return null;
  return {
    ts: ts ?? now,
    ttlMs,
    providers,
  };
}

function toToolList(value) {
  return Array.isArray(value) ? value.filter((t) => t && typeof t === "object" && typeof t.name === "string") : [];
}

function seedProviderToolsCache(provider, tools) {
  const list = toToolList(tools);
  if (!list.length) return false;
  if (provider && typeof provider.seedToolsCache === "function") {
    provider.seedToolsCache(list);
    return true;
  }
  // Best-effort for providers that already store _toolsCache internally.
  if (provider && typeof provider === "object" && "_toolsCache" in provider) {
    try {
      provider._toolsCache = list;
      return true;
    } catch {
      return false;
    }
  }
  return false;
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

async function storeSet(store, key, value) {
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

export async function createAutoMcpClient({
  storage,
  useLocal = true,
  localOptions,
  fetchImpl,
} = {}) {
  const store =
    storage === null
      ? null
      : isStorageLike(storage) || isAsyncStore(storage)
        ? storage
        : getDefaultAsyncStore() || getDefaultStorage();
  const client = new McpClient();

  const cachedTools = normalizeToolsCache(await storeGet(store, TOOLS_CACHE_KEY));

  if (useLocal !== false) {
    const workerEndpoint =
      (typeof globalThis !== "undefined" && toNonEmptyString(globalThis.CF_WORKER_ENDPOINT)) ||
      (typeof window !== "undefined" && toNonEmptyString(window.CF_WORKER_ENDPOINT)) ||
      null;
    client.addProvider(
      new LocalMcpProvider({
        id: "local-mcp",
        ...(workerEndpoint ? { workerEndpoint } : {}),
        ...(isPlainObject(localOptions) ? localOptions : {}),
      })
    );
  }

  const serversCfg = normalizeMcpServersConfig(await storeGet(store, MCP_SERVERS_KEY));
  if (serversCfg?.servers?.length) {
    for (const server of serversCfg.servers) {
      if (!server?.enabled) continue;
      const id = toNonEmptyString(server.id);
      const endpoint = normalizeEndpoint(server.endpoint);
      if (!id || !endpoint) continue;
      const provider = new McpNexusProvider({
        id,
        endpoint,
        ...(server.authToken ? { authToken: server.authToken } : {}),
        ...(server.headers ? { headers: server.headers } : {}),
        ...(server.sseEndpoint ? { sseEndpoint: server.sseEndpoint } : {}),
        ...(typeof fetchImpl === "function" ? { fetchImpl } : {}),
      });
      if (cachedTools?.providers?.[id]) seedProviderToolsCache(provider, cachedTools.providers[id]?.tools);
      client.addProvider(provider);
    }

    if (serversCfg.defaultProviderId) {
      client._defaultProviderId = serversCfg.defaultProviderId;
    }
  } else {
    const nexusCfg = normalizeNexusConfig(await storeGet(store, NEXUS_CONFIG_KEY));
    if (nexusCfg?.enabled && nexusCfg.endpoint) {
      const provider = new McpNexusProvider({
        id: nexusCfg.id,
        endpoint: nexusCfg.endpoint,
        ...(nexusCfg.authToken ? { authToken: nexusCfg.authToken } : {}),
        ...(nexusCfg.headers ? { headers: nexusCfg.headers } : {}),
        ...(nexusCfg.sseEndpoint ? { sseEndpoint: nexusCfg.sseEndpoint } : {}),
        ...(typeof fetchImpl === "function" ? { fetchImpl } : {}),
      });
      if (cachedTools?.providers?.[nexusCfg.id]) seedProviderToolsCache(provider, cachedTools.providers[nexusCfg.id]?.tools);
      client.addProvider(provider);
      client._defaultProviderId = nexusCfg.id;
    }
  }

  return client;
}

export async function preloadMcpTools({
  client,
  storage,
  ttlMs = 60_000,
  refresh = false,
} = {}) {
  const c = client instanceof McpClient ? client : null;
  if (!c) throw new Error("preloadMcpTools: client must be an McpClient");

  const store =
    storage === null
      ? null
      : isStorageLike(storage) || isAsyncStore(storage)
        ? storage
        : getDefaultAsyncStore() || getDefaultStorage();

  const providers = c.listProviders();
  const cache = {
    schemaVersion: "0.1",
    kind: "mcp_tools_cache",
    ts: Date.now(),
    ttlMs: Number.isFinite(Number(ttlMs)) ? Math.max(0, Math.floor(Number(ttlMs))) : 60_000,
    providers: {},
  };

  for (const id of providers) {
    const provider = c.getProvider(id);
    if (!provider) continue;
    try {
      let tools = null;
      if (refresh && typeof provider.healthCheck === "function") {
        const r = await provider.healthCheck({ refreshTools: true, timeoutMs: cache.ttlMs });
        tools = Array.isArray(r?.tools) ? r.tools : null;
      }
      if (!Array.isArray(tools)) tools = await provider.listTools();
      cache.providers[id] = {
        ts: Date.now(),
        tools: Array.isArray(tools) ? tools : [],
      };
    } catch {
      // ignore tool preload failures
    }
  }

  // Prefer storing objects in IndexedDB (avoid localStorage 5MB ceiling); fall back to JSON string for legacy storage.
  const payload = isStorageLike(store) ? JSON.stringify(cache) : cache;
  await storeSet(store, TOOLS_CACHE_KEY, payload);
  return cache;
}

export default {
  createAutoMcpClient,
  preloadMcpTools,
};
