import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/mcp/http-proxy.js", () => {
  // Use function constructor for vi.fn() to work with `new`
  const CorsProxyHttpClient = vi.fn(function (options) {
    this.options = options;
    this.fetchWithCorsFallback = vi.fn();
  });
  return {
    CorsProxyHttpClient,
    DEFAULT_CORS_PROXIES: [""],
    normalizeCorsProxies: vi.fn((value) => (Array.isArray(value) ? value : null)),
    validateFetchUrl: vi.fn((url) => String(url)),
  };
});

vi.mock("../../../../js/agents/mcp/content-extractor.js", () => ({
  extractPageContentFromHtml: vi.fn(),
  searchDuckDuckGoHtml: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    makeSecureTimestampedId: vi.fn(() => "search"),
  };
});

import { LocalMcpProvider, createLocalMcpProvider } from "../../../../js/agents/mcp/local-mcp-provider.js";
import { McpToolResult } from "../../../../js/agents/mcp/mcp-client.js";
import * as httpProxy from "../../../../js/agents/mcp/http-proxy.js";
import * as contentExtractor from "../../../../js/agents/mcp/content-extractor.js";
import * as shared from "../../../../js/agents/shared/index.js";

const makeJsonResponse = (json, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return json;
  },
});

const makeAbortedSignal = (reason = "Aborted") => {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
};

beforeEach(() => {
  vi.resetAllMocks();
  httpProxy.CorsProxyHttpClient.mockImplementation(function (options) {
    this.options = options;
    this.fetchWithCorsFallback = vi.fn();
  });
  httpProxy.normalizeCorsProxies.mockImplementation((value) => (Array.isArray(value) ? value : null));
  httpProxy.validateFetchUrl.mockImplementation((url) => String(url));
  contentExtractor.searchDuckDuckGoHtml.mockResolvedValue({ results: [], pages: 0 });
  contentExtractor.extractPageContentFromHtml.mockReturnValue({
    title: "",
    description: "",
    extractedText: "",
    truncatedText: "",
  });
  shared.makeSecureTimestampedId.mockReturnValue("search");
});

