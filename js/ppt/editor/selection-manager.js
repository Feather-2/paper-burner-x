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
     * 获取选中的元素（只返回当前页面的）
     */
    getSelection() {
        const doc = this.editor.document;
        if (!doc) return [];
        
        const slideIndex = this.editor.currentSlideIndex;
        const currentElements = doc.getElements(slideIndex) || [];
        const currentIds = new Set(currentElements.map(el => el.id));
        
        // 只返回当前页面中存在的选中元素
        return [...this.selected]
            .filter(id => currentIds.has(id))
            .map(id => currentElements.find(el => el.id === id))
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

        // 解析数值（可能是字符串如 "10%"）
        const parseNum = (val, def = 0) => {
            if (val === undefined || val === null) return def;
            const num = typeof val === 'string' ? parseFloat(val) : val;
            return isNaN(num) ? def : num;
        };

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const el of elements) {
            let x, y, w, h;
            
            // Line 元素使用 x1,y1,x2,y2
            if (el.type === 'line') {
                const x1 = parseNum(el.x1, 0);
                const y1 = parseNum(el.y1, 0);
                const x2 = parseNum(el.x2, 0);
                const y2 = parseNum(el.y2, 0);
                x = Math.min(x1, x2);
                y = Math.min(y1, y2);
                w = Math.abs(x2 - x1) || 2;
                h = Math.abs(y2 - y1) || 2;
            } else {
                x = parseNum(el.x, 0);
                y = parseNum(el.y, 0);
                w = parseNum(el.w, 10);
                h = parseNum(el.h, 10);
            }
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
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
