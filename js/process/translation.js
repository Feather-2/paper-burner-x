// process/translation.js

// 辅助函数：构建预定义 API 配置
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
    } else {
        config.headers['Authorization'] = `Bearer ${key}`;
    }
    return config;
}

// 辅助函数：构建自定义 API 配置
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
 * 翻译单个 Markdown 块
 * @param {string} markdown - 待翻译的 Markdown 文本
 * @param {string} targetLang - 目标语言
 * @param {string} model - 翻译模型
 * @param {string} apiKey - 翻译 API Key
 * @param {string} logContext - 日志前缀
 * @param {string} defaultSystemPrompt - 系统提示
 * @param {string} defaultUserPromptTemplate - 用户提示模板
 * @param {boolean} useCustomPrompts - 是否使用自定义提示
 * @param {boolean} processTablePlaceholders - 是否处理表格占位符（默认为true）
 * @returns {Promise<string>} 翻译后的文本
 *
 * 注意：如需传递自定义模型配置（modelConfig），只能通过 arguments[4] 传递，
 * 不要在参数列表中直接传递 modelConfig，否则会导致参数错位！
 *
 * 正确调用方式：
 *   translateMarkdown(md, lang, model, key, logPrefix, sysPrompt, userPrompt, useCustom, processTable)
 *   // 如需传递 modelConfig（仅 custom 模型时）：
 *   translateMarkdown(md, lang, 'custom', key, modelConfig, logPrefix, sysPrompt, userPrompt, useCustom, processTable)
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
    processTablePlaceholders = true
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

    // 构建 prompt
    let systemPrompt = actualDefaultSystemPrompt;
    let userPrompt = actualDefaultUserPromptTemplate;

    // 增加表格处理提示
    if (hasProtectedTables) {
        systemPrompt = actualDefaultSystemPrompt + "\n\n注意：文档中的表格已被特殊标记为占位符（如__TABLE_PLACEHOLDER_0__），请直接翻译占位符以外的内容，保持占位符不变。表格将在后续步骤中单独处理。";
    }

    // 如果未启用自定义提示，或自定义提示为空，则使用内置模板
    if (!actualUseCustomPrompts || !systemPrompt || !userPrompt) {
        if (typeof getBuiltInPrompts === "function") {
            const prompts = getBuiltInPrompts(targetLang);
            systemPrompt = prompts.systemPrompt;
            userPrompt = prompts.userPromptTemplate;

            // 同样增加表格处理提示
            if (hasProtectedTables) {
                systemPrompt = systemPrompt + "\n\n注意：文档中的表格已被特殊标记为占位符（如__TABLE_PLACEHOLDER_0__），请直接翻译占位符以外的内容，保持占位符不变。表格将在后续步骤中单独处理。";
            }
        } else {
            // 兜底
            systemPrompt = "You are a professional document translation assistant.";
            userPrompt = "Please translate the following content into the target language:\n\n${content}";
        }
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

        // 更新后的预设模型配置
        const predefinedConfigs = {

            'deepseek': {
                endpoint: 'https://api.deepseek.com/v1/chat/completions',
                modelName: 'DeepSeek v3 (deepseek-v3)',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },

            'gemini': {
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
                modelName: 'Google Gemini 2.0 Flash',
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
            'tongyi-deepseek-v3': {
                endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                modelName: '阿里云通义百炼 DeepSeek v3',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "deepseek-v3",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'tongyi-qwen-turbo': {
                endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                modelName: '阿里云通义百炼 Qwen Turbo',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "qwen-turbo-latest",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'volcano-deepseek-v3': {
                endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                modelName: '火山引擎 DeepSeek v3',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "deepseek-v3-250324",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: Math.min(maxTokens, 16384)
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'volcano-doubao': {
                endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                modelName: '火山引擎 豆包1.5-Pro',
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => ({
                    model: "doubao-1-5-pro-32k-250115",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ],
                    temperature: temperature,
                    max_tokens: Math.min(maxTokens, 16384)
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            'gemini-preview': {
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent',
                modelName: 'Google gemini-2.5-flash-preview-04-17',
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
    const requestBody = apiConfig.bodyBuilder
        ? apiConfig.bodyBuilder(systemPrompt, userPrompt)
        : {
            model: apiConfig.modelName,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ]
        };

    // 实际调用
    const result = await callTranslationApi(apiConfig, requestBody);

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
                    ? apiConfig.bodyBuilder(tableSystemPrompt, tableUserPrompt)
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
                const cleanedTable = extractTableFromTranslation(translatedTable) || tableContent;
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