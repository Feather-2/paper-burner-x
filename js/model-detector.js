// js/model-detector.js

// =====================
// 自定义模型检测与相关工具
// =====================

let availableModels = []; // 存储检测到的可用模型
let lastSelectedModel = ''; // 保存上次选择的模型ID

// 初始化UI元素显示
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

// 更新完整API端点显示
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

// 检测可用模型
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
        // 构建请求URL，确保URL格式正确
        let baseUrl = customApiEndpoint.value.trim();
        if (baseUrl.endsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        }

        const modelsUrl = `${baseUrl}/v1/models`;

        // 发送请求
        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API错误: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) {
            throw new Error('API返回格式不符合预期');
        }

        // 处理响应数据，提取模型ID
        availableModels = data.data
            .filter(model => model.id) // 确保有ID
            .sort((a, b) => {
                // 优先显示常用模型，否则按字母顺序排序
                const popularModels = ['gpt-4', 'gpt-3.5-turbo', 'grok-', 'claude-'];
                const aIsPriority = popularModels.some(m => a.id.includes(m));
                const bIsPriority = popularModels.some(m => b.id.includes(m));

                if (aIsPriority && !bIsPriority) return -1;
                if (!aIsPriority && bIsPriority) return 1;
                return a.id.localeCompare(b.id);
            })
            .map(model => ({
                id: model.id,
                created: model.created,
                name: model.id
            }));

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

// 更新模型选择器
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

// 保存模型列表到本地存储
function saveModelsToStorage(models) {
    try {
        localStorage.setItem('availableCustomModels', JSON.stringify(models));
        localStorage.setItem('lastDetectedModelTime', Date.now());
    } catch (e) {
        console.error('保存模型列表到本地存储失败:', e);
    }
}

// 从本地存储加载模型列表
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

// 获取当前选择的模型ID
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

// 将当前的baseUrl和自定义端点一起处理
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

// 更新自定义API配置
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

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.modelDetectorInitialized === 'undefined') {
        initModelDetectorUI();
        window.modelDetectorInitialized = true;
    }
});

// 新增：专门为弹窗内模型检测设计的函数
async function detectModelsForModal(baseUrl, apiKey) {
    if (!baseUrl) {
        throw new Error('进行模型检测需要有效的 API Base URL。');
    }
    if (!apiKey) {
        throw new Error('进行模型检测需要一个 API Key。');
    }

    try {
        let cleanBaseUrl = baseUrl.trim();
        if (cleanBaseUrl.endsWith('/')) {
            cleanBaseUrl = cleanBaseUrl.slice(0, -1);
        }
        const modelsUrl = `${cleanBaseUrl}/v1/models`;

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.text(); // 尝试获取更详细的错误信息
            console.error('API Error during model detection for modal:', response.status, errorData);
            throw new Error(`API 错误 (${response.status}): ${response.statusText}. ${errorData ? 'Details: ' + errorData.substring(0,100) : ''}`);
        }

        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) {
            throw new Error('API 返回的模型列表格式不符合预期。');
        }

        const detectedModels = data.data
            .filter(model => model.id)
            .sort((a, b) => {
                const popularModels = ['gpt-4', 'gpt-3.5-turbo', 'grok-', 'claude-'];
                const aIsPriority = popularModels.some(m => a.id.includes(m));
                const bIsPriority = popularModels.some(m => b.id.includes(m));
                if (aIsPriority && !bIsPriority) return -1;
                if (!aIsPriority && bIsPriority) return 1;
                return a.id.localeCompare(b.id);
            })
            .map(model => ({ id: model.id, name: model.id })); // 简化为id和name

        return detectedModels; // 返回模型对象数组

    } catch (error) {
        console.error('模型检测 (弹窗内) 失败:', error);
        throw error; // 将错误向上抛出，以便调用方处理
    }
}

// 更新导出的函数列表
window.modelDetector = {
    updateApiEndpointDisplay,
    detectAvailableModels,    // 保留旧的，用于主设置区
    detectModelsForModal,     // 新增的，用于弹窗
    getCurrentModelId,
    getFullApiEndpoint,
    updateCustomApiConfig
};

/**
 * 模型检测器 - 负责检测API端点支持的模型列表
 */
(function () {
    /**
     * 延迟函数
     * @param {number} ms - 延迟的毫秒数
     * @returns {Promise<void>}
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 检测特定API端点支持的模型
     * @param {string} apiEndpoint - API端点URL
     * @param {string} apiKey - API Key
     * @returns {Promise<Array>} - 模型列表
     */
    async function detectModels(apiEndpoint, apiKey) {
        // 确保apiEndpoint以"/"结尾
        if (!apiEndpoint.endsWith('/')) {
            apiEndpoint += '/';
        }

        // 去除多余的v1或v1/，将统一添加
        if (apiEndpoint.endsWith('v1/')) {
            apiEndpoint = apiEndpoint.substring(0, apiEndpoint.length - 3);
        }
        if (apiEndpoint.endsWith('v1')) {
            apiEndpoint = apiEndpoint.substring(0, apiEndpoint.length - 2);
        }

        // 构建模型列表API URL
        const modelsUrl = `${apiEndpoint}v1/models`;

        try {
            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API请求失败 (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            return processModelsResponse(data);
        } catch (error) {
            console.error('检测模型时出错:', error);
            throw error;
        }
    }

    /**
     * 处理API返回的模型数据
     * @param {Object} responseData - API响应数据
     * @returns {Array} - 处理后的模型列表
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
     * 为模态框检测模型（通过UI交互）
     * @param {string} apiEndpoint - API端点URL
     * @param {string} apiKey - API Key
     * @returns {Promise<Array>} - 模型列表
     */
    async function detectModelsForModal(apiEndpoint, apiKey) {
        try {
            return await detectModels(apiEndpoint, apiKey);
        } catch (error) {
            console.error('通过模态框检测模型失败:', error);
            throw error;
        }
    }

    /**
     * 为源站点直接检测模型（使用已有配置）
     * @param {string} apiEndpoint - API端点URL
     * @param {string} apiKey - API Key
     * @returns {Promise<Array>} - 模型列表
     */
    async function detectModelsForSite(apiEndpoint, apiKey) {
        try {
            return await detectModels(apiEndpoint, apiKey);
        } catch (error) {
            console.error('为源站点检测模型失败:', error);
            throw error;
        }
    }

    /**
     * 初始化模型检测UI
     */
    function initModelDetectorUI() {
        // UI初始化逻辑
    }

    // 暴露公共方法
    window.modelDetector = {
        detectModelsForModal,
        detectModelsForSite,
        initModelDetectorUI
    };
})();