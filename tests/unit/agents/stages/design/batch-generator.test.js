import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("batch-generator module exports generateBatch and generateSingleSlide", async () => {
  const module = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");
  expect(module.generateBatch, "generateBatch should be exported as a function").toBeTypeOf("function");
  expect(module.generateSingleSlide, "generateSingleSlide should be exported as a function").toBeTypeOf("function");
});

function makeSlideIntent(id, title = "Test Slide", pageType = "overview") {
  return {
    slideIntentId: id,
    pageType,
    title,
    objective: `Objective for ${title}`,
    keyPoints: ["Key point 1", "Key point 2"],
    claimIds: ["c1", "c2"],
    dataTableIds: ["t1"],
  };
}

function makeDesignSystem() {
  return {
    theme: "light",
    designTokens: {
      colors: { bg: "#ffffff", text: "#111111", primary: "#0ea5e9" },
      typography: { fontFamily: "Inter", baseFontSize: 16 },
    },
  };
}

function makeContentPackage(slideIntents) {
  return {
    schemaVersion: "0.1",
    runId: "run_test",
    constraints: { pageCount: slideIntents.length, tone: "professional", audience: "executives" },
    summary: "Test deck summary",
    slideIntents,
    claims: [
      { claimId: "c1", text: "Claim 1 text", evidenceIds: ["e1"] },
      { claimId: "c2", text: "Claim 2 text", evidenceIds: ["e2"] },
    ],
    evidenceLedger: [
      { evidenceId: "e1", sourceId: "src1", locator: { charStart: 0, charEnd: 10 }, quote: "Evidence 1" },
      { evidenceId: "e2", sourceId: "src2", locator: { charStart: 0, charEnd: 10 }, quote: "Evidence 2" },
    ],
  };
}

