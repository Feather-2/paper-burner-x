/**
 * Escape `{{` and `}}` sequences inside interpolated values.
 *
 * This prevents user-controlled content from injecting new template placeholders
 * into subsequent renders while keeping the prompt readable.
 */
export function escapeTemplateDelimiters(value) {
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!s) return s;
  // Insert a zero-width break between braces to break the delimiter sequence.
  return s.replaceAll("{{", `{\u200B{`).replaceAll("}}", `}\u200B}`);
}

