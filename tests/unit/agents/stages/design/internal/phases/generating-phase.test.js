import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedDslBuilder = vi.hoisted(() => ({
  buildSlideHtml: vi.fn(),
}));

const mockedDslRules = vi.hoisted(() => ({
  getDslRules: vi.fn(),
}));

const mockedImagePlanner = vi.hoisted(() => ({
  ImagePlanner: {
    plan: vi.fn(),
  },
}));

const mockedQaValidator = vi.hoisted(() => ({
  validateSlide: vi.fn(),
}));

const mockedDesignUtils = vi.hoisted(() => ({
  escapeHtml: vi.fn((value) => `ESC(${String(value)})`),
}));

const mockedStates = vi.hoisted(() => ({
  DesignPhase: {
    REVIEWING: "reviewing",
  },
}));

const mockedDesignHelpers = vi.hoisted(() => ({
  emitStage: vi.fn(),
}));

const mockedRuntime = vi.hoisted(() => ({
  checkCancelled: vi.fn(),
}));

const mockedCancellation = vi.hoisted(() => ({
  createLinkedSignal: vi.fn(),
}));

const mockedPhaseUtils = vi.hoisted(() => ({
  DESIGN_PHASE_DEFAULTS: {
    costPerHDSlot: 0.04,
    costPerBasicSlot: 0.003,
  },
  runWithPhaseSpan: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/dsl/dsl-builder.js", () => ({
  buildSlideHtml: mockedDslBuilder.buildSlideHtml,
}));

vi.mock("../../../../../../../js/agents/stages/design/dsl/dsl-rules.js", () => ({
  getDslRules: mockedDslRules.getDslRules,
}));

vi.mock("../../../../../../../js/agents/stages/design/image/image-planner.js", () => ({
  ImagePlanner: {
    plan: mockedImagePlanner.ImagePlanner.plan,
  },
}));

vi.mock("../../../../../../../js/agents/stages/design/refiner/qa-validator.js", () => ({
  validateSlide: mockedQaValidator.validateSlide,
}));

vi.mock("../../../../../../../js/agents/stages/design/shared/design-utils.js", () => ({
  escapeHtml: mockedDesignUtils.escapeHtml,
}));

vi.mock("../../../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: mockedStates.DesignPhase,
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: mockedDesignHelpers.emitStage,
}));

vi.mock("../../../../../../../js/agents/runtime/index.js", () => ({
  checkCancelled: mockedRuntime.checkCancelled,
}));

vi.mock("../../../../../../../js/agents/shared/utils/cancellation.js", () => ({
  createLinkedSignal: mockedCancellation.createLinkedSignal,
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  DESIGN_PHASE_DEFAULTS: mockedPhaseUtils.DESIGN_PHASE_DEFAULTS,
  runWithPhaseSpan: mockedPhaseUtils.runWithPhaseSpan,
}));

import { runGeneratingPhase } from "../../../../../../../js/agents/stages/design/internal/phases/generating-phase.js";

function makeLoop(overrides = {}) {
  return {
    state: {},
    batchSize: 2,
    batchConcurrency: 1,
    phase: "generating",
    _callTool: vi.fn(),
    _transitionPhase: vi.fn(),
    _blackboard: { logDecision: vi.fn() },
    ...overrides,
  };
}

function makeExecution(signal = { id: "signal" }) {
  const loopIteration = { id: "iter" };
  const stepInfo = { context: { signal } };
  return {
    loopIteration,
    stepInfo,
    startExecution: vi.fn(async () => ({ loopIteration, stepInfo })),
    finishExecution: vi.fn(async () => {}),
  };
}

function findEmitStageCall(name) {
  return mockedDesignHelpers.emitStage.mock.calls.find((call) => call[1] === name) || null;
}

