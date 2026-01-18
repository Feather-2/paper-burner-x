import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-scope: mock external deps so we only test auto-reviewer logic.
vi.mock("../../../../js/agents/stages/design/runtime/deck-analyzer.js", () => {
  return {
    createDeckAnalyzer: vi.fn(() => ({ mocked: "analyzer" })),
    collectAllDsl: vi.fn(() => []),
  };
});

vi.mock("../../../../js/agents/stages/design/runtime/deck-editor.js", () => {
  return {
    createDeckEditor: vi.fn(() => {
      let deckPackage = { deckHtmlDsl: "" };
      return {
        setDeckPackage: vi.fn((pkg) => {
          deckPackage = pkg;
        }),
        batchEdit: vi.fn(async (_edits) => {
          // Simulate a successful edit mutating the DSL.
          deckPackage = { ...deckPackage, deckHtmlDsl: `${deckPackage.deckHtmlDsl}|edited` };
          return { success: true, data: { ok: true } };
        }),
        getDeckHtmlDsl: vi.fn(() => deckPackage?.deckHtmlDsl || ""),
      };
    }),
  };
});

vi.mock("../../../../js/agents/stages/design/runtime/screenshot-stitcher.js", () => {
  return {
    createScreenshotStitcher: vi.fn(() => ({ mocked: "stitcher" })),
  };
});

let collectAllDsl;
let IssueType;
let IssueSeverity;
let REVIEW_CONFIG;
let buildReviewContext;
let runAutoReview;
let AutoReviewer;
let createAutoReviewer;
let ReviewInputError;

function slideHtml({ layout, color, bg, font }) {
  return `<section data-layout="${layout}"><div style="color: ${color}; background-color: ${bg}; font-family: ${font};"></div></section>`;
}

