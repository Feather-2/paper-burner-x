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
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSourceKind(value) {
  return VALID_SOURCE_KINDS.has(value);
}

/**
 * 规范化 SourceKind
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSourceKind(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return VALID_SOURCE_KINDS.has(s) ? s : SourceKind.MARKDOWN;
}

/**
 * 资产 MIME 类型枚举
 * @readonly
 * @enum {string}
 */
export const AssetMimeType = Object.freeze({
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  SVG: "image/svg+xml",
  BMP: "image/bmp",
  TIFF: "image/tiff",
  ICO: "image/x-icon",
  HEIC: "image/heic",
  HEIF: "image/heif",
  EMF: "image/emf",
  WMF: "image/wmf",
  OCTET_STREAM: "application/octet-stream",
});

export const VALID_ASSET_MIME_TYPES = Object.freeze(
  new Set(Object.values(AssetMimeType))
);

const ASSET_MIME_ALIASES = Object.freeze(
  new Map([
    ["image/jpg", AssetMimeType.JPEG],
    ["image/pjpeg", AssetMimeType.JPEG],
    ["image/x-png", AssetMimeType.PNG],
    ["image/svg", AssetMimeType.SVG],
  ])
);

/**
 * 验证资产 MIME 类型
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAssetMimeType(value) {
  return VALID_ASSET_MIME_TYPES.has(value);
}

/**
 * 规范化资产 MIME 类型（支持别名/参数，如 `image/jpeg; charset=utf-8`）
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeAssetMimeType(value, fallback = AssetMimeType.OCTET_STREAM) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const base = raw.split(";")[0] || "";
  const aliased = ASSET_MIME_ALIASES.get(base) || base;
  return VALID_ASSET_MIME_TYPES.has(aliased) ? aliased : fallback;
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
