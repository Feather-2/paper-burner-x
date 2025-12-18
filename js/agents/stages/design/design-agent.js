import { generateDesignTokens } from "./design-tokens.js";
import { generateDesignSystem } from "./design-system-generator.js";
import { buildSlideHtml } from "./dsl-builder.js";
import { generateBatch } from "./batch-generator.js";
import { validateSlide } from "./qa-validator.js";
import { fillImagePlaceholders } from "./image-generator.js";
import { SVGGenerator, fillSvgPlaceholders } from "./svg-generator.js";
import { fillAssetPlaceholders } from "./asset-resolver.js";
import { VisualRenderer } from "./visual-renderer.js";
import { DSL_RULES } from "./dsl-rules.js";
import { brainstorm } from "./brainstorm.js";
import { normalizeRenderType } from "../../shared/value-utils.js";

const SCHEMA_VERSION = "0.1";

function getEmitFn(ctx) {
  const emit = ctx?.emit || ctx?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(typeof reason === "string" ? reason : "Run cancelled");
}

function hasImagePlanningConfig(constraints) {
  if (!constraints || typeof constraints !== "object") return false;
  return Object.prototype.hasOwnProperty.call(constraints, "imagePolicy") || Object.prototype.hasOwnProperty.call(constraints, "imageBudget");
}

function estimateSlotCostUSD(slot) {
  const style = String(slot?.style || "").toLowerCase();
  if (style.includes("3d") || style.includes("photo") || style.includes("hd") || style.includes("cinematic")) return 0.04;
  return 0.003;
}

function loadDesignConcurrencyConfig() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ppt_designConcurrency') : null;
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

export class DesignStage {
  constructor({ batchSize } = {}) {
    const config = loadDesignConcurrencyConfig();
    const defaultBatchSize = config?.batchSize || 4;
    this.batchSize = Math.max(1, Number(batchSize) || defaultBatchSize);
    this.batchConcurrency = Math.max(1, Number(config?.batchConcurrency) || 2);
    this.imageConcurrency = Math.max(1, Number(config?.imageConcurrency) || 4);
  }

  async _initDesignSystem(contentPackage, context, constraints, userConfig) {
    const modelRouter =
      Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

    let designSystem;
    try {
      designSystem = await generateDesignSystem(
        {
          contentSummary: contentPackage?.summary || "",
          tone: String(constraints?.tone || contentPackage?.constraints?.tone || "neutral"),
          extractedPalette: contentPackage?.constraints?.extractedPalette || constraints?.extractedPalette,
          userPreferences: userConfig,
        },
        { modelRouter, aiApiService: context.aiApiService, signal: context.signal, constraints }
      );
    } catch (e) {
      checkCancelled(context.signal);
      designSystem = generateDesignTokens(constraints);
    }

    if (!designSystem || !designSystem?.designTokens) {
      designSystem = generateDesignTokens(constraints);
    }

    return designSystem;
  }

  _buildVisualSlots(brainstormResult, imageSlots, imageProvider) {
    const candidatesBySlide = Array.isArray(brainstormResult?.candidatesBySlide) ? brainstormResult.candidatesBySlide : [];
    const selectedVisualSlots = candidatesBySlide.flatMap((row) =>
      Array.isArray(row?.selectedCandidate?.visualSlots) ? row.selectedCandidate.visualSlots : []
    );

    // When imageProvider is not available, fallback ai-image slots to svg
    const shouldFallbackToSvg = !imageProvider;
    const mapSlotRenderType = (slot) => {
      const rt = normalizeRenderType(slot?.renderType);
      if (shouldFallbackToSvg && rt === "ai-image") {
        return {
          ...slot,
          renderType: "svg",
          svgSpec: {
            type: slot?.purpose === "chart_fallback" ? "chart" : "diagram",
            description: slot?.imageSpec?.prompt || slot?.promptHint || slot?.purpose || "Visual element",
          },
        };
      }
      return { ...slot, renderType: rt };
    };

    return selectedVisualSlots.length
      ? selectedVisualSlots.map(mapSlotRenderType)
      : imageSlots.map((s) =>
          mapSlotRenderType({
            slotId: s.slotId,
            slideIntentId: s.slideIntentId,
            slideIndex: s.slideIndex,
            renderType: normalizeRenderType(s.renderType),
            priority: s.priority,
            aspectRatio: s.aspectRatio,
            purpose: s.purpose,
            imageSpec: { prompt: s.promptHint, style: s.style },
            ...(s.effects ? { effects: s.effects } : {}),
            ...(s.assetId ? { assetSpec: { assetId: s.assetId } } : {}),
          })
        );
  }

