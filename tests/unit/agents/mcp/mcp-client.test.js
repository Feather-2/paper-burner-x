/**
 * MCP Client Test Suite
 *
 * Tests for McpClient, McpProvider, McpToolDefinition, McpToolResult, and McpTransport.
 * Uses node:test + node:assert/strict.
 */

// ============================================================================
// McpToolDefinition Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("McpToolDefinition: constructs with valid options", async () => {
  const { McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  const tool = new McpToolDefinition({
    name: "search.query",
    description: "Search the web",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  });

  expect(tool.name).toBe("search.query");
  expect(tool.description).toBe("Search the web");
  expect(tool.inputSchema).toEqual({ type: "object", properties: { query: { type: "string" } } });
});

it("McpToolDefinition: handles missing/invalid options gracefully", async () => {
  const { McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  const tool = new McpToolDefinition({});
  expect(tool.name).toBe("unknown");
  expect(tool.description).toBe("");
  expect(tool.inputSchema).toEqual({ type: "object", properties: {} });

  const tool2 = new McpToolDefinition({ name: "", description: null, inputSchema: "invalid" });
  expect(tool2.name).toBe("unknown");
  expect(tool2.description).toBe("");
  expect(tool2.inputSchema).toEqual({ type: "object", properties: {} });
});

// ============================================================================
// McpToolResult Tests
// ============================================================================

it("McpToolResult: constructs with default values", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({});
  expect(result.success).toBe(true);
  expect(result.content).toEqual([]);
  expect(result.error).toBe(null);
  expect(result.isError).toBe(false);
});

it("McpToolResult: constructs with provided values", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({
    success: false,
    content: [{ type: "text", text: "Error occurred" }],
    error: "Network failure",
    isError: true,
  });

  expect(result.success).toBe(false);
  expect(result.content.length).toBe(1);
  expect(result.error).toBe("Network failure");
  expect(result.isError).toBe(true);
});

it("McpToolResult: getText extracts text content", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({
    content: [
      { type: "text", text: "Hello" },
      { type: "json", data: { foo: "bar" } },
      { type: "text", text: "World" },
    ],
  });

  expect(result.getText()).toBe("Hello\nWorld");
});

it("McpToolResult: getText handles empty content", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({ content: [] });
  expect(result.getText()).toBe("");

  const result2 = new McpToolResult({ content: [{ type: "json", data: {} }] });
  expect(result2.getText()).toBe("");
});

it("McpToolResult: coerces non-array content and tolerates missing text fields", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const r1 = new McpToolResult({ success: true, content: /** @type {any} */ ("nope") });
  expect(r1.content).toEqual([]);

  const r2 = new McpToolResult({ success: true, content: [{ type: "text" }] });
  expect(r2.getText()).toBe("");
});

// ============================================================================
// McpProvider Tests
// ============================================================================

