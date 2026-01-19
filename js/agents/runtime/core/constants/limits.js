/**
 * 常量定义 - 数量限制
 * @module runtime/constants/limits
 */

/**
 * 数量限制常量
 */
export const LIMITS = Object.freeze({
  // ===== 消息/历史 =====
  /** L1 最大消息数 */
  MAX_MESSAGES: 20,
  /** 压缩后保留消息数 */
  KEEP_LAST_MESSAGES: 6,
  /** 最大信号数 */
  MAX_SIGNALS: 50,
  /** 最大决策记录数 */
  MAX_DECISIONS: 30,

  // ===== Token =====
  /** 默认上下文窗口 */
  DEFAULT_CONTEXT_WINDOW: 128_000,
  /** 默认最大输出 Token */
  DEFAULT_MAX_TOKENS: 4_096,
  /** Token 记录历史上限 */
  TOKEN_RECORDS_MAX: 500,

  // ===== 并发 =====
  /** 工具并行执行上限 */
  MAX_PARALLEL_TOOLS: 5,
  /** 子 Agent 并行上限 */
  MAX_PARALLEL_SUBAGENTS: 3,
  /** Worker 池大小 */
  WORKER_POOL_SIZE: 4,
  /** HTTP 请求并发上限 */
  MAX_CONCURRENT_REQUESTS: 10,

  // ===== 重试 =====
  /** 默认最大重试次数 */
  DEFAULT_MAX_RETRIES: 3,
  /** LLM 调用最大重试 */
  LLM_MAX_RETRIES: 2,

  // ===== 缓存 =====
  /** LRU 缓存默认大小 */
  LRU_CACHE_SIZE: 100,
  /** 资源缓存大小 (字节) */
  RESOURCE_CACHE_BYTES: 50 * 1024 * 1024,
  /** 嵌入向量缓存条数 */
  EMBEDDING_CACHE_SIZE: 1000,

  // ===== 订阅 =====
  /** EventBus 最大订阅者 */
  MAX_EVENT_LISTENERS: 100,
  /** StateBus 最大订阅者 */
  MAX_STATE_LISTENERS: 100,

  // ===== 历史/日志 =====
  /** Action 历史上限 */
  ACTION_HISTORY_MAX: 1000,
  /** Span 历史上限 */
  SPAN_HISTORY_MAX: 500,
  /** 压缩历史上限 */
  COMPRESSION_HISTORY_MAX: 20,

  // ===== 存储 =====
  /** L3 内存上限 (浏览器) */
  L3_MEMORY_LIMIT_BROWSER: 5 * 1024 * 1024 * 1024,
  /** 单个快照最大大小 */
  MAX_SNAPSHOT_SIZE: 10 * 1024 * 1024,
  /** 检查点保留数量 */
  CHECKPOINT_KEEP_COUNT: 10,

  // ===== 输入 =====
  /** 用户输入最大长度 */
  MAX_USER_INPUT_LENGTH: 100_000,
  /** 用户输入历史上限 */
  MAX_USER_INPUTS: 1000,
  /** 文件上传最大大小 */
  MAX_FILE_SIZE: 100 * 1024 * 1024,

  // ===== 循环保护 =====
  /** 最大循环次数 */
  MAX_LOOP_ITERATIONS: 1000,
  /** 最大递归深度 */
  MAX_RECURSION_DEPTH: 50,
});

/**
 * 根据场景获取限制值
 * @param {keyof typeof LIMITS} key - 限制常量键名
 * @param {number} [override] - 覆盖值（正数时使用此值替代默认）
 * @returns {number} 限制值，未匹配时回退 100
 */
export function getLimit(key, override) {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  return LIMITS[key] ?? 100;
}
