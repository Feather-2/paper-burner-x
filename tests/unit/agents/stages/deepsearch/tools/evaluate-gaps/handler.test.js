import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../js/agents/sdk/DiscoveryManager.js", () => {
  return {
    DiscoveryStatus: {
      SATISFIED: "satisfied",
      PARTIAL: "partial",
      CONTRADICTED: "contradicted",
      BLOCKED: "blocked",
    },
  };
});

vi.mock("../../../../../../../js/agents/stages/deepsearch/states.js", () => {
  return {
    GapStatus: {
      FILLED: "filled",
      BLOCKED: "blocked",
      OPEN: "open",
    },
  };
});

import { definition, handler } from "../../../../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js";
import evaluateGaps from "../../../../../../../js/agents/stages/deepsearch/tools/evaluate-gaps/handler.js";
import { DiscoveryStatus } from "../../../../../../../js/agents/sdk/DiscoveryManager.js";
import { GapStatus } from "../../../../../../../js/agents/stages/deepsearch/states.js";

const buildGap = (gapId = "gap-1") => ({
  gapId,
  status: GapStatus.OPEN,
});

const buildState = (overrides = {}) => ({
  L1: { gaps: [buildGap()] },
  todos: [],
  ...overrides,
});

const buildContext = (overrides = {}) => {
  const state = overrides.state ?? buildState();
  const emit = overrides.emit ?? vi.fn();
  const discoveryManager = Object.prototype.hasOwnProperty.call(overrides, "discoveryManager")
    ? overrides.discoveryManager
    : {
        getEvidences: vi.fn(() => []),
        upsertDiscovery: vi.fn(),
      };

  return { state, emit, discoveryManager };
};

const buildDeepHint = (depth = 20) => {
  let node = { depth };
  for (let i = depth - 1; i >= 0; i -= 1) {
    node = { depth: i, child: node };
  }
  return node;
};

describe("definition", () => {
  it("exposes stable metadata", () => {
    expect(definition).toMatchObject({
      name: "evaluate-gaps",
      layer: 0,
      activation: {
        phases: ["executing"],
      },
    });
    expect(definition.activation.keywords).toEqual(expect.arrayContaining(["check", "status"]));
    expect(definition.description).toContain("Gap");
  });
});

