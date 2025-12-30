/**
 * AI API Service - 统一的 AI 模型调用服务
 * 
 * 整合了以下模块的配置：
 * - 高级设置 - 提示词池 (prompt-pool-api.js)
 * - Chatbot AI 智能助手 (chatbot-config-manager.js)
 * - PPT 管线 / 图片智能编辑 (ocr-extractor.js)
 * 
 * 数据来源：
 * - 预设模型 Keys: loadModelKeys('deepseek'/'gemini'/'tongyi'/'volcano'/...)
 * - 自定义源站点: loadAllCustomSourceSites()
 * 
 * 使用方式：
 *   // 获取可用模型
 *   const models = window.aiApiService.getAvailableModels();
 *   
 *   // 聊天
 *   const result = await window.aiApiService.chat({ 
 *     messages: [...], 
 *     modelId: 'deepseek' // 或 'custom_source_xxx' 或 'siteId:modelId'
 *   });
 *   
 *   // 图片分析
 *   const result = await window.aiApiService.analyzeImage(imageDataUrl, prompt, { modelId: 'auto' });
 */

class AIApiService {
    constructor() {
        // 预设模型配置（与 prompt-pool-api.js 和 chatbot 保持一致）
        this.predefinedModels = {
            deepseek: {
                name: 'DeepSeek',
                endpoint: 'https://api.deepseek.com/v1/chat/completions',
                defaultModel: 'deepseek-chat',
                format: 'openai'
            },
            gemini: {
                name: 'Google Gemini',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta',
                defaultModel: 'gemini-2.0-flash',
                format: 'gemini'
            },
            tongyi: {
                name: '通义千问',
                endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
                defaultModel: 'qwen-plus',
                format: 'openai'
            },
            volcano: {
                name: '火山引擎',
                endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
                defaultModel: 'doubao-pro-32k',
                format: 'openai'
            },
            mistral: {
                name: 'Mistral AI',
                endpoint: 'https://api.mistral.ai/v1/chat/completions',
                defaultModel: 'mistral-large-latest',
                format: 'openai'
            },
            deeplx: {
                name: 'DeepLX',
                endpoint: '', // 特殊处理
                defaultModel: '',
                format: 'deeplx'
            }
        };
    }
    
    /**
     * 获取所有可用的模型配置（有 API Key 的）
     * @returns {Array<{id: string, name: string, type: string, endpoint: string, models: string[], keysCount: number}>}
     */
    getAvailableModels() {
        const models = [];
        
        // 1. 预设模型
        Object.entries(this.predefinedModels).forEach(([key, config]) => {
            const keys = this._getValidKeys(key);
            if (keys.length > 0) {
                models.push({
                    id: key,
                    name: config.name,
                    type: 'predefined',
                    endpoint: config.endpoint,
                    defaultModel: config.defaultModel,
                    format: config.format,
                    models: [config.defaultModel],
                    keysCount: keys.length
                });
            }
        });
        
        // 2. 自定义源站点
        const customSites = this._loadCustomSites();
        Object.entries(customSites).forEach(([siteId, site]) => {
            const keys = this._getValidKeys(`custom_source_${siteId}`);
            if (keys.length > 0) {
                // 处理 availableModels / selectedModels
                let modelList = site.availableModels || site.selectedModels || [];
                if (modelList.length > 0 && typeof modelList[0] === 'object') {
                    modelList = modelList.map(m => m.id || m.modelId || m.value || m);
                }
                
                models.push({
                    id: `custom_source_${siteId}`,
                    siteId: siteId,
                    name: site.name || site.siteName || siteId,
                    type: 'custom',
                    endpoint: site.apiEndpoint || site.apiBaseUrl || site.baseUrl || '',
                    endpointMode: site.endpointMode || 'auto',
                    defaultModel: modelList[0] || site.modelId || '',
                    format: site.requestFormat || 'openai',
                    models: modelList,
                    keysCount: keys.length,
                    // 保留原始 site 配置
                    _site: site
                });
            }
        });
        
        return models;
    }
    
    /**
     * 获取有效的 API Keys
     */
    _getValidKeys(modelKey) {
        const keys = this._loadModelKeys(modelKey);
        return keys.filter(k => k.status !== 'invalid' && k.value);
    }
    
