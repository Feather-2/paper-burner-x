// process/document.js

/**
 * 将长文档分割为可翻译的块。
 * 此函数旨在将 Markdown 文本按照指定的 token 限制进行智能分块，
 * 以便适应大语言模型处理上下文长度的限制。
 *
 * 主要策略：
 * 1. **Token 估算与初步判断**：
 *    - 使用 `estimateTokenCount` 估算整个文档的 token 数。
 *    - 如果文档未超过 token 限制的 1.1 倍，则不进行分割，直接返回原文作为一个块。
 * 2. **行级初步分割**：
 *    - 遍历文本的每一行。
 *    - 跟踪当前块的 token 数和行内容。
 *    - 智能分割点选择：
 *      - 当 `currentTokenCount + lineTokens > tokenLimit` 且当前块已有一定内容 (`currentTokenCount > tokenLimit * 0.1`) 时，进行分割。
 *      - 在非代码块内，如果遇到一级或二级 Markdown 标题 (`#` 或 `##`)，并且当前块内容已超过限制的 50%，则在此标题前分割，以保持章节完整性。
 *    - 维护 `inCodeBlock` 状态，避免在代码块内部错误地根据标题分割。
 * 3. **二次段落级分割（针对超大块）**：
 *    - 对初步分割产生的每个块进行检查。
 *    - 如果某个块的 token 数仍然超过限制的 1.1 倍，则调用 `splitByParagraphs` 对其进行更细致的段落级分割。
 * 4. **日志记录**：在关键步骤通过 `addProgressLog` (如果可用) 输出日志，方便追踪分割过程。
 *
 * @param {string} markdown - 要分割的Markdown文本。
 * @param {number} tokenLimit - 每块的最大token数。
 * @param {string} [logContext=""] - 日志前缀，用于区分不同上下文的日志输出。
 * @returns {Array<string>} 分割后的文本块数组。
 */
