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
