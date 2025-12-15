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

function normalizeScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
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
 * @param {object} options - Optional: aiApiService for LLM brainstorming, emit for events.
 * @returns {Promise<{ideaPool: Array, imageSlots: Array, selectedIdeas: Array}>}
 */
export async function brainstorm(contentPackage, designSystem, constraints = {}, options = {}) {
  const slideIntents = Array.isArray(contentPackage?.slideIntents) ? contentPackage.slideIntents : [];
  const emit = typeof options?.emit === "function" ? options.emit : null;

  emit?.("design.brainstorm.started", {
    actor: "design",
    status: "started",
    payload: { slideCount: slideIntents.length },
  });

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

  emit?.("design.brainstorm.completed", {
    actor: "design",
    status: "completed",
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
};
