import { describe, it, expect, vi, beforeEach } from "vitest";

const consumeSseJsonMock = vi.hoisted(() =>
  vi.fn(async ({ signal, onJson }) => {
    await Promise.resolve();

    onJson?.({ method: "notifications/tools/list_changed" });
    onJson?.({ method: "custom/event", params: { ok: true } });
    await new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener?.("abort", () => resolve(), { once: true });
    });
  })
);

vi.mock("../../../../js/agents/mcp/sse.js", () => ({
  consumeSseJson: consumeSseJsonMock,
}));

import { McpNexusProvider, __test } from "../../../../js/agents/mcp/mcp-nexus-provider.js";
import { McpToolResult } from "../../../../js/agents/mcp/mcp-client.js";

function makeJsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function makeTextResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return String(text ?? "");
    },
  };
}

function parseJsonBody(init) {
  if (!init?.body) return null;
  try {
    return JSON.parse(String(init.body));
  } catch {
    return null;
  }
}

function makeBarrier() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeDeepNested(depth) {
  let value = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    value = { level: i, next: value };
  }
  return value;
}

const LONG_TEXT = "x".repeat(10000);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();

  consumeSseJsonMock.mockReset();
  consumeSseJsonMock.mockImplementation(async ({ signal, onJson }) => {
    await Promise.resolve();

    onJson?.({ method: "notifications/tools/list_changed" });
    onJson?.({ method: "custom/event", params: { ok: true } });
    await new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener?.("abort", () => resolve(), { once: true });
    });
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected global fetch (network call)");
    })
  );

  vi.stubGlobal(
    "WebSocket",
    class WebSocket {
      constructor() {
        throw new Error("Unexpected WebSocket usage");
      }
    }
  );
});