it("McpProvider: base class throws not implemented errors", async () => {
  const { McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  const provider = new McpProvider({ id: "test", name: "Test", endpoint: "local" });
  expect(provider.id).toBe("test");
  expect(provider.name).toBe("Test");
  expect(provider.endpoint).toBe("local");

  await expect(provider.listTools()).rejects.toThrow(/not implemented/i);
  await expect(provider.callTool("foo", {})).rejects.toThrow(/not implemented/i);
});

it("McpProvider: defaults id/name/endpoint when missing", async () => {
  const { McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  const provider = new McpProvider({});
  expect(provider.id).toBe("provider_unknown");
  expect(provider.name).toBe("provider_unknown");
  expect(provider.endpoint).toBe("local");
});

// ============================================================================
// McpClient Tests
// ============================================================================

it("McpClient: constructs with no providers", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  expect(client.listProviders()).toEqual([]);
  expect(client.getProvider("any")).toBe(null);
});

it("McpClient: addProvider adds and sets default", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class TestProvider extends McpProvider {
    constructor() {
      super({ id: "test", name: "Test", endpoint: "mock" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const client = new McpClient();
  client.addProvider(new TestProvider());

  expect(client.listProviders()).toEqual(["test"]);
  expect(client.getProvider("test")).toBeInstanceOf(McpProvider);
});

it("McpClient: addProvider throws for non-McpProvider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  expect(() => client.addProvider({})).toThrow(/must be McpProvider instance/);
  expect(() => client.addProvider(null)).toThrow(/must be McpProvider instance/);
});

it("McpClient: setDefaultProvider works correctly", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class P1 extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  class P2 extends McpProvider {
    constructor() {
      super({ id: "p2" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const client = new McpClient({ providers: [new P1(), new P2()] });
  expect(client._defaultProviderId).toBe("p1");

  client.setDefaultProvider("p2");
  expect(client._defaultProviderId).toBe("p2");
});

it("McpClient: setDefaultProvider throws for unknown provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  expect(() => client.setDefaultProvider("unknown")).toThrow(/provider not found/);
});

it("McpClient: setDefaultProvider throws for empty string", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  expect(() => client.setDefaultProvider("")).toThrow(/must be a non-empty string/);
});

it("McpClient: callTool returns error result for missing provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const result = await client.callTool("test", {});

  expect(result.success).toBe(false);
  expect(result.isError).toBe(true);
  expect(String(result.error)).toContain("No provider found");
});

it("McpClient: callTool routes to correct provider", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const calls = [];

  class P1 extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool(name, args) {
      calls.push({ provider: "p1", name, args });
      return new McpToolResult({ success: true, content: [{ type: "text", text: "p1" }] });
    }
  }

  class P2 extends McpProvider {
    constructor() {
      super({ id: "p2" });
    }
    async listTools() {
      return [];
    }
    async callTool(name, args) {
      calls.push({ provider: "p2", name, args });
      return new McpToolResult({ success: true, content: [{ type: "text", text: "p2" }] });
    }
  }

  const client = new McpClient({ providers: [new P1(), new P2()], defaultProvider: "p1" });

  const r1 = await client.callTool("foo", { x: 1 });
  expect(r1.success).toBe(true);
  expect(calls.length).toBe(1);
  expect(calls[0].provider).toBe("p1");

  const r2 = await client.callTool("bar", { y: 2 }, { providerId: "p2" });
  expect(r2.success).toBe(true);
  expect(calls.length).toBe(2);
  expect(calls[1].provider).toBe("p2");
});

it("McpClient: callTool handles provider exceptions", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class ThrowingProvider extends McpProvider {
    constructor() {
      super({ id: "throws" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      throw new Error("Provider crashed");
    }
  }

  const client = new McpClient({ providers: [new ThrowingProvider()] });
  const result = await client.callTool("test", {});

  expect(result.success).toBe(false);
  expect(result.isError).toBe(true);
  expect(String(result.error)).toContain("Provider crashed");
});

it("McpClient: listAllTools merges tools from all providers", async () => {
  const { McpClient, McpProvider, McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  class P1 extends McpProvider {
    constructor() {
      super({ id: "p1", name: "Provider 1" });
    }
    async listTools() {
      return [new McpToolDefinition({ name: "tool1", description: "T1" })];
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  class P2 extends McpProvider {
    constructor() {
      super({ id: "p2", name: "Provider 2" });
    }
    async listTools() {
      return [new McpToolDefinition({ name: "tool2", description: "T2" })];
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new P1(), new P2()] });
  const tools = await client.listAllTools();

  expect(tools.length).toBe(2);
  expect(tools[0].name).toBe("tool1");
  expect(tools[0].providerId).toBe("p1");
  expect(tools[1].name).toBe("tool2");
  expect(tools[1].providerId).toBe("p2");
});

it("McpClient: listAllTools captures provider failures (non-fatal)", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

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

  expect(tools.errors).toBeInstanceOf(Array);
  expect(tools.errors.length).toBe(1);
  expect(tools.errors[0].providerId).toBe("bad");
  expect(String(tools.errors[0].error)).toContain("boom");
});

it("McpClient: listAllTools uses 'Unknown error' when a provider rejects with falsy reason", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class BadProvider extends McpProvider {
    constructor() {
      super({ id: "bad" });
    }
    async listTools() {
      throw null;
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new BadProvider()], defaultProvider: "bad" });
  const tools = await client.listAllTools();
  expect(tools.length).toBe(0);
  expect(tools.errors).toBeInstanceOf(Array);
  expect(tools.errors[0].error).toContain("Unknown error");
});

it("McpClient: healthCheck returns ok for provider with listTools", async () => {
  const { McpClient, McpProvider, McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  class HealthyProvider extends McpProvider {
    constructor() {
      super({ id: "healthy" });
    }
    async listTools() {
      return [new McpToolDefinition({ name: "tool", description: "T" })];
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new HealthyProvider()] });
  const health = await client.healthCheck({ providerId: "healthy" });

  expect(health.ok).toBe(true);
  expect(health.providerId).toBe("healthy");
  expect(health.toolCount).toBe(1);
});

it("McpClient: healthCheck returns not ok for missing provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const health = await client.healthCheck({ providerId: "missing" });

  expect(health.ok).toBe(false);
  expect(String(health.error)).toContain("No provider found");
});

