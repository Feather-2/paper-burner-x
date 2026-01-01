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

  // High-performance CJK count (avoid `match()` allocating large arrays).
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs, Hiragana/Katakana, Hangul
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjkCount += 1;
    }
  }

  const otherCount = text.length - cjkCount;

  // Heuristic:
  // - Latin-ish text: ~4 chars / token
  // - CJK: ~1 char ~= 1.6 tokens (conservative)
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

  const seen = new WeakMap();
  const stack = [];

  const initClone = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);
    if (value instanceof Map) return new Map();
    if (value instanceof Set) return new Set();
    if (Array.isArray(value)) return new Array(value.length);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      if (value instanceof DataView) {
        const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        return new DataView(buf);
      }
      const Ctor = value.constructor;
      try {
        return new Ctor(value);
      } catch {
        return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      }
    }
    return Object.create(Object.getPrototypeOf(value));
  };

  const root = initClone(v);
  if (root === v) return root;
  if (typeof v === "object") seen.set(v, root);
  stack.push({ src: v, dst: root });

  const cloneAny = (value) => {
    if (value === null || typeof value !== "object") return value;
    const existing = seen.get(value);
    if (existing) return existing;
    const next = initClone(value);
    seen.set(value, next);
    stack.push({ src: value, dst: next });
    return next;
  };

  while (stack.length) {
    const { src, dst } = stack.pop();

    if (src instanceof Date || src instanceof RegExp) continue;
    if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) continue;

    if (Array.isArray(src)) {
      for (let i = 0; i < src.length; i++) dst[i] = cloneAny(src[i]);
      continue;
    }

    if (src instanceof Map) {
      for (const [k, val] of src.entries()) {
        dst.set(cloneAny(k), cloneAny(val));
      }
      continue;
    }

    if (src instanceof Set) {
      for (const item of src.values()) dst.add(cloneAny(item));
      continue;
    }

    for (const key of Object.keys(src)) {
      dst[key] = cloneAny(src[key]);
    }
  }

  return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Serialization Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isWeakCollection(value) {
  return value instanceof WeakMap || value instanceof WeakSet;
}

/**
 * 递归清理值以确保 JSON 可序列化。
 * 处理循环引用、WeakMap/WeakSet、Date、RegExp、Map、Set 等。
 *
 * @param {any} value - 要清理的值
 * @param {WeakSet} [seen] - 用于检测循环引用的集合
 * @returns {any} JSON 安全的值
 */
export function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === null) return null;

  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") return Number.isFinite(value) ? value : null;
  if (type === "bigint") return value.toString();
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;

  if (type !== "object") return value;
  if (isWeakCollection(value)) return undefined;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();

  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = sanitizeForJson(item, seen);
      return next === undefined ? null : next;
    });
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map((item) => {
      const next = sanitizeForJson(item, seen);
      return next === undefined ? null : next;
    });
  }

  if (value instanceof Map) {
    let allStringKeys = true;
    for (const key of value.keys()) {
      if (typeof key !== "string") {
        allStringKeys = false;
        break;
      }
    }

    if (allStringKeys) {
      const out = {};
      for (const [k, v] of value.entries()) {
        const next = sanitizeForJson(v, seen);
        if (next !== undefined) out[k] = next;
      }
      return out;
    }

    return Array.from(value.entries()).map(([k, v]) => {
      const nextKey = sanitizeForJson(k, seen);
      const nextVal = sanitizeForJson(v, seen);
      return [nextKey === undefined ? null : nextKey, nextVal === undefined ? null : nextVal];
    });
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const next = sanitizeForJson(v, seen);
    if (next === undefined) continue;
    out[k] = next;
  }
  return out;
}
