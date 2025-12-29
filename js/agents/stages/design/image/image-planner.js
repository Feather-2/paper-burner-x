import { VisualHeuristics } from "../constants.js";

function normalizeImagePolicy(policy) {
  const p = String(policy || "balanced").toLowerCase();
  if (p === "rich" || p === "balanced" || p === "minimal" || p === "none") return p;
  return "balanced";
}

function normalizeBudget(imageBudget = {}) {
  const maxImages = Number(imageBudget?.maxImages);
  const maxCostUSD = Number(imageBudget?.maxCostUSD);

  return {
    maxImages: Number.isFinite(maxImages) && maxImages >= 0 ? maxImages : 5,
    maxCostUSD: Number.isFinite(maxCostUSD) && maxCostUSD >= 0 ? maxCostUSD : 1.0,
  };
}

function priorityRank(priority) {
  if (priority === "critical") return 0;
  if (priority === "important") return 1;
  return 2;
}

function buildPromptHint(slideIntent) {
  const title = String(slideIntent?.title || "").trim();
  const objective = String(slideIntent?.objective || "").trim();
  const keyPoints = Array.isArray(slideIntent?.keyPoints) ? slideIntent.keyPoints.map((s) => String(s).trim()).filter(Boolean) : [];

  const parts = [];
  if (title) parts.push(title);
  if (objective) parts.push(objective);
  if (keyPoints.length) parts.push(keyPoints.slice(0, 2).join("; "));

  return parts.join(" — ") || "A slide illustration that matches the slide content.";
}

function defaultStyleForPriority(priority) {
  return priority === "optional" ? "flat" : "3d";
}

function estimateCostUSD(style) {
  const s = String(style || "").toLowerCase();
  if (s.includes("3d") || s.includes("photo") || s.includes("hd") || s.includes("cinematic")) return VisualHeuristics.COST_HD_IMAGE;
  return VisualHeuristics.COST_STANDARD_IMAGE;
}

function totalEstimatedCostUSD(slots) {
  return slots.reduce((sum, slot) => sum + estimateCostUSD(slot.style), 0);
}

function downgradeImportantStyleToEconomy(slots) {
  for (const slot of slots) {
    if (slot.priority === "important") slot.style = "flat";
  }
}

function trimToMaxImages(slots, maxImages) {
  if (!Number.isFinite(maxImages) || maxImages < 0) return slots;
  return slots.slice(0, maxImages);
}

function applyBudgetTrim(slots, budget) {
  if (!slots.length) return slots;
  if (!Number.isFinite(budget?.maxCostUSD)) return slots;

  let cost = totalEstimatedCostUSD(slots);
  if (cost <= budget.maxCostUSD) return slots;

  // 1) Remove optional
  const withoutOptional = slots.filter((s) => s.priority !== "optional");
  cost = totalEstimatedCostUSD(withoutOptional);
  if (cost <= budget.maxCostUSD) return withoutOptional;

  // 2) Downgrade important (cheaper provider tier approximated via simpler style)
  downgradeImportantStyleToEconomy(withoutOptional);
  cost = totalEstimatedCostUSD(withoutOptional);
  if (cost <= budget.maxCostUSD) return withoutOptional;

  // 3) Still over budget: remove some important from the end, keep critical always.
  const critical = withoutOptional.filter((s) => s.priority === "critical");
  const important = withoutOptional.filter((s) => s.priority === "important").slice().reverse();
  const keptImportant = [];

  for (const slot of important) {
    keptImportant.push(slot);
    const candidate = [...critical, ...keptImportant];
    if (totalEstimatedCostUSD(candidate) > budget.maxCostUSD) {
      keptImportant.pop();
      break;
    }
  }

  return [...critical, ...keptImportant].sort((a, b) => a.slideIndex - b.slideIndex);
}

function pageTypeToSlotSpec(pageType) {
  const pt = String(pageType || "").toLowerCase();
  if (pt === "cover") return { purpose: "hero", priority: "critical", aspectRatio: "16:9" };
  if (pt === "overview" || pt === "summary") return { purpose: "illustration", priority: "important", aspectRatio: "4:3" };
  if (pt === "comparison" || pt === "process") return { purpose: "chart_fallback", priority: "optional", aspectRatio: "16:9" };
  if (pt === "appendix") return null;
  return null;
}

