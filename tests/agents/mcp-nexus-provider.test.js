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

test("McpClient: listAllTools captures provider failures (non-fatal)", async () => {
  const { McpClient, McpProvider } = await import("../../js/agents/mcp/mcp-client.js");

  class GoodProvider extends McpProvider {
    constructor() {
      super({ id: "good", name: "Good", endpoint: "mock" });
    }
    async listTools() {
      return [{ name: "ok.tool", description: "ok", inputSchema: { type: "object", properties: {} } }];
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  class BadProvider extends McpProvider {
    constructor() {
      super({ id: "bad", name: "Bad", endpoint: "mock" });
    }
    async listTools() {
      throw new Error("boom");
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new GoodProvider(), new BadProvider()], defaultProvider: "good" });
  const tools = await client.listAllTools();
  assert.equal(Array.isArray(tools), true);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].providerId, "good");

  assert.ok(Array.isArray(tools.errors));
  assert.equal(tools.errors.length, 1);
  assert.equal(tools.errors[0].providerId, "bad");
  assert.ok(String(tools.errors[0].error).includes("boom"));
});

test("McpClient: circuit breaker opens after repeated provider failures", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../js/agents/mcp/mcp-client.js");

  class FailingProvider extends McpProvider {
    constructor() {
      super({ id: "p1", name: "P1", endpoint: "mock" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls += 1;
      return new McpToolResult({ success: false, isError: true, error: "network down", content: [{ type: "text", text: "down" }] });
    }
  }

  const provider = new FailingProvider();
  const client = new McpClient({ providers: [provider], defaultProvider: "p1", time: { now: () => 0 } });

  for (let i = 0; i < 3; i++) {
    const r = await client.callTool("x", {});
    assert.equal(r.success, false);
  }

  const blocked = await client.callTool("x", {});
  assert.equal(blocked.success, false);
  assert.ok(String(blocked.error).toLowerCase().includes("circuit open"));
  assert.equal(provider.calls, 3);
});

test("McpClient: circuit breaker ignores unknown tool errors", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../js/agents/mcp/mcp-client.js");

  class UnknownToolProvider extends McpProvider {
    constructor() {
      super({ id: "p1", name: "P1", endpoint: "mock" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls += 1;
      return new McpToolResult({ success: false, isError: true, error: "unknown tool", content: [{ type: "text", text: "unknown tool" }] });
    }
  }

  const provider = new UnknownToolProvider();
  const client = new McpClient({ providers: [provider], defaultProvider: "p1", time: { now: () => 0 } });

  for (let i = 0; i < 6; i++) {
    const r = await client.callTool("nope", {});
    assert.equal(r.success, false);
    assert.ok(String(r.error).includes("unknown tool"));
  }
  assert.equal(provider.calls, 6);
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

test("McpNexusProvider: seedToolsCache primes listTools without network", async () => {
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");

  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    throw new Error("should not fetch");
  };

  const provider = new McpNexusProvider({ id: "mcp-nexus", endpoint: "http://nexus.local", fetchImpl });
  const seeded = provider.seedToolsCache([
    { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
  ]);
  assert.equal(seeded, true);

  const tools = await provider.listTools();
  assert.equal(called, 0);
  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "search.query");
});

test("McpNexusProvider: healthCheck(refreshTools) hits network even when tools are seeded", async () => {
  const { McpNexusProvider } = await import("../../js/agents/mcp/mcp-nexus-provider.js");

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

  const provider = new McpNexusProvider({ id: "mcp-nexus", endpoint: "http://nexus.local", fetchImpl });
  provider.seedToolsCache([
    { name: "search.query", description: "q", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "search.fetch", description: "f", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
  ]);

  const tools = await provider.listTools();
  assert.equal(tools.length, 2);
  assert.equal(calls.length, 0);

  const health = await provider.healthCheck({ refreshTools: true, timeoutMs: 5_000 });
  assert.equal(health.ok, true);
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

test("McpResourceManager: prunes content cache by maxContentCacheEntries (LRU)", async () => {
  const { McpClient, McpProvider } = await import("../../js/agents/mcp/mcp-client.js");
  const { McpResourceManager } = await import("../../js/agents/mcp/resource-manager.js");

  class SimpleProvider extends McpProvider {
    constructor() {
      super({ id: "p1", name: "P1", endpoint: "mock" });
    }
    async listTools() {
      return [];
    }
    async listResources() {
      return [];
    }
    async readResource(uri) {
      return { uri, text: String(uri) };
    }
  }

  const client = new McpClient({ providers: [new SimpleProvider()], defaultProvider: "p1" });
  const rm = new McpResourceManager({ client, storage: null, defaultTtlMs: 60_000, maxContentCacheEntries: 2 });

  await rm.readResource({ providerId: "p1", uri: "file:///a.txt" });
  await rm.readResource({ providerId: "p1", uri: "file:///b.txt" });
  await rm.readResource({ providerId: "p1", uri: "file:///c.txt" });

  assert.equal(rm._contentCache.size, 2);
  assert.equal(rm._contentCache.has("p1:file:///a.txt"), false);
  assert.equal(rm._contentCache.has("p1:file:///b.txt"), true);
  assert.equal(rm._contentCache.has("p1:file:///c.txt"), true);

  // Touch b; adding d should evict c (LRU).
  await rm.readResource({ providerId: "p1", uri: "file:///b.txt" });
  await rm.readResource({ providerId: "p1", uri: "file:///d.txt" });

  assert.equal(rm._contentCache.size, 2);
  assert.equal(rm._contentCache.has("p1:file:///b.txt"), true);
  assert.equal(rm._contentCache.has("p1:file:///d.txt"), true);
  assert.equal(rm._contentCache.has("p1:file:///c.txt"), false);
});

test("McpResourceManager: refreshes notification wiring when provider instance is replaced", async () => {
  const { McpClient, McpProvider } = await import("../../js/agents/mcp/mcp-client.js");
  const { McpResourceManager } = await import("../../js/agents/mcp/resource-manager.js");

  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const waitFor = async (cond, { maxTicks = 50 } = {}) => {
    for (let i = 0; i < maxTicks; i++) {
      if (cond()) return true;
      await tick();
    }
    return false;
  };

  class NotifyingProvider extends McpProvider {
    constructor({ id, version }) {
      super({ id, name: id, endpoint: "mock" });
      this.version = version;
      this.subscribeNotificationsCalls = 0;
      this.subscribeResourceCalls = 0;
      this._subs = new Set();
    }

    async listTools() {
      return [];
    }

    async listResources() {
      return [{ uri: "file:///a.txt", name: "a.txt", mimeType: "text/plain" }];
    }

    async readResource(uri) {
      return { uri, text: `v${this.version}` };
    }

    async subscribeResource() {
      this.subscribeResourceCalls += 1;
      return {};
    }

    subscribeNotifications(handler) {
      this.subscribeNotificationsCalls += 1;
      this._subs.add(handler);
      return () => this._subs.delete(handler);
    }

    emit(msg) {
      for (const h of this._subs) h(msg);
    }
  }

  const p1 = new NotifyingProvider({ id: "p1", version: 1 });
  const client = new McpClient({ providers: [p1], defaultProvider: "p1" });
  const rm = new McpResourceManager({ client, storage: null, defaultTtlMs: 0 });

  const seen = [];
  await rm.subscribeResource({
    providerId: "p1",
    uri: "file:///a.txt",
    callback: (evt) => {
      if (evt?.content?.text) seen.push(evt.content.text);
    },
  });

  assert.equal(p1.subscribeNotificationsCalls, 1);
  assert.equal(p1.subscribeResourceCalls, 1);

  const p2 = new NotifyingProvider({ id: "p1", version: 2 });
  client.addProvider(p2);

  await rm.readResource({ providerId: "p1", uri: "file:///a.txt", forceRefresh: true });
  assert.equal(p2.subscribeNotificationsCalls, 1);

  assert.equal(await waitFor(() => p2.subscribeResourceCalls >= 1), true);

  p2.emit({ method: "notifications/resources/updated", params: { uri: "file:///a.txt" } });
  assert.equal(await waitFor(() => seen.includes("v2")), true);
});
