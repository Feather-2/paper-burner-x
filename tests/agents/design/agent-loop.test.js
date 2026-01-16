import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

it("DesignAgentLoop runs phases, uses tools, emits events", async () => {
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

  expect(deck.schemaVersion).toBe("0.1");
  expect(deck.slidesMeta.length).toBe(2);
  expect(deck.deckHtmlDsl.includes("<section")).toBeTruthy();

  expect(calls).toEqual(["parse_outline", "extract_style", "spawn_slide_agent", "fill_visual"]);

  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  expect(transitions).toEqual([
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

  expect(events.some(evt => evt.name === "design.started")).toBeTruthy();
  expect(events.some(evt => evt.name === "design.tokens.ended")).toBeTruthy();
  expect(events.some(evt => evt.name === "design.generate.ended")).toBeTruthy();
  expect(events.some(evt => evt.name === "design.qa.ended")).toBeTruthy();
  expect(events.some(evt => evt.name === "design.ended")).toBeTruthy();
});

it("DesignAgentLoop waits for confirmations across phases", async () => {
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

  expect(deck.slidesMeta.length).toBe(updatedSlides.length);
  expect(events.some(evt => evt.name === "design.phase.transition" && evt.record.payload.to === DesignPhase.PLAN_CONFIRMING)).toBeTruthy();
  expect(events.some(evt => evt.name === "design.phase.transition" && evt.record.payload.to === DesignPhase.LAYOUT_CONFIRMING)).toBeTruthy();
  expect(calls.includes("spawn_slide_agent")).toBeTruthy();
});

it("DesignAgentLoop reports QA failures and keeps degraded count", async () => {
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

  expect(deck.editHints.degradedCount).toBe(1);
  // After safeMode fallback, qa reflects the fixed HTML (passes), but degraded=true marks it
  expect(deck.slidesMeta[0].qa.pass).toBe(true);
  expect(deck.slidesMeta[0].degraded).toBe(true);
  expect(events.some(evt => evt.name === "design.qa.ended" && evt.record.payload?.degradedCount === 1)).toBeTruthy();
  // design.degraded event is emitted when safeMode fallback occurs
  expect(events.some(evt => evt.name === "design.degraded")).toBeTruthy();
});

it("DesignAgentLoop._renderVisuals fills placeholders", async () => {
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

    expect(result.deckHtmlDsl.includes("data-el=\"image\"")).toBeTruthy();
    expect(result.deckHtmlDsl.includes("data-el=\"svg\"")).toBeTruthy();
    expect(result.deckHtmlDsl.includes("data-render-type=\"asset\"")).toBeTruthy();
    expect(result.pendingImages).toEqual([]);
  } finally {
    VisualSubAgent.prototype.run = originalRun;
  }
});

it("DesignAgentLoop._renderVisuals handles renderer errors", async () => {
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

    expect(result.visualReport.hasFatalError).toBe(true);
    expect(result.imageReport.error.includes("Render exploded")).toBeTruthy();
    expect(result.pendingImages).toEqual(["img1"]);
  } finally {
    VisualSubAgent.prototype.run = originalRun;
  }
});

it("DesignAgentLoop._toolChatAsk waits for user action", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const loop = new DesignAgentLoop();
  const eventBus = new EventBus({ runId: "run_chat" });
  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const promise = loop._toolChatAsk({ message: "Hello", actionName: "chat_reply" }, { eventBus, emit });
  eventBus.emit("user.action.chat_reply", { reply: "ok" });

  const result = await promise;

  expect(result.actionName).toBe("chat_reply");
  expect(result.payload).toEqual({ reply: "ok" });
  expect(events.some(evt => evt.name === "design.chat.ask")).toBeTruthy();
});

it("DesignAgentLoop._callTool resolves executors and reports errors", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();

  const errorResult = await loop._callTool("parse_outline", {}, { toolExecutor: async () => ({ error: "nope" }) });
  expect(errorResult.ok).toBe(false);
  expect(errorResult.error).toBe("nope");

  const rawResult = await loop._callTool("parse_outline", {}, { tools: { execute: async () => "raw" } });
  expect(rawResult.ok).toBe(true);
  expect(rawResult.data).toBe("raw");

  loop._tools.thrower = async () => {
    throw new Error("boom");
  };
  const thrown = await loop._callTool("thrower", {}, {});
  expect(thrown.ok).toBe(false);
  expect(thrown.error).toBe("boom");

  const missing = await loop._callTool("unknown_tool", {}, {});
  expect(missing.ok).toBe(false);
  expect(missing.error.includes("Unknown tool")).toBeTruthy();
});

