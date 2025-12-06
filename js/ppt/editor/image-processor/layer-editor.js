/**
 * 图层编辑器
 * 用于编辑处理后的图片图层
 */

class LayerEditor {
    constructor(options = {}) {
        this.element = options.element;        // PPT 中的原始图片元素
        this.processor = options.processor;    // ImageProcessor 实例
        this.onSave = options.onSave;          // 保存回调

        this.processedImage = null;
        this.selectedLayerIndex = -1;
        this.container = null;
        this.canvas = null;
        this.ctx = null;

        this.history = [];
        this.historyIndex = -1;
    }

    /**
     * 打开编辑器
     */
    async open() {
        // 创建编辑器 UI
        this._createUI();

        // 加载并处理图片
        await this._loadAndProcess();

        // 渲染
        this._render();
    }

    /**
     * 创建编辑器 UI
     */
    _createUI() {
        // 创建全屏遮罩
        this.container = document.createElement('div');
        this.container.className = 'image-editor-container';
        this.container.innerHTML = `
            <div class="image-editor-header">
                <div class="image-editor-header-left">
                    <button class="image-editor-back">
                        <iconify-icon icon="carbon:arrow-left"></iconify-icon>
                        返回幻灯片
                    </button>
                    <span class="image-editor-title">图片智能编辑</span>
                </div>
                <div class="image-editor-actions">
                    <button class="btn-cancel">取消</button>
                    <button class="btn-apply">
                        <iconify-icon icon="carbon:checkmark"></iconify-icon>
                        应用更改
                    </button>
                </div>
            </div>
            <div class="image-editor-body">
                <div class="image-editor-toolbar">
                    <button class="tool-btn active" data-tool="select" title="选择">
                        <iconify-icon icon="carbon:cursor-1"></iconify-icon>
                    </button>
                    <button class="tool-btn" data-tool="move" title="移动">
                        <iconify-icon icon="carbon:move"></iconify-icon>
                    </button>
                    <div class="toolbar-divider"></div>
                    <button class="tool-btn" data-action="vectorize" title="矢量化分层">
                        <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                    </button>
                    <button class="tool-btn" data-action="ocr" title="识别文字">
                        <iconify-icon icon="carbon:text-recognition"></iconify-icon>
                    </button>
                    <button class="tool-btn" data-action="remove-bg" title="去除背景">
                        <iconify-icon icon="carbon:erase"></iconify-icon>
                    </button>
                    <div class="toolbar-divider"></div>
                    <button class="tool-btn" data-action="undo" title="撤销">
                        <iconify-icon icon="carbon:undo"></iconify-icon>
                    </button>
                    <button class="tool-btn" data-action="redo" title="重做">
                        <iconify-icon icon="carbon:redo"></iconify-icon>
                    </button>
                </div>
                <div class="image-editor-canvas-wrap">
                    <canvas class="image-editor-canvas"></canvas>
                </div>
                <div class="image-editor-sidebar">
                    <div class="sidebar-section">
                        <h4>图层</h4>
                        <div class="layer-list"></div>
                        <div class="layer-actions">
                            <button class="btn-add-layer">+ 添加图层</button>
                        </div>
                    </div>
                    <div class="sidebar-section">
                        <h4>属性</h4>
                        <div class="property-panel"></div>
                    </div>
                </div>
            </div>
        `;

        // 注入样式
        this._injectStyles();

        // 添加到 DOM
        document.body.appendChild(this.container);

        // 获取 canvas
        this.canvas = this.container.querySelector('.image-editor-canvas');
        this.ctx = this.canvas.getContext('2d');

        // 绑定事件
        this._bindEvents();
    }