  async _renderVisuals(
    visualSlotsForRender,
    contentPackage,
    designSystem,
    slideHtmls,
    context,
    runContext,
    constraints,
    imageSlots,
    aiImageSlotIds
  ) {
    const emit = getEmitFn(context);
    const modelRouter =
      Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

    let imageReport = null;
    let visualReport = null;
    let finalImageSlots = imageSlots;
    let deckHtmlDsl = slideHtmls.join("\n\n");
    let pendingImages = aiImageSlotIds.slice();

    if (!visualSlotsForRender.length) {
      return { visualReport, imageReport, finalImageSlots, deckHtmlDsl, pendingImages };
    }

    const imageProvider = context.imageProvider || context.imageService;

    try {
      // Build slideHtmlBySlotId map for SVG generator context
      const slideHtmlBySlotId = new Map();
      for (const slot of visualSlotsForRender) {
        const slotId = String(slot?.slotId || "").trim();
        const slideIdx = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : -1;
        if (slotId && slideIdx >= 0 && slideIdx < slideHtmls.length) {
          slideHtmlBySlotId.set(slotId, slideHtmls[slideIdx]);
        }
      }

      const svgGenerator = Object.prototype.hasOwnProperty.call(context || {}, "svgGenerator") ? context.svgGenerator : new SVGGenerator();
      const renderer = new VisualRenderer({
        imageProvider: imageProvider || null,
        svgGenerator,
        assets: Array.isArray(context?.assets) ? context.assets : Array.isArray(contentPackage?.assets) ? contentPackage.assets : null,
      });

      const res = await renderer.render(visualSlotsForRender, contentPackage, designSystem, {
        emit,
        runId: runContext.runId,
        policy: constraints?.imagePolicy,
        budget: constraints?.imageBudget,
        concurrency: this.imageConcurrency,
        svgConcurrency: this.imageConcurrency,
        aiApiService: context.aiApiService,
        modelRouter,
        signal: context.signal,
        slideHtmlBySlotId,
        imageProvider: imageProvider || null,
      });

      if (res?.report?.errors?.length) {
        emitStage(emit, "design.visual.errors", "warn", {
          errors: res.report.errors,
          hasFatalError: res.report.hasFatalError || false,
          svgReport: res.report.svgReport || null,
        });
      }

      visualReport = res?.report ? { ...res.report, errors: Array.isArray(res.report.errors) ? res.report.errors : [] } : null;
      imageReport = res?.imageResults?.report || visualReport?.imageReport || null;

      const filledById = new Map(
        (Array.isArray(res?.imageResults?.filledSlots) ? res.imageResults.filledSlots : []).map((s) => [String(s?.slotId || ""), s])
      );
      if (filledById.size) {
        finalImageSlots = imageSlots.map((s) => (filledById.has(String(s?.slotId || "")) ? filledById.get(String(s?.slotId || "")) : s));
      }

      // Apply fills (ai-image/svg/asset) independently.
      if (Array.isArray(res?.imageResults?.filledSlots) && res.imageResults.filledSlots.length) {
        const filled = fillImagePlaceholders(deckHtmlDsl, res.imageResults.filledSlots);
        deckHtmlDsl = filled.deckHtmlDsl;
        pendingImages = aiImageSlotIds.filter((slotId) => !filled.filledSlotIds.includes(slotId));
      }

      if (Array.isArray(res?.svgResults) && res.svgResults.length) {
        const filledSvg = fillSvgPlaceholders(deckHtmlDsl, res.svgResults);
        deckHtmlDsl = filledSvg.html;
      }

      if (Array.isArray(res?.assetResults) && res.assetResults.length) {
        const filledAssets = fillAssetPlaceholders(deckHtmlDsl, res.assetResults);
        deckHtmlDsl = filledAssets.html;
      }
    } catch (e) {
      checkCancelled(context.signal);
      const errorMessage = e instanceof Error ? e.message : String(e);
      const errors = [{ renderer: "design.visual", error: errorMessage }];

      emitStage(emit, "design.visual.errors", "warn", {
        errors,
        hasFatalError: true,
        svgReport: null,
      });

      imageReport = {
        schemaVersion: "0.1",
        runId: runContext.runId,
        policy: String(constraints?.imagePolicy || "balanced"),
        budget: constraints?.imageBudget || null,
        slots: imageSlots,
        tasks: [],
        summary: { planned: imageSlots.length, attempted: 0, succeeded: 0, failed: imageSlots.length, skipped: 0, totalCostUSD: 0, totalDurationMs: 0 },
        error: errorMessage,
      };

      const planned = { total: visualSlotsForRender.length, "ai-image": 0, svg: 0, asset: 0 };
      for (const slot of visualSlotsForRender) {
        const t = normalizeRenderType(slot?.renderType);
        if (t === "svg") planned.svg += 1;
        else if (t === "asset") planned.asset += 1;
        else planned["ai-image"] += 1;
      }

      visualReport = {
        schemaVersion: "0.1",
        runId: runContext.runId,
        planned,
        completed: { "ai-image": 0, svg: 0, asset: 0 },
        durationMs: 0,
        errors,
        imageReport,
        svgReport: null,
        hasFatalError: true,
      };
    }

    return { visualReport, imageReport, finalImageSlots, deckHtmlDsl, pendingImages };
  }

