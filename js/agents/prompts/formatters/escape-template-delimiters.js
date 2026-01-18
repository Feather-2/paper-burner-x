/**
 * Escape `{{` and `}}` sequences inside interpolated values.
 *
 * This prevents user-controlled content from injecting new template placeholders
 * into subsequent renders while keeping the prompt readable.
 *
 * @param {unknown} value - The value to escape (converted to string if needed).
 * @returns {string} The escaped string with zero-width breaks inserted between braces.
 */
export function escapeTemplateDelimiters(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!s) return s;
  // Insert a zero-width break between braces to break the delimiter sequence.
  // Use split/join for broader browser compatibility (replaceAll requires ES2021+).
  return s.split("{{").join(`{\u200B{`).split("}}").join(`}\u200B}`);
}

