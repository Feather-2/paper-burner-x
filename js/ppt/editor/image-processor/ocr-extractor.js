/**
 * OCR 文字提取模块
 * 优先级：MinerU > VLM
 * 
 * 增强功能：
 * - 字号自动估计
 * - bbox 收缩处理
 * - 高级背景采样
 */

class OcrExtractor {
    constructor() {
        this.config = {
            priority: 'mineru',
            vlmModel: null,
            language: 'auto',
            // 新增配置
            bboxShrinkRatio: 0.02,       // bbox 收缩比例
            fontSizeEstimation: true,     // 是否估计字号
            minFontSize: 8,
            maxFontSize: 72,
        };
        
        // 测量 Canvas（用于字号估计）
        this._measureCanvas = null;
        this._measureCtx = null;
        
    }

    isMineruAvailable() {
        try {
            // MinerU 配置存储在独立的 localStorage key 中
            const workerUrl = localStorage.getItem('ocrMinerUWorkerUrl') || '';
            const token = localStorage.getItem('ocrMinerUToken') || '';
            const tokenMode = localStorage.getItem('ocrMinerUTokenMode') || '';
            
            // 有 workerUrl 且（有 token 或 token 模式为 worker）
            const available = !!(workerUrl && (token || tokenMode === 'worker'));
            console.log(`[OcrExtractor] MinerU 可用性检查: url=${!!workerUrl}, token=${!!token}, mode=${tokenMode}, available=${available}`);
            return available;
        } catch (e) { 
            console.warn('[OcrExtractor] MinerU 可用性检查失败:', e);
            return false; 
        }
    }

    isVlmAvailable() {
        try {
            // 使用统一的 AI API 服务检查
            if (window.aiApiService) {
                const models = window.aiApiService.getAvailableModels();
                return models.length > 0;
            }
            return false;
        } catch { return false; }
    }

    async extract(imageObj, options = {}) {
        const priority = options.priority || this.config.priority;
        console.log(`[OcrExtractor] 使用 OCR 引擎: ${priority}`);

        // VLM 优先（用户明确选择）
        if (priority === 'vlm') {
            if (this.isVlmAvailable()) {
                return await this._extractWithVlm(imageObj, options);
            }
            throw new Error('VLM 模型未配置，请在设置中配置支持视觉的模型');
        }
        
        // MinerU 优先
        if (priority === 'mineru') {
            if (this.isMineruAvailable()) {
                try {
                    return await this._extractWithMineru(imageObj, options);
                } catch (e) {
                    console.warn('[OcrExtractor] MinerU 失败:', e);
                    // 回退到 VLM
                    if (this.isVlmAvailable()) {
                        console.log('[OcrExtractor] 回退到 VLM');
                        return await this._extractWithVlm(imageObj, options);
                    }
                    throw e;
                }
            }
            throw new Error('MinerU 未配置');
        }
        
        // 自动选择
        if (priority === 'auto') {
            // 优先尝试 MinerU
            if (this.isMineruAvailable()) {
                try {
                    return await this._extractWithMineru(imageObj, options);
                } catch (e) {
                    console.warn('[OcrExtractor] MinerU 失败，尝试 VLM:', e);
                    if (this.isVlmAvailable()) {
                        return await this._extractWithVlm(imageObj, options);
                    }
                    throw e;
                }
            }
            // 回退到 VLM
            if (this.isVlmAvailable()) {
                return await this._extractWithVlm(imageObj, options);
            }
        }

        throw new Error('没有可用的 OCR 引擎');
    }

