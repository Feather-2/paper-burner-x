/**
 * Design Phases - 阶段处理函数
 *
 * 从 DesignAgentLoop.run() 提取的阶段处理逻辑
 */

import { buildSlideHtml } from "../dsl/dsl-builder.js";
import { validateSlide } from "../refiner/qa-validator.js";
import { getDslRules } from "../dsl/dsl-rules.js";
import { escapeHtml } from "../shared/design-utils.js";
import { ImagePlanner } from "../image/image-planner.js";
import { normalizeRenderType } from "../../../shared/index.js";
import { checkCancelled, getEmitFn } from "../../../runtime/index.js";
import { DesignPhase } from "../states.js";
import { planDeck, applyUserEdits, formatPlanForDialog } from "./deck-planner.js";
import { generateLayoutBatch } from "../generators/layout-generator.js";

/**
 * @typedef {(name: string, event: any) => void} EmitFn
 */

/**
 * @typedef {object} SlideMeta
 * @property {number} slideNo
 * @property {any} slideIntentId
 * @property {any} pageType
 * @property {any} title
 * @property {any} qa
 * @property {boolean=} degraded
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

// === 可配置常量 ===
const DESIGN_PHASE_DEFAULTS = {
  costPerHDSlot: 0.04,    // HD/3D/photo 风格每槽成本 USD
  costPerBasicSlot: 0.003, // 基础风格每槽成本 USD
  refineRecommendedSteps: 5,
  refineHardLimit: 15,
};

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

/**
 * 准备阶段：解析大纲 + 提取样式
 *
 * @param {any} loop
 * @param {{ contentPackage: any, context: any, runContext: any, emit?: EmitFn, startExecution: StartExecutionFn, finishExecution: FinishExecutionFn }} params
 * @returns {Promise<{ parsedContentPackage: any, slideIntents: any[], designSystem: any, constraints: any, userConfig: any }>}
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

/**
 * 规划阶段：生成预案并等待用户确认
 *
 * @param {any} loop
 * @param {{ slideIntents: any[], designSystem: any, context: any, runContext: any, emit?: EmitFn }} params
 * @returns {Promise<{ plans: any[], planResult: any }>}
 */
export async function runPlanningPhase(loop, {
  slideIntents,
  designSystem,
  context,
  runContext,
  emit,
}) {
  loop._transitionPhase(loop.phase, DesignPhase.DECK_PLANNING, { emit, runId: runContext.runId });
  checkCancelled(context.signal);

  // 生成规划
  const planResult = planDeck(slideIntents, designSystem);
  let plans = planResult.plans;

  // Emit 规划预览
  const dialogFormat = formatPlanForDialog(plans);
  emitStage(emit, "design.plan.preview", "awaiting_confirm", {
    runId: runContext.runId,
    plans,
    dialogFormat,
    slideCount: plans.length,
    summary: planResult.summary,
  });

  // Log to blackboard
  loop._blackboard?.logDecision("plan_generated", `Generated ${plans.length} slide plans`, {
    summary: planResult.summary,
  });

  // 等待用户确认/调整
  loop._transitionPhase(loop.phase, DesignPhase.PLAN_CONFIRMING, { emit, runId: runContext.runId });

  if (context?.interactionMode?.planConfirm && context.interactionMode.planConfirm !== "skip") {
    const planConfirmResult = await loop.waitForUserAction("confirm_plan", {
      eventBus: context.eventBus,
      signal: context.signal,
    });

    // 应用用户修改
    if (planConfirmResult && typeof planConfirmResult === "object") {
      if (Array.isArray(planConfirmResult.edits)) {
        plans = applyUserEdits(plans, planConfirmResult.edits);
        loop._blackboard?.logDecision("plan_edited", "User modified slide plans", {
          editCount: planConfirmResult.edits.length,
        });
      }
      // 支持直接传入修改后的 plans
      if (Array.isArray(planConfirmResult.plans)) {
        plans = planConfirmResult.plans;
      }
    }
  }

  emitStage(emit, "design.plan.confirmed", "confirmed", {
    runId: runContext.runId,
    plans,
    slideCount: plans.length,
  });

  return {
    plans,
    planResult,
  };
}

