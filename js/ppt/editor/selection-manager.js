/**
 * 选择管理器
 * 管理元素选择状态
 */
class SelectionManager extends EventEmitter {
    constructor(editor) {
        super();
        this.editor = editor;
        this.selected = new Set();
        this.hovered = null;
    }

    /**
     * 选择元素
     * @param {string} elementId - 元素 ID
     * @param {boolean} additive - 是否添加到现有选择（Ctrl+点击）
     */
    select(elementId, additive = false) {
        if (!additive) {
            this.selected.clear();
        }

        if (elementId) {
            this.selected.add(elementId);
        }

        this._emitChange();
    }

    /**
     * 选择多个元素
     */
    selectMultiple(elementIds) {
        this.selected = new Set(elementIds);
        this._emitChange();
    }

    /**
     * 全选当前幻灯片元素
     */
    selectAll() {
        const slideIndex = this.editor.currentSlideIndex;
        const elements = this.editor.document?.getElements(slideIndex) || [];
        this.selected = new Set(elements.map(el => el.id));
        this._emitChange();
    }

    /**
     * 取消选择
     */
    deselect(elementId) {
        this.selected.delete(elementId);
        this._emitChange();
    }

    /**
     * 取消全部选择
     */
    deselectAll() {
        if (this.selected.size === 0) return;
        this.selected.clear();
        this._emitChange();
    }

    /**
     * 切换选择状态
     */
    toggle(elementId) {
        if (this.selected.has(elementId)) {
            this.selected.delete(elementId);
        } else {
            this.selected.add(elementId);
        }
        this._emitChange();
    }

    /**
     * 框选
     */
    selectByRect(rect) {
        const slideIndex = this.editor.currentSlideIndex;
        const elements = this.editor.document?.getElementsInRect(slideIndex, rect) || [];
        this.selectMultiple(elements.map(el => el.id));
    }

    /**
     * 获取选中的元素
     */
    getSelection() {
        const doc = this.editor.document;
        if (!doc) return [];
        return [...this.selected]
            .map(id => doc.getElementById(id))
            .filter(Boolean);
    }

    /**
     * 获取选中的元素 ID
     */
    getSelectedIds() {
        return [...this.selected];
    }

    /**
     * 获取选中数量
     */
    getCount() {
        return this.selected.size;
    }

    /**
     * 是否选中
     */
    isSelected(elementId) {
        return this.selected.has(elementId);
    }

    /**
     * 是否有选中
     */
    hasSelection() {
        return this.selected.size > 0;
    }

    /**
     * 获取选择边界框
     */
    getSelectionBounds() {
        const elements = this.getSelection();
        if (elements.length === 0) return null;

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const el of elements) {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + el.w);
            maxY = Math.max(maxY, el.y + el.h);
        }

        return {
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
        };
    }

    /**
     * 设置悬停元素
     */
    setHovered(elementId) {
        if (this.hovered === elementId) return;
        const previous = this.hovered;
        this.hovered = elementId;
        this.emit('hover', { elementId, previous });
    }

    /**
     * 清除悬停
     */
    clearHovered() {
        this.setHovered(null);
    }

    _emitChange() {
        this.emit('change', {
            selected: this.getSelectedIds(),
            elements: this.getSelection(),
            count: this.selected.size,
        });
    }

    /**
     * 清理（切换幻灯片时）
     */
    clear() {
        this.selected.clear();
        this.hovered = null;
        this._emitChange();
    }
}

window.SelectionManager = SelectionManager;
