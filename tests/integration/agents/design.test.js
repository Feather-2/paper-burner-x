import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

function extractSlideIntentsFromPrompt(prompt) {
  const marker = "=== SLIDES TO GENERATE ===\n";
  const s = String(prompt || "");
  const idx = s.lastIndexOf(marker);
  if (idx < 0) throw new Error("Missing Slide intents marker");

  const tail = s.slice(idx + marker.length);
  // Find the JSON array by matching balanced brackets
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === "[") {
      if (start < 0) start = i;
      depth++;
    } else if (tail[i] === "]") {
      depth--;
      if (depth === 0 && start >= 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (start >= 0 && end > start) {
    return JSON.parse(tail.slice(start, end));
  }
  throw new Error("Failed to extract JSON from prompt");
}

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

it("Design: DesignStage generates design tokens + emits design.* events", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit });

  expect(deck.schemaVersion).toBe("0.1");
  expect(deck.runId).toBe("run_test");
  expect(deck.designSystem?.designTokens?.colors?.primary).toBeDefined();
  expect(deck.designSystem?.designTokens?.typography?.fontFamily).toBeDefined();
  expect(Array.isArray(deck.slidesMeta)).toBe(true);
  expect(deck.slidesMeta?.length).toBe(contentPackage.slideIntents.length);
  expect(typeof deck.deckHtmlDsl).toBe("string");
  expect(deck.deckHtmlDsl).toContain('data-type="freeform"');

  expect(events.some(e => e.name === "design.started")).toBe(true);
  expect(events.some(e => e.name === "design.tokens.ended")).toBe(true);
  expect(events.some(e => e.name === "design.generate.ended")).toBe(true);
  expect(events.some(e => e.name === "design.qa.ended")).toBe(true);
  expect(events.some(e => e.name === "design.ended")).toBe(true);
  expect(events.every(e => e.name !== "design.image.planning.completed")).toBe(true);
});

it("Design: ReactRefiner tool executor sanitizes injected HTML (no javascript: urls)", async () => {
  const { createToolExecutor } = await import("../../js/agents/stages/design/refiner/react-refiner-tools.js");

  const context = {
    deckPackage: {
      deckHtmlDsl: `<section data-type="freeform"><div data-el="el_1">x</div></section>`,
      slidesMeta: [],
    },
    contentPackage: { slideIntents: [] },
  };

  const exec = createToolExecutor(context);
  const res = await exec("editElement", {
    slideIndex: 0,
    elementId: "el_1",
    changes: { html: `<form action="javascript:alert(1)"><button>go</button></form>` },
  });

  expect(res.success).toBe(true);
  expect(String(context.deckPackage.deckHtmlDsl).includes("javascript:")).toBe(false);
});

it("Design: dsl-builder supports core page types and passes QA in safe mode", async () => {
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
    expect(html).toContain("<section");
    expect(html).toContain('data-type="freeform"');
    const qa = validateSlide(html);
    expect(qa.pass).toBe(true);
  }
});

