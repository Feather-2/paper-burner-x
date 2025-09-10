// process/prompt-pool.js
// 翻译提示词池管理系统 - AI生成版本

/**
 * 翻译提示词池管理器 - AI生成版本 + 智能健康管理
 */
class TranslationPromptPool {
    constructor() {
        this.storageKey = 'paperBurnerPromptPool';
        this.healthConfigKey = 'paperBurnerPromptHealthConfig';
        this.defaultGenerationCount = 10;
        this.promptPool = this.loadPromptPool();
        this.healthConfig = this.loadHealthConfig();
        this.activeRequestsQueue = new Map(); // 跟踪正在进行的请求
        
        // 启动健康监控和复活机制
        this.startHealthMonitoring();

        // 一次性迁移：如果历史数据只有使用次数，没有请求统计，则将其回填为成功请求
        this.migrateUsageToRequestsIfNeeded();
    }

    /**
     * 加载健康管理配置
     */
    loadHealthConfig() {
        try {
            const stored = localStorage.getItem(this.healthConfigKey);
            const defaultConfig = {
                maxConsecutiveFailures: 2, // 最大连续失败次数
                deactivationEnabled: true, // 是否启用失活机制
                resurrectionTimeMinutes: 15, // 复活时间（分钟）
                resurrectionEnabled: true, // 是否启用自动复活
                switchOnFailure: true, // 失败时是否自动切换
                queueManagementEnabled: true // 是否启用队列管理
            };
            return stored ? { ...defaultConfig, ...JSON.parse(stored) } : defaultConfig;
        } catch (error) {
            console.error('Failed to load health config:', error);
            return {
                maxConsecutiveFailures: 2,
                deactivationEnabled: true,
                resurrectionTimeMinutes: 15,
                resurrectionEnabled: true,
                switchOnFailure: true,
                queueManagementEnabled: true
            };
        }
    }

    /**
     * 保存健康管理配置
     */
    saveHealthConfig() {
        try {
            localStorage.setItem(this.healthConfigKey, JSON.stringify(this.healthConfig));
        } catch (error) {
            console.error('Failed to save health config:', error);
        }
    }

    /**
     * 启动健康监控定时器
     */
    startHealthMonitoring() {
        // 每分钟检查一次复活条件
        setInterval(() => {
            if (this.healthConfig.resurrectionEnabled) {
                this.checkForResurrection();
            }
        }, 60000); // 1分钟
    }

