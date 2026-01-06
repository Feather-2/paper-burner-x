/**
 * Cicada Compression Plugin
 *
 * 包装现有的 CicadaCompressor，接入微内核
 */

import { createPlugin } from '../../core/plugin.js';

export default createPlugin({
  name: 'compression/cicada',
  version: '1.0.0',
  description: '上下文压缩 - 基于 Cicada 算法',

  defaultConfig: {
    aggressive: false,
    maxContextTokens: 100000,
    compressionRatio: 0.6,
  },

  async install(ctx) {
    // 懒加载 CicadaCompressor
    let compressor = null;

    const getCompressor = async () => {
      if (!compressor) {
        const { CicadaCompressor } = await import('../../runtime/compression/cicada-compressor.js');
        compressor = new CicadaCompressor(ctx.config);
      }
      return compressor;
    };

    // 注册服务
    ctx.registerService('compression', {
      async compress(messages, options = {}) {
        const c = await getCompressor();
        const result = await c.compress(messages, options);

        // 更新状态
        ctx.state.set('lastCompression', {
          before: messages.length,
          after: result.messages?.length || messages.length,
          timestamp: Date.now(),
        });

        ctx.events.emit('compression.done', {
          originalCount: messages.length,
          compressedCount: result.messages?.length,
          ratio: result.ratio,
        });

        return result;
      },

      async shouldCompress(messages, tokenCount) {
        return tokenCount > ctx.config.maxContextTokens * 0.8;
      },

      getStats() {
        return ctx.state.get('') || {};
      },
    });

    // 监听 token 阈值
    ctx.on('runtime.tokens.updated', async (data) => {
      if (data.total > ctx.config.maxContextTokens * 0.9) {
        ctx.events.emit('compression.warning', {
          current: data.total,
          threshold: ctx.config.maxContextTokens,
        });
      }
    });

    ctx.log.info('Cicada compression plugin installed');
  },

  async uninstall(ctx) {
    ctx.log.info('Cicada compression plugin uninstalled');
  },
});
