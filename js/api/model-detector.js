// js/model-detector.js

// =====================
// 自定义模型检测与相关工具
// =====================

/**
 * @file js/model-detector.js
 * @description
 * 负责处理与自定义翻译模型检测相关的功能。允许用户输入 API Base URL 和 Key (通过 KeyManager 获取)，
 * 然后尝试从该 Base URL 的 `/v1/models` 端点获取可用的模型列表，并更新 UI 元素以供选择。
 * 功能也扩展到了在特定模态框或配置界面中按需检测模型。
 *
 * 主要功能:
 * - 初始化与自定义模型相关的 UI 元素 (输入框、按钮、显示区域)。
 * - 根据用户输入的 Base URL 动态更新预期的完整 API 端点显示。
 * - (旧版) `detectAvailableModels`: 针对主界面全局自定义设置区域的可用模型检测逻辑。
 * - `detectModelsForModal`: 专门为模态框或特定配置界面设计的模型检测逻辑，接收 Base URL 和 API Key 作为参数。
 * - 更新模型选择器 (`customModelId` 下拉框或 `customModelIdInput` 输入框) 以展示检测到的模型，或允许手动输入。
 * - 将检测到的可用模型列表以及用户上次选择的模型ID持久化到 localStorage，并在加载时恢复。
 * - 提供获取当前选定模型ID和完整API端点的辅助函数。
 * - 通过 `window.modelDetector` 对象暴露公共接口。
 *
 * 注意: 此文件包含两套 `window.modelDetector` 的定义，后者 (IIFE内部) 是较新的版本，
 * 前者可能是旧版或过渡版本。在维护时需注意它们之间的功能重叠和最终应该使用的版本。
 */

function appendQueryParamToUrl(urlString, param, value) {
    try {
        const url = new URL(urlString);
        url.searchParams.set(param, value);
        return url.toString();
    } catch (error) {
        const sanitized = urlString.replace(new RegExp(`([?&])${param}=[^&]*`, 'i'), '$1').replace(/[?&]$/, '');
        const separator = sanitized.includes('?') ? '&' : '?';
        return `${sanitized}${separator}${encodeURIComponent(param)}=${encodeURIComponent(value)}`;
    }
}

function normalizeOpenAIModelsUrl(baseUrlInput, endpointMode = 'auto') {
    if (!baseUrlInput || typeof baseUrlInput !== 'string') {
        throw new Error('API Base URL 不能为空');
    }
    let base = baseUrlInput.trim();
    if (!base) {
        throw new Error('API Base URL 不能为空');
    }
    base = base.replace(/\/+$/, '');
    let lower = base.toLowerCase();

    let mode = endpointMode || 'auto';
    const normalizedSegment = 'models';
    const v1Segment = `v1/${normalizedSegment}`;

    if (mode === 'manual') {
        const stripped = base
            .replace(/\/(?:v\d+\/)?chat\/completions$/i, '')
            .replace(/\/(?:v\d+\/)?messages$/i, '')
            .replace(/\/(?:v\d+\/)?completions$/i, '');
        if (stripped !== base) {
            base = stripped.replace(/\/+$/, '');
            lower = base.toLowerCase();
            mode = 'auto';
        } else {
            return base;
        }
    }

    const terminalPaths = [
        normalizedSegment,
        `/${normalizedSegment}`,
        v1Segment,
        `/${v1Segment}`
    ];

    if (terminalPaths.some(path => lower.endsWith(path))) {
        return base;
    }

    if (mode === 'chat') {
        return `${base}/${normalizedSegment}`;
    }

    if (lower.endsWith('/v1')) {
        return `${base}/${normalizedSegment}`;
    }

    return `${base}/${v1Segment}`;
}

function normalizeGeminiModelsUrl(baseUrlInput) {
    if (!baseUrlInput || typeof baseUrlInput !== 'string') {
        throw new Error('Gemini API Base URL 不能为空');
    }
    let url;
    try {
        url = new URL(baseUrlInput.trim());
    } catch (error) {
        try {
            url = new URL(`https://${baseUrlInput.trim()}`);
        } catch (_) {
            throw new Error('Gemini API Base URL 必须包含协议（例如 https://generativelanguage.googleapis.com）');
        }
    }

    url.searchParams.delete('key');

    let path = url.pathname || '';
    if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    if (!path || path === '/') {
        path = '/v1beta/models';
    } else if (/\/models\/[^/]+$/i.test(path)) {
        path = path.replace(/\/models\/[^/]+$/i, '/models');
    } else if (!/\/models$/i.test(path)) {
        if (/\/v1beta$/i.test(path) || /\/v1$/i.test(path)) {
            path = `${path}/models`;
        } else {
            path = `${path}/v1beta/models`;
        }
    }

    url.pathname = path;
    url.search = '';
    return url.toString();
}