it("Design: dsl-builder prefers slideIntent.content (string) over keyPoints/objective", async () => {
  const { buildSlideHtml } = await import("../../js/agents/stages/design/dsl-builder.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = {
    designTokens: {
      colors: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", primary: "#0ea5e9", border: "#e2e8f0", panel: "#ffffff" },
      typography: { minFont: 12, titleFont: 44, subtitleFont: 18, bodyFont: 16, smallFont: 12 },
    },
  };

  const si = {
    slideIntentId: "s1",
    pageType: "overview",
    title: "Content First",
    keyPoints: ["SHOULD_NOT_RENDER"],
    objective: "OBJ_SHOULD_NOT_RENDER",
    content: "## Heading\nThis should render from content.",
  };

  const html = buildSlideHtml(si, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
  expect(html).toContain("This should render from content.");
  expect(html.includes("SHOULD_NOT_RENDER")).toBe(false);
  expect(html.includes("OBJ_SHOULD_NOT_RENDER")).toBe(false);
});

it("Design: dsl-builder supports slideIntent.content.markdown (object) and falls back when missing", async () => {
  const { buildSlideHtml } = await import("../../js/agents/stages/design/dsl-builder.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = {
    designTokens: {
      colors: { bg: "#ffffff", text: "#0f172a", muted: "#64748b", primary: "#0ea5e9", border: "#e2e8f0", panel: "#ffffff" },
      typography: { minFont: 12, titleFont: 44, subtitleFont: 18, bodyFont: 16, smallFont: 12 },
    },
  };

  const siObj = {
    slideIntentId: "s_obj",
    pageType: "overview",
    title: "Markdown Object",
    content: { markdown: "- Alpha\n- Beta", citations: [{ id: "c1" }] },
  };
  const htmlObj = buildSlideHtml(siObj, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
  expect(htmlObj).toContain("Alpha");
  expect(htmlObj).toContain("Beta");

  const siFallbackKeyPoints = {
    slideIntentId: "s_kp",
    pageType: "overview",
    title: "Fallback KeyPoints",
    keyPoints: ["KP_1"],
  };
  const htmlKp = buildSlideHtml(siFallbackKeyPoints, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
  expect(htmlKp).toContain("KP_1");

  const siFallbackObjective = {
    slideIntentId: "s_obj2",
    pageType: "overview",
    title: "Fallback Objective",
    objective: "OBJ_1",
  };
  const htmlObjective = buildSlideHtml(siFallbackObjective, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
  expect(htmlObjective).toContain("OBJ_1");
});

it("Design: generateSingleSlide returns valid HTML", async () => {
  const { generateSingleSlide } = await import("../../js/agents/stages/design/batch-generator.js");

  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };
  const slideIntent = { slideIntentId: "s1", pageType: "overview", title: "Hello", keyPoints: ["A", "B"] };

  const res = await generateSingleSlide(slideIntent, designSystem, "Use percent positions only.");
  expect(res.slideIntentId).toBe("s1");
  expect(typeof res.slideHtml).toBe("string");
  expect(res.slideHtml).toContain('data-type="freeform"');
  expect(res.slideHtml).toContain('data-el="');
});

it("Design: generateSingleSlide repairs invalid DSL via reflection before falling back", async () => {
  const { generateSingleSlide } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };
  const slideIntent = { ...contentPackage.slideIntents[0], slideIntentId: "s_repair", pageType: "overview", title: "Repair" };

  let sawRepairPrompt = false;

  const modelCaller = async (messages) => {
    const system = String(messages?.[0]?.content || "");
    if (system.includes("[DSL Repair]")) {
      sawRepairPrompt = true;
      return { content: '<section data-type="freeform"><div data-el="text">Fixed</div></section>' };
    }
    return {
      content: JSON.stringify([
        { slideIntentId: "s_repair", slideHtml: '<section data-type="freeform"></section>' },
      ]),
    };
  };

  const res = await generateSingleSlide(slideIntent, designSystem, "Use percent positions only.", {
    contentPackage,
    slideIndex: 0,
    slideNo: 1,
    modelCaller,
  });

  expect(sawRepairPrompt).toBe(true);
  expect(res.source).toBe("llm");
  expect(typeof res.slideHtml).toBe("string");
  expect(res.slideHtml).toContain('data-type="freeform"');
  expect(res.slideHtml).toContain('data-el="');
});

it("Design: batch-generator respects concurrency, emits events, and retries once on failure", async () => {
  const { generateBatch } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };

  const slideIntents = Array.from({ length: 5 }).map((_, i) => ({
    slideIntentId: `s${i + 1}`,
    pageType: "overview",
    title: `Slide ${i + 1}`,
    keyPoints: [`Point ${i + 1}`],
  }));

  let active = 0;
  let maxActive = 0;
  const attempts = new Map();

  const aiApiService = {
    chat: async (opts) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const prompt = opts.messages.map((m) => m.content).join("\n");
        let batch;
        try {
          batch = extractSlideIntentsFromPrompt(prompt);
        } catch {
          // Not a generateBatch prompt, return empty to trigger fallback
          await new Promise((r) => setImmediate(r));
          return { content: "[]" };
        }
        const si = batch[0];

        const n = (attempts.get(si.slideIntentId) || 0) + 1;
        attempts.set(si.slideIntentId, n);
        if (si.slideIntentId === "s3" && n === 1) throw new Error("Transient failure");

        await new Promise((r) => setImmediate(r));
        return {
          content: JSON.stringify([
            {
              slideIntentId: si.slideIntentId,
              slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}"><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${si.title}</div></section>`,
            },
          ]),
        };
      } finally {
        active -= 1;
      }
    },
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slides = await generateBatch(slideIntents, contentPackage, designSystem, { aiApiService, emit, batchSize: 2 });
  expect(slides.length).toBe(5);
  expect(slides.every(s => s.source === "llm")).toBe(true);

  // batchConcurrency=2 (default), batchSize=2, so max 2 batches * 2 slides = 4 concurrent
  expect(maxActive <= 4).toBe(true);

  const idxBatch0Start = events.findIndex((e) => e.name === "design.batch.started" && e.record?.payload?.batchIndex === 0);
  const idxBatch0End = events.findIndex((e) => e.name === "design.batch.completed" && e.record?.payload?.batchIndex === 0);
  expect(idxBatch0Start).toBeGreaterThanOrEqual(0);
  expect(idxBatch0End).toBeGreaterThanOrEqual(0);
  expect(idxBatch0Start).toBeLessThan(idxBatch0End);

  for (let i = 0; i < slideIntents.length; i++) {
    const idxStarted = events.findIndex((e) => e.name === "design.slide.started" && e.record?.payload?.slideIndex === i);
    const idxCompleted = events.findIndex((e) => e.name === "design.slide.completed" && e.record?.payload?.slideIndex === i);
    expect(idxStarted).toBeGreaterThanOrEqual(0);
    expect(idxCompleted).toBeGreaterThanOrEqual(0);
    expect(idxStarted).toBeLessThan(idxCompleted);
  }

  expect(events.some(e => e.name === "design.slide.retrying" && e.record?.payload?.slideIndex === 2)).toBe(true);
  expect(events.some(e => e.name === "design.slide.failed" && e.record?.payload?.slideIndex === 2)).toBe(false);
});

