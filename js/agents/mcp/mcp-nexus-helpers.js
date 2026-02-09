import { McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { isPlainObject, toNonEmptyString, protoSafeReviver } from "../shared/index.js";

export function cryptoRandomInt(maxExclusive) {
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

export function normalizeBaseUrl(endpoint) {
  const raw = toNonEmptyString(endpoint);
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function normalizeAllowedHosts(raw) {
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

export function normalizeHostname(raw) {
  let h = toNonEmptyString(raw);
  if (!h) return null;
  h = h.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.includes("/") || h.includes("?")) h = h.split(/[/?]/)[0];
  const colonCount = (h.match(/:/g) || []).length;
  if (colonCount === 1 && !h.includes("::")) h = h.split(":")[0];
  return h || null;
}

export function isIpv4Host(hostname) {
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

export function isPrivateIpv4(hostname) {
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

export function isPrivateIpv6(hostname) {
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

export function isPrivateHostname(hostname) {
  const h = normalizeHostname(hostname);
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(h)) return true;
  return false;
}

export function validateEndpointUrl(raw, { allowPrivateNetwork = false, allowedHosts = new Set() } = {}) {
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

export function withTimeout(ms, fn) {
  const timeoutMs = typeof ms === "number" && Number.isFinite(ms) ? Math.max(1, Math.floor(ms)) : null;
  if (timeoutMs === null) return fn({ signal: undefined });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve()
    .then(() => fn({ signal: controller.signal }))
    .finally(() => clearTimeout(t));
}

/**
 * @param {Record<string, string>=} base
 * @param {Record<string, string>=} extra
 * @returns {Record<string, string>}
 */
export function mergeHeaders(base, extra) {
  /** @type {Record<string, string>} */
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

export function normalizeToolDef(raw) {
  if (!isPlainObject(raw)) return null;
  const name = toNonEmptyString(raw.name);
  if (!name) return null;
  const description = toNonEmptyString(raw.description) || "";
  const inputSchema = isPlainObject(raw.inputSchema) ? raw.inputSchema : isPlainObject(raw.input_schema) ? raw.input_schema : isPlainObject(raw.schema) ? raw.schema : null;
  return new McpToolDefinition({ name, description, inputSchema: inputSchema || { type: "object", properties: {} } });
}

export function normalizeToolList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeToolDef).filter(Boolean);
  if (isPlainObject(payload)) {
    const tools = payload.tools ?? payload.data?.tools ?? payload.result?.tools ?? payload.result ?? payload.items ?? payload.data;
    if (Array.isArray(tools)) return tools.map(normalizeToolDef).filter(Boolean);
  }
  return [];
}

export function normalizeToolListFromToolApi(payload) {
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

export function normalizeResourceDef(raw) {
  if (!isPlainObject(raw)) return null;
  const uri = toNonEmptyString(raw.uri);
  if (!uri) return null;
  const name = toNonEmptyString(raw.name) || uri;
  const description = toNonEmptyString(raw.description) || "";
  const mimeType = toNonEmptyString(raw.mimeType) || toNonEmptyString(raw.mime_type) || "";
  const annotations = isPlainObject(raw.annotations) ? raw.annotations : null;
  return { uri, name, description, ...(mimeType ? { mimeType } : {}), ...(annotations ? { annotations } : {}) };
}

export function normalizeResourceList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeResourceDef).filter(Boolean);
  if (isPlainObject(payload)) {
    const resources = payload.resources ?? payload.data?.resources ?? payload.result?.resources ?? payload.result ?? payload.items ?? payload.data;
    if (Array.isArray(resources)) return resources.map(normalizeResourceDef).filter(Boolean);
  }
  return [];
}

export function normalizeResourceTemplateDef(raw) {
  if (!isPlainObject(raw)) return null;
  const uriTemplate = toNonEmptyString(raw.uriTemplate || raw.uri_template || raw.template);
  if (!uriTemplate) return null;
  const name = toNonEmptyString(raw.name) || uriTemplate;
  const description = toNonEmptyString(raw.description) || "";
  const mimeType = toNonEmptyString(raw.mimeType) || toNonEmptyString(raw.mime_type) || "";
  return { uriTemplate, name, description, ...(mimeType ? { mimeType } : {}) };
}

export function normalizeResourceTemplates(payload) {
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

export function base64ToUint8Array(base64) {
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

export function normalizeResourceReadResult(payload) {
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

export function normalizeToolResult(payload) {
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

export function isSuccessfulJsonRpc(resp) {
  return isPlainObject(resp) && resp.jsonrpc === "2.0" && "result" in resp && !("error" in resp);
}

export function jsonRpcErrorMessage(resp) {
  if (!isPlainObject(resp)) return null;
  const err = resp.error;
  if (!isPlainObject(err)) return null;
  const msg = toNonEmptyString(err.message);
  return msg || null;
}

/**
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown, signal?: AbortSignal }=} options
 */
export async function fetchJson(fetchImpl, url, { method = "POST", headers, body, signal } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers: { Accept: "application/json", ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  const parsed = text ? (() => { try { return JSON.parse(text, protoSafeReviver); } catch { return null; } })() : null;
  if (!res.ok) {
    const msg = jsonRpcErrorMessage(parsed) || toNonEmptyString(parsed?.error) || `HTTP ${res.status}`;
    throw new Error(`MCP-Nexus HTTP error: ${msg}`);
  }
  if (parsed === null) throw new Error("MCP-Nexus: invalid JSON response");
  return parsed;
}