it("McpClient: healthCheck uses provider.healthCheck if available", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class CustomHealthProvider extends McpProvider {
    constructor() {
      super({ id: "custom" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      throw new Error("not used");
    }
    async healthCheck() {
      return { ok: true, providerId: "custom", custom: true };
    }
  }

  const client = new McpClient({ providers: [new CustomHealthProvider()] });
  const health = await client.healthCheck({ providerId: "custom" });

  expect(health.ok).toBe(true);
  expect(health.custom).toBe(true);
});

it("McpClient: healthCheck returns ok:false when provider.healthCheck throws", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class FailingHealthProvider extends McpProvider {
    constructor() {
      super({ id: "failing" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      throw new Error("not used");
    }
    async healthCheck() {
      throw new Error("health check failed");
    }
  }

  const client = new McpClient({ providers: [new FailingHealthProvider()] });
  const health = await client.healthCheck({ providerId: "failing" });

  expect(health.ok).toBe(false);
  expect(health.providerId).toBe("failing");
  expect(String(health.error)).toContain("health check failed");
});

it("McpClient: healthCheckAll checks all providers", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class GoodProvider extends McpProvider {
    constructor() {
      super({ id: "good" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  class BadProvider extends McpProvider {
    constructor() {
      super({ id: "bad" });
    }
    async listTools() {
      throw new Error("Provider down");
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new GoodProvider(), new BadProvider()] });
  const results = await client.healthCheckAll();

  expect(results.length).toBe(2);

  const good = results.find((r) => r.providerId === "good");
  const bad = results.find((r) => r.providerId === "bad");

  expect(good.ok).toBe(true);
  expect(bad.ok).toBe(false);
  expect(String(bad.error)).toContain("Provider down");
});

it("McpClient: healthCheck handles missing defaultProvider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const r = await client.healthCheck();
  expect(r.ok).toBe(false);
  expect(r.providerId).toBe(null);
});

it("McpClient: healthCheck handles non-array listTools results", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class WeirdProvider extends McpProvider {
    constructor() {
      super({ id: "weird" });
    }
    async listTools() {
      return /** @type {any} */ ({ not: "an array" });
    }
    async callTool() {
      throw new Error("not used");
    }
  }

  const client = new McpClient({ providers: [new WeirdProvider()] });
  const r = await client.healthCheck({ providerId: "weird" });
  expect(r.ok).toBe(true);
  expect(r.toolCount).toBe(0);
});

// ============================================================================
// McpTransport Tests
// ============================================================================

it("McpTransport: base class throws not implemented for abstract methods", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  expect(transport.isConnected()).toBe(false);

  await expect(transport.connect()).rejects.toThrow(/not implemented/i);
  await expect(transport.disconnect()).rejects.toThrow(/not implemented/i);
  await expect(transport.send({})).rejects.toThrow(/not implemented/i);
});

it("McpTransport: request throws when not connected", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  await expect(transport.request("test", {})).rejects.toThrow(/not connected/i);
});

it("McpTransport: request/response handling via _handleMessage", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class MockTransport extends McpTransport {
    constructor() {
      super({ timeout: 5000 });
      this._connected = true;
      this.sent = [];
    }
    async connect() {
      this._connected = true;
    }
    async disconnect() {
      this._connected = false;
    }
    async send(message) {
      this.sent.push(message);
      // Simulate async response
      setImmediate(() => {
        this._handleMessage({
          jsonrpc: "2.0",
          id: message.id,
          result: { echo: message.params },
        });
      });
    }
  }

  const transport = new MockTransport();
  const result = await transport.request("test.method", { foo: "bar" });

  expect(result).toEqual({ echo: { foo: "bar" } });
  expect(transport.sent.length).toBe(1);
  expect(transport.sent[0].method).toBe("test.method");
});

