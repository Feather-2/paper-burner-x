/**
 * LayerEditor 图层列表模块
 * 从 layer-editor.js 拆分出的图层列表方法
 */

/**
 * 图层列表 mixin
 */
export const LayerListMixin = {
    /**
     * 更新图层列表
     */
    _updateLayerList() {
        const listEl = this.container.querySelector('.layer-list');
        if (!listEl) return;
        
        const layers = this.processedImage?.layers || [];
        
        if (layers.length === 0) {
            listEl.innerHTML = '<div class="empty-state">暂无图层</div>';
            return;
        }
        
        // 从顶层到底层显示（倒序）
        let html = '';
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            html += this._renderLayerItem(layer, i);
        }
        
        listEl.innerHTML = html;
        
        // 绑定事件
        this._bindLayerListEvents(listEl);
    },

    /**
     * 渲染单个图层项
     */
    _renderLayerItem(layer, index) {
        const isSelected = index === this.selectedLayerIndex && this.selectedChildIndex === -1;
        const isExpanded = layer.expanded !== false;
        
        let preview = '';
        if (layer.type === 'original' && layer.image) {
            preview = `<img src="${layer.image.src}" alt="">`;
        } else if (layer.type === 'vector' && layer.color) {
            preview = `<div class="color-preview" style="background:${layer.color};width:100%;height:100%;"></div>`;
        } else if (layer.type === 'group') {
            let icon = 'carbon:folder';
            if (layer.ocrGroup || layer.textOverlayConfig) {
                icon = 'carbon:text-recognition';
            } else if (layer.samGroup) {
                icon = 'carbon:cut-out';
            }
            preview = `<iconify-icon icon="${icon}"></iconify-icon>`;
        } else {
            preview = `<iconify-icon icon="carbon:image"></iconify-icon>`;
        }
        
        let childrenHtml = '';
        if (layer.type === 'group' && layer.children && layer.children.length > 0) {
            childrenHtml = `
                <div class="child-layer-container" style="display:${isExpanded ? 'block' : 'none'};">
                    ${layer.children.map((child, childIdx) => 
                        this._renderChildLayerItem(child, index, childIdx, layer)
                    ).join('')}
                </div>
            `;
        }
        
        const expandIcon = layer.type === 'group' && layer.children?.length > 0
            ? `<button class="layer-action-btn expand-btn" data-layer="${index}">
                <iconify-icon icon="${isExpanded ? 'carbon:chevron-down' : 'carbon:chevron-right'}"></iconify-icon>
               </button>`
            : '';
        
        return `
            <div class="layer-item ${isSelected ? 'selected' : ''}" data-layer="${index}">
                ${expandIcon}
                <div class="layer-preview">${preview}</div>
                <span class="layer-name">${layer.name || '图层 ' + (index + 1)}</span>
                <button class="layer-visibility" data-layer="${index}" title="${layer.visible !== false ? '隐藏' : '显示'}">
                    <iconify-icon icon="${layer.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                </button>
            </div>
            ${childrenHtml}
        `;
    },

    /**
     * 渲染子图层项
     */
    _renderChildLayerItem(child, parentIndex, childIndex, parentLayer) {
        // 使用 _isChildSelected 检查多选状态
        const isSelected = this._isChildSelected?.(parentIndex, childIndex) ||
            (parentIndex === this.selectedLayerIndex && childIndex === this.selectedChildIndex);
        
        let preview = '';
        if (child.type === 'vector' && child.color) {
            preview = `<div class="color-preview" style="background:${child.color};width:100%;height:100%;"></div>`;
        } else if (child.type === 'text-overlay') {
            preview = `<iconify-icon icon="carbon:text-font"></iconify-icon>`;
        } else if (child.type === 'subgroup') {
            preview = `<iconify-icon icon="carbon:folder"></iconify-icon>`;
        } else if (child.type === 'sam-layer') {
            preview = `<iconify-icon icon="${child.isForeground ? 'carbon:image-copy' : 'carbon:image'}"></iconify-icon>`;
        } else {
            preview = `<iconify-icon icon="carbon:shape"></iconify-icon>`;
        }
        
        // 子组展开/收起
        if (child.type === 'subgroup' && child.children?.length > 0) {
            const isExpanded = child.expanded !== false;
            return `
                <div class="layer-item child-layer ${isSelected ? 'selected' : ''}" 
                     data-parent="${parentIndex}" data-child="${childIndex}">
                    <button class="layer-action-btn expand-btn" data-parent="${parentIndex}" data-child="${childIndex}">
                        <iconify-icon icon="${isExpanded ? 'carbon:chevron-down' : 'carbon:chevron-right'}"></iconify-icon>
                    </button>
                    <div class="layer-preview">${preview}</div>
                    <span class="layer-name">${child.name || '子组'}</span>
                    <button class="layer-visibility child-vis" data-parent="${parentIndex}" data-child="${childIndex}">
                        <iconify-icon icon="${child.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                    </button>
                </div>
                <div class="subgroup-children" style="display:${isExpanded ? 'block' : 'none'};padding-left:16px;">
                    ${child.children.map((subChild, subIdx) => 
                        this._renderSubgroupChild(subChild, parentIndex, childIndex, subIdx)
                    ).join('')}
                </div>
            `;
        }
        
        return `
            <div class="layer-item child-layer ${isSelected ? 'selected' : ''}" 
                 data-parent="${parentIndex}" data-child="${childIndex}">
                <div class="layer-preview">${preview}</div>
                <span class="layer-name">${child.name || '子图层'}</span>
                <button class="layer-visibility child-vis" data-parent="${parentIndex}" data-child="${childIndex}">
                    <iconify-icon icon="${child.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                </button>
            </div>
        `;
    },

    /**
     * 渲染子组内的子元素
     */
    _renderSubgroupChild(child, parentIndex, subgroupIndex, childIndex) {
        let preview = '';
        if (child.color) {
            preview = `<div class="color-preview" style="background:${child.color};width:100%;height:100%;"></div>`;
        } else {
            preview = `<iconify-icon icon="carbon:shape"></iconify-icon>`;
        }
        
        return `
            <div class="layer-item child-layer subgroup-item" 
                 data-parent="${parentIndex}" data-subgroup="${subgroupIndex}" data-subchild="${childIndex}">
                <div class="layer-preview">${preview}</div>
                <span class="layer-name">${child.name || '路径'}</span>
                <button class="layer-visibility subgroup-vis" 
                        data-parent="${parentIndex}" data-subgroup="${subgroupIndex}" data-subchild="${childIndex}">
                    <iconify-icon icon="${child.visible !== false ? 'carbon:view' : 'carbon:view-off'}"></iconify-icon>
                </button>
            </div>
        `;
    },

    /**
     * 绑定图层列表事件
     */
    _bindLayerListEvents(listEl) {
        // 选择图层
        listEl.querySelectorAll('.layer-item:not(.child-layer)').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.layer-visibility, .expand-btn')) return;
                const index = parseInt(item.dataset.layer);
                this._selectLayer(index);
            });
        });
        
        // 选择子图层（支持 Ctrl+点击 多选）
        listEl.querySelectorAll('.layer-item.child-layer:not(.subgroup-item)').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.layer-visibility, .expand-btn')) return;
                const parentIndex = parseInt(item.dataset.parent);
                const childIndex = parseInt(item.dataset.child);
                const addToSelection = e.ctrlKey || e.metaKey; // Ctrl 或 Cmd
                this._selectChildLayer(parentIndex, childIndex, addToSelection);
            });
        });
        
        // 可见性切换
        listEl.querySelectorAll('.layer-visibility:not(.child-vis):not(.subgroup-vis)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.layer);
                const layer = this.processedImage.layers[index];
                if (layer) {
                    layer.visible = layer.visible === false ? true : false;
                    this._render();
                }
            });
        });
        
        // 子图层可见性
        listEl.querySelectorAll('.child-vis').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const parentIndex = parseInt(btn.dataset.parent);
                const childIndex = parseInt(btn.dataset.child);
                const parent = this.processedImage.layers[parentIndex];
                const child = parent?.children?.[childIndex];
                if (child) {
                    child.visible = child.visible === false ? true : false;
                    this._render();
                }
            });
        });
        
        // 子组内子元素可见性
        listEl.querySelectorAll('.subgroup-vis').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const parentIndex = parseInt(btn.dataset.parent);
                const subgroupIndex = parseInt(btn.dataset.subgroup);
                const subchildIndex = parseInt(btn.dataset.subchild);
                const parent = this.processedImage.layers[parentIndex];
                const subgroup = parent?.children?.[subgroupIndex];
                const child = subgroup?.children?.[subchildIndex];
                if (child) {
                    child.visible = child.visible === false ? true : false;
                    this._render();
                }
            });
        });
        
        // 展开/收起
        listEl.querySelectorAll('.expand-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                if (btn.dataset.layer !== undefined) {
                    // 顶层组
                    const index = parseInt(btn.dataset.layer);
                    const layer = this.processedImage.layers[index];
                    if (layer) {
                        layer.expanded = layer.expanded === false ? true : false;
                        this._updateLayerList();
                    }
                } else if (btn.dataset.parent !== undefined && btn.dataset.child !== undefined) {
                    // 子组
                    const parentIndex = parseInt(btn.dataset.parent);
                    const childIndex = parseInt(btn.dataset.child);
                    const parent = this.processedImage.layers[parentIndex];
                    const child = parent?.children?.[childIndex];
                    if (child) {
                        child.expanded = child.expanded === false ? true : false;
                        this._updateLayerList();
                    }
                }
            });
        });
    },

    /**
     * 选择图层
     */
    _selectLayer(index) {
        this.selectedLayerIndex = index;
        this.selectedChildIndex = -1;
        this._updateLayerList();
        this._updatePropertyPanel();
        this._render();
    },

    /**
     * 选择子图层（支持多选）
     * @param {number} parentIndex 
     * @param {number} childIndex 
     * @param {boolean} addToSelection - 是否添加到现有选择（Ctrl+点击）
     */
    _selectChildLayer(parentIndex, childIndex, addToSelection = false) {
        // 初始化多选数组
        if (!this.selectedChildIndices) {
            this.selectedChildIndices = [];
        }
        
        if (addToSelection && this.selectedLayerIndex === parentIndex) {
            // 多选模式：添加或移除
            const idx = this.selectedChildIndices.indexOf(childIndex);
            if (idx >= 0) {
                this.selectedChildIndices.splice(idx, 1);
                // 如果移除后还有选中项，更新 selectedChildIndex
                if (this.selectedChildIndices.length > 0) {
                    this.selectedChildIndex = this.selectedChildIndices[this.selectedChildIndices.length - 1];
                } else {
                    this.selectedChildIndex = -1;
                }
            } else {
                this.selectedChildIndices.push(childIndex);
                this.selectedChildIndex = childIndex;
            }
        } else {
            // 单选模式：清空多选，只选中一个
            this.selectedLayerIndex = parentIndex;
            this.selectedChildIndex = childIndex;
            this.selectedChildIndices = [childIndex];
        }
        
        this._updateLayerList();
        this._updatePropertyPanel();
        this._render();
    },
    
    /**
     * 检查子图层是否被选中
     */
    _isChildSelected(parentIndex, childIndex) {
        if (this.selectedLayerIndex !== parentIndex) return false;
        if (!this.selectedChildIndices || this.selectedChildIndices.length === 0) {
            return this.selectedChildIndex === childIndex;
        }
        return this.selectedChildIndices.includes(childIndex);
    },
    
    /**
     * 获取所有选中的子图层
     */
    _getSelectedChildren() {
        if (this.selectedLayerIndex < 0) return [];
        const layer = this.processedImage?.layers?.[this.selectedLayerIndex];
        if (!layer?.children) return [];
        
        const indices = this.selectedChildIndices?.length > 0 
            ? this.selectedChildIndices 
            : (this.selectedChildIndex >= 0 ? [this.selectedChildIndex] : []);
        
        return indices.map(i => layer.children[i]).filter(Boolean);
    },

    /**
     * 移动图层
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
        this._render();
    },

    /**
     * 移动子图层
     */
    _moveChildLayer(parentIndex, childIndex, direction) {
        const parent = this.processedImage.layers[parentIndex];
        if (!parent || !parent.children) return;
        
        const children = parent.children;
        const newIndex = childIndex + direction;
        
        if (newIndex < 0 || newIndex >= children.length) return;
        
        [children[childIndex], children[newIndex]] = [children[newIndex], children[childIndex]];
        
        if (this.selectedChildIndex === childIndex) {
            this.selectedChildIndex = newIndex;
        } else if (this.selectedChildIndex === newIndex) {
            this.selectedChildIndex = childIndex;
        }
        
        this._saveHistory();
        this._render();
    },

    /**
     * 删除图层
     */
    _deleteLayer(index) {
        const layers = this.processedImage.layers;
        
        // 不能删除原始图层
        if (layers[index]?.type === 'original') {
            this._showToast('不能删除原始图层');
            return;
        }
        
        if (!confirm('确定要删除这个图层吗？')) return;
        
        layers.splice(index, 1);
        
        // 调整选中索引
        if (this.selectedLayerIndex === index) {
            this.selectedLayerIndex = -1;
            this.selectedChildIndex = -1;
        } else if (this.selectedLayerIndex > index) {
            this.selectedLayerIndex--;
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
    },

    /**
     * 删除子图层
     */
    _deleteChildLayer(parentIndex, childIndex) {
        const parent = this.processedImage.layers[parentIndex];
        if (!parent || !parent.children) return;
        
        if (parent.children.length <= 1) {
            this._showToast('至少保留一个子图层');
            return;
        }
        
        if (!confirm('确定要删除这个子图层吗？')) return;
        
        parent.children.splice(childIndex, 1);
        
        // 更新组名称
        if (parent.ocrGroup) {
            parent.name = `文字识别 (${parent.children.length} 区域)`;
        }
        
        // 调整选中索引
        if (this.selectedChildIndex === childIndex) {
            this.selectedChildIndex = -1;
        } else if (this.selectedChildIndex > childIndex) {
            this.selectedChildIndex--;
        }
        
        this._saveHistory();
        this._render();
        this._updatePropertyPanel();
    }
};
