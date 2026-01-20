import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../../../js/agents/runtime/index.js", () => ({
  checkCancelled: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/states.js", () => ({
  DesignPhase: {
    OUTLINE_PARSING: "outline_parsing",
    OUTLINE_CONFIRMING: "outline_confirming",
    STYLE_EXTRACTING: "style_extracting",
    STYLE_CONFIRMING: "style_confirming",
  },
}));

vi.mock("../../../../../../../js/agents/stages/design/design-helpers.js", () => ({
  emitStage: vi.fn(),
}));

vi.mock("../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js", () => ({
  runWithPhaseSpan: vi.fn(async (_traceContext, _name, _meta, runPhase) => runPhase()),
}));

import { checkCancelled } from "../../../../../../../js/agents/runtime/index.js";
import { DesignPhase } from "../../../../../../../js/agents/stages/design/states.js";
import { emitStage } from "../../../../../../../js/agents/stages/design/design-helpers.js";
import { runWithPhaseSpan } from "../../../../../../../js/agents/stages/design/internal/phases/phase-utils.js";
import { runPreparationPhase } from "../../../../../../../js/agents/stages/design/internal/phases/preparation-phase.js";

function createLoop(overrides = {}) {
  const loop = {
    phase: "idle",
    state: {},
    _transitionPhase: vi.fn(),
    _callTool: vi.fn(),
    waitForUserAction: vi.fn(),
    _blackboard: {
      logDecision: vi.fn(),
      setSummary: vi.fn(),
    },
    ...overrides,
  };
  loop._transitionPhase.mockImplementation((_from, to) => {
    loop.phase = to;
  });
  return loop;
}

function createExecution(styleSignal = {}) {
  const styleContext = { signal: styleSignal };
  const startExecution = vi.fn(async () => ({
    loopIteration: { id: "style-iter" },
    stepInfo: { context: styleContext },
  }));
  const finishExecution = vi.fn(async () => {});
  return { startExecution, finishExecution, styleContext };
}

