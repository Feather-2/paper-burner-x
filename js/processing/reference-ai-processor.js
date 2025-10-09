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

        return {
            system: `你是专业的文献信息提取助手。从参考文献中提取结构化信息，返回JSON格式。

返回格式示例：
{
  "references": [
    {
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
- 只返回JSON，不要任何其他文字`,

            user: `提取以下${references.length}条文献信息：

${references.map((ref, idx) => `[${idx}] ${ref}`).join('\n\n')}`
        };
    }

    /**
     * 调用AI API提取文献信息
     */
    async function callAIExtraction(references, apiConfig, sourceLang = 'auto') {
        const prompt = generateExtractionPrompt(references, sourceLang);

        try {
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

            const headers = apiConfig.headers || {};

            const response = await fetch(apiConfig.endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            console.log('[ReferenceAIProcessor] 响应状态:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[ReferenceAIProcessor] API错误响应:', {
                    status: response.status,
                    statusText: response.statusText,
                    preview: errorText.substring(0, 500)
                });
                throw new Error(`API请求失败 (${response.status}): ${response.statusText}`);
            }

            const responseText = await response.text();
            console.log('[ReferenceAIProcessor] 原始响应前500字符:', responseText.substring(0, 500));

            // 检查是否是HTML响应
            if (responseText.trim().toLowerCase().startsWith('<!doctype') ||
                responseText.trim().toLowerCase().startsWith('<html')) {
                console.error('[ReferenceAIProcessor] API返回了HTML页面而不是JSON');
                throw new Error('API返回HTML而非JSON，请检查端点配置和API Key');
            }

            const data = JSON.parse(responseText);
            const extractedText = apiConfig.responseExtractor
                ? apiConfig.responseExtractor(data)
                : data?.choices?.[0]?.message?.content;

            if (!extractedText) {
                console.error('[ReferenceAIProcessor] 响应数据:', data);
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
            const parsed = JSON.parse(cleanText);
            return parsed.references || [];

        } catch (error) {
            console.error('[ReferenceAIProcessor] AI extraction failed:', error);
            throw error;
        }
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
     * @returns {Promise<Array>} 处理结果
     */
    async function smartProcessReferences(entries, apiConfig, sourceLang = 'auto', progressCallback = null) {
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
        const finalResults = [...alreadyExtracted];

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

        return finalResults;
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
        generateExtractionPrompt,
        buildAPIConfig,
        BATCH_SIZE,
        version: '1.0.0'
    };

    console.log('[ReferenceAIProcessor] Reference AI processor loaded.');

})(window);

