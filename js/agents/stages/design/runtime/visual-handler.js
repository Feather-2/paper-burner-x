/**
 * VisualHandler - 视觉渲染处理器
 *
 * 从 DesignAgentLoop 提取的视觉相关逻辑：
 * - 设计系统初始化
 * - 视觉槽位构建
 * - 视觉渲染/填充
 */

import { generateDesignTokens } from "../generators/design-tokens.js";
import { generateDesignSystem } from "../generators/design-system-generator.js";
import { fillImagePlaceholders } from "../generators/image-generator.js";
import { SVGGenerator, fillSvgPlaceholders } from "../generators/svg-generator.js";
import { fillAssetPlaceholders } from "../image/asset-resolver.js";
import { VisualRenderer } from "../image/visual-renderer.js";
import { normalizeRenderType } from "../../../shared/utils/value-utils.js";
import { checkCancelled, getEmitFn } from "../../../runtime/core/agent-loop.js";

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

export class VisualHandler {
  constructor(options = {}) {
    this.imageConcurrency = options.imageConcurrency || 4;
  }

  /**
   * 初始化设计系统
   */
  async initDesignSystem(contentPackage, context, constraints, userConfig) {
    const modelRouter = context?.modelRouter ?? context?.runContext?.modelRouter ?? null;

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

  /**
   * 构建视觉槽位
   */
  buildVisualSlots(brainstormResult, imageSlots, imageProvider, hasModelCapability = true) {
    if (!imageProvider && !hasModelCapability) {
      return [];
    }

    const candidatesBySlide = Array.isArray(brainstormResult?.candidatesBySlide)
      ? brainstormResult.candidatesBySlide
      : [];
    const selectedVisualSlots = candidatesBySlide.flatMap((row) =>
      Array.isArray(row?.selectedCandidate?.visualSlots) ? row.selectedCandidate.visualSlots : []
    );

    const shouldFallbackToSvg = !imageProvider && hasModelCapability;
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

  /**
   * 渲染视觉元素
   */
  async renderVisuals(
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
    const modelRouter = context?.modelRouter ?? context?.runContext?.modelRouter ?? null;

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
      const slideHtmlBySlotId = new Map();
      for (const slot of visualSlotsForRender) {
        const slotId = String(slot?.slotId || "").trim();
        const slideIdx = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : -1;
        if (slotId && slideIdx >= 0 && slideIdx < slideHtmls.length) {
          slideHtmlBySlotId.set(slotId, slideHtmls[slideIdx]);
        }
      }

      const svgGenerator = context?.svgGenerator ?? new SVGGenerator();
      const renderer = new VisualRenderer({
        imageProvider: imageProvider || null,
        svgGenerator,
        assets: context?.assets ?? contentPackage?.assets ?? null,
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

      visualReport = res?.report
        ? { ...res.report, errors: Array.isArray(res.report.errors) ? res.report.errors : [] }
        : null;
      imageReport = res?.imageResults?.report || visualReport?.imageReport || null;

      const filledById = new Map(
        (res?.imageResults?.filledSlots ?? []).map((s) => [String(s?.slotId || ""), s])
      );
      if (filledById.size) {
        finalImageSlots = imageSlots.map((s) =>
          filledById.has(String(s?.slotId || "")) ? filledById.get(String(s?.slotId || "")) : s
        );
      }

      if (res?.imageResults?.filledSlots?.length) {
        const filled = fillImagePlaceholders(deckHtmlDsl, res.imageResults.filledSlots);
        deckHtmlDsl = filled.deckHtmlDsl;
        pendingImages = aiImageSlotIds.filter((slotId) => !filled.filledSlotIds.includes(slotId));
      }

      if (res?.svgResults?.length) {
        const filledSvg = fillSvgPlaceholders(deckHtmlDsl, res.svgResults);
        deckHtmlDsl = filledSvg.html;
      }

      if (res?.assetResults?.length) {
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
        summary: {
          planned: imageSlots.length,
          attempted: 0,
          succeeded: 0,
          failed: imageSlots.length,
          skipped: 0,
          totalCostUSD: 0,
          totalDurationMs: 0,
        },
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
}

export function createVisualHandler(options = {}) {
  return new VisualHandler(options);
}
