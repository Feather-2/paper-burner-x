import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  emitStage: vi.fn(),
  runWithPhaseSpan: vi.fn(),
  runAutoReview: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: mocks.emitStage,
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  runWithPhaseSpan: mocks.runWithPhaseSpan,
}));

vi.mock("../../../../../../../js/agents/stages/design/reviewer/auto-reviewer.js", () => ({
  runAutoReview: mocks.runAutoReview,
}));

import { runReviewPhase } from "../../../../../../../js/agents/stages/design/internal/phases/review-phase.js";

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }
  return root;
};

const longString = "x".repeat(200000);
const largeArray = Array.from({ length: 50000 }, (_, index) => ({ index }));
const deepNestedObject = buildDeepObject(64);
const largeFileLike = {
  name: "big.txt",
  size: longString.length,
  content: longString,
  chunks: largeArray,
};

const createReviewResult = (overrides = {}) => ({
  score: 0.88,
  pass: true,
  issues: [],
  fixes: [],
  summary: "ok",
  ...overrides,
});

const makeLoop = (overrides = {}) => ({
  state: {},
  _blackboard: { logDecision: vi.fn() },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runWithPhaseSpan.mockImplementation(async (_traceContext, _name, _attributes, fn) => fn());
  mocks.runAutoReview.mockImplementation(async () => createReviewResult());
});

