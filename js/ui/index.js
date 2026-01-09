/**
 * @file js/ui/index.js
 * @description UI 模块统一导出（ESM 入口 + window.UI 兼容层）
 *
 * 说明：
 * - 组件（components/*）已是原生 ESM，可直接导入/导出。
 * - 其余 legacy UI 脚本仍保持“可被 <script> 直接加载”的形态，
 *   对应的 ESM 导出通过 `*.esm.js` wrapper 完成（参考 js/processing/*.esm.js）。
 * - index.js 默认只初始化 `window.UI.components` 与 `window.UI.load`（懒加载），
 *   避免在测试/非页面环境下执行大量 legacy 脚本副作用。
 */

import * as components from './components/index.js';

/**
 * 懒加载各 UI 模块（每个 key 对应 js/ui 下的一个 legacy 脚本或组件集合）。
 * 返回值是动态 import 的 module namespace object。
 */
export const load = {
  // ===== Core =====
  ui: () => import('./ui.esm.js'),
  tocLogic: () => import('./toc_logic.esm.js'),
  tocLogicEnhanced: () => import('./toc_logic_enhanced.esm.js'),
  tocScrollSync: () => import('./toc_scroll_sync.esm.js'),
  immersiveLayout: () => import('./immersive_layout_logic.esm.js'),

  // ===== Dock =====
  dockLogic: () => import('./dock/dock_logic.esm.js'),
  dockSettingsModal: () => import('./dock/dock_settings_modal.esm.js'),

  // ===== Glossary =====
  glossaryUI: () => import('./glossary-ui.esm.js'),
  glossaryProgress: () => import('./glossary-progress.esm.js'),
  glossaryEditorEnhanced: () => import('./glossary-editor-enhanced.esm.js'),

  // ===== Chunk Compare =====
  chunkCompareIntegration: () => import('./chunk_compare_integration.esm.js'),
  chunkCompareOptimizer: () => import('./chunk_compare_optimizer.esm.js'),
  chunkComparePerformanceTester: () => import('./chunk_compare_performance_tester.esm.js'),

  // ===== Others =====
  uiHelpers: () => import('./ui-helpers.esm.js'),
  uiNotifications: () => import('./ui-notifications.esm.js'),
  uiProcessing: () => import('./ui-processing.esm.js'),
  uiDomElements: () => import('./ui_dom_elements.esm.js'),
  uiEmbeddingConfig: () => import('./ui_embedding_config.esm.js'),
  uiModelManagerCore: () => import('./ui_model_manager_core.esm.js'),
  uiModelOcrConfig: () => import('./ui_model_ocr_config.esm.js'),
  uiKeyManagerModal: () => import('./ui-key-manager-modal.esm.js'),
  uiModelPanels: () => import('./ui-model-panels.esm.js'),
  uiModelSearch: () => import('./ui-model-search.esm.js'),
  keyManagerUI: () => import('./key-manager-ui.esm.js'),
  ocrSettings: () => import('./ocr-settings.esm.js'),
  promptPoolUI: () => import('./prompt-pool-ui.esm.js'),
  reactVisualization: () => import('./react_visualization.esm.js'),
  referenceManagerUI: () => import('./reference-manager-ui.esm.js'),
  referenceManagerDetail: () => import('./reference-manager-detail.esm.js'),
  sidebarIntegration: () => import('./sidebar-integration.esm.js'),
  lightbox: () => import('./lightbox.esm.js')
};

export function initializeUIGlobals(targetWindow = (globalThis.window ??= {})) {
  const uiFacade = targetWindow.UI || {};

  uiFacade.components = components;
  uiFacade.load = load;
  uiFacade.version = '1.0.0';

  targetWindow.UI = uiFacade;

  // 兼容：部分 legacy 脚本使用裸变量 showNotification（Node 测试中 window != globalThis）
  if (typeof globalThis.showNotification !== 'function' && typeof targetWindow.showNotification === 'function') {
    globalThis.showNotification = targetWindow.showNotification;
  }

  return uiFacade;
}

export const UI = (typeof window !== 'undefined') ? initializeUIGlobals(window) : { components, load };

export { components };

export default {
  UI,
  components,
  load,
  initializeUIGlobals
};

