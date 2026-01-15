/**
 * Format a value as a trimmed string.
 */
export function formatTrim(value) {
  if (value == null) return "";
  return String(value).trim();
}