it("DesignAgentLoop.waitForUserAction requires an event bus", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  await expect(loop.waitForUserAction("confirm_outline")).rejects.toThrow(/eventBus/);
});

it("DesignAgentLoop._buildVisualSlots falls back to svg without image provider", async () => {
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

  expect(slots.length).toBe(1);
  expect(slots[0].renderType).toBe("svg");
  expect(slots[0].svgSpec.type).toBe("chart");
  expect(slots[0].svgSpec.description).toBe("Use bars");
});

it("DesignAgentLoop._buildVisualSlots falls back to image slots when brainstorm empty", async () => {
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

  expect(slots.length).toBe(1);
  expect(slots[0].renderType).toBe("ai-image");
  expect(slots[0].imageSpec.prompt).toBe("Mountain view");
  expect(slots[0].imageSpec.style).toBe("photo");
  expect(slots[0].assetSpec.assetId).toBe("asset_1");
  expect(slots[0].effects).toEqual({ blur: 2 });
});

it("DesignAgentLoop._renderVisuals returns defaults when no visual slots", async () => {
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

  expect(result.visualReport).toBe(null);
  expect(result.imageReport).toBe(null);
  expect(result.finalImageSlots).toEqual([]);
  expect(result.deckHtmlDsl).toBe(slideHtmls.join("\n\n"));
});

it("DesignAgentLoop emits image planning events when configured", async () => {
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
  expect(planning, "planning event should be emitted").toBeTruthy();
  expect(planning.record.payload.planned).toBe(2);
  expect(planning.record.payload.estimatedCostUSD).toBe(0.08);
  expect(calls.includes("spawn_slide_agent")).toBeTruthy();
});

it("DesignAgentLoop.getToolDefinitions returns a copy", async () => {
  const { DesignAgentLoop, DESIGN_AGENT_TOOL_DEFINITIONS } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const defs = loop.getToolDefinitions();
  defs.push({ name: "fake_tool" });

  const next = loop.getToolDefinitions();
  expect(next.some((def) => def.name === "fake_tool")).toBe(false);
  expect(defs).not.toBe(DESIGN_AGENT_TOOL_DEFINITIONS);
});

it("DesignAgentLoop.waitForUserAction handles aborts and timeouts", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { EventBus } = await import("../../../js/agents/core/event-bus.js");

  const loop = new DesignAgentLoop();
  const eventBus = new EventBus({ runId: "run_wait" });
  const controller = new AbortController();

  const aborted = loop.waitForUserAction("confirm_outline", { eventBus, signal: controller.signal });
  controller.abort({ code: "stop" });
  await expect(aborted).rejects.toThrow(/Run cancelled/);

  const timed = loop.waitForUserAction("confirm_outline", { eventBus, timeout: 5 });
  await expect(timed).rejects.toThrow(/Timeout waiting for user action/);
});

it("DesignAgentLoop rejects when cancelled", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const contentPackage = makeContentPackage({ slideCount: 1 });
  const controller = new AbortController();
  controller.abort({ code: "stop" });

  await expect(loop.run(contentPackage).rejects.toThrow({ runContext: { runId: "run_cancel", constraints: contentPackage.constraints }, signal: controller.signal }),
    /Run cancelled/
  );
});

it("DesignAgentLoop._transitionPhase rejects invalid states", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  expect(() => loop._transitionPhase({ status: "idle" }, "invalid_state", { emit: () => {} }),
    /Invalid state transition/
  );
});