describe("runGeneratingPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDslRules.getDslRules.mockResolvedValue({ rules: true });
    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([]);
    mockedQaValidator.validateSlide.mockReturnValue({ pass: true });
    mockedDslBuilder.buildSlideHtml.mockReturnValue("<safe/>");
    mockedCancellation.createLinkedSignal.mockImplementation((signal, timeoutMs) => ({
      linked: true,
      signal,
      timeoutMs,
    }));
    mockedPhaseUtils.runWithPhaseSpan.mockImplementation(async (_trace, _name, _attrs, fn) => await fn());
  });

  it("runs the generation flow, emits planning events, and updates state", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });
    const slideIntents = [
      { slideIntentId: "s1", pageType: "cover", title: "Title 1" },
      { slideIntentId: "s2", pageType: "content", title: "Title 2" },
    ];
    const contentPackage = { claims: [] };
    const designSystem = {
      designTokens: {
        colors: { primary: "#111", accent: "#222", bg: "#fff", text: "#000" },
        typography: { body: "Sans" },
      },
      theme: "light",
    };
    const constraints = { imagePolicy: "", imageBudget: 0 };
    const context = { modelRouter: { id: "router" }, aiApiService: { id: "svc" } };
    const runContext = { runId: "run-1", timeoutMs: 500 };
    const emit = vi.fn();

    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([
      { slotId: "img-1", style: "3d", slideIndex: 0 },
      { slotId: "img-2", style: "flat", slideIndex: 1 },
    ]);
    loop._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }, { slideHtml: "<s2/>" }] },
    });

    const traceContext = { id: "trace" };
    const result = await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage,
      designSystem,
      constraints,
      userConfig: {},
      context,
      runContext,
      emit,
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext,
      skipReview: false,
    });

    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      traceContext,
      "design.phase.generating",
      expect.objectContaining({ runId: "run-1", slideCount: 2, skipReview: false }),
      expect.any(Function)
    );

    expect(exec.startExecution).toHaveBeenCalledWith("generating", {
      contentPackage,
      slideIntents,
      designSystem,
      constraints,
      userConfig: {},
    });
    expect(mockedImagePlanner.ImagePlanner.plan).toHaveBeenCalledWith(slideIntents, designSystem, constraints);
    expect(mockedDslRules.getDslRules).toHaveBeenCalled();
    expect(mockedCancellation.createLinkedSignal).toHaveBeenCalledWith(exec.stepInfo.context.signal, 500);

    expect(loop._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({
        slideIntents,
        contentPackage,
        designSystem,
        batchSize: loop.batchSize,
        batchConcurrency: loop.batchConcurrency,
        modelRouter: context.modelRouter,
        aiApiService: context.aiApiService,
        imageSlots: [
          { slotId: "img-1", style: "3d", slideIndex: 0 },
          { slotId: "img-2", style: "flat", slideIndex: 1 },
        ],
        selectedIdeas: [],
        emit,
        dslRules: { rules: true },
      }),
      exec.stepInfo.context
    );

    expect(exec.finishExecution).toHaveBeenCalledWith("generating", exec.loopIteration, exec.stepInfo);
    expect(loop._transitionPhase).toHaveBeenCalledWith(loop.phase, mockedStates.DesignPhase.REVIEWING, { emit, runId: "run-1" });

    const planningCall = findEmitStageCall("design.image.planning.completed");
    expect(planningCall).not.toBeNull();
    expect(planningCall[3]).toEqual(
      expect.objectContaining({
        policy: "balanced",
        planned: 2,
        pendingImages: ["img-1", "img-2"],
        estimatedCostUSD: 0.043,
      })
    );

    const generateCall = findEmitStageCall("design.generate.ended");
    expect(generateCall).not.toBeNull();
    expect(generateCall[3]).toEqual({ slides: 2 });

    const qaEndedCall = findEmitStageCall("design.qa.ended");
    expect(qaEndedCall).not.toBeNull();
    expect(qaEndedCall[3]).toEqual({ slides: 2, qaFailed: 0, degradedCount: 0 });

    expect(findEmitStageCall("design.degraded")).toBeNull();
    expect(mockedRuntime.checkCancelled).toHaveBeenCalledWith(exec.stepInfo.context.signal);

    expect(result.generated).toHaveLength(2);
    expect(result.slideHtmls).toEqual(["<s1/>", "<s2/>"]);
    expect(result.slidesMeta).toHaveLength(2);
    expect(result.slidesMeta[0]).toEqual(
      expect.objectContaining({
        slideNo: 1,
        slideIntentId: "s1",
        pageType: "cover",
        title: "Title 1",
        qa: { pass: true },
      })
    );
    expect(result.pendingImages).toEqual(["img-1", "img-2"]);
    expect(result.baseDeckHtmlDsl).toBe("<s1/>\n\n<s2/>");
    expect(result.styleLock).toEqual(
      expect.objectContaining({
        colors: { primary: "#111", accent: "#222", bg: "#fff", text: "#000" },
        theme: "light",
      })
    );
    expect(designSystem.styleLock).toBe(result.styleLock);
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      "style_lock_established",
      "Style lock created from first batch generation",
      expect.objectContaining({
        colors: result.styleLock.colors,
        theme: "light",
      })
    );

    expect(loop.state.generated).toEqual(result.generated);
    expect(loop.state.slideHtmls).toEqual(result.slideHtmls);
    expect(loop.state.slidesMeta).toEqual(result.slidesMeta);
    expect(loop.state.imageSlots).toEqual(result.imageSlots);
    expect(loop.state.baseDeckHtmlDsl).toBe(result.baseDeckHtmlDsl);
    expect(loop.state.pendingImages).toEqual(result.pendingImages);
    expect(loop.state.brainstormResult).toEqual(result.brainstormResult);
    expect(loop.state.degradedCount).toBe(result.degradedCount);
  });

  it("uses brainstormResult candidates, trims whitespace ids, and skips planner", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });
    const slideIntents = [{ slideIntentId: "s1", pageType: "cover", title: "Title" }];
    const contentPackage = {};
    const designSystem = {};
    const constraints = {};
    const emit = vi.fn();
    const context = {
      brainstormResult: {
        ideaPool: [],
        selectedIdeas: [],
        imageSlots: [{ slotId: "img-x", style: "flat", slideIndex: 0 }],
        candidatesBySlide: [
          {
            slideIntentId: "  s1  ",
            slideIndex: "1",
            selectedCandidate: {
              atmosphere: "warm",
              elementsMarkdown: "- e1",
              visualSlots: [{ slotId: "v1" }],
            },
          },
          { slideIntentId: "   ", slideIndex: 2, selectedCandidate: { atmosphere: "skip" } },
        ],
      },
    };
    const runContext = { runId: "run-2", timeoutMs: 1000 };

    loop._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }] },
    });

    const result = await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage,
      designSystem,
      constraints,
      userConfig: {},
      context,
      runContext,
      emit,
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    expect(mockedImagePlanner.ImagePlanner.plan).not.toHaveBeenCalled();
    expect(loop._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({
        imageSlots: [{ slotId: "img-x", style: "flat", slideIndex: 0 }],
        selectedIdeas: [
          {
            slideIntentId: "s1",
            slideIndex: undefined,
            atmosphere: "warm",
            elementsMarkdown: "- e1",
            visualSlots: [{ slotId: "v1" }],
          },
        ],
      }),
      exec.stepInfo.context
    );
    expect(result.pendingImages).toEqual(["img-x"]);
    expect(findEmitStageCall("design.image.planning.completed")).toBeNull();
  });

  it("degrades when QA fails, falls back to title-only HTML, and emits degraded event", async () => {
    const longTitle = "T".repeat(10000);
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });
    const slideIntents = [{ slideIntentId: "s1", pageType: "cover", title: longTitle }];
    const contentPackage = {};
    const designSystem = { designTokens: { colors: { bg: "#fff" } } };
    const constraints = {};
    const emit = vi.fn();

    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([
      { slotId: "img-1", style: "photo", slideIndex: 0 },
    ]);
    mockedQaValidator.validateSlide.mockReturnValue({ pass: false });
    loop._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<bad/>" }] },
    });

    const result = await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage,
      designSystem,
      constraints,
      userConfig: {},
      context: {},
      runContext: { runId: "run-3", timeoutMs: 1000 },
      emit,
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    expect(mockedDslBuilder.buildSlideHtml).toHaveBeenCalledWith(
      slideIntents[0],
      designSystem,
      contentPackage,
      expect.objectContaining({
        safeMode: true,
        slideNo: 1,
        imageSlotsForSlide: [{ slotId: "img-1", style: "photo", slideIndex: 0 }],
      })
    );
    expect(mockedDesignUtils.escapeHtml).toHaveBeenCalledWith(longTitle);
    expect(result.slideHtmls[0]).toContain('data-layout="safe"');
    expect(result.slideHtmls[0]).toContain(`data-title="ESC(${longTitle})"`);
    expect(result.degradedCount).toBe(2);
    expect(result.generated[0]).toEqual(expect.objectContaining({ slideHtml: result.slideHtmls[0], source: "fallback" }));
    expect(loop._transitionPhase).not.toHaveBeenCalled();

    const degradedCall = findEmitStageCall("design.degraded");
    expect(degradedCall).not.toBeNull();
    expect(degradedCall[3]).toEqual({ degradedCount: 2, reason: "qa_failed_after_safe" });

    const qaEndedCall = findEmitStageCall("design.qa.ended");
    expect(qaEndedCall).not.toBeNull();
    expect(qaEndedCall[3]).toEqual({ slides: 1, qaFailed: 1, degradedCount: 2 });
  });

  it("handles null/undefined inputs, type mismatches, and non-positive timeouts", async () => {
    const loop = makeLoop({
      applyUserInputsToConfig: vi.fn((cfg) => ({ normalized: true, source: cfg })),
    });
    loop.state = {
      slideIntents: [],
      contentPackage: { fromState: true },
      designSystem: {},
      constraints: null,
      userConfig: { initial: true },
    };
    const exec = makeExecution({ id: "sig" });

    loop._callTool.mockResolvedValue({ ok: true, data: [] });

    const result = await runGeneratingPhase(loop, {
      slideIntents: { not: "array" },
      contentPackage: null,
      designSystem: undefined,
      constraints: undefined,
      userConfig: "",
      context: { timeoutMs: -1 },
      runContext: { runId: "run-4", timeoutMs: "1000" },
      emit: vi.fn(),
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    expect(exec.startExecution).toHaveBeenCalledWith(
      "generating",
      expect.objectContaining({
        slideIntents: [],
        contentPackage: { fromState: true },
        constraints: {},
        userConfig: { normalized: true, source: "" },
      })
    );
    expect(mockedCancellation.createLinkedSignal).not.toHaveBeenCalled();
    expect(loop._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({ signal: exec.stepInfo.context.signal }),
      exec.stepInfo.context
    );
    expect(findEmitStageCall("design.image.planning.completed")).toBeNull();

    expect(loop.applyUserInputsToConfig).toHaveBeenCalledTimes(2);
    expect(loop.state.userConfig).toEqual({ normalized: true, source: { normalized: true, source: "" } });
    expect(result.slideHtmls).toEqual([]);
    expect(result.slidesMeta).toEqual([]);
    expect(result.pendingImages).toEqual([]);
  });

  it("throws when spawn_slide_agent fails", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });
    loop._callTool.mockResolvedValue({ ok: false, error: "boom" });

    await expect(
      runGeneratingPhase(loop, {
        slideIntents: [],
        contentPackage: {},
        designSystem: {},
        constraints: {},
        userConfig: {},
        context: {},
        runContext: { runId: "run-5", timeoutMs: 1 },
        emit: vi.fn(),
        startExecution: exec.startExecution,
        finishExecution: exec.finishExecution,
        traceContext: null,
        skipReview: true,
      })
    ).rejects.toThrow("boom");

    expect(exec.finishExecution).not.toHaveBeenCalled();
  });

  it("supports concurrent calls with isolated loops and zero timeout", async () => {
    const loopA = makeLoop();
    const loopB = makeLoop();
    const execA = makeExecution({ id: "sigA" });
    const execB = makeExecution({ id: "sigB" });
    const emitA = vi.fn();
    const emitB = vi.fn();

    mockedImagePlanner.ImagePlanner.plan.mockImplementation((intents) =>
      intents.map((intent, idx) => ({ slotId: `${intent.slideIntentId}-slot`, style: "flat", slideIndex: idx }))
    );

    loopA._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));
    loopB._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));

    const [outA, outB] = await Promise.all([
      runGeneratingPhase(loopA, {
        slideIntents: [{ slideIntentId: "a1" }],
        contentPackage: {},
        designSystem: {},
        constraints: {},
        userConfig: {},
        context: {},
        runContext: { runId: "run-A", timeoutMs: 0 },
        emit: emitA,
        startExecution: execA.startExecution,
        finishExecution: execA.finishExecution,
        traceContext: null,
        skipReview: true,
      }),
      runGeneratingPhase(loopB, {
        slideIntents: [{ slideIntentId: "b1" }, { slideIntentId: "b2" }],
        contentPackage: {},
        designSystem: {},
        constraints: {},
        userConfig: {},
        context: {},
        runContext: { runId: "run-B", timeoutMs: 0 },
        emit: emitB,
        startExecution: execB.startExecution,
        finishExecution: execB.finishExecution,
        traceContext: null,
        skipReview: true,
      }),
    ]);

    expect(mockedCancellation.createLinkedSignal).not.toHaveBeenCalled();
    expect(outA.slideHtmls).toEqual(["<a1/>"]);
    expect(outB.slideHtmls).toEqual(["<b1/>", "<b2/>"]);
    expect(loopA.state.slideHtmls).toEqual(outA.slideHtmls);
    expect(loopB.state.slideHtmls).toEqual(outB.slideHtmls);
  });

  it("handles rapid consecutive calls on the same loop", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });

    loop._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));

    const first = await runGeneratingPhase(loop, {
      slideIntents: [{ slideIntentId: "s1" }],
      contentPackage: {},
      designSystem: {},
      constraints: {},
      userConfig: {},
      context: {},
      runContext: { runId: "run-6", timeoutMs: 0 },
      emit: vi.fn(),
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    const second = await runGeneratingPhase(loop, {
      slideIntents: [{ slideIntentId: "s2" }, { slideIntentId: "s3" }],
      contentPackage: {},
      designSystem: {},
      constraints: {},
      userConfig: {},
      context: {},
      runContext: { runId: "run-7", timeoutMs: 0 },
      emit: vi.fn(),
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    expect(first.slideHtmls).toEqual(["<s1/>"]);
    expect(second.slideHtmls).toEqual(["<s2/>", "<s3/>"]);
    expect(loop.state.slideHtmls).toEqual(second.slideHtmls);
    expect(loop._callTool).toHaveBeenCalledTimes(2);
  });

  it("handles large payloads, deep constraints, and MAX_SAFE_INTEGER timeout", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });
    const largeText = "x".repeat(120000);
    const deepConstraints = {
      imagePolicy: "balanced",
      imageBudget: Number.MAX_SAFE_INTEGER,
      nested: { level1: { level2: { level3: { level4: "deep" } } } },
    };
    const contentPackage = { raw: largeText };
    const slideIntents = [{ slideIntentId: "big", pageType: "content", title: "Big" }];

    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([
      { slotId: "img-big", style: "hd", slideIndex: 0 },
    ]);
    loop._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<big/>" }] },
    });

    await runGeneratingPhase(loop, {
      slideIntents,
      contentPackage,
      designSystem: {},
      constraints: deepConstraints,
      userConfig: {},
      context: {},
      runContext: { runId: "run-8", timeoutMs: Number.MAX_SAFE_INTEGER },
      emit: vi.fn(),
      startExecution: exec.startExecution,
      finishExecution: exec.finishExecution,
      traceContext: null,
      skipReview: true,
    });

    expect(exec.startExecution).toHaveBeenCalledWith(
      "generating",
      expect.objectContaining({ constraints: deepConstraints, contentPackage })
    );
    expect(mockedCancellation.createLinkedSignal).toHaveBeenCalledWith(
      exec.stepInfo.context.signal,
      Number.MAX_SAFE_INTEGER
    );
    expect(loop._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({
        contentPackage,
      }),
      exec.stepInfo.context
    );
  });
});
