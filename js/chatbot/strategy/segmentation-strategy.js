// js/chatbot/segmentation-strategy.js
// 该文件实现了基于目录 (ToC) 的文档分段、处理和检索策略，
// 以增强聊天机器人的问答能力。

/**
 * 从文档中解析目录。
 *
 * @param {string | Object} tocInput - 原始目录信息，可以是纯文本或结构化对象。
 * @returns {Object} 结构化的目录对象 (例如树形结构)。
 *                   示例: { title: "第一章", level: 1, children: [], startLine: 10, endLine: 50 }
 */
function parseTableOfContents(tocInput) {
    // TODO: 实现目录解析逻辑。
    // 可能涉及对纯文本的正则表达式处理，或对结构化输入的直接处理。
    console.log('[segmentation-strategy] 正在解析目录来源:', tocInput);
    // 占位符实现
    return {
        title: "文档根节点",
        level: 0,
        children: [],
        // 子节点示例:
        // { title: "第一节", level: 1, children: [
        //     { title: "1.1 小节", level: 2, children: [], rawTextStartMarker: "1.1 小节文本起始处" }
        //   ],
        //   rawTextStartMarker: "第一节文本起始处" // 指示该节文本开始位置的唯一字符串或行号
        // }
    };
}

/**
 * 根据结构化的目录对文档文本进行分段。
 *
 * @param {string} fullDocumentText - 文档的完整文本内容 (例如 Markdown)。
 * @param {Object} structuredToC -由 parseTableOfContents 返回的目录对象。
 * @returns {Array<Object>} 一个包含目录章节的数组，每个章节包含其文本和进一步分段的自然段落。
 *                          示例: [
 *                              {
 *                                  tocTitle: "1.1 小节",
 *                                  tocLevel: 2,
 *                                  rawSectionText: "1.1 小节的文本内容...",
 *                                  naturalSegments: [
 *                                      "这是1.1小节的第一个自然段落。",
 *                                      "这是第二个自然段落。"
 *                                  ]
 *                              },
 *                              // ... 更多章节
 *                          ]
 */
function segmentDocumentByToC(fullDocumentText, structuredToC) {
    // New: 基于 Markdown 标题解析分段
    const headingRegex = /^#{1,6}\s+(.+)$/gm;
    const matches = [];
    let m;
    while ((m = headingRegex.exec(fullDocumentText)) !== null) {
        matches.push({
            title: m[1].trim(),
            level: m[0].split(' ')[0].length, // '#' 数量
            index: m.index
        });
    }
    // 若无任何标题，退回全文一段
    if (matches.length === 0) {
        const all = fullDocumentText;
        return [{ tocTitle: "全文", tocLevel: 1, rawSectionText: all,
            naturalSegments: splitIntoNaturalParagraphs(all) }];
    }
    const sections = [];
    // 按顺序提取每个章节文本
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const start = current.index + fullDocumentText.slice(current.index).split("\n")[0].length + 1;
        const end = (i + 1 < matches.length) ? matches[i+1].index : fullDocumentText.length;
        const raw = fullDocumentText.slice(start, end).trim();
        // 超长时按自然段落拆分并合并至阈值
        const paras = splitIntoNaturalParagraphs(raw);
        const threshold = 10000;
        const segments = [];
        let buf = "";
        for (const p of paras) {
            if (buf.length + p.length <= threshold) {
                buf = buf ? buf + '\n\n' + p : p;
            } else {
                if (buf) segments.push(buf);
                buf = p;
            }
        }
        if (buf) segments.push(buf);
        sections.push({ tocTitle: current.title, tocLevel: current.level,
            rawSectionText: raw, naturalSegments: segments });
    }
    return sections;
}

/**
 * 辅助函数，将文本分割成"自然"段落。
 * 这是一个占位符，可能需要更复杂的逻辑
 * (例如，基于双换行符，或更复杂的NLP方法)。
 * @param {string} text - 要分割的文本。
 * @returns {Array<string>} 段落字符串数组。
 */
function splitIntoNaturalParagraphs(text) {
    if (!text) return [];
    // 按一个或多个换行符分割，然后去除首尾空格并过滤空字符串。
    // 对于Markdown段落，更稳健的方法是按两个或多个换行符分割。
    return text.split(/\n\s*\n+/).map(p => p.trim()).filter(p => p.length > 0);
}


/**
 * 处理单个文本片段，提取摘要、细节等，
 * 通过调用已有的"理解"算法 (例如，您的翻译算法)。
 *
 * @param {string} segmentText - 一个小的文本片段 (例如，一个自然段落)。
 * @returns {Promise<Object>} 一个Promise，解析为一个包含以下内容的对象：
 *                            { summary: string, details: Array<string>, length: number }。
 */
