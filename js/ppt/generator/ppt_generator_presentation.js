// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from './ppt_generator_core.js';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[ch]);
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

const PPTGeneratorPresentation = {
    renderPresentationMode(container) {
        // 更新外层 header，整合工具栏内容
        this._updateHeaderForPresentation();

        container.innerHTML = `
            <div class="pres-container" style="display: flex; height: 100%; width: 100%;">
                <!-- Left Sidebar: Thumbnail Strip -->
                <div class="ppt-thumb-sidebar" id="presSidebar">
                    <div class="sidebar-header" id="presSidebarHeader">幻灯片 (${this.slides.length}页)</div>
                    <div class="ppt-thumb-list custom-scrollbar" id="presThumbnails">
                        ${this.slides.map((slide, index) => `
                            <div class="ppt-thumb-item ${index === this.currentSlideIndex ? 'active' : ''}" data-ppt-action="go-to-slide" data-slide-index="${index}">
                                <div class="ppt-thumb-preview">
                                    ${this._renderThumbnail(slide, index)}
                                </div>
                                <div class="ppt-thumb-number">${index + 1}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="ppt-thumb-resizer" id="presThumbResizer"></div>
                </div>
                
                <!-- Main Area -->
                <div class="pres-main-area">
                    <!-- Canvas -->
                    <div class="pres-canvas-wrapper">
                        ${this.viewMode === 'slide' ? `
                            <div class="pres-slide-container">
                                <div class="pres-slide" id="presSlideCanvas">
                                    ${this._renderSlideContent(this.slides[this.currentSlideIndex])}
                                </div>
                            </div>
                        ` : `
                            <div class="pres-outline-view custom-scrollbar">
                                ${this._renderOutlineContent()}
                            </div>
                        `}
                    </div>
                    <!-- Floating Toolbar - 移到 main-area 底部 -->
                    <div class="pres-toolbar-float">
                        <button class="pres-tool-btn" data-ppt-action="prev-slide" title="上一页">
                            <iconify-icon icon="carbon:chevron-left"></iconify-icon>
                        </button>
                        <span class="pres-page-info" id="presPageInfo">${this.currentSlideIndex + 1} / ${this.slides.length}</span>
                        <button class="pres-tool-btn" data-ppt-action="next-slide" title="下一页">
                            <iconify-icon icon="carbon:chevron-right"></iconify-icon>
                        </button>
                        <div class="pres-toolbar-divider"></div>
                        <button class="pres-tool-btn" data-ppt-action="add-slide-ai" title="AI 新增幻灯片">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                        </button>
                        <button class="pres-tool-btn" data-ppt-action="duplicate-slide" title="复制幻灯片">
                            <iconify-icon icon="carbon:copy"></iconify-icon>
                        </button>
                        <button class="pres-tool-btn danger" data-ppt-action="delete-current-slide" title="删除幻灯片">
                            <iconify-icon icon="carbon:trash-can"></iconify-icon>
                        </button>
                        <div class="pres-toolbar-divider"></div>
                        <button class="pres-tool-btn" id="editorModeBtn" data-ppt-action="toggle-editor-mode" title="编辑模式">
                            <iconify-icon icon="carbon:touch-interaction"></iconify-icon>
                        </button>
                        <!-- 编辑模式工具（初始隐藏） -->
                        <div class="editor-tools" id="editorTools" style="display: none;">
                            <button class="pres-tool-btn" data-ppt-action="add-text" title="添加文本">
                                <iconify-icon icon="carbon:text-font"></iconify-icon>
                            </button>
                            <button class="pres-tool-btn" data-ppt-action="add-image" title="添加图片">
                                <iconify-icon icon="carbon:image"></iconify-icon>
                            </button>
                            <button class="pres-tool-btn" data-ppt-action="add-shape" title="添加形状">
                                <iconify-icon icon="carbon:shape-join"></iconify-icon>
                            </button>
                            <button class="pres-tool-btn" data-ppt-action="add-chart" title="添加图表">
                                <iconify-icon icon="carbon:chart-bar"></iconify-icon>
                            </button>
                            <button class="pres-tool-btn" data-ppt-action="add-icon" title="添加图标">
                                <iconify-icon icon="carbon:face-satisfied"></iconify-icon>
                            </button>
                            <div class="pres-toolbar-divider"></div>
                            <button class="pres-tool-btn ai-btn" data-ppt-action="region-select-generate" title="框选区域 AI 生图">
                                <iconify-icon icon="carbon:select-window"></iconify-icon>
                            </button>
                            <div class="pres-toolbar-divider"></div>
                            <button class="pres-tool-btn" data-ppt-action="undo" title="撤销 (Ctrl+Z)">
                                <iconify-icon icon="carbon:undo"></iconify-icon>
                            </button>
                            <button class="pres-tool-btn" data-ppt-action="redo" title="重做 (Ctrl+Y)">
                                <iconify-icon icon="carbon:redo"></iconify-icon>
                            </button>
                            <div class="pres-toolbar-divider"></div>
                            <div class="pres-tool-dropdown">
                                <button class="pres-tool-btn" title="对齐" id="alignDropdownBtn">
                                    <iconify-icon icon="carbon:align-horizontal-left"></iconify-icon>
                                    <iconify-icon icon="carbon:chevron-down" style="font-size: 10px; margin-left: 2px;"></iconify-icon>
                                </button>
                                <div class="pres-tool-dropdown-menu" id="alignDropdownMenu" style="display: none;">
                                    <button data-ppt-action="align" data-align="left" title="左对齐"><iconify-icon icon="carbon:align-horizontal-left"></iconify-icon> 左对齐</button>
                                    <button data-ppt-action="align" data-align="center" title="水平居中"><iconify-icon icon="carbon:align-horizontal-center"></iconify-icon> 水平居中</button>
                                    <button data-ppt-action="align" data-align="right" title="右对齐"><iconify-icon icon="carbon:align-horizontal-right"></iconify-icon> 右对齐</button>
                                    <div class="dropdown-divider"></div>
                                    <button data-ppt-action="align" data-align="top" title="顶部对齐"><iconify-icon icon="carbon:align-vertical-top"></iconify-icon> 顶部对齐</button>
                                    <button data-ppt-action="align" data-align="middle" title="垂直居中"><iconify-icon icon="carbon:align-vertical-center"></iconify-icon> 垂直居中</button>
                                    <button data-ppt-action="align" data-align="bottom" title="底部对齐"><iconify-icon icon="carbon:align-vertical-bottom"></iconify-icon> 底部对齐</button>
                                    <div class="dropdown-divider"></div>
                                    <button data-ppt-action="align" data-align="distributeH" title="水平分布"><iconify-icon icon="carbon:distribute-horizontal-center"></iconify-icon> 水平分布</button>
                                    <button data-ppt-action="align" data-align="distributeV" title="垂直分布"><iconify-icon icon="carbon:distribute-vertical-center"></iconify-icon> 垂直分布</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 编辑器右侧面板（初始隐藏） -->
                <div class="editor-sidebar-resizer" id="editorSidebarResizer" style="display: none;"></div>
                <div class="editor-right-panel" id="editorRightPanel" style="display: none;">
                    <div class="editor-panel-content">
                        <div id="editorLayerPanel" class="panel-pane"></div>
                        <div class="editor-panel-resizer" id="editorPanelResizer"></div>
                        <div id="editorPropertyPanel" class="panel-pane"></div>
                    </div>
                </div>
            </div>
        `;
        
	        // 初始化缩略图 resizer
	        this._bindThumbResizerEvents();
	        // 初始化 canvas 自适应尺寸
	        this._updateCanvasSize();
	        // 监听窗口大小变化
	        if (this._presentationResizeHandler) {
	            window.removeEventListener('resize', this._presentationResizeHandler);
	            this._presentationResizeHandler = null;
	        }
		        this._presentationResizeHandler = () => this._updateCanvasSize();
		        window.addEventListener('resize', this._presentationResizeHandler);
		    },

	    cleanupPresentationMode() {
	        if (this._presentationResizeHandler && typeof window !== 'undefined') {
	            window.removeEventListener('resize', this._presentationResizeHandler);
	            this._presentationResizeHandler = null;
	        }
	    },

	    /**
	     * 计算并更新 canvas 尺寸，保持 16:9 比例并最大化利用可用空间
	     * 使用 transform scale 整体缩放，保持元素相对位置不变
     */
    _updateCanvasSize() {
        const slideContainer = document.querySelector('.pres-slide-container');
        const slide = document.getElementById('presSlideCanvas');
        const canvasWrapper = document.querySelector('.pres-canvas-wrapper');
        
        if (!slide || !canvasWrapper || !slideContainer) return;
        
        // 基准尺寸（幻灯片设计尺寸）
        const BASE_WIDTH = 960;
        const BASE_HEIGHT = 540;
        
        // 获取可用空间
        const wrapperRect = canvasWrapper.getBoundingClientRect();
        const paddingH = 20; // 水平 padding
        const paddingV = 12; // 垂直 padding
        const toolbarSpace = 50; // 底部工具栏预留空间
        
        const availableWidth = wrapperRect.width - paddingH * 2;
        const availableHeight = wrapperRect.height - paddingV * 2 - toolbarSpace;
        
        // 计算缩放比例（保持 16:9，取较小的缩放值）
        const scaleX = availableWidth / BASE_WIDTH;
        const scaleY = availableHeight / BASE_HEIGHT;
        const scale = Math.min(scaleX, scaleY, 1.8); // 最大放大 1.8 倍
        
        // 确保最小缩放
        const finalScale = Math.max(scale, 0.5);
        
        // 幻灯片始终保持基准尺寸，通过 transform 缩放
        slide.style.width = `${BASE_WIDTH}px`;
        slide.style.height = `${BASE_HEIGHT}px`;
        slide.style.transform = `scale(${finalScale})`;
        slide.style.transformOrigin = 'center center';
        
        // 容器尺寸跟随缩放后的实际显示尺寸
        slideContainer.style.width = `${BASE_WIDTH * finalScale}px`;
        slideContainer.style.height = `${BASE_HEIGHT * finalScale}px`;
    },

    /**
     * 绑定编辑面板标签切换事件
     */
    _bindEditorPanelTabs() {
        const panel = document.getElementById('editorRightPanel');
        if (!panel) return;

        panel.querySelectorAll('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const panelName = tab.dataset.panel;
                panel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.panel-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const targetId = `editor${panelName.charAt(0).toUpperCase() + panelName.slice(1)}Panel`;
                document.getElementById(targetId)?.classList.add('active');
            });
        });
    },

    /**
     * 绑定缩略图侧边栏 resizer 事件
     */
    _bindThumbResizerEvents() {
        const resizer = document.getElementById('presThumbResizer');
        const sidebar = document.getElementById('presSidebar');
        
        if (!resizer || !sidebar) return;

        const MIN_WIDTH = 100;
        const MAX_WIDTH = 240;
        let startX, startWidth;

        const onMouseMove = (e) => {
            const deltaX = e.clientX - startX;
            let newWidth = startWidth + deltaX;
            newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
            sidebar.style.width = `${newWidth}px`;
            // 更新 canvas 尺寸
            this._updateCanvasSize();
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
            startWidth = sidebar.getBoundingClientRect().width;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    },

    // ============================================================
    // Header Integration for Presentation Mode
    // ============================================================

    /**
     * 更新外层 header，整合视图切换和导出按钮
     */
	    _updateHeaderForPresentation() {
	        const header = document.querySelector('.ppt-header');
	        if (!header) return;

	        header.innerHTML = `
	            <div class="ppt-header-left">
	                <button class="ppt-icon-btn" data-ppt-action="enter-workspace">
	                    <iconify-icon icon="carbon:arrow-left"></iconify-icon>
	                </button>
	                <div class="ppt-logo">
	                    <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
	                    <span>智能演示文稿生成</span>
	                </div>
	                <div class="ppt-header-divider"></div>
	                <div class="pres-title-wrapper">
	                    <input type="text" class="pres-title-input" value="${escapeAttr(this.currentProject?.title || '')}">
	                    <iconify-icon icon="carbon:edit" class="pres-title-icon"></iconify-icon>
	                </div>
	            </div>
	            <div class="ppt-header-center">
	                <div class="pres-view-toggle">
	                    <button class="pres-view-btn ${this.viewMode === 'slide' ? 'active' : ''}" data-ppt-action="toggle-view-mode" data-view="slide">
	                        <iconify-icon icon="carbon:presentation-file"></iconify-icon>
	                        <span>幻灯片</span>
	                    </button>
	                    <button class="pres-view-btn ${this.viewMode === 'outline' ? 'active' : ''}" data-ppt-action="toggle-view-mode" data-view="outline">
	                        <iconify-icon icon="carbon:list"></iconify-icon>
	                        <span>大纲</span>
	                    </button>
	                </div>
	            </div>
	            <div class="ppt-header-right">
	                <button class="ppt-play-btn" data-ppt-action="start-slideshow">
	                    <iconify-icon icon="carbon:play-filled"></iconify-icon>
	                    <span>播放</span>
	                </button>
	                <div class="ppt-export-dropdown">
	                    <button class="ppt-export-btn" data-ppt-action="toggle-export-menu">
	                        <iconify-icon icon="carbon:export"></iconify-icon>
	                        <span>导出</span>
	                        <iconify-icon icon="carbon:chevron-down" class="ppt-export-chevron"></iconify-icon>
	                    </button>
	                    <div class="ppt-export-menu" id="pptExportMenu">
                        <div class="ppt-export-group-label">PPTX 导出设置</div>
                        <div class="ppt-export-options">
                            <div class="ppt-export-option-group">
                                <span class="ppt-export-option-label">公式</span>
                                <div class="ppt-export-option-btns">
                                    <button class="ppt-option-btn active" data-option="formula" data-value="unicode" title="Unicode 文本">文本</button>
                                    <button class="ppt-option-btn" data-option="formula" data-value="omml" title="原生公式（实验性）">原生</button>
                                    <button class="ppt-option-btn" data-option="formula" data-value="image" title="图片模式">图片</button>
                                </div>
                            </div>
                            <div class="ppt-export-option-group">
                                <span class="ppt-export-option-label">图表</span>
                                <div class="ppt-export-option-btns">
                                    <button class="ppt-option-btn active" data-option="chart" data-value="native" title="PPT 原生图表">原生</button>
                                    <button class="ppt-option-btn" data-option="chart" data-value="svg" title="SVG 图表（文字可编辑）">SVG</button>
                                </div>
                            </div>
                        </div>
	                        <button class="ppt-export-action-btn" data-ppt-action="export-pptx">
	                            <iconify-icon icon="carbon:document-export"></iconify-icon>
	                            <span>导出 PPTX</span>
	                        </button>
	                        <div class="ppt-export-divider"></div>
	                        <button class="ppt-export-item" data-ppt-action="export-as" data-format="pdf">
	                            <iconify-icon icon="carbon:document-pdf"></iconify-icon>
	                            <div class="ppt-export-item-info">
	                                <span class="ppt-export-item-title">PDF 文档</span>
	                                <span class="ppt-export-item-desc">.pdf 便于分享</span>
	                            </div>
	                        </button>
	                        <div class="ppt-export-divider"></div>
	                        <button class="ppt-export-item" data-ppt-action="export-as" data-format="images">
	                            <iconify-icon icon="carbon:image"></iconify-icon>
	                            <div class="ppt-export-item-info">
	                                <span class="ppt-export-item-title">图片打包</span>
	                                <span class="ppt-export-item-desc">.zip 每页一张 PNG</span>
	                            </div>
	                        </button>
	                    </div>
	                </div>
	                <button class="ppt-icon-btn" data-ppt-action="show-project-list" title="项目列表">
	                    <iconify-icon icon="carbon:grid"></iconify-icon>
	                </button>
	                <button class="ppt-icon-btn" data-ppt-action="navigate" data-href="index.html" title="返回主页">
	                    <iconify-icon icon="carbon:home"></iconify-icon>
	                </button>
	            </div>
	        `;

	        // Ensure data-ppt-action event delegation is available.
	        window.PPTGenerator?._ensureNavigationEventsBound?.();

	        // Bind title editing handlers (avoid inline events).
	        const titleInput = header.querySelector('.pres-title-input');
	        if (titleInput) {
	            titleInput.addEventListener('blur', () => {
	                window.PPTGenerator?.updateProjectTitle?.(titleInput.value);
	            });
	            titleInput.addEventListener('keydown', (event) => {
	                if (event.key === 'Enter') {
	                    event.preventDefault();
	                    titleInput.blur();
	                }
	            });
	        }
	    },

    // ============================================================
    // Presentation Navigation Logic
    // ============================================================

    _renderSlideContent(slide) {
        // 使用统一的 HTMLSlideRenderer（与 PPTX 导出共享逻辑）
        if (typeof HTMLSlideRenderer !== 'undefined') {
            if (!this._htmlRenderer) {
                this._htmlRenderer = new HTMLSlideRenderer();
            }
            return this._htmlRenderer.render(slide, this.currentSlideIndex);
        }
        // Fallback
        return this._renderSlideContentLegacy(slide);
    },

    /**
     * 渲染缩略图预览（缩小版的幻灯片内容）
     */
	    _renderThumbnail(slide, index) {
	        // 检查 HTMLSlideRenderer 是否可用
	        if (typeof HTMLSlideRenderer === 'undefined') {
	            // Fallback: 显示幻灯片类型和序号
	            const title = slide.title || slide.type || `幻灯片 ${index + 1}`;
	            return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:10px;color:#666;">${escapeHtml(title)}</div>`;
	        }
        if (!this._htmlRenderer) {
            this._htmlRenderer = new HTMLSlideRenderer();
        }
        // 渲染完整内容，然后用 CSS 缩放
        const content = this._htmlRenderer.render(slide, index);
        return `<div class="pres-thumb-content">${content}</div>`;
    },

	    _renderSlideContentLegacy(slide) {
	        if (slide.type === 'cover') {
	            return `
	                <div class="slide-modern-cover">
	                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 20px;">${escapeHtml(slide.title)}</h1>
	                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.8;">${escapeHtml(slide.subtitle)}</p>
	                    <div style="margin-top: 40px; font-size: 14px; opacity: 0.6;">Generated by Paper Burner X</div>
	                </div>
	            `;
	        } else if (slide.type === 'toc') {
            // 目录页 - 带序号的列表
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${escapeHtml(slide.title)}</h2>
	                    <div style="display: flex; flex-direction: column; gap: 20px;">
	                        ${slide.items.map((item, i) => `
	                            <div style="display: flex; align-items: center; gap: 20px;">
	                                <span style="width: 40px; height: 40px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;">${i + 1}</span>
	                                <span contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary);">${escapeHtml(item)}</span>
	                            </div>
	                        `).join('')}
	                    </div>
	                </div>
            `;
	        } else if (slide.type === 'stats') {
	            // 数据统计页 - 大数字展示
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${escapeHtml(slide.title)}</h2>
	                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.stats.length, 4)}, 1fr); gap: 32px; align-items: center;">
	                        ${slide.stats.map((stat, i) => `
	                            <div style="text-align: center; padding: 24px;">
	                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'value', this.innerText)" style="font-size: 56px; font-weight: 800; color: var(--ppt-primary); margin-bottom: 12px;">${escapeHtml(stat.value)}</div>
	                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'label', this.innerText)" style="font-size: 16px; color: var(--ppt-text-secondary);">${escapeHtml(stat.label)}</div>
	                            </div>
	                        `).join('')}
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'comparison') {
            // 对比页 - 左右分栏
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${escapeHtml(slide.title)}</h2>
	                    <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
	                        <div style="background: #fee2e2; border-radius: 16px; padding: 32px;">
	                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #dc2626; margin-bottom: 24px;">${escapeHtml(slide.left.title)}</h3>
	                            <ul style="list-style: none; padding: 0; margin: 0;">
	                                ${slide.left.items.map((item, i) => `
	                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #991b1b;">
	                                        <iconify-icon icon="carbon:close-filled" style="color: #dc2626;"></iconify-icon>
	                                        <span contenteditable="true">${escapeHtml(item)}</span>
	                                    </li>
	                                `).join('')}
	                            </ul>
	                        </div>
	                        <div style="background: #dcfce7; border-radius: 16px; padding: 32px;">
	                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #16a34a; margin-bottom: 24px;">${escapeHtml(slide.right.title)}</h3>
	                            <ul style="list-style: none; padding: 0; margin: 0;">
	                                ${slide.right.items.map((item, i) => `
	                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #166534;">
	                                        <iconify-icon icon="carbon:checkmark-filled" style="color: #16a34a;"></iconify-icon>
	                                        <span contenteditable="true">${escapeHtml(item)}</span>
	                                    </li>
	                                `).join('')}
	                            </ul>
	                        </div>
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'image_text') {
            // 图文混排页
	            return `
	                <div style="padding: 60px; height: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;">
	                    <div>
	                        <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${escapeHtml(slide.title)}</h2>
	                        <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 20px; color: var(--ppt-text-secondary); line-height: 1.7;">${escapeHtml(slide.content)}</p>
	                    </div>
	                    <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); border-radius: 16px; height: 280px; display: flex; align-items: center; justify-content: center; color: var(--ppt-primary); font-size: 18px;">
	                        <iconify-icon icon="carbon:image" style="font-size: 48px; opacity: 0.5; margin-right: 12px;"></iconify-icon>
	                        ${escapeHtml(slide.imagePlaceholder || '图片占位')}
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'icon_grid') {
            // 图标网格页
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${escapeHtml(slide.title)}</h2>
	                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.items.length, 4)}, 1fr); gap: 32px;">
	                        ${slide.items.map((item, i) => `
	                            <div style="background: var(--ppt-bg-subtle); border-radius: 16px; padding: 32px; text-align: center;">
	                                <div style="width: 64px; height: 64px; background: var(--ppt-primary-subtle); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto;">
	                                    <iconify-icon icon="${escapeAttr(item.icon)}" style="font-size: 32px; color: var(--ppt-primary);"></iconify-icon>
	                                </div>
	                                <h4 contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${escapeHtml(item.title)}</h4>
	                                <p contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary); margin: 0;">${escapeHtml(item.desc)}</p>
	                            </div>
	                        `).join('')}
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'quote') {
            // 引用/评价页
	            return `
	                <div style="padding: 80px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);">
	                    <iconify-icon icon="carbon:quotes" style="font-size: 64px; color: var(--ppt-primary); opacity: 0.3; margin-bottom: 32px;"></iconify-icon>
	                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'quote', this.innerText)" style="font-size: 28px; color: var(--ppt-text-main); line-height: 1.6; max-width: 700px; margin-bottom: 40px; font-style: italic;">"${escapeHtml(slide.quote)}"</p>
	                    <div>
	                        <div contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main);">${escapeHtml(slide.author)}</div>
	                        <div contenteditable="true" style="font-size: 16px; color: var(--ppt-text-secondary); margin-top: 4px;">${escapeHtml(slide.company)}</div>
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'timeline') {
            // 时间轴/路线图页
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${escapeHtml(slide.title)}</h2>
	                    <div style="flex: 1; display: flex; align-items: center; position: relative;">
	                        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 4px; background: var(--ppt-border); transform: translateY(-50%);"></div>
	                        <div style="display: grid; grid-template-columns: repeat(${slide.items.length}, 1fr); gap: 24px; width: 100%; position: relative;">
	                            ${slide.items.map((item, i) => `
	                                <div style="text-align: center;">
	                                    <div style="width: 56px; height: 56px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; margin: 0 auto 16px auto; position: relative; z-index: 1;">${escapeHtml(item.phase)}</div>
	                                    <div contenteditable="true" style="font-size: 18px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${escapeHtml(item.title)}</div>
	                                    <div contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary);">${escapeHtml(item.desc)}</div>
	                                </div>
	                            `).join('')}
	                        </div>
	                    </div>
	                </div>
	            `;
	        } else if (slide.type === 'end') {
            // 结束页
	            return `
	                <div class="slide-modern-cover" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
	                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 16px;">${escapeHtml(slide.title)}</h1>
	                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.7; margin-bottom: 40px;">${escapeHtml(slide.subtitle || '')}</p>
	                    ${slide.email ? `<div style="font-size: 18px; opacity: 0.5;"><iconify-icon icon="carbon:email"></iconify-icon> ${escapeHtml(slide.email)}</div>` : ''}
	                    <div style="margin-top: 60px; font-size: 14px; opacity: 0.4;">Generated by Paper Burner X</div>
	                </div>
	            `;
	        } else if (slide.type === 'list') {
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${escapeHtml(slide.title)}</h2>
	                    <ul style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.8; padding-left: 40px;">
	                        ${slide.items.map((item, i) => `<li contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)">${escapeHtml(item)}</li>`).join('')}
	                    </ul>
	                </div>
	            `;
	        } else {
	            return `
	                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column; justify-content: center;">
	                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${escapeHtml(slide.title)}</h2>
	                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.6;">${escapeHtml(slide.content)}</p>
	                </div>
	            `;
	        }
	    },

    updateSlideContent(slideIndex, field, value) {
        if (this.slides[slideIndex]) {
            this.slides[slideIndex][field] = value;
            // Also update outline view if visible
            if (this.viewMode === 'outline') {
                this.renderPresentationMode(document.getElementById('pptPreviewArea'));
            } else {
                // Update thumbnails
                this._updateSlideView();
            }
        }
    },

    updateSlideItem(slideIndex, itemIndex, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].items) {
            this.slides[slideIndex].items[itemIndex] = value;
            this._updateSlideView();
        }
    },

    updateSlideStat(slideIndex, statIndex, field, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].stats && this.slides[slideIndex].stats[statIndex]) {
            this.slides[slideIndex].stats[statIndex][field] = value;
            this._updateSlideView();
        }
    },

    toggleViewMode(mode) {
        this.viewMode = mode;
        this.renderPresentationMode(document.getElementById('pptPreviewArea'));
    },

    _getScriptForSlide(index) {
        const scripts = [
            "Welcome. Today we explore the next frontier of computation: Quantum Computing. We call this the 'Quantum Leap'.",
            "Our agenda covers the physics foundations, key algorithms, hardware approaches, real-world applications, and the roadmap ahead.",
            "It starts with a fundamental shift. Unlike classical bits that are 0 or 1, Qubits exist in a superposition, represented here by the Bloch Sphere.",
            "Mathematically, this is a vector in a complex vector space. The coefficients alpha and beta determine the probability of measuring 0 or 1.",
            "Then there's Entanglement. Einstein called it 'spooky action at a distance'. It allows qubits to be perfectly correlated, instantly.",
            "This power enables algorithms like Shor's, which offers exponential speedup in factoring large numbers, threatening current encryption.",
            "Building this is hard. We use dilution refrigerators to cool superconducting qubits to near absolute zero, or trap individual ions with lasers.",
            "The applications are vast. From simulating molecules for new drugs, to breaking cryptography, and optimizing complex logistics networks.",
            "The market is responding. Investment is surging, with projections reaching $8.5 Billion by 2025 as we move from research to commercialization.",
            "But challenges remain. Decoherence—noise from the environment—destroys quantum states. Error correction is the holy grail.",
            "Our roadmap takes us from the current NISQ era of noisy intermediate-scale quantum devices to fully fault-tolerant logical qubits by 2030.",
            "The future is Quantum. It will solve problems that are impossible today. Join us in preparing for this paradigm shift. Thank you."
        ];
        return scripts[index] || "No speaker notes available.";
    },

	    _renderOutlineContent() {
	        return `
	            <div class="ppt-outline-container">
	                ${this.slides.map((slide, index) => {
	                    // 从 elements 中提取标题和内容
	                    const info = this._extractSlideInfo(slide);
	                    return `
	                    <div class="ppt-outline-item" data-ppt-action="go-to-slide-from-outline" data-slide-index="${index}">
	                        <div class="ppt-outline-num">${index + 1}</div>
	                        <div class="ppt-outline-content">
	                            <div class="ppt-outline-title">${escapeHtml(info.title || `幻灯片 ${index + 1}`)}</div>
	                            ${info.subtitle ? `<div class="ppt-outline-text">${escapeHtml(info.subtitle)}</div>` : ''}
	                            ${info.bullets.length > 0 ? `
	                                <ul class="ppt-outline-list">
	                                    ${info.bullets.slice(0, 5).map(b => `<li>${escapeHtml(b)}</li>`).join('')}
	                                    ${info.bullets.length > 5 ? `<li>... 还有 ${info.bullets.length - 5} 项</li>` : ''}
	                                </ul>
	                            ` : ''}
	                        </div>
	                    </div>
	                `;}).join('')}
	            </div>
	        `;
	    },

    /**
     * 从幻灯片数据中提取标题、副标题和要点
     */
    _extractSlideInfo(slide) {
        const info = { title: '', subtitle: '', bullets: [] };
        
        // 直接属性（旧格式）
        if (slide.title) info.title = slide.title;
        if (slide.subtitle) info.subtitle = slide.subtitle;
        if (slide.items) info.bullets = slide.items;
        
        // 从 elements 数组提取（新格式）
        if (slide.elements && Array.isArray(slide.elements)) {
            for (const el of slide.elements) {
                const type = el['data-el'] || el.type;
                const text = el['data-text'] || el.text || '';
                
                if (type === 'title' && !info.title) {
                    info.title = text;
                } else if (type === 'subtitle' && !info.subtitle) {
                    info.subtitle = text;
                } else if (type === 'bullet' || type === 'text') {
                    // 从 bullet 文本中提取要点
                    const lines = text.split('\n').filter(l => l.trim());
                    info.bullets.push(...lines);
                }
            }
        }
        
        return info;
    },

    goToSlideFromOutline(index) {
        this.currentSlideIndex = index;
        this.toggleViewMode('slide');
    },

    goToSlide(index) {
        if (index >= 0 && index < this.slides.length) {
            this.currentSlideIndex = index;
            this._updateSlideView();
        }
    },

    prevSlide() {
        if (this.currentSlideIndex > 0) {
            this.currentSlideIndex--;
            this._updateSlideView();
        }
    },

    nextSlide() {
        if (this.currentSlideIndex < this.slides.length - 1) {
            this.currentSlideIndex++;
            this._updateSlideView();
        }
    },

    _updateSlideView() {
        // Update Canvas
        const canvas = document.getElementById('presSlideCanvas');
        if (canvas) {
            canvas.innerHTML = this._renderSlideContent(this.slides[this.currentSlideIndex]);
        }

        // Update Pagination Text
        const pageInfo = document.getElementById('presPageInfo');
        if (pageInfo) {
            pageInfo.innerText = `${this.currentSlideIndex + 1} / ${this.slides.length}`;
        }

        // Update Thumbnails
        const thumbsContainer = document.getElementById('presThumbnails');
        if (thumbsContainer) {
            const thumbs = thumbsContainer.querySelectorAll('.ppt-thumb-item');
            thumbs.forEach((thumb, index) => {
                if (index === this.currentSlideIndex) {
                    thumb.classList.add('active');
                    thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else {
                    thumb.classList.remove('active');
                }
            });
        }
        
        // 同步编辑器（如果启用）
        if (this.editorEnabled && this.editor) {
            // 只同步索引，不重新加载数据
            this.editor.currentSlideIndex = this.currentSlideIndex;
            // 清除选择
            this.editor.selection.deselectAll();
            // 重新绑定视口
            this.editor.viewport = canvas;
            this.editor._createOverlayContainer();
            this.editor._addElementIds();
            
            // 刷新图层面板
            if (this.layerPanel) {
                this.layerPanel.refresh();
            }
        }
    },

    /**
     * 初始化可拖动分隔条
     */
    initResizers() {
        const resizers = document.querySelectorAll('.pres-resizer');
        resizers.forEach(resizer => {
            const targetId = resizer.dataset.target;
            const target = document.getElementById(targetId);
            const minWidth = parseInt(resizer.dataset.min) || 100;
            const maxWidth = parseInt(resizer.dataset.max) || 400;
            
            if (!target) return;

            let startX, startWidth;

            const onMouseDown = (e) => {
                startX = e.clientX;
                startWidth = target.offsetWidth;
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            const onMouseMove = (e) => {
                const dx = e.clientX - startX;
                const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
                target.style.width = newWidth + 'px';
                
                // 更新缩略图缩放比例
                this._updateThumbnailScale(newWidth);
            };

            const onMouseUp = () => {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            resizer.addEventListener('mousedown', onMouseDown);
        });
    },

    /**
     * 根据侧边栏宽度更新缩略图缩放比例
     */
    _updateThumbnailScale(sidebarWidth) {
        const thumbWidth = Math.max(0, sidebarWidth - 24); // 减去 padding
        const thumbHeight = thumbWidth * 9 / 16;
        const scale = thumbWidth / 960;

        document.querySelectorAll('.ppt-thumb-preview').forEach(preview => {
            preview.style.width = `${thumbWidth}px`;
            preview.style.height = `${thumbHeight}px`;
        });

        document.querySelectorAll('.pres-thumb-content').forEach(el => {
            el.style.transform = `translate(-50%, -50%) scale(${scale})`;
        });
    },

    // ============================================================
    // Slideshow Mode (Full Screen Presentation)
    // ============================================================

    /**
     * 启动全屏展示模式
     */
    startSlideshow(startIndex = null) {
        if (!this.slides || this.slides.length === 0) return;
        
        this._slideshowIndex = startIndex !== null ? startIndex : this.currentSlideIndex;
        this._slideshowKeyHandler = this._handleSlideshowKeydown.bind(this);
        
        // 创建全屏容器
        const overlay = document.createElement('div');
        overlay.id = 'slideshowOverlay';
        overlay.className = 'slideshow-overlay';
        overlay.innerHTML = `
            <div class="slideshow-container">
                <div class="slideshow-slide pres-slide" id="slideshowSlide">
                    ${this._renderSlideContent(this.slides[this._slideshowIndex])}
                </div>
                <span id="slideshowPageInfo" class="slideshow-page-info">${this._slideshowIndex + 1} / ${this.slides.length}</span>
                <span class="slideshow-hint">← → · ESC</span>
            </div>
        `;
        
        document.body.appendChild(overlay);
        document.addEventListener('keydown', this._slideshowKeyHandler);
        
        // 动态计算缩放比例，使幻灯片尽可能大
        this._updateSlideshowScale();
        window.addEventListener('resize', this._slideshowResizeHandler = () => this._updateSlideshowScale());
        
        // 点击左右区域翻页
        overlay.addEventListener('click', (e) => {
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 3) {
                this._slideshowPrev();
            } else if (x > rect.width * 2 / 3) {
                this._slideshowNext();
            }
        });
        
        // 双击退出
        overlay.addEventListener('dblclick', () => this.exitSlideshow());
        
        // 监听全屏变化（用户按 ESC 退出全屏时触发）
        this._slideshowFullscreenHandler = () => {
            if (!document.fullscreenElement) {
                // 用户通过浏览器 ESC 退出了全屏，同时退出 slideshow
                this.exitSlideshow();
            }
        };
        document.addEventListener('fullscreenchange', this._slideshowFullscreenHandler);
        
        // 请求全屏
        if (overlay.requestFullscreen) {
            overlay.requestFullscreen().catch(() => {});
        }
    },

    /**
     * 退出展示模式
     */
    exitSlideshow() {
        // 防止重复调用
        if (this._exitingSlidshow) return;
        this._exitingSlidshow = true;
        
        const overlay = document.getElementById('slideshowOverlay');
        if (overlay) {
            overlay.remove();
        }
        document.removeEventListener('keydown', this._slideshowKeyHandler);
        window.removeEventListener('resize', this._slideshowResizeHandler);
        document.removeEventListener('fullscreenchange', this._slideshowFullscreenHandler);
        
        // 退出全屏
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        
        // 同步当前页
        this.currentSlideIndex = this._slideshowIndex;
        this._updateSlideView();
        
        // 重置标志
        setTimeout(() => { this._exitingSlidshow = false; }, 100);
    },

    /**
     * 动态计算并应用幻灯片缩放
     */
    _updateSlideshowScale() {
        const overlay = document.getElementById('slideshowOverlay');
        const slide = document.getElementById('slideshowSlide');
        if (!overlay || !slide) return;
        
        // 使用 overlay 的实际尺寸
        const rect = overlay.getBoundingClientRect();
        const availableWidth = rect.width;
        const availableHeight = rect.height;
        const slideWidth = 960;
        const slideHeight = 540;
        
        // 计算缩放比例
        const scaleX = availableWidth / slideWidth;
        const scaleY = availableHeight / slideHeight;
        const scale = Math.min(scaleX, scaleY);
        
        slide.style.transform = `scale(${scale})`;
    },

    /**
     * 处理展示模式键盘事件
     */
    _handleSlideshowKeydown(e) {
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
            case ' ':
            case 'Enter':
                e.preventDefault();
                this._slideshowNext();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                this._slideshowPrev();
                break;
            case 'Escape':
                this.exitSlideshow();
                break;
            case 'Home':
                e.preventDefault();
                this._slideshowGoTo(0);
                break;
            case 'End':
                e.preventDefault();
                this._slideshowGoTo(this.slides.length - 1);
                break;
        }
    },

    _slideshowNext() {
        if (this._slideshowIndex < this.slides.length - 1) {
            this._slideshowIndex++;
            this._updateSlideshowView();
        }
    },

    _slideshowPrev() {
        if (this._slideshowIndex > 0) {
            this._slideshowIndex--;
            this._updateSlideshowView();
        }
    },

    _slideshowGoTo(index) {
        this._slideshowIndex = Math.max(0, Math.min(this.slides.length - 1, index));
        this._updateSlideshowView();
    },

    _updateSlideshowView() {
        const slideEl = document.getElementById('slideshowSlide');
        if (slideEl) {
            slideEl.innerHTML = `
                ${this._renderSlideContent(this.slides[this._slideshowIndex])}
                <div class="slideshow-controls">
                    <span id="slideshowPageInfo">${this._slideshowIndex + 1} / ${this.slides.length}</span>
                    <span class="slideshow-hint">← → 翻页 · ESC 退出</span>
                </div>
            `;
        }
    },

    // ============================================================
    // Slide Editing Actions (Toolbar)
    // ============================================================

    /**
     * 通过 AI 新增幻灯片
     */
    addSlideWithAI() {
        // 聚焦到聊天输入框，并填充提示
        const chatInput = document.getElementById('pptChatInput');
        if (chatInput) {
            chatInput.value = `在第 ${this.currentSlideIndex + 1} 页后新增一页幻灯片，内容是：`;
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
    },

    /**
     * 编辑当前幻灯片
     */
    editCurrentSlide() {
        const chatInput = document.getElementById('pptChatInput');
        if (chatInput) {
            chatInput.value = `修改第 ${this.currentSlideIndex + 1} 页：`;
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
    },

    /**
     * 复制当前幻灯片
     */
    duplicateSlide() {
        if (!this.slides || this.slides.length === 0) return;
        
        const currentSlide = this.slides[this.currentSlideIndex];
        const duplicated = JSON.parse(JSON.stringify(currentSlide));
        
        // 插入到当前页之后
        this.slides.splice(this.currentSlideIndex + 1, 0, duplicated);
        this.currentSlideIndex++;
        
        this._saveProject();
        this._refreshPresentation();
        this.addChatMessage('ai', `已复制第 ${this.currentSlideIndex} 页到第 ${this.currentSlideIndex + 1} 页。`);
    },

    /**
     * 删除当前幻灯片
     */
    deleteCurrentSlide() {
        if (!this.slides || this.slides.length <= 1) {
            this.addChatMessage('ai', '至少需要保留一页幻灯片。');
            return;
        }
        
        const deletedIndex = this.currentSlideIndex + 1;
        this.slides.splice(this.currentSlideIndex, 1);
        
        // 调整当前索引
        if (this.currentSlideIndex >= this.slides.length) {
            this.currentSlideIndex = this.slides.length - 1;
        }
        
        this._saveProject();
        this._refreshPresentation();
        this.addChatMessage('ai', `已删除第 ${deletedIndex} 页。`);
    },

    /**
     * 刷新演示界面
     */
    _refreshPresentation() {
        const container = document.getElementById('pptPreviewArea');
        if (container) {
            this.renderPresentationMode(container);
        }
    }
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : null;
        const w = (typeof window !== 'undefined') ? window : null;
        const ctor =
            (g && g.PPTGenerator?.prototype) ? g.PPTGenerator :
            (w && w.PPTGenerator?.prototype) ? w.PPTGenerator :
            (g && g.PPTGeneratorCtor?.prototype) ? g.PPTGeneratorCtor :
            (w && w.PPTGeneratorCtor?.prototype) ? w.PPTGeneratorCtor :
            (PPTGeneratorCtor?.prototype) ? PPTGeneratorCtor :
            null;

        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorPresentation);
    } catch {
        // ignore
    }
})();
