/**
 * PPT 幻灯片编辑器
 * 主编辑器类，整合所有模块
 */
class SlideEditor extends EventEmitter {
    constructor(options = {}) {
        super();

        // 核心模块
        this.document = new SlideDocument();
        this.history = new HistoryManager(this);
        this.selection = new SelectionManager(this);
        this.transform = new TransformController(this);

        // 项目状态
        this.currentProject = null;
        this.currentSlideIndex = 0;

        // UI 元素
        this.viewport = null;
        this.overlayContainer = null;

        // 渲染器
        this.renderer = null;

        // 配置
        this.options = {
            autoSave: true,
            snapToGrid: false,
            gridSize: 5,
            ...options,
        };

        // 绑定事件
        this._setupEventListeners();
    }

    /**
     * 初始化编辑器
     */
    async init(viewportId) {
        // 初始化存储
        await storageManager.init();

        // 获取视口元素
        this.viewport = document.getElementById(viewportId);
        if (!this.viewport) {
            throw new Error(`视口元素不存在: ${viewportId}`);
        }

        // 创建覆盖层容器（用于选择框、手柄等）
        this._createOverlayContainer();

        // 绑定视口事件
        this._bindViewportEvents();

        // 启动自动保存
        if (this.options.autoSave) {
            this.history.startAutoSave();
        }

        // 尝试加载上次的项目
        await this._loadLastProject();

        console.log('[SlideEditor] 初始化完成');
        this.emit('ready');
    }

    // ═══════════════════════════════════════════════════════════════
    // 项目管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 新建项目
     */
    async newProject(title = '未命名演示文稿') {
        // 保存当前项目
        if (this.currentProject && this.history.isDirty()) {
            await this.saveProject();
        }

        // 创建新项目
        this.currentProject = storageManager.createProject(title);

        // 添加默认幻灯片
        const defaultSlide = this._createDefaultSlide();
        this.document.load([defaultSlide]);

        this.currentSlideIndex = 0;
        this.selection.clear();
        this.history.clear();

        // 保存
        await this.saveProject();

        this.emit('project:new', this.currentProject);
        this.renderCurrentSlide();

        return this.currentProject;
    }

    /**
     * 打开项目
     */
    async openProject(projectId) {
        // 保存当前项目
        if (this.currentProject && this.history.isDirty()) {
            await this.saveProject();
        }

        const project = await storageManager.getProject(projectId);
        if (!project) {
            throw new Error('项目不存在');
        }

        this.currentProject = project;
        this.document.load(project.slides || []);
        this.currentSlideIndex = 0;
        this.selection.clear();
        this.history.clear();

        // 记录最近打开
        localStorage.setItem('ppt-editor-last-project', projectId);

        this.emit('project:open', this.currentProject);
        this.renderCurrentSlide();

        return this.currentProject;
    }

    /**
     * 保存项目
     */
    async saveProject() {
        if (!this.currentProject) return;

        this.currentProject.slides = this.document.toJSON();
        this.currentProject.updated = Date.now();

        // 生成缩略图
        try {
            this.currentProject.thumbnail = await this._generateThumbnail();
        } catch (e) {
            console.warn('[SlideEditor] 缩略图生成失败:', e);
        }

        await storageManager.saveProject(this.currentProject);
        this.history.markSaved();

        this.emit('project:save', this.currentProject);
    }

    /**
     * 删除项目
     */
    async deleteProject(projectId) {
        await storageManager.deleteProject(projectId);

        if (this.currentProject?.id === projectId) {
            this.currentProject = null;
            this.document.load([]);
            this.currentSlideIndex = 0;
        }

        this.emit('project:delete', projectId);
    }

    /**
     * 获取项目列表
     */
    async getProjectList() {
        return storageManager.listProjects();
    }

    /**
     * 导入 HTML
     */
    importFromHTML(html) {
        if (!window.SlideParser) {
            throw new Error('SlideParser 未加载');
        }

        const slides = SlideParser.parse(html);
        
        // 为所有元素生成 ID
        slides.forEach(slide => {
            if (!slide.id) slide.id = this.document._generateId();
            slide.elements?.forEach(el => {
                if (!el.id) el.id = this.document._generateId();
            });
        });

        this.document.load(slides);
        this.currentSlideIndex = 0;
        this.selection.clear();
        this.history.clear();

        this.emit('import', { source: 'html', slideCount: slides.length });
        this.renderCurrentSlide();
    }

    // ═══════════════════════════════════════════════════════════════
    // 幻灯片操作
    // ═══════════════════════════════════════════════════════════════

