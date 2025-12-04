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

        // 触发 canvas 尺寸更新
        this._updateCanvasSize?.();

        // 启用编辑器交互
        if (this.editor) this.editor.enabled = true;
        
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
        if (panel) {
            panel.style.display = 'flex';
        }
    },

    /**
     * 隐藏编辑器 UI
     */
    _hideEditorUI() {
        const panel = document.getElementById('editorRightPanel');
        if (panel) {
            panel.style.display = 'none';
        }
    },

    // 保留样式注入（首次使用时）
    _injectEditorStyles() {
        if (document.getElementById('editorPanelStyle')) return;

        const style = document.createElement('style');
        style.id = 'editorPanelStyle';
        style.textContent = `
            .pres-container {
                display: flex !important;
            }
            .pres-main-area {
                flex: 1;
                min-width: 0;
            }
            .editor-right-panel {
                width: 280px;
                background: white;
                border-left: 1px solid #e5e7eb;
                display: flex;
                flex-direction: column;
                flex-shrink: 0;
            }
            .editor-panel-tabs {
                display: flex;
                border-bottom: 1px solid #e5e7eb;
                background: #f9fafb;
            }
            .panel-tab {
                flex: 1;
                padding: 10px;
                background: transparent;
                border: none;
                cursor: pointer;
                font-size: 12px;
                color: #6b7280;
                border-bottom: 2px solid transparent;
                transition: all 0.15s;
            }
            .panel-tab:hover {
                background: #f3f4f6;
            }
            .panel-tab.active {
                color: #3b82f6;
                border-bottom-color: #3b82f6;
            }
            .editor-panel-content {
                flex: 1;
                overflow-y: auto;
            }
            .panel-pane {
                display: none;
            }
            .panel-pane.active {
                display: block;
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
        `;
        document.head.appendChild(style);
        
        // 绑定对齐下拉菜单
        this._bindAlignDropdown();
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
};

// 混入到 PPTGenerator
if (typeof window.PPTGenerator !== 'undefined') {
    Object.assign(window.PPTGenerator, PPTGeneratorEditor);
    console.log('[PPTGeneratorEditor] 已混入到 PPTGenerator');
} else {
    console.warn('[PPTGeneratorEditor] PPTGenerator 未定义，混入失败');
}
