// process/main.js

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
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logPrefix} 开始处理 (Mistral Key: ...${mistralKeyInUse ? mistralKeyInUse.slice(-4) : 'N/A'})`);
        }

        // --- OCR 流程 ---
        let ocrSuccess = false;
        let ocrError = null;
        for (let ocrRetry = 0; ocrRetry < 5 && !ocrSuccess; ocrRetry++) {
            try {
                if (!mistralKeyInUse || mistralKeyInUse.length < 20) {
                    throw new Error('无效的 Mistral API Key 提供给处理函数');
                }
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 上传到 Mistral...`);
                }
                fileId = await uploadToMistral(fileToProcess, mistralKeyInUse);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 上传成功, File ID: ${fileId}`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 获取签名 URL...`);
                }
                const signedUrl = await getMistralSignedUrl(fileId, mistralKeyInUse);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 成功获取 URL`);
                    addProgressLog(`${logPrefix} 开始 OCR 处理...`);
                }
                const ocrData = await callMistralOcr(signedUrl, mistralKeyInUse);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} OCR 完成`);
                    addProgressLog(`${logPrefix} 处理 OCR 结果...`);
                }

                // 使用processOcrResults，验证函数可用
                if (typeof processOcrResults !== 'function') {
                    throw new Error('processOcrResults函数未定义，无法处理OCR结果');
                }

                const processedOcr = processOcrResults(ocrData);
                currentMarkdownContent = processedOcr.markdown;
                currentImagesData = processedOcr.images;
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} Markdown 生成完成`);
                }
                ocrSuccess = true;
            } catch (error) {
                ocrError = error;
                // 检查是否为 key 失效
                if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.includes('invalid') || error.message.includes('Unauthorized'))) {
                    if (typeof apiKeyManager !== "undefined") {
                        apiKeyManager.markKeyInvalid('mistral', mistralKeyInUse);
                        mistralKeyTried.add(mistralKeyInUse);
                        mistralKeyInUse = apiKeyManager.getMistralKey();
                    }
                    if (!mistralKeyInUse || mistralKeyTried.has(mistralKeyInUse)) {
                        throw new Error('所有 Mistral API Key 已失效，请补充有效 key');
                    }
                    if (typeof addProgressLog === "function") {
                        addProgressLog(`${logPrefix} 检测到 Mistral Key 失效，自动切换下一个 key 重试...`);
                    }
                } else {
                    // 其他错误指数重试
                    const delay = typeof getRetryDelay === 'function' ?
                                  getRetryDelay(ocrRetry) :
                                  Math.min(500 * Math.pow(2, ocrRetry), 30000);

                    if (typeof addProgressLog === "function") {
                        addProgressLog(`${logPrefix} OCR 失败: ${error.message}，${delay.toFixed(0)}ms 后重试...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        if (!ocrSuccess) throw ocrError || new Error('OCR 处理失败');

        // --- 翻译流程 (如果需要) ---
        if (translationModel !== 'none') {
            if (!translationKeyInUse) {
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 警告: 需要翻译但未提供有效的翻译 API Key。跳过翻译。`);
                }
            } else {
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 开始翻译 (${translationModel}, Key: ...${translationKeyInUse.slice(-4)})`);
                }

                // 验证estimateTokenCount函数可用
                if (typeof estimateTokenCount !== 'function') {
                    throw new Error('estimateTokenCount函数未定义，无法估算文档大小');
                }

                const estimatedTokens = estimateTokenCount(currentMarkdownContent);
                const tokenLimit = parseInt(maxTokensPerChunkValue) || 2000;
                let translationSuccess = false;
                let translationError = null;
                for (let tRetry = 0; tRetry < 5 && !translationSuccess; tRetry++) {
                    try {
                        if (estimatedTokens > tokenLimit * 1.1) {
                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 文档较大 (~${Math.round(estimatedTokens/1000)}K tokens), 分段翻译`);
                            }

                            // 验证translateLongDocument函数可用
                            if (typeof translateLongDocument !== 'function') {
                                throw new Error('translateLongDocument函数未定义，无法进行长文档翻译');
                            }

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
                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 文档较小 (~${Math.round(estimatedTokens/1000)}K tokens), 直接翻译`);
                                addProgressLog(`${logPrefix} 获取翻译槽...`);
                            }
                            await acquireSlot();
                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 翻译槽已获取。调用 API...`);
                            }
                            try {
                                // 验证translateMarkdown函数可用
                                if (typeof translateMarkdown !== 'function') {
                                    throw new Error('translateMarkdown函数未定义，无法进行翻译');
                                }

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
                                if (typeof addProgressLog === "function") {
                                    addProgressLog(`${logPrefix} 翻译槽已释放。`);
                                }
                            }
                        }
                        translationSuccess = true;
                    } catch (error) {
                        translationError = error;
                        // 检查是否为 key 失效
                        if (error.message && (error.message.includes('无效') || error.message.includes('未授权') || error.message.includes('401') || error.message.includes('invalid') || error.message.includes('Unauthorized'))) {
                            if (typeof apiKeyManager !== "undefined") {
                                apiKeyManager.markKeyInvalid('translation', translationKeyInUse);
                                translationKeyTried.add(translationKeyInUse);
                                translationKeyInUse = apiKeyManager.getTranslationKey();
                            }
                            if (!translationKeyInUse || translationKeyTried.has(translationKeyInUse)) {
                                throw new Error('所有翻译 API Key 已失效，请补充有效 key');
                            }
                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 检测到翻译 Key 失效，自动切换下一个 key 重试...`);
                            }
                        } else {
                            // 其他错误指数重试
                            const delay = typeof getRetryDelay === 'function' ?
                                         getRetryDelay(tRetry) :
                                         Math.min(500 * Math.pow(2, tRetry), 30000);

                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 翻译失败: ${error.message}，${delay.toFixed(0)}ms 后重试...`);
                            }
                            await new Promise(resolve => setTimeout(resolve, delay));
                        }
                    }
                }
                if (!translationSuccess) throw translationError || new Error('翻译失败');
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 翻译完成`);
                }
            }
        } else {
            if (typeof addProgressLog === "function") {
                addProgressLog(`${logPrefix} 不需要翻译`);
            }
        }

        if (typeof saveResultToDB === "function") {
            await saveResultToDB({
                id: `${fileToProcess.name}_${fileToProcess.size}`,
                name: fileToProcess.name,
                size: fileToProcess.size,
                time: new Date().toISOString(),
                ocr: currentMarkdownContent,
                translation: currentTranslationContent,
                images: currentImagesData
            });
        }

        return {
            file: fileToProcess,
            markdown: currentMarkdownContent,
            translation: currentTranslationContent,
            images: currentImagesData,
            error: null
        };

    } catch (error) {
        console.error(`${logPrefix} 处理文件时出错:`, error);
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logPrefix} 错误: ${error.message}`);
        }
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
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 已清理 Mistral 临时文件 (ID: ${fileId})`);
                }
            } catch (deleteError) {
                // 仅记录警告，不影响整体结果
                console.warn(`${logPrefix} 清理 Mistral 文件 ${fileId} 失败:`, deleteError);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 警告: 清理 Mistral 文件 ${fileId} 失败: ${deleteError.message}`);
                }
            }
        }
    }
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.processSinglePdf = processSinglePdf;
}