async function processSegment(segmentText) {
    try {
        // 使用 ChatbotCore.singleChunkSummary 生成摘要
        const config = window.ChatbotCore.getChatbotConfig();
        const apiKey = config.apiKey;
        // 构建系统提示：精简摘要和要点，不超过200字
        const sysPrompt = `请提炼以下文本的大意和要点，尽量精简，不超过200字：\n${segmentText}`;
        const summary = await window.ChatbotCore.singleChunkSummary(sysPrompt, segmentText, config, apiKey);
        return { summary: summary, details: [], length: segmentText.length };
    } catch (error) {
        console.error('[segmentation-strategy] 调用 singleChunkSummary 失败:', error);
        return { summary: '片段处理失败。', details: [error.message], length: segmentText.length };
    }
}

// 新增：带重试机制的分段处理，指数退避
async function processSegmentWithRetry(segmentText, retries = 3, initialDelay = 500) {
    let attempt = 0;
    let delay = initialDelay;
    while (true) {
        try {
            return await processSegment(segmentText);
        } catch (error) {
            attempt++;
            console.warn(`[segmentation-strategy] 处理片段失败，重试第 ${attempt}/${retries}`, error);
            if (attempt >= retries) {
                return { summary: "片段处理失败。", details: [error.message], length: segmentText.length, error: true };
            }
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }
}

/**
 * 从分段的文档和处理过的片段数据构建最终的预处理JSON结构。
 *
 * @param {Array<Object>} tocSections - segmentDocumentByToC的输出。
 *                                      每个对象包含 tocTitle, tocLevel, rawSectionText, naturalSegments。
 * @param {Array<Array<Object>>} allProcessedSegmentsData - 一个数组，其中每个内部数组对应一个ToC章节的处理过的自然段落。
 *                                                       每个内部项是 processSegment的输出。
 *                                                       示例: [
 *                                                                  [ {summary, details, length}, {summary, details, length}, ... 章节1的片段],
 *                                                                  [ {summary, details, length}, ... 章节2的片段]
 *                                                               ]
 * @returns {Array<Object>} 最终的JSON结构。
 *                          示例: [
 *                                       {
 *                                           tocTitle: "1.1 小节",
 *                                           tocLevel: 2,
 *                                           segments: [ // 为清晰起见，从processedSegments重命名
 *                                               { originalText: "...", summary: "...", details: [], length: N },
 *                                               ...
 *                                           ],
 *                                           totalSectionLength: M
 *                                       },
 *                                       ...
 *                                   ]
 */
function buildPreprocessedJson(tocSections, allProcessedSegmentsData) {
    // TODO: 将ToC结构与每个片段的处理数据结合起来。
    console.log('[segmentation-strategy] 正在构建预处理JSON。');
    const finalJson = [];
    tocSections.forEach((section, sectionIndex) => {
        const processedNaturalSegments = allProcessedSegmentsData[sectionIndex] || [];
        let totalSectionLength = 0;
        const resultSegments = section.naturalSegments.map((originalText, segmentIdx) => {
            const processedData = processedNaturalSegments[segmentIdx] || { summary: "片段处理失败。", details: [], length: originalText.length };
            totalSectionLength += processedData.length;
            return {
                originalText: originalText,
                summary: processedData.summary,
                details: processedData.details,
                length: processedData.length
            };
        });

        finalJson.push({
            tocTitle: section.tocTitle,
            tocLevel: section.tocLevel,
            segments: resultSegments, // 从processedSegments更改
            totalSectionLength: totalSectionLength
        });
    });
    return finalJson;
}

/**
 * 根据用户查询从预处理的JSON中检索相关内容块。
 * 这是调用LLM进行相关性排序的地方。
 *
 * @param {string} userQuery - 用户的提问。
 * @param {Array<Object>} preprocessedJson - buildPreprocessedJson构建的JSON数据。
 * @param {number} [charLimit=50000] - 返回内容的最大总字符限制。
 * @param {number} [topN=10] - 返回的最大片段数量。
 * @returns {Promise<Array<string>>} 一个Promise，解析为相关originalText字符串的数组，
 *                                   按相关性排序，并遵守字符限制。
 */
async function retrieveRelevantContent(userQuery, preprocessedJson, charLimit = 50000, topN = 10) {
    // TODO:
    // 1. 为LLM构建一个prompt，包括userQuery和preprocessedJson的表示
    //    （如果上下文窗口太大，则为其摘要/子集）。
    // 2. 调用LLM获取片段ID/索引的排序列表。
    // 3. 根据排序列表和charLimit，提取并连接最相关片段的originalText。
    console.log('[segmentation-strategy] 正在为查询检索相关内容:', userQuery);

    // 占位符实现：通过简单的关键字匹配返回前N个片段（非常基础）
    const relevantSegmentTexts = [];
    let currentLength = 0;
    const queryWords = userQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2); // 过滤短词

    const scoredSegments = [];

    preprocessedJson.forEach((tocEntry, tocIndex) => {
        tocEntry.segments.forEach((segment, segmentIndex) => {
            let score = 0;
            const combinedText = (segment.originalText + " " + segment.summary).toLowerCase();
            queryWords.forEach(word => {
                if (combinedText.includes(word)) {
                    score++;
                }
            });
            // 如果关键字在摘要中，增加分数
            queryWords.forEach(word => {
                if (segment.summary.toLowerCase().includes(word)) {
                    score += 2;
                }
            });
            // 如果关键字在ToC标题中，增加分数（权重较低）
            if (tocEntry.tocTitle.toLowerCase().split(/\s+/).some(titleWord => queryWords.includes(titleWord))) {
                score += 0.5;
            }

            if (score > 0) {
                // 如果LLM返回它们，则包括更精确检索的标识符
                scoredSegments.push({
                    text: segment.originalText,
                    score: score,
                    length: segment.length,
                    tocIndex: tocIndex,
                    segmentIndex: segmentIndex
                });
            }
        });
    });

    // 按分数降序排序
    scoredSegments.sort((a, b) => b.score - a.score);

    for (const seg of scoredSegments) {
        if (relevantSegmentTexts.length < topN && currentLength + seg.length <= charLimit) {
            relevantSegmentTexts.push(seg.text);
            currentLength += seg.length;
        }
        if (relevantSegmentTexts.length >= topN && currentLength >= charLimit) break;
    }

    // 如果未找到任何内容但JSON中有内容，则回退
    if (relevantSegmentTexts.length === 0 && preprocessedJson.length > 0 && preprocessedJson[0].segments.length > 0) {
        const firstSegment = preprocessedJson[0].segments[0];
        if (firstSegment.originalText.length <= charLimit) {
             relevantSegmentTexts.push(firstSegment.originalText);
        }
    }

    return relevantSegmentTexts;
}

