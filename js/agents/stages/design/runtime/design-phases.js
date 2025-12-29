/**
 * Design Phases - 阶段处理函数
 *
 * 从 DesignAgentLoop.run() 提取的阶段处理逻辑
 */

import { buildSlideHtml } from "../dsl/dsl-builder.js";
import { validateSlide } from "../refiner/qa-validator.js";
import { getDslRules } from "../dsl/dsl-rules.js";
import { ImagePlanner } from "../image/image-planner.js";
import { normalizeRenderType } from "../../../shared/utils/value-utils.js";
import { checkCancelled, getEmitFn } from "../../../runtime/core/agent-loop.js";
import { DesignPhase } from "../states.js";

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

/**
 * 准备阶段：解析大纲 + 提取样式
 */
export async function runPreparationPhase(loop, {
  contentPackage,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
}) {
  // Outline parsing
  loop._transitionPhase(loop.phase, DesignPhase.OUTLINE_PARSING, { emit, runId: runContext.runId });
  checkCancelled(context.signal);

  const outlineResult = await loop._callTool("parse_outline", { contentPackage }, context);
  if (!outlineResult.ok) throw new Error(outlineResult.error || "parse_outline failed");
  const outlineData = outlineResult.data || {};
  const parsedContentPackage = outlineData.contentPackage || contentPackage;
  let slideIntents = Array.isArray(outlineData.slideIntents)
    ? outlineData.slideIntents
    : Array.isArray(parsedContentPackage?.slideIntents)
    ? parsedContentPackage.slideIntents
    : [];

  // Outline confirmation
  loop._transitionPhase(loop.phase, DesignPhase.OUTLINE_CONFIRMING, { emit, runId: runContext.runId });
  if (context?.interactionMode?.outlineConfirm && context.interactionMode.outlineConfirm !== "skip") {
    const outlineConfirm = await loop.waitForUserAction("confirm_outline", { eventBus: context.eventBus, signal: context.signal });
    if (Array.isArray(outlineConfirm?.slideIntents)) slideIntents = outlineConfirm.slideIntents;
  }

  if (slideIntents.length === 0) throw new Error("DesignAgentLoop: contentPackage.slideIntents is required");

  // Style extraction
  loop._transitionPhase(loop.phase, DesignPhase.STYLE_EXTRACTING, { emit, runId: runContext.runId });
  checkCancelled(context.signal);

  const constraints = runContext.constraints || {};
  let userConfig =
    (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
    (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
    (context && typeof context === "object" ? context.userConfig : undefined) ||
    {};
  userConfig = loop.applyUserInputsToConfig(userConfig);

  const { loopIteration: styleIteration, stepInfo: styleStep } = await startExecution("style_extracting", {
    contentPackage: parsedContentPackage,
    slideIntents,
    constraints,
    userConfig,
  });
  const styleContext = styleStep.context;
  const styleResult = await loop._callTool("extract_style", { contentPackage: parsedContentPackage, constraints, userConfig }, styleContext);
  if (!styleResult.ok) throw new Error(styleResult.error || "extract_style failed");
  const designSystem = styleResult.data?.designSystem || styleResult.data;

  emitStage(emit, "design.tokens.ended", "ended", { theme: designSystem?.theme });
  checkCancelled(styleContext.signal);

  await finishExecution("style_extracting", styleIteration, styleStep);

  // Style confirmation with full designTokens preview
  loop._transitionPhase(loop.phase, DesignPhase.STYLE_CONFIRMING, { emit, runId: runContext.runId });

  // Emit style preview for UI
  emitStage(emit, "design.style.preview", "awaiting_confirm", {
    runId: runContext.runId,
    designSystem,
    designTokens: {
      theme: designSystem?.theme,
      colorScheme: designSystem?.colorScheme,
      fontFamily: designSystem?.fontFamily,
      accentColor: designSystem?.accentColor,
    },
    slideCount: slideIntents.length,
  });

  if (context?.interactionMode?.styleConfirm && context.interactionMode.styleConfirm !== "skip") {
    const styleConfirmResult = await loop.waitForUserAction("confirm_style", { eventBus: context.eventBus, signal: context.signal });

    // Apply user overrides if provided
    if (styleConfirmResult && typeof styleConfirmResult === "object") {
      if (styleConfirmResult.colorScheme) designSystem.colorScheme = styleConfirmResult.colorScheme;
      if (styleConfirmResult.fontFamily) designSystem.fontFamily = styleConfirmResult.fontFamily;
      if (styleConfirmResult.accentColor) designSystem.accentColor = styleConfirmResult.accentColor;
      if (styleConfirmResult.theme) designSystem.theme = styleConfirmResult.theme;

      // Log override to blackboard
      loop._blackboard?.logDecision("style_override", "User modified design tokens", { overrides: styleConfirmResult });
    }
  }

  return {
    parsedContentPackage,
    slideIntents,
    designSystem,
    constraints,
    userConfig,
  };
}

function hasImagePlanningConfig(constraints) {
  if (!constraints || typeof constraints !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(constraints, "imagePolicy") ||
    Object.prototype.hasOwnProperty.call(constraints, "imageBudget")
  );
}

function estimateSlotCostUSD(slot) {
  const style = String(slot?.style || "").toLowerCase();
  if (style.includes("3d") || style.includes("photo") || style.includes("hd") || style.includes("cinematic")) {
    return 0.04;
  }
  return 0.003;
}

/**
 * 生成阶段处理
 */
export async function runGeneratingPhase(loop, {
  slideIntents,
  contentPackage,
  designSystem,
  constraints,
  userConfig,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
  emitDeckUpdate,
  skipReview,
}) {
  const modelRouter = context?.modelRouter ?? context?.runContext?.modelRouter ?? null;

  const { loopIteration, stepInfo } = await startExecution("generating", {
    contentPackage,
    slideIntents,
    designSystem,
    constraints,
    userConfig,
  });
  const generatingContext = stepInfo.context;

  // Plan image slots
  const brainstormResult = context?.brainstormResult || {
    ideaPool: [],
    selectedIdeas: [],
    imageSlots: ImagePlanner.plan(slideIntents, designSystem, constraints),
    candidatesBySlide: [],
  };
  const { imageSlots } = brainstormResult;

  const selectedIdeasForPrompt = Array.isArray(brainstormResult?.candidatesBySlide)
    ? brainstormResult.candidatesBySlide
        .map((row) => ({
          slideIntentId: String(row?.slideIntentId || "").trim(),
          slideIndex: Number.isFinite(row?.slideIndex) ? row.slideIndex : undefined,
          atmosphere: row?.selectedCandidate?.atmosphere,
          elementsMarkdown: row?.selectedCandidate?.elementsMarkdown,
          visualSlots: row?.selectedCandidate?.visualSlots,
        }))
        .filter((x) => x.slideIntentId)
    : [];

  let pendingImages = imageSlots.map((s) => s.slotId);
  const estimatedCostUSD = imageSlots.reduce((sum, s) => sum + estimateSlotCostUSD(s), 0);

  if (hasImagePlanningConfig(constraints)) {
    emitStage(emit, "design.image.planning.completed", "completed", {
      policy: String(constraints?.imagePolicy || "balanced"),
      planned: imageSlots.length,
      pendingImages,
      estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
    });
    checkCancelled(generatingContext.signal);
  }

  const dslRules = await getDslRules();
  checkCancelled(generatingContext.signal);

  const genResult = await loop._callTool(
    "spawn_slide_agent",
    {
      slideIntents,
      contentPackage,
      designSystem,
      batchSize: loop.batchSize,
      batchConcurrency: loop.batchConcurrency,
      modelRouter,
      aiApiService: context.aiApiService,
      imageSlots,
      selectedIdeas: selectedIdeasForPrompt,
      emit,
      signal: generatingContext.signal,
      dslRules,
    },
    generatingContext
  );

  if (!genResult.ok) throw new Error(genResult.error || "spawn_slide_agent failed");
  const generated = Array.isArray(genResult.data?.generated)
    ? genResult.data.generated
    : Array.isArray(genResult.data)
    ? genResult.data
    : [];

  emitStage(emit, "design.generate.ended", "ended", { slides: generated.length });
  checkCancelled(generatingContext.signal);

  if (!skipReview) {
    loop._transitionPhase(loop.phase, DesignPhase.REVIEWING, { emit, runId: runContext.runId });
  }
  await finishExecution("generating", loopIteration, stepInfo);

  // QA validation
  let slidesMeta = [];
  let slideHtmls = [];
  let degradedCount = 0;

  for (let i = 0; i < slideIntents.length; i++) {
    const slideIntent = slideIntents[i];
    const slideNo = i + 1;
    const imageSlotsForSlide = imageSlots.filter((s) => s.slideIndex === i);

    let slideHtml = generated[i]?.slideHtml;
    let qa = validateSlide(slideHtml);
    let degraded = false;

    if (!qa.pass) {
      degraded = true;
      degradedCount++;
      emit?.("design.degraded", {
        actor: "design",
        status: "warn",
        payload: { slideNo, slideIntentId: slideIntent.slideIntentId },
      });
      slideHtml = buildSlideHtml(slideIntent, designSystem, contentPackage, {
        safeMode: true,
        slideNo,
        imageSlotsForSlide,
      });
      qa = validateSlide(slideHtml);
    }

    if (!qa.pass) {
      degraded = true;
      degradedCount++;
      emit?.("design.degraded", {
        actor: "design",
        status: "warn",
        payload: { slideNo, slideIntentId: slideIntent.slideIntentId, reason: "qa_failed_after_safe" },
      });
      slideHtml = buildSlideHtml(
        { ...slideIntent, keyPoints: [], claimIds: [] },
        designSystem,
        contentPackage,
        { safeMode: true, slideNo, imageSlotsForSlide }
      );
      qa = validateSlide(slideHtml);
    }

    slideHtmls.push(slideHtml);
    slidesMeta.push({
      slideNo,
      slideIntentId: slideIntent?.slideIntentId,
      pageType: slideIntent?.pageType,
      title: slideIntent?.title,
      degraded,
      source: generated[i]?.source || "fallback",
      qa,
    });
  }

  if (degradedCount > 0) emitStage(emit, "design.degraded", "warn", { degradedCount });
  emitStage(emit, "design.qa.ended", "ended", { slides: slideHtmls.length, degradedCount });

  const baseDeckHtmlDsl = slideHtmls.join("\n\n");
  emitDeckUpdate(baseDeckHtmlDsl, slidesMeta, { source: "qa" });

  return {
    generated,
    slideHtmls,
    slidesMeta,
    imageSlots,
    brainstormResult,
    pendingImages,
    baseDeckHtmlDsl,
    degradedCount,
  };
}

/**
 * 视觉填充阶段处理
 */
export async function runVisualPhase(loop, {
  contentPackage,
  slideIntents,
  designSystem,
  generated,
  slideHtmls,
  slidesMeta,
  imageSlots,
  baseDeckHtmlDsl,
  pendingImages,
  brainstormResult,
  constraints,
  userConfig,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
  emitDeckUpdate,
}) {
  loop._transitionPhase(loop.phase, DesignPhase.VISUAL_FILLING, { emit, runId: runContext.runId });

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
  });
  const visualContext = stepInfo.context;

  let imageReport = null;
  let visualReport = null;
  let refineResult = null;
  let finalImageSlots = imageSlots;
  let deckHtmlDsl = baseDeckHtmlDsl;

  const imageProvider = context.imageProvider || context.imageService;
  const hasModelCapability = !!(context.modelRouter || context.aiApiService);
  const visualSlotsForRender = loop._buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability);

  const aiImageSlotIds = imageSlots
    .filter((s) => {
      const rt = normalizeRenderType(s.renderType);
      return rt === "ai-image" || rt === "";
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
}

/**
 * Refine 阶段处理
 */
async function runRefine(deckPackage, contentPackage, runContext, context, userConfig, emit) {
  const { runReactRefiner } = await import("../refiner/react-refiner.js");
  const { createToolExecutor } = await import("../refiner/react-refiner-tools.js");

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
      recommendedSteps: userConfig.refine.recommendedSteps || 5,
      hardLimit: userConfig.refine.hardLimit || 15,
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