it("McpTransport: request handles error response", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class ErrorTransport extends McpTransport {
    constructor() {
      super({ timeout: 5000 });
      this._connected = true;
    }
    async send(message) {
      setImmediate(() => {
        this._handleMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32600, message: "Invalid Request" },
        });
      });
    }
  }

  const transport = new ErrorTransport();
  await expect(transport.request("test", {})).rejects.toThrow(/Invalid Request/);
});

it("McpTransport: request times out", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class SlowTransport extends McpTransport {
    constructor() {
      super({ timeout: 50 });
      this._connected = true;
    }
    async send() {
      // Never responds
    }
  }

  const transport = new SlowTransport();
  await expect(transport.request("test", {})).rejects.toThrow(/timeout/i);
});

it("McpTransport: notify sends message without id", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class MockTransport extends McpTransport {
    constructor() {
      super();
      this._connected = true;
      this.sent = [];
    }
    async send(message) {
      this.sent.push(message);
    }
  }

  const transport = new MockTransport();
  await transport.notify("notifications/initialized", { ready: true });

  expect(transport.sent.length).toBe(1);
  expect(transport.sent[0].id).toBe(undefined);
  expect(transport.sent[0].method).toBe("notifications/initialized");
  expect(transport.sent[0].params).toEqual({ ready: true });
});

it("McpTransport: _handleMessage emits notification events", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  const received = [];

  transport.on("notification:tools/list_changed", (params) => {
    received.push(params);
  });

  transport._handleMessage({
    jsonrpc: "2.0",
    method: "tools/list_changed",
    params: { reason: "added" },
  });

  expect(received.length).toBe(1);
  expect(received[0]).toEqual({ reason: "added" });
});

it("McpTransport: _rejectAllPending clears pending requests", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class MockTransport extends McpTransport {
    constructor() {
      super({ timeout: 60000 });
      this._connected = true;
    }
    async send() {
      // Never responds
    }
  }

  const transport = new MockTransport();

  const p1 = transport.request("m1", {}).catch((e) => e.message);
  const p2 = transport.request("m2", {}).catch((e) => e.message);

  // Give time for requests to be pending
  await new Promise((r) => setImmediate(r));

  expect(transport._pending.size).toBe(2);

  transport._rejectAllPending(new Error("Connection lost"));

  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1).toBe("Connection lost");
  expect(r2).toBe("Connection lost");
  expect(transport._pending.size).toBe(0);
});

it("McpTransport: _handleMessage emits generic message event", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  const received = [];

  transport.on("message", (msg) => {
    received.push(msg);
  });

  transport._handleMessage({
    jsonrpc: "2.0",
    method: "some/notification",
    params: { data: "test" },
  });

  expect(received.length).toBe(1);
  expect(received[0].method).toBe("some/notification");
});

it("McpTransport: rejects invalid JSON-RPC messages", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class MockTransport extends McpTransport {
    constructor() {
      super({ timeout: 1000 });
      this._connected = true;
    }
    async send() {}
  }

  const transport = new MockTransport();
  const errors = [];
  transport.on("error", (err) => errors.push(err));

  const pending = transport.request("test.method", {});
  transport._handleMessage({ jsonrpc: "1.0", id: 1, result: { ok: true } });

  await expect(pending).rejects.toThrow(/Invalid MCP message/i);
  expect(errors.length).toBe(1);
});

// ============================================================================
// MCP Protocol Constants Tests
// ============================================================================

it("MCP constants are exported correctly", async () => {
  const { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, McpMethods } = await import(
    "../../../js/agents/mcp/mcp-transport.js"
  );

  expect(typeof MCP_PROTOCOL_VERSION).toBe("string");
  expect(MCP_SUPPORTED_VERSIONS).toBeInstanceOf(Array);
  expect(MCP_SUPPORTED_VERSIONS).toContain(MCP_PROTOCOL_VERSION);

  expect(McpMethods.INITIALIZE).toBe("initialize");
  expect(McpMethods.TOOLS_LIST).toBe("tools/list");
  expect(McpMethods.TOOLS_CALL).toBe("tools/call");
  expect(McpMethods.PING).toBe("ping");
  expect(McpMethods.INITIALIZED).toBe("notifications/initialized");
  expect(McpMethods.SHUTDOWN).toBe("shutdown");
  expect(McpMethods.RESOURCES_LIST).toBe("resources/list");
  expect(McpMethods.RESOURCES_READ).toBe("resources/read");
  expect(McpMethods.PROMPTS_LIST).toBe("prompts/list");
  expect(McpMethods.PROMPTS_GET).toBe("prompts/get");
});

