import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    escapeHtml: vi.fn((value) => `ESC(${String(value)})`),
  };
});

import { escapeHtml } from "../../../../../../js/agents/stages/design/shared/design-utils.js";
import { generateLayoutHtml, generateLayoutBatch } from "../../../../../../js/agents/stages/design/generators/layout-generator.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateLayoutHtml", () => {
  it("renders hero layout with subtitle and escaped fields", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s1", title: "Intro", keyPoints: ["Sub"] },
      { layoutHint: "hero" }
    );

    expect(html).toContain("layout-hero");
    expect(html).toContain('data-slide-id="ESC(s1)"');
    expect(html).toContain("layout-title-large");
    expect(html).toContain("ESC(Intro)");
    expect(html).toContain("layout-subtitle");
    expect(html).toContain("ESC(Sub)");
    expect(escapeHtml).toHaveBeenCalled();
  });

  it("renders two-column layout and respects visualFocus=right", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s2", title: "Two", keyPoints: ["a", "b"] },
      { layoutHint: "two-column", visualFocus: "right" }
    );

    expect(html).toContain("layout-two-column");
    expect(html).toContain('layout-left"><div class="layout-placeholder');
    expect(html).toContain('layout-right"><ul class="layout-points"');
    expect(html).toContain("ESC(a)");
    expect(html).toContain("ESC(b)");
  });

  it("limits timeline items to five", () => {
    const points = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const html = generateLayoutHtml(
      { slideIntentId: "s3", title: "Timeline", keyPoints: points },
      { layoutHint: "timeline" }
    );

    expect(html).toContain("layout-timeline");
    points.slice(0, 5).forEach((point) => {
      expect(html).toContain(`ESC(${point})`);
    });
    expect(html).not.toContain("ESC(p6)");
  });

  it("uses placeholder when timeline items are empty", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s3-empty", title: "Timeline", keyPoints: [] },
      { layoutHint: "timeline" }
    );

    expect(html).toContain("layout-timeline");
    expect(html).toContain("(时间线项)");
  });

  it("renders list layout with placeholder when keyPoints is not an array", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s4", title: "List", keyPoints: {} },
      { layoutHint: "dense-list" }
    );

    expect(html).toContain("layout-list");
    expect(html).toContain("(要点)");
  });

  it("renders chart-focus layout with placeholder label and footer", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s5", title: "Chart", keyPoints: ["caption"] },
      { layoutHint: "chart-focus" }
    );

    expect(html).toContain("layout-chart");
    expect(html).toContain("layout-placeholder-chart");
    expect(html).toContain("图表区域");
    expect(html).toContain("ESC(caption)");
  });

  it("renders image-focus layout with title overlay", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s6", title: "Img", keyPoints: [] },
      { layoutHint: "image-focus" }
    );

    expect(html).toContain("layout-image");
    expect(html).toContain("全屏图片");
    expect(html).toContain("ESC(Img)");
  });

  it("toggles visual placeholder based on pageType in standard layout", () => {
    const standard = generateLayoutHtml(
      { slideIntentId: "s7", title: "Std", keyPoints: ["x"], pageType: "content" },
      { layoutHint: "standard" }
    );
    expect(standard).toContain("layout-standard");
    expect(standard).toContain("layout-with-visual");
    expect(standard).toContain("layout-placeholder-visual");

    const bullet = generateLayoutHtml(
      { slideIntentId: "s8", title: "Bullets", keyPoints: ["x"], pageType: "bullet" },
      { layoutHint: "standard" }
    );
    expect(bullet).toContain("layout-standard");
    expect(bullet).not.toContain("layout-placeholder-visual");

    const closing = generateLayoutHtml(
      { slideIntentId: "s9", title: "Closing", keyPoints: ["x"], pageType: "closing" },
      { layoutHint: "standard" }
    );
    expect(closing).not.toContain("layout-placeholder-visual");
  });

  it("falls back to standard layout for unknown layoutHint", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s10", title: "Unknown", keyPoints: ["x"] },
      { layoutHint: "not-a-layout" }
    );

    expect(html).toContain("layout-standard");
  });

  it("handles null/undefined/empty inputs with defaults", () => {
    const cases = [
      { slideIntent: undefined, plan: undefined },
      { slideIntent: null, plan: undefined },
      { slideIntent: {}, plan: {} },
    ];

    cases.forEach(({ slideIntent, plan }) => {
      const html = generateLayoutHtml(slideIntent, plan);
      expect(html).toContain("layout-standard");
      expect(html).toContain('data-slide-id="ESC(slide_unknown)"');
      expect(html).toContain("ESC((未命名))");
      expect(html).toContain("(要点)");
    });
  });

  it("handles boundary values for ids and titles", () => {
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const cases = [
      {
        slideIntentId: 0,
        title: 0,
        expectedId: "ESC(slide_unknown)",
        expectedTitle: "ESC((未命名))",
      },
      {
        slideIntentId: -1,
        title: "   ",
        expectedId: "ESC(-1)",
        expectedTitle: "ESC(   )",
      },
      {
        slideIntentId: maxSafe,
        title: "",
        expectedId: `ESC(${maxSafe})`,
        expectedTitle: "ESC((未命名))",
      },
      {
        slideIntentId: "0",
        title: "0",
        expectedId: "ESC(0)",
        expectedTitle: "ESC(0)",
      },
    ];

    cases.forEach(({ slideIntentId, title, expectedId, expectedTitle }) => {
      const html = generateLayoutHtml(
        { slideIntentId, title, keyPoints: [] },
        { layoutHint: "list" }
      );
      expect(html).toContain(`data-slide-id="${expectedId}"`);
      expect(html).toContain(expectedTitle);
    });
  });

  it("tolerates non-object plan values like numeric strings", () => {
    const html = generateLayoutHtml(
      { slideIntentId: "s11", title: "Plan", keyPoints: [] },
      "1"
    );

    expect(html).toContain("layout-standard");
  });

  it("handles long strings, large lists, and deeply nested values", () => {
    const longTitle = "L".repeat(10000);
    const deepObject = { a: { b: { c: { d: { e: 1 } } } } };
    const keyPoints = [["deep", ["nest"]], deepObject];
    for (let i = 0; i < 998; i += 1) {
      keyPoints.push(`p${i}`);
    }

    const html = generateLayoutHtml(
      { slideIntentId: "big", title: longTitle, keyPoints },
      { layoutHint: "list" }
    );

    expect(html).toContain(`ESC(${longTitle})`);
    expect(html).toContain("ESC(deep,nest)");
    expect(html).toContain("ESC([object Object])");
    expect(html).toContain("ESC(p0)");
    expect(html).toContain("ESC(p3)");
    expect(html).not.toContain("ESC(p4)");
  });

  it("supports concurrent and rapid successive calls", async () => {
    const intents = [
      { slideIntentId: "c1", title: "C1", keyPoints: ["k1"] },
      { slideIntentId: "c2", title: "C2", keyPoints: [] },
      { slideIntentId: "c3", title: "C3", keyPoints: ["k3"] },
    ];
    const plans = [
      { layoutHint: "hero" },
      { layoutHint: "two-column", visualFocus: "right" },
      { layoutHint: "timeline" },
    ];

    const concurrent = await Promise.all(
      intents.map((intent, index) =>
        Promise.resolve().then(() => generateLayoutHtml(intent, plans[index]))
      )
    );

    expect(concurrent).toHaveLength(3);
    expect(concurrent[0]).toContain("layout-hero");
    expect(concurrent[1]).toContain("layout-two-column");
    expect(concurrent[2]).toContain("layout-timeline");
    concurrent.forEach((html, index) => {
      expect(html).toContain(`data-slide-id="ESC(c${index + 1})"`);
    });

    const rapid = [];
    for (let i = 0; i < 5; i += 1) {
      rapid.push(
        generateLayoutHtml(
          { slideIntentId: `r${i}`, title: `R${i}`, keyPoints: [] },
          {}
        )
      );
    }

    expect(rapid[0]).toContain("layout-standard");
    expect(rapid[4]).toContain('data-slide-id="ESC(r4)"');
  });

  it("throws when plan is null", () => {
    expect(() =>
      generateLayoutHtml({ slideIntentId: "err", title: "Err" }, null)
    ).toThrow();
  });
});

