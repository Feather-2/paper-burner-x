import { estimateTokensCached, makeSecureTimestampedId, Platform } from "../../shared/index.js";

// Default config mirrors MemoryStore behavior.
export const DEFAULT_CONFIG = Object.freeze({
  maxMessages: 20,
  maxSignals: 50,
  maxDecisions: 30,
  keepLastTurns: 6,
  compressThreshold: 0.8,
  contextWindow: 128000,
  // L3 archive/checkpoint total cap: 5GB in browser, unlimited elsewhere.
  maxL3Bytes: Platform.isBrowser ? 5 * 1024 * 1024 * 1024 : Infinity,
});

// Rough object size estimation.
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

export function estimateTokensValue(text, tokenCounter) {
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

export function truncate(text, maxLen = 200) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

export function genId(prefix = "id") {
  return makeSecureTimestampedId(prefix);
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
