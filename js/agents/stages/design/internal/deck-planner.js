/**
 * DeckPlanner - 幻灯片规划器
 *
 * 在大纲解析后、生成前，为每页生成 SlideIntent 增强信息：
 * - 视觉重心 (visualFocus)
 * - 排版建议 (layoutHint)
 * - 核心卖点 (keyMessage)
 * - 视觉初衷 (visualIntent) - 描述这页想要传达的视觉感受
 * - 卖点说明 (sellingPoint) - 这页的核心价值主张
 */

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

/**
 * 页面类型到默认布局的映射
 */
const PAGE_TYPE_LAYOUTS = {
  cover: {
    visualFocus: "center",
    layoutHint: "hero",
    keyMessage: "title",
    visualIntent: "震撼开场，建立品牌印象",
    sellingPoint: "一句话抓住观众注意力",
  },
  title: {
    visualFocus: "center",
    layoutHint: "hero",
    keyMessage: "title",
    visualIntent: "清晰的章节划分，承上启下",
    sellingPoint: "明确本节核心主题",
  },
  content: {
    visualFocus: "left",
    layoutHint: "two-column",
    keyMessage: "points",
    visualIntent: "信息层次分明，易于扫读",
    sellingPoint: "传递关键论点和支撑证据",
  },
  bullet: {
    visualFocus: "left",
    layoutHint: "list",
    keyMessage: "points",
    visualIntent: "简洁有力，逐条呈现",
    sellingPoint: "快速传递多个要点",
  },
  comparison: {
    visualFocus: "split",
    layoutHint: "two-column",
    keyMessage: "contrast",
    visualIntent: "对比鲜明，差异一目了然",
    sellingPoint: "突出优势或展示选择",
  },
  timeline: {
    visualFocus: "horizontal",
    layoutHint: "timeline",
    keyMessage: "sequence",
    visualIntent: "时间线清晰，节奏感强",
    sellingPoint: "展示发展历程或计划阶段",
  },
  chart: {
    visualFocus: "center",
    layoutHint: "chart-focus",
    keyMessage: "data",
    visualIntent: "数据可视化，洞察一目了然",
    sellingPoint: "用数据说话，增强说服力",
  },
  image: {
    visualFocus: "full",
    layoutHint: "image-focus",
    keyMessage: "visual",
    visualIntent: "视觉冲击，情感共鸣",
    sellingPoint: "用画面讲故事",
  },
  quote: {
    visualFocus: "center",
    layoutHint: "quote",
    keyMessage: "quote",
    visualIntent: "权威背书，增强可信度",
    sellingPoint: "借他人之口传递观点",
  },
  summary: {
    visualFocus: "center",
    layoutHint: "summary",
    keyMessage: "recap",
    visualIntent: "回顾要点，强化记忆",
    sellingPoint: "确保核心信息被记住",
  },
  closing: {
    visualFocus: "center",
    layoutHint: "hero",
    keyMessage: "cta",
    visualIntent: "有力收尾，推动行动",
    sellingPoint: "明确下一步行动号召",
  },
  default: {
    visualFocus: "left",
    layoutHint: "standard",
    keyMessage: "points",
    visualIntent: "清晰传达，平衡美观",
    sellingPoint: "有效传递信息",
  },
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
  let visualIntent = defaults.visualIntent;
  let sellingPoint = defaults.sellingPoint;

  // 首页强调标题
  if (isFirst && pageType !== "cover") {
    visualFocus = "center";
    layoutHint = "hero";
    visualIntent = "开篇定调，吸引注意";
  }

  // 末页强调行动号召
  if (isLast && pageType !== "closing") {
    keyMessage = "cta";
    sellingPoint = "推动观众采取行动";
  }

  // 根据内容量调整
  const keyPoints = slideIntent?.keyPoints || [];
  if (keyPoints.length > 5) {
    layoutHint = "dense-list";
    visualIntent = "信息密集，高效传递";
  } else if (keyPoints.length <= 2) {
    layoutHint = "spacious";
    visualIntent = "留白充足，聚焦重点";
  }

  // 根据标题生成更具体的卖点
  const title = slideIntent?.title || "";
  if (title) {
    sellingPoint = `通过「${title.slice(0, 20)}${title.length > 20 ? "..." : ""}」${defaults.sellingPoint}`;
  }

  return {
    slideIntentId: slideIntent?.slideIntentId || `slide_${index}`,
    slideIndex: index,
    pageType,
    title,
    visualFocus,
    layoutHint,
    keyMessage,
    visualIntent,
    sellingPoint,
    contentDensity: keyPoints.length > 4 ? "high" : keyPoints.length > 2 ? "medium" : "low",
    suggestedEmphasis: isFirst ? "brand" : isLast ? "action" : "content",
  };
}

