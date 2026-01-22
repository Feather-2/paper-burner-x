import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

it("ImageGeneration E2E: ImagePlanner -> PromptBuilder -> ImageGenerator (happy path)", async () => {
  const { ImagePlanner } = await import("../../../../js/agents/stages/design/image/image-planner.js");
  const { buildPrompt } = await import("../../../../js/agents/stages/design/image/image-prompt-builder.js");
  const { ImageGenerator } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10, candidatesPerSlot: 1 } },
  });
  const designSystem = { theme: "dark", imageStyle: "Modern, clean, high-contrast presentation style." };

  const slots = ImagePlanner.plan(contentPackage.slideIntents, designSystem, contentPackage.constraints);
  expect(slots.length).toBe(5); // cover + overview + comparison + process + summary
  expect(slots).toEqual(expect.arrayContaining([
    expect.objectContaining({ purpose: "hero", priority: "critical", aspectRatio: "16:9" }),
  ]));
  expect(slots).toEqual(expect.arrayContaining([
    expect.objectContaining({ purpose: "illustration", priority: "important", aspectRatio: "4:3" }),
  ]));
  expect(slots).toEqual(expect.arrayContaining([
    expect.objectContaining({ purpose: "chart_fallback", priority: "optional", aspectRatio: "16:9" }),
  ]));

  const hero = slots.find((s) => s.purpose === "hero");
  const prompt = buildPrompt(hero, designSystem, contentPackage);
  expect(prompt).toContain(`Topic: ${hero.promptHint}`);
  expect(prompt).toContain("Purpose: hero.");
  expect(prompt).toContain("Aspect ratio: 16:9");
  expect(prompt).toContain(designSystem.imageStyle);
  expect(prompt).toContain("Do not include any text in the image.");

  const provider = makeMockBase64Provider({ base64: "BASE64_1" });
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 2, budget: { maxImages: 20, maxCostUSD: 20, candidatesPerSlot: 1 } });
  const out = await gen.generate(slots, contentPackage, designSystem, { runId: contentPackage.runId });

  expect(provider.calls.length).toBe(slots.length);
  expect(out.report.schemaVersion).toBe("0.1");
  expect(out.report.runId).toBe(contentPackage.runId);
  expect(out.report.summary.planned).toBe(slots.length);
  expect(out.report.summary.succeeded).toBe(slots.length);
  expect(out.filledSlots.every(s => s.selectedId && Array.isArray(s.candidates) && s.candidates.length >= 1));
});

it("ImageGeneration E2E: PromptBuilder includes claim-derived keywords (integration)", async () => {
  const { buildPrompt } = await import("../../../../js/agents/stages/design/image/image-prompt-builder.js");
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
  expect(prompt).toContain("Key concepts:");
  expect(prompt.toLowerCase()).toContain("evidence");
  expect(prompt.toLowerCase()).toContain("citation");
  expect(prompt.toLowerCase()).toContain("tracking");
});

it("ImageGeneration E2E: DesignStage imagePolicy=rich plans enough slots and populates DeckPackage fields", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });
  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints }, emit });

  expect(deck.imageSlots).toBeInstanceOf(Array);
  expect(deck.imageSlots.length).toBeGreaterThanOrEqual(4);
  expect(deck.imageSlots).toEqual(expect.arrayContaining([
    expect.objectContaining({ priority: "critical" }),
  ]));
  expect(deck.imageSlots).toEqual(expect.arrayContaining([
    expect.objectContaining({ priority: "important" }),
  ]));
  expect(deck.imageSlots).toEqual(expect.arrayContaining([
    expect.objectContaining({ priority: "optional" }),
  ]));

  expect(deck.imageReport).toBe(null);
  expect(deck.pendingImages).toBeInstanceOf(Array);
  expect(deck.pendingImages).toHaveLength(deck.imageSlots.length);
  expect(typeof deck.deckHtmlDsl).toBe("string");
  expect(deck.deckHtmlDsl).toContain('data-el="image-placeholder"');
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "design.image.planning.completed" }),
  ]));
});

it("ImageGeneration E2E: DesignStage imagePolicy=minimal plans only critical slots", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "minimal", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });

  expect(deck.imageSlots).toBeInstanceOf(Array);
  expect(deck.imageSlots.length).toBe(1);
  expect(deck.imageSlots[0].priority).toBe("critical");
  expect(deck.pendingImages).toBeInstanceOf(Array);
  expect(deck.pendingImages).toHaveLength(1);
});

