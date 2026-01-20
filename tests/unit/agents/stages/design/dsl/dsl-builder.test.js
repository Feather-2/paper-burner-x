import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../js/agents/stages/design/constants.js", () => ({
  VisualDataStatus: {
    PENDING: "PENDING",
  },
}));

vi.mock("../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  escapeHtml: vi.fn((value) => `ESC(${String(value)})`),
}));

import { escapeHtml } from "../../../../../../js/agents/stages/design/shared/design-utils.js";
import { buildSlideHtml, buildFromLayoutJson } from "../../../../../../js/agents/stages/design/dsl/dsl-builder.js";

const makeDeepObject = (depth) => {
  const root = { level: 0 };
  let node = root;
  for (let i = 1; i <= depth; i += 1) {
    node.child = { level: i };
    node = node.child;
  }
  return root;
};

describe("buildSlideHtml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds cover slide with content package call form and image placeholders", () => {
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

    expect(html).toContain('data-layout="ESC(cover)"');
    expect(html).toContain('id="ESC(slide-2)"');
    expect(html).toContain('data-title="ESC(My Title)"');
    expect(html).toContain('data-bg="#fafafa"');
    expect(html).toContain('data-el="image-placeholder"');
    expect(html).toContain('data-slot-id="ESC(img1)"');
    expect(html).toContain('data-status="PENDING"');
    expect(html).toContain('data-aspect-ratio="1:1"');
    expect(html).toContain('data-x="0%"');
    expect(html).toContain('data-y="0%"');
    expect(html).toContain('data-w="100%"');
    expect(html).toContain('data-h="100%"');
    expect(html).toContain("ESC(Objective line)");

    expect(escapeHtml).toHaveBeenCalled();
  });

  it("prefers content.markdown and does not append claims", () => {
    const markdown = ["# Heading", "", "- Point A", "- Point B", "", "```js", "console.log(1)", "```"].join("\n");

    const html = buildSlideHtml(
      { pageType: "content", title: "Markdown", content: { markdown }, claimIds: ["c1"] },
      {},
      [{ claimId: "c1", text: "SHOULD_NOT_RENDER" }],
      []
    );

    expect(html).toContain("• ESC(Point A)");
    expect(html).toContain("• ESC(Point B)");
    expect(html).not.toContain("SHOULD_NOT_RENDER");
  });

  it("appends claims when content is empty and claimIds match", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "Claims", content: "", claimIds: ["c1", "c2"] },
      {},
      [
        { claimId: "c1", text: "Claim 1" },
        { claimId: "c2", text: "Claim 2" },
      ],
      []
    );

    expect(html).toContain("• ESC(Claim 1)");
    expect(html).toContain("• ESC(Claim 2)");
  });

  it("cover without objective joins lines and falls back to a blank space", () => {
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

    expect(escapeHtml).toHaveBeenCalledWith("Alpha · Beta");

    buildSlideHtml({ pageType: "cover", title: "Cover", content: null }, {}, [], []);
    expect(escapeHtml).toHaveBeenCalledWith(" ");
  });

  it("formats agenda with numbering and respects safeMode layout override", () => {
    const html = buildSlideHtml(
      { slideIntentId: "s2", pageType: "agenda", title: "Agenda", content: "First\nSecond" },
      {},
      { claims: [], evidenceLedger: [] },
      { safeMode: true, slideNo: 1 }
    );

    expect(html).toContain('data-layout="ESC(safe)"');
    expect(html).toContain("01  ESC(First)");
    expect(html).toContain("02  ESC(Second)");
  });

  it("renders appendix evidences and uses blank fallback when empty", () => {
    const appendix = buildSlideHtml(
      { pageType: "appendix", title: "Refs" },
      {},
      [],
      [{ evidenceId: "e1", quote: "Q1" }]
    );
    expect(appendix).toContain("• [ESC(e1)] ESC(Q1)");

    const empty = buildSlideHtml({ pageType: "appendix", title: "Refs" }, {}, [], []);
    expect(empty).toContain("ESC( )");
  });

  it("splits comparison hints into two columns and handles empty content", () => {
    const comparison = buildSlideHtml(
      { pageType: "comparison", title: "Compare", content: "A\nB\nC" },
      {},
      [],
      []
    );

    expect(comparison).toContain("Option A");
    expect(comparison).toContain("Option B");
    expect(comparison).toContain("• ESC(A)");
    expect(comparison).toContain("• ESC(C)");
    expect(comparison).toContain("• ESC(B)");

    const empty = buildSlideHtml({ pageType: "comparison", title: "Compare", content: "   " }, {}, [], []);
    expect(empty).toContain("Option A");
    expect(empty).toContain("Option B");
  });

  it("filters invalid image slots and defaults aspect ratio and placeholder box", () => {
    const html = buildSlideHtml(
      { pageType: "content", title: "Slots", content: "Body" },
      {},
      [],
      [],
      {
        imageSlotsForSlide: [
          { slotId: "slot1", purpose: "photo", aspectRatio: " " },
          { slotId: "slot2", purpose: "icon", aspectRatio: "bad" },
          { slotId: " ", purpose: "hero", aspectRatio: "1:1" },
        ],
      }
    );

    expect(html).toContain('data-slot-id="ESC(slot1)"');
    expect(html).toContain('data-slot-id="ESC(slot2)"');
    expect(html).not.toContain('data-slot-id="ESC()"');
    expect(html).toContain('data-aspect-ratio="16:9"');
    expect(html).toContain('data-y="22%"');
    expect(html).toContain('data-h="60%"');
    expect(html).toContain('data-x="82%"');
    expect(html).toContain('data-y="12%"');
  });

  it("uses default titles for missing title values", () => {
    const cover = buildSlideHtml({ pageType: "cover" }, {}, [], []);
    expect(cover).toContain('data-title="ESC(Presentation)"');

    const content = buildSlideHtml({ pageType: "content" }, {}, [], []);
    expect(content).toContain('data-title="ESC(Untitled)"');
  });

  it("sanitizes invalid colors and clamps fonts to safe ranges", () => {
    const html = buildSlideHtml(
      { pageType: "cover", title: "Clamp", objective: "Obj" },
      {
        designTokens: {
          colors: { bg: "javascript:alert(1)", text: "<bad>", muted: "rgb(0,0,0)", panel: "#fff", border: "#ccc" },
          typography: { minFont: Number.MAX_SAFE_INTEGER },
        },
      },
      [],
      []
    );

    expect(html).toContain('data-bg="#ffffff"');
    expect(html).toContain('data-color="#000000"');
    expect(html).toContain('data-font="200"');
  });

  it("handles slideNo boundary values and string slideNo", () => {
    const baseIntent = { slideIntentId: "s1", pageType: "content", title: "T", content: "Body" };

    const zero = buildSlideHtml(baseIntent, {}, [], [], { slideNo: 0 });
    expect(zero).toContain('id="ESC(slide-s1)"');

    const negative = buildSlideHtml(baseIntent, {}, [], [], { slideNo: -1 });
    expect(negative).toContain('id="ESC(slide--1)"');

    const max = buildSlideHtml(baseIntent, {}, [], [], { slideNo: Number.MAX_SAFE_INTEGER });
    expect(max).toContain(`id="ESC(slide-${Number.MAX_SAFE_INTEGER})"`);

    const stringNo = buildSlideHtml({ ...baseIntent, slideIntentId: "s2" }, {}, [], [], { slideNo: "3" });
    expect(stringNo).toContain('id="ESC(slide-s2)"');
  });

  it("handles null/undefined inputs, empty objects, and non-array claims/evidences", () => {
    const html = buildSlideHtml(null, undefined, { not: "array" }, { not: "array" });

    expect(html).toContain('data-layout="ESC(content)"');
    expect(html).toContain('data-title="ESC(Untitled)"');
  });

  it("limits keyPoints to 8 non-empty lines and ignores blanks", () => {
    const keyPoints = [
      "Point 1",
      "",
      "Point 2",
      "Point 3",
      "",
      "Point 4",
      "Point 5",
      "Point 6",
      "Point 7",
      "Point 8",
      "Point 9",
      "Point 10",
    ];
    const html = buildSlideHtml({ pageType: "content", title: "KP", keyPoints }, {}, [], []);

    expect(html).toContain("• ESC(Point 1)");
    expect(html).toContain("• ESC(Point 8)");
    expect(html).not.toContain("Point 9");
  });

  it("handles a large markdown input without errors", () => {
    const longMarkdown = Array.from({ length: 500 }, (_, i) => `- Item ${i + 1}`).join("\n");
    const html = buildSlideHtml({ pageType: "content", title: "Big", content: { markdown: longMarkdown } }, {}, [], []);

    expect(html).toContain("• ESC(Item 1)");
  });

  it("handles a very long single-line content string", () => {
    const longLine = "L".repeat(2000);
    const html = buildSlideHtml({ pageType: "content", title: "Long", content: longLine }, {}, [], []);

    expect(html).toContain(longLine.slice(0, 50));
  });

  it("supports concurrent calls without shared state", async () => {
    const intents = Array.from({ length: 5 }, (_, i) => ({
      slideIntentId: `s${i + 1}`,
      pageType: "content",
      title: `T${i + 1}`,
      content: `Body ${i + 1}`,
    }));

    const outputs = await Promise.all(
      intents.map((intent, i) => Promise.resolve(buildSlideHtml(intent, {}, [], [], { slideNo: i + 1 })))
    );

    outputs.forEach((html, i) => {
      expect(html).toContain(`id="ESC(slide-${i + 1})"`);
      expect(html).toContain(`ESC(Body ${i + 1})`);
    });
  });
});

