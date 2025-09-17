// js/ui.js

// =====================
// UI 相关操作与交互函数
// =====================

// ---------------------
// Helper Functions (NEW)
// ---------------------
/**
 * 生成一个简单的客户端 UUID (Universally Unique Identifier) v4 版本。
 * 此函数主要用于在 UI 层面为动态生成的元素或组件提供一个唯一的标识符，
 * 它**不具备加密安全性**，不应用于任何安全相关的场景。
 *
 * @returns {string} 返回一个符合 UUID v4 格式的字符串。
 */
function _generateUUID_ui() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
}

// Gemini 模型信息区（检测与默认模型选择）
function renderGeminiInfoPanel() {
    const keys = typeof loadModelKeys === 'function' ? (loadModelKeys('gemini') || []) : [];
    const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
    const keysHint = document.getElementById('geminiKeysCountHint');
    if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';

    const selectEl = document.getElementById('geminiModelSelect');
    const hintEl = document.getElementById('geminiModelHint');
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('gemini') || {}) : {};
    const preferred = cfg.preferredModelId || cfg.modelId || '';

    if (selectEl && selectEl.dataset.initialized !== 'true') {
        // 初始填充一个条目用于展示当前默认
        selectEl.innerHTML = '';
        if (preferred) {
            const opt = document.createElement('option');
            opt.value = preferred; opt.textContent = preferred + '（当前）';
            selectEl.appendChild(opt);
        } else {
            const opt = document.createElement('option');
            opt.value = ''; opt.textContent = '（未设置，点击检测获取列表）';
            selectEl.appendChild(opt);
        }
        selectEl.dataset.initialized = 'true';
    }

    if (selectEl) {
        selectEl.onchange = function() {
            const val = this.value;
            if (val) {
                if (typeof saveModelConfig === 'function') saveModelConfig('gemini', { preferredModelId: val });
                if (typeof showNotification === 'function') showNotification(`Gemini 默认模型已设为 ${val}`, 'success');
            }
        };
    }

    const detectBtn = document.getElementById('geminiDetectBtn');
    if (detectBtn) {
        detectBtn.onclick = async function() {
            if (usableKeys.length === 0) {
                if (typeof showNotification === 'function') showNotification('请先在“模型与Key管理”中添加 Gemini 的 API Key', 'warning');
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
                } else {
                    selectEl.innerHTML = '';
                    items.forEach(m => {
                        const id = m.name ? String(m.name).split('/').pop() : (m.id || '');
                        if (!id) return;
                        const opt = document.createElement('option');
                        opt.value = id; opt.textContent = id;
                        if (preferred && id === preferred) opt.selected = true;
                        selectEl.appendChild(opt);
                    });
                    if (hintEl) hintEl.textContent = '从列表中选择默认模型。';
                }
            } catch (e) {
                console.error(e);
                if (hintEl) hintEl.textContent = `检测失败：${e.message}`;
            } finally {
                detectBtn.disabled = false;
                detectBtn.textContent = '检测可用模型';
            }
        };
    }
}

// DeepSeek 面板
function renderDeepseekInfoPanel() {
    const keys = typeof loadModelKeys === 'function' ? (loadModelKeys('deepseek') || []) : [];
    const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
    const keysHint = document.getElementById('deepseekKeysCountHint');
    if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
    const selectEl = document.getElementById('deepseekModelSelect');
    const hintEl = document.getElementById('deepseekModelHint');
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('deepseek') || {}) : {};
    const preferred = cfg.preferredModelId || cfg.modelId || '';
    if (selectEl && selectEl.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = preferred; opt.textContent = preferred ? preferred + '（当前）' : '（未设置，点击检测获取列表）';
        selectEl.appendChild(opt);
    }
    selectEl.onchange = function(){
        if (!this.value) return;
        if (typeof saveModelConfig === 'function') saveModelConfig('deepseek', { preferredModelId: this.value });
        if (typeof showNotification === 'function') showNotification(`DeepSeek 默认模型已设为 ${this.value}`, 'success');
    };
    const detectBtn = document.getElementById('deepseekDetectBtn');
    if (detectBtn) detectBtn.onclick = async function(){
        if (usableKeys.length === 0) { showNotification && showNotification('请先在Key管理中添加 DeepSeek Key','warning'); return; }
        detectBtn.disabled = true; detectBtn.textContent = '检测中...';
        try{
            const apiKey = usableKeys[0].value.trim();
            const resp = await fetch('https://api.deepseek.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
            if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
            const data = await resp.json();
            const items = Array.isArray(data.data) ? data.data : [];
            if (items.length === 0) { if (hintEl) hintEl.textContent='未返回模型列表'; selectEl.innerHTML='<option value="">（未返回模型列表）</option>'; return; }
            selectEl.innerHTML='';
            items.forEach(m=>{ const id = m.id; if (!id) return; const opt=document.createElement('option'); opt.value=id; opt.textContent=id; if (preferred && id===preferred) opt.selected=true; selectEl.appendChild(opt); });
            if (hintEl) hintEl.textContent='从列表中选择默认模型。';
        }catch(e){ if (hintEl) hintEl.textContent=`检测失败：${e.message}`; }
        finally{ detectBtn.disabled=false; detectBtn.textContent='检测可用模型'; }
    };
}

// 通义 面板
function renderTongyiInfoPanel() {
    // 聚合两个通义条目的 Key
    let keys = [];
    if (typeof loadModelKeys === 'function') {
        keys = loadModelKeys('tongyi') || [];
    }
    const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
    const keysHint = document.getElementById('tongyiKeysCountHint');
    if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
    const selectEl = document.getElementById('tongyiModelSelect');
    const hintEl = document.getElementById('tongyiModelHint');
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('tongyi') || {}) : {};
    const preferred = cfg.preferredModelId || cfg.modelId || '';
    if (selectEl && selectEl.options.length === 0) {
        const opt = document.createElement('option');
        opt.value = preferred; opt.textContent = preferred ? preferred + '（当前）' : '（未设置，请手动输入或在设置中选择）';
        selectEl.appendChild(opt);
    }
    selectEl.onchange = function(){ if (!this.value) return; saveModelConfig && saveModelConfig('tongyi', { preferredModelId: this.value }); showNotification && showNotification(`通义 默认模型已设为 ${this.value}`, 'success'); };
    const detectBtn = document.getElementById('tongyiDetectBtn');
    if (detectBtn) detectBtn.onclick = async function(){
        if (usableKeys.length === 0) { showNotification && showNotification('请先在Key管理中添加 通义 Key','warning'); return; }
        detectBtn.disabled = true; detectBtn.textContent='检测中...';
        try{
            const apiKey = usableKeys[0].value.trim();
            // 使用 OpenAI 兼容模式的模型列表端点（用户指定）
            const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
            if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
            const data = await resp.json();
            const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
            if (!items || items.length===0) { if(hintEl) hintEl.textContent='未返回模型列表'; selectEl.innerHTML='<option value="">（未返回模型列表）</option>'; return; }
            selectEl.innerHTML='';
            items.forEach(m=>{ const id = m.model || m.id || m.name; if (!id) return; const opt=document.createElement('option'); opt.value=id; opt.textContent=id; if (preferred && id===preferred) opt.selected=true; selectEl.appendChild(opt); });
            if (hintEl) hintEl.textContent='从列表中选择默认模型。';
        }catch(e){ if(hintEl) hintEl.textContent=`检测失败：${e.message}`; }
        finally{ detectBtn.disabled=false; detectBtn.textContent='检测可用模型'; }
    };
}

// 火山 面板
function renderVolcanoInfoPanel() {
    let keys = [];
    if (typeof loadModelKeys === 'function') {
        keys = loadModelKeys('volcano') || [];
    }
    const usableKeys = keys.filter(k => k.status !== 'invalid' && k.value);
    const keysHint = document.getElementById('volcanoKeysCountHint');
    if (keysHint) keysHint.textContent = usableKeys.length > 0 ? `可用Key: ${usableKeys.length}` : '无可用 Key';
    const selectEl = document.getElementById('volcanoModelSelect');
    const hintEl = document.getElementById('volcanoModelHint');
    const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('volcano') || {}) : {};
    const preferred = cfg.preferredModelId || cfg.modelId || '';
    if (selectEl) {
        // 移除下拉选项中的重复值，避免渲染多个相同模型
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
            if (typeof saveModelConfig === 'function') {
                saveModelConfig('volcano', { preferredModelId: this.value });
            }
            // 更新选项文案，确保仅当前项带“（当前）”标记
            Array.from(selectEl.options).forEach(opt => {
                if (opt.value === this.value) {
                    opt.textContent = `${opt.value}（当前）`;
                } else if (opt.value) {
                    opt.textContent = opt.value;
                } else {
                    opt.textContent = '（未设置，请手动输入或在设置中选择）';
                }
            });
            showNotification && showNotification(`火山 默认模型已设为 ${this.value}`, 'success');
        };
    }
    const detectBtn = document.getElementById('volcanoDetectBtn');
    if (detectBtn) {
        // 按用户要求：不提供在线检测，改为手动填写
        detectBtn.style.display = 'none';
        if (hintEl) hintEl.textContent = '请手动输入模型ID，或在设置中选择。';
    }

    // 手动输入模型ID支持
    if (selectEl) {
        const parent = selectEl.parentElement;
        if (parent) {
            // 清理旧版重复的输入区，仅保留第一个
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
                manualWrap.className = 'mt-2 flex items-center gap-2 pbx-volcano-manual-wrap';

                const inputEl = document.createElement('input');
                inputEl.id = 'volcanoManualInput';
                inputEl.type = 'text';
                inputEl.placeholder = '例如：doubao-1-5-pro-32k-250115';
                inputEl.className = 'flex-grow px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

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
                    if (!val) { showNotification && showNotification('请输入模型ID', 'warning'); return; }

                    if (typeof saveModelConfig === 'function') {
                        saveModelConfig('volcano', { preferredModelId: val });
                    }

                    let matchedOption = Array.from(selectEl.options).find(opt => opt.value === val);
                    if (!matchedOption) {
                        matchedOption = document.createElement('option');
                        matchedOption.value = val;
                        selectEl.appendChild(matchedOption);
                    }

                    // 更新下拉选项文案，保持唯一且带“（当前）”标记
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
                    showNotification && showNotification(`火山 默认模型已设为 ${val}`, 'success');
                };
            }
        }
    }
}

// ---------------------
// 表单元素创建工具 (NEW - for renderSourceSiteForm)
// ---------------------
/**
 * 创建并返回一个包含标签（label）和输入框（input）的完整配置项组件。
 * 该组件通常用于动态生成的表单中，用于收集用户输入。
 *
 * @param {string} id - 输入框元素的 HTML `id` 属性，同时用于标签的 `for` 属性。
 * @param {string} labelText - 显示在输入框上方的标签文本内容。
 * @param {string|number} value - 输入框的初始值。
 * @param {string} [type='text'] - 输入框的类型 (例如：`text`, `url`, `number`, `password`)。
 * @param {string} [placeholder=''] - 输入框的占位提示文本。
 * @param {function} [onChangeCallback] - (可选) 当输入框的值发生改变 (通常是 `change` 或 `input` 事件) 时被调用的回调函数。
 * @param {Object} [attributes={}] - (可选) 一个包含额外 HTML 属性的对象，这些属性将被直接设置到输入框元素上。
 *                                   对于 `type='number'`，可以包含 `min`, `max`, `step`。
 * @returns {HTMLElement} 返回一个 `div` 元素，该元素包装了创建的标签和输入框。
 */
function createConfigInput(id, labelText, value, type = 'text', placeholder = '', onChangeCallback, attributes = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3'; // Add some margin for spacing

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.name = id;
    input.value = value;
    input.placeholder = placeholder;
    input.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    if (type === 'number') {
        if (attributes.min !== undefined) input.min = attributes.min;
        if (attributes.max !== undefined) input.max = attributes.max;
        if (attributes.step !== undefined) input.step = attributes.step;
    }
    for (const key in attributes) {
        if (key !== 'min' && key !== 'max' && key !== 'step') { // Avoid re-setting handled attributes
            input.setAttribute(key, attributes[key]);
        }
    }

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        input.addEventListener('change', onChangeCallback);
        input.addEventListener('input', onChangeCallback); // For more responsive updates if needed
    }

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
}

/**
 * 创建并返回一个包含标签（label）和下拉选择框（select）的完整配置项组件。
 * 该组件用于提供一组预定义的选项供用户选择。
 *
 * @param {string} id - 下拉选择框元素的 HTML `id` 属性，同时用于标签的 `for` 属性。
 * @param {string} labelText - 显示在下拉选择框上方的标签文本内容。
 * @param {string} selectedValue - 需要被预选中的选项的值。
 * @param {Array<Object>} optionsArray - 一个对象数组，用于生成下拉选项。每个对象应包含：
 *   @param {string} optionsArray[].value - 选项的实际值。
 *   @param {string} optionsArray[].text - 选项的显示文本。
 * @param {function} [onChangeCallback] - (可选) 当下拉选择框的值发生改变时被调用的回调函数。
 * @returns {HTMLElement} 返回一个 `div` 元素，该元素包装了创建的标签和下拉选择框。
 */
