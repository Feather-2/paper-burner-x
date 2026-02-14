/**
 * 健壮的 JSON 解析工具
 *
 * 安全策略（2026-01 更新）：
 * - 默认启用严格模式：不做正则自动修复，避免注入风险
 * - 仅保留安全的预处理：移除 BOM、控制字符
 * - 失败时返回结构化错误，触发模型自我修正
 */

import { createLogger } from "./logger.js";
import { protoSafeReviver } from "./safe-json.js";

const logger = createLogger("shared/utils/robust-json");

// Safety bound: avoid blocking the event loop on huge payloads.
const DEFAULT_MAX_INPUT_CHARS = 1_000_000;

/**
 * 安全的预处理：仅移除 BOM 和控制字符
 * 不做任何可能改变语义的修复
 */
function safePreprocess(text) {
  if (!text || typeof text !== "string") return text;

  let cleaned = text;

  // 1. 移除 BOM
  cleaned = cleaned.replace(/^\uFEFF/, "");

  // 2. 移除控制字符（除了常见的空白字符：\n, \r, \t）
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return cleaned;
}

/**
 * 从文本中提取 JSON 块
 * 支持 markdown 代码块、裸 JSON、带前后缀文本
 */
function extractJsonBlock(text) {
  if (!text || typeof text !== "string") return null;

  // 1. 尝试 markdown 代码块 ```json ... ``` 或 ``` ... ```
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (mdMatch) return mdMatch[1].trim();

  // 2. 尝试找到 JSON 对象或数组的边界
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  let start = -1;
  let isObject = false;

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    start = firstBrace;
    isObject = true;
  } else if (firstBracket >= 0) {
    start = firstBracket;
    isObject = false;
  }

  if (start < 0) return null;

  // 找到匹配的闭合括号
  const openChar = isObject ? "{" : "[";
  const closeChar = isObject ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // 没找到完整闭合，返回 null（严格模式不尝试修复）
  return null;
}

/**
 * 解析结果类型
 */
export const ParseResultCode = Object.freeze({
  OK: "OK",
  EMPTY_INPUT: "EMPTY_INPUT",
  INPUT_TOO_LARGE: "INPUT_TOO_LARGE",
  INVALID_JSON: "INVALID_JSON",
  NO_JSON_FOUND: "NO_JSON_FOUND",
});

/**
 * 尝试解析 JSON，返回结构化结果
 * @param {string} text
 * @param {object} options
 * @returns {{ ok: boolean, code: string, data?: any, error?: string, rawInput?: string }}
 */
export function parseJsonStrict(text, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_INPUT_CHARS;

  if (!text || typeof text !== "string") {
    return { ok: false, code: ParseResultCode.EMPTY_INPUT, error: "Input is empty or not a string" };
  }

  if (text.length > maxChars) {
    return { ok: false, code: ParseResultCode.INPUT_TOO_LARGE, error: `Input exceeds ${maxChars} characters` };
  }

  const preprocessed = safePreprocess(text.trim());

  // 策略 1: 直接解析
  try {
    const data = JSON.parse(preprocessed, protoSafeReviver);
    return { ok: true, code: ParseResultCode.OK, data };
  } catch {
    // continue
  }

  // 策略 2: 提取 JSON 块后解析
  const extracted = extractJsonBlock(preprocessed);
  if (extracted) {
    try {
      const data = JSON.parse(extracted, protoSafeReviver);
      return { ok: true, code: ParseResultCode.OK, data };
    } catch (err) {
      return {
        ok: false,
        code: ParseResultCode.INVALID_JSON,
        error: err instanceof Error ? err.message : String(err),
        rawInput: extracted.slice(0, 500),
      };
    }
  }

  return { ok: false, code: ParseResultCode.NO_JSON_FOUND, error: "No valid JSON structure found in input" };
}

/**
 * 健壮的 JSON 解析函数（兼容旧 API）
 * @param {string} text - 要解析的文本
 * @param {any} fallback - 解析失败时的默认值
 * @returns {any} 解析结果或默认值
 */
export function robustParseJson(text, fallback = null) {
  const result = parseJsonStrict(text);
  return result.ok ? result.data : fallback;
}

/**
 * 解析 JSON 并验证结构
 * @param {string} text - 要解析的文本
 * @param {function} validator - 验证函数，接收解析结果，返回 true/false
 * @param {any} fallback - 解析或验证失败时的默认值
 */
export function robustParseJsonWithValidation(text, validator, fallback = null) {
  const result = parseJsonStrict(text);
  if (!result.ok) return fallback;
  if (typeof validator !== "function") return result.data;
  try {
    return validator(result.data) ? result.data : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 从 LLM 响应中提取 JSON（处理各种包装格式）
 */
export function extractJsonFromLlmResponse(response) {
  if (!response) return null;

  // 如果是对象，尝试获取 content 字段
  let text = response;
  if (typeof response === "object") {
    text = response.content || response.text || response.message || "";
  }

  if (typeof text !== "string") return null;

  return robustParseJson(text);
}

/**
 * 生成 JSON 修正提示（供 AgentLoop 使用）
 * @param {string} errorMessage
 * @param {string} rawInput
 * @returns {string}
 */
export function generateJsonCorrectionPrompt(errorMessage, rawInput) {
  const preview = rawInput ? rawInput.slice(0, 300) : "";
  return `Your previous response contained invalid JSON. Error: ${errorMessage}

Please respond with valid JSON only. Do not include markdown code fences or explanatory text.

${preview ? `The problematic content started with:\n${preview}...` : ""}

Please try again with properly formatted JSON.`;
}

// 导出工具函数供测试
export const __test = {
  extractJsonBlock,
  safePreprocess,
};
