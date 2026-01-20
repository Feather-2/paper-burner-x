import { McpProvider, McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { TransportKind } from "./constants.js";
import { consumeSseJson } from "./sse.js";
import { validateMcpMessage } from "./mcp-transport.js";

import { isPlainObject, toNonEmptyString } from "../shared/index.js";
import { createLogger } from "../shared/index.js";

const logger = createLogger("mcp/mcp-nexus-provider");

/**
 * @typedef {object} McpNexusProviderOptions
 * @property {string=} id
 * @property {string=} name
 * @property {string=} endpoint
 * @property {Record<string, string>=} headers
 * @property {string=} authToken
 * @property {number=} timeoutMs
 * @property {number=} discoveryTimeoutMs
 * @property {string=} sseEndpoint
 * @property {number=} sseConnectTimeoutMs
 * @property {number=} sseReconnectBaseMs
 * @property {number=} sseReconnectMaxMs
 * @property {boolean=} allowPrivateNetwork - Allow private/loopback endpoints when explicitly enabled.
 * @property {string[]=} allowedHosts - Explicit hostname allowlist (overrides private-network blocking).
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl
 */

/**
 * @typedef {object} McpNexusHealthStatus
 * @property {boolean} ok
 * @property {string} providerId
 * @property {string} endpoint
 * @property {string} ts
 * @property {number} durationMs
 * @property {("jsonrpc"|"rest"|"toolapi"|null)} transport
 * @property {number} toolCount
 * @property {McpToolDefinition[]} tools
 * @property {string=} error
 */

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
 * @typedef {object} McpResourceReadResult
 * @property {string} uri
 * @property {string} mimeType
 * @property {string=} text
 * @property {Uint8Array=} blob
 */

/**
 * @callback McpNotificationHandler
 * @param {any} msg
 * @returns {void}
 */

function cryptoRandomInt(maxExclusive) {
  const max = typeof maxExclusive === "number" && Number.isFinite(maxExclusive) ? Math.floor(maxExclusive) : Number(maxExclusive);
  if (!Number.isFinite(max) || max <= 0) return 0;

  try {
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % max;
    }
  } catch {
    // ignore
  }

  // Fallback: best-effort deterministic jitter when WebCrypto RNG is unavailable.
  return Date.now() % max;
}

function normalizeBaseUrl(endpoint) {
  const raw = toNonEmptyString(endpoint);
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function normalizeAllowedHosts(raw) {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set();
  for (const host of raw) {
    const h = toNonEmptyString(host);
    if (!h) continue;
    const normalized = normalizeHostname(h);
    if (normalized) out.add(normalized);
  }
  return out;
}

function normalizeHostname(raw) {
  let h = toNonEmptyString(raw);
  if (!h) return null;
  h = h.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.includes("/") || h.includes("?")) h = h.split(/[/?]/)[0];
  const colonCount = (h.match(/:/g) || []).length;
  if (colonCount === 1 && !h.includes("::")) h = h.split(":")[0];
  return h || null;
}

