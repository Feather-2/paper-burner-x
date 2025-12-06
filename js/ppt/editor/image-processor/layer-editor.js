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
        
        // 缩放相关
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 5;
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
                    <button class="image-editor-back" title="返回幻灯片">
                        <iconify-icon icon="carbon:arrow-left"></iconify-icon>
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
                        <iconify-icon icon="carbon:scan-alt"></iconify-icon>
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
                    <div class="image-editor-viewport">
                        <canvas class="image-editor-canvas"></canvas>
                        <div class="image-editor-svg-container"></div>
                    </div>
                    <div class="zoom-indicator">100%</div>
                </div>
                <div class="image-editor-sidebar">
                    <div class="sidebar-section">
                        <div class="sidebar-header">
                            <h4>图层</h4>
                        </div>
                        <div class="layer-list-container">
                            <div class="layer-list"></div>
                        </div>
                        <div class="layer-actions">
                            <button class="btn-add-layer">
                                <iconify-icon icon="carbon:add"></iconify-icon>
                                添加空白图层
                            </button>
                        </div>
                    </div>
                    <div class="sidebar-section">
                        <div class="sidebar-header">
                            <h4>属性</h4>
                        </div>
                        <div class="property-panel-container">
                            <div class="property-panel">
                                <div class="empty-state">选择一个图层以查看属性</div>
                            </div>
                        </div>
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
            :root {
                --ie-primary: #4f46e5;
                --ie-primary-hover: #4338ca;
                --ie-bg: #f8fafc;
                --ie-surface: #ffffff;
                --ie-border: #e2e8f0;
                --ie-text: #1e293b;
                --ie-text-secondary: #64748b;
                --ie-hover: #f1f5f9;
            }
            .image-editor-container {
                position: fixed;
                inset: 0;
                z-index: 10000;
                background-color: #f8fafc;
                background-image:
                    radial-gradient(at 27% 37%, hsla(215, 98%, 61%, 0.08) 0px, transparent 50%),
                    radial-gradient(at 97% 21%, hsla(125, 98%, 72%, 0.06) 0px, transparent 50%),
                    radial-gradient(at 52% 99%, hsla(354, 98%, 61%, 0.05) 0px, transparent 50%),
                    radial-gradient(at 10% 29%, hsla(256, 96%, 67%, 0.07) 0px, transparent 50%),
                    radial-gradient(at 97% 96%, hsla(38, 60%, 74%, 0.06) 0px, transparent 50%),
                    radial-gradient(at 33% 50%, hsla(222, 67%, 73%, 0.06) 0px, transparent 50%),
                    radial-gradient(at 79% 53%, hsla(343, 68%, 79%, 0.06) 0px, transparent 50%);
                display: flex;
                flex-direction: column;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                animation: slideInFromRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes slideInFromRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .image-editor-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 24px;
                height: 64px;
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(20px);
                border-bottom: 1px solid rgba(255, 255, 255, 0.5);
                box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                z-index: 10;
            }
            .image-editor-header-left {
                display: flex;
                align-items: center;
                gap: 16px;
            }
            .image-editor-back {
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                background: transparent;
                border: 1px solid transparent;
                border-radius: 8px;
                color: var(--ie-text-secondary);
                font-size: 18px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .image-editor-back:hover {
                background: var(--ie-hover);
                color: var(--ie-text);
            }
            .image-editor-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--ie-text);
                padding-left: 16px;
                border-left: 1px solid var(--ie-border);
                line-height: 1.2;
            }
            .image-editor-actions {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .image-editor-actions button {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-cancel {
                background: transparent;
                border: 1px solid transparent;
                color: var(--ie-text-secondary);
            }
            .btn-cancel:hover {
                background: var(--ie-hover);
                color: var(--ie-text);
            }
            .btn-apply {
                background: var(--ie-primary);
                border: none;
                color: #ffffff;
                box-shadow: 0 1px 2px rgba(79, 70, 229, 0.3);
            }
            .btn-apply:hover {
                background: var(--ie-primary-hover);
                transform: translateY(-1px);
                box-shadow: 0 4px 6px rgba(79, 70, 229, 0.2);
            }
            .image-editor-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            .image-editor-toolbar {
                width: 64px;
                background: var(--ie-surface);
                border-right: 1px solid var(--ie-border);
                padding: 20px 12px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                z-index: 5;
            }
            .tool-btn {
                width: 40px;
                height: 40px;
                border: none;
                background: transparent;
                border-radius: 8px;
                cursor: pointer;
                font-size: 20px;
                color: #64748b;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                position: relative;
            }
            .tool-btn iconify-icon {
                font-size: 20px;
                color: inherit;
            }
            .tool-btn:hover {
                background: var(--ie-hover);
                color: var(--ie-text);
            }
            .tool-btn.active {
                background: #eef2ff;
                color: var(--ie-primary);
            }
            .tool-btn::after {
                content: attr(title);
                position: absolute;
                left: 100%;
                top: 50%;
                transform: translateY(-50%);
                margin-left: 10px;
                background: #1e293b;
                color: #fff;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s;
                z-index: 100;
            }
            .tool-btn:hover::after {
                opacity: 1;
            }
            .toolbar-divider {
                width: 24px;
                height: 1px;
                background: var(--ie-border);
                margin: 4px 0;
            }
            .image-editor-canvas-wrap {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #f1f5f9;
                background-image: radial-gradient(#cbd5e1 1px, transparent 1px);
                background-size: 20px 20px;
                overflow: hidden;
                position: relative;
                user-select: none;
            }
            .image-editor-viewport {
                position: relative;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                border: 1px solid rgba(0,0,0,0.05);
                background: #fff;
                transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .image-editor-canvas {
                display: block;
            }
            .image-editor-svg-container {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }
            .zoom-indicator {
                position: absolute;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(30, 41, 59, 0.8);
                backdrop-filter: blur(4px);
                color: #fff;
                padding: 6px 16px;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 500;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s;
            }
            .zoom-indicator.visible {
                opacity: 1;
            }
            .image-editor-sidebar {
                width: 320px;
                background: var(--ie-surface);
                border-left: 1px solid var(--ie-border);
                display: flex;
                flex-direction: column;
                z-index: 5;
            }
            .sidebar-section {
                display: flex;
                flex-direction: column;
                border-bottom: 1px solid var(--ie-border);
            }
            .sidebar-section:first-child {
                flex: 1;
                min-height: 0;
                overflow: hidden;
            }
            .sidebar-section:last-child {
                flex: 0 0 auto;
                max-height: 50%;
                overflow: hidden;
                border-bottom: none;
                box-shadow: 0 -1px 2px rgba(0,0,0,0.02);
            }
            .sidebar-header {
                padding: 16px 20px;
                border-bottom: 1px solid var(--ie-border);
                background: #f8fafc;
                flex: 0 0 auto;
            }
            .sidebar-header h4 {
                margin: 0;
                color: var(--ie-text-secondary);
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .layer-list-container {
                flex: 1;
                overflow-y: auto;
                padding: 12px;
            }
            .layer-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .layer-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                background: var(--ie-surface);
                border: 1px solid transparent;
                border-radius: 8px;
                cursor: pointer;
                color: var(--ie-text);
                font-size: 13px;
                transition: all 0.15s;
                user-select: none;
                margin-bottom: 2px;
            }
            .layer-item:hover {
                background: var(--ie-hover);
            }
            .layer-item.selected {
                background: #f0f7ff;
                border-color: #dbeafe;
                color: var(--ie-primary);
                box-shadow: 0 1px 2px rgba(25, 113, 194, 0.05);
            }
            .layer-preview {
                width: 28px;
                height: 28px;
                border-radius: 4px;
                background: #e2e8f0;
                background-size: cover;
                background-position: center;
                border: 1px solid rgba(0,0,0,0.1);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                color: #64748b;
                overflow: hidden;
            }
            .layer-preview.color-preview {
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);
            }
            .layer-visibility {
                width: 24px;
                height: 24px;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 16px;
                color: var(--ie-text-secondary);
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                opacity: 0.6;
            }
            .layer-visibility:hover, .layer-item:hover .layer-visibility {
                background: rgba(0,0,0,0.05);
                color: var(--ie-text);
                opacity: 1;
            }
            .layer-name {
                flex: 1;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .layer-actions {
                padding: 12px;
                border-top: 1px solid var(--ie-border);
            }
            .btn-add-layer {
                width: 100%;
                padding: 8px;
                background: var(--ie-surface);
                border: 1px dashed #cbd5e1;
                border-radius: 6px;
                color: var(--ie-text-secondary);
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
            }
            .btn-add-layer:hover {
                border-color: var(--ie-primary);
                color: var(--ie-primary);
                background: #eef2ff;
            }
            .property-panel-container {
                flex: 1;
                overflow-y: auto;
                background: var(--ie-bg);
            }
            .property-panel {
                padding: 20px;
            }
            .property-group {
                margin-bottom: 24px;
            }
            .property-group-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--ie-text-secondary);
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .property-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }
            .property-row.block {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            .property-label {
                font-size: 13px;
                color: var(--ie-text-secondary);
            }
            .property-input {
                padding: 6px 10px;
                border: 1px solid var(--ie-border);
                border-radius: 6px;
                font-size: 13px;
                color: var(--ie-text);
                background: var(--ie-surface);
                width: 100%;
                transition: border-color 0.2s;
            }
            .property-input:focus {
                outline: none;
                border-color: var(--ie-primary);
                box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
            }
            .property-select {
                padding: 6px 10px;
                border: 1px solid var(--ie-border);
                border-radius: 6px;
                font-size: 13px;
                color: var(--ie-text);
                background: var(--ie-surface);
                width: 100%;
                cursor: pointer;
            }
            .range-wrap {
                width: 100%;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .range-input {
                flex: 1;
                height: 4px;
                background: #e2e8f0;
                border-radius: 2px;
                appearance: none;
            }
            .range-input::-webkit-slider-thumb {
                appearance: none;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: var(--ie-primary);
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .range-value {
                font-size: 12px;
                font-family: monospace;
                color: var(--ie-text-secondary);
                width: 24px;
                text-align: right;
            }
            .btn-action {
                width: 100%;
                padding: 8px;
                background: var(--ie-primary);
                color: #fff;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                margin-top: 8px;
            }
            .btn-action:hover {
                background: var(--ie-primary-hover);
            }
            .empty-state {
                text-align: center;
                color: var(--ie-text-secondary);
                font-size: 13px;
                padding: 40px 20px;
            }
            /* Custom Scrollbar */
            ::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            ::-webkit-scrollbar-track {
                background: transparent;
            }
            ::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 3px;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
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
        
        // 滚轮缩放
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        canvasWrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
            
            if (newScale !== this.scale) {
                this.scale = newScale;
                this._applyScale();
            }
        }, { passive: false });
        
        // 双击重置缩放
        canvasWrap.addEventListener('dblclick', () => {
            this.scale = 1;
            this._applyScale();
        });
    }
    
    /**
     * 应用缩放
     */
    _applyScale() {
        const viewport = this.container?.querySelector('.image-editor-viewport');
        if (viewport) {
            viewport.style.transform = `scale(${this.scale})`;
            viewport.style.transformOrigin = 'center center';
            
            // 更新缩放指示器
            const indicator = this.container.querySelector('.zoom-indicator');
            if (indicator) {
                indicator.textContent = `${Math.round(this.scale * 100)}%`;
                indicator.classList.add('visible');
                
                // 2秒后隐藏
                clearTimeout(this._zoomIndicatorTimeout);
                this._zoomIndicatorTimeout = setTimeout(() => {
                    indicator.classList.remove('visible');
                }, 1500);
            }
        }
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

    async _vectorize(preset = 'auto', options = {}, groupId = null) {
        const vectorizer = await this.processor.loadModule('vectorizer');
        
        // 自动检测预设 (如果是 auto)
        let actualPreset = preset;
        if (preset === 'auto') {
            actualPreset = this._detectPreset({
                element: this.processedImage.original.element,
                width: this.processedImage.original.width,
                height: this.processedImage.original.height
            });
            console.log(`[LayerEditor] 自动选择预设: ${actualPreset}`);
        }
        
        console.log(`[LayerEditor] 矢量化: ${actualPreset}, Group: ${groupId || 'new'}`);
        
        // 获取默认配置
        // 这里我们简单硬编码一些默认值，实际应该从 Presets 获取
        // 为了演示，我们只处理 numColors 和 smoothness
        const finalOptions = {
            numColors: 16,
            smoothness: 1,
            ...options
        };

        // 如果 ImageVectorizer 支持 customConfig，我们可以传入
        // 目前我们先传入 preset，并通过 options 修改 vectorizer 的行为 (如果支持)
        // 这里假设我们修改了 vectorizer.vectorize 方法以支持 options
        // 或者我们暂时只支持 preset 切换
        
        // TODO: 真正的 Vectorizer 应该支持传入 options
        // 现在我们只传递 preset
        const result = await vectorizer.vectorize(this.processedImage.original, actualPreset);
        
        // 生成或使用现有 Group ID
        const currentGroupId = groupId || `vec_group_${Date.now()}`;
        
        // 按颜色分层
        const colorLayers = vectorizer.splitByColor(result);
        
        // 创建编组对象
        const groupLayer = {
            id: currentGroupId,
            type: 'group',
            name: `矢量化分组 (${Object.keys(colorLayers).length} 层)`,
            visible: true,
            vectorConfig: {
                preset: actualPreset,
                numColors: finalOptions.numColors,
                smoothness: finalOptions.smoothness
            },
            children: []
        };

        colorLayers.forEach(layer => {
            const childLayer = {
                ...layer,
                type: 'vector',
                visible: true,
                vectorGroupId: currentGroupId,
                parentId: currentGroupId
            };
            groupLayer.children.push(childLayer);
            // 移除：不再添加到顶层列表，只在组内管理
            // this.processedImage.layers.push(childLayer);
        });
        
        // 修正策略：我们将 groupLayer 作为父节点插入 layers，子节点作为 children 属性存在
        // 渲染时，如果 layer 类型是 group，则递归渲染其 children
        // UI 列表上，只显示 group
        
        this.processedImage.layers.push(groupLayer);

        this._saveHistory();
        this._updateLayerList();
        this._render();
        
        // 自动选中新生成的组
        if (!groupId) {
            const newLayerIndex = this.processedImage.layers.length - 1;
            this.selectedLayerIndex = newLayerIndex;
            this._updateLayerList();
            this._updatePropertyPanel();
        }
    }
    
    async _reVectorize(groupId, newPreset, newOptions) {
        // 找到组图层索引
        const groupIndex = this.processedImage.layers.findIndex(l => l.id === groupId);
        if (groupIndex === -1) return;
        
        // 删除旧组（及其子图层，如果之前是展开存储的）
        // 当前策略：processedImage.layers 中只存 Group，Children 在 Group 内部
        // 所以直接替换这个 Group 即可
        
        // 重新矢量化，传入 groupId 以复用 ID
        // 注意：_vectorize 会 push 新层，我们需要先移除旧的
        this.processedImage.layers.splice(groupIndex, 1);
        
        await this._vectorize(newPreset, newOptions, groupId);
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
        
        // 清空 SVG 容器
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        svgContainer.innerHTML = '';

        // 递归渲染图层函数
        const renderLayer = (layer) => {
            if (!layer.visible) return;

            if (layer.type === 'group') {
                // 渲染组内所有子图层
                layer.children.forEach(child => renderLayer(child));
                return;
            }

            switch (layer.type) {
                case 'original':
                    this.ctx.drawImage(this.processedImage.original.element, 0, 0);
                    break;
                case 'vector':
                    // 矢量图层直接用 SVG 显示（无损）
                    this._renderVectorLayer(layer, svgContainer);
                    break;
                case 'text':
                    this._drawTextLayer(layer);
                    break;
                case 'foreground':
                    this.ctx.putImageData(layer.imageData, 0, 0);
                    break;
            }
        };

        // 绘制可见图层
        for (const layer of this.processedImage.layers) {
            renderLayer(layer);
        }

        // 更新图层列表 (保持选中状态)
        // 注意：_render 会被频繁调用，_updateLayerList 也会重建 DOM，可能导致滚动条跳动
        // 最好只在结构变化时更新列表，或者 _updateLayerList 内部做 diff
        // 这里简单处理：如果正在拖拽或频繁操作，可能不需要每次都重绘列表
        // 但目前逻辑是每次 render 都更新
        this._updateLayerList();
    }

    /**
     * 渲染矢量图层 - 直接插入 SVG（无损显示）
     */
    _renderVectorLayer(layer, container) {
        if (!layer.svg) return;
        
        // 直接插入 SVG 元素
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        wrapper.innerHTML = layer.svg;
        
        // 确保 SVG 填满容器
        const svg = wrapper.querySelector('svg');
        if (svg) {
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
        
        container.appendChild(wrapper);
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
        
        const generateLayerHtml = (layer, idx, level = 0) => {
            let previewHtml = '';
            // 增加层级缩进
            const paddingLeft = level * 20 + 12;
            
            if (layer.type === 'group') {
                previewHtml = `<div class="layer-preview"><iconify-icon icon="carbon:folder"></iconify-icon></div>`;
            } else if (layer.type === 'vector' && layer.color) {
                previewHtml = `<div class="layer-preview color-preview" style="background-color: ${layer.color}"></div>`;
            } else if (layer.type === 'original' || layer.type === 'foreground') {
                previewHtml = `<div class="layer-preview"><iconify-icon icon="carbon:image"></iconify-icon></div>`;
            } else if (layer.type === 'text') {
                previewHtml = `<div class="layer-preview"><iconify-icon icon="carbon:text-font"></iconify-icon></div>`;
            } else {
                previewHtml = `<div class="layer-preview"><iconify-icon icon="carbon:layer"></iconify-icon></div>`;
            }
            
            const isSelected = (idx === this.selectedLayerIndex && level === 0);
            
            let html = `
            <div class="layer-item ${isSelected ? 'selected' : ''}" data-index="${idx}" style="padding-left: ${paddingLeft}px">
                <button class="layer-visibility" title="${layer.visible ? '隐藏' : '显示'}">
                    <iconify-icon icon="${layer.visible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                </button>
                ${previewHtml}
                <span class="layer-name" title="${layer.name}">${layer.name}</span>
            </div>
            `;
            
            // 递归渲染子图层
            if (layer.type === 'group' && layer.children && layer.children.length > 0) {
                html += layer.children.map((child, childIdx) => {
                    let childPreview = `<div class="layer-preview color-preview" style="background-color: ${child.color}"></div>`;
                    const childVisible = child.visible !== false; // 默认为 true
                    
                    return `
                    <div class="layer-item child-layer" data-parent-idx="${idx}" data-child-idx="${childIdx}" style="padding-left: ${paddingLeft + 20}px;">
                        <button class="layer-visibility" title="${childVisible ? '隐藏' : '显示'}">
                            <iconify-icon icon="${childVisible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                        </button>
                        ${childPreview}
                        <span class="layer-name" style="font-size: 12px;">${child.name}</span>
                    </div>
                    `;
                }).join('');
            }
            
            return html;
        };

        list.innerHTML = this.processedImage.layers.map((layer, idx) => generateLayerHtml(layer, idx)).join('');

        // 绑定图层点击
        list.querySelectorAll('.layer-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const isChild = item.classList.contains('child-layer');
                
                // 如果点击的是可见性按钮
                if (e.target.closest('.layer-visibility')) {
                    if (isChild) {
                        const parentIdx = parseInt(item.dataset.parentIdx);
                        const childIdx = parseInt(item.dataset.childIdx);
                        const parent = this.processedImage.layers[parentIdx];
                        if (parent && parent.children && parent.children[childIdx]) {
                            parent.children[childIdx].visible = !parent.children[childIdx].visible;
                            this._render();
                            // 仅更新当前按钮图标
                            const btn = e.target.closest('.layer-visibility').querySelector('iconify-icon');
                            btn.setAttribute('icon', parent.children[childIdx].visible ? 'carbon:view' : 'carbon:view-off');
                        }
                    } else {
                        const idx = parseInt(item.dataset.index);
                        this.processedImage.layers[idx].visible = !this.processedImage.layers[idx].visible;
                        this._render();
                        // 仅更新当前按钮图标
                        const btn = e.target.closest('.layer-visibility').querySelector('iconify-icon');
                        btn.setAttribute('icon', this.processedImage.layers[idx].visible ? 'carbon:view' : 'carbon:view-off');
                    }
                } else if (!isChild) {
                    // 选中顶层图层
                    const idx = parseInt(item.dataset.index);
                    this.selectedLayerIndex = idx;
                    this._updateLayerList();
                    this._updatePropertyPanel();
                }
            });
        });
    }

    _updatePropertyPanel() {
        const panel = this.container.querySelector('.property-panel');
        if (this.selectedLayerIndex < 0) {
            panel.innerHTML = '<div class="empty-state">选择一个图层以查看属性</div>';
            return;
        }

        const layer = this.processedImage.layers[this.selectedLayerIndex];
        
        let content = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:settings"></iconify-icon>
                    基本属性
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${layer.name}" data-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">类型</span>
                    <span style="font-size:12px;color:var(--ie-text-secondary)">${layer.type}</span>
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${layer.visible ? 'checked' : ''} data-prop="visible">
                </div>
            </div>
        `;
        
        // 矢量图层设置 (支持 Group 类型)
        if (layer.type === 'group' && layer.vectorConfig) {
            const config = layer.vectorConfig;
            const presets = this._getPresets();
            
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:tuning"></iconify-icon>
                        矢量化设置 (分组)
                    </div>
                    
                    <div class="property-row block">
                        <span class="property-label">预设</span>
                        <select class="property-select" data-action="update-preset">
                            ${Object.entries(presets).map(([key, label]) => 
                                `<option value="${key}" ${config.preset === key ? 'selected' : ''}>${label}</option>`
                            ).join('')}
                        </select>
                    </div>
                    
                    <div class="property-row block">
                        <span class="property-label">颜色数量 (粗略)</span>
                        <div class="range-wrap">
                            <input type="range" class="range-input" min="2" max="64" value="${config.numColors || 16}" data-action="update-colors">
                            <span class="range-value">${config.numColors || 16}</span>
                        </div>
                    </div>
                    
                    <div class="property-row block">
                        <span class="property-label">平滑度</span>
                        <div class="range-wrap">
                            <input type="range" class="range-input" min="0" max="3" step="0.1" value="${config.smoothness || 1}" data-action="update-smoothness">
                            <span class="range-value">${config.smoothness || 1}</span>
                        </div>
                    </div>
                    
                    <button class="btn-action" data-action="re-vectorize">
                        <iconify-icon icon="carbon:renew"></iconify-icon>
                        重新矢量化
                    </button>
                </div>
            `;
        } else if (layer.type === 'text') {
             content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:text-font"></iconify-icon>
                        文字内容
                    </div>
                    <div class="property-row block">
                        <textarea class="property-input" rows="3" data-prop="content">${layer.content}</textarea>
                    </div>
                </div>
            `;
        }
        
        panel.innerHTML = content;
        
        // 绑定事件
        this._bindPropertyEvents(panel, layer);
    }

    _bindPropertyEvents(panel, layer) {
        // 基本属性
        panel.querySelector('[data-prop="name"]')?.addEventListener('change', (e) => {
            layer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });

        panel.querySelector('[data-prop="visible"]')?.addEventListener('change', (e) => {
            layer.visible = e.target.checked;
            this._render();
            this._updateLayerList();
        });
        
        panel.querySelector('[data-prop="content"]')?.addEventListener('change', (e) => {
            layer.content = e.target.value;
            this._render();
            this._saveHistory();
        });

        // 矢量化设置
        const presetSelect = panel.querySelector('[data-action="update-preset"]');
        if (presetSelect) {
            presetSelect.addEventListener('change', async (e) => {
                if (layer.id) { // 现在使用 layer.id 作为 groupId
                    const btn = panel.querySelector('[data-action="re-vectorize"]');
                    if (btn) btn.textContent = '处理中...';
                    
                    await this._reVectorize(layer.id, e.target.value, layer.vectorConfig);
                }
            });
        }
        
        const reVecBtn = panel.querySelector('[data-action="re-vectorize"]');
        if (reVecBtn) {
            reVecBtn.addEventListener('click', async () => {
                if (layer.id) {
                     reVecBtn.textContent = '处理中...';
                     reVecBtn.disabled = true;
                     
                     const preset = panel.querySelector('[data-action="update-preset"]').value;
                     const numColors = parseInt(panel.querySelector('[data-action="update-colors"]').value);
                     const smoothness = parseFloat(panel.querySelector('[data-action="update-smoothness"]').value);
                     
                     await this._reVectorize(layer.id, preset, { numColors, smoothness });
                }
            });
        }

        // 滑块实时显示
        panel.querySelectorAll('.range-input').forEach(input => {
             input.addEventListener('input', (e) => {
                 e.target.nextElementSibling.textContent = e.target.value;
             });
        });
    }

    _getPresets() {
        return {
            'logo': 'Logo / 图标',
            'illustration': '插画',
            'lineart': '线稿',
            'photo': '照片',
            'pixel': '像素化',
            'simple': '简化'
        };
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
        // 扁平化所有图层用于导出
        const flatLayers = [];
        
        this.processedImage.layers.forEach(layer => {
            if (layer.type === 'group') {
                if (layer.visible) {
                    // 只有当组可见时，才导出其子图层
                    layer.children.forEach(child => {
                        // 继承组的可见性（如果组可见，子图层保持自身可见性）
                        if (child.visible) {
                            flatLayers.push(child);
                        }
                    });
                }
            } else {
                flatLayers.push(layer);
            }
        });
        
        // 检查是否有可见的矢量图层
        const visibleVectorLayers = flatLayers.filter(
            l => l.visible && l.type === 'vector'
        );
        
        let result = {
            id: this.processedImage.id,
            layers: flatLayers // 保存扁平化后的图层结构
        };
        
        if (visibleVectorLayers.length > 0) {
            // 合并所有可见矢量图层为一个 SVG
            const mergedSvg = this._mergeVectorLayers(visibleVectorLayers);
            result.svg = mergedSvg;
            result.type = 'svg';
            
            // 同时生成 PNG 预览（用于缩略图等）
            result.dataUrl = this.canvas.toDataURL('image/png');
        } else {
            // 没有矢量图层，返回 Canvas 截图
            result.dataUrl = this.canvas.toDataURL('image/png');
            result.type = 'image';
        }
        
        // 保存处理结果
        // 注意：我们这里保存的是扁平化后的，还是保持 Group 结构的？
        // 为了以后还能编辑，最好保存包含 Group 的结构。
        // 但是 ImageProcessor.processImage 返回的是扁平的...
        // 这里我们更新 processedImage.layers 为包含 group 的状态以便下次打开编辑
        
        await this.processor.saveProcessedImage(this.processedImage);

        // 回调更新 PPT
        this.onSave?.(result);

        this.close();
    }
    
    /**
     * 合并多个矢量图层为一个 SVG
     */
    _mergeVectorLayers(layers) {
        if (layers.length === 0) return null;
        
        // 从第一个图层获取尺寸
        const firstSvg = layers[0].svg;
        const widthMatch = firstSvg.match(/width="([^"]+)"/);
        const heightMatch = firstSvg.match(/height="([^"]+)"/);
        const viewBoxMatch = firstSvg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : this.canvas.width;
        const height = heightMatch ? heightMatch[1] : this.canvas.height;
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : `0 0 ${width} ${height}`;
        
        // 提取所有图层的 path 内容
        const allPaths = [];
        for (const layer of layers) {
            if (!layer.svg) continue;
            // 提取 <path .../> 或 <path>...</path>
            const pathMatches = layer.svg.match(/<path[^>]*\/?>(?:<\/path>)?/g);
            if (pathMatches) {
                allPaths.push(...pathMatches);
            }
        }
        
        // 生成合并后的 SVG
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">
${allPaths.join('\n')}
</svg>`;
    }

    close() {
        this.container?.remove();
    }
}

// 导出到全局
window.LayerEditor = LayerEditor;