/**
 * 布局阶段：生成线框图并等待用户确认
 *
 * @param {any} loop
 * @param {{ slideIntents: any[], plans: any[], designSystem: any, context: any, runContext: any, emit?: EmitFn }} params
 * @returns {Promise<{ layouts: any[] }>}
 */
export async function runLayoutPhase(loop, {
  slideIntents,
  plans,
  designSystem,
  context,
  runContext,
  emit,
}) {
  loop._transitionPhase(loop.phase, DesignPhase.LAYOUT_DEVELOPING, { emit, runId: runContext.runId });
  checkCancelled(context.signal);

  // 生成布局
  const layouts = generateLayoutBatch(slideIntents, plans);

  // 组装预览 HTML
  const previewHtml = layouts.map((l) => l.layoutHtml).join("\n");

  emitStage(emit, "design.layout.preview", "awaiting_confirm", {
    runId: runContext.runId,
    layouts,
    previewHtml,
    slideCount: layouts.length,
  });

  loop._blackboard?.logDecision("layout_generated", `Generated ${layouts.length} layout wireframes`);

  // 等待用户确认
  loop._transitionPhase(loop.phase, DesignPhase.LAYOUT_CONFIRMING, { emit, runId: runContext.runId });

  if (context?.interactionMode?.layoutConfirm && context.interactionMode.layoutConfirm !== "skip") {
    const layoutConfirmResult = await loop.waitForUserAction("confirm_layout", {
      eventBus: context.eventBus,
      signal: context.signal,
    });

    // 支持用户修改布局
    if (layoutConfirmResult && typeof layoutConfirmResult === "object" && Array.isArray(layoutConfirmResult.layouts)) {
      layouts.splice(0, layouts.length, ...layoutConfirmResult.layouts);
      loop._blackboard?.logDecision("layout_edited", "User modified layouts");
    }
  }

  emitStage(emit, "design.layout.confirmed", "confirmed", {
    runId: runContext.runId,
    layouts,
    slideCount: layouts.length,
  });

  return { layouts };
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
    return DESIGN_PHASE_DEFAULTS.costPerHDSlot;
  }
  return DESIGN_PHASE_DEFAULTS.costPerBasicSlot;
}

