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
        console.log('[PPTGeneratorEditor] initEditor() called', {
            hasEditor: !!this.editor,
            editorEnabled: !!this.editorEnabled,
        });

        if (this.editor) {
            console.log('[PPTGeneratorEditor] initEditor() reuse existing editor');
            return this.editor;
        }

        // 检查依赖（注意：class 声明通常不会挂到 window 上）
        const SlideEditorCtor =
            window.SlideEditor || (typeof SlideEditor !== 'undefined' ? SlideEditor : null);

        console.log('[PPTGeneratorEditor] SlideEditor availability', {
            windowSlideEditor: !!window.SlideEditor,
            globalSlideEditor: typeof SlideEditor !== 'undefined',
            resolved: !!SlideEditorCtor,
        });

        if (!SlideEditorCtor) {
            console.warn('[PPTGeneratorEditor] SlideEditor 未加载（window.SlideEditor/global SlideEditor 均不可用）');
            return null;
        }

        // 创建编辑器实例
        this.editor = new SlideEditorCtor({
            autoSave: false, // PPTGenerator 有自己的保存逻辑
        });

        // 同步数据：PPTGenerator.slides → editor.document
        console.log('[PPTGeneratorEditor] initEditor() syncing slides to editor', {
            slidesLength: Array.isArray(this.slides) ? this.slides.length : null,
            currentSlideIndex: this.currentSlideIndex ?? null,
        });
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

        try {
            await this.initEditor();
            if (!this.editor) {
                console.warn('[PPTGeneratorEditor] enableEditorMode aborted: editor not initialized');
                return;
            }

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
        } catch (err) {
            console.error('[PPTGeneratorEditor] enableEditorMode() failed:', err);
        }
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
        console.log('[PPTGeneratorEditor] toggleEditorMode() called', {
            editorEnabled: !!this.editorEnabled,
            hasEditor: !!this.editor,
        });
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
            
            // 监听属性面板操作
            this.propertyPanel.on('action', ({ action, element }) => {
                if (action === 'replace-image' && element) {
                    this._replaceImage(element);
                } else if (action === 'ai-generate-image' && element) {
                    this._aiGenerateImage(element);
                }
            });
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
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addText ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }
        this.editor.addElement('text');
    },

    /**
     * 添加图片
     */
    async addImage() {
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addImage ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }

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
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addShape ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }
        this.editor.addElement('shape', { shapeType });
    },

    /**
     * 添加图表
     */
    addChart(chartType = 'bar') {
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addChart ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }
        this.editor.addElement('chart', { chartType });
    },

    /**
     * 添加图标
     */
    addIcon(icon = 'mdi:star') {
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addIcon ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }
        this.editor.addElement('icon', { icon });
    },

    /**
     * 添加公式
     */
    addFormula(latex = 'E = mc^2') {
        if (!this.editor || !this.editorEnabled) {
            console.warn('[PPTGeneratorEditor] addFormula ignored: editor not enabled. 请先点击“编辑模式”按钮。', {
                hasEditor: !!this.editor,
                editorEnabled: !!this.editorEnabled,
            });
            return;
        }
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
     * 编组选中元素
     */
    groupElements() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.groupElements();
    },

    /**
     * 解组选中的组
     */
    ungroupElements() {
        if (!this.editor || !this.editorEnabled) return;
        this.editor.ungroupElements();
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

    // 生图任务队列
    _imageGenTasks: [],
    _imageGenIndicator: null,

    /**
     * 更新生图进度指示
     */
    _updateImageGenIndicator() {
        const tasks = this._imageGenTasks;
        const running = tasks.filter(t => t.status === 'running').length;
        const total = tasks.length;
        
        if (total === 0) {
            // 移除指示器
            if (this._imageGenIndicator) {
                this._imageGenIndicator.remove();
                this._imageGenIndicator = null;
            }
            return;
        }
        
        // 创建或更新指示器
        if (!this._imageGenIndicator) {
            this._imageGenIndicator = document.createElement('div');
            this._imageGenIndicator.className = 'fixed top-4 right-4 z-[9998] bg-white rounded-lg shadow-lg border border-violet-200 px-4 py-3 flex items-center gap-3';
            this._imageGenIndicator.innerHTML = `
                <div class="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"></div>
                <span class="text-sm text-gray-700" id="imageGenStatus"></span>
            `;
            document.body.appendChild(this._imageGenIndicator);
        }
        
        const statusEl = this._imageGenIndicator.querySelector('#imageGenStatus');
        const completed = tasks.filter(t => t.status === 'done' || t.status === 'error').length;
        statusEl.textContent = `生图中 ${completed}/${total}`;
    },

    /**
     * 替换图片
     */
    _replaceImage(element) {
        if (!element || element.type !== 'image') return;
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                
                // 更新图片源
                this.editor.updateElement(element.id, { src: dataUrl });
            } catch (err) {
                console.error('[_replaceImage] 读取图片失败:', err);
            }
        };
        input.click();
    },

    /**
     * AI 生图
     */
    async _aiGenerateImage(element) {
        if (!element || element.type !== 'image') return;
        
        // 检查 ImageGeneration 是否可用
        if (!window.ImageGeneration?.generateImage) {
            alert('AI 生图服务未加载，请检查配置');
            return;
        }
        
        // 显示生图对话框
        const result = await this._showAiImageDialog(element);
        if (!result) return;
        
        const { prompt, aspectRatio, imageSize, referenceImages, useSlideText } = result;
        
        // 提取当前页文字（如果需要）
        let slideText = '';
        if (useSlideText || referenceImages?.some(r => r.type === 'snapshot')) {
            slideText = this._extractSlideText();
        }
        
        // 创建任务
        const task = {
            id: `${element.id}_${Date.now()}`,
            elementId: element.id,
            slideIndex: this.currentSlideIndex,
            prompt,
            aspectRatio,
            imageSize,
            referenceImages: referenceImages || [],
            useSlideText,
            slideText,
            status: 'running',
            originalSrc: element.src
        };
        
        this._imageGenTasks.push(task);
        this._updateImageGenIndicator();
        
        // 显示加载状态
        const loadingPlaceholder = 'data:image/svg+xml,' + encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                <rect fill="#f3f4f6" width="200" height="200"/>
                <text x="100" y="100" text-anchor="middle" fill="#9ca3af" font-size="14">AI 生成中...</text>
            </svg>
        `);
        this.editor.updateElement(element.id, { src: loadingPlaceholder });
        
        // 异步执行生图（不阻塞）
        this._executeImageGen(task);
    },

    /**
     * 执行生图任务
     */
    async _executeImageGen(task) {
        try {
            // 构建智能提示词
            const smartPrompt = this._buildSmartPrompt(task);
            
            // 提取纯图片数据用于 API
            const imageDataList = (task.referenceImages || []).map(r => r.data);
            
            const genResult = await window.ImageGeneration.generateImage({
                prompt: smartPrompt,
                aspectRatio: task.aspectRatio,
                imageSize: task.imageSize,
                referenceImages: imageDataList,
                width: 1024,
                height: 768
            });
            
            // 获取图片数据
            let imgSrc;
            if (genResult.base64) {
                imgSrc = genResult.base64.startsWith('data:') 
                    ? genResult.base64 
                    : `data:${genResult.mimeType || 'image/png'};base64,${genResult.base64}`;
            } else if (genResult.url) {
                imgSrc = genResult.url;
            } else {
                throw new Error('未获取到图片数据');
            }
            
            // 如果是框选生成（临时 ID），只返回数据不更新元素
            if (task.elementId?.startsWith('region_')) {
                task.status = 'done';
                if (typeof showNotification === 'function') {
                    showNotification('AI 生图成功', 'success');
                }
                return { dataUrl: imgSrc };
            }
            
            // 更新元素（无论当前在哪个页面）
            this.editor.updateElement(task.elementId, { src: imgSrc });
            
            // 保存该元素的生图记录
            this._saveImageGenHistory(task.elementId, { 
                prompt: task.prompt, 
                aspectRatio: task.aspectRatio, 
                imageSize: task.imageSize, 
                time: Date.now() 
            });
            
            task.status = 'done';
            if (typeof showNotification === 'function') {
                showNotification('AI 生图成功', 'success');
            }
            return { dataUrl: imgSrc };
        } catch (err) {
            console.error('[_executeImageGen] 生图失败:', err);
            // 恢复原图（仅非框选模式）
            if (!task.elementId?.startsWith('region_')) {
                this.editor.updateElement(task.elementId, { src: task.originalSrc });
            }
            task.status = 'error';
            task.error = err.message;
            if (typeof showNotification === 'function') {
                showNotification('生图失败: ' + (err.message || '未知错误'), 'error');
            }
            return null;
        } finally {
            this._updateImageGenIndicator();
            // 3秒后清理已完成的任务
            setTimeout(() => {
                this._imageGenTasks = this._imageGenTasks.filter(t => t.status === 'running');
                this._updateImageGenIndicator();
            }, 3000);
        }
    },

    /**
     * 构建智能提示词
     */
    _buildSmartPrompt(task) {
        const refs = task.referenceImages || [];
        const userPrompt = task.prompt.trim();
        
        // 如果没有参考图片，直接返回用户提示词
        if (refs.length === 0 && !task.useSlideText) {
            return userPrompt;
        }
        
        // 构建上下文说明
        let contextParts = [];
        
        // 核心指令：只生成素材本身
        contextParts.push('IMPORTANT: Generate ONLY the image asset itself. Do NOT include any text, labels, borders, frames, or page layout elements.');
        
        // 添加页面文字背景（如果有）- 仅作为主题参考
        if (task.slideText) {
            contextParts.push(`Context theme: "${task.slideText}" - use this only to understand the topic, do NOT include any text in the output image.`);
        }
        
        // 按顺序说明每张参考图片
        if (refs.length > 0) {
            const imageDescriptions = [];
            refs.forEach((ref, idx) => {
                const imgNum = idx + 1;
                if (ref.type === 'current') {
                    imageDescriptions.push(`Image ${imgNum}: Current image to replace - reference its style/subject.`);
                } else if (ref.type === 'snapshot') {
                    imageDescriptions.push(`Image ${imgNum}: Page context (for theme understanding only, do NOT copy its layout).`);
                } else if (ref.type === 'upload') {
                    imageDescriptions.push(`Image ${imgNum}: Style/content reference.`);
                }
            });
            contextParts.push(imageDescriptions.join(' '));
        }
        
        // 组合最终提示词
        const context = contextParts.join(' ');
        const finalPrompt = `${context}\n\nGenerate: ${userPrompt}`;
        
        console.log('[_buildSmartPrompt]', finalPrompt);
        return finalPrompt;
    },

    /**
     * 提取当前页的文字内容
     */
    _extractSlideText() {
        try {
            const slide = this.slides?.[this.currentSlideIndex];
            if (!slide?.elements) return '';
            
            const texts = [];
            for (const el of slide.elements) {
                if (el.type === 'text' && el.content) {
                    // 去除 HTML 标签
                    const text = el.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (text) texts.push(text);
                }
            }
            return texts.join('; ').slice(0, 500); // 限制长度
        } catch (e) {
            console.warn('[_extractSlideText] 提取文字失败:', e);
            return '';
        }
    },

    /**
     * 根据元素尺寸计算最佳比例
     */
    _detectBestAspectRatio(width, height) {
        const ratio = width / height;
        // 匹配最接近的比例
        const ratios = [
            { value: '1:1', ratio: 1 },
            { value: '16:9', ratio: 16/9 },
            { value: '9:16', ratio: 9/16 },
            { value: '4:3', ratio: 4/3 },
            { value: '3:4', ratio: 3/4 }
        ];
        let best = ratios[0];
        let minDiff = Math.abs(ratio - best.ratio);
        for (const r of ratios) {
            const diff = Math.abs(ratio - r.ratio);
            if (diff < minDiff) {
                minDiff = diff;
                best = r;
            }
        }
        return best.value;
    },

    /**
     * 显示 AI 生图对话框
     * @param {Object} element - 目标元素
     * @param {Array} initialReferenceImages - 初始参考图片（可选）
     */
    _showAiImageDialog(element, initialReferenceImages = []) {
        return new Promise((resolve) => {
            // 获取保存的配置
            const cfg = typeof loadModelConfig === 'function' ? (loadModelConfig('gemini-image') || {}) : {};
            // 根据元素尺寸自动检测比例（优先使用百分比转换后的像素值）
            const slideWidth = 960, slideHeight = 540; // 标准幻灯片尺寸
            let elWidth = element.width || 200;
            let elHeight = element.height || 200;
            // 如果是百分比，转换为像素
            if (typeof elWidth === 'string' && elWidth.endsWith('%')) {
                elWidth = parseFloat(elWidth) / 100 * slideWidth;
            }
            if (typeof elHeight === 'string' && elHeight.endsWith('%')) {
                elHeight = parseFloat(elHeight) / 100 * slideHeight;
            }
            console.log('[_showAiImageDialog] 元素尺寸:', elWidth, 'x', elHeight);
            const autoRatio = this._detectBestAspectRatio(elWidth, elHeight);
            console.log('[_showAiImageDialog] 自动检测比例:', autoRatio);
            const savedRatio = cfg.aspectRatio || autoRatio;
            const savedSize = cfg.imageSize || '1K';
            
            // 获取该元素的生图记录
            const history = this._getImageGenHistory(element.id);
            const historyHtml = history.length > 0 
                ? history.slice(0, 5).map((h, i) => `
                    <div class="ai-history-item flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer text-xs" data-index="${i}">
                        <span class="flex-1 truncate text-gray-600">${h.prompt}</span>
                        <span class="text-gray-400 whitespace-nowrap">${h.aspectRatio} · ${h.imageSize}</span>
                    </div>
                `).join('')
                : '<div class="text-xs text-gray-400 p-2">暂无记录</div>';
            
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]';
            overlay.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl w-[520px] max-w-[90vw] max-h-[90vh] flex flex-col">
                    <div class="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                        <h3 class="text-lg font-semibold text-gray-900">AI 生成图片</h3>
                        <button id="aiClose" class="text-gray-400 hover:text-gray-600">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <div class="p-5 space-y-4 overflow-y-auto flex-1">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">图片描述 <span class="text-gray-400 font-normal">(英文效果更佳)</span></label>
                            <textarea id="aiPrompt" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500" placeholder="A professional photo of..."></textarea>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">比例 <span class="text-gray-400 font-normal">(自动: ${autoRatio})</span></label>
                                <select id="aiAspectRatio" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="1:1" ${savedRatio === '1:1' ? 'selected' : ''}>1:1 正方形</option>
                                    <option value="16:9" ${savedRatio === '16:9' ? 'selected' : ''}>16:9 横屏</option>
                                    <option value="9:16" ${savedRatio === '9:16' ? 'selected' : ''}>9:16 竖屏</option>
                                    <option value="4:3" ${savedRatio === '4:3' ? 'selected' : ''}>4:3 传统</option>
                                    <option value="3:4" ${savedRatio === '3:4' ? 'selected' : ''}>3:4 竖版</option>
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-700 mb-1">分辨率</label>
                                <select id="aiImageSize" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                                    <option value="1K" ${savedSize === '1K' ? 'selected' : ''}>1K 默认</option>
                                    <option value="2K" ${savedSize === '2K' ? 'selected' : ''}>2K 标准</option>
                                    <option value="4K" ${savedSize === '4K' ? 'selected' : ''}>4K 高清</option>
                                </select>
                            </div>
                        </div>
                        <!-- 以图生图选项 -->
                        <div class="border border-gray-200 rounded-md p-3 space-y-3">
                            <label class="block text-sm font-medium text-gray-700">参考图片 <span class="text-gray-400 font-normal">(可选，AI 会根据图片类型自动理解上下文)</span></label>
                            <div class="flex flex-wrap gap-2" id="aiRefImages"></div>
                            <div class="flex flex-wrap gap-2">
                                <button id="aiAddCurrentImage" class="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                    当前图片
                                </button>
                                <button id="aiAddPageSnapshot" class="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"/></svg>
                                    当前页截图
                                </button>
                                <button id="aiUploadRef" class="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                                    上传图片
                                </button>
                                <button id="aiRegionSelect" class="px-3 py-1.5 text-xs border border-violet-300 text-violet-600 rounded hover:bg-violet-50 flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h4a1 1 0 010 2H6v3a1 1 0 01-2 0V5zm16 0a1 1 0 00-1-1h-4a1 1 0 000 2h3v3a1 1 0 002 0V5zM4 19a1 1 0 001 1h4a1 1 0 000-2H6v-3a1 1 0 00-2 0v4zm16 0a1 1 0 01-1 1h-4a1 1 0 010-2h3v-3a1 1 0 012 0v4z"/></svg>
                                    框选截图
                                </button>
                            </div>
                            <div class="flex items-center gap-2 mt-2">
                                <input type="checkbox" id="aiUseSlideText" class="rounded border-gray-300">
                                <label for="aiUseSlideText" class="text-xs text-gray-600">将当前页文字作为背景信息</label>
                            </div>
                            <details class="mt-2">
                                <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700">查看注入的提示词</summary>
                                <pre id="aiSmartPromptPreview" class="mt-1 p-2 bg-gray-50 rounded text-[10px] text-gray-600 max-h-24 overflow-auto whitespace-pre-wrap"></pre>
                            </details>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">最近使用</label>
                            <div class="border border-gray-200 rounded-md max-h-24 overflow-y-auto" id="aiHistory">
                                ${historyHtml}
                            </div>
                        </div>
                    </div>
                    <div class="px-5 py-4 border-t border-gray-200 flex justify-between">
                        <button id="aiRegenerate" class="px-4 py-2 text-sm text-violet-600 hover:bg-violet-50 rounded-md flex items-center gap-1" title="使用相同提示词重新生成">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                            重新生成
                        </button>
                        <div class="flex gap-3">
                            <button id="aiCancel" class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">取消</button>
                            <button id="aiGenerate" class="px-4 py-2 text-sm text-white bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 rounded-md">生成</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            
            const promptInput = overlay.querySelector('#aiPrompt');
            const ratioSelect = overlay.querySelector('#aiAspectRatio');
            const sizeSelect = overlay.querySelector('#aiImageSize');
            const refImagesContainer = overlay.querySelector('#aiRefImages');
            
            // 参考图片列表 { data, type: 'current'|'snapshot'|'upload'|'region' }
            const referenceImages = [...initialReferenceImages];
            const typeLabels = { current: '原图', snapshot: '页面', upload: '上传', region: '框选' };
            const typeColors = { current: 'bg-blue-500', snapshot: 'bg-purple-500', upload: 'bg-gray-500', region: 'bg-violet-500' };
            const previewEl = overlay.querySelector('#aiSmartPromptPreview');
            
            // 更新提示词预览
            const updatePromptPreview = () => {
                const useSlideText = overlay.querySelector('#aiUseSlideText')?.checked || false;
                const prompt = promptInput.value.trim() || '[用户提示词]';
                const slideText = (useSlideText || referenceImages.some(r => r.type === 'snapshot')) 
                    ? this._extractSlideText() : '';
                
                // 模拟构建提示词
                const mockTask = { prompt, referenceImages, useSlideText, slideText };
                const smartPrompt = this._buildSmartPrompt(mockTask);
                previewEl.textContent = smartPrompt;
            };
            
            const updateRefImagesUI = () => {
                refImagesContainer.innerHTML = referenceImages.map((img, i) => `
                    <div class="relative group">
                        <img src="${img.data}" class="w-16 h-16 object-cover rounded border border-gray-200">
                        <span class="absolute bottom-0 left-0 right-0 ${typeColors[img.type]} text-white text-[10px] text-center py-0.5 rounded-b">${typeLabels[img.type]}</span>
                        <button class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity" data-remove="${i}">×</button>
                    </div>
                `).join('');
                // 绑定删除事件
                refImagesContainer.querySelectorAll('[data-remove]').forEach(btn => {
                    btn.onclick = () => {
                        referenceImages.splice(parseInt(btn.dataset.remove), 1);
                        updateRefImagesUI();
                    };
                });
                updatePromptPreview();
            };
            
            // 添加当前图片作为参考
            overlay.querySelector('#aiAddCurrentImage').onclick = () => {
                if (element.src && !element.src.includes('AI 生成中')) {
                    referenceImages.push({ data: element.src, type: 'current' });
                    updateRefImagesUI();
                }
            };
            
            // 添加当前页截图作为参考
            overlay.querySelector('#aiAddPageSnapshot').onclick = async () => {
                const btn = overlay.querySelector('#aiAddPageSnapshot');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<span class="animate-pulse">截图中...</span>';
                btn.disabled = true;
                
                try {
                    const snapshot = await this._captureSlideSnapshot(element.id);
                    if (snapshot) {
                        referenceImages.push({ data: snapshot, type: 'snapshot' });
                        updateRefImagesUI();
                    } else {
                        alert('截图失败，请检查控制台');
                    }
                } catch (e) {
                    console.error('截图失败:', e);
                    alert('截图失败: ' + e.message);
                } finally {
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            };
            
            // 上传参考图片
            overlay.querySelector('#aiUploadRef').onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.multiple = true;
                input.onchange = async (e) => {
                    for (const file of e.target.files) {
                        const dataUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.readAsDataURL(file);
                        });
                        referenceImages.push({ data: dataUrl, type: 'upload' });
                    }
                    updateRefImagesUI();
                };
                input.click();
            };
            
            // 框选截图
            overlay.querySelector('#aiRegionSelect').onclick = async () => {
                // 临时隐藏对话框
                overlay.style.display = 'none';
                
                try {
                    const regionData = await this._captureRegion();
                    if (regionData) {
                        referenceImages.push({ data: regionData, type: 'upload' });
                        updateRefImagesUI();
                    }
                } catch (e) {
                    console.error('框选截图失败:', e);
                } finally {
                    overlay.style.display = '';
                }
            };
            
            promptInput.focus();
            
            // 绑定输入和复选框事件来更新预览
            promptInput.oninput = updatePromptPreview;
            overlay.querySelector('#aiUseSlideText').onchange = updatePromptPreview;
            
            // 初始化显示（包括预置的参考图片）
            updateRefImagesUI();
            updatePromptPreview();
            
            const close = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };
            
            // 点击历史记录填充
            overlay.querySelector('#aiHistory').onclick = (e) => {
                const item = e.target.closest('.ai-history-item');
                if (item) {
                    const idx = parseInt(item.dataset.index);
                    const h = history[idx];
                    if (h) {
                        promptInput.value = h.prompt;
                        ratioSelect.value = h.aspectRatio;
                        sizeSelect.value = h.imageSize;
                        updatePromptPreview();
                    }
                }
            };
            
            overlay.querySelector('#aiClose').onclick = () => close(null);
            overlay.querySelector('#aiCancel').onclick = () => close(null);
            
            // 重新生成：使用上次的提示词
            overlay.querySelector('#aiRegenerate').onclick = () => {
                if (history.length > 0) {
                    const last = history[0];
                    close({
                        prompt: last.prompt,
                        aspectRatio: last.aspectRatio,
                        imageSize: last.imageSize,
                        referenceImages: [],
                        regenerate: true
                    });
                } else {
                    alert('暂无历史记录');
                }
            };
            
            overlay.querySelector('#aiGenerate').onclick = () => {
                const prompt = promptInput.value.trim();
                if (!prompt) {
                    promptInput.focus();
                    return;
                }
                const useSlideText = overlay.querySelector('#aiUseSlideText')?.checked || false;
                close({
                    elementId: element.id,
                    prompt,
                    aspectRatio: ratioSelect.value,
                    imageSize: sizeSelect.value,
                    referenceImages: [...referenceImages],
                    useSlideText
                });
            };
            
            // 按 Enter 生成，Escape 取消
            promptInput.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    overlay.querySelector('#aiGenerate').click();
                }
            };
            overlay.onkeydown = (e) => {
                if (e.key === 'Escape') close(null);
            };
        });
    },

    /**
     * 截取当前幻灯片，并高亮指定元素
     */
    async _captureSlideSnapshot(highlightElementId) {
        // 查找幻灯片容器
        const slideEl = document.getElementById('presSlideCanvas') || 
                        document.querySelector('.pres-slide') ||
                        document.querySelector('[class*="slide"]');
        
        if (!slideEl) {
            console.warn('[_captureSlideSnapshot] 未找到幻灯片容器');
            return null;
        }
        
        if (typeof html2canvas === 'undefined') {
            console.warn('[_captureSlideSnapshot] html2canvas 未加载');
            return null;
        }
        
        // 临时添加高亮边框
        let highlightEl = null;
        if (highlightElementId) {
            highlightEl = slideEl.querySelector(`[data-element-id="${highlightElementId}"]`);
            if (highlightEl) {
                highlightEl.style.outline = '3px dashed #8b5cf6';
                highlightEl.style.outlineOffset = '2px';
            }
        }
        
        // 保存原始样式，处理富文本显示问题（与导出模块一致）
        const spanStyles = [];
        slideEl.querySelectorAll('span').forEach((span, i) => {
            spanStyles[i] = span.style.display;
            if (!span.style.display) {
                span.style.display = 'inline';
            }
        });
        
        try {
            console.log('[_captureSlideSnapshot] 开始截图...');
            const canvas = await html2canvas(slideEl, { 
                scale: 1,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff'
            });
            const dataUrl = canvas.toDataURL('image/png');
            console.log('[_captureSlideSnapshot] 截图完成');
            return dataUrl;
        } catch (err) {
            console.error('[_captureSlideSnapshot] 截图失败:', err);
            return null;
        } finally {
            // 恢复 span 原始样式
            slideEl.querySelectorAll('span').forEach((span, i) => {
                if (spanStyles[i] !== undefined) {
                    span.style.display = spanStyles[i];
                }
            });
            // 移除高亮
            if (highlightEl) {
                highlightEl.style.outline = '';
                highlightEl.style.outlineOffset = '';
            }
        }
    },

    /**
     * 框选截图 - 让用户在页面上拖拽选择区域
     */
    async _captureRegion() {
        return new Promise((resolve) => {
            // 创建全屏遮罩
            const mask = document.createElement('div');
            mask.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.3); cursor: crosshair; z-index: 100000;
            `;
            
            // 选择框
            const selBox = document.createElement('div');
            selBox.style.cssText = `
                position: fixed; border: 2px dashed #8b5cf6; background: rgba(139,92,246,0.1);
                pointer-events: none; display: none;
            `;
            mask.appendChild(selBox);
            
            // 提示文字
            const tip = document.createElement('div');
            tip.style.cssText = `
                position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.8); color: white; padding: 8px 16px;
                border-radius: 6px; font-size: 14px; pointer-events: none;
            `;
            tip.textContent = '拖拽选择区域，按 ESC 取消';
            mask.appendChild(tip);
            
            document.body.appendChild(mask);
            
            let startX = 0, startY = 0, isSelecting = false;
            
            const cleanup = () => {
                document.body.removeChild(mask);
            };
            
            mask.onmousedown = (e) => {
                startX = e.clientX;
                startY = e.clientY;
                isSelecting = true;
                selBox.style.display = 'block';
                selBox.style.left = startX + 'px';
                selBox.style.top = startY + 'px';
                selBox.style.width = '0';
                selBox.style.height = '0';
            };
            
            mask.onmousemove = (e) => {
                if (!isSelecting) return;
                const x = Math.min(startX, e.clientX);
                const y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX);
                const h = Math.abs(e.clientY - startY);
                selBox.style.left = x + 'px';
                selBox.style.top = y + 'px';
                selBox.style.width = w + 'px';
                selBox.style.height = h + 'px';
            };
            
            mask.onmouseup = async (e) => {
                if (!isSelecting) return;
                isSelecting = false;
                
                const x = Math.min(startX, e.clientX);
                const y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX);
                const h = Math.abs(e.clientY - startY);
                
                if (w < 10 || h < 10) {
                    cleanup();
                    resolve(null);
                    return;
                }
                
                // 隐藏遮罩后截图
                mask.style.display = 'none';
                
                try {
                    // 等待渲染
                    await new Promise(r => setTimeout(r, 50));
                    
                    // 截取整个页面
                    const slideEl = document.getElementById('presSlideCanvas') || 
                                    document.querySelector('.pres-slide') ||
                                    document.body;
                    
                    const canvas = await html2canvas(slideEl, {
                        scale: 1,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff'
                    });
                    
                    // 裁剪选中区域
                    const slideRect = slideEl.getBoundingClientRect();
                    const cropX = x - slideRect.left;
                    const cropY = y - slideRect.top;
                    
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = w;
                    cropCanvas.height = h;
                    const ctx = cropCanvas.getContext('2d');
                    ctx.drawImage(canvas, cropX, cropY, w, h, 0, 0, w, h);
                    
                    const dataUrl = cropCanvas.toDataURL('image/png');
                    console.log('[_captureRegion] 框选截图完成:', w, 'x', h);
                    
                    cleanup();
                    resolve(dataUrl);
                } catch (err) {
                    console.error('[_captureRegion] 截图失败:', err);
                    cleanup();
                    resolve(null);
                }
            };
            
            // ESC 取消
            const onKeydown = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKeydown);
                    cleanup();
                    resolve(null);
                }
            };
            document.addEventListener('keydown', onKeydown);
        });
    },

    /**
     * 生成唯一的历史记录 key（slideIndex + elementId 避免不同页面元素 ID 重复）
     */
    _getHistoryKey(elementId) {
        const slideIndex = this.currentSlideIndex ?? 0;
        return `s${slideIndex}_${elementId}`;
    },

    /**
     * 获取元素的生图历史记录
     */
    _getImageGenHistory(elementId) {
        try {
            const key = this._getHistoryKey(elementId);
            const all = JSON.parse(localStorage.getItem('pptImageGenHistory') || '{}');
            return all[key] || [];
        } catch {
            return [];
        }
    },

    /**
     * 保存元素的生图记录
     */
    _saveImageGenHistory(elementId, record) {
        try {
            const key = this._getHistoryKey(elementId);
            const all = JSON.parse(localStorage.getItem('pptImageGenHistory') || '{}');
            const history = all[key] || [];
            // 去重：相同 prompt 只保留最新
            const filtered = history.filter(h => h.prompt !== record.prompt);
            filtered.unshift(record);
            // 每个元素最多保留 10 条
            all[key] = filtered.slice(0, 10);
            localStorage.setItem('pptImageGenHistory', JSON.stringify(all));
        } catch (e) {
            console.warn('[_saveImageGenHistory] 保存失败:', e);
        }
    },

    /**
     * 框选区域 AI 生图 - 在选中区域上覆盖生成的图片
     */
    async regionSelectAndGenerate() {
        // 1. 框选区域，返回区域信息和截图
        const regionResult = await this._selectRegionWithInfo();
        if (!regionResult) return;
        
        const { x, y, width, height, screenshot } = regionResult;
        console.log('[regionSelectAndGenerate] 选中区域:', x, y, width, height);
        
        // 2. 创建临时元素用于生图对话框
        const tempElement = {
            id: `region_${Date.now()}`,
            type: 'image',
            x, y, width, height,
            src: screenshot
        };
        
        // 3. 显示 AI 生图对话框，并预置框选截图为参考图
        const result = await this._showAiImageDialog(tempElement, [{ data: screenshot, type: 'region' }]);
        if (!result) return;
        
        // 4. 执行生图
        const imageResult = await this._executeImageGen(result);
        if (!imageResult) return;
        
        // 5. 在选中区域创建新图片元素
        const slide = this.slides[this.currentSlideIndex];
        if (!slide) return;
        
        // 获取 slide 实际渲染尺寸来计算百分比
        const slideEl = document.getElementById('presSlideCanvas') || document.querySelector('.pres-slide');
        const slideRect = slideEl?.getBoundingClientRect() || { width: 960, height: 540 };
        const actualWidth = slideRect.width;
        const actualHeight = slideRect.height;
        
        // 转换为百分比（基于实际渲染尺寸）
        const newElement = {
            id: `img_${Date.now()}`,
            type: 'image',
            x: `${(x / actualWidth * 100).toFixed(2)}%`,
            y: `${(y / actualHeight * 100).toFixed(2)}%`,
            width: `${(width / actualWidth * 100).toFixed(2)}%`,
            height: `${(height / actualHeight * 100).toFixed(2)}%`,
            src: imageResult.dataUrl,
            objectFit: 'cover'
        };
        
        console.log('[regionSelectAndGenerate] 坐标转换:', { x, y, width, height, actualWidth, actualHeight });
        
        // 添加到当前幻灯片
        if (!slide.elements) slide.elements = [];
        slide.elements.push(newElement);
        
        // 同步并刷新
        this._syncToEditor();
        this.renderCurrentSlide();
        
        console.log('[regionSelectAndGenerate] 已添加生成的图片元素');
    },

    /**
     * 框选区域并返回区域信息（坐标相对于 slide）
     */
    async _selectRegionWithInfo() {
        return new Promise((resolve) => {
            const slideEl = document.getElementById('presSlideCanvas') || 
                            document.querySelector('.pres-slide');
            if (!slideEl) {
                resolve(null);
                return;
            }
            
            const slideRect = slideEl.getBoundingClientRect();
            
            // 创建全屏遮罩
            const mask = document.createElement('div');
            mask.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.3); cursor: crosshair; z-index: 100000;
            `;
            
            // 选择框
            const selBox = document.createElement('div');
            selBox.style.cssText = `
                position: fixed; border: 2px dashed #8b5cf6; background: rgba(139,92,246,0.15);
                pointer-events: none; display: none;
            `;
            mask.appendChild(selBox);
            
            // 提示文字
            const tip = document.createElement('div');
            tip.style.cssText = `
                position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.8); color: white; padding: 8px 16px;
                border-radius: 6px; font-size: 14px; pointer-events: none;
            `;
            tip.textContent = '在幻灯片区域拖拽选择，松开后生成图片覆盖该区域';
            mask.appendChild(tip);
            
            document.body.appendChild(mask);
            
            let startX = 0, startY = 0, isSelecting = false;
            
            const cleanup = () => {
                document.body.removeChild(mask);
            };
            
            mask.onmousedown = (e) => {
                startX = e.clientX;
                startY = e.clientY;
                isSelecting = true;
                selBox.style.display = 'block';
                selBox.style.left = startX + 'px';
                selBox.style.top = startY + 'px';
                selBox.style.width = '0';
                selBox.style.height = '0';
            };
            
            mask.onmousemove = (e) => {
                if (!isSelecting) return;
                const x = Math.min(startX, e.clientX);
                const y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX);
                const h = Math.abs(e.clientY - startY);
                selBox.style.left = x + 'px';
                selBox.style.top = y + 'px';
                selBox.style.width = w + 'px';
                selBox.style.height = h + 'px';
            };
            
            mask.onmouseup = async (e) => {
                if (!isSelecting) return;
                isSelecting = false;
                
                const screenX = Math.min(startX, e.clientX);
                const screenY = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX);
                const h = Math.abs(e.clientY - startY);
                
                if (w < 20 || h < 20) {
                    cleanup();
                    resolve(null);
                    return;
                }
                
                // 转换为相对于 slide 的坐标
                const x = screenX - slideRect.left;
                const y = screenY - slideRect.top;
                
                // 检查是否在 slide 范围内
                if (x < 0 || y < 0 || x + w > slideRect.width || y + h > slideRect.height) {
                    console.warn('[_selectRegionWithInfo] 选择区域超出幻灯片范围');
                }
                
                // 隐藏遮罩后截图
                mask.style.display = 'none';
                
                // 修复富文本显示问题（与导出模块一致）
                const spanStyles = [];
                slideEl.querySelectorAll('span').forEach((span, i) => {
                    spanStyles[i] = span.style.display;
                    if (!span.style.display) {
                        span.style.display = 'inline';
                    }
                });
                
                try {
                    await new Promise(r => setTimeout(r, 50));
                    
                    const canvas = await html2canvas(slideEl, {
                        scale: 1, useCORS: true, allowTaint: true, backgroundColor: '#ffffff'
                    });
                    
                    // 裁剪选中区域
                    const cropCanvas = document.createElement('canvas');
                    cropCanvas.width = w;
                    cropCanvas.height = h;
                    const ctx = cropCanvas.getContext('2d');
                    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
                    
                    const screenshot = cropCanvas.toDataURL('image/png');
                    
                    // 恢复 span 原始样式
                    slideEl.querySelectorAll('span').forEach((span, i) => {
                        if (spanStyles[i] !== undefined) {
                            span.style.display = spanStyles[i];
                        }
                    });
                    
                    cleanup();
                    resolve({ x, y, width: w, height: h, screenshot });
                } catch (err) {
                    console.error('[_selectRegionWithInfo] 截图失败:', err);
                    cleanup();
                    resolve(null);
                }
            };
            
            // ESC 取消
            const onKeydown = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKeydown);
                    cleanup();
                    resolve(null);
                }
            };
            document.addEventListener('keydown', onKeydown);
        });
    },
};

// 混入到 PPTGenerator
if (typeof window.PPTGenerator !== 'undefined') {
    try {
        Object.assign(window.PPTGenerator, PPTGeneratorEditor);
        console.log('[PPTGeneratorEditor] 已混入到 PPTGenerator', {
            toggleEditorMode: typeof window.PPTGenerator.toggleEditorMode === 'function',
            enableEditorMode: typeof window.PPTGenerator.enableEditorMode === 'function',
            initEditor: typeof window.PPTGenerator.initEditor === 'function',
        });
    } catch (err) {
        console.error('[PPTGeneratorEditor] 混入到 PPTGenerator 失败:', err);
    }
} else {
    console.warn('[PPTGeneratorEditor] PPTGenerator 未定义，混入失败');
}
