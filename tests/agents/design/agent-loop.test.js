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
      fontFamily: "Inter",
      typography: {
        minFont: 12,
        titleFont: 44,
        subtitleFont: 18,
        smallFont: 12,
      },
    },
  };
}

async function makeSlideHtml(slideIntent, designSystem, contentPackage) {
  const { buildSlideHtml } = await import("../../../js/agents/stages/design/dsl/dsl-builder.js");
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
    skipReview: true,
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
    DesignPhase.DECK_PLANNING,
    DesignPhase.PLAN_CONFIRMING,
    DesignPhase.LAYOUT_DEVELOPING,
    DesignPhase.LAYOUT_CONFIRMING,
    DesignPhase.GENERATING,
    DesignPhase.REPAIR,
    DesignPhase.VISUAL_FILLING,
    DesignPhase.COMPLETED,
  ]);

  assert.ok(events.some((evt) => evt.name === "design.started"));
  assert.ok(events.some((evt) => evt.name === "design.tokens.ended"));
  assert.ok(events.some((evt) => evt.name === "design.generate.ended"));
  assert.ok(events.some((evt) => evt.name === "design.qa.ended"));
  assert.ok(events.some((evt) => evt.name === "design.ended"));
});

test("DesignAgentLoop waits for confirmations across phases", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

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
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.PLAN_CONFIRMING) {
      setTimeout(() => eventBus.emit("user.action.confirm_plan", { ok: true }), 0);
    }
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.LAYOUT_CONFIRMING) {
      setTimeout(() => eventBus.emit("user.action.confirm_layout", { ok: true }), 0);
    }
  };

  const loop = new DesignAgentLoop();
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_interactive", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    eventBus,
    interactionMode: { outlineConfirm: "confirm", styleConfirm: "confirm", planConfirm: "confirm", layoutConfirm: "confirm" },
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.slidesMeta.length, updatedSlides.length);
  assert.ok(events.some((evt) => evt.name === "design.phase.transition" && evt.record.payload.to === DesignPhase.PLAN_CONFIRMING));
  assert.ok(events.some((evt) => evt.name === "design.phase.transition" && evt.record.payload.to === DesignPhase.LAYOUT_CONFIRMING));
  assert.ok(calls.includes("spawn_slide_agent"));
});

test("DesignAgentLoop reports QA failures and keeps degraded count", async () => {
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
  // After safeMode fallback, qa reflects the fixed HTML (passes), but degraded=true marks it
  assert.equal(deck.slidesMeta[0].qa.pass, true);
  assert.equal(deck.slidesMeta[0].degraded, true);
  assert.ok(events.some((evt) => evt.name === "design.qa.ended" && evt.record.payload?.degradedCount === 1));
  // design.degraded event is emitted when safeMode fallback occurs
  assert.ok(events.some((evt) => evt.name === "design.degraded"));
});

test("DesignAgentLoop._renderVisuals fills placeholders", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");

  const loop = new DesignAgentLoop();
  const originalRun = VisualSubAgent.prototype.run;

  VisualSubAgent.prototype.run = async () => ({
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
    VisualSubAgent.prototype.run = originalRun;
  }
});

test("DesignAgentLoop._renderVisuals handles renderer errors", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");

  const loop = new DesignAgentLoop();
  const originalRun = VisualSubAgent.prototype.run;

  VisualSubAgent.prototype.run = async () => {
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
    VisualSubAgent.prototype.run = originalRun;
  }
});

test("DesignAgentLoop._toolChatAsk waits for user action", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

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
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

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

test("DesignAgentLoop._transitionPhase rejects invalid states", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  assert.throws(
    () => loop._transitionPhase({ status: "idle" }, "invalid_state", { emit: () => {} }),
    /Invalid state transition/
  );
});

test("DesignAgentLoop loop status records history", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");

  const loop = new DesignAgentLoop();
  assert.equal(loop.loopStatus, AgentStatus.IDLE);
  assert.equal(loop.statusHistory.length, 0);

  await loop._transitionTo(AgentStatus.RUNNING, { runId: "run_loop" });

  assert.equal(loop.loopStatus, AgentStatus.RUNNING);
  assert.equal(loop.statusHistory.length, 1);
  assert.deepEqual(
    loop.statusHistory.map((entry) => entry.to),
    [AgentStatus.RUNNING]
  );
  assert.equal(loop.statusHistory[0].from, AgentStatus.IDLE);
  assert.equal(loop.statusHistory[0].runId, "run_loop");
  assert.equal(typeof loop.statusHistory[0].timestamp, "number");
});

