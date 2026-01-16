import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

it("McpClient: search/fetch prefer standard tool names with fallback", async () => {
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
  expect(sr.success).toBe(true);

  const fr = await client.fetch({ url: "https://example.com" }, { providerId: "p1" });
  expect(fr.success).toBe(true);

  const p = client.getProvider("p1");
  expect(p.calls.map((c) => c.toolName)).toEqual(["search.query", "search.fetch"]
  );
});

it("McpClient: listAllTools captures provider failures (non-fatal)", async () => {
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
  expect(Array.isArray(tools)).toBe(true);
  expect(tools.length).toBe(1);
  expect(tools[0].providerId).toBe("good");

  expect(Array.isArray(tools.errors)).toBeTruthy();
  expect(tools.errors.length).toBe(1);
  expect(tools.errors[0].providerId).toBe("bad");
  expect(String(tools.errors[0].error)).toContain("boom");
});

it("McpClient: circuit breaker opens after repeated provider failures", async () => {
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
    expect(r.success).toBe(false);
  }

  const blocked = await client.callTool("x", {});
  expect(blocked.success).toBe(false);
  expect(String(blocked.error).toLowerCase()).toContain("circuit open");
  expect(provider.calls).toBe(3);
});

it("McpClient: circuit breaker ignores unknown tool errors", async () => {
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
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("unknown tool");
  }
  expect(provider.calls).toBe(6);
});

it("SSE: NewlineDecoder handles CRLF across chunks and lone CR", async () => {
  const { NewlineDecoder } = await import("../../js/agents/mcp/sse.js");
  const enc = new TextEncoder();

  const d1 = new NewlineDecoder();
  expect(d1.decode(enc.encode("a\r"))).toEqual([]);
  expect(d1.decode(enc.encode("\nb\n"))).toEqual(["a", "b"]);

  const d2 = new NewlineDecoder();
  expect(d2.decode(enc.encode("x\ry\n"))).toEqual(["x", "y"]);

  const d3 = new NewlineDecoder();
  expect(d3.decode(enc.encode("x\r"))).toEqual([]);
  expect(d3.decode(enc.encode("y\n"))).toEqual(["x", "y"]);
});

it("McpNexusProvider: JSON-RPC tools/list + tools/call happy path", async () => {
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
  expect(tools.length).toBe(2);
  expect(tools[0].name).toBe("search.query");

  const out = await p.callTool("search.query", { query: "x" });
  expect(out.success).toBe(true);
  expect(out.content[0].type).toBe("json");
  expect(out.content[0].data.name).toBe("search.query");

  // Sanity: discovery didn't try REST in this happy path.
  expect(calls.some(c => c.url.endsWith("/mcp") && c.body?.method === "tools/list"));
});

it("McpNexusProvider: Tool API (/api/tools + /api/tools/execute) happy path", async () => {
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
  expect(tools.length).toBe(2);
  expect(tools[0].name).toBe("search.query");

  const out = await p.callTool("search.query", { query: "x" });
  expect(out.success).toBe(true);
  expect(out.content[0].type).toBe("json");
  expect(out.content[0].data).toEqual({ ok: true, toolId: "search.query", params: { query: "x" } });

  expect(calls.some(c => c.url.endsWith("/api/tools") && c.method === "GET"));
  expect(calls.some(c => c.url.endsWith("/api/tools/execute") && c.method === "POST"));
});

it("SmartContentExtractor: works without DOMParser (fallback)", async () => {
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
  expect(typeof out.plainText).toBe("string");
  expect(out.plainText.includes("Hello")).toBeTruthy();
  expect(out.plainText.includes("World")).toBeTruthy();
  expect(out.plainText.includes("bad()")).toBe(false);

  if (typeof globalThis.DOMParser === "undefined") {
    expect(out.structure.mainContentSelector).toBe("fallback(no-dom)");
  }
});

it("McpNexusProvider: seedToolsCache primes listTools without network", async () => {
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
  expect(seeded).toBe(true);

  const tools = await provider.listTools();
  expect(called).toBe(0);
  expect(tools.length).toBe(2);
  expect(tools[0].name).toBe("search.query");
});

it("McpNexusProvider: healthCheck(refreshTools) hits network even when tools are seeded", async () => {
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
  expect(tools.length).toBe(2);
  expect(calls.length).toBe(0);

  const health = await provider.healthCheck({ refreshTools: true, timeoutMs: 5_000 });
  expect(health.ok).toBe(true);
  expect(calls.some(c => c.url.endsWith("/mcp") && c.body?.method === "tools/list"));
});

it("SSE parser: handles chunk boundaries and multi-line data", async () => {
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

  expect(events.length).toBe(2);
  expect(events[0].event).toBe("message");
  expect(events[0].data).toBe("{\"a\":1}");
  expect(events[1].event).toBe("custom");
  expect(events[1].data).toBe("x\ny");
});

it("McpNexusProvider: subscribeNotifications consumes SSE and invalidates tools cache", async () => {
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
  expect(t1.length).toBe(2);
  expect(listCalls).toBe(1);

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
  expect(t2.length).toBe(2);
  expect(listCalls).toBe(2);
});

it("McpResourceManager: subscribeResource triggers read on notifications/resources/updated", async () => {
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
  expect(resources.length).toBe(1);

  const r0 = await rm.readResource({ providerId: "mcp-nexus", uri: "file:///a.txt" });
  expect(r0.text).toBe("v1");

  let resolveDone = null;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const sub = await rm.subscribeResource({
    providerId: "mcp-nexus",
    uri: "file:///a.txt",
    callback: (evt) => {
      expect(evt.providerId).toBe("mcp-nexus");
      expect(evt.uri).toBe("file:///a.txt");
      expect(evt.content?.text).toBe("v2");
      resolveDone?.();
    },
  });

  await done;
  await sub.unsubscribe();

  expect(subscribeCalls).toBe(1);
  expect(unsubscribeCalls).toBe(1);
});

it("McpResourceManager: prunes content cache by maxContentCacheEntries (LRU)", async () => {
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

  expect(rm._contentCache.size).toBe(2);
  expect(rm._contentCache.has("p1:file:///a.txt")).toBe(false);
  expect(rm._contentCache.has("p1:file:///b.txt")).toBe(true);
  expect(rm._contentCache.has("p1:file:///c.txt")).toBe(true);

  // Touch b; adding d should evict c (LRU).
  await rm.readResource({ providerId: "p1", uri: "file:///b.txt" });
  await rm.readResource({ providerId: "p1", uri: "file:///d.txt" });

  expect(rm._contentCache.size).toBe(2);
  expect(rm._contentCache.has("p1:file:///b.txt")).toBe(true);
  expect(rm._contentCache.has("p1:file:///d.txt")).toBe(true);
  expect(rm._contentCache.has("p1:file:///c.txt")).toBe(false);
});

it("McpResourceManager: refreshes notification wiring when provider instance is replaced", async () => {
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

  expect(p1.subscribeNotificationsCalls).toBe(1);
  expect(p1.subscribeResourceCalls).toBe(1);

  const p2 = new NotifyingProvider({ id: "p1", version: 2 });
  client.addProvider(p2);

  await rm.readResource({ providerId: "p1", uri: "file:///a.txt", forceRefresh: true });
  expect(p2.subscribeNotificationsCalls).toBe(1);

  expect(await waitFor(() => p2.subscribeResourceCalls >= 1)).toBe(true);

  p2.emit({ method: "notifications/resources/updated", params: { uri: "file:///a.txt" } });
  expect(await waitFor(() => seen.includes("v2"))).toBe(true);
});
