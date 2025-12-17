/**
 * 健壮的 JSON 解析工具
 * 处理 LLM 返回的常见 JSON 格式问题
 */

/**
 * 从文本中提取 JSON 块
 * 支持 markdown 代码块、裸 JSON、带前后缀文本
 */
function extractJsonBlock(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. 尝试 markdown 代码块 ```json ... ``` 或 ``` ... ```
  const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (mdMatch) return mdMatch[1].trim();

  // 2. 尝试找到 JSON 对象或数组的边界
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

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
  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
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

  // 没找到完整闭合，返回从 start 开始的部分（可能需要修复）
  return text.slice(start);
}

/**
 * 修复常见的 JSON 格式问题
 */
function fixCommonJsonIssues(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return jsonStr;

  let fixed = jsonStr;

  // 1. 移除 BOM
  fixed = fixed.replace(/^\uFEFF/, '');

  // 2. 移除控制字符（除了常见的空白字符）
  fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 3. 修复单引号 -> 双引号（在键名位置）
  // 谨慎处理，只替换明显是键名的单引号
  fixed = fixed.replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3');

  // 4. 移除尾部逗号（对象和数组）
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 5. 修复未闭合的字符串（行尾缺少引号）
  // 这个比较危险，只在明显情况下修复
  const lines = fixed.split('\n');
  const fixedLines = lines.map(line => {
    // 如果行以 "key": "value 结尾（缺少闭合引号和逗号）
    const unclosedMatch = line.match(/^(\s*"[^"]+"\s*:\s*")([^"]*[^",\s])$/);
    if (unclosedMatch) {
      return unclosedMatch[1] + unclosedMatch[2] + '"';
    }
    return line;
  });
  fixed = fixedLines.join('\n');

  // 6. 修复可能被截断的 JSON（尝试闭合括号）
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/]/g) || []).length;

  // 移除末尾的不完整内容
  fixed = fixed.replace(/,\s*$/, '');

  // 添加缺少的闭合括号
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    fixed += ']';
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    fixed += '}';
  }

  return fixed;
}

/**
 * 尝试多种策略解析 JSON
 */
function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();

  // 策略 1: 直接解析
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // 策略 2: 提取 JSON 块后解析
  const extracted = extractJsonBlock(trimmed);
  if (extracted) {
    try {
      return JSON.parse(extracted);
    } catch {
      // continue
    }

    // 策略 3: 修复后解析
    const fixed = fixCommonJsonIssues(extracted);
    try {
      return JSON.parse(fixed);
    } catch {
      // continue
    }
  }

  // 策略 4: 对原文修复后解析
  const fixedOriginal = fixCommonJsonIssues(trimmed);
  try {
    return JSON.parse(fixedOriginal);
  } catch {
    // continue
  }

  return null;
}

/**
 * 健壮的 JSON 解析函数
 * @param {string} text - 要解析的文本
 * @param {any} fallback - 解析失败时的默认值
 * @returns {any} 解析结果或默认值
 */
export function robustParseJson(text, fallback = null) {
  const result = tryParseJson(text);
  return result !== null ? result : fallback;
}

/**
 * 解析 JSON 并验证结构
 * @param {string} text - 要解析的文本
 * @param {function} validator - 验证函数，接收解析结果，返回 true/false
 * @param {any} fallback - 解析或验证失败时的默认值
 */
export function robustParseJsonWithValidation(text, validator, fallback = null) {
  const result = tryParseJson(text);
  if (result !== null && typeof validator === 'function') {
    try {
      if (validator(result)) return result;
    } catch {
      // validation failed
    }
  }
  return result !== null ? result : fallback;
}

/**
 * 从 LLM 响应中提取 JSON（处理各种包装格式）
 */
export function extractJsonFromLlmResponse(response) {
  if (!response) return null;

  // 如果是对象，尝试获取 content 字段
  let text = response;
  if (typeof response === 'object') {
    text = response.content || response.text || response.message || '';
  }

  if (typeof text !== 'string') return null;

  return robustParseJson(text);
}

// 导出工具函数供测试
export const __test = {
  extractJsonBlock,
  fixCommonJsonIssues,
  tryParseJson
};
