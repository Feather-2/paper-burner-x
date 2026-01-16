/**
 * MCP Client Test Suite
 *
 * Tests for McpClient, McpProvider, McpToolDefinition, McpToolResult, and McpTransport.
 * Uses node:test + node:assert/strict.
 */

import test from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// McpToolDefinition Tests
// ============================================================================

test("McpToolDefinition: constructs with valid options", async () => {
  const { McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  const tool = new McpToolDefinition({
    name: "search.query",
    description: "Search the web",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  });

  assert.equal(tool.name, "search.query");
  assert.equal(tool.description, "Search the web");
  assert.deepEqual(tool.inputSchema, { type: "object", properties: { query: { type: "string" } } });
});

test("McpToolDefinition: handles missing/invalid options gracefully", async () => {
  const { McpToolDefinition } = await import("../../../js/agents/mcp/mcp-client.js");

  const tool = new McpToolDefinition({});
  assert.equal(tool.name, "unknown");
  assert.equal(tool.description, "");
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {} });

  const tool2 = new McpToolDefinition({ name: "", description: null, inputSchema: "invalid" });
  assert.equal(tool2.name, "unknown");
  assert.equal(tool2.description, "");
  assert.deepEqual(tool2.inputSchema, { type: "object", properties: {} });
});

// ============================================================================
// McpToolResult Tests
// ============================================================================

test("McpToolResult: constructs with default values", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({});
  assert.equal(result.success, true);
  assert.deepEqual(result.content, []);
  assert.equal(result.error, null);
  assert.equal(result.isError, false);
});

test("McpToolResult: constructs with provided values", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({
    success: false,
    content: [{ type: "text", text: "Error occurred" }],
    error: "Network failure",
    isError: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.content.length, 1);
  assert.equal(result.error, "Network failure");
  assert.equal(result.isError, true);
});

test("McpToolResult: getText extracts text content", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({
    content: [
      { type: "text", text: "Hello" },
      { type: "json", data: { foo: "bar" } },
      { type: "text", text: "World" },
    ],
  });

  assert.equal(result.getText(), "Hello\nWorld");
});

test("McpToolResult: getText handles empty content", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const result = new McpToolResult({ content: [] });
  assert.equal(result.getText(), "");

  const result2 = new McpToolResult({ content: [{ type: "json", data: {} }] });
  assert.equal(result2.getText(), "");
});

test("McpToolResult: coerces non-array content and tolerates missing text fields", async () => {
  const { McpToolResult } = await import("../../../js/agents/mcp/mcp-client.js");

  const r1 = new McpToolResult({ success: true, content: /** @type {any} */ ("nope") });
  assert.deepEqual(r1.content, []);

  const r2 = new McpToolResult({ success: true, content: [{ type: "text" }] });
  assert.equal(r2.getText(), "");
});

// ============================================================================
// McpProvider Tests
// ============================================================================

test("McpProvider: base class throws not implemented errors", async () => {
  const { McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  const provider = new McpProvider({ id: "test", name: "Test", endpoint: "local" });
  assert.equal(provider.id, "test");
  assert.equal(provider.name, "Test");
  assert.equal(provider.endpoint, "local");

  await assert.rejects(provider.listTools(), /not implemented/i);
  await assert.rejects(provider.callTool("foo", {}), /not implemented/i);
});

test("McpProvider: defaults id/name/endpoint when missing", async () => {
  const { McpProvider } = await import("../../../js/agents/mcp/mcp-client.js");

  const provider = new McpProvider({});
  assert.equal(provider.id, "provider_unknown");
  assert.equal(provider.name, "provider_unknown");
  assert.equal(provider.endpoint, "local");
});

// ============================================================================
// McpClient Tests
// ============================================================================

test("McpClient: constructs with no providers", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  assert.deepEqual(client.listProviders(), []);
  assert.equal(client.getProvider("any"), null);
});

test("McpClient: addProvider adds and sets default", async () => {
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

  assert.deepEqual(client.listProviders(), ["test"]);
  assert.ok(client.getProvider("test") instanceof McpProvider);
});

test("McpClient: addProvider throws for non-McpProvider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  assert.throws(() => client.addProvider({}), /must be McpProvider instance/);
  assert.throws(() => client.addProvider(null), /must be McpProvider instance/);
});

