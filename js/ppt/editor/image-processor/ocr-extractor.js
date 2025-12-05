/**
 * OCR 文字提取模块
 * 优先级：MinerU > VLM
 */

class OcrExtractor {
    constructor() {
        this.config = {
            priority: 'mineru',
            vlmModel: null,
            language: 'auto'
        };
    }

    isMineruAvailable() {
        try {
            const settings = typeof loadSettings === 'function' ? loadSettings() : {};
            return !!(settings.mineruWorkerUrl && (settings.mineruToken || settings.mineruTokenMode === 'worker'));
        } catch { return false; }
    }

    isVlmAvailable() {
        try {
            const settings = typeof loadSettings === 'function' ? loadSettings() : {};
            const model = settings.translationModel || '';
            const visionModels = ['gpt-4-vision', 'gpt-4o', 'claude-3', 'gemini'];
            return visionModels.some(v => model.toLowerCase().includes(v));
        } catch { return false; }
    }

    async extract(imageObj, options = {}) {
        const priority = options.priority || this.config.priority;

        if (priority === 'mineru' || priority === 'auto') {
            if (this.isMineruAvailable()) {
                try {
                    return await this._extractWithMineru(imageObj, options);
                } catch (e) {
                    console.warn('[OcrExtractor] MinerU 失败:', e);
                    if (this.isVlmAvailable()) {
                        return await this._extractWithVlm(imageObj, options);
                    }
                    throw e;
                }
            }
        }

        if (priority === 'vlm' || priority === 'auto') {
            if (this.isVlmAvailable()) {
                return await this._extractWithVlm(imageObj, options);
            }
        }

        throw new Error('没有可用的 OCR 引擎');
    }

    async _extractWithMineru(imageObj, options) {
        const settings = loadSettings();
        const imageBlob = await this._dataUrlToBlob(imageObj.dataUrl);
        
        const formData = new FormData();
        formData.append('file', imageBlob, 'image.png');
        formData.append('is_ocr', 'true');

        const headers = {};
        if (settings.mineruAuthKey) headers['X-Auth-Key'] = settings.mineruAuthKey;
        if (settings.mineruTokenMode === 'frontend' && settings.mineruToken) {
            headers['X-MinerU-Key'] = settings.mineruToken;
        }

        const response = await fetch(`${settings.mineruWorkerUrl}/mineru/ocr-image`, {
            method: 'POST', headers, body: formData
        });

        if (!response.ok) throw new Error(`MinerU OCR 失败: ${response.status}`);
        const data = await response.json();
        return this._parseMineruResult(data, imageObj.width, imageObj.height);
    }

    async _extractWithVlm(imageObj, options) {
        const settings = loadSettings();
        const prompt = `分析图片中的文字，返回JSON格式：
{"regions":[{"text":"内容","bbox":{"left":0.1,"top":0.2,"width":0.3,"height":0.05},"fontSize":16,"color":"#000"}]}
bbox使用相对坐标(0-1)。只返回JSON。`;

        const apiConfig = this._buildVlmApiConfig(settings);
        const requestBody = {
            model: apiConfig.model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: imageObj.dataUrl, detail: 'high' } }
                ]
            }],
            max_tokens: 4096
        };

        const response = await fetch(apiConfig.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`VLM OCR 失败: ${response.status}`);
        const data = await response.json();
        return this._parseVlmResult(data.choices?.[0]?.message?.content || '', imageObj.width, imageObj.height);
    }

    _buildVlmApiConfig(settings) {
        const model = settings.translationModel || '';
        if (model.includes('gpt-4')) {
            return { endpoint: 'https://api.openai.com/v1/chat/completions', model: model.includes('gpt-4o') ? 'gpt-4o' : 'gpt-4-vision-preview', apiKey: settings.openaiApiKey };
        }
        if (model.includes('claude-3')) {
            return { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-opus-20240229', apiKey: settings.anthropicApiKey };
        }
        if (settings.customModelSettings) {
            return { endpoint: settings.customModelSettings.apiEndpoint || settings.customModelSettings.apiBaseUrl, model: settings.customModelSettings.modelId, apiKey: settings.customApiKey };
        }
        throw new Error('未找到视觉模型配置');
    }

    _parseMineruResult(data, imgWidth, imgHeight) {
        const regions = [];
        const contentList = data.content_list || data.contentList || [];
        
        contentList.forEach((item, idx) => {
            if (item.type === 'text' && item.text && item.bbox) {
                let bbox;
                if (Array.isArray(item.bbox)) {
                    bbox = { left: item.bbox[0] / imgWidth, top: item.bbox[1] / imgHeight, width: (item.bbox[2] - item.bbox[0]) / imgWidth, height: (item.bbox[3] - item.bbox[1]) / imgHeight };
                } else {
                    bbox = { left: item.bbox.left / imgWidth, top: item.bbox.top / imgHeight, width: (item.bbox.right - item.bbox.left) / imgWidth, height: (item.bbox.bottom - item.bbox.top) / imgHeight };
                }
                regions.push({ id: `text_${idx}`, text: item.text, bbox, style: { fontSize: item.fontSize || 14, color: item.color || '#000000' } });
            }
        });
        return { regions, engine: 'mineru', raw: data };
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
