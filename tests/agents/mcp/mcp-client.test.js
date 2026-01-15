import { afterEach, describe, expect, it, vi } from "vitest";

import { McpClient, McpProvider, McpToolDefinition, McpToolResult } from "../../../js/agents/mcp/mcp-client.js";

class MockProvider extends McpProvider {
  /**
   * @param {object} options
   * @param {string=} options.id
   * @param {string=} options.name
   * @param {any=} options.listToolsImpl
   * @param {any=} options.callToolImpl
   * @param {any=} options.healthCheckImpl
   */
  constructor({ id = "p1", name = "P1", listToolsImpl, callToolImpl, healthCheckImpl } = {}) {
    super({ id, name, endpoint: "mock" });
    this.listTools = vi.fn(listToolsImpl || (async () => []));
    this.callTool = vi.fn(callToolImpl || (async () => new McpToolResult({ success: true, content: [] })));
    if (healthCheckImpl) {
      this.healthCheck = vi.fn(healthCheckImpl);
    }
  }
}

describe("mcp-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("McpToolDefinition normalizes name/description/inputSchema", () => {
    const d1 = new McpToolDefinition({ name: "", description: null, inputSchema: null });
    expect(d1.name).toBe("unknown");
    expect(d1.description).toBe("");
    expect(d1.inputSchema).toEqual({ type: "object", properties: {} });

    const d2 = new McpToolDefinition({ name: "t", description: "d", inputSchema: { type: "object", properties: { a: { type: "string" } } } });
    expect(d2.name).toBe("t");
    expect(d2.description).toBe("d");
    expect(d2.inputSchema).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });

  it("McpToolResult.getText concatenates text blocks", () => {
    const r = new McpToolResult({
      success: true,
      content: [
        { type: "text", text: "a" },
        { type: "json", data: { x: 1 } },
        { type: "text", text: "b" },
      ],
    });
    expect(r.getText()).toBe("a\nb");
  });

  it("McpToolResult coerces non-array content and tolerates missing text fields", () => {
    const r1 = new McpToolResult({ success: true, content: /** @type {any} */ ("nope") });
    expect(r1.content).toEqual([]);

    const r2 = new McpToolResult({ success: true, content: [{ type: "text" }] });
    expect(r2.getText()).toBe("");
  });

  it("manages providers (add/setDefault/get/list) with validation", () => {
    const p1 = new MockProvider({ id: "p1" });
    const p2 = new MockProvider({ id: "p2" });

    const client = new McpClient({ providers: [p1, p2] });
    expect(client.getProvider()).toBe(p1);
    expect(client.listProviders().sort()).toEqual(["p1", "p2"]);

    client.setDefaultProvider("p2");
    expect(client.getProvider()).toBe(p2);

    expect(() => client.setDefaultProvider("missing")).toThrow(/provider not found/i);
    expect(() => client.setDefaultProvider("")).toThrow(/non-empty string/i);
    expect(() => client.addProvider({})).toThrow(/must be McpProvider/i);
  });

  it("supports defaultProvider passed as a provider instance", () => {
    const p = new MockProvider({ id: "p1", name: "P1" });
    const client = new McpClient({ providers: [], defaultProvider: p });
    expect(client.listProviders()).toEqual(["p1"]);
    expect(client.getProvider()).toBe(p);
  });

  it("addProvider sets the default provider when the client is empty", () => {
    const p = new MockProvider({ id: "p1" });
    const client = new McpClient();
    client.addProvider(p);
    expect(client.getProvider()).toBe(p);
  });

  it("healthCheck uses provider.healthCheck when present; otherwise falls back to listTools", async () => {
    const withHealth = new MockProvider({
      id: "hp",
      healthCheckImpl: async ({ timeoutMs, refreshTools }) => ({ ok: true, timeoutMs, refreshTools, providerId: "hp" }),
    });
    const noHealth = new MockProvider({
      id: "lp",
      listToolsImpl: async () => [{ name: "t", description: "", inputSchema: { type: "object", properties: {} } }],
    });

    const client = new McpClient({ providers: [withHealth, noHealth], defaultProvider: "hp" });

    await expect(client.healthCheck({ providerId: "hp", timeoutMs: 123, refreshTools: false })).resolves.toMatchObject({
      ok: true,
      providerId: "hp",
      timeoutMs: 123,
      refreshTools: false,
    });

    await expect(client.healthCheck({ providerId: "lp" })).resolves.toMatchObject({
      ok: true,
      providerId: "lp",
      toolCount: 1,
    });

    const missing = await client.healthCheck({ providerId: "nope" });
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toMatch(/no provider found/i);
  });

  it("healthCheck handles missing defaultProvider and non-array listTools results", async () => {
    const client = new McpClient();
    const r1 = await client.healthCheck();
    expect(r1.ok).toBe(false);
    expect(r1.providerId).toBe(null);

    const p = new MockProvider({
      id: "p1",
      listToolsImpl: async () => /** @type {any} */ ({ not: "an array" }),
    });
    client.addProvider(p);
    const r2 = await client.healthCheck({ providerId: "p1" });
    expect(r2.ok).toBe(true);
    expect(r2.toolCount).toBe(0);
  });

  it("healthCheck returns ok:false when provider.healthCheck or fallback listTools throws", async () => {
    const hcThrows = new MockProvider({
      id: "hc",
      healthCheckImpl: async () => {
        throw new Error("boom");
      },
    });
    const listThrows = new MockProvider({
      id: "lp",
      listToolsImpl: async () => {
        throw new Error("nope");
      },
    });

    const client = new McpClient({ providers: [hcThrows, listThrows], defaultProvider: "hc" });

    await expect(client.healthCheck({ providerId: "hc" })).resolves.toMatchObject({ ok: false, providerId: "hc" });
    await expect(client.healthCheck({ providerId: "lp" })).resolves.toMatchObject({ ok: false, providerId: "lp" });
  });

  it("healthCheckAll returns a result per provider and tolerates per-provider rejections", async () => {
    const p1 = new MockProvider({ id: "p1" });
    const p2 = new MockProvider({ id: "p2" });
    const client = new McpClient({ providers: [p1, p2], defaultProvider: "p1" });

    vi.spyOn(client, "healthCheck").mockImplementation(async ({ providerId }) => {
      if (providerId === "p2") throw new Error("boom");
      return { ok: true, providerId, ts: "x" };
    });

    const out = await client.healthCheckAll();
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.providerId === "p1")).toMatchObject({ ok: true, providerId: "p1" });
    expect(out.find((r) => r.providerId === "p2")).toMatchObject({ ok: false, providerId: "p2" });
  });

  it("listAllTools merges tools and captures per-provider failures (as non-enumerable tools.errors)", async () => {
    const good = new MockProvider({
      id: "good",
      name: "Good",
      listToolsImpl: async () => [{ name: "ok.tool", description: "ok", inputSchema: { type: "object", properties: {} } }],
    });
    const bad = new MockProvider({
      id: "bad",
      name: "Bad",
      listToolsImpl: async () => {
        throw new Error("boom");
      },
    });

    const client = new McpClient({ providers: [good, bad], defaultProvider: "good" });
    const tools = await client.listAllTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "ok.tool", providerId: "good", providerName: "Good" });

    expect(Array.isArray(tools.errors)).toBe(true);
    expect(tools.errors).toHaveLength(1);
    expect(tools.errors[0]).toMatchObject({ providerId: "bad" });
    expect(String(tools.errors[0].error)).toContain("boom");

    expect(Object.prototype.propertyIsEnumerable.call(tools, "errors")).toBe(false);
    expect(Object.keys(tools)).not.toContain("errors");
  });

  it("listAllTools uses 'Unknown error' when a provider rejects with a falsy reason", async () => {
    const bad = new MockProvider({
      id: "bad",
      listToolsImpl: async () => {
        throw null;
      },
    });
    const client = new McpClient({ providers: [bad], defaultProvider: "bad" });
    const tools = await client.listAllTools();
    expect(tools).toHaveLength(0);
    expect(Array.isArray(tools.errors)).toBe(true);
    expect(tools.errors[0].error).toContain("Unknown error");
  });

  it("listAllTools falls back to direct assignment when Object.defineProperty fails", async () => {
    const good = new MockProvider({
      id: "good",
      listToolsImpl: async () => [{ name: "ok.tool", description: "ok", inputSchema: { type: "object", properties: {} } }],
    });
    const bad = new MockProvider({
      id: "bad",
      listToolsImpl: async () => {
        throw new Error("boom");
      },
    });

    // Only fail the specific defineProperty attempt done by listAllTools for `errors`.
    vi.spyOn(Object, "defineProperty").mockImplementation((obj, prop, desc) => {
      if (Array.isArray(obj) && prop === "errors" && desc?.enumerable === false) {
        throw new Error("nope");
      }
      const ok = Reflect.defineProperty(obj, prop, desc);
      if (!ok) throw new Error("defineProperty failed");
      return obj;
    });

    const client = new McpClient({ providers: [good, bad], defaultProvider: "good" });
    const tools = await client.listAllTools();
    expect(tools).toHaveLength(1);
    expect(Array.isArray(tools.errors)).toBe(true);
    expect(Object.prototype.propertyIsEnumerable.call(tools, "errors")).toBe(true);

    // spy restored by afterEach()
  });

  it("callTool returns structured error when provider is missing", async () => {
    const client = new McpClient();
    const r = await client.callTool("x", {}, { providerId: "missing" });
    expect(r.success).toBe(false);
    expect(r.isError).toBe(true);
    expect(String(r.error)).toMatch(/no provider found/i);
    expect(r.getText()).toMatch(/no provider found/i);
  });

  it("callTool returns the provider McpToolResult when provider returns success:false", async () => {
    const providerResult = new McpToolResult({
      success: false,
      isError: true,
      error: "bad args",
      content: [{ type: "text", text: "bad args" }],
    });

    const p = new MockProvider({
      id: "p1",
      callToolImpl: async () => providerResult,
    });

    const client = new McpClient({ providers: [p], defaultProvider: "p1", time: { now: () => 0 } });
    const r = await client.callTool("t", { a: 1 });
    expect(r).toBe(providerResult);
  });

  it("opens provider circuit after repeated failures and blocks subsequent calls", async () => {
    const failing = new MockProvider({
      id: "p1",
      callToolImpl: async () =>
        new McpToolResult({ success: false, isError: true, error: "network down", content: [{ type: "text", text: "down" }] }),
    });

    const client = new McpClient({ providers: [failing], defaultProvider: "p1", time: { now: () => 0 } });

    for (let i = 0; i < 3; i++) {
      const r = await client.callTool("x", {});
      expect(r.success).toBe(false);
    }

    const blocked = await client.callTool("x", {});
    expect(blocked.success).toBe(false);
    expect(String(blocked.error).toLowerCase()).toContain("circuit open");
    expect(failing.callTool).toHaveBeenCalledTimes(3);
  });

  it("does not trip the circuit on 'unknown tool' style errors", async () => {
    const unknownTool = new MockProvider({
      id: "p1",
      callToolImpl: async () =>
        new McpToolResult({ success: false, isError: true, error: "unknown tool", content: [{ type: "text", text: "unknown tool" }] }),
    });

    const client = new McpClient({ providers: [unknownTool], defaultProvider: "p1", time: { now: () => 0 } });

    for (let i = 0; i < 6; i++) {
      const r = await client.callTool("nope", {});
      expect(r.success).toBe(false);
      expect(String(r.error)).toContain("unknown tool");
    }

    // If the circuit opened, provider would stop being called.
    expect(unknownTool.callTool).toHaveBeenCalledTimes(6);
  });

  it("does not trip the circuit on AbortError, invalid arguments, or 'no such tool' errors", async () => {
    const aborting = new MockProvider({
      id: "p1",
      callToolImpl: async () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        throw e;
      },
    });

    const invalidArgs = new MockProvider({
      id: "p2",
      callToolImpl: async () =>
        new McpToolResult({ success: false, isError: true, error: "invalid arguments", content: [{ type: "text", text: "bad" }] }),
    });

    const noSuchTool = new MockProvider({
      id: "p3",
      callToolImpl: async () => new McpToolResult({ success: false, isError: true, error: "no such tool", content: [] }),
    });

    const client = new McpClient({ providers: [aborting, invalidArgs, noSuchTool], defaultProvider: "p1", time: { now: () => 0 } });

    for (let i = 0; i < 6; i++) await client.callTool("x", {}, { providerId: "p1" });
    for (let i = 0; i < 6; i++) await client.callTool("x", {}, { providerId: "p2" });
    for (let i = 0; i < 6; i++) await client.callTool("x", {}, { providerId: "p3" });

    expect(aborting.callTool).toHaveBeenCalledTimes(6);
    expect(invalidArgs.callTool).toHaveBeenCalledTimes(6);
    expect(noSuchTool.callTool).toHaveBeenCalledTimes(6);
  });

  it("returns a generic error result for unexpected provider exceptions", async () => {
    const p = new MockProvider({
      id: "p1",
      callToolImpl: async () => {
        throw { message: "boom" };
      },
    });

    const client = new McpClient({ providers: [p], defaultProvider: "p1", time: { now: () => 0 } });
    const r = await client.callTool("x", {});
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain("boom");
  });

  it("treats empty/falsy thrown errors as failures (but still returns a result)", async () => {
    const p = new MockProvider({
      id: "p1",
      callToolImpl: async () => {
        throw new Error(""); // empty message exercises shouldTripProviderCircuit(!msg)
      },
    });

    const client = new McpClient({ providers: [p], defaultProvider: "p1", time: { now: () => 0 } });
    const r1 = await client.callTool("x", {});
    expect(r1.success).toBe(false);

    p.callTool.mockImplementationOnce(async () => {
      // eslint-disable-next-line no-throw-literal
      throw undefined; // falsy throw exercises toErrorMessage fallback ("")
    });
    const r2 = await client.callTool("x", {});
    expect(r2.success).toBe(false);
  });

  it("can bypass circuit breaker when _getProviderCircuitBreaker() returns null", async () => {
    const p = new MockProvider({ id: "p1" });
    const client = new McpClient({ providers: [p], defaultProvider: "p1" });

    vi.spyOn(client, "_getProviderCircuitBreaker").mockReturnValue(null);
    const r = await client.callTool("x", {});
    expect(r.success).toBe(true);
    expect(p.callTool).toHaveBeenCalledTimes(1);
  });

  it("search() and fetch() prefer standard tool names with fallback to legacy aliases", async () => {
    const calls = [];
    const provider = new MockProvider({
      id: "p1",
      callToolImpl: async (toolName, args) => {
        calls.push({ toolName, args });
        if (toolName === "search.query") return new McpToolResult({ success: false, isError: true, error: "unknown tool", content: [] });
        if (toolName === "search") return new McpToolResult({ success: true, content: [{ type: "json", data: { ok: true } }] });

        if (toolName === "search.fetch") return new McpToolResult({ success: false, isError: true, error: "tool not found", content: [] });
        if (toolName === "fetch_content") return new McpToolResult({ success: true, content: [{ type: "text", text: "body" }] });

        return new McpToolResult({ success: false, isError: true, error: "unexpected", content: [] });
      },
    });

    const client = new McpClient({ providers: [provider], defaultProvider: "p1", time: { now: () => 0 } });
    const sr = await client.search({ query: "x" });
    expect(sr.success).toBe(true);

    const fr = await client.fetch({ url: "https://example.com" });
    expect(fr.success).toBe(true);

    expect(calls.map((c) => c.toolName)).toEqual(["search.query", "search", "search.fetch", "fetch_content"]);
  });

  it("search()/fetch() return the last result when all aliases fail", async () => {
    const provider = new MockProvider({
      id: "p1",
      callToolImpl: async (toolName) => new McpToolResult({ success: false, isError: true, error: `nope:${toolName}`, content: [] }),
    });

    const client = new McpClient({ providers: [provider], defaultProvider: "p1", time: { now: () => 0 } });
    // Avoid circuit-breaker interactions; this test is about alias fallback behavior only.
    vi.spyOn(client, "_getProviderCircuitBreaker").mockReturnValue(null);
    const sr = await client.search({ query: "x" });
    expect(sr.success).toBe(false);
    expect(String(sr.error)).toContain("nope:search");

    const fr = await client.fetch({ url: "https://example.com" });
    expect(fr.success).toBe(false);
    expect(String(fr.error)).toContain("nope:fetch");
  });
});
