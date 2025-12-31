import { McpProvider, McpToolDefinition, McpToolResult } from "./mcp-client.js";
import { TransportKind } from "./constants.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeBaseUrl(endpoint) {
  const raw = toNonEmptyString(endpoint);
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
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

export class McpNexusProvider extends McpProvider {
  constructor({
    id = "mcp-nexus",
    name = "MCP Nexus",
    endpoint,
    headers,
    authToken,
    timeoutMs = 15_000,
    discoveryTimeoutMs = 5_000,
    fetchImpl,
  } = {}) {
    super({ id, name, endpoint });
    this.baseUrl = normalizeBaseUrl(endpoint);
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
  }

  seedToolsCache(tools) {
    const list = Array.isArray(tools) ? tools.map(normalizeToolDef).filter(Boolean) : [];
    if (!list.length) return false;
    this._toolsCache = list;
    return true;
  }

  getHealth() {
    return this._health ? { ...this._health } : null;
  }

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
        this._transport = { kind: TransportKind.JSONRPC, rpcUrl };
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

  async listTools() {
    if (Array.isArray(this._toolsCache) && this._toolsCache.length) return this._toolsCache;
    const transport = await this._discoverTransport();

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
  normalizeBaseUrl,
};
