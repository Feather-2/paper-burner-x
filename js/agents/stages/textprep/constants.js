// js/agents/stages/textprep/constants.js
// TextPrep 模块常量枚举

/**
 * 页面类型枚举 - 统一 slideplan 和 eval 的定义
 * @readonly
 * @enum {string}
 */
export const PageType = Object.freeze({
  COVER: "cover",
  AGENDA: "agenda",
  OVERVIEW: "overview",
  COMPARISON: "comparison",
  PROCESS: "process",
  SUMMARY: "summary",
  APPENDIX: "appendix",
  ARCHITECTURE: "architecture",
  CONCLUSION: "conclusion",
});

/**
 * 允许的页面类型集合 - 用于 slideplan 验证
 */
export const ALLOWED_PAGE_TYPES = Object.freeze(
  new Set(Object.values(PageType))
);

/**
 * 关键页面类型集合 - 用于 eval 验证
 */
export const KEY_PAGE_TYPES = Object.freeze(
  new Set([
    PageType.COVER,
    PageType.AGENDA,
    PageType.ARCHITECTURE,
    PageType.OVERVIEW,
    PageType.SUMMARY,
    PageType.CONCLUSION,
  ])
);

/**
 * 验证 PageType 值
 * @param {unknown} value - 待验证的值
 * @returns {boolean} 是否为合法的 PageType
 */
export function isValidPageType(value) {
  return ALLOWED_PAGE_TYPES.has(/** @type {any} */ (value));
}

/**
 * 规范化页面类型
 * @param {unknown} t
 * @returns {string | null}
 */
export function normalizePageType(t) {
  const s = String(t || "")
    .trim()
    .toLowerCase();
  return ALLOWED_PAGE_TYPES.has(/** @type {any} */ (s)) ? s : null;
}
