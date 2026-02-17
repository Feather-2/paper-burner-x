/**
 * @fileoverview Shared Unicode-aware tokenizer for text analysis plugins.
 */

/**
 * 检测是否支持 Unicode 属性转义
 * @returns {boolean}
 */
const supportsUnicodeProperty = (() => {
  try {
    new RegExp("\\p{L}", "u");
    return true;
  } catch {
    return false;
  }
})();

/**
 * 简单分词（兼容旧浏览器）
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const pattern = supportsUnicodeProperty
    ? /[^\p{L}\p{N}\s]/gu
    : /[^a-zA-Z0-9\u00C0-\u024F\u4E00-\u9FFF\s]/g;
  return text
    .toLowerCase()
    .replace(pattern, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export { supportsUnicodeProperty };
