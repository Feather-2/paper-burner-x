import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toNonEmptyString: vi.fn(),
  filterUrlParams: vi.fn(),
  auditUrl: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  toNonEmptyString: mocks.toNonEmptyString,
}));

vi.mock("../../../../js/agents/mcp/url-whitelist.js", () => ({
  filterUrlParams: mocks.filterUrlParams,
  auditUrl: mocks.auditUrl,
}));

import {
  inspectUrlForProxy,
  isSensitiveQueryParamKey,
  redactUrlForLog,
  sanitizeExtractedText,
} from "../../../../js/agents/mcp/content-sanitizer.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toNonEmptyString.mockImplementation((value) => {
    if (value === null || value === undefined) return "";
    const str = typeof value === "string" ? value : String(value);
    const trimmed = str.trim();
    return trimmed ? trimmed : "";
  });
  mocks.filterUrlParams.mockImplementation((url) => ({ url, strippedParams: [] }));
  mocks.auditUrl.mockImplementation(() => ({ issues: [] }));
});

describe("isSensitiveQueryParamKey", () => {
  it("detects common sensitive keys and patterns", () => {
    const sensitiveKeys = [
      "token",
      "Access_Token",
      "oauth_token",
      "mytokenvalue",
      "api_key",
      "service-key",
      "client_secret",
      "private_key",
      "supersecret",
      "signature",
      "sig",
      "password",
      "authorization",
      "auth_header",
      "session_id",
      "jsessionid",
      "csrf_token",
      "xsrf",
      "nonceValue",
      "invite_code",
      "flow-state",
      "x-amz-credential",
      "x-amz-signature",
      "x-amz-security-token",
    ];

    for (const key of sensitiveKeys) {
      expect(isSensitiveQueryParamKey(key)).toBe(true);
    }
  });

  it("returns false for non-sensitive keys and edge inputs", () => {
    const deepNested = { a: { b: { c: [{ d: "e" }] } } };
    const cases = [
      null,
      undefined,
      "",
      "   ",
      [],
      {},
      deepNested,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "123",
      "name",
      "page",
      "file",
      "keynote",
    ];

    for (const value of cases) {
      expect(isSensitiveQueryParamKey(value)).toBe(false);
    }
  });

  it("is stable under concurrent calls", async () => {
    const inputs = ["token", "session_id", "name", "", null, "api_key"];
    const results = await Promise.all(
      inputs.map((value) => Promise.resolve().then(() => isSensitiveQueryParamKey(value)))
    );
    expect(results).toEqual([true, true, false, false, false, true]);
  });
});

