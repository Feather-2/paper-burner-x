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
        
        // 编辑模式状态
        this.enabled = false;

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
     * 递归查找元素（支持 group 子元素）
     */
    findElementById(elementId, elements = null) {
        if (!elements) {
            const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
            elements = slide?.elements || [];
        }
        
        for (const el of elements) {
            if (el.id === elementId) return el;
            // 递归搜索 group 子元素
            if (el.type === 'group' && el.children?.length > 0) {
                const found = this.findElementById(elementId, el.children);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * 更新元素属性
     */
    updateElement(elementId, updates) {
        // 递归查找元素（支持 group 子元素）
        const element = this.findElementById(elementId);
        if (!element) return;

        // 记录旧值用于撤销
        const oldValues = {};
        for (const key of Object.keys(updates)) {
            oldValues[key] = element[key];
        }

        // 如果元素有 rawStyle，需要同时更新 rawStyle 中的对应样式
        if (element.rawStyle && updates) {
            let newRawStyle = element.rawStyle;
            for (const [key, value] of Object.entries(updates)) {
                const cssMap = {
                    color: `color: ${value};`,
                    fill: `background: ${value};`,
                    opacity: `opacity: ${value};`,
                    fontSize: `font-size: ${value}px;`,
                };
                if (cssMap[key]) {
                    // 将属性名映射到 CSS 属性名
                    const cssPropMap = { fill: 'background', fontSize: 'font-size' };
                    const cssProp = cssPropMap[key] || key;
                    const regex = new RegExp(`${cssProp}:\\s*[^;]+;?`, 'gi');
                    if (regex.test(newRawStyle)) {
                        newRawStyle = newRawStyle.replace(regex, cssMap[key]);
                    } else {
                        newRawStyle += ' ' + cssMap[key];
                    }
                }
            }
            updates.rawStyle = newRawStyle;
        }

        // 直接更新元素属性
        Object.assign(element, updates);
        
        // 同步到 document
        this.document.updateElement(elementId, updates);
        
        // 记录历史（用于撤销/重做）
        const changes = Object.keys(updates).map(key => ({
            path: key,
            oldValue: oldValues[key],
            newValue: updates[key]
        }));
        this.history.push({
            type: 'element.update',
            elementId,
            slideIndex: this.currentSlideIndex,
            changes
        });
        
        this.renderCurrentSlide();
        
        // 触发自动保存
        this._scheduleAutoSave();
    }
    
    /**
     * 防抖自动保存（2秒后保存）
     */
    _scheduleAutoSave() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
        }
        this._autoSaveTimer = setTimeout(() => {
            this._saveToStorage();
        }, 2000);
    }
    
    /**
     * 保存到 IndexedDB
     */
    async _saveToStorage() {
        const project = window.PPTGenerator?.currentProject;
        if (!project?.id || !window.pptStorage) return;
        
        try {
            // 更新 slides 数据
            project.slides = window.PPTGenerator.slides;
            project.updatedAt = Date.now();
            await window.pptStorage.saveProject(project);
            console.log('[SlideEditor] 自动保存成功');
            
            // 显示保存提示
            this._showSaveIndicator();
        } catch (e) {
            console.error('[SlideEditor] 自动保存失败:', e);
        }
    }
    
    /**
     * 显示保存成功提示
     */
    _showSaveIndicator() {
        // 移除旧提示
        const old = document.querySelector('.save-indicator');
        if (old) old.remove();
        
        const indicator = document.createElement('div');
        indicator.className = 'save-indicator';
        indicator.textContent = '✓ 已保存';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 10000;
            animation: fadeInOut 2s ease;
        `;
        
        // 添加动画样式
        if (!document.querySelector('#save-indicator-style')) {
            const style = document.createElement('style');
            style.id = 'save-indicator-style';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateY(10px); }
                    20% { opacity: 1; transform: translateY(0); }
                    80% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 2000);
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
    // 编组/解组功能
    // ═══════════════════════════════════════════════════════════════

    /**
     * 将选中的元素编组
     */
    groupElements() {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length < 2) {
            console.log('[SlideEditor] 需要选择至少2个元素才能编组');
            return null;
        }

        const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        if (!slide?.elements) return null;

        // 获取选中的元素（只取顶层元素）
        const elementsToGroup = [];
        const indicesToRemove = [];
        
        for (let i = 0; i < slide.elements.length; i++) {
            const el = slide.elements[i];
            if (selectedIds.includes(el.id)) {
                elementsToGroup.push({ ...el });  // 深拷贝
                indicesToRemove.push(i);
            }
        }

        if (elementsToGroup.length < 2) return null;

        // 计算组的边界框
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of elementsToGroup) {
            const x = parseFloat(el.x) || 0;
            const y = parseFloat(el.y) || 0;
            const w = parseFloat(el.w) || 10;
            const h = parseFloat(el.h) || 10;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }

        // 将子元素坐标转为相对于组的坐标
        const groupW = maxX - minX;
        const groupH = maxY - minY;
        for (const el of elementsToGroup) {
            const x = parseFloat(el.x) || 0;
            const y = parseFloat(el.y) || 0;
            const w = parseFloat(el.w) || 10;
            const h = parseFloat(el.h) || 10;
            // 转换为相对百分比
            el.x = ((x - minX) / groupW * 100).toFixed(1) + '%';
            el.y = ((y - minY) / groupH * 100).toFixed(1) + '%';
            el.w = (w / groupW * 100).toFixed(1) + '%';
            el.h = (h / groupH * 100).toFixed(1) + '%';
        }

        // 创建新的 group 元素
        const groupElement = {
            id: `el-${Date.now()}`,
            type: 'group',
            x: minX + '%',
            y: minY + '%',
            w: groupW + '%',
            h: groupH + '%',
            z: Math.max(...elementsToGroup.map(el => el.z || 0)) + 1,
            children: elementsToGroup,
        };

        // 从后往前删除原元素（避免索引偏移问题）
        for (let i = indicesToRemove.length - 1; i >= 0; i--) {
            slide.elements.splice(indicesToRemove[i], 1);
        }

        // 添加 group
        slide.elements.push(groupElement);

        // 更新选择
        this.selection.clear();
        this.selection.select(groupElement.id);

        // 重新渲染
        this.renderCurrentSlide();
        this.emit('group', { groupId: groupElement.id, childIds: selectedIds });

        console.log('[SlideEditor] 已编组:', groupElement.id, '包含', elementsToGroup.length, '个元素');
        return groupElement;
    }

    /**
     * 解散选中的组（炸开）
     */
    ungroupElements() {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length !== 1) {
            console.log('[SlideEditor] 请选择一个组进行解组');
            return null;
        }

        const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        if (!slide?.elements) return null;

        const groupId = selectedIds[0];
        const groupIndex = slide.elements.findIndex(el => el.id === groupId);
        if (groupIndex < 0) return null;

        const group = slide.elements[groupIndex];
        if (group.type !== 'group' || !group.children?.length) {
            console.log('[SlideEditor] 选中的元素不是组');
            return null;
        }

        // 获取组的绝对坐标
        const groupX = parseFloat(group.x) || 0;
        const groupY = parseFloat(group.y) || 0;
        const groupW = parseFloat(group.w) || 100;
        const groupH = parseFloat(group.h) || 100;

        // 将子元素坐标转换为绝对坐标
        const extractedElements = [];
        for (const child of group.children) {
            const childX = parseFloat(child.x) || 0;
            const childY = parseFloat(child.y) || 0;
            const childW = parseFloat(child.w) || 100;
            const childH = parseFloat(child.h) || 100;

            const newElement = {
                ...child,
                id: child.id || `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                x: (groupX + childX * groupW / 100).toFixed(1) + '%',
                y: (groupY + childY * groupH / 100).toFixed(1) + '%',
                w: (childW * groupW / 100).toFixed(1) + '%',
                h: (childH * groupH / 100).toFixed(1) + '%',
            };
            extractedElements.push(newElement);
        }

        // 删除原 group
        slide.elements.splice(groupIndex, 1);

        // 在原位置插入解组后的元素
        slide.elements.splice(groupIndex, 0, ...extractedElements);

        // 更新选择（选中所有解组后的元素）
        this.selection.clear();
        this.selection.selectMultiple(extractedElements.map(el => el.id));

        // 重新渲染
        this.renderCurrentSlide();
        this.emit('ungroup', { groupId, childIds: extractedElements.map(el => el.id) });

        console.log('[SlideEditor] 已解组:', groupId, '释放', extractedElements.length, '个元素');
        return extractedElements;
    }

    // ═══════════════════════════════════════════════════════════════
    // 组编辑模式
    // ═══════════════════════════════════════════════════════════════

    /**
     * 进入组编辑模式（双击组触发）
     * 其他元素变模糊，可以编辑组内元素
     */
    enterGroupEditMode(groupId) {
        const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        if (!slide?.elements) return;

        const group = slide.elements.find(el => el.id === groupId);
        if (!group || group.type !== 'group') {
            console.log('[SlideEditor] 无效的组 ID:', groupId);
            return;
        }

        // 记录当前编辑的组
        this.editingGroupId = groupId;
        this.editingGroup = group;

        console.log('[SlideEditor] 进入组编辑模式:', groupId);

        // 添加模糊效果到其他元素
        this._applyGroupEditOverlay(groupId);

        // 清除当前选择
        this.selection.clear();

        // 发出事件
        this.emit('group:enter', { groupId, group });
    }

    /**
     * 退出组编辑模式
     */
    exitGroupEditMode() {
        if (!this.editingGroupId) return;

        console.log('[SlideEditor] 退出组编辑模式:', this.editingGroupId);

        // 移除模糊效果
        this._removeGroupEditOverlay();

        const groupId = this.editingGroupId;
        this.editingGroupId = null;
        this.editingGroup = null;

        // 重新选中组
        this.selection.select(groupId);

        // 发出事件
        this.emit('group:exit', { groupId });
    }

    /**
     * 应用组编辑模式的覆盖层（模糊其他元素）
     */
    _applyGroupEditOverlay(groupId) {
        if (!this.viewport) return;

        // 创建覆盖层（只有模糊，无颜色）
        let overlay = this.viewport.querySelector('.group-edit-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'group-edit-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                backdrop-filter: blur(3px);
                pointer-events: none;
                z-index: 50;
            `;
            this.viewport.appendChild(overlay);
        }
        overlay.style.display = 'block';

        // 将当前组提升到覆盖层之上（只改 z-index，不改 position）
        const groupDom = this.viewport.querySelector(`[data-element-id="${groupId}"]`);
        if (groupDom) {
            groupDom.style.zIndex = '100';
            groupDom.classList.add('editing-group');
        }

        // 隐藏选择框覆盖层，避免挡住组内元素
        if (this.overlayContainer) {
            this.overlayContainer.style.display = 'none';
        }

        // 添加点击空白处退出的监听
        this._groupEditClickHandler = (e) => {
            // 如果点击了覆盖层（空白处），退出组编辑模式
            if (e.target === overlay || e.target === this.viewport) {
                this.exitGroupEditMode();
            }
        };
        this.viewport.addEventListener('click', this._groupEditClickHandler);

        // 添加 ESC 键退出
        this._groupEditKeyHandler = (e) => {
            if (e.key === 'Escape' && this.editingGroupId) {
                this.exitGroupEditMode();
            }
        };
        document.addEventListener('keydown', this._groupEditKeyHandler);
    }

    /**
     * 移除组编辑模式的覆盖层
     */
    _removeGroupEditOverlay() {
        if (!this.viewport) return;

        // 隐藏覆盖层
        const overlay = this.viewport.querySelector('.group-edit-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }

        // 恢复组的 z-index
        const groupDom = this.viewport.querySelector('.editing-group');
        if (groupDom) {
            groupDom.style.zIndex = '';
            groupDom.classList.remove('editing-group');
        }

        // 恢复选择框覆盖层
        if (this.overlayContainer) {
            this.overlayContainer.style.display = '';
        }

        // 移除事件监听
        if (this._groupEditClickHandler) {
            this.viewport.removeEventListener('click', this._groupEditClickHandler);
            this._groupEditClickHandler = null;
        }
        if (this._groupEditKeyHandler) {
            document.removeEventListener('keydown', this._groupEditKeyHandler);
            this._groupEditKeyHandler = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 对齐功能
    // ═══════════════════════════════════════════════════════════════

    /**
     * 对齐选中的元素
     * @param {string} type - 对齐类型: left, center, right, top, middle, bottom, distributeH, distributeV
     */
    alignElements(type) {
        const selectedIds = this.selection.getSelectedIds();
        if (selectedIds.length < 2 && !['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(type)) {
            return; // 分布对齐需要至少2个元素
        }
        if (selectedIds.length < 1) return;
        
        const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        if (!slide?.elements) return;
        
        // 获取选中元素的边界
        const elements = selectedIds.map(id => {
            const el = slide.elements.find(e => e.id === id);
            if (!el) return null;
            const x = parseFloat(el.x) || 0;
            const y = parseFloat(el.y) || 0;
            const w = parseFloat(el.w) || 10;
            const h = parseFloat(el.h) || 10;
            return { id, x, y, w, h, el };
        }).filter(Boolean);
        
        if (elements.length === 0) return;
        
        // 计算边界
        const minX = Math.min(...elements.map(e => e.x));
        const maxX = Math.max(...elements.map(e => e.x + e.w));
        const minY = Math.min(...elements.map(e => e.y));
        const maxY = Math.max(...elements.map(e => e.y + e.h));
        
        // 收集所有更新
        const updates = [];
        
        for (const elem of elements) {
            let newX = elem.x, newY = elem.y;
            let textAlign = null;
            
            switch (type) {
                case 'left':
                    newX = minX;
                    textAlign = 'left';
                    break;
                case 'center':
                    newX = (minX + maxX) / 2 - elem.w / 2;
                    textAlign = 'center';
                    break;
                case 'right':
                    newX = maxX - elem.w;
                    textAlign = 'right';
                    break;
                case 'top':
                    newY = minY;
                    break;
                case 'middle':
                    newY = (minY + maxY) / 2 - elem.h / 2;
                    break;
                case 'bottom':
                    newY = maxY - elem.h;
                    break;
            }
            
            const update = {};
            if (newX !== elem.x) update.x = `${newX}%`;
            if (newY !== elem.y) update.y = `${newY}%`;
            if (textAlign && elem.el.type === 'text') update.align = textAlign;
            
            if (Object.keys(update).length > 0) {
                updates.push({ id: elem.id, update, elem });
            }
        }
        
        // 分布对齐
        if (type === 'distributeH' && elements.length >= 3) {
            elements.sort((a, b) => a.x - b.x);
            const totalWidth = elements.reduce((sum, e) => sum + e.w, 0);
            const space = (maxX - minX - totalWidth) / (elements.length - 1);
            let currentX = minX;
            for (const elem of elements) {
                const existing = updates.find(u => u.id === elem.id);
                if (existing) {
                    existing.update.x = `${currentX}%`;
                } else {
                    updates.push({ id: elem.id, update: { x: `${currentX}%` } });
                }
                currentX += elem.w + space;
            }
        }
        
        if (type === 'distributeV' && elements.length >= 3) {
            elements.sort((a, b) => a.y - b.y);
            const totalHeight = elements.reduce((sum, e) => sum + e.h, 0);
            const space = (maxY - minY - totalHeight) / (elements.length - 1);
            let currentY = minY;
            for (const elem of elements) {
                const existing = updates.find(u => u.id === elem.id);
                if (existing) {
                    existing.update.y = `${currentY}%`;
                } else {
                    updates.push({ id: elem.id, update: { y: `${currentY}%` } });
                }
                currentY += elem.h + space;
            }
        }
        
        // 通过 updateElement 应用所有更新（会记录历史）
        for (const { id, update } of updates) {
            this.updateElement(id, update);
        }
        
        // 从 PPTGenerator.slides 获取最新元素数据来刷新属性面板
        const currentSlide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        const freshElements = selectedIds
            .map(id => currentSlide?.elements?.find(e => e.id === id))
            .filter(Boolean);
        this.selection.emit('change', { elements: freshElements });
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

        // 直接使用 PPTGenerator.slides
        const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
        if (!slide) {
            this.viewport.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;">没有幻灯片</div>';
            return;
        }

        // 渲染
        let html;
        if (window.PPTGenerator && typeof window.PPTGenerator._renderSlideContent === 'function') {
            html = window.PPTGenerator._renderSlideContent(slide);
        } else if (window.HTMLSlideRenderer) {
            if (!this.renderer) this.renderer = new HTMLSlideRenderer();
            html = this.renderer.render(slide, this.currentSlideIndex);
        }
        
        if (html) {
            this.viewport.innerHTML = html;
        }

        // 重新创建覆盖层
        this._createOverlayContainer();
        
        // 绑定元素 ID
        this._addElementIds();

        // 更新选择覆盖层
        this._updateOverlay();

        this.emit('render', { slideIndex: this.currentSlideIndex });
    }

    /**
     * 为 DOM 元素设置交互属性（ID 已在渲染时注入）
     */
    _addElementIds() {
        if (!this.viewport) return;
        
        // 查找所有带 data-element-id 的元素（递归包括 group 子元素）
        const elements = this.viewport.querySelectorAll('[data-element-id]');
        
        elements.forEach(dom => {
            // SVG 元素特殊处理：保持容器 pointer-events: none，让 line 可点击
            if (dom.tagName.toLowerCase() === 'svg') {
                dom.style.pointerEvents = 'none';
                const line = dom.querySelector('line');
                if (line) {
                    line.style.pointerEvents = 'stroke';
                    line.style.cursor = 'pointer';
                    // 把 ID 也加到 line 上方便点击选中
                    line.setAttribute('data-element-id', dom.dataset.elementId);
                }
            } else {
                dom.style.cursor = 'pointer';
                dom.style.pointerEvents = 'auto';
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

        const selectedIds = this.selection.getSelectedIds();
        
        if (selectedIds.length === 0) return;

        // 绘制选择框
        for (const id of selectedIds) {
            this._drawSelectionBox(id);
        }

        // 绘制变换手柄
        const bounds = this._getSelectionBounds(selectedIds);
        if (bounds) {
            this._drawTransformHandles(bounds);
        }
    }
    
    /**
     * 计算选中元素的边界（使用 DOM 实际位置）
     */
    _getSelectionBounds(elementIds) {
        if (!this.viewport) return null;
        
        const containerRect = this.viewport.getBoundingClientRect();
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const id of elementIds) {
            // 优先查找顶层元素，再查找 Group 子元素
            let domElement = this.viewport.querySelector(`[data-element-id="${id}"]`);
            if (!domElement) {
                domElement = this.viewport.querySelector(`[data-child-id="${id}"]`);
            }
            if (!domElement) continue;
            
            const rect = domElement.getBoundingClientRect();
            const x = ((rect.left - containerRect.left) / containerRect.width) * 100;
            const y = ((rect.top - containerRect.top) / containerRect.height) * 100;
            const w = (rect.width / containerRect.width) * 100;
            const h = (rect.height / containerRect.height) * 100;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }
        
        if (minX === Infinity) return null;
        
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    _drawSelectionBox(elementId) {
        // 从 DOM 获取元素的实际位置（支持 Group 子元素）
        let domElement = this.viewport?.querySelector(`[data-element-id="${elementId}"]`);
        if (!domElement) {
            domElement = this.viewport?.querySelector(`[data-child-id="${elementId}"]`);
        }
        if (!domElement) return;
        
        const containerRect = this.viewport.getBoundingClientRect();
        const elementRect = domElement.getBoundingClientRect();
        
        // 计算 DOM 元素边界（百分比）
        const x = ((elementRect.left - containerRect.left) / containerRect.width) * 100;
        const y = ((elementRect.top - containerRect.top) / containerRect.height) * 100;
        const w = (elementRect.width / containerRect.width) * 100;
        const h = (elementRect.height / containerRect.height) * 100;
        
        // 尝试获取内容的实际边界（文本、图片等）
        let contentRect = null;
        const tagName = domElement.tagName.toLowerCase();
        
        if (tagName === 'div' && domElement.textContent?.trim()) {
            // 对于文本元素，使用 Range 获取实际文本边界
            const range = document.createRange();
            range.selectNodeContents(domElement);
            const rects = range.getClientRects();
            if (rects.length > 0) {
                // 合并所有文本行的边界
                let minLeft = Infinity, minTop = Infinity;
                let maxRight = -Infinity, maxBottom = -Infinity;
                for (const rect of rects) {
                    minLeft = Math.min(minLeft, rect.left);
                    minTop = Math.min(minTop, rect.top);
                    maxRight = Math.max(maxRight, rect.right);
                    maxBottom = Math.max(maxBottom, rect.bottom);
                }
                contentRect = {
                    left: minLeft,
                    top: minTop,
                    width: maxRight - minLeft,
                    height: maxBottom - minTop
                };
            }
        }
        
        // 只在内容边界在两个方向上都明显小于 DOM 边界时才显示双边框
        // （用于提示用户容器比内容大，可能有多余空间）
        // 必须两个方向都满足，避免一个方向溢出时显示奇怪的边框
        const contentSmaller = contentRect && (
            contentRect.width < elementRect.width - 10 &&
            contentRect.height < elementRect.height - 10
        );
        
        if (contentSmaller && contentRect) {
            // DOM 边界（虚线，外层）
            const domBox = document.createElement('div');
            domBox.className = 'editor-selection-box editor-dom-boundary';
            domBox.style.cssText = `
                position: absolute;
                left: ${x}%;
                top: ${y}%;
                width: ${w}%;
                height: ${h}%;
                border: 1px dashed rgba(59, 130, 246, 0.4);
                background: transparent;
                pointer-events: none;
                box-sizing: border-box;
                z-index: 9998;
            `;
            this.overlayContainer?.appendChild(domBox);
            
            // 内容边界（实线，内层）
            const cx = ((contentRect.left - containerRect.left) / containerRect.width) * 100;
            const cy = ((contentRect.top - containerRect.top) / containerRect.height) * 100;
            const cw = (contentRect.width / containerRect.width) * 100;
            const ch = (contentRect.height / containerRect.height) * 100;
            
            const contentBox = document.createElement('div');
            contentBox.className = 'editor-selection-box editor-content-boundary';
            contentBox.style.cssText = `
                position: absolute;
                left: ${cx}%;
                top: ${cy}%;
                width: ${cw}%;
                height: ${ch}%;
                border: 2px solid #3b82f6;
                background: rgba(59, 130, 246, 0.1);
                pointer-events: none;
                box-sizing: border-box;
                z-index: 9999;
            `;
            this.overlayContainer?.appendChild(contentBox);
        } else {
            // 只显示一个边框
            const box = document.createElement('div');
            box.className = 'editor-selection-box';
            box.style.cssText = `
                position: absolute;
                left: ${x}%;
                top: ${y}%;
                width: ${w}%;
                height: ${h}%;
                border: 2px solid #3b82f6;
                background: rgba(59, 130, 246, 0.1);
                pointer-events: none;
                box-sizing: border-box;
                z-index: 9999;
            `;
            this.overlayContainer?.appendChild(box);
        }
    }

    _drawTransformHandles(bounds) {
        const handles = this.transform.getHandlePositions(bounds);
        if (!handles) return;

        const handleStyle = `
            position: absolute;
            width: 10px;
            height: 10px;
            background: white;
            border: 2px solid #3b82f6;
            border-radius: 2px;
            transform: translate(-50%, -50%);
            pointer-events: auto;
            z-index: 1001;
        `;

        for (const [type, pos] of Object.entries(handles)) {
            const handle = document.createElement('div');
            handle.className = 'editor-handle';
            handle.dataset.handleType = type;
            handle.style.cssText = handleStyle + `left: ${pos.x}%; top: ${pos.y}%;`;

            // 设置光标
            const cursors = {
                nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
                w: 'ew-resize', e: 'ew-resize',
                sw: 'nesw-resize', s: 'ns-resize', se: 'nwse-resize',
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
            this.renderCurrentSlide();
        }
        // Ctrl+Shift+Z 或 Ctrl+Y 重做
        else if ((ctrl && e.shiftKey && e.key === 'z') || (ctrl && e.key === 'y')) {
            e.preventDefault();
            this.history.redo();
            this.renderCurrentSlide();
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
        // Ctrl+G 编组
        else if (ctrl && e.key === 'g' && !e.shiftKey) {
            e.preventDefault();
            this.groupElements();
        }
        // Ctrl+Shift+G 解组
        else if (ctrl && e.shiftKey && e.key === 'G') {
            e.preventDefault();
            this.ungroupElements();
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
        
        // 保存当前编辑器实例到全局
        window._currentSlideEditor = this;
        
        // 避免重复绑定到 window
        if (window._slideEditorBound) return;
        window._slideEditorBound = true;

        console.log('[SlideEditor] 绑定全局事件');
        
        // 使用 window 监听，确保能捕获所有事件
        // 通过全局变量访问当前编辑器，确保始终使用最新的实例
        window.addEventListener('mousedown', (e) => {
            const editor = window._currentSlideEditor;
            if (!editor?.enabled) return;
            
            const viewport = document.getElementById('presSlideCanvas');
            if (viewport && viewport.contains(e.target)) {
                editor._handleMouseDown(e);
            }
        }, true);
        
        window.addEventListener('dblclick', (e) => {
            const editor = window._currentSlideEditor;
            if (!editor?.enabled) return;
            
            const viewport = document.getElementById('presSlideCanvas');
            if (viewport && viewport.contains(e.target)) {
                console.log('[SlideEditor] 捕获到双击事件:', e.target.tagName);
                editor._handleDblClick(e);
            }
        }, true);

        // 右键菜单
        window.addEventListener('contextmenu', (e) => {
            const editor = window._currentSlideEditor;
            if (!editor?.enabled) return;
            
            const viewport = document.getElementById('presSlideCanvas');
            if (viewport && viewport.contains(e.target)) {
                e.preventDefault();
                editor._handleContextMenu(e);
            }
        }, true);
    }

    _handleContextMenu(e) {
        // 懒加载右键菜单
        if (!this.contextMenu) {
            if (window.ContextMenu) {
                this.contextMenu = new window.ContextMenu(this);
                this._showContextMenu(e);
            } else {
                // 动态加载脚本
                const script = document.createElement('script');
                script.src = 'js/ppt/editor/context-menu.js';
                script.onload = () => {
                    this.contextMenu = new window.ContextMenu(this);
                    this._showContextMenu(e);
                };
                script.onerror = () => console.error('[SlideEditor] 加载右键菜单失败');
                document.head.appendChild(script);
            }
        } else {
            this._showContextMenu(e);
        }
    }

    _showContextMenu(e) {
        // 获取点击的元素
        const elementDom = e.target.closest('[data-element-id]');
        let element = null;
        
        if (elementDom) {
            const elementId = elementDom.dataset.elementId;
            const slide = window.PPTGenerator?.slides?.[this.currentSlideIndex];
            element = slide?.elements?.find(el => el.id === elementId);
            
            // 如果点击的元素未选中，先选中它
            if (!this.selection.isSelected(elementId)) {
                this.selection.select(elementId);
            }
        }

        this.contextMenu.show(e.clientX, e.clientY, element);
    }

    _handleMouseDown(e) {
        // 非编辑模式下不处理
        if (!this.enabled) return;
        
        // 确保点击在 viewport 内
        if (!this.viewport.contains(e.target)) return;
        
        // 检查是否点击了手柄
        const handle = e.target.closest('.editor-handle');
        if (handle && this.viewport.contains(handle)) {
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

        // Alt+点击：穿透 Group 选中子元素
        if (e.altKey) {
            const childDom = e.target.closest('[data-child-id]');
            if (childDom && this.viewport.contains(childDom)) {
                const childId = childDom.dataset.childId;
                const parentId = childDom.dataset.childOf;
                // 选中子元素（需要在数据层面支持）
                this.selection.selectGroupChild(parentId, childId);
                e.preventDefault();
                return;
            }
        }

        // 检查是否点击了元素（必须在 viewport 内）
        let elementDom = e.target.closest('[data-element-id]');
        if (elementDom && !this.viewport.contains(elementDom)) {
            elementDom = null;
        }
        
        if (elementDom) {
            const elementId = elementDom.dataset.elementId;
            const isAlreadySelected = this.selection.isSelected(elementId);
            
            if (e.ctrlKey || e.metaKey) {
                this.selection.toggle(elementId);
            } else if (!isAlreadySelected) {
                // 只有点击未选中的元素时才单选，避免破坏多选
                this.selection.select(elementId);
            }

            // 延迟开始移动，避免影响双击检测
            const rect = this.viewport.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const DRAG_THRESHOLD = 5; // 移动超过 5px 才开始拖动
            
            const onMouseMove = (moveE) => {
                const dx = Math.abs(moveE.clientX - startX);
                const dy = Math.abs(moveE.clientY - startY);
                if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                    // 超过阈值，开始拖动
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    const mousePos = {
                        x: ((startX - rect.left) / rect.width) * 100,
                        y: ((startY - rect.top) / rect.height) * 100,
                    };
                    this.transform.start(TransformController.HANDLE.MOVE, mousePos);
                }
            };
            
            const onMouseUp = () => {
                // 没有移动足够距离，不触发拖动
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
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
        console.log('[SlideEditor] dblclick 事件触发:', e.target.tagName, e.target.className);
        
        // 非编辑模式下不处理
        if (!this.enabled) {
            console.log('[SlideEditor] 编辑模式未启用');
            return;
        }
        
        // 优先检查是否在组编辑模式下双击子元素
        if (this.editingGroupId) {
            const childDom = e.target.closest('[data-child-id]');
            if (childDom) {
                const childId = childDom.dataset.childId;
                const parentId = childDom.dataset.childOf;
                
                // 确保是当前编辑组的子元素
                if (parentId === this.editingGroupId) {
                    const child = this.editingGroup?.children?.find(c => c.id === childId);
                    if (child) {
                        console.log('[SlideEditor] 组编辑模式: 双击子元素', childId);
                        this._triggerElementEdit(child, childDom, e.target);
                        return;
                    }
                }
            }
        }
        
        const elementDom = e.target.closest('[data-element-id]');
        if (elementDom) {
            const elementId = elementDom.dataset.elementId;
            // 递归查找元素（支持 group 子元素）
            const element = this.findElementById(elementId);
            if (element) {
                this.emit('element:dblclick', { element, dom: elementDom });
                this._triggerElementEdit(element, elementDom, e.target);
            }
        }
    }

    /**
     * 触发元素编辑（根据类型）
     */
    _triggerElementEdit(element, dom, target = null) {
        if (!element || !dom) return;
        
        // 根据元素类型处理
        if (element.type === 'text') {
            this._startTextEditing(element, dom, target || dom);
        } else if (element.type === 'table') {
            this._startTableCellEditing(element, dom, target || dom);
        } else if (element.type === 'svg') {
            this._startSvgTextEditing(element, dom, target || dom);
        } else if (element.type === 'card') {
            this._startCardTextEditing(element, dom, target || dom);
        } else if (element.type === 'formula') {
            this._startFormulaEditing(element, dom);
        } else if (element.type === 'chart') {
            this._startChartEditing(element, dom);
        } else if (element.type === 'group') {
            // 双击 group 进入组编辑模式
            this.enterGroupEditMode(element.id);
        } else if (element.type === 'list') {
            // 列表编辑 - 在属性面板中编辑
            this.selection.select(element.id);
        }
        // shape, image 等类型没有特殊的双击编辑行为，在属性面板中编辑
    }

    _startTextEditing(element, dom, target) {
        console.log('[SlideEditor] 开始编辑文本:', element.id);
        
        // 让目标元素可编辑
        // 隐藏选择框
        this._hideSelectionDuringEdit();
        
        dom.contentEditable = 'true';
        dom.focus();
        
        // 选中所有文本
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(dom);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // 失焦时保存
        const saveAndExit = () => {
            dom.contentEditable = 'false';
            const newContent = dom.innerHTML;
            if (newContent !== element.content) {
                this.updateElement(element.id, { content: newContent });
            }
            dom.removeEventListener('blur', saveAndExit);
            dom.removeEventListener('keydown', handleKeyDown);
            // 恢复选择框
            this._showSelectionAfterEdit();
        };
        
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                dom.innerHTML = element.content; // 还原
                dom.blur();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                dom.blur();
            }
        };
        
        dom.addEventListener('blur', saveAndExit);
        dom.addEventListener('keydown', handleKeyDown);
        
        this.emit('text:edit', { element, dom });
    }

    _startTableCellEditing(element, dom, target) {
        // 找到点击的单元格
        const cell = target.closest('td, th');
        if (!cell) return;
        
        console.log('[SlideEditor] 开始编辑表格单元格:', element.id);
        
        // 隐藏选择框
        this._hideSelectionDuringEdit();
        
        cell.contentEditable = 'true';
        cell.focus();
        
        // 选中单元格内容
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(cell);
        selection.removeAllRanges();
        selection.addRange(range);
        
        const saveAndExit = () => {
            cell.contentEditable = 'false';
            // 更新整个表格的 HTML
            const table = dom.querySelector('table');
            if (table) {
                this.updateElement(element.id, { content: table.outerHTML });
            }
            cell.removeEventListener('blur', saveAndExit);
            cell.removeEventListener('keydown', handleKeyDown);
            // 恢复选择框
            this._showSelectionAfterEdit();
        };
        
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                cell.blur();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                cell.blur();
                // 移到下一个单元格
                const nextCell = cell.nextElementSibling || 
                    cell.parentElement.nextElementSibling?.firstElementChild;
                if (nextCell) {
                    this._startTableCellEditing(element, dom, nextCell);
                }
            } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                cell.blur();
            }
        };
        
        cell.addEventListener('blur', saveAndExit);
        cell.addEventListener('keydown', handleKeyDown);
    }

    _startSvgTextEditing(element, dom, target) {
        // 找到点击的 text 或 tspan
        const textEl = target.closest('text, tspan');
        if (!textEl) return;
        
        console.log('[SlideEditor] 开始编辑 SVG 文本:', element.id);
        
        // SVG text 不支持 contentEditable，使用 input 覆盖
        const rect = textEl.getBoundingClientRect();
        const containerRect = this.viewport.getBoundingClientRect();
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = textEl.textContent;
        input.style.cssText = `
            position: absolute;
            left: ${rect.left - containerRect.left}px;
            top: ${rect.top - containerRect.top}px;
            width: ${Math.max(rect.width + 20, 60)}px;
            height: ${rect.height + 4}px;
            font-size: ${window.getComputedStyle(textEl).fontSize || '14px'};
            font-family: ${window.getComputedStyle(textEl).fontFamily || 'inherit'};
            border: 2px solid #3b82f6;
            border-radius: 4px;
            padding: 0 4px;
            background: white;
            z-index: 10000;
            outline: none;
        `;
        
        this.viewport.appendChild(input);
        input.focus();
        input.select();
        
        const saveAndExit = () => {
            const newText = input.value;
            if (newText !== textEl.textContent) {
                textEl.textContent = newText;
                // 更新整个 SVG 的内容
                const svg = dom.querySelector('svg');
                if (svg) {
                    this.updateElement(element.id, { content: svg.outerHTML });
                }
            }
            input.remove();
        };
        
        input.addEventListener('blur', saveAndExit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                input.value = textEl.textContent; // 还原
                input.blur();
            } else if (e.key === 'Enter') {
                input.blur();
            }
        });
    }

    _startCardTextEditing(element, dom, target) {
        // 找到包含文本的最近块元素
        let textBlock = target;
        
        // 如果点击的是空白区域，不处理
        if (!textBlock.textContent?.trim()) return;
        
        // 向上查找合适的可编辑块（避免编辑整个卡片）
        while (textBlock && textBlock !== dom) {
            const display = window.getComputedStyle(textBlock).display;
            if (display === 'block' || display === 'flex' || 
                textBlock.tagName === 'P' || textBlock.tagName === 'SPAN' ||
                textBlock.tagName === 'H1' || textBlock.tagName === 'H2' ||
                textBlock.tagName === 'H3' || textBlock.tagName === 'H4' ||
                textBlock.tagName === 'DIV') {
                // 检查是不是文本容器（有文本内容但没有太多子元素）
                if (textBlock.childElementCount <= 2) {
                    break;
                }
            }
            textBlock = textBlock.parentElement;
        }
        
        if (!textBlock || textBlock === dom) {
            textBlock = target;
        }
        
        console.log('[SlideEditor] 开始编辑卡片文本:', element.id, textBlock.tagName);
        
        // 判断是标题还是副标题（根据字体大小或位置）
        const fontSize = parseInt(window.getComputedStyle(textBlock).fontSize);
        const isTitle = fontSize >= 14 || textBlock.style.fontWeight === '600' || 
                        textBlock.previousElementSibling === null;
        
        // 隐藏选择框
        this._hideSelectionDuringEdit();
        
        const originalText = textBlock.textContent;
        textBlock.contentEditable = 'true';
        textBlock.focus();
        
        // 选中所有文本
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textBlock);
        selection.removeAllRanges();
        selection.addRange(range);
        
        const saveAndExit = () => {
            textBlock.contentEditable = 'false';
            const newText = textBlock.textContent;
            if (newText !== originalText) {
                // 根据位置更新 title 或 subtitle
                if (isTitle) {
                    this.updateElement(element.id, { title: newText });
                } else {
                    this.updateElement(element.id, { subtitle: newText });
                }
            }
            textBlock.removeEventListener('blur', saveAndExit);
            textBlock.removeEventListener('keydown', handleKeyDown);
            // 恢复选择框
            this._showSelectionAfterEdit();
        };
        
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                textBlock.textContent = originalText;
                textBlock.blur();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                textBlock.blur();
            }
        };
        
        textBlock.addEventListener('blur', saveAndExit);
        textBlock.addEventListener('keydown', handleKeyDown);
    }

    _startFormulaEditing(element, dom) {
        console.log('[SlideEditor] 开始编辑公式:', element.id);
        
        // 隐藏选择框
        this._hideSelectionDuringEdit();
        
        const rect = dom.getBoundingClientRect();
        const containerRect = this.viewport.getBoundingClientRect();
        
        // 创建编辑弹窗
        const overlay = document.createElement('div');
        overlay.className = 'formula-edit-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 20px;
            min-width: 400px;
            max-width: 600px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        `;
        
        const title = document.createElement('div');
        title.textContent = '编辑 LaTeX 公式';
        title.style.cssText = 'font-weight: 600; font-size: 16px; margin-bottom: 12px;';
        
        const textarea = document.createElement('textarea');
        textarea.value = element.latex || element.content || '';
        textarea.style.cssText = `
            width: 100%;
            height: 120px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 14px;
            padding: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            resize: vertical;
            outline: none;
            box-sizing: border-box;
        `;
        textarea.placeholder = '输入 LaTeX 公式，如: E = mc^2';
        
        // 预览区
        const preview = document.createElement('div');
        preview.style.cssText = `
            margin-top: 12px;
            padding: 16px;
            background: #f9fafb;
            border-radius: 8px;
            min-height: 40px;
            text-align: center;
        `;
        
        // 实时预览
        const updatePreview = () => {
            try {
                if (window.katex) {
                    preview.innerHTML = '';
                    katex.render(textarea.value, preview, { 
                        throwOnError: false,
                        displayMode: true 
                    });
                } else {
                    preview.textContent = textarea.value;
                }
            } catch (e) {
                preview.innerHTML = `<span style="color:#ef4444">公式错误: ${e.message}</span>`;
            }
        };
        textarea.addEventListener('input', updatePreview);
        updatePreview();
        
        // 按钮区
        const buttons = document.createElement('div');
        buttons.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            background: white;
            cursor: pointer;
        `;
        
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = `
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            background: #3b82f6;
            color: white;
            cursor: pointer;
        `;
        
        const close = () => {
            overlay.remove();
            this._showSelectionAfterEdit();
        };
        
        cancelBtn.onclick = close;
        saveBtn.onclick = () => {
            const newLatex = textarea.value;
            if (newLatex !== (element.latex || element.content)) {
                this.updateElement(element.id, { 
                    latex: newLatex,
                    content: newLatex 
                });
                // 重新渲染公式
                if (window.katex && dom) {
                    try {
                        dom.innerHTML = '';
                        katex.render(newLatex, dom, { 
                            throwOnError: false,
                            displayMode: element.displayMode !== false
                        });
                    } catch (e) {
                        dom.textContent = newLatex;
                    }
                }
            }
            close();
        };
        
        // Esc 关闭
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                saveBtn.click();
            }
        });
        
        buttons.appendChild(cancelBtn);
        buttons.appendChild(saveBtn);
        
        dialog.appendChild(title);
        dialog.appendChild(textarea);
        dialog.appendChild(preview);
        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        textarea.focus();
        textarea.select();
    }

    /**
     * 图表数据编辑弹窗
     */
    _startChartEditing(element, dom) {
        console.log('[SlideEditor] 开始编辑图表:', element.id);
        
        this._hideSelectionDuringEdit();
        
        // 解析当前数据
        const chartData = element.chartData || '';
        const dataItems = chartData.split(',').map(item => {
            const [label, value] = item.split(':');
            return { label: label?.trim() || '', value: value?.trim() || '' };
        }).filter(item => item.label || item.value);
        
        // 创建编辑弹窗
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 24px;
            width: 480px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 20px 40px rgba(0,0,0,0.2);
        `;
        
        const title = document.createElement('h3');
        title.textContent = '编辑图表数据';
        title.style.cssText = 'margin: 0 0 16px 0; font-size: 18px; color: #1e293b;';
        
        const typeRow = document.createElement('div');
        typeRow.style.cssText = 'margin-bottom: 16px;';
        typeRow.innerHTML = `
            <label style="font-size: 14px; color: #64748b; margin-bottom: 4px; display: block;">图表类型</label>
            <select id="chartTypeSelect" style="width: 100%; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px;">
                <option value="bar" ${element.chartType === 'bar' ? 'selected' : ''}>柱状图</option>
                <option value="line" ${element.chartType === 'line' ? 'selected' : ''}>折线图</option>
                <option value="pie" ${element.chartType === 'pie' ? 'selected' : ''}>饼图</option>
                <option value="doughnut" ${element.chartType === 'doughnut' ? 'selected' : ''}>环形图</option>
            </select>
        `;
        
        const dataContainer = document.createElement('div');
        dataContainer.style.cssText = 'margin-bottom: 16px;';
        
        const dataLabel = document.createElement('label');
        dataLabel.textContent = '数据项（标签:数值）';
        dataLabel.style.cssText = 'font-size: 14px; color: #64748b; margin-bottom: 8px; display: block;';
        
        const dataList = document.createElement('div');
        dataList.id = 'chartDataList';
        dataList.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
        
        // 渲染数据行
        const renderDataRows = (items) => {
            dataList.innerHTML = '';
            items.forEach((item, i) => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; gap: 8px; align-items: center;';
                row.innerHTML = `
                    <input type="text" placeholder="标签" value="${item.label}" style="flex: 1; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px;" data-field="label" data-index="${i}">
                    <input type="number" placeholder="数值" value="${item.value}" style="width: 100px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px;" data-field="value" data-index="${i}">
                    <button style="padding: 6px 10px; border: none; background: #fee2e2; color: #dc2626; border-radius: 6px; cursor: pointer;" data-delete="${i}">✕</button>
                `;
                dataList.appendChild(row);
            });
        };
        
        let currentItems = dataItems.length ? dataItems : [{ label: '', value: '' }];
        renderDataRows(currentItems);
        
        // 添加新行按钮
        const addBtn = document.createElement('button');
        addBtn.textContent = '+ 添加数据';
        addBtn.style.cssText = `
            margin-top: 8px;
            padding: 8px 16px;
            border: 1px dashed #e2e8f0;
            background: transparent;
            border-radius: 6px;
            cursor: pointer;
            color: #64748b;
            width: 100%;
        `;
        addBtn.onclick = () => {
            currentItems.push({ label: '', value: '' });
            renderDataRows(currentItems);
        };
        
        // 事件委托处理输入和删除
        dataList.addEventListener('input', (e) => {
            const input = e.target;
            const index = parseInt(input.dataset.index);
            const field = input.dataset.field;
            if (!isNaN(index) && field) {
                currentItems[index][field] = input.value;
            }
        });
        
        dataList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-delete]');
            if (btn) {
                const index = parseInt(btn.dataset.delete);
                currentItems.splice(index, 1);
                if (currentItems.length === 0) currentItems.push({ label: '', value: '' });
                renderDataRows(currentItems);
            }
        });
        
        dataContainer.appendChild(dataLabel);
        dataContainer.appendChild(dataList);
        dataContainer.appendChild(addBtn);
        
        // 按钮
        const buttons = document.createElement('div');
        buttons.style.cssText = 'display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = `
            padding: 8px 16px;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            background: white;
            cursor: pointer;
        `;
        
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = `
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            background: #3b82f6;
            color: white;
            cursor: pointer;
        `;
        
        const close = () => {
            overlay.remove();
            this._showSelectionAfterEdit();
        };
        
        cancelBtn.onclick = close;
        saveBtn.onclick = () => {
            // 构建 chartData 字符串
            const newChartData = currentItems
                .filter(item => item.label && item.value)
                .map(item => `${item.label}:${item.value}`)
                .join(',');
            
            const newChartType = dialog.querySelector('#chartTypeSelect').value;
            
            // 保存更新
            this.updateElement(element.id, { 
                chartData: newChartData,
                chartType: newChartType
            });
            
            close();
        };
        
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                saveBtn.click();
            }
        });
        
        buttons.appendChild(cancelBtn);
        buttons.appendChild(saveBtn);
        
        dialog.appendChild(title);
        dialog.appendChild(typeRow);
        dialog.appendChild(dataContainer);
        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    // ═══════════════════════════════════════════════════════════════
    // 辅助方法
    // ═══════════════════════════════════════════════════════════════

    _hideSelectionDuringEdit() {
        // 编辑时隐藏选择框
        if (this.overlayContainer) {
            this.overlayContainer.style.display = 'none';
        }
    }
    
    _showSelectionAfterEdit() {
        // 编辑结束后恢复选择框
        if (this.overlayContainer) {
            this.overlayContainer.style.display = '';
        }
        // 重绘选择框
        this._updateOverlay();
    }

    _createOverlayContainer() {
        // 移除旧的覆盖层
        const oldOverlay = document.querySelector('.editor-overlay');
        if (oldOverlay) {
            oldOverlay.remove();
        }
        
        this.overlayContainer = document.createElement('div');
        this.overlayContainer.className = 'editor-overlay';
        this.overlayContainer.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
            overflow: visible;
        `;

        // 直接添加到 viewport (presSlideCanvas)
        // 不添加到内部容器，避免被 overflow: hidden 裁剪
        if (this.viewport) {
            this.viewport.style.position = 'relative';
            this.viewport.appendChild(this.overlayContainer);
        }
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