function mapGeminiModelsResponse(modelsArray) {
    if (!Array.isArray(modelsArray)) return [];
    const mapped = modelsArray
        .map(model => {
            if (!model) return null;
            const fullName = model.name || model.id || '';
            if (!fullName) return null;
            const normalizedId = fullName.includes('/') ? fullName.split('/').pop() : fullName;
            if (!normalizedId) return null;

            return {
                id: normalizedId,
                name: normalizedId,
                rawName: fullName,
                rawDisplayName: model.displayName || ''
            };
        })
        .filter(Boolean);

    const uniqueById = new Map();
    for (const item of mapped) {
        if (!uniqueById.has(item.id)) {
            uniqueById.set(item.id, item);
        }
    }

    return Array.from(uniqueById.values());
}

function isGeminiFormat(requestFormat, baseUrl) {
    const formatLower = (requestFormat || '').toLowerCase();
    if (formatLower === 'gemini' || formatLower === 'gemini-preview') {
        return true;
    }
    if (typeof baseUrl === 'string' && /generativelanguage\.googleapis\.com/i.test(baseUrl)) {
        return true;
    }
    return false;
}

async function performModelDetection(baseUrlInput, apiKey, requestFormat = 'openai', endpointMode = 'auto') {
    if (!baseUrlInput || typeof baseUrlInput !== 'string') {
        throw new Error('进行模型检测需要有效的 API Base URL。');
    }
    if (!apiKey) {
        throw new Error('进行模型检测需要一个 API Key。');
    }

    const treatAsGemini = isGeminiFormat(requestFormat, baseUrlInput);

    const normalizedUrl = treatAsGemini
        ? normalizeGeminiModelsUrl(baseUrlInput)
        : normalizeOpenAIModelsUrl(baseUrlInput, endpointMode);

    const requestUrl = treatAsGemini
        ? appendQueryParamToUrl(normalizedUrl, 'key', apiKey)
        : normalizedUrl;

    const headers = treatAsGemini
        ? { 'Content-Type': 'application/json' }
        : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const response = await fetch(requestUrl, {
        method: 'GET',
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API 错误 (${response.status}): ${response.statusText}. ${errorText ? 'Details: ' + errorText.substring(0, 200) : ''}`);
    }

    const data = await response.json();

    if (treatAsGemini) {
        const mapped = mapGeminiModelsResponse(data.models);
        mapped.sort((a, b) => a.name.localeCompare(b.name));
        return mapped;
    }

    if (!data || !Array.isArray(data.data)) {
        throw new Error('API返回格式不符合预期');
    }

    const popularModels = ['gpt-4', 'gpt-3.5-turbo', 'grok-', 'claude-'];
    return data.data
        .filter(model => model && model.id)
        .sort((a, b) => {
            const aPriority = popularModels.some(m => a.id.includes(m));
            const bPriority = popularModels.some(m => b.id.includes(m));
            if (aPriority && !bPriority) return -1;
            if (!aPriority && bPriority) return 1;
            return a.id.localeCompare(b.id);
        })
        .map(model => ({ id: model.id, name: model.id, created: model.created }));
}

let availableModels = []; // 存储通过旧版 detectAvailableModels 函数检测到的可用模型列表。
let lastSelectedModel = ''; // 保存用户在旧版模型选择器中上次选择或输入的模型ID。

/**
 * 初始化与旧版自定义模型检测相关的UI元素。
 * 主要操作:
 * - 获取必要的 DOM 元素 (如 Base URL 输入框, 模型ID选择器/输入框, 完整端点显示区域)。
 * - 初始状态下，隐藏模型ID下拉选择框 (`customModelId`)，显示模型ID手动输入框 (`customModelIdInput`)。
 * - 为 Base URL 输入框添加 `input` 事件监听，当其值变化时调用 `updateApiEndpointDisplay` 更新完整API端点的显示。
 * - 为模型ID下拉选择框添加 `change` 事件监听，处理选择不同模型（包括"手动输入"选项）时的逻辑：
 *   - 选择"手动输入"时，显示输入框并聚焦，如果之前有选中的模型ID，则填充到输入框。
 *   - 选择列表中的具体模型时，隐藏输入框，并记录当前选择的模型ID到 `lastSelectedModel`。
 * - 调用 `loadModelsFromStorage` 尝试从本地存储加载并恢复之前检测到的模型列表和用户选择。
 * @deprecated 此函数主要服务于旧的全局自定义模型配置UI，新版可能使用 KeyManager 内部的配置或模态框。
 */
function initModelDetectorUI() {
    const customApiEndpoint = document.getElementById('customApiEndpoint');
    const customModelId = document.getElementById('customModelId');
    const customModelIdInput = document.getElementById('customModelIdInput');
    const fullApiEndpointDisplay = document.getElementById('fullApiEndpointDisplay');
    const detectModelsBtn = document.getElementById('detectModelsBtn');

    if (customModelId && customModelIdInput) {
        // 初始隐藏下拉选择框，显示输入框
        customModelId.style.display = 'none';
    }

    if (customApiEndpoint) {
        updateApiEndpointDisplay();
        // 当Base URL输入框值变化时，更新完整API端点显示
        customApiEndpoint.addEventListener('input', updateApiEndpointDisplay);
    }

    if (customModelId) {
        // 当模型选择器变化时，更新输入框值
        customModelId.addEventListener('change', function() {
            if (this.value === 'manual-input') {
                // 选择"其他模型"时，显示输入框，并聚焦
                if(customModelIdInput) customModelIdInput.style.display = 'block';
                if(customModelIdInput) customModelIdInput.focus();
                // 如果有上次选择的模型，填入输入框
                if (lastSelectedModel && lastSelectedModel !== 'manual-input') {
                    if(customModelIdInput) customModelIdInput.value = lastSelectedModel;
                }
            } else {
                // 选择列表中的模型时，隐藏输入框
                if(customModelIdInput) customModelIdInput.style.display = 'none';
                lastSelectedModel = this.value;
            }
        });
    }

    // 从本地存储加载之前的可用模型
    loadModelsFromStorage();
}

/**
 * 根据用户在 Base URL 输入框 (`customApiEndpoint`) 中输入的内容，
 * 动态更新一个用于显示完整 OpenAI 兼容 API 端点 (`fullApiEndpointDisplay`) 的文本区域。
 * 通常它会在 Base URL 后追加 `/v1/chat/completions`。
 * 如果 Base URL 为空，则显示 "-"。
 * @deprecated 此函数与旧版 UI 相关联。
 */
function updateApiEndpointDisplay() {
    const baseUrlInput = document.getElementById('customApiEndpoint');
    const fullApiEndpointDisplay = document.getElementById('fullApiEndpointDisplay');

    if (!baseUrlInput || !fullApiEndpointDisplay) return;

    const baseUrl = baseUrlInput.value.trim();

    if (baseUrl) {
        // 移除末尾的斜杠（如果有）
        const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        fullApiEndpointDisplay.textContent = `${cleanBaseUrl}/v1/chat/completions`;
    } else {
        fullApiEndpointDisplay.textContent = '-';
    }
}

/**
 * (旧版全局模型检测功能)
 * 尝试从用户在主设置界面提供的自定义 API Base URL (`customApiEndpoint`) 和 API Key (`translationApiKeys` - 已移除或逻辑变更)
 * 来检测可用的模型列表。检测成功后会更新模型选择 UI 并将结果保存到 localStorage。
 *
 * 主要步骤:
 * 1. 获取必要的 UI 元素。
 * 2. 检查 API Key 是否提供 (此逻辑可能已过时，因为 Key 现在由 KeyManager 管理)。
 * 3. 保存当前用户在模型选择器或输入框中的值到 `lastSelectedModel`。
 * 4. 校验 Base URL 是否已输入。
 * 5. 禁用检测按钮并显示加载状态。
 * 6. 构建指向 `/v1/models` 的请求 URL。
 * 7. 使用提供的 API Key (旧逻辑) 发起 GET 请求到该 URL。
 * 8. 处理响应：
 *    - 如果请求不成功，抛出错误。
 *    - 如果响应成功但数据格式不符合预期 (不是包含 `data` 数组的 JSON)，抛出错误。
 *    - 提取 `data` 数组中的模型对象，筛选有效模型ID，并按特定优先级 (如 GPT 模型在前) 和字母顺序排序。
 * 9. 调用 `updateModelSelector` 更新 UI 中的模型选择器。
 * 10. 调用 `saveModelsToStorage` 将检测到的模型列表保存到 localStorage。
 * 11. 显示成功或失败的通知。
 * 12. 无论成功或失败，最后都恢复检测按钮的状态。
 *
 * @async
 * @deprecated 此函数依赖于现已更改或移除的全局 API Key 输入方式，并且其功能正被更模块化的方法 (如 `detectModelsForModal` 或 KeyManager 内的检测) 所取代。
 */
async function detectAvailableModels() {
    const customApiEndpoint = document.getElementById('customApiEndpoint');
    const apiKeyInput = document.getElementById('translationApiKeys');
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');
    const detectBtn = document.getElementById('detectModelsBtn');

    if (!customApiEndpoint || !modelSelector || !modelInput) {
        showNotification('旧版自定义模型检测所需的UI元素缺失。请使用模型管理弹窗中的功能。 ', 'warning');
        console.warn('detectAvailableModels: Missing one or more required elements (customApiEndpoint, customModelId, customModelIdInput).');
        return;
    }

    if (!apiKeyInput || !apiKeyInput.value) {
         showNotification('旧版自定义模型检测需要API Key，但相关输入框已移除。请使用模型管理。 ', 'warning');
         console.warn('detectAvailableModels: translationApiKeys input not found or empty.');
         return;
    }

    const apiKey = apiKeyInput.value.trim().split('\n')[0];

    // 保存当前选择/输入的模型ID
    lastSelectedModel = modelSelector.style.display !== 'none' ?
        modelSelector.value : modelInput.value;

    if (!customApiEndpoint.value) {
        showNotification('请先输入有效的Base URL', 'error');
        return;
    }

    // API Key is now handled by KeyManager for each source/model.
    // This generic apiKey from translationApiKeys might not be relevant.
    // if (!apiKey) {
    //     showNotification('请先输入API Key', 'error');
    //     return;
    // }

    // 禁用按钮，显示加载中状态
    if (detectBtn) {
        detectBtn.disabled = true;
        detectBtn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="mr-2 animate-spin" width="16"></iconify-icon>正在检测...';
    }

    try {
        const requestFormatSelect = document.getElementById('customRequestFormat');
        const requestFormat = requestFormatSelect ? requestFormatSelect.value : 'openai';

        const detectedModels = await performModelDetection(customApiEndpoint.value.trim(), apiKey, requestFormat);
        availableModels = detectedModels.map(model => ({ ...model }));

        // 更新UI
        updateModelSelector(availableModels);

        // 保存到本地存储
        saveModelsToStorage(availableModels);

        showNotification(`成功检测到 ${availableModels.length} 个可用模型`, 'success');
    } catch (error) {
        console.error('检测模型失败:', error);
        showNotification(`检测失败: ${error.message}`, 'error');

        // 如果发生错误，保持输入框可见
        modelSelector.style.display = 'none';
        modelInput.style.display = 'block';
    } finally {
        // 恢复按钮状态
        if (detectBtn) {
            detectBtn.disabled = false;
            detectBtn.innerHTML = '<iconify-icon icon="carbon:model-alt" class="mr-2" width="16"></iconify-icon>检测可用模型';
        }
    }
}

/**
 * (旧版 UI 更新)
 * 根据提供的模型列表 (`models`) 更新主界面上的模型选择器 (`customModelId`) 和模型输入框 (`customModelIdInput`) 的状态和内容。
 *
 * 主要逻辑:
 * - 清空模型选择器的现有选项。
 * - 如果模型列表不为空:
 *   - 遍历模型列表，为每个模型创建一个 `<option>`元素并添加到选择器中。
 *   - 添加一个特殊的"其他模型" (`manual-input`) 选项到选择器末尾。
 *   - 显示模型选择器，隐藏手动输入框。
 *   - 尝试恢复 `lastSelectedModel`：如果 `lastSelectedModel` 存在且在新的模型列表中，则选中它；
 *     如果不在列表中，则选中"其他模型"并将 `lastSelectedModel` 的值填入输入框。
 * - 如果模型列表为空，则隐藏模型选择器，仅显示手动输入框。
 *
 * @param {Array<Object>} models - 检测到的可用模型对象数组，每个对象应至少包含 `id` 属性。
 * @deprecated 此函数与旧版全局自定义模型UI相关。
 */
function updateModelSelector(models) {
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');

    if (!modelSelector || !modelInput) {
        console.warn('updateModelSelector: customModelId or customModelIdInput element not found. Cannot update selector.');
        return;
    }

    // 清空当前选项
    modelSelector.innerHTML = '';

    if (models.length > 0) {
        // 添加模型选项
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.id;
            modelSelector.appendChild(option);
        });

        // 添加"其他模型"选项
        const manualOption = document.createElement('option');
        manualOption.value = 'manual-input';
        manualOption.textContent = '- 输入其他模型 -';
        modelSelector.appendChild(manualOption);

        // 显示下拉选择框，隐藏输入框
        modelSelector.style.display = 'block';
        modelInput.style.display = 'none';

        // 如果之前有选择的模型，尝试选中它
        if (lastSelectedModel && lastSelectedModel !== 'manual-input') {
            const option = Array.from(modelSelector.options).find(opt => opt.value === lastSelectedModel);
            if (option) {
                modelSelector.value = lastSelectedModel;
            } else {
                // 如果之前选择的模型不在列表中，选择"其他模型"并显示输入框
                modelSelector.value = 'manual-input';
                modelInput.style.display = 'block';
                modelInput.value = lastSelectedModel;
            }
        }
    } else {
        // 没有检测到模型时，仅显示输入框
        modelSelector.style.display = 'none';
        modelInput.style.display = 'block';
    }
}

/**
 * (旧版存储)
 * 将通过 `detectAvailableModels` 检测到的模型列表和检测时间保存到 localStorage。
 * - 模型列表以 JSON 字符串形式存储在 `availableCustomModels`键下。
 * - 检测时间的时间戳存储在 `lastDetectedModelTime`键下。
 *
 * @param {Array<Object>} models - 要保存的可用模型对象数组。
 * @deprecated 与旧版模型检测流程绑定。
 */
function saveModelsToStorage(models) {
    try {
        localStorage.setItem('availableCustomModels', JSON.stringify(models));
        localStorage.setItem('lastDetectedModelTime', Date.now());
    } catch (e) {
        console.error('保存模型列表到本地存储失败:', e);
    }
}

/**
 * (旧版加载)
 * 从 localStorage 加载先前保存的可用模型列表和用户最后选择的模型ID，并尝试更新相关的旧版 UI 元素。
 *
 * 主要逻辑:
 * - 检查相关的 UI 元素 (`customModelId`, `customModelIdInput`) 是否存在于当前上下文中。如果不存在，则不执行 UI 更新。
 * - 从 `localStorage` 读取 `availableCustomModels` 和 `lastDetectedModelTime`。
 * - 如果存储的模型列表存在，并且检测时间在最近7天内，则认为缓存有效，调用 `updateModelSelector` 使用这些模型更新 UI。
 * - 从 `localStorage` 读取 `lastSelectedCustomModel` 并赋值给 `lastSelectedModel` 变量。
 *
 * @deprecated 与旧版模型检测和 UI 相关。
 */
function loadModelsFromStorage() {
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');

    // If the target elements for the model selector don't exist globally,
    // then there's no UI to update with stored models in this context.
    // So, we can skip calling updateModelSelector.
    if (!modelSelector || !modelInput) {
        // console.warn('loadModelsFromStorage: Target elements (customModelId/customModelIdInput) not found. Skipping model list update for global UI.');
        // Still try to load lastSelectedModel as it might be used elsewhere or by other logic.
        try {
            lastSelectedModel = localStorage.getItem('lastSelectedCustomModel') || '';
        } catch (e) {
            console.error('Failed to load lastSelectedCustomModel from storage:', e);
        }
        return;
    }

    try {
        const storedModels = localStorage.getItem('availableCustomModels');
        const lastDetectedTime = localStorage.getItem('lastDetectedModelTime');

        if (storedModels) {
            const models = JSON.parse(storedModels);

            // 检查是否是在过去7天内检测的
            const isRecent = lastDetectedTime &&
                (Date.now() - parseInt(lastDetectedTime)) < 7 * 24 * 60 * 60 * 1000;

            if (models.length > 0 && isRecent) {
                availableModels = models;
                updateModelSelector(models);
            }
        }

        // 从存储中加载最后选择的模型
        lastSelectedModel = localStorage.getItem('lastSelectedCustomModel') || '';
    } catch (e) {
        console.error('从本地存储加载模型列表失败:', e);
    }
}

/**
 * (旧版获取)
 * 获取当前在旧版全局自定义模型UI中选择或输入的模型ID。
 * 它会检查模型选择器 (`customModelId`) 是否可见且选中的不是"手动输入"选项。
 * 如果是，则返回选择器的值；否则，返回模型手动输入框 (`customModelIdInput`) 的值。
 *
 * @returns {string} 当前选定或输入的模型ID。如果相关UI元素不存在，则返回空字符串。
 * @deprecated 与旧版全局自定义模型UI相关。
 */
function getCurrentModelId() {
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');

    if (!modelSelector || !modelInput) {
        console.warn('getCurrentModelId: modelSelector or modelInput not found.');
        return '';
    }

    if (modelSelector.style.display !== 'none' && modelSelector.value !== 'manual-input') {
        // 从选择器获取
        return modelSelector.value;
    } else {
        // 从输入框获取
        return modelInput.value.trim();
    }
}

/**
 * (旧版获取)
 * 根据旧版全局自定义 Base URL 输入框 (`customApiEndpoint`) 的值，构建并返回一个完整的、
 * 通常与 OpenAI 兼容的聊天模型 API 端点 (例如，追加 `/v1/chat/completions`)。
 *
 * @returns {string} 构建的完整 API 端点。如果 Base URL 输入框不存在或为空，则返回空字符串。
 * @deprecated 与旧版全局自定义模型UI相关。
 */
function getFullApiEndpoint() {
    const baseUrlInput = document.getElementById('customApiEndpoint');
    if (!baseUrlInput) {
        console.warn('getFullApiEndpoint: customApiEndpoint input not found.');
        return '';
    }
    const baseUrl = baseUrlInput.value.trim();
    if (!baseUrl) return '';

    // 移除末尾的斜杠（如果有）
    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${cleanBaseUrl}/v1/chat/completions`;
}

/**
 * (旧版更新配置)
 * 收集当前在旧版全局自定义模型 UI 中设置的模型 ID 和完整 API 端点，
 * 并将选择的模型 ID 保存到 localStorage (`lastSelectedCustomModel`)。
 *
 * @returns {{modelId: string, endpoint: string}} 包含当前模型ID和端点的对象。
 * @deprecated 与旧版全局自定义模型UI相关。
 */
function updateCustomApiConfig() {
    const modelId = getCurrentModelId();
    const fullEndpoint = getFullApiEndpoint();

    // 存储最后选择的模型
    if (modelId) {
        localStorage.setItem('lastSelectedCustomModel', modelId);
    }

    return {
        modelId: modelId,
        endpoint: fullEndpoint
    };
}

/**
 * 当 DOM 完全加载后，如果 `window.modelDetectorInitialized` 尚未定义，
 * 则调用 `initModelDetectorUI` 初始化旧版的模型检测器 UI，并设置标志。
 * @deprecated 依赖于旧版UI初始化。
 */
document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.modelDetectorInitialized === 'undefined') {
        initModelDetectorUI();
        window.modelDetectorInitialized = true;
    }
});