// 新增：通用并发池，限制同时运行的异步任务数量
async function processWithConcurrencyLimit(items, handler, limit) {
    const results = [];
    const executing = [];
    for (const item of items) {
        const p = handler(item).then(res => {
            // 任务完成后从执行列表中移除
            executing.splice(executing.indexOf(p), 1);
            return res;
        });
        results.push(p);
        executing.push(p);
        if (executing.length >= limit) {
            // 等待最先完成的任务腾出名额
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

/**
 * 基于ToC的分段和处理策略的主协调函数。
 * 此函数将在文档的初始OCR/文本提取之后调用。
 *
 * @param {string} documentText - 文档的全文。
 * @param {string | Object} [tocInput] - 可选的ToC数据。如果未提供，可能会尝试推断或使用默认值。
 * @returns {Promise<Array<Object>>} 一个Promise，解析为预处理的JSON数据。
 */
async function runSegmentationAndProcessing(documentText, tocInput) {
    console.log("[segmentation-strategy] 开始基于ToC的分段和处理。");

    // 1. 解析ToC
    const effectiveTocInput = tocInput || documentText.substring(0, Math.min(documentText.length, 4000));
    const structuredToC = parseTableOfContents(effectiveTocInput);

    // 2. 按ToC分段
    const tocSections = segmentDocumentByToC(documentText, structuredToC);

    // 3. 并发处理每个自然段落，使用并发池
    const allProcessedNaturalSegmentsData = [];
    for (const section of tocSections) {
        let results = [];
        if (section.naturalSegments && section.naturalSegments.length > 0) {
            // 从全局选项获取并发上限，默认20
            const limit = (window.chatbotActiveOptions && Number.isInteger(window.chatbotActiveOptions.segmentConcurrency))
                ? window.chatbotActiveOptions.segmentConcurrency : 20;
            results = await processWithConcurrencyLimit(
                section.naturalSegments,
                segText => processSegmentWithRetry(segText),
                limit
            );
        }
        allProcessedNaturalSegmentsData.push(results);
    }

    // 4. 构建JSON
    const preprocessedJson = buildPreprocessedJson(tocSections, allProcessedNaturalSegmentsData);

    console.log("[segmentation-strategy] 预处理完成。生成的JSON（第一个条目的示例）:",
        preprocessedJson.length > 0 ? JSON.stringify(preprocessedJson[0], null, 2).substring(0, 500) + "..." : "未生成条目。"
    );

    return preprocessedJson;
}

// 暴露函数以供应用程序的其他部分使用，例如chatbot-core.js或app.js
// 这使得可以通过SegmentationStrategy.functionName()访问它们
if (typeof window.SegmentationStrategy === 'undefined') {
    window.SegmentationStrategy = {};
}
window.SegmentationStrategy.parseTableOfContents = parseTableOfContents;
window.SegmentationStrategy.segmentDocumentByToC = segmentDocumentByToC;
window.SegmentationStrategy.processSegment = processSegment;
window.SegmentationStrategy.processSegmentWithRetry = processSegmentWithRetry;
window.SegmentationStrategy.buildPreprocessedJson = buildPreprocessedJson;
window.SegmentationStrategy.retrieveRelevantContent = retrieveRelevantContent;
window.SegmentationStrategy.runSegmentationAndProcessing = runSegmentationAndProcessing;
window.SegmentationStrategy.splitIntoNaturalParagraphs = splitIntoNaturalParagraphs; // 同时暴露辅助函数


console.log('[segmentation-strategy.js] 已加载并附加到window.SegmentationStrategy。');