import { normalizeRenderType } from "../../../../shared/index.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { DESIGN_PHASE_DEFAULTS, runWithPhaseSpan } from "./phase-utils.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * @typedef {(stepName: string, input: any) => Promise<{ loopIteration: any, stepInfo: { context: any } }>} StartExecutionFn
 */

/**
 * @typedef {(stepName: string, loopIteration: any, stepInfo: any) => Promise<void>} FinishExecutionFn
 */

/**
 * @typedef {(deckHtmlDsl: string, slidesMeta: any[], meta?: any) => void} EmitDeckUpdateFn
 */

/**
 * 视觉填充阶段处理
 *
 * @param {any} loop
 * @param {{ context: any, runContext: any, emit?: EmitFn, startExecution: StartExecutionFn, finishExecution: FinishExecutionFn, emitDeckUpdate: EmitDeckUpdateFn, traceContext?: any }} params
 * @returns {Promise<{ deckHtmlDsl: string, slidesMeta: any[], imageSlots: any[], imageReport: any, visualReport: any, refineResult?: any, pendingImages: string[] }>}
 */
export async function runVisualPhase(loop, {
  contentPackage: providedContentPackage,
  slideIntents: providedSlideIntents,
  designSystem: providedDesignSystem,
  generated: providedGenerated,
  slideHtmls: providedSlideHtmls,
  slidesMeta: providedSlidesMeta,
  imageSlots: providedImageSlots,
  baseDeckHtmlDsl: providedBaseDeckHtmlDsl,
  pendingImages: providedPendingImages,
  brainstormResult: providedBrainstormResult,
  constraints: providedConstraints,
  userConfig: providedUserConfig,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
  emitDeckUpdate,
  traceContext,
}) {
  const runId = runContext?.runId;
  const state = loop.state && typeof loop.state === "object" ? loop.state : {};
  const contentPackage = providedContentPackage ?? state.contentPackage;
  const slideIntents = Array.isArray(providedSlideIntents)
    ? providedSlideIntents
    : Array.isArray(state.slideIntents)
      ? state.slideIntents
      : [];
  const designSystem = providedDesignSystem ?? state.designSystem;
  const generated = Array.isArray(providedGenerated)
    ? providedGenerated
    : Array.isArray(state.generated)
      ? state.generated
      : [];
  let slideHtmls = Array.isArray(providedSlideHtmls)
    ? providedSlideHtmls
    : Array.isArray(state.slideHtmls)
      ? state.slideHtmls
      : [];
  let slidesMeta = Array.isArray(providedSlidesMeta)
    ? providedSlidesMeta
    : Array.isArray(state.slidesMeta)
      ? state.slidesMeta
      : [];
  const imageSlots = Array.isArray(providedImageSlots)
    ? providedImageSlots
    : Array.isArray(state.imageSlots)
      ? state.imageSlots
      : [];
  const baseDeckHtmlDsl = typeof providedBaseDeckHtmlDsl === "string"
    ? providedBaseDeckHtmlDsl
    : typeof state.baseDeckHtmlDsl === "string"
      ? state.baseDeckHtmlDsl
      : "";
  let pendingImages = Array.isArray(providedPendingImages)
    ? providedPendingImages
    : Array.isArray(state.pendingImages)
      ? state.pendingImages
      : [];
  const brainstormResult = providedBrainstormResult ?? state.brainstormResult ?? null;
  const constraints = providedConstraints ?? state.constraints ?? {};
  const userConfig = providedUserConfig ?? state.userConfig ?? {};

  const runPhase = async () => {
    // deferredVisuals: 延迟生图模式，只生成占位符不实际渲染
    const deferredVisuals = context?.deferredVisuals === true;

    loop._transitionPhase(loop.phase, DesignPhase.VISUAL_FILLING, { emit, runId });

    const { loopIteration, stepInfo } = await startExecution("visual_filling", {
      contentPackage,
      slideIntents,
      designSystem,
      generated,
      slideHtmls,
      slidesMeta,
      imageSlots,
      deckHtmlDsl: baseDeckHtmlDsl,
      pendingImages,
      deferredVisuals,
    });
    const visualContext = stepInfo.context;

    let imageReport = null;
    let visualReport = null;
    let refineResult = null;
    let finalImageSlots = imageSlots;
    let deckHtmlDsl = baseDeckHtmlDsl;

    // 延迟生图模式：跳过实际渲染，保留占位符
    if (deferredVisuals) {
      emit?.("design.visual.deferred", {
        runId,
        imageSlotCount: imageSlots.length,
        message: "Visual rendering deferred - placeholders retained",
      });
      await finishExecution("visual_filling", loopIteration, stepInfo);
      return {
        deckHtmlDsl: baseDeckHtmlDsl,
        slidesMeta,
        imageSlots,
        imageReport: { deferred: true, slotCount: imageSlots.length },
        visualReport: null,
        pendingImages: imageSlots.map((s) => s.slotId),
      };
    }

    const imageProvider = context.imageProvider || context.imageService;
    const hasModelCapability = !!(context.modelRouter || context.aiApiService);
    const visualSlotsForRender = loop._buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);

    const aiImageSlotIds = imageSlots
      .filter((s) => {
        const rt = normalizeRenderType(s.renderType);
        return rt === "ai-image";
      })
      .map((s) => s.slotId);

    const fillResult = await loop._callTool(
      "fill_visual",
      {
        visualSlotsForRender,
        contentPackage,
        designSystem,
        slideHtmls,
        runContext,
        constraints,
        imageSlots,
        aiImageSlotIds,
      },
      visualContext
    );

    if (!fillResult.ok) throw new Error(fillResult.error || "fill_visual failed");
    const fillData = fillResult.data || {};
    visualReport = fillData.visualReport ?? visualReport;
    imageReport = fillData.imageReport ?? imageReport;
    finalImageSlots = fillData.finalImageSlots ?? finalImageSlots;
    deckHtmlDsl = fillData.deckHtmlDsl ?? deckHtmlDsl;
    pendingImages = fillData.pendingImages ?? pendingImages;
    emitDeckUpdate(deckHtmlDsl, slidesMeta, { source: "visual_fill" });

    // Refine if enabled
    if (userConfig?.refine?.enabled) {
      const deckPackage = { deckHtmlDsl, slidesMeta, designSystem, imageSlots: finalImageSlots };
      const refineOut = await runRefine(deckPackage, contentPackage, runContext, visualContext, userConfig, emit);
      deckHtmlDsl = refineOut.deckHtmlDsl;
      slidesMeta = refineOut.slidesMeta;
      refineResult = refineOut.refineResult;
      emitDeckUpdate(deckHtmlDsl, slidesMeta, { source: "refine" });
    }

    await finishExecution("visual_filling", loopIteration, stepInfo);

    return {
      deckHtmlDsl,
      slidesMeta,
      imageSlots: finalImageSlots,
      imageReport,
      visualReport,
      refineResult,
      pendingImages,
    };
  };

  const visualOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.visual",
    { runId, slideCount: slideHtmls.length },
    runPhase
  );

  state.deckHtmlDsl = visualOut.deckHtmlDsl;
  state.slidesMeta = visualOut.slidesMeta;
  state.finalImageSlots = visualOut.imageSlots;
  state.visualReport = visualOut.visualReport;
  state.imageReport = visualOut.imageReport;
  state.refineResult = visualOut.refineResult;
  if (Array.isArray(visualOut.pendingImages)) {
    state.pendingImages = visualOut.pendingImages;
  }

  return visualOut;
}