    /**
     * 获取 PPT 模型配置
     * @param {string} type - 'lang' | 'img' | 'vision'
     * @returns {{modelKey: string, modelId: string} | null}
     */
    getPptModelConfig(type) {
        const storageKeys = {
            lang: 'pptModelConfigLanguage',
            img: 'pptModelConfigImage',
            vision: 'pptModelConfigVision'
        };
        try {
            const raw = localStorage.getItem(storageKeys[type]);
            if (raw) return JSON.parse(raw);
        } catch {}
        return null;
    }
    
    /**
     * 获取 PPT 视觉模型的 API 配置（用于 OCR 等）
     * 从 pptRolePriority.vision 读取配置，未配置时返回 auto
     * @returns {Object|null}
     */
    getVisionModelConfig() {
        // 从 pptRolePriority.vision 读取配置
        try {
            const rolePriorityRaw = localStorage.getItem('pptRolePriority');
            if (rolePriorityRaw) {
                const rolePriority = JSON.parse(rolePriorityRaw);
                const visionModels = rolePriority?.vision;
                if (Array.isArray(visionModels) && visionModels.length > 0) {
                    const modelKey = visionModels[0]; // 取第一个（最高优先级）
                    console.log(`[AIApiService] 使用 pptRolePriority.vision: ${modelKey}`);
                    return this._resolveModelConfig(modelKey);
                }
            }
        } catch (e) {
            console.warn('[AIApiService] 读取 pptRolePriority 失败:', e);
        }
        
        // 未配置时返回 auto
        console.warn('[AIApiService] 未配置 PPT 视觉模型（pptRolePriority.vision），使用 auto');
        return this._resolveModelConfig('auto');
    }
    
    /**
     * 发送聊天请求
     * @param {Object} options
     * @param {Array} options.messages - 消息列表
     * @param {string} options.model - 模型ID ('auto' 自动选择)
     * @param {string} options.usage - 用途 ('analyst'/'planner'/'writer'/'worker')
     * @param {number} options.temperature - 温度
     * @param {number} options.maxTokens - 最大token数
     * @returns {Promise<{content: string, model: string, usage: Object}>}
     */
    async chat(options) {
        const { messages, model = 'auto', usage, temperature = 0.7, maxTokens = 4096 } = options;

        let config;

        // 优先使用 PPT 模型配置（当 model='auto' 时）
        if (model === 'auto') {
            // 根据 usage 选择对应的 PPT 配置类型
            const usageToConfigType = {
                analyst: 'lang',
                planner: 'lang',
                writer: 'lang',
                worker: 'lang',
                reviewer: 'lang',
                vision: 'vision',
                image: 'img'
            };
            const configType = usageToConfigType[usage] || 'lang';
            const pptConfig = this.getPptModelConfig(configType);
            if (pptConfig && pptConfig.modelKey) {
                config = this._resolveModelConfig(pptConfig.modelKey, pptConfig.modelId);
                if (config) {
                    console.log(`[AIApiService] 使用 PPT 配置模型 (${usage || 'default'} -> ${configType}): ${config.name} (${config.model})`);
                }
            }
        }

        // 如果没有 PPT 配置或配置无效，使用传入的 model 参数
        if (!config) {
            config = this._resolveModelConfig(model);
        }

        if (!config) {
            throw new Error('没有可用的 AI 模型，请在"模型与密钥配置"中配置，或在"PPT 模型配置"中设置文字模型');
        }

        return await this._callApi(config, messages, temperature, maxTokens);
    }
    
    /**
     * 分析图片（使用视觉能力）
     * 优先使用 PPT 模型配置中的视觉模型
     * @param {string} imageDataUrl - 图片的 data URL
     * @param {string} prompt - 提示词
     * @param {Object} options - 可选参数
     * @param {number} options.maxImageSize - 图片最大边长（默认 2048px）
     * @param {number} options.imageQuality - 图片质量 0-1（默认 0.85）
     * @returns {Promise<{content: string, model: string}>}
     */
    async analyzeImage(imageDataUrl, prompt, options = {}) {
        const { 
            model = 'auto', 
            temperature = 0.3, 
            maxTokens = 8192,
            maxImageSize = 2048,
            imageQuality = 0.85
        } = options;
        
        // 预处理图片：限制大小和质量
        const processedImageUrl = await this._preprocessImage(imageDataUrl, maxImageSize, imageQuality);
        
        let config;
        
        // 优先使用 PPT 视觉模型配置
        if (model === 'auto') {
            config = this.getVisionModelConfig();
        } else {
            config = this._resolveModelConfig(model);
        }
        
        if (!config) {
            throw new Error('没有可用的视觉模型，请在 PPT 模型配置中设置视觉模型，或在"模型与密钥配置"中配置');
        }
        
        console.log(`[AIApiService] 使用视觉模型: ${config.name} (${config.model})`);
        
        // 构建带图片的消息（使用预处理后的图片）
        const messages = this._buildVisionMessages(prompt, processedImageUrl, config);
        
        return await this._callApi(config, messages, temperature, maxTokens);
    }
    
