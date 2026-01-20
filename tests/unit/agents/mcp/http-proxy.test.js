import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    safeInt: vi.fn(actual.safeInt),
    checkCancelled: vi.fn(actual.checkCancelled),
  };
});

vi.mock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
  inspectUrlForProxy: vi.fn(() => ({ ok: true })),
  redactUrlForLog: vi.fn((url) => String(url)),
}));

const modulePath = "../../../../js/agents/mcp/http-proxy.js";

describe("normalizeCorsProxies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for non-array inputs (empty/type boundaries)", async () => {
    const { normalizeCorsProxies } = await import(modulePath);

    const cases = [
      null,
      undefined,
      "",
      "   ",
      {},
      { length: 1 },
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
    ];

    for (const value of cases) {
      expect(normalizeCorsProxies(value)).toBeNull();
    }
  });

  it("returns empty array for empty array input", async () => {
    const { normalizeCorsProxies } = await import(modulePath);
    expect(normalizeCorsProxies([])).toEqual([]);
  });

  it("normalizes, trims, dedupes, and preserves empty string once", async () => {
    const { normalizeCorsProxies } = await import(modulePath);

    const input = [
      "",
      " https://a.example/ ",
      "https://a.example/",
      null,
      undefined,
      "",
      "   ",
      "https://b.example/",
    ];

    expect(normalizeCorsProxies(input)).toEqual(["", "https://a.example/", "https://b.example/"]);
  });

  it("stringifies numeric values and dedupes string equivalents", async () => {
    const { normalizeCorsProxies } = await import(modulePath);

    const input = [0, "0", " 0 ", -1, "-1", Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)];
    expect(normalizeCorsProxies(input)).toEqual(["0", "-1", String(Number.MAX_SAFE_INTEGER)]);
  });

  it("handles long strings, large payloads, and deep nesting", async () => {
    const { normalizeCorsProxies } = await import(modulePath);

    const longString = "x".repeat(10_000);
    const hugeString = "y".repeat(1_000_000);
    const deepNested = [[[[["deep"]]]]];

    const result = normalizeCorsProxies([longString, hugeString, deepNested]);
    expect(result[0]).toBe(longString);
    expect(result[1]).toBe(hugeString);
    expect(result[2]).toBe("deep");
  });

  it("is stable under concurrent and rapid successive calls", async () => {
    const { normalizeCorsProxies } = await import(modulePath);

    const inputs = [
      ["a", "a", ""],
      ["", ""],
      ["   ", "b"],
      [0, "0"],
    ];

    const results = await Promise.all(inputs.map((input) => Promise.resolve().then(() => normalizeCorsProxies(input))));

    expect(results).toEqual([["a", ""], [""], ["b"], ["0"]]);

    for (let i = 0; i < 50; i += 1) {
      expect(normalizeCorsProxies(["x", "x", " "])).toEqual(["x"]);
    }
  });
});

describe("DEFAULT_CORS_PROXIES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes only the direct-request option", async () => {
    const { DEFAULT_CORS_PROXIES } = await import(modulePath);
    expect(DEFAULT_CORS_PROXIES).toEqual([""]);
  });
});

