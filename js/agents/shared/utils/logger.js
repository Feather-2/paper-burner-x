/**
 * 通用 Logger 工具 - 供所有 Agent 使用
 *
 * 从 deepsearch/runtime/logger.js 提升到共享层，
 * 支持可配置的 actor 名称。
 */

/**
 * 创建并发安全的 logger 实例
 * @param {string | { emit?: Function, getContext?: Function, enabled?: boolean, actor?: string, stage?: string }} options
 */
export function createLogger(options = {}) {
    const normalized = typeof options === "string" ? { stage: options } : options || {};
    const { emit, getContext, enabled = true, actor = "agent", stage } = normalized;

    const isEnabled = Boolean(enabled);
    const baseGetCtx = typeof getContext === "function" ? getContext : null;
    const stageName = typeof stage === "string" && stage.trim() ? stage.trim() : null;
    const getCtx = stageName
      ? () => {
            const ctx = baseGetCtx?.();
            return { ...(ctx && typeof ctx === "object" ? ctx : {}), stage: stageName };
        }
      : baseGetCtx;
    const emitFn = typeof emit === "function" ? emit : null;
    const actorName = actor;

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

        emitFn?.(`${actorName}:log`, { ...payload, level }, { status: level === "error" ? "failed" : "info" });

        const consoleObj = typeof globalThis !== "undefined" ? globalThis.console : undefined;
        const consoleFn =
            level === "error"
                ? consoleObj?.error
                : level === "warn"
                  ? consoleObj?.warn
                  : consoleObj?.log;
        if (typeof consoleFn === "function") {
            consoleFn(`[${actorName}:${payload.stage || "?"}]`, message, data);
        }
    };

    return {
        log,
        debug: (msg, data) => log("debug", msg, data),
        info: (msg, data) => log("info", msg, data),
        warn: (msg, data) => log("warn", msg, data),
        error: (msg, data) => log("error", msg, data),
    };
}

// Alias for SDK API naming consistency (AgentBuilder uses `use*` methods).
export const useLogger = createLogger;

/**
 * 追踪工具调用（grep/glob/read 等）
 * @param {{ info?: Function, error?: Function } | null | undefined} logger
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
    console.log("[Agent]", payload?.message || payload);
}