it("Design: DesignStage calls ImagePlanner between tokens and batch, emits planning event, and inserts placeholders", async () => {
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
  expect(idxTokens).toBeGreaterThanOrEqual(0);
  expect(idxPlanning).toBeGreaterThanOrEqual(0);
  expect(idxBatchStarted).toBeGreaterThanOrEqual(0);
  expect(idxTokens).toBeLessThan(idxPlanning);
  expect(idxPlanning).toBeLessThan(idxBatchStarted);

  expect(Array.isArray(deck.imageSlots)).toBe(true);
  expect(deck.imageSlots?.length).toBeGreaterThanOrEqual(1);
  expect(deck.imageReport).toBeNull();
  expect(Array.isArray(deck.pendingImages)).toBe(true);
  expect(deck.pendingImages?.length).toBe(deck.imageSlots.length);

  expect(typeof deck.deckHtmlDsl).toBe("string");
  expect(deck.deckHtmlDsl).toContain('data-el="image-placeholder"');
  expect(deck.deckHtmlDsl).toContain('data-status="pending"');
  expect(deck.deckHtmlDsl).toContain('data-fallback="gradient"');
  expect(deck.deckHtmlDsl).toContain('data-slot-id="img_s0_hero"');
  expect(deck.deckHtmlDsl).toContain('id="img_s0_hero"');
});

it("Design: batch-generator makePrompt includes image slot placeholder instructions when provided", async () => {
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
      const batch = extractSlideIntentsFromPrompt(prompt);
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
  expect(calls.length).toBe(2);
  const prompts = calls.map((c) => c.messages.map((m) => m.content).join("\n"));
  expect(prompts.some(p => p.includes("Requested image slots") || p.includes("Image slots")));
  expect(prompts.some(p => p.includes('data-el="image"') || p.includes('data-el="image-placeholder"')));
  expect(prompts.some(p => p.includes("img_s0_hero")));
});