describe("validateFetchUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws for empty, null, undefined, or whitespace-only URLs", async () => {
    const { validateFetchUrl } = await import(modulePath);

    const cases = [null, undefined, "", "   "];

    for (const value of cases) {
      expect(() => validateFetchUrl(value)).toThrow(/url is required/i);
    }
  });

  it("throws for invalid URL format", async () => {
    const { validateFetchUrl } = await import(modulePath);

    const cases = ["not-a-url", "://example.com", "example.com"];

    for (const value of cases) {
      expect(() => validateFetchUrl(value)).toThrow(/Invalid URL/i);
    }
  });

  it("throws for unsupported protocols", async () => {
    const { validateFetchUrl } = await import(modulePath);

    const cases = [
      "ftp://example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
    ];

    for (const value of cases) {
      expect(() => validateFetchUrl(value)).toThrow(/Unsupported URL protocol/i);
    }
  });

  it("accepts valid HTTP and HTTPS URLs", async () => {
    const { validateFetchUrl } = await import(modulePath);

    expect(validateFetchUrl("http://example.com")).toBe("http://example.com/");
    expect(validateFetchUrl("https://example.com/path?query=1")).toBe("https://example.com/path?query=1");
    expect(validateFetchUrl("https://example.com:8080")).toBe("https://example.com:8080/");
  });

  it("blocks private network hostnames by default", async () => {
    const { validateFetchUrl } = await import(modulePath);

    const privateHosts = [
      "http://localhost",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.0.0.1",
      "http://192.168.1.1",
      "http://172.16.0.1",
      "http://[::1]",
      "http://example.localhost",
      "http://foo.local",
    ];

    for (const url of privateHosts) {
      expect(() => validateFetchUrl(url)).toThrow(/Blocked URL hostname \(private network\)/i);
    }
  });

  it("allows private network hostnames when allowPrivateNetwork is true", async () => {
    const { validateFetchUrl } = await import(modulePath);

    expect(validateFetchUrl("http://localhost", { allowPrivateNetwork: true })).toBe("http://localhost/");
    expect(validateFetchUrl("http://127.0.0.1:3000", { allowPrivateNetwork: true })).toBe("http://127.0.0.1:3000/");
    expect(validateFetchUrl("http://192.168.1.1/path", { allowPrivateNetwork: true })).toBe(
      "http://192.168.1.1/path"
    );
  });

  it("allows public IP addresses", async () => {
    const { validateFetchUrl } = await import(modulePath);

    expect(validateFetchUrl("http://8.8.8.8")).toBe("http://8.8.8.8/");
    expect(validateFetchUrl("https://1.1.1.1")).toBe("https://1.1.1.1/");
  });

  it("normalizes URLs (adds trailing slash)", async () => {
    const { validateFetchUrl } = await import(modulePath);

    expect(validateFetchUrl("https://example.com")).toBe("https://example.com/");
    expect(validateFetchUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("CorsProxyHttpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when fetchImpl is not a function", async () => {
    const { CorsProxyHttpClient } = await import(modulePath);

    expect(() => new CorsProxyHttpClient({})).toThrow(/fetchImpl must be a function/i);
    expect(() => new CorsProxyHttpClient({ fetchImpl: null })).toThrow(/fetchImpl must be a function/i);
    expect(() => new CorsProxyHttpClient({ fetchImpl: "fetch" })).toThrow(/fetchImpl must be a function/i);
  });

  it("throws for non-finite cooldown values", async () => {
    const { CorsProxyHttpClient } = await import(modulePath);

    expect(() => new CorsProxyHttpClient({ fetchImpl: vi.fn(), proxyCooldownMs: "bad" })).toThrow(
      /must be a finite number/i
    );
    expect(() => new CorsProxyHttpClient({ fetchImpl: vi.fn(), proxyMaxCooldownMs: NaN })).toThrow(
      /must be a finite number/i
    );
    expect(() => new CorsProxyHttpClient({ fetchImpl: vi.fn(), proxyCooldownMs: Infinity })).toThrow(
      /must be a finite number/i
    );
  });

  it("initializes with default values", async () => {
    const { CorsProxyHttpClient } = await import(modulePath);
    const fetchImpl = vi.fn();
    const client = new CorsProxyHttpClient({ fetchImpl });

    expect(client._fetch).toBe(fetchImpl);
    expect(client.proxyEndpoint).toBeFalsy();
    expect(client.corsProxies).toEqual([""]);
    expect(client.allowSensitiveUrlProxying).toBe(false);
    expect(client.useUrlWhitelist).toBe(true);
    expect(client.proxyCooldownMs).toBe(60000);
    expect(client.proxyMaxCooldownMs).toBe(900000);
  });

  it("accepts custom configuration", async () => {
    const { CorsProxyHttpClient } = await import(modulePath);
    const fetchImpl = vi.fn();
    const client = new CorsProxyHttpClient({
      fetchImpl,
      proxyEndpoint: "https://proxy.example.com/",
      corsProxies: ["https://cors1.example.com/", "https://cors2.example.com/"],
      proxyCooldownMs: 30000,
      proxyMaxCooldownMs: 120000,
      allowSensitiveUrlProxying: true,
      useUrlWhitelist: false,
    });

    expect(client.proxyEndpoint).toBe("https://proxy.example.com/");
    expect(client.corsProxies).toEqual(["https://cors1.example.com/", "https://cors2.example.com/"]);
    expect(client.allowSensitiveUrlProxying).toBe(true);
    expect(client.useUrlWhitelist).toBe(false);
    expect(client.proxyCooldownMs).toBe(30000);
    expect(client.proxyMaxCooldownMs).toBe(120000);
  });

  it("falls back to DEFAULT_CORS_PROXIES for empty corsProxies", async () => {
    const { CorsProxyHttpClient, DEFAULT_CORS_PROXIES } = await import(modulePath);
    const client = new CorsProxyHttpClient({ fetchImpl: vi.fn(), corsProxies: [] });

    expect(client.corsProxies).toEqual(DEFAULT_CORS_PROXIES);
  });

  describe("_buildCorsProxyCandidates", () => {
    it("includes proxyEndpoint at the beginning if set", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({
        fetchImpl: vi.fn(),
        proxyEndpoint: "https://proxy.example.com/",
        corsProxies: ["https://cors.example.com/", ""],
      });

      const candidates = client._buildCorsProxyCandidates({ tryDirect: true });
      expect(candidates[0]).toBe("https://proxy.example.com/");
    });

    it("filters out empty string when tryDirect is false", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({
        fetchImpl: vi.fn(),
        corsProxies: ["https://cors.example.com/", ""],
      });

      const candidates = client._buildCorsProxyCandidates({ tryDirect: false });
      expect(candidates).toEqual(["https://cors.example.com/"]);
    });

    it("prioritizes last good proxy", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({
        fetchImpl: vi.fn(),
        corsProxies: ["https://a.example.com/", "https://b.example.com/", ""],
      });

      client._lastGoodProxy = "https://b.example.com/";
      const candidates = client._buildCorsProxyCandidates({ tryDirect: true });
      expect(candidates[0]).toBe("https://b.example.com/");
    });
  });

  describe("_filterCorsProxyCooldown", () => {
    it("filters out proxies in cooldown period", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({ fetchImpl: vi.fn() });

      const now = Date.now();
      vi.spyOn(client, "_nowMs").mockReturnValue(now);
      client._corsProxyUnhealthyUntilMs.set("https://bad.example.com/", now + 10000);

      const candidates = ["https://bad.example.com/", "https://good.example.com/"];
      const filtered = client._filterCorsProxyCooldown(candidates);

      expect(filtered).toEqual(["https://good.example.com/"]);
    });

    it("returns all candidates if all are in cooldown", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({ fetchImpl: vi.fn() });

      const now = Date.now();
      vi.spyOn(client, "_nowMs").mockReturnValue(now);
      client._corsProxyUnhealthyUntilMs.set("https://a.example.com/", now + 10000);
      client._corsProxyUnhealthyUntilMs.set("https://b.example.com/", now + 10000);

      const candidates = ["https://a.example.com/", "https://b.example.com/"];
      const filtered = client._filterCorsProxyCooldown(candidates);

      expect(filtered).toEqual(candidates);
    });
  });

  describe("_markCorsProxyFailure / _markCorsProxySuccess", () => {
    it("tracks failure count and applies exponential backoff cooldown", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({
        fetchImpl: vi.fn(),
        proxyCooldownMs: 1000,
        proxyMaxCooldownMs: 8000,
      });

      const now = 10000;
      vi.spyOn(client, "_nowMs").mockReturnValue(now);

      client._markCorsProxyFailure("https://proxy.example.com/");
      expect(client._corsProxyFailureCount.get("https://proxy.example.com/")).toBe(1);
      expect(client._corsProxyUnhealthyUntilMs.get("https://proxy.example.com/")).toBe(now + 1000);

      client._markCorsProxyFailure("https://proxy.example.com/");
      expect(client._corsProxyFailureCount.get("https://proxy.example.com/")).toBe(2);
      expect(client._corsProxyUnhealthyUntilMs.get("https://proxy.example.com/")).toBe(now + 2000);

      client._markCorsProxyFailure("https://proxy.example.com/");
      expect(client._corsProxyFailureCount.get("https://proxy.example.com/")).toBe(3);
      expect(client._corsProxyUnhealthyUntilMs.get("https://proxy.example.com/")).toBe(now + 4000);

      client._markCorsProxyFailure("https://proxy.example.com/");
      expect(client._corsProxyFailureCount.get("https://proxy.example.com/")).toBe(4);
      expect(client._corsProxyUnhealthyUntilMs.get("https://proxy.example.com/")).toBe(now + 8000);
    });

    it("clears failure state on success", async () => {
      const { CorsProxyHttpClient } = await import(modulePath);
      const client = new CorsProxyHttpClient({ fetchImpl: vi.fn() });

      client._corsProxyFailureCount.set("https://proxy.example.com/", 5);
      client._corsProxyUnhealthyUntilMs.set("https://proxy.example.com/", Date.now() + 100000);

      client._markCorsProxySuccess("https://proxy.example.com/");

      expect(client._lastGoodProxy).toBe("https://proxy.example.com/");
      expect(client._corsProxyFailureCount.has("https://proxy.example.com/")).toBe(false);
      expect(client._corsProxyUnhealthyUntilMs.has("https://proxy.example.com/")).toBe(false);
    });
  });

  describe("fetchWithCorsFallback", () => {
    it("returns result on successful direct fetch", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue("Hello World! ".repeat(20)),
      };
      const fetchImpl = vi.fn().mockResolvedValue(mockResponse);
      const client = new CorsProxyHttpClient({ fetchImpl, corsProxies: [""] });

      const result = await client.fetchWithCorsFallback("https://example.com/page");

      expect(result.text).toContain("Hello World!");
      expect(result.proxy).toBe("direct");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("throws AggregateError when all proxies fail", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      const fetchImpl = vi.fn().mockRejectedValue(new Error("Network error"));
      const client = new CorsProxyHttpClient({
        fetchImpl,
        corsProxies: ["https://proxy.example.com/", ""],
      });

      await expect(client.fetchWithCorsFallback("https://example.com/page")).rejects.toBeInstanceOf(AggregateError);
    });

    it("skips proxy for sensitive URLs when allowSensitiveUrlProxying is false", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/",
          sensitiveQueryKeys: ["token"],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue("Success! ".repeat(20)),
      };
      const fetchImpl = vi.fn().mockResolvedValue(mockResponse);
      const client = new CorsProxyHttpClient({
        fetchImpl,
        corsProxies: ["https://proxy.example.com/", ""],
        allowSensitiveUrlProxying: false,
      });

      const result = await client.fetchWithCorsFallback("https://example.com/?token=secret");

      expect(result.proxy).toBe("direct");
    });

    it("falls back to next proxy on HTTP error", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      let callCount = 0;
      const fetchImpl = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500, text: vi.fn().mockResolvedValue("Error") });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue("Success from direct! ".repeat(10)),
        });
      });

      const client = new CorsProxyHttpClient({
        fetchImpl,
        corsProxies: ["https://proxy.example.com/", ""],
      });

      const result = await client.fetchWithCorsFallback("https://example.com/page");

      expect(result.proxy).toBe("direct");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("detects proxy error pages and fails over", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      let callCount = 0;
      const fetchImpl = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: vi.fn().mockResolvedValue("Access denied - request blocked"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue("Real content here! ".repeat(10)),
        });
      });

      const client = new CorsProxyHttpClient({
        fetchImpl,
        corsProxies: ["https://proxy.example.com/", ""],
      });

      const result = await client.fetchWithCorsFallback("https://example.com/page");

      expect(result.proxy).toBe("direct");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("respects external abort signal", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
      const client = new CorsProxyHttpClient({ fetchImpl, corsProxies: [""] });

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.fetchWithCorsFallback("https://example.com/page", { signal: controller.signal })
      ).rejects.toThrow();
    });

    it("handles response with short content as proxy error", async () => {
      vi.resetModules();
      vi.doMock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
        inspectUrlForProxy: vi.fn(() => ({
          safeUrl: "https://example.com/page",
          sensitiveQueryKeys: [],
          strippedParams: [],
        })),
        redactUrlForLog: vi.fn((url) => String(url)),
      }));

      const { CorsProxyHttpClient } = await import(modulePath);

      let callCount = 0;
      const fetchImpl = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: vi.fn().mockResolvedValue("short"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue("This is longer content that should pass validation! ".repeat(5)),
        });
      });

      const client = new CorsProxyHttpClient({
        fetchImpl,
        corsProxies: ["https://proxy.example.com/", ""],
      });

      const result = await client.fetchWithCorsFallback("https://example.com/page");

      expect(result.proxy).toBe("direct");
    });
  });
});