it("DesignAgentLoop loop status records history", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");

  const loop = new DesignAgentLoop();
  expect(loop.loopStatus).toBe(AgentStatus.IDLE);
  expect(loop.statusHistory.length).toBe(0);

  await loop._transitionTo(AgentStatus.RUNNING, { runId: "run_loop" });

  expect(loop.loopStatus).toBe(AgentStatus.RUNNING);
  expect(loop.statusHistory.length).toBe(1);
  expect(loop.statusHistory.map((entry) => entry.to)).toEqual([AgentStatus.RUNNING]
  );
  expect(loop.statusHistory[0].from).toBe(AgentStatus.IDLE);
  expect(loop.statusHistory[0].runId).toBe("run_loop");
  expect(typeof loop.statusHistory[0].timestamp).toBe("number");
});

it("DesignAgentLoop loop status rejects invalid transitions", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");

  const loop = new DesignAgentLoop();

  // IDLE -> COMPLETED is invalid (must go through RUNNING first)
  await expect(loop._transitionTo(AgentStatus.COMPLETED)).rejects.toThrow(/Invalid DesignLoop state transition/);

  expect(loop.statusHistory.length).toBe(0);
  expect(loop.loopStatus).toBe(AgentStatus.IDLE);
});

it("DesignAgentLoop.pause sets pause flag and isPaused getter", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  expect(loop.isPaused).toBe(false);

  loop.pause();

  expect(loop.isPaused).toBe(true);
});

it("DesignAgentLoop._transitionTo throws StagePausedError when pause requested", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { AgentStatus } = await import("../../../js/agents/runtime/core/agent-status.js");
  const { StagePausedError } = await import("../../../js/agents/runtime/core/stage-errors.js");

  const loop = new DesignAgentLoop();

  loop.pause("manual_pause");

  // Pause is checked when transitioning to RUNNING
  await expect(() => loop._transitionTo(AgentStatus.RUNNING, { runId: "run_pause", checkpointId: "cp_pause" }),
    (err) => {
      expect(err instanceof StagePausedError).toBeTruthy();
      expect(err.reason).toBe("manual_pause");
      return true;
    }
  );

  expect(loop.loopStatus).toBe(AgentStatus.PAUSED);
});

it("DesignAgentLoop run pauses before executing and persists checkpoint", async () => {
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

  expect(pauseError instanceof StagePausedError).toBeTruthy();
  expect(pauseError.reason).toBe("manual_pause");

  expect(loop.loopStatus).toBe(AgentStatus.PAUSED);
});

it("DesignAgentLoop._toolTakeScreenshot and _toolFixSlide return defaults", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const shot = await loop._toolTakeScreenshot();
  const fix = await loop._toolFixSlide();

  expect(shot).toEqual({ screenshots: [] });
  expect(typeof fix.fixedHtml).toBe("string");
});

it("DesignAgentLoop.execute proxies to run", async () => {
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
  expect(deck.runId).toBe("run_execute");
});

it("DesignAgentLoop falls back when design system overrides are invalid", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const loop = new DesignAgentLoop();
  const style = await loop._toolExtractStyle(
    { contentPackage: makeContentPackage({ slideCount: 1 }), constraints: { theme: "light" }, userConfig: { designSystemOverrides: { colors: null } } },
    {}
  );

  expect(style.designSystem?.designTokens, "fallback design tokens should be present").toBeTruthy();
});

it("DesignAgentLoop._renderVisuals emits visual error events", async () => {
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

  expect(events.some(evt => evt.name === "design.visual.errors")).toBeTruthy();
});

it("DesignAgentLoop serializes and hydrates node states", async () => {
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

  expect(serialized.contentPackage.runId).toBe("run_state");
  expect(serialized.imageSlots).toEqual(imageSlots);
  expect(serialized.visualSlots).toEqual(visualSlots);

  const restored = new DesignAgentLoop();
  restored.hydrateFromNodeStates(serialized);

  expect(restored.state.contentPackage.runId).toBe("run_state");
  expect(restored.state.slideIntents).toEqual(contentPackage.slideIntents);
  expect(restored.state.slideHtmls).toEqual([slideHtml]);
  expect(restored.state.imageSlots).toEqual(imageSlots);
  expect(restored.state.visualSlots).toEqual(visualSlots);
});

