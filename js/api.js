// js/api.js

// =====================
// API 相关工具函数与管理器
// =====================

// 从 ui.js 或其他模块导入所需的函数 (如果使用模块化)
// import { addProgressLog, showNotification } from './ui.js';

// ---------------------
// API Key 管理器
// ---------------------
// 负责管理 Mistral 和翻译 API 的密钥轮询与设置
let apiKeyManager = {
    mistral: { keys: [], index: 0, blacklist: [] }, // 增加 blacklist
    translation: { keys: [], index: 0, blacklist: [] },

    // 解析 textarea 中的密钥（建议重构到 UI 层）
    parseKeys: function(keyType) {
        const textarea = keyType === 'mistral' ? document.getElementById('mistralApiKeys') : document.getElementById('translationApiKeys');
        if (!textarea) {
            console.error(`Textarea for ${keyType} not found!`);
            this[keyType].keys = [];
            this[keyType].index = 0;
            this[keyType].blacklist = [];
            return false;
        }
        this[keyType].keys = textarea.value
            .split('\n')
            .map(k => k.trim())
            .filter(k => k !== '');
        this[keyType].index = 0;
        this[keyType].blacklist = [];
        console.log(`Parsed ${this[keyType].keys.length} ${keyType} keys.`);
        return this[keyType].keys.length > 0;
    },

    // 轮询获取下一个可用密钥（跳过黑名单）
    getNextKey: function(keyType) {
        if (!this[keyType] || this[keyType].keys.length === 0) {
            return null;
        }
        const availableKeys = this[keyType].keys.filter(k => !this[keyType].blacklist.includes(k));
        if (availableKeys.length === 0) return null;
        // 保证 index 不越界
        this[keyType].index = this[keyType].index % availableKeys.length;
        const key = availableKeys[this[keyType].index];
        this[keyType].index = (this[keyType].index + 1) % availableKeys.length;
        return key;
    },

    // 标记某个 key 失效，加入黑名单
    markKeyInvalid: function(keyType, key) {
        if (!this[keyType].blacklist.includes(key)) {
            this[keyType].blacklist.push(key);
            console.warn(`Key 被标记为失效并加入黑名单: ${keyType} (...${key.slice(-4)})`);
        }
    },

    // 快捷方法：获取 Mistral/翻译密钥
    getMistralKey: function() { return this.getNextKey('mistral'); },
    getTranslationKey: function() { return this.getNextKey('translation'); },
    setKeys: function(keyType, keysArray) {
        if (this[keyType]) {
            this[keyType].keys = keysArray || [];
            this[keyType].index = 0;
            this[keyType].blacklist = [];
            console.log(`Set ${this[keyType].keys.length} ${keyType} keys externally.`);
        }
    }
};

// ---------------------
// API 错误信息提取工具
// ---------------------
// 统一从 API 响应中提取错误信息，便于调试和用户提示
async function getApiError(response, defaultMessage) {
    let errorInfo = defaultMessage;
    try {
        const responseText = await response.text();
        console.error('API Error Response Text:', responseText);
        try {
            // 尝试解析为 JSON 并提取常见错误字段
            const jsonError = JSON.parse(responseText);
            errorInfo = jsonError.error?.message || jsonError.message || jsonError.detail || JSON.stringify(jsonError);
        } catch (e) {
            // 不是 JSON，直接返回文本
            errorInfo = responseText || `HTTP ${response.status} ${response.statusText}`;
        }
    } catch (e) {
        errorInfo = `${defaultMessage} (HTTP ${response.status} ${response.statusText})`;
    }
    // 限制错误信息长度，避免 UI 崩溃
    return errorInfo.substring(0, 300) + (errorInfo.length > 300 ? '...' : '');
}

// =====================
// Mistral API 相关函数
// =====================

