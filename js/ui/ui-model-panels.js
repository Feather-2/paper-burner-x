// js/ui/ui-model-panels.js
// 提供各个模型信息面板的渲染逻辑与 DeepLX 辅助工具。
(function(global) {
    'use strict';

    const DEEPLX_DEFAULT_ENDPOINT_TEMPLATE = 'https://api.deeplx.org/<api-key>/translate';
    const DEEPLX_LANGUAGE_ORDER = ['BG','ZH','CS','DA','NL','EN','ET','FI','FR','DE','EL','HU','IT','JA','LV','LT','PL','PT','RO','RU'];
    const DEEPLX_FALLBACK_LANG_DISPLAY = {
        'BG': { zh: '保加利亚语', native: 'Български' },
        'ZH': { zh: '中文', native: '中文' },
        'CS': { zh: '捷克语', native: 'Česky' },
        'DA': { zh: '丹麦语', native: 'Dansk' },
        'NL': { zh: '荷兰语', native: 'Nederlands' },
        'EN': { zh: '英语', native: 'English' },
        'ET': { zh: '爱沙尼亚语', native: 'Eesti' },
        'FI': { zh: '芬兰语', native: 'Suomi' },
        'FR': { zh: '法语', native: 'Français' },
        'DE': { zh: '德语', native: 'Deutsch' },
        'EL': { zh: '希腊语', native: 'Ελληνικά' },
        'HU': { zh: '匈牙利语', native: 'Magyar' },
        'IT': { zh: '意大利语', native: 'Italiano' },
        'JA': { zh: '日语', native: '日本語' },
        'LV': { zh: '拉脱维亚语', native: 'Latviešu' },
        'LT': { zh: '立陶宛语', native: 'Lietuvių' },
        'PL': { zh: '波兰语', native: 'Polski' },
        'PT': { zh: '葡萄牙语', native: 'Português' },
        'RO': { zh: '罗马尼亚语', native: 'Română' },
        'RU': { zh: '俄语', native: 'Русский' }
    };

    if (typeof global !== 'undefined') {
        global.getDeeplxLangDisplay = function(code) {
            const displayMap = (typeof global.DEEPLX_LANG_DISPLAY === 'object' && global.DEEPLX_LANG_DISPLAY) || {};
            return displayMap[code] || DEEPLX_FALLBACK_LANG_DISPLAY[code] || null;
        };
    }

    function getDeeplxEndpointTemplate() {
        const cfg = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('deeplx') || {}) : {};
        if (cfg && typeof cfg.endpointTemplate === 'string' && cfg.endpointTemplate.trim()) {
            return cfg.endpointTemplate.trim();
        }
        if (cfg && typeof cfg.apiBaseUrlTemplate === 'string' && cfg.apiBaseUrlTemplate.trim()) {
            return cfg.apiBaseUrlTemplate.trim();
        }
        if (cfg && typeof cfg.apiBaseUrl === 'string' && cfg.apiBaseUrl.trim()) {
            const base = cfg.apiBaseUrl.trim();
            return base.endsWith('/') ? `${base}<api-key>/translate` : `${base}/<api-key>/translate`;
        }
        return DEEPLX_DEFAULT_ENDPOINT_TEMPLATE;
    }

    function setupDeeplxEndpointInput(inputEl, resetBtn) {
        if (!inputEl) return;
        const template = getDeeplxEndpointTemplate();
        inputEl.value = template;
        inputEl.placeholder = DEEPLX_DEFAULT_ENDPOINT_TEMPLATE;

        if (inputEl.dataset.bound === 'true') {
            return;
        }

        const saveTemplate = (value, notify = true) => {
            const sanitized = value && value.trim() ? value.trim() : DEEPLX_DEFAULT_ENDPOINT_TEMPLATE;
            if (typeof global.saveModelConfig === 'function') {
                const existing = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('deeplx') || {}) : {};
                global.saveModelConfig('deeplx', { ...existing, endpointTemplate: sanitized });
            }
            if (notify && typeof global.showNotification === 'function') {
                global.showNotification('DeepLX 接口模板已保存', 'success');
            }
            inputEl.value = sanitized;
        };

        inputEl.addEventListener('blur', () => saveTemplate(inputEl.value, true));
        inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                inputEl.blur();
            }
        });

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                inputEl.value = DEEPLX_DEFAULT_ENDPOINT_TEMPLATE;
                saveTemplate(DEEPLX_DEFAULT_ENDPOINT_TEMPLATE, true);
            });
        }

        inputEl.dataset.bound = 'true';
    }

    function renderGeminiInfoPanel() {
        const keys = typeof global.loadModelKeys === 'function' ? (global.loadModelKeys('gemini') || []) : [];
        const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        const keysHint = document.getElementById('geminiKeysCountHint');
        if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';

        const selectEl = document.getElementById('geminiModelSelect');
        const hintEl = document.getElementById('geminiModelHint');
        const searchBtn = document.getElementById('geminiModelSearchBtn');
        const cfg = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('gemini') || {}) : {};
        const preferred = cfg.preferredModelId || cfg.modelId || '';

        if (selectEl && selectEl.dataset.initialized !== 'true') {
            selectEl.innerHTML = '';
            if (preferred) {
                const opt = document.createElement('option');
                opt.value = preferred; opt.textContent = `${preferred}（当前）`;
                selectEl.appendChild(opt);
            } else {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '（未设置，点击检测获取列表）';
                selectEl.appendChild(opt);
            }
            selectEl.dataset.initialized = 'true';
        }

        if (selectEl) {
            selectEl.onchange = function() {
                const val = this.value;
                if (!val) return;
                if (typeof global.saveModelConfig === 'function') global.saveModelConfig('gemini', { preferredModelId: val });
                if (typeof global.showNotification === 'function') global.showNotification(`Gemini 默认模型已设为 ${val}`, 'success');
            };
            if (!global.getModelSearchCache('gemini').length) {
                global.setModelSearchCache('gemini', global.buildSearchItemsFromSelect(selectEl));
            }
        }

        global.registerModelSearchIntegration({
            key: 'gemini',
            selectEl,
            buttonEl: searchBtn,
            title: '选择 Gemini 模型',
            placeholder: '搜索模型 ID 或名称...',
            emptyMessage: '未找到匹配的 Gemini 模型',
            onEmpty: () => {
                const detectBtn = document.getElementById('geminiDetectBtn');
                if (detectBtn && !detectBtn.disabled) {
                    detectBtn.click();
                } else if (typeof global.showNotification === 'function') {
                    global.showNotification('请先检测可用模型', 'info');
                }
                return true;
            }
        });

        const detectBtn = document.getElementById('geminiDetectBtn');
        if (!detectBtn) return;

        detectBtn.onclick = async function() {
            if (usableKeys.length === 0) {
                if (typeof global.showNotification === 'function') global.showNotification('请先在“模型与Key管理”中添加 Gemini 的 API Key', 'warning');
                return;
            }
            detectBtn.disabled = true;
            detectBtn.textContent = '检测中...';
            try {
                const apiKey = usableKeys[0].value.trim();
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
                if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                const data = await resp.json();
                const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
                if (!selectEl) return;
                if (items.length === 0) {
                    selectEl.innerHTML = '<option value="">（未返回模型列表）</option>';
                    if (hintEl) hintEl.textContent = '未返回模型列表。';
                    global.setModelSearchCache('gemini', []);
                } else {
                    selectEl.innerHTML = '';
                    const seen = new Set();
                    const normalized = [];
                    items.forEach(m => {
                        const fullName = m && (m.name || m.id || '');
                        if (!fullName) return;
                        const id = fullName.includes('/') ? fullName.split('/').pop() : fullName;
                        if (!id || seen.has(id)) return;
                        seen.add(id);
                        const display = m.displayName && m.displayName !== id ? m.displayName : '';
                        const description = display || m.description || '';
                        normalized.push({ value: id, label: id, description });
                        const opt = document.createElement('option');
                        opt.value = id;
                        opt.textContent = id;
                        if (preferred && id === preferred) opt.selected = true;
                        selectEl.appendChild(opt);
                    });
                    if (preferred && !seen.has(preferred)) {
                        const opt = document.createElement('option');
                        opt.value = preferred;
                        opt.textContent = `${preferred}（当前）`;
                        opt.selected = true;
                        selectEl.insertBefore(opt, selectEl.firstChild);
                        normalized.unshift({ value: preferred, label: preferred, description: '' });
                    }

                    global.setModelSearchCache('gemini', normalized);

                    if (hintEl) hintEl.textContent = '从列表中选择默认模型。';
                }
            } catch (e) {
                console.error(e);
                if (hintEl) hintEl.textContent = `检测失败：${e.message}`;
                global.setModelSearchCache('gemini', []);
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '检测可用模型';
            }
        };
    }

    function renderDeepseekInfoPanel() {
        const keys = typeof global.loadModelKeys === 'function' ? (global.loadModelKeys('deepseek') || []) : [];
        const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        const keysHint = document.getElementById('deepseekKeysCountHint');
        if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
        const selectEl = document.getElementById('deepseekModelSelect');
        const hintEl = document.getElementById('deepseekModelHint');
        const searchBtn = document.getElementById('deepseekModelSearchBtn');
        const cfg = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('deepseek') || {}) : {};
        const preferred = cfg.preferredModelId || cfg.modelId || '';
        if (selectEl && selectEl.options.length === 0) {
            const opt = document.createElement('option');
            opt.value = preferred;
            opt.textContent = preferred ? `${preferred}（当前）` : '（未设置，点击检测获取列表）';
            selectEl.appendChild(opt);
        }
        if (selectEl) {
            selectEl.onchange = function(){
                if (!this.value) return;
                if (typeof global.saveModelConfig === 'function') global.saveModelConfig('deepseek', { preferredModelId: this.value });
                if (typeof global.showNotification === 'function') global.showNotification(`DeepSeek 默认模型已设为 ${this.value}`, 'success');
            };
            if (!global.getModelSearchCache('deepseek').length) {
                global.setModelSearchCache('deepseek', global.buildSearchItemsFromSelect(selectEl));
            }
        }

        global.registerModelSearchIntegration({
            key: 'deepseek',
            selectEl,
            buttonEl: searchBtn,
            title: '选择 DeepSeek 模型',
            placeholder: '搜索模型 ID...',
            emptyMessage: '未找到匹配的 DeepSeek 模型',
            onEmpty: () => {
                const detectBtn = document.getElementById('deepseekDetectBtn');
                if (detectBtn && !detectBtn.disabled) {
                    detectBtn.click();
                } else if (typeof global.showNotification === 'function') {
                    global.showNotification('请先检测可用模型', 'info');
                }
                return true;
            }
        });

        const detectBtn = document.getElementById('deepseekDetectBtn');
        if (!detectBtn) return;

        detectBtn.onclick = async function(){
            if (usableKeys.length === 0) {
                if (typeof global.showNotification === 'function') global.showNotification('请先在Key管理中添加 DeepSeek Key','warning');
                return;
            }
            detectBtn.disabled = true;
            detectBtn.textContent = '检测中...';
            try {
                const apiKey = usableKeys[0].value.trim();
                const resp = await fetch('https://api.deepseek.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
                if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                const data = await resp.json();
                const items = Array.isArray(data.data) ? data.data : [];
                if (items.length === 0) {
                    if (hintEl) hintEl.textContent = '未返回模型列表';
                    if (selectEl) selectEl.innerHTML = '<option value="">（未返回模型列表）</option>';
                    global.setModelSearchCache('deepseek', []);
                    return;
                }
                if (selectEl) {
                    selectEl.innerHTML='';
                }
                const normalized = [];
                items.forEach(m => {
                    const id = m.id;
                    if (!id) return;
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    if (preferred && id === preferred) opt.selected = true;
                    if (selectEl) selectEl.appendChild(opt);
                    normalized.push({ value: id, label: id });
                });
                if (preferred && !normalized.some(item => item.value === preferred)) {
                    const opt = document.createElement('option');
                    opt.value = preferred;
                    opt.textContent = `${preferred}（当前）`;
                    opt.selected = true;
                    if (selectEl) selectEl.insertBefore(opt, selectEl.firstChild);
                    normalized.unshift({ value: preferred, label: preferred });
                }
                global.setModelSearchCache('deepseek', normalized);
                if (hintEl) hintEl.textContent = '从列表中选择默认模型。';
            } catch (e) {
                if (hintEl) hintEl.textContent = `检测失败：${e.message}`;
                global.setModelSearchCache('deepseek', []);
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '检测可用模型';
            }
        };
    }

    function renderDeeplxInfoPanel() {
        const keys = typeof global.loadModelKeys === 'function' ? (global.loadModelKeys('deeplx') || []) : [];
        const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        const keysHint = document.getElementById('deeplxKeysCountHint');
        if (keysHint) {
            keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
        }
        const inputEl = document.getElementById('deeplxEndpointTemplateInput');
        const resetBtn = document.getElementById('deeplxEndpointResetBtn');
        setupDeeplxEndpointInput(inputEl, resetBtn);

        const tableEl = document.getElementById('deeplxLangTable');
        if (tableEl && tableEl.dataset.initialized !== 'true') {
            const rows = DEEPLX_LANGUAGE_ORDER.map(function(code) {
                const info = (typeof global.getDeeplxLangDisplay === 'function')
                    ? global.getDeeplxLangDisplay(code)
                    : (global.DEEPLX_LANG_DISPLAY && global.DEEPLX_LANG_DISPLAY[code]) || DEEPLX_FALLBACK_LANG_DISPLAY[code] || {};
                const zhName = info.zh || '--';
                const nativeName = info.native || '';
                return `<li class="py-0.5 flex justify-between"><code>${code}</code><span class="flex-1 px-2 text-left">${zhName}</span><span>${nativeName}</span></li>`;
            }).join('');
            tableEl.innerHTML = `
            <details class="bg-slate-100 border border-slate-200 rounded-md px-3 py-2">
                <summary class="cursor-pointer text-sm text-slate-700 select-none">常用语言代码对照（点击展开）</summary>
                <ul class="mt-2 text-xs text-slate-700 space-y-1">${rows}</ul>
            </details>`;
            tableEl.dataset.initialized = 'true';
        }

        if (typeof global.updateDeeplxTargetLangHint === 'function') {
            global.updateDeeplxTargetLangHint();
        }
    }

    function renderTongyiInfoPanel() {
        let keys = [];
        if (typeof global.loadModelKeys === 'function') {
            keys = global.loadModelKeys('tongyi') || [];
        }
        const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        const keysHint = document.getElementById('tongyiKeysCountHint');
        if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
        const selectEl = document.getElementById('tongyiModelSelect');
        const hintEl = document.getElementById('tongyiModelHint');
        const searchBtn = document.getElementById('tongyiModelSearchBtn');
        const cfg = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('tongyi') || {}) : {};
        const preferred = cfg.preferredModelId || cfg.modelId || '';
        if (selectEl && selectEl.options.length === 0) {
            const opt = document.createElement('option');
            opt.value = preferred;
            opt.textContent = preferred ? `${preferred}（当前）` : '（未设置，请手动输入或在设置中选择）';
            selectEl.appendChild(opt);
        }
        if (selectEl) {
            selectEl.onchange = function(){
                if (!this.value) return;
                if (typeof global.saveModelConfig === 'function') global.saveModelConfig('tongyi', { preferredModelId: this.value });
                if (typeof global.showNotification === 'function') global.showNotification(`通义 默认模型已设为 ${this.value}`, 'success');
            };
            if (!global.getModelSearchCache('tongyi').length) {
                global.setModelSearchCache('tongyi', global.buildSearchItemsFromSelect(selectEl));
            }
        }

        global.registerModelSearchIntegration({
            key: 'tongyi',
            selectEl,
            buttonEl: searchBtn,
            title: '选择通义模型',
            placeholder: '搜索模型 ID...',
            emptyMessage: '未找到匹配的通义模型',
            onEmpty: () => {
                const detectBtn = document.getElementById('tongyiDetectBtn');
                if (detectBtn && !detectBtn.disabled) {
                    detectBtn.click();
                } else if (typeof global.showNotification === 'function') {
                    global.showNotification('请先检测可用模型', 'info');
                }
                return true;
            }
        });

        const detectBtn = document.getElementById('tongyiDetectBtn');
        if (!detectBtn) return;

        detectBtn.onclick = async function(){
            if (usableKeys.length === 0) {
                if (typeof global.showNotification === 'function') global.showNotification('请先在Key管理中添加 通义 Key','warning');
                return;
            }
            detectBtn.disabled = true;
            detectBtn.textContent='检测中...';
            try {
                const apiKey = usableKeys[0].value.trim();
                const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
                if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                const data = await resp.json();
                const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
                if (!items || items.length === 0) {
                    if (hintEl) hintEl.textContent = '未返回模型列表';
                    if (selectEl) selectEl.innerHTML = '<option value="">（未返回模型列表）</option>';
                    global.setModelSearchCache('tongyi', []);
                    return;
                }
                if (selectEl) selectEl.innerHTML = '';
                const normalized = [];
                items.forEach(m => {
                    const id = m.model || m.id || m.name;
                    if (!id) return;
                    const opt = document.createElement('option');
                    opt.value = id;
                    opt.textContent = id;
                    if (preferred && id === preferred) opt.selected = true;
                    if (selectEl) selectEl.appendChild(opt);
                    normalized.push({ value: id, label: id });
                });
                if (preferred && !normalized.some(item => item.value === preferred)) {
                    const opt = document.createElement('option');
                    opt.value = preferred;
                    opt.textContent = `${preferred}（当前）`;
                    opt.selected = true;
                    if (selectEl) selectEl.insertBefore(opt, selectEl.firstChild);
                    normalized.unshift({ value: preferred, label: preferred });
                }
                global.setModelSearchCache('tongyi', normalized);
                if (hintEl) hintEl.textContent = '从列表中选择默认模型。';
            } catch (e) {
                if (hintEl) hintEl.textContent = `检测失败：${e.message}`;
                global.setModelSearchCache('tongyi', []);
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '检测可用模型';
            }
        };
    }

    function renderVolcanoInfoPanel() {
        let keys = [];
        if (typeof global.loadModelKeys === 'function') {
            keys = global.loadModelKeys('volcano') || [];
        }
        const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
        const keysHint = document.getElementById('volcanoKeysCountHint');
        if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
        const selectEl = document.getElementById('volcanoModelSelect');
        const hintEl = document.getElementById('volcanoModelHint');
        const cfg = typeof global.loadModelConfig === 'function' ? (global.loadModelConfig('volcano') || {}) : {};
        const preferred = cfg.preferredModelId || cfg.modelId || '';
        if (selectEl) {
            const seenValues = new Set();
            Array.from(selectEl.options).forEach(opt => {
                const key = opt.value || '__empty__';
                if (seenValues.has(key) && key !== '__empty__') {
                    opt.remove();
                } else {
                    seenValues.add(key);
                }
            });

            if (selectEl.options.length === 0) {
                const opt = document.createElement('option');
                opt.value = preferred;
                opt.textContent = preferred ? `${preferred}（当前）` : '（未设置，请手动输入或在设置中选择）';
                selectEl.appendChild(opt);
            }

            selectEl.onchange = function(){
                if (!this.value) return;
                if (typeof global.saveModelConfig === 'function') {
                    global.saveModelConfig('volcano', { preferredModelId: this.value });
                }
                Array.from(selectEl.options).forEach(opt => {
                    if (opt.value === this.value) {
                        opt.textContent = `${opt.value}（当前）`;
                    } else if (opt.value) {
                        opt.textContent = opt.value;
                    } else {
                        opt.textContent = '（未设置，请手动输入或在设置中选择）';
                    }
                });
                if (typeof global.showNotification === 'function') {
                    global.showNotification(`火山 默认模型已设为 ${this.value}`, 'success');
                }
                global.setModelSearchCache('volcano', global.buildSearchItemsFromSelect(selectEl));
            };
        }
        const detectBtn = document.getElementById('volcanoDetectBtn');
        if (detectBtn) {
            detectBtn.style.display = 'none';
            if (hintEl) hintEl.textContent = '请手动输入模型ID，或在设置中选择。';
        }

        if (selectEl) {
            const parent = selectEl.parentElement;
            if (parent) {
                const legacyInputs = parent.querySelectorAll('#volcanoManualInput');
                legacyInputs.forEach((inputEl, idx) => {
                    const wrap = inputEl.closest('.pbx-volcano-manual-wrap') || inputEl.parentElement;
                    if (idx === 0) {
                        if (wrap) wrap.classList.add('pbx-volcano-manual-wrap');
                    } else if (wrap) {
                        wrap.remove();
                    } else {
                        inputEl.remove();
                    }
                });

                let manualWrap = parent.querySelector('.pbx-volcano-manual-wrap');
                if (!manualWrap) {
                    manualWrap = document.createElement('div');
                    manualWrap.className = 'mt-2 flex flex-col sm:flex-row sm:items-center gap-2 pbx-volcano-manual-wrap';

                    const inputEl = document.createElement('input');
                    inputEl.id = 'volcanoManualInput';
                    inputEl.type = 'text';
                    inputEl.placeholder = '例如：doubao-1-5-pro-32k-250115';
                    inputEl.className = 'w-full sm:flex-grow px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

                    const saveBtn = document.createElement('button');
                    saveBtn.id = 'volcanoSaveModelBtn';
                    saveBtn.className = 'px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors';
                    saveBtn.textContent = '保存为默认';

                    manualWrap.appendChild(inputEl);
                    manualWrap.appendChild(saveBtn);
                    parent.appendChild(manualWrap);
                }

                const inputEl = manualWrap.querySelector('#volcanoManualInput');
                const saveBtn = manualWrap.querySelector('#volcanoSaveModelBtn');
                if (inputEl) inputEl.value = preferred || '';
                if (saveBtn && inputEl) {
                    saveBtn.onclick = function() {
                        const val = (inputEl.value || '').trim();
                        if (!val) {
                            if (typeof global.showNotification === 'function') global.showNotification('请输入模型ID', 'warning');
                            return;
                        }

                        if (typeof global.saveModelConfig === 'function') {
                            global.saveModelConfig('volcano', { preferredModelId: val });
                        }

                        let matchedOption = Array.from(selectEl.options).find(opt => opt.value === val);
                        if (!matchedOption) {
                            matchedOption = document.createElement('option');
                            matchedOption.value = val;
                            selectEl.appendChild(matchedOption);
                        }

                        Array.from(selectEl.options).forEach(opt => {
                            if (opt.value === val) {
                                opt.textContent = `${val}（当前）`;
                            } else if (opt.value) {
                                opt.textContent = opt.value;
                            } else {
                                opt.textContent = '（未设置，请手动输入或在设置中选择）';
                            }
                        });
                        selectEl.value = val;
                        if (typeof global.showNotification === 'function') global.showNotification(`火山 默认模型已设为 ${val}`, 'success');
                    };
                }
            }
        }
    }

    global.DEEPLX_DEFAULT_ENDPOINT_TEMPLATE = DEEPLX_DEFAULT_ENDPOINT_TEMPLATE;
    global.getDeeplxEndpointTemplate = getDeeplxEndpointTemplate;
    global.setupDeeplxEndpointInput = setupDeeplxEndpointInput;
    global.renderGeminiInfoPanel = renderGeminiInfoPanel;
    global.renderDeepseekInfoPanel = renderDeepseekInfoPanel;
    global.renderDeeplxInfoPanel = renderDeeplxInfoPanel;
    global.renderTongyiInfoPanel = renderTongyiInfoPanel;
    global.renderVolcanoInfoPanel = renderVolcanoInfoPanel;
})(window);
