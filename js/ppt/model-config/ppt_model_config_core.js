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
  if (uiState.activeTab == null) uiState.activeTab = 'tags';
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

    // 构建 HTML 结构
    modal.innerHTML = `
      <div id="ppt-model-config-overlay" class="pmc-overlay-bg"></div>
      <div class="pmc-modal-container">
        <!-- Header -->
        <div class="pmc-header">
          <div class="pmc-header-left">
            <div class="pmc-header-icon">
              <iconify-icon icon="carbon:settings-adjust" width="24"></iconify-icon>
            </div>
            <div>
              <div class="pmc-title">PPT 模型配置</div>
              <div class="pmc-subtitle">独立于翻译/聊天模型，专用于 PPT 文案与配图</div>
            </div>
          </div>
          <button id="ppt-model-config-close" class="pmc-close-btn" title="关闭">
            <iconify-icon icon="carbon:close" width="24"></iconify-icon>
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="pmc-scroll-content">
          <!-- 表格优先：统一模型视图 -->
          <div id="pmc-model-table-container"></div>

          <!-- 音频配置（折叠） -->
          <div class="pmc-audio-collapse">
            <button class="pmc-audio-collapse-header" type="button">
              <span style="display:flex; align-items:center; gap:8px;">
                <iconify-icon icon="carbon:microphone" width="16"></iconify-icon>
                音频配置
              </span>
              <iconify-icon class="pmc-audio-collapse-chevron" icon="carbon:chevron-down" width="18"></iconify-icon>
            </button>
            <div class="pmc-audio-collapse-body"></div>
          </div>

            <!-- Advanced Settings (Image Processor) -->
            <div id="pmc-image-settings-panel" class="pmc-advanced-settings">
                <div class="pmc-advanced-header">
                    <iconify-icon icon="carbon:settings-check" width="16"></iconify-icon>
                    图片智能处理参数
                </div>
                <div class="pmc-advanced-body">
                    <!-- Left Col -->
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">OCR 引擎优先级</label>
                            <div class="pmc-radio-group">
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="mineru">
                                    <span>MinerU 优先 <span class="pmc-hint-text">(精确 bbox)</span></span>
                                </label>
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="vlm">
                                    <span>视觉模型优先 <span class="pmc-hint-text">(复杂排版)</span></span>
                                </label>
                                <label class="pmc-radio-item">
                                    <input type="radio" name="pmc-ocr-priority" value="auto">
                                    <span>自动选择</span>
                                </label>
                            </div>
                            <div id="pmc-ocr-status" class="pmc-status-text"></div>
                        </div>
                    </div>
                    <!-- Right Col -->
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">矢量化预设</label>
                            <select id="pmc-vectorize-preset" class="pmc-select" style="width:100%;">
                                <option value="auto" selected>自动推荐</option>
                                <option value="logo">Logo / 图标</option>
                                <option value="illustration">插画</option>
                                <option value="lineart">线稿</option>
                                <option value="photo">照片</option>
                                <option value="simple">简化</option>
                            </select>
                        </div>
                        <div style="margin-top: 20px; display:flex; flex-direction:column; gap:16px;">
                            <div class="pmc-form-group">
                                <label class="pmc-label">
                                    边缘阈值
                                    <span id="pmc-edge-val" class="pmc-value-badge">30</span>
                                </label>
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <span style="font-size:11px; color:#94a3b8;">10</span>
                                    <input type="range" id="pmc-edge-threshold" min="10" max="100" value="30" class="pmc-range">
                                    <span style="font-size:11px; color:#94a3b8;">100</span>
                                </div>
                            </div>
                            <div class="pmc-form-group">
                                <label class="pmc-label">
                                    颜色容差
                                    <span id="pmc-color-val" class="pmc-value-badge">25</span>
                                </label>
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <span style="font-size:11px; color:#94a3b8;">5</span>
                                    <input type="range" id="pmc-color-tolerance" min="5" max="50" value="25" class="pmc-range">
                                    <span style="font-size:11px; color:#94a3b8;">50</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Concurrency Settings -->
            <div id="pmc-concurrency-settings-panel" class="pmc-advanced-settings" style="margin-top: 12px;">
                <div class="pmc-advanced-header">
                    <iconify-icon icon="carbon:meter" width="16"></iconify-icon>
                    Design Agent 并发设置
                </div>
                <div class="pmc-advanced-body">
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">批量大小 (batchSize)</label>
                            <input type="number" id="pmc-batch-size" class="pmc-input" min="1" style="width: 100%;">
                            <div class="pmc-hint-text">每批处理的幻灯片数量</div>
                        </div>
                        <div class="pmc-form-group" style="margin-top: 12px;">
                            <label class="pmc-label">批量并发 (batchConcurrency)</label>
                            <input type="number" id="pmc-batch-concurrency" class="pmc-input" min="1" style="width: 100%;">
                            <div class="pmc-hint-text">同时处理的批次数</div>
                        </div>
                    </div>
                    <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                        <div class="pmc-form-group">
                            <label class="pmc-label">图片并发 (imageConcurrency)</label>
                            <input type="number" id="pmc-image-concurrency" class="pmc-input" min="1" style="width: 100%;">
                            <div class="pmc-hint-text">同时生成的图片数</div>
                        </div>
                        <div class="pmc-form-group" style="margin-top: 12px;">
                            <button id="pmc-save-concurrency" class="pmc-btn-save" style="width: 100%;">
                                <iconify-icon icon="carbon:save" width="16"></iconify-icon>
                                保存并发设置
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="pmc-footer">
          <button id="ppt-image-processor-settings" class="pmc-btn-secondary">
            <iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon>
            展开高级设置
          </button>
          <div id="ppt-image-gen-stats" class="pmc-stats"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 图片处理设置按钮 - Toggle
    document.getElementById('ppt-image-processor-settings')?.addEventListener('click', () => {
      ns.advanced?.toggleAdvancedSettings?.();
    });

    // 绑定 Image Settings 事件
    ns.advanced?.bindImageSettingsEvents?.();

    // 并发设置初始化
    initConcurrencySettings();

    // Table + Audio
    ns.table?.initModelTableView?.();
  }

  function openModal() {
    renderModal();

    // 每次打开都刷新表格/音频配置（避免源站列表/配置变更后不更新）
    ns.table?.initModelTableView?.({ forceRender: true });

    // 保持图片处理设置可用
    ns.advanced?.loadImageSettings?.();
    ns.advanced?.updateStatsDisplay?.();
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'flex';

    // 预加载：并发拉取所有源站模型列表（会话缓存）
    ns.table?.preloadAllSourcesModels?.();
  }

  function closeModal() {
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'none';
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
