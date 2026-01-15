/**
 * Format a value into a markdown-ish bullet list.
 *
 * - Arrays become `- item` lines.
 * - Strings are split by newlines into bullet lines.
 * - Other values become a single bullet.
 */
export function formatBullets(value, { bullet = "- ", indent = "" } = {}) {
  const prefix = `${indent}${bullet}`;

  if (value == null) return "";

  if (Array.isArray(value)) {
    return value
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => v.trim().length > 0)
      .map((v) => `${prefix}${v}`)
      .join("\n");
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n/g)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .map((line) => `${prefix}${line}`)
      .join("\n");
  }

  const s = String(value);
  return s.trim().length ? `${prefix}${s}` : "";
}