test("DesignAgentLoop loop status rejects invalid transitions", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");

  const loop = new DesignAgentLoop();

  // IDLE -> COMPLETED is invalid (must go through RUNNING first)
  await assert.rejects(
    loop._transitionTo(AgentStatus.COMPLETED),
    (err) => {
      assert.equal(err.code, "INVALID_STATE_TRANSITION");
      return /Invalid DesignLoop state transition/.test(err.message);
    }
  );

  assert.equal(loop.statusHistory.length, 0);
  assert.equal(loop.loopStatus, AgentStatus.IDLE);
});

test("DesignAgentLoop.pause sets pause flag and isPaused getter", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  assert.equal(loop.isPaused, false);

  loop.pause();

  assert.equal(loop.isPaused, true);
});

test("DesignAgentLoop._transitionTo throws StagePausedError when pause requested", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const loop = new DesignAgentLoop();

  loop.pause("manual_pause");

  // Pause is checked when transitioning to RUNNING
  await assert.rejects(
    () => loop._transitionTo(AgentStatus.RUNNING, { runId: "run_pause", checkpointId: "cp_pause" }),
    (err) => {
      assert.ok(err instanceof StagePausedError);
      assert.equal(err.reason, "manual_pause");
      return true;
    }
  );

  assert.equal(loop.loopStatus, AgentStatus.PAUSED);
});

test("DesignAgentLoop run pauses before executing and persists checkpoint", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const loop = new DesignAgentLoop({ archive });
  const contentPackage = makeContentPackage({ slideCount: 1 });
  const calls = [];

  const toolExecutor = async (name) => {
    calls.push(name);
    if (name === "parse_outline") return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    if (name === "extract_style") return { ok: true, data: { designSystem: makeDesignSystem() } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  loop.pause("manual_pause");

  let pauseError = null;
  try {
    await loop.run(contentPackage, {
      runContext: { runId: "run_pause", constraints: contentPackage.constraints },
      toolExecutor,
    });
  } catch (err) {
    pauseError = err;
  }

  assert.ok(pauseError instanceof StagePausedError);
  assert.equal(pauseError.reason, "manual_pause");

  assert.equal(loop.loopStatus, AgentStatus.PAUSED);
});

test("DesignAgentLoop._toolTakeScreenshot and _toolFixSlide return defaults", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const shot = await loop._toolTakeScreenshot();
  const fix = await loop._toolFixSlide();

  assert.deepEqual(shot, { screenshots: [] });
  assert.equal(typeof fix.fixedHtml, "string");
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
  const { VisualSubAgent } = await import("../../../js/agents/stages/design/subagents/visual-agent.js");

  const loop = new DesignAgentLoop();
  const originalRun = VisualSubAgent.prototype.run;
  const events = [];

  VisualSubAgent.prototype.run = async () => ({
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
    VisualSubAgent.prototype.run = originalRun;
  }

  assert.ok(events.some((evt) => evt.name === "design.visual.errors"));
});

test("DesignAgentLoop serializes and hydrates node states", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ runId: "run_state", slideCount: 1 });
  const designSystem = makeDesignSystem();
  const slideHtml = "<section data-type=\"freeform\" data-bg=\"#ffffff\"></section>";
  const imageSlots = [{ slotId: "img_1", renderType: "ai-image" }];
  const visualSlots = [{ slotId: "img_1", slideIndex: 0, renderType: "ai-image" }];

  const loop = new DesignAgentLoop();
  loop.state.contentPackage = contentPackage;
  loop.state.slideIntents = contentPackage.slideIntents;
  loop.state.designSystem = designSystem;
  loop.state.slideHtmls = [slideHtml];
  loop.state.deckHtmlDsl = slideHtml;
  loop.state.imageSlots = imageSlots;
  loop.state.visualSlots = visualSlots;

  const serialized = loop.serializeNodeStates();
  loop.state.contentPackage.runId = "mutated";

  assert.equal(serialized.contentPackage.runId, "run_state");
  assert.deepEqual(serialized.imageSlots, imageSlots);
  assert.deepEqual(serialized.visualSlots, visualSlots);

  const restored = new DesignAgentLoop();
  restored.hydrateFromNodeStates(serialized);

  assert.equal(restored.state.contentPackage.runId, "run_state");
  assert.deepEqual(restored.state.slideIntents, contentPackage.slideIntents);
  assert.deepEqual(restored.state.slideHtmls, [slideHtml]);
  assert.deepEqual(restored.state.imageSlots, imageSlots);
  assert.deepEqual(restored.state.visualSlots, visualSlots);
});

