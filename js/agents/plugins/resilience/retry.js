/**
 * Retry Plugin
 *
 * 为 ServiceBus 添加自动重试能力
 */

import { createPlugin } from '../../core/plugin.js';
import { createRetryProxy } from '../../core/service-bus.js';

export default createPlugin({
  name: 'resilience/retry',
  version: '1.0.0',
  description: '服务调用自动重试',

  defaultConfig: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT'],
  },

  install(ctx) {
    const shouldRetry = (error, context) => {
      // 检查是否是可重试错误
      const errorCode = error.code || error.name;
      if (ctx.config.retryableErrors.includes(errorCode)) {
        return true;
      }

      // 429 Rate Limit
      if (error.status === 429) {
        return true;
      }

      // 5xx 服务器错误
      if (error.status >= 500 && error.status < 600) {
        return true;
      }

      return false;
    };

    const proxy = createRetryProxy({
      maxRetries: ctx.config.maxRetries,
      delay: ctx.config.baseDelay,
      shouldRetry,
    });

    // 包装原始 invoke 以记录重试
    const originalInvoke = proxy.invoke;
    proxy.invoke = async (context, next) => {
      let attempts = 0;
      const wrappedNext = async () => {
        attempts++;
        if (attempts > 1) {
          ctx.events.emit('resilience.retry', {
            service: context.service,
            method: context.method,
            attempt: attempts,
          });
          ctx.state.merge('retryStats', {
            total: (ctx.state.get('retryStats.total') || 0) + 1,
          });
        }
        return next();
      };

      try {
        return await originalInvoke(context, wrappedNext);
      } catch (error) {
        ctx.events.emit('resilience.exhausted', {
          service: context.service,
          method: context.method,
          attempts,
          error: error.message,
        });
        throw error;
      }
    };

    ctx.services.useProxy(proxy);

    ctx.registerService('retry', {
      getStats: () => ctx.state.get('retryStats') || { total: 0 },
      resetStats: () => ctx.state.set('retryStats', { total: 0 }),
    });

    ctx.log.info('Retry plugin installed');
  },
});
