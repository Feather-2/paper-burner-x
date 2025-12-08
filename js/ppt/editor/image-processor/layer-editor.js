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
        this.selectedChildIndex = -1;  // 选中的子图层索引
        this.container = null;
        this.canvas = null;
        this.ctx = null;

        this.history = [];
        this.historyIndex = -1;
        
        // 加载状态
        this._loadingOverlay = null;
        
        // 路径选择模式
        this.pathSelectMode = false;
        this.selectedPathIndex = -1;
        
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
        
        // 初始化属性面板（显示 OCR 设置）
        this._updatePropertyPanel();
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
            
            /* Child Layer Action Buttons */
            .layer-action-btn {
                background: transparent;
                border: none;
                padding: 4px;
                cursor: pointer;
                color: var(--ie-text-secondary);
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s;
            }
            .layer-action-btn:hover {
                background: var(--ie-hover);
                color: var(--ie-text);
            }
            .layer-action-btn.danger:hover {
                background: #fef2f2;
                color: #ef4444;
            }
            .layer-action-btn:disabled {
                opacity: 0.3;
                cursor: not-allowed;
            }
            .layer-action-btn iconify-icon {
                font-size: 14px;
            }
            
            /* Path Selection Mode */
            .path-select-mode path {
                transition: opacity 0.15s, stroke 0.15s;
            }
            .path-select-mode path:hover {
                opacity: 0.7;
                stroke: #ef4444 !important;
                stroke-width: 2px !important;
            }
            
            /* Danger Button Style */
            .btn-action.danger {
                background: #fef2f2;
                color: #ef4444;
                border-color: #fecaca;
            }
            .btn-action.danger:hover {
                background: #fee2e2;
                border-color: #f87171;
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
            
            /* Toast 动画 */
            @keyframes ie-toast-in {
                from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
            @keyframes ie-toast-out {
                from { opacity: 1; transform: translateX(-50%) translateY(0); }
                to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
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
        
        // 画布上的 bbox 拖拽调整
        this._bindBboxDragEvents();
    }
    
    /**
     * 绑定 bbox 拖拽调整事件
     */
    _bindBboxDragEvents() {
        const canvas = this.canvas;
        let isDragging = false;
        let dragMode = null; // 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w'
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
            // 检查是否点击了某个文字覆盖层的 bbox
            if (this.selectedLayerIndex < 0) return null;
            
            const layer = this.processedImage.layers[this.selectedLayerIndex];
            if (!layer || layer.type !== 'group' || !layer.textOverlayConfig) return null;
            
            // 优先检测当前选中的子图层（用于拖拽手柄）
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
            
            // 检测所有子图层（允许点击切换到其他子图层）
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
                dragMode = hit.mode;
                dragLayer = hit.layer;
                startPos = pos;
                startBbox = { ...dragLayer.bbox };
                
                // 如果点击了未选中的子图层，选中它
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
            
            // 更新鼠标样式
            const hit = hitTest(pos);
            if (hit) {
                switch (hit.mode) {
                    case 'move': canvas.style.cursor = 'move'; break;
                    case 'resize-nw': case 'resize-se': canvas.style.cursor = 'nwse-resize'; break;
                    case 'resize-ne': case 'resize-sw': canvas.style.cursor = 'nesw-resize'; break;
                    case 'resize-n': case 'resize-s': canvas.style.cursor = 'ns-resize'; break;
                    case 'resize-e': case 'resize-w': canvas.style.cursor = 'ew-resize'; break;
                }
            } else {
                canvas.style.cursor = 'default';
            }
        });
        
        const endDrag = () => {
            if (isDragging && dragLayer) {
                // 重新估算字号
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
    }
    
    /**
     * 检测点击位置与 bbox 的关系
     */
    _hitTestBbox(pos, layer) {
        if (!layer.bbox) return null;
        
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        
        const x = layer.bbox.left * imgWidth;
        const y = layer.bbox.top * imgHeight;
        const w = layer.bbox.width * imgWidth;
        const h = layer.bbox.height * imgHeight;
        
        const handleSize = 8; // 调整手柄大小
        
        // 检测四角调整手柄
        if (this._pointInRect(pos.x, pos.y, x - handleSize, y - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-nw' };
        }
        if (this._pointInRect(pos.x, pos.y, x + w - handleSize, y - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-ne' };
        }
        if (this._pointInRect(pos.x, pos.y, x - handleSize, y + h - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-sw' };
        }
        if (this._pointInRect(pos.x, pos.y, x + w - handleSize, y + h - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-se' };
        }
        
        // 检测四边调整手柄
        if (this._pointInRect(pos.x, pos.y, x + w/2 - handleSize, y - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-n' };
        }
        if (this._pointInRect(pos.x, pos.y, x + w/2 - handleSize, y + h - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-s' };
        }
        if (this._pointInRect(pos.x, pos.y, x - handleSize, y + h/2 - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-w' };
        }
        if (this._pointInRect(pos.x, pos.y, x + w - handleSize, y + h/2 - handleSize, handleSize * 2, handleSize * 2)) {
            return { layer, mode: 'resize-e' };
        }
        
        // 检测内部区域（移动）
        if (this._pointInRect(pos.x, pos.y, x, y, w, h)) {
            return { layer, mode: 'move' };
        }
        
        return null;
    }
    
    /**
     * 点是否在矩形内
     */
    _pointInRect(px, py, rx, ry, rw, rh) {
        return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    }
    
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
    }
    
    /**
     * 绑定 bbox 绘制事件
     */
    _bindBboxDrawEvents() {
        const canvas = this.canvas;
        let isDrawing = false;
        let startPos = null;
        let currentRect = null;
        
        const getCanvasPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };
        
        // 绘制预览矩形
        const drawPreview = () => {
            if (!currentRect) return;
            this._render();
            
            // 绘制正在绘制的矩形
            this.ctx.strokeStyle = '#22c55e';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 3]);
            this.ctx.strokeRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
            this.ctx.setLineDash([]);
            
            // 填充半透明
            this.ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
            this.ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
        };
        
        canvas.addEventListener('mousedown', (e) => {
            if (!this.drawBboxMode) return;
            
            const pos = getCanvasPos(e);
            isDrawing = true;
            startPos = pos;
            currentRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
            
            e.preventDefault();
            e.stopPropagation();
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!this.drawBboxMode || !isDrawing || !startPos) return;
            
            const pos = getCanvasPos(e);
            
            // 计算矩形（支持任意方向拖拽）
            const x = Math.min(startPos.x, pos.x);
            const y = Math.min(startPos.y, pos.y);
            const w = Math.abs(pos.x - startPos.x);
            const h = Math.abs(pos.y - startPos.y);
            
            currentRect = { x, y, w, h };
            drawPreview();
        });
        
        canvas.addEventListener('mouseup', (e) => {
            if (!this.drawBboxMode || !isDrawing || !currentRect) return;
            
            isDrawing = false;
            
            // 检查矩形是否足够大
            if (currentRect.w < 10 || currentRect.h < 10) {
                this._showToast('区域太小，请重新绘制');
                currentRect = null;
                startPos = null;
                this._render();
                return;
            }
            
            // 创建新的文字区域
            this._createTextRegion(currentRect);
            
            // 重置状态
            currentRect = null;
            startPos = null;
            this.drawBboxMode = false;
            this.canvas.style.cursor = 'default';
            
            this._render();
        });
        
        // Esc 取消绘制模式
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.drawBboxMode) {
                this.drawBboxMode = false;
                this.canvas.style.cursor = 'default';
                isDrawing = false;
                currentRect = null;
                startPos = null;
                this._render();
                this._showToast('已取消绘制');
            }
            
            // Delete 键删除选中的文字区域
            if (e.key === 'Delete' && this.selectedChildIndex >= 0) {
                const layer = this.processedImage.layers[this.selectedLayerIndex];
                if (layer?.type === 'group' && layer.textOverlayConfig) {
                    const child = layer.children?.[this.selectedChildIndex];
                    if (child?.type === 'text-overlay') {
                        layer.children.splice(this.selectedChildIndex, 1);
                        layer.name = `文字识别 (${layer.children.length} 区域)`;
                        this.selectedChildIndex = -1;
                        this._saveHistory();
                        this._updateLayerList();
                        this._updatePropertyPanel();
                        this._render();
                        this._showToast('已删除文字区域');
                    }
                }
            }
        });
    }
    
    /**
     * 创建新的文字区域
     */
    _createTextRegion(rect) {
        const parent = this.drawBboxParent;
        if (!parent || !parent.children) return;
        
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        
        // 转换为归一化坐标
        const bbox = {
            left: rect.x / imgWidth,
            top: rect.y / imgHeight,
            width: rect.w / imgWidth,
            height: rect.h / imgHeight
        };
        
        // 创建新的文字区域
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
        
        // 选中新创建的区域
        this.selectedChildIndex = parent.children.length - 1;
        
        this._saveHistory();
        this._updateLayerList();
        this._updatePropertyPanel();
        
        this._showToast('已创建文字区域，可在右侧面板编辑内容');
    }
    
    /**
     * 显示 Toast 提示
     */
    _showToast(message, duration = 2000) {
        // 移除已有的 toast
        const existing = this.container.querySelector('.ie-toast');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.className = 'ie-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: absolute;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-size: 13px;
            z-index: 1000;
            animation: ie-toast-in 0.3s ease;
        `;
        
        this.container.querySelector('.image-editor-canvas-wrap').appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'ie-toast-out 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    /**
     * 绘制调整手柄
     */
    _drawResizeHandles(x, y, w, h) {
        const size = 6;
        const half = size / 2;
        
        this.ctx.fillStyle = '#4f46e5';
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 1;
        
        // 四角手柄
        const corners = [
            [x - half, y - half],           // nw
            [x + w - half, y - half],       // ne
            [x - half, y + h - half],       // sw
            [x + w - half, y + h - half],   // se
        ];
        
        // 四边中点手柄
        const edges = [
            [x + w/2 - half, y - half],     // n
            [x + w/2 - half, y + h - half], // s
            [x - half, y + h/2 - half],     // w
            [x + w - half, y + h/2 - half], // e
        ];
        
        // 绘制所有手柄
        [...corners, ...edges].forEach(([hx, hy]) => {
            this.ctx.fillRect(hx, hy, size, size);
            this.ctx.strokeRect(hx, hy, size, size);
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
                // 始终创建新的矢量化分组（支持多分组）
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
            
            // 计算已有矢量化分组数量，用于命名
            const existingGroupCount = this.processedImage.layers.filter(
                l => l.type === 'group' && l.vectorConfig
            ).length;
            const groupNumber = existingGroupCount + 1;
            
            // 预设名称映射
            const presetNames = {
                logo: 'Logo',
                illustration: '插画',
                lineart: '线稿',
                photo: '照片',
                pixel: '像素',
                simple: '简化'
            };
            const presetLabel = presetNames[actualPreset] || actualPreset;
            
            // 创建编组对象
            const groupLayer = {
                id: currentGroupId,
                type: 'group',
                name: `矢量化 ${groupNumber} - ${presetLabel} (${colorLayers.length} 层)`,
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
    
    /**
     * 显示 OCR 引擎选择对话框
     */
    _showOcrEngineSelector() {
        return new Promise((resolve) => {
            // 检查可用的引擎
            const mineruAvailable = !!(localStorage.getItem('ocrMinerUWorkerUrl'));
            const vlmAvailable = this._checkVlmAvailable();
            
            // 如果只有一个引擎可用，直接返回
            if (mineruAvailable && !vlmAvailable) {
                resolve('mineru');
                return;
            }
            if (!mineruAvailable && vlmAvailable) {
                resolve('vlm');
                return;
            }
            if (!mineruAvailable && !vlmAvailable) {
                alert('请先配置 OCR 引擎（MinerU 或支持视觉的 AI 模型）');
                resolve(null);
                return;
            }
            
            // 创建选择对话框
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            overlay.innerHTML = `
                <div style="
                    background: var(--ie-bg-secondary, #1e1e2e);
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 320px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                ">
                    <h3 style="margin: 0 0 16px; color: var(--ie-text-primary, #fff); font-size: 16px;">
                        选择文字识别方式
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <button class="ocr-option" data-engine="vlm" style="
                            padding: 16px;
                            border: 1px solid var(--ie-border, #333);
                            border-radius: 8px;
                            background: var(--ie-bg-tertiary, #252530);
                            color: var(--ie-text-primary, #fff);
                            cursor: pointer;
                            text-align: left;
                            transition: all 0.2s;
                        ">
                            <div style="font-weight: 600; margin-bottom: 4px;">
                                🤖 AI 视觉模型 (推荐)
                            </div>
                            <div style="font-size: 12px; color: var(--ie-text-secondary, #888);">
                                使用 GPT-4o / Claude 3 等视觉模型<br>
                                适合复杂布局、流程图、手写文字
                            </div>
                        </button>
                        <button class="ocr-option" data-engine="mineru" style="
                            padding: 16px;
                            border: 1px solid var(--ie-border, #333);
                            border-radius: 8px;
                            background: var(--ie-bg-tertiary, #252530);
                            color: var(--ie-text-primary, #fff);
                            cursor: pointer;
                            text-align: left;
                            transition: all 0.2s;
                        ">
                            <div style="font-weight: 600; margin-bottom: 4px;">
                                📄 MinerU OCR
                            </div>
                            <div style="font-size: 12px; color: var(--ie-text-secondary, #888);">
                                专业文档 OCR 引擎<br>
                                适合扫描件、PDF 截图、印刷体文字
                            </div>
                        </button>
                    </div>
                    <button class="cancel-btn" style="
                        margin-top: 16px;
                        width: 100%;
                        padding: 10px;
                        border: none;
                        border-radius: 6px;
                        background: transparent;
                        color: var(--ie-text-secondary, #888);
                        cursor: pointer;
                    ">取消</button>
                </div>
            `;
            
            // 绑定事件
            overlay.querySelectorAll('.ocr-option').forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    btn.style.borderColor = '#4f46e5';
                    btn.style.background = 'rgba(79, 70, 229, 0.1)';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.borderColor = 'var(--ie-border, #333)';
                    btn.style.background = 'var(--ie-bg-tertiary, #252530)';
                });
                btn.addEventListener('click', () => {
                    document.body.removeChild(overlay);
                    resolve(btn.dataset.engine);
                });
            });
            
            overlay.querySelector('.cancel-btn').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(null);
                }
            });
            
            document.body.appendChild(overlay);
        });
    }
    
    /**
     * 检查 VLM 是否可用
     */
    _checkVlmAvailable() {
        try {
            // 使用统一的 AI API 服务检查
            if (window.aiApiService) {
                const models = window.aiApiService.getAvailableModels();
                return models.length > 0;
            }
            return false;
        } catch {
            return false;
        }
    }

    async _runOcr() {
        // 让用户选择 OCR 引擎
        const engine = await this._showOcrEngineSelector();
        if (!engine) return; // 用户取消
        
        // 如果是 VLM 且使用网格辅助模式，显示网格预览
        const locMode = window.ocrExtractor?.config?.vlmLocalizationMode || 'grid';
        if (engine === 'vlm' && locMode === 'grid') {
            this._showOcrGridOverlay(true, '正在使用 AI 识别文字...');
        } else {
            this._showLoading(engine === 'vlm' ? '正在使用 AI 识别文字...' : '正在识别文字...');
        }
        await this._nextFrame();
        
        try {
            // 加载 OCR 模块
            const ocrExtractor = await this.processor.loadModule('ocrExtractor');
            
            // 执行 OCR，传入选择的引擎
            const result = await ocrExtractor.extract(this.processedImage.original, { priority: engine });
            
            console.log('[LayerEditor] OCR 结果:', result);
            console.log('[LayerEditor] 原图尺寸:', this.processedImage.original.width, 'x', this.processedImage.original.height);
            console.log('[LayerEditor] Canvas 尺寸:', this.canvas.width, 'x', this.canvas.height);
            
            // 从 raw 响应中重新解析原始坐标（workaround for ocr-extractor parsing issue）
            let rawRegions = [];
            if (result.raw) {
                try {
                    let jsonStr = result.raw;
                    const jsonMatch = result.raw.match(/```(?:json)?\s*([\s\S]*?)```/);
                    if (jsonMatch) jsonStr = jsonMatch[1].trim();
                    
                    // 修复常见的 JSON 格式错误
                    // 1. 双重括号 [[ 变成单括号 [（bbox_2d 格式错误）
                    jsonStr = jsonStr.replace(/"bbox_2d":\s*\[\[/g, '"bbox_2d":[');
                    jsonStr = jsonStr.replace(/"bbox":\s*\[\[/g, '"bbox":[');
                    
                    const parsed = JSON.parse(jsonStr);
                    // Qwen-VL 返回的是数组 [{...}]，Gemini 返回的是对象 {regions: [...]}
                    rawRegions = Array.isArray(parsed) ? parsed : (parsed.regions || parsed.texts || []);
                    console.log('[LayerEditor] 从 raw 解析到', rawRegions.length, '个原始区域');
                } catch (e) {
                    console.warn('[LayerEditor] 解析 raw 失败:', e);
                }
            }
            
            // 如果 ocr-extractor 解析失败但 raw 解析成功，使用 raw 数据
            const regions = (result.regions && result.regions.length > 0) ? result.regions : rawRegions;
            
            if (regions.length === 0) {
                alert('未识别到文字区域');
                return;
            }
            
            console.log(`[LayerEditor] OCR 识别到 ${regions.length} 个文字区域`);
            
            // 创建文字覆盖组
            const groupId = `text_group_${Date.now()}`;
            const groupLayer = {
                id: groupId,
                type: 'group',
                name: `文字识别 (${regions.length} 区域)`,
                visible: true,
                textOverlayConfig: {
                    engine: result.engine,
                    processedAt: Date.now(),
                },
                children: [],
                // 用于 inpainting 的背景
                inpaintedBackground: null,
            };
            
            // 确定坐标系统
            // 检测坐标最大值来判断是哪种坐标系
            let gridX = 10, gridY = 10;  // 默认 10x10 网格
            if (rawRegions.length > 0) {
                const maxX = Math.max(...rawRegions.filter(r => r.x2).map(r => r.x2));
                const maxY = Math.max(...rawRegions.filter(r => r.y2).map(r => r.y2));
                
                // 检测坐标系类型
                if (maxX > 50) {
                    // 百分比坐标 (0-100)
                    gridX = 100;
                    gridY = 100;
                    console.log('[LayerEditor] 检测到百分比坐标 (0-100)');
                } else if (maxX > 10) {
                    // 可能是其他网格，使用实际最大值
                    gridX = Math.ceil(maxX);
                    gridY = Math.ceil(maxY);
                    console.log('[LayerEditor] 使用动态网格:', gridX, 'x', gridY);
                } else {
                    // 标准 10x10 网格
                    console.log('[LayerEditor] 使用标准 10x10 网格');
                }
            }
            
            // 显示红框预览（如果有网格覆盖层）
            if (this.container.querySelector('.ocr-grid-overlay') && rawRegions.length > 0) {
                this._updateOcrGridBboxes(rawRegions, gridX, gridY);
                // 延迟 1.5 秒后继续
                await new Promise(r => setTimeout(r, 1500));
            }
            
            rawRegions.forEach((rawRegion, idx) => {
                // rawRegion 直接来自 VLM 原始响应，包含 text, bbox_2d/bbox/x1y1x2y2 等
                const text = rawRegion.text || rawRegion.text_content || '';
                if (!text.trim()) return;
                
                // 确保 bbox 是对象格式 { left, top, width, height }
                let bbox = null;
                
                // 格式1: rawRegion 有 bbox_2d 数组
                // Qwen-VL: 像素坐标；Gemini: 0-1000 归一化
                if (Array.isArray(rawRegion.bbox_2d) && rawRegion.bbox_2d.length === 4) {
                    const [rx1, ry1, rx2, ry2] = rawRegion.bbox_2d;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    let x1, y1, x2, y2;
                    
                    const imgWidth = this.processedImage.original.width;
                    const imgHeight = this.processedImage.original.height;
                    
                    if (maxVal > 1000) {
                        // Qwen-VL: 像素坐标，用图片尺寸归一化
                        x1 = rx1 / imgWidth;
                        y1 = ry1 / imgHeight;
                        x2 = rx2 / imgWidth;
                        y2 = ry2 / imgHeight;
                        console.log(`[LayerEditor] bbox_2d 像素坐标:`, rawRegion.bbox_2d, `/ ${imgWidth}x${imgHeight}`);
                    } else {
                        // Gemini: 0-1000 归一化坐标
                        x1 = rx1 / 1000;
                        y1 = ry1 / 1000;
                        x2 = rx2 / 1000;
                        y2 = ry2 / 1000;
                    }
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 转换 bbox_2d:`, rawRegion.bbox_2d, '→', bbox);
                }
                // 格式2: rawRegion 有 x1, y1, x2, y2 独立字段 (网格辅助模式)
                else if ('x1' in rawRegion && 'y1' in rawRegion && 'x2' in rawRegion && 'y2' in rawRegion) {
                    const x1 = rawRegion.x1 / gridX;
                    const y1 = rawRegion.y1 / gridY;
                    const x2 = rawRegion.x2 / gridX;
                    const y2 = rawRegion.y2 / gridY;
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 转换网格坐标 (${gridX}x${gridY}):`, `(${rawRegion.x1},${rawRegion.y1})-(${rawRegion.x2},${rawRegion.y2})`, '→', bbox);
                }
                // 格式3: rawRegion 有 bbox 数组 (0-1000 归一化)
                else if (Array.isArray(rawRegion.bbox) && rawRegion.bbox.length === 4) {
                    const [rx1, ry1, rx2, ry2] = rawRegion.bbox;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    let x1 = rx1, y1 = ry1, x2 = rx2, y2 = ry2;
                    if (maxVal > 10) {
                        x1 /= 1000; y1 /= 1000; x2 /= 1000; y2 /= 1000;
                    }
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 转换原生 bbox:`, rawRegion.bbox, '→', bbox);
                }
                // 格式4: bbox 不存在或无效，跳过
                else {
                    console.warn(`[LayerEditor] 区域 ${idx} 无有效坐标，跳过:`, rawRegion);
                    return;
                }
                
                const childLayer = {
                    id: `text_region_${idx}_${Date.now()}`,
                    type: 'text-overlay',
                    name: `文字: ${text.substring(0, 12)}${text.length > 12 ? '...' : ''}`,
                    bbox: bbox,
                    originalBbox: bbox,
                    content: {
                        originalText: text,
                        translatedText: '',
                        displayText: text,
                    },
                    style: {
                        fontSize: rawRegion.fontSize || 14,
                        color: rawRegion.color || '#000000',
                        fontWeight: rawRegion.fontWeight || 'normal',
                        fontFamily: '"Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif',
                        textAlign: rawRegion.textAlign || 'left',
                    },
                    inpainted: false,
                    visible: true,
                    parentId: groupId,
                };
                groupLayer.children.push(childLayer);
            });
            
            this.processedImage.layers.push(groupLayer);
            
            // 保存引用以供后续操作
            this._textOverlayGroup = groupLayer;
            
            this._saveHistory();
            this._updateLayerList();
            this._render();
            
            // 自动选中新创建的组
            const newLayerIndex = this.processedImage.layers.length - 1;
            this.selectedLayerIndex = newLayerIndex;
            this._updateLayerList();
            this._updatePropertyPanel();
            
            // 提示用户可以进行的操作
            this._showTextOverlayActions();
            
        } catch (err) {
            console.error('[LayerEditor] OCR 失败:', err);
            alert('文字识别失败: ' + err.message);
        } finally {
            this._hideLoading();
            this._showOcrGridOverlay(false); // 隐藏网格预览
        }
    }
    
    /**
     * 显示/隐藏 OCR 网格预览覆盖层
     */
    _showOcrGridOverlay(show, message = '') {
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        let overlay = canvasWrap.querySelector('.ocr-grid-overlay');
        
        if (!show) {
            overlay?.remove();
            return;
        }
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'ocr-grid-overlay';
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 100;
            `;
            canvasWrap.appendChild(overlay);
        }
        
        // 获取 canvas 尺寸
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        const gridX = 10, gridY = 10;
        
        // 生成网格 SVG
        let gridLines = '';
        for (let i = 0; i <= gridX; i++) {
            const x = (i / gridX) * 100;
            gridLines += `<line x1="${x}%" y1="0" x2="${x}%" y2="100%" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
            // 添加刻度数字
            if (i < gridX) {
                gridLines += `<text x="${x + 5}%" y="3%" fill="white" font-size="12" opacity="0.7">${i + 1}</text>`;
            }
        }
        for (let i = 0; i <= gridY; i++) {
            const y = (i / gridY) * 100;
            gridLines += `<line x1="0" y1="${y}%" x2="100%" y2="${y}%" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
            // 添加刻度数字
            if (i < gridY) {
                gridLines += `<text x="1%" y="${y + 5}%" fill="white" font-size="12" opacity="0.7">${i + 1}</text>`;
            }
        }
        
        overlay.innerHTML = `
            <svg width="100%" height="100%" style="position:absolute;inset:0;">
                ${gridLines}
            </svg>
            <div style="
                position: absolute;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <div class="ocr-spinner" style="
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: ie-spin 1s linear infinite;
                "></div>
                VLM OCR 识别中... (${gridX}x${gridY} 参考网格)
            </div>
            <div style="
                position: absolute;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.6);
                color: rgba(255,255,255,0.8);
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
            ">
                X轴刻度 0-${gridX}，Y轴刻度 0-${gridY}，精度 0.1
            </div>
        `;
        
        // 确保有旋转动画
        if (!document.querySelector('#ie-spin-style')) {
            const style = document.createElement('style');
            style.id = 'ie-spin-style';
            style.textContent = '@keyframes ie-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
    }
    
    /**
     * 显示持久化参考网格（带 bbox）
     */
    _showPersistentGrid(layer) {
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        let overlay = canvasWrap.querySelector('.ocr-grid-overlay');
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'ocr-grid-overlay';
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 100;
            `;
            canvasWrap.appendChild(overlay);
        }
        
        const gridX = 10, gridY = 10;
        
        // 生成网格 SVG
        let gridLines = '';
        for (let i = 0; i <= gridX; i++) {
            const x = (i / gridX) * 100;
            gridLines += `<line x1="${x}%" y1="0" x2="${x}%" y2="100%" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`;
            if (i > 0 && i < gridX) {
                gridLines += `<text x="${x - 0.5}%" y="2.5%" fill="rgba(255,255,255,0.6)" font-size="11">${i}</text>`;
            }
        }
        for (let i = 0; i <= gridY; i++) {
            const y = (i / gridY) * 100;
            gridLines += `<line x1="0" y1="${y}%" x2="100%" y2="${y}%" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`;
            if (i > 0 && i < gridY) {
                gridLines += `<text x="0.5%" y="${y + 2}%" fill="rgba(255,255,255,0.6)" font-size="11">${i}</text>`;
            }
        }
        
        // 生成 bbox
        let bboxSvg = '';
        if (layer.children) {
            layer.children.forEach(child => {
                if (child.type !== 'text-overlay' || !child.bbox) return;
                const left = child.bbox.left * 100;
                const top = child.bbox.top * 100;
                const width = child.bbox.width * 100;
                const height = child.bbox.height * 100;
                bboxSvg += `<rect x="${left}%" y="${top}%" width="${width}%" height="${height}%"
                    fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5,3"/>`;
            });
        }
        
        overlay.innerHTML = `
            <svg width="100%" height="100%" style="position:absolute;inset:0;">
                ${gridLines}
                <g class="ocr-bboxes">${bboxSvg}</g>
            </svg>
            <div style="
                position: absolute;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.6);
                color: rgba(255,255,255,0.8);
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
            ">
                ${layer.children?.length || 0} 个文字区域 · ${gridX}×${gridY} 参考网格
            </div>
        `;
    }
    
    /**
     * 隐藏持久化参考网格
     */
    _hidePersistentGrid() {
        const overlay = this.container.querySelector('.ocr-grid-overlay');
        overlay?.remove();
    }
    
    /**
     * 更新 OCR 网格覆盖层的 bbox 显示
     */
    _updateOcrGridBboxes(regions, gridX = 10, gridY = 10) {
        const overlay = this.container.querySelector('.ocr-grid-overlay');
        if (!overlay) return;
        
        // 添加红色虚线框
        let bboxSvg = '';
        regions.forEach((region, idx) => {
            let left, top, width, height;
            
            if ('x1' in region && 'y1' in region) {
                // 网格/百分比坐标 - 用 gridX/gridY 归一化
                left = (region.x1 / gridX) * 100;
                top = (region.y1 / gridY) * 100;
                width = ((region.x2 - region.x1) / gridX) * 100;
                height = ((region.y2 - region.y1) / gridY) * 100;
            } else if (Array.isArray(region.bbox_2d) && region.bbox_2d.length === 4) {
                // bbox_2d 格式 [x1,y1,x2,y2]
                const [x1, y1, x2, y2] = region.bbox_2d;
                const maxVal = Math.max(x1, y1, x2, y2);
                if (maxVal > 1000) {
                    // 像素坐标
                    const imgWidth = this.canvas.width;
                    const imgHeight = this.canvas.height;
                    left = (x1 / imgWidth) * 100;
                    top = (y1 / imgHeight) * 100;
                    width = ((x2 - x1) / imgWidth) * 100;
                    height = ((y2 - y1) / imgHeight) * 100;
                } else {
                    // 0-1000 归一化
                    left = x1 / 10;
                    top = y1 / 10;
                    width = (x2 - x1) / 10;
                    height = (y2 - y1) / 10;
                }
            } else if (region.bbox) {
                left = region.bbox.left * 100;
                top = region.bbox.top * 100;
                width = region.bbox.width * 100;
                height = region.bbox.height * 100;
            } else {
                return;
            }
            
            bboxSvg += `
                <rect x="${left}%" y="${top}%" width="${width}%" height="${height}%"
                    fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5,3"/>
            `;
        });
        
        // 找到现有的 SVG 并添加 bbox
        let svg = overlay.querySelector('svg');
        if (svg) {
            // 移除旧的 bbox group
            const oldBboxGroup = svg.querySelector('.ocr-bboxes');
            if (oldBboxGroup) oldBboxGroup.remove();
            
            // 添加新的 bbox group
            const bboxGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bboxGroup.classList.add('ocr-bboxes');
            bboxGroup.innerHTML = bboxSvg;
            svg.appendChild(bboxGroup);
        }
        
        // 更新消息
        const msgDiv = overlay.querySelector('div[style*="top: 10px"]');
        if (msgDiv) {
            msgDiv.innerHTML = `
                <iconify-icon icon="carbon:checkmark" style="color:#22c55e;font-size:18px;"></iconify-icon>
                识别完成，找到 ${regions.length} 个文字区域
            `;
        }
    }
    
    /**
     * 显示文字覆盖操作提示
     */
    _showTextOverlayActions() {
        // 可以在属性面板显示操作按钮
        console.log('[LayerEditor] 文字识别完成，可进行以下操作：');
        console.log('  - 点击文字区域编辑内容');
        console.log('  - 使用 "去除原文字" 进行 Inpainting');
        console.log('  - 翻译文字后显示新文字');
    }
    
    /**
     * 对选中的文字区域进行 Inpainting
     */
    async _inpaintTextRegion(regionId, groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        const region = group.children.find(c => c.id === regionId);
        if (!region || region.inpainted) return;
        
        this._showLoading('正在去除原文字...');
        
        try {
            // 获取或创建 inpainted 背景
            if (!group.inpaintedBackground) {
                // 创建背景画布
                const canvas = document.createElement('canvas');
                canvas.width = this.processedImage.original.width;
                canvas.height = this.processedImage.original.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(this.processedImage.original.element, 0, 0);
                group.inpaintedBackground = {
                    canvas,
                    ctx,
                };
            }
            
            const { ctx, canvas } = group.inpaintedBackground;
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;
            
            // 使用原始 bbox 进行 inpainting
            const bbox = region.originalBbox || region.bbox;
            const x = Math.floor(bbox.left * imgWidth);
            const y = Math.floor(bbox.top * imgHeight);
            const w = Math.ceil(bbox.width * imgWidth);
            const h = Math.ceil(bbox.height * imgHeight);
            
            // 高级 inpainting：使用边缘插值
            await this._performInpainting(ctx, x, y, w, h, this.processedImage.original.imageData);
            
            region.inpainted = true;
            
            this._saveHistory();
            this._render();
            
        } catch (err) {
            console.error('[LayerEditor] Inpainting 失败:', err);
        } finally {
            this._hideLoading();
        }
    }
    
    /**
     * 对所有文字区域进行 Inpainting
     */
    async _inpaintAllTextRegions(groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在去除所有原文字...');
        
        for (const region of group.children) {
            if (!region.inpainted) {
                await this._inpaintTextRegion(region.id, groupId);
            }
        }
        
        this._hideLoading();
    }
    
    /**
     * 执行 Inpainting（改进版：采样周围8个方向 + 众色）
     */
    async _performInpainting(ctx, x, y, w, h, srcImageData) {
        const imgWidth = srcImageData.width;
        const imgHeight = srcImageData.height;
        const srcData = srcImageData.data;
        
        // 采样边缘像素（增加采样宽度）
        const sampleWidth = 5;
        const topEdge = [], bottomEdge = [], leftEdge = [], rightEdge = [];
        
        // 辅助函数：获取像素颜色
        const getPixel = (px, py) => {
            if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) return null;
            const idx = (py * imgWidth + px) * 4;
            if (idx < 0 || idx >= srcData.length - 2) return null;
            return { r: srcData[idx], g: srcData[idx+1], b: srcData[idx+2] };
        };
        
        // 采样四边（每个位置采样多行/列）
        for (let i = 0; i < w; i++) {
            const topColors = [];
            const bottomColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                // 上边缘：采样上方 + 左上 + 右上
                const c1 = getPixel(x + i, y - s);
                const c2 = getPixel(x + i - 1, y - s);
                const c3 = getPixel(x + i + 1, y - s);
                if (c1) topColors.push(c1);
                if (c2) topColors.push(c2);
                if (c3) topColors.push(c3);
                
                // 下边缘：采样下方 + 左下 + 右下
                const b1 = getPixel(x + i, y + h + s - 1);
                const b2 = getPixel(x + i - 1, y + h + s - 1);
                const b3 = getPixel(x + i + 1, y + h + s - 1);
                if (b1) bottomColors.push(b1);
                if (b2) bottomColors.push(b2);
                if (b3) bottomColors.push(b3);
            }
            topEdge.push(this._avgColor(topColors));
            bottomEdge.push(this._avgColor(bottomColors));
        }
        
        for (let j = 0; j < h; j++) {
            const leftColors = [];
            const rightColors = [];
            for (let s = 1; s <= sampleWidth; s++) {
                // 左边缘：采样左方 + 左上 + 左下
                const l1 = getPixel(x - s, y + j);
                const l2 = getPixel(x - s, y + j - 1);
                const l3 = getPixel(x - s, y + j + 1);
                if (l1) leftColors.push(l1);
                if (l2) leftColors.push(l2);
                if (l3) leftColors.push(l3);
                
                // 右边缘：采样右方 + 右上 + 右下
                const r1 = getPixel(x + w + s - 1, y + j);
                const r2 = getPixel(x + w + s - 1, y + j - 1);
                const r3 = getPixel(x + w + s - 1, y + j + 1);
                if (r1) rightColors.push(r1);
                if (r2) rightColors.push(r2);
                if (r3) rightColors.push(r3);
            }
            leftEdge.push(this._avgColor(leftColors));
            rightEdge.push(this._avgColor(rightColors));
        }
        
        // 采样四角（额外的角点颜色用于混合）
        const cornerSamples = [];
        for (let s = 1; s <= sampleWidth; s++) {
            cornerSamples.push(getPixel(x - s, y - s));      // 左上角
            cornerSamples.push(getPixel(x + w + s - 1, y - s));  // 右上角
            cornerSamples.push(getPixel(x - s, y + h + s - 1));  // 左下角
            cornerSamples.push(getPixel(x + w + s - 1, y + h + s - 1)); // 右下角
        }
        const cornerColor = this._avgColor(cornerSamples.filter(c => c));
        
        // 创建临时 ImageData 用于插值
        const tempImageData = ctx.getImageData(x, y, w, h);
        const tempData = tempImageData.data;
        
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const tx = i / Math.max(1, w - 1);
                const ty = j / Math.max(1, h - 1);
                
                // 水平插值（左到右）
                const leftColor = leftEdge[j] || cornerColor;
                const rightColor = rightEdge[j] || cornerColor;
                const hColor = this._lerpColor(leftColor, rightColor, tx);
                
                // 垂直插值（上到下）
                const topColor = topEdge[i] || cornerColor;
                const bottomColor = bottomEdge[i] || cornerColor;
                const vColor = this._lerpColor(topColor, bottomColor, ty);
                
                // 对角线权重（靠近边缘时更多使用边缘颜色）
                const edgeWeight = Math.min(tx, 1 - tx, ty, 1 - ty) * 4;
                const centerWeight = Math.max(0, 1 - edgeWeight);
                
                // 混合：水平 + 垂直 + 角点
                const colors = [hColor, vColor];
                if (centerWeight > 0.3) {
                    colors.push(cornerColor);
                }
                const finalColor = this._avgColorSimple(colors);
                
                const idx = (j * w + i) * 4;
                tempData[idx] = finalColor.r;
                tempData[idx + 1] = finalColor.g;
                tempData[idx + 2] = finalColor.b;
                tempData[idx + 3] = 255;
            }
        }
        
        ctx.putImageData(tempImageData, x, y);
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
     * 计算颜色的众色（mode），如果没有明显众色则返回去除异常点后的平均值
     */
    _getModeColor(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        if (colors.length === 1) return colors[0] || { r: 255, g: 255, b: 255 };
        
        // 将颜色量化到桶中（每个通道分成 16 级）
        const buckets = {};
        colors.forEach(c => {
            if (!c) return;
            const key = `${Math.floor(c.r / 16)}_${Math.floor(c.g / 16)}_${Math.floor(c.b / 16)}`;
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(c);
        });
        
        // 找到最大的桶
        let maxBucket = null;
        let maxCount = 0;
        for (const key in buckets) {
            if (buckets[key].length > maxCount) {
                maxCount = buckets[key].length;
                maxBucket = buckets[key];
            }
        }
        
        // 如果最大桶包含超过一半的颜色，使用该桶的平均值
        if (maxBucket && maxCount > colors.length / 2) {
            return this._avgColorSimple(maxBucket);
        }
        
        // 否则，去除异常点后计算平均值
        // 计算所有颜色的亮度
        const withLuminance = colors.filter(c => c).map(c => ({
            ...c,
            lum: c.r * 0.299 + c.g * 0.587 + c.b * 0.114
        }));
        
        if (withLuminance.length <= 2) {
            return this._avgColorSimple(colors);
        }
        
        // 按亮度排序，去掉最亮和最暗的异常点
        withLuminance.sort((a, b) => a.lum - b.lum);
        const trimCount = Math.max(1, Math.floor(withLuminance.length * 0.2));
        const trimmed = withLuminance.slice(trimCount, -trimCount);
        
        if (trimmed.length === 0) {
            return this._avgColorSimple(colors);
        }
        
        return this._avgColorSimple(trimmed);
    }
    
    /**
     * 简单平均颜色（不做异常点处理）
     */
    _avgColorSimple(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        const sum = colors.reduce((acc, c) => ({
            r: acc.r + (c?.r || 255),
            g: acc.g + (c?.g || 255),
            b: acc.b + (c?.b || 255)
        }), { r: 0, g: 0, b: 0 });
        return {
            r: Math.round(sum.r / colors.length),
            g: Math.round(sum.g / colors.length),
            b: Math.round(sum.b / colors.length),
        };
    }
    
    /**
     * 平均颜色（带异常点过滤）
     */
    _avgColor(colors) {
        return this._getModeColor(colors);
    }
    
    /**
     * 更新文字区域内容
     */
    updateTextRegionContent(regionId, groupId, newText, isTranslation = false) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        const region = group.children.find(c => c.id === regionId);
        if (!region) return;
        
        if (isTranslation) {
            region.content.translatedText = newText;
            region.content.displayText = newText;
        } else {
            region.content.originalText = newText;
            if (!region.content.translatedText) {
                region.content.displayText = newText;
            }
        }
        
        // 更新图层名称
        region.name = `文字: ${region.content.displayText.substring(0, 12)}${region.content.displayText.length > 12 ? '...' : ''}`;
        
        this._saveHistory();
        this._updateLayerList();
        this._render();
    }
    
    /**
     * 批量翻译文字区域
     */
    async translateTextRegions(groupId, translateFn) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在翻译文字...');
        
        try {
            for (const region of group.children) {
                if (region.content && region.content.originalText) {
                    try {
                        const translated = await translateFn(region.content.originalText);
                        region.content.translatedText = translated;
                        region.content.displayText = translated;
                        region.name = `文字: ${translated.substring(0, 12)}${translated.length > 12 ? '...' : ''}`;
                    } catch (e) {
                        console.warn(`[LayerEditor] 翻译失败: ${region.id}`, e);
                    }
                }
            }
            
            this._saveHistory();
            this._updateLayerList();
            this._render();
        } finally {
            this._hideLoading();
        }
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
        // 提高阈值，不轻易使用 photo 预设（photo 只在手动选择时使用）
        if (uniqueColors <= 8) {
            return 'lineart';      // 简单图形都用二值化
        } else if (uniqueColors <= 24) {
            return 'logo';         // Logo/简单图形
        } else {
            return 'illustration'; // 其他都用插画预设，效果更好
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
            if (layer.visible === false) return;

            if (layer.type === 'group') {
                // 渲染组内所有子图层
                console.log(`[LayerEditor] 渲染 group: ${layer.name}, children: ${layer.children?.length || 0}`);
                layer.children?.forEach(child => {
                    console.log(`[LayerEditor] 渲染子图层: ${child.type}, bbox:`, child.bbox);
                    renderLayer(child);
                });
                return;
            }
            
            if (layer.type === 'subgroup') {
                // 渲染子组内所有图层
                layer.children?.forEach(child => renderLayer(child));
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
                case 'text-overlay':
                    // 文字覆盖图层：渲染实际文字
                    this._drawTextOverlayLayer(layer);
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
     * 渲染文字覆盖图层
     * 支持 inpainted 背景 + 新文字渲染
     */
    _drawTextOverlayLayer(layer) {
        const { bbox, content, style, inpainted, parentId } = layer;
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        
        const x = bbox.left * imgWidth;
        const y = bbox.top * imgHeight;
        const w = bbox.width * imgWidth;
        const h = bbox.height * imgHeight;
        
        // 调试：每次渲染打印坐标信息
        console.log(`[渲染] ${layer.name}: canvas=${imgWidth}x${imgHeight}, bbox=(${bbox.left.toFixed(3)},${bbox.top.toFixed(3)},${bbox.width.toFixed(3)},${bbox.height.toFixed(3)}) → px=(${x.toFixed(0)},${y.toFixed(0)},${w.toFixed(0)},${h.toFixed(0)})`);
        
        // 先绘制边框高亮（无论有无文字内容）
        const isSelected = this._isLayerSelected(layer);
        if (isSelected) {
            // 选中状态：粗虚线边框
            this.ctx.strokeStyle = '#4f46e5';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 3]);
            this.ctx.strokeRect(x, y, w, h);
            this.ctx.setLineDash([]);
            
            // 绘制调整手柄
            this._drawResizeHandles(x, y, w, h);
        } else if (!inpainted) {
            // 未 inpaint 状态：显示半透明高亮，提示用户这是识别到的文字区域
            this.ctx.fillStyle = 'rgba(79, 70, 229, 0.15)';
            this.ctx.fillRect(x, y, w, h);
            this.ctx.strokeStyle = 'rgba(79, 70, 229, 0.5)';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, w, h);
        }
        
        // 如果已 inpainted，先绘制 inpainted 区域
        if (inpainted && parentId) {
            const group = this.processedImage.layers.find(l => l.id === parentId);
            if (group?.inpaintedBackground?.canvas) {
                // 绘制 inpainted 背景区域
                const srcBbox = layer.originalBbox || bbox;
                const srcX = Math.floor(srcBbox.left * imgWidth);
                const srcY = Math.floor(srcBbox.top * imgHeight);
                const srcW = Math.ceil(srcBbox.width * imgWidth);
                const srcH = Math.ceil(srcBbox.height * imgHeight);
                
                this.ctx.drawImage(
                    group.inpaintedBackground.canvas,
                    srcX, srcY, srcW, srcH,
                    srcX, srcY, srcW, srcH
                );
            }
        }
        
        // 获取要显示的文字
        const displayText = content?.displayText || content?.originalText || '';
        if (!displayText) return;
        
        // 设置字体样式
        const fontSize = style?.fontSize || 14;
        const fontFamily = style?.fontFamily || '"Noto Sans CJK SC", Arial, sans-serif';
        const fontWeight = style?.fontWeight || 'normal';
        const textColor = style?.color || '#000000';
        const textAlign = style?.textAlign || 'left';
        
        this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        this.ctx.fillStyle = textColor;
        this.ctx.textBaseline = 'top';
        
        // 计算内边距
        const padding = h * 0.05;
        const maxTextWidth = w - padding * 2;
        const lineHeight = fontSize * 1.3;
        
        // 自动换行
        const lines = this._wrapTextForRender(displayText, maxTextWidth);
        
        // 检查是否需要缩放字体
        const totalTextHeight = lines.length * lineHeight;
        let actualFontSize = fontSize;
        if (totalTextHeight > h - padding * 2) {
            const scale = (h - padding * 2) / totalTextHeight;
            actualFontSize = Math.max(8, Math.floor(fontSize * scale));
            this.ctx.font = `${fontWeight} ${actualFontSize}px ${fontFamily}`;
        }
        
        // 绘制每行文字
        let textY = y + padding;
        const actualLineHeight = actualFontSize * 1.3;
        
        for (const line of lines) {
            let textX = x + padding;
            
            // 根据对齐方式调整 X 位置
            if (textAlign === 'center') {
                const lineWidth = this.ctx.measureText(line).width;
                textX = x + (w - lineWidth) / 2;
            } else if (textAlign === 'right') {
                const lineWidth = this.ctx.measureText(line).width;
                textX = x + w - padding - lineWidth;
            }
            
            this.ctx.fillText(line, textX, textY);
            textY += actualLineHeight;
            
            // 超出区域就停止
            if (textY > y + h - padding) break;
        }
    }
    
    /**
     * 检查图层是否被选中
     */
    _isLayerSelected(layer) {
        if (this.selectedLayerIndex < 0) return false;
        const selectedLayer = this.processedImage.layers[this.selectedLayerIndex];
        if (!selectedLayer) return false;
        
        if (selectedLayer.id === layer.id) return true;
        
        // 检查是否是子图层被选中
        if (selectedLayer.children && this.selectedChildIndex >= 0) {
            const child = selectedLayer.children[this.selectedChildIndex];
            return child?.id === layer.id;
        }
        
        return false;
    }
    
    /**
     * 文字换行辅助函数
     */
    _wrapTextForRender(text, maxWidth) {
        if (!text) return [];
        
        const lines = [];
        const paragraphs = text.split('\n');
        const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(text);
        
        for (const para of paragraphs) {
            if (!para) {
                lines.push('');
                continue;
            }
            
            let currentLine = '';
            
            if (isCJK) {
                for (const char of para) {
                    const testLine = currentLine + char;
                    if (this.ctx.measureText(testLine).width > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = char;
                    } else {
                        currentLine = testLine;
                    }
                }
            } else {
                const words = para.split(/(\s+)/);
                for (const word of words) {
                    const testLine = currentLine + word;
                    if (this.ctx.measureText(testLine).width > maxWidth && currentLine.trim()) {
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
     * 自动估算字号
     * 基于 bbox 高度，获取区域内能容纳的最大字号
     */
    _autoEstimateFontSize(layer) {
        if (!layer || !layer.bbox || !layer.content) return;
        
        const text = layer.content.displayText || layer.content.originalText || '';
        if (!text) return;
        
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        
        const bboxWidthPx = layer.bbox.width * imgWidth;
        const bboxHeightPx = layer.bbox.height * imgHeight;
        
        // 判断是否为 CJK 文字
        const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
        const fontFamily = isCJK ? '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif' : 'Arial, sans-serif';
        
        // 策略：基于 bbox 高度直接计算最大字号（假设单行）
        // 字号约等于行高的 0.8-0.9
        const maxFontSizeByHeight = bboxHeightPx * 0.85;
        
        // 用二分搜索找到能放下文字的最大字号
        let minSize = 8;
        let maxSize = Math.min(200, maxFontSizeByHeight);
        let bestSize = minSize;
        
        for (let i = 0; i < 10; i++) {
            const testSize = (minSize + maxSize) / 2;
            this.ctx.font = `${testSize}px ${fontFamily}`;
            
            // 测量文字宽度
            const textWidth = this.ctx.measureText(text).width;
            const padding = bboxHeightPx * 0.1;
            
            // 检查是否能放下（宽度够，高度也够）
            const fitsWidth = textWidth <= bboxWidthPx - padding;
            const fitsHeight = testSize <= bboxHeightPx * 0.9;
            
            if (fitsWidth && fitsHeight) {
                bestSize = testSize;
                minSize = testSize;
            } else {
                maxSize = testSize;
            }
            
            if (maxSize - minSize < 0.5) break;
        }
        
        // 如果单行放不下，改用多行策略
        this.ctx.font = `${bestSize}px ${fontFamily}`;
        const singleLineWidth = this.ctx.measureText(text).width;
        if (singleLineWidth > bboxWidthPx * 0.9) {
            // 需要换行，重新计算
            const lineHeightRatio = isCJK ? 1.3 : 1.2;
            minSize = 8;
            maxSize = bestSize;
            bestSize = minSize;
            
            for (let i = 0; i < 10; i++) {
                const testSize = (minSize + maxSize) / 2;
                this.ctx.font = `${testSize}px ${fontFamily}`;
                
                const lines = this._wrapTextForRender(text, bboxWidthPx - bboxHeightPx * 0.1);
                const totalHeight = lines.length * testSize * lineHeightRatio;
                
                if (totalHeight <= bboxHeightPx * 0.9) {
                    bestSize = testSize;
                    minSize = testSize;
                } else {
                    maxSize = testSize;
                }
                
                if (maxSize - minSize < 0.5) break;
            }
        }
        
        // 限制范围
        layer.style.fontSize = Math.max(8, Math.min(200, Math.round(bestSize)));
        console.log(`[LayerEditor] 自动估算字号: ${layer.style.fontSize}px (bbox: ${bboxWidthPx.toFixed(0)}x${bboxHeightPx.toFixed(0)}, 文字: "${text.substring(0,10)}...")`);
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

            // 操作按钮容器
            const actions = document.createElement('div');
            actions.className = 'layer-actions';
            actions.style.cssText = 'display:flex;gap:2px;margin-left:auto;';
            
            // 组图层添加上下移动按钮
            if (layer.type === 'group') {
                const upBtn = document.createElement('button');
                upBtn.className = 'layer-action-btn';
                upBtn.title = '上移（更靠前）';
                upBtn.innerHTML = '<iconify-icon icon="carbon:arrow-up"></iconify-icon>';
                upBtn.disabled = index === this.processedImage.layers.length - 1;
                upBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._moveLayer(index, 1);
                };
                
                const downBtn = document.createElement('button');
                downBtn.className = 'layer-action-btn';
                downBtn.title = '下移（更靠后）';
                downBtn.innerHTML = '<iconify-icon icon="carbon:arrow-down"></iconify-icon>';
                downBtn.disabled = index === 0;
                downBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._moveLayer(index, -1);
                };
                
                actions.appendChild(upBtn);
                actions.appendChild(downBtn);
            }
            
            // 可见性按钮
            const visibleBtn = document.createElement('button');
            visibleBtn.className = 'layer-action-btn';
            visibleBtn.title = layer.visible ? '隐藏' : '显示';
            visibleBtn.innerHTML = `<iconify-icon icon="${layer.visible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
            visibleBtn.onclick = (e) => {
                e.stopPropagation();
                this._toggleLayerVisibility(index);
            };
            actions.appendChild(visibleBtn);

            item.appendChild(preview);
            item.appendChild(name);
            item.appendChild(actions);
            container.appendChild(item);

            // 组图层处理
            if (layer.type === 'group' && layer.children) {
                const groupList = document.createElement('div');
                groupList.className = 'child-layer-container';
                
                // 组内图层也倒序
                const childrenReversed = [...layer.children].reverse();
                childrenReversed.forEach((child, reverseChildIdx) => {
                    const childIdx = layer.children.length - 1 - reverseChildIdx;
                    const isChildSelected = index === this.selectedLayerIndex && childIdx === this.selectedChildIndex;
                    
                    // 处理子组（subgroup）
                    if (child.type === 'subgroup' && child.children) {
                        const subGroupItem = this._renderSubGroup(child, index, childIdx, isChildSelected);
                        groupList.appendChild(subGroupItem);
                        return;
                    }
                    
                    const childItem = document.createElement('div');
                    childItem.className = `layer-item child-layer ${isChildSelected ? 'selected' : ''}`;
                    childItem.onclick = (e) => {
                        e.stopPropagation();
                        this._selectChildLayer(index, childIdx);
                    };
                    
                    const childPreview = document.createElement('div');
                    childPreview.className = 'layer-preview color-preview';
                    if (child.color) {
                        childPreview.style.backgroundColor = child.color;
                        childPreview.innerHTML = '';
                    } else {
                         childPreview.innerHTML = '<iconify-icon icon="carbon:shape"></iconify-icon>';
                    }
                    
                    const childName = document.createElement('div');
                    childName.className = 'layer-name';
                    childName.textContent = child.name || '路径';
                    
                    // 操作按钮容器
                    const actions = document.createElement('div');
                    actions.className = 'child-layer-actions';
                    actions.style.cssText = 'display:flex;gap:2px;margin-left:auto;';
                    
                    // 上移按钮
                    const upBtn = document.createElement('button');
                    upBtn.className = 'layer-action-btn';
                    upBtn.title = '上移';
                    upBtn.innerHTML = '<iconify-icon icon="carbon:arrow-up"></iconify-icon>';
                    upBtn.disabled = childIdx === layer.children.length - 1;
                    upBtn.onclick = (e) => {
                        e.stopPropagation();
                        this._moveChildLayer(index, childIdx, 1);
                    };
                    
                    // 下移按钮
                    const downBtn = document.createElement('button');
                    downBtn.className = 'layer-action-btn';
                    downBtn.title = '下移';
                    downBtn.innerHTML = '<iconify-icon icon="carbon:arrow-down"></iconify-icon>';
                    downBtn.disabled = childIdx === 0;
                    downBtn.onclick = (e) => {
                        e.stopPropagation();
                        this._moveChildLayer(index, childIdx, -1);
                    };
                    
                    // 删除按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'layer-action-btn danger';
                    deleteBtn.title = '删除';
                    deleteBtn.innerHTML = '<iconify-icon icon="carbon:trash-can"></iconify-icon>';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        this._deleteChildLayer(index, childIdx);
                    };
                    
                    // 子图层可见性按钮
                    const visibleBtn = document.createElement('button');
                    visibleBtn.className = 'layer-action-btn';
                    visibleBtn.title = child.visible !== false ? '隐藏' : '显示';
                    const isVisible = child.visible !== false;
                    visibleBtn.innerHTML = `<iconify-icon icon="${isVisible ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
                    visibleBtn.onclick = (e) => {
                        e.stopPropagation();
                        child.visible = !isVisible;
                        this._render();
                        this._updateLayerList();
                    };
                    
                    actions.appendChild(upBtn);
                    actions.appendChild(downBtn);
                    actions.appendChild(visibleBtn);
                    actions.appendChild(deleteBtn);

                    childItem.appendChild(childPreview);
                    childItem.appendChild(childName);
                    childItem.appendChild(actions);
                    groupList.appendChild(childItem);
                });
                container.appendChild(groupList);
            }
        });
    }

    /**
     * 渲染子组（炸开后的路径组）
     */
    _renderSubGroup(subGroup, parentIndex, childIndex, isSelected) {
        const container = document.createElement('div');
        container.className = 'subgroup-container';
        
        // 子组头部
        const header = document.createElement('div');
        header.className = `layer-item child-layer subgroup-header ${isSelected ? 'selected' : ''}`;
        header.onclick = (e) => {
            e.stopPropagation();
            this._selectChildLayer(parentIndex, childIndex);
        };
        
        // 展开/折叠按钮
        const expandBtn = document.createElement('button');
        expandBtn.className = 'layer-action-btn expand-btn';
        expandBtn.style.cssText = 'min-width:24px;min-height:24px;';
        expandBtn.innerHTML = `<iconify-icon icon="${subGroup.expanded ? 'carbon:chevron-down' : 'carbon:chevron-right'}"></iconify-icon>`;
        expandBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            subGroup.expanded = !subGroup.expanded;
            console.log('[LayerEditor] 切换炸开组展开状态:', subGroup.expanded);
            this._updateLayerList();
        };
        
        const preview = document.createElement('div');
        preview.className = 'layer-preview';
        preview.innerHTML = '<iconify-icon icon="carbon:assembly-cluster"></iconify-icon>';
        
        const name = document.createElement('div');
        name.className = 'layer-name';
        name.textContent = subGroup.name || `炸开组 (${subGroup.children.length} 个)`;
        name.style.cursor = 'pointer';
        name.ondblclick = (e) => {
            e.stopPropagation();
            subGroup.expanded = !subGroup.expanded;
            this._updateLayerList();
        };
        
        // 可见性按钮
        const visibleBtn = document.createElement('button');
        visibleBtn.className = 'layer-action-btn';
        visibleBtn.innerHTML = `<iconify-icon icon="${subGroup.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
        visibleBtn.onclick = (e) => {
            e.stopPropagation();
            subGroup.visible = !subGroup.visible;
            this._render();
            this._updateLayerList();
        };
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'layer-action-btn danger';
        deleteBtn.innerHTML = '<iconify-icon icon="carbon:trash-can"></iconify-icon>';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this._deleteChildLayer(parentIndex, childIndex);
        };
        
        header.appendChild(expandBtn);
        header.appendChild(preview);
        header.appendChild(name);
        header.appendChild(visibleBtn);
        header.appendChild(deleteBtn);
        container.appendChild(header);
        
        // 展开时显示子项
        if (subGroup.expanded) {
            const childList = document.createElement('div');
            childList.className = 'subgroup-children';
            childList.style.cssText = 'padding-left:20px;';
            
            subGroup.children.forEach((child, idx) => {
                const childItem = document.createElement('div');
                childItem.className = 'layer-item child-layer subgroup-child';
                
                const childPreview = document.createElement('div');
                childPreview.className = 'layer-preview color-preview';
                childPreview.style.backgroundColor = child.color || '#000';
                
                const childName = document.createElement('div');
                childName.className = 'layer-name';
                childName.textContent = child.name || `路径 ${idx + 1}`;
                
                // 子项可见性
                const childVisBtn = document.createElement('button');
                childVisBtn.className = 'layer-action-btn';
                childVisBtn.innerHTML = `<iconify-icon icon="${child.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>`;
                childVisBtn.onclick = (e) => {
                    e.stopPropagation();
                    child.visible = !child.visible;
                    this._render();
                    this._updateLayerList();
                };
                
                // 子项删除
                const childDelBtn = document.createElement('button');
                childDelBtn.className = 'layer-action-btn danger';
                childDelBtn.innerHTML = '<iconify-icon icon="carbon:trash-can"></iconify-icon>';
                childDelBtn.onclick = (e) => {
                    e.stopPropagation();
                    subGroup.children.splice(idx, 1);
                    subGroup.name = `炸开组 (${subGroup.children.length} 个)`;
                    if (subGroup.children.length === 0) {
                        // 如果子组为空，删除子组
                        this._deleteChildLayer(parentIndex, childIndex);
                    } else {
                        this._saveHistory();
                        this._updateLayerList();
                        this._render();
                    }
                };
                
                childItem.appendChild(childPreview);
                childItem.appendChild(childName);
                childItem.appendChild(childVisBtn);
                childItem.appendChild(childDelBtn);
                childList.appendChild(childItem);
            });
            
            container.appendChild(childList);
        }
        
        return container;
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
        if (this.selectedLayerIndex === index && this.selectedChildIndex === -1) return;
        this.selectedLayerIndex = index;
        this.selectedChildIndex = -1;  // 清除子图层选中
        this._updateLayerList();
        this._updatePropertyPanel();
    }
    
    /**
     * 移动图层（调整层级）
     * @param {number} index - 图层索引
     * @param {number} direction - 移动方向，1=上移（更靠前），-1=下移（更靠后）
     */
    _moveLayer(index, direction) {
        const layers = this.processedImage.layers;
        const newIndex = index + direction;
        
        if (newIndex < 0 || newIndex >= layers.length) return;
        
        // 交换位置
        [layers[index], layers[newIndex]] = [layers[newIndex], layers[index]];
        
        // 更新选中索引
        if (this.selectedLayerIndex === index) {
            this.selectedLayerIndex = newIndex;
        } else if (this.selectedLayerIndex === newIndex) {
            this.selectedLayerIndex = index;
        }
        
        this._saveHistory();
        this._updateLayerList();
        this._render();
    }
    
    /**
     * 选择子图层
     */
    _selectChildLayer(parentIndex, childIndex) {
        this.selectedLayerIndex = parentIndex;
        this.selectedChildIndex = childIndex;
        this._updateLayerList();
        this._updatePropertyPanel();
        this._highlightSelectedLayer();
    }
    
    /**
     * 高亮显示选中的图层
     */
    _highlightSelectedLayer() {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        
        // 移除旧的高亮
        const oldHighlight = svgContainer.querySelector('.layer-highlight');
        if (oldHighlight) oldHighlight.remove();
        
        // 获取选中的子图层
        const childLayer = this._getSelectedChildLayer();
        if (!childLayer || !childLayer.svg) return;
        
        // 创建高亮覆盖层
        const highlight = document.createElement('div');
        highlight.className = 'layer-highlight';
        highlight.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;';
        
        // 提取 SVG 属性
        const widthMatch = childLayer.svg.match(/width="([^"]+)"/);
        const heightMatch = childLayer.svg.match(/height="([^"]+)"/);
        const viewBoxMatch = childLayer.svg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : '100%';
        const height = heightMatch ? heightMatch[1] : '100%';
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
        
        // 提取路径
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        highlight.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''} 
                 style="width:100%;height:100%;" preserveAspectRatio="xMidYMid meet">
                <path d="${dMatch[1]}" fill="none" stroke="#4f46e5" stroke-width="3" stroke-dasharray="8,4" opacity="0.8">
                    <animate attributeName="stroke-dashoffset" values="0;24" dur="1s" repeatCount="indefinite"/>
                </path>
            </svg>
        `;
        
        svgContainer.appendChild(highlight);
        
        // 3秒后自动移除高亮
        setTimeout(() => {
            highlight.style.transition = 'opacity 0.5s';
            highlight.style.opacity = '0';
            setTimeout(() => highlight.remove(), 500);
        }, 3000);
    }
    
    /**
     * 移动子图层
     */
    _moveChildLayer(parentIndex, childIndex, direction) {
        const layer = this.processedImage.layers[parentIndex];
        if (!layer || !layer.children) return;
        
        const newIndex = childIndex + direction;
        if (newIndex < 0 || newIndex >= layer.children.length) return;
        
        // 交换位置
        const temp = layer.children[childIndex];
        layer.children[childIndex] = layer.children[newIndex];
        layer.children[newIndex] = temp;
        
        // 更新选中索引
        this.selectedChildIndex = newIndex;
        
        this._saveHistory();
        this._updateLayerList();
        this._render();
    }
    
    /**
     * 删除子图层
     */
    _deleteChildLayer(parentIndex, childIndex) {
        const layer = this.processedImage.layers[parentIndex];
        if (!layer || !layer.children) return;
        
        if (layer.children.length <= 1) {
            alert('至少保留一个子图层');
            return;
        }
        
        layer.children.splice(childIndex, 1);
        
        // 更新组名称
        layer.name = `矢量化分组 (${layer.children.length} 层)`;
        
        // 清除选中
        if (this.selectedChildIndex >= layer.children.length) {
            this.selectedChildIndex = layer.children.length - 1;
        }
        
        this._saveHistory();
        this._updateLayerList();
        this._updatePropertyPanel();
        this._render();
    }
    
    /**
     * 获取当前选中的子图层
     */
    _getSelectedChildLayer() {
        if (this.selectedLayerIndex < 0 || this.selectedChildIndex < 0) return null;
        const layer = this.processedImage.layers[this.selectedLayerIndex];
        if (!layer || !layer.children) return null;
        return layer.children[this.selectedChildIndex];
    }

    /**
     * 更新属性面板
     */
    _updatePropertyPanel() {
        const panel = this.container.querySelector('.property-panel');
        if (this.selectedLayerIndex < 0) {
            // 未选中图层时显示全局设置
            const currentMode = window.ocrExtractor?.config?.vlmLocalizationMode || 'grid';
            panel.innerHTML = `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:settings"></iconify-icon>
                        OCR 设置
                    </div>
                    <div class="property-row">
                        <span class="property-label">定位方案</span>
                        <select data-ocr-prop="localizationMode" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--ie-border);background:var(--ie-bg-secondary);color:var(--ie-text);font-size:12px;">
                            <option value="grid" ${currentMode === 'grid' ? 'selected' : ''}>网格辅助 (推荐)</option>
                            <option value="native" ${currentMode === 'native' ? 'selected' : ''}>原生 Grounding</option>
                            <option value="auto" ${currentMode === 'auto' ? 'selected' : ''}>自动检测</option>
                        </select>
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px;display:block;">
                        网格辅助：叠加参考网格帮助 AI 定位<br>
                        原生 Grounding：使用模型内置定位能力
                    </small>
                </div>
                <div class="empty-state" style="margin-top:16px;">选择一个图层以查看属性</div>
            `;
            // 绑定事件
            panel.querySelector('[data-ocr-prop="localizationMode"]')?.addEventListener('change', (e) => {
                if (window.ocrExtractor) {
                    window.ocrExtractor.setLocalizationMode(e.target.value);
                }
            });
            return;
        }

        const layer = this.processedImage.layers[this.selectedLayerIndex];
        const childLayer = this._getSelectedChildLayer();
        
        // 如果选中了子图层，显示子图层属性
        if (childLayer) {
            this._renderChildLayerPanel(panel, layer, childLayer);
            return;
        }
        
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
        } else if (layer.type === 'group' && layer.textOverlayConfig) {
            // 文字识别组的属性面板
            const regionCount = layer.children?.length || 0;
            const inpaintedCount = layer.children?.filter(c => c.inpainted).length || 0;
            
            content += `
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:text-recognition"></iconify-icon>
                        文字识别设置
                    </div>
                    <div class="property-row">
                        <span class="property-label">识别引擎</span>
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${layer.textOverlayConfig.engine || 'vlm'}</span>
                    </div>
                    <div class="property-row">
                        <span class="property-label">定位方案</span>
                        <select data-ocr-prop="localizationMode" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--ie-border);background:var(--ie-bg-secondary);color:var(--ie-text);font-size:12px;">
                            <option value="grid" ${(window.ocrExtractor?.config?.vlmLocalizationMode || 'grid') === 'grid' ? 'selected' : ''}>网格辅助 (推荐)</option>
                            <option value="native" ${window.ocrExtractor?.config?.vlmLocalizationMode === 'native' ? 'selected' : ''}>原生 Grounding</option>
                            <option value="auto" ${window.ocrExtractor?.config?.vlmLocalizationMode === 'auto' ? 'selected' : ''}>自动检测</option>
                        </select>
                    </div>
                    <div class="property-row">
                        <span class="property-label">文字区域</span>
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${regionCount} 个</span>
                    </div>
                    <div class="property-row">
                        <span class="property-label">已去除原文</span>
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${inpaintedCount} / ${regionCount}</span>
                    </div>
                    
                    <div class="property-row" style="margin-top:8px;">
                        <span class="property-label">显示参考网格</span>
                        <input type="checkbox" data-action="toggle-grid" ${this._ocrGridVisible ? 'checked' : ''}>
                    </div>
                    
                    <div class="property-actions" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;">
                        <button class="btn-action" data-action="add-text-region" style="background:#eff6ff;border-color:#dbeafe;">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                            手动添加文字区域
                        </button>
                        <button class="btn-action" data-action="inpaint-all" ${inpaintedCount === regionCount ? 'disabled' : ''}>
                            <iconify-icon icon="carbon:erase"></iconify-icon>
                            去除所有原文字
                        </button>
                        <button class="btn-action" data-action="translate-all">
                            <iconify-icon icon="carbon:translate"></iconify-icon>
                            翻译所有文字
                        </button>
                        <button class="btn-action secondary" data-action="export-with-text">
                            <iconify-icon icon="carbon:export"></iconify-icon>
                            导出带文字图片
                        </button>
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:8px;display:block;">
                        💡 选中文字区域后按 Delete 键可删除
                    </small>
                </div>
                
                <div class="property-group">
                    <div class="property-group-title">
                        <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                        矢量化集成
                    </div>
                    <small style="font-size:11px;color:var(--ie-text-secondary);margin-bottom:8px;display:block;">
                        在矢量化之前先去除文字，可以获得更干净的矢量图
                    </small>
                    <button class="btn-action" data-action="vectorize-after-inpaint" ${inpaintedCount < regionCount ? '' : ''}>
                        <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                        去除文字后矢量化
                    </button>
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
        
        // OCR 定位方案
        panel.querySelector('[data-ocr-prop="localizationMode"]')?.addEventListener('change', (e) => {
            if (window.ocrExtractor) {
                window.ocrExtractor.setLocalizationMode(e.target.value);
            }
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
        
        // 文字识别组操作
        if (layer.type === 'group' && layer.textOverlayConfig) {
            // 切换参考网格显示
            panel.querySelector('[data-action="toggle-grid"]')?.addEventListener('change', (e) => {
                this._ocrGridVisible = e.target.checked;
                if (this._ocrGridVisible) {
                    this._showPersistentGrid(layer);
                } else {
                    this._hidePersistentGrid();
                }
            });
            
            // 手动添加文字区域
            panel.querySelector('[data-action="add-text-region"]')?.addEventListener('click', () => {
                this._startDrawBbox(layer);
            });
            
            // 去除所有原文字
            panel.querySelector('[data-action="inpaint-all"]')?.addEventListener('click', async () => {
                await this._inpaintAllTextRegions(layer.id);
                this._updatePropertyPanel();
            });
            
            // 翻译所有文字
            panel.querySelector('[data-action="translate-all"]')?.addEventListener('click', async () => {
                // 检查翻译函数是否可用
                if (typeof window.translateText !== 'function') {
                    alert('翻译功能不可用，请确保已配置翻译服务');
                    return;
                }
                
                await this.translateTextRegions(layer.id, window.translateText);
                this._updatePropertyPanel();
            });
            
            // 导出带文字图片
            panel.querySelector('[data-action="export-with-text"]')?.addEventListener('click', async () => {
                await this._exportWithTextOverlay(layer.id);
            });
            
            // 去除文字后矢量化
            panel.querySelector('[data-action="vectorize-after-inpaint"]')?.addEventListener('click', async () => {
                await this._vectorizeAfterInpaint(layer.id);
            });
        }
    }
    
    /**
     * 去除文字后矢量化
     * 工作流程：
     * 1. 对所有未 inpaint 的区域执行 inpainting
     * 2. 使用 inpainted 图像进行矢量化
     */
    async _vectorizeAfterInpaint(textGroupId) {
        const group = this.processedImage.layers.find(l => l.id === textGroupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在处理...');
        
        try {
            // 1. 先 inpaint 所有区域
            await this._inpaintAllTextRegions(textGroupId);
            
            // 2. 获取 inpainted 背景
            if (!group.inpaintedBackground?.canvas) {
                throw new Error('Inpainting 失败');
            }
            
            // 3. 创建新的图像对象用于矢量化
            const inpaintedCanvas = group.inpaintedBackground.canvas;
            const inpaintedDataUrl = inpaintedCanvas.toDataURL('image/png');
            
            // 4. 加载为图像
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = inpaintedDataUrl;
            });
            
            // 5. 创建临时图像对象
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = inpaintedCanvas.width;
            tempCanvas.height = inpaintedCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);
            
            const tempImageObj = {
                element: img,
                canvas: tempCanvas,
                ctx: tempCtx,
                width: tempCanvas.width,
                height: tempCanvas.height,
                imageData: tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height),
                dataUrl: inpaintedDataUrl
            };
            
            // 6. 保存原始图像引用
            const originalImage = this.processedImage.original;
            
            // 7. 临时替换为 inpainted 图像
            this.processedImage.original = tempImageObj;
            
            // 8. 执行矢量化
            await this._vectorize('auto');
            
            // 9. 恢复原始图像引用
            this.processedImage.original = originalImage;
            
            console.log('[LayerEditor] 去除文字后矢量化完成');
            
        } catch (err) {
            console.error('[LayerEditor] 去除文字后矢量化失败:', err);
            alert('处理失败: ' + err.message);
        } finally {
            this._hideLoading();
        }
    }
    
    /**
     * 导出带文字覆盖的图片
     */
    async _exportWithTextOverlay(groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group) return;
        
        this._showLoading('正在生成图片...');
        
        try {
            // 创建导出 Canvas
            const canvas = document.createElement('canvas');
            canvas.width = this.processedImage.original.width;
            canvas.height = this.processedImage.original.height;
            const ctx = canvas.getContext('2d');
            
            // 绘制背景（inpainted 或原图）
            if (group.inpaintedBackground?.canvas) {
                ctx.drawImage(group.inpaintedBackground.canvas, 0, 0);
            } else {
                ctx.drawImage(this.processedImage.original.element, 0, 0);
            }
            
            // 绘制所有文字
            for (const region of (group.children || [])) {
                if (!region.visible) continue;
                this._renderTextOverlayToContext(ctx, region, canvas.width, canvas.height);
            }
            
            // 导出为 PNG
            const dataUrl = canvas.toDataURL('image/png');
            
            // 下载
            const link = document.createElement('a');
            link.download = `text-overlay-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
            
        } finally {
            this._hideLoading();
        }
    }
    
    /**
     * 渲染文字覆盖到指定 Context
     */
    _renderTextOverlayToContext(ctx, region, imgWidth, imgHeight) {
        const { bbox, content, style } = region;
        
        const x = bbox.left * imgWidth;
        const y = bbox.top * imgHeight;
        const w = bbox.width * imgWidth;
        const h = bbox.height * imgHeight;
        
        const displayText = content?.displayText || content?.originalText || '';
        if (!displayText) return;
        
        const fontSize = style?.fontSize || 14;
        const fontFamily = style?.fontFamily || '"Noto Sans CJK SC", Arial, sans-serif';
        const fontWeight = style?.fontWeight || 'normal';
        const textColor = style?.color || '#000000';
        const textAlign = style?.textAlign || 'left';
        
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'top';
        
        const padding = h * 0.05;
        const maxTextWidth = w - padding * 2;
        
        // 使用临时 context 测量（确保字体设置生效）
        const lines = [];
        const paragraphs = displayText.split('\n');
        const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(displayText);
        
        for (const para of paragraphs) {
            if (!para) { lines.push(''); continue; }
            let currentLine = '';
            
            if (isCJK) {
                for (const char of para) {
                    const testLine = currentLine + char;
                    if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = char;
                    } else {
                        currentLine = testLine;
                    }
                }
            } else {
                const words = para.split(/(\s+)/);
                for (const word of words) {
                    const testLine = currentLine + word;
                    if (ctx.measureText(testLine).width > maxTextWidth && currentLine.trim()) {
                        lines.push(currentLine.trim());
                        currentLine = word.trimStart();
                    } else {
                        currentLine = testLine;
                    }
                }
            }
            if (currentLine) lines.push(currentLine);
        }
        
        const lineHeight = fontSize * 1.3;
        const totalTextHeight = lines.length * lineHeight;
        let actualFontSize = fontSize;
        
        if (totalTextHeight > h - padding * 2) {
            const scale = (h - padding * 2) / totalTextHeight;
            actualFontSize = Math.max(8, Math.floor(fontSize * scale));
            ctx.font = `${fontWeight} ${actualFontSize}px ${fontFamily}`;
        }
        
        let textY = y + padding;
        const actualLineHeight = actualFontSize * 1.3;
        
        for (const line of lines) {
            let textX = x + padding;
            if (textAlign === 'center') {
                textX = x + (w - ctx.measureText(line).width) / 2;
            } else if (textAlign === 'right') {
                textX = x + w - padding - ctx.measureText(line).width;
            }
            ctx.fillText(line, textX, textY);
            textY += actualLineHeight;
            if (textY > y + h - padding) break;
        }
    }
    
    /**
     * 将颜色转换为十六进制格式
     */
    _toHexColor(color) {
        if (!color) return '#000000';
        if (color.startsWith('#')) return color;
        
        // 处理 rgb(r, g, b) 格式
        const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        
        return color;
    }
    
    /**
     * 渲染文字覆盖子图层属性面板
     */
    _renderTextOverlayChildPanel(panel, parentLayer, childLayer) {
        const content = childLayer.content || {};
        const style = childLayer.style || {};
        const hexColor = this._toHexColor(style.color || '#000000');
        
        let panelContent = `
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:text-font"></iconify-icon>
                    文字区域属性
                </div>
                <div class="property-row">
                    <span class="property-label">名称</span>
                    <input class="property-input" type="text" value="${childLayer.name || ''}" data-text-prop="name">
                </div>
                <div class="property-row">
                    <span class="property-label">可见</span>
                    <input type="checkbox" ${childLayer.visible !== false ? 'checked' : ''} data-text-prop="visible">
                </div>
                <div class="property-row">
                    <span class="property-label">已去除原文</span>
                    <span style="font-size:12px;color:${childLayer.inpainted ? '#22c55e' : '#ef4444'}">${childLayer.inpainted ? '是' : '否'}</span>
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:edit"></iconify-icon>
                    文字内容
                </div>
                <div class="property-row block">
                    <span class="property-label">原始文字</span>
                    <textarea class="property-input" rows="2" data-text-prop="originalText" style="font-size:12px;">${content.originalText || ''}</textarea>
                </div>
                <div class="property-row block">
                    <span class="property-label">显示文字</span>
                    <textarea class="property-input" rows="2" data-text-prop="displayText" style="font-size:12px;">${content.displayText || ''}</textarea>
                </div>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:crop"></iconify-icon>
                    位置与大小
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="property-row" style="margin-bottom:0">
                        <span class="property-label" style="font-size:11px">X (%)</span>
                        <input type="number" class="property-input" min="0" max="100" step="0.1" 
                            value="${(childLayer.bbox.left * 100).toFixed(1)}" 
                            data-text-prop="bbox-left" style="width:100%;">
                    </div>
                    <div class="property-row" style="margin-bottom:0">
                        <span class="property-label" style="font-size:11px">Y (%)</span>
                        <input type="number" class="property-input" min="0" max="100" step="0.1" 
                            value="${(childLayer.bbox.top * 100).toFixed(1)}" 
                            data-text-prop="bbox-top" style="width:100%;">
                    </div>
                    <div class="property-row" style="margin-bottom:0">
                        <span class="property-label" style="font-size:11px">宽 (%)</span>
                        <input type="number" class="property-input" min="1" max="100" step="0.1" 
                            value="${(childLayer.bbox.width * 100).toFixed(1)}" 
                            data-text-prop="bbox-width" style="width:100%;">
                    </div>
                    <div class="property-row" style="margin-bottom:0">
                        <span class="property-label" style="font-size:11px">高 (%)</span>
                        <input type="number" class="property-input" min="1" max="100" step="0.1" 
                            value="${(childLayer.bbox.height * 100).toFixed(1)}" 
                            data-text-prop="bbox-height" style="width:100%;">
                    </div>
                </div>
                <small style="font-size:11px;color:var(--ie-text-secondary);margin-top:4px;display:block;">
                    可在画布上拖拽调整区域
                </small>
            </div>
            
            <div class="property-group">
                <div class="property-group-title">
                    <iconify-icon icon="carbon:text-scale"></iconify-icon>
                    文字样式
                </div>
                <div class="property-row">
                    <span class="property-label">字号</span>
                    <input type="number" class="property-input" min="8" max="72" value="${style.fontSize || 14}" data-text-prop="fontSize" style="width:60px;">
                    <button class="btn-icon-sm" data-text-action="auto-fontsize" title="自动估算字号">
                        <iconify-icon icon="carbon:magic-wand"></iconify-icon>
                    </button>
                </div>
                <div class="property-row">
                    <span class="property-label">颜色</span>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="color" value="${hexColor}" data-text-prop="color" style="width:32px;height:24px;padding:0;border:none;">
                        <span style="font-size:12px;color:var(--ie-text-secondary)">${hexColor}</span>
                    </div>
                </div>
                <div class="property-row">
                    <span class="property-label">对齐</span>
                    <select class="property-select" data-text-prop="textAlign" style="width:80px;">
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
                    <iconify-icon icon="carbon:operations-field"></iconify-icon>
                    操作
                </div>
                <button class="btn-action" data-text-action="inpaint" ${childLayer.inpainted ? 'disabled' : ''}>
                    <iconify-icon icon="carbon:erase"></iconify-icon>
                    去除原文字
                </button>
                <button class="btn-action danger" data-text-action="delete" style="margin-top:8px">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                    删除此区域
                </button>
            </div>
        `;
        
        panel.innerHTML = panelContent;
        this._bindTextOverlayChildEvents(panel, parentLayer, childLayer);
    }
    
    /**
     * 绑定文字覆盖子图层事件
     */
    _bindTextOverlayChildEvents(panel, parentLayer, childLayer) {
        // 名称
        panel.querySelector('[data-text-prop="name"]')?.addEventListener('change', (e) => {
            childLayer.name = e.target.value;
            this._updateLayerList();
            this._saveHistory();
        });
        
        // 可见性
        panel.querySelector('[data-text-prop="visible"]')?.addEventListener('change', (e) => {
            childLayer.visible = e.target.checked;
            this._render();
            this._updateLayerList();
        });
        
        // 原始文字
        panel.querySelector('[data-text-prop="originalText"]')?.addEventListener('change', (e) => {
            childLayer.content.originalText = e.target.value;
            if (!childLayer.content.translatedText) {
                childLayer.content.displayText = e.target.value;
                panel.querySelector('[data-text-prop="displayText"]').value = e.target.value;
            }
            this._render();
            this._saveHistory();
        });
        
        // 显示文字
        panel.querySelector('[data-text-prop="displayText"]')?.addEventListener('change', (e) => {
            childLayer.content.displayText = e.target.value;
            childLayer.name = `文字: ${e.target.value.substring(0, 12)}${e.target.value.length > 12 ? '...' : ''}`;
            this._updateLayerList();
            this._render();
            this._saveHistory();
        });
        
        // 字号
        panel.querySelector('[data-text-prop="fontSize"]')?.addEventListener('change', (e) => {
            childLayer.style.fontSize = parseInt(e.target.value) || 14;
            this._render();
            this._saveHistory();
        });
        
        // 颜色
        panel.querySelector('[data-text-prop="color"]')?.addEventListener('input', (e) => {
            childLayer.style.color = e.target.value;
            e.target.nextElementSibling.textContent = e.target.value;
            this._render();
        });
        panel.querySelector('[data-text-prop="color"]')?.addEventListener('change', () => {
            this._saveHistory();
        });
        
        // 对齐
        panel.querySelector('[data-text-prop="textAlign"]')?.addEventListener('change', (e) => {
            childLayer.style.textAlign = e.target.value;
            this._render();
            this._saveHistory();
        });
        
        // 粗体
        panel.querySelector('[data-text-prop="fontWeight"]')?.addEventListener('change', (e) => {
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
                const value = parseFloat(e.target.value) / 100; // 转换为 0-1
                const key = prop.replace('bbox-', '');
                
                if (key === 'left' || key === 'top') {
                    childLayer.bbox[key] = Math.max(0, Math.min(1, value));
                } else {
                    childLayer.bbox[key] = Math.max(0.01, Math.min(1, value));
                }
                
                this._render();
            });
            
            input.addEventListener('change', () => {
                // 重新估算字号
                this._autoEstimateFontSize(childLayer);
                this._render();
                this._saveHistory();
            });
        });
        
        // 自动估算字号
        panel.querySelector('[data-text-action="auto-fontsize"]')?.addEventListener('click', () => {
            this._autoEstimateFontSize(childLayer);
            // 更新输入框
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
    }
    
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
    }
    
    /**
     * 解析路径 d 属性，提取坐标点用于边界框计算
     */
    _getPathBounds(d) {
        const coords = [];
        // 提取所有数字对（坐标）
        const numRegex = /[-+]?[\d.]+/g;
        const nums = d.match(numRegex) || [];
        
        for (let i = 0; i < nums.length - 1; i += 2) {
            coords.push({
                x: parseFloat(nums[i]),
                y: parseFloat(nums[i + 1])
            });
        }
        
        if (coords.length === 0) return null;
        
        const xs = coords.map(c => c.x);
        const ys = coords.map(c => c.y);
        
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }
    
    /**
     * 检查 bounds1 是否完全包含 bounds2
     */
    _boundsContains(outer, inner) {
        if (!outer || !inner) return false;
        return outer.minX <= inner.minX && 
               outer.maxX >= inner.maxX && 
               outer.minY <= inner.minY && 
               outer.maxY >= inner.maxY;
    }
    
    /**
     * 将子路径按包含关系分组（保留孔洞）
     */
    _groupPathsByContainment(subPaths) {
        if (subPaths.length <= 1) return [subPaths];
        
        // 计算每个子路径的边界框
        const pathsWithBounds = subPaths.map((d, idx) => ({
            d: d.trim(),
            bounds: this._getPathBounds(d),
            idx
        }));
        
        // 按面积从大到小排序（外轮廓通常更大）
        pathsWithBounds.sort((a, b) => {
            if (!a.bounds || !b.bounds) return 0;
            const areaA = (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxY - a.bounds.minY);
            const areaB = (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxY - b.bounds.minY);
            return areaB - areaA;
        });
        
        // 分组：检查每个路径是否被其他路径包含
        const groups = [];
        const assigned = new Set();
        
        for (let i = 0; i < pathsWithBounds.length; i++) {
            if (assigned.has(i)) continue;
            
            const outer = pathsWithBounds[i];
            const group = [outer.d];
            assigned.add(i);
            
            // 查找被这个路径包含的其他路径（可能是孔洞）
            for (let j = i + 1; j < pathsWithBounds.length; j++) {
                if (assigned.has(j)) continue;
                
                const inner = pathsWithBounds[j];
                if (this._boundsContains(outer.bounds, inner.bounds)) {
                    group.push(inner.d);
                    assigned.add(j);
                }
            }
            
            groups.push(group);
        }
        
        return groups;
    }
    
    /**
     * 统计 SVG 中可炸开的独立形状数量（智能分组后）
     */
    _countPaths(svg) {
        if (!svg) return 0;
        
        // 先统计 <path> 元素数量
        const pathElements = svg.match(/<path/g) || [];
        
        // 如果只有一个 path，检查复合路径并智能分组
        if (pathElements.length === 1) {
            const dMatch = svg.match(/\bd="([^"]+)"/);
            if (dMatch) {
                const d = dMatch[1];
                const subPathRegex = /M[^M]+/gi;
                const subPaths = d.match(subPathRegex) || [];
                
                if (subPaths.length > 1) {
                    // 使用智能分组计算独立形状数量
                    const groups = this._groupPathsByContainment(subPaths);
                    return groups.length;
                }
                return subPaths.length;
            }
        }
        
        return pathElements.length;
    }
    
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
            // 更新 SVG 中的颜色
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
        console.log('[LayerEditor] 炸开按钮:', explodeBtn, '禁用状态:', explodeBtn?.disabled);
        if (explodeBtn) {
            explodeBtn.addEventListener('click', (e) => {
                console.log('[LayerEditor] 炸开按钮被点击', e.target.disabled);
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
    
    /**
     * 对单个子图层应用路径简化
     * @param {Object} childLayer - 子图层
     * @param {number} level - 简化级别
     * @param {Object} parentLayer - 父图层（用于获取预设信息）
     */
    async _applyChildSimplify(childLayer, level, parentLayer = null) {
        if (!childLayer || !childLayer.svg) return;
        
        // 保存原始 SVG（如果还没保存）
        if (!childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.svg;
        }
        
        if (level === 0) {
            childLayer.svg = childLayer.originalSvg;
            childLayer.simplifyLevel = 0;
        } else {
            const { simplifyPathD } = await import('./potrace-core/path-simplifier.js');
            
            // 检测是否为文字/Logo 类型
            const preset = parentLayer?.vectorConfig?.preset || '';
            const preserveStroke = ['logo', 'lineart'].includes(preset);
            const simplifyOptions = { preserveStroke };
            
            // 从原始 SVG 开始简化
            let svg = childLayer.originalSvg;
            const pathRegex = /<path([^>]*?)d="([^"]+)"([^>]*?)\/?>(?:<\/path>)?/g;
            
            svg = svg.replace(pathRegex, (match, before, d, after) => {
                const simplified = simplifyPathD(d, level, simplifyOptions);
                return `<path${before}d="${simplified}"${after}/>`;
            });
            
            childLayer.svg = svg;
            childLayer.simplifyLevel = level;
        }
        
        this._render();
    }
    
    /**
     * 炸开子图层的路径为独立图层
     * 支持拆分复合路径（一个 path 中有多个 M...Z 子路径）
     */
    _explodeChildPaths(parentLayer, childLayer) {
        console.log('[LayerEditor] 炸开路径:', { parentLayer, childLayer });
        
        if (!childLayer || !childLayer.svg) {
            console.warn('[LayerEditor] 无效的子图层或 SVG');
            return;
        }
        
        // 提取 SVG 的基础属性
        const widthMatch = childLayer.svg.match(/width="([^"]+)"/);
        const heightMatch = childLayer.svg.match(/height="([^"]+)"/);
        const viewBoxMatch = childLayer.svg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : '100%';
        const height = heightMatch ? heightMatch[1] : '100%';
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
        
        // 提取所有 path 元素
        const pathRegex = /<path[^>]*(?:\/>|>[^<]*<\/path>)/g;
        const pathElements = childLayer.svg.match(pathRegex) || [];
        
        let paths = [];
        
        // 如果只有一个 path 元素，尝试拆分复合路径
        if (pathElements.length === 1) {
            const dMatch = pathElements[0].match(/\bd="([^"]+)"/);
            const fillMatch = pathElements[0].match(/fill="([^"]+)"/);
            const fill = fillMatch ? fillMatch[1] : childLayer.color || '#000000';
            
            if (dMatch) {
                // 拆分复合路径 - 按 M 命令分割
                const d = dMatch[1];
                const subPathRegex = /M[^M]+/gi;
                const subPaths = d.match(subPathRegex) || [];
                
                console.log('[LayerEditor] 检测到', subPaths.length, '个子路径');
                
                // 智能分组：将孔洞与其父形状保持在一起
                const groups = this._groupPathsByContainment(subPaths);
                console.log('[LayerEditor] 分组为', groups.length, '个独立形状');
                
                paths = groups.map(group => ({
                    d: group.join(' '),  // 合并同一组的路径
                    fill: fill
                }));
            }
        } else {
            // 多个 path 元素，直接使用
            paths = pathElements.map(p => {
                const dMatch = p.match(/\bd="([^"]+)"/);
                const fillMatch = p.match(/fill="([^"]+)"/);
                return {
                    d: dMatch ? dMatch[1] : '',
                    fill: fillMatch ? fillMatch[1] : childLayer.color || '#000000',
                    original: p
                };
            });
        }
        
        console.log('[LayerEditor] 找到路径数量:', paths.length);
        
        if (paths.length <= 1) {
            alert(`只有 ${paths.length} 个路径，无需炸开`);
            return;
        }
        
        // 找到当前子图层在父级中的索引
        const childIndex = parentLayer.children.indexOf(childLayer);
        if (childIndex === -1) return;
        
        // 为每个路径创建新的子图层
        const newSubChildren = paths.map((pathObj, idx) => {
            const color = pathObj.fill || childLayer.color || '#000000';
            
            // 生成新的 SVG（使用提取的 d 属性）
            const pathElement = pathObj.original 
                ? pathObj.original 
                : `<path d="${pathObj.d}" fill="${color}"/>`;
            const newSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''}>${pathElement}</svg>`;
            
            return {
                id: `${childLayer.id}_path_${idx}_${Date.now()}`,
                type: 'vector',
                name: `路径 ${idx + 1}`,
                color: color,
                svg: newSvg,
                visible: true
            };
        });
        
        // 创建新的子组来包裹炸开的路径
        const subGroup = {
            id: `${childLayer.id}_exploded_${Date.now()}`,
            type: 'subgroup',
            name: `炸开组 (${paths.length} 个)`,
            color: childLayer.color,
            children: newSubChildren,
            visible: true,
            expanded: true,  // 默认展开
            vectorGroupId: parentLayer.id,
            parentId: parentLayer.id
        };
        
        // 替换原子图层为新的子组
        parentLayer.children.splice(childIndex, 1, subGroup);
        
        // 选中新的子组
        this.selectedChildIndex = childIndex;
        
        this._saveHistory();
        this._updateLayerList();
        this._updatePropertyPanel();
        this._render();
        
        console.log(`[LayerEditor] 已炸开 ${paths.length} 个路径为独立图层`);
    }
    
    /**
     * 设置路径选择功能 - 支持删除复合路径中的子路径
     */
    _setupPathSelection(childLayer) {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        
        if (!this.pathSelectMode) {
            // 移除选择模式样式和临时元素
            svgContainer.classList.remove('path-select-mode');
            const overlay = svgContainer.querySelector('.path-select-overlay');
            if (overlay) {
                if (overlay._cleanup) overlay._cleanup();
                overlay.remove();
            }
            // selection-box 和 actionBar 在 overlay 内部，会随 overlay 一起删除
            return;
        }
        
        // 添加选择模式样式
        svgContainer.classList.add('path-select-mode');
        
        // 创建可点击的路径覆盖层
        this._createPathSelectOverlay(svgContainer, childLayer);
    }
    
    /**
     * 创建可点击的路径覆盖层 - 每个子路径单独可点击
     */
    _createPathSelectOverlay(container, childLayer) {
        // 移除旧的覆盖层
        const oldOverlay = container.querySelector('.path-select-overlay');
        if (oldOverlay) oldOverlay.remove();
        
        if (!childLayer || !childLayer.svg) return;
        
        // 提取 SVG 属性
        const widthMatch = childLayer.svg.match(/width="([^"]+)"/);
        const heightMatch = childLayer.svg.match(/height="([^"]+)"/);
        const viewBoxMatch = childLayer.svg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : '100%';
        const height = heightMatch ? heightMatch[1] : '100%';
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
        
        // 提取所有子路径
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const subPathRegex = /M[^M]+/gi;
        const subPaths = dMatch[1].match(subPathRegex) || [];
        
        if (subPaths.length === 0) return;
        
        // 创建覆盖层
        const overlay = document.createElement('div');
        overlay.className = 'path-select-overlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
        
        const color = childLayer.color || '#000000';
        const pathElements = subPaths.map((d, idx) => 
            `<path d="${d.trim()}" fill="${color}" fill-opacity="0.01" stroke="transparent" stroke-width="10" 
                   style="pointer-events:all;cursor:pointer;" data-subpath-idx="${idx}"/>`
        ).join('');
        
        // 创建 SVG 容器
        const svgWrapper = document.createElement('div');
        svgWrapper.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        svgWrapper.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox}"` : ''} 
                 style="width:100%;height:100%;" preserveAspectRatio="xMidYMid meet">
                ${pathElements}
            </svg>
        `;
        overlay.appendChild(svgWrapper);
        
        // 创建选择框元素（放到 svgWrapper 里）
        const selectionDiv = document.createElement('div');
        selectionDiv.className = 'selection-box';
        selectionDiv.style.cssText = 'position:absolute;border:2px dashed #4f46e5;background:rgba(79,70,229,0.15);display:none;pointer-events:none;z-index:300;box-shadow:0 0 0 1px rgba(79,70,229,0.3);';
        svgWrapper.appendChild(selectionDiv);
        
        // 创建操作按钮容器
        const actionBar = document.createElement('div');
        actionBar.className = 'selection-action-bar';
        actionBar.style.cssText = 'position:absolute;top:8px;right:8px;display:none;z-index:301;gap:8px;';
        overlay.appendChild(actionBar);
        
        // 选中的路径索引集合
        const selectedPaths = new Set();
        
        // 计算每个子路径的边界框
        const pathBounds = subPaths.map(d => this._getPathBounds(d));
        
        // 绑定点击事件
        const allPaths = overlay.querySelectorAll('path');
        allPaths.forEach(path => {
            path.addEventListener('mouseenter', () => {
                if (!selectedPaths.has(parseInt(path.dataset.subpathIdx))) {
                    path.style.fill = 'rgba(239, 68, 68, 0.3)';
                    path.style.stroke = '#ef4444';
                    path.style.strokeWidth = '2';
                }
            });
            path.addEventListener('mouseleave', () => {
                if (!selectedPaths.has(parseInt(path.dataset.subpathIdx))) {
                    path.style.fill = color;
                    path.style.fillOpacity = '0.01';
                    path.style.stroke = 'transparent';
                }
            });
            path.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(path.dataset.subpathIdx);
                
                // Ctrl/Cmd 多选
                if (e.ctrlKey || e.metaKey) {
                    if (selectedPaths.has(idx)) {
                        selectedPaths.delete(idx);
                        path.style.fill = color;
                        path.style.fillOpacity = '0.01';
                        path.style.stroke = 'transparent';
                    } else {
                        selectedPaths.add(idx);
                        path.style.fill = 'rgba(239, 68, 68, 0.5)';
                        path.style.stroke = '#ef4444';
                        path.style.strokeWidth = '2';
                    }
                } else if (selectedPaths.size > 0) {
                    // 有选中的路径时，点击删除所有选中的
                    if (confirm(`删除 ${selectedPaths.size} 个选中的路径？`)) {
                        this._deleteMultipleSubPaths(childLayer, Array.from(selectedPaths));
                    }
                } else {
                    // 单击删除单个
                    if (confirm(`删除此子路径？(${idx + 1}/${subPaths.length})`)) {
                        this._deleteSubPathFromChild(childLayer, idx);
                    }
                }
            });
        });
        
        // 框选功能
        let isSelecting = false;
        let startX = 0, startY = 0;
        
        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.style.cssText = 'padding:3px 8px;background:#ef4444;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:3px;';
        deleteBtn.innerHTML = '<iconify-icon icon="carbon:trash-can" style="font-size:12px"></iconify-icon> 删除 (0)';
        deleteBtn.onclick = () => {
            if (selectedPaths.size > 0 && confirm(`删除 ${selectedPaths.size} 个选中的路径？`)) {
                this._deleteMultipleSubPaths(childLayer, Array.from(selectedPaths));
            }
        };
        
        // 取消按钮
        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'padding:3px 8px;background:#6b7280;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;';
        cancelBtn.innerHTML = '取消';
        cancelBtn.onclick = () => {
            // 清除所有选中
            selectedPaths.clear();
            allPaths.forEach(p => {
                p.style.fill = color;
                p.style.fillOpacity = '0.01';
                p.style.stroke = 'transparent';
            });
            updateActionBar();
        };
        
        actionBar.appendChild(deleteBtn);
        actionBar.appendChild(cancelBtn);
        
        // Esc 键取消选择
        const handleKeydown = (e) => {
            if (e.key === 'Escape' && selectedPaths.size > 0) {
                selectedPaths.clear();
                allPaths.forEach(p => {
                    p.style.fill = color;
                    p.style.fillOpacity = '0.01';
                    p.style.stroke = 'transparent';
                });
                updateActionBar();
            }
        };
        document.addEventListener('keydown', handleKeydown);
        
        // 清理函数会在后面更新
        let cleanupFns = [() => document.removeEventListener('keydown', handleKeydown)];
        
        // 更新操作栏
        const updateActionBar = () => {
            if (selectedPaths.size > 0) {
                actionBar.style.display = 'flex';
                deleteBtn.innerHTML = `<iconify-icon icon="carbon:trash-can" style="font-size:12px"></iconify-icon> 删除 (${selectedPaths.size})`;
            } else {
                actionBar.style.display = 'none';
            }
        };
        
        // 解析 viewBox 获取坐标转换
        let vbMinX = 0, vbMinY = 0, vbWidth = parseFloat(width) || 100, vbHeight = parseFloat(height) || 100;
        if (viewBox) {
            const vbParts = viewBox.split(/[\s,]+/).map(parseFloat);
            if (vbParts.length === 4) {
                [vbMinX, vbMinY, vbWidth, vbHeight] = vbParts;
            }
        }
        
        overlay.style.pointerEvents = 'all';
        
        // 获取 SVG 元素用于坐标转换
        const svgEl = overlay.querySelector('svg');
        
        // 屏幕坐标转 SVG 坐标的辅助函数
        const screenToSvg = (clientX, clientY) => {
            if (!svgEl) return { x: 0, y: 0 };
            
            const rect = svgEl.getBoundingClientRect();
            
            // 考虑 preserveAspectRatio="xMidYMid meet" 的影响
            const svgRatio = vbWidth / vbHeight;
            const containerRatio = rect.width / rect.height;
            
            let renderWidth, renderHeight, offsetX, offsetY;
            
            if (containerRatio > svgRatio) {
                // 容器更宽，SVG 垂直填满，水平居中
                renderHeight = rect.height;
                renderWidth = renderHeight * svgRatio;
                offsetX = (rect.width - renderWidth) / 2;
                offsetY = 0;
            } else {
                // 容器更高，SVG 水平填满，垂直居中
                renderWidth = rect.width;
                renderHeight = renderWidth / svgRatio;
                offsetX = 0;
                offsetY = (rect.height - renderHeight) / 2;
            }
            
            // 转换坐标
            const localX = clientX - rect.left - offsetX;
            const localY = clientY - rect.top - offsetY;
            
            const svgX = (localX / renderWidth) * vbWidth + vbMinX;
            const svgY = (localY / renderHeight) * vbHeight + vbMinY;
            
            return { x: svgX, y: svgY, localX: clientX - rect.left, localY: clientY - rect.top };
        };
        
        // 获取 overlay 的初始位置用于坐标计算
        const getOverlayRect = () => overlay.getBoundingClientRect();
        
        // 计算 SVG 实际渲染偏移
        const getSvgOffset = () => {
            const rect = getOverlayRect();
            const svgRatio = vbWidth / vbHeight;
            const containerRatio = rect.width / rect.height;
            
            if (containerRatio > svgRatio) {
                // 容器更宽，SVG 水平居中
                const renderHeight = rect.height;
                const renderWidth = renderHeight * svgRatio;
                return { x: (rect.width - renderWidth) / 2, y: 0 };
            } else {
                // 容器更高，SVG 垂直居中
                const renderWidth = rect.width;
                const renderHeight = renderWidth / svgRatio;
                return { x: 0, y: (rect.height - renderHeight) / 2 };
            }
        };
        
        // 获取 svgWrapper 的边界
        const getSvgWrapperRect = () => svgWrapper.getBoundingClientRect();
        
        // 计算缩放因子（处理 CSS transform scale）
        const getScale = () => {
            const rect = svgWrapper.getBoundingClientRect();
            const scaleX = rect.width / svgWrapper.offsetWidth;
            const scaleY = rect.height / svgWrapper.offsetHeight;
            return { x: scaleX || 1, y: scaleY || 1 };
        };
        
        svgWrapper.addEventListener('mousedown', (e) => {
            if (e.target.tagName.toLowerCase() === 'path') return;
            
            e.preventDefault();
            isSelecting = true;
            
            const wrapperRect = svgWrapper.getBoundingClientRect();
            const scale = getScale();
            
            // 考虑缩放因子
            startX = (e.clientX - wrapperRect.left) / scale.x;
            startY = (e.clientY - wrapperRect.top) / scale.y;
            
            selectionDiv.style.left = startX + 'px';
            selectionDiv.style.top = startY + 'px';
            selectionDiv.style.width = '0';
            selectionDiv.style.height = '0';
            selectionDiv.style.display = 'block';
        });
        
        const handleMouseUp = (e) => {
            if (!isSelecting) return;
            isSelecting = false;
            selectionDiv.style.display = 'none';
            
            const rect = getSvgWrapperRect();
            const scale = getScale();
            
            // 使用与 mousedown/mousemove 相同的坐标计算
            const endX = (e.clientX - rect.left) / scale.x;
            const endY = (e.clientY - rect.top) / scale.y;
            
            // 最小框选区域
            if (Math.abs(endX - startX) < 5 && Math.abs(endY - startY) < 5) return;
            
            // 转换为 SVG viewBox 坐标（使用未缩放的像素坐标）
            // startX/Y 和 endX/Y 现在是相对于 svgWrapper 的未缩放坐标
            const wrapperWidth = svgWrapper.offsetWidth;
            const wrapperHeight = svgWrapper.offsetHeight;
            
            // 计算 SVG 内容的实际渲染区域（考虑 preserveAspectRatio）
            const svgRatio = vbWidth / vbHeight;
            const wrapperRatio = wrapperWidth / wrapperHeight;
            
            let renderWidth, renderHeight, offsetX, offsetY;
            if (wrapperRatio > svgRatio) {
                renderHeight = wrapperHeight;
                renderWidth = renderHeight * svgRatio;
                offsetX = (wrapperWidth - renderWidth) / 2;
                offsetY = 0;
            } else {
                renderWidth = wrapperWidth;
                renderHeight = renderWidth / svgRatio;
                offsetX = 0;
                offsetY = (wrapperHeight - renderHeight) / 2;
            }
            
            // 转换为 viewBox 坐标
            const toSvgX = (px) => ((px - offsetX) / renderWidth) * vbWidth + vbMinX;
            const toSvgY = (py) => ((py - offsetY) / renderHeight) * vbHeight + vbMinY;
            
            const selLeft = Math.min(toSvgX(startX), toSvgX(endX));
            const selTop = Math.min(toSvgY(startY), toSvgY(endY));
            const selRight = Math.max(toSvgX(startX), toSvgX(endX));
            const selBottom = Math.max(toSvgY(startY), toSvgY(endY));
            
            console.log('[LayerEditor] 框选区域:', { selLeft, selTop, selRight, selBottom });
            
            // 检查哪些路径与选择框相交
            pathBounds.forEach((bounds, idx) => {
                if (!bounds) return;
                
                // 检查边界框是否与选择框相交
                const intersects = !(bounds.maxX < selLeft || bounds.minX > selRight ||
                                    bounds.maxY < selTop || bounds.minY > selBottom);
                
                if (intersects) {
                    selectedPaths.add(idx);
                    const pathEl = allPaths[idx];
                    if (pathEl) {
                        pathEl.style.fill = 'rgba(239, 68, 68, 0.5)';
                        pathEl.style.stroke = '#ef4444';
                        pathEl.style.strokeWidth = '2';
                    }
                }
            });
            
            updateActionBar();
            console.log(`[LayerEditor] 框选了 ${selectedPaths.size} 个路径`);
        };
        
        document.addEventListener('mouseup', handleMouseUp);
        
        // 添加 mousemove 的引用以便清理
        const handleMouseMove = (e) => {
            if (!isSelecting) return;
            
            const rect = getSvgWrapperRect();
            const scale = getScale();
            
            // 考虑缩放因子
            const currentX = (e.clientX - rect.left) / scale.x;
            const currentY = (e.clientY - rect.top) / scale.y;
            
            const left = Math.min(startX, currentX);
            const top = Math.min(startY, currentY);
            const w = Math.abs(currentX - startX);
            const h = Math.abs(currentY - startY);
            
            selectionDiv.style.left = left + 'px';
            selectionDiv.style.top = top + 'px';
            selectionDiv.style.width = w + 'px';
            selectionDiv.style.height = h + 'px';
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        
        // 注册所有清理函数
        cleanupFns.push(
            () => document.removeEventListener('mouseup', handleMouseUp),
            () => document.removeEventListener('mousemove', handleMouseMove)
        );
        
        // 设置清理函数
        overlay._cleanup = () => {
            cleanupFns.forEach(fn => fn());
        };
        
        container.appendChild(overlay);
    }
    
    /**
     * 删除多个子路径
     */
    _deleteMultipleSubPaths(childLayer, indices) {
        if (!childLayer || !childLayer.svg || indices.length === 0) return;
        
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const d = dMatch[1];
        const subPathRegex = /M[^M]+/gi;
        const subPaths = d.match(subPathRegex) || [];
        
        // 收集所有要删除的索引（包括孔洞）
        const toDelete = new Set(indices);
        
        // 对于每个要删除的路径，也删除其内部的孔洞
        indices.forEach(idx => {
            const targetBounds = this._getPathBounds(subPaths[idx]);
            if (targetBounds) {
                for (let i = 0; i < subPaths.length; i++) {
                    if (toDelete.has(i)) continue;
                    const bounds = this._getPathBounds(subPaths[i]);
                    if (this._boundsContains(targetBounds, bounds)) {
                        toDelete.add(i);
                    }
                }
            }
        });
        
        const remaining = subPaths.filter((_, idx) => !toDelete.has(idx));
        
        if (remaining.length === 0) {
            alert('删除后图层将为空，操作取消');
            return;
        }
        
        const newD = remaining.map(p => p.trim()).join(' ');
        childLayer.svg = childLayer.svg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        
        if (childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.originalSvg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        this._createPathSelectOverlay(svgContainer, childLayer);
        
        console.log(`[LayerEditor] 删除 ${toDelete.size} 个子路径，剩余 ${remaining.length} 个`);
    }
    
    /**
     * 从子图层中删除复合路径中的某个子路径（连同内部孔洞一起删除）
     */
    _deleteSubPathFromChild(childLayer, subPathIndex) {
        if (!childLayer || !childLayer.svg) return;
        
        // 提取 d 属性
        const dMatch = childLayer.svg.match(/\bd="([^"]+)"/);
        if (!dMatch) return;
        
        const d = dMatch[1];
        const subPathRegex = /M[^M]+/gi;
        const subPaths = d.match(subPathRegex) || [];
        
        if (subPathIndex < 0 || subPathIndex >= subPaths.length) return;
        
        // 获取要删除的路径的边界框
        const targetBounds = this._getPathBounds(subPaths[subPathIndex]);
        
        // 找出所有需要删除的索引（目标 + 其内部的孔洞）
        const toDelete = new Set([subPathIndex]);
        
        if (targetBounds) {
            for (let i = 0; i < subPaths.length; i++) {
                if (i === subPathIndex) continue;
                const bounds = this._getPathBounds(subPaths[i]);
                // 如果这个路径完全在目标路径内部，一起删除
                if (this._boundsContains(targetBounds, bounds)) {
                    toDelete.add(i);
                }
            }
        }
        
        // 过滤掉要删除的路径
        const remaining = subPaths.filter((_, idx) => !toDelete.has(idx));
        
        if (remaining.length === 0) {
            alert('删除后图层将为空，操作取消');
            return;
        }
        
        const deletedCount = toDelete.size;
        
        // 重新组合 d 属性
        const newD = remaining.map(p => p.trim()).join(' ');
        
        // 更新 SVG
        childLayer.svg = childLayer.svg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        
        // 同时更新原始 SVG
        if (childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.originalSvg.replace(/\bd="[^"]+"/, `d="${newD}"`);
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        
        // 重新创建覆盖层
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        this._createPathSelectOverlay(svgContainer, childLayer);
        
        console.log(`[LayerEditor] 删除 ${deletedCount} 个子路径（含孔洞），剩余 ${remaining.length} 个`);
    }
    
    /**
     * 从子图层中删除指定路径（整个 path 元素）
     */
    _deletePathFromChild(childLayer, pathIndex) {
        if (!childLayer || !childLayer.svg) return;
        
        let currentIdx = 0;
        childLayer.svg = childLayer.svg.replace(/<path[^>]*\/?>(?:<\/path>)?/g, (match) => {
            if (currentIdx === pathIndex) {
                currentIdx++;
                return ''; // 删除这个路径
            }
            currentIdx++;
            return match;
        });
        
        // 同时更新原始 SVG
        if (childLayer.originalSvg) {
            currentIdx = 0;
            childLayer.originalSvg = childLayer.originalSvg.replace(/<path[^>]*\/?>(?:<\/path>)?/g, (match) => {
                if (currentIdx === pathIndex) {
                    currentIdx++;
                    return '';
                }
                currentIdx++;
                return match;
            });
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
        this._setupPathSelection(childLayer);
    }
    
    /**
     * 应用路径简化（实时后处理）
     */
    async _applySimplify(layer, level) {
        if (!layer || layer.type !== 'group' || !layer.children) return;
        
        // 动态导入简化模块
        const { simplifyPathD } = await import('./potrace-core/path-simplifier.js');
        
        // 检测是否为文字/Logo 类型，需要保持笔画宽度
        const preset = layer.vectorConfig?.preset || '';
        const preserveStroke = ['logo', 'lineart'].includes(preset);
        const simplifyOptions = { preserveStroke };
        
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
                        path.d = simplifyPathD(path._originalD, level, simplifyOptions);
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
    