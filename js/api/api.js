// js/api.js

// =====================
// API 相关工具函数与管理器
// =====================

// 从 ui.js 或其他模块导入所需的函数 (如果使用模块化)
// import { addProgressLog, showNotification } from './ui.js';

// ---------------------
// API 错误信息提取工具
// ---------------------
/**
 * 统一从 API 响应中提取错误信息，便于调试和用户提示。
 *
 * 主要逻辑:
 * 1. 尝试读取响应体文本。
 * 2. 尝试将响应体文本解析为 JSON 对象。
 * 3. 从 JSON 对象中提取常见的错误信息字段 (如 `error.message`, `message`, `detail`)。
 * 4. 如果解析 JSON 失败或不是 JSON 格式，则直接使用响应体文本或 HTTP 状态信息。
 * 5. 对最终的错误信息进行截断，以避免过长的信息导致 UI 问题。
 *
 * @param {Response} response - Fetch API 的 Response 对象。
 * @param {string} defaultMessage - 当无法从响应中提取具体错误信息时使用的默认消息。
 * @returns {Promise<string>} 提取并格式化后的错误信息字符串。
 */
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

/**
 * 上传文件到 Mistral API。
 * 该函数用于将本地文件发送到 Mistral 的文件服务，通常是进行 OCR 等操作的前置步骤。
 *
 * @param {File} fileToProcess - 需要上传的 File 对象。
 * @param {string} mistralKey - Mistral API 密钥。
 * @returns {Promise<string>} 上传成功后返回 Mistral 文件 ID。
 * @throws {Error} 如果上传失败（例如网络错误、认证失败、API 返回错误），则抛出错误。
 *                 特别地，如果状态码为 401，会提示 API Key 无效。
 */
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

/**
 * 获取 Mistral 文件的签名 URL。
 * 此 URL 用于授权后续的操作，例如在该文件上执行 OCR。
 *
 * @param {string} fileId - 已上传到 Mistral 的文件 ID。
 * @param {string} mistralKey - Mistral API 密钥。
 * @returns {Promise<string>} 获取到的签名 URL。
 * @throws {Error} 如果获取签名 URL 失败（例如文件 ID 无效、认证失败），则抛出错误。
 */
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

/**
 * 调用 Mistral OCR API 对指定文档进行文字识别。
 *
 * @param {string} signedUrl - 通过 `getMistralSignedUrl` 获取到的已签名文档 URL。
 * @param {string} mistralKey - Mistral API 密钥。
 * @returns {Promise<Object>} OCR 处理成功后返回的 JSON 对象，包含识别出的页面文本和结构信息。
 * @throws {Error} 如果 OCR 处理失败（例如 URL 无效、API Key 错误、处理超时），则抛出错误。
 */
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

/**
 * 删除已上传到 Mistral 的文件，以释放云端存储空间。
 * 此函数在执行删除操作时，如果遇到失败，仅会在控制台打印警告，不会向上抛出错误中断主流程。
 *
 * @param {string} fileId - 需要删除的 Mistral 文件 ID。
 * @param {string} apiKey - Mistral API 密钥。
 * @returns {Promise<void>} 无明确返回值。
 */
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

