import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

vi.mock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
  inspectUrlForProxy: vi.fn(() => ({ ok: true })),
  redactUrlForLog: vi.fn((url) => String(url)),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function importShared() {
  return await import("../../../../js/agents/shared/index.js");
}

async function importSut() {
  return await import("../../../../js/agents/mcp/http-proxy.js");
}

describe("normalizeCorsProxies", () => {
  it("returns null for non-array inputs (null/undefined/string/object/array-like)", async () => {
    const { normalizeCorsProxies } = await importSut();

    expect(normalizeCorsProxies(null)).toBeNull();
    expect(normalizeCorsProxies(undefined)).toBeNull();
    expect(normalizeCorsProxies("")).toBeNull();
    expect(normalizeCorsProxies("not-an-array")).toBeNull();
    expect(normalizeCorsProxies({})).toBeNull();
    expect(normalizeCorsProxies({ length: 0 })).toBeNull();
    expect(normalizeCorsProxies({ 0: "x", length: 1 })).toBeNull();
  });

  it("returns an empty array for an empty array input", async () => {
    const { normalizeCorsProxies } = await importSut();
    const out = normalizeCorsProxies([]);
    expect(out).toEqual([]);
    expect(Array.isArray(out)).toBe(true);
  });

  it('dedupes normalized entries, preserves first-seen order, and keeps a single ""', async () => {
    const shared = await importShared();
    const { toNonEmptyString } = shared;

    toNonEmptyString.mockImplementation((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return null;
    });

    const { normalizeCorsProxies } = await importSut();

    const input = [
      "",
      "",
      "  a  ",
      "a",
      "b",
      "b",
      "   ",
      null,
      undefined,
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { foo: "bar" },
      ["c"],
    ];

    const out = normalizeCorsProxies(input);
    expect(out).toEqual(["", "a", "b", "0", "-1", String(Number.MAX_SAFE_INTEGER)]);
    expect(toNonEmptyString.mock.calls.some(([arg]) => arg === "")).toBe(false);
  });

  it('keeps "" even if toNonEmptyString would reject strings, and never calls toNonEmptyString for raw ""', async () => {
    const shared = await importShared();
    const { toNonEmptyString } = shared;

    toNonEmptyString.mockImplementation(() => null);

    const { normalizeCorsProxies } = await importSut();

    const out = normalizeCorsProxies(["", "", "x"]);
    expect(out).toEqual([""]);
    expect(toNonEmptyString.mock.calls.some(([arg]) => arg === "")).toBe(false);
    expect(toNonEmptyString).toHaveBeenCalledWith("x");
  });

  it("skips entries when toNonEmptyString returns falsy (e.g., empty string)", async () => {
    const shared = await importShared();
    const { toNonEmptyString } = shared;

    toNonEmptyString.mockImplementation((value) => {
      if (value === "keep") return "keep";
      if (value === "drop") return "";
      return null;
    });

    const { normalizeCorsProxies } = await importSut();

    const out = normalizeCorsProxies(["keep", "drop", "drop", ""]);
    expect(out).toEqual(["keep", ""]);
  });

  it("is deterministic under concurrent calls and does not mutate the input", async () => {
    const shared = await importShared();
    const { toNonEmptyString } = shared;

    toNonEmptyString.mockImplementation((value) => {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    });

    const { normalizeCorsProxies } = await importSut();

    const input = ["a", "a", "", "b", "", "b"];
    const original = input.slice();

    const runs = 25;
    const results = await Promise.all(
      Array.from({ length: runs }, () => Promise.resolve().then(() => normalizeCorsProxies(input))),
    );

    for (const r of results) expect(r).toEqual(["a", "", "b"]);
    expect(results[0]).not.toBe(results[1]);
    expect(input).toEqual(original);
    expect(toNonEmptyString).toHaveBeenCalledTimes(runs * 4);
  });

  it("handles very long strings, large arrays, and deeply nested values without throwing", async () => {
    const shared = await importShared();
    const { toNonEmptyString } = shared;

    toNonEmptyString.mockImplementation((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return null;
    });

    const { normalizeCorsProxies } = await importSut();

    const long = "x".repeat(100_000);
    expect(normalizeCorsProxies(["", long, long, "y"])).toEqual(["", long, "y"]);

    const big = Array.from({ length: 5000 }, () => "a");
    expect(normalizeCorsProxies(big)).toEqual(["a"]);

    const deep = [[], [{}], [[[[{ k: "v" }]]]], " ok ", "   ", "", null, undefined];
    expect(() => normalizeCorsProxies(deep)).not.toThrow();
    expect(normalizeCorsProxies(deep)).toEqual(["ok", ""]);
  });
});

describe("DEFAULT_CORS_PROXIES", () => {
  it('is a non-empty, unique list of strings and contains exactly one "" (direct fetch option)', async () => {
    const { DEFAULT_CORS_PROXIES } = await importSut();

    expect(Array.isArray(DEFAULT_CORS_PROXIES)).toBe(true);
    expect(DEFAULT_CORS_PROXIES.length).toBeGreaterThan(0);
    expect(DEFAULT_CORS_PROXIES.every((v) => typeof v === "string")).toBe(true);

    const uniqueCount = new Set(DEFAULT_CORS_PROXIES).size;
    expect(uniqueCount).toBe(DEFAULT_CORS_PROXIES.length);

    const emptyCount = DEFAULT_CORS_PROXIES.filter((v) => v === "").length;
    expect(emptyCount).toBe(1);
  });

  it("round-trips through normalizeCorsProxies without changing meaning", async () => {
    const { DEFAULT_CORS_PROXIES, normalizeCorsProxies } = await importSut();
    expect(normalizeCorsProxies(DEFAULT_CORS_PROXIES)).toEqual(DEFAULT_CORS_PROXIES);
  });

  it("does not include known public CORS proxy endpoints", async () => {
    const { DEFAULT_CORS_PROXIES } = await importSut();
    const hasKnownPublicProxy = DEFAULT_CORS_PROXIES.some((p) => /cors-anywhere|allorigins/i.test(p));
    expect(hasKnownPublicProxy).toBe(false);
  });
});

describe("validateFetchUrl", () => {
  it("blocks private hosts by default and allows controlled private-host overrides", async () => {
    const { validateFetchUrl } = await importSut();

    expect(() => validateFetchUrl("http://127.0.0.1:8080/a")).toThrow(/private network/i);
    expect(() =>
      validateFetchUrl("http://127.0.0.1:8080/a", { allowedPrivateHosts: ["127.0.0.1"] })
    ).not.toThrow();
    expect(() =>
      validateFetchUrl("http://localhost:3000/a", { allowedPrivateHosts: new Set(["localhost"]) })
    ).not.toThrow();
    expect(() => validateFetchUrl("http://[::1]/a", { allowPrivateNetwork: true })).not.toThrow();
  });
});

describe("readTextWithLimit", () => {
  it("enforces byte semantics for fallback response.text() paths", async () => {
    const { readTextWithLimit } = await importSut();
    const response = {
      text: vi.fn(async () => "你好"),
      headers: { get: vi.fn(() => null) },
      body: null,
    };

    await expect(readTextWithLimit(response, { maxBytes: 4 })).rejects.toMatchObject({
      name: "BodyTooLargeError",
      observedBytes: 6,
    });
    await expect(readTextWithLimit(response, { maxBytes: 6 })).resolves.toBe("你好");
  });
});
