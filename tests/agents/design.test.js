const test = require("node:test");
const assert = require("node:assert/strict");

function makeContentPackage({ runId = "run_test", slideCount = 6 } = {}) {
  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Demo Deck", objective: "A concise demo." },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda", keyPoints: ["Background", "Approach", "Results", "Next Steps"] },
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview", claimIds: ["c1", "c2"], keyPoints: ["Context and goals"] },
    { slideIntentId: "s_comp", pageType: "comparison", title: "Comparison", keyPoints: ["Option A: lower cost", "Option B: higher accuracy"] },
    { slideIntentId: "s_proc", pageType: "process", title: "Process", keyPoints: ["Ingest", "Plan", "Generate"] },
    { slideIntentId: "s_sum", pageType: "summary", title: "Summary", keyPoints: ["Key takeaway 1", "Key takeaway 2"] },
    { slideIntentId: "s_app", pageType: "appendix", title: "Appendix" },
  ].slice(0, slideCount);

  return {
    schemaVersion: "0.1",
    runId,
    mode: "textprep",
    constraints: { pageCount: slideCount, tone: "business", audience: "tech" },
    summary: "Demo Deck\nShort summary for the deck.",
    slideIntents,
    claims: [
      { claimId: "c1", text: "Claim 1: X improves Y.", evidenceIds: ["e1"] },
      { claimId: "c2", text: "Claim 2: Cost decreases over time.", evidenceIds: ["e2"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" },
      { evidenceId: "e2", sourceId: "user_text", locator: { charStart: 11, charEnd: 22 }, quote: "Gamma delta" },
    ],
  };
}

test("Design: DesignStage generates design tokens + emits design.* events", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit });

  assert.equal(deck.schemaVersion, "0.1");
  assert.equal(deck.runId, "run_test");
  assert.ok(deck.designSystem?.designTokens?.colors?.primary);
  assert.ok(deck.designSystem?.designTokens?.typography?.fontFamily);
  assert.ok(Array.isArray(deck.slidesMeta) && deck.slidesMeta.length === contentPackage.slideIntents.length);
  assert.ok(typeof deck.deckHtmlDsl === "string" && deck.deckHtmlDsl.includes('data-type="freeform"'));

  assert.ok(events.some((e) => e.name === "design.started"));
  assert.ok(events.some((e) => e.name === "design.tokens.ended"));
  assert.ok(events.some((e) => e.name === "design.generate.ended"));
  assert.ok(events.some((e) => e.name === "design.qa.ended"));
  assert.ok(events.some((e) => e.name === "design.ended"));
});

test("Design: dsl-builder supports core page types and passes QA in safe mode", async () => {
  const { buildSlideHtml } = await import("../../js/agents/stages/design/dsl-builder.js");
  const { validateSlide } = await import("../../js/agents/stages/design/qa-validator.js");

  const contentPackage = makeContentPackage({ slideCount: 6 });
  const designSystem = {
    designTokens: {
      colors: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", primary: "#0ea5e9", border: "#e2e8f0", panel: "#ffffff" },
      typography: { minFont: 12, titleFont: 44, subtitleFont: 18, bodyFont: 16, smallFont: 12 },
    },
  };

  const pageTypes = ["cover", "agenda", "overview", "comparison", "process", "summary", "appendix"];
  for (const pageType of pageTypes) {
    const si = { slideIntentId: `s_${pageType}`, pageType, title: `T_${pageType}`, keyPoints: ["A", "B", "C"] };
    const html = buildSlideHtml(si, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
    assert.ok(html.includes("<section") && html.includes('data-type="freeform"'));
    const qa = validateSlide(html);
    assert.equal(qa.pass, true);
  }
});

test("Design: batch-generator generates per 4 slides, calls aiApiService.chat, and emits progress", async () => {
  const { generateBatch } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };

  const slideIntents = Array.from({ length: 9 }).map((_, i) => ({
    slideIntentId: `s${i + 1}`,
    pageType: "overview",
    title: `Slide ${i + 1}`,
    keyPoints: [`Point ${i + 1}`],
  }));

  const calls = [];
  const events = [];
  const aiApiService = {
    chat: async (opts) => {
      calls.push(opts);
      const prompt = opts.messages.map((m) => m.content).join("\n");
      const marker = "Slide intents:\n";
      const json = prompt.slice(prompt.lastIndexOf(marker) + marker.length);
      const batch = JSON.parse(json);
      const slides = batch.map((si, idx) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}"><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${si.title} (${idx})</div></section>`,
      }));
      return { content: JSON.stringify(slides) };
    },
  };

  const emit = (name, payload, extra) => events.push({ name, payload, extra });

  const slides = await generateBatch(slideIntents, contentPackage, designSystem, { aiApiService, emit, batchSize: 4 });
  assert.equal(slides.length, 9);
  assert.equal(calls.length, 3); // 9 slides -> 3 batches (4/4/1)
  assert.ok(events.some((e) => e.name === "design.batch.started"));
  assert.ok(events.some((e) => e.name === "design.batch.progress"));
  assert.ok(events.some((e) => e.name === "design.batch.ended"));
  assert.ok(slides.every((s) => s.source === "llm"));
});