it("Design: generateBatch injects brainstorm outputs and patches placeholder data-* attrs", async () => {
  const { generateBatch } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };

  const slideIntents = [{ slideIntentId: "s1", pageType: "cover", title: "Hello", keyPoints: [] }];
  const imageSlots = [{ slotId: "img_s0_hero", slideIntentId: "s1", slideIndex: 0, purpose: "hero", aspectRatio: "16:9", priority: "critical" }];
  const selectedIdeas = [
    {
      slideIntentId: "s1",
      atmosphere: { mood: "Neo noir", colorScheme: "Indigo + cyan accents", visualWeight: "Heavy" },
      elementsMarkdown: "- Strong title hierarchy\n- Full-bleed hero image\n- Subtle grid texture",
      visualSlots: [
        {
          slotId: "img_s0_hero",
          slideIntentId: "s1",
          slideIndex: 0,
          renderType: "ai-image",
          position: { x: "11%", y: "22%", w: "33%", h: "44%" },
          effects: { blend: "multiply", opacity: 0.8 },
        },
      ],
    },
  ];

  const prompts = [];
  const aiApiService = {
    chat: async (opts) => {
      const prompt = opts.messages.map((m) => m.content).join("\n");
      prompts.push(prompt);
      const batch = extractSlideIntentsFromPrompt(prompt);
      const slides = batch.map((si) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: `<section data-type="freeform" id="slide-${si.slideIntentId}" data-bg="#ffffff" data-title="${si.title}"><div data-el="image-placeholder" id="img_s0_hero" data-slot-id="img_s0_hero" data-status="pending" data-aspect-ratio="16:9" data-fallback="gradient"></div><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${si.title}</div></section>`,
      }));
      return { content: JSON.stringify(slides) };
    },
  };

  const out = await generateBatch(slideIntents, contentPackage, designSystem, { aiApiService, imageSlots, selectedIdeas, batchSize: 4 });
  expect(out.length).toBe(1);

  const promptIntents = extractSlideIntentsFromPrompt(prompts[0]);
  expect(promptIntents[0].slideIntentId).toBe("s1");
  expect(promptIntents[0].brainstorm.atmosphere.mood).toBe("Neo noir");
  expect(promptIntents[0].brainstorm.elementsMarkdown).toContain("Full-bleed");
  expect(promptIntents[0].brainstorm.visualSlots[0].position.x).toBe("11%");

  const html = out[0].slideHtml;
  expect(html).toContain('data-render-type="ai-image"');
  expect(html).toContain('data-x="11%"');
  expect(html).toContain('data-y="22%"');
  expect(html).toContain('data-w="33%"');
  expect(html).toContain('data-h="44%"');
  expect(html).toMatch(/data-effects="[^"]*blend[^"]*multiply/i);
});

it("Design: batch-generator prompt serializes content and exposes contentMarkdown", async () => {
  const { generateBatch } = await import("../../js/agents/stages/design/batch-generator.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111" } } };

  const slideIntents = [
    { slideIntentId: "s1", pageType: "overview", title: "S1", content: "## H\nHello", keyPoints: ["KP"] },
    { slideIntentId: "s2", pageType: "overview", title: "S2", content: { markdown: "- A\n- B", citations: [] } },
    { slideIntentId: "s3", pageType: "overview", title: "S3", keyPoints: ["K3"] },
  ];

  const captured = [];
  const aiApiService = {
    chat: async (opts) => {
      const prompt = opts.messages.map((m) => m.content).join("\n");
      const batch = extractSlideIntentsFromPrompt(prompt);
      captured.push(batch[0]);
      return {
        content: JSON.stringify([
          {
            slideIntentId: batch[0].slideIntentId,
            slideHtml: `<section data-type="freeform" id="slide-${batch[0].slideIntentId}" data-bg="#ffffff" data-title="${batch[0].title}"><div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-font="16" data-color="#111111">${batch[0].title}</div></section>`,
          },
        ]),
      };
    },
  };

  await generateBatch(slideIntents, contentPackage, designSystem, { aiApiService, batchSize: 4 });
  expect(captured.length).toBe(3);

  const c1 = captured.find((c) => c.slideIntentId === "s1");
  expect(typeof c1.content).toBe("string");
  expect(c1.contentMarkdown).toBe("## H\nHello");

  const c2 = captured.find((c) => c.slideIntentId === "s2");
  expect(typeof c2.content).toBe("object");
  expect(c2.content.markdown).toBe("- A\n- B");
  expect(c2.contentMarkdown).toBe("- A\n- B");

  const c3 = captured.find((c) => c.slideIntentId === "s3");
  expect(c3.content).toBe(null);
  expect(c3.contentMarkdown).toBe("");
});