/**
 * 为特定模态框或配置界面设计的模型检测函数。
 * 它向指定的 API Base URL 的 `/v1/models` 端点发起请求，使用提供的 API Key 进行认证。
 *
 * 主要步骤:
 * 1. 参数校验：确保 `baseUrl` 和 `apiKey` 已提供。
 * 2. URL 构建：清理 `baseUrl` (移除末尾斜杠)，并构建完整的 `/v1/models` 端点 URL。
 * 3. API 请求：使用 `fetch` 发送 GET 请求，携带 `Authorization: Bearer {apiKey}` 头部。
 * 4. 响应处理：
 *    - 如果响应不成功 (`!response.ok`)，尝试获取错误文本，并抛出一个包含状态码和详情的错误。
 *    - 如果响应成功但数据格式不符合预期 (例如，JSON 中没有 `data` 数组)，抛出错误。
 *    - 从 `data` 数组中提取模型信息，筛选有效模型，按特定优先级和字母顺序排序，并简化为 `{id, name}` 对象数组。
 * 5. 返回结果：返回检测到的模型对象数组。
 * 6. 错误处理：捕获任何在过程中发生的错误，并将其向上抛出，以便调用方能够处理并向用户显示。
 *
 * @async
 * @param {string} baseUrl - 要检测模型的 API 基础 URL (例如 `https://api.openai.com`)。
 * @param {string} apiKey - 用于认证的 API 密钥。
 * @returns {Promise<Array<Object>>} 返回一个承诺，解析为检测到的模型对象数组 (每个对象包含 `id` 和 `name`)。
 * @throws {Error} 如果检测过程中发生任何错误 (如网络问题、API错误、数据格式错误)。
 */
