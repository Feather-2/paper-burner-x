// process/translation.js

// 辅助函数：构建预定义 API 配置
/**
 * 为预定义的翻译模型构建 API 请求配置。
 * 此函数接收一个基础的 API 配置对象 (`apiConfig`) 和 API 密钥 (`key`)，
 * 然后根据模型名称（从 `apiConfig.modelName` 中提取并转换为小写）来设置特定的认证头部。
 *
 * 主要逻辑：
 * 1. **配置浅拷贝**：创建 `apiConfig` 和 `apiConfig.headers` 的浅拷贝，以避免修改原始对象。
 * 2. **认证头部设置**：
 *    - 将 `config.modelName` 转为小写进行比较。
 *    - 如果模型名称包含 "claude"，则在头部设置 `x-api-key`。
 *    - 如果模型名称包含 "gemini"，则将 API 密钥作为查询参数 `key` 追加到端点 URL。
 *      它会正确处理端点 URL 中可能已存在的查询参数。
 *    - 对于其他模型（如 Mistral, DeepSeek 等），默认在头部设置 `Authorization: Bearer {key}`。
 * 3. **返回配置**：返回更新后的配置对象。
 *
 * @param {Object} apiConfig - 预定义模型的初始配置对象，通常包含 `endpoint`, `modelName`, `headers`, `bodyBuilder`, `responseExtractor`。
 * @param {string} key - 用于认证的 API 密钥。
 * @returns {Object} 添加了认证头部（或更新了端点）的完整 API 配置对象。
 */
function buildPredefinedApiConfig(apiConfig, key) {
    const config = { ...apiConfig }; // 浅拷贝
    config.headers = { ...config.headers }; // 浅拷贝 headers

    // 设置认证 - 添加防御性检查，避免在modelName为undefined时调用toLowerCase()
    const modelNameLower = config.modelName ? config.modelName.toLowerCase() : '';

    if (modelNameLower.includes('claude')) {
        config.headers['x-api-key'] = key;
    } else if (modelNameLower.includes('gemini')) {
        // Correctly handle potential existing query parameters
        let baseUrl = config.endpoint.split('?')[0];
        config.endpoint = `${baseUrl}?key=${key}`;
    } else if (modelNameLower.includes('deeplx')) {
        const encodedKey = encodeURIComponent(key.trim());
        const placeholderPatterns = ['{API_KEY}', '{api_key}', '{apiKey}', '{key}', '__API_KEY__', '<api-key>', '<API_KEY>', ':API_KEY', ':api_key', ':key', '${API_KEY}', '${api_key}'];
        let endpoint = config.endpoint || '';
        let replaced = false;
        placeholderPatterns.forEach(function(pattern) {
            if (endpoint.includes(pattern)) {
                endpoint = endpoint.replace(new RegExp(pattern, 'g'), encodedKey);
                replaced = true;
            }
        });
        if (!replaced) {
            // 如果模板中未包含占位符，则尝试在末尾追加 Key
            if (!endpoint.endsWith('/')) endpoint += '/';
            endpoint += encodedKey;
        }
        config.endpoint = endpoint;
        // DeepLX 接口通常不需要 Authorization 头，确保移除可能的残留
        if (config.headers['Authorization']) delete config.headers['Authorization'];
    } else {
        config.headers['Authorization'] = `Bearer ${key}`;
    }
    return config;
}


function buildInstructionBlock(content) {
    const trimmed = (content || '').trim();
    if (!trimmed) return '';
    return `[[PBX_INSTR_START]]
${trimmed}
[[PBX_INSTR_END]]

`;
}

function stripInstructionBlocks(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/\s*\[\[PBX_INSTR_START\]\][\s\S]*?\[\[PBX_INSTR_END\]\]\s*/gi, '').trim();
}


const DEEPLX_LANG_CODE_MAP = {
    'bulgarian': 'BG', 'bg': 'BG', 'български': 'BG', '保加利亚语': 'BG',
    'chinese': 'ZH', 'zh': 'ZH', 'zh-cn': 'ZH', 'zh_cn': 'ZH', '中文': 'ZH', '中文(简体)': 'ZH', '简体中文': 'ZH', 'traditional chinese': 'ZH', 'zh-tw': 'ZH', 'zh_tw': 'ZH', '中文(繁体)': 'ZH', '繁体中文': 'ZH',
    'czech': 'CS', 'cs': 'CS', 'čeština': 'CS', '捷克语': 'CS',
    'danish': 'DA', 'da': 'DA', 'dansk': 'DA', '丹麦语': 'DA',
    'dutch': 'NL', 'nl': 'NL', 'nederlands': 'NL', '荷兰语': 'NL',
    'english': 'EN', 'en': 'EN', 'english (uk)': 'EN', 'english (gb)': 'EN', 'en-gb': 'EN', 'english (us)': 'EN', 'en-us': 'EN', 'english (american)': 'EN', '英语': 'EN',
    'estonian': 'ET', 'et': 'ET', 'eesti': 'ET', '爱沙尼亚语': 'ET',
    'finnish': 'FI', 'fi': 'FI', 'suomi': 'FI', '芬兰语': 'FI',
    'french': 'FR', 'fr': 'FR', 'français': 'FR', '法语': 'FR',
    'german': 'DE', 'de': 'DE', 'deutsch': 'DE', '德语': 'DE',
    'greek': 'EL', 'el': 'EL', 'ελληνικά': 'EL', '希腊语': 'EL',
    'hungarian': 'HU', 'hu': 'HU', 'magyar': 'HU', '匈牙利语': 'HU',
    'italian': 'IT', 'it': 'IT', 'italiano': 'IT', '意大利语': 'IT',
    'japanese': 'JA', 'ja': 'JA', '日本語': 'JA', '日语': 'JA',
    'latvian': 'LV', 'lv': 'LV', 'latviešu': 'LV', '拉脱维亚语': 'LV',
    'lithuanian': 'LT', 'lt': 'LT', 'lietuvių': 'LT', '立陶宛语': 'LT',
    'polish': 'PL', 'pl': 'PL', 'polski': 'PL', '波兰语': 'PL',
    'portuguese': 'PT', 'pt': 'PT', 'português': 'PT', 'portuguese (portugal)': 'PT', '葡萄牙语': 'PT', '葡萄牙语（葡萄牙）': 'PT', '葡萄牙语（巴西）': 'PT', 'portuguese (brazil)': 'PT', 'pt-br': 'PT',
    'romanian': 'RO', 'ro': 'RO', 'română': 'RO', '罗马尼亚语': 'RO',
    'russian': 'RU', 'ru': 'RU', 'русский': 'RU', '俄语': 'RU'
};



