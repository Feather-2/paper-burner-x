const test = require("node:test");
const assert = require("node:assert/strict");

const { analyzeImage, _internal: fromInternal } = require("../../js/ppt/vision/layout-from-image.js");
const { layoutToDsl, _internal: toInternal } = require("../../js/ppt/vision/layout-to-dsl.js");
const { htmlToDocument } = require("../../js/ppt/dsl/serialize.js");

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
      assert.equal(usage, "vision");
      assert.ok(String(prompt).includes("Return ONLY valid JSON"));
      assert.equal(images.length, 1);
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
  assert.equal(out.intent, "content_extract");
  assert.ok(out.analysis.includes("Found"));
  assert.equal(out.suggestedLayout, "content");
  assert.deepEqual(out.elements.map((e) => e.type), ["text", "table"]);
  assert.deepEqual(out.elements[0].bounds, { x: 3, y: 2, w: 98, h: 12 });
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
  assert.equal(out.intent, "style_reference");
  assert.equal(out.elements.length, 1);
  assert.deepEqual(out.elements[0].bounds, { x: 0, y: 100, w: 50, h: 10 });
});

test("vision->layout: returns minimal fallback when no provider", async () => {
  const out = await analyzeImage("data:image/png;base64,xxx", { intentHint: "modify_element" });
  assert.equal(out.intent, "modify_element");
  assert.equal(out.elements[0].type, "text");
  assert.ok(out.analysis.toLowerCase().includes("fallback"));
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

  assert.ok(html.includes('data-type="freeform"'));
  assert.ok(html.includes('data-x="5%"'));
  assert.ok(html.includes('data-y="5%"'));
  assert.ok(html.includes('data-w="90%"')); // 100 - margin(5) - x(5)
  assert.ok(html.includes('data-font="80"')); // clamped
  assert.ok(html.includes('data-color="#FF0000"'));

  const doc = muteConsole(() => htmlToDocument(html));
  const slides = doc.slides || doc.getSlides();
  assert.equal(slides.length, 1);
  assert.equal(slides[0].elements.length, 2);
  assert.equal(slides[0].elements[0].x, "5%");
  assert.equal(slides[0].elements[0].font, 80);
});

test("layout->dsl: generates safe slide when validation fails (empty elements)", () => {
  const html = muteConsole(() => layoutToDsl({ intent: "layout_reference", analysis: "x", elements: [] }, null));
  assert.ok(html.includes('id="slide-safe"'));
  assert.ok(html.includes('data-el="text"'));
  assert.ok(html.includes('data-bold="true"'));

  const doc = muteConsole(() => htmlToDocument(html));
  const slides = doc.slides || doc.getSlides();
  assert.equal(slides.length, 1);
  assert.equal(slides[0].elements.length, 1);
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
    assert.equal(slides.length, 1);
    assert.equal(slides[0].elements[0].content.trim(), intent);
  }
});

test("layout->dsl: normalizeColor accepts hex3, hex8, rgb and falls back", () => {
  assert.equal(toInternal.normalizeColor("#abc", "#000000"), "#AABBCC");
  assert.equal(toInternal.normalizeColor("#11223344", "#000000"), "#112233".toUpperCase());
  assert.equal(toInternal.normalizeColor("rgb(255, 0, 16)", "#000000"), "#FF0010");
  assert.equal(toInternal.normalizeColor("not-a-color", "#010203"), "#010203");
});

test("layout->dsl: enforceMargins ensures 5% padding", () => {
  assert.deepEqual(toInternal.enforceMargins({ x: 0, y: 0, w: 100, h: 100 }, 5), { x: 5, y: 5, w: 90, h: 90 });
});

test("vision->layout: parseJsonFromModelText returns null for non-JSON", () => {
  assert.equal(fromInternal.parseJsonFromModelText("nope"), null);
});

