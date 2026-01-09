/**
 * @file js/chatbot/config/index.js
 * @description Chatbot 配置模块统一入口（ESM）
 *
 * - 提供统一入口，避免深层导入路径
 * - 各子模块内部仍负责挂载 window.* facade（过渡期）
 */

export * from './performance-config.js';