/**
 * 封装实际的翻译 API 调用逻辑。
 * 此函数根据传入的配置对象 (`effectiveConfig`) 和请求体 (`requestBody`)，
 * 向指定的翻译 API 端点发送 POST 请求，并处理响应。
 *
 * 主要逻辑:
 * 1. 参数校验：确保 `effectiveConfig` 包含 `endpoint`。
 * 2. 头部设置：确保 `headers` 存在，并设置 `Accept` 头部优先接受 JSON。
 * 3. 发起请求：使用 `fetch` API 发送 POST 请求。
 * 4. 错误处理：
 *    - 如果响应不成功 (`!response.ok`)，调用 `getApiError` 提取错误信息并抛出。
 *    - 检查响应的 `Content-Type` 是否为 JSON。如果不是，则抛出错误，提示检查 API Endpoint 配置。
 * 5. 结果提取：
 *    - 将响应体解析为 JSON。
 *    - 使用 `effectiveConfig.responseExtractor` (如果提供) 从 JSON 数据中提取翻译后的文本内容。
 *      如果未提供提取器，则使用默认提取逻辑 (通常适用于 OpenAI 格式的响应)。
 *    - 如果无法提取到内容，则抛出错误。
 * 6. 返回结果：返回提取并去除首尾空格的翻译文本。
 *
 * @param {Object} effectiveConfig - 生效的 API 配置对象。
 *   必须包含 `endpoint` (string): API 请求的完整 URL。
 *   可选包含 `headers` (Object): HTTP 请求头部。
 *   可选包含 `responseExtractor` (function): 从 API 响应 JSON 中提取翻译结果的函数。
 * @param {Object} requestBody - 发送给翻译 API 的请求体 JSON 对象。
 * @returns {Promise<string>} 翻译后的文本内容。
 * @throws {Error} 如果 API 调用失败、响应格式不正确、或无法提取翻译内容，则抛出错误。
 */
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
// (此函数在当前版本中可能未被直接调用或功能已简化，因为 testModelKey 现在依赖 translateMarkdown)
/**
 * [测试用/可能已部分废弃] 构建用于测试的自定义 API 配置。
 * 此函数旨在为 `testModelKey` 或类似测试场景创建一个简化的 API 配置对象。
 * 在当前实现中，由于 `testModelKey` 直接使用 `translateMarkdown`，此函数的完整构建逻辑可能已被省略或不再活跃。
 * 如果需要让 `testModelKey` 独立进行 API 调用，则需要在此处完整实现配置构建逻辑。
 *
 * @param {string} key - API 密钥。
 * @param {string} customApiEndpoint - 自定义 API 的端点 URL。
 * @param {string} customModelId - 自定义模型的 ID。
 * @param {string} customRequestFormat - 自定义请求的格式 (如 'openai', 'anthropic', 'gemini')。
 * @param {number} [temperature] - (可选) 模型温度参数。
 * @param {number} [max_tokens] - (可选) 最大 token 数。
 * @returns {Object} 一个包含 `endpoint`, `modelName`, `headers` 的基础配置对象。
 *                   如果由此函数直接支持 `callTranslationApi`，则还应包含 `bodyBuilder` 和 `responseExtractor`。
 */
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
 * 测试指定模型及其 API Key 的可用性（"测活"）。
 * 此函数通过尝试使用给定的模型和 Key 进行一次小规模的翻译请求来验证其有效性。
 * 它依赖于全局或 `processModule` 下可用的 `translateMarkdown` 函数来执行实际的 API 调用。
 *
 * 主要逻辑:
 * 1. 检查 `translateMarkdown` 函数是否可用，如果不可用则抛出错误。
 * 2. 构造一个简短的测试文本和目标语言。
 * 3. 根据 `modelName` 判断是预设模型还是自定义模型：
 *    - 如果 `modelName` 以 `custom_source_` 开头，则视为自定义模型，并将 `modelConfig` 作为配置传递给 `translateMarkdown`。
 *    - 否则，视为预设模型，不传递 `modelConfig` 的详细内容。
 * 4. 调用 `translateMarkdown` 发起测试翻译。
 *    - 为 `translateMarkdown` 传递必要的参数，包括测试文本、目标语言、模型类型、API Key、以及针对性的日志上下文和提示（或禁用它们）。
 *    - 特别注意，对于自定义模型，会将 `modelConfig` 参数 (即 `testModelKey` 的第三个参数) 传递给 `translateMarkdown`。
 * 5. 结果判断：如果 `translateMarkdown` 返回一个非空字符串，则认为 Key 有效。
 * 6. 错误处理：捕获 `translateMarkdown` 可能抛出的任何错误，并将其视为 Key 无效或配置错误。
 *
 * @param {string} modelName - 要测试的模型名称。
 *   - 对于预设模型，例如 'mistral', 'deepseek'。
 *   - 对于自定义源站点模型，格式为 'custom_source_xxxx'，其中 xxxx 是源站点 ID。
 * @param {string} keyValue - 要测试的 API Key。
 * @param {Object} modelConfig - 模型的配置对象。
 *   - 对于 `modelName` 为 'custom' 或 'custom_source_...' 的情况，此对象包含自定义 API 的详细信息
 *     (如 `apiEndpoint`/`apiBaseUrl`, `modelId`, `requestFormat`, `temperature`, `max_tokens` 等)。
 *     这些信息会传递给 `translateMarkdown` 内部的 `buildCustomApiConfig`。
 *   - 对于预设模型，此参数可能为空或不被 `translateMarkdown` 的预设模型路径直接使用（因为它会自行查找预设配置）。
 * @returns {Promise<boolean>} 如果 Key 测试成功（API 调用成功并返回了内容），则返回 `true`；否则返回 `false`。
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

        // 生图模型的测活，直接调用 ImageGeneration 生成一张小图，避免走翻译路径
        if (modelName === 'gemini-image' || modelName === 'openai-image') {
            if (!window.ImageGeneration || typeof window.ImageGeneration.generateImage !== 'function') {
                throw new Error('生图适配器未加载，无法测试 Key');
            }
            const cfg = modelConfig || {};
            const modelId = cfg.modelId || (modelName === 'gemini-image' ? 'gemini-2.5-flash-image' : 'gpt-image-1');
            await window.ImageGeneration.generateImage({
                provider: modelName,
                model: modelId,
                prompt: 'health check image',
                width: 512,
                height: 512,
                maxKB: 400,
                apiKey: keyValue
            });
            return true;
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
