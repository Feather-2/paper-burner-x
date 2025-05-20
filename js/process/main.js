// process/main.js

/**
 * 处理单个 PDF 文件，包含 OCR、图片提取、分段翻译、错误处理、清理等完整流程
 * @param {File} fileToProcess - 待处理的 PDF 文件对象
 * @param {Object | null} mistralKeyObject - Mistral API Key 对象 {id, value} 或 null
 * @param {Object | null} translationKeyObject - 翻译 API Key 对象 {id, value} 或 null
 * @param {string} selectedTranslationModelName - 选定的翻译模型名称 (e.g., 'deepseek', 'custom', 'none')
 * @param {Object | null} translationModelConfig - 选定翻译模型的配置对象 (对custom模型尤其重要)
 * @param {number} maxTokensPerChunkValue - 每段最大 token 数
 * @param {string} targetLanguageValue - 目标语言
 * @param {function} acquireSlot - 获取并发槽函数
 * @param {function} releaseSlot - 释放并发槽函数
 * @param {string} defaultSystemPromptSetting - 默认系统提示
 * @param {string} defaultUserPromptTemplateSetting - 默认用户提示模板
 * @param {boolean} useCustomPromptsSetting - 是否使用自定义提示 (app.js中新增)
 * @param {function} onFileSuccess - 文件处理成功后的回调函数
 * @returns {Promise<Object>} 处理结果对象, 可能包含 keyInvalid 属性
 */