function createConfigSelect(id, labelText, selectedValue, optionsArray, onChangeCallback) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const select = document.createElement('select');
    select.id = id;
    select.name = id;
    select.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    optionsArray.forEach(opt => {
        const optionElement = document.createElement('option');
        optionElement.value = opt.value;
        optionElement.textContent = opt.text;
        if (opt.value === selectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        select.addEventListener('change', onChangeCallback);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
}

// ---------------------
// DOM 元素获取（集中管理，便于维护）
// ---------------------
/** @type {HTMLTextAreaElement | null} mistralApiKeysTextarea - Mistral API 密钥输入框。 */
const mistralApiKeysTextarea = document.getElementById('mistralApiKeys');
/** @type {HTMLInputElement | null} rememberMistralKeyCheckbox - "记住 Mistral 密钥"复选框。 */
const rememberMistralKeyCheckbox = document.getElementById('rememberMistralKey');
/** @type {HTMLTextAreaElement | null} translationApiKeysTextarea - (通用)翻译服务 API 密钥输入框。 */
const translationApiKeysTextarea = document.getElementById('translationApiKeys');
/** @type {HTMLInputElement | null} rememberTranslationKeyCheckbox - "记住翻译密钥"复选框。 */
const rememberTranslationKeyCheckbox = document.getElementById('rememberTranslationKey');
/** @type {HTMLSelectElement | null} translationModelSelect - 翻译模型选择下拉框。 */
const translationModelSelect = document.getElementById('translationModel');
/** @type {HTMLElement | null} customModelSettingsContainer - (旧版)自定义模型设置区域的容器。 */
const customModelSettingsContainer = document.getElementById('customModelSettingsContainer');
/** @type {HTMLElement | null} customModelSettings - (旧版)自定义模型具体设置的容器。 */
const customModelSettings = document.getElementById('customModelSettings');
/** @type {HTMLElement | null} advancedSettingsToggle - 高级设置区域的切换按钮。 */
const advancedSettingsToggle = document.getElementById('advancedSettingsToggle');
/** @type {HTMLElement | null} advancedSettings - 高级设置区域的容器。 */
const advancedSettings = document.getElementById('advancedSettings');
/** @type {HTMLElement | null} advancedSettingsIcon - 高级设置切换按钮中的图标。 */
const advancedSettingsIcon = document.getElementById('advancedSettingsIcon');
/** @type {HTMLInputElement | null} maxTokensPerChunk - 每个文本块最大 Token 数的滑块输入。 */
const maxTokensPerChunk = document.getElementById('maxTokensPerChunk');
/** @type {HTMLElement | null} maxTokensPerChunkValue - 显示当前最大 Token 数的元素。 */
const maxTokensPerChunkValue = document.getElementById('maxTokensPerChunkValue');
/** @type {HTMLInputElement | null} skipProcessedFilesCheckbox - "跳过已处理文件"复选框。 */
const skipProcessedFilesCheckbox = document.getElementById('skipProcessedFiles');
/** @type {HTMLInputElement | null} concurrencyLevelInput - (OCR/通用)并发级别输入框。 */
const concurrencyLevelInput = document.getElementById('concurrencyLevel');
/** @type {HTMLElement | null} dropZone - 文件拖放区域。 */
const dropZone = document.getElementById('dropZone');
/** @type {HTMLInputElement | null} pdfFileInput - 文件选择输入框 (type="file")。 */
const pdfFileInput = document.getElementById('pdfFileInput');
/** @type {HTMLButtonElement | null} browseFilesBtn - "浏览文件"按钮。 */
const browseFilesBtn = document.getElementById('browseFilesBtn');
/** @type {HTMLElement | null} fileListContainer - 文件列表的容器。 */
const fileListContainer = document.getElementById('fileListContainer');
/** @type {HTMLElement | null} fileList - 文件列表的 UL 或 OL 元素。 */
const fileList = document.getElementById('fileList');
/** @type {HTMLButtonElement | null} clearFilesBtn - "清空文件列表"按钮。 */
const clearFilesBtn = document.getElementById('clearFilesBtn');
/** @type {HTMLSelectElement | null} targetLanguage - 目标语言选择下拉框。 */
const targetLanguage = document.getElementById('targetLanguage');
/** @type {HTMLButtonElement | null} processBtn - "开始处理"按钮。 */
const processBtn = document.getElementById('processBtn');
/** @type {HTMLButtonElement | null} downloadAllBtn - "全部下载"按钮。 */
const downloadAllBtn = document.getElementById('downloadAllBtn');
/** @type {HTMLElement | null} resultsSection - 处理结果显示区域。 */
const resultsSection = document.getElementById('resultsSection');
/** @type {HTMLElement | null} resultsSummary - 处理结果总结信息的容器。 */
const resultsSummary = document.getElementById('resultsSummary');
/** @type {HTMLElement | null} progressSection - 进度显示区域。 */
const progressSection = document.getElementById('progressSection');
/** @type {HTMLElement | null} batchProgressText - 批处理整体进度文本显示元素。 */
const batchProgressText = document.getElementById('batchProgressText');
/** @type {HTMLElement | null} concurrentProgressText - 当前并发任务数文本显示元素。 */
const concurrentProgressText = document.getElementById('concurrentProgressText');
/** @type {HTMLElement | null} progressStep - 当前处理步骤文本显示元素。 */
const progressStep = document.getElementById('progressStep');
/** @type {HTMLElement | null} progressPercentage - 进度百分比文本显示元素。 */
const progressPercentage = document.getElementById('progressPercentage');
/** @type {HTMLElement | null} progressBar - 进度条的内部填充元素。 */
const progressBar = document.getElementById('progressBar');
/** @type {HTMLElement | null} progressLog - 详细进度日志的容器。 */
const progressLog = document.getElementById('progressLog');
/** @type {HTMLElement | null} notificationContainer - 通知消息的容器。 */
const notificationContainer = document.getElementById('notification-container');
/** @type {HTMLElement | null} customModelSettingsToggle - (旧版)自定义模型设置的切换按钮。 */
const customModelSettingsToggle = document.getElementById('customModelSettingsToggle');
/** @type {HTMLElement | null} customModelSettingsToggleIcon - (旧版)自定义模型设置切换按钮中的图标。 */
const customModelSettingsToggleIcon = document.getElementById('customModelSettingsToggleIcon');
/** @type {HTMLElement | null} customSourceSiteContainer - 自定义API源站点选择区域的容器。 */
const customSourceSiteContainer = document.getElementById('customSourceSiteContainer');
/** @type {HTMLSelectElement | null} customSourceSiteSelect - 自定义API源站点选择下拉框。 */
const customSourceSiteSelect = document.getElementById('customSourceSiteSelect');
/** @type {HTMLElement | null} customSourceSiteToggleIcon - 自定义源站点设置区域切换按钮的图标 (可能与高级设置共用或独立)。 */
const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon'); // 注意：此ID可能与 advancedSettingsIcon 描述冲突，需确认实际HTML结构
/** @type {HTMLButtonElement | null} detectModelsBtn - "检测可用模型"按钮，通常用于自定义源站点。 */
const detectModelsBtn = document.getElementById('detectModelsBtn');

// ---------------------
// 自定义源站点下拉列表填充 (NEW)
// ---------------------
/**
 * 从 `storage.js` 加载所有已配置的自定义 API 源站点，并使用它们填充 ID 为 `customSourceSiteSelect` 的下拉选择框。
 *
 * 主要逻辑:
 * 1. 获取下拉框 DOM 元素，如果找不到则警告并退出。
 * 2. 清空下拉框的现有选项。
 * 3. 调用 `loadAllCustomSourceSites` (应由 `storage.js` 提供并全局可用) 获取所有源站点配置。
 *    如果加载函数不可用，则显示错误选项并禁用下拉框。
 * 4. **预选中处理**: 如果未明确传入 `selectedSiteIdToSet`，则尝试从用户设置 (`loadSettings`) 中读取 `selectedCustomSourceSiteId` 作为预选项。
 * 5. **选项填充**: 如果没有源站点，显示"无自定义源站点"并禁用下拉框。
 *    否则，启用下拉框，添加一个"-- 请选择源站点 --"的占位符选项，然后遍历每个源站点配置，
 *    为其创建一个 `<option>` 元素 (使用 `displayName` 或部分 ID 作为文本) 并添加到下拉框。
 * 6. **设置选中项**: 如果 `selectedSiteIdToSet` 有效且存在于加载的站点中，则将其设为下拉框的当前选中值；否则，默认选中占位符。
 * 7. **后续更新**: 使用 `setTimeout` 延迟调用 `updateCustomSourceSiteInfo` (如果可用且当前有选中的源站点)，以更新与所选源站点相关的详细信息面板。
 *
 * @param {string | null} [selectedSiteIdToSet=null] - (可选) 需要在下拉框中预先选中的源站点的 ID。
 *                                                    如果为 `null` 或未提供，则会尝试从用户设置中加载上次选择的 ID。
 */
function populateCustomSourceSitesDropdown_ui(selectedSiteIdToSet = null) {
    const dropdown = document.getElementById('customSourceSiteSelect');
    if (!dropdown) {
        console.warn('populateCustomSourceSitesDropdown_ui: customSourceSiteSelect dropdown not found.');
        return;
    }

    dropdown.innerHTML = ''; // 清空现有选项

    let sites = {};
    // Ensure loadAllCustomSourceSites is available (it's defined in storage.js and should be global or on window)
    if (typeof loadAllCustomSourceSites === 'function') {
        sites = loadAllCustomSourceSites();
    } else {
        console.error('populateCustomSourceSitesDropdown_ui: loadAllCustomSourceSites function is not available.');
        const errorOption = document.createElement('option');
        errorOption.value = "";
        errorOption.textContent = "错误:无法加载源站点";
        dropdown.appendChild(errorOption);
        dropdown.disabled = true;
        return;
    }

    const siteIds = Object.keys(sites);

    // 新增：如果没有传入selectedSiteIdToSet，自动读取设置中的selectedCustomSourceSiteId
    if (!selectedSiteIdToSet) {
        const settings = typeof loadSettings === 'function' ? loadSettings() : {};
        selectedSiteIdToSet = settings.selectedCustomSourceSiteId || null;
    }

    if (siteIds.length === 0) {
        const noSitesOption = document.createElement('option');
        noSitesOption.value = "";
        noSitesOption.textContent = "无自定义源站点"; // "No custom source sites"
        dropdown.appendChild(noSitesOption);
        dropdown.disabled = true;
    } else {
        dropdown.disabled = false;

        const placeholderOption = document.createElement('option');
        placeholderOption.value = "";
        placeholderOption.textContent = "-- 请选择源站点 --"; // "-- Select a source site --"
        dropdown.appendChild(placeholderOption);

        siteIds.forEach(id => {
            const site = sites[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = site.displayName || `源站 (ID: ${id.substring(0, 8)}...)`;
            dropdown.appendChild(option);
        });

        // 新增：如果有选中的ID，优先选中
        if (selectedSiteIdToSet && sites[selectedSiteIdToSet]) {
            dropdown.value = selectedSiteIdToSet;
        } else {
            // Default to the placeholder if no valid ID is provided or found
            dropdown.value = "";
        }
    }

    // 新增：填充完下拉框后，更新源站点信息面板
    setTimeout(() => {
        if (typeof updateCustomSourceSiteInfo === 'function' && dropdown.value) {
            updateCustomSourceSiteInfo(dropdown.value);
        }
    }, 100);
}
// 将函数挂载到 window 对象，以便 app.js 和 ui.js 内部其他地方通过 window 调用
window.populateCustomSourceSitesDropdown_ui = populateCustomSourceSitesDropdown_ui;

// ---------------------
// 文件大小格式化工具
// ---------------------
/**
 * 将文件大小（以字节为单位）转换为更易读的格式 (例如 B, KB, MB, GB, TB)。
 *
 * @param {number} bytes - 要格式化的文件大小，单位为字节。
 * @returns {string} 格式化后的文件大小字符串 (例如 "1.23 MB")。如果输入为 0，则返回 "0 B"。
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ---------------------
// 文件列表 UI 更新
// ---------------------
/**
 * 根据提供的文件数组和处理状态，动态更新界面上的文件列表显示。
 * 为每个文件创建一个列表项，包含文件名、文件大小和移除按钮。
 *
 * 主要职责:
 * 1. 清空现有的文件列表 (`fileList.innerHTML = ''`)。
 * 2. 如果文件数组 (`pdfFiles`) 不为空：
 *    a. 显示文件列表容器 (`fileListContainer`)。
 *    b. 遍历 `pdfFiles` 数组，为每个文件对象创建一个 `div.file-list-item`。
 *    c. 每个列表项包含：PDF 图标、文件名 (带 title 提示完整名称)、格式化后的文件大小、移除按钮。
 *    d. 为每个移除按钮 (`.remove-file-btn`) 添加点击事件监听器。
 *       - 点击时，如果当前不在处理中 (`isProcessing` 为 `false`)，则调用传入的 `onRemoveFile` 回调函数，
 *         并将该文件的索引作为参数传递，由回调函数负责从实际文件数组中移除该文件。
 *    e. **更新全局数据**: 根据文件列表的当前状态（单个文件、无文件、多个文件）更新全局的 `window.data` 对象，
 *       这通常用于后续的单一文件处理或结果展示。
 * 3. 如果文件数组为空，则隐藏文件列表容器，并清空 `window.data`。
 *
 * @param {Array<File>} pdfFiles - 一个包含用户已选择的 File 对象的数组。
 * @param {boolean} isProcessing - 指示当前是否正在进行文件处理过程。如果为 `true`，移除按钮将被禁用。
 * @param {function(number):void} onRemoveFile - 当用户点击移除文件按钮时调用的回调函数。
 *                                            该函数接收被移除文件在 `pdfFiles` 数组中的索引作为参数。
 */
function updateFileListUI(pdfFiles, isProcessing, onRemoveFile) {
    fileList.innerHTML = '';
    if (pdfFiles.length > 0) {
        fileListContainer.classList.remove('hidden');
        pdfFiles.forEach((file, index) => {
            const listItem = document.createElement('div');
            listItem.className = 'file-list-item';
            // 识别虚拟文件类型（基于自定义属性或文件名模式）
            let virtualBadge = '';
            const vType = (file && file.virtualType) ? String(file.virtualType) : '';
            const nameLower = (file && file.name) ? file.name.toLowerCase() : '';
            const isRetranslate = vType === 'retranslate' || /-retranslate-/.test(nameLower);
            const isRetryFailed = vType === 'retry-failed' || /-retry-failed-/.test(nameLower);
            if (isRetranslate) {
                virtualBadge = '<span class="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">重译</span>';
            } else if (isRetryFailed) {
                virtualBadge = '<span class="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">失败重试</span>';
            }

            // 简单按扩展名变化图标
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            const icon = ext === 'pdf' ? 'carbon:document-pdf' : 'carbon:document'
            const iconColor = ext === 'pdf' ? 'text-red-500' : 'text-gray-500';

            listItem.innerHTML = `
                <div class="flex items-center overflow-hidden mr-2">
                    <iconify-icon icon="${icon}" class="${iconColor} mr-2 flex-shrink-0" width="20"></iconify-icon>
                    <span class="text-sm text-gray-800 truncate" title="${file.name}">${file.name}</span>
                    ${virtualBadge}
                    <span class="text-xs text-gray-500 ml-2 flex-shrink-0">(${formatFileSize(file.size)})</span>
                </div>
                <button data-index="${index}" class="remove-file-btn text-gray-400 hover:text-red-600 flex-shrink-0" title="移除">
                    <iconify-icon icon="carbon:close" width="16"></iconify-icon>
                </button>
            `;
            fileList.appendChild(listItem);
        });

        document.querySelectorAll('.remove-file-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                if (isProcessing) return;
                const indexToRemove = parseInt(e.currentTarget.getAttribute('data-index'));
                onRemoveFile(indexToRemove); // 调用回调函数处理删除逻辑
            });
        });
        // ========== 新增：文件列表刷新时刷新 window.data ==========
        if (pdfFiles.length === 1) {
            window.data = { name: pdfFiles[0].name, ocr: '', translation: '', images: [], summaries: {} };
        } else if (pdfFiles.length === 0) {
            window.data = {};
        } else {
            window.data = { summaries: {} };
        }
        console.log('刷新文件列表:', pdfFiles.map(f => f.name));
    } else {
        fileListContainer.classList.add('hidden');
        window.data = {};
    }
}