    /**
     * 切换幻灯片
     */
    goToSlide(index) {
        if (index < 0 || index >= this.document.getSlideCount()) return;

        this.currentSlideIndex = index;
        this.selection.clear();
        this.renderCurrentSlide();

        this.emit('slide:change', { index });
    }

    /**
     * 下一张
     */
    nextSlide() {
        this.goToSlide(this.currentSlideIndex + 1);
    }

    /**
     * 上一张
     */
    prevSlide() {
        this.goToSlide(this.currentSlideIndex - 1);
    }

    /**
     * 添加幻灯片
     */
    addSlide(slide = null, index = -1) {
        const newSlide = slide || this._createDefaultSlide();
        const insertIndex = index < 0 ? this.currentSlideIndex + 1 : index;

        this.document.addSlide(newSlide, insertIndex);

        // 记录历史
        this.history.push({
            type: 'slide.add',
            timestamp: Date.now(),
            slide: JSON.parse(JSON.stringify(newSlide)),
            index: insertIndex,
        });

        this.goToSlide(insertIndex);
        return newSlide;
    }

    /**
     * 删除幻灯片
     */
    deleteSlide(index = this.currentSlideIndex) {
        if (this.document.getSlideCount() <= 1) {
            console.warn('[SlideEditor] 至少保留一张幻灯片');
            return;
        }

        const slide = this.document.getSlide(index);
        this.document.removeSlide(index);

        // 记录历史
        this.history.push({
            type: 'slide.delete',
            timestamp: Date.now(),
            slide: JSON.parse(JSON.stringify(slide)),
            index,
        });

        // 调整当前索引
        if (this.currentSlideIndex >= this.document.getSlideCount()) {
            this.currentSlideIndex = this.document.getSlideCount() - 1;
        }

        this.selection.clear();
        this.renderCurrentSlide();
    }

    /**
     * 复制幻灯片
     */
    duplicateSlide(index = this.currentSlideIndex) {
        const copy = this.document.duplicateSlide(index);
        if (copy) {
            this.history.push({
                type: 'slide.add',
                timestamp: Date.now(),
                slide: JSON.parse(JSON.stringify(copy)),
                index: index + 1,
            });
            this.goToSlide(index + 1);
        }
        return copy;
    }

    // ═══════════════════════════════════════════════════════════════
    // 元素操作
    // ═══════════════════════════════════════════════════════════════

    /**
     * 添加元素
     */
    addElement(type, options = {}) {
        let element;

        switch (type) {
            case 'text':
                element = this.document.createTextElement(options);
                break;
            case 'image':
                element = this.document.createImageElement(options.assetId, options);
                break;
            case 'shape':
                element = this.document.createShapeElement(options.shapeType, options);
                break;
            case 'chart':
                element = this.document.createChartElement(options.chartType, options);
                break;
            case 'formula':
                element = this.document.createFormulaElement(options.latex, options);
                break;
            case 'icon':
                element = this.document.createIconElement(options.icon, options);
                break;
            case 'svg':
                element = this.document.createSvgElement(options.content, options);
                break;
            default:
                throw new Error(`未知元素类型: ${type}`);
        }

        const addedElement = this.document.addElement(this.currentSlideIndex, element);

        // 记录历史
        this.history.push(HistoryManager.createAddOp(
            this.currentSlideIndex,
            addedElement,
            this.document.getElements(this.currentSlideIndex).length - 1
        ));

        this.selection.select(addedElement.id);
        this.renderCurrentSlide();

        return addedElement;
    }

    /**
     * 删除选中元素
     */
    deleteSelected() {
        const selected = this.selection.getSelection();
        if (selected.length === 0) return;

        this.history.beginBatch('删除元素');

        for (const element of selected) {
            const location = this.document.getElementLocation(element.id);
            if (location) {
                this.history.push(HistoryManager.createDeleteOp(
                    location.slideIndex,
                    element,
                    location.elementIndex
                ));
                this.document.removeElement(location.slideIndex, element.id);
            }
        }

        this.history.commitBatch();
        this.selection.clear();
        this.renderCurrentSlide();
    }

    /**
     * 复制选中元素
     */
    duplicateSelected() {
        const selected = this.selection.getSelection();
        if (selected.length === 0) return;

        const newElements = this.document.duplicateElements(
            selected.map(el => el.id),
            { x: 2, y: 2 }
        );

        this.history.beginBatch('复制元素');
        for (const el of newElements) {
            const location = this.document.getElementLocation(el.id);
            this.history.push(HistoryManager.createAddOp(
                location.slideIndex,
                el,
                location.elementIndex
            ));
        }
        this.history.commitBatch();

        this.selection.selectMultiple(newElements.map(el => el.id));
        this.renderCurrentSlide();

        return newElements;
    }

