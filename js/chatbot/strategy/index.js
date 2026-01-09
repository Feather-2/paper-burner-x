/**
 * @file js/chatbot/strategy/index.js
 * @description Chatbot Strategy 模块统一入口（ESM）
 *
 * - 提供统一入口，避免深层导入路径
 * - 各子模块内部仍负责挂载 window.* facade（过渡期）
 */

export * from './segmentation-strategy.js';