describe("handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when args is empty object", async () => {
    const context = buildContext();

    const result = await handler({}, context);

    expect(result).toEqual({ success: false, error: "gapId is required" });
  });

  it.each([
    { label: "null", gapId: null },
    { label: "undefined", gapId: undefined },
    { label: "empty string", gapId: "" },
    { label: "zero", gapId: 0 },
  ])("returns error when gapId is $label", async ({ gapId }) => {
    const context = buildContext();

    const result = await handler({ gapId, status: DiscoveryStatus.PARTIAL }, context);

    expect(result).toEqual({ success: false, error: "gapId is required" });
  });

  it.each([
    { label: "undefined", status: undefined },
    { label: "null", status: null },
    { label: "empty string", status: "" },
    { label: "whitespace", status: "   " },
    { label: "numeric string", status: "0" },
    { label: "number", status: 1 },
    { label: "object", status: {} },
    { label: "empty array", status: [] },
  ])("returns error for invalid status ($label)", async ({ status }) => {
    const context = buildContext();

    const result = await handler({ gapId: "gap-1", status }, context);

    expect(result).toEqual({ success: false, error: "Invalid status" });
  });

  it("returns error when no gaps exist (empty array)", async () => {
    const context = buildContext({ state: buildState({ L1: { gaps: [] } }) });

    const result = await handler({ gapId: "gap-1", status: DiscoveryStatus.PARTIAL }, context);

    expect(result).toEqual({ success: false, error: "Gap not found" });
  });

  it("returns error when state is empty object", async () => {
    const context = buildContext({ state: {} });

    const result = await handler({ gapId: "gap-1", status: DiscoveryStatus.PARTIAL }, context);

    expect(result).toEqual({ success: false, error: "Gap not found" });
  });

  it.each([
    { label: "negative", gapId: -1 },
    { label: "max safe integer", gapId: Number.MAX_SAFE_INTEGER },
    { label: "whitespace", gapId: "   " },
  ])("returns error when gapId is not found ($label)", async ({ gapId }) => {
    const context = buildContext();

    const result = await handler({ gapId, status: DiscoveryStatus.PARTIAL }, context);

    expect(result).toEqual({ success: false, error: "Gap not found" });
  });

  it("throws when gaps is an object instead of an array", async () => {
    const context = buildContext({ state: buildState({ L1: { gaps: {} } }) });

    await expect(handler({ gapId: "gap-1", status: DiscoveryStatus.PARTIAL }, context)).rejects.toThrow(
      /find is not a function/
    );
  });

  it("evaluates gap, records evidences, emits event, and returns summary", async () => {
    const evidences = [{ id: "e1" }, { id: "e2" }];
    const discoveryManager = {
      getEvidences: vi.fn(() => evidences),
      upsertDiscovery: vi.fn(),
    };
    const context = buildContext({ discoveryManager });

    const result = await handler(
      {
        gapId: "gap-1",
        status: DiscoveryStatus.PARTIAL,
        analysis: "analysis text",
        hint: "next step",
      },
      context
    );

    const gap = context.state.L1.gaps[0];

    expect(result).toMatchObject({
      success: true,
      gapId: "gap-1",
      discoveryStatus: DiscoveryStatus.PARTIAL,
      newStatus: GapStatus.OPEN,
      evidenceCount: 2,
    });
    expect(result.message).toContain("gap-1");
    expect(gap.status).toBe(GapStatus.OPEN);
    expect(gap.evaluation).toEqual(
      expect.objectContaining({
        discoveryStatus: DiscoveryStatus.PARTIAL,
        gapStatus: GapStatus.OPEN,
        analysis: "analysis text",
        evidenceIds: ["e1", "e2"],
      })
    );
    expect(new Date(gap.evaluation.updatedAt).toISOString()).toBe(gap.evaluation.updatedAt);
    expect(discoveryManager.getEvidences).toHaveBeenCalledWith("gap-1");
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith("gap-1", {
      status: DiscoveryStatus.PARTIAL,
      analysis: "analysis text".slice(0, 100),
      hint: "next step",
    });
    expect(context.emit).toHaveBeenCalledWith("deepsearch.gap.evaluated", {
      gapId: "gap-1",
      status: DiscoveryStatus.PARTIAL,
      gapStatus: GapStatus.OPEN,
      analysis: "analysis text",
    });
  });

  it("updates todo via updateTodo when satisfied", async () => {
    const updateTodo = vi.fn();
    const state = buildState({
      todos: [{ todoId: "todo-1", relatedGapId: "gap-1" }],
      updateTodo,
    });
    const context = buildContext({ state });

    const result = await handler(
      { gapId: "gap-1", status: DiscoveryStatus.SATISFIED, analysis: "done" },
      context
    );

    expect(result.success).toBe(true);
    expect(state.updateTodo).toHaveBeenCalledWith("todo-1", { status: "completed" });
    expect(state.L1.gaps[0].status).toBe(GapStatus.FILLED);
  });

  it("updates todo status directly when updateTodo is missing", async () => {
    const todos = [{ id: "todo-2", relatedGapId: "gap-1", status: "open" }];
    const state = buildState({ todos });
    const context = buildContext({ state });

    const result = await handler(
      { gapId: "gap-1", status: DiscoveryStatus.SATISFIED, analysis: "done" },
      context
    );

    expect(result.success).toBe(true);
    expect(todos[0].status).toBe("completed");
  });

  it("skips discovery manager interactions when missing", async () => {
    const context = buildContext({ discoveryManager: null });

    const result = await handler(
      { gapId: "gap-1", status: DiscoveryStatus.PARTIAL, analysis: "note" },
      context
    );

    expect(result).toMatchObject({
      success: true,
      evidenceCount: 0,
      newStatus: GapStatus.OPEN,
    });
    expect(context.emit).toHaveBeenCalled();
  });

  it("handles concurrent evaluations on shared state", async () => {
    const state = buildState({ L1: { gaps: [buildGap("gap-1"), buildGap("gap-2")] } });
    const discoveryManager = {
      getEvidences: vi.fn((gapId) => (gapId === "gap-1" ? [{ id: "e1" }] : [{ id: "e2" }, { id: "e3" }])),
      upsertDiscovery: vi.fn(),
    };
    const context = buildContext({ state, discoveryManager });

    const [first, second] = await Promise.all([
      handler({ gapId: "gap-1", status: DiscoveryStatus.SATISFIED, analysis: "a" }, context),
      handler({ gapId: "gap-2", status: DiscoveryStatus.BLOCKED, analysis: "b" }, context),
    ]);

    expect(first).toMatchObject({ success: true, evidenceCount: 1, newStatus: GapStatus.FILLED });
    expect(second).toMatchObject({ success: true, evidenceCount: 2, newStatus: GapStatus.BLOCKED });
    expect(state.L1.gaps.find((gap) => gap.gapId === "gap-1").status).toBe(GapStatus.FILLED);
    expect(state.L1.gaps.find((gap) => gap.gapId === "gap-2").status).toBe(GapStatus.BLOCKED);
  });

  it("handles rapid consecutive evaluations on the same gap", async () => {
    const discoveryManager = {
      getEvidences: vi.fn(() => []),
      upsertDiscovery: vi.fn(),
    };
    const context = buildContext({ discoveryManager });

    await handler({ gapId: "gap-1", status: DiscoveryStatus.PARTIAL, analysis: "first" }, context);
    await handler({ gapId: "gap-1", status: DiscoveryStatus.SATISFIED, analysis: "second" }, context);

    const gap = context.state.L1.gaps[0];
    expect(gap.status).toBe(GapStatus.FILLED);
    expect(gap.evaluation.discoveryStatus).toBe(DiscoveryStatus.SATISFIED);
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledTimes(2);
  });

  it("handles large analysis and deep hint payloads", async () => {
    const hugeAnalysis = "x".repeat(1024 * 1024);
    const deepHint = buildDeepHint(30);
    const discoveryManager = {
      getEvidences: vi.fn(() => []),
      upsertDiscovery: vi.fn(),
    };
    const context = buildContext({ discoveryManager });

    const result = await handler(
      {
        gapId: "gap-1",
        status: DiscoveryStatus.BLOCKED,
        analysis: hugeAnalysis,
        hint: deepHint,
      },
      context
    );

    expect(result.success).toBe(true);
    expect(discoveryManager.upsertDiscovery).toHaveBeenCalledWith(
      "gap-1",
      expect.objectContaining({
        status: DiscoveryStatus.BLOCKED,
        analysis: hugeAnalysis.slice(0, 100),
        hint: deepHint,
      })
    );
  });
});

describe("default", () => {
  it("exposes definition and handler", () => {
    expect(evaluateGaps.definition).toBe(definition);
    expect(evaluateGaps.handler).toBe(handler);
  });
});