const DEEPLX_LANG_DISPLAY = {
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





function mapToDeeplxLangCode(targetLang) {
    if (!targetLang) return undefined;
    const normalized = String(targetLang).trim();
    if (!normalized) return undefined;
    const lower = normalized.toLowerCase();
    if (DEEPLX_LANG_CODE_MAP[lower]) {
        return DEEPLX_LANG_CODE_MAP[lower];
    }
    if (/^[a-z]{2}$/i.test(normalized)) {
        return normalized.toUpperCase();
    }
    if (/^[a-z]{2}-[a-z]{2}$/i.test(normalized)) {
        return normalized.toUpperCase();
    }
    return undefined;
}

if (typeof window !== 'undefined') {
    window.mapToDeeplxLangCode = mapToDeeplxLangCode;
    window.DEEPLX_LANG_CODE_MAP = DEEPLX_LANG_CODE_MAP;
    window.DEEPLX_LANG_DISPLAY = DEEPLX_LANG_DISPLAY;
    if (typeof window.updateDeeplxTargetLangHint === 'function') {
        try { window.updateDeeplxTargetLangHint(); } catch (e) { console.warn('updateDeeplxTargetLangHint failed', e); }
    }
}

// 辅助函数：构建自定义 API 配置
/**
 * 为用户自定义的翻译模型构建 API 请求配置。
 * 此函数根据用户提供的基础 URL、模型 ID、请求格式、密钥以及可选的温度和最大 token 数，
 * 生成一个完整的、可用于调用自定义翻译 API 的配置对象。
 *
 * 主要逻辑：
 * 1. **基础 URL 处理**：
 *    - 移除 `baseApiUrlInput` 末尾可能存在的斜杠 `/`。
 * 2. **端点构建**：
 *    - `finalApiEndpoint` 初始化为处理后的 `baseApiUrl`。
 *    - 定义一个常见的 OpenAI 兼容路径后缀 `commonPathSuffix` (即 `/v1/chat/completions`)。
 *    - **特殊处理 Gemini**：如果 `customRequestFormat` 是 'gemini' 或 'gemini-preview'，则不追加通用后缀，因为 Gemini 的端点结构不同，通常由用户提供更完整的路径，并且 API 密钥会作为查询参数添加。
 *    - **通用后缀追加**：对于非 Gemini 格式，如果 `baseApiUrl` 尚未包含 `/v1/chat/completions` 或 `/v1/messages` (针对 Anthropic 类接口的简单检查)，则将 `commonPathSuffix` 追加到 `baseApiUrl`。
 * 3. **初始化配置对象**：创建包含 `endpoint`, `modelName`, `headers` (默认 `Content-Type: application/json`), `bodyBuilder`, 和 `responseExtractor` 的 `config` 对象。
 * 4. **根据 `customRequestFormat` 配置特定部分**：
 *    - **'openai'**：设置 `Authorization: Bearer {key}` 头部；定义 `bodyBuilder` 以构建 OpenAI 格式的消息体；定义 `responseExtractor` 以从响应中提取 `choices[0].message.content`。
 *    - **'anthropic'**：设置 `x-api-key: {key}` 和 `anthropic-version: 2023-06-01` 头部；定义 `bodyBuilder` 以构建 Anthropic 格式的消息体（包含 `system` prompt 和 `messages` 数组）；定义 `responseExtractor` 以提取 `content[0].text`。
 *      - *注意*：对于 Anthropic，如果用户提供的 `baseApiUrl` 比较基础（如 `https://api.anthropic.com`），并且未被自动追加 OpenAI 的后缀，则可能需要用户提供更完整的路径（如包含 `/v1/messages`）。
 *    - **'gemini' / 'gemini-preview'**：将 API 密钥作为查询参数 `?key={key}` 追加到 `finalApiEndpoint`；定义 `bodyBuilder` 以构建 Gemini 的 `contents` 结构 (将系统提示和用户提示合并到用户角色的 `parts` 中) 和 `generationConfig`；定义 `responseExtractor` 以提取 `candidates[0].content.parts[0].text`。
 *    - **default (回退)**：如果 `customRequestFormat` 不被显式支持，则默认按 OpenAI 兼容格式处理，并打印警告。设置 `Authorization` 头部，并使用 OpenAI 类似的 `bodyBuilder` 和 `responseExtractor`。
 * 5. **返回配置**：返回构建好的 `config` 对象。
 *
 * @param {string} key - API 密钥。
 * @param {string} baseApiUrlInput - 用户提供的 API 基础 URL (例如 `https://api.example.com` 或 `https://api.gemini.example/v1beta/models/gemini-pro:generateContent`)。
 * @param {string} customModelId - 用户指定的模型 ID (例如 `gpt-3.5-turbo`, `claude-2`, `gemini-pro`)。
 * @param {string} customRequestFormat - 请求体和响应体的格式类型 (如 'openai', 'anthropic', 'gemini')。
 * @param {number} [temperature] - (可选) 模型生成时的温度参数。
 * @param {number} [max_tokens] - (可选) 模型生成的最大 token 数。
 * @returns {Object} 构建好的 API 配置对象，包含 `endpoint`, `modelName`, `headers`, `bodyBuilder`, `responseExtractor`。
 */
function buildCustomApiConfig(key, baseApiUrlInput, customModelId, customRequestFormat, temperature, max_tokens) {
    let baseApiUrl = baseApiUrlInput.trim();
    if (baseApiUrl.endsWith('/')) {
        baseApiUrl = baseApiUrl.slice(0, -1);
    }

    let finalApiEndpoint = baseApiUrl;
    let commonPathSuffix = '/v1/chat/completions'; // Default, common for OpenAI-like APIs

    // For Gemini, the endpoint structure is different and usually includes the model and action.
    // The key is also a query parameter, not usually part of a path suffix.
    // So, if the format is Gemini, we assume baseApiUrl is already mostly complete or doesn't need this common suffix.
    if (customRequestFormat !== 'gemini' && customRequestFormat !== 'gemini-preview') {
        // Append common path suffix if not already present in a significant way
        // This check is basic. If baseApiUrl is e.g. https://api.example.com/custom/path
        // and pathSuffix is /v1/chat/completions, it will append.
        // It won't append if baseApiUrl is https://api.example.com/v1/chat/completions already.
        if (!baseApiUrl.endsWith(commonPathSuffix) && !baseApiUrl.includes('/v1/chat/completions') && !baseApiUrl.includes('/v1/messages') /* basic check for anthropic-like */) {
            finalApiEndpoint = baseApiUrl + commonPathSuffix;
        }
    }
    // If customRequestFormat is gemini, finalApiEndpoint remains baseApiUrl, and the key will be added as a query param later.

    const config = {
        endpoint: finalApiEndpoint, // This is now the base path, or base + common suffix (excluding Gemini)
        modelName: customModelId,
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: null,
        responseExtractor: null
    };

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
        case 'anthropic':
            // Anthropic might also use a specific path like /v1/messages. If baseApiUrl doesn't include it,
            // the generic suffix logic might have added /v1/chat/completions. This might need refinement
            // if a user provides just "https://api.anthropic.com" and expects /v1/messages.
            // For now, assuming user provided a more complete base for Anthropic if not OpenAI-like.
            if (!config.endpoint.endsWith('/v1/messages') && !config.endpoint.includes('/v1/messages')) {
                 // If user provided just a base and we appended openai suffix, but format is anthropic, this could be an issue.
                 // A better approach for anthropic would be to have its own specific suffix or expect fuller baseApiUrl.
                 // Let's assume if format is anthropic and suffix wasn't auto-added, it implies baseApiUrl is complete or suffix is not standard.
            }
            config.headers['x-api-key'] = key;
            config.headers['anthropic-version'] = '2023-06-01';
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                model: customModelId,
                system: sys_prompt,
                messages: [{ role: "user", content: user_prompt }],
                temperature: temperature ?? 0.5,
                max_tokens: max_tokens ?? 8000
            });
            config.responseExtractor = (data) => data?.content?.[0]?.text;
            break;
        case 'gemini':
        case 'gemini-preview': // Fall-through for gemini-preview
            // The finalApiEndpoint here is effectively the baseApiUrl provided by the user.
            // It should be the path up to, e.g., ".../gemini-pro:generateContent"
            config.endpoint = `${finalApiEndpoint}?key=${key}`; // API key as query parameter
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                contents: [{ role: "user", parts: [{ text: `${sys_prompt}\n\n${user_prompt}` }] }],
                generationConfig: { temperature: temperature ?? 0.5, maxOutputTokens: max_tokens ?? 8192 }
            });
            config.responseExtractor = (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text;
            break;
        default:
            // Fallback for unknown formats, treat like OpenAI for endpoint construction if suffix was added.
            config.headers['Authorization'] = `Bearer ${key}`;
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                model: customModelId,
                messages: [{ role: "system", content: sys_prompt }, { role: "user", content: user_prompt }],
                temperature: temperature ?? 0.5,
                max_tokens: max_tokens ?? 8000
            });
            config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
            console.warn(`Unsupported custom request format: ${customRequestFormat}. Defaulting to OpenAI-like structure.`);
            break;
    }
    return config;
}

