function normalizeMaxChars(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const DEFAULT_MAX_CHARS = 1_000_000;

/**
 * Best-effort JSON.parse with a size guard.
 *
 * Note: JSON.parse is synchronous and cannot be truly timed out. Limiting input size
 * bounds worst-case parse time and avoids UI freezes on huge payloads.
 *
 * @param {any} value
 * @param {{maxChars?: number}} [options]
 * @returns {any|null}
 */
export function safeJsonParse(value, options) {
  const { maxChars } = options && typeof options === "object" ? options : {};
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  const raw = typeof value === "string" ? value : String(value);
  const s = raw.trim();
  if (!s) return null;

  const limit = normalizeMaxChars(maxChars, DEFAULT_MAX_CHARS);
  if (limit !== Infinity && s.length > limit) return null;

  try {
    return JSON.parse(s, (key, parsedValue) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return undefined;
      }
      return parsedValue;
    });
  } catch {
    return null;
  }
}

/**
 * Reviver that strips prototype-polluting keys.
 * Use as: JSON.parse(text, protoSafeReviver) — preserves throw semantics.
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
export function protoSafeReviver(key, value) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return value;
}

export default { safeJsonParse, protoSafeReviver };
