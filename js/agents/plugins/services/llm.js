/**
 * LLM Provider Plugin
 *
 * 将 LLM Provider 注册为内核服务
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

export default createPlugin({
  name: 'service/llm',
  version: '1.0.0',
  description: 'LLM 服务提供者',

  defaultConfig: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    temperature: 0.7,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    let provider = null;

    const getProvider = async () => {
      if (provider) return provider;

      /** @ts-ignore - llm/index.js may not exist in all builds */
      const { createProvider } = await import('../../llm/index.js');
      provider = await createProvider(ctx.config);
      return provider;
    };

    ctx.registerService('llm', {
      /**
       * @param {any[]} messages
       * @param {Record<string, any>} [options]
       * @returns {Promise<any>}
       */
      async chat(messages, options = {}) {
        const p = await getProvider();
        const result = await p.chat(messages, { ...ctx.config, ...options });

        // 更新 token 统计
        if (result.usage) {
          const current = ctx.state.getGlobal('runtime.tokens') || { input: 0, output: 0 };
          ctx.state.set('tokens', {
            input: current.input + (result.usage.input_tokens || 0),
            output: current.output + (result.usage.output_tokens || 0),
          });
        }

        ctx.events.emit('llm.response', {
          model: result.model,
          tokens: result.usage,
        });

        return result;
      },

      /**
       * @param {any[]} messages
       * @param {Record<string, any>} [options]
       * @returns {Promise<any>}
       */
      async stream(messages, options = {}) {
        const p = await getProvider();
        return p.stream(messages, { ...ctx.config, ...options });
      },

      /**
       * @returns {Record<string, any>}
       */
      getConfig() {
        return { ...ctx.config };
      },

      /**
       * @returns {Record<string, any>}
       */
      getStats() {
        return ctx.state.get('') || {};
      },
    });

    ctx.log.info('LLM service plugin installed');
  },
});
