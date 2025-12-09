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
            // Escape 取消选择
            if (e.key === 'Escape') {
                this.selectedLayerIndex = -1;
                this.selectedChildIndex = -1;
                this._updateLayerList();
                this._updatePropertyPanel();
            }
        });
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
            if (!this.bboxDrawMode) return;
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
            if (!layer || layer.type !== 'group' || !layer.textOverlayConfig) return null;
            
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
            const hit = hitTest(pos);
            
            if (hit) {
                isDragging = true;
                dragMode = hit.type === 'resize' ? `resize-${hit.handle}` : hit.type;
                dragLayer = hit.layer;
                startPos = pos;
                startBbox = { ...dragLayer.bbox };
                
                if (hit.childIndex !== undefined && hit.childIndex !== this.selectedChildIndex) {
                    this._selectChildLayer(this.selectedLayerIndex, hit.childIndex);
                }
                
                e.preventDefault();
                e.stopPropagation();
            }
        });
        
        canvas.addEventListener('mousemove', (e) => {
            const pos = getCanvasPos(e);
            
            if (isDragging && dragLayer && startBbox) {
                const dx = (pos.x - startPos.x) / canvas.width;
                const dy = (pos.y - startPos.y) / canvas.height;
                
                switch (dragMode) {
                    case 'move':
                        dragLayer.bbox.left = Math.max(0, Math.min(1 - startBbox.width, startBbox.left + dx));
                        dragLayer.bbox.top = Math.max(0, Math.min(1 - startBbox.height, startBbox.top + dy));
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
                this._autoEstimateFontSize(dragLayer);
                this._saveHistory();
                this._updatePropertyPanel();
                this._render();
            }
            isDragging = false;
            dragMode = null;
            dragLayer = null;
            startBbox = null;
        };
        
        canvas.addEventListener('mouseup', endDrag);
        canvas.addEventListener('mouseleave', endDrag);
    },

    /**
     * 自动估算文字区域的字号
     */
    _autoEstimateFontSize(textLayer) {
        if (!textLayer || textLayer.type !== 'text-overlay' || !textLayer.bbox || !textLayer.content?.displayText) {
            return;
        }
        
        const { width, height } = textLayer.bbox;
        const text = textLayer.content.displayText;
        
        const bboxWidthPx = width * this.canvas.width;
        const bboxHeightPx = height * this.canvas.height;
        
        // 二分搜索最佳字号
        const fontFamily = textLayer.style?.fontFamily || '"Noto Sans CJK SC", Arial, sans-serif';
        const lineHeightRatio = 1.3;
        
        let minSize = 8, maxSize = 72;
        let bestSize = 14;
        
        while (maxSize - minSize > 1) {
            const testSize = (minSize + maxSize) / 2;
            this.ctx.font = `${testSize}px ${fontFamily}`;
            
            // 简单换行估算
            const lines = [];
            let currentLine = '';
            for (const char of text) {
                const testLine = currentLine + char;
                if (this.ctx.measureText(testLine).width > bboxWidthPx - bboxHeightPx * 0.1 && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) lines.push(currentLine);
            
            const totalHeight = lines.length * testSize * lineHeightRatio;
            
            if (totalHeight <= bboxHeightPx * 0.9) {
                minSize = testSize;
                bestSize = testSize;
            } else {
                maxSize = testSize;
            }
        }
        
        textLayer.style = textLayer.style || {};
        textLayer.style.fontSize = Math.round(bestSize);
        console.log(`[LayerEditor] 自动估算字号: "${text.substring(0, 10)}..." -> ${textLayer.style.fontSize}px`);
    }
};
