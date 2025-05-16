// process/translation.js

// 辅助函数：构建预定义 API 配置
function buildPredefinedApiConfig(apiConfig, key) {
    const config = { ...apiConfig }; // 浅拷贝
    config.headers = { ...config.headers }; // 浅拷贝 headers

    // 设置认证
    if (config.modelName.toLowerCase().includes('claude')) {
        config.headers['x-api-key'] = key;
    } else if (config.modelName.toLowerCase().includes('gemini')) {
        // Correctly handle potential existing query parameters
        let baseUrl = config.endpoint.split('?')[0];
        config.endpoint = `${baseUrl}?key=${key}`;
    } else {
        config.headers['Authorization'] = `Bearer ${key}`;
    }
    return config;
}

// 辅助函数：构建自定义 API 配置
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

    // 获取当前选择的模型ID（如果有模型检测模块）
    let modelId = customModelId;
    if (typeof window.modelDetector !== 'undefined') {
        const currentModelId = window.modelDetector.getCurrentModelId();
        if (currentModelId) {
            modelId = currentModelId;
        }
    }

    const config = {
        endpoint: apiEndpoint,
        modelName: modelId, // 使用最新获取的modelId
        headers: { 'Content-Type': 'application/json' },
        bodyBuilder: null,
        responseExtractor: null
    };

    // 设置认证和 bodyBuilder/responseExtractor
    switch (customRequestFormat) {
        case 'openai':
            config.headers['Authorization'] = `Bearer ${key}`;
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                model: modelId,
                messages: [{ role: "system", content: sys_prompt }, { role: "user", content: user_prompt }],
                temperature: temperature ?? 0.5,
                max_tokens: max_tokens ?? 8000
            });
            config.responseExtractor = (data) => data?.choices?.[0]?.message?.content;
            break;
        case 'anthropic':
            config.headers['x-api-key'] = key;
            config.headers['anthropic-version'] = '2023-06-01';
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                model: modelId,
                system: sys_prompt,
                messages: [{ role: "user", content: user_prompt }],
                temperature: temperature ?? 0.5,
                max_tokens: max_tokens ?? 8000
            });
            config.responseExtractor = (data) => data?.content?.[0]?.text;
            break;
        case 'gemini':
            let baseUrl = config.endpoint.split('?')[0];
            config.endpoint = `${baseUrl}?key=${key}`;
            config.bodyBuilder = (sys_prompt, user_prompt) => ({
                contents: [{ role: "user", parts: [{ text: user_prompt }] }],
                generationConfig: { temperature: temperature ?? 0.5, maxOutputTokens: max_tokens ?? 8192 }
            });
            config.responseExtractor = (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text;
            break;
        default:
            throw new Error(`不支持的自定义请求格式: ${customRequestFormat}`);
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
    // 表格预处理 - 仅当需要处理表格时
    let processedText = markdown;
    let tablePlaceholders = {};
    let hasProtectedTables = false;

    if (processTablePlaceholders && typeof protectMarkdownTables === 'function') {
        const processed = protectMarkdownTables(markdown);
        processedText = processed.processedText;
        tablePlaceholders = processed.tablePlaceholders;
        hasProtectedTables = Object.keys(tablePlaceholders).length > 0;

        if (hasProtectedTables) {
            console.log(`${logContext} 检测到 ${Object.keys(tablePlaceholders).length} 个表格，已进行特殊保护`);
            if (typeof addProgressLog === "function") {
                addProgressLog(`${logContext} 检测到 ${Object.keys(tablePlaceholders).length} 个表格，将作为整体处理`);
            }
        }
    }

    // 构建 prompt
    let systemPrompt = defaultSystemPrompt;
    let userPrompt = defaultUserPromptTemplate;

    // 增加表格处理提示
    if (hasProtectedTables) {
        systemPrompt = defaultSystemPrompt + "\n\n注意：文档中的表格已被特殊标记为占位符（如__TABLE_PLACEHOLDER_0__），请直接翻译占位符以外的内容，保持占位符不变。表格将在后续步骤中单独处理。";
    }

    // 如果未启用自定义提示，或自定义提示为空，则使用内置模板
    if (!useCustomPrompts || !systemPrompt || !userPrompt) {
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

    // 构建 API 配置
    let apiConfig;
    if (model === "custom") {
        // 这里假设 loadSettings 可用
        const settings = typeof loadSettings === "function" ? loadSettings() : {};
        const cms = settings.customModelSettings || {};
        apiConfig = buildCustomApiConfig(
            apiKey,
            cms.apiEndpoint,
            cms.modelId,
            cms.requestFormat,
            cms.temperature,
            cms.max_tokens
        );
    } else {
        // 预设模型
        const predefinedConfigs = {
            "mistral": {
                endpoint: "https://api.mistral.ai/v1/chat/completions",
                modelName: "mistral-large-latest",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user) => ({
                    model: "mistral-large-latest",
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: user }
                    ]
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            // 其他模型配置可补充...
        };
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
    if (hasProtectedTables && processTablePlaceholders && typeof extractTableFromTranslation === 'function') {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 翻译主文本完成，正在处理表格...`);
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
                    addProgressLog(`${logContext} 正在翻译表格...`);
                }
                const translatedTable = await callTranslationApi(apiConfig, tableRequestBody);
                const cleanedTable = extractTableFromTranslation(translatedTable) || tableContent;
                finalResult = finalResult.replace(placeholder, cleanedTable);

            } catch (tableError) {
                console.error(`表格翻译失败:`, tableError);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logContext} 表格翻译失败: ${tableError.message}，将使用原表格`);
                }
                finalResult = finalResult.replace(placeholder, tableContent);
            }
        }

        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 表格处理完成。`);
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