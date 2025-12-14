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
