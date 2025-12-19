/**
 * Brainstorm module for Design stage.
 *
 * Generates IdeaPool (creative visual concepts) and ImageSlot[] (image placeholders).
 *
 * Input:
 * - slideIntents: from ContentPackage
 * - designSystem: from DesignTokens
 * - imagePolicy: 'rich' | 'balanced' | 'minimal' | 'none'
 *
 * Output:
 * - IdeaPool: Array of scored visual ideas
 * - ImageSlot[]: Image slot specifications (delegated to ImagePlanner)
 */

import { ImagePlanner } from "./image-planner.js";
import {
  BRAINSTORM_REVIEW_PROMPT,
  BRAINSTORM_SYSTEM_PROMPT,
  buildBrainstormPrompt,
  buildReviewPrompt,
} from "./brainstorm-prompts.js";
import { getDesignModelCaller, isNonRetryableError } from "./model.js";
import { robustParseJson } from "../../shared/robust-json.js";
import { RenderType, EventStatus, SlotPriority } from "./constants.js";
import { DesignEvents } from "./events.js";

/**
 * Simple concurrency limiter (pLimit-style).
 * @param {number} concurrency Max concurrent tasks
 * @returns {<T>(fn: () => Promise<T>) => Promise<T>}
 */
function createLimiter(concurrency) {
  const queue = [];
  let running = 0;

  const run = async () => {
    if (running >= concurrency || queue.length === 0) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    } finally {
      running--;
      run();
    }
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    run();
  });
}

const VISUAL_CONCEPT_TYPES = [
  "metaphor",      // 视觉隐喻
  "chart_variant", // 图表变体
  "layout_break",  // 破格版式
  "icon_set",      // 图标集
  "color_accent",  // 色彩强调
  "animation",     // 动画建议
];

const PAGE_TYPES_FOR_IDEAS = new Set([
  "cover",
  "agenda",
  "overview",
  "comparison",
  "process",
  "summary",
]);

const DEFAULT_DSL_EFFECTS = {
  image: ["opacity", "blend", "mask", "filter", "effect", "radius", "rotate"],
  shape: ["fill", "filter", "stroke", "opacity"],
  advanced: ["card", "group", "svg", "chart", "table", "formula"],
};

function buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide) {
  const rows = Array.isArray(candidatesBySlide) ? candidatesBySlide : [];
  return rows
    .map((row) => {
      const slideIntentId = toNonEmptyString(row?.slideIntentId);
      if (!slideIntentId) return null;
      const slideIndex = Number.isFinite(row?.slideIndex) ? row.slideIndex : undefined;
      const selectedCandidate = row?.selectedCandidate && typeof row.selectedCandidate === "object" ? row.selectedCandidate : null;
      return {
        slideIntentId,
        ...(slideIndex !== undefined ? { slideIndex } : {}),
        candidateId: toNonEmptyString(row?.selectedCandidateId) || toNonEmptyString(selectedCandidate?.candidateId),
        atmosphere: selectedCandidate?.atmosphere,
        elementsMarkdown: selectedCandidate?.elementsMarkdown,
        visualSlots: selectedCandidate?.visualSlots,
        scores: selectedCandidate?.scores,
        composite: selectedCandidate?.composite,
      };
    })
    .filter(Boolean);
}

function normalizeScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function extractJsonCandidate(text) {
  let s = String(text || "").trim();
  if (!s) return null;

  s = s.replace(/^```(?:json)?[\s\n]*/i, "").replace(/[\s\n]*```$/i, "");
  s = s.trim();

  if (s.toLowerCase().startsWith("json")) s = s.slice(4).trim();

  const firstChar = s[0];
  if (firstChar === "{") {
    const firstBrace = s.indexOf("{");
    const lastBrace = s.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);
  }

  if (firstChar === "[") {
    const firstBracket = s.indexOf("[");
    const lastBracket = s.lastIndexOf("]");
    if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);
  }

  // Fallback: try to locate a JSON object first, then array.
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function normalizeRenderType(rt) {
  const t = String(rt || "").trim().toLowerCase();
  if (t === "ai-image" || t === "ai_image" || t === "image") return RenderType.AI_IMAGE;
  if (t === "svg") return RenderType.SVG;
  if (t === "asset" || t === "doc-asset" || t === "document-asset") return RenderType.ASSET;
  return RenderType.AI_IMAGE;
}

function normalizePriority(p) {
  const s = String(p || "").trim().toLowerCase();
  if (s === "critical") return SlotPriority.CRITICAL;
  if (s === "important") return SlotPriority.IMPORTANT;
  if (s === "optional") return SlotPriority.OPTIONAL;
  return SlotPriority.IMPORTANT;
}

// 简化版位置：left/right/center/background/fullscreen -> 粗略百分比
function positionFromKeyword(pos) {
  const p = String(pos || "").trim().toLowerCase();
  if (p === "left") return { x: "5%", y: "20%", w: "40%", h: "60%" };
  if (p === "right") return { x: "55%", y: "20%", w: "40%", h: "60%" };
  if (p === "center") return { x: "25%", y: "25%", w: "50%", h: "50%" };
  if (p === "top") return { x: "10%", y: "5%", w: "80%", h: "40%" };
  if (p === "bottom") return { x: "10%", y: "55%", w: "80%", h: "40%" };
  if (p === "background" || p === "fullscreen") return { x: "0%", y: "0%", w: "100%", h: "100%" };
  return null;
}

// 简化版 visualSlot 规范化
function normalizeVisualSlot(raw, { slideIntentId, slideIndex } = {}) {
  const s = raw && typeof raw === "object" ? { ...raw } : {};
  const slotId = toNonEmptyString(s.slotId) || `slot_${Math.random().toString(36).slice(2, 6)}`;
  const renderType = normalizeRenderType(s.renderType);
  const position = positionFromKeyword(s.position);
  const purpose = toNonEmptyString(s.purpose);

  const slot = {
    slotId,
    slideIntentId: toNonEmptyString(slideIntentId),
    slideIndex: Number.isFinite(slideIndex) ? slideIndex : 0,
    renderType,
    purpose,
    ...(position ? { position } : {}),
    ...(s.effects && typeof s.effects === "object" ? { effects: { ...s.effects } } : {}),
  };

  if (renderType === "ai-image") {
    slot.imageSpec = {
      prompt: toNonEmptyString(s.prompt) || toNonEmptyString(s.imageSpec?.prompt) || purpose,
      style: toNonEmptyString(s.style) || toNonEmptyString(s.imageSpec?.style) || "illustration",
    };
  } else if (renderType === "svg") {
    slot.svgSpec = {
      description: toNonEmptyString(s.svgDescription) || toNonEmptyString(s.svgSpec?.description) || purpose,
      type: toNonEmptyString(s.svgType) || toNonEmptyString(s.svgSpec?.type) || "diagram",
    };
  } else if (renderType === "asset") {
    slot.assetSpec = {
      assetId: toNonEmptyString(s.assetId) || toNonEmptyString(s.assetSpec?.assetId),
    };
  }

  return slot;
}