it("Design: imagePolicy=none yields no placeholders and no pending images", async () => {
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

  expect(events.some(e => e.name === "design.image.planning.completed")).toBe(true);
  expect(Array.isArray(deck.imageSlots)).toBe(true);
  expect(deck.imageSlots?.length).toBe(0);
  expect(Array.isArray(deck.pendingImages)).toBe(true);
  expect(deck.pendingImages?.length).toBe(0);
  expect(typeof deck.deckHtmlDsl).toBe("string");
  expect(deck.deckHtmlDsl.includes('data-el="image-placeholder"')).toBe(false);
});

it("Design: DesignStage calls ImageGenerator when provider exists and fills placeholders", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 2 });
  contentPackage.constraints = {
    ...contentPackage.constraints,
    imagePolicy: "minimal",
    imageBudget: { maxImages: 5, maxCostUSD: 1.0 },
  };

  const imageService = {
    provider: "local",
    model: "test",
    generate: async () => ({ url: "data:image/png;base64,AAAA", mimeType: "image/png", width: 1, height: 1 }),
  };

  const stage = new DesignStage({ batchSize: 2 });
  const deck = await stage.run(contentPackage, { runContext: { runId: "run_test", constraints: contentPackage.constraints }, emit, imageService });

  expect(events.some(e => e.name === "design.image.generate.started")).toBe(true);
  expect(events.some(e => e.name === "design.image.generate.succeeded")).toBe(true);
  expect(events.some(e => e.name === "design.image.fill.completed")).toBe(true);

  expect(typeof deck.deckHtmlDsl).toBe("string");
  expect(deck.deckHtmlDsl).toContain('data-el="image"');
  expect(deck.deckHtmlDsl).toContain('data-status="filled"');
  expect(Array.isArray(deck.pendingImages)).toBe(true);
  expect(deck.pendingImages?.length).toBeLessThan(deck.imageSlots.length);
  expect(Boolean(deck.imageReport?.summary)).toBe(true);
});

it("Design: qa-validator catches min font, overflow, and low contrast", async () => {
  const { validateSlide } = await import("../../js/agents/stages/design/qa-validator.js");

  const bad = `
  <section data-type="freeform" id="slide-1" data-bg="#ffffff">
    <div data-el="text" id="t1" data-x="95%" data-y="10%" data-w="10%" data-h="10%" data-font="8" data-color="#f8fafc">Too small + overflow + low contrast</div>
  </section>
  `.trim();

  const qa = validateSlide(bad);
  expect(qa.pass).toBe(false);
  const codes = new Set(qa.issues.map((i) => i.code));
  expect(codes.has("min_font")).toBe(true);
  expect(codes.has("overflow_x")).toBe(true);
  expect(codes.has("contrast")).toBe(true);
});

it("Design: DesignStage triggers last-resort downgrade and deckHtmlDsl is parseable by SlideParser", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");
  const { parseHTML } = await import("linkedom");

  // Provide a minimal DOM for SlideParser in Node.
  const { document, window } = parseHTML("<html><body></body></html>");
  globalThis.document = document;
  globalThis.window = window;

  // Load SlideParser as ESM and use the global it installs.
  await import("../../js/ppt/core/slide-parser.js");
  expect(globalThis.SlideParser).toBeDefined();
  expect(typeof globalThis.SlideParser?.parse).toBe("function");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 6 });
  const aiApiService = {
    chat: async (opts) => {
      const prompt = opts.messages.map((m) => m.content).join("\n");
      const batch = extractSlideIntentsFromPrompt(prompt);

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

  expect(deck.slidesMeta.some(m => m.degraded === true)).toBe(true);
  expect(deck.slidesMeta.every(m => m.qa?.pass === true)).toBe(true);
  expect(events.some(e => e.name === "design.degraded")).toBe(true);

  const slides = globalThis.SlideParser.parse(deck.deckHtmlDsl);
  expect(slides.length).toBe(contentPackage.slideIntents.length);
  expect(slides.every(s => Array.isArray(s.elements))).toBe(true);
});