// 1. 上传文件到 Mistral，返回文件ID
async function uploadToMistral(fileToProcess, mistralKey) {
    const formData = new FormData();
    formData.append('file', fileToProcess);
    formData.append('purpose', 'ocr');

    const response = await fetch('https://api.mistral.ai/v1/files', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${mistralKey}` },
        body: formData
    });

    if (!response.ok) {
        const errorInfo = await getApiError(response, '文件上传失败');
        if (response.status === 401) throw new Error(`Mistral API Key (...${mistralKey.slice(-4)}) 无效或未授权`);
        throw new Error(`文件上传失败 (${response.status}): ${errorInfo}`);
    }

    const fileData = await response.json();
    if (!fileData || !fileData.id) throw new Error('上传成功但未返回有效的文件ID');
    return fileData.id;
}

// 2. 获取 Mistral 文件的签名 URL（用于后续 OCR）
async function getMistralSignedUrl(fileId, mistralKey) {
    const urlEndpoint = `https://api.mistral.ai/v1/files/${fileId}/url?expiry=24`;
    const response = await fetch(urlEndpoint, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${mistralKey}`, 'Accept': 'application/json' }
    });

    if (!response.ok) {
        const errorInfo = await getApiError(response, '获取签名URL失败');
        throw new Error(`获取签名URL失败 (${response.status}): ${errorInfo}`);
    }

    const urlData = await response.json();
    if (!urlData || !urlData.url) throw new Error('获取的签名URL格式不正确');
    return urlData.url;
}

// 3. 调用 Mistral OCR API，返回识别结果
async function callMistralOcr(signedUrl, mistralKey) {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${mistralKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            model: 'mistral-ocr-latest',
            document: { type: "document_url", document_url: signedUrl },
            include_image_base64: true
        })
    });

    if (!response.ok) {
        const errorInfo = await getApiError(response, 'OCR处理失败');
        throw new Error(`OCR处理失败 (${response.status}): ${errorInfo}`);
    }

    const ocrData = await response.json();
    if (!ocrData || !ocrData.pages) throw new Error('OCR处理成功但返回的数据格式不正确');
    return ocrData;
}

// 4. 删除 Mistral 文件，释放云端空间（失败只警告不抛出）
async function deleteMistralFile(fileId, apiKey) {
    if (!fileId || !apiKey) return; // 参数校验
    const deleteUrl = `https://api.mistral.ai/v1/files/${fileId}`;
    try {
        const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!response.ok) {
            const errorInfo = await getApiError(response, '文件删除失败');
            console.warn(`Failed to delete Mistral file ${fileId}: ${response.status} - ${errorInfo}`);
            // 只记录警告，不中断主流程
        }
        // 可选: 检查响应确认删除成功
        // const data = await response.json();
        // console.log('Delete response:', data);
    } catch (error) {
        console.warn(`Error during Mistral file deletion ${fileId}:`, error);
        // 同样不向上抛出
    }
}

// =====================
// 翻译 API 相关函数
// =====================

// 封装实际的翻译 API 调用逻辑，支持多种模型
async function callTranslationApi(effectiveConfig, requestBody) {
    const response = await fetch(effectiveConfig.endpoint, {
        method: 'POST',
        headers: effectiveConfig.headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await getApiError(response, '翻译API返回错误');
        // 包含状态码和部分错误文本，更易调试
        throw new Error(`翻译 API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    // 通过配置的 responseExtractor 提取翻译内容
    const translatedContent = effectiveConfig.responseExtractor(data);

    if (translatedContent === null || translatedContent === undefined) {
        console.error(`Failed to extract translation from response:`, data);
        throw new Error('无法从 API 响应中提取翻译内容');
    }

    return translatedContent.trim();
}

// 辅助函数：构建自定义 API 配置 (添加 bodyBuilder 参数)
function buildCustomApiConfig(key, customApiEndpoint, customModelId, customRequestFormat, temperature, max_tokens) {
    // 如果是通过模型检测模块设置的端点，直接使用
    let apiEndpoint = customApiEndpoint;

    // 检查是否有模型检测模块，如果有则使用其提供的完整端点
    if (typeof window.modelDetector !== 'undefined') {
        const fullEndpoint = window.modelDetector.getFullApiEndpoint();
        if (fullEndpoint) {
            apiEndpoint = fullEndpoint;
        }
    } else {
        // 兼容性处理：检查是否是baseUrl而不是完整端点
        if (apiEndpoint && !apiEndpoint.includes('/v1/') && !apiEndpoint.endsWith('/v1')) {
            // 移除末尾的斜杠（如果有）
            const cleanBaseUrl = apiEndpoint.endsWith('/') ? apiEndpoint.slice(0, -1) : apiEndpoint;
            apiEndpoint = `${cleanBaseUrl}/v1/chat/completions`;
        }
    }

    const config = {
        endpoint: apiEndpoint,
        modelName: customModelId, // 直接用ID做显示
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: null,
        responseExtractor: null
    };

    // 设置认证和 bodyBuilder/responseExtractor
    switch (customRequestFormat) {
        case 'openai':
            config.headers['Authorization'] = `Bearer ${key}`;
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                model: customModelId,
                messages: [{ role: "system", content: sys_prompt }, { role: "user", content: user_prompt }],
                temperature: temperature ?? 0.5,
                max_tokens: max_tokens ?? 8000
            });
            config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
            break;
        // ... existing code for other formats ...
    }
    return config;
}

// --- 导出 API 相关函数 ---
// (如果使用模块化)
// export { apiKeyManager, uploadToMistral, getMistralSignedUrl, callMistralOcr, deleteMistralFile, callTranslationApi, getApiError };
// 这里导出 markKeyInvalid 以便外部调用