describe("McpNexusProvider", () => {
  it("requires endpoint and normalizes baseUrl and headers", () => {
    const fetchImpl = vi.fn();

    expect(() => new McpNexusProvider({ fetchImpl })).toThrow(/requires endpoint/i);

    const p = new McpNexusProvider({
      endpoint: "http://nexus.local///",
      headers: { "X-Test": "1", "": "skip", A: 1, B: null, C: undefined },
      authToken: " tok ",
      fetchImpl,
    });

    expect(p.baseUrl).toBe("http://nexus.local");
    expect(p.headers).toMatchObject({ "X-Test": "1", A: "1", Authorization: "Bearer tok" });
    expect(Object.prototype.hasOwnProperty.call(p.headers, "")).toBe(false);
  });

  it("rejects invalid endpoints and enforces private/allowlist rules", () => {
    const fetchImpl = vi.fn();

    expect(() => new McpNexusProvider({ endpoint: "ftp://example.com", fetchImpl })).toThrow(/unsupported url protocol/i);
    expect(() => new McpNexusProvider({ endpoint: "http://[bad", fetchImpl })).toThrow(/invalid endpoint url/i);

    expect(() => new McpNexusProvider({ endpoint: "http://localhost", fetchImpl })).toThrow(/private network/i);

    const allowedPrivate = new McpNexusProvider({ endpoint: "http://localhost", allowPrivateNetwork: true, fetchImpl });
    expect(allowedPrivate.baseUrl).toBe("http://localhost");

    const allowlisted = new McpNexusProvider({ endpoint: "http://127.0.0.1", allowedHosts: ["127.0.0.1"], fetchImpl });
    expect(allowlisted.baseUrl).toBe("http://127.0.0.1");

    expect(() =>
      new McpNexusProvider({ endpoint: "http://example.com", allowedHosts: ["other.example"], fetchImpl })
    ).toThrow(/allowlist/i);

    expect(() =>
      new McpNexusProvider({ endpoint: "http://127.0.0.1", allowedHosts: { host: "127.0.0.1" }, fetchImpl })
    ).toThrow(/private network/i);
  });

  it("throws when neither fetchImpl nor global fetch is available", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new McpNexusProvider({ endpoint: "http://nexus.local" })).toThrow(/requires global fetch/i);
  });

  it("clamps timeout and SSE values at numeric boundaries", () => {
    const p = new McpNexusProvider({
      endpoint: "http://nexus.local",
      fetchImpl: vi.fn(),
      timeoutMs: 0,
      discoveryTimeoutMs: -1,
      sseConnectTimeoutMs: 0,
      sseReconnectBaseMs: -1,
      sseReconnectMaxMs: Number.MAX_SAFE_INTEGER,
    });

    expect(p.timeoutMs).toBe(1);
    expect(p.discoveryTimeoutMs).toBe(200);
    expect(p._sseConnectTimeoutMs).toBe(200);
    expect(p._sseReconnectBaseMs).toBe(50);
    expect(p._sseReconnectMaxMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("uses defaults when timeout options are non-numeric strings", () => {
    const p = new McpNexusProvider({
      endpoint: "http://nexus.local",
      fetchImpl: vi.fn(),
      timeoutMs: "1000",
      discoveryTimeoutMs: "2000",
    });

    expect(p.timeoutMs).toBe(15000);
    expect(p.discoveryTimeoutMs).toBe(5000);
  });

  it("seedToolsCache primes listTools without fetching and rejects empty inputs", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not fetch");
    });

    const provider = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    expect(provider.seedToolsCache(null)).toBe(false);
    expect(provider.seedToolsCache([])).toBe(false);
    expect(provider.seedToolsCache({})).toBe(false);

    expect(
      provider.seedToolsCache([
        { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
      ])
    ).toBe(true);

    const tools = await provider.listTools();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("search.query");
  });

  it("getHealth returns a defensive copy", () => {
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl: vi.fn() });
    expect(p.getHealth()).toBe(null);

    p._health = { ok: true, providerId: "mcp-nexus", endpoint: p.baseUrl, ts: "t", durationMs: 1, transport: null, toolCount: 0, tools: [] };
    const h1 = p.getHealth();
    expect(h1).not.toBe(p._health);
    h1.ok = false;
    expect(p.getHealth().ok).toBe(true);
  });

  it("discovers JSON-RPC transport and supports listTools, callTool, and healthCheck", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      calls.push({ url: String(url), method: init?.method, body });

      if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [{ name: "t1", description: "d1", inputSchema: { type: "object", properties: {} } }] },
        });
      }

      if (String(url).endsWith("/mcp") && body?.method === "tools/call") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { success: true, content: [{ type: "json", data: body?.params?.arguments }] },
        });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, timeoutMs: 2000, discoveryTimeoutMs: 2000 });

    const tools = await p.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("t1");

    const deepArgs = makeDeepNested(12);
    const out = await p.callTool("t1", deepArgs);
    expect(out.success).toBe(true);
    expect(out.content[0].data).toEqual(deepArgs);

    const callBody = calls.find((c) => c.body?.method === "tools/call")?.body;
    expect(callBody?.params?.arguments).toEqual(deepArgs);

    const health = await p.healthCheck({ timeoutMs: 2000, refreshTools: true });
    expect(health.ok).toBe(true);
    expect(health.transport).toBe("jsonrpc");
    expect(health.toolCount).toBe(1);
  });

  it("healthCheck handles ToolAPI and REST transports and records JSON-RPC errors", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);

      if (u.endsWith("/api/tools") && init?.method === "GET") {
        return makeJsonResponse({ success: true, tools: [{ id: "t1", name: "t1", inputSchema: { type: "object", properties: {} } }] });
      }

      if (u.endsWith("/tools/list") && init?.method === "POST") {
        return makeJsonResponse({ tools: [{ name: "t2" }] });
      }

      if (u.endsWith("/mcp") && body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: {} });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const toolApi = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl });
    toolApi._transport = { kind: "toolapi", listUrl: "http://gateway.local/api/tools", executeUrl: "http://gateway.local/api/tools/execute" };
    const h1 = await toolApi.healthCheck({ refreshTools: true, timeoutMs: 1000 });
    expect(h1.ok).toBe(true);
    expect(h1.transport).toBe("toolapi");
    expect(h1.toolCount).toBe(1);

    const rest = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl });
    rest._transport = { kind: "rest", listUrl: "http://rest.local/tools/list", callUrl: "http://rest.local/tools/call" };
    const h2 = await rest.healthCheck({ refreshTools: true, timeoutMs: 1000 });
    expect(h2.ok).toBe(true);
    expect(h2.transport).toBe("rest");
    expect(h2.toolCount).toBe(1);

    const jsonrpc = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    jsonrpc._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    const h3 = await jsonrpc.healthCheck({ refreshTools: true, timeoutMs: 1000 });
    expect(h3.ok).toBe(false);
    expect(String(h3.error)).toMatch(/unexpected response/i);
  });

  it("listTools throws on invalid JSON responses", async () => {
    const fetchImpl = vi.fn(async () => makeTextResponse("not json", { status: 200 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    p._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    await expect(p.listTools()).rejects.toThrow(/invalid json/i);
  });

  it("listTools throws on unexpected JSON-RPC responses", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      if (body?.method === "tools/list") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "bad" } });
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    p._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    await expect(p.listTools()).rejects.toThrow(/tools\/list: unexpected response/i);
  });

  it("discoverTransport falls back across endpoints", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);
      calls.push({ url: u, method: init?.method, body });

      if (u === "http://a.local/mcp") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (u === "http://a.local/rpc") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "ok" }] } });

      if (u === "http://b.local/api/tools") return makeJsonResponse({ success: true, tools: [] });
      if (u === "http://b.local/tools/list") return makeJsonResponse({ tools: [{ name: "rest-ok" }] });

      if (u === "http://c.local/tools/list") return makeJsonResponse({ tools: [] });
      if (u === "http://c.local/mcp/tools/list") return makeJsonResponse({ tools: [{ name: "rest2-ok" }] });

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p1 = new McpNexusProvider({ endpoint: "http://a.local", fetchImpl, discoveryTimeoutMs: 500 });
    const t1 = await p1.listTools();
    expect(t1[0].name).toBe("ok");

    const p2 = new McpNexusProvider({ endpoint: "http://b.local", fetchImpl, discoveryTimeoutMs: 500 });
    const t2 = await p2.listTools();
    expect(t2[0].name).toBe("rest-ok");

    const p3 = new McpNexusProvider({ endpoint: "http://c.local", fetchImpl, discoveryTimeoutMs: 500 });
    const t3 = await p3.listTools();
    expect(t3[0].name).toBe("rest2-ok");

    expect(calls.some((c) => c.url === "http://a.local/mcp")).toBe(true);
    expect(calls.some((c) => c.url === "http://a.local/rpc")).toBe(true);
    expect(calls.some((c) => c.url === "http://b.local/api/tools")).toBe(true);
    expect(calls.some((c) => c.url === "http://b.local/tools/list")).toBe(true);
    expect(calls.some((c) => c.url === "http://c.local/tools/list")).toBe(true);
    expect(calls.some((c) => c.url === "http://c.local/mcp/tools/list")).toBe(true);
  });

  it("fails discovery when no compatible endpoint is found", async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "nope" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://none.local", fetchImpl, discoveryTimeoutMs: 100 });
    await expect(p.listTools()).rejects.toThrow(/discovery failed/i);
  });

  it("callTool normalizes arguments and returns JSON-RPC errors", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      calls.push({ url: String(url), body });

      if (String(url).endsWith("/mcp") && body?.method === "tools/call") {
        if (body?.params?.name === "unknown") {
          return makeJsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { success: true, content: [{ type: "text", text: "ok" }] },
          });
        }
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "bad" } });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    p._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };

    const ok = await p.callTool(null, "not-an-object");
    expect(ok.success).toBe(true);
    expect(ok.getText()).toBe("ok");

    const callBody = calls.find((c) => c.body?.params?.name === "unknown")?.body;
    expect(callBody?.params?.arguments).toEqual({});

    const bad = await p.callTool("t1", {});
    expect(bad.success).toBe(false);
    expect(String(bad.error)).toContain("bad");
  });

  it("callTool handles ToolAPI success:false and REST HTTP errors", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);

      if (u.endsWith("/api/tools/execute") && init?.method === "POST") {
        if (body?.toolId === "bad") return makeJsonResponse({ success: false, message: "nope" });
        return makeJsonResponse({ success: true, result: { success: true, content: [{ type: "text", text: "toolapi-ok" }] } });
      }

      if (u.endsWith("/tools/call") && init?.method === "POST") {
        return makeJsonResponse({ error: "down" }, { status: 500 });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const toolapi = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl });
    toolapi._transport = { kind: "toolapi", listUrl: "http://gateway.local/api/tools", executeUrl: "http://gateway.local/api/tools/execute" };

    const bad = await toolapi.callTool("bad", {});
    expect(bad.success).toBe(false);
    expect(String(bad.error)).toContain("nope");

    const ok = await toolapi.callTool("good", {});
    expect(ok.success).toBe(true);
    expect(ok.getText()).toBe("toolapi-ok");

    const rest = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl });
    rest._transport = { kind: "rest", listUrl: "http://rest.local/tools/list", callUrl: "http://rest.local/tools/call" };
    const out = await rest.callTool("t1", {});
    expect(out.success).toBe(false);
    expect(String(out.error)).toMatch(/http error/i);
  });

  it("listTools refetches after cache invalidation", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);
      calls.push({ url: u, method: init?.method, body });

      if (u.endsWith("/mcp") && body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "jr" }] } });
      }

      if (u.endsWith("/api/tools") && init?.method === "GET") {
        return makeJsonResponse({ success: true, tools: [{ id: "ta", name: "ta" }] });
      }

      if (u.endsWith("/tools/list") && init?.method === "POST") {
        return makeJsonResponse({ tools: [{ name: "rs" }] });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const jsonrpc = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    jsonrpc._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    await jsonrpc.listTools();
    jsonrpc._handleNotificationMessage({ method: "notifications/tools/list_changed" });
    await jsonrpc.listTools();

    const toolapi = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl });
    toolapi._transport = { kind: "toolapi", listUrl: "http://gateway.local/api/tools", executeUrl: "http://gateway.local/api/tools/execute" };
    await toolapi.listTools();
    toolapi._handleNotificationMessage({ method: "notifications/tools/list_changed" });
    await toolapi.listTools();

    const rest = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl, discoveryTimeoutMs: 500 });
    rest._transport = { kind: "rest", listUrl: "http://rest.local/tools/list", callUrl: "http://rest.local/tools/call" };
    await rest.listTools();
    rest._handleNotificationMessage({ method: "notifications/tools/list_changed" });
    await rest.listTools();

    expect(calls.filter((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.url.endsWith("/api/tools") && c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.url.endsWith("/tools/list") && c.method === "POST").length).toBeGreaterThanOrEqual(2);
  });

  it("listTools supports concurrent callers", async () => {
    const barrier = makeBarrier();
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
        await barrier.promise;
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    const p1 = p.listTools();
    const p2 = p.listTools();
    barrier.resolve();

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter((call) => String(call[0]).endsWith("/mcp")).length).toBeGreaterThanOrEqual(2);
  });

  it("generates SSE URL candidates and dedupes entries", () => {
    const fetchImpl = vi.fn();
    const p1 = new McpNexusProvider({ endpoint: "http://nexus.local/http", fetchImpl, sseEndpoint: "/sse" });
    const c1 = p1._getSseUrlCandidates();
    expect(c1).toContain("http://nexus.local/sse");
    expect(c1.filter((u) => u === "http://nexus.local/sse")).toHaveLength(1);

    const p2 = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, sseEndpoint: "http://[bad" });
    const c2 = p2._getSseUrlCandidates();
    expect(c2).toContain("http://[bad");
  });

  it("resources APIs work for JSON-RPC transport including stream flag, long text, large blob, and missing resource", async () => {
    const seen = [];
    const bigBuffer = Buffer.alloc(65536, 1);
    const bigBlob64 = bigBuffer.toString("base64");

    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      seen.push(body);

      if (body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }

      if (body?.method === "resources/list") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { resources: [{ uri: "res://1", name: "R1", mimeType: "text/plain" }] },
        });
      }

      if (body?.method === "resources/templates/list") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { templates: [{ uriTemplate: "res://{id}", name: "T1" }] },
        });
      }

      if (body?.method === "resources/read") {
        if (body?.params?.uri === "res://text") {
          return makeJsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { contents: [{ uri: "res://text", mimeType: "text/plain", text: LONG_TEXT }] },
          });
        }
        if (body?.params?.uri === "res://blob") {
          return makeJsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { contents: [{ uri: "res://blob", mimeType: "application/octet-stream", blob: bigBlob64 }] },
          });
        }
        if (body?.params?.uri === "res://missing") {
          return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { contents: [] } });
        }
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { contents: [{ uri: body?.params?.uri, mimeType: "text/plain", text: "ok" }] },
        });
      }

      if (body?.method === "resources/subscribe" || body?.method === "resources/unsubscribe") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: {} });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    const resources = await p.listResources();
    expect(resources).toHaveLength(1);

    const templates = await p.listResourceTemplates();
    expect(templates).toHaveLength(1);

    await expect(p.readResource("")).rejects.toThrow(/uri is required/i);

    const readText = await p.readResource("res://text");
    expect(readText.text).toBe(LONG_TEXT);

    const readBlob = await p.readResource("res://blob");
    expect(readBlob.blob).toBeInstanceOf(Uint8Array);
    expect(readBlob.blob.length).toBe(65536);

    await expect(p.readResource("res://missing")).rejects.toThrow(/resource not found/i);

    await p.readResource("res://stream", { stream: true });
    const streamCall = seen.find((b) => b?.method === "resources/read" && b?.params?.uri === "res://stream");
    expect(streamCall?.params?.stream).toBe(true);

    await expect(p.subscribeResource("res://1")).resolves.toBe(true);
    await expect(p.unsubscribeResource("res://1")).resolves.toBe(true);
  });

  it("listResources/listResourceTemplates/readResource throw on unexpected JSON-RPC responses", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      if (body?.method === "resources/list") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (body?.method === "resources/templates/list") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (body?.method === "resources/read") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    p._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };

    await expect(p.listResources()).rejects.toThrow(/unexpected response/i);
    await expect(p.listResourceTemplates()).rejects.toThrow(/unexpected response/i);
    await expect(p.readResource("res://1")).rejects.toThrow(/unexpected response/i);
  });

  it("resources APIs are no-ops on non-JSONRPC transports", async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl });
    p._transport = { kind: "rest", listUrl: "http://rest.local/tools/list", callUrl: "http://rest.local/tools/call" };

    await expect(p.listResources()).resolves.toEqual([]);
    await expect(p.listResourceTemplates()).resolves.toEqual([]);
    await expect(p.subscribeResource("res://1")).resolves.toBe(false);
    await expect(p.unsubscribeResource("res://1")).resolves.toBe(false);
    await expect(p.readResource("res://1")).rejects.toThrow(/unsupported transport/i);
  });

  it("subscribeResource/unsubscribeResource validate uri and return false on request failures", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      if (body?.method === "resources/subscribe" || body?.method === "resources/unsubscribe") {
        return makeJsonResponse({ error: { message: "down" } }, { status: 500 });
      }
      if (body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    expect(await p.subscribeResource("")).toBe(false);
    expect(await p.unsubscribeResource(null)).toBe(false);

    expect(await p.subscribeResource("res://1")).toBe(false);
    expect(await p.unsubscribeResource("res://1")).toBe(false);
  });

  it("subscribeNotifications fans out messages, isolates subscriber errors, and avoids duplicate loops", async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local/http", fetchImpl, sseEndpoint: "/custom" });

    p.seedToolsCache([{ name: "t1" }]);
    expect(p._toolsCache).not.toBeNull();

    const badHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    expect(() => p.subscribeNotifications(null)).toThrow(/must be a function/i);

    const unsub1 = p.subscribeNotifications(badHandler);
    const unsub2 = p.subscribeNotifications(goodHandler);

    expect(consumeSseJsonMock.mock.calls.length).toBe(1);
    const firstCall = consumeSseJsonMock.mock.calls[0]?.[0];
    expect(firstCall.url).toBe("http://nexus.local/custom");

    const controller = p._notificationState?.controller;
    expect(controller).toBeInstanceOf(AbortController);

    await Promise.resolve();

    expect(goodHandler).toHaveBeenCalledWith(expect.objectContaining({ method: "notifications/tools/list_changed" }));
    expect(goodHandler).toHaveBeenCalledWith(expect.objectContaining({ method: "custom/event" }));
    expect(p._toolsCache).toBe(null);

    unsub1();
    unsub2();
    expect(p._notificationState?.controller).toBe(null);
  });

  it("subscribeNotifications honors AbortSignal and stops on last unsubscribe", async () => {
    consumeSseJsonMock.mockImplementationOnce(async () => {});
    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    const ac = new AbortController();
    const handler = vi.fn();
    const unsub = p.subscribeNotifications(handler, { signal: ac.signal, reconnect: false });
    ac.abort();
    await Promise.resolve();

    unsub();
    expect(p._notificationState?.controller).toBe(null);
  });

  it("notification loop reconnects with backoff and cleans up state", async () => {
    vi.useFakeTimers();

    let call = 0;
    consumeSseJsonMock.mockImplementation(async ({ signal }) => {
      call += 1;
      if (call === 1) return;
      await new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });

    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    const unsub = p.subscribeNotifications(() => {});
    const controller = p._notificationState?.controller;
    const promise = p._notificationState?.promise;
    expect(controller).toBeInstanceOf(AbortController);

    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(consumeSseJsonMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    controller.abort("stop");
    await promise;

    expect(p._notificationState.controller).toBe(null);
    expect(p._notificationState.promise).toBe(null);

    unsub();
  });

  it("notification loop aborts backoff delay and uses jitter fallback", async () => {
    vi.useFakeTimers();

    consumeSseJsonMock.mockImplementation(async () => {
      throw new Error("connect failed");
    });

    vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("nope"); } });
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, sseReconnectBaseMs: 50, sseReconnectMaxMs: 50 });
    p._getSseUrlCandidates = () => ["http://nexus.local/sse"]; 

    const unsub = p.subscribeNotifications(() => {});

    for (let i = 0; i < 5 && vi.getTimerCount() === 0; i += 1) {
      await Promise.resolve();
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unsub();
    await vi.runAllTimersAsync();
  });
});

