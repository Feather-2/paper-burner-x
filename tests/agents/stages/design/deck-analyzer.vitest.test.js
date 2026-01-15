import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-scope: mock external deps so we only test DeckAnalyzer logic.
vi.mock("../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => {
  return {
    parseSections: vi.fn(),
    joinSections: vi.fn(),
    extractElements: vi.fn(),
  };
});

let parseSections;
let extractElements;

let ANALYZER_CONFIG;
let collectAllDsl;
let extractDesignTokensSummary;
let analyzeStyleConsistency;
let locateElement;
let DeckAnalyzer;
let createDeckAnalyzer;

const SPLIT = "<!--SPLIT-->";

describe("design/runtime/deck-analyzer", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ parseSections, extractElements } = await import(
      "../../../../js/agents/stages/design/refiner/react-refiner-tools.js"
    ));

    ({
      ANALYZER_CONFIG,
      collectAllDsl,
      extractDesignTokensSummary,
      analyzeStyleConsistency,
      locateElement,
      DeckAnalyzer,
      createDeckAnalyzer,
    } = await import("../../../../js/agents/stages/design/runtime/deck-analyzer.js"));

    parseSections.mockImplementation((deckHtmlDsl) => {
      const s = String(deckHtmlDsl || "");
      if (!s) return [];
      return s
        .split(SPLIT)
        .map((v) => v.trim())
        .filter(Boolean);
    });

    extractElements.mockImplementation((_sectionHtml) => []);
  });

  it("collectAllDsl() returns slide DSL with elements extracted per section", () => {
    parseSections.mockReturnValue([
      `<section data-layout="title"><h1 data-el="t1">Hello</h1></section>`,
      `<section data-layout="content"><p data-el="p1">World</p></section>`,
    ]);

    extractElements
      .mockReturnValueOnce([{ elementId: "t1", tag: "h1", textPreview: "Hello", attrs: {}, class: "" }])
      .mockReturnValueOnce([{ elementId: "p1", tag: "p", textPreview: "World", attrs: {}, class: "" }]);

    const out = collectAllDsl(`<section/>${SPLIT}<section/>`);
    expect(parseSections).toHaveBeenCalledTimes(1);
    expect(extractElements).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      {
        slideIndex: 0,
        html: `<section data-layout="title"><h1 data-el="t1">Hello</h1></section>`,
        elements: [{ elementId: "t1", tag: "h1", textPreview: "Hello", attrs: {}, class: "" }],
      },
      {
        slideIndex: 1,
        html: `<section data-layout="content"><p data-el="p1">World</p></section>`,
        elements: [{ elementId: "p1", tag: "p", textPreview: "World", attrs: {}, class: "" }],
      },
    ]);
  });

  it("extractDesignTokensSummary() supports multiple token shapes and returns null for missing designSystem", () => {
    expect(extractDesignTokensSummary(null)).toBe(null);

    expect(
      extractDesignTokensSummary({
        theme: "dark",
        designTokens: { colorScheme: "#111", typography: { bodyFont: "Inter" }, colors: { accent: "#f00" } },
      })
    ).toEqual({ theme: "dark", colorScheme: "#111", fontFamily: "Inter", accentColor: "#f00" });

    expect(
      extractDesignTokensSummary({
        tokens: { colors: { primary: "#00f", accent: "#0f0" }, typography: { bodyFont: "Roboto" } },
      })
    ).toEqual({ theme: undefined, colorScheme: "#00f", fontFamily: "Roboto", accentColor: "#0f0" });

    expect(
      extractDesignTokensSummary({
        theme: "light",
        colors: { primary: "#aaa", accent: "#bbb" },
        typography: { bodyFont: "B" },
      })
    ).toEqual({ theme: "light", colorScheme: "#aaa", fontFamily: "B", accentColor: "#bbb" });
  });

  it("analyzeStyleConsistency() detects too many unique colors/fonts (edge case) and counts layout usage", () => {
    const html = `
      <section data-layout="l1">
        <div style="color: #111111; background: #222222; font-family: Inter;"></div>
        <div style="color: #333333; background: #444444; font-family: Roboto;"></div>
        <div style="color: #555555; background: #666666; font-family: Georgia;"></div>
        <div style="color: #777777; background: #888888; font-family: Helvetica;"></div>
        <div style="color: #999999;"></div>
      </section>
    `.trim();

    const { issues, stats } = analyzeStyleConsistency(
      [
        { slideIndex: 0, html, elements: [] },
        { slideIndex: 1, html: `<section data-layout="l2"><div style="color: #111111"></div></section>`, elements: [] },
      ],
      { designTokens: {} }
    );

    // Soft limit checks.
    expect(issues.some((i) => i.type === "color_inconsistency")).toBe(true);
    expect(issues.some((i) => i.type === "font_inconsistency")).toBe(true);

    // Stats aggregation.
    expect(stats.totalSlides).toBe(2);
    expect(stats.layoutTypes.get("l1")).toBe(1);
    expect(stats.layoutTypes.get("l2")).toBe(1);
    expect(stats.colorUsage.get("#111111")).toBeGreaterThan(0);
    expect(stats.fontUsage.get("inter")).toBeGreaterThan(0);
  });

  it("locateElement() matches by text/elementId/class, falls back to tag keyword matching, and returns candidates when not found", () => {
    const els = Array.from({ length: 10 }).map((_, i) => ({
      elementId: `e${i}`,
      tag: "div",
      textPreview: `text-${i}`,
      class: i === 0 ? "hero" : "",
      attrs: {},
    }));
    els[1] = { elementId: "title1", tag: "h1", textPreview: "Hello World", class: "hero-title", attrs: {} };
    els[2] = { elementId: "img1", tag: "img", textPreview: "", class: "", attrs: {} };

    extractElements.mockReturnValue(els);

    expect(locateElement("<section/>", "hello").found).toBe(true);
    expect(locateElement("<section/>", "TITLE1").selector).toBe(`[data-el="title1"]`);
    expect(locateElement("<section/>", "hero").element.elementId).toBe("e0");
    expect(locateElement("<section/>", "标题").element.tag).toBe("h1");
    expect(locateElement("<section/>", "图片").element.tag).toBe("img");

    const miss = locateElement("<section/>", "does-not-exist");
    expect(miss.found).toBe(false);
    expect(miss.selector).toBe(null);
    expect(miss.candidates.length).toBe(ANALYZER_CONFIG.locateCandidates);
  });

  it("DeckAnalyzer.createDeckOverview() validates inputs, calls screenshotFn per slide, and optionally stitches", async () => {
    const noFn = createDeckAnalyzer();
    const noFnRes = await noFn.createDeckOverview({ deckHtmlDsl: "<section/>" });
    expect(noFnRes.success).toBe(false);
    expect(noFnRes.error).toContain("screenshotFn");

    const screenshotFn = vi.fn(async ({ slideIndex, scale }) => {
      return { success: true, data: { base64: `img_${slideIndex}_${scale}` } };
    });

    parseSections.mockReturnValue([]);
    const analyzer = createDeckAnalyzer({ screenshotFn });
    const emptyRes = await analyzer.createDeckOverview({ deckHtmlDsl: "" });
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.error).toContain("No slides");
    expect(screenshotFn).not.toHaveBeenCalled();

    parseSections.mockReturnValue(["<section>a</section>", "<section>b</section>", "<section>c</section>"]);
    const plain = await analyzer.createDeckOverview({ deckHtmlDsl: "x" }, { scale: 2 });
    expect(plain.success).toBe(true);
    expect(plain.data.slideCount).toBe(3);
    expect(plain.data.screenshots).toEqual(["img_0_2", "img_1_2", "img_2_2"]);
    expect(screenshotFn).toHaveBeenCalledTimes(3);

    const stitcher = { createDeckOverview: vi.fn(async (shots) => `stitched:${shots.length}`) };
    const stitchedAnalyzer = new DeckAnalyzer({ screenshotFn, stitcher });
    const stitched = await stitchedAnalyzer.createDeckOverview({ deckHtmlDsl: "x" }, { scale: 1 });
    expect(stitched.success).toBe(true);
    expect(stitcher.createDeckOverview).toHaveBeenCalledTimes(1);
    expect(stitched.data.overview).toBe("stitched:3");
  });

  it("DeckAnalyzer.analyze() returns tokensSummary and optional overview (includeScreenshots=false skips screenshots)", async () => {
    parseSections.mockReturnValue(["<section data-layout=\"a\"><div style=\"color: #111; font-family: Inter\"></div></section>"]);
    extractElements.mockReturnValue([{ elementId: "t", tag: "div", textPreview: "", class: "", attrs: {} }]);

    const screenshotFn = vi.fn(async () => ({ success: true, data: { base64: "img" } }));
    const analyzer = createDeckAnalyzer({ screenshotFn });

    const noShots = await analyzer.analyze(
      { deckHtmlDsl: `<section/>` },
      { tokens: { colors: { primary: "#111", accent: "#f00" }, typography: { bodyFont: "Inter" } } },
      { includeScreenshots: false }
    );

    expect(noShots.slideCount).toBe(1);
    expect(noShots.tokensSummary).toEqual({
      theme: undefined,
      colorScheme: "#111",
      fontFamily: "Inter",
      accentColor: "#f00",
    });
    expect(noShots.overview).toBe(null);
    expect(screenshotFn).not.toHaveBeenCalled();

    const withShots = await analyzer.analyze(
      { deckHtmlDsl: `<section/>` },
      { designTokens: { colors: { primary: "#111", accent: "#f00" }, typography: { bodyFont: "Inter" } } },
      {}
    );
    expect(withShots.overview).toEqual({ screenshots: ["img"], slideCount: 1 });
    expect(screenshotFn).toHaveBeenCalled();
  });

  it("DeckAnalyzer wrapper methods delegate to exported helpers and analyze() keeps overview=null on overview failure", async () => {
    // One slide so wrappers have meaningful results.
    parseSections.mockReturnValue([
      `<section data-layout="x"><div style="color: #111; font-family: Inter"></div></section>`,
    ]);
    extractElements.mockReturnValue([{ elementId: "t1", tag: "div", textPreview: "Hi", class: "", attrs: {} }]);

    const analyzer = createDeckAnalyzer();
    const allDsl = analyzer.collectAllDsl({ deckHtmlDsl: "<section/>" });
    expect(allDsl.length).toBe(1);

    const style = analyzer.analyzeStyleConsistency({ deckHtmlDsl: "<section/>" }, {});
    expect(style).toHaveProperty("issues");
    expect(style).toHaveProperty("stats");

    const located = analyzer.locateElement("<section/>", "Hi");
    expect(located.found).toBe(true);

    // Overview failure branch: screenshotFn exists but createDeckOverview fails -> overview stays null.
    const screenshotFn = vi.fn(async () => ({ success: true, data: { base64: "img" } }));
    const analyzerWithShots = createDeckAnalyzer({ screenshotFn });
    parseSections.mockReturnValue([]); // triggers "No slides found" inside createDeckOverview

    const res = await analyzerWithShots.analyze({ deckHtmlDsl: "" }, null, {});
    expect(res.overview).toBe(null);
    expect(screenshotFn).not.toHaveBeenCalled();
  });
});
