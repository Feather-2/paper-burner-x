/**
 * 常量定义 - 超时时间
 * @module runtime/constants/timeouts
 */

/**
 * 超时时间常量（毫秒）
 */
export const TIMEOUTS = Object.freeze({
  // ===== 工具执行 =====
  /** 工具执行默认超时 */
  TOOL_EXECUTION: 30_000,
  /** 工具执行最大超时 */
  TOOL_EXECUTION_MAX: 300_000,

  // ===== Worker 通信 =====
  /** Worker RPC 默认超时 */
  WORKER_RPC: 30_000,
  /** Worker 启动超时 */
  WORKER_INIT: 10_000,
  /** Worker 终止等待 */
  WORKER_TERMINATE: 5_000,

  // ===== LLM 调用 =====
  /** LLM 调用默认超时 */
  LLM_CALL: 120_000,
  /** LLM 流式响应首 token 超时 */
  LLM_FIRST_TOKEN: 30_000,
  /** LLM 流式响应 token 间隔超时 */
  LLM_TOKEN_INTERVAL: 10_000,

  // ===== 网络请求 =====
  /** HTTP 请求默认超时 */
  HTTP_REQUEST: 30_000,
  /** HTTP 连接超时 */
  HTTP_CONNECT: 10_000,
  /** WebSocket 心跳间隔 */
  WEBSOCKET_HEARTBEAT: 30_000,

  // ===== 进程管理 =====
  /** 优雅关闭等待 */
  GRACEFUL_SHUTDOWN: 5_000,
  /** 强制终止前等待 */
  FORCE_KILL: 10_000,

  // ===== 定时任务 =====
  /** 清理任务间隔 */
  CLEANUP_INTERVAL: 60_000,
  /** 检查点创建间隔 */
  CHECKPOINT_INTERVAL: 300_000,
  /** 心跳检查间隔 */
  HEARTBEAT_INTERVAL: 10_000,

  // ===== 压缩/监控 =====
  /** Watchdog 检查间隔 */
  WATCHDOG_INTERVAL: 5_000,
  /** 卡住检测阈值 */
  STUCK_THRESHOLD: 60_000,
  /** 最大运行时间 */
  MAX_RUNTIME: 600_000,

  // ===== 重试 =====
  /** 重试间隔（基础） */
  RETRY_BASE: 1_000,
  /** 重试间隔（最大） */
  RETRY_MAX: 30_000,
});

/**
 * 根据场景获取超时时间
 * @param {keyof typeof TIMEOUTS} key - 超时常量键名
 * @param {number} [override] - 覆盖值（正数时使用此值替代默认）
 * @returns {number} 超时时间（毫秒），未匹配时回退 30000
 */
export function getTimeout(key, override) {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  return TIMEOUTS[key] ?? 30_000;
}
