/**
 * Layout Generator - 布局/原型生成器
 *
 * 生成简化版布局 HTML（线框图），用于快速预览和确认结构
 */

import { escapeHtml } from "../shared/design-utils.js";

// === 可配置常量 ===
const LAYOUT_DEFAULTS = {
  placeholderBg: "e0e0e0",
  placeholderFg: "666666",
};

/**
 * 根据 slideIntent 生成简化布局 HTML
 * @param {object} slideIntent - 幻灯片意图
 * @param {object} plan - DeckPlanner 生成的规划
 * @returns {string} 简化布局 HTML
 */
export function generateLayoutHtml(slideIntent, plan = {}) {
  const { slideIntentId, title, keyPoints = [], pageType } = slideIntent || {};
  const { layoutHint = "standard", visualFocus = "left" } = plan;

  const safeTitle = escapeHtml(title || "(未命名)");
  const safeId = escapeHtml(slideIntentId || "slide_unknown");

  // 根据 layoutHint 选择布局模板
  switch (layoutHint) {
    case "hero":
      return buildHeroLayout(safeId, safeTitle, keyPoints);
    case "two-column":
      return buildTwoColumnLayout(safeId, safeTitle, keyPoints, visualFocus);
    case "timeline":
      return buildTimelineLayout(safeId, safeTitle, keyPoints);
    case "list":
    case "dense-list":
      return buildListLayout(safeId, safeTitle, keyPoints);
    case "chart-focus":
      return buildChartFocusLayout(safeId, safeTitle, keyPoints);
    case "image-focus":
      return buildImageFocusLayout(safeId, safeTitle, keyPoints);
    default:
      return buildStandardLayout(safeId, safeTitle, keyPoints, pageType);
  }
}

/**
 * 批量生成布局
 * @param {Array} slideIntents
 * @param {Array} plans - DeckPlanner 生成的规划数组
 * @returns {Array<{slideIntentId: string, layoutHtml: string}>}
 */
export function generateLayoutBatch(slideIntents, plans = []) {
  const planMap = new Map(plans.map((p) => [p.slideIntentId, p]));
  return slideIntents.map((intent) => ({
    slideIntentId: intent.slideIntentId,
    layoutHtml: generateLayoutHtml(intent, planMap.get(intent.slideIntentId) || {}),
  }));
}

// === 布局模板 ===

function buildHeroLayout(id, title, keyPoints) {
  const subtitle = keyPoints[0] ? `<div class="layout-subtitle">${escapeHtml(keyPoints[0])}</div>` : "";
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-hero">
  <div class="layout-center">
    <div class="layout-title-large">${title}</div>
    ${subtitle}
  </div>
</section>`;
}

function buildTwoColumnLayout(id, title, keyPoints, visualFocus) {
  const leftContent = visualFocus === "right" ? buildPlaceholder("visual") : buildPointsList(keyPoints);
  const rightContent = visualFocus === "right" ? buildPointsList(keyPoints) : buildPlaceholder("visual");
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-two-column">
  <div class="layout-header"><div class="layout-title">${title}</div></div>
  <div class="layout-body layout-split">
    <div class="layout-left">${leftContent}</div>
    <div class="layout-right">${rightContent}</div>
  </div>
</section>`;
}

function buildTimelineLayout(id, title, keyPoints) {
  const items = keyPoints.slice(0, 5).map((p, i) =>
    `<div class="layout-timeline-item"><span class="layout-timeline-dot"></span><span>${escapeHtml(p)}</span></div>`
  ).join("\n    ");
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-timeline">
  <div class="layout-header"><div class="layout-title">${title}</div></div>
  <div class="layout-body layout-timeline-track">
    ${items || '<div class="layout-timeline-item"><span class="layout-timeline-dot"></span><span>(时间线项)</span></div>'}
  </div>
</section>`;
}

function buildListLayout(id, title, keyPoints) {
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-list">
  <div class="layout-header"><div class="layout-title">${title}</div></div>
  <div class="layout-body">
    ${buildPointsList(keyPoints)}
  </div>
</section>`;
}

function buildChartFocusLayout(id, title, keyPoints) {
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-chart">
  <div class="layout-header"><div class="layout-title">${title}</div></div>
  <div class="layout-body layout-center">
    ${buildPlaceholder("chart", "图表区域")}
  </div>
  <div class="layout-footer">${keyPoints[0] ? escapeHtml(keyPoints[0]) : ""}</div>
</section>`;
}

function buildImageFocusLayout(id, title, keyPoints) {
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-image">
  <div class="layout-body layout-full">
    ${buildPlaceholder("image", "全屏图片")}
  </div>
  <div class="layout-overlay">
    <div class="layout-title">${title}</div>
  </div>
</section>`;
}

function buildStandardLayout(id, title, keyPoints, pageType) {
  const hasVisual = pageType !== "bullet" && pageType !== "closing";
  return `<section data-type="freeform" data-slide-id="${id}" class="layout-wireframe layout-standard">
  <div class="layout-header"><div class="layout-title">${title}</div></div>
  <div class="layout-body${hasVisual ? " layout-with-visual" : ""}">
    ${buildPointsList(keyPoints)}
    ${hasVisual ? buildPlaceholder("visual") : ""}
  </div>
</section>`;
}

// === 辅助函数 ===

function buildPointsList(keyPoints) {
  if (!Array.isArray(keyPoints) || keyPoints.length === 0) {
    return '<ul class="layout-points"><li>(要点)</li></ul>';
  }
  const items = keyPoints.slice(0, 6).map((p) => `<li>${escapeHtml(p)}</li>`).join("");
  return `<ul class="layout-points">${items}</ul>`;
}

function buildPlaceholder(type, label) {
  const { placeholderBg, placeholderFg } = LAYOUT_DEFAULTS;
  const displayLabel = label || (type === "chart" ? "图表" : type === "image" ? "图片" : "视觉元素");
  return `<div class="layout-placeholder layout-placeholder-${type}" data-placeholder-type="${type}">
    <span class="layout-placeholder-label">${displayLabel}</span>
  </div>`;
}

export default { generateLayoutHtml, generateLayoutBatch };