describe("runReviewPhase", () => {
  it("runs auto-review and emits stage events with provided inputs", async () => {
    const reviewResult = createReviewResult({
      score: 0.72,
      pass: false,
      issues: [{ type: "color" }],
      summary: { status: "needs-work" },
      fixes: [{ id: "fix-1" }],
    });
    mocks.runAutoReview.mockResolvedValue(reviewResult);

    const loop = makeLoop({
      state: {
        deckHtmlDsl: "<state>",
        slidesMeta: [{ index: 99 }],
        designSystem: { theme: "state" },
      },
    });
    const emit = vi.fn();
    const context = { signal: { aborted: false } };
    const runContext = { runId: "run-1" };
    const traceContext = { traceId: "trace-1" };

    const result = await runReviewPhase(loop, {
      deckHtmlDsl: "<deck>",
      slidesMeta: [{ index: 0 }, { index: 1 }],
      designSystem: { tokens: { primary: "#000" } },
      context,
      runContext,
      emit,
      traceContext,
    });

    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      traceContext,
      "design.phase.review",
      { runId: "run-1", slideCount: 2 },
      expect.any(Function),
    );
    expect(mocks.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "<deck>", slidesMeta: [{ index: 0 }, { index: 1 }] },
      { tokens: { primary: "#000" } },
      { signal: context.signal },
    );
    expect(mocks.emitStage).toHaveBeenNthCalledWith(1, emit, "design.review.started", "started", {
      runId: "run-1",
      slideCount: 2,
    });
    expect(mocks.emitStage).toHaveBeenNthCalledWith(2, emit, "design.review.ended", "ended", {
      runId: "run-1",
      score: 0.72,
      pass: false,
      issueCount: 1,
      summary: reviewResult.summary,
    });
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith("review_complete", "Score: 0.72, Issues: 1");
    expect(loop.state.reviewResult).toBe(reviewResult);
    expect(result).toEqual({
      reviewResult,
      fixedDeckHtmlDsl: "<deck>",
      fixes: reviewResult.fixes,
    });
  });

  it.each([
    { label: "null", deckHtmlDsl: null },
    { label: "undefined", deckHtmlDsl: undefined },
  ])("falls back to state defaults when deckHtmlDsl is $label", async ({ deckHtmlDsl }) => {
    const loop = makeLoop({
      state: {
        deckHtmlDsl: "state-dsl",
        slidesMeta: [{ index: 3 }],
        designSystem: { theme: "state" },
      },
    });

    const result = await runReviewPhase(loop, {
      deckHtmlDsl,
      slidesMeta: { 0: "bad", length: 1 },
      designSystem: undefined,
      context: undefined,
      runContext: { runId: "run-state" },
      emit: undefined,
      traceContext: null,
    });

    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      null,
      "design.phase.review",
      { runId: "run-state", slideCount: 1 },
      expect.any(Function),
    );
    expect(mocks.runAutoReview).toHaveBeenCalledWith(
      { deckHtmlDsl: "state-dsl", slidesMeta: [{ index: 3 }] },
      { theme: "state" },
      { signal: undefined },
    );
    expect(mocks.emitStage).toHaveBeenNthCalledWith(1, undefined, "design.review.started", "started", {
      runId: "run-state",
      slideCount: 1,
    });
    expect(result.fixedDeckHtmlDsl).toBe("state-dsl");
  });

  it.each([
    { label: "empty string", deckHtmlDsl: "" },
    { label: "whitespace string", deckHtmlDsl: "   " },
  ])("respects provided $label and empty overrides", async ({ deckHtmlDsl }) => {
    const loop = makeLoop({
      state: {
        deckHtmlDsl: "state-dsl",
        slidesMeta: [{ index: 1 }],
        designSystem: { theme: "state" },
      },
    });
    const emit = vi.fn();
    const traceContext = {};
    const reviewResult = createReviewResult({
      score: 0,
      pass: true,
      issues: undefined,
      fixes: undefined,
      summary: undefined,
    });
    mocks.runAutoReview.mockResolvedValue(reviewResult);

    const result = await runReviewPhase(loop, {
      deckHtmlDsl,
      slidesMeta: [],
      designSystem: {},
      context: {},
      runContext: { runId: "run-empty" },
      emit,
      traceContext,
    });

    const [deckPackageArg, designSystemArg] = mocks.runAutoReview.mock.calls[0];
    expect(deckPackageArg.deckHtmlDsl).toBe(deckHtmlDsl);
    expect(deckPackageArg.slidesMeta).toEqual([]);
    expect(designSystemArg).toEqual({});
    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      traceContext,
      "design.phase.review",
      { runId: "run-empty", slideCount: 0 },
      expect.any(Function),
    );
    expect(mocks.emitStage).toHaveBeenNthCalledWith(2, emit, "design.review.ended", "ended", {
      runId: "run-empty",
      score: 0,
      pass: true,
      issueCount: 0,
      summary: undefined,
    });
    expect(result.fixedDeckHtmlDsl).toBe(deckHtmlDsl);
    expect(result.fixes).toEqual([]);
  });

  it.each([
    { label: "zero", runId: 0 },
    { label: "negative one", runId: -1 },
    { label: "max safe integer", runId: Number.MAX_SAFE_INTEGER },
    { label: "numeric string", runId: "42" },
  ])("propagates runId boundary values: $label", async ({ runId }) => {
    const loop = makeLoop();
    const emit = vi.fn();

    await runReviewPhase(loop, {
      deckHtmlDsl: "dsl",
      slidesMeta: [{ index: 0 }],
      designSystem: {},
      runContext: { runId },
      emit,
      traceContext: null,
    });

    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      null,
      "design.phase.review",
      { runId, slideCount: 1 },
      expect.any(Function),
    );
    expect(mocks.emitStage).toHaveBeenNthCalledWith(1, emit, "design.review.started", "started", {
      runId,
      slideCount: 1,
    });
    expect(mocks.emitStage).toHaveBeenNthCalledWith(
      2,
      emit,
      "design.review.ended",
      "ended",
      expect.objectContaining({ runId, score: 0.88, pass: true, issueCount: 0 }),
    );
  });

  it("propagates auto-review errors and skips end emission", async () => {
    const error = new Error("boom");
    mocks.runAutoReview.mockRejectedValue(error);

    const loop = makeLoop();
    const emit = vi.fn();

    await expect(
      runReviewPhase(loop, {
        deckHtmlDsl: "dsl",
        slidesMeta: [],
        designSystem: {},
        runContext: { runId: "err" },
        emit,
        traceContext: {},
      }),
    ).rejects.toThrow(error);

    expect(mocks.emitStage).toHaveBeenCalledTimes(1);
    expect(mocks.emitStage).toHaveBeenCalledWith(emit, "design.review.started", "started", {
      runId: "err",
      slideCount: 0,
    });
    expect(loop._blackboard.logDecision).not.toHaveBeenCalled();
    expect(loop.state.reviewResult).toBeUndefined();
  });

  it("propagates errors from runWithPhaseSpan before review run", async () => {
    const error = new Error("span-fail");
    mocks.runWithPhaseSpan.mockImplementation(async () => {
      throw error;
    });

    const loop = makeLoop();

    await expect(
      runReviewPhase(loop, {
        deckHtmlDsl: "dsl",
        slidesMeta: [],
        designSystem: {},
        runContext: { runId: "span" },
        emit: vi.fn(),
        traceContext: {},
      }),
    ).rejects.toThrow(error);

    expect(mocks.runAutoReview).not.toHaveBeenCalled();
    expect(mocks.emitStage).not.toHaveBeenCalled();
  });

  it("handles large resource inputs", async () => {
    const loop = makeLoop();
    const emit = vi.fn();
    const designSystem = { asset: largeFileLike, nested: deepNestedObject };

    const result = await runReviewPhase(loop, {
      deckHtmlDsl: longString,
      slidesMeta: largeArray,
      designSystem,
      runContext: { runId: "big" },
      emit,
      traceContext: {},
    });

    const [deckPackageArg, designSystemArg] = mocks.runAutoReview.mock.calls[0];
    expect(deckPackageArg.deckHtmlDsl).toBe(longString);
    expect(deckPackageArg.slidesMeta).toBe(largeArray);
    expect(designSystemArg).toBe(designSystem);
    expect(mocks.runWithPhaseSpan).toHaveBeenCalledWith(
      expect.any(Object),
      "design.phase.review",
      { runId: "big", slideCount: largeArray.length },
      expect.any(Function),
    );
    expect(result.fixedDeckHtmlDsl).toBe(longString);
  });

  it("supports concurrent calls", async () => {
    const loopA = makeLoop();
    const loopB = makeLoop();

    const reviewA = { score: 0.11, pass: true, issues: [], fixes: [] };
    const reviewB = { score: 0.22, pass: true, issues: [], fixes: [] };
    const outA = { reviewResult: reviewA, fixedDeckHtmlDsl: "a", fixes: [] };
    const outB = { reviewResult: reviewB, fixedDeckHtmlDsl: "bbbb", fixes: [] };

    mocks.runWithPhaseSpan.mockResolvedValueOnce(outA).mockResolvedValueOnce(outB);

    const [resultA, resultB] = await Promise.all([
      runReviewPhase(loopA, {
        deckHtmlDsl: "a",
        slidesMeta: [],
        designSystem: {},
        runContext: { runId: "a" },
        emit: vi.fn(),
        traceContext: null,
      }),
      runReviewPhase(loopB, {
        deckHtmlDsl: "bbbb",
        slidesMeta: [{ index: 0 }],
        designSystem: {},
        runContext: { runId: "b" },
        emit: vi.fn(),
        traceContext: null,
      }),
    ]);

    expect(resultA).toBe(outA);
    expect(resultB).toBe(outB);
    expect(loopA.state.reviewResult).toBe(reviewA);
    expect(loopB.state.reviewResult).toBe(reviewB);
    expect(mocks.runWithPhaseSpan).toHaveBeenCalledTimes(2);
    const attributes = mocks.runWithPhaseSpan.mock.calls.map((call) => call[2]);
    expect(attributes).toEqual(expect.arrayContaining([
      { runId: "a", slideCount: 0 },
      { runId: "b", slideCount: 1 },
    ]));
  });

  it("supports rapid consecutive calls", async () => {
    mocks.runAutoReview.mockImplementation(async (deckPackage) => ({
      score: deckPackage.deckHtmlDsl.length,
      pass: true,
      issues: [],
      fixes: [],
    }));

    const loop = makeLoop();
    const results = [];

    for (let i = 0; i < 5; i += 1) {
      const deckHtmlDsl = "x".repeat(i + 1);
      const out = await runReviewPhase(loop, {
        deckHtmlDsl,
        slidesMeta: [],
        designSystem: {},
        runContext: { runId: i },
        emit: vi.fn(),
        traceContext: null,
      });
      results.push(out.reviewResult.score);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(mocks.runAutoReview).toHaveBeenCalledTimes(5);
    expect(mocks.runAutoReview.mock.calls[4][0].deckHtmlDsl).toBe("x".repeat(5));
    expect(loop.state.reviewResult.score).toBe(5);
  });
});