/**
 * 为整个 deck 生成规划
 *
 * @param {Array<{ pageType?: string, title?: string, keyPoints?: string[], slideIntentId?: string }>} slideIntents - 页面意图列表
 * @param {{ theme?: string, tokens?: any }} [designSystem] - 设计系统配置
 * @param {{ [key: string]: any }} [options={}] - 附加选项
 * @returns {{ plans: Array<{ slideIntentId: string, slideIndex: number, pageType: string, title: string, visualFocus: string, layoutHint: string, keyMessage: string, visualIntent: string, sellingPoint: string, contentDensity: string, suggestedEmphasis: string }>, summary: string, metadata?: { totalSlides: number, pageTypes: string[], densityDistribution: { high: number, medium: number, low: number }, theme: string } }}
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
 *
 * @param {Array<{ slideIntentId: string, [key: string]: any }>} plans - 当前规划列表
 * @param {Array<{ slideIntentId?: string, slideIndex?: number, visualFocus?: string, layoutHint?: string, keyMessage?: string, visualIntent?: string, sellingPoint?: string }>} [edits] - 用户编辑列表
 * @returns {Array<{ slideIntentId: string, userOverride?: boolean, [key: string]: any }>} 合并后的规划
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
      visualIntent: toNonEmptyString(edit.visualIntent) || plan.visualIntent,
      sellingPoint: toNonEmptyString(edit.sellingPoint) || plan.sellingPoint,
      userOverride: true,
    };
  });
}

/**
 * 格式化规划为用户可读文本（表格形式）
 *
 * @param {Array<{ pageType: string, title?: string, layoutHint: string, visualFocus: string }>} plans - 规划列表
 * @returns {string} 格式化后的表格文本
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

/**
 * 格式化规划为对话友好格式（用于用户交互）
 *
 * @param {Array<{ slideIntentId: string, title?: string, pageType: string, layoutHint: string, visualIntent: string, sellingPoint: string }>} plans - 规划列表
 * @returns {{ text: string, cards: Array<{ slideNo: number, slideIntentId: string, title: string, pageType: string, layoutHint: string, visualIntent: string, sellingPoint: string, editable: string[] }>, instructions?: string[] }}
 */
export function formatPlanForDialog(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    return { text: "暂无规划内容。", cards: [] };
  }

  const cards = plans.map((plan, i) => ({
    slideNo: i + 1,
    slideIntentId: plan.slideIntentId,
    title: plan.title || "(未命名)",
    pageType: plan.pageType,
    layoutHint: plan.layoutHint,
    visualIntent: plan.visualIntent,
    sellingPoint: plan.sellingPoint,
    editable: ["layoutHint", "visualIntent", "sellingPoint"],
  }));

  const text = plans
    .map((plan, i) => {
      const no = i + 1;
      return [
        `**第 ${no} 页** - ${plan.title || "(未命名)"}`,
        `  📐 布局: ${plan.layoutHint}`,
        `  🎯 视觉初衷: ${plan.visualIntent}`,
        `  💡 核心卖点: ${plan.sellingPoint}`,
      ].join("\n");
    })
    .join("\n\n");

  return {
    text: `以下是幻灯片预案，您可以调整任意页面的布局、视觉初衷或核心卖点：\n\n${text}\n\n请告诉我您想修改哪些内容，或输入"确认"开始生成。`,
    cards,
    instructions: [
      "示例调整指令：",
      "- 「第3页用瀑布流展示」",
      "- 「第5页要对比两个产品」",
      "- 「把第2页改成时间线布局」",
    ],
  };
}

