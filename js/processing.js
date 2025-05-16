// js/processing.js

// =====================
// PDF 处理主流程与工具函数
// =====================

// 导入依赖 (如果使用模块化)
// import { apiKeyManager, uploadToMistral, getMistralSignedUrl, callMistralOcr, deleteMistralFile, callTranslationApi, getApiError } from './api.js';
// import { addProgressLog, maxTokensPerChunk, targetLanguage, showNotification } from './ui.js';
// import { saveAs } from 'file-saver'; // 假设 FileSaver 是全局可用的，或者通过 import 引入
// import JSZip from 'jszip'; // 假设 JSZip 是全局可用的，或者通过 import 引入

// ---------------------
// 指数退避+抖动的重试延迟工具
// ---------------------
function getRetryDelay(retryCount, baseDelay = 500, maxDelay = 30000) {
    // retryCount: 当前重试次数，baseDelay: 基础延迟(ms)，maxDelay: 最大延迟(ms)
    const exponentialDelay = baseDelay * Math.pow(2, retryCount);
    // 抖动: 在 ±10% 范围内随机浮动
    const jitter = exponentialDelay * 0.2 * (Math.random() - 0.5);
    const totalDelay = Math.min(exponentialDelay + jitter, maxDelay);
    return Math.max(totalDelay, baseDelay);
}

// ---------------------
// 单个 PDF 文件处理主流程
// ---------------------
/**
 * 处理单个 PDF 文件，包含 OCR、图片提取、分段翻译、错误处理、清理等完整流程
 * @param {File} fileToProcess - 待处理的 PDF 文件对象
 * @param {string} mistralKey - Mistral API Key
 * @param {string} translationKey - 翻译 API Key
 * @param {string} translationModel - 翻译模型标识
 * @param {number} maxTokensPerChunkValue - 每段最大 token 数
 * @param {string} targetLanguageValue - 目标语言
 * @param {function} acquireSlot - 获取并发槽函数
 * @param {function} releaseSlot - 释放并发槽函数
 * @param {string} defaultSystemPromptSetting - 默认系统提示
 * @param {string} defaultUserPromptTemplateSetting - 默认用户提示模板
 * @returns {Promise<Object>} 处理结果对象
 */