/**
 * 生成阶段处理
 *
 * @param {any} loop
 * @param {{ slideIntents: any[], contentPackage: any, designSystem: any, constraints: any, userConfig: any, context: any, runContext: any, emit?: EmitFn, startExecution: StartExecutionFn, finishExecution: FinishExecutionFn, emitDeckUpdate: EmitDeckUpdateFn, skipReview?: boolean }} params
 * @returns {Promise<{ generated: any[], slideHtmls: string[], slidesMeta: any[], imageSlots: any[], brainstormResult: any, pendingImages: string[], baseDeckHtmlDsl: string, degradedCount: number, styleLock: any }>}
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

  await finishExecution("generating", loopIteration, stepInfo);

  // Perform Health Check (Initial QA + Style Alignment Check)
  // Only transition to REVIEWING phase if skipReview is false
  if (!skipReview) {
    loop._transitionPhase(loop.phase, DesignPhase.REVIEWING, { emit, runId: runContext.runId });
  }

  // Update state with generated HTMLs for the tools to see
  let slideHtmls = generated.map((g) => g.slideHtml);
  /** @type {SlideMeta[]} */
  let slidesMeta = slideIntents.map((intent, i) => ({
    slideNo: i + 1,
    slideIntentId: intent.slideIntentId,
    pageType: intent.pageType,
    title: intent.title,
    qa: validateSlide(slideHtmls[i])
  }));

  // Last-resort downgrade: if QA fails, replace with safe templates; if still failing, use title-only fallback.
  let degradedCount = 0;
  let degradedReason = "";
  for (let i = 0; i < slidesMeta.length; i++) {
    const meta = slidesMeta[i];
    if (meta?.qa?.pass) continue;

    const slideIntent = slideIntents[i] || {};
    const imageSlotsForSlide = imageSlots.filter((s) => Number(s?.slideIndex) === i);
    const safeHtml = buildSlideHtml(slideIntent, designSystem, contentPackage, { safeMode: true, slideNo: i + 1, imageSlotsForSlide });
    degradedCount += 1;

    const safeQa = validateSlide(safeHtml);
    slideHtmls[i] = safeHtml;
    slidesMeta[i] = { ...meta, qa: safeQa, degraded: true };
    if (Array.isArray(generated) && generated[i]) generated[i] = { ...generated[i], slideHtml: safeHtml, source: "fallback" };

    if (!safeQa?.pass) {
      degradedReason = "qa_failed_after_safe";
      const title = String(slideIntent?.title || "Untitled");
      const id = `slide-${i + 1}`;
      const titleOnly = `
<section data-type="freeform" data-layout="safe" id="${escapeHtml(id)}" data-title="${escapeHtml(title)}" data-bg="#ffffff">
  <div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-h="auto" data-font="32" data-color="#0f172a" data-bold="true">${escapeHtml(title)}</div>
</section>`.trim();
      degradedCount += 1;
      const titleQa = validateSlide(titleOnly);
      slideHtmls[i] = titleOnly;
      slidesMeta[i] = { ...slidesMeta[i], qa: titleQa, degraded: true };
      if (Array.isArray(generated) && generated[i]) generated[i] = { ...generated[i], slideHtml: titleOnly, source: "fallback" };
    }
  }

  if (degradedCount > 0) {
    emitStage(emit, "design.degraded", "warn", {
      degradedCount,
      reason: degradedReason || "qa_failed",
    });
  }

  const qaFailed = slidesMeta.filter((m) => !m.qa?.pass).length;
  emitStage(emit, "design.qa.ended", "ended", { slides: slidesMeta.length, qaFailed, degradedCount });

  // === STYLE LOCK: Establish the locked style from designSystem for edit mode ===
  // This captures the approved color/font settings so edit mode can validate against them
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const styleLock = {
    colors: {
      primary: colors.primary,
      accent: colors.accent,
      bg: colors.bg || colors.background,
      text: colors.text,
    },
    typography: designSystem?.designTokens?.typography || designSystem?.typography || {},
    theme: designSystem?.theme,
    lockedAt: Date.now(),
  };

  // Store styleLock in designSystem for edit mode to access
  if (designSystem && typeof designSystem === 'object') {
    designSystem.styleLock = styleLock;
  }

  // Log to blackboard
  loop._blackboard?.logDecision("style_lock_established", "Style lock created from first batch generation", {
    colors: styleLock.colors,
    theme: styleLock.theme,
  });

  return {
    generated,
    slideHtmls,
    slidesMeta,
    imageSlots,
    brainstormResult,
    pendingImages,
    baseDeckHtmlDsl: slideHtmls.join("\n\n"),
    degradedCount,
    styleLock, // Export for downstream phases
  };
}

/**
 * 批量编排修复阶段 - 整合 QA 与风格对齐
 *
 * @param {any} loop
 * @param {any} state
 * @param {{ context: any, runContext: any, emit?: EmitFn }} params
 * @returns {Promise<{ deckHtmlDsl: string, slidesMeta: any[] }>}
 */
