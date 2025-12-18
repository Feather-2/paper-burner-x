/**
 * LayerEditor 文字覆盖模块
 * 从 layer-editor.js 拆分出的文字覆盖相关方法
 */

/**
 * 可用的免费商用字体列表
 */
export const AVAILABLE_FONTS = [
    { name: '系统默认', value: 'system-ui, sans-serif', loaded: true },
    { name: '思源黑体', value: '"Noto Sans SC", sans-serif', css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap' },
    { name: '思源宋体', value: '"Noto Serif SC", serif', css: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap' },
    { name: '霞鹜文楷', value: '"LXGW WenKai", cursive', css: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css' },
    { name: '站酷高端黑', value: '"ZCOOL XiaoWei", sans-serif', css: 'https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap' },
    { name: 'Ma Shan Zheng', value: '"Ma Shan Zheng", cursive', css: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap' },
];

// 已加载的字体 CSS
const loadedFontCSSSet = new Set();

/**
 * 加载字体 CSS（懒加载）
 */
export function loadFontCSS(cssUrl) {
    if (loadedFontCSSSet.has(cssUrl)) return Promise.resolve();

    return new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.onload = () => {
            loadedFontCSSSet.add(cssUrl);
            resolve();
        };
        link.onerror = () => resolve(); // 失败也继续
        document.head.appendChild(link);
    });
}

/**
 * 根据 fontFamily 值加载对应字体（懒加载）
 */
export function ensureFontLoaded(fontFamily) {
    if (!fontFamily) return Promise.resolve();
    const fontDef = AVAILABLE_FONTS.find(f => f.value === fontFamily);
    if (fontDef?.css) {
        return loadFontCSS(fontDef.css);
    }
    return Promise.resolve();
}

/**
 * 获取可用字体列表
 */
export function getAvailableFonts() {
    return AVAILABLE_FONTS;
}

/**
 * 文字覆盖 mixin
 */
export const TextOverlayMixin = {
    /**
     * 渲染多选批量操作面板
     */
    _renderMultiSelectPanel(panel, parentLayer, selectedChildren) {
        const count = selectedChildren.length;
        
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:checkbox-checked"></iconify-icon>
                    多选操作 (${count} 个区域)
                </div>
                <div style="font-size:12px;color:var(--ie-text-secondary);margin-bottom:12px;">
                    按住 Ctrl 点击可添加/移除选择
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:move"></iconify-icon>
                    批量调整
                </div>
                <div class="property-row">
                    <span class="property-label">水平偏移 %</span>
                    <input type="number" class="property-input" value="0" data-batch-action="offset-x" style="width:60px;" step="1">
                </div>
                <div class="property-row">
                    <span class="property-label">垂直偏移 %</span>
                    <input type="number" class="property-input" value="0" data-batch-action="offset-y" style="width:60px;" step="1">
                </div>
                <div class="property-row">
                    <span class="property-label">宽度缩放 %</span>
                    <input type="number" class="property-input" value="100" data-batch-action="scale-width" style="width:60px;" step="5" min="10" max="500">
                </div>
                <div class="property-row">
                    <span class="property-label">高度缩放 %</span>
                    <input type="number" class="property-input" value="100" data-batch-action="scale-height" style="width:60px;" step="5" min="10" max="500">
                </div>
                <button class="btn-action" data-batch-action="apply-transform" style="margin-top:8px;">
                    <iconify-icon icon="carbon:checkmark"></iconify-icon>
                    应用调整
                </button>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:tools"></iconify-icon>
                    批量操作
                </div>
                <button class="btn-action" data-batch-action="merge-all">
                    <iconify-icon icon="carbon:group-objects"></iconify-icon>
                    合并选中区域
                </button>
                <button class="btn-action" data-batch-action="inpaint-all" style="margin-top:8px;">
                    <iconify-icon icon="carbon:erase"></iconify-icon>
                    去除选中区域原文字
                </button>
                <button class="btn-action danger" data-batch-action="delete-all" style="margin-top:8px;">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除选中区域
                </button>
            </div>
        `;
        
        this._bindMultiSelectEvents(panel, parentLayer, selectedChildren);
    },
    
    /**
     * 绑定多选操作事件
     */
    _bindMultiSelectEvents(panel, parentLayer, selectedChildren) {
        // 合并区域
        panel.querySelector('[data-batch-action="merge-all"]')?.addEventListener('click', () => {
            if (selectedChildren.length < 2) {
                this._showToast('请至少选择 2 个区域');
                return;
            }

            // 按 top 坐标排序，保证文字顺序合理
            const sorted = [...selectedChildren].sort((a, b) => {
                const topDiff = a.bbox.top - b.bbox.top;
                if (Math.abs(topDiff) > 0.02) return topDiff;
                return a.bbox.left - b.bbox.left;
            });

            // 计算合并后的边界框
            let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
            for (const child of sorted) {
                minLeft = Math.min(minLeft, child.bbox.left);
                minTop = Math.min(minTop, child.bbox.top);
                maxRight = Math.max(maxRight, child.bbox.left + child.bbox.width);
                maxBottom = Math.max(maxBottom, child.bbox.top + child.bbox.height);
            }

            // 合并文字内容
            const mergedText = sorted.map(child => {
                return child.content?.displayText || child.content?.originalText ||
                       child.translatedText || child.text || '';
            }).filter(t => t).join('\n');

            // 使用第一个区域的样式
            const firstChild = sorted[0];
            const mergedRegion = {
                id: `text_${Date.now()}`,
                type: 'text-overlay',
                name: mergedText.slice(0, 20) + (mergedText.length > 20 ? '...' : ''),
                visible: true,
                text: mergedText,
                content: { originalText: mergedText, displayText: mergedText },
                bbox: {
                    left: minLeft,
                    top: minTop,
                    width: maxRight - minLeft,
                    height: maxBottom - minTop
                },
                style: { ...(firstChild.style || {}) },
                inpainted: sorted.every(c => c.inpainted)
            };

            // 删除原区域
            for (const child of selectedChildren) {
                const idx = parentLayer.children.findIndex(c => c.id === child.id);
                if (idx >= 0) parentLayer.children.splice(idx, 1);
            }

            // 添加合并后的区域
            parentLayer.children.push(mergedRegion);
            parentLayer.name = `文字识别 (${parentLayer.children.length} 区域)`;

            // 自动估算字体大小
            this._autoEstimateFontSize(mergedRegion);

            // 选中新区域
            this.selectedChildIndex = parentLayer.children.length - 1;
            this.selectedChildIndices = [];

            this._saveHistory();
            this._updateLayerList();
            this._updatePropertyPanel();
            this._render();
            this._showToast(`已合并 ${selectedChildren.length} 个区域`);
        });

        // 应用变换
        panel.querySelector('[data-batch-action="apply-transform"]')?.addEventListener('click', () => {
            const offsetX = parseFloat(panel.querySelector('[data-batch-action="offset-x"]').value) / 100;
            const offsetY = parseFloat(panel.querySelector('[data-batch-action="offset-y"]').value) / 100;
            const scaleW = parseFloat(panel.querySelector('[data-batch-action="scale-width"]').value) / 100;
            const scaleH = parseFloat(panel.querySelector('[data-batch-action="scale-height"]').value) / 100;
            
            selectedChildren.forEach(child => {
                child.bbox.left = Math.max(0, Math.min(1, child.bbox.left + offsetX));
                child.bbox.top = Math.max(0, Math.min(1, child.bbox.top + offsetY));
                child.bbox.width = Math.max(0.02, Math.min(1, child.bbox.width * scaleW));
                child.bbox.height = Math.max(0.02, Math.min(1, child.bbox.height * scaleH));
                this._autoEstimateFontSize(child);
            });
            
            // 重置输入框
            panel.querySelector('[data-batch-action="offset-x"]').value = 0;
            panel.querySelector('[data-batch-action="offset-y"]').value = 0;
            panel.querySelector('[data-batch-action="scale-width"]').value = 100;
            panel.querySelector('[data-batch-action="scale-height"]').value = 100;
            
            this._saveHistory();
            this._render();
        });
        
        // 批量 Inpaint
        panel.querySelector('[data-batch-action="inpaint-all"]')?.addEventListener('click', async () => {
            for (const child of selectedChildren) {
                if (!child.inpainted) {
                    await this._inpaintTextRegion(child.id, parentLayer.id);
                }
            }
            this._updatePropertyPanel();
        });
        
        // 批量删除
        panel.querySelector('[data-batch-action="delete-all"]')?.addEventListener('click', () => {
            if (!confirm(`确定要删除这 ${selectedChildren.length} 个文字区域吗？`)) return;
            
            selectedChildren.forEach(child => {
                const idx = parentLayer.children.findIndex(c => c.id === child.id);
                if (idx >= 0) {
                    parentLayer.children.splice(idx, 1);
                }
            });
            
            parentLayer.name = `文字识别 (${parentLayer.children.length} 区域)`;
            this.selectedChildIndex = -1;
            this.selectedChildIndices = [];
            
            this._saveHistory();
            this._updateLayerList();
            this._updatePropertyPanel();
            this._render();
        });
    },

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
                    <span class="property-label">字体</span>
                    <select class="property-select" data-text-prop="fontFamily" style="width:120px;">
                        ${AVAILABLE_FONTS.map((f, idx) => {
                            const isSelected = style.fontFamily === f.value || 
                                (idx === 0 && !style.fontFamily);
                            return `<option value="${idx}" ${isSelected ? 'selected' : ''}>${f.name}</option>`;
                        }).join('')}
                    </select>
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
                <button class="btn-action" data-text-action="add-region" style="margin-top:8px;">
                    <iconify-icon icon="carbon:add"></iconify-icon>
                    手动添加区域
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
            if (childLayer.content) {
                childLayer.content.translatedText = e.target.value;
                childLayer.content.displayText = e.target.value || childLayer.content.originalText;
            }
            // 自动重新估算字号
            this._autoEstimateFontSize(childLayer);
            const fontSizeInput = panel.querySelector('[data-text-prop="fontSize"]');
            if (fontSizeInput) fontSizeInput.value = childLayer.style?.fontSize || 14;
            this._render();
            this._saveHistory();
        });
        
        // 字体
        panel.querySelector('[data-text-prop="fontFamily"]')?.addEventListener('change', async (e) => {
            const fontIndex = parseInt(e.target.value);
            const fontDef = AVAILABLE_FONTS[fontIndex];
            if (!fontDef) return;
            
            childLayer.style = childLayer.style || {};
            childLayer.style.fontFamily = fontDef.value;
            
            // 加载字体 CSS
            if (fontDef.css) {
                this._showLoading('加载字体...');
                await loadFontCSS(fontDef.css);
                this._hideLoading();
            }
            
            this._render();
            this._saveHistory();
        });
        
        // 字号
        panel.querySelector('[data-text-prop="fontSize"]')?.addEventListener('change', (e) => {
            childLayer.style = childLayer.style || {};
            childLayer.style.fontSize = parseInt(e.target.value);
            childLayer.style.customFontSize = true; // 标记用户手动设置了字号
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
            if (childLayer.style) {
                delete childLayer.style.customFontSize; // 清除手动标志，允许后续自动估算
            }
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

        // 手动添加区域
        panel.querySelector('[data-text-action="add-region"]')?.addEventListener('click', () => {
            this._startDrawBbox(parentLayer);
        });
    },

    /**
     * 自动估算字号
     */
    _autoEstimateFontSize(childLayer) {
        if (!childLayer.bbox || !this.canvas) return;
        
        const text = childLayer.translatedText || childLayer.text || '';
        if (!text) return;
        
        // 考虑 padding（渲染时有 4px padding）
        const padding = 8; // 左右各 4px
        const boxWidth = Math.max(10, childLayer.bbox.width * this.canvas.width - padding);
        const boxHeight = Math.max(10, childLayer.bbox.height * this.canvas.height - padding);
        
        // 使用 Canvas 测量文字
        const measureCtx = this.ctx || document.createElement('canvas').getContext('2d');
        const fontFamily = childLayer.style?.fontFamily || 'system-ui, sans-serif';
        
        // 二分搜索最佳字号
        let minSize = 8;
        let maxSize = Math.min(72, Math.floor(boxHeight * 0.9));
        let bestSize = minSize;
        
        while (minSize <= maxSize) {
            const midSize = Math.floor((minSize + maxSize) / 2);
            measureCtx.font = `${midSize}px ${fontFamily}`;
            
            // 模拟换行计算实际需要的高度
            const words = text.split('');
            let lines = 1;
            let currentLineWidth = 0;
            
            for (const char of words) {
                const charWidth = measureCtx.measureText(char).width;
                if (currentLineWidth + charWidth > boxWidth && currentLineWidth > 0) {
                    lines++;
                    currentLineWidth = charWidth;
                } else {
                    currentLineWidth += charWidth;
                }
            }
            
            const lineHeight = midSize * 1.4; // 行高
            const totalHeight = lines * lineHeight;
            
            if (totalHeight <= boxHeight * 0.95) { // 留 5% 余量
                bestSize = midSize;
                minSize = midSize + 1;
            } else {
                maxSize = midSize - 1;
            }
        }
        
        childLayer.style = childLayer.style || {};
        childLayer.style.fontSize = Math.max(8, bestSize);
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
     * 开始绘制 bbox 模式
     */
    _startDrawBbox(parentLayer) {
        this.drawBboxMode = true;
        this.drawBboxParent = parentLayer;
        this.canvas.style.cursor = 'crosshair';
        
        // 显示提示
        this._showToast('在画布上拖拽绘制文字区域，按 Esc 取消');
        
        // 如果还没有绑定绘制事件，绑定它
        if (!this._bboxDrawBound) {
            this._bindBboxDrawEvents();
            this._bboxDrawBound = true;
        }
    },

    /**
     * 添加文字区域
     */
    _addTextRegion(bbox) {
        // 优先使用 drawBboxParent（从绘制模式进入）
        // 其次查找现有的 OCR 组（textOverlayConfig 或 ocrGroup）
        let parent = this.drawBboxParent;
        
        if (!parent) {
            parent = this.processedImage.layers.find(
                l => l.type === 'group' && (l.textOverlayConfig || l.ocrGroup)
            );
        }
        
        if (!parent) {
            // 创建新的 OCR 组
            parent = {
                id: `text_group_${Date.now()}`,
                type: 'group',
                name: '文字识别 (0 区域)',
                visible: true,
                expanded: true,
                textOverlayConfig: {
                    engine: 'manual',
                    processedAt: Date.now()
                },
                children: [],
                inpaintedBackground: null
            };
            this.processedImage.layers.push(parent);
        }
        
        // 创建新区域
        const newRegion = {
            id: `text_region_manual_${Date.now()}`,
            type: 'text-overlay',
            name: '新文字区域',
            bbox,
            originalBbox: { ...bbox },
            content: {
                originalText: '',
                translatedText: '',
                displayText: ''
            },
            style: {
                fontSize: 14,
                fontFamily: '"Noto Sans CJK SC", Arial, sans-serif',
                color: '#000000',
                fontWeight: 'normal',
                textAlign: 'left'
            },
            inpainted: false,
            visible: true,
            parentId: parent.id
        };
        
        // 自动估算字号
        this._autoEstimateFontSize(newRegion);
        
        // 添加到父组
        parent.children.push(newRegion);
        parent.name = `文字识别 (${parent.children.length} 区域)`;
        
        // 选中新区域
        const parentIndex = this.processedImage.layers.indexOf(parent);
        const childIndex = parent.children.length - 1;
        
        // 重置绘制模式
        this.drawBboxMode = false;
        this.drawBboxParent = null;
        this.canvas.style.cursor = 'default';
        
        this._saveHistory();
        this._selectChildLayer(parentIndex, childIndex);
        this._updatePropertyPanel();
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
