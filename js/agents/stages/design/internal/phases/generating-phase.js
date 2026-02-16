import { buildSlideHtml } from "../../dsl/dsl-builder.js";
import { getDslRules } from "../../dsl/dsl-rules.js";
import { ImagePlanner } from "../../image/image-planner.js";
import { validateSlide } from "../../refiner/qa-validator.js";
import { escapeHtml } from "../../shared/design-utils.js";
import { DesignPhase } from "../../states.js";
import { emitStage } from "../../design-helpers.js";
import { checkCancelled } from "../../../../runtime/index.js";
import { createLinkedSignal } from "../../../../shared/utils/cancellation.js";
import { DESIGN_PHASE_DEFAULTS, runWithPhaseSpan } from "./phase-utils.js";

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
 * @typedef {object} GeneratingPhaseParams
 * @property {any[]=} slideIntents
 * @property {any=} contentPackage
 * @property {any=} designSystem
 * @property {any=} constraints
 * @property {any=} userConfig
 * @property {any} context
 * @property {any} runContext
 * @property {EmitFn=} emit
 * @property {StartExecutionFn} startExecution
 * @property {FinishExecutionFn} finishExecution
 * @property {any=} traceContext
 * @property {boolean=} skipReview
 */

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

const DEFAULT_SPAWN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 生成阶段处理
 *
 * @param {any} loop
 * @param {GeneratingPhaseParams} params
 * @returns {Promise<{ generated: any[], slideHtmls: string[], slidesMeta: any[], imageSlots: any[], brainstormResult: any, pendingImages: string[], baseDeckHtmlDsl: string, degradedCount: number, styleLock: any }>}
 */
export async function runGeneratingPhase(loop, {
  slideIntents: providedSlideIntents,
  contentPackage: providedContentPackage,
  designSystem: providedDesignSystem,
  constraints: providedConstraints,
  userConfig: providedUserConfig,
  context,
  runContext,
  emit,
  startExecution,
  finishExecution,
  traceContext,
  skipReview,
}) {
  const runId = runContext?.runId;
  const state = loop.state && typeof loop.state === "object" ? loop.state : {};
  const slideIntents = Array.isArray(providedSlideIntents)
    ? providedSlideIntents
    : Array.isArray(state.slideIntents)
      ? state.slideIntents
      : [];
  const contentPackage = providedContentPackage ?? state.contentPackage;
  const designSystem = providedDesignSystem ?? state.designSystem;
  const constraints = providedConstraints ?? state.constraints ?? {};
  let userConfig = providedUserConfig ?? state.userConfig ?? {};

  const canApplyUserInputs = typeof loop.messageHandling?.applyUserInputsToConfig === "function";
  if (canApplyUserInputs) {
    userConfig = loop.messageHandling.applyUserInputsToConfig(userConfig);
  }
  state.userConfig = userConfig;

  const runPhase = async () => {
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

    const timeoutCandidate = Number.isFinite(runContext?.timeoutMs)
      ? runContext.timeoutMs
      : Number.isFinite(context?.timeoutMs)
        ? context.timeoutMs
        : DEFAULT_SPAWN_TIMEOUT_MS;
    const timeoutMs = Math.max(0, Math.floor(timeoutCandidate));
    const spawnSignal = timeoutMs > 0 ? createLinkedSignal(generatingContext.signal, timeoutMs) : generatingContext.signal;

    const genResult = await loop.toolDispatch._callTool(
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
        signal: spawnSignal,
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
      loop.phaseRunner._transitionPhase(loop.phase, DesignPhase.REVIEWING, { emit, runId });
    }

    // Update state with generated HTMLs for the tools to see
    let slideHtmls = generated.map((g) => g.slideHtml);
    /** @type {SlideMeta[]} */
    let slidesMeta = slideIntents.map((intent, i) => ({
      slideNo: i + 1,
      slideIntentId: intent.slideIntentId,
      pageType: intent.pageType,
      title: intent.title,
      qa: validateSlide(slideHtmls[i]),
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
    if (designSystem && typeof designSystem === "object") {
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
      styleLock,
    };
  };

  const genOut = await runWithPhaseSpan(
    traceContext,
    "design.phase.generating",
    { runId, slideCount: slideIntents.length, skipReview: !!skipReview },
    runPhase
  );

  state.generated = genOut.generated;
  state.slideHtmls = genOut.slideHtmls;
  state.slidesMeta = genOut.slidesMeta;
  state.imageSlots = genOut.imageSlots;
  state.baseDeckHtmlDsl = genOut.baseDeckHtmlDsl;
  state.pendingImages = genOut.pendingImages;
  state.brainstormResult = genOut.brainstormResult;
  state.degradedCount = genOut.degradedCount;

  if (canApplyUserInputs) {
    state.userConfig = loop.messageHandling.applyUserInputsToConfig(state.userConfig);
  }

  return genOut;
}
