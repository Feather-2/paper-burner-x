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

