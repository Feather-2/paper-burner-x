/**
 * LayerEditor 文字覆盖模块
 * 从 layer-editor.js 拆分出的文字覆盖相关方法
 */

/**
 * 文字覆盖 mixin
 */
export const TextOverlayMixin = {
    /**
     * 渲染文字覆盖子图层属性面板
     */
    _renderTextOverlayChildPanel(panel, parentLayer, childLayer) {
        const style = childLayer.style || {};
        const bbox = childLayer.bbox || { left: 0, top: 0, width: 0.1, height: 0.1 };
        
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:text-font"></iconify-icon>
                    文字区域
                </div>
                <div class="property-row block">
                    <span class="property-label">原文</span>
                    <textarea class="property-input" rows="2" readonly style="resize:none;background:#f8fafc;">${childLayer.text || ''}</textarea>
                </div>
                <div class="property-row block">
                    <span class="property-label">译文 / 替换文字</span>
                    <textarea class="property-input" rows="3" data-text-prop="translatedText" style="resize:vertical;">${childLayer.translatedText || ''}</textarea>
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:text-style"></iconify-icon>
                    文字样式
                </div>
                <div class="property-row">
                    <span class="property-label">字号</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="number" class="property-input" value="${style.fontSize || 14}" 
                               data-text-prop="fontSize" style="width:60px;" min="8" max="200">
                        <button class="btn-icon-sm" data-text-action="auto-fontsize" title="自动估算字号">
                            <iconify-icon icon="carbon:magic-wand"></iconify-icon>
                        </button>
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <input type="color" value="${style.color || '#000000'}" data-text-prop="color">
                </div>
                <div class="property-row">
                    <span class="property-label">背景</span>
                    <input type="color" value="${style.backgroundColor?.replace(/[^\d,]/g, '').split(',').slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, '0')).join('') || '#ffffff'}" data-text-prop="backgroundColor">
                </div>
                <div class="property-row">
                    <span class="property-label">对齐</span>
                    <select class="property-select" data-text-prop="textAlign" style="width:100px;">
                        <option value="left" ${style.textAlign === 'left' ? 'selected' : ''}>左对齐</option>
                        <option value="center" ${style.textAlign === 'center' ? 'selected' : ''}>居中</option>
                        <option value="right" ${style.textAlign === 'right' ? 'selected' : ''}>右对齐</option>
                    </select>
                </div>
                <div class="property-row">
                    <span class="property-label">粗体</span>
                    <input type="checkbox" ${style.fontWeight === 'bold' ? 'checked' : ''} data-text-prop="fontWeight">
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:crop"></iconify-icon>
                    位置和大小 (%)
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="property-row" style="margin:0;">
                        <span class="property-label" style="width:20px;">X</span>
                        <input type="number" class="property-input" value="${(bbox.left * 100).toFixed(1)}" 
                               data-text-prop="bbox-left" style="width:60px;" step="0.1" min="0" max="100">
                    </div>
                    <div class="property-row" style="margin:0;">
                        <span class="property-label" style="width:20px;">Y</span>
                        <input type="number" class="property-input" value="${(bbox.top * 100).toFixed(1)}" 
                               data-text-prop="bbox-top" style="width:60px;" step="0.1" min="0" max="100">
                    </div>
                    <div class="property-row" style="margin:0;">
                        <span class="property-label" style="width:20px;">宽</span>
                        <input type="number" class="property-input" value="${(bbox.width * 100).toFixed(1)}" 
                               data-text-prop="bbox-width" style="width:60px;" step="0.1" min="1" max="100">
                    </div>
                    <div class="property-row" style="margin:0;">
                        <span class="property-label" style="width:20px;">高</span>
                        <input type="number" class="property-input" value="${(bbox.height * 100).toFixed(1)}" 
                               data-text-prop="bbox-height" style="width:60px;" step="0.1" min="1" max="100">
                    </div>
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:tools"></iconify-icon>
                    操作
                </div>
                <button class="btn-action" data-text-action="inpaint" ${childLayer.inpainted ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:erase"></iconify-icon>
                    ${childLayer.inpainted ? '已去除原文字' : '去除原文字'}
                </button>
                <button class="btn-action danger" data-text-action="delete" style="margin-top:8px;">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此区域
                </button>
            </div>
        `;
        
        this._bindTextOverlayEvents(panel, parentLayer, childLayer);
    },

    /**
     * 绑定文字覆盖属性事件
     */
    _bindTextOverlayEvents(panel, parentLayer, childLayer) {
        // 译文
        panel.querySelector('[data-text-prop="translatedText"]')?.addEventListener('change', (e) => {
            childLayer.translatedText = e.target.value;
            this._render();
            this._saveHistory();
        });
        
        // 字号
        panel.querySelector('[data-text-prop="fontSize"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.fontSize = parseInt(e.target.value);
            this._render();
            this._saveHistory();
        });
        
        // 颜色
        panel.querySelector('[data-text-prop="color"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.color = e.target.value;
            this._render();
            this._saveHistory();
        });
        
        // 背景色
        panel.querySelector('[data-text-prop="backgroundColor"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.backgroundColor = e.target.value;
            this._render();
            this._saveHistory();
        });
        
        // 对齐
        panel.querySelector('[data-text-prop="textAlign"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.textAlign = e.target.value;
            this._render();
            this._saveHistory();
        });
        
        // 粗体
        panel.querySelector('[data-text-prop="fontWeight"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.fontWeight = e.target.checked ? 'bold' : 'normal';
            this._render();
            this._saveHistory();
        });
        
        // Bbox 位置和大小编辑
        const bboxInputs = ['bbox-left', 'bbox-top', 'bbox-width', 'bbox-height'];
        bboxInputs.forEach(prop => {
            const input = panel.querySelector(`[data-text-prop="${prop}"]`);
            if (!input) return;
            
            input.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value) / 100;
                const key = prop.replace('bbox-', '');
                
                if (key === 'left' || key === 'top') {
                    childLayer.bbox[key] = Math.max(0, Math.min(1, value));
                } else {
                    childLayer.bbox[key] = Math.max(0.01, Math.min(1, value));
                }
                
                this._render();
            });
            
            input.addEventListener('change', () => {
                this._autoEstimateFontSize(childLayer);
                this._render();
                this._saveHistory();
            });
        });
        
        // 自动估算字号
        panel.querySelector('[data-text-action="auto-fontsize"]')?.addEventListener('click', () => {
            this._autoEstimateFontSize(childLayer);
            const fontSizeInput = panel.querySelector('[data-text-prop="fontSize"]');
            if (fontSizeInput) fontSizeInput.value = childLayer.style.fontSize;
            this._render();
            this._saveHistory();
        });
        
        // 去除原文字
        panel.querySelector('[data-text-action="inpaint"]')?.addEventListener('click', async () => {
            await this._inpaintTextRegion(childLayer.id, parentLayer.id);
            this._updatePropertyPanel();
        });
        
        // 删除
        panel.querySelector('[data-text-action="delete"]')?.addEventListener('click', () => {
            if (!confirm('确定要删除这个文字区域吗？')) return;
            
            const idx = parentLayer.children.findIndex(c => c.id === childLayer.id);
            if (idx !== -1) {
                parentLayer.children.splice(idx, 1);
                parentLayer.name = `文字识别 (${parentLayer.children.length} 区域)`;
                this.selectedChildIndex = -1;
                this._saveHistory();
                this._updateLayerList();
                this._updatePropertyPanel();
                this._render();
            }
        });
    },

    /**
     * 自动估算字号
     */
    _autoEstimateFontSize(childLayer) {
        if (!childLayer.bbox) return;
        
        const text = childLayer.translatedText || childLayer.text || '';
        if (!text) return;
        
        const boxWidth = childLayer.bbox.width * this.canvas.width;
        const boxHeight = childLayer.bbox.height * this.canvas.height;
        
        // 使用 Canvas 测量文字
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        
        // 二分搜索最佳字号
        let minSize = 8;
        let maxSize = Math.min(200, boxHeight);
        let bestSize = minSize;
        
        while (minSize <= maxSize) {
            const midSize = Math.floor((minSize + maxSize) / 2);
            measureCtx.font = `${midSize}px sans-serif`;
            
            // 估算所需行数
            const charWidth = measureCtx.measureText('中').width;
            const charsPerLine = Math.floor(boxWidth / charWidth) || 1;
            const lines = Math.ceil(text.length / charsPerLine);
            const lineHeight = midSize * 1.3;
            const totalHeight = lines * lineHeight;
            
            if (totalHeight <= boxHeight) {
                bestSize = midSize;
                minSize = midSize + 1;
            } else {
                maxSize = midSize - 1;
            }
        }
        
        childLayer.style = childLayer.style || {};
        childLayer.style.fontSize = bestSize;
    },

    /**
     * 翻译所有文字
     */
    async _translateAllText(groupLayer) {
        if (!groupLayer.children || groupLayer.children.length === 0) return;
        
        const textRegions = groupLayer.children.filter(c => c.type === 'text-overlay' && c.text);
        if (textRegions.length === 0) {
            this._showToast('没有可翻译的文字');
            return;
        }
        
        this._showLoading('正在翻译...');
        
        try {
            for (const region of textRegions) {
                if (region.translatedText) continue;
                
                // 使用全局翻译函数
                if (typeof window.translateText === 'function') {
                    region.translatedText = await window.translateText(region.text);
                } else {
                    region.translatedText = region.text;
                }
            }
            
            this._saveHistory();
            this._render();
            this._showToast('翻译完成');
        } catch (error) {
            console.error('[LayerEditor] 翻译失败:', error);
            this._showToast('翻译失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 去除所有原文字
     */
    async _inpaintAllRegions(groupLayer) {
        if (!groupLayer.children || groupLayer.children.length === 0) return;
        
        const textRegions = groupLayer.children.filter(c => c.type === 'text-overlay' && !c.inpainted);
        if (textRegions.length === 0) {
            this._showToast('没有需要处理的区域');
            return;
        }
        
        this._showLoading('正在去除原文字...');
        
        try {
            for (const region of textRegions) {
                await this._inpaintTextRegion(region.id, groupLayer.id);
            }
            
            this._showToast('处理完成');
        } catch (error) {
            console.error('[LayerEditor] Inpaint 失败:', error);
            this._showToast('处理失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 添加文字区域
     */
    _addTextRegion(bbox) {
        // 找到或创建 OCR 组
        let ocrGroup = this.processedImage.layers.find(l => l.type === 'group' && l.ocrGroup);
        
        if (!ocrGroup) {
            ocrGroup = {
                id: `ocr_group_${Date.now()}`,
                type: 'group',
                name: '文字识别 (0 区域)',
                ocrGroup: true,
                visible: true,
                expanded: true,
                children: []
            };
            this.processedImage.layers.push(ocrGroup);
        }
        
        // 创建新区域
        const newRegion = {
            id: `text_region_${Date.now()}`,
            type: 'text-overlay',
            text: '',
            translatedText: '',
            bbox,
            visible: true,
            style: {
                fontSize: 14,
                color: '#000000',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                textAlign: 'left',
                fontWeight: 'normal'
            }
        };
        
        ocrGroup.children.push(newRegion);
        ocrGroup.name = `文字识别 (${ocrGroup.children.length} 区域)`;
        
        // 选中新区域
        const parentIndex = this.processedImage.layers.indexOf(ocrGroup);
        const childIndex = ocrGroup.children.length - 1;
        
        this.bboxDrawMode = false;
        this._saveHistory();
        this._selectChildLayer(parentIndex, childIndex);
        this._render();
    },

    /**
     * 导出带文字覆盖的图片
     */
    async _exportWithTextOverlay(groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在导出...');
        
        try {
            // 创建导出 Canvas
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = this.canvas.width;
            exportCanvas.height = this.canvas.height;
            const ctx = exportCanvas.getContext('2d');
            
            // 绘制原始图片
            const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
            if (originalLayer?.image) {
                ctx.drawImage(originalLayer.image, 0, 0);
            }
            
            // 绘制文字覆盖
            for (const child of group.children) {
                if (!child.visible || child.type !== 'text-overlay') continue;
                
                const { bbox, style } = child;
                const text = child.translatedText || child.text || '';
                
                const x = bbox.left * exportCanvas.width;
                const y = bbox.top * exportCanvas.height;
                const w = bbox.width * exportCanvas.width;
                const h = bbox.height * exportCanvas.height;
                
                // 背景
                if (!child.inpainted) {
                    ctx.fillStyle = style?.backgroundColor || 'rgba(255, 255, 255, 0.95)';
                    ctx.fillRect(x, y, w, h);
                }
                
                // 文字
                ctx.fillStyle = style?.color || '#000000';
                ctx.font = `${style?.fontWeight || 'normal'} ${style?.fontSize || 14}px sans-serif`;
                ctx.textAlign = style?.textAlign || 'left';
                ctx.textBaseline = 'top';
                
                // 简单换行
                const lineHeight = (style?.fontSize || 14) * 1.3;
                const words = text.split('');
                let line = '';
                let lineY = y + 4;
                
                for (const char of words) {
                    const testLine = line + char;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > w - 8) {
                        const drawX = style?.textAlign === 'center' ? x + w / 2 :
                                     style?.textAlign === 'right' ? x + w - 4 : x + 4;
                        ctx.fillText(line, drawX, lineY);
                        line = char;
                        lineY += lineHeight;
                    } else {
                        line = testLine;
                    }
                }
                
                if (line) {
                    const drawX = style?.textAlign === 'center' ? x + w / 2 :
                                 style?.textAlign === 'right' ? x + w - 4 : x + 4;
                    ctx.fillText(line, drawX, lineY);
                }
            }
            
            // 下载
            const dataUrl = exportCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = `text-overlay-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
            
            this._showToast('导出成功');
        } catch (error) {
            console.error('[LayerEditor] 导出失败:', error);
            this._showToast('导出失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    }
};
