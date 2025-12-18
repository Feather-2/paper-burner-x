import { loadPrompt } from "../../prompts/prompt-loader.js";

function safeJson(v, maxLen = 8000) {
  const s = JSON.stringify(v ?? null, null, 2);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n...<truncated>";
}

// 缓存的提示词
let _brainstormSystemPrompt = null;
let _brainstormReviewPrompt = null;

// Fallback prompts (minimal version)
const FALLBACK_BRAINSTORM_SYSTEM = `You are a Visual Planner for presentation design.
For EACH slide, decide what visual elements are needed and where to place them.
Output JSON: {"slideResults": [{"slideIntentId": "string", "slideIndex": number, "visualSlots": [...]}]}`;

const FALLBACK_REVIEW_SYSTEM = `You are an Art Director reviewing presentation slide visual concepts.
Score each candidate from 0.0 to 1.0 on: visualImpact, clarity, novelty, consistency.
Output JSON: {"slideReviews": [{"slideIntentId": "string", "selectedCandidateId": "string", "reviews": [...]}]}`;

/**
 * 异步获取 brainstorm system prompt
 */
export async function getBrainstormSystemPrompt() {
  if (_brainstormSystemPrompt) return _brainstormSystemPrompt;
  try {
    _brainstormSystemPrompt = await loadPrompt("design/brainstorm-system");
    return _brainstormSystemPrompt;
  } catch (e) {
    console.warn("[brainstorm-prompts] Failed to load brainstorm-system.md:", e.message);
    return FALLBACK_BRAINSTORM_SYSTEM;
  }
}

/**
 * 异步获取 review system prompt
 */
export async function getBrainstormReviewPrompt() {
  if (_brainstormReviewPrompt) return _brainstormReviewPrompt;
  try {
    _brainstormReviewPrompt = await loadPrompt("design/brainstorm-review");
    return _brainstormReviewPrompt;
  } catch (e) {
    console.warn("[brainstorm-prompts] Failed to load brainstorm-review.md:", e.message);
    return FALLBACK_REVIEW_SYSTEM;
  }
}

// 向后兼容：同步导出（首次访问时返回 fallback）
export const BRAINSTORM_SYSTEM_PROMPT = new Proxy({}, {
  get(_, prop) {
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
      return () => _brainstormSystemPrompt || FALLBACK_BRAINSTORM_SYSTEM;
    }
    return (_brainstormSystemPrompt || FALLBACK_BRAINSTORM_SYSTEM)[prop];
  }
});

export const BRAINSTORM_REVIEW_PROMPT = new Proxy({}, {
  get(_, prop) {
    if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
      return () => _brainstormReviewPrompt || FALLBACK_REVIEW_SYSTEM;
    }
    return (_brainstormReviewPrompt || FALLBACK_REVIEW_SYSTEM)[prop];
  }
});

export function buildBrainstormPrompt(slideIntentsOrSingle, designSystem, dslEffects, styleSpec, availableAssets) {
  const slideIntents = Array.isArray(slideIntentsOrSingle) ? slideIntentsOrSingle : [slideIntentsOrSingle];

  const parts = [
    `Plan visual elements for ${slideIntents.length} slide(s).`,
    "",
    "slideIntents:",
    safeJson(
      slideIntents.map((si, idx) => ({
        slideIntentId: si?.slideIntentId || si?.slideIntentID,
        slideIndex: si?.slideIndex ?? idx,
        pageType: si?.pageType,
        title: si?.title,
        objective: si?.objective,
        keyPoints: si?.keyPoints,
      })),
      8000
    ),
  ];

  // 设计规范（简化）
  if (designSystem?.designTokens) {
    parts.push(
      "",
      "designTokens (colors/fonts to use):",
      safeJson({ colors: designSystem.designTokens.colors, fonts: designSystem.designTokens.fonts }, 2000)
    );
  }

  // 可用资源
  const assets = Array.isArray(availableAssets) ? availableAssets : [];
  if (assets.length > 0) {
    const assetSummaries = assets.slice(0, 15).map((a) => ({
      assetId: a?.assetId,
      description: a?.understanding?.description || "",
      category: a?.understanding?.category || "image",
      suggestedUse: a?.understanding?.suggestedUse || [],
    }));
    parts.push(
      "",
      `availableAssets (${assets.length} images to reuse):`,
      safeJson(assetSummaries, 3000)
    );
  }

  // 风格参考（简化）
  if (styleSpec?.colorTone || styleSpec?.designTraits?.colorTone) {
    parts.push(
      "",
      "styleHint:",
      safeJson({ colorTone: styleSpec?.colorTone || styleSpec?.designTraits?.colorTone }, 500)
    );
  }

  parts.push("", "Return JSON ONLY.");
  return parts.join("\n");
}

export function buildReviewPrompt(slideIntentsOrSingle, candidatesOrBatch, designSystem) {
  // Support both single slideIntent and array of slideIntents
  // candidatesOrBatch: either Array<candidate> for single slide, or Array<{slideIntentId, slideIndex, candidates}> for batch
  const isBatch = Array.isArray(slideIntentsOrSingle) && slideIntentsOrSingle.length > 1;

  if (isBatch) {
    // Batch mode: candidatesOrBatch is Array<{slideIntentId, slideIndex, candidates}>
    const batchData = Array.isArray(candidatesOrBatch) ? candidatesOrBatch : [];
    return [
      `Review the candidates for ${batchData.length} slides and provide scores for each.`,
      "",
      "slideData:",
      safeJson(
        batchData.map((item) => ({
          slideIntentId: item?.slideIntentId,
          slideIndex: item?.slideIndex,
          pageType: item?.pageType,
          title: item?.title,
          objective: item?.objective,
          candidates: (Array.isArray(item?.candidates) ? item.candidates : []).map((c) => ({
            candidateId: c?.candidateId,
            atmosphere: c?.atmosphere,
            elementsMarkdown: c?.elementsMarkdown,
            visualSlots: c?.visualSlots,
          })),
        })),
        16000
      ),
      "",
      "designSystem:",
      safeJson(
        {
          theme: designSystem?.theme,
          designTokens: designSystem?.designTokens,
        },
        3000
      ),
      "",
      "Return JSON ONLY.",
    ].join("\n");
  }

  // Single slide mode (backward compatible)
  const slideIntent = Array.isArray(slideIntentsOrSingle) ? slideIntentsOrSingle[0] : slideIntentsOrSingle;
  const candidates = Array.isArray(candidatesOrBatch) ? candidatesOrBatch : [];
  return [
    "Review the candidates for the given slide and provide scores.",
    "",
    "slideIntent:",
    safeJson(
      {
        slideIntentId: slideIntent?.slideIntentId || slideIntent?.slideIntentID,
        pageType: slideIntent?.pageType,
        title: slideIntent?.title,
        objective: slideIntent?.objective,
      },
      2500
    ),
    "",
    "candidates:",
    safeJson(
      candidates.map((c) => ({
        candidateId: c?.candidateId,
        atmosphere: c?.atmosphere,
        elementsMarkdown: c?.elementsMarkdown,
        visualSlots: c?.visualSlots,
      })),
      8000
    ),
    "",
    "Return JSON ONLY.",
  ].join("\n");
}

export const __test = { safeJson };
