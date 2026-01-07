/**
 * Debug Logger Plugin
 *
 * 开发调试用，打印详细日志
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

export default createPlugin({
  name: 'debug/logger',
  version: '1.0.0',
  description: '调试日志 - 开发环境使用',

  defaultConfig: {
    level: 'debug', // debug | info | warn | error
    pretty: true,
    includeTimestamp: true,
    includeEventData: true,
    maxDataLength: 500,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {void}
   */
  install(ctx) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = levels[ctx.config.level] || 0;

    const buffer = [];
    const maxBuffer = Number.isFinite(ctx.config.maxBuffer)
      ? Math.max(0, Math.floor(ctx.config.maxBuffer))
      : 200;

    const pushBuffer = (entry) => {
      if (maxBuffer <= 0) return;
      buffer.push(entry);
      while (buffer.length > maxBuffer) buffer.shift();
    };

    const formatTime = () => {
      if (!ctx.config.includeTimestamp) return '';
      const now = new Date();
      return `[${now.toISOString().slice(11, 23)}]`;
    };

    const truncate = (str, max) => {
      if (str.length <= max) return str;
      return str.slice(0, max) + '...';
    };

    const formatData = (data) => {
      if (!ctx.config.includeEventData || data === undefined) return '';
      try {
        const str = JSON.stringify(data);
        return ' ' + truncate(str, ctx.config.maxDataLength);
      } catch {
        return ' [circular]';
      }
    };

    const log = (level, event, data) => {
      if (levels[level] < currentLevel) return;

      pushBuffer({ level, event, data, timestamp: Date.now() });

      const prefix = ctx.config.pretty
        ? `${formatTime()} [${level.toUpperCase().padEnd(5)}]`
        : `${formatTime()} ${level}:`;

      console[level](`${prefix} ${event}${formatData(data)}`);
    };

    // 暴露服务接口（便于调试/测试）
    ctx.registerService('logger', {
      /**
       * @returns {Record<string, any>}
       */
      getConfig: () => ({ ...ctx.config }),

      /**
       * @returns {any[]}
       */
      getBuffer: () => buffer.slice(),

      /**
       * @returns {boolean}
       */
      clearBuffer: () => {
        buffer.length = 0;
        return true;
      },
    });

    // 记录插件状态（作用域写入）
    ctx.state.set('installedAt', Date.now());

    // 监听所有事件
    ctx.on('*', (evt) => {
      const event = typeof evt?.name === 'string' ? evt.name : '';
      const data = evt?.payload;

      // 分类事件级别
      if (event.includes('.error')) {
        log('error', event, data);
      } else if (event.includes('.warning') || event.includes('.warn')) {
        log('warn', event, data);
      } else if (event.startsWith('kernel.') || event.startsWith('plugin.')) {
        log('info', event, data);
      } else {
        log('debug', event, data);
      }
    });

    // 监听状态变更
    ctx.state.subscribe('*', (newValue, oldValue, path) => {
      log('debug', `state.change:${path}`, { old: oldValue, new: newValue });
    });

    ctx.log.info('Debug logger plugin installed');
  },
});
