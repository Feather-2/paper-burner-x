import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/design/internal/deck-analyzer.js", () => ({
  createDeckAnalyzer: vi.fn(() => ({ mocked: "analyzer" })),
  collectAllDsl: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/design/internal/deck-editor.js", () => ({
  createDeckEditor: vi.fn(() => {
    let deckPackage = { deckHtmlDsl: "" };
    return {
      setDeckPackage: vi.fn((pkg) => {
        deckPackage = pkg || { deckHtmlDsl: "" };
      }),
      batchEdit: vi.fn(async (edits) => {
        const count = Array.isArray(edits) ? edits.length : 0;
        deckPackage = {
          ...deckPackage,
          deckHtmlDsl: `${deckPackage?.deckHtmlDsl ?? ""}|edited:${count}`,
        };
        return { success: true };
      }),
      getDeckHtmlDsl: vi.fn(() => deckPackage?.deckHtmlDsl ?? ""),
    };
  }),
}));

vi.mock("../../../../../../js/agents/stages/design/internal/screenshot-stitcher.js", () => ({
  createScreenshotStitcher: vi.fn(() => ({ mocked: "stitcher" })),
}));

const slideHtml = ({ layout = "layout", color = "#000000", bg = "#ffffff", font = "Inter", extraStyle = "" } = {}) =>
  `<section data-layout="${layout}"><div style="color: ${color}; background-color: ${bg}; font-family: ${font}; ${extraStyle}"></div></section>`;

const makeSlide = (index, options = {}) => ({
  slideIndex: index,
  html: slideHtml(options),
  elements: [],
});

let collectAllDsl;
let createDeckAnalyzer;
let createDeckEditor;
let createScreenshotStitcher;
let REVIEW_CONFIG;
let IssueType;
let IssueSeverity;
let ReviewInputError;
let buildReviewContext;
let runAutoReview;
let AutoReviewer;
let createAutoReviewer;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  ({ collectAllDsl, createDeckAnalyzer } = await import(
    "../../../../../../js/agents/stages/design/internal/deck-analyzer.js"
  ));
  ({ createDeckEditor } = await import("../../../../../../js/agents/stages/design/internal/deck-editor.js"));
  ({ createScreenshotStitcher } = await import(
    "../../../../../../js/agents/stages/design/internal/screenshot-stitcher.js"
  ));
  ({
    REVIEW_CONFIG,
    IssueType,
    IssueSeverity,
    ReviewInputError,
    buildReviewContext,
    runAutoReview,
    AutoReviewer,
    createAutoReviewer,
  } = await import("../../../../../../js/agents/stages/design/reviewer/auto-reviewer.js"));
});

describe("REVIEW_CONFIG", () => {
  it("exposes expected defaults", () => {
    expect(REVIEW_CONFIG.maxColorVariants).toBe(8);
    expect(REVIEW_CONFIG.maxFontVariants).toBe(3);
    expect(REVIEW_CONFIG.maxLayoutVariants).toBe(5);
    expect(REVIEW_CONFIG.minSlidesForLayoutCheck).toBe(8);
    expect(REVIEW_CONFIG.minConsistencyScore).toBe(0.7);
    expect(REVIEW_CONFIG.autoFixEnabled).toBe(true);
    expect(REVIEW_CONFIG.scoring).toMatchObject({
      errorPenalty: 0.2,
      warningPenalty: 0.1,
      infoPenalty: 0.05,
    });
    expect(REVIEW_CONFIG.thresholds).toMatchObject({
      unexpectedColorWarning: 3,
      topColorsToShow: 10,
      topColorsForFix: 3,
      unexpectedColorsToShow: 5,
    });
    expect(REVIEW_CONFIG.statusThresholds).toMatchObject({
      poor: 0.5,
      fair: 0.7,
      good: 0.9,
    });
  });
});

describe("IssueType", () => {
  it("defines issue type values", () => {
    expect(IssueType).toEqual({
      COLOR_INCONSISTENCY: "color_inconsistency",
      FONT_INCONSISTENCY: "font_inconsistency",
      LAYOUT_MISMATCH: "layout_mismatch",
      VISUAL_IMBALANCE: "visual_imbalance",
      MISSING_ELEMENT: "missing_element",
      STYLE_DEVIATION: "style_deviation",
    });
  });
});

describe("IssueSeverity", () => {
  it("defines severity values", () => {
    expect(IssueSeverity).toEqual({
      ERROR: "error",
      WARNING: "warning",
      INFO: "info",
    });
  });
});

describe("ReviewInputError", () => {
  it("sets name and message", () => {
    const err = new ReviewInputError("bad input");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ReviewInputError");
    expect(err.message).toBe("bad input");
  });
});