export class ImagePlanner {
  /**
   * @param {Array<object>} slideIntents
   * @param {object} designSystem
   * @param {object} constraints
   * @returns {Array<object>} ImageSlot[]
   */
  static plan(slideIntents = [], designSystem = {}, constraints = {}) {
    if (!Array.isArray(slideIntents) || slideIntents.length === 0) return [];

    const imagePolicy = normalizeImagePolicy(constraints?.imagePolicy);
    if (imagePolicy === "none") return [];

    const budget = normalizeBudget(constraints?.imageBudget);
    const candidates = [];

    for (let i = 0; i < slideIntents.length; i++) {
      const si = slideIntents[i] || {};
      const spec = pageTypeToSlotSpec(si.pageType);
      if (!spec) continue;

      const claimIds = Array.isArray(si.claimIds) ? si.claimIds.map((c) => String(c)).filter(Boolean) : undefined;
      const slot = {
        slotId: `img_s${i}_${spec.purpose}`,
        slideIntentId: String(si.slideIntentId || si.slideIntentID || `s${i}`),
        slideIndex: i,
        purpose: spec.purpose,
        promptHint: buildPromptHint(si),
        style: defaultStyleForPriority(spec.priority),
        priority: spec.priority,
        aspectRatio: spec.aspectRatio,
        ...(claimIds?.length ? { claimIds } : {}),
      };

      candidates.push(slot);
    }

    if (!candidates.length) return [];

    candidates.sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return a.slideIndex - b.slideIndex;
    });

    const allowedPriorities =
      imagePolicy === "rich"
        ? new Set(["critical", "important", "optional"])
        : imagePolicy === "balanced"
          ? new Set(["critical", "important"])
          : new Set(["critical"]);

    const policyFiltered = candidates.filter((s) => allowedPriorities.has(s.priority));
    const capped = trimToMaxImages(policyFiltered, budget.maxImages);

    // Planning-time budget trim happens after policy + maxImages trimming.
    const budgetTrimmed = applyBudgetTrim(capped, budget);

    // Ensure stable output ordering by slide index (helps downstream insertion and tests).
    budgetTrimmed.sort((a, b) => a.slideIndex - b.slideIndex);

    return budgetTrimmed;
  }

  /**
   * Single-element "AI 微调" helper.
   * Returns a patch object compatible with SlideEditor.updateElement(elementId, patch).
   *
   * @param {{element: object, slide?: object, slideIndex?: number, designSystem?: object, constraints?: object}=} input
   * @returns {{patch: object, meta: {reason: string}}}
   */
  static suggestElementPatch(input = {}) {
    const element = input?.element && typeof input.element === "object" ? input.element : null;
    if (!element) return { patch: {}, meta: { reason: "missing_element" } };

    const type = String(element.type || "").toLowerCase();
    const patch = {};

    const num = (v) => {
      if (v === undefined || v === null) return null;
      const n = typeof v === "string" ? parseFloat(v) : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const pct = (v) => {
      if (typeof v === "number") return v;
      const s = String(v || "").trim();
      if (!s) return null;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    const w = pct(element.w);
    const h = pct(element.h);
    const area = w !== null && h !== null ? w * h : null;

    // Opacity: keep if explicitly set; otherwise suggest a subtle non-1 opacity for images.
    if (element.opacity === undefined || element.opacity === null) {
      if (type === "image") patch.opacity = VisualHeuristics.OPACITY_IMAGE;
      else if (type === "shape") patch.opacity = VisualHeuristics.OPACITY_SHAPE;
      else patch.opacity = 1;
    }

    // Blend: default to multiply for small/medium images to integrate with bg; keep others normal.
    const blend = String(element.blend || "").toLowerCase();
    if (!blend || blend === "normal") {
      if (type === "image") {
        const large = area !== null ? area >= 4500 : false; // ~67% x 67%
        patch.blend = large ? "normal" : "multiply";
      } else {
        patch.blend = "normal";
      }
    }

    // Mask: only for images (rounded corners default).
    if (type === "image" && (element.mask === undefined || element.mask === null || element.mask === "")) {
      const ratio = w !== null && h !== null && h !== 0 ? w / h : null;
      if (
        ratio !== null &&
        ratio > VisualHeuristics.ASPECT_RATIO_SQUARE_MIN &&
        ratio < VisualHeuristics.ASPECT_RATIO_SQUARE_MAX
      )
        patch.mask = "circle";
      else patch.mask = "rounded:12";
    }

    // Effect: add a light shadow to images if no effect set.
    if (type === "image" && (element.effect === undefined || element.effect === null || element.effect === "")) {
      patch.effect = "shadow-sm";
    }

    // Blur: keep existing; never add blur by default.
    // (We keep this intentionally conservative for deterministic results in editor roundtrip.)

    // Text: ensure readable colors if missing.
    if (type === "text") {
      const color = String(element.color || "").trim();
      if (!color) patch.color = "#0f172a";

      const fontSize = num(element.fontSize ?? element.font);
      if (fontSize !== null && fontSize > 0 && fontSize < 12) patch.fontSize = 14;
    }

    return { patch, meta: { reason: "heuristic_v1" } };
  }
}
