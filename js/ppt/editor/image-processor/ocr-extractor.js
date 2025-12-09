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
            // VLM 定位方案: 'auto' | 'native' | 'grid'
            // auto: 自动检测模型能力
            // native: 强制使用原生 grounding (0-1000 坐标)
            // grid: 强制使用网格辅助方案
            vlmLocalizationMode: 'grid',  // 默认用 grid，更稳定
        };
        
        // 测量 Canvas（用于字号估计）
        this._measureCanvas = null;
        this._measureCtx = null;
        
        // 加载持久化的配置
        this._loadConfig();
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
     * 根据图片宽高比计算网格数量
     * 目标：让每个格子尽量接近正方形，总格数约 80-120
     */
    _calculateGridSize(width, height) {
        // 使用简单的 10x10 网格，更容易被 VLM 理解
        // 大多数 VLM 训练时使用的是百分比或简单的网格系统
        const gridX = 10;
        const gridY = 10;
        
        console.log(`[OcrExtractor] 图片 ${width}x${height} → 网格 ${gridX}x${gridY}`);
        return { gridX, gridY };
    }
    
    /**
     * 在图片上叠加网格辅助 VLM 定位
     * @param {Object} imageObj - 图片对象 { dataUrl, width, height, element }
     * @param {number} gridX - X 方向网格数量
     * @param {number} gridY - Y 方向网格数量
     * @returns {Promise<string>} 带网格的图片 data URL
     */
    async _overlayGrid(imageObj, gridX = 10, gridY = 10) {
        const canvas = document.createElement('canvas');
        canvas.width = imageObj.width;
        canvas.height = imageObj.height;
        const ctx = canvas.getContext('2d');
        
        // 绘制原图
        let imgElement = imageObj.element;
        if (!imgElement) {
            // 从 dataUrl 创建并等待加载
            imgElement = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = imageObj.dataUrl;
            });
        }
        ctx.drawImage(imgElement, 0, 0);
        
        // 网格样式
        const cellWidth = imageObj.width / gridX;
        const cellHeight = imageObj.height / gridY;
        
        // 绘制网格线（半透明红色）
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.lineWidth = Math.max(1, Math.min(imageObj.width, imageObj.height) / 500);
        
        // 垂直线
        for (let i = 0; i <= gridX; i++) {
            const x = i * cellWidth;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, imageObj.height);
            ctx.stroke();
        }
        
        // 水平线
        for (let i = 0; i <= gridY; i++) {
            const y = i * cellHeight;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(imageObj.width, y);
            ctx.stroke();
        }
        
        // 绘制刻度数字
        const fontSize = Math.max(10, Math.min(cellWidth, cellHeight) / 3);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 顶部 X 轴刻度
        for (let i = 0; i <= gridX; i++) {
            const x = i * cellWidth;
            // 白色背景
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(x - fontSize * 0.4, 2, fontSize * 0.8, fontSize * 1.1);
            // 数字
            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.fillText(String(i), x, fontSize * 0.6 + 2);
        }
        
        // 左侧 Y 轴刻度
        for (let i = 0; i <= gridY; i++) {
            const y = i * cellHeight;
            // 白色背景
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fillRect(2, y - fontSize * 0.4, fontSize * 0.8, fontSize * 0.9);
            // 数字
            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.textAlign = 'left';
            ctx.fillText(String(i), 4, y);
        }
        
        console.log(`[OcrExtractor] 已叠加 ${gridX}x${gridY} 网格`);
        return canvas.toDataURL('image/jpeg', 0.9);
    }
    
    /**
     * 临时显示带网格的图片预览
     */
    _showGridPreview(gridImageUrl, width, height, gridX, gridY) {
        // 创建浮动预览容器
        const container = document.createElement('div');
        container.id = 'ocr-grid-preview';
        container.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 99999;
            background: rgba(0,0,0,0.9);
            padding: 16px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            max-width: 90vw;
            max-height: 90vh;
        `;
        
        container.innerHTML = `
            <div style="color:#fff;font-size:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                <span>🔍 VLM OCR 正在识别中... (${gridX}x${gridY} 参考网格)</span>
                <span style="color:#888;font-size:12px;">${width}x${height}</span>
            </div>
            <img src="${gridImageUrl}" style="max-width:80vw;max-height:70vh;border-radius:8px;display:block;">
            <div style="color:#888;font-size:12px;margin-top:8px;text-align:center;">
                X轴刻度 0-${gridX}，Y轴刻度 0-${gridY}，精度 0.1
            </div>
        `;
        
        document.body.appendChild(container);
        return container;
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
        
        // 获取模型信息
        const visionConfig = window.aiApiService.getVisionModelConfig();
        const modelName = (visionConfig?.model || '').toLowerCase();
        
        // 决定使用哪种定位方案
        const locMode = options.localizationMode || this.config.vlmLocalizationMode || 'grid';
        let useNativeGrounding = false;
        
        if (locMode === 'native') {
            useNativeGrounding = true;
        } else if (locMode === 'auto') {
            useNativeGrounding = this._supportsNativeGrounding(modelName);
        }
        // locMode === 'grid' 时 useNativeGrounding = false
        
        console.log(`[OcrExtractor] 模型: ${modelName}, 定位方案: ${locMode}, 使用原生: ${useNativeGrounding}`);
        
        let prompt, imageToSend, gridX, gridY, previewContainer;
        
        if (useNativeGrounding) {
            // 使用原生 Text Grounding 能力（Qwen-VL, Gemini 2.0 等）
            imageToSend = imageObj.dataUrl;
            prompt = this._getNativeGroundingPrompt(modelName);
            // 原生模式也记录默认 grid 值，用于回退解析
            gridX = 10; gridY = 10;
            console.log('[OcrExtractor] 使用原生 Text Grounding 能力');
        } else {
            // 使用网格辅助方案
            ({ gridX, gridY } = this._calculateGridSize(imageObj.width, imageObj.height));
            imageToSend = await this._overlayGrid(imageObj, gridX, gridY);
            previewContainer = this._showGridPreview(imageToSend, imageObj.width, imageObj.height, gridX, gridY);
            prompt = this._getGridAssistPrompt(gridX, gridY);
            console.log(`[OcrExtractor] 使用网格辅助方案 (${gridX}x${gridY})`);
        }
        
            // 调用 API（禁用图片预处理，避免网格被缩放导致坐标不准）
        const result = await window.aiApiService.analyzeImage(imageToSend, prompt, {
            model: 'auto',
            temperature: 0.1,
            maxTokens: 8192,
            maxImageSize: 4096,  // 足够大，避免缩放已叠加网格的图片
            skipPreprocess: true  // 跳过预处理
        });
        
        // 关闭网格预览
        if (previewContainer) {
            setTimeout(() => previewContainer.remove(), 500);
        }
        
        console.log('[OcrExtractor] VLM 响应:', result.content.substring(0, 200) + '...');
        const parsed = this._parseVlmResult(result.content, imageObj.width, imageObj.height, gridX, gridY, useNativeGrounding);
        console.log('[OcrExtractor] 解析完成，regions 数量:', parsed.regions.length);
        if (parsed.regions.length > 0) {
            console.log('[OcrExtractor] 第一个 region bbox:', parsed.regions[0].bbox);
        }
        return parsed;
    }
    
    /**
     * 检测模型是否支持原生 Text Grounding
     */
    _supportsNativeGrounding(modelName) {
        const groundingModels = [
            'qwen-vl', 'qwen2-vl', 'qwen2.5-vl',  // 通义千问 VL 系列
            'gemini-2', 'gemini-2.0', 'gemini-2.5',  // Gemini 2.0+
            'gpt-4o', 'gpt-4-vision',  // GPT-4 系列（有一定能力）
            'claude-3.5', 'claude-3-5',  // Claude 3.5（有一定能力）
        ];
        return groundingModels.some(m => modelName.includes(m));
    }
    
    /**
     * 原生 Text Grounding Prompt（针对支持的模型）
     */
    _getNativeGroundingPrompt(modelName) {
        // Qwen-VL 专用 prompt (参考官方文档)
        if (modelName.includes('qwen')) {
            return `Extract all text from this image with bounding box coordinates in JSON format.

Output format (JSON array only, no other text):
[{"bbox_2d":[x1,y1,x2,y2],"text_content":"text here"}]

Coordinates are pixel values relative to the image dimensions.
Include all visible text: titles, labels, annotations, etc.
Output text in its ORIGINAL language (do not translate).`;
        }
        
        // Gemini 专用 prompt
        if (modelName.includes('gemini')) {
            return `Detect all text in this image and provide precise bounding box coordinates for each text region.

Output format (JSON only):
{"regions":[{"bbox":[x1,y1,x2,y2],"text":"content"}]}

Coordinates: normalized integers 0-1000 (0=top-left, 1000=bottom-right).
Include all visible text regions.
Output text in its ORIGINAL language (do not translate).`;
        }
        
        // 通用 prompt（GPT-4, Claude 等）
        return `You are a precise OCR tool with text localization capability. Detect all text in this image and provide bounding box coordinates.

Output format (JSON only, no markdown):
{"regions":[{"bbox":[x1,y1,x2,y2],"text":"content"}]}

Coordinate system:
- Values are normalized to 0-1000 scale
- (0,0) = top-left corner, (1000,1000) = bottom-right corner
- bbox = [left, top, right, bottom]

Requirements:
- Include ALL visible text (titles, labels, annotations, etc.)
- bbox should tightly fit the text
- Merge text on the same line into one region`;
    }
    
    /**
     * 网格辅助方案的 Prompt
     */
    _getGridAssistPrompt(gridX, gridY) {
        return `**Task: Detect and Localize all text regions in this image.**

The image has a ${gridX}x${gridY} reference grid overlay (red lines). Use the grid to estimate PERCENTAGE coordinates (0-100).

**Coordinate System**
- Use PERCENTAGE of image dimensions (0-100), NOT grid numbers
- x1,y1 = top-left corner of text bounding box (percentage)
- x2,y2 = bottom-right corner of text bounding box (percentage)
- Grid helps you estimate: each cell = ${(100/gridX).toFixed(0)}% width, ${(100/gridY).toFixed(0)}% height

**Step-by-step Localization**
1. DETECT each text region (ignore the red grid lines and scale numbers)
2. Estimate the PERCENTAGE position of text's top-left corner → (x1, y1)
3. Estimate the PERCENTAGE position of text's bottom-right corner → (x2, y2)
4. Merge adjacent text on the same line into one region

**Output Format** (JSON only, no other text)
{"regions":[{"text":"detected text","x1":8,"y1":11,"x2":40,"y2":19}]}

**Example**
If "Hello World" is at 12% from left, 8% from top, extending to 45% width and 13% height:
{"regions":[{"text":"Hello World","x1":12,"y1":8,"x2":45,"y2":13}]}

**Constraints**
- 0 ≤ x1 < x2 ≤ 100
- 0 ≤ y1 < y2 ≤ 100
- Coordinates are PERCENTAGES, integers preferred
- Include ALL visible text (titles, labels, annotations)
- Output text in its ORIGINAL language (do not translate)`;
    }
    
    /**
     * 解析 VLM 返回的 JSON 结果
     * 支持多种格式：
     * 1. 原生 Grounding: bbox_2d/bbox [x1,y1,x2,y2] (0-1000 归一化)
     * 2. 网格辅助: x1,y1,x2,y2 (网格刻度)
     * 3. 旧格式: bbox { left, top, width, height } (归一化 0-1)
     */
    _parseVlmResult(content, imgWidth, imgHeight, gridX = 10, gridY = 10, isNativeGrounding = false) {
        console.log(`[OcrExtractor] _parseVlmResult 被调用, gridX=${gridX}, gridY=${gridY}, isNativeGrounding=${isNativeGrounding}`);
        const regions = [];
        
        try {
            // 尝试提取 JSON
            let jsonStr = content;
            
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
            console.log('[OcrExtractor] 解析后的数据:', data);
            // Qwen-VL 返回的是数组 [{...}]，Gemini 返回的是对象 {regions: [...]}
            const rawRegions = Array.isArray(data) ? data : (data.regions || data.texts || data.results || []);
            console.log('[OcrExtractor] rawRegions 数量:', rawRegions.length);
            
            rawRegions.forEach((item, idx) => {
                const text = item.text || item.text_content || item.content || '';
                if (!text.trim()) return;
                
                let bbox;
                
                // 调试日志
                console.log(`[OcrExtractor] 解析第 ${idx} 个区域:`, JSON.stringify(item).substring(0, 100));
                
                // 格式1: 原生 Text Grounding (bbox_2d 或 bbox 数组，0-1000 归一化)
                // 格式1: rawRegion 有 bbox_2d 数组
                // Qwen-VL: 像素坐标；Gemini: 0-1000 归一化
                if (Array.isArray(item.bbox_2d) && item.bbox_2d.length === 4) {
                    const [rx1, ry1, rx2, ry2] = item.bbox_2d;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    let x1, y1, x2, y2;
                    
                    if (maxVal > 1000) {
                        // Qwen-VL: 像素坐标，需要用图片尺寸归一化
                        x1 = rx1 / imgWidth;
                        y1 = ry1 / imgHeight;
                        x2 = rx2 / imgWidth;
                        y2 = ry2 / imgHeight;
                        console.log('[LayerEditor] bbox_2d 像素坐标 →', {rx1, ry1, rx2, ry2}, '/', imgWidth, 'x', imgHeight);
                    } else {
                        // Gemini: 0-1000 归一化坐标
                        x1 = rx1 / 1000;
                        y1 = ry1 / 1000;
                        x2 = rx2 / 1000;
                        y2 = ry2 / 1000;
                        console.log(`[OcrExtractor] 网格坐标: "${text.substring(0,15)}..." → (${x1.toFixed(3)},${y1.toFixed(3)})-(${x2.toFixed(3)},${y2.toFixed(3)})`);
                    }
                    // else: 已经是 0-1 归一化坐标
                    
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                }
                // 格式2: 网格辅助 (x1, y1, x2, y2 独立字段)
                // 注意：prompt 要求返回百分比 (0-100)，不是网格刻度
                else if ('x1' in item && 'y1' in item && 'x2' in item && 'y2' in item) {
                    // 检测坐标系统：如果最大值 > 10，说明是百分比 (0-100)
                    const maxCoord = Math.max(item.x1, item.y1, item.x2, item.y2);
                    let divisor = 100; // 默认百分比
                    if (maxCoord <= 10) {
                        divisor = gridX; // 旧格式：网格刻度
                        console.log(`[OcrExtractor] 检测到旧网格刻度格式 (0-${gridX})`);
                    } else {
                        console.log(`[OcrExtractor] 检测到百分比格式 (0-100)`);
                    }
                    
                    const x1 = Math.max(0, Math.min(divisor, item.x1)) / divisor;
                    const y1 = Math.max(0, Math.min(divisor, item.y1)) / divisor;
                    const x2 = Math.max(0, Math.min(divisor, item.x2)) / divisor;
                    const y2 = Math.max(0, Math.min(divisor, item.y2)) / divisor;
                    
                    bbox = {
                        left: x1,
                        top: y1,
                        width: Math.max(0.01, x2 - x1),
                        height: Math.max(0.01, y2 - y1)
                    };
                    
                    console.log(`[OcrExtractor] 坐标转换: "${text.substring(0,15)}..." (${item.x1},${item.y1})-(${item.x2},${item.y2}) ÷${divisor} → (${bbox.left.toFixed(3)},${bbox.top.toFixed(3)},${bbox.width.toFixed(3)},${bbox.height.toFixed(3)})`);
                }
                // 格式3: bbox 数组 [x1, y1, x2, y2] (GLM-4V 等模型)
                // GLM-4V 使用 0-1000 归一化坐标
                else if (Array.isArray(item.bbox) && item.bbox.length === 4) {
                    const [rx1, ry1, rx2, ry2] = item.bbox;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    let x1, y1, x2, y2;
                    
                    if (maxVal > 1000) {
                        // 像素坐标（大于 1000）
                        x1 = rx1 / imgWidth;
                        y1 = ry1 / imgHeight;
                        x2 = rx2 / imgWidth;
                        y2 = ry2 / imgHeight;
                        console.log(`[OcrExtractor] bbox 像素坐标: (${rx1},${ry1})-(${rx2},${ry2}) / ${imgWidth}x${imgHeight}`);
                    } else if (maxVal > 100) {
                        // 0-1000 归一化（GLM-4V 标准格式）
                        x1 = rx1 / 1000; y1 = ry1 / 1000;
                        x2 = rx2 / 1000; y2 = ry2 / 1000;
                        console.log(`[OcrExtractor] bbox 0-1000 归一化: (${rx1},${ry1})-(${rx2},${ry2}) → (${x1.toFixed(3)},${y1.toFixed(3)})-(${x2.toFixed(3)},${y2.toFixed(3)})`);
                    } else if (maxVal > 1) {
                        // 0-100 百分比
                        x1 = rx1 / 100; y1 = ry1 / 100;
                        x2 = rx2 / 100; y2 = ry2 / 100;
                        console.log(`[OcrExtractor] bbox 百分比: (${rx1},${ry1})-(${rx2},${ry2})`);
                    } else {
                        // 已经是 0-1 归一化
                        x1 = rx1; y1 = ry1;
                        x2 = rx2; y2 = ry2;
                        console.log(`[OcrExtractor] bbox 已归一化: (${rx1},${ry1})-(${rx2},${ry2})`);
                    }
                    
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                }
                // 格式4: 旧格式 bbox { left, top, width, height }
                else {
                    const rawBbox = item.bbox || item.box || item.bounds || {};
                    bbox = {
                        left: Math.max(0, Math.min(1, rawBbox.left || rawBbox.x || 0)),
                        top: Math.max(0, Math.min(1, rawBbox.top || rawBbox.y || 0)),
                        width: Math.max(0.01, Math.min(1, rawBbox.width || rawBbox.w || 0.1)),
                        height: Math.max(0.01, Math.min(1, rawBbox.height || rawBbox.h || 0.05))
                    };
                }
                
                // 检查 bbox 是否有效，如果还是数组格式则强制转换
                if (Array.isArray(bbox)) {
                    console.warn(`[OcrExtractor] 区域 ${idx} bbox 仍是数组，强制转换:`, bbox);
                    const [x1, y1, x2, y2] = bbox;
                    const maxVal = Math.max(x1, y1, x2, y2);
                    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;
                    if (maxVal > 10) {
                        nx1 /= 1000; ny1 /= 1000; nx2 /= 1000; ny2 /= 1000;
                    }
                    bbox = {
                        left: nx1,
                        top: ny1,
                        width: Math.max(0.01, nx2 - nx1),
                        height: Math.max(0.01, ny2 - ny1)
                    };
                }
                
                if (!bbox || typeof bbox.left !== 'number') {
                    console.warn(`[OcrExtractor] 区域 ${idx} bbox 无效:`, bbox, item);
                    return; // 跳过无效区域
                }
                
                console.log(`[OcrExtractor] 区域 ${idx} 最终 bbox:`, bbox);
                
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
                    // 保留原始坐标，让 layer-editor 可以进行 fallback 转换
                    x1: item.x1,
                    y1: item.y1,
                    x2: item.x2,
                    y2: item.y2,
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
        
        return { regions, engine: 'vlm', raw: content, gridX, gridY };
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
     * 切换 VLM 定位方案（自动持久化）
     * @param {'grid' | 'native' | 'auto'} mode
     */
    setLocalizationMode(mode) {
        const validModes = ['grid', 'native', 'auto'];
        if (!validModes.includes(mode)) {
            console.error(`[OcrExtractor] 无效的定位方案: ${mode}，可选: ${validModes.join(', ')}`);
            return;
        }
        this.config.vlmLocalizationMode = mode;
        // 持久化到 localStorage
        localStorage.setItem('ocrLocalizationMode', mode);
        console.log(`[OcrExtractor] 定位方案已切换为: ${mode} (已保存)`);
    }
    
    /**
     * 获取当前定位方案
     */
    getLocalizationMode() {
        return this.config.vlmLocalizationMode;
    }
    
    /**
     * 从 localStorage 加载配置
     */
    _loadConfig() {
        const savedMode = localStorage.getItem('ocrLocalizationMode');
        if (savedMode && ['grid', 'native', 'auto'].includes(savedMode)) {
            this.config.vlmLocalizationMode = savedMode;
            console.log(`[OcrExtractor] 已加载保存的定位方案: ${savedMode}`);
        }
    }
    
    async debugGrid(imageUrl = null, gridSize = 10) {
        let imageObj;
        
        if (!imageUrl) {
            // 使用文件选择器
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            
            imageUrl = await new Promise((resolve) => {
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(ev.target.result);
                        reader.readAsDataURL(file);
                    }
                };
                input.click();
            });
        }
        
        // 加载图片获取尺寸
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = imageUrl;
        });
        
        imageObj = {
            dataUrl: imageUrl,
            width: img.width,
            height: img.height,
            element: img
        };
        
        // 生成带网格的图片
        const gridImageUrl = await this._overlayGrid(imageObj, gridSize);
        
        // 在新窗口中显示
        const win = window.open('', '_blank', 'width=1000,height=800');
        win.document.write(`
            <!DOCTYPE html>
            <html>
            <head><title>OCR Grid Preview</title></head>
            <body style="margin:0;background:#222;display:flex;justify-content:center;align-items:center;min-height:100vh;">
                <img src="${gridImageUrl}" style="max-width:95vw;max-height:95vh;box-shadow:0 0 20px rgba(0,0,0,0.5);">
            </body>
            </html>
        `);
        
        console.log(`[OcrExtractor] 网格预览已打开 (${img.width}x${img.height}, ${gridSize}x${gridSize} 网格)`);
        return gridImageUrl;
    }
}

// 单例 & 导出到全局
const ocrExtractor = new OcrExtractor();
window.OcrExtractor = OcrExtractor;
window.ocrExtractor = ocrExtractor;
