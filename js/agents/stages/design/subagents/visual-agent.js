import { ImageGenerator } from "../generators/image-generator.js";
import { SVGGenerator } from "../generators/svg-generator.js";
import { VisualSlotStatus, visualSlotMachine } from "../states.js";
import { VisualType } from "../constants.js";
import { normalizeRenderType, toNonEmptyString } from "../../../shared/index.js";

/** @type {Set<string>} */
const SVG_VISUAL_TYPES = new Set(
  [
    VisualType.CHART,
    VisualType.DIAGRAM,
    VisualType.INFOGRAPHIC,
    VisualType.DECORATION,
    VisualType.DIVIDER,
    VisualType.BACKGROUND_GRADIENT,
    VisualType.BACKGROUND_PATTERN,
    VisualType.SVG,
  ].map(String)
);

/** @type {Set<string>} */
const AI_IMAGE_VISUAL_TYPES = new Set(
  [VisualType.ILLUSTRATION, VisualType.PHOTO, VisualType.ICON, VisualType.BACKGROUND_IMAGE].map(String)
);

function normalizeAssetUri(asset) {
  const uri =
    toNonEmptyString(asset?.assetUri) ||
    toNonEmptyString(asset?.uri) ||
    toNonEmptyString(asset?.url) ||
    toNonEmptyString(asset?.src);
  if (uri) return uri;
  const data = toNonEmptyString(asset?.data);
  if (!data) return "";
  if (data.startsWith("data:")) return data;
  const mimeType = toNonEmptyString(asset?.mimeType) || "image/png";
  return `data:${mimeType};base64,${data}`;
}

function extractDims(asset) {
  const w = Number(asset?.width ?? asset?.w ?? asset?.metadata?.width);
  const h = Number(asset?.height ?? asset?.h ?? asset?.metadata?.height);
  return {
    width: Number.isFinite(w) && w > 0 ? w : null,
    height: Number.isFinite(h) && h > 0 ? h : null,
  };
}

function aspectRatioFromPosition(position) {
  const wPct = parsePercent(position?.w);
  const hPct = parsePercent(position?.h);
  if (wPct === null || hPct === null || hPct === 0) return "";
  const r = wPct / hPct;
  if (r > 1.55) return "16:9";
  if (r > 1.15) return "4:3";
  if (r > 0.9 && r < 1.1) return "1:1";
  return r >= 1 ? "4:3" : "3:4";
}

function parsePercent(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+(\.\d+)?)%$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function inferRenderTypeFromVisualType(type) {
  const raw = toNonEmptyString(type);
  if (!raw) return "";
  const t = raw.toLowerCase();
  if (SVG_VISUAL_TYPES.has(t)) return "svg";
  if (AI_IMAGE_VISUAL_TYPES.has(t)) return "ai-image";
  return "";
}

function inferPurpose(slot) {
  const slotId = toNonEmptyString(slot?.slotId).toLowerCase();
  if (slotId.includes("hero") || slotId.includes("cover")) return "hero";
  if (slotId.includes("icon")) return "icon";
  if (slotId.includes("bg") || slotId.includes("background")) return "background";
  if (slotId.includes("chart") || slotId.includes("fig") || slotId.includes("diagram")) return "chart_fallback";
  return "illustration";
}

function visualSlotToImageSlot(slot) {
  const slotId = toNonEmptyString(slot?.slotId);
  if (!slotId) return null;

  const promptHint =
    toNonEmptyString(slot?.imageSpec?.prompt) ||
    toNonEmptyString(slot?.promptHint) ||
    toNonEmptyString(slot?.svgSpec?.description) ||
    toNonEmptyString(slot?.assetSpec?.caption) ||
    toNonEmptyString(slot?.description) ||
    slotId;

  const aspectRatio = toNonEmptyString(slot?.aspectRatio) || aspectRatioFromPosition(slot?.position) || "16:9";
  const style = toNonEmptyString(slot?.imageSpec?.style) || toNonEmptyString(slot?.style) || "illustration";
  const slideIndex = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : 0;
  const slideIntentId = toNonEmptyString(slot?.slideIntentId) || `s${slideIndex}`;

  return {
    slotId,
    slideIntentId,
    slideIndex,
    purpose: inferPurpose(slot),
    promptHint,
    style,
    aspectRatio,
    ...(Array.isArray(slot?.claimIds) && slot.claimIds.length ? { claimIds: slot.claimIds.map((c) => String(c)).filter(Boolean) } : {}),
    ...(slot?.effects && typeof slot.effects === "object" ? { effects: { ...slot.effects } } : {}),
    renderType: "ai-image",
  };
}