/**
 * 翻译单个 Markdown 文本块，支持预定义模型和自定义模型，并可选择性处理内嵌的表格占位符。
 *
 * 主要步骤：
 * 1. **参数处理与兼容性**：
 *    - 由于函数签名在支持自定义模型配置 (`modelConfig`) 时变得复杂，通过检查 `arguments` 来正确解析传入的参数，
 *      特别是当 `model` 为 "custom" 时，`modelConfigForCustom` 从 `arguments[4]` 获取，后续参数依次顺延。
 * 2. **表格预处理** (如果 `actualProcessTablePlaceholders` 为 true 且 `protectMarkdownTables` 函数可用)：
 *    - 调用 `protectMarkdownTables` 将 Markdown 中的表格替换为占位符 (如 `__TABLE_PLACEHOLDER_0__`)。
 *    - 存储原始表格内容在 `tablePlaceholders` 中。
 *    - 如果检测到表格，则在系统提示中追加说明，告知模型如何处理这些占位符（即保持不变）。
 * 3. **构建 Prompt**：
 *    - 初始化 `systemPrompt` 和 `userPrompt`。
 *    - 如果使用了表格保护，则向 `systemPrompt` 追加关于如何处理表格占位符的指示。
 *    - 如果未使用自定义提示 (`!actualUseCustomPrompts`) 或者自定义提示为空，则调用 `getBuiltInPrompts` (如果可用) 获取内置的针对目标语言的提示模板，否则使用非常基础的兜底提示。
 *    - **替换模板变量**：在最终的 `userPrompt` 中，将 `${targetLangName}` 替换为实际的目标语言名称，将 `${content}` 替换为经过表格预处理的文本 (`processedText`)。
 *    - *警告检查*：如果最终的 `userPrompt` 未包含 `processedText`，则打印警告，因为模型可能无法接收到待翻译内容。
 * 4. **构建 API 配置 (`apiConfig`)**：
 *    - 如果 `model` 是 "custom"：
 *      - 检查 `modelConfigForCustom` 是否有效（包含端点和模型 ID）。
 *      - 调用 `buildCustomApiConfig` 生成配置。
 *    - 否则（预定义模型）：
 *      - 从全局设置 (`loadSettings`) 中获取温度和最大 token 数等参数。
 *      - 定义一个包含各预设模型（如 'deepseek', 'gemini', 'mistral', 'tongyi-...', 'volcano-...'）详细配置的 `predefinedConfigs` 对象。
 *        每个模型的配置包括 `endpoint`, `modelName`, `headers`, `bodyBuilder`, `responseExtractor`。
 *      - 检查选定的 `model` 是否在 `predefinedConfigs` 中，如果不在则抛出错误。
 *      - 调用 `buildPredefinedApiConfig` 生成配置。
 * 5. **构建请求体 (`requestBody`)**：
 *    - 使用 `apiConfig.bodyBuilder` (如果存在) 并传入 `systemPrompt` 和 `userPrompt` 来构建请求体。
 *    - 如果 `bodyBuilder` 不存在，则构建一个通用的包含 `model` 和 `messages` (system + user) 的请求体。
 * 6. **调用翻译 API**：
 *    - 调用 `callTranslationApi` (应为实际的 fetch 调用封装) 并传入 `apiConfig` 和 `requestBody`，获取翻译结果 `result`。
 * 7. **表格后处理** (如果之前进行了表格保护且 `actualProcessTablePlaceholders` 为 true 且 `extractTableFromTranslation` 函数可用)：
 *    - **逐个翻译表格内容**：
 *      - 遍历 `tablePlaceholders` 中的每个原始表格。
 *      - 为每个表格构建特定的翻译提示（强调保持结构，仅翻译文本）。
 *      - 再次调用 `callTranslationApi` 翻译该表格。
 *      - 使用 `extractTableFromTranslation` 从翻译结果中提取纯净的表格 Markdown。
 *      - 在主翻译结果 `finalResult` (初始为 `result`) 中，用翻译后的表格替换其占位符。
 *      - 如果表格翻译或提取失败，则用原始表格替换占位符作为兜底。
 *    - 返回包含已翻译并恢复表格的 `finalResult`。
 * 8. **直接返回结果**：如果未进行表格处理，则直接返回步骤 6 中得到的 `result`。
 *
 * @param {string} markdown - 待翻译的 Markdown 文本块。
 * @param {string} targetLang - 目标翻译语言代码 (如 'zh-CN', 'en')。
 * @param {string} model - 使用的翻译模型名称 (如 'mistral', 'custom', 'deepseek')。
 * @param {string} apiKey - 对应翻译模型的 API 密钥。
 * @param {string} [logContext=""] - (或 `modelConfig` 当 `model`='custom') 日志记录的上下文前缀。如果 `model` 为 "custom"，此位置应为 `modelConfig` 对象，后续参数顺延。
 * @param {string} [defaultSystemPrompt=""] - (顺延参数) 翻译时使用的默认系统提示词。
 * @param {string} [defaultUserPromptTemplate=""] - (顺延参数) 翻译时使用的默认用户提示词模板 (应包含 `${content}` 和 `${targetLangName}` 占位符)。
 * @param {boolean} [useCustomPrompts=false] - (顺延参数) 是否使用用户自定义的提示词。
 * @param {boolean} [processTablePlaceholders=true] - (顺延参数) 是否对文本中的 Markdown 表格进行占位符保护和独立翻译处理。
 * @returns {Promise<string>} 翻译后的 Markdown 文本块。如果处理了表格，则表格内容也会被翻译并恢复到文本中。
 * @throws {Error} 如果模型名称不支持、自定义模型配置不完整，或在API调用过程中发生不可恢复的错误。
 */
