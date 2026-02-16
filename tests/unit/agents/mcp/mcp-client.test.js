import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  class MockCircuitBreaker {
    static instances = [];
    constructor(options) {
      this.options = options;
      this.execute = vi.fn(async (fn) => fn());
      MockCircuitBreaker.instances.push(this);
    }
  }
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    CircuitBreaker: MockCircuitBreaker,
  };
});

import { McpToolDefinition, McpToolResult, McpProvider, McpClient } from "../../../../js/agents/mcp/mcp-client.js";
import * as shared from "../../../../js/agents/shared/index.js";

const makeDeepObject = (depth) => {
  const root = {};
  let node = root;
  for (let i = 0; i < depth; i += 1) {
    node[`level_${i}`] = {};
    node = node[`level_${i}`];
  }
  return root;
};

const wrapFn = (fn) => (vi.isMockFunction(fn) ? fn : vi.fn(fn));

const makeProvider = ({ id = "p1", name, endpoint, listTools, callTool, healthCheck } = {}) => {
  class TestProvider extends McpProvider {}
  const provider = new TestProvider({ id, name, endpoint });
  provider.listTools = listTools ? wrapFn(listTools) : vi.fn(async () => []);
  provider.callTool = callTool
    ? wrapFn(callTool)
    : vi.fn(async () => new McpToolResult({ success: true, content: [] }));
  if (healthCheck) provider.healthCheck = wrapFn(healthCheck);
  return provider;
};

const isValidIso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

beforeEach(() => {
  vi.clearAllMocks();
  shared.CircuitBreaker.instances.length = 0;
});