it("Design: image-prompt-builder exports buildPrompt and includes no-text guidance", async () => {
  const { buildPrompt } = await import("../../js/agents/stages/design/image-prompt-builder.js");
  const prompt = buildPrompt(
    { slotId: "img_s0_hero", purpose: "hero", promptHint: "A demo", style: "flat", aspectRatio: "16:9" },
    { theme: "modern", designTokens: { colors: { primary: "#0ea5e9", bg: "#ffffff" } } },
    makeContentPackage({ slideCount: 1 })
  );
  expect(typeof prompt).toBe("string");
  expect(prompt).toContain("Do not include any text in the image.");
});

it("Design: design/index.js re-exports stage surface", async () => {
  const design = await import("../../js/agents/stages/design/index.js");
  expect(typeof design.generateDesignTokens).toBe("function");
  expect(typeof design.buildSlideHtml).toBe("function");
  expect(typeof design.generateBatch).toBe("function");
  expect(typeof design.validateSlide).toBe("function");
  expect(typeof design.DesignStage).toBe("function");
  expect(typeof design.runDesignStage).toBe("function");
});

it("Design: validateDesignSystem passes for fallback generator output", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const system = await generateDesignSystem(
    { contentSummary: "x", tone: "business", extractedPalette: null, userPreferences: {} },
    { aiApiService: null, constraints: { theme: "light" } }
  );

  const res = validateDesignSystem(system);
  expect(res.ok).toBe(true);
  expect(system?.designTokens?.colors?.primary).toBeDefined();
});

it("Design: design-system-generator uses aiApiService and returns validated DesignSystem", async () => {
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

  expect(calls.length).toBe(1);
  expect(out?.colors?.background?.slide).toBeDefined();
  expect(out?.designTokens?.colors?.primary).toBeDefined();
  expect(validateDesignSystem(out).ok).toBe(true);
});

it("Design: design-system-generator falls back on invalid AI output", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");
  const { validateDesignSystem } = await import("../../js/agents/stages/design/design-tokens.js");

  const aiApiService = { chat: async () => ({ content: JSON.stringify({ nope: true }) }) };
  const out = await generateDesignSystem({ contentSummary: "Demo" }, { aiApiService, constraints: { theme: "dark" } });

  expect(out?.designTokens?.colors?.primary).toBeDefined();
  expect(validateDesignSystem(out).ok).toBe(true);
});

function makeValidDynamicDesignSystem() {
  return {
    theme: "light",
    colors: {
      background: { slide: "#ffffff", gradient: "#0ea5e9", panel: "#ffffff" },
      text: { primary: "#0f172a", secondary: "#475569", muted: "#64748b", inverse: "#ffffff" },
      accent: { primary: "#0ea5e9", secondary: "#22c55e" },
      border: "#e2e8f0",
    },
    typography: {
      fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      scale: { hero: 56, h1: 44, h2: 32, subtitle: 18, body: 16, caption: 12 },
      lineHeight: 1.25,
    },
    spacing: { page: { marginX: 6, marginTop: 4, contentStartY: 10 }, element: { gapX: 8, gapY: 10 } },
    layouts: { header: {}, cover: {}, content: {} },
    components: { card: {}, table: {}, icon: {}, line: {} },
    effects: { shadow: {}, blur: 0, imageMask: "none", imageRadius: 12 },
    constraints: { minFontSize: 12, maxElementsPerSlide: 18, coordinateUnit: "percent", colorFormat: "hex" },
  };
}

it("Design: generateDesignSystem applies no overrides (explicit empty overrides)", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");

  const aiApiService = {
    chat: async () => ({ content: JSON.stringify(makeValidDynamicDesignSystem()) }),
  };

  const out = await generateDesignSystem(
    { contentSummary: "Demo", userPreferences: { designSystemOverrides: {} } },
    { aiApiService, constraints: { theme: "light" } }
  );

  expect(out.colors.accent.primary).toBe("#0ea5e9");
  expect(out.designTokens?.colors?.primary).toBeDefined();
});

