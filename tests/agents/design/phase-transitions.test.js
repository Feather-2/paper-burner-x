const test = require("node:test");
const assert = require("node:assert/strict");

function makeContentPackage({ runId = "run_test", slideCount = 1 } = {}) {
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
    constraints: { pageCount: slideCount, imagePolicy: "balanced" },
    summary: "Test deck",
    slideIntents,
    claims: [],
    evidenceLedger: [],
  };
}

function makeDesignSystem() {
  return {
    theme: "test",
    designTokens: {
      fontFamily: "Inter",
      colors: {
        bg: "#ffffff",
        text: "#111827",
        muted: "#6b7280",
        border: "#e5e7eb",
        panel: "#ffffff",
      },
      typography: {
        headingFont: "Inter",
        bodyFont: "Inter",
        minFont: 12,
        titleFont: 44,
        subtitleFont: 18,
        bodySize: 16,
      },
    },
  };
}

test("designPhaseMachine.transition enforces DESIGN_PHASE_VALID_TRANSITIONS", async () => {
  const { DesignPhase, designPhaseMachine } = await import("../../../js/agents/stages/design/states.js");

  const state = { status: DesignPhase.PLAN_CONFIRMING };

  assert.throws(() => {
    designPhaseMachine.transition(state, DesignPhase.REVIEWING, { from: state.status });
  }, /Invalid state transition/);

  assert.equal(state.status, DesignPhase.PLAN_CONFIRMING);
});

test("designPhaseMachine supports pipeline chain (planning -> layout -> repair -> final-review)", async () => {
  const { DesignPhase, designPhaseMachine } = await import("../../../js/agents/stages/design/states.js");

  const state = { status: DesignPhase.DECK_PLANNING };
  const chain = [
    DesignPhase.PLAN_CONFIRMING,
    DesignPhase.LAYOUT_DEVELOPING,
    DesignPhase.LAYOUT_CONFIRMING,
    DesignPhase.GENERATING,
    DesignPhase.REPAIR,
    DesignPhase.VISUAL_FILLING,
    DesignPhase.REVIEWING,
    DesignPhase.COMPLETED,
  ];

  for (const next of chain) {
    designPhaseMachine.transition(state, next, { from: state.status });
  }

  assert.equal(state.status, DesignPhase.COMPLETED);
});

