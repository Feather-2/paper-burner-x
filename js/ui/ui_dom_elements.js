/**
 * UI DOM 元素引用管理模块
 * 集中管理所有 DOM 元素的引用，便于维护和访问
 */

(function(window) {
  'use strict';

  /**
   * DOM 元素引用对象
   * 包含页面上所有需要被 JavaScript 操作的 DOM 元素
   */
  const DOMElements = {
    // ===== API Key 配置相关 =====
    mistralApiKeysTextarea: document.getElementById('mistralApiKeys'),
    rememberMistralKeyCheckbox: document.getElementById('rememberMistralKey'),
    translationApiKeysTextarea: document.getElementById('translationApiKeys'),
    rememberTranslationKeyCheckbox: document.getElementById('rememberTranslationKey'),
    translationModelSelect: document.getElementById('translationModel'),

    // ===== 自定义模型设置 =====
    customModelSettingsContainer: document.getElementById('customModelSettingsContainer'),
    customModelSettings: document.getElementById('customModelSettings'),
    customModelSettingsToggle: document.getElementById('customModelSettingsToggle'),
    customModelSettingsToggleIcon: document.getElementById('customModelSettingsToggleIcon'),

    // ===== 高级设置 =====
    advancedSettingsToggle: document.getElementById('advancedSettingsToggle'),
    advancedSettings: document.getElementById('advancedSettings'),
    advancedSettingsIcon: document.getElementById('advancedSettingsIcon'),

    // ===== 处理参数配置 =====
    maxTokensPerChunk: document.getElementById('maxTokensPerChunk'),
    maxTokensPerChunkValue: document.getElementById('maxTokensPerChunkValue'),
    skipProcessedFilesCheckbox: document.getElementById('skipProcessedFiles'),
    concurrencyLevelInput: document.getElementById('concurrencyLevel'),

    // ===== 文件管理 =====
    dropZone: document.getElementById('dropZone'),
    pdfFileInput: document.getElementById('pdfFileInput'),
    browseFilesBtn: document.getElementById('browseFilesBtn'),
    fileListContainer: document.getElementById('fileListContainer'),
    fileList: document.getElementById('fileList'),
    clearFilesBtn: document.getElementById('clearFilesBtn'),

    // ===== 主要操作按钮 =====
    targetLanguage: document.getElementById('targetLanguage'),
    processBtn: document.getElementById('processBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),

    // ===== 批量模式 =====
    batchModeToggleWrapper: document.getElementById('batchModeToggleWrapper'),
    batchModeToggle: document.getElementById('batchModeToggle'),
    batchModeConfigPanel: document.getElementById('batchModeConfig'),

    // ===== 结果显示 =====
    resultsSection: document.getElementById('resultsSection'),
    resultsSummary: document.getElementById('resultsSummary'),

    // ===== 进度显示 =====
    progressSection: document.getElementById('progressSection'),
    batchProgressText: document.getElementById('batchProgressText'),
    concurrentProgressText: document.getElementById('concurrentProgressText'),
    progressStep: document.getElementById('progressStep'),
    progressPercentage: document.getElementById('progressPercentage'),
    progressBar: document.getElementById('progressBar'),
    progressLog: document.getElementById('progressLog'),

    // ===== 通知系统 =====
    notificationContainer: document.getElementById('notification-container'),

    // ===== 自定义源站点 =====
    customSourceSiteContainer: document.getElementById('customSourceSiteContainer'),
    customSourceSiteSelect: document.getElementById('customSourceSiteSelect'),
    customSourceSiteToggleIcon: document.getElementById('customSourceSiteToggleIcon'),
    detectModelsBtn: document.getElementById('detectModelsBtn'),

    // ===== 模型 Key 管理器 =====
    modelKeyManagerBtn: document.getElementById('modelKeyManagerBtn'),
    modelKeyManagerModal: document.getElementById('modelKeyManagerModal'),
    closeModelKeyManager: document.getElementById('closeModelKeyManager'),
    modelListColumn: document.getElementById('modelListColumn'),
    modelConfigColumn: document.getElementById('modelConfigColumn'),
    keyManagerColumn: document.getElementById('keyManagerColumn'),
  };

  /**
   * 获取 DOM 元素
   * @param {string} key - 元素键名
   * @returns {HTMLElement|null} DOM 元素
   */
  function getElement(key) {
    return DOMElements[key] || null;
  }

  /**
   * 批量获取 DOM 元素
   * @param {string[]} keys - 元素键名数组
   * @returns {Object} 包含请求元素的对象
   */
  function getElements(keys) {
    const result = {};
    keys.forEach(key => {
      result[key] = DOMElements[key] || null;
    });
    return result;
  }

  /**
   * 检查元素是否存在
   * @param {string} key - 元素键名
   * @returns {boolean} 元素是否存在
   */
  function hasElement(key) {
    return DOMElements[key] !== null && DOMElements[key] !== undefined;
  }

  /**
   * 获取所有 DOM 元素引用
   * @returns {Object} 所有 DOM 元素的引用对象
   */
  function getAllElements() {
    return { ...DOMElements };
  }

  // 导出到全局
  window.UIElements = {
    ...DOMElements,
    getElement,
    getElements,
    hasElement,
    getAllElements
  };

  // 为了向后兼容，也将各个元素单独导出到 window
  // 这样原有代码中直接使用 mistralApiKeysTextarea 等变量的地方不需要修改
  Object.keys(DOMElements).forEach(key => {
    if (window[key] === undefined) {
      window[key] = DOMElements[key];
    }
  });

})(window);