describe("design/reviewer/auto-reviewer", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    ({ collectAllDsl } = await import("../../../../js/agents/stages/design/runtime/deck-analyzer.js"));
    ({ IssueType, IssueSeverity, REVIEW_CONFIG, buildReviewContext, runAutoReview, AutoReviewer, createAutoReviewer, ReviewInputError } =
      await import("../../../../js/agents/stages/design/reviewer/auto-reviewer.js"));
  });

  it("buildReviewContext() uses collectAllDsl and returns expected shape", () => {
    collectAllDsl.mockReturnValue([
      { slideIndex: 0, html: "<section data-layout=\"a\"></section>", elements: [] },
      { slideIndex: 1, html: "<section data-layout=\"b\"></section>", elements: [] },
    ]);

    const ctx = buildReviewContext({ deckHtmlDsl: "DSL", slidesMeta: [{ x: 1 }] }, { theme: "dark" }, { foo: 1 });
    expect(collectAllDsl).toHaveBeenCalledWith("DSL");
    expect(ctx.slideCount).toBe(2);
    expect(ctx.slidesMeta).toEqual([{ x: 1 }]);
    expect(ctx.options).toEqual({ foo: 1 });
  });

  it("runAutoReview() returns error result when no slides exist (edge case)", async () => {
    collectAllDsl.mockReturnValue([]);

    const res = await runAutoReview({ deckHtmlDsl: "" }, { tokens: {} });
    expect(res.success).toBe(false);
    expect(res.error).toContain("No slides");
    expect(res.issues).toEqual([]);
    expect(res.fixes).toEqual([]);
    expect(res.score).toBe(0);
  });

  it("runAutoReview() detects color/font/layout issues, generates fixes, and computes score/summary", async () => {
    // 9 slides (> minSlidesForLayoutCheck=8) and 6 unique layouts (> maxLayoutVariants=5).
    const layouts = ["l1", "l2", "l3", "l4", "l5", "l6", "l1", "l2", "l3"];
    const colors = ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006", "#000007", "#000008", "#000009"];
    const fonts = ["Inter", "Roboto", "Georgia", "Helvetica", "Inter", "Roboto", "Georgia", "Helvetica", "Inter"];

    collectAllDsl.mockReturnValue(
      layouts.map((layout, i) => ({
        slideIndex: i,
        html: slideHtml({ layout, color: colors[i], bg: colors[(i + 1) % colors.length], font: fonts[i] }),
        elements: [],
      }))
    );

    const designSystem = {
      designTokens: {
        colors: {
          primary: "#000001",
          accent: "#000002",
        },
        typography: { bodyFont: "Inter" },
      },
    };

    const res = await runAutoReview({ deckHtmlDsl: "DSL" }, designSystem);
    expect(res.success).toBe(true);
    expect(res.slideCount).toBe(9);

    // Issues include both warnings and infos.
    const types = res.issues.map((i) => i.type);
    expect(types).toContain(IssueType.COLOR_INCONSISTENCY);
    expect(types).toContain(IssueType.FONT_INCONSISTENCY);
    expect(types).toContain(IssueType.LAYOUT_MISMATCH);
    expect(types).toContain(IssueType.STYLE_DEVIATION);

    // Severity drives scoring.
    const severities = res.issues.map((i) => i.severity);
    expect(severities).toContain(IssueSeverity.WARNING);
    expect(severities).toContain(IssueSeverity.INFO);

    // Fixes are only generated for certain issue types.
    expect(res.fixes.length).toBe(2);
    expect(res.fixes[0].issueType).toBe(IssueType.COLOR_INCONSISTENCY);
    expect(res.fixes[0].autoFixable).toBe(false);
    expect(res.fixes[0].suggestion.primaryColors.length).toBe(REVIEW_CONFIG.thresholds.topColorsForFix);
    expect(res.fixes[1].issueType).toBe(IssueType.FONT_INCONSISTENCY);
    expect(res.fixes[1].suggestion.primaryFont).toBe("inter");

    // Score: 2 warnings + 2 infos => 1 - 0.2 - 0.1 = 0.7
    expect(res.score).toBeCloseTo(0.7, 6);
    expect(res.pass).toBe(true);
    expect(res.summary.score).toBe(70);
    expect(res.summary.status).toBe("良好");
    expect(res.summary.issueBreakdown.warning).toBeGreaterThan(0);
  });

  it("AutoReviewer.review() delegates to runAutoReview and applyFixes() runs auto-fixable edits only", async () => {
    collectAllDsl.mockReturnValue([{ slideIndex: 0, html: slideHtml({ layout: "l1", color: "#111", bg: "#222", font: "Inter" }), elements: [] }]);

    const reviewer = createAutoReviewer({ config: { minConsistencyScore: 0.99 } });
    const reviewRes = await reviewer.review({ deckHtmlDsl: "<section/>", slidesMeta: [] }, { tokens: {} }, { any: 1 });
    expect(reviewRes.success).toBe(true);

    const fixes = [
      { issueType: "x", description: "no", autoFixable: false, edits: [{ type: "slide", slideIndex: 0, changes: {} }] },
      { issueType: "y", description: "yes", autoFixable: true, edits: [{ type: "slide", slideIndex: 0, changes: { layout: "a" } }] },
    ];

    const applied = await reviewer.applyFixes({ deckHtmlDsl: "<section>base</section>", slidesMeta: [] }, fixes);
    expect(applied.appliedFixes.length).toBe(1);
    expect(applied.fixedDeckHtmlDsl).toContain("|edited");

    // getConfig() returns a shallow copy.
    const cfg = reviewer.getConfig();
    expect(cfg).toMatchObject({ ...REVIEW_CONFIG, minConsistencyScore: 0.99 });
    cfg.minConsistencyScore = 0;
    expect(reviewer.getConfig().minConsistencyScore).toBe(0.99);
  });

  // --- Boundary input tests (Issue #6) ---

  it("buildReviewContext() throws ReviewInputError for non-string deckHtmlDsl", () => {
    collectAllDsl.mockReturnValue([]);
    expect(() => buildReviewContext({ deckHtmlDsl: 123 }, {})).toThrow(ReviewInputError);
    expect(() => buildReviewContext({ deckHtmlDsl: {} }, {})).toThrow("deckHtmlDsl must be a string");
  });

  it("buildReviewContext() throws ReviewInputError for non-array slidesMeta", () => {
    collectAllDsl.mockReturnValue([]);
    expect(() => buildReviewContext({ deckHtmlDsl: "", slidesMeta: "not-array" }, {})).toThrow(ReviewInputError);
    expect(() => buildReviewContext({ deckHtmlDsl: "", slidesMeta: { foo: 1 } }, {})).toThrow("slidesMeta must be an array");
  });

  it("buildReviewContext() accepts null/undefined for optional fields", () => {
    collectAllDsl.mockReturnValue([{ slideIndex: 0, html: "<section/>", elements: [] }]);
    const ctx = buildReviewContext({ deckHtmlDsl: null, slidesMeta: undefined }, null);
    expect(ctx.deckHtmlDsl).toBe("");
    expect(ctx.slidesMeta).toEqual([]);
    expect(ctx.designSystem).toEqual({});
  });

  it("runAutoReview() returns aborted result when signal is already aborted", async () => {
    collectAllDsl.mockReturnValue([{ slideIndex: 0, html: slideHtml({ layout: "l1", color: "#111", bg: "#222", font: "Inter" }), elements: [] }]);

    const abortController = new AbortController();
    abortController.abort();

    const res = await runAutoReview({ deckHtmlDsl: "<section/>" }, {}, { signal: abortController.signal });
    expect(res.success).toBe(false);
    expect(res.error).toBe("Review aborted");
    expect(res.issues).toEqual([]);
  });

  it("runAutoReview() handles empty deckHtmlDsl gracefully", async () => {
    collectAllDsl.mockReturnValue([]);
    const res = await runAutoReview({ deckHtmlDsl: "" }, {});
    expect(res.success).toBe(false);
    expect(res.error).toContain("No slides");
  });

  it("runAutoReview() handles undefined/null deckPackage gracefully", async () => {
    collectAllDsl.mockReturnValue([]);
    const res1 = await runAutoReview(undefined, {});
    expect(res1.success).toBe(false);

    const res2 = await runAutoReview(null, {});
    expect(res2.success).toBe(false);
  });

  it("runAutoReview() works with minimal valid input", async () => {
    collectAllDsl.mockReturnValue([{ slideIndex: 0, html: "<section data-layout='a'><div style='color: #000;'></div></section>", elements: [] }]);

    const res = await runAutoReview({ deckHtmlDsl: "<section/>" }, {});
    expect(res.success).toBe(true);
    expect(res.slideCount).toBe(1);
    expect(res.score).toBeGreaterThan(0);
  });
});
