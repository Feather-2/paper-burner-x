/**
 * Cicada Compression Plugin
 *
 * 包装现有的 CicadaCompressor，接入微内核
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/**
 * 压缩消息格式
 * @typedef {Object} CompressionMessage
 * @property {string} role - 消息角色 (user/assistant/system)
 * @property {string} content - 消息内容
 */

/**
 * 压缩选项
 * @typedef {Object} CompressionOptions
 * @property {number} [targetTokens] - 目标 token 数
 * @property {boolean} [aggressive] - 是否激进压缩
 */

/**
 * 压缩结果
 * @typedef {Object} CompressionResult
 * @property {CompressionMessage[]} messages - 压缩后的消息列表
 * @property {number} ratio - 压缩比 (0-1)
 * @property {number} [originalTokens] - 原始 token 数
 * @property {number} [compressedTokens] - 压缩后 token 数
 */

/** @type {number} 触发压缩的 token 使用率阈值 */
const SHOULD_COMPRESS_RATIO = 0.8;

/** @type {number} 触发告警的 token 使用率阈值 */
const WARNING_RATIO = 0.9;

export default createPlugin({
  name: 'compression/cicada',
  version: '1.0.0',
  description: '上下文压缩 - 基于 Cicada 算法',

  defaultConfig: {
    aggressive: false,
    maxContextTokens: 100000,
    compressionRatio: 0.6,
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
        const key = `compression:cicada:${runId}:lastCompression`;
        const restored = await archive.load(key);
        if (restored?.data) {
          ctx.state.set('lastCompression', restored.data);
          ctx.log.info('Restored lastCompression from archive');
        }
      } catch (err) {
        ctx.log.warn('Failed to restore lastCompression from archive:', err);
      }
    }
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    // 懒加载 CicadaCompressor
    let compressor = null;

    const getCompressor = async () => {
      if (!compressor) {
        const { CicadaCompressor } = await import('./impl/cicada-compressor.js');
        compressor = new CicadaCompressor(ctx.config);
      }
      return compressor;
    };

    // 注册服务
    ctx.registerService('compression', {
      /**
       * 压缩消息列表，减少上下文 token 占用
       * @param {CompressionMessage[]} messages - 待压缩的消息列表
       * @param {CompressionOptions} [options] - 压缩选项
       * @returns {Promise<CompressionResult>} 压缩结果
       */
      async compress(messages, options = {}) {
        const c = await getCompressor();
        const result = await c.compress(messages, options);

        // 更新状态
        const compressionData = {
          before: messages.length,
          after: result.messages?.length || messages.length,
          timestamp: Date.now(),
        };
        ctx.state.set('lastCompression', compressionData);

        ctx.events.emit('compression:done', {
          originalCount: messages.length,
          compressedCount: result.messages?.length,
          ratio: result.ratio,
        });

        // 异步持久化
        const archive = ctx._kernel?.archive || null;
        const runId = ctx._kernel?.id || 'default';
        if (archive) {
          queueMicrotask(() => {
            const key = `compression:cicada:${runId}:lastCompression`;
            archive.save(key, { data: compressionData }).catch((err) => {
              ctx.log.warn('Failed to persist lastCompression to archive:', err);
            });
          });
        }

        return result;
      },

      /**
       * 判断是否需要压缩
       * @param {CompressionMessage[]} messages - 消息列表
       * @param {number} tokenCount - 当前 token 数
       * @returns {Promise<boolean>} 是否应当触发压缩
       */
      async shouldCompress(messages, tokenCount) {
        return tokenCount > ctx.config.maxContextTokens * SHOULD_COMPRESS_RATIO;
      },

      /**
       * 获取压缩统计信息
       * @returns {Record<string, unknown>} 统计数据
       */
      getStats() {
        return ctx.state.get('') || {};
      },
    });

    // 监听 token 阈值（保留取消订阅句柄）
    const unsub = ctx.on('runtime:tokens:updated', (evt) => {
      const data = evt?.payload;
      if (data?.total > ctx.config.maxContextTokens * WARNING_RATIO) {
        ctx.events.emit('compression:warning', {
          current: data.total,
          threshold: ctx.config.maxContextTokens,
        });
      }
    });
    ctx._cicadaUnsub = unsub;

    ctx.log.info('Cicada compression plugin installed');
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async uninstall(ctx) {
    if (ctx._cicadaUnsub) {
      ctx._cicadaUnsub();
      ctx._cicadaUnsub = null;
    }
    ctx.log.info('Cicada compression plugin uninstalled');
  },
});
