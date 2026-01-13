/**
 * UI 模块 ESM 入口
 * 整合所有 UI 子模块并提供统一的 ESM 导出
 */

// 导入子模块（按依赖顺序）
import './config-utils.js';
import './model-config.js';
import './source-sites.js';
import './init.js';

// 从各模块重新导出
export * from './config-utils.js';
export * from './model-config.js';
export * from './source-sites.js';
export { initUI } from './init.js';

/**
 * 初始化 UI
 * @param {...any} args - 初始化参数
 * @returns {any} 初始化结果
 */
export function init(...args) {
  return globalThis.window?.initUI?.(...args);
}

// 默认导出
export default {
  init,
  initUI: init,
  // 配置工具
  escapeHtml: globalThis.window?.UIConfigUtils?.escapeHtml,
  escapeAttr: globalThis.window?.UIConfigUtils?.escapeAttr,
  createConfigInput: globalThis.window?.UIConfigUtils?.createConfigInput,
  createConfigSelect: globalThis.window?.UIConfigUtils?.createConfigSelect,
  createLabeledInput: globalThis.window?.UIConfigUtils?.createLabeledInput,
  createLabeledSelect: globalThis.window?.UIConfigUtils?.createLabeledSelect,
  generateUUID: globalThis.window?.UIConfigUtils?.generateUUID,
  // 模型配置
  renderGeminiImageConfig: globalThis.window?.UIModelConfigRenderer?.renderGeminiImageConfig,
  renderGenericImageConfig: globalThis.window?.UIModelConfigRenderer?.renderGenericImageConfig,
  renderAcademicSearchConfig: globalThis.window?.UIModelConfigRenderer?.renderAcademicSearchConfig,
  // 源站点管理
  renderSourceSitesList: globalThis.window?.UISourceSites?.renderSourceSitesList,
  selectSourceSite: globalThis.window?.UISourceSites?.selectSourceSite,
  renderSourceSiteForm: globalThis.window?.UISourceSites?.renderSourceSiteForm,
  updateCustomSourceSiteInfo: globalThis.window?.UISourceSites?.updateCustomSourceSiteInfo
};
