/**
 * 文档管理器
 * 管理 Slide[] 数据源，提供统一的数据访问和修改接口
 */
class SlideDocument extends EventEmitter {
    constructor() {
        super();
        this.slides = [];
        this._elementIndex = new Map(); // id -> { slideIndex, elementIndex }
    }

    /**
     * 加载幻灯片数据
     */
    load(slides) {
        this.slides = JSON.parse(JSON.stringify(slides || [])); // 深拷贝
        
        // 确保所有幻灯片和元素都有 ID
        this.slides.forEach(slide => {
            if (!slide.id) slide.id = this._generateId();
            if (slide.elements) {
                slide.elements.forEach(el => {
                    if (!el.id) el.id = this._generateId();
                });
            }
        });
        
        this._rebuildIndex();
        this.emit('load', { slides: this.slides });
    }

    /**
     * 获取所有幻灯片
     */
    getSlides() {
        return this.slides;
    }

    /**
     * 获取指定幻灯片
     */
    getSlide(index) {
        return this.slides[index] || null;
    }

    /**
     * 获取幻灯片数量
     */
    getSlideCount() {
        return this.slides.length;
    }

    // ═══════════════════════════════════════════════════════════════
    // 幻灯片操作
    // ═══════════════════════════════════════════════════════════════

    /**
     * 添加幻灯片
     */
    addSlide(slide, index = -1) {
        // 确保有 ID
        if (!slide.id) {
            slide.id = this._generateId();
        }

        // 确保元素有 ID
        if (slide.elements) {
            slide.elements.forEach(el => {
                if (!el.id) el.id = this._generateId();
            });
        }

        if (index < 0 || index >= this.slides.length) {
            this.slides.push(slide);
        } else {
            this.slides.splice(index, 0, slide);
        }

        this._rebuildIndex();
        this.emit('slide.add', { slide, index: index < 0 ? this.slides.length - 1 : index });
    }

    /**
     * 删除幻灯片
     */
    removeSlide(index) {
        if (index < 0 || index >= this.slides.length) return null;

        const [removed] = this.slides.splice(index, 1);
        this._rebuildIndex();
        this.emit('slide.remove', { slide: removed, index });
        return removed;
    }

    /**
     * 移动幻灯片
     */
    moveSlide(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.slides.length) return;
        if (toIndex < 0 || toIndex >= this.slides.length) return;
        if (fromIndex === toIndex) return;

        const [slide] = this.slides.splice(fromIndex, 1);
        this.slides.splice(toIndex, 0, slide);