describe("generateLayoutBatch", () => {
  it("maps plans by slideIntentId and falls back to default layout", () => {
    const intents = [
      { slideIntentId: "a", title: "A", keyPoints: [] },
      { slideIntentId: "b", title: "B", keyPoints: [] },
    ];
    const plans = [{ slideIntentId: "b", layoutHint: "hero" }];
    const out = generateLayoutBatch(intents, plans);

    expect(out).toHaveLength(2);
    expect(out[0].slideIntentId).toBe("a");
    expect(out[0].layoutHtml).toContain("layout-standard");
    expect(out[1].layoutHtml).toContain("layout-hero");
  });

  it("returns empty array for empty inputs", () => {
    expect(generateLayoutBatch([], [])).toEqual([]);
  });

  it("does not coerce numeric string ids when matching plans", () => {
    const intents = [{ slideIntentId: "123", title: "T", keyPoints: [] }];
    const plans = [{ slideIntentId: 123, layoutHint: "hero" }];
    const out = generateLayoutBatch(intents, plans);

    expect(out[0].layoutHtml).toContain("layout-standard");
  });

  it("handles undefined plans and empty slideIntent objects", () => {
    const intents = [{ slideIntentId: "x", title: "X", keyPoints: [] }, {}];
    const out = generateLayoutBatch(intents);

    expect(out).toHaveLength(2);
    expect(out[0].layoutHtml).toContain("layout-standard");
    expect(out[1].slideIntentId).toBeUndefined();
    expect(out[1].layoutHtml).toContain('data-slide-id="ESC(slide_unknown)"');
  });

  it("throws when slideIntents is null or not an array", () => {
    expect(() => generateLayoutBatch(null)).toThrow();
    expect(() => generateLayoutBatch({})).toThrow();
  });

  it("throws when plans is null", () => {
    expect(() => generateLayoutBatch([], null)).toThrow();
  });

  it("supports concurrent and rapid batch calls", async () => {
    const intentsA = [
      { slideIntentId: "c1", title: "C1", keyPoints: [] },
      { slideIntentId: "c2", title: "C2", keyPoints: [] },
    ];
    const intentsB = [
      { slideIntentId: "d1", title: "D1", keyPoints: [] },
    ];

    const [outA, outB] = await Promise.all([
      Promise.resolve().then(() =>
        generateLayoutBatch(intentsA, [{ slideIntentId: "c2", layoutHint: "hero" }])
      ),
      Promise.resolve().then(() => generateLayoutBatch(intentsB, [])),
    ]);

    expect(outA[0].layoutHtml).toContain("layout-standard");
    expect(outA[1].layoutHtml).toContain("layout-hero");
    expect(outB[0].layoutHtml).toContain("layout-standard");

    const rapid = [];
    for (let i = 0; i < 3; i += 1) {
      rapid.push(generateLayoutBatch(intentsA, []));
    }
    expect(rapid[2][1].layoutHtml).toContain("layout-standard");
  });

  it("handles large batches without losing entries", () => {
    const intents = Array.from({ length: 300 }, (_, i) => ({
      slideIntentId: `s${i}`,
      title: `T${i}`,
      keyPoints: [],
    }));

    const out = generateLayoutBatch(intents, []);

    expect(out).toHaveLength(300);
    expect(out[0].layoutHtml).toContain("layout-standard");
    expect(out[299].layoutHtml).toContain('data-slide-id="ESC(s299)"');
  });
});