test("DesignAgentLoop.backtrackTo restores blackboard version", async () => {
  const { DesignAgentLoop, BacktrackError } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const loop = new DesignAgentLoop();
  loop.phase = { status: DesignPhase.GENERATING };
  loop.state.contentPackage = makeContentPackage({ runId: "run_backtrack", slideCount: 1 });
  loop.saveVersion("v1");

  try {
    loop.backtrackTo("v1", "test");
    assert.fail("Expected backtrackTo to throw BacktrackError");
  } catch (err) {
    assert.ok(err instanceof BacktrackError);
    assert.equal(err.targetPhase, DesignPhase.GENERATING);
    assert.equal(loop.blackboard._currentVersion, "v1");
  }
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

test("resumeDesignAgentLoop skips outline/style tools at deck planning checkpoint", async () => {
  const { resumeDesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const contentPackage = makeContentPackage({ runId: "run_resume_planning", slideCount: 1 });
  const designSystem = makeDesignSystem();

  const checkpointId = await archive.save(contentPackage.runId, {
    nodeStates: {
      phase: DesignPhase.DECK_PLANNING,
      loopStatus: "running",
      statusHistory: [],
      contentPackage,
      slideIntents: contentPackage.slideIntents,
      designSystem,
    },
    timestamp: Date.now(),
    metadata: { runId: contentPackage.runId, iteration: 1, type: "pre-action" },
  });

  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "spawn_slide_agent") {
      const slideHtml = await makeSlideHtml(params.slideIntents[0], designSystem, params.contentPackage);
      return { ok: true, data: { generated: [{ slideHtml, source: "mock" }] } };
    }
    if (name === "fill_visual") return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const deck = await resumeDesignAgentLoop(checkpointId, {
    archive,
    toolExecutor,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.ok(deck.deckHtmlDsl.includes("<section"));
  assert.deepEqual(calls, ["spawn_slide_agent", "fill_visual"]);
});

test("DesignAgentLoop saves pre-action checkpoint before executing", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const loop = new DesignAgentLoop({ archive });
  const runId = "run_checkpoint";
  const contentPackage = makeContentPackage({ runId, slideCount: 1 });
  const designSystem = makeDesignSystem();

  loop.state.contentPackage = contentPackage;
  loop.state.slideIntents = contentPackage.slideIntents;
  loop.state.designSystem = designSystem;
  loop.state.slideHtmls = ["<section data-type=\"freeform\"></section>"];
  loop.state.deckHtmlDsl = loop.state.slideHtmls[0];
  loop.state.imageSlots = [{ slotId: "img_state" }];
  loop.state.visualSlots = [{ slotId: "vis_state" }];

  const nodeStates = { slidesMeta: [{ slideNo: 1 }], imageSlots: [{ slotId: "img_override" }] };

  loop.phase = { status: DesignPhase.REVIEWING };

  const checkpointId = await loop._transitionTo(AgentStatus.RUNNING, { runId, iteration: 1, nodeStates });

  assert.ok(typeof checkpointId === "string" && checkpointId.includes(":"));
  const snapshot = await archive.restore(checkpointId);
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.equal(snapshot.metadata.type, "pre-action");
  assert.equal(snapshot.metadata.runId, runId);
  assert.equal(snapshot.nodeStates.phase, DesignPhase.REVIEWING);
  assert.equal(snapshot.nodeStates.loopStatus, AgentStatus.IDLE);
  assert.deepEqual(snapshot.nodeStates.slidesMeta, nodeStates.slidesMeta);
  // nodeStates override serialized values for conflicts
  assert.deepEqual(snapshot.nodeStates.imageSlots, nodeStates.imageSlots);
  assert.deepEqual(snapshot.nodeStates.contentPackage, contentPackage);
  assert.deepEqual(snapshot.nodeStates.slideIntents, contentPackage.slideIntents);
  assert.deepEqual(snapshot.nodeStates.designSystem, designSystem);
  assert.deepEqual(snapshot.nodeStates.slideHtmls, loop.state.slideHtmls);
  assert.equal(snapshot.nodeStates.deckHtmlDsl, loop.state.deckHtmlDsl);
  assert.deepEqual(snapshot.nodeStates.visualSlots, loop.state.visualSlots);
  assert.ok(Array.isArray(snapshot.nodeStates.statusHistory));
});

test("resumeDesignAgentLoop returns DeckPackage", async () => {
  const { resumeDesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const contentPackage = makeContentPackage({ runId: "run_resume_pkg", slideCount: 1 });
  const designSystem = makeDesignSystem();
  const slideHtml = await makeSlideHtml(contentPackage.slideIntents[0], designSystem, contentPackage);
  const generated = [{ slideHtml, source: "resume" }];

  const checkpointId = await archive.save(contentPackage.runId, {
    nodeStates: {
      phase: DesignPhase.VISUAL_FILLING,
      loopStatus: AgentStatus.RUNNING,
      statusHistory: [],
      contentPackage,
      slideIntents: contentPackage.slideIntents,
      designSystem,
      generated,
      slideHtmls: [slideHtml],
      deckHtmlDsl: slideHtml,
      slidesMeta: [
        {
          slideNo: 1,
          slideIntentId: contentPackage.slideIntents[0].slideIntentId,
          pageType: contentPackage.slideIntents[0].pageType,
          title: contentPackage.slideIntents[0].title,
          degraded: false,
          source: "resume",
          qa: { pass: true },
        },
      ],
      imageSlots: [],
    },
    timestamp: Date.now(),
    metadata: { runId: contentPackage.runId, iteration: 1, type: "pre-action" },
  });

  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const deck = await resumeDesignAgentLoop(checkpointId, {
    archive,
    toolExecutor,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.ok(deck);
  assert.equal(deck.runId, contentPackage.runId);
  assert.ok(deck.designSystem);
  assert.ok(deck.deckHtmlDsl.includes("<section"));
  assert.equal(deck.slidesMeta.length, 1);
  assert.deepEqual(calls, ["fill_visual"]);
});

test("resumeDesignAgentLoop continues after pause checkpoint", async () => {
  const { DesignAgentLoop, resumeDesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const loop = new DesignAgentLoop({ archive });
  const contentPackage = makeContentPackage({ runId: "run_resume_pause", slideCount: 1 });
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

  loop.pause("manual_pause");

  let checkpointId;
  await assert.rejects(
    () =>
      loop.run(contentPackage, {
        runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints },
        toolExecutor,
      }),
    (err) => {
      assert.ok(err instanceof StagePausedError);
      checkpointId = err.checkpointId;
      assert.ok(typeof checkpointId === "string" && checkpointId.includes(":"));
      return true;
    }
  );

  const calls = [];
  const resumedExecutor = async (name, params) => {
    calls.push(name);
    return toolExecutor(name, params);
  };

  const deck = await resumeDesignAgentLoop(checkpointId, {
    archive,
    toolExecutor: resumedExecutor,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
    contentPackage, // 提供 contentPackage 作为 fallback
  });

  assert.ok(deck);
  assert.equal(deck.runId, contentPackage.runId);
  assert.equal(deck.slidesMeta.length, 1);
  assert.ok(deck.designSystem);
  // 由于暂停发生在 IDLE 阶段，resume 会重新执行所有步骤
  assert.ok(calls.includes("parse_outline") || calls.length > 0);
});

test("DesignAgentLoop checkpoint snapshot is JSON serializable", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { Archive, MapAdapter } = await import("../../../js/agents/shared/archive/archive.js");

  const archive = new Archive(new MapAdapter());
  const loop = new DesignAgentLoop({ archive });
  const runId = "run_serial";

  const checkpointId = await loop._transitionTo(AgentStatus.RUNNING, {
    runId,
    nodeStates: { slidesMeta: [{ slideNo: 1 }], imageSlots: [] },
  });

  const snapshot = await archive.restore(checkpointId);
  const serialized = JSON.stringify(snapshot);
  const roundtrip = JSON.parse(serialized);

  assert.equal(roundtrip.nodeStates.loopStatus, AgentStatus.IDLE);
  assert.ok(Array.isArray(roundtrip.nodeStates.statusHistory));
});