describe("LocalMcpProvider", () => {
  it("normalizes options and clamps limits", () => {
    const provider = new LocalMcpProvider({
      workerEndpoint: "   ",
      proxyEndpoint: "",
      corsProxies: {},
      defaultTimeoutMs: "nope",
      searchTimeoutMs: "20001",
      maxResults: "4",
      maxSearchPages: Number.MAX_SAFE_INTEGER,
      allowPrivateNetwork: true,
      allowSensitiveUrlProxying: 1,
      useUrlWhitelist: 0,
      fetchImpl: vi.fn(),
    });

    expect(provider.workerEndpoint).toBeUndefined();
    expect(provider.proxyEndpoint).toBeUndefined();
    expect(provider.corsProxies).toEqual(httpProxy.DEFAULT_CORS_PROXIES);
    expect(provider.defaultTimeoutMs).toBe(10000);
    expect(provider.searchTimeoutMs).toBe(20001);
    expect(provider.maxResults).toBe(4);
    expect(provider.maxSearchPages).toBe(5);
    expect(provider.allowPrivateNetwork).toBe(true);
    expect(provider.allowSensitiveUrlProxying).toBe(false);
    expect(provider.useUrlWhitelist).toBe(false);

    const emptyProxyProvider = new LocalMcpProvider({ corsProxies: [], fetchImpl: vi.fn() });
    expect(emptyProxyProvider.corsProxies).toEqual(httpProxy.DEFAULT_CORS_PROXIES);
  });

  it("throws when fetchImpl is invalid", () => {
    expect(() => new LocalMcpProvider({ fetchImpl: "nope" })).toThrow(/fetchImpl must be a function/);
  });

  it("throws when no fetch implementation is available", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = undefined;
    try {
      expect(() => new LocalMcpProvider()).toThrow(/requires global fetch or fetchImpl/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("listTools returns a copy", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const first = await provider.listTools();
    expect(first.map((tool) => tool.name)).toEqual(["search.query", "search.fetch"]);
    first.push({ name: "extra" });
    const second = await provider.listTools();
    expect(second.map((tool) => tool.name)).toEqual(["search.query", "search.fetch"]);
  });

  it("canonicalizes tool names and ignores blanks", () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    expect(provider._canonicalizeToolName("search.query")).toBe("search.query");
    expect(provider._canonicalizeToolName("search.fetch")).toBe("search.fetch");
    expect(provider._canonicalizeToolName("search")).toBe("search.query");
    expect(provider._canonicalizeToolName("fetch")).toBe("search.fetch");
    expect(provider._canonicalizeToolName("fetch_content")).toBe("search.fetch");
    expect(provider._canonicalizeToolName("")).toBeNull();
    expect(provider._canonicalizeToolName("   ")).toBeNull();
    expect(provider._canonicalizeToolName(null)).toBeNull();
    expect(provider._canonicalizeToolName("unknown")).toBeNull();
  });

  it("adds deprecated tool warnings once per alias", () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const base = new McpToolResult({ success: true, content: [{ type: "text", text: "ok" }] });

    const first = provider._withDeprecatedToolName(base, { usedName: "search", canonicalName: "search.query" });
    expect(first.content.length).toBe(2);
    expect(first.content.some((c) => c.text?.includes("deprecated"))).toBe(true);

    const second = provider._withDeprecatedToolName(base, { usedName: "search", canonicalName: "search.query" });
    expect(second.content.length).toBe(1);

    const same = provider._withDeprecatedToolName(base, { usedName: "search.query", canonicalName: "search.query" });
    expect(same).toBe(base);
  });

  it("routes tool calls and handles unknown tools", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const searchResult = new McpToolResult({ success: true, content: [{ type: "text", text: "ok" }] });
    const fetchResult = new McpToolResult({ success: true, content: [{ type: "text", text: "fetch" }] });

    const searchSpy = vi.spyOn(provider, "_search").mockResolvedValue(searchResult);
    const fetchSpy = vi.spyOn(provider, "_fetchContent").mockResolvedValue(fetchResult);

    const searchOut = await provider.callTool("search.query", { query: "hello" }, { signal: undefined });
    expect(searchOut.success).toBe(true);
    expect(searchSpy).toHaveBeenCalled();

    const fetchOut = await provider.callTool("search.fetch", { url: "https://example.com" });
    expect(fetchOut.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();

    const unknown = await provider.callTool("unknown_tool", {});
    expect(unknown.success).toBe(false);
    expect(unknown.error).toMatch(/Unknown tool/);
  });

  it("rejects cancelled calls before dispatch", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const aborted = makeAbortedSignal("Stop");
    await expect(provider.callTool("search.query", { query: "q" }, { signal: aborted })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("delegates to CorsProxyHttpClient for fetchWithCorsFallback", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    provider._http.fetchWithCorsFallback.mockResolvedValue({ text: "ok", proxy: "p1" });

    const out = await provider._fetchWithCorsFallback("https://example.com", {
      timeoutMs: 123,
      tryDirect: false,
      maxBodyBytes: 64,
    });

    expect(out.proxy).toBe("p1");
    expect(provider._http.fetchWithCorsFallback).toHaveBeenCalledWith("https://example.com", {
      timeoutMs: 123,
      tryDirect: false,
      signal: undefined,
      maxBodyBytes: 64,
    });
  });

  it("returns errors for blank queries and whitespace", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const cases = [undefined, null, "", "   "];
    for (const query of cases) {
      const out = await provider._search({ query });
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/query is required/);
    }
  });

  it("uses worker search when available and skips HTML parsing", async () => {
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl: vi.fn() });
    const workerResult = new McpToolResult({ success: true, content: [{ type: "text", text: "worker" }] });
    vi.spyOn(provider, "_searchViaWorker").mockResolvedValue(workerResult);

    const out = await provider._search({ query: "hi" });
    expect(out).toBe(workerResult);
    expect(contentExtractor.searchDuckDuckGoHtml).not.toHaveBeenCalled();
  });

  it("falls back to DuckDuckGo HTML and clamps limits", async () => {
    const provider = new LocalMcpProvider({ maxResults: 2, workerEndpoint: "https://worker", fetchImpl: vi.fn() });
    const workerSpy = vi.spyOn(provider, "_searchViaWorker").mockResolvedValue(
      new McpToolResult({ success: false, isError: true, content: [] })
    );
    contentExtractor.searchDuckDuckGoHtml.mockResolvedValue({
      results: [
        { index: 1, title: "T1", url: "https://ex/1", snippet: "s1" },
        { index: 2, title: "T2", url: "https://ex/2", snippet: "s2" },
      ],
      pages: 1,
    });

    const cases = [
      { limit: 0, expected: 1 },
      { limit: -1, expected: 1 },
      { limit: "5", expected: 2 },
      { limit: {}, expected: 2 },
    ];

    for (const { limit, expected } of cases) {
      contentExtractor.searchDuckDuckGoHtml.mockClear();
      const out = await provider._search({ query: "q", limit, domain: "ex.com", time_range: "week" });
      expect(out.success).toBe(true);
      expect(workerSpy).toHaveBeenCalled();
      const [, options] = contentExtractor.searchDuckDuckGoHtml.mock.calls[0];
      expect(options.limit).toBe(expected);
      expect(options.domain).toBe("ex.com");
      expect(options.timeRange).toBe("week");
    }
  });

  it("returns error when DuckDuckGo HTML search throws", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    contentExtractor.searchDuckDuckGoHtml.mockRejectedValue(new Error("boom"));

    const out = await provider._search({ query: "q" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/boom/);
  });

  it("supports concurrent searches and long queries", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    contentExtractor.searchDuckDuckGoHtml.mockImplementation(async (_fetchHtml, options) => ({
      results: [{ index: 1, title: options.query, url: `https://ex/${options.query}`, snippet: "" }],
      pages: 1,
    }));

    const longQuery = "x".repeat(10000);
    const [a, b] = await Promise.all([provider._search({ query: "alpha" }), provider._search({ query: longQuery })]);

    const jsonA = a.content.find((c) => c.type === "json")?.data;
    const jsonB = b.content.find((c) => c.type === "json")?.data;
    expect(jsonA.results[0].title).toBe("alpha");
    expect(jsonB.results[0].title).toBe(longQuery);
  });

  it("handles rapid consecutive fetches", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    provider._http.fetchWithCorsFallback.mockResolvedValue({ text: "<html></html>", proxy: "" });
    contentExtractor.extractPageContentFromHtml.mockReturnValue({
      title: "t",
      description: "d",
      extractedText: "x",
      truncatedText: "x",
    });

    await provider._fetchContent({ url: "https://example.com/1" });
    await provider._fetchContent({ url: "https://example.com/2" });

    expect(provider._http.fetchWithCorsFallback).toHaveBeenCalledTimes(2);
  });

  it("searchViaWorker formats results and handles missing fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeJsonResponse({ success: true, results: [{ url: "https://ex", title: "", snippet: null }] })
    );
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl });

    const out = await provider._searchViaWorker({ query: "q", limit: 1 });
    expect(out.success).toBe(true);
    const json = out.content.find((c) => c.type === "json")?.data;
    expect(json.via).toBe("worker");
    expect(json.results[0].title).toBe("(No title)");
    expect(json.results[0].snippet).toBe("");
  });

  it("searchViaWorker returns errors for HTTP and worker failures", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ success: true }, { status: 500 }))
      .mockResolvedValueOnce(makeJsonResponse({ success: false, error: "down" }, { status: 200 }));
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl });

    const httpError = await provider._searchViaWorker({ query: "q", limit: 1 });
    expect(httpError.success).toBe(false);
    expect(httpError.error).toMatch(/HTTP 500/);

    const workerError = await provider._searchViaWorker({ query: "q", limit: 1 });
    expect(workerError.success).toBe(false);
    expect(workerError.error).toMatch(/down/);
  });

  it("returns errors for blank URLs and invalid validation", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const badUrls = [undefined, null, "", "   "];
    for (const url of badUrls) {
      const out = await provider._fetchContent({ url });
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/url is required/);
    }

    httpProxy.validateFetchUrl.mockImplementationOnce(() => {
      throw new Error("bad url");
    });
    const invalid = await provider._fetchContent({ url: "https://invalid" });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toMatch(/bad url/);
  });

  it("passes allowPrivateNetwork to validateFetchUrl", async () => {
    const provider = new LocalMcpProvider({ allowPrivateNetwork: true, fetchImpl: vi.fn() });
    provider._http.fetchWithCorsFallback.mockResolvedValue({ text: "<html></html>", proxy: "" });
    contentExtractor.extractPageContentFromHtml.mockReturnValue({
      title: "t",
      description: "d",
      extractedText: "x",
      truncatedText: "x",
    });

    await provider._fetchContent({ url: "https://example.com" });
    expect(httpProxy.validateFetchUrl).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ allowPrivateNetwork: true }),
    );
  });

  it("uses worker fetch when available and skips proxy fallback", async () => {
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl: vi.fn() });
    const workerResult = new McpToolResult({ success: true, content: [{ type: "text", text: "worker" }] });
    vi.spyOn(provider, "_fetchContentViaWorker").mockResolvedValue(workerResult);

    const out = await provider._fetchContent({ url: "https://example.com" });
    expect(out).toBe(workerResult);
    expect(provider._http.fetchWithCorsFallback).not.toHaveBeenCalled();
  });

  it("fetches and extracts content with metadata for large HTML", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const html = "x".repeat(60000);
    provider._http.fetchWithCorsFallback.mockResolvedValue({ text: html, proxy: "proxy-1" });
    contentExtractor.extractPageContentFromHtml.mockReturnValue({
      title: "Title",
      description: "Desc",
      extractedText: "Extracted",
      truncatedText: "Extracted",
      markdown: "# md",
      extraction: { nested: { depth: 2 } },
    });

    const out = await provider._fetchContent({ url: "https://example.com" });
    expect(out.success).toBe(true);
    const json = out.content.find((c) => c.type === "json")?.data;
    expect(json.metadata.url).toBe("https://example.com");
    expect(json.metadata.title).toBe("Title");
    expect(json.metadata.description).toBe("Desc");
    expect(json.metadata.contentLength).toBe(html.length);
    expect(json.metadata.extractedLength).toBe("Extracted".length);
    expect(json.metadata.proxy).toBe("proxy-1");
    expect(json.metadata.extraction).toEqual({ nested: { depth: 2 } });
    expect(json.markdown).toBe("# md");
  });

  it("returns error when proxy fetch fails", async () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    provider._http.fetchWithCorsFallback.mockRejectedValue(new Error("network"));

    const out = await provider._fetchContent({ url: "https://example.com" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/network/);
  });

  it("fetchContentViaWorker truncates long text and adds via metadata", async () => {
    const longText = "a".repeat(60000);
    const fetchImpl = vi.fn().mockResolvedValue(
      makeJsonResponse({
        success: true,
        extractedText: longText,
        title: "T",
        metadata: { url: "https://ex" },
      })
    );
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl });

    const out = await provider._fetchContentViaWorker({ url: "https://example.com" });
    expect(out.success).toBe(true);
    const text = out.content.find((c) => c.type === "text")?.text || "";
    expect(text.endsWith("...(truncated)")).toBe(true);
    const json = out.content.find((c) => c.type === "json")?.data;
    expect(json.metadata.via).toBe("worker");
    expect(json.title).toBe("T");
  });

  it("fetchContentViaWorker returns errors for HTTP and worker failures", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse({ success: true }, { status: 500 }))
      .mockResolvedValueOnce(makeJsonResponse({ success: false, error: "down" }, { status: 200 }));
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl });

    const httpError = await provider._fetchContentViaWorker({ url: "https://example.com" });
    expect(httpError.success).toBe(false);
    expect(httpError.error).toMatch(/HTTP 500/);

    const workerError = await provider._fetchContentViaWorker({ url: "https://example.com" });
    expect(workerError.success).toBe(false);
    expect(workerError.error).toMatch(/down/);
  });

  it("fetchContentViaWorker handles fetch exceptions", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const provider = new LocalMcpProvider({ workerEndpoint: "https://worker", fetchImpl });

    const out = await provider._fetchContentViaWorker({ url: "https://example.com" });
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/boom/);
  });

  it("bindMemoryStore updates discovery recording", () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn() });
    const store = { syncDiscovery: vi.fn() };
    provider.bindMemoryStore(store);
    provider._recordSearchDiscoveries("hello world", [
      { title: "T", url: "https://ex", snippet: "s" },
    ]);
    expect(store.syncDiscovery).toHaveBeenCalled();
  });

  it("recordSearchDiscoveries creates ids and keywords", () => {
    const provider = new LocalMcpProvider({ fetchImpl: vi.fn(), memoryStore: { syncDiscovery: vi.fn() } });
    shared.makeSecureTimestampedId.mockClear();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12345);
    const results = [
      { title: "T1", url: "u1", snippet: "s1" },
      { title: "T2", url: "u2", snippet: "s2" },
    ];

    provider._recordSearchDiscoveries("a bb ccc", results);
    const store = provider._memoryStore;
    expect(store.syncDiscovery).toHaveBeenCalledTimes(2);
    const [id, payload] = store.syncDiscovery.mock.calls[0];
    expect(id).toBe("search_12345_0");
    expect(payload.keywords).toEqual(["bb", "ccc"]);
    expect(payload.title).toBe("T1");

    nowSpy.mockRestore();
  });
});

describe("createLocalMcpProvider", () => {
  it("creates a LocalMcpProvider with options", () => {
    const provider = createLocalMcpProvider({ id: "custom", fetchImpl: vi.fn() });
    expect(provider).toBeInstanceOf(LocalMcpProvider);
    expect(provider.id).toBe("custom");
  });
});