function normalizePercentString(v) {
  if (typeof v === "number" && Number.isFinite(v)) return `${Math.max(0, Math.min(100, v))}%`;
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^\d+(\.\d+)?%$/.test(s)) return s;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return `${Math.max(0, Math.min(100, n))}%`;
  return "";
}

// Convert position string (left, right, center, etc.) to percentage bounds
function positionStringToPercent(posStr) {
  const p = String(posStr || "").trim().toLowerCase();
  const presets = {
    left: { x: "5%", y: "20%", w: "40%", h: "60%" },
    right: { x: "55%", y: "20%", w: "40%", h: "60%" },
    center: { x: "25%", y: "20%", w: "50%", h: "60%" },
    top: { x: "10%", y: "8%", w: "80%", h: "35%" },
    bottom: { x: "10%", y: "55%", w: "80%", h: "35%" },
    background: { x: "0%", y: "0%", w: "100%", h: "100%" },
    fullscreen: { x: "0%", y: "0%", w: "100%", h: "100%" },
  };
  return presets[p] || null;
}

function normalizePosition(pos) {
  // Handle string positions like "left", "right", "center"
  if (typeof pos === "string") {
    return positionStringToPercent(pos);
  }
  if (!pos || typeof pos !== "object") return null;
  const x = normalizePercentString(pos.x);
  const y = normalizePercentString(pos.y);
  const w = normalizePercentString(pos.w);
  const h = normalizePercentString(pos.h);
  if (!x && !y && !w && !h) return null;
  return { ...(x ? { x } : {}), ...(y ? { y } : {}), ...(w ? { w } : {}), ...(h ? { h } : {}) };
}

function normalizeCandidate(candidate, { slideIntentId, slideIndex } = {}) {
  const out = candidate && typeof candidate === "object" ? { ...candidate } : {};

  out.candidateId = toNonEmptyString(out.candidateId) || `cand_s${slideIndex}_${Math.random().toString(36).slice(2, 8)}`;

  const atmosphere = out.atmosphere && typeof out.atmosphere === "object" ? out.atmosphere : {};
  out.atmosphere = {
    mood: toNonEmptyString(atmosphere.mood) || "Clean, modern",
    colorScheme: toNonEmptyString(atmosphere.colorScheme) || "Use design system colors",
    visualWeight: toNonEmptyString(atmosphere.visualWeight) || "Balanced",
  };

  out.elementsMarkdown = toNonEmptyString(out.elementsMarkdown) || "";

  const visualSlots = Array.isArray(out.visualSlots) ? out.visualSlots : [];
  out.visualSlots = visualSlots
    .map((raw) => {
      const s = raw && typeof raw === "object" ? { ...raw } : {};
      const slotId = toNonEmptyString(s.slotId) || `slot_${Math.random().toString(36).slice(2, 6)}`;
      const renderType = normalizeRenderType(s.renderType);
      const priority = normalizePriority(s.priority);

      const normalized = {
        ...s,
        slotId,
        slideIntentId: toNonEmptyString(s.slideIntentId) || toNonEmptyString(slideIntentId),
        slideIndex: Number.isFinite(s.slideIndex) ? s.slideIndex : Number.isFinite(slideIndex) ? slideIndex : 0,
        renderType,
        ...(normalizePosition(s.position) ? { position: normalizePosition(s.position) } : {}),
        ...(s.effects && typeof s.effects === "object" ? { effects: { ...s.effects } } : {}),
        priority,
      };

      if (renderType === "ai-image" && (!normalized.imageSpec || typeof normalized.imageSpec !== "object")) {
        normalized.imageSpec = { prompt: toNonEmptyString(s?.imageSpec?.prompt), style: toNonEmptyString(s?.imageSpec?.style) || "illustration" };
      }

      if (renderType === "svg" && (!normalized.svgSpec || typeof normalized.svgSpec !== "object")) {
        normalized.svgSpec = { type: "diagram", description: toNonEmptyString(s?.svgSpec?.description) || `SVG for ${slotId}` };
      }

      if (renderType === "asset" && (!normalized.assetSpec || typeof normalized.assetSpec !== "object")) {
        normalized.assetSpec = { assetId: toNonEmptyString(s?.assetSpec?.assetId) || slotId, caption: toNonEmptyString(s?.assetSpec?.caption) };
      }

      return normalized;
    })
    .filter((s) => toNonEmptyString(s.slotId));

  const scores = out.scores && typeof out.scores === "object" ? out.scores : {};
  out.scores = {
    visualImpact: normalizeScore(scores.visualImpact),
    clarity: normalizeScore(scores.clarity),
    novelty: normalizeScore(scores.novelty),
    consistency: normalizeScore(scores.consistency),
  };

  out.composite = normalizeScore(out.composite);
  out.selected = Boolean(out.selected);

  return out;
}

function computeCompositeScore(scores) {
  const s = scores && typeof scores === "object" ? scores : {};
  const w = { visualImpact: 0.35, clarity: 0.3, novelty: 0.2, consistency: 0.15 };
  return normalizeScore(
    w.visualImpact * normalizeScore(s.visualImpact) +
      w.clarity * normalizeScore(s.clarity) +
      w.novelty * normalizeScore(s.novelty) +
      w.consistency * normalizeScore(s.consistency)
  );
}

function clampCandidates(candidates, count = 1) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return [];
  if (list.length <= count) return list;
  return list.slice(0, count);
}

function aspectRatioFromPosition(position) {
  if (!position || typeof position !== "object") return "16:9";
  const w = parseFloat(String(position.w || "").replace("%", ""));
  const h = parseFloat(String(position.h || "").replace("%", ""));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return "16:9";
  const r = w / h;
  const candidates = [
    { v: 16 / 9, label: "16:9" },
    { v: 4 / 3, label: "4:3" },
    { v: 1, label: "1:1" },
    { v: 3 / 4, label: "3:4" },
    { v: 9 / 16, label: "9:16" },
  ];
  candidates.sort((a, b) => Math.abs(a.v - r) - Math.abs(b.v - r));
  return candidates[0]?.label || "16:9";
}

function inferPurposeFromSlot(slot) {
  const slotId = String(slot?.slotId || "").toLowerCase();
  if (slotId.includes("hero")) return "hero";
  if (slotId.includes("bg") || slotId.includes("background")) return "background";
  if (slotId.includes("icon")) return "icon";
  if (slotId.includes("chart") || slotId.includes("flow") || slotId.includes("diagram")) return "chart_fallback";
  return "illustration";
}