// ============================================================================
// Transport Constants Tests
// ============================================================================

it("TransportKind constants and validators", async () => {
  const { TransportKind, isValidTransportKind, normalizeTransportKind } = await import(
    "../../../js/agents/mcp/constants.js"
  );

  expect(TransportKind.JSONRPC).toBe("jsonrpc");
  expect(TransportKind.TOOLAPI).toBe("toolapi");
  expect(TransportKind.REST).toBe("rest");

  expect(isValidTransportKind("jsonrpc")).toBe(true);
  expect(isValidTransportKind("toolapi")).toBe(true);
  expect(isValidTransportKind("rest")).toBe(true);
  expect(isValidTransportKind("invalid")).toBe(false);
  expect(isValidTransportKind(null)).toBe(false);
  expect(isValidTransportKind(undefined)).toBe(false);

  expect(normalizeTransportKind("JSONRPC")).toBe("jsonrpc");
  expect(normalizeTransportKind("  rest  ")).toBe("rest");
  expect(normalizeTransportKind("TOOLAPI")).toBe("toolapi");
  expect(normalizeTransportKind("unknown")).toBe(undefined);
  expect(normalizeTransportKind(123)).toBe(undefined);
});

// ============================================================================
// Endpoint Validation Tests
// ============================================================================

it("McpNexusProvider: blocks private endpoints unless explicitly allowed", async () => {
  const { McpNexusProvider } = await import("../../../js/agents/mcp/mcp-nexus-provider.js");

  expect(() => new McpNexusProvider({ endpoint: "http://127.0.0.1:3000", fetchImpl: async () => {} })).toThrow(/private network/i);
  expect(
    () => new McpNexusProvider({ endpoint: "http://127.0.0.1:3000", fetchImpl: async () => {}, allowPrivateNetwork: true })
  ).not.toThrow();
  expect(
    () =>
      new McpNexusProvider({
        endpoint: "http://127.0.0.1:3000",
        fetchImpl: async () => {},
        allowedHosts: ["127.0.0.1"],
      })
  ).not.toThrow();
});

it("NexusSkillProvider: validates baseUrl allowlist and private blocking", async () => {
  const { NexusSkillProvider } = await import("../../../js/agents/mcp/nexus-skill-provider.js");

  expect(() => new NexusSkillProvider()).not.toThrow();
  expect(() => new NexusSkillProvider({ baseUrl: "http://127.0.0.1:3000" })).toThrow(/private network/i);
  expect(() => new NexusSkillProvider({ baseUrl: "http://127.0.0.1:3000", allowPrivateNetwork: true })).not.toThrow();
  expect(() => new NexusSkillProvider({ baseUrl: "https://public.example", allowedHosts: ["public.example"] })).not.toThrow();
  expect(() => new NexusSkillProvider({ baseUrl: "https://public.example", allowedHosts: ["other.example"] })).toThrow(/allowlist/i);
});

// ============================================================================
// Circuit Breaker Integration Tests
// ============================================================================

