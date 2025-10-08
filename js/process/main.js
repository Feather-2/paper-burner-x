// process/main.js

/**
 * 处理单个 PDF 文件或 Markdown/TXT 文件的核心函数。
 * 该函数封装了从文件上传、OCR（如果需要）、内容提取、分段翻译（如果需要）、
 * 错误处理到结果保存的完整流程。
 *
 * 主要流程：
 * 1. **初始化与日志**：
 *    - 记录文件处理开始的日志，包括文件名、类型和使用的 API Key 信息（部分屏蔽）。
 * 2. **文件类型判断与内容提取**：
 *    - **PDF 文件**：
 *      - 检查 Mistral API Key 是否提供，未提供则抛出错误。
 *      - 调用 `uploadToMistral` 上传文件。
 *      - 调用 `getMistralSignedUrl` 获取签名 URL。
 *      - 调用 `callMistralOcr` 进行 OCR 处理。
 *      - 调用 `processOcrResults` (如果可用) 处理 OCR 结果，提取 Markdown 内容和图片数据。
 *      - 捕获 OCR 过程中的错误，特别是 API Key 失效的错误 (如401)，如果发生则返回特定错误对象，以便上层进行 Key 失效处理。
 *    - **MD/TXT 文件**：
 *      - 直接读取文件文本内容作为 Markdown 内容。
 *    - **DOCX 文件**：
 *      - 使用 `mammoth` 将文档转换为 HTML，再转为 Markdown。
 *    - **HTML 文件**：
 *      - 直接解析 HTML 并转为 Markdown。
 *    - **PPTX 文件**：
 *      - 解析各幻灯片 XML，提取文本内容并拼接。
 *    - **EPUB 文件**：
 *      - 解析 OPF 清单与 spine，依次抽取章节 HTML 转为 Markdown。
 *    - **不支持的文件类型**：抛出错误。
 * 3. **翻译流程** (如果 `selectedTranslationModelName` 不是 'none')：
 *    - 检查翻译 API Key 是否提供，未提供则记录警告，翻译内容标记为未翻译。
 *    - **估算 Token 数与分段判断**：
 *      - 使用 `estimateTokenCount` (如果可用) 估算 Markdown 内容的 token 数。
 *      - 如果 token 数超过 `tokenLimit * 1.1`，则判断为长文档，调用 `translateLongDocument` (如果可用) 进行分段翻译。
 *        `translateLongDocument` 内部会处理表格保护、并发控制、自定义模型配置和重试逻辑。
 *      - 否则，判断为短文档，直接调用 `translateMarkdown` (如果可用) 进行单块翻译。
 *        在调用 `translateMarkdown` 前后通过 `acquireSlot` 和 `releaseSlot` 控制并发。
 *    - **错误处理**：
 *      - 捕获翻译过程中的错误，特别是 API Key 失效的错误。如果发生，返回特定错误对象以便上层处理。
 *      - 其他翻译错误，则将翻译内容标记为失败，但保留 OCR 结果（如果成功）。
 * 4. **结果保存**：
 *    - 调用 `saveResultToDB` (如果可用) 将处理结果（包括原文、译文、图片、分块信息）保存到 IndexedDB。
 * 5. **成功回调**：
 *    - 调用 `onFileSuccess` 回调函数，通知上层该文件处理成功。
 * 6. **返回结果对象**：
 *    - 返回一个包含处理结果的对象，包括 `file`, `markdown`, `translation`, `images`, `ocrChunks`, `translatedChunks` 和 `error` (成功时为 `null`)。
 *    - 如果发生可识别的 Key 失效，`keyInvalid` 字段会被设置。
 * 7. **异常捕获 (Final Catch)**：
 *    - 捕获整个流程中未被特定逻辑捕获的严重错误，记录日志，并返回包含错误信息的对象。
 * 8. **资源清理 (Finally Block)**：
 *    - 如果是 PDF 文件且成功上传到 Mistral，则调用 `deleteMistralFile` 清理在 Mistral 服务器上的临时文件。
 *    - 捕获并记录清理过程中的潜在错误。
 *
 * @param {File} fileToProcess - 待处理的 PDF、Markdown 或 TXT 文件对象。
 * @param {Object | null} mistralKeyObject - Mistral API Key 对象，包含 `id` 和 `value`，或为 `null`。
 * @param {Object | null} translationKeyObject - 选定翻译模型对应的 API Key 对象，包含 `id` 和 `value`，或为 `null`。
 * @param {string} selectedTranslationModelName - 选定的翻译模型名称 (如 'deepseek', 'custom', 'none')。
 * @param {Object | null} translationModelConfig - 当 `selectedTranslationModelName` 为 'custom' 时，提供自定义模型的配置对象。
 * @param {number} maxTokensPerChunkValue - (用于长文档翻译) 每个翻译分块的最大 token 限制。
 * @param {string} targetLanguageValue - 目标翻译语言代码 (如 'zh-CN', 'en')。
 * @param {function} acquireSlot - 用于获取并发执行槽位的函数。
 * @param {function} releaseSlot - 用于释放并发执行槽位的函数。
 * @param {string} defaultSystemPromptSetting - 翻译时使用的默认系统提示词。
 * @param {string} defaultUserPromptTemplateSetting - 翻译时使用的默认用户提示词模板。
 * @param {boolean} useCustomPromptsSetting - 是否使用用户自定义的提示词。
 * @param {function} onFileSuccess - 单个文件处理成功后的回调函数，参数为成功处理的 `File` 对象。
 * @returns {Promise<Object>} 一个包含处理结果的对象。成功时结构如：
 *   `{ file, markdown, translation, images, ocrChunks, translatedChunks, error: null }`。
 *   失败或 Key 失效时，`error` 字段会有错误信息，`keyInvalid` 字段可能被设置。
 */
