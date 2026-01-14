/**
 * 常量定义 - 阈值
 * @module runtime/constants/thresholds
 */

/**
 * 阈值常量
 */
export const THRESHOLDS = Object.freeze({
  // ===== 压缩触发 =====
  /** Token 使用率触发压缩 */
  COMPRESS_TOKEN_RATIO: 0.8,
  /** 消息数触发压缩 */
  COMPRESS_MESSAGE_COUNT: 20,

  // ===== 性能降级 =====
  /** 延迟降级阈值 (ms) */
  LATENCY_DEGRADED: 2_000,
  /** 延迟危急阈值 (ms) */
  LATENCY_CRITICAL: 5_000,
  /** 错误率降级阈值 */
  ERROR_RATE_DEGRADED: 0.1,
  /** 错误率危急阈值 */
  ERROR_RATE_CRITICAL: 0.3,

  // ===== 熔断器 =====
  /** 熔断失败次数阈值 */
  CIRCUIT_FAILURE_COUNT: 5,
  /** 熔断恢复时间 (ms) */
  CIRCUIT_RECOVERY_TIME: 30_000,
  /** 半开状态成功次数 */
  CIRCUIT_HALF_OPEN_SUCCESS: 3,

  // ===== 速率限制 =====
  /** 每分钟请求上限 */
  RATE_LIMIT_RPM: 60,
  /** 每分钟 Token 上限 */
  RATE_LIMIT_TPM: 100_000,

  // ===== 质量检测 =====
  /** 收敛检测窗口 */
  CONVERGENCE_WINDOW: 5,
  /** 收敛相似度阈值 */
  CONVERGENCE_SIMILARITY: 0.9,
  /** 循环检测阈值 */
  LOOP_DETECTION_THRESHOLD: 3,

  // ===== 内存警告 =====
  /** 内存使用警告阈值 */
  MEMORY_WARN_RATIO: 0.7,
  /** 内存使用危急阈值 */
  MEMORY_CRITICAL_RATIO: 0.9,

  // ===== 相似度 =====
  /** 语义相似度阈值 (向量检索) */
  SEMANTIC_SIMILARITY: 0.7,
  /** 关键词匹配阈值 (BM25) */
  KEYWORD_MATCH_SCORE: 1.0,
});

/**
 * 根据场景获取阈值
 * @param {keyof typeof THRESHOLDS} key
 * @param {number} [override]
 * @returns {number}
 */
export function getThreshold(key, override) {
  if (typeof override === "number" && Number.isFinite(override)) {
    return override;
  }
  return THRESHOLDS[key] ?? 0.5;
}