describe("buildReviewContext", () => {
  it("builds context with parsed DSL and metadata", () => {
    const slides = [makeSlide(0, { layout: "a" }), makeSlide(1, { layout: "b" })];
    collectAllDsl.mockReturnValue(slides);

    const designSystem = { tokens: { colors: { primary: "#111" } } };
    const options = { maxColorVariants: 2 };
    const ctx = buildReviewContext(
      { deckHtmlDsl: "DSL", slidesMeta: [{ index: 0 }] },
      designSystem,
      options
    );

    expect(collectAllDsl).toHaveBeenCalledWith("DSL");
    expect(ctx.allDsl).toBe(slides);
    expect(ctx.slideCount).toBe(2);
    expect(ctx.deckHtmlDsl).toBe("DSL");
    expect(ctx.slidesMeta).toEqual([{ index: 0 }]);
    expect(ctx.designSystem).toBe(designSystem);
    expect(ctx.options).toBe(options);
  });

  it("normalizes null/undefined inputs", () => {
    collectAllDsl.mockReturnValue([]);

    const ctx = buildReviewContext({ deckHtmlDsl: null, slidesMeta: undefined }, null);
    expect(collectAllDsl).toHaveBeenCalledWith("");
    expect(ctx.deckHtmlDsl).toBe("");
    expect(ctx.slidesMeta).toEqual([]);
    expect(ctx.designSystem).toEqual({});
    expect(ctx.slideCount).toBe(0);
  });

  it("throws ReviewInputError for non-string deckHtmlDsl", () => {
    collectAllDsl.mockReturnValue([]);

    expect(() => buildReviewContext({ deckHtmlDsl: 0 }, {})).toThrow(ReviewInputError);
    expect(() => buildReviewContext({ deckHtmlDsl: {} }, {})).toThrow("deckHtmlDsl must be a string");
  });

  it("throws ReviewInputError for non-array slidesMeta", () => {
    collectAllDsl.mockReturnValue([]);

    expect(() => buildReviewContext({ deckHtmlDsl: "", slidesMeta: {} }, {})).toThrow(ReviewInputError);
    expect(() => buildReviewContext({ deckHtmlDsl: "", slidesMeta: "bad" }, {})).toThrow("slidesMeta must be an array");
  });

  it("handles long whitespace DSL and deep nested metadata", () => {
    const hugeDsl = " ".repeat(100000);
    const slides = [makeSlide(0, { layout: "deep", color: "#123456", bg: "#654321", font: "Inter" })];
    const slidesMeta = [{ index: 0, data: { level1: { level2: { level3: { value: 42 } } } } }];
    const designSystem = {
      designTokens: {
        colors: { primary: "#123456" },
        typography: { bodyFont: "Inter" },
      },
      deep: { level1: { level2: { level3: { value: "x" } } } },
    };

    collectAllDsl.mockReturnValue(slides);
    const ctx = buildReviewContext({ deckHtmlDsl: hugeDsl, slidesMeta }, designSystem, {});

    expect(collectAllDsl).toHaveBeenCalledWith(hugeDsl);
    expect(ctx.deckHtmlDsl).toBe(hugeDsl);
    expect(ctx.slidesMeta).toEqual(slidesMeta);
    expect(ctx.designSystem).toBe(designSystem);
    expect(ctx.slideCount).toBe(1);
  });
});

