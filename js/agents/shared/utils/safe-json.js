function normalizeMaxChars(value, fallback) {
  if (value === Infinity) return Infinity;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

const DEFAULT_MAX_CHARS = 1_000_000;
const SAFE_JSON_OK = "ok";
const SAFE_JSON_NULLISH = "nullish";
const SAFE_JSON_EMPTY = "empty";
const SAFE_JSON_OVERSIZED = "oversized";
const SAFE_JSON_INVALID_JSON = "invalid_json";

/**
 * @typedef {object} SafeJsonParseDetailedResult
 * @property {boolean} ok
 * @property {any|null} value
 * @property {"ok"|"nullish"|"empty"|"oversized"|"invalid_json"} code
 * @property {number=} maxChars
 * @property {number=} observedChars
 * @property {string=} error
 */

function normalizeErrorMessage(err) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const normalized = msg.trim();
  return normalized || "JSON parse failed";
}

/**
 * Safe JSON parse with structured diagnostics.
 *
 * @param {any} value
 * @param {{maxChars?: number}} [options]
 * @returns {SafeJsonParseDetailedResult}
 */
export function safeJsonParseDetailed(value, options) {
  const { maxChars } = options && typeof options === "object" ? options : {};
  if (value === null || value === undefined) {
    return { ok: false, value: null, code: SAFE_JSON_NULLISH };
  }
  if (typeof value === "object") {
    return { ok: true, value, code: SAFE_JSON_OK };
  }

  const raw = typeof value === "string" ? value : String(value);
  const s = raw.trim();
  if (!s) {
    return { ok: false, value: null, code: SAFE_JSON_EMPTY };
  }

  const limit = normalizeMaxChars(maxChars, DEFAULT_MAX_CHARS);
  if (limit !== Infinity && s.length > limit) {
    return {
      ok: false,
      value: null,
      code: SAFE_JSON_OVERSIZED,
      maxChars: limit,
      observedChars: s.length,
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(s, protoSafeReviver),
      code: SAFE_JSON_OK,
    };
  } catch (err) {
    return {
      ok: false,
      value: null,
      code: SAFE_JSON_INVALID_JSON,
      error: normalizeErrorMessage(err),
      observedChars: s.length,
    };
  }
}

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
  const parsed = safeJsonParseDetailed(value, options);
  return parsed.ok ? parsed.value : null;
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

export default { safeJsonParse, safeJsonParseDetailed, protoSafeReviver };