describe("redactUrlForLog", () => {
  it("redacts credentials, sensitive query params, and hash fragments", () => {
    const input = "https://user:pass@example.com/path?token=abc&page=1#section";
    const result = redactUrlForLog(input);

    expect(result).toBe("https://REDACTED:REDACTED@example.com/path?token=REDACTED&page=1#REDACTED");
    expect(mocks.toNonEmptyString).toHaveBeenCalledWith(input);
  });

  it("returns empty string for empty or whitespace inputs", () => {
    const values = [null, undefined, "", "   ", []];
    for (const value of values) {
      expect(redactUrlForLog(value)).toBe("");
    }
  });

  it("falls back for invalid URLs and redacts known params and hash", () => {
    const input = "not a url?token=abc#frag";
    const result = redactUrlForLog(input);

    expect(result).toBe("not a url?token=REDACTED#REDACTED");
  });

  it("handles numeric boundaries and type edges", () => {
    expect(redactUrlForLog(0)).toBe("0");
    expect(redactUrlForLog(-1)).toBe("-1");
    expect(redactUrlForLog(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(redactUrlForLog({})).toBe("[object Object]");
  });

  it("supports rapid consecutive calls", async () => {
    const urls = [
      "https://a.com?token=1",
      "https://b.com?apikey=2",
      "https://c.com?foo=bar#hash",
    ];
    const results = await Promise.all(
      urls.map((url) => Promise.resolve().then(() => redactUrlForLog(url)))
    );

    expect(results).toEqual([
      "https://a.com/?token=REDACTED",
      "https://b.com/?apikey=REDACTED",
      "https://c.com/?foo=bar#REDACTED",
    ]);
  });
});

describe("inspectUrlForProxy", () => {
  it("returns empty inspection for empty inputs", () => {
    const values = [null, undefined, "", "   ", []];
    for (const value of values) {
      expect(inspectUrlForProxy(value)).toEqual({
        safeUrl: "",
        hadCredentials: false,
        hadHash: false,
        sensitiveQueryKeys: [],
        strippedParams: [],
      });
    }
  });

  it("blacklist mode strips credentials/hash and collects unique sensitive keys", () => {
    const url = "https://user:pass@example.com/path?token=abc&session_id=1&token=def#frag";
    const result = inspectUrlForProxy(url);

    expect(result).toEqual({
      safeUrl: "https://example.com/path?token=abc&session_id=1&token=def",
      hadCredentials: true,
      hadHash: true,
      sensitiveQueryKeys: ["token", "session_id"],
      strippedParams: [],
    });
  });

  it("blacklist mode returns the original URL when parsing fails", () => {
    const input = "not a url";
    const result = inspectUrlForProxy(input);

    expect(result).toEqual({
      safeUrl: "not a url",
      hadCredentials: false,
      hadHash: false,
      sensitiveQueryKeys: [],
      strippedParams: [],
    });
  });

  it("whitelist mode uses filtered URL and audit results", () => {
    const input = "https://example.com?Token=1&state=2&x-amz-credential=3#hash";
    const audit = { issues: ["URL contains credentials", "URL contains hash fragment"] };
    mocks.filterUrlParams.mockReturnValueOnce({
      url: "https://example.com?state=2",
      strippedParams: ["Token", "x-amz-credential"],
    });
    mocks.auditUrl.mockReturnValueOnce(audit);

    const result = inspectUrlForProxy(input, { useWhitelist: true });

    expect(mocks.filterUrlParams).toHaveBeenCalledWith(input, { logStripped: false });
    expect(mocks.auditUrl).toHaveBeenCalledWith(input);
    expect(result.safeUrl).toBe("https://example.com?state=2");
    expect(result.hadCredentials).toBe(true);
    expect(result.hadHash).toBe(true);
    expect(result.sensitiveQueryKeys.sort()).toEqual(["state", "token", "x-amz-credential"]);
    expect(result.strippedParams).toEqual(["Token", "x-amz-credential"]);
    expect(result.audit).toBe(audit);
  });

  it("whitelist mode tolerates invalid URLs when collecting sensitive keys", () => {
    mocks.toNonEmptyString.mockReturnValueOnce("not a url");
    mocks.filterUrlParams.mockReturnValueOnce({ url: "safe", strippedParams: [] });
    mocks.auditUrl.mockReturnValueOnce({ issues: [] });

    const result = inspectUrlForProxy("not a url", { useWhitelist: true });

    expect(result).toEqual({
      safeUrl: "safe",
      hadCredentials: false,
      hadHash: false,
      sensitiveQueryKeys: [],
      strippedParams: [],
      audit: { issues: [] },
    });
  });

  it("supports concurrent calls", async () => {
    const urls = [
      "https://user:pass@example.com?token=1#h",
      "https://example.com?session=1",
    ];
    const results = await Promise.all(
      urls.map((value) => Promise.resolve().then(() => inspectUrlForProxy(value)))
    );

    expect(results[0].hadCredentials).toBe(true);
    expect(results[0].hadHash).toBe(true);
    expect(results[1].sensitiveQueryKeys).toEqual(["session"]);
  });
});

describe("sanitizeExtractedText", () => {
  it("removes URLs and normalizes whitespace", () => {
    const input = "Line1 http://example.com/path?x=1\nLine2 https://example.org";
    const result = sanitizeExtractedText(input);

    expect(result).toBe("Line1 Line2");
  });

  it("returns empty string for empty inputs and empty arrays", () => {
    const values = [null, undefined, "", "   ", []];
    for (const value of values) {
      expect(sanitizeExtractedText(value)).toBe("");
    }
  });

  it("handles numeric, string, and object type boundaries", () => {
    const deepNested = { a: { b: { c: [1, 2, { d: "e" }] } } };
    expect(sanitizeExtractedText(0)).toBe("0");
    expect(sanitizeExtractedText(-1)).toBe("-1");
    expect(sanitizeExtractedText(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(sanitizeExtractedText("123")).toBe("123");
    expect(sanitizeExtractedText({ 0: "a", length: 1 })).toBe("[object Object]");
    expect(sanitizeExtractedText(deepNested)).toBe("[object Object]");
  });

  it("handles large content and rapid concurrent calls", async () => {
    const largeText = `${"A".repeat(120000)} http://example.com ${"B".repeat(120000)}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => sanitizeExtractedText(largeText)))
    );

    for (const output of results) {
      expect(output.includes("http://example.com")).toBe(false);
      expect(output.startsWith("A")).toBe(true);
      expect(output.endsWith("B")).toBe(true);
    }
  });
});
