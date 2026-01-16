import { describe, it, expect, beforeEach, afterEach } from "vitest";

async function loadTools() {
  return import("../../../js/agents/stages/design/refiner/react-refiner-tools.js");
}

function makeDeckHtmlDsl() {
  return [
    `<section data-title="A"><h1 data-el="title1" id="t1">Hello</h1><div data-el="box1" class="c1"></div></section>`,
    `<section data-title="B"><p data-el="p1">World</p></section>`,
  ].join("\n\n");
}

it("ReactRefiner Tools: parseSections/joinSections roundtrip consistency", async () => {
  const { parseSections, joinSections } = await loadTools();

  const s1 = `<section data-title="A"><div data-el="x1">X</div></section>`;
  const s2 = `<section data-title="B"><div data-el="x2">Y</div></section>`;
  const src = `\n\n${s1}\n\n${s2}\n\n`;

  const sections = parseSections(src);
  expect(sections).toEqual([s1, s2]);
  expect(joinSections(sections)).toBe(`${s1}\n\n${s2}`);
});

it("ReactRefiner Tools: extractElements extracts data-el elements from HTML", async () => {
  const { extractElements } = await loadTools();

  const section = `<section>
    <h1 data-el="title" id="hero" class="c">Heading</h1>
    <div data-el="box" data-foo="bar"></div>
    <span data-el="plain">Text only</span>
  </section>`;

  const els = extractElements(section);
  expect(els.length).toBe(3);
  expect(els.map((e) => ({ elementId: e.elementId, tag: e.tag }))).toEqual([
    { elementId: "title", tag: "h1" },
    { elementId: "box", tag: "div" },
    { elementId: "plain", tag: "span" },
  ]);
  expect(els[0].id).toBe("hero");
  expect(els[0].class).toBe("c");
  expect(els[1].attrs["data-foo"]).toBe("bar");
  expect(els[2].textPreview).toBe("Text only");
});

it("ReactRefiner Tools: getSlideContent normal and out-of-range", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const ok = await exec("getSlideContent", { slideIndex: 0 });
  expect(ok.success).toBe(true);
  expect(ok.data.slideIndex).toBe(0);
  expect(ok.data.html.includes('data-title="A"')).toBeTruthy();
  expect(ok.data.elementCount >= 2).toBeTruthy();

  const bad = await exec("getSlideContent", { slideIndex: 99 });
  expect(bad.success).toBe(false);
  expect(bad.error).toMatch(/Invalid slideIndex/);
});

it("ReactRefiner Tools: getSlideContext normal and missing meta/intent", async () => {
  const { createToolExecutor } = await loadTools();

  const context = {
    deckPackage: {
      deckHtmlDsl: makeDeckHtmlDsl(),
      slidesMeta: [{ slideNo: 1, title: "A" }, { slideNo: 2, title: "B" }],
      imageSlots: [{ slideIndex: 0, slotId: "img0" }, { slideIndex: 1, slotId: "img1" }],
    },
    contentPackage: {
      slideIntents: [{ slideIntentId: "s1", claimIds: ["c1"] }, { slideIntentId: "s2", claimIds: [] }],
      claims: [{ claimId: "c1", text: "Claim 1" }, { claimId: "c2", text: "Claim 2" }],
    },
  };
  const exec = createToolExecutor(context);

  const ok = await exec("getSlideContext", { slideIndex: 0 });
  expect(ok.success).toBe(true);
  expect(ok.data.slideIndex).toBe(0);
  expect(ok.data.slideIntent.slideIntentId).toBe("s1");
  expect(ok.data.slideMeta.title).toBe("A");
  expect(ok.data.claims.map((c) => c.claimId)).toEqual(["c1"]);
  expect(ok.data.imageSlots.length).toBe(1);
  expect(ok.data.imageSlots[0].slotId).toBe("img0");

  const missingContext = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec2 = createToolExecutor(missingContext);
  const missing = await exec2("getSlideContext", { slideIndex: 0 });
  expect(missing.success).toBe(true);
  expect(missing.data.slideIntent).toBe(null);
  expect(missing.data.slideMeta).toBe(null);
});