function convertHtmlToMarkdown(htmlText) {
    const html = String(htmlText || '');
    if (typeof TurndownService === 'function') {
        try {
            const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            return turndown.turndown(html);
        } catch (err) {
            console.warn('[convertHtmlToMarkdown] turndown 转换失败，回退为纯文本', err);
        }
    }
    return html
        .replace(/\r?\n/g, '\n')
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n');
}

function arrayBufferToBase64(buffer) {
    if (!buffer) return null;
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || []);
    if (!bytes.length) return null;
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

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
    batchContext,
    onFileSuccess
) {
    let currentMarkdownContent = '';
    let currentTranslationContent = '';
    let currentImagesData = [];
    let mistralFileId = null; // 重命名 fileId to mistralFileId for clarity
const logPrefix = `[${fileToProcess.name}]`;
const fileType = fileToProcess.name.split('.').pop().toLowerCase();
    const relativePath = fileToProcess.pbxRelativePath || fileToProcess.webkitRelativePath || fileToProcess.relativePath || fileToProcess.fullPath || fileToProcess.name;
    const sourceArchive = fileToProcess.sourceArchive || null;
    let ocrChunks = [];
    let translatedChunks = [];
    let originalContent = null;
    let originalBinary = null;
    let originalEncoding = null;
    let originalExtension = fileType || '';
    let ocrResult = null; // 保存 OCR 结果以便后续判断是否使用结构化翻译
    // 移除旧的内部重试和key切换逻辑，这些将由 app.js 处理

    console.log('processSinglePdf: translationKeyObject', translationKeyObject);

    try {
        let usedOcrEngine = null;
        let usedOcrSource = null;
        // 更合理的开始日志：显示 OCR 引擎而不是固定显示 Mistral Key
        let ocrEngineForLog = 'mistral';
        try {
            if (typeof window !== 'undefined' && window.ocrSettingsManager && typeof window.ocrSettingsManager.getCurrentConfig === 'function') {
                const cfg = window.ocrSettingsManager.getCurrentConfig();
                if (cfg && cfg.engine) ocrEngineForLog = cfg.engine;
            } else {
                ocrEngineForLog = localStorage.getItem('ocrEngine') || 'mistral';
            }
        } catch {}
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logPrefix} 开始处理 (类型: ${fileType}, OCR 引擎: ${ocrEngineForLog})`);
        }

        // 检查：如果选择了"不需要 OCR"但文件是 PDF，报错
        if (ocrEngineForLog === 'none' && fileType === 'pdf') {
            throw new Error('处理 PDF 文件需要选择 OCR 引擎，当前选择了"不需要 OCR"。请在设置中选择 Mistral OCR、MinerU 或 Doc2X。');
        }

        if (fileType === 'pdf') {
            // 使用 OCR Manager 进行多引擎 OCR 处理
            try {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 开始 OCR 处理...`);

                // 创建 OcrManager 实例
                if (typeof OcrManager === 'undefined') {
                    throw new Error('OcrManager 未加载，无法处理 PDF');
                }

                const ocrManager = new OcrManager();

                // 创建进度回调包装器
                const onProgress = (current, total, message) => {
                    if (typeof addProgressLog === "function") {
                        addProgressLog(`${logPrefix} ${message}`);
                    }
                };

                // 调用 OCR Manager 处理文件
                ocrResult = await ocrManager.processFile(fileToProcess, onProgress);

                // 提取结果
                currentMarkdownContent = ocrResult.markdown;
                currentImagesData = ocrResult.images;
                usedOcrEngine = ocrResult && ocrResult.metadata && ocrResult.metadata.engine ? ocrResult.metadata.engine : null;
                usedOcrSource = ocrResult && ocrResult.metadata && ocrResult.metadata.source ? ocrResult.metadata.source : null;

                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} OCR 完成 (引擎: ${ocrResult.metadata.engine})`);
                }

            } catch (error) {
                // 判断是否为 API Key 失效错误（兼容 Mistral 旧逻辑）
                if (error.message && (
                    error.message.includes('无效') ||
                    error.message.includes('未授权') ||
                    error.message.includes('401') ||
                    error.message.toLowerCase().includes('invalid api key') ||
                    error.message.toLowerCase().includes('unauthorized') ||
                    error.message.includes('可能已失效')
                )) {
                    // 如果是 Mistral 引擎且有 Key 对象，返回 Key 失效信息
                    if (mistralKeyObject && error.message.includes('Mistral')) {
                        if (typeof addProgressLog === "function") {
                            const mistralKeyValue = mistralKeyObject.value;
                            addProgressLog(`${logPrefix} Mistral API Key (...${mistralKeyValue.slice(-4)}) 可能已失效: ${error.message}`);
                        }
                        return {
                            file: fileToProcess,
                            keyInvalid: {
                                type: 'mistral',
                                keyIdToInvalidate: mistralKeyObject.id
                            },
                            error: `Mistral Key 失效: ${error.message}`
                        };
                    }
                }
                throw error; // 其他类型的OCR错误，向上抛出由 app.js 的常规重试处理
            }
        } else if (fileType === 'md' || fileType === 'txt' || fileType === 'yaml' || fileType === 'yml' || fileType === 'json' || fileType === 'csv' || fileType === 'ini' || fileType === 'cfg' || fileType === 'log' || fileType === 'tex') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 读取 ${fileType.toUpperCase()} 文件内容...`);
            try {
                originalContent = await fileToProcess.text();
                originalEncoding = 'text';
                currentMarkdownContent = originalContent;
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} ${fileType.toUpperCase()} 文件内容读取完成`);
                // 尝试从历史记录引用中携带图片：
                // 约定：如果 Markdown 以注释行 "<!-- PBX-HISTORY-REF:<id> -->" 开头，则从 IndexedDB 中取出该记录的 images。
                try {
                    const refMatch = currentMarkdownContent.match(/^<!--\s*PBX-HISTORY-REF:([^>]+)\s*-->\s*/m);
                    const isRetryFailed = /<!--\s*PBX-MODE:retry-failed\s*-->/.test(currentMarkdownContent);
                    const isRetryStructuredFailed = /<!--\s*PBX-MODE:retry-structured-failed\s*-->/.test(currentMarkdownContent);
                    if (refMatch && typeof getResultFromDB === 'function') {
                        const refId = refMatch[1].trim();
                        const refRecord = await getResultFromDB(refId);
                        if (refRecord && Array.isArray(refRecord.images)) {
                            currentImagesData = refRecord.images;
                            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 关联到历史记录 ${refId}，已载入 ${currentImagesData.length} 张图片`);
                        } else {
                            currentImagesData = [];
                        }

                        // ============ 特殊模式：结构化翻译失败片段重试，直接写回原历史 ============
                        if (isRetryStructuredFailed) {
                            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 检测到结构化翻译失败片段重试模式`);

                            // 解析失败片段索引
                            const failedIndicesMatch = currentMarkdownContent.match(/<!--\s*PBX-FAILED-INDICES:([^>]+)\s*-->/);
                            if (!failedIndicesMatch) {
                                throw new Error('未找到失败片段索引标记。');
                            }
                            const failedIndices = failedIndicesMatch[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

                            if (failedIndices.length === 0) {
                                throw new Error('未找到可重试的失败片段索引。');
                            }

                            if (!refRecord || !refRecord.metadata) {
                                throw new Error('未找到原历史记录或缺少元数据。');
                            }

                            const meta = refRecord.metadata;
                            if (!meta.contentListJson || !Array.isArray(meta.translatedContentList)) {
                                throw new Error('缺少结构化翻译数据，无法重试。');
                            }

                            if (typeof window.MinerUStructuredTranslation !== 'function') {
                                throw new Error('缺少结构化翻译模块。');
                            }

                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 准备重试 ${failedIndices.length} 个失败片段...`);
                            }

                            // 组装待翻译子集
                            const translator = new window.MinerUStructuredTranslation();
                            const fullTranslatable = translator.extractTranslatableContent(meta.contentListJson);
                            const subset = [];
                            const indexMap = [];

                            failedIndices.forEach(idx => {
                                if (idx >= 0 && idx < fullTranslatable.length) {
                                    subset.push(fullTranslatable[idx]);
                                    indexMap.push(idx);
                                }
                            });

                            if (subset.length === 0) {
                                throw new Error('没有有效的失败片段可重试。');
                            }

                            // 分批并翻译
                            const batches = translator.splitIntoBatches(subset);
                            const targetLang = targetLanguageValue;
                            const modelName = selectedTranslationModelName;
                            const apiKeyVal = translationKeyObject ? translationKeyObject.value : null;

                            if (!apiKeyVal) {
                                throw new Error('缺少翻译 API Key，无法执行失败片段重试。');
                            }

                            let translationOptions = {};
                            if (modelName === 'custom') {
                                translationOptions.modelConfig = translationModelConfig;
                            }

                            const translatedSubset = await translator.translateBatches(
                                batches,
                                targetLang,
                                modelName,
                                apiKeyVal,
                                translationOptions,
                                (progress) => {
                                    if (typeof addProgressLog === 'function') {
                                        addProgressLog(`${logPrefix} 翻译进度: ${progress.percentage}% (${progress.message})`);
                                    }
                                },
                                acquireSlot,
                                releaseSlot
                            );

                            // 写回对应索引
                            const tlist = meta.translatedContentList.slice();
                            translatedSubset.forEach((item, i) => {
                                const origIdx = indexMap[i];
                                tlist[origIdx] = item;
                            });

                            // 重新计算失败项
                            const newFailed = [];
                            const _norm = (v) => {
                                if (v == null) return '';
                                try {
                                    if (Array.isArray(v)) return v.join(' ').trim();
                                    if (typeof v === 'string') return v.trim();
                                    return String(v).trim();
                                } catch(_) { return ''; }
                            };

                            for (let i = 0; i < tlist.length; i++) {
                                const o = meta.contentListJson[i] || {};
                                const t = tlist[i] || {};
                                let failed = !!t.failed;
                                if (!failed) {
                                    if (o.type === 'text') {
                                        const a = _norm(o.text);
                                        const b = _norm(t.text);
                                        failed = a && (!b || a === b);
                                    } else if (o.type === 'image') {
                                        const a = _norm(o.image_caption);
                                        const b = _norm(t.image_caption);
                                        failed = a && (!b || a === b);
                                    } else if (o.type === 'table') {
                                        const a = _norm(o.table_caption);
                                        const b = _norm(t.table_caption);
                                        failed = a && (!b || a === b);
                                    }
                                }
                                if (failed) {
                                    const baseText = (o.type === 'text') ? (o.text || '')
                                                    : (o.type === 'image') ? (Array.isArray(o.image_caption) ? o.image_caption.join(' ') : o.image_caption)
                                                    : (o.type === 'table') ? (o.table_caption || '')
                                                    : '';
                                    const norm = _norm(baseText);
                                    if (norm) newFailed.push({ index: i, type: o.type, page_idx: o.page_idx || 0, text: norm });
                                }
                            }

                            // 更新并保存记录
                            refRecord.metadata.translatedContentList = tlist;
                            refRecord.metadata.failedStructuredItems = newFailed;
                            refRecord.metadata.structuredFailedCount = newFailed.length;
                            refRecord.time = new Date().toISOString();
                            await saveResultToDB(refRecord);

                            if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 已将 ${translatedSubset.length} 个片段写回历史记录 ${refId}，剩余失败 ${newFailed.length} 个`);
                            }

                            // 准备返回对象并跳过后续的常规保存逻辑
                            return {
                                file: fileToProcess,
                                markdown: refRecord.ocr || '',
                                translation: '',
                                images: refRecord.images || [],
                                ocrChunks: refRecord.ocrChunks || [],
                                translatedChunks: refRecord.translatedChunks || [],
                                metadata: refRecord.metadata,
                                error: null,
                                isRetryStructuredFailed: true,
                                refId: refId
                            };
                        }

                        // ============ 特殊模式：标准分块失败片段重试，直接写回原历史 ============
                        if (isRetryFailed) {
                            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 检测到失败片段重试模式，准备逐段翻译并写回历史记录 ${refId}`);

                            // 按 PBX-CHUNK-INDEX 解析出各段内容
                            const re = /<!--\s*PBX-CHUNK-INDEX:(\d+)\s*-->\s*([\s\S]*?)(?=(?:<!--\s*PBX-CHUNK-INDEX:\d+\s*-->)|$)/g;
                            const retryList = [];
                            let m;
                            while ((m = re.exec(currentMarkdownContent)) !== null) {
                                const idx = parseInt(m[1], 10);
                                const text = (m[2] || '').trim();
                                if (!isNaN(idx) && text) retryList.push({ index: idx, text });
                            }

                            if (retryList.length === 0) {
                                throw new Error('未找到可重试的失败片段。');
                            }

                            // 获取翻译模型与参数
                            const targetLanguageValue = targetLanguage; // 来自参数
                            const modelName = selectedTranslationModelName;
                            const apiKeyVal = translationKeyObject ? translationKeyObject.value : null;
                            if (!apiKeyVal) throw new Error('缺少翻译API Key，无法执行失败片段重试。');

                            // 依次翻译每段（受并发槽控制）
                            const translatedPieces = [];
                            for (let i = 0; i < retryList.length; i++) {
                                const item = retryList[i];
                                if (typeof acquireSlot === 'function') await acquireSlot();
                                try {
                                    let out;
                                    if (modelName === 'custom') {
                                        out = await translateMarkdown(
                                            item.text,
                                            targetLanguageValue,
                                            'custom',
                                            apiKeyVal,
                                            translationModelConfig,
                                            `${logPrefix}[retry ${i+1}/${retryList.length}]`,
                                            defaultSystemPromptSetting,
                                            defaultUserPromptTemplateSetting,
                                            useCustomPromptsSetting
                                        );
                                    } else {
                                        out = await translateMarkdown(
                                            item.text,
                                            targetLanguageValue,
                                            modelName,
                                            apiKeyVal,
                                            `${logPrefix}[retry ${i+1}/${retryList.length}]`,
                                            defaultSystemPromptSetting,
                                            defaultUserPromptTemplateSetting,
                                            useCustomPromptsSetting
                                        );
                                    }
                                    translatedPieces.push({ index: item.index, text: out });
                                } finally {
                                    if (typeof releaseSlot === 'function') releaseSlot();
                                }
                            }

                            // 写回原历史记录：替换对应分块译文
                            if (!refRecord) throw new Error('未找到原历史记录，无法写回。');
                            if (!Array.isArray(refRecord.ocrChunks) || !Array.isArray(refRecord.translatedChunks)) {
                                throw new Error('原历史记录缺少分块信息，无法写回。');
                            }
                            translatedPieces.forEach(p => {
                                const safeIdx = Math.max(0, Math.min(p.index, refRecord.ocrChunks.length - 1));
                                refRecord.translatedChunks[safeIdx] = p.text;
                            });
                            refRecord.translation = (refRecord.translatedChunks || []).join('\n\n');
                            refRecord.time = new Date().toISOString();
                            await saveResultToDB(refRecord);
                            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 已将 ${translatedPieces.length} 个失败片段写回历史记录 ${refId}`);

                            // 准备返回对象并跳过后续的常规保存逻辑
                            return {
                                file: fileToProcess,
                                markdown: currentMarkdownContent,
                                translation: translatedPieces.map(p => p.text).join('\n\n'),
                                images: currentImagesData,
                                ocrChunks: retryList.map(r => r.text),
                                translatedChunks: translatedPieces.map(p => p.text),
                                error: null
                            };
                        }
                    } else {
                        currentImagesData = [];
                    }
                } catch (e) {
                    console.warn(`${logPrefix} 读取历史图片引用失败:`, e);
                    currentImagesData = [];
                }
            } catch (readError) {
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 读取 ${fileType.toUpperCase()} 文件失败: ${readError.message}`);
                throw new Error(`读取 ${fileType.toUpperCase()} 文件失败: ${readError.message}`);
            }
        } else if (fileType === 'docx') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 解析 DOCX 文档...`);
            if (typeof mammoth === 'undefined' || !mammoth || typeof mammoth.convertToHtml !== 'function') {
                throw new Error('缺少 mammoth 库，无法解析 DOCX');
            }
            try {
                const arrayBuffer = await fileToProcess.arrayBuffer();
                originalBinary = arrayBuffer;
                originalEncoding = 'arraybuffer';

                // 用于存储提取的图片数据
                const docxImages = [];
                let imageCounter = 0;

                // 配置 mammoth，提取图片数据并使用简洁的引用
                // 这样可以避免巨大的 base64 字符串导致 token 估算错误（每张图片可能几十万字符）
                const result = await mammoth.convertToHtml({
                    arrayBuffer,
                    convertImage: mammoth.images.imgElement(function(image) {
                        return image.read("base64").then(function(imageBuffer) {
                            // 生成图片 ID
                            imageCounter++;
                            const imgId = `docx_img_${imageCounter}`;
                            const imgPath = `images/${imgId}.png`;

                            // 存储图片数据（格式与 OCR 保持一致）
                            docxImages.push({
                                id: imgId,
                                data: imageBuffer  // base64 字符串
                            });

                            // 在 HTML 中使用简洁的路径引用，而不是完整的 base64
                            return {
                                src: imgPath
                            };
                        });
                    })
                });

                const html = result && result.value ? result.value : '';
                currentMarkdownContent = convertHtmlToMarkdown(html);

                // 将提取的图片数据保存到 currentImagesData
                currentImagesData = docxImages;

                // 提取并清理可能残留的 base64 图片数据（防止导出再导入的文档中有残留）
                // 这些 base64 字符串可能有几十万字符，会严重影响 token 估算
                const beforeClean = currentMarkdownContent.length;
                let extractedImageCount = 0;

                // 提取 Markdown 格式的 base64 图片：![...](data:image/...;base64,...)
                currentMarkdownContent = currentMarkdownContent.replace(/!\[([^\]]*)\]\(data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)\)/g,
                    (match, altText, mimeType, base64Data) => {
                        extractedImageCount++;
                        const imgId = `docx_extracted_${extractedImageCount}`;
                        const imgPath = `images/${imgId}.png`;

                        // 保存提取的图片数据
                        currentImagesData.push({
                            id: imgId,
                            data: base64Data
                        });

                        // 替换为简洁的引用
                        return `![${altText || '图片'}](${imgPath})`;
                    });

                // 提取纯 base64 字符串（可能是文本中的残留）
                // 匹配至少 100 个字符的 base64 字符串
                currentMarkdownContent = currentMarkdownContent.replace(/data:image\/([^;]+);base64,([A-Za-z0-9+/=]{100,})/g,
                    (match, mimeType, base64Data) => {
                        extractedImageCount++;
                        const imgId = `docx_extracted_${extractedImageCount}`;

                        // 保存提取的图片数据
                        currentImagesData.push({
                            id: imgId,
                            data: base64Data
                        });

                        return `[图片${extractedImageCount}]`;
                    });

                const afterClean = currentMarkdownContent.length;
                const removedChars = beforeClean - afterClean;

                if (removedChars > 0 && typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 从文本中提取了 ${extractedImageCount} 张图片 (清理了 ${Math.round(removedChars / 1024)} KB base64 数据)`);
                }

                if (typeof addProgressLog === "function") {
                    const charCount = currentMarkdownContent.length;
                    const estimatedTokens = typeof estimateTokenCount === 'function' ? estimateTokenCount(currentMarkdownContent) : 0;
                    const totalImages = docxImages.length + extractedImageCount;
                    addProgressLog(`${logPrefix} DOCX 文本转换完成，共提取 ${totalImages} 张图片 (标准: ${docxImages.length}, 嵌入: ${extractedImageCount}) (字符数: ${charCount}, 估算 tokens: ${estimatedTokens})`);
                }

                // 调试：如果字符数与估算 tokens 差距过大，输出前 500 字符到控制台
                if (currentMarkdownContent.length > 0 && typeof estimateTokenCount === 'function') {
                    const estimatedTokens = estimateTokenCount(currentMarkdownContent);
                    const ratio = estimatedTokens / currentMarkdownContent.length;
                    if (ratio > 10) { // 如果 token/字符 比例 > 10，说明有异常
                        console.warn(`${logPrefix} ⚠️ Token 估算异常！字符数: ${currentMarkdownContent.length}, 估算 tokens: ${estimatedTokens}, 比例: ${ratio.toFixed(2)}`);
                        console.log(`${logPrefix} Markdown 前 500 字符:`, currentMarkdownContent.substring(0, 500));
                        console.log(`${logPrefix} Markdown 后 500 字符:`, currentMarkdownContent.substring(currentMarkdownContent.length - 500));
                    }
                }
            } catch (error) {
                console.error('DOCX 解析失败:', error);
                throw new Error(`DOCX 解析失败: ${error.message || error}`);
            }
        } else if (fileType === 'html' || fileType === 'htm') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 解析 HTML 文档...`);
            try {
                originalContent = await fileToProcess.text();
                originalEncoding = 'text';
                currentMarkdownContent = convertHtmlToMarkdown(originalContent);
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} HTML 文本转换完成`);
            } catch (error) {
                console.error('HTML 解析失败:', error);
                throw new Error(`HTML 解析失败: ${error.message || error}`);
            }
        } else if (fileType === 'pptx') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 解析 PPTX 文档...`);
            if (typeof JSZip === 'undefined') {
                throw new Error('缺少 JSZip 库，无法解析 PPTX');
            }
            try {
                const arrayBuffer = await fileToProcess.arrayBuffer();
                originalBinary = arrayBuffer;
                originalEncoding = 'arraybuffer';
                const zip = await JSZip.loadAsync(arrayBuffer);
                const slidePaths = Object.keys(zip.files)
                    .filter(path => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                if (slidePaths.length === 0) {
                    throw new Error('未找到幻灯片内容');
                }
                const slides = [];
                const parser = new DOMParser();
                for (const slidePath of slidePaths) {
                    const xmlText = await zip.file(slidePath).async('string');
                    const doc = parser.parseFromString(xmlText, 'application/xml');
                    const textNodes = Array.from(doc.getElementsByTagName('a:t'));
                    const text = textNodes.map(node => node.textContent || '').join(' ').trim();
                    if (text) slides.push(text);
                }
                currentMarkdownContent = slides.length > 0 ? slides.join('\n\n---\n\n') : '[PPTX 无文本内容]';
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} PPTX 文本提取完成，共 ${slides.length} 页`);
            } catch (error) {
                console.error('PPTX 解析失败:', error);
                throw new Error(`PPTX 解析失败: ${error.message || error}`);
            }
        } else if (fileType === 'epub') {
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 解析 EPUB 文档...`);
            if (typeof JSZip === 'undefined') {
                throw new Error('缺少 JSZip 库，无法解析 EPUB');
            }
            try {
                const arrayBuffer = await fileToProcess.arrayBuffer();
                originalBinary = arrayBuffer;
                originalEncoding = 'arraybuffer';
                const zip = await JSZip.loadAsync(arrayBuffer);
                const containerFile = zip.file('META-INF/container.xml');
                if (!containerFile) throw new Error('未找到 container.xml');
                const containerXml = await containerFile.async('string');
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, 'application/xml');
                const rootfileEl = containerDoc.querySelector('rootfile');
                const opfPath = rootfileEl ? rootfileEl.getAttribute('full-path') : null;
                if (!opfPath) throw new Error('未找到 OPF 清单');
                const opfFile = zip.file(opfPath);
                if (!opfFile) throw new Error(`OPF 文件缺失: ${opfPath}`);
                const opfXml = await opfFile.async('string');
                const opfDoc = parser.parseFromString(opfXml, 'application/xml');
                const manifest = {};
                opfDoc.querySelectorAll('manifest > item').forEach(item => {
                    const id = item.getAttribute('id');
                    const href = item.getAttribute('href');
                    if (id && href) manifest[id] = href;
                });
                const spineItems = [];
                opfDoc.querySelectorAll('spine > itemref').forEach(itemref => {
                    const idref = itemref.getAttribute('idref');
                    if (idref && manifest[idref]) spineItems.push(manifest[idref]);
                });
                if (spineItems.length === 0) throw new Error('未找到章节信息');
                const baseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
                const chapters = [];
                for (const href of spineItems) {
                    const relative = href.replace(/\\/g, '/');
                    const path = baseDir ? `${baseDir}${relative}` : relative;
                    let entry = zip.file(path) || zip.file(decodeURIComponent(path));
                    if (!entry && baseDir) {
                        const alt = `${baseDir}${decodeURIComponent(relative)}`;
                        entry = zip.file(alt);
                    }
                    if (!entry) continue;
                    const html = await entry.async('string');
                    const markdown = convertHtmlToMarkdown(html).trim();
                    if (markdown) chapters.push(markdown);
                }
                if (chapters.length === 0) throw new Error('未解析到章节正文');
                currentMarkdownContent = chapters.join('\n\n---\n\n');
                if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} EPUB 文本解析完成，共 ${chapters.length} 章`);
            } catch (error) {
                console.error('EPUB 解析失败:', error);
                throw new Error(`EPUB 解析失败: ${error.message || error}`);
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

                // ===== MinerU 结构化翻译检测 =====
                let shouldUseStructuredTranslation = false;
                if (ocrResult && ocrResult.metadata) {
                    try {
                        const ocrConfig = (typeof window !== 'undefined' && window.ocrSettingsManager)
                            ? window.ocrSettingsManager.getCurrentConfig()
                            : null;

                        if (ocrConfig && ocrConfig.engine === 'mineru' && ocrConfig.translationMode === 'structured') {
                            // 检查是否支持结构化翻译
                            if (typeof MinerUStructuredTranslation !== 'undefined') {
                                const structuredTranslator = new MinerUStructuredTranslation();
                                shouldUseStructuredTranslation = structuredTranslator.supportsStructuredTranslation(ocrResult);

                                if (shouldUseStructuredTranslation) {
                                    if (typeof addProgressLog === "function") {
                                        addProgressLog(`${logPrefix} 检测到 MinerU 结构化翻译模式`);
                                    }
                                } else if (typeof addProgressLog === "function") {
                                    addProgressLog(`${logPrefix} MinerU 结构化翻译模式已启用，但 content_list.json 不可用，将使用标准翻译`);
                                }
                            } else if (typeof addProgressLog === "function") {
                                addProgressLog(`${logPrefix} 警告：MinerU 结构化翻译模块未加载，使用标准翻译`);
                            }
                        }
                    } catch (e) {
                        console.warn(`${logPrefix} 检测 MinerU 结构化翻译时出错:`, e);
                    }
                }

                // ===== 执行结构化翻译或标准翻译 =====
                if (shouldUseStructuredTranslation) {
                    // MinerU 结构化翻译路径
                    try {
                        if (typeof addProgressLog === "function") {
                            addProgressLog(`${logPrefix} 使用 MinerU 结构化翻译 (基于 content_list.json)`);
                        }

                        const structuredTranslator = new MinerUStructuredTranslation();

                        // 1. 提取可翻译内容
                        const translatableContent = structuredTranslator.extractTranslatableContent(
                            ocrResult.metadata.contentListJson
                        );

                        // 2. 分批
                        const batches = structuredTranslator.splitIntoBatches(translatableContent);

                        if (typeof addProgressLog === "function") {
                            addProgressLog(`${logPrefix} 提取 ${translatableContent.length} 个片段，分为 ${batches.length} 批`);
                        }

                        // 3. 准备翻译选项
                        const translationOptions = selectedTranslationModelName === 'custom'
                            ? { modelConfig: translationModelConfig }
                            : {};

                        console.log('[MinerU Structured] 翻译选项:', {
                            selectedTranslationModelName,
                            hasModelConfig: !!translationModelConfig,
                            translationOptions
                        });

                        // 4. 执行批量翻译
                        const translatedContentList = await structuredTranslator.translateBatches(
                            batches,
                            targetLanguageValue,
                            selectedTranslationModelName,
                            translationKeyValue,
                            {
                                ...translationOptions,
                                // 允许从设置自定义重试，若无则用默认
                                maxRetries: (typeof loadSettings === 'function' ? (loadSettings().structuredMaxRetries || undefined) : undefined),
                                retryDelay: (typeof loadSettings === 'function' ? (loadSettings().structuredRetryDelayMs || undefined) : undefined)
                            },
                            (progress) => {
                                if (typeof addProgressLog === "function") {
                                    addProgressLog(`${logPrefix} 翻译进度: ${progress.percentage}% (${progress.message})`);
                                }
                            },
                            acquireSlot,  // 传递并发槽位管理函数
                            releaseSlot   // 传递并发槽位管理函数
                        );

                        // 5. 保存结果
                        // 结构化翻译完成后：不生成常规译文，以免展示译文/分块对比标签
                        currentTranslationContent = '';

                        // 将翻译后的 JSON 保存在元数据中供未来使用
                        if (!ocrResult.metadata.translatedContentList) {
                            ocrResult.metadata.translatedContentList = translatedContentList;
                        }
                        // 标记失败项（供后续"重试失败段"使用）
                        // 修复：统一从 translatedContentList 收集失败项，避免重试成功后仍显示失败
                        try {
                            const failedItems = [];
                            (translatedContentList || []).forEach((it, idx) => {
                                if (it && it.failed === true) {
                                    failedItems.push({
                                        index: idx,
                                        type: it.type,
                                        page_idx: it.page_idx || 0,
                                        text: structuredTranslator.extractItemText ? structuredTranslator.extractItemText(it) : (it.text || '')
                                    });
                                }
                            });
                            // 去重（虽然现在不应该有重复，但保留容错）
                            const seen = new Set();
                            const uniqFailed = failedItems.filter(x => {
                                const key = `${x.index}`;
                                if (seen.has(key)) return false;
                                seen.add(key);
                                return true;
                            });
                            ocrResult.metadata.failedStructuredItems = uniqFailed;
                            ocrResult.metadata.structuredFailedCount = uniqFailed.length;

                            if (typeof addProgressLog === 'function' && uniqFailed.length > 0) {
                                addProgressLog(`${logPrefix} 有 ${uniqFailed.length} 个片段未能成功翻译`);
                            }
                        } catch (e) {
                            console.warn(`${logPrefix} 收集结构化失败项时出错(忽略):`, e);
                        }

                        // 不设置对比分块，避免显示“分块对比”标签
                        ocrChunks = [];
                        translatedChunks = [];

                        if (typeof addProgressLog === "function") {
                            addProgressLog(`${logPrefix} MinerU 结构化翻译完成`);
                        }

                    } catch (error) {
                        // 结构化翻译失败，回退到标准翻译
                        if (typeof addProgressLog === "function") {
                            addProgressLog(`${logPrefix} 结构化翻译失败，回退到标准翻译: ${error.message}`);
                        }
                        console.error(`${logPrefix} MinerU 结构化翻译错误:`, error);
                        shouldUseStructuredTranslation = false; // 触发标准翻译逻辑
                    }
                }

                // ===== 标准翻译路径（原有逻辑） =====
                if (!shouldUseStructuredTranslation) {
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
                            if (selectedTranslationModelName === 'custom') {
                                currentTranslationContent = await translateMarkdown(
                                    currentMarkdownContent,
                                    targetLanguageValue,
                                    selectedTranslationModelName,
                                    translationKeyValue,
                                    translationModelConfig,
                                    logPrefix,
                                    defaultSystemPromptSetting,
                                    defaultUserPromptTemplateSetting,
                                    useCustomPromptsSetting
                                );
                            } else {
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
                            }
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
                } // 结束 if (!shouldUseStructuredTranslation)
            } // 结束 else (translationKeyValue 有效)
        } else { // 结束 if (selectedTranslationModelName !== 'none')
            if (typeof addProgressLog === "function") addProgressLog(`${logPrefix} 不需要翻译`);
            // 即使不翻译，也需要检查是否需要分块（用于向量搜索等后续功能）
            const estimatedTokens = typeof estimateTokenCount === 'function'
                ? estimateTokenCount(currentMarkdownContent)
                : currentMarkdownContent.length / 4; // 简单估算
            const tokenLimit = parseInt(maxTokensPerChunkValue, 10) || 2000; // 与翻译流程保持一致

            if (estimatedTokens > tokenLimit * 1.1 && typeof splitMarkdownIntoChunks === 'function') {
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logPrefix} 文档较大 (~${Math.round(estimatedTokens/1000)}K tokens), 进行分块处理以支持向量搜索`);
                }
                ocrChunks = splitMarkdownIntoChunks(currentMarkdownContent, tokenLimit, logPrefix);
                translatedChunks = ocrChunks.map(() => ''); // 翻译块为空
            } else {
                ocrChunks = [currentMarkdownContent];
                translatedChunks = [''];
            }
        }

        const processedAt = new Date().toISOString();
        if (typeof saveResultToDB === "function") {
            // 准备元数据
            const metadataToSave = {};

            // 如果是 MinerU 结构化翻译，保存额外的元数据
            if (ocrResult && ocrResult.metadata) {
                // 保存 layoutJson 和 contentListJson
                if (ocrResult.metadata.layoutJson) {
                    metadataToSave.layoutJson = ocrResult.metadata.layoutJson;
                }
                if (ocrResult.metadata.contentListJson) {
                    metadataToSave.contentListJson = ocrResult.metadata.contentListJson;
                }
                // 保存翻译后的结构化内容
                if (ocrResult.metadata.translatedContentList) {
                    metadataToSave.translatedContentList = ocrResult.metadata.translatedContentList;
                }
                // 保存原始 PDF（转为 base64）
                if (ocrResult.metadata.originalPdf) {
                    try {
                        const pdfBlob = ocrResult.metadata.originalPdf;
                        const pdfArrayBuffer = await pdfBlob.arrayBuffer();
                        metadataToSave.originalPdfBase64 = arrayBufferToBase64(pdfArrayBuffer);
                        if (typeof addProgressLog === "function") {
                            addProgressLog(`${logPrefix} 已保存原始 PDF (${Math.round(pdfBlob.size / 1024)} KB)`);
                        }
                    } catch (e) {
                        console.warn(`${logPrefix} 保存原始 PDF 失败:`, e);
                    }
                }
                // 标记支持结构化翻译
                metadataToSave.supportsStructuredTranslation = ocrResult.metadata.supportsStructuredTranslation;
                // 持久化结构化失败项统计（如存在）
                if (Array.isArray(ocrResult.metadata.failedStructuredItems)) {
                    metadataToSave.failedStructuredItems = ocrResult.metadata.failedStructuredItems;
                }
                if (typeof ocrResult.metadata.structuredFailedCount === 'number') {
                    metadataToSave.structuredFailedCount = ocrResult.metadata.structuredFailedCount;
                }
            }

            await saveResultToDB({
                id: `${fileToProcess.name}_${fileToProcess.size}`,
                name: fileToProcess.name,
                size: fileToProcess.size,
                time: processedAt,
                ocr: currentMarkdownContent,
                translation: currentTranslationContent,
                images: currentImagesData,
                ocrChunks: ocrChunks,
                translatedChunks: translatedChunks,
                fileType: fileType,
                targetLanguage: targetLanguageValue,
                relativePath: relativePath,
                sourceArchive: sourceArchive,
                originalContent: originalEncoding === 'text' ? originalContent : null,
                originalEncoding: originalEncoding,
                originalBinary: originalEncoding && originalEncoding !== 'text' && originalBinary ? arrayBufferToBase64(originalBinary) : null,
                originalExtension: originalExtension,
                // 新增：模型元信息（OCR/翻译）
                ocrEngine: usedOcrEngine || ocrEngineForLog || (typeof window !== 'undefined' ? (window.ocrSettingsManager?.getCurrentConfig()?.engine || null) : null),
                ocrSource: usedOcrSource || null,
                translationModelName: selectedTranslationModelName || 'none',
                translationModelCustomName: (selectedTranslationModelName === 'custom' && translationModelConfig && (translationModelConfig.displayName || translationModelConfig.name)) ? (translationModelConfig.displayName || translationModelConfig.name) : null,
                translationModelId: (selectedTranslationModelName === 'custom' && translationModelConfig && translationModelConfig.modelId) ? translationModelConfig.modelId : null,
                batchId: batchContext ? batchContext.id : null,
                batchOrder: batchContext ? batchContext.order : null,
                batchTotal: batchContext ? batchContext.total : null,
                batchTemplate: batchContext ? batchContext.template : null,
                batchFormats: batchContext ? batchContext.formats : null,
                batchStartedAt: batchContext ? batchContext.startedAt : null,
                batchOutputLanguage: batchContext ? batchContext.outputLanguage : null,
                batchOriginalIndex: batchContext ? batchContext.originalIndex : null,
                batchAttempt: batchContext ? batchContext.attempt : null,
                batchZip: batchContext ? batchContext.zipOutput : null,
                // 新增：MinerU 结构化翻译元数据
                metadata: Object.keys(metadataToSave).length > 0 ? metadataToSave : null
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
            error: null, // 表示此文件处理成功（即使翻译部分可能仅标记了错误）
            processedAt,
            fileType,
            targetLanguage: targetLanguageValue,
            relativePath,
            sourceArchive,
            originalContent: originalEncoding === 'text' ? originalContent : null,
            originalEncoding,
            originalBinary: originalEncoding && originalEncoding !== 'text' && originalBinary ? arrayBufferToBase64(originalBinary) : null,
            originalExtension,
            // 回传一份模型元数据，便于上层使用
            ocrEngine: usedOcrEngine || ocrEngineForLog || (typeof window !== 'undefined' ? (window.ocrSettingsManager?.getCurrentConfig()?.engine || null) : null),
            ocrSource: usedOcrSource || null,
            translationModelName: selectedTranslationModelName || 'none',
            translationModelCustomName: (selectedTranslationModelName === 'custom' && translationModelConfig && (translationModelConfig.displayName || translationModelConfig.name)) ? (translationModelConfig.displayName || translationModelConfig.name) : null,
            translationModelId: (selectedTranslationModelName === 'custom' && translationModelConfig && translationModelConfig.modelId) ? translationModelConfig.modelId : null,
            batchId: batchContext ? batchContext.id : null,
            batchOrder: batchContext ? batchContext.order : null,
            batchTotal: batchContext ? batchContext.total : null,
            batchTemplate: batchContext ? batchContext.template : null,
            batchFormats: batchContext ? batchContext.formats : null,
            batchStartedAt: batchContext ? batchContext.startedAt : null,
            batchOutputLanguage: batchContext ? batchContext.outputLanguage : null,
            batchOriginalIndex: batchContext ? batchContext.originalIndex : null,
            batchAttempt: batchContext ? batchContext.attempt : null,
            batchZip: batchContext ? batchContext.zipOutput : null
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

console.log('main.js: Checking before assignment...');
console.log('main.js: typeof processModule:', typeof processModule);
if (typeof processModule !== 'undefined') {
    console.log('main.js: processModule object keys:', Object.keys(processModule));
}
console.log('main.js: typeof processSinglePdf (the function):', typeof processSinglePdf);
console.log('main.js: Is processSinglePdf a function?', processSinglePdf instanceof Function);


// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    console.log('main.js: Attempting to assign processSinglePdf to processModule...');
    processModule.processSinglePdf = processSinglePdf;
    console.log('main.js: Assignment done. typeof processModule.processSinglePdf:', typeof processModule.processSinglePdf);
    if (processModule.processSinglePdf === null) {
        console.warn('main.js: processModule.processSinglePdf is NULL immediately after assignment!');
    }
} else {
    console.warn('main.js: processModule is undefined at the point of assignment.');
}
