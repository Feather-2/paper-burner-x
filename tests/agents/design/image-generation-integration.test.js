const test = require("node:test");
const assert = require("node:assert/strict");

function makeContentPackage({ runId = "run_img_e2e", slideCount = 6, constraints = {} } = {}) {
  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Demo Deck", objective: "A concise demo." },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda", keyPoints: ["Background", "Approach", "Results", "Next Steps"] },
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview", claimIds: ["c1"], keyPoints: ["Context and goals"] },
    { slideIntentId: "s_comp", pageType: "comparison", title: "Comparison", keyPoints: ["Option A vs B"] },
    { slideIntentId: "s_proc", pageType: "process", title: "Process", keyPoints: ["Ingest", "Plan", "Generate"] },
    { slideIntentId: "s_sum", pageType: "summary", title: "Summary", claimIds: ["c2"], keyPoints: ["Key takeaway 1", "Key takeaway 2"] },
    { slideIntentId: "s_app", pageType: "appendix", title: "Appendix" },
  ].slice(0, slideCount);

  return {
    schemaVersion: "0.1",
    runId,
    mode: "textprep",
    constraints,
    summary: "Demo Deck\nShort summary for the deck.",
    slideIntents,
    claims: [
      { claimId: "c1", text: "Claim 1: Evidence chain improves trust and auditability in workflows." },
      { claimId: "c2", text: "Claim 2: Citation tracking reduces hallucinations and increases reliability." },
    ],
    evidenceLedger: [{ evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" }],
  };
}

function makeMockAiApiService({ mode = "fallback" } = {}) {
  const calls = [];
  return {
    calls,
    async chat(opts = {}) {
      calls.push(opts);
      if (mode === "fallback") return { content: "not_json" }; // forces generateBatch() fallback DSL builder path
      return { content: "[]" };
    },
  };
}

function makeMockBase64Provider({ base64 = "QUJD", mimeType = "image/png", width = 1, height = 1 } = {}) {
  const calls = [];
  return {
    calls,
    provider: "mock",
    model: "m1",
    async generate(req) {
      calls.push(req);
      return { provider: "mock", model: "m1", mimeType, base64, url: null, width, height };
    },
  };
}

function makeSlot({ slotId, slideIndex, priority = "critical", aspectRatio = "16:9" } = {}) {
  return {
    slotId,
    slideIntentId: `s_${slotId}`,
    slideIndex,
    purpose: priority === "critical" ? "hero" : "illustration",
    promptHint: `Prompt for ${slotId}`,
    style: priority === "critical" ? "3d" : "flat",
    priority,
    aspectRatio,
  };
}

test("ImageGeneration E2E: ImagePlanner -> PromptBuilder -> ImageGenerator (happy path)", async () => {
  const { ImagePlanner } = await import("../../../js/agents/stages/design/image/image-planner.js");
  const { buildPrompt } = await import("../../../js/agents/stages/design/image/image-prompt-builder.js");
  const { ImageGenerator } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 1 } },
  });
  const designSystem = { theme: "dark", imageStyle: "Modern, clean, high-contrast presentation style." };

  const slots = ImagePlanner.plan(contentPackage.slideIntents, designSystem, contentPackage.constraints);
  assert.equal(slots.length, 5); // cover + overview + comparison + process + summary
  assert.ok(slots.some((s) => s.purpose === "hero" && s.priority === "critical" && s.aspectRatio === "16:9"));
  assert.ok(slots.some((s) => s.purpose === "illustration" && s.priority === "important" && s.aspectRatio === "4:3"));
  assert.ok(slots.some((s) => s.purpose === "chart_fallback" && s.priority === "optional" && s.aspectRatio === "16:9"));

  const hero = slots.find((s) => s.purpose === "hero");
  const prompt = buildPrompt(hero, designSystem, contentPackage);
  assert.ok(prompt.includes(`Topic: ${hero.promptHint}`));
  assert.ok(prompt.includes("Purpose: hero."));
  assert.ok(prompt.includes("Aspect ratio: 16:9"));
  assert.ok(prompt.includes(designSystem.imageStyle));
  assert.ok(prompt.includes("Do not include any text in the image."));

  const provider = makeMockBase64Provider({ base64: "BASE64_1" });
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 2, budget: { maxImages: 20, maxCostUSD: 20, candidatesPerSlot: 1 } });
  const out = await gen.generate(slots, contentPackage, designSystem, { runId: contentPackage.runId });

  assert.equal(provider.calls.length, slots.length);
  assert.equal(out.report.schemaVersion, "0.1");
  assert.equal(out.report.runId, contentPackage.runId);
  assert.equal(out.report.summary.planned, slots.length);
  assert.equal(out.report.summary.succeeded, slots.length);
  assert.ok(out.filledSlots.every((s) => s.selectedId && Array.isArray(s.candidates) && s.candidates.length >= 1));
});

