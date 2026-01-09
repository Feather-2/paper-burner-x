/**
 * @file js/chatbot/utils/index.js
 * @description Chatbot Utils 模块统一入口（ESM）
 *
 * 注意：
 * - utils 子模块存在部分“同名全局函数”（例如 `renderWithKatexStreaming`）的历史包袱，
 *   此处统一以缓存版本作为默认导出，并为旧版本提供别名导出，避免 export name 冲突。
 * - 各子模块内部仍负责挂载 window.* facade（过渡期）
 */

export * from './safe-markdown-render.js';

export * from './performance-monitor.js';
export * from './mermaid-loader.js';

export * from './katex-cache.js';

export {
  renderWithKatexStreaming,
  ChatbotMathStreaming
} from './markdown-katex-render-cached.js';

export * from './katex-progressive-render.js';
export * from './katex-cache-persistence.js';

export {
  renderWithKatexStreaming as renderWithKatexStreamingLegacy,
  ChatbotMathStreaming as ChatbotMathStreamingLegacy
} from './markdown-katex-render.js';

export * from './drawio-layout-optimizer.js';
export * from './drawio-academic-enhancer.js';
export * from './drawio-lite-parser.js';

export * from './chatbot-utils.js';
export * from './chatbot-image-utils.js';
export * from './chatbot-rendering-utils.js';
