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
    img: 'pptModelConfigImage'
  };

  const MANUAL_MODEL_ID_PROVIDERS = {
    lang: ['volcano'], // 火山引擎模型 ID 需要手动填写
    img: []
  };

  function getSupportedModels() {
    const list = Array.isArray(global.supportedModelsForKeyManager) ? global.supportedModelsForKeyManager : [];
    return list;
  }

  function loadConfig(type) {
    try {
      const raw = localStorage.getItem(type === 'lang' ? STORAGE_KEYS.lang : STORAGE_KEYS.img);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveConfig(type, cfg) {
    localStorage.setItem(type === 'lang' ? STORAGE_KEYS.lang : STORAGE_KEYS.img, JSON.stringify(cfg));
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
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0; flex:1; overflow:auto;">
          <div style="border-right:1px solid #e2e8f0; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:600; color:#0f172a;">文字模型</div>
            <label style="font-size:13px; color:#475569;">选择源站 / 预设</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-lang-select" class="ppt-model-form-input" style="flex:1;"></select>
              <button id="ppt-model-lang-refresh" class="ppt-model-refresh-btn" title="刷新源站列表">⟳</button>
            </div>
            <label style="font-size:13px; color:#475569;">模型 ID</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-lang-id" class="ppt-model-form-input" style="flex:1;"></select>
              <input id="ppt-model-lang-id-input" class="ppt-model-form-input" style="flex:1; display:none;" placeholder="请输入模型 ID">
              <button id="ppt-model-lang-refresh-models" class="ppt-model-refresh-btn" title="探测可用模型 ID">⟳</button>
            </div>
            <div class="ppt-model-hint" id="ppt-model-lang-hint"></div>
            <button id="ppt-model-lang-save" class="ppt-model-save-btn">保存文字模型</button>
          </div>
          <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
            <div style="font-weight:600; color:#0f172a;">配图模型</div>
            <label style="font-size:13px; color:#475569;">选择源站 / 预设</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-img-select" class="ppt-model-form-input" style="flex:1;"></select>
              <button id="ppt-model-img-refresh" class="ppt-model-refresh-btn" title="刷新源站列表">⟳</button>
            </div>
            <label style="font-size:13px; color:#475569;">模型 ID</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <select id="ppt-model-img-id" class="ppt-model-form-input" style="flex:1;"></select>
              <input id="ppt-model-img-id-input" class="ppt-model-form-input" style="flex:1; display:none;" placeholder="请输入模型 ID">
              <button id="ppt-model-img-refresh-models" class="ppt-model-refresh-btn" title="探测可用模型 ID">⟳</button>
            </div>
            <div class="ppt-model-hint" id="ppt-model-img-hint"></div>
            <button id="ppt-model-img-save" class="ppt-model-save-btn">保存配图模型</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function safe(str) {
    return (str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  }

  function getModelIdElements(type) {
    return {
      select: document.getElementById(type === 'lang' ? 'ppt-model-lang-id' : 'ppt-model-img-id'),
      input: document.getElementById(type === 'lang' ? 'ppt-model-lang-id-input' : 'ppt-model-img-id-input'),
      refresh: document.getElementById(type === 'lang' ? 'ppt-model-lang-refresh-models' : 'ppt-model-img-refresh-models')
    };
  }

  function shouldUseManualModelId(type, providerKey) {
    return (MANUAL_MODEL_ID_PROVIDERS[type] || []).includes(providerKey);
  }

  function setModelIdField(type, providerKey, value) {
    const { select, input, refresh } = getModelIdElements(type);
    const manual = shouldUseManualModelId(type, providerKey);

    if (refresh) refresh.style.display = manual ? 'none' : '';

    if (manual) {
      if (select) select.style.display = 'none';
      if (input) {
        input.style.display = '';
        input.value = value || '';
        input.placeholder = (providerKey === 'volcano' ? '请输入火山模型 ID，例如 doubao-1-5-pro-32k-250115' : '') || '请输入模型 ID';
      }
      return;
    }

    if (select) {
      select.style.display = '';
      select.innerHTML = `<option value="${safe(value)}">${value ? safe(value) : '未配置模型ID'}</option>`;
      select.value = value || '';
    }
    if (input) input.style.display = 'none';
  }

  function getModelIdValue(type, providerKey) {
    const { select, input } = getModelIdElements(type);
    if (shouldUseManualModelId(type, providerKey)) {
      return input ? input.value.trim() : '';
    }
    return select ? (select.value || '').trim() : '';
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
    const langId = document.getElementById('ppt-model-lang-id');
    const imgId = document.getElementById('ppt-model-img-id');
    const langHint = document.getElementById('ppt-model-lang-hint');
    const imgHint = document.getElementById('ppt-model-img-hint');
    if (!langSelect || !imgSelect || !langId || !imgId) return;

    const langSources = gatherLanguageSources();
    const imgSources = gatherImageSources();

    langSelect.innerHTML = langSources.length ? langSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到文字模型源</option>`;
    imgSelect.innerHTML = imgSources.length ? imgSources.map(m => `<option value="${safe(m.key)}">${safe(m.name || m.key)}</option>`).join('') : `<option value="">未找到配图模型源</option>`;

    const savedLang = loadConfig('lang');
    const savedImg = loadConfig('img');
    if (savedLang && savedLang.modelKey && langSources.some(s => s.key === savedLang.modelKey)) {
      langSelect.value = savedLang.modelKey;
    }
    if (savedImg && savedImg.modelKey && imgSources.some(s => s.key === savedImg.modelKey)) {
      imgSelect.value = savedImg.modelKey;
    }

    populateModelIds('lang', langSelect.value, savedLang?.modelId);
    populateModelIds('img', imgSelect.value, savedImg?.modelId);

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
  }

  function openModal() {
    renderModal();
    populateModal();
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
      if (e.target && e.target.id === 'ppt-model-lang-refresh') {
        populateModal();
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh') {
        populateModal();
      }
      if (e.target && e.target.id === 'ppt-model-lang-refresh-models') {
        const sel = document.getElementById('ppt-model-lang-select');
        fetchAndPopulateModelIds('lang', sel ? sel.value : '');
      }
      if (e.target && e.target.id === 'ppt-model-img-refresh-models') {
        const sel = document.getElementById('ppt-model-img-select');
        const modelKey = sel ? sel.value : '';
        populateModelIds('img', modelKey);
        const currentId = getModelIdValue('img', modelKey) || '未配置';
        alert(`配图模型无需探测，当前调用的模型 ID: ${currentId}`);
      }
    });

    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'ppt-model-lang-select') {
        populateModelIds('lang', e.target.value);
      }
      if (e.target && e.target.id === 'ppt-model-img-select') {
        populateModelIds('img', e.target.value);
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
    // 排除通用“自定义翻译模型”，只展示具体源站/预设
    const models = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    // 追加自定义源站点
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          models.push({
            key: `custom_source_${id}`,
            name: sites[id].displayName || `自定义源站 (${id.slice(-6)})`,
            description: sites[id].apiBaseUrl || ''
          });
        });
      } catch (_) {}
    }
    // 兜底：翻译下拉
    if (models.length === 0) {
      const tsel = document.getElementById('translationModel');
      if (tsel) {
        return Array.from(tsel.options)
          .filter(opt => opt.value && opt.value !== 'none' && opt.value !== 'deeplx')
          .map(opt => ({ key: opt.value, name: opt.textContent || opt.value, description: '' }));
      }
    }
    return models;
  }

  function gatherImageSources() {
    const models = getSupportedModels().filter(m => m.group === 'image');
    // 追加自定义源站点作为配图源（需用户自配 modelId）
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        Object.keys(sites).forEach(id => {
          models.push({
            key: `custom_source_${id}`,
            name: sites[id].displayName || `自定义源站 (${id.slice(-6)})`,
            description: sites[id].apiBaseUrl || ''
          });
        });
      } catch (_) {}
    }
    if (models.length === 0) {
      return [
        { key: 'image', name: '通用生图', description: 'OpenAI 兼容/自定义生图' },
        { key: 'gemini-image', name: 'Gemini 生图', description: 'Google Gemini 文生图' }
      ];
    }
    return models;
  }

  async function populateModelIds(type, modelKey, presetId) {
    const controls = getModelIdElements(type);
    if (!controls.select && !controls.input) return;

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
    if ((!controls.select && !controls.input) || !modelKey) return;

    if (shouldUseManualModelId(type, modelKey)) {
      alert('火山引擎模型 ID 请手动填写');
      populateModelIds(type, modelKey);
      return;
    }

    // 配图模型的 ID 由模型与 Key 设置处直接确定，无需探测
    if (type === 'img') return;

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

    if (controls.select) controls.select.innerHTML = `<option value="">获取中...</option>`;

    const ids = await fetchModelIdsByProvider(modelKey, apiKey);
    if (!ids || !ids.length) {
      // 探测失败时退回已保存/默认模型 ID，避免空白
      populateModelIds(type, modelKey);
    } else {
      if (controls.select) {
        controls.select.innerHTML = ids.map(id => `<option value="${safe(id)}">${safe(id)}</option>`).join('');
        controls.select.value = ids[0];
      } else {
        setModelIdField(type, modelKey, ids[0]);
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

  injectStyles();
  bindModalEvents();
  global.PPTModelConfigModal = { openModal, closeModal, loadConfig };

})(typeof window !== 'undefined' ? window : this);
