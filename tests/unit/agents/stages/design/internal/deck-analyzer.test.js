import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedTools = vi.hoisted(() => ({
  parseSections: vi.fn(),
  extractElements: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  parseSections: mockedTools.parseSections,
  extractElements: mockedTools.extractElements,
}));

import {
  ANALYZER_CONFIG,
  collectAllDsl,
  extractDesignTokensSummary,
  analyzeStyleConsistency,
} from "../../../../../../js/agents/stages/design/internal/deck-analyzer.js";

beforeEach(() => {
  mockedTools.parseSections.mockReset();
  mockedTools.extractElements.mockReset();
});

describe("ANALYZER_CONFIG", () => {
  it("exposes expected soft limits and locate candidates", () => {
    expect(ANALYZER_CONFIG).toMatchObject({
      softLimits: {
        maxColors: 8,
        recommendedColors: { min: 5, max: 8 },
        maxFonts: 3,
        recommendedFonts: { min: 2, max: 3 },
      },
      locateCandidates: 5,
    });
  });
});

describe("collectAllDsl", () => {
  it("maps sections to slide DSL with extracted elements", () => {
    const sections = [
      '<section data-layout="hero"><div data-el="el-1"></div></section>',
      '<section data-layout="split"><div data-el="el-2"></div></section>',
    ];

    mockedTools.parseSections.mockReturnValue(sections);
    mockedTools.extractElements.mockImplementation((html) => {
      if (html.includes("hero")) {
        return [{ elementId: "el-1", tag: "div", attrs: {} }];
      }
      return [{ elementId: "el-2", tag: "div", attrs: {} }];
    });

    const result = collectAllDsl("<deck />");

    expect(mockedTools.parseSections).toHaveBeenCalledWith("<deck />");
    expect(mockedTools.extractElements).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        slideIndex: 0,
        html: sections[0],
        elements: [{ elementId: "el-1", tag: "div", attrs: {} }],
      },
      {
        slideIndex: 1,
        html: sections[1],
        elements: [{ elementId: "el-2", tag: "div", attrs: {} }],
      },
    ]);
  });

  it("returns an empty array when no sections are found", () => {
    mockedTools.parseSections.mockReturnValue([]);

    const result = collectAllDsl("");

    expect(result).toEqual([]);
    expect(mockedTools.extractElements).not.toHaveBeenCalled();
  });

  it("forwards null and undefined inputs to parseSections", () => {
    mockedTools.parseSections.mockReturnValue([]);

    const inputs = [null, undefined];
    const results = inputs.map((input) => collectAllDsl(input));

    expect(results).toEqual([[], []]);
    expect(mockedTools.parseSections).toHaveBeenNthCalledWith(1, null);
    expect(mockedTools.parseSections).toHaveBeenNthCalledWith(2, undefined);
  });

  it("forwards numeric boundary values and whitespace strings", () => {
    mockedTools.parseSections.mockReturnValue([]);

    const inputs = [0, -1, Number.MAX_SAFE_INTEGER, "0", "   "];

    inputs.forEach((input, index) => {
      const result = collectAllDsl(input);
      expect(result).toEqual([]);
      expect(mockedTools.parseSections).toHaveBeenNthCalledWith(index + 1, input);
    });
  });

  it("propagates parseSections errors", () => {
    mockedTools.parseSections.mockImplementation(() => {
      throw new Error("parse failed");
    });

    expect(() => collectAllDsl("<deck />")).toThrow("parse failed");
  });

  it("supports concurrent calls", async () => {
    mockedTools.parseSections.mockImplementation((input) => [String(input)]);
    mockedTools.extractElements.mockReturnValue([]);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => collectAllDsl("first")),
      Promise.resolve().then(() => collectAllDsl("second")),
    ]);

    expect(first[0].html).toBe("first");
    expect(second[0].html).toBe("second");
    expect(mockedTools.parseSections).toHaveBeenCalledTimes(2);
  });

  it("handles rapid consecutive calls", () => {
    mockedTools.parseSections.mockReturnValue(["<section></section>"]);
    mockedTools.extractElements.mockReturnValue([]);

    const first = collectAllDsl("one");
    const second = collectAllDsl("two");
    const third = collectAllDsl("three");

    expect(first).toEqual([{ slideIndex: 0, html: "<section></section>", elements: [] }]);
    expect(second).toEqual([{ slideIndex: 0, html: "<section></section>", elements: [] }]);
    expect(third).toEqual([{ slideIndex: 0, html: "<section></section>", elements: [] }]);
    expect(mockedTools.parseSections).toHaveBeenCalledTimes(3);
  });

  it("handles large input strings", () => {
    const largeDsl = "a".repeat(200000);

    mockedTools.parseSections.mockReturnValue([]);

    const result = collectAllDsl(largeDsl);

    expect(result).toEqual([]);
    expect(mockedTools.parseSections).toHaveBeenCalledWith(largeDsl);
  });
});