async function detectModelsForModal(baseUrl, apiKey, requestFormat = 'openai', endpointMode = 'auto') {
    if (!baseUrl) {
        throw new Error('进行模型检测需要有效的 API Base URL。');
    }
    if (!apiKey) {
        throw new Error('进行模型检测需要一个 API Key。');
    }

    try {
        return await performModelDetection(baseUrl, apiKey, requestFormat, endpointMode);
    } catch (error) {
        console.error('模型检测 (弹窗内) 失败:', error);
        throw error;
    }
}

/**
 * @global
 * @namespace modelDetector (旧版定义)
 * @description (可能已部分过时) 全局暴露的模型检测器相关函数集合。
 * 这个版本的 `window.modelDetector` 包含了与旧版全局自定义模型设置UI交互的函数。
 * @property {function} updateApiEndpointDisplay - 更新API端点显示。
 * @property {function} detectAvailableModels - (旧版) 检测可用模型。
 * @property {function} detectModelsForModal - (新版接口，也在此处暴露) 为模态框检测模型。
 * @property {function} getCurrentModelId - (旧版) 获取当前选择的模型ID。
 * @property {function} getFullApiEndpoint - (旧版) 获取完整API端点。
 * @property {function} updateCustomApiConfig - (旧版) 更新自定义API配置。
 */
