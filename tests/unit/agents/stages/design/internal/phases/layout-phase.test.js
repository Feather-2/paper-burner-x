import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../js/agents/runtime/index.js", () => ({
  checkCancelled: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: {
    LAYOUT_DEVELOPING: "layout_developing",
    LAYOUT_CONFIRMING: "layout_confirming",
  },
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/generators/layout-generator.js", () => ({
  generateLayoutBatch: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  runWithPhaseSpan: vi.fn(),
}));

import { runLayoutPhase } from "../../../../../../../js/agents/stages/design/internal/phases/layout-phase.js";
import { checkCancelled } from "../../../../../../../js/agents/runtime/index.js";
import { DesignPhase } from "../../../../../../../js/agents/stages/design/states.js";
import { emitStage } from "../../../../../../../js/agents/stages/design/design-helpers.js";
import { generateLayoutBatch } from "../../../../../../../js/agents/stages/design/generators/layout-generator.js";
import { runWithPhaseSpan } from "../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js";

const createLoop = (overrides = {}) => ({
  phase: "initial",
  state: {
    slideIntents: [],
    plans: [],
  },
  phaseRunner: { _transitionPhase: vi.fn() },
  userActionHandler: { waitForUserAction: vi.fn() },
  _blackboard: {
    logDecision: vi.fn(),
    setSummary: vi.fn(),
  },
  ...overrides,
});

const makeSlideIntents = () => [
  { slideIntentId: "s1", title: "Slide 1" },
  { slideIntentId: "s2", title: "Slide 2" },
];