describe("McpToolDefinition", () => {
  it("constructs with valid options", () => {
    const schema = { type: "object", properties: { query: { type: "string" } } };
    const tool = new McpToolDefinition({
      name: "search.query",
      description: "Search the web",
      inputSchema: schema,
    });

    expect(tool.name).toBe("search.query");
    expect(tool.description).toBe("Search the web");
    expect(tool.inputSchema).toBe(schema);
  });

  it("falls back for empty or invalid values", () => {
    const tool = new McpToolDefinition({});
    expect(tool.name).toBe("unknown");
    expect(tool.description).toBe("");
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });

    const tool2 = new McpToolDefinition({ name: "   ", description: null, inputSchema: [] });
    expect(tool2.name).toBe("unknown");
    expect(tool2.description).toBe("");
    expect(tool2.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("accepts plain object schemas and boundary values", () => {
    const deepSchema = makeDeepObject(12);
    const tool = new McpToolDefinition({ name: 0, description: "  ", inputSchema: deepSchema });
    expect(tool.name).toBe("0");
    expect(tool.description).toBe("");
    expect(tool.inputSchema).toBe(deepSchema);

    const emptySchemaTool = new McpToolDefinition({ name: "t", inputSchema: {} });
    expect(emptySchemaTool.inputSchema).toEqual({});
  });
});

describe("McpToolResult", () => {
  it("constructs with default values", () => {
    const result = new McpToolResult({});
    expect(result.success).toBe(true);
    expect(result.content).toEqual([]);
    expect(result.error).toBe(null);
    expect(result.isError).toBe(false);
  });

  it("coerces values and ignores non-array content", () => {
    const result = new McpToolResult({
      success: 0,
      content: /** @type {any} */ ({ type: "text", text: "nope" }),
      error: "boom",
      isError: "false",
    });

    expect(result.success).toBe(false);
    expect(result.content).toEqual([]);
    expect(result.error).toBe("boom");
    expect(result.isError).toBe(true);
  });

  it("getText filters and joins text content", () => {
    const result = new McpToolResult({
      content: [
        { type: "text", text: "Hello" },
        { type: "json", data: { foo: "bar" } },
        { type: "text" },
        { type: "text", text: "World" },
      ],
    });

    expect(result.getText()).toBe("Hello\n\nWorld");
  });

  it("handles large text payloads and empty arrays", () => {
    const bigText = "x".repeat(200000);
    const result = new McpToolResult({ content: [{ type: "text", text: bigText }] });
    expect(result.getText().length).toBe(bigText.length);

    const empty = new McpToolResult({ content: [] });
    expect(empty.getText()).toBe("");
  });
});

describe("McpProvider", () => {
  it("normalizes options and applies defaults", () => {
    const provider = new McpProvider({ id: " ", name: "", endpoint: undefined });
    expect(provider.id).toBe("provider_unknown");
    expect(provider.name).toBe("provider_unknown");
    expect(provider.endpoint).toBe("local");

    const provider2 = new McpProvider({ id: "p1", name: "Provider", endpoint: "remote" });
    expect(provider2.id).toBe("p1");
    expect(provider2.name).toBe("Provider");
    expect(provider2.endpoint).toBe("remote");
  });

  it("throws for unimplemented methods", async () => {
    const provider = new McpProvider();
    await expect(provider.listTools()).rejects.toThrow(/not implemented/);
    await expect(provider.callTool("tool", {})).rejects.toThrow(/not implemented/);
  });
});

describe("McpClient", () => {
  it("registers providers and selects the first as default", () => {
    const p1 = makeProvider({ id: "p1" });
    const p2 = makeProvider({ id: "p2" });
    const client = new McpClient({ providers: [p1, null, "skip", p2] });

    expect(client.listProviders()).toEqual(["p1", "p2"]);
    expect(client.getProvider().id).toBe("p1");
  });

  it("respects defaultProvider instance and string overrides", () => {
    const p1 = makeProvider({ id: "p1" });
    const p2 = makeProvider({ id: "p2" });
    const client = new McpClient({ providers: [p1], defaultProvider: p2 });

    expect(client.getProvider().id).toBe("p2");
    expect(client.listProviders()).toEqual(["p1", "p2"]);

    const client2 = new McpClient({ providers: [p1], defaultProvider: "missing" });
    expect(client2.getProvider()).toBeNull();
    expect(client2.listProviders()).toEqual(["p1"]);
  });

  it("creates and caches circuit breakers with failure rules", () => {
    const p1 = makeProvider({ id: "p1" });
    const time = { now: vi.fn(() => 123456) };
    const client = new McpClient({ providers: [p1], time });

    expect(client._getProviderCircuitBreaker(" ")).toBeNull();

    const breaker = client._getProviderCircuitBreaker("p1");
    const again = client._getProviderCircuitBreaker("p1");
    expect(breaker).toBe(again);
    expect(breaker.options).toMatchObject({
      name: "mcp:p1",
      failureThreshold: 3,
      successThreshold: 1,
      openDurationMs: 10000,
      halfOpenMaxCalls: 1,
      time,
    });

    const isFailure = breaker.options.isFailure;
    expect(isFailure(null)).toBe(true);
    expect(isFailure({ name: "AbortError" })).toBe(false);
    expect(isFailure(new Error("unknown tool"))).toBe(false);
    expect(isFailure({ message: "tool not found" })).toBe(false);
    expect(isFailure({ message: "no such tool" })).toBe(false);
    expect(isFailure({ message: "invalid arguments" })).toBe(false);
    expect(isFailure(new Error("boom"))).toBe(true);
  });

  it("validates addProvider and setDefaultProvider", () => {
    const client = new McpClient();
    expect(() => client.addProvider({})).toThrow(TypeError);

    const p1 = makeProvider({ id: "p1" });
    const out = client.addProvider(p1);
    expect(out).toBe(client);
    expect(client.getProvider().id).toBe("p1");

    expect(() => client.setDefaultProvider(" ")).toThrow(TypeError);
    expect(() => client.setDefaultProvider("missing")).toThrow(/provider not found/);
    expect(client.setDefaultProvider("p1")).toBe(client);
  });

  it("gets providers by id or default", () => {
    const p1 = makeProvider({ id: "p1" });
    const client = new McpClient({ providers: [p1] });

    expect(client.getProvider("p1")).toBe(p1);
    expect(client.getProvider("missing")).toBeNull();
    expect(client.getProvider("   ").id).toBe("p1");
  });

  it("returns health errors when providers are missing", async () => {
    const client = new McpClient();
    const out = await client.healthCheck();
    expect(out.ok).toBe(false);
    expect(out.providerId).toBeNull();
    expect(out.error).toMatch(/No provider found/);
    expect(isValidIso(out.ts)).toBe(true);

    const out2 = await client.healthCheck({ providerId: "missing" });
    expect(out2.ok).toBe(false);
    expect(out2.providerId).toBe("missing");
    expect(out2.error).toMatch(/No provider found/);
    expect(isValidIso(out2.ts)).toBe(true);
  });

  it("delegates healthCheck to provider and handles errors", async () => {
    const healthCheck = vi.fn(async ({ timeoutMs, refreshTools }) => ({
      ok: true,
      providerId: "p1",
      timeoutMs,
      refreshTools,
    }));
    const p1 = makeProvider({ id: "p1", healthCheck });
    const client = new McpClient({ providers: [p1] });

    const out = await client.healthCheck({ timeoutMs: 250, refreshTools: false });
    expect(out).toEqual({ ok: true, providerId: "p1", timeoutMs: 250, refreshTools: false });
    expect(healthCheck).toHaveBeenCalledWith({ timeoutMs: 250, refreshTools: false });

    healthCheck.mockRejectedValueOnce(new Error("boom"));
    const out2 = await client.healthCheck();
    expect(out2.ok).toBe(false);
    expect(out2.providerId).toBe("p1");
    expect(out2.error).toContain("boom");
    expect(isValidIso(out2.ts)).toBe(true);
  });

  it("falls back to listTools for health checks and handles non-array", async () => {
    const listTools = vi.fn(async () => [new McpToolDefinition({ name: "t" })]);
    const p1 = makeProvider({ id: "p1", listTools });
    const client = new McpClient({ providers: [p1] });

    const out = await client.healthCheck();
    expect(out.ok).toBe(true);
    expect(out.toolCount).toBe(1);

    listTools.mockResolvedValueOnce({});
    const out2 = await client.healthCheck();
    expect(out2.ok).toBe(true);
    expect(out2.toolCount).toBe(0);

    listTools.mockRejectedValueOnce(new Error("fail"));
    const out3 = await client.healthCheck();
    expect(out3.ok).toBe(false);
    expect(out3.error).toContain("fail");
  });

  it("aggregates healthCheckAll results in provider order", async () => {
    const p1 = makeProvider({ id: "p1" });
    p1.healthCheck = vi.fn(async () => ({ ok: true, providerId: "p1" }));
    const p2 = makeProvider({
      id: "p2",
      listTools: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const client = new McpClient({ providers: [p1, p2] });

    const results = await client.healthCheckAll();
    expect(results).toHaveLength(2);
    expect(results[0].providerId).toBe("p1");
    expect(results[1].providerId).toBe("p2");
    expect(results[1].ok).toBe(false);
  });

  it("merges listAllTools results and exposes errors", async () => {
    const p1 = makeProvider({
      id: "p1",
      name: "Provider One",
      listTools: vi.fn(async () => [{ name: "t1" }]),
    });
    const p2 = makeProvider({
      id: "p2",
      name: "Provider Two",
      listTools: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const client = new McpClient({ providers: [p1, p2] });

    const tools = await client.listAllTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "t1", providerId: "p1", providerName: "Provider One" });
    expect(Array.isArray(tools.errors)).toBe(true);
    expect(tools.errors[0].providerId).toBe("p2");
    expect(Object.prototype.propertyIsEnumerable.call(tools, "errors")).toBe(false);
  });

  it("returns error results when providers are missing", async () => {
    const client = new McpClient({ defaultProvider: "missing" });
    const out = await client.callTool("tool", {}, {});
    expect(out.success).toBe(false);
    expect(out.isError).toBe(true);
    expect(out.error).toContain("No provider found");
    expect(out.content[0].text).toContain("No provider found");
  });

  it("returns provider failures and wraps thrown errors", async () => {
    const fail = new McpToolResult({
      success: false,
      isError: true,
      error: "bad",
      content: [{ type: "text", text: "fail" }],
    });
    const p1 = makeProvider({ id: "p1", callTool: vi.fn(async () => fail) });
    const client = new McpClient({ providers: [p1] });

    const out = await client.callTool("tool", { a: 1 });
    expect(out).toBe(fail);

    p1.callTool.mockRejectedValueOnce("boom");
    const out2 = await client.callTool("tool", { a: 1 });
    expect(out2.success).toBe(false);
    expect(out2.error).toBe("boom");
    expect(out2.content[0].text).toContain("Error calling tool");
  });

  it("handles circuit open errors and skipCircuit", async () => {
    const p1 = makeProvider({ id: "p1" });
    const client = new McpClient({ providers: [p1] });

    const breaker = client._getProviderCircuitBreaker("p1");
    breaker.execute.mockRejectedValueOnce({ name: "CircuitBreakerOpenError" });
    const out = await client.callTool("tool", {});
    expect(out.success).toBe(false);
    expect(out.error).toContain("Provider circuit open: p1");

    const out2 = await client.callTool("tool", {}, { skipCircuit: true });
    expect(out2.success).toBe(true);
    expect(shared.CircuitBreaker.instances.length).toBe(1);
  });

  it("supports concurrent and rapid callTool invocations", async () => {
    const p1 = makeProvider({ id: "p1" });
    const client = new McpClient({ providers: [p1] });

    await Promise.all([client.callTool("t1"), client.callTool("t2")]);
    await client.callTool("t3");
    await client.callTool("t4");

    expect(p1.callTool).toHaveBeenCalledTimes(4);
    expect(shared.CircuitBreaker.instances.length).toBe(1);
    expect(shared.CircuitBreaker.instances[0].execute).toHaveBeenCalledTimes(4);
  });

  it("search passes args, falls back on circuit open, and supports boundaries", async () => {
    const client = new McpClient();
    const callSpy = vi.spyOn(client, "callTool");
    const circuit = new McpToolResult({ success: false, error: "Circuit open" });
    const ok = new McpToolResult({ success: true, content: [{ type: "text", text: "ok" }] });

    callSpy.mockResolvedValueOnce(circuit).mockResolvedValueOnce(ok);

    const filters = makeDeepObject(8);
    const out = await client.search({ query: "  q ", domain: "", timeRange: "7d", limit: 0, filters });
    expect(out).toBe(ok);

    expect(callSpy).toHaveBeenNthCalledWith(
      1,
      "search.query",
      { query: "  q ", domain: "", time_range: "7d", limit: 0, filters },
      { providerId: undefined }
    );
    // Circuit open → falls back to legacy "search" tool name (no skipCircuit retry)
    expect(callSpy).toHaveBeenNthCalledWith(
      2,
      "search",
      { query: "  q ", domain: "", time_range: "7d", limit: 0, filters },
      { providerId: undefined }
    );
  });

  it("search falls back to legacy tool names and supports concurrent calls", async () => {
    const client = new McpClient();
    const callSpy = vi.spyOn(client, "callTool");
    const fail = new McpToolResult({ success: false, error: "no such tool" });
    const ok = new McpToolResult({ success: true, content: [] });

    callSpy.mockResolvedValueOnce(fail).mockResolvedValueOnce(ok);

    const out = await client.search({ query: "q" }, { providerId: "p1" });
    expect(out).toBe(ok);
    expect(callSpy).toHaveBeenNthCalledWith(1, "search.query", expect.any(Object), { providerId: "p1" });
    expect(callSpy).toHaveBeenNthCalledWith(2, "search", expect.any(Object), { providerId: "p1" });

    callSpy.mockResolvedValue(ok);
    const limits = [0, -1, Number.MAX_SAFE_INTEGER, "7"];
    await Promise.all(limits.map((limit, index) => client.search({ query: `q${index}`, limit })));

    expect(callSpy).toHaveBeenCalledTimes(2 + limits.length);
    for (let i = 0; i < limits.length; i += 1) {
      const args = callSpy.mock.calls[2 + i][1];
      expect(args.limit).toBe(limits[i]);
    }
  });

  it("fetch passes url, falls back on circuit open and tool names", async () => {
    const client = new McpClient();
    const callSpy = vi.spyOn(client, "callTool");
    const fail = new McpToolResult({ success: false, error: "nope" });
    const circuit = new McpToolResult({ success: false, error: "circuit open" });
    const ok = new McpToolResult({ success: true, content: [] });
    const longUrl = `https://example.com/${"a".repeat(2048)}`;

    callSpy
      .mockResolvedValueOnce(circuit)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok);

    const out = await client.fetch({ url: longUrl }, { providerId: "p1" });
    expect(out).toBe(ok);

    // Circuit open on search.fetch → falls back to fetch_content (no skipCircuit retry)
    expect(callSpy).toHaveBeenNthCalledWith(1, "search.fetch", { url: longUrl }, { providerId: "p1" });
    expect(callSpy).toHaveBeenNthCalledWith(2, "fetch_content", { url: longUrl }, { providerId: "p1" });

    const out2 = await client.fetch({ url: "https://fallback.test" });
    expect(out2).toBe(ok);
    expect(callSpy).toHaveBeenNthCalledWith(3, "search.fetch", { url: "https://fallback.test" }, { providerId: undefined });
    expect(callSpy).toHaveBeenNthCalledWith(4, "fetch_content", { url: "https://fallback.test" }, { providerId: undefined });
    expect(callSpy).toHaveBeenNthCalledWith(5, "fetch", { url: "https://fallback.test" }, { providerId: undefined });
  });
});
