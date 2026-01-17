/**
 * @file js/shared/index.js
 * @description 共享模块统一导出
 *
 * 提供跨模块共享的基础设施：
 * - core: 事件总线、状态存储
 * - adapters: UI 适配器基类和通用适配器
 * - utils: 工具函数
 */

// Utils
export { escapeHtml } from './utils/escape-html.js';
export { generateUUID, uuid } from './utils/uuid.js';
export { createLogger } from './utils/logger.js';

// Core
export {
  UIEventBus,
  getUIEventBus,
  resetUIEventBus,
  StateStore,
  getStateStore,
  resetStateStore
} from './core/index.js';

// Adapters
export {
  BaseAdapter,
  DeepSearchAdapter
} from './adapters/index.js';