    /**
     * 更新元素属性
     */
    updateElement(elementId, updates) {
        const element = this.document.getElementById(elementId);
        if (!element) return;

        // 记录变更
        const changes = Object.keys(updates).map(key => ({
            path: key,
            oldValue: element[key],
            newValue: updates[key],
        }));

        this.history.push(HistoryManager.createUpdateOp(elementId, changes));
        this.document.updateElement(elementId, updates);
        this.renderCurrentSlide();
    }

    /**
     * 批量更新元素
     */
    updateElements(updates) {
        this.history.beginBatch('批量更新');

        for (const { id, changes } of updates) {
            const element = this.document.getElementById(id);
            if (!element) continue;

            const changeList = Object.keys(changes).map(key => ({
                path: key,
                oldValue: element[key],
                newValue: changes[key],
            }));

            this.history.push(HistoryManager.createUpdateOp(id, changeList));
            this.document.updateElement(id, changes);
        }

        this.history.commitBatch();
        this.renderCurrentSlide();
    }

    /**
     * 移动到最前
     */
    bringToFront() {
        const selected = this.selection.getSelectedIds();
        for (const id of selected) {
            this.document.bringToFront(id);
        }
        this.renderCurrentSlide();
    }

    /**
     * 移动到最后
     */
    sendToBack() {
        const selected = this.selection.getSelectedIds();
        for (const id of selected) {
            this.document.sendToBack(id);
        }
        this.renderCurrentSlide();
    }

    // ═══════════════════════════════════════════════════════════════
    // 资源管理
    // ═══════════════════════════════════════════════════════════════

    /**
     * 添加图片（从文件）
     */
    async addImageFromFile(file) {
        if (!file.type.startsWith('image/')) {
            throw new Error('请选择图片文件');
        }

        // 获取图片尺寸
        const dimensions = await this._getImageDimensions(file);

        // 保存到资源库
        const asset = await storageManager.saveAsset(
            this.currentProject?.id,
            file,
            {
                name: file.name,
                width: dimensions.width,
                height: dimensions.height,
                source: { type: 'upload' },
            }
        );

        // 计算适合的显示尺寸（保持比例，最大 50%）
        const maxSize = 50;
        const ratio = dimensions.width / dimensions.height;
        let w, h;
        if (ratio > 1) {
            w = Math.min(maxSize, ratio * maxSize);
            h = w / ratio;
        } else {
            h = Math.min(maxSize, maxSize / ratio);
            w = h * ratio;
        }

        // 添加元素
        return this.addElement('image', {
            assetId: asset.id,
            x: (100 - w) / 2,
            y: (100 - h) / 2,
            w,
            h,
        });
    }

    /**
     * 添加图片（从 URL）
     */
    async addImageFromUrl(url) {
        // 下载图片
        const response = await fetch(url);
        const blob = await response.blob();

        // 获取尺寸
        const dimensions = await this._getImageDimensions(blob);

        // 保存
        const asset = await storageManager.saveAsset(
            this.currentProject?.id,
            blob,
            {
                name: url.split('/').pop() || 'image',
                width: dimensions.width,
                height: dimensions.height,
                source: { type: 'url', originalUrl: url },
            }
        );

        // 添加元素
        const maxSize = 50;
        const ratio = dimensions.width / dimensions.height;
        const w = ratio > 1 ? maxSize : maxSize * ratio;
        const h = ratio > 1 ? maxSize / ratio : maxSize;

        return this.addElement('image', {
            assetId: asset.id,
            x: (100 - w) / 2,
            y: (100 - h) / 2,
            w,
            h,
        });
    }