describe("extractDesignTokensSummary", () => {
  it("returns null for falsy inputs", () => {
    const inputs = [null, undefined, "", 0];

    inputs.forEach((input) => {
      expect(extractDesignTokensSummary(input)).toBeNull();
    });
  });

  it("returns undefined values for empty objects or arrays", () => {
    const emptyObjectSummary = extractDesignTokensSummary({});
    const emptyArraySummary = extractDesignTokensSummary([]);

    const expected = {
      theme: undefined,
      colorScheme: undefined,
      fontFamily: undefined,
      accentColor: undefined,
    };

    expect(emptyObjectSummary).toEqual(expected);
    expect(emptyArraySummary).toEqual(expected);
  });

  it("prefers explicit theme and designTokens values", () => {
    const designSystem = {
      theme: "system",
      designTokens: {
        theme: "token",
        colorScheme: "cool",
        fontFamily: "Inter",
        accentColor: "#ff0000",
      },
    };

    const summary = extractDesignTokensSummary(designSystem);

    expect(summary).toEqual({
      theme: "system",
      colorScheme: "cool",
      fontFamily: "Inter",
      accentColor: "#ff0000",
    });
  });

  it("reads tokens from the tokens property", () => {
    const designSystem = {
      tokens: {
        colorScheme: "light",
        colors: { primary: "#111111", accent: "#222222" },
        typography: { bodyFont: "Roboto" },
      },
    };

    const summary = extractDesignTokensSummary(designSystem);

    expect(summary).toEqual({
      theme: undefined,
      colorScheme: "light",
      fontFamily: "Roboto",
      accentColor: "#222222",
    });
  });

  it("uses the design system object as tokens when needed", () => {
    const designSystem = {
      theme: "dark",
      colors: { primary: "#123456", accent: "#654321" },
      typography: { bodyFont: "Inter" },
    };

    const summary = extractDesignTokensSummary(designSystem);

    expect(summary).toEqual({
      theme: "dark",
      colorScheme: "#123456",
      fontFamily: "Inter",
      accentColor: "#654321",
    });
  });

  it("handles whitespace and numeric-string inputs without throwing", () => {
    const whitespaceSummary = extractDesignTokensSummary("   ");
    const numericStringSummary = extractDesignTokensSummary("0");

    expect(whitespaceSummary).toEqual({
      theme: undefined,
      colorScheme: undefined,
      fontFamily: undefined,
      accentColor: undefined,
    });
    expect(numericStringSummary).toEqual({
      theme: undefined,
      colorScheme: undefined,
      fontFamily: undefined,
      accentColor: undefined,
    });
  });

  it("handles deep nested tokens", () => {
    const designSystem = {
      tokens: {
        colors: {
          primary: "#000000",
          accent: "#ffffff",
          meta: { level1: { level2: { level3: "deep" } } },
        },
        typography: {
          bodyFont: "Inter",
          meta: { level1: { level2: { level3: "deep" } } },
        },
      },
    };

    const summary = extractDesignTokensSummary(designSystem);

    expect(summary).toEqual({
      theme: undefined,
      colorScheme: "#000000",
      fontFamily: "Inter",
      accentColor: "#ffffff",
    });
  });

  it("supports concurrent calls", async () => {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => extractDesignTokensSummary({ theme: "first" })),
      Promise.resolve().then(() =>
        extractDesignTokensSummary({ tokens: { typography: { bodyFont: "second" } } })
      ),
    ]);

    expect(first).toEqual({
      theme: "first",
      colorScheme: undefined,
      fontFamily: undefined,
      accentColor: undefined,
    });
    expect(second).toEqual({
      theme: undefined,
      colorScheme: undefined,
      fontFamily: "second",
      accentColor: undefined,
    });
  });
});