const makeLayouts = () => ([
  { slideIntentId: "s1", layoutHtml: "<div class=\"layout\" data-slide-id=\"s1\"></div>", meta: { order: 1 } },
  { slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>", meta: { order: 2 } },
]);

describe("runLayoutPhase", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    checkCancelled.mockImplementation(() => {});
    runWithPhaseSpan.mockImplementation(async (_trace, _name, _attrs, runPhase) => runPhase());
  });

  it("generates layouts, emits preview/confirmed, and updates state (runId=0)", async () => {
    const largeHtml = `<div class=\"layout\" data-slide-id=\"s1\">${"a".repeat(21000)}</div>`;
    const layouts = [
      { slideIntentId: "s1", layoutHtml: largeHtml },
      { slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>" },
    ];
    generateLayoutBatch.mockReturnValue(layouts);

    const slideIntents = makeSlideIntents();
    const plans = [{ planId: 1 }];
    const loop = createLoop({ state: { slideIntents, plans } });
    const emit = vi.fn();
    const context = { signal: null, interactionMode: { layoutConfirm: "skip" } };
    const traceContext = { traceId: "trace" };

    const result = await runLayoutPhase(loop, {
      slideIntents,
      plans,
      context,
      runContext: { runId: 0 },
      emit,
      traceContext,
    });

    const previewHtml = `${layouts[0].layoutHtml}\n${layouts[1].layoutHtml}`;

    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      traceContext,
      "design.phase.layout",
      { runId: 0, slideCount: 2 },
      expect.any(Function)
    );
    expect(checkCancelled).toHaveBeenCalledWith(null);
    expect(generateLayoutBatch).toHaveBeenCalledWith(slideIntents, plans);
    expect(loop.phaseRunner._transitionPhase).toHaveBeenCalledWith(loop.phase, DesignPhase.LAYOUT_DEVELOPING, { emit, runId: 0 });
    expect(loop.phaseRunner._transitionPhase).toHaveBeenCalledWith(loop.phase, DesignPhase.LAYOUT_CONFIRMING, { emit, runId: 0 });

    expect(emitStage).toHaveBeenNthCalledWith(
      1,
      emit,
      "design.layout.preview",
      "awaiting_confirm",
      expect.objectContaining({
        runId: 0,
        layouts,
        previewHtml,
        slideCount: 2,
      })
    );
    expect(emitStage).toHaveBeenNthCalledWith(
      2,
      emit,
      "design.layout.confirmed",
      "confirmed",
      expect.objectContaining({
        runId: 0,
        layouts,
        slideCount: 2,
      })
    );
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith("layout_generated", "Generated 2 layout wireframes");
    expect(loop.state.layoutData).toEqual(result);
    expect(loop._blackboard.setSummary).toHaveBeenCalledWith("layout", "Wireframes generated");
    expect(result).toEqual({ layouts });
  });

  it("applies safe overrides when user confirms (runId=-1)", async () => {
    const layouts = makeLayouts();
    generateLayoutBatch.mockReturnValue(layouts);

    const overrides = [
      {
        slideIntentId: "s1",
        layoutHtml: "<section class=\"layout\" data-slide-id=\"s1\" data-type=\"wire\"></section>",
      },
      {
        slideIntentId: "s2",
        layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"><ul class=\"layout-points\"><li class=\"point\">X</li></ul></div>",
      },
    ];

    const loop = createLoop({ state: { slideIntents: makeSlideIntents(), plans: [] } });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({ layouts: overrides });

    const emit = vi.fn();
    const context = {
      interactionMode: { layoutConfirm: "confirm" },
      eventBus: { id: "bus" },
      signal: null,
    };

    const result = await runLayoutPhase(loop, {
      slideIntents: loop.state.slideIntents,
      plans: loop.state.plans,
      context,
      runContext: { runId: -1 },
      emit,
      traceContext: {},
    });

    expect(loop.userActionHandler.waitForUserAction).toHaveBeenCalledWith("confirm_layout", {
      eventBus: context.eventBus,
      signal: context.signal,
    });
    expect(result.layouts[0].layoutHtml).toBe(overrides[0].layoutHtml);
    expect(result.layouts[0].meta).toEqual({ order: 1 });
    expect(result.layouts[1].layoutHtml).toBe(overrides[1].layoutHtml);
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith("layout_edited", "User modified layouts");

    const confirmedPayload = emitStage.mock.calls[1][3];
    expect(confirmedPayload.runId).toBe(-1);
    expect(confirmedPayload.layouts[0].layoutHtml).toBe(overrides[0].layoutHtml);
  });

  it("ignores overrides with empty layoutHtml", async () => {
    const layouts = makeLayouts();
    generateLayoutBatch.mockReturnValue(layouts);

    const loop = createLoop({ state: { slideIntents: makeSlideIntents(), plans: [] } });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
      layouts: [
        { slideIntentId: "s1", layoutHtml: "" },
        { slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>" },
      ],
    });

    const emit = vi.fn();
    const context = { interactionMode: { layoutConfirm: "confirm" }, eventBus: {}, signal: null };

    const result = await runLayoutPhase(loop, {
      slideIntents: loop.state.slideIntents,
      plans: loop.state.plans,
      context,
      runContext: { runId: 1 },
      emit,
      traceContext: {},
    });

    expect(result.layouts).toEqual(layouts);
    const edited = loop._blackboard.logDecision.mock.calls.some(([key]) => key === "layout_edited");
    expect(edited).toBe(false);
    expect(emitStage.mock.calls[1][3].layouts[0].layoutHtml).toBe(layouts[0].layoutHtml);
  });

  it("ignores overrides with whitespace layoutHtml", async () => {
    const layouts = makeLayouts();
    generateLayoutBatch.mockReturnValue(layouts);

    const loop = createLoop({ state: { slideIntents: makeSlideIntents(), plans: [] } });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
      layouts: [
        { slideIntentId: "s1", layoutHtml: "   " },
        { slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>" },
      ],
    });

    const emit = vi.fn();
    const context = { interactionMode: { layoutConfirm: "confirm" }, eventBus: {}, signal: null };

    const result = await runLayoutPhase(loop, {
      slideIntents: loop.state.slideIntents,
      plans: loop.state.plans,
      context,
      runContext: { runId: 2 },
      emit,
      traceContext: {},
    });

    expect(result.layouts).toEqual(layouts);
    const edited = loop._blackboard.logDecision.mock.calls.some(([key]) => key === "layout_edited");
    expect(edited).toBe(false);
    expect(emitStage.mock.calls[1][3].layouts[0].layoutHtml).toBe(layouts[0].layoutHtml);
  });

  it("rejects oversized layoutHtml overrides", async () => {
    const layouts = makeLayouts();
    generateLayoutBatch.mockReturnValue(layouts);

    const longHtml = `<div class=\"layout\" data-slide-id=\"s1\">${"a".repeat(20001)}</div>`;
    const loop = createLoop({ state: { slideIntents: makeSlideIntents(), plans: [] } });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
      layouts: [
        { slideIntentId: "s1", layoutHtml: longHtml },
        { slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>" },
      ],
    });

    const emit = vi.fn();
    const context = { interactionMode: { layoutConfirm: "confirm" }, eventBus: {}, signal: null };

    const result = await runLayoutPhase(loop, {
      slideIntents: loop.state.slideIntents,
      plans: loop.state.plans,
      context,
      runContext: { runId: 3 },
      emit,
      traceContext: {},
    });

    expect(result.layouts).toEqual(layouts);
    const edited = loop._blackboard.logDecision.mock.calls.some(([key]) => key === "layout_edited");
    expect(edited).toBe(false);
  });

  it("falls back to loop.state when provided slideIntents/plans are invalid types", async () => {
    const deepSlideIntents = [
      {
        slideIntentId: "deep",
        nested: { level1: { level2: { level3: { value: "x", arr: [1, { leaf: "y" }] } } } },
      },
    ];
    const plans = [{ planId: "p1" }];
    const loop = createLoop({ state: { slideIntents: deepSlideIntents, plans } });

    const layouts = [{ slideIntentId: "deep", layoutHtml: "<div class=\"layout\" data-slide-id=\"deep\"></div>" }];
    generateLayoutBatch.mockReturnValue(layouts);

    const emit = vi.fn();
    const context = {};

    const result = await runLayoutPhase(loop, {
      slideIntents: "42",
      plans: { not: "array" },
      context,
      runContext: { runId: Number.MAX_SAFE_INTEGER },
      emit,
      traceContext: { traceId: "max" },
    });

    expect(generateLayoutBatch).toHaveBeenCalledWith(deepSlideIntents, plans);
    expect(checkCancelled).toHaveBeenCalledWith(undefined);
    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      { traceId: "max" },
      "design.phase.layout",
      { runId: Number.MAX_SAFE_INTEGER, slideCount: 1 },
      expect.any(Function)
    );
    expect(result.layouts[0].slideIntentId).toBe("deep");
  });

  it("handles empty arrays with string runId and null trace context", async () => {
    const loop = createLoop({ state: { slideIntents: [{ slideIntentId: "fallback" }], plans: [] } });
    generateLayoutBatch.mockReturnValue([]);

    const emit = vi.fn();
    const context = { signal: null };

    const result = await runLayoutPhase(loop, {
      slideIntents: [],
      plans: undefined,
      context,
      runContext: { runId: "0" },
      emit,
      traceContext: null,
    });

    expect(generateLayoutBatch).toHaveBeenCalledWith([], loop.state.plans);
    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      null,
      "design.phase.layout",
      { runId: "0", slideCount: 0 },
      expect.any(Function)
    );
    expect(emitStage.mock.calls[0][3].previewHtml).toBe("");
    expect(emitStage.mock.calls[0][3].slideCount).toBe(0);
    expect(result.layouts).toEqual([]);
  });

  it("supports concurrent invocations without shared state", async () => {
    generateLayoutBatch.mockImplementation((slideIntents) =>
      slideIntents.map((intent) => ({
        slideIntentId: intent.slideIntentId,
        layoutHtml: `<div class=\"layout\" data-slide-id=\"${intent.slideIntentId}\"></div>`,
      }))
    );

    const loopA = createLoop({ state: { slideIntents: [{ slideIntentId: "a1" }], plans: [] } });
    const loopB = createLoop({ state: { slideIntents: [{ slideIntentId: "b1" }, { slideIntentId: "b2" }], plans: [] } });

    const context = { signal: null, interactionMode: { layoutConfirm: "skip" } };

    const [resA, resB] = await Promise.all([
      runLayoutPhase(loopA, {
        slideIntents: loopA.state.slideIntents,
        plans: loopA.state.plans,
        context,
        runContext: { runId: 10 },
        emit: vi.fn(),
        traceContext: {},
      }),
      runLayoutPhase(loopB, {
        slideIntents: loopB.state.slideIntents,
        plans: loopB.state.plans,
        context,
        runContext: { runId: 11 },
        emit: vi.fn(),
        traceContext: {},
      }),
    ]);

    expect(resA.layouts).toHaveLength(1);
    expect(resB.layouts).toHaveLength(2);
    expect(resA.layouts[0].slideIntentId).toBe("a1");
    expect(resB.layouts.map((layout) => layout.slideIntentId)).toEqual(["b1", "b2"]);
    expect(loopA.state.layoutData).toEqual(resA);
    expect(loopB.state.layoutData).toEqual(resB);
  });

  it("supports rapid consecutive invocations on the same loop", async () => {
    const loop = createLoop({ state: { slideIntents: makeSlideIntents(), plans: [] } });
    const context = { signal: null, interactionMode: { layoutConfirm: "skip" } };

    const firstLayouts = [{ slideIntentId: "s1", layoutHtml: "<div class=\"layout\" data-slide-id=\"s1\"></div>" }];
    const secondLayouts = [{ slideIntentId: "s2", layoutHtml: "<div class=\"layout\" data-slide-id=\"s2\"></div>" }];

    generateLayoutBatch
      .mockImplementationOnce(() => firstLayouts)
      .mockImplementationOnce(() => secondLayouts);

    const first = await runLayoutPhase(loop, {
      slideIntents: loop.state.slideIntents,
      plans: loop.state.plans,
      context,
      runContext: { runId: 21 },
      emit: vi.fn(),
      traceContext: {},
    });

    const second = await runLayoutPhase(loop, {
      slideIntents: [{ slideIntentId: "s2" }],
      plans: loop.state.plans,
      context,
      runContext: { runId: 22 },
      emit: vi.fn(),
      traceContext: {},
    });

    expect(first.layouts).toEqual(firstLayouts);
    expect(second.layouts).toEqual(secondLayouts);
    expect(loop.state.layoutData).toEqual(second);
    expect(generateLayoutBatch).toHaveBeenCalledTimes(2);
  });

  it("propagates cancellation errors without emitting stages", async () => {
    checkCancelled.mockImplementation(() => {
      throw new Error("cancelled");
    });

    const loop = createLoop({ state: {} });
    const context = { signal: { aborted: false }, interactionMode: { layoutConfirm: "skip" } };

    await expect(
      runLayoutPhase(loop, {
        slideIntents: [],
        plans: [],
        context,
        runContext: null,
        emit: vi.fn(),
        traceContext: {},
      })
    ).rejects.toThrow("cancelled");

    expect(generateLayoutBatch).not.toHaveBeenCalled();
    expect(emitStage).not.toHaveBeenCalled();
    expect(loop._blackboard.setSummary).not.toHaveBeenCalled();
    expect(loop.state.layoutData).toBeUndefined();
  });
});