function ensureSvgSpec(slot) {
  if (slot.svgSpec && typeof slot.svgSpec === "object") return slot;
  const type = toNonEmptyString(slot?.type || slot?.visualType || slot?.visualKind) || "illustration";
  const description =
    toNonEmptyString(slot?.svgSpec?.description) ||
    toNonEmptyString(slot?.description) ||
    toNonEmptyString(slot?.promptHint) ||
    toNonEmptyString(slot?.imageSpec?.prompt) ||
    type;
  return { ...slot, svgSpec: { type, description } };
}

function resolveSlotRenderType(slot, assetRegistry) {
  const assetId =
    toNonEmptyString(slot?.assetSpec?.assetId) ||
    toNonEmptyString(slot?.assetId) ||
    toNonEmptyString(slot?.preferAsset);

  if (assetId && assetRegistry?.getAsset) {
    const asset = assetRegistry.getAsset(assetId);
    if (asset) return { renderType: "asset", assetId, asset };
  }

  const explicit = toNonEmptyString(slot?.renderType);
  if (explicit) return { renderType: normalizeRenderType(explicit), assetId };

  if (slot?.svgSpec) return { renderType: "svg", assetId };

  const typeHint = inferRenderTypeFromVisualType(slot?.type || slot?.visualType || slot?.visualKind);
  if (typeHint) return { renderType: typeHint, assetId };

  return { renderType: "ai-image", assetId };
}

export class VisualSubAgent {
  /**
   * @param {{ assetRegistry?: any, imageGenerator?: ImageGenerator | null, imageProvider?: any, svgGenerator?: SVGGenerator | null }} [options]
   */
  constructor({ assetRegistry, imageGenerator, imageProvider, svgGenerator } = {}) {
    this.assetRegistry = assetRegistry || null;
    this.imageGenerator = imageGenerator || (imageProvider ? new ImageGenerator({ imageProvider }) : null);
    this.svgGenerator = svgGenerator || null;
    this.transitionLog = [];
  }

  /**
   * @returns {any[]}
   */
  getTransitionLog() {
    return [...this.transitionLog];
  }

  /**
   * @returns {void}
   */
  clearTransitionLog() {
    this.transitionLog = [];
  }

  /**
   * @param {any} slot
   * @param {string} to
   * @param {Record<string, any>} [context]
   * @returns {boolean}
   */
  _transitionSlot(slot, to, context = {}) {
    const from = slot.status || VisualSlotStatus.PENDING;
    const ok = visualSlotMachine.transition(slot, to, context);
    if (ok) this.transitionLog.push({ slotId: slot.slotId, from, to, context });
    return ok;
  }

