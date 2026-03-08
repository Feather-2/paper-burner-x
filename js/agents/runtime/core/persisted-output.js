/**
 * Persisted Output - 大输出处理
 *
 * 防止工具返回的大输出撑爆 token 窗口。
 * 超过阈值的输出会被截断并包装为持久化格式。
 */

/** 输出大小阈值 (字节) - 默认 400KB */
export const DEFAULT_OUTPUT_THRESHOLD = 400000;

/** 预览大小 (字符) - 默认 2000 */
export const DEFAULT_PREVIEW_SIZE = 2000;

/** 保留的持久化输出数量 - 默认 3 */
export const DEFAULT_KEEP_RECENT_OUTPUTS = 3;

// Mutable config for runtime adjustment
let _defaultConfig = {
  outputThreshold: DEFAULT_OUTPUT_THRESHOLD,
  previewSize: DEFAULT_PREVIEW_SIZE,
  keepRecentOutputs: DEFAULT_KEEP_RECENT_OUTPUTS,
};
const _scopedConfigs = new Map();

function normalizeScope(scope) {
  if (typeof scope !== "string") return "default";
  const trimmed = scope.trim();
  return trimmed || "default";
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @typedef {{ scope?: string }} PersistedOutputScopeOptions
 * @typedef {PersistedOutputScopeOptions & { keepRecent?: number }} PersistedOutputCleanupOptions
 */

function resolveConfig(scope = "default") {
  const key = normalizeScope(scope);
  if (key === "default") return { ..._defaultConfig };
  const scoped = _scopedConfigs.get(key);
  return scoped ? { ...scoped } : { ..._defaultConfig };
}

function setConfig(scope, nextConfig) {
  const key = normalizeScope(scope);
  if (key === "default") {
    _defaultConfig = { ...nextConfig };
    return;
  }
  _scopedConfigs.set(key, { ...nextConfig });
}

function getByteLength(content) {
  const text = typeof content === "string" ? content : String(content ?? "");
  if (typeof globalThis.TextEncoder === "function") {
    try {
      return new globalThis.TextEncoder().encode(text).length;
    } catch {
      // ignore and continue with other strategies
    }
  }
  if (typeof globalThis.Buffer !== "undefined" && typeof globalThis.Buffer.byteLength === "function") {
    try {
      return globalThis.Buffer.byteLength(text, "utf8");
    } catch {
      // ignore and continue with fallback
    }
  }
  return text.length;
}

/**
 * Configure persisted output settings
 * @param {{ outputThreshold?: number, previewSize?: number, keepRecentOutputs?: number }} config
 * @param {PersistedOutputScopeOptions} [options]
 */
export function configurePersistedOutput(config, options = {}) {
  const input = config && typeof config === "object" ? config : {};
  const scope = normalizeScope(options.scope);
  const next = resolveConfig(scope);
  if (Number.isFinite(input.outputThreshold) && input.outputThreshold > 0) {
    next.outputThreshold = Math.floor(input.outputThreshold);
  }
  if (Number.isFinite(input.previewSize) && input.previewSize > 0) {
    next.previewSize = Math.floor(input.previewSize);
  }
  if (Number.isFinite(input.keepRecentOutputs) && input.keepRecentOutputs >= 0) {
    next.keepRecentOutputs = Math.floor(input.keepRecentOutputs);
  }
  setConfig(scope, next);
}

/**
 * Get current config
 * @param {PersistedOutputScopeOptions} [options]
 * @returns {{ outputThreshold: number, previewSize: number, keepRecentOutputs: number }}
 */
export function getPersistedOutputConfig(options = {}) {
  return resolveConfig(options.scope);
}

/**
 * Reset to defaults
 * @param {PersistedOutputScopeOptions} [options]
 */
export function resetPersistedOutputConfig(options = {}) {
  const scope = normalizeScope(options.scope);
  if (scope === "default") {
    _defaultConfig = {
      outputThreshold: DEFAULT_OUTPUT_THRESHOLD,
      previewSize: DEFAULT_PREVIEW_SIZE,
      keepRecentOutputs: DEFAULT_KEEP_RECENT_OUTPUTS,
    };
    _scopedConfigs.clear();
    return;
  }
  _scopedConfigs.delete(scope);
}

// Backward compatibility aliases
export const OUTPUT_THRESHOLD = DEFAULT_OUTPUT_THRESHOLD;
export const PREVIEW_SIZE = DEFAULT_PREVIEW_SIZE;
export const KEEP_RECENT_OUTPUTS = DEFAULT_KEEP_RECENT_OUTPUTS;

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
 * @param {string} [options.scope] - 配置作用域
 * @returns {string} - 原始内容或包装后的持久化格式
 */
export function wrapPersistedOutput(content, options = {}) {
  if (typeof content !== "string") {
    try {
      content = JSON.stringify(content);
    } catch {
      content = String(content ?? "");
    }
    if (typeof content !== "string") {
      content = String(content ?? "");
    }
  }

  const scopeConfig = resolveConfig(options.scope);
  const threshold = toFiniteNumber(options.threshold, scopeConfig.outputThreshold);
  const previewSize = Math.max(0, Math.floor(toFiniteNumber(options.previewSize, scopeConfig.previewSize)));
  const totalBytes = getByteLength(content);

  if (totalBytes <= threshold) return content;

  const preview = content.slice(0, previewSize);

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
 * @param {number | PersistedOutputCleanupOptions} [keepRecent] - 保留数量
 * @returns {Array} - 清理后的消息数组
 */
export function cleanOldPersistedOutputs(messages, keepRecent = undefined) {
  if (!Array.isArray(messages)) return messages;
  const scopeConfig = resolveConfig(
    typeof keepRecent === "object" && keepRecent !== null ? keepRecent.scope : undefined
  );
  const keepRecentOptions = typeof keepRecent === "object" && keepRecent !== null ? keepRecent : null;
  const keepRecentValue = keepRecentOptions ? keepRecentOptions.keepRecent : keepRecent;
  const keepRecentResolved = toFiniteNumber(keepRecentValue, scopeConfig.keepRecentOutputs);

  const persistedIndices = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    if (isPersistedOutput(content)) {
      persistedIndices.push(i);
    }
  }

  if (persistedIndices.length <= keepRecentResolved) return messages;

  const retainCount = Math.floor(keepRecentResolved);
  const toClean = new Set(persistedIndices.slice(0, -retainCount));

  return messages.map((msg, idx) => {
    if (!toClean.has(idx)) return msg;
    return {
      ...msg,
      content: "[Old large output cleared to save context space]",
    };
  });
}

export default {
  DEFAULT_OUTPUT_THRESHOLD,
  DEFAULT_PREVIEW_SIZE,
  DEFAULT_KEEP_RECENT_OUTPUTS,
  OUTPUT_THRESHOLD,
  PREVIEW_SIZE,
  KEEP_RECENT_OUTPUTS,
  PERSISTED_OUTPUT_START,
  PERSISTED_OUTPUT_END,
  configurePersistedOutput,
  getPersistedOutputConfig,
  resetPersistedOutputConfig,
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
