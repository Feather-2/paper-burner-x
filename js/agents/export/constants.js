// Export 相关枚举与工具函数

/**
 * 导出格式枚举
 * @readonly
 * @enum {string}
 */
export const ExportFormat = Object.freeze({
  PPTX: "pptx",
  PDF: "pdf",
  IMAGES: "images",
});

export function isValidExportFormat(value) {
  return Object.values(ExportFormat).includes(value);
}

export function normalizeExportFormat(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidExportFormat(v) ? v : undefined;
}
