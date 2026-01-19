/**
 * @file tests/processing/reference-detector.test.js
 * @description js/processing/reference-detector.esm.js 单元测试
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let api = null;
let consoleLogSpy = null;

describe("js/processing/reference-detector.esm.js", () => {
  beforeAll(async () => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    api = await import("../../js/processing/reference-detector.esm.js");
  });

  afterAll(() => {
    consoleLogSpy?.mockRestore();
  });

  it("exports a default API and named helpers", () => {
    expect(api).not.toBeNull();
    expect(api).toBeTypeOf("object");
    expect(api.default).not.toBeNull();
    expect(api.default).toBeTypeOf("object");
    expect(api.default).toBe(globalThis.ReferenceDetector);

    expect(typeof api.detectReferenceSection).toBe("function");
    expect(typeof api.parseReferenceEntries).toBe("function");
    expect(typeof api.isReferenceSectionTitle).toBe("function");
    expect(typeof api.isLikelyReferenceEntry).toBe("function");
    expect(typeof api.analyzeReferenceFormats).toBe("function");
    expect(typeof api.getRecommendedFormat).toBe("function");
  });

  it("detects reference section titles in multiple languages", () => {
    expect(api.isReferenceSectionTitle("## References")).toBe(true);
    expect(api.isReferenceSectionTitle("Bibliography")).toBe(true);
    expect(api.isReferenceSectionTitle("参考文献")).toBe(true);
    expect(api.isReferenceSectionTitle("## 参考文献")).toBe(true);

    expect(api.isReferenceSectionTitle("## Reference")).toBe(true);
    expect(api.isReferenceSectionTitle("## References:")).toBe(false);
    expect(api.isReferenceSectionTitle("## Related Work")).toBe(false);
  });

  it("classifies likely reference entries", () => {
    expect(
      api.isLikelyReferenceEntry("[1] Smith, J. Title. Journal of Tests, 2020."),
    ).toBe(true);

    expect(
      api.isLikelyReferenceEntry("Smith, J. (2020). Title. Journal of Tests."),
    ).toBe(true);

    expect(api.isLikelyReferenceEntry("References")).toBe(false);
    expect(
      api.isLikelyReferenceEntry(
        "This is not a reference entry in 2020, just some narrative text.",
      ),
    ).toBe(false);
  });

  it("parses numbered reference entries and joins wrapped lines", () => {
    const content = [
      "[1] Smith, J. A long title that spans",
      "multiple lines. Journal of Tests, 2020.",
      "",
      "[2] Doe, J. Another title. Journal of Tests, 2019.",
    ].join("\n");

    const entries = api.parseReferenceEntries(content);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      index: 0,
      rawText:
        "[1] Smith, J. A long title that spans multiple lines. Journal of Tests, 2020.",
      lineStart: 0,
      lineEnd: 1,
    });
    expect(entries[1]).toEqual({
      index: 1,
      rawText: "[2] Doe, J. Another title. Journal of Tests, 2019.",
      lineStart: 3,
      lineEnd: 3,
    });
  });

  it("detects a reference section when an explicit title exists", () => {
    const markdown = [
      "# Paper Title",
      "Intro text",
      "",
      "## References",
      "[1] Smith, J. Title. Journal of Tests, 2020.",
      "[2] Doe, J. Another title. Journal of Tests, 2019.",
      "## Appendix",
      "Extra notes",
    ].join("\n");

    const result = api.detectReferenceSection(markdown);

    expect(result).not.toBeNull();
    expect(result).toBeTypeOf("object");
    expect(result.title).toBe("## References");
    expect(result.startLine).toBe(3);
    expect(result.endLine).toBe(5);
    expect(result.totalCount).toBe(2);
    expect(result.entries.map((entry) => entry.rawText)).toEqual([
      "[1] Smith, J. Title. Journal of Tests, 2020.",
      "[2] Doe, J. Another title. Journal of Tests, 2019.",
    ]);
  });

  it("auto-detects a reference section from consecutive reference entries", () => {
    const markdown = [
      "# Paper Title",
      "Some content here",
      "",
      "[1] Smith, J. Title. Journal of Tests, 2020.",
      "[2] Doe, J. Another title. Journal of Tests, 2019.",
      "[3] Wang, W. Another title. Journal of Tests, 2018.",
      "[4] Li, L. Another title. Journal of Tests, 2017.",
      "[5] Chen, C. Another title. Journal of Tests, 2016.",
    ].join("\n");

    const result = api.detectReferenceSection(markdown);

    expect(result).not.toBeNull();
    expect(result).toBeTypeOf("object");
    expect(result.title).toBe("References (auto-detected)");
    expect(result.startLine).toBe(3);
    expect(result.endLine).toBe(7);
    expect(result.totalCount).toBe(5);
  });

  it("returns null for invalid detectReferenceSection input", () => {
    expect(api.detectReferenceSection()).toBe(null);
    expect(api.detectReferenceSection(123)).toBe(null);
  });

  it("analyzes reference formats and recommends the dominant one", () => {
    const entries = [
      { rawText: '[1] Smith, J. "Title," Journal of Tests, 2020.' },
      { rawText: "Doe, J. (2020). Title. Journal of Tests." },
      { rawText: "Miller, A. (2019). Another title. Journal of Tests." },
    ];

    const formats = api.analyzeReferenceFormats(entries);

    expect(formats.numbered).toBe(1);
    expect(formats.ieee).toBe(1);
    expect(formats.apa).toBe(2);
    expect(api.getRecommendedFormat(entries)).toBe("apa");
  });
});
