/**
 * Cicada Compressor — helper functions (extracted from cicada-compressor.js)
 */

import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { estimateTokensCached } from "../../../shared/index.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const IMPORTANT_KEYS = new Set([
  "tool", "name", "id", "status", "ok", "error", "errors",
  "warning", "warnings", "summary", "result", "type", "meta",
  "metadata", "count", "total",
]);

const VERBOSE_KEYS = new Set([
  "output", "content", "data", "stdout", "stderr", "logs",
  "trace", "stack", "raw", "payload", "debug",
]);

export { DANGEROUS_KEYS, IMPORTANT_KEYS, VERBOSE_KEYS };

export function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function estimateTokens(text) {
  return estimateTokensCached(text);
}

export function truncateText(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 3);
  return text.slice(0, head) + "..." + (tail ? text.slice(text.length - tail) : "");
}

export function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function normalizeTitleText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function toTitle(text, { maxWords = 10, maxChars = 80 } = {}) {
  const normalized = normalizeTitleText(text);
  if (!normalized) return "";
  const maxW = Number.isFinite(Number(maxWords)) ? Math.max(1, Math.floor(Number(maxWords))) : 10;
  const maxC = Number.isFinite(Number(maxChars)) ? Math.max(10, Math.floor(Number(maxChars))) : 80;
  if (containsCjk(normalized)) {
    const clipped = normalized.slice(0, maxC);
    return clipped + (normalized.length > clipped.length ? "..." : "");
  }
  const words = normalized.split(" ").filter(Boolean);
  const sliced = words.slice(0, maxW).join(" ");
  const clipped = sliced.length > maxC ? sliced.slice(0, maxC) : sliced;
  const truncated = words.length > maxW || normalized.length > clipped.length;
  return clipped + (truncated ? "..." : "");
}

export function isThinkingMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.thinking === true || message.internal === true) return true;
  if (message.type === "thinking") return true;
  if (message.meta && message.meta.type === "thinking") return true;
  const content = String(message.content || message.text || "").trim();
  if (!content) return false;
  return /^<(think|analysis)>/i.test(content) || /^(thoughts?|analysis|internal):/i.test(content);
}

export function summarizeThinkingMessage(message, { maxChars = 150 } = {}) {
  if (!message || typeof message !== "object") return message;
  const content = String(message.content || message.text || "");
  if (!content) return message;
  const lines = content.split("\n");
  const decisions = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isDecision =
      /^(决定|选择|确定|采用|使用|将|要|需要|应该|因此|所以|结论|计划|方案)/i.test(trimmed) ||
      /^(decide|choose|will|should|therefore|conclusion|plan|approach|solution)/i.test(trimmed) ||
      /^[-*•]\s*(决定|选择|will|should|plan)/i.test(trimmed);
    if (isDecision) decisions.push(trimmed.slice(0, 80));
  }
  let summary;
  if (decisions.length > 0) {
    summary = `[思考摘要] ${decisions.slice(0, 3).join("; ")}`;
  } else {
    const head = content.slice(0, 60).replace(/\s+/g, " ");
    const tail = content.length > 120 ? content.slice(-40).replace(/\s+/g, " ") : "";
    summary = `[思考摘要] ${head}${tail ? " ... " + tail : ""}`;
  }
  if (summary.length > maxChars) {
    summary = maxChars <= 3 ? summary.slice(0, maxChars) : summary.slice(0, maxChars - 3) + "...";
  }
  return { ...message, content: summary, _originalLength: content.length, _thinkingSummarized: true };
}

export function normalizeMessage(message) {
  if (typeof message === "string") return { role: "assistant", content: message };
  if (message && typeof message === "object") {
    const content = message.content ?? message.text ?? "";
    return { ...message, content: String(content) };
  }
  return { role: "assistant", content: "" };
}

export function isToolRoleMessage(message) {
  return !!message && typeof message === "object" && (message.role === "tool" || message.role === "function");
}

export function isAssistantToolCallMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "assistant") return false;
  if (Array.isArray(message.tool_calls) || Array.isArray(message.toolCalls)) return true;
  if (message.function_call && typeof message.function_call === "object") return true;
  if (message.functionCall && typeof message.functionCall === "object") return true;
  return false;
}

export function extractToolCallIds(message) {
  const m = message && typeof message === "object" ? message : null;
  const calls = Array.isArray(m?.tool_calls) ? m.tool_calls : Array.isArray(m?.toolCalls) ? m.toolCalls : null;
  if (!calls) return [];
  const ids = [];
  for (const c of calls) {
    const id = typeof c?.id === "string" ? c.id : "";
    if (id) ids.push(id);
  }
  return ids;
}

export function extractToolMessageCallId(message) {
  const m = message && typeof message === "object" ? message : null;
  if (!m) return "";
  return (
    (typeof m.tool_call_id === "string" ? m.tool_call_id : "") ||
    (typeof m.toolCallId === "string" ? m.toolCallId : "") ||
    (typeof m.call_id === "string" ? m.call_id : "") ||
    (typeof m.callId === "string" ? m.callId : "")
  );
}