it("ReactRefiner Tools: editSlide replaces section HTML", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("editSlide", { slideIndex: 0, changes: { html: `<section data-title="NEW"><div data-el="t1">X</div></section>` } });
  expect(res.success).toBe(true);
  expect(context.deckPackage.deckHtmlDsl.includes('data-title="NEW"')).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('data-title="NEW"')).toBeTruthy();
});

it("ReactRefiner Tools: editElement updates matched elements", async () => {
  const { createToolExecutor } = await loadTools();

  const deckHtmlDsl = `<section><div data-el="t1">Old</div><div data-el="t2">Keep</div></section>`;
  const context = { deckPackage: { deckHtmlDsl }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("editElement", { slideIndex: 0, elementId: "t1", changes: { text: "New", style: "color:red", attrs: { "data-x": "1" }, foo: "bar" } });
  expect(res.success).toBe(true);
  expect(res.data.matchCount).toBe(1);
  expect(res.data.updatedSectionHtml.includes(">New<")).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('style="color:red"')).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('data-x="1"')).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('data-foo="bar"')).toBeTruthy();
});

it("ReactRefiner Tools: screenshot returns base64 in mock Node environment", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("screenshot", { slideIndex: 0 });
  expect(res.success).toBe(true);
  expect(res.data.base64.startsWith("data:image/png;base64,")).toBeTruthy();
  expect(res.data.mock).toBe(true);
});

it("ReactRefiner Tools: screenshotRenderer output is normalized to data URL", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context, { screenshotRenderer: async () => "AAAA" });

  const res = await exec("screenshot", { slideIndex: 0 });
  expect(res.success).toBe(true);
  expect(res.data.base64).toBe("data:image/png;base64,AAAA");
});

it("ReactRefiner Tools: XSS payloads are sanitized (Node/linkedom fallback)", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const xss = `<section data-title="XSS">
    <p data-el="p1">OK</p>
    <img src="x" onerror="alert(1)">
    <a href="javascript:alert(1)" data-el="a1">bad</a>
    <div style="background-image:url(javascript:alert(1))" data-el="d1">bad-style</div>
    <script>alert(1)</script>
  </section>`;

  const res = await exec("editSlide", { slideIndex: 0, changes: { html: xss } });
  expect(res.success).toBe(true);
  expect(res.data.updatedSectionHtml.includes('data-title="XSS"')).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('data-el="p1"')).toBeTruthy();
  expect(res.data.updatedSectionHtml).not.toMatch(/<script\b/i);
  expect(res.data.updatedSectionHtml).not.toMatch(/\sonerror=/i);
  expect(res.data.updatedSectionHtml).not.toMatch(/javascript:/i);
});

it("ReactRefiner Tools: valid HTML is preserved while sanitizing innerHTML", async () => {
  const { createToolExecutor } = await loadTools();

  const deckHtmlDsl = `<section><div data-el="t1">Old</div></section>`;
  const context = { deckPackage: { deckHtmlDsl }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const html = `<div class="ok"><span>Hi</span> <a href="https://example.com">link</a></div>`;
  const res = await exec("editElement", { slideIndex: 0, elementId: "t1", changes: { html } });
  expect(res.success).toBe(true);
  expect(res.data.updatedSectionHtml.includes('class="ok"')).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes("<span>Hi</span>")).toBeTruthy();
  expect(res.data.updatedSectionHtml.includes('href="https://example.com"')).toBeTruthy();
});

it("ReactRefiner Tools: uses DOMPurify when available (environment detection)", async () => {
  const calls = [];
  globalThis.DOMPurify = {
    sanitize: (html, opts) => {
      calls.push({ html, opts });
      return `<section data-title="PURIFIED"><div data-el="x">ok</div></section>`;
    },
  };

  try {
    const { createToolExecutor } = await loadTools();
    const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
    const exec = createToolExecutor(context);

    const input = `<section data-title="ORIG"><img src="x" onerror="alert(1)"></section>`;
    const res = await exec("editSlide", { slideIndex: 0, changes: { html: input } });
    expect(res.success).toBe(true);
    expect(res.data.updatedSectionHtml.includes('data-title="PURIFIED"')).toBeTruthy();

    expect(calls.length).toBe(1);
    expect(calls[0].html).toBe(input);
    expect(calls[0].opts?.RETURN_DOM_FRAGMENT).toBe(false);
  } finally {
    delete globalThis.DOMPurify;
  }
});
