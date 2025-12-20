const test = require("node:test");
const assert = require("node:assert/strict");

function makeContentPackage({ runId = "run_test", slideCount = 2 } = {}) {
  const slideIntents = Array.from({ length: slideCount }, (_, idx) => ({
    slideIntentId: `s_${idx + 1}`,
    pageType: "overview",
    title: `Slide ${idx + 1}`,
    keyPoints: ["Point A", "Point B"],
  }));

  return {
    schemaVersion: "0.1",
    runId,
    mode: "textprep",
    constraints: { pageCount: slideCount, tone: "business" },
    summary: "Test deck",
    slideIntents,
    claims: [],
    evidenceLedger: [],
  };
}

function makeDesignSystem() {
  return {
    designTokens: {
      colors: {
        bg: "#ffffff",
        text: "#111827",
        muted: "#6b7280",
        border: "#e5e7eb",
        panel: "#ffffff",
      },
      typography: {
        minFont: 12,
        titleFont: 44,
        subtitleFont: 18,
        bodyFont: 16,
      },
    },
  };
}

async function makeSlideHtml(slideIntent, designSystem, contentPackage) {
  const { buildSlideHtml } = await import("../../../js/agents/stages/design/dsl-builder.js");
  return buildSlideHtml(slideIntent, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
}

test("DesignAgentLoop runs phases, uses tools, emits events", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = makeDesignSystem();

  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      const slideHtmls = await Promise.all(
        params.slideIntents.map((intent) => makeSlideHtml(intent, designSystem, params.contentPackage))
      );
      return {
        ok: true,
        data: {
          generated: slideHtmls.map((slideHtml) => ({ slideHtml, source: "mock" })),
        },
      };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop({ batchSize: 2 });
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_test", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.schemaVersion, "0.1");
  assert.equal(deck.slidesMeta.length, 2);
  assert.ok(deck.deckHtmlDsl.includes("<section"));

  assert.deepEqual(calls, ["parse_outline", "extract_style", "spawn_slide_agent", "fill_visual"]);

  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  assert.deepEqual(transitions, [
    DesignPhase.OUTLINE_PARSING,
    DesignPhase.OUTLINE_CONFIRMING,
    DesignPhase.STYLE_EXTRACTING,
    DesignPhase.STYLE_CONFIRMING,
    DesignPhase.GENERATING,
    DesignPhase.REVIEWING,
    DesignPhase.VISUAL_FILLING,
    DesignPhase.COMPLETED,
  ]);

  assert.ok(events.some((evt) => evt.name === "design.started"));
  assert.ok(events.some((evt) => evt.name === "design.tokens.ended"));
  assert.ok(events.some((evt) => evt.name === "design.generate.ended"));
  assert.ok(events.some((evt) => evt.name === "design.qa.ended"));
  assert.ok(events.some((evt) => evt.name === "design.ended"));
});

test("DesignAgentLoop waits for confirmations and resume", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();
  const eventBus = new EventBus({ runId: "run_interactive" });

  const updatedSlides = [
    { slideIntentId: "s_new", pageType: "summary", title: "Updated", keyPoints: ["A"] },
  ];

  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      const slideHtmls = await Promise.all(
        params.slideIntents.map((intent, idx) => makeSlideHtml(intent, designSystem, params.contentPackage))
      );
      return {
        ok: true,
        data: {
          generated: slideHtmls.map((slideHtml) => ({ slideHtml, source: "mock" })),
        },
      };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => {
    events.push({ name, record });
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.OUTLINE_CONFIRMING) {
      setTimeout(() => eventBus.emit("user.action.confirm_outline", { slideIntents: updatedSlides }), 0);
    }
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.STYLE_CONFIRMING) {
      setTimeout(() => eventBus.emit("user.action.confirm_style", { ok: true }), 0);
    }
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.GENERATING_PAUSED) {
      setTimeout(() => eventBus.emit("user.action.resume_generating", { action: "resume" }), 0);
    }
  };

  const loop = new DesignAgentLoop();
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_interactive", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    eventBus,
    interactionMode: { outlineConfirm: "confirm", styleConfirm: "confirm" },
    pauseGenerating: true,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.slidesMeta.length, updatedSlides.length);
  assert.ok(events.some((evt) => evt.name === "design.phase.transition" && evt.record.payload.to === DesignPhase.GENERATING_PAUSED));
  assert.ok(calls.includes("spawn_slide_agent"));
});

