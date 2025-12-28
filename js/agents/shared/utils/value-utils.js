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
 * Safely converts to finite number; invalid values return null.
 * @param {any} value
 * @returns {number|null}
 */
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts value to boolean with flexible parsing.
 * @param {any} value
 * @returns {boolean}
 */
export function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(trimmed)) return true;
    if (["false", "0", "no", "n", "off"].includes(trimmed)) return false;
  }
  return false;
}

/**
 * Normalize string to lowercase alphanumeric key for matching.
 * @param {any} value
 * @returns {string}
 */
export function normalizeKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

/**
 * 高级 Token 估算：针对中英文混合文本。
 * 英文: 1 token ≈ 4 字符
 * 中文/日韩文: 1 token ≈ 0.6 字符 (即 charCount * 1.6)
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokenCount(text) {
  if (!text || typeof text !== "string") return 0;

  // 匹配 CJK 字符 (中日韩)
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = text.length - cjkCount;

  // 估算公式: 英文每4个字1个token，中文每个字约1.6个token (OpenAI 标准)
  return Math.ceil(otherCount / 4 + cjkCount * 1.6);
}

/**
 * 深度克隆对象，支持常规 JSON 类型以及 Map 和 Set。
 * 用于状态快照 (Checkpoints) 和回溯 (Backtracking) 以防原始数据被污染。
 *
 * @param {any} v - 要克隆的值
 * @returns {any} 克隆后的新值
 */
export function deepClone(v) {
  if (v === null || typeof v !== "object") return v;

  // 处理 Date
  if (v instanceof Date) return new Date(v.getTime());

  // 处理 Array
  if (Array.isArray(v)) {
    return v.map(item => deepClone(item));
  }

  // 处理 Map
  if (v instanceof Map) {
    const result = new Map();
    for (const [key, value] of v.entries()) {
      result.set(deepClone(key), deepClone(value));
    }
    return result;
  }

  // 处理 Set
  if (v instanceof Set) {
    const result = new Set();
    for (const item of v.values()) {
      result.add(deepClone(item));
    }
    return result;
  }

  // 处理 Plain Object
  const result = Object.create(Object.getPrototypeOf(v));
  for (const key in v) {
    if (Object.prototype.hasOwnProperty.call(v, key)) {
      result[key] = deepClone(v[key]);
    }
  }
  return result;
}