    async _extractWithMineru(imageObj, options) {
        // 从 localStorage 读取 MinerU 配置
        const workerUrl = (localStorage.getItem('ocrMinerUWorkerUrl') || '').replace(/\/+$/, '');
        const token = localStorage.getItem('ocrMinerUToken') || '';
        const tokenMode = localStorage.getItem('ocrMinerUTokenMode') || '';
        // Auth key 是共享的，存储在 ocrWorkerAuthKey
        const authKey = localStorage.getItem('ocrWorkerAuthKey') || '';
        
        if (!workerUrl) {
            throw new Error('MinerU Worker URL 未配置');
        }
        
        // 构建请求头
        const headers = {};
        if (authKey) headers['X-Auth-Key'] = authKey;
        if (tokenMode === 'frontend' && token) {
            headers['X-MinerU-Key'] = token;
        }
        
        // 1. 上传图片
        const imageBlob = await this._dataUrlToBlob(imageObj.dataUrl);
        const formData = new FormData();
        formData.append('file', imageBlob, 'image.png');
        formData.append('is_ocr', 'true');

        console.log(`[OcrExtractor] 上传图片到 MinerU: ${workerUrl}/mineru/upload`);
        
        const uploadResponse = await fetch(`${workerUrl}/mineru/upload`, {
            method: 'POST', headers, body: formData
        });

        if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text().catch(() => '');
            throw new Error(`MinerU 上传失败: ${uploadResponse.status} ${errorText}`);
        }
        
        const uploadData = await uploadResponse.json();
        const batchId = uploadData.batch_id;
        console.log(`[OcrExtractor] MinerU batch_id: ${batchId}`);
        
        // 2. 轮询结果
        const maxAttempts = 60;
        const pollInterval = 2000;
        
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            
            const resultResponse = await fetch(`${workerUrl}/mineru/result/${batchId}`, { headers });
            
            if (!resultResponse.ok) {
                throw new Error(`MinerU 查询失败: ${resultResponse.status}`);
            }
            
            const resultData = await resultResponse.json();
            const result = resultData.extract_result?.[0];
            
            if (!result) {
                console.log(`[OcrExtractor] 等待结果... (${i + 1}/${maxAttempts})`);
                continue;
            }
            
            if (result.state === 'done') {
                console.log(`[OcrExtractor] MinerU 处理完成`);
                
                // 3. 下载并解析 ZIP
                const zipUrl = result.full_zip_url || result.fullZipUrl;
                if (zipUrl) {
                    return await this._downloadAndParseZip(zipUrl, workerUrl, headers, imageObj.width, imageObj.height);
                }
                
                // 如果没有 ZIP URL，尝试从 content_list 解析
                if (result.content_list) {
                    return this._parseMineruResult({ content_list: result.content_list }, imageObj.width, imageObj.height);
                }
                
                throw new Error('MinerU 返回结果无效');
            }
            
            if (result.state === 'failed') {
                throw new Error(`MinerU 处理失败: ${result.err_msg || '未知错误'}`);
            }
            