    /**
     * 注入样式
     */
    _injectStyles() {
        if (document.getElementById('image-editor-styles')) return;

        const style = document.createElement('style');
        style.id = 'image-editor-styles';
        style.textContent = `
            .image-editor-container {
                position: fixed;
                inset: 0;
                z-index: 10000;
                background: #f8fafc;
                display: flex;
                flex-direction: column;
                animation: slideInFromRight 0.3s ease;
            }
            @keyframes slideInFromRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .image-editor-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 24px;
                background: #ffffff;
                border-bottom: 1px solid #e5e7eb;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }
            .image-editor-header-left {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            .image-editor-back {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                background: none;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                color: #374151;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.15s;
            }
            .image-editor-back:hover {
                background: #f3f4f6;
                border-color: #d1d5db;
            }
            .image-editor-title {
                font-size: 18px;
                font-weight: 600;
                color: #111827;
            }
            .image-editor-actions {
                display: flex;
                gap: 12px;
            }
            .image-editor-actions button {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s;
            }
            .btn-cancel {
                background: #ffffff;
                border: 1px solid #e5e7eb;
                color: #374151;
            }
            .btn-cancel:hover {
                background: #f3f4f6;
            }
            .btn-apply {
                background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                border: none;
                color: #ffffff;
                box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
            }
            .btn-apply:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
            }
            .image-editor-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            .image-editor-toolbar {
                width: 72px;
                background: #ffffff;
                border-right: 1px solid #e5e7eb;
                padding: 16px 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .tool-btn {
                width: 48px;
                height: 48px;
                border: none;
                background: none;
                border-radius: 12px;
                cursor: pointer;
                font-size: 20px;
                color: #6b7280;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .tool-btn:hover {
                background: #f3f4f6;
                color: #374151;
            }
            .tool-btn.active {
                background: #eef2ff;
                color: #4f46e5;
            }
            .toolbar-divider {
                height: 1px;
                background: #e5e7eb;
                margin: 8px 0;
            }
            .tool-label {
                font-size: 10px;
                color: #9ca3af;
                text-align: center;
                margin-top: 4px;
            }
            .image-editor-canvas-wrap {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(45deg, #f1f5f9 25%, transparent 25%),
                            linear-gradient(-45deg, #f1f5f9 25%, transparent 25%),
                            linear-gradient(45deg, transparent 75%, #f1f5f9 75%),
                            linear-gradient(-45deg, transparent 75%, #f1f5f9 75%);
                background-size: 20px 20px;
                background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
                background-color: #ffffff;
                overflow: auto;
                padding: 40px;
            }
            .image-editor-canvas {
                box-shadow: 0 4px 24px rgba(0,0,0,0.1);
                border-radius: 8px;
            }
            .image-editor-sidebar {
                width: 300px;
                background: #ffffff;
                border-left: 1px solid #e5e7eb;
                overflow-y: auto;
            }
            .sidebar-section {
                padding: 20px;
                border-bottom: 1px solid #e5e7eb;
            }
            .sidebar-section h4 {
                margin: 0 0 16px 0;
                color: #6b7280;
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .layer-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .layer-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: #f9fafb;
                border: 1px solid transparent;
                border-radius: 10px;
                cursor: pointer;
                color: #374151;
                font-size: 13px;
                transition: all 0.15s;
            }
            .layer-item:hover {
                background: #f3f4f6;
                border-color: #e5e7eb;
            }
            .layer-item.selected {
                background: #eef2ff;
                border-color: #c7d2fe;
                color: #4f46e5;
            }
            .layer-item .layer-visibility {
                width: 24px;
                height: 24px;
                border: none;
                background: none;
                cursor: pointer;
                font-size: 16px;
                color: #9ca3af;
                border-radius: 6px;
                transition: all 0.15s;
            }
            .layer-item .layer-visibility:hover {
                background: #e5e7eb;
                color: #374151;
            }
            .layer-item .layer-name {
                flex: 1;
                font-weight: 500;
            }
            .layer-actions {
                margin-top: 16px;
            }
            .btn-add-layer {
                width: 100%;
                padding: 10px;
                background: #f3f4f6;
                border: 1px dashed #d1d5db;
                border-radius: 8px;
                color: #6b7280;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.15s;
            }
            .btn-add-layer:hover {
                background: #e5e7eb;
                border-color: #9ca3af;
                color: #374151;
            }
            .property-panel {
                color: #374151;
                font-size: 13px;
            }
            .property-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
            }
            .property-row label {
                color: #6b7280;
            }
            .property-row input[type="text"] {
                width: 120px;
                padding: 8px 12px;
                background: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                color: #111827;
                font-size: 13px;
            }
            .property-row input[type="checkbox"] {
                width: 18px;
                height: 18px;
                accent-color: #4f46e5;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 绑定事件
     */
    _bindEvents() {
        // 返回/取消按钮
        this.container.querySelector('.image-editor-back').addEventListener('click', () => this.close());
        this.container.querySelector('.btn-cancel').addEventListener('click', () => this.close());

        // 应用按钮
        this.container.querySelector('.btn-apply').addEventListener('click', () => this._apply());

        // 撤销/重做
        this.container.querySelector('[data-action="undo"]')?.addEventListener('click', () => this._undo());
        this.container.querySelector('[data-action="redo"]')?.addEventListener('click', () => this._redo());

        // 工具按钮
        this.container.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentTool = btn.dataset.tool;
            });
        });

        // 动作按钮
        this.container.querySelectorAll('.tool-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => this._executeAction(btn.dataset.action));
        });
    }

    /**
     * 加载并处理图片
     */
    async _loadAndProcess() {
        const imgSrc = this.element?.src || this.element?.dataset?.src;
        if (!imgSrc) {
            console.error('[LayerEditor] 没有图片源');
            return;
        }

        // 处理图片
        this.processedImage = await this.processor.processImage(imgSrc, {
            vectorize: false,
            ocr: false,
            removeBackground: false
        });

        // 设置 canvas 大小
        this.canvas.width = this.processedImage.original.width;
        this.canvas.height = this.processedImage.original.height;

        // 添加原始图层
        this.processedImage.layers.unshift({
            id: 'layer_original',
            type: 'original',
            name: '原始图片',
            visible: true
        });

        // 保存初始状态
        this._saveHistory();
    }

    /**
     * 执行动作
     */
    async _executeAction(action) {
        switch (action) {
            case 'vectorize':
                await this._vectorize();
                break;
            case 'ocr':
                await this._runOcr();
                break;
            case 'remove-bg':
                await this._removeBackground();
                break;
        }
    }

    async _vectorize() {
        const vectorizer = await this.processor.loadModule('vectorizer');
        
        // 使用 auto 模式，让 PotraceCore 自动分析颜色并选择最佳预设
        console.log(`[LayerEditor] 使用 auto 模式矢量化`);
        
        const result = await vectorizer.vectorize(this.processedImage.original, 'auto');
        
        // 按颜色分层
        const colorLayers = vectorizer.splitByColor(result);
        
        colorLayers.forEach(layer => {
            this.processedImage.layers.push({
                ...layer,
                type: 'vector',
                visible: true
            });
        });

        this._saveHistory();
        this._updateLayerList();
        this._render();
    }

    async _runOcr() {
        const ocrExtractor = await this.processor.loadModule('ocrExtractor');
        const result = await ocrExtractor.extract(this.processedImage.original);

        result.regions.forEach((region, idx) => {
            this.processedImage.layers.push({
                id: `layer_text_${idx}_${Date.now()}`,
                type: 'text',
                name: `文字: ${region.text.substring(0, 10)}...`,
                bbox: region.bbox,
                content: region.text,
                style: region.style,
                visible: true
            });
        });

        this._saveHistory();
        this._updateLayerList();
        this._render();
    }

    async _removeBackground() {
        const bgRemover = await this.processor.loadModule('bgRemover');
        const result = await bgRemover.remove(this.processedImage.original);

        this.processedImage.layers.push({
            id: `layer_fg_${Date.now()}`,
            type: 'foreground',
            name: '前景（已去背景）',
            imageData: result.foreground,
            visible: true
        });

        this._saveHistory();
        this._updateLayerList();
        this._render();
    }

    /**
     * 自动检测图片类型，选择合适的矢量化预设
     * @param {Object} imageObj - 图片对象 { element, width, height }
     * @returns {string} 预设名称
     */
    _detectPreset(imageObj) {
        // 采样图片获取颜色统计
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const sampleSize = Math.min(100, imageObj.width, imageObj.height);
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        ctx.drawImage(imageObj.element, 0, 0, sampleSize, sampleSize);
        
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = imageData.data;
        
        // 使用更粗的量化（32级 = 每8个值合并）来避免渐变产生伪颜色
        const colorSet = new Set();
        for (let i = 0; i < data.length; i += 4) {
            const r = Math.floor(data[i] / 32);
            const g = Math.floor(data[i + 1] / 32);
            const b = Math.floor(data[i + 2] / 32);
            colorSet.add(`${r},${g},${b}`);
        }
        
        const uniqueColors = colorSet.size;
        console.log(`[LayerEditor] 检测到约 ${uniqueColors} 种颜色（粗量化）`);
        
        // 根据颜色数量选择预设
        // 对于低颜色数量图片，强制使用 lineart（高容差二值化）
        if (uniqueColors <= 8) {
            return 'lineart';      // 简单图形都用二值化
        } else if (uniqueColors <= 24) {
            return 'logo';         // Logo/简单图形
        } else if (uniqueColors <= 64) {
            return 'illustration'; // 插画
        } else {
            return 'photo';        // 照片
        }
    }

    /**
     * 渲染
     */
    _render() {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        // 绘制透明背景网格
        this._drawCheckerboard();

        // 绘制可见图层
        for (const layer of this.processedImage.layers) {
            if (!layer.visible) continue;

            switch (layer.type) {
                case 'original':
                    this.ctx.drawImage(this.processedImage.original.element, 0, 0);
                    break;
                case 'vector':
                    this._drawVectorLayer(layer);
                    break;
                case 'text':
                    this._drawTextLayer(layer);
                    break;
                case 'foreground':
                    this.ctx.putImageData(layer.imageData, 0, 0);
                    break;
            }
        }

        // 更新图层列表
        this._updateLayerList();
    }

    _drawCheckerboard() {
        const size = 10;
        const { width, height } = this.canvas;
        for (let y = 0; y < height; y += size) {
            for (let x = 0; x < width; x += size) {
                this.ctx.fillStyle = ((x + y) / size) % 2 === 0 ? '#ccc' : '#fff';
                this.ctx.fillRect(x, y, size, size);
            }
        }
    }

    _drawVectorLayer(layer) {
        if (!layer.svg) return;
        
        // 如果已经有缓存的图片，直接绘制
        if (layer._cachedImage && layer._cachedImage.complete) {
            this.ctx.drawImage(layer._cachedImage, 0, 0);
            return;
        }
        
        // 否则创建新的图片并缓存
        const img = new Image();
        img.onload = () => {
            layer._cachedImage = img;
            this.ctx.drawImage(img, 0, 0);
        };
        img.onerror = (e) => {
            console.error('[LayerEditor] SVG 加载失败:', e);
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(layer.svg);
    }

    _drawTextLayer(layer) {
        const { bbox, content, style } = layer;
        const x = bbox.left * this.canvas.width;
        const y = bbox.top * this.canvas.height;
        const w = bbox.width * this.canvas.width;
        const h = bbox.height * this.canvas.height;

        // 绘制文字框
        this.ctx.strokeStyle = '#4f46e5';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 3]);
        this.ctx.strokeRect(x, y, w, h);
        this.ctx.setLineDash([]);

        // 绘制文字标签
        this.ctx.fillStyle = '#4f46e5';
        this.ctx.font = '12px sans-serif';
        this.ctx.fillText(content.substring(0, 20), x, y - 5);
    }

    _updateLayerList() {
        const list = this.container.querySelector('.layer-list');
        list.innerHTML = this.processedImage.layers.map((layer, idx) => `
            <div class="layer-item ${idx === this.selectedLayerIndex ? 'selected' : ''}" data-index="${idx}">
                <button class="layer-visibility">${layer.visible ? '👁' : '👁‍🗨'}</button>
                <span class="layer-name">${layer.name}</span>
            </div>
        `).join('');

        // 绑定图层点击
        list.querySelectorAll('.layer-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('layer-visibility')) {
                    const idx = parseInt(item.dataset.index);
                    this.processedImage.layers[idx].visible = !this.processedImage.layers[idx].visible;
                    this._render();
                } else {
                    this.selectedLayerIndex = parseInt(item.dataset.index);
                    this._updateLayerList();
                    this._updatePropertyPanel();
                }
            });
        });
    }

    _updatePropertyPanel() {
        const panel = this.container.querySelector('.property-panel');
        if (this.selectedLayerIndex < 0) {
            panel.innerHTML = '<p style="color:#6c7086">选择一个图层</p>';
            return;
        }

        const layer = this.processedImage.layers[this.selectedLayerIndex];
        panel.innerHTML = `
            <div class="property-row">
                <span>名称</span>
                <input type="text" value="${layer.name}" data-prop="name">
            </div>
            <div class="property-row">
                <span>类型</span>
                <span>${layer.type}</span>
            </div>
            <div class="property-row">
                <span>可见</span>
                <input type="checkbox" ${layer.visible ? 'checked' : ''} data-prop="visible">
            </div>
        `;
    }

    _saveHistory() {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(JSON.stringify(this.processedImage.layers));
        this.historyIndex = this.history.length - 1;
    }

    _undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.processedImage.layers = JSON.parse(this.history[this.historyIndex]);
            this._render();
        }
    }

    _redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.processedImage.layers = JSON.parse(this.history[this.historyIndex]);
            this._render();
        }
    }

    async _apply() {
        // 合成最终图片
        const dataUrl = this.canvas.toDataURL('image/png');
        
        // 保存处理结果
        await this.processor.saveProcessedImage(this.processedImage);

        // 回调更新 PPT
        this.onSave?.({
            id: this.processedImage.id,
            dataUrl,
            layers: this.processedImage.layers
        });

        this.close();
    }

    close() {
        this.container?.remove();
    }
}

// 导出到全局
window.LayerEditor = LayerEditor;
