// js/agents/ingest/constants.js
// Ingest 模块常量枚举

/**
 * 数据源类型枚举 - 统一所有 adapter 的 sourceType
 * @readonly
 * @enum {string}
 */
export const SourceKind = Object.freeze({
  // 文档类型
  PDF: "pdf",
  DOCX: "docx",
  PPTX: "pptx",
  EPUB: "epub",
  HTML: "html",
  MARKDOWN: "markdown",

  // 媒体类型
  VIDEO: "video",
  AUDIO: "audio",

  // 代码类型
  CODE: "code",

  // 用户输入
  USER_TEXT: "user_text",

  // 特殊类型
  DIRECT_MERGED: "direct_merged",
  URL: "url",
  FILE: "file",
});

/**
 * 所有有效的 SourceKind 值集合
 */
export const VALID_SOURCE_KINDS = Object.freeze(
  new Set(Object.values(SourceKind))
);

/**
 * 文档类型子集
 */
export const DOCUMENT_SOURCE_KINDS = Object.freeze(
  new Set([
    SourceKind.PDF,
    SourceKind.DOCX,
    SourceKind.PPTX,
    SourceKind.EPUB,
    SourceKind.HTML,
    SourceKind.MARKDOWN,
  ])
);

/**
 * 媒体类型子集
 */
export const MEDIA_SOURCE_KINDS = Object.freeze(
  new Set([SourceKind.VIDEO, SourceKind.AUDIO])
);

/**
 * 验证 SourceKind 值
 */
export function isValidSourceKind(value) {
  return VALID_SOURCE_KINDS.has(value);
}

/**
 * 规范化 SourceKind
 */
export function normalizeSourceKind(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return VALID_SOURCE_KINDS.has(s) ? s : SourceKind.MARKDOWN;
}

/**
 * 导出格式枚举
 * @readonly
 * @enum {string}
 */
export const ExportFormat = Object.freeze({
  PPTX: "pptx",
  PDF: "pdf",
  HTML: "html",
  MARKDOWN: "markdown",
  JSON: "json",
});