/**
 * 解析用户对规划的反馈（简单模式）
 * 复杂的自然语言理解交给 AI
 *
 * @param {string} feedback - 用户反馈文本
 * @param {Array<{ slideIntentId?: string }>} plans - 当前规划列表
 * @returns {Array<{ slideIndex: number, layoutHint?: string }>} 解析出的编辑列表
 */
export function parseSimpleFeedback(feedback, plans) {
  if (!feedback || typeof feedback !== "string") return [];

  const edits = [];
  const lines = feedback.split(/[,，;；\n]/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配 "第N页" 模式
    const slideMatch = trimmed.match(/第\s*(\d+)\s*页/);
    if (!slideMatch) continue;

    const slideIndex = parseInt(slideMatch[1], 10) - 1;
    if (slideIndex < 0 || slideIndex >= plans.length) continue;

    const edit = { slideIndex };

    // 匹配布局关键词
    const layoutKeywords = {
      瀑布流: "waterfall",
      时间线: "timeline",
      对比: "two-column",
      双栏: "two-column",
      全图: "image-focus",
      图表: "chart-focus",
      列表: "list",
      居中: "hero",
    };

    for (const [keyword, layout] of Object.entries(layoutKeywords)) {
      if (trimmed.includes(keyword)) {
        edit.layoutHint = layout;
        break;
      }
    }

    if (Object.keys(edit).length > 1) {
      edits.push(edit);
    }
  }

  return edits;
}

/**
 * 使用 LLM 解析复杂反馈
 * @param {string} feedback - 用户反馈
 * @param {Array} plans - 当前规划
 * @param {Function} llmCall - LLM 调用函数 (prompt) => Promise<string>
 * @returns {Promise<Array>} 解析出的编辑列表
 */
export async function parseFeedbackWithLLM(feedback, plans, llmCall) {
  if (!feedback || typeof feedback !== "string" || !llmCall) {
    return parseSimpleFeedback(feedback, plans);
  }

  const planSummary = plans
    .map((p, i) => `${i + 1}. [${p.pageType}] ${p.title || "(untitled)"} - ${p.layoutHint}`)
    .join("\n");

  const prompt = `解析用户对幻灯片规划的修改意图。

当前规划：
${planSummary}

用户反馈：
${feedback}

输出 JSON 数组，每项包含：
- slideIndex: 页码索引（从0开始）
- layoutHint?: 新布局（hero/two-column/timeline/chart-focus/image-focus/list/waterfall）
- visualIntent?: 新的视觉初衷
- sellingPoint?: 新的核心卖点

仅输出 JSON，无其他文字。`;

  try {
    const result = await llmCall(prompt);
    // 限制解析长度，防止资源消耗攻击
    const trimmed = String(result || "").slice(0, 50000).replace(/```json?\n?|\n?```/g, "").trim();
    if (!trimmed) return parseSimpleFeedback(feedback, plans);

    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];

    // 校验每个元素结构，过滤非法项
    const MAX_EDITS = 100;
    const validEdits = [];
    for (const item of parsed.slice(0, MAX_EDITS)) {
      if (typeof item !== "object" || item === null) continue;
      const slideIndex = Number(item.slideIndex);
      if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= plans.length) continue;

      const edit = { slideIndex };
      if (typeof item.layoutHint === "string") edit.layoutHint = item.layoutHint.slice(0, 50);
      if (typeof item.visualIntent === "string") edit.visualIntent = item.visualIntent.slice(0, 200);
      if (typeof item.sellingPoint === "string") edit.sellingPoint = item.sellingPoint.slice(0, 200);

      // 至少有一个有效字段才保留
      if (Object.keys(edit).length > 1) validEdits.push(edit);
    }
    return validEdits;
  } catch {
    return parseSimpleFeedback(feedback, plans);
  }
}

export class DeckPlanner {
  constructor(options = {}) {
    this.options = options;
    this.llmCall = options.llmCall || null;
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

  formatForDialog(plans) {
    return formatPlanForDialog(plans);
  }

  parseSimpleFeedback(feedback, plans) {
    return parseSimpleFeedback(feedback, plans);
  }

  async parseFeedback(feedback, plans) {
    if (this.llmCall) {
      return parseFeedbackWithLLM(feedback, plans, this.llmCall);
    }
    return parseSimpleFeedback(feedback, plans);
  }
}