/**
 * Refine 阶段处理
 */
async function runRefine(deckPackage, contentPackage, runContext, context, userConfig, emit) {
  const { runReactRefiner } = await import("../../refiner/react-refiner.js");
  const { createToolExecutor } = await import("../../refiner/react-refiner-tools.js");

  const toolContext = {
    deckPackage,
    contentPackage,
    stageApi: context,
  };
  const toolExecutor = createToolExecutor(toolContext);

  const refineResult = await runReactRefiner(
    toolContext.deckPackage,
    { contentPackage, runContext, stageApi: context },
    {
      recommendedSteps: userConfig.refine.recommendedSteps || DESIGN_PHASE_DEFAULTS.refineRecommendedSteps,
      hardLimit: userConfig.refine.hardLimit || DESIGN_PHASE_DEFAULTS.refineHardLimit,
      toolExecutor,
      mode: "generation",
      onStep: (step) => emit?.("design.refine.step", { actor: "design", status: "step", payload: step }),
    }
  );

  const deckHtmlDsl = refineResult.finalDeck?.deckHtmlDsl || toolContext.deckPackage.deckHtmlDsl;
  const slidesMeta = refineResult.finalDeck?.slidesMeta || toolContext.deckPackage.slidesMeta;

  emitStage(emit, "design.refine.ended", "ended", {
    qualityScore: refineResult.qualityScore,
    stepCount: refineResult.steps?.length || 0,
    terminationReason: refineResult.terminationReason,
  });

  return { deckHtmlDsl, slidesMeta, refineResult };
}
