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
  assert.ok(events.every((e) => e.name !== "design.image.planning.completed"));
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

test("Design: DesignStage calls ImagePlanner between tokens and batch, emits planning event, and inserts placeholders", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  contentPackage.constraints = {
    ...contentPackage.constraints,
    imagePolicy: "minimal",
    imageBudget: { maxImages: 5, maxCostUSD: 1.0 },
  };

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit });

  const idxTokens = events.findIndex((e) => e.name === "design.tokens.ended");
  const idxPlanning = events.findIndex((e) => e.name === "design.image.planning.completed");
  const idxBatchStarted = events.findIndex((e) => e.name === "design.batch.started");
  assert.ok(idxTokens >= 0 && idxPlanning >= 0 && idxBatchStarted >= 0);
  assert.ok(idxTokens < idxPlanning && idxPlanning < idxBatchStarted);

  assert.ok(Array.isArray(deck.imageSlots));
  assert.ok(deck.imageSlots.length >= 1);
  assert.ok(deck.imageReport === null);
  assert.ok(Array.isArray(deck.pendingImages) && deck.pendingImages.length === deck.imageSlots.length);

  assert.ok(typeof deck.deckHtmlDsl === "string");
  assert.ok(deck.deckHtmlDsl.includes('data-el="image-placeholder"'));
  assert.ok(deck.deckHtmlDsl.includes('data-status="pending"'));
  assert.ok(deck.deckHtmlDsl.includes('data-fallback="gradient"'));
  assert.ok(deck.deckHtmlDsl.includes('data-slot-id="img_s0_hero"'));
  assert.ok(deck.deckHtmlDsl.includes('id="img_s0_hero"'));
});

test("Design: batch-generator makePrompt includes image slot placeholder instructions when provided", async () => {
  const { generateBatch } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };

  const slideIntents = [
    { slideIntentId: "s1", pageType: "cover", title: "Hello", keyPoints: [] },
    { slideIntentId: "s2", pageType: "summary", title: "World", keyPoints: [] },
  ];

  const calls = [];
  const aiApiService = {
    chat: async (opts) => {
      calls.push(opts);
      const prompt = opts.messages.map((m) => m.content).join("\n");
      const marker = "Slide intents:\n";
      const json = prompt.slice(prompt.lastIndexOf(marker) + marker.length);
      const batch = JSON.parse(json);
      const slides = batch.map((si) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}"><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${si.title}</div></section>`,
      }));
      return { content: JSON.stringify(slides) };
    },
  };

  const imageSlots = [
    { slotId: "img_s0_hero", slideIntentId: "s1", slideIndex: 0, purpose: "hero", aspectRatio: "16:9", priority: "critical", promptHint: "x" },
  ];

  await generateBatch(slideIntents, contentPackage, designSystem, { aiApiService, imageSlots, batchSize: 4 });
  assert.equal(calls.length, 1);
  const prompt = calls[0].messages.map((m) => m.content).join("\n");
  assert.ok(prompt.includes("Image slots (placeholders):"));
  assert.ok(prompt.includes('data-el="image-placeholder"'));
  assert.ok(prompt.includes("img_s0_hero"));
});

test("Design: imagePolicy=none yields no placeholders and no pending images", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  contentPackage.constraints = {
    ...contentPackage.constraints,
    imagePolicy: "none",
    imageBudget: { maxImages: 5, maxCostUSD: 1.0 },
  };

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit });

  assert.ok(events.some((e) => e.name === "design.image.planning.completed"));
  assert.ok(Array.isArray(deck.imageSlots) && deck.imageSlots.length === 0);
  assert.ok(Array.isArray(deck.pendingImages) && deck.pendingImages.length === 0);
  assert.ok(typeof deck.deckHtmlDsl === "string" && !deck.deckHtmlDsl.includes('data-el="image-placeholder"'));
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

test("Design: image-prompt-builder exports buildPrompt and includes no-text guidance", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");
  const prompt = buildPrompt(
    { slotId: "img_s0_hero", purpose: "hero", promptHint: "A demo", style: "flat", aspectRatio: "16:9" },
    { theme: "modern", designTokens: { colors: { primary: "#0ea5e9", bg: "#ffffff" } } },
    makeContentPackage({ slideCount: 1 })
  );
  assert.ok(typeof prompt === "string" && prompt.includes("Do not include any text in the image."));
});

test("Design: design/index.js re-exports stage surface", async () => {
  const design = await import("../../js/agents/stages/design/index.js");
  assert.ok(typeof design.generateDesignTokens === "function");
  assert.ok(typeof design.buildSlideHtml === "function");
  assert.ok(typeof design.generateBatch === "function");
  assert.ok(typeof design.validateSlide === "function");
  assert.ok(typeof design.DesignStage === "function");
  assert.ok(typeof design.runDesignStage === "function");
});

