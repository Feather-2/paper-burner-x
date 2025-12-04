/**
 * 图层面板
 * 显示当前幻灯片的所有元素层级
 */
class LayerPanel extends EventEmitter {
    constructor(editor, containerId) {
        super();
        this.editor = editor;
        this.container = document.getElementById(containerId);
        this.dragState = null;

        if (!this.container) {
            console.warn('[LayerPanel] 容器不存在:', containerId);
            return;
        }

        // 监听文档变化
        this.editor.document.on('element.add', () => this.refresh());
        this.editor.document.on('element.remove', () => this.refresh());
        this.editor.document.on('element.update', () => this.refresh());
        this.editor.document.on('element.reorder', () => this.refresh());

        // 监听选择变化
        this.editor.selection.on('change', () => this._updateSelection());

        // 监听幻灯片切换
        this.editor.on('slide:change', () => this.refresh());
    }

    /**
     * 刷新面板
     */
    refresh() {
        if (!this.container) return;

        // 优先使用 PPTGenerator.slides 数据（与渲染一致）
        const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
        const elements = slide?.elements || [];
        
        if (elements.length === 0) {
            this.container.innerHTML = `
                <div class="layer-panel-empty">
                    <p style="color: #9ca3af; text-align: center; padding: 20px; font-size: 12px;">
                        当前幻灯片没有元素<br>
                        <small>点击工具栏添加元素</small>
                    </p>
                </div>
            `;
            return;
        }

        // 按 z-index 倒序排列（最上层在最前）
        const sortedElements = [...elements].sort((a, b) => (b.z || 0) - (a.z || 0));

        // 检测烘焙组
        const bakingGroups = this._detectBakingGroups(sortedElements);

        this.container.innerHTML = `
            <div class="layer-panel-header">
                <span>图层</span>
                <span class="layer-count">${elements.length}</span>
            </div>
            <div class="layer-list">
                ${this._renderLayers(sortedElements, bakingGroups)}
            </div>
        `;

        this._bindEvents();
        this._updateSelection();
    }

    _renderLayers(elements, bakingGroups) {
        let html = '';
        let currentGroup = null;

        for (const el of elements) {
            const group = bakingGroups.get(el.id);

            // 开始新的烘焙组
            if (group && group !== currentGroup) {
                if (currentGroup) {
                    html += '</div></div>'; // 关闭上一个组
                }
                currentGroup = group;
                const reasonIcon = this._getBakingReasonIcon(group.reason);
                html += `
                    <div class="layer-group" data-group="${group.id}">
                        <div class="layer-group-header" data-action="toggle-group">
                            <iconify-icon icon="mdi:chevron-down" class="group-chevron"></iconify-icon>
                            <iconify-icon icon="${reasonIcon}" class="group-reason-icon"></iconify-icon>
                            <span class="group-title">烘焙组 (${group.reason})</span>
                            <div class="group-actions">
                                <button class="layer-btn" data-action="select-group" title="全选组内元素">
                                    <iconify-icon icon="mdi:select-all"></iconify-icon>
                                </button>
                                <button class="layer-btn" data-action="toggle-group-visible" title="显示/隐藏整组">
                                    <iconify-icon icon="mdi:eye"></iconify-icon>
                                </button>
                            </div>
                        </div>
                        <div class="layer-group-content">
                `;
            }

            // 如果不在组中但之前有组
            if (!group && currentGroup) {
                html += '</div></div>';
                currentGroup = null;
            }

            html += this._renderLayerItem(el);
        }

        // 关闭最后一个组
        if (currentGroup) {
            html += '</div></div>';
        }

        return html;
    }

