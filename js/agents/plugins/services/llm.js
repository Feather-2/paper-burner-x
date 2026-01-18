/**
 * LLM Provider Plugin
 *
 * 将 LLM Provider 注册为内核服务
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/**
 * @typedef {'user' | 'assistant' | 'system' | 'tool'} LlmRole
 */

/**
 * @typedef {object} LlmMessage
 * @property {LlmRole} role - 消息角色
 * @property {string} content - 消息内容
 * @property {string} [name] - 可选名称（用于 tool 角色）
 * @property {string} [tool_call_id] - 工具调用 ID
 */

/**
 * @typedef {object} ChatOptions
 * @property {string} [model] - 模型名称
 * @property {number} [maxTokens] - 最大生成 token 数
 * @property {number} [temperature] - 温度
 * @property {string} [system] - 系统提示词
 * @property {any[]} [tools] - 工具定义
 * @property {string} [tool_choice] - 工具选择策略
 */

/**
 * @typedef {object} LlmUsage
 * @property {number} [input_tokens] - 输入 token 数
 * @property {number} [output_tokens] - 输出 token 数
 */

/**
 * @typedef {object} LlmResponse
 * @property {string} model - 模型名称
 * @property {string} content - 响应内容
 * @property {LlmUsage} [usage] - token 使用统计
 * @property {string} [stop_reason] - 停止原因
 */

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
       * 发送聊天请求
       * @param {LlmMessage[]} messages - 消息列表
       * @param {ChatOptions} [options] - 聊天选项
       * @returns {Promise<LlmResponse>}
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
       * 流式聊天请求
       * @param {LlmMessage[]} messages - 消息列表
       * @param {ChatOptions} [options] - 聊天选项
       * @returns {Promise<AsyncIterable<{type: string, content?: string, delta?: string}>>}
       */
      async stream(messages, options = {}) {
        const p = await getProvider();
        return p.stream(messages, { ...ctx.config, ...options });
      },

      /**
       * 获取 LLM 配置
       * @returns {ChatOptions}
       */
      getConfig() {
        return { ...ctx.config };
      },

      /**
       * 获取 LLM 统计信息
       * @returns {{tokens?: {input: number, output: number}}}
       */
      getStats() {
        return ctx.state.get('') || {};
      },
    });

    ctx.log.info('LLM service plugin installed');
  },
});
