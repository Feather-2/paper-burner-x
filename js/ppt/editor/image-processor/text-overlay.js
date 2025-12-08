/**
 * 文字覆盖层模块
 * 
 * 功能：
 * 1. OCR 识别后的文字区域管理
 * 2. 原始文字去除（Inpainting）
 * 3. 新文字覆盖（带字号自适应）
 * 4. 支持与矢量化集成
 */

class TextOverlayManager {
    constructor(options = {}) {
        this.imageObj = options.imageObj;       // { element, width, height, imageData, dataUrl, canvas, ctx }
        this.regions = [];                       // OCR 识别的文字区域
        this.overlayCanvas = null;              // 文字覆盖层 Canvas
        this.overlayCtx = null;
        this.inpaintedCanvas = null;            // 去除文字后的背景
        this.inpaintedCtx = null;
        
        // 配置
        this.config = {
            bboxShrinkRatio: 0.02,              // bbox 收缩比例
            fontFamily: 'Arial, "Noto Sans CJK SC", sans-serif',
            defaultColor: '#000000',
            minFontSize: 8,
            maxFontSize: 72,
            lineHeightRatio: 1.3,               // 行高倍数
            paddingRatio: 0.05,                 // 文字区域内边距
        };
        
        // 事件回调
        this.onChange = options.onChange || (() => {});
    }

    /**
     * 初始化
     */
    async initialize(imageObj) {
        this.imageObj = imageObj;
        
        // 创建覆盖层 Canvas
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.width = imageObj.width;
        this.overlayCanvas.height = imageObj.height;
        this.overlayCtx = this.overlayCanvas.getContext('2d');
        
        // 创建 inpainted 背景 Canvas
        this.inpaintedCanvas = document.createElement('canvas');
        this.inpaintedCanvas.width = imageObj.width;
        this.inpaintedCanvas.height = imageObj.height;
        this.inpaintedCtx = this.inpaintedCanvas.getContext('2d');
        this.inpaintedCtx.drawImage(imageObj.element, 0, 0);
    }

    /**
     * 从 OCR 结果加载文字区域
     * @param {Object} ocrResult - { regions: [{ id, text, bbox, style }], engine }
     */
    loadFromOcr(ocrResult) {
        this.regions = (ocrResult.regions || []).map((region, idx) => {
            // 收缩 bbox
            const shrunkBbox = this._shrinkBbox(region.bbox);
            
            // 估计字号
            const estimatedFontSize = this._estimateFontSize(shrunkBbox, region.text);
            
            return {
                id: region.id || `text_region_${idx}_${Date.now()}`,
                originalText: region.text,
                translatedText: '',              // 翻译后的文字
                displayText: region.text,        // 当前显示的文字
                bbox: shrunkBbox,
                originalBbox: { ...region.bbox }, // 保存原始 bbox
                style: {
                    fontSize: estimatedFontSize,
                    fontFamily: this.config.fontFamily,
                    color: region.style?.color || this.config.defaultColor,
                    fontWeight: region.style?.fontWeight || 'normal',
                    textAlign: region.style?.textAlign || 'left',
                },
                inpainted: false,                // 是否已去除原始文字
                visible: true,
                editable: true,
            };
        });
        
        return this.regions;
    }

    /**
     * 收缩 bbox（避免覆盖到边缘）
     * @param {Object} bbox - { left, top, width, height } (0-1 归一化坐标)
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
     * @param {Object} bbox - { left, top, width, height }
     * @param {string} text - 文字内容
     */
    _estimateFontSize(bbox, text) {
        const imgWidth = this.imageObj.width;
        const imgHeight = this.imageObj.height;
        
        // bbox 的像素高度
        const bboxHeightPx = bbox.height * imgHeight;
        const bboxWidthPx = bbox.width * imgWidth;
        
        // 判断是否为 CJK 文字
        const isCJK = this._containsCJK(text);
        
        // 估算行数（简单启发式）
        const avgCharWidth = isCJK ? bboxHeightPx * 0.9 : bboxHeightPx * 0.5;
        const estimatedCharsPerLine = Math.floor(bboxWidthPx / avgCharWidth) || 1;
        const estimatedLines = Math.ceil(text.length / estimatedCharsPerLine) || 1;
        
        // 根据行数和高度估算字号
        const lineHeight = bboxHeightPx / estimatedLines;
        const fontSize = lineHeight / this.config.lineHeightRatio;
        
        // 限制范围
        return Math.max(this.config.minFontSize, Math.min(this.config.maxFontSize, Math.round(fontSize)));
    }

