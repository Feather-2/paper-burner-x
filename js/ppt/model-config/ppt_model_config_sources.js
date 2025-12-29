/**
 * PPT 模型配置 - 源站/模型探测
 * IIFE module: window.PPTModelConfig.sources
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.sources = ns.sources || {};

  const { COMMON_API_PROVIDERS = [], MANUAL_MODEL_ID_PROVIDERS = {} } = ns.constants || {};
  const { safe: _safe, uniqueByKey: _uniqueByKey } = ns.utils || {};
  const safe = typeof _safe === 'function' ? _safe : (v) => String(v || '');
  const uniqueByKey = typeof _uniqueByKey === 'function' ? _uniqueByKey : (arr) => Array.isArray(arr) ? arr : [];

  // 缓存探测到的模型 ID 列表（旧 UI 兼容）
  const modelIdCache = { lang: [], img: [], vision: [] };

  function getSupportedModels() {
    const list = Array.isArray(global.supportedModelsForKeyManager) ? global.supportedModelsForKeyManager : [];
    return list;
  }



  function getAllConfigurableModels() {
    const models = [];
    const seen = new Set();

    // 1. 首先添加常见 API 提供商
    for (const p of COMMON_API_PROVIDERS) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(p.key) || []) : [];
      const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
      models.push({
        key: p.key,
        name: p.name + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        group: 'api',
        endpoint: p.endpoint
      });
    }

    // 2. 然后添加 supportedModelsForKeyManager 中的其他模型（排除 OCR 和已添加的）
    const supported = getSupportedModels().filter(m => m && m.key && m.group !== 'ocr');
    for (const m of supported) {
      if (m.key === 'custom' || m.key === 'deeplx') continue;
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
      models.push({
        key: m.key,
        name: (m.name || m.key) + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
        group: m.group || 'unknown'
      });
    }

    // 3. 最后添加自定义源站
    if (typeof loadAllCustomSourceSites === 'function') {
      try {
        const sites = loadAllCustomSourceSites() || {};
        for (const id of Object.keys(sites)) {
          const site = sites[id] || {};
          const modelKey = `custom_source_${id}`;
          if (seen.has(modelKey)) continue;
          seen.add(modelKey);
          const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(modelKey) || []) : [];
          const validKeys = keys.filter(k => k && k.status !== 'invalid' && k.value);
          models.push({
            key: modelKey,
            name: (site.displayName || site.name || '自定义源站') + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'),
            group: 'custom',
            endpoint: site.apiEndpoint || ''
          });
        }
      } catch (e) {
        console.error('[PPT Model Config] loadAllCustomSourceSites failed', e);
      }
    }

    return models;
  }



  const tab1ModelsSession = {
    cache: {},     // sourceKey -> string[]
    inflight: {},  // sourceKey -> Promise<string[]>
    error: {}      // sourceKey -> string
  };

  function normalizeApiBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  function getDefaultApiBaseUrlForSource(sourceKey) {
    const provider = COMMON_API_PROVIDERS.find(p => p.key === sourceKey);
    if (provider?.endpoint) return provider.endpoint;
    return '';
  }

  function resolveApiBaseUrlForSource(sourceKey) {
    if (!sourceKey) return '';

    // 自定义源站
    if (String(sourceKey).startsWith('custom_source_') && typeof loadAllCustomSourceSites === 'function') {
      const sites = loadAllCustomSourceSites() || {};
      const siteId = String(sourceKey).replace('custom_source_', '');
      const site = sites?.[siteId] || {};
      return normalizeApiBaseUrl(site.apiBaseUrl || site.apiEndpoint || site.baseUrl || '');
    }

    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig(sourceKey) || {}) : {};
    return normalizeApiBaseUrl(cfg.apiBaseUrl || getDefaultApiBaseUrlForSource(sourceKey));
  }

  function resolveFirstUsableApiKeyForSource(sourceKey) {
    if (!sourceKey || typeof loadModelKeys !== 'function') return '';
    try {
      const keys = loadModelKeys(sourceKey) || [];
      const usable = keys.filter((k) => k && k.value && (k.status === 'valid' || k.status === 'untested'));
      return usable[0]?.value || '';
    } catch (_) {
      return '';
    }
  }

  function parseOpenAICompatibleModelIds(payload) {
    const pickArray = (v) => (Array.isArray(v) ? v : []);
    const candidates = [
      ...pickArray(payload),
      ...pickArray(payload?.data),
      ...pickArray(payload?.models),
      ...pickArray(payload?.result?.data),
      ...pickArray(payload?.data?.data),
      ...pickArray(payload?.data?.models),
      ...pickArray(payload?.data?.result?.data)
    ];

    const out = [];
    const seen = new Set();
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const rawId = item.id || item.model || item.name || '';
      let id = String(rawId || '').trim();
      if (!id) continue;
      // 一些兼容实现会返回 "models/<id>" 或 "publishers/<p>/models/<id>"
      if (id.includes('/')) id = id.split('/').pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  // 新增：实时获取某源站的模型列表（会话级缓存）
  async function fetchModelsForSource(sourceKey) {
    if (!sourceKey) return [];
    if (Array.isArray(tab1ModelsSession.cache[sourceKey])) return tab1ModelsSession.cache[sourceKey];
    if (tab1ModelsSession.inflight[sourceKey]) return tab1ModelsSession.inflight[sourceKey];

    tab1ModelsSession.error[sourceKey] = '';
    const task = (async () => {
      const apiKey = resolveFirstUsableApiKeyForSource(sourceKey);
      if (!apiKey) throw new Error('NO_API_KEY');

      const baseUrl = resolveApiBaseUrlForSource(sourceKey);
      if (!baseUrl) throw new Error('NO_BASE_URL');

      // 优先走 OpenAI 兼容的 /v1/models，失败时回退到 /models
      const tryFetch = async (endpoint) => {
        const resp = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          }
        });
        if (!resp.ok) throw new Error(`HTTP_${resp.status}`);
        const data = await resp.json();
        const ids = parseOpenAICompatibleModelIds(data);
        if (!ids.length) throw new Error('EMPTY_MODELS');
        return ids;
      };

      const endpointV1 = `${normalizeApiBaseUrl(baseUrl)}/v1/models`;
      try {
        return await tryFetch(endpointV1);
      } catch (e) {
        const endpointFallback = `${normalizeApiBaseUrl(baseUrl)}/models`;
        return await tryFetch(endpointFallback);
      }
    })()
      .then((ids) => {
        const unique = Array.from(new Set((ids || []).map((x) => String(x || '').trim()).filter(Boolean)));
        unique.sort((a, b) => a.localeCompare(b));
        tab1ModelsSession.cache[sourceKey] = unique;
        return unique;
      })
      .catch((err) => {
        const msg = String(err?.message || err || '').trim();
        if (msg === 'NO_API_KEY') tab1ModelsSession.error[sourceKey] = '未配置可用 Key，无法获取模型列表';
        else if (msg === 'NO_BASE_URL') tab1ModelsSession.error[sourceKey] = '未配置 API Base URL';
        else if (msg.startsWith('HTTP_')) tab1ModelsSession.error[sourceKey] = `请求失败（${msg.replace('HTTP_', '')}）`;
        else tab1ModelsSession.error[sourceKey] = '获取失败';
        delete tab1ModelsSession.cache[sourceKey];
        return [];
      })
      .finally(() => {
        delete tab1ModelsSession.inflight[sourceKey];
      });

    tab1ModelsSession.inflight[sourceKey] = task;
    return task;
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

    if (refresh) refresh.style.display = manual || providerKey === 'auto' ? 'none' : '';

    if (search) {
      search.value = value || '';
      search.disabled = providerKey === 'auto';
      if (manual && providerKey === 'volcano') {
        search.placeholder = '请输入火山模型 ID，例如 doubao-1-5-pro-32k-250115';
      } else if (providerKey === 'auto') {
        search.placeholder = '自动选择模式';
        search.value = '';
      } else {
        search.placeholder = '探测或输入模型 ID...';
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
	                    item.textContent = '';
	                    item.appendChild(document.createTextNode(id.substring(0, idx)));
	                    const strong = document.createElement('strong');
	                    strong.style.color = 'var(--pmc-primary)';
	                    strong.textContent = id.substring(idx, idx + filterLower.length);
	                    item.appendChild(strong);
	                    item.appendChild(document.createTextNode(id.substring(idx + filterLower.length)));
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
        const winHeight = window.innerHeight;
        const dropdownHeight = 280; // max-height in CSS
        const spaceBelow = winHeight - rect.bottom;
        const spaceAbove = rect.top;
        
        dropdown.style.position = 'fixed';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.right = 'auto';
        
        if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
            // 向上弹出
            dropdown.style.top = 'auto';
            dropdown.style.bottom = (winHeight - rect.top + 6) + 'px';
            dropdown.style.marginTop = '0';
            dropdown.style.marginBottom = '6px';
        } else {
            // 向下弹出
            dropdown.style.bottom = 'auto';
            dropdown.style.top = (rect.bottom + 6) + 'px';
            dropdown.style.marginTop = '6px';
            dropdown.style.marginBottom = '0';
        }
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
      const { search, dropdown } = getModelIdElements(type);
      if (search) {
          search.value = id;
          // 触发 input 事件以便其他逻辑感知变化
          search.dispatchEvent(new Event('input', { bubbles: true }));
      }
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



  function gatherLanguageSources() {
    // 排除通用"自定义翻译模型"，只展示具体源站/预设
    const baseModels = getSupportedModels().filter(m => m.group === 'translation' && m.key !== 'custom' && m.key !== 'deeplx');
    const models = [
      // Auto 选项：自动选择第一个可用模型
      { key: 'auto', name: '自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

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
    const models = [
      { key: 'auto', name: '自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

    // 从 supportedModelsForKeyManager 获取 image 分组的模型
    const imageModels = getSupportedModels().filter(m => m.group === 'image');
    imageModels.forEach(m => {
      // 检查是否有 Key（有则标记）
      const keys = typeof loadModelKeys === 'function' ? (loadModelKeys(m.key) || []) : [];
      const validKeys = keys.filter(k => k.status !== 'invalid' && k.value);
      models.push({ 
        key: m.key, 
        name: m.name + (validKeys.length ? ` (${validKeys.length} Key)` : ' (无 Key)'), 
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
    const models = [
      { key: 'auto', name: '自动选择 (推荐)', description: '自动使用第一个可用的模型' }
    ];

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
      || (modelKey !== 'auto' ? getDefaultModelId(modelKey) : '');

    setModelIdField(type, modelKey, existingId);
  }

  async function fetchAndPopulateModelIds(type, modelKey) {
    const controls = getModelIdElements(type);
    if (!controls.search || !modelKey) return;

    if (modelKey === 'auto') {
      alert('自动选择模式下无需探测模型 ID');
      return;
    }

    if (shouldUseManualModelId(type, modelKey)) {
      alert('该引擎模型 ID 请手动填写');
      populateModelIds(type, modelKey);
      return;
    }

    // 取第一个可用 Key
    let apiKey = '';
    if (typeof loadModelKeys === 'function') {
      const keys = loadModelKeys(modelKey) || [];
      const usable = keys.filter(k => k.status === 'valid' || k.status === 'untested');
      if (usable.length > 0) apiKey = usable[0].value;
    }
    if (!apiKey) {
      alert(`请先在主界面为 ${modelKey} 配置有效的 API Key`);
      return;
    }

    // 显示加载状态
    const originalPlaceholder = controls.search.placeholder;
    const originalBtnInner = controls.refresh.innerHTML;
    
    controls.search.placeholder = '正在获取模型列表...';
    controls.search.disabled = true;
    controls.refresh.disabled = true;
    controls.refresh.innerHTML = '<iconify-icon icon="line-md:loading-twotone-loop"></iconify-icon>';

    try {
      const ids = await fetchModelIdsByProvider(modelKey, apiKey);
      if (!ids || !ids.length) {
        // 探测失败时退回已保存/默认模型 ID
        populateModelIds(type, modelKey);
        controls.search.placeholder = '探测不到模型，请检查 Key 或网络';
      } else {
        // 更新缓存并显示 Dropdown
        modelIdCache[type] = ids;
        showModelDropdown(type, ids);
        
        // 如果当前没有值，选择第一个
        if (!controls.search.value) {
          controls.search.value = ids[0];
        }
        controls.search.placeholder = `已探测到 ${ids.length} 个模型`;
        console.log(`[PPT Model Config] 探测到 ${ids.length} 个模型:`, ids.slice(0, 5));
      }
    } catch (e) {
      console.error('[PPT] fetchAndPopulateModelIds error:', e);
      controls.search.placeholder = '探测失败，请检查配置';
    } finally {
      controls.search.disabled = false;
      controls.refresh.disabled = false;
      controls.refresh.innerHTML = originalBtnInner;
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

  Object.assign(ns.sources, {
    modelIdCache,
    tab1ModelsSession,
    getSupportedModels,
    getAllConfigurableModels,
    gatherLanguageSources,
    gatherImageSources,
    gatherVisionSources,
    fetchModelsForSource,
    fetchModelIdsByProvider,
    normalizeApiBaseUrl,
    resolveApiBaseUrlForSource,
    resolveFirstUsableApiKeyForSource,
    parseOpenAICompatibleModelIds,
    refreshSourceList,
    getModelIdElements,
    getModelIdValue,
    filterModelDropdown,
    populateModelIds,
    fetchAndPopulateModelIds
  });
})(typeof window !== 'undefined' ? window : this);