    /**
     * 解析模型配置
     * 支持多种格式：
     * - 'auto' - 自动选择
     * - 'deepseek' - 预设模型 ID
     * - 'custom_source_xxx' - 自定义源站点
     * - 'siteId:modelId' - prompt-pool 格式（兼容）
     * @param {string} modelId
     * @param {string} specificModel - 指定使用的具体模型名
     */
    _resolveModelConfig(modelId, specificModel = null) {
        const models = this.getAvailableModels();
        
        // 自动选择
        if (modelId === 'auto') {
            if (models.length === 0) return null;
            
            // 优先选择自定义源站点（通常更便宜）
            const customModel = models.find(m => m.type === 'custom');
            if (customModel) return this._buildApiConfig(customModel, specificModel);
            
            return this._buildApiConfig(models[0], specificModel);
        }
        
        // 兼容 prompt-pool 格式：siteId:modelId
        if (modelId.includes(':')) {
            const [siteId, modelName] = modelId.split(':', 2);

            // 如果 siteId 已经是 custom_source_xxx 格式，直接用它作为 id 查找
            if (siteId.startsWith('custom_source_')) {
                const model = models.find(m => m.id === siteId);
                if (model) return this._buildApiConfig(model, modelName);
            }

            // 否则按原逻辑：siteId 或 id 或 custom_source_siteId
            const model = models.find(m => m.siteId === siteId || m.id === siteId || m.id === `custom_source_${siteId}`);
            if (model) return this._buildApiConfig(model, modelName);
            return null;
        }
        
        // 直接匹配 ID
        const model = models.find(m => m.id === modelId);
        if (model) return this._buildApiConfig(model, specificModel);
        
        // 尝试匹配 siteId
        const customModel = models.find(m => m.siteId === modelId);
        if (customModel) return this._buildApiConfig(customModel, specificModel);
        
        return null;
    }
    
    /**
     * 构建 API 配置
     * @param {Object} model - 模型配置
     * @param {string} specificModel - 指定使用的具体模型名
     */
    _buildApiConfig(model, specificModel = null) {
        const keys = this._getValidKeys(model.id);
        if (keys.length === 0) return null;
        
        // 随机选择一个 key（简单负载均衡）
        const key = keys[Math.floor(Math.random() * keys.length)];
        
        // 确定使用的模型名
        const modelName = specificModel || model.defaultModel;
        
        // 确定 endpoint
        let endpoint = model.endpoint;
        if (model.type === 'custom' && model.endpointMode === 'auto') {
            // 自动补全端点
            endpoint = endpoint.replace(/\/+$/, '');
            const format = (model.format || 'openai').toLowerCase();
            if (format === 'anthropic') {
                // Anthropic Messages API: /v1/messages
                if (!endpoint.includes('/messages')) {
                    endpoint = endpoint.replace(/\/v1$/, '');
                    endpoint += '/v1/messages';
                }
            } else if (format === 'openai') {
                // OpenAI Chat Completions: /v1/chat/completions
                if (!endpoint.includes('/chat/completions')) {
                    endpoint = endpoint.replace(/\/v1$/, '');
                    endpoint += '/v1/chat/completions';
                }
            } else if (format === 'gemini') {
                // Gemini uses per-call endpoint construction in _callApi; keep base URL as-is.
                endpoint = endpoint;
            } else {
                // Unknown formats: best-effort fallback to OpenAI Chat Completions.
                if (!endpoint.includes('/chat/completions')) {
                    endpoint = endpoint.replace(/\/v1$/, '');
                    endpoint += '/v1/chat/completions';
                }
            }
        }
        
        return {
            id: model.id,
            name: model.name,
            type: model.type,
            endpoint: endpoint,
            apiKey: key.value,
            keyId: key.id,
            model: modelName,
            format: model.format || 'openai',
            models: model.models || [],
            _rawModel: model
        };
    }
    
