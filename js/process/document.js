// process/document.js

/**
 * 将长文档分割为可翻译的块
 * @param {string} markdown - 要分割的Markdown文本
 * @param {number} tokenLimit - 每块的最大token数
 * @param {string} logContext - 日志前缀
 * @returns {Array<string>} 分割后的文本块数组
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
 * 按段落分割过大的文本块
 * @param {string} text - 需要分割的文本
 * @param {number} tokenLimit - 每块的最大token数
 * @param {string} logContext - 日志前缀
 * @param {number} chunkIndex - 当前块的索引
 * @returns {Array<string>} 分割后的子块数组
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
 * 翻译长文档（分段翻译并处理表格）
 * @param {string} markdownText - 待翻译的Markdown文本
 * @param {string} targetLang - 目标语言
 * @param {string} model - 翻译模型
 * @param {string} apiKey - API密钥
 * @param {Object | null} modelConfig - 翻译模型的配置对象 (特别是自定义模型)
 * @param {number | string} tokenLimitInput - 每段最大token数 (可以是数字或字符串)
 * @param {function} acquireSlot - 获取并发槽位的函数
 * @param {function} releaseSlot - 释放并发槽位的函数
 * @param {string} logContext - 日志前缀
 * @param {string} defaultSystemPrompt - 默认系统提示词
 * @param {string} defaultUserPromptTemplate - 默认用户提示词模板
 * @param {boolean} useCustomPrompts - 是否使用自定义提示词
 * @returns {Promise<Object>} 包含翻译后文本和分块信息的对象 { translatedText: string, originalChunks: Array<string>, translatedTextChunks: Array<string> }
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
            modelConfig.max_tokens
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
                            false
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
                            false
                        );
                    }
                    //console.log('document.js translateMarkdown 返回:', result);
                    translationResults.set('text-' + task.index, result);
                } else if (task.type === 'table') {
                    // 翻译表格
                    const tableSystemPrompt = `你是一个精确翻译表格的助手。请将表格翻译成${targetLang}，严格保持以下格式要求：
1. 保持所有表格分隔符（|）和结构完全不变
2. 保持表格对齐标记（:--:、:--、--:）不变
3. 保持表格的行数和列数完全一致
4. 保持数学公式、符号和百分比等专业内容不变
5. 翻译表格标题（如有）和表格内的文本内容
6. 表格内容与表格外内容要明确区分`;

                    // 用户提示词
                    const tableUserPrompt = `请将以下Markdown表格翻译成${targetLang}，请确保完全保持表格结构和格式：

${task.content}

注意：请保持表格格式完全不变，包括所有的 | 符号、对齐标记、数学公式和符号。`;

                    // 构建请求体
                    const requestBody = apiConfig.bodyBuilder
                        ? apiConfig.bodyBuilder(tableSystemPrompt, tableUserPrompt)
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