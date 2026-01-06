/**
 * Agent Loop 上下文配置
 *
 * 可通过 AgentLoop 构造函数的 contextConfig 选项覆盖
 */

export const DEFAULT_CONTEXT_CONFIG = Object.freeze({
  // Token 限制
  contextWindow: 128000,      // 默认 128K tokens
  maxOutputTokens: 4096,      // 默认输出限制

  // 压缩触发
  compressThreshold: 0.9,     // 90% 触发压缩
  compressCooldownMs: 5000,   // 压缩触发冷却（避免频繁触发）
  keepLastTurns: 6,           // 保留最近 6 轮

  // 消息缓冲
  userMessageBuffer: 20000,   // 用户消息缓冲区 20K tokens

  // Title-only 摘要
  titleOnlySummaryThreshold: 0.8, // 80% 时对旧消息做 title-only 摘要
  titleOnlySummaryMaxWords: 10,   // 英文单词上限
  titleOnlySummaryMaxChars: 80,   // 字符上限（含 CJK）

  // 安全限制
  maxKeptMessageChars: 16000,     // kept 消息硬截断保护（避免极端大消息霸占上下文）

  // Worker 配置
  useCompressionWorker: true,     // 启用 Worker 压缩（浏览器环境）
  workerThresholdMessages: 50,    // 消息数阈值触发 Worker
});

/**
 * 合并用户配置与默认配置
 * @param {Partial<typeof DEFAULT_CONTEXT_CONFIG>} userConfig
 * @returns {Readonly<typeof DEFAULT_CONTEXT_CONFIG>}
 */
export function mergeContextConfig(userConfig) {
  if (!userConfig || typeof userConfig !== 'object') {
    return DEFAULT_CONTEXT_CONFIG;
  }
  return Object.freeze({ ...DEFAULT_CONTEXT_CONFIG, ...userConfig });
}
