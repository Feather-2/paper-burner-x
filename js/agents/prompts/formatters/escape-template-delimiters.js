/**
 * Escape `{{` and `}}` sequences inside interpolated values.
 *
 * This prevents user-controlled content from injecting new template placeholders
 * into subsequent renders while keeping the prompt readable.
 *
 * Uses backslash escaping (`\{\{` / `\}\}`) instead of zero-width characters,
 * which is more robust against Unicode normalizers and text processing pipelines.
 *
 * @param {unknown} value - The value to escape (converted to string if needed).
 * @returns {string} The escaped string with backslash-escaped braces.
 */
export function escapeTemplateDelimiters(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!s) return s;
  return s.split("{{").join("\\{\\{").split("}}").join("\\}\\}");
}