function isIpv4Host(hostname) {
  const h = String(hostname || "").trim();
  const parts = h.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function isPrivateIpv4(hostname) {
  if (!isIpv4Host(hostname)) return false;
  const [a, b] = hostname.split(".").map((x) => Number(x));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const h = String(hostname || "").trim().toLowerCase();
  if (!h || !h.includes(":")) return false;
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mapped = (() => {
    const tail = h.slice(h.lastIndexOf(":") + 1);
    if (tail && tail.includes(".") && isIpv4Host(tail)) return tail;
    const m = h.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (!m) return null;
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    const ipv4 = `${a}.${b}.${c}.${d}`;
    return isIpv4Host(ipv4) ? ipv4 : null;
  })();
  if (mapped && isPrivateIpv4(mapped)) return true;
  return false;
}

function isPrivateHostname(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

function validateEndpointUrl(raw, { allowPrivateNetwork = false, allowedHosts = new Set() } = {}) {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return null;

  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Invalid endpoint URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol || "(empty)"}`);
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new Error("Invalid URL hostname");

  const allowlist = allowedHosts instanceof Set ? allowedHosts : normalizeAllowedHosts(allowedHosts);
  const inAllowlist = allowlist.size > 0 && allowlist.has(hostname);

  if (isPrivateHostname(hostname)) {
    if (allowPrivateNetwork === true || inAllowlist) return url.toString().replace(/\/+$/, "");
    throw new Error("Blocked URL hostname (private network)");
  }

  if (allowlist.size > 0 && !inAllowlist) {
    throw new Error("Blocked URL hostname (not in allowlist)");
  }

  return url.toString().replace(/\/+$/, "");
}

function withTimeout(ms, fn) {
  const timeoutMs = typeof ms === "number" && Number.isFinite(ms) ? Math.max(1, Math.floor(ms)) : null;
  if (timeoutMs === null) return fn({ signal: undefined });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve()
    .then(() => fn({ signal: controller.signal }))
    .finally(() => clearTimeout(t));
}

function mergeHeaders(base, extra) {
  const out = {};
  for (const h of [base, extra]) {
    if (!isPlainObject(h)) continue;
    for (const [k, v] of Object.entries(h)) {
      if (!toNonEmptyString(k)) continue;
      if (v === undefined || v === null) continue;
      out[String(k)] = String(v);
    }
  }
  return out;
}

function normalizeToolDef(raw) {
  if (!isPlainObject(raw)) return null;
  const name = toNonEmptyString(raw.name);
  if (!name) return null;
  const description = toNonEmptyString(raw.description) || "";
  const inputSchema = isPlainObject(raw.inputSchema) ? raw.inputSchema : isPlainObject(raw.input_schema) ? raw.input_schema : isPlainObject(raw.schema) ? raw.schema : null;
  return new McpToolDefinition({ name, description, inputSchema: inputSchema || { type: "object", properties: {} } });
}

function normalizeToolList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeToolDef).filter(Boolean);
  if (isPlainObject(payload)) {
    const tools = payload.tools ?? payload.data?.tools ?? payload.result?.tools ?? payload.result ?? payload.items ?? payload.data;
    if (Array.isArray(tools)) return tools.map(normalizeToolDef).filter(Boolean);
  }
  return [];
}

function normalizeToolListFromToolApi(payload) {
  // pb-mcpgateway /api/tools:
  // { success:true, tools:[ { id,name,description,inputSchema,meta:{...} } ] }
  if (!isPlainObject(payload)) return [];
  const tools = payload.tools ?? payload.data?.tools ?? payload.result?.tools ?? payload.result;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => {
      if (!isPlainObject(t)) return null;
      const name = toNonEmptyString(t.name) || toNonEmptyString(t.id);
      if (!name) return null;
      const description = toNonEmptyString(t.description) || "";
      const inputSchema = isPlainObject(t.inputSchema) ? t.inputSchema : null;
      return new McpToolDefinition({ name, description, inputSchema: inputSchema || { type: "object", properties: {} } });
    })
    .filter(Boolean);
}

function normalizeResourceDef(raw) {
  if (!isPlainObject(raw)) return null;
  const uri = toNonEmptyString(raw.uri);
  if (!uri) return null;
  const name = toNonEmptyString(raw.name) || uri;
  const description = toNonEmptyString(raw.description) || "";
  const mimeType = toNonEmptyString(raw.mimeType) || toNonEmptyString(raw.mime_type) || "";
  const annotations = isPlainObject(raw.annotations) ? raw.annotations : null;
  return { uri, name, description, ...(mimeType ? { mimeType } : {}), ...(annotations ? { annotations } : {}) };
}

function normalizeResourceList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeResourceDef).filter(Boolean);
  if (isPlainObject(payload)) {
    const resources = payload.resources ?? payload.data?.resources ?? payload.result?.resources ?? payload.result ?? payload.items ?? payload.data;
    if (Array.isArray(resources)) return resources.map(normalizeResourceDef).filter(Boolean);
  }
  return [];
}

function normalizeResourceTemplateDef(raw) {
  if (!isPlainObject(raw)) return null;
  const uriTemplate = toNonEmptyString(raw.uriTemplate || raw.uri_template || raw.template);
  if (!uriTemplate) return null;
  const name = toNonEmptyString(raw.name) || uriTemplate;
  const description = toNonEmptyString(raw.description) || "";
  const mimeType = toNonEmptyString(raw.mimeType) || toNonEmptyString(raw.mime_type) || "";
  return { uriTemplate, name, description, ...(mimeType ? { mimeType } : {}) };
}

function normalizeResourceTemplates(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeResourceTemplateDef).filter(Boolean);
  if (isPlainObject(payload)) {
    const templates =
      payload.resourceTemplates ??
      payload.resource_templates ??
      payload.templates ??
      payload.items ??
      payload.result?.resourceTemplates ??
      payload.result?.templates;
    if (Array.isArray(templates)) return templates.map(normalizeResourceTemplateDef).filter(Boolean);
  }
  return [];
}

function base64ToUint8Array(base64) {
  const s = toNonEmptyString(base64);
  if (!s) return null;

  // Node.js
  try {
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(s, "base64"));
  } catch {
    // ignore
  }

  // Browser
  try {
    if (typeof atob === "function") {
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
  } catch {
    // ignore
  }

  return null;
}

function normalizeResourceReadResult(payload) {
  if (!isPlainObject(payload)) return null;
  const contents = Array.isArray(payload.contents) ? payload.contents : Array.isArray(payload.content) ? payload.content : null;
  if (!contents || contents.length === 0) return null;
  const first = contents[0];
  if (!isPlainObject(first)) return null;
  const uri = toNonEmptyString(first.uri);
  if (!uri) return null;
  const mimeType = toNonEmptyString(first.mimeType || first.mime_type) || "application/octet-stream";
  const text = toNonEmptyString(first.text);
  const blob64 = toNonEmptyString(first.blob);
  const blob = blob64 ? base64ToUint8Array(blob64) : null;
  return { uri, mimeType, ...(text ? { text } : {}), ...(blob ? { blob } : {}) };
}

function normalizeToolResult(payload) {
  if (payload instanceof McpToolResult) return payload;
  if (payload && typeof payload === "object" && "success" in payload && "content" in payload) {
    return new McpToolResult(payload);
  }
  if (isPlainObject(payload) && (Array.isArray(payload.content) || Array.isArray(payload.contents))) {
    return new McpToolResult({
      success: payload.success !== false && payload.isError !== true,
      isError: Boolean(payload.isError),
      error: payload.error ?? null,
      content: Array.isArray(payload.content) ? payload.content : payload.contents,
    });
  }
  if (payload === null || payload === undefined) return new McpToolResult({ success: true, content: [] });
  return new McpToolResult({ success: true, content: [{ type: "json", data: payload }] });
}

function isSuccessfulJsonRpc(resp) {
  return isPlainObject(resp) && resp.jsonrpc === "2.0" && "result" in resp && !("error" in resp);
}

function jsonRpcErrorMessage(resp) {
  if (!isPlainObject(resp)) return null;
  const err = resp.error;
  if (!isPlainObject(err)) return null;
  const msg = toNonEmptyString(err.message);
  return msg || null;
}

async function fetchJson(fetchImpl, url, { method = "POST", headers, body, signal } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: { Accept: "application/json", ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  const parsed = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) {
    const msg = jsonRpcErrorMessage(parsed) || toNonEmptyString(parsed?.error) || `HTTP ${res.status}`;
    throw new Error(`MCP-Nexus HTTP error: ${msg}`);
  }
  if (parsed === null) throw new Error("MCP-Nexus: invalid JSON response");
  return parsed;
}

/**
 * MCP-Nexus provider implementation (remote MCP endpoint).
 * @extends {McpProvider}
 * @param {McpNexusProviderOptions} [options]
 * @returns {McpNexusProvider}
 */
export class McpNexusProvider extends McpProvider {
  /**
   * @param {McpNexusProviderOptions} [options]
   */
  constructor({
    id = "mcp-nexus",
    name = "MCP Nexus",
    endpoint,
    headers,
    authToken,
    timeoutMs = 15_000,
    discoveryTimeoutMs = 5_000,
    sseEndpoint,
    sseConnectTimeoutMs = 10_000,
    sseReconnectBaseMs = 1_000,
    sseReconnectMaxMs = 30_000,
    allowPrivateNetwork = false,
    allowedHosts,
    fetchImpl,
  } = {}) {
    super({ id, name, endpoint });
    const allowlist = normalizeAllowedHosts(allowedHosts);
    this.baseUrl = validateEndpointUrl(endpoint, { allowPrivateNetwork, allowedHosts: allowlist });
    if (!this.baseUrl) throw new Error("McpNexusProvider requires endpoint");

    const authHeaders = toNonEmptyString(authToken) ? { Authorization: `Bearer ${String(authToken).trim()}` } : null;
    this.headers = mergeHeaders(headers, authHeaders);

    this.timeoutMs = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 15_000;
    this.discoveryTimeoutMs =
      typeof discoveryTimeoutMs === "number" && Number.isFinite(discoveryTimeoutMs) ? Math.max(200, Math.floor(discoveryTimeoutMs)) : 5_000;

    this._fetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    if (typeof this._fetch !== "function") throw new Error("McpNexusProvider requires global fetch or fetchImpl");

    this._transport = null; // { kind:'jsonrpc'|'rest'|'toolapi', rpcUrl?, listUrl?, callUrl?, executeUrl? }
    this._toolsCache = null;
    this._health = null;

    this._sseEndpoint = toNonEmptyString(sseEndpoint) || null;
    this._sseConnectTimeoutMs =
      typeof sseConnectTimeoutMs === "number" && Number.isFinite(sseConnectTimeoutMs) ? Math.max(200, Math.floor(sseConnectTimeoutMs)) : 10_000;
    this._sseReconnectBaseMs =
      typeof sseReconnectBaseMs === "number" && Number.isFinite(sseReconnectBaseMs) ? Math.max(50, Math.floor(sseReconnectBaseMs)) : 1_000;
    this._sseReconnectMaxMs =
      typeof sseReconnectMaxMs === "number" && Number.isFinite(sseReconnectMaxMs) ? Math.max(200, Math.floor(sseReconnectMaxMs)) : 30_000;

    this._urlPolicy = { allowPrivateNetwork: allowPrivateNetwork === true, allowedHosts: allowlist };
    this._notificationState = null; // { subscribers:Set<fn>, controller, promise }
  }

  /**
   * @param {any[]=} tools
   * @returns {boolean}
   */
  seedToolsCache(tools) {
    const list = Array.isArray(tools) ? tools.map(normalizeToolDef).filter(Boolean) : [];
    if (!list.length) return false;
    this._toolsCache = list;
    return true;
  }

  /**
   * @returns {McpNexusHealthStatus|null}
   */
  getHealth() {
    return this._health ? { ...this._health } : null;
  }

  /**
   * @param {{ timeoutMs?: number, refreshTools?: boolean }=} options
   * @returns {Promise<McpNexusHealthStatus>}
   */
  async healthCheck({ timeoutMs, refreshTools = true } = {}) {
    const startedAt = Date.now();
    const timeout =
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? Math.max(200, Math.floor(timeoutMs)) : this.timeoutMs;

    const base = {
      ok: false,
      providerId: this.id,
      endpoint: this.baseUrl,
      ts: new Date().toISOString(),
      durationMs: 0,
      transport: null,
      toolCount: 0,
      tools: [],
    };

    try {
      const transport = await this._discoverTransport();
      base.transport = transport.kind;

      if (transport.kind === TransportKind.JSONRPC) {
        const resp = await withTimeout(timeout, ({ signal }) =>
          fetchJson(this._fetch, transport.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: { jsonrpc: "2.0", id: 99, method: "tools/list", params: {} },
            signal,
          })
        );
        if (!isSuccessfulJsonRpc(resp)) throw new Error("MCP-Nexus healthCheck tools/list: unexpected response");
        const tools = normalizeToolList(resp.result);
        if (refreshTools && tools.length) this._toolsCache = tools;
        base.tools = tools;
        base.toolCount = tools.length;
      } else if (transport.kind === TransportKind.TOOLAPI) {
        const resp = await withTimeout(timeout, ({ signal }) =>
          fetchJson(this._fetch, transport.listUrl, {
            method: "GET",
            headers: { ...this.headers },
            signal,
          })
        );
        const tools = normalizeToolListFromToolApi(resp);
        if (refreshTools && tools.length) this._toolsCache = tools;
        base.tools = tools;
        base.toolCount = tools.length;
      } else {
        const resp = await withTimeout(timeout, ({ signal }) =>
          fetchJson(this._fetch, transport.listUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: {},
            signal,
          })
        );
        const tools = normalizeToolList(resp);
        if (refreshTools && tools.length) this._toolsCache = tools;
        base.tools = tools;
        base.toolCount = tools.length;
      }

      base.ok = true;
    } catch (err) {
      base.ok = false;
      base.error = String(err?.message || err);
    } finally {
      base.durationMs = Date.now() - startedAt;
      this._health = { ...base };
    }

    return { ...base };
  }

  _getSseUrlCandidates() {
    const out = [];
    const seen = new Set();
    const push = (u) => {
      const s = toNonEmptyString(u);
      if (!s) return;
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };

    const base = this.baseUrl;

    if (this._sseEndpoint) {
      try {
        push(new URL(this._sseEndpoint, base).toString().replace(/\/+$/, ""));
      } catch {
        push(String(this._sseEndpoint).replace(/\/+$/, ""));
      }
    }

    // pb-mcpgateway convention: /http -> /sse
    if (base.endsWith("/http")) push(base.replace(/\/http$/, "/sse"));

    push(`${base}/sse`);
    push(`${base}/events`);
    push(`${base}/mcp/sse`);
    push(`${base}/mcp/events`);
    push(`${base}/mcp/stream`);

    return out;
  }

  /**
   * Subscribe to provider notifications (SSE best-effort when available).
   * @param {McpNotificationHandler} handler
   * @param {{ signal?: AbortSignal, reconnect?: boolean }=} options
   * @returns {() => void}
   */
  subscribeNotifications(handler, { signal, reconnect = true } = {}) {
    if (typeof handler !== "function") throw new TypeError("subscribeNotifications(handler): handler must be a function");

    if (!this._notificationState) {
      this._notificationState = {
        subscribers: new Set(),
        controller: null,
        promise: null,
      };
    }

    const state = this._notificationState;
    state.subscribers.add(handler);

    const unsubscribe = () => {
      state.subscribers.delete(handler);
      if (state.subscribers.size === 0) this._stopNotificationLoop();
    };

    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        unsubscribe();
      } else {
        signal.addEventListener("abort", () => unsubscribe(), { once: true });
      }
    }

    if (!state.controller) this._startNotificationLoop({ reconnect: reconnect !== false });
    return unsubscribe;
  }

  _stopNotificationLoop() {
    const state = this._notificationState;
    if (!state?.controller) return;
    try {
      state.controller.abort("no_subscribers");
    } catch {
      // ignore
    }
    state.controller = null;
    state.promise = null;
  }

  async _startNotificationLoop({ reconnect = true } = {}) {
    const state = this._notificationState;
    if (!state) return;
    if (state.controller) return;

    const controller = new AbortController();
    state.controller = controller;

    const delay = (ms) =>
      new Promise((resolve) => {
        if (controller.signal.aborted) return resolve();
        const t = setTimeout(resolve, ms);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true }
        );
      });

    const backoffMs = (attempt) => {
      const exp = Math.min(10, Math.max(0, attempt));
      const base = this._sseReconnectBaseMs;
      const max = this._sseReconnectMaxMs;
      const ms = Math.min(max, base * Math.pow(2, exp));
      const jitter = cryptoRandomInt(200);
      return ms + jitter;
    };

    const candidates = this._getSseUrlCandidates();
    const safeCandidates = candidates.filter((candidate) => {
      try {
        return Boolean(validateEndpointUrl(candidate, this._urlPolicy));
      } catch (err) {
        logger.warn("Skipping unsafe SSE endpoint", { url: candidate, error: err?.message || err });
        return false;
      }
    });
    state.promise = (async () => {
      let attempt = 0;
      while (!controller.signal.aborted) {
        let connected = false;
        for (const url of safeCandidates) {
          if (controller.signal.aborted) break;
          try {
            await consumeSseJson({
              fetchImpl: this._fetch,
              url,
              headers: this.headers,
              signal: controller.signal,
              connectTimeoutMs: this._sseConnectTimeoutMs,
              validateMessage: validateMcpMessage,
              onJson: (msg) => this._handleNotificationMessage(msg),
            });
            connected = true;
            break;
          } catch {
            connected = false;
          }
        }

        if (controller.signal.aborted) break;
        if (!reconnect) break;

        attempt += 1;
        const waitMs = backoffMs(attempt);
        await delay(waitMs);

        // If we never connected and there are no subscribers now, stop.
        if (this._notificationState?.subscribers?.size === 0) break;
        // If we did connect and stream ended, we also reconnect.
        if (connected) continue;
      }
    })()
      .catch((err) => logger.debug("Nexus cleanup error", { error: err.message }))
      .finally(() => {
        if (state.controller === controller) {
          state.controller = null;
          state.promise = null;
        }
      });
  }

  _handleNotificationMessage(msg) {
    if (!isPlainObject(msg)) return;

    const method = toNonEmptyString(msg.method);
    if (method === "notifications/tools/list_changed") this._toolsCache = null;

    const subs = Array.from(this._notificationState?.subscribers || []);
    for (const fn of subs) {
      try {
        fn(msg);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  async _discoverTransport() {
    if (this._transport) return this._transport;

    const candidatesJsonRpc = [`${this.baseUrl}/mcp`, `${this.baseUrl}/rpc`, this.baseUrl];
    const candidatesRestList = [`${this.baseUrl}/tools/list`, `${this.baseUrl}/mcp/tools/list`, `${this.baseUrl}/tools`, `${this.baseUrl}/mcp/tools`];
    const candidatesRestCall = [`${this.baseUrl}/tools/call`, `${this.baseUrl}/mcp/tools/call`, `${this.baseUrl}/call`, `${this.baseUrl}/mcp/call`];
    const candidatesToolApiList = [`${this.baseUrl}/api/tools`];
    const candidatesToolApiExecute = [`${this.baseUrl}/api/tools/execute`];

    // 1) JSON-RPC discovery (tools/list).
    for (const rpcUrl of candidatesJsonRpc) {
      try {
        const resp = await withTimeout(this.discoveryTimeoutMs, ({ signal }) =>
          fetchJson(this._fetch, rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
            signal,
          })
        );
        if (!isSuccessfulJsonRpc(resp)) continue;
        const tools = normalizeToolList(resp.result);
        this._transport = { kind: TransportKind.JSONRPC, rpcUrl };
        if (tools.length) this._toolsCache = tools;
        return this._transport;
      } catch {
        // continue
      }
    }

    // 2) Tool API discovery (pb-mcpgateway /api/tools).
    for (const listUrl of candidatesToolApiList) {
      try {
        const resp = await withTimeout(this.discoveryTimeoutMs, ({ signal }) =>
          fetchJson(this._fetch, listUrl, {
            method: "GET",
            headers: { ...this.headers },
            signal,
          })
        );
        const tools = normalizeToolListFromToolApi(resp);
        if (tools.length === 0) continue;
        this._transport = { kind: TransportKind.TOOLAPI, listUrl, executeUrl: candidatesToolApiExecute[0] };
        this._toolsCache = tools;
        return this._transport;
      } catch {
        // continue
      }
    }

    // 3) REST discovery.
    for (const listUrl of candidatesRestList) {
      try {
        const resp = await withTimeout(this.discoveryTimeoutMs, ({ signal }) =>
          fetchJson(this._fetch, listUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: {},
            signal,
          })
        );
        const tools = normalizeToolList(resp);
        if (tools.length === 0) continue;

        // Pair with a call URL best-effort.
        const callUrl = candidatesRestCall[0];
        this._transport = { kind: TransportKind.REST, listUrl, callUrl };
        this._toolsCache = tools;
        return this._transport;
      } catch {
        // continue
      }
    }

    throw new Error("MCP-Nexus discovery failed: no compatible endpoint found");
  }

  /**
   * @returns {Promise<McpToolDefinition[]>}
   */
  async listTools() {
    if (Array.isArray(this._toolsCache) && this._toolsCache.length) return this._toolsCache;
    const transport = await this._discoverTransport();
    if (Array.isArray(this._toolsCache) && this._toolsCache.length) return this._toolsCache;

    if (transport.kind === TransportKind.JSONRPC) {
      const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
        fetchJson(this._fetch, transport.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
          signal,
        })
      );
      if (!isSuccessfulJsonRpc(resp)) throw new Error("MCP-Nexus tools/list: unexpected response");
      const tools = normalizeToolList(resp.result);
      this._toolsCache = tools;
      return tools;
    }

    if (transport.kind === TransportKind.TOOLAPI) {
      const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
        fetchJson(this._fetch, transport.listUrl, {
          method: "GET",
          headers: { ...this.headers },
          signal,
        })
      );
      const tools = normalizeToolListFromToolApi(resp);
      this._toolsCache = tools;
      return tools;
    }

    const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
      fetchJson(this._fetch, transport.listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: {},
        signal,
      })
    );
    const tools = normalizeToolList(resp);
    this._toolsCache = tools;
    return tools;
  }

  /**
   * @returns {Promise<McpResourceDefinition[]>}
   */
  async listResources() {
    const transport = await this._discoverTransport();
    if (transport.kind !== TransportKind.JSONRPC) return [];

    const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
      fetchJson(this._fetch, transport.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: { jsonrpc: "2.0", id: 11, method: "resources/list", params: {} },
        signal,
      })
    );
    if (!isSuccessfulJsonRpc(resp)) throw new Error("MCP-Nexus resources/list: unexpected response");
    return normalizeResourceList(resp.result);
  }

  /**
   * @returns {Promise<McpResourceTemplateDefinition[]>}
   */
  async listResourceTemplates() {
    const transport = await this._discoverTransport();
    if (transport.kind !== TransportKind.JSONRPC) return [];

    const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
      fetchJson(this._fetch, transport.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: { jsonrpc: "2.0", id: 12, method: "resources/templates/list", params: {} },
        signal,
      })
    );
    if (!isSuccessfulJsonRpc(resp)) throw new Error("MCP-Nexus resources/templates/list: unexpected response");
    return normalizeResourceTemplates(resp.result);
  }

  /**
   * @param {string} uri
   * @param {{ stream?: boolean }=} options
   * @returns {Promise<McpResourceReadResult>}
   */
  async readResource(uri, { stream = false } = {}) {
    const transport = await this._discoverTransport();
    if (transport.kind !== TransportKind.JSONRPC) throw new Error("MCP-Nexus resources/read: unsupported transport");

    const u = toNonEmptyString(uri);
    if (!u) throw new Error("readResource(uri): uri is required");

    const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
      fetchJson(this._fetch, transport.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: { jsonrpc: "2.0", id: 13, method: "resources/read", params: { uri: u, ...(stream ? { stream: true } : {}) } },
        signal,
      })
    );
    if (!isSuccessfulJsonRpc(resp)) throw new Error("MCP-Nexus resources/read: unexpected response");
    const content = normalizeResourceReadResult(resp.result);
    if (!content) throw new Error(`Resource not found: ${u}`);
    return content;
  }

  /**
   * @param {string} uri
   * @returns {Promise<boolean>}
   */
  async subscribeResource(uri) {
    const transport = await this._discoverTransport();
    if (transport.kind !== TransportKind.JSONRPC) return false;
    const u = toNonEmptyString(uri);
    if (!u) return false;
    try {
      const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
        fetchJson(this._fetch, transport.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: { jsonrpc: "2.0", id: 14, method: "resources/subscribe", params: { uri: u } },
          signal,
        })
      );
      return isSuccessfulJsonRpc(resp);
    } catch {
      return false;
    }
  }

  /**
   * @param {string} uri
   * @returns {Promise<boolean>}
   */
  async unsubscribeResource(uri) {
    const transport = await this._discoverTransport();
    if (transport.kind !== TransportKind.JSONRPC) return false;
    const u = toNonEmptyString(uri);
    if (!u) return false;
    try {
      const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
        fetchJson(this._fetch, transport.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: { jsonrpc: "2.0", id: 15, method: "resources/unsubscribe", params: { uri: u } },
          signal,
        })
      );
      return isSuccessfulJsonRpc(resp);
    } catch {
      return false;
    }
  }

  /**
   * @param {string} toolName
   * @param {object} [args]
   * @returns {Promise<McpToolResult>}
   */
  async callTool(toolName, args = {}) {
    const transport = await this._discoverTransport();
    const name = toNonEmptyString(toolName) || "unknown";
    const argumentsObj = isPlainObject(args) ? args : {};

    if (transport.kind === TransportKind.JSONRPC) {
      try {
        const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
          fetchJson(this._fetch, transport.rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: argumentsObj } },
            signal,
          })
        );
        if (!isSuccessfulJsonRpc(resp)) {
          const msg = jsonRpcErrorMessage(resp) || "MCP-Nexus tools/call failed";
          return new McpToolResult({ success: false, isError: true, error: msg, content: [{ type: "text", text: msg }] });
        }
        return normalizeToolResult(resp.result);
      } catch (err) {
        const msg = String(err?.message || err);
        return new McpToolResult({ success: false, isError: true, error: msg, content: [{ type: "text", text: msg }] });
      }
    }

    if (transport.kind === TransportKind.TOOLAPI) {
      try {
        const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
          fetchJson(this._fetch, transport.executeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...this.headers },
            body: { toolId: name, params: argumentsObj },
            signal,
          })
        );
        // pb-mcpgateway: { success:true, result, ... }
        if (isPlainObject(resp) && resp.success === false) {
          const msg = toNonEmptyString(resp?.error?.message) || toNonEmptyString(resp?.message) || "Tool API call failed";
          return new McpToolResult({ success: false, isError: true, error: msg, content: [{ type: "text", text: msg }] });
        }
        const result = isPlainObject(resp) && "result" in resp ? resp.result : resp;
        return normalizeToolResult(result);
      } catch (err) {
        const msg = String(err?.message || err);
        return new McpToolResult({ success: false, isError: true, error: msg, content: [{ type: "text", text: msg }] });
      }
    }

    try {
      const resp = await withTimeout(this.timeoutMs, ({ signal }) =>
        fetchJson(this._fetch, transport.callUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.headers },
          body: { name, arguments: argumentsObj },
          signal,
        })
      );
      return normalizeToolResult(resp);
    } catch (err) {
      const msg = String(err?.message || err);
      return new McpToolResult({ success: false, isError: true, error: msg, content: [{ type: "text", text: msg }] });
    }
  }
}

export const __test = {
  normalizeToolList,
  normalizeToolListFromToolApi,
  normalizeToolResult,
  normalizeResourceList,
  normalizeResourceTemplates,
  normalizeResourceReadResult,
  normalizeBaseUrl,
};
