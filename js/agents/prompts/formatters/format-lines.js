/**
 * Format a value as newline-separated lines.
 *
 * @param {unknown} value - The value to format (array or other).
 * @returns {string} Newline-separated string; arrays are joined, others are stringified.
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