test("McpClient: setDefaultProvider works correctly", async () => {
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
  assert.equal(client._defaultProviderId, "p1");

  client.setDefaultProvider("p2");
  assert.equal(client._defaultProviderId, "p2");
});

test("McpClient: setDefaultProvider throws for unknown provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  assert.throws(() => client.setDefaultProvider("unknown"), /provider not found/);
});

test("McpClient: setDefaultProvider throws for empty string", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  assert.throws(() => client.setDefaultProvider(""), /must be a non-empty string/);
});

test("McpClient: callTool returns error result for missing provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const result = await client.callTool("test", {});

  assert.equal(result.success, false);
  assert.equal(result.isError, true);
  assert.ok(String(result.error).includes("No provider found"));
});

test("McpClient: callTool routes to correct provider", async () => {
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
  assert.equal(r1.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "p1");

  const r2 = await client.callTool("bar", { y: 2 }, { providerId: "p2" });
  assert.equal(r2.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].provider, "p2");
});

test("McpClient: callTool handles provider exceptions", async () => {
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

  assert.equal(result.success, false);
  assert.equal(result.isError, true);
  assert.ok(String(result.error).includes("Provider crashed"));
});

test("McpClient: listAllTools merges tools from all providers", async () => {
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

  assert.equal(tools.length, 2);
  assert.equal(tools[0].name, "tool1");
  assert.equal(tools[0].providerId, "p1");
  assert.equal(tools[1].name, "tool2");
  assert.equal(tools[1].providerId, "p2");
});

test("McpClient: listAllTools captures provider failures (non-fatal)", async () => {
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
  assert.equal(Array.isArray(tools), true);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].providerId, "good");

  assert.ok(Array.isArray(tools.errors));
  assert.equal(tools.errors.length, 1);
  assert.equal(tools.errors[0].providerId, "bad");
  assert.ok(String(tools.errors[0].error).includes("boom"));
});

test("McpClient: listAllTools uses 'Unknown error' when a provider rejects with falsy reason", async () => {
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
  assert.equal(tools.length, 0);
  assert.ok(Array.isArray(tools.errors));
  assert.ok(tools.errors[0].error.includes("Unknown error"));
});

test("McpClient: healthCheck returns ok for provider with listTools", async () => {
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

  assert.equal(health.ok, true);
  assert.equal(health.providerId, "healthy");
  assert.equal(health.toolCount, 1);
});

test("McpClient: healthCheck returns not ok for missing provider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const health = await client.healthCheck({ providerId: "missing" });

  assert.equal(health.ok, false);
  assert.ok(String(health.error).includes("No provider found"));
});

test("McpClient: healthCheck uses provider.healthCheck if available", async () => {
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

  assert.equal(health.ok, true);
  assert.equal(health.custom, true);
});

test("McpClient: healthCheck returns ok:false when provider.healthCheck throws", async () => {
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

  assert.equal(health.ok, false);
  assert.equal(health.providerId, "failing");
  assert.ok(String(health.error).includes("health check failed"));
});

test("McpClient: healthCheckAll checks all providers", async () => {
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

  assert.equal(results.length, 2);

  const good = results.find((r) => r.providerId === "good");
  const bad = results.find((r) => r.providerId === "bad");

  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
  assert.ok(String(bad.error).includes("Provider down"));
});

test("McpClient: healthCheck handles missing defaultProvider", async () => {
  const { McpClient } = await import("../../../js/agents/mcp/mcp-client.js");

  const client = new McpClient();
  const r = await client.healthCheck();
  assert.equal(r.ok, false);
  assert.equal(r.providerId, null);
});

test("McpClient: healthCheck handles non-array listTools results", async () => {
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
  assert.equal(r.ok, true);
  assert.equal(r.toolCount, 0);
});

// ============================================================================
// McpTransport Tests
// ============================================================================

test("McpTransport: base class throws not implemented for abstract methods", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  assert.equal(transport.isConnected(), false);

  await assert.rejects(transport.connect(), /not implemented/i);
  await assert.rejects(transport.disconnect(), /not implemented/i);
  await assert.rejects(transport.send({}), /not implemented/i);
});