it("McpClient: circuit breaker opens after repeated failures", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

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
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

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

it("McpClient: circuit breaker ignores AbortError", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  class AbortingProvider extends McpProvider {
    constructor() {
      super({ id: "aborting" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls++;
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
  }

  const provider = new AbortingProvider();
  const client = new McpClient({
    providers: [provider],
    time: { now: () => 0 },
  });

  for (let i = 0; i < 5; i++) {
    const r = await client.callTool("test", {});
    expect(r.success).toBe(false);
  }

  expect(provider.calls).toBe(5);
});

it("McpClient: circuit breaker ignores 'invalid arguments' errors", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class InvalidArgsProvider extends McpProvider {
    constructor() {
      super({ id: "invalid" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls++;
      return new McpToolResult({ success: false, isError: true, error: "invalid arguments" });
    }
  }

  const provider = new InvalidArgsProvider();
  const client = new McpClient({
    providers: [provider],
    time: { now: () => 0 },
  });

  for (let i = 0; i < 6; i++) {
    await client.callTool("test", {});
  }

  expect(provider.calls).toBe(6);
});

it("McpClient: circuit breaker ignores 'no such tool' errors", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class NoSuchToolProvider extends McpProvider {
    constructor() {
      super({ id: "nosuch" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls++;
      return new McpToolResult({ success: false, isError: true, error: "no such tool" });
    }
  }

  const provider = new NoSuchToolProvider();
  const client = new McpClient({
    providers: [provider],
    time: { now: () => 0 },
  });

  for (let i = 0; i < 6; i++) {
    await client.callTool("test", {});
  }

  expect(provider.calls).toBe(6);
});

it("McpClient: circuit breaker ignores 'tool not found' errors", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class ToolNotFoundProvider extends McpProvider {
    constructor() {
      super({ id: "notfound" });
      this.calls = 0;
    }
    async listTools() {
      return [];
    }
    async callTool() {
      this.calls++;
      return new McpToolResult({ success: false, isError: true, error: "tool not found" });
    }
  }

  const provider = new ToolNotFoundProvider();
  const client = new McpClient({
    providers: [provider],
    time: { now: () => 0 },
  });

  for (let i = 0; i < 6; i++) {
    await client.callTool("test", {});
  }

  expect(provider.calls).toBe(6);
});

// ============================================================================
// Convenience Methods Tests
// ============================================================================

it("McpClient: search convenience method tries standard names first", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const calls = [];

  class SearchProvider extends McpProvider {
    constructor() {
      super({ id: "search" });
    }
    async listTools() {
      return [];
    }
    async callTool(name, args) {
      calls.push(name);
      if (name === "search.query") {
        return new McpToolResult({ success: true, content: [{ type: "json", data: { results: [] } }] });
      }
      return new McpToolResult({ success: false, error: "unknown" });
    }
  }

  const client = new McpClient({ providers: [new SearchProvider()] });
  const result = await client.search({ query: "test" });

  expect(result.success).toBe(true);
  expect(calls[0]).toBe("search.query");
});

it("McpClient: fetch convenience method tries standard names first", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const calls = [];

  class FetchProvider extends McpProvider {
    constructor() {
      super({ id: "fetcher" });
    }
    async listTools() {
      return [];
    }
    async callTool(name, args) {
      calls.push(name);
      if (name === "search.fetch") {
        return new McpToolResult({ success: true, content: [{ type: "text", text: "content" }] });
      }
      return new McpToolResult({ success: false, error: "unknown" });
    }
  }

  const client = new McpClient({ providers: [new FetchProvider()] });
  const result = await client.fetch({ url: "https://example.com" });

  expect(result.success).toBe(true);
  expect(calls[0]).toBe("search.fetch");
});

it("McpClient: search falls back to legacy tool names", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const calls = [];

  class LegacyProvider extends McpProvider {
    constructor() {
      super({ id: "legacy" });
    }
    async listTools() {
      return [];
    }
    async callTool(name) {
      calls.push(name);
      if (name === "search") {
        return new McpToolResult({ success: true, content: [{ type: "json", data: { results: [] } }] });
      }
      return new McpToolResult({ success: false, error: "unknown" });
    }
  }

  const client = new McpClient({ providers: [new LegacyProvider()] });
  const result = await client.search({ query: "test" });

  expect(result.success).toBe(true);
  expect(calls).toEqual(["search.query", "search"]);
});

it("McpClient: fetch falls back to legacy tool names", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const calls = [];

  class LegacyFetchProvider extends McpProvider {
    constructor() {
      super({ id: "legacy" });
    }
    async listTools() {
      return [];
    }
    async callTool(name) {
      calls.push(name);
      if (name === "fetch_content") {
        return new McpToolResult({ success: true, content: [{ type: "text", text: "body" }] });
      }
      return new McpToolResult({ success: false, error: "unknown" });
    }
  }

  const client = new McpClient({ providers: [new LegacyFetchProvider()] });
  const result = await client.fetch({ url: "https://example.com" });

  expect(result.success).toBe(true);
  expect(calls).toEqual(["search.fetch", "fetch_content"]);
});

it("McpClient: search/fetch return last result when all fail", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class AlwaysFailProvider extends McpProvider {
    constructor() {
      super({ id: "fail" });
    }
    async listTools() {
      return [];
    }
    async callTool(name) {
      return new McpToolResult({ success: false, error: `fail:${name}` });
    }
  }

  const client = new McpClient({ providers: [new AlwaysFailProvider()] });

  const sr = await client.search({ query: "x" });
  expect(sr.success).toBe(false);
  expect(String(sr.error)).toContain("fail:search");

  const fr = await client.fetch({ url: "https://example.com" });
  expect(fr.success).toBe(false);
  expect(String(fr.error)).toContain("fail:fetch");
});

