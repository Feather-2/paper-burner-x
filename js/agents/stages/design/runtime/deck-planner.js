/**
 * DeckPlanner - 幻灯片规划器
 *
 * 在大纲解析后、生成前，为每页生成 SlideIntent 增强信息：
 * - 视觉重心 (visualFocus)
 * - 排版建议 (layoutHint)
 * - 核心卖点 (keyMessage)
 */

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

/**
 * 页面类型到默认布局的映射
 */
const PAGE_TYPE_LAYOUTS = {
  cover: { visualFocus: "center", layoutHint: "hero", keyMessage: "title" },
  title: { visualFocus: "center", layoutHint: "hero", keyMessage: "title" },
  content: { visualFocus: "left", layoutHint: "two-column", keyMessage: "points" },
  bullet: { visualFocus: "left", layoutHint: "list", keyMessage: "points" },
  comparison: { visualFocus: "split", layoutHint: "two-column", keyMessage: "contrast" },
  timeline: { visualFocus: "horizontal", layoutHint: "timeline", keyMessage: "sequence" },
  chart: { visualFocus: "center", layoutHint: "chart-focus", keyMessage: "data" },
  image: { visualFocus: "full", layoutHint: "image-focus", keyMessage: "visual" },
  quote: { visualFocus: "center", layoutHint: "quote", keyMessage: "quote" },
  summary: { visualFocus: "center", layoutHint: "summary", keyMessage: "recap" },
  closing: { visualFocus: "center", layoutHint: "hero", keyMessage: "cta" },
  default: { visualFocus: "left", layoutHint: "standard", keyMessage: "points" },
};

/**
 * 分析 slideIntent 并生成规划建议
 */
function analyzeSlideIntent(slideIntent, index, totalSlides) {
  const pageType = toNonEmptyString(slideIntent?.pageType) || "content";
  const defaults = PAGE_TYPE_LAYOUTS[pageType] || PAGE_TYPE_LAYOUTS.default;

  // 根据位置调整
  const isFirst = index === 0;
  const isLast = index === totalSlides - 1;

  let visualFocus = defaults.visualFocus;
  let layoutHint = defaults.layoutHint;
  let keyMessage = defaults.keyMessage;

  // 首页强调标题
  if (isFirst && pageType !== "cover") {
    visualFocus = "center";
    layoutHint = "hero";
  }

  // 末页强调行动号召
  if (isLast && pageType !== "closing") {
    keyMessage = "cta";
  }

  // 根据内容量调整
  const keyPoints = slideIntent?.keyPoints || [];
  if (keyPoints.length > 5) {
    layoutHint = "dense-list";
  } else if (keyPoints.length <= 2) {
    layoutHint = "spacious";
  }

  return {
    slideIntentId: slideIntent?.slideIntentId || `slide_${index}`,
    slideIndex: index,
    pageType,
    title: slideIntent?.title || "",
    visualFocus,
    layoutHint,
    keyMessage,
    contentDensity: keyPoints.length > 4 ? "high" : keyPoints.length > 2 ? "medium" : "low",
    suggestedEmphasis: isFirst ? "brand" : isLast ? "action" : "content",
  };
}

/**
 * 为整个 deck 生成规划
 */
export function planDeck(slideIntents, designSystem, options = {}) {
  if (!Array.isArray(slideIntents) || slideIntents.length === 0) {
    return { plans: [], summary: "No slides to plan" };
  }

  const plans = slideIntents.map((intent, index) =>
    analyzeSlideIntent(intent, index, slideIntents.length)
  );

  // 生成摘要
  const pageTypes = plans.map((p) => p.pageType);
  const uniqueTypes = [...new Set(pageTypes)];
  const densityDistribution = {
    high: plans.filter((p) => p.contentDensity === "high").length,
    medium: plans.filter((p) => p.contentDensity === "medium").length,
    low: plans.filter((p) => p.contentDensity === "low").length,
  };

  const summary = `${plans.length} slides planned: ${uniqueTypes.join(", ")}. Density: ${densityDistribution.high}H/${densityDistribution.medium}M/${densityDistribution.low}L`;

  return {
    plans,
    summary,
    metadata: {
      totalSlides: plans.length,
      pageTypes: uniqueTypes,
      densityDistribution,
      theme: designSystem?.theme || "default",
    },
  };
}

/**
 * 应用用户修改到规划
 */
export function applyUserEdits(plans, edits) {
  if (!Array.isArray(edits)) return plans;

  const editMap = new Map();
  for (const edit of edits) {
    if (edit?.slideIntentId) {
      editMap.set(edit.slideIntentId, edit);
    } else if (typeof edit?.slideIndex === "number") {
      const plan = plans[edit.slideIndex];
      if (plan) editMap.set(plan.slideIntentId, edit);
    }
  }

  return plans.map((plan) => {
    const edit = editMap.get(plan.slideIntentId);
    if (!edit) return plan;

    return {
      ...plan,
      visualFocus: toNonEmptyString(edit.visualFocus) || plan.visualFocus,
      layoutHint: toNonEmptyString(edit.layoutHint) || plan.layoutHint,
      keyMessage: toNonEmptyString(edit.keyMessage) || plan.keyMessage,
      userOverride: true,
    };
  });
}

/**
 * 格式化规划为用户可读文本
 */
export function formatPlanForReview(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return "No plans to review.";
  }

  const lines = plans.map((plan, i) => {
    const num = String(i + 1).padStart(2, " ");
    const type = plan.pageType.padEnd(12);
    const title = (plan.title || "(untitled)").slice(0, 30).padEnd(30);
    const layout = plan.layoutHint.padEnd(15);
    const focus = plan.visualFocus;
    return `${num}. [${type}] ${title} | ${layout} | ${focus}`;
  });

  return [
    "=== Deck Plan ===",
    "No. Type         Title                          Layout          Focus",
    "-".repeat(80),
    ...lines,
    "-".repeat(80),
  ].join("\n");
}

export class DeckPlanner {
  constructor(options = {}) {
    this.options = options;
  }

  plan(slideIntents, designSystem) {
    return planDeck(slideIntents, designSystem, this.options);
  }

  applyEdits(plans, edits) {
    return applyUserEdits(plans, edits);
  }

  format(plans) {
    return formatPlanForReview(plans);
  }
}