describe("runPreparationPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runWithPhaseSpan.mockImplementation(async (_traceContext, _name, _meta, runPhase) => runPhase());
  });

  it("runs outline + style extraction and updates state (normal path)", async () => {
    const contentPackage = { slideIntents: [{ id: 1 }, { id: 2 }] };
    const parsedContentPackage = { slideIntents: [{ id: "a" }, { id: "b" }] };
    const designSystem = {
      theme: "light",
      colorScheme: "neutral",
      fontFamily: "Arial",
      accentColor: "#ffffff",
    };
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    const { startExecution, finishExecution, styleContext } = createExecution();
    const emit = vi.fn();
    const context = { signal: { cancelled: false }, interactionMode: { outlineConfirm: "skip", styleConfirm: "skip" }, eventBus: {} };
    const runContext = { runId: 0, constraints: { minFontSize: 12 } };

    const result = await runPreparationPhase(loop, {
      contentPackage,
      context,
      runContext,
      emit,
      startExecution,
      finishExecution,
      traceContext: { traceId: "t1" },
    });

    expect(result.parsedContentPackage).toBe(parsedContentPackage);
    expect(result.slideIntents).toEqual(parsedContentPackage.slideIntents);
    expect(result.designSystem).toBe(designSystem);
    expect(result.constraints).toEqual({ minFontSize: 12 });

    expect(loop.state.contentPackage).toBe(parsedContentPackage);
    expect(loop.state.slideIntents).toEqual(parsedContentPackage.slideIntents);
    expect(loop.state.designSystem).toBe(designSystem);
    expect(loop.state.constraints).toEqual({ minFontSize: 12 });

    expect(loop._transitionPhase.mock.calls.map((call) => call[1])).toEqual([
      DesignPhase.OUTLINE_PARSING,
      DesignPhase.OUTLINE_CONFIRMING,
      DesignPhase.STYLE_EXTRACTING,
      DesignPhase.STYLE_CONFIRMING,
    ]);

    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      { traceId: "t1" },
      "design.phase.preparation",
      { runId: 0, slideCount: 2 },
      expect.any(Function)
    );

    expect(emitStage).toHaveBeenCalledWith(emit, "design.tokens.ended", "ended", { theme: "light" });
    expect(emitStage).toHaveBeenCalledWith(
      emit,
      "design.style.preview",
      "awaiting_confirm",
      expect.objectContaining({
        runId: 0,
        slideCount: 2,
        designTokens: {
          theme: "light",
          colorScheme: "neutral",
          fontFamily: "Arial",
          accentColor: "#ffffff",
        },
      })
    );

    expect(loop._blackboard.setSummary).toHaveBeenCalledWith("outline", "2 slides parsed");
    expect(loop._blackboard.setSummary).toHaveBeenCalledWith("style", "light");
    expect(loop._blackboard.logDecision).toHaveBeenCalledWith("preparation_complete", "Parsed 2 slides");

    expect(checkCancelled).toHaveBeenCalledWith(context.signal);
    expect(checkCancelled).toHaveBeenCalledWith(styleContext.signal);
  });

  it("uses outline confirmation slide intents and updates preview counts", async () => {
    const parsedContentPackage = { slideIntents: [{ id: "one" }] };
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    loop.waitForUserAction.mockResolvedValue({ slideIntents: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "manual", styleConfirm: "skip" },
      eventBus: { name: "bus" },
    };
    const runContext = { runId: 5 };

    const result = await runPreparationPhase(loop, {
      contentPackage: { slideIntents: [] },
      context,
      runContext,
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop.waitForUserAction).toHaveBeenCalledWith("confirm_outline", { eventBus: context.eventBus, signal: context.signal });
    expect(result.slideIntents).toHaveLength(3);
    expect(emitStage).toHaveBeenCalledWith(
      emit,
      "design.style.preview",
      "awaiting_confirm",
      expect.objectContaining({ slideCount: 3 })
    );
  });

  it("applies normalized style overrides and logs decision", async () => {
    const designSystem = {
      theme: "light",
      colorScheme: "blue",
      fontFamily: "Arial",
      accentColor: "#000000",
    };
    const longFontFamily = "Font ".repeat(30).trim();
    const longColorScheme = `scheme ${"x".repeat(80)}`;
    const expectedFontFamily = longFontFamily.slice(0, 100);
    const expectedColorScheme = longColorScheme.trim().slice(0, 40);
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.waitForUserAction.mockResolvedValue({
      theme: " Dark ",
      colorScheme: longColorScheme,
      fontFamily: longFontFamily,
      accentColor: " rgba(0, 128, 255, 0.5) ",
    });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "skip", styleConfirm: "manual" },
      eventBus: {},
    };

    const result = await runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: "0" },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(result.designSystem).toEqual({
      theme: "dark",
      colorScheme: expectedColorScheme,
      fontFamily: expectedFontFamily,
      accentColor: "rgba(0, 128, 255, 0.5)",
    });

    const overrideCalls = loop._blackboard.logDecision.mock.calls.filter((call) => call[0] === "style_override");
    expect(overrideCalls).toHaveLength(1);
    expect(overrideCalls[0][1]).toBe("User modified design tokens");
    expect(overrideCalls[0][2]).toEqual({
      overrides: {
        theme: "dark",
        colorScheme: expectedColorScheme,
        fontFamily: expectedFontFamily,
        accentColor: "rgba(0, 128, 255, 0.5)",
      },
    });
  });

  it("ignores invalid or empty style overrides and skips style_override log", async () => {
    const designSystem = {
      theme: "light",
      colorScheme: "blue",
      fontFamily: "Arial",
      accentColor: "#000000",
    };
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.waitForUserAction.mockResolvedValue({
      theme: 123,
      colorScheme: "!!!",
      fontFamily: "   ",
      accentColor: "not-a-color",
    });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "skip", styleConfirm: "manual" },
      eventBus: {},
    };

    const result = await runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: 1 },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(result.designSystem).toEqual(designSystem);
    expect(loop._blackboard.logDecision.mock.calls.some((call) => call[0] === "style_override")).toBe(false);
  });

  it("throws when parse_outline fails", async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: false, error: "parse fail" });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: -1 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("parse fail");

    expect(loop._callTool).toHaveBeenCalledTimes(1);
  });

  it("throws when extract_style fails", async () => {
    const loop = createLoop();
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: false, error: "style fail" };
      }
      throw new Error("unexpected tool");
    });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: 2 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("style fail");

    expect(finishExecution).not.toHaveBeenCalled();
  });

  it("throws when slideIntents is empty array", async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: true, data: { contentPackage: { slideIntents: [] }, slideIntents: [] } });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      runPreparationPhase(loop, {
        contentPackage: { slideIntents: [] },
        context,
        runContext: { runId: 3 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("contentPackage.slideIntents is required");
  });

  it("throws when slideIntents is not an array (type boundary)", async () => {
    const loop = createLoop();
    loop._callTool.mockResolvedValue({ ok: true, data: { contentPackage: { slideIntents: {} }, slideIntents: {} } });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      runPreparationPhase(loop, {
        contentPackage: { slideIntents: {} },
        context,
        runContext: { runId: 4 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("contentPackage.slideIntents is required");
  });

  it("resolves userConfig precedence and applies user inputs", async () => {
    const loop = createLoop({
      state: { contentPackage: { slideIntents: [{ id: 1 }], userConfig: null } },
      applyUserInputsToConfig: vi.fn((config) => ({ ...config, applied: true })),
    });
    loop._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: loop.state.contentPackage, slideIntents: loop.state.contentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {}, userConfig: { fromContext: true } };

    await runPreparationPhase(loop, {
      contentPackage: undefined,
      context,
      runContext: { runId: 5, userConfig: null },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop.applyUserInputsToConfig).toHaveBeenCalledWith({ fromContext: true });
    expect(startExecution).toHaveBeenCalledWith(
      "style_extracting",
      expect.objectContaining({ userConfig: { fromContext: true, applied: true } })
    );
    expect(loop._callTool).toHaveBeenCalledWith(
      "parse_outline",
      { contentPackage: loop.state.contentPackage },
      context
    );
  });

  it("supports concurrent runs with isolated loops (large + nested inputs)", async () => {
    const largeSlideIntents = Array.from({ length: 10000 }, (_v, i) => ({ id: i }));
    const deepPackage = { slideIntents: [{ id: "x" }], meta: { nested: { level: { value: "deep" } } } };

    const loopA = createLoop();
    loopA._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: largeSlideIntents }, slideIntents: largeSlideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    const loopB = createLoop();
    loopB._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: deepPackage, slideIntents: deepPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "dark" } } };
      }
      throw new Error("unexpected tool");
    });

    const execA = createExecution();
    const execB = createExecution();

    const [resA, resB] = await Promise.all([
      runPreparationPhase(loopA, {
        contentPackage: { slideIntents: largeSlideIntents },
        context: { signal: {}, interactionMode: {}, eventBus: {} },
        runContext: { runId: -1 },
        emit: vi.fn(),
        startExecution: execA.startExecution,
        finishExecution: execA.finishExecution,
        traceContext: null,
      }),
      runPreparationPhase(loopB, {
        contentPackage: deepPackage,
        context: { signal: {}, interactionMode: {}, eventBus: {} },
        runContext: { runId: Number.MAX_SAFE_INTEGER },
        emit: vi.fn(),
        startExecution: execB.startExecution,
        finishExecution: execB.finishExecution,
        traceContext: null,
      }),
    ]);

    expect(resA.slideIntents).toHaveLength(10000);
    expect(resB.parsedContentPackage).toBe(deepPackage);
    expect(loopA.state.slideIntents).toHaveLength(10000);
    expect(loopB.state.contentPackage).toBe(deepPackage);
    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      null,
      "design.phase.preparation",
      { runId: -1, slideCount: 10000 },
      expect.any(Function)
    );
    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      null,
      "design.phase.preparation",
      { runId: Number.MAX_SAFE_INTEGER, slideCount: 1 },
      expect.any(Function)
    );
  });

  it("handles rapid sequential calls on the same loop", async () => {
    const loop = createLoop();
    const toolQueue = [
      { tool: "parse_outline", result: { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } } },
      { tool: "extract_style", result: { ok: true, data: { designSystem: { theme: "light" } } } },
      { tool: "parse_outline", result: { ok: true, data: { contentPackage: { slideIntents: [{ id: 2 }, { id: 3 }] }, slideIntents: [{ id: 2 }, { id: 3 }] } } },
      { tool: "extract_style", result: { ok: true, data: { designSystem: { theme: "dark" } } } },
    ];
    loop._callTool.mockImplementation(async (tool) => {
      const next = toolQueue.shift();
      if (!next || next.tool !== tool) {
        throw new Error("unexpected tool order");
      }
      return next.result;
    });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    const first = await runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: 6 },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });
    const second = await runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 2 }, { id: 3 }] },
      context,
      runContext: { runId: 7 },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(first.slideIntents).toHaveLength(1);
    expect(second.slideIntents).toHaveLength(2);
    expect(loop.state.slideIntents).toHaveLength(2);
    expect(loop._blackboard.logDecision.mock.calls.filter((call) => call[0] === "preparation_complete")).toHaveLength(2);
  });
});
