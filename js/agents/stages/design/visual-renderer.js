import { ImageGenerator } from "./image-generator.js";
import { SVGGenerator } from "./svg-generator.js";
import { AssetResolver } from "./asset-resolver.js";

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

function normalizeRenderType(rt) {
  const t = String(rt || "").trim().toLowerCase();
  if (t === "ai-image" || t === "ai_image" || t === "image") return "ai-image";
  if (t === "svg") return "svg";
  if (t === "asset" || t === "doc-asset" || t === "document-asset") return "asset";
  return "ai-image";
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
  if (s === "critical" || s === "important" || s === "optional") return s;
  return "important";
}

function inferPurpose(slot) {
  const slotId = toNonEmptyString(slot?.slotId).toLowerCase();
  const explicit = toNonEmptyString(slot?.purpose);
  if (explicit) return explicit;
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
    renderType: "ai-image",
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

    const aiImageSlots = slots.filter((s) => s.renderType === "ai-image");
    const svgSlots = slots.filter((s) => s.renderType === "svg");
    const assetSlots = slots.filter((s) => s.renderType === "asset");

    safeEmit(emit, "design.visual.render.started", "started", {
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
        ? svgGenerator.generate(svgSlots, designSystem, { emit, aiApiService: options?.aiApiService })
        : Promise.resolve([]),
      assetSlots.length && assetResolver ? Promise.resolve(assetResolver.resolve(assetSlots)) : Promise.resolve([]),
    ]);

    const errors = [];
    const imageResults = settled[0].status === "fulfilled" ? settled[0].value : (errors.push({ renderer: "ai-image", error: String(settled[0].reason) }), { filledSlots: [], report: null });
    const svgResults = settled[1].status === "fulfilled" ? settled[1].value : (errors.push({ renderer: "svg", error: String(settled[1].reason) }), []);
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
    };

    if (errors.length) {
      safeEmit(emit, "design.visual.render.failed", "failed", { runId, report });
    } else {
      safeEmit(emit, "design.visual.render.completed", "completed", { runId, report });
    }

    return { imageResults, svgResults, assetResults, report, mergedSlots };
  }
}