// ---------------------
// 处理按钮状态更新
// ---------------------
/**
 * 根据当前选择的文件列表、是否正在处理以及特定服务（如Mistral OCR）的API密钥可用性，
 * 动态更新"开始处理"按钮（`processBtn`）的启用/禁用状态和显示内容。
 *
 * 主要逻辑:
 * 1. **PDF文件检查**: 检查 `pdfFiles` 数组中是否至少包含一个 PDF 文件。
 * 2. **Mistral密钥检查 (如果需要)**: 如果存在 PDF 文件，则会检查 Mistral 服务的 API 密钥是否已配置且可用。
 *    它会尝试调用 `loadModelKeys('mistral')` (来自 `storage.js`) 来获取有效的 Mistral 密钥。
 *    如果找不到有效密钥，则 `mistralKeysAvailable` 会被设为 `false`。
 * 3. **按钮禁用条件**: "开始处理"按钮将在以下任一情况下被禁用：
 *    - `pdfFiles` 数组为空。
 *    - `isProcessing` 为 `true` (即当前正在处理文件)。
 *    - 存在 PDF 文件但 `mistralKeysAvailable` 为 `false` (即需要 Mistral 服务但其密钥不可用)。
 * 4. **按钮文本和图标更新**: 根据 `isProcessing` 的状态，按钮的内部 HTML 会被更新：
 *    - 如果正在处理，按钮显示旋转的沙漏图标和"处理中..."文本。
 *    - 如果未在处理，按钮显示播放图标和"开始处理"文本。
 *
 * @param {Array<File>} pdfFiles - 当前选定的文件对象数组。
 * @param {boolean} isProcessing - 指示当前是否正在进行文件处理。
 */
function updateProcessButtonState(pdfFiles, isProcessing) {
    let mistralKeysAvailable = true; // 默认Key可用，除非检测到需要但没有
    const hasPdfFiles = pdfFiles.some(file => file.name.toLowerCase().endsWith('.pdf'));

    if (hasPdfFiles) {
        // 检查 Mistral keys 是否配置 (假设 loadModelKeys 全局可用或已导入)
        try {
            const mistralKeys = typeof loadModelKeys === 'function' ? loadModelKeys('mistral') : [];
            const usableMistralKeys = mistralKeys.filter(key => key.status === 'valid' || key.status === 'untested');
            if (usableMistralKeys.length === 0) {
                mistralKeysAvailable = false;
            }
        } catch (e) {
            console.warn("Error checking Mistral keys in updateProcessButtonState:", e);
            mistralKeysAvailable = false; // 出错时保守处理，认为Key不可用
        }
    }

    processBtn.disabled = pdfFiles.length === 0 || isProcessing || (hasPdfFiles && !mistralKeysAvailable);

    // 按处理状态切换按钮内容
    if (isProcessing) {
        processBtn.innerHTML = `<iconify-icon icon="carbon:hourglass" class="mr-2 animate-spin" width="20"></iconify-icon> <span>处理中...</span>`;
    } else {
        processBtn.innerHTML = `<iconify-icon icon="carbon:play" class="mr-2" width="20"></iconify-icon> <span>开始处理</span>`;
    }
}

// ---------------------
// 翻译相关 UI 显隐
// ---------------------
/**
 * 根据当前选择的翻译模型（`translationModelSelect.value`）和处理状态，
 * 动态调整与翻译功能相关的用户界面元素的可见性。
 *
 * 主要逻辑:
 * 1. **旧版全局自定义模型UI**: 如果选择的翻译模型是 `'custom'`：
 *    - (注释掉的代码表明曾用于显示 `customModelSettingsContainer` 和 `customModelSettings`，这些可能是旧的全局自定义设置UI，现已部分废弃或由Key管理器取代)。
 *    - (注释掉的代码表明曾处理旧的 `customModelId` 和 `customModelIdInput` 的显示逻辑)。
 * 2. **新版自定义源站点UI**: 如果 `customSourceSiteContainer` 和 `customSourceSiteSelect` 存在：
 *    - 当翻译模型为 `'custom'` 时：
 *      - 显示 `customSourceSiteContainer` (包含源站点选择下拉框)。
 *      - 启用 `customSourceSiteSelect` 下拉框。
 *      - 调用 `window.populateCustomSourceSitesDropdown_ui()` 来填充下拉框选项。
 *      - 使用 `setTimeout` 延迟调用 `updateCustomSourceSiteInfo()`，以根据当前选中的源站点更新其详细信息面板。
 *    - 当翻译模型不是 `'custom'` 时：
 *      - 隐藏 `customSourceSiteContainer`。
 *      - 清空并禁用 `customSourceSiteSelect` 下拉框。
 *      - 隐藏自定义源站点的信息面板 (`customSourceSiteInfo`) 和相关的管理按钮 (`manageSourceSiteKeyBtn`)。
 *
 * @param {boolean} isProcessing - 指示当前是否正在进行文件处理 (此参数当前在此函数中未被直接使用，但可能为未来扩展保留)。
 */
function updateTranslationUIVisibility(isProcessing) {
    const translationModelValue = translationModelSelect.value;

    // 控制旧的全局自定义模型设置UI (customModelSettingsContainer)
    if (translationModelValue === 'custom') {
        // customModelSettingsContainer.classList.remove('hidden'); // 旧的全局自定义设置容器，暂时保留，但可能后续移除
        // customModelSettings.classList.remove('hidden'); // 同上

        // 处理模型选择器和输入框的显示/隐藏逻辑 (旧逻辑，可能不再需要，因为配置在Key管理器中)
        const modelSelector = document.getElementById('customModelId'); // 这些ID是旧的全局自定义输入框
        const modelInput = document.getElementById('customModelIdInput');

        if (modelSelector && modelInput) {
            const hasAvailableModels = modelSelector.options.length > 1;
            if (hasAvailableModels) {
                if (modelSelector.value === 'manual-input') {
                    modelInput.style.display = 'block';
                } else {
                    modelInput.style.display = 'none';
                }
            } else {
                modelSelector.style.display = 'none';
                modelInput.style.display = 'block';
            }
        }
    } else {
        // customModelSettingsContainer.classList.add('hidden'); // 旧的全局自定义设置容器
        // customModelSettings.classList.add('hidden');    // 同上
    }

    // ----- 新增：处理自定义源站点下拉列表的显示/隐藏和填充 -----
    if (customSourceSiteContainer && customSourceSiteSelect) {
        if (translationModelValue === 'custom') {
            customSourceSiteContainer.classList.remove('hidden');
            customSourceSiteSelect.disabled = false;
            // 调用填充函数 - populateCustomSourceSitesDropdown_ui 会从设置中尝试获取上次选择的ID
            if (typeof window.populateCustomSourceSitesDropdown_ui === 'function') {
                 window.populateCustomSourceSitesDropdown_ui(); // 让它自己从 loadSettings() 获取 selectedCustomSourceSiteId
            } else {
                console.warn('populateCustomSourceSitesDropdown_ui function not found on window.');
                customSourceSiteSelect.innerHTML = '<option value="">加载函数错误</option>';
            }

            // 更新源站点信息显示 - 新增的调用
            setTimeout(() => {
                if (customSourceSiteSelect.value) {
                    updateCustomSourceSiteInfo(customSourceSiteSelect.value);
                }
            }, 300);
        } else {
            customSourceSiteContainer.classList.add('hidden');
            customSourceSiteSelect.innerHTML = ''; // 清空选项
            customSourceSiteSelect.disabled = true;

            // 新增：隐藏信息和按钮
            const infoContainer = document.getElementById('customSourceSiteInfo');
            const manageKeyBtn = document.getElementById('manageSourceSiteKeyBtn');
            if (infoContainer) infoContainer.classList.add('hidden');
            if (manageKeyBtn) manageKeyBtn.classList.add('hidden');
        }
    }
    // ----- 结束新增 -----

    // 翻译备择库管理模块
    const glossarySection = document.getElementById('glossaryManagerSection');
    if (glossarySection) {
        if (translationModelValue === 'none') {
            glossarySection.classList.add('hidden');
        } else {
            glossarySection.classList.remove('hidden');
        }
    }

    // ----- 新增：Gemini 默认模型信息面板显示/隐藏 -----
    const geminiInfo = document.getElementById('geminiModelInfo');
    if (geminiInfo) {
        if (translationModelValue === 'gemini') {
            geminiInfo.classList.remove('hidden');
            try { renderGeminiInfoPanel(); } catch (e) { console.error('renderGeminiInfoPanel error', e); }
        } else {
            geminiInfo.classList.add('hidden');
        }
    }

    // DeepSeek 信息面板
    const dsInfo = document.getElementById('deepseekModelInfo');
    if (dsInfo) {
        if (translationModelValue === 'deepseek') {
            dsInfo.classList.remove('hidden');
            try { renderDeepseekInfoPanel(); } catch(e){ console.error(e); }
        } else dsInfo.classList.add('hidden');
    }
    // 通义信息（两个选项都显示同一面板）
    const tyInfo = document.getElementById('tongyiModelInfo');
    if (tyInfo) {
        if (translationModelValue === 'tongyi') {
            tyInfo.classList.remove('hidden');
            try { renderTongyiInfoPanel(); } catch(e){ console.error(e); }
        } else tyInfo.classList.add('hidden');
    }
    // 火山信息
    const vcInfo = document.getElementById('volcanoModelInfo');
    if (vcInfo) {
        if (translationModelValue === 'volcano') {
            vcInfo.classList.remove('hidden');
            try { renderVolcanoInfoPanel(); } catch(e){ console.error(e); }
        } else vcInfo.classList.add('hidden');
    }
}

// ---------------------
// 结果与进度区域 UI
// ---------------------
/**
 * 在文件处理完成后，显示结果区域，并隐藏进度区域。
 * 同时，它会更新结果摘要信息，并根据成功处理的文件数启用或禁用"全部下载"按钮。
 * 最后，页面会平滑滚动到结果区域。
 *
 * @param {number} successCount - 成功处理的文件数量。
 * @param {number} skippedCount - 因已处理而被跳过的文件数量。
 * @param {number} errorCount - 处理失败（包括重试后仍失败）的文件数量。
 * @param {number} pdfFilesLength - 最初选择进行处理的文件总数。
 */