test("DesignAgentLoop downgrades when QA fails", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();

  const invalidSlide =
    '<section data-type="freeform" data-bg="#ffffff">' +
    '<div data-el="text" data-font="8" data-x="0%" data-y="0%" data-w="20%" data-h="20%"></div>' +
    "</section>";

  const toolExecutor = async (name) => {
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      return { ok: true, data: { generated: [{ slideHtml: invalidSlide, source: "mock" }] } };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: invalidSlide, pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop();
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_degraded", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.editHints.degradedCount, 1);
  assert.equal(deck.slidesMeta[0].degraded, true);
  assert.ok(events.some((evt) => evt.name === "design.degraded"));
});

test("DesignAgentLoop._renderVisuals fills placeholders", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { VisualRenderer } = await import("../../../js/agents/stages/design/visual-renderer.js");

  const loop = new DesignAgentLoop();
  const originalRender = VisualRenderer.prototype.render;

  VisualRenderer.prototype.render = async () => ({
    report: { errors: [], hasFatalError: false, svgReport: null },
    imageResults: {
      filledSlots: [{ slotId: "img1", candidates: [{ url: "https://example.com/i.png" }] }],
      report: { schemaVersion: "0.1" },
    },
    svgResults: [{ slotId: "svg1", svgContent: "<svg></svg>" }],
    assetResults: [{ slotId: "asset1", assetUri: "https://example.com/a.png", width: 10, height: 10 }],
  });

  try {
    const slideHtml =
      '<section data-type="freeform" data-bg="#ffffff">' +
      '<div data-el="image-placeholder" data-slot-id="img1"></div>' +
      '<div data-el="image-placeholder" data-slot-id="svg1" data-render-type="svg"></div>' +
      '<div data-el="image-placeholder" data-slot-id="asset1" data-render-type="asset"></div>' +
      "</section>";

    const result = await loop._renderVisuals(
      [
        { slotId: "img1", renderType: "ai-image", slideIndex: 0 },
        { slotId: "svg1", renderType: "svg", slideIndex: 0 },
        { slotId: "asset1", renderType: "asset", slideIndex: 0 },
      ],
      makeContentPackage({ slideCount: 1 }),
      makeDesignSystem(),
      [slideHtml],
      { emit: () => {} },
      { runId: "run_visuals" },
      { imagePolicy: "balanced" },
      [
        { slotId: "img1" },
        { slotId: "svg1" },
        { slotId: "asset1" },
      ],
      ["img1"]
    );

    assert.ok(result.deckHtmlDsl.includes("data-el=\"image\""));
    assert.ok(result.deckHtmlDsl.includes("data-el=\"svg\""));
    assert.ok(result.deckHtmlDsl.includes("data-render-type=\"asset\""));
    assert.deepEqual(result.pendingImages, []);
  } finally {
    VisualRenderer.prototype.render = originalRender;
  }
});

test("DesignAgentLoop._renderVisuals handles renderer errors", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { VisualRenderer } = await import("../../../js/agents/stages/design/visual-renderer.js");

  const loop = new DesignAgentLoop();
  const originalRender = VisualRenderer.prototype.render;

  VisualRenderer.prototype.render = async () => {
    throw new Error("Render exploded");
  };

  try {
    const result = await loop._renderVisuals(
      [{ slotId: "img1", renderType: "ai-image", slideIndex: 0 }],
      makeContentPackage({ slideCount: 1 }),
      makeDesignSystem(),
      ['<section data-type="freeform" data-bg="#ffffff"></section>'],
      { emit: () => {} },
      { runId: "run_error" },
      { imagePolicy: "balanced" },
      [{ slotId: "img1" }],
      ["img1"]
    );

    assert.equal(result.visualReport.hasFatalError, true);
    assert.ok(result.imageReport.error.includes("Render exploded"));
    assert.deepEqual(result.pendingImages, ["img1"]);
  } finally {
    VisualRenderer.prototype.render = originalRender;
  }
});