    _renderLayerItem(el) {
        const isSelected = this.editor.selection.isSelected(el.id);
        const icon = this._getElementIcon(el.type);
        const label = this._getElementLabel(el);
        const isLocked = el.locked;
        const isHidden = el.hidden;

        const classes = ['layer-item'];
        if (isSelected) classes.push('selected');
        if (isHidden) classes.push('hidden-layer');
        if (isLocked) classes.push('locked-layer');

        return `
            <div class="${classes.join(' ')}" 
                 data-element-id="${el.id}"
                 draggable="true">
                <div class="layer-drag-handle">
                    <iconify-icon icon="mdi:drag"></iconify-icon>
                </div>
                <div class="layer-icon">
                    <iconify-icon icon="${icon}"></iconify-icon>
                </div>
                <div class="layer-label" title="${label}">
                    ${label}
                </div>
                <div class="layer-actions">
                    <button class="layer-btn ${isLocked ? 'active' : ''}" 
                            data-action="toggle-lock" 
                            title="${isLocked ? '解锁' : '锁定'}">
                        <iconify-icon icon="${isLocked ? 'mdi:lock' : 'mdi:lock-open-outline'}"></iconify-icon>
                    </button>
                    <button class="layer-btn ${isHidden ? 'active visible-toggle' : ''}" 
                            data-action="toggle-visible" 
                            title="${isHidden ? '显示' : '隐藏'}">
                        <iconify-icon icon="${isHidden ? 'mdi:eye-off' : 'mdi:eye'}"></iconify-icon>
                    </button>
                </div>
                ${el.blend && el.blend !== 'normal' ? `<span class="layer-badge blend">${el.blend}</span>` : ''}
                ${el.filter ? '<span class="layer-badge filter">滤镜</span>' : ''}
                ${el.opacity !== undefined && el.opacity < 1 ? `<span class="layer-badge opacity">${Math.round(el.opacity * 100)}%</span>` : ''}
            </div>
        `;
    }

    _getElementIcon(type) {
        const icons = {
            text: 'mdi:format-text',
            image: 'mdi:image',
            shape: 'mdi:shape',
            icon: 'mdi:emoticon',
            svg: 'mdi:svg',
            chart: 'mdi:chart-bar',
            formula: 'mdi:function-variant',
            table: 'mdi:table',
        };
        return icons[type] || 'mdi:help-circle';
    }

    _getElementLabel(el) {
        switch (el.type) {
            case 'text':
                // 提取纯文本
                const text = (el.content || '').replace(/<[^>]*>/g, '').slice(0, 20);
                return text || '文本';
            case 'image':
                return el.assetId ? `图片` : '图片';
            case 'shape':
                const shapes = { rect: '矩形', roundRect: '圆角矩形', ellipse: '椭圆', triangle: '三角形' };
                return shapes[el.shapeType] || '形状';
            case 'chart':
                const charts = { bar: '柱状图', line: '折线图', pie: '饼图', doughnut: '环形图' };
                return el.title || charts[el.chartType] || '图表';
            case 'formula':
                return el.latex?.slice(0, 15) || '公式';
            case 'icon':
                return el.icon || '图标';
            case 'svg':
                return 'SVG';
            default:
                return el.type;
        }
    }

    /**
     * 检测需要烘焙的元素组
     */
    _detectBakingGroups(elements) {
        const groups = new Map();
        let currentGroup = null;

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const needsBaking = this._elementNeedsBaking(el);

            if (needsBaking) {
                if (!currentGroup) {
                    currentGroup = {
                        id: 'group_' + i,
                        reason: this._getBakingReason(el),
                        elements: [],
                    };
                }
                currentGroup.elements.push(el.id);
                groups.set(el.id, currentGroup);
            } else if (currentGroup && currentGroup.elements.length > 0) {
                // 检查是否需要将普通元素作为背景包含进来
                const hasOverlap = this._hasOverlapWithGroup(el, currentGroup, elements);
                if (hasOverlap) {
                    groups.set(el.id, currentGroup);
                    currentGroup.elements.push(el.id);
                } else {
                    currentGroup = null;
                }
            }
        }

