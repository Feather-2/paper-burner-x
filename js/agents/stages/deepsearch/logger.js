/**
 * DeepSearch 日志系统
 * 在控制台输出详细的执行日志，并通过 EventBus 发射结构化事件，方便调试和追踪
 */

const LOG_PREFIX = '[DeepSearch]';
const COLORS = {
  scan: 'color: #2196F3',      // 蓝色
  gaps: 'color: #9C27B0',      // 紫色
  retrieve: 'color: #FF9800',  // 橙色
  understand: 'color: #4CAF50', // 绿色
  write: 'color: #E91E63',     // 粉色
  condense: 'color: #00BCD4',  // 青色
  error: 'color: #F44336',     // 红色
  info: 'color: #607D8B',      // 灰色
};

let enabled = true;
let eventBus = null;
let currentContext = { runId: null, iteration: 0 };

/**
 * 设置日志上下文（runId 和 iteration）
 */
export function setLogContext({ runId, iteration } = {}) {
  if (runId !== undefined) currentContext.runId = runId;
  if (iteration !== undefined) currentContext.iteration = iteration;
}

/**
 * 获取当前日志上下文
 */
export function getLogContext() {
  return { ...currentContext };
}

/**
 * 设置 EventBus 实例用于事件发射
 */
export function setEventBus(bus) {
  eventBus = bus;
}

/**
 * 启用/禁用日志
 */
export function enableLogging(value = true) {
  enabled = value;
}

/**
 * 检查日志是否启用
 */
export function isLoggingEnabled() {
  return enabled;
}

/**
 * 记录结构化日志事件
 * @param {object} payload - 日志 payload，必须包含 stage 字段
 */
export function logEvent(payload) {
  if (!enabled) return;

  const timestamp = new Date().toISOString();
  const fullPayload = {
    runId: currentContext.runId || 'unknown',
    iteration: currentContext.iteration || 0,
    timestamp,
    ...payload,
  };

  // 验证必需字段
  if (!fullPayload.stage) {
    console.warn(`${LOG_PREFIX} logEvent called without stage field`, fullPayload);
    return;
  }

  // 通过 EventBus 发射事件（如果可用）
  if (eventBus && typeof eventBus.emit === 'function') {
    try {
      const eventName = `deepsearch.log.${fullPayload.stage}`;
      eventBus.emit(eventName, {
        actor: 'deepsearch.logger',
        payload: fullPayload,
      });
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to emit event:`, err);
    }
  }

  // 同时输出到控制台
  const color = COLORS[fullPayload.stage] || COLORS.info;
  const msg = fullPayload.message || fullPayload.stage;
  console.log(
    `%c${LOG_PREFIX} [${timestamp.slice(11, 23)}] [${fullPayload.stage}] ${msg}`,
    color,
    fullPayload.data || ''
  );
}

/**
 * 追踪工具调用（grep/glob/read 等）
 * @param {string} tool - 工具名称
 * @param {object} args - 工具参数
 * @param {Function} fn - 工具调用函数
 * @returns {Promise<any>} 工具调用结果
 */
export async function trackToolCall(tool, args, fn) {
  if (!enabled) return fn();

  const startTime = Date.now();
  const callPayload = {
    stage: 'tool',
    message: `Tool call: ${tool}`,
    data: { tool, args },
  };

  logEvent(callPayload);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    logEvent({
      stage: 'tool',
      message: `Tool completed: ${tool}`,
      data: { tool, duration, success: true },
      toolCalls: [{
        tool,
        args,
        result: typeof result === 'object' ? { type: typeof result, length: Array.isArray(result) ? result.length : undefined } : result,
        duration,
      }],
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logEvent({
      stage: 'tool',
      message: `Tool failed: ${tool}`,
      data: { tool, duration, success: false, error: error.message },
      toolCalls: [{
        tool,
        args,
        error: error.message,
        duration,
      }],
    });

    throw error;
  }
}

/**
 * 传统日志方法（向后兼容）
 */
export function log(stage, message, data = null) {
  if (!enabled) return;
  const color = COLORS[stage] || COLORS.info;
  const timestamp = new Date().toISOString().slice(11, 23);

  if (data !== null) {
    console.log(`%c${LOG_PREFIX} [${timestamp}] [${stage}] ${message}`, color, data);
  } else {
    console.log(`%c${LOG_PREFIX} [${timestamp}] [${stage}] ${message}`, color);
  }
}

export function logError(stage, message, error = null) {
  if (!enabled) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  console.error(`${LOG_PREFIX} [${timestamp}] [${stage}] ERROR: ${message}`, error || '');

  // 同时发射结构化错误事件
  logEvent({
    stage,
    message: `ERROR: ${message}`,
    data: { error: error?.message || String(error) },
  });
}

export function logGroup(stage, title) {
  if (!enabled) return;
  console.group(`%c${LOG_PREFIX} [${stage}] ${title}`, COLORS[stage] || COLORS.info);
}

export function logGroupEnd() {
  if (!enabled) return;
  console.groupEnd();
}

// 便捷方法
export const scanLog = (msg, data) => log('scan', msg, data);
export const gapsLog = (msg, data) => log('gaps', msg, data);
export const retrieveLog = (msg, data) => log('retrieve', msg, data);
export const understandLog = (msg, data) => log('understand', msg, data);
export const writeLog = (msg, data) => log('write', msg, data);
export const condenseLog = (msg, data) => log('condense', msg, data);

// 全局暴露，方便在控制台手动启用/禁用
if (typeof window !== 'undefined') {
  window.__DeepSearchLogger = {
    enable: () => enableLogging(true),
    disable: () => enableLogging(false),
    setContext: setLogContext,
    log,
    logEvent,
  };
  console.log('%c[DeepSearch] 日志系统已加载。使用 window.__DeepSearchLogger.enable() / disable() 控制', 'color: #2196F3; font-weight: bold');
}