test("DesignAgentLoop._toolChatAsk waits for user action", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  const loop = new DesignAgentLoop();
  const eventBus = new EventBus({ runId: "run_chat" });
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const promise = loop._toolChatAsk({ message: "Hello", actionName: "chat_reply" }, { eventBus, emit });
  eventBus.emit("user.action.chat_reply", { reply: "ok" });

  const result = await promise;

  assert.equal(result.actionName, "chat_reply");
  assert.deepEqual(result.payload, { reply: "ok" });
  assert.ok(events.some((evt) => evt.name === "design.chat.ask"));
});

test("DesignAgentLoop._callTool resolves executors and reports errors", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();

  const errorResult = await loop._callTool("parse_outline", {}, { toolExecutor: async () => ({ error: "nope" }) });
  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.error, "nope");

  const rawResult = await loop._callTool("parse_outline", {}, { tools: { execute: async () => "raw" } });
  assert.equal(rawResult.ok, true);
  assert.equal(rawResult.data, "raw");

  loop._tools.thrower = async () => {
    throw new Error("boom");
  };
  const thrown = await loop._callTool("thrower", {}, {});
  assert.equal(thrown.ok, false);
  assert.equal(thrown.error, "boom");

  const missing = await loop._callTool("unknown_tool", {}, {});
  assert.equal(missing.ok, false);
  assert.ok(missing.error.includes("Unknown tool"));
});

test("DesignAgentLoop.waitForUserAction requires an event bus", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  await assert.rejects(loop.waitForUserAction("confirm_outline"), /eventBus/);
});

test("DesignAgentLoop._buildVisualSlots falls back to svg without image provider", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const slots = loop._buildVisualSlots(
    {
      candidatesBySlide: [
        {
          selectedCandidate: {
            visualSlots: [
              {
                slotId: "slot_1",
                slideIndex: 0,
                renderType: "ai-image",
                purpose: "chart_fallback",
                imageSpec: { prompt: "Use bars" },
              },
            ],
          },
        },
      ],
    },
    [],
    null
  );

  assert.equal(slots.length, 1);
  assert.equal(slots[0].renderType, "svg");
  assert.equal(slots[0].svgSpec.type, "chart");
  assert.equal(slots[0].svgSpec.description, "Use bars");
});

test("DesignAgentLoop._buildVisualSlots falls back to image slots when brainstorm empty", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const slots = loop._buildVisualSlots(
    { candidatesBySlide: [] },
    [
      {
        slotId: "img_1",
        slideIntentId: "s1",
        slideIndex: 0,
        renderType: "ai-image",
        priority: 1,
        aspectRatio: "16:9",
        purpose: "hero",
        promptHint: "Mountain view",
        style: "photo",
        effects: { blur: 2 },
        assetId: "asset_1",
      },
    ],
    {}
  );

  assert.equal(slots.length, 1);
  assert.equal(slots[0].renderType, "ai-image");
  assert.equal(slots[0].imageSpec.prompt, "Mountain view");
  assert.equal(slots[0].imageSpec.style, "photo");
  assert.equal(slots[0].assetSpec.assetId, "asset_1");
  assert.deepEqual(slots[0].effects, { blur: 2 });
});

test("DesignAgentLoop._renderVisuals returns defaults when no visual slots", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const slideHtmls = ["<section data-type=\"freeform\"></section>"];
  const result = await loop._renderVisuals(
    [],
    makeContentPackage({ slideCount: 1 }),
    makeDesignSystem(),
    slideHtmls,
    { emit: () => {} },
    { runId: "run_empty" },
    {},
    [],
    []
  );

  assert.equal(result.visualReport, null);
  assert.equal(result.imageReport, null);
  assert.deepEqual(result.finalImageSlots, []);
  assert.equal(result.deckHtmlDsl, slideHtmls.join("\n\n"));
});