function splitMarkdownIntoChunks(markdown, tokenLimit, logContext = "") {
    const estimatedTokens = estimateTokenCount(markdown);
    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 估算总 token 数: ~${estimatedTokens}, 分段限制: ${tokenLimit}`);
    }

    if (estimatedTokens <= tokenLimit * 1.1) {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 文档未超过大小限制，不进行分割。`);
        }
        return [markdown];
    }

    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 文档超过大小限制，开始分割...`);
    }
    const lines = markdown.split('\n');
    const chunks = [];
    let currentChunkLines = [];
    let currentTokenCount = 0;
    let inCodeBlock = false;
    const headingRegex = /^(#+)\s+.*/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTokens = estimateTokenCount(line);

        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }

        let shouldSplit = false;

        if (currentChunkLines.length > 0) {
            if (currentTokenCount + lineTokens > tokenLimit) {
                if (currentTokenCount > tokenLimit * 0.1) {
                    shouldSplit = true;
                }
            }
            else if (!inCodeBlock && headingRegex.test(line)) {
                const match = line.match(headingRegex);
                if (match && match[1].length <= 2 && currentTokenCount > tokenLimit * 0.5) {
                    shouldSplit = true;
                }
            }
        }

        if (shouldSplit) {
            chunks.push(currentChunkLines.join('\n'));
            currentChunkLines = [];
            currentTokenCount = 0;
        }

        currentChunkLines.push(line);
        currentTokenCount += lineTokens;
    }

    if (currentChunkLines.length > 0) {
        chunks.push(currentChunkLines.join('\n'));
    }

    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 初始分割为 ${chunks.length} 个片段.`);
    }

    const finalChunks = [];
    for(let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];
        const chunkTokens = estimateTokenCount(chunk);
        if (chunkTokens > tokenLimit * 1.1) {
            if (typeof addProgressLog === "function") {
                addProgressLog(`${logContext} 警告: 第 ${j+1} 段 (${chunkTokens} tokens) 仍然超过限制 ${tokenLimit}. 尝试段落分割.`);
            }
            const subChunks = splitByParagraphs(chunk, tokenLimit, logContext, j+1);
            finalChunks.push(...subChunks);
        } else {
            finalChunks.push(chunk);
        }
    }

    if (finalChunks.length !== chunks.length && typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 二次分割后总片段数: ${finalChunks.length}`);
    }

    return finalChunks;
}

/**
 * 按段落分割过大的文本块。
 * 当 `splitMarkdownIntoChunks` 初步分割后，某些块可能仍然过大，
 * 此函数尝试将这些超大块按照 Markdown 的段落（空行分隔）进一步细分。
 *
 * 主要逻辑：
 * 1. **段落分割**：使用 `text.split('\n\n')` 将文本块分割成段落数组。
 * 2. **逐段累加与分割**：
 *    - 遍历每个段落。
 *    - 估算段落的 token 数。
 *    - 如果单个段落本身就超过 `tokenLimit * 1.1`，则直接将其作为一个独立的块（不再细分），并记录警告。
 *    - 否则，将段落加入当前子块，并累加 token 数。
 *    - 如果加入当前段落会导致子块超过 `tokenLimit`，并且子块中已有内容，则先将当前子块保存，然后开始新的子块。
 * 3. **日志记录**：记录段落分割的过程和结果。
 *
 * @param {string} text - 需要按段落分割的文本块。
 * @param {number} tokenLimit - 每块的最大token数。
 * @param {string} logContext - 日志前缀。
 * @param {number} chunkIndex - 当前块在原始分割结果中的索引 (用于日志)。
 * @returns {Array<string>} 分割后的子块数组。
 */
function splitByParagraphs(text, tokenLimit, logContext, chunkIndex) {
    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 对第 ${chunkIndex} 段进行段落分割...`);
    }
    const paragraphs = text.split('\n\n');
    const chunks = [];
    let currentChunkLines = [];
    let currentTokenCount = 0;

    for (const paragraph of paragraphs) {
        const paragraphTokens = estimateTokenCount(paragraph);

        if (paragraphTokens > tokenLimit * 1.1) {
            if (typeof addProgressLog === "function") {
                addProgressLog(`${logContext} 警告: 第 ${chunkIndex} 段中的段落 (${paragraphTokens} tokens) 超过限制 ${tokenLimit}. 将尝试按原样处理.`);
            }
            if (currentChunkLines.length > 0) {
                chunks.push(currentChunkLines.join('\n\n'));
            }
            chunks.push(paragraph); // Keep the large paragraph as a single chunk
            currentChunkLines = [];
            currentTokenCount = 0;
            continue;
        }

        if (currentTokenCount + paragraphTokens > tokenLimit && currentChunkLines.length > 0) {
            chunks.push(currentChunkLines.join('\n\n'));
            currentChunkLines = [];
            currentTokenCount = 0;
        }

        currentChunkLines.push(paragraph);
        currentTokenCount += paragraphTokens;
    }

    if (currentChunkLines.length > 0) {
        chunks.push(currentChunkLines.join('\n\n'));
    }
    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 第 ${chunkIndex} 段分割为 ${chunks.length} 个子段.`);
    }
    return chunks;
}

/**
 * 翻译长文档，支持分段、表格保护、并发控制和自定义模型配置。
 *
 * 核心流程：
 * 1. **参数准备与 Token 限制**：
 *    - 确保 `tokenLimitInput` 被正确解析为数字。
 * 2. **表格保护**：
 *    - 调用 `protectMarkdownTables` (如果可用) 将 Markdown 中的表格替换为占位符 (如 `__TABLE_PLACEHOLDER_0__`)，
 *      并将原始表格内容存储在 `tablePlaceholders` 对象中。这可以防止翻译API破坏表格结构。
 *    - 如果检测到表格，更新系统提示 `updatedSystemPrompt`，告知模型如何处理这些占位符。
 * 3. **文本分块**：
 *    - 使用 `splitMarkdownIntoChunks` 将经过表格保护处理的文本 (`processedText`) 分割成 `originalTextChunks`。
 * 4. **API 配置构建**：
 *    - 根据 `model` 参数是 'custom' 还是预定义模型，调用 `buildCustomApiConfig` 或 `buildPredefinedApiConfig` 来准备 API 请求所需的配置对象 (`apiConfig`)。
 *    - 对于自定义模型，会从 `modelConfig` 参数中获取详细配置（如端点、模型ID、请求格式等）。
 * 5. **创建翻译任务队列 (`allTranslationTasks`)**：
 *    - 将所有文本块的翻译任务添加到队列中。
 *    - 如果有受保护的表格，将每个表格的翻译也作为一个独立的任务添加到队列中。
 * 6. **并发翻译与重试**：
 *    - 遍历 `allTranslationTasks`，为每个任务创建一个异步翻译 Promise。
 *    - 使用 `acquireSlot` 和 `releaseSlot` 控制并发翻译的数量。
 *    - 对每个任务执行翻译：
 *      - **文本块翻译**：调用 `translateMarkdown` (并根据模型类型传递必要的参数，如 `modelConfig` for custom)。
 *      - **表格翻译**：构造特定的系统提示和用户提示，指导模型仅翻译表格内容并保持结构，然后调用 `callTranslationApi`。翻译结果会经过 `extractTableFromTranslation` 清理。
 *    - 实现重试机制 (最多 `MAX_TRANSLATION_RETRIES` 次)，使用 `getRetryDelay` 计算退避延迟。
 *    - 如果任务在多次重试后仍然失败，则记录错误，并将原文（或原始表格内容）作为翻译结果的兜底。
 *    - 将所有任务的翻译结果（成功或失败的兜底）存储在 `translationResults` Map 中，键为 `text-{index}` 或 `table-{index}`。
 * 7. **等待所有任务完成**：使用 `Promise.all` 等待所有翻译 Promise 执行完毕。
 * 8. **结果组装与表格还原**：
 *    - **构建翻译后表格映射**：从 `translationResults` 中提取已翻译的表格内容，存入 `translatedTablePlaceholders`。
 *    - **还原分块中的表格**：
 *      - 对 `originalTextChunks` 中的每个块，使用 `restoreMarkdownTables` 和原始 `tablePlaceholders` 还原其包含的原始表格，得到 `restoredOcrChunks`。
 *      - 对 `translationResults` 中每个文本块的翻译结果，使用 `restoreMarkdownTables` 和 `translatedTablePlaceholders` 还原其包含的已翻译表格，得到 `translatedTextChunks`。
 *    - **合并翻译文本**：将 `translatedTextChunks` 连接起来得到 `combinedTranslation`。
 *    - **最终表格还原**：为保险起见，再次对 `combinedTranslation` 使用 `translatedTablePlaceholders` 进行一次整体的表格占位符替换。
 * 9. **返回结果**：返回一个对象，包含最终的完整翻译文本 `translatedText`，以及还原了表格的原文分块 `originalChunks` 和译文分块 `translatedTextChunks`。
 *
 * @param {string} markdownText - 待翻译的Markdown文本。
 * @param {string} targetLang - 目标语言代码 (如 'zh-CN', 'en')。
 * @param {string} model - 使用的翻译模型名称 (如 'mistral', 'custom')。
 * @param {string} apiKey - 对应翻译模型的 API 密钥。
 * @param {Object | null} modelConfig - 当 `model` 为 "custom" 时，提供自定义模型的配置对象，
 *                                   包含 `apiEndpoint` (或 `apiBaseUrl`), `modelId`, `requestFormat`, `temperature`, `max_tokens` 等。
 * @param {number | string} tokenLimitInput - 每个翻译分块的最大 token 限制。
 * @param {function} acquireSlot - 用于获取并发执行槽位的函数。
 * @param {function} releaseSlot - 用于释放并发执行槽位的函数。
 * @param {string} [logContext=""] - 日志记录的上下文前缀。
 * @param {string} [defaultSystemPrompt=""] - 默认的系统提示词。
 * @param {string} [defaultUserPromptTemplate=""] - 默认的用户提示词模板 (应包含 `${content}` 和 `${targetLangName}` 占位符)。
 * @param {boolean} [useCustomPrompts=false] - 是否使用自定义的提示词（如果为 false，则使用内置或默认提示词）。
 * @returns {Promise<Object>} 一个包含翻译结果的对象，结构为：
 *                          `{ translatedText: string, originalChunks: Array<string>, translatedTextChunks: Array<string> }`。
 *                          `originalChunks` 和 `translatedTextChunks` 是经过表格还原处理后的分块数组。
 * @throws {Error} 如果自定义模型配置不完整或发生其他严重错误。
 */
async function translateLongDocument(
    markdownText,
    targetLang,
    model,
    apiKey,
    modelConfig, // 新增参数
    tokenLimitInput,
    acquireSlot,
    releaseSlot,
    logContext = "",
    defaultSystemPrompt = "",
    defaultUserPromptTemplate = "",
    useCustomPrompts = false
) {
    console.log('translateLongDocument: apiKey', apiKey);
    const tokenLimit = parseInt(tokenLimitInput, 10) || 2000; // 确保是数字，提供默认值

    // 先进行表格保护处理
    let processedText = markdownText;
    let tablePlaceholders = {};
    let hasProtectedTables = false;

    if (typeof protectMarkdownTables === 'function') {
        const processed = protectMarkdownTables(markdownText);
        processedText = processed.processedText;
        tablePlaceholders = processed.tablePlaceholders;
        hasProtectedTables = Object.keys(tablePlaceholders).length > 0;

        if (hasProtectedTables) {
            console.log(`${logContext} 长文档中检测到 ${Object.keys(tablePlaceholders).length} 个表格，已进行特殊保护`);
            if (typeof addProgressLog === "function") {
                addProgressLog(`${logContext} 长文档翻译: 已保护 ${Object.keys(tablePlaceholders).length} 个表格结构，将作为整体处理`);
            }
        }
    }

    // 增加表格处理提示到系统提示中
    let updatedSystemPrompt = defaultSystemPrompt;
    if (hasProtectedTables) {
        updatedSystemPrompt = defaultSystemPrompt + "\n\n注意：文档中的表格已被特殊标记为占位符（如__TABLE_PLACEHOLDER_0__），请直接翻译占位符以外的内容，保持占位符不变。表格将在后续步骤中单独处理。";
    }

    // 继续原有的分块处理逻辑 - 使用处理后的文本
    const originalTextChunks = splitMarkdownIntoChunks(processedText, tokenLimit, logContext);
    console.log(`${logContext} 文档分割为 ${originalTextChunks.length} 部分进行翻译 (Limit: ${tokenLimit})`);
    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 文档被分割为 ${originalTextChunks.length} 部分进行翻译`);
    }

    // 准备API配置用于文本和表格翻译
    let apiConfig;
    if (model === "custom") {
        // 兼容 apiEndpoint 和 apiBaseUrl
        const endpoint = modelConfig.apiEndpoint || modelConfig.apiBaseUrl;
        if (!modelConfig || !endpoint || !modelConfig.modelId) {
            throw new Error('Custom model configuration is incomplete for translateLongDocument. API Endpoint (或 apiBaseUrl) and Model ID are required.');
        }
        apiConfig = buildCustomApiConfig(
            apiKey,
            endpoint,    // 兼容 apiEndpoint 和 apiBaseUrl
            modelConfig.modelId,        // 使用传入的 modelConfig
            modelConfig.requestFormat,  // 使用传入的 modelConfig
            modelConfig.temperature,
            modelConfig.max_tokens,
            {
                endpointMode: modelConfig.endpointMode || 'auto'
            }
        );
    } else {
        // 预设模型
        const settingsForModels = typeof loadSettings === 'function' ? loadSettings() : {};
        const customModelSettings = settingsForModels && settingsForModels.customModelSettings ? settingsForModels.customModelSettings : {};
        let temperature = 0.5;
        if (customModelSettings.temperature !== undefined && customModelSettings.temperature !== null && customModelSettings.temperature !== '') {
            const parsedTemp = parseFloat(customModelSettings.temperature);
            if (!Number.isNaN(parsedTemp)) {
                temperature = parsedTemp;
            }
        }
        let maxTokens = 8000;
        if (customModelSettings.max_tokens !== undefined && customModelSettings.max_tokens !== null && customModelSettings.max_tokens !== '') {
            const parsedMax = parseInt(customModelSettings.max_tokens, 10);
            if (!Number.isNaN(parsedMax) && parsedMax > 0) {
                maxTokens = parsedMax;
            }
        }

        let geminiEndpointDynamic = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
        try {
            if (typeof loadModelConfig === 'function') {
                const gcfg = loadModelConfig('gemini');
                const preferred = gcfg && (gcfg.preferredModelId || gcfg.modelId);
                if (preferred && typeof preferred === 'string' && preferred.trim()) {
                    geminiEndpointDynamic = `https://generativelanguage.googleapis.com/v1beta/models/${preferred.trim()}:generateContent`;
                }
            }
        } catch (e) {
            console.warn('加载 Gemini 配置失败，将在长文档翻译中使用默认模型。', e);
        }

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
                        const base = dlcfg.apiBaseUrl.trim();
                        if (base) {
                            deeplxEndpointTemplate = base.endsWith('/') ? `${base}<api-key>/translate` : `${base}/<api-key>/translate`;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('加载 DeepLX 配置失败，将在长文档翻译中使用默认模板。', e);
        }

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
                    ],
                    temperature: temperature,
                    max_tokens: maxTokens
                }),
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            "deepseek": {
                endpoint: "https://api.deepseek.com/v1/chat/completions",
                modelName: "DeepSeek",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user) => {
                    let modelId = 'deepseek-chat';
                    try { const cfg = loadModelConfig && loadModelConfig('deepseek'); if (cfg && (cfg.preferredModelId || cfg.modelId)) modelId = cfg.preferredModelId || cfg.modelId; } catch (_) {}
                    return {
                        model: modelId,
                        messages: [
                            { role: "system", content: sys },
                            { role: "user", content: user }
                        ],
                        temperature: temperature,
                        max_tokens: maxTokens
                    };
                },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            "gemini": {
                endpoint: geminiEndpointDynamic,
                modelName: "Google Gemini",
                headers: { "Content-Type": "application/json" },
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
            "gemini-preview": {
                endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent",
                modelName: "Google gemini-2.5-flash-preview-05-20",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user) => ({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: `${sys}\n\n${user}` }]
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
            },
            "tongyi": {
                endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                modelName: "通义百炼",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user) => {
                    let modelId = 'qwen-turbo-latest';
                    try { const cfg = loadModelConfig && loadModelConfig('tongyi'); if (cfg && (cfg.preferredModelId || cfg.modelId)) modelId = cfg.preferredModelId || cfg.modelId; } catch (_) {}
                    const isQwenMT = typeof modelId === 'string' && modelId.toLowerCase().includes('qwen-mt');
                    const mergedContent = isQwenMT ? `${sys}\n\n${user}`.trim() : null;
                    return {
                        model: modelId,
                        messages: isQwenMT
                            ? [
                                { role: "user", content: mergedContent }
                            ]
                            : [
                                { role: "system", content: sys },
                                { role: "user", content: user }
                            ],
                        temperature: temperature,
                        max_tokens: maxTokens,
                        enable_thinking: false
                    };
                },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            "volcano": {
                endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                modelName: "火山引擎",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user) => {
                    let modelId = 'doubao-1-5-pro-32k-250115';
                    try { const cfg = loadModelConfig && loadModelConfig('volcano'); if (cfg && (cfg.preferredModelId || cfg.modelId)) modelId = cfg.preferredModelId || cfg.modelId; } catch (_) {}
                    return {
                        model: modelId,
                        messages: [
                            { role: "system", content: sys },
                            { role: "user", content: user }
                        ],
                        temperature: temperature,
                        max_tokens: Math.min(maxTokens, 16384)
                    };
                },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            },
            "deeplx": {
                endpoint: deeplxEndpointTemplate,
                modelName: "DeepLX",
                headers: { "Content-Type": "application/json" },
                bodyBuilder: (sys, user, ctx = {}) => {
                    const payload = {
                        text: ctx && ctx.processedText ? ctx.processedText : user
                    };
                    const targetLangCode = (typeof mapToDeeplxLangCode === 'function')
                        ? mapToDeeplxLangCode(ctx && ctx.targetLang ? ctx.targetLang : undefined)
                        : undefined;
                    if (targetLangCode) {
                        payload.target_lang = targetLangCode;
                    }
                    if (ctx && ctx.sourceLang) {
                        const src = (typeof mapToDeeplxLangCode === 'function') ? mapToDeeplxLangCode(ctx.sourceLang) : undefined;
                        if (src) payload.source_lang = src;
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
            }
        };

        if (!predefinedConfigs[model]) {
            throw new Error(`暂不支持模型 ${model} 的长文档处理。`);
        }
        apiConfig = buildPredefinedApiConfig(predefinedConfigs[model], apiKey);
    }

    // 创建所有翻译任务的统一队列（包括文本块和表格）
    const allTranslationTasks = [];

    // 添加所有文本块翻译任务
    originalTextChunks.forEach((part, i) => {
        allTranslationTasks.push({
            type: 'text',
            index: i,
            content: part,
            context: `${logContext} (Part ${i+1}/${originalTextChunks.length})`
        });
    });

    // 添加所有表格翻译任务（如果有）
    if (hasProtectedTables) {
        let tableIndex = 0;
        for (const [placeholder, tableContent] of Object.entries(tablePlaceholders)) {
            allTranslationTasks.push({
                type: 'table',
                index: tableIndex,
                placeholder: placeholder,
                content: tableContent,
                context: `${logContext} (Table ${tableIndex+1}/${Object.keys(tablePlaceholders).length})`
            });
            tableIndex++;
        }
    }

    if (typeof addProgressLog === "function") {
        addProgressLog(`${logContext} 总计待翻译任务: ${allTranslationTasks.length} (文本块: ${originalTextChunks.length}, 表格: ${hasProtectedTables ? Object.keys(tablePlaceholders).length : 0})`);
    }

    let hasErrors = false;
    const MAX_TRANSLATION_RETRIES = 3;
    const translationResults = new Map(); // 使用Map存储翻译结果

    // 为所有任务创建翻译Promise
    const translationPromises = allTranslationTasks.map(async (task) => {
        const taskLogContext = task.context;
        let lastError = null;

        for (let attempt = 0; attempt <= MAX_TRANSLATION_RETRIES; attempt++) {
            const attemptNum = attempt + 1;
            if (typeof addProgressLog === "function") {
                addProgressLog(`${taskLogContext} 排队等待翻译槽 (尝试 ${attemptNum})...`);
            }
            await acquireSlot();
            if (typeof addProgressLog === "function") {
                addProgressLog(`${taskLogContext} 翻译槽已获取。开始翻译 ${task.type === 'table' ? '表格' : '文本'} (尝试 ${attemptNum})...`);
            }

            try {
                let result;

                if (task.type === 'text') {
                    // Step 1: 为任务预绑定提示词并入队，便于失败时做“真正队列替换”
                    let boundPrompt = null;
                    let requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2,8)}_t${task.index}`;
                    try {
                        if (typeof window !== 'undefined' && window.promptPoolUI && typeof window.promptPoolUI.getPromptForTranslation === 'function') {
                            const p = window.promptPoolUI.getPromptForTranslation();
                            // 仅当池模式返回 id/system/user 时认为可用
                            if (p && p.id && p.systemPrompt && p.userPromptTemplate) {
                                boundPrompt = p;
                                if (typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.enqueueRequest === 'function') {
                                    window.translationPromptPool.enqueueRequest(p.id, { requestId, model: (apiConfig && apiConfig.modelName) || model });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[PromptPool] 预绑定提示词失败（跳过绑定）:', e);
                    }
                    // 翻译文本块
                    //console.log('document.js 调用 translateMarkdown 参数:', {
                    //    useCustomPrompts,
                    //    defaultUserPromptTemplate,
                    //    defaultSystemPrompt,
                    //    modelConfig,
                    //    content: task.content,
                    //    targetLang,
                    //    model,
                    //    apiKey,
                    //    taskLogContext
                    //});
                    if (model === 'custom') {
                        result = await translateMarkdown(
                            task.content,
                            targetLang,
                            model,
                            apiKey,
                            modelConfig,
                            taskLogContext,
                            updatedSystemPrompt,
                            defaultUserPromptTemplate,
                            useCustomPrompts,
                            false,
                            { boundPrompt, requestId }
                        );
                    } else {
                        result = await translateMarkdown(
                            task.content,
                            targetLang,
                            model,
                            apiKey,
                            taskLogContext,
                            updatedSystemPrompt,
                            defaultUserPromptTemplate,
                            useCustomPrompts,
                            false,
                            { boundPrompt, requestId }
                        );
                    }
                    //console.log('document.js translateMarkdown 返回:', result);
                    translationResults.set('text-' + task.index, result);
                } else if (task.type === 'table') {
                    // 翻译表格
                    let tableSystemPrompt = `你是一个精确翻译表格的助手。请将表格翻译成${targetLang}，严格保持以下格式要求：
1. 保持所有表格分隔符（|）和结构完全不变
2. 保持表格对齐标记（:--:、:--、--:）不变
3. 保持表格的行数和列数完全一致
4. 保持数学公式、符号和百分比等专业内容不变
5. 翻译表格标题（如有）和表格内的文本内容
6. 表格内容与表格外内容要明确区分`;

                    // 注入术语库（如启用且有命中）
                    try {
                        const settingsForGlossary = (typeof loadSettings === 'function') ? loadSettings() : {};
                        const glossaryEnabled = !!settingsForGlossary.enableGlossary;
                        if (glossaryEnabled && typeof getGlossaryMatchesForText === 'function') {
                            const matches = getGlossaryMatchesForText(task.content);
                            if (matches && matches.length > 0 && typeof buildGlossaryInstruction === 'function') {
                                const instr = buildGlossaryInstruction(matches, targetLang);
                                if (instr) {
                                    tableSystemPrompt = tableSystemPrompt + "\n\n" + instr;
                                    if (typeof addProgressLog === 'function') {
                                        const names = matches.slice(0, 6).map(m => m.term).join(', ');
                                        addProgressLog(`${taskLogContext} [表格] 命中备择库 ${matches.length} 条：${names}${matches.length>6?'...':''}`);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Glossary injection for table skipped due to error:', e);
                    }

                    // 用户提示词
                    const tableUserPrompt = `请将以下Markdown表格翻译成${targetLang}，请确保完全保持表格结构和格式：

${task.content}

注意：请保持表格格式完全不变，包括所有的 | 符号、对齐标记、数学公式和符号。`;

                    // 构建请求体
                    const requestBody = apiConfig.bodyBuilder
                        ? apiConfig.bodyBuilder(tableSystemPrompt, tableUserPrompt, {
                            processedText: task.content,
                            rawText: task.content,
                            targetLang,
                            tablePlaceholder: task.placeholder,
                            requestType: 'table'
                        })
                        : {
                            model: apiConfig.modelName,
                            messages: [
                                { role: "system", content: tableSystemPrompt },
                                { role: "user", content: tableUserPrompt }
                            ]
                        };

                    // 调用API翻译表格
                    const translatedTable = await callTranslationApi(apiConfig, requestBody);

                    // 提取和清理翻译结果中的表格部分
                    const cleanedTable = typeof extractTableFromTranslation === 'function' ?
                                         (extractTableFromTranslation(translatedTable) || task.content) :
                                         task.content;

                    translationResults.set('table-' + task.index, {
                        placeholder: task.placeholder,
                        translatedContent: cleanedTable
                    });
                }

                if (typeof releaseSlot === "function") {
                    releaseSlot();
                }
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${taskLogContext} 翻译槽已释放 (成功)。`);
                }
                return; // 成功，退出重试循环

            } catch (error) {
                // 释放翻译槽
                if (typeof releaseSlot === "function") {
                    releaseSlot();
                }
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${taskLogContext} 翻译槽已释放 (失败)。`);
                }
                lastError = error;
                console.error(`${taskLogContext} 翻译失败 (尝试 ${attemptNum}/${MAX_TRANSLATION_RETRIES + 1}):`, error);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${taskLogContext} 警告: 翻译失败 (尝试 ${attemptNum}/${MAX_TRANSLATION_RETRIES + 1}) - ${error.message}.`);
                }

                if (attempt < MAX_TRANSLATION_RETRIES) {
                    const delay = typeof getRetryDelay === 'function' ?
                                  getRetryDelay(attempt) :
                                  Math.min(1000 * Math.pow(2, attempt), 30000);

                    if (typeof addProgressLog === "function") {
                        addProgressLog(`${taskLogContext} ${delay.toFixed(0)}ms 后重试...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    if (typeof addProgressLog === "function") {
                        addProgressLog(`${taskLogContext} 已达最大重试次数 (${MAX_TRANSLATION_RETRIES + 1}次尝试)，使用原文。`);
                    }
                    hasErrors = true;

                    // 保存原始内容作为结果
                    if (task.type === 'text') {
                        translationResults.set('text-' + task.index,
                            `\n\n> **[翻译错误 (重试 ${MAX_TRANSLATION_RETRIES + 1} 次失败) - 保留原文 Part ${task.index+1}]**\n\n${task.content}\n\n`);
                    } else if (task.type === 'table') {
                        translationResults.set('table-' + task.index, {
                            placeholder: task.placeholder,
                            translatedContent: task.content
                        });
                    }
                    return; // 结束重试
                }
            }
        }

        console.error(`${taskLogContext} Unexpected state reached after retry loop.`);
        if (typeof addProgressLog === "function") {
            addProgressLog(`${taskLogContext} 警告: 翻译重试逻辑结束后状态意外，保留原文。`);
        }
        hasErrors = true;

        // 安全兜底，保存原始内容
        if (task.type === 'text') {
            translationResults.set('text-' + task.index,
                `\n\n> **[翻译意外失败 - 保留原文 Part ${task.index+1}]**\n\n${task.content}\n\n`);
        } else if (task.type === 'table') {
            translationResults.set('table-' + task.index, {
                placeholder: task.placeholder,
                translatedContent: task.content
            });
        }
    });

    // 等待所有并发翻译任务完成
    try {
        await Promise.all(translationPromises);
    } catch (error) {
        console.error(`${logContext} An unexpected error occurred during Promise.all for translations:`, error);
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 错误: 并发翻译过程中出现意外错误。`);
        }
        hasErrors = true;
    }

    if (hasErrors) {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 部分或全部翻译任务处理失败 (已完成重试)。`);
        }
    } else {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 所有翻译任务处理完成。`);
        }
    }

    // 构建翻译后表格占位符映射
    let translatedTablePlaceholders = {};
    if (hasProtectedTables) {
        for (let i = 0; i < Object.keys(tablePlaceholders).length; i++) {
            const tableResult = translationResults.get('table-' + i);
            if (tableResult && tableResult.placeholder) {
                translatedTablePlaceholders[tableResult.placeholder] = tableResult.translatedContent;
            }
        }
    }

    // 收集所有文本块的翻译结果（原文和译文都做表格还原）
    const restoredOcrChunks = [];
    const translatedTextChunks = [];
    for (let i = 0; i < originalTextChunks.length; i++) {
        let ocrChunk = originalTextChunks[i];
        let translatedChunk = translationResults.get('text-' + i);
        // 原文分块还原原文表格
        if (hasProtectedTables && typeof restoreMarkdownTables === 'function') {
            ocrChunk = await restoreMarkdownTables(ocrChunk, tablePlaceholders);
        }
        // 译文分块还原翻译后表格
        if (hasProtectedTables && typeof restoreMarkdownTables === 'function') {
            translatedChunk = await restoreMarkdownTables(translatedChunk, translatedTablePlaceholders);
        }
        restoredOcrChunks.push(ocrChunk);
        translatedTextChunks.push(translatedChunk || originalTextChunks[i]);
    }

    // 合并已翻译的块
    let combinedTranslation = translatedTextChunks.join('\n\n');

    // 如果有表格，替换所有表格占位符（保险起见，整体再替换一遍）
    if (hasProtectedTables) {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 正在替换表格占位符...`);
        }

        for (let i = 0; i < Object.keys(translatedTablePlaceholders).length; i++) {
            const placeholder = Object.keys(translatedTablePlaceholders)[i];
            const translatedContent = translatedTablePlaceholders[placeholder];
            combinedTranslation = combinedTranslation.replace(
                placeholder,
                translatedContent
            );
        }

        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 表格占位符替换完成。`);
        }
    }

    return {
        translatedText: combinedTranslation,
        originalChunks: restoredOcrChunks, // 现在是还原了表格的原文分块
        translatedTextChunks: translatedTextChunks // 现在是还原了表格的译文分块
    };
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.splitMarkdownIntoChunks = splitMarkdownIntoChunks;
    processModule.splitByParagraphs = splitByParagraphs;
    processModule.translateLongDocument = translateLongDocument;
}