    /**
     * 预处理图片：限制尺寸和压缩质量
     * @param {string} imageDataUrl - 原始图片 data URL
     * @param {number} maxSize - 最大边长（像素）
     * @param {number} quality - JPEG 质量 0-1
     * @returns {Promise<string>} 处理后的 data URL
     */
    async _preprocessImage(imageDataUrl, maxSize, quality) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const { width, height } = img;
                
                // 计算缩放比例
                let scale = 1;
                if (width > maxSize || height > maxSize) {
                    scale = maxSize / Math.max(width, height);
                }
                
                const newWidth = Math.round(width * scale);
                const newHeight = Math.round(height * scale);
                
                // 如果不需要缩放且是 JPEG，检查大小
                if (scale === 1 && imageDataUrl.includes('image/jpeg')) {
                    // 估算 base64 大小（每 4 字符 = 3 字节）
                    const estimatedSize = (imageDataUrl.length - imageDataUrl.indexOf(',') - 1) * 0.75;
                    if (estimatedSize < 1024 * 1024) { // < 1MB 直接返回
                        console.log(`[AIApiService] 图片无需处理: ${width}x${height}, ~${Math.round(estimatedSize/1024)}KB`);
                        resolve(imageDataUrl);
                        return;
                    }
                }
                
                // 创建 Canvas 进行缩放
                const canvas = document.createElement('canvas');
                canvas.width = newWidth;
                canvas.height = newHeight;
                const ctx = canvas.getContext('2d');
                