export function mapVisualSlotsToImageSlots(visualSlots = [], slideIntents = []) {
  const intents = Array.isArray(slideIntents) ? slideIntents : [];
  const bySlide = new Map(intents.map((si, idx) => [String(si?.slideIntentId || si?.slideIntentID || ""), { si, idx }]));

  const slots = Array.isArray(visualSlots) ? visualSlots : [];
  return slots
    .map((slot) => {
      const slideIntentId = toNonEmptyString(slot?.slideIntentId);
      const slideIndex = Number.isFinite(slot?.slideIndex) ? slot.slideIndex : bySlide.get(slideIntentId)?.idx ?? 0;
      const si = bySlide.get(slideIntentId)?.si || intents[slideIndex] || {};

      const renderType = normalizeRenderType(slot?.renderType);
      const priority = normalizePriority(slot?.priority);
      const purpose = inferPurposeFromSlot(slot);
      const aspectRatio = aspectRatioFromPosition(slot?.position);

      const promptHint =
        renderType === "ai-image"
          ? toNonEmptyString(slot?.imageSpec?.prompt)
          : renderType === "svg"
            ? toNonEmptyString(slot?.svgSpec?.description) || toNonEmptyString(slot?.svgSpec?.type)
            : toNonEmptyString(slot?.assetSpec?.caption) || toNonEmptyString(slot?.assetSpec?.assetId);

      const style =
        renderType === "ai-image"
          ? toNonEmptyString(slot?.imageSpec?.style) || "illustration"
          : renderType === "svg"
            ? "flat"
            : "photo";

      const claimIds = Array.isArray(si?.claimIds) ? si.claimIds.map((c) => String(c)).filter(Boolean) : undefined;

      return {
        slotId: toNonEmptyString(slot?.slotId),
        slideIntentId: toNonEmptyString(slideIntentId) || toNonEmptyString(si?.slideIntentId || si?.slideIntentID),
        slideIndex,
        purpose,
        promptHint: promptHint || toNonEmptyString(si?.title) || "A slide illustration.",
        style,
        priority,
        aspectRatio,
        ...(claimIds?.length ? { claimIds } : {}),
        ...(renderType === "asset" && toNonEmptyString(slot?.assetSpec?.assetId) ? { assetId: toNonEmptyString(slot.assetSpec.assetId) } : {}),
        ...(slot?.effects && typeof slot.effects === "object" ? { effects: { ...slot.effects } } : {}),
        renderType,
      };
    })
    .filter((s) => s.slotId);
}

