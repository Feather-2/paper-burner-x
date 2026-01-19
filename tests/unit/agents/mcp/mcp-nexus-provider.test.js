import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// McpNexusProvider uses consumeSseJson() for notifications; mock it to avoid network/streaming.
const consumeSseJsonMock = vi.hoisted(() =>
  vi.fn(async ({ signal, onJson }) => {
    // Give callers a chance to attach subscribers before we emit.
    await Promise.resolve();

    // Emit a couple of notifications immediately, then wait until aborted.
    onJson?.({ method: "notifications/tools/list_changed" });
    onJson?.({ method: "custom/event", params: { ok: true } });
    await new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener?.("abort", () => resolve(), { once: true });
    });
  })
);

vi.mock("../../../js/agents/mcp/sse.js", () => ({
  consumeSseJson: consumeSseJsonMock,
}));

import { McpNexusProvider, __test } from '../../../../js/agents/mcp/mcp-nexus-provider.js';

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

describe("mcp-nexus-provider", () => {
  beforeEach(() => {
    consumeSseJsonMock.mockReset();
    consumeSseJsonMock.mockImplementation(async ({ signal, onJson }) => {
      // Give callers a chance to attach subscribers before we emit.
      await Promise.resolve();

      onJson?.({ method: "notifications/tools/list_changed" });
      onJson?.({ method: "custom/event", params: { ok: true } });
      await new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener?.("abort", () => resolve(), { once: true });
      });
    });

    // Block accidental real network calls (providers in tests always pass fetchImpl).
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("requires endpoint and merges headers + authToken; normalizes baseUrl", () => {
    const fetchImpl = vi.fn();

    expect(() => new McpNexusProvider({ fetchImpl })).toThrow(/requires endpoint/i);

    const p = new McpNexusProvider({
      endpoint: "http://nexus.local///",
      headers: { "X-Test": "1" },
      authToken: "tok",
      fetchImpl,
    });

    expect(p.baseUrl).toBe("http://nexus.local");
    expect(p.headers).toMatchObject({ "X-Test": "1", Authorization: "Bearer tok" });
  });

  it("throws when neither fetchImpl nor global fetch is available", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new McpNexusProvider({ endpoint: "http://nexus.local" })).toThrow(/requires global fetch/i);
  });

  it("filters invalid headers and getHealth() returns a defensive copy", () => {
    const fetchImpl = vi.fn();
    const p = new McpNexusProvider({
      endpoint: "http://nexus.local",
      headers: { "": "x", A: 1, B: null, C: undefined },
      authToken: " tok ",
      fetchImpl,
    });

    expect(p.headers).toMatchObject({ A: "1", Authorization: "Bearer tok" });
    expect(Object.prototype.hasOwnProperty.call(p.headers, "")).toBe(false);
    expect(p.getHealth()).toBe(null);

    p._health = { ok: true, providerId: "mcp-nexus", endpoint: p.baseUrl, ts: "t", durationMs: 1, transport: null, toolCount: 0, tools: [] };
    const h1 = p.getHealth();
    expect(h1).not.toBe(p._health);
    h1.ok = false;
    expect(p.getHealth().ok).toBe(true);
  });

  it("seedToolsCache primes listTools without fetching", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("should not fetch");
    });

    const provider = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    expect(provider.seedToolsCache([null, { nope: true }])).toBe(false);

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

  it("discovers JSON-RPC transport and supports listTools/callTool/healthCheck", async () => {
    /** @type {any[]} */
    const calls = [];

    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      calls.push({ url: String(url), method: init?.method, body });

      if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              { name: "t1", description: "d1", inputSchema: { type: "object", properties: {} } },
              { name: "t2", description: "d2", inputSchema: { type: "object", properties: { a: { type: "string" } } } },
            ],
          },
        });
      }

      if (String(url).endsWith("/mcp") && body?.method === "tools/call") {
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { success: true, content: [{ type: "json", data: { ok: true, name: body?.params?.name } }] },
        });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, timeoutMs: 2000, discoveryTimeoutMs: 2000 });

    const tools = await p.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("t1");

    const out = await p.callTool("t1", { x: 1 });
    expect(out.success).toBe(true);
    expect(out.content[0]).toMatchObject({ type: "json" });
    expect(out.content[0].data).toMatchObject({ ok: true, name: "t1" });

    const health = await p.healthCheck({ timeoutMs: 2000, refreshTools: true });
    expect(health.ok).toBe(true);
    expect(health.transport).toBe("jsonrpc");
    expect(health.toolCount).toBe(2);

    // Discovery used /mcp and did not need to probe /rpc or baseUrl.
    expect(calls.some((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list")).toBe(true);
  });

  it("healthCheck supports TOOLAPI + REST and records errors for unexpected JSON-RPC responses", async () => {
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
        // Used by the JSON-RPC error case.
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

  it("JSON-RPC callTool returns McpToolResult error when server returns JSON-RPC error", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      if (String(url).endsWith("/mcp") && body?.method === "tools/call") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "bad" } });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, sseReconnectBaseMs: 50, sseReconnectMaxMs: 50 });
    const out = await p.callTool("t1", { a: 1 });
    expect(out.success).toBe(false);
    expect(out.isError).toBe(true);
    expect(String(out.error)).toContain("bad");
  });

  it("discovers Tool API transport and surfaces {success:false} as tool error", async () => {
    /** @type {any[]} */
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const method = init?.method || "GET";
      const body = parseJsonBody(init);
      calls.push({ url: String(url), method, body });

      // Force JSON-RPC discovery to fail.
      if (String(url).endsWith("/mcp") || String(url).endsWith("/rpc") || String(url) === "http://gateway.local") {
        return makeJsonResponse({ error: "nope" }, { status: 404 });
      }

      if (String(url).endsWith("/api/tools") && method === "GET") {
        return makeJsonResponse({
          success: true,
          tools: [{ id: "echo", description: "d", inputSchema: { type: "object", properties: { x: { type: "string" } } } }],
        });
      }

      if (String(url).endsWith("/api/tools/execute") && method === "POST") {
        return makeJsonResponse({ success: false, error: { message: "tool failed" } }, { status: 200 });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl, discoveryTimeoutMs: 1000 });

    const tools = await p.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("echo");

    const out = await p.callTool("echo", { x: "1" });
    expect(out.success).toBe(false);
    expect(String(out.error)).toContain("tool failed");

    expect(calls.some((c) => c.url.endsWith("/api/tools") && c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/api/tools/execute") && c.method === "POST")).toBe(true);
  });

  it("discovers REST transport and supports listTools/callTool", async () => {
    /** @type {any[]} */
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      calls.push({ url: String(url), method: init?.method, body });

      // JSON-RPC + Tool API discovery fail.
      if (String(url).endsWith("/mcp") || String(url).endsWith("/rpc") || String(url) === "http://rest.local") {
        return makeJsonResponse({ error: "nope" }, { status: 404 });
      }
      if (String(url).endsWith("/api/tools")) return makeJsonResponse({ error: "nope" }, { status: 404 });

      if (String(url).endsWith("/tools/list")) {
        return makeJsonResponse({
          tools: [{ name: "t1", description: "d", inputSchema: { type: "object", properties: {} } }],
        });
      }

      if (String(url).endsWith("/tools/call")) {
        return makeJsonResponse({
          success: true,
          content: [{ type: "text", text: `ok:${body?.name}` }],
        });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl, discoveryTimeoutMs: 1000 });
    const tools1 = await p.listTools();
    expect(tools1).toHaveLength(1);

    // Cached (no second /tools/list).
    const tools2 = await p.listTools();
    expect(tools2).toHaveLength(1);

    const out = await p.callTool("t1", { a: 1 });
    expect(out.success).toBe(true);
    expect(out.getText()).toBe("ok:t1");

    expect(calls.filter((c) => c.url.endsWith("/tools/list"))).toHaveLength(1);
  });

  it("generates SSE URL candidates (dedupes and tolerates invalid endpoints)", () => {
    const fetchImpl = vi.fn();
    const p1 = new McpNexusProvider({ endpoint: "http://nexus.local/http", fetchImpl, sseEndpoint: "/sse" });
    const c1 = p1._getSseUrlCandidates();
    expect(c1).toContain("http://nexus.local/sse");
    // /http -> /sse mapping should not create duplicates.
    expect(c1.filter((u) => u === "http://nexus.local/sse")).toHaveLength(1);

    const p2 = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, sseEndpoint: "http://[bad" });
    const c2 = p2._getSseUrlCandidates();
    expect(c2).toContain("http://[bad");
  });

  it("throws a helpful error on invalid JSON responses", async () => {
    // Make discovery succeed (JSON-RPC) without seeding a tools cache, then break the follow-up tools/list call.
    let toolsListCalls = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      if (!String(url).endsWith("/mcp") || body?.method !== "tools/list") {
        return makeJsonResponse({ error: "not found" }, { status: 404 });
      }
      toolsListCalls += 1;
      if (toolsListCalls === 1) {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }); // discovery success, no cache
      }
      return makeTextResponse("not json", { status: 200 }); // invalid JSON
    });

    const p = new McpNexusProvider({ endpoint: "http://badjson.local", fetchImpl, discoveryTimeoutMs: 1000 });
    await expect(p.listTools()).rejects.toThrow(/invalid json/i);
  });

  it("resources APIs work on JSON-RPC transport and are no-ops on other transports", async () => {
    const blob64 = Buffer.from("abc").toString("base64");
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      if (!String(url).endsWith("/mcp")) return makeJsonResponse({ error: "not found" }, { status: 404 });

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
        if (body?.params?.uri === "res://blob") {
          return makeJsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { contents: [{ uri: "res://blob", mimeType: "application/octet-stream", blob: blob64 }] },
          });
        }
        return makeJsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { contents: [{ uri: body?.params?.uri, mimeType: "text/plain", text: "hi" }] },
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
    expect(resources[0]).toMatchObject({ uri: "res://1", name: "R1" });

    const templates = await p.listResourceTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ uriTemplate: "res://{id}", name: "T1" });

    await expect(p.readResource("")).rejects.toThrow(/uri is required/i);

    const readText = await p.readResource("res://1");
    expect(readText).toMatchObject({ uri: "res://1", mimeType: "text/plain", text: "hi" });

    const readBlob = await p.readResource("res://blob");
    expect(readBlob.uri).toBe("res://blob");
    expect(readBlob.blob).toBeInstanceOf(Uint8Array);
    expect(readBlob.blob.length).toBe(3);

    await expect(p.subscribeResource("res://1")).resolves.toBe(true);
    await expect(p.unsubscribeResource("res://1")).resolves.toBe(true);
  });

  it("listResources/listResourceTemplates/readResource throw on unexpected JSON-RPC responses", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      if (body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      if (body?.method === "resources/list") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (body?.method === "resources/templates/list") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (body?.method === "resources/read") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
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
      if (body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      if (body?.method === "resources/subscribe" || body?.method === "resources/unsubscribe") {
        // Simulate server failure.
        return makeJsonResponse({ error: { message: "down" } }, { status: 500 });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    expect(await p.subscribeResource("")).toBe(false);
    expect(await p.unsubscribeResource("")).toBe(false);

    expect(await p.subscribeResource("res://1")).toBe(false);
    expect(await p.unsubscribeResource("res://1")).toBe(false);
  });

  it("callTool handles JSON-RPC/ToolAPI/REST error branches and argument normalization", async () => {
    /** @type {any[]} */
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);
      calls.push({ url: u, method: init?.method, body, hasSignal: Boolean(init?.signal) });

      // JSON-RPC
      if (u.endsWith("/mcp") && body?.method === "tools/call") {
        if (body?.params?.name === "unknown") {
          return makeJsonResponse({
            jsonrpc: "2.0",
            id: body.id,
            result: { success: true, content: [{ type: "text", text: "ok" }] },
          });
        }
        // No error.message -> should fall back to default message.
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: {} });
      }

      // ToolAPI
      if (u.endsWith("/api/tools/execute") && init?.method === "POST") {
        return makeJsonResponse({ success: true, result: { success: true, content: [{ type: "text", text: "toolapi-ok" }] } });
      }

      // REST
      if (u.endsWith("/tools/call") && init?.method === "POST") {
        return makeJsonResponse({ error: "down" }, { status: 500 });
      }

      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const jsonrpc = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    jsonrpc._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    jsonrpc.timeoutMs = NaN; // forces withTimeout() to skip creating its own AbortController

    const ok = await jsonrpc.callTool(null, "not-an-object");
    expect(ok.success).toBe(true);
    expect(ok.getText()).toBe("ok");
    expect(calls.find((c) => c.url.endsWith("/mcp"))?.hasSignal).toBe(false);

    const errDefault = await jsonrpc.callTool("t1", {});
    expect(errDefault.success).toBe(false);
    expect(String(errDefault.error)).toContain("tools/call failed");

    const toolapi = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl });
    toolapi._transport = { kind: "toolapi", listUrl: "http://gateway.local/api/tools", executeUrl: "http://gateway.local/api/tools/execute" };
    const out2 = await toolapi.callTool("echo", { a: 1 });
    expect(out2.success).toBe(true);
    expect(out2.getText()).toBe("toolapi-ok");

    const rest = new McpNexusProvider({ endpoint: "http://rest.local", fetchImpl });
    rest._transport = { kind: "rest", listUrl: "http://rest.local/tools/list", callUrl: "http://rest.local/tools/call" };
    const out3 = await rest.callTool("t1", {});
    expect(out3.success).toBe(false);
    expect(String(out3.error)).toMatch(/http error/i);
  });

  it("listTools can refetch after cache invalidation (JSON-RPC / ToolAPI / REST)", async () => {
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

    // Each provider should have performed at least 2 list requests (initial + refetch).
    expect(calls.filter((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.url.endsWith("/api/tools") && c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.url.endsWith("/tools/list") && c.method === "POST").length).toBeGreaterThanOrEqual(2);
  });

  it("discoverTransport handles fallbacks (bad JSON-RPC -> /rpc, empty ToolAPI -> REST, empty REST -> next candidate)", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      const u = String(url);
      const body = parseJsonBody(init);
      calls.push({ url: u, method: init?.method, body });

      // 1) JSON-RPC: /mcp returns error, /rpc succeeds.
      if (u === "http://a.local/mcp") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, error: { message: "nope" } });
      if (u === "http://a.local/rpc") return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "ok" }] } });

      // 2) ToolAPI returns empty tools -> fall back to REST.
      if (u === "http://b.local/api/tools") return makeJsonResponse({ success: true, tools: [] });
      if (u === "http://b.local/tools/list") return makeJsonResponse({ tools: [{ name: "rest-ok" }] });

      // 3) REST returns empty tools -> try next REST candidate.
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

  it("covers notification helpers and AbortSignal wiring", async () => {
    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    // Safe no-ops when state is missing / controller already exists.
    p._stopNotificationLoop();
    await p._startNotificationLoop();
    p._notificationState = { subscribers: new Set(), controller: new AbortController(), promise: null };
    await p._startNotificationLoop();

    // _handleNotificationMessage ignores non-objects.
    p._handleNotificationMessage(null);

    // AbortSignal: handler is auto-unsubscribed on abort.
    consumeSseJsonMock.mockImplementationOnce(async () => {});
    const ac = new AbortController();
    const handler = vi.fn();
    p.subscribeNotifications(handler, { signal: ac.signal, reconnect: false });
    ac.abort();
    await Promise.resolve();
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

  it("readResource(stream:true) includes stream flag in JSON-RPC params", async () => {
    const seen = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      seen.push(body);
      if (body?.method === "resources/read") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { contents: [{ uri: body.params.uri, text: "hi" }] } });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    p._transport = { kind: "jsonrpc", rpcUrl: "http://nexus.local/mcp" };
    await p.readResource("res://1", { stream: true });
    expect(seen.find((b) => b?.method === "resources/read")?.params?.stream).toBe(true);
  });

  it("ToolAPI callTool uses resp.message fallback and supports responses without result", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = parseJsonBody(init);
      // First call: explicit {success:false,message}
      if (body?.toolId === "bad") return makeJsonResponse({ success: false, message: "nope" });
      // Second call: no `result` wrapper.
      return makeJsonResponse({ success: true, content: [{ type: "text", text: "raw" }] });
    });
    const p = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl });
    p._transport = { kind: "toolapi", listUrl: "http://gateway.local/api/tools", executeUrl: "http://gateway.local/api/tools/execute" };

    const bad = await p.callTool("bad", {});
    expect(bad.success).toBe(false);
    expect(String(bad.error)).toContain("nope");

    const raw = await p.callTool("ok", {});
    expect(raw.success).toBe(true);
    expect(raw.getText()).toBe("raw");
  });

  it("notification loop supports reconnect/backoff and cleans up state without _stopNotificationLoop", async () => {
    vi.useFakeTimers();

    let call = 0;
    consumeSseJsonMock.mockImplementation(async ({ signal }) => {
      call += 1;
      if (call === 1) return; // connected=true
      await new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });

    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });

    const unsub = p.subscribeNotifications(() => {});
    const controller = p._notificationState?.controller;
    const promise = p._notificationState?.promise;
    expect(controller).toBeInstanceOf(AbortController);

    // Let the backoff delay elapse and trigger a reconnect (second consumeSseJson call).
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(consumeSseJsonMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    controller.abort("stop");
    await promise;

    expect(p._notificationState.controller).toBe(null);
    expect(p._notificationState.promise).toBe(null);

    unsub();
  });

  it("notification loop backs off on failures and aborts pending delay when unsubscribed", async () => {
    vi.useFakeTimers();
    // Force connection failures to exercise backoff+delay.
    consumeSseJsonMock.mockImplementation(async () => {
      throw new Error("connect failed");
    });

    // Force deterministic jitter fallback path.
    vi.stubGlobal("crypto", { getRandomValues: () => { throw new Error("nope"); } });
    vi.spyOn(Date, "now").mockReturnValue(1234);

    const fetchImpl = vi.fn(async () => makeJsonResponse({ error: "not used" }, { status: 404 }));
    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, sseReconnectBaseMs: 50, sseReconnectMaxMs: 50 });
    // Speed up the candidate loop so we reach the backoff delay quickly.
    p._getSseUrlCandidates = () => ["http://nexus.local/sse"];
    const unsub = p.subscribeNotifications(() => {});

    // Let the loop schedule its backoff timer.
    for (let i = 0; i < 5 && vi.getTimerCount() === 0; i++) {
      await Promise.resolve();
    }
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Unsubscribe triggers abort, which should clear the backoff timer (delay() abort handler).
    unsub();
    await vi.runAllTimersAsync();
  });

  it("readResource throws 'Resource not found' when JSON-RPC result has no contents", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      const body = parseJsonBody(init);
      if (body?.method === "tools/list") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "t1" }] } });
      }
      if (body?.method === "resources/read") {
        return makeJsonResponse({ jsonrpc: "2.0", id: body.id, result: { contents: [] } });
      }
      return makeJsonResponse({ error: "not found" }, { status: 404 });
    });

    const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl });
    await expect(p.readResource("res://missing")).rejects.toThrow(/resource not found/i);
  });

  it("subscribeNotifications fans out messages, ignores subscriber errors, and invalidates tools cache", async () => {
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

    // consumeSseJson is called with the first SSE candidate URL (sseEndpoint resolved against baseUrl).
    expect(consumeSseJsonMock).toHaveBeenCalled();
    const firstCall = consumeSseJsonMock.mock.calls[0]?.[0];
    expect(firstCall.url).toBe("http://nexus.local/custom");

    // Let the mocked SSE loop emit notifications.
    await Promise.resolve();

    // Both messages were fanned out; the bad subscriber is isolated.
    expect(goodHandler).toHaveBeenCalledWith(expect.objectContaining({ method: "notifications/tools/list_changed" }));
    expect(goodHandler).toHaveBeenCalledWith(expect.objectContaining({ method: "custom/event" }));

    // The tools cache is invalidated by list_changed.
    expect(p._toolsCache).toBe(null);

    // Unsubscribing the last handler stops the loop (aborts controller).
    unsub1();
    unsub2();
  });

  it("__test helpers normalize payload variants", () => {
    expect(__test.normalizeBaseUrl("http://x///")).toBe("http://x");
    expect(__test.normalizeBaseUrl("")).toBe(null);

    const tools1 = __test.normalizeToolList([{ name: "a", description: "d", inputSchema: { type: "object", properties: {} } }, { nope: true }]);
    expect(tools1).toHaveLength(1);
    expect(tools1[0].name).toBe("a");

    const tools2 = __test.normalizeToolList({ result: { tools: [{ name: "b" }] } });
    expect(tools2).toHaveLength(1);
    expect(tools2[0].name).toBe("b");

    const tools3 = __test.normalizeToolListFromToolApi({ success: true, tools: [{ id: "c", description: "d" }] });
    expect(tools3).toHaveLength(1);
    expect(tools3[0].name).toBe("c");

    const r1 = __test.normalizeToolResult({ success: true, content: [{ type: "text", text: "ok" }] });
    expect(r1.getText()).toBe("ok");

    const r2 = __test.normalizeToolResult({ foo: 1 });
    expect(r2.content[0]).toMatchObject({ type: "json", data: { foo: 1 } });

    const read1 = __test.normalizeResourceReadResult({ contents: [{ uri: "u", mimeType: "text/plain", text: "hi" }] });
    expect(read1).toMatchObject({ uri: "u", mimeType: "text/plain", text: "hi" });

    const read2 = __test.normalizeResourceReadResult({
      contents: [{ uri: "u2", blob: Buffer.from("x").toString("base64"), mimeType: "application/octet-stream" }],
    });
    expect(read2.uri).toBe("u2");
    expect(read2.blob).toBeInstanceOf(Uint8Array);

    expect(__test.normalizeToolList(null)).toEqual([]);
    expect(__test.normalizeToolListFromToolApi(null)).toEqual([]);
    expect(__test.normalizeToolListFromToolApi({ tools: null })).toEqual([]);

    // input_schema + schema fallbacks in normalizeToolDef
    const tools4 = __test.normalizeToolList({ tools: [{ name: "d", input_schema: { type: "object", properties: {} } }, { name: "e", schema: {} }] });
    expect(tools4.map((t) => t.name)).toEqual(["d", "e"]);

    // Tool list selector fallbacks: data.tools -> result -> items -> data
    expect(__test.normalizeToolList({ data: { tools: [{ name: "dt" }] } })[0].name).toBe("dt");
    expect(__test.normalizeToolList({ result: [{ name: "rt" }] })[0].name).toBe("rt");
    expect(__test.normalizeToolList({ items: [{ name: "it" }] })[0].name).toBe("it");
    expect(__test.normalizeToolList({ data: [{ name: "da" }] })[0].name).toBe("da");

    expect(__test.normalizeResourceList([{ uri: "r1" }, { nope: true }])).toHaveLength(1);
    expect(__test.normalizeResourceTemplates([{ uriTemplate: "t://{x}" }, { nope: true }])).toHaveLength(1);
    expect(__test.normalizeResourceList({ data: { resources: [{ uri: "r2" }] } })[0].uri).toBe("r2");
    expect(__test.normalizeResourceList({ result: [{ uri: "r3" }] })[0].uri).toBe("r3");

    // normalizeResourceReadResult supports `content` alias and defaults mimeType.
    const read0 = __test.normalizeResourceReadResult({ content: [{ uri: "u0", text: "hi" }] });
    expect(read0.mimeType).toBe("application/octet-stream");
    expect(read0.text).toBe("hi");
    expect(__test.normalizeResourceReadResult({ contents: [] })).toBe(null);

    // Force browser-style base64 decode path.
    vi.stubGlobal("Buffer", undefined);
    vi.stubGlobal("atob", (s) => (s === "WA==" ? "X" : ""));
    const readAtob = __test.normalizeResourceReadResult({ contents: [{ uri: "u3", blob: "WA==" }] });
    expect(readAtob.blob).toBeInstanceOf(Uint8Array);
    expect(readAtob.blob.length).toBe(1);

    // normalizeToolResult handles null and `contents`.
    expect(__test.normalizeToolResult(null).content).toEqual([]);
    const r3 = __test.normalizeToolResult({ contents: [{ type: "text", text: "x" }] });
    expect(r3.getText()).toBe("x");
  });
});