            // 显示进度
            if (result.state === 'running' && result.extract_progress) {
                const { extracted_pages, total_pages } = result.extract_progress;
                console.log(`[OcrExtractor] MinerU 处理中: ${extracted_pages}/${total_pages} 页`);
            }
        }
        
        throw new Error('MinerU 处理超时');
    }
    
    /**
     * 下载并解析 MinerU ZIP 结果
     */
    async _downloadAndParseZip(zipUrl, workerUrl, headers, imgWidth, imgHeight) {
        console.log(`[OcrExtractor] 下载 ZIP: ${zipUrl}`);
        
        // 通过 worker 代理下载 ZIP
        const proxyUrl = `${workerUrl}/mineru/zip?url=${encodeURIComponent(zipUrl)}`;
        const response = await fetch(proxyUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`下载 ZIP 失败: ${response.status}`);
        }
        
        const zipBlob = await response.blob();
        
        // 使用 JSZip 解析
        if (typeof JSZip === 'undefined') {
            // 动态加载 JSZip
            await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }
        
        const zip = await JSZip.loadAsync(zipBlob);
        
        // 查找 content_list.json 或 full.md
        let contentList = null;
        
        for (const [filename, file] of Object.entries(zip.files)) {
            if (filename.endsWith('content_list.json')) {
                const content = await file.async('string');
                contentList = JSON.parse(content);
                break;
            }
        }
        
        if (contentList) {
            return this._parseMineruResult({ content_list: contentList }, imgWidth, imgHeight);
        }
        
        // 尝试解析 layout.json
        for (const [filename, file] of Object.entries(zip.files)) {
            if (filename.endsWith('layout.json')) {
                const content = await file.async('string');
                const layoutData = JSON.parse(content);
                return this._parseLayoutJson(layoutData, imgWidth, imgHeight);
            }
        }
        
        throw new Error('ZIP 中未找到有效的 OCR 结果');
    }
    
    /**
     * 解析 layout.json 格式
     */
    _parseLayoutJson(layoutData, imgWidth, imgHeight) {
        const regions = [];
        const pages = layoutData.pages || layoutData;
        
        (Array.isArray(pages) ? pages : [pages]).forEach(page => {
            const pageBlocks = page.blocks || page.layout || [];
            pageBlocks.forEach((block, idx) => {
                if (block.type === 'text' || block.category === 'text') {
                    const text = block.text || block.content || '';
                    if (!text.trim()) return;
                    
                    let bbox;
                    if (block.bbox) {
                        if (Array.isArray(block.bbox)) {
                            bbox = {
                                left: block.bbox[0] / imgWidth,
                                top: block.bbox[1] / imgHeight,
                                width: (block.bbox[2] - block.bbox[0]) / imgWidth,
                                height: (block.bbox[3] - block.bbox[1]) / imgHeight
                            };
                        } else {
                            bbox = {
                                left: (block.bbox.x || block.bbox.left || 0) / imgWidth,
                                top: (block.bbox.y || block.bbox.top || 0) / imgHeight,
                                width: (block.bbox.width || block.bbox.w || 100) / imgWidth,
                                height: (block.bbox.height || block.bbox.h || 20) / imgHeight
                            };
                        }
                    } else {
                        // 默认 bbox
                        bbox = { left: 0.05, top: 0.05 + idx * 0.1, width: 0.9, height: 0.08 };
                    }
                    
                    bbox = this._shrinkBbox(bbox);
                    const estimatedFontSize = this._estimateFontSize(bbox, text, imgWidth, imgHeight);
                    
                    regions.push({
                        id: `text_${idx}`,
                        text,
                        bbox,
                        originalBbox: bbox,
                        style: {
                            fontSize: estimatedFontSize,
                            color: '#000000',
                            fontWeight: 'normal',
                            textAlign: this._detectTextAlign(text),
                        }
                    });
                }
            });
        });
        
        return { regions, engine: 'mineru', raw: layoutData };
    }
    
    /**
     * 动态加载脚本
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async _extractWithVlm(imageObj, options) {
        // 使用统一的 AI API 服务
        if (!window.aiApiService) {
            throw new Error('AI API 服务未加载，请确保 ai-api-service.js 已引入');
        }

        // 检测当前视觉模型能力（仅提示，不阻止使用）
        try {
            const visionConfig = window.aiApiService.getVisionModelConfig?.();
            const modelName = String(visionConfig?.model || '').toLowerCase();
            const modelSource = visionConfig?.name || visionConfig?.id || 'auto';

            // GLM-4.5V 等变体应当能命中 glm-4
            const groundingModels = ['qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'glm-4', 'glm4'];
            const supportsGrounding = groundingModels.some(m => modelName.includes(m));

            if (!visionConfig || !visionConfig.model) {
                console.warn('[OcrExtractor] ⚠️ 未配置可用的视觉模型，使用自动选择（如有）。建议在 PPT 模型配置中设置"视觉处理"角色');
            }

            if (!supportsGrounding) {
                console.warn(`[OcrExtractor] ⚠️ 当前模型 ${modelName || modelSource} 可能不支持精确的 Text Grounding`);
                console.warn('[OcrExtractor] 推荐使用 Qwen-VL 或 GLM-4V 以获得更准确的 bounding box');
            } else {
                console.log(`[OcrExtractor] ✓ 使用支持 Grounding 的模型: ${modelName}`);
            }
        } catch (e) {
            console.warn('[OcrExtractor] 模型能力检测失败:', e);
        }
        
        // 直接发送原图给 VLM，并强制使用原生 Grounding prompt（0-1000 坐标）
        const imageToSend = imageObj.dataUrl;
        const prompt = this._getNativeGroundingPrompt();
        
            // 调用 API（禁用图片预处理，避免自动缩放/填充导致坐标系不一致）
        const result = await window.aiApiService.analyzeImage(imageToSend, prompt, {
            model: 'auto',
            temperature: 0.1,
            maxTokens: 8192,
            maxImageSize: 4096,  // 足够大，尽量减少缩放带来的差异
            skipPreprocess: true  // 跳过预处理
        });

        console.log('[OcrExtractor] VLM 响应:', String(result.content || '').substring(0, 200) + '...');
        return this._parseVlmResult(result.content, imageObj.width, imageObj.height);
    }
    
    /**
     * 原生 Grounding Prompt（统一 0-1000 坐标）
     */
    _getNativeGroundingPrompt() {
        return `OCR task: Extract ALL text from this image with bounding boxes.

Output ONLY valid JSON (no markdown, no explanation):
{"regions":[{"text":"content","bbox":[left,top,right,bottom]}]}

Coordinates: 0-1000 scale, (0,0)=top-left, (1000,1000)=bottom-right.

CRITICAL rules:
1. Extract EVERY text region - titles, body text, labels, captions, watermarks, small annotations. Do NOT skip any visible text.
2. Keep text in the SAME visual container together as ONE region (e.g., a text box, a paragraph block, a title bar). Include line breaks as \\n within the "text" field.
3. SEPARATE text from DIFFERENT visual containers into different regions (e.g., title vs body, sidebar vs main content, different cards/boxes).
4. bbox must tightly wrap all text in that region.
5. Preserve original language - do NOT translate.
6. Escape special JSON characters in text (quotes as \\", backslash as \\\\).`;
    }
    
    /**
     * 解析 VLM 返回的 JSON 结果
     * 统一使用 0-1000 归一化坐标（按 prompt 要求固定除以 1000）
     */
    _parseVlmResult(content, imgWidth, imgHeight) {
        console.log('[OcrExtractor] 完整 VLM 响应:', content);
        const regions = [];
        
        try {
            // 尝试提取 JSON
            let jsonStr = String(content ?? '');
            
            // GLM-4V 使用 <|begin_of_box|> 和 <|end_of_box|> 包裹 JSON
            jsonStr = jsonStr.replace(/<\|begin_of_box\|>/g, '');
            jsonStr = jsonStr.replace(/<\|end_of_box\|>/g, '');
            
            // 如果包含 markdown 代码块，提取其中的 JSON
            const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            } else {
                // 尝试找到 JSON 对象
                const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    jsonStr = braceMatch[0];
                }
            }
            
            // 修复常见的 JSON 格式错误
            // 1. 双重括号 [[ 变成单括号 [（bbox_2d 格式错误）
            jsonStr = jsonStr.replace(/"bbox_2d":\s*\[\[/g, '"bbox_2d":[');
            jsonStr = jsonStr.replace(/"bbox":\s*\[\[/g, '"bbox":[');
            
            const data = JSON.parse(jsonStr);
            // Qwen-VL 返回的是数组 [{...}]，Gemini 返回的是对象 {regions: [...]}
            const rawRegions = Array.isArray(data) ? data : (data.regions || data.texts || data.results || []);
            
            rawRegions.forEach((item, idx) => {
                const text = item.text || item.text_content || item.content || '';
                if (!String(text).trim()) return;
                
                let bbox;
                
                if (Array.isArray(item.bbox_2d) && item.bbox_2d.length === 4) {
                    const [rx1, ry1, rx2, ry2] = item.bbox_2d;
                    const x1 = Number(rx1) / 1000;
                    const y1 = Number(ry1) / 1000;
                    const x2 = Number(rx2) / 1000;
                    const y2 = Number(ry2) / 1000;
                    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
                    
                    const left = Math.min(x1, x2);
                    const right = Math.max(x1, x2);
                    const top = Math.min(y1, y2);
                    const bottom = Math.max(y1, y2);

                    bbox = {
                        left: Math.max(0, Math.min(1, left)),
                        top: Math.max(0, Math.min(1, top)),
                        width: Math.max(0.01, Math.min(1, right - left)),
                        height: Math.max(0.01, Math.min(1, bottom - top))
                    };
                }
                // 格式2: 兼容格式 (x1, y1, x2, y2 独立字段，按 0-1000 归一化)
                else if ('x1' in item && 'y1' in item && 'x2' in item && 'y2' in item) {
                    const x1 = Math.max(0, Math.min(1000, Number(item.x1))) / 1000;
                    const y1 = Math.max(0, Math.min(1000, Number(item.y1))) / 1000;
                    const x2 = Math.max(0, Math.min(1000, Number(item.x2))) / 1000;
                    const y2 = Math.max(0, Math.min(1000, Number(item.y2))) / 1000;
                    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
                    
                    const left = Math.min(x1, x2);
                    const right = Math.max(x1, x2);
                    const top = Math.min(y1, y2);
                    const bottom = Math.max(y1, y2);

                    bbox = {
                        left,
                        top,
                        width: Math.max(0.01, right - left),
                        height: Math.max(0.01, bottom - top)
                    };
                }
                // 格式3: bbox 数组 [x1, y1, x2, y2] (GLM-4V 等模型)
                // GLM-4V 使用 0-1000 归一化坐标
                else if (Array.isArray(item.bbox) && item.bbox.length === 4) {
                    const [rx1, ry1, rx2, ry2] = item.bbox;
                    const x1 = Number(rx1) / 1000;
                    const y1 = Number(ry1) / 1000;
                    const x2 = Number(rx2) / 1000;
                    const y2 = Number(ry2) / 1000;
                    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
                    
                    const left = Math.min(x1, x2);
                    const right = Math.max(x1, x2);
                    const top = Math.min(y1, y2);
                    const bottom = Math.max(y1, y2);

                    bbox = {
                        left: Math.max(0, Math.min(1, left)),
                        top: Math.max(0, Math.min(1, top)),
                        width: Math.max(0.01, Math.min(1, right - left)),
                        height: Math.max(0.01, Math.min(1, bottom - top))
                    };
                }
                // 格式4: rotate_rect [centerX, centerY, width, height, angle] (qwen-vl-ocr)
                // 坐标是像素值，需要归一化
                else if (Array.isArray(item.rotate_rect) && item.rotate_rect.length >= 4) {
                    const [cx, cy, rw, rh, angle = 0] = item.rotate_rect;
                    // 当 angle 接近 90 或 270 度时，交换宽高
                    const isVertical = Math.abs(angle % 180 - 90) < 45;
                    const w = isVertical ? rh : rw;
                    const h = isVertical ? rw : rh;
                    // 转换为左上角坐标
                    const left = (cx - w / 2) / imgWidth;
                    const top = (cy - h / 2) / imgHeight;
                    const width = w / imgWidth;
                    const height = h / imgHeight;

                    if (![left, top, width, height].every(Number.isFinite)) return;

                    bbox = {
                        left: Math.max(0, Math.min(1, left)),
                        top: Math.max(0, Math.min(1, top)),
                        width: Math.max(0.01, Math.min(1, width)),
                        height: Math.max(0.01, Math.min(1, height))
                    };
                }
                // 格式5: 旧格式 bbox { left, top, width, height }
                else {
                    return;
                }
                
                if (!bbox || typeof bbox.left !== 'number') {
                    console.warn(`[OcrExtractor] 区域 ${idx} bbox 无效:`, bbox, item);
                    return; // 跳过无效区域
                }
                
                // 确保不超出边界
                if (bbox.left + bbox.width > 1) bbox.width = 1 - bbox.left;
                if (bbox.top + bbox.height > 1) bbox.height = 1 - bbox.top;
                
                const originalBbox = { ...bbox };
                bbox = this._shrinkBbox(bbox);
                
                const estimatedFontSize = item.fontSize || this._estimateFontSize(bbox, text, imgWidth, imgHeight);
                
                regions.push({
                    id: `text_${idx}`,
                    text,
                    bbox,
                    originalBbox,
                    style: {
                        fontSize: estimatedFontSize,
                        color: item.color || '#000000',
                        fontWeight: 'normal',
                        textAlign: this._detectTextAlign(text),
                    }
                });
            });
            
        } catch (e) {
            console.error('[OcrExtractor] 解析 VLM 结果失败:', e);
            console.log('[OcrExtractor] 原始内容:', content);
        }
        
        return { regions, engine: 'vlm', raw: content };
    }

    _parseMineruResult(data, imgWidth, imgHeight) {
        const regions = [];
        const contentList = data.content_list || data.contentList || [];
        
        contentList.forEach((item, idx) => {
            if (item.type === 'text' && item.text && item.bbox) {
                let bbox;
                let originalBbox;
                
                if (Array.isArray(item.bbox)) {
                    originalBbox = {
                        left: item.bbox[0] / imgWidth,
                        top: item.bbox[1] / imgHeight,
                        width: (item.bbox[2] - item.bbox[0]) / imgWidth,
                        height: (item.bbox[3] - item.bbox[1]) / imgHeight
                    };
                } else {
                    originalBbox = {
                        left: item.bbox.left / imgWidth,
                        top: item.bbox.top / imgHeight,
                        width: (item.bbox.right - item.bbox.left) / imgWidth,
                        height: (item.bbox.bottom - item.bbox.top) / imgHeight
                    };
                }
                
                // 收缩 bbox
                bbox = this._shrinkBbox(originalBbox);
                
                // 估计字号
                const estimatedFontSize = this._estimateFontSize(bbox, item.text, imgWidth, imgHeight);
                
                // 检测文字颜色（如果没有提供）
                const textColor = item.color || '#000000';
                
                regions.push({
                    id: `text_${idx}`,
                    text: item.text,
                    bbox,
                    originalBbox,
                    style: {
                        fontSize: estimatedFontSize,
                        color: textColor,
                        fontWeight: 'normal',
                        textAlign: this._detectTextAlign(item.text),
                    }
                });
            }
        });
        return { regions, engine: 'mineru', raw: data };
    }
    
    /**
     * 收缩 bbox（避免覆盖到边缘像素）
     */
    _shrinkBbox(bbox) {
        const shrink = this.config.bboxShrinkRatio;
        return {
            left: bbox.left + bbox.width * shrink,
            top: bbox.top + bbox.height * shrink,
            width: bbox.width * (1 - 2 * shrink),
            height: bbox.height * (1 - 2 * shrink),
        };
    }
    
    /**
     * 估计字号
     * 基于 bbox 高度和文字内容进行估算
     */
    _estimateFontSize(bbox, text, imgWidth, imgHeight) {
        if (!this.config.fontSizeEstimation) {
            return 14; // 默认字号
        }
        
        // bbox 的像素尺寸
        const bboxHeightPx = bbox.height * imgHeight;
        const bboxWidthPx = bbox.width * imgWidth;
        
        // 判断是否为 CJK 文字
        const isCJK = this._containsCJK(text);
        const lineHeightRatio = isCJK ? 1.3 : 1.2;
        
        // 估算行数
        const avgCharWidth = isCJK ? bboxHeightPx * 0.9 : bboxHeightPx * 0.5;
        const charsPerLine = Math.max(1, Math.floor(bboxWidthPx / avgCharWidth));
        const estimatedLines = Math.max(1, Math.ceil(text.length / charsPerLine));
        
        // 根据行数计算字号
        const lineHeight = bboxHeightPx / estimatedLines;
        let fontSize = lineHeight / lineHeightRatio;
        
        // 使用 Canvas 验证（如果可能）
        fontSize = this._refineFontSize(text, bboxWidthPx, bboxHeightPx, fontSize, isCJK);
        
        // 限制范围
        return Math.max(this.config.minFontSize, Math.min(this.config.maxFontSize, Math.round(fontSize)));
    }
    
    /**
     * 使用 Canvas 精细调整字号
     */
    _refineFontSize(text, maxWidth, maxHeight, initialFontSize, isCJK) {
        if (!this._measureCtx) {
            this._measureCanvas = document.createElement('canvas');
            this._measureCtx = this._measureCanvas.getContext('2d');
        }
        
        const fontFamily = isCJK ? '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif' : 'Arial, sans-serif';
        const lineHeightRatio = isCJK ? 1.3 : 1.2;
        
        // 二分搜索最优字号
        let minSize = this.config.minFontSize;
        let maxSize = Math.min(this.config.maxFontSize, initialFontSize * 1.5);
        let bestSize = initialFontSize;
        
        for (let i = 0; i < 8; i++) { // 最多迭代 8 次
            const testSize = (minSize + maxSize) / 2;
            this._measureCtx.font = `${testSize}px ${fontFamily}`;
            
            // 模拟换行
            const lines = this._simulateWrap(this._measureCtx, text, maxWidth, isCJK);
            const totalHeight = lines.length * testSize * lineHeightRatio;
            
            if (totalHeight <= maxHeight) {
                bestSize = testSize;
                minSize = testSize;
            } else {
                maxSize = testSize;
            }
            
            if (maxSize - minSize < 0.5) break;
        }
        
        return bestSize;
    }
    
    /**
     * 模拟换行
     */
    _simulateWrap(ctx, text, maxWidth, isCJK) {
        const lines = [];
        let currentLine = '';
        
        if (isCJK) {
            for (const char of text) {
                if (char === '\n') {
                    if (currentLine) lines.push(currentLine);
                    currentLine = '';
                    continue;
                }
                const testLine = currentLine + char;
                if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
        } else {
            const words = text.split(/(\s+)/);
            for (const word of words) {
                if (word === '\n') {
                    if (currentLine.trim()) lines.push(currentLine.trim());
                    currentLine = '';
                    continue;
                }
                const testLine = currentLine + word;
                if (ctx.measureText(testLine).width > maxWidth && currentLine.trim()) {
                    lines.push(currentLine.trim());
                    currentLine = word.trimStart();
                } else {
                    currentLine = testLine;
                }
            }
        }
        
        if (currentLine.trim()) lines.push(currentLine.trim());
        return lines.length > 0 ? lines : [''];
    }
    
    /**
     * 检测是否包含 CJK 字符
     */
    _containsCJK(text) {
        return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    }
    
    /**
     * 检测文字对齐方式
     */
    _detectTextAlign(text) {
        // 简单启发式：数字开头可能是列表，居中短文本可能是标题
        if (/^\d+[\.\)、]/.test(text)) return 'left';
        if (text.length < 20 && !text.includes('\n')) return 'center';
        return 'left';
    }

    // _parseVlmResult 已移至行 636，删除此重复定义

    async replaceTextWithBackground(imageObj, regions) {
        const canvas = document.createElement('canvas');
        canvas.width = imageObj.width;
        canvas.height = imageObj.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageObj.element, 0, 0);

        for (const region of regions) {
            const x = Math.floor(region.bbox.left * canvas.width);
            const y = Math.floor(region.bbox.top * canvas.height);
            const w = Math.ceil(region.bbox.width * canvas.width);
            const h = Math.ceil(region.bbox.height * canvas.height);
            const bgColor = this._sampleBackgroundColor(imageObj.imageData, x, y, w, h);
            ctx.fillStyle = bgColor;
            ctx.fillRect(x, y, w, h);
        }
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    _sampleBackgroundColor(imageData, x, y, w, h) {
        const data = imageData.data;
        const width = imageData.width;
        const samples = [];
        const samplePoints = [[x - 2, y + h / 2], [x + w + 2, y + h / 2], [x + w / 2, y - 2], [x + w / 2, y + h + 2]];

        for (const [sx, sy] of samplePoints) {
            if (sx >= 0 && sx < width && sy >= 0 && sy < imageData.height) {
                const idx = (Math.floor(sy) * width + Math.floor(sx)) * 4;
                samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
            }
        }
        if (samples.length === 0) return '#ffffff';
        const avg = {
            r: Math.round(samples.reduce((s, c) => s + c.r, 0) / samples.length),
            g: Math.round(samples.reduce((s, c) => s + c.g, 0) / samples.length),
            b: Math.round(samples.reduce((s, c) => s + c.b, 0) / samples.length)
        };
        return `rgb(${avg.r},${avg.g},${avg.b})`;
    }

    async _dataUrlToBlob(dataUrl) {
        const res = await fetch(dataUrl);
        return res.blob();
    }

    /**
     * Legacy 兼容：保留 API，但定位方案已固定为原生 grounding prompt（0-1000 坐标）
     */
    setLocalizationMode(_mode) {
        console.warn('[OcrExtractor] setLocalizationMode 已废弃：当前固定使用原生 grounding prompt (0-1000 坐标)');
    }
    
    /**
     * 获取当前定位方案
     */
    getLocalizationMode() {
        return 'native';
    }
}

// 单例 & 导出到全局
const ocrExtractor = new OcrExtractor();
window.OcrExtractor = OcrExtractor;
window.ocrExtractor = ocrExtractor;

// ESM 导出
export { OcrExtractor };