    /**
     * AI 生成图片
     */
    async generateImage(prompt, options = {}) {
        const result = await taskQueue.add({
            type: 'image-generation',
            input: { prompt, options },
            priority: TaskQueue.PRIORITY.NORMAL,
        });

        if (result.assetId) {
            return this.addElement('image', {
                assetId: result.assetId,
                x: 25,
                y: 25,
                w: 50,
                h: 50,
            });
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // 渲染
    // ═══════════════════════════════════════════════════════════════

    /**
     * 渲染当前幻灯片
     */
    renderCurrentSlide() {
        if (!this.viewport) return;

        const slide = this.document.getSlide(this.currentSlideIndex);
        if (!slide) {
            this.viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">没有幻灯片</div>';
            return;
        }

        // 使用现有的 HTMLSlideRenderer
        if (!this.renderer && window.HTMLSlideRenderer) {
            this.renderer = new HTMLSlideRenderer();
        }

        if (this.renderer) {
            const html = this.renderer.render(slide, this.currentSlideIndex);
            this.viewport.innerHTML = html;

            // 为每个元素添加 data-element-id
            this._addElementIds();
        }

        // 更新选择覆盖层
        this._updateOverlay();

        this.emit('render', { slideIndex: this.currentSlideIndex });
    }

    /**
     * 为 DOM 元素添加 ID 属性
     */
    _addElementIds() {
        const elements = this.document.getElements(this.currentSlideIndex);
        const domElements = this.viewport.querySelectorAll('[data-element-index]');

        domElements.forEach((dom, index) => {
            if (elements[index]) {
                dom.setAttribute('data-element-id', elements[index].id);
            }
        });
    }

    /**
     * 更新覆盖层（选择框、手柄等）
     */
    _updateOverlay() {
        if (!this.overlayContainer) return;

        // 清空
        this.overlayContainer.innerHTML = '';

        const selected = this.selection.getSelection();
        if (selected.length === 0) return;

        // 绘制选择框
        for (const element of selected) {
            this._drawSelectionBox(element);
        }

        // 绘制变换手柄
        const bounds = this.selection.getSelectionBounds();
        if (bounds) {
            this._drawTransformHandles(bounds);
        }
    }

    _drawSelectionBox(element) {
        const box = document.createElement('div');
        box.className = 'editor-selection-box';
        box.style.cssText = `
            position: absolute;
            left: ${element.x}%;
            top: ${element.y}%;
            width: ${element.w}%;
            height: ${element.h}%;
            border: 2px solid #3b82f6;
            pointer-events: none;
            box-sizing: border-box;
        `;
        this.overlayContainer.appendChild(box);
    }

    _drawTransformHandles(bounds) {
        const handles = this.transform.getHandlePositions(bounds);
        if (!handles) return;

        const handleStyle = `
            position: absolute;
            width: 8px;
            height: 8px;
            background: white;
            border: 2px solid #3b82f6;
            border-radius: 2px;
            cursor: pointer;
            transform: translate(-50%, -50%);
        `;

        for (const [type, pos] of Object.entries(handles)) {
            const handle = document.createElement('div');
            handle.className = 'editor-handle';
            handle.dataset.handleType = type;
            handle.style.cssText = handleStyle + `left: ${pos.x}%; top: ${pos.y}%;`;

            // 设置光标
            const cursors = {
                nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
                w: 'w-resize', e: 'e-resize',
                sw: 'sw-resize', s: 's-resize', se: 'se-resize',
                rotate: 'grab',
            };
            handle.style.cursor = cursors[type] || 'move';

            // 旋转手柄特殊样式
            if (type === 'rotate') {
                handle.style.borderRadius = '50%';
                handle.style.background = '#3b82f6';
            }

            this.overlayContainer.appendChild(handle);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 快捷键
    // ═══════════════════════════════════════════════════════════════

    _setupEventListeners() {
        // 历史变化
        this.history.on('change', () => {
            this.emit('history:change', {
                canUndo: this.history.canUndo(),
                canRedo: this.history.canRedo(),
                dirty: this.history.isDirty(),
            });
        });

        // 选择变化
        this.selection.on('change', (data) => {
            this._updateOverlay();
            this.emit('selection:change', data);
        });

        // 键盘事件
        document.addEventListener('keydown', (e) => this._handleKeyDown(e));
    }

    _handleKeyDown(e) {
        // 忽略输入框中的快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        const ctrl = e.ctrlKey || e.metaKey;

        // Ctrl+Z 撤销
        if (ctrl && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.history.undo();
        }
        // Ctrl+Shift+Z 或 Ctrl+Y 重做
        else if ((ctrl && e.shiftKey && e.key === 'z') || (ctrl && e.key === 'y')) {
            e.preventDefault();
            this.history.redo();
        }
        // Ctrl+S 保存
        else if (ctrl && e.key === 's') {
            e.preventDefault();
            this.saveProject();
        }
        // Ctrl+A 全选
        else if (ctrl && e.key === 'a') {
            e.preventDefault();
            this.selection.selectAll();
        }
        // Ctrl+D 复制
        else if (ctrl && e.key === 'd') {
            e.preventDefault();
            this.duplicateSelected();
        }
        // Delete/Backspace 删除
        else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.deleteSelected();
        }
        // Escape 取消选择
        else if (e.key === 'Escape') {
            this.selection.deselectAll();
            this.transform.cancel();
        }
        // 方向键移动
        else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const delta = e.shiftKey ? 5 : 1;
            const updates = this.selection.getSelection().map(el => ({
                id: el.id,
                changes: {
                    x: el.x + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0),
                    y: el.y + (e.key === 'ArrowDown' ? delta : e.key === 'ArrowUp' ? -delta : 0),
                },
            }));
            if (updates.length > 0) {
                this.updateElements(updates);
            }
        }
        // Page Up/Down 切换幻灯片
        else if (e.key === 'PageUp') {
            e.preventDefault();
            this.prevSlide();
        }
        else if (e.key === 'PageDown') {
            e.preventDefault();
            this.nextSlide();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 视口事件
    // ═══════════════════════════════════════════════════════════════

    _bindViewportEvents() {
        if (!this.viewport) return;

        this.viewport.addEventListener('mousedown', (e) => this._handleMouseDown(e));
        this.viewport.addEventListener('click', (e) => this._handleClick(e));
        this.viewport.addEventListener('dblclick', (e) => this._handleDblClick(e));
    }

    _handleMouseDown(e) {
        // 检查是否点击了手柄
        const handle = e.target.closest('.editor-handle');
        if (handle) {
            const handleType = handle.dataset.handleType;
            const rect = this.viewport.getBoundingClientRect();
            const mousePos = {
                x: ((e.clientX - rect.left) / rect.width) * 100,
                y: ((e.clientY - rect.top) / rect.height) * 100,
            };
            this.transform.start(handleType, mousePos);
            e.preventDefault();
            return;
        }

        // 检查是否点击了元素
        const elementDom = e.target.closest('[data-element-id]');
        if (elementDom) {
            const elementId = elementDom.dataset.elementId;
            
            if (e.ctrlKey || e.metaKey) {
                this.selection.toggle(elementId);
            } else if (!this.selection.isSelected(elementId)) {
                this.selection.select(elementId);
            }

            // 开始移动
            const rect = this.viewport.getBoundingClientRect();
            const mousePos = {
                x: ((e.clientX - rect.left) / rect.width) * 100,
                y: ((e.clientY - rect.top) / rect.height) * 100,
            };
            this.transform.start(TransformController.HANDLE.MOVE, mousePos);
            e.preventDefault();
            return;
        }

        // 点击空白区域，取消选择
        this.selection.deselectAll();
    }

    _handleClick(e) {
        // 由 mousedown 处理
    }

    _handleDblClick(e) {
        const elementDom = e.target.closest('[data-element-id]');
        if (elementDom) {
            const elementId = elementDom.dataset.elementId;
            const element = this.document.getElementById(elementId);
            if (element) {
                this.emit('element:dblclick', { element, dom: elementDom });
                // 文本元素进入编辑模式
                if (element.type === 'text') {
                    this._startTextEditing(element, elementDom);
                }
            }
        }
    }

    _startTextEditing(element, dom) {
        // TODO: 实现文本编辑
        console.log('[SlideEditor] 开始编辑文本:', element.id);
        this.emit('text:edit', { element, dom });
    }

    // ═══════════════════════════════════════════════════════════════
    // 辅助方法
    // ═══════════════════════════════════════════════════════════════

    _createOverlayContainer() {
        this.overlayContainer = document.createElement('div');
        this.overlayContainer.className = 'editor-overlay';
        this.overlayContainer.style.cssText = `
            position: absolute;
            inset: 0;
            pointer-events: none;
            z-index: 100;
        `;
        // 手柄需要响应事件
        this.overlayContainer.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('editor-handle')) {
                e.target.style.pointerEvents = 'auto';
            }
        });

        this.viewport.style.position = 'relative';
        this.viewport.appendChild(this.overlayContainer);
    }

    _createDefaultSlide() {
        return {
            id: this.document._generateId(),
            type: 'freeform',
            background: '#ffffff',
            elements: [],
        };
    }

    async _loadLastProject() {
        const lastProjectId = localStorage.getItem('ppt-editor-last-project');
        if (lastProjectId) {
            try {
                await this.openProject(lastProjectId);
                return;
            } catch (e) {
                console.warn('[SlideEditor] 加载上次项目失败:', e);
            }
        }

        // 没有上次项目，创建新项目
        await this.newProject();
    }

    async _generateThumbnail() {
        // TODO: 使用 html2canvas 生成缩略图
        return null;
    }

    _getImageDimensions(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('无法读取图片'));
            };
            img.src = URL.createObjectURL(file);
        });
    }

    /**
     * 销毁编辑器
     */
    destroy() {
        this.history.stopAutoSave();
        this.clear();
        if (this.overlayContainer) {
            this.overlayContainer.remove();
        }
    }
}

window.SlideEditor = SlideEditor;
