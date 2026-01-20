import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/mcp/smart-content-extractor.js", () => ({
  extractSmartContent: vi.fn(),
}));

vi.mock("../../../../js/agents/shared/index.js", () => ({
  createSafeRegex: vi.fn((pattern, flags) => new RegExp(pattern, flags)),
  toNonEmptyString: vi.fn((value) => (typeof value === "string" && value.trim() ? value : "")),
}));

vi.mock("../../../../js/agents/mcp/content-sanitizer.js", () => ({
  sanitizeExtractedText: vi.fn((value) => value),
  stripUrls: vi.fn((value) => value),
}));

import { extractTextFromHtml } from "../../../../js/agents/mcp/content-extractor.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractTextFromHtml", () => {
  it("returns empty string for nullish/invalid/empty inputs", () => {
    const cases = [
      null,
      undefined,
      "",
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      "   \t\n",
    ];

    for (const input of cases) {
      expect(extractTextFromHtml(input)).toBe("");
    }
  });

  it("handles plain text and strips tags while normalizing whitespace", () => {
    const html = "<div>Hello <span>world</span></div><div title=\"a > b\">again</div>";
    expect(extractTextFromHtml(html)).toBe("Hello world again");
  });

  it("skips non-text tags, comments, and directives", () => {
    const html =
      "<!DOCTYPE html><!-- c --><style>.a{}</style><script>evil()</script><noscript>no</noscript><div>Keep</div>";
    expect(extractTextFromHtml(html)).toBe("Keep");
  });

  it("decodes entities and preserves unknown entities", () => {
    const html = "Tom &amp; Jerry &#39; &#x41; &unknown; &nbsp;OK";
    expect(extractTextFromHtml(html)).toBe("Tom & Jerry ' A &unknown; OK");
  });

  it("removes URLs from extracted text", () => {
    const html = "Visit https://example.com/path?q=1 now and http://foo.bar/test later";
    expect(extractTextFromHtml(html)).toBe("Visit now and later");
  });

  it("tolerates malformed tags without throwing", () => {
    expect(() => extractTextFromHtml("Hello <div")).not.toThrow();
    expect(extractTextFromHtml("Hello <div")).toBe("Hello");
  });

  it("handles deep nesting safely", () => {
    const html = `${"<div>".repeat(200)}Deep${"</div>".repeat(200)}`;
    expect(extractTextFromHtml(html)).toBe("Deep");
  });

  it("caps output length for long strings", () => {
    const longText = "a".repeat(250_000);
    const result = extractTextFromHtml(longText);
    expect(result.length).toBe(200_000);
    expect(result).toBe("a".repeat(200_000));
  });

  it("truncates oversized input and ignores trailing content", () => {
    const unit = "<script></script>";
    const filler = unit.repeat(Math.ceil(2_000_000 / unit.length) + 10);
    const html = `${filler}<p>after</p>`;
    const result = extractTextFromHtml(html);
    expect(result).toBe("");
    expect(result.includes("after")).toBe(false);
  });

  it("handles type boundaries and coercions consistently", () => {
    expect(extractTextFromHtml("123")).toBe("123");
    expect(extractTextFromHtml(new String("wrapped"))).toBe("");
    expect(extractTextFromHtml({ 0: "<b>x</b>", length: 1 })).toBe("");
  });

  it("produces stable results under concurrent and rapid calls", async () => {
    const inputs = [
      "<p>A</p>",
      "<div>B&nbsp;C</div>",
      "Plain",
      "<script>skip</script><span>D</span>",
    ];

    const expected = ["A", "B C", "Plain", "D"];

    const concurrent = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => extractTextFromHtml(input))),
    );
    expect(concurrent).toEqual(expected);

    const rapid = [];
    for (let i = 0; i < 50; i++) {
      rapid.push(extractTextFromHtml(inputs[i % inputs.length]));
    }

    const mismatches = rapid.filter((value, index) => value !== expected[index % expected.length]);
    expect(mismatches).toHaveLength(0);
  });
});
