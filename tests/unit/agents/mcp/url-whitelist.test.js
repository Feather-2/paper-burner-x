import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DEFAULT_SAFE_PARAMS,
  createWhitelist,
  isAllowedParam,
  filterUrlParams,
} from "../../../../js/agents/mcp/url-whitelist.js";

const ORIGINAL_URL = globalThis.URL;

vi.mock("node:url", () => {
  return {
    URL: class MockURL {
      constructor() {
        throw new TypeError("Mocked URL constructor");
      }
    },
  };
});

beforeEach(() => {
  globalThis.URL = ORIGINAL_URL;
  vi.restoreAllMocks();
});

describe("DEFAULT_SAFE_PARAMS", () => {
  it("is frozen and contains representative safe params", () => {
    expect(Object.isFrozen(DEFAULT_SAFE_PARAMS)).toBe(true);
    expect(DEFAULT_SAFE_PARAMS).toContain("q");
    expect(DEFAULT_SAFE_PARAMS).toContain("page");
    expect(DEFAULT_SAFE_PARAMS).toContain("sort");
    expect(DEFAULT_SAFE_PARAMS).toContain("format");
  });

  it("contains only lowercase strings", () => {
    for (const entry of DEFAULT_SAFE_PARAMS) {
      expect(typeof entry).toBe("string");
      expect(entry).toBe(entry.toLowerCase());
    }
  });
});

describe("createWhitelist", () => {
  it("creates a Set with defaults and lowercases extras", () => {
    const whitelist = createWhitelist(["Token", "Extra"]);

    expect(whitelist.has("q")).toBe(true);
    expect(whitelist.has("token")).toBe(true);
    expect(whitelist.has("extra")).toBe(true);
    expect(whitelist.has("Token")).toBe(false);
  });

  it("ignores empty strings and non-string extras", () => {
    const whitelist = createWhitelist([
      "",
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      null,
      undefined,
      {},
      [],
    ]);

    expect(whitelist.has("")).toBe(false);
    expect(whitelist.has("0")).toBe(false);
    expect(whitelist.has("-1")).toBe(false);
    expect(whitelist.has(String(Number.MAX_SAFE_INTEGER))).toBe(false);
  });

  it("ignores non-array additionalParams (type boundary)", () => {
    const asString = createWhitelist("token");
    const asObject = createWhitelist({ 0: "token", length: 1 });

    expect(asString.has("token")).toBe(false);
    expect(asObject.has("token")).toBe(false);
    expect(asString.has("q")).toBe(true);
    expect(asObject.has("q")).toBe(true);
  });

  it("handles empty arrays and deeply nested entries without crashing", () => {
    const nested = ["safe", ["deep", ["deeper"]], { a: { b: { c: "x" } } }];
    const whitelist = createWhitelist(nested);
    const empty = createWhitelist([]);

    expect(whitelist.has("safe")).toBe(true);
    expect(whitelist.has("deep")).toBe(false);
    expect(empty.has("q")).toBe(true);
    expect(empty.has("page")).toBe(true);
  });

  it("handles large lists and concurrent calls", async () => {
    const largeList = Array.from({ length: 5000 }, (_, i) => `param_${i}`);
    const [first, second] = await Promise.all([
      Promise.resolve(createWhitelist(largeList)),
      Promise.resolve(createWhitelist(["solo"])),
    ]);

    expect(first.has("param_0")).toBe(true);
    expect(first.has("param_4999")).toBe(true);
    expect(second.has("param_0")).toBe(false);
    expect(second.has("solo")).toBe(true);

    first.add("mutated");
    expect(second.has("mutated")).toBe(false);
  });
});

describe("isAllowedParam", () => {
  it("returns false for empty inputs and whitespace", () => {
    const cases = [null, undefined, "", "   ", 0];
    for (const value of cases) {
      expect(isAllowedParam(value)).toBe(false);
    }
  });

  it("returns false for numeric boundaries and numeric strings", () => {
    const cases = [-1, Number.MAX_SAFE_INTEGER, "123"];
    for (const value of cases) {
      expect(isAllowedParam(value)).toBe(false);
    }
  });

  it("matches the default whitelist case-insensitively", () => {
    expect(isAllowedParam("Q")).toBe(true);
    expect(isAllowedParam("page")).toBe(true);
  });

  it("uses a provided Set whitelist and falls back when invalid", () => {
    const custom = new Set(["custom"]);

    expect(isAllowedParam("custom", custom)).toBe(true);
    expect(isAllowedParam("q", custom)).toBe(false);
    expect(isAllowedParam("q", {})).toBe(true);
  });
});

