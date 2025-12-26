const test = require("node:test");
const assert = require("node:assert/strict");

test("batch-generator module exports generateBatch and generateSingleSlide", async () => {
  const module = await import("../../../js/agents/stages/design/generators/batch-generator.js");
  assert.ok(typeof module.generateBatch === "function", "generateBatch should be exported as a function");
  assert.ok(typeof module.generateSingleSlide === "function", "generateSingleSlide should be exported as a function");
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

test("design.slide.started event payload includes complete slideIntent fields", async () => {
  const { generateBatch } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

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

  const startedEvents = events.filter((e) => e.name === "design.slide.started");
  assert.equal(startedEvents.length, 2, "should emit design.slide.started for each slide");

  for (let i = 0; i < startedEvents.length; i++) {
    const evt = startedEvents[i];
    assert.equal(evt.record?.actor, "design", `event ${i}: actor should be "design"`);
    assert.equal(evt.record?.status, "started", `event ${i}: status should be "started"`);
    assert.ok(evt.record?.payload, `event ${i}: should have payload`);

    const slideIntent = evt.record.payload.slideIntent;
    assert.ok(slideIntent, `event ${i}: payload should have slideIntent`);
    assert.ok(slideIntent.id, `event ${i}: slideIntent should have id`);
    assert.ok(slideIntent.title, `event ${i}: slideIntent should have title`);
    assert.ok(slideIntent.pageType, `event ${i}: slideIntent should have pageType`);
    assert.ok(slideIntent.objective, `event ${i}: slideIntent should have objective`);
    assert.ok(Array.isArray(slideIntent.keyPoints), `event ${i}: slideIntent should have keyPoints array`);
    assert.ok(Array.isArray(slideIntent.claimIds), `event ${i}: slideIntent should have claimIds array`);
    assert.ok(Array.isArray(slideIntent.dataTableIds), `event ${i}: slideIntent should have dataTableIds array`);
  }

  const s1Event = startedEvents.find((e) => e.record?.payload?.slideIntent?.id === "s1");
  assert.equal(s1Event?.record?.payload?.slideIntent?.title, "Introduction");
  assert.equal(s1Event?.record?.payload?.slideIntent?.pageType, "cover");

  const s2Event = startedEvents.find((e) => e.record?.payload?.slideIntent?.id === "s2");
  assert.equal(s2Event?.record?.payload?.slideIntent?.title, "Overview");
  assert.equal(s2Event?.record?.payload?.slideIntent?.pageType, "overview");
});

test("design.slide.failed event payload contains error object with message and stack", async () => {
  const { generateBatch } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

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

  assert.equal(callCount, 2, "should retry once before falling back");

  const failedEvents = events.filter((e) => e.name === "design.slide.failed");
  assert.equal(failedEvents.length, 1, "should emit design.slide.failed once");

  const failedEvt = failedEvents[0];
  assert.equal(failedEvt.record?.actor, "design", "actor should be design");
  assert.equal(failedEvt.record?.status, "failed", "status should be failed");
  assert.ok(failedEvt.record?.payload, "should have payload");
  assert.ok(failedEvt.record?.payload?.error, "payload should have error field");

  const error = failedEvt.record.payload.error;
  assert.equal(typeof error, "object", "error should be an object");
  assert.ok(error.message, "error should have message property");
  assert.equal(typeof error.message, "string", "error.message should be a string");
  assert.ok(error.message.includes("Simulated LLM failure"), "error.message should contain failure details");
  assert.ok(error.stack !== undefined, "error should have stack property (may be undefined)");

  if (error.stack) {
    assert.equal(typeof error.stack, "string", "error.stack should be a string when present");
  }
});

test("design.slide.completed event is emitted with correct payload after successful generation", async () => {
  const { generateBatch } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

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

  const completedEvents = events.filter((e) => e.name === "design.slide.completed");
  assert.equal(completedEvents.length, 1, "should emit design.slide.completed once");

  const completedEvt = completedEvents[0];
  assert.equal(completedEvt.record?.actor, "design");
  assert.equal(completedEvt.record?.status, "completed");
  assert.ok(completedEvt.record?.payload);
  assert.equal(typeof completedEvt.record.payload.slideIndex, "number");
  assert.ok(completedEvt.record.payload.html);
  assert.equal(typeof completedEvt.record.payload.duration, "number");
  assert.ok(["llm", "fallback"].includes(completedEvt.record.payload.source));
});

test("design.batch.started and design.batch.completed events are emitted with correct structure", async () => {
  const { generateBatch } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

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

  const batchStartedEvents = events.filter((e) => e.name === "design.batch.started");
  const batchCompletedEvents = events.filter((e) => e.name === "design.batch.completed");

  assert.ok(batchStartedEvents.length >= 1, "should emit at least one design.batch.started");
  assert.ok(batchCompletedEvents.length >= 1, "should emit at least one design.batch.completed");

  for (const evt of batchStartedEvents) {
    assert.equal(evt.record?.actor, "design");
    assert.equal(evt.record?.status, "started");
    assert.ok(typeof evt.record?.payload?.batchIndex === "number");
    assert.ok(Array.isArray(evt.record?.payload?.slideIndexes));
  }

  for (const evt of batchCompletedEvents) {
    assert.equal(evt.record?.actor, "design");
    assert.equal(evt.record?.status, "completed");
    assert.ok(typeof evt.record?.payload?.batchIndex === "number");
    assert.ok(Array.isArray(evt.record?.payload?.slideIndexes));
    assert.ok(typeof evt.record?.payload?.duration === "number");
  }
});

test("generateBatch handles image slots and applies visual slot hints", async () => {
  const { generateBatch } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

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

  assert.equal(results.length, 1);
  assert.ok(results[0].slideHtml.includes('data-el="image-placeholder"'));
  assert.ok(results[0].slideHtml.includes('id="img_s1_hero"'));
});

test("fallback generation creates valid slide HTML when model fails", async () => {
  const { generateSingleSlide } = await import("../../../js/agents/stages/design/generators/batch-generator.js");

  const slideIntent = makeSlideIntent("s_fallback", "Fallback Slide", "overview");
  const designSystem = makeDesignSystem();
  const contentPackage = makeContentPackage([slideIntent]);

  const result = await generateSingleSlide(slideIntent, designSystem, "", {
    contentPackage,
    slideIndex: 0,
    slideNo: 1,
  });

  assert.equal(result.slideIntentId, "s_fallback");
  assert.equal(result.source, "fallback");
  assert.ok(result.slideHtml);
  assert.ok(result.slideHtml.includes('<section'));
  assert.ok(result.slideHtml.includes('data-type="freeform"'));
  assert.ok(result.slideHtml.includes('data-el='));
});
