const test = require("node:test");
const assert = require("node:assert/strict");

test("McpClient: search/fetch prefer standard tool names with fallback", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../js/agents/mcp/mcp-client.js");

  class OnlyStandardToolsProvider extends McpProvider {
    constructor() {
      super({ id: "p1", name: "P1", endpoint: "mock" });
      this.calls = [];
    }
    async listTools() {
      return [];
    }
    async callTool(toolName, args) {
      this.calls.push({ toolName, args });
      if (toolName === "search.query") return new McpToolResult({ success: true, content: [{ type: "json", data: { results: [{ url: "u" }] } }] });
      if (toolName === "search.fetch") return new McpToolResult({ success: true, content: [{ type: "text", text: "body" }] });
      return new McpToolResult({ success: false, isError: true, error: "unknown" });
    }
  }

  const client = new McpClient({ providers: [new OnlyStandardToolsProvider()], defaultProvider: "p1" });
  const sr = await client.search({ query: "x" }, { providerId: "p1" });
  assert.equal(sr.success, true);

  const fr = await client.fetch({ url: "https://example.com" }, { providerId: "p1" });
  assert.equal(fr.success, true);

  const p = client.getProvider("p1");
  assert.deepEqual(
    p.calls.map((c) => c.toolName),
    ["search.query", "search.fetch"]
  );
});

test("SSE: NewlineDecoder handles CRLF across chunks and lone CR", async () => {
  const { NewlineDecoder } = await import("../../js/agents/mcp/sse.js");
  const enc = new TextEncoder();

  const d1 = new NewlineDecoder();
  assert.deepEqual(d1.decode(enc.encode("a\r")), []);
  assert.deepEqual(d1.decode(enc.encode("\nb\n")), ["a", "b"]);

  const d2 = new NewlineDecoder();
  assert.deepEqual(d2.decode(enc.encode("x\ry\n")), ["x", "y"]);

  const d3 = new NewlineDecoder();
  assert.deepEqual(d3.decode(enc.encode("x\r")), []);
  assert.deepEqual(d3.decode(enc.encode("y\n")), ["x", "y"]);
});

test("McpNexusProvider: JSON-RPC tools/list + tools/call happy path", async () => {
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");

  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method, body });

    // JSON-RPC discovery + list.
    if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
                { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
              ],
            },
          });
        },
      };
    }

    if (String(url).endsWith("/mcp") && body?.method === "tools/call") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              success: true,
              content: [{ type: "json", data: { ok: true, name: body?.params?.name } }],
            },
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const p = new McpNexusProvider({ endpoint: "http://nexus.local", fetchImpl, timeoutMs: 2000, discoveryTimeoutMs: 2000 });
  const tools = await p.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "search.query");

  const out = await p.callTool("search.query", { query: "x" });
  assert.equal(out.success, true);
  assert.equal(out.content[0].type, "json");
  assert.equal(out.content[0].data.name, "search.query");

  // Sanity: discovery didn't try REST in this happy path.
  assert.ok(calls.some((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list"));
});

test("McpNexusProvider: Tool API (/api/tools + /api/tools/execute) happy path", async () => {
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");

  const calls = [];
  const fetchImpl = async (url, init) => {
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method, body });

    // Force JSON-RPC discovery to fail.
    if (String(url).endsWith("/mcp")) {
      return {
        ok: false,
        status: 404,
        async text() {
          return JSON.stringify({ error: "not found" });
        },
      };
    }

    if (String(url).endsWith("/api/tools") && method === "GET") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            tools: [
              { id: "search.query", name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
              { id: "search.fetch", name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
            ],
          });
        },
      };
    }

    if (String(url).endsWith("/api/tools/execute") && method === "POST") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            success: true,
            executionId: "exec-1",
            result: { ok: true, toolId: body?.toolId, params: body?.params },
            durationMs: 1,
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const p = new McpNexusProvider({ endpoint: "http://gateway.local", fetchImpl, timeoutMs: 2000, discoveryTimeoutMs: 2000 });
  const tools = await p.listTools();
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "search.query");

  const out = await p.callTool("search.query", { query: "x" });
  assert.equal(out.success, true);
  assert.equal(out.content[0].type, "json");
  assert.deepEqual(out.content[0].data, { ok: true, toolId: "search.query", params: { query: "x" } });

  assert.ok(calls.some((c) => c.url.endsWith("/api/tools") && c.method === "GET"));
  assert.ok(calls.some((c) => c.url.endsWith("/api/tools/execute") && c.method === "POST"));
});