async function translateMarkdown(
    markdown,
    targetLang,
    model,
    apiKey,
    logContext = "",
    defaultSystemPrompt = "",
    defaultUserPromptTemplate = "",
    useCustomPrompts = false,
    processTablePlaceholders = true,
    options = {}
) {
    //console.log('translateMarkdown 分块内容:', markdown);

    let actualLogContext = logContext;
    let actualDefaultSystemPrompt = defaultSystemPrompt;
    let actualDefaultUserPromptTemplate = defaultUserPromptTemplate;
    let actualUseCustomPrompts = useCustomPrompts;
    let actualProcessTablePlaceholders = processTablePlaceholders;
    let modelConfigForCustom = null;

    if (model === "custom") {
        modelConfigForCustom = arguments[4]; // 这是从调用处传来的 modelConfig
        actualLogContext = arguments[5] !== undefined ? arguments[5] : "";
        actualDefaultSystemPrompt = arguments[6] !== undefined ? arguments[6] : "";
        actualDefaultUserPromptTemplate = arguments[7] !== undefined ? arguments[7] : "";
        actualUseCustomPrompts = arguments[8] !== undefined ? arguments[8] : false;
        actualProcessTablePlaceholders = arguments[9] !== undefined ? arguments[9] : true;
        options = arguments[10] !== undefined ? arguments[10] : {};
    }

    // 表格预处理 - 仅当需要处理表格时
    let processedText = markdown;
    let tablePlaceholders = {};
    let hasProtectedTables = false;

    if (actualProcessTablePlaceholders && typeof protectMarkdownTables === 'function') {
        const processed = protectMarkdownTables(markdown);
        processedText = processed.processedText;
        tablePlaceholders = processed.tablePlaceholders;
        hasProtectedTables = Object.keys(tablePlaceholders).length > 0;

        if (hasProtectedTables) {
            console.log(`${actualLogContext} 检测到 ${Object.keys(tablePlaceholders).length} 个表格，已进行特殊保护`);
            if (typeof addProgressLog === "function") {
                addProgressLog(`${actualLogContext} 检测到 ${Object.keys(tablePlaceholders).length} 个表格，将作为整体处理`);
            }
        }
    }

    // 构建 prompt - 集成提示词池支持
    let systemPrompt = actualDefaultSystemPrompt;
    let userPrompt = actualDefaultUserPromptTemplate;

    // 增加表格处理提示
    let tableHandlingNote = "";
    if (hasProtectedTables) {
        tableHandlingNote = "\n\n注意：文档中的表格已被特殊标记为占位符（如__TABLE_PLACEHOLDER_0__），请直接翻译占位符以外的内容，保持占位符不变。表格将在后续步骤中单独处理。";
    }

    // 检查是否应该使用提示词池（支持外部绑定覆盖）
    let usePromptPool = false;
    let promptFromPool = null;
    
    // 尝试从提示词池UI获取提示词（如果可用）
    if (!options.boundPrompt && typeof window !== 'undefined' && window.promptPoolUI) {
        const poolPrompt = window.promptPoolUI.getPromptForTranslation();
        if (poolPrompt) {
            // 仅当提示词非空时才启用提示词池
            const sys = (poolPrompt.systemPrompt || '').trim();
            const usr = (poolPrompt.userPromptTemplate || '').trim();
            if (sys && usr) {
                promptFromPool = poolPrompt;
                usePromptPool = true;
            }
        }
    }
    // 如果调用方传入 boundPrompt，则优先使用
    if (options.boundPrompt && options.boundPrompt.id && options.boundPrompt.systemPrompt && options.boundPrompt.userPromptTemplate) {
        promptFromPool = options.boundPrompt;
        usePromptPool = true;
    }

    // 根据提示词来源设置提示词
    if (usePromptPool && promptFromPool) {
        // 使用提示词池的提示词（再次防御非空）
        const sys = (promptFromPool.systemPrompt || '').trim();
        const usr = (promptFromPool.userPromptTemplate || '').trim();
        if (sys && usr) {
            systemPrompt = sys + tableHandlingNote;
            userPrompt = usr;
            console.log(`[翻译] 使用提示词池的提示词`);
        } else {
            usePromptPool = false; // 回退
        }
    }

    if (!usePromptPool) {
      if (!actualUseCustomPrompts || !systemPrompt || !userPrompt) {
        // 使用内置模板或后备方案
        if (typeof getBuiltInPrompts === "function") {
            const prompts = getBuiltInPrompts(targetLang);
            systemPrompt = prompts.systemPrompt + tableHandlingNote;
            userPrompt = prompts.userPromptTemplate;
        } else {
            // 兜底
            systemPrompt = "You are a professional document translation assistant." + tableHandlingNote;
            userPrompt = "Please translate the following content into the target language:\n\n${content}";
        }
      } else {
        // 使用自定义提示词（再次检查非空）
        const sys = (actualDefaultSystemPrompt || '').trim();
        const usr = (actualDefaultUserPromptTemplate || '').trim();
        if (sys && usr) {
            systemPrompt = sys + tableHandlingNote;
            userPrompt = usr;
        } else {
            // 回退到内置
            if (typeof getBuiltInPrompts === "function") {
                const prompts = getBuiltInPrompts(targetLang);
                systemPrompt = prompts.systemPrompt + tableHandlingNote;
                userPrompt = prompts.userPromptTemplate;
            } else {
                systemPrompt = "You are a professional document translation assistant." + tableHandlingNote;
                userPrompt = "Please translate the following content into the target language:\n\n${content}";
            }
        }
      }
    }

    // 注入：翻译备择库（术语库）命中与提示注入
    try {
        const settingsForGlossary = (typeof loadSettings === 'function') ? loadSettings() : {};
        const glossaryEnabled = !!settingsForGlossary.enableGlossary;
        if (glossaryEnabled && typeof getGlossaryMatchesForText === 'function') {
            const matches = getGlossaryMatchesForText(processedText);
            if (matches && matches.length > 0) {
                const instr = (typeof buildGlossaryInstruction === 'function') ? buildGlossaryInstruction(matches, targetLang) : '';
                if (instr) {
                    systemPrompt = (systemPrompt || '') + "\n\n" + instr;
                    if (typeof addProgressLog === 'function') {
                        const names = matches.slice(0, 6).map(m => m.term).join(', ');
                        addProgressLog(`${actualLogContext} 命中备择库 ${matches.length} 条：${names}${matches.length>6?'...':''}`);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('Glossary injection skipped due to error:', e);
    }

    // 替换模板变量 - 使用预处理后的文本
    userPrompt = userPrompt
        .replace(/\$\{targetLangName\}/g, targetLang)
        .replace(/\$\{content\}/g, processedText);

    if (!userPrompt.includes(processedText)) {
        console.warn('警告：当前 userPrompt 模板未包含 ${content} 占位符，AI 无法获得正文内容！');
        //console.warn('当前 userPrompt:', userPrompt);
        //console.warn('当前 processedText:', processedText);
    }

    //console.log('translateMarkdown defaultUserPromptTemplate:', actualDefaultUserPromptTemplate);
    //console.log('translateMarkdown userPrompt (before replace):', userPrompt);

    // 构建 API 配置
    let apiConfig;
    if (model === "custom") {
        // 使用 modelConfigForCustom
        if (!modelConfigForCustom || (!modelConfigForCustom.apiEndpoint && !modelConfigForCustom.apiBaseUrl) || !modelConfigForCustom.modelId) {
            throw new Error('Custom model configuration is incomplete. API Endpoint (或 apiBaseUrl) and Model ID are required.');
        }
        //console.log('translateMarkdown activeModelConfig:', modelConfigForCustom);
        apiConfig = buildCustomApiConfig(
            apiKey,
            modelConfigForCustom.apiEndpoint || modelConfigForCustom.apiBaseUrl,
            modelConfigForCustom.modelId,
            modelConfigForCustom.requestFormat || 'openai',
            modelConfigForCustom.temperature !== undefined ? modelConfigForCustom.temperature : 0.5,
            modelConfigForCustom.max_tokens !== undefined ? modelConfigForCustom.max_tokens : 8000
        );
    } else {
        // 预设模型
        // 获取翻译参数
        const settings = typeof loadSettings === "function" ? loadSettings() : {};
        const temperature = (settings.customModelSettings && settings.customModelSettings.temperature) || 0.5;
        const maxTokens = (settings.customModelSettings && settings.customModelSettings.max_tokens) || 8000;

        // 允许从配置覆盖部分预设端点/模型（例如 Gemini 选择具体模型）
        let geminiEndpointDynamic = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        try {
            if (typeof loadModelConfig === 'function') {
                const gcfg = loadModelConfig('gemini');
                const preferred = gcfg && (gcfg.preferredModelId || gcfg.modelId);
                if (preferred && typeof preferred === 'string' && preferred.trim()) {
                    geminiEndpointDynamic = `https://generativelanguage.googleapis.com/v1beta/models/${preferred.trim()}:generateContent`;
                }
            }
        } catch (e) { /* ignore and use default */ }

        let deeplxEndpointTemplate = 'https://api.deeplx.org/<api-key>/translate';
        try {
            if (typeof loadModelConfig === 'function') {
                const dlcfg = loadModelConfig('deeplx');
                if (dlcfg) {
                    if (dlcfg.endpointTemplate && typeof dlcfg.endpointTemplate === 'string') {
                        deeplxEndpointTemplate = dlcfg.endpointTemplate.trim() || deeplxEndpointTemplate;
                    } else if (dlcfg.apiBaseUrlTemplate && typeof dlcfg.apiBaseUrlTemplate === 'string') {
                        deeplxEndpointTemplate = dlcfg.apiBaseUrlTemplate.trim() || deeplxEndpointTemplate;
                    } else if (dlcfg.apiBaseUrl && typeof dlcfg.apiBaseUrl === 'string') {
                        // 兼容旧字段，自动附加占位符
                        const base = dlcfg.apiBaseUrl.trim();
                        if (base) {
                            deeplxEndpointTemplate = base.endsWith('/') ? `${base}<api-key>/translate` : `${base}/<api-key>/translate`;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('加载 DeepLX 配置失败，将使用默认模板。', e);
        }

        // 更新后的预设模型配置
        const predefinedConfigs = {

            'deeplx': {
                endpoint: deeplxEndpointTemplate,
                modelName: 'DeepLX',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user, ctx = {}) => {
                    const instructionBlock = ctx && ctx.instructionBlock ? ctx.instructionBlock : buildInstructionBlock(sys);
                    const textContent = ctx && ctx.processedText ? ctx.processedText : user;
                    const payload = {
                        text: `${instructionBlock || ''}${textContent}`
                    };
                    const targetLangCode = mapToDeeplxLangCode(ctx && ctx.targetLang ? ctx.targetLang : undefined);
                    if (targetLangCode) {
                        payload.target_lang = targetLangCode;
                    }
                    if (ctx && ctx.sourceLang) {
                        const sourceCode = mapToDeeplxLangCode(ctx.sourceLang);
                        if (sourceCode) payload.source_lang = sourceCode;
                    }
                    return payload;
                },
                responseExtractor: (data) => {
                    if (!data) return '';
                    if (typeof data === 'string') return data;
                    if (typeof data.text === 'string') return data.text;
                    if (data.data) {
                        if (typeof data.data === 'string') return data.data;
                        if (typeof data.data.text === 'string') return data.data.text;
                    }
                    if (Array.isArray(data.translations) && data.translations.length > 0) {
                        const first = data.translations[0];
                        if (typeof first === 'string') return first;
                        if (first && typeof first.text === 'string') return first.text;
                    }
                    if (Array.isArray(data.alternatives) && data.alternatives.length > 0) {
                        const alt = data.alternatives[0];
                        if (typeof alt === 'string') return alt;
                        if (alt && typeof alt.text === 'string') return alt.text;
                    }
                    if (typeof data.result === 'string') return data.result;
                    if (data.result && typeof data.result.text === 'string') return data.result.text;
                    if (typeof data.translation === 'string') return data.translation;
                    return null;
                }
            },

            'deepseek': {
                endpoint: 'https://api.deepseek.com/v1/chat/completions',
                modelName: 'DeepSeek',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => {
                    let modelId = 'deepseek-chat';
                    try { const cfg = loadModelConfig && loadModelConfig('deepseek'); if (cfg && (cfg.preferredModelId||cfg.modelId)) modelId = cfg.preferredModelId||cfg.modelId; } catch {}
                    return ({
                    model: modelId,
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }); },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },

            'gemini': {
                endpoint: geminiEndpointDynamic,
                modelName: 'Google Gemini',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: `${sys}\n\n${user}` }]
                        }
                    ],
                    generationConfig: {
                        temperature: temperature,
                        maxOutputTokens: maxTokens
                    }
                }),
                responseExtractor: (data) => {
                    if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                        const parts = data.candidates[0].content.parts;
                        return parts && parts.length > 0 ? parts[0].text : '';
                    }
                    return '';
                }
            },

            'mistral': {
                endpoint: 'https://api.mistral.ai/v1/chat/completions',
                modelName: 'Mistral Large (mistral-large-latest)',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "mistral-large-latest",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'tongyi': {
                endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                modelName: '通义百炼',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => {
                    let modelId = 'qwen-turbo-latest';
                    try { const cfg = loadModelConfig && loadModelConfig('tongyi'); if (cfg && (cfg.preferredModelId||cfg.modelId)) modelId = cfg.preferredModelId||cfg.modelId; } catch {}
                    return ({
                    model: modelId,
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }); },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'volcano': {
                endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                modelName: '火山引擎',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => {
                    let modelId = 'doubao-1-5-pro-32k-250115';
                    try { const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId||cfg.modelId)) modelId = cfg.preferredModelId||cfg.modelId; } catch {}
                    return ({
                    model: modelId,
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: Math.min(maxTokens, 16384)
                }); },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'gemini-preview': {
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent',
                modelName: 'Google gemini-2.5-flash-preview-05-20',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: `${sys}\n\n${user}`
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        temperature: temperature,
                        maxOutputTokens: maxTokens,
                        responseModalities: ["TEXT"],
                        responseMimeType: "text/plain"
                    }
                }),
                responseExtractor: (data) => {
                    if (data?.candidates && data.candidates.length > 0 && data.candidates[0].content) {
                        const parts = data.candidates[0].content.parts;
                        return parts && parts.length > 0 ? parts[0].text : '';
                    }
                    return '';
                }
            }
        };

        // 检查选择的模型是否在预设配置中
        if (!predefinedConfigs[model]) {
            throw new Error(`不支持的翻译模型: ${model}`);
        }

        apiConfig = buildPredefinedApiConfig(predefinedConfigs[model], apiKey);
    }

    // 构建请求体
    const bodyBuilderContext = {
        processedText,
        targetLang,
        originalText: markdown,
        hasProtectedTables,
        tablePlaceholders,
        options,
        requestType: 'initial',
        instructionBlock: buildInstructionBlock(systemPrompt)
    };

    const requestBody = apiConfig.bodyBuilder
        ? apiConfig.bodyBuilder(systemPrompt, userPrompt, bodyBuilderContext)
        : {
            model: apiConfig.modelName,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]
        };

    // 实际调用（记录提示词池使用成功率 + 队列入队/出队）
    let result;
    const poolPromptId = (usePromptPool && promptFromPool && promptFromPool.id) ? promptFromPool.id : null;
    // 入队（如调用方未预入队，则在此兜底入队）
    const requestId = options.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    if (!options.requestId && poolPromptId && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.enqueueRequest === 'function') {
        window.translationPromptPool.enqueueRequest(poolPromptId, { requestId, model: apiConfig.modelName || 'unknown' });
    }
    const startTimeMs = Date.now();
    let primaryError = null;
    try {
        // 出队（开始执行，不再算“待迁移”）
        if (poolPromptId && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.dequeueRequest === 'function') {
            window.translationPromptPool.dequeueRequest(poolPromptId, requestId);
        }
        result = await callTranslationApi(apiConfig, requestBody);
        result = stripInstructionBlocks(result);
        if (poolPromptId && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.recordPromptUsage === 'function') {
            window.translationPromptPool.recordPromptUsage(
                poolPromptId,
                true,
                Date.now() - startTimeMs,
                null,
                { model: apiConfig.modelName || 'unknown', endpoint: apiConfig.endpoint || '' }
            );
        }
    } catch (e) {
        // 出队（失败也确保不再算“待迁移”）
        if (poolPromptId && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.dequeueRequest === 'function') {
            window.translationPromptPool.dequeueRequest(poolPromptId, requestId);
        }
        if (poolPromptId && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.recordPromptUsage === 'function') {
            window.translationPromptPool.recordPromptUsage(
                poolPromptId,
                false,
                Date.now() - startTimeMs,
                e && e.message ? e.message : String(e),
                { model: apiConfig.modelName || 'unknown', endpoint: apiConfig.endpoint || '' }
            );
        }
        primaryError = e;
    }

    // 即时切换并重试一次（谨慎）：仅在提示词池模式、允许失败切换、存在健康替代时执行
    if (!result && poolPromptId && typeof window.translationPromptPool !== 'undefined') {
        try {
            const cfgOk = (typeof window.translationPromptPool.getHealthConfig === 'function') ? window.translationPromptPool.getHealthConfig() : null;
            const canSwitch = cfgOk && cfgOk.switchOnFailure;
            const newPrompt = (typeof window.translationPromptPool.selectHealthyPrompt === 'function')
                ? window.translationPromptPool.selectHealthyPrompt(poolPromptId)
                : null;

            if (canSwitch && newPrompt && newPrompt.id !== poolPromptId) {
                if (typeof addProgressLog === 'function') {
                    addProgressLog(`${actualLogContext} 首次失败，尝试切换至健康提示词并重试一次...`);
                }

                // 重建基于新提示词的 prompts
                let retrySystemPrompt = (newPrompt.systemPrompt || '') + tableHandlingNote;
                let retryUserPrompt = (newPrompt.userPromptTemplate || '')
                    .replace(/\$\{targetLangName\}/g, targetLang)
                    .replace(/\$\{content\}/g, processedText);

                // 重新评估术语库命中并注入（确保重试也带有一致的术语指引）
                try {
                    const st2 = (typeof loadSettings === 'function') ? loadSettings() : {};
                    if (st2 && st2.enableGlossary && typeof getGlossaryMatchesForText === 'function') {
                        const matches2 = getGlossaryMatchesForText(processedText);
                        if (matches2 && matches2.length > 0 && typeof buildGlossaryInstruction === 'function') {
                            const instr2 = buildGlossaryInstruction(matches2, targetLang);
                            if (instr2) retrySystemPrompt = retrySystemPrompt + "\n\n" + instr2;
                        }
                    }
                } catch (e) {
                    console.warn('Glossary injection (retry) skipped:', e);
                }

                // 入队 + 出队（重试请求）
                const retryRequestId = `${requestId}_r1`;
                if (typeof window.translationPromptPool.enqueueRequest === 'function') {
                    window.translationPromptPool.enqueueRequest(newPrompt.id, { requestId: retryRequestId, model: apiConfig.modelName || 'unknown' });
                }
                if (typeof window.translationPromptPool.dequeueRequest === 'function') {
                    window.translationPromptPool.dequeueRequest(newPrompt.id, retryRequestId);
                }

                const retryBody = apiConfig.bodyBuilder
                    ? apiConfig.bodyBuilder(retrySystemPrompt, retryUserPrompt, { ...bodyBuilderContext, requestType: 'retry' })
                    : {
                        model: apiConfig.modelName,
                        messages: [
                            { role: 'system', content: retrySystemPrompt },
                            { role: 'user', content: retryUserPrompt }
                        ]
                    };

                const retryStart = Date.now();
                try {
                result = await callTranslationApi(apiConfig, retryBody);
                result = stripInstructionBlocks(result);
                    if (typeof window.translationPromptPool.recordPromptUsage === 'function') {
                        window.translationPromptPool.recordPromptUsage(
                            newPrompt.id,
                            true,
                            Date.now() - retryStart,
                            null,
                            { model: apiConfig.modelName || 'unknown', endpoint: apiConfig.endpoint || '' }
                        );
                    }
                    if (typeof window !== 'undefined' && window.isProcessing && window.promptPoolUI) {
                        // 将会话锁定到新的健康提示词
                        window.promptPoolUI.sessionLockedPrompt = newPrompt;
                    }
                    if (typeof addProgressLog === 'function') {
                        addProgressLog(`${actualLogContext} 重试成功。`);
                    }
                } catch (e2) {
                    if (typeof window.translationPromptPool.recordPromptUsage === 'function') {
                        window.translationPromptPool.recordPromptUsage(
                            newPrompt.id,
                            false,
                            Date.now() - retryStart,
                            e2 && e2.message ? e2.message : String(e2),
                            { model: apiConfig.modelName || 'unknown', endpoint: apiConfig.endpoint || '' }
                        );
                    }
                    if (typeof addProgressLog === 'function') {
                        addProgressLog(`${actualLogContext} 重试失败：${e2.message}`);
                    }
                }
            }
        } catch (swErr) {
            // 保守处理：任何切换逻辑错误都不影响主异常流
            console.warn('Immediate switch-retry failed silently:', swErr);
        }
    }

    if (!result) {
        // 两次均失败，抛出原始异常
        throw primaryError || new Error('调用翻译 API 失败');
    }

    // 如果存在表格保护处理且需要处理表格占位符，恢复表格
    if (hasProtectedTables && actualProcessTablePlaceholders && typeof extractTableFromTranslation === 'function') {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${actualLogContext} 翻译主文本完成，正在处理表格...`);
        }

        // 获取表格翻译结果并替换
        let finalResult = result;

        for (const [placeholder, tableContent] of Object.entries(tablePlaceholders)) {
            try {
                const tableSystemPrompt = `你是一个精确翻译表格的助手。请将表格翻译成${targetLang}，严格保持以下格式要求：
1. 保持所有表格分隔符（|）和结构完全不变
2. 保持表格对齐标记（:--:、:--、--:）不变
3. 保持表格的行数和列数完全一致
4. 保持数学公式、符号和百分比等专业内容不变
5. 翻译表格标题（如有）和表格内的文本内容
6. 表格内容与表格外内容要明确区分`;

                const tableUserPrompt = `请将以下Markdown表格翻译成${targetLang}，请确保完全保持表格结构和格式：

${tableContent}

注意：请保持表格格式完全不变，包括所有的 | 符号、对齐标记、数学公式和符号。`;

                const tableRequestBody = apiConfig.bodyBuilder
                    ? apiConfig.bodyBuilder(tableSystemPrompt, tableUserPrompt, {
                        processedText: tableContent,
                        rawText: tableContent,
                        targetLang,
                        tablePlaceholder: placeholder,
                        requestType: 'table'
                    })
                    : {
                        model: apiConfig.modelName,
                        messages: [
                            { role: "system", content: tableSystemPrompt },
                            { role: "user", content: tableUserPrompt }
                        ]
                    };

                if (typeof addProgressLog === "function") {
                    addProgressLog(`${actualLogContext} 正在翻译表格...`);
                }
                const translatedTable = await callTranslationApi(apiConfig, tableRequestBody);
                const cleanedTable = extractTableFromTranslation(stripInstructionBlocks(translatedTable)) || tableContent;
                finalResult = finalResult.replace(placeholder, cleanedTable);

            } catch (tableError) {
                console.error(`表格翻译失败:`, tableError);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${actualLogContext} 表格翻译失败: ${tableError.message}，将使用原表格`);
                }
                finalResult = finalResult.replace(placeholder, tableContent);
            }
        }

        if (typeof addProgressLog === "function") {
            addProgressLog(`${actualLogContext} 表格处理完成。`);
        }
        return finalResult;
    }

    return result;
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.buildPredefinedApiConfig = buildPredefinedApiConfig;
    processModule.buildCustomApiConfig = buildCustomApiConfig;
    processModule.translateMarkdown = translateMarkdown;
}
