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

import * as generatingPhase from "../../../../../../../js/agents/stages/design/internal/phases/generating-phase.js";

const { runGeneratingPhase } = generatingPhase;

function makeLoop(overrides = {}) {
  return {
    state: {},
    batchSize: 2,
    batchConcurrency: 1,
    phase: "generating",
    toolDispatch: { _callTool: vi.fn() },
    phaseRunner: { _transitionPhase: vi.fn() },
    messageHandling: {},
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

function makeParams(exec, overrides = {}) {
  return {
    slideIntents: [],
    contentPackage: {},
    designSystem: {},
    constraints: {},
    userConfig: {},
    context: {},
    runContext: { runId: "run-1", timeoutMs: 0 },
    emit: vi.fn(),
    startExecution: exec.startExecution,
    finishExecution: exec.finishExecution,
    traceContext: null,
    skipReview: true,
    ...overrides,
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

  it("should_export_all_named_exports", () => {
    expect(Object.keys(generatingPhase).sort()).toEqual(["runGeneratingPhase"]);
  });

  it("should_wrap_generation_in_runWithPhaseSpan", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1" }],
        traceContext: { id: "trace" },
        runContext: { runId: "run-span", timeoutMs: 0 },
        skipReview: false,
      })
    );

    expect(mockedPhaseUtils.runWithPhaseSpan).toHaveBeenCalledWith(
      { id: "trace" },
      "design.phase.generating",
      expect.objectContaining({ runId: "run-span", slideCount: 1, skipReview: false }),
      expect.any(Function)
    );
  });

  it("should_call_startExecution_with_effective_inputs", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const slideIntents = [{ slideIntentId: "s1" }, { slideIntentId: "s2" }];
    const contentPackage = { claims: [] };
    const designSystem = { theme: "light" };
    const constraints = { imagePolicy: "balanced" };
    const userConfig = { mode: "demo" };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents,
        contentPackage,
        designSystem,
        constraints,
        userConfig,
      })
    );

    expect(exec.startExecution).toHaveBeenCalledWith("generating", {
      contentPackage,
      slideIntents,
      designSystem,
      constraints,
      userConfig,
    });
  });

  it("should_plan_image_slots_with_ImagePlanner_when_context_has_no_brainstormResult", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const slideIntents = [{ slideIntentId: "s1" }];
    const designSystem = { theme: "light" };
    const constraints = { imagePolicy: "balanced" };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { slideIntents, designSystem, constraints }));

    expect(mockedImagePlanner.ImagePlanner.plan).toHaveBeenCalledWith(slideIntents, designSystem, constraints);
  });

  it("should_skip_ImagePlanner_plan_when_context_provides_brainstormResult", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        context: {
          brainstormResult: {
            imageSlots: [{ slotId: "img-1" }],
            candidatesBySlide: [],
          },
        },
      })
    );

    expect(mockedImagePlanner.ImagePlanner.plan).not.toHaveBeenCalled();
  });

  it("should_trim_and_filter_selectedIdeasForPrompt_from_candidatesBySlide", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        context: {
          brainstormResult: {
            imageSlots: [],
            candidatesBySlide: [
              {
                slideIntentId: "  s1  ",
                slideIndex: 1,
                selectedCandidate: { atmosphere: "warm" },
              },
              {
                slideIntentId: "   ",
                slideIndex: 2,
                selectedCandidate: { atmosphere: "skip" },
              },
            ],
          },
        },
      })
    );

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({
        selectedIdeas: [
          {
            slideIntentId: "s1",
            slideIndex: 1,
            atmosphere: "warm",
            elementsMarkdown: undefined,
            visualSlots: undefined,
          },
        ],
      }),
      exec.stepInfo.context
    );
  });

  it("should_emit_image_planning_completed_with_pendingImages_and_estimatedCostUSD", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([
      { slotId: "img-1", style: "3d", slideIndex: 0 },
      { slotId: "img-2", style: "flat", slideIndex: 1 },
    ]);
    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        constraints: { imagePolicy: "", imageBudget: 0 },
      })
    );

    expect(findEmitStageCall("design.image.planning.completed")?.[3]).toEqual(
      expect.objectContaining({
        policy: "balanced",
        planned: 2,
        pendingImages: ["img-1", "img-2"],
        estimatedCostUSD: 0.043,
      })
    );
  });

  it("should_not_emit_image_planning_completed_when_constraints_has_no_image_policy_or_budget", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { constraints: {} }));

    expect(findEmitStageCall("design.image.planning.completed")).toBeNull();
  });

  it("should_use_context_modelRouter_when_provided", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const modelRouter = { id: "router" };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { context: { modelRouter } }));

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({ modelRouter }),
      exec.stepInfo.context
    );
  });

  it("should_fallback_to_context_runContext_modelRouter_when_context_modelRouter_is_missing", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const modelRouter = { id: "router-from-runContext" };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { context: { runContext: { modelRouter } } }));

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({ modelRouter }),
      exec.stepInfo.context
    );
  });

  it("should_pass_dslRules_to_spawn_slide_agent", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    mockedDslRules.getDslRules.mockResolvedValue({ rules: "dsl" });
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec));

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({ dslRules: { rules: "dsl" } }),
      exec.stepInfo.context
    );
  });

  it("should_create_linked_spawn_signal_when_timeoutMs_is_positive", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { runContext: { runId: "run-timeout", timeoutMs: 500 } }));

    expect(mockedCancellation.createLinkedSignal).toHaveBeenCalledWith(exec.stepInfo.context.signal, 500);
  });

  it("should_use_original_signal_when_timeoutMs_is_0", async () => {
    const loop = makeLoop();
    const exec = makeExecution({ id: "sig" });

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { runContext: { runId: "run-timeout", timeoutMs: 0 } }));

    expect(loop.toolDispatch._callTool).toHaveBeenCalledWith(
      "spawn_slide_agent",
      expect.objectContaining({ signal: exec.stepInfo.context.signal }),
      exec.stepInfo.context
    );
  });

  it("should_default_timeout_to_10_minutes_when_no_timeout_is_provided", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        context: {},
        runContext: { runId: "run-default-timeout" },
      })
    );

    expect(mockedCancellation.createLinkedSignal).toHaveBeenCalledWith(exec.stepInfo.context.signal, 10 * 60 * 1000);
  });

  it("should_support_genResult_data_as_array_when_data_generated_is_missing", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: [{ slideHtml: "<a/>" }] });

    const out = await runGeneratingPhase(loop, makeParams(exec));

    expect(out.slideHtmls).toEqual(["<a/>"]);
  });

  it("should_emit_design_generate_ended_with_slide_count", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }, { slideHtml: "<s2/>" }] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1" }, { slideIntentId: "s2" }],
      })
    );

    expect(findEmitStageCall("design.generate.ended")?.[3]).toEqual({ slides: 2 });
  });

  it("should_emit_design_qa_ended_with_qaFailed_0_and_degradedCount_0_when_all_slides_pass", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }, { slideHtml: "<s2/>" }] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1" }, { slideIntentId: "s2" }],
      })
    );

    expect(findEmitStageCall("design.qa.ended")?.[3]).toEqual({ slides: 2, qaFailed: 0, degradedCount: 0 });
  });

  it("should_transition_to_reviewing_when_skipReview_is_false", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const emit = vi.fn();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        emit,
        runContext: { runId: "run-review", timeoutMs: 0 },
        skipReview: false,
      })
    );

    expect(loop.phaseRunner._transitionPhase).toHaveBeenCalledWith(loop.phase, mockedStates.DesignPhase.REVIEWING, {
      emit,
      runId: "run-review",
    });
  });

  it("should_not_transition_to_reviewing_when_skipReview_is_true", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(loop, makeParams(exec, { skipReview: true }));

    expect(loop.phaseRunner._transitionPhase).not.toHaveBeenCalled();
  });

  it("should_build_safe_html_when_initial_QA_fails", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const slideIntents = [{ slideIntentId: "s1", pageType: "cover", title: "Title" }];
    const contentPackage = {};
    const designSystem = {};

    mockedImagePlanner.ImagePlanner.plan.mockReturnValue([{ slotId: "img-1", style: "photo", slideIndex: 0 }]);
    mockedQaValidator.validateSlide
      .mockReturnValueOnce({ pass: false }) // initial HTML fails
      .mockReturnValueOnce({ pass: true }); // safe HTML passes
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: "<bad/>" }] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents,
        contentPackage,
        designSystem,
      })
    );

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
  });

  it("should_emit_design_degraded_reason_qa_failed_when_safe_QA_passes", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    mockedQaValidator.validateSlide.mockReturnValueOnce({ pass: false }).mockReturnValueOnce({ pass: true });
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: "<bad/>" }] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1", title: "Title" }],
      })
    );

    expect(findEmitStageCall("design.degraded")?.[3]).toEqual({ degradedCount: 1, reason: "qa_failed" });
  });

  it("should_emit_design_degraded_reason_qa_failed_after_safe_when_safe_QA_fails", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    mockedQaValidator.validateSlide.mockReturnValue({ pass: false });
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: "<bad/>" }] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1", title: "Title" }],
      })
    );

    expect(findEmitStageCall("design.degraded")?.[3]).toEqual({ degradedCount: 2, reason: "qa_failed_after_safe" });
  });

  it("should_escape_title_when_building_title_only_fallback_html", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const longTitle = "T".repeat(10000);

    mockedQaValidator.validateSlide.mockReturnValue({ pass: false });
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: "<bad/>" }] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1", title: longTitle }],
      })
    );

    expect(mockedDesignUtils.escapeHtml).toHaveBeenCalledWith(longTitle);
  });

  it("should_mark_generated_source_as_fallback_when_degraded", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    mockedQaValidator.validateSlide.mockReturnValue({ pass: false });
    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [{ slideHtml: "<bad/>" }] } });

    const out = await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1", title: "Title" }],
      })
    );

    expect(out.generated[0]?.source).toBe("fallback");
  });

  it("should_attach_styleLock_to_designSystem_object", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const designSystem = { colors: { primary: "#111" } };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    const out = await runGeneratingPhase(loop, makeParams(exec, { designSystem }));

    expect(designSystem.styleLock).toBe(out.styleLock);
  });

  it("should_use_colors_background_as_bg_in_styleLock_when_bg_is_missing", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    const designSystem = { colors: { background: "#fff", text: "#000" } };

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    const out = await runGeneratingPhase(loop, makeParams(exec, { designSystem }));

    expect(out.styleLock.colors.bg).toBe("#fff");
  });

  it("should_update_loop_state_from_generation_output", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<s1/>" }] },
    });

    const out = await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1", pageType: "cover", title: "Title 1" }],
      })
    );

    expect(loop.state.slideHtmls).toEqual(out.slideHtmls);
  });

  it("should_reapply_userConfig_after_run_when_applyUserInputsToConfig_is_available", async () => {
    const loop = makeLoop({
      messageHandling: { applyUserInputsToConfig: vi.fn((cfg) => ({ normalized: true, source: cfg })) },
    });
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({ ok: true, data: { generated: [] } });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        userConfig: "",
      })
    );

    expect(loop.messageHandling.applyUserInputsToConfig).toHaveBeenCalledTimes(2);
  });

  it("should_throw_when_spawn_slide_agent_returns_ok_false_with_error", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: false, error: "boom" });

    await expect(runGeneratingPhase(loop, makeParams(exec))).rejects.toThrow("boom");
  });

  it("should_throw_default_error_message_when_spawn_slide_agent_returns_ok_false_without_error", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: false });

    await expect(runGeneratingPhase(loop, makeParams(exec))).rejects.toThrow("spawn_slide_agent failed");
  });

  it("should_not_finishExecution_when_spawn_slide_agent_fails", async () => {
    const loop = makeLoop();
    const exec = makeExecution();
    loop.toolDispatch._callTool.mockResolvedValue({ ok: false, error: "boom" });

    try {
      await runGeneratingPhase(loop, makeParams(exec));
    } catch {
      // ignore
    }

    expect(exec.finishExecution).not.toHaveBeenCalled();
  });

  it("should_support_concurrent_calls_with_isolated_loop_state", async () => {
    const loopA = makeLoop();
    const loopB = makeLoop();
    const execA = makeExecution({ id: "sigA" });
    const execB = makeExecution({ id: "sigB" });

    mockedImagePlanner.ImagePlanner.plan.mockImplementation((intents) =>
      intents.map((intent, idx) => ({ slotId: `${intent.slideIntentId}-slot`, style: "flat", slideIndex: idx }))
    );

    loopA.toolDispatch._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));
    loopB.toolDispatch._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));

    const [outA, outB] = await Promise.all([
      runGeneratingPhase(
        loopA,
        makeParams(execA, {
          slideIntents: [{ slideIntentId: "a1" }],
          runContext: { runId: "run-A", timeoutMs: 0 },
        })
      ),
      runGeneratingPhase(
        loopB,
        makeParams(execB, {
          slideIntents: [{ slideIntentId: "b1" }, { slideIntentId: "b2" }],
          runContext: { runId: "run-B", timeoutMs: 0 },
        })
      ),
    ]);

    expect({
      outA: outA.slideHtmls,
      outB: outB.slideHtmls,
      stateA: loopA.state.slideHtmls,
      stateB: loopB.state.slideHtmls,
    }).toEqual({
      outA: ["<a1/>"],
      outB: ["<b1/>", "<b2/>"],
      stateA: ["<a1/>"],
      stateB: ["<b1/>", "<b2/>"],
    });
  });

  it("should_keep_last_call_state_when_runGeneratingPhase_is_called_twice_on_same_loop", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockImplementation(async (_name, payload) => ({
      ok: true,
      data: { generated: payload.slideIntents.map((intent) => ({ slideHtml: `<${intent.slideIntentId}/>` })) },
    }));

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s1" }],
        runContext: { runId: "run-1", timeoutMs: 0 },
      })
    );

    const second = await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "s2" }, { slideIntentId: "s3" }],
        runContext: { runId: "run-2", timeoutMs: 0 },
      })
    );

    expect(loop.state.slideHtmls).toEqual(second.slideHtmls);
  });

  it("should_createLinkedSignal_with_MAX_SAFE_INTEGER_timeout", async () => {
    const loop = makeLoop();
    const exec = makeExecution();

    loop.toolDispatch._callTool.mockResolvedValue({
      ok: true,
      data: { generated: [{ slideHtml: "<big/>" }] },
    });

    await runGeneratingPhase(
      loop,
      makeParams(exec, {
        slideIntents: [{ slideIntentId: "big", pageType: "content", title: "Big" }],
        contentPackage: { raw: "x".repeat(120000) },
        constraints: {
          imagePolicy: "balanced",
          imageBudget: Number.MAX_SAFE_INTEGER,
          nested: { level1: { level2: { level3: { level4: "deep" } } } },
        },
        runContext: { runId: "run-max", timeoutMs: Number.MAX_SAFE_INTEGER },
      })
    );

    expect(mockedCancellation.createLinkedSignal).toHaveBeenCalledWith(
      exec.stepInfo.context.signal,
      Number.MAX_SAFE_INTEGER
    );
  });
});