test("McpTransport: request throws when not connected", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();
  await assert.rejects(transport.request("test", {}), /not connected/i);
});

test("McpTransport: request/response handling via _handleMessage", async () => {
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

  assert.deepEqual(result, { echo: { foo: "bar" } });
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].method, "test.method");
});

test("McpTransport: request handles error response", async () => {
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
  await assert.rejects(transport.request("test", {}), /Invalid Request/);
});

test("McpTransport: request times out", async () => {
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
  await assert.rejects(transport.request("test", {}), /timeout/i);
});

test("McpTransport: notify sends message without id", async () => {
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

  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].id, undefined);
  assert.equal(transport.sent[0].method, "notifications/initialized");
  assert.deepEqual(transport.sent[0].params, { ready: true });
});

test("McpTransport: _handleMessage emits notification events", async () => {
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

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { reason: "added" });
});

test("McpTransport: _rejectAllPending clears pending requests", async () => {
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

  assert.equal(transport._pending.size, 2);

  transport._rejectAllPending(new Error("Connection lost"));

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "Connection lost");
  assert.equal(r2, "Connection lost");
  assert.equal(transport._pending.size, 0);
});

test("McpTransport: _handleMessage emits generic message event", async () => {
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

  assert.equal(received.length, 1);
  assert.equal(received[0].method, "some/notification");
});

// ============================================================================
// MCP Protocol Constants Tests
// ============================================================================

test("MCP constants are exported correctly", async () => {
  const { MCP_PROTOCOL_VERSION, MCP_SUPPORTED_VERSIONS, McpMethods } = await import(
    "../../../js/agents/mcp/mcp-transport.js"
  );

  assert.equal(typeof MCP_PROTOCOL_VERSION, "string");
  assert.ok(Array.isArray(MCP_SUPPORTED_VERSIONS));
  assert.ok(MCP_SUPPORTED_VERSIONS.includes(MCP_PROTOCOL_VERSION));

  assert.equal(McpMethods.INITIALIZE, "initialize");
  assert.equal(McpMethods.TOOLS_LIST, "tools/list");
  assert.equal(McpMethods.TOOLS_CALL, "tools/call");
  assert.equal(McpMethods.PING, "ping");
  assert.equal(McpMethods.INITIALIZED, "notifications/initialized");
  assert.equal(McpMethods.SHUTDOWN, "shutdown");
  assert.equal(McpMethods.RESOURCES_LIST, "resources/list");
  assert.equal(McpMethods.RESOURCES_READ, "resources/read");
  assert.equal(McpMethods.PROMPTS_LIST, "prompts/list");
  assert.equal(McpMethods.PROMPTS_GET, "prompts/get");
});

// ============================================================================
// Transport Constants Tests
// ============================================================================

test("TransportKind constants and validators", async () => {
  const { TransportKind, isValidTransportKind, normalizeTransportKind } = await import(
    "../../../js/agents/mcp/constants.js"
  );

  assert.equal(TransportKind.JSONRPC, "jsonrpc");
  assert.equal(TransportKind.TOOLAPI, "toolapi");
  assert.equal(TransportKind.REST, "rest");

  assert.equal(isValidTransportKind("jsonrpc"), true);
  assert.equal(isValidTransportKind("toolapi"), true);
  assert.equal(isValidTransportKind("rest"), true);
  assert.equal(isValidTransportKind("invalid"), false);
  assert.equal(isValidTransportKind(null), false);
  assert.equal(isValidTransportKind(undefined), false);

  assert.equal(normalizeTransportKind("JSONRPC"), "jsonrpc");
  assert.equal(normalizeTransportKind("  rest  "), "rest");
  assert.equal(normalizeTransportKind("TOOLAPI"), "toolapi");
  assert.equal(normalizeTransportKind("unknown"), undefined);
  assert.equal(normalizeTransportKind(123), undefined);
});

// ============================================================================
// Circuit Breaker Integration Tests
// ============================================================================

test("McpClient: circuit breaker opens after repeated failures", async () => {
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
    assert.equal(r.success, false);
  }

  const blocked = await client.callTool("x", {});
  assert.equal(blocked.success, false);
  assert.ok(String(blocked.error).toLowerCase().includes("circuit open"));
  assert.equal(provider.calls, 3);
});

