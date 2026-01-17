import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

let analyzeImage, fromInternal, layoutToDsl, toInternal, htmlToDocument;

beforeEach(async () => {
  const layoutFromImage = await import("../../js/ppt/vision/layout-from-image.js");
  analyzeImage = layoutFromImage.analyzeImage;
  fromInternal = layoutFromImage._internal;
  const layoutToDslMod = await import("../../js/ppt/vision/layout-to-dsl.js");
  layoutToDsl = layoutToDslMod.layoutToDsl;
  toInternal = layoutToDslMod._internal;
  const serialize = await import("../../js/ppt/dsl/serialize.js");
  htmlToDocument = serialize.htmlToDocument;
});

function muteConsole(fn) {
  const prev = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = prev;
  }
}

test("vision->layout: parses fenced JSON and normalizes schema", async () => {
  const modelRouter = {
    call: async (prompt, { usage, images }) => {
      expect(usage).toBe("vision");
      expect(String(prompt).includes("Return ONLY valid JSON")).toBeTruthy();
      expect(images.length).toBe(1);
      return {
        content:
          "```json\n" +
          JSON.stringify({
            intent: "content_extract",
            analysis: "Found a title and a table.",
            extractedPalette: ["#112233", "rgb(255,0,0)"],
            suggestedLayout: "content",
            elements: [
              { type: "text", bounds: { x: 3, y: 2, w: 98, h: 12 }, content: "Demo", style: { fontSize: 88, color: "#f00", fontWeight: "700" } },
              { type: "table", bounds: { x: 5, y: 30, w: 90, h: 40 }, content: [["A", "B"], ["1", "2"]] },
              { type: "unknown", bounds: { x: 0, y: 0, w: 1, h: 1 } },
            ],
          }) +
          "\n```",
      };
    },
  };

  const out = await analyzeImage("data:image/png;base64,xxx", { modelRouter, intentHint: "content_extract" });
  expect(out.intent).toBe("content_extract");
  expect(out.analysis.includes("Found")).toBeTruthy();
  expect(out.suggestedLayout).toBe("content");
  expect(out.elements.map((e) => e.type)).toEqual(["text", "table"]);
  expect(out.elements[0].bounds).toEqual({ x: 3, y: 2, w: 98, h: 12 });
});

test("vision->layout: parses embedded JSON with surrounding text", async () => {
  const modelRouter = {
    call: async () => ({
      content:
        "Sure, here is the JSON:\n" +
        JSON.stringify({
          intent: "style_reference",
          analysis: "Dark theme.",
          elements: [{ type: "shape", bounds: { x: -10, y: 200, w: 50, h: 10 }, style: { color: "rgba(0,0,0,0.5)" } }],
        }) +
        "\n(end)",
    }),
  };
  const out = await analyzeImage("data:image/png;base64,xxx", { modelRouter, intentHint: "style_reference" });
  expect(out.intent).toBe("style_reference");
  expect(out.elements.length).toBe(1);
  expect(out.elements[0].bounds).toEqual({ x: 0, y: 100, w: 50, h: 10 });
});

test("vision->layout: returns minimal fallback when no provider", async () => {
  const out = await analyzeImage("data:image/png;base64,xxx", { intentHint: "modify_element" });
  expect(out.intent).toBe("modify_element");
  expect(out.elements[0].type).toBe("text");
  expect(out.analysis.toLowerCase().includes("fallback")).toBeTruthy();
});

test("layout->dsl: clamps coords, margins, font sizes, and colors", () => {
  const layoutJson = {
    intent: "layout_reference",
    analysis: "test",
    extractedPalette: ["#abc", "rgba(255,0,0,0.2)"],
    elements: [
      { type: "text", bounds: { x: 0, y: 0, w: 98, h: 12 }, content: "Hello", style: { fontSize: 100, color: "rgb(255,0,0)", fontWeight: "700" } },
      { type: "shape", bounds: { x: 4, y: 20, w: 96, h: 10 }, style: { color: "#f00" } },
    ],
  };

  const html = muteConsole(() => layoutToDsl(layoutJson, { designTokens: { colors: { bg: "#ffffff", text: "#0f172a", panel: "#ffffff", border: "#e2e8f0", primary: "#0ea5e9" } } }));

  expect(html.includes('data-type="freeform"')).toBeTruthy();
  expect(html.includes('data-x="5%"')).toBeTruthy();
  expect(html.includes('data-y="5%"')).toBeTruthy();
  expect(html.includes('data-w="90%"')).toBeTruthy(); // 100 - margin(5) - x(5)
  expect(html.includes('data-font="80"')).toBeTruthy(); // clamped
  expect(html.includes('data-color="#FF0000"')).toBeTruthy();

  const doc = muteConsole(() => htmlToDocument(html));
  const slides = doc.slides || doc.getSlides();
  expect(slides.length).toBe(1);
  expect(slides[0].elements.length).toBe(2);
  expect(slides[0].elements[0].x).toBe("5%");
  expect(slides[0].elements[0].font).toBe(80);
});

test("layout->dsl: generates safe slide when validation fails (empty elements)", () => {
  const html = muteConsole(() => layoutToDsl({ intent: "layout_reference", analysis: "x", elements: [] }, null));
  expect(html.includes('id="slide-safe"')).toBeTruthy();
  expect(html.includes('data-el="text"')).toBeTruthy();
  expect(html.includes('data-bold="true"')).toBeTruthy();

  const doc = muteConsole(() => htmlToDocument(html));
  const slides = doc.slides || doc.getSlides();
  expect(slides.length).toBe(1);
  expect(slides[0].elements.length).toBe(1);
});

test("layout->dsl: supports all intents", () => {
  const intents = ["layout_reference", "content_extract", "style_reference", "modify_element"];
  for (const intent of intents) {
    const html = muteConsole(() =>
      layoutToDsl(
        { intent, analysis: "x", elements: [{ type: "text", bounds: { x: 10, y: 10, w: 80, h: 10 }, content: intent, style: { fontSize: 16, color: "#112233" } }] },
        null
      )
    );
    const doc = muteConsole(() => htmlToDocument(html));
    const slides = doc.slides || doc.getSlides();
    expect(slides.length).toBe(1);
    expect(slides[0].elements[0].content.trim()).toBe(intent);
  }
});

test("layout->dsl: normalizeColor accepts hex3, hex8, rgb and falls back", () => {
  expect(toInternal.normalizeColor("#abc", "#000000")).toBe("#AABBCC");
  expect(toInternal.normalizeColor("#11223344", "#000000")).toBe("#112233".toUpperCase());
  expect(toInternal.normalizeColor("rgb(255, 0, 16)", "#000000")).toBe("#FF0010");
  expect(toInternal.normalizeColor("not-a-color", "#010203")).toBe("#010203");
});

test("layout->dsl: enforceMargins ensures 5% padding", () => {
  expect(toInternal.enforceMargins({ x: 0, y: 0, w: 100, h: 100 }, 5)).toEqual({ x: 5, y: 5, w: 90, h: 90 });
});

test("vision->layout: parseJsonFromModelText returns null for non-JSON", () => {
  expect(fromInternal.parseJsonFromModelText("nope")).toBe(null);
});
