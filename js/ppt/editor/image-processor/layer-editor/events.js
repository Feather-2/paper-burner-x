/**
 * LayerEditor 事件处理模块
 * 从 layer-editor.js 拆分出的事件绑定方法
 */

/**
 * 事件处理 mixin
 */
export const EventsMixin = {
    /**
     * 绑定事件
     */
    _bindEvents() {
        // 关闭按钮
        this.container.querySelector('.image-editor-back')?.addEventListener('click', () => this.close());
        this.container.querySelector('.btn-cancel')?.addEventListener('click', () => this.close());
        this.container.querySelector('.btn-apply')?.addEventListener('click', () => this._apply());

        // 工具按钮
        this.container.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;
            });
        });

        // 操作按钮
        this.container.querySelector('[data-action="vectorize"]')?.addEventListener('click', () => {
            this._showVectorizePresetDialog();
        });
        this.container.querySelector('[data-action="ocr"]')?.addEventListener('click', () => this._runOcr());
        this.container.querySelector('[data-action="remove-bg"]')?.addEventListener('click', () => this._removeBackground());
        this.container.querySelector('[data-action="sam-segment"]')?.addEventListener('click', () => this._initSamMode());
        this.container.querySelector('[data-action="undo"]')?.addEventListener('click', () => this._undo());
        this.container.querySelector('[data-action="redo"]')?.addEventListener('click', () => this._redo());

        // 画布缩放 - 鼠标滚轮
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        canvasWrap?.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.scale = Math.max(0.1, Math.min(5, this.scale + delta));
            this._applyScale();
        }, { passive: false });

        // 画布拖动（中键或空格+左键）
        let isPanning = false;
        let panStart = { x: 0, y: 0 };
        let viewportPos = { x: 0, y: 0 };

        canvasWrap?.addEventListener('mousedown', (e) => {
            if (e.button === 1 || (e.button === 0 && this.currentTool === 'move')) {
                isPanning = true;
                panStart = { x: e.clientX, y: e.clientY };
                const viewport = this.container.querySelector('.image-editor-viewport');
                const transform = viewport.style.transform;
                const translateMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if (translateMatch) {
                    viewportPos = {
                        x: parseFloat(translateMatch[1]),
                        y: parseFloat(translateMatch[2])
                    };
                }
                e.preventDefault();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isPanning) {
                const dx = e.clientX - panStart.x;
                const dy = e.clientY - panStart.y;
                const viewport = this.container.querySelector('.image-editor-viewport');
                viewport.style.transform = `translate(${viewportPos.x + dx}px, ${viewportPos.y + dy}px) scale(${this.scale})`;
            }
        });

        document.addEventListener('mouseup', () => {
            isPanning = false;
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (!this.container || !document.body.contains(this.container)) return;

            // 元素选择模式优先处理（ESC 退出，Delete 删除选中元素）
            if (this.elementSelectMode) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this._exitElementSelectMode?.();
                    return;
                }
                if (e.key === 'Delete') {
                    e.preventDefault();
                    this._deleteSelectedElements?.();
                    return;
                }
            }

            // Ctrl+Z 撤销
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                this._undo();
            }
            // Ctrl+Y 重做
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault();
                this._redo();
            }
            // Delete 删除选中图层
            if (e.key === 'Delete' && this.selectedLayerIndex >= 0) {
                this._deleteLayer(this.selectedLayerIndex);
            }
            // Escape 取消选择或退出绘制模式
            if (e.key === 'Escape') {
                if (this.drawBboxMode) {
                    this.drawBboxMode = false;
                    this.drawBboxParent = null;
                    this.canvas.style.cursor = 'default';
                    this._showToast('已取消绘制模式');
                } else {
                    this.selectedLayerIndex = -1;
                    this.selectedChildIndex = -1;
                    this._updateLayerList();
                    this._updatePropertyPanel();
                }
            }
        });
        
        // 画布上的 bbox 拖拽调整
        this._bindBboxDragEvents();
    },

    /**
     * 显示矢量化预设选择对话框
     */
    _showVectorizePresetDialog() {
        // 移除已有对话框
        const existing = this.container.querySelector('.vectorize-dialog');
        if (existing) existing.remove();

        const presets = this._getPresets();
        
        const dialog = document.createElement('div');
        dialog.className = 'vectorize-dialog';
        dialog.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            z-index: 1000;
            min-width: 320px;
        `;
        
        dialog.innerHTML = `
            <h3 style="margin:0 0 16px;font-size:16px;font-weight:600;">选择矢量化预设</h3>
            <p style="margin:0 0 16px;font-size:13px;color:#64748b;">根据图片类型选择最合适的预设</p>
            <div class="preset-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                ${Object.entries(presets).map(([key, label]) => `
                    <button class="preset-btn" data-preset="${key}" style="
                        padding: 12px;
                        border: 1px solid #e2e8f0;
                        border-radius: 8px;
                        background: #fff;
                        cursor: pointer;
                        text-align: left;
                        transition: all 0.2s;
                    ">
                        <div style="font-weight:500;font-size:13px;">${label}</div>
                    </button>
                `).join('')}
            </div>
            <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
                <button class="cancel-btn" style="
                    padding: 8px 16px;
                    border: none;
                    background: transparent;
                    color: #64748b;
                    cursor: pointer;
                    border-radius: 6px;
                ">取消</button>
            </div>
        `;
        
        // 绑定事件
        dialog.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.borderColor = '#4f46e5';
                btn.style.background = '#f5f3ff';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.borderColor = '#e2e8f0';
                btn.style.background = '#fff';
            });
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                overlay.remove();
                dialog.remove();
                this._vectorize(preset);
            });
        });
        
        // 点击遮罩关闭
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.3);
            z-index: 999;
        `;
        overlay.addEventListener('click', () => {
            overlay.remove();
            dialog.remove();
        });
        
        dialog.querySelector('.cancel-btn')?.addEventListener('click', () => {
            overlay.remove();
            dialog.remove();
        });
        
        this.container.querySelector('.image-editor-body').appendChild(overlay);
        this.container.querySelector('.image-editor-body').appendChild(dialog);
    },

    /**
     * 绑定 Bbox 绘制事件（手动添加文字区域）
     */
    _bindBboxDrawEvents() {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        if (!svgContainer) return;
        
        let drawState = null;
        
        // 只在绘制模式下才启用
        svgContainer.addEventListener('mousedown', (e) => {
            if (!this.drawBboxMode) return;
            if (e.target.closest('.bbox-handle, .bbox-overlay')) return;
            
            e.preventDefault();
            
            const canvasRect = this.canvas.getBoundingClientRect();
            const startX = (e.clientX - canvasRect.left) / canvasRect.width;
            const startY = (e.clientY - canvasRect.top) / canvasRect.height;
            
            drawState = {
                startX,
                startY,
                currentX: startX,
                currentY: startY
            };
            
            // 创建预览框
            const preview = document.createElement('div');
            preview.className = 'bbox-draw-preview';
            preview.style.cssText = `
                position: absolute;
                border: 2px dashed #4f46e5;
                background: rgba(79, 70, 229, 0.1);
                pointer-events: none;
            `;
            svgContainer.appendChild(preview);
            drawState.preview = preview;
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!drawState) return;
            
            const canvasRect = this.canvas.getBoundingClientRect();
            drawState.currentX = Math.max(0, Math.min(1, (e.clientX - canvasRect.left) / canvasRect.width));
            drawState.currentY = Math.max(0, Math.min(1, (e.clientY - canvasRect.top) / canvasRect.height));
            
            // 更新预览框
            const left = Math.min(drawState.startX, drawState.currentX) * 100;
            const top = Math.min(drawState.startY, drawState.currentY) * 100;
            const width = Math.abs(drawState.currentX - drawState.startX) * 100;
            const height = Math.abs(drawState.currentY - drawState.startY) * 100;
            
            drawState.preview.style.left = `${left}%`;
            drawState.preview.style.top = `${top}%`;
            drawState.preview.style.width = `${width}%`;
            drawState.preview.style.height = `${height}%`;
        });
        
        document.addEventListener('mouseup', () => {
            if (!drawState) return;
            
            // 移除预览框
            drawState.preview?.remove();
            
            // 创建新的文字区域
            const bbox = {
                left: Math.min(drawState.startX, drawState.currentX),
                top: Math.min(drawState.startY, drawState.currentY),
                width: Math.abs(drawState.currentX - drawState.startX),
                height: Math.abs(drawState.currentY - drawState.startY)
            };
            
            // 最小尺寸检查
            if (bbox.width > 0.02 && bbox.height > 0.02) {
                this._addTextRegion(bbox);
            }
            
            drawState = null;
        });
    },

    /**
     * 绑定 bbox 拖拽调整事件
     */
    _bindBboxDragEvents() {
        const canvas = this.canvas;
        let isDragging = false;
        let dragMode = null;
        let dragLayer = null;
        let startPos = { x: 0, y: 0 };
        let startBbox = null;
        
        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };
        
        const hitTest = (pos) => {
            if (this.selectedLayerIndex < 0) return null;
            
            const layer = this.processedImage.layers[this.selectedLayerIndex];
            const isOcrGroup = layer?.type === 'group' && (layer.textOverlayConfig || layer.ocrGroup);
            if (!isOcrGroup) return null;
            
            if (this.selectedChildIndex >= 0) {
                const child = layer.children?.[this.selectedChildIndex];
                if (child && child.type === 'text-overlay') {
                    const hit = this._hitTestBbox(pos, child);
                    if (hit) {
                        hit.childIndex = this.selectedChildIndex;
                        return hit;
                    }
                }
            }
            
            for (let i = layer.children.length - 1; i >= 0; i--) {
                const child = layer.children[i];
                if (child.type === 'text-overlay' && child.visible !== false) {
                    const hit = this._hitTestBbox(pos, child);
                    if (hit) {
                        hit.childIndex = i;
                        return hit;
                    }
                }
            }
            return null;
        };
        
        canvas.addEventListener('mousedown', (e) => {
            const pos = getCanvasPos(e);
            const addToSelection = e.ctrlKey || e.metaKey; // Ctrl 或 Cmd
            
            // 首先检查是否点击了任何文字区域（用于选择）
            const clickedRegion = this._findTextRegionAtPos(pos);
            if (clickedRegion && !isDragging) {
                const { parentIndex, childIndex } = clickedRegion;
                // 多选模式或未选中时进行选择
                if (addToSelection || parentIndex !== this.selectedLayerIndex || 
                    !this._isChildSelected(parentIndex, childIndex)) {
                    this._selectChildLayer(parentIndex, childIndex, addToSelection);
                }
            }
            
            const hit = hitTest(pos);
            
            if (hit) {
                isDragging = true;
                dragMode = hit.type === 'resize' ? `resize-${hit.handle}` : hit.type;
                dragLayer = hit.layer;
                startPos = pos;
                startBbox = { ...dragLayer.bbox };
                
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        // 保存所有选中图层的初始 bbox（用于批量移动）
        let allStartBboxes = [];
        
        canvas.addEventListener('mousemove', (e) => {
            const pos = getCanvasPos(e);
            
            if (isDragging && dragLayer && startBbox) {
                const dx = (pos.x - startPos.x) / canvas.width;
                const dy = (pos.y - startPos.y) / canvas.height;
                
                switch (dragMode) {
                    case 'move':
                        // 批量移动所有选中的图层
                        const selectedChildren = this._getSelectedChildren?.() || [dragLayer];
                        if (selectedChildren.length > 1 && allStartBboxes.length === 0) {
                            // 首次移动时保存所有选中图层的初始 bbox
                            allStartBboxes = selectedChildren.map(c => ({ layer: c, bbox: { ...c.bbox } }));
                        }
                        
                        if (allStartBboxes.length > 1) {
                            // 批量移动
                            allStartBboxes.forEach(({ layer, bbox }) => {
                                layer.bbox.left = Math.max(0, Math.min(1 - bbox.width, bbox.left + dx));
                                layer.bbox.top = Math.max(0, Math.min(1 - bbox.height, bbox.top + dy));
                            });
                        } else {
                            // 单个移动
                            dragLayer.bbox.left = Math.max(0, Math.min(1 - startBbox.width, startBbox.left + dx));
                            dragLayer.bbox.top = Math.max(0, Math.min(1 - startBbox.height, startBbox.top + dy));
                        }
                        break;
                    case 'resize-se':
                        dragLayer.bbox.width = Math.max(0.02, Math.min(1 - startBbox.left, startBbox.width + dx));
                        dragLayer.bbox.height = Math.max(0.02, Math.min(1 - startBbox.top, startBbox.height + dy));
                        break;
                    case 'resize-nw':
                        const newLeft = Math.max(0, Math.min(startBbox.left + startBbox.width - 0.02, startBbox.left + dx));
                        const newTop = Math.max(0, Math.min(startBbox.top + startBbox.height - 0.02, startBbox.top + dy));
                        dragLayer.bbox.width = startBbox.width - (newLeft - startBbox.left);
                        dragLayer.bbox.height = startBbox.height - (newTop - startBbox.top);
                        dragLayer.bbox.left = newLeft;
                        dragLayer.bbox.top = newTop;
                        break;
                    case 'resize-ne':
                        const newTopNE = Math.max(0, Math.min(startBbox.top + startBbox.height - 0.02, startBbox.top + dy));
                        dragLayer.bbox.width = Math.max(0.02, Math.min(1 - startBbox.left, startBbox.width + dx));
                        dragLayer.bbox.height = startBbox.height - (newTopNE - startBbox.top);
                        dragLayer.bbox.top = newTopNE;
                        break;
                    case 'resize-sw':
                        const newLeftSW = Math.max(0, Math.min(startBbox.left + startBbox.width - 0.02, startBbox.left + dx));
                        dragLayer.bbox.width = startBbox.width - (newLeftSW - startBbox.left);
                        dragLayer.bbox.height = Math.max(0.02, Math.min(1 - startBbox.top, startBbox.height + dy));
                        dragLayer.bbox.left = newLeftSW;
                        break;
                    case 'resize-n':
                        const newTopN = Math.max(0, Math.min(startBbox.top + startBbox.height - 0.02, startBbox.top + dy));
                        dragLayer.bbox.height = startBbox.height - (newTopN - startBbox.top);
                        dragLayer.bbox.top = newTopN;
                        break;
                    case 'resize-s':
                        dragLayer.bbox.height = Math.max(0.02, Math.min(1 - startBbox.top, startBbox.height + dy));
                        break;
                    case 'resize-e':
                        dragLayer.bbox.width = Math.max(0.02, Math.min(1 - startBbox.left, startBbox.width + dx));
                        break;
                    case 'resize-w':
                        const newLeftW = Math.max(0, Math.min(startBbox.left + startBbox.width - 0.02, startBbox.left + dx));
                        dragLayer.bbox.width = startBbox.width - (newLeftW - startBbox.left);
                        dragLayer.bbox.left = newLeftW;
                        break;
                }
                
                this._render();
                return;
            }
            
            const hit = hitTest(pos);
            if (hit) {
                if (hit.type === 'move') {
                    canvas.style.cursor = 'move';
                } else if (hit.type === 'resize') {
                    const h = hit.handle;
                    if (h === 'nw' || h === 'se') canvas.style.cursor = 'nwse-resize';
                    else if (h === 'ne' || h === 'sw') canvas.style.cursor = 'nesw-resize';
                    else if (h === 'n' || h === 's') canvas.style.cursor = 'ns-resize';
                    else if (h === 'e' || h === 'w') canvas.style.cursor = 'ew-resize';
                }
            } else {
                canvas.style.cursor = 'default';
            }
        });
        
        const endDrag = () => {
            if (isDragging && dragLayer) {
                // 批量移动时为每个图层重新估算字号
                if (allStartBboxes.length > 1) {
                    allStartBboxes.forEach(({ layer }) => {
                        this._autoEstimateFontSize(layer);
                    });
                } else {
                    this._autoEstimateFontSize(dragLayer);
                }
                this._saveHistory();
                this._updatePropertyPanel();
                this._render();
            }
            isDragging = false;
            dragMode = null;
            dragLayer = null;
            allStartBboxes = []; // 清理批量移动状态
            startBbox = null;
        };
        
        canvas.addEventListener('mouseup', endDrag);
        canvas.addEventListener('mouseleave', endDrag);
    },

    /**
     * 查找指定位置的文字区域
     */
    _findTextRegionAtPos(pos) {
        const layers = this.processedImage?.layers;
        if (!layers) return null;
        
        for (let pi = layers.length - 1; pi >= 0; pi--) {
            const layer = layers[pi];
            // 检查是否为 OCR 组（同时支持 textOverlayConfig 和 ocrGroup）
            const isOcrGroup = layer.type === 'group' && (layer.textOverlayConfig || layer.ocrGroup);
            if (!isOcrGroup || layer.visible === false) continue;
            
            const children = layer.children || [];
            for (let ci = children.length - 1; ci >= 0; ci--) {
                const child = children[ci];
                if (child.type !== 'text-overlay' || child.visible === false) continue;
                
                const bbox = child.bbox;
                const x = pos.x / this.canvas.width;
                const y = pos.y / this.canvas.height;
                
                if (x >= bbox.left && x <= bbox.left + bbox.width &&
                    y >= bbox.top && y <= bbox.top + bbox.height) {
                    return { parentIndex: pi, childIndex: ci, layer: child };
                }
            }
        }
        return null;
    },

    /**
     * 自动估算文字区域的字号
     * 注意：此方法与 text-overlay.js 中的版本保持一致
     */
    _autoEstimateFontSize(textLayer) {
        if (!textLayer || textLayer.type !== 'text-overlay' || !textLayer.bbox || !this.canvas) {
            return;
        }
        
        // 使用正确的属性名（兼容多种数据结构）
        const text = textLayer.translatedText || textLayer.text || textLayer.content?.displayText || '';
        if (!text) return;
        
        // 考虑 padding（渲染时有 4px padding）
        const padding = 8;
        const boxWidth = Math.max(10, textLayer.bbox.width * this.canvas.width - padding);
        const boxHeight = Math.max(10, textLayer.bbox.height * this.canvas.height - padding);
        
        const fontFamily = textLayer.style?.fontFamily || 'system-ui, sans-serif';
        
        // 二分搜索最佳字号
        let minSize = 8;
        let maxSize = Math.min(72, Math.floor(boxHeight * 0.9));
        let bestSize = minSize;
        
        while (minSize <= maxSize) {
            const midSize = Math.floor((minSize + maxSize) / 2);
            this.ctx.font = `${midSize}px ${fontFamily}`;
            
            // 模拟换行计算
            let lines = 1;
            let currentLineWidth = 0;
            
            for (const char of text) {
                const charWidth = this.ctx.measureText(char).width;
                if (currentLineWidth + charWidth > boxWidth && currentLineWidth > 0) {
                    lines++;
                    currentLineWidth = charWidth;
                } else {
                    currentLineWidth += charWidth;
                }
            }
            
            const lineHeight = midSize * 1.4;
            const totalHeight = lines * lineHeight;
            
            if (totalHeight <= boxHeight * 0.95) {
                bestSize = midSize;
                minSize = midSize + 1;
            } else {
                maxSize = midSize - 1;
            }
        }
        
        textLayer.style = textLayer.style || {};
        textLayer.style.fontSize = Math.max(8, bestSize);
    }
};
