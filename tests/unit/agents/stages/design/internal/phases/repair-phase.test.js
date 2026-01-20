// Unit tests for runBatchRepairPhase covering happy path, failures, and edge cases.
// Includes legacy signature handling, type boundaries, and resource/concurrency limits.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockedDesignHelpers = vi.hoisted(() => ({
  emitStage: vi.fn(),
}));

const mockedStates = vi.hoisted(() => ({
  DesignPhase: { REPAIR: "repair" },
}));

const mockedPhaseUtils = vi.hoisted(() => ({
  runWithPhaseSpan: vi.fn(),
}));

const mockedAutoReviewer = vi.hoisted(() => ({
  runAutoReview: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: mockedDesignHelpers.emitStage,
}));

vi.mock("../../../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: mockedStates.DesignPhase,
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  runWithPhaseSpan: mockedPhaseUtils.runWithPhaseSpan,
}));

vi.mock("../../../../../../../js/agents/stages/design/reviewer/auto-reviewer.js", () => ({
  runAutoReview: mockedAutoReviewer.runAutoReview,
}));

async function loadRepairPhase() {
  return await import("../../../../../../../js/agents/stages/design/internal/phases/repair-phase.js");
}

function makeLoop(state, overrides = {}) {
  return {
    state,
    phase: "layout_generating",
    _transitionPhase: vi.fn(),
    _callTool: vi.fn(),
    ...overrides,
  };
}