it("design:slide.started event payload includes complete slideIntent fields", async () => {
  const { generateBatch } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slideIntents = [makeSlideIntent("s1", "Introduction", "cover"), makeSlideIntent("s2", "Overview", "overview")];
  const contentPackage = makeContentPackage(slideIntents);
  const designSystem = makeDesignSystem();

  const mockModelCaller = async () => ({
    content: JSON.stringify([
      { slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">S1</div></section>' },
      { slideIntentId: "s2", slideHtml: '<section data-type="freeform"><div data-el="text">S2</div></section>' },
    ]),
  });

  await generateBatch(slideIntents, contentPackage, designSystem, {
    emit,
    modelCaller: mockModelCaller,
    batchSize: 2,
  });

  const startedEvents = events.filter((e) => e.name === "design:slide.started");
  expect(startedEvents.length).toBe(2, "should emit design:slide.started for each slide");

  for (let i = 0; i < startedEvents.length; i++) {
    const evt = startedEvents[i];
    expect(evt.record?.actor).toBe("design", `event ${i}: actor should be "design"`);
    expect(evt.record?.status).toBe("started", `event ${i}: status should be "started"`);
    expect(evt.record?.payload, `event ${i}: should have payload`).toEqual(expect.any(Object));

    const slideIntent = evt.record.payload.slideIntent;
    expect(slideIntent, `event ${i}: payload should have slideIntent`).toEqual(expect.any(Object));
    expect(slideIntent.id, `event ${i}: slideIntent should have id`).toBeTypeOf("string");
    expect(slideIntent.id.length, `event ${i}: slideIntent id should not be empty`).toBeGreaterThan(0);
    expect(slideIntent.title, `event ${i}: slideIntent should have title`).toBeTypeOf("string");
    expect(slideIntent.title.length, `event ${i}: slideIntent title should not be empty`).toBeGreaterThan(0);
    expect(slideIntent.pageType, `event ${i}: slideIntent should have pageType`).toBeTypeOf("string");
    expect(slideIntent.pageType.length, `event ${i}: slideIntent pageType should not be empty`).toBeGreaterThan(0);
    expect(slideIntent.objective, `event ${i}: slideIntent should have objective`).toBeTypeOf("string");
    expect(slideIntent.objective.length, `event ${i}: slideIntent objective should not be empty`).toBeGreaterThan(0);
    expect(Array.isArray(slideIntent.keyPoints)).toBe(true);
    expect(Array.isArray(slideIntent.claimIds)).toBe(true);
    expect(Array.isArray(slideIntent.dataTableIds)).toBe(true);
  }

  const s1Event = startedEvents.find((e) => e.record?.payload?.slideIntent?.id === "s1");
  expect(s1Event?.record?.payload?.slideIntent?.title).toBe("Introduction");
  expect(s1Event?.record?.payload?.slideIntent?.pageType).toBe("cover");

  const s2Event = startedEvents.find((e) => e.record?.payload?.slideIntent?.id === "s2");
  expect(s2Event?.record?.payload?.slideIntent?.title).toBe("Overview");
  expect(s2Event?.record?.payload?.slideIntent?.pageType).toBe("overview");
});

it("design:slide.failed event payload contains error object with message and stack", async () => {
  const { generateBatch } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slideIntents = [makeSlideIntent("s1", "Failing Slide", "overview")];
  const contentPackage = makeContentPackage(slideIntents);
  const designSystem = makeDesignSystem();

  let callCount = 0;
  const mockModelCaller = async () => {
    callCount++;
    const err = new Error("Simulated LLM failure");
    err.stack = "Error: Simulated LLM failure\n    at mockModelCaller (test.js:1:1)";
    throw err;
  };

  await generateBatch(slideIntents, contentPackage, designSystem, {
    emit,
    modelCaller: mockModelCaller,
    batchSize: 1,
  });

  expect(callCount).toBe(2, "should retry once before falling back");

  const failedEvents = events.filter((e) => e.name === "design:slide.failed");
  expect(failedEvents.length).toBe(1, "should emit design:slide.failed once");

  const failedEvt = failedEvents[0];
  expect(failedEvt.record?.actor).toBe("design", "actor should be design");
  expect(failedEvt.record?.status).toBe("failed", "status should be failed");
  expect(failedEvt.record?.payload, "should have payload").toEqual(expect.any(Object));
  expect(failedEvt.record?.payload?.error, "payload should have error field").toEqual(expect.any(Object));

  const error = failedEvt.record.payload.error;
  expect(error).toEqual(expect.any(Object));
  expect(error.message, "error should have message property").toBeTypeOf("string");
  expect(error.message.length, "error.message should not be empty").toBeGreaterThan(0);
  expect(error.message.includes("Simulated LLM failure")).toBe(true);
  expect("stack" in error).toBe(true);

  if (error.stack) {
    expect(typeof error.stack).toBe("string", "error.stack should be a string when present");
  }
});

it("design:slide.completed event is emitted with correct payload after successful generation", async () => {
  const { generateBatch } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slideIntents = [makeSlideIntent("s1", "Success Slide", "overview")];
  const contentPackage = makeContentPackage(slideIntents);
  const designSystem = makeDesignSystem();

  const mockModelCaller = async () => ({
    content: JSON.stringify([{ slideIntentId: "s1", slideHtml: '<section data-type="freeform"><div data-el="text">Content</div></section>' }]),
  });

  await generateBatch(slideIntents, contentPackage, designSystem, {
    emit,
    modelCaller: mockModelCaller,
    batchSize: 1,
  });

  const completedEvents = events.filter((e) => e.name === "design:slide.completed");
  expect(completedEvents.length).toBe(1, "should emit design:slide.completed once");

  const completedEvt = completedEvents[0];
  expect(completedEvt.record?.actor).toBe("design");
  expect(completedEvt.record?.status).toBe("completed");
  expect(completedEvt.record?.payload).toEqual(expect.any(Object));
  expect(completedEvt.record.payload.slideIndex).toBeTypeOf("number");
  expect(completedEvt.record.payload.html).toBeTypeOf("string");
  expect(completedEvt.record.payload.html.length).toBeGreaterThan(0);
  expect(completedEvt.record.payload.duration).toBeTypeOf("number");
  expect(["llm", "fallback"].includes(completedEvt.record.payload.source)).toBe(true);
});

it("design:batch.started and design:batch.completed events are emitted with correct structure", async () => {
  const { generateBatch } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slideIntents = [makeSlideIntent("s1", "Slide 1"), makeSlideIntent("s2", "Slide 2"), makeSlideIntent("s3", "Slide 3")];
  const contentPackage = makeContentPackage(slideIntents);
  const designSystem = makeDesignSystem();

  const mockModelCaller = async () => ({
    content: JSON.stringify(slideIntents.map((s) => ({ slideIntentId: s.slideIntentId, slideHtml: '<section data-type="freeform"><div data-el="text">X</div></section>' }))),
  });

  await generateBatch(slideIntents, contentPackage, designSystem, {
    emit,
    modelCaller: mockModelCaller,
    batchSize: 2,
  });

  const batchStartedEvents = events.filter((e) => e.name === "design:batch.started");
  const batchCompletedEvents = events.filter((e) => e.name === "design:batch.completed");

  expect(batchStartedEvents.length, "should emit at least one design:batch.started").toBeGreaterThan(0);
  expect(batchCompletedEvents.length, "should emit at least one design:batch.completed").toBeGreaterThan(0);

  for (const evt of batchStartedEvents) {
    expect(evt.record?.actor).toBe("design");
    expect(evt.record?.status).toBe("started");
    expect(evt.record?.payload?.batchIndex).toBeTypeOf("number");
    expect(Array.isArray(evt.record?.payload?.slideIndexes)).toBe(true);
  }

  for (const evt of batchCompletedEvents) {
    expect(evt.record?.actor).toBe("design");
    expect(evt.record?.status).toBe("completed");
    expect(evt.record?.payload?.batchIndex).toBeTypeOf("number");
    expect(Array.isArray(evt.record?.payload?.slideIndexes)).toBe(true);
    expect(evt.record?.payload?.duration).toBeTypeOf("number");
  }
});

it("generateBatch handles image slots and applies visual slot hints", async () => {
  const { generateBatch } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const slideIntents = [makeSlideIntent("s1", "Slide with Images")];
  const contentPackage = makeContentPackage(slideIntents);
  const designSystem = makeDesignSystem();

  const imageSlots = [
    {
      slotId: "img_s1_hero",
      slideIntentId: "s1",
      slideIndex: 0,
      purpose: "hero",
      aspectRatio: "16:9",
      priority: "critical",
      renderType: "ai-image",
    },
  ];

  const selectedIdeas = [
    {
      slideIntentId: "s1",
      atmosphere: { mood: "Professional", colorScheme: "Blue", visualWeight: "Balanced" },
      elementsMarkdown: "- Hero image\n- Title",
      visualSlots: [
        {
          slotId: "img_s1_hero",
          renderType: "ai-image",
          position: { x: "5%", y: "10%", w: "90%", h: "50%" },
          effects: { blend: "multiply", opacity: 0.9 },
        },
      ],
    },
  ];

  const mockModelCaller = async () => ({
    content: JSON.stringify([
      {
        slideIntentId: "s1",
        slideHtml: '<section data-type="freeform"><div data-el="image-placeholder" id="img_s1_hero" data-slot-id="img_s1_hero"></div></section>',
      },
    ]),
  });

  const results = await generateBatch(slideIntents, contentPackage, designSystem, {
    emit,
    modelCaller: mockModelCaller,
    imageSlots,
    selectedIdeas,
    batchSize: 1,
  });

  expect(results.length).toBe(1);
  expect(results[0].slideHtml.includes('data-el="image-placeholder"')).toBe(true);
  expect(results[0].slideHtml.includes('id="img_s1_hero"')).toBe(true);
});

it("fallback generation creates valid slide HTML when model fails", async () => {
  const { generateSingleSlide } = await import("../../../../../js/agents/stages/design/generators/batch-generator.js");

  const slideIntent = makeSlideIntent("s_fallback", "Fallback Slide", "overview");
  const designSystem = makeDesignSystem();
  const contentPackage = makeContentPackage([slideIntent]);

  const result = await generateSingleSlide(slideIntent, designSystem, "", {
    contentPackage,
    slideIndex: 0,
    slideNo: 1,
  });

  expect(result.slideIntentId).toBe("s_fallback");
  expect(result.source).toBe("fallback");
  expect(result.slideHtml).toBeTypeOf("string");
  expect(result.slideHtml.length).toBeGreaterThan(0);
  expect(result.slideHtml.includes("<section")).toBe(true);
  expect(result.slideHtml.includes('data-type="freeform"')).toBe(true);
  expect(result.slideHtml.includes("data-el=")).toBe(true);
});
