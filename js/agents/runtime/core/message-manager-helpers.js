/**
 * MessageManager helper functions
 */

import { estimateTokensCached } from "../../shared/index.js";

/**
 * @typedef {{ count: (text: string) => number }} TokenCounterLike
 *
 * @typedef {{ role?: string, content?: any, text?: any, type?: string, thinking?: boolean, internal?: boolean, _summary?: string, _tokens?: number, [key: string]: any }} ChatMessage
 */

export const SUMMARY_MIN_TOKENS = 100;
export const SUMMARY_LONG_TOKENS = 200;

const THINKING_XML_PATTERN = /^<(think|analysis)>/i;
const THINKING_PREFIX_PATTERN = /^(thoughts?|analysis|internal):/i;
const DECISION_CN_PATTERN = /^(决定|选择|确定|采用|使用|将|要|需要|应该|因此|所以|结论)/i;
const DECISION_EN_PATTERN = /^(decide|choose|will|should|therefore|conclusion|plan to)/i;

/**
 * @param {unknown} text
 * @param {TokenCounterLike | null | undefined} tokenCounter
 * @returns {number}
 */
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

/**
 * 计算内容的简单 hash（32-bit）
 * @param {unknown} content
 * @returns {number}
 */
export function computeContentHash(content) {
  let str;
  if (typeof content === "string") {
    str = content;
  } else if (content === null || content === undefined) {
    return 0;
  } else {
    try {
      str = JSON.stringify(content);
    } catch {
      str = String(content);
    }
  }
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * @param {any} err
 * @returns {boolean}
 */
export function isAbortError(err) {
  if (!err) return false;
  const name = err?.name || err?.code;
  if (name === "AbortError" || name === "CanceledError" || name === "CancelledError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("aborted") || lower.includes("canceled") || lower.includes("cancelled");
}

/**
 * 检测是否为 thinking 消息
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function isThinkingMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.thinking === true || message.internal === true) return true;
  if (message.type === "thinking") return true;
  const content = String(message.content || message.text || "").trim();
  if (!content) return false;
  return THINKING_XML_PATTERN.test(content) || THINKING_PREFIX_PATTERN.test(content);
}

/**
 * 判断消息是否需要预生成摘要
 * @param {ChatMessage} message
 * @param {WeakSet<ChatMessage>} pendingSummaries
 * @param {(message: ChatMessage) => boolean} [isThinkingMessageFn]
 * @returns {boolean}
 */
export function shouldGenerateSummary(message, pendingSummaries, isThinkingMessageFn = isThinkingMessage) {
  if (!message || typeof message !== "object") return false;
  if (message._summary) return false;
  if (pendingSummaries.has(message)) return false;

  const content = message.content || message.text;
  if (!content) return false;

  const tokens = message._tokens || 0;
  if (tokens < SUMMARY_MIN_TOKENS) return false;
  if (isThinkingMessageFn(message)) return true;
  return tokens > SUMMARY_LONG_TOKENS;
}

/**
 * 内置摘要生成（快速，无 LLM 调用）
 * @param {ChatMessage} message
 * @param {(message: ChatMessage) => boolean} [isThinkingMessageFn]
 * @returns {string | null}
 */
export function generateBuiltinSummary(message, isThinkingMessageFn = isThinkingMessage) {
  const content = String(message.content || message.text || "");
  if (!content) return null;

  const thinking = isThinkingMessageFn(message);
  if (thinking) {
    const lines = content.split("\n");
    const decisions = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (DECISION_CN_PATTERN.test(trimmed) || DECISION_EN_PATTERN.test(trimmed)) {
        decisions.push(trimmed.slice(0, 80));
        if (decisions.length >= 3) break;
      }
    }
    if (decisions.length > 0) {
      return `[决策] ${decisions.join("; ")}`;
    }
    return `[Thinking] ${content.slice(0, 80)}...`;
  }

  if (content.length > 200) {
    return content.slice(0, 100) + " ... " + content.slice(-50);
  }
  return null;
}