function makeParams(overrides = {}) {
  return {
    context: { signal: undefined },
    runContext: { runId: "run_default" },
    emit: vi.fn(),
    traceContext: null,
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

const longString = "x".repeat(200000);
const largeArray = Array.from({ length: 1000 }, (_, index) => index);
const deepNestedObject = buildDeepObject(64);

beforeEach(() => {
  mockedDesignHelpers.emitStage.mockReset();
  mockedPhaseUtils.runWithPhaseSpan.mockReset();
  mockedAutoReviewer.runAutoReview.mockReset();

  mockedPhaseUtils.runWithPhaseSpan.mockImplementation(async (_trace, _name, _attrs, fn) => await fn());
  mockedAutoReviewer.runAutoReview.mockResolvedValue({ pass: true, issues: [], score: 1 });
});

describe("runBatchRepairPhase", () => {
  it("runs repair and updates state when issues exist", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const state = {
      slideHtmls: ["<section>One</section>"],
      slidesMeta: [{ slideNo: 1, qa: { pass: false, issues: ["typo"] }, degraded: false }],
      baseDeckHtmlDsl: "<section>One</section>",
      designSystem: { theme: "brand" },
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "run_1" } });

    mockedAutoReviewer.runAutoReview.mockResolvedValue({
      pass: false,
      issues: ["style"],
      score: 0.4,
    });

    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        finalDeck: {
          deckHtmlDsl: "<section>Fixed</section>",
          slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
        },
        qualityScore: 0.9,
        steps: ["a", "b"],
      },
    });

    const result = await runBatchRepairPhase(loop, params);

    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      params.traceContext,
      "design.phase.repair",
      { runId: "run_1", slideCount: 1 },
      expect.any(Function),
    );
    expect(loop._transitionPhase).toHaveBeenCalledWith(loop.phase, "repair", { emit: params.emit, runId: "run_1" });
    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "<section>One</section>", slidesMeta: state.slidesMeta },
      state.designSystem,
      { signal: params.context.signal },
    );
    expect(loop._callTool).toHaveBeenCalledWith(
      "orchestrate_batch_repair",
      {
        deckPackage: { deckHtmlDsl: "<section>One</section>", slidesMeta: state.slidesMeta },
        qaIssues: [{ slideIndex: 0, issues: ["typo"] }],
        styleIssues: ["style"],
        designSystem: state.designSystem,
      },
      params.context,
    );
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledTimes(2);
    expect(mockedDesignHelpers.emitStage).toHaveBeenNthCalledWith(
      1,
      params.emit,
      "design.repair.started",
      "progress",
      {
        qaIssueCount: 1,
        styleIssueCount: 1,
        consistencyScore: 0.4,
      },
    );
    expect(mockedDesignHelpers.emitStage).toHaveBeenNthCalledWith(
      2,
      params.emit,
      "design.repair.ended",
      "ended",
      {
        finalScore: 0.9,
        steps: 2,
      },
    );
    expect(result).toEqual({
      deckHtmlDsl: "<section>Fixed</section>",
      slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
    });
    expect(state.deckHtmlDsl).toBe("<section>Fixed</section>");
    expect(state.baseDeckHtmlDsl).toBe("<section>Fixed</section>");
    expect(state.slidesMeta).toEqual(result.slidesMeta);
  });

  it("skips repair when the deck is healthy", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const state = {
      slideHtmls: ["<section>A</section>", "<section>B</section>"],
      slidesMeta: [
        { slideNo: 1, qa: { pass: true, issues: [] } },
        { slideNo: 2, qa: { pass: true, issues: [] } },
      ],
      designSystem: { theme: "base" },
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "run_skip" } });

    mockedAutoReviewer.runAutoReview.mockResolvedValue({ pass: true, issues: [], score: 0.98 });

    const originalMeta = state.slidesMeta;
    const result = await runBatchRepairPhase(loop, params);
    const expectedDeck = state.slideHtmls.join("\n\n");

    expect(result).toEqual({ deckHtmlDsl: expectedDeck, slidesMeta: state.slidesMeta });
    expect(loop._callTool).not.toHaveBeenCalled();
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledTimes(1);
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledWith(
      params.emit,
      "design.repair.skipped",
      "progress",
      { reason: "healthy" },
    );
    expect(state.deckHtmlDsl).toBe(expectedDeck);
    expect(state.baseDeckHtmlDsl).toBe(expectedDeck);
    expect(state.slidesMeta).toBe(originalMeta);
  });

  it("returns base deck and emits failure when repair tool fails", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const state = {
      slideHtmls: ["<section>One</section>"],
      slidesMeta: [{ slideNo: 1, qa: { pass: false, issues: ["broken"] }, degraded: false }],
      baseDeckHtmlDsl: "<section>Base</section>",
      designSystem: { theme: "base" },
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "run_fail" } });

    mockedAutoReviewer.runAutoReview.mockResolvedValue({ pass: true, issues: [], score: 1 });
    loop._callTool.mockResolvedValue({ ok: false, error: "tool-failed" });

    const result = await runBatchRepairPhase(loop, params);

    expect(loop._callTool).toHaveBeenCalledTimes(1);
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledTimes(2);
    expect(mockedDesignHelpers.emitStage).toHaveBeenNthCalledWith(
      2,
      params.emit,
      "design.repair.failed",
      "warn",
      { error: "tool-failed" },
    );
    expect(result).toEqual({ deckHtmlDsl: "<section>Base</section>", slidesMeta: state.slidesMeta });
    expect(state.deckHtmlDsl).toBe("<section>Base</section>");
    expect(state.baseDeckHtmlDsl).toBe("<section>Base</section>");
  });

  it("supports legacy signature and boundary slide numbers", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const state = {
      slideHtmls: ["<section>Ignored</section>"],
      slidesMeta: [
        { slideNo: 0, qa: { pass: false, issues: "" } },
        { slideNo: -1, qa: { pass: false, issues: [] } },
        { slideNo: maxSafe, qa: { pass: false, issues: ["max"] } },
        { slideNo: "2", qa: { pass: false, issues: ["string"] } },
      ],
      baseDeckHtmlDsl: "   ",
      designSystem: {},
    };
    const loop = makeLoop({ baseDeckHtmlDsl: "<section>Loop</section>" });
    const params = makeParams({ runContext: { runId: "run_legacy" } });

    mockedAutoReviewer.runAutoReview.mockResolvedValue({
      pass: false,
      issues: ["style"],
      score: 0.2,
    });
    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        deckHtmlDsl: "legacy-final",
        slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
        qualityScore: 0.6,
        steps: [],
      },
    });

    const result = await runBatchRepairPhase(loop, state, params);

    expect(loop._transitionPhase).toHaveBeenCalledWith(loop.phase, "repair", { emit: params.emit, runId: "run_legacy" });
    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "   ", slidesMeta: state.slidesMeta },
      state.designSystem,
      { signal: params.context.signal },
    );
    expect(loop._callTool).toHaveBeenCalledWith(
      "orchestrate_batch_repair",
      {
        deckPackage: { deckHtmlDsl: "   ", slidesMeta: state.slidesMeta },
        qaIssues: [
          { slideIndex: -1, issues: "" },
          { slideIndex: -2, issues: [] },
          { slideIndex: maxSafe - 1, issues: ["max"] },
          { slideIndex: 1, issues: ["string"] },
        ],
        styleIssues: ["style"],
        designSystem: state.designSystem,
      },
      params.context,
    );
    expect(result).toEqual({
      deckHtmlDsl: "legacy-final",
      slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
    });
    expect(state.deckHtmlDsl).toBe("legacy-final");
    expect(state.baseDeckHtmlDsl).toBe("legacy-final");
    expect(state.slidesMeta).toEqual(result.slidesMeta);
  });

  it.each([
    { label: "null", stateSource: null },
    { label: "undefined", stateSource: undefined },
    { label: "empty string", stateSource: "" },
    { label: "empty array", stateSource: [] },
    { label: "empty object", stateSource: {} },
  ])("handles $label state source values", async ({ stateSource }) => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const loop = makeLoop({ baseDeckHtmlDsl: "<section>Loop</section>" });
    const params = makeParams({ runContext: { runId: 0 } });

    const result = await runBatchRepairPhase(loop, stateSource, params);

    expect(result).toEqual({ deckHtmlDsl: "", slidesMeta: [] });
    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "", slidesMeta: [] },
      undefined,
      { signal: params.context.signal },
    );
    expect(loop._callTool).not.toHaveBeenCalled();
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledWith(
      params.emit,
      "design.repair.skipped",
      "progress",
      { reason: "healthy" },
    );
    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      params.traceContext,
      "design.phase.repair",
      { runId: 0, slideCount: 0 },
      expect.any(Function),
    );

    if (stateSource && typeof stateSource === "object") {
      expect(stateSource.deckHtmlDsl).toBe("");
      expect(stateSource.slidesMeta).toEqual([]);
      expect(stateSource.baseDeckHtmlDsl).toBe("");
    }
  });

  it("treats array-like slide data as empty arrays", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const state = {
      slideHtmls: { 0: "<section>Slot</section>", length: 1 },
      slidesMeta: { 0: { slideNo: 1, qa: { pass: false, issues: ["x"] } }, length: 1 },
      baseDeckHtmlDsl: "",
      designSystem: { theme: "base" },
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "array_like" } });

    const result = await runBatchRepairPhase(loop, params);

    expect(result).toEqual({ deckHtmlDsl: "", slidesMeta: [] });
    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "", slidesMeta: [] },
      state.designSystem,
      { signal: params.context.signal },
    );
    expect(loop._callTool).not.toHaveBeenCalled();
    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      params.traceContext,
      "design.phase.repair",
      { runId: "array_like", slideCount: 0 },
      expect.any(Function),
    );
  });

  it("handles large payloads and deep nested designSystem", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const largeFileLike = {
      name: "deck.html",
      content: longString,
      size: longString.length,
      chunks: largeArray,
    };
    const designSystem = {
      ...deepNestedObject,
      assets: largeArray,
      file: largeFileLike,
    };
    const slidesMeta = Array.from({ length: 3 }, (_, index) => ({
      slideNo: index + 1,
      qa: { pass: false, issues: [`issue-${index}`] },
    }));
    const state = {
      slideHtmls: ["<section>Large</section>"],
      slidesMeta,
      baseDeckHtmlDsl: longString,
      designSystem,
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "run_big" } });

    mockedAutoReviewer.runAutoReview.mockResolvedValue({
      pass: false,
      issues: ["style"],
      score: 0.1,
    });
    loop._callTool.mockResolvedValue({
      ok: true,
      data: {
        finalDeck: {
          deckHtmlDsl: `${longString}fixed`,
          slidesMeta,
        },
        qualityScore: 0.8,
        steps: ["fix"],
      },
    });

    const result = await runBatchRepairPhase(loop, params);

    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: longString, slidesMeta },
      designSystem,
      { signal: params.context.signal },
    );
    expect(loop._callTool).toHaveBeenCalledWith(
      "orchestrate_batch_repair",
      expect.objectContaining({
        deckPackage: { deckHtmlDsl: longString, slidesMeta },
        designSystem,
      }),
      params.context,
    );
    expect(result.deckHtmlDsl).toBe(`${longString}fixed`);
    expect(result.slidesMeta).toEqual(slidesMeta);
  });

  it("supports concurrent calls", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const loopA = makeLoop({
      slideHtmls: ["<section>A</section>"],
      slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
      designSystem: {},
    });
    const loopB = makeLoop({
      slideHtmls: ["<section>B</section>"],
      slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
      designSystem: {},
    });
    const paramsA = makeParams({ runContext: { runId: "runA" }, emit: vi.fn() });
    const paramsB = makeParams({ runContext: { runId: "runB" }, emit: vi.fn() });

    const [resultA, resultB] = await Promise.all([
      runBatchRepairPhase(loopA, paramsA),
      runBatchRepairPhase(loopB, paramsB),
    ]);

    expect(resultA.deckHtmlDsl).toBe(loopA.state.slideHtmls.join("\n\n"));
    expect(resultB.deckHtmlDsl).toBe(loopB.state.slideHtmls.join("\n\n"));
    expect(loopA.state.baseDeckHtmlDsl).toBe(resultA.deckHtmlDsl);
    expect(loopB.state.baseDeckHtmlDsl).toBe(resultB.deckHtmlDsl);
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledTimes(2);
    expect(mockedAutoReviewer.runAutoReview).toHaveBeenCalledTimes(2);
    expect(loopA._callTool).not.toHaveBeenCalled();
    expect(loopB._callTool).not.toHaveBeenCalled();
    const emitCalls = mockedDesignHelpers.emitStage.mock.calls.map((call) => call[0]);
    expect(emitCalls).toEqual(expect.arrayContaining([paramsA.emit, paramsB.emit]));
  });

  it("supports rapid consecutive calls", async () => {
    const { runBatchRepairPhase } = await loadRepairPhase();
    const state = {
      slideHtmls: ["<section>Fast</section>"],
      slidesMeta: [{ slideNo: 1, qa: { pass: true, issues: [] } }],
      baseDeckHtmlDsl: "<section>Fast</section>",
    };
    const loop = makeLoop(state);
    const params = makeParams({ runContext: { runId: "run_fast" } });

    let lastResult;
    for (let i = 0; i < 20; i += 1) {
      lastResult = await runBatchRepairPhase(loop, params);
    }

    expect(lastResult.deckHtmlDsl).toBe("<section>Fast</section>");
    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledTimes(20);
    expect(loop._transitionPhase).toHaveBeenCalledTimes(20);
    expect(mockedDesignHelpers.emitStage).toHaveBeenCalledTimes(20);
  });
});