  async _runRefine(deckPackage, contentPackage, runContext, context, userConfig, emit) {
    const { runReactRefiner } = await import("./react-refiner.js");
    const { createToolExecutor } = await import("./react-refiner-tools.js");

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
        mode: "generation", // generation stage only enables base tools
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
   * Stage interface (Runtime): execute(runContext, contentPackage) -> DeckPackage.
   * @param {object} runContext
   * @param {object} contentPackage ContentPackage v0.1
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object,imageService?:any,imageProvider?:any}=} stageApi
   */
  async execute(runContext, contentPackage, stageApi = {}) {
    return this.run(contentPackage, { ...stageApi, runContext });
  }

  /**
   * Convenience adapter: run(contentPackage, context) -> DeckPackage.
   * @param {object} contentPackage
   * @param {{runContext?:object,emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object,imageService?:any,imageProvider?:any}=} context
   */
  async run(contentPackage, context = {}) {
    const emit = getEmitFn(context);
    const runContext = context.runContext || { runId: contentPackage?.runId || "run_unknown", constraints: contentPackage?.constraints || {} };
    const slideIntents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
    if (slideIntents.length === 0) throw new Error("DesignStage: contentPackage.slideIntents is required");

    const modelRouter =
      Object.prototype.hasOwnProperty.call(context || {}, "modelRouter") ? context.modelRouter : (context?.runContext && context.runContext.modelRouter) || null;

    emitStage(emit, "design.started", "started", { runId: runContext.runId, slideCount: slideIntents.length });
    checkCancelled(context.signal);

    const constraints = runContext.constraints || {};
    const userConfig =
      (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
      (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
      (context && typeof context === "object" ? context.userConfig : undefined) ||
      {};
    // userConfig.refine schema (optional)
    // userConfig.refine = { enabled: false, recommendedSteps: 5, hardLimit: 15 };

    const designSystem = await this._initDesignSystem(contentPackage, context, constraints, userConfig);
    emitStage(emit, "design.tokens.ended", "ended", { theme: designSystem?.theme });
    checkCancelled(context.signal);

    // Brainstorm: generate IdeaPool + ImageSlots
    const brainstormResult = await brainstorm(contentPackage, designSystem, constraints, {
      emit,
      modelRouter,
      aiApiService: context.aiApiService,
      signal: context.signal,
      batchConcurrency: this.batchConcurrency,
    });
    const { ideaPool, selectedIdeas, imageSlots } = brainstormResult;
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
      checkCancelled(context.signal);
    }

    const generated = await generateBatch(slideIntents, contentPackage, designSystem, {
      batchSize: this.batchSize,
      batchConcurrency: this.batchConcurrency,
      modelRouter,
      aiApiService: context.aiApiService,
      imageSlots,
      selectedIdeas: selectedIdeasForPrompt,
      emit,
      signal: context.signal,
      dslRules: DSL_RULES,
    });
    emitStage(emit, "design.generate.ended", "ended", { slides: generated.length });
    checkCancelled(context.signal);

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
        emit?.("design.degraded", { actor: "design", status: "warn", payload: { slideNo, slideIntentId: slideIntent.slideIntentId } });
        slideHtml = buildSlideHtml(slideIntent, designSystem, contentPackage, { safeMode: true, slideNo, imageSlotsForSlide });
        qa = validateSlide(slideHtml);
      }

      if (!qa.pass) {
        // Last-last resort: title-only safe slide.
        degraded = true;
        degradedCount++;
        emit?.("design.degraded", {
          actor: "design",
          status: "warn",
          payload: { slideNo, slideIntentId: slideIntent.slideIntentId, reason: "qa_failed_after_safe" },
        });
        slideHtml = buildSlideHtml({ ...slideIntent, keyPoints: [], claimIds: [] }, designSystem, contentPackage, {
          safeMode: true,
          slideNo,
          imageSlotsForSlide,
        });
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

    let imageReport = null;
    let visualReport = null;
    let refineResult = null;
    let finalImageSlots = imageSlots;
    let deckHtmlDsl = slideHtmls.join("\n\n");

    const imageProvider = context.imageProvider || context.imageService;
    const visualSlotsForRender = this._buildVisualSlots(brainstormResult, imageSlots, imageProvider);
    const aiImageSlotIds = imageSlots.filter((s) => normalizeRenderType(s.renderType) === "ai-image").map((s) => s.slotId);

    const renderOut = await this._renderVisuals(
      visualSlotsForRender,
      contentPackage,
      designSystem,
      slideHtmls,
      context,
      runContext,
      constraints,
      imageSlots,
      aiImageSlotIds
    );

    visualReport = renderOut.visualReport;
    imageReport = renderOut.imageReport;
    finalImageSlots = renderOut.finalImageSlots;
    deckHtmlDsl = renderOut.deckHtmlDsl;
    pendingImages = renderOut.pendingImages;

    // If refine is enabled (userConfig.refine?.enabled), run ReAct loop after VisualRenderer.
    if (userConfig?.refine?.enabled) {
      const deckPackage = { deckHtmlDsl, slidesMeta, designSystem, imageSlots: finalImageSlots };
      const refineOut = await this._runRefine(deckPackage, contentPackage, runContext, context, userConfig, emit);
      deckHtmlDsl = refineOut.deckHtmlDsl;
      slidesMeta = refineOut.slidesMeta;
      refineResult = refineOut.refineResult;
    }

    emitStage(emit, "design.ended", "ended", { slides: slideHtmls.length, degradedCount });

    return {
      schemaVersion: SCHEMA_VERSION,
      runId: runContext.runId,
      designSystem,
      deckHtmlDsl,
      slidesMeta,
      editHints: { degradedCount },
      imageSlots: finalImageSlots,
      imageReport,
      visualReport,
      pendingImages,
      refineReport: refineResult || null,
    };
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runDesignStage(runContext, contentPackage, stageApi = {}) {
  const stage = new DesignStage();
  return stage.execute(runContext, contentPackage, stageApi);
}
