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

        // 修改 UI 布局，添加右侧面板
        this._injectEditorUI();

        // 绑定视口
        const viewport = document.getElementById('presSlideCanvas');
        if (viewport) {
            this.editor.viewport = viewport;
            this.editor._createOverlayContainer();
            this.editor._bindViewportEvents();
        }

        // 初始化面板
        this._initPanels();

        // 渲染当前幻灯片
        this.editor.renderCurrentSlide();

        // 显示编辑工具栏
        const editorTools = document.getElementById('editorTools');
        if (editorTools) editorTools.style.display = 'flex';

        // 更新按钮状态
        const editorModeBtn = document.getElementById('editorModeBtn');
        if (editorModeBtn) editorModeBtn.classList.add('active');

        this.editorEnabled = true;
        console.log('[PPTGeneratorEditor] 编辑模式已启用');
    },

    /**
     * 禁用编辑模式
     */
    disableEditorMode() {
        if (!this.editorEnabled) return;

        // 移除编辑器 UI
        const editorPanel = document.getElementById('editorRightPanel');
        if (editorPanel) {
            editorPanel.remove();
        }

        // 移除覆盖层
        if (this.editor?.overlayContainer) {
            this.editor.overlayContainer.remove();
            this.editor.overlayContainer = null;
        }

        // 隐藏编辑工具栏
        const editorTools = document.getElementById('editorTools');
        if (editorTools) editorTools.style.display = 'none';

        // 更新按钮状态
        const editorModeBtn = document.getElementById('editorModeBtn');
        if (editorModeBtn) editorModeBtn.classList.remove('active');

        // 清除选择
        this.editor?.selection?.deselectAll();

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
     * 注入编辑器 UI
     */
    _injectEditorUI() {
        // 检查是否已存在
        if (document.getElementById('editorRightPanel')) return;

        const mainArea = document.querySelector('.pres-main-area');
        if (!mainArea) return;

        // 创建右侧面板
        const panel = document.createElement('div');
        panel.id = 'editorRightPanel';
        panel.className = 'editor-right-panel';
        panel.innerHTML = `
            <div class="editor-panel-tabs">
                <button class="panel-tab active" data-panel="property">属性</button>
                <button class="panel-tab" data-panel="layer">图层</button>
            </div>
            <div class="editor-panel-content">
                <div id="editorPropertyPanel" class="panel-pane active"></div>
                <div id="editorLayerPanel" class="panel-pane"></div>
            </div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.id = 'editorPanelStyle';
        style.textContent = `
            .pres-main-area {
                display: flex !important;
            }
            .pres-canvas-wrapper {
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
        `;

        if (!document.getElementById('editorPanelStyle')) {
            document.head.appendChild(style);
        }

        mainArea.appendChild(panel);

        // 绑定标签切换
        panel.querySelectorAll('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const panelName = tab.dataset.panel;
                panel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.panel-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`editor${panelName.charAt(0).toUpperCase() + panelName.slice(1)}Panel`).classList.add('active');
            });
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

        // editor → PPTGenerator
        this.editor.document.on('element.add', () => this._syncToGenerator());
        this.editor.document.on('element.remove', () => this._syncToGenerator());
        this.editor.document.on('element.update', () => this._syncToGenerator());
        this.editor.document.on('slide.add', () => this._syncToGenerator());
        this.editor.document.on('slide.remove', () => this._syncToGenerator());
        this.editor.document.on('slide.update', () => this._syncToGenerator());

        // 幻灯片切换同步
        this.editor.on('slide:change', ({ index }) => {
            if (this.currentSlideIndex !== index) {
                this.currentSlideIndex = index;
                this._updateThumbnails();
            }
        });
    },

    /**
     * 同步数据到 PPTGenerator
     */
    _syncToGenerator() {
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
        this.editor.document.load(this.slides || []);
        this.editor.currentSlideIndex = this.currentSlideIndex || 0;
        if (this.editorEnabled) {
            this.editor.renderCurrentSlide();
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
    },

    /**
     * 重做
     */
    redo() {
        if (!this.editor) return;
        this.editor.history.redo();
    },
};

// 混入到 PPTGenerator
if (typeof PPTGenerator !== 'undefined') {
    Object.assign(PPTGenerator, PPTGeneratorEditor);
}