describe("buildFromLayoutJson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns safe layout when safeMode is true", () => {
    const html = buildFromLayoutJson(
      { elements: [{ type: "text", content: "Ignored", bounds: { x: 10, y: 10, w: 80, h: 10 } }] },
      {},
      { slideId: "s-safe", title: "Safe", safeMode: true }
    );

    expect(html).toContain('data-layout="safe"');
    expect(html).toContain('id="ESC(s-safe)"');
    expect(html).toContain('data-title="ESC(Safe)"');
  });

  it("returns safe layout when elements are missing or invalid", () => {
    const fromNull = buildFromLayoutJson(null, {}, {});
    expect(fromNull).toContain('data-layout="safe"');
    expect(fromNull).toContain('id="ESC(slide-vision)"');
    expect(fromNull).toContain('data-title="ESC(Untitled)"');

    const fromObject = buildFromLayoutJson({ elements: {} }, {}, {});
    expect(fromObject).toContain('data-layout="safe"');
  });

  it("uses first text element as title and maps suggested layout", () => {
    const html = buildFromLayoutJson(
      {
        suggestedLayout: "comparison",
        elements: [{ type: "text", content: "Title From Text", bounds: { x: 0, y: 0, w: 100, h: 20 } }],
      },
      {},
      { slideId: "s-title" }
    );

    expect(html).toContain('data-layout="ESC(two_column)"');
    expect(html).toContain('id="ESC(s-title)"');
    expect(html).toContain('data-title="ESC(Title From Text)"');
  });

  it("builds text element with coerced bounds and numeric string font values", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "text",
            content: "Hello",
            bounds: { x: -1, y: "20", w: 30, h: 40 },
            style: { fontSize: "72", color: "#333333", fontWeight: "700" },
          },
        ],
      },
      {},
      { slideId: "s-text" }
    );

    expect(html).toContain('data-el="text"');
    expect(html).toContain('data-x="-1%"');
    expect(html).toContain('data-y="20%"');
    expect(html).toContain('data-w="30%"');
    expect(html).toContain('data-h="auto"');
    expect(html).toContain('data-font="72"');
    expect(html).toContain('data-color="#333333"');
    expect(html).toContain('data-bold="true"');
    expect(html).toContain("ESC(Hello)");
  });

  it("sanitizes invalid bounds, colors, and font size", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "text",
            content: "Bad",
            bounds: { x: "bad", y: " ", w: null, h: undefined },
            style: { fontSize: -1, fontWeight: "bold", color: "<bad>" },
          },
        ],
      },
      { designTokens: { typography: { bodyFont: 18 } } },
      { slideId: "s-bad" }
    );

    expect(html).toContain('data-x="0%"');
    expect(html).toContain('data-y="8%"');
    expect(html).toContain('data-w="84%"');
    expect(html).toContain('data-font="12"');
    expect(html).toContain('data-bold="true"');
    expect(html).toContain('data-color="#000000"');
  });

  it("builds shape element with color fallback and omits radius when zero", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "shape",
            bounds: { x: 0, y: 0, w: 20, h: 20 },
            style: { color: "<bad>", radius: 0 },
          },
        ],
      },
      { designTokens: { colors: { border: "<border>", panel: "#eeeeee" } } },
      { slideId: "s-shape" }
    );

    expect(html).toContain('data-el="shape"');
    expect(html).toContain('data-fill="#ffffff"');
    expect(html).toContain('data-stroke="#000000"');
    expect(html).not.toContain('data-radius="');
  });

  it("builds image element with about:blank and sanitizes invalid bounds", () => {
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "image",
            content: " ",
            bounds: { x: "bad", y: 0, w: " ", h: 20 },
          },
        ],
      },
      {},
      { slideId: "s-img" }
    );

    expect(html).toContain('data-el="image"');
    expect(html).toContain('data-src="ESC(about:blank)"');
    expect(html).toContain('data-x="0%"');
    expect(html).toContain('data-y="0%"');
    expect(html).toContain('data-w="84%"');
  });

  it("serializes deep table content and clamps font size", () => {
    const deep = makeDeepObject(30);
    const html = buildFromLayoutJson(
      {
        elements: [
          {
            type: "table",
            content: deep,
            bounds: { x: 1, y: 2, w: 3, h: 4 },
          },
        ],
      },
      { designTokens: { typography: { minFont: 1000, smallFont: 500 } } },
      { slideId: "s-table" }
    );

    expect(html).toContain('data-el="table"');
    expect(html).toContain('data-font-size="72"');
    expect(html).toContain('data-data=\'ESC({');
    expect(html).toContain('"level":0');
  });

  it("handles chart defaults, circular content fallback, and palette fallbacks", () => {
    const circular = {};
    circular.self = circular;

    const html = buildFromLayoutJson(
      {
        extractedPalette: ["", " "],
        elements: [
          {
            type: "chart",
            chartType: "unknown",
            content: circular,
            bounds: { x: 0, y: 0, w: 50, h: 50 },
          },
        ],
      },
      { designTokens: { colors: { primary: "#P", accent: "#A", text: "#T" } } },
      { slideId: "s-chart" }
    );

    expect(html).toContain('data-el="chart"');
    expect(html).toContain('data-chart-type="bar"');
    expect(html).toContain('data-chart-data="ESC({})"');
    expect(html).toContain('data-colors=\'ESC(["#P","#A","#T"])\'');
  });

  it("supports rapid sequential calls without shared state", () => {
    const outputs = [];
    for (let i = 0; i < 10; i += 1) {
      outputs.push(
        buildFromLayoutJson(
          { elements: [{ type: "text", content: `Title ${i}`, bounds: { x: 0, y: 0, w: 100, h: 10 } }] },
          {},
          { slideId: `slide-${i}` }
        )
      );
    }

    outputs.forEach((html, i) => {
      expect(html).toContain(`id="ESC(slide-${i})"`);
      expect(html).toContain(`ESC(Title ${i})`);
    });
  });
});