describe("runAutoReview", () => {
  it("returns aborted result when signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const res = await runAutoReview({ deckHtmlDsl: "<section/>" }, {}, { signal: controller.signal });

    expect(res).toMatchObject({
      success: false,
      error: "Review aborted",
      issues: [],
      fixes: [],
      score: 0,
    });
    expect(collectAllDsl).not.toHaveBeenCalled();
  });

  it("returns error when no slides to review", async () => {
    collectAllDsl.mockReturnValue([]);

    const res = await runAutoReview({ deckHtmlDsl: "" }, {});

    expect(res.success).toBe(false);
    expect(res.error).toContain("No slides");
    expect(res.issues).toEqual([]);
    expect(res.fixes).toEqual([]);
    expect(res.score).toBe(0);
  });

  it("handles undefined/null deckPackage", async () => {
    collectAllDsl.mockReturnValue([]);

    const resUndefined = await runAutoReview(undefined, {});
    const resNull = await runAutoReview(null, {});

    expect(resUndefined.success).toBe(false);
    expect(resNull.success).toBe(false);
    expect(collectAllDsl).toHaveBeenCalledTimes(2);
    expect(collectAllDsl.mock.calls[0][0]).toBe("");
    expect(collectAllDsl.mock.calls[1][0]).toBe("");
  });

  it("detects inconsistencies, produces fixes, and builds summary", async () => {
    const layouts = ["l1", "l2", "l3", "l4", "l5", "l6", "l1", "l2", "l3"];
    const colors = [
      "#000001",
      "#000002",
      "#000003",
      "#000004",
      "#000005",
      "#000006",
      "#000007",
      "#000008",
      "#000009",
    ];
    const fonts = ["Inter", "Roboto", "Georgia", "Helvetica", "Inter", "Roboto", "Georgia", "Helvetica", "Inter"];

    collectAllDsl.mockReturnValue(
      layouts.map((layout, i) =>
        makeSlide(i, {
          layout,
          color: colors[i],
          bg: colors[(i + 1) % colors.length],
          font: fonts[i],
        })
      )
    );

    const designSystem = {
      designTokens: {
        colors: { primary: "#000001", accent: "#000002" },
        typography: { bodyFont: "Inter" },
      },
    };

    const res = await runAutoReview({ deckHtmlDsl: "DSL" }, designSystem);

    expect(res.success).toBe(true);
    expect(res.slideCount).toBe(9);

    const issueTypes = res.issues.map((issue) => issue.type);
    expect(issueTypes).toEqual(
      expect.arrayContaining([
        IssueType.COLOR_INCONSISTENCY,
        IssueType.FONT_INCONSISTENCY,
        IssueType.LAYOUT_MISMATCH,
        IssueType.STYLE_DEVIATION,
      ])
    );

    const colorFix = res.fixes.find((fix) => fix.issueType === IssueType.COLOR_INCONSISTENCY);
    const fontFix = res.fixes.find((fix) => fix.issueType === IssueType.FONT_INCONSISTENCY);

    expect(res.fixes).toHaveLength(2);
    expect(colorFix?.suggestion?.primaryColors).toHaveLength(REVIEW_CONFIG.thresholds.topColorsForFix);
    expect(fontFix?.suggestion?.primaryFont).toBe("inter");

    expect(res.score).toBeCloseTo(0.7, 6);
    expect(res.pass).toBe(true);
    expect(res.summary.score).toBe(70);
    expect(res.summary.status).toBe("良好");
    expect(res.summary.issueBreakdown).toEqual({ error: 0, warning: 2, info: 2 });
  });

  it("honors boundary config values and type coercion", async () => {
    collectAllDsl.mockReturnValue([makeSlide(0, { layout: "solo", color: "#111111", bg: "#222222", font: "Inter" })]);

    const res = await runAutoReview(
      { deckHtmlDsl: "   " },
      { tokens: { colors: { primary: "#111111" }, typography: { bodyFont: "Inter" } } },
      {
        maxColorVariants: 0,
        maxFontVariants: "0",
        maxLayoutVariants: -1,
        minSlidesForLayoutCheck: -1,
        thresholds: { unexpectedColorWarning: 0 },
      }
    );

    const issueTypes = res.issues.map((issue) => issue.type);
    expect(issueTypes).toEqual(
      expect.arrayContaining([
        IssueType.COLOR_INCONSISTENCY,
        IssueType.FONT_INCONSISTENCY,
        IssueType.LAYOUT_MISMATCH,
        IssueType.STYLE_DEVIATION,
      ])
    );
    expect(res.success).toBe(true);
  });

  it("respects MAX_SAFE_INTEGER without triggering color inconsistency", async () => {
    collectAllDsl.mockReturnValue([
      makeSlide(0, { layout: "a", color: "#111111", bg: "#111111", font: "Inter" }),
      makeSlide(1, { layout: "a", color: "#222222", bg: "#222222", font: "Inter" }),
      makeSlide(2, { layout: "a", color: "#333333", bg: "#333333", font: "Inter" }),
    ]);

    const res = await runAutoReview({ deckHtmlDsl: "dsl" }, {}, { maxColorVariants: Number.MAX_SAFE_INTEGER });

    expect(res.success).toBe(true);
    expect(res.issues.map((issue) => issue.type)).not.toContain(IssueType.COLOR_INCONSISTENCY);
    expect(res.score).toBe(1);
  });

  it("supports concurrent reviews without shared state", async () => {
    collectAllDsl.mockImplementation((dsl) => {
      if (dsl === "deck-a") return [makeSlide(0, { layout: "a", color: "#111111", bg: "#111111", font: "Inter" })];
      if (dsl === "deck-b") return [makeSlide(0, { layout: "b", color: "#222222", bg: "#222222", font: "Inter" })];
      return [];
    });

    const [resA, resB] = await Promise.all([
      runAutoReview({ deckHtmlDsl: "deck-a" }, { tokens: { colors: { primary: "#111111" } } }),
      runAutoReview({ deckHtmlDsl: "deck-b" }, { tokens: { colors: { primary: "#222222" } } }),
    ]);

    expect(resA.success).toBe(true);
    expect(resB.success).toBe(true);
    expect(resA.slideCount).toBe(1);
    expect(resB.slideCount).toBe(1);
  });

  it("handles rapid consecutive calls", async () => {
    collectAllDsl.mockImplementation((dsl) => [makeSlide(0, { layout: dsl, color: "#111111", bg: "#111111", font: "Inter" })]);

    const inputs = ["one", "two", "three"];
    const results = [];

    for (const dsl of inputs) {
      results.push(await runAutoReview({ deckHtmlDsl: dsl }, {}));
    }

    expect(results.every((res) => res.success)).toBe(true);
    expect(collectAllDsl).toHaveBeenCalledTimes(inputs.length);
  });
});

