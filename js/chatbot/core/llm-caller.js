// llm-caller.js
// LLM调用辅助模块 - 提供统一的API调用接口

(function(window) {
  'use strict';

  /**
   * LLM调用器 - 封装API调用逻辑，供多个模块复用
   */
  class LLMCaller {
    constructor(config = {}) {
      this.config = config;
      this.defaultTimeout = config.timeout || 60000;
    }

    /**
     * 调用LLM API（非流式）
     * @param {string} systemPrompt - 系统提示词
     * @param {Array} conversationHistory - 对话历史 [{role, content}, ...]
     * @param {string} userPrompt - 用户提示词
     * @param {Object} options - 可选配置
     * @returns {Promise<string>} 模型响应
     */
    async call(systemPrompt, conversationHistory = [], userPrompt, options = {}) {
      // 获取配置
      const config = this.getConfig(options.externalConfig);

      // 构建API配置
      const apiConfig = await this.buildApiConfig(config, options.modelId);

      if (!apiConfig) {
        throw new Error('无法构建API配置');
      }

      // 构建消息列表
      const messages = this.buildMessages(systemPrompt, conversationHistory, userPrompt);

      // 调用API
      return await this.callApi(apiConfig, messages, options);
    }

    /**
     * 调用LLM API（流式）
     * @param {string} systemPrompt - 系统提示词
     * @param {Array} conversationHistory - 对话历史
     * @param {string} userPrompt - 用户提示词
     * @param {Function} onChunk - 流式回调 (chunk) => void
     * @param {Object} options - 可选配置
     * @returns {Promise<string>} 完整响应
     */
    async callStream(systemPrompt, conversationHistory = [], userPrompt, onChunk, options = {}) {
      const config = this.getConfig(options.externalConfig);
      const apiConfig = await this.buildApiConfig(config, options.modelId);

      if (!apiConfig || !apiConfig.streamSupport) {
        // 不支持流式，降级到非流式
        const response = await this.call(systemPrompt, conversationHistory, userPrompt, options);
        if (onChunk) onChunk(response);
        return response;
      }

      const messages = this.buildMessages(systemPrompt, conversationHistory, userPrompt);

      return await this.callApiStream(apiConfig, messages, onChunk, options);
    }

    /**
     * 获取配置
     */
    getConfig(externalConfig = null) {
      if (externalConfig) return externalConfig;

      // 使用 ChatbotConfigManager 获取配置
      if (window.ChatbotConfigManager) {
        try {
          const chatbotConfig = window.ChatbotConfigManager.getChatbotModelConfig();
          return window.ChatbotConfigManager.convertChatbotConfigToMessageSenderFormat(chatbotConfig);
        } catch (error) {
          console.error('[LLMCaller] 获取配置失败:', error);
        }
      }

      // 回退：使用全局配置
      if (window.MessageSender && window.MessageSender.getChatbotConfig) {
        return window.MessageSender.getChatbotConfig();
      }

      throw new Error('无法获取LLM配置');
    }

    /**
     * 构建API配置
     */
    async buildApiConfig(config, modelId = null) {
      let selectedModelId = modelId;

      // 如果未指定模型ID，按优先级获取
      if (!selectedModelId) {
        // 检查是否为自定义源（与message-sender.js保持一致）
        if (config.model === 'custom' ||
            (typeof config.model === 'string' && config.model.startsWith('custom_source_'))) {
          // 1. 最高优先级：Chatbot 专用配置的模型ID（cms.modelId）
          if (config.cms && config.cms.modelId) {
            selectedModelId = config.cms.modelId;
            console.log('[LLMCaller] ✓ 使用 Chatbot 独立配置:', selectedModelId);
          }
          // 2. 回退：翻译模型配置
          if (!selectedModelId && config.settings && config.settings.selectedCustomModelId) {
            selectedModelId = config.settings.selectedCustomModelId;
            console.log('[LLMCaller] ↩ 回退到翻译模型配置:', selectedModelId);
          }
          // 3. 进一步回退：可用模型列表的第一个
          if (!selectedModelId && Array.isArray(config.siteSpecificAvailableModels) && config.siteSpecificAvailableModels.length > 0) {
            selectedModelId = typeof config.siteSpecificAvailableModels[0] === 'object'
              ? config.siteSpecificAvailableModels[0].id
              : config.siteSpecificAvailableModels[0];
            console.log('[LLMCaller] ↩ 使用可用模型列表的第一个:', selectedModelId);
          }
        } else {
          // 非自定义源，直接使用 config.model
          selectedModelId = config.selectedModelId || config.model;
        }
      }

      if (!selectedModelId) {
        throw new Error('未指定模型ID，请在Chatbot设置中选择一个模型');
      }

      // 使用 ApiConfigBuilder
      if (window.ApiConfigBuilder && window.ApiConfigBuilder.buildCustomApiConfig) {
        console.log('[LLMCaller] 最终模型ID:', selectedModelId);
        return window.ApiConfigBuilder.buildCustomApiConfig(
          config.apiKey,
          config.cms.apiEndpoint || config.cms.apiBaseUrl,
          selectedModelId,
          config.cms.requestFormat,
          config.cms.temperature,
          config.cms.max_tokens,
          {
            endpointMode: (config.cms && config.cms.endpointMode) || 'auto'
          }
        );
      }

      throw new Error('ApiConfigBuilder未加载');
    }

    /**
     * 构建消息列表
     */
    buildMessages(systemPrompt, conversationHistory, userPrompt) {
      const messages = [];

      // 添加系统提示词
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      // 添加对话历史
      if (Array.isArray(conversationHistory)) {
        conversationHistory.forEach(msg => {
          messages.push({
            role: msg.role,
            content: this.extractTextContent(msg.content)
          });
        });
      }

      // 添加用户提示词
      if (userPrompt) {
        messages.push({ role: 'user', content: userPrompt });
      }

      return messages;
    }

    /**
     * 提取文本内容（处理多模态消息）
     */
    extractTextContent(content) {
      if (typeof content === 'string') {
        return content;
      }

      if (Array.isArray(content)) {
        const textParts = content.filter(part => part.type === 'text');
        return textParts.map(part => part.text).join('\n');
      }

      return String(content);
    }

    /**
     * 调用API（非流式）
     */
    async callApi(apiConfig, messages, options = {}) {
      let requestBody;

      if (apiConfig.bodyBuilder) {
        // 从 messages 数组中提取 system、history、user
        const systemMsg = messages.find(m => m.role === 'system');
        const systemPrompt = systemMsg ? systemMsg.content : '';
        const historyMsgs = messages.filter(m => m.role !== 'system' && m !== messages[messages.length - 1]);
        const userMsg = messages[messages.length - 1];
        const userContent = userMsg ? userMsg.content : '';

        requestBody = apiConfig.bodyBuilder(systemPrompt, historyMsgs, userContent);
      } else {
        requestBody = { messages };
      }

      // 如果有自定义的请求体构建器，使用它
      if (options.customBodyBuilder) {
        Object.assign(requestBody, options.customBodyBuilder(messages));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.defaultTimeout);

      try {
        const response = await fetch(apiConfig.endpoint, {
          method: 'POST',
          headers: apiConfig.headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API调用失败 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 使用responseExtractor提取响应
        if (apiConfig.responseExtractor) {
          return apiConfig.responseExtractor(data);
        }

        // 默认提取逻辑
        return data?.choices?.[0]?.message?.content || String(data);

      } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error('API调用超时');
        }

        throw error;
      }
    }

    /**
     * 调用API（流式）
     */
    async callApiStream(apiConfig, messages, onChunk, options = {}) {
      let requestBody;

      if (apiConfig.streamBodyBuilder) {
        // 从 messages 数组中提取 system、history、user
        const systemMsg = messages.find(m => m.role === 'system');
        const systemPrompt = systemMsg ? systemMsg.content : '';
        const historyMsgs = messages.filter(m => m.role !== 'system' && m !== messages[messages.length - 1]);
        const userMsg = messages[messages.length - 1];
        const userContent = userMsg ? userMsg.content : '';

        requestBody = apiConfig.streamBodyBuilder(systemPrompt, historyMsgs, userContent);
      } else {
        requestBody = { messages, stream: true };
      }

      if (options.customBodyBuilder) {
        Object.assign(requestBody, options.customBodyBuilder(messages));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.defaultTimeout);

      try {
        const response = await fetch(apiConfig.endpoint, {
          method: 'POST',
          headers: apiConfig.headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        if (!response.ok) {
          clearTimeout(timeoutId);
          const errorText = await response.text();
          throw new Error(`API调用失败 (${response.status}): ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            clearTimeout(timeoutId);
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim() || line.trim() === 'data: [DONE]') continue;

            try {
              const jsonStr = line.replace(/^data:\s*/, '');
              const parsed = JSON.parse(jsonStr);

              let chunk = '';
              if (parsed.choices?.[0]?.delta?.content) {
                chunk = parsed.choices[0].delta.content;
              } else if (parsed.choices?.[0]?.text) {
                chunk = parsed.choices[0].text;
              }

              if (chunk) {
                fullResponse += chunk;
                if (onChunk) onChunk(chunk);
              }
            } catch (e) {
              // 忽略解析错误的行
            }
          }
        }

        return fullResponse;

      } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error('API调用超时');
        }

        throw error;
      }
    }

    /**
     * 快捷方法：简单调用（只传用户提示词）
     */
    async quick(userPrompt, systemPrompt = '', options = {}) {
      return await this.call(systemPrompt, [], userPrompt, options);
    }
  }

  // 创建全局单例
  window.LLMCaller = LLMCaller;
  window.llmCaller = new LLMCaller();

  console.log('[LLMCaller] 模块已加载');

})(window);