test("SmartContentExtractor: works without DOMParser (fallback)", async () => {
  const { extractSmartContent } = await import("../../js/agents/mcp/smart-content-extractor.js");

  const html = [
    "<html><head>",
    "<title>t</title>",
    "<style>.x{color:red}</style>",
    "<script>bad()</script>",
    "</head><body>",
    "<h1>Hello</h1><p>World</p>",
    "</body></html>",
  ].join("");

  const out = extractSmartContent(html, { maxLength: 1000 });
  assert.equal(typeof out.plainText, "string");
  assert.ok(out.plainText.includes("Hello"));
  assert.ok(out.plainText.includes("World"));
  assert.equal(out.plainText.includes("bad()"), false);

  if (typeof globalThis.DOMParser === "undefined") {
    assert.equal(out.structure.mainContentSelector, "fallback(no-dom)");
  }
});

test("MCP auto-discovery: reads localStorage config and seeds tool schema cache", async () => {
  const { createAutoMcpClient, preloadMcpTools } = await import("../../js/agents/mcp/auto-discovery.js");

  const kv = new Map();
  const storage = {
    getItem: (k) => (kv.has(String(k)) ? kv.get(String(k)) : null),
    setItem: (k, v) => {
      kv.set(String(k), String(v));
    },
  };

  storage.setItem("mcp_nexus_config", JSON.stringify({ endpoint: "http://nexus.local" }));

  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method, body });

    if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
                { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
              ],
            },
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const client = await createAutoMcpClient({ storage, useLocal: false, fetchImpl });
  const provider = client.getProvider("mcp-nexus");
  assert.ok(provider);

  await preloadMcpTools({ client, storage, ttlMs: 60_000 });
  const cacheRaw = storage.getItem("pb_mcp_tools_cache_v1");
  assert.ok(cacheRaw);

  const parsed = JSON.parse(cacheRaw);
  assert.ok(parsed?.providers?.["mcp-nexus"]?.tools?.length >= 2);
  assert.ok(calls.some((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list"));

  let called2 = 0;
  const fetchImpl2 = async () => {
    called2 += 1;
    throw new Error("should not fetch");
  };

  const client2 = await createAutoMcpClient({ storage, useLocal: false, fetchImpl: fetchImpl2 });
  const provider2 = client2.getProvider("mcp-nexus");
  const tools2 = await provider2.listTools();
  assert.equal(called2, 0);
  assert.equal(tools2.length, 2);
});

test("MCP preload refresh: healthCheck hits network even when tools are seeded", async () => {
  const { createAutoMcpClient, preloadMcpTools } = await import("../../js/agents/mcp/auto-discovery.js");

  const kv = new Map();
  const storage = {
    getItem: (k) => (kv.has(String(k)) ? kv.get(String(k)) : null),
    setItem: (k, v) => {
      kv.set(String(k), String(v));
    },
  };

  storage.setItem("mcp_nexus_config", JSON.stringify({ endpoint: "http://nexus.local" }));
  storage.setItem(
    "pb_mcp_tools_cache_v1",
    JSON.stringify({
      schemaVersion: "0.1",
      kind: "mcp_tools_cache",
      ts: Date.now(),
      ttlMs: 60_000,
      providers: {
        "mcp-nexus": {
          ts: Date.now(),
          tools: [
            { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
            { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
          ],
        },
      },
    })
  );

  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method, body });

    if (String(url).endsWith("/mcp") && body?.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
                { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
              ],
            },
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const client = await createAutoMcpClient({ storage, useLocal: false, fetchImpl });
  const provider = client.getProvider("mcp-nexus");
  assert.ok(provider);

  const tools = await provider.listTools();
  assert.equal(tools.length, 2);
  assert.equal(calls.length, 0);

  await preloadMcpTools({ client, storage, ttlMs: 60_000, refresh: true });
  assert.ok(calls.some((c) => c.url.endsWith("/mcp") && c.body?.method === "tools/list"));
});

test("SSE parser: handles chunk boundaries and multi-line data", async () => {
  const { createSseParser } = await import("../../js/agents/mcp/sse.js");

  const events = [];
  const parser = createSseParser({
    onEvent: (evt) => events.push(evt),
  });

  parser.feed("data: {\"a\":1}\n\n");
  parser.feed("event: custom\n");
  parser.feed("data: x\n");
  parser.feed("data: y\n\n");
  parser.flush();

  assert.equal(events.length, 2);
  assert.equal(events[0].event, "message");
  assert.equal(events[0].data, "{\"a\":1}");
  assert.equal(events[1].event, "custom");
  assert.equal(events[1].data, "x\ny");
});

test("McpNexusProvider: subscribeNotifications consumes SSE and invalidates tools cache", async () => {
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");

  const encoder = new TextEncoder();
  const makeSseResponse = (chunks) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );

  let listCalls = 0;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/sse")) {
      return makeSseResponse([
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: {} })}\n\n`,
      ]);
    }

    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (u.endsWith("/mcp") && body?.method === "tools/list") {
      listCalls += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
                { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
              ],
            },
          });
        },
      };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const p = new McpNexusProvider({
    endpoint: "http://nexus.local/http",
    fetchImpl,
    timeoutMs: 2000,
    discoveryTimeoutMs: 2000,
    sseReconnectBaseMs: 50,
    sseReconnectMaxMs: 100,
  });

  const t1 = await p.listTools();
  assert.equal(t1.length, 2);
  assert.equal(listCalls, 1);

  let off = null;
  await new Promise((resolve) => {
    off = p.subscribeNotifications(
      (msg) => {
        if (msg?.method === "notifications/tools/list_changed") {
          off?.();
          resolve();
        }
      },
      { reconnect: false }
    );
  });

  const t2 = await p.listTools();
  assert.equal(t2.length, 2);
  assert.equal(listCalls, 2);
});

test("McpResourceManager: subscribeResource triggers read on notifications/resources/updated", async () => {
  const { McpClient } = await import("../../js/agents/mcp/mcp-client.js");
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");
  const { McpResourceManager } = await import("../../js/agents/mcp/resource-manager.js");

  const encoder = new TextEncoder();
  const makeSseResponse = (chunks) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );

  let readCalls = 0;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;

  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/sse")) {
      return makeSseResponse([
        `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/resources/updated", params: { uri: "file:///a.txt" } })}\n\n`,
      ]);
    }

    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (u.endsWith("/mcp") && body?.method === "tools/list") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
        },
      };
    }

    if (u.endsWith("/mcp") && body?.method === "resources/list") {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { resources: [{ uri: "file:///a.txt", name: "a.txt", mimeType: "text/plain" }] },
          });
        },
      };
    }

    if (u.endsWith("/mcp") && body?.method === "resources/read") {
      readCalls += 1;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { contents: [{ uri: body?.params?.uri, mimeType: "text/plain", text: `v${readCalls}` }] },
          });
        },
      };
    }

    if (u.endsWith("/mcp") && body?.method === "resources/subscribe") {
      subscribeCalls += 1;
      return { ok: true, status: 200, async text() { return JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }); } };
    }

    if (u.endsWith("/mcp") && body?.method === "resources/unsubscribe") {
      unsubscribeCalls += 1;
      return { ok: true, status: 200, async text() { return JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }); } };
    }

    return {
      ok: false,
      status: 404,
      async text() {
        return JSON.stringify({ error: "not found" });
      },
    };
  };

  const provider = new McpNexusProvider({
    id: "mcp-nexus",
    endpoint: "http://nexus.local/http",
    fetchImpl,
    timeoutMs: 2000,
    discoveryTimeoutMs: 2000,
    sseReconnectBaseMs: 50,
    sseReconnectMaxMs: 100,
  });

  const client = new McpClient({ providers: [provider], defaultProvider: "mcp-nexus" });
  const rm = new McpResourceManager({ client, storage: null, defaultTtlMs: 60_000 });

  const resources = await rm.listResources({ providerId: "mcp-nexus" });
  assert.equal(resources.length, 1);

  const r0 = await rm.readResource({ providerId: "mcp-nexus", uri: "file:///a.txt" });
  assert.equal(r0.text, "v1");

  let resolveDone = null;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const sub = await rm.subscribeResource({
    providerId: "mcp-nexus",
    uri: "file:///a.txt",
    callback: (evt) => {
      assert.equal(evt.providerId, "mcp-nexus");
      assert.equal(evt.uri, "file:///a.txt");
      assert.equal(evt.content?.text, "v2");
      resolveDone?.();
    },
  });

  await done;
  await sub.unsubscribe();

  assert.equal(subscribeCalls, 1);
  assert.equal(unsubscribeCalls, 1);
});