// ============================================================================
// Constructor Options Tests
// ============================================================================

it("McpClient: accepts defaultProvider as McpProvider instance", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class DirectProvider extends McpProvider {
    constructor() {
      super({ id: "direct" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const provider = new DirectProvider();
  const client = new McpClient({ defaultProvider: provider });

  expect(client.listProviders()).toEqual(["direct"]);
  expect(client._defaultProviderId).toBe("direct");
});

it("McpClient: accepts defaultProvider as string", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class P1 extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  class P2 extends McpProvider {
    constructor() {
      super({ id: "p2" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const client = new McpClient({
    providers: [new P1(), new P2()],
    defaultProvider: "p2",
  });

  expect(client._defaultProviderId).toBe("p2");
});

it("McpTransport: respects constructor options", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport({
    timeout: 10000,
    heartbeatInterval: 5000,
    maxRetries: 5,
    reconnectDelayBase: 2000,
  });

  expect(transport.timeout).toBe(10000);
  expect(transport.heartbeatInterval).toBe(5000);
  expect(transport.maxRetries).toBe(5);
  expect(transport.reconnectDelayBase).toBe(2000);
});

it("McpTransport: uses default options when not provided", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();

  expect(transport.timeout).toBe(30000);
  expect(transport.heartbeatInterval).toBe(30000);
  expect(transport.maxRetries).toBe(3);
  expect(transport.reconnectDelayBase).toBe(1000);
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

it("McpClient: callTool returns provider result when success:false", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const providerResult = new McpToolResult({
    success: false,
    isError: true,
    error: "bad args",
    content: [{ type: "text", text: "bad args" }],
  });

  class ReturnFailureProvider extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return providerResult;
    }
  }

  const client = new McpClient({ providers: [new ReturnFailureProvider()], time: { now: () => 0 } });
  const r = await client.callTool("t", { a: 1 });
  expect(r).toBe(providerResult);
});

it("McpClient: handles empty/falsy thrown errors", async () => {
  const { McpClient, McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  let throwEmpty = true;

  class EmptyErrorProvider extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      if (throwEmpty) {
        throw new Error("");
      }
      throw undefined;
    }
  }

  const client = new McpClient({ providers: [new EmptyErrorProvider()], time: { now: () => 0 } });

  const r1 = await client.callTool("x", {});
  expect(r1.success).toBe(false);

  throwEmpty = false;
  const r2 = await client.callTool("x", {});
  expect(r2.success).toBe(false);
});

it("McpClient: getProvider uses defaultProviderId when no id provided", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class P1 extends McpProvider {
    constructor() {
      super({ id: "p1" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const p1 = new P1();
  const client = new McpClient({ providers: [p1] });

  expect(client.getProvider()).toBe(p1);
  expect(client.getProvider("p1")).toBe(p1);
  expect(client.getProvider("nonexistent")).toBe(null);
});

it("McpClient: handles non-McpProvider in providers array", async () => {
  const { McpClient, McpProvider, McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  class ValidProvider extends McpProvider {
    constructor() {
      super({ id: "valid" });
    }
    async listTools() {
      return [];
    }
    async callTool() {
      return new McpToolResult({ success: true });
    }
  }

  const client = new McpClient({
    providers: [new ValidProvider(), {}, null, "invalid"],
  });

  expect(client.listProviders()).toEqual(["valid"]);
});

it("McpTransport: request handles send failure", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  class FailingSendTransport extends McpTransport {
    constructor() {
      super({ timeout: 5000 });
      this._connected = true;
    }
    async send() {
      throw new Error("Send failed");
    }
  }

  const transport = new FailingSendTransport();
  await expect(transport.request("test", {})).rejects.toThrow(/Send failed/);
});

it("McpTransport: _handleMessage handles response with unknown id gracefully", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  const received = [];

  transport.on("message", (msg) => {
    received.push(msg);
  });

  // Response with id not in pending - should emit as message
  transport._handleMessage({
    jsonrpc: "2.0",
    id: 999,
    result: { data: "orphan" },
  });

  expect(received.length).toBe(1);
  expect(received[0].id).toBe(999);
});
