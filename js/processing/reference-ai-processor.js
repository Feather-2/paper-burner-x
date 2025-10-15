// js/processing/reference-ai-processor.js
// 参考文献AI批量处理器 - 使用AI提取文献元数据

(function(global) {
    'use strict';

    /**
     * 批量大小（每批处理的文献数量）
     */
    const BATCH_SIZE = 10;

    /**
     * 生成AI提示词 - 用于提取文献信息（简化版，让AI自己决定字段）
     */
    function generateExtractionPrompt(references, sourceLang = 'auto') {
        const langHint = sourceLang !== 'auto' ? `注意：文献可能是${sourceLang}语言。` : '';

        // 构建 JSON 输入格式，让 AI 更容易对应每条文献
        const inputJson = references.map((ref, idx) => ({
            id: idx,
            raw: ref
        }));

        return {
            system: `你是专业的文献信息提取助手。从参考文献中提取结构化信息，返回JSON格式。

输入格式：
[
  {"id": 0, "raw": "文献原始文本"},
  {"id": 1, "raw": "文献原始文本"}
]

返回格式：
{
  "references": [
    {
      "id": 0,
      "authors": ["作者列表"],
      "title": "标题",
      "year": 2023,
      "journal": "期刊",
      "doi": "DOI",
      "url": "链接"
    }
  ]
}

提取规则：
- 提取所有能识别的字段（authors, title, year, journal, volume, issue, pages, doi, url等）
- 无法提取的字段设为null
- 保持原文格式
- ${langHint}
- 只返回JSON，不要任何其他文字

⚠️ 严格要求：
- 必须返回 ${references.length} 条文献，每条文献的 id 必须与输入一一对应（0 到 ${references.length - 1}）
- 不要遗漏任何一条（检查 id 是否连续）
- 不要添加额外的文献
- 不要编造不存在的信息
- 保持 id 顺序与输入完全一致`,

            user: JSON.stringify(inputJson, null, 2)
        };
    }

    /**
     * 调用AI API提取文献信息（带指数退避重试）
     */
    async function callAIExtraction(references, apiConfig, sourceLang = 'auto') {
        const maxRetries = 3;
        const baseDelay = 1000;
        const maxDelay = 8000;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const prompt = generateExtractionPrompt(references, sourceLang);
                const requestBody = apiConfig.bodyBuilder
                    ? apiConfig.bodyBuilder(prompt.system, prompt.user)
                    : {
                        model: apiConfig.modelName,
                        messages: [
                            { role: "system", content: prompt.system },
                            { role: "user", content: prompt.user }
                        ],
                        temperature: 0.1
                    };

                if (attempt === 0) {
                    console.log('[ReferenceAIProcessor] 请求详情:', {
                        endpoint: apiConfig.endpoint,
                        model: apiConfig.modelName,
                        hasApiKey: !!apiConfig.apiKey,
                        headers: apiConfig.headers,
                        bodyPreview: {
                            model: requestBody.model,
                            messagesCount: requestBody.messages?.length,
                            temperature: requestBody.temperature
                        }
                    });
                }

                const headers = apiConfig.headers || {};

                const response = await fetch(apiConfig.endpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(requestBody)
                });

                console.log(`[ReferenceAIProcessor] 响应状态 (尝试 ${attempt + 1}/${maxRetries + 1}):`, response.status, response.statusText);

                if (!response.ok) {
                    const errorText = await response.text();
                    const isRetriable = [401, 403, 408, 429, 500, 502, 503, 504].includes(response.status);

                    console.error('[ReferenceAIProcessor] API错误响应:', {
                        status: response.status,
                        statusText: response.statusText,
                        preview: errorText.substring(0, 500),
                        retriable: isRetriable
                    });

                    if (isRetriable && attempt < maxRetries) {
                        const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                        console.log(`[ReferenceAIProcessor] 等待 ${Math.round(delay)}ms 后重试...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }

                    throw new Error(`API请求失败 (${response.status}): ${response.statusText}`);
                }

                const responseText = await response.text();
                if (attempt === 0) {
                    console.log('[ReferenceAIProcessor] 原始响应前500字符:', responseText.substring(0, 500));
                }

                // 检查是否是HTML响应
                if (responseText.trim().toLowerCase().startsWith('<!doctype') ||
                    responseText.trim().toLowerCase().startsWith('<html')) {
                    console.error('[ReferenceAIProcessor] API返回了HTML页面而不是JSON');
                    throw new Error('API返回HTML而非JSON，请检查端点配置和API Key');
                }

                const data = JSON.parse(responseText);

                // 检查是否因长度限制被截断
                const finishReason = data?.choices?.[0]?.finish_reason;
                if (finishReason === 'length' && attempt < maxRetries) {
                    console.warn(`[ReferenceAIProcessor] 响应被截断 (finish_reason: length)，尝试 ${attempt + 1}/${maxRetries + 1}，将重试...`);
                    const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                const extractedText = apiConfig.responseExtractor
                    ? apiConfig.responseExtractor(data)
                    : data?.choices?.[0]?.message?.content;

                if (!extractedText) {
                    console.error('[ReferenceAIProcessor] 响应数据:', data);

                    if (attempt < maxRetries) {
                        console.warn(`[ReferenceAIProcessor] 内容为空，尝试 ${attempt + 1}/${maxRetries + 1}，将重试...`);
                        const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }

                    throw new Error('API返回的内容为空');
                }

                // 清理可能的markdown代码块标记
                let cleanText = extractedText.trim();
                if (cleanText.startsWith('```json')) {
                    cleanText = cleanText.replace(/^```json\s*/, '').replace(/```\s*$/, '');
                } else if (cleanText.startsWith('```')) {
                    cleanText = cleanText.replace(/^```\s*/, '').replace(/```\s*$/, '');
                }

                // 解析JSON响应
                try {
                    const parsed = JSON.parse(cleanText);
                    const extractedRefs = parsed.references || [];

                    // 验证1：数量必须匹配
                    if (extractedRefs.length !== references.length) {
                        console.error(`[ReferenceAIProcessor] 数量不匹配: 输入 ${references.length} 条，AI 返回 ${extractedRefs.length} 条`);
                        console.error('[ReferenceAIProcessor] 输入文献:', references.map((r, i) => `[${i}] ${r.substring(0, 100)}...`));
                        console.error('[ReferenceAIProcessor] AI 返回:', extractedRefs.map((r, i) => `[${i}] id=${r.id} ${r.title?.substring(0, 100)}`));

                        if (attempt < maxRetries) {
                            console.warn(`[ReferenceAIProcessor] 数量不匹配（可能幻觉），尝试 ${attempt + 1}/${maxRetries + 1}，将重试...`);
                            const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }

                        throw new Error(`AI 返回数量错误：期望 ${references.length} 条，实际 ${extractedRefs.length} 条（可能产生幻觉）`);
                    }

                    // 验证2：检查 id 是否连续且完整（0 到 N-1）
                    const ids = extractedRefs.map(r => r.id).sort((a, b) => a - b);
                    const expectedIds = Array.from({ length: references.length }, (_, i) => i);
                    const missingIds = expectedIds.filter(id => !ids.includes(id));
                    const extraIds = ids.filter(id => !expectedIds.includes(id));

                    if (missingIds.length > 0 || extraIds.length > 0) {
                        console.error(`[ReferenceAIProcessor] ID 不匹配:`);
                        if (missingIds.length > 0) {
                            console.error(`  缺失 ID: ${missingIds.join(', ')}`);
                        }
                        if (extraIds.length > 0) {
                            console.error(`  额外 ID: ${extraIds.join(', ')}`);
                        }
                        console.error('[ReferenceAIProcessor] AI 返回的 ID:', ids.join(', '));
                        console.error('[ReferenceAIProcessor] 期望的 ID:', expectedIds.join(', '));

                        if (attempt < maxRetries) {
                            console.warn(`[ReferenceAIProcessor] ID 不连续（可能幻觉或遗漏），尝试 ${attempt + 1}/${maxRetries + 1}，将重试...`);
                            const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }

                        throw new Error(`AI 返回的 ID 不连续：缺失 [${missingIds.join(', ')}]，额外 [${extraIds.join(', ')}]`);
                    }

                    // 验证3：按 id 排序确保顺序正确
                    extractedRefs.sort((a, b) => a.id - b.id);

                    console.log(`[ReferenceAIProcessor] 成功提取 ${extractedRefs.length} 条文献（验证通过：数量✓ ID连续✓）`);
                    return extractedRefs;
                } catch (parseError) {
                    console.error('[ReferenceAIProcessor] JSON解析失败:', parseError);
                    console.error('[ReferenceAIProcessor] 原始内容:', cleanText.substring(0, 1000));

                    if (attempt < maxRetries) {
                        console.warn(`[ReferenceAIProcessor] JSON格式错误，尝试 ${attempt + 1}/${maxRetries + 1}，将重试...`);
                        const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }

                    throw parseError;
                }

            } catch (error) {
                // 网络错误也重试
                if (attempt < maxRetries && (error.name === 'TypeError' || error.message.includes('fetch'))) {
                    const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
                    console.error(`[ReferenceAIProcessor] 网络错误，尝试 ${attempt + 1}/${maxRetries + 1}，等待 ${Math.round(delay)}ms 后重试:`, error.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                console.error(`[ReferenceAIProcessor] AI extraction failed after ${attempt + 1} attempts:`, error);
                throw error;
            }
        }

        throw new Error(`AI提取失败：已尝试 ${maxRetries + 1} 次`);
    }

    /**
     * 批量处理文献（分批并发）
     * @param {Array} references - 文献条目数组（原始文本）
     * @param {Object} apiConfig - API配置
     * @param {string} sourceLang - 源语言
     * @param {Function} progressCallback - 进度回调
     * @returns {Promise<Array>} 处理结果
     */
    async function batchProcessReferences(references, apiConfig, sourceLang = 'auto', progressCallback = null) {
        if (!references || !Array.isArray(references) || references.length === 0) {
            return [];
        }

        // 分批
        const batches = [];
        for (let i = 0; i < references.length; i += BATCH_SIZE) {
            batches.push(references.slice(i, i + BATCH_SIZE));
        }

        console.log(`[ReferenceAIProcessor] Processing ${references.length} references in ${batches.length} batches (${BATCH_SIZE} per batch)`);

        const results = [];
        let processedCount = 0;

        // 并发处理所有批次
        const batchPromises = batches.map(async (batch, batchIndex) => {
            try {
                const batchResults = await callAIExtraction(batch, apiConfig, sourceLang);

                // 更新进度
                processedCount += batch.length;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: references.length,
                        batchIndex: batchIndex,
                        totalBatches: batches.length
                    });
                }

                return batchResults;
            } catch (error) {
                console.error(`[ReferenceAIProcessor] Batch ${batchIndex} failed:`, error);

                // 失败时返回原始数据
                return batch.map((ref, idx) => ({
                    index: batchIndex * BATCH_SIZE + idx,
                    rawText: ref,
                    extractedBy: 'fallback',
                    error: error.message
                }));
            }
        });

        // 等待所有批次完成
        const batchResults = await Promise.all(batchPromises);

        // 合并结果
        batchResults.forEach(batchResult => {
            results.push(...batchResult);
        });

        return results;
    }

    /**
     * 智能处理文献（自动选择正则或AI）
     * @param {Array} entries - 文献条目（已经过正则提取）
     * @param {Object} apiConfig - API配置
     * @param {string} sourceLang - 源语言
     * @param {Function} progressCallback - 进度回调
     * @param {Object} options - 额外选项 {enrichWithDOI: boolean}
     * @returns {Promise<Array>} 处理结果
     */
    async function smartProcessReferences(entries, apiConfig, sourceLang = 'auto', progressCallback = null, options = {}) {
        if (!entries || !Array.isArray(entries)) {
            return [];
        }

        // 分类：需要AI处理 vs 已成功提取
        const needsAI = entries.filter(e => e.needsAIProcessing);
        const alreadyExtracted = entries.filter(e => !e.needsAIProcessing);

        console.log(`[ReferenceAIProcessor] ${alreadyExtracted.length} references extracted by regex, ${needsAI.length} need AI processing`);

        if (needsAI.length === 0) {
            return entries.map(e => ({
                ...e,
                extractedBy: 'regex'
            }));
        }

        // AI处理需要处理的文献
        const aiResults = await batchProcessReferences(
            needsAI.map(e => e.rawText),
            apiConfig,
            sourceLang,
            progressCallback
        );

        // 合并结果
        let finalResults = [...alreadyExtracted];

        aiResults.forEach((aiResult, idx) => {
            const original = needsAI[idx];
            finalResults.push({
                ...original,
                ...aiResult,
                extractedBy: 'ai',
                confidence: aiResult.error ? 0 : 0.8 // AI提取的置信度
            });
        });

        // 按原始索引排序
        finalResults.sort((a, b) => (a.index || 0) - (b.index || 0));

        // 可选：使用DOI解析器补充DOI信息
        if (options.enrichWithDOI && typeof window.DOIResolver !== 'undefined') {
            console.log('[ReferenceAIProcessor] Enriching with DOI information...');
            finalResults = await enrichWithDOI(finalResults, progressCallback);
        }

        return finalResults;
    }

    /**
     * 使用DOI解析器补充文献的DOI信息
     * @param {Array} references - 文献列表
     * @param {Function} progressCallback - 进度回调
     * @returns {Promise<Array>} 补充后的文献列表
     */
    async function enrichWithDOI(references, progressCallback = null) {
        if (!window.DOIResolver) {
            console.warn('[ReferenceAIProcessor] DOIResolver not available, skipping DOI enrichment');
            return references;
        }

        // 筛选出需要查询DOI的文献（没有DOI或DOI不完整）
        const needsDOI = references.filter(ref => !ref.doi && ref.title);

        if (needsDOI.length === 0) {
            console.log('[ReferenceAIProcessor] All references already have DOI');
            return references;
        }

        console.log(`[ReferenceAIProcessor] Querying DOI for ${needsDOI.length} references`);

        // 创建DOI解析器
        const resolver = window.DOIResolver.create({
            queryOrder: ['crossref', 'openalex', 'pubmed'],
            timeout: 5000
        });

        // 批量解析
        const doiResults = await resolver.batchResolve(needsDOI, (progress) => {
            if (progressCallback) {
                progressCallback({
                    phase: 'doi-enrichment',
                    completed: progress.completed,
                    total: progress.total,
                    current: progress.current
                });
            }
        });

        // 合并DOI信息回原始文献列表
        const enrichedReferences = references.map(ref => {
            if (ref.doi) return ref; // 已有DOI，跳过

            const doiResult = doiResults.find(r => r.original === ref);
            if (doiResult && doiResult.resolved) {
                return {
                    ...ref,
                    doi: doiResult.resolved.doi,
                    url: doiResult.resolved.url || ref.url,
                    // 可选：用DOI查询结果补充缺失的字段
                    authors: ref.authors || doiResult.resolved.authors,
                    year: ref.year || doiResult.resolved.year,
                    journal: ref.journal || doiResult.resolved.journal,
                    doiSource: doiResult.resolved.source,
                    doiConfidence: doiResult.resolved.confidence
                };
            }

            return ref;
        });

        const successCount = enrichedReferences.filter(r => r.doi).length;
        console.log(`[ReferenceAIProcessor] DOI enrichment complete: ${successCount}/${references.length} now have DOI`);

        return enrichedReferences;
    }

    /**
     * 构建API配置（兼容现有的翻译API）
     */
    function buildAPIConfig(model, apiKey, modelConfig = null) {
        if (model === 'custom' && modelConfig) {
            const endpoint = modelConfig.apiEndpoint || modelConfig.apiBaseUrl;
            return {
                endpoint: endpoint,
                modelName: modelConfig.modelId,
                apiKey: apiKey,
                headers: { 'Content-Type': 'application/json' },
                bodyBuilder: (sys, user) => {
                    const messages = [
                        { role: 'system', content: sys },
                        { role: 'user', content: user }
                    ];

                    return {
                        model: modelConfig.modelId,
                        messages: messages,
                        temperature: 0.1,
                        max_tokens: modelConfig.max_tokens || 4000
                    };
                },
                responseExtractor: (data) => data?.choices?.[0]?.message?.content
            };
        }

        // 预设模型配置
        const configs = {
            'mistral': {
                endpoint: 'https://api.mistral.ai/v1/chat/completions',
                modelName: 'mistral-large-latest'
            },
            'deepseek': {
                endpoint: 'https://api.deepseek.com/v1/chat/completions',
                modelName: 'deepseek-chat'
            },
            'gemini': {
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
                modelName: 'gemini-2.0-flash',
                bodyBuilder: (sys, user) => ({
                    contents: [{
                        role: 'user',
                        parts: [{ text: `${sys}\n\n${user}` }]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 4000
                    }
                }),
                responseExtractor: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text
            }
        };

        const config = configs[model];
        if (!config) {
            throw new Error(`Unsupported model: ${model}`);
        }

        return {
            ...config,
            apiKey: apiKey,
            headers: { 'Content-Type': 'application/json' },
            bodyBuilder: config.bodyBuilder || ((sys, user) => ({
                model: config.modelName,
                messages: [
                    { role: 'system', content: sys },
                    { role: 'user', content: user }
                ],
                temperature: 0.1
            })),
            responseExtractor: config.responseExtractor || ((data) => data?.choices?.[0]?.message?.content)
        };
    }

    // 导出API
    global.ReferenceAIProcessor = {
        batchProcessReferences,
        smartProcessReferences,
        enrichWithDOI,
        generateExtractionPrompt,
        buildAPIConfig,
        BATCH_SIZE,
        version: '1.1.0'
    };

    console.log('[ReferenceAIProcessor] Reference AI processor loaded.');

})(window);

