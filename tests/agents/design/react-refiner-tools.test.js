const test = require("node:test");
const assert = require("node:assert/strict");

async function loadTools() {
  return import("../../../js/agents/stages/design/refiner/react-refiner-tools.js");
}

function makeDeckHtmlDsl() {
  return [
    `<section data-title="A"><h1 data-el="title1" id="t1">Hello</h1><div data-el="box1" class="c1"></div></section>`,
    `<section data-title="B"><p data-el="p1">World</p></section>`,
  ].join("\n\n");
}

test("ReactRefiner Tools: parseSections/joinSections roundtrip consistency", async () => {
  const { parseSections, joinSections } = await loadTools();

  const s1 = `<section data-title="A"><div data-el="x1">X</div></section>`;
  const s2 = `<section data-title="B"><div data-el="x2">Y</div></section>`;
  const src = `\n\n${s1}\n\n${s2}\n\n`;

  const sections = parseSections(src);
  assert.deepStrictEqual(sections, [s1, s2]);
  assert.equal(joinSections(sections), `${s1}\n\n${s2}`);
});

test("ReactRefiner Tools: extractElements extracts data-el elements from HTML", async () => {
  const { extractElements } = await loadTools();

  const section = `<section>
    <h1 data-el="title" id="hero" class="c">Heading</h1>
    <div data-el="box" data-foo="bar"></div>
    <span data-el="plain">Text only</span>
  </section>`;

  const els = extractElements(section);
  assert.equal(els.length, 3);
  assert.deepStrictEqual(
    els.map((e) => ({ elementId: e.elementId, tag: e.tag })),
    [
      { elementId: "title", tag: "h1" },
      { elementId: "box", tag: "div" },
      { elementId: "plain", tag: "span" },
    ]
  );
  assert.equal(els[0].id, "hero");
  assert.equal(els[0].class, "c");
  assert.equal(els[1].attrs["data-foo"], "bar");
  assert.equal(els[2].textPreview, "Text only");
});

test("ReactRefiner Tools: getSlideContent normal and out-of-range", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const ok = await exec("getSlideContent", { slideIndex: 0 });
  assert.equal(ok.success, true);
  assert.equal(ok.data.slideIndex, 0);
  assert.ok(ok.data.html.includes('data-title="A"'));
  assert.ok(ok.data.elementCount >= 2);

  const bad = await exec("getSlideContent", { slideIndex: 99 });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Invalid slideIndex/);
});

test("ReactRefiner Tools: getSlideContext normal and missing meta/intent", async () => {
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
  assert.equal(ok.success, true);
  assert.equal(ok.data.slideIndex, 0);
  assert.equal(ok.data.slideIntent.slideIntentId, "s1");
  assert.equal(ok.data.slideMeta.title, "A");
  assert.deepStrictEqual(ok.data.claims.map((c) => c.claimId), ["c1"]);
  assert.equal(ok.data.imageSlots.length, 1);
  assert.equal(ok.data.imageSlots[0].slotId, "img0");

  const missingContext = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec2 = createToolExecutor(missingContext);
  const missing = await exec2("getSlideContext", { slideIndex: 0 });
  assert.equal(missing.success, true);
  assert.equal(missing.data.slideIntent, null);
  assert.equal(missing.data.slideMeta, null);
});

test("ReactRefiner Tools: editSlide replaces section HTML", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("editSlide", { slideIndex: 0, changes: { html: `<section data-title="NEW"><div data-el="t1">X</div></section>` } });
  assert.equal(res.success, true);
  assert.ok(context.deckPackage.deckHtmlDsl.includes('data-title="NEW"'));
  assert.ok(res.data.updatedSectionHtml.includes('data-title="NEW"'));
});

test("ReactRefiner Tools: editElement updates matched elements", async () => {
  const { createToolExecutor } = await loadTools();

  const deckHtmlDsl = `<section><div data-el="t1">Old</div><div data-el="t2">Keep</div></section>`;
  const context = { deckPackage: { deckHtmlDsl }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("editElement", { slideIndex: 0, elementId: "t1", changes: { text: "New", style: "color:red", attrs: { "data-x": "1" }, foo: "bar" } });
  assert.equal(res.success, true);
  assert.equal(res.data.matchCount, 1);
  assert.ok(res.data.updatedSectionHtml.includes(">New<"));
  assert.ok(res.data.updatedSectionHtml.includes('style="color:red"'));
  assert.ok(res.data.updatedSectionHtml.includes('data-x="1"'));
  assert.ok(res.data.updatedSectionHtml.includes('data-foo="bar"'));
});

test("ReactRefiner Tools: screenshot returns base64 in mock Node environment", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const res = await exec("screenshot", { slideIndex: 0 });
  assert.equal(res.success, true);
  assert.ok(res.data.base64.startsWith("data:image/png;base64,"));
  assert.equal(res.data.mock, true);
});

test("ReactRefiner Tools: screenshotRenderer output is normalized to data URL", async () => {
  const { createToolExecutor } = await loadTools();

  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context, { screenshotRenderer: async () => "AAAA" });

  const res = await exec("screenshot", { slideIndex: 0 });
  assert.equal(res.success, true);
  assert.equal(res.data.base64, "data:image/png;base64,AAAA");
});

test("ReactRefiner Tools: XSS payloads are sanitized (Node/linkedom fallback)", async () => {
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
  assert.equal(res.success, true);
  assert.ok(res.data.updatedSectionHtml.includes('data-title="XSS"'));
  assert.ok(res.data.updatedSectionHtml.includes('data-el="p1"'));
  assert.doesNotMatch(res.data.updatedSectionHtml, /<script\b/i);
  assert.doesNotMatch(res.data.updatedSectionHtml, /\sonerror=/i);
  assert.doesNotMatch(res.data.updatedSectionHtml, /javascript:/i);
});

test("ReactRefiner Tools: valid HTML is preserved while sanitizing innerHTML", async () => {
  const { createToolExecutor } = await loadTools();

  const deckHtmlDsl = `<section><div data-el="t1">Old</div></section>`;
  const context = { deckPackage: { deckHtmlDsl }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const html = `<div class="ok"><span>Hi</span> <a href="https://example.com">link</a></div>`;
  const res = await exec("editElement", { slideIndex: 0, elementId: "t1", changes: { html } });
  assert.equal(res.success, true);
  assert.ok(res.data.updatedSectionHtml.includes('class="ok"'));
  assert.ok(res.data.updatedSectionHtml.includes("<span>Hi</span>"));
  assert.ok(res.data.updatedSectionHtml.includes('href="https://example.com"'));
});

test("ReactRefiner Tools: uses DOMPurify when available (environment detection)", async (t) => {
  const calls = [];
  globalThis.DOMPurify = {
    sanitize: (html, opts) => {
      calls.push({ html, opts });
      return `<section data-title="PURIFIED"><div data-el="x">ok</div></section>`;
    },
  };
  t.after(() => {
    delete globalThis.DOMPurify;
  });

  const { createToolExecutor } = await loadTools();
  const context = { deckPackage: { deckHtmlDsl: makeDeckHtmlDsl() }, contentPackage: {} };
  const exec = createToolExecutor(context);

  const input = `<section data-title="ORIG"><img src="x" onerror="alert(1)"></section>`;
  const res = await exec("editSlide", { slideIndex: 0, changes: { html: input } });
  assert.equal(res.success, true);
  assert.ok(res.data.updatedSectionHtml.includes('data-title="PURIFIED"'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].html, input);
  assert.equal(calls[0].opts?.RETURN_DOM_FRAGMENT, false);
});