it("ImageGeneration E2E: DesignStage inserts placeholders for each planned slot", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");

  const contentPackage = makeContentPackage({
    constraints: { imagePolicy: "rich", imageBudget: { maxImages: 10, maxCostUSD: 10 } },
  });

  const stage = new DesignStage({ batchSize: 4 });
  const deck = await stage.run(contentPackage, { runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints } });

  const placeholders = deck.deckHtmlDsl.match(/data-el="image-placeholder"/g) || [];
  expect(placeholders.length).toBe(deck.imageSlots.length);

  for (const slot of deck.imageSlots) {
    expect(deck.deckHtmlDsl).toContain(`data-slot-id="${slot.slotId}"`);
    expect(deck.deckHtmlDsl).toContain(`id="${slot.slotId}"`);
  }
});

it("ImageGeneration E2E: DesignStage uses VisualRenderer and emits design.visual.render.* when imageProvider is set", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");

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

  expect(provider.calls.length).toBe(1);
  expect(deck.deckHtmlDsl).toContain('data-el="image"');
  expect(deck.deckHtmlDsl).toContain("data:image/png;base64,QUJD");
  expect(deck.pendingImages).toEqual([]);
  expect(deck.imageReport).toEqual(expect.objectContaining({ runId: contentPackage.runId }));

  const names = events.map((e) => e.name);
  expect(names).toContain("design.visual.render.started");
  expect(names).toContain("design.visual.render.completed");
});

it("ImageGeneration E2E: async fill replaces placeholder with <img data-el=\"image\"> (base64)", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

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
  expect(patched.deckHtmlDsl).toContain('data-el="image"');
  expect(patched.deckHtmlDsl).toContain(`id="${slotId}"`);
  expect(patched.deckHtmlDsl).toContain(`src="data:image/png;base64,QUJD"`);
  expect(patched.deckHtmlDsl).not.toContain(`data-el="image-placeholder" id="${slotId}"`);
});

it("ImageGeneration E2E: async fill emits per-task events + design.image.fill.completed", async () => {
  const { ImageGenerator } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const provider = makeMockBase64Provider({ base64: "BASE64_EVT" });
  const gen = new ImageGenerator({ imageProvider: provider, concurrency: 1, budget: { maxImages: 10, maxCostUSD: 10, maxRetries: 0, candidatesPerSlot: 1 } });
  await gen.generate([makeSlot({ slotId: "img_evt", slideIndex: 0, priority: "critical" })], makeContentPackage(), { imageStyle: "x" }, { runId: "run_evt", emit });

  const names = events.map((e) => e.name);
  expect(names).toEqual(["design:image:generate:started", "design:image:generate:succeeded", "design:image:fill:completed"]);
});

it("ImageGeneration E2E: provider failure retries then succeeds (retryCount=1) and fills placeholder", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

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

  expect(calls).toBe(2);
  expect(report.tasks[0].status).toBe("success");
  expect(report.tasks[0].retryCount).toBe(1);

  const patched = fillImagePlaceholders(deck.deckHtmlDsl, filledSlots);
  expect(patched.deckHtmlDsl).toContain(`id="${slotId}"`);
  expect(patched.deckHtmlDsl).toContain('data-el="image"');
  expect(patched.deckHtmlDsl).toContain("data:image/png;base64,RETRY_OK");
});

it("ImageGeneration E2E: exceeds maxRetries leaves placeholder (degraded) and reports failed", async () => {
  const { DesignStage } = await import("../../../../js/agents/stages/design/design-agent.js");
  const { ImageGenerator, fillImagePlaceholders } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

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

  expect(report.tasks[0].status).toBe("failed");
  const eventNames = events.map((e) => e.name);
  expect(eventNames).toContain("design:image:generate:failed");
  expect(eventNames).toContain("design:image:fill:completed");

  const patched = fillImagePlaceholders(deck.deckHtmlDsl, filledSlots);
  expect(patched.deckHtmlDsl).toContain(`data-el="image-placeholder" id="${slotId}"`);
  expect(patched.deckHtmlDsl).not.toContain(`src="data:`);
});

it("ImageGeneration E2E: over maxCostUSD skips optional slots first (priority ordering)", async () => {
  const { ImageGenerator } = await import("../../../../js/agents/stages/design/generators/image-generator.js");

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

  expect(report.summary.attempted).toBe(1);
  expect(report.summary.succeeded).toBe(1);
  expect(report.summary.skipped).toBe(2);
  expect(report.tasks.find(t => t.slotId === "img_critical")?.status).toBe("success");
  expect(report.tasks.find(t => t.slotId === "img_optional_1")?.status).toBe("skipped");
  expect(report.tasks.find(t => t.slotId === "img_optional_2")?.status).toBe("skipped");
});
