/**
 * PPTGenerator 编辑器集成
 * 将 SlideEditor 集成到 PPTGenerator 的演示模式
 */
const PPTGeneratorEditor = {
    editor: null,
    propertyPanel: null,
    layerPanel: null,
    editorEnabled: false,

    /**
     * 初始化编辑器
     */
    async initEditor() {
        if (this.editor) return this.editor;

        // 检查依赖
        if (!window.SlideEditor) {
            console.warn('[PPTGeneratorEditor] SlideEditor 未加载');
            return null;
        }

        // 创建编辑器实例
        this.editor = new SlideEditor({
            autoSave: false, // PPTGenerator 有自己的保存逻辑
        });

        // 同步数据：PPTGenerator.slides → editor.document
        this.editor.document.load(this.slides || []);
        this.editor.currentSlideIndex = this.currentSlideIndex || 0;

        // 双向同步
        this._setupSync();

        console.log('[PPTGeneratorEditor] 编辑器已初始化');
        return this.editor;
    },

    /**
     * 启用编辑模式
     */
    async enableEditorMode() {
        if (this.editorEnabled) return;

        await this.initEditor();
        if (!this.editor) return;

        // 注入样式（首次）
        this._injectEditorStyles();

        // 显示右侧面板
        this._showEditorUI();

        // 同步数据到编辑器
        this._syncToEditor();

        // 绑定视口
        const viewport = document.getElementById('presSlideCanvas');
        console.log('[PPTGeneratorEditor] viewport:', viewport);
        
        if (viewport) {
            // 强制重新绑定
            viewport._editorBound = false;
            this.editor.viewport = viewport;
            this.editor._createOverlayContainer();
            this.editor._bindViewportEvents();
            this.editor._addElementIds();
        }

        // 初始化面板
        this._initPanels();

        // 显示编辑工具栏
        const editorTools = document.getElementById('editorTools');
        if (editorTools) editorTools.style.display = 'flex';

        // 更新按钮状态
        const editorModeBtn = document.getElementById('editorModeBtn');
        if (editorModeBtn) editorModeBtn.classList.add('active');

        // 绑定工具栏按钮事件
        this._bindToolbarEvents();

        // 绑定调整大小和交互行为
        this._bindSidebarResizer();
        this._bindPropertyPanelBehavior();

        // 触发 canvas 尺寸更新
        this._updateCanvasSize?.();

        // 启用编辑器交互
        if (this.editor) this.editor.enabled = true;
        
        // 添加编辑模式类（用于 CSS 控制 contenteditable）
        viewport?.classList.add('editor-enabled');
        
        this.editorEnabled = true;
        console.log('[PPTGeneratorEditor] 编辑模式已启用');
    },
    
    /**
     * 绑定工具栏按钮事件
     */
    _bindToolbarEvents() {
        if (this._toolbarBound) return;
        this._toolbarBound = true;
        
        // 撤销按钮
        document.querySelector('[title*="撤销"]')?.addEventListener('click', () => {
            this.editor?.history?.undo();
            this.editor?.renderCurrentSlide?.();
        });
        
        // 重做按钮
        document.querySelector('[title*="重做"]')?.addEventListener('click', () => {
            this.editor?.history?.redo();
            this.editor?.renderCurrentSlide?.();
        });
    },

    /**
     * 禁用编辑模式
     */
    disableEditorMode() {
        if (!this.editorEnabled) return;

        // 隐藏编辑器 UI
        this._hideEditorUI();

        // 移除覆盖层
        if (this.editor?.overlayContainer) {
            this.editor.overlayContainer.remove();
            this.editor.overlayContainer = null;
            this.editor.viewport = null;
        }

        // 隐藏编辑工具栏
        const editorTools = document.getElementById('editorTools');
        if (editorTools) editorTools.style.display = 'none';

        // 更新按钮状态
        const editorModeBtn = document.getElementById('editorModeBtn');
        if (editorModeBtn) editorModeBtn.classList.remove('active');

        // 清除选择
        this.editor?.selection?.deselectAll();
        
        // 禁用编辑器交互
        if (this.editor) this.editor.enabled = false;
        
        // 移除编辑模式类
        const viewport = document.getElementById('presSlideCanvas');
        viewport?.classList.remove('editor-enabled');

        // 触发 canvas 尺寸更新
        this._updateCanvasSize?.();

        this.editorEnabled = false;
        console.log('[PPTGeneratorEditor] 编辑模式已禁用');
    },

    /**
     * 切换编辑模式
     */
    toggleEditorMode() {
        if (this.editorEnabled) {
            this.disableEditorMode();
        } else {
            this.enableEditorMode();
        }
    },

    /**
     * 显示编辑器 UI（面板已在模板中预留）
     */
    _showEditorUI() {
        const panel = document.getElementById('editorRightPanel');
        const resizer = document.getElementById('editorSidebarResizer');
        const container = document.querySelector('.pres-container');
        const previewArea = document.querySelector('.ppt-preview-area');
        
        // 使用 body class 控制全局布局，更稳健
        document.body.classList.add('ppt-editor-active');
        
        if (previewArea) {
            previewArea.classList.add('expanded');
        }
        if (panel) {
            panel.style.display = 'flex';
        }
        if (resizer) {
            resizer.style.display = 'flex';
        }
        if (container) {
            container.classList.add('editor-active');
        }
        // 触发画布尺寸更新
        setTimeout(() => this._updateCanvasSize?.(), 50);
    },

    /**
     * 隐藏编辑器 UI
     */
    _hideEditorUI() {
        const panel = document.getElementById('editorRightPanel');
        const resizer = document.getElementById('editorSidebarResizer');
        const container = document.querySelector('.pres-container');
        const previewArea = document.querySelector('.ppt-preview-area');
        
        document.body.classList.remove('ppt-editor-active');
        
        // 隐藏编辑器面板
        if (panel) {
            panel.style.display = 'none';
        }
        if (resizer) {
            resizer.style.display = 'none';
        }
        if (previewArea) {
            previewArea.classList.remove('expanded');
        }
        if (container) {
            container.classList.remove('editor-active');
        }
        // 触发画布尺寸更新
        setTimeout(() => this._updateCanvasSize?.(), 50);
    },

    /**
     * 绑定侧边栏宽度调整
     */
    _bindSidebarResizer() {
        const resizer = document.getElementById('editorSidebarResizer');
        const panel = document.getElementById('editorRightPanel');
        
        if (!resizer || !panel) return;
        
        // 防止重复绑定
        if (resizer._bound) return;
        resizer._bound = true;

        let startX, startWidth;

        const onMouseMove = (e) => {
            // 向左拖动增加宽度（因为面板在右侧）
            const deltaX = startX - e.clientX;
            const newWidth = Math.max(240, Math.min(480, startWidth + deltaX));
            panel.style.width = `${newWidth}px`;
            // 更新画布尺寸以适应新空间
            requestAnimationFrame(() => this._updateCanvasSize?.());
        };

        const onMouseUp = () => {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = panel.getBoundingClientRect().width;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    /**
     * 绑定属性面板自动行为（双击展开，单击/滚动收起）
     */
    _bindPropertyPanelBehavior() {
        const layerPanel = document.getElementById('editorLayerPanel');
        const propPanel = document.getElementById('editorPropertyPanel');
        const propResizer = document.getElementById('editorPanelResizer');
        
        if (!layerPanel || !propPanel) return;
        
        // 防止重复绑定
        if (layerPanel._behaviorBound) return;
        layerPanel._behaviorBound = true;

        const expandPanel = () => {
            propPanel.style.height = '70%'; // 占据 70% 高度
            if (propResizer) propResizer.classList.add('visible');
        };

        const collapsePanel = () => {
            propPanel.style.height = '0';
            if (propResizer) propResizer.classList.remove('visible');
        };

        // 双击图层项展开
        layerPanel.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.layer-item');
            if (item) {
                expandPanel();
            }
        });

        // 单击图层面板（空白处）收起
        // 注意：如果单击的是 item，不应该收起（可能在选择），或者根据需求收起？
        // 用户说：单击图层...参数卡片消失。
        // 这意味着选中（单击）时不显示属性，只有双击才显示。
        // 所以单击 item 也要收起（如果它不是双击的一部分）。
        // 但双击包含两次单击。如何区分？
        // 通常双击事件后触发，单击事件也会触发。
        // 我们可以简单地让单击总是收起。双击会再次展开。
        // 但这会导致闪烁。
        // 更好的逻辑：
        // 1. 单击 item -> 选中 -> 收起（如果已展开）。
        // 2. 双击 item -> 展开。
        // 用户明确说：选中图层并双击的情况下...弹出来。单击图层...消失。
        
        layerPanel.addEventListener('click', (e) => {
            // 如果点击的是 group header 或 item，都视为“单击图层”
            // 除非是双击（dblclick 会在 click 之后触发，但我们无法预测未来）
            // 为了避免双击被单击打断，我们可以不做处理，让双击重新打开。
            // 或者，利用 setTimeout 延迟 click 处理？
            // 但这会延迟选中反馈。
            
            // 既然用户要求单击收起，那我们就收起。
            // 双击会再次展开，覆盖收起的操作。
            // 唯一的问题是动画：收起动画开始 -> 展开动画开始。
            // 可能会有视觉跳动。
            
            // 另一种解读：单击仅仅是“选中”，如果面板开着，就关掉？
            // "单击图层...参数卡片消失"
            
            collapsePanel();
        });

        // 滚动收起
        // 需要监听 layerPanel 内部列表的滚动
        // layerPanel 是容器，内部有 .layer-list 负责滚动
        // 但目前 LayerPanel.js 渲染结构是 .layer-list 在内。
        // 我们使用 capture 捕获滚动事件
        layerPanel.addEventListener('scroll', () => {
            collapsePanel();
        }, { capture: true, passive: true });

        // 绑定编辑器选择事件 (处理失去焦点自动收起)
        if (!this._propPanelSelectionHandler) {
            this._propPanelSelectionHandler = () => {
                const selectedIds = this.editor.selection.getSelectedIds();
                if (selectedIds.length === 0) {
                    // 失去焦点，收起面板
                    const propPanel = document.getElementById('editorPropertyPanel');
                    const propResizer = document.getElementById('editorPanelResizer');
                    if (propPanel) {
                        propPanel.style.height = '0';
                        if (propResizer) propResizer.classList.remove('visible');
                    }
                }
            };
            this.editor.selection.on('change', this._propPanelSelectionHandler);
        }
    },

    // 保留样式注入（首次使用时）
    _injectEditorStyles() {
        if (document.getElementById('editorPanelStyle')) return;

        const style = document.createElement('style');
        style.id = 'editorPanelStyle';
        style.textContent = `
            /* 编辑模式下的容器布局 */
            .pres-container {
                display: flex !important;
                width: 100%;
                height: 100%;
            }
            .pres-main-area {
                flex: 1;
                min-width: 0;
                transition: margin-right 0.2s ease;
            }
            /* 编辑模式启用时，主区域右侧留出面板空间 */
            .pres-container.editor-active .pres-main-area {
                margin-right: 0;
            }
            
            /* 右侧编辑面板 - 与聊天栏风格一致 */
            .editor-right-panel {
                width: 280px; /* Default width */
                min-width: 240px;
                max-width: 480px;
                background: white;
                border: 1px solid var(--ppt-border, #e5e7eb);
                border-radius: 24px;
                display: flex;
                flex-direction: column;
                flex-shrink: 0;
                margin: 16px;
                margin-left: 0;
                height: calc(100% - 32px);
                box-shadow: 0 1px 3px rgba(0,0,0,0.08);
                z-index: 50;
                overflow: hidden;
                position: relative;
            }
            
            /* 侧边栏宽度调整器 */
            .editor-sidebar-resizer {
                width: 16px;
                margin: 16px 0; /* Align with panel top/bottom margin */
                cursor: col-resize;
                z-index: 55;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                margin-right: -8px; /* Pull closer to panel */
                position: relative;
            }
            
            .editor-sidebar-resizer::after {
                content: '';
                width: 4px;
                height: 48px;
                background: rgba(0,0,0,0.1);
                border-radius: 2px;
                transition: all 0.2s;
            }
            
            .editor-sidebar-resizer:hover::after, .editor-sidebar-resizer.dragging::after {
                background: var(--ppt-primary);
                height: 64px;
            }

            /* 面板内容区 - 上下布局 */
            .editor-panel-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            
            /* 面板容器 */
            .panel-pane {
                display: flex;
                flex-direction: column;
                min-height: 0;
                overflow: hidden;
            }
            
            /* 图层面板 (上方，自适应) */
            #editorLayerPanel {
                flex: 1;
                min-height: 100px;
            }
            
            /* 属性面板 (下方，从底部弹出) */
            #editorPropertyPanel {
                height: 0; /* 默认隐藏 */
                flex-shrink: 0;
                border-top: 1px solid #e5e7eb;
                overflow-y: auto;
                transition: height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                background: #fcfcfc;
            }
            
            /* 面板调整器 */
            .editor-panel-resizer {
                height: 8px;
                background: #f9fafb;
                border-top: 1px solid #e5e7eb;
                border-bottom: 1px solid #e5e7eb;
                cursor: row-resize;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
                /* 默认隐藏，只有属性面板展开时才需要显示? 
                   或者一直显示在底部作为把手?
                   为了体验，当 height=0 时隐藏 resizer 更好 */
                display: none; 
            }
            
            #editorPropertyPanel.expanded + .editor-panel-resizer, /* If resizer is after */
            .editor-panel-resizer.visible {
                display: flex;
            }
            
            .editor-panel-resizer:hover, .editor-panel-resizer.dragging {
                background: #f3f4f6;
            }
            
            .editor-panel-resizer::after {
                content: '';
                width: 32px;
                height: 3px;
                background: #d1d5db;
                border-radius: 2px;
            }
            
            /* 对齐下拉菜单 */
            .pres-tool-dropdown {
                position: relative;
            }
            .pres-tool-dropdown-menu {
                position: absolute;
                bottom: 100%;
                left: 0;
                margin-bottom: 4px;
                background: white;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
                min-width: 140px;
                z-index: 1000;
                padding: 4px 0;
            }
            .pres-tool-dropdown-menu button {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 8px 12px;
                border: none;
                background: transparent;
                cursor: pointer;
                font-size: 12px;
                color: #374151;
                text-align: left;
            }
            .pres-tool-dropdown-menu button:hover {
                background: #f3f4f6;
            }
            .pres-tool-dropdown-menu .dropdown-divider {
                height: 1px;
                background: #e5e7eb;
                margin: 4px 0;
            }
            
            /* 全局编辑模式状态控制 */
            body.ppt-editor-active .ppt-chat-sidebar,
            body.ppt-editor-active .ppt-resizer {
                display: none !important;
            }
            
            body.ppt-editor-active .ppt-preview-area {
                margin-right: 0 !important;
            }
        `;
        document.head.appendChild(style);
        
        // 绑定对齐下拉菜单
        this._bindAlignDropdown();
        
        // 绑定垂直 Resizer
        this._bindPanelResizer();
    },
    
    /**
     * 绑定面板垂直 Resizer
     */
    _bindPanelResizer() {
        const resizer = document.getElementById('editorPanelResizer');
        const propertyPanel = document.getElementById('editorPropertyPanel');
        const container = document.querySelector('.editor-right-panel');
        
        if (!resizer || !propertyPanel || !container) return;
        
        let startY, startHeight;
        
        const onMouseMove = (e) => {
            const deltaY = startY - e.clientY; // 向上拖动增加高度
            const newHeight = Math.max(100, Math.min(container.clientHeight - 150, startHeight + deltaY));
            propertyPanel.style.height = `${newHeight}px`;
        };
        
        const onMouseUp = () => {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startHeight = propertyPanel.offsetHeight;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },
    
    /**
     * 绑定对齐下拉菜单事件
     */
    _bindAlignDropdown() {
        const btn = document.getElementById('alignDropdownBtn');
        const menu = document.getElementById('alignDropdownMenu');
        if (!btn || !menu) return;
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        
        // 点击菜单项后关闭
        menu.addEventListener('click', () => {
            menu.style.display = 'none';
        });
        
        // 点击其他地方关闭
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.style.display = 'none';
            }
        });
    },

    /**
     * 初始化面板
     */
    _initPanels() {
        if (!this.editor) return;

        // 属性面板
        if (window.PropertyPanel && !this.propertyPanel) {
            this.propertyPanel = new PropertyPanel(this.editor, 'editorPropertyPanel');
        }

        // 图层面板
        if (window.LayerPanel && !this.layerPanel) {
            this.layerPanel = new LayerPanel(this.editor, 'editorLayerPanel');
            this.layerPanel.refresh();
        }
    },

    /**
     * 设置数据同步
     */
    _setupSync() {
        if (!this.editor) return;
        
        // 注意：不再自动监听 document 事件触发渲染
        // 渲染由各个操作方法（updateElement 等）自行控制
        // 这样可以避免无限循环渲染问题

        // 幻灯片切换同步
        this.editor.on('slide:change', ({ index }) => {
            if (this.currentSlideIndex !== index) {
                this.currentSlideIndex = index;
                this._updateThumbnails();
            }
        });
    },

    /**
     * 同步数据到 PPTGenerator（不触发渲染）
     */
    _syncToGenerator() {
        if (!this.editor?.document) return;
        this.slides = this.editor.document.toJSON();
        // 标记为需要保存
        if (typeof this.setAutoSaveNeeded === 'function') {
            this.setAutoSaveNeeded();
        }
    },

    /**
     * 同步数据到编辑器
     */
    _syncToEditor() {
        if (!this.editor) return;
        
        // 加载数据到编辑器
        this.editor.document.load(this.slides || []);
        this.editor.currentSlideIndex = this.currentSlideIndex || 0;
        
        // 绑定视口
        const viewport = document.getElementById('presSlideCanvas');
        if (viewport) {
            this.editor.viewport = viewport;
            this.editor._createOverlayContainer();
            this.editor._addElementIds();
        }
    },
    
    /**
     * 重新渲染当前幻灯片（使用 PPTGenerator 的渲染器）
     */
    _rerenderSlide() {
        const viewport = document.getElementById('presSlideCanvas');
        if (!viewport || !this.slides || !this.slides[this.currentSlideIndex]) return;
        
        const slide = this.slides[this.currentSlideIndex];
        const html = this._renderSlideContent(slide);
        viewport.innerHTML = html;
        
        // 重新添加元素 ID
        if (this.editor) {
            this.editor.viewport = viewport;
            this.editor._addElementIds();
            this.editor._updateOverlay();
        }
    },

    /**
     * 更新缩略图
     */
    _updateThumbnails() {
        const thumbnails = document.querySelectorAll('.ppt-thumb-item');
        thumbnails.forEach((thumb, index) => {
            thumb.classList.toggle('active', index === this.currentSlideIndex);
        });
        const pageInfo = document.getElementById('presPageInfo');
        if (pageInfo) {
            pageInfo.textContent = `${this.currentSlideIndex + 1} / ${this.slides.length}`;
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // 编辑操作（暴露给 UI）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 添加文本
     */
    addText() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.addElement('text');
    },

    /**
     * 添加图片
     */
    async addImage() {
        if (!this.editor || !this.editorEnabled) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            if (e.target.files[0]) {
                await this.editor.addImageFromFile(e.target.files[0]);
            }
        };
        input.click();
    },

    /**
     * 添加形状
     */
    addShape(shapeType = 'rect') {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.addElement('shape', { shapeType });
    },

    /**
     * 添加图表
     */
    addChart(chartType = 'bar') {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.addElement('chart', { chartType });
    },

    /**
     * 添加图标
     */
    addIcon(icon = 'mdi:star') {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.addElement('icon', { icon });
    },

    /**
     * 添加公式
     */
    addFormula(latex = 'E = mc^2') {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.addElement('formula', { latex });
    },

    /**
     * 删除选中元素
     */
    deleteSelected() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.deleteSelected();
    },

    /**
     * 复制选中元素
     */
    duplicateSelected() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.duplicateSelected();
    },

    /**
     * 撤销
     */
    undo() {
        if (!this.editor) return;
        this.editor.history.undo();
        // 重新渲染视图
        this.editor.renderCurrentSlide?.();
    },

    /**
     * 重做
     */
    redo() {
        if (!this.editor) return;
        this.editor.history.redo();
        // 重新渲染视图
        this.editor.renderCurrentSlide?.();
    },
    
    /**
     * 对齐选中元素
     */
    align(type) {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.alignElements(type);
    },

    /**
     * 删除选中元素
     */
    deleteSelected() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.deleteSelected();
    },

    /**
     * 移动到最前
     */
    bringToFront() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.bringToFront();
    },

    /**
     * 移动到最后
     */
    sendToBack() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.sendToBack();
    },

    /**
     * 图层上移
     */
    moveElementUp(elementId) {
        if (!this.editor || !this.editorEnabled) return;
        const id = elementId || this.editor.selection.getSelectedIds()[0];
        if (!id) return;
        
        const slide = this.slides?.[this.editor.currentSlideIndex];
        if (!slide?.elements) return;
        
        const index = slide.elements.findIndex(el => el.id === id);
        if (index < slide.elements.length - 1) {
            // 交换位置
            [slide.elements[index], slide.elements[index + 1]] = 
                [slide.elements[index + 1], slide.elements[index]];
            // 同步 document
            this.editor.document.reorderElement?.(id, index + 1);
            this.editor.renderCurrentSlide();
        }
    },

    /**
     * 图层下移
     */
    moveElementDown(elementId) {
        if (!this.editor || !this.editorEnabled) return;
        const id = elementId || this.editor.selection.getSelectedIds()[0];
        if (!id) return;
        
        const slide = this.slides?.[this.editor.currentSlideIndex];
        if (!slide?.elements) return;
        
        const index = slide.elements.findIndex(el => el.id === id);
        if (index > 0) {
            // 交换位置
            [slide.elements[index], slide.elements[index - 1]] = 
                [slide.elements[index - 1], slide.elements[index]];
            // 同步 document
            this.editor.document.reorderElement?.(id, index - 1);
            this.editor.renderCurrentSlide();
        }
    },
};

// 混入到 PPTGenerator
if (typeof window.PPTGenerator !== 'undefined') {
    Object.assign(window.PPTGenerator, PPTGeneratorEditor);
    console.log('[PPTGeneratorEditor] 已混入到 PPTGenerator');
} else {
    console.warn('[PPTGeneratorEditor] PPTGenerator 未定义，混入失败');
}
