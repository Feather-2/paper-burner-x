/**
 * Layout Protocol - 统一布局协议
 * 桥接 CSS class 布局和坐标定位两种模式
 */

/** @typedef {'cover'|'content'|'two_column'|'timeline'|'chart'|'image'|'agenda'|'process'|'summary'|'appendix'} LayoutType */

/**
 * 标准布局区域定义（百分比坐标）
 * @type {Record<LayoutType, {regions: Record<string, {x:number,y:number,w:number,h:number}>}>}
 */
export const LAYOUT_REGIONS = {
  cover: {
    regions: {
      title: { x: 10, y: 35, w: 80, h: 15 },
      subtitle: { x: 10, y: 52, w: 80, h: 8 },
    },
  },
  content: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      body: { x: 5, y: 18, w: 90, h: 75 },
    },
  },
  two_column: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      left: { x: 5, y: 18, w: 43, h: 75 },
      right: { x: 52, y: 18, w: 43, h: 75 },
    },
  },
  timeline: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      track: { x: 5, y: 20, w: 90, h: 70 },
    },
  },
  chart: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      chart: { x: 10, y: 18, w: 80, h: 65 },
      caption: { x: 10, y: 85, w: 80, h: 8 },
    },
  },
  image: {
    regions: {
      image: { x: 0, y: 0, w: 100, h: 100 },
      overlay: { x: 5, y: 75, w: 90, h: 20 },
    },
  },
  agenda: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 12 },
      items: { x: 10, y: 20, w: 80, h: 70 },
    },
  },
  process: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      steps: { x: 5, y: 18, w: 90, h: 75 },
    },
  },
  summary: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      body: { x: 5, y: 18, w: 90, h: 75 },
    },
  },
  appendix: {
    regions: {
      title: { x: 5, y: 5, w: 90, h: 10 },
      body: { x: 5, y: 18, w: 90, h: 75 },
    },
  },
};

/** CSS class 到 LayoutType 的映射 */
const CSS_TO_LAYOUT = {
  hero: "cover",
  "two-column": "two_column",
  list: "content",
  standard: "content",
};

/** pageType 到 LayoutType 的映射 */
const PAGE_TYPE_TO_LAYOUT = {
  cover: "cover",
  agenda: "agenda",
  comparison: "two_column",
  process: "process",
  roadmap: "process",
  summary: "summary",
  appendix: "appendix",
  overview: "content",
};

/**
 * 从 pageType 解析布局类型
 * @param {string} pageType
 * @returns {LayoutType}
 */
export function resolveLayoutType(pageType) {
  const t = String(pageType || "").toLowerCase();
  return PAGE_TYPE_TO_LAYOUT[t] || "content";
}

/**
 * 从 CSS class 解析布局类型
 * @param {string} cssClass - 如 "layout-two-column"
 * @returns {LayoutType}
 */
export function layoutTypeFromCss(cssClass) {
  const m = String(cssClass || "").match(/layout-(\w+(?:-\w+)?)/);
  if (!m) return "content";
  const key = m[1].replace(/-/g, "_");
  return CSS_TO_LAYOUT[m[1]] || LAYOUT_REGIONS[key] ? key : "content";
}

/**
 * 获取布局区域坐标
 * @param {LayoutType} layoutType
 * @param {string} regionName
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function getRegion(layoutType, regionName) {
  return LAYOUT_REGIONS[layoutType]?.regions?.[regionName] || null;
}

/**
 * 将百分比坐标转换为 DSL data-* 属性
 * @param {{x:number,y:number,w:number,h:number}} region
 * @param {{width:number,height:number}} slideSize - 幻灯片尺寸（像素）
 * @returns {string} - 如 'data-x="50" data-y="100" data-w="400" data-h="80"'
 */
export function regionToDslAttrs(region, slideSize = { width: 960, height: 540 }) {
  const x = Math.round((region.x / 100) * slideSize.width);
  const y = Math.round((region.y / 100) * slideSize.height);
  const w = Math.round((region.w / 100) * slideSize.width);
  const h = Math.round((region.h / 100) * slideSize.height);
  return `data-x="${x}" data-y="${y}" data-w="${w}" data-h="${h}"`;
}

export default {
  LAYOUT_REGIONS,
  resolveLayoutType,
  layoutTypeFromCss,
  getRegion,
  regionToDslAttrs,
};