function showResultsSection(successCount, skippedCount, errorCount, pdfFilesLength) {
    progressSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    concurrentProgressText.textContent = '';

    const totalAttempted = successCount + skippedCount + errorCount;
    resultsSummary.innerHTML = `
        <p><strong>处理总结:</strong></p>
        <ul class="list-disc list-inside ml-4">
            <li>成功处理: ${successCount} 文件</li>
            <li>跳过 (已处理): ${skippedCount} 文件</li>
            <li>处理失败 (含重试): ${errorCount} 文件</li>
        </ul>
        <p class="mt-2">在 ${pdfFilesLength} 个选定文件中，尝试处理了 ${totalAttempted} 个。</p>
    `;

    downloadAllBtn.disabled = successCount === 0;

    window.scrollTo({
        top: resultsSection.offsetTop - 20,
        behavior: 'smooth'
    });
}

/**
 * 在开始文件处理时，显示进度区域，并隐藏结果区域。
 * 此函数还会清空之前的进度日志，重置批处理和并发进度的文本显示，
 * 并调用 `updateProgress` 初始化当前步骤为"初始化..."且进度为 0%。
 * 最后，页面会平滑滚动到进度区域。
 */
function showProgressSection() {
    resultsSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    progressLog.innerHTML = '';
    batchProgressText.textContent = '';
    concurrentProgressText.textContent = '';
    updateProgress('初始化...', 0);

    window.scrollTo({
        top: progressSection.offsetTop - 20,
        behavior: 'smooth'
    });
}

// ---------------------
// 并发与进度条 UI
// ---------------------
/**
 * 更新界面上显示的当前并发任务数量。
 *
 * @param {number} count - 当前正在并发执行的任务数量。
 */
function updateConcurrentProgress(count) {
    concurrentProgressText.textContent = `当前并发任务数: ${count}`;
}

/**
 * 更新批处理的整体进度显示，包括已完成数、总文件数以及进度条和百分比文本。
 *
 * @param {number} success - 已成功处理的文件数。
 * @param {number} skipped - 已跳过的文件数。
 * @param {number} errors - 处理失败的文件数。
 * @param {number} totalFiles - 本次批处理的总文件数。
 */
function updateOverallProgress(success, skipped, errors, totalFiles) {
    const completedCount = success + skipped + errors;
    if (totalFiles > 0) {
        const percentage = totalFiles > 0 ? Math.round((completedCount / totalFiles) * 100) : 0;
        batchProgressText.textContent = `整体进度: ${completedCount} / ${totalFiles} 完成`;
        progressPercentage.textContent = `${percentage}%`;
        progressBar.style.width = `${percentage}%`;
    } else {
        batchProgressText.textContent = '';
        progressPercentage.textContent = `0%`;
        progressBar.style.width = `0%`;
    }
}

/**
 * 更新当前处理步骤的文本显示。
 * 注意：此函数仅更新步骤文本，不直接更新进度条的百分比填充，那个通常由 `updateOverallProgress` 控制。
 *
 * @param {string} stepText - 描述当前正在进行的处理步骤的文本 (例如 "OCR识别中...", "翻译中...")。
 * @param {number} percentage - (此参数当前未被此函数使用，但定义中存在。可能是一个遗留参数或未来用途)。
 */
function updateProgress(stepText, percentage) {
    progressStep.textContent = stepText;
}

// ---------------------
// 日志与通知系统
// ---------------------
/**
 * 向进度日志区域（`progressLog`）添加一条新的日志记录。
 * 每条日志会自动带上当前时间戳。
 * 日志区域会自动滚动到底部以显示最新的日志。
 *
 * @param {string} text - 要添加到日志的文本内容。
 */
function addProgressLog(text) {
    const logElement = progressLog;
    const timestamp = new Date().toLocaleTimeString();
    const logLine = document.createElement('div');
    logLine.textContent = `[${timestamp}] ${text}`;
    logElement.appendChild(logLine);
    logElement.scrollTop = logElement.scrollHeight;
}

/**
 * 在屏幕右上角显示一个通知消息。
 * 通知可以有不同的类型（info, success, warning, error），并会在指定时间后自动消失。
 * 用户也可以手动点击关闭按钮来关闭通知。
 *
 * @param {string} message - 要显示的通知消息文本。
 * @param {'info' | 'success' | 'warning' | 'error'} [type='info'] - 通知的类型，决定了其图标和边框颜色。
 * @param {number} [duration=5000] - 通知显示的持续时间（毫秒），之后会自动关闭。
 * @returns {HTMLElement} 返回创建的通知 DOM 元素，主要用于测试或特殊情况下的直接操作。
 */
function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    notification.className = 'pointer-events-auto w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 mb-2 transition-all duration-300 ease-in-out transform translate-x-full opacity-0';

    let iconName, iconColor, borderColor;
    switch (type) {
        case 'success': iconName = 'carbon:checkmark-filled'; iconColor = 'text-green-500'; borderColor = 'border-green-500'; break;
        case 'error': iconName = 'carbon:error-filled'; iconColor = 'text-red-500'; borderColor = 'border-red-500'; break;
        case 'warning': iconName = 'carbon:warning-filled'; iconColor = 'text-yellow-500'; borderColor = 'border-yellow-500'; break;
        default: iconName = 'carbon:information-filled'; iconColor = 'text-blue-500'; borderColor = 'border-blue-500'; break;
    }

    notification.innerHTML = `
        <div class="p-4 border-l-4 ${borderColor}">
          <div class="flex items-start">
            <div class="flex-shrink-0">
              <iconify-icon icon="${iconName}" class="h-6 w-6 ${iconColor}" aria-hidden="true"></iconify-icon>
            </div>
            <div class="ml-3 flex-1 pt-0.5">
              <p class="text-sm font-medium text-gray-900">通知</p>
              <p class="mt-1 text-sm text-gray-500 break-words">${message}</p>
            </div>
            <div class="ml-4 flex flex-shrink-0">
              <button type="button" class="inline-flex rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                <span class="sr-only">关闭</span>
                <iconify-icon icon="carbon:close" class="h-5 w-5" aria-hidden="true"></iconify-icon>
              </button>
            </div>
          </div>
        </div>
    `;

    notificationContainer.appendChild(notification);

    requestAnimationFrame(() => {
        notification.classList.remove('translate-x-full', 'opacity-0');
        notification.classList.add('translate-x-0', 'opacity-100');
    });

    const closeButton = notification.querySelector('button');
    const closeFunc = () => closeNotification(notification);
    closeButton.addEventListener('click', closeFunc);

    const timeout = setTimeout(closeFunc, duration);
    notification.dataset.timeout = timeout;

    return notification;
}

/**
 * 关闭指定的通知消息元素。
 * 此函数会清除通知的自动关闭定时器，并应用 CSS 过渡效果使其平滑消失，
 * 然后从 DOM 中移除该通知元素。
 *
 * @param {HTMLElement} notification - 要关闭的通知 DOM 元素 (通常由 `showNotification` 返回或在事件处理中获取)。
 */