test("Design: qa-validator catches min font, overflow, and low contrast", async () => {
  const { validateSlide } = await import("../../js/agents/stages/design/qa-validator.js");

  const bad = `
  <section data-type="freeform" id="slide-1" data-bg="#ffffff">
    <div data-el="text" id="t1" data-x="95%" data-y="10%" data-w="10%" data-h="10%" data-font="8" data-color="#f8fafc">Too small + overflow + low contrast</div>
  </section>
  `.trim();

  const qa = validateSlide(bad);
  assert.equal(qa.pass, false);
  const codes = new Set(qa.issues.map((i) => i.code));
  assert.ok(codes.has("min_font"));
  assert.ok(codes.has("overflow_x"));
  assert.ok(codes.has("contrast"));
});

test("Design: DesignStage triggers last-resort downgrade and deckHtmlDsl is parseable by SlideParser", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");
  const { parseHTML } = await import("linkedom");
  const fs = require("node:fs");
  const vm = require("node:vm");

  // Provide a minimal DOM for SlideParser in Node.
  const { document, window } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  globalThis.window = window;
  // Load the browser-oriented SlideParser into the current context for testing.
  // slide-parser.js is not an ESM module, so we evaluate it and export the class to globalThis.
  const slideParserSrc = fs.readFileSync("js/ppt/slide-parser.js", "utf8") + "\n;globalThis.SlideParser = SlideParser;";
  vm.runInThisContext(slideParserSrc, { filename: "js/ppt/slide-parser.js" });
  assert.ok(globalThis.SlideParser && typeof globalThis.SlideParser.parse === "function");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  const aiApiService = {
    chat: async (opts) => {
      const prompt = opts.messages.map((m) => m.content).join("\n");
      const marker = "Slide intents:\n";
      const json = prompt.slice(prompt.lastIndexOf(marker) + marker.length);
      const batch = JSON.parse(json);

      // Intentionally produce QA-failing slides (min font + overflow + low contrast),
      // so DesignStage must downgrade to safe templates.
      const slides = batch.map((si) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}">
          <div data-el="text" data-x="95%" data-y="10%" data-w="10%" data-h="10%" data-font="8" data-color="#f8fafc">${si.title}</div>
        </section>`,
      }));
      return { content: JSON.stringify(slides) };
    },
  };

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit, aiApiService });

  assert.ok(deck.slidesMeta.some((m) => m.degraded === true));
  assert.ok(deck.slidesMeta.every((m) => m.qa?.pass === true));
  assert.ok(events.some((e) => e.name === "design.degraded"));

  const slides = globalThis.SlideParser.parse(deck.deckHtmlDsl);
  assert.equal(slides.length, contentPackage.slideIntents.length);
  assert.ok(slides.every((s) => Array.isArray(s.elements)));
});