describe("filterUrlParams", () => {
  it("returns empty string for null/undefined/empty string inputs", () => {
    const cases = [null, undefined, ""];
    for (const value of cases) {
      const result = filterUrlParams(value);
      expect(result.url).toBe("");
      expect(result.strippedParams).toEqual([]);
    }
  });

  it("passes through non-string inputs and numeric boundaries", () => {
    const emptyArray = [];
    const emptyObject = {};

    const arrayResult = filterUrlParams(emptyArray);
    expect(arrayResult.url).toBe(emptyArray);
    expect(arrayResult.strippedParams).toEqual([]);

    const objectResult = filterUrlParams(emptyObject);
    expect(objectResult.url).toBe(emptyObject);
    expect(objectResult.strippedParams).toEqual([]);

    expect(filterUrlParams(0)).toEqual({ url: "", strippedParams: [] });
    expect(filterUrlParams(-1)).toEqual({ url: -1, strippedParams: [] });
    expect(filterUrlParams(Number.MAX_SAFE_INTEGER)).toEqual({
      url: Number.MAX_SAFE_INTEGER,
      strippedParams: [],
    });
  });

  it("returns the original string for malformed URLs", () => {
    const input = "not a url";
    const result = filterUrlParams(input);

    expect(result.url).toBe(input);
    expect(result.strippedParams).toEqual([]);
  });

  it("filters disallowed params and strips hash/credentials", () => {
    const result = filterUrlParams(
      "https://user:pass@example.com/search?q=hello&evil=1&page=2#token",
    );

    expect(result.url).toBe("https://example.com/search?q=hello&page=2");
    expect(result.strippedParams).toEqual(["evil", "#hash", "@credentials"]);
  });

  it("allows additional params and rejects non-array additionalParams", () => {
    const allowed = filterUrlParams(
      "https://example.com/?token=1&q=ok&evil=1",
      { additionalParams: ["TOKEN"] },
    );

    expect(allowed.url).toBe("https://example.com/?token=1&q=ok");
    expect(allowed.strippedParams).toEqual(["evil"]);

    const rejected = filterUrlParams("https://example.com/?token=1", {
      additionalParams: { token: true },
    });

    expect(rejected.url).toBe("https://example.com/");
    expect(rejected.strippedParams).toEqual(["token"]);
  });

  it("returns original URL when the URL constructor throws", async () => {
    const { URL: MockURL } = await import("node:url");
    globalThis.URL = MockURL;

    const result = filterUrlParams("https://example.com/?q=1&evil=1");
    expect(result.url).toBe("https://example.com/?q=1&evil=1");
    expect(result.strippedParams).toEqual([]);
  });

  it("handles long strings without losing allowed params", () => {
    const longValue = "a".repeat(10000);
    const result = filterUrlParams(
      `https://example.com/?q=${longValue}&evil=${longValue}`,
    );

    expect(result.url).toContain(`q=${longValue}`);
    expect(result.url).not.toContain("evil=");
    expect(result.strippedParams).toEqual(["evil"]);
  });

  it("handles simultaneous calls", async () => {
    const inputs = [
      "https://a.example/?q=1&x=1",
      "https://b.example/?page=2&y=1",
      "https://c.example/?search=ok&z=1",
    ];

    const results = await Promise.all(
      inputs.map((url) => Promise.resolve(filterUrlParams(url))),
    );

    expect(results[0].url).toBe("https://a.example/?q=1");
    expect(results[1].url).toBe("https://b.example/?page=2");
    expect(results[2].url).toBe("https://c.example/?search=ok");
  });

  it("handles rapid consecutive calls without leaking state", () => {
    const baseUrl = "https://example.com/?token=1&q=ok";

    for (let i = 0; i < 6; i += 1) {
      const allowToken = i % 2 === 0;
      const result = filterUrlParams(baseUrl, {
        additionalParams: allowToken ? ["token"] : [],
      });

      if (allowToken) {
        expect(result.url).toContain("token=1");
        expect(result.url).toContain("q=ok");
      } else {
        expect(result.url).toBe("https://example.com/?q=ok");
      }
    }
  });
});