it("Design: generateDesignSystem applies partial overrides and re-syncs legacy designTokens", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");

  const aiApiService = {
    chat: async () => ({ content: JSON.stringify(makeValidDynamicDesignSystem()) }),
  };

  const out = await generateDesignSystem(
    {
      contentSummary: "Demo",
      userPreferences: {
        designSystemOverrides: {
          colors: { accent: { primary: "#ff0000" } },
          typography: { fontFamily: "Comic Sans MS, cursive" },
          spacing: { page: { marginX: 10 } },
        },
      },
    },
    { aiApiService, constraints: { theme: "light" } }
  );

  expect(out.colors.accent.primary).toBe("#ff0000");
  expect(out.typography.fontFamily).toBe("Comic Sans MS, cursive");
  expect(out.spacing.page.marginX).toBe(10);

  expect(out.designTokens.colors.primary).toBe("#ff0000");
  expect(out.designTokens.typography.fontFamily).toBe("Comic Sans MS, cursive");
  expect(out.designTokens.spacing.safeMarginPct).toBe(10);
  expect(out.designTokens.grid.safe.x).toBe("10%");
});

it("Design: generateDesignSystem applies complete overrides (colors/typography/spacing/effects)", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");

  const aiApiService = {
    chat: async () => ({ content: JSON.stringify(makeValidDynamicDesignSystem()) }),
  };

  const out = await generateDesignSystem(
    {
      contentSummary: "Demo",
      userPreferences: {
        designSystemOverrides: {
          colors: {
            background: { slide: "#0b1220", gradient: "#38bdf8", panel: "#111827" },
            text: { primary: "#e5e7eb", secondary: "#94a3b8", muted: "#94a3b8", inverse: "#0b1220" },
            accent: { primary: "#38bdf8", secondary: "#a3e635" },
            border: "#1f2937",
          },
          typography: { fontFamily: "Inter, system-ui", scale: { hero: 60, h1: 48, h2: 36, subtitle: 20, body: 16, caption: 12 } },
          spacing: { page: { marginX: 7, marginTop: 3, contentStartY: 12 }, element: { gapX: 10, gapY: 12 } },
          effects: { blur: 2, imageRadius: 16 },
        },
      },
    },
    { aiApiService, constraints: { theme: "dark" } }
  );

  expect(out.colors.background.slide).toBe("#0b1220");
  expect(out.typography.scale.h1).toBe(48);
  expect(out.spacing.element.gapX).toBe(10);
  expect(out.effects.blur).toBe(2);
  expect(out.designTokens.colors.bg).toBe("#0b1220");
});

it("Design: generateDesignSystem applies visualPreference override and syncs to legacy designTokens", async () => {
  const { generateDesignSystem } = await import("../../js/agents/stages/design/design-system-generator.js");

  const aiApiService = {
    chat: async () => ({ content: JSON.stringify(makeValidDynamicDesignSystem()) }),
  };

  const out = await generateDesignSystem(
    { contentSummary: "Demo", userPreferences: { designSystemOverrides: { visualPreference: "svg-first" } } },
    { aiApiService, constraints: { theme: "light" } }
  );

  expect(out.visualPreference.mode).toBe("svg-first");
  expect(out.designTokens.visualPreference.mode).toBe("svg-first");
});

it("Design: validateDesignSystem fails on broken schema + DSL violations", async () => {
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
  expect(res.ok).toBe(false);
  expect(res.errors.some(e => e.includes("minFontSize")));
  expect(res.errors.some(e => e.includes("marginX")));
  expect(res.errors.some(e => e.includes("invalid_color")));
 });

it("Design: DesignStage prefers dynamic design system generation when AI is available", async () => {
  const { DesignStage } = await import("../../js/agents/stages/design/design-agent.js");

  const calls = [];
  const prompts = [];
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
      prompts.push(joined);
      const batch = extractSlideIntentsFromPrompt(joined);
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

  expect(calls[0]).toBe("designSystem");
  expect(!calls.some(c => c.startsWith("brainstorm.")));
  expect(calls[calls.length - 1]).toBe("slides");
  expect(deck.designSystem?.colors?.accent?.primary).toBe("#7c3aed");
  expect(deck.designSystem?.designTokens?.colors?.primary).toBeDefined();

  // Just verify batch-generator received the slide intent
  const promptIntents = extractSlideIntentsFromPrompt(prompts[0]);
  expect(promptIntents[0].slideIntentId).toBe("s_cover");
});