    /**
     * 检测是否包含 CJK 字符
     */
    _containsCJK(text) {
        return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
    }

    /**
     * 对指定区域进行 Inpainting（去除原始文字）
     * @param {string} regionId - 区域 ID
     */
    async inpaintRegion(regionId) {
        const region = this.regions.find(r => r.id === regionId);
        if (!region || region.inpainted) return;
        
        const { left, top, width, height } = region.originalBbox;
        const x = Math.floor(left * this.imageObj.width);
        const y = Math.floor(top * this.imageObj.height);
        const w = Math.ceil(width * this.imageObj.width);
        const h = Math.ceil(height * this.imageObj.height);
        
        // 采样背景颜色（从边缘采样）
        const bgColor = this._sampleBackgroundColor(x, y, w, h);
        
        // 用背景色填充（简单 inpainting）
        this.inpaintedCtx.fillStyle = bgColor;
        this.inpaintedCtx.fillRect(x, y, w, h);
        
        region.inpainted = true;
        region.bgColor = bgColor;
        
        this.onChange({ type: 'inpaint', regionId, bgColor });
    }

    /**
     * 对所有区域进行 Inpainting
     */
    async inpaintAllRegions() {
        for (const region of this.regions) {
            await this.inpaintRegion(region.id);
        }
    }

    /**
     * 高级 Inpainting（使用周围像素插值）
     * @param {string} regionId - 区域 ID
     */
    async inpaintRegionAdvanced(regionId) {
        const region = this.regions.find(r => r.id === regionId);
        if (!region) return;
        
        const { left, top, width, height } = region.originalBbox;
        const x = Math.floor(left * this.imageObj.width);
        const y = Math.floor(top * this.imageObj.height);
        const w = Math.ceil(width * this.imageObj.width);
        const h = Math.ceil(height * this.imageObj.height);
        
        // 获取原始 ImageData
        const srcData = this.imageObj.imageData;
        const dstData = this.inpaintedCtx.getImageData(0, 0, this.imageObj.width, this.imageObj.height);
        
        // 使用边缘像素进行双线性插值填充
        this._bilinearInpaint(srcData, dstData, x, y, w, h);
        
        this.inpaintedCtx.putImageData(dstData, 0, 0);
        
        region.inpainted = true;
        this.onChange({ type: 'inpaint_advanced', regionId });
    }

