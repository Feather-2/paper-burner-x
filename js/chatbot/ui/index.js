/**
 * @file js/chatbot/ui/index.js
 * @description Chatbot UI 模块统一入口（P1）
 *
 * - 提供统一入口，避免深层导入路径
 * - 向后兼容：各子模块内部仍负责挂载 window.* facade（过渡期）
 */

export * from './chatbot-ui.js';
export * from './chatbot-message-renderer.js';
export * from './chatbot-floating-options.js';
export * from './chatbot-model-config-modal.js';
export * from './chatbot-model-selector-ui.js';
export * from './chatbot-preset-questions-ui.js';
export * from './chatbot-tooltrace-ui.js';
export * from './semantic-groups-ui.js';
export * from './embedding-config-ui.js';