describe("analyzeStyleConsistency", () => {
  it("computes stats and issues when limits are exceeded", () => {
    const slides = [
      {
        slideIndex: 0,
        html: '<section data-layout="hero" style="color: #ff0000; background: #00ff00; font-family: Inter;"></section>',
        elements: [],
      },
      {
        slideIndex: 1,
        html: '<section data-layout="hero" style="color: #0000ff; background: #123456; font-family: Arial;"></section>',
        elements: [],
      },
      {
        slideIndex: 2,
        html: '<section data-layout="split" style="color: #abcdef; background: #111111; font-family: Roboto;"></section>',
        elements: [],
      },
      {
        slideIndex: 3,
        html: '<section data-layout="split" style="color: #222222; background: #333333; font-family: Helvetica;"></section>',
        elements: [],
      },
      {
        slideIndex: 4,
        html: '<section data-layout="grid" style="color: #444444; background: #555555; font-family: Times New Roman;"></section>',
        elements: [],
      },
    ];

    const { issues, stats } = analyzeStyleConsistency(slides, {});

    expect(stats.totalSlides).toBe(5);
    expect(stats.layoutTypes.get("hero")).toBe(2);
    expect(stats.layoutTypes.get("split")).toBe(2);
    expect(stats.layoutTypes.get("grid")).toBe(1);
    expect(stats.colorUsage.size).toBeGreaterThan(ANALYZER_CONFIG.softLimits.maxColors);
    expect(stats.fontUsage.size).toBeGreaterThan(ANALYZER_CONFIG.softLimits.maxFonts);

    const issueTypes = issues.map((issue) => issue.type).sort();
    expect(issueTypes).toEqual(["color_inconsistency", "font_inconsistency"].sort());
    issues.forEach((issue) => {
      expect(issue.severity).toBe("warning");
      expect(typeof issue.message).toBe("string");
      expect(issue.message).toMatch(/\d+/);
    });
  });

  it("normalizes color and font usage", () => {
    const slides = [
      {
        slideIndex: 0,
        html: '<section data-layout="hero" style="color: #ABC; background: #abc; font-family: Inter; font-family: inter;"></section>',
        elements: [],
      },
    ];

    const { stats } = analyzeStyleConsistency(slides, null);

    expect(stats.colorUsage.size).toBe(1);
    expect(stats.colorUsage.get("#abc")).toBe(2);
    expect(stats.fontUsage.size).toBe(1);
    expect(stats.fontUsage.get("inter")).toBe(2);
  });

  it("returns empty stats for empty slide arrays", () => {
    const { issues, stats } = analyzeStyleConsistency([], null);

    expect(issues).toEqual([]);
    expect(stats.totalSlides).toBe(0);
    expect(stats.colorUsage.size).toBe(0);
    expect(stats.fontUsage.size).toBe(0);
    expect(stats.layoutTypes.size).toBe(0);
  });

  it("handles slides with blank or whitespace HTML", () => {
    const slides = [
      { slideIndex: 0, html: "", elements: [] },
      { slideIndex: 1, html: "   ", elements: [] },
    ];

    const { stats } = analyzeStyleConsistency(slides, null);

    expect(stats.totalSlides).toBe(2);
    expect(stats.colorUsage.size).toBe(0);
    expect(stats.fontUsage.size).toBe(0);
    expect(stats.layoutTypes.size).toBe(0);
  });

  it("throws when input is not iterable", () => {
    expect(() => analyzeStyleConsistency({}, null)).toThrow(TypeError);
  });

  it("handles numeric-like layout values and boundary tokens", () => {
    const maxSafe = String(Number.MAX_SAFE_INTEGER);
    const longToken = `#${"a".repeat(2048)}`;
    const slides = [
      {
        slideIndex: 0,
        html: '<section data-layout="0" style="color: 0; font-family: 0;"></section>',
        elements: [],
      },
      {
        slideIndex: 1,
        html: `<section data-layout="-1" style="background: ${longToken}; font-family: ${maxSafe};"></section>`,
        elements: [],
      },
      {
        slideIndex: 2,
        html: `<section data-layout="${maxSafe}" style="color: #fff;"></section>`,
        elements: [],
      },
    ];

    const { stats } = analyzeStyleConsistency(slides, null);

    expect(stats.layoutTypes.get("0")).toBe(1);
    expect(stats.layoutTypes.get("-1")).toBe(1);
    expect(stats.layoutTypes.get(maxSafe)).toBe(1);
    expect(stats.colorUsage.get("0")).toBe(1);
    expect(stats.colorUsage.get(longToken)).toBe(1);
    expect(stats.fontUsage.get("0")).toBe(1);
    expect(stats.fontUsage.get(maxSafe)).toBe(1);
  });

  it("supports concurrent calls", async () => {
    const slidesA = [
      { slideIndex: 0, html: '<section data-layout="a" style="color: #111; font-family: Inter;"></section>', elements: [] },
    ];
    const slidesB = [
      { slideIndex: 0, html: '<section data-layout="b" style="color: #222; font-family: Roboto;"></section>', elements: [] },
    ];

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => analyzeStyleConsistency(slidesA, null)),
      Promise.resolve().then(() => analyzeStyleConsistency(slidesB, null)),
    ]);

    expect(first.stats.layoutTypes.get("a")).toBe(1);
    expect(second.stats.layoutTypes.get("b")).toBe(1);
    expect(first.stats.colorUsage.get("#111")).toBe(1);
    expect(second.stats.colorUsage.get("#222")).toBe(1);
  });

  it("handles rapid consecutive calls", () => {
    const slides = [
      { slideIndex: 0, html: '<section data-layout="a" style="color: #111; font-family: Inter;"></section>', elements: [] },
    ];

    const first = analyzeStyleConsistency(slides, null);
    const second = analyzeStyleConsistency(slides, null);

    expect(first.stats.totalSlides).toBe(1);
    expect(second.stats.totalSlides).toBe(1);
    expect(first.stats.colorUsage).not.toBe(second.stats.colorUsage);
    expect(first.stats.fontUsage).not.toBe(second.stats.fontUsage);
    expect(first.stats.layoutTypes).not.toBe(second.stats.layoutTypes);
  });
});
