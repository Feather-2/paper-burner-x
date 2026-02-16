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
import * as preparationPhase from "../../../../../../../js/agents/stages/design/internal/phases/preparation-phase.js";

function createLoop(overrides = {}) {
  const loop = {
    phase: "idle",
    state: {},
    phaseRunner: { _transitionPhase: vi.fn() },
    toolDispatch: { _callTool: vi.fn() },
    userActionHandler: { waitForUserAction: vi.fn() },
    messageHandling: {},
    _blackboard: {
      logDecision: vi.fn(),
      setSummary: vi.fn(),
    },
    ...overrides,
  };
  loop.phaseRunner._transitionPhase.mockImplementation((_from, to) => {
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

  async function runHappyPath({
    contentPackage = { slideIntents: [{ id: 1 }, { id: 2 }] },
    parsedContentPackage = { slideIntents: [{ id: "a" }, { id: "b" }] },
    designSystem = {
      theme: "light",
      colorScheme: "neutral",
      fontFamily: "Arial",
      accentColor: "#ffffff",
    },
    context = {
      signal: { cancelled: false },
      interactionMode: { outlineConfirm: "skip", styleConfirm: "skip" },
      eventBus: {},
    },
    runContext = { runId: 0, constraints: { minFontSize: 12 } },
    traceContext = { traceId: "t1" },
    styleSignal = {},
  } = {}) {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });

    const { startExecution, finishExecution, styleContext } = createExecution(styleSignal);
    const emit = vi.fn();

    const result = await preparationPhase.runPreparationPhase(loop, {
      contentPackage,
      context,
      runContext,
      emit,
      startExecution,
      finishExecution,
      traceContext,
    });

    return { result, loop, emit, context, runContext, traceContext, startExecution, finishExecution, styleContext, parsedContentPackage, designSystem };
  }

  it("should_return_result_when_outline_and_style_extraction_succeed", async () => {
    const { result, parsedContentPackage, designSystem } = await runHappyPath();

    expect(result).toMatchObject({
      parsedContentPackage,
      slideIntents: parsedContentPackage.slideIntents,
      designSystem,
      constraints: { minFontSize: 12 },
    });
  });

  it("should_return_empty_userConfig_when_no_userConfig_provided", async () => {
    const { result } = await runHappyPath();

    expect(result.userConfig).toEqual({});
  });

  it("should_update_loop_state_when_phase_completes", async () => {
    const { loop, parsedContentPackage, designSystem } = await runHappyPath();

    expect(loop.state).toEqual({
      contentPackage: parsedContentPackage,
      slideIntents: parsedContentPackage.slideIntents,
      designSystem,
      constraints: { minFontSize: 12 },
      userConfig: {},
    });
  });

  it("should_transition_phases_in_expected_order_when_phase_runs", async () => {
    const { loop } = await runHappyPath();

    expect(loop.phaseRunner._transitionPhase.mock.calls.map((call) => call[1])).toEqual([
      DesignPhase.OUTLINE_PARSING,
      DesignPhase.OUTLINE_CONFIRMING,
      DesignPhase.STYLE_EXTRACTING,
      DesignPhase.STYLE_CONFIRMING,
    ]);
  });

  it("should_call_runWithPhaseSpan_with_trace_meta_when_phase_runs", async () => {
    await runHappyPath();

    expect(runWithPhaseSpan).toHaveBeenCalledWith(
      { traceId: "t1" },
      "design.phase.preparation",
      { runId: 0, slideCount: 2 },
      expect.any(Function)
    );
  });

  it("should_emit_design_tokens_ended_when_style_extraction_completes", async () => {
    const { emit } = await runHappyPath();

    expect(emitStage).toHaveBeenCalledWith(emit, "design.tokens.ended", "ended", { theme: "light" });
  });

  it("should_emit_design_style_preview_when_entering_style_confirming", async () => {
    const { emit } = await runHappyPath();

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
  });

  it("should_write_blackboard_summaries_when_phase_completes", async () => {
    const { loop } = await runHappyPath();

    expect(loop._blackboard.setSummary.mock.calls).toEqual([
      ["outline", "2 slides parsed"],
      ["style", "light"],
    ]);
  });

  it("should_log_preparation_complete_decision_when_phase_completes", async () => {
    const { loop } = await runHappyPath();

    expect(loop._blackboard.logDecision.mock.calls).toEqual([["preparation_complete", "Parsed 2 slides"]]);
  });

  it("should_check_cancellation_on_context_and_style_signals_when_phase_runs", async () => {
    const { context, styleContext } = await runHappyPath();

    expect(checkCancelled.mock.calls).toEqual([
      [context.signal],
      [context.signal],
      [styleContext.signal],
    ]);
  });

  it("should_wait_for_user_outline_confirmation_when_outlineConfirm_not_skip", async () => {
    const parsedContentPackage = { slideIntents: [{ id: "one" }] };
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({ slideIntents: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "manual", styleConfirm: "skip" },
      eventBus: { name: "bus" },
    };
    const runContext = { runId: 5 };

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [] },
      context,
      runContext,
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop.userActionHandler.waitForUserAction).toHaveBeenCalledWith("confirm_outline", { eventBus: context.eventBus, signal: context.signal });
  });

  it("should_use_outline_confirmed_slideIntents_when_user_provides_slideIntents", async () => {
    const parsedContentPackage = { slideIntents: [{ id: "one" }] };
    const confirmedSlideIntents = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({ slideIntents: confirmedSlideIntents });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "manual", styleConfirm: "skip" },
      eventBus: { name: "bus" },
    };

    const result = await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [] },
      context,
      runContext: { runId: 5 },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(result.slideIntents).toEqual(confirmedSlideIntents);
  });

  it("should_emit_style_preview_with_slideCount_from_outline_confirmation", async () => {
    const parsedContentPackage = { slideIntents: [{ id: "one" }] };
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: parsedContentPackage, slideIntents: parsedContentPackage.slideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({ slideIntents: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const { startExecution, finishExecution } = createExecution();
    const emit = vi.fn();
    const context = {
      signal: {},
      interactionMode: { outlineConfirm: "manual", styleConfirm: "skip" },
      eventBus: { name: "bus" },
    };

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [] },
      context,
      runContext: { runId: 5 },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(emitStage).toHaveBeenCalledWith(
      emit,
      "design.style.preview",
      "awaiting_confirm",
      expect.objectContaining({ slideCount: 3 })
    );
  });

  it("should_apply_normalized_style_overrides_when_styleConfirm_returns_valid_values", async () => {
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
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
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

    const result = await preparationPhase.runPreparationPhase(loop, {
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
  });

  it("should_log_style_override_decision_when_user_modifies_any_design_token", async () => {
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
    const expectedOverrides = {
      theme: "dark",
      colorScheme: expectedColorScheme,
      fontFamily: expectedFontFamily,
      accentColor: "rgba(0, 128, 255, 0.5)",
    };
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
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

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: "0" },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop._blackboard.logDecision).toHaveBeenCalledWith(
      "style_override",
      "User modified design tokens",
      { overrides: expectedOverrides }
    );
  });

  it("should_ignore_invalid_style_overrides_when_styleConfirm_returns_invalid_values", async () => {
    const designSystem = {
      theme: "light",
      colorScheme: "blue",
      fontFamily: "Arial",
      accentColor: "#000000",
    };
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
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

    const result = await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: 1 },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(result.designSystem).toEqual(designSystem);
  });

  it("should_not_log_style_override_when_styleConfirm_overrides_are_invalid", async () => {
    const designSystem = {
      theme: "light",
      colorScheme: "blue",
      fontFamily: "Arial",
      accentColor: "#000000",
    };
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem } };
      }
      throw new Error("unexpected tool");
    });
    loop.userActionHandler.waitForUserAction.mockResolvedValue({
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

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: 1 },
      emit,
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop._blackboard.logDecision.mock.calls.some((call) => call[0] === "style_override")).toBe(false);
  });

  it("should_throw_when_parse_outline_returns_not_ok", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: false, error: "parse fail" });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      preparationPhase.runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: -1 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("parse fail");
  });

  it("should_not_start_execution_when_parse_outline_returns_not_ok", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: false, error: "parse fail" });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    try {
      await preparationPhase.runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: -1 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      });
    } catch {
      // ignore
    }

    expect(startExecution).not.toHaveBeenCalled();
  });

  it("should_throw_when_extract_style_returns_not_ok", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
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
      preparationPhase.runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: 2 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      })
    ).rejects.toThrow("style fail");
  });

  it("should_not_finish_execution_when_extract_style_returns_not_ok", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
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

    try {
      await preparationPhase.runPreparationPhase(loop, {
        contentPackage: { slideIntents: [{ id: 1 }] },
        context,
        runContext: { runId: 2 },
        emit: vi.fn(),
        startExecution,
        finishExecution,
        traceContext: null,
      });
    } catch {
      // ignore
    }

    expect(finishExecution).not.toHaveBeenCalled();
  });

  it("should_throw_when_slideIntents_is_empty_array", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { contentPackage: { slideIntents: [] }, slideIntents: [] } });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      preparationPhase.runPreparationPhase(loop, {
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

  it("should_throw_when_slideIntents_is_not_an_array", async () => {
    const loop = createLoop();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { contentPackage: { slideIntents: {} }, slideIntents: {} } });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await expect(
      preparationPhase.runPreparationPhase(loop, {
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

  async function runUserConfigScenario() {
    const loop = createLoop({
      state: { contentPackage: { slideIntents: [{ id: 1 }], userConfig: null } },
      messageHandling: {
        applyUserInputsToConfig: vi.fn((config) => ({ ...config, applied: true })),
      },
    });
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return {
          ok: true,
          data: { contentPackage: loop.state.contentPackage, slideIntents: loop.state.contentPackage.slideIntents },
        };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {}, userConfig: { fromContext: true } };

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: undefined,
      context,
      runContext: { runId: 5, userConfig: null },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });

    return { loop, startExecution, context };
  }

  it("should_fall_back_to_loop_state_contentPackage_when_contentPackage_is_undefined", async () => {
    const { loop, context } = await runUserConfigScenario();

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith("parse_outline", { contentPackage: loop.state.contentPackage }, context);
  });

  it("should_apply_user_inputs_to_userConfig_when_applyUserInputsToConfig_is_provided", async () => {
    const { loop } = await runUserConfigScenario();

    expect(loop.messageHandling.applyUserInputsToConfig).toHaveBeenCalledWith({ fromContext: true });
  });

  it("should_pass_transformed_userConfig_to_startExecution_when_applyUserInputsToConfig_transforms_userConfig", async () => {
    const { startExecution } = await runUserConfigScenario();

    expect(startExecution).toHaveBeenCalledWith(
      "style_extracting",
      expect.objectContaining({ userConfig: { fromContext: true, applied: true } })
    );
  });

  it("should_isolate_results_when_run_concurrently_on_different_loops", async () => {
    const largeSlideIntents = Array.from({ length: 10000 }, (_v, i) => ({ id: i }));
    const deepPackage = { slideIntents: [{ id: "x" }], meta: { nested: { level: { value: "deep" } } } };

    const loopA = createLoop();
    loopA.toolDispatch._callTool.mockImplementation(async (tool) => {
      if (tool === "parse_outline") {
        return { ok: true, data: { contentPackage: { slideIntents: largeSlideIntents }, slideIntents: largeSlideIntents } };
      }
      if (tool === "extract_style") {
        return { ok: true, data: { designSystem: { theme: "light" } } };
      }
      throw new Error("unexpected tool");
    });
    const loopB = createLoop();
    loopB.toolDispatch._callTool.mockImplementation(async (tool) => {
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
      preparationPhase.runPreparationPhase(loopA, {
        contentPackage: { slideIntents: largeSlideIntents },
        context: { signal: {}, interactionMode: {}, eventBus: {} },
        runContext: { runId: -1 },
        emit: vi.fn(),
        startExecution: execA.startExecution,
        finishExecution: execA.finishExecution,
        traceContext: null,
      }),
      preparationPhase.runPreparationPhase(loopB, {
        contentPackage: deepPackage,
        context: { signal: {}, interactionMode: {}, eventBus: {} },
        runContext: { runId: Number.MAX_SAFE_INTEGER },
        emit: vi.fn(),
        startExecution: execB.startExecution,
        finishExecution: execB.finishExecution,
        traceContext: null,
      }),
    ]);

    expect([resA.designSystem.theme, resB.designSystem.theme]).toEqual(["light", "dark"]);
  });

  it("should_update_loop_state_to_last_run_when_called_sequentially", async () => {
    const loop = createLoop();
    const toolQueue = [
      { tool: "parse_outline", result: { ok: true, data: { contentPackage: { slideIntents: [{ id: 1 }] }, slideIntents: [{ id: 1 }] } } },
      { tool: "extract_style", result: { ok: true, data: { designSystem: { theme: "light" } } } },
      { tool: "parse_outline", result: { ok: true, data: { contentPackage: { slideIntents: [{ id: 2 }, { id: 3 }] }, slideIntents: [{ id: 2 }, { id: 3 }] } } },
      { tool: "extract_style", result: { ok: true, data: { designSystem: { theme: "dark" } } } },
    ];
    loop.toolDispatch._callTool.mockImplementation(async (tool) => {
      const next = toolQueue.shift();
      if (!next || next.tool !== tool) {
        throw new Error("unexpected tool order");
      }
      return next.result;
    });
    const { startExecution, finishExecution } = createExecution();
    const context = { signal: {}, interactionMode: {}, eventBus: {} };

    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 1 }] },
      context,
      runContext: { runId: 6 },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });
    await preparationPhase.runPreparationPhase(loop, {
      contentPackage: { slideIntents: [{ id: 2 }, { id: 3 }] },
      context,
      runContext: { runId: 7 },
      emit: vi.fn(),
      startExecution,
      finishExecution,
      traceContext: null,
    });

    expect(loop.state.slideIntents).toHaveLength(2);
  });
});