test("DesignAgentLoop emits image planning events when configured", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();
  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      const slideHtmls = await Promise.all(
        params.slideIntents.map((intent) => makeSlideHtml(intent, designSystem, params.contentPackage))
      );
      return { ok: true, data: { generated: slideHtmls.map((slideHtml) => ({ slideHtml })) } };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop();
  await loop.run(contentPackage, {
    runContext: { runId: "run_planning", constraints: { imagePolicy: "balanced", imageBudget: 1 } },
    toolExecutor,
    emit,
    brainstormResult: {
      ideaPool: [],
      selectedIdeas: [],
      imageSlots: [
        { slotId: "img_1", style: "photo", renderType: "ai-image" },
        { slotId: "img_2", style: "photo", renderType: "ai-image" },
      ],
      candidatesBySlide: [],
    },
  });

  const planning = events.find((evt) => evt.name === "design.image.planning.completed");
  assert.ok(planning, "planning event should be emitted");
  assert.equal(planning.record.payload.planned, 2);
  assert.equal(planning.record.payload.estimatedCostUSD, 0.08);
  assert.ok(calls.includes("spawn_slide_agent"));
});

test("DesignAgentLoop.getToolDefinitions returns a copy", async () => {
  const { DesignAgentLoop, DESIGN_AGENT_TOOL_DEFINITIONS } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const defs = loop.getToolDefinitions();
  defs.push({ name: "fake_tool" });

  const next = loop.getToolDefinitions();
  assert.equal(next.some((def) => def.name === "fake_tool"), false);
  assert.notEqual(defs, DESIGN_AGENT_TOOL_DEFINITIONS);
});

test("DesignAgentLoop.waitForUserAction handles aborts and timeouts", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");

  const loop = new DesignAgentLoop();
  const eventBus = new EventBus({ runId: "run_wait" });
  const controller = new AbortController();

  const aborted = loop.waitForUserAction("confirm_outline", { eventBus, signal: controller.signal });
  controller.abort({ code: "stop" });
  await assert.rejects(aborted, /Run cancelled/);

  const timed = loop.waitForUserAction("confirm_outline", { eventBus, timeout: 5 });
  await assert.rejects(timed, /Timeout waiting for user action/);
});

test("DesignAgentLoop rejects when cancelled", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const contentPackage = makeContentPackage({ slideCount: 1 });
  const controller = new AbortController();
  controller.abort({ code: "stop" });

  await assert.rejects(
    loop.run(contentPackage, { runContext: { runId: "run_cancel", constraints: contentPackage.constraints }, signal: controller.signal }),
    /Run cancelled/
  );
});

test("DesignAgentLoop._transitionPhase rejects invalid moves", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const loop = new DesignAgentLoop();
  assert.throws(
    () => loop._transitionPhase({ status: DesignPhase.IDLE }, DesignPhase.COMPLETED, { emit: () => {} }),
    /transition rejected/
  );
});

test("DesignAgentLoop._toolTakeScreenshot and _toolFixSlide return defaults", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const shot = await loop._toolTakeScreenshot();
  const fix = await loop._toolFixSlide();

  assert.deepEqual(shot, { screenshots: [] });
  assert.deepEqual(fix, { fixed: false });
});

test("DesignAgentLoop.execute proxies to run", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();

  const toolExecutor = async (name, params) => {
    if (name === "parse_outline") return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    if (name === "extract_style") return { ok: true, data: { designSystem } };
    if (name === "spawn_slide_agent") {
      const slideHtml = await makeSlideHtml(contentPackage.slideIntents[0], designSystem, contentPackage);
      return { ok: true, data: { generated: [{ slideHtml, source: "mock" }] } };
    }
    if (name === "fill_visual") return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const loop = new DesignAgentLoop();
  const deck = await loop.execute({ runId: "run_execute", constraints: contentPackage.constraints }, contentPackage, { toolExecutor });
  assert.equal(deck.runId, "run_execute");
});

test("DesignAgentLoop falls back when design system overrides are invalid", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const style = await loop._toolExtractStyle(
    { contentPackage: makeContentPackage({ slideCount: 1 }), constraints: { theme: "light" }, userConfig: { designSystemOverrides: { colors: null } } },
    {}
  );

  assert.ok(style.designSystem?.designTokens, "fallback design tokens should be present");
});