test("ImageGeneration E2E: PromptBuilder includes claim-derived keywords (integration)", async () => {
  const { buildPrompt } = await import("../../../js/agents/stages/design/image/image-prompt-builder.js");
  const contentPackage = makeContentPackage();

  const slot = {
    slotId: "img_s2_illustration",
    slideIntentId: "s_overview",
    slideIndex: 2,
    purpose: "illustration",
    promptHint: "Evidence chain and citation tracking system",
    style: "3d",
    priority: "important",
    aspectRatio: "4:3",
    claimIds: ["c1", "c2"],
  };

  const prompt = buildPrompt(slot, { imageStyle: "Modern, high clarity." }, contentPackage);
  assert.ok(prompt.includes("Key concepts:"));
  assert.ok(prompt.toLowerCase().includes("evidence"));
  assert.ok(prompt.toLowerCase().includes("citation"));
  assert.ok(prompt.toLowerCase().includes("tracking"));
});

test("ImageGeneration E2E: DesignStage imagePolicy=rich plans enough slots and populates DeckPackage fields", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints }, emit });

  assert.ok(Array.isArray(deck.imageSlots) && deck.imageSlots.length >= 4);
  assert.ok(deck.imageSlots.some((s) => s.priority === "critical"));
  assert.ok(deck.imageSlots.some((s) => s.priority === "important"));
  assert.ok(deck.imageSlots.some((s) => s.priority === "optional"));

  assert.equal(deck.imageReport, null);
  assert.ok(Array.isArray(deck.pendingImages) && deck.pendingImages.length === deck.imageSlots.length);
  assert.ok(typeof deck.deckHtmlDsl === "string" && deck.deckHtmlDsl.includes('data-el="image-placeholder"'));
  assert.ok(events.some((e) => e.name === "design.image.planning.completed"));
});

test("ImageGeneration E2E: DesignStage imagePolicy=minimal plans only critical slots", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });

  assert.ok(Array.isArray(deck.imageSlots));
  assert.equal(deck.imageSlots.length, 1);
  assert.equal(deck.imageSlots[0].priority, "critical");
  assert.ok(Array.isArray(deck.pendingImages) && deck.pendingImages.length === 1);
});

test("ImageGeneration E2E: DesignStage inserts placeholders for each planned slot", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });

  const placeholders = deck.deckHtmlDsl.match(/data-el="image-placeholder"/g) || [];
  assert.equal(placeholders.length, deck.imageSlots.length);

  for (const slot of deck.imageSlots) {
    assert.ok(deck.deckHtmlDsl.includes(`data-slot-id="${slot.slotId}"`));
    assert.ok(deck.deckHtmlDsl.includes(`id="${slot.slotId}"`));
  }
});

test("ImageGeneration E2E: DesignStage uses VisualRenderer and emits design.visual.render.* when imageProvider is set", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const provider = makeMockBase64Provider({ base64: "QUJD" }); // ABC
  const stage = new DesignStage({ batchSize: 2 });
  const deck = await stage.run(contentPackage, {
    runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints },
    emit,
    imageProvider: provider,
  });

  assert.equal(provider.calls.length, 1);
  assert.ok(deck.deckHtmlDsl.includes('data-el="image"'));
  assert.ok(deck.deckHtmlDsl.includes("data:image/png;base64,QUJD"));
  assert.deepEqual(deck.pendingImages, []);
  assert.ok(deck.imageReport && deck.imageReport.runId === contentPackage.runId);

  const names = events.map((e) => e.name);
  assert.ok(names.includes("design.visual.render.started"));
  assert.ok(names.includes("design.visual.render.completed"));
});

test("ImageGeneration E2E: async fill replaces placeholder with <img data-el=\"image\"> (base64)", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });
  const slotId = deck.imageSlots[0].slotId;

  const provider = makeMockBase64Provider({ base64: "QUJD" }); // ABC
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 1 } });
  const { filledSlots } = await gen.generate(deck.imageSlots, contentPackage, deck.designSystem, { runId: contentPackage.runId });

  const patched = fillImagePlaceholders(deck.deckHtmlDsl, filledSlots);
  assert.ok(patched.deckHtmlDsl.includes('data-el="image"'));
  assert.ok(patched.deckHtmlDsl.includes(`id="${slotId}"`));
  assert.ok(patched.deckHtmlDsl.includes(`src="data:image/png;base64,QUJD"`));
  assert.ok(!patched.deckHtmlDsl.includes(`data-el="image-placeholder" id="${slotId}"`));
});

