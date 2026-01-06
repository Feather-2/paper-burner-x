/**
 * @file js/chatbot/core/message-handler.js
 * @description 消息处理器 - 处理用户消息并调用 LLM
 *
 * Phase 8: Chatbot 重建
 * - 集成 js/agents/llm/model-router
 * - 支持流式响应
 * - 支持 RAG 检索增强
 */

/**
 * 消息处理器配置
 * @typedef {Object} MessageHandlerConfig
 * @property {Object} modelRouter - 模型路由器
 * @property {Object} retriever - 检索器（可选）
 * @property {Function} buildSystemPrompt - 系统提示词构建函数
 * @property {number} maxContextTokens - 最大上下文 token 数
 */

/**
 * 消息处理结果
 * @typedef {Object} MessageHandlerResult
 * @property {string} content - 响应内容
 * @property {string} model - 使用的模型
 * @property {Object} usage - token 使用情况
 * @property {Array} toolCalls - 工具调用（如有）
 * @property {Array} retrievedContext - 检索到的上下文（如有）
 */

/**
 * MessageHandler 类
 * 处理用户消息，调用 LLM 获取响应
 */
export class MessageHandler {
  /**
   * @param {MessageHandlerConfig} config
   */
  constructor(config = {}) {
    this.modelRouter = config.modelRouter || null;
    this.retriever = config.retriever || null;
    this.buildSystemPrompt = config.buildSystemPrompt || this._defaultSystemPrompt;
    this.maxContextTokens = config.maxContextTokens || 4000;

    // 兼容旧版 window 调用
    this._legacyApiBuilder = null;
    this._legacyLlmCaller = null;
  }

  /**
   * 设置旧版 API 构建器（向后兼容）
   */
  setLegacyApiBuilder(builder) {
    this._legacyApiBuilder = builder;
  }

  /**
   * 设置旧版 LLM 调用器（向后兼容）
   */
  setLegacyLlmCaller(caller) {
    this._legacyLlmCaller = caller;
  }

  /**
   * 处理消息
   * @param {Object} params
   * @param {Object} params.message - 用户消息
   * @param {Array} params.history - 聊天历史
   * @param {string} params.docId - 文档 ID
   * @param {AbortSignal} params.signal - 中止信号
   * @param {Function} params.onChunk - 流式回调
   * @param {Object} params.context - 额外上下文
   * @returns {Promise<MessageHandlerResult>}
   */
  async handle(params) {
    const {
      message,
      history = [],
      docId,
      signal,
      onChunk,
      context = {}
    } = params;

    // 1. 检索增强（如果配置了检索器）
    let retrievedContext = [];
    if (this.retriever && docId) {
      try {
        retrievedContext = await this.retriever.retrieve({
          query: typeof message.content === 'string' ? message.content : message.content[0]?.text || '',
          docId,
          limit: 5
        });
      } catch (err) {
        console.warn('[MessageHandler] 检索失败:', err);
      }
    }

    // 2. 构建系统提示词
    const systemPrompt = this.buildSystemPrompt({
      docId,
      retrievedContext,
      context
    });

    // 3. 构建消息列表
    const messages = this._buildMessages(systemPrompt, history, message);

    // 4. 调用 LLM
    const response = await this._callLLM({
      messages,
      signal,
      onChunk,
      stream: !!onChunk
    });

    return {
      content: response.content,
      model: response.model || 'unknown',
      usage: response.usage || {},
      toolCalls: response.toolCalls || [],
      retrievedContext
    };
  }

  /**
   * 构建消息列表
   */
  _buildMessages(systemPrompt, history, userMessage) {
    const messages = [];

    // 系统消息
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 历史消息（排除最后一条，因为会单独添加）
    const relevantHistory = history.slice(0, -1);
    for (const msg of relevantHistory) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }

    // 当前用户消息
    messages.push({
      role: 'user',
      content: userMessage.content
    });

    return messages;
  }

  /**
   * 调用 LLM
   */
  async _callLLM(params) {
    const { messages, signal, onChunk, stream } = params;

    // 优先使用新版 ModelRouter
    if (this.modelRouter) {
      return await this._callWithModelRouter(messages, { signal, onChunk, stream });
    }

    // 回退到旧版调用
    if (this._legacyLlmCaller) {
      return await this._callWithLegacy(messages, { signal, onChunk, stream });
    }

    // 使用 window 全局对象
    if (typeof window !== 'undefined') {
      return await this._callWithWindow(messages, { signal, onChunk, stream });
    }

    throw new Error('未配置 LLM 调用方式');
  }

  /**
   * 使用 ModelRouter 调用
   */
  async _callWithModelRouter(messages, options) {
    const { signal, onChunk, stream } = options;

    if (stream && onChunk) {
      // 流式调用
      let content = '';
      const result = await this.modelRouter.chatStream({
        messages,
        signal,
        onChunk: (chunk) => {
          content += chunk;
          onChunk(chunk);
        }
      });

      return {
        content: result.content || content,
        model: result.model,
        usage: result.usage
      };
    }

    // 非流式调用
    return await this.modelRouter.chat({ messages, signal });
  }

  /**
   * 使用旧版 LLMCaller 调用
   */
  async _callWithLegacy(messages, options) {
    const { signal, onChunk, stream } = options;

    const systemMsg = messages.find(m => m.role === 'system');
    const userMsg = messages.filter(m => m.role !== 'system').pop();
    const history = messages.filter(m => m.role !== 'system').slice(0, -1);

    if (stream && onChunk) {
      const content = await this._legacyLlmCaller.callStream(
        systemMsg?.content || '',
        history,
        userMsg?.content || '',
        onChunk,
        { signal }
      );
      return { content, model: 'legacy' };
    }

    const content = await this._legacyLlmCaller.call(
      systemMsg?.content || '',
      history,
      userMsg?.content || '',
      { signal }
    );
    return { content, model: 'legacy' };
  }

  /**
   * 使用 window 全局对象调用
   */
  async _callWithWindow(messages, options) {
    const { onChunk, stream } = options;

    // 检查 LLMCaller
    if (window.LLMCaller) {
      const caller = new window.LLMCaller();
      this._legacyLlmCaller = caller;
      return this._callWithLegacy(messages, options);
    }

    // 检查 MessageSender
    if (window.MessageSender?.callLLM) {
      const systemMsg = messages.find(m => m.role === 'system');
      const userMsg = messages.filter(m => m.role !== 'system').pop();
      const history = messages.filter(m => m.role !== 'system').slice(0, -1);

      const content = await window.MessageSender.callLLM(
        systemMsg?.content || '',
        history,
        userMsg?.content || '',
        stream ? onChunk : null
      );

      return { content, model: 'window' };
    }

    throw new Error('未找到可用的 LLM 调用方式');
  }

  /**
   * 默认系统提示词
   */
  _defaultSystemPrompt({ retrievedContext }) {
    let prompt = '你是一个专业的学术助手，帮助用户理解和分析文档内容。';

    if (retrievedContext && retrievedContext.length > 0) {
      prompt += '\n\n以下是与用户问题相关的文档片段：\n';
      for (const ctx of retrievedContext) {
        prompt += `\n---\n${ctx.text || ctx.content || ''}\n`;
      }
      prompt += '\n---\n\n请基于以上内容回答用户的问题。';
    }

    return prompt;
  }
}

/**
 * 创建消息处理器
 * @param {MessageHandlerConfig} config
 */
export function createMessageHandler(config = {}) {
  return new MessageHandler(config);
}

// 向后兼容
if (typeof window !== 'undefined') {
  window.MessageHandler = MessageHandler;
  window.createMessageHandler = createMessageHandler;
}
