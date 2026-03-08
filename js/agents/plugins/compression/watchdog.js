/**
 * Watchdog Plugin
 *
 * 包装现有的 ContextWatchdog，监控上下文健康
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext & Record<string, any>} PluginContext */

export { Watchdog } from './impl/watchdog.js';

export default createPlugin({
  name: 'compression/watchdog',
  version: '1.0.0',
  description: '上下文监控 - 自动触发压缩',
  dependencies: ['compression/cicada'],

  defaultConfig: {
    threshold: 0.75,
    checkInterval: 5000,
    autoCompress: true,
    maxContextTokens: 100000,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async onStart(ctx) {
    const archive = ctx._kernel?.archive || null;
    const runId = ctx._kernel?.id || 'default';

    if (archive) {
      try {
        const key = `compression:watchdog:${runId}:health`;
        const restored = await archive.load(key);
        if (restored?.data) {
          ctx.state.set('health', restored.data);
          ctx.log.info('Restored health from archive');
        }
      } catch (err) {
        ctx.log.warn('Failed to restore health from archive:', err);
      }
    }
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    // 防御：重复安装时先清理旧资源，避免 interval / listener 叠加
    if (typeof ctx._watchdogCleanup === 'function') {
      try {
        ctx._watchdogCleanup();
      } catch (err) {
        ctx.log?.warn?.('Watchdog cleanup failed:', err);
      }
    }

    /** @type {number | null} */
    /** @type {ReturnType<typeof setInterval> | null} */
    let intervalId = null;
    /** @type {(() => void) | null} */
    let unsubscribe = null;
    let lastCheck = 0;

    /**
     * @returns {Promise<void>}
     */
    const checkHealth = async () => {
      const tokens = ctx.state.getGlobal('runtime.tokens') || { input: 0, output: 0 };
      const total = tokens.input + tokens.output;
      const maxTokens = ctx.config.maxContextTokens || 100000;
      const usage = total / maxTokens;

      const healthData = {
        usage,
        status: usage > ctx.config.threshold ? 'warning' : 'healthy',
        checkedAt: Date.now(),
      };
      ctx.state.set('health', healthData);

      // 异步持久化
      const archive = ctx._kernel?.archive || null;
      const runId = ctx._kernel?.id || 'default';
      if (archive) {
        queueMicrotask(() => {
          const key = `compression:watchdog:${runId}:health`;
          archive.save(key, { data: healthData }).catch((err) => {
            ctx.log.warn('Failed to persist health to archive:', err);
          });
        });
      }

      if (usage > ctx.config.threshold && ctx.config.autoCompress) {
        ctx.events.emit('watchdog:threshold:exceeded', { usage, threshold: ctx.config.threshold });

        // 触发压缩
        const messages = ctx.state.getGlobal('runtime.messages') || [];
        if (messages.length > 0) {
          try {
            await ctx.services.call('compression', 'compress', [messages]);
            ctx.log.info(`Auto-compressed at ${(usage * 100).toFixed(1)}% usage`);
          } catch (err) {
            ctx.log.error('Auto-compression failed:', err);
          }
        }
      }

      lastCheck = Date.now();
    };

    const cleanup = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (err) {
          ctx.log?.warn?.('Watchdog unsubscribe failed:', err);
        }
        unsubscribe = null;
      }
      ctx._watchdogInterval = null;
      ctx._watchdogCleanup = null;
    };

    // 提前暴露清理函数：保证 install 过程中抛错时也能回收资源
    ctx._watchdogCleanup = cleanup;

    try {
      // 定期检查
      if (ctx.config.checkInterval > 0) {
        intervalId = setInterval(() => {
          checkHealth().catch((err) => ctx.log?.error?.('Scheduled health check failed:', err));
        }, ctx.config.checkInterval);
      }

      // 订阅 token 更新事件（节流间隔 1s）
      /** @type {number} Token 事件节流间隔 (ms) */
      const TOKEN_EVENT_THROTTLE_MS = 1000;
      unsubscribe = ctx.on('runtime:tokens:*', () => {
        if (Date.now() - lastCheck > TOKEN_EVENT_THROTTLE_MS) {
          checkHealth().catch((err) => ctx.log?.error?.('Token event health check failed:', err));
        }
      });

      // 暴露手动检查接口
      ctx.registerService('watchdog', {
        /**
         * @returns {Promise<void>}
         */
        check: checkHealth,

        /**
         * @returns {any}
         */
        getHealth: () => ctx.state.get('health'),
      });

      ctx.log.info('Watchdog plugin installed');

      // 保存清理函数
      ctx._watchdogInterval = intervalId;
    } catch (error) {
      cleanup();
      throw error;
    }
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async uninstall(ctx) {
    if (typeof ctx._watchdogCleanup === 'function') {
      ctx._watchdogCleanup();
    } else if (ctx._watchdogInterval) {
      clearInterval(ctx._watchdogInterval);
      ctx._watchdogInterval = null;
    }
    ctx.log.info('Watchdog plugin uninstalled');
  },
});
