import { describe, it, expect, vi, beforeEach } from "vitest";
import { mcpSearch, mcpFetch } from "../../../../js/agents/mcp/mcp-shortcuts.js";

vi.mock("../../../../js/agents/mcp/mcp-client.js", () => ({}));

describe("mcpSearch", () => {
  let callTool;
  let client;

  beforeEach(() => {
    callTool = vi.fn();
    client = { callTool };
  });

  it("throws for missing or invalid client", async () => {
    const invalidClients = [null, undefined, {}, { callTool: null }, { callTool: "nope" }];

    for (const invalid of invalidClients) {
      await expect(mcpSearch(invalid)).rejects.toThrow(TypeError);
    }
  });

  it("uses standard tool name and defaults limit", async () => {
    const result = { success: true, data: { results: [] } };
    callTool.mockResolvedValue(result);

    const response = await mcpSearch(
      client,
      {
        query: "alpha",
        domain: "example.com",
        timeRange: "day",
        filters: { tag: "ai" },
      },
      { providerId: "provider-1" }
    );

    expect(response).toBe(result);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(
      "search.query",
      {
        query: "alpha",
        domain: "example.com",
        time_range: "day",
        limit: 10,
        filters: { tag: "ai" },
      },
      { providerId: "provider-1" }
    );
  });

  it("falls back to legacy search tool name when needed", async () => {
    const first = { success: false, error: "unknown" };
    const second = { success: true, data: { results: [1] } };
    callTool.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const response = await mcpSearch(client, { query: "fallback", limit: 2 }, { providerId: "legacy" });

    expect(response).toBe(second);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map((call) => call[0])).toEqual(["search.query", "search"]);
    expect(callTool.mock.calls[0][1]).toEqual({
      query: "fallback",
      domain: undefined,
      time_range: undefined,
      limit: 2,
      filters: undefined,
    });
    expect(callTool.mock.calls[0][2]).toEqual({ providerId: "legacy" });
    expect(callTool.mock.calls[1][1]).toEqual({
      query: "fallback",
      domain: undefined,
      time_range: undefined,
      limit: 2,
      filters: undefined,
    });
    expect(callTool.mock.calls[1][2]).toEqual({ providerId: "legacy" });
  });

  it("returns last result when all attempts fail", async () => {
    const last = { success: false, error: "no results" };
    callTool.mockResolvedValueOnce(null).mockResolvedValueOnce(last);

    const response = await mcpSearch(client, { query: "none" });

    expect(response).toBe(last);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("forwards boundary values without coercion", async () => {
    const hugeString = "x".repeat(100000);
    const deepNested = {
      level1: {
        level2: {
          level3: {
            items: [{ id: 1 }, { id: 2 }],
          },
        },
      },
    };

    const scenarios = [
      {
        args: undefined,
        expected: {
          query: undefined,
          domain: undefined,
          time_range: undefined,
          limit: 10,
          filters: undefined,
        },
      },
      {
        args: { query: null, domain: null, timeRange: null, limit: -1, filters: {} },
        expected: {
          query: null,
          domain: null,
          time_range: null,
          limit: -1,
          filters: {},
        },
      },
      {
        args: { query: "", domain: " ", timeRange: "   ", limit: 0, filters: [] },
        expected: {
          query: "",
          domain: " ",
          time_range: "   ",
          limit: 0,
          filters: [],
        },
      },
      {
        args: {
          query: hugeString,
          domain: "",
          timeRange: "range",
          limit: Number.MAX_SAFE_INTEGER,
          filters: { file: hugeString, nested: deepNested },
        },
        expected: {
          query: hugeString,
          domain: "",
          time_range: "range",
          limit: Number.MAX_SAFE_INTEGER,
          filters: { file: hugeString, nested: deepNested },
        },
      },
      {
        args: { query: "type", limit: "5", filters: { 0: "x", length: 1 } },
        expected: {
          query: "type",
          domain: undefined,
          time_range: undefined,
          limit: "5",
          filters: { 0: "x", length: 1 },
        },
      },
    ];

    callTool.mockResolvedValue({ success: true });

    for (const scenario of scenarios) {
      await mcpSearch(client, scenario.args);
    }

    expect(callTool).toHaveBeenCalledTimes(scenarios.length);
    scenarios.forEach((scenario, index) => {
      const [name, args] = callTool.mock.calls[index];
      expect(name).toBe("search.query");
      expect(args).toEqual(scenario.expected);
    });
  });

  it("handles concurrent calls independently", async () => {
    callTool.mockImplementation(async (name, args) => {
      await Promise.resolve();
      return { success: true, echo: args.query };
    });

    const [r1, r2] = await Promise.all([
      mcpSearch(client, { query: "alpha" }, { providerId: "p1" }),
      mcpSearch(client, { query: "beta" }, { providerId: "p2" }),
    ]);

    expect(r1.echo).toBe("alpha");
    expect(r2.echo).toBe("beta");
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenCalledWith(
      "search.query",
      {
        query: "alpha",
        domain: undefined,
        time_range: undefined,
        limit: 10,
        filters: undefined,
      },
      { providerId: "p1" }
    );
    expect(callTool).toHaveBeenCalledWith(
      "search.query",
      {
        query: "beta",
        domain: undefined,
        time_range: undefined,
        limit: 10,
        filters: undefined,
      },
      { providerId: "p2" }
    );
  });

  it("handles rapid consecutive calls", async () => {
    callTool.mockResolvedValue({ success: true });

    await mcpSearch(client, { query: "one" });
    await mcpSearch(client, { query: "two" });
    await mcpSearch(client, { query: "three" });

    expect(callTool).toHaveBeenCalledTimes(3);
    expect(callTool.mock.calls.map((call) => call[0])).toEqual(["search.query", "search.query", "search.query"]);
    expect(callTool.mock.calls.map((call) => call[1].query)).toEqual(["one", "two", "three"]);
  });
});

describe("mcpFetch", () => {
  let callTool;
  let client;

  beforeEach(() => {
    callTool = vi.fn();
    client = { callTool };
  });

  it("throws for missing or invalid client", async () => {
    const invalidClients = [null, undefined, {}, { callTool: null }, { callTool: "nope" }];

    for (const invalid of invalidClients) {
      await expect(mcpFetch(invalid)).rejects.toThrow(TypeError);
    }
  });

  it("uses standard fetch tool name when available", async () => {
    const result = { success: true, content: [{ type: "text", text: "ok" }] };
    callTool.mockResolvedValue(result);

    const response = await mcpFetch(client, { url: "https://example.com" }, { providerId: "provider-2" });

    expect(response).toBe(result);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(
      "search.fetch",
      { url: "https://example.com" },
      { providerId: "provider-2" }
    );
  });

  it("falls back through legacy fetch tool names", async () => {
    const first = { success: false, error: "unknown" };
    const second = { success: false, error: "unknown" };
    const third = { success: true, content: [{ type: "text", text: "payload" }] };

    callTool.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third);

    const response = await mcpFetch(client, { url: "https://fallback.example" });

    expect(response).toBe(third);
    expect(callTool).toHaveBeenCalledTimes(3);
    expect(callTool.mock.calls.map((call) => call[0])).toEqual(["search.fetch", "fetch_content", "fetch"]);
  });

  it("returns last result when all attempts fail", async () => {
    const last = { success: false, error: "no fetch" };

    callTool
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ success: false, error: "no fetch_content" })
      .mockResolvedValueOnce(last);

    const response = await mcpFetch(client, { url: "https://nope.example" });

    expect(response).toBe(last);
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it("forwards boundary values without coercion", async () => {
    const longUrl = `https://example.com/${"a".repeat(5000)}`;
    const hugeDataUrl = `data:application/octet-stream;base64,${"b".repeat(100000)}`;

    const scenarios = [
      { args: undefined, expected: { url: undefined } },
      { args: { url: null }, expected: { url: null } },
      { args: { url: "" }, expected: { url: "" } },
      { args: { url: "   " }, expected: { url: "   " } },
      { args: { url: [] }, expected: { url: [] } },
      { args: { url: {} }, expected: { url: {} } },
      { args: { url: longUrl }, expected: { url: longUrl } },
      { args: { url: hugeDataUrl }, expected: { url: hugeDataUrl } },
    ];

    callTool.mockResolvedValue({ success: true });

    for (const scenario of scenarios) {
      await mcpFetch(client, scenario.args);
    }

    expect(callTool).toHaveBeenCalledTimes(scenarios.length);
    scenarios.forEach((scenario, index) => {
      const [name, args] = callTool.mock.calls[index];
      expect(name).toBe("search.fetch");
      expect(args).toEqual(scenario.expected);
    });
  });

  it("handles concurrent calls independently", async () => {
    callTool.mockImplementation(async (name, args) => {
      await Promise.resolve();
      return { success: true, echo: args.url };
    });

    const [r1, r2] = await Promise.all([
      mcpFetch(client, { url: "https://a.example" }, { providerId: "p1" }),
      mcpFetch(client, { url: "https://b.example" }, { providerId: "p2" }),
    ]);

    expect(r1.echo).toBe("https://a.example");
    expect(r2.echo).toBe("https://b.example");
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenCalledWith(
      "search.fetch",
      { url: "https://a.example" },
      { providerId: "p1" }
    );
    expect(callTool).toHaveBeenCalledWith(
      "search.fetch",
      { url: "https://b.example" },
      { providerId: "p2" }
    );
  });

  it("handles rapid consecutive calls", async () => {
    callTool.mockResolvedValue({ success: true });

    await mcpFetch(client, { url: "https://one.example" });
    await mcpFetch(client, { url: "https://two.example" });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map((call) => call[0])).toEqual(["search.fetch", "search.fetch"]);
    expect(callTool.mock.calls.map((call) => call[1].url)).toEqual(["https://one.example", "https://two.example"]);
  });
});