test("DesignAgentLoop._renderVisuals emits visual error events", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { VisualRenderer } = await import("../../../js/agents/stages/design/visual-renderer.js");

  const loop = new DesignAgentLoop();
  const originalRender = VisualRenderer.prototype.render;
  const events = [];

  VisualRenderer.prototype.render = async () => ({
    report: { errors: [{ type: "svg", message: "bad svg" }], hasFatalError: false, svgReport: { errors: ["bad svg"] } },
    imageResults: { filledSlots: [], report: { schemaVersion: "0.1" } },
    svgResults: [],
    assetResults: [],
  });

  try {
    await loop._renderVisuals(
      [{ slotId: "svg1", renderType: "svg", slideIndex: 0 }],
      makeContentPackage({ slideCount: 1 }),
      makeDesignSystem(),
      ['<section data-type="freeform" data-bg="#ffffff"></section>'],
      { emit: (name, record) => events.push({ name, record }) },
      { runId: "run_visual_warn" },
      {},
      [{ slotId: "svg1" }],
      []
    );
  } finally {
    VisualRenderer.prototype.render = originalRender;
  }

  assert.ok(events.some((evt) => evt.name === "design.visual.errors"));
});

test("DesignAgentLoop runs title-only fallback when safe slide still fails QA", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = {
    designTokens: {
      colors: { bg: "#ffffff", text: "#111111" },
      typography: { minFont: 8, titleFont: 8, subtitleFont: 8, bodyFont: 8 },
    },
  };

  const invalidSlide = "<section data-type=\"freeform\" data-bg=\"#ffffff\"><div data-el=\"text\" data-font=\"8\">Bad</div></section>";
  const events = [];
  const toolExecutor = async (name) => {
    if (name === "parse_outline") return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    if (name === "extract_style") return { ok: true, data: { designSystem } };
    if (name === "spawn_slide_agent") return { ok: true, data: { generated: [{ slideHtml: invalidSlide, source: "mock" }] } };
    if (name === "fill_visual") return { ok: true, data: { deckHtmlDsl: invalidSlide, pendingImages: [] } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const loop = new DesignAgentLoop();
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_safe_fail", constraints: contentPackage.constraints },
    toolExecutor,
    emit: (name, record) => events.push({ name, record }),
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.editHints.degradedCount, 2);
  assert.ok(events.some((evt) => evt.name === "design.degraded" && evt.record.payload?.reason === "qa_failed_after_safe"));
});

test("DesignAgentLoop runs refine when enabled", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();
  const toolExecutor = async (name, params) => {
    if (name === "parse_outline") return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    if (name === "extract_style") return { ok: true, data: { designSystem } };
    if (name === "spawn_slide_agent") {
      const slideHtml = await makeSlideHtml(contentPackage.slideIntents[0], designSystem, contentPackage);
      return { ok: true, data: { generated: [{ slideHtml, source: "mock" }] } };
    }
    if (name === "fill_visual") return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const aiApiService = {
    chat: async () => ({
      content: "```json\n" + JSON.stringify({ thought: "done", finish: { qualityScore: 9, remainingIssues: 0, refinements: [] } }) + "\n```",
    }),
  };

  const loop = new DesignAgentLoop();
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_refine", constraints: contentPackage.constraints, userConfig: { refine: { enabled: true } } },
    toolExecutor,
    aiApiService,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.ok(deck.refineReport, "refine report should be present when enabled");
});

test("DesignAgentLoop can skip generating and return empty deck", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/runtime/event-bus.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });
  const designSystem = makeDesignSystem();
  const eventBus = new EventBus({ runId: "run_skip" });
  const calls = [];

  const toolExecutor = async (name) => {
    calls.push(name);
    if (name === "parse_outline") return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    if (name === "extract_style") return { ok: true, data: { designSystem } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const loop = new DesignAgentLoop();
  const emit = (name, record) => {
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.GENERATING_PAUSED) {
      setTimeout(() => eventBus.emit("user.action.resume_generating", { action: "skip_review" }), 0);
    }
  };

  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_skip", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    eventBus,
    pauseGenerating: true,
  });

  assert.equal(deck.slidesMeta.length, 0);
  assert.ok(!calls.includes("spawn_slide_agent"));
});
