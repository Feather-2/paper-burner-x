/**
 * Format a value as newline-separated lines.
 */
export function formatLines(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => v.trim().length > 0)
      .join("\n");
  }
  return String(value);
}