    /**
     * 从本地存储加载提示词池
     */
    loadPromptPool() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Failed to load prompt pool:', error);
            return [];
        }
    }

    /**
     * 保存提示词池到本地存储
     */
    savePromptPool() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.promptPool));
        } catch (error) {
            console.error('Failed to save prompt pool:', error);
        }
    }

    /**
     * 迁移历史统计：当 totalRequests=0 且 success/failure 均为0，但 usage_count>0 时，
     * 将 usage_count 视为历史成功请求数进行回填，避免出现“使用>0，请求=0”的误导显示。
     */
    migrateUsageToRequestsIfNeeded() {
        let changed = false;
        try {
            this.promptPool.forEach(p => {
                const h = p.healthStatus;
                if (!h) return;
                if ((h.totalRequests || 0) === 0 && (h.successCount || 0) === 0 && (h.failureCount || 0) === 0 && (p.usage_count || 0) > 0) {
                    h.totalRequests = p.usage_count;
                    h.successCount = p.usage_count;
                    changed = true;
                }
            });
            if (changed) this.savePromptPool();
        } catch (e) {
            console.warn('migrateUsageToRequestsIfNeeded failed:', e);
        }
    }

    /**
     * 使用AI生成提示词变体
     * @param {string} referenceSystemPrompt - 参考的系统提示词
     * @param {string} referenceUserPrompt - 参考的用户提示词
     * @param {number} count - 生成数量，默认10个
     * @param {number} similarity - 相似度控制 (0.1-0.9，0.1=差异很大，0.9=非常相似)
     * @param {string} apiModel - 使用的AI模型
     * @param {string} apiKey - API密钥
     * @returns {Promise<Array>} 生成的提示词变体数组
     */
    async generateVariationsWithAI(referenceSystemPrompt, referenceUserPrompt, count = this.defaultGenerationCount, similarity = 0.7, apiModel = 'deepseek', apiKey, options = {}) {
        if (!apiKey) {
            throw new Error('需要提供API密钥来生成提示词变体');
        }

        // 构建AI生成提示词的系统提示（风格锁定：仅改写措辞/语序，不改变风格与约束）
        let aiSystemPrompt = options.generatorSystemPrompt || `你是资深提示词工程师，负责在不改变风格与约束的前提下，生成同风格的改写变体。

任务：基于参考提示词，生成 ${count} 个“同风格、同约束、同输出要求”的翻译提示词变体；仅在措辞、语序、句式、连接词与段落组织上做改写，以提升稳定性与一致性。

强制要求：
1. 返回 JSON，包含字段 variations（数组）。
2. 每个变体包含：name（名称）、systemPrompt（系统提示）、userPromptTemplate（用户提示模板）、description（简要说明）。
3. 相似度控制：${similarity}（${this.getSimilarityDescription(similarity)}）。注意：风格与约束必须完全一致，仅体现措辞与语序差异。
4. userPromptTemplate 必须且仅出现一次占位符：\${targetLangName} 与 \${content}。
5. 严禁改变参考提示词的风格、语气、规则、术语偏好与输出格式要求；严禁引入“学术/商务/口语/文学”等风格标签的切换或暗示。
6. 允许调整表述顺序、同义替换与句式变化，但要保持语义与约束等价。
7. 仅输出严格的 JSON 对象（不包含 Markdown 代码块、注释或额外文本）。
8. 使用单行（minified）JSON 输出：不得换行、不得缩进。

JSON 格式示例：
{
  "variations": [
    {
      "name": "同风格改写-1",
      "systemPrompt": "（与参考风格一致，仅改写措辞/语序）你是专业翻译助手...",
      "userPromptTemplate": "请将以下内容翻译为\${targetLangName}：\\n\\n\${content}",
      "description": "风格锁定；仅做同义改写与语序调整"
    }
  ]
}`;

        let aiUserPrompt = options.generatorUserPrompt || `参考提示词（须保持风格/规则/输出要求一致）：

**系统提示：**
${referenceSystemPrompt}

**用户提示模板：**
${referenceUserPrompt}

请基于以上参考提示词生成 ${count} 个“同风格改写”变体：保持风格、语气、规则与输出要求不变，仅做措辞/语序/句式的等价改写。相似度：${similarity}（${this.getSimilarityDescription(similarity)}）。

每个变体必须包含 systemPrompt 与 userPromptTemplate 两个字段；并确保 userPromptTemplate 都包含且仅包含一次 \${targetLangName} 与 \${content} 占位符。严格输出为单行 JSON（无任何额外文字/提示/代码块）。`;

        try {
            // 调用AI API生成变体
            const aiResponse = await this.callAIForGeneration(aiSystemPrompt, aiUserPrompt, apiModel, apiKey);
            
            // 解析AI返回的JSON
            const parsedResponse = this.parseAIResponse(aiResponse);
            
            // 验证和处理生成的变体
            const processedVariations = this.processGeneratedVariations(parsedResponse.variations);
            
            return processedVariations;
            
        } catch (error) {
            console.error('AI生成提示词变体失败:', error);
            throw new Error(`生成提示词变体失败: ${error.message}`);
        }
    }

    /**
     * 获取相似度描述
     */
    getSimilarityDescription(similarity) {
        // 在风格锁定前提下，对“措辞/语序”的差异程度描述
        if (similarity <= 0.3) return '改写幅度很大（语序与措辞差异显著）';
        if (similarity <= 0.5) return '改写幅度中等（保持等价约束，表达有明显变化）';
        if (similarity <= 0.7) return '改写幅度适中（整体表达有所变化）';
        return '改写幅度较小（细微措辞/顺序调整）';
    }

    /**
     * 调用AI API生成变体（复用现有的翻译API调用逻辑）
     */
    async callAIForGeneration(systemPrompt, userPrompt, apiModel, apiKey) {
        // 统一从 translation.js 的构建逻辑获取配置，避免端点不一致
        if (typeof callTranslationApi !== 'function') {
            throw new Error('callTranslationApi函数不可用，请确保 api.js 已加载');
        }

        // 优先使用独立的生成配置构建器
        let apiConfig;
        if (typeof window !== 'undefined' && typeof window.buildPromptPoolGenerationConfig === 'function') {
            apiConfig = window.buildPromptPoolGenerationConfig(apiModel, apiKey);
        } else if (typeof processModule !== 'undefined' && typeof processModule.buildCustomApiConfig === 'function') {
            // 回退（自定义站点）：尽量使用 buildCustomApiConfig 补全端点
            if (apiModel.includes(':')) {
                const [siteId, modelId] = apiModel.split(':');
                const allSites = typeof loadAllCustomSourceSites === 'function' ? loadAllCustomSourceSites() : {};
                const site = allSites[siteId];
                if (!site) throw new Error(`未找到源站点配置：${siteId}`);
                apiConfig = processModule.buildCustomApiConfig(
                    apiKey,
                    site.apiEndpoint || site.apiBaseUrl,
                    modelId || site.modelId,
                    site.requestFormat || 'openai',
                    site.temperature !== undefined ? site.temperature : 0.5,
                    site.max_tokens !== undefined ? site.max_tokens : 8000
                );
            } else {
                throw new Error('未能构建预设模型的配置，请检查脚本加载顺序');
            }
        } else {
            throw new Error('缺少构建 API 配置的函数，请检查脚本加载顺序');
        }

        const requestBody = apiConfig.bodyBuilder
            ? apiConfig.bodyBuilder(systemPrompt, userPrompt)
            : {
                model: apiConfig.modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.8,
                max_tokens: 4000
            };

        try {
            const result = await callTranslationApi(apiConfig, requestBody);
            return result;
        } catch (error) {
            throw new Error(`API调用失败: ${error.message}`);
        }
    }

    /**
     * 构建生成API配置（集成现有的模型管理系统）
     */
    buildGenerationApiConfig(apiModel, apiKey) {
        // 已由独立模块统一实现，保留兼容入口
        if (typeof window !== 'undefined' && typeof window.buildPromptPoolGenerationConfig === 'function') {
            return window.buildPromptPoolGenerationConfig(apiModel, apiKey);
        }
        throw new Error('构建API配置失败：缺少 buildPromptPoolGenerationConfig');
    }

    /**
     * 解析AI返回的JSON响应
     */
    parseAIResponse(responseText) {
        if (!responseText || typeof responseText !== 'string') {
            throw new Error('AI响应为空或不是文本');
        }

        // 预清理：去掉 <think>...</think>、代码块围栏、前后杂项
        let text = responseText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/```json/gi, '```')
            .trim();

        // 尝试1：直接 JSON.parse（兼容单行/多行）
        try { return JSON.parse(text); } catch {}

        // 尝试2：```json 或 ``` 包裹的内容（逐块尝试）
        try {
            const blocks = text.match(/```\s*[\s\S]*?```/g);
            if (blocks) {
                for (const b of blocks) {
                    const body = b.replace(/```/g, '').trim();
                    // 允许裸换行修复
                    const obj = (function(raw){
                        let s = raw.replace(/,\s*(\}|\])/g, '$1');
                        let out = '', inStr=false, esc=false;
                        for (let i=0;i<s.length;i++){
                            const ch=s[i];
                            if(inStr){
                                if(esc){out+=ch;esc=false;continue;}
                                if(ch==='\\'){out+=ch;esc=true;continue;}
                                if(ch==='"'){inStr=false;out+=ch;continue;}
                                if(ch==='\n'||ch==='\r'){out+='\\n';continue;}
                                out+=ch;
                            }else{
                                if(ch==='"'){inStr=true;out+=ch;continue;}
                                out+=ch;
                            }
                        }
                        try{return JSON.parse(out);}catch{return null;}
                    })(body);
                    if (obj) {
                        if (Array.isArray(obj)) return {variations: obj};
                        if (Array.isArray(obj.variations)) return {variations: obj.variations};
                        if (obj.name && obj.systemPrompt && obj.userPromptTemplate) return {variations:[obj]};
                    }
                }
            }
        } catch {}

        // 尝试3：基于 "variations" 关键词做括号配对提取
        const keyIdx = text.indexOf('"variations"');
        if (keyIdx !== -1) {
            // 从 keyIdx 往左找到最近的 '{'
            let start = text.lastIndexOf('{', keyIdx);
            if (start !== -1) {
                // 自 start 往右做简单括号配对（不考虑字符串内花括号的极端情况，但一般足够）
                let depth = 0, end = -1;
                for (let i = start; i < text.length; i++) {
                    const ch = text[i];
                    if (ch === '{') depth++;
                    else if (ch === '}') depth--;
                    if (depth === 0) { end = i; break; }
                }
                if (end !== -1) {
                    let candidate = text.slice(start, end + 1);
                    // 去掉可能存在的尾随逗号
                    candidate = candidate.replace(/,\s*(\}|\])/g, '$1');
                    // 去掉可能存在的行内注释（简单处理）
                    candidate = candidate.replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1');
                    try { return JSON.parse(candidate); } catch {}
                }
            }
        }

        // 尝试4：宽泛匹配第一个 {...} 快，做配对
        {
            const first = text.indexOf('{');
            const last = text.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last > first) {
                let candidate = text.slice(first, last + 1);
                candidate = candidate.replace(/,\s*(\}|\])/g, '$1');
                try { return JSON.parse(candidate); } catch {}
            }
        }

        // 尝试5：如果文本中包含有效的 JSON 片段行，拼接重尝试（保守）
        try {
            const lines = text.split(/\n|\r/).map(l => l.trim());
            // 仅保留可能是 JSON 的行
            const filtered = lines.filter(l => /^[\[\]{},:\"\w\s\-\$]/.test(l)).join('');
            if (filtered.includes('{') && filtered.includes('}')) {
                const cleaned = filtered.replace(/,\s*(\}|\])/g, '$1');
                const obj = JSON.parse(cleaned);
                const norm = (function(o){
                    if (!o) return null;
                    if (Array.isArray(o)) return {variations:o};
                    if (Array.isArray(o.variations)) return {variations:o.variations};
                    if (o.name && o.systemPrompt && o.userPromptTemplate) return {variations:[o]};
                    return null;
                })(obj);
                if (norm) return norm;
            }
        } catch {}

        console.error('解析AI响应失败:', responseText);
        throw new Error('AI返回的不是有效的JSON格式');
    }

    /**
     * 处理和验证生成的变体
     */
    processGeneratedVariations(variations) {
        if (!Array.isArray(variations)) {
            throw new Error('AI返回的variations不是数组格式');
        }

        const processedVariations = [];
        const baseId = Date.now();

        variations.forEach((variation, index) => {
            try {
                // 验证必要字段
                if (!variation.name || !variation.systemPrompt || !variation.userPromptTemplate) {
                    console.warn(`跳过无效变体 ${index}:`, variation);
                    return;
                }

                // 占位符修复策略
                let userTemplate = variation.userPromptTemplate || '';
                let targetLangCount = (userTemplate.match(/\$\{targetLangName\}/g) || []).length;
                let contentCount = (userTemplate.match(/\$\{content\}/g) || []).length;
                if (targetLangCount === 0) {
                    userTemplate = `所需语言：\${targetLangName}\n` + userTemplate;
                    targetLangCount = 1;
                }
                if (contentCount === 0) {
                    userTemplate = userTemplate.replace(/\s*$/, '') + `\n\n需要翻译的内容：\${content}`;
                    contentCount = 1;
                }
                variation.userPromptTemplate = userTemplate;

                // 构建标准变体对象
                const processedVariation = {
                    id: `${baseId}_${index}`,
                    name: variation.name || `同风格改写-${index+1}`,
                    systemPrompt: variation.systemPrompt,
                    userPromptTemplate: variation.userPromptTemplate,
                    description: variation.description || '',
                    // 固定为通用类别，避免引入“学术/商务/口语”等风格标签
                    category: 'general',
                    tags: this.generateTags(variation.name, variation.description || ''),
                    created_at: new Date().toISOString(),
                    usage_count: 0,
                    isActive: false,
                    userSelected: null,
                    aiGenerated: true,
                    // 健康状态信息
                    healthStatus: {
                        status: 'healthy', // healthy, degraded, failed, deactivated
                        totalRequests: 0,
                        successCount: 0,
                        failureCount: 0,
                        consecutiveFailures: 0,
                        lastUsed: null,
                        lastSuccess: null,
                        lastFailure: null,
                        deactivatedAt: null,
                        deactivationReason: null,
                        requestHistory: [], // 最近20次请求的记录
                        averageResponseTime: 0
                    }
                };

                processedVariations.push(processedVariation);
            } catch (error) {
                console.warn(`处理变体 ${index} 时出错:`, error);
            }
        });

        if (processedVariations.length === 0) {
            throw new Error('没有生成有效的提示词变体');
        }

        return processedVariations;
    }

    /**
     * 推断变体类别
     */
    inferCategory(name, description) {
        const text = `${name} ${description}`.toLowerCase();
        
        if (text.includes('学术') || text.includes('论文') || text.includes('研究')) return 'academic';
        if (text.includes('技术') || text.includes('专业') || text.includes('工程')) return 'technical';
        if (text.includes('商务') || text.includes('正式') || text.includes('商业')) return 'business';
        if (text.includes('通俗') || text.includes('口语') || text.includes('简单')) return 'casual';
        if (text.includes('文学') || text.includes('创意') || text.includes('艺术')) return 'literary';
        
        return 'general';
    }

    /**
     * 生成标签
     */
    generateTags(name, description) {
        const text = `${name} ${description}`.toLowerCase();
        const tags = [];
        
        if (text.includes('准确') || text.includes('精确')) tags.push('准确');
        if (text.includes('详细') || text.includes('全面')) tags.push('详细');
        if (text.includes('简洁') || text.includes('简单')) tags.push('简洁');
        if (text.includes('专业') || text.includes('权威')) tags.push('专业');
        if (text.includes('创意') || text.includes('创新')) tags.push('创意');
        if (text.includes('AI生成')) tags.push('AI生成');
        
        return tags.length > 0 ? tags : ['AI生成'];
    }

    /**
     * 记录提示词使用结果
     * @param {string} promptId - 提示词ID
     * @param {boolean} success - 是否成功
     * @param {number} responseTime - 响应时间(ms)
     * @param {string} error - 错误信息（如果失败）
     * @param {Object} requestInfo - 请求相关信息
     */
    recordPromptUsage(promptId, success, responseTime = 0, error = null, requestInfo = {}) {
        const promptIndex = this.promptPool.findIndex(p => p.id === promptId);
        if (promptIndex === -1) return;

        const prompt = this.promptPool[promptIndex];
        const now = new Date().toISOString();
        
        // 确保healthStatus存在
        if (!prompt.healthStatus) {
            prompt.healthStatus = {
                status: 'healthy',
                totalRequests: 0,
                successCount: 0,
                failureCount: 0,
                consecutiveFailures: 0,
                lastUsed: null,
                lastSuccess: null,
                lastFailure: null,
                deactivatedAt: null,
                deactivationReason: null,
                requestHistory: [],
                averageResponseTime: 0
            };
        }

        const health = prompt.healthStatus;
        
        // 更新基础统计
        health.totalRequests++;
        health.lastUsed = now;
        
        // 创建请求记录
        const requestRecord = {
            timestamp: now,
            success: success,
            responseTime: responseTime,
            error: error,
            consecutiveFailureCount: health.consecutiveFailures,
            ...requestInfo
        };
        
        // 添加到历史记录（保持最近20条）
        health.requestHistory.unshift(requestRecord);
        if (health.requestHistory.length > 20) {
            health.requestHistory = health.requestHistory.slice(0, 20);
        }
        
        if (success) {
            health.successCount++;
            health.consecutiveFailures = 0;
            health.lastSuccess = now;
            
            // 更新平均响应时间
            health.averageResponseTime = this.calculateAverageResponseTime(health.requestHistory);
            
            // 如果之前处于降级状态，考虑恢复
            if (health.status === 'degraded') {
                health.status = 'healthy';
                console.log(`[PromptPool] 提示词 ${prompt.name} 恢复健康状态`);
            }
            
        } else {
            health.failureCount++;
            health.consecutiveFailures++;
            health.lastFailure = now;
            
            console.warn(`[PromptPool] 提示词 ${prompt.name} 失败，连续失败次数: ${health.consecutiveFailures}`);
            
            // 更新健康状态
            this.updatePromptHealthStatus(promptId);
            
            // 如果启用了切换机制，处理队列替换
            if (this.healthConfig.switchOnFailure && this.healthConfig.queueManagementEnabled) {
                this.handleQueueReplacement(promptId);
            }

            // 会话锁场景：若当前会话锁定提示词即为失败项，则打破锁，允许后续任务挑选新提示词
            if (typeof window !== 'undefined' && window.promptPoolUI && typeof window.promptPoolUI.breakSessionLockIfMatches === 'function') {
                window.promptPoolUI.breakSessionLockIfMatches(promptId);
            }
        }
        
        this.savePromptPool();
        
        // 通知UI更新（如果存在）
        if (typeof window !== 'undefined' && window.promptPoolUI && window.promptPoolUI.updateHealthDisplay) {
            window.promptPoolUI.updateHealthDisplay(promptId);
        }
    }

    /**
     * 更新提示词健康状态
     */
    updatePromptHealthStatus(promptId) {
        const prompt = this.promptPool.find(p => p.id === promptId);
        if (!prompt || !prompt.healthStatus) return;
        
        const health = prompt.healthStatus;
        const config = this.healthConfig;
        
        // 检查是否需要失活
        if (config.deactivationEnabled && 
            health.consecutiveFailures >= config.maxConsecutiveFailures) {
            
            health.status = 'deactivated';
            health.deactivatedAt = new Date().toISOString();
            health.deactivationReason = `连续失败${health.consecutiveFailures}次`;
            prompt.isActive = false;
            
            console.warn(`[PromptPool] 提示词 ${prompt.name} 已失活: ${health.deactivationReason}`);
            
            // 触发UI通知
            this.notifyPromptDeactivated(prompt);
            
        } else if (health.consecutiveFailures >= Math.floor(config.maxConsecutiveFailures / 2)) {
            // 进入降级状态
            health.status = 'degraded';
            console.warn(`[PromptPool] 提示词 ${prompt.name} 进入降级状态`);
        }
    }

    /**
     * 处理队列替换逻辑
     */
    handleQueueReplacement(failedPromptId) {
        try {
            // 获取使用失败提示词的待处理请求
            const pendingRequests = this.activeRequestsQueue.get(failedPromptId) || [];
            
            if (pendingRequests.length > 0) {
                // 选择新的提示词
                const newPrompt = this.selectHealthyPrompt(failedPromptId);
                
                if (newPrompt) {
                    console.log(`[PromptPool] 替换队列中的 ${pendingRequests.length} 个请求，从 ${failedPromptId} 到 ${newPrompt.id}`);
                    
                    // 将请求转移到新提示词
                    pendingRequests.forEach(request => {
                        request.promptId = newPrompt.id;
                        request.prompt = newPrompt;
                        request.replacedFrom = failedPromptId;
                        request.replacedAt = new Date().toISOString();
                    });
                    
                    // 更新队列
                    this.activeRequestsQueue.set(newPrompt.id, 
                        (this.activeRequestsQueue.get(newPrompt.id) || []).concat(pendingRequests));
                    this.activeRequestsQueue.delete(failedPromptId);
                    
                } else {
                    console.warn(`[PromptPool] 没有可用的健康提示词来替换失败的 ${failedPromptId}`);
                }
            }
            
        } catch (error) {
            console.error('[PromptPool] 队列替换失败:', error);
        }
    }

    /**
     * 将请求入队（在任务开始前调用）。仅记录待开始的请求，便于失败时迁移。
     * @param {string} promptId
     * @param {{requestId:string, model?:string, meta?:Object}} request
     */
    enqueueRequest(promptId, request) {
        try {
            const arr = this.activeRequestsQueue.get(promptId) || [];
            arr.push({ ...request, enqueuedAt: Date.now() });
            this.activeRequestsQueue.set(promptId, arr);
        } catch (e) { console.warn('enqueueRequest failed:', e); }
    }

    /**
     * 请求出队（在任务开始执行时或完成时调用，防止被当作待迁移）。
     * @param {string} promptId
     * @param {string} requestId
     */
    dequeueRequest(promptId, requestId) {
        try {
            const arr = this.activeRequestsQueue.get(promptId) || [];
            const next = arr.filter(r => r.requestId !== requestId);
            if (next.length === 0) this.activeRequestsQueue.delete(promptId);
            else this.activeRequestsQueue.set(promptId, next);
        } catch (e) { console.warn('dequeueRequest failed:', e); }
    }

    /**
     * 选择健康的提示词
     */
    selectHealthyPrompt(excludePromptId = null) {
        const healthyPrompts = this.promptPool.filter(prompt => 
            prompt.isActive && 
            prompt.userSelected === true &&
            prompt.id !== excludePromptId &&
            prompt.healthStatus &&
            ['healthy', 'degraded'].includes(prompt.healthStatus.status)
        );
        
        if (healthyPrompts.length === 0) return null;
        
        // 优先选择完全健康的
        const fullyHealthy = healthyPrompts.filter(p => p.healthStatus.status === 'healthy');
        if (fullyHealthy.length > 0) {
            // 按成功率排序
            fullyHealthy.sort((a, b) => {
                const aSuccessRate = a.healthStatus.totalRequests > 0 ? 
                    a.healthStatus.successCount / a.healthStatus.totalRequests : 1;
                const bSuccessRate = b.healthStatus.totalRequests > 0 ? 
                    b.healthStatus.successCount / b.healthStatus.totalRequests : 1;
                return bSuccessRate - aSuccessRate;
            });
            return fullyHealthy[0];
        }
        
        // 如果没有完全健康的，选择降级状态中最好的
        healthyPrompts.sort((a, b) => b.healthStatus.successCount - a.healthStatus.successCount);
        return healthyPrompts[0];
    }

    /**
     * 检查复活条件
     */
    checkForResurrection() {
        const now = new Date();
        const resurrectionTimeMs = this.healthConfig.resurrectionTimeMinutes * 60 * 1000;
        
        const deactivatedPrompts = this.promptPool.filter(prompt => 
            prompt.healthStatus && 
            prompt.healthStatus.status === 'deactivated' &&
            prompt.healthStatus.deactivatedAt
        );
        
        deactivatedPrompts.forEach(prompt => {
            const deactivatedAt = new Date(prompt.healthStatus.deactivatedAt);
            const timeSinceDeactivation = now - deactivatedAt;
            
            if (timeSinceDeactivation >= resurrectionTimeMs) {
                this.resurrectPrompt(prompt.id);
            }
        });
    }

    /**
     * 复活提示词
     */
    resurrectPrompt(promptId) {
        const prompt = this.promptPool.find(p => p.id === promptId);
        if (!prompt || !prompt.healthStatus) return;
        
        const health = prompt.healthStatus;
        
        // 重置健康状态
        health.status = 'healthy';
        health.consecutiveFailures = 0;
        health.deactivatedAt = null;
        health.deactivationReason = null;
        
        // 如果用户之前选择了这个提示词，重新激活
        if (prompt.userSelected === true) {
            prompt.isActive = true;
        }
        
        console.log(`[PromptPool] 提示词 ${prompt.name} 已自动复活`);
        
        this.savePromptPool();
        
        // 通知UI
        this.notifyPromptResurrected(prompt);
    }

    /**
     * 计算平均响应时间
     */
    calculateAverageResponseTime(history) {
        if (!history || history.length === 0) return 0;
        
        const validTimes = history.filter(record => record.success && record.responseTime > 0);
        if (validTimes.length === 0) return 0;
        
        const totalTime = validTimes.reduce((sum, record) => sum + record.responseTime, 0);
        return Math.round(totalTime / validTimes.length);
    }

    /**
     * 通知UI提示词失活
     */
    notifyPromptDeactivated(prompt) {
        if (typeof window !== 'undefined' && window.promptPoolUI && window.promptPoolUI.showNotification) {
            window.promptPoolUI.showNotification(
                `提示词"${prompt.name}"因连续失败已自动失活`, 
                'warning'
            );
        }
    }

    /**
     * 通知UI提示词复活
     */
    notifyPromptResurrected(prompt) {
        if (typeof window !== 'undefined' && window.promptPoolUI && window.promptPoolUI.showNotification) {
            window.promptPoolUI.showNotification(
                `提示词"${prompt.name}"已自动复活`, 
                'success'
            );
        }
    }

    /**
     * 批量添加变体到提示词池
     */
    addVariationsToPool(variations) {
        this.promptPool.push(...variations);
        this.savePromptPool();
    }

    /**
     * 更新提示词项目
     */
    updatePromptItem(id, updates) {
        const index = this.promptPool.findIndex(item => item.id === id);
        if (index !== -1) {
            this.promptPool[index] = { ...this.promptPool[index], ...updates };
            this.savePromptPool();
            return true;
        }
        return false;
    }

    /**
     * 批量更新提示词项目
     * @param {string[]} ids 
     * @param {Object} updates
     */
    updatePromptItems(ids, updates) {
        let changed = false;
        this.promptPool = this.promptPool.map(item => {
            if (ids.includes(item.id)) {
                changed = true;
                return { ...item, ...updates };
            }
            return item;
        });
        if (changed) this.savePromptPool();
        return changed;
    }

    /**
     * 批量复活提示词
     * @param {string[]} ids
     */
    resurrectPrompts(ids) {
        ids.forEach(id => this.resurrectPrompt(id));
    }

    /**
     * 删除提示词项目
     */
    deletePromptItem(id) {
        const index = this.promptPool.findIndex(item => item.id === id);
        if (index !== -1) {
            this.promptPool.splice(index, 1);
            this.savePromptPool();
            return true;
        }
        return false;
    }

    /**
     * 获取激活的提示词列表（健康状态感知）
     */
    getActivePrompts() {
        return this.promptPool.filter(item => 
            item.isActive && 
            item.userSelected === true &&
            item.healthStatus &&
            ['healthy', 'degraded'].includes(item.healthStatus.status)
        );
    }

    /**
     * 获取所有提示词
     */
    getAllPrompts() {
        return this.promptPool;
    }

    /**
     * 清空提示词池
     */
    clearPool() {
        this.promptPool = [];
        this.savePromptPool();
    }

    /**
     * 智能随机选择一个激活的提示词（带健康管理）
     */
    getRandomActivePrompt() {
        const activePrompts = this.getActivePrompts();
        if (activePrompts.length === 0) return null;
        
        // 按健康状态和成功率权重选择
        const weightedPrompts = this.calculatePromptWeights(activePrompts);
        const selectedPrompt = this.weightedRandomSelect(weightedPrompts);
        
        if (selectedPrompt) {
            // 更新使用次数
            this.updatePromptItem(selectedPrompt.id, { 
                usage_count: selectedPrompt.usage_count + 1 
            });
            
            // 记录选择到队列（用于失败时的队列管理）
            this.recordPromptSelection(selectedPrompt.id);
        }
        
        return selectedPrompt;
    }

    /**
     * 按轮换方式选择激活的提示词（带健康管理）
     */
    getRotationActivePrompt() {
        const activePrompts = this.getActivePrompts();
        if (activePrompts.length === 0) return null;
        
        // 优先选择健康状态最好的，使用次数最少的
        activePrompts.sort((a, b) => {
            // 首先按健康状态排序
            const healthPriority = { 'healthy': 0, 'degraded': 1 };
            const aPriority = healthPriority[a.healthStatus.status] || 2;
            const bPriority = healthPriority[b.healthStatus.status] || 2;
            
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // 然后按使用次数排序
            return a.usage_count - b.usage_count;
        });
        
        const selectedPrompt = activePrompts[0];
        
        // 更新使用次数
        this.updatePromptItem(selectedPrompt.id, { 
            usage_count: selectedPrompt.usage_count + 1 
        });
        
        // 记录选择到队列
        this.recordPromptSelection(selectedPrompt.id);
        
        return selectedPrompt;
    }

    /**
     * 计算提示词的权重（基于健康状态和成功率）
     */
    calculatePromptWeights(prompts) {
        return prompts.map(prompt => {
            let weight = 1;
            
            if (prompt.healthStatus) {
                const health = prompt.healthStatus;
                
                // 健康状态权重
                if (health.status === 'healthy') {
                    weight *= 1.0;
                } else if (health.status === 'degraded') {
                    weight *= 0.5; // 降级状态降低权重
                }
                
                // 成功率权重
                if (health.totalRequests > 0) {
                    const successRate = health.successCount / health.totalRequests;
                    weight *= (0.5 + successRate); // 0.5-1.5范围
                }
                
                // 响应时间权重（响应时间越短权重越高）
                if (health.averageResponseTime > 0) {
                    const timeWeight = Math.max(0.1, 1 - (health.averageResponseTime / 10000)); // 10秒为基准
                    weight *= timeWeight;
                }
            }
            
            return { prompt, weight: Math.max(0.1, weight) };
        });
    }

    /**
     * 权重随机选择
     */
    weightedRandomSelect(weightedPrompts) {
        if (weightedPrompts.length === 0) return null;
        if (weightedPrompts.length === 1) return weightedPrompts[0].prompt;
        
        const totalWeight = weightedPrompts.reduce((sum, item) => sum + item.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const item of weightedPrompts) {
            random -= item.weight;
            if (random <= 0) {
                return item.prompt;
            }
        }
        
        // 回退到最后一个
        return weightedPrompts[weightedPrompts.length - 1].prompt;
    }

    /**
     * 记录提示词选择（用于队列管理）
     */
    recordPromptSelection(promptId) {
        // 这里可以记录提示词被选择用于某个翻译任务
        // 在实际翻译失败时，可以使用这些信息进行队列替换
    }

    /**
     * 获取健康管理配置
     */
    getHealthConfig() {
        return this.healthConfig;
    }

    /**
     * 更新健康管理配置
     */
    updateHealthConfig(newConfig) {
        this.healthConfig = { ...this.healthConfig, ...newConfig };
        this.saveHealthConfig();
    }

    /**
     * 获取提示词健康统计
     */
    getHealthStats() {
        const stats = {
            total: this.promptPool.length,
            active: 0,
            healthy: 0,
            degraded: 0,
            deactivated: 0,
            totalRequests: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            averageSuccessRate: 0
        };
        
        this.promptPool.forEach(prompt => {
            if (prompt.isActive && prompt.userSelected === true) {
                stats.active++;
            }
            
            if (prompt.healthStatus) {
                const health = prompt.healthStatus;
                
                switch (health.status) {
                    case 'healthy':
                        stats.healthy++;
                        break;
                    case 'degraded':
                        stats.degraded++;
                        break;
                    case 'deactivated':
                        stats.deactivated++;
                        break;
                }
                
                stats.totalRequests += health.totalRequests;
                stats.totalSuccesses += health.successCount;
                stats.totalFailures += health.failureCount;
            }
        });
        
        stats.averageSuccessRate = stats.totalRequests > 0 ? 
            (stats.totalSuccesses / stats.totalRequests) : 0;
        
        return stats;
    }
}

// 全局实例
if (typeof window !== 'undefined') {
    window.translationPromptPool = new TranslationPromptPool();
}

// 将类添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.TranslationPromptPool = TranslationPromptPool;
}
