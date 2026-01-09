/**
 * @file js/chatbot/renderers/index.js
 * @description Chatbot 渲染器模块统一入口（ESM）
 *
 * - 提供统一入口，避免深层导入路径
 * - 各子模块内部仍负责挂载 window.* facade（过渡期）
 */

export * from './chatbot-mermaid-renderer.js';
export * from './chatbot-mindmap-renderer.js';