async function generateCandidatesForSlide(slideIntent, designSystem, { modelCaller, signal, slideIndex, dslEffects, availableAssets } = {}, styleSpec) {
  const slideIntentId = toNonEmptyString(slideIntent?.slideIntentId || slideIntent?.slideIntentID);
  const prompt = buildBrainstormPrompt(slideIntent, designSystem, dslEffects, styleSpec, availableAssets);
  if (typeof modelCaller !== "function") throw new Error("No model caller for brainstorm");

  const messages = [
    { role: "system", content: BRAINSTORM_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");
    try {
	      const resp = await modelCaller(messages, { temperature: 0.8, maxTokens: 8000, signal, timeoutMs: 120_000 });

	      const jsonStr = extractJsonCandidate(resp?.content);
	      const parsed = robustParseJson(jsonStr);
	      if (parsed === null) throw new Error("Failed to parse brainstorm JSON");
	      // Handle both old single-slide format and new batch format
	      const rawCandidates = Array.isArray(parsed?.slideResults)
	        ? (parsed.slideResults[0]?.candidates || [])
	        : Array.isArray(parsed?.candidates)
	          ? parsed.candidates
	          : Array.isArray(parsed) ? parsed : [];

	      const normalized = rawCandidates.map((c) => normalizeCandidate(c, { slideIntentId, slideIndex }));
	      return clampCandidates(normalized);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[design.brainstorm] generateCandidatesForSlide failed", { slideIntentId, slideIndex, attempt: attempt + 1, error: msg });
      if (isNonRetryableError(e)) break;
    }
  }

  throw lastErr || new Error("generateCandidatesForSlide failed");
}

/**
 * Generate visual slots for a batch of slides (up to 4).
 * Returns Map<slideIndex, visualSlots[]>
 *
 * Simplified flow: directly returns visualSlots without candidates wrapper.
 */
async function generateCandidatesForBatch(slideIntentsBatch, designSystem, { modelCaller, signal, dslEffects, startIndex = 0, availableAssets, emit } = {}, styleSpec) {
  if (typeof modelCaller !== "function") throw new Error("No model caller for brainstorm");
  const batch = Array.isArray(slideIntentsBatch) ? slideIntentsBatch : [];
  if (batch.length === 0) return new Map();

  // Enrich slideIntents with slideIndex
  const enriched = batch.map((si, idx) => ({
    ...si,
    slideIndex: si.slideIndex ?? (startIndex + idx),
  }));

  const prompt = buildBrainstormPrompt(enriched, designSystem, dslEffects, styleSpec, availableAssets);
  const messages = [
    { role: "system", content: BRAINSTORM_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");
    try {
      const resp = await modelCaller(messages, { temperature: 0.7, maxTokens: 6000, signal, timeoutMs: 180_000 });

      const jsonStr = extractJsonCandidate(resp?.content);
      const parsed = robustParseJson(jsonStr);
      if (parsed === null) throw new Error("Failed to parse batch brainstorm JSON");

      const resultMap = new Map();

      // Handle new simplified format: { slideResults: [{ slideIntentId, slideIndex, visualSlots }] }
      if (Array.isArray(parsed?.slideResults)) {
        for (const result of parsed.slideResults) {
          const slideIntentId = toNonEmptyString(result?.slideIntentId);
          const slideIndex = Number.isFinite(result?.slideIndex) ? result.slideIndex : null;

          // New format: visualSlots directly in result
          const rawSlots = Array.isArray(result?.visualSlots) ? result.visualSlots : [];

          const matchedSlide = enriched.find((si) =>
            toNonEmptyString(si?.slideIntentId || si?.slideIntentID) === slideIntentId ||
            si.slideIndex === slideIndex
          );
          const resolvedIndex = matchedSlide?.slideIndex ?? slideIndex ?? startIndex;
          const resolvedId = slideIntentId || toNonEmptyString(matchedSlide?.slideIntentId || matchedSlide?.slideIntentID);

          // Normalize each visual slot with position keyword conversion
          const normalizedSlots = rawSlots.map((raw) => normalizeVisualSlot(raw, { slideIntentId: resolvedId, slideIndex: resolvedIndex }));

          // Wrap in single candidate for backward compatibility
          const candidate = {
            candidateId: `cand_s${resolvedIndex}_visual`,
            atmosphere: { mood: "auto", colorScheme: "design-system", visualWeight: "balanced" },
            elementsMarkdown: "",
            visualSlots: normalizedSlots,
            scores: { visualImpact: 0.7, clarity: 0.8, novelty: 0.6, consistency: 0.8 },
            composite: 0.73,
            selected: true,
          };

          resultMap.set(resolvedIndex, [candidate]);
        }
      }

      // Fill missing slides with empty arrays (will trigger fallback later)
      for (const si of enriched) {
        if (!resultMap.has(si.slideIndex)) {
          resultMap.set(si.slideIndex, []);
        }
      }

      return resultMap;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[design.brainstorm] generateCandidatesForBatch failed", { batchSize: batch.length, attempt: attempt + 1, error: msg });
      // Emit error for UI visibility
      if (typeof emit === "function") {
        emit(DesignEvents.BRAINSTORM_BATCH_ERROR, {
          actor: "design",
          status: EventStatus.ERROR,
          payload: { batchSize: batch.length, attempt: attempt + 1, error: msg },
        });
      }
      if (isNonRetryableError(e)) break;
    }
  }

  throw lastErr || new Error("generateCandidatesForBatch failed");
}

async function reviewCandidatesForSlide(slideIntent, candidates, designSystem, { modelCaller, signal } = {}) {
  const prompt = buildReviewPrompt(slideIntent, candidates, designSystem);
  if (typeof modelCaller !== "function") throw new Error("No model caller for brainstorm review");

  const messages = [
    { role: "system", content: BRAINSTORM_REVIEW_PROMPT },
    { role: "user", content: prompt },
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");
    try {
	      const resp = await modelCaller(messages, { temperature: 0.2, maxTokens: 4000, signal, timeoutMs: 120_000 });

	      const jsonStr = extractJsonCandidate(resp?.content);
	      const parsed = robustParseJson(jsonStr);
	      if (parsed === null) throw new Error("Failed to parse brainstorm review JSON");
	      // Handle both old single-slide format and new batch format
	      const reviews = Array.isArray(parsed?.slideReviews)
	        ? (parsed.slideReviews[0]?.reviews || [])
	        : Array.isArray(parsed?.reviews) ? parsed.reviews : [];
	      const selectedCandidateId = Array.isArray(parsed?.slideReviews)
	        ? toNonEmptyString(parsed.slideReviews[0]?.selectedCandidateId)
	        : toNonEmptyString(parsed?.selectedCandidateId);

      const byId = new Map(reviews.map((r) => [toNonEmptyString(r?.candidateId), r?.scores || null]));

      const scored = candidates.map((c) => {
        const scores = byId.get(c.candidateId) || null;
        const mergedScores = scores
          ? {
              visualImpact: normalizeScore(scores.visualImpact),
              clarity: normalizeScore(scores.clarity),
              novelty: normalizeScore(scores.novelty),
              consistency: normalizeScore(scores.consistency),
            }
          : c.scores;

        const composite = computeCompositeScore(mergedScores);
        return { ...c, scores: mergedScores, composite, selected: false };
      });

      let selectedId = selectedCandidateId;
      if (!selectedId || !scored.some((c) => c.candidateId === selectedId)) {
        selectedId = scored.slice().sort((a, b) => b.composite - a.composite)[0]?.candidateId || "";
      }

      for (const c of scored) c.selected = c.candidateId === selectedId;

      return { candidates: scored, selectedCandidateId: selectedId };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[design.brainstorm] reviewCandidatesForSlide failed", { attempt: attempt + 1, error: msg });
      if (isNonRetryableError(e)) break;
    }
  }

  throw lastErr || new Error("reviewCandidatesForSlide failed");
}

/**
 * Review candidates for a batch of slides.
 * @param {Array} batchData - Array of { slideIntentId, slideIndex, candidates, pageType, title, objective }
 * @returns {Map<slideIndex, { candidates, selectedCandidateId }>}
 */
async function reviewCandidatesForBatch(batchData, designSystem, { modelCaller, signal } = {}) {
  if (typeof modelCaller !== "function") throw new Error("No model caller for brainstorm review");
  const batch = Array.isArray(batchData) ? batchData : [];
  if (batch.length === 0) return new Map();

  // Build slide intents array for batch review prompt
  const slideIntents = batch.map((item) => ({
    slideIntentId: item.slideIntentId,
    slideIndex: item.slideIndex,
    pageType: item.pageType,
    title: item.title,
    objective: item.objective,
  }));

  const prompt = buildReviewPrompt(slideIntents, batch, designSystem);
  const messages = [
    { role: "system", content: BRAINSTORM_REVIEW_PROMPT },
    { role: "user", content: prompt },
  ];

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");
    try {
      const resp = await modelCaller(messages, { temperature: 0.2, maxTokens: 8000, signal, timeoutMs: 180_000 });

      const jsonStr = extractJsonCandidate(resp?.content);
      const parsed = robustParseJson(jsonStr);
      if (parsed === null) throw new Error("Failed to parse batch review JSON");

      const slideReviews = Array.isArray(parsed?.slideReviews) ? parsed.slideReviews : [];
      const resultMap = new Map();

      for (const review of slideReviews) {
        const slideIntentId = toNonEmptyString(review?.slideIntentId);
        const slideIndex = Number.isFinite(review?.slideIndex) ? review.slideIndex : null;
        const reviews = Array.isArray(review?.reviews) ? review.reviews : [];
        const selectedCandidateId = toNonEmptyString(review?.selectedCandidateId);

        // Find matching batch item
        const matchedItem = batch.find((item) =>
          item.slideIntentId === slideIntentId || item.slideIndex === slideIndex
        );
        if (!matchedItem) continue;

        const candidates = matchedItem.candidates || [];
        const byId = new Map(reviews.map((r) => [toNonEmptyString(r?.candidateId), r?.scores || null]));

        const scored = candidates.map((c) => {
          const scores = byId.get(c.candidateId) || null;
          const mergedScores = scores
            ? {
                visualImpact: normalizeScore(scores.visualImpact),
                clarity: normalizeScore(scores.clarity),
                novelty: normalizeScore(scores.novelty),
                consistency: normalizeScore(scores.consistency),
              }
            : c.scores;

          const composite = computeCompositeScore(mergedScores);
          return { ...c, scores: mergedScores, composite, selected: false };
        });

        let selectedId = selectedCandidateId;
        if (!selectedId || !scored.some((c) => c.candidateId === selectedId)) {
          selectedId = scored.slice().sort((a, b) => b.composite - a.composite)[0]?.candidateId || "";
        }

        for (const c of scored) c.selected = c.candidateId === selectedId;

        resultMap.set(matchedItem.slideIndex, { candidates: scored, selectedCandidateId: selectedId });
      }

      // Fill missing slides with fallback scores
      for (const item of batch) {
        if (!resultMap.has(item.slideIndex)) {
          const candidates = (item.candidates || []).map((c, idx) => {
            const scores = { visualImpact: 0.55 - idx * 0.02, clarity: 0.6, novelty: 0.5, consistency: 0.65 };
            return { ...c, scores, composite: computeCompositeScore(scores), selected: idx === 0 };
          });
          resultMap.set(item.slideIndex, {
            candidates,
            selectedCandidateId: candidates[0]?.candidateId || "",
          });
        }
      }

      return resultMap;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[design.brainstorm] reviewCandidatesForBatch failed", { batchSize: batch.length, attempt: attempt + 1, error: msg });
      if (isNonRetryableError(e)) break;
    }
  }

  throw lastErr || new Error("reviewCandidatesForBatch failed");
}

/**
 * Create an idea object.
 */
function createIdea({
  ideaId,
  slideIntentId,
  conceptType,
  description,
  novelty = 0.5,
  relevance = 0.5,
  risk = 0.3,
  exportFriendly = 0.8,
} = {}) {
  return {
    ideaId: String(ideaId || `idea_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
    slideIntentId: String(slideIntentId || ""),
    conceptType: VISUAL_CONCEPT_TYPES.includes(conceptType) ? conceptType : "metaphor",
    description: String(description || ""),
    scores: {
      novelty: normalizeScore(novelty),
      relevance: normalizeScore(relevance),
      risk: normalizeScore(risk),
      exportFriendly: normalizeScore(exportFriendly),
    },
    selected: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Calculate composite score for sorting ideas.
 * Higher is better: high novelty + relevance + exportFriendly, low risk.
 */
function compositeScore(idea) {
  const s = idea.scores || {};
  return (
    0.25 * (s.novelty || 0) +
    0.35 * (s.relevance || 0) +
    0.15 * (1 - (s.risk || 0)) +
    0.25 * (s.exportFriendly || 0)
  );
}

/**
 * Generate default ideas based on page type and content.
 */
function generateDefaultIdeas(slideIntent, designSystem) {
  const ideas = [];
  const pageType = String(slideIntent?.pageType || "").toLowerCase();
  const title = String(slideIntent?.title || "");
  const keyPoints = Array.isArray(slideIntent.keyPoints) ? slideIntent.keyPoints : [];
  const slideIntentId = String(slideIntent?.slideIntentId || slideIntent?.slideIntentID || "");

  // Cover page ideas
  if (pageType === "cover") {
    ideas.push(
      createIdea({
        slideIntentId,
        conceptType: "metaphor",
        description: `Hero visual: abstract geometric pattern representing "${title}"`,
        novelty: 0.6,
        relevance: 0.8,
        risk: 0.2,
        exportFriendly: 0.9,
      }),
      createIdea({
        slideIntentId,
        conceptType: "color_accent",
        description: "Gradient overlay with primary brand color for visual impact",
        novelty: 0.4,
        relevance: 0.7,
        risk: 0.1,
        exportFriendly: 0.95,
      })
    );
  }

  // Agenda/overview page ideas
  if (pageType === "agenda" || pageType === "overview") {
    ideas.push(
      createIdea({
        slideIntentId,
        conceptType: "icon_set",
        description: `Icon grid: ${keyPoints.length || 3} icons representing key sections`,
        novelty: 0.5,
        relevance: 0.85,
        risk: 0.15,
        exportFriendly: 0.9,
      }),
      createIdea({
        slideIntentId,
        conceptType: "layout_break",
        description: "Timeline-style layout connecting agenda items",
        novelty: 0.7,
        relevance: 0.75,
        risk: 0.3,
        exportFriendly: 0.8,
      })
    );
  }

  // Comparison page ideas
  if (pageType === "comparison") {
    ideas.push(
      createIdea({
        slideIntentId,
        conceptType: "chart_variant",
        description: "Side-by-side comparison cards with visual indicators",
        novelty: 0.5,
        relevance: 0.9,
        risk: 0.2,
        exportFriendly: 0.85,
      }),
      createIdea({
        slideIntentId,
        conceptType: "metaphor",
        description: "Balance scale visual metaphor for pros/cons",
        novelty: 0.65,
        relevance: 0.8,
        risk: 0.25,
        exportFriendly: 0.8,
      })
    );
  }

  // Process/flow page ideas
  if (pageType === "process" || pageType === "roadmap") {
    ideas.push(
      createIdea({
        slideIntentId,
        conceptType: "chart_variant",
        description: "Flowing arrow diagram connecting process steps",
        novelty: 0.55,
        relevance: 0.9,
        risk: 0.2,
        exportFriendly: 0.85,
      }),
      createIdea({
        slideIntentId,
        conceptType: "icon_set",
        description: "Step icons with numbered badges",
        novelty: 0.4,
        relevance: 0.85,
        risk: 0.1,
        exportFriendly: 0.95,
      })
    );
  }

  // Summary page ideas
  if (pageType === "summary") {
    ideas.push(
      createIdea({
        slideIntentId,
        conceptType: "layout_break",
        description: "Key takeaways in highlighted boxes",
        novelty: 0.45,
        relevance: 0.9,
        risk: 0.15,
        exportFriendly: 0.9,
      }),
      createIdea({
        slideIntentId,
        conceptType: "color_accent",
        description: "Accent color callout for main conclusion",
        novelty: 0.4,
        relevance: 0.85,
        risk: 0.1,
        exportFriendly: 0.95,
      })
    );
  }

  return ideas;
}

/**
 * Filter and rank ideas by composite score.
 */
function rankIdeas(ideas, topN = 2) {
  return [...ideas]
    .sort((a, b) => compositeScore(b) - compositeScore(a))
    .slice(0, topN);
}

/**
 * Select best ideas for each slide.
 */
function selectIdeasForSlides(ideaPool, maxPerSlide = 2) {
  const bySlide = new Map();
  for (const idea of ideaPool) {
    const sid = idea.slideIntentId;
    if (!bySlide.has(sid)) bySlide.set(sid, []);
    bySlide.get(sid).push(idea);
  }

  const selected = [];
  for (const [sid, ideas] of bySlide.entries()) {
    const top = rankIdeas(ideas, maxPerSlide);
    for (const idea of top) {
      idea.selected = true;
      selected.push(idea);
    }
  }
  return selected;
}

/**
 * Main brainstorm function.
 *
 * @param {object} contentPackage - Contains slideIntents, summary, etc.
 * @param {object} designSystem - Design tokens and system spec.
 * @param {object} constraints - Contains imagePolicy, imageBudget, etc.
 * @param {object} options - Optional: modelRouter/aiApiService for LLM brainstorming, emit for events.
 * @returns {Promise<{ideaPool: Array, imageSlots: Array, selectedIdeas: Array}>}
 */
export async function brainstorm(contentPackage, designSystem, constraints = {}, options = {}) {
  const slideIntents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
  const emit = typeof options?.emit === "function" ? options.emit : null;
  const stageApi = { modelRouter: options?.modelRouter, aiApiService: options?.aiApiService, signal: options?.signal };
  const modelCaller = getDesignModelCaller(stageApi, { usage: "designer", timeoutMs: 30_000 });
  const styleSpec = options?.styleSpec ?? designSystem?.styleReference?.extracted;

  emit?.(DesignEvents.BRAINSTORM_STARTED, {
    actor: "design",
    status: EventStatus.STARTED,
    payload: { slideCount: slideIntents.length },
  });

  const cachedCandidates = contentPackage?.brainstormCandidates;
  if (
    cachedCandidates &&
    typeof cachedCandidates === "object" &&
    String(cachedCandidates?.source || "").trim() === "user" &&
    Array.isArray(cachedCandidates?.candidatesBySlide)
  ) {
    const byIntentId = new Map(
      (Array.isArray(slideIntents) ? slideIntents : []).map((si, idx) => [
        toNonEmptyString(si?.slideIntentId || si?.slideIntentID),
        idx,
      ])
    );

    const candidatesBySlide = cachedCandidates.candidatesBySlide
      .map((raw) => {
        const slideIntentId = toNonEmptyString(raw?.slideIntentId);
        if (!slideIntentId) return null;
        const slideIndex = Number.isFinite(raw?.slideIndex) ? raw.slideIndex : byIntentId.get(slideIntentId);

        const candidates = (Array.isArray(raw?.candidates) ? raw.candidates : [])
          .filter((c) => c && typeof c === "object")
          .map((c) => ({ ...c, candidateId: toNonEmptyString(c?.candidateId) }))
          .filter((c) => c.candidateId);

        const selectedCandidateId =
          toNonEmptyString(raw?.selectedCandidateId) || toNonEmptyString(raw?.selectedCandidate?.candidateId);

        const selectedFromList = selectedCandidateId
          ? candidates.find((c) => c.candidateId === selectedCandidateId) || null
          : null;
        const selectedFromRow =
          raw?.selectedCandidate && typeof raw.selectedCandidate === "object" && toNonEmptyString(raw.selectedCandidate.candidateId)
            ? { ...raw.selectedCandidate, candidateId: toNonEmptyString(raw.selectedCandidate.candidateId) }
            : null;

        const selectedCandidate = selectedFromList || selectedFromRow || candidates[0] || null;
        if (!selectedCandidate) return null;

        const pickedId = selectedCandidate.candidateId || selectedCandidateId;
        const nextCandidates = candidates.length
          ? candidates.map((c) => ({ ...c, selected: c.candidateId === pickedId }))
          : [{ ...selectedCandidate, selected: true }];

        const nextSelected =
          nextCandidates.find((c) => c.candidateId === pickedId) || { ...selectedCandidate, selected: true };

        if (nextCandidates.length && !nextCandidates.some((c) => c.candidateId === nextSelected.candidateId)) {
          nextCandidates.push(nextSelected);
        }

        return {
          ...(slideIndex !== undefined ? { slideIndex } : {}),
          slideIntentId,
          candidates: nextCandidates,
          selectedCandidateId: nextSelected.candidateId,
          selectedCandidate: { ...nextSelected, selected: true },
        };
      })
      .filter(Boolean);

    const selectedCandidates = candidatesBySlide.map((x) => x.selectedCandidate).filter(Boolean);
    if (candidatesBySlide.length > 0 && selectedCandidates.length > 0) {
      const selectedVisualSlots = selectedCandidates.flatMap((c) => (Array.isArray(c?.visualSlots) ? c.visualSlots : []));
      const imageSlots = mapVisualSlotsToImageSlots(selectedVisualSlots, slideIntents);

      const allCandidates = candidatesBySlide.flatMap((x) => (Array.isArray(x?.candidates) ? x.candidates : []));

      emit?.(DesignEvents.BRAINSTORM_CANDIDATES, {
        actor: "design",
        status: EventStatus.DATA,
        payload: {
          candidatesBySlide,
          selectedIdeas: buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide),
          source: "user",
          totalIdeas: allCandidates.length,
          selectedCount: selectedCandidates.length,
        },
      });

      emit?.(DesignEvents.BRAINSTORM_COMPLETED, {
        actor: "design",
        status: EventStatus.COMPLETED,
        payload: {
          totalCandidates: allCandidates.length,
          selectedCandidates: selectedCandidates.length,
          visualSlots: selectedVisualSlots.length,
          imageSlots: imageSlots.length,
          source: "user",
        },
      });

      return {
        ideaPool: [],
        selectedIdeas: [],
        imageSlots,
        candidatesBySlide,
        candidates: allCandidates,
        selectedCandidates,
      };
    }
  }

  if (typeof modelCaller === "function") {
    const candidatesBySlide = new Array(slideIntents.length);
    const allCandidates = [];
    const BATCH_SIZE = 4;
    const batchConcurrency = Math.max(1, Number(options?.batchConcurrency) || 2);

    // Extract available assets from contentPackage
    const availableAssets = Array.isArray(contentPackage?.assets) ? contentPackage.assets : [];

    // Build batch list
    const batches = [];
    for (let batchStart = 0; batchStart < slideIntents.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, slideIntents.length);
      const batchSlides = slideIntents.slice(batchStart, batchEnd).map((si, idx) => ({
        ...si,
        slideIndex: batchStart + idx,
        slideIntentId: toNonEmptyString(si?.slideIntentId || si?.slideIntentID),
      }));
      batches.push({ batchStart, batchSlides });
    }

    // Process batches with concurrency limit
    const limiter = createLimiter(batchConcurrency);
    await Promise.all(batches.map(({ batchStart, batchSlides }, batchIndex) => limiter(async () => {
      if (stageApi.signal?.aborted) throw new Error(typeof stageApi.signal.reason === "string" ? stageApi.signal.reason : "Run cancelled");

      // Emit batch progress
      emit?.(DesignEvents.BRAINSTORM_BATCH_STARTED, {
        actor: "design",
        status: EventStatus.PROGRESS,
        payload: { batchIndex, batchCount: batches.length, slideIndexes: batchSlides.map((s) => s.slideIndex) },
      });

      // Generate candidates for batch
      let candidatesMap = new Map();
      try {
        candidatesMap = await generateCandidatesForBatch(batchSlides, designSystem, {
          modelCaller,
          signal: stageApi.signal,
          dslEffects: options?.dslEffects || constraints?.dslEffects || DEFAULT_DSL_EFFECTS,
          startIndex: batchStart,
          availableAssets,
          emit,
        }, styleSpec);
      } catch (e) {
        // Emit error and fallback
        const msg = e instanceof Error ? e.message : String(e);
        emit?.(DesignEvents.BRAINSTORM_BATCH_ERROR, {
          actor: "design",
          status: EventStatus.ERROR,
          payload: { batchIndex, error: msg, willFallback: true },
        });
      }

      // Apply fallback for slides with no candidates
      for (const si of batchSlides) {
        let candidates = candidatesMap.get(si.slideIndex) || [];
        if (candidates.length === 0) {
          const fallback = normalizeCandidate(
            {
              candidateId: `cand_s${si.slideIndex}_fallback`,
              atmosphere: { mood: "Clean modern", colorScheme: "Design-system aligned", visualWeight: "Balanced" },
              elementsMarkdown: `- Title + key points with strong hierarchy\n- One supporting visual slot if needed`,
              visualSlots: [],
            },
            { slideIntentId: si.slideIntentId, slideIndex: si.slideIndex }
          );
          candidates = clampCandidates([fallback]);
          candidatesMap.set(si.slideIndex, candidates);
        }

        emit?.(DesignEvents.BRAINSTORM_LLM_GENERATED, {
          actor: "design",
          status: EventStatus.GENERATED,
          payload: { slideIndex: si.slideIndex, slideIntentId: si.slideIntentId, candidateCount: candidates.length },
        });
      }

      // Skip review stage - with simplified flow we have 1 candidate already selected
      // Populate candidatesBySlide directly from generated candidates
      for (const si of batchSlides) {
        const candidates = candidatesMap.get(si.slideIndex) || [];
        const selected = candidates.find((c) => c.selected) || candidates[0] || null;
        const selectedCandidateId = selected?.candidateId || "";

        emit?.(DesignEvents.BRAINSTORM_SLIDE_COMPLETED, {
          actor: "design",
          status: EventStatus.COMPLETED,
          payload: {
            slideIndex: si.slideIndex,
            slideIntentId: si.slideIntentId,
            visualSlotCount: selected?.visualSlots?.length || 0,
          },
        });

        candidatesBySlide[si.slideIndex] = {
          slideIndex: si.slideIndex,
          slideIntentId: si.slideIntentId,
          candidates,
          selectedCandidateId,
          selectedCandidate: selected,
        };
      }
    })));

    // Collect all candidates (in order)
    for (const row of candidatesBySlide) {
      if (row?.candidates) allCandidates.push(...row.candidates);
    }

    const selectedCandidates = candidatesBySlide.map((x) => x.selectedCandidate).filter(Boolean);
    const selectedVisualSlots = selectedCandidates.flatMap((c) => (Array.isArray(c?.visualSlots) ? c.visualSlots : []));
    const imageSlots = mapVisualSlotsToImageSlots(selectedVisualSlots, slideIntents);

    emit?.(DesignEvents.BRAINSTORM_CANDIDATES, {
      actor: "design",
      status: EventStatus.DATA,
      payload: {
        candidatesBySlide,
        selectedIdeas: buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide),
        totalIdeas: allCandidates.length,
        selectedCount: selectedCandidates.length,
      },
    });

    emit?.(DesignEvents.BRAINSTORM_COMPLETED, {
      actor: "design",
      status: EventStatus.COMPLETED,
      payload: {
        totalCandidates: allCandidates.length,
        selectedCandidates: selectedCandidates.length,
        visualSlots: selectedVisualSlots.length,
        imageSlots: imageSlots.length,
      },
    });

    return {
      ideaPool: [],
      selectedIdeas: [],
      imageSlots,
      candidatesBySlide,
      candidates: allCandidates,
      selectedCandidates,
    };
  }

  // Generate default ideas for each relevant slide
  const ideaPool = [];
  for (const si of slideIntents) {
    const pageType = String(si?.pageType || "").toLowerCase();
    if (PAGE_TYPES_FOR_IDEAS.has(pageType)) {
      const ideas = generateDefaultIdeas(si, designSystem);
      ideaPool.push(...ideas);
    }
  }

  // Select top ideas per slide
  const selectedIdeas = selectIdeasForSlides(ideaPool, 2);

  // Generate image slots (delegate to ImagePlanner)
  const imageSlots = ImagePlanner.plan(slideIntents, designSystem, constraints);

  // v2 compatibility payload for downstream consumers (optional).
  const candidatesBySlide = slideIntents.map((si, slideIndex) => {
    const slideIntentId = toNonEmptyString(si?.slideIntentId || si?.slideIntentID);
    const slotsForSlide = imageSlots.filter((s) => s.slideIndex === slideIndex);
    const visualSlots = slotsForSlide.map((s) => ({
      slotId: toNonEmptyString(s.slotId),
      slideIntentId: toNonEmptyString(s.slideIntentId),
      slideIndex: Number.isFinite(s.slideIndex) ? s.slideIndex : slideIndex,
      renderType: "ai-image",
      priority: normalizePriority(s.priority),
      imageSpec: { prompt: toNonEmptyString(s.promptHint), style: toNonEmptyString(s.style) || "illustration" },
    }));

    const baseCandidate = normalizeCandidate(
      {
        candidateId: `cand_s${slideIndex}_rules`,
        atmosphere: {
          mood: String(designSystem?.styleReference?.extracted?.mood || designSystem?.theme || "neutral"),
          colorScheme: "Design tokens aligned",
          visualWeight: "Balanced",
        },
        elementsMarkdown: [
          `## Content`,
          `- Title: ${toNonEmptyString(si?.title) || "Untitled"}`,
          ...(visualSlots.length ? [`- Visual slots: ${visualSlots.map((v) => v.slotId).join(", ")}`] : ["- No image slots planned"]),
        ].join("\n"),
        visualSlots,
        scores: { visualImpact: 0.5, clarity: 0.7, novelty: 0.4, consistency: 0.8 },
        composite: computeCompositeScore({ visualImpact: 0.5, clarity: 0.7, novelty: 0.4, consistency: 0.8 }),
        selected: true,
      },
      { slideIntentId, slideIndex }
    );

    const altCandidate = normalizeCandidate(
      {
        ...baseCandidate,
        candidateId: `cand_s${slideIndex}_rules_v2`,
        atmosphere: { ...baseCandidate.atmosphere, visualWeight: "Left-heavy" },
        scores: { visualImpact: 0.55, clarity: 0.65, novelty: 0.45, consistency: 0.78 },
        composite: computeCompositeScore({ visualImpact: 0.55, clarity: 0.65, novelty: 0.45, consistency: 0.78 }),
        selected: false,
      },
      { slideIntentId, slideIndex }
    );

    return {
      slideIndex,
      slideIntentId,
      candidates: [baseCandidate, altCandidate],
      selectedCandidateId: baseCandidate.candidateId,
      selectedCandidate: baseCandidate,
    };
  });

  emit?.(DesignEvents.BRAINSTORM_CANDIDATES, {
    actor: "design",
    status: EventStatus.DATA,
    payload: {
      candidatesBySlide,
      selectedIdeas: buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide),
      totalIdeas: ideaPool.length,
      selectedCount: selectedIdeas.length,
    },
  });

  emit?.(DesignEvents.BRAINSTORM_COMPLETED, {
    actor: "design",
    status: EventStatus.COMPLETED,
    payload: {
      totalIdeas: ideaPool.length,
      selectedIdeas: selectedIdeas.length,
      imageSlots: imageSlots.length,
    },
  });

  return {
    ideaPool,
    selectedIdeas,
    imageSlots,
    candidatesBySlide,
    candidates: candidatesBySlide.flatMap((x) => x.candidates),
    selectedCandidates: candidatesBySlide.map((x) => x.selectedCandidate),
  };
}