function closeNotification(notification) {
    if (!notification || !notification.parentNode) return;

    clearTimeout(notification.dataset.timeout);
    notification.classList.remove('translate-x-0', 'opacity-100');
    notification.classList.add('translate-x-full', 'opacity-0');

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// --- 导出 UI 相关函数 ---
// (根据需要选择性导出，如果使用模块化导入/导出)
// export { updateFileListUI, updateProcessButtonState, ... };

document.addEventListener('DOMContentLoaded', function() {
    // ... 其它初始化 ...
    if (customModelSettingsToggle && customModelSettings && customModelSettingsToggleIcon) {
        customModelSettingsToggle.addEventListener('click', function() {
            customModelSettings.classList.toggle('hidden');
            if (customModelSettings.classList.contains('hidden')) {
                customModelSettingsToggleIcon.setAttribute('icon', 'carbon:chevron-down');
            } else {
                customModelSettingsToggleIcon.setAttribute('icon', 'carbon:chevron-up');
            }
        });
    }

    const modelKeyManagerBtn = document.getElementById('modelKeyManagerBtn');
    const modelKeyManagerModal = document.getElementById('modelKeyManagerModal');
    const closeModelKeyManager = document.getElementById('closeModelKeyManager');
    const modelListColumn = document.getElementById('modelListColumn');
    const modelConfigColumn = document.getElementById('modelConfigColumn');
    const keyManagerColumn = document.getElementById('keyManagerColumn');

    let currentManagerUI = null;
    let selectedModelForManager = null;
    let currentSelectedSourceSiteId = null; // 新增: 当前选中的自定义源站ID

    const supportedModelsForKeyManager = [
        { key: 'mistral', name: 'Mistral OCR', group: 'ocr' },
        { key: 'deepseek', name: 'DeepSeek 翻译', group: 'translation' },
        { key: 'gemini', name: 'Gemini 翻译', group: 'translation' },
        { key: 'tongyi', name: '通义百炼', group: 'translation' },
        { key: 'volcano', name: '火山引擎', group: 'translation' },
        { key: 'custom', name: '自定义翻译模型', group: 'translation' }
    ];

    if (modelKeyManagerBtn && modelKeyManagerModal && closeModelKeyManager && modelListColumn && modelConfigColumn && keyManagerColumn) {
        modelKeyManagerBtn.addEventListener('click', function() {
            if (typeof migrateLegacyCustomConfig === 'function') { // 确保迁移已执行
                migrateLegacyCustomConfig();
            }
            renderModelList();
            if (!selectedModelForManager && supportedModelsForKeyManager.length > 0) {
                selectModelForManager(supportedModelsForKeyManager[0].key);
            } else if (selectedModelForManager) {
                selectModelForManager(selectedModelForManager);
            }
            modelKeyManagerModal.classList.remove('hidden');
        });
        closeModelKeyManager.addEventListener('click', function() {
            modelKeyManagerModal.classList.add('hidden');
            currentSelectedSourceSiteId = null; // 重置选中源站
        });
    }

    function renderModelList() {
        modelListColumn.innerHTML = '';

        const modelHasValidKey = {};
        const hasUsableKey = (keys = []) => keys.some(k => k && k.value && k.value.trim() && k.status !== 'invalid');

        supportedModelsForKeyManager.forEach(model => {
            if (typeof loadModelKeys !== 'function') {
                modelHasValidKey[model.key] = false;
                return;
            }

            if (model.key === 'custom') {
                let anyCustomKey = false;
                const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
                Object.keys(sites || {}).forEach(siteId => {
                    const siteKeys = loadModelKeys(`custom_source_${siteId}`) || [];
                    if (hasUsableKey(siteKeys)) anyCustomKey = true;
                });
                modelHasValidKey[model.key] = anyCustomKey;
            } else {
                const keys = loadModelKeys(model.key) || [];
                modelHasValidKey[model.key] = hasUsableKey(keys);
            }
        });

        const hasMistralKey = !!modelHasValidKey['mistral'];
        const translationHasKey = supportedModelsForKeyManager
            .filter(m => m.group === 'translation')
            .some(m => modelHasValidKey[m.key]);

        const headerSection = document.createElement('div');
        headerSection.className = 'mb-3 space-y-1';

        const importExportRow = document.createElement('div');
        importExportRow.className = 'flex items-center gap-2 px-1';

        const exportIconBtn = document.createElement('button');
        exportIconBtn.type = 'button';
        exportIconBtn.innerHTML = '<iconify-icon icon="carbon:export" width="16"></iconify-icon><span class="ml-1">导出全部</span>';
        exportIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
        exportIconBtn.addEventListener('click', () => {
            KeyManagerUI.exportAllModelData();
        });

        const importIconBtn = document.createElement('button');
        importIconBtn.type = 'button';
        importIconBtn.innerHTML = '<iconify-icon icon="carbon:import-export" width="16"></iconify-icon><span class="ml-1">导入全部</span>';
        importIconBtn.className = 'px-2 py-1 text-xs rounded-md border border-slate-200 hover:border-blue-300 text-slate-600 transition-colors flex items-center';
        importIconBtn.addEventListener('click', () => {
            KeyManagerUI.importAllModelData(() => {
                if (typeof renderModelList === 'function') renderModelList();
                if (typeof keyManagerColumn !== 'undefined' && typeof selectedModelForManager !== 'undefined') {
                    renderKeyManagerForModel(selectedModelForManager);
                }
            });
        });

        importExportRow.appendChild(exportIconBtn);
        importExportRow.appendChild(importIconBtn);
        headerSection.appendChild(importExportRow);

        const importExportHint = document.createElement('div');
        importExportHint.className = 'text-[11px] text-slate-500 px-1';
        importExportHint.textContent = '配置文件为 Paper Burner X 专用 JSON。';
        headerSection.appendChild(importExportHint);
        modelListColumn.appendChild(headerSection);

        const divider = document.createElement('div');
        divider.className = 'border-t border-dashed border-slate-200 my-3';
        modelListColumn.appendChild(divider);

        if (!hasMistralKey) {
            const ocrWarning = document.createElement('div');
            ocrWarning.className = 'mb-3 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2';
            ocrWarning.innerHTML = '<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前未提供 OCR Key，无法进行 PDF 的 OCR 操作。</span>';
            modelListColumn.appendChild(ocrWarning);
        }

        if (!translationHasKey) {
            const translationWarning = document.createElement('div');
            translationWarning.className = 'mb-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2';
            translationWarning.innerHTML = '<iconify-icon icon="carbon:warning" width="14"></iconify-icon><span>当前无有效翻译 Key，无法进行翻译操作。</span>';
            modelListColumn.appendChild(translationWarning);
        }

        const sections = [
            { title: '所有 OCR 方式', group: 'ocr', className: 'mt-4 mb-2' },
            { title: '翻译和分析 API', group: 'translation', className: 'mt-5 mb-2' }
        ];

        sections.forEach((section, idx) => {
            const header = document.createElement('div');
            header.className = `text-xs font-semibold text-slate-500 uppercase tracking-wide px-1 ${section.className || ''}`;
            header.textContent = section.title;
            modelListColumn.appendChild(header);

            supportedModelsForKeyManager
                .filter(model => model.group === section.group)
                .forEach(model => {
                    const button = document.createElement('button');
                    button.dataset.modelKey = model.key;
                    button.className = 'w-full text-left px-3 py-2 text-sm rounded-md transition-colors ';
                    const indicator = modelHasValidKey[model.key]
                        ? '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-emerald-500"></span>'
                        : '<span class="inline-block w-1.5 h-1.5 mr-2 rounded-full bg-slate-300"></span>';
                    button.innerHTML = indicator + model.name;
                    if (model.key === selectedModelForManager) {
                        button.classList.add('bg-blue-100', 'text-blue-700', 'font-semibold');
                    } else {
                        button.classList.add('hover:bg-gray-200', 'text-gray-700');
                    }
                    button.addEventListener('click', () => selectModelForManager(model.key));
                    modelListColumn.appendChild(button);
                });

            if (idx !== sections.length - 1) {
                const sectionDivider = document.createElement('div');
                sectionDivider.className = 'border-t border-dashed border-slate-200 my-3';
                modelListColumn.appendChild(sectionDivider);
            }
        });
    }

    function selectModelForManager(modelKey) {
        selectedModelForManager = modelKey;
        currentSelectedSourceSiteId = null; //切换主模型类型时，重置自定义源站选择
        renderModelList();
        renderModelConfigSection(modelKey);

        if (modelKey !== 'custom') {
            renderKeyManagerForModel(modelKey);
        } else {
            // 对于 'custom', renderSourceSitesList (由 renderModelConfigSection 调用)
            // 将处理第一个源站的选择和其 Key 管理器的渲染
            // 如果没有源站，keyManagerColumn 会显示提示
        }
    }

    function renderModelConfigSection(modelKey) {
        modelConfigColumn.innerHTML = '';
        const modelDefinition = supportedModelsForKeyManager.find(m => m.key === modelKey);
        if (!modelDefinition) return;

        const title = document.createElement('h3');
        title.className = 'text-lg font-semibold mb-3 text-gray-800';
        modelConfigColumn.appendChild(title);

        if (modelKey === 'custom') {
            title.textContent = `自定义源站管理`;

            const addNewButton = document.createElement('button');
            addNewButton.id = 'addNewSourceSiteBtn';
            addNewButton.innerHTML = '<iconify-icon icon="carbon:add-filled" class="mr-2"></iconify-icon>添加新源站';
            addNewButton.className = 'mb-4 px-3 py-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center';
            addNewButton.addEventListener('click', () => {
                currentSelectedSourceSiteId = null; // 清除选中状态，表示新增
                renderSourceSitesList(); // 更新列表，移除高亮
                renderSourceSiteForm(null);
            });
            modelConfigColumn.appendChild(addNewButton);

            const sitesListContainer = document.createElement('div');
            sitesListContainer.id = 'sourceSitesListContainer';
            modelConfigColumn.appendChild(sitesListContainer);

            const siteConfigFormContainer = document.createElement('div');
            siteConfigFormContainer.id = 'sourceSiteConfigFormContainer';
            siteConfigFormContainer.className = 'mt-4 p-4 border border-gray-200 rounded-md hidden';
            modelConfigColumn.appendChild(siteConfigFormContainer);

            renderSourceSitesList();

            if (!currentSelectedSourceSiteId && Object.keys(loadAllCustomSourceSites()).length === 0) {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请添加并选择一个源站以管理其 API Keys。</p>';
            } else if (!currentSelectedSourceSiteId) {
                keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请从上方列表选择一个源站以管理其 API Keys。</p>';
            }

        } else {
            title.textContent = `${modelDefinition.name} - 配置`;
        }
    }

    function renderSourceSitesList() {
        const sitesListContainer = document.getElementById('sourceSitesListContainer');
        if (!sitesListContainer) return;
        sitesListContainer.innerHTML = '';

        const sites = loadAllCustomSourceSites();
        const siteIds = Object.keys(sites);

        if (siteIds.length === 0) {
            sitesListContainer.innerHTML = '<p class="text-sm text-gray-500">还没有自定义源站。请点击上方按钮添加一个。</p>';
            document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
            if (selectedModelForManager === 'custom') {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请添加并选择一个源站以管理其 API Keys。</p>';
            }
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'space-y-2';

        siteIds.forEach(id => {
            const site = sites[id];
            const li = document.createElement('li');
            li.className = `p-3 border rounded-md flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors ${currentSelectedSourceSiteId === id ? 'bg-blue-50 border-blue-300 shadow-md' : 'bg-white'}`;
            li.dataset.siteId = id;

            li.addEventListener('click', () => {
                selectSourceSite(id);
            });

            const displayNameSpan = document.createElement('span');
            displayNameSpan.textContent = site.displayName || `源站 (ID: ${id.substring(0,8)}...)`;
            displayNameSpan.className = 'font-medium text-sm text-gray-700 flex-grow';

            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'space-x-2 flex-shrink-0';

            const editButton = document.createElement('button');
            editButton.innerHTML = '<iconify-icon icon="carbon:edit" width="16"></iconify-icon>';
            editButton.title = '编辑此源站配置';
            editButton.className = 'p-1.5 text-gray-500 hover:text-blue-700 rounded hover:bg-blue-100';
            editButton.addEventListener('click', (e) => {
                e.stopPropagation();
                currentSelectedSourceSiteId = id;
                renderSourceSitesList();
                renderSourceSiteForm(site);
                keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">编辑源站配置中。保存或取消以管理 Keys。</p>';
            });

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>';
            deleteButton.title = '删除此源站';
            deleteButton.className = 'p-1.5 text-gray-500 hover:text-red-700 rounded hover:bg-red-100';
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`确定要删除源站 "${site.displayName || id}" 吗？其关联的API Keys也将被删除。`)) {
                    deleteCustomSourceSite(id);
                    if (typeof showNotification === 'function') showNotification(`源站 "${site.displayName || id}" 已删除。`, 'success');
                    if (currentSelectedSourceSiteId === id) {
                        currentSelectedSourceSiteId = null;
                        keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
                        document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
                    }
                    renderSourceSitesList();
                }
            });

            buttonsDiv.appendChild(editButton);
            buttonsDiv.appendChild(deleteButton);

            li.appendChild(displayNameSpan);
            li.appendChild(buttonsDiv);
            ul.appendChild(li);
        });
        sitesListContainer.appendChild(ul);

        if (!currentSelectedSourceSiteId && siteIds.length > 0) {
            selectSourceSite(siteIds[0]);
        } else if (currentSelectedSourceSiteId && sites[currentSelectedSourceSiteId]) {
            renderKeyManagerForModel(`custom_source_${currentSelectedSourceSiteId}`);
        } else if (siteIds.length > 0) { // Has sites, but nothing selected (e.g. after a delete)
             keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择一个源站以管理其 API Keys。</p>';
             document.getElementById('sourceSiteConfigFormContainer').classList.add('hidden');
        }
    }

    function selectSourceSite(siteId) {
        currentSelectedSourceSiteId = siteId;
        const sites = loadAllCustomSourceSites();
        const site = sites[siteId];

        if (site) {
            renderKeyManagerForModel(`custom_source_${siteId}`);
            const formContainer = document.getElementById('sourceSiteConfigFormContainer');
            if (formContainer) {
                formContainer.classList.add('hidden');
                formContainer.innerHTML = '';
            }
        }
        renderSourceSitesList();
    }

    function renderSourceSiteForm(siteData) {
        const formContainer = document.getElementById('sourceSiteConfigFormContainer');
        if (!formContainer) return;
        formContainer.innerHTML = '';
        formContainer.classList.remove('hidden');

        const isEditing = siteData !== null;
        const formTitleText = isEditing ? `编辑源站: ${siteData.displayName || '未命名'}` : '添加新源站';

        const formTitle = document.createElement('h4');
        formTitle.textContent = formTitleText;
        formTitle.className = 'text-md font-semibold mb-3 text-gray-700';
        formContainer.appendChild(formTitle);

        const form = document.createElement('form');
        form.className = 'space-y-3';

        const siteIdForForm = isEditing ? siteData.id : _generateUUID_ui();

        form.appendChild(createConfigInput(`sourceDisplayName_${siteIdForForm}`, '显示名称 *', isEditing ? siteData.displayName : '', 'text', '例如: 我的备用 OpenAI', () => {}));
        form.appendChild(createConfigInput(`sourceApiBaseUrl_${siteIdForForm}`, 'API Base URL *', isEditing ? siteData.apiBaseUrl : '', 'url', '例如: https://api.openai.com', () => {}));

        // --- Enhanced Model ID Input with Detection ---
        const modelIdGroup = document.createElement('div');
        modelIdGroup.className = 'mb-3';

        const modelIdLabel = document.createElement('label');
        modelIdLabel.htmlFor = `sourceModelId_${siteIdForForm}`;
        modelIdLabel.className = 'block text-xs font-medium text-gray-600 mb-1';
        modelIdLabel.textContent = '默认模型 ID *';
        modelIdGroup.appendChild(modelIdLabel);

        const modelIdInputContainer = document.createElement('div');
        modelIdInputContainer.id = `sourceModelIdInputContainer_${siteIdForForm}`; // Container to hold input/select
        modelIdInputContainer.className = 'flex items-center space-x-2';

        let modelIdEditableElement = document.createElement('input');
        modelIdEditableElement.type = 'text';
        modelIdEditableElement.id = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.name = `sourceModelId_${siteIdForForm}`;
        modelIdEditableElement.value = isEditing ? siteData.modelId : '';
        modelIdEditableElement.placeholder = '例如: gpt-4-turbo';
        modelIdEditableElement.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors flex-grow';
        modelIdInputContainer.appendChild(modelIdEditableElement);

        const detectModelsButton = document.createElement('button');
        detectModelsButton.type = 'button';
        detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
        detectModelsButton.title = '从此 Base URL 检测可用模型';
        detectModelsButton.className = 'px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex-shrink-0 flex items-center';
        modelIdInputContainer.appendChild(detectModelsButton);
        modelIdGroup.appendChild(modelIdInputContainer);

        // Temporary API Key for detection
        const tempApiKeyInput = createConfigInput(`sourceTempApiKey_${siteIdForForm}`, 'API Key (检测时使用，可留空)', '', 'password', '如需临时检测可填写 Key', null, {autocomplete: 'new-password'});
        tempApiKeyInput.classList.add('text-xs'); // Smaller label
        tempApiKeyInput.querySelector('label').classList.add('text-gray-500');
        tempApiKeyInput.querySelector('input').classList.add('text-xs', 'py-1');
        const tempHint = document.createElement('p');
        tempHint.className = 'mt-1 text-[11px] text-slate-400';
        tempHint.textContent = '如已在下方“API Key”列表中添加 Key，可留空自动使用。';
        tempApiKeyInput.appendChild(tempHint);
        modelIdGroup.appendChild(tempApiKeyInput); // Add it below the model ID input group

        form.appendChild(modelIdGroup);
        // Event listener for detectModelsButton
        detectModelsButton.addEventListener('click', async () => {
            const baseUrl = document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim();
            let tempApiKey = document.getElementById(`sourceTempApiKey_${siteIdForForm}`).value.trim();
            let usedStoredKey = false;

            if (!baseUrl) {
                showNotification('请输入 API Base URL 以检测模型。', 'warning');
                return;
            }
            if (!tempApiKey && typeof loadModelKeys === 'function') {
                const storedKeys = (loadModelKeys(`custom_source_${siteIdForForm}`) || [])
                    .filter(k => k && k.value && k.value.trim() && k.status !== 'invalid');
                if (storedKeys.length > 0) {
                    tempApiKey = storedKeys[0].value.trim();
                    usedStoredKey = true;
                }
            }
            if (!tempApiKey) {
                showNotification('未找到可用的 API Key，请在下方添加或临时输入再检测。', 'warning');
                return;
            }

            detectModelsButton.disabled = true;
            detectModelsButton.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

            try {
                const detectedModels = await window.modelDetector.detectModelsForModal(baseUrl, tempApiKey);
                if (usedStoredKey) {
                    showNotification && showNotification('已使用已保存的 Key 进行模型检测。', 'info');
                }
                showNotification(`检测到 ${detectedModels.length} 个模型。`, 'success');

                const currentModelIdValue = document.getElementById(`sourceModelId_${siteIdForForm}`).value;
                const newSelect = document.createElement('select');
                newSelect.id = `sourceModelId_${siteIdForForm}`; // Keep the same ID for form submission
                newSelect.name = `sourceModelId_${siteIdForForm}`;
                newSelect.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors flex-grow';

                // Option for manual input
                const manualOption = document.createElement('option');
                manualOption.value = "__manual_input__"; // Special value
                manualOption.textContent = "-- 手动输入其他模型 --";
                newSelect.appendChild(manualOption);

                detectedModels.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    newSelect.appendChild(option);
                });

                // Replace the input with the select
                const inputContainer = document.getElementById(`sourceModelIdInputContainer_${siteIdForForm}`);
                const oldInput = document.getElementById(`sourceModelId_${siteIdForForm}`);
                inputContainer.insertBefore(newSelect, oldInput); // Insert select before old input
                if(oldInput) oldInput.remove(); // Remove the old text input
                modelIdEditableElement = newSelect; // Update reference

                // Try to set the value
                let modelFoundInSelect = false;
                if (currentModelIdValue) {
                    const existingOption = Array.from(newSelect.options).find(opt => opt.value === currentModelIdValue);
                    if (existingOption) {
                        newSelect.value = currentModelIdValue;
                        modelFoundInSelect = true;
                    }
                }
                if (!modelFoundInSelect && detectedModels.length > 0 && !currentModelIdValue) {
                     newSelect.value = detectedModels[0].id; // Default to first detected if no prior value
                } else if (!modelFoundInSelect && currentModelIdValue) {
                    newSelect.value = "__manual_input__"; // Fallback to manual if current value not in list
                    // We might need to re-create a text input here if manual is selected and there was a value
                    // For now, this just selects "manual input" in the dropdown.
                }

                // If manual input is selected, and there was a value, we might want to show a text input again.
                // This part can be enhanced later for a smoother UX when switching back to manual from select.

            } catch (error) {
                showNotification(`模型检测失败: ${error.message}`, 'error');
                console.error("Model detection error in form:", error);
            } finally {
                detectModelsButton.disabled = false;
                detectModelsButton.innerHTML = '<iconify-icon icon="carbon:search-locate" class="mr-1"></iconify-icon>检测';
            }
        });
        // --- End of Enhanced Model ID Input ---

        const requestFormatOptions = [
            { value: 'openai', text: 'OpenAI 格式' }, { value: 'anthropic', text: 'Anthropic 格式' }, { value: 'gemini', text: 'Google Gemini 格式' }
        ];
        form.appendChild(createConfigSelect(`sourceRequestFormat_${siteIdForForm}`, '请求格式', isEditing ? siteData.requestFormat : 'openai', requestFormatOptions, () => {}));

        form.appendChild(createConfigInput(`sourceTemperature_${siteIdForForm}`, '温度 (0-2)', isEditing ? siteData.temperature : 0.5, 'number', '0.5', () => {}, {min:0, max:2, step:0.01}));
        form.appendChild(createConfigInput(`sourceMaxTokens_${siteIdForForm}`, '最大 Tokens', isEditing ? siteData.max_tokens : 8000, 'number', '8000', () => {}, {min:1, step:1}));

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'flex space-x-2 pt-3 border-t mt-2';

        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.innerHTML = '<iconify-icon icon="carbon:save" class="mr-1"></iconify-icon>保存';
        saveButton.className = 'px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = '取消';
        cancelButton.className = 'px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors';
        cancelButton.addEventListener('click', () => {
            formContainer.classList.add('hidden');
            formContainer.innerHTML = '';
            if (currentSelectedSourceSiteId) {
                selectSourceSite(currentSelectedSourceSiteId);
            } else if (Object.keys(loadAllCustomSourceSites()).length > 0){
                selectSourceSite(Object.keys(loadAllCustomSourceSites())[0]);
            } else {
                 keyManagerColumn.innerHTML = '<p class="text-sm text-gray-500">请选择或添加一个源站以管理其 API Keys。</p>';
            }
        });

        buttonsDiv.appendChild(saveButton);
        buttonsDiv.appendChild(cancelButton);
        form.appendChild(buttonsDiv);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const newSiteData = {
                id: siteIdForForm,
                displayName: document.getElementById(`sourceDisplayName_${siteIdForForm}`).value.trim(),
                apiBaseUrl: document.getElementById(`sourceApiBaseUrl_${siteIdForForm}`).value.trim(),
                // Get modelId from the input/select, which now shares the same ID
                modelId: document.getElementById(`sourceModelId_${siteIdForForm}`).value === '__manual_input__' ? '' : document.getElementById(`sourceModelId_${siteIdForForm}`).value.trim(),
                requestFormat: document.getElementById(`sourceRequestFormat_${siteIdForForm}`).value,
                temperature: parseFloat(document.getElementById(`sourceTemperature_${siteIdForForm}`).value),
                max_tokens: parseInt(document.getElementById(`sourceMaxTokens_${siteIdForForm}`).value),
                availableModels: isEditing && siteData.availableModels ? siteData.availableModels : []
            };

            if (!newSiteData.displayName || !newSiteData.apiBaseUrl || !newSiteData.modelId) {
                if (typeof showNotification === 'function') showNotification('显示名称、API Base URL 和模型 ID 不能为空！', 'error');
                return;
            }

            saveCustomSourceSite(newSiteData);
            if (typeof showNotification === 'function') showNotification(`源站 "${newSiteData.displayName}" 已${isEditing ? '更新' : '添加'}。`, 'success');
            formContainer.classList.add('hidden');
            formContainer.innerHTML = '';
            currentSelectedSourceSiteId = siteIdForForm;
            renderSourceSitesList();
            selectSourceSite(siteIdForForm);
        });
        formContainer.appendChild(form);
        document.getElementById(`sourceDisplayName_${siteIdForForm}`).focus();
    }

    function renderKeyManagerForModel(modelKeyOrSourceSiteModelName) {
        keyManagerColumn.innerHTML = '';
        if (currentManagerUI && typeof currentManagerUI.destroy === 'function') {
             currentManagerUI.destroy();
        }
        currentManagerUI = new KeyManagerUI(
            modelKeyOrSourceSiteModelName,
            keyManagerColumn,
            handleTestKey,
            handleTestAllKeys,
            loadModelKeys,
            saveModelKeys
        );

        // 追加：对于 Gemini 提供“检测可用模型并设为默认”的小面板
        if (modelKeyOrSourceSiteModelName === 'gemini') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="text-sm text-blue-800 font-medium">Gemini 可用模型检测</div>
                    <button id="detectGeminiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white">检测</button>
                </div>
                <div id="geminiModelsArea" class="mt-2 text-sm text-gray-700">
                    <span class="text-gray-500">点击“检测”从 Google API 拉取模型列表</span>
                </div>
            `;
            keyManagerColumn.appendChild(panel);

            const detectBtn = panel.querySelector('#detectGeminiModelsBtn');
            const area = panel.querySelector('#geminiModelsArea');
            detectBtn.onclick = async () => {
                const keys = (loadModelKeys('gemini') || []).filter(k => k.status !== 'invalid' && k.value);
                if (keys.length === 0) { area.innerHTML = '<span class="text-red-600">无可用 Gemini API Key</span>'; return; }
                const apiKey = keys[0].value.trim();
                detectBtn.disabled = true; detectBtn.textContent = '检测中...';
                try {
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
                    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                    const data = await resp.json();
                    const items = Array.isArray(data.models || data.data) ? (data.models || data.data) : [];
                    if (items.length === 0) { area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>'; return; }
                    const select = document.createElement('select');
                    select.className = 'mt-2 w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm';
                    items.forEach(m => {
                        const id = m.name ? String(m.name).split('/').pop() : (m.id || '');
                        if (!id) return;
                        const opt = document.createElement('option');
                        opt.value = id; opt.textContent = id;
                        select.appendChild(opt);
                    });
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded';
                    saveBtn.textContent = '设为默认模型';
                    saveBtn.onclick = () => {
                        saveModelConfig('gemini', { preferredModelId: select.value });
                        if (typeof showNotification === 'function') showNotification(`Gemini 默认模型已设为 ${select.value}`, 'success');
                    };
                    area.innerHTML = '';
                    area.appendChild(select);
                    area.appendChild(saveBtn);
                } catch (e) {
                    console.error(e);
                    area.innerHTML = `<span class="text-red-600">检测失败: ${e.message}</span>`;
                } finally {
                    detectBtn.disabled = false; detectBtn.textContent = '检测';
                }
            };
        }

        // 追加：DeepSeek 检测面板
        if (modelKeyOrSourceSiteModelName === 'deepseek') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="text-sm text-blue-800 font-medium">DeepSeek 可用模型检测</div>
                    <button id="detectDeepseekModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white">检测</button>
                </div>
                <div id="deepseekModelsArea" class="mt-2 text-sm text-gray-700">
                    <span class="text-gray-500">点击“检测”从 DeepSeek API 拉取模型列表</span>
                </div>
            `;
            keyManagerColumn.appendChild(panel);
            const detectBtn = panel.querySelector('#detectDeepseekModelsBtn');
            const area = panel.querySelector('#deepseekModelsArea');
            detectBtn.onclick = async () => {
                const keys = (loadModelKeys('deepseek') || []).filter(k => k.status !== 'invalid' && k.value);
                if (keys.length === 0) { area.innerHTML = '<span class="text-red-600">无可用 DeepSeek API Key</span>'; return; }
                const apiKey = keys[0].value.trim();
                detectBtn.disabled = true; detectBtn.textContent = '检测中...';
                try {
                    const resp = await fetch('https://api.deepseek.com/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
                    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                    const data = await resp.json();
                    const items = Array.isArray(data.data) ? data.data : [];
                    if (items.length === 0) { area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>'; return; }
                    const select = document.createElement('select');
                    select.className = 'mt-2 w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm';
                    items.forEach(m => { const id = m.id; if (!id) return; const opt = document.createElement('option'); opt.value = id; opt.textContent = id; select.appendChild(opt); });
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded';
                    saveBtn.textContent = '设为默认模型';
                    saveBtn.onclick = () => { saveModelConfig('deepseek', { preferredModelId: select.value }); showNotification && showNotification(`DeepSeek 默认模型已设为 ${select.value}`, 'success'); };
                    area.innerHTML = '';
                    area.appendChild(select);
                    area.appendChild(saveBtn);
                } catch(e) { console.error(e); area.innerHTML = `<span class=\"text-red-600\">检测失败: ${e.message}</span>`; }
                finally { detectBtn.disabled = false; detectBtn.textContent = '检测'; }
            };
        }

        // 追加：通义 检测面板（两个通义条目使用同一保存命名空间 'tongyi'）
        if (modelKeyOrSourceSiteModelName === 'tongyi') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="text-sm text-blue-800 font-medium">通义 可用模型检测</div>
                    <button id="detectTongyiModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg-white">检测</button>
                </div>
                <div id="tongyiModelsArea" class="mt-2 text-sm text-gray-700">
                    <span class="text-gray-500">点击“检测”从 DashScope API 拉取模型列表</span>
                </div>
            `;
            keyManagerColumn.appendChild(panel);
            const detectBtn = panel.querySelector('#detectTongyiModelsBtn');
            const area = panel.querySelector('#tongyiModelsArea');
            detectBtn.onclick = async () => {
                let keys = (loadModelKeys('tongyi') || []);
                keys = keys.filter(k => k.status !== 'invalid' && k.value);
                if (keys.length === 0) { area.innerHTML = '<span class="text-red-600">无可用 通义 API Key</span>'; return; }
                const apiKey = keys[0].value.trim();
                detectBtn.disabled = true; detectBtn.textContent = '检测中...';
                try {
                    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/models', { headers: { 'Authorization': `Bearer ${apiKey}` } });
                    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
                    const data = await resp.json();
                    const items = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data?.data?.models) ? data.data.models : []));
                    if (!items || items.length === 0) { area.innerHTML = '<span class="text-gray-500">未返回模型列表</span>'; return; }
                    const select = document.createElement('select');
                    select.className = 'mt-2 w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm';
                    items.forEach(m => { const id = m.model || m.id || m.name; if (!id) return; const opt = document.createElement('option'); opt.value = id; opt.textContent = id; select.appendChild(opt); });
                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'mt-2 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded';
                    saveBtn.textContent = '设为默认模型';
                    saveBtn.onclick = () => { saveModelConfig('tongyi', { preferredModelId: select.value }); showNotification && showNotification(`通义 默认模型已设为 ${select.value}`, 'success'); };
                    area.innerHTML = '';
                    area.appendChild(select);
                    area.appendChild(saveBtn);
                } catch(e) { console.error(e); area.innerHTML = `<span class=\"text-red-600\">检测失败: ${e.message}</span>`; }
                finally { detectBtn.disabled = false; detectBtn.textContent = '检测'; }
            };
        }

        // 追加：火山 检测面板（两个火山条目使用 'volcano'）
        if (modelKeyOrSourceSiteModelName === 'volcano') {
            const panel = document.createElement('div');
            panel.className = 'mt-4 p-3 border rounded-md bg-blue-50';
            panel.innerHTML = `
                <div class="flex items-center justify之间">
                    <div class="text-sm text-blue-800 font-medium">火山 可用模型检测</div>
                    <button id="detectVolcanoModelsBtn" class="px-2 py-1 text-xs border rounded hover:bg白">检测</button>
                </div>
                <div id="volcanoModelsArea" class="mt-2 text-sm text-gray-700">
                    <span class="text-gray-500">点击“检测”从 Ark API 拉取模型列表</span>
                </div>
            `;
            // 修正误植
            panel.innerHTML = panel.innerHTML.replace('之间', 'between').replace('白', 'white');
            keyManagerColumn.appendChild(panel);
            const detectBtn = panel.querySelector('#detectVolcanoModelsBtn');
            const area = panel.querySelector('#volcanoModelsArea');
            // 按用户要求：不提供在线检测，改为手动输入并保存
            if (detectBtn && area) {
                detectBtn.style.display = 'none';
                area.innerHTML = `
                    <div class="flex items-center gap-2">
                        <input id="volcanoKMManualInput" type="text" class="flex-grow px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500" placeholder="例如：doubao-1-5-pro-32k-250115">
                        <button id="volcanoKMSaveBtn" class="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded">设为默认</button>
                    </div>
                    <div class="mt-1 text-xs text-gray-600">不提供在线检测；请手动输入模型ID。</div>
                `;
                try { const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId || cfg.modelId)) area.querySelector('#volcanoKMManualInput').value = cfg.preferredModelId || cfg.modelId; } catch {}
                const saveBtn = area.querySelector('#volcanoKMSaveBtn');
                saveBtn.onclick = () => {
                    const val = (area.querySelector('#volcanoKMManualInput').value || '').trim();
                    if (!val) { showNotification && showNotification('请输入模型ID', 'warning'); return; }
                    saveModelConfig && saveModelConfig('volcano', { preferredModelId: val });
                    showNotification && showNotification(`火山 默认模型已设为 ${val}`, 'success');
                };
                // 不再绑定在线检测
                return;
            }
            if (detectBtn) detectBtn.style.display = 'none';
            if (area) area.innerHTML = '<span class="text-gray-600">请手动输入模型ID，或在设置中选择。示例：<code>doubao-1-5-pro-32k-250115</code> / <code>deepseek-v3-250324</code></span>';
        }
    }

    async function handleTestKey(modelName, keyObject) {
        if (!currentManagerUI) return;
        currentManagerUI.updateKeyStatus(keyObject.id, 'testing');

        let modelConfigForTest = {};
        let apiEndpointForTest = null;
        // 获取友好显示名
        let modelDisplayNameForNotification = modelName;
        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            if (typeof loadAllCustomSourceSites === 'function') {
                const sites = loadAllCustomSourceSites();
                const site = sites[sourceSiteId];
                if (site && site.displayName) {
                    modelDisplayNameForNotification = `"${site.displayName}"`;
                } else {
                    modelDisplayNameForNotification = `源站点 (ID: ...${sourceSiteId.slice(-8)})`;
                }
            }
        }

        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            const allSites = loadAllCustomSourceSites();
            const siteConfig = allSites[sourceSiteId];
            if (siteConfig && siteConfig.apiBaseUrl && siteConfig.modelId) {
                apiEndpointForTest = siteConfig.apiBaseUrl;
                modelConfigForTest = {
                    ...siteConfig,
                    apiEndpoint: siteConfig.apiBaseUrl
                };
            } else {
                currentManagerUI.updateKeyStatus(keyObject.id, 'untested');
                showNotification(`源站配置不完整 (ID: ${sourceSiteId})，缺少 API Base URL 或模型 ID。请在配置区完善。`, 'error');
                return;
            }
        } else {
            modelConfigForTest = loadModelConfig(modelName) || {};
            apiEndpointForTest = modelConfigForTest.apiEndpoint;
        }

        try {
            const isValid = await testModelKey(modelName, keyObject.value, modelConfigForTest, apiEndpointForTest);
            currentManagerUI.updateKeyStatus(keyObject.id, isValid ? 'valid' : 'invalid');
            showNotification(`Key (${keyObject.value.substring(0,4)}...) for ${modelDisplayNameForNotification} test: ${isValid ? '有效' : '无效'}`, isValid ? 'success' : 'error');
        } catch (error) {
            console.error("Key test error:", error);
            currentManagerUI.updateKeyStatus(keyObject.id, 'invalid');
            showNotification(`Key test for ${modelDisplayNameForNotification} failed: ${error.message}`, 'error');
        }
    }

    async function handleTestAllKeys(modelName, keysArray) {
        // 获取友好显示名
        let modelDisplayNameForNotification = modelName;
        if (modelName.startsWith('custom_source_')) {
            const sourceSiteId = modelName.replace('custom_source_', '');
            if (typeof loadAllCustomSourceSites === 'function') {
                const sites = loadAllCustomSourceSites();
                const site = sites[sourceSiteId];
                if (site && site.displayName) {
                    modelDisplayNameForNotification = `"${site.displayName}"`;
                } else {
                    modelDisplayNameForNotification = `源站点 (ID: ...${sourceSiteId.slice(-8)})`;
                }
            }
        }
        showNotification(`开始批量测试 ${modelDisplayNameForNotification} 的 ${keysArray.length} 个Key...`, 'info');
        for (const keyObj of keysArray) {
            await handleTestKey(modelName, keyObj);
        }
        showNotification(`${modelDisplayNameForNotification} 的所有 Key 测试完毕。`, 'info');
    }

    // 旧的 updateCustomModelConfig, handleDetectModelsInModal might need to be adapted or removed
    // if their functionality is now part of the source site form.
    // The functions createConfigInput and createConfigSelect are still useful for the new form.

    window.refreshKeyManagerForModel = (modelName, keyId, newStatus) => {
        if (modelKeyManagerModal && !modelKeyManagerModal.classList.contains('hidden') &&
            currentManagerUI && currentManagerUI.modelName === modelName) {
            currentManagerUI.updateKeyStatus(keyId, newStatus);
        }
    };

    // 新增: Event-Listener für das customSourceSiteSelect Dropdown-Menü
    if (customSourceSiteSelect) {
        customSourceSiteSelect.addEventListener('change', () => {
            // 保存当前选中的源站点ID到设置
            let settings = typeof loadSettings === 'function' ? loadSettings() : {};
            settings.selectedCustomSourceSiteId = customSourceSiteSelect.value;
            if (typeof saveSettings === 'function') {
                saveSettings(settings);
            } else {
                localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
            }
            // 原有逻辑
            saveCurrentSettings && saveCurrentSettings();
            // 新增：切换后立即刷新信息面板
            if (typeof updateCustomSourceSiteInfo === 'function') {
                updateCustomSourceSiteInfo(customSourceSiteSelect.value);
            }
        });
    }

    // 新增：更新自定义源站点信息函数
    function updateCustomSourceSiteInfo(siteId) {
        const infoContainer = document.getElementById('customSourceSiteInfo');
        const manageKeyBtn = document.getElementById('manageSourceSiteKeyBtn');

        if (!infoContainer || !manageKeyBtn) return;

        if (!siteId) {
            infoContainer.classList.add('hidden');
            manageKeyBtn.classList.add('hidden');
            return;
        }

        try {
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[siteId];

            if (site) {
                // 显示信息面板和按钮
                infoContainer.classList.remove('hidden');
                manageKeyBtn.classList.remove('hidden');

                // 获取可用API Key数量 - 移到前面以便模板使用
                const customSourceKeysCount = typeof loadModelKeys === 'function' ?
                    (loadModelKeys(`custom_source_${siteId}`) || []).filter(k => k.status !== 'invalid').length : 0;

                // 构建HTML以展示站点信息
                let infoHtml = `
                    <div class="p-3">
                        <h3 class="font-bold text-gray-800 text-xl mt-1 mb-2">${site.displayName || '未命名源站点'}</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                            <div><span class="font-medium">API Base URL:</span> <span class="text-gray-600">${site.apiBaseUrl || '未设置'}</span></div>
                            <div><span class="font-medium">当前模型:</span> <span id="currentModelPreview_${siteId}" class="text-gray-600">${site.modelId || '未设置'}</span></div>
                            <div><span class="font-medium">请求格式:</span> <span class="text-gray-600">${site.requestFormat || 'openai'}</span></div>
                            <div><span class="font-medium">温度:</span> <span class="text-gray-600">${site.temperature || '0.5'}</span></div>
                        </div>`;

                // 如果有可用模型列表，则展示为可选择的下拉框
                if (site.availableModels && site.availableModels.length > 0) {
                    infoHtml += `
                        <div class="mt-2 border-t border-dashed pt-2">
                            <div class="flex justify-between items-center">
                                <div class="font-medium mb-1">选择模型:</div>
                                <div class="flex items-center space-x-2">
                                    <span class="text-xs text-green-600 flex items-center">
                                        <iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>
                                        检测到 ${site.availableModels.length} 个可用模型
                                    </span>
                                    <button id="reDetectModelsBtn_${siteId}" class="ml-1 px-1.5 py-0.5 bg-gray-100 hover:bg-blue-100 text-blue-600 rounded flex items-center" title="重新检测模型">
                                        <iconify-icon icon="carbon:renew" class="animate-spin-slow" width="16"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2 mt-2">
                                <select id="sourceSiteModelSelect_${siteId}" class="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors">`;

                    site.availableModels.forEach(model => {
                        const modelName = model.name || model.id;
                        const modelId = model.id;
                        const isSelected = modelId === site.modelId;
                        infoHtml += `<option value="${modelId}" ${isSelected ? 'selected' : ''}>${modelName}</option>`;
                    });

                    // 添加当前使用的模型（如果不在列表中）
                    if (site.modelId && !site.availableModels.some(m => m.id === site.modelId)) {
                        infoHtml += `<option value="${site.modelId}" selected>${site.modelId} (当前使用)</option>`;
                    }

                    infoHtml += `</select>
                                <button id="saveModelBtn_${siteId}" class="px-5 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center min-w-[80px] whitespace-nowrap">
                                    <iconify-icon icon="carbon:save" class="mr-1" width="16"></iconify-icon>
                                    设为默认
                                </button>
                            </div>
                        </div>`;
                } else {
                    // 没有可用模型列表时，显示更明确的提示和手动输入选项
                    infoHtml += `<div class="mt-2 pt-2 border-t">
                        <div class="flex justify-between items-center">
                            <div class="font-medium mb-1">模型ID:</div>
                            <div class="text-xs text-gray-500">
                                <iconify-icon icon="carbon:information" class="mr-1" width="14"></iconify-icon>
                                <span>还未检测模型</span>
                            </div>
                        </div>
                        <div class="flex items-center w-full">
                            <input type="text" id="manualModelId_${siteId}" class="flex-grow px-3 py-1.5 border border-gray-300 rounded-l-md text-sm" value="${site.modelId || ''}" placeholder="例如: gpt-4-turbo">
                            <button id="saveManualModelBtn_${siteId}" class="px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-r-md text-xs flex items-center">
                                <iconify-icon icon="carbon:save" class="mr-1" width="14"></iconify-icon>
                                保存
                            </button>
                        </div>
                        <div class="mt-2 text-xs flex items-center justify-between">
                            <span class="text-blue-600 inline-flex items-center">
                                <iconify-icon icon="carbon:arrow-right" class="mr-1" width="14"></iconify-icon>
                                点击
                                <button id="infoDetectModelsBtn_${siteId}" class="mx-1 px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs flex items-center">
                                    <iconify-icon icon="carbon:model-alt" class="mr-1" width="12"></iconify-icon>
                                    检测可用模型
                                </button>
                            </span>

                            <!-- 检查是否有可用的API Key -->
                            <span class="${customSourceKeysCount > 0 ? 'text-green-600' : 'text-red-600'} inline-flex items-center">
                                ${customSourceKeysCount > 0 ?
                                  `<iconify-icon icon="carbon:checkmark" class="mr-1" width="14"></iconify-icon>${customSourceKeysCount}个可用Key` :
                                  `<iconify-icon icon="carbon:warning" class="mr-1" width="14"></iconify-icon>请先添加API Key`}
                            </span>
                        </div>
                    </div>`;
                }

                // 添加键检查信息和API Key管理按钮
                infoHtml += `
                    <div class="mt-6 pt-3 border-t border-dashed ">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3 h-full">
                                <span class="font-medium">API Keys:</span>
                                <span class="text-sm ${customSourceKeysCount > 0 ? 'text-green-600' : 'text-red-600'} flex items-center">
                                    ${customSourceKeysCount > 0 ?
                                      `<iconify-icon icon="carbon:checkmark-filled" class="mr-1" width="14"></iconify-icon>${customSourceKeysCount}个可用Key` :
                                      `<iconify-icon icon="carbon:warning-filled" class="mr-1" width="14"></iconify-icon>无可用Key`}
                                </span>
                            </div>
                            <button id="infoManageKeyBtn_${siteId}" class="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center" style="height:2.1em;">
                                <iconify-icon icon="carbon:api" class="mr-1" width="14"></iconify-icon>
                                管理API Key
                            </button>
                        </div>
                    </div>`;

                infoHtml += `</div>`;
                infoContainer.innerHTML = infoHtml;

                // 隐藏底部的管理按钮 - 因为我们有了内联的按钮
                manageKeyBtn.classList.add('hidden');

                // 为内联的管理API Key按钮添加点击事件
                const infoManageKeyBtn = document.getElementById(`infoManageKeyBtn_${siteId}`);
                if (infoManageKeyBtn) {
                    infoManageKeyBtn.onclick = function() {
                        // 打开模型Key管理弹窗
                        document.getElementById('modelKeyManagerBtn').click();

                        // 等待弹窗打开，然后设置正确的模型和源站点
                        setTimeout(() => {
                            if (typeof selectModelForManager === 'function') {
                                // 选择custom模型
                                selectModelForManager('custom');

                                // 再选择特定源站点
                                if (typeof selectSourceSite === 'function') {
                                    selectSourceSite(siteId);
                                }
                            }
                        }, 100);
                    };
                }

                // 为内联的检测模型按钮添加点击事件
                const infoDetectModelsBtn = document.getElementById(`infoDetectModelsBtn_${siteId}`);
                if (infoDetectModelsBtn) {
                    infoDetectModelsBtn.onclick = function() {
                        // 直接调用外部检测按钮的点击事件
                        const mainDetectBtn = document.getElementById('detectModelsBtn');
                        if (mainDetectBtn) {
                            mainDetectBtn.click();
                        }
                    };
                }
                // 为重新检测按钮添加事件
                const reDetectBtn = document.getElementById(`reDetectModelsBtn_${siteId}`);
                if (reDetectBtn) {
                    reDetectBtn.onclick = function() {
                        const mainDetectBtn = document.getElementById('detectModelsBtn');
                        if (mainDetectBtn) {
                            mainDetectBtn.click();
                        }
                    };
                }

                // 添加新功能：绑定模型选择/保存事件
                setTimeout(() => {
                    // 1. 如果有可用模型下拉框，绑定保存事件
                    const modelSelectBtn = document.getElementById(`saveModelBtn_${siteId}`);
                    const modelSelect = document.getElementById(`sourceSiteModelSelect_${siteId}`);

                    // 新增：如果 site.modelId 为空，自动选中第一个并保存
                    if (modelSelect && (!site.modelId || !site.availableModels.some(m => m.id === site.modelId))) {
                        if (modelSelect.options.length > 0) {
                            const firstModelId = modelSelect.options[0].value;
                            if (!site.modelId || site.modelId !== firstModelId) {
                                site.modelId = firstModelId;
                                if (typeof saveCustomSourceSite === 'function') {
                                    saveCustomSourceSite(site);
                                }
                                modelSelect.value = firstModelId;
                                // 同步预览
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = modelSelect.options[0].text || firstModelId;
                                }
                            }
                        }
                    }

                    if (modelSelectBtn && modelSelect) {
                        // 保存按钮点击事件
                        modelSelectBtn.addEventListener('click', () => {
                            if (modelSelect) {
                                const selectedModelId = modelSelect.value;
                                site.modelId = selectedModelId;
                                // 新增：同步写入 lastSelectedCustomModel
                                localStorage.setItem('lastSelectedCustomModel', selectedModelId);
                                if (typeof saveCustomSourceSite === 'function') {
                                    saveCustomSourceSite(site);
                                }
                                // 同步预览
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = modelSelect.options[modelSelect.selectedIndex].text || selectedModelId;
                                    previewText.classList.add('font-semibold', 'text-blue-600');
                                    setTimeout(() => {
                                        previewText.classList.remove('font-semibold', 'text-blue-600');
                                    }, 1500);
                                }
                            }
                        });

                        // 下拉框change事件 - 实现即时预览并保存
                        modelSelect.addEventListener('change', () => {
                            const selectedOption = modelSelect.options[modelSelect.selectedIndex];
                            const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                            if (previewText) {
                                previewText.textContent = selectedOption.text || selectedOption.value;
                                previewText.classList.add('font-semibold', 'text-blue-600');
                                setTimeout(() => {
                                    previewText.classList.remove('font-semibold', 'text-blue-600');
                                }, 1500);
                            }
                            // 新增：切换时立即保存
                            site.modelId = modelSelect.value;
                            // 新增：同步写入 lastSelectedCustomModel
                            localStorage.setItem('lastSelectedCustomModel', modelSelect.value);
                            if (typeof saveCustomSourceSite === 'function') {
                                saveCustomSourceSite(site);
                            }
                        });
                    }

                    // 2. 如果有手动输入模型ID，绑定保存事件
                    const saveManualModelBtn = document.getElementById(`saveManualModelBtn_${siteId}`);
                    const manualModelInput = document.getElementById(`manualModelId_${siteId}`);

                    if (saveManualModelBtn && manualModelInput) {
                        saveManualModelBtn.addEventListener('click', () => {
                            if (manualModelInput && manualModelInput.value.trim()) {
                                saveSelectedModelForSite(siteId, manualModelInput.value.trim());

                                // 更新当前模型显示
                                const previewText = document.getElementById(`currentModelPreview_${siteId}`);
                                if (previewText) {
                                    previewText.textContent = manualModelInput.value.trim();
                                    previewText.classList.add('font-semibold', 'text-blue-600');
                                    setTimeout(() => {
                                        previewText.classList.remove('font-semibold', 'text-blue-600');
                                    }, 1500);
                                }
                            } else {
                                showNotification('请输入有效的模型ID', 'warning');
                            }
                        });

                        // 添加Enter键保存功能
                        manualModelInput.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter' && manualModelInput.value.trim()) {
                                saveManualModelBtn.click();
                            }
                        });
                    }
                }, 100);
            } else {
                infoContainer.classList.add('hidden');
                manageKeyBtn.classList.add('hidden');
            }
        } catch (e) {
            console.error("Error updating custom source site info:", e);
            infoContainer.classList.add('hidden');
            manageKeyBtn.classList.add('hidden');
        }
    }

    /**
     * 保存选定的模型ID到源站点配置
     * @param {string} siteId - 源站点ID
     * @param {string} modelId - 要保存的模型ID
     */
    function saveSelectedModelForSite(siteId, modelId) {
        if (!siteId || !modelId) return;

        try {
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[siteId];

            if (site) {
                // 更新模型ID
                site.modelId = modelId;

                // 保存更新后的配置
                if (typeof saveCustomSourceSite === 'function') {
                    saveCustomSourceSite(site);
                    showNotification(`已将模型 "${modelId}" 设为源站 "${site.displayName || siteId}" 的默认模型`, 'success');

                    // 刷新信息显示
                    updateCustomSourceSiteInfo(siteId);
                } else {
                    showNotification('保存失败：saveCustomSourceSite 函数不可用', 'error');
                }
            } else {
                showNotification(`保存失败：未找到ID为 "${siteId}" 的源站点配置`, 'error');
            }
        } catch (e) {
            console.error('Error saving selected model for site:', e);
            showNotification('保存模型ID时发生错误', 'error');
        }
    }

    // 新增：自定义事件监听，用于外部调用源站点选择
    window.addEventListener('selectCustomSourceSiteForKeyManager', function(e) {
        if (e.detail && typeof e.detail === 'string') {
            if (typeof selectModelForManager === 'function') {
                selectModelForManager('custom');
                if (typeof selectSourceSite === 'function') {
                    selectSourceSite(e.detail);
                }
            }
        }
    });

    // 新增：选择源站点完毕后首次加载信息的钩子
    if (customSourceSiteSelect) {
        setTimeout(() => {
            // 自动展开自定义源站点设置区域
            const customSourceSiteDiv = document.getElementById('customSourceSite');
            if (customSourceSiteDiv && customSourceSiteDiv.classList.contains('hidden')) {
                customSourceSiteDiv.classList.remove('hidden');
                const customSourceSiteToggleIcon = document.getElementById('customSourceSiteToggleIcon');
                if (customSourceSiteToggleIcon) {
                    customSourceSiteToggleIcon.setAttribute('icon', 'carbon:chevron-up');
                }
            }
            // 如果没有选择，自动选择第一个
            if (!customSourceSiteSelect.value) {
                if (customSourceSiteSelect.options.length > 0) {
                    for (let i = 0; i < customSourceSiteSelect.options.length; i++) {
                        if (customSourceSiteSelect.options[i].value) {
                            customSourceSiteSelect.value = customSourceSiteSelect.options[i].value;
                            // 新增：保存到 localStorage
                            let settings = typeof loadSettings === 'function' ? loadSettings() : {};
                            settings.selectedCustomSourceSiteId = customSourceSiteSelect.value;
                            if (typeof saveSettings === 'function') {
                                saveSettings(settings);
                            } else {
                                localStorage.setItem('paperBurnerSettings', JSON.stringify(settings));
                            }
                            // 确保UI也更新
                            if (typeof updateCustomSourceSiteInfo === 'function') {
                                updateCustomSourceSiteInfo(customSourceSiteSelect.value);
                            }
                            break;
                        }
                    }
                }
            }
            // 没有自定义站点时显示提示
            if (customSourceSiteSelect.options.length <= 1) {
                const infoContainer = document.getElementById('customSourceSiteInfo');
                if (infoContainer) {
                    infoContainer.classList.remove('hidden');
                    infoContainer.innerHTML = `<div class="p-4 text-center text-red-500 text-sm font-semibold">您还没设置自定义源站点，请您先手动进行设置...<br>如果您已进行设置，请尝试刷新</div>`;
                }
            } else {
                updateCustomSourceSiteInfo(customSourceSiteSelect.value);
            }
        }, 500);
    }

    // 新增：把选择源站和显示信息函数暴露给全局
    window.updateCustomSourceSiteInfo = updateCustomSourceSiteInfo;

    // 新增：使管理函数可全局访问
    window.selectModelForManager = selectModelForManager;
    window.selectSourceSite = selectSourceSite;

    // 新增：检测可用模型按钮事件
    if (detectModelsBtn) {
        detectModelsBtn.addEventListener('click', function() {
            const selectedSiteId = customSourceSiteSelect.value;
            if (!selectedSiteId) {
                showNotification('请先选择一个源站点', 'warning');
                return;
            }

            // 先检查该源站点是否已有API Key
            const keysForSite = typeof loadModelKeys === 'function' ?
                loadModelKeys(`custom_source_${selectedSiteId}`) : [];

            const validKeys = keysForSite.filter(key => key.status === 'valid' || key.status === 'untested');

            if (validKeys.length === 0) {
                // 没有可用的Key，提示用户先添加Key
                if (confirm(`源站点没有可用的API Key。是否立即添加Key？`)) {
                    // 打开模型管理器并直接跳到Key管理界面
                    document.getElementById('modelKeyManagerBtn').click();

                    setTimeout(() => {
                        if (typeof selectModelForManager === 'function') {
                            selectModelForManager('custom');
                            if (typeof selectSourceSite === 'function') {
                                selectSourceSite(selectedSiteId);
                            }
                        }
                    }, 100);
                }
                return;
            }

            // 有可用的Key，则直接开始检测模型
            const sites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
            const site = sites[selectedSiteId];

            if (!site || !site.apiBaseUrl) {
                showNotification('源站点配置不完整，缺少API Base URL', 'error');
                return;
            }

            // 这里使用已有的Key进行检测，而不是要求用户重新输入
            showNotification('开始使用现有API Key检测可用模型，请稍候...', 'info');

            // 修改为直接使用现有Key检测
            if (typeof window.modelDetector === 'object' && typeof window.modelDetector.detectModelsForSite === 'function') {
                detectModelsWithExistingKeys(selectedSiteId, site, validKeys);
            } else {
                showNotification('模型检测器不可用，请刷新页面重试', 'error');
            }
        });
    }

    /**
     * 使用现有API Key检测源站点的可用模型
     * @param {string} siteId - 源站点ID
     * @param {object} site - 源站点配置对象
     * @param {array} validKeys - 可用的API Key列表
     */
    async function detectModelsWithExistingKeys(siteId, site, validKeys) {
        let detectBtn = document.getElementById('detectModelsBtn');
        let originalBtnText = detectBtn.innerHTML;

        try {
            // 修改按钮状态
            detectBtn.disabled = true;
            detectBtn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin mr-1"></iconify-icon>检测中...';

            // 尝试每个Key，直到成功检测到模型
            let modelsDetected = [];
            let successfulKey = null;

            for (const key of validKeys) {
                try {
                    showNotification(`正在尝试使用Key (${key.value.substring(0, 4)}...) 检测模型`, 'info');
                    modelsDetected = await window.modelDetector.detectModelsForSite(site.apiBaseUrl, key.value);

                    if (modelsDetected && modelsDetected.length > 0) {
                        successfulKey = key;
                        break; // 成功检测到模型，跳出循环
                    }
                } catch (keyError) {
                    console.warn(`Key (${key.value.substring(0, 4)}...) 检测模型失败:`, keyError);
                    // 继续尝试下一个Key
                }
            }

            if (modelsDetected.length === 0) {
                throw new Error('所有Key都无法成功检测到模型');
            }

            // 更新源站点的可用模型列表
            site.availableModels = modelsDetected;

            // 如果源站点还没有设置默认模型，则设置为第一个检测到的模型
            if (!site.modelId && modelsDetected.length > 0) {
                site.modelId = modelsDetected[0].id;
            }

            // 保存更新后的源站点配置
            if (typeof saveCustomSourceSite === 'function') {
                saveCustomSourceSite(site);
                showNotification(`已检测到 ${modelsDetected.length} 个可用模型，并已保存到源站点配置`, 'success');

                // 刷新源站点信息显示
                updateCustomSourceSiteInfo(siteId);
            } else {
                throw new Error('保存配置失败：saveCustomSourceSite 函数不可用');
            }

            // 更新使用成功的Key状态
            if (successfulKey && typeof window.refreshKeyManagerForModel === 'function') {
                // 标记为有效状态
                window.refreshKeyManagerForModel(`custom_source_${siteId}`, successfulKey.id, 'valid');
            }

        } catch (error) {
            console.error('检测模型失败:', error);
            showNotification(`检测模型失败: ${error.message}`, 'error');
        } finally {
            // 恢复按钮状态
            detectBtn.disabled = false;
            detectBtn.innerHTML = originalBtnText;
        }
    }
});
