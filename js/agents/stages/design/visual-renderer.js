import { ImageGenerator } from "./image-generator.js";
import { SVGGenerator } from "./svg-generator.js";
import { AssetResolver } from "./asset-resolver.js";
import { RenderType, EventStatus, SlotPriority, SlotPurpose } from "./constants.js";
import { DesignEvents } from "./events.js";
import { normalizeRenderType } from "../../shared/value-utils.js";

function nowMs() {
  return Date.now();
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeEmit(emit, name, status, payload) {
  if (typeof emit !== "function") return;
  emit(name, { actor: "design", status, payload });
}

function parsePercent(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+(\.\d+)?)%$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
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

function normalizePriority(p) {
  const s = String(p || "").trim().toLowerCase();
  if (s === SlotPriority.CRITICAL) return SlotPriority.CRITICAL;
  if (s === SlotPriority.IMPORTANT) return SlotPriority.IMPORTANT;
  if (s === SlotPriority.OPTIONAL) return SlotPriority.OPTIONAL;
  return SlotPriority.IMPORTANT;
}

function inferPurpose(slot) {
  const slotId = toNonEmptyString(slot?.slotId).toLowerCase();
  const explicit = toNonEmptyString(slot?.purpose);
  if (explicit) return explicit;
  if (slotId.includes("hero") || slotId.includes("cover")) return SlotPurpose.HERO;
  if (slotId.includes("icon")) return SlotPurpose.ICON;
  if (slotId.includes("bg") || slotId.includes("background")) return SlotPurpose.BACKGROUND;
  if (slotId.includes("chart") || slotId.includes("fig") || slotId.includes("diagram")) return SlotPurpose.CHART_FALLBACK;
  return SlotPurpose.ILLUSTRATION;
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
  const priority = normalizePriority(slot?.priority);
  const slideIndex = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : 0;
  const slideIntentId = toNonEmptyString(slot?.slideIntentId) || `s${slideIndex}`;

  return {
    slotId,
    slideIntentId,
    slideIndex,
    purpose: inferPurpose(slot),
    promptHint,
    style,
    priority,
    aspectRatio,
    ...(Array.isArray(slot?.claimIds) && slot.claimIds.length ? { claimIds: slot.claimIds.map((c) => String(c)).filter(Boolean) } : {}),
    ...(slot?.effects && typeof slot.effects === "object" ? { effects: { ...slot.effects } } : {}),
    renderType: RenderType.AI_IMAGE,
  };
}

function mergeFilledImageSlots(allSlots, filledImageSlots) {
  const base = Array.isArray(allSlots) ? allSlots : [];
  const filled = Array.isArray(filledImageSlots) ? filledImageSlots : [];
  if (base.length === 0) return filled;
  if (filled.length === 0) return base.slice();

  const byId = new Map(filled.map((s) => [toNonEmptyString(s?.slotId), s]).filter((row) => row[0]));
  return base.map((s) => {
    const id = toNonEmptyString(s?.slotId);
    if (!id || !byId.has(id)) return s;
    return byId.get(id);
  });
}

export class VisualRenderer {
  constructor({ imageGenerator, imageProvider, svgGenerator, assets, assetResolver } = {}) {
    this.imageGenerator = imageGenerator || (imageProvider ? new ImageGenerator({ imageProvider }) : null);
    this.svgGenerator = svgGenerator || null;
    this.assetResolver = assetResolver || (assets ? new AssetResolver(assets) : null);
  }

  async render(visualSlots, contentPackage, designSystem, options = {}) {
    const t0 = nowMs();
    const emit = typeof options?.emit === "function" ? options.emit : null;
    const runId = toNonEmptyString(options?.runId) || toNonEmptyString(contentPackage?.runId) || `run_${Math.random().toString(16).slice(2)}`;

    const slotsRaw = Array.isArray(visualSlots) ? visualSlots : [];
    const slots = slotsRaw
      .map((s) => (s && typeof s === "object" ? { ...s, renderType: normalizeRenderType(s.renderType) } : null))
      .filter(Boolean);

    const aiImageSlots = slots.filter((s) => s.renderType === RenderType.AI_IMAGE);
    const svgSlots = slots.filter((s) => s.renderType === RenderType.SVG);
    const assetSlots = slots.filter((s) => s.renderType === RenderType.ASSET);

    safeEmit(emit, DesignEvents.VISUAL_RENDER_STARTED, EventStatus.STARTED, {
      runId,
      planned: { total: slots.length, "ai-image": aiImageSlots.length, svg: svgSlots.length, asset: assetSlots.length },
    });

    const imageGenerator = options?.imageGenerator || this.imageGenerator;
    const svgGenerator = options?.svgGenerator || this.svgGenerator;
    const assetResolver =
      options?.assetResolver ||
      this.assetResolver ||
      (Array.isArray(options?.assets) ? new AssetResolver(options.assets) : null) ||
      (Array.isArray(contentPackage?.assets) ? new AssetResolver(contentPackage.assets) : null);

    const imageBudget = options?.budget || options?.imageBudget || contentPackage?.constraints?.imageBudget || null;
    const imagePolicy = options?.policy || options?.imagePolicy || contentPackage?.constraints?.imagePolicy || null;
    const concurrency = Math.max(1, safeNumber(options?.concurrency, 2));

    const aiImageSlotsForGenerator = aiImageSlots.map(visualSlotToImageSlot).filter(Boolean);

    const settled = await Promise.allSettled([
      aiImageSlotsForGenerator.length && imageGenerator
        ? imageGenerator.generate(aiImageSlotsForGenerator, contentPackage, designSystem, {
            emit,
            runId,
            policy: imagePolicy,
            budget: imageBudget,
            concurrency,
            imageProvider: options?.imageProvider,
          })
        : Promise.resolve({ filledSlots: [], report: null }),
      svgSlots.length && svgGenerator
        ? svgGenerator.generate(svgSlots, designSystem, {
            emit,
            aiApiService: options?.aiApiService,
            modelRouter: options?.modelRouter,
            signal: options?.signal,
            slideHtmlBySlotId: options?.slideHtmlBySlotId,
            concurrency: options?.svgConcurrency || options?.concurrency,
          })
        : Promise.resolve({ results: [], report: null }),
      assetSlots.length && assetResolver ? Promise.resolve(assetResolver.resolve(assetSlots)) : Promise.resolve([]),
    ]);

    const errors = [];
    const imageResults = settled[0].status === "fulfilled" ? settled[0].value : (errors.push({ renderer: "ai-image", error: String(settled[0].reason) }), { filledSlots: [], report: null });
    const svgOut = settled[1].status === "fulfilled" ? settled[1].value : (errors.push({ renderer: "svg", error: String(settled[1].reason) }), { results: [], report: null });
    const svgResults = Array.isArray(svgOut?.results) ? svgOut.results : [];
    const svgReport = svgOut?.report || null;
    const assetResults = settled[2].status === "fulfilled" ? settled[2].value : (errors.push({ renderer: "asset", error: String(settled[2].reason) }), []);

    const mergedSlots = mergeFilledImageSlots(slotsRaw, imageResults?.filledSlots);
    const t1 = nowMs();

    const report = {
      schemaVersion: "0.1",
      runId,
      planned: { total: slots.length, "ai-image": aiImageSlots.length, svg: svgSlots.length, asset: assetSlots.length },
      completed: {
        "ai-image": Array.isArray(imageResults?.filledSlots) ? imageResults.filledSlots.length : 0,
        svg: Array.isArray(svgResults) ? svgResults.length : 0,
        asset: Array.isArray(assetResults) ? assetResults.length : 0,
      },
      durationMs: Math.max(0, t1 - t0),
      errors,
      imageReport: imageResults?.report || null,
      svgReport,
    };

    if (errors.length) {
      safeEmit(emit, DesignEvents.VISUAL_RENDER_FAILED, EventStatus.FAILED, { runId, report });
    } else {
      safeEmit(emit, DesignEvents.VISUAL_RENDER_COMPLETED, EventStatus.COMPLETED, { runId, report });
    }

    return { imageResults, svgResults, assetResults, report, mergedSlots };
  }
}

