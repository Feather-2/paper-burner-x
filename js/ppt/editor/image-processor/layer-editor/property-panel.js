/**
 * LayerEditor 属性面板模块
 * 从 layer-editor.js 拆分出的属性面板方法
 */

/**
 * 属性面板 mixin
 */
export const PropertyPanelMixin = {
    /**
     * 更新属性面板
     */
    _updatePropertyPanel() {
        const panel = this.container.querySelector('.property-panel');
        if (!panel) return;
        
        // 无选中
        if (this.selectedLayerIndex < 0) {
            panel.innerHTML = '<div class="empty-state">选择一个图层以查看属性</div>';
            return;
        }
        
        const layer = this.processedImage.layers[this.selectedLayerIndex];
        if (!layer) {
            panel.innerHTML = '<div class="empty-state">图层不存在</div>';
            return;
        }
        
        // 如果选中了子图层
        if (this.selectedChildIndex >= 0 && layer.children) {
            const childLayer = layer.children[this.selectedChildIndex];
            if (childLayer) {
                this._renderChildLayerPanel(panel, layer, childLayer);
                return;
            }
        }
        
        // 渲染主图层属性
        this._renderMainLayerPanel(panel, layer);
    },

    /**
     * 渲染主图层属性面板
     */
    _renderMainLayerPanel(panel, layer) {
        if (layer.type === 'original') {
            this._renderOriginalLayerPanel(panel, layer);
        } else if (layer.type === 'group') {
            this._renderGroupLayerPanel(panel, layer);
        } else if (layer.type === 'vector') {
            this._renderVectorLayerPanel(panel, layer);
        } else {
            panel.innerHTML = '<div class="empty-state">未知图层类型</div>';
        }
    },

    /**
     * 渲染原始图层面板
     */
    _renderOriginalLayerPanel(panel, layer) {
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:image"></iconify-icon>
                    原始图片
                </div>
                <div class="property-row">
                    <span class="property-label">尺寸</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">
                        ${this.canvas.width} × ${this.canvas.height}
                    </span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:magic-wand"></iconify-icon>
                    快速操作
                </div>
                <button class="btn-action" data-action="vectorize-from-panel">
                    <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                    矢量化
                </button>
                <button class="btn-action" data-action="ocr-from-panel">
                    <iconify-icon icon="carbon:scan-alt"></iconify-icon>
                    识别文字
                </button>
            </div>
        `;
        
        this._bindPropertyEvents(panel, layer);
    },

    /**
     * 渲染组图层面板
     */
    _renderGroupLayerPanel(panel, layer) {
        const isOcrGroup = layer.ocrGroup;
        const childCount = layer.children?.length || 0;
        
        let content = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="${isOcrGroup ? 'carbon:text-recognition' : 'carbon:folder'}"></iconify-icon>
                    ${isOcrGroup ? '文字识别组' : '矢量组'}
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${layer.name || ''}" data-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">子图层数</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">${childCount}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
        `;
        
        // OCR 组特有操作
        if (isOcrGroup) {
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:translate"></iconify-icon>
                        批量操作
                    </div>
                    <button class="btn-action" data-group-action="translate-all">
                        <iconify-icon icon="carbon:language"></iconify-icon>
                        翻译所有文字
                    </button>
                    <button class="btn-action" data-group-action="inpaint-all">
                        <iconify-icon icon="carbon:erase"></iconify-icon>
                        去除所有原文字
                    </button>
                    <button class="btn-action" data-group-action="export-overlay">
                        <iconify-icon icon="carbon:export"></iconify-icon>
                        导出带文字图片
                    </button>
                    <button class="btn-action" data-group-action="add-region">
                        <iconify-icon icon="carbon:add"></iconify-icon>
                        手动添加区域
                    </button>
                </div>
            `;
        } else {
            // 矢量组操作
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:settings-adjust"></iconify-icon>
                        矢量操作
                    </div>
                    <div class="property-row block">
                        <span class="property-label">全局简化</span>
                        <div class="range-wrap">
                            <input type="range" class="range-input" min="0" max="100" value="${layer.simplifyLevel || 0}" data-group-action="simplify">
                            <span class="range-value">${layer.simplifyLevel || 0}</span>
                        </div>
                    </div>
                    <button class="btn-action" data-group-action="re-vectorize">
                        <iconify-icon icon="carbon:reset"></iconify-icon>
                        重新矢量化
                    </button>
                </div>
            `;
        }
        
        // 删除按钮
        content += `
            <div class="property-group">
                <button class="btn-action danger" data-action="delete-layer">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此组
                </button>
            </div>
        `;
        
        panel.innerHTML = content;
        this._bindPropertyEvents(panel, layer);
        this._bindGroupPropertyEvents(panel, layer);
    },

    /**
     * 渲染矢量图层面板
     */
    _renderVectorLayerPanel(panel, layer) {
        const hexColor = this._toHexColor(layer.color);
        
        panel.innerHTML = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:shape"></iconify-icon>
                    矢量图层
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${layer.name || ''}" data-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <input type="color" value="${hexColor}" data-prop="color">
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible !== false ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
            <div class="property-group">
                <button class="btn-action danger" data-action="delete-layer">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除图层
                </button>
            </div>
        `;
        
        this._bindPropertyEvents(panel, layer);
    },

    /**
     * 绑定属性面板事件
     */
    _bindPropertyEvents(panel, layer) {
        // 名称
        panel.querySelector('[data-prop="name"]')?.addEventListener('change', (e) => {
            layer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });
        
        // 可见性
        panel.querySelector('[data-prop="visible"]')?.addEventListener('change', (e) => {
            layer.visible = e.target.checked;
            this._render();
        });
        
        // 颜色
        panel.querySelector('[data-prop="color"]')?.addEventListener('change', (e) => {
            layer.color = e.target.value;
            if (layer.svg) {
                layer.svg = layer.svg.replace(/fill="[^"]*"/g, `fill="${e.target.value}"`);
            }
            this._render();
            this._saveHistory();
        });
        
        // 删除图层
        panel.querySelector('[data-action="delete-layer"]')?.addEventListener('click', () => {
            this._deleteLayer(this.selectedLayerIndex);
        });
        
        // 从面板触发矢量化
        panel.querySelector('[data-action="vectorize-from-panel"]')?.addEventListener('click', () => {
            this._showVectorizePresetDialog();
        });
        
        // 从面板触发 OCR
        panel.querySelector('[data-action="ocr-from-panel"]')?.addEventListener('click', () => {
            this._runOcr();
        });
    },

    /**
     * 绑定组属性事件
     */
    _bindGroupPropertyEvents(panel, layer) {
        // 简化滑块
        const simplifySlider = panel.querySelector('[data-group-action="simplify"]');
        if (simplifySlider) {
            let timeout = null;
            simplifySlider.addEventListener('input', (e) => {
                const level = parseInt(e.target.value);
                e.target.nextElementSibling.textContent = level;
                
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    layer.simplifyLevel = level;
                    this._applySimplify(layer, level);
                }, 100);
            });
        }
        
        // 重新矢量化
        panel.querySelector('[data-group-action="re-vectorize"]')?.addEventListener('click', () => {
            this._reVectorize(layer);
        });
        
        // OCR 组操作
        panel.querySelector('[data-group-action="translate-all"]')?.addEventListener('click', () => {
            this._translateAllText(layer);
        });
        
        panel.querySelector('[data-group-action="inpaint-all"]')?.addEventListener('click', () => {
            this._inpaintAllRegions(layer);
        });
        
        panel.querySelector('[data-group-action="export-overlay"]')?.addEventListener('click', () => {
            this._exportWithTextOverlay(layer.id);
        });
        
        panel.querySelector('[data-group-action="add-region"]')?.addEventListener('click', () => {
            this.bboxDrawMode = true;
            this._showToast('在画布上拖动绘制文字区域');
        });
    },

    /**
     * 渲染子图层属性面板
     */
    _renderChildLayerPanel(panel, parentLayer, childLayer) {
        // 文字覆盖类型子图层
        if (childLayer.type === 'text-overlay') {
            this._renderTextOverlayChildPanel(panel, parentLayer, childLayer);
            return;
        }
        
        const pathCount = this._countPaths(childLayer.svg);
        const simplifyLevel = childLayer.simplifyLevel || 0;
        const hexColor = this._toHexColor(childLayer.color);
        
        let content = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:shape"></iconify-icon>
                    子图层属性
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${childLayer.name || '路径'}" data-child-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="color" value="${hexColor}" data-child-prop="color" style="width:32px;height:24px;padding:0;border:none;">
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${hexColor}</span>
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">路径数量</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">${pathCount}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${childLayer.visible !== false ? 'checked' : ''} data-child-prop="visible">
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:clean"></iconify-icon>
                    单图层路径简化
                </div>
                <div class="property-row block">
                    <span class="property-label">简化程度</span>
                    <div class="range-wrap">
                        <input type="range" class="range-input" min="0" max="100" value="${simplifyLevel}" data-child-action="simplify">
                        <span class="range-value">${simplifyLevel}</span>
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:-4px">值越大曲线越平滑，0=不简化</small>
                </div>
                <button class="btn-action" data-child-action="reset-simplify">
                    <iconify-icon icon="carbon:reset"></iconify-icon>
                    重置简化
                </button>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:select-01"></iconify-icon>
                    路径编辑
                </div>
                <button class="btn-action" data-child-action="explode-paths" ${pathCount <= 1 ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:assembly-cluster"></iconify-icon>
                    炸开路径 (${pathCount} 个)
                </button>
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                    将多个路径拆分为独立图层，方便单独操作
                </small>
                <button class="btn-action" data-child-action="toggle-path-select" style="margin-top:8px">
                    <iconify-icon icon="carbon:touch-1"></iconify-icon>
                    ${this.pathSelectMode ? '退出路径选择' : '点选删除路径'}
                </button>
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px">
                    点击画布上的路径可以删除单个形状
                </small>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:operations-field"></iconify-icon>
                    图层操作
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn-action" data-child-action="move-up" style="flex:1" ${this.selectedChildIndex >= parentLayer.children.length - 1 ? 'disabled' : ''}>
                        <iconify-icon icon="carbon:arrow-up"></iconify-icon>
                        上移
                    </button>
                    <button class="btn-action" data-child-action="move-down" style="flex:1" ${this.selectedChildIndex <= 0 ? 'disabled' : ''}>
                        <iconify-icon icon="carbon:arrow-down"></iconify-icon>
                        下移
                    </button>
                </div>
                <button class="btn-action danger" data-child-action="delete" ${parentLayer.children.length <= 1 ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此图层
                </button>
            </div>
        `;
        
        panel.innerHTML = content;
        this._bindChildPropertyEvents(panel, parentLayer, childLayer);
    },

    /**
     * 绑定子图层属性事件
     */
    _bindChildPropertyEvents(panel, parentLayer, childLayer) {
        // 名称
        panel.querySelector('[data-child-prop="name"]')?.addEventListener('change', (e) => {
            childLayer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });
        
        // 颜色
        panel.querySelector('[data-child-prop="color"]')?.addEventListener('change', (e) => {
            const newColor = e.target.value;
            childLayer.color = newColor;
            if (childLayer.svg) {
                childLayer.svg = childLayer.svg.replace(/fill="[^"]*"/g, `fill="${newColor}"`);
            }
            this._updateLayerList();
            this._render();
            this._saveHistory();
        });
        
        // 可见性
        panel.querySelector('[data-child-prop="visible"]')?.addEventListener('change', (e) => {
            childLayer.visible = e.target.checked;
            this._updateLayerList();
            this._render();
        });
        
        // 单图层简化滑块
        const simplifySlider = panel.querySelector('[data-child-action="simplify"]');
        if (simplifySlider) {
            let timeout = null;
            simplifySlider.addEventListener('input', (e) => {
                const level = parseInt(e.target.value);
                e.target.nextElementSibling.textContent = level;
                
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    this._applyChildSimplify(childLayer, level, parentLayer);
                }, 100);
            });
        }
        
        // 重置简化
        panel.querySelector('[data-child-action="reset-simplify"]')?.addEventListener('click', () => {
            if (childLayer.originalSvg) {
                childLayer.svg = childLayer.originalSvg;
                childLayer.simplifyLevel = 0;
                this._render();
                this._updatePropertyPanel();
                this._saveHistory();
            }
        });
        
        // 炸开路径
        const explodeBtn = panel.querySelector('[data-child-action="explode-paths"]');
        if (explodeBtn) {
            explodeBtn.addEventListener('click', (e) => {
                if (!e.target.disabled) {
                    this._explodeChildPaths(parentLayer, childLayer);
                }
            });
        }
        
        // 路径选择模式
        panel.querySelector('[data-child-action="toggle-path-select"]')?.addEventListener('click', () => {
            this.pathSelectMode = !this.pathSelectMode;
            this._updatePropertyPanel();
            this._setupPathSelection(childLayer);
        });
        
        // 上移/下移/删除
        panel.querySelector('[data-child-action="move-up"]')?.addEventListener('click', () => {
            this._moveChildLayer(this.selectedLayerIndex, this.selectedChildIndex, 1);
            this._updatePropertyPanel();
        });
        
        panel.querySelector('[data-child-action="move-down"]')?.addEventListener('click', () => {
            this._moveChildLayer(this.selectedLayerIndex, this.selectedChildIndex, -1);
            this._updatePropertyPanel();
        });
        
        panel.querySelector('[data-child-action="delete"]')?.addEventListener('click', () => {
            this._deleteChildLayer(this.selectedLayerIndex, this.selectedChildIndex);
        });
    }
};
