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
        
        // OCR 专用 prompt
        const prompt = `你是一个精确的 OCR 定位工具。请仔细分析图片，识别所有文字并提供精确的位置坐标。

**重要：坐标系统说明**
- 图片左上角为原点 (0, 0)
- 图片右下角为 (1, 1)
- left: 文字区域左边缘到图片左边缘的距离比例 (0-1)
- top: 文字区域上边缘到图片上边缘的距离比例 (0-1)
- width: 文字区域宽度占图片宽度的比例 (0-1)
- height: 文字区域高度占图片高度的比例 (0-1)

**任务要求**
1. 识别图片中每一处文字（包括标题、正文、标注、箭头旁的文字、图表中的文字等）
2. 为每个文字区域提供精确的边界框坐标（保留3位小数）
3. 边界框应紧贴文字，不要包含过多空白

**输出格式**（严格JSON，不要有其他内容）
{"regions":[
  {"text":"文字内容","bbox":{"left":0.052,"top":0.083,"width":0.215,"height":0.042},"fontSize":24},
  {"text":"另一段文字","bbox":{"left":0.350,"top":0.150,"width":0.180,"height":0.035},"fontSize":16}
]}

**约束**
- 所有坐标值必须在 0-1 之间
- left + width ≤ 1
- top + height ≤ 1
- 请逐一列出所有可见文字`;

        console.log('[OcrExtractor] 使用 AI API Service 进行 VLM OCR');
        
        // 调用统一的 AI API 服务
        const result = await window.aiApiService.analyzeImage(imageObj.dataUrl, prompt, {
            model: 'auto',
            temperature: 0.3,
            maxTokens: 8192
        });
        
        console.log('[OcrExtractor] VLM 响应:', result.content.substring(0, 200) + '...');
        return this._parseVlmResult(result.content, imageObj.width, imageObj.height);
    }
    
    /**
     * 解析 VLM 返回的 JSON 结果
     */
    _parseVlmResult(content, imgWidth, imgHeight) {
        const regions = [];
        
        try {
            // 尝试提取 JSON
            let jsonStr = content;
            
            // 如果包含 markdown 代码块，提取其中的 JSON
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1].trim();
            } else {
                // 尝试找到 JSON 对象
                const braceMatch = content.match(/\{[\s\S]*\}/);
                if (braceMatch) {
                    jsonStr = braceMatch[0];
                }
            }
            
            const data = JSON.parse(jsonStr);
            const rawRegions = data.regions || data.texts || data.results || [];
            
            rawRegions.forEach((item, idx) => {
                const text = item.text || item.content || '';
                if (!text.trim()) return;
                
                let bbox = item.bbox || item.box || item.bounds || {};
                
                // 确保 bbox 格式正确
                if (Array.isArray(bbox)) {
                    bbox = {
                        left: bbox[0],
                        top: bbox[1],
                        width: bbox[2] - bbox[0],
                        height: bbox[3] - bbox[1]
                    };
                }
                
                // 验证并修正 bbox
                bbox = {
                    left: Math.max(0, Math.min(1, bbox.left || bbox.x || 0)),
                    top: Math.max(0, Math.min(1, bbox.top || bbox.y || 0)),
                    width: Math.max(0.01, Math.min(1, bbox.width || bbox.w || 0.1)),
                    height: Math.max(0.01, Math.min(1, bbox.height || bbox.h || 0.05))
                };
                
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

    _parseVlmResult(content, imgWidth, imgHeight) {
        const regions = [];
        try {
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*"regions"[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                (parsed.regions || []).forEach((region, idx) => {
                    regions.push({ id: `text_${idx}`, text: region.text, bbox: region.bbox, style: { fontSize: region.fontSize || 14, color: region.color || '#000000' } });
                });
            }
        } catch (e) { console.warn('[OcrExtractor] 解析失败:', e); }
        return { regions, engine: 'vlm', raw: content };
    }

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
}

// 单例 & 导出到全局
const ocrExtractor = new OcrExtractor();
window.OcrExtractor = OcrExtractor;
window.ocrExtractor = ocrExtractor;