    /**
     * 双线性插值 Inpainting
     */
    _bilinearInpaint(srcData, dstData, x, y, w, h) {
        const imgWidth = this.imageObj.width;
        const imgHeight = this.imageObj.height;
        
        // 采样边缘像素
        const topEdge = [], bottomEdge = [], leftEdge = [], rightEdge = [];
        const sampleWidth = 3; // 采样宽度
        
        for (let i = 0; i < w; i++) {
            // 上边缘
            const topColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                const sy = Math.max(0, y - s);
                const idx = (sy * imgWidth + x + i) * 4;
                topColors.push({ r: srcData.data[idx], g: srcData.data[idx+1], b: srcData.data[idx+2] });
            }
            topEdge.push(this._avgColor(topColors));
            
            // 下边缘
            const bottomColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                const sy = Math.min(imgHeight - 1, y + h + s - 1);
                const idx = (sy * imgWidth + x + i) * 4;
                bottomColors.push({ r: srcData.data[idx], g: srcData.data[idx+1], b: srcData.data[idx+2] });
            }
            bottomEdge.push(this._avgColor(bottomColors));
        }
        
        for (let j = 0; j < h; j++) {
            // 左边缘
            const leftColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                const sx = Math.max(0, x - s);
                const idx = ((y + j) * imgWidth + sx) * 4;
                leftColors.push({ r: srcData.data[idx], g: srcData.data[idx+1], b: srcData.data[idx+2] });
            }
            leftEdge.push(this._avgColor(leftColors));
            
            // 右边缘
            const rightColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                const sx = Math.min(imgWidth - 1, x + w + s - 1);
                const idx = ((y + j) * imgWidth + sx) * 4;
                rightColors.push({ r: srcData.data[idx], g: srcData.data[idx+1], b: srcData.data[idx+2] });
            }
            rightEdge.push(this._avgColor(rightColors));
        }
        
        // 双线性插值填充
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const px = x + i;
                const py = y + j;
                if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) continue;
                
                // 计算插值权重
                const tx = i / Math.max(1, w - 1);
                const ty = j / Math.max(1, h - 1);
                
                // 水平插值
                const leftColor = leftEdge[j] || leftEdge[0];
                const rightColor = rightEdge[j] || rightEdge[0];
                const hColor = this._lerpColor(leftColor, rightColor, tx);
                
                // 垂直插值
                const topColor = topEdge[i] || topEdge[0];
                const bottomColor = bottomEdge[i] || bottomEdge[0];
                const vColor = this._lerpColor(topColor, bottomColor, ty);
                
                // 混合
                const finalColor = this._avgColor([hColor, vColor]);
                
                const idx = (py * imgWidth + px) * 4;
                dstData.data[idx] = finalColor.r;
                dstData.data[idx + 1] = finalColor.g;
                dstData.data[idx + 2] = finalColor.b;
                dstData.data[idx + 3] = 255;
            }
        }
    }

    /**
     * 颜色线性插值
     */
    _lerpColor(c1, c2, t) {
        return {
            r: Math.round(c1.r * (1 - t) + c2.r * t),
            g: Math.round(c1.g * (1 - t) + c2.g * t),
            b: Math.round(c1.b * (1 - t) + c2.b * t),
        };
    }

    /**
     * 平均颜色
     */
    _avgColor(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        const sum = colors.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), { r: 0, g: 0, b: 0 });
        return {
            r: Math.round(sum.r / colors.length),
            g: Math.round(sum.g / colors.length),
            b: Math.round(sum.b / colors.length),
        };
    }

    /**
     * 采样背景颜色（从 bbox 边缘）
     */
    _sampleBackgroundColor(x, y, w, h) {
        const data = this.imageObj.imageData.data;
        const imgWidth = this.imageObj.width;
        const imgHeight = this.imageObj.height;
        const samples = [];
        
        // 从四个边缘外侧采样
        const samplePoints = [
            [Math.max(0, x - 3), y + h / 2],           // 左
            [Math.min(imgWidth - 1, x + w + 3), y + h / 2],  // 右
            [x + w / 2, Math.max(0, y - 3)],           // 上
            [x + w / 2, Math.min(imgHeight - 1, y + h + 3)], // 下
        ];
        
        for (const [sx, sy] of samplePoints) {
            const idx = (Math.floor(sy) * imgWidth + Math.floor(sx)) * 4;
            if (idx >= 0 && idx < data.length - 2) {
                samples.push({ r: data[idx], g: data[idx + 1], b: data[idx + 2] });
            }
        }
        
        if (samples.length === 0) return 'rgb(255,255,255)';
        
        const avg = this._avgColor(samples);
        return `rgb(${avg.r},${avg.g},${avg.b})`;
    }

    /**
     * 更新区域文字
     * @param {string} regionId - 区域 ID
     * @param {string} newText - 新文字
     * @param {boolean} isTranslation - 是否为翻译文字
     */
    updateRegionText(regionId, newText, isTranslation = false) {
        const region = this.regions.find(r => r.id === regionId);
        if (!region) return;
        
        if (isTranslation) {
            region.translatedText = newText;
            region.displayText = newText;
        } else {
            region.originalText = newText;
            if (!region.translatedText) {
                region.displayText = newText;
            }
        }
        
        // 重新估计字号
        region.style.fontSize = this._estimateFontSize(region.bbox, region.displayText);
        
        this.onChange({ type: 'text_update', regionId, text: newText });
    }

    /**
     * 更新区域样式
     */
    updateRegionStyle(regionId, style) {
        const region = this.regions.find(r => r.id === regionId);
        if (!region) return;
        
        Object.assign(region.style, style);
        this.onChange({ type: 'style_update', regionId, style });
    }

    /**
     * 更新区域 bbox
     */
    updateRegionBbox(regionId, bbox) {
        const region = this.regions.find(r => r.id === regionId);
        if (!region) return;
        
        region.bbox = { ...bbox };
        
        // 重新估计字号
        region.style.fontSize = this._estimateFontSize(region.bbox, region.displayText);
        
        this.onChange({ type: 'bbox_update', regionId, bbox });
    }

    /**
     * 渲染所有文字覆盖到 Canvas
     * @param {CanvasRenderingContext2D} ctx - 目标 Canvas 上下文
     * @param {boolean} showBackground - 是否显示 inpainted 背景
     */
    render(ctx, showBackground = true) {
        const imgWidth = this.imageObj.width;
        const imgHeight = this.imageObj.height;
        
        // 先绘制背景（inpainted 或原图）
        if (showBackground) {
            ctx.drawImage(this.inpaintedCanvas, 0, 0);
        }
        
        // 绘制各区域的文字
        for (const region of this.regions) {
            if (!region.visible || !region.displayText) continue;
            
            this._renderRegionText(ctx, region, imgWidth, imgHeight);
        }
    }

    /**
     * 渲染单个区域的文字
     */
    _renderRegionText(ctx, region, imgWidth, imgHeight) {
        const { bbox, displayText, style } = region;
        
        const x = bbox.left * imgWidth;
        const y = bbox.top * imgHeight;
        const w = bbox.width * imgWidth;
        const h = bbox.height * imgHeight;
        
        // 设置字体
        ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
        ctx.fillStyle = style.color;
        ctx.textBaseline = 'top';
        
        // 计算内边距
        const padding = h * this.config.paddingRatio;
        const maxTextWidth = w - padding * 2;
        const textX = x + padding;
        let textY = y + padding;
        
        // 自动换行
        const lines = this._wrapText(ctx, displayText, maxTextWidth);
        const lineHeight = style.fontSize * this.config.lineHeightRatio;
        
        // 如果文字超出，重新计算字号
        const totalTextHeight = lines.length * lineHeight;
        if (totalTextHeight > h - padding * 2) {
            const scale = (h - padding * 2) / totalTextHeight;
            const newFontSize = Math.max(this.config.minFontSize, Math.floor(style.fontSize * scale));
            ctx.font = `${style.fontWeight} ${newFontSize}px ${style.fontFamily}`;
        }
        
        // 绘制每行文字
        for (const line of lines) {
            // 根据对齐方式调整 X 位置
            let lineX = textX;
            if (style.textAlign === 'center') {
                const lineWidth = ctx.measureText(line).width;
                lineX = x + (w - lineWidth) / 2;
            } else if (style.textAlign === 'right') {
                const lineWidth = ctx.measureText(line).width;
                lineX = x + w - padding - lineWidth;
            }
            
            ctx.fillText(line, lineX, textY);
            textY += lineHeight;
        }
    }

    /**
     * 文字换行
     */
    _wrapText(ctx, text, maxWidth) {
        if (!text) return [];
        
        const lines = [];
        const paragraphs = text.split('\n');
        
        for (const para of paragraphs) {
            if (!para) {
                lines.push('');
                continue;
            }
            
            let currentLine = '';
            const isCJK = this._containsCJK(para);
            
            if (isCJK) {
                // CJK：逐字符处理
                for (const char of para) {
                    const testLine = currentLine + char;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = char;
                    } else {
                        currentLine = testLine;
                    }
                }
            } else {
                // 西文：按单词处理
                const words = para.split(/(\s+)/);
                for (const word of words) {
                    const testLine = currentLine + word;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxWidth && currentLine.trim()) {
                        lines.push(currentLine.trim());
                        currentLine = word.trimStart();
                    } else {
                        currentLine = testLine;
                    }
                }
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
        }
        
        return lines.length > 0 ? lines : [''];
    }

    /**
     * 导出为图层数据
     */
    exportAsLayers() {
        return this.regions.map(region => ({
            id: region.id,
            type: 'text-overlay',
            name: `文字: ${region.displayText.substring(0, 15)}${region.displayText.length > 15 ? '...' : ''}`,
            bbox: { ...region.bbox },
            content: {
                originalText: region.originalText,
                translatedText: region.translatedText,
                displayText: region.displayText,
            },
            style: { ...region.style },
            inpainted: region.inpainted,
            visible: region.visible,
        }));
    }

    /**
     * 获取 inpainted 背景图像
     */
    getInpaintedImage() {
        return {
            canvas: this.inpaintedCanvas,
            dataUrl: this.inpaintedCanvas.toDataURL('image/png'),
            imageData: this.inpaintedCtx.getImageData(0, 0, this.imageObj.width, this.imageObj.height),
        };
    }

    /**
     * 获取带文字覆盖的最终图像
     */
    getFinalImage() {
        const canvas = document.createElement('canvas');
        canvas.width = this.imageObj.width;
        canvas.height = this.imageObj.height;
        const ctx = canvas.getContext('2d');
        
        this.render(ctx, true);
        
        return {
            canvas,
            dataUrl: canvas.toDataURL('image/png'),
            imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        };
    }

    /**
     * 批量翻译文字区域
     * @param {Function} translateFn - 翻译函数 (text) => Promise<translatedText>
     */
    async translateAllRegions(translateFn) {
        const results = [];
        
        for (const region of this.regions) {
            if (!region.originalText) continue;
            
            try {
                const translated = await translateFn(region.originalText);
                this.updateRegionText(region.id, translated, true);
                results.push({ id: region.id, success: true, translated });
            } catch (e) {
                console.error(`[TextOverlayManager] 翻译失败: ${region.id}`, e);
                results.push({ id: region.id, success: false, error: e.message });
            }
        }
        
        return results;
    }

    /**
     * 获取区域列表
     */
    getRegions() {
        return this.regions;
    }

    /**
     * 获取指定区域
     */
    getRegion(regionId) {
        return this.regions.find(r => r.id === regionId);
    }

    /**
     * 删除区域
     */
    removeRegion(regionId) {
        const idx = this.regions.findIndex(r => r.id === regionId);
        if (idx !== -1) {
            this.regions.splice(idx, 1);
            this.onChange({ type: 'remove', regionId });
        }
    }

    /**
     * 添加自定义区域
     */
    addRegion(bbox, text = '', style = {}) {
        const region = {
            id: `text_region_custom_${Date.now()}`,
            originalText: text,
            translatedText: '',
            displayText: text,
            bbox: { ...bbox },
            originalBbox: { ...bbox },
            style: {
                fontSize: this._estimateFontSize(bbox, text || '示例'),
                fontFamily: this.config.fontFamily,
                color: this.config.defaultColor,
                fontWeight: 'normal',
                textAlign: 'left',
                ...style,
            },
            inpainted: false,
            visible: true,
            editable: true,
        };
        
        this.regions.push(region);
        this.onChange({ type: 'add', regionId: region.id });
        
        return region;
    }
}

// 导出
window.TextOverlayManager = TextOverlayManager;