export async function runBatchRepairPhase(loop, state, { context, runContext, emit }) {
  const { slideHtmls, slidesMeta, designSystem, contentPackage } = state;
  const deckHtmlDsl = state.baseDeckHtmlDsl;

  loop._transitionPhase(loop.phase, DesignPhase.REPAIR, { emit, runId: runContext.runId });

  // 1. 运行全局风格审计
  const { runAutoReview } = await import("../reviewer/auto-reviewer.js");
  const reviewResult = await runAutoReview({ deckHtmlDsl, slidesMeta }, designSystem, { signal: context.signal });

  // 2. 收集 QA 报错
  const qaIssues = slidesMeta.filter(m => !m.qa?.pass).map(m => ({
    slideIndex: m.slideNo - 1,
    issues: m.qa.issues
  }));

  // 3. 判断是否需要修复
  const hasDegradedSlides = slidesMeta.some((m) => m?.degraded === true);
  if (qaIssues.length === 0 && reviewResult.pass && !hasDegradedSlides) {
    emitStage(emit, "design.repair.skipped", "progress", { reason: "healthy" });
    return { deckHtmlDsl, slidesMeta };
  }

  // 4. 调用批量编排工具 (BatchRepairAgent)
  emitStage(emit, "design.repair.started", "progress", {
    qaIssueCount: qaIssues.length,
    styleIssueCount: reviewResult.issues?.length || 0,
    consistencyScore: reviewResult.score
  });

  const repairResult = await loop._callTool("orchestrate_batch_repair", {
    deckPackage: { deckHtmlDsl, slidesMeta },
    qaIssues,
    styleIssues: reviewResult.issues,
    designSystem
  }, context);

  if (!repairResult.ok) {
    emitStage(emit, "design.repair.failed", "warn", { error: repairResult.error });
    return { deckHtmlDsl, slidesMeta };
  }

  const finalDeck = repairResult.data?.finalDeck || repairResult.data || {};
  const finalHtmls = finalDeck.deckHtmlDsl || deckHtmlDsl;
  const finalMeta = finalDeck.slidesMeta || slidesMeta;

  emitStage(emit, "design.repair.ended", "ended", {
    finalScore: repairResult.data?.qualityScore,
    steps: repairResult.data?.steps?.length
  });

  return {
    deckHtmlDsl: finalHtmls,
    slidesMeta: finalMeta
  };
}

/**
 * 视觉填充阶段处理
 *
 * @param {any} loop
 * @param {{ contentPackage: any, slideIntents: any[], designSystem: any, generated: any[], slideHtmls: string[], slidesMeta: any[], imageSlots: any[], baseDeckHtmlDsl: string, pendingImages: string[], brainstormResult: any, constraints: any, userConfig: any, context: any, runContext: any, emit?: EmitFn, startExecution: StartExecutionFn, finishExecution: FinishExecutionFn, emitDeckUpdate: EmitDeckUpdateFn }} params
 * @returns {Promise<{ deckHtmlDsl: string, slidesMeta: any[], imageSlots: any[], imageReport: any, visualReport: any, refineResult?: any, pendingImages: string[] }>}
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
  // deferredVisuals: 延迟生图模式，只生成占位符不实际渲染
  const deferredVisuals = context?.deferredVisuals === true;

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
      runId: runContext.runId,
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

/**
 * Review 阶段处理 - 全局风格检查
 *
 * @param {any} loop
 * @param {{ deckHtmlDsl: string, slidesMeta: any[], designSystem: any, context: any, runContext: any, emit?: EmitFn }} params
 * @returns {Promise<{ reviewResult: any, fixedDeckHtmlDsl: string, fixes: any[] }>}
 */
export async function runReviewPhase(loop, {
  deckHtmlDsl,
  slidesMeta,
  designSystem,
  context,
  runContext,
  emit,
}) {
  const { runAutoReview } = await import("../reviewer/auto-reviewer.js");

  emitStage(emit, "design.review.started", "started", {
    runId: runContext?.runId,
    slideCount: slidesMeta?.length || 0,
  });

  const deckPackage = { deckHtmlDsl, slidesMeta };
  const reviewResult = await runAutoReview(deckPackage, designSystem, {
    signal: context?.signal,
  });

  // Log to blackboard
  loop._blackboard?.logDecision("review_complete", `Score: ${reviewResult.score}, Issues: ${reviewResult.issues?.length || 0}`);

  emitStage(emit, "design.review.ended", "ended", {
    runId: runContext?.runId,
    score: reviewResult.score,
    pass: reviewResult.pass,
    issueCount: reviewResult.issues?.length || 0,
    summary: reviewResult.summary,
  });

  return {
    reviewResult,
    fixedDeckHtmlDsl: deckHtmlDsl, // 暂不自动修复，返回原始 DSL
    fixes: reviewResult.fixes || [],
  };
}