test("ImageGeneration E2E: async fill emits per-task events + design.image.fill.completed", async () => {
  const { ImageGenerator } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const provider = makeMockBase64Provider({ base64: "BASE64_EVT" });
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, maxRetries: 0, candidatesPerSlot: 1 } });
  await gen.generate([makeSlot({ slotId: "img_evt", slideIndex: 0, priority: "critical" })], makeContentPackage(), { imageStyle: "x" }, { runId: "run_evt", emit });

  const names = events.map((e) => e.name);
  assert.deepEqual(names, ["design.image.generate.started", "design.image.generate.succeeded", "design.image.fill.completed"]);
});

test("ImageGeneration E2E: provider failure retries then succeeds (retryCount=1) and fills placeholder", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });
  const slotId = deck.imageSlots[0].slotId;

  let calls = 0;
  const provider = {
    provider: "mock",
    model: "m1",
    async generate() {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return { provider: "mock", model: "m1", mimeType: "image/png", base64: "RETRY_OK", url: null, width: 1, height: 1 };
    },
  };

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, maxRetries: 2, candidatesPerSlot: 1 } });
  const { filledSlots, report } = await gen.generate(deck.imageSlots, contentPackage, deck.designSystem, { runId: contentPackage.runId });

  assert.equal(calls, 2);
  assert.equal(report.tasks[0].status, "success");
  assert.equal(report.tasks[0].retryCount, 1);

  const patched = fillImagePlaceholders(deck.deckHtmlDsl, filledSlots);
  assert.ok(patched.deckHtmlDsl.includes(`id="${slotId}"`));
  assert.ok(patched.deckHtmlDsl.includes('data-el="image"'));
  assert.ok(patched.deckHtmlDsl.includes("data:image/png;base64,RETRY_OK"));
});

test("ImageGeneration E2E: exceeds maxRetries leaves placeholder (degraded) and reports failed", async () => {
  const { DesignStage } = await import("../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });
  const slotId = deck.imageSlots[0].slotId;

  const provider = {
    provider: "mock",
    model: "m1",
    async generate() {
      throw new Error("always_fail");
    },
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, maxRetries: 1, candidatesPerSlot: 1 } });
  const { filledSlots, report } = await gen.generate(deck.imageSlots, contentPackage, deck.designSystem, { runId: contentPackage.runId, emit });

  assert.equal(report.tasks[0].status, "failed");
  assert.ok(events.some((e) => e.name === "design.image.generate.failed"));
  assert.ok(events.some((e) => e.name === "design.image.fill.completed"));

  const patched = fillImagePlaceholders(deck.deckHtmlDsl, filledSlots);
  assert.ok(patched.deckHtmlDsl.includes(`data-el="image-placeholder" id="${slotId}"`));
  assert.ok(!patched.deckHtmlDsl.includes(`src="data:`));
});

test("ImageGeneration E2E: over maxCostUSD skips optional slots first (priority ordering)", async () => {
  const { ImageGenerator } = await import("../../../js/agents/stages/design/generators/image-generator.js");

  const provider = {
    provider: "openai-image",
    model: "gpt-image-1",
    async generate() {
      return { provider: "openai-image", model: "gpt-image-1", mimeType: "image/png", url: "https://example.com/x.png", width: 1, height: 1 };
    },
  };

  const slots = [
    makeSlot({ slotId: "img_critical", slideIndex: 0, priority: "critical" }), // should run first
    makeSlot({ slotId: "img_optional_1", slideIndex: 1, priority: "optional" }),
    makeSlot({ slotId: "img_optional_2", slideIndex: 2, priority: "optional" }),
  ];

  const gen = new ImageGenerator({
    imageProvider: provider,
    concurrency: 2,
    budget: { maxImages: 10, maxCostUSD: 0.05, maxRetries: 0, candidatesPerSlot: 1 },
  });

  const { report } = await gen.generate(slots, makeContentPackage({ runId: "run_budget", constraints: { imagePolicy: "rich" } }), { imageStyle: "x" }, { runId: "run_budget" });

  assert.equal(report.summary.attempted, 1);
  assert.equal(report.summary.succeeded, 1);
  assert.equal(report.summary.skipped, 2);
  assert.ok(report.tasks.find((t) => t.slotId === "img_critical")?.status === "success");
  assert.ok(report.tasks.find((t) => t.slotId === "img_optional_1")?.status === "skipped");
  assert.ok(report.tasks.find((t) => t.slotId === "img_optional_2")?.status === "skipped");
});