export function adjustStartForToolPairs(messages, startIndex) {
  const list = Array.isArray(messages) ? messages : [];
  let start = Number.isFinite(startIndex) ? Math.max(0, Math.floor(startIndex)) : 0;
  if (start <= 0 || start >= list.length) return start;
  if (isToolRoleMessage(list[start])) {
    let prev = start - 1;
    while (prev >= 0 && isToolRoleMessage(list[prev])) prev -= 1;
    if (prev >= 0 && isAssistantToolCallMessage(list[prev])) return prev;
    while (start < list.length && isToolRoleMessage(list[start])) start += 1;
  }
  return start;
}

export function removeOrphanedToolMessages(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  if (list.length === 0) return list;
  const referenced = new Set();
  for (const msg of list) {
    for (const id of extractToolCallIds(msg)) referenced.add(id);
  }
  let cleaned = list;
  if (referenced.size) {
    cleaned = cleaned.filter((msg) => {
      if (!isToolRoleMessage(msg)) return true;
      const id = extractToolMessageCallId(msg);
      return !id || referenced.has(id);
    });
  }
  while (cleaned.length && isToolRoleMessage(cleaned[0])) cleaned = cleaned.slice(1);
  return cleaned;
}

export function isMergeSafeMessage(message) {
  if (!message || typeof message !== "object") return false;
  const keys = Object.keys(message);
  for (const key of keys) {
    if (key === "role" || key === "content") continue;
    return false;
  }
  return true;
}

export function summarizeMessages(messages, lineLimit, { titleOnly = false, titleMaxWords = 10, titleMaxChars = 80 } = {}) {
  const lines = [];
  for (const msg of messages) {
    const role = String(msg.role || "unknown");
    const content = String(msg.content || "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    const line = titleOnly
      ? `${role}: ${toTitle(content, { maxWords: titleMaxWords, maxChars: titleMaxChars })}`
      : `${role}: ${truncateText(content, lineLimit)}`;
    lines.push(line);
  }
  return lines.join("\n");
}

export function normalizeLayerList(layers, defaultLayers) {
  const list = Array.isArray(layers) ? layers : defaultLayers;
  const requested = new Set(list);
  return defaultLayers.filter((layer) => requested.has(layer));
}

export function isContextSummaryMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "system") return false;
  const content = String(message.content || "").trim();
  return content.startsWith("[Context Summary]");
}

export function isSmallValue(value, maxChars) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= maxChars;
  if (Array.isArray(value)) return value.length <= 3;
  if (isPlainObject(value)) return Object.keys(value).length <= 5;
  return false;
}

export function compressValue(value, options, stats, depth) {
  const { maxChars, maxArrayItems, maxDepth } = options;
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    stats.truncatedFields += 1;
    return truncateText(value, maxChars);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length <= maxArrayItems) {
      return value.map((item) => compressValue(item, options, stats, depth + 1));
    }
    stats.trimmedArrays += 1;
    return value.slice(0, maxArrayItems).map((item) => compressValue(item, options, stats, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= maxDepth) {
      stats.trimmedObjects += 1;
      const text = safeStringify(value);
      return truncateText(text, maxChars);
    }
    const entries = Object.entries(value);
    const result = Object.create(null);
    for (const [key, val] of entries) {
      if (DANGEROUS_KEYS.has(key)) { stats.removedFields += 1; continue; }
      const keep = IMPORTANT_KEYS.has(key) || VERBOSE_KEYS.has(key) || isSmallValue(val, Math.floor(maxChars / 2));
      if (!keep) { stats.removedFields += 1; continue; }
      result[key] = compressValue(val, options, stats, depth + 1);
    }
    return result;
  }
  return value;
}

export function normalizeSummaryPayload(raw, fallback) {
  const src = isPlainObject(raw) ? raw : fallback;
  if (!isPlainObject(src)) return { summary: "", keyPoints: [], decisions: [], errors: [] };
  const summary = toNonEmptyString(src.summary) || "";
  const keyPoints = Array.isArray(src.keyPoints) ? src.keyPoints.map((item) => String(item)).filter(Boolean) : [];
  const decisions = Array.isArray(src.decisions) ? src.decisions.map((item) => String(item)).filter(Boolean) : [];
  const errors = Array.isArray(src.errors) ? src.errors.map((item) => String(item)).filter(Boolean) : [];
  return { summary, keyPoints, decisions, errors };
}

export function buildFallbackSummary(text) {
  const trimmed = text.trim();
  if (!trimmed) return { summary: "", keyPoints: [], decisions: [], errors: [] };
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const summary = truncateText(trimmed.replace(/\s+/g, " "), 280);
  const keyPoints = lines.slice(0, 5).map((line) => truncateText(line, 120));
  const decisions = lines.filter((line) => /decision|decide|chosen|selected|will/i.test(line)).slice(0, 3);
  const errors = lines.filter((line) => /error|failed|exception/i.test(line)).slice(0, 3);
  return { summary, keyPoints, decisions, errors };
}
