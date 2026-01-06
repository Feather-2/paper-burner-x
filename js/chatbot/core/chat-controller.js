/**
 * @file js/chatbot/core/chat-controller.js
 * @description 会话控制器 - 复用 js/agents/sdk 架构
 *
 * Phase 8: Chatbot 重建
 * - 管理聊天会话生命周期
 * - 集成 agents/sdk 事件总线
 * - 提供状态订阅机制
 */

import { EventBus } from '../../agents/runtime/events/event-bus.js';

/**
 * 会话状态枚举
 */
export const ChatSessionStatus = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  STREAMING: 'streaming',
  ERROR: 'error'
});

/**
 * 聊天事件类型
 */
export const ChatEvents = Object.freeze({
  MESSAGE_SENT: 'chat:message:sent',
  MESSAGE_RECEIVED: 'chat:message:received',
  STREAM_START: 'chat:stream:start',
  STREAM_CHUNK: 'chat:stream:chunk',
  STREAM_END: 'chat:stream:end',
  ERROR: 'chat:error',
  HISTORY_CLEARED: 'chat:history:cleared',
  STATUS_CHANGED: 'chat:status:changed'
});

/**
 * 创建消息对象
 * @param {string} role - 'user' | 'assistant' | 'system'
 * @param {string|Array} content - 消息内容
 * @param {Object} metadata - 元数据
 */
export function createMessage(role, content, metadata = {}) {
  return {
    id: crypto.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: Date.now(),
    ...metadata
  };
}

/**
 * ChatController 类
 * 管理单个聊天会话
 */
export class ChatController {
  /**
   * @param {Object} options
   * @param {string} options.docId - 关联文档 ID
   * @param {Object} options.historyManager - 历史管理器（可选）
   * @param {Object} options.messageHandler - 消息处理器（可选）
   * @param {EventBus} options.eventBus - 事件总线（可选）
   */
  constructor(options = {}) {
    this.docId = options.docId || null;
    this.historyManager = options.historyManager || null;
    this.messageHandler = options.messageHandler || null;
    this.eventBus = options.eventBus || new EventBus();

    this._status = ChatSessionStatus.IDLE;
    this._history = [];
    this._subscribers = new Set();
    this._abortController = null;
  }

  /**
   * 获取当前状态
   */
  get status() {
    return this._status;
  }

  /**
   * 获取聊天历史
   */
  get history() {
    return [...this._history];
  }

  /**
   * 获取是否正在加载
   */
  get isLoading() {
    return this._status === ChatSessionStatus.LOADING ||
           this._status === ChatSessionStatus.STREAMING;
  }

  /**
   * 初始化控制器
   * @param {string} docId - 文档 ID
   */
  async initialize(docId) {
    this.docId = docId;

    // 加载历史记录
    if (this.historyManager) {
      try {
        this._history = await this.historyManager.load(docId) || [];
      } catch (err) {
        console.warn('[ChatController] 加载历史失败:', err);
        this._history = [];
      }
    }

    this._setStatus(ChatSessionStatus.IDLE);
    return this;
  }

  /**
   * 发送消息
   * @param {string|Array} content - 消息内容
   * @param {Object} options - 发送选项
   */
  async send(content, options = {}) {
    if (this.isLoading) {
      throw new Error('会话正在处理中，请等待完成');
    }

    const userMessage = createMessage('user', content, {
      displayContent: options.displayContent || content
    });

    // 添加到历史
    this._history.push(userMessage);
    this._emit(ChatEvents.MESSAGE_SENT, { message: userMessage });

    // 设置状态
    this._setStatus(ChatSessionStatus.LOADING);

    // 创建中止控制器
    this._abortController = new AbortController();

    try {
      // 调用消息处理器
      if (this.messageHandler) {
        const response = await this.messageHandler.handle({
          message: userMessage,
          history: this._history,
          docId: this.docId,
          signal: this._abortController.signal,
          onChunk: options.onChunk ? (chunk) => {
            this._setStatus(ChatSessionStatus.STREAMING);
            this._emit(ChatEvents.STREAM_CHUNK, { chunk });
            options.onChunk(chunk);
          } : undefined,
          ...options
        });

        const assistantMessage = createMessage('assistant', response.content, {
          model: response.model,
          usage: response.usage,
          toolCalls: response.toolCalls
        });

        this._history.push(assistantMessage);
        this._emit(ChatEvents.MESSAGE_RECEIVED, { message: assistantMessage });

        // 保存历史
        await this._saveHistory();

        return assistantMessage;
      }

      // 无处理器时的兜底
      throw new Error('未配置消息处理器');

    } catch (err) {
      if (err.name === 'AbortError') {
        this._setStatus(ChatSessionStatus.IDLE);
        return null;
      }

      this._setStatus(ChatSessionStatus.ERROR);
      this._emit(ChatEvents.ERROR, { error: err });
      throw err;

    } finally {
      if (this._status !== ChatSessionStatus.ERROR) {
        this._setStatus(ChatSessionStatus.IDLE);
      }
      this._abortController = null;
    }
  }

  /**
   * 取消当前请求
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
      this._setStatus(ChatSessionStatus.IDLE);
    }
  }

  /**
   * 清除历史
   */
  async clearHistory() {
    this._history = [];

    if (this.historyManager && this.docId) {
      await this.historyManager.clear(this.docId);
    }

    this._emit(ChatEvents.HISTORY_CLEARED, { docId: this.docId });
  }

  /**
   * 删除指定消息
   * @param {number} index - 消息索引
   */
  async deleteMessage(index) {
    if (index >= 0 && index < this._history.length) {
      const deleted = this._history.splice(index, 1)[0];
      await this._saveHistory();
      return deleted;
    }
    return null;
  }

  /**
   * 订阅状态变更
   * @param {Function} callback
   * @returns {Function} 取消订阅函数
   */
  subscribe(callback) {
    this._subscribers.add(callback);
    return () => this._subscribers.delete(callback);
  }

  /**
   * 监听事件
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    return this.eventBus.on(event, handler);
  }

  /**
   * 销毁控制器
   */
  destroy() {
    this.cancel();
    this._subscribers.clear();
    this._history = [];
    this.eventBus = null;
  }

  // ======== 私有方法 ========

  _setStatus(status) {
    const oldStatus = this._status;
    this._status = status;

    if (oldStatus !== status) {
      this._notifySubscribers();
      this._emit(ChatEvents.STATUS_CHANGED, { oldStatus, newStatus: status });
    }
  }

  _notifySubscribers() {
    for (const callback of this._subscribers) {
      try {
        callback({
          status: this._status,
          history: this._history,
          isLoading: this.isLoading
        });
      } catch (err) {
        console.error('[ChatController] 订阅回调错误:', err);
      }
    }
  }

  _emit(event, data) {
    if (this.eventBus) {
      this.eventBus.emit(event, { ...data, docId: this.docId, timestamp: Date.now() });
    }
  }

  async _saveHistory() {
    if (this.historyManager && this.docId) {
      try {
        await this.historyManager.save(this.docId, this._history);
      } catch (err) {
        console.warn('[ChatController] 保存历史失败:', err);
      }
    }
  }
}

/**
 * 创建 ChatController 实例
 * @param {Object} options
 */
export function createChatController(options = {}) {
  return new ChatController(options);
}

// 向后兼容：暴露到 window
if (typeof window !== 'undefined') {
  window.ChatController = ChatController;
  window.createChatController = createChatController;
  window.ChatSessionStatus = ChatSessionStatus;
  window.ChatEvents = ChatEvents;
}