                // 高质量缩放
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, newWidth, newHeight);
                
                // 导出为 JPEG（比 PNG 小很多）
                const result = canvas.toDataURL('image/jpeg', quality);
                const resultSize = (result.length - result.indexOf(',') - 1) * 0.75;
                
                console.log(`[AIApiService] 图片预处理: ${width}x${height} -> ${newWidth}x${newHeight}, ~${Math.round(resultSize/1024)}KB`);
                resolve(result);
            };
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = imageDataUrl;
        });
    }
    
    /**
     * 构建视觉消息（带图片）
     */
    _buildVisionMessages(prompt, imageDataUrl, config) {
        const format = config.format || 'openai';
        
        if (format === 'anthropic') {
            // Claude 格式
            return [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageDataUrl.split(',')[1] } },
                    { type: 'text', text: prompt }
                ]
            }];
        } else {
            // OpenAI 兼容格式（包括 Gemini 通过兼容层）
            return [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
                ]
            }];
        }
    }
    
    /**
     * 调用 API
     */
    async _callApi(config, messages, temperature, maxTokens, options = {}) {
        const signal = options?.signal;
        const format = config.format || 'openai';
        let endpoint = config.endpoint;
        let headers = { 'Content-Type': 'application/json' };
        let body;

        const shouldEnablePromptCaching = (cfg, fmt) => {
            const rawSite = cfg?._rawModel?._site;
            if (rawSite && typeof rawSite === 'object') {
                if (rawSite.enablePromptCaching !== undefined) return !!rawSite.enablePromptCaching;
                if (rawSite.promptCaching !== undefined) return !!rawSite.promptCaching;
                if (rawSite.cacheControl !== undefined) return !!rawSite.cacheControl;
            }
            if (String(fmt || '').toLowerCase() === 'anthropic') return true;
            const haystack = `${cfg?.name || ''} ${cfg?.model || ''} ${cfg?.endpoint || ''}`.toLowerCase();
            return haystack.includes('anthropic') || haystack.includes('claude') || haystack.includes('minimax');
        };

        const normalizeAnthropicCacheTtl = (cfg) => {
            const rawSite = cfg?._rawModel?._site;
            if (!rawSite || typeof rawSite !== 'object') return null;
            const ttl = String(rawSite.promptCachingTtl ?? rawSite.promptCachingTTL ?? rawSite.cacheTtl ?? rawSite.cacheTTL ?? '').trim();
            if (!ttl) return null;
            return ttl === '5m' || ttl === '1h' ? ttl : null;
        };

        const addAnthropicCacheBreakpoint = (blocks, { ttl = null } = {}) => {
            const list = Array.isArray(blocks) ? blocks : [];
            for (let i = list.length - 1; i >= 0; i--) {
                const block = list[i];
                if (!block || typeof block !== 'object') continue;
                // Prefer a text block breakpoint; skip images/unknown blocks.
                if (block.type !== 'text') continue;
                block.cache_control = ttl ? { type: 'ephemeral', ttl } : { type: 'ephemeral' };
                return true;
            }
            return false;
        };

        const toAnthropicTextBlocks = (content) => {
            const mk = (text) => ({ type: 'text', text: String(text ?? '') });

            if (typeof content === 'string') {
                return [mk(content)];
            }
            if (Array.isArray(content)) {
                const texts = [];
                for (const part of content) {
                    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
                        texts.push(part.text);
                    } else if (typeof part === 'string') {
                        texts.push(part);
                    } else if (part && typeof part === 'object' && typeof part.text === 'string') {
                        texts.push(part.text);
                    }
                }
                return [mk(texts.join('\n'))];
            }
            return [mk(String(content ?? ''))];
        };

        const toAnthropicContentBlocks = (content) => {
            if (typeof content === 'string') {
                return [{ type: 'text', text: content }];
            }
            if (!Array.isArray(content)) {
                return [{ type: 'text', text: String(content ?? '') }];
            }

            const blocks = [];
            for (const part of content) {
                if (!part || typeof part !== 'object') {
                    if (part !== undefined && part !== null) blocks.push({ type: 'text', text: String(part) });
                    continue;
                }

                // Already Anthropic-style blocks
                if (part.type === 'text' && typeof part.text === 'string') {
                    blocks.push({ type: 'text', text: part.text });
                    continue;
                }
                if (part.type === 'image' && part.source && typeof part.source === 'object') {
                    blocks.push(part);
                    continue;
                }

                // OpenAI-style parts
                if (part.type === 'text' && typeof part.text === 'string') {
                    blocks.push({ type: 'text', text: part.text });
                    continue;
                }
                if (part.type === 'image_url') {
                    const url = part.image_url?.url || '';
                    if (typeof url === 'string' && url.includes(',')) {
                        const [prefix, data] = url.split(',', 2);
                        const mediaMatch = String(prefix || '').match(/^data:([^;]+);base64$/i);
                        const media_type = mediaMatch ? mediaMatch[1] : 'image/png';
                        blocks.push({ type: 'image', source: { type: 'base64', media_type, data } });
                        continue;
                    }
                    // Fallback: keep as text if we cannot inline base64
                    blocks.push({ type: 'text', text: `[image_url] ${String(url)}` });
                    continue;
                }

                blocks.push({ type: 'text', text: String(part.text ?? part.content ?? '') });
            }

            return blocks.length ? blocks : [{ type: 'text', text: '' }];
        };
        
        if (format === 'anthropic') {
            // Anthropic Claude
            headers['x-api-key'] = config.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            const enableCacheControl = shouldEnablePromptCaching(config, format);
            const cacheTtl = enableCacheControl ? normalizeAnthropicCacheTtl(config) : null;

            // Convert OpenAI-style [{role, content}] into Anthropic {system, messages}
            const list = Array.isArray(messages) ? messages : [];
            let idx = 0;
            const systemBlocks = [];
            while (idx < list.length && list[idx]?.role === 'system') {
                systemBlocks.push(...toAnthropicTextBlocks(list[idx]?.content));
                idx += 1;
            }

            const anthropicMessages = [];
            const originalIndices = [];
            for (let i = idx; i < list.length; i++) {
                const msg = list[i] && typeof list[i] === 'object' ? list[i] : null;
                if (!msg) continue;
                const roleRaw = String(msg.role || '').trim();
                const role = roleRaw === 'assistant' ? 'assistant' : 'user';
                if (roleRaw === 'system') {
                    // Anthropic doesn't support mid-history system; treat it as user content.
                    anthropicMessages.push({ role: 'user', content: toAnthropicTextBlocks(msg.content) });
                    originalIndices.push(i);
                } else {
                    anthropicMessages.push({ role, content: toAnthropicContentBlocks(msg.content) });
                    originalIndices.push(i);
                }
            }

            if (enableCacheControl) {
                // Cache breakpoint strategy:
                // - Prefer caching the stable prefix (system + prior conversation history).
                // - Exclude the final user/tool turn (dynamic input) and any injected system/tool messages near the end.
                let breakpointOriginalIndex = null;
                for (let i = list.length - 1; i >= 0; i--) {
                    const msg = list[i];
                    if (!msg || typeof msg !== 'object') continue;
                    const role = String(msg.role || '').trim();
                    if (role === 'user' || role === 'tool') {
                        breakpointOriginalIndex = i;
                        break;
                    }
                }

                if (breakpointOriginalIndex !== null) {
                    // Place the breakpoint on the last user/assistant message BEFORE the final user/tool input,
                    // skipping any injected system messages near the end.
                    let targetOriginal = null;
                    for (let i = breakpointOriginalIndex - 1; i >= 0; i--) {
                        const msg = list[i];
                        if (!msg || typeof msg !== 'object') continue;
                        const role = String(msg.role || '').trim();
                        if (role === 'assistant' || role === 'user') {
                            targetOriginal = i;
                            break;
                        }
                    }

                    if (targetOriginal !== null) {
                        const msgIndex = originalIndices.lastIndexOf(targetOriginal);
                        if (msgIndex >= 0) {
                            addAnthropicCacheBreakpoint(anthropicMessages[msgIndex]?.content, { ttl: cacheTtl });
                        }
                    } else {
                        // No prior conversation history; fall back to caching system blocks.
                        addAnthropicCacheBreakpoint(systemBlocks, { ttl: cacheTtl });
                    }
                } else {
                    // No user/tool message found; best-effort cache system blocks.
                    addAnthropicCacheBreakpoint(systemBlocks, { ttl: cacheTtl });
                }
            }

            body = {
                model: config.model,
                max_tokens: maxTokens,
                temperature,
                messages: anthropicMessages,
                ...(systemBlocks.length ? { system: systemBlocks } : {}),
            };
        } else if (format === 'gemini') {
            // Google Gemini 原生格式
            endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
            body = {
                contents: messages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: Array.isArray(m.content) 
                        ? m.content.map(c => {
                            if (c.type === 'text') return { text: c.text };
                            if (c.type === 'image_url') {
                                const url = c.image_url?.url || '';
                                const base64 = url.includes(',') ? url.split(',')[1] : url;
                                return { inlineData: { mimeType: 'image/png', data: base64 } };
                            }
                            return { text: String(c) };
                        })
                        : [{ text: m.content }]
                })),
                generationConfig: { temperature, maxOutputTokens: maxTokens }
            };
        } else {
            // OpenAI 兼容格式（默认）
            headers['Authorization'] = `Bearer ${config.apiKey}`;
            if (!endpoint.includes('/chat/completions')) {
                endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
            }
            body = {
                model: config.model,
                messages,
                temperature,
                max_tokens: maxTokens
            };
        }
        
        console.log(`[AIApiService] 调用 ${config.name} (${config.model}) -> ${endpoint}`);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            ...(signal ? { signal } : {})
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error(`[AIApiService] API 错误:`, response.status, errorText);
            throw new Error(`API 调用失败: ${response.status} ${errorText.substring(0, 200)}`);
        }
        
        const data = await response.json();
        
        // 解析响应
        let content;
        if (format === 'anthropic') {
            content = data.content?.[0]?.text || '';
        } else if (format === 'gemini') {
            content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            content = data.choices?.[0]?.message?.content || '';
        }
        
        return {
            content,
            model: config.model,
            usage: data.usage || {},
            _raw: data
        };
    }
    
    
    /**
     * 加载设置
     */
    _loadSettings() {
        if (typeof loadSettings === 'function') {
            return loadSettings();
        }
        try {
            return JSON.parse(localStorage.getItem('paperburner_settings') || '{}');
        } catch {
            return {};
        }
    }
    
    /**
     * 加载模型 Keys
     */
    _loadModelKeys(modelName) {
        if (typeof loadModelKeys === 'function') {
            return loadModelKeys(modelName) || [];
        }
        try {
            const raw = localStorage.getItem('paperburner_model_keys');
            if (raw) {
                const all = JSON.parse(raw);
                return all[modelName] || [];
            }
        } catch {}
        return [];
    }
    
    /**
     * 加载自定义源站点
     */
    _loadCustomSites() {
        if (typeof loadAllCustomSourceSites === 'function') {
            return loadAllCustomSourceSites() || {};
        }
        try {
            return JSON.parse(localStorage.getItem('customSourceSites') || '{}');
        } catch {
            return {};
        }
    }
}

// 创建全局单例
window.aiApiService = new AIApiService();

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIApiService;
}
