/**
 * 简单的日志工具
 * 提供不同级别的日志记录，支持结构化日志
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL
  ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO
  : process.env.NODE_ENV === 'production'
    ? LOG_LEVELS.INFO
    : LOG_LEVELS.DEBUG;

/**
 * 格式化日志消息
 */
function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

  return `[${timestamp}] [${level}] ${message}${metaStr}`;
}

/**
 * 错误日志
 */
export function logError(message, error = null, meta = {}) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.ERROR) {
    const errorMeta = error ? {
      ...meta,
      error: {
        message: error.message,
        stack: error.stack,
        ...(error.code && { code: error.code }),
        ...(error.statusCode && { statusCode: error.statusCode })
      }
    } : meta;

    console.error(formatLog('ERROR', message, errorMeta));
  }
}

/**
 * 警告日志
 */
export function logWarn(message, meta = {}) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.WARN) {
    console.warn(formatLog('WARN', message, meta));
  }
}

/**
 * 信息日志
 */
export function logInfo(message, meta = {}) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.INFO) {
    console.log(formatLog('INFO', message, meta));
  }
}

/**
 * 调试日志
 */
export function logDebug(message, meta = {}) {
  if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEBUG) {
    console.log(formatLog('DEBUG', message, meta));
  }
}

/**
 * 请求日志（可在中间件中使用）
 */
export function logRequest(req, res, responseTime = null) {
  const meta = {
    method: req.method,
    path: req.path,
    ...(req.user && { userId: req.user.id }),
    ...(responseTime && { responseTime: `${responseTime}ms` })
  };

  if (res.statusCode >= 400) {
    logWarn(`HTTP ${res.statusCode} ${req.method} ${req.path}`, meta);
  } else {
    logInfo(`HTTP ${res.statusCode} ${req.method} ${req.path}`, meta);
  }
}