describe("__test.normalizeBaseUrl", () => {
  it("trims trailing slashes and handles empty inputs", () => {
    expect(__test.normalizeBaseUrl("http://x///")).toBe("http://x");
    expect(__test.normalizeBaseUrl("")).toBe(null);
    expect(__test.normalizeBaseUrl("   ")).toBe(null);
    expect(__test.normalizeBaseUrl(null)).toBe(null);
    expect(__test.normalizeBaseUrl(undefined)).toBe(null);
  });
});

describe("__test.normalizeToolList", () => {
  it("normalizes arrays and object payloads with schema variants", () => {
    const tools = __test.normalizeToolList([
      { name: "a", description: "d", inputSchema: { type: "object", properties: {} } },
      { name: "b", input_schema: { type: "object", properties: { x: { type: "string" } } } },
      { name: "c", schema: { type: "object", properties: { y: { type: "number" } } } },
      { nope: true },
    ]);

    expect(tools.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(__test.normalizeToolList({ result: { tools: [{ name: "r" }] } })[0].name).toBe("r");
    expect(__test.normalizeToolList({ items: [{ name: "i" }] })[0].name).toBe("i");
  });

  it("returns empty array for non-array or empty payloads", () => {
    expect(__test.normalizeToolList([])).toEqual([]);
    expect(__test.normalizeToolList({})).toEqual([]);
    expect(__test.normalizeToolList({ tools: {} })).toEqual([]);
    expect(__test.normalizeToolList(null)).toEqual([]);
  });
});

describe("__test.normalizeToolListFromToolApi", () => {
  it("normalizes ToolAPI payloads and falls back to id", () => {
    const tools = __test.normalizeToolListFromToolApi({
      success: true,
      tools: [
        { id: "t1", description: "d1" },
        { name: "t2", inputSchema: { type: "object", properties: {} } },
        { nope: true },
      ],
    });

    expect(tools.map((t) => t.name)).toEqual(["t1", "t2"]);
  });

  it("returns empty array for invalid payloads", () => {
    expect(__test.normalizeToolListFromToolApi(null)).toEqual([]);
    expect(__test.normalizeToolListFromToolApi({ tools: {} })).toEqual([]);
  });
});

describe("__test.normalizeToolResult", () => {
  it("passes through McpToolResult and normalizes content variants", () => {
    const existing = new McpToolResult({ success: true, content: [{ type: "text", text: "ok" }] });
    expect(__test.normalizeToolResult(existing)).toBe(existing);

    const r1 = __test.normalizeToolResult({ success: true, content: [{ type: "text", text: "hi" }] });
    expect(r1.getText()).toBe("hi");

    const r2 = __test.normalizeToolResult({ contents: [{ type: "text", text: "x" }] });
    expect(r2.getText()).toBe("x");
  });

  it("wraps null and arbitrary payloads including deep nested data", () => {
    const deep = makeDeepNested(8);

    const r0 = __test.normalizeToolResult(null);
    expect(r0.content).toEqual([]);

    const r3 = __test.normalizeToolResult({ value: Number.MAX_SAFE_INTEGER, deep });
    expect(r3.content[0]).toMatchObject({ type: "json" });
    expect(r3.content[0].data.deep).toEqual(deep);
  });
});

describe("__test.normalizeResourceList", () => {
  it("normalizes resource arrays and object payloads", () => {
    const list = __test.normalizeResourceList([{ uri: "r1" }, { nope: true }]);
    expect(list).toHaveLength(1);
    expect(list[0].uri).toBe("r1");

    const list2 = __test.normalizeResourceList({ data: { resources: [{ uri: "r2" }] } });
    expect(list2[0].uri).toBe("r2");

    const list3 = __test.normalizeResourceList({ result: [{ uri: "r3" }] });
    expect(list3[0].uri).toBe("r3");
  });

  it("returns empty array for invalid payloads", () => {
    expect(__test.normalizeResourceList({})).toEqual([]);
    expect(__test.normalizeResourceList({ resources: {} })).toEqual([]);
    expect(__test.normalizeResourceList(null)).toEqual([]);
  });
});

describe("__test.normalizeResourceTemplates", () => {
  it("normalizes templates and handles alias fields", () => {
    const templates = __test.normalizeResourceTemplates([
      { uriTemplate: "res://{id}" },
      { uri_template: "res://{id2}" },
      { template: "res://{id3}" },
      { nope: true },
    ]);

    expect(templates.map((t) => t.uriTemplate)).toEqual(["res://{id}", "res://{id2}", "res://{id3}"]);

    const t2 = __test.normalizeResourceTemplates({ result: { templates: [{ uriTemplate: "res://{id4}" }] } });
    expect(t2[0].uriTemplate).toBe("res://{id4}");
  });

  it("returns empty array for invalid payloads", () => {
    expect(__test.normalizeResourceTemplates({})).toEqual([]);
    expect(__test.normalizeResourceTemplates({ templates: {} })).toEqual([]);
    expect(__test.normalizeResourceTemplates(null)).toEqual([]);
  });
});

describe("__test.normalizeResourceReadResult", () => {
  it("normalizes text and blob content including long strings", () => {
    const bigBuffer = Buffer.alloc(65536, 1);
    const bigBlob64 = bigBuffer.toString("base64");

    const textResult = __test.normalizeResourceReadResult({
      contents: [{ uri: "res://text", mimeType: "text/plain", text: LONG_TEXT }],
    });
    expect(textResult.text).toBe(LONG_TEXT);

    const blobResult = __test.normalizeResourceReadResult({
      contents: [{ uri: "res://blob", mimeType: "application/octet-stream", blob: bigBlob64 }],
    });
    expect(blobResult.blob).toBeInstanceOf(Uint8Array);
    expect(blobResult.blob.length).toBe(65536);
  });

  it("defaults mimeType and returns null for invalid payloads", () => {
    const read0 = __test.normalizeResourceReadResult({ content: [{ uri: "u0", text: "hi" }] });
    expect(read0.mimeType).toBe("application/octet-stream");

    expect(__test.normalizeResourceReadResult({ contents: [] })).toBe(null);
    expect(__test.normalizeResourceReadResult(null)).toBe(null);
  });

  it("supports atob fallback when Buffer is unavailable", () => {
    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("atob", (s) => (s === "WA==" ? "X" : ""));

    const readAtob = __test.normalizeResourceReadResult({ contents: [{ uri: "u3", blob: "WA==" }] });
    expect(readAtob.blob).toBeInstanceOf(Uint8Array);
    expect(readAtob.blob.length).toBe(1);
  });
});
