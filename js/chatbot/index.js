/**
 * @file js/chatbot/index.js
 * @description Chatbot 模块统一导出
 *
 * Phase 8: Chatbot 重建
 * - 提供统一的模块入口
 * - 导出所有公共 API
 * - 提供工厂函数
 */

// ======== Core 模块 ========
export {
  ChatController,
  createChatController,
  ChatSessionStatus,
  ChatEvents,
  createMessage
} from './core/chat-controller.js';

export {
  MessageHandler,
  createMessageHandler
} from './core/message-handler.js';

export {
  StreamingAdapter,
  createStreamingAdapter,
  processStreamResponse,
  StreamType,
  SSEStreamParser,
  NDJSONStreamParser
} from './core/streaming-adapter.js';

// ======== 向后兼容导出 ========

/**
 * 创建完整的 Chatbot 实例
 * 整合 Controller、Handler、Adapter
 *
 * @param {Object} options
 * @param {string} options.docId - 文档 ID
 * @param {Object} options.historyManager - 历史管理器
 * @param {Object} options.modelRouter - 模型路由器
 * @param {Object} options.retriever - 检索器
 * @param {Function} options.buildSystemPrompt - 系统提示词构建函数
 * @returns {ChatController}
 */
export function createChatbot(options = {}) {
  const {
    docId,
    historyManager,
    modelRouter,
    retriever,
    buildSystemPrompt
  } = options;

  // 创建消息处理器
  const messageHandler = new (async () => {
    const { MessageHandler } = await import('./core/message-handler.js');
    return MessageHandler;
  })().then(MH => new MH({
    modelRouter,
    retriever,
    buildSystemPrompt
  }));

  // 同步版本（用于立即返回）
  const { MessageHandler: MH } = require ? {} : { MessageHandler: null };

  const handler = new (function() {
    // 动态导入的包装
    const module = import('./core/message-handler.js');
    return class extends EventTarget {
      constructor() {
        super();
        this._ready = module.then(m => {
          this._handler = new m.MessageHandler({
            modelRouter,
            retriever,
            buildSystemPrompt
          });
        });
      }
      async handle(params) {
        await this._ready;
        return this._handler.handle(params);
      }
    };
  })();

  // 创建控制器
  const controller = new (async () => {
    const { ChatController } = await import('./core/chat-controller.js');
    return new ChatController({
      docId,
      historyManager,
      messageHandler: handler
    });
  })();

  // 简化版：同步创建
  const { ChatController, createChatController } = (() => {
    // 内联简化版
    class SimpleChatController {
      constructor(opts) {
        this.docId = opts.docId;
        this._handler = null;
        this._history = [];
        this._status = 'idle';
      }

      async initialize(docId) {
        this.docId = docId;
        const { MessageHandler } = await import('./core/message-handler.js');
        this._handler = new MessageHandler({
          modelRouter: options.modelRouter,
          retriever: options.retriever,
          buildSystemPrompt: options.buildSystemPrompt
        });
        return this;
      }

      get status() { return this._status; }
      get history() { return [...this._history]; }
      get isLoading() { return this._status === 'loading'; }

      async send(content, opts = {}) {
        if (!this._handler) await this.initialize(this.docId);
        this._status = 'loading';
        try {
          const result = await this._handler.handle({
            message: { role: 'user', content },
            history: this._history,
            docId: this.docId,
            onChunk: opts.onChunk
          });
          this._history.push({ role: 'user', content });
          this._history.push({ role: 'assistant', content: result.content });
          return result;
        } finally {
          this._status = 'idle';
        }
      }

      clearHistory() { this._history = []; }
    }

    return {
      ChatController: SimpleChatController,
      createChatController: (opts) => new SimpleChatController(opts)
    };
  })();

  return createChatController({ docId, historyManager });
}

// ======== 版本信息 ========
export const VERSION = '2.0.0';

// ======== 向后兼容：暴露到 window ========
if (typeof window !== 'undefined') {
  // 异步加载并暴露
  Promise.all([
    import('./core/chat-controller.js'),
    import('./core/message-handler.js'),
    import('./core/streaming-adapter.js')
  ]).then(([controller, handler, streaming]) => {
    window.ChatbotModule = {
      // Controller
      ChatController: controller.ChatController,
      createChatController: controller.createChatController,
      ChatSessionStatus: controller.ChatSessionStatus,
      ChatEvents: controller.ChatEvents,
      createMessage: controller.createMessage,

      // Handler
      MessageHandler: handler.MessageHandler,
      createMessageHandler: handler.createMessageHandler,

      // Streaming
      StreamingAdapter: streaming.StreamingAdapter,
      createStreamingAdapter: streaming.createStreamingAdapter,
      processStreamResponse: streaming.processStreamResponse,
      StreamType: streaming.StreamType,

      // Factory
      createChatbot,

      // Version
      VERSION
    };

    console.log('[Chatbot] Module loaded, version:', VERSION);
  }).catch(err => {
    console.error('[Chatbot] Module load failed:', err);
  });
}