window.modelDetector = {
    updateApiEndpointDisplay,
    detectAvailableModels,    // 保留旧的，用于主设置区
    detectModelsForModal,     // 新增的，用于弹窗
    getCurrentModelId,
    getFullApiEndpoint,
    updateCustomApiConfig
};

/**
 * @file 立即执行函数表达式 (IIFE) 内部的模型检测器实现。
 * 这部分似乎是较新的或重构后的模型检测逻辑，旨在提供更通用的模型检测功能。
 * 它也将其接口暴露到 `window.modelDetector`，可能会覆盖上面较旧的定义。
 */
(function () {
    /**
     * 创建一个在指定毫秒数后解析的 Promise，用于实现延迟。
     * @param {number} ms - 延迟的毫秒数。
     * @returns {Promise<void>} 在延迟结束后解析的 Promise。
     * @private
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * (IIFE内部核心函数)
     * 检测指定 API 端点支持的模型列表。
     * 它会规范化 `apiEndpoint` (确保以 `/` 结尾，移除多余的 `v1/` 等)，
     * 然后向构建好的 `/v1/models` URL 发送 GET 请求，并处理响应。
     *
     * @async
     * @private
     * @param {string} apiEndpoint - API 的基础端点 URL。
     * @param {string} apiKey - 用于认证的 API 密钥。
     * @returns {Promise<Array<Object>>} 返回一个承诺，解析为经过 `processModelsResponse` 处理后的模型对象数组。
     * @throws {Error} 如果 API 请求失败或发生其他错误。
     */
    async function detectModels(apiEndpoint, apiKey, requestFormat = 'openai', endpointMode = 'auto') {
        try {
            return await performModelDetection(apiEndpoint, apiKey, requestFormat, endpointMode);
        } catch (error) {
            console.error('检测模型时出错:', error);
            throw error;
        }
    }

    /**
     * (IIFE内部辅助函数)
     * 处理从 `/v1/models` 端点返回的原始响应数据，将其转换为统一格式的模型对象数组。
     * 支持处理多种可能的响应格式，例如：
     *  - OpenAI 格式: 响应包含一个 `data` 数组，其中每个元素是一个模型对象。
     *  - Anthropic 格式 (推测): 响应包含一个 `models` 数组。
     *  - 其他格式: 响应的 `models` 属性是一个对象，其键是模型ID。
     * 模型对象至少包含 `id` 和 `name` 属性。OpenAI 格式的模型还会尝试按 GPT 版本排序，然后按字母顺序排序。
     *
     * @private
     * @param {Object} responseData - 从 API 获取的原始 JSON 响应数据。
     * @returns {Array<Object>} 处理和规范化后的模型对象数组。
     */
    function processModelsResponse(responseData) {
        let models = [];

        if (responseData && responseData.data && Array.isArray(responseData.data)) {
            // OpenAI格式
            models = responseData.data.map(model => ({
                id: model.id,
                name: model.id,
                created: model.created,
                // 可能的其他信息
            }));

            // 根据模型名称排序
            models.sort((a, b) => {
                // 首先尝试按GPT模型版本排序
                const gptRegex = /gpt-(\d)/;
                const aMatch = a.id.match(gptRegex);
                const bMatch = b.id.match(gptRegex);

                if (aMatch && bMatch) {
                    return parseInt(bMatch[1]) - parseInt(aMatch[1]); // 新版本在前
                }

                // 然后按名称排序
                return a.id.localeCompare(b.id);
            });
        } else if (responseData && Array.isArray(responseData.models)) {
            // Anthropic格式
            models = responseData.models.map(model => ({
                id: model.id || model.name,
                name: model.name || model.id,
                // 其他Anthropic特定信息
            }));
        } else if (responseData && responseData.models && !Array.isArray(responseData.models)) {
            // 某些API可能以对象形式返回模型
            models = Object.keys(responseData.models).map(key => ({
                id: key,
                name: responseData.models[key].name || key,
                // 其他可能的信息
            }));
        }

        return models;
    }

    /**
     * (IIFE内部接口)
     * 为模态框或特定的UI交互场景检测模型。
     * 实际上是 `detectModels` 函数的一个封装，提供了专门的错误处理上下文日志。
     *
     * @async
     * @param {string} apiEndpoint - API 的基础端点 URL。
     * @param {string} apiKey - 用于认证的 API 密钥。
     * @returns {Promise<Array<Object>>} 返回一个承诺，解析为模型对象数组。
     * @throws {Error} 如果模型检测失败。
     */
    async function detectModelsForModal(apiEndpoint, apiKey, requestFormat = 'openai', endpointMode = 'auto') {
        try {
            return await detectModels(apiEndpoint, apiKey, requestFormat, endpointMode);
        } catch (error) {
            console.error('通过模态框检测模型失败:', error);
            throw error;
        }
    }

    /**
     * (IIFE内部接口)
     * 为已配置的源站点直接检测模型。
     * 也是 `detectModels` 函数的封装，用于特定场景的错误日志。
     *
     * @async
     * @param {string} apiEndpoint - 源站点的 API 基础端点 URL。
     * @param {string} apiKey - 用于认证的 API 密钥。
     * @returns {Promise<Array<Object>>} 返回一个承诺，解析为模型对象数组。
     * @throws {Error} 如果模型检测失败。
     */
    async function detectModelsForSite(apiEndpoint, apiKey, requestFormat = 'openai', endpointMode = 'auto') {
        try {
            return await detectModels(apiEndpoint, apiKey, requestFormat, endpointMode);
        } catch (error) {
            console.error('为源站点检测模型失败:', error);
            throw error;
        }
    }

    /**
     * (IIFE内部占位符/未使用)
     * 模型检测器 UI 的初始化函数。
     * 在这个 IIFE 版本的 `modelDetector` 中，此函数体为空，表明 UI 初始化可能由外部处理，
     * 或者此版本的检测器更侧重于纯粹的API交互逻辑而非直接的UI管理。
     * @private
     */
    function initModelDetectorUI() {
        // UI初始化逻辑 (在此版本中为空)
    }

    /**
     * @global
     * @namespace modelDetector (IIFE版本定义)
     * @description (较新版本) 全局暴露的模型检测器 API。
     * 此版本更侧重于通用的模型检测逻辑，可能旨在替换或增强旧版定义。
     * @property {function} detectModelsForModal - 为模态框检测模型。
     * @property {function} detectModelsForSite - 为已配置的源站点检测模型。
     * @property {function} initModelDetectorUI - (占位符) UI 初始化函数。
     */
    window.modelDetector = {
        detectModelsForModal,
        detectModelsForSite,
        initModelDetectorUI
    };
})();
