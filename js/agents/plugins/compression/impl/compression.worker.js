import { isPlainObject } from "../../../shared/utils/value-utils.js";
import { createRpcHandler } from "../../../runtime/core/worker-rpc.js";

/**
 * Compression Worker - 压缩计算移出主线程
 *
 * 处理 SESSION_HISTORY 层的压缩计算，避免阻塞 UI。
 * 注意：LLM_SUMMARY 层需要 modelRouter，必须在主线程执行。
 *
 * P6.2: 支持 WorkerRpc 协议（rpc:request/rpc:response）
 */

// Worker 内部实现压缩逻辑（避免 import 复杂依赖）

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeSummaryText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} text
 * @param {{ maxWords?: number, maxChars?: number } | undefined} [options]
 * @returns {string}
 */
function toTitle(text, { maxWords = 10, maxChars = 80 } = {}) {
  const normalized = normalizeSummaryText(text);
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

/**
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function truncateText(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 3);
  return text.slice(0, head) + "..." + (tail ? text.slice(text.length - tail) : "");
}

/**
 * @param {any} message
 * @returns {boolean}
 */
function isThinkingMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.thinking === true || message.internal === true) return true;
  if (message.type === "thinking") return true;
  if (message.meta && message.meta.type === "thinking") return true;
  const content = String(message.content || message.text || "").trim();
  if (!content) return false;
  return /^<(think|analysis)>/i.test(content) || /^(thoughts?|analysis|internal):/i.test(content);
}

/**
 * @param {any} message
 * @returns {{ role: string, content: string } & Record<string, any>}
 */
function normalizeMessage(message) {
  if (typeof message === "string") {
    return { role: "assistant", content: message };
  }
  if (message && typeof message === "object") {
    const content = message.content ?? message.text ?? "";
    return { ...message, content: String(content) };
  }
  return { role: "assistant", content: "" };
}

/**
 * @param {any} message
 * @returns {boolean}
 */
function isMergeSafeMessage(message) {
  if (!message || typeof message !== "object") return false;
  const keys = Object.keys(message);
  for (const key of keys) {
    if (key === "role" || key === "content") continue;
    return false;
  }
  return true;
}

/**
 * @param {any} message
 * @returns {boolean}
 */
function isContextSummaryMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "system") return false;
  const content = String(message.content || "").trim();
  return content.startsWith("[Context Summary]");
}

/**
 * @param {Array<{ role?: string, content?: any }>} messages
 * @param {number} lineLimit
 * @param {{ titleOnly?: boolean, titleMaxWords?: number, titleMaxChars?: number } | undefined} [options]
 * @returns {string}
 */
