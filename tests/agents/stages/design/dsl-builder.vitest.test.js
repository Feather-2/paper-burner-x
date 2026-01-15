import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit-scope: mock external deps so we only test the DSL builder logic.
vi.mock("../../../../js/agents/stages/design/constants.js", () => {
  return {
    VisualDataStatus: {
      PENDING: "PENDING",
    },
  };
});

vi.mock("../../../../js/agents/stages/design/shared/design-utils.js", () => {
  return {
    escapeHtml: vi.fn((value) => `ESC(${String(value)})`),
  };
});

import { escapeHtml } from "../../../../js/agents/stages/design/shared/design-utils.js";
import { buildSlideHtml, buildFromLayoutJson } from "../../../../js/agents/stages/design/dsl/dsl-builder.js";

describe("design/dsl/dsl-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildSlideHtml supports ContentPackage + options call form and builds cover slide w/ image placeholders", () => {
    const slideIntent = {
      slideIntentId: "s1",
      pageType: "cover",
      title: "My Title",
      objective: "Objective line",
    };
    const designSystem = {
      designTokens: {
        colors: { bg: "#fafafa", text: "#111111", muted: "#333333", panel: "#ffffff", border: "#dddddd" },
        typography: { minFont: 10, titleFont: 44, subtitleFont: 18, bodyFont: 16 },
      },
    };
    const contentPackage = { claims: [], evidenceLedger: [] };

    const html = buildSlideHtml(slideIntent, designSystem, contentPackage, {
      slideNo: 2,
      imageSlotsForSlide: [{ slotId: "img1", purpose: "hero", aspectRatio: "1:1" }],
    });

    expect(html).toContain(`data-layout="ESC(cover)"`);
    expect(html).toContain(`id="ESC(slide-2)"`);
    expect(html).toContain(`data-title="ESC(My Title)"`);
    expect(html).toContain(`data-bg="#fafafa"`);
    expect(html).toContain(`data-el="image-placeholder"`);
    expect(html).toContain(`data-slot-id="ESC(img1)"`);
    expect(html).toContain(`data-status="PENDING"`);
    expect(html).toContain(`data-aspect-ratio="ESC(1:1)"`);
    expect(html).toContain(`data-x="0%"`);
    expect(html).toContain(`data-y="0%"`);
    expect(html).toContain(`data-w="100%"`);
    expect(html).toContain(`data-h="100%"`);
    expect(html).toContain(`ESC(Objective line)`);

    // Escaping should be applied consistently to ids/titles/etc.
    expect(escapeHtml).toHaveBeenCalled();
  });

  it("buildSlideHtml uses safeMode layout when requested and formats agenda bullets", () => {
    const slideIntent = {
      slideIntentId: "s2",
      pageType: "agenda",
      title: "Agenda",
      content: "First\nSecond",
    };

    const html = buildSlideHtml(slideIntent, {}, { claims: [], evidenceLedger: [] }, { safeMode: true, slideNo: 1 });

    expect(html).toContain(`data-layout="ESC(safe)"`);
    expect(html).toContain(`01  ESC(First)`);
    expect(html).toContain(`02  ESC(Second)`);
  });

  it("buildSlideHtml handles appendix evidences and comparison layout formatting", () => {
    const appendix = buildSlideHtml(
      { pageType: "appendix", title: "Refs" },
      {},
      [],
      [{ evidenceId: "e1", quote: "Q1" }]
    );

    expect(appendix).toContain(`• [ESC(e1)] ESC(Q1)`);

    const comparison = buildSlideHtml(
      { pageType: "comparison", title: "Compare", content: "A\nB\nC\nD" },
      {},
      [],
      []
    );

    expect(comparison).toContain("Option A");
    expect(comparison).toContain("Option B");
    expect(comparison).toContain("• ESC(A)");
    expect(comparison).toContain("• ESC(B)");
  });

  it("buildSlideHtml falls back to claims when slideIntent content is empty (edge case)", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "T", claimIds: ["c1"] },
      {},
      [{ claimId: "c1", text: "Claim text" }],
      []
    );
    expect(html).toContain("• ESC(Claim text)");
  });

  it("buildFromLayoutJson returns safe layout when safeMode=true or elements missing", () => {
    const safe = buildFromLayoutJson({ elements: [] }, {}, { slideId: "s", title: "T", safeMode: true });
    expect(safe).toContain(`data-layout="safe"`);
    expect(safe).toContain(`id="ESC(s)"`);
    expect(safe).toContain(`data-title="ESC(T)"`);

    const emptyEls = buildFromLayoutJson({ elements: [] }, {}, { slideId: "s2", title: "T2" });
    expect(emptyEls).toContain(`data-layout="safe"`);
    expect(emptyEls).toContain(`data-title="ESC(T2)"`);
  });

  it("buildFromLayoutJson builds supported element types with bounds coercion/clamping", () => {
    const html = buildFromLayoutJson(
      {
        suggestedLayout: "comparison",
        extractedPalette: ["#111111", "#222222"],
        elements: [
          {
            type: "text",
            content: "Hello",
            bounds: { x: 10, y: "20", w: 30, h: 40 },
            style: { fontSize: 14, color: "#333333", fontWeight: 700 },
          },
          {
            type: "shape",
            bounds: { x: "5%", y: "6%", w: "7%", h: "8%" },
            style: { fill: "#ffffff", stroke: "#000000", radius: 100 },
          },
          { type: "image", content: " ", bounds: { x: 0, y: 0, w: 100, h: 50 } },
          { type: "table", content: { rows: [1] }, bounds: { x: 1, y: 2, w: 3, h: 4 } },
          { type: "chart", chartType: "pie", content: { a: 1 }, bounds: { x: "9", y: "10", w: "11", h: "12" } },
          { type: "unknown" },
        ],
      },
      { designTokens: { colors: { bg: "#fff", primary: "#0ea5e9", accent: "#22c55e", text: "#111", panel: "#fff", border: "#eee" } } },
      { slideId: "slide-x", title: "My" }
    );

    // suggestedLayout "comparison" -> layoutFromPageType => "two_column"
    expect(html).toContain(`data-layout="ESC(two_column)"`);
    expect(html).toContain(`id="ESC(slide-x)"`);
    expect(html).toContain(`data-title="ESC(My)"`);

    // Text element bounds coerced to percent and bold detected.
    expect(html).toContain(`data-el="text"`);
    expect(html).toContain(`data-x="10%"`);
    expect(html).toContain(`data-y="20%"`);
    expect(html).toContain(`data-w="30%"`);
    expect(html).toContain(`data-h="auto"`);
    expect(html).toContain(`data-bold="true"`);
    expect(html).toContain(`ESC(Hello)`);

    // Shape radius clamped to max=64.
    expect(html).toContain(`data-el="shape"`);
    expect(html).toContain(`data-radius="64"`);

    // Image empty content => about:blank.
    expect(html).toContain(`data-el="image"`);
    expect(html).toContain(`data-src="ESC(about:blank)"`);

    // Table content object => JSON stringified + escaped.
    expect(html).toContain(`data-el="table"`);
    expect(html).toContain(`data-data='ESC({"rows":[1]})'`);

    // Chart colors come from extractedPalette.
    expect(html).toContain(`data-el="chart"`);
    expect(html).toContain(`data-chart-type="ESC(pie)"`);
    expect(html).toContain(`data-colors='ESC(["#111111","#222222"])'`);
  });

  it("buildSlideHtml handles summary pageType with bullet content", () => {
    const html = buildSlideHtml(
      { pageType: "summary", title: "Key Takeaways", content: "Point A\nPoint B\nPoint C" },
      {},
      [],
      []
    );
    expect(html).toContain(`data-layout="ESC(summary)"`);
    expect(html).toContain("• ESC(Point A)");
    expect(html).toContain("• ESC(Point B)");
  });

  it("buildSlideHtml handles process pageType with numbered steps", () => {
    const html = buildSlideHtml(
      { pageType: "process", title: "Steps", content: "Step1\nStep2\nStep3" },
      {},
      [],
      []
    );
    expect(html).toContain(`data-layout="ESC(process)"`);
  });

  it("buildSlideHtml uses default title when title is missing", () => {
    const html = buildSlideHtml(
      { pageType: "content" },
      {},
      [],
      []
    );
    expect(html).toContain("data-title=");
  });

  it("buildSlideHtml handles array content by joining elements", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "List", content: "Item 1\nItem 2" },
      {},
      [],
      []
    );
    expect(html).toContain("ESC(Item 1)");
    expect(html).toContain("ESC(Item 2)");
  });

  it("buildSlideHtml handles empty content gracefully", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "Empty", content: "" },
      {},
      [],
      []
    );
    expect(html).toContain(`data-layout="ESC(content)"`);
  });

  it("buildFromLayoutJson filters out unsupported element types", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "line", bounds: { x: 0, y: 50, w: 100, h: 1 } },
          { type: "svg", content: "<svg></svg>", bounds: { x: 10, y: 10, w: 50, h: 50 } },
          { type: "icon", content: "check", bounds: { x: 5, y: 5, w: 10, h: 10 } },
          { type: "text", content: "Supported", bounds: { x: 0, y: 0, w: 100, h: 20 } },
        ],
      },
      {},
      { slideId: "s-mixed", title: "Mixed" }
    );
    // Unsupported types are filtered out
    expect(html).not.toContain(`data-el="line"`);
    expect(html).not.toContain(`data-el="svg"`);
    expect(html).not.toContain(`data-el="icon"`);
    // Supported type remains
    expect(html).toContain(`data-el="text"`);
    expect(html).toContain("ESC(Supported)");
  });

  it("buildFromLayoutJson applies default bounds when missing", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "text", content: "No bounds" },
        ],
      },
      {},
      { slideId: "s-def", title: "Defaults" }
    );
    expect(html).toContain(`data-el="text"`);
    expect(html).toContain("ESC(No bounds)");
  });

  it("buildFromLayoutJson handles missing extractedPalette for chart", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "chart", chartType: "bar", content: { values: [1, 2] }, bounds: { x: 0, y: 0, w: 50, h: 50 } },
        ],
      },
      { designTokens: { colors: { primary: "#blue", accent: "#green" } } },
      { slideId: "s-chart", title: "Chart" }
    );
    expect(html).toContain(`data-el="chart"`);
    expect(html).toContain(`data-chart-type="ESC(bar)"`);
  });

  it("buildFromLayoutJson handles text element without style", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "text", content: "Plain text", bounds: { x: 0, y: 0, w: 100, h: 20 } },
        ],
      },
      {},
      { slideId: "s-plain", title: "Plain" }
    );
    expect(html).toContain(`data-el="text"`);
    expect(html).not.toContain(`data-bold="true"`);
  });

  it("buildFromLayoutJson handles shape with default style", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "shape", bounds: { x: 0, y: 0, w: 20, h: 20 } },
        ],
      },
      {},
      { slideId: "s-shape", title: "Shape" }
    );
    expect(html).toContain(`data-el="shape"`);
  });

  it("buildSlideHtml handles divider pageType", () => {
    const html = buildSlideHtml(
      { pageType: "divider", title: "Section Break" },
      {},
      [],
      []
    );
    expect(html).toContain("data-layout=");
    expect(html).toContain("ESC(Section Break)");
  });

  it("buildSlideHtml handles quote pageType", () => {
    const html = buildSlideHtml(
      { pageType: "quote", title: "Quote", content: "To be or not to be" },
      {},
      [],
      []
    );
    expect(html).toContain("ESC(To be or not to be)");
  });
});