        return groups;
    }

    _elementNeedsBaking(el) {
        if (el.blend && el.blend !== 'normal') return true;
        if (el.filter && el.filter.includes('blur')) return true;
        if (el.mask) return true;
        return false;
    }

    _getBakingReason(el) {
        if (el.blend && el.blend !== 'normal') return `blend: ${el.blend}`;
        if (el.filter && el.filter.includes('blur')) return '模糊';
        if (el.mask) return '遮罩';
        return '特效';
    }

    _getBakingReasonIcon(reason) {
        if (reason.includes('blur') || reason === '模糊') return 'mdi:blur';
        if (reason.includes('blend')) return 'mdi:layers-outline';
        if (reason === '遮罩') return 'mdi:crop';
        return 'mdi:auto-fix';
    }

    _hasOverlapWithGroup(el, group, allElements) {
        // 简化：检查 z-index 是否在组范围内
        return false;
    }

    _bindEvents() {
        if (!this.container) return;

        // 点击选择
        this.container.querySelectorAll('.layer-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.layer-btn')) return;

                const elementId = item.dataset.elementId;
                if (e.ctrlKey || e.metaKey) {
                    this.editor.selection.toggle(elementId);
                } else {
                    this.editor.selection.select(elementId);
                }
            });

            // 双击定位到元素
            item.addEventListener('dblclick', () => {
                const elementId = item.dataset.elementId;
                this.editor.selection.select(elementId);
                // TODO: 滚动到元素
            });
        });

        // 操作按钮
        this.container.querySelectorAll('.layer-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const item = btn.closest('.layer-item');
                const elementId = item.dataset.elementId;

                if (action === 'toggle-lock') {
                    const el = this.editor.document.getElementById(elementId);
                    this.editor.updateElement(elementId, { locked: !el.locked });
                } else if (action === 'toggle-visible') {
                    // 从 slides 获取元素（确保数据一致）
                    const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
                    const slideEl = slide?.elements?.find(e => e.id === elementId);
                    if (!slideEl) return;
                    
                    const newHidden = !slideEl.hidden;
                    slideEl.hidden = newHidden;
                    
                    // 同步到 document
                    this.editor.updateElement(elementId, { hidden: newHidden });
                    
                    // 刷新图层面板
                    this.refresh();
                }
            });
        });

        // 烘焙组事件
        this._bindGroupEvents();

        // 拖拽排序
        this._bindDragEvents();
    }

    _bindGroupEvents() {
        // 折叠/展开组
        this.container.querySelectorAll('.layer-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // 如果点击的是操作按钮，不折叠
                if (e.target.closest('.group-actions')) return;
                
                const group = header.closest('.layer-group');
                group.classList.toggle('collapsed');
            });
        });

        // 全选组内元素
        this.container.querySelectorAll('[data-action="select-group"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const group = btn.closest('.layer-group');
                const elementIds = Array.from(group.querySelectorAll('.layer-item'))
                    .map(item => item.dataset.elementId);
                this.editor.selection.selectMultiple(elementIds);
            });
        });

        // 整组可见性切换
        this.container.querySelectorAll('[data-action="toggle-group-visible"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const group = btn.closest('.layer-group');
                const elementIds = Array.from(group.querySelectorAll('.layer-item'))
                    .map(item => item.dataset.elementId);
                
                const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
                if (!slide) return;

                // 检查是否全部隐藏
                const allHidden = elementIds.every(id => {
                    const el = slide.elements?.find(e => e.id === id);
                    return el?.hidden;
                });

                // 切换：全部隐藏则全部显示，否则全部隐藏
                const newHidden = !allHidden;
                elementIds.forEach(id => {
                    const el = slide.elements?.find(e => e.id === id);
                    if (el) {
                        el.hidden = newHidden;
                        this.editor.updateElement(id, { hidden: newHidden });
                    }
                });

                // 更新按钮图标
                const icon = btn.querySelector('iconify-icon');
                if (icon) {
                    icon.setAttribute('icon', newHidden ? 'mdi:eye-off' : 'mdi:eye');
                }
                
                this.refresh();
            });
        });
    }

    _bindDragEvents() {
        const items = this.container.querySelectorAll('.layer-item');

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                this.dragState = {
                    elementId: item.dataset.elementId,
                    startIndex: [...items].indexOf(item),
                };
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.dragState = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                if (!this.dragState) return;
                if (item.dataset.elementId === this.dragState.elementId) return;

                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;

                item.classList.remove('drag-above', 'drag-below');
                if (e.clientY < midY) {
                    item.classList.add('drag-above');
                } else {
                    item.classList.add('drag-below');
                }
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drag-above', 'drag-below');
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('drag-above', 'drag-below');

                if (!this.dragState) return;

                const targetId = item.dataset.elementId;
                const sourceId = this.dragState.elementId;

                if (sourceId === targetId) return;

                // 获取目标元素的 z-index，设置源元素
                const targetEl = this.editor.document.getElementById(targetId);
                const rect = item.getBoundingClientRect();
                const above = e.clientY < rect.top + rect.height / 2;

                // 计算新的 z-index
                const newZ = above ? (targetEl.z || 0) + 1 : (targetEl.z || 0) - 1;
                this.editor.updateElement(sourceId, { z: newZ });
            });
        });
    }

    _updateSelection() {
        if (!this.container) return;

        this.container.querySelectorAll('.layer-item').forEach(item => {
            const elementId = item.dataset.elementId;
            item.classList.toggle('selected', this.editor.selection.isSelected(elementId));
        });
    }
}

window.LayerPanel = LayerPanel;