function summarizeMessages(messages, lineLimit, { titleOnly = false, titleMaxWords = 10, titleMaxChars = 80 } = {}) {
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

/**
 * SESSION_HISTORY 压缩核心算法
 * @param {Record<string, any>} context
 * @param {Record<string, any>} [options]
 * @returns {{ compressed: any, stats: any }}
 */
function compressSessionHistory(context, options = {}) {
  const keepLastTurns = Number.isFinite(options.keepLastTurns) ? options.keepLastTurns : 6;
  const summaryLineChars = Number.isFinite(options.summaryLineChars) ? options.summaryLineChars : 120;
  const titleOnly = options.titleOnly === true;
  const titleMaxWords = Number.isFinite(options.titleMaxWords) ? Math.max(1, Math.floor(options.titleMaxWords)) : 10;
  const titleMaxChars = Number.isFinite(options.titleMaxChars) ? Math.max(10, Math.floor(options.titleMaxChars)) : 80;

  const stats = {
    totalMessages: 0,
    mergedMessages: 0,
    removedThinking: 0,
    keptMessages: 0,
    summarizedMessages: 0,
  };

  const historyKey = Array.isArray(context.messages)
    ? "messages"
    : Array.isArray(context.sessionHistory)
      ? "sessionHistory"
      : Array.isArray(context.history)
        ? "history"
        : null;

  if (!historyKey) return { compressed: context, stats };

  const messages = context[historyKey].map(normalizeMessage);
  stats.totalMessages = messages.length;

  // Merge consecutive same-role messages
  const merged = [];
  for (const message of messages) {
    if (isThinkingMessage(message)) {
      stats.removedThinking += 1;
      continue;
    }
    const last = merged[merged.length - 1];
    const canMerge =
      last &&
      last.role === message.role &&
      message.role !== "system" &&
      message.role !== "tool" &&
      isMergeSafeMessage(last) &&
      isMergeSafeMessage(message);
    if (canMerge) {
      last.content = [last.content, message.content].filter(Boolean).join("\n");
      stats.mergedMessages += 1;
    } else {
      merged.push({ ...message });
    }
  }

  // Anchors: keep leading system prompts verbatim
  const anchors = [];
  let anchorEnd = 0;
  while (anchorEnd < merged.length) {
    const msg = merged[anchorEnd];
    if (msg?.role === "system" && !isContextSummaryMessage(msg)) {
      anchors.push(msg);
      anchorEnd += 1;
      continue;
    }
    break;
  }

  const compressible = merged.slice(anchorEnd);
  const start = Math.max(compressible.length - keepLastTurns, 0);
  const kept = [...anchors, ...compressible.slice(start)];
  const older = compressible.slice(0, start);
  stats.keptMessages = kept.length;
  stats.summarizedMessages = older.length;

  const updated = { ...context, [historyKey]: kept };
  if (older.length) {
    const summary = summarizeMessages(older, summaryLineChars, { titleOnly, titleMaxWords, titleMaxChars });
    const existing = String(context.sessionSummary || context.historySummary || "").trim();
    updated.sessionSummary = existing ? `${existing}\n${summary}` : summary;
  }

  return { compressed: updated, stats };
}

/**
 * 估算 token 数量（简化版）
 * @param {any} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  const s = typeof text === "string" ? text : JSON.stringify(text);
  // CJK 加权：每个 CJK 字符约 1.6 token
  let tokens = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      tokens += 1.6;
    } else {
      tokens += 0.25; // ASCII 约 4 字符 = 1 token
    }
  }
  return Math.ceil(tokens);
}

/**
 * RPC method: compress
 * @param {{ messages?: any[], options?: Record<string, any> } | any} params
 * @returns {{ messages: any[], sessionSummary: string | null, stats: any, afterTokens: number }}
 */
function handleCompress(params) {
  const { messages, options } = params || {};

  if (!Array.isArray(messages)) {
    throw new Error("messages must be an array");
  }

  const context = { messages };
  if (options?.sessionSummary) {
    context.sessionSummary = options.sessionSummary;
  }

  const result = compressSessionHistory(context, options || {});

  // 计算压缩后的 token 数
  let afterTokens = 0;
  for (const msg of result.compressed.messages || []) {
    afterTokens += estimateTokens(msg.content);
  }

  return {
    messages: result.compressed.messages || [],
    sessionSummary: result.compressed.sessionSummary || null,
    stats: result.stats,
    afterTokens,
  };
}

// WorkerRpc handler（P6.2 新协议）
const rpcHandler = createRpcHandler({
  compress: handleCompress,
});

// 兼容旧协议 + 新 RPC 协议
self.onmessage = /** @param {any} event */ (event) => {
  const data = event?.data;

  // P6.2: 新 RPC 协议优先
  if (data?.type === "rpc:request") {
    rpcHandler(event);
    return;
  }

  // 兼容旧协议（向后兼容）
  const id = data?.id;

  if (!isPlainObject(data)) {
    self.postMessage({ id, ok: false, error: "Invalid message format" });
    return;
  }

  const { messages, options } = data;

  if (!Array.isArray(messages)) {
    self.postMessage({ id, ok: false, error: "messages must be an array" });
    return;
  }

  try {
    const result = handleCompress({ messages, options });
    self.postMessage({
      id,
      ok: true,
      ...result,
    });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: String(err?.message || err),
    });
  }
};
