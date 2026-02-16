// Unit tests for runVisualPhase covering normal, deferred, refine, error, and boundary paths.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  normalizeRenderType: vi.fn(),
  emitStage: vi.fn(),
  runWithPhaseSpan: vi.fn(),
  DESIGN_PHASE_DEFAULTS: {
    refineRecommendedSteps: 5,
    refineHardLimit: 15,
  },
  DesignPhase: {
    VISUAL_FILLING: "visual_filling",
  },
  runReactRefiner: vi.fn(),
  createToolExecutor: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  normalizeRenderType: mocks.normalizeRenderType,
}));

vi.mock("../../../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: mocks.DesignPhase,
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: mocks.emitStage,
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  DESIGN_PHASE_DEFAULTS: mocks.DESIGN_PHASE_DEFAULTS,
  runWithPhaseSpan: mocks.runWithPhaseSpan,
}));

vi.mock("../../../../../../../js/agents/stages/design/refiner/react-refiner.js", () => ({
  runReactRefiner: mocks.runReactRefiner,
}));

vi.mock("../../../../../../../js/agents/stages/design/refiner/react-refiner-tools.js", () => ({
  createToolExecutor: mocks.createToolExecutor,
}));

let runVisualPhase;

function buildStartExecution(contextValue = { id: "visual-context" }) {
  return vi.fn(async () => ({
    loopIteration: { id: "loop-iteration" },
    stepInfo: { context: contextValue },
  }));
}

function buildLoop(overrides = {}) {
  return {
    phase: "init",
    state: {},
    phaseRunner: { _transitionPhase: vi.fn() },
    _buildVisualSlots: vi.fn(() => [{ slotId: "visual-1" }]),
    toolDispatch: { _callTool: vi.fn(async () => ({ ok: true, data: {} })) },
    ...overrides,
  };
}

function buildParams(overrides = {}) {
  return {
    contentPackage: { id: "content" },
    slideIntents: [{ id: "intent" }],
    designSystem: { theme: "light" },
    generated: [{ id: "gen" }],
    slideHtmls: ["<section>one</section>"],
    slidesMeta: [{ index: 0 }],
    imageSlots: [
      { slotId: "slot-1", renderType: "ai-image" },
      { slotId: "slot-2", renderType: "stock-image" },
    ],
    baseDeckHtmlDsl: "<deck/>",
    pendingImages: ["pending-1"],
    brainstormResult: { idea: "alpha" },
    constraints: { limit: 1 },
    userConfig: { refine: { enabled: false } },
    context: { imageProvider: { name: "provider" }, modelRouter: { id: "router" } },
    runContext: { runId: "run-1" },
    emit: vi.fn(),
    startExecution: buildStartExecution(),
    finishExecution: vi.fn(async () => {}),
    emitDeckUpdate: vi.fn(),
    traceContext: { trace: true },
    ...overrides,
  };
}

function buildDeepObject(depth) {
  const root = { level: 0 };
  let current = root;

  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }

  return root;
}