test("McpClient: circuit breaker ignores unknown tool errors", async () => {
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
    assert.equal(r.success, false);
    assert.ok(String(r.error).includes("unknown tool"));
  }
  assert.equal(provider.calls, 6);
});

test("McpClient: circuit breaker ignores AbortError", async () => {
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
    assert.equal(r.success, false);
  }

  assert.equal(provider.calls, 5);
});

test("McpClient: circuit breaker ignores 'invalid arguments' errors", async () => {
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

  assert.equal(provider.calls, 6);
});

test("McpClient: circuit breaker ignores 'no such tool' errors", async () => {
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

  assert.equal(provider.calls, 6);
});

test("McpClient: circuit breaker ignores 'tool not found' errors", async () => {
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

  assert.equal(provider.calls, 6);
});

// ============================================================================
// Convenience Methods Tests
// ============================================================================

test("McpClient: search convenience method tries standard names first", async () => {
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

  assert.equal(result.success, true);
  assert.equal(calls[0], "search.query");
});

test("McpClient: fetch convenience method tries standard names first", async () => {
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

  assert.equal(result.success, true);
  assert.equal(calls[0], "search.fetch");
});

test("McpClient: search falls back to legacy tool names", async () => {
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

  assert.equal(result.success, true);
  assert.deepEqual(calls, ["search.query", "search"]);
});

test("McpClient: fetch falls back to legacy tool names", async () => {
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

  assert.equal(result.success, true);
  assert.deepEqual(calls, ["search.fetch", "fetch_content"]);
});

test("McpClient: search/fetch return last result when all fail", async () => {
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
  assert.equal(sr.success, false);
  assert.ok(String(sr.error).includes("fail:search"));

  const fr = await client.fetch({ url: "https://example.com" });
  assert.equal(fr.success, false);
  assert.ok(String(fr.error).includes("fail:fetch"));
});

// ============================================================================
// Constructor Options Tests
// ============================================================================

test("McpClient: accepts defaultProvider as McpProvider instance", async () => {
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

  assert.deepEqual(client.listProviders(), ["direct"]);
  assert.equal(client._defaultProviderId, "direct");
});

test("McpClient: accepts defaultProvider as string", async () => {
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

  assert.equal(client._defaultProviderId, "p2");
});

test("McpTransport: respects constructor options", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport({
    timeout: 10000,
    heartbeatInterval: 5000,
    maxRetries: 5,
    reconnectDelayBase: 2000,
  });

  assert.equal(transport.timeout, 10000);
  assert.equal(transport.heartbeatInterval, 5000);
  assert.equal(transport.maxRetries, 5);
  assert.equal(transport.reconnectDelayBase, 2000);
});

test("McpTransport: uses default options when not provided", async () => {
  const { McpTransport } = await import("../../../js/agents/mcp/mcp-transport.js");

  const transport = new McpTransport();

  assert.equal(transport.timeout, 30000);
  assert.equal(transport.heartbeatInterval, 30000);
  assert.equal(transport.maxRetries, 3);
  assert.equal(transport.reconnectDelayBase, 1000);
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

test("McpClient: callTool returns provider result when success:false", async () => {
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
  assert.equal(r, providerResult);
});

test("McpClient: handles empty/falsy thrown errors", async () => {
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
  assert.equal(r1.success, false);

  throwEmpty = false;
  const r2 = await client.callTool("x", {});
  assert.equal(r2.success, false);
});

test("McpClient: getProvider uses defaultProviderId when no id provided", async () => {
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

  assert.equal(client.getProvider(), p1);
  assert.equal(client.getProvider("p1"), p1);
  assert.equal(client.getProvider("nonexistent"), null);
});

test("McpClient: handles non-McpProvider in providers array", async () => {
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

  assert.deepEqual(client.listProviders(), ["valid"]);
});

test("McpTransport: request handles send failure", async () => {
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
  await assert.rejects(transport.request("test", {}), /Send failed/);
});

test("McpTransport: _handleMessage handles response with unknown id gracefully", async () => {
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

  assert.equal(received.length, 1);
  assert.equal(received[0].id, 999);
});
