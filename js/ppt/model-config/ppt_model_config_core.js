/**
 * PPT 模型配置 - 核心/聚合入口
 * IIFE module: window.PPTModelConfig.core + window.PPTModelConfig.PPTModelConfigModal
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.core = ns.core || {};

  const STORAGE_KEYS = {
    lang: 'pptModelConfigLanguage',
    img: 'pptModelConfigImage',
    vision: 'pptModelConfigVision',
    modelTags: 'pptModelTags', // Tab 1: 模型能力标签
    rolePriority: 'pptRolePriority', // Tab 2: 角色优先级
    audio: 'pptAudioConfig' // Tab 3: 音频配置
  };

  const { ROLES = [] } = ns.constants || {};

  const uiState = ns.core.uiState || (ns.core.uiState = {});
  if (uiState.activeTab == null) uiState.activeTab = 'models';
  if (uiState.tagsActiveModelKey == null) uiState.tagsActiveModelKey = null;
  if (!Array.isArray(uiState.tagsExpandedSources)) uiState.tagsExpandedSources = [];
  if (uiState.priorityActiveRole == null) uiState.priorityActiveRole = ROLES[0]?.id || 'analyst';
  if (uiState.tableSearch == null) uiState.tableSearch = '';
  if (uiState.tableSourceKey == null) uiState.tableSourceKey = '';
  if (uiState.tableConfiguredOnly == null) uiState.tableConfiguredOnly = false;

  function resolveStorageKey(key) {
    if (!key) return STORAGE_KEYS.lang;
    if (STORAGE_KEYS[key]) return STORAGE_KEYS[key];
    // 允许直接传 storage key 字符串
    const values = Object.values(STORAGE_KEYS);
    if (values.includes(key)) return key;
    return STORAGE_KEYS.lang;
  }

  function loadConfig(key) {
    try {
      const storageKey = resolveStorageKey(key);
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveConfig(key, value) {
    const storageKey = resolveStorageKey(key);
    localStorage.setItem(storageKey, JSON.stringify(value));
    
    // 分发配置变更事件，以便其他模块（如健康检查卡片）能够及时刷新
    document.dispatchEvent(new CustomEvent('ppt-model-config-updated', { detail: { key, value } }));
  }

  function getModalRoot() {
    return document.getElementById('ppt-model-config-modal');
  }

  function initConcurrencySettings() {
    let config = { batchSize: 4, batchConcurrency: 2, imageConcurrency: 4 };
    try {
      const raw = localStorage.getItem('ppt_designConcurrency');
      if (raw) config = { ...config, ...JSON.parse(raw) };
    } catch (_) {}

    const batchSizeEl = document.getElementById('pmc-batch-size');
    const batchConcurrencyEl = document.getElementById('pmc-batch-concurrency');
    const imageConcurrencyEl = document.getElementById('pmc-image-concurrency');
    const saveBtn = document.getElementById('pmc-save-concurrency');

    if (batchSizeEl) batchSizeEl.value = config.batchSize;
    if (batchConcurrencyEl) batchConcurrencyEl.value = config.batchConcurrency;
    if (imageConcurrencyEl) imageConcurrencyEl.value = config.imageConcurrency;

    saveBtn?.addEventListener('click', () => {
      const batchSize = Math.max(1, parseInt(batchSizeEl?.value) || 4);
      const batchConcurrency = Math.max(1, parseInt(batchConcurrencyEl?.value) || 2);
      const imageConcurrency = Math.max(1, parseInt(imageConcurrencyEl?.value) || 4);
      localStorage.setItem('ppt_designConcurrency', JSON.stringify({ batchSize, batchConcurrency, imageConcurrency }));
      showSaveSuccess('并发设置已保存');
    });
  }

  function renderModal() {
    if (document.getElementById('ppt-model-config-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'ppt-model-config-modal';
    modal.className = 'pmc-modal-overlay';

    // 构建 HTML 结构 (使用分离的视图模板)
    modal.innerHTML = ns.view?.getModalTemplate ? ns.view.getModalTemplate() : '';
    document.body.appendChild(modal);

    // 初始化 Tab 切换逻辑
    ns.tabs?.initTabSwitching?.();

    // 绑定 Image Settings 事件（只需绑定一次，面板在 Tab 3）
    ns.advanced?.bindImageSettingsEvents?.();

    // 并发设置保存按钮事件绑定
    document.getElementById('pmc-save-concurrency')?.addEventListener('click', () => {
      const batchSize = Math.max(1, parseInt(document.getElementById('pmc-batch-size')?.value) || 4);
      const batchConcurrency = Math.max(1, parseInt(document.getElementById('pmc-batch-concurrency')?.value) || 2);
      const imageConcurrency = Math.max(1, parseInt(document.getElementById('pmc-image-concurrency')?.value) || 4);
      localStorage.setItem('ppt_designConcurrency', JSON.stringify({ batchSize, batchConcurrency, imageConcurrency }));
      showSaveSuccess('并发设置已保存');
    });
  }

  function openModal() {
    renderModal();

    // 激活当前 Tab（默认为 models）
    if (ns.tabs?.activateTab) {
        ns.tabs.activateTab(uiState.activeTab || 'models');
    }

    // 保持配置可用
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.display = 'flex';
    }

    // 性能优化：不再自动全量探测所有源，改为按需加载（在用户点击左侧源站时触发）
    // ns.table?.preloadAllSourcesModels?.();
  }

  function closeModal() {
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
  }

  function showSaveSuccess(msg) {
    let toast = document.getElementById('pmc-save-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pmc-save-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #10b981;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: opacity 0.3s, transform 0.3s;
      `;
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<iconify-icon icon="carbon:checkmark-filled" width="18"></iconify-icon> ${msg}`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2000);
  }

  function bindModalEvents() {
    if (document.documentElement?.dataset?.pmcModalEventsBound === '1') return;
    if (document.documentElement && document.documentElement.dataset) document.documentElement.dataset.pmcModalEventsBound = '1';

    const getModelIdValue = (...args) => (ns.sources?.getModelIdValue ? ns.sources.getModelIdValue(...args) : '');
    const refreshSourceList = (...args) => ns.sources?.refreshSourceList?.(...args);
    const fetchAndPopulateModelIds = (...args) => ns.sources?.fetchAndPopulateModelIds?.(...args);
    const populateModelIds = (...args) => ns.sources?.populateModelIds?.(...args);
    const filterModelDropdown = (...args) => ns.sources?.filterModelDropdown?.(...args);
    const modelIdCache = ns.sources?.modelIdCache || { lang: [], img: [], vision: [] };

    document.addEventListener('click', (e) => {
      if (e.target.closest('#ppt-model-config-close')) closeModal();
      if (e.target && e.target.id === 'ppt-model-config-overlay') closeModal();
      if (e.target.closest('#ppt-model-lang-save')) {
        const sel = document.getElementById('ppt-model-lang-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('lang', { modelKey, modelId: getModelIdValue('lang', modelKey) });
          showSaveSuccess('文字模型配置已保存');
        } else {
          alert('请选择文字模型');
        }
      }
      if (e.target.closest('#ppt-model-img-save')) {
        const sel = document.getElementById('ppt-model-img-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('img', { modelKey, modelId: getModelIdValue('img', modelKey) });
          showSaveSuccess('配图模型配置已保存');
        } else {
          alert('请选择配图模型');
        }
      }
      if (e.target.closest('#ppt-model-vision-save')) {
        const sel = document.getElementById('ppt-model-vision-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('vision', { modelKey, modelId: getModelIdValue('vision', modelKey) });
          showSaveSuccess('视觉模型配置已保存');
        } else {
          alert('请选择视觉模型');
        }
      }
      if (e.target && e.target.id === 'ppt-model-lang-refresh') refreshSourceList('lang');
      if (e.target && e.target.id === 'ppt-model-img-refresh') refreshSourceList('img');
      if (e.target && e.target.id === 'ppt-model-vision-refresh') refreshSourceList('vision');
      if (e.target && e.target.id === 'ppt-model-lang-refresh-models') {
        const sel = document.getElementById('ppt-model-lang-select');
        fetchAndPopulateModelIds('lang', sel ? sel.value : '');
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh-models') {
        const sel = document.getElementById('ppt-model-img-select');
        fetchAndPopulateModelIds('img', sel ? sel.value : '');
      }
      if (e.target && e.target.id === 'ppt-model-vision-refresh-models') {
        const sel = document.getElementById('ppt-model-vision-select');
        fetchAndPopulateModelIds('vision', sel ? sel.value : '');
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-select') populateModelIds('lang', e.target.value);
      if (e.target && e.target.id === 'ppt-model-img-select') populateModelIds('img', e.target.value);
      if (e.target && e.target.id === 'ppt-model-vision-select') populateModelIds('vision', e.target.value);
    });

    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search') filterModelDropdown('lang');
      if (e.target && e.target.id === 'ppt-model-img-id-search') filterModelDropdown('img');
      if (e.target && e.target.id === 'ppt-model-vision-id-search') filterModelDropdown('vision');
    });

    document.addEventListener('focus', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search' && modelIdCache.lang.length > 0) filterModelDropdown('lang');
      if (e.target && e.target.id === 'ppt-model-img-id-search' && modelIdCache.img.length > 0) filterModelDropdown('img');
      if (e.target && e.target.id === 'ppt-model-vision-id-search' && modelIdCache.vision.length > 0) filterModelDropdown('vision');
    }, true);
  }

  function injectStyles() {
    let style = document.getElementById('ppt-model-config-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ppt-model-config-style';
      document.head.appendChild(style);
    }

    const css = ns.styles?.getInjectedCss?.();
    style.textContent = typeof css === 'string' ? css : '';
  }

  injectStyles();
  bindModalEvents();

  const PPTModelConfigModal = {
    openModal,
    closeModal,
    loadConfig,
    recordImageGeneration: (...args) => ns.advanced?.recordImageGeneration?.(...args),
    loadImageGenStats: (...args) => ns.advanced?.loadImageGenStats?.(...args)
  };

  Object.assign(ns.core, {
    STORAGE_KEYS,
    uiState,
    resolveStorageKey,
    loadConfig,
    saveConfig,
    renderModal,
    openModal,
    closeModal,
    getModalRoot,
    bindModalEvents,
    injectStyles,
    showSaveSuccess
  });

  ns.PPTModelConfigModal = PPTModelConfigModal;

  // 保持原有全局接口
  global.PPTModelConfigModal = {
    openModal,
    closeModal,
    loadConfig,
    recordImageGeneration: PPTModelConfigModal.recordImageGeneration,
    loadImageGenStats: PPTModelConfigModal.loadImageGenStats
  };
})(typeof window !== 'undefined' ? window : this);