test("runGeneratingPhase is pure (no phase transitions) and emits design.qa.ended", async () => {
  const { runGeneratingPhase } = await import("../../../js/agents/stages/design/runtime/design-phases.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const signal = new AbortController().signal;

  const loop = {
    batchSize: 2,
    batchConcurrency: 1,
    phase: { status: DesignPhase.GENERATING },
    _transitionPhase() {
      throw new Error("runGeneratingPhase should not transition phases");
    },
    async _callTool(name) {
      if (name !== "spawn_slide_agent") return { ok: false, error: `Unexpected tool: ${name}` };
      return {
        ok: true,
        data: {
          generated: [{ slideHtml: '<section data-layout="test"></section>', source: "mock" }],
        },
      };
    },
  };

  const startExecution = async () => ({ loopIteration: 1, stepInfo: { context: { signal } } });
  const finishExecution = async () => { };

  const slideIntents = [{ slideIntentId: "s_1", pageType: "overview", title: "Slide 1", keyPoints: ["A"] }];
  const runContext = { runId: "run_generating_pure", constraints: { imagePolicy: "balanced" } };

  await runGeneratingPhase(loop, {
    slideIntents,
    contentPackage: { slideIntents },
    designSystem: makeDesignSystem(),
    constraints: runContext.constraints,
    userConfig: {},
    context: { signal },
    runContext,
    emit,
    startExecution,
    finishExecution,
    emitDeckUpdate: () => { },
    skipReview: true, // Skip REVIEWING phase transition for this test
  });

  const qaEnded = events.find((evt) => evt.name === "design.qa.ended");
  assert.ok(qaEnded, "Expected design.qa.ended event to be emitted");
  assert.deepEqual(qaEnded.record, {
    actor: "design",
    status: "ended",
    payload: { slides: 1, degradedCount: 0, qaFailed: 0 },
  });
});

test("runVisualPhase supports deferredVisuals fast-path", async () => {
  const { runVisualPhase } = await import("../../../js/agents/stages/design/runtime/design-phases.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const signal = new AbortController().signal;
  const runContext = { runId: "run_visual_deferred", constraints: {} };

  const phase = { status: DesignPhase.REPAIR };
  const loop = {
    phase,
    _transitionPhase(_state, next) {
      phase.status = next;
      return next;
    },
  };

  const startExecution = async () => ({ loopIteration: 1, stepInfo: { context: { signal } } });
  const finishExecution = async () => { };

  const imageSlots = [{ slotId: "img1" }, { slotId: "img2" }];

  const result = await runVisualPhase(loop, {
    contentPackage: {},
    slideIntents: [],
    designSystem: makeDesignSystem(),
    generated: [],
    slideHtmls: [],
    slidesMeta: [],
    imageSlots,
    baseDeckHtmlDsl: "<section></section>",
    pendingImages: [],
    brainstormResult: null,
    constraints: {},
    userConfig: {},
    context: { signal, deferredVisuals: true },
    runContext,
    emit,
    startExecution,
    finishExecution,
    emitDeckUpdate: () => { },
  });

  assert.equal(phase.status, DesignPhase.VISUAL_FILLING);
  assert.equal(result.imageReport.deferred, true);
  assert.deepEqual(result.pendingImages, ["img1", "img2"]);
  assert.ok(events.some((evt) => evt.name === "design.visual.deferred"));
});

test("DesignAgentLoop skips final review when skipReview is true", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const contentPackage = makeContentPackage({ runId: "run_skip_review", slideCount: 1 });
  const designSystem = makeDesignSystem();
  const eventBus = new EventBus({ runId: "run_skip_review" });

  const toolExecutor = async (name, params) => {
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      return {
        ok: true,
        data: { generated: [{ slideHtml: '<section data-layout="ok"></section>', source: "mock" }] },
      };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    if (name === "orchestrate_batch_repair") {
      return { ok: true, data: { finalDeck: params.deckPackage, steps: [], qualityScore: 1 } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => {
    events.push({ name, record });
    if (name === "design.phase.transition" && record.payload.to === DesignPhase.OUTLINE_CONFIRMING) {
      setTimeout(() => eventBus.emit("user.action.confirm_outline", { slideIntents: contentPackage.slideIntents }), 0);
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

  const loop = new DesignAgentLoop({ batchSize: 1 });
  loop._buildVisualSlots = () => [];

  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_skip_review", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    eventBus,
    enableFinalReview: true,
    skipReview: true,
    interactionMode: { outlineConfirm: "confirm", styleConfirm: "confirm", planConfirm: "confirm", layoutConfirm: "confirm" },
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.runId, "run_skip_review");
  assert.ok(events.some((evt) => evt.name === "design.qa.ended"));

  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  assert.ok(transitions.includes(DesignPhase.VISUAL_FILLING));
  assert.ok(transitions.includes(DesignPhase.COMPLETED));
  assert.ok(!transitions.includes(DesignPhase.REVIEWING), "Expected REVIEWING to be skipped");
  assert.ok(!events.some((evt) => evt.name === "design.review.started"), "Expected no review events when skipReview is true");
});

test("DesignAgentLoop runs repair + final review when enabled", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const contentPackage = makeContentPackage({ runId: "run_final_review", slideCount: 1 });
  const designSystem = makeDesignSystem();

  const invalidSlide =
    '<section data-type="freeform" data-bg="#ffffff">' +
    '<div data-el="text" data-font="8" data-x="0%" data-y="0%" data-w="20%" data-h="20%"></div>' +
    "</section>";

  const toolExecutor = async (name, params) => {
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      return { ok: true, data: { generated: [{ slideHtml: invalidSlide, source: "mock" }] } };
    }
    if (name === "orchestrate_batch_repair") {
      return {
        ok: true,
        data: {
          finalDeck: { deckHtmlDsl: '<section data-layout="repaired"></section>', slidesMeta: params.deckPackage.slidesMeta },
          steps: [{ name: "fix" }],
          qualityScore: 0.9,
        },
      };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: '<section data-layout="final"></section>', pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop({ batchSize: 1 });
  loop._buildVisualSlots = () => [];

  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_final_review", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    enableFinalReview: true,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
  });

  assert.equal(deck.runId, "run_final_review");
  assert.ok(events.some((evt) => evt.name === "design.repair.started"), "Expected repair to run when QA fails");
  assert.ok(events.some((evt) => evt.name === "design.review.started"), "Expected final review to run when enabled");

  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  assert.ok(transitions.includes(DesignPhase.REPAIR));
  assert.ok(transitions.includes(DesignPhase.REVIEWING));
  assert.ok(transitions.at(-1) === DesignPhase.COMPLETED);
});