  /**
   * @param {any[]} visualSlots
   * @param {any} designSystem
   * @param {any} [contentPackage]
   * @param {Record<string, any>} [options]
   * @returns {Promise<any>}
   */
  async run(visualSlots, designSystem, contentPackage = {}, options = {}) {
    const slotsInput = Array.isArray(visualSlots) ? visualSlots : [];
    const assetRegistry = options.assetRegistry || this.assetRegistry;
    const imageGenerator = options.imageGenerator || this.imageGenerator || (options.imageProvider ? new ImageGenerator({ imageProvider: options.imageProvider }) : null);
    const svgGenerator = options.svgGenerator || this.svgGenerator || null;

    const slots = slotsInput.map((s) => ({ ...(s || {}), status: s?.status || VisualSlotStatus.PENDING }));
    for (const slot of slots) {
      this._transitionSlot(slot, VisualSlotStatus.QUEUED, { slotId: slot.slotId });
    }

    const resolved = slots.map((slot) => {
      const { renderType, assetId, asset } = resolveSlotRenderType(slot, assetRegistry);
      const next = { ...slot, renderType };
      if (assetId && !next.assetId) next.assetId = assetId;
      if (asset && !next.assetSpec) next.assetSpec = { assetId };
      return next;
    });

    let aiImageSlots = resolved.filter((s) => s.renderType === "ai-image");
    let svgSlots = resolved.filter((s) => s.renderType === "svg");
    for (const slot of svgSlots) Object.assign(slot, ensureSvgSpec(slot));
    let assetSlots = resolved.filter((s) => s.renderType === "asset");

    if (!imageGenerator && svgGenerator && aiImageSlots.length) {
      for (const slot of aiImageSlots) {
        slot.renderType = "svg";
        Object.assign(slot, ensureSvgSpec(slot));
        svgSlots.push(slot);
      }
      aiImageSlots = [];
    }

    const errors = [];

    for (const slot of aiImageSlots) this._transitionSlot(slot, VisualSlotStatus.GENERATING, { slotId: slot.slotId });
    for (const slot of svgSlots) this._transitionSlot(slot, VisualSlotStatus.GENERATING, { slotId: slot.slotId });
    for (const slot of assetSlots) this._transitionSlot(slot, VisualSlotStatus.GENERATING, { slotId: slot.slotId });

    const imagePromise = aiImageSlots.length && imageGenerator
      ? imageGenerator.generate(aiImageSlots.map(visualSlotToImageSlot).filter(Boolean), contentPackage, designSystem, {
        emit: options.emit,
        runId: options.runId,
        policy: options.policy,
        budget: options.budget,
        concurrency: options.imageConcurrency,
        circuitBreakerRegistry: options.circuitBreakerRegistry,
        imageProvider: options.imageProvider,
      })
      : Promise.resolve({ filledSlots: [], report: null });

    const svgPromise = svgSlots.length && svgGenerator
      ? svgGenerator.generate(svgSlots, designSystem, {
        emit: options.emit,
        aiApiService: options.aiApiService,
        modelRouter: options.modelRouter,
        signal: options.signal,
        slideHtmlBySlotId: options.slideHtmlBySlotId,
        concurrency: options.svgConcurrency,
      })
      : Promise.resolve({ results: [], report: null });

    const [imageSettled, svgSettled] = await Promise.allSettled([imagePromise, svgPromise]);

    const imageResults = imageSettled.status === "fulfilled"
      ? imageSettled.value
      : (errors.push({ type: "ai-image", message: String(imageSettled.reason || "Unknown error") }), { filledSlots: [], report: null });

    const svgResults = svgSettled.status === "fulfilled"
      ? svgSettled.value
      : (errors.push({ type: "svg", message: String(svgSettled.reason || "Unknown error") }), { results: [], report: null });

    const filledImageById = new Map(
      (Array.isArray(imageResults?.filledSlots) ? imageResults.filledSlots : [])
        .map((slot) => [toNonEmptyString(slot?.slotId), slot])
        .filter((row) => row[0])
    );

    for (const slot of aiImageSlots) {
      if (filledImageById.has(toNonEmptyString(slot?.slotId))) this._transitionSlot(slot, VisualSlotStatus.FILLED, { slotId: slot.slotId });
      else this._transitionSlot(slot, VisualSlotStatus.FAILED, { slotId: slot.slotId });
    }

    const svgById = new Map(
      (Array.isArray(svgResults?.results) ? svgResults.results : [])
        .map((slot) => [toNonEmptyString(slot?.slotId), slot])
        .filter((row) => row[0])
    );

    for (const slot of svgSlots) {
      const result = svgById.get(toNonEmptyString(slot?.slotId));
      if (result?.svgContent) this._transitionSlot(slot, VisualSlotStatus.FILLED, { slotId: slot.slotId });
      else this._transitionSlot(slot, VisualSlotStatus.FAILED, { slotId: slot.slotId });
    }

    const assetResults = [];
    for (const slot of assetSlots) {
      const slotId = toNonEmptyString(slot?.slotId);
      const assetId = toNonEmptyString(slot?.assetSpec?.assetId) || toNonEmptyString(slot?.assetId) || "";
      const asset = assetId && assetRegistry?.getAsset ? assetRegistry.getAsset(assetId) : null;
      const assetUri = asset ? normalizeAssetUri(asset) : "";
      if (slotId && assetUri) {
        const dims = extractDims(asset);
        assetResults.push({ slotId, assetId, assetUri, width: dims.width, height: dims.height });
        this._transitionSlot(slot, VisualSlotStatus.FILLED, { slotId: slot.slotId });
      } else {
        if (assetId && !asset) errors.push({ type: "asset", message: `Missing asset: ${assetId}`, slotId });
        this._transitionSlot(slot, VisualSlotStatus.FAILED, { slotId: slot.slotId });
      }
    }

    const report = {
      planned: { total: resolved.length, "ai-image": aiImageSlots.length, svg: svgSlots.length, asset: assetSlots.length },
      completed: {
        "ai-image": Array.isArray(imageResults?.filledSlots) ? imageResults.filledSlots.length : 0,
        svg: Array.isArray(svgResults?.results) ? svgResults.results.length : 0,
        asset: assetResults.length,
      },
      errors,
      imageReport: imageResults?.report || null,
      svgReport: svgResults?.report || null,
    };

    return {
      slots: resolved,
      imageResults,
      svgResults,
      assetResults,
      report,
    };
  }
}
