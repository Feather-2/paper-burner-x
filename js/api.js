// js/api.js

// =====================
// API 相关工具函数与管理器
// =====================

// 从 ui.js 或其他模块导入所需的函数 (如果使用模块化)
// import { addProgressLog, showNotification } from './ui.js';

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
    // 添加防御性检查
    if (!effectiveConfig || !effectiveConfig.endpoint) {
        throw new Error('无效的 API 配置: 缺少必要的端点信息');
    }

    if (!effectiveConfig.headers) {
        effectiveConfig.headers = { 'Content-Type': 'application/json' };
    }
    // 确保 Accept header 存在并优先 application/json
    effectiveConfig.headers['Accept'] = 'application/json, text/plain, */*';

    const response = await fetch(effectiveConfig.endpoint, {
        method: 'POST',
        headers: effectiveConfig.headers,
        body: JSON.stringify(requestBody)
    });

    const contentType = response.headers.get('content-type');
    if (!response.ok) {
        const errorText = await getApiError(response, '翻译API返回错误');
        // 包含状态码和部分错误文本，更易调试
        throw new Error(`翻译 API 错误 (${response.status}): ${errorText}`);
    }

    // 检查 Content-Type 是否为 JSON
    if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Translation API did not return JSON. Response:', responseText.substring(0, 500)); // Log first 500 chars
        throw new Error(`翻译 API 未返回有效的 JSON 响应。收到的 Content-Type: ${contentType}. 响应内容可能为 HTML 或其他格式。请检查 API Endpoint 配置。`);
    }

    const data = await response.json();
    // 通过配置的 responseExtractor 提取翻译内容
    const extractor = effectiveConfig.responseExtractor || (d => d?.choices?.[0]?.message?.content);
    const translatedContent = extractor(data);

    if (translatedContent === null || translatedContent === undefined) {
        console.error(`Failed to extract translation from response:`, data);
        throw new Error('无法从 API 响应中提取翻译内容');
    }

    return translatedContent.trim();
}

// 辅助函数：构建自定义 API 配置 (添加 bodyBuilder 参数)
// 注意：此函数与 js/process/translation.js 中的 buildCustomApiConfig 功能类似，
// 未来可以考虑合并或共享，但目前保持独立，以明确 api.js 的职责是纯粹的API交互。
function buildCustomApiConfigForTest(key, customApiEndpoint, customModelId, customRequestFormat, temperature, max_tokens) {
    let apiEndpoint = customApiEndpoint;
    if (typeof window.modelDetector !== 'undefined') {
        const fullEndpoint = window.modelDetector.getFullApiEndpoint();
        if (fullEndpoint) apiEndpoint = fullEndpoint;
    }
    // ... (此处省略与 translation.js 中类似的具体格式构建逻辑，
    // 因为 testModelKey 直接调用 translateMarkdown, 而 translateMarkdown 内部会构建这些)
    // 这个函数如果仅由 testModelKey 的旧版间接使用，可能不再需要细节实现。
    // 如果 testModelKey 要独立实现API调用，则这里需要完整实现。
    // 当前 testModelKey 直接使用 translateMarkdown，所以此函数可能不再被直接调用。
    return {
        endpoint: apiEndpoint,
        modelName: customModelId,
        headers: { 'Content-Type': 'application/json' },
        // bodyBuilder and responseExtractor would be set here if callTranslationApi was used directly by testModelKey
    };
}


// =====================
// Key 测试函数
// =====================

/**
 * 测试某个模型的key是否可用（测活）
 * @param {string} modelName - 模型名 (e.g., 'mistral', 'deepseek', 'custom')
 * @param {string} keyValue - API Key 值
 * @param {Object} modelConfig - 该模型的配置（对于custom模型，包含apiEndpoint, modelId, requestFormat等；对于预设模型，可能为空或包含少量特定配置）
 * @returns {Promise<boolean>} true 如果可用, false 如果不可用
 */
async function testModelKey(modelName, keyValue, modelConfig) {
    try {
        if (typeof window.translateMarkdown !== 'function') {
            // 尝试从 processModule 加载 (如果项目结构如此)
            if (typeof processModule !== 'undefined' && typeof processModule.translateMarkdown === 'function') {
                window.translateMarkdown = processModule.translateMarkdown;
            } else {
                console.error('translateMarkdown function is not available globally or on processModule.');
                throw new Error('translateMarkdown 未加载，无法测试Key');
            }
        }

        // 构造最小请求内容
        const testText = 'Hello'; // 使用更短的文本进行测试
        const targetLang = 'zh'; // 使用语言代码，假设 translateMarkdown 内部能处理

        let effectiveModelTypeForTranslateMarkdown = modelName;
        // modelConfig is already the specific source site config when modelName starts with 'custom_source_'
        // or it's the general config for preset models.

        if (modelName.startsWith('custom_source_')) {
            effectiveModelTypeForTranslateMarkdown = 'custom';
            // modelConfig (the 3rd argument to testModelKey) is already the correct source site config object
            // passed from ui.js -> handleTestKey, so no change needed for it here for this case.
        }

        // 调用 translateMarkdown 进行测试。
        // 它内部会根据 modelName 和 modelConfig (特别是对custom模型) 来构建实际的API请求。
        let result;
        if (effectiveModelTypeForTranslateMarkdown === 'custom') {
            // custom 模型，传 modelConfig
            result = await window.translateMarkdown(
                testText,
                targetLang,
                effectiveModelTypeForTranslateMarkdown,
                keyValue,
                modelConfig,
                '[KeyTest]',
                null,
                null,
                false,
                false
            );
        } else {
            // 预设模型，不传 modelConfig
            result = await window.translateMarkdown(
                testText,
                targetLang,
                effectiveModelTypeForTranslateMarkdown,
                keyValue,
                '[KeyTest]',
                null,
                null,
                false,
                false
            );
        }

        // 简单检查是否有字符串结果返回
        if (typeof result === 'string' && result.length > 0) {
            return true; // Key is considered valid
        }
        console.warn(`Key test for ${modelName} returned non-string or empty result:`, result);
        return false; // Key might be valid but API call didn't behave as expected for translation

    } catch (e) {
        console.error(`Key test failed for model ${modelName} (key: ...${keyValue.slice(-4)}):`, e.message);
        return false; // Error occurred, key is invalid or configuration is wrong
    }
}


// --- 导出 API 相关函数 ---
// (如果使用模块化)
// export { uploadToMistral, getMistralSignedUrl, callMistralOcr, deleteMistralFile, callTranslationApi, getApiError, testModelKey };