async function processSinglePdf(
    fileToProcess,
    mistralKeyObject,
    translationKeyObject,
    selectedTranslationModelName,
    translationModelConfig,
    maxTokensPerChunkValue,
    targetLanguageValue,
    acquireSlot,
    releaseSlot,
    defaultSystemPromptSetting,
    defaultUserPromptTemplateSetting,
    useCustomPromptsSetting, // 新增参数
    onFileSuccess
) {
    let currentMarkdownContent = '';
    let currentTranslationContent = '';
    let currentImagesData = [];
    let mistralFileId = null; // 重命名 fileId to mistralFileId for clarity
    const logPrefix = `[${fileToProcess.name}]`;
    const fileType = fileToProcess.name.split('.').pop().toLowerCase();
    let ocrChunks = [];
    let translatedChunks = [];
    // 移除旧的内部重试和key切换逻辑，这些将由 app.js 处理

    console.log('processSinglePdf: translationKeyObject', translationKeyObject);

    try {
        const mistralKeyValue = mistralKeyObject ? mistralKeyObject.value : null;
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logPrefix} 开始处理 (类型: ${fileType}, Mistral Key: ...${mistralKeyValue ? mistralKeyValue.slice(-4) : 'N/A'})`);
        }

        if (fileType === 'pdf') {
            if (!mistralKeyValue) {
                throw new Error('处理 PDF 文件需要 Mistral API Key，但未提供。');
            }
            try {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 上传到 Mistral...`);
                mistralFileId = await uploadToMistral(fileToProcess, mistralKeyValue);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 上传成功, File ID: ${mistralFileId}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // 短暂等待，确保文件在Mistral端准备好
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 获取签名 URL...`);
                const signedUrl = await getMistralSignedUrl(mistralFileId, mistralKeyValue);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 成功获取 URL，开始 OCR 处理...`);
                const ocrData = await callMistralOcr(signedUrl, mistralKeyValue);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} OCR 完成，处理 OCR 结果...`);

                if (typeof processOcrResults !== 'function') {
                    throw new Error('processOcrResults函数未定义，无法处理OCR结果');
                }
                const processedOcr = processOcrResults(ocrData);
                currentMarkdownContent = processedOcr.markdown;
                currentImagesData = processedOcr.images;
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} Markdown 生成完成`);
            } catch (error) {
                // 判断是否为 Mistral Key 失效错误
                if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.toLowerCase().includes('invalid api key') || error.message.toLowerCase().includes('unauthorized'))) {
                    if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} Mistral API Key (...${mistralKeyValue.slice(-4)}) 可能已失效: ${error.message}`);
                    return {
                        file: fileToProcess,
                        keyInvalid: {
                            type: 'mistral',
                            keyIdToInvalidate: mistralKeyObject.id
                        },
                        error: `Mistral Key 失效: ${error.message}`
                    };
                }
                throw error; // 其他类型的OCR错误，向上抛出由 app.js 的常规重试处理
            }
        } else if (fileType === 'md' || fileType === 'txt') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 读取 ${fileType.toUpperCase()} 文件内容...`);
            try {
                currentMarkdownContent = await fileToProcess.text();
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} ${fileType.toUpperCase()} 文件内容读取完成`);
                currentImagesData = [];
            } catch (readError) {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 读取 ${fileType.toUpperCase()} 文件失败: ${readError.message}`);
                throw new Error(`读取 ${fileType.toUpperCase()} 文件失败: ${readError.message}`);
            }
        } else {
            throw new Error(`不支持的文件类型: ${fileType}`);
        }

        // --- 翻译流程 (如果需要) ---
        if (selectedTranslationModelName !== 'none') {
            const translationKeyValue = translationKeyObject ? translationKeyObject.value : null;
            if (!translationKeyValue) {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 警告: 需要翻译但未提供有效的翻译 API Key。跳过翻译。`);
                currentTranslationContent = '[未翻译：缺少API Key]';
                ocrChunks = [currentMarkdownContent];
                translatedChunks = [currentTranslationContent];
            } else {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 开始翻译 (${selectedTranslationModelName}, Key: ...${translationKeyValue.slice(-4)})`);

                if (typeof estimateTokenCount !== 'function') throw new Error('estimateTokenCount函数未定义');
                const estimatedTokens = estimateTokenCount(currentMarkdownContent);
                const tokenLimit = parseInt(maxTokensPerChunkValue) || 2000;

                try {
                    if (estimatedTokens > tokenLimit * 1.1) {
                        if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 文档较大 (~${Math.round(estimatedTokens/1000)}K tokens), 分段翻译`);
                        if (typeof translateLongDocument !== 'function') throw new Error('translateLongDocument函数未定义');

                        console.log('main.js 调用 translateLongDocument 参数:', {
                            useCustomPromptsSetting,
                            defaultUserPromptTemplateSetting,
                            defaultSystemPromptSetting,
                            translationModelConfig,
                            currentMarkdownContent,
                            targetLanguageValue,
                            selectedTranslationModelName,
                            translationKeyValue,
                            tokenLimit,
                            logPrefix
                        });
                        let translationResult;
                        if (selectedTranslationModelName === 'custom') {
                            translationResult = await translateLongDocument(
                                currentMarkdownContent,
                                targetLanguageValue,
                                selectedTranslationModelName,
                                translationKeyValue,
                                translationModelConfig,
                                tokenLimit,
                                acquireSlot,
                                releaseSlot,
                                logPrefix,
                                defaultSystemPromptSetting,
                                defaultUserPromptTemplateSetting,
                                useCustomPromptsSetting
                            );
                        } else {
                            translationResult = await translateLongDocument(
                                currentMarkdownContent,
                                targetLanguageValue,
                                selectedTranslationModelName,
                                translationKeyValue,
                                tokenLimit,
                                acquireSlot,
                                releaseSlot,
                                logPrefix,
                                defaultSystemPromptSetting,
                                defaultUserPromptTemplateSetting,
                                useCustomPromptsSetting
                            );
                        }
                        console.log('main.js translateLongDocument 返回:', translationResult);
                        currentTranslationContent = translationResult.translatedText;
                        ocrChunks = translationResult.originalChunks;
                        translatedChunks = translationResult.translatedTextChunks;
                    } else {
                        if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 文档较小 (~${Math.round(estimatedTokens/1000)}K tokens), 直接翻译`);
                        await acquireSlot();
                        if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 翻译槽已获取。调用 API...`);
                        try {
                            if (typeof translateMarkdown !== 'function') throw new Error('translateMarkdown函数未定义');
                            //console.log('main.js 调用 translateMarkdown 参数:', {
                            //    useCustomPromptsSetting,
                            //    defaultUserPromptTemplateSetting,
                            //    defaultSystemPromptSetting,
                            //    translationModelConfig,
                            //    currentMarkdownContent,
                            //    targetLanguageValue,
                            //    selectedTranslationModelName,
                            //    translationKeyValue,
                            //    logPrefix
                            //});
                            //console.log('main.js/document.js 实际传递的 defaultUserPromptTemplateSetting:', defaultUserPromptTemplateSetting);
                            //console.log('main.js/document.js 实际传递的 defaultSystemPromptSetting:', defaultSystemPromptSetting);
                            currentTranslationContent = await translateMarkdown(
                                currentMarkdownContent,
                                targetLanguageValue,
                                selectedTranslationModelName,
                                translationKeyValue,
                                logPrefix,
                                defaultSystemPromptSetting,
                                defaultUserPromptTemplateSetting,
                                useCustomPromptsSetting
                            );
                            //console.log('main.js translateMarkdown 返回:', currentTranslationContent);
                            ocrChunks = [currentMarkdownContent];
                            translatedChunks = [currentTranslationContent];
                        } finally {
                            releaseSlot();
                            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} _翻译槽已释放。`);
                        }
                    }
                    if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 翻译完成`);
                } catch (error) {
                    // 判断是否为翻译 Key 失效错误
                    // 这里的判断条件可能需要根据实际API的错误响应来调整
                    if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.toLowerCase().includes('invalid api key') || error.message.toLowerCase().includes('unauthorized') || error.message.includes('API key not valid') || error.message.includes('forbidden'))) {
                        if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 翻译 API Key (...${translationKeyValue.slice(-4)}) 可能已失效 (${selectedTranslationModelName}): ${error.message}`);
                        return {
                            file: fileToProcess,
                            keyInvalid: {
                                type: 'translation',
                                modelName: selectedTranslationModelName,
                                keyIdToInvalidate: translationKeyObject.id
                            },
                            error: `翻译 Key 失效: ${error.message}`
                        };
                    }
                    // 其他翻译错误，标记为翻译失败，但OCR结果可能仍有效
                    if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 翻译失败: ${error.message}。将使用原文并标记错误。`);
                    currentTranslationContent = `[翻译失败: ${error.message}] ${currentMarkdownContent}`;
                    ocrChunks = [currentMarkdownContent];
                    translatedChunks = [currentTranslationContent];
                    // 不向上抛出，允许OCR成功但翻译失败的情况，在最终结果中体现
                }
            }
        } else {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 不需要翻译`);
            ocrChunks = [currentMarkdownContent];
            translatedChunks = [''];
        }

        if (typeof saveResultToDB === "function") {
            await saveResultToDB({
                id: `${fileToProcess.name}_${fileToProcess.size}`,
                name: fileToProcess.name,
                size: fileToProcess.size,
                time: new Date().toISOString(),
                ocr: currentMarkdownContent,
                translation: currentTranslationContent,
                images: currentImagesData,
                ocrChunks: ocrChunks,
                translatedChunks: translatedChunks
            });
        }

        if (typeof onFileSuccess === 'function') {
            onFileSuccess(fileToProcess);
        }
        return {
            file: fileToProcess,
            markdown: currentMarkdownContent,
            translation: currentTranslationContent,
            images: currentImagesData,
            ocrChunks: ocrChunks,
            translatedChunks: translatedChunks,
            error: null // 表示此文件处理成功（即使翻译部分可能仅标记了错误）
        };

    } catch (error) { // 捕获OCR流程中的致命错误，或其他未被特定keyInvalid逻辑捕获的错误
        console.error(`${logPrefix} 处理文件时发生严重错误:`, error);
        if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 严重错误: ${error.message}`);
        return {
            file: fileToProcess,
            markdown: null,
            translation: null,
            images: [],
            ocrChunks: [currentMarkdownContent || ''],
            translatedChunks: [`[处理错误: ${error.message}]`],
            error: error.message // 这个error会被 app.js 中的常规重试逻辑捕获
        };
    } finally {
        if (mistralFileId && mistralKeyObject && mistralKeyObject.value && fileType === 'pdf') {
            try {
                await deleteMistralFile(mistralFileId, mistralKeyObject.value);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 已清理 Mistral 临时文件 (ID: ${mistralFileId})`);
            } catch (deleteError) {
                console.warn(`${logPrefix} 清理 Mistral 文件 ${mistralFileId} 失败:`, deleteError);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 警告: 清理 Mistral 文件 ${mistralFileId} 失败: ${deleteError.message}`);
            }
        }
    }
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.processSinglePdf = processSinglePdf;
}