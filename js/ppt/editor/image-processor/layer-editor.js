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
        
        // 加载状态
        this._loadingOverlay = null;
        
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
                
                <!-- Left Panel: Layers -->
                <div class="image-editor-panel panel-left" id="ieLayerPanel">
                    <div class="panel-header">
                        <h4>图层</h4>
                        <button class="btn-icon-sm" title="添加空白图层">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                        </button>
                    </div>
                    <div class="layer-list-container">
                        <div class="layer-list"></div>
                    </div>
                </div>
                
                <div class="sidebar-resizer-v" id="ieLeftResizer"></div>

                <!-- Center: Canvas -->
                <div class="image-editor-canvas-wrap">
                    <div class="image-editor-viewport">
                        <canvas class="image-editor-canvas"></canvas>
                        <div class="image-editor-svg-container"></div>
                    </div>
                    <div class="zoom-indicator">100%</div>
                </div>

                <!-- Right Panel: Properties -->
                <div class="sidebar-resizer-v" id="ieRightResizer"></div>
                <div class="image-editor-panel panel-right" id="iePropertyPanel">
                    <div class="panel-header">
                        <h4>属性</h4>
                    </div>
                    <div class="property-panel-container">
                        <div class="property-panel">
                            <div class="empty-state">选择一个图层以查看属性</div>
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
        
        // 绑定面板交互
        this._bindPanelResizer();
        this._bindPropertyPanelBehavior();
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
                --ie-radius: 6px;
                --ie-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            }
            /* Global Reset for Editor */
            .image-editor-container * {
                box-sizing: border-box;
            }
            .image-editor-container iconify-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                vertical-align: middle;
            }
            
            .image-editor-container {
                position: fixed;
                inset: 0;
                z-index: 10000;
                background-color: var(--ie-bg);
                display: flex;
                flex-direction: column;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: var(--ie-text);
                animation: ie-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            
            @keyframes ie-slide-in {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }

            /* Header */
            .image-editor-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 16px;
                height: 56px;
                background: rgba(255, 255, 255, 0.9);
                backdrop-filter: blur(8px);
                border-bottom: 1px solid var(--ie-border);
                z-index: 20;
                flex-shrink: 0;
            }
            
            .image-editor-header-left {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            /* Body Layout */
            .image-editor-body {
                flex: 1;
                display: flex;
                overflow: hidden;
                position: relative;
            }
            
            /* Toolbar */
            .image-editor-toolbar {
                width: 56px;
                background: var(--ie-surface);
                border-right: 1px solid var(--ie-border);
                padding: 16px 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                z-index: 10;
                flex-shrink: 0;
            }
            
            .tool-btn {
                width: 36px;
                height: 36px;
                border-radius: var(--ie-radius);
                border: 1px solid transparent;
                background: transparent;
                color: var(--ie-text-secondary);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                transition: all 0.2s;
            }
            .tool-btn:hover {
                background: var(--ie-hover);
                color: var(--ie-text);
            }
            .tool-btn.active {
                background: var(--ie-primary);
                color: #fff;
                box-shadow: 0 2px 5px rgba(79, 70, 229, 0.3);
            }
            .toolbar-divider {
                width: 24px;
                height: 1px;
                background: var(--ie-border);
                margin: 4px 0;
            }
            
            /* Panels (Left & Right) */
            .image-editor-panel {
                width: 240px; 
                background: var(--ie-surface);
                display: flex;
                flex-direction: column;
                z-index: 10;
                flex-shrink: 0;
                transition: opacity 0.3s; 
            }
            
            .panel-left { border-right: 1px solid var(--ie-border); }
            .panel-right { border-left: 1px solid var(--ie-border); width: 280px; }
            
            /* Resizer */
            .sidebar-resizer-v {
                width: 1px;
                background: transparent;
                cursor: col-resize;
                z-index: 30;
                position: relative;
                flex-shrink: 0;
                transition: background 0.2s;
                /* Hit area expansion */
                padding: 0 4px; 
                margin: 0 -4px;
                background-clip: content-box;
            }
            .sidebar-resizer-v:hover, .sidebar-resizer-v.dragging {
                background-color: var(--ie-primary);
            }

            .panel-header {
                height: 40px;
                padding: 0 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid var(--ie-border);
                background: #fcfcfc;
                flex-shrink: 0;
            }
            
            .panel-header h4 {
                margin: 0;
                font-size: 12px;
                font-weight: 600;
                color: var(--ie-text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            /* Canvas Area */
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
                box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.2);
                background: #fff;
                transition: transform 0.1s cubic-bezier(0, 0, 0.2, 1);
            }
            
            .zoom-indicator {
                position: absolute;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.75);
                color: white;
                padding: 4px 12px;
                border-radius: 100px;
                font-size: 12px;
                font-weight: 500;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s;
                backdrop-filter: blur(4px);
            }
            .zoom-indicator.visible { opacity: 1; }
            
            /* Layer List */
            .layer-list-container {
                flex: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 8px;
            }
            
            .layer-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 6px 8px;
                background: transparent;
                border: 1px solid transparent;
                border-radius: var(--ie-radius);
                cursor: pointer;
                color: var(--ie-text);
                font-size: 13px;
                transition: all 0.15s;
                user-select: none;
                margin-bottom: 2px;
                height: 44px; /* Slightly taller for better touch */
            }
            
            .layer-item:hover { background: var(--ie-hover); }
            
            .layer-item.selected {
                background: #eff6ff;
                border-color: #dbeafe;
                color: var(--ie-primary);
            }
            
            .layer-preview {
                width: 30px;
                height: 30px;
                border-radius: 4px;
                background: #f1f5f9;
                border: 1px solid rgba(0,0,0,0.06);
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                color: #94a3b8;
                overflow: hidden;
            }
            .layer-preview img { width: 100%; height: 100%; object-fit: contain; }
            .layer-preview.color-preview { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); }
            
            .layer-name {
                flex: 1;
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                min-width: 0; /* Flexbox overflow fix */
            }
            
            /* Child Layer Styling */
            .layer-item.child-layer {
                height: 32px;
                padding-left: 0; /* Reset padding, margin handled by container */
                margin-left: 2px;
                border-left: 2px solid transparent;
                border-radius: 0 var(--ie-radius) var(--ie-radius) 0;
            }
            .layer-item.child-layer .layer-preview {
                width: 20px;
                height: 20px;
                font-size: 12px;
            }
            .layer-item.child-layer.selected {
                border-left-color: var(--ie-primary);
            }

            .child-layer-container {
                padding-left: 24px;
                position: relative;
            }
            .child-layer-container::before {
                content: '';
                position: absolute;
                left: 14px;
                top: 0;
                bottom: 12px;
                width: 2px;
                background: var(--ie-border);
                opacity: 0.5;
            }
            
            /* Property Panel */
            .property-panel-container {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                background: #fff;
            }
            
            .property-group {
                margin-bottom: 24px;
                border-bottom: 1px solid var(--ie-border);
                padding-bottom: 16px;
            }
            .property-group:last-child { border-bottom: none; }
            
            .property-group-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--ie-text-secondary);
                text-transform: uppercase;
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            
            .property-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
                gap: 12px;
            }
            .property-row.block {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            
            .property-label {
                font-size: 13px;
                color: var(--ie-text);
            }
            
            .property-input, .property-select {
                width: 100%;
                padding: 8px;
                border: 1px solid var(--ie-border);
                border-radius: var(--ie-radius);
                font-size: 13px;
                background: #fff;
                transition: border-color 0.2s;
            }
            .property-input:focus, .property-select:focus {
                border-color: var(--ie-primary);
                outline: none;
                box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
            }
            
            /* Header Buttons */
            .image-editor-back { 
                width: 32px; height: 32px; padding: 0; background: transparent; 
                border: 1px solid var(--ie-border); color: var(--ie-text-secondary); 
                border-radius: var(--ie-radius); display: flex; align-items: center; justify-content: center;
                cursor: pointer; transition: all 0.2s;
            }
            .image-editor-back:hover { background: var(--ie-hover); color: var(--ie-text); border-color: var(--ie-text-secondary); }
            
            .image-editor-title { 
                font-size: 15px;
                font-weight: 600;
                color: var(--ie-text); 
                margin-left: 8px;
            }
            
            .image-editor-actions { display: flex; gap: 8px; }
            
            .btn-cancel { 
                padding: 8px 16px; 
                background: transparent; 
                border: 1px solid transparent; 
                color: var(--ie-text-secondary); 
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--ie-radius);
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-cancel:hover { background: var(--ie-hover); color: var(--ie-text); }
            
            .btn-apply { 
                padding: 8px 16px; 
                background: var(--ie-primary);
                border: 1px solid transparent;
                color: white;
                font-size: 13px;
                font-weight: 500;
                border-radius: var(--ie-radius);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
                box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);
            }
            .btn-apply:hover { 
                background: var(--ie-primary-hover);
                transform: translateY(-1px);
                box-shadow: 0 4px 6px rgba(79, 70, 229, 0.3);
            }
            
            .btn-action { 
                width: 100%; padding: 10px; 
                background: #fff; color: var(--ie-text); 
                border: 1px solid var(--ie-border); 
                border-radius: var(--ie-radius); 
                font-size: 13px; font-weight: 500; 
                cursor: pointer; margin-top: 8px; 
                display: flex; align-items: center; justify-content: center; gap: 6px; 
                transition: all 0.2s;
            }
            .btn-action:hover { border-color: var(--ie-primary); color: var(--ie-primary); background: #fdfdff; }
            
            /* Sliders */
            .range-wrap { width: 100%; display: flex; align-items: center; gap: 12px; }
            .range-input { flex: 1; height: 6px; background: var(--ie-hover); border-radius: 3px; appearance: none; border: 1px solid var(--ie-border); }
            .range-input::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid var(--ie-primary); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.1s; }
            .range-input::-webkit-slider-thumb:hover { transform: scale(1.1); }
            .range-value { font-size: 12px; font-family: monospace; color: var(--ie-text-secondary); width: 32px; text-align: right; }
            
            .layer-visibility { 
                width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; 
                font-size: 16px; color: var(--ie-text-secondary); border-radius: 4px; 
                display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: all 0.2s; 
            }
            .layer-visibility:hover, .layer-item:hover .layer-visibility { background: rgba(0,0,0,0.05); color: var(--ie-text); opacity: 1; }
            
            /* Utility */
            .btn-icon-sm {
                width: 28px; height: 28px;
                display: flex; align-items: center; justify-content: center;
                border: none; background: transparent; border-radius: 4px;
                color: var(--ie-text-secondary); cursor: pointer;
                transition: all 0.2s;
            }
            .btn-icon-sm:hover { background: var(--ie-hover); color: var(--ie-primary); }
            
            .empty-state {
                padding: 40px 0;
                text-align: center;
                color: var(--ie-text-secondary);
                font-size: 13px;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 绑定面板调整大小 (左右面板)
     */
    _bindPanelResizer() {
        const leftResizer = this.container.querySelector('#ieLeftResizer');
        const leftPanel = this.container.querySelector('#ieLayerPanel');
        
        const rightResizer = this.container.querySelector('#ieRightResizer');
        const rightPanel = this.container.querySelector('#iePropertyPanel');
        
        // === Left Panel Resizing ===
        if (leftResizer && leftPanel) {
            let startX, startWidth;
            
            const onMouseMove = (e) => {
                const deltaX = e.clientX - startX;
                const newWidth = Math.max(180, Math.min(400, startWidth + deltaX));
                leftPanel.style.width = `${newWidth}px`;
            };
            
            const onMouseUp = () => {
                leftResizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            leftResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                startWidth = leftPanel.offsetWidth;
                leftResizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }
        
        // === Right Panel Resizing ===
        if (rightResizer && rightPanel) {
            let startX, startWidth;
            
            const onMouseMove = (e) => {
                // Right panel is on right, dragging left increases width
                const deltaX = startX - e.clientX; 
                const newWidth = Math.max(200, Math.min(450, startWidth + deltaX));
                rightPanel.style.width = `${newWidth}px`;
            };
            
            const onMouseUp = () => {
                rightResizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            rightResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                startWidth = rightPanel.offsetWidth;
                rightResizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }
    }

    /**
     * 绑定属性面板自动行为
     */
    _bindPropertyPanelBehavior() {
        const layerPanel = this.container.querySelector('#ieLayerPanel');
        const propertyPanel = this.container.querySelector('#iePropertyPanel');
        const rightResizer = this.container.querySelector('#ieRightResizer');
        
        if (!layerPanel || !propertyPanel) return;

        const expandPanel = () => {
            propertyPanel.classList.add('visible');
            if (rightResizer) rightResizer.classList.add('visible');
        };

        const collapsePanel = () => {
            propertyPanel.classList.remove('visible');
            if (rightResizer) rightResizer.classList.remove('visible');
        };

        // 双击展开
        layerPanel.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.layer-item');
            if (item) {
                expandPanel();
            }
        });

        // 点击空白收起
        layerPanel.addEventListener('click', (e) => {
            if (!e.target.closest('.layer-item')) {
                this.selectedLayerIndex = -1;
                this._updateLayerList();
                collapsePanel();
            }
        });
        
        // 拦截 selectLayer 以便处理选中逻辑
        const originalSelectLayer = this._selectLayer.bind(this);
        this._selectLayer = (index) => {
            originalSelectLayer(index);
            // 如果 index == -1，收起
            if (index === -1) {
                collapsePanel();
            }
        };
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
                // 检查是否已经存在矢量化图层组
                const existingGroupIndex = this.processedImage.layers.findIndex(
                    l => l.type === 'group' && l.vectorConfig
                );
                
                if (existingGroupIndex !== -1) {
                    // 如果已存在，直接选中它
                    console.log('[LayerEditor] 已存在矢量化图层，切换选中状态');
                    this._selectLayer(existingGroupIndex);
                } else {
                    // 不存在则执行矢量化（自动检测模式）
                    await this._vectorize();
                }
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
        // 显示加载状态
        this._showLoading('正在矢量化...');
        
        // 强制让浏览器渲染加载状态
        await this._nextFrame();
        
        try {
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
            const finalOptions = {
                numColors: 16,
                smoothness: 1,
                ...options
            };

            // 进度回调
            const onProgress = (progress, message) => {
                this._showLoading(message || `矢量化中... ${progress}%`);
            };
            
            const result = await vectorizer.vectorize(this.processedImage.original, actualPreset, onProgress);
            
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
            });
            
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
        } catch (err) {
            console.error('[LayerEditor] 矢量化失败:', err);
            alert('矢量化失败: ' + err.message);
        } finally {
            this._hideLoading();
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
        this.ctx.fillText(layer.name, x, y - 5);
    }

    /**
     * 更新图层列表
     */
    _updateLayerList() {
        const container = this.container.querySelector('.layer-list');
        container.innerHTML = '';

        // 倒序渲染，让上面的图层在列表中显示在上面
        // 注意：渲染顺序是 0 (底层) -> N (顶层)
        // 列表顺序应该是 N (顶层) -> 0 (底层)
        const layers = [...this.processedImage.layers].reverse();

        layers.forEach((layer, reverseIndex) => {
            // 计算原始索引
            const index = this.processedImage.layers.length - 1 - reverseIndex;
            const isSelected = index === this.selectedLayerIndex;

            const item = document.createElement('div');
            item.className = `layer-item ${isSelected ? 'selected' : ''}`;
            item.onclick = () => this._selectLayer(index);

            // 缩略图
            const preview = document.createElement('div');
            preview.className = `layer-preview ${layer.type === 'vector' && layer.color ? 'color-preview' : ''}`;
            preview.innerHTML = this._getLayerThumbnail(layer);
            
            // 如果是颜色块，设置背景色
            if (layer.type === 'vector' && layer.color) {
                preview.style.backgroundColor = layer.color;
                preview.innerHTML = ''; // 清空内容，只显示颜色
            }

            // 名称
            const name = document.createElement('div');
            name.className = 'layer-name';
            name.textContent = layer.name || `图层 ${index + 1}`;
            name.title = name.textContent;

            // 可见性按钮
            const visibleBtn = document.createElement('button');
            visibleBtn.className = 'layer-visibility';
            visibleBtn.innerHTML = `<iconify-icon icon="${layer.visible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
            visibleBtn.onclick = (e) => {
                e.stopPropagation();
                this._toggleLayerVisibility(index);
            };

            item.appendChild(preview);
            item.appendChild(name);
            item.appendChild(visibleBtn);
            container.appendChild(item);

            // 组图层处理
            if (layer.type === 'group' && layer.children) {
                const groupList = document.createElement('div');
                groupList.className = 'child-layer-container';
                
                // 组内图层也倒序
                [...layer.children].reverse().forEach(child => {
                    const childItem = document.createElement('div');
                    childItem.className = 'layer-item child-layer';
                    
                    const childPreview = document.createElement('div');
                    childPreview.className = 'layer-preview color-preview';
                    if (child.color) {
                        childPreview.style.backgroundColor = child.color;
                        childPreview.innerHTML = '';
                    } else {
                         // Fallback icon for non-color vector children
                         childPreview.innerHTML = '<iconify-icon icon="carbon:shape"></iconify-icon>';
                    }
                    
                    const childName = document.createElement('div');
                    childName.className = 'layer-name';
                    childName.textContent = child.name || '路径';
                    
                    // 子图层可见性按钮
                    const visibleBtn = document.createElement('button');
                    visibleBtn.className = 'layer-visibility';
                    const isVisible = child.visible !== false;
                    visibleBtn.innerHTML = `<iconify-icon icon="${isVisible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
                    visibleBtn.onclick = (e) => {
                        e.stopPropagation();
                        child.visible = !isVisible;
                        this._render();
                        this._updateLayerList();
                    };

                    childItem.appendChild(childPreview);
                    childItem.appendChild(childName);
                    childItem.appendChild(visibleBtn);
                    groupList.appendChild(childItem);
                });
                container.appendChild(groupList);
            }
        });
    }

    /**
     * 获取图层缩略图内容
     */
    _getLayerThumbnail(layer) {
        switch (layer.type) {
            case 'original':
                return `<iconify-icon icon="carbon:image"></iconify-icon>`;
            case 'vector':
                return `<iconify-icon icon="carbon:shape"></iconify-icon>`;
            case 'group':
                return `<iconify-icon icon="carbon:folder"></iconify-icon>`;
            case 'text':
                return `<iconify-icon icon="carbon:text-font"></iconify-icon>`;
            case 'foreground':
                return `<iconify-icon icon="carbon:user-avatar"></iconify-icon>`;
            default:
                return `<iconify-icon icon="carbon:layer"></iconify-icon>`;
        }
    }

    /**
     * 切换图层可见性
     */
    _toggleLayerVisibility(index) {
        const layer = this.processedImage.layers[index];
        layer.visible = !layer.visible;
        this._updateLayerList();
        this._render();
    }

    /**
     * 选择图层
     */
    _selectLayer(index) {
        if (this.selectedLayerIndex === index) return;
        this.selectedLayerIndex = index;
        this._updateLayerList();
        this._updatePropertyPanel();
    }

    /**
     * 更新属性面板
     */
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
                    
                    <div class="property-row block">
                        <span class="property-label">路径简化 (后处理)</span>
                        <div class="range-wrap">
                            <input type="range" class="range-input" min="0" max="100" value="${config.simplifyLevel || 0}" data-action="update-simplify">
                            <span class="range-value">${config.simplifyLevel || 0}</span>
                        </div>
                        <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:-4px">值越大曲线越平滑，0=不简化</small>
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
                if (layer.id) {
                    await this._reVectorize(layer.id, e.target.value, layer.vectorConfig);
                }
            });
        }
        
        const reVecBtn = panel.querySelector('[data-action="re-vectorize"]');
        if (reVecBtn) {
            reVecBtn.addEventListener('click', async () => {
                if (layer.id) {
                     const preset = panel.querySelector('[data-action="update-preset"]').value;
                     const numColors = parseInt(panel.querySelector('[data-action="update-colors"]').value);
                     const smoothness = parseFloat(panel.querySelector('[data-action="update-smoothness"]').value);
                     const simplifyLevel = parseInt(panel.querySelector('[data-action="update-simplify"]')?.value || 0);
                     
                     await this._reVectorize(layer.id, preset, { numColors, smoothness, simplifyLevel });
                }
            });
        }
        
        // 简化滑块 - 实时预览（后处理）
        const simplifySlider = panel.querySelector('[data-action="update-simplify"]');
        if (simplifySlider) {
            let simplifyTimeout = null;
            simplifySlider.addEventListener('input', async (e) => {
                const level = parseInt(e.target.value);
                layer.vectorConfig.simplifyLevel = level;
                
                // 轻微防抖 100ms，避免频繁计算
                clearTimeout(simplifyTimeout);
                simplifyTimeout = setTimeout(async () => {
                    await this._applySimplify(layer, level);
                }, 100);
            });
        }

        // 滑块实时显示
        panel.querySelectorAll('.range-input').forEach(input => {
             input.addEventListener('input', (e) => {
                 e.target.nextElementSibling.textContent = e.target.value;
             });
        });
    }
    
    /**
     * 应用路径简化（实时后处理）
     */
    async _applySimplify(layer, level) {
        if (!layer || layer.type !== 'group' || !layer.children) return;
        
        // 动态导入简化模块
        const { simplifyPathD } = await import('./potrace-core/path-simplifier.js');
        
        // 对每个子图层的路径应用简化
        layer.children.forEach(child => {
            if (child.type === 'vector' && child.paths && child.paths.length > 0) {
                child.paths.forEach(path => {
                    // 保存原始路径（如果还没保存）
                    if (!path._originalD) {
                        path._originalD = path.d;
                    }
                    
                    // 应用简化（从原始路径简化，避免累积误差）
                    if (level > 0) {
                        path.d = simplifyPathD(path._originalD, level);
                    } else {
                        path.d = path._originalD;
                    }
                });
                
                // 重新生成该图层的 SVG
                child.svg = this._regenerateLayerSvg(child);
            }
        });
        
        // 重新渲染
        this._render();
    }
    
    /**
     * 重新生成图层 SVG
     */
    _regenerateLayerSvg(layer) {
        if (!layer.paths || layer.paths.length === 0) return '';
        
        // 从现有 svg 中提取 viewBox 信息
        const viewBoxMatch = layer.svg?.match(/viewBox="([^"]+)"/);
        const sizeMatch = layer.svg?.match(/width="(\d+)" height="(\d+)"/);
        
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';
        const width = sizeMatch ? sizeMatch[1] : '100';
        const height = sizeMatch ? sizeMatch[2] : '100';
        
        const pathsStr = layer.paths.map(p => {
            const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
            return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke || 'none'}" stroke-width="${p.strokeWidth || 0}"/>`;
        }).join('\n');
        
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${pathsStr}\n</svg>`;
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

    /**
     * 显示加载遮罩
     */
    _showLoading(message = '处理中...') {
        if (!this._loadingOverlay) {
            this._loadingOverlay = document.createElement('div');
            this._loadingOverlay.className = 'ie-loading-overlay';
            this._loadingOverlay.innerHTML = `
                <div class="ie-loading-spinner"></div>
                <div class="ie-loading-text">${message}</div>
            `;
            this._loadingOverlay.style.cssText = `
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                backdrop-filter: blur(2px);
            `;
            
            // 添加旋转动画样式
            const style = document.createElement('style');
            style.textContent = `
                .ie-loading-spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: ie-spin 0.8s linear infinite;
                }
                .ie-loading-text {
                    color: #fff;
                    margin-top: 12px;
                    font-size: 14px;
                }
                @keyframes ie-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            this._loadingOverlay.appendChild(style);
        }
        
        // 更新消息文本
        const textEl = this._loadingOverlay.querySelector('.ie-loading-text');
        if (textEl) textEl.textContent = message;
        
        // 添加到编辑器容器
        const body = this.container?.querySelector('.image-editor-body');
        if (body && !body.contains(this._loadingOverlay)) {
            body.appendChild(this._loadingOverlay);
        }
    }
    
    /**
     * 隐藏加载遮罩
     */
    _hideLoading() {
        if (this._loadingOverlay && this._loadingOverlay.parentNode) {
            this._loadingOverlay.remove();
        }
    }
    
    /**
     * 等待下一帧渲染，让 UI 有机会更新
     */
    _nextFrame() {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    close() {
        this._hideLoading();
        this.container?.remove();
    }
}

// 导出到全局
window.LayerEditor = LayerEditor;
