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

    if (!customApiEndpoint || !customModelId || !customModelIdInput || !fullApiEndpointDisplay || !detectModelsBtn) {
        console.error('无法找到模型检测所需的UI元素');
        return;
    }

    // 初始隐藏下拉选择框，显示输入框
    customModelId.style.display = 'none';
    updateApiEndpointDisplay();

    // 当Base URL输入框值变化时，更新完整API端点显示
    customApiEndpoint.addEventListener('input', updateApiEndpointDisplay);

    // 检测模型按钮点击事件
    detectModelsBtn.addEventListener('click', async () => {
        await detectAvailableModels();
    });

    // 当模型选择器变化时，更新输入框值
    customModelId.addEventListener('change', function() {
        if (this.value === 'manual-input') {
            // 选择"其他模型"时，显示输入框，并聚焦
            customModelIdInput.style.display = 'block';
            customModelIdInput.focus();
            // 如果有上次选择的模型，填入输入框
            if (lastSelectedModel && lastSelectedModel !== 'manual-input') {
                customModelIdInput.value = lastSelectedModel;
            }
        } else {
            // 选择列表中的模型时，隐藏输入框
            customModelIdInput.style.display = 'none';
            lastSelectedModel = this.value;
        }
    });

    // 从本地存储加载之前的可用模型
    loadModelsFromStorage();
}

// 更新完整API端点显示
function updateApiEndpointDisplay() {
    const baseUrl = document.getElementById('customApiEndpoint').value.trim();
    const fullApiEndpointDisplay = document.getElementById('fullApiEndpointDisplay');

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
    const apiKey = document.getElementById('translationApiKeys').value.trim().split('\n')[0];
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');
    const fullApiEndpointDisplay = document.getElementById('fullApiEndpointDisplay');
    const detectBtn = document.getElementById('detectModelsBtn');

    // 保存当前选择/输入的模型ID
    lastSelectedModel = modelSelector.style.display !== 'none' ?
        modelSelector.value : modelInput.value;

    if (!customApiEndpoint.value) {
        showNotification('请先输入有效的Base URL', 'error');
        return;
    }

    if (!apiKey) {
        showNotification('请先输入API Key', 'error');
        return;
    }

    // 禁用按钮，显示加载中状态
    detectBtn.disabled = true;
    detectBtn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="mr-2 animate-spin" width="16"></iconify-icon>正在检测...';

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
        detectBtn.disabled = false;
        detectBtn.innerHTML = '<iconify-icon icon="carbon:model-alt" class="mr-2" width="16"></iconify-icon>检测可用模型';
    }
}

// 更新模型选择器
function updateModelSelector(models) {
    const modelSelector = document.getElementById('customModelId');
    const modelInput = document.getElementById('customModelIdInput');

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
    const baseUrl = document.getElementById('customApiEndpoint').value.trim();
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

// 导出函数
window.modelDetector = {
    updateApiEndpointDisplay,
    detectAvailableModels,
    getCurrentModelId,
    getFullApiEndpoint,
    updateCustomApiConfig
};