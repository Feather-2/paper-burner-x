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
    modal.style.cssText = `
      position: fixed; inset:0; z-index:70; display:none; align-items:center; justify-content:center;
    `;
    modal.innerHTML = `
      <div id="ppt-model-config-overlay" style="position:absolute; inset:0; background:rgba(0,0,0,0.4);"></div>
      <div style="position:relative; z-index:1; width:92vw; max-width:820px; max-height:90vh; background:#fff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.2); display:flex; flex-direction:column; overflow:hidden;">
        <div style="padding:16px 20px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:16px; font-weight:700; color:#111827;">PPT 模型配置</div>
            <div style="font-size:12px; color:#64748b;">独立于翻译/聊天模型，专用于 PPT 文案与配图</div>
          </div>
          <button id="ppt-model-config-close" style="border:none; background:transparent; color:#94a3b8; cursor:pointer; font-size:20px;">×</button>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; flex:1; overflow:auto;">
          <div style="border-right:1px solid #e2e8f0; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:600; color:#0f172a;">📝 文字模型</div>
            <div style="font-size:11px; color:#94a3b8; margin-top:-8px;">用于 PPT 大纲、文案生成</div>
            <label style="font-size:13px; color:#475569;">选择源站 / 预设</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-lang-select" class="ppt-model-form-input" style="flex:1;"></select>
              <button id="ppt-model-lang-refresh" class="ppt-model-refresh-btn" title="刷新源站列表">⟳</button>
            </div>
            <label style="font-size:13px; color:#475569;">模型 ID <span style="font-size:11px; color:#94a3b8;">(可搜索/输入)</span></label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="ppt-model-lang-id-search" class="ppt-model-form-input" style="flex:1;" list="ppt-model-lang-id-list" placeholder="搜索或输入模型 ID...">
              <datalist id="ppt-model-lang-id-list"></datalist>
              <button id="ppt-model-lang-refresh-models" class="ppt-model-refresh-btn" title="探测可用模型 ID">⟳</button>
            </div>
            <div class="ppt-model-hint" id="ppt-model-lang-hint"></div>
            <button id="ppt-model-lang-save" class="ppt-model-save-btn">保存文字模型</button>
          </div>
          <div style="border-right:1px solid #e2e8f0; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:600; color:#0f172a;">🎨 配图模型</div>
            <div style="font-size:11px; color:#94a3b8; margin-top:-8px;">用于 PPT 配图生成</div>
            <label style="font-size:13px; color:#475569;">选择源站 / 预设</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-img-select" class="ppt-model-form-input" style="flex:1;"></select>
              <button id="ppt-model-img-refresh" class="ppt-model-refresh-btn" title="刷新源站列表">⟳</button>
            </div>
            <label style="font-size:13px; color:#475569;">模型 ID <span style="font-size:11px; color:#94a3b8;">(可搜索/输入)</span></label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="ppt-model-img-id-search" class="ppt-model-form-input" style="flex:1;" list="ppt-model-img-id-list" placeholder="搜索或输入模型 ID...">
              <datalist id="ppt-model-img-id-list"></datalist>
              <button id="ppt-model-img-refresh-models" class="ppt-model-refresh-btn" title="探测可用模型 ID">⟳</button>
            </div>
            <div class="ppt-model-hint" id="ppt-model-img-hint"></div>
            <button id="ppt-model-img-save" class="ppt-model-save-btn">保存配图模型</button>
          </div>
          <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:600; color:#0f172a;">👁️ 视觉模型</div>
            <div style="font-size:11px; color:#94a3b8; margin-top:-8px;">用于 OCR 文字识别、图片分析</div>
            <label style="font-size:13px; color:#475569;">选择源站 / 预设</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-vision-select" class="ppt-model-form-input" style="flex:1;"></select>
              <button id="ppt-model-vision-refresh" class="ppt-model-refresh-btn" title="刷新源站列表">⟳</button>
            </div>
            <label style="font-size:13px; color:#475569;">模型 ID <span style="font-size:11px; color:#94a3b8;">(可搜索/输入)</span></label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input id="ppt-model-vision-id-search" class="ppt-model-form-input" style="flex:1;" list="ppt-model-vision-id-list" placeholder="搜索或输入模型 ID...">
              <datalist id="ppt-model-vision-id-list"></datalist>
              <button id="ppt-model-vision-refresh-models" class="ppt-model-refresh-btn" title="探测可用模型 ID">⟳</button>
            </div>
            <div class="ppt-model-hint" id="ppt-model-vision-hint"></div>
            <button id="ppt-model-vision-save" class="ppt-model-save-btn">保存视觉模型</button>
          </div>
        </div>
        <div style="padding:12px 20px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
          <button id="ppt-image-processor-settings" style="background:none; border:1px solid #e2e8f0; padding:8px 16px; border-radius:6px; cursor:pointer; font-size:13px; color:#475569;">
            🎨 图片智能处理设置
          </button>
          <div id="ppt-image-gen-stats" style="font-size:12px; color:#64748b;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 图片处理设置按钮
    document.getElementById('ppt-image-processor-settings')?.addEventListener('click', () => {
      if (window.imageProcessorSettings) {
        window.imageProcessorSettings.open();
      } else {
        const script = document.createElement('script');
        script.src = 'js/ppt/editor/image-processor/settings-panel.js';
        script.onload = () => window.imageProcessorSettings?.open();
        document.head.appendChild(script);
      }
    });
  }

  function safe(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  }

  function getModelIdElements(type) {
    const idMap = { lang: 'lang', img: 'img', vision: 'vision' };
    const t = idMap[type] || 'lang';
    return {
      search: document.getElementById(`ppt-model-${t}-id-search`),
      datalist: document.getElementById(`ppt-model-${t}-id-list`),
      refresh: document.getElementById(`ppt-model-${t}-refresh-models`)
    };
  }

  function shouldUseManualModelId(type, providerKey) {
    return (MANUAL_MODEL_ID_PROVIDERS[type] || []).includes(providerKey);
  }

  function setModelIdField(type, providerKey, value) {
    const { search, datalist, refresh } = getModelIdElements(type);
    const manual = shouldUseManualModelId(type, providerKey);

    if (refresh) refresh.style.display = manual ? 'none' : '';

    if (search) {
      search.value = value || '';
      if (manual && providerKey === 'volcano') {
        search.placeholder = '请输入火山模型 ID，例如 doubao-1-5-pro-32k-250115';
      } else {
        search.placeholder = '搜索或输入模型 ID...';
      }
    }
    
    // 如果只有一个值，也加入 datalist
    if (datalist && value) {
      const existing = Array.from(datalist.options).map(o => o.value);
      if (!existing.includes(value)) {
        const opt = document.createElement('option');
        opt.value = value;
        datalist.appendChild(opt);
      }
    }
  }

  function getModelIdValue(type, providerKey) {
    const { search } = getModelIdElements(type);
    return search ? search.value.trim() : '';
  }
  
  function populateModelIdDatalist(type, ids) {
    const { datalist, search } = getModelIdElements(type);
    if (!datalist) return;
    
    const currentValue = search ? search.value : '';
    datalist.innerHTML = '';
    
    (ids || []).forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      datalist.appendChild(opt);
    });
    
    // 如果当前值不在列表中但非空，保留它
    if (currentValue && !ids.includes(currentValue)) {
      const opt = document.createElement('option');
      opt.value = currentValue;
      datalist.appendChild(opt);
    }
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
      langHint.textContent = ok ? 'Key 可用' : 'Key 未配置/不可用';
      langHint.style.color = ok ? '#10b981' : '#f97316';
    }
    if (imgHint) {
      const ok = imgSelect.value ? checker(imgSelect.value) : false;
      imgHint.textContent = ok ? 'Key 可用' : 'Key 未配置/不可用';
      imgHint.style.color = ok ? '#10b981' : '#f97316';
    }
    if (visionHint && visionSelect) {
      const ok = visionSelect.value ? checker(visionSelect.value) : false;
      visionHint.textContent = ok ? 'Key 可用' : 'Key 未配置/不可用';
      visionHint.style.color = ok ? '#10b981' : '#f97316';
    }
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

  function bindModalEvents() {
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'ppt-model-config-close') closeModal();
      if (e.target && e.target.id === 'ppt-model-config-overlay') closeModal();
      if (e.target && e.target.id === 'ppt-model-lang-save') {
        const sel = document.getElementById('ppt-model-lang-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('lang', { modelKey, modelId: getModelIdValue('lang', modelKey) });
          closeModal();
        } else {
          alert('请选择文字模型');
        }
      }
      if (e.target && e.target.id === 'ppt-model-img-save') {
        const sel = document.getElementById('ppt-model-img-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('img', { modelKey, modelId: getModelIdValue('img', modelKey) });
          closeModal();
        } else {
          alert('请选择配图模型');
        }
      }
      if (e.target && e.target.id === 'ppt-model-vision-save') {
        const sel = document.getElementById('ppt-model-vision-select');
        const modelKey = sel ? sel.value : '';
        if (modelKey) {
          saveConfig('vision', { modelKey, modelId: getModelIdValue('vision', modelKey) });
          closeModal();
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
  }

  // 样式注入
  function injectStyles() {
    if (document.getElementById('ppt-model-config-style')) return;
    const style = document.createElement('style');
    style.id = 'ppt-model-config-style';
    style.textContent = `
      .ppt-model-form-input { width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }
      .ppt-model-save-btn { width: 100%; padding: 10px; border: none; border-radius: 8px; background: linear-gradient(90deg,#6366f1,#8b5cf6); color: white; font-weight: 600; cursor: pointer; }
      .ppt-model-hint { font-size: 12px; color: #64748b; }
      .ppt-model-empty { font-size: 13px; color: #94a3b8; padding: 8px; border: 1px dashed #e2e8f0; border-radius: 8px; text-align: center; }
      .ppt-model-refresh-btn { border:1px solid #e2e8f0; background:#fff; border-radius:8px; padding:6px 8px; cursor:pointer; font-size:14px; color:#475569; }
      #ppt-model-config-modal { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
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
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'),
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
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherLanguageSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini ⚠️', description: '' },
        { key: 'deepseek', name: 'DeepSeek ⚠️', description: '' }
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
            name: (sites[id].displayName || sites[id].name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'),
            description: sites[id].apiBaseUrl || ''
          });
        });
      } catch (_) {}
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'image', name: '通用生图 ⚠️', description: '' },
        { key: 'gemini-image', name: 'Gemini 生图 ⚠️', description: '' }
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
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'),
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
            name: (site.displayName || site.name || `自定义源站`) + (validKeys.length ? ` (${validKeys.length} Key)` : ' ⚠️'),
            description: site.apiBaseUrl || site.apiEndpoint || ''
          });
        });
      } catch (e) { console.error('[PPT] gatherVisionSources error:', e); }
    }
    
    // 兜底
    if (models.length === 0) {
      return [
        { key: 'gemini', name: 'Google Gemini ⚠️', description: '' },
        { key: 'tongyi', name: '通义千问 ⚠️', description: '' }
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
        // 填充 datalist
        populateModelIdDatalist(type, ids);
        // 如果当前没有值，选择第一个
        if (controls.search && !controls.search.value) {
          controls.search.value = ids[0];
        }
        if (controls.search) {
          controls.search.placeholder = `已探测到 ${ids.length} 个模型`;
        }
        console.log(`[PPT Model Config] 探测到 ${ids.length} 个模型:`, ids.slice(0, 5));
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
