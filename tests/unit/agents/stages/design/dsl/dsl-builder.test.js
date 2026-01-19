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

import { escapeHtml } from '../../../../../../js/agents/stages/design/shared/design-utils.js';
import { buildSlideHtml, buildFromLayoutJson } from '../../../../../../js/agents/stages/design/dsl/dsl-builder.js';

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

  it("buildSlideHtml extracts content.markdown and does not append claims when markdown is present", () => {
    const markdown = ["# Heading", "", "- Point A", "- Point B", "", "```js", "console.log(1)", "```"].join("\n");

    const html = buildSlideHtml(
      { pageType: "content", title: "Markdown", content: { markdown }, claimIds: ["c1"] },
      {},
      [{ claimId: "c1", text: "SHOULD_NOT_RENDER" }],
      []
    );

    // content.markdown branch should be used, and claims should NOT be appended.
    expect(html).toContain("• ESC(Point A)");
    expect(html).toContain("• ESC(Point B)");
    expect(html).not.toContain("SHOULD_NOT_RENDER");
  });

  it("buildSlideHtml cover without objective joins content lines with middle dots (markdown cleanup branch)", () => {
    buildSlideHtml(
      {
        pageType: "cover",
        title: "Cover",
        content: { markdown: ["# Title", "Alpha", "Beta", "```", "code", "```"].join("\n") },
      },
      {},
      [],
      []
    );

    // For cover without objective: toDisplayLines(...) -> join(" · ") path.
    expect(escapeHtml).toHaveBeenCalledWith("Alpha · Beta");
  });

  it("buildSlideHtml cover without objective falls back to a blank space when content is empty/null", () => {
    buildSlideHtml({ pageType: "cover", title: "Cover", content: null }, {}, [], []);

    // Join result is empty => " " fallback.
    expect(escapeHtml).toHaveBeenCalledWith(" ");
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

  it("buildSlideHtml uses agenda layout when safeMode is off", () => {
    const html = buildSlideHtml(
      { pageType: "agenda", title: "Agenda", content: "First\nSecond" },
      {},
      [],
      []
    );

    expect(html).toContain(`data-layout="ESC(agenda)"`);
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

  it("buildSlideHtml builds image placeholders for multiple purposes and filters invalid slots", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "Slots", content: "Body" },
      {},
      [],
      [],
      {
        slideNo: 1,
        imageSlotsForSlide: [
          { slotId: "hero1", purpose: "hero", aspectRatio: " " }, // aspectRatio whitespace => default 16:9
          { slotId: "ill1", purpose: "illustration", aspectRatio: "4:3" },
          { slotId: "icon1", purpose: "icon", aspectRatio: "1:1" },
          { slotId: "bg1", purpose: "background", aspectRatio: "16:9" },
          { slotId: " ", purpose: "icon" }, // invalid slotId => filtered out
        ],
      }
    );

    // slotId filtering
    expect(html).toContain(`data-slot-id="ESC(hero1)"`);
    expect(html).toContain(`data-slot-id="ESC(ill1)"`);
    expect(html).toContain(`data-slot-id="ESC(icon1)"`);
    expect(html).toContain(`data-slot-id="ESC(bg1)"`);
    expect(html).not.toContain(`data-slot-id="ESC()"`);

    // Placeholder boxes vary by purpose.
    expect(html).toContain(`data-x="0%"`); // hero/background
    expect(html).toContain(`data-w="100%"`);
    expect(html).toContain(`data-x="58%"`); // illustration
    expect(html).toContain(`data-y="26%"`);
    expect(html).toContain(`data-x="82%"`); // icon
    expect(html).toContain(`data-y="12%"`);

    // aspectRatio whitespace => defaults to 16:9
    expect(html).toContain(`data-aspect-ratio="ESC(16:9)"`);
  });

  it("buildSlideHtml uses default placeholder box when purpose is unknown", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "Slots", content: "Body" },
      {},
      [],
      [],
      { imageSlotsForSlide: [{ slotId: "u1", purpose: "photo" }] }
    );

    expect(html).toContain(`data-slot-id="ESC(u1)"`);
    expect(html).toContain(`data-x="8%"`);
    expect(html).toContain(`data-y="22%"`);
    expect(html).toContain(`data-w="84%"`);
    expect(html).toContain(`data-h="60%"`);
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

  it("buildFromLayoutJson parses text styles (bold string, invalid fontSize) and handles null/blank bounds", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "text",
            content: "Styled",
            bounds: { x: null, y: "", w: " ", h: null },
            style: { fontSize: "not-a-number", fontWeight: "bold", color: "" },
          },
        ],
      },
      {
        designTokens: {
          colors: { bg: "#fff", text: "#123456" },
          typography: { minFont: 12, bodyFont: 18 },
        },
      },
      { slideId: "s-style", title: "Style" }
    );

    // Null/blank bounds => coercePct(...) returns undefined => defaults applied.
    expect(html).toContain(`data-x="8%"`);
    expect(html).toContain(`data-y="8%"`);
    expect(html).toContain(`data-w="84%"`);

    // fontSize invalid => clampNum(...) fallback to typography.bodyFont.
    expect(html).toContain(`data-font="18"`);
    // fontWeight "bold" => bold=true; style.color "" => fallback to colors.text.
    expect(html).toContain(`data-bold="true"`);
    expect(html).toContain(`data-color="#123456"`);
  });

  it("buildFromLayoutJson uses shape style.color when fill is missing and omits radius attribute when radius=0", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "shape",
            bounds: { x: 0, y: 0, w: 20, h: 20 },
            style: { color: "#abcabc", radius: 0 },
          },
        ],
      },
      { designTokens: { colors: { bg: "#fff", border: "#BORDER", panel: "#PANEL" } } },
      { slideId: "s-shape2", title: "Shape2" }
    );

    expect(html).toContain(`data-el="shape"`);
    expect(html).toContain(`data-fill="#abcabc"`);
    expect(html).toContain(`data-stroke="#BORDER"`);
    // radius=0 => makeShapeEl(...) should not add data-radius at all.
    expect(html).not.toContain(`data-radius="`);
  });

  it("buildFromLayoutJson handles string table/chart content and applies chart defaults/colors when palette is missing", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "table", content: " [1, 2] ", bounds: { x: 0, y: 0, w: 50, h: 50 } },
          { type: "chart", content: " ", bounds: { x: 0, y: 50, w: 50, h: 50 } },
        ],
      },
      // Pass raw tokens (not nested under designTokens) to cover resolveDesignTokens(...) branch.
      { colors: { bg: "#fff", primary: "#P", accent: "#A", text: "#T" } },
      { slideId: "s-data", title: "Data" }
    );

    expect(html).toContain(`data-el="table"`);
    expect(html).toContain(`data-data='ESC([1, 2])'`);

    // chartType defaults to "bar"; empty/blank string content => "{}" default.
    expect(html).toContain(`data-el="chart"`);
    expect(html).toContain(`data-chart-type="ESC(bar)"`);
    expect(html).toContain(`data-chart-data="ESC({})"`);

    // With no extractedPalette, chart colors fall back to primary/accent/text.
    expect(html).toContain(`data-colors='ESC(["#P","#A","#T"])'`);
  });

  it("buildFromLayoutJson handles non-empty image src and table/chart defaults when content is missing", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          { type: "image", content: "https://example.com/a.png", bounds: { x: 0, y: 0, w: 10, h: 10 } },
          { type: "table", content: null, bounds: { x: 10, y: 0, w: 40, h: 20 } }, // content falsy => "[]"
          { type: "chart", content: null, bounds: { x: 0, y: 20, w: 50, h: 30 } }, // content falsy => "{}"
          { type: "chart", content: "foo", bounds: { x: 50, y: 20, w: 50, h: 30 } }, // non-empty string => "foo"
        ],
      },
      {},
      { slideId: "s-misc", title: "Misc" }
    );

    // Image src passes through when non-empty (no about:blank fallback).
    expect(html).toContain(`data-el="image"`);
    expect(html).toContain(`data-src="ESC(https://example.com/a.png)"`);

    // Table content falsy => default "[]".
    expect(html).toContain(`data-el="table"`);
    expect(html).toContain(`data-data='ESC([])'`);

    // Chart content falsy => default "{}", otherwise use trimmed string.
    expect(html).toContain(`data-chart-data="ESC({})"`);
    expect(html).toContain(`data-chart-data="ESC(foo)"`);
  });

  it("buildFromLayoutJson applies fallbacks when element content/style values are falsy (empty string, 0)", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "text",
            content: "",
            bounds: { x: 0, y: 0, w: 50, h: 10 },
            style: { fontSize: "NaN", fontWeight: 500 },
          },
          { type: "image", content: "", bounds: { x: 50, y: 0, w: 50, h: 10 } },
          { type: "table", content: null, bounds: { x: 0, y: 10, w: 100, h: 40 } },
        ],
      },
      {
        designTokens: {
          typography: { minFont: 10, bodyFont: 0, smallFont: 0 },
        },
      },
      { slideId: "s-falsy", title: "Falsy" }
    );

    // text: invalid fontSize + bodyFont=0 => fallback parameter uses 16.
    expect(html).toContain(`data-font="16"`);
    // text: empty string content => " " fallback.
    expect(html).toContain(`ESC( )`);

    // image: empty string content => about:blank fallback.
    expect(html).toContain(`data-src="ESC(about:blank)"`);

    // table: smallFont=0 + minFont=10 => font-size falls back to 12 (via `smallFont || 12`).
    expect(html).toContain(`data-font-size="12"`);
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