describe("runVisualPhase", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mocks.normalizeRenderType.mockImplementation((value) => value);
    mocks.runWithPhaseSpan.mockImplementation(async (_trace, _name, _attrs, fn) => fn());
    mocks.createToolExecutor.mockImplementation(() => vi.fn());
    mocks.runReactRefiner.mockImplementation(async (deckPackage) => ({
      finalDeck: deckPackage,
      qualityScore: 0.8,
      steps: [{ id: 1 }],
      terminationReason: "complete",
    }));

    ({ runVisualPhase } = await import(
      "../../../../../../../js/agents/stages/design/internal/phases/visual-phase.js"
    ));
  });

  it("fills visuals and updates state", async () => {
    const stepContext = { name: "visual-context" };
    const startExecution = buildStartExecution(stepContext);
    const finishExecution = vi.fn(async () => {});
    const emitDeckUpdate = vi.fn();
    const emit = vi.fn();

    const loop = buildLoop({
      _buildVisualSlots: vi.fn(() => [{ slotId: "render-1" }]),
      toolDispatch: {
        _callTool: vi.fn(async () => ({
          ok: true,
          data: {
            deckHtmlDsl: "<deck>filled</deck>",
            finalImageSlots: [{ slotId: "slot-final" }],
            imageReport: { total: 2 },
            visualReport: { ok: true },
            pendingImages: ["slot-final"],
          },
        })),
      },
    });

    const params = buildParams({
      startExecution,
      finishExecution,
      emitDeckUpdate,
      emit,
      constraints: {},
      imageSlots: [
        { slotId: "slot-1", renderType: "ai-image" },
        { slotId: "slot-2", renderType: "photo" },
      ],
      context: { imageProvider: { id: "provider" }, modelRouter: { id: "router" } },
    });

    mocks.normalizeRenderType.mockImplementation((value) => {
      if (value === "ai-image") return "ai-image";
      if (value === "ai") return "ai-image";
      return "other";
    });

    const result = await runVisualPhase(loop, params);

    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      params.traceContext,
      "design.phase.visual",
      { runId: "run-1", slideCount: params.slideHtmls.length },
      expect.any(Function)
    );
    expect(loop.phaseRunner._transitionPhase).toHaveBeenCalledWith("init", "visual_filling", {
      emit,
      runId: "run-1",
    });
    expect(startExecution).toHaveBeenCalledWith(
      "visual_filling",
      expect.objectContaining({
        contentPackage: params.contentPackage,
        slideIntents: params.slideIntents,
        designSystem: params.designSystem,
        generated: params.generated,
        slideHtmls: params.slideHtmls,
        slidesMeta: params.slidesMeta,
        imageSlots: params.imageSlots,
        deckHtmlDsl: params.baseDeckHtmlDsl,
        pendingImages: params.pendingImages,
        deferredVisuals: false,
      })
    );
    expect(loop._buildVisualSlots).toHaveBeenCalledWith(
      params.brainstormResult,
      params.imageSlots,
      params.context.imageProvider,
      true
    );
    expect(mocks.normalizeRenderType).toHaveBeenCalledTimes(2);
    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "fill_visual",
      expect.objectContaining({
        visualSlotsForRender: [{ slotId: "render-1" }],
        contentPackage: params.contentPackage,
        designSystem: params.designSystem,
        slideHtmls: params.slideHtmls,
        runContext: params.runContext,
        constraints: params.constraints,
        imageSlots: params.imageSlots,
        aiImageSlotIds: ["slot-1"],
      }),
      stepContext
    );
    expect(emitDeckUpdate).toHaveBeenCalledWith("<deck>filled</deck>", params.slidesMeta, {
      source: "visual_fill",
    });
    expect(finishExecution).toHaveBeenCalledWith(
      "visual_filling",
      { id: "loop-iteration" },
      { context: stepContext }
    );
    expect(result).toEqual({
      deckHtmlDsl: "<deck>filled</deck>",
      slidesMeta: params.slidesMeta,
      imageSlots: [{ slotId: "slot-final" }],
      imageReport: { total: 2 },
      visualReport: { ok: true },
      refineResult: null,
      pendingImages: ["slot-final"],
    });
    expect(loop.state.deckHtmlDsl).toBe("<deck>filled</deck>");
    expect(loop.state.slidesMeta).toBe(params.slidesMeta);
    expect(loop.state.finalImageSlots).toEqual([{ slotId: "slot-final" }]);
    expect(loop.state.visualReport).toEqual({ ok: true });
    expect(loop.state.imageReport).toEqual({ total: 2 });
    expect(loop.state.pendingImages).toEqual(["slot-final"]);
  });

  it("handles deferred visuals with null/undefined and type boundary inputs", async () => {
    const loop = buildLoop({
      state: {
        contentPackage: { id: "from-state" },
        slideIntents: [],
        designSystem: { theme: "state" },
        generated: [],
        slideHtmls: ["state-slide"],
        slidesMeta: [{ index: 1 }],
        imageSlots: [{ slotId: "state-slot", renderType: "ai-image" }],
        baseDeckHtmlDsl: "",
        pendingImages: [],
        constraints: {},
        userConfig: {},
      },
    });

    const emit = vi.fn();
    const startExecution = buildStartExecution({ id: "visual-context" });
    const finishExecution = vi.fn(async () => {});
    const emitDeckUpdate = vi.fn();
    const params = buildParams({
      contentPackage: null,
      slideIntents: { 0: "bad", length: 1 },
      designSystem: undefined,
      generated: undefined,
      slideHtmls: "not-array",
      slidesMeta: [],
      imageSlots: undefined,
      baseDeckHtmlDsl: 0,
      pendingImages: [],
      constraints: {},
      userConfig: {},
      context: { deferredVisuals: true },
      emit,
      startExecution,
      finishExecution,
      emitDeckUpdate,
    });

    const result = await runVisualPhase(loop, params);
    const startInput = startExecution.mock.calls[0][1];

    expect(startInput.contentPackage).toBe(loop.state.contentPackage);
    expect(startInput.slideIntents).toBe(loop.state.slideIntents);
    expect(startInput.designSystem).toBe(loop.state.designSystem);
    expect(startInput.generated).toBe(loop.state.generated);
    expect(startInput.slideHtmls).toBe(loop.state.slideHtmls);
    expect(startInput.slidesMeta).toEqual([]);
    expect(startInput.imageSlots).toBe(loop.state.imageSlots);
    expect(startInput.deckHtmlDsl).toBe("");
    expect(startInput.pendingImages).toEqual([]);
    expect(startInput.deferredVisuals).toBe(true);
    expect(loop._buildVisualSlots).not.toHaveBeenCalled();
    expect(loop.toolDispatch._callTool).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("design.visual.deferred", {
      runId: "run-1",
      imageSlotCount: 1,
      message: "Visual rendering deferred - placeholders retained",
    });
    expect(finishExecution).toHaveBeenCalled();
    expect(result).toEqual({
      deckHtmlDsl: "",
      slidesMeta: [],
      imageSlots: loop.state.imageSlots,
      imageReport: { deferred: true, slotCount: 1 },
      visualReport: null,
      pendingImages: ["state-slot"],
    });
  });

  const refineCases = [
    {
      label: "zero and negative",
      recommendedSteps: 0,
      hardLimit: -1,
      expectedSteps: 1,
      expectedLimit: 1,
    },
    {
      label: "numeric strings",
      recommendedSteps: "7",
      hardLimit: "12",
      expectedSteps: 7,
      expectedLimit: 12,
    },
    {
      label: "whitespace and max safe",
      recommendedSteps: "   ",
      hardLimit: Number.MAX_SAFE_INTEGER,
      expectedSteps: 1,
      expectedLimit: 30,
    },
  ];

  it.each(refineCases)("refine clamps config values: $label", async (caseData) => {
    const toolExecutor = vi.fn();
    mocks.createToolExecutor.mockReturnValue(toolExecutor);
    mocks.runReactRefiner.mockResolvedValueOnce({
      finalDeck: {
        deckHtmlDsl: `refined-${caseData.label}`,
        slidesMeta: [{ index: 2 }],
      },
      qualityScore: 0.91,
      steps: [{ id: 1 }, { id: 2 }],
      terminationReason: "done",
    });

    const stepContext = { id: "visual-context" };
    const loop = buildLoop({
      toolDispatch: {
        _callTool: vi.fn(async () => ({
          ok: true,
          data: {
            deckHtmlDsl: "<deck>filled</deck>",
            finalImageSlots: [{ slotId: "slot-final" }],
            imageReport: { total: 1 },
            visualReport: { ok: true },
            pendingImages: [],
          },
        })),
      },
    });

    const emitDeckUpdate = vi.fn();
    const startExecution = buildStartExecution(stepContext);
    const params = buildParams({
      startExecution,
      emitDeckUpdate,
      userConfig: {
        refine: {
          enabled: true,
          recommendedSteps: caseData.recommendedSteps,
          hardLimit: caseData.hardLimit,
        },
      },
    });

    const result = await runVisualPhase(loop, params);

    expect(mocks.createToolExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        deckPackage: expect.objectContaining({
          deckHtmlDsl: "<deck>filled</deck>",
        }),
        contentPackage: params.contentPackage,
        stageApi: stepContext,
      })
    );
    expect(mocks.runReactRefiner).toHaveBeenCalledTimes(1);
    const options = mocks.runReactRefiner.mock.calls[0][2];
    expect(options.recommendedSteps).toBe(caseData.expectedSteps);
    expect(options.hardLimit).toBe(caseData.expectedLimit);
    expect(options.mode).toBe("generation");
    expect(options.toolExecutor).toBe(toolExecutor);
    expect(emitDeckUpdate).toHaveBeenNthCalledWith(
      1,
      "<deck>filled</deck>",
      params.slidesMeta,
      { source: "visual_fill" }
    );
    expect(emitDeckUpdate).toHaveBeenNthCalledWith(
      2,
      `refined-${caseData.label}`,
      [{ index: 2 }],
      { source: "refine" }
    );
    expect(mocks.emitStage).toHaveBeenCalledWith(
      params.emit,
      "design.refine.ended",
      "ended",
      expect.objectContaining({
        qualityScore: 0.91,
        stepCount: 2,
        terminationReason: "done",
      })
    );
    expect(result.deckHtmlDsl).toBe(`refined-${caseData.label}`);
    expect(result.slidesMeta).toEqual([{ index: 2 }]);
    expect(result.refineResult).toEqual(
      expect.objectContaining({
        qualityScore: 0.91,
        terminationReason: "done",
      })
    );
  });

  it("throws when fill_visual fails", async () => {
    const loop = buildLoop({
      toolDispatch: {
        _callTool: vi.fn(async () => ({ ok: false, error: "nope" })),
      },
    });
    const finishExecution = vi.fn(async () => {});
    const params = buildParams({
      finishExecution,
    });

    await expect(runVisualPhase(loop, params)).rejects.toThrow("nope");
    expect(finishExecution).not.toHaveBeenCalled();
    expect(loop.state.deckHtmlDsl).toBeUndefined();
  });

  it("forwards resource boundary payloads", async () => {
    const longString = "x".repeat(200000);
    const largeArray = Array.from({ length: 50000 }, (_, index) => index);
    const deepNestedObject = buildDeepObject(64);
    const largeFileLike = {
      name: "big.txt",
      content: longString,
      size: longString.length,
      chunks: largeArray,
    };

    const stepContext = { id: "visual-context" };
    const startExecution = buildStartExecution(stepContext);
    const loop = buildLoop({
      toolDispatch: {
        _callTool: vi.fn(async () => ({
          ok: true,
          data: {
            deckHtmlDsl: "<deck>filled</deck>",
            finalImageSlots: [{ slotId: "slot-final" }],
            imageReport: { total: 1 },
            visualReport: { ok: true },
            pendingImages: [],
          },
        })),
      },
    });

    const params = buildParams({
      contentPackage: largeFileLike,
      slideIntents: largeArray,
      slideHtmls: [longString],
      baseDeckHtmlDsl: longString,
      constraints: deepNestedObject,
      startExecution,
    });

    await runVisualPhase(loop, params);

    const startInput = startExecution.mock.calls[0][1];
    expect(startInput.contentPackage).toBe(largeFileLike);
    expect(startInput.slideIntents).toBe(largeArray);
    expect(startInput.deckHtmlDsl.length).toBe(longString.length);
    expect(startInput.slideHtmls[0].length).toBe(longString.length);
    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "fill_visual",
      expect.objectContaining({
        contentPackage: largeFileLike,
        constraints: deepNestedObject,
      }),
      stepContext
    );
  });

  it("supports concurrent calls", async () => {
    const scenarios = [1, 2, 3].map((id) => {
      const loop = buildLoop({
        toolDispatch: {
          _callTool: vi.fn(async () => ({
            ok: true,
            data: {
              deckHtmlDsl: `deck-${id}`,
              finalImageSlots: [{ slotId: `slot-${id}` }],
              imageReport: { id },
              visualReport: { id },
              pendingImages: [],
            },
          })),
        },
      });
      const params = buildParams({
        runContext: { runId: `run-${id}` },
      });
      return { loop, params, expected: `deck-${id}` };
    });

    const results = await Promise.all(
      scenarios.map(({ loop, params }) => runVisualPhase(loop, params))
    );

    expect(results.map((res) => res.deckHtmlDsl)).toEqual([
      "deck-1",
      "deck-2",
      "deck-3",
    ]);
    scenarios.forEach(({ loop }) => {
      expect(loop.toolDispatch._callTool).toHaveBeenCalledTimes(1);
    });
  });

  it("supports rapid consecutive calls", async () => {
    const results = [];

    for (let i = 0; i < 10; i += 1) {
      const loop = buildLoop({
        toolDispatch: {
          _callTool: vi.fn(async () => ({
            ok: true,
            data: {
              deckHtmlDsl: `deck-${i}`,
              finalImageSlots: [{ slotId: `slot-${i}` }],
              imageReport: { id: i },
              visualReport: { id: i },
              pendingImages: [],
            },
          })),
        },
      });
      const params = buildParams({
        runContext: { runId: `run-${i}` },
      });
      results.push(await runVisualPhase(loop, params));
    }

    expect(results).toHaveLength(10);
    expect(results[9].deckHtmlDsl).toBe("deck-9");
  });
});
