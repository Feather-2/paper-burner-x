import { estimateTokensCached, makeSecureTimestampedId } from "../../shared/index.js";

export const defineMethod = (fn) => ({
  value: fn,
  writable: true,
  configurable: true,
});

export const defineGetter = (fn) => ({
  get: fn,
  configurable: true,
});

export const defineAccessor = (get, set) => ({
  get,
  set,
  configurable: true,
});

// 估算对象字节大小（粗略）
export function estimateBytes(obj) {
  if (obj === null || obj === undefined) return 0;
  if (typeof obj === "string") return obj.length * 2; // UTF-16
  if (typeof obj === "number") return 8;
  if (typeof obj === "boolean") return 4;
  try {
    return JSON.stringify(obj).length * 2;
  } catch {
    return 1024; // fallback
  }
}

// Token 估算 (4 chars ≈ 1 token)
export function estimateTokens(text, tokenCounter) {
  if (text === null || text === undefined) return 0;
  let rawText = "";
  if (typeof text === "string") {
    rawText = text;
  } else {
    try {
      rawText = JSON.stringify(text);
    } catch {
      rawText = String(text);
    }
  }
  return estimateTokensCached(rawText, tokenCounter);
}

// 截断文本
export function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// 生成唯一 ID
export function genId(prefix = "id") {
  return makeSecureTimestampedId(prefix);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
