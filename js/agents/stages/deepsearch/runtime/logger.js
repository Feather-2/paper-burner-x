/**
 * 创建并发安全的 logger 实例
 * @param {{ emit?: Function, getContext?: Function, enabled?: boolean }} options
 */
export function createLogger({ emit, getContext, enabled = true } = {}) {
  const isEnabled = Boolean(enabled);
  const getCtx = typeof getContext === "function" ? getContext : null;
  const emitFn = typeof emit === "function" ? emit : null;

  const log = (level, message, data = {}) => {
    if (!isEnabled) return;
    const ctx = getCtx ? getCtx() : {};
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(ctx && typeof ctx === "object" ? ctx : {}),
      ...(data && typeof data === "object" ? data : {}),
    };

    emitFn?.(`deepsearch.log.${level}`, payload, { status: level === "error" ? "failed" : "info" });

    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(`[DeepSearch:${payload.stage || "?"}]`, message, data);
  };

  return {
    log,
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}

/**
 * 追踪工具调用（grep/glob/read 等）
 * @param {{ info?: Function, error?: Function }=} logger
 * @param {string} tool
 * @param {object} args
 * @param {Function} fn
 */
export async function trackToolCall(logger, tool, args, fn) {
  if (!logger || typeof logger.info !== "function") return fn();

  const startTime = Date.now();
  logger.info(`Tool call: ${tool}`, { stage: "tool", data: { tool, args } });

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    logger.info(`Tool completed: ${tool}`, {
      stage: "tool",
      data: { tool, duration, success: true },
      toolCalls: [
        {
          tool,
          args,
          result:
            result && typeof result === "object"
              ? { type: typeof result, length: Array.isArray(result) ? result.length : undefined }
              : result,
          duration,
        },
      ],
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Tool failed: ${tool}`, {
      stage: "tool",
      data: { tool, duration, success: false, error: error?.message },
      toolCalls: [{ tool, args, error: error?.message, duration }],
    });
    throw error;
  }
}

// 保留 logEvent 兼容旧代码，但标记 deprecated
/** @deprecated Use createLogger() instead */
export function logEvent(payload) {
  console.log("[DeepSearch]", payload?.message || payload);
}
