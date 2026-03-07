/**
 * Debug Logger Plugin
 *
 * 开发调试用，打印详细日志
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */
/** @typedef {PluginContext & { _loggerUnsubs?: { unsubEvents?: (() => void) | null, unsubState?: (() => void) | null } | null }} LoggerPluginContext */

/**
 * @typedef {Object} LoggerConfig
 * @property {'debug' | 'info' | 'warn' | 'error'} level - 日志级别
 * @property {boolean} pretty - 美化输出
 * @property {boolean} includeTimestamp - 包含时间戳
 * @property {boolean} includeEventData - 包含事件数据
 * @property {number} maxDataLength - 数据最大长度
 * @property {number} [maxBuffer] - 缓冲区最大条目数
 * @property {string[]} [sensitiveFields] - 敏感字段名列表
 */

/**
 * @typedef {Object} LogBufferEntry
 * @property {'debug' | 'info' | 'warn' | 'error'} level - 日志级别
 * @property {string} event - 事件名
 * @property {unknown} data - 事件数据（已脱敏）
 * @property {number} timestamp - 时间戳
 */

/**
 * @typedef {Object} LoggerService
 * @property {() => LoggerConfig} getConfig - 获取配置
 * @property {() => LogBufferEntry[]} getBuffer - 获取缓冲区
 * @property {() => boolean} clearBuffer - 清空缓冲区
 */

/** @type {string[]} */
const DEFAULT_SENSITIVE_FIELDS = [
  'token', 'apiKey', 'api_key', 'apikey',
  'password', 'secret', 'authorization',
  'credential', 'credentials', 'key',
  'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'bearer', 'jwt', 'sessionId', 'session_id',
];

/**
 * 对数据中的敏感字段进行脱敏
 * @param {unknown} data - 原始数据
 * @param {string[]} sensitiveFields - 敏感字段名列表
 * @returns {unknown} 脱敏后的数据
 */
function sanitizeData(data, sensitiveFields) {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeData(item, sensitiveFields));
  }

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some((f) =>
      lowerKey.includes(f.toLowerCase())
    );

    if (isSensitive && value !== undefined && value !== null) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeData(value, sensitiveFields);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 格式化时间戳
 * @param {boolean} include - 是否包含时间戳
 * @returns {string}
 */
function formatTime(include) {
  if (!include) return '';
  const now = new Date();
  return `[${now.toISOString().slice(11, 23)}]`;
}

/**
 * 截断字符串
 * @param {string} str - 原字符串
 * @param {number} max - 最大长度
 * @returns {string}
 */
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

/**
 * 格式化数据为字符串
 * @param {unknown} data - 数据
 * @param {boolean} include - 是否包含
 * @param {number} maxLen - 最大长度
 * @returns {string}
 */
function formatData(data, include, maxLen) {
  if (!include || data === undefined) return '';
  try {
    const str = JSON.stringify(data);
    return ' ' + truncate(str, maxLen);
  } catch {
    return ' [circular]';
  }
}

/**
 * 确定事件的日志级别
 * @param {string} event - 事件名
 * @returns {'debug' | 'info' | 'warn' | 'error'}
 */
function classifyEventLevel(event) {
  if (event.includes('.error')) return 'error';
  if (event.includes('.warning') || event.includes('.warn')) return 'warn';
  if (event.startsWith('kernel.') || event.startsWith('plugin.')) return 'info';
  return 'debug';
}

/**
 * 创建日志函数
 * @param {Object} options
 * @param {Record<string, number>} options.levels - 级别映射
 * @param {number} options.currentLevel - 当前级别
 * @param {LogBufferEntry[]} options.buffer - 缓冲区
 * @param {number} options.maxBuffer - 最大缓冲条目
 * @param {LoggerConfig} options.config - 配置
 * @param {string[]} options.sensitiveFields - 敏感字段
 * @returns {(level: string, event: string, data: unknown) => void}
 */
function createLogFn(options) {
  const { levels, currentLevel, buffer, maxBuffer, config, sensitiveFields } = options;

  return (level, event, data) => {
    if (levels[level] < currentLevel) return;

    const sanitized = sanitizeData(data, sensitiveFields);

    if (maxBuffer > 0) {
      buffer.push({
        level: /** @type {"error" | "info" | "warn" | "debug"} */ (level),
        event,
        data: sanitized,
        timestamp: Date.now(),
      });
      while (buffer.length > maxBuffer) buffer.shift();
    }

    const prefix = config.pretty
      ? `${formatTime(config.includeTimestamp)} [${level.toUpperCase().padEnd(5)}]`
      : `${formatTime(config.includeTimestamp)} ${level}:`;

    console[level](`${prefix} ${event}${formatData(sanitized, config.includeEventData, config.maxDataLength)}`);
  };
}

/**
 * @param {LoggerPluginContext} ctx
 * @param {(level: string, event: string, data: unknown) => void} log
 * @returns {{ unsubEvents: (() => void)|undefined, unsubState: (() => void)|undefined }}
 */
function registerEventListeners(ctx, log) {
  const unsubEvents = ctx.on('*', (evt) => {
    const event = typeof evt?.name === 'string' ? evt.name : '';
    const data = evt?.payload;
    log(classifyEventLevel(event), event, data);
  });

  const unsubState = ctx.state.subscribe('*', (newValue, oldValue, path) => {
    log('debug', `state.change:${path}`, { old: oldValue, new: newValue });
  });

  return { unsubEvents, unsubState };
}

export default createPlugin({
  name: 'debug/logger',
  version: '1.0.0',
  description: '调试日志 - 开发环境使用',

  defaultConfig: {
    level: 'debug', // debug | info | warn | error
    pretty: true,
    includeTimestamp: true,
    includeEventData: false, // 默认关闭以减少敏感数据暴露
    maxDataLength: 500,
    sensitiveFields: [],
  },

  /**
   * @param {LoggerPluginContext} ctx
   * @returns {void}
   */
  install(ctx) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = levels[ctx.config.level] || 0;

    /** @type {LogBufferEntry[]} */
    const buffer = [];
    const maxBuffer = Number.isFinite(ctx.config.maxBuffer)
      ? Math.max(0, Math.floor(ctx.config.maxBuffer))
      : 200;

    const sensitiveFields = [
      ...DEFAULT_SENSITIVE_FIELDS,
      ...(ctx.config.sensitiveFields || []),
    ];

    const log = createLogFn({
      levels,
      currentLevel,
      buffer,
      maxBuffer,
      config: ctx.config,
      sensitiveFields,
    });

    /** @type {LoggerService} */
    const loggerService = {
      getConfig: () => ({ ...ctx.config }),
      getBuffer: () => buffer.slice(),
      clearBuffer: () => {
        buffer.length = 0;
        return true;
      },
    };

    ctx.registerService('logger', loggerService);
    ctx.state.set('installedAt', Date.now());
    const { unsubEvents, unsubState } = registerEventListeners(ctx, log);
    ctx._loggerUnsubs = { unsubEvents, unsubState };
    ctx.log.info('Debug logger plugin installed');
  },

  /**
   * @param {LoggerPluginContext} ctx
   * @returns {void}
   */
  uninstall(ctx) {
    if (ctx._loggerUnsubs) {
      if (ctx._loggerUnsubs.unsubEvents) ctx._loggerUnsubs.unsubEvents();
      if (ctx._loggerUnsubs.unsubState) ctx._loggerUnsubs.unsubState();
      ctx._loggerUnsubs = null;
    }
    ctx.log.info('Debug logger plugin uninstalled');
  },
});