test("Design: validateDesignSystem passes for fallback generator output", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const system = await generateDesignSystem(
    { contentSummary: "x", tone: "business", extractedPalette: null, userPreferences: {} },
    { aiApiService: null, constraints: { theme: "light" } }
  );

  const res = validateDesignSystem(system);
  assert.equal(res.ok, true);
  assert.ok(system?.designTokens?.colors?.primary);
});

test("Design: design-system-generator uses aiApiService and returns validated DesignSystem", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const calls = [];
  const aiApiService = {
    chat: async (opts) => {
      calls.push(opts);
      const system = {
        colors: {
          background: { slide: "#ffffff", gradient: "#0ea5e9", panel: "#ffffff" },
          text: { primary: "#0f172a", secondary: "#475569", muted: "#64748b", inverse: "#ffffff" },
          accent: { primary: "#0ea5e9", secondary: "#22c55e" },
          border: "#e2e8f0",
        },
        typography: {
          fontFamily: "Inter, system-ui, sans-serif",
          scale: { hero: 56, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
          lineHeight: 1.25,
        },
        spacing: { page: { marginX: 6, marginTop: 4, contentStartY: 10 }, element: { gapX: 8, gapY: 10 } },
        layouts: { header: {}, cover: {}, content: {} },
        components: { card: {}, table: {}, icon: {}, line: {} },
        effects: { shadow: {}, blur: 0, imageMask: "none", imageRadius: 12 },
        constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
      };
      return { content: JSON.stringify(system) };
    },
  };

  const out = await generateDesignSystem(
    { contentSummary: "Demo", tone: "business", extractedPalette: { primary: "#0ea5e9" }, userPreferences: { theme: "light" } },
    { aiApiService, constraints: { theme: "light" } }
  );

  assert.equal(calls.length, 1);
  assert.ok(out?.colors?.background?.slide);
  assert.ok(out?.designTokens?.colors?.primary);
  assert.equal(validateDesignSystem(out).ok, true);
});

test("Design: design-system-generator falls back on invalid AI output", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const aiApiService = { chat: async () => ({ content: JSON.stringify({ nope: true }) }) };
  const out = await generateDesignSystem({ contentSummary: "Demo" }, { aiApiService, constraints: { theme: "dark" } });

  assert.ok(out?.designTokens?.colors?.primary);
  assert.equal(validateDesignSystem(out).ok, true);
});

test("Design: validateDesignSystem fails on broken schema + DSL violations", async () => {
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const bad = {
    colors: { background: { slide: "white", gradient: "#0ea5e9", panel: "#fff" } },
    typography: { fontFamily: "", scale: { hero: 10 }, lineHeight: "1.2" },
    spacing: { page: { marginX: 2, marginTop: 1, contentStartY: 10 }, element: { gapX: 8, gapY: 10 } },
    layouts: { header: {}, cover: {}, content: {} },
    components: { card: {}, table: {}, icon: {}, line: {} },
    effects: { shadow: {}, blur: 0, imageMask: "none", imageRadius: 12 },
    constraints: { minFontSize: 10, maxElementsPerSlide: 18, coordinateUnit: "px", colorFormat: "hex" },
  };

  const res = validateDesignSystem(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("minFontSize")));
  assert.ok(res.errors.some((e) => e.includes("marginX")));
  assert.ok(res.errors.some((e) => e.includes("invalid_color")));
 });

test("Design: DesignStage prefers dynamic design system generation when AI is available", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const calls = [];
  const aiApiService = {
    chat: async (opts) => {
      const joined = opts.messages.map((m) => m.content).join("\n");
      if (joined.includes("Output JSON MUST match this shape")) {
        calls.push("designSystem");
        const system = {
          colors: {
            background: { slide: "#ffffff", gradient: "#7c3aed", panel: "#ffffff" },
            text: { primary: "#0f172a", secondary: "#475569", muted: "#64748b", inverse: "#ffffff" },
            accent: { primary: "#7c3aed", secondary: "#f59e0b" },
            border: "#e2e8f0",
          },
          typography: {
            fontFamily: "Inter, system-ui, sans-serif",
            scale: { hero: 56, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
            lineHeight: 1.25,
          },
          spacing: { page: { marginX: 6, marginTop: 4, contentStartY: 10 }, element: { gapX: 8, gapY: 10 } },
          layouts: { header: {}, cover: {}, content: {} },
          components: { card: {}, table: {}, icon: {}, line: {} },
          effects: { shadow: {}, blur: 0, imageMask: "none", imageRadius: 12 },
          constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
        };
        return { content: JSON.stringify(system) };
      }

      calls.push("slides");
      const marker = "Slide intents:\n";
      const json = joined.slice(joined.lastIndexOf(marker) + marker.length);
      const batch = JSON.parse(json);
      const slides = batch.map((si) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}"><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${si.title}</div></section>`,
      }));
      return { content: JSON.stringify(slides) };
    },
  };

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, aiApiService });

  assert.deepEqual(calls.slice(0, 2), ["designSystem", "slides"]);
  assert.equal(deck.designSystem?.colors?.accent?.primary, "#7c3aed");
  assert.ok(deck.designSystem?.designTokens?.colors?.primary);
});
