import { generateDesignTokens } from "./design-tokens.js";
import { generateDesignSystem } from "./design-system-generator.js";
import { buildSlideHtml } from "./dsl-builder.js";
import { generateBatch } from "./batch-generator.js";
import { validateSlide } from "./qa-validator.js";
import { ImagePlanner } from "./image-planner.js";

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

export class DesignStage {
  constructor({ batchSize = 4 } = {}) {
    this.batchSize = batchSize;
  }

  /**
   * Stage interface (Runtime): execute(runContext, contentPackage) -> DeckPackage.
   * @param {object} runContext
   * @param {object} contentPackage ContentPackage v0.1
   * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object}=} stageApi
   */
  async execute(runContext, contentPackage, stageApi = {}) {
    return this.run(contentPackage, { ...stageApi, runContext });
  }

  /**
   * Convenience adapter: run(contentPackage, context) -> DeckPackage.
   * @param {object} contentPackage
   * @param {{runContext?:object,emit?:Function,eventBus?:object,signal?:AbortSignal,aiApiService?:object}=} context
   */
  async run(contentPackage, context = {}) {
    const emit = getEmitFn(context);
    const runContext = context.runContext || { runId: contentPackage?.runId || "run_unknown", constraints: contentPackage?.constraints || {} };
    const slideIntents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
    if (slideIntents.length === 0) throw new Error("DesignStage: contentPackage.slideIntents is required");

    emitStage(emit, "design.started", "started", { runId: runContext.runId, slideCount: slideIntents.length });
    checkCancelled(context.signal);

    const constraints = runContext.constraints || {};
    const userConfig =
      (runContext && typeof runContext === "object" ? runContext.userConfig : undefined) ||
      (contentPackage && typeof contentPackage === "object" ? contentPackage.userConfig : undefined) ||
      (context && typeof context === "object" ? context.userConfig : undefined) ||
      {};

    let designSystem;
    try {
      designSystem = await generateDesignSystem(
        {
          contentSummary: contentPackage?.summary || "",
          tone: String(constraints?.tone || contentPackage?.constraints?.tone || "neutral"),
          extractedPalette: contentPackage?.constraints?.extractedPalette || constraints?.extractedPalette,
          userPreferences: userConfig,
        },
        { aiApiService: context.aiApiService, signal: context.signal, constraints }
      );
    } catch (e) {
      checkCancelled(context.signal);
      designSystem = generateDesignTokens(constraints);
    }

    if (!designSystem || !designSystem?.designTokens) {
      designSystem = generateDesignTokens(constraints);
    }
    emitStage(emit, "design.tokens.ended", "ended", { theme: designSystem?.theme });
    checkCancelled(context.signal);

    const imageSlots = hasImagePlanningConfig(constraints) ? ImagePlanner.plan(slideIntents, designSystem, constraints) : [];
    const pendingImages = imageSlots.map((s) => s.slotId);
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
      aiApiService: context.aiApiService,
      imageSlots,
      emit,
      signal: context.signal,
    });
    emitStage(emit, "design.generate.ended", "ended", { slides: generated.length });
    checkCancelled(context.signal);

    const slidesMeta = [];
    const slideHtmls = [];
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

    emitStage(emit, "design.qa.ended", "ended", { slides: slideHtmls.length, degradedCount });
    emitStage(emit, "design.ended", "ended", { slides: slideHtmls.length, degradedCount });

    return {
      schemaVersion: SCHEMA_VERSION,
      runId: runContext.runId,
      designSystem,
      deckHtmlDsl: slideHtmls.join("\n\n"),
      slidesMeta,
      editHints: { degradedCount },
      imageSlots,
      imageReport: null,
      pendingImages,
    };
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runDesignStage(runContext, contentPackage, stageApi = {}) {
  const stage = new DesignStage();
  return stage.execute(runContext, contentPackage, stageApi);
}
