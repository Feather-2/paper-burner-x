/**
 * @file js/chatbot/index.js
 * @description Chatbot 模块统一导出（Core + UI）
 *
 * Phase 8: Chatbot 重建
 * - 提供统一模块入口
 * - 显式 ESM 导出
 * - 兼容：各子模块自行挂载 window.*
 */

// ======== Core ========
export * from './core/chat-controller.js';
export * from './core/message-handler.js';
export * from './core/streaming-adapter.js';

// ======== Config ========
export * from './config/index.js';

// ======== UI (P1) ========
export * from './ui/index.js';

// ======== Utils ========
export * from './utils/index.js';

// ======== Renderers ========
export * from './renderers/index.js';

// ======== Strategy ========
export * from './strategy/index.js';

// ======== Factory ========
import { ChatController } from './core/chat-controller.js';
import { MessageHandler } from './core/message-handler.js';

/**
 * 创建完整的 Chatbot 实例（Controller + Handler）
 * @param {Object} options
 */
export function createChatbot(options = {}) {
  const {
    docId,
    historyManager,
    modelRouter,
    retriever,
    buildSystemPrompt,
    maxContextTokens,
    eventBus
  } = options;

  const messageHandler = new MessageHandler({
    modelRouter,
    retriever,
    buildSystemPrompt,
    maxContextTokens
  });

  return new ChatController({
    docId,
    historyManager,
    messageHandler,
    eventBus
  });
}

export const VERSION = '2.0.0';
