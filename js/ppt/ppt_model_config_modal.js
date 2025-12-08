/**
 * PPT 模型配置弹窗（独立于翻译/Chatbot）
 * - 文字模型：使用 translation/search 分组的模型列表（预设 + 自定义源站）
 * - 配图模型：使用 image 分组（通用 image / gemini-image 或自定义源站）
 * - 保存到 localStorage: pptModelConfigLanguage / pptModelConfigImage
 */
(function(global) {
  'use strict';

  const STORAGE_KEYS = {
    lang: 'pptModelConfigLanguage',
    img: 'pptModelConfigImage',
    vision: 'pptModelConfigVision'
  };

  const MANUAL_MODEL_ID_PROVIDERS = {
    lang: ['volcano'], // 火山引擎模型 ID 需要手动填写
    img: [],
    vision: ['volcano']
  };

  // 缓存探测到的模型 ID 列表
  const modelIdCache = { lang: [], img: [], vision: [] };

  function getSupportedModels() {
    const list = Array.isArray(global.supportedModelsForKeyManager) ? global.supportedModelsForKeyManager : [];
    return list;
  }

  function loadConfig(type) {
    try {
      const key = STORAGE_KEYS[type] || STORAGE_KEYS.lang;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveConfig(type, cfg) {
    const key = STORAGE_KEYS[type] || STORAGE_KEYS.lang;
    localStorage.setItem(key, JSON.stringify(cfg));
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
            <!-- Body -->
            <div class="pmc-body">
              <!-- 文字模型列 -->
              <div class="pmc-col">
                <div class="pmc-section-header">
                  <div class="pmc-section-icon text-indigo">
                    <iconify-icon icon="carbon:document-sentiment" width="20"></iconify-icon>
                  </div>
                  <span class="pmc-section-title">文字模型</span>
                </div>
                <p class="pmc-section-desc">用于生成 PPT 大纲、正文内容与演讲备注</p>
                
                <div class="pmc-form-group">
                  <label class="pmc-label">选择源站 / 预设</label>
                  <div class="pmc-input-row">
                    <select id="ppt-model-lang-select" class="pmc-select"></select>
                    <button id="ppt-model-lang-refresh" class="pmc-btn-icon" title="刷新源站列表">
                      <iconify-icon icon="carbon:renew" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-form-group">
                  <label class="pmc-label">
                    模型 ID
                    <span class="pmc-label-sub">(支持搜索)</span>
                  </label>
                  <div class="pmc-input-row">
                    <div class="pmc-dropdown-wrapper">
                        <input id="ppt-model-lang-id-search" class="pmc-input" placeholder="输入或探测模型 ID..." autocomplete="off">
                        <div id="ppt-model-lang-dropdown" class="pmc-dropdown-list"></div>
                    </div>
                    <button id="ppt-model-lang-refresh-models" class="pmc-btn-icon" title="探测可用模型 ID">
                      <iconify-icon icon="carbon:connection-signal" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-status-bar">
                  <div class="pmc-model-hint" id="ppt-model-lang-hint">
                    <iconify-icon icon="carbon:information" width="14"></iconify-icon>
                    <span>未配置</span>
                  </div>
                </div>

                <button id="ppt-model-lang-save" class="pmc-btn-save">
                  <iconify-icon icon="carbon:save" width="16"></iconify-icon>
                  保存文字配置
                </button>
              </div>

              <!-- 配图模型列 -->
              <div class="pmc-col">
                <div class="pmc-section-header">
                  <div class="pmc-section-icon text-purple">
                    <iconify-icon icon="carbon:image-search" width="20"></iconify-icon>
                  </div>
                  <span class="pmc-section-title">配图模型</span>
                </div>
                <p class="pmc-section-desc">用于根据上下文生成高质量的 PPT 配图</p>
                
                <div class="pmc-form-group">
                  <label class="pmc-label">选择源站 / 预设</label>
                  <div class="pmc-input-row">
                    <select id="ppt-model-img-select" class="pmc-select"></select>
                    <button id="ppt-model-img-refresh" class="pmc-btn-icon" title="刷新源站列表">
                      <iconify-icon icon="carbon:renew" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-form-group">
                  <label class="pmc-label">
                    模型 ID
                    <span class="pmc-label-sub">(支持搜索)</span>
                  </label>
                  <div class="pmc-input-row">
                    <div class="pmc-dropdown-wrapper">
                        <input id="ppt-model-img-id-search" class="pmc-input" placeholder="输入或探测模型 ID..." autocomplete="off">
                        <div id="ppt-model-img-dropdown" class="pmc-dropdown-list"></div>
                    </div>
                    <button id="ppt-model-img-refresh-models" class="pmc-btn-icon" title="探测可用模型 ID">
                      <iconify-icon icon="carbon:connection-signal" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-status-bar">
                  <div class="pmc-model-hint" id="ppt-model-img-hint">
                    <iconify-icon icon="carbon:information" width="14"></iconify-icon>
                    <span>未配置</span>
                  </div>
                </div>

                <button id="ppt-model-img-save" class="pmc-btn-save">
                  <iconify-icon icon="carbon:save" width="16"></iconify-icon>
                  保存配图配置
                </button>
              </div>

              <!-- 视觉模型列 -->
              <div class="pmc-col">
                <div class="pmc-section-header">
                  <div class="pmc-section-icon text-cyan">
                    <iconify-icon icon="carbon:visual-recognition" width="20"></iconify-icon>
                  </div>
                  <span class="pmc-section-title">视觉模型</span>
                </div>
                <p class="pmc-section-desc">用于图片 OCR 识别、布局分析与素材理解</p>
                
                <div class="pmc-form-group">
                  <label class="pmc-label">选择源站 / 预设</label>
                  <div class="pmc-input-row">
                    <select id="ppt-model-vision-select" class="pmc-select"></select>
                    <button id="ppt-model-vision-refresh" class="pmc-btn-icon" title="刷新源站列表">
                      <iconify-icon icon="carbon:renew" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-form-group">
                  <label class="pmc-label">
                    模型 ID
                    <span class="pmc-label-sub">(支持搜索)</span>
                  </label>
                  <div class="pmc-input-row">
                    <div class="pmc-dropdown-wrapper">
                        <input id="ppt-model-vision-id-search" class="pmc-input" placeholder="输入或探测模型 ID..." autocomplete="off">
                        <div id="ppt-model-vision-dropdown" class="pmc-dropdown-list"></div>
                    </div>
                    <button id="ppt-model-vision-refresh-models" class="pmc-btn-icon" title="探测可用模型 ID">
                      <iconify-icon icon="carbon:connection-signal" width="16"></iconify-icon>
                    </button>
                  </div>
                </div>

                <div class="pmc-status-bar">
                  <div class="pmc-model-hint" id="ppt-model-vision-hint">
                    <iconify-icon icon="carbon:information" width="14"></iconify-icon>
                    <span>未配置</span>
                  </div>
                </div>

                <button id="ppt-model-vision-save" class="pmc-btn-save">
                  <iconify-icon icon="carbon:save" width="16"></iconify-icon>
                  保存视觉配置
                </button>
              </div>
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
        </div>

        <!-- Footer -->
        <div class="pmc-footer">
          <button id="ppt-image-processor-settings" class="pmc-btn-secondary">
            <iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon>
            展开图片处理设置
          </button>
          <div id="ppt-image-gen-stats" class="pmc-stats"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 图片处理设置按钮 - Toggle
    document.getElementById('ppt-image-processor-settings')?.addEventListener('click', () => {
        toggleAdvancedSettings();
    });
    
    // 绑定 Image Settings 事件
    bindImageSettingsEvents();
  }

  function safe(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  }

  function getModelIdElements(type) {
    const idMap = { lang: 'lang', img: 'img', vision: 'vision' };
    const t = idMap[type] || 'lang';
    return {
      search: document.getElementById(`ppt-model-${t}-id-search`),
      dropdown: document.getElementById(`ppt-model-${t}-dropdown`),
      refresh: document.getElementById(`ppt-model-${t}-refresh-models`)
    };
  }

  function shouldUseManualModelId(type, providerKey) {
    return (MANUAL_MODEL_ID_PROVIDERS[type] || []).includes(providerKey);
  }

  function setModelIdField(type, providerKey, value) {
    const { search, refresh } = getModelIdElements(type);
    const manual = shouldUseManualModelId(type, providerKey);

    if (refresh) refresh.style.display = manual ? 'none' : '';

    if (search) {
      search.value = value || '';
      if (manual && providerKey === 'volcano') {
        search.placeholder = '请输入火山模型 ID，例如 doubao-1-5-pro-32k-250115';
      } else {
        search.placeholder = '输入或探测模型 ID...';
      }
    }
  }

  function getModelIdValue(type, providerKey) {
    const { search } = getModelIdElements(type);
    return search ? search.value.trim() : '';
  }
  
  function showModelDropdown(type, ids, filter = '') {
    const { dropdown, search } = getModelIdElements(type);
    if (!dropdown) return;
    
    // 如果传入了 ids，更新缓存
    if (ids && ids.length > 0) {
        modelIdCache[type] = ids;
    }
    
    const cachedIds = modelIdCache[type] || [];
    const filterLower = filter.toLowerCase().trim();
    
    // 过滤匹配
    const filtered = filterLower 
        ? cachedIds.filter(id => id.toLowerCase().includes(filterLower))
        : cachedIds;
    
    dropdown.innerHTML = '';
    
    if (cachedIds.length === 0) {
        dropdown.innerHTML = '<div class="pmc-dropdown-empty">点击“探测”按钮获取模型列表</div>';
    } else if (filtered.length === 0) {
        dropdown.innerHTML = '<div class="pmc-dropdown-empty">无匹配结果</div>';
    } else {
        filtered.forEach(id => {
            const item = document.createElement('div');
            item.className = 'pmc-dropdown-item';
            // 高亮匹配部分
            if (filterLower) {
                const idx = id.toLowerCase().indexOf(filterLower);
                if (idx >= 0) {
                    item.innerHTML = id.substring(0, idx) + 
                        '<strong style="color:var(--pmc-primary)">' + id.substring(idx, idx + filterLower.length) + '</strong>' +
                        id.substring(idx + filterLower.length);
                } else {
                    item.textContent = id;
                }
            } else {
                item.textContent = id;
            }
            item.onclick = () => selectModelId(type, id);
            dropdown.appendChild(item);
        });
    }

    // 动态计算位置，使用 fixed 定位避免被裁剪
    if (search) {
        const rect = search.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = (rect.bottom + 6) + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.right = 'auto';
    }

    // Show
    dropdown.classList.add('active');

    // Click outside to close
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target) && e.target !== search) {
            hideModelDropdown(type);
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }
  
  function filterModelDropdown(type) {
    const { search } = getModelIdElements(type);
    const filter = search ? search.value : '';
    if (modelIdCache[type].length > 0) {
        showModelDropdown(type, null, filter);
    }
  }

  function hideModelDropdown(type) {
    const { dropdown } = getModelIdElements(type);
    if (dropdown) dropdown.classList.remove('active');
  }

  function selectModelId(type, id) {
      const { search } = getModelIdElements(type);
      if (search) search.value = id;
      hideModelDropdown(type);
  }

  function getDefaultModelId(providerKey) {
    const map = {
      deepseek: 'deepseek-chat',
      gemini: 'gemini-2.0-flash',
      'gemini-pro': 'gemini-2.0-flash',
      mistral: 'mistral-large-latest',
      tongyi: 'qwen-turbo-latest',
      volcano: 'doubao-1-5-pro-32k-250115',
      'gemini-image': 'gemini-2.5-flash-image',
      image: 'gpt-image-1',
      'openai-image': 'gpt-image-1',
      openai: 'gpt-image-1',
      'sora-image': 'gpt-image-1',
      'jimeng-image': 'gpt-image-1'
    };
    return map[providerKey] || '';
  }

  function populateModal() {
    const langSelect = document.getElementById('ppt-model-lang-select');
    const imgSelect = document.getElementById('ppt-model-img-select');
    const visionSelect = document.getElementById('ppt-model-vision-select');
    const langHint = document.getElementById('ppt-model-lang-hint');
    const imgHint = document.getElementById('ppt-model-img-hint');
    const visionHint = document.getElementById('ppt-model-vision-hint');
    if (!langSelect || !imgSelect) return;

    const langSources = gatherLanguageSources();
    const imgSources = gatherImageSources();
    const visionSources = gatherVisionSources();

    langSelect.innerHTML = langSources.length ? langSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到文字模型源</option>`;
    imgSelect.innerHTML = imgSources.length ? imgSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到配图模型源</option>`;
    if (visionSelect) {
      visionSelect.innerHTML = visionSources.length ? visionSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到视觉模型源</option>`;
    }

    const savedLang = loadConfig('lang');
    const savedImg = loadConfig('img');
    const savedVision = loadConfig('vision');
    if (savedLang && savedLang.modelKey && langSources.some(s => s.key === savedLang.modelKey)) {
      langSelect.value = savedLang.modelKey;
    }
    if (savedImg && savedImg.modelKey && imgSources.some(s => s.key === savedImg.modelKey)) {
      imgSelect.value = savedImg.modelKey;
    }
    if (visionSelect && savedVision && savedVision.modelKey && visionSources.some(s => s.key === savedVision.modelKey)) {
      visionSelect.value = savedVision.modelKey;
    }

    populateModelIds('lang', langSelect.value, savedLang?.modelId);
    populateModelIds('img', imgSelect.value, savedImg?.modelId);
    if (visionSelect) {
      populateModelIds('vision', visionSelect.value, savedVision?.modelId);
    }

    // Key 状态提示
    const checker = (key) => {
      try {
        if (global.modelManager && typeof global.modelManager.checkModelHasValidKey === 'function') {
          return global.modelManager.checkModelHasValidKey(key);
        }
      } catch (_) {}
      return true;
    };
    if (langHint) {
      const ok = langSelect.value ? checker(langSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      langHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      langHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }
    if (imgHint) {
      const ok = imgSelect.value ? checker(imgSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      imgHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      imgHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }
    if (visionHint && visionSelect) {
      const ok = visionSelect.value ? checker(visionSelect.value) : false;
      const icon = ok ? 'carbon:checkmark-filled' : 'carbon:warning-filled';
      const text = ok ? 'Key 可用' : 'Key 未配置/不可用';
      const color = ok ? '#10b981' : '#f97316';
      
      visionHint.innerHTML = `<iconify-icon icon="${icon}" style="color:${color}"></iconify-icon> <span style="color:${color}">${text}</span>`;
      visionHint.style.background = ok ? '#ecfdf5' : '#fff7ed';
    }

    // Load Advanced Settings
    loadImageSettings();
  }

  /**
   * 刷新指定类型的源站列表，保持当前选择
   */
  function refreshSourceList(type) {
    const selectId = type === 'lang' ? 'ppt-model-lang-select' 
                   : type === 'img' ? 'ppt-model-img-select' 
                   : 'ppt-model-vision-select';
    const select = document.getElementById(selectId);
    if (!select) return;
    
    // 记住当前选择
    const currentValue = select.value;
    
    // 获取新的源站列表
    const sources = type === 'lang' ? gatherLanguageSources() 
                  : type === 'img' ? gatherImageSources() 
                  : gatherVisionSources();
    
    // 重新填充
    select.innerHTML = sources.length 
      ? sources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') 
      : `<option value="">未找到模型源</option>`;
    
    // 恢复选择（如果还存在）
    if (currentValue && sources.some(s => s.key === currentValue)) {
      select.value = currentValue;
    }
    
    console.log(`[PPT Model Config] 刷新 ${type} 源站列表，共 ${sources.length} 个`);
  }

  function openModal() {
    renderModal();
    populateModal();
    updateStatsDisplay();
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'flex';
  }

  function closeModal() {
    const modal = document.getElementById('ppt-model-config-modal');
    if (modal) modal.style.display = 'none';
  }
  
  function showSaveSuccess(msg) {
    // 创建提示元素
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
    
    // 2秒后淡出
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
    }, 2000);
  }

  function bindModalEvents() {
    document.addEventListener('click', (e) => {
      // 使用 closest 确保点击按钮内的图标也能触发
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
      if (e.target && e.target.id === 'ppt-model-lang-refresh') {
          refreshSourceList('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh') {
        refreshSourceList('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-refresh') {
        refreshSourceList('vision');
      }
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
      if (e.target && e.target.id === 'ppt-model-lang-select') {
        populateModelIds('lang', e.target.value);
      }
      if (e.target && e.target.id === 'ppt-model-img-select') {
        populateModelIds('img', e.target.value);
      }
      if (e.target && e.target.id === 'ppt-model-vision-select') {
        populateModelIds('vision', e.target.value);
      }
    });

    // 模型 ID 输入框的实时搜索
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search') {
        filterModelDropdown('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-id-search') {
        filterModelDropdown('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-id-search') {
        filterModelDropdown('vision');
      }
    });

    // 聚焦时显示下拉
    document.addEventListener('focus', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-id-search' && modelIdCache.lang.length > 0) {
        filterModelDropdown('lang');
      }
      if (e.target && e.target.id === 'ppt-model-img-id-search' && modelIdCache.img.length > 0) {
        filterModelDropdown('img');
      }
      if (e.target && e.target.id === 'ppt-model-vision-id-search' && modelIdCache.vision.length > 0) {
        filterModelDropdown('vision');
      }
    }, true);
  }

  // 样式注入
  function injectStyles() {
    let style = document.getElementById('ppt-model-config-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ppt-model-config-style';
      document.head.appendChild(style);
    }
    style.textContent = `
      :root {
        --pmc-primary: #6366f1;
        --pmc-primary-hover: #4f46e5;
        --pmc-bg: #f8fafc;
        --pmc-text-main: #0f172a;
        --pmc-text-sub: #64748b;
        --pmc-border: #e2e8f0;
        --pmc-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --pmc-radius: 12px;
      }

      .pmc-modal-overlay {
        position: fixed; inset: 0; z-index: 70;
        display: none; align-items: center; justify-content: center;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .pmc-overlay-bg {
        position: absolute; inset: 0;
        background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(4px);
      }

      .pmc-modal-container {
        position: relative; z-index: 1;
        width: 95vw; max-width: 980px; height: auto; max-height: 85vh;
        background: #fff;
        border-radius: var(--pmc-radius);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        display: flex; flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.1);
      }

      /* Header */
      .pmc-header {
        padding: 20px 24px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
        display: flex; justify-content: space-between; align-items: flex-start;
      }

      .pmc-header-left {
        display: flex; align-items: center; gap: 16px;
      }

      .pmc-header-icon {
        width: 48px; height: 48px;
        border-radius: 12px;
        background: linear-gradient(135deg, #e0e7ff 0%, #eef2ff 100%);
        color: var(--pmc-primary);
        display: flex; align-items: center; justify-content: center;
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
      }

      .pmc-title {
        font-size: 18px; font-weight: 700; color: var(--pmc-text-main);
        line-height: 1.2; margin-bottom: 4px;
      }

      .pmc-subtitle {
        font-size: 13px; color: var(--pmc-text-sub);
      }

      .pmc-close-btn {
        width: 32px; height: 32px;
        border-radius: 8px; border: none; background: transparent;
        color: #94a3b8; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-close-btn:hover { background: #f1f5f9; color: #ef4444; }

      /* Body */
      .pmc-scroll-content {
        flex: 1; overflow-y: auto; overflow-x: hidden;
        background: #f8fafc;
        display: flex; flex-direction: column;
        min-height: 0; /* 确保 flex 子元素可以收缩并触发滚动 */
      }

      .pmc-body {
        display: grid; grid-template-columns: repeat(3, 1fr);
        flex-shrink: 0;
        background: #f8fafc;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }

      .pmc-col {
        padding: 24px;
        border-right: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; flex-direction: column; gap: 20px;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }
      .pmc-col:last-child { border-right: none; }
      .pmc-col:nth-child(even) { background: #fafbfc; }

      .pmc-section-header {
        display: flex; align-items: center; gap: 10px;
      }

      .pmc-section-icon {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: #f1f5f9;
        display: flex; align-items: center; justify-content: center;
      }
      .text-indigo { color: #6366f1; background: #e0e7ff; }
      .text-purple { color: #a855f7; background: #f3e8ff; }
      .text-cyan { color: #06b6d4; background: #cffafe; }

      .pmc-section-title {
        font-size: 16px; font-weight: 600; color: var(--pmc-text-main);
      }

      .pmc-section-desc {
        font-size: 12px; color: var(--pmc-text-sub); line-height: 1.5;
        margin: -8px 0 0 0; min-height: 36px;
      }

      /* Forms */
      .pmc-form-group {
        display: flex; flex-direction: column; gap: 8px;
      }

      .pmc-label {
        font-size: 13px; font-weight: 500; color: #475569;
        display: flex; justify-content: space-between;
      }
      .pmc-label-sub { color: #94a3b8; font-weight: 400; font-size: 12px; }

      .pmc-input-row {
        display: flex; gap: 8px;
      }

      .pmc-select, .pmc-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        border-radius: 8px;
        font-size: 14px; color: #1e293b;
        outline: none; background: #fff;
        transition: all 0.2s;
        width: 0; /* flex fix */
      }
      .pmc-select:focus, .pmc-input:focus {
        border-color: var(--pmc-primary);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
      }
      .pmc-select:disabled, .pmc-input:disabled {
        background: #f1f5f9; color: #94a3b8;
      }

      .pmc-btn-icon {
        width: 42px; padding: 0;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        color: #64748b; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-btn-icon:hover {
        border-color: var(--pmc-primary); color: var(--pmc-primary); background: #f8fafc;
      }

      /* Status & Actions */
      .pmc-status-bar {
        min-height: 24px; display: flex; align-items: center;
      }
      .pmc-model-hint {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: #64748b;
        background: #f1f5f9; padding: 4px 8px; border-radius: 6px;
      }

      .pmc-btn-save {
        margin-top: auto;
        width: 100%; padding: 12px;
        background: var(--pmc-text-main);
        color: #fff;
        border: none; border-radius: 10px;
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all 0.2s;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:hover {
        background: #1e293b; transform: translateY(-1px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:active { transform: translateY(0); }
      .pmc-btn-save iconify-icon, .pmc-btn-icon iconify-icon { pointer-events: none; }

      /* Footer */
      .pmc-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; justify-content: space-between; align-items: center;
      }

      .pmc-btn-secondary {
        background: #fff;
        border: 1px solid var(--pmc-border);
        color: #475569;
        padding: 8px 16px; border-radius: 8px;
        font-size: 13px; font-weight: 500;
        cursor: pointer;
        display: flex; align-items: center; gap: 8px;
        transition: all 0.2s;
      }
      .pmc-btn-secondary:hover {
        border-color: #cbd5e1; background: #f8fafc; color: #1e293b;
      }
      .pmc-btn-secondary iconify-icon { pointer-events: none; }

      .pmc-stats {
        font-size: 12px; color: #94a3b8; font-family: monospace;
      }

      /* Advanced Settings */
      .pmc-advanced-settings {
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
        display: none; /* 默认隐藏 */
        animation: slideDown 0.3s ease;
      }
      @keyframes slideDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }

      .pmc-advanced-header {
        padding: 12px 24px;
        font-size: 13px; font-weight: 600; color: #475569;
        background: #f1f5f9; border-bottom: 1px solid var(--pmc-border);
        display: flex; align-items: center; gap: 8px;
      }

      .pmc-advanced-body {
        padding: 24px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
      }

      .pmc-radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .pmc-radio-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: #334155; }
      .pmc-radio-item input[type="radio"] { accent-color: var(--pmc-primary); }
      .pmc-hint-text { color: #94a3b8; font-size: 12px; }
      
      .pmc-status-text { 
        font-size: 12px; color: #64748b; margin-top: 12px; 
        padding: 8px 12px; background: #fff; border: 1px solid var(--pmc-border); border-radius: 6px;
      }

      .pmc-form-row { display: flex; gap: 20px; margin-top: 8px; }
      .pmc-range { width: 100%; height: 4px; background: #e2e8f0; border-radius: 2px; outline: none; -webkit-appearance: none; }
      .pmc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--pmc-primary); border-radius: 50%; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .pmc-value-badge { background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; }

      /* Custom Dropdown */
      .pmc-dropdown-wrapper { position: relative; flex: 1; display: flex; }
      .pmc-dropdown-list {
        position: absolute; top: 100%; left: 0; right: 0;
        background: #fff; border: 1px solid var(--pmc-border);
        border-radius: 8px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
        max-height: 280px; overflow-y: auto; z-index: 9999;
        margin-top: 6px;
        display: none;
      }
      .pmc-dropdown-list.active { display: block; animation: fadeIn 0.15s ease; }
      .pmc-dropdown-item {
        padding: 10px 12px; font-size: 13px; color: #334155; cursor: pointer;
        border-bottom: 1px solid #f8fafc; transition: all 0.1s;
      }
      .pmc-dropdown-item:hover { background: #f1f5f9; color: var(--pmc-primary); padding-left: 16px; }
      .pmc-dropdown-item:last-child { border-bottom: none; }
      .pmc-dropdown-empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 12px; }

      /* Responsive */
      @media (max-width: 1024px) {
        .pmc-body { grid-template-columns: 1fr; }
        .pmc-col { border-right: none; border-bottom: 1px solid var(--pmc-border); }
        .pmc-col:last-child { border-bottom: none; }
        .pmc-modal-container { max-height: 90vh; }
        .pmc-advanced-body { grid-template-columns: 1fr; gap: 20px; }
      }
    `;
    document.head.appendChild(style);
  }

  function gatherLanguageSources() {
    // 排除通用"自定义翻译模型"，只展示具体源站/预设
    const baseModels = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    const models = [];
    
    // 为预设模型标记 Key 状态
    baseModels.forEach(m => {
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        description: ''
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        console.log('[PPT Model Config] 自定义源站:', Object.keys(sites).length, '个');
        Object.keys(sites).forEach(id => {
          const site = sites[id];
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherLanguageSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini (无 Key)', description: '' },
        { key: 'deepseek', name: 'DeepSeek (无 Key)', description: '' }
      ];
    }
    return models;
  }

  function gatherImageSources() {
    const models = [];
    
    // 从 supportedModelsForKeyManager 获取 image 分组的模型
    const imageModels = getSupportedModels().filter(m => m.group === 'image');
    imageModels.forEach(m => {
      // 检查是否有 Key（有则标记）
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({ 
        key: m.key, 
        name: m.name + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'), 
        description: '' 
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          const siteKeys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = siteKeys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (sites[id].displayName || sites[id].name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: sites[id].apiBaseUrl || ''
          });
        });
      } catch (_) {}
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'image', name: '通用生图 (无 Key)', description: '' },
        { key: 'gemini-image', name: 'Gemini 生图 (无 Key)', description: '' }
      ];
    }
    return models;
  }

  function gatherVisionSources() {
    // 和文字模型使用相同逻辑，从 supportedModelsForKeyManager 获取
    const baseModels = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    const models = [];
    
    // 为预设模型标记 Key 状态
    baseModels.forEach(m => {
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        description: ''
      });
    });
    
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          const site = sites[id];
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(`custom_source_${id}`) || []) : [];
          const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
          models.push({
            key: `custom_source_${id}`,
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherVisionSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini (无 Key)', description: '' },
        { key: 'tongyi', name: '通义千问 (无 Key)', description: '' }
      ];
    }
    
    return models;
  }

  async function populateModelIds(type, modelKey, presetId) {
    const controls = getModelIdElements(type);
    if (!controls.search) return;

    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(modelKey) || {}) : {};
    const customSite = (modelKey || '').startsWith('custom_source_') && typeof loadAllCustomSourceSites === 'function'
      ? (loadAllCustomSourceSites() || {})[modelKey.replace('custom_source_', '')]
      : null;

    const existingId = presetId
      || cfg.preferredModelId
      || cfg.modelId
      || (customSite ? (customSite.modelId || (Array.isArray(customSite.availableModels) && customSite.availableModels[0]?.id) || '') : '')
      || getDefaultModelId(modelKey);

    setModelIdField(type, modelKey, existingId);
  }

  async function fetchAndPopulateModelIds(type, modelKey) {
    const controls = getModelIdElements(type);
    if (!controls.search || !modelKey) return;

    if (shouldUseManualModelId(type, modelKey)) {
      alert('火山引擎模型 ID 请手动填写');
      populateModelIds(type, modelKey);
      return;
    }

    // 配图模型也支持探测
    // if (type === 'img') return;

    // 取第一个可用 Key
    let apiKey = '';
    if (typeof loadModelKeys === 'function') {
      const keys = loadModelKeys(modelKey) || [];
      const usable = keys.filter(k => k.status === 'valid' || k.status === 'untested');
      if (usable.length > 0) apiKey = usable[0].value;
    }
    if (!apiKey) {
      alert(`请先为 ${modelKey} 配置有效的 API Key`);
      return;
    }

    // 显示加载状态
    if (controls.search) {
      controls.search.placeholder = '获取中...';
      controls.search.disabled = true;
    }

    try {
      const ids = await fetchModelIdsByProvider(modelKey, apiKey);
      if (!ids || !ids.length) {
        // 探测失败时退回已保存/默认模型 ID
        populateModelIds(type, modelKey);
        if (controls.search) {
          controls.search.placeholder = '未探测到模型，可手动输入';
        }
      } else {
        // 显示 Dropdown
        showModelDropdown(type, ids);
        
        // 如果当前没有值，选择第一个
        if (controls.search && !controls.search.value) {
          controls.search.value = ids[0];
        }
        if (controls.search) {
          controls.search.placeholder = `已探测到 ${ids.length} 个模型`;
        }
        console.log(`[PPT Model Config] 探测到 ${ids.length} 个模型:`, ids.slice(0, 5));
      }
    } catch (e) {
      console.error('[PPT] fetchModelIdsByProvider error:', e);
      if (controls.search) {
          controls.search.placeholder = '探测失败，请手动输入';
      }
    } finally {
      if (controls.search) {
        controls.search.disabled = false;
      }
    }
  }

  /**
   * 探测模型列表（参考 chatbot 行为）
   */
  async function fetchModelIdsByProvider(providerKey, apiKey) {
    if (!providerKey || !apiKey) return [];

    const normalizeBase = (url) => (url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
    const isGeminiFormat = (fmt, baseUrl) => {
      const lower = (fmt || '').toLowerCase();
      return lower.includes('gemini') || /generativelanguage\.googleapis\.com/i.test(baseUrl || '');
    };
    const tryDetector = async (baseUrl, requestFormat, endpointMode) => {
      if (!baseUrl || !global.modelDetector || typeof global.modelDetector.detectModelsForSite !== 'function') return null;
      try {
        const list = await global.modelDetector.detectModelsForSite(baseUrl, apiKey, requestFormat || 'openai', endpointMode || 'auto');
        if (Array.isArray(list) && list.length) {
          return list.map(m => m.id).filter(Boolean);
        }
      } catch (err) {
        console.warn('[PPT] detectModelsForSite failed', err);
      }
      return null;
    };

    // 自定义源站：优先使用已保存的可用模型或 modelDetector
    if (providerKey.startsWith('custom_source_') || providerKey === 'custom') {
      const sites = typeof loadAllCustomSourceSites === 'function' ? (loadAllCustomSourceSites() || {}) : {};
      const siteId = providerKey.replace('custom_source_', '');
      const site = sites[siteId] || (providerKey === 'custom' ? (typeof loadModelConfig === 'function' ? (loadModelConfig('custom') || null) : null) : null);
      if (!site) return [];

      if (Array.isArray(site.availableModels) && site.availableModels.length) {
        return site.availableModels.map(m => m.id || m.name || '').filter(Boolean);
      }

      const baseUrl = normalizeBase(site.apiBaseUrl || site.apiEndpoint || '');
      if (!baseUrl) return [];

      const requestFormat = site.requestFormat || 'openai';
      const endpointMode = site.endpointMode || 'auto';
      const detected = await tryDetector(baseUrl, requestFormat, endpointMode);
      if (Array.isArray(detected) && detected.length) return detected;

      try {
        const treatAsGemini = isGeminiFormat(requestFormat, baseUrl);
        const endpoint = treatAsGemini
          ? `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`
          : `${normalizeBase(baseUrl)}/v1/models`;
        const headers = treatAsGemini ? {} : { 'Authorization': `Bearer ${apiKey}` };
        const resp = await fetch(endpoint, { headers });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        if (treatAsGemini) {
          const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
          return items.map(m => (m.name ? String(m.name).split('/').pop() : (m.id || ''))).filter(Boolean);
        }
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } catch (e) {
        console.error('[PPT] fetchModelIdsByProvider (custom) failed', e);
        return [];
      }
    }

    try {
      if (providerKey === 'gemini-image' || providerKey === 'gemini' || providerKey === 'gemini-pro') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || loadModelConfig('gemini') || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://generativelanguage.googleapis.com');
        const resp = await fetch(`${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
        return items.map(m => (m.name ? String(m.name).split('/').pop() : (m.id || ''))).filter(Boolean);
      } else if (providerKey === 'deepseek') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://api.deepseek.com');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (providerKey === 'mistral') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://api.mistral.ai');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      } else if (providerKey === 'tongyi') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode');
        const resp = await fetch(`${baseUrl}/v1/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
        return items.map(m => m.model || m.id || m.name).filter(Boolean);
      } else if (providerKey === 'volcano') {
        const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}) : {};
        const baseUrl = normalizeBase(cfg.apiBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3');
        const resp = await fetch(`${baseUrl}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
        return items.map(m => m.model || m.id || m.name).filter(Boolean);
      } else {
        // 默认 OpenAI 兼容
        const base = (typeof loadModelConfig === 'function' ? (loadModelConfig(providerKey) || {}).apiBaseUrl : '') || 'https://api.openai.com';
        const endpoint = `${normalizeBase(base)}/v1/models`;
        const resp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
      }
    } catch (e) {
      console.error('[PPT] fetchModelIdsByProvider failed', e);
      return [];
    }
  }

  // ========== 生图统计功能 ==========
  const IMAGE_GEN_STATS_KEY = 'pptImageGenStats';
  
  function loadImageGenStats() {
    try {
      const raw = localStorage.getItem(IMAGE_GEN_STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { count: 0, lastTime: null, history: [] };
  }
  
  function saveImageGenStats(stats) {
    localStorage.setItem(IMAGE_GEN_STATS_KEY, JSON.stringify(stats));
  }
  
  /**
   * 记录一次生图
   * @param {Object} options - { model, modelId, prompt, success }
   */
  function recordImageGeneration(options = {}) {
    const stats = loadImageGenStats();
    const now = Date.now();
    
    stats.count = (stats.count || 0) + 1;
    stats.lastTime = now;
    
    // 保留最近 100 条记录
    if (!Array.isArray(stats.history)) stats.history = [];
    stats.history.unshift({
      time: now,
      model: options.model || '',
      modelId: options.modelId || '',
      prompt: (options.prompt || '').substring(0, 100),
      success: options.success !== false
    });
    if (stats.history.length > 100) {
      stats.history = stats.history.slice(0, 100);
    }
    
    saveImageGenStats(stats);
    return stats;
  }
  
  function formatStatsDisplay(stats) {
    if (!stats || !stats.count) return '';
    
    const lastTimeStr = stats.lastTime 
      ? new Date(stats.lastTime).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '无';
    
    return `📊 已生成 ${stats.count} 张图片 · 上次: ${lastTimeStr}`;
  }
  
  function updateStatsDisplay() {
    const el = document.getElementById('ppt-image-gen-stats');
    if (el) {
      el.textContent = formatStatsDisplay(loadImageGenStats());
    }
  }

  // ========== 高级设置 & 交互助手 ==========

  function toggleAdvancedSettings() {
      const panel = document.getElementById('pmc-image-settings-panel');
      const chevron = document.getElementById('pmc-settings-chevron');
      const btn = document.getElementById('ppt-image-processor-settings');
      
      if (!panel) return;
      const computedDisplay = window.getComputedStyle(panel).display;
      const isVisible = computedDisplay !== 'none';
      
      if (isVisible) {
          panel.style.display = 'none';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-down');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon> 展开图片处理设置';
      } else {
          panel.style.display = 'block';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-up');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-up" width="16" id="pmc-settings-chevron"></iconify-icon> 收起图片处理设置';
          
          // Smooth scroll to show the panel
          setTimeout(() => {
              panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
      }
  }

  function bindImageSettingsEvents() {
      // Inputs
      const edgeSlider = document.getElementById('pmc-edge-threshold');
      const colorSlider = document.getElementById('pmc-color-tolerance');
      const presetSelect = document.getElementById('pmc-vectorize-preset');
      const ocrRadios = document.querySelectorAll('input[name="pmc-ocr-priority"]');

      if (edgeSlider) {
          edgeSlider.oninput = () => document.getElementById('pmc-edge-val').textContent = edgeSlider.value;
          edgeSlider.onchange = () => saveImageSettings();
      }
      if (colorSlider) {
          colorSlider.oninput = () => document.getElementById('pmc-color-val').textContent = colorSlider.value;
          colorSlider.onchange = () => saveImageSettings();
      }
      if (presetSelect) {
          presetSelect.onchange = () => saveImageSettings();
      }
      ocrRadios.forEach(r => r.onchange = () => saveImageSettings());
  }

  function loadImageSettings() {
      const config = (window.imageProcessor && window.imageProcessor.config) || (() => {
          try { return JSON.parse(localStorage.getItem('imageProcessorConfig')) || {}; } catch(e) { return {}; }
      })();
      
      // Defaults
      const ocrPriority = config.ocrPriority || 'mineru';
      const vectorizePreset = config.vectorizePreset || 'auto';
      const edgeThreshold = (config.bgRemover && config.bgRemover.edgeThreshold) || 30;
      const colorTolerance = (config.bgRemover && config.bgRemover.colorTolerance) || 25;

      // Set Values
      const radio = document.querySelector(`input[name="pmc-ocr-priority"][value="${ocrPriority}"]`);
      if (radio) radio.checked = true;

      const presetSel = document.getElementById('pmc-vectorize-preset');
      if (presetSel) presetSel.value = vectorizePreset;

      const edgeSlider = document.getElementById('pmc-edge-threshold');
      if (edgeSlider) { edgeSlider.value = edgeThreshold; document.getElementById('pmc-edge-val').textContent = edgeThreshold; }

      const colorSlider = document.getElementById('pmc-color-tolerance');
      if (colorSlider) { colorSlider.value = colorTolerance; document.getElementById('pmc-color-val').textContent = colorTolerance; }

      updateOcrStatus();
  }

  function saveImageSettings() {
      const ocrPriority = document.querySelector('input[name="pmc-ocr-priority"]:checked')?.value || 'mineru';
      const vectorizePreset = document.getElementById('pmc-vectorize-preset')?.value || 'auto';
      const edgeThreshold = parseInt(document.getElementById('pmc-edge-threshold')?.value || 30);
      const colorTolerance = parseInt(document.getElementById('pmc-color-tolerance')?.value || 25);

      const config = {
          ocrPriority,
          vectorizePreset,
          bgRemover: { edgeThreshold, colorTolerance }
      };

      // Save to ImageProcessor global instance if available
      if (window.imageProcessor && typeof window.imageProcessor.saveConfig === 'function') {
          window.imageProcessor.saveConfig(config);
      }
      // Save to LocalStorage
      localStorage.setItem('imageProcessorConfig', JSON.stringify(config));
  }

  function updateOcrStatus() {
      const el = document.getElementById('pmc-ocr-status');
      if (!el) return;

      if (!window.imageProcessor) {
          el.innerHTML = '<span style="color:#64748b">💡 进入图片编辑器后可用</span>';
          return;
      }
      
      const avail = typeof window.imageProcessor.getOcrAvailability === 'function' 
          ? window.imageProcessor.getOcrAvailability() 
          : { mineru: false, vlm: false };

      const mStatus = avail.mineru ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';
      const vStatus = avail.vlm ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';

      el.innerHTML = `MinerU: ${mStatus} &nbsp;&nbsp; 视觉模型: ${vStatus}`;
  }

  injectStyles();
  bindModalEvents();
  
  global.PPTModelConfigModal = { 
    openModal, 
    closeModal, 
    loadConfig,
    // 暴露统计功能
    recordImageGeneration,
    loadImageGenStats
  };

})(typeof window !== 'undefined' ? window : this);