async function processSinglePdf(fileToProcess, mistralKey, translationKey, translationModel, maxTokensPerChunkValue, targetLanguageValue, acquireSlot, releaseSlot, defaultSystemPromptSetting, defaultUserPromptTemplateSetting) {
    let currentMarkdownContent = '';
    let currentTranslationContent = '';
    let currentImagesData = [];
    let fileId = null;
    const logPrefix = `[${fileToProcess.name}]`;
    let mistralKeyInUse = mistralKey;
    let translationKeyInUse = translationKey;
    let mistralKeyTried = new Set();
    let translationKeyTried = new Set();

    try {
        addProgressLog(`${logPrefix} 开始处理 (Mistral Key: ...${mistralKeyInUse ? mistralKeyInUse.slice(-4) : 'N/A'})`);

        // --- OCR 流程 ---
        let ocrSuccess = false;
        let ocrError = null;
        for (let ocrRetry = 0; ocrRetry < 5 && !ocrSuccess; ocrRetry++) {
            try {
                if (!mistralKeyInUse || mistralKeyInUse.length < 20) {
                    throw new Error('无效的 Mistral API Key 提供给处理函数');
                }
                addProgressLog(`${logPrefix} 上传到 Mistral...`);
                fileId = await uploadToMistral(fileToProcess, mistralKeyInUse);
                addProgressLog(`${logPrefix} 上传成功, File ID: ${fileId}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                addProgressLog(`${logPrefix} 获取签名 URL...`);
                const signedUrl = await getMistralSignedUrl(fileId, mistralKeyInUse);
                addProgressLog(`${logPrefix} 成功获取 URL`);
                addProgressLog(`${logPrefix} 开始 OCR 处理...`);
                const ocrData = await callMistralOcr(signedUrl, mistralKeyInUse);
                addProgressLog(`${logPrefix} OCR 完成`);
                addProgressLog(`${logPrefix} 处理 OCR 结果...`);
                const processedOcr = processOcrResults(ocrData);
                currentMarkdownContent = processedOcr.markdown;
                currentImagesData = processedOcr.images;
                addProgressLog(`${logPrefix} Markdown 生成完成`);
                ocrSuccess = true;
            } catch (error) {
                ocrError = error;
                // 检查是否为 key 失效
                if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.includes('invalid') || error.message.includes('Unauthorized'))) {
                    apiKeyManager.markKeyInvalid('mistral', mistralKeyInUse);
                    mistralKeyTried.add(mistralKeyInUse);
                    mistralKeyInUse = apiKeyManager.getMistralKey();
                    if (!mistralKeyInUse || mistralKeyTried.has(mistralKeyInUse)) {
                        throw new Error('所有 Mistral API Key 已失效，请补充有效 key');
                    }
                    addProgressLog(`${logPrefix} 检测到 Mistral Key 失效，自动切换下一个 key 重试...`);
                } else {
                    // 其他错误指数重试
                    const delay = getRetryDelay(ocrRetry);
                    addProgressLog(`${logPrefix} OCR 失败: ${error.message}，${delay.toFixed(0)}ms 后重试...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        if (!ocrSuccess) throw ocrError || new Error('OCR 处理失败');

        // --- 翻译流程 (如果需要) ---
        if (translationModel !== 'none') {
            if (!translationKeyInUse) {
                addProgressLog(`${logPrefix} 警告: 需要翻译但未提供有效的翻译 API Key。跳过翻译。`);
            } else {
                addProgressLog(`${logPrefix} 开始翻译 (${translationModel}, Key: ...${translationKeyInUse.slice(-4)})`);
                const estimatedTokens = estimateTokenCount(currentMarkdownContent);
                const tokenLimit = parseInt(maxTokensPerChunkValue) || 2000;
                let translationSuccess = false;
                let translationError = null;
                for (let tRetry = 0; tRetry < 5 && !translationSuccess; tRetry++) {
                    try {
                        if (estimatedTokens > tokenLimit * 1.1) {
                            addProgressLog(`${logPrefix} 文档较大 (~${Math.round(estimatedTokens/1000)}K tokens), 分段翻译`);
                            currentTranslationContent = await translateLongDocument(
                                currentMarkdownContent,
                                targetLanguageValue,
                                translationModel,
                                translationKeyInUse,
                                tokenLimit,
                                acquireSlot,
                                releaseSlot,
                                logPrefix,
                                defaultSystemPromptSetting,
                                defaultUserPromptTemplateSetting
                            );
                        } else {
                            addProgressLog(`${logPrefix} 文档较小 (~${Math.round(estimatedTokens/1000)}K tokens), 直接翻译`);
                            addProgressLog(`${logPrefix} 获取翻译槽...`);
                            await acquireSlot();
                            addProgressLog(`${logPrefix} 翻译槽已获取。调用 API...`);
                            try {
                                currentTranslationContent = await translateMarkdown(
                                    currentMarkdownContent,
                                    targetLanguageValue,
                                    translationModel,
                                    translationKeyInUse,
                                    logPrefix,
                                    defaultSystemPromptSetting,
                                    defaultUserPromptTemplateSetting
                                );
                            } finally {
                                releaseSlot();
                                addProgressLog(`${logPrefix} 翻译槽已释放。`);
                            }
                        }
                        translationSuccess = true;
                    } catch (error) {
                        translationError = error;
                        // 检查是否为 key 失效
                        if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.includes('invalid') || error.message.includes('Unauthorized'))) {
                            apiKeyManager.markKeyInvalid('translation', translationKeyInUse);
                            translationKeyTried.add(translationKeyInUse);
                            translationKeyInUse = apiKeyManager.getTranslationKey();
                            if (!translationKeyInUse || translationKeyTried.has(translationKeyInUse)) {
                                throw new Error('所有翻译 API Key 已失效，请补充有效 key');
                            }
                            addProgressLog(`${logPrefix} 检测到翻译 Key 失效，自动切换下一个 key 重试...`);
                        } else {
                            // 其他错误指数重试
                            const delay = getRetryDelay(tRetry);
                            addProgressLog(`${logPrefix} 翻译失败: ${error.message}，${delay.toFixed(0)}ms 后重试...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                }
                if (!translationSuccess) throw translationError || new Error('翻译失败');
                addProgressLog(`${logPrefix} 翻译完成`);
            }
        } else {
            addProgressLog(`${logPrefix} 不需要翻译`);
        }

        await saveResultToDB({
            id: `${fileToProcess.name}_${fileToProcess.size}`,
            name: fileToProcess.name,
            size: fileToProcess.size,
            time: new Date().toISOString(),
            ocr: currentMarkdownContent,
            translation: currentTranslationContent,
            images: currentImagesData
        });

        return {
            file: fileToProcess,
            markdown: currentMarkdownContent,
            translation: currentTranslationContent,
            images: currentImagesData,
            error: null
        };

    } catch (error) {
        console.error(`${logPrefix} 处理文件时出错:`, error);
        addProgressLog(`${logPrefix} 错误: ${error.message}`);
        return {
            file: fileToProcess,
            markdown: null,
            translation: null,
            images: [],
            error: error.message
        };
    } finally {
        // 清理 Mistral 文件
        if (fileId && mistralKeyInUse) {
            try {
                await deleteMistralFile(fileId, mistralKeyInUse);
                addProgressLog(`${logPrefix} 已清理 Mistral 临时文件 (ID: ${fileId})`);
            } catch (deleteError) {
                // 仅记录警告，不影响整体结果
                console.warn(`${logPrefix} 清理 Mistral 文件 ${fileId} 失败:`, deleteError);
                addProgressLog(`${logPrefix} 警告: 清理 Mistral 文件 ${fileId} 失败: ${deleteError.message}`);
            }
        }
    }
}

// ---------------------
// OCR 结果处理与图片替换
// ---------------------
/**
 * 处理 OCR 返回的结构，生成 markdown 文本和图片数据数组
 * @param {Object} ocrResponse - OCR API 返回的 JSON
 * @returns {Object} { markdown, images }
 */
function processOcrResults(ocrResponse) {
    let markdownContent = '';
    let imagesData = [];

    try {
        for (const page of ocrResponse.pages) {
            const pageImages = {};

            if (page.images && Array.isArray(page.images)) {
                for (const img of page.images) {
                    if (img.id && img.image_base64) {
                        const imgId = img.id;
                        const imgData = img.image_base64;
                        imagesData.push({ id: imgId, data: imgData });
                        // 记录图片 ID 到 markdown 路径的映射
                        pageImages[imgId] = `images/${imgId}.png`;
                    }
                }
            }

            let pageMarkdown = page.markdown || '';

            // 修正正则表达式转义，所有 \\ 都要写成 \\\\，否则括号不匹配
            for (const [imgName, imgPath] of Object.entries(pageImages)) {
                const escapedImgName = escapeRegex(imgName);
                const imgRegex = new RegExp(`!\\[([^\\]]*?)\\]\\(${escapedImgName}\\)`, 'g');
                pageMarkdown = pageMarkdown.replace(imgRegex, (match, altText) => {
                    const finalAltText = altText || imgName;
                    return `![${finalAltText}](${imgPath})`;
                });
            }

            markdownContent += pageMarkdown + '\n\n';
        }

        return { markdown: markdownContent.trim(), images: imagesData };
    } catch (error) {
        console.error('处理OCR结果时出错:', error);
        addProgressLog(`错误：处理 OCR 结果失败 - ${error.message}`);
        return { markdown: `[错误：处理OCR结果时发生错误 - ${error.message}]`, images: [] };
    }
}

// 工具：转义正则特殊字符
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------
// 翻译相关核心逻辑
// ---------------------
// 详见 translateMarkdown、translateLongDocument、buildPredefinedApiConfig、buildCustomApiConfig
// ...（此处省略，后续函数体内已自带较多注释，补充关键点即可）...

// 辅助函数：构建预定义 API 配置 (添加 bodyBuilder 参数)
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

// 长文档翻译 (添加 tokenLimit 参数 和 semaphore functions, 以及重试逻辑)
async function translateLongDocument(markdownText, targetLang, model, apiKey, tokenLimit, acquireSlot, releaseSlot, logContext = "", defaultSystemPrompt = "", defaultUserPromptTemplate = "", useCustomPrompts = false) {
    const parts = splitMarkdownIntoChunks(markdownText, tokenLimit, logContext);
    console.log(`${logContext} 文档分割为 ${parts.length} 部分进行翻译 (Limit: ${tokenLimit})`);
    addProgressLog(`${logContext} 文档被分割为 ${parts.length} 部分进行翻译`);

    let translatedChunks = [];
    let hasErrors = false;
    const MAX_TRANSLATION_RETRIES = 3; // Define max retries (total 4 attempts)

    const translationPromises = parts.map(async (part, i) => {
        const partLogContext = `${logContext} (Part ${i+1}/${parts.length})`;
        let lastError = null;

        for (let attempt = 0; attempt <= MAX_TRANSLATION_RETRIES; attempt++) {
            const attemptNum = attempt + 1; // 1-based attempt number
            addProgressLog(`${partLogContext} 排队等待翻译槽 (尝试 ${attemptNum})...`);
            await acquireSlot(); // Acquire slot for this chunk attempt
            addProgressLog(`${partLogContext} 翻译槽已获取。开始翻译 (尝试 ${attemptNum})...`);

            try {
                // Translate the current chunk
                const partResult = await translateMarkdown(part, targetLang, model, apiKey, partLogContext, defaultSystemPrompt, defaultUserPromptTemplate, useCustomPrompts);
                releaseSlot(); // Release slot on success
                addProgressLog(`${partLogContext} 翻译槽已释放 (成功)。`);
                return partResult; // Success, exit retry loop
            } catch (error) {
                releaseSlot(); // Release slot on error too
                addProgressLog(`${partLogContext} 翻译槽已释放 (失败)。`);
                lastError = error; // Store the error
                console.error(`${partLogContext} 翻译失败 (尝试 ${attemptNum}/${MAX_TRANSLATION_RETRIES + 1}):`, error);
                addProgressLog(`${partLogContext} 警告: 翻译失败 (尝试 ${attemptNum}/${MAX_TRANSLATION_RETRIES + 1}) - ${error.message}.`);

                if (attempt < MAX_TRANSLATION_RETRIES) {
                    const delay = getRetryDelay(attempt); // Calculate delay based on attempt count (0-indexed for power)
                    addProgressLog(`${partLogContext} ${delay.toFixed(0)}ms 后重试...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    // Continue to the next iteration of the loop
                } else {
                    addProgressLog(`${partLogContext} 已达最大重试次数 (${MAX_TRANSLATION_RETRIES + 1}次尝试)，保留原文。`);
                    hasErrors = true; // Mark that an error occurred somewhere
                    // Return original part with error marker including retry info
                    return `\n\n> **[翻译错误 (重试 ${MAX_TRANSLATION_RETRIES + 1} 次失败) - 保留原文 Part ${i+1}]**\n\n${part}\n\n`;
                }
            }
        }
        // This part should theoretically not be reached if the loop logic is correct
        // (either success returns, or final failure returns).
        // Added as a fallback safety measure.
        console.error(`${partLogContext} Unexpected state reached after retry loop.`);
        addProgressLog(`${partLogContext} 警告: 翻译重试逻辑结束后状态意外，保留原文。`);
        hasErrors = true;
        return `\n\n> **[翻译意外失败 - 保留原文 Part ${i+1}]**\n\n${part}\n\n`;
    });

    // Wait for all concurrent translation tasks (including retries) to complete
    try {
        // Promise.all maintains the order of results corresponding to the input promises array
        translatedChunks = await Promise.all(translationPromises);
    } catch (error) {
        // This catch might not be strictly necessary if individual errors are handled within the map,
        // but it's good practice to catch potential Promise.all rejections.
        console.error(`${logContext} An unexpected error occurred during Promise.all for translations:`, error);
        addProgressLog(`${logContext} 错误: 并发翻译过程中出现意外错误。`);
        // Indicate a major failure, potentially returning original text or partial results
        hasErrors = true;
        // If Promise.all itself rejects, translatedChunks might be incomplete or undefined.
        // We might need to fill remaining chunks with error markers if possible,
        // though the map should handle individual failures returning error strings.
        // For simplicity, we rely on the map handling returning error strings for failed parts.
    }

    if (hasErrors) {
        addProgressLog(`${logContext} 部分或全部翻译块处理失败 (已完成重试)。`);
    } else {
        addProgressLog(`${logContext} 所有翻译块处理完成。`);
    }

    // Join the results (which are either translated strings or error placeholders) in order
    return translatedChunks.join('\n\n');
}

// --- Markdown 分割逻辑 ---

// 主分割函数 (添加 tokenLimit 参数)
function splitMarkdownIntoChunks(markdown, tokenLimit, logContext = "") {
    const estimatedTokens = estimateTokenCount(markdown);
    addProgressLog(`${logContext} 估算总 token 数: ~${estimatedTokens}, 分段限制: ${tokenLimit}`);

    if (estimatedTokens <= tokenLimit * 1.1) {
        addProgressLog(`${logContext} 文档未超过大小限制，不进行分割。`);
        return [markdown];
    }

    addProgressLog(`${logContext} 文档超过大小限制，开始分割...`);
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
                    // addProgressLog(`${logContext} 分割点 (Token Limit): 行 ${i+1}, 当前 ${currentTokenCount} + ${lineTokens} > ${tokenLimit}`);
                }
            }
            else if (!inCodeBlock && headingRegex.test(line)) {
                const match = line.match(headingRegex);
                if (match && match[1].length <= 2 && currentTokenCount > tokenLimit * 0.5) {
                    shouldSplit = true;
                    // addProgressLog(`${logContext} 分割点 (Heading H${match[1].length}): 行 ${i+1}, 当前 ${currentTokenCount} > ${tokenLimit * 0.5}`);
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

    addProgressLog(`${logContext} 初始分割为 ${chunks.length} 个片段.`);

    const finalChunks = [];
    for(let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];
        const chunkTokens = estimateTokenCount(chunk);
        if (chunkTokens > tokenLimit * 1.1) {
            addProgressLog(`${logContext} 警告: 第 ${j+1} 段 (${chunkTokens} tokens) 仍然超过限制 ${tokenLimit}. 尝试段落分割.`);
            const subChunks = splitByParagraphs(chunk, tokenLimit, logContext, j+1);
            finalChunks.push(...subChunks);
        } else {
            finalChunks.push(chunk);
        }
    }

    if (finalChunks.length !== chunks.length) {
        addProgressLog(`${logContext} 二次分割后总片段数: ${finalChunks.length}`);
    }

    return finalChunks;
}

// 段落分割 (添加 tokenLimit 参数)
function splitByParagraphs(text, tokenLimit, logContext, chunkIndex) {
    addProgressLog(`${logContext} 对第 ${chunkIndex} 段进行段落分割...`);
    const paragraphs = text.split('\n\n');
    const chunks = [];
    let currentChunkLines = [];
    let currentTokenCount = 0;

    for (const paragraph of paragraphs) {
        const paragraphTokens = estimateTokenCount(paragraph);

        if (paragraphTokens > tokenLimit * 1.1) {
            addProgressLog(`${logContext} 警告: 第 ${chunkIndex} 段中的段落 (${paragraphTokens} tokens) 超过限制 ${tokenLimit}. 将尝试按原样处理.`);
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
    addProgressLog(`${logContext} 第 ${chunkIndex} 段分割为 ${chunks.length} 个子段.`);
    return chunks;
}

// Token 估算
function estimateTokenCount(text) {
    if (!text) return 0;
    // A slightly more refined estimation might be better
    const nonAsciiRatio = (text.match(/[^ - ]/g) || []).length / text.length;
    if (nonAsciiRatio > 0.3) { // Heuristic for CJK languages
        return Math.ceil(text.length * 1.1);
    } else {
        // Roughly 3-4 chars per token for English/code
        return Math.ceil(text.length / 3.5);
    }
}

// --- 下载结果 ---

async function downloadAllResults(allResultsData) {
    const successfulResults = allResultsData.filter(result => result && !result.error && result.markdown && !result.skipped);

    if (successfulResults.length === 0) {
        showNotification('没有成功的处理结果可供下载', 'warning');
        return;
    }

    addProgressLog('开始打包下载结果...');
    if (typeof JSZip === 'undefined') {
        showNotification('JSZip 加载失败，无法打包下载', 'error');
        return;
    }
    const zip = new JSZip();
    let filesAdded = 0;

    for (const result of successfulResults) {
        const pdfName = result.file.name.replace(/\.pdf$/i, '');
        const safeFolderName = pdfName.replace(/[/\\:*?"<>|]/g, '_').substring(0, 100);
        const folder = zip.folder(safeFolderName);

        folder.file('document.md', result.markdown);

        if (result.translation) {
            const currentDate = new Date().toISOString().split('T')[0];
            const headerDeclaration = `> *本文档由 Paper Burner 工具制作 (${currentDate})。内容由 AI 大模型翻译生成，不保证翻译内容的准确性和完整性。*\n\n`;
            const footerDeclaration = `\n\n---\n> *免责声明：本文档内容由大模型API自动翻译生成，Paper Burner 工具不对翻译内容的准确性、完整性和合法性负责。*`;
            const contentToDownload = headerDeclaration + result.translation + footerDeclaration;
            folder.file('translation.md', contentToDownload);
        }

        if (result.images && result.images.length > 0) {
            const imagesFolder = folder.folder('images');
            for (const img of result.images) {
                try {
                    const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                    if (base64Data) {
                        imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                    } else {
                        console.warn(`Skipping image ${img.id} in ${safeFolderName} due to missing data.`);
                        addProgressLog(`警告: 跳过图片 ${img.id} (文件: ${safeFolderName})，数据缺失。`);
                    }
                } catch (imgError) {
                    console.error(`Error adding image ${img.id} to zip for ${safeFolderName}:`, imgError);
                    addProgressLog(`警告: 打包图片 ${img.id} (文件: ${safeFolderName}) 时出错: ${imgError.message}`);
                }
            }
        }
        filesAdded++;
    }

    if (filesAdded === 0) {
        showNotification('没有成功处理的文件可以打包下载', 'warning');
        addProgressLog('没有可打包的文件。');
        return;
    }

    try {
        addProgressLog(`正在生成包含 ${filesAdded} 个文件结果的 ZIP 包...`);
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveAs(zipBlob, `PaperBurner_Results_${timestamp}.zip`);
        addProgressLog('ZIP 文件生成完毕，开始下载。');
    } catch (error) {
        console.error('创建或下载 ZIP 文件失败:', error);
        showNotification('创建 ZIP 文件失败: ' + error.message, 'error');
        addProgressLog('错误: 创建 ZIP 文件失败 - ' + error.message);
    }
}

// --- 导出处理相关函数 ---
// export { processSinglePdf, downloadAllResults, ... };

// 在此处补充 translateMarkdown 函数
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
    useCustomPrompts = false
) {
    // 构建 prompt
    let systemPrompt = defaultSystemPrompt;
    let userPrompt = defaultUserPromptTemplate;

    // 如果未启用自定义提示，或自定义提示为空，则使用内置模板
    if (!useCustomPrompts || !systemPrompt || !userPrompt) {
        if (typeof getBuiltInPrompts === "function") {
            const prompts = getBuiltInPrompts(targetLang);
            systemPrompt = prompts.systemPrompt;
            userPrompt = prompts.userPromptTemplate;
        } else {
            // 兜底
            systemPrompt = "You are a professional document translation assistant.";
            userPrompt = "Please translate the following content into the target language:\n\n${content}";
        }
    }

    // 替换模板变量
    userPrompt = userPrompt
        .replace(/\$\{targetLangName\}/g, targetLang)
        .replace(/\$\{content\}/g, markdown);

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
    return result;
}