describe("AutoReviewer", () => {
  it("constructs with default dependencies", () => {
    const reviewer = new AutoReviewer();

    expect(reviewer).toBeInstanceOf(AutoReviewer);
    expect(createDeckAnalyzer).toHaveBeenCalledTimes(1);
    expect(createDeckEditor).toHaveBeenCalledTimes(1);
    expect(createScreenshotStitcher).toHaveBeenCalledTimes(1);
  });

  it("uses provided dependencies and config overrides", () => {
    const analyzer = { collectAllDsl: vi.fn(() => []) };
    const editor = { setDeckPackage: vi.fn(), batchEdit: vi.fn(async () => ({ success: true })), getDeckHtmlDsl: vi.fn(() => "") };
    const stitcher = { stitch: vi.fn(async () => "") };

    const reviewer = new AutoReviewer({
      analyzer,
      editor,
      stitcher,
      config: { minConsistencyScore: 0.99 },
    });

    expect(reviewer.getConfig().minConsistencyScore).toBe(0.99);
    expect(createDeckAnalyzer).not.toHaveBeenCalled();
    expect(createDeckEditor).not.toHaveBeenCalled();
    expect(createScreenshotStitcher).not.toHaveBeenCalled();
  });

  it("merges config during review", async () => {
    collectAllDsl.mockReturnValue([
      makeSlide(0, { layout: "solo", color: "#111111", bg: "#222222", font: "Inter" }),
    ]);

    const reviewer = new AutoReviewer({
      config: { minConsistencyScore: 0.99, maxColorVariants: 0 },
    });

    const strictResult = await reviewer.review(
      { deckHtmlDsl: "dsl", slidesMeta: [] },
      { tokens: { colors: { primary: "#111111" } } }
    );

    const overrideResult = await reviewer.review(
      { deckHtmlDsl: "dsl", slidesMeta: [] },
      { tokens: { colors: { primary: "#111111" } } },
      { config: { minConsistencyScore: 0.5 } }
    );

    expect(strictResult.pass).toBe(false);
    expect(overrideResult.pass).toBe(true);
  });

  it("applies auto-fixable edits only", async () => {
    const reviewer = new AutoReviewer();
    const fixes = [
      { issueType: "x", description: "skip", autoFixable: false, edits: [{ type: "slide", slideIndex: 0, changes: {} }] },
      { issueType: "y", description: "apply", autoFixable: true, edits: [{ type: "slide", slideIndex: 0, changes: { layout: "a" } }] },
      { issueType: "z", description: "no edits", autoFixable: true },
    ];

    const result = await reviewer.applyFixes({ deckHtmlDsl: "<section>base</section>", slidesMeta: [] }, fixes);
    const editor = createDeckEditor.mock.results[0].value;

    expect(editor.setDeckPackage).toHaveBeenCalledWith({ deckHtmlDsl: "<section>base</section>", slidesMeta: [] });
    expect(editor.batchEdit).toHaveBeenCalledTimes(1);
    expect(result.appliedFixes).toHaveLength(1);
    expect(result.fixedDeckHtmlDsl).toContain("|edited:1");
  });

  it("getConfig returns a copy", () => {
    const reviewer = new AutoReviewer({ config: { minConsistencyScore: 0.8 } });
    const cfg = reviewer.getConfig();
    cfg.minConsistencyScore = 0;

    expect(reviewer.getConfig().minConsistencyScore).toBe(0.8);
  });
});

describe("createAutoReviewer", () => {
  it("returns an AutoReviewer instance with overrides", () => {
    const reviewer = createAutoReviewer({ config: { maxFontVariants: 1 } });

    expect(reviewer).toBeInstanceOf(AutoReviewer);
    expect(reviewer.getConfig().maxFontVariants).toBe(1);
  });
});