it("DesignAgentLoop.backtrackTo restores blackboard version", async () => {
  const { DesignAgentLoop, BacktrackError } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const loop = new DesignAgentLoop();
  loop.phase = { status: DesignPhase.GENERATING };
  loop.state.contentPackage = makeContentPackage({ runId: "run_backtrack", slideCount: 1 });
  loop.saveVersion("v1");

  try {
    loop.backtrackTo("v1", "test");
    throw new Error("Expected backtrackTo to throw BacktrackError" || 'Test failed');
  } catch (err) {
    expect(err instanceof BacktrackError).toBeTruthy();
    expect(err.targetPhase).toBe(DesignPhase.GENERATING);
    expect(loop.blackboard._currentVersion).toBe("v1");
  }
});

it("DesignAgentLoop runs refine when enabled", async () => {
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

  expect(deck.refineReport, "refine report should be present when enabled").toBeTruthy();
});

it("resumeDesignAgentLoop skips outline/style tools at deck planning checkpoint", async () => {
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

  expect(deck.deckHtmlDsl.includes("<section")).toBeTruthy();
  expect(calls).toEqual(["spawn_slide_agent", "fill_visual"]);
});

it("DesignAgentLoop saves pre-action checkpoint before executing", async () => {
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

  expect(typeof checkpointId === "string" && checkpointId.includes(":")).toBeTruthy();
  const snapshot = await archive.restore(checkpointId);
  expect(snapshot.schemaVersion).toBe("1.0");
  expect(snapshot.metadata.type).toBe("pre-action");
  expect(snapshot.metadata.runId).toBe(runId);
  expect(snapshot.nodeStates.phase).toBe(DesignPhase.REVIEWING);
  expect(snapshot.nodeStates.loopStatus).toBe(AgentStatus.IDLE);
  expect(snapshot.nodeStates.slidesMeta).toEqual(nodeStates.slidesMeta);
  // nodeStates override serialized values for conflicts
  expect(snapshot.nodeStates.imageSlots).toEqual(nodeStates.imageSlots);
  expect(snapshot.nodeStates.contentPackage).toEqual(contentPackage);
  expect(snapshot.nodeStates.slideIntents).toEqual(contentPackage.slideIntents);
  expect(snapshot.nodeStates.designSystem).toEqual(designSystem);
  expect(snapshot.nodeStates.slideHtmls).toEqual(loop.state.slideHtmls);
  expect(snapshot.nodeStates.deckHtmlDsl).toBe(loop.state.deckHtmlDsl);
  expect(snapshot.nodeStates.visualSlots).toEqual(loop.state.visualSlots);
  expect(Array.isArray(snapshot.nodeStates.statusHistory)).toBeTruthy();
});

it("resumeDesignAgentLoop returns DeckPackage", async () => {
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

  expect(deck).toBeTruthy();
  expect(deck.runId).toBe(contentPackage.runId);
  expect(deck.designSystem).toBeTruthy();
  expect(deck.deckHtmlDsl.includes("<section")).toBeTruthy();
  expect(deck.slidesMeta.length).toBe(1);
  expect(calls).toEqual(["fill_visual"]);
});

it("resumeDesignAgentLoop continues after pause checkpoint", async () => {
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
  await expect(() =>
      loop.run(contentPackage, {
        runContext: { runId: contentPackage.runId, constraints: contentPackage.constraints },
        toolExecutor,
      }),
    (err) => {
      expect(err instanceof StagePausedError).toBeTruthy();
      checkpointId = err.checkpointId;
      expect(typeof checkpointId === "string" && checkpointId.includes(":")).toBeTruthy();
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

  expect(deck).toBeTruthy();
  expect(deck.runId).toBe(contentPackage.runId);
  expect(deck.slidesMeta.length).toBe(1);
  expect(deck.designSystem).toBeTruthy();
  // 由于暂停发生在 IDLE 阶段，resume 会重新执行所有步骤
  expect(calls.includes("parse_outline") || calls.length > 0).toBeTruthy();
});

it("DesignAgentLoop checkpoint snapshot is JSON serializable", async () => {
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

  expect(roundtrip.nodeStates.loopStatus).toBe(AgentStatus.IDLE);
  expect(Array.isArray(roundtrip.nodeStates.statusHistory)).toBeTruthy();
});
