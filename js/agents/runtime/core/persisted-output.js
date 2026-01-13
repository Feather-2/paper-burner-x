/**
 * Persisted Output - 大输出处理
 *
 * 防止工具返回的大输出撑爆 token 窗口。
 * 超过阈值的输出会被截断并包装为持久化格式。
 */

/** 输出大小阈值 (字节) */
export const OUTPUT_THRESHOLD = 400000;

/** 预览大小 (字符) */
export const PREVIEW_SIZE = 2000;

/** 保留的持久化输出数量 */
export const KEEP_RECENT_OUTPUTS = 3;

/** 持久化输出标签 */
export const PERSISTED_OUTPUT_START = "<persisted-output>";
export const PERSISTED_OUTPUT_END = "</persisted-output>";

/**
 * 检查内容是否为持久化输出
 * @param {string} content
 * @returns {boolean}
 */
export function isPersistedOutput(content) {
  if (typeof content !== "string") return false;
  return content.includes(PERSISTED_OUTPUT_START);
}

/**
 * 包装大输出为持久化格式
 * @param {string} content - 原始内容
 * @param {object} [options]
 * @param {number} [options.threshold] - 大小阈值
 * @param {number} [options.previewSize] - 预览大小
 * @returns {string} - 原始内容或包装后的持久化格式
 */
export function wrapPersistedOutput(content, options = {}) {
  if (typeof content !== "string") {
    try {
      content = JSON.stringify(content);
    } catch {
      content = String(content ?? "");
    }
  }

  const threshold = options.threshold ?? OUTPUT_THRESHOLD;
  const previewSize = options.previewSize ?? PREVIEW_SIZE;

  if (content.length <= threshold) return content;

  const preview = content.slice(0, previewSize);
  const totalBytes = new TextEncoder().encode(content).length;

  return `${PERSISTED_OUTPUT_START}
[Large output truncated - showing first ${previewSize} characters]

${preview}

...

[Total: ${totalBytes.toLocaleString()} bytes / ${content.length.toLocaleString()} characters]
[Use VFS to access full content if needed]
${PERSISTED_OUTPUT_END}`;
}

/**
 * 清理旧的持久化输出，保留最近 N 个
 * @param {Array<{role?: string, content?: any}>} messages
 * @param {number} [keepRecent] - 保留数量
 * @returns {Array} - 清理后的消息数组
 */
export function cleanOldPersistedOutputs(messages, keepRecent = KEEP_RECENT_OUTPUTS) {
  if (!Array.isArray(messages)) return messages;

  const persistedIndices = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    if (isPersistedOutput(content)) {
      persistedIndices.push(i);
    }
  }

  if (persistedIndices.length <= keepRecent) return messages;

  const toClean = new Set(persistedIndices.slice(0, -keepRecent));

  return messages.map((msg, idx) => {
    if (!toClean.has(idx)) return msg;
    return {
      ...msg,
      content: "[Old large output cleared to save context space]",
    };
  });
}

export default {
  OUTPUT_THRESHOLD,
  PREVIEW_SIZE,
  KEEP_RECENT_OUTPUTS,
  PERSISTED_OUTPUT_START,
  PERSISTED_OUTPUT_END,
  isPersistedOutput,
  wrapPersistedOutput,
  cleanOldPersistedOutputs,
};

/**
 * 创建 ToolRegistry after hook，自动包装大输出
 * @param {object} [options]
 * @param {number} [options.threshold] - 大小阈值
 * @param {number} [options.previewSize] - 预览大小
 * @returns {(ctx: {tool: string, result: any}) => any}
 */
export function createPersistedOutputHook(options = {}) {
  return ({ tool, result }) => {
    if (!result || typeof result !== "object") return result;

    const data = result.data;
    if (typeof data !== "string") return result;

    const wrapped = wrapPersistedOutput(data, options);
    if (wrapped === data) return result;

    return { ...result, data: wrapped };
  };
}
