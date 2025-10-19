/**
 * UI 模型管理器核心模块
 * 负责模型列表渲染、模型选择、模型配置界面等核心逻辑
 * 从 ui.js 中提取，减少主文件大小
 */

(function(window) {
  'use strict';

  // 支持的模型列表
  const SUPPORTED_MODELS = [
    { key: 'mistral', name: 'Mistral OCR', group: 'ocr' },
    { key: 'mineru', name: 'MinerU OCR', group: 'ocr' },
    { key: 'doc2x', name: 'Doc2X OCR', group: 'ocr' },
    { key: 'deepseek', name: 'DeepSeek 翻译', group: 'translation' },
    { key: 'gemini', name: 'Gemini 翻译', group: 'translation' },
    { key: 'tongyi', name: '通义百炼', group: 'translation' },
    { key: 'volcano', name: '火山引擎', group: 'translation' },
    { key: 'deeplx', name: 'DeepLX (DeepL 接口)', group: 'translation' },
    { key: 'custom', name: '自定义翻译模型', group: 'translation' },
    { key: 'embedding', name: '向量搜索与重排', group: 'search' },
    { key: 'academicSearch', name: '学术搜索与代理', group: 'search' }
  ];

  // 模型配置章节
  const MODEL_SECTIONS = [
    { title: '所有 OCR 方式', group: 'ocr', className: 'mt-4 mb-2' },
    { title: '翻译和分析 API', group: 'translation', className: 'mt-5 mb-2' },
    { title: '搜索和检索', group: 'search', className: 'mt-5 mb-2' }
  ];

  /**
   * 模型管理器类
   * 管理模型列表、模型配置界面的渲染和交互
   */
  class ModelManager {
    constructor() {
      this.currentManagerUI = null;
      this.selectedModelForManager = null;
      this.currentSelectedSourceSiteId = null;

      this.modelListColumn = null;
      this.modelConfigColumn = null;
      this.keyManagerColumn = null;
    }

    /**
     * 初始化模型管理器
     * @param {Object} elements - DOM 元素对象
     */
    init(elements) {
      this.modelListColumn = elements.modelListColumn;
      this.modelConfigColumn = elements.modelConfigColumn;
      this.keyManagerColumn = elements.keyManagerColumn;

      const { modelKeyManagerBtn, modelKeyManagerModal, closeModelKeyManager } = elements;

      if (!modelKeyManagerBtn || !modelKeyManagerModal || !closeModelKeyManager) {
        console.warn('[ModelManager] Required elements not found');
        return;
      }

      // 后端模式下禁用模型与Key管理器弹窗
      const isBackendMode = (typeof window !== 'undefined' && window.storageAdapter && window.storageAdapter.isFrontendMode === false);
      if (isBackendMode) {
        modelKeyManagerBtn.setAttribute('title', '后端模式：模型与Key管理已禁用');
        modelKeyManagerBtn.classList.add('opacity-50', 'cursor-not-allowed');
        modelKeyManagerBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof window.showNotification === 'function') {
            window.showNotification('后端模式下无法打开模型/Key设置，请在首页仅选择要使用的模型。', 'info');
          } else {
            alert('后端模式下无法打开模型/Key设置，请在首页仅选择要使用的模型。');
          }
        });
        // 直接返回，不绑定打开弹窗的逻辑
        return;
      }

      // 打开模型管理器（前端模式）
      modelKeyManagerBtn.addEventListener('click', () => {
        if (typeof migrateLegacyCustomConfig === 'function') {
          migrateLegacyCustomConfig();
        }
        this.renderModelList();
        if (!this.selectedModelForManager && SUPPORTED_MODELS.length > 0) {
          this.selectModel(SUPPORTED_MODELS[0].key);
        } else if (this.selectedModelForManager) {
          this.selectModel(this.selectedModelForManager);
        }
        modelKeyManagerModal.classList.remove('hidden');
      });

      // 关闭模型管理器
      closeModelKeyManager.addEventListener('click', () => {
        modelKeyManagerModal.classList.add('hidden');
        this.currentSelectedSourceSiteId = null;

        setTimeout(() => {
          if (confirm('已关闭模型与Key管理。是否刷新验证状态以更新配置检查？')) {
            if (typeof window.refreshValidationState === 'function') {
              window.refreshValidationState();
            }
          }
        }, 100);
      });
    }

    /**
     * 检查模型是否有可用的 Key
     * @param {string} modelKey - 模型键名
     * @returns {boolean} 是否有可用 Key
     */
    checkModelHasValidKey(modelKey) {
      const hasUsableKey = (keys = []) => keys.some(k => k && k.value && k.value.trim() && k.status !== 'invalid');

      // Embedding
      if (modelKey === 'embedding') {
        return !!(window.EmbeddingClient?.config?.enabled && window.EmbeddingClient?.config?.apiKey);
      }

      // Academic Search
      if (modelKey === 'academicSearch') {
        try {
          const config = JSON.parse(localStorage.getItem('academicSearchProxyConfig') || 'null');
          return !!(config && config.enabled && config.baseUrl);
        } catch (e) {
          return false;
        }
      }

      // 自定义源站
      if (modelKey === 'custom') {
        let anyCustomKey = false;
        const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
        if (typeof loadModelKeys === 'function') {
          Object.keys(sites || {}).forEach(siteId => {
            const siteKeys = loadModelKeys(`custom_source_${siteId}`) || [];
            if (hasUsableKey(siteKeys)) anyCustomKey = true;
          });
        }
        return anyCustomKey;
      }

      // OCR 引擎
      if (modelKey === 'local') {
        return true; // 本地解析不需要配置
      } else if (modelKey === 'mistral') {
        if (typeof loadModelKeys === 'function') {
          const keys = loadModelKeys('mistral') || [];
          return hasUsableKey(keys);
        } else {
          const legacy = (localStorage.getItem('ocrMistralKeys') || '').split('\n').map(s => s.trim()).filter(Boolean);
          return legacy.length > 0;
        }
      } else if (modelKey === 'mineru') {
        const workerUrl = (localStorage.getItem('ocrMinerUWorkerUrl') || '').trim();
        const mode = localStorage.getItem('ocrMinerUTokenMode') || 'frontend';
        const token = (localStorage.getItem('ocrMinerUToken') || '').trim();
        return !!workerUrl && (mode === 'worker' || !!token);
      } else if (modelKey === 'doc2x') {
        const workerUrl = (localStorage.getItem('ocrDoc2XWorkerUrl') || '').trim();
        const mode = localStorage.getItem('ocrDoc2XTokenMode') || 'frontend';
        const token = (localStorage.getItem('ocrDoc2XToken') || '').trim();
        return !!workerUrl && (mode === 'worker' || !!token);
      }

      // 其他预设翻译模型
      if (typeof loadModelKeys === 'function') {
        const keys = loadModelKeys(modelKey) || [];
        return hasUsableKey(keys);
      }

      return false;
    }

    /**
     * 渲染模型列表
     */
    renderModelList() {
      if (!this.modelListColumn) return;

      this.modelListColumn.innerHTML = '';

      // 检查所有模型的配置状态
      const modelHasValidKey = {};
      SUPPORTED_MODELS.forEach(model => {
        modelHasValidKey[model.key] = this.checkModelHasValidKey(model.key);
      });

      // 检查当前 OCR 引擎配置
      let currentOcrEngine = 'mistral';
      let currentOcrConfigured = false;
      try {
        if (window.ocrSettingsManager && typeof window.ocrSettingsManager.getCurrentConfig === 'function') {
          currentOcrEngine = window.ocrSettingsManager.getCurrentConfig().engine || (localStorage.getItem('ocrEngine') || 'mistral');
        } else {
          currentOcrEngine = localStorage.getItem('ocrEngine') || 'mistral';
        }

        if (currentOcrEngine === 'none' || currentOcrEngine === 'local') {
          currentOcrConfigured = true;
        } else {
          currentOcrConfigured = modelHasValidKey[currentOcrEngine] || false;
        }
      } catch (e) {
        console.warn('[ModelManager] Failed to check OCR config:', e);
      }

      const translationHasKey = SUPPORTED_MODELS
        .filter(m => m.group === 'translation')
        .some(m => modelHasValidKey[m.key]);

      // 导入/导出按钮区域
      this._renderImportExportSection();

      const divider = document.createElement('div');
      divider.className = 'border-t border-dashed border-slate-200 my-3';
      this.modelListColumn.appendChild(divider);

      // 警告信息
      if (!currentOcrConfigured && currentOcrEngine !== 'none' && currentOcrEngine !== 'local') {
        this._renderOcrWarning(currentOcrEngine);
      }

      if (!translationHasKey) {
        this._renderTranslationWarning();
      }

      // 渲染各个章节的模型
      MODEL_SECTIONS.forEach((section, idx) => {
        this._renderModelSection(section, modelHasValidKey, idx === MODEL_SECTIONS.length - 1);
      });
    }

    /**
     * 渲染导入/导出区域
     * @private
     */
    _renderImportExportSection() {
      const headerSection = document.createElement('div');
      headerSection.className = 'mb-3 space-y-1';

      const importExportRow = document.createElement('div');
      importExportRow.className = 'flex items-center gap-2 px-1';

      const exportIconBtn = document.createElement('button');
      exportIconBtn.type = 'button';
      exportIconBtn.innerHTML = '<iconify-icon icon="carbon:export" width="16"></iconify-icon><span class="ml-1">导出全部</span>';
      exportIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
      exportIconBtn.addEventListener('click', () => {
        if (typeof KeyManagerUI !== 'undefined' && KeyManagerUI.exportAllModelData) {
          KeyManagerUI.exportAllModelData();
        }
      });

      const importIconBtn = document.createElement('button');
      importIconBtn.type = 'button';
      importIconBtn.innerHTML = '<iconify-icon icon="carbon:import-export" width="16"></iconify-icon><span class="ml-1">导入全部</span>';
      importIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
      importIconBtn.addEventListener('click', () => {
        if (typeof KeyManagerUI !== 'undefined' && KeyManagerUI.importAllModelData) {
          KeyManagerUI.importAllModelData(() => {
            this.renderModelList();
            if (this.selectedModelForManager) {
              this.renderKeyManager(this.selectedModelForManager);
            }
          });
        }
      });

      importExportRow.appendChild(exportIconBtn);
      importExportRow.appendChild(importIconBtn);
      headerSection.appendChild(importExportRow);

      const importExportHint = document.createElement('div');
      importExportHint.className = 'text-[11px] text-slate-500 px-1';
      importExportHint.textContent = '配置文件为 Paper Burner X 专用 JSON。';
      headerSection.appendChild(importExportHint);

      this.modelListColumn.appendChild(headerSection);
    }

    /**
     * 渲染 OCR 警告
     * @private
     */
    _renderOcrWarning(currentOcrEngine) {
      const ocrWarning = document.createElement('div');
      ocrWarning.className = 'mb-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2';
      const engineNames = { mistral: 'Mistral OCR', mineru: 'MinerU', doc2x: 'Doc2X' };
      const engineName = engineNames[currentOcrEngine] || currentOcrEngine;
      ocrWarning.innerHTML = `<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前 OCR 引擎（${engineName}）未配置完成，无法进行 PDF 的 OCR 操作。</span>`;
      this.modelListColumn.appendChild(ocrWarning);
    }

    /**
     * 渲染翻译警告
     * @private
     */
    _renderTranslationWarning() {
      const translationWarning = document.createElement('div');
      translationWarning.className = 'mb-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2';
      translationWarning.innerHTML = '<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前无有效翻译 Key，无法进行翻译操作。</span>';
      this.modelListColumn.appendChild(translationWarning);
    }

    /**
     * 渲染模型章节
     * @private
     */
    _renderModelSection(section, modelHasValidKey, isLast) {
      const header = document.createElement('div');
      header.className = `text-xs font-semibold text-slate-500 uppercase tracking-wide px-1 ${section.className || ''}`;
      header.textContent = section.title;
      this.modelListColumn.appendChild(header);

      SUPPORTED_MODELS
        .filter(model => model.group === section.group)
        .forEach(model => {
          const button = document.createElement('button');
          button.dataset.modelKey = model.key;
          button.className = 'w-full text-left px-3 py-2 text-sm rounded-md transition-colors ';
          const indicator = modelHasValidKey[model.key]
            ? '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-emerald-500"></span>'
            : '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-slate-300"></span>';
          button.innerHTML = indicator + model.name;

          if (model.key === this.selectedModelForManager) {
            button.classList.add('bg-blue-100', 'text-blue-700', 'font-semibold');
          } else {
            button.classList.add('hover:bg-gray-200', 'text-gray-700');
          }

          button.addEventListener('click', () => this.selectModel(model.key));
          this.modelListColumn.appendChild(button);
        });

      if (!isLast) {
        const sectionDivider = document.createElement('div');
        sectionDivider.className = 'border-t border-dashed border-slate-200 my-3';
        this.modelListColumn.appendChild(sectionDivider);
      }
    }

    /**
     * 选择模型
     * @param {string} modelKey - 模型键名
     */
    selectModel(modelKey) {
      this.selectedModelForManager = modelKey;
      this.currentSelectedSourceSiteId = null;
      this.renderModelList();

      // 渲染模型配置（由主 ui.js 中的 renderModelConfigSection 处理）
      if (typeof window.renderModelConfigSection === 'function') {
        window.renderModelConfigSection(modelKey);
      }

      // 渲染 Key 管理器
      if (modelKey === 'embedding' || modelKey === 'academicSearch' || modelKey === 'mineru' || modelKey === 'doc2x') {
        if (this.keyManagerColumn) {
          this.keyManagerColumn.innerHTML = '';
        }
      } else if (modelKey !== 'custom') {
        this.renderKeyManager(modelKey);
      }
    }

    /**
     * 渲染 Key 管理器
     * @param {string} modelKey - 模型键名
     */
    renderKeyManager(modelKey) {
      // 由主 ui.js 中的 renderKeyManagerForModel 处理
      if (typeof window.renderKeyManagerForModel === 'function') {
        window.renderKeyManagerForModel(modelKey);
      }
    }

    /**
     * 获取支持的模型列表
     * @returns {Array} 模型列表
     */
    getSupportedModels() {
      return [...SUPPORTED_MODELS];
    }

    /**
     * 获取当前选中的模型
     * @returns {string|null} 当前选中的模型键名
     */
    getSelectedModel() {
      return this.selectedModelForManager;
    }
  }

  // 创建全局实例
  const modelManager = new ModelManager();

  // 导出到全局
  window.ModelManager = ModelManager;
  window.modelManager = modelManager;

  // 向后兼容：导出常量和函数
  window.supportedModelsForKeyManager = SUPPORTED_MODELS;

})(window);