export async function brainstormRegenerate(
  slideIntentId,
  contentPackage,
  designSystem,
  constraints,
  { keepOthers = true, emit, aiApiService, modelRouter, signal, styleSpec } = {}
) {
  const slideIntents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
  const emitFn = typeof emit === "function" ? emit : null;
  const targetId = toNonEmptyString(slideIntentId);
  if (!targetId) throw new Error("brainstormRegenerate: slideIntentId is required");

  const slideIndex = slideIntents.findIndex((si) => toNonEmptyString(si?.slideIntentId || si?.slideIntentID) === targetId);
  if (slideIndex < 0) throw new Error(`brainstormRegenerate: unknown slideIntentId: ${targetId}`);

  const slideIntent = slideIntents[slideIndex] || {};
  const stageApi = { modelRouter, aiApiService, signal };
  const modelCaller = getDesignModelCaller(stageApi, { usage: "designer", timeoutMs: 30_000 });
  const resolvedStyleSpec = styleSpec ?? designSystem?.styleReference?.extracted;

  let row;
  if (typeof modelCaller === "function") {
    let candidates = [];
    try {
      candidates = await generateCandidatesForSlide(slideIntent, designSystem, {
        modelCaller,
        signal: stageApi.signal,
        slideIndex,
        dslEffects: constraints?.dslEffects || DEFAULT_DSL_EFFECTS,
      }, resolvedStyleSpec);
    } catch {
      candidates = [];
    }

    if (candidates.length === 0) {
      const fallback = normalizeCandidate(
        {
          candidateId: `cand_s${slideIndex}_fallback`,
          atmosphere: { mood: "Clean modern", colorScheme: "Design-system aligned", visualWeight: "Balanced" },
          elementsMarkdown: `- Title + key points with strong hierarchy\n- One supporting visual slot if needed`,
          visualSlots: [],
        },
        { slideIntentId: targetId, slideIndex }
      );
      candidates = clampCandidates([fallback]);
    }

    let reviewed = { candidates, selectedCandidateId: candidates[0]?.candidateId || "" };
    try {
      reviewed = await reviewCandidatesForSlide(slideIntent, candidates, designSystem, { modelCaller, signal: stageApi.signal });
    } catch {
      const scored = candidates.map((c, idx) => {
        const scores = { visualImpact: 0.55 - idx * 0.02, clarity: 0.6, novelty: 0.5, consistency: 0.65 };
        return { ...c, scores, composite: computeCompositeScore(scores), selected: idx === 0 };
      });
      reviewed = { candidates: scored, selectedCandidateId: scored[0]?.candidateId || "" };
    }

    const selectedCandidate = reviewed.candidates.find((c) => c.selected) || reviewed.candidates[0] || null;
    row = {
      slideIndex,
      slideIntentId: targetId,
      candidates: reviewed.candidates,
      selectedCandidateId: reviewed.selectedCandidateId,
      selectedCandidate,
    };
  } else {
    const imageSlots = ImagePlanner.plan(slideIntents, designSystem, constraints || {});
    const slotsForSlide = imageSlots.filter((s) => s.slideIndex === slideIndex);
    const visualSlots = slotsForSlide.map((s) => ({
      slotId: toNonEmptyString(s.slotId),
      slideIntentId: toNonEmptyString(s.slideIntentId),
      slideIndex: Number.isFinite(s.slideIndex) ? s.slideIndex : slideIndex,
      renderType: "ai-image",
      priority: normalizePriority(s.priority),
      imageSpec: { prompt: toNonEmptyString(s.promptHint), style: toNonEmptyString(s.style) || "illustration" },
    }));

    const baseCandidate = normalizeCandidate(
      {
        candidateId: `cand_s${slideIndex}_rules`,
        atmosphere: {
          mood: String(designSystem?.styleReference?.extracted?.mood || designSystem?.theme || "neutral"),
          colorScheme: "Design tokens aligned",
          visualWeight: "Balanced",
        },
        elementsMarkdown: [
          `## Content`,
          `- Title: ${toNonEmptyString(slideIntent?.title) || "Untitled"}`,
          ...(visualSlots.length ? [`- Visual slots: ${visualSlots.map((v) => v.slotId).join(", ")}`] : ["- No image slots planned"]),
        ].join("\n"),
        visualSlots,
        scores: { visualImpact: 0.5, clarity: 0.7, novelty: 0.4, consistency: 0.8 },
        composite: computeCompositeScore({ visualImpact: 0.5, clarity: 0.7, novelty: 0.4, consistency: 0.8 }),
        selected: true,
      },
      { slideIntentId: targetId, slideIndex }
    );

    const altCandidate = normalizeCandidate(
      {
        ...baseCandidate,
        candidateId: `cand_s${slideIndex}_rules_v2`,
        atmosphere: { ...baseCandidate.atmosphere, visualWeight: "Left-heavy" },
        scores: { visualImpact: 0.55, clarity: 0.65, novelty: 0.45, consistency: 0.78 },
        composite: computeCompositeScore({ visualImpact: 0.55, clarity: 0.65, novelty: 0.45, consistency: 0.78 }),
        selected: false,
      },
      { slideIntentId: targetId, slideIndex }
    );

    row = {
      slideIndex,
      slideIntentId: targetId,
      candidates: [baseCandidate, altCandidate],
      selectedCandidateId: baseCandidate.candidateId,
      selectedCandidate: baseCandidate,
    };
  }

  const cached = contentPackage?.brainstormCandidates?.candidatesBySlide ?? contentPackage?.brainstormCandidatesBySlide;
  const cachedRows = Array.isArray(cached) ? cached : null;
  const candidatesBySlide = keepOthers && cachedRows
    ? (() => {
        const next = cachedRows.map((r) => (toNonEmptyString(r?.slideIntentId) === targetId ? row : r));
        if (!next.some((r) => toNonEmptyString(r?.slideIntentId) === targetId)) next.push(row);
        return next;
      })()
    : [row];

  emitFn?.(DesignEvents.BRAINSTORM_CANDIDATES, {
    actor: "design",
    status: EventStatus.DATA,
    payload: {
      candidatesBySlide,
      selectedIdeas: buildSelectedIdeasFromCandidatesBySlide(candidatesBySlide),
      totalIdeas: candidatesBySlide.flatMap((r) => r?.candidates || []).length,
      selectedCount: candidatesBySlide.filter((r) => r?.selectedCandidate).length,
    },
  });

  const selectedCandidate = row.selectedCandidate;
  const visualSlots = Array.isArray(selectedCandidate?.visualSlots) ? selectedCandidate.visualSlots : [];
  const imageSlots = mapVisualSlotsToImageSlots(visualSlots, slideIntents);

  return {
    slideIntentId: targetId,
    candidates: row.candidates,
    selectedCandidate,
    visualSlots,
    imageSlots,
  };
}

/**
 * IdeaPool class for managing and querying ideas.
 */
export class IdeaPool {
  constructor(ideas = []) {
    this.ideas = Array.isArray(ideas) ? ideas : [];
  }

  add(idea) {
    this.ideas.push(idea);
  }

  getBySlide(slideIntentId) {
    return this.ideas.filter((i) => i.slideIntentId === slideIntentId);
  }

  getSelected() {
    return this.ideas.filter((i) => i.selected);
  }

  getByConceptType(conceptType) {
    return this.ideas.filter((i) => i.conceptType === conceptType);
  }

  toJSON() {
    return this.ideas;
  }

  static fromJSON(data) {
    return new IdeaPool(Array.isArray(data) ? data : []);
  }
}

export const __test = {
  createIdea,
  compositeScore,
  generateDefaultIdeas,
  rankIdeas,
  selectIdeasForSlides,
  VISUAL_CONCEPT_TYPES,
  PAGE_TYPES_FOR_IDEAS,
  extractJsonCandidate,
  normalizeCandidate,
  computeCompositeScore,
  mapVisualSlotsToImageSlots,
  buildSelectedIdeasFromCandidatesBySlide,
};