        this._rebuildIndex();
        this.emit('slide.move', { fromIndex, toIndex });
    }

    /**
     * 更新幻灯片属性
     */
    updateSlide(index, updates) {
        const slide = this.slides[index];
        if (!slide) return;

        Object.assign(slide, updates);
        this.emit('slide.update', { slide, index, updates });
    }

    /**
     * 复制幻灯片
     */
    duplicateSlide(index) {
        const slide = this.slides[index];
        if (!slide) return null;

        const copy = JSON.parse(JSON.stringify(slide));
        copy.id = this._generateId();
        if (copy.elements) {
            copy.elements.forEach(el => {
                el.id = this._generateId();
            });
        }

        this.addSlide(copy, index + 1);
        return copy;
    }

    // ═══════════════════════════════════════════════════════════════
    // 元素操作
    // ═══════════════════════════════════════════════════════════════

    /**
     * 通过 ID 获取元素
     */
    getElementById(elementId) {
        // 直接遍历查找，避免索引不同步问题
        for (const slide of this.slides) {
            if (slide.elements) {
                const element = slide.elements.find(el => el.id === elementId);
                if (element) return element;
            }
        }
        return null;
    }

    /**
     * 获取元素位置
     */
    getElementLocation(elementId) {
        return this._elementIndex.get(elementId) || null;
    }

    /**
     * 获取幻灯片的所有元素
     */
    getElements(slideIndex) {
        return this.slides[slideIndex]?.elements || [];
    }

    /**
     * 添加元素
     */
    addElement(slideIndex, element, index = -1) {
        const slide = this.slides[slideIndex];
        if (!slide) return null;

        if (!slide.elements) slide.elements = [];

        // 确保有 ID
        if (!element.id) {
            element.id = this._generateId();
        }

        // 确保有 z-index
        if (element.z === undefined) {
            element.z = this._getMaxZ(slideIndex) + 1;
        }

        if (index < 0 || index >= slide.elements.length) {
            slide.elements.push(element);
        } else {
            slide.elements.splice(index, 0, element);
        }

        this._rebuildIndex();
        this.emit('element.add', { slideIndex, element, index: index < 0 ? slide.elements.length - 1 : index });
        return element;
    }

    /**
     * 删除元素
     */
    removeElement(slideIndex, elementId) {
        const slide = this.slides[slideIndex];
        if (!slide?.elements) return null;

        const index = slide.elements.findIndex(el => el.id === elementId);
        if (index < 0) return null;

        const [removed] = slide.elements.splice(index, 1);
        this._rebuildIndex();
        this.emit('element.remove', { slideIndex, element: removed, index });
        return removed;
    }

    /**
     * 更新元素
     */
    updateElement(elementId, updates) {
        const element = this.getElementById(elementId);
        if (!element) return null;

        const oldValues = {};
        for (const key of Object.keys(updates)) {
            oldValues[key] = element[key];
            element[key] = updates[key];
        }

        const location = this._elementIndex.get(elementId);
        this.emit('element.update', { element, updates, oldValues, ...location });
        return element;
    }

    /**
     * 批量更新元素
     */
    updateElements(updates) {
        const results = [];
        for (const { id, changes } of updates) {
            const result = this.updateElement(id, changes);
            if (result) results.push(result);
        }
        return results;
    }

    /**
     * 复制元素
     */
    duplicateElement(elementId, offset = { x: 2, y: 2 }) {
        const element = this.getElementById(elementId);
        if (!element) return null;

        const location = this._elementIndex.get(elementId);
        const copy = JSON.parse(JSON.stringify(element));
        copy.id = this._generateId();
        copy.x = (copy.x || 0) + offset.x;
        copy.y = (copy.y || 0) + offset.y;
        copy.z = this._getMaxZ(location.slideIndex) + 1;

        return this.addElement(location.slideIndex, copy);
    }

    /**
     * 批量复制元素
     */
    duplicateElements(elementIds, offset = { x: 2, y: 2 }) {
        return elementIds.map(id => this.duplicateElement(id, offset)).filter(Boolean);
    }

    /**
     * 移动元素到指定层级
     */
    reorderElement(elementId, newZIndex) {
        const element = this.getElementById(elementId);
        if (!element) return;

        const oldZ = element.z;
        element.z = newZIndex;

        const location = this._elementIndex.get(elementId);
        this.emit('element.reorder', { element, oldZ, newZ: newZIndex, ...location });
    }

    /**
     * 元素移到最前
     */
    bringToFront(elementId) {
        const location = this._elementIndex.get(elementId);
        if (!location) return;

        const maxZ = this._getMaxZ(location.slideIndex);
        this.reorderElement(elementId, maxZ + 1);
    }

    /**
     * 元素移到最后
     */
    sendToBack(elementId) {
        const location = this._elementIndex.get(elementId);
        if (!location) return;

        const minZ = this._getMinZ(location.slideIndex);
        this.reorderElement(elementId, minZ - 1);
    }

    /**
     * 获取指定区域内的元素
     */
    getElementsInRect(slideIndex, rect) {
        const elements = this.getElements(slideIndex);
        return elements.filter(el => {
            const elRect = { x: el.x, y: el.y, w: el.w, h: el.h };
            return this._rectsIntersect(rect, elRect);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 元素工厂
    // ═══════════════════════════════════════════════════════════════

    /**
     * 创建文本元素
     */
    createTextElement(options = {}) {
        return {
            id: this._generateId(),
            type: 'text',
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 30,
            h: options.h ?? 10,
            z: options.z ?? 1,
            content: options.content ?? '双击编辑文字',
            fontSize: options.fontSize ?? 24,
            fontWeight: options.fontWeight ?? 'normal',
            color: options.color ?? '#1f2937',
            align: options.align ?? 'left',
            valign: options.valign ?? 'top',
            ...options,
        };
    }

    /**
     * 创建图片元素
     */
    createImageElement(assetId, options = {}) {
        return {
            id: this._generateId(),
            type: 'image',
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 30,
            h: options.h ?? 30,
            z: options.z ?? 1,
            assetId,
            objectFit: options.objectFit ?? 'cover',
            ...options,
        };
    }

    /**
     * 创建形状元素
     */
    createShapeElement(shapeType = 'rect', options = {}) {
        return {
            id: this._generateId(),
            type: 'shape',
            shapeType,
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 20,
            h: options.h ?? 20,
            z: options.z ?? 1,
            fill: options.fill ?? '#3b82f6',
            stroke: options.stroke,
            strokeWidth: options.strokeWidth,
            borderRadius: options.borderRadius,
            ...options,
        };
    }

    /**
     * 创建图表元素
     */
    createChartElement(chartType = 'bar', options = {}) {
        return {
            id: this._generateId(),
            type: 'chart',
            chartType,
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 40,
            h: options.h ?? 30,
            z: options.z ?? 1,
            chartData: options.chartData ?? 'A:30,B:50,C:20',
            title: options.title ?? '',
            colors: options.colors ?? '#3b82f6,#10b981,#f59e0b',
            ...options,
        };
    }

    /**
     * 创建公式元素
     */
    createFormulaElement(latex = 'E = mc^2', options = {}) {
        return {
            id: this._generateId(),
            type: 'formula',
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 20,
            h: options.h ?? 10,
            z: options.z ?? 1,
            latex,
            displayMode: options.displayMode ?? true,
            ...options,
        };
    }

    /**
     * 创建图标元素
     */
    createIconElement(icon = 'mdi:star', options = {}) {
        return {
            id: this._generateId(),
            type: 'icon',
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 10,
            h: options.h ?? 10,
            z: options.z ?? 1,
            icon,
            color: options.color ?? '#3b82f6',
            ...options,
        };
    }

    /**
     * 创建 SVG 元素
     */
    createSvgElement(content, options = {}) {
        return {
            id: this._generateId(),
            type: 'svg',
            x: options.x ?? 10,
            y: options.y ?? 10,
            w: options.w ?? 20,
            h: options.h ?? 20,
            z: options.z ?? 1,
            content,
            ...options,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 内部方法
    // ═══════════════════════════════════════════════════════════════

    _rebuildIndex() {
        this._elementIndex.clear();
        this.slides.forEach((slide, slideIndex) => {
            if (slide.elements) {
                slide.elements.forEach((element, elementIndex) => {
                    if (element.id) {
                        this._elementIndex.set(element.id, { slideIndex, elementIndex });
                    }
                });
            }
        });
    }

    _generateId() {
        return 'el_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    }

    _getMaxZ(slideIndex) {
        const elements = this.getElements(slideIndex);
        if (elements.length === 0) return 0;
        return Math.max(...elements.map(el => el.z || 0));
    }

    _getMinZ(slideIndex) {
        const elements = this.getElements(slideIndex);
        if (elements.length === 0) return 0;
        return Math.min(...elements.map(el => el.z || 0));
    }

    _rectsIntersect(r1, r2) {
        return !(
            r1.x + r1.w < r2.x ||
            r2.x + r2.w < r1.x ||
            r1.y + r1.h < r2.y ||
            r2.y + r2.h < r1.y
        );
    }

    /**
     * 导出为 JSON
     */
    toJSON() {
        return JSON.parse(JSON.stringify(this.slides));
    }

    /**
     * 从 JSON 加载
     */
    fromJSON(json) {
        this.load(typeof json === 'string' ? JSON.parse(json) : json);
    }
}

window.SlideDocument = SlideDocument;
