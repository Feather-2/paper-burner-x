/**
 * Shared value utilities with consistent semantic contracts.
 *
 * All functions are total (never throw for normal JS values) and return a
 * single, explicit "invalid" sentinel per function:
 * - `toNonEmptyString`: `undefined` for empty/invalid
 * - `safeInt` / `safeNumber`: `null` for invalid
 */

/**
 * Returns true only for "plain" objects: object literals (or equivalent) whose
 * prototype is `Object.prototype` or `null`.
 *
 * @param {any} v
 * @returns {boolean}
 */
export function isPlainObject(v) {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Converts a value to a trimmed, non-empty string; otherwise returns `undefined`.
 *
 * @param {any} v
 * @returns {string|undefined}
 */
export function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Safely converts to a finite number; invalid values return `null`.
 * Accepts numbers and non-empty numeric strings (via `Number()`).
 *
 * @param {any} n
 * @returns {number|null}
 */
export function safeNumber(n) {
  if (typeof n === "number") return Number.isFinite(n) ? n : null;
  if (typeof n !== "string") return null;
  const s = n.trim();
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Safely converts to an integer by flooring finite numeric input; invalid values
 * return `null`. Note: does not guarantee safe-integer precision for huge values.
 *
 * @param {any} n
 * @returns {number|null}
 */
export function safeInt(n) {
  const v = safeNumber(n);
  return v === null ? null : Math.floor(v);
}

/**
 * Normalize render type string to one of: "ai-image", "svg", "asset".
 * Default fallback is "ai-image".
 *
 * @param {any} rt - Input render type
 * @returns {"ai-image" | "svg" | "asset"}
 */
export function normalizeRenderType(rt) {
  const t = String(rt || "").trim().toLowerCase();
  if (t === "ai-image" || t === "ai_image" || t === "image") return "ai-image";
  if (t === "svg") return "svg";
  if (t === "asset" || t === "doc-asset" || t === "document-asset") return "asset";
  return "ai-image";